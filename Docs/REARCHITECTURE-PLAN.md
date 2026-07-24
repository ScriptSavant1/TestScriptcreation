# Project Rearchitecture Plan — Loosely Coupled Modular Design

**Created:** 2026-06-03  
**Status:** APPROVED — pending implementation  
**Decision:** Incremental 4-phase migration. No big-bang rewrite. Each phase is independently deployable.

---

## 1. Why Rearchitecture Is Needed

### The Core Problem: Tight Coupling Through Duplication

The project has 4 tools that all produce DevWeb and VuGen scripts:

| Tool | Input | Output |
|---|---|---|
| Postman / Bruno Converter | `.json`, `.yml`, `.bru` | DevWeb + VuGen |
| JMX Converter | `.jmx` | DevWeb + VuGen |
| Recorder | HAR / NetLog | VuGen (browser) |
| Script Studio | HAR / NetLog | DevWeb + VuGen (browser) |

Because the output formats are shared but the code is not, the same logic is copy-pasted across multiple files. **When one copy has a bug, all copies have the bug — but only some get fixed.**

### Evidence: The `web_reg_save_param` Bug

In June 2026 a bug was found: `web_reg_save_param()` was being emitted with `"ParamName=X"` as its first argument (wrong) instead of just `"X"` (correct). The fix had to be applied in **two separate files**:

- `src/generators/webHttpScriptGenerator.js` — server-side generator
- `src/web/public/VuGen-Script-Studio-app.js` — browser-side Studio

This proved the same logic existed in multiple places with no shared source of truth.

### Duplicated Code Inventory

| Logic | File 1 | File 2 | File 3 |
|---|---|---|---|
| `classifyVariables()` (7-rule system) | `advancedScriptGenerator.js:579` | `webHttpScriptGenerator.js:415` | — |
| `detectScriptSetVariables()` | `advancedScriptGenerator.js:432` | `webHttpScriptGenerator.js:361` | — |
| `detectProxyConfig()` | `advancedScriptGenerator.js` | `webHttpScriptGenerator.js` | — |
| `detectNtlmKerberos()` | `advancedScriptGenerator.js` | `webHttpScriptGenerator.js` | — |
| `buildTransactionMap()` | `advancedScriptGenerator.js` | `webHttpScriptGenerator.js` | — |
| `sanitizeVarName()` | `advancedScriptGenerator.js` | `webHttpScriptGenerator.js` | — |
| `escapeCString()` | `advancedScriptGenerator.js` | `webHttpScriptGenerator.js` | — |
| `decodeHtmlEntities()` | `mandatoryFilesGenerator.js:34` | `webHttpMandatoryFilesGenerator.js:859` | — |
| `web_reg_save_param` emission | `webHttpScriptGenerator.js:1849` | `VuGen-Script-Studio-app.js:1061` | — |

**The two main generators together are 6,135 lines and share ~40% identical code.**

### Current Architecture Diagram

```
Postman/Bruno ──►  index.js (806 lines)
                      │
JMX ──────────►  jmxConverter.js (551 lines)
                      │
                      ▼
              advancedScriptGenerator.js (3,227 lines)  ← DevWeb
              webHttpScriptGenerator.js  (2,908 lines)  ← VuGen
                  │                │
                  │     BOTH contain:
                  │     - classifyVariables() ← DUPLICATED
                  │     - detectScriptSetVars() ← DUPLICATED
                  │     - web_reg_save_param rules ← DUPLICATED
                  │
Recorder ──────► VuGen-Recorder.html (inline JS)
                  └── web_reg_save_param rules ← 3rd copy

Script Studio ─► VuGen-Script-Studio-app.js (4,707 lines!)
                  ├── UI logic
                  ├── Filter logic
                  ├── HAR processing
                  └── web_reg_save_param rules ← 4th copy
```

---

## 2. Target Architecture

### Design Principle

> **Each piece of business logic lives in exactly one file. All tools import from that file.**

### Layers

```
INPUT ──► PARSE ──► ANALYSE ──► GENERATE ──► OUTPUT
```

- **INPUT**: Different per tool (collection file, JMX, HAR)
- **PARSE**: Each format has its own parser → produces NormalizedCollection
- **ANALYSE**: Shared pipeline (correlation, variables, auth, custom scripts)
- **GENERATE**: Shared generators (one for DevWeb, one for VuGen)
- **OUTPUT**: ZIP with generated files

### Target Folder Structure

```
src/
│
├── core/                          ← NEW — pure shared logic, no I/O, no side effects
│   ├── variableClassifier.js      ← classifyVariables() — SINGLE COPY
│   ├── vugenCodegen.js            ← web_reg_save_param rules — SINGLE COPY
│   ├── devwebCodegen.js           ← load.transaction extraction — SINGLE COPY
│   └── utils.js                   ← decodeHtmlEntities, sanitizeVarName,
│                                      escapeCString, buildBaseUrl — SINGLE COPY
│
├── parsers/                       ← UNCHANGED — already well structured
│   ├── postmanParser.js
│   ├── brunoParser.js
│   └── jmxParser.js
│
├── analyzers/                     ← UNCHANGED — already well structured
│   ├── correlationDetector.js
│   ├── parameterizationEngine.js
│   ├── authenticationHandler.js
│   ├── customScriptParser.js
│   └── jwt-helper.js
│
├── generators/
│   ├── devweb/
│   │   ├── scriptGenerator.js     ← renamed from advancedScriptGenerator.js
│   │   └── filesGenerator.js      ← renamed from mandatoryFilesGenerator.js
│   └── vugen/
│       ├── scriptGenerator.js     ← renamed from webHttpScriptGenerator.js
│       └── filesGenerator.js      ← renamed from webHttpMandatoryFilesGenerator.js
│
├── tools/                         ← NEW — each tool is self-contained
│   ├── collection-converter/
│   │   └── index.js               ← was src/index.js (BrunoDevWebConverter)
│   ├── jmx-converter/
│   │   └── index.js               ← was src/converters/jmxConverter.js
│   ├── recorder/
│   │   └── index.js               ← new server-side support module
│   └── script-studio/
│       └── index.js               ← new server-side support module
│
├── web/
│   ├── server.js                  ← thin HTTP layer only, no business logic
│   └── public/
│       ├── shared/                ← NEW — core/ mirrored for browser use
│       │   ├── vugen-codegen.js   ← copy of core/vugenCodegen.js
│       │   └── utils.js           ← copy of core/utils.js
│       ├── recorder/
│       │   ├── VuGen-Recorder.html
│       │   ├── recorder-ui.js     ← UI rendering only
│       │   └── recorder-filters.js ← filter panel logic
│       └── script-studio/
│           ├── VuGen-Script-Studio.html
│           ├── VuGen-Script-Studio.css
│           ├── studio-app.js        ← thin orchestrator (~200 lines)
│           ├── studio-ui.js         ← phase / filter UI rendering
│           ├── studio-codegen.js    ← HAR → script generation
│           └── studio-correlation.js ← correlation detection
│
├── lib/
│   ├── memoryFsInterceptor.js     ← UNCHANGED
│   └── jmxDependencyResolver.js   ← UNCHANGED
│
├── cli.js                         ← UNCHANGED (update require paths only)
└── workloadExcelGenerator.js      ← move to generators/ if needed
```

### After Migration: Single-File Changes

| What changes in future | Files to edit |
|---|---|
| `web_reg_save_param` syntax rule | **1 file**: `core/vugenCodegen.js` |
| Variable classification rule | **1 file**: `core/variableClassifier.js` |
| DevWeb correlation code | **1 file**: `core/devwebCodegen.js` |
| Utility function (escape, decode, sanitize) | **1 file**: `core/utils.js` |
| JMX parsing | **1 file**: `parsers/jmxParser.js` |
| JMX conversion | **1 file**: `tools/jmx-converter/index.js` |
| Postman/Bruno conversion | **1 file**: `tools/collection-converter/index.js` |

---

## 3. Phase Implementation Plan

### Phase 1 — Extract `core/utils.js`
**Risk: ZERO** | **Effort: 1-2 days** | **Lines saved: ~60**

**What moves:**
- `decodeHtmlEntities(value)` — defined in both mandatory-file generators
- `sanitizeVarName(name)` — defined in both script generators  
- `escapeCString(str)` — defined in both script generators
- `buildBaseUrl(domain, port, protocol)` — defined in jmxParser.js and generators

**Files to update after extraction:**
```
src/generators/advancedScriptGenerator.js    ← import from core/utils
src/generators/webHttpScriptGenerator.js     ← import from core/utils
src/generators/mandatoryFilesGenerator.js    ← import from core/utils
src/generators/webHttpMandatoryFilesGenerator.js ← import from core/utils
src/parsers/jmxParser.js                     ← import from core/utils
```

**No logic changes.** Pure file reorganisation.

**Verification:**
```
Run: Postman collection → DevWeb → compare output files (must be byte-identical)
Run: Postman collection → VuGen → compare output files (must be byte-identical)
Run: JMX file → DevWeb → compare output files (must be byte-identical)
Run: JMX file → VuGen → compare output files (must be byte-identical)
```

---

### Phase 2 — Extract `core/variableClassifier.js`
**Risk: LOW** | **Effort: 3-5 days** | **Lines saved: ~300 per generator**

**What moves:**
The 7-rule `classifyVariables()` logic currently copy-pasted between both generators.

**7 rules (must be preserved exactly):**
1. JMX CSVDataSet column → Tier 3 Param (EachIteration)
2. Script-set vars (`bru.setEnv`, `pm.*.set`, `vars.put`) → Tier 1 Dynamic
3. Correlation target → Tier 1 Dynamic
4. Private/crypto key name pattern → Tier 1 Dynamic (never parameterize)
5. `_` prefix → Tier 1 Dynamic (regardless of value)
6. Empty/null value → Tier 1 Dynamic (safety net)
7. Real value + credential → Tier 3 Test Data; Real value + not credential → Tier 2 Config

**Interface for `core/variableClassifier.js`:**
```javascript
// Input: variableMap, correlations, scriptSetVarNames, csvColumns, privateKeyPattern
// Output: { dynamicVarNames, paramVarNames, configVarNames, testDataVarNames }
function classifyVariables(options) { ... }

module.exports = { classifyVariables };
```

Both generators call `classifyVariables()` and store results — no other changes.

**Verification:**
```
Test: Collection with known variables → check collection_data.csv tiers match expected
Test: JMX with CSVDataSet → Tier 3 columns correct
Test: Postman with pm.environment.set → Tier 1 dynamic
Test: Private key variable → Tier 1, not in CSV
```

---

### Phase 3 — Extract `core/vugenCodegen.js`
**Risk: MEDIUM** | **Effort: 3-5 days** | **Lines saved: ~150 total, bug surface eliminated**

**What moves:**
All `web_reg_save_param*` emission rules — currently in:
- `webHttpScriptGenerator.js` (server-side generator)
- `VuGen-Script-Studio-app.js` `webHttpCorrCode()` function (browser Studio)

**Interface for `core/vugenCodegen.js`:**
```javascript
/**
 * Emit the correct web_reg_save_param* call for a correlation.
 * This is the SINGLE SOURCE OF TRUTH for VuGen correlation syntax.
 *
 * Rules (per VuGen 26.1 docs):
 *   web_reg_save_param         → plain name as first arg (NOT "ParamName=")
 *   web_reg_save_param_json    → "ParamName=xxx" first arg
 *   web_reg_save_param_regexp  → "ParamName=xxx" + Ordinal= (not Ord=)
 *   web_reg_save_param_xpath   → "ParamName=xxx" + QueryString= (not XPath=)
 */
function generateWebRegSaveParam(corr, indent) { ... }
function generateWebRegSaveParamJson(corr, indent) { ... }
function generateWebRegSaveParamRegexp(corr, indent) { ... }
function generateWebRegSaveParamXpath(corr, indent) { ... }

module.exports = { generateWebRegSaveParam, ... };
```

**Browser use:**
The file is also placed at `src/web/public/shared/vugen-codegen.js` loaded via `<script>` tag. A simple `npm run sync-core` script copies `src/core/*.js` to `src/web/public/shared/`.

**Verification:**
```
Test: Header extraction correlation → correct web_reg_save_param("name", "LB=...", ...) 
Test: Cookie extraction → no "ParamName=" prefix on plain function
Test: JSON path extraction → correct "ParamName=xxx" on _json variant
Test: Regexp extraction → Ordinal= attribute (not Ord=)
Test: Studio generates identical output to server-side generator for same HAR
```

---

### Phase 4 — Reorganise Folders + Split Frontend
**Risk: MEDIUM-HIGH** | **Effort: 1-2 weeks**

**Part A: Move backend files (mechanical, low risk)**

| Current path | New path |
|---|---|
| `src/index.js` | `src/tools/collection-converter/index.js` |
| `src/converters/jmxConverter.js` | `src/tools/jmx-converter/index.js` |
| `src/generators/advancedScriptGenerator.js` | `src/generators/devweb/scriptGenerator.js` |
| `src/generators/mandatoryFilesGenerator.js` | `src/generators/devweb/filesGenerator.js` |
| `src/generators/webHttpScriptGenerator.js` | `src/generators/vugen/scriptGenerator.js` |
| `src/generators/webHttpMandatoryFilesGenerator.js` | `src/generators/vugen/filesGenerator.js` |

Update all `require()` paths. No logic changes.

**Part B: Split `VuGen-Script-Studio-app.js` (4,707 lines → 4 files)**

| New file | Content | Approx lines |
|---|---|---|
| `studio-app.js` | Orchestrator: event wiring, phase switching, download | ~200 |
| `studio-ui.js` | Filter panel rendering, drop zone, stats display | ~600 |
| `studio-codegen.js` | `genActionC()`, `webHttpCorrCode()`, all code generation | ~1,800 |
| `studio-correlation.js` | HAR parsing, correlation detection (already partially in correlation.js) | ~600 |

Load order in HTML: `studio-correlation.js` → `studio-codegen.js` → `studio-ui.js` → `studio-app.js`

**Verification:**
```
Full end-to-end test of all 4 tools via web UI
CLI test for both converters
Compare generated ZIP contents before and after for identical output
```

---

## 4. What NOT to Change

These files are already well-structured and should not be touched:

- `src/analyzers/correlationDetector.js` — clean, single responsibility
- `src/analyzers/parameterizationEngine.js` — clean, single responsibility  
- `src/analyzers/authenticationHandler.js` — clean, single responsibility
- `src/analyzers/customScriptParser.js` — clean, single responsibility
- `src/parsers/brunoParser.js` — clean input adapter
- `src/parsers/postmanParser.js` — clean input adapter
- `src/lib/memoryFsInterceptor.js` — clean utility
- `src/lib/jmxDependencyResolver.js` — clean utility
- `src/web/server.js` — thin HTTP layer, acceptable as-is

---

## 5. Migration Rules (for any AI assistant)

When implementing any phase:

1. **No logic changes inside a phase.** Move code only. If a bug is found, fix it separately before or after the phase.
2. **One phase = one commit.** Do not mix phase work with feature work.
3. **Verify before proceeding.** Each phase must pass its verification checklist before starting the next.
4. **Keep old paths working temporarily.** Use `module.exports = require('./new/path')` shim files during transition if needed.
5. **Do not change the NormalizedCollection interface.** Parsers produce it, analyzers and generators consume it. Changing it touches everything.

---

## 6. NormalizedCollection Interface (Do Not Break)

All parsers produce this format. All generators consume it. This is the contract:

```javascript
{
  info: {
    name: string,
    schema: string,
    type: 'postman' | 'bruno' | 'jmeter'
  },
  item: [                    // requests array
    {
      name: string,
      method: string,
      url: string,
      headers: [{ key, value, disabled }],
      body: {
        mode: 'raw' | 'urlencoded' | 'formdata',
        raw: string,
        urlencoded: [{ key, value, disabled }]
      },
      auth: { type, ... },
      tests: [{ listen: 'prerequest'|'test', script: { exec } }],
      folder: string,
      extractors: [...],     // JMX explicit extractors
      preScripts: [{ code, lang }],
      postScripts: [{ code, lang }]
    }
  ],
  variable: [{ key, value, disabled }],
  auth: { type, ... }
}
```

---

## 7. Phase Status Tracker

| Phase | Status | Branch | Completed |
|---|---|---|---|
| Phase 1 — core/utils.js | **DONE** | script-multi-split | 2026-06-03 |
| Phase 2 — core/variableClassifier.js | **DONE** | script-multi-split | 2026-06-03 |
| Phase 3 — core/vugenCodegen.js | **DONE** | script-multi-split | 2026-06-04 |
| Phase 4A — Backend folder reorganisation | **DONE** | script-multi-split | 2026-06-04 |
| Phase 4B — Frontend app.js split | **DONE** | script-multi-split | 2026-06-04 |

---

## 8. Quick Reference — Which Files Own Which Concern

After the rearchitecture is complete, use this as the definitive routing guide:

| Concern | File |
|---|---|
| VuGen `web_reg_save_param` syntax | `src/core/vugenCodegen.js` |
| DevWeb correlation code (`load.transaction...`) | `src/core/devwebCodegen.js` |
| Variable 3-tier classification (7 rules) | `src/core/variableClassifier.js` |
| HTML entity decode | `src/core/utils.js` |
| VarName sanitisation | `src/core/utils.js` |
| C-string escaping | `src/core/utils.js` |
| Correlation detection algorithm | `src/analyzers/correlationDetector.js` |
| Variable parameterization scan | `src/analyzers/parameterizationEngine.js` |
| Authentication detection | `src/analyzers/authenticationHandler.js` |
| Custom script (Groovy/JS) conversion | `src/analyzers/customScriptParser.js` |
| Postman / Bruno parsing | `src/parsers/brunoParser.js` |
| JMeter JMX parsing | `src/parsers/jmxParser.js` |
| DevWeb script generation | `src/generators/devweb/scriptGenerator.js` |
| DevWeb mandatory files | `src/generators/devweb/filesGenerator.js` |
| VuGen script generation | `src/generators/vugen/scriptGenerator.js` |
| VuGen mandatory files | `src/generators/vugen/filesGenerator.js` |
| Postman/Bruno tool orchestration | `src/tools/collection-converter/index.js` |
| JMX tool orchestration | `src/tools/jmx-converter/index.js` |
| HTTP endpoints | `src/web/server.js` |
| Script Studio UI | `src/web/public/script-studio/studio-ui.js` |
| Script Studio code generation | `src/web/public/script-studio/studio-codegen.js` |
| Recorder UI | `src/web/public/recorder/recorder-ui.js` |
