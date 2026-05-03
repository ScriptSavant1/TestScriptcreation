# LRE Toolkit — DevWeb Protocol Guide

**Version:** 2.9.2 | **Date:** May 2026

DevWeb (JavaScript) is the modern LoadRunner protocol. Scripts run as `main.js` in a Node.js-like environment provided by LRE.

---

## Generated File Manifest

| File | Required | Purpose |
|---|---|---|
| `main.js` | Always | Script entry point — all requests, transactions, auth |
| `ScriptName.usr` | Always | VuGen project descriptor |
| `rts.yml` | Always | Runtime settings (think time, proxy, SSL, iterations) |
| `scenario.yml` | Always | Scenario config (VU count, ramp, duration) |
| `parameters.yml` | Always | Parameter file declarations |
| `collection_data.csv` | Always | Tier 2 + Tier 3 variable values |
| `DevWebSdk.d.ts` | Always | TypeScript definitions for IntelliSense |
| `ScriptUploadMetadata.xml` | Always | LRE upload manifest |
| `jwt-helper.js` | If JWT | JWT signing helper using Node.js crypto |
| `jsrsasign.js` | If JWT | RSA/EC crypto library for DevWeb |
| `transport.pem` | If JWT | Placeholder private key |
| `lre-utils.dat` | If DPoP/PKCE | DPoP + PKCE + JWT crypto for VuGen JS engine |

---

## main.js Structure

```javascript
'use strict';
const load = require('node-modules/load');

// ── Transaction declarations (all at module level) ──────────────────────────
const T01 = new load.Transaction('T01_LoginUser');
const T02 = new load.Transaction('T02_GetAccount');
const T03 = new load.Transaction('T03_SubmitPayment');

// ── Optional: JWT helper ────────────────────────────────────────────────────
const { getJwtToken } = require('./jwt-helper');

// ── Initialize (runs once per VUser, before first iteration) ────────────────
load.initialize(async function() {
    // OAuth2 token acquisition
    const tokenResp = await load.utils.createRequest({...}).send();
    load.global.access_token = JSON.parse(tokenResp.body).access_token;

    // JWT generation (if detected)
    load.global.client_assertion = await getJwtToken({...});

    // DPoP key pair (if detected)
    load.global._dpopKey = await crypto.subtle.generateKey({...});
});

// ── Action (runs every iteration) ───────────────────────────────────────────
load.action(async function() {
    // PKCE generation (if detected) — per iteration
    // ...

    // Request 1
    T01.start();
    const r1 = await load.utils.createRequest({
        url: `https://${load.params.host}/api/login`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            username: load.params.username,
            password: load.params.password
        })
    }).send();
    load.global.session_id = JSON.parse(r1.body).sessionId;
    T01.stop(load.Transaction.PASS);

    // think time
    await load.utils.sleep(1000);

    // Request 2
    T02.start();
    const r2 = await load.utils.createRequest({
        url: `https://${load.params.host}/api/account`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${load.global.access_token}`,
            'X-Session-Id': load.global.session_id
        }
    }).send();
    T02.stop(load.Transaction.PASS);
});

// ── Finalize (runs once per VUser, after last iteration) ────────────────────
load.finalize(async function() {
    // logout, cleanup
});
```

---

## Variable Access Patterns

| Tier | Variable type | How to read | How to write |
|---|---|---|---|
| Tier 1 Dynamic | Correlated/generated | `load.global.varName` | `load.global.varName = value` |
| Tier 2 Config | Environment/URL/config | `load.params.varName` | (read-only — from CSV) |
| Tier 3 TestData | Username/password/data | `load.params.varName` | (read-only — from CSV) |

---

## collection_data.csv Format

```csv
username,password,client_id,client_secret,host,access_token
user1,pass1,my-client-id,my-secret,api.example.com,
user2,pass2,my-client-id,my-secret,api.example.com,
```

- Headers: one row
- Tier 2 (Config): same value in all rows
- Tier 3 (TestData): different value per row (username/password)
- Tier 1 (Dynamic): empty value — filled at runtime by the script

---

## parameters.yml Format

```yaml
parameters:
  - name: username
    file: collection_data.csv
    column: username
    nextValue: EachIteration
    whenOutOfValues: Cycle
  - name: client_id
    file: collection_data.csv
    column: client_id
    nextValue: Once
    whenOutOfValues: Cycle
  - name: access_token
    file: collection_data.csv
    column: access_token
    nextValue: EachIteration
    whenOutOfValues: Cycle
```

---

## rts.yml Key Settings

```yaml
think_time:
  type: fixed
  value: 1000ms

proxy:
  enabled: false
  # host: proxy.example.com
  # port: 8080

ssl:
  verify_certificate: false
  # certificate: transport.pem

iterations: 1
pacing: immediate
```

---

## Transaction Naming Convention

All transactions use the pattern `T{nn}_{RequestName}`:

- Numbers are zero-padded to 2 digits: `T01`, `T02`, ... `T99`
- Counter is global across ALL folders (not reset per folder)
- Request name is normalized: spaces → `_`, numbers in name are stripped
- Examples: `T01_LoginUser`, `T02_GetAccessToken`, `T15_SubmitPayment`

### Module-Level Declaration (Critical)

All `new load.Transaction(...)` declarations must be at the **module level**, before `initialize()`. This is required for LRE to enumerate transactions before the script runs.

```javascript
// CORRECT — module level
const T01 = new load.Transaction('T01_Login');

// WRONG — inside initialize() or action()
load.initialize(async () => {
    const T01 = new load.Transaction('T01_Login'); // Not visible to LRE
});
```

---

## Request with Correlation Example

```javascript
// Before request: nothing to do — correlation is in the PREVIOUS response

// Request that returns a value to correlate
const loginResp = await load.utils.createRequest({
    url: `https://${load.params.host}/api/login`,
    method: 'POST',
    body: JSON.stringify({ user: load.params.username, pass: load.params.password })
}).send();

// Extract correlated value from response
load.global.session_token = JSON.parse(loginResp.body).token;

// Use in next request
const apiResp = await load.utils.createRequest({
    url: `https://${load.params.host}/api/data`,
    headers: { 'X-Session': load.global.session_token }
}).send();
```

---

## Authentication Patterns

### OAuth2 Client Credentials

```javascript
// In initialize()
const tokenResp = await load.utils.createRequest({
    url: load.params.token_endpoint,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=client_credentials&client_id=${load.params.client_id}&client_secret=${load.params.client_secret}`
}).send();
load.global.access_token = JSON.parse(tokenResp.body).access_token;
```

### DPoP + OAuth2

```javascript
// In initialize()
const key = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
load.global._dpopKey = key;
load.global._dpopPublicJwk = await crypto.subtle.exportKey('jwk', key.publicKey);
// ... DPoP proof + token acquisition ...
```

### Bearer

```javascript
headers: { 'Authorization': `Bearer ${load.global.access_token}` }
```

---

## DevWeb SDK Reference (Key Methods)

| Method | Purpose |
|---|---|
| `load.utils.createRequest({url, method, headers, body}).send()` | Make HTTP request |
| `load.global.varName` | Read/write dynamic variable (shared per VUser across iterations) |
| `load.params.varName` | Read parameter from CSV |
| `load.utils.sleep(ms)` | Think time |
| `new load.Transaction('name')` | Create transaction |
| `transaction.start()` | Start timing |
| `transaction.stop(load.Transaction.PASS\|FAIL)` | Stop timing |
| `load.setUserCredentials(user, pass, domain)` | NTLM/Kerberos credentials |

---

*See also: [Auth Guide](AUTH-GUIDE.md) | [VuGen Protocol Guide](VUGEN-PROTOCOL.md)*
