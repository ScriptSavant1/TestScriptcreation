# LRE Toolkit — DPoP Implementation Guide

**Version:** 2.9.2 | **Date:** May 2026  
**RFC:** [RFC 9449 — OAuth 2.0 Demonstrating Proof of Possession (DPoP)](https://www.rfc-editor.org/rfc/rfc9449)

---

## What is DPoP?

DPoP (Demonstrating Proof of Possession) is a security mechanism that binds an OAuth2 access token to a specific cryptographic key pair. It prevents stolen tokens from being used by attackers because:

1. The server issues the access token **bound to a public key**
2. Every subsequent API request must include a **DPoP proof** — a short-lived signed JWT
3. The proof contains the HTTP method, URL, timestamp, and optionally a server-issued nonce
4. If an attacker steals the access token, they cannot generate valid DPoP proofs without the private key

---

## How the Toolkit Detects DPoP

The detection scans all request headers for `dpop` or `dpop-pf` (case-insensitive):

```javascript
// In VuGen-Script-Studio-app.js (Studio) and advancedScriptGenerator.js (Converter)
for (const header of req.headers) {
    if (/^dpop(-pf)?$/i.test(header.name)) {
        S.hasDpop = true;
    }
}
```

Once detected, `S.hasDpop = true` (Studio) or `this.hasDpop = true` (Converter) controls all downstream code generation.

---

## lre-utils.dat — The Shared Crypto Library

All DPoP (and PKCE and JWT) operations for VuGen use `lre-utils.dat` — a pure-JavaScript cryptographic utility file designed for VuGen's JavaScript engine (which does not have access to Node.js crypto or browser Web Crypto APIs).

### What's in lre-utils.dat

| Function | Purpose |
|---|---|
| `_sha256(bytes[])` | Pure-JS SHA-256 implementation (no external deps) |
| `_bigInt(n, base)` | BigInteger arithmetic for EC math |
| `secp256r1` | P-256 elliptic curve parameters |
| `generateDpopKeyPair()` | Generates EC P-256 key pair, stores as LR params |
| `generateDpopProof(method, url, nonce?)` | Generates per-request DPoP proof JWT |
| `createJWT(config)` | Generic JWT creation (used by JWT flow too) |
| `generatePkce()` | PKCE verifier + challenge generation (v2.9.2) |

The file is `lre-utils.js` at the project root. When included in a VuGen ZIP, it is named `lre-utils.dat` (the `.dat` extension is required by VuGen for JavaScript utility files loaded via `web_js_run SOURCES`).

---

## Architecture: Key Lifetime

A critical design decision: **the EC key pair is generated once per VUser**, not per request.

```
VUser starts
    │
    ▼
vuser_init.c / initialize()
    │
    ├── Load lre-utils.dat (once)
    └── generateDpopKeyPair()
          ├── Creates EC P-256 key pair
          ├── Stores private key internally in JS closure
          └── Stores public key JWK as LR param / load.global

Per iteration (action.c / action()):
    │
    └── For each request with DPoP:
          └── generateDpopProof('POST', 'https://...', optional_nonce)
                ├── Builds header: {"typ":"dpop+jwt","alg":"ES256","jwk":{public_key}}
                ├── Builds payload: {"jti":uuid,"htm":"POST","htu":"https://...","iat":now}
                └── Signs with ECDSA P-256 private key → compact JWT
```

This means:
- Key pair persists for the VUser's lifetime (100s or 1000s of iterations)
- DPoP proofs are unique per request (different `jti`, `iat`, `htm`, `htu`)
- VuGen's JavaScript engine context is preserved between `web_js_run` calls within the same VUser — the private key stays in the JS closure

---

## VuGen Generated Code

### vuser_init.c

```c
vuser_init()
{
    // Load lre-utils.dat ONCE — functions persist for VUser lifetime
    web_js_run(
        "Code='lre-utils loaded';",
        "ResultParam=_lre_init",
        SOURCES,
            "File=lre-utils.dat", ENDITEM,
        LAST);

    // Generate EC P-256 key pair — ONE per VUser
    web_js_run(
        "Code=generateDpopKeyPair();",
        "ResultParam=dpop_public_jwk",
        LAST);

    return 0;
}
```

### Action.c — Per Request

```c
// Generate DPoP proof for this specific request
web_js_run(
    "Code=generateDpopProof('POST', 'https://auth.example.com/token');",
    "ResultParam=dpop_proof",
    LAST);

// Use it immediately
web_add_header("DPoP", "{dpop_proof}");
web_custom_request("TokenRequest",
    "URL=https://auth.example.com/token",
    "Method=POST",
    "Snapshot=t1.inf",
    "Mode=HTML",
    "Body=grant_type=client_credentials...",
    LAST);
```

---

## DevWeb Generated Code

### initialize()

```javascript
const { subtle } = require('crypto').webcrypto;

// Generate EC P-256 key pair — ONE per VUser
load.global._dpopKey = await subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify']
);
load.global._dpopPublicJwk = await subtle.exportKey('jwk', load.global._dpopKey.publicKey);
```

### action() — Per Request

```javascript
async function makeDpopProof(method, url) {
    const { subtle } = require('crypto').webcrypto;
    const header = { typ: 'dpop+jwt', alg: 'ES256', jwk: load.global._dpopPublicJwk };
    const payload = {
        jti: require('crypto').randomUUID(),
        htm: method,
        htu: url,
        iat: Math.floor(Date.now() / 1000)
    };
    const toSign = btoa(JSON.stringify(header)).replace(/=/g,'')
        .replace(/\+/g,'-').replace(/\//g,'_') + '.' +
        btoa(JSON.stringify(payload)).replace(/=/g,'')
        .replace(/\+/g,'-').replace(/\//g,'_');
    const sig = await subtle.sign(
        { name: 'ECDSA', hash: 'SHA-256' },
        load.global._dpopKey.privateKey,
        new TextEncoder().encode(toSign)
    );
    // Convert DER to raw R||S for ES256
    // ... (full implementation in generated code)
    return toSign + '.' + base64urlEncode(sig);
}
```

---

## DPoP Nonce Support

Some servers issue a `DPoP-Nonce` response header that must be included in the next proof. The toolkit generates a correlation for the `DPoP-Nonce` header and injects it into the proof:

### Detection

```javascript
// DPoP-Nonce is auto-correlated as a header extractor
correlations.push({
    name: 'dpop_nonce',
    extractorType: 'header',
    extractorConfig: { headerName: 'DPoP-Nonce' },
    usages: [...]
});
```

### Usage in Proof

```javascript
// generateDpopProof('POST', url, load.global.dpop_nonce)
// The nonce parameter is included as "nonce" claim in the payload
```

---

## Parameter Files

DPoP does not add entries to CSV or PRM parameter files. The EC key pair is generated at runtime and stored only in memory. No private key material is written to parameter files.

---

## Testing DPoP Scripts

1. Open the generated script in VuGen
2. Verify `vuser_init.c` contains the `web_js_run` for `lre-utils.dat`
3. Verify `Action.c` contains `web_js_run` calls for `generateDpopProof()` before each DPoP-protected request
4. Run the script — the DPoP proofs should be accepted by the authorization server
5. If the server issues `DPoP-Nonce` responses, verify the nonce correlation extracts and replays correctly

---

## Relationship with Other Auth Mechanisms

DPoP is commonly used **in combination with** OAuth2 and JWT:

```
1. Generate EC P-256 key pair (in vuser_init)
2. Acquire access token via OAuth2 + DPoP:
   → POST /token with DPoP proof (includes public key JWK)
   → Server binds access token to the public key
3. Use access token + per-request DPoP proof in API calls:
   → GET /api/resource
   → Authorization: DPoP <access_token>
   → DPoP: <proof_jwt>
```

The toolkit generates all three steps as a coherent unit when it detects both OAuth2 and DPoP.

---

*See also: [Auth Guide](AUTH-GUIDE.md) | [PKCE Guide](PKCE-GUIDE.md) | [JWT Guide](JWT-GUIDE.md)*
