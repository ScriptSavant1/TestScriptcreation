# Bruno / Postman / JMeter → LoadRunner Enterprise Converter
## Complete Implementation Reference

**Version:** 2.9.2 (branch: `dpop-Test`)  
**Last Updated:** 2026-05-01  
**Author:** Engineering Team

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Architecture at a Glance](#2-architecture-at-a-glance)
3. [Supported Input Formats](#3-supported-input-formats)
4. [Server & Privacy Architecture](#4-server--privacy-architecture)
5. [Variable Classification Engine](#5-variable-classification-engine)
6. [Authentication Handler](#6-authentication-handler)
7. [Correlation Engine](#7-correlation-engine)
8. [JWT Detection & Generation](#8-jwt-detection--generation)
9. [Per-Request Transactions](#9-per-request-transactions)
10. [DevWeb Script Generator](#10-devweb-script-generator)
11. [VuGen Web HTTP/HTML Generator](#11-vugen-web-httphtml-generator)
12. [JMX / JMeter Converter](#12-jmx--jmeter-converter)
13. [VuGen Script Studio (Browser Tool)](#13-vugen-script-studio-browser-tool)
14. [Parameter Files & Data Strategy](#14-parameter-files--data-strategy)
15. [Proxy Auto-Detection](#15-proxy-auto-detection)
16. [AI Prompt Files](#16-ai-prompt-files)
17. [Critical Bug Fixes History](#17-critical-bug-fixes-history)
18. [Known Constraints & Gotchas](#18-known-constraints--gotchas)
19. [Future Enhancement Ideas](#19-future-enhancement-ideas)

---

## 1. Project Overview

This tool converts API test collections from three popular testing tools into production-ready load test scripts for **LoadRunner Enterprise (LRE)**:

| Source Tool | Input Format | Target Protocol |
|-------------|--------------|-----------------|
| Bruno | `.bru`, `.yml`, JSON export | DevWeb (JS) + Web HTTP/HTML (C) |
| Postman | Collection v2.1 JSON | DevWeb (JS) + Web HTTP/HTML (C) |
| JMeter | `.jmx` XML | DevWeb (JS) + Web HTTP/HTML (C) |

**What it automates that would otherwise take days manually:**
- Dynamic correlation (tokens, session IDs, CSRF values, OAuth codes)
- 3-tier variable parameterization (dynamic / config / test data)
- Authentication scaffolding (OAuth2, JWT, Basic, Bearer, API Key, AWS SigV4, NTLM/Kerberos, Digest)
- Per-request transactions with sequential naming
- Parameter files with correct LRE INI format
- All mandatory support files (`.usr`, `rts.yml`, `parameters.yml`, `scenario.yml`, `globals.h`, etc.)
- JWT helper scripts for runtime token signing
- Proxy configuration injection
- CSRF/UUID/hex64 per-request dynamic value generation

---

## 2. Architecture at a Glance

```
Input Formats
  │
  ├── Postman v2.1 JSON ──────┐
  ├── Bruno JSON export ──────┤
  ├── Bruno YAML / .bru ──────┼──→ brunoParser.js / jmxParser.js
  └── JMeter .jmx ────────────┘          │
                                          ▼
                              jmxConverter.js / converter.js
                                          │
                              ┌───────────┴─────────────┐
                              │                         │
                       parameterizationEngine       correlationDetector
                       authenticationHandler        customScriptParser
                       (classifyVariables)          (detectJwtUsage)
                              │
                  ┌───────────┴────────────────┐
                  │                            │
      advancedScriptGenerator.js     webHttpScriptGenerator.js
      mandatoryFilesGenerator.js     webHttpMandatoryFilesGenerator.js
                  │                            │
                  └────────────┬───────────────┘
                               │
                    memoryFsInterceptor.js
                    (in-RAM virtual filesystem)
                               │
                        ZIP → browser
```

### Key Source Files

| File | Role |
|------|------|
| `src/generators/advancedScriptGenerator.js` | DevWeb `main.js` + all DevWeb files |
| `src/generators/mandatoryFilesGenerator.js` | DevWeb config files (rts.yml, parameters.yml, etc.) |
| `src/generators/webHttpScriptGenerator.js` | VuGen `Action.c` + C support files |
| `src/generators/webHttpMandatoryFilesGenerator.js` | VuGen PRM/DAT/USR/CFG files |
| `src/generators/workloadExcelGenerator.js` | Workload model Excel export |
| `src/lib/memoryFsInterceptor.js` | RAM-only virtual filesystem (no disk writes) |
| `src/lib/jmxDependencyResolver.js` | JMX library/plugin dependency analysis |
| `src/web/public/VuGen-Script-Studio.html` | Browser-based HAR analysis tool (HTML shell) |
| `src/web/public/VuGen-Script-Studio-constants.js` | State object `S` + all constants + templates |
| `src/web/public/VuGen-Script-Studio-correlation.js` | HAR parser + correlation engine + Phase 4 VBAC |
| `src/web/public/VuGen-Script-Studio-codegen.js` | Code generators (DevWeb + VuGen) for Studio |
| `src/web/public/VuGen-Script-Studio-app.js` | UI logic, analyze(), ZIP, render |

---

## 3. Supported Input Formats

### Detection Logic (in order)

```
file extension = .yml / .yaml    → Bruno Single YAML  → parseBrunoYamlCollection()
file is a directory              → Bruno YAML folder  → walkBrunoYamlDir()
file extension = .bru            → Single .bru file   → parseBru()
JSON has info.schema URL         → Postman v2.1        → parseJSON()
JSON has items[] array           → Bruno JSON export  → parseJSON()
file extension = .jmx            → JMeter             → jmxParser → jmxConverter
```

### Format-Specific Notes

**Bruno YAML:**
- `item.info.type` (NOT `item.type`) = `"folder"` | `"http"`
- `item.info.seq` = ordering field
- Headers use `headers[].name` (NOT `.key`)
- Collection-level `request.headers` → sent with every request (collectionHeaders)
- Collection-level `request.auth` → commented OAuth2 block in `initialize()`
- Scripts stored in `req.tests[]` NOT `req.event[]` — **all script scanning MUST check both**

**Bruno JSON Export:**
- Scripts in `item.script.req` (pre-request) and `item.script.res` (post-response)
- Postman uses `item.event[]` — they are different formats, both handled

**JMeter JMX:**
- Thread groups → action requests
- setUp Thread Groups → `initialize()` / `vuser_init.c`
- tearDown Thread Groups → `finalize()` / `vuser_end.c`
- `<Arguments testclass="Arguments">` → User Defined Variables (UDVs)
- `<CSVDataSet>` → test data parameters (ParameterFile.prm)
- JSR223/BeanShell samplers → JWT detection + Groovy/Java fingerprint matching

---

## 4. Server & Privacy Architecture

### Zero-Disk Design (v2.7.0)

All file processing happens entirely in RAM. No uploaded data is ever written to disk.

**How it works:**

```
User uploads collection file
         │
   multer.memoryStorage()        ← file stays in Node.js Buffer, never touches disk
         │
   converter runs inside
   runWithMemoryFs() context
         │
   memoryFsInterceptor.js        ← AsyncLocalStorage intercepts ALL fs writes:
   intercepts:                      writeFile, writeFileSync, mkdir, mkdirSync,
     all fs calls                   copyFileSync → stored in Map<path, content>
         │
   archiver streams ZIP
   directly from Map → res        ← no zip file on disk; no temp files
         │
   browser downloads ZIP
```

**Why chunked transfer:**
- No `Content-Length` header → chunked transfer encoding
- Bypasses corporate proxy size restrictions that block large responses
- `Content-Type: application/octet-stream` (not `application/zip`) → avoids zip-specific proxy filters

**CLI usage:** Unaffected — interceptor only activates inside `runWithMemoryFs()` context. CLI writes normally.

---

## 5. Variable Classification Engine

### 3-Tier System

Every variable/environment variable found in a collection is classified into one of three tiers:

| Tier | Name | LRE Construct | `nextValue` | Typical Values |
|------|------|---------------|-------------|----------------|
| 1 | **Dynamic** | `load.global.varName` / `{_varName}` | N/A (runtime set) | access_token, session_id, CSRF tokens |
| 2 | **Config** | `load.params.varName` | `once` | Base URL, API keys, client IDs |
| 3 | **Test Data** | `load.params.varName` | `iteration` | username, password, email, account_id |

### Detection Priority — 7 Rules (evaluated top to bottom)

```
Rule 0:  JMX CSVDataSet column name  → Tier 3 (EachIteration)
Rule 1:  Script-set variable          → Tier 1 Dynamic
         (bru.setEnvVar, pm.*.set, postman.setEnvironmentVariable,
          bru.setVar, bru.setGlobalVar, vars.put, context.set, etc.)
Rule 2:  Correlation extraction target → Tier 1 Dynamic
Rule 2.5: Private/crypto key name     → Tier 1 Dynamic (NEVER parameterize)
          Pattern: private-key, signing-key, secret-key, rsa-key, pem-key,
                   pkcs, p12-key, client-secret, etc.
Rule 3:  _ prefix variable            → Tier 1 Dynamic (regardless of value)
Rule 4:  Empty / null value           → Tier 1 Dynamic (safety net)
Rule 5a: Real value + credential name → Tier 3 Test Data (iteration)
Rule 5b: Real value + non-credential  → Tier 2 Config (once)
```

**Why Rule 2.5 matters:** PEM private keys in CSV or PRM files crash VuGen's Parameters panel because they contain newlines. They must stay as inline constants, never in parameter files.

**`$` prefix** (Postman built-ins: `$guid`, `$timestamp`) → skipped entirely, not classified.

### Where the Logic Lives

The classification is **duplicated** in two places (by design — each generator is self-contained):
- `src/generators/advancedScriptGenerator.js` → `classifyVariables()`
- `src/generators/webHttpScriptGenerator.js` → `classifyVariables()`

`parameterizationEngine.js` is a **raw value scanner only** — it does NOT do tier classification.

---

## 6. Authentication Handler

### Supported Auth Types

| Auth Type | DevWeb Output | VuGen Output | Status |
|-----------|---------------|--------------|--------|
| OAuth2 Client Credentials | `load.utils.oauth2CC()` | `web_custom_request` token fetch | ✅ |
| OAuth2 Password | `load.utils.oauth2Password()` | `web_custom_request` token fetch | ✅ |
| Bearer (static) | Header in `rts.yml` | `web_add_header()` | ✅ |
| Bearer (dynamic) | `load.global.access_token` correlated | `{access_token}` param | ✅ |
| Basic Auth | `Authorization: Basic <b64>` | `web_set_user()` | ✅ |
| API Key | Header / query param | `web_add_header()` / URL param | ✅ |
| JWT (RS256/HS256) | `jwt-helper.js` + `jsrsasign.js` | `jsrsasign.js` direct call | ✅ |
| AWS Signature v4 | `load.utils.awsSigV4()` | Custom signing block | ✅ |
| Digest | `web_set_user()` with Digest | `web_set_user()` | ✅ |
| NTLM | `load.setUserCredentials()` | `web_set_user()` | ✅ |
| Kerberos | `load.setUserCredentials()` | `web_set_user()` | ✅ |
| DPoP | `dpop-helper.js` integration | N/A | ✅ |
| Cookie Jar | — | VuGen handles automatically | ⚠️ Not generated |

### NTLM/Kerberos Special Rule

`detectNtlmKerberos()` runs **before** `classifyVariables()` so that `username`, `password`, `domain` are added to the variable map early and appear correctly in CSV/PRM parameter files.

Host = hostname only, **no port** (LoadRunner 26.1 requirement for `web_set_user`).

---

## 7. Correlation Engine

The correlation engine has two layers: **pattern-based** (always runs) and **value-based** (Phase 4, runs after pattern-based).

### Layer 1: Pattern-Based Correlation

Detects correlations based on known header names and response patterns.

**Single-HAR Mode** (`singleHarCorrelate`):
- Scans response headers for known dynamic headers (Authorization, Set-Cookie, Location, etc.)
- Scans JSON response bodies for fields with dynamic-looking values
- Scans HTML responses for hidden inputs, CSRF meta tags, ViewState
- Matches values forward into subsequent requests

**Two-HAR Mode** (`twoHarCorrelate`):
- Diffs two HAR recordings to find values that changed between sessions
- Much higher accuracy — eliminates static values automatically
- Handles JSON diff, XML diff, URL path diff, header diff

### Correlation Registration Order (Critical for VuGen)

`web_reg_save_param_*()` functions MUST come **BEFORE** the request that produces the value.  
The generator places them immediately before the matching `web_url()` / `web_custom_request()` call.

### VuGen Correlation Functions — Correct Attributes

| Function | Path Attribute | Key Attributes | Notes |
|----------|---------------|----------------|-------|
| `web_reg_save_param` | — | `LB=`, `RB=`, `Ord=`, `Search=` | Boundary extractor |
| `web_reg_save_param_json` | `QueryString=` | No `Ord=` | JSON path |
| `web_reg_save_param_xpath` | `QueryString=` | `SelectAll=Yes` (no `Ord=`) | XPath |
| `web_reg_save_param_regexp` | `RegExp=` | `Group=`, `Ordinal=`, `Scope=` | NOT `Ord=` |

**Deduplication:** `generateCorrelationRegistrations()` emits only ONE `web_reg_save_param_*` per `varName` even if the same value appears in multiple responses.

### Layer 2: Value-Based Auto-Correlation (Phase 4 — v2.9.2+)

**The problem it solves:** The pattern engine knows that `Authorization: Bearer <token>` needs correlation because it knows the header name. But what about `X-Financial-Id: abc123xyz`? The pattern engine doesn't know this header name. VBAC catches it.

**Algorithm — Request-First Approach:**

```
Pass 1: Scan REQUESTS for candidate values
  ├── Authorization header → strip Bearer/Basic scheme, take token part
  ├── Known token headers (X-CSRF-Token, X-Api-Key, X-Session-Id, ...)
  ├── Other X-* headers → only if isDynamic() passes
  ├── URL query params with known names (access_token, code, state, ...)
  ├── JSON body fields with known names (token, id_token, csrf, ...)
  ├── Form body fields (__RequestVerificationToken, _token, csrf, ...)
  └── URL path segments → UUID or 32+ hex patterns only

Pass 2: For each candidate, scan backward through earlier responses
  ├── Search response body (JSON/HTML/XML)
  ├── Search response headers (excluding Set-Cookie)
  └── Use findValueInResponse() to get extraction config

Pass 3: Filters
  ├── Cookie skip: never correlate values from Cookie: request header
  ├── Frequency cap: value in > 3 distinct requests → static → skip
  ├── Two-HAR filter: value unchanged between sessions → static → skip
  └── Cookie extraction: if findValueInResponse() returns type=cookie → skip
```

**Seven protection layers against false positives:**
1. Known field name whitelists (force-accept without isDynamic check)
2. `isDynamic()` structural gate for unknown X-* headers and JSON fields
3. Cookie: header completely skipped (never a source of candidates)
4. Two-HAR: same value in both sessions = static = skip
5. Frequency cap: > 3 requests using value = static API token = skip
6. URL path: only UUID / 32+ hex patterns accepted
7. Cookie extraction: skipped even if value found via Set-Cookie

**Function signature:**
```javascript
valueBasedCorrelate(entries, existing, entries2)
// entries  = primary HAR entries
// existing = already-found correlations (for deduplication)
// entries2 = second HAR session (optional, for two-HAR mode)
```

### DevWeb Extractor Classes (exact names from DevWebSdk.d.ts)

| Class | Signature | Notes |
|-------|-----------|-------|
| `load.JsonPathExtractor` | `(name, path)` | 2-arg positional |
| `load.BoundaryExtractor` | `(name, lb, rb)` | 3-arg; scope = options form |
| `load.RegexpExtractor` | `(name, pattern)` | 2-arg; occurrence = options form |
| `load.XpathExtractor` | `(name, path)` | **lowercase 'p'** — NOT `XPathExtractor` |
| `load.CookieExtractor` | `(name, { cookieName })` | dedicated API |

---

## 8. JWT Detection & Generation

### Detection — All Libraries Fingerprinted

`customScriptParser.detectJwtUsage(script)` detects JWT signing in:

**JavaScript / Node:**
- `jsrsasign` / `KJUR.jws.JWS.sign`
- `require('jsonwebtoken') + .sign(`
- `require('jose')`
- `crypto.createSign(` + base64url

**Java / Groovy (JMeter JSR223/BeanShell):**
- **nimbus-jose-jwt:** `com.nimbusds.jose`, `JWTClaimsSet.Builder`, `SignedJWT`, `RSASSASigner`, `ECDSASigner`, `MACSigner`
- **Auth0 java-jwt:** `com.auth0.jwt`, `JWT.create()`, `Algorithm.RSA256/HMAC256/ECDSA256`
- **JJWT:** `io.jsonwebtoken`, `Jwts.builder()`, `.signWith()` + `.compact()`
- **BouncyCastle:** `org.bouncycastle`, `PEMParser`, `JcaPEMKeyConverter`
- **JCA manual:** `Signature.getInstance(SHA256withRSA/PS256...)`, `Mac.getInstance(HmacSHA256...)`
- **PEM-in-script + claims:** `-----BEGIN PRIVATE KEY-----` + 3+ of `iss/sub/aud/exp/iat/jti`

**Output variable extraction** scans all setter APIs (`vars.put`, `props.put`, `pm.*.set`, `bru.set*`, etc.).  
If **no** output variable is found → `hasJwt = false` → zero JWT code generated. Headers/correlations/auth still applied.

### Generated Files (copied from project root)

| File | When Copied | Purpose |
|------|-------------|---------|
| `jwt-helper.js` | JWT detected in DevWeb output | Runtime JWT signing helper |
| `jsrsasign.js` | JWT detected in VuGen output | RSA/HMAC signing library |
| `transport.pem` | JWT detected (both) | Certificate for signing |
| `DevWebSdk.d.ts` | Every DevWeb output | TypeScript type definitions |

All files must be in the **project root** — no `src/` fallback. The generator copies from root using `copyFileSync` (intercepted by `memoryFsInterceptor` in web mode).

### HTML Entity Decoding (Critical for JWT)

PEM keys from JMX XML attributes contain `&#10;` or `&#xA;` for newlines.  
`decodeHtmlEntities()` is called in three places:
1. `mandatoryFilesGenerator.js` — DevWeb `collection_data.csv`
2. `webHttpMandatoryFilesGenerator.js` — VuGen `collection_data.dat` + `ParameterFile.prm`
3. `jwt-helper.js` — before crypto operations

Without this, VuGen Parameters panel fails to open and OpenSSL throws "unsupported" decode errors.

---

## 9. Per-Request Transactions

### Naming Convention

```
T{nn}_{RequestName}
```

- Global sequential counter across ALL folders (not per-folder)
- Examples: `T01_GetAccessToken`, `T02_CreateOrder`, `T03_SubmitPayment`
- Numbers in request names (e.g. "01 - Get Token") are stripped from the label part
- VuGen: `lr_start_transaction("T01_Get_Access_Token")` + `lr_end_transaction(...)` wrapping each request

### DevWeb Transaction Declaration (Module-Level)

All transaction declarations are emitted at module scope BEFORE `initialize()`:
```javascript
const T01_GetAccessToken = new load.Transaction("T01_GetAccessToken");
const T02_CreateOrder = new load.Transaction("T02_CreateOrder");
```

Only `.start()` / `.stop()` calls are inside action functions. This prevents repeated construction of Transaction objects on each iteration.

**Implementation:** `buildTransactionMap()` called at start of `generateAction()` → populates `this.requestTxMap`. `generateHeader()` reads `requestTxMap` to emit all declarations.

### VuGen `.usr` File

`[TransactionsOrder]` and `[Transactions]` sections auto-populated from `this.transactionNames[]`.

---

## 10. DevWeb Script Generator

### Output File Set

```
{ScriptName}/
  main.js                  ← main script (initialize, action, finalize)
  parameters.yml           ← all parameters with tier classification
  rts.yml                  ← runtime settings (server, auth, proxy, userArgs)
  scenario.yml             ← workload scenario
  tsconfig.json            ← TypeScript config
  default.cfg              ← LoadRunner Enterprise config
  default.usp              ← user scenario parameters
  DevWebSdk.d.ts           ← SDK type definitions
  collection_data.csv      ← Tier 2/3 parameter values
  jwt-helper.js            ← (if JWT detected)
  jsrsasign.js             ← (if JWT detected)
  transport.pem            ← (if JWT detected)
```

### main.js Structure

```javascript
"use strict";
// Transaction declarations (all at module level)
const T01_... = new load.Transaction("T01_...");

// Initialize
load.initialize(async function() {
  // Auth setup (OAuth2 token fetch, setUserCredentials, etc.)
  // Correlation registrations for init requests
});

// Action
load.action(async function() {
  // Per-request blocks with:
  //   transaction.start()
  //   web_reg_save_param equivalent (extractors defined in request options)
  //   load.WebRequest(...).sendSync()
  //   response.extractors["name"]  → load.global.name
  //   transaction.stop(load.TransactionStatus.Passed)
});

// Finalize
load.finalize(async function() {
  // Cleanup / logout requests
});
```

### No Logging in Generated Scripts (v2.7.0)

All `load.log(...)` calls removed from generated `main.js`. Scripts run silently unless they throw.

---

## 11. VuGen Web HTTP/HTML Generator

### C89 Compliance Rules

VuGen compiles with a C89-compatible compiler. These rules are enforced by the generator:

1. **All variable declarations at the TOP of each function block** — before any executable statements
2. No nested `{ char x[32]; ... }` scopes for declarations — they must go at function top
3. `lr_whoami(int*, char**, int*)` — NOT the non-existent `lr_get_vuser_id()`
4. `lr_output_message()` = always visible; `lr_log_message()` = log file only

### Output File Set

```
{ScriptName}/
  Action.c                 ← main test actions
  vuser_init.c             ← initialization (auth, setUp requests)
  vuser_end.c              ← cleanup (tearDown requests)
  globals.h                ← shared declarations + gen_uuid/gen_csrf/gen_hex64 helpers
  ParameterFile.prm        ← CSVDataSet test-data parameters (EachIteration)
  GlobalVars.prm           ← collection-level config parameters (Once)
  collection_data.dat      ← default values for GlobalVars.prm
  default.cfg              ← LoadRunner runtime config (proxy, SSL, etc.)
  default.usr              ← user scenario parameters
  lrw_custom_body.h        ← large request body helper
  custom_body_variables.txt← body template variables
  jsrsasign.js             ← (if JWT detected)
  transport.pem            ← (if JWT detected)
```

### Request Snapshot Counter

Every `web_url()` / `web_custom_request()` call requires:
```c
"Snapshot=tN.inf",    // N = global sequential counter starting at 1
"Mode=HTML",
```
The counter is `this.snapshotCounter` in the generator constructor, incremented globally across all requests in `Action.c`.

### Body Files

Bodies longer than 500 characters are written to a `BodyFilePath=` file (e.g., `body_T03.dat`). This file supports `{paramName}` substitution at VuGen runtime.

### Dynamic Value Generation in globals.h

Three static C functions are defined in `globals.h`:

| Function | Output Format | Used For |
|----------|---------------|---------|
| `gen_uuid("_param")` | `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx` | interaction-id, jti, request-id |
| `gen_csrf_token("_param")` | 32-char hex (16 bytes) | x-xsrf-token, x-csrf-token |
| `gen_hex64("_param")` | 64-char hex (32 bytes) | OAuth state, nonces, high-entropy values |

### No Logging in Generated Scripts (v2.7.0)

All `lr_output_message(...)` calls removed from `Action.c`, `vuser_init.c`, `vuser_end.c`.

### Script Event Storage (Critical)

Bruno/Postman scripts are stored differently:
```javascript
// ALWAYS use this pattern:
const events = req.tests || req.event || [];
```
- Bruno YAML: `req.tests[]`
- Postman / Bruno JSON export: `req.event[]` or `item.script.req/res`
- Without both checks: script-set vars get misclassified as Tier 2 static params

---

## 12. JMX / JMeter Converter

### XML Structure Parsed

```xml
<JMeterTestPlan>
  <hashTree>
    <TestPlan>
      <!-- User Defined Variables (UDVs) -->
      <Arguments testclass="Arguments" testname="User Defined Variables">
        <collectionProp name="Arguments.arguments">
          <elementProp name="base_url" elementType="Argument">
            <stringProp name="Argument.name">base_url</stringProp>
            <stringProp name="Argument.value">https://api.example.com</stringProp>
          </elementProp>
        </collectionProp>
      </Arguments>
    </TestPlan>
    <hashTree>
      <!-- Thread Groups, Samplers, CSV Data Sets, etc. -->
    </hashTree>
  </hashTree>
</JMeterTestPlan>
```

### UDV Pipeline (User Defined Variables)

```
jmxParser reads <Arguments testclass="Arguments">
  → stored in context.variables = { base_url: "https://...", username: "...", ... }
  → jmxConverter maps to collection.variable[]
  → buildVariableMap() picks them up
```

**Critical fix (v2.9.2):** `buildVariableMap()` only sets from `environmentVars` when no real value already exists:
```javascript
// Never overwrite a real UDV value with the empty placeholder from injectRequestVariables()
if (existing === undefined || existing === null || existing === '') {
  this.variableMap.set(key, value);
}
```
Without this fix, `injectRequestVariables()` scans `{{varName}}` refs and adds them with `''` to `environmentVars`, overwriting real UDV values.

### CSVDataSet → ParameterFile.prm

```xml
<CSVDataSet>
  <stringProp name="filename">users.csv</stringProp>
  <stringProp name="variableNames">username,password,accountId</stringProp>
</CSVDataSet>
```
→ Each column name becomes a parameter entry in `ParameterFile.prm` with `GenerateNewVal="EachIteration"`.

### setUp / tearDown Thread Groups

| JMeter TG Type | DevWeb Target | VuGen Target |
|----------------|---------------|--------------|
| Normal Thread Group | `action()` | `Action.c` |
| setUp Thread Group | `initialize()` | `vuser_init.c` |
| tearDown Thread Group | `finalize()` | `vuser_end.c` |

JSR223/BeanShell samplers (standalone, no HTTP) → single compact TODO comment per sampler.

### Correlation in JMX Scripts

`extractors` in JMeter:
- `JSONPathExtractor` → `web_reg_save_param_json` / `load.JsonPathExtractor`
- `XPathExtractor` / `XPath2Extractor` → `web_reg_save_param_xpath` / `load.XpathExtractor`
- `RegexExtractor` → `web_reg_save_param_regexp` / `load.RegexpExtractor`
- `BoundaryExtractor` → `web_reg_save_param` (boundary) / `load.BoundaryExtractor`

---

## 13. VuGen Script Studio (Browser Tool)

The Studio is a self-contained browser application for analyzing HAR/NetLog recordings and generating load test scripts directly in the browser — no server required for analysis.

### Module Architecture (After Phase 3 Refactor)

| File | Size | Content |
|------|------|---------|
| `VuGen-Script-Studio.html` | ~321 lines | Pure HTML markup skeleton |
| `VuGen-Script-Studio.css` | ~920 lines | All CSS, dark/light theme |
| `VuGen-Script-Studio-constants.js` | ~600 lines | State `S`, all constants, template strings |
| `VuGen-Script-Studio-correlation.js` | ~2120 lines | HAR parser, correlation engines, VBAC |
| `VuGen-Script-Studio-codegen.js` | ~2400 lines | DevWeb + VuGen code generators |
| `VuGen-Script-Studio-app.js` | ~3900 lines | UI, analyze(), ZIP, render |

**Script load order (dependency order — must not change):**
```html
<script src="jszip.min.js"></script>
<script src="VuGen-Script-Studio-constants.js"></script>
<script src="VuGen-Script-Studio-correlation.js"></script>
<script src="VuGen-Script-Studio-codegen.js"></script>
<script src="VuGen-Script-Studio-app.js"></script>
```

### IIS Deployment Rules (never violate)

1. All new files go in `src/web/public/` — same folder as HTML
2. Use bare relative paths — `href="file.css"`, not `./file.css`
3. No `type="module"` on any `<script>` tag — IIS MIME type issues
4. No online URLs — organization has no internet access
5. Load order = constants → correlation → codegen → app

### Phase History

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 0 | Remove Google Fonts (offline-safe system fonts) | ✅ Complete |
| Phase 1 | Remove embedded DevWebSdk.d.ts (was 2,783 lines inline) → fetch() | ✅ Complete |
| Phase 2 | Extract CSS to `VuGen-Script-Studio.css` | ✅ Complete |
| Phase 3a | Extract constants to `VuGen-Script-Studio-constants.js` | ✅ Complete |
| Phase 3b | Extract correlation engine to `VuGen-Script-Studio-correlation.js` | ✅ Complete |
| Phase 3c | Extract codegen to `VuGen-Script-Studio-codegen.js` | ✅ Complete |
| Phase 3d | Extract app/UI to `VuGen-Script-Studio-app.js` (merged with 3c) | ✅ Complete |
| Phase 4 | Value-Based Auto-Correlation (VBAC) request-first engine | ✅ Complete |

### Analyze Pipeline (`analyze()` in app.js)

```
1. Parse uploaded HAR/NetLog file → entries1 (+ entries2 if two-HAR)
2. Apply filters (remove static resources)
3. Detect transaction markers
4. Run correlation:
   a. twoHarCorrelate(entries1, entries2)  OR  singleHarCorrelate(entries1)
   b. valueBasedCorrelate(entries1, existing, entries2)  [Phase 4]
5. Detect parameters (PARAM_KEYS_MAP matching)
6. Detect auth type
7. Detect server host
8. Generate code (DevWeb or VuGen)
9. Render results (correlations, params, tabs)
10. User downloads ZIP via jszip.min.js
```

---

## 14. Parameter Files & Data Strategy

### DevWeb — Single CSV File

```
collection_data.csv
  ← Contains ALL Tier 2 (config) + Tier 3 (test data) values
  ← parameters.yml references it with nextValue: once (Tier 2) or iteration (Tier 3)
```

### VuGen — Two PRM Files (Split Strategy, v2.9.2)

**`GlobalVars.prm`** — Collection-level config and JMX UDVs
```ini
[parameter:base_url]
ParamName=base_url
GenerateNewVal=Once
ValueFile=collection_data.dat
ColumnName=base_url
```
Data source: `collection_data.dat` (key=value pairs, one row).

**`ParameterFile.prm`** — CSVDataSet test data
```ini
[parameter:username]
ParamName=username
GenerateNewVal=EachIteration
ValueFile=users.csv
ColumnName=username
```
Data source: External CSV files (potentially millions of rows).

**`.usr` file references both:**
```ini
ParameterFile=ParameterFile.prm
GlobalParameterFile=GlobalVars.prm
```

**Why split?** Config parameters (base URLs, API keys) never change per iteration — keeping them separate from test data makes the Parameters panel cleaner and avoids confusion about data cycling.

### HTML Entity Decoding

Parameter values from web-exported collections or JMX XML may contain:
- `&amp;` → `&`
- `&quot;` → `"`
- `&#10;` or `&#xA;` → newline (especially in PEM keys)

All parameter file generators call `decodeHtmlEntities()` before writing values.

---

## 15. Proxy Auto-Detection

`detectProxyConfig()` runs on both generators. It scans `this.variableMap` for proxy-related variable names:

**Variable names checked:** `proxy`, `proxyUrl`, `proxy_url`, `http_proxy`, `HTTP_PROXY`, `proxyServer`, `proxyHost` + `proxyPort`

**Formats supported:**
- Full URL: `http://user:pass@proxyhost:8080`
- Bare: `proxyhost:8080`
- Separate host + port variables

**DevWeb output** → injected into `rts.yml` proxy section  
**VuGen output** → injected into `default.cfg` `[WEB]` section as `ProxyHTTPHost`, `ProxyHTTPPort`, `ProxyHTTPUserName`, `ProxyHTTPPassword`

When no proxy is found → proxy section stays disabled (no change from default).

---

## 16. AI Prompt Files

Located in `devweb-prompts/` (15 files). Used with AI assistants for manual script generation guidance.

| File | Protocol | Purpose |
|------|----------|---------|
| `00-README-START-HERE.txt` | Both | Navigation + quick selector |
| `01-MASTER-PROMPT.txt` | DevWeb | Core logic orchestrator |
| `02-MAIN-JS-GENERATOR.txt` | DevWeb | main.js generation rules |
| `03-AUTHENTICATION-HANDLER.txt` | DevWeb | DevWeb auth patterns |
| `04-CORRELATION-EXTRACTOR.txt` | Both | 2-pass correlation algorithm |
| `05-SCENARIO-YML-GENERATOR.txt` | DevWeb | Scenario config |
| `06-MANDATORY-FILES.txt` | Both | All config file templates |
| `07-PARAMETERS-YML-RULES.txt` | Both | 3-tier variable classification |
| `08-COLLECTION-PARSING-RULES.txt` | Both | Multi-format parser rules |
| `09-CUSTOM-SCRIPT-CONVERTER.txt` | DevWeb | Postman script conversion |
| `10-WEB-HTTP-ACTION-GENERATOR.txt` | VuGen | C code rules (Action.c) |
| `11-WEB-HTTP-AUTH-HANDLER.txt` | VuGen | C auth patterns (vuser_init.c) |
| `USAGE-GUIDE.txt` | Both | Combined reference |
| `USAGE-GUIDE-DEVWEB.txt` | DevWeb | Self-contained DevWeb guide |
| `USAGE-GUIDE-WEB-HTTP.txt` | VuGen | Self-contained VuGen guide |

---

## 17. Critical Bug Fixes History

### v2.9.2 (2026-05-01)
- **VBAC redesign** — Replaced response-first Phase 4 engine with request-first engine (7 false-positive protection layers, cookie skip, two-HAR validation, HTML/JSON/XML response support)
- **JMX UDV overwrite bug** — `buildVariableMap()` now supplements `environmentVars` without overwriting real UDV values from JMX `<Arguments>`
- **C89 variable declarations** — `char _ts[32]` moved from nested `{ }` blocks inside `Action()` to the top of the function, before any executable statements
- **Duplicate per-request var code** — removed second call to `generatePerRequestVarCode()` in `generateRequestBlock()`
- **Parameter file split** — `GlobalVars.prm` (config/UDVs) separated from `ParameterFile.prm` (CSVDataSet test data)
- **`web_reg_save_param_xpath`** — uses `QueryString=` not `XPath=`; no `Ord=`; uses `SelectAll=Yes`
- **`XpathExtractor`** — corrected casing (was `XPathExtractor`)

### v2.9.0 (2026-04-xx)
- **Rule 2.5** — Private/crypto key names never parameterized (prevents PEM in CSV breaking VuGen)
- **JWT detection expansion** — Added Java/Groovy library fingerprints (nimbus, Auth0, JJWT, BouncyCastle, JCA manual)
- **HTML entity decoding** — `decodeHtmlEntities()` in three places (CSV, PRM/DAT, jwt-helper.js)
- **getAnalysisReport fix** — DevWeb parameter count used `this.parameters.size` not `paramEngine.getReport()`

### v2.8.x (2026-03-24)
- **Excel repair dialog** — removed `header` from `ws.columns` in `workloadExcelGenerator.js`
- **setUp/tearDown routing** — requests now correctly go to `initialize()`/`finalize()`
- **Wrong collection_data.csv content** — `resolveCsvFilenames()` + `filterJmxCollectionVars()` added

### v2.7.0
- **Zero-disk architecture** — `memoryFsInterceptor.js` + `multer.memoryStorage()` + chunked streaming ZIP
- **No logging in generated scripts** — all `load.log()` and `lr_output_message()` calls removed

### v2.6.0–v2.6.1
- **Per-request transactions** — global sequential naming + `.usr` auto-population
- **DevWeb transaction declarations** — moved to module scope (not inside action function)

### v2.5.x
- **brunoParser syntax error** — line 85 `'vars' {}` → `'vars {'` crash fix
- **Bruno JSON script format** — `item.script.req/res` supported in all three detection points
- **Library name exclusion** — prefix matching for jsrsasign variants
- **Hyphenated variable names** — `sanitizeVarName()` converts `-`, `.` → `_`
- **Bearer token not correlated** — `detectConsumedValues()` uses `findVariablesInString()`
- **Bruno YAML event storage** — `req.tests[]` pattern applied everywhere
- **Generic Rule 4** — empty value = Tier 1 Dynamic (added to both generators)
- **Extractor assignment sanitization** — bracket notation for extractor names with special chars

### v2.4.x
- **URL encoding bug** — `new URL()` replaced with manual `url.split('?')` everywhere
- **Correlation deduplication** — one `web_reg_save_param_*` per varName
- **QueryString path fallback** — `extractPath === '$'` falls back to `$.corrBase`
- **Proxy auto-detection** — `detectProxyConfig()` added to both generators
- **Snapshot counter** — `"Snapshot=tN.inf"` added to every VuGen request
- **Per-request var functions** — `gen_uuid`, `gen_csrf_token`, `gen_hex64` in globals.h

### v2.3.x
- **`lr_whoami` fix** — replaced non-existent `lr_get_vuser_id()`
- **`web_add_header` scope** — documented as single-request-only
- **`BodyFilePath=`** — bodies > 500 chars moved to body files
- **ParameterFile.prm format** — INI format `[parameter:name]` (not XML)
- **`GenerateNewVal`** — "Once" vs "EachIteration" correctly assigned

---

## 18. Known Constraints & Gotchas

### URL Handling
**NEVER** use `new URL()` on URLs that contain `{{variable}}` placeholders — the browser encodes `{` → `%7B`. Always use manual `url.split('?')` splitting.

### Bruno Event Storage
Scripts are in `req.tests[]` for Bruno YAML collections and `req.event[]` for Postman format.  
**Always use:** `const events = req.tests || req.event || [];`

### VuGen C89
- All local variable declarations must be at the TOP of each function, before any executable statement
- No declaring variables inside `if`, `for`, or nested `{ }` blocks

### formdata/multipart
`web_custom_request` does not support multipart `Body=` — the generator emits a `console.warn` comment in the generated script when this is detected.

### LRE 26.1 NTLM/Kerberos
`web_set_user` / `load.setUserCredentials` host parameter = hostname ONLY, no port.

### VuGen Parameters Panel
PEM keys in PRM files crash the Parameters panel. Rule 2.5 prevents this — crypto key names always classified as Tier 1 Dynamic.

### Corporate Proxy / ZIP Size
The server sends ZIP with:
- No `Content-Length` header → chunked transfer (bypasses proxy size limits)
- `Content-Type: application/octet-stream` (not `application/zip` → bypasses zip-specific filters)

---

## 19. Future Enhancement Ideas

These are potential improvements ordered by value/effort:

### High Value

| Enhancement | Why | Effort |
|-------------|-----|--------|
| **Centralize `classifyVariables()`** into `parameterizationEngine.js` | Currently duplicated in both generators — single source of truth | Medium |
| **Cookie jar support** | Currently not generated; NTLM/Kerberos scripts may need explicit cookie handling | Medium |
| **DevWeb JWT param routing** | `extractJwtClaimMap()` doesn't support `vars.get()`/`props.get()` patterns from JMX → JWT params don't route to `rts.yml` userArguments | Medium |
| **OAuth2 Authorization Code flow** | PKCE + redirect-based flows not yet automated | High |
| **GraphQL support** | POST to `/graphql` with JSON body; operation name detection; variable extraction | High |
| **gRPC / protobuf** | Binary payloads not yet supported | Very High |

### Medium Value

| Enhancement | Why | Effort |
|-------------|-----|--------|
| **VBAC — response body HTML extraction** | Currently `findValueInResponse()` handles HTML; VBAC could also explicitly check HTML response bodies for hidden inputs when tracing candidates | Low |
| **VBAC — weighted scoring** | Instead of binary skip/keep, score candidates by confidence level and show score in UI | Medium |
| **Two-HAR diff visualization** | Show which values changed between sessions in a side-by-side diff UI | Medium |
| **Postman environment file ingestion** | Auto-load Postman environment JSON alongside collection to resolve variables | Low |
| **Bruno environment YAML support** | Bruno stores environments in separate `.yml` files | Low |
| **Dynamic path segment extraction** | REST APIs with `/users/{id}/orders/{orderId}` — auto-detect and correlate path IDs | Medium |

### Studio / UI

| Enhancement | Why | Effort |
|-------------|-----|--------|
| **Correlation editor UI** | Allow the user to review, accept/reject individual VBAC candidates before generating script | High |
| **Parameter editor UI** | Inline editable parameter values and tier override | Medium |
| **Script diff view** | Compare generated script between two HAR sessions to show what changed | High |
| **NetLog improvement** | Chrome net-export format loses some request body data; a Chromium extension could capture it more fully | Very High |
| **Export to JMeter** | Generate `.jmx` from HAR (reverse of current JMX importer) | High |

### Infrastructure

| Enhancement | Why | Effort |
|-------------|-----|--------|
| **Automated test suite** | Unit tests for `classifyVariables`, `singleHarCorrelate`, VBAC against known HAR fixtures | High (investment) |
| **Version compatibility matrix** | Track which LRE versions support which features (XpathExtractor casing, etc.) | Low |
| **CI/CD pipeline** | Automated ZIP size regression check, lint, basic smoke test | Medium |

---

## Quick Reference — Common Tasks

### "I need to add a new auth type"
→ Edit `src/generators/authenticationHandler.js`  
→ Add detection in `detectAuthType()`  
→ Add generation in `generateAuthCode()` (DevWeb) and `generateVuGenAuth()` (VuGen)  
→ Update `devweb-prompts/03-AUTHENTICATION-HANDLER.txt`

### "I need to support a new variable setter API"
→ Edit `correlationDetector.js` — `extractSetVariables()`  
→ Edit both generators — `detectScriptSetVariables()`  
→ The variable will automatically be classified as Tier 1 Dynamic (Rule 1)

### "I need to add a new response extraction type"
→ Edit `correlationDetector.js` — `determineExtractorType()`  
→ Edit `advancedScriptGenerator.js` — `generateExtractor()`  
→ Edit `webHttpScriptGenerator.js` — `generateCorrelationRegistration()`  
→ Update `devweb-prompts/04-CORRELATION-EXTRACTOR.txt`

### "JMX file produces wrong output"
→ Start with `jmxParser.js` — check what `context` object is built  
→ Check `jmxConverter.js` — `buildVariableMap()` supplement-only logic  
→ Check `resolveCsvFilenames()` + `filterJmxCollectionVars()` order

### "VBAC is finding false positives"
→ Check the candidate field name — if it shouldn't force-accept, remove from `KNOWN_TOKEN_FIELDS`/`KNOWN_TOKEN_HDRS`  
→ Verify `isDynamic()` thresholds — `MIN_LEN = 8`, patterns in `DYNAMIC_PATTERNS`  
→ Lower `MAX_USAGES = 3` if too many static tokens pass through  
→ Provide a second HAR recording to enable two-HAR mode (strongest filter)

### "Generated PRM file breaks VuGen Parameters panel"
→ Check if a variable contains a PEM key / newlines → Rule 2.5 should catch it  
→ Check if HTML entities (`&#10;`, `&amp;`) are not being decoded → `decodeHtmlEntities()`  
→ Verify INI format: `[parameter:name]` sections with correct attribute names

---

*This document reflects the state of the codebase as of version 2.9.2 (2026-05-01).*  
*For session continuity, the AI memory index is at `C:\Users\karrir\.claude\projects\c--Workspace-bruno-devweb-converter\memory\MEMORY.md`.*
