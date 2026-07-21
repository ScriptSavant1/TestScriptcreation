# LRE Toolkit — Code Structure

**Version:** 2.9.2 | **Date:** May 2026

---

## Directory Tree

```
bruno-devweb-converter/
│
├── app.js                          ← IIS entry point (iisnode calls this)
├── package.json                    ← Node.js dependencies and scripts
├── web.config                      ← IIS URL rewrite + iisnode handler config
│
├── DevWebSdk.d.ts                  ← TypeScript definitions for DevWeb SDK
├── jwt-helper.js                   ← DevWeb JWT signing helper (included in output)
├── jsrsasign.js                    ← Pure-JS RSA/EC crypto (included in VuGen output)
├── lre-utils.js                    ← Source: DPoP + PKCE + JWT crypto for VuGen
│                                      (deployed as lre-utils.dat in output ZIPs)
├── transport.pem                   ← Placeholder PEM key (included in JWT output)
│
├── src/
│   ├── index.js                    ← CLI entry point
│   ├── cli.js                      ← Commander CLI argument parser
│   │
│   ├── parsers/
│   │   ├── brunoParser.js          ← Postman v2.1 + Bruno JSON/YAML/.bru parser
│   │   └── jmxParser.js            ← JMeter .jmx XML → normalized request array
│   │
│   ├── analyzers/
│   │   ├── correlationDetector.js  ← 2-pass correlation for Converter
│   │   ├── parameterizationEngine.js ← Raw variable value scanner
│   │   ├── authenticationHandler.js  ← Auth detection + variable classification
│   │   └── customScriptParser.js    ← JWT/DPoP detection in pre-request scripts
│   │
│   ├── generators/
│   │   ├── advancedScriptGenerator.js      ← DevWeb main.js generator
│   │   ├── mandatoryFilesGenerator.js      ← DevWeb config files generator
│   │   ├── webHttpScriptGenerator.js       ← VuGen Action.c generator
│   │   └── webHttpMandatoryFilesGenerator.js ← VuGen config files generator
│   │
│   ├── converters/
│   │   └── jmxConverter.js         ← JMX orchestrator (uses all generators)
│   │
│   └── lib/
│       ├── memoryFsInterceptor.js  ← AsyncLocalStorage fs → in-memory Map
│       └── jmxDependencyResolver.js ← CSV file dependency checker for JMX
│
└── src/web/
    ├── server.js                   ← Express app (routes, multer, ZIP streaming)
    │
    ├── views/
    │   └── index.ejs               ← Portal SPA (ALL three tools + help panel)
    │
    └── public/
        ├── VuGen-Recorder.html     ← HAR Recorder (standalone client-side)
        ├── VuGen-Script-Studio.html        ← Script Studio shell (iframes lore)
        ├── studio-app.js                   ← Studio orchestrator (auth detection, ZIP assembly)
        ├── studio-codegen.js               ← Studio code generation (DevWeb + VuGen C)
        ├── studio-advisor.js               ← Correlation Advisor detection engine
        ├── studio-ui.js                    ← Advisor UI, modals, card rendering
        ├── VuGen-Script-Studio-constants.js ← Shared constants
        ├── VuGen-Script-Studio-app.js      ← DEAD FILE — not loaded, do not edit
        ├── VuGen-Script-Studio-correlation.js ← Studio correlation engine
        └── jszip.min.js            ← JSZip 3.10.1 (shared by Recorder + Studio)
```

---

## Key Files Explained

### app.js (Root)

The entry point for iisnode. Simply requires `src/web/server.js`. Exists because iisnode's handler must point to a root-level file.

```javascript
require('./src/web/server.js');
```

### src/web/server.js

Express application. Defines all HTTP routes:

| Route | Method | Handler |
|---|---|---|
| `/converter` | GET | Serves portal SPA |
| `/recorder` | GET | Serves VuGen-Recorder.html |
| `/studio` | GET | Serves VuGen-Script-Studio.html |
| `/convert-devweb` | POST | DevWeb conversion (Postman/Bruno) |
| `/convert-vugen` | POST | VuGen conversion (Postman/Bruno) |
| `/jmx-convert` | POST | JMX conversion |
| `/download/:token` | GET | Streams ZIP from in-memory store |

Uses `multer.memoryStorage()` for all uploads. Each conversion route wraps processing in `runWithMemoryFs()`.

### src/parsers/brunoParser.js

Handles all non-JMX inputs. Auto-detects format from file content:
- `info.schema` URL present → Postman v2.1
- `items[]` array, no schema → Bruno JSON
- `.yml`/`.yaml` extension → Bruno YAML (single file or folder)
- `.bru` extension → single Bruno request

Output shape for each request:
```javascript
{
    name: string,
    url: string,
    method: string,
    headers: [{name, value}],
    body: {mimeType, text, formData[]},
    auth: {type, ...},
    tests: [{event: 'prerequest'|'test', script: {exec}}],
    variables: {[name]: value}
}
```

**Critical:** Events/scripts are stored in `req.tests[]` (NOT `req.event[]`). All code that scans scripts must use `const events = req.tests || req.event || []`.

### src/analyzers/authenticationHandler.js

The most complex single file in the project. Responsibilities:
1. Detect authentication type from collection (9 types)
2. Detect NTLM/Kerberos variables (runs before `classifyVariables`)
3. Call `customScriptParser` for JWT/DPoP detection
4. `classifyVariables()` — 3-tier variable classification (7 rules)
5. Generate authentication code snippets consumed by generators

The `classifyVariables()` function is **duplicated** inside both `advancedScriptGenerator.js` and `webHttpScriptGenerator.js`. It operates on `this.variableMap` which is populated by the `parameterizationEngine`.

### src/lib/memoryFsInterceptor.js

Uses Node.js `AsyncLocalStorage` to intercept `fs` write operations. When code runs inside `runWithMemoryFs(fn)`:

- `fs.writeFile(path, data)` → `store.get().set(path, data)`
- `fs.writeFileSync(path, data)` → `store.get().set(path, data)`
- `fs.mkdir(path)` → no-op (directory structure is virtual)
- `fs.copyFileSync(src, dst)` → `store.get().set(dst, store.get().get(src))`

After processing, the caller reads the Map and feeds its entries to `archiver` for ZIP streaming.

### src/web/public/studio-app.js

Studio orchestrator. Contains `analyze()`, `tick()`, and `dlZip()`. Handles:
- HAR parsing and filtering
- Authentication detection (mirrors server-side logic)
- ZIP assembly via JSZip
- Delegates code generation to `studio-codegen.js`

### src/web/public/studio-codegen.js

~4000-line code generation module. Contains:
- All DevWeb + VuGen C generation logic
- Sentinel resolution pipeline (`\x00DYNSTART\x00`, `\x00PARAM\x00`, `@@ARRAY_RECONSTR@@`, etc.)
- Extractor generation for all extractor types (jsonpath, boundary, regexp, html, etc.)
- Parameter file generation

### src/web/public/VuGen-Script-Studio-app.js

**DEAD FILE — not loaded by any HTML page. Do not edit.** (Historical artifact from before Phase 4B split.)

### src/web/public/VuGen-Script-Studio-correlation.js

Contains the correlation engine for Script Studio:
- `valueBasedCorrelate(S)` — Two-HAR VBAC engine
- `singleHarCorrelate(S)` — Pattern-based single-HAR correlation
- `isDynamic(value)` — Dynamic value heuristic

---

## Data Flow Through the System

```
Input file (in RAM)
    │
    ▼
Parser (brunoParser / jmxParser)
    │ Normalized request array
    ▼
parameterizationEngine.analyzeCollection()
    │ variableMap: {name → {value, occurrences}}
    ▼
authenticationHandler.detectAuth()
    │ authConfig: {type, credentials, correlationTargets}
    │ variableMap enriched with tier classifications
    ▼
correlationDetector.detectCorrelations()
    │ correlations[]: [{name, sourceIdx, extractorType, usages[]}]
    ▼
Generator (advancedScriptGenerator / webHttpScriptGenerator)
    │ Calls fs.writeFile() for each output file
    │ (intercepted by memoryFsInterceptor → Map)
    ▼
memoryFsInterceptor Map
    │ {filename → Buffer}
    ▼
archiver.pipe(res) → ZIP → browser
```

---

## Adding a New Feature — Where to Touch

### New authentication type

1. `authenticationHandler.js` — add detection method + code generation
2. `advancedScriptGenerator.js` — consume the new auth config in `generateAuth()`
3. `webHttpScriptGenerator.js` — same for VuGen
4. `studio-app.js` — mirror the detection for Studio

### New extractor type (correlation)

1. `correlationDetector.js` — add extraction logic in `extractFromResponse()`
2. `advancedScriptGenerator.js` — add `case 'newtype':` in `generateExtractor()`
3. `webHttpScriptGenerator.js` — same for VuGen
4. `VuGen-Script-Studio-correlation.js` — add to Studio's correlation engine
5. `studio-codegen.js` — add code generation for new extractor type

### New input format (parser)

1. `brunoParser.js` — add detection + parsing into the same normalized shape
2. `server.js` — no route changes needed (all Postman/Bruno go through same route)

### New mandatory output file

1. `mandatoryFilesGenerator.js` — add file generation (DevWeb)
2. `webHttpMandatoryFilesGenerator.js` — add file generation (VuGen)
3. Update `.usr` file template to reference the new file if needed

---

## Variable Naming Conventions

| Prefix/Pattern | Meaning |
|---|---|
| `load.global.*` | DevWeb: shared between VUsers / iterations (dynamic Tier 1) |
| `load.params.*` | DevWeb: config/test-data from parameter file (Tier 2/3) |
| `{varName}` | VuGen: LR parameter substitution |
| `LR.getParam('name')` | VuGen JS: parameter access in web_js_run code |
| `S.has*` | Studio: feature flags (hasDpop, hasPkce, hasJwt, etc.) |
| `this.has*` | Converter generators: same feature flags |
| `\x00DYNSTART_Name\x00DYNEND` | Internal: body/URL substitution marker |
| `T01_`, `T02_` | Transaction name prefix (per-request sequential) |

---

*See also: [Architecture](ARCHITECTURE.md) | [Developer Guide](DEVELOPER-GUIDE.md) | [DevWeb Protocol Guide](DEVWEB-PROTOCOL.md)*
