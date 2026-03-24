# Changelog

All notable changes to the Bruno to DevWeb Converter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),

## [2.8.x] - 2026-03-24

### Fixed — JMX: WLM Excel Corruption on Open

Excel reported "we found a problem with some content" on every generated `.xlsx`.
Root cause: ExcelJS writes `header` values into **row 1** when `ws.columns` includes
a `header` property, conflicting with the already-merged title cell in row 1.
Fix: removed `header` from all three `ws.columns` definitions in `workloadExcelGenerator.js`.
Column headers are now set only in their manually-assigned header rows (row 3 / row 4).

### Added — JMX: setUp/tearDown Thread Group Lifecycle Routing

JMeter setUp and tearDown thread groups are now correctly mapped to LoadRunner
lifecycle sections instead of being treated as regular action scripts:

**HTTP Samplers** in setUp/tearDown TGs:
- DevWeb → placed in `initialize()` / `finalize()` function
- VuGen  → placed in `vuser_init.c` / `vuser_end.c`

**JSR223 / BeanShell Samplers** in setUp/tearDown TGs:
- Cannot be auto-converted (Groovy/Java ↔ Node.js/C runtime incompatibility)
- Emit a single compact `// TODO: JSR223 setUp-sampler "<name>" (<lang>) — manual conversion required`
- Unconverted lines are silently dropped (no inline TODO spam per line)

**Multi-script mode**: setUp/tearDown TGs generate their own directory but
`action()` / `Action()` is empty — all content appears in init/finalize sections.

**Parser change** (`jmxParser.js`): standalone JSR223/BeanShell samplers
(not pre/post-processors) now carry `threadGroupType` so the converter can
route them to the correct lifecycle section.

### Fixed — JMX: Wrong collection_data.csv Content

`collection_data.csv` and `parameters.yml` were populated with JMeter-internal
variables (`nrThreads`, `rampUp`, `csvFile1`, `lines1`, etc.) instead of
real test data parameters.

**Root cause**: `buildCollection()` converts ALL JMX User Defined Variables into
`collection.variable[]`. Without filtering, vars like `nrThreads=50` and
`csvFile1=users.csv` entered `classifyVariables()` as Tier 2 Config params.

**Fix 1 — `resolveCsvFilenames()`** (`jmxConverter.js`):
Resolves `filename={{csvFile1}}` → `filename=users.csv` using the UDV lookup
before those path-variables are removed. Ensures `parameters.yml` points to
the real CSV filename.

**Fix 2 — `filterJmxCollectionVars()`** (`jmxConverter.js`):
Removes three categories from `collection.variable` before `classifyVariables()` runs:
- (A) Vars whose value ends in `.csv` (CSV path indirection vars)
- (B) Known JMeter execution/scheduling property names (nrThreads, rampUp, duration, loopCount, etc.)
- (C) Numeric-count pattern names (lines1, lineCount, rowCount, records1, etc.)

### Fixed — JMX: DevWeb showing 0 parameters

`getAnalysisReport()` in `advancedScriptGenerator.js` was reading
`this.paramEngine.getReport()` for parameter count. The raw `ParameterizationEngine`
scanner never sees JMX CSV-injected variables, so it always returned 0 for JMX files.
Fix: `totalParameters` now uses `this.parameters.size` (the generator's classified Map).

## [2.8.x] - 2026-03-23

### Fixed — JMX: Regex Pattern String Escaping

Regex patterns containing double quotes (e.g. `"token":"(.*?)"`) previously caused
`unexpected identifier` syntax errors in generated scripts.

- `correlationDetector.generateExtractor()` now uses `JSON.stringify()` for **all** string
  values (name, pattern, bounds, JSON path, header name, etc.) instead of template literals.
- Pattern `"token":"(.*?)"` → correctly emits `"\"token\":\"(.*?)\""` in both DevWeb JS and VuGen C.

### Fixed — JMX: Extractor Scope (Apply To) — Full Pipeline

JMeter's "Apply to" / `useHeaders` field was being ignored. Fixed across 3 layers:

**Parser** (`jmxParser.js`):
- Added `jmxScopeFromUseHeaders(raw)` mapping all 5 JMeter values:
  `false`→body, `true`→response_headers, `request_headers`, `URL`→url, `code`→response_code, `message`→response_message
- Fixed `JSONPathExtractor.referenceName` (JMeter 5.x) vs old `.refname` (plugin) property name
- Fixed `RegexExtractor.match_no` vs `match_number`

**Generators** (`advancedScriptGenerator.js`, `webHttpScriptGenerator.js`):
- `injectJmxExtractors()` now copies `scope` and `matchNumber` fields to the correlation object

**Emitters** (`correlationDetector.js`):
- `_dvScopeConst(scope)` maps scope → `load.ExtractorScope.Headers` / `.Url` / `.Status`
- `_parseMatchNo(matchNumber)` parses JMeter match number
- DevWeb: `new load.RegexpExtractor("name", "pattern", matchNo, load.ExtractorScope.Headers)`
- VuGen: `web_reg_save_param_regexp(...)` with `"Search=Headers"` / `"Search=Noresource"`

### Fixed — JMX: CSVDataSet Parameterization

CSV columns were incorrectly classified as Tier 1 Dynamic (`load.global` / `{_varName}`)
because they had empty values and were caught by the generic Rule 4 safety net.

**Root cause**: `injectCsvVariables()` injects CSV column names as empty-value variables.
Rule 4 (empty value → Dynamic) then misclassified them.

**Fix — RULE 0** added to `classifyVariables()` in both generators:
- CSV columns from `options.csvDataSets` are committed to `paramVarNames` **before** Rule 4 runs
- Rule 4 now skips vars already in `paramVarNames`
- `buildVariableMap()` builds `this.csvVarNames` Map: `col → { fileName, colIndex, delimiter, recycle }`
- Parameters map uses actual CSV file name, column index, delimiter from JMX config
- All columns from the same CSV file get `nextRow: same as <firstCol>` (advance together)

**Result (DevWeb `parameters.yml`)**:
```yaml
- name: username
  fileName: users.csv
  nextValue: iteration
  nextRow: sequential
- name: password
  fileName: users.csv
  nextValue: iteration
  nextRow: same as username
- name: productCode
  fileName: products.csv
  nextValue: iteration
  nextRow: sequential
```

**Result (VuGen `ParameterFile.prm`)**:
```ini
[parameter:username]
GenerateNewVal="EachIteration"
Table="users.csv"
Column="1"

[parameter:productCode]
GenerateNewVal="EachIteration"
Table="products.csv"
Column="1"
```

`collection_data.dat/csv` now only contains non-CSV static params.
`jmxConverter` skips `generateCsvParameterFiles()` for VuGen (generator handles it internally).

### Added — JMX: JSR223 / BeanShell Code Conversion

Custom Groovy/Java pre- and post-processor scripts are now converted to target-language
equivalents instead of being silently discarded.

**Both generators** have `convertJsr223Script({ code, lang }, phase, indent)`.

DevWeb JS conversions:
| Groovy/Java | DevWeb JS |
|---|---|
| `String x = UUID.randomUUID().toString()` | `const x = load.utils.uuid()` |
| `def ts = System.currentTimeMillis()` | `const ts = Date.now()` |
| `vars.put("x", val)` | `load.global.x = val` |
| `String y = vars.get("x")` | `const y = load.global.x` |
| `log.info(...)` | `// log.info(...)` |
| unrecognised line | `// TODO: <line>` |

VuGen C conversions:
| Groovy/Java | VuGen C |
|---|---|
| `String corrId = UUID.randomUUID().toString()` | `char corrId[64]; strcpy(corrId, lr_gen_unique_id())` |
| `def ts = System.currentTimeMillis()` | `char ts[64]; sprintf(ts, "%ld", (long)time(NULL)*1000)` |
| `vars.put("x", val)` | `lr_save_string(val, "x")` |
| `String y = vars.get("x")` | `const char *y = lr_eval_string("{x}")` |
| `log.info(...)` | `/* log.info(...) */` |
| unrecognised line | `/* TODO: <line> */` |

`parseScriptNode()` in `jmxParser.js` now returns `{ code, lang }` (lang: groovy/java/javascript/beanshell).

### Fixed — JMX: JWT Detection in JSR223 Scripts

`detectJwtUsage()` now scans `item.tests[]` and `req.preScripts[]`/`req.postScripts[]` in
addition to `item.event[]` — ensuring JWT detection works for JMX collections where scripts
are stored in `tests[]` (not `event[]`).

Java/Groovy JWT fingerprints detected: `SHA256withRSAandMGF1`, `SHA256withRSA`, `HmacSHA256`,
`import io.jsonwebtoken` + `SignatureAlgorithm.*`, plus all existing JS patterns.

---

## [2.7.0] - 2026-03-13

### Added — Web Server: No-Disk Privacy Model

All conversion work now happens entirely in RAM — no files are written to disk on the server.

- **`multer.memoryStorage()`** — uploaded collection and environment files stay in RAM only.
- **`src/lib/memoryFsInterceptor.js`** — new module using `AsyncLocalStorage` to intercept all
  `require('fs')` calls (sync + async) across the entire codebase. Inside each web request,
  `writeFile`, `writeFileSync`, `mkdir`, `mkdirSync`, `copyFileSync` are captured in a
  per-request `Map<path, content>`. CLI usage is completely unaffected.
- **ZIP streamed directly from memory** — `archiver` pipes the Map entries straight into the
  HTTP response. No ZIP file is ever created on disk.
- **No `Content-Length` header** — chunked transfer encoding bypasses corporate proxy
  size-based download restrictions.
- **`Content-Type: application/octet-stream`** — avoids zip-specific proxy/firewall filters.
- Download tokens are single-use with a 5-minute TTL.

### Changed — Generated Scripts: All Log Statements Removed

All `load.log()` calls removed from DevWeb `main.js`:
- Lifecycle: `load.log('Initializing Vuser ...')`, `load.log("✓ Initialization complete")`,
  `load.log('Action iteration ...')`, `load.log("✓ Action complete")`,
  `load.log('Finalizing Vuser ...')`, `load.log("✓ Finalization complete")`
- JWT: `load.log('JWT token generated')`, `load.log('JWT token refreshed')`
- Error/validation: `load.log(\`${name} failed with status ...\`, load.LogLevel.error)`,
  `load.log("${name} validation failed", load.LogLevel.error)`
- Per-request: `load.log(\`${name} - Status: ${response.status}\`, load.LogLevel.info/debug)`

All `lr_output_message()` calls removed from VuGen scripts:
- `vuser_init.c`: startup log, parameters loaded log, base URL log, JWT token generated log
- `vuser_end.c`: finished log
- `Action.c`: per-request `"${name} - completed"` log

### Changed
- `package.json` version: `2.6.1` → `2.7.0`

---

## [2.6.1] - 2026-03-11

### Changed — DevWeb: Transaction declarations at module level (before initialize)

All `load.Transaction` objects are now declared once at module scope — before `load.initialize()`, alongside `require`, `load.setUserCertificate`, and `load.WebRequest.defaults`.

`action()` only emits `T01.start()` and `T01.stop()` — no inline `let T01 = new load.Transaction(...)`.

**Implementation**: `buildTransactionMap()` pre-computes all `{txVar, txName}` pairs inside `generateAction()` (which runs before `generateHeader()` in the template literal). `generateHeader()` reads `this.requestTxMap` to emit all declarations.

### Changed
- `package.json` version: `2.6.0` → `2.6.1`

---

## [2.6.0] - 2026-03-10

### Added — Per-Request Transactions (both protocols)

Each API request is now its own LR transaction, named `T{nn}_{RequestName}`.
The sequential counter runs **globally across all folders**, so transaction numbers are unique and ordered throughout the entire script.

**Transaction naming pattern**: `T01_GenerateJWTAndRetrieveAccessToken`, `T02_ProtectedAPI2`, etc.

**Folder handling** (all edge cases covered):
- **Flat collection** (no folders): `T01_Request1`, `T02_Request2` — sequential from the start
- **Single folder**: requests numbered in order inside the folder
- **Multiple folders**: counter continues across folders (`T01-T02` in Auth, `T03-T04` in Products)
- **Sub-folders** (e.g. `Products/Electronics`): request name used for transaction, outer folder path shown as comment
- **Duplicate request names**: always unique because of the sequential number prefix

**DevWeb (`main.js`):**
```javascript
let T01 = new load.Transaction("T01_GenerateJWTAndRetrieveAccessToken");
T01.start();
const webResponse_01 = new load.WebRequest({...}).sendSync();
load.global.access_token = webResponse_01.extractors["access_token"];
T01.stop(load.TransactionStatus.Passed);
load.sleep(1);

let T02 = new load.Transaction("T02_ProtectedAPI2");
T02.start();
const webResponse_02 = new load.WebRequest({...}).sendSync();
T02.stop(load.TransactionStatus.Passed);
```

**VuGen Web HTTP/HTML (`Action.c`):**
```c
lr_start_transaction("T01_Generate_JWT_and_Retrieve_Access_Token");
GEN_UNIQUE_ID("_interaction_id");
web_reg_save_param_json("access_token", "QueryString=$.access_token", "Ord=1", LAST);
web_custom_request("...", ...);
lr_end_transaction("T01_Generate_JWT_and_Retrieve_Access_Token", LR_AUTO);

lr_think_time(1);

lr_start_transaction("T02_Protected_API_2");
web_url("...", ...);
lr_end_transaction("T02_Protected_API_2", LR_AUTO);
```

**VuGen `.usr` [TransactionsOrder]** now contains all per-request transaction names automatically.

### Changed
- `generateGroupedActions()` and `generateSequentialActions()` in `advancedScriptGenerator.js` — replaced folder-level transactions with per-request transactions
- `generateGroupedRequests()` and `generateSequentialRequests()` in `webHttpScriptGenerator.js` — same change
- Folder grouping preserved as code comments for readability and think-time separation
- `package.json` version: `2.5.5` → `2.6.0`

---
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.5.5] - 2026-03-10

### Fixed — Extractor name consistency

In v2.5.4, the extractor was registered with sanitized name `"jsrassign_js"` but accessed with the original hyphenated name `"jsrassign-js"` — a mismatch that causes the DevWeb script to fail at runtime.

**Root cause**: `generateRequestCode()` used `"${corr.name}"` (original) for the accessor while `generateExtractors()` used `sanitizeVarName(corr.name)` (sanitized) for registration.

**Fix**: Both registration and accessor now use the SAME sanitized name:
```javascript
// BEFORE (broken — mismatch):
new load.JsonPathExtractor("jsrassign_js", "$.body")          // sanitized name
load.global.jsrassign_js = response.extractors["jsrassign-js"]; // original name → fails

// AFTER (correct — consistent):
new load.JsonPathExtractor("jsrassign_js", "$.body")
load.global.jsrassign_js = response.extractors["jsrassign_js"]; // same name ✓
```

### Confirmed Working — access_token correlation

The 2-pass correlation algorithm correctly detects `access_token` for the Postman JWT collection:
- **Produced by**: request "01 - Generate JWT..." via `pm.environment.set('access_token', json.access_token)` → `extractPath: $.access_token`
- **Consumed by**: all 34 subsequent requests via `Authorization: Bearer {{access_token}}` header
- **Generated**: `new load.JsonPathExtractor("access_token", "$.access_token")` on the producing request
- **Assignment**: `load.global.access_token = webResponse_01.extractors["access_token"]`
- **Not in parameters.yml** ✓ (Tier 1 Dynamic)
- **VuGen**: `web_reg_save_param_json("access_token", "QueryString=$.access_token", ...)` ✓

If `access_token` appears to be missing, the output folder is likely stale — regenerate with `node src/cli.js convert -i collection.json -o output/`.

### Changed
- `package.json` version: `2.5.4` → `2.5.5`

---

## [2.5.4] - 2026-03-10

### Fixed

**Issue 1 — Hyphenated variable names in extractor assignment**

`load.global.jsrsasign-js = response.extractors.jsrsasign-js` is invalid JavaScript (hyphen is subtraction). Fixed in two places:

1. `generateRequestCode()`: Now uses `sanitizeVarName(corr.name)` for the `load.global.X` property and bracket notation `extractors["original-name"]` for the response accessor — ensuring the JS identifier is valid while the extractor lookup still works.

2. `generateExtractors()`: Passes a sanitized copy of the correlation to `generateExtractor()` so the extractor name registered on the WebRequest is also a valid JS key.

Result:
```javascript
// BEFORE: invalid JS
new load.JsonPathExtractor("jsrsasign-js", "$.body")
load.global.jsrsasign-js = webResponse_01.extractors.jsrsasign-js;

// AFTER: valid JS
new load.JsonPathExtractor("jsrsasign_js", "$.body")
load.global.jsrsasign_js = webResponse_01.extractors["jsrsasign_js"];
```

**Issue 2 — Bruno JSON export: post-response scripts not detected**

Bruno JSON export (not Postman format) stores scripts in `item.script.req` (pre-request) and `item.script.res` (post-response) — a completely different structure from Postman's `item.event[]`. Neither `brunoParser.normalizeRequest()` nor `correlationDetector.extractTestScript()` handled this format.

Fixes:
- **`brunoParser.normalizeRequest()`**: When `item.event` is empty, checks `item.script.req/res` and converts to `req.tests[]` format, enabling all downstream analysis.
- **`correlationDetector.extractTestScript()`**: Added fallback to `request.script.res` as option 3.
- **`correlationDetector.extractPreRequestScript()`**: Added fallback to `request.script.req`.

This means `bru.setEnvVar('access_token', res.body.access_token)` in a Bruno JSON collection's post-response script is now correctly detected, `access_token` is correlated, and `JsonPathExtractor("access_token", "$.access_token")` is generated.

### Changed
- `package.json` version: `2.5.3` → `2.5.4`

---

## [2.5.3] - 2026-03-10

### Fixed — brunoParser.js syntax error + Generic dynamic variable rule

**Critical fix: brunoParser.js line 85** had a syntax error (`vars' {}` instead of `vars {'`) that caused the entire conversion to crash. Fixed.

**Generic Rule 4 — Empty value = Dynamic (both generators):**

The root cause of `access_token` in parameters was that empty-value variables were not reliably classified as Tier 1 dynamic. Added an explicit rule to both `advancedScriptGenerator.classifyVariables()` and `webHttpScriptGenerator.classifyVariables()`:

> *If a variable has an empty/null value in the collection or environment file, AND it is not a credential (username/password/email), classify it as Tier 1 Dynamic.*

This is the correct generic rule because:
- **Static config vars** (baseUrl, clientId, apiKey, scope) **always have real values** in the collection
- **Runtime vars** (access_token, refresh_token, interaction_id, jwt_token) are intentionally **left empty** — they are filled at runtime from API responses

The 5 classification rules are now (in priority order):
1. Script-set vars (pm.*.set, bru.setEnv, etc.) → Tier 1 Dynamic
2. Correlation targets → Tier 1 Dynamic
3. `_` prefix → Tier 1 Dynamic (regardless of value)
4. **Empty value + not credential → Tier 1 Dynamic** ← NEW GENERIC RULE
5. Everything else with a real value → Tier 2 Config (once) or Tier 3 Test Data (iteration)

**Library name exclusion strengthened** (`LIBRARY_KEYWORDS` vs `LIBRARY_NAMES`):

The old check `jsrsasign` matched exactly but missed variants like `jsrsasign-js`. Replaced with keyword-prefix matching — any variable whose sanitized lowercase name starts with, ends with, or equals a known library keyword is excluded from `load.global` initialization.

### Changed
- `package.json` version: `2.5.2` → `2.5.3`

---

## [2.5.2] - 2026-03-10

### Fixed — Bruno Collections: access_token in parameters.yml + not correlated

**Root cause**: `advancedScriptGenerator.detectScriptSetVariables()` only scanned `item.event[]` in the raw collection object. For Bruno YAML collections parsed by brunoParser, scripts are stored in `req.tests[]` on normalized requests — not in `item.event[]`. So for Bruno collections, script-set variables like `access_token`, `refresh_token` were **never added to `scriptSetVarNames`**, causing them to fall through to Tier 2 (static parameters) instead of Tier 1 (dynamic runtime).

**Fixes applied:**

1. **`advancedScriptGenerator.detectScriptSetVariables()`**: Added second scan of `this.requests[]` using `req.tests || req.event || []` — same pattern already working in `webHttpScriptGenerator`. This ensures script-set variables are correctly classified as Tier 1 dynamic for ALL collection formats (Postman JSON, Bruno JSON, Bruno YAML, `.bru`).

2. **`correlationDetector.extractTestScript()`**: Made robust for all event formats — handles `req.tests[]` (brunoParser), `req.event[]` (Postman), `script.exec` as Array or String, `script` as plain String. Previously returned `null` early if tests array existed but format was unexpected, missing the actual script.

3. **`correlationDetector.extractPreRequestScript()`**: Same robustness fix applied — now checks both `req.tests[]` and `req.event[]`.

**Result:**
- `access_token`: NOT in `parameters.yml` ✓, correlated as `load.global.access_token` ✓, `JsonPathExtractor("access_token","$.access_token")` generated ✓
- Works for Postman JSON AND Bruno YAML/JSON/.bru collections

### Changed
- `package.json` version: `2.5.1` → `2.5.2`

---

## [2.5.1] - 2026-03-10

### Fixed

**Bug 1 — `load.global.jsrsasign-js = null` — invalid JavaScript identifier**

Variable names containing hyphens (e.g., `jsrsasign-js`, `access-token`, `my-api-key`) are not valid JavaScript identifiers. These appeared in generated DevWeb scripts when Postman globals stored library code (e.g. jsrsasign) under a hyphenated key.

- Added `sanitizeVarName(name)` method to `advancedScriptGenerator.js` — converts any non-identifier characters to `_`
- Applied in `generateGlobalVariablesInit()` and `replaceParameters()` so all generated `load.global.X` and `load.params.X` references use sanitized names
- Also expanded `LIBRARY_NAMES` exclusion filter to catch variants like `jsrsasign-js`

**Bug 2 — `access_token` (and other tokens) not correlated when used as `Bearer {{access_token}}`**

The root cause: `detectConsumedValues()` used `isVariablePattern(value)` to check header values, which only matched when the *entire* value was a variable (`{{access_token}}`). Values like `Bearer {{access_token}}` failed the check because of the `"Bearer "` prefix, so the consumer was never matched to the producer.

- Fixed `detectConsumedValues()` to use `findVariablesInString(value)` for header values — extracts all embedded `{{varName}}` references regardless of surrounding text
- Applied same fix to `findVariablesInBody()` — body values like `grant_type=cc&client_assertion={{jwt_token}}` now correctly identify `jwt_token` as consumed
- Added full Bruno getter API coverage to `extractUsedVariables()`: `bru.getEnvVar()`, `bru.getGlobalVar()`, `bru.getCollectionVar()`, legacy `env.get()` / `vars.get()`

**Result**: Generated scripts now correctly produce:
```javascript
// In request that produces access_token:
new load.JsonPathExtractor("access_token", "$.access_token")
load.global.access_token = webResponse_01.extractors.access_token;

// In all subsequent requests that consume it:
"Authorization": `Bearer ${load.global.access_token}`
```

### Changed
- `package.json` version: `2.5.0` → `2.5.1`

---

## [2.5.0] - 2026-03-10

### Added — Complete Bruno + Postman API Coverage for Correlation Detection

Full implementation of all Bruno runtime variable setter APIs, response access patterns,
header/cookie extractor generation for both DevWeb and VuGen Web HTTP/HTML.

#### Bruno Setter APIs — ALL now detected (correlationDetector + both generators)

| API | Scope | Status |
|-----|-------|--------|
| `bru.setEnv("x", v)` | Env (old alias) | ✅ v2.4.9 |
| `bru.setEnvVar("x", v)` | Env (primary) | ✅ v2.4.9 |
| `bru.setVar("x", v)` | Collection / Request | ✅ v2.4.9 |
| `bru.setGlobalVar("x", v)` | Global | ✅ **NEW v2.5.0** |
| `bru.setNextEnvVar("x", v)` | Next environment | ✅ **NEW v2.5.0** |
| `env.set("x", v)` | Legacy 1.x | ✅ v2.4.9 |
| `vars.set("x", v)` | Legacy | ✅ v2.4.9 |
| `pm.environment.set("x", v)` | Postman compat | ✅ |

#### Bruno Response Access Patterns — ALL now detected

| Pattern | Result | Type |
|---------|--------|------|
| `res.body.access_token` | `$.access_token` | json |
| `res.body.user.id` | `$.user.id` | json |
| `res.body?.data?.token` | `$.data.token` | json |
| `body?.access_token` | `$.access_token` | json |
| `res.headers["x-csrf-token"]` | `x-csrf-token` | **header** |
| `res.headers.authorization` | `authorization` | **header** |
| `res.cookies["session_id"]` | `session_id` | **cookie** |
| `pm.response.json().field` | `$.field` | json |

#### Header & Cookie Extractor Generation

**DevWeb JavaScript** (`load.BoundaryExtractor` with header scope):
```javascript
new load.BoundaryExtractor("csrf_token", "x-csrf-token: ", "\r\n", load.ExtractorScope.Headers)
new load.BoundaryExtractor("session_id", "session_id=", ";", load.ExtractorScope.Headers)
```

**VuGen Web HTTP/HTML C** (`web_reg_save_param` with `Search=Headers`):
```c
web_reg_save_param("csrf_token", "LB=x-csrf-token: ", "RB=\r\n", "Search=Headers", "Ord=1", LAST);
web_reg_save_param("session_id", "LB=session_id=", "RB=;", "Search=Headers", "Ord=1", LAST);
```

#### Indirect Variable Resolution

The `extractSetVariables()` method now resolves indirect assignments:
```javascript
// Indirect body alias
var respBody = res.body;
bru.setEnvVar("refresh_token", respBody.refresh_token);  // → $.refresh_token  ✓

// Indirect with property chain
let body2 = pm.response.json();
bru.setEnvVar("token", body2.data.access_token);         // → $.data.access_token  ✓
```

#### New Helper Methods in `correlationDetector.js`
- `extractHeaderName(source)` — extracts HTTP header name from `res.headers["name"]` etc.
- `extractCookieName(source)` — extracts cookie name from `res.cookies["name"]` etc.

### Changed
- `package.json` version: `2.4.9` → `2.5.0`

---

## [2.4.9] - 2026-03-10

### Fixed — Bruno Collection Compatibility (Full Runtime API Support)

**Root cause**: Bruno test/post-response scripts use different APIs to set environment variables compared to Postman. The correlation detector only recognised Postman patterns, so variables like `access_token` set via `bru.setEnv()` were invisible to the extractor.

**All Bruno setter APIs now recognised** in `correlationDetector.js`, `advancedScriptGenerator.js`, and `webHttpScriptGenerator.js`:

| API | Type | Notes |
|-----|------|-------|
| `bru.setEnv("var", value)` | **Primary Bruno** (modern) | Was missing — root cause of bug |
| `bru.setEnvVar("var", value)` | Bruno alias | Was missing |
| `bru.setVar("var", value)` | Bruno collection-scoped | Already present |
| `env.set("var", value)` | Bruno 1.x legacy | Was missing |
| `vars.set("var", value)` | Bruno legacy | Was missing |
| `pm.environment.set()` etc. | Postman | Already present |

**JSON path extraction for Bruno body patterns** in `extractJsonPath()`:
- `body?.access_token` → `$.access_token`  (Bruno optional chaining)
- `res.body?.data?.token` → `$.data.token`
- `response.body?.field` → `$.field`

**Indirect variable resolution** in `extractSetVariables()`:
```javascript
let id = body?.access_token;       // local var map: id → body?.access_token
bru.setEnv("access_token", id);   // resolves id → $.access_token  ✓
```
```javascript
let body2 = pm.response.json();   // local var map: body2 → pm.response.json()
env.set("refresh_token", body2.refresh_token);  // resolves → $.refresh_token  ✓
```

### Bruno Export Formats Supported
| Format | Works | Notes |
|--------|-------|-------|
| Bruno → Export as Postman v2.1 JSON | ✅ | `info.schema` URL present, same as Postman |
| Bruno → Export as Bruno JSON | ✅ | `items[]` array, no schema |
| Bruno YAML folder (opencollection.yml) | ✅ | Directory input |
| Single .bru file | ✅ | Request-level script parsing |
| Environment as .bru file | ✅ | Parsed as key-value pairs |

### Changed
- `package.json` version: `2.4.8` → `2.4.9`

---

## [2.4.8] - 2026-03-10

### Added — Proxy Auto-Detection (both protocols)

`detectProxyConfig()` scans collection variables and the environment file for proxy settings.
**Only applies when proxy is found** — zero changes when no proxy detected.

**Detected variable names** (first match wins):
- Full URL: `proxy`, `proxyUrl`, `proxy_url`, `http_proxy`, `HTTP_PROXY`, `https_proxy`, `HTTPS_PROXY`, `proxyServer`, `proxy_server`
- URL format: `http://user:pass@host:port` or bare `host:port`
- Separate: `proxyHost` + `proxyPort` (+ optional `proxyUser` + `proxyPassword`)

**DevWeb (`rts.yml` proxy section)** — when proxy found:
```yaml
proxy:
  useProxy: true
  proxyServer: 'userproxy-pnf.web.banksvcs.net:8080'
  proxyUser: 'karrirc'
  proxyPassword: 'myPass123'
  proxyAuthenticationType: 'basic'
```

**VuGen Web HTTP/HTML (`default.cfg` [WEB] section)** — when proxy found:
```ini
ProxyUseProxy=1
ProxyUseBrowser=0
ProxyUseProxyServer=1
ProxyHTTPHost=userproxy-pnf.web.banksvcs.net
ProxyHTTPPort=8080
ProxyHTTPSHost=userproxy-pnf.web.banksvcs.net
ProxyHTTPSPort=8080
ProxyUseSame=1
ProxyUserName=karrirc
ProxyPassword=myPass123
```

### Also — JWT Detection Explanation

JWT code is generated **only** when `customScriptParser.detectJwtUsage(script)` finds these fingerprints in a pre-request script:
- `jsrsasign` / `KJUR.jws.JWS.sign(` — jsrsasign library
- `require('jsonwebtoken')` + `.sign(` — jsonwebtoken library
- `require('jose')` — jose library
- `crypto.sign(` + `base64url` — manual crypto JWT

For **all other collections** (no JWT fingerprint): `hasJwt = false` — zero JWT code emitted.
Headers, correlations, UUIDs, auth, and proxy all work for every collection regardless.

### Changed
- `package.json` version: `2.4.7` → `2.4.8`

---

## [2.4.7] - 2026-03-10

### Fixed — VuGen Web HTTP/HTML `default.cfg`

`generateDefaultCfg()` in `webHttpMandatoryFilesGenerator.js` now generates the complete canonical VuGen 26.1 `default.cfg` for the Web HTTP/HTML (QTWeb) protocol.

**Added 9 sections, 163 lines total** (was 6 sections, ~15 lines):

| Section | Key additions |
|---------|--------------|
| `[General]` | `ContinueOnError`, `FailTransOnErrorMsg`, `UseThreads`, `Replay64bit`, VTS ports |
| `[ThinkTime]` | `ThinkTimeRandomLow`, `ThinkTimeRandomHigh` |
| `[Iterations]` | (unchanged) |
| `[Log]` | `AutoLog`, `LogDetail`, `IncludeEnvInfo`, `PrintTimeStamp` |
| `[WEB]` | Full browser emulation: `UseCustomAgent`, `CustomUserAgent`, `SimulateCache`, proxy settings, HTTP/2, timeouts, SSL, NTLM, JS engine settings, encoding — 80+ settings |
| `[ModemSpeed]` | NEW — modem speed simulation settings |
| `[Streaming]` | NEW — streaming/WebSocket settings |
| `[FILTERS]` | NEW — URL filter lists |
| `[Java]` | NEW — external JVM settings |

### Changed
- `package.json` version: `2.4.6` → `2.4.7`

---

## [2.4.6] - 2026-03-10

### Added — VuGen C Per-Request Generator Functions

Replaced the `#define GEN_UNIQUE_ID` macro with three proper C `static` functions defined in `globals.h`. Functions are clean single-line calls instead of multi-line macro expansions. Pattern taken directly from VuGen Script Studio correlation engine (`lr_param_sprintf` with RFC 4122 UUID format).

**`globals.h` — Three generator functions:**

| Function | Format | Use for |
|----------|--------|---------|
| `gen_uuid(param_name)` | `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` (UUID v4) | `x-fapi-interaction-id`, `x-request-id`, `jti` |
| `gen_csrf_token(param_name)` | 32-char hex (16 random bytes) | `x-xsrf-token`, `x-csrf-token`, `x-xsrf-header` |
| `gen_hex64(param_name)` | 64-char hex (32 random bytes / 256-bit) | `x-nonce`, high-entropy state params |

**Usage in `Action.c`** (clean, one line per request):
```c
gen_uuid("_interaction_id");
web_add_header("x-fapi-interaction-id", "{_interaction_id}");

gen_csrf_token("_xsrfToken");
web_add_header("x-xsrf-token", "{_xsrfToken}");
```

### Added — CSRF/XSRF Header Auto-Detection

`webHttpScriptGenerator.analyze()` now scans all request headers for CSRF/XSRF pattern names. When a header key matches (e.g., `x-xsrf-token`, `x-csrf-header`, `x-anti-forgery-token`), the referenced variable is automatically classified as per-request generated (`gen_csrf_token()`) without needing a matching `pm.variables.set()` in a pre-request script.

Detection pattern list (from VuGen Script Studio):
`x-csrf-token`, `x-xsrf-token`, `x-xsrf-header`, `csrf-token`, `x-anti-forgery-token`, `x-request-verification-token`, plus regex `/csrf|xsrf|antiforg|request.?verif/i`.

### Added — Extended script pattern detection in `customScriptParser.detectPerRequestDynamicVars()`

New patterns recognised:
- `CryptoJS.lib.WordArray.random()` / `CryptoJS.enc.*` → `generationType: 'csrf'` → `gen_csrf_token()`
- `.toString(16)` / `.toString('hex')` → `generationType: 'hex64'` → `gen_hex64()`
- `crypto.randomBytes()` → `generationType: 'hex32'` → `gen_csrf_token()`
- Added `isCsrfHeaderName(headerKey)` static method for reuse across the codebase

### Changed
- `package.json` version: `2.4.5` → `2.4.6`

---

## [2.4.5] - 2026-03-10

### Added — Smart Header Classification (both protocols)

**DevWeb (JavaScript):**
- `analyzeCommonHeaders()` detects which headers appear in ≥70% of requests with the same value and classifies them as `staticGlobal` (static values) or `authGlobal` (dynamic token headers).
- **Static global headers** (e.g., `x-client-id`, browser baseline) → emitted once in module-level `load.WebRequest.defaults.headers` — applied to ALL requests automatically.
- **Auth global headers** (e.g., `Authorization: Bearer ${load.global.access_token}`) → applied via `Object.assign(load.WebRequest.defaults.headers, {...})` at the start of `action()` AFTER the token is available.
- **Per-request headers** (e.g., `x-fapi-interaction-id` with UUID, `Content-Type` that varies) → still emitted per-request only.
- `generateHeaders()` skips headers already in global defaults — individual request code is clean.

**VuGen Web HTTP/HTML (C):**
- `analyzeCommonHeaders()` performs same classification.
- **Static global headers** → `web_add_auto_header("key", "value")` at the top of `Action()` — persists for ALL subsequent requests (unlike `web_add_header()` which applies to only the next request).
- **Per-request headers** (UUID, Content-Type) → `web_add_header()` before each specific request only.
- `generateAddHeaders()` skips keys already set via `web_add_auto_header()`.

### Added — VuGen JWT via web_js_run() + web_set_certificate_ex()

At the start of `Action()` when JWT is detected:
```c
/* mTLS Certificate */
web_set_certificate_ex("CertFilePath=transport.pem","CertFormat=PEM","KeyFilePath=transport.pem","KeyFormat=PEM",LAST);

/* Generate JWT via jsrsasign.js using VuGen's built-in JavaScript engine */
web_js_run("Code=createJWT(LR.getParam('client_id'),...);","ResultParam=_jwt_token",SOURCES,"File=jsrsasign.js",ENDITEM,LAST);
```
`ResultParam=_jwt_token` stores the token as `{_jwt_token}` (consistent with the `_` prefix convention used throughout the script in request bodies).

### Fixed
- **DevWeb `load.WebRequest.defaults.headers` auth update** moved from module level (where `access_token` is null) to start of `action()` after token refresh.
- **DevWeb `load.global.jwt_token = null`** reinitializing removed — JWT output vars are now skipped in the global-variable initialization block since `getJwtToken()` has already set them.
- **VuGen `ResultParam=_jwt_token`** — consistent with `{_jwt_token}` used in request body `client_assertion={_jwt_token}`.

### Changed
- `package.json` version: `2.4.4` → `2.4.5`

---

## [2.4.4] - 2026-03-10

### Fixed — DevWeb & VuGen JWT Code Quality

**DevWeb:**
- `const { getJwtToken } = require('./jwt-helper.js')` moved to **top of main.js** (module scope, before `load.initialize`) so it is available in both `initialize()` and `action()` without re-requiring.
- `load.setUserCertificate('./cert.pem', './key.pem')` is now **active code** in `initialize()` (not commented out).
- `action()` JWT refresh block no longer contains a `require` call — uses the top-level declaration.

**VuGen Web HTTP/HTML:**
- JWT output variables (e.g., `jwt_token`) are now classified as **static parameters** (`GenerateNewVal="Once"`) in `ParameterFile.prm` instead of correlation targets. VuGen C cannot sign JWTs at runtime — the token must be pre-generated and stored in `collection_data.dat`.
- `{jwt_token}` (no underscore) is used in `Action.c` body — it's a static parameter the user pre-populates.
- `vuser_init.c` contains **active validation code** that aborts the test if `{jwt_token}` is empty, with clear pre-generation instructions.
- JWT detection now scans **pre-request script only** (not test script) when extracting JWT output variable names. This prevents `access_token` and `refresh_token` (set in test scripts from API responses) from being incorrectly classified as JWT tokens.
- `generate_jwt.js` is no longer generated (removed in v2.4.3 — `jsrsasign.js` + `transport.pem` in `[ManuallyExtraFiles]` is the correct VuGen approach).

### Changed
- `package.json` version: `2.4.3` → `2.4.4`

---

## [2.4.3] - 2026-03-10

### Added
- **DevWeb — Active JWT initialization in `initialize()`**: When JWT signing (jsrsasign/PS256) is detected, `initialize()` now emits working code instead of commented-out TODO blocks:
  ```javascript
  const { getJwtToken } = require('./jwt-helper.js');
  // load.setUserCertificate('./cert.pem', './key.pem');  // uncomment for mTLS
  load.global.jwt_token = getJwtToken(load.params);
  load.global.jwt_expires_at = Date.now() + (9 * 60 * 1000);
  ```
- **DevWeb — Active JWT refresh in `action()`**: Auto-refresh block is now live code, not comments:
  ```javascript
  if (!load.global.jwt_token || Date.now() >= load.global.jwt_expires_at) {
      const { getJwtToken } = require('./jwt-helper.js');
      load.global.jwt_token = getJwtToken(load.params);
      load.global.jwt_expires_at = Date.now() + (9 * 60 * 1000);
  }
  ```
- **`globals.h` — `GEN_UNIQUE_ID(param_name)` macro**: Replaces the repeated inline C block for per-request UUID generation. Clean single-line usage: `GEN_UNIQUE_ID("_interaction_id");`
- **`jwt-helper.js` added to project root**: Copied from `src/analyzers/jwt-helper.js` to the project root so the DevWeb generator can copy it to each output folder.

### Fixed
- **Removed TODO/comment-only JWT blocks**: Previously all JWT code was commented out with `// TODO:` markers. Now emits active, working code when JWT is detected.
- **`load.global.jsrsasign = null;` removed**: The jsrsasign library name (stored in Postman globals as the library source) was incorrectly appearing as a runtime variable. Added a `LIBRARY_NAMES` exclusion set in `generateGlobalVariablesInit()` to filter out known library names (`jsrsasign`, `KJUR`, `CryptoJS`, `forge`, etc.).
- **`generate_jwt.js` removed from VuGen output**: This standalone Node.js helper is no longer generated — users use `jsrsasign.js` directly for VuGen JWT workflows. Removed from `[ManuallyExtraFiles]` and `ScriptUploadMetadata.xml` entries.
- **VuGen per-request C code**: Replaced multi-line inline UUID blocks with clean `GEN_UNIQUE_ID("_interaction_id");` macro call (defined in `globals.h`).
- **`jwt-helper.js` project root only**: Removed the `src/analyzers/` fallback from `copyFromProjectRoot()`. All shared files (`jwt-helper.js`, `jsrsasign.js`, `transport.pem`, `DevWebSdk.d.ts`) must be in the project root.

### Changed
- `package.json` version: `2.4.2` → `2.4.3`

---

## [2.4.2] - 2026-03-10

### Fixed — VuGen Web HTTP/HTML

- **Root cause: events stored as `req.tests` not `req.event`** — The `brunoParser` normalizes Postman/Bruno events into `req.tests[]` but `webHttpScriptGenerator.analyze()` was looking for `req.event[]`. Result: JWT detection never fired, per-request UUID vars never detected, script-set variable scanning partially broken. Fixed by using `req.tests || req.event || []` in all three places (`analyze()`, `detectScriptSetVariables()`).
- **`jsrsasign.js` + `transport.pem` now correctly copied** to VuGen output when JWT is detected (was silently skipped because `hasJwt` was always `false` due to the event lookup bug above). Both `[ManuallyExtraFiles]` in `.usr` and `<GeneralFiles>` in `ScriptUploadMetadata.xml` are updated when JWT present.
- **Correlation deduplication** — `generateCorrelationRegistrations()` now deduplicates by variable name per request. Previously, the same `_endpoint` or `_accessToken` could be emitted dozens of times before one request (513 → 16 registrations for Salesforce collection).
- **`QueryString=$.fieldName` path improved** — when `corr.extractPath` is `'$'` (root-only, incomplete), the code now falls back to `$.corrBase` (variable name minus `_` prefix) instead of the useless `$.value`. E.g., `_accessToken` → `QueryString=$.accessToken`.
- **`detectScriptSetVariables()` now handles both `item.event` and `item.tests`** — raw collection format AND normalized request format are both scanned.
- **`jwt-helper.js`, `jsrsasign.js`, `transport.pem` source** — all must be in the project root. Removed the fallback to `src/analyzers/jwt-helper.js`. Simplified `copyFromProjectRoot()` back to single-source (no `altSources` parameter).

### Changed
- `package.json` version: `2.4.1` → `2.4.2`

---

## [2.4.1] - 2026-03-10

### Added
- **Per-request dynamic variable generation** — detects `pm.variables.set('varName', crypto.randomUUID())` (and Math.random/Date.now/randomBytes patterns) in pre-request scripts. Emits:
  - DevWeb: `load.global.interaction_id = crypto.randomUUID();` inline BEFORE each request that uses the variable
  - VuGen C: C block using `lr_whoami` + `time()` + `rand()` → `lr_save_string("_interaction_id")` BEFORE `web_add_header`
  - Variable is never added to parameters.yml/ParameterFile.prm — it is always Tier 1 dynamic
  - `customScriptParser.detectPerRequestDynamicVars(script)` static method (supports uuid/nonce/random/timestamp)
- **Auth section vs headers deduplication** — when `Authorization` appears in BOTH the auth section and the explicit headers array, the explicit headers value is used and the auth section injection is skipped. Prevents duplicate `Authorization: Bearer ...` headers.

### Fixed
- **`jwt-helper.js`** (DevWeb) — source corrected from `jwt-lib.js` → `jwt-helper.js`, copied from `src/analyzers/jwt-helper.js` (falls back to project root if present there). The `jwt-helper.js` is the production file with PS256 + auto-refresh via `getJwtToken()`.
- **`jsrsasign.js`** (VuGen) — copied from project root to each VuGen output folder when JWT detected.
- **`transport.pem`** — fixed consistent typo `tranport.pem` → `transport.pem` throughout all generators and prompt files.
- **Pre-request and test scripts removed from main.js / Action.c output** — scripts are used during analysis only (variable detection, JWT fingerprinting, correlation). Generated scripts no longer contain `// TODO: Manual conversion` noise.
- **`replaceParameters()` in webHttpScriptGenerator** — per-request vars (`interaction_id`) now render as `{_interaction_id}` (underscore prefix) matching the inline-generated LR parameter name. Dynamic/correlated vars also consistently use `{_varName}`.
- **`scanForUndeclaredParams()`** — skips variables starting with `_` and per-request var base names, preventing them from appearing in ParameterFile.prm.

### Changed
- `package.json` version: `2.4.0` → `2.4.1`

---

## [2.4.0] - 2026-03-09

### Added
- **DevWeb mandatory file generation** — `mandatoryFilesGenerator.js` now produces the complete DevWeb project file set (matching `DevWeb2` reference): `[ScriptName].usr` (Type=DevWeb, ScriptLanguage=JavaScript, [ManuallyExtraFiles]), `default.cfg` (Encoding=UTF8, LogExtended, no [WEB] section), `default.usp` (Main action only + ErrorHandler sections), `ScriptUploadMetadata.xml` (Protocol=DevWeb, main.js ActionFiles).
- **Canonical `rts.yml`** — Updated to match `DevWeb2` reference: adds `dns:` section, `ssl.enableHTTP3: false`, `replay.enableIntegratedAuthentication: true`, `openTelemetry:` section, `userArguments: {}`.
- **`copyFromProjectRoot()`** in `mandatoryFilesGenerator.js` — copies `DevWebSdk.d.ts`, `jwt-lib.js`, `tranport.pem` from project root. Removed stub generator. DevWebSdk.d.ts is never synthesized — always copied.
- **JWT Authentication — DevWeb**: `customScriptParser.detectJwtUsage()` fingerprints jsrsasign/jsonwebtoken/jose patterns. When detected: `jwt-lib.js` + `tranport.pem` copied from project root; commented-out `jwtLib.generate()` block added to `initialize()`; commented-out `isExpiring()` refresh block added to `action()`; `[ManuallyExtraFiles]` added to `.usr`.
- **JWT Authentication — VuGen Web HTTP/HTML**: When JWT detected: `generate_jwt.js` written to output folder (standalone Node.js pre-generator); `jsrsasign.js`, `generate_jwt.js`, `tranport.pem` added to `[ManuallyExtraFiles]`; JWT note block added to `vuser_init.c`.
- **`authenticationHandler.setDynamicVarNames()`** — generators call this after `classifyVariables()` so auth code generation correctly emits `load.global.X` for correlated/script-set tokens instead of `load.params.X`.
- **`advancedScriptGenerator.detectJwtUsage()`** — scans all pre-request scripts; populates `this.hasJwt` and `this.jwtVarNames`; JWT output vars always Tier 1 dynamic.
- Prompt files updated: `03-AUTHENTICATION-HANDLER.txt`, `11-WEB-HTTP-AUTH-HANDLER.txt`, `06-MANDATORY-FILES.txt`, `USAGE-GUIDE-DEVWEB.txt`, `USAGE-GUIDE-WEB-HTTP.txt`.

### Fixed
- **`correlationDetector.js` `~line 444`** — Critical: `new URL(url)` encoded `{{variable}}` → `%7B%7B...%7D%7D`, breaking all consumer URL matching. Replaced with manual string splitting.
- **`advancedScriptGenerator.js` `detectScriptSetVariables()`** — Added `bru.setVar()` / `bru.setEnvVar()` to the scan pattern. Bruno pre-request variables were being parameterized incorrectly.
- **`authenticationHandler.js` `parameterize()`** — Checks `dynamicVarNames` before choosing `load.global.X` vs `load.params.X` for `{{variable}}` references.
- **`advancedScriptGenerator.js`** — `load.initialize('Initialize', ...)`, `load.action('Action', ...)`, `load.finalize('Finalize', ...)` now match DevWeb2 canonical naming (was `"init"`, `"Action"`, `"finalize"`).
- **`mandatoryFilesGenerator.js` `generateAll()`** — Accepts `options` object `{ transactionNames, hasJwt }` as 3rd param (string back-compat retained).

### Changed
- `package.json` version: `2.3.4` → `2.4.0`

---

## [2.3.4] - 2026-02-25

### Added
- **`Snapshot=tN.inf` parameter** in all VuGen Web HTTP/HTML requests: Every `web_url()` and `web_custom_request()` call now includes `"Snapshot=tN.inf"` immediately before `"Mode=HTML"`. The counter `N` starts at `1` and increments globally across the entire `Action.c` script (t1, t2, t3...). VuGen uses these `.inf` files to display response content in the script tree/Output window. Previously generated scripts without this parameter could not show response snapshots in VuGen's UI.
  - **`src/generators/webHttpScriptGenerator.js`**: Added `this.snapshotCounter = 0` to constructor. `generateWebFunction()` now increments and passes the snapshot string to `generateWebUrl()` and `generateWebCustomRequest()`. Both methods insert `"Snapshot=tN.inf"` before `"Mode=HTML"`.
  - **`devweb-prompts/10-WEB-HTTP-ACTION-GENERATOR.txt`**: All examples updated (structural, canonical `web_url`, canonical `web_custom_request`, large base64, complete script). Added Rule 6 and Mistake 8 about the Snapshot requirement.
  - **`devweb-prompts/06-MANDATORY-FILES.txt`**: All `web_url`/`web_custom_request` examples updated; added snapshot rule note.
  - **`devweb-prompts/USAGE-GUIDE-WEB-HTTP.txt`**: Added "SNAPSHOT PARAMETER" section in Quick Reference; all code examples updated; added Issue 9 in troubleshooting.
- **`package.json`**: Version bumped to `2.3.4`.

---

## [2.3.3] - 2026-02-24

### Added
- **`devweb-prompts/11-WEB-HTTP-AUTH-HANDLER.txt`** (new file): VuGen Web HTTP/HTML authentication patterns in C — equivalent of `03-AUTHENTICATION-HANDLER.txt` for C protocol. Covers: OAuth2 client_credentials & password grant in `vuser_init.c`, login endpoint pattern, static Bearer, Basic Auth via `web_set_user()`, API Key header/query, auth inheritance rules, token refresh pattern, complete example with parameter validation, and DevWeb vs Web HTTP/HTML auth comparison table.
- **`devweb-prompts/10-WEB-HTTP-ACTION-GENERATOR.txt`**: Added in v2.3.1; now referenced from all navigation files.
- **`devweb-prompts/USAGE-GUIDE-DEVWEB.txt`** (new file): Self-contained DevWeb (JavaScript) user guide — which prompt files to upload, 6 detailed copy-paste AI chat templates (A–F), variable classification quick reference, and DevWeb-specific troubleshooting. Users targeting DevWeb output no longer need to read the combined USAGE-GUIDE.txt.
- **`devweb-prompts/USAGE-GUIDE-WEB-HTTP.txt`** (new file): Self-contained VuGen Web HTTP/HTML (C) user guide — which prompt files to upload, 6 detailed copy-paste AI chat templates (G–L), VuGen C parameter syntax, large base64 body (`BodyFilePath=`) explanation, correlation quick reference, and VuGen-specific troubleshooting. Users targeting VuGen output no longer need to read the combined USAGE-GUIDE.txt.
- **`devweb-prompts/00-README-START-HERE.txt`**: Added "QUICK PROTOCOL SELECTOR" box at the top directing users to the appropriate protocol-specific guide.
- **`src/generators/webHttpScriptGenerator.js`**: `generateBodyForC()` now emits a `console.warn` for `multipart/form-data` requests (previously returned `null` silently, hiding the limitation from the user).

### Changed
- **`devweb-prompts/00-README-START-HERE.txt`**: Added `10-WEB-HTTP-ACTION-GENERATOR.txt` and `11-WEB-HTTP-AUTH-HANDLER.txt` to the PROMPT FILES INCLUDED listing. Updated Advanced Usage web-http upload examples (Basic: `01 + 06 + 10`; With auth: `01 + 06 + 10 + 11`; With correlations: `01 + 04 + 06 + 10`). Added Tip 11 about using file 11 for OAuth2/auth collections.
- **`devweb-prompts/USAGE-GUIDE.txt`**: Section 5 decision table now includes two web-http rows (simple: 4 files; auth+correlations: 6 files). Templates G and H updated to reference files 10 and 11 respectively with more specific AI instructions. "FILES YOU NEVER NEED TO UPLOAD" section updated to clearly separate DevWeb-only files from web-http required files.
- **`devweb-prompts/01-MASTER-PROMPT.txt`**: Added header note clarifying this file covers DevWeb (JS) output only, and directing users to files 10, 11, and 06 for VuGen Web HTTP/HTML (C) output.
- **`devweb-prompts/07-PARAMETERS-YML-RULES.txt`**: Added scope note at top mapping DevWeb parameter concepts to VuGen Web HTTP/HTML equivalents (`nextValue: once` → `GenerateNewVal="Once"`, `nextValue: iteration` → `GenerateNewVal="EachIteration"`, `load.params` → `{varName}`, `load.global` → `{_varName}`). Added `ParameterFile.prm` side-by-side comparison section and common mistakes 6 and 7 for web-http.
- **`package.json`**: Version bumped from `2.3.1` to `2.3.3` to match CHANGELOG.

### Fixed
- **`src/generators/webHttpScriptGenerator.js`** — Critical VuGen runtime error: Replaced non-existent `lr_get_vuser_id()` function (caused "Unresolved symbol" during VuGen replay) with the correct `lr_whoami(int*, char**, int*)` API in both `generateVuserInitC()` and `generateVuserEndC()`. Added required C89 variable declarations (`int vusr_id, scid; char *vusr_group;`) at the top of each function. Changed `lr_log_message()` → `lr_output_message()` for all vuser lifecycle messages (ensures output always appears in VuGen Output window regardless of log settings). Fixed wrong order in commented OAuth2 example block: `web_reg_save_param_json()` now appears before `web_custom_request()` as required by VuGen.
- **`devweb-prompts/06-MANDATORY-FILES.txt`**, **`10-WEB-HTTP-ACTION-GENERATOR.txt`**, **`11-WEB-HTTP-AUTH-HANDLER.txt`**: All occurrences of `lr_get_vuser_id()` replaced with the correct `lr_whoami()` pattern with variable declarations. All `lr_log_message()` calls in lifecycle templates replaced with `lr_output_message()`.
- **`output/*/vuser_init.c`** and **`output/*/vuser_end.c`** (28 files across 14 folders): Regenerated with correct `lr_whoami()` API, correct C string literals (closing `"` restored on format string arguments), and `lr_output_message()` throughout.

---

## [2.3.2] - 2026-02-24

### Fixed
- **`default.usp` — Root cause of transactions not executing during VuGen replay**: The run logic profile was missing the full MercIniTree hierarchy that VuGen requires to parse the vuser lifecycle. Added: `MercIniTreeSectionName=` in all root sections, `MercIniTreeSons=` linking parents to children, `RunLogicActionType=` (VuserInit / VuserRun / VuserEnd / VuserErrorHandler) in all sections, child subsections `[RunLogicInitRoot:vuser_init]`, `[RunLogicRunRoot:Action]`, `[RunLogicEndRoot:vuser_end]`, and the complete `[RunLogicErrorHandlerRoot]` + child. Without these fields VuGen silently skips transaction execution.
- **`default.cfg` — Missing required settings**: Added `automatic_nested_transactions=1` (enables nested transaction support), `Limit=1` in `[ThinkTime]`, `RandomMin=60` / `RandomMax=90` in `[Iterations]`, `MsgClassData=0` / `MsgClassParameters=0` / `MsgClassFull=0` in `[Log]`, `MaxConnections=0` in `[WEB]`.
- **`[ScriptName].usr` — Missing metadata fields**: Added `LastModifyVer=26.1.0.0`, `DFERebrandFlag=Done`, `LastCodeGenerationVer=26.1.0.0`, `DisableRegenerate=0`, `[StateManagement]\nLastReplayStatus=0`, and `[ActiveReplay]\nLastReplayedRunName=\nActiveRunName=` — all required for VuGen to correctly track script state.
- **`devweb-prompts/06-MANDATORY-FILES.txt`**: All three VuGen template fixes above applied to the prompt file as well, so AI-generated scripts will also produce correct VuGen-compatible files.
- **Large base64 body handling** (`webHttpScriptGenerator.js`): Requests with large base64-encoded bodies (>500 chars) are now extracted to a `data/` subfolder and referenced via `"BodyFilePath=data/filename.b64"` (entire base64 body) or `"BodyFilePath=data/filename.dat"` (JSON body with embedded base64 field). Deduplication via MD5 hash. Data files registered in `[ExtraFiles]` in `.usr` and in `<GeneralFiles>` in `ScriptUploadMetadata.xml`.

---

## [2.3.1] - 2026-02-24

### Fixed
- **`devweb-prompts/01-MASTER-PROMPT.txt`**: Replaced truncated `rts.yml` (only 3 sections: httpConnection, ssl, replay) with the complete 10-section version matching the actual generator output. AI using only the master prompt will now produce correct, complete `rts.yml` files.
- **`devweb-prompts/06-MANDATORY-FILES.txt`**: Added complete VuGen Web HTTP/HTML section with all 10 VUGEN FILE templates (`Action.c`, `vuser_init.c`, `vuser_end.c`, `globals.h`, `[ScriptName].usr`, `default.cfg`, `default.usp`, `ParameterFile.prm`, `collection_data.dat`, `ScriptUploadMetadata.xml`), exact C code patterns with rules, and DevWeb vs Web HTTP/HTML comparison table.
- **`devweb-prompts/00-README-START-HERE.txt`**: Updated version to 3.1 with dual-protocol output. STEP 4 now shows both output file sets; CLI commands, advanced usage, and tips updated for `--protocol web-http`.
- **`devweb-prompts/USAGE-GUIDE.txt`**: Updated to v3.1. Added dual-protocol output tables, Templates G & H (VuGen Web HTTP/HTML), Issues 7–10 (rts.yml incomplete, ParameterFile.prm XML vs INI, `%7B` URL-encoding bug, correlation placed after request), 8 new FAQ entries. Fixed "Files You Never Need to Upload" section — `06-MANDATORY-FILES.txt` is now correctly listed as needed for VuGen web-http output (it was incorrectly listed as never needed).
- **`README.md`**: `ParameterFile.prm` output file description corrected from `(XML)` to `(VuGen INI format)`.
- **`CHANGELOG.md`** (this file): `ParameterFile.prm` description in v2.3.0 corrected from "XML parameter definitions" to "VuGen INI format (`[parameter:name]` sections, NOT XML)" with correct field names (`GenerateNewVal`, not `UpdateValueOn`).

---

## [2.3.0] - 2026-02-23

### Added
- **VuGen Web HTTP/HTML (C) protocol support** (`--protocol web-http`): New generator `WebHttpScriptGenerator` produces classic LoadRunner C-based scripts from the same input collection, with no changes to parsers or analyzers.
- **`src/generators/webHttpScriptGenerator.js`**: Generates `Action.c`, `vuser_init.c`, `vuser_end.c`, `globals.h`. Reuses all 4 analyzers unchanged. Key behaviors:
  - `web_reg_save_param_json/regexp/boundary()` emitted **before** the producing request (VuGen requirement)
  - `web_url()` for GET/HEAD; `web_custom_request()` for POST/PUT/PATCH/DELETE
  - `{varName}` LR parameter syntax for all variables (no `load.global`/`load.params` split — VuGen uses one namespace)
  - `lr_start_transaction()` / `lr_end_transaction()` grouped by folder; `lr_think_time()` between groups
- **`src/generators/webHttpMandatoryFilesGenerator.js`**: Generates all 6 required VuGen configuration files:
  - `[ScriptName].usr` — VuGen metadata INI with `ActiveTypes=QTWeb`, `AdditionalTypes=QTWeb`, `DevelopTool=Vugen`, `ParamLeftBrace={`, all mandatory sections (`[VuserProfiles]`, `[CfgFiles]`, `[ExtraFiles]`, `[Interpreters]`, `[Modified/Recorded/Replayed Actions]`, `[TransactionsOrder]`, `[Transactions]`)
  - `default.cfg` — runtime settings (think time, iterations, log, WEB section)
  - `default.usp` — run logic profile (init/run/end groups)
  - `ParameterFile.prm` — **VuGen INI format** (`[parameter:name]` sections, NOT XML): `GenerateNewVal="Once"` for config params, `GenerateNewVal="EachIteration"` for credentials; `ColumnName` must match exact column header in `collection_data.dat`
  - `collection_data.dat` — CSV with actual parameter values from collection/environment
  - `ScriptUploadMetadata.xml` — LRE upload manifest listing all action and general files
- **`--protocol` CLI flag**: `--protocol devweb` (default, unchanged) or `--protocol web-http` (VuGen C). Works with all input formats and both `-m single` and `-m multi`.
- **Web UI protocol selector**: Radio buttons on the upload form for "DevWeb (JavaScript)" and "Web HTTP/HTML (C)"; convert button label updates to reflect selection.

### Fixed
- **VuGen `.usr` file**: Added all missing required fields (`AdditionalTypes=QTWeb`, `DevelopTool=Vugen`, `ParamLeftBrace`, `ParamRightBrace`, `[VuserProfiles]`, `[CfgFiles]`, `[ExtraFiles]`, `[Interpreters]`, `[Modified/Recorded/Replayed Actions]`, `[TransactionsOrder]`) that caused VuGen to reject the script with "unsupported protocol" error.

### Changed
- `src/index.js`: Factory-selects generator class based on `options.protocol`. DevWeb path unchanged; web-http path skips `main.js`, `config.yml`, `README.md`, `package.json`, `ANALYSIS.md` (not applicable to C scripts).
- `src/web/server.js`: Passes `protocol` field from form body to converter.

---

## [2.1.1] - 2026-02-23

### Fixed
- **`load.thinkTime()` → `load.sleep()`**: The transaction-grouped code path in `advancedScriptGenerator.js` incorrectly emitted `load.thinkTime()` which does not exist as a standalone DevWeb function. Changed to `load.sleep()`. The sequential code path already used `load.sleep()` — both paths are now consistent.
- **Fallback `DevWebSdk.d.ts`**: Removed `export function thinkTime(...)` declaration; replaced with correct `export function sleepAsync(seconds: number): Promise<void>`.

### Added
- **Docker packaging** (`Dockerfile`): Multi-stage Alpine build. Stage 1 installs production deps via `npm ci --omit=dev`. Stage 2 copies only `src/` and uses a direct symlink for the CLI binary. Excludes all examples, prompts, and documentation — image is minimal.
- **`.dockerignore`**: Excludes `devweb-prompts/`, `examples/`, `devweb-examples-code/`, `output/`, `node_modules/`, all markdown and install files from the Docker build context.
- **Rewritten `.gitlab-ci.yml`**: Builds and publishes the Docker image to GitLab Container Registry. Two jobs: `build-release` (triggers on `v*.*.*` tags → publishes `:VERSION` + `:latest`) and `build-snapshot` (triggers on `main`/`Dev` branch → publishes `:snapshot`). Both jobs tagged `linux` to run on Linux runners only.
- **Cross-platform consumer pipeline examples** documented in `.gitlab-ci.yml` comments: Linux runner (Docker image, zero setup) and Windows runner (shell executor + `npm ci`) patterns.

## [2.2.1] - 2026-02-18

### Added
- **Bruno YAML folder-based format support**: Full parsing of distributed Bruno collection directories (contains `opencollection.yml`, `folder.yml`, request `*.yml` files, and `.bru` files mixed)
- **Bruno collection-level headers extraction**: `request.headers[]` from the Bruno YAML root section are merged into `load.WebRequest.defaults.headers` for all requests
- **Bruno before-request script header extraction**: `req.getHeaders().add({ key, value })` patterns in root-level `request.scripts[type=before-request]` are auto-detected and merged into defaults headers
- **Bruno collection-level auth support**: `request.auth` (OAuth2, bearer, basic, apikey) from the YAML root generates a commented-out token-fetch block in `load.initialize()` — ready to uncomment and enable
- **`generateCollectionAuthBlock()` method**: New method in `advancedScriptGenerator.js` that emits properly-resolved OAuth2 token fetch code with variable expressions already in `load.params`/`load.global` form
- **Complete prompt file coverage**: All 10 devweb-prompts files (00–09) and USAGE-GUIDE.txt are now fully up to date with all format support, correct rts.yml (all 10 sections), and Bruno YAML collection-level feature documentation

### Fixed
- **Truncated `rts.yml`**: Prompt file `06-MANDATORY-FILES.txt` now includes the COMPLETE rts.yml with all 10 sections: `httpConnection`, `grpc`, `proxy` (9 properties including proxyDomain, proxyUser, proxyPassword, proxyAuthenticationType, excludedHosts), `ssl`, `replay` (8 properties including enableDynatrace, resourceHttpErrorAsWarning, enableIntegratedAuthentication, multiIP), `vts` (7 properties), `encryption`, `vuserLogger`, `flow`, `thinkTime`

### Changed
- `parseBrunoYamlCollection()` in `brunoParser.js`: Now extracts `collectionHeaders` and `collectionAuth` from the root `request:` section and stores them on the collection object
- `generateAction()` in `advancedScriptGenerator.js`: Merges collection-level headers (browser baseline + collection headers) into the `defaults.headers` block

## [2.2.0] - 2026-02-17

### Added
- **Multi-script generation mode** (`-m multi`): Split large collections by top-level folder into separate self-contained DevWeb scripts for independent LRE scenario design
- **Large base64 extraction**: Automatically detect base64 values >500 chars in request bodies, extract to external `data/*.b64` files with deduplication via MD5 hash
- **3-tier variable classification system**: All `{{variables}}` classified as Dynamic (`load.global`), Parameterized Config (`load.params`, nextValue: once), or Parameterized Test Data (`load.params`, nextValue: iteration)
- **collection_data.csv generation**: Actual parameter values from collection/environment exported to CSV alongside parameters.yml
- **Environment file override** (`-e environment.json`): Environment values override collection variable values in generated CSV
- **Cross-folder dependency detection**: Multi-mode warns when variables produced in one folder are consumed in another (e.g., auth tokens)
- **Sequential response variable naming**: `webResponse_01`, `webResponse_02` pattern instead of long descriptive names

### Changed
- **scenario.yml format**: Now uses proper DevWeb pacing structure (type/mode/min/max, rampUp, duration, tearDown) instead of simple name/description
- **Transaction declarations**: Now correctly placed INSIDE the action function at the top, before any request code
- **URL handling**: Uses template literals with `load.params`/`load.global` instead of string concatenation; manual URL splitting to avoid `new URL()` encoding `{{` to `%7B%7B`
- **parameters.yml**: Always generated when variables exist; uses `collection_data.csv` as single file for all parameters
- **Variable naming safety**: Strip leading digits from variable/file names to avoid JS identifier errors (e.g., `5_Upload_Document` → `Upload_Document`)

### Fixed
- `load.global.*` markers no longer trigger false "variable not found" warnings in `replaceParametersInObject()`
- Request ID counter now correctly incremented before response variable assignment
- Duplicate cross-folder dependency warnings eliminated via Set-based deduplication

### Documentation
- Complete rewrite of all devweb-prompts files (01 through 09) to match current code logic
- Updated CHANGELOG.md, INSTALLATION.md with new CLI options and features

## [2.0.0] - 2026-02-08

### Added
- 🚀 **Complete rewrite** with advanced features
- 🔍 **Automatic Correlation Detection**: Intelligent detection of tokens, IDs, and dynamic values
- 📊 **Advanced Parameterization**: Type detection, data file generation, smart extraction
- 🔐 **Full Authentication Support**: OAuth 2.0, Basic, Bearer, API Key, AWS Signature v4
- 🌐 **Web UI**: User-friendly interface for non-technical users
- 🔄 **GitLab CI/CD Integration**: Ready-to-use pipeline configuration
- 📝 **Code Comments**: Detailed inline documentation in generated scripts
- 📈 **Analysis Reports**: Comprehensive conversion statistics and recommendations
- 🎯 **Transaction Support**: Automatic grouping by folder structure
- 💡 **Think Time**: Configurable delays between requests
- 🛡️ **Error Handling**: Comprehensive try-catch with transaction status
- 📖 **Documentation**: Complete user guide, technical docs, and examples

### Changed
- Improved DevWeb code generation with better formatting
- Enhanced request normalization for both Bruno and Postman formats
- Optimized correlation detection algorithm
- Better parameter type inference

### Features in Detail

#### Correlation Detection
- Automatic detection of:
  - Authentication tokens (Bearer, JWT, OAuth)
  - Session IDs and tracking tokens
  - CSRF tokens
  - Entity IDs (User, Order, Product, etc.)
  - Timestamps and nonces
- Smart extractor generation:
  - JsonPathExtractor for JSON responses
  - BoundaryExtractor for HTML/text
  - RegexpExtractor for complex patterns
  - HtmlExtractor for HTML documents
  - CookieExtractor for cookies

#### Parameterization Engine
- Automatic parameter extraction from:
  - Collection variables
  - Environment variables
  - Request URLs, headers, bodies
  - Dynamic values
- Type detection:
  - email, url, uuid
  - number, boolean, string
  - date, timestamp
- Data file generation:
  - CSV format
  - Sample data based on type
  - Configurable selection strategies

#### Authentication
- OAuth 2.0 support:
  - Client Credentials flow
  - Password flow
  - Authorization Code flow
  - Token refresh handling
- Basic Authentication with base64 encoding
- Bearer Token with automatic injection
- API Key in headers or query parameters
- AWS Signature v4 for AWS services
- Digest Authentication
- Automatic header injection in requests

#### Web UI
- Drag-and-drop file upload
- Real-time conversion progress
- Analysis preview before conversion
- Configurable options
- One-click download of generated scripts
- Mobile-responsive design

#### GitLab CI/CD
- Multi-stage pipeline:
  - Validation
  - Conversion
  - Testing
  - Packaging
  - Deployment
- Automatic artifact generation
- Manual deployment gate
- Scheduled conversion jobs
- Integration with LoadRunner Enterprise

### Fixed
- Collection parsing issues with nested folders
- Authentication header injection
- Parameter replacement in complex objects
- Transaction boundary detection
- Special character handling in variable names

## [1.0.0] - 2025-12-01 (Legacy)

### Added
- Initial release
- Basic Bruno collection parsing
- Simple DevWeb script generation
- CLI interface
- Transaction grouping

### Known Issues
- Limited correlation detection
- No parameterization support
- Basic authentication only
- Manual correlation required

## [Unreleased]

### Planned Features
- [ ] GraphQL support
- [ ] WebSocket conversion
- [ ] gRPC support
- [ ] Advanced think time strategies
- [ ] Data-driven testing
- [ ] Integration with more CI/CD platforms
- [ ] Cloud deployment options
- [ ] Real-time collaboration
- [ ] Version control integration
- [ ] Performance optimization suggestions
- [ ] Test data generation AI
- [ ] Custom extractor templates
- [ ] Plugin system

### Under Consideration
- Desktop application (Electron)
- VS Code extension
- IntelliJ IDEA plugin
- Docker compose support
- Kubernetes deployment
- AWS Lambda deployment
- Azure Functions support

---

## Upgrade Guide

### From 1.x to 2.0

**Breaking Changes:**
- CLI command structure changed
- Output directory structure updated
- Configuration file format changed

**Migration Steps:**

1. Update CLI commands:
   ```bash
   # Old (v1.x)
   bruno-devweb convert collection.json output/

   # New (v2.0)
   bruno-devweb convert -i collection.json -o output/
   ```

2. Update config files:
   ```yaml
   # Old format
   script_name: "My Script"
   
   # New format
   general:
     scriptName: "My Script"
   ```

3. Review generated scripts:
   - New correlation extractors added
   - Authentication setup in initialize section
   - Transaction structure changed

**New Features You Can Use:**
- Enable correlation: `--use-correlation`
- Enable parameterization: `--use-parameterization`
- Use web UI: `bruno-devweb web`
- Analyze before converting: `bruno-devweb analyze -i collection.json`

---

## Support

For issues, questions, or feature requests:
- 📧 Email: support@yourorg.com
- 🐛 Issues: https://gitlab.com/your-org/bruno-devweb-converter/issues
- 📚 Docs: https://gitlab.com/your-org/bruno-devweb-converter/wiki

---

*[2.0.0]: https://gitlab.com/your-org/bruno-devweb-converter/tags/v2.0.0*
*[1.0.0]: https://gitlab.com/your-org/bruno-devweb-converter/tags/v1.0.0*
