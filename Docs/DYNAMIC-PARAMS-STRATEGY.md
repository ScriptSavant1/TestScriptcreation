# Dynamic Parameter Strategy
## VBAC + PKCE + Client-Generated Values — Complete Reference

**Version:** 1.0  
**Last Updated:** 2026-05-02  
**Scope:** All tools — Postman/Bruno Converter · JMeter Converter · VuGen Script Studio

---

## Table of Contents

1. [The Two Fundamental Categories](#1-the-two-fundamental-categories)
2. [VBAC — Server-Returned Tokens (Correlations)](#2-vbac--server-returned-tokens-correlations)
3. [Client-Generated Values (PKCE-type)](#3-client-generated-values-pkce-type)
4. [Implementation Status per Tool](#4-implementation-status-per-tool)
5. [Algorithm: Why JWT Bearer Sometimes Misses](#5-algorithm-why-jwt-bearer-sometimes-misses)
6. [HAR Capture Best Practices](#6-har-capture-best-practices)
7. [Implementation Roadmap](#7-implementation-roadmap)
8. [Generation Code Reference — Both Protocols](#8-generation-code-reference--both-protocols)

---

## 1. The Two Fundamental Categories

Before writing any correlation or generation code, classify the dynamic value:

```
Dynamic value in a request
         │
         ├── Did a SERVER send this value in an earlier response?
         │         YES → VBAC Correlation  (capture from response, replay in request)
         │          NO → Client-Generated  (generate fresh value at runtime)
```

**Getting this wrong is catastrophic for load tests:**
- Correlating a client-generated value → hardcoded garbage value replayed across all users
- Failing to correlate a server-issued token → every iteration reuses the same token → session collision

---

## 2. VBAC — Server-Returned Tokens (Correlations)

These values are **issued by the server** in a response and must be **captured and replayed** in later requests. The value is different for every session — it cannot be hardcoded or computed.

### 2.1 OAuth2 / OIDC Flow Tokens

| Parameter | Location in Response | Location in Request | Notes |
|-----------|---------------------|---------------------|-------|
| `access_token` | JSON body `$.access_token` | `Authorization: Bearer <token>` | JWT or opaque; expires |
| `refresh_token` | JSON body `$.refresh_token` | POST body `refresh_token=` | Long-lived; offline use |
| `id_token` | JSON body `$.id_token` | Body or header depending on flow | JWT with user claims |
| Authorization `code` | Redirect URL `?code=xxx` | POST body `code=` (token exchange) | Very short-lived (~60s) |
| `session_state` | Redirect URL `?session_state=xxx` | Not always replayed | OIDC session |
| `state` (server echo) | Redirect URL `?state=xxx` | Validate only; not always replayed | Anti-CSRF |

**How the token exchange chain looks in HAR:**
```
Request N   → GET /authorize?...&code_challenge=...
Response N  ← 302 Location: /callback?code=IbF8... (auth code in redirect URL)

Request N+1 → POST /token body: {code=IbF8..., code_verifier=..., grant_type=authorization_code}
Response N+1 ← 200 JSON: {"access_token":"eyJhbGci...","token_type":"Bearer",...}

Request N+2 → GET /api/resource   Authorization: Bearer eyJhbGci...
Request N+3 → GET /api/resource2  Authorization: Bearer eyJhbGci...
```

**Critical insight:** The Bearer JWT in requests N+2 and N+3 comes from response N+1's JSON body (`$.access_token`). The HAR DOES contain this response — but only if Chrome's "Export HAR with sensitive data" option is enabled. See [Section 6](#6-har-capture-best-practices).

### 2.2 Session & API Tokens (Non-Standard Headers)

These are the primary VBAC targets — the pattern engine misses them because the header name is application-specific.

| Header Name Pattern | Example Value | Typical Source |
|--------------------|---------------|----------------|
| `X-Auth-Token` | `abc123xyz789` | Login response header |
| `X-Access-Token` | JWT or opaque | Token endpoint response |
| `X-Session-Token` | Random hex | Session creation response |
| `X-Session-Id` | UUID | Session creation response |
| `X-Transaction-Token` | Random | Transaction initiation |
| `X-API-Token` | Random | API key rotation response |
| `Authorization` | `Bearer eyJ...` | Token endpoint JSON body |
| `X-Financial-Id` | UUID | Financial service session |

**VBAC detection rule:**
- Any `X-*` request header whose value `isDynamic()` AND is found in an earlier response → correlate

### 2.3 CSRF Tokens (Server-Issued)

These come FROM the server (in HTML, JSON, or Set-Cookie) and must be sent back. They are NOT client-generated.

| Mechanism | Server Issues In | Client Sends In |
|-----------|-----------------|-----------------|
| HTML hidden field | `<input type="hidden" name="__RequestVerificationToken" value="xxx">` | Form POST body |
| Meta tag | `<meta name="csrf-token" content="xxx">` | `X-CSRF-Token` header |
| JSON response | `{ "csrfToken": "xxx" }` | `X-CSRF-Token` header |
| Cookie → Header | `Set-Cookie: XSRF-TOKEN=xxx` | `X-XSRF-TOKEN: xxx` (JS reads cookie, sends header) |
| Response header | `X-CSRF-Token: xxx` | `X-CSRF-Token: xxx` next request |

**Known CSRF field names (all are server-issued correlations):**

```
__RequestVerificationToken    (ASP.NET MVC)
__VIEWSTATE                   (ASP.NET WebForms)
__EVENTVALIDATION             (ASP.NET WebForms)
authenticity_token            (Ruby on Rails)
_token                        (Laravel)
csrfmiddlewaretoken           (Django)
csrf_token, csrfToken         (generic)
form_key                      (Magento)
javax.faces.ViewState         (JSF)
```

### 2.4 Server-Generated Entity IDs (Needed in Subsequent Requests)

POST a resource → server returns ID → subsequent requests use the ID.

| Pattern | Example | Flow |
|---------|---------|------|
| Payment ID | `consentId`, `paymentId`, `orderId` | POST /payments → GET /payments/{id} |
| User session | `sessionId`, `interactionId` | POST /session → PUT /session/{id} |
| Transaction ID | `transactionRef`, `caseId` | POST /transactions → PATCH /transactions/{id} |
| Upload reference | `fileRef`, `uploadId`, `resourceId` | POST /upload → GET /upload/{id}/status |

**Detection:** JSON response body with field name matching known ID patterns + value is UUID or long numeric.

### 2.5 Redirect-Captured Values

| Value | Captured From | Used In |
|-------|--------------|---------|
| OAuth `code` | 302 redirect URL `?code=xxx` | POST token exchange body |
| SAML `SAMLResponse` | POST form body in redirect | POST to SP |
| `RelayState` | SAML redirect | POST to SP alongside SAMLResponse |
| PingFederate `resumePath` | Redirect URL path segment | GET to resume auth |
| ADFS `wa`, `wresult` | WS-Federation redirect | POST to application |

### 2.6 Summary: What VBAC Must Scan in Each Response

| Response Content Type | Where to Look | Extractor Type |
|----------------------|---------------|----------------|
| `application/json` | Recursive JSON walk — all string leaf values | `JsonPathExtractor` / `web_reg_save_param_json` |
| `text/html` | `<input type="hidden">`, `<meta name="csrf-*">`, `<script>var token=` | `HtmlExtractor` / `BoundaryExtractor` |
| `application/xml`, `text/xml` | `<tag>value</tag>`, attribute values | `XpathExtractor` / `web_reg_save_param_xpath` |
| Any content type | Boundary fallback | `BoundaryExtractor` / `web_reg_save_param` |
| Redirect `Location:` header | URL query params, path segments | `BoundaryExtractor` (header scope) |
| Any response header | Header value exact or partial match | `BoundaryExtractor` (header scope) |

---

## 3. Client-Generated Values (PKCE-type)

These are values **computed entirely by the client** before sending the request. They are **never in any server response**. Correlation from HAR is **impossible** — these must be regenerated at runtime using the same algorithm the browser used.

### 3.1 PKCE — Proof Key for Code Exchange (RFC 7636)

**OAuth 2.0 with PKCE — the modern standard for public clients.**

```
code_verifier  = random(32 bytes) → base64url → 43-128 char string
                 Example: "YqDfW8v5yQk1vIVAxB~zqubMC2CWcTmf821nA~__STx..."

code_challenge = BASE64URL(SHA256(code_verifier))
                 Example: "X2yB_LDMHa_6ty5i8JT6OtKrE7qn0A62DAfoXWtz1WM"

code_challenge_method = "S256"  (static — no generation needed)
```

**Flow in HAR:**
```
Request → GET /authorize?code_challenge=X2yB...&code_challenge_method=S256
Response ← 302 Location: /callback?code=IbF8...

Request → POST /token body: code=IbF8...&code_verifier=YqDfW8v5...&grant_type=authorization_code
```

**Detection in HAR:** both `code_challenge` AND `code_verifier` present in requests → PKCE flow confirmed.

**Generation needed (NOT YET IMPLEMENTED):**

| Protocol | code_verifier | code_challenge |
|----------|--------------|----------------|
| DevWeb | `crypto.randomBytes(32).toString('base64url')` or `load.utils.randomBytes()` | `crypto.subtle.digest('SHA-256', Buffer.from(verifier))` → base64url |
| VuGen C | `gen_csrf_token` style (32 rand bytes → hex) then base64url-encode | SHA256 via jsrsasign or OpenSSL |

### 3.2 UUID / GUID Values (Per-Request)

Values that **must be unique per request** — the client generates a new UUID before each request.

| Header / Field | Format | Notes |
|---------------|--------|-------|
| `x-fapi-interaction-id` | UUID v4 | Per request in FAPI flows |
| `x-request-id` | UUID v4 | Distributed tracing |
| `x-idempotency-key` | UUID v4 | Idempotent POST/PUT |
| `x-correlation-id` | UUID v4 | Microservice tracing |
| `x-b3-traceid` | 32 hex chars (128-bit) | Zipkin / Jaeger |
| `x-b3-spanid` | 16 hex chars (64-bit) | Zipkin |
| `jti` (JWT claim) | UUID v4 | JWT anti-replay |
| `instructionId` | UUID without hyphens | Payment systems |
| `endToEndId` | UUID-derived, first 31 chars, no hyphens | Open Banking |
| `statementReference` | UUID-derived, first 18 chars | Open Banking |

**Status: ALREADY IMPLEMENTED** — `gen_uuid()` (VuGen), `load.utils.uuid()` (DevWeb), `gen_csrf_token()` for hex variants. Detection via `customScriptParser.detectPerRequestDynamicVars()` and `isCsrfHeaderName()`.

### 3.3 Timestamps (Per-Request)

| Header / Field | Format | Example |
|---------------|--------|---------|
| Any `*-timestamp`, `*-date` | Unix epoch (seconds or ms) | `1716585600` |
| `x-fapi-auth-date` | RFC3339 / ISO 8601 | `2024-05-25T00:00:00Z` |
| `Date` header | RFC 2822 | `Sat, 25 May 2024 00:00:00 GMT` |
| `iat`, `exp` in JWT claims | Unix epoch integer | Generated inside JWT helper |

**Status: ALREADY IMPLEMENTED** — `char _ts[32]; sprintf(_ts, "%ld", (long)time(NULL))` (VuGen), `Date.now()` (DevWeb).

### 3.4 CSRF Tokens (Client-Generated Hex)

**Important distinction:** Some CSRF tokens are CLIENT-generated (random hex), not server-issued.

| Pattern | How to Identify | Generation |
|---------|----------------|------------|
| `x-xsrf-token` | Value in request header but ALSO in `XSRF-TOKEN` Set-Cookie → it's the cookie value | Correlation (cookie → header) |
| `x-csrf-token` where value NOT in any response | Client-generated | `gen_csrf_token()` — 32 hex chars |
| `__RequestVerificationToken` in hidden field | Always server-issued (ASP.NET) | Correlation |

**Status: ALREADY IMPLEMENTED** for client-generated hex via `gen_csrf_token("_param")` (VuGen) and `load.utils.randomBytes()` approach (DevWeb).

### 3.5 DPoP Proofs (Per-Request JWT)

Demonstrating Proof of Possession — a JWT signed per-request containing the HTTP method and URL.

```
DPoP: eyJhbGciOiJFUzI1NiIsImp3ayI6eyJrdHkiOiJFQyIsIngiOiIuLiIsInkiOiIuLiIsImNydiI6IlAtMjU2In19...
```

**Status: ALREADY IMPLEMENTED** — `dpop-helper.js` generates EC P-256 key pair + signs per-request JWT.

### 3.6 FAPI-Specific Headers

| Header | Nature | Handling |
|--------|--------|---------|
| `x-fapi-interaction-id` | UUID per request | Generate → `gen_uuid()` / `load.utils.uuid()` |
| `x-fapi-financial-id` | Static UUID per environment | Parameter (Tier 2 Config) |
| `x-fapi-auth-date` | Timestamp per request | Generate → ISO timestamp |
| `x-fapi-customer-ip-address` | Per-user data | Parameter (Tier 3 Test Data) |

### 3.7 HMAC / Request Signatures

| Type | Description | Status |
|------|-------------|--------|
| AWS Signature v4 | Signs request headers + body | IMPLEMENTED |
| Custom HMAC-SHA256 | Signs body or canonical request | Partially — JWT helper covers symmetric |
| JWS request signing | Financial API request object signing | Via JWT helper if body contains claims |
| MTLS / certificate binding | Client certificate-bound tokens | Out of scope (handled by LRE runtime) |

---

## 4. Implementation Status per Tool

### 4.1 VuGen Script Studio (HAR Tool)

| Feature | VBAC | Client-Gen | Status |
|---------|------|-----------|--------|
| Bearer token (`Authorization: Bearer`) | ✅ Pattern engine + VBAC | — | **Partial** — when response body captured; otherwise TODO hint now emitted (v2.9.2) |
| Auth code from redirect URL | ✅ Pattern engine | — | ✅ Working |
| CSRF from HTML hidden field | ✅ Pattern engine | — | ✅ Working |
| CSRF from meta tag | ✅ Pattern engine | — | ✅ Working |
| CSRF from cookie → header | ✅ Pattern engine | — | ✅ Working |
| CSRF client hex | — | ✅ `gen_csrf_token()` | ✅ Working |
| UUID per-request headers | — | ✅ `gen_uuid()` | ✅ Working |
| Timestamp per-request | — | ✅ `time(NULL)` / `Date.now()` | ✅ Working |
| JSON entity IDs (POST → GET) | ✅ VBAC | — | ✅ Working (when response captured) |
| DPoP | — | ✅ `dpop-helper.js` | ✅ Working |
| PKCE `code_verifier` / `code_challenge` | ❌ Cannot correlate | ❌ Not yet generated | **MISSING** |
| X-FAPI-Interaction-Id | — | ✅ `gen_uuid()` | ✅ Working |
| X-FAPI-Auth-Date (timestamp) | — | ⚠️ Static in current gen | **NEEDS IMPROVEMENT** |
| SAML assertion | ❌ Not implemented | — | **MISSING** |
| Custom app tokens (non-standard names) | ✅ VBAC phase 4 | — | ✅ Working (when response captured) |

### 4.2 Postman / Bruno Converter

| Feature | VBAC | Client-Gen | Status |
|---------|------|-----------|--------|
| Bearer `access_token` | ✅ correlationDetector | — | ✅ Working |
| Script-set variables (`pm.env.set`, `bru.setEnvVar`) | ✅ Tier 1 dynamic | — | ✅ Working |
| CSRF from test script | ✅ Script scan | — | ✅ Working |
| UUID from pre-request script | — | ✅ Parameterized | ✅ Working |
| PKCE detection | — | ❌ Not yet | **MISSING** |
| JMeter UDVs | N/A | N/A | N/A |

### 4.3 JMeter / JMX Converter

| Feature | VBAC | Client-Gen | Status |
|---------|------|-----------|--------|
| JMeter extractors (JSON/Regex/XPath/Boundary) | ✅ Directly mapped | — | ✅ Working |
| JMX UDV → parameter files | ✅ buildVariableMap() | — | ✅ Working (v2.9.2) |
| CSVDataSet → ParameterFile.prm | — | ✅ Parameterized | ✅ Working |
| JSR223 UUID generation | — | ✅ Detected + gen_uuid() | ✅ Working |
| JSR223 PKCE (if present in script) | — | ❌ Not yet | **MISSING** |
| JSR223 HMAC/JWT signing | — | ✅ jwt-helper.js | ✅ Working |

---

## 5. Algorithm: Why JWT Bearer Sometimes Misses

### The HAR-Based Correlation Chain

```
HAR Entry N   (issueToken POST)
  request:  POST /auth/token  body: {code=..., code_verifier=...}
  response: 200 JSON: {"access_token":"eyJhbGci...","token_type":"Bearer"}
                               ▲
                               │  findValueBefore() searches here
                               │
HAR Entry N+1 (API call)
  request:  GET /api/resource
  headers:  Authorization: Bearer eyJhbGci...
                                   ▲
                            This value needs to be found in entry N response
```

### Failure Modes and Fixes

| Failure Cause | Symptom | Fix |
|--------------|---------|-----|
| HAR captured without "sensitive data" | `response.content.text` is empty for token endpoints | Enable "Export HAR with sensitive data" (see Section 6) |
| Response body is base64-encoded binary | `respBody` contains base64 chars, JWT not found by indexOf | Parse `content.encoding: "base64"` → atob() decode [PLANNED] |
| Token endpoint URL filtered out | `filtered = true` on issueToken entry | Ensure issueToken URL not in NOISY regex |
| Sub-requests (redirects) carry the token | Token is in a 302 → auto-followed entry's response | Extend `findValueBefore` to scan auto-follow chain [PLANNED] |
| Response body not captured at all | Empty `respBody` on all POST responses | Re-record HAR with correct settings |

### Current Fallback (v2.9.2)

When `findValueBefore()` returns null for `Authorization: Bearer`, the pattern engine NOW adds the token to `S.candidates`. The codegen emits:

```javascript
// DevWeb:
// TODO: corr — add extractor on the response that issues this token.
"authorization": `Bearer ${load.global.AccessToken}`,

// VuGen:
// TODO: corr — add web_reg_save_param BEFORE the request that returns "Authorization".
// Example: web_reg_save_param("AccessToken", "LB=\"access_token\":\"", "RB=\"", "Search=Body", "Ord=1", LAST);
web_add_header("Authorization", "Bearer {AccessToken}");
```

The script is immediately runnable and correctly wired — the tester only needs to add the extractor on the token endpoint response.

---

## 6. HAR Capture Best Practices

### Required Setting: Export Sensitive Data

**Chrome DevTools → F12 → Network tab → ⚙️ Settings → ✅ "Export HAR with sensitive data"**

Without this:
- Authorization request headers are REDACTED
- Response bodies of authentication endpoints are EMPTY
- Bearer tokens are invisible to all correlation engines
- PKCE `code_verifier` values are hidden

With this enabled:
- Full `Authorization: Bearer eyJ...` headers captured
- Full token endpoint response bodies: `{"access_token":"eyJ...","refresh_token":"..."}`
- Complete OAuth redirect chains with `?code=` parameters

### Recording Order for OAuth Flows

Always start recording BEFORE the first request (before the login page loads). The OAuth flow creates a chain where each response feeds the next request:

```
1. GET /app                          ← start recording HERE
2. GET /authorize?code_challenge=...  ← PKCE challenge
3. 302 → /login                      ← auth redirect
4. POST /login/submit                 ← credentials
5. 302 → /callback?code=IbF8...      ← auth code in redirect
6. POST /token   body: code=IbF8...  ← TOKEN EXCHANGE ← must be captured
7. GET /api/...  Bearer eyJhbGci...  ← uses token from step 6
```

If recording starts at step 6, the correlation engine will see the token used in step 7 but cannot find its source (step 6's response body was not recorded).

---

## 7. Implementation Roadmap

### Priority 1 — High Impact, Achievable Now

#### P1.1: PKCE Generation in VuGen Script Studio

**Trigger:** HAR contains `code_challenge` AND `code_verifier` in requests.

**DevWeb output:**
```javascript
// In initialize() — generate PKCE pair once per iteration
const _pkceVerifier = (function() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return btoa(String.fromCharCode(...bytes))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
})();
const _pkceChallengeHash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(_pkceVerifier));
const _pkceChallenge = btoa(String.fromCharCode(...new Uint8Array(_pkceChallengeHash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
load.global.code_verifier  = _pkceVerifier;
load.global.code_challenge = _pkceChallenge;
```

**VuGen output (globals.h — new function):**
```c
// Generates PKCE code_verifier (43 URL-safe base64 chars from 32 random bytes)
static void gen_pkce_verifier(const char* paramName) {
    static const char b64url[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    char buf[44];
    int i;
    for (i = 0; i < 43; i++) buf[i] = b64url[rand() % 64];
    buf[43] = '\0';
    lr_save_string(buf, paramName);
}
// NOTE: code_challenge = SHA256(code_verifier) — use jsrsasign in pre-request JSR223 or
//       compute via web_custom_request to a local utility endpoint.
```

#### P1.2: Base64-Decode HAR Response Bodies

In `parseHar()`, check `content.encoding === "base64"` and decode with `atob()`:

```javascript
let respBodyRaw = (e.response.content && e.response.content.text) || "";
if (e.response.content && e.response.content.encoding === "base64" && respBodyRaw) {
    try {
        // Decode and check if it's readable text (JSON, HTML, XML)
        const decoded = atob(respBodyRaw);
        if (/[\x00-\x08\x0E-\x1F\x7F]/.test(decoded.substring(0, 100)) === false) {
            respBodyRaw = decoded; // readable text — use decoded
        }
    } catch (e) { /* keep raw if decode fails */ }
}
```

#### P1.3: Scan Auto-Followed Sub-Requests for Token Source

Currently `findValueBefore` skips `filtered` entries. But auto-followed redirects are NOT filtered — they just have `mjAutoFollowSet.has(idx) === true`. The token exchange response is often in an auto-followed chain.

Add to `findValueBefore` a mode to also scan responses of entries that are in `mjAutoFollowSet` (i.e., don't skip them — they contain real server responses).

#### P1.4: Detect and Correlate `access_token` Field Proactively

When a response body is JSON with `$.access_token`, automatically create a correlation even without seeing the value in a later request header — because we KNOW this will be used as a Bearer token.

### Priority 2 — Medium Impact

#### P2.1: SAML Assertion Correlation

**Trigger:** POST body contains `SAMLResponse=` or `SAMLRequest=` (base64-encoded XML).

**DevWeb/VuGen:** Boundary extractor on the redirect HTML form page.

#### P2.2: `x-fapi-auth-date` Timestamp Generation

**Trigger:** Header name matches `x-fapi-auth-date` or similar timestamp headers.

**DevWeb:**
```javascript
load.global.fapi_auth_date = new Date().toISOString().replace('T', 'T').split('.')[0] + 'Z';
```
**VuGen:**
```c
time_t now; struct tm *gmt; char ts[30];
time(&now); gmt = gmtime(&now);
strftime(ts, sizeof(ts), "%Y-%m-%dT%H:%M:%SZ", gmt);
lr_save_string(ts, "fapi_auth_date");
```

#### P2.3: Entity ID Correlation (POST → GET pattern)

**Trigger:** POST response JSON contains a field named `*Id`, `*id`, `*Ref`, `*ref`, `*Key` with a UUID-like value, AND a subsequent request URL contains that exact value as a path segment.

**Strategy:** In `singleHarCorrelate`, scan POST response bodies for UUID-valued fields. Check if any later request URL contains the value.

#### P2.4: Cookie-to-Header CSRF (XSRF-TOKEN → X-XSRF-TOKEN)

**Status:** Already detected by CSRF pattern in `singleHarCorrelate`. The fallback cookie-match code at lines 865-901 handles this.

**Verify:** This works when the `XSRF-TOKEN` cookie value equals the `X-XSRF-TOKEN` header value exactly.

### Priority 3 — Complete

#### P3.1: Postman/Bruno Converter — PKCE in pre-request scripts

Detect `pm.variables.set('code_verifier', ...)` or `bru.setVar('code_verifier', ...)` in pre-request scripts. These are Tier 1 Dynamic variables — add the PKCE generation block to `initialize()`.

#### P3.2: JMeter — PKCE in JSR223 scripts

Detect `SecureRandom`, `MessageDigest.getInstance("SHA-256")`, `Base64.getUrlEncoder().withoutPadding()` in BeanShell/Groovy. Generate PKCE equivalents.

---

## 8. Generation Code Reference — Both Protocols

### DevWeb (JavaScript)

```javascript
// ── UUID v4 ──────────────────────────────────────────────────────────────────
load.global.x_fapi_interaction_id = load.utils.uuid();
load.global.x_idempotency_key     = load.utils.uuid();
load.global.jti                   = load.utils.uuid();

// ── UUID-derived (no hyphens, truncated) ─────────────────────────────────────
load.global.endToEndId            = load.utils.uuid().replace(/-/g, '').substring(0, 31);
load.global.instructionId         = load.utils.uuid().replace(/-/g, '');
load.global.statementReference    = load.utils.uuid().replace(/-/g, '').substring(0, 18);

// ── CSRF / random hex (32 chars) ─────────────────────────────────────────────
load.global.csrf_token = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map(b => b.toString(16).padStart(2, '0')).join('');

// ── Unix timestamp ────────────────────────────────────────────────────────────
load.global.timestamp = String(Math.floor(Date.now() / 1000));

// ── ISO timestamp ─────────────────────────────────────────────────────────────
load.global.fapi_auth_date = new Date().toISOString().split('.')[0] + 'Z';

// ── PKCE (NOT YET IMPLEMENTED — planned P1.1) ─────────────────────────────────
const _bytes = crypto.getRandomValues(new Uint8Array(32));
load.global.code_verifier  = btoa(String.fromCharCode(..._bytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
const _hash = await crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(load.global.code_verifier));
load.global.code_challenge = btoa(String.fromCharCode(...new Uint8Array(_hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
```

### VuGen Web HTTP/HTML (C — globals.h helper functions)

```c
/* ── Already in globals.h (IMPLEMENTED) ──────────────────────────────────── */

/* UUID v4: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx */
static void gen_uuid(const char* paramName) {
    char buf[37];
    lr_param_sprintf("_uuid", "%08x-%04x-%04x-%04x-%012x",
        rand(), rand()&0xFFFF, rand()&0xFFFF, rand()&0xFFFF, (long)rand()<<16|rand());
    lr_save_string(lr_eval_string("{_uuid}"), paramName);
}

/* CSRF token: 32 hex chars (16 random bytes) */
static void gen_csrf_token(const char* paramName) {
    char buf[33]; int i;
    for(i=0;i<32;i++) buf[i]="0123456789abcdef"[rand()%16];
    buf[32]='\0';
    lr_save_string(buf, paramName);
}

/* 64-char hex (high-entropy nonce) */
static void gen_hex64(const char* paramName) {
    char buf[65]; int i;
    for(i=0;i<64;i++) buf[i]="0123456789abcdef"[rand()%16];
    buf[64]='\0';
    lr_save_string(buf, paramName);
}

/* ── Planned additions (Priority 2) ─────────────────────────────────────── */

/* ISO 8601 UTC timestamp: "2024-05-25T12:34:56Z" */
static void gen_iso_timestamp(const char* paramName) {
    time_t now; struct tm *gmt; char buf[25];
    time(&now); gmt = gmtime(&now);
    strftime(buf, sizeof(buf), "%Y-%m-%dT%H:%M:%SZ", gmt);
    lr_save_string(buf, paramName);
}

/* UUID without hyphens, first N chars */
/* Usage: gen_uuid_derived("endToEndId", 31) */
static void gen_uuid_derived(const char* paramName, int maxLen) {
    char full[33], trunc[33]; int i, j=0;
    for(i=0;i<32;i++) full[i]="0123456789abcdef"[rand()%16];
    full[32]='\0';
    for(i=0;i<32&&j<maxLen;i++) { if(full[i]!='-') trunc[j++]=full[i]; }
    trunc[j]='\0';
    lr_save_string(trunc, paramName);
}
```

---

## Appendix: Header Name Detection Patterns

These patterns trigger automatic generation logic across all tools:

### UUID Headers (→ `gen_uuid` / `load.utils.uuid()`)
```
x-fapi-interaction-id, x-request-id, x-idempotency-key,
x-correlation-id, x-trace-id, x-b3-traceid, x-b3-spanid,
jti, interaction_id, requestId, correlationId
```

### CSRF Hex Headers (→ `gen_csrf_token` / random hex)
```
x-csrf-token, x-xsrf-token, x-anti-forgery-token,
x-request-verification-token, csrfToken, _csrf
```
*Unless value found in earlier response → correlation instead*

### Timestamp Headers (→ `gen_iso_timestamp` / `Date.now()`)
```
x-fapi-auth-date, x-timestamp, x-request-timestamp,
x-date, x-api-date, timestamp, iat, exp
```

### PKCE Parameters (→ PKCE generation block — PLANNED)
```
code_verifier, code_challenge
```
*When BOTH appear in same HAR session — confirmed PKCE flow*

### Static Config Headers (→ Tier 2 Parameter, no generation)
```
x-fapi-financial-id, x-api-key, x-client-id,
x-tenant-id, x-app-id, x-consumer-key
```

---

*This document drives the implementation backlog for dynamic parameter handling.*  
*Cross-reference: `Docs/IMPLEMENTATION-REFERENCE.md` for current feature status.*  
*Generated: 2026-05-02*
