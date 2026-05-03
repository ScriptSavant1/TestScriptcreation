# LRE Toolkit — Authentication Guide

**Version:** 2.9.2 | **Date:** May 2026

All nine authentication types are auto-detected from the input collection and generate corresponding code. No manual configuration is required.

---

## Detection Order

Authentication detection runs in a fixed order. The first match wins per request:

1. NTLM / Kerberos (Windows SSO)
2. OAuth2 (token endpoint detection)
3. JWT signing (script content analysis)
4. DPoP (header presence)
5. PKCE (URL/body parameter patterns)
6. Basic Auth
7. Bearer Token
8. API Key
9. AWS Signature v4

---

## 1. OAuth2

### Detection
- `auth.type === "oauth2"` in collection
- Token endpoint URL (`/oauth/token`, `/token`, `/connect/token`)
- `grant_type` parameter in request body

### Supported Flows

| Flow | `grant_type` | Notes |
|---|---|---|
| Client Credentials | `client_credentials` | Most common for API-to-API |
| Password | `password` | User credentials + client credentials |
| Authorization Code | `authorization_code` + `code` parameter | Requires PKCE for public clients |

### DevWeb Generated Code (Client Credentials example)

```javascript
// Token acquisition in initialize()
const tokenResp = await client.post('https://auth.example.com/token', {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials' +
          '&client_id=' + load.params.client_id +
          '&client_secret=' + load.params.client_secret +
          '&scope=' + load.params.scope
});
load.global.access_token = JSON.parse(tokenResp.body).access_token;
```

### VuGen Generated Code (Client Credentials example)

```c
// In vuser_init.c
web_custom_request("GetToken",
    "URL=https://auth.example.com/token",
    "Method=POST",
    "Snapshot=t1.inf",
    "Mode=HTML",
    "Body=grant_type=client_credentials"
         "&client_id={client_id}"
         "&client_secret={client_secret}",
    LAST);
web_reg_save_param_json("access_token",
    "QueryString=$.access_token",
    LAST);
```

---

## 2. JWT (JSON Web Token)

### Detection — 14 Library Signatures

The `customScriptParser.detectJwtUsage()` function fingerprints JWT usage by scanning pre-request scripts for library-specific patterns.

**JavaScript (Postman/Bruno pre-request scripts, DevWeb):**

| Library | Detection Pattern |
|---|---|
| jsrsasign | `KJUR.jws.JWS.sign` or `require('jsrsasign')` |
| jsonwebtoken | `require('jsonwebtoken')` + `.sign(` |
| jose | `require('jose')` |
| Crypto (manual) | `crypto.createSign(` + base64url encoding |

**Java/Groovy (JMeter JSR223 scripts):**

| Library | Detection Pattern |
|---|---|
| nimbus-jose-jwt | `com.nimbusds.jose` or `JWTClaimsSet.Builder` |
| Auth0 java-jwt | `com.auth0.jwt` or `JWT.create()` |
| JJWT | `io.jsonwebtoken` or `Jwts.builder()` |
| BouncyCastle | `org.bouncycastle` or `PEMParser` |
| JCA (manual) | `Signature.getInstance("SHA256withRSA")` |
| PEM + claims | `-----BEGIN PRIVATE KEY-----` + 3+ JWT claims |

### Output Variable Extraction

After detecting JWT code, the parser scans for where the generated token is stored:
`vars.put`, `props.put`, `context.set`, `postman.setEnvironmentVariable`, all `pm.*.set`, all `bru.set*`

If no storage found → `hasJwt = false` → zero JWT code generated (safe fallback).

### DevWeb Generated Code

The `jwt-helper.js` file is included in the output ZIP. Generated in `initialize()`:

```javascript
const { getJwtToken } = require('./jwt-helper');
// In initialize():
load.global.jwt_token = await getJwtToken({
    privateKey: load.params.private_key,
    algorithm: 'RS256',
    claims: {
        iss: load.params.client_id,
        sub: load.params.client_id,
        aud: load.params.token_endpoint,
        exp: Math.floor(Date.now()/1000) + 300,
        jti: require('crypto').randomUUID()
    }
});
```

### VuGen Generated Code

`jsrsasign.js` and `lre-utils.dat` are included. Generated in `vuser_init.c`:

```c
web_js_run(
    "Code=var tok=createJWT({"
    "  privateKey:LR.getParam('private_key'),"
    "  algorithm:'RS256',"
    "  claims:{iss:LR.getParam('client_id'),exp:Math.floor(Date.now()/1000)+300}"
    "});LR.setParam('jwt_token',tok);",
    "ResultParam=jwt_token",
    SOURCES,
        "File=lre-utils.dat", ENDITEM,
    LAST);
```

---

## 3. DPoP (Demonstrating Proof-of-Possession, RFC 9449)

### What it is

DPoP binds an access token to a specific key pair. Every request that uses a DPoP-protected access token must include a `DPoP:` header containing a signed JWT (the "DPoP proof"). The proof includes the request method, URL, and a timestamp — preventing token replay attacks.

### Detection

Scans all request headers for `dpop` or `dpop-pf` (case-insensitive).

### Key Design

- EC P-256 key pair is generated **once per VUser** in `initialize()` / `vuser_init.c`
- A new DPoP proof JWT is generated **per request** (contains method + URL + timestamp + nonce)
- The `lre-utils.dat` file contains the pure-JavaScript EC/ECDSA/SHA-256 implementation

### DevWeb Generated Code

```javascript
// In initialize() — key pair generated once
const { subtle } = require('crypto').webcrypto;
load.global._dpopKey = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign', 'verify']
);

// In each request — proof generated per-call
const dpopProof = await generateDpopProof(load.global._dpopKey, 'POST',
    'https://api.example.com/resource');
```

### VuGen Generated Code

```c
// vuser_init.c — load library + generate key
web_js_run(
    "Code='lre-utils loaded';",
    "ResultParam=_lre_init",
    SOURCES,
        "File=lre-utils.dat", ENDITEM,
    LAST);
web_js_run(
    "Code=generateDpopKeyPair();",
    "ResultParam=dpop_public_jwk",
    LAST);

// Action.c — per request
web_js_run(
    "Code=generateDpopProof('POST','https://api.example.com/resource');",
    "ResultParam=dpop_proof",
    LAST);
web_add_header("DPoP", "{dpop_proof}");
```

See [DPoP Guide](DPOP-GUIDE.md) for complete implementation details.

---

## 4. PKCE (Proof Key for Code Exchange, RFC 7636)

### What it is

PKCE prevents authorization code interception attacks in OAuth2 public clients. The client generates a random `code_verifier`, computes `code_challenge = BASE64URL(SHA256(code_verifier))`, sends the challenge in the authorization request, then sends the verifier in the token exchange request. The server verifies they match.

### Detection

Scans URL query parameters for `code_challenge=` and request bodies for `code_verifier=`.

### Key Design

- `code_verifier` and `code_challenge` are generated **per iteration** (per authorization flow)
- These are client-generated values — **not correlated from server responses**
- Uses the same `lre-utils.dat` file as DPoP

### DevWeb Generated Code (in `action()`)

```javascript
// Per-iteration PKCE generation
const _pkceChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
const _vBytes = crypto.getRandomValues(new Uint8Array(32));
load.global.pkce_verifier = Array.from(_vBytes)
    .map(b => _pkceChars[b % _pkceChars.length]).join('');
const _hBuf = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(load.global.pkce_verifier));
load.global.pkce_challenge = btoa(String.fromCharCode(...new Uint8Array(_hBuf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
```

### VuGen Generated Code

```c
// vuser_init.c — load lre-utils.dat once
web_js_run(
    "Code='lre-utils loaded';",
    "ResultParam=_lre_init",
    SOURCES,
        "File=lre-utils.dat", ENDITEM,
    LAST);

// Action.c — per iteration
web_js_run(
    "Code=generatePkce();",
    "ResultParam=pkce_verifier",
    LAST);
// {pkce_verifier} and {pkce_challenge} now available as LR params
```

See [PKCE Guide](PKCE-GUIDE.md) for complete implementation details.

---

## 5. NTLM / Kerberos (Windows SSO)

### Detection

- `auth.type === "ntlm"` in collection
- Variable names: `AuthUsername`, `AuthPassword`, `AuthDomain`, `NtlmUsername`, etc.
- Header patterns: `Authorization: Negotiate`, `Authorization: NTLM`

### Key Implementation Detail

`detectNtlmKerberos()` runs **before** `classifyVariables()`. This ensures the username, password, and domain variables are correctly detected as authentication parameters before the classification engine sees them.

### DevWeb Generated Code

```javascript
// In initialize()
client.defaults.credentials = load.setUserCredentials(
    load.params.AuthUsername,
    load.params.AuthPassword,
    load.params.AuthDomain
);
```

### VuGen Generated Code

```c
// In vuser_init.c
web_set_user(load_get_host_by_name("{runtime_host}"),
    "{AuthUsername}", "{AuthPassword}", "{AuthDomain}");
```

**Note:** Host is hostname only, no port (LR 26.1 requirement).

---

## 6. Basic Authentication

### Detection

- `auth.type === "basic"` in collection
- `Authorization: Basic <base64>` header

### DevWeb Generated Code

```javascript
const response = await client.get('https://api.example.com/resource', {
    headers: {
        'Authorization': 'Basic ' + btoa(load.params.username + ':' + load.params.password)
    }
});
```

### VuGen Generated Code

```c
web_add_header("Authorization",
    "Basic " LR_PARAM_VALUE(username) ":" LR_PARAM_VALUE(password));
```

---

## 7. Bearer Token

### Detection

- `Authorization: Bearer <token>` header
- Dynamic-aware: if the token value matches a correlation target, the generated code uses the dynamic variable reference instead of a hard-coded value

### DevWeb Generated Code (dynamic Bearer)

```javascript
headers: { 'Authorization': 'Bearer ' + load.global.access_token }
```

### VuGen Generated Code (dynamic Bearer)

```c
web_add_header("Authorization", "Bearer {access_token}");
```

---

## 8. API Key

### Detection

- `auth.type === "apikey"` in collection
- Header named `X-API-Key`, `api-key`, `API-Key`
- Query parameter `api_key`, `apikey`, `key`

### DevWeb Generated Code

```javascript
// Header-based
headers: { 'X-API-Key': load.params.api_key }
// Query parameter-based
url: 'https://api.example.com/resource?api_key=' + load.params.api_key
```

---

## 9. AWS Signature v4

### Detection

- `auth.type === "awsv4"` in collection
- `Authorization: AWS4-HMAC-SHA256` header
- `x-amz-date` header presence

### Implementation

Generates AWS SigV4 signing code using the collected `accessKeyId`, `secretAccessKey`, `region`, and `service` parameters.

---

## 10. mTLS (Mutual TLS)

### Detection

- Certificate files uploaded alongside the collection (`.pem`, `.p12`, `.pfx`, `.jks`, `.cer`, `.crt`, `.key`)

### Implementation

Certificate files are included in the output ZIP. The generated script references them in the runtime settings configuration. The engineer configures VuGen's SSL settings to point to the certificate file.

---

## Parameter File Entries

All authentication credentials are written to the parameter file with the correct tier:

| Value type | Tier | File | nextValue |
|---|---|---|---|
| Client ID (URL/config) | Tier 2 Config | `collection_data.csv` / `.dat` | `Once` |
| Client Secret | Tier 3 TestData | `collection_data.csv` / `.dat` | `EachIteration` |
| Username | Tier 3 TestData | `collection_data.csv` / `.dat` | `EachIteration` |
| Password | Tier 3 TestData | `collection_data.csv` / `.dat` | `EachIteration` |
| API Key | Tier 2 Config | `collection_data.csv` / `.dat` | `Once` |
| Private key / PEM | Tier 1 Dynamic | In-memory / `lre-utils.dat` | N/A |
| JWT token | Tier 1 Dynamic | Generated in script | N/A |
| Access token | Tier 1 Dynamic | Correlated/generated | N/A |

**Private and crypto keys** (patterns: `private-key`, `signing-key`, `secret-key`, `rsa-key`, `pem-key`, `pkcs`, `p12-key`, `client-secret`) are never written to CSV/PRM parameter files — they would break the VuGen Parameters panel. They are always classified as Tier 1 Dynamic.

---

*See also: [JWT Guide](JWT-GUIDE.md) | [DPoP Guide](DPOP-GUIDE.md) | [PKCE Guide](PKCE-GUIDE.md) | [Correlation Engine](CORRELATION-ENGINE.md)*
