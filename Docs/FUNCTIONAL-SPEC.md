# LRE Toolkit — Functional Specification

> Describes what each tool does, what rules apply, what inputs are accepted,
> and what outputs are produced. For team members understanding tool behaviour.

---

## Contents

1. [Converter — Postman / Bruno](#1-converter--postman--bruno)
2. [Converter — JMeter (.jmx)](#2-converter--jmeter-jmx)
3. [Recorder — HAR Script Generator](#3-recorder--har-script-generator)
4. [Script Studio — Correlation Engine](#4-script-studio--correlation-engine)
5. [Output format rules — DevWeb](#5-output-format-rules--devweb)
6. [Output format rules — Web HTTP/HTML](#6-output-format-rules--web-httphtml)
7. [Authentication rules](#7-authentication-rules)
8. [Correlation rules](#8-correlation-rules)
9. [Parameterization rules](#9-parameterization-rules)
10. [Per-request dynamic variable generation](#10-per-request-dynamic-variable-generation)
11. [Proxy detection](#11-proxy-detection)

---

## 1. Converter — Postman / Bruno

### Purpose
Convert Postman or Bruno API collections into LoadRunner VuGen scripts (DevWeb or Web HTTP/HTML).

### Inputs

| Input | Format | Required |
|-------|--------|----------|
| Collection file | Postman v2.1 JSON, Bruno JSON, Bruno YAML, .bru | Yes |
| Environment file | Postman env JSON, Bruno env | No |

### Options

| Option | Default | Effect |
|--------|---------|--------|
| Output protocol | DevWeb | DevWeb JS or Web HTTP/HTML C |
| Mode | Single | Single script or one script per folder |
| Use transactions | Yes | Wraps each request in LR transaction |
| Use correlation | Yes | Detects and generates extractor code |
| Use parameterization | Yes | Classifies variables into parameter files |
| Use authentication | Yes | Generates auth code (OAuth2, JWT, etc.) |
| Think time | 1s | Pause between requests |
| Add comments | Yes | Inline comments in generated script |
| Log level | info | Script runtime log level |

### Processing order

1. Parse collection file (format auto-detected)
2. Parse environment file (if provided)
3. Detect NTLM/Kerberos (must run before variable classification)
4. Detect correlation targets (2-pass)
5. Classify variables into 3 tiers
6. Detect authentication type
7. Detect JWT usage
8. Detect proxy configuration
9. Detect per-request dynamic variables (UUID, CSRF)
10. Generate main script file
11. Generate mandatory config files
12. Write all files via memoryFsInterceptor

### Request structure in generated script

Each HTTP request generates (in order, DevWeb):
```js
T01.start();
const _headers = { ... };        // per-request headers
// web_reg_save_param equiv:
const extractor = new load.JsonPathExtractor("varName", "$.path");
const response = await load.WebRequest.post("url")
  .body("...")
  .headers(_headers)
  .addExtractor(extractor)
  .send();
const varName = response.extractors["varName"];
load.global.varName = varName;
T01.stop();
```

### Multi-script mode
- Each top-level folder in Postman becomes a separate script
- Each Thread Group in JMeter becomes a separate script
- Output ZIP contains one subdirectory per script
- `scenarios.yml` (DevWeb) and `.usr` files (both) are generated per script

---

## 2. Converter — JMeter (.jmx)

### Purpose
Convert Apache JMeter test plans into LoadRunner VuGen scripts.

### Inputs

| Input | Format | Required |
|-------|--------|----------|
| JMX file | Apache JMeter `.jmx` (XML) | Yes |
| CSV files | Any `.csv` files referenced by CSVDataSet | No (up to 30) |
| Certificate files | `.pem`, `.p12`, `.pfx` etc. | No (up to 10) |

### Supported JMeter elements

| JMeter Element | Converted to |
|----------------|--------------|
| ThreadGroup | VuGen action() |
| SetupThreadGroup | VuGen initialize() / vuser_init.c |
| TearDownThreadGroup | VuGen finalize() / vuser_end.c |
| HTTPSamplerProxy | HTTP request |
| HeaderManager | Request headers |
| CSVDataSet | Parameter files (Tier 3 test data) |
| JSONPathExtractor | JSON path extractor |
| XPath2Extractor | XPath extractor |
| RegexExtractor | Boundary extractor |
| BoundaryExtractor | Boundary extractor |
| JSR223Sampler (JWT) | JWT generation code |
| JSR223Sampler (other) | TODO comment block |
| LoopController | Ignored (VuGen handles iterations) |
| TransactionController | Named transaction wrapper |

### Additional output (JMX only)
When `generateWlmExcel: true` (default), a Workload Model Excel file (`.xlsx`) is included in the ZIP summarizing thread group configurations.

---

## 3. Recorder — HAR Script Generator

### Purpose
Convert a browser HAR recording into a VuGen script, for use when VuGen's built-in recording is unavailable (VCSE machines, corporate proxy restrictions).

### Inputs

| Input | Format | Notes |
|-------|--------|-------|
| HAR file | Standard HAR 1.2 JSON | From Chrome/Firefox DevTools |
| NetLog JSON | Chrome `chrome://net-export/` format | Alternative to HAR |

### Processing steps

1. Parse HAR/NetLog — extract all HTTP entries
2. Normalise entries (method, URL, request headers, request body, response headers, response body)
3. Identify static assets (images, CSS, JS, fonts) — filtered by default
4. Extract unique domains — shown in domain filter panel
5. User selects domains to include / exclude
6. User groups requests into named transactions (optional)
7. Generate script for selected format

### Filtering defaults

Automatically filtered out (can be re-enabled via toolbar):
- Static assets: images (`.jpg`, `.png`, `.gif`, `.svg`, `.ico`), CSS, fonts, JS bundles
- OPTIONS preflight requests (can be toggled)
- Analytics domains (can be toggled)

### Script generation rules

- Each included request becomes one HTTP call
- Request headers from HAR are included (excluding browser-specific headers: `sec-*`, `origin`, `accept-encoding`)
- Request bodies are included verbatim
- Correlation: basic pattern-based extraction only (Recorder does not perform deep correlation — use Script Studio for that)
- Transaction boundaries: mapped from user-defined groups

### Output

One ZIP file containing the complete VuGen script package for the chosen format.

---

## 4. Script Studio — Correlation Engine

### Purpose
Generate deeply correlated VuGen scripts from 1 or 2 HAR files. The primary tool for scripts that require reliable dynamic value handling (login tokens, session IDs, CSRF tokens, ViewState, etc.).

### Inputs

| Input | Required | Notes |
|-------|----------|-------|
| HAR file 1 | Yes | First recording of the user journey |
| HAR file 2 | No | Second recording (same journey, different data) |

### Mode selection (automatic)

| HARs uploaded | Mode | Method |
|---------------|------|--------|
| 1 HAR | Advisor mode | Correlation Advisor (Phase 1 response scan → Phase 2 cross-reference → Phase 2.5 CSRF name scan → Phase 3 pattern scan) |
| 2 HARs | Diff mode | Cross-recording comparison |

### Advisor mode (1 HAR) — what it detects

The Correlation Advisor runs four phases and uses the Advisor panel for user confirmation:

| Pattern type | Detection method | Examples |
|--------------|-----------------|---------|
| UUID v4 | Pattern scan (Phase 3) | `550e8400-e29b-41d4-a716-446655440000` |
| JWT tokens | Pattern scan (Phase 3) | `eyJ...` (three base64 segments) |
| Long hex tokens | Pattern scan (Phase 3) | 32+ char hex strings |
| Long base64 values | Pattern scan (Phase 3) | 40+ char base64 strings |
| Unix timestamps | Pattern scan (Phase 3) | 10-digit numeric values |
| CSRF / anti-forgery tokens | Phase 2.5 name-pattern scan | `authenticity_token`, `csrf_token`, `__RequestVerificationToken`, and 11 more well-known field names |
| Dynamic response values | Phase 2 cross-reference | Any JSON response value appearing in a later request |

**Phase 2.5 CSRF scan (single-HAR mode):** Scans each request's form body for fields whose name matches a built-in list of 14 CSRF field name patterns. When a match is found, the preceding response bodies (including HTML pages) are backward-searched for the token value. This detects CSRF tokens even when the source HTML page is filtered as a Document-type navigation request — previously these were only detectable in two-HAR diff mode.

### Diff mode (2 HARs) — what it detects

Compares HAR 1 responses against HAR 2 responses entry by entry:
1. Finds all values in HAR 1 responses that also appear in subsequent HAR 1 requests (i.e. are "consumed")
2. Checks if those same values differ in HAR 2
3. If different → confirmed dynamic → generates extraction + substitution code

This catches everything that pattern mode catches, plus:
- Application-specific IDs that don't look "random"
- Short tokens that wouldn't match pattern heuristics
- ViewState, nonce values, anti-CSRF fields

### Correlation code generated

For each detected dynamic value:

| Extraction source | DevWeb | VuGen |
|------------------|--------|-------|
| JSON response body | `load.JsonPathExtractor` | `web_reg_save_param_json` |
| XML/HTML response | `load.XpathExtractor` | `web_reg_save_param_xpath` |
| Response header | `load.BoundaryExtractor` (Headers scope) | `web_reg_save_param` (Search=Headers) |
| Cookie | `load.BoundaryExtractor` (Headers scope) | `web_reg_save_param` (Search=Headers) |
| Boundary (arbitrary) | `load.BoundaryExtractor` | `web_reg_save_param` |

### Parameterization candidates

Script Studio identifies fields that should be parameterized (fed from a data file at runtime). It looks for:
- Login form fields (username, password, email, login)
- Search fields
- Payment fields (card number, amount)
- User-settable profile fields

Known credential fields (matching the `PARAM_KEYS_MAP` patterns: `username`, `login`, `email`, `password`, `creditCard`, etc.) are **always parameterized** — even when the same value also appears as a correlation target. This ensures multi-user load tests substitute the correct per-VU credential instead of a hardcoded or correlated value.

**Epoch timestamp substitution:** When a request body contains a 13-digit millisecond epoch timestamp that matches the HAR recording time within a 1-day window, the generated script replaces the hardcoded value with `Date.now()` (current time at runtime). For timestamps more than 1 day in the past relative to the recording, `getEpochMsDaysAgo(N)` is emitted with the correct day offset.

### Authentication detection

Detects from HAR response headers and request patterns:
- Bearer token usage → correlated automatically
- Basic Auth → credentials parameterized
- Cookie-based sessions → session cookie correlated
- NTLM challenges → `web_set_user` / `load.setUserCredentials` generated

### Output

One ZIP file per format chosen (DevWeb or Web HTTP/HTML). Contains complete script package including correlation registrations, extracted variable usage, and parameter files.

---

## 5. Output Format Rules — DevWeb

### main.js structure rules

1. All `import` statements first
2. All `const T01 = new load.Transaction(...)` declarations at module scope (BEFORE `initialize()`)
3. `initialize()` function — runs once per virtual user:
   - OAuth2 token fetch
   - JWT initialization (if JWT auth)
   - NTLM credentials (`load.setUserCredentials`)
4. `action()` function — runs each iteration:
   - Transaction `.start()` → HTTP request(s) → Transaction `.stop()`
   - Extractors declared before requests via `.addExtractor()`
5. `finalize()` function — runs once after all iterations

### Variable usage in main.js

| Tier | Usage pattern |
|------|--------------|
| Tier 1 Dynamic | `load.global.varName` (read/write) |
| Tier 2 Config | `load.params.varName` (read-only, next value: once) |
| Tier 3 Test Data | `load.params.varName` (read-only, next value: iteration) |

### Header generation

Headers that appear in every request are NOT deduplicated into a global — each request gets its own `const _headers = {}` block. This is intentional: per-request headers may include dynamic values that must be re-evaluated each time.

### Think time

Generated as `await load.thinkTime(N)` after each transaction `.stop()`.

---

## 6. Output Format Rules — Web HTTP/HTML

### File structure

| File | Contains |
|------|---------|
| `vuser_init.c` | `vuser_init()` — runs once: token fetch, NTLM setup |
| `Action.c` | `Action()` — runs per iteration: all HTTP requests |
| `vuser_end.c` | `vuser_end()` — runs once: cleanup |
| `globals.h` | `#include` of LR headers + shared static functions |

### C code rules

- Variable declarations at TOP of function (C89)
- `web_reg_save_param_*()` called BEFORE the request that produces the value
- `web_add_header()` applies to next request only — not global
- Bodies > 500 chars use `BodyFilePath=` (supports `{param}` substitution)
- `"Snapshot=t%d.inf"` before `"Mode=HTML"` in every request call (counter starts at 1)
- Transaction calls: `lr_start_transaction("T01_Name")` and `lr_end_transaction("T01_Name", LR_AUTO)`

### ParameterFile.prm format

```ini
[parameter:username]
Dat=user1,user2,user3,
Select=Sequential
GenerateNewVal=EachIteration

[parameter:baseUrl]
Dat=https://app.example.com,
Select=Sequential
GenerateNewVal=Once
```

---

## 7. Authentication Rules

### Detection order

1. Check collection/request `auth` field (Postman/Bruno explicit auth)
2. Check for `Authorization` header in requests
3. Check for OAuth2 token endpoints in requests
4. Check pre/post scripts for auth logic

### Supported types and what is generated

| Type | Detection | initialize() / vuser_init.c | Per-request |
|------|-----------|---------------------------|-------------|
| OAuth2 Client Credentials | `grant_type=client_credentials` | Token POST, store token | Bearer header with dynamic token |
| OAuth2 Password | `grant_type=password` | Token POST, store token | Bearer header with dynamic token |
| Basic Auth | `auth.basic` or `Authorization: Basic` | — | `btoa(user:pass)` or `web_add_header` |
| Bearer (dynamic) | Token variable set by script | — | Header with `load.global.tokenVar` |
| Bearer (static) | Hard-coded token string | — | Header with param value |
| API Key (header) | `auth.apikey` + `in: header` | — | Header injection |
| API Key (query) | `auth.apikey` + `in: query` | — | Query parameter injection |
| JWT | Script fingerprint | JWT generation code (all 12 RFC 7518 algs: HS256/384/512, RS256/384/512, PS256/384/512, ES256/384/512) | `Authorization: Bearer <generated>` |
| AWS Sig v4 | `auth.awsv4` | — | AWS signing headers |
| Digest | `auth.digest` | — | Digest challenge-response |
| NTLM | `auth.ntlm` | `load.setUserCredentials()` or `web_set_user()` | — |
| Kerberos | `auth.negotiate` | Same as NTLM | — |

### NTLM/Kerberos parameter names

Always uses fixed parameter names regardless of variable names in the collection:
- `username` (Tier 3 test data)
- `password` (Tier 3 test data)
- `domain` (Tier 2 config)

Host: hostname only, no port (`app.example.com` not `app.example.com:8443`).

---

## 8. Correlation Rules

### What is correlated automatically

Any variable that is:
- Set by a script (`bru.setEnv`, `pm.environment.set`, etc.) AND
- The script also reads from the response (`res.body.field`, `res.headers["x"]`, etc.)

Plus:
- Variables with names matching known dynamic patterns (token, id, session, nonce, state, code, etc.)
- Variables set with empty/null values in the collection (safety net)

### What is NOT correlated

- Variables with `$` prefix (Postman built-ins: `$guid`, `$timestamp`, `$randomEmail`)
- Variables matching private/crypto key patterns
- Variables in static headers that don't change per request
- Constants hard-coded in scripts (not assigned from response)

### Extractor placement

In DevWeb: extractors are attached to the request that produces the value via `.addExtractor()`.
In VuGen: `web_reg_save_param_*()` is placed BEFORE the producing request.

---

## 9. Parameterization Rules

### Tier 1 — Dynamic (global variable)
Not parameterized. Managed via `load.global` (DevWeb) or `lr_param_sprintf` (VuGen).

### Tier 2 — Config (read once per test run)
- Base URLs, API keys, client IDs, tenant IDs, host names
- Generated as `GenerateNewVal=Once` in ParameterFile.prm
- In `collection_data.csv`: one value column, no iteration

### Tier 3 — Test Data (read once per iteration)
- Usernames, passwords, emails, account numbers, test IDs
- Generated as `GenerateNewVal=EachIteration`
- Multiple rows supported for load testing with multiple data sets

### Credential detection heuristics

A variable is classified as a credential (Tier 3) if its name contains any of:
`password`, `passwd`, `pwd`, `secret`, `token` (when not a dynamic set var), `apikey`, `api_key`, `username`, `user_name`, `login`, `email`, `email_address`, `account`, `credential`

---

## 10. Per-Request Dynamic Variable Generation

Some HTTP headers require a fresh unique value on every request. These cannot be read from a parameter file (which returns the same value per iteration). The toolkit generates inline code for these.

### UUID / GUID headers

Detected headers: `x-request-id`, `x-correlation-id`, `x-trace-id`, `interaction-id`, `requestId`, `correlationId`, `jti`

**DevWeb:** `load.utils.uuid()` inlined in the header value:
```js
'x-request-id': load.utils.uuid()
```

**VuGen (`globals.h`):**
```c
static void gen_uuid(char* _param) {
  // generates UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
  lr_param_sprintf(_param, ...);
}
```

### CSRF tokens

Detected headers: `x-csrf-token`, `x-xsrf-token`, `x-xsrf-header`, `csrfToken`

Generated as boundary extractor from the previous response that set the CSRF cookie/header, then re-injected into subsequent requests.

**VuGen (`globals.h`):**
```c
static void gen_csrf_token(char* _param) { /* 32-char hex */ }
static void gen_hex64(char* _param)      { /* 64-char hex */ }
```

---

## 11. Proxy Detection

Both generators (`advancedScriptGenerator.js` and `webHttpScriptGenerator.js`) run `detectProxyConfig()` which scans `this.variableMap` for proxy-related variables.

### Detected variable names

`proxy`, `proxyUrl`, `proxy_url`, `http_proxy`, `HTTP_PROXY`, `proxyServer`, `proxyHost` + `proxyPort`

### Supported formats

| Format | Example |
|--------|---------|
| Full URL | `http://user:pass@proxy.corp.com:8080` |
| Host:port | `proxy.corp.com:8080` |
| Separate vars | `proxyHost=proxy.corp.com`, `proxyPort=8080` |

### Output

**DevWeb (`rts.yml`):**
```yaml
proxy:
  http:  http://proxy.corp.com:8080
  https: http://proxy.corp.com:8080
```

**VuGen (`default.cfg`):**
```ini
[WEB]
ProxyHTTPHost=proxy.corp.com
ProxyHTTPPort=8080
ProxyHTTPUserName=user
ProxyHTTPPassWord=pass
```

When no proxy is detected: proxy section remains disabled (no change from default template).
