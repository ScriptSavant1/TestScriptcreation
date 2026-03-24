# Converter Feature Reference
# Bruno/Postman/JMeter → LoadRunner DevWeb & VuGen Web HTTP/HTML
# Version: 2.8.x | Last updated: 2026-03-24
#
# PURPOSE: Complete AI-readable reference of every implemented feature.
# Read this file to understand what the converter does, what it generates,
# and what its limits are — before modifying any code.

---

## Table of Contents

1. [Input Formats Supported](#1-input-formats-supported)
2. [Output Protocols](#2-output-protocols)
3. [Bruno / Postman Converter — Feature Set](#3-bruno--postman-converter--feature-set)
4. [JMX (JMeter) Converter — Feature Set](#4-jmx-jmeter-converter--feature-set)
5. [What Cannot Be Converted (Both Modules)](#5-what-cannot-be-converted-both-modules)
6. [Generated File Inventory](#6-generated-file-inventory)
7. [Architecture — Key Files](#7-architecture--key-files)

---

## 1. Input Formats Supported

| Format | Detection | Entry point |
|--------|-----------|-------------|
| Postman Collection v2.1 `.json` | `info.schema` URL present | `parseJSON()` in brunoParser |
| Bruno JSON export `.json` | `items[]` array, no schema URL | `parseJSON()` in brunoParser |
| Bruno YAML folder `/dir` | path is a directory | `walkBrunoYamlDir()` |
| Bruno Single YAML `.yml/.yaml` | file extension | `parseBrunoYamlCollection()` |
| Bruno single request `.bru` | `.bru` extension | `parseBru()` |
| JMeter `.jmx` | `<jmeterTestPlan>` root element | `JmxParser` |

Optional environment file: `.json` (Postman format) or `.bru` (Bruno format).

---

## 2. Output Protocols

| Protocol flag | Language | Key files generated |
|---------------|----------|---------------------|
| `devweb` | Node.js (DevWeb SDK) | `main.js`, `parameters.yml`, `rts.yml`, `default.cfg`, `default.usp`, `[ScriptName].usr` |
| `web-http` | C89 (VuGen) | `Action.c`, `vuser_init.c`, `vuser_end.c`, `globals.h`, `ParameterFile.prm`, `default.cfg`, `[ScriptName].usr` |

Both protocols: `DevWebSdk.d.ts` / `jsrsasign.js` + `transport.pem` + `jwt-helper.js` copied when JWT detected.

---

## 3. Bruno / Postman Converter — Feature Set

### 3.1 Variable Classification — 3-Tier System

All variables from the collection and environment go through `classifyVariables()` in each generator.
**6 rules applied in strict order:**

| Rule | Condition | Result | DevWeb | VuGen C |
|------|-----------|--------|--------|---------|
| 0 | JMX CSVDataSet column | Tier 3 Param (EachIteration) | `load.params.X` | `{X}` |
| 1 | Set by script (`bru.setEnv`, `pm.*.set`, `vars.set`, etc.) | Tier 1 Dynamic | `load.global.X` | `{_X}` |
| 2 | Correlation target | Tier 1 Dynamic | `load.global.X` | `{_X}` |
| 3 | Name starts with `_` | Tier 1 Dynamic | `load.global.X` | `{_X}` |
| 4 | Empty/null value (safety net — catches runtime vars like `access_token`) | Tier 1 Dynamic | `load.global.X` | `{_X}` |
| 5 | Real value + credential pattern | Tier 3 Test Data (iteration) | `load.params.X` | `{X}` |
| 5 | Real value + not credential | Tier 2 Config (once) | `load.params.X` | `{X}` |

Rule 4 is the safety net: static config vars always have values; runtime vars (tokens, IDs) are left empty → always Tier 1.
`$` prefix (Postman built-ins: `$guid`, `$timestamp`) → skipped entirely, never parameterized.

### 3.2 Correlation Detection — Fully Automatic

Two-pass analysis in `correlationDetector.js`:
- **Pass 1**: Scan all post-response scripts for setter APIs → extract variable name + access path
- **Pass 2**: Scan all requests for variable consumption → build producer-consumer links

**Setter APIs detected (all Bruno + Postman variants):**

| API | Notes |
|-----|-------|
| `bru.setEnvVar("x", v)` | Primary modern Bruno |
| `bru.setEnv("x", v)` | Old Bruno alias |
| `bru.setVar("x", v)` | Collection/request scoped |
| `bru.setGlobalVar("x", v)` | Global scope |
| `bru.setNextEnvVar("x", v)` | Next environment |
| `env.set("x", v)` / `vars.set("x", v)` | Bruno 1.x legacy |
| `pm.environment.set()` / `pm.globals.set()` / `pm.collectionVariables.set()` | Postman |
| `context.set("x", v)` | Postman/Salesforce |

**Response access patterns → extractor types:**

| Pattern in Script | Extractor | DevWeb | VuGen |
|-------------------|-----------|--------|-------|
| `res.body.field` / `pm.response.json().field` | JSONPath | `new load.JsonPathExtractor("x","$.field")` | `web_reg_save_param_json(...)` |
| `res.headers["name"]` | Header boundary | `new load.BoundaryExtractor(...)` | `web_reg_save_param(...)` |
| `res.cookies["name"]` | Cookie boundary | `new load.BoundaryExtractor(...)` | `web_reg_save_param(...)` |
| Bearer `{{access_token}}` in header | Detected via `findVariablesInString()` | marks as consumed | marks as consumed |

**Script storage location** (critical): `brunoParser` stores scripts in `req.tests[]`, NOT `req.event[]`.
All script scanning uses: `const events = req.tests || req.event || [];`

### 3.3 Authentication

| Type | DevWeb | VuGen |
|------|--------|-------|
| OAuth2 Client Credentials | `initialize()` token fetch + auto-refresh | Commented block in `vuser_init.c` |
| OAuth2 Password | `initialize()` token fetch | Commented block in `vuser_init.c` |
| Bearer — dynamic token | `load.global.X` updated at start of action | `web_add_header()` before each request |
| Bearer — static token | `load.params.X` | `{X}` parameter |
| Basic Auth | `load.utils.base64Encode(user+pass)` | `web_set_user(user, pass, host)` |
| API Key (header) | `load.WebRequest.defaults.headers` | `web_add_auto_header()` |
| API Key (query string) | Appended to URL | `{X}` in URL |
| Digest Auth | Computed at request level | `web_set_user()` |
| AWS Signature v4 | `load.AWSAuthentication` | Not implemented |
| JWT (detected in scripts) | `jwt-helper.js` + auto-refresh | `web_js_run()` + jsrsasign.js |

### 3.4 JWT Detection

`customScriptParser.detectJwtUsage()` fingerprints pre-request scripts for:
- `jsrsasign` / `KJUR.jws.JWS.sign(`
- `require('jsonwebtoken')` + `.sign(`
- `require('jose')`
- `crypto.sign(` + `base64url`

When detected → generates full JWT signing code + auto-refresh in action loop.
When NOT detected → zero JWT code generated (headers/auth/correlations still work normally).

### 3.5 Header Intelligence

`analyzeCommonHeaders()` classifies headers automatically:
- Headers present in ≥70% of requests with same value → **global auto-headers**
  - DevWeb: `load.WebRequest.defaults.headers` at module level
  - VuGen: `web_add_auto_header()` once at start of Action
- Per-request UUID/CSRF/dynamic headers → generated fresh per request
- Content-Type (varies by body type) → always per-request

### 3.6 Per-Request Transactions

Every API request becomes a named transaction: `T{nn}_{RequestName}` (globally sequential).

- DevWeb: `const T01 = new load.Transaction(...)` declared at MODULE level before `initialize()`
- VuGen: `lr_start_transaction("T01_...") / lr_end_transaction(...)` wrapping each request
- `.usr` file: `[TransactionsOrder]` + `[Transactions]` auto-populated

### 3.7 Dynamic Per-Request Values

Detected by `customScriptParser.detectPerRequestDynamicVars()`:

| Script pattern | Generated code |
|----------------|----------------|
| `crypto.randomUUID()` / `uuidv4()` | DevWeb: `load.global.X = crypto.randomUUID()` / VuGen: `gen_uuid("_X")` |
| `CryptoJS.lib.WordArray.random()` | DevWeb: `load.global.X = crypto.randomBytes(16).toString('hex')` / VuGen: `gen_csrf_token("_X")` |
| `crypto.randomBytes()` | VuGen: `gen_hex64("_X")` |
| CSRF header name auto-detected | Correct header name injected |

VuGen: functions `gen_uuid`, `gen_csrf_token`, `gen_hex64` generated in `globals.h`.

### 3.8 Proxy Detection

`detectProxyConfig()` scans `variableMap` for proxy settings:
- Full URL patterns: `proxy`, `proxyUrl`, `proxy_url`, `http_proxy`, `HTTP_PROXY`, `proxyServer`
- Separate host+port: `proxyHost` + `proxyPort`
- DevWeb → injects proxy section in `rts.yml`
- VuGen → injects `ProxyHTTPHost/Port/UserName/Password` in `default.cfg [WEB]`

### 3.9 Parameterization Output

**DevWeb** (`parameters.yml`):
```yaml
parameters:
  - name: username
    type: csv
    fileName: users.csv
    columnName: username
    nextValue: iteration      # Tier 3 (credentials)
    nextRow: sequential
  - name: baseUrl
    type: csv
    fileName: collection_data.dat
    columnName: baseUrl
    nextValue: once           # Tier 2 (config)
```

**VuGen** (`ParameterFile.prm`):
```ini
[parameter:username]
GenerateNewVal=EachIteration
Table="collection_data.csv"
Column=1
```

### 3.10 Think Time

Injected between requests:
- DevWeb: `await load.utils.thinkTime(N);`
- VuGen: `lr_think_time(N);`
Default: 1 second (configurable via UI or CLI `--think-time`).

### 3.11 Script Conversion (Postman/Bruno pre/post scripts → LoadRunner)

`customScriptParser.js` converts common Postman/Bruno test script patterns:
- `pm.response.json()` field access → correlation extractor
- `pm.test(...)` + `pm.expect(...)` → `web_reg_find()` (VuGen) or critical check (DevWeb)
- Variable setters → see §3.2

---

## 4. JMX (JMeter) Converter — Feature Set

Entry point: `src/converters/jmxConverter.js`
Parser: `src/parsers/jmxParser.js` (fast-xml-parser with `preserveOrder:true`)

### 4.1 JMX XML Parsing

JMeter uses alternating element/hashTree **sibling** pairs (NOT nested children):
```xml
<HTTPSamplerProxy testname="Login"/>
<hashTree>              ← Login's children (extractors, scripts, timers)
  <RegexExtractor/>
  <hashTree/>
</hashTree>
```
`flattenHashTree()` pairs element[i] with hashTree[i+1] using `preserveOrder:true`.

### 4.2 HTTP Request Parsing

| JMeter element | What is extracted |
|----------------|-------------------|
| `HTTPSamplerProxy` | method, URL, headers, body (raw JSON or form params), name |
| `ConfigTestElement` (HTTP Request Defaults) | base domain, port, protocol → `baseUrl` |
| `HeaderManager` (global or per-request) | header key/value pairs |
| `AuthManager` | username, password, mechanism (Basic/NTLM/Kerberos/Digest) |
| `UserDefinedVariables` / `Arguments` | variable name/value pairs |
| `ConstantTimer` / other timers | think time in ms → converted to seconds |

**Variable syntax**: JMX `${varName}` → converter `{{varName}}` throughout URLs, headers, body.

### 4.3 Correlation Extractors — All 5 JMeter Types

All extractors are parsed from the request's child `hashTree` and converted to correlation objects:

#### RegexExtractor
```xml
<RegexExtractor>
  <stringProp name="RegexExtractor.refname">token</stringProp>
  <stringProp name="RegexExtractor.regex">"token":"(.*?)"</stringProp>
  <stringProp name="RegexExtractor.match_no">1</stringProp>
  <stringProp name="RegexExtractor.useHeaders">false</stringProp>
</RegexExtractor>
```
→ DevWeb: `new load.RegexpExtractor("token", "\"token\":\"(.*?)\"")` (JSON.stringify escaping)
→ VuGen: `web_reg_save_param_regexp("token", "RegExp=\"token\":\"(.*?)\"", "Ord=1", LAST)`

**IMPORTANT**: All string values use `JSON.stringify()` — double quotes in patterns are correctly escaped.
Property name is `match_no` (NOT `match_number`).

#### BoundaryExtractor
→ DevWeb: `new load.BoundaryExtractor("name", leftBound, rightBound)`
→ VuGen: `web_reg_save_param("name", "LB=...", "RB=...", LAST)`

#### JSONPathExtractor
Property name: `JSONPathExtractor.referenceName` (JMeter 5.x) — NOT `.refname`.
→ DevWeb: `new load.JsonPathExtractor("name", "$.path")`
→ VuGen: `web_reg_save_param_json("name", "QueryString=$.path", LAST)`

#### XPathExtractor / XPath2Extractor
→ DevWeb: `new load.XPathExtractor("name", "//xpath/query")`
→ VuGen: `web_reg_save_param_xpath("name", "QueryString=//xpath", LAST)`

#### HtmlExtractor / JMESPathExtractor
→ Converted using best-effort mapping to boundary or jsonpath equivalents.

### 4.4 Extractor Scope ("Apply To" field)

`useHeaders` value → scope → DevWeb / VuGen:

| useHeaders | Scope | DevWeb | VuGen Search= |
|---|---|---|---|
| `false` or blank | body | (default, omit) | (omit) |
| `true` | response_headers | `load.ExtractorScope.Headers` | `Search=Headers` |
| `request_headers` | request_headers | `load.ExtractorScope.Headers` | `Search=Headers` |
| `URL` | url | `load.ExtractorScope.Url` | `Search=Noresource` |
| `code` | response_code | `load.ExtractorScope.Status` | (no VuGen equivalent) |
| `message` | response_message | `load.ExtractorScope.Status` | (no VuGen equivalent) |

### 4.5 CSVDataSet Parameterization

```xml
<CSVDataSet testname="User Data">
  <stringProp name="filename">users.csv</stringProp>
  <stringProp name="variableNames">username,password,email</stringProp>
  <stringProp name="delimiter">,</stringProp>
  <boolProp name="recycle">true</boolProp>
</CSVDataSet>
```

CSV columns are classified as **Tier 3 Test Data (EachIteration)** via Rule 0 — they bypass Rule 4 (empty = Dynamic safety net).

**DevWeb** (`parameters.yml`):
```yaml
- name: username
  type: csv
  fileName: users.csv
  columnName: username
  nextValue: iteration
  nextRow: sequential
- name: password
  type: csv
  fileName: users.csv
  columnName: password
  nextValue: iteration
  nextRow: same as username   ← subsequent columns from same file
```

**VuGen** (`ParameterFile.prm`):
```ini
[parameter:username]
GenerateNewVal=EachIteration
Table="users.csv"
Column=1
Delimiter=,
StartRow=0

[parameter:password]
GenerateNewVal=EachIteration
Table="users.csv"
Column=2
```

**CSV scope in multi-thread-group mode**:
- `CSVDataSet` at TestPlan level (`threadGroupIndex = -1`) → included in ALL thread group scripts
- `CSVDataSet` inside TG1's hashTree (`threadGroupIndex = 0`) → only in TG1's script
- Other TGs' CSV column names are actively removed from that TG's `environmentVars` to prevent spurious Tier-1 Dynamic params

### 4.6 User Defined Variables Scope

- Variables defined at TestPlan level → global (included in all scripts)
- Variables defined inside a specific ThreadGroup → tracked in `threadGroupVars` Map, only included in that TG's script in multi-mode

### 4.7 JSR223 / BeanShell Script Conversion

Scripts are stored as `{ code: string, lang: 'groovy'|'java'|'beanshell'|'javascript' }` on `req.preScripts[]` / `req.postScripts[]`.

**What is auto-converted** (both DevWeb and VuGen):

| Groovy/Java | DevWeb JS | VuGen C |
|---|---|---|
| `vars.put("x", val)` | `load.global.x = val` | `lr_save_string(val, "x")` |
| `vars.get("x")` (inline) | `load.global.x` | `lr_eval_string("{x}")` |
| `String x = UUID.randomUUID().toString()` | `const x = load.utils.uuid()` | `char x[64]; strcpy(x, lr_gen_unique_id())` |
| `def ts = System.currentTimeMillis()` | `const ts = Date.now()` | `char ts[64]; sprintf(ts, "%ld", (long)time(NULL)*1000)` |
| `String x = vars.get("y")` | `const x = load.global.y` | `const char *x = lr_eval_string("{y}")` |
| `import ...` / `package ...` | skipped | skipped |
| `log.info/debug/warn/error(...)` | silently dropped | silently dropped |

**What is NOT converted** (silently dropped, skipped count reported):
- Java class instantiation (`new JsonSlurper()`, `new HashMap()`, etc.)
- JMeter context APIs (`prev.getResponseDataAsString()`, `ctx.getCurrentSampler()`, etc.)
- `if/else`, `for`, `while` — control flow
- External library calls (Apache Commons, BouncyCastle, etc.)
- Complex Groovy expressions (closures, `?.`, `*:` spread)
- `SampleResult`, `AssertionResult`, `sampler` references

**Output format**: If any lines were skipped:
```javascript
// TODO: JSR223 Pre-processor (Groovy) — 3 lines need manual conversion. Review original JMX.
const corrId = load.utils.uuid();
load.global.correlation_id = corrId;
```
No inline TODO spam — one compact note at the top, auto-converted lines follow cleanly.

**Why full conversion is impossible**: JSR223 is arbitrary Java/Groovy running on a JVM with access to Apache libraries, JMeter internal APIs, and reflection. VuGen is C89. DevWeb is Node.js. The languages and runtime environments are fundamentally incompatible for arbitrary code translation.

### 4.8 JWT Detection in JMX

`detectJwtUsage()` scans all of:
- `item.event[]` (Bruno/Postman format)
- `item.tests[]` (JMX JSR223 format)
- `req.preScripts[]` / `req.postScripts[]` directly

Java/Groovy JWT fingerprints:

| Pattern | Algorithm |
|---------|-----------|
| `SHA256withRSAandMGF1` (BouncyCastle) | PS256 |
| `SHA256withRSA` | RS256 |
| `HmacSHA256` | HS256 |
| `import io.jsonwebtoken` + `SignatureAlgorithm.RS256` | RS256 |
| `KJUR.jws.JWS.sign(` | Already handled |
| `require('jsonwebtoken')` + `.sign(` | JS/Node |

When detected → generates same `jwt-helper.js` / `web_js_run()` code as Postman/Bruno JWT.

### 4.9 Authentication (from AuthManager)

```xml
<AuthManager>
  <stringProp name="Authorization.mechanism">NTLM</stringProp>
  <stringProp name="Authorization.username">admin</stringProp>
  <stringProp name="Authorization.password">secret</stringProp>
  <stringProp name="Authorization.domain">CORP</stringProp>
</AuthManager>
```

| Mechanism | DevWeb | VuGen |
|-----------|--------|-------|
| Basic | `credentials: { username, password }` | `web_set_user()` |
| NTLM | `enableIntegratedAuthentication: true` in rts.yml | `web_set_user()` + IntegratedAuthentication=1 in default.cfg |
| Kerberos/Negotiate | Same as NTLM | Same as NTLM + SPNCNameLookup=1 |
| Digest | Basic fallback | `web_set_user()` |

### 4.10 Logic Controllers

| Controller | Handling |
|---|---|
| `TransactionController` | → transaction wrapping T01, T02… (same as §3.6) |
| `LoopController` | → stamps `loopCount` on child requests, adds comment |
| `ForEachController` | → stamps `forEachInput`/`forEachVar`, adds comment |
| `WhileController` | → stamps `whileCondition`, adds comment |
| `IfController` | → stamps `ifCondition`, flattens children |
| `SimpleController` | → transparent (collect children, no effect) |
| `RandomOrderController` | → transparent (original order preserved) |

### 4.11 Multi-Thread-Group Mode

When JMX has >1 enabled thread group AND `mode=multi`:

```
outputDir/
  Login_TG/
    main.js (or Action.c)
    parameters.yml (or ParameterFile.prm)
    Login_TG_WLM.xlsx
  Order_TG/
    main.js (or Action.c)
    parameters.yml (or ParameterFile.prm)
    Order_TG_WLM.xlsx
  MyTest_WLM.xlsx   ← combined all TGs
```

- Each TG gets only its own CSVDataSets + global CSVDataSets
- Each TG gets its own variable map (no cross-TG bleed)
- SetUp thread group → mapped to `initialize()` / `vuser_init.c`
- TearDown thread group → mapped to `finalize()` / `vuser_end.c`
- Falls back to single-script mode when ≤1 enabled thread group

### 4.12 WLM Excel Output

Generated by `workloadExcelGenerator.js` (exceljs, MIT license).
3 sheets per file:
1. **Thread Groups**: Name, Type, VUs, Ramp-up (s), Hold (s), Ramp-down (s), Iterations, Think Time, Start Delay, Scenario Type
2. **Transactions List**: Name, Thread Group, Request Count
3. **LRE Setup Guide**: Static instructions for LRE configuration

Thread group types: Standard, SetUp, TearDown, Stepping, Ultimate, Concurrency, Arrivals.

### 4.13 Dependency Resolver

`jmxDependencyResolver.js` cross-checks CSVDataSet filenames against uploaded files.
Reports: `{ required[], found[], missing[], warnings[], summary }`.
Missing files are reported in the UI response but do NOT block conversion.

### 4.14 Supported File Uploads (JMX mode)

| Upload | Purpose |
|--------|---------|
| `.jmx` file | Mandatory — the test plan |
| CSV files (`.csv`) | Parameterization — copied to output ZIP |
| Certificate files (`.pem`, `.pfx`, `.p12`, `.jks`, `.cer`, `.crt`, `.key`) | Copied to output ZIP as extra files |

JAR files and `.properties` files are NOT accepted (JMeter-specific, no value in LoadRunner context).

---

## 5. What Cannot Be Converted (Both Modules)

| Feature | Why |
|---------|-----|
| JMeter JSR223 arbitrary code | JVM/Groovy → C/JS is not translatable beyond simple patterns |
| NTLM auth (VuGen) | Declared but not implemented — stub only |
| Cookie jar management | Not implemented |
| JMeter plugins (custom samplers, listeners) | Plugin classes are Java bytecode with no LR equivalent |
| JMeter `.properties` files | JMeter-internal engine config — not relevant to LR |
| Postman Visualizer scripts | UI-only, no LR equivalent |
| AWS Signature v4 (VuGen) | DevWeb only |
| Multipart/form-data body (VuGen) | `web_custom_request Body=` doesn't support multipart |
| JMeter functions: `${__Random}`, `${__groovy}`, `${__P}` | Stubbed as Tier-1 dynamic vars |
| OAuth2 PKCE flow | Not implemented |

---

## 6. Generated File Inventory

### DevWeb output
| File | Contents |
|------|---------|
| `main.js` | Full script: `load.initialize`, `load.action`, `load.finalize` |
| `parameters.yml` | All Tier 2 + Tier 3 parameters with CSV references |
| `rts.yml` | Runtime settings: think time, pacing, proxy, auth flags |
| `default.cfg` | Script config: encoding, log options |
| `default.usp` | User script profile: run logic |
| `[ScriptName].usr` | Script manifest: Type=DevWeb, ManuallyExtraFiles for JWT |
| `DevWebSdk.d.ts` | TypeScript type definitions (copied from project root) |
| `jwt-helper.js` | JWT signing helper (copied when JWT detected) |
| `transport.pem` | Private key placeholder (copied when JWT detected) |

### VuGen Web HTTP/HTML output
| File | Contents |
|------|---------|
| `Action.c` | Main action: `web_reg_save_param_*`, `web_custom_request`, transactions |
| `vuser_init.c` | Init: auth setup, JWT init, `web_add_auto_header` |
| `vuser_end.c` | Cleanup (minimal) |
| `globals.h` | `gen_uuid()`, `gen_csrf_token()`, `gen_hex64()` C functions |
| `ParameterFile.prm` | All Tier 2 + Tier 3 parameters (INI format) |
| `collection_data.csv` | Parameter values for non-CSV params |
| `default.cfg` | Full VuGen 26.1 canonical config (163 lines, 9 sections) |
| `[ScriptName].usr` | Script manifest with [TransactionsOrder] and [Transactions] |
| `jsrsasign.js` | jsrsasign library (copied when JWT detected) |
| `transport.pem` | Private key placeholder (copied when JWT detected) |

---

## 7. Architecture — Key Files

```
src/
  parsers/
    brunoParser.js          — Postman/Bruno all-format parser → internal Request[]
    jmxParser.js            — JMeter XML parser → internal Request[], CSVDataSet[], ThreadGroup[]
  converters/
    jmxConverter.js         — JMX orchestrator (single + multi-TG), CSV injection, env vars
  generators/
    advancedScriptGenerator.js  — DevWeb main.js generator (requests + auth + correlations + params)
    webHttpScriptGenerator.js   — VuGen Action.c generator
    workloadExcelGenerator.js   — WLM Excel (.xlsx) generator
    webHttpMandatoryFilesGenerator.js — VuGen mandatory files (cfg, usr, prm, etc.)
  analyzers/
    correlationDetector.js      — Two-pass correlation analysis + extractor code generation
    parameterizationEngine.js   — Raw variable value scanner (NOT 3-tier classifier)
    authenticationHandler.js    — Auth type detection + code generation
    customScriptParser.js       — Postman/Bruno test script → LR pattern extraction
  lib/
    memoryFsInterceptor.js      — AsyncLocalStorage fs write interceptor (web mode: no disk writes)
    jmxDependencyResolver.js    — CSV/cert file cross-check for JMX uploads
  web/
    server.js                   — Express web server (multer memoryStorage, ZIP stream)
    views/index.ejs             — Single-page UI
```

### Web Server Privacy Model
- `multer.memoryStorage()` — uploaded files stay in RAM, never touch disk
- `memoryFsInterceptor.js` — all `fs.writeFile/mkdir/copyFileSync` inside `runWithMemoryFs()` go to an in-memory `Map<path, content>` per request
- ZIP streamed directly from Map → browser (no disk, no Content-Length → chunked transfer)
- CLI usage is completely unaffected (interceptor only activates inside `runWithMemoryFs()`)

### Variable Classification Location
`classifyVariables()` lives INSIDE each generator (`advancedScriptGenerator.js` and `webHttpScriptGenerator.js`).
`parameterizationEngine.js` is a raw value scanner only — it does NOT do 3-tier classification.

### brunoParser Event Storage (critical)
Scripts are stored in `req.tests[]` (NOT `req.event[]`).
Always use: `const events = req.tests || req.event || [];`
Failure to do this = JWT not detected, script vars wrong.

### JMX Property Name Gotchas
- `RegexExtractor.match_no` (NOT `match_number`)
- `JSONPathExtractor.referenceName` (NOT `.refname` — that's the old plugin version)
- `BoundaryExtractor.useHeaders` (same values as RegexExtractor)
- String escaping: use `JSON.stringify(value)` everywhere in `generateExtractor()` — never template literals
