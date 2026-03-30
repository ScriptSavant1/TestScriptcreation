# Bruno / Postman / JMeter to LoadRunner Converter — Full Functionality Reference

> **Version:** 2.8.x (branch: Jmeter)
> **Last updated:** 2026-03-30 (UUID/GUID header handling — v2.8.1)
> **Protocols supported:** DevWeb (JavaScript) · VuGen Web HTTP/HTML (C)

---

## Table of Contents

1. [Supported Input Formats](#1-supported-input-formats)
2. [Supported Output Protocols](#2-supported-output-protocols)
3. [JMX Conversion Pipeline](#3-jmx-conversion-pipeline)
4. [Bruno / Postman Conversion Pipeline](#4-bruno--postman-conversion-pipeline)
5. [Variable Classification — 3-Tier System](#5-variable-classification--3-tier-system)
6. [Correlation and Extraction System](#6-correlation-and-extraction-system)
7. [Authentication Handling](#7-authentication-handling)
8. [Parameterization Engine](#8-parameterization-engine)
9. [Transaction Naming](#9-transaction-naming)
10. [Think Time Handling](#10-think-time-handling)
11. [Proxy Auto-Detection](#11-proxy-auto-detection)
12. [JWT Detection and Handling](#12-jwt-detection-and-handling)
13. [Custom Script Conversion](#13-custom-script-conversion)
14. [Request Body Handling](#14-request-body-handling)
15. [URL Handling Rules](#15-url-handling-rules)
16. [DevWeb Generated Files](#16-devweb-generated-files)
17. [VuGen Web HTTP/HTML Generated Files](#17-vugen-web-httphtml-generated-files)
18. [Workload Modelling Excel](#18-workload-modelling-excel)
19. [Web Server Privacy Model](#19-web-server-privacy-model)
20. [Known Limitations](#20-known-limitations)

---

## 1. Supported Input Formats

| Format | How it is detected | Parser used |
|---|---|---|
| Postman Collection v2.1 `.json` | `info.schema` URL present in the JSON | `parseJSON()` in brunoParser |
| Bruno JSON export `.json` | `items[]` array present, no `info.schema` | `parseJSON()` in brunoParser |
| Bruno Single YAML `.yml` / `.yaml` | File has `.yml` or `.yaml` extension | `parseBrunoYamlCollection()` → `traverseBrunoYamlItems()` |
| Bruno YAML folder | Path is a directory | `parseBrunoYamlCollection()` → `walkBrunoYamlDir()` walks the folder tree |
| Single `.bru` file | `.bru` extension | `parseBru()` |
| JMeter `.jmx` | Explicit JMX conversion route | `jmxParser.js` |

All non-JMX formats are normalized to the same internal request structure before reaching the generators. Postman and Bruno use different script storage locations:
- **Postman**: scripts live in `item.event[]`
- **Bruno JSON export**: scripts live in `item.script.req` (pre-request) and `item.script.res` (post-response)
- **Bruno YAML**: scripts live in `req.tests[]`

The parser normalizes all three formats so generators always find scripts in `req.tests[]` with a fallback to `req.event[]`.

---

## 2. Supported Output Protocols

### DevWeb (JavaScript)
- Target file: `main.js`
- Script structure: ES module-style with `initialize()`, `action()`, `finalize()` lifecycle functions
- All declarations at module level; no `var` inside lifecycle functions
- Uses the `load.*` API (LoadRunner DevWeb JavaScript SDK)

### VuGen Web HTTP/HTML (C)
- Target files: `vuser_init.c`, `Action.c`, `vuser_end.c`, `globals.h`
- Language: C89 — all variable declarations must be at the top of each function before any statements
- Uses `web_*` and `lr_*` C API functions
- `globals.h` contains all declared variables so they are visible across all three C files

---

## 3. JMX Conversion Pipeline

### 3.1 Thread Group Types

The JMX parser recognizes all standard JMeter thread group variants and stamps every request and standalone script with a `threadGroupType`:

| JMeter element | `threadGroupType` value | Generated section |
|---|---|---|
| `ThreadGroup` | `Standard` | `action()` / `Action.c` |
| `SetUpThreadGroup` | `SetUp` | `initialize()` / `vuser_init.c` |
| `TearDownThreadGroup` | `TearDown` | `finalize()` / `vuser_end.c` |
| `kg.apc.jmeter.threads.SteppingThreadGroup` | `Stepping` | `action()` / `Action.c` |
| `UltimateThreadGroup` | `Ultimate` | `action()` / `Action.c` |
| `com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroup` | `Concurrency` | `action()` / `Action.c` |
| `com.blazemeter.jmeter.threads.arrivals.ArrivalsThreadGroup` | `Arrivals` | `action()` / `Action.c` |

SetUp thread group HTTP requests are routed to `initialize()` / `vuser_init.c`. TearDown requests go to `finalize()` / `vuser_end.c`. This ensures the LoadRunner script lifecycle mirrors the JMeter test plan structure.

### 3.2 Single vs Multi Script Mode

**Single mode** (default): All thread groups are merged into one script. SetUp/TearDown requests go to their lifecycle sections; all standard TG requests go to `action()`.

**Multi mode**: One sub-directory per thread group is created, each containing a complete standalone script. SetUp/TearDown TGs still produce scripts but their HTTP traffic goes to the lifecycle section, leaving `action()` empty. CSVDataSets are scoped per thread group — a CSV that belongs to TG-A is not included in TG-B's `parameters.yml`.

### 3.3 JSR223 / BeanShell Standalone Samplers

JMeter JSR223 and BeanShell samplers that appear directly in a thread group (not as pre/post processors on a request) are called "standalone scripts". They are:
- Collected and stamped with `threadGroupType`
- Converted into a single-line `// TODO: JSR223/BeanShell sampler — convert manually` comment placed in the appropriate lifecycle section
- They do NOT generate executable code because JSR223 may invoke Java APIs unavailable in LoadRunner

### 3.4 CSV DataSets

`CSVDataSetConfig` elements in the JMX are parsed into `csvDataSets[]`, each capturing:
- `filename` — path to the CSV file (resolved from JMX variables if needed, see §3.5)
- `variableNames` — comma-separated column headers
- `delimiter` — column separator (default `,`)
- `threadGroupIndex` — which thread group owns this CSV (`-1` = shared across all)

If `variableNames` is blank, the converter auto-reads the first row of the uploaded CSV file to discover column headers (mirrors JMeter's own behaviour).

CSV column variables are injected into `environmentVars` as empty strings so the 3-tier classifier (§5) assigns them to Tier 3 (iteration parameters), never Tier 1 dynamic.

### 3.5 CSV Filename Resolution

JMeter tests often make CSV paths configurable via User Defined Variables:
```
UDV:       csvFile1 = "users.csv"
CSVDataSet: filename = "${csvFile1}"   → parsed as "{{csvFile1}}"
```
`resolveCsvFilenames()` replaces `{{csvFile1}}` with `users.csv` before any further processing.

### 3.6 JMX Collection Variable Filtering

Three categories of JMeter-internal variables are removed from the collection before classification so they never appear in `parameters.yml` or `ParameterFile.prm`:

- **CSV path variables** — value ends in `.csv` (e.g. `csvFile1=users.csv`)
- **JMeter execution properties** — `nrThreads`, `rampUp`, `duration`, `loopCount`, etc.
- **Row-count patterns** — `lines1`, `lineCount`, `rowCount`, `records1`, etc.

### 3.7 Extractor Type Mapping

The JMX parser reads all JMeter extractor elements and records the original extractor type. Each generator then maps this to the native LoadRunner equivalent:

| JMeter extractor | Internal `type` | DevWeb extractor | VuGen C function |
|---|---|---|---|
| `RegexExtractor` | `regex` | `new load.RegexpExtractor(name, pattern, matchNo)` | `web_reg_save_param_regexp(...)` |
| `JSONPathExtractor` / `JMESPathExtractor` | `jsonpath` | `new load.JsonPathExtractor(name, path)` | `web_reg_save_param_json(...)` |
| `BoundaryExtractor` | `boundary` | `new load.BoundaryExtractor(name, lb, rb)` | `web_reg_save_param(... LB=, RB=...)` |
| `XPathExtractor` | `xpath` | `new load.XPathExtractor(name, xpathExpr)` | `web_reg_save_param_xpath(... QueryString=...)` |
| `XPath2Extractor` | `xpath` | `new load.XPathExtractor(name, xpathExpr)` | `web_reg_save_param_xpath(... QueryString=...)` |
| `HtmlExtractor` (CSS) | mapped to `boundary` at parse time | `new load.BoundaryExtractor(...)` | `web_reg_save_param(...)` |

**Key rules:**
- JMeter regex uses `$1$` group capture syntax; VuGen uses `Group=1` parameter instead — the pattern itself is preserved as-is.
- If a JSONPath expression is missing or empty, the converter generates `$.variableName` as a safe fallback.
- If an XPath expression is missing, the converter generates `//variableName` as a safe fallback.
- If no explicit matchNumber is set, `1` (first match) is used for all extractor types.
- CSS selector extractors have no native LoadRunner equivalent and fall back to boundary extraction.

### 3.8 Scope Mapping

JMeter's `useHeaders` field on extractors is mapped to the correct VuGen scope parameter:

| JMeter scope | VuGen `web_reg_save_param` `Search=` | VuGen `web_reg_save_param_regexp` `Scope=` | DevWeb `ExtractorScope` |
|---|---|---|---|
| `body` (default) | omitted | omitted | omitted (default Body) |
| `response_headers` | `Headers` | `Headers` | `load.ExtractorScope.Headers` |
| `request_headers` | `Headers` | `Headers` | `load.ExtractorScope.Headers` |
| `url` | omitted | omitted | omitted |
| `all` | `ALL` | `All` | omitted |

### 3.9 Per-Request Proxy

Each `HTTPSamplerProxy` can override the global proxy via the "Advanced" tab. When detected, the per-request proxy is stored on the request object and injected into the generator's proxy configuration.

### 3.10 Scoped Defaults

Thread-group-level `ConfigTestElement` (HTTP Request Defaults) applies only to requests within that thread group. The parser prevents defaults from one thread group from bleeding into sibling groups.

### 3.11 Think Time

`ConstantTimer` and `UniformRandomTimer` elements inside a thread group are converted to think time values. The parser accumulates pending think-time from timers and assigns it to the next `HTTPSamplerProxy` in sequence.

---

## 4. Bruno / Postman Conversion Pipeline

### 4.1 Parsing

The `brunoParser` normalizes all input formats to a common `requests[]` array. Each request object contains:
- `name`, `method`, `url` (raw string, never parsed with `new URL()`)
- `headers[]` — array of `{key, value, enabled}`
- `body` — `{mode, raw, formdata[], urlencoded[]}`
- `auth` — authentication config
- `tests[]` — post-response scripts (normalized from event[], script.res, or req.tests[])
- `preScripts[]` — pre-request scripts (normalized from event[], script.req)

### 4.2 Collection and Environment Variables

Collection-level variables become the `variableMap` inside generators. An optional environment file (Postman/Bruno JSON format) can be provided — its values override collection variables.

### 4.3 Folder Structure

Bruno YAML folder scans directories recursively, ordering requests by filename. Postman and Bruno JSON preserve the `items[]` order including nested folder items.

---

## 5. Variable Classification — 3-Tier System

Every variable found in the collection is classified into exactly one tier. Classification runs inside `classifyVariables()` which is duplicated in both generators (`advancedScriptGenerator.js` and `webHttpScriptGenerator.js`).

`parameterizationEngine.js` is a **raw value scanner only** — it does NOT perform 3-tier classification. It scans request bodies and URLs for patterns (emails, UUIDs, tokens, etc.) to suggest parameterization candidates.

### 5.1 The Three Tiers

| Tier | DevWeb | VuGen | Purpose |
|---|---|---|---|
| **Tier 1 — Dynamic** | `load.global.varName` | `{_varName}` parameter / `lr_eval_string()` | Runtime-generated values: tokens, session IDs, correlation targets, script-set variables |
| **Tier 2 — Config** | `load.params.varName` with `nextValue: once` | LR parameter `GenerateNewVal=Once` | Static config: base URLs, API keys, client IDs — read once per test run |
| **Tier 3 — Test Data** | `load.params.varName` with `nextValue: iteration` | LR parameter `GenerateNewVal=EachIteration` | Per-iteration data: usernames, passwords, emails |

### 5.2 Classification Rules (applied in priority order)

**Rule 0 — JMX CSV column → Tier 3 (EachIteration)**
Variables that came from a JMX `CSVDataSetConfig` column are always Tier 3. They are injected as empty strings before classification so Rule 4 would otherwise misclassify them as Tier 1 — Rule 0 prevents this.

**Rule 1 — Script-set variables → Tier 1 Dynamic**
Variables explicitly assigned in Postman/Bruno scripts via any of these APIs are always Tier 1:
- `bru.setEnv()`, `bru.setEnvVar()`, `bru.setVar()`, `bru.setGlobalVar()`, `bru.setNextEnvVar()`
- `pm.environment.set()`, `pm.globals.set()`, `pm.collectionVariables.set()`, `pm.variables.set()`
- `postman.setEnvironmentVariable()`, `postman.setGlobalVariable()` ← legacy Postman 2.x API
- `context.set()`, `vars.set()`, `env.set()`

These are always runtime-assigned values, so they must be Tier 1 regardless of whether they have a value in the collection. This prevents variables like `jwt-token` (set via `postman.setEnvironmentVariable`) from being placed in the CSV parameter file.

**Rule 2 — Correlation targets → Tier 1 Dynamic**
Variables that the correlation detector has identified as produced by a response extractor. The fact that a response produces this value means it changes every run.

**Rule 2.5 — Private / cryptographic key variables → Tier 1 Dynamic (never parameterize)**
Variables whose names match a cryptographic key pattern are always Tier 1 and are NEVER written to `collection_data.csv` or `ParameterFile.prm`. This prevents VuGen from failing to open the parameter file when a PEM key is present.

Pattern: `private-key`, `signing-key`, `secret-key`, `rsa-key`, `client-secret`, `signing-secret`, `jwt-secret`, `pem-key`, `key-pem`, `pkcs`, `p12-key` (and case-insensitive variants with dashes, underscores, or no separator).

These values are only ever used in pre-request scripts (JWT signing); they must be handled as `load.global` / C string variables, never as parameterized test data.

**Rule 3 — Underscore prefix → Tier 1 Dynamic**
Variables whose names start with `_` (e.g. `_accessToken`, `_sessionId`) are treated as private/internal regardless of their value. This is a naming convention in many API collections.

**Rule 4 — Empty or null value → Tier 1 Dynamic (safety net)**
If a variable has no value in the collection and has not been classified by Rules 0–3, it must be a runtime-provided value (e.g. `access_token`, `refresh_token`). Making it a parameter with an empty value would break the script — so it becomes Tier 1 dynamic. This is the safety net rule.

**Rule 5 — Real value + credential pattern → Tier 3 Test Data (iteration)**
Variables with actual values that match credential patterns (username, password, email, userId, etc.) are placed in the iteration-scoped parameter file so each virtual user gets different credentials.

**Rule 6 — Real value + non-credential → Tier 2 Config (once)**
Variables with actual values that do not match credential patterns (baseUrl, clientId, apiKey, tenantId, etc.) are read once per run since they are the same for all users.

### 5.3 Postman `$` Built-ins

Variables whose names start with `$` (e.g. `$guid`, `$timestamp`, `$randomEmail`) are Postman dynamic variables. They are **skipped entirely** — no parameter is created and no `load.global` entry is made. In generated DevWeb scripts these are replaced with equivalent JavaScript calls.

---

## 6. Correlation and Extraction System

Correlation runs in two passes managed by `correlationDetector.js`.

### 6.1 Pass 1 — Heuristic Detection (Bruno/Postman)

The detector scans every response script for calls like:
- `pm.environment.set("token", ...)`, `bru.setEnv("token", ...)`, `vars.set(...)`
- It records the variable name and the setter call

It then matches those variable names to patterns in `correlationPatterns[]`:
- `/token/i` → `extractorType: 'json'`, path `$.access_token`
- `/csrf/i` → `extractorType: 'boundary'`, left `csrf_token="`, right `"`
- `/id\b/i` → `extractorType: 'json'`, path `$.id`
- etc.

Script-location note: Bruno YAML stores scripts in `req.tests[]`; Bruno JSON export uses `req.script.res` / `req.script.req`. The detector checks all three locations via:
```js
const events = req.tests || req.event || [];
```

### 6.2 Pass 2 — JMX Explicit Extractor Injection

For JMX files, the parser has already captured the exact extractor configuration. `injectJmxExtractors()` runs after Pass 1 and adds any explicitly-defined extractors that were not already detected by heuristics. It skips names already in `this.correlations` to avoid duplicates.

The correlation object built for each JMX extractor carries:
- `extractorType` — mapped from the JMeter extractor type (see §3.7)
- `xpathQuery` — the XPath expression (for `xpath` type)
- `extractPath` — the JSONPath expression (for `json` type)
- `pattern` — the regex (for `regex` type)
- `leftBound` / `rightBound` — boundary strings (for `boundary` type)
- `scope` — mapped from JMeter's `useHeaders` field (see §3.8)
- `matchNumber` — ordinal of the match (default `1`)

### 6.3 Deduplication

`generateCorrelationRegistrations()` (VuGen) and `generateExtractors()` (DevWeb) both deduplicate by variable name — only one extractor per variable name is emitted even if the same name appears multiple times in `this.correlations`.

### 6.4 Extractor Placement

- **VuGen**: `web_reg_save_param_*` functions are **registration calls** — they must appear **before** the request that produces the value (VuGen registers a listener, then the request fires, then the listener captures the match). The generator places them immediately before the relevant `web_url()` / `web_custom_request()` call.
- **DevWeb**: Extractors are passed as `extractors: [...]` in the request options object. They execute on the response, so they go inside the request call itself.

### 6.5 DevWeb Extractor Syntax Reference

```js
new load.JsonPathExtractor("tokenName", "$.access_token")
new load.RegexpExtractor("tokenName", "token=([^&]+)", 1)
new load.BoundaryExtractor("tokenName", "lb_text", "rb_text")
new load.BoundaryExtractor("tokenName", "lb_text", "rb_text", load.ExtractorScope.Headers)
new load.XPathExtractor("tokenName", "//response/token")
new load.TextCheckExtractor("checkName", { text: "expected", scope: load.ExtractorScope.Body, failOn: false })
```

### 6.6 VuGen C Extractor Syntax Reference

```c
/* JSON Path */
web_reg_save_param_json("ParamName=tokenName",
    "QueryString=$.access_token",
    "Ord=1",
    LAST);

/* Regex */
web_reg_save_param_regexp("ParamName=tokenName",
    "RegExp=token=([^&]+)",
    "Group=1",
    "Ordinal=1",
    LAST);

/* Boundary (body, default) */
web_reg_save_param("ParamName=csrfToken",
    "LB=csrf_token=",
    "RB=&",
    "Ord=1",
    LAST);

/* Boundary (headers) */
web_reg_save_param("ParamName=authHeader",
    "LB=Authorization: ",
    "RB=\r\n",
    "Search=Headers",
    "Ord=1",
    LAST);

/* XPath */
web_reg_save_param_xpath("ParamName=tokenName",
    "QueryString=//response/token",
    "Ord=1",
    LAST);
```

### 6.7 Per-Request UUID / GUID / CSRF Generation

Some headers must carry a **fresh unique value on every request** — not extracted from a response, but generated client-side. The converter detects these automatically and wires up the correct generation call in both protocols.

#### Three Detection Triggers (both generators, applied to all requests including setUp/tearDown)

**Trigger 1 — Script-set UUID variable**
A pre-request script (Postman/Bruno or JMX JSR223) calls a UUID function:
```js
pm.variables.set('interactionId', crypto.randomUUID())
pm.variables.set('xsrfToken', uuidv4())
vars.put("requestId", UUID.randomUUID().toString())   // Groovy/Java
```
`CustomScriptParser.detectPerRequestDynamicVars()` detects these patterns and registers the variable as `generationType: 'uuid'` in `perRequestVars`.

**Trigger 2 — `{{$guid}}` or `{{$randomUUID}}` Postman built-in in a header value**
```
x-fapi-interaction-id: {{$guid}}
x-request-id: {{$randomUUID}}
```
`detectUuidHeaders()` (DevWeb) / UUID header scan (VuGen) finds these, synthesizes a stable variable name from the header key (e.g. `x-fapi-interaction-id` → `xFapiInteractionId`), registers it as `generationType: 'uuid'`, and **mutates the header value** to `{{xFapiInteractionId}}` so the standard per-request machinery takes over seamlessly.

**Trigger 3 — UUID-generating header key with `{{varName}}` value**
Header keys that always carry a per-request UUID regardless of what variable they reference:
`x-fapi-interaction-id`, `x-request-id`, `x-correlation-id`, `x-trace-id`, `x-interaction-id`, `x-idempotency-key`, `idempotency-key`, `x-b3-traceid`, `request-id`, `correlation-id`
```
x-fapi-interaction-id: {{fapiId}}   ← fapiId registered as uuid perRequestVar
```
Skipped if the variable is already a correlation target or static parameter.

**Trigger 4 — CSRF/XSRF-named header with `{{varName}}` value** (VuGen only, pre-existing)
Header key matches: `x-csrf-token`, `x-xsrf-token`, `x-csrftoken`, `csrf-token`, `__requestverificationtoken`, `x-request-token`, or any key matching `/csrf|xsrf|antiforg|request.?verif/i`.
Registered as `generationType: 'csrf'` → generates a 32-char hex token (not UUID format).

#### What Gets Generated

**DevWeb** — before each request that uses the variable:
```js
load.global.xFapiInteractionId = load.utils.uuid();
// used in the request:
headers: { "x-fapi-interaction-id": `${load.global.xFapiInteractionId}` }
```
`load.utils.uuid()` is the DevWeb SDK function — not `crypto.randomUUID()` (which is a Node.js API not available in the DevWeb runtime).

**VuGen** — before each request that uses the variable (`globals.h` contains the helper functions):
```c
/* For uuid generationType: */
gen_uuid("_xFapiInteractionId");
/* used in the request: */
web_add_header("x-fapi-interaction-id", lr_eval_string("{_xFapiInteractionId}"));

/* For csrf generationType: */
gen_csrf_token("_csrfToken");
```

`gen_uuid()` in `globals.h` uses `lr_param_sprintf` with the UUID v4 bit-masked format:
```c
static void gen_uuid(const char *param_name) {
    lr_param_sprintf(param_name,
        "%08x-%04x-4%03x-%04x-%04x%08x",
        rand(),
        rand() & 0xffff,
        rand() & 0x0fff,
        (rand() & 0x3fff) | 0x8000,
        rand() & 0xffff,
        rand());
}
```
This produces a valid UUID v4 format. `rand()` in VuGen is seeded per Vuser so concurrent Vusers produce different sequences. Source: OpenText community accepted solution for UUID generation in VuGen C.

`gen_csrf_token()` produces a 32-char hex string (128-bit random):
```c
static void gen_csrf_token(const char *param_name) {
    lr_param_sprintf(param_name, "%08x%08x%08x%08x", rand(), rand(), rand(), rand());
}
```

#### Fallback — `{{$guid}}` / `{{$randomUUID}}` in URLs or Body (DevWeb only)
After header mutation in `detectUuidHeaders()`, any remaining `{{$guid}}` in a URL or body (rare) is resolved by `resolvePostmanDynamicVar()` which returns `${load.utils.uuid()}` — a live call embedded in the template literal:
```js
url: `https://api.example.com/items/${load.utils.uuid()}`
```

#### Guards — What is Never Overridden
- If the variable is already a **correlation target** (extracted from a response) → no UUID gen registered
- If the variable is already in **`perRequestVars`** from script detection → not re-registered
- If the variable is already a **static parameter** → not overridden
- CSRF-named headers are handled first by the CSRF scan; UUID scan runs after and skips already-classified vars

### 6.8 Global Variable Access After Extraction

**DevWeb:**
```js
// After the request that produces the value:
load.global.tokenName = response.extractors["tokenName"];

// In a later request:
const headers = { Authorization: `Bearer ${load.global.tokenName}` };
```

**VuGen:**
```c
/* After extraction, reference the LR parameter in the next request: */
web_add_header("Authorization", "Bearer {tokenName}");
```

---

## 7. Authentication Handling

Authentication is detected from collection-level auth config and/or pre-request scripts. The `authenticationHandler.js` module generates the appropriate init code.

### 7.1 Supported Auth Types

| Auth type | DevWeb | VuGen |
|---|---|---|
| **OAuth2 Client Credentials** | `load.utils.getToken()` in `initialize()` | `web_custom_request()` in `vuser_init.c` → extracts `access_token` |
| **OAuth2 Password Grant** | Same as CC with username/password params | Same as CC with additional body params |
| **Bearer Token (static)** | `load.global.bearerToken = load.params.token` | `lr_save_string({token}, "bearerToken")` |
| **Bearer Token (dynamic)** | Uses `load.global.accessToken` from correlated extraction | Uses `{accessToken}` from extraction in `vuser_init.c` |
| **Basic Auth** | `Authorization: Basic base64(user:pass)` header | `web_set_user()` or manual header |
| **API Key** | Added as header or query param as configured | `web_add_header()` or URL param |
| **AWS Signature v4** | `load.utils.awsSign()` helper | Manual HMAC calculation stub |
| **Digest Auth** | `web_set_user()` equivalent | `web_set_user()` |
| **JWT** | Uses `jwt-helper.js` — see §12 | Uses `jsrsasign.js` — see §12 |

**Not yet implemented:** Cookie jar management, NTLM (stubs declared but empty).

### 7.2 OAuth2 Token Flow

For OAuth2 client credentials:
1. Token request is generated in `initialize()` (DevWeb) or `vuser_init.c` (VuGen)
2. The `access_token` field is extracted from the JSON response
3. All subsequent requests that reference `{{accessToken}}` or `{{access_token}}` automatically use the correlated value

---

## 8. Parameterization Engine

`parameterizationEngine.js` scans raw values in requests for known data patterns and suggests which values should be parameterized. It does NOT classify tiers — that is the generator's job. Its output is advisory.

### 8.1 Detected Patterns

- **Email addresses** — `user@domain.com` format
- **UUID / GUID** — `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx` format
- **Bearer tokens** — long alphanumeric strings matching token patterns
- **Base64 strings** — strings that decode cleanly to ASCII
- **Timestamps** — numeric epoch values or ISO 8601 strings
- **URLs** — values starting with `http://` or `https://`
- **Phone numbers** — international format patterns
- **Credit card numbers** — Luhn-valid numeric strings

### 8.2 Proxy Variable Detection

`detectProxyConfig()` is a method on both generators that scans `this.variableMap` for proxy-related keys:
- `proxy`, `proxyUrl`, `proxy_url`, `http_proxy`, `HTTP_PROXY`, `proxyServer`
- `proxyHost` + `proxyPort` (separate keys)

Formats handled: full URL `http://user:pass@host:port`, bare `host:port`, or separate host/port variables.

When a proxy is detected:
- **DevWeb**: injected into `rts.yml` proxy section with `useProxy: true`
- **VuGen**: injected into `default.cfg` `[WEB]` section with `ProxyHTTPHost=`, `ProxyHTTPPort=`, etc.

---

## 9. Transaction Naming

### 9.1 Naming Convention

Transactions follow the pattern `T{nn}_{RequestName}` where:
- `nn` is a zero-padded global sequential counter across ALL folders and thread groups
- `RequestName` is sanitized: numbers stripped from the label part, spaces replaced with underscores
- Examples: `T01_Get_Access_Token`, `T02_Create_Order`, `T03_Submit_Payment`

### 9.2 DevWeb Implementation

All transaction declarations are emitted at **module level** before `initialize()` so they are visible throughout the script:
```js
const T01_Get_Access_Token = new load.Transaction("T01_Get_Access_Token");
const T02_Create_Order = new load.Transaction("T02_Create_Order");
```

Inside `action()`:
```js
T01_Get_Access_Token.start();
// ... request code ...
T01_Get_Access_Token.stop(load.TransactionStatus.Passed);
```

`buildTransactionMap()` is called at the start of `generateAction()` to populate `this.requestTxMap`. `generateHeader()` reads this map to emit all declarations. The request generators only call `.start()` / `.stop()`.

### 9.3 VuGen Implementation

```c
lr_start_transaction("T01_Get_Access_Token");
// ... web_custom_request(...) ...
lr_end_transaction("T01_Get_Access_Token", LR_AUTO);
```

The `.usr` file `[TransactionsOrder]` and `[Transactions]` sections are auto-populated from `this.transactionNames[]` collected during generation.

---

## 10. Think Time Handling

### 10.1 JMX Sources

| JMeter element | Converted to |
|---|---|
| `ConstantTimer` with fixed delay | Fixed think time |
| `UniformRandomTimer` with min/max | Random think time |

Think time is attached to the request that follows the timer in the JMX element order.

### 10.2 DevWeb

```js
await load.thinkTime(2);          // fixed 2 seconds
await load.thinkTime(1, 3);       // random 1–3 seconds
```

### 10.3 VuGen

```c
lr_think_time(2);                 // fixed 2 seconds
lr_think_time_ex(1, 3);          // random 1–3 seconds (if supported)
```

---

## 11. Proxy Auto-Detection

The proxy detection runs automatically during generation. See §8.2 for detection logic.

When proxy credentials are found, they are stored in Tier 2 Config parameters (read once) and referenced in the proxy configuration — not hardcoded in script text.

When no proxy is detected, the proxy section is emitted with `useProxy: false` (DevWeb) or `ProxyUseBrowser=1` with `ProxyUseProxyServer=0` (VuGen) — the default browser proxy setting.

---

## 12. JWT Detection and Handling

### 12.1 Detection

`customScriptParser.detectJwtUsage(script)` fingerprints scripts for JWT generation patterns:
- `jsrsasign` library import
- `KJUR.jws.JWS.sign(` call
- `require('jsonwebtoken')` + `.sign(` call
- `require('jose')` import
- `crypto.sign(` + `base64url` combination

If none of these are found, `hasJwt = false` and zero JWT code is generated.

### 12.2 DevWeb JWT

When JWT is detected:
- `jwt-helper.js` is copied from the project root to the output directory
- `transport.pem` is copied from the project root (replace with actual private key)
- `jwt-helper.js` and `transport.pem` are added to `[ManuallyExtraFiles]` in the `.usr` file
- The generated `initialize()` function calls `jwtHelper.generateToken(...)` to produce a signed JWT

### 12.3 VuGen JWT

When JWT is detected:
- `jsrsasign.js` is copied from the project root (the jsrsasign library for C/JS bridge)
- `transport.pem` is copied from the project root
- Both are listed in `[ManuallyExtraFiles]` in the `.usr` file
- The generated `vuser_init.c` includes a JWT generation stub using the jsrsasign library

### 12.4 jsrsasign Library-Fetch Request Filtering

Some Postman/Bruno collections include a **first HTTP request** that downloads the jsrsasign library at runtime:
```
GET http://kjur.github.io/jsrassign/jsrassign-latest-all-min.js
```
This is a Postman pre-request workaround to load jsrsasign into the Postman sandbox before generating a JWT. In our converted scripts the library is shipped as a local file (`jsrassign.js`) — so this HTTP request must **never** be converted into a `web_custom_request()` / `load.WebRequest` call.

The converter filters these requests out during `analyze()` in both generators. Detection is by URL pattern OR request name pattern:
- URL contains `jsrsasign` or `jsrassign` (handles typo variant)
- URL domain contains `kjur.github`
- Request name contains `jsrsasign` or `jsrassign`

This correctly handles **parameterized hostnames** such as `{{jsrsasignHost}}/jsrassign-latest-all-min.js` — the path pattern is matched regardless of the hostname.

---

## 13. Custom Script Conversion

`customScriptParser.js` converts Postman/Bruno test scripts and pre-request scripts into the target protocol's equivalent.

### 13.1 What Gets Converted

| Source construct | DevWeb output | VuGen output |
|---|---|---|
| `pm.response.json()` | `JSON.parse(response.body)` | Parsed via boundary extraction |
| `pm.response.to.have.status(200)` | `load.TextCheckExtractor(...)` | `web_reg_find(...)` |
| `pm.test(...)` | Inline assertion comment | Inline assertion comment |
| `pm.environment.set(key, val)` | `load.global.key = val` | `lr_save_string(val, "key")` |
| `pm.globals.set(key, val)` | `load.global.key = val` | `lr_save_string(val, "key")` |
| `console.log(...)` | Removed (no logging in generated scripts) | Removed |
| `require('jsonwebtoken')` | Replaced with `jwt-helper.js` calls | Replaced with jsrsasign calls |

### 13.2 No Logging in Generated Scripts

As of v2.7.0, all log statements are removed from generated output:
- **DevWeb**: no `load.log(...)` calls anywhere in `main.js` (lifecycle, per-request, JWT, error handling)
- **VuGen**: no `lr_output_message(...)` or `lr_log_message(...)` calls in `Action.c`, `vuser_init.c`, or `vuser_end.c`

---

## 14. Request Body Handling

### 14.1 JSON Body

- Content-Type `application/json` detected automatically
- Body string preserved exactly; template variables `{{varName}}` replaced with parameter references
- **DevWeb**: `body: JSON.stringify({...})` or raw string
- **VuGen**: body inline if ≤ 500 characters; extracted to `data/RequestName_body.b64` if larger (referenced via `BodyFilePath=`)

### 14.2 Form URL-Encoded

- `application/x-www-form-urlencoded` bodies are built as key=value pairs
- **DevWeb**: `body: new load.FormData({...})`
- **VuGen**: `web_submit_data()` with `ITEMDATA` block, or `web_custom_request()` with URL-encoded body string

### 14.3 Multipart / Form-Data

- `multipart/form-data` bodies with file uploads
- **DevWeb**: `body: new load.MultipartBody([...])` with a `// TODO` comment because file paths need manual configuration
- **VuGen**: Not supported — `web_custom_request()` does not accept multipart bodies; a `console.warn` comment is emitted

### 14.4 Binary / Raw Bodies

- Binary bodies larger than 500 characters are extracted to a `data/` subfolder as base64-encoded `.b64` files
- **VuGen**: referenced via `BodyFilePath=data/RequestName_body.b64` — VuGen decodes at runtime and supports `{param}` substitution within the file

---

## 15. URL Handling Rules

**Critical rule: never use `new URL()` on URLs containing `{{variable}}` placeholders.**

The reason: `new URL("https://{{host}}/path")` would URL-encode the braces to `%7B%7B`, breaking the parameterization. Instead, all URL parsing uses manual string operations:

```js
// Correct approach
const parts = rawUrl.split('?');
const path  = parts[0];
const query = parts[1] || '';
```

This applies throughout: `brunoParser`, `correlationDetector`, both generators, and `jmxParser`.

### 15.1 Query String Parameterization

Query string parameters that contain `{{varName}}` references are split out and re-parameterized individually. In VuGen, query params are either embedded in the URL string or passed as `"Name=...", "Value=..."` pairs in `web_url()`.

### 15.2 Hostname Parameterization

Base URLs (hostnames) are always extracted as Tier 2 Config parameters (`baseUrl`, `host`, `serverUrl`, etc.) so the script can be pointed at different environments by changing only the parameter file.

---

## 16. DevWeb Generated Files

Every DevWeb conversion produces this complete set of files:

| File | Description |
|---|---|
| `main.js` | Main script — `initialize()`, `action()`, `finalize()` |
| `parameters.yml` | Parameter definitions (always written, even if empty) |
| `rts.yml` | Runtime settings — HTTP, SSL, proxy, logging, think time |
| `scenario.yml` | Basic scenario: 1 VUser, 20s duration, rampUp 2s |
| `tsconfig.json` | TypeScript config for IDE type-checking of `main.js` |
| `DevWebSdk.d.ts` | DevWeb JavaScript SDK type definitions (copied from project root) |
| `[ScriptName].usr` | VuGen project metadata — lists all files, transactions, run type |
| `default.cfg` | Runtime config — log level, think time options, iterations |
| `default.usp` | Run logic profile — defines Init → Run → End sequence |
| `ScriptUploadMetadata.xml` | LRE upload manifest listing all script files |
| `Action.c` | Stub C file (required by VuGen to open a DevWeb project) |
| `vuser_init.c` | Stub C file (required by VuGen to open a DevWeb project) |
| `vuser_end.c` | Stub C file (required by VuGen to open a DevWeb project) |
| `collection_data.csv` | One row of seed data for all Tier 2/3 parameters |
| `jwt-helper.js` | (when JWT detected) — DevWeb JWT signing helper |
| `transport.pem` | (when JWT detected) — private key placeholder |

### 16.1 main.js Structure

```js
"use strict";

// ── Module-level: transaction declarations ────────────────
const T01_Login = new load.Transaction("T01_Login");
const T02_GetData = new load.Transaction("T02_GetData");

// ── initialize() — runs once before iterations ────────────
async function initialize() {
    // OAuth2 token fetch / JWT generation / mTLS setup
}

// ── action() — runs each iteration ────────────────────────
async function action() {
    T01_Login.start();
    const response1 = await load.utils.request({ ... });
    load.global.accessToken = response1.extractors["accessToken"];
    T01_Login.stop(load.TransactionStatus.Passed);
    // ...
}

// ── finalize() — runs once after all iterations ───────────
async function finalize() {
    // cleanup
}
```

### 16.2 rts.yml Key Settings

- `httpConnection.maxPersistentConnectionsPerHost: 6`
- `httpConnection.connectTimeout: 120`
- `httpConnection.requestTimeout: 120`
- `ssl.ignoreBadCertificate: false`
- `replay.simulateNewUser: true`
- `replay.saveSnapshots: always`
- `vuserLogger.logMode: full` / `logLevel: trace`
- Proxy section: defaults to disabled; auto-populated when proxy detected

---

## 17. VuGen Web HTTP/HTML Generated Files

Every VuGen conversion produces:

| File | Description |
|---|---|
| `vuser_init.c` | Initialization — OAuth2 token fetch, JWT, Basic auth setup |
| `Action.c` | Main script — all HTTP requests, transactions, think times |
| `vuser_end.c` | Cleanup — logout, teardown requests |
| `globals.h` | All variable declarations shared across C files |
| `ParameterFile.prm` | VuGen INI format — one `[parameter:name]` section per variable |
| `collection_data.dat` | CSV with header row + one seed data row |
| `[ScriptName].usr` | VuGen project metadata — type Multi, C/cci interpreter |
| `default.cfg` | Full VuGen runtime config — HTTP settings, proxy, NTLM flags |
| `default.usp` | Run logic — Init (vuser_init) → Run (Action) → End (vuser_end) |
| `ScriptUploadMetadata.xml` | LRE upload manifest |
| `jsrsasign.js` | (when JWT detected) — JavaScript JWT library for VuGen |
| `transport.pem` | (when JWT detected) — private key placeholder |

### 17.1 globals.h Purpose

VuGen C scripts use three separate `.c` files. Variables declared in one file are not visible to others unless declared in `globals.h` (which is `#include`d by all three). The generator declares every correlation variable, parameter reference, and shared string here.

### 17.2 Variable Reference Syntax

| What | Syntax |
|---|---|
| LR parameter in string context | `{paramName}` (VuGen expands at runtime) |
| LR parameter in C code | `lr_eval_string("{paramName}")` |
| Saved string from correlation | `{corrVarName}` after `web_reg_save_param_*` |
| Think time | `lr_think_time(2)` |

### 17.3 ParameterFile.prm Format

VuGen uses INI format (not XML):
```ini
[parameter:baseUrl]
ColumnName="baseUrl"
Column="1"
Delimiter=","
GenerateNewVal="Once"
OriginalValue="https://api.example.com"
OutOfRangePolicy="ContinueWithLast"
ParamName="baseUrl"
SelectNextRow="Sequential"
StartRow="1"
Table="collection_data.dat"
TableLocation="Local"
Type="Table"
```

### 17.4 default.cfg Key Settings (VuGen)

- `[WEB] HttpVer=1.1` + `EnableHTTP2=1`
- `[WEB] KeepAlive=1`
- `[WEB] SimulateCache=1`
- `[Log] LogOptions=LogBrief` — brief logging for replay performance
- `[General] ContinueOnError=0` — stop on first error
- NTLM flags (`UseNativeNTLM`, `IntegratedAuthentication`) auto-set when NTLM auth detected
- Proxy section: auto-populated when proxy detected, defaults to `ProxyUseBrowser=1`

### 17.5 Snapshot Counter

`web_url()` and `web_custom_request()` each require:
```c
"Snapshot=t1.inf",
"Mode=HTML",
```
The `snapshotCounter` is a per-generator instance counter that starts at 1 and increments for each request emitted in `Action.c`. The value is formatted as `tN.inf` where N is the counter. This is required by VuGen — scripts without it may produce warnings or fail snapshot-based replay.

### 17.6 VuGen C Syntax Rules

- **C89**: All variable declarations at the top of each function before any executable statements
- `web_reg_save_param_*()` calls MUST precede the request they capture from
- `web_add_header()` applies to the next single request only — it does NOT persist
- For bodies > 500 chars: use `BodyFilePath=data/filename.b64` (VuGen reads and decodes at runtime)
- `lr_whoami(int*, char**, int*)` for VUser ID — `lr_get_vuser_id()` does not exist in VuGen
- `lr_output_message()` always visible in Output window; `lr_log_message()` only in log file

---

## 18. Workload Modelling Excel

Generated from JMX thread group metadata. File: `{ScriptName}_WLM.xlsx`.

### 18.1 Sheets

**Sheet 1 — Thread Groups**
One row per thread group with columns:
- `#`, `Name`, `Type` (Standard / SetUp / TearDown / Stepping / Ultimate / Concurrency / Arrivals)
- `Script Name`
- `VUsers` (concurrency target)
- `Ramp Up (s)`, `Hold Duration (s)`, `Ramp Down (s)`
- `Iterations`, `Start Delay (s)`
- `Step Size`, `Step Duration (s)` — for Stepping thread groups
- `Think Time`, `Notes`

Row background colors differ by thread group type:
- Standard = white, SetUp = light blue, TearDown = light orange, Stepping = light green, Ultimate = light purple, Concurrency = light yellow, Arrivals = light pink

**Sheet 2 — Transactions**
One row per transaction with: `Transaction Name`, `Thread Group`, `Request Count`

**Sheet 3 — LRE Setup Guide**
Static instruction sheet explaining how to recreate the JMeter workload model in LoadRunner Enterprise.

### 18.2 Excel Safety

ExcelJS `ws.columns` with `header` property is NOT used. Manual header rows are written to avoid conflict with the merged title cell in row 1 (which would cause Excel's "found a problem with content" repair dialog).

### 18.3 Multi-Script Mode Excel

In multi-script mode, one Excel file is generated per thread group in its sub-directory (single thread group). A combined Excel covering all thread groups is also generated at the root output directory.

---

## 19. Web Server Privacy Model

The web server (`src/web/server.js`) uses an in-memory file system so uploaded files never touch disk.

### 19.1 Upload Handling

- `multer.memoryStorage()` — uploaded files stay in RAM, never written to disk
- Multiple files accepted: the JMX file + optional CSV data files + optional environment file

### 19.2 In-Memory File System

`src/lib/memoryFsInterceptor.js` uses Node.js `AsyncLocalStorage` to intercept all `fs` write calls made during a conversion request:
- `fs.writeFile`, `fs.writeFileSync`, `fs.mkdir`, `fs.mkdirSync`, `fs.copyFileSync`
- All writes go into an in-memory `Map<filePath, content>` scoped to the current request

### 19.3 ZIP Streaming

The complete script directory is streamed as a ZIP directly from the in-memory Map to the browser via `archiver.pipe(res)`:
- No ZIP file is ever written to disk
- No `Content-Length` header — chunked transfer encoding bypasses corporate proxy size restrictions
- `Content-Type: application/octet-stream` (not `application/zip`) — avoids ZIP-specific proxy/firewall filters

### 19.4 CLI Unaffected

The memory interceptor only activates inside `runWithMemoryFs()` context. CLI usage writes files normally to disk.

---

## 20. Known Limitations

| Area | Limitation |
|---|---|
| **CSS Selector extractor** | JMeter `HtmlExtractor` has no native LoadRunner equivalent. Mapped to boundary extraction (left = CSS expression + `>`, right = `</`). May not work for complex selectors. |
| **NTLM auth** | `authenticationHandler.js` has an empty NTLM stub. `default.cfg` sets the NTLM flags but no token-generation code is emitted. |
| **Cookie jar** | No explicit cookie jar management. VuGen handles cookies automatically via the runtime; DevWeb requires manual `load.CookieJar` calls which are not generated. |
| **Multipart bodies (VuGen)** | `web_custom_request()` does not support multipart `Body=` parameter. A `// TODO` comment with a `console.warn` is emitted. |
| **WebSocket** | Not supported. Only HTTP/HTTPS requests are converted. |
| **GraphQL** | Treated as a plain JSON POST body. No special GraphQL extraction logic. |
| **gRPC** | Not supported. |
| **JMeter Logic Controllers** | `IfController`, `LoopController`, `WhileController`, etc. are not converted. Their child requests are extracted and flattened into the main action. |
| **JMeter Assertions** | `ResponseAssertion`, `JSONPathAssertion`, etc. are not converted. Add manual `web_reg_find()` or `load.TextCheckExtractor()` calls after conversion. |
| **mTLS** | `mtlsCertFile` parameter is supported in `.usr` file generation but certificate loading code is not generated in the script. |
