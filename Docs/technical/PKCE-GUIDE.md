# LRE Toolkit — PKCE Implementation Guide

**Version:** 2.9.2 | **Date:** May 2026  
**RFC:** [RFC 7636 — Proof Key for Code Exchange (PKCE)](https://www.rfc-editor.org/rfc/rfc7636)

---

## What is PKCE?

PKCE (Proof Key for Code Exchange) is a security extension to the OAuth2 Authorization Code flow. It prevents authorization code interception attacks by:

1. The client generates a random `code_verifier` string before starting the auth flow
2. The client computes `code_challenge = BASE64URL(SHA-256(code_verifier))`
3. The authorization request includes `code_challenge` + `code_challenge_method=S256`
4. The token exchange request includes the original `code_verifier`
5. The authorization server independently computes the challenge from the verifier and verifies they match

An attacker who intercepts the authorization code cannot exchange it without knowing the `code_verifier`, which was never transmitted.

---

## Why PKCE is Different from Correlated Values

PKCE values are **client-generated**, not server-issued. This is a fundamental distinction:

| Type | Origin | Toolkit handling |
|---|---|---|
| Access token, session ID, CSRF token | Server sends → client stores → client sends later | Correlation extractor |
| `code_verifier` + `code_challenge` | Client generates → client sends to server | Runtime generation code |

The toolkit correctly identifies PKCE as client-generated and does **not** create correlation extractors for it. Instead, it generates runtime code to produce fresh values each iteration.

---

## Detection Logic

The toolkit scans `S.entries1` (all HAR requests):

```javascript
// code_challenge in URL query string
const _pqs = (_pe.url || "").includes("?") ? (_pe.url || "").split("?")[1] : "";
const _ccm = /(?:^|&)code_challenge=([^&]{32,})/.exec(_pqs);

// code_verifier in form POST body
const _bmt = (_pe.body && _pe.body.mimeType) || "";
if (_bmt.includes("form") || _bmt.includes("urlencoded")) {
    const _cvm = /(?:^|&)code_verifier=([^&]{32,})/.exec(_btext);
}
```

When found: `S.hasPkce = true`, and special `pkce` correlation records (with `sourceIdx: -1`) are created.

### Special Correlation Record

```javascript
{
    name: "pkce_challenge",
    sourceIdx: -1,             // -1 = never emit an extractor
    extractorType: "pkce",
    extractorConfig: { role: "challenge" },
    usages: [{
        reqIdx: 3,             // which request uses this value
        location: "query",     // where it goes
        key: "code_challenge"  // query param name
    }]
}
```

The `sourceIdx: -1` ensures no `web_reg_save_param` is ever emitted. The `usages` array drives body/URL substitution — replacing the literal challenge value with `${load.global.pkce_challenge}` (DevWeb) or `{pkce_challenge}` (VuGen).

---

## PKCE Generation: Per-Iteration Timing

Unlike DPoP keys (which are generated once per VUser in `initialize()`), PKCE values are generated **once per iteration** — at the start of `action()`:

```
VUser starts
    │
    ▼
initialize() / vuser_init.c
    │
    └── (if hasPkce only, not hasDpop) Load lre-utils.dat
    
Per iteration:
    │
    ▼
action() / Action.c
    │
    └── Generate pkce_verifier + pkce_challenge  ← START of iteration
          │
          ▼
       Authorization request → code_challenge in URL
          │
          ▼
       Token exchange → code_verifier in body
```

This is correct because the PKCE pair is bound to one authorization flow — which maps to one iteration.

---

## lre-utils.dat — generatePkce()

The `generatePkce()` function is added to `lre-utils.js` (at project root, deployed as `lre-utils.dat`):

```javascript
function generatePkce() {
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    // Generate 32 random bytes → 32-char base64url verifier (43 chars after encoding)
    var vBytes = [];
    for (var i = 0; i < 32; i++) vBytes.push(Math.floor(Math.random() * 256));
    var verifier = vBytes.map(function(b) { return chars[b % chars.length]; }).join('');

    // Hash the verifier: SHA-256 of ASCII bytes
    var vAscii = [];
    for (var i = 0; i < verifier.length; i++) vAscii.push(verifier.charCodeAt(i) & 0xff);
    var hash = _sha256(vAscii);

    // Base64url-encode the hash
    var B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    var b64 = '';
    for (var i = 0; i < hash.length; i += 3) {
        var b0 = hash[i], b1 = i+1 < hash.length ? hash[i+1] : 0, b2 = i+2 < hash.length ? hash[i+2] : 0;
        b64 += B64[(b0>>2)&63] + B64[((b0<<4)|(b1>>4))&63];
        b64 += i+1 < hash.length ? B64[((b1<<2)|(b2>>6))&63] : '=';
        b64 += i+2 < hash.length ? B64[b2&63] : '=';
    }
    var challenge = b64.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');

    LR.setParam('pkce_verifier', verifier);
    LR.setParam('pkce_challenge', challenge);
    return verifier;
}
```

**Note:** `Math.random()` is used for the verifier bytes. This is appropriate for load testing — PKCE's security requirement is uniqueness per authorization flow, not cryptographic unpredictability in the threat model of a load test.

---

## VuGen Generated Code

### vuser_init.c (PKCE only, no DPoP)

```c
vuser_init()
{
    // Load lre-utils.dat ONCE — provides generatePkce() for all Action() iterations
    web_js_run(
        "Code='lre-utils loaded';",
        "ResultParam=_lre_init",
        SOURCES,
            "File=lre-utils.dat", ENDITEM,
        LAST);

    return 0;
}
```

### vuser_init.c (DPoP + PKCE — DPoP takes precedence)

When both DPoP and PKCE are present, DPoP's `vuser_init` block fires (it already loads `lre-utils.dat` and generates the key pair). PKCE's `generatePkce()` function is available because it's in the same `lre-utils.dat` file.

### Action.c — Per Iteration

```c
Action()
{
    // PKCE — generate fresh code_verifier and code_challenge for this iteration
    web_js_run(
        "Code=generatePkce();",
        "ResultParam=pkce_verifier",
        LAST);

    // Authorization request — {pkce_challenge} now available
    web_url("Authorize",
        "URL=https://auth.example.com/authorize"
              "?response_type=code"
              "&client_id={client_id}"
              "&redirect_uri={redirect_uri}"
              "&code_challenge={pkce_challenge}"
              "&code_challenge_method=S256",
        "Snapshot=t1.inf",
        "Mode=HTML",
        LAST);

    // ... (receive authorization code via correlation) ...

    // Token exchange — {pkce_verifier} now available
    web_custom_request("TokenExchange",
        "URL=https://auth.example.com/token",
        "Method=POST",
        "Snapshot=t2.inf",
        "Mode=HTML",
        "Body=grant_type=authorization_code"
             "&code={authorization_code}"
             "&code_verifier={pkce_verifier}"
             "&client_id={client_id}"
             "&redirect_uri={redirect_uri}",
        LAST);

    return 0;
}
```

---

## DevWeb Generated Code

```javascript
// In action() — per iteration

// PKCE — generate fresh code_verifier + code_challenge for this iteration
{
    const _pkceChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
    const _vBytes = crypto.getRandomValues(new Uint8Array(32));
    load.global.pkce_verifier = Array.from(_vBytes)
        .map(b => _pkceChars[b % _pkceChars.length]).join('');
    const _hBuf = await crypto.subtle.digest('SHA-256',
        new TextEncoder().encode(load.global.pkce_verifier));
    load.global.pkce_challenge = btoa(String.fromCharCode(...new Uint8Array(_hBuf)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Authorization request uses pkce_challenge automatically
const authResp = await client.get('https://auth.example.com/authorize', {
    queryString: {
        response_type: 'code',
        client_id: load.params.client_id,
        code_challenge: load.global.pkce_challenge,
        code_challenge_method: 'S256'
    }
});

// Token exchange uses pkce_verifier automatically
const tokenResp = await client.post('https://auth.example.com/token', {
    body: 'grant_type=authorization_code' +
          '&code=' + load.global.authorization_code +
          '&code_verifier=' + load.global.pkce_verifier
});
```

**DevWeb uses `crypto.getRandomValues()` + `crypto.subtle.digest()`** (Web Crypto API, available in Node.js 18+) instead of `lre-utils.dat`. No additional files needed for DevWeb PKCE.

---

## Files Included in ZIP

| File | Condition |
|---|---|
| `lre-utils.dat` | When `hasDpop || hasPkce` (VuGen only) |
| `[Script].usr` | `ManuallyExtraFiles: lre-utils.dat=` entry added |
| `ScriptUploadMetadata.xml` | `<FileEntry Name="lre-utils.dat" Filter="2" />` added |

DevWeb does not need `lre-utils.dat` for PKCE — it uses the built-in `crypto` module.

---

*See also: [DPoP Guide](DPOP-GUIDE.md) | [Auth Guide](AUTH-GUIDE.md) | [Correlation Engine](CORRELATION-ENGINE.md)*
