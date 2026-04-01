# LRE Toolkit — Performance Engineering

A browser-based toolkit that generates production-ready **LoadRunner VuGen scripts** automatically — from Postman/Bruno collections, JMeter scripts, or HAR browser recordings.

Deployed as a Node.js/Express application on IIS. All processing is in-memory; no uploaded files are ever stored on disk.

---

## Tools

### ⚡ Converter
Convert existing API collections or JMeter test scripts into VuGen scripts.

**Supported inputs:**
- Postman v2.1 JSON
- Bruno JSON, YAML (single file or folder), `.bru`
- Apache JMeter `.jmx` (with optional CSV and certificate files)

**Features:** OAuth2, Basic, Bearer, API Key, JWT, AWS Sig v4, NTLM/Kerberos auth · Auto-correlation · 3-tier parameterization · Multi-script mode · Workload model Excel (JMX)

---

### 🎙 Recorder
Convert a browser HAR recording into a VuGen script — no VuGen installation required for recording.

Designed for VCSE machines where VuGen's built-in proxy recording is blocked by policy. Install the bookmarklet, record your journey in Chrome/Firefox, export a HAR from DevTools, upload here.

**Features:** Domain filtering · Transaction boundary marking · Static asset filtering

---

### 🧪 Script Studio
Generate deeply correlated VuGen scripts from 1 or 2 HAR files.

**1 HAR** — pattern-based analysis (fast, good for simple apps).
**2 HARs** — diff-based analysis (recommended — records same journey twice with different data, finds every value that changes between runs).

**Features:** JSON path / XPath / boundary / cookie / header extractors · Auth detection · Parameterization candidates · Diff-based correlation engine

---

## Output Formats

Both formats are supported by all three tools:

| Format | Protocol | Main file | Use when |
|--------|----------|-----------|----------|
| 🟦 **DevWeb** | JavaScript | `main.js` | LRE 2021+, new projects |
| 🟧 **Web HTTP/HTML** | C | `Action.c` | All LRE versions, existing projects |

---

## Quick Start

### Run locally

```bash
npm install
npm start
# → http://localhost:3000/converter
```

### Run on a custom port

```bash
PORT=8080 npm start
```

### Run with Node directly

```bash
node src/web/server.js
```

---

## IIS Deployment

The app is designed for IIS + iisnode. All files are processed in-memory — no temp files accumulate on the server between requests. Concurrent users are safe.

1. Install [iisnode](https://github.com/Azure/iisnode)
2. Point your IIS site to the project root
3. Set the iisnode handler for `server.js` in `web.config`
4. Navigate to `http://<your-site>/converter`

---

## Privacy Model

| Stage | What happens |
|-------|-------------|
| File upload | `multer.memoryStorage()` — files stay in RAM, never touch disk |
| Conversion | `memoryFsInterceptor.js` intercepts all `fs.writeFile` calls → in-memory Map |
| Download | ZIP streamed directly from Map → browser via `archiver.pipe(res)` |
| After download | Token deleted immediately; Map garbage-collected |

Nothing is persisted on the server between requests.

---

## Project Structure

```
src/
├── index.js                          # BrunoDevWebConverter entry point
├── converters/jmxConverter.js        # JMeter conversion orchestrator
├── parsers/
│   ├── brunoParser.js                # Postman / Bruno / YAML / .bru parser
│   └── jmxParser.js                  # JMeter .jmx XML parser
├── generators/
│   ├── advancedScriptGenerator.js    # DevWeb main.js generator
│   ├── webHttpScriptGenerator.js     # VuGen Action.c generator
│   ├── mandatoryFilesGenerator.js    # DevWeb config files
│   └── webHttpMandatoryFilesGenerator.js
├── analyzers/
│   ├── correlationDetector.js        # 2-pass correlation engine
│   ├── parameterizationEngine.js     # Variable value scanner
│   ├── authenticationHandler.js      # Auth detection + code gen
│   └── customScriptParser.js         # Pre/post-request script analysis
├── lib/
│   ├── memoryFsInterceptor.js        # AsyncLocalStorage fs interceptor
│   └── jmxDependencyResolver.js      # CSV dependency checker
└── web/
    ├── server.js                     # Express server
    ├── views/index.ejs               # Portal SPA
    └── public/
        ├── VuGen-Recorder.html       # HAR Script Generator
        ├── VuGen-Script-Studio.html  # Correlation Engine
        └── jszip.min.js              # JSZip v3.10.1 (shared)
```

---

## Configuration — Feature Flags

To temporarily hide a tool tab without deleting any code, edit `PORTAL_CONFIG` in `src/web/views/index.ejs`:

```js
const PORTAL_CONFIG = {
  tabs: {
    home:      { enabled: true  },
    converter: { enabled: true  },
    recorder:  { enabled: true  },  // set false to hide
    studio:    { enabled: true  },  // set false to hide
    help:      { enabled: true  }
  }
};
```

The "Both formats" output option in Recorder and Script Studio is currently hidden (`style="display:none"`). To re-enable, remove that attribute from `#fc-both` (Recorder) and `#fmt-both` (Studio).

---

## Documentation

| File | Audience |
|------|----------|
| [docs/USER-GUIDE.md](docs/USER-GUIDE.md) | End users — step-by-step instructions, FAQ, glossary |
| [docs/TECHNICAL-REFERENCE.md](docs/TECHNICAL-REFERENCE.md) | Developers — architecture, rules, edge cases, memory model |
| [docs/FUNCTIONAL-SPEC.md](docs/FUNCTIONAL-SPEC.md) | Team — what each tool does, detection rules, output spec |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Server | Node.js + Express |
| Template | EJS |
| File upload | multer (memoryStorage) |
| ZIP streaming | archiver |
| Client-side ZIP | JSZip v3.10.1 |
| Deployment | IIS + iisnode |
| XML parsing | fast-xml-parser |
| Excel output | ExcelJS |

---

## CLI Usage

The converter can also be used from the command line (bypasses the web server entirely):

```bash
node src/index.js \
  --input collection.json \
  --output ./output \
  --protocol devweb \
  --mode single
```

The CLI writes output directly to disk. The `memoryFsInterceptor` is not active in CLI mode.
