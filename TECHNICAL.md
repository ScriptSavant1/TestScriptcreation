# Technical Documentation — Bruno to DevWeb Converter v2.4.0

---

## Architecture

The pipeline has 4 stages: **Parse → Analyze → Classify → Generate**.

```
INPUT (any format)
  Postman v2.1 JSON | Bruno JSON | Bruno YAML folder | Bruno Single YAML | .bru file
  + optional environment.json
         │
         ▼
PARSER — src/parsers/brunoParser.js
  normalizeRequest() → request[] (the IR)
  { name, method, url, headers[], body, auth, event[], folder, id }
         │
         ├──► correlationDetector.js  — 2-pass producer/consumer matching
         ├──► customScriptParser.js   — script conversion + detectJwtUsage()
         └──► authenticationHandler.js — auth config extraction
         │
         ▼
GENERATOR (chosen by --protocol flag)

  devweb (default)               web-http
  ─────────────────              ─────────────────────────
  advancedScriptGenerator.js     webHttpScriptGenerator.js
    classifyVariables()            classifyVariables()
    detectJwtUsage()               detectJwtUsage()
    generateInitialize()           generateActionC()
    generateAction()               generateVuserInitC()
    generateFinalize()             generateVuserEndC()
                                   generateJwtHelperScript()

  mandatoryFilesGenerator.js     webHttpMandatoryFilesGenerator.js
    generateDevWebUsrFile()        generateUsrFile()
    generateDevWebDefaultCfg()     generateDefaultCfg()
    generateDevWebDefaultUsp()     generateDefaultUsp()
    generateDevWebScriptUpload..() generateScriptUploadMetadata()
    generateRtsYml()               generateParameterFilePrm()
    copyFromProjectRoot()          generateCollectionDataDat()
```

---

## Key Architectural Decisions

### 1. The Normalized Request IS the IR
`brunoParser.js::normalizeRequest()` (line ~651) converts all 5 input formats to a
consistent request object. This is the IR — no separate layer needed.

### 2. 3-Tier Classification Lives in Each Generator (NOT parameterizationEngine.js)
`classifyVariables()` is duplicated in `advancedScriptGenerator.js` and
`webHttpScriptGenerator.js`. `parameterizationEngine.js` is a raw value scanner —
it does NOT do 3-tier classification. Centralization is pending (Phase 1B).

### 3. Auth Handler Dynamic Awareness (v2.4.0 fix)
Always call `authHandler.setDynamicVarNames(this.dynamicVarNames)` AFTER `classifyVariables()`.
Without it: bearer token `{{access_token}}` → `load.params.accessToken` (wrong).
With it: `{{access_token}}` in dynamicVarNames → `load.global.accessToken` (correct).

### 4. Correlation Placement
Extractors/registrations are emitted BEFORE the producing request — not after.
`generateRequestBlock()` calls registrations first, then headers, then the web function.

### 5. Never Use new URL() on Template URLs
`new URL("https://{{baseUrl}}/path", "http://dummy")` encodes `{{` → `%7B%7B` silently.
Always split manually: `const qIdx = url.indexOf('?');`
This bug was fixed in correlationDetector.js in v2.4.0.

### 6. Snapshot Counter (VuGen only)
`this.snapshotCounter = 0` in constructor. `++this.snapshotCounter` in `generateWebFunction()`
produces `t1.inf`, `t2.inf`, ... across the entire Action.c script. Position: before `"Mode=HTML"`.

### 7. JWT Detection
`CustomScriptParser.detectJwtUsage(script)` — static method, usable from any generator.
Returns `{ isJwt, library, outputVars, algorithm }`.
JWT output vars MUST be added to `scriptSetVarNames` to force Tier 1 dynamic classification.

---

## Variable Classification (3-Tier)

Implemented in `classifyVariables()` inside each generator. Priority order (higher = wins):

| Priority | Condition | Result | Access |
|----------|-----------|--------|--------|
| 1 | `pm.*.set()` / `bru.setVar()` / `context.set()` in any script | Tier 1 Dynamic | `load.global.X` / `{_X}` |
| 2 | Correlation target | Tier 1 Dynamic | `load.global.X` / `{_X}` |
| 3 | Name starts with `_` AND empty value | Tier 1 Dynamic | `load.global.X` |
| 4 | Name starts with `$` (Postman built-in) | SKIP | not in CSV |
| 5 | JWT output var (from detectJwtUsage) | Tier 1 Dynamic | `load.global.X` |
| 6 | Credential name pattern (username/password/email/account) | Tier 3 Test Data | `load.params.X` nextValue: iteration |
| 7 | Everything else | Tier 2 Config | `load.params.X` nextValue: once |

Password → `nextRow: "same as username"` to keep credential pairs linked.

---

## Correlation Algorithm (2-Pass)

```
PASS 1 — What each request PRODUCES:
  • pm.*.set(varName) / bru.setVar(varName) in test scripts → variable name
  • Heuristic URL patterns: /login /auth /token /oauth → produces auth token
  • Response header patterns: Set-Cookie, Authorization, X-Auth-Token
  • JSON path inference from variable name context

PASS 2 — What each request CONSUMES:
  • Headers: {{varName}} references
  • URL path + query: {{varName}} — ALWAYS manual split, never new URL()
  • Request body: {{varName}} in JSON/form data
  • Pre-request scripts: pm.*.get(varName), bru.getVar(varName)

MATCH:
  Most recent producer before consumer (by request index)
  Output: correlations[] = [{ name, producerRequest, consumerRequest, type, extractPath }]

Extractor types: json | boundary | regex | cookie | header
```

---

## Authentication Handler

### Flow
```
1. authHandler.extractAuthentication(collection)  → authConfigs Map
2. classifyVariables()                             → dynamicVarNames Set
3. authHandler.setDynamicVarNames(dynamicVarNames) ← MUST call this before step 4
4. authHandler.generateInitializationCode()        → auth setup code

parameterize(value):
  {{access_token}} in dynamicVarNames  →  load.global.accessToken  ✓
  {{access_token}} NOT in dynamicVarNames  →  load.params.accessToken
```

### Supported Auth Types

| Type | DevWeb | VuGen C | Notes |
|------|--------|---------|-------|
| OAuth2 client_credentials | in initialize() | commented in vuser_init.c | token fetch |
| OAuth2 password grant | in initialize() | commented in vuser_init.c | token fetch |
| Bearer (dynamic token) | load.global.X | web_add_header before EACH request | from correlation |
| Bearer (static token) | load.params.X | {X} parameter | from CSV |
| Basic Auth | load.utils.base64Encode() | web_set_user() | |
| API Key (header) | defaults.headers | web_add_header before EACH request | |
| API Key (query) | URL append | {apiKey} in URL | |
| AWS Signature v4 | load.AWSAuthentication | not implemented | |
| Digest | load.setUserCredentials | not implemented | |
| JWT | jwt-lib.js commented block | generate_jwt.js pre-generator | |
| NTLM | declared, empty | declared, empty | pending |
| Cookie jar | not implemented | not implemented | pending |

---

## JWT Architecture

### jwt-lib.js (DevWeb — copied from project root to each script)
- Zero npm dependencies — Node.js built-in `crypto` only
- Algorithms: PS256/384/512, RS256/384/512, HS256/384/512, ES256/384/512
- ECDSA: DER→R‖S conversion handled (RFC 7518 §3.4)
- Key functions:
  - `generate({ algorithm, keyPath, key, secret, payload, header })` → signed JWT string
  - `decode(token)` → payload object (no signature verification)
  - `isExpiring(token, thresholdSec)` → true if `exp - now < threshold`
- Source: `DevWeb2/jwt-lib.js` — copy to project root for all scripts to use

### generate_jwt.js (VuGen — generated into each output folder)
- Standalone Node.js pre-generator — run BEFORE the VuGen test
- `node generate_jwt.js` → prints signed JWT to stdout
- Paste token into `collection_data.dat` (jwtToken column)
- Contains TODO placeholders: algorithm, keyPath, payload claims
- Uses jwt-lib.js internally

### Detection (customScriptParser.detectJwtUsage — static method)
```
jsrsasign:    "jsrsasign" anywhere  OR  "KJUR.jws.JWS.sign(" in script
jsonwebtoken: require('jsonwebtoken') AND .sign( in same script
jose:         require('jose') in script
manual crypto: crypto.sign( AND base64url in same script
```

---

## DevWeb File Formats (canonical source: DevWeb2/ reference project)

### [ScriptName].usr — key differences from VuGen Web HTTP format
```ini
Type=DevWeb            ; not Multi
RunType=DevWeb         ; not cci
ScriptLanguage=JavaScript
ActiveTypes=DevWeb     ; not QTWeb

[Actions]
Main=main.js           ; DevWeb has ONE action: Main

[ExtraFiles]           ; only YAML/config files go here
parameters.yml=
rts.yml=

[ManuallyExtraFiles]   ; JWT extra files go here (NOT in [ExtraFiles])
jwt-lib.js=
tranport.pem=
```

### default.usp — DevWeb run logic
- Only `[RunLogicRunRoot:Main]` child — DevWeb has no separate vuser_init/end actions
- `[RunLogicInitRoot]` and `[RunLogicEndRoot]` have `MercIniTreeSons=""` (empty)
- MUST include `[RunLogicErrorHandlerRoot]` + `[RunLogicErrorHandlerRoot:vuser_errorhandler]`

### default.cfg — DevWeb settings
- `Encoding=UTF8` (not ANSI)
- `LogOptions=LogExtended` (not LogBrief)
- `AutomaticTransactions=0`
- NO `[WEB]` section

### rts.yml — 11 canonical sections
`httpConnection`, `dns`, `grpc`, `proxy`, `ssl`, `replay`, `vts`, `encryption`,
`vuserLogger`, `flow`, `thinkTime`, `openTelemetry`, `userArguments`

Notable values from DevWeb2 reference:
- `replay.enableIntegratedAuthentication: true`
- `ssl.enableHTTP3: false`
- `dns.bypassSystem: false, ttl: 600`

### main.js function names (match DevWeb2 exactly)
```javascript
load.initialize('Initialize', async function() { ... });
load.action('Action',        async function() { ... });
load.finalize('Finalize',    async function() { ... });
```

---

## VuGen Web HTTP/HTML — C Code Rules

| Rule | Correct | Wrong |
|------|---------|-------|
| Get Vuser ID | `lr_whoami(&id, &grp, &sc)` | `lr_get_vuser_id()` — does NOT exist |
| Logging | `lr_output_message()` | `lr_log_message()` — log file only, not Output window |
| Correlation order | `web_reg_save_param_*` BEFORE producing request | After request |
| Header persistence | `web_add_header()` before EACH request that needs it | Set once, expect persistence |
| Snapshot | `"Snapshot=tN.inf"` immediately before `"Mode=HTML"` | Omitting snapshot |
| Large body | `BodyFilePath=` for bodies >500 chars | Inline `Body=` |
| .prm format | `[parameter:name]` INI sections | XML `<ParamList>` format |
| Transaction end | `lr_end_transaction("name", LR_AUTO)` | `LR_PASS` or `LR_FAIL` |
| C89 declarations | All vars at top of function block before statements | Declarations after statements |
| URL template vars | `{varName}` single braces | `{{varName}}` double braces |

---

## Project Root Files Required

These files must exist in the project root — generators copy them to output folders:

| File | Copied To | When |
|------|-----------|------|
| `DevWebSdk.d.ts` | Every DevWeb script folder | Always |
| `jwt-lib.js` | DevWeb script folders | When JWT detected |
| `tranport.pem` | DevWeb + VuGen script folders | When JWT detected |
| `jsrsasign.js` | (listed in ExtraFiles only) | When JWT detected in VuGen |

`copyFromProjectRoot()` in `mandatoryFilesGenerator.js` handles all copies.
Source: `path.join(__dirname, '..', '..', filename)` (two levels up from `src/generators/`).

---

## Pending Improvements (see memory/improvement-plan.md)

| Phase | Description |
|-------|-------------|
| 1B | Centralize `classifyVariables()` into `parameterizationEngine.js` |
| 2A | Formal dependency graph + consumer-before-producer warnings |
| 3B | Cookie jar auth in `authenticationHandler.js` |
| 3C | NTLM auth (declared but empty) |
| 4A | Parse `pm.response.json().field` chains in `customScriptParser.js` (line 287 TODO) |
| 4B | Regex extractor type in `correlationDetector.js` |
| 4C | Multi-value correlation (`Ord=All` for arrays) |
| 5A | Consumer-before-producer warning comments in generated script output |
| 5B | Bruno workspace settings (`.brurc`) reader for proxy/cert config |
