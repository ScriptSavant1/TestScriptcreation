# LRE Toolkit — Correlation Engine

**Version:** 2.9.2 | **Date:** May 2026

---

## What is Correlation?

Correlation is the process of:
1. Detecting a value in a server **response** that will be needed in a later **request**
2. Generating code to **extract** that value at runtime
3. Substituting the hard-coded recorded value with the **dynamic variable reference**

Without correlation, a replay script sends the same token/ID that was recorded — which is invalid by the time the test runs again.

---

## Two Strategies

The toolkit uses two distinct correlation strategies depending on available inputs:

| Strategy | When used | Inputs | How it works |
|---|---|---|---|
| **Two-HAR diff (VBAC)** | Studio, 2 recordings | HAR1 + HAR2 | Compares same-index requests across both runs; any value that differs = dynamic |
| **Single-HAR pattern** | Studio (1 HAR), Converter | HAR1 only | Pattern recognition (UUID, JWT, entropy scoring) + source tracing |

---

## Strategy 1: Two-HAR (Value-Based Auto-Correlation)

### Algorithm

```
For each request index i in entries1[]:
    For each candidate value (header, body field, query param):
        
        1. isDynamic(value):
           - Is it a UUID (8-4-4-4-12 hex)?
           - Is it a JWT (3 base64url segments)?
           - Is it long (>20 chars) and high entropy?
           - Is it a timestamp-like number?
           → If no: skip (static value, no need to correlate)
        
        2. entries2[i] has a DIFFERENT value for the same field?
           → If same: it's static (hard-coded, no correlation needed)
           → If different: it IS dynamic → must be correlated
        
        3. Find source: scan ALL responses in entries1[] at index < i
           For each response:
             - Try JSON path extraction
             - Try XPath extraction
             - Try boundary extraction
             - Try header extraction
             - Try cookie extraction
           → First match → record extractor type + path + source index
        
        4. If source found: add correlation with extractor
           If source NOT found AND value looks like Bearer token:
             → add to S.candidates (unresolved — generates TODO comment)
```

### isDynamic() Scoring

A value scores as dynamic if it matches ANY of:
- UUID pattern: `[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}`
- JWT pattern: 3 segments of base64url characters separated by `.`
- High-length alphanumeric (>20 chars, mixed case + digits, entropy > threshold)
- Base64url-looking string (>32 chars)
- Pure digit string that looks like a Unix timestamp (10-13 digits)

Static values that fail all these → not correlated even if they differ between runs.

---

## Strategy 2: Single-HAR Pattern Correlation

### How it works

```
For each response in entries1[]:
    Scan body for dynamic-looking values using isDynamic()
    
    For each dynamic value found:
        Check: does ANY subsequent request USE this value?
        
        - Search request headers, bodies, query params
        - If match found: build extractor + substitution
```

### Unresolved Candidates

Some Bearer tokens pass `isDynamic()` but cannot be traced to a source response (e.g. they were obtained in a previous session before the recording started, or they come from a redirect not captured in the HAR). These become `S.candidates`:

```javascript
// Generated TODO placeholder in script:
// TODO: Correlate Bearer token — could not find source in HAR.
// The value 'eyJ0eXAiOiJKV1QiL...' was used in request 5 (Authorization header)
// but its source response was not found. Add manual extraction here.
```

---

## Extractor Types

### JSON Path (`web_reg_save_param_json` / JSONPath)

Used for JSON API responses.

**VuGen:**
```c
web_reg_save_param_json("access_token",
    "QueryString=$.access_token",
    LAST);
```

**DevWeb:**
```javascript
load.global.access_token = JSON.parse(response.body).access_token;
```

### XPath (`web_reg_save_param_xpath`)

Used for XML/SOAP responses.

**VuGen:**
```c
web_reg_save_param_xpath("session_id",
    "QueryString=//session/@id",
    "SelectAll=Yes",
    LAST);
```

Note: VuGen XPath uses `QueryString=` (not `XPath=`), `SelectAll=Yes` (not `Ord=`).

### Boundary (`web_reg_save_param`)

Used for HTML forms and mixed content where JSON/XPath don't apply.

**VuGen:**
```c
web_reg_save_param("csrf_token",
    "LB=name=\"_token\" value=\"",
    "RB=\"",
    "Ord=1",
    "Search=Body",
    LAST);
```

### Regular Expression (`web_reg_save_param_regexp`)

Used when a specific pattern uniquely identifies the value.

**VuGen:**
```c
web_reg_save_param_regexp("session_id",
    "RegExp=sessionId\":\"([^\"]+)\"",
    "Group=1",
    "Ordinal=1",
    LAST);
```

Note: uses `Group=` (0-10), `Ordinal=` (not `Ord=`), optional `Scope=`.

### Header (`web_reg_save_param_regexp` with header scope)

Used when the value is returned in a response header.

**VuGen:**
```c
web_reg_save_param_regexp("location",
    "RegExp=^(.+)$",
    "Group=1",
    "Scope=Headers",
    LAST);
```

### Cookie

Used for session cookies.

**DevWeb:**
```javascript
const cookieJar = response.headers['set-cookie'];
load.global.session_cookie = parseCookie(cookieJar, 'SESSIONID');
```

---

## Deduplication

`generateCorrelationRegistrations()` only emits ONE extractor per variable name, even if multiple requests use the same dynamic value. The first occurrence's extractor is emitted; subsequent uses just reference the already-extracted variable.

---

## Special Cases

### PKCE

PKCE values (`code_verifier`, `code_challenge`) are flagged with `extractorType: "pkce"` and `sourceIdx: -1`. These appear in the body/URL substitution engine (replacing the recorded value with `{pkce_challenge}` etc.) but **never emit** a `web_reg_save_param` extractor. See [PKCE Guide](PKCE-GUIDE.md).

### DPoP Nonce

DPoP nonce is returned in the `DPoP-Nonce` response header. It's auto-correlated as a header extractor and injected into the proof generation call as the nonce parameter.

### Redirect Chains

HTTP 3xx redirects are detected and excluded from correlation analysis. The Location header value is correlated only if it's used in a subsequent non-redirect request as a base URL.

### Query String Fallback

When a correlation's `extractPath === '$'` (root JSON), the extractor falls back to `$.corrBase` (the actual root key name) to avoid extracting the entire response body as a string.

---

## DYNSTART / DYNEND Markers

During body/URL injection, the toolkit uses internal substitution markers:

```
\x00DYNSTART_VarName\x00DYNEND
```

These are placeholder tokens inserted into the request body/URL during analysis. The generators then expand them to the appropriate runtime syntax:

- DevWeb: `${load.global.VarName}` (template literal in JS)
- VuGen: `{VarName}` (LR parameter syntax)
- DevWeb query string: object key `VarName` with value from `load.global.VarName`

This two-phase approach allows the analyzers to work with a neutral representation that both generators then translate.

---

## corrUsages and corrSourcesRemap

Two key data structures drive code generation:

```javascript
// corrUsages: Map<reqIdx, [{varName, location, key, ...}]>
// Used by generators to know: "for request N, substitute these values"
corrUsages.set(3, [
    { varName: 'access_token', location: 'header', key: 'Authorization', bearerPrefix: 'Bearer ' }
]);

// corrSourcesRemap: Map<sourceIdx, [correlationObj]>
// Used by generators to know: "before request N, emit these extractors"
corrSourcesRemap.set(1, [
    { name: 'access_token', extractorType: 'json', extractorConfig: { path: '$.access_token' } }
]);
```

---

## Correlation in the Converter (vs Studio)

The Converter uses `correlationDetector.js` which implements a **2-pass server-side approach**:

**Pass 1 (collection traversal):** Scans all requests for variable references (`{{varName}}`, `{varName}`) and cross-references them with known variable values to identify which are dynamic.

**Pass 2 (script analysis):** Runs `customScriptParser` on all pre/post-request scripts to find script-set variables (variables set programmatically, e.g. `pm.environment.set('token', ...)`).

This is different from the Studio's HAR-based approach (which has actual response bodies to analyze).

---

*See also: [Auth Guide](AUTH-GUIDE.md) | [PKCE Guide](PKCE-GUIDE.md) | [DPoP Guide](DPOP-GUIDE.md) | [Developer Guide](DEVELOPER-GUIDE.md)*
