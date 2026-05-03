# LRE Toolkit — System Architecture

**Version:** 2.9.2 | **Date:** May 2026

---

## 1. Overview

The LRE Toolkit is a Node.js/Express web application hosted on IIS via iisnode. It has three logical layers:

- **Presentation layer** — single-page portal (EJS template + vanilla JS)
- **API layer** — Express routes that orchestrate conversion
- **Processing layer** — parsers, analyzers, and generators

Two of the three tools (Recorder, Script Studio) are entirely **client-side**: all processing happens in the browser using JavaScript. Only the Converter tool sends data to the server.

---

## 2. System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         BANK INTERNAL NETWORK                               │
│                                                                             │
│  ┌─────────────┐    HTTPS     ┌──────────────────────────────────────────┐ │
│  │  Engineer's │─────────────▶│           IIS + iisnode                  │ │
│  │  Browser    │◀─────────────│           Windows Server 2019+            │ │
│  └─────────────┘    ZIP/HTML  │                                          │ │
│                               │  ┌────────────────────────────────────┐  │ │
│                               │  │        Node.js Process              │  │ │
│                               │  │                                    │  │ │
│                               │  │  Express App (src/web/server.js)   │  │ │
│                               │  │  ┌──────────┬──────────┬────────┐  │  │ │
│                               │  │  │ /convert │ /convert │ /jmx   │  │  │ │
│                               │  │  │ -devweb  │ -vugen   │convert │  │  │ │
│                               │  │  └────┬─────┴────┬─────┴───┬────┘  │  │ │
│                               │  │       │          │         │       │  │ │
│                               │  │  ┌────▼──────────▼─────────▼────┐  │  │ │
│                               │  │  │     memoryFsInterceptor       │  │  │ │
│                               │  │  │  (AsyncLocalStorage — ALL     │  │  │ │
│                               │  │  │   fs writes → in-memory Map)  │  │  │ │
│                               │  │  └──────────────┬───────────────┘  │  │ │
│                               │  │                 │                  │  │ │
│                               │  │  ┌──────────────▼───────────────┐  │  │ │
│                               │  │  │     Conversion Pipeline       │  │  │ │
│                               │  │  │                               │  │  │ │
│                               │  │  │  [Parser] → [Analyzers] →    │  │  │ │
│                               │  │  │  [Generators] → [ZIP]        │  │  │ │
│                               │  │  └──────────────────────────────┘  │  │ │
│                               │  └────────────────────────────────────┘  │ │
│                               └──────────────────────────────────────────┘ │
│                                                                             │
│  NO EXTERNAL CALLS · NO DISK WRITES · NO DATABASE · NO SHARED STATE        │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Conversion Pipeline (Server-Side)

```
Upload (multer.memoryStorage)
         │
         ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                         PARSER                                  │
    │                                                                 │
    │  brunoParser.js         ──▶  Postman v2.1 JSON                  │
    │  brunoParser.js         ──▶  Bruno JSON / YAML / .bru           │
    │  jmxParser.js           ──▶  JMeter .jmx XML                   │
    │                                                                 │
    │  Output: normalized request array                               │
    │  [ { url, method, headers, body, auth, tests, ... } ]          │
    └──────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                        ANALYZERS                                │
    │                                                                 │
    │  authenticationHandler.js  ── detects auth type, credentials   │
    │  correlationDetector.js    ── 2-pass: find + validate correls   │
    │  parameterizationEngine.js ── raw value scan across all vars   │
    │  customScriptParser.js     ── JWT/DPoP detection in scripts    │
    │                                                                 │
    │  Output: enriched request array + metadata object              │
    └──────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                       GENERATORS                                │
    │                                                                 │
    │  advancedScriptGenerator.js     ── DevWeb main.js               │
    │  mandatoryFilesGenerator.js     ── DevWeb config files          │
    │  webHttpScriptGenerator.js      ── VuGen Action.c               │
    │  webHttpMandatoryFilesGenerator ── VuGen config files           │
    │  jmxConverter.js                ── JMX orchestrator             │
    │                                                                 │
    │  Output: Map<filename, content> (all in-memory)                │
    └──────────────────────────┬──────────────────────────────────────┘
                               │
                               ▼
    ┌─────────────────────────────────────────────────────────────────┐
    │                    ZIP STREAMING                                │
    │                                                                 │
    │  archiver.pipe(res)  ──▶  browser download                     │
    │  No ZIP file on disk · chunked transfer encoding               │
    └─────────────────────────────────────────────────────────────────┘
```

---

## 4. Client-Side Tools Architecture

The Recorder and Script Studio run entirely in the browser. No server calls for the core processing.

```
Browser
┌─────────────────────────────────────────────────────────────────────────┐
│  VuGen-Recorder.html                                                    │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  HAR upload → parse → filter → transaction grouping             │   │
│  │  → generate DevWeb/VuGen script → JSZip → browser download      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  VuGen-Script-Studio.html + .js + -correlation.js                      │
│  ┌─────────────────────────────────────────────────────────────────┐   │
│  │  2 × HAR upload → parse → diff (two-HAR) or pattern scan (1-HAR)│   │
│  │  → VBAC engine → auth detection → 3-tier params                 │   │
│  │  → generate DevWeb/VuGen script → JSZip → browser download      │   │
│  └─────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  Shared: jszip.min.js (3.10.1)                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Memory Safety Architecture (Server-Side)

The server-side converter never writes files to disk, even though it uses the Node.js `fs` module internally (via generator code). This is achieved with `AsyncLocalStorage`:

```
Request arrives
      │
      ▼
runWithMemoryFs(async () => {          ← sets up AsyncLocalStorage context
      │
      ├── fs.writeFile(path, data)     ← intercepted → in-memory Map[path] = data
      ├── fs.writeFileSync(...)        ← intercepted
      ├── fs.mkdir(...)                ← intercepted (no-op)
      ├── fs.copyFileSync(...)         ← intercepted → copies between map entries
      │
      └── archiver reads from Map ──▶ ZIP bytes ──▶ browser
})

After response: Map is garbage-collected
```

The interceptor is in [src/lib/memoryFsInterceptor.js](../../src/lib/memoryFsInterceptor.js). It uses Node.js `AsyncLocalStorage` so each concurrent request has its own isolated Map — there is no cross-request state contamination.

---

## 6. Authentication Detection Flow

```
Collection loaded
      │
      ▼
authenticationHandler.js
      │
      ├── detectNtlmKerberos()      ← runs FIRST (before variable classify)
      │       checks: auth.type, variable names, header patterns
      │
      ├── detectOAuth2()            ← checks: token endpoints, grant_type
      │
      ├── detectJwt()               ← runs customScriptParser.detectJwtUsage()
      │       fingerprints: 8 JS libraries + 6 Java/Groovy patterns
      │
      ├── detectDPoP()              ← checks: dpop/dpop-pf headers
      │
      ├── detectBasicAuth()
      ├── detectBearerToken()       ← dynamic-aware: checks if Bearer value is correlated
      ├── detectApiKey()
      ├── detectAwsSigV4()
      │
      └── classifyVariables()       ← 3-tier classification of ALL variables
              7 rules, in order:
              0. JMX CSVDataSet columns → Tier 3
              1. Script-set vars → Tier 1 Dynamic
              2. Correlation targets → Tier 1 Dynamic
              2.5. Private/crypto key names → Tier 1 Dynamic
              3. _ prefix → Tier 1 Dynamic
              4. Empty/null → Tier 1 Dynamic (safety net)
              5. Real value + credential → Tier 3 TestData
                 Real value + not credential → Tier 2 Config
```

---

## 7. Correlation Engine Flow

### Two-HAR Mode (recommended)

```
HAR 1 (run 1)  ──▶ parse ──▶ entries1[]
HAR 2 (run 2)  ──▶ parse ──▶ entries2[]
                                │
                                ▼
                    valueBasedCorrelate()
                    ┌─────────────────────────────────────┐
                    │  For each request in entries1:       │
                    │  1. Scan headers + body for values   │
                    │  2. Check: does same request in HAR2 │
                    │     have a DIFFERENT value?          │
                    │  3. If different → it's dynamic      │
                    │  4. Scan ALL prior responses in HAR1 │
                    │     to find where it came from       │
                    │  5. Build extractor for source       │
                    └─────────────────────────────────────┘
                                │
                                ▼
                    correlations[] → generators
```

### Single-HAR Mode

```
HAR 1 only  ──▶ parse ──▶ entries1[]
                                │
                                ▼
                    singleHarCorrelate()
                    ┌─────────────────────────────────────┐
                    │  Pattern-based: UUID, JWT, 20+char  │
                    │  alphanumeric, timestamp strings     │
                    │  isDynamic() function — entropy      │
                    │  scoring + pattern recognition       │
                    │                                     │
                    │  Unresolved Bearer tokens →         │
                    │  S.candidates → TODO placeholders   │
                    └─────────────────────────────────────┘
```

---

## 8. Generated File Structure

### DevWeb Output
```
ScriptName/
├── main.js               ← generated JavaScript script
├── ScriptName.usr        ← VuGen project descriptor
├── rts.yml               ← runtime settings (think time, proxy, SSL)
├── scenario.yml          ← scenario config (pacing, VU count)
├── parameters.yml        ← parameter file declarations
├── collection_data.csv   ← Tier 2+3 variables with values
├── DevWebSdk.d.ts        ← TypeScript definitions (IntelliSense)
├── jwt-helper.js         ← (if JWT detected) signing helper
├── jsrsasign.js          ← (if JWT detected) crypto library
├── transport.pem         ← (if JWT detected) key placeholder
├── lre-utils.dat         ← (if DPoP/PKCE detected) crypto utilities
└── ScriptUploadMetadata.xml
```

### VuGen Web HTTP/HTML Output
```
ScriptName/
├── Action.c              ← generated C script
├── vuser_init.c          ← initialization (auth setup, lib loading)
├── vuser_end.c           ← cleanup
├── globals.h             ← parameter declarations
├── ScriptName.usr        ← VuGen project descriptor
├── default.cfg           ← runtime settings
├── ParameterFile.prm     ← parameter file (INI format)
├── collection_data.dat   ← Tier 2+3 variables
├── lre-utils.dat         ← (if DPoP/PKCE detected)
└── ScriptUploadMetadata.xml
```

---

## 9. Technology Stack

| Layer | Technology | Version |
|---|---|---|
| Runtime | Node.js | 18 LTS |
| Web framework | Express | 4.18+ |
| Template engine | EJS | 3.1 |
| File upload | multer | 1.4 LTS |
| ZIP streaming | archiver | 6.0 |
| XML parsing | fast-xml-parser | 4.5 |
| Excel output | ExcelJS | 4.4 |
| YAML parsing | js-yaml | 4.1 |
| Client ZIP | JSZip | 3.10.1 |
| Deployment | IIS + iisnode | Windows Server 2019+ |
| Node manager | iisnode | 0.2.26 |

---

## 10. Scalability and Concurrency

The application is stateless per-request. Each conversion request:
- Receives its own `multer.memoryStorage()` file buffer
- Runs inside its own `AsyncLocalStorage` context
- Writes to its own in-memory Map
- Has its ZIP streamed and the Map released

Concurrent requests run independently. Node.js's single-threaded event loop handles I/O concurrency. CPU-bound conversion work (large JMX files, complex correlations) runs synchronously but completes in milliseconds for typical inputs.

For high-load deployments, `iisnode` can be configured to spin up multiple Node.js processes (one per CPU core) with IIS acting as a load balancer across them.

---

*See also: [HLSD](HLSD.md) | [Code Structure](CODE-STRUCTURE.md) | [Developer Guide](DEVELOPER-GUIDE.md)*
