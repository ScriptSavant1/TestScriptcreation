# Bruno to DevWeb Converter — Project Summary v2.6.1

**Production-ready framework for converting Bruno/Postman API collections to LoadRunner Enterprise
performance test scripts. Supports DevWeb (JavaScript) and VuGen Web HTTP/HTML (C) output.
Fully compatible with both Postman and Bruno collections — all runtime APIs, response patterns,
authentication types, JWT, proxy, headers, correlations, and CSRF/UUID generation.**

---

## What This Tool Does

Reads a collection file → analyzes variables/correlations/auth → generates a complete,
replay-ready LoadRunner script with all required config files.

**Input (any of):**
- Postman v2.1 JSON (`.json` with `info.schema` URL)
- Bruno JSON (`.json` with `items[]` array)
- Bruno YAML folder (directory with `opencollection.yml`)
- Bruno Single YAML (`.yml` / `.yaml`)
- Single `.bru` file
- Optional: environment `.json` for variable value override

**DevWeb (JavaScript) Output:**
main.js, scenario.yml, rts.yml (11 sections), tsconfig.json,
[ScriptName].usr, default.cfg, default.usp, ScriptUploadMetadata.xml,
DevWebSdk.d.ts, parameters.yml, collection_data.csv,
jwt-lib.js + tranport.pem (when JWT detected),
data/*.b64 / data/*.dat (large base64 bodies)

**VuGen Web HTTP/HTML (C) Output:**
Action.c, vuser_init.c, vuser_end.c, globals.h,
[ScriptName].usr, default.cfg, default.usp, ScriptUploadMetadata.xml,
ParameterFile.prm (INI format), collection_data.dat,
generate_jwt.js (when JWT detected),
data/*.b64 / data/*.dat (large base64 bodies)

---

## Key Features

### Smart Variable Classification (3-tier)
| Tier | Name | Access | Examples | CSV |
|------|------|--------|----------|-----|
| 1 | Dynamic | `load.global.X` / `{_X}` in VuGen | accessToken, jwtToken, userId, csrfToken | NO |
| 2 | Config | `load.params.X` / `{X}` in VuGen | baseUrl, clientId, apiKey, version | YES (once) |
| 3 | Test Data | `load.params.X` / `{X}` in VuGen | username, password, email | YES (iteration) |

Detection priority: script-set vars → correlations → `_` prefix → `$` skip → credential pattern → config

### JWT Authentication
- **Detection**: fingerprints jsrsasign / jsonwebtoken / jose / manual crypto in pre-request scripts
- **DevWeb**: copies jwt-lib.js + tranport.pem from project root, commented-out JWT block in initialize()
- **VuGen**: generate_jwt.js pre-generator written to output, jsrsasign.js in [ManuallyExtraFiles]

### Correlation Detection (2-pass)
- Scans scripts for producers (pm.*.set, bru.setVar), infers from URL patterns
- Emits extractors BEFORE the producing request (JsonPath / boundary / regex)
- DevWeb: `new load.JsonPathExtractor()` | VuGen: `web_reg_save_param_json()`

### Authentication
OAuth2 CC/password/auth_code, Bearer (dynamic-aware), Basic, API Key, AWS Sig v4, Digest, JWT

### Large Base64 Bodies
- >500 chars → extracted to data/ folder with MD5 deduplication
- DevWeb: `fs.readFileSync()` | VuGen: `BodyFilePath=`

### Complete File Generation
Every output is immediately openable in VuGen without manual editing.
Includes .usr, .cfg, .usp, ScriptUploadMetadata.xml for both protocols.

---

## Quick Start

```bash
# DevWeb (JavaScript) — default
node src/cli.js convert -i collection.json -o ./output/

# VuGen Web HTTP/HTML (C)
node src/cli.js convert -i collection.json --protocol web-http -o ./output/

# With environment override
node src/cli.js convert -i collection.json -e environment.json -o ./output/

# Multi-script (one script per top-level folder)
node src/cli.js convert -i collection.json -m multi -o ./output/

# Web UI
node src/web/server.js   # → http://localhost:3000
```

---

## Source Structure

```
src/
├── cli.js                              CLI (commander)
├── index.js                            Orchestrator: parse → analyze → generate
├── parsers/
│   └── brunoParser.js                  All 5 input formats → normalized request[]
├── analyzers/
│   ├── correlationDetector.js          2-pass correlation (FIXED v2.4.0: new URL() bug)
│   ├── parameterizationEngine.js       Raw value scanner (NOT the 3-tier classifier)
│   ├── authenticationHandler.js        Auth code gen (dynamic-aware v2.4.0)
│   └── customScriptParser.js           Script conversion + detectJwtUsage() (v2.4.0)
└── generators/
    ├── advancedScriptGenerator.js      DevWeb: main.js + all mandatory files
    ├── mandatoryFilesGenerator.js      DevWeb: .usr/.cfg/.usp/XML/rts.yml (OVERHAULED v2.4.0)
    ├── webHttpScriptGenerator.js       VuGen: Action.c + all C files + generate_jwt.js
    └── webHttpMandatoryFilesGenerator.js  VuGen: .usr/.cfg/.usp/.prm/.dat/.xml

DevWeb2/          Canonical reference DevWeb project (source of truth for all DevWeb file formats)
devweb-prompts/   15 AI prompt files for AI-assisted conversion without the Node.js tool
```

---

## Project Root Files (place these before running)

| File | Used By | Notes |
|------|---------|-------|
| `DevWebSdk.d.ts` | DevWeb (always) | Copy from VuGen installation |
| `jwt-lib.js` | DevWeb JWT | Exists in DevWeb2/ — copy to root |
| `tranport.pem` | DevWeb & VuGen JWT | Empty placeholder — fill with real private key |
| `jsrsasign.js` | VuGen JWT | User places here; added to ExtraFiles |

---

## Variable Classification — 5 Rules (Generic, Future-Proof)

| Rule | Condition | Result |
|------|-----------|--------|
| 1 | Set by any script (bru.setEnv, pm.*.set, etc.) | Tier 1 Dynamic |
| 2 | Correlation target | Tier 1 Dynamic |
| 3 | Name starts with `_` | Tier 1 Dynamic |
| **4** | **Empty value + not credential** | **Tier 1 Dynamic** ← safety net |
| 5 | Has real value | Tier 2 Config or Tier 3 Test Data |

Rule 4 ensures runtime vars (access_token, refresh_token, interaction_id) are **never** in parameters — they are always left empty in collections intentionally.

---

## Per-Request Transactions (v2.6.0 / v2.6.1)

Each API request = one LR transaction `T{nn}_{RequestName}`. Sequential global counter across all folders.

**DevWeb structure (v2.6.1)** — transactions declared BEFORE `initialize()`:
```
JWT require + setUserCertificate → load.WebRequest.defaults → const T01 = new load.Transaction(...)
→ load.initialize() → load.action() { T01.start(); ... T01.stop(); }
```

---

## Version History

| Version | Highlights |
|---------|------------|
| **2.6.1** | DevWeb: all transactions pre-declared at module level BEFORE initialize() |
| 2.6.0 | Per-request transactions both protocols: T01_GetToken, T02_CreateOrder globally sequential |
| 2.5.5 | Extractor name + accessor consistency (both use sanitized name) |
| 2.5.4 | Bruno JSON: item.script.req/res format support in parser + correlationDetector |
| **2.5.3** | brunoParser syntax fix, Generic Rule 4 (empty=dynamic), library name exclusion strengthened |
| 2.5.2 | Bruno YAML event detection: detectScriptSetVariables + extractTestScript robustness |
| 2.5.1 | sanitizeVarName for hyphenated vars, Bearer token consumer detection, Bruno getter APIs |
| 2.5.0 | bru.setGlobalVar/setNextEnvVar, res.headers/cookies extractors, header/cookie generation |
| 2.4.9 | Bruno script runtime API full coverage, body?.field, indirect var resolution |
| 2.4.8 | Proxy auto-detection from collection/env vars |
| 2.4.7 | VuGen default.cfg: 9 sections, 163 lines canonical |
| 2.4.6 | VuGen gen_uuid/gen_csrf_token/gen_hex64 C functions; CSRF auto-detection |
| 2.4.5 | Smart header classification: global auto-headers vs per-request |
| **2.4.0** | JWT auth, DevWeb full file set (.usr/.cfg/.usp/XML), correlation URL bug fix, bru.setVar |
| 2.3.4 | Snapshot=tN.inf in all VuGen requests |
| 2.3.0 | VuGen Web HTTP/HTML protocol support (--protocol web-http) |
