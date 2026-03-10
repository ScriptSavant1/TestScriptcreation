# Changelog

All notable changes to the Bruno to DevWeb Converter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
