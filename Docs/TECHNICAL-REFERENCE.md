# LRE Toolkit — Technical Reference

> For developers and team members maintaining or extending the toolkit.
> Covers architecture, code structure, all rules, and implementation details.

---

## Contents

1. [Repository structure](#1-repository-structure)
2. [Web server](#2-web-server)
3. [Converter — Bruno / Postman](#3-converter--bruno--postman)
   - [Input parsing](#input-parsing)
   - [Variable classification (3-tier system)](#variable-classification-3-tier-system)
   - [Correlation detection](#correlation-detection)
   - [Authentication handling](#authentication-handling)
   - [Script generators](#script-generators)
4. [Converter — JMeter (.jmx)](#4-converter--jmeter-jmx)
5. [Recorder (VuGen-Recorder.html)](#5-recorder-vugen-recorderhtml)
6. [Script Studio (VuGen-Script-Studio.html)](#6-script-studio-vugen-script-studiohtml)
7. [Portal UI (index.ejs)](#7-portal-ui-indexejs)
8. [Memory / privacy model](#8-memory--privacy-model)
9. [Output file inventory — DevWeb](#9-output-file-inventory--devweb)
10. [Output file inventory — Web HTTP/HTML](#10-output-file-inventory--web-httphtml)
11. [Feature flags](#11-feature-flags)
12. [Known rules and edge cases](#12-known-rules-and-edge-cases)

---

## 1. Repository Structure

```
bruno-devweb-converter/
├── src/
│   ├── index.js                        # BrunoDevWebConverter entry point
│   ├── converters/
│   │   └── jmxConverter.js             # JMX conversion orchestrator
│   ├── parsers/
│   │   ├── brunoParser.js              # Postman/Bruno/YAML/.bru parser
│   │   └── jmxParser.js                # JMeter .jmx XML parser
│   ├── generators/
│   │   ├── advancedScriptGenerator.js  # DevWeb main.js generator
│   │   ├── webHttpScriptGenerator.js   # VuGen Action.c generator
│   │   ├── mandatoryFilesGenerator.js  # DevWeb config files
│   │   └── webHttpMandatoryFilesGenerator.js  # VuGen config files
│   ├── analyzers/
│   │   ├── correlationDetector.js      # 2-pass correlation engine
│   │   ├── parameterizationEngine.js   # Raw variable value scanner
│   │   ├── authenticationHandler.js    # Auth type detection + code gen
│   │   └── customScriptParser.js       # Pre/post-request script analysis
│   ├── lib/
│   │   ├── memoryFsInterceptor.js      # AsyncLocalStorage fs write interceptor
│   │   └── jmxDependencyResolver.js    # CSV file dependency checker
│   └── web/
│       ├── server.js                   # Express server
│       ├── views/
│       │   ├── index.ejs               # Portal SPA (Home+Converter+Help)
│       │   └── 404.html                # 404 error page
│       └── public/
│           ├── VuGen-Recorder.html     # HAR Script Generator (standalone)
│           ├── VuGen-Script-Studio.html # Correlation Engine (standalone)
│           └── jszip.min.js            # JSZip v3.10.1 (shared)
├── DevWebSdk.d.ts                      # Copied to every DevWeb output
├── jwt-helper.js                       # Copied when JWT detected (DevWeb)
├── jsrsasign.js                        # Copied when JWT detected (VuGen)
├── transport.pem                       # Copied when JWT detected (both)
└── docs/
    ├── USER-GUIDE.md                   # End-user guide
    ├── TECHNICAL-REFERENCE.md          # This file
    └── FUNCTIONAL-SPEC.md              # Tool-by-tool functional specification
```

---

## 2. Web Server

**File:** `src/web/server.js`

Express server, exported as a singleton (`module.exports = new WebServer()`).

### Routes

| Method | Path | Handler |
|--------|------|---------|
| GET | `/converter` | Renders `index.ejs` (portal SPA) |
| GET | `/tools/recorder` | Serves `VuGen-Recorder.html` |
| GET | `/tools/studio` | Serves `VuGen-Script-Studio.html` |
| POST | `/convert` | Postman/Bruno conversion |
| POST | `/convert-jmx` | JMeter conversion |
| GET | `/download/:token` | Single-use ZIP download |
| GET | `/health` | `{ status: 'ok', version }` |

### Middleware
- `multer.memoryStorage()` — uploaded files stay in RAM, never touch disk
- `.html` block middleware — blocks direct `.html` URL access (tools served via `/tools/*` routes instead)
- JSON error handler (4-param Express error middleware) — ensures all errors return JSON, not HTML. Prevents "unexpected token '<'" in the browser when the server errors.

### Pending downloads
`this.pendingDownloads` — `Map<token, { files: Map, outputDir, expires }>`. Single-use tokens, 5-minute TTL. The ZIP is streamed from the in-memory file Map via archiver, with:
- `Content-Type: application/octet-stream` (not `application/zip` — avoids proxy filters)
- No `Content-Length` header (chunked transfer — bypasses corporate proxy size limits)

### Fetch resilience (index.ejs)
Both `doConvert()` and `doConvertJmx()` check `Content-Type` before calling `r.json()`. If the server returns HTML (e.g. IIS 503 when iisnode restarts), the user sees `"Server error (503): Service Unavailable. Check server logs."` instead of `"unexpected token '<'"`.

---

## 3. Converter — Bruno / Postman

**Entry:** `src/index.js` → `BrunoDevWebConverter.convert()`

### Input Parsing

**File:** `src/parsers/brunoParser.js`

| Format | Detection | Parser path |
|--------|-----------|-------------|
| Postman v2.1 JSON | `info.schema` URL present | `parseJSON()` → Postman normalizer |
| Bruno JSON | `items[]` array, no schema URL | `parseJSON()` → Bruno normalizer |
| Bruno YAML (single file) | `.yml` / `.yaml` extension | `parseBrunoYamlCollection()` → `traverseBrunoYamlItems()` |
| Bruno YAML (folder) | path is a directory | `parseBrunoYamlCollection()` → `walkBrunoYamlDir()` |
| Single `.bru` file | `.bru` extension | `parseBru()` |

**Critical: Event storage difference**
- Postman stores pre/post scripts in `item.event[]`
- Bruno JSON export stores scripts in `item.script.req` (pre-request) and `item.script.res` (post-response)
- brunoParser normalizes all into `req.tests[]`

All script scanning throughout the codebase **must** use:
```js
const events = req.tests || req.event || [];
```

**Bruno YAML specifics:**
- `item.info.type` (NOT `item.type`) = `"folder"` | `"http"`
- `item.info.seq` = ordering field (ascending)
- `headers[].name` (NOT `.key`) for the header key
- Collection-level `request.headers` → `collectionHeaders` (added to every request)
- Collection-level `request.auth` → commented OAuth2 block in `initialize()`
- Collection-level `request.variables` → CSV parameters

**URL handling — NEVER use `new URL()` on templated URLs:**
URLs like `{{baseUrl}}/api/users` must be split manually (`url.split('?')`). `new URL()` encodes `{{` to `%7B%7B`.

---

### Variable Classification (3-tier system)

**Location:** `classifyVariables()` in BOTH generators (duplicated):
- `src/generators/advancedScriptGenerator.js` — DevWeb
- `src/generators/webHttpScriptGenerator.js` — VuGen

`parameterizationEngine.js` scans for raw variable values but does NOT do tier classification.

#### The three tiers

| Tier | DevWeb | VuGen | Used for |
|------|--------|-------|---------|
| 1 — Dynamic | `load.global.varName` | `{_varName}` (lr_param) | Correlation targets, script-set vars |
| 2 — Config | `load.params.varName` (nextValue: once) | `{varName}` (GenerateNewVal=Once) | Base URLs, API keys, client IDs |
| 3 — Test Data | `load.params.varName` (nextValue: iteration) | `{varName}` (GenerateNewVal=EachIteration) | Usernames, passwords, emails |

#### Detection rules (evaluated in priority order)

| Rule | Condition | Result |
|------|-----------|--------|
| 0 | JMX CSVDataSet column name | Tier 3 — EachIteration |
| 1 | Set by script (`bru.setEnv`, `pm.*.set`, `postman.setEnvironmentVariable`, `vars.put`, etc.) | Tier 1 — Dynamic |
| 2 | Is a correlation target | Tier 1 — Dynamic |
| 2.5 | Name matches private/crypto key pattern | Tier 1 — Dynamic (never parameterize) |
| 3 | Name starts with `_` | Tier 1 — Dynamic |
| 4 | Value is empty or null | Tier 1 — Dynamic (safety net) |
| 5a | Has real value + name matches credential pattern | Tier 3 — Test Data |
| 5b | Has real value + not a credential | Tier 2 — Config |

**Private key name patterns (Rule 2.5):** `private-key`, `signing-key`, `secret-key`, `rsa-key`, `pem-key`, `pkcs`, `p12-key`, `client-secret` and similar. Prevents PEM key content ending up in CSV files which breaks VuGen's Parameters panel.

**Postman built-ins (`$guid`, `$timestamp`, `$randomEmail` etc.):** SKIPPED entirely — not parameterized.

---

### Correlation Detection

**File:** `src/analyzers/correlationDetector.js`

Two-pass algorithm:

**Pass 1 — Extract set variables:** Scans all pre-request and test scripts for variable setters:
- `bru.setEnv("x", v)`, `bru.setEnvVar("x", v)`, `bru.setVar("x", v)`, `bru.setGlobalVar("x", v)`
- `pm.environment.set("x", v)`, `pm.globals.set("x", v)`, `pm.collectionVariables.set("x", v)`
- `postman.setEnvironmentVariable("x", v)`
- `vars.put("x", v)`, `context.set("x", v)`

Also resolves **indirect assignment**:
```js
let id = body?.access_token;
bru.setEnv("access_token", id); // → extracts $.access_token
```

**Pass 2 — Match response extractors:** For each set variable, determines extraction type and path:

| Response access pattern | Extractor type | Path |
|------------------------|----------------|------|
| `res.body.field` | JSON | `$.field` |
| `res.body?.data?.token` | JSON | `$.data.token` |
| `body?.field` | JSON | `$.field` |
| `res.headers["x-csrf-token"]` | Header | `x-csrf-token` |
| `res.headers.authorization` | Header | `authorization` |
| `res.cookies["session_id"]` | Cookie | `session_id` |
| `pm.response.json().field` | JSON | `$.field` |

**Extractor generation:**

| Type | DevWeb | VuGen |
|------|--------|-------|
| JSON | `new load.JsonPathExtractor("n","$.path")` | `web_reg_save_param_json("n","$.path",LAST)` |
| Header | `new load.BoundaryExtractor("n","Header: ","\r\n",Headers)` | `web_reg_save_param("n","LB=Header: ","RB=\r\n","Search=Headers",LAST)` |
| Cookie | `new load.BoundaryExtractor("n","cookie=",";",Headers)` | `web_reg_save_param("n","LB=cookie=","RB=;","Search=Headers",LAST)` |
| XPath | `new load.XpathExtractor("n","//path")` | `web_reg_save_param_xpath("n","//path",LAST)` |
| Boundary | `new load.BoundaryExtractor("n","LB","RB")` | `web_reg_save_param("n","LB=...","RB=...",LAST)` |

**Deduplication:** `generateCorrelationRegistrations()` only emits ONE extractor per variable name, even if the variable is set in multiple places.

---

### Authentication Handling

**File:** `src/analyzers/authenticationHandler.js`

Detects and generates code for all supported authentication types:

| Auth Type | Detection | DevWeb Output | VuGen Output |
|-----------|-----------|---------------|-------------|
| OAuth2 Client Credentials | `grant_type=client_credentials` | Token fetch in `initialize()` | Token fetch in `vuser_init.c` |
| OAuth2 Password | `grant_type=password` | Token fetch in `initialize()` | Token fetch in `vuser_init.c` |
| Basic Auth | `auth.basic` / `Authorization: Basic` | `btoa(user:pass)` header | `web_add_header` base64 |
| Bearer Token | `auth.bearer` / `Authorization: Bearer` | Dynamic-aware header | `web_add_header` dynamic |
| API Key | `auth.apikey` | Header or query param | Header or query param |
| JWT | Script fingerprint detection | `jwt-helper.js` import | `jsrsasign.js` import |
| AWS Sig v4 | `auth.awsv4` | AWS signing headers | AWS signing headers |
| Digest | `auth.digest` | Digest challenge response | Digest challenge response |
| NTLM / Kerberos | `auth.ntlm` / `auth.negotiate` | `load.setUserCredentials()` | `web_set_user()` |

**NTLM/Kerberos rules:**
- `detectNtlmKerberos()` runs BEFORE `classifyVariables()` so credentials appear in parameter files
- Credentials always use fixed parameter names: `username`, `password`, `domain`
- Host = hostname only, no port (LRE 26.1 requirement)

**JWT detection (`customScriptParser.detectJwtUsage()`):**

Fingerprints all major libraries in both JS and Java/Groovy (for JMeter JSR223):
- JS: `jsrsasign`/`KJUR.jws.JWS.sign`, `require('jsonwebtoken')`, `require('jose')`, `crypto.createSign`
- Java: `com.nimbusds.jose`, `com.auth0.jwt`, `io.jsonwebtoken`, `org.bouncycastle`
- Manual JCA: `Signature.getInstance(SHA256withRSA...)`, `Mac.getInstance(HmacSHA256...)`
- PEM-in-script detection: `-----BEGIN PRIVATE KEY-----` + 3+ of `iss/sub/aud/exp/iat/jti`

If NONE match → `hasJwt = false` → zero JWT code emitted.

---

### Script Generators

#### DevWeb — `advancedScriptGenerator.js`

Output structure of `main.js`:
```
1. Imports (jwt-helper if JWT)
2. Global const declarations (load.Transaction objects — ALL before initialize())
3. initialize() — OAuth2/JWT token fetch, NTLM credentials
4. action() — per-request transaction start/stop + HTTP calls
5. finalize() — cleanup
```

**Transaction naming:** `T{nn}_{RequestName}` — global sequential counter across ALL folders.
Numbers in request names are stripped. `buildTransactionMap()` runs at the start of `generateAction()`.

**Per-request dynamic variables (globals.h equivalent in DevWeb):**

| Pattern | Generated code |
|---------|---------------|
| UUID/GUID header value | `load.utils.uuid()` inlined in header value |
| CSRF token | Extracted via boundary extractor from previous response |

#### VuGen Web HTTP/HTML — `webHttpScriptGenerator.js`

**C89 rules (CRITICAL):**
- All variable declarations at the TOP of each function before any statements
- `web_reg_save_param_*()` MUST appear BEFORE the request that produces the value
- `web_add_header()` scope = next single request only
- `BodyFilePath=` for request bodies > 500 chars
- Every `web_url` / `web_custom_request` MUST have `"Snapshot=tN.inf"` BEFORE `"Mode=HTML"`
- Snapshot counter starts at 1, increments globally (`this.snapshotCounter` in constructor)

**Per-request dynamic vars in `globals.h`:**
```c
static void gen_uuid(char* _param)        // UUID v4
static void gen_csrf_token(char* _param)  // 32-char hex
static void gen_hex64(char* _param)       // 64-char hex
```

#### Mandatory config files

**DevWeb** (`mandatoryFilesGenerator.js`):
- `rts.yml` — runtime settings (think time, pacing, proxy if detected)
- `scenarios.yml` — scenario configuration
- `collection_data.csv` — parameter data (Tier 2 config + Tier 3 test data)
- `parameters.yml` — parameter binding rules
- `DevWebSdk.d.ts` — TypeScript definitions (copied from project root)
- `jwt-helper.js` + `jsrsasign.js` + `transport.pem` — if JWT detected
- `*.usr` file — VuGen script project file with transaction metadata

**Web HTTP/HTML** (`webHttpMandatoryFilesGenerator.js`):
- `default.cfg` — script configuration (proxy, think time, log level)
- `ParameterFile.prm` — INI format `[parameter:name]` sections (NOT XML)
  - `GenerateNewVal=Once` for Tier 2 config
  - `GenerateNewVal=EachIteration` for Tier 3 test data
- `collection_data.dat` — data table
- `globals.h` — shared functions (`gen_uuid`, `gen_csrf_token`, `gen_hex64`)
- `jsrsasign.js` + `transport.pem` — if JWT detected
- `*.usr` file — with `[TransactionsOrder]` and `[Transactions]` sections

**HTML entity decoding (`decodeHtmlEntities()`)** applied in 3 places:
1. `mandatoryFilesGenerator.js` → `generateCollectionDataCSV()`
2. `webHttpMandatoryFilesGenerator.js` → `generateCollectionDataDat()` + `generateParameterFilePrm()`
3. `jwt-helper.js` → `getJwtToken()` (before crypto operations)

This fixes PEM keys exported from web UIs that HTML-encode `\n` as `&#10;`.

---

## 4. Converter — JMeter (.jmx)

**Entry:** `src/converters/jmxConverter.js`
**Parser:** `src/parsers/jmxParser.js`

### JMX parsing pipeline

```
jmxParser.parse()
  → parseThreadGroups()     — identifies normal / setUp / tearDown TGs
  → parseHTTPSamplers()     — per TG HTTP request extraction
  → parseCSVDataSets()      — CSVDataSet config element parsing
  → parseJSR223Samplers()   — BeanShell/Groovy script blocks
  → parseExtractors()       — RegexExtractor, JSONPathAssertion, XPathExtractor
  → parseHeaderManagers()   — HTTP Header Manager elements
```

### Thread Group routing

| JMeter Thread Group type | DevWeb target | VuGen target |
|--------------------------|---------------|--------------|
| Normal Thread Group | `action()` | `Action.c` |
| setUp Thread Group | `initialize()` | `vuser_init.c` |
| tearDown Thread Group | `finalize()` | `vuser_end.c` |

### JMeter extractor → VuGen mapping

| JMeter element | DevWeb | VuGen |
|----------------|--------|-------|
| `JSONPathExtractor` | `load.JsonPathExtractor` | `web_reg_save_param_json` |
| `XPath2Extractor` | `load.XpathExtractor` | `web_reg_save_param_xpath` |
| `RegexExtractor` | `load.BoundaryExtractor` | `web_reg_save_param` |
| `BoundaryExtractor` | `load.BoundaryExtractor` | `web_reg_save_param` |
| `HtmlExtractor` (CSS) | `load.JsonPathExtractor` (best effort) | `web_reg_save_param` |

### JSR223 / BeanShell conversion

Groovy/Java script blocks are converted to a commented TODO block in the output:
```js
// TODO: Implement JSR223 script — original Groovy:
// <original script lines>
```

Exception: if JWT signing is detected in the script, full JWT generation code is emitted using the project's `jwt-helper.js` / `jsrsasign.js` pattern.

### CSV pipeline

`resolveCsvFilenames()` → resolves `{{csvFile1}}` template references to actual filenames
`filterJmxCollectionVars()` → removes JMeter-internal variables (3 categories)
`JmxDependencyResolver` → checks uploaded CSV files against referenced filenames and reports any missing

### Multi-script mode

In multi-script mode, each Thread Group becomes a separate script. The output ZIP contains:
```
script_name_TG1/main.js (or Action.c)
script_name_TG2/main.js
...
```

### Workload model Excel

`workloadExcelGenerator.js` generates a `.xlsx` file with thread group workload summary when `generateWlmExcel: true`. **Critical:** `ws.columns` must NOT use the `header` property (causes ExcelJS to write to row 1, conflicting with the merged title cell).

---

## 5. Recorder (VuGen-Recorder.html)

**Location:** `src/web/public/VuGen-Recorder.html`
**Served at:** `/tools/recorder`
**Size:** ~5,950 lines (self-contained, no backend dependency)

### Architecture

The Recorder is a fully client-side application. All HAR parsing, script generation, filtering, and ZIP creation happen in the browser. No data is sent to the server.

### Key data flow

```
User drops .har or NetLog JSON file
  → onDrop() / onFileSelected()
  → parseHar(file) — reads JSON, normalises HAR/NetLog format
  → buildRequestTable() — populates the request list UI
  → User filters domains, sets transactions
  → generateScript(format)
    → buildScript_webhttp() or buildScript_devweb()
    → createZip() — uses JSZip to build in-memory ZIP
    → triggerDownload() — Blob URL download, no server roundtrip
```

### HAR support

- Standard HAR 1.2 (`log.entries[]`)
- Chrome NetLog JSON (`events[]` with URL request/response events)
- Firefox multi-tab export (array of HAR objects)
- Bookmarklet HAR (custom format with session markers)

### Domain filtering

All unique domains from the HAR are extracted and displayed as checkboxes. The user unchecks:
- CDNs (fonts, images, scripts)
- Analytics (Google Analytics, AppInsights, etc.)
- Telemetry and monitoring endpoints

Static asset filtering (images, CSS, fonts, JS bundles) is also available via toolbar toggle.

### Transaction marking

Users drag request rows to group them. Named transactions map to:
- DevWeb: `const Tnn = new load.Transaction("name"); Tnn.start(); ... Tnn.stop();`
- VuGen: `lr_start_transaction("name"); ... lr_end_transaction("name", LR_AUTO);`

### Output format

"Both" option is currently hidden (set `display:none` on `#fc-both` and the "Download Both ZIPs" button). To re-enable: remove the `style="display:none"` attributes.

---

## 6. Script Studio (VuGen-Script-Studio.html)

**Location:** `src/web/public/VuGen-Script-Studio.html`
**Served at:** `/tools/studio`
**Size:** ~7,500 lines (self-contained, no backend dependency)

### Architecture

Fully client-side. HAR parsing, diff analysis, correlation detection, script generation, and ZIP creation all run in the browser via JavaScript. No data is sent to the server.

### Processing phases

```
Phase 1 — Upload
  User drops 1 or 2 HAR files → onHarDrop()

Phase 2 — Analyze (triggered by Analyze button)
  → parseHar(har1), parseHar(har2)
  → if 2 HARs: diffAnalysis(har1, har2)  → finds values that changed
    → diffBasedCorrelations (more complete)
  → if 1 HAR: patternAnalysis(har1)      → regex pattern matching
    → patternBasedCorrelations (faster)
  → detectAuth() — identifies auth headers, tokens, cookies
  → detectParameterCandidates() — suggests fields for parameterization
  → generateScript(format)

Phase 3 — Results
  → Script tabs: Action.c, main.js, vuser_init.c, vuser_end.c, globals.h
  → Correlation list with extraction details
  → Parameter candidate list
  → Download ZIP button
```

### 1 HAR vs 2 HAR analysis

**Pattern mode (1 HAR):**
- Regex-based identification of values that look dynamic
- Patterns: UUID v4, long base64 strings, hex tokens, JWT tokens, timestamps
- Faster but may miss correlations or flag false positives

**Diff mode (2 HARs):**
- Records same journey twice with different data
- Compares response bodies and headers between run 1 and run 2
- Any value present in run 1 responses that differs in run 2 responses = confirmed dynamic
- Generates targeted `web_reg_save_param` / `load.JsonPathExtractor` for each
- Significantly more accurate and complete

### Output format default

Default changed from `'both'` to `'devweb'` when "Both" option was hidden. The "Both" button is hidden (`style="display:none"`) but fully functional. To re-enable: remove `style="display:none"` from `#fmt-both`.

---

## 7. Portal UI (index.ejs)

**Location:** `src/web/views/index.ejs`
**Rendered at:** `/converter`

### SPA navigation

`PORTAL_CONFIG.tabs` object controls which tabs are visible. `switchPortalTab(tab)` manages all panel visibility. Iframes are lazy-loaded on first tab visit.

### Theme

Dark/light toggle in nav bar. Theme stored in `localStorage('lr-theme')`. On first load, a FOUC-prevention script in `<head>` reads localStorage before CSS loads. When a tool iframe loads, `lrePortalInit(theme)` is called to sync the theme.

### Converter panel (inline, not iframe)

The Postman/Bruno/JMX conversion UI is rendered inline inside `#portal-converter`. Two sub-tabs: "Postman / Bruno" and "JMeter (.jmx)".

Conversion is triggered by `doConvert()` / `doConvertJmx()` which POST to `/convert` and `/convert-jmx`. Both use content-type checking before `r.json()` to handle HTML error responses from IIS gracefully.

---

## 8. Memory / Privacy Model

All uploaded files are processed in-memory. Nothing is written to disk during conversion.

| Stage | Mechanism |
|-------|-----------|
| File upload | `multer.memoryStorage()` — buffers stay in RAM |
| Temp files (parser paths) | Written to `os.tmpdir()`, deleted immediately after parsing |
| fs writes during conversion | Intercepted by `memoryFsInterceptor.js` via AsyncLocalStorage → stored in `Map<path, Buffer>` |
| ZIP creation | `archiver.pipe(res)` — streams directly from Map to HTTP response |
| After download | Token deleted from `pendingDownloads` Map immediately |
| Token expiry | 5-minute TTL via `setTimeout` |

**CLI usage** is unaffected — `memoryFsInterceptor` only activates inside `runWithMemoryFs()` context.

---

## 9. Output File Inventory — DevWeb

| File | Always? | Notes |
|------|---------|-------|
| `main.js` | Yes | Main script |
| `rts.yml` | Yes | Runtime settings |
| `scenarios.yml` | Yes | Scenario config |
| `collection_data.csv` | Yes | Parameter data file |
| `parameters.yml` | Yes | Parameter binding |
| `DevWebSdk.d.ts` | Yes | TypeScript definitions |
| `*.usr` | Yes | VuGen project file |
| `jwt-helper.js` | JWT only | JWT signing helper |
| `jsrsasign.js` | JWT only | Crypto library |
| `transport.pem` | JWT only | Certificate |

---

## 10. Output File Inventory — Web HTTP/HTML

| File | Always? | Notes |
|------|---------|-------|
| `Action.c` | Yes | Main script |
| `vuser_init.c` | Yes | Init (OAuth token fetch, NTLM) |
| `vuser_end.c` | Yes | Cleanup |
| `globals.h` | Yes | Shared C functions |
| `default.cfg` | Yes | Script configuration |
| `ParameterFile.prm` | Yes | INI-format parameters |
| `collection_data.dat` | Yes | Parameter data table |
| `*.usr` | Yes | VuGen project file with transaction list |
| `jsrsasign.js` | JWT only | Crypto library |
| `transport.pem` | JWT only | Certificate |

---

## 11. Feature Flags

**Location:** `PORTAL_CONFIG` object in `index.ejs` (inside `<script>` block, before `switchPortalTab`)

```js
const PORTAL_CONFIG = {
  tabs: {
    home:      { enabled: true  },
    converter: { enabled: true  },
    recorder:  { enabled: true  },
    studio:    { enabled: true  },
    help:      { enabled: true  }
  },
  iframes: { recorder: '/tools/recorder', studio: '/tools/studio' }
};
```

To **disable a tool tab**: set `enabled: false`. The tab button and home-page tool card are hidden. The panel HTML and all code are preserved.

To **disable the "Both" format option** in Recorder or Studio: `style="display:none"` is already set on:
- Recorder: `#fc-both` (format card) and "Download Both ZIPs" button
- Studio: `#fmt-both` button

To re-enable "Both": remove the `style="display:none"` attributes.

---

## 12. Known Rules and Edge Cases

### URL templating
Never call `new URL()` on URLs containing `{{variable}}` — encodes braces to `%7B%7B`.
Always split manually: `const [base, qs] = url.split('?')`.

### VuGen C — web_reg_save_param placement
`web_reg_save_param_*()` must be called BEFORE the request that produces the value, not after.

### VuGen C — variable declarations
All `char*`, `int`, and other local variables must be declared at the TOP of each C function before any executable statements (C89 requirement).

### Snapshot counter in VuGen
Every `web_url` and `web_custom_request` call needs `"Snapshot=tN.inf"` before `"Mode=HTML"`. The counter starts at 1 and increments globally per script (`this.snapshotCounter` in the generator constructor).

### ParameterFile.prm format
This file uses INI format with `[parameter:name]` section headers — NOT XML. The VuGen Parameters panel reads it as INI. Writing it as XML or without the section header causes the Parameters panel to fail to open.

### HTML entity decoding
Parameter values from web-exported collections may contain HTML entities (`&amp;`, `&quot;`, `&#10;`). Always call `decodeHtmlEntities()` on parameter values before writing to CSV, PRM, or using in crypto operations.

### Private key variables
Variables with names matching crypto key patterns must be classified as Tier 1 Dynamic and never written to CSV/PRM files. PEM key content in parameter files causes VuGen's Parameters panel to crash.

### brunoParser event storage
Bruno stores scripts in `req.tests[]` (normalized form). Code that reads scripts must use `const events = req.tests || req.event || []` — never assume only `req.event` exists.

### Empty variable values
An empty or null variable value must be classified as Tier 1 Dynamic (Rule 4 safety net). This catches `access_token`, `refresh_token`, etc. that haven't been set yet at collection export time.
