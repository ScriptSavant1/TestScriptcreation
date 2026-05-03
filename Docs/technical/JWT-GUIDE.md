# LRE Toolkit — JWT Implementation Guide

**Version:** 2.9.2 | **Date:** May 2026

---

## Overview

JWT (JSON Web Token) support covers the case where the API being tested requires the **client to sign a JWT** (typically for OAuth2 client assertions or machine-to-machine auth). This is different from a Bearer token correlation — here the client generates the JWT itself using a private key.

---

## Detection — 14 Library Fingerprints

`customScriptParser.detectJwtUsage(script)` scans pre-request JavaScript (Postman/Bruno) or JSR223 (JMeter) scripts:

### JavaScript / Node.js Libraries

| Library | Detection Pattern |
|---|---|
| **jsrsasign** | `KJUR.jws.JWS.sign` or `require('jsrsasign')` |
| **jsonwebtoken** | `require('jsonwebtoken')` + `.sign(` in same script |
| **jose** | `require('jose')` |
| **crypto (manual)** | `crypto.createSign(` + base64url encoding in same script |

### Java / Groovy Libraries (JMeter JSR223/BeanShell)

| Library | Detection Pattern |
|---|---|
| **nimbus-jose-jwt** | `com.nimbusds.jose` or `com.nimbusds.jwt` or `JWTClaimsSet.Builder` |
| **nimbus (signing)** | `RSASSASigner`, `ECDSASigner`, `MACSigner`, `JWSAlgorithm.*` |
| **Auth0 java-jwt** | `com.auth0.jwt` or `JWT.create()` or `Algorithm.RSA256` |
| **JJWT** | `io.jsonwebtoken` or `Jwts.builder()` or `.signWith(` + `.compact()` |
| **BouncyCastle** | `org.bouncycastle` or `PEMParser` or `JcaPEMKeyConverter` |
| **JCA (manual RSA)** | `Signature.getInstance("SHA256withRSA")` or `PS256` or `RS384` etc. |
| **JCA (manual HMAC)** | `Mac.getInstance("HmacSHA256")` or `HmacSHA384` etc. |
| **PEM + claims** | `-----BEGIN PRIVATE KEY-----` present AND 3+ of: `iss`, `sub`, `aud`, `exp`, `iat`, `jti` |

### Output Variable Extraction

After detecting JWT code, the parser finds where the token is stored:

```
vars.put / vars.putObject / vars.putEncoded
props.put
context.set
postman.setEnvironmentVariable
pm.environment.set / pm.globals.set / pm.collectionVariables.set / pm.variables.set
bru.setEnvVar / bru.setGlobalEnvVar / bru.setVar
```

If no storage statement is found → `hasJwt = false` → zero JWT code generated (safe fallback — headers, auth, and correlation still apply).

---

## Claims Extraction

Once a JWT library is detected, the parser extracts the claims from the script:

```javascript
// Example: from a Postman pre-request script
const claims = {
    iss: pm.variables.get('client_id'),    // → load.params.client_id
    sub: pm.variables.get('client_id'),    // → load.params.client_id
    aud: pm.variables.get('token_url'),    // → load.params.token_url
    exp: Math.floor(Date.now()/1000) + 300,
    jti: uuid.v4()
};
```

Variable references (`pm.variables.get(...)`, `pm.environment.get(...)`, etc.) are resolved to their equivalent `load.params.*` (DevWeb) or `LR.getParam(...)` (VuGen) calls in the generated output.

---

## Generated Files

### jwt-helper.js (DevWeb)

Included in the DevWeb ZIP when JWT is detected. Uses Node.js `crypto` module for signing. Supports RS256, RS384, RS512, PS256, PS384, PS512, ES256, ES384, ES512, HS256.

```javascript
// jwt-helper.js (simplified)
const crypto = require('crypto');

async function getJwtToken({ privateKey, algorithm, claims }) {
    const header = { alg: algorithm, typ: 'JWT' };
    const payload = { ...claims };
    // ... signing logic ...
    return signedJwt;
}

module.exports = { getJwtToken };
```

### jsrsasign.js + lre-utils.dat (VuGen)

`jsrsasign.js` is a bundled pure-JavaScript RSA/EC library for VuGen's JS engine. `lre-utils.dat` wraps it with the `createJWT()` function. Both are included in VuGen ZIPs when JWT is detected.

### transport.pem

A placeholder PEM file included in both DevWeb and VuGen ZIPs. The engineer replaces it with their actual private key. The generated script reads from this file.

---

## DevWeb Generated Code

```javascript
const { getJwtToken } = require('./jwt-helper');

// In initialize() — generate JWT before first use
load.global.client_assertion = await getJwtToken({
    privateKey: load.params.private_key,
    algorithm: 'RS256',
    claims: {
        iss: load.params.client_id,
        sub: load.params.client_id,
        aud: load.params.token_endpoint,
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000),
        jti: require('crypto').randomUUID()
    }
});

// In token request
const tokenResp = await client.post(load.params.token_endpoint, {
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials' +
          '&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer' +
          '&client_assertion=' + load.global.client_assertion
});
```

---

## VuGen Generated Code

```c
// vuser_init.c — load libraries + create JWT
web_js_run(
    "Code='lre-utils loaded';",
    "ResultParam=_lre_init",
    SOURCES,
        "File=lre-utils.dat", ENDITEM,
    LAST);

web_js_run(
    "Code=var tok=createJWT({"
    "  privateKey:LR.getParam('private_key'),"
    "  algorithm:'RS256',"
    "  claims:{"
    "    iss:LR.getParam('client_id'),"
    "    sub:LR.getParam('client_id'),"
    "    aud:LR.getParam('token_endpoint'),"
    "    exp:Math.floor(Date.now()/1000)+300,"
    "    iat:Math.floor(Date.now()/1000),"
    "    jti:String(Date.now())+String(Math.random())"
    "  }"
    "});LR.setParam('client_assertion',tok);",
    "ResultParam=client_assertion",
    LAST);

// Action.c — use the JWT in the token request
web_custom_request("GetToken",
    "URL={token_endpoint}",
    "Method=POST",
    "Snapshot=t1.inf",
    "Mode=HTML",
    "Body=grant_type=client_credentials"
         "&client_assertion_type=urn:ietf:params:oauth:client-assertion-type:jwt-bearer"
         "&client_assertion={client_assertion}",
    LAST);
```

---

## HTML Entity Decoding (Critical)

PEM private keys (in Postman/JMeter exports) often have their newlines HTML-encoded as `&#10;` or `&amp;`. The toolkit decodes these before:

1. Writing to `collection_data.csv` / `ParameterFile.prm`
2. Passing to `jwt-helper.js`'s `getJwtToken()` for crypto operations

Without this: OpenSSL throws `"DECODER routines:: unsupported"` and VuGen's Parameters panel fails to open.

The `decodeHtmlEntities()` function handles: `&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&#10;`, `&#xA;`, `&#13;`, `&#xD;`, and other numeric entities.

---

## Private Key Security

PEM private keys and other crypto key material are classified as **Tier 1 Dynamic** (never written to CSV/PRM parameter files). Detection patterns:

`private-key`, `signing-key`, `secret-key`, `rsa-key`, `pem-key`, `pkcs`, `p12-key`, `client-secret`, `key-id`, `keystore` (and variations with underscores, camelCase).

This prevents two problems:
1. PEM keys (multiline strings) break the VuGen Parameters panel when written to `.prm` files
2. Accidentally exposing private keys in plaintext parameter files

---

## JWT Refresh

If a JWT has a short expiry (e.g. 5 minutes), and the load test runs longer, the JWT must be refreshed. The generated code creates the JWT in `initialize()` which runs once per VUser. For long tests:

- **DevWeb**: Move the `getJwtToken()` call from `initialize()` into `action()` to regenerate each iteration
- **VuGen**: Move the `web_js_run` JWT creation from `vuser_init.c` into `Action.c`

The toolkit generates a TODO comment at the JWT creation point when it detects a short `exp` claim.

---

*See also: [Auth Guide](AUTH-GUIDE.md) | [DPoP Guide](DPOP-GUIDE.md)*
