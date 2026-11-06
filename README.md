# PerfX Studio — Performance Engineering Toolkit

> Turn Postman / Bruno collections, JMeter test plans and browser recordings into ready-to-run LoadRunner scripts (VuGen Web HTTP/HTML in C, or DevWeb in JavaScript), find where every dynamic value of a recording comes from, and turn the raw results of a LoadRunner Enterprise run into clear reports.

**Version:** 2.11.0 | **Internal tool**

PerfX Studio was previously called the "LRE Toolkit" and, before that, the "Bruno DevWeb Converter". The npm package name is still `bruno-devweb-converter`.

## What it does

PerfX Studio removes most of the manual VuGen scripting effort by generating:

- **Correlation** — extracts dynamic values (tokens, session IDs, CSRF tokens) from responses and reuses them.
- **3-tier parameterisation** — classifies every variable as Dynamic, Config or Test Data.
- **Authentication** — OAuth2, JWT signing, DPoP (RFC 9449), PKCE (RFC 7636), NTLM / Kerberos, Basic, Bearer, API Key, AWS Signature v4, mTLS.
- **All mandatory files** — `.usr`, `Action.c`, `vuser_init.c`, `main.js`, `rts.yml`, `scenario.yml`, `parameters.yml`, parameter files and so on.
- **Per-request transactions** — sequential naming (`T01_Login`, `T02_GetAccount`).

## The tools

The portal has a collapsible left sidebar: **Home**, then **Create scripts** (Recorder, HAR Explorer, Script Studio, Postman / Bruno, JMeter), **Analyse** (Results Analyser) and **Learn** (Help & guides).

| Tool | Input | Best for |
|---|---|---|
| **Recorder** | **Start recording** on the page, or a browser HAR (or Chrome NetLog `.json`) | Recording journeys where VuGen proxy recording is blocked |
| **HAR Explorer** | A HAR file | Seeing every request, finding where a dynamic value comes from, and adding it to Script Studio; works where DevTools is switched off |
| **Script Studio** | **Start recording**, or 1 or 2 HAR files | Automatic correlation (pattern mode with 1 HAR, diff mode with 2) |
| **Postman / Bruno** converter | Postman v2.1 or Bruno collection (`.json`, `.yml`, `.yaml`, `.bru`, zipped folder), optional environment file and client certificates | Converting existing API collections |
| **JMeter** converter | JMeter `.jmx`, optional CSV data files and certificates | Migrating JMeter tests; also produces a Workload Model Excel |
| **Results Analyser** | LoadRunner Enterprise raw results folder or ZIP | Transaction summary, steady state, insights; Excel, Word, PDF and HTML reports |
| **CDP Recorder** (Windows download) | Records a browser journey | Records every tab and pop-up to a HAR, with no browser extension and no administrator rights; driven by **Start recording** on the page, or by its own floating toolbar |

The PerfX Chrome / Edge browser extension has been retired and removed from the repository. The CDP Recorder replaces it.

## Output formats

| Format | Language | Entry file | Choose when |
|---|---|---|---|
| **DevWeb** | JavaScript | `main.js` | New projects, LRE 2021 or later |
| **Web HTTP/HTML** | C | `Action.c` | All LRE versions, existing VuGen projects |

## Quick start

Requires Node.js 20 or later (`engines` in `package.json`).

### Run the web portal locally

```bash
npm install
npm run web
# then open http://localhost:3000/converter
```

Other ways to start the same server:

```bash
node src/web/server.js          # same as npm run web
node app.js                     # the IIS / iisnode entry point
node src/cli.js web --port 8080 # through the CLI
```

`PORT=8080 npm run web` changes the port. Note: `npm start` runs `src/index.js`, which is only the programmatic module entry point — it does not start the server.

### One address for the whole app

The browser address always stays at `…/converter/`. Every tool opens inside the portal; the address bar does not change when you switch tools. The routes `/recorder`, `/har-explorer`, `/studio` and `/results-analyser` exist only to load the tool pages inside the portal: opened on their own in a browser tab, they send the user back to `…/converter/` with that tool open (`src/web/public/portal/frame-guard.js`). The server also blocks direct `.html` URLs on purpose.

### Command line (no web server)

```bash
# Postman / Bruno collection
node src/cli.js convert -i collection.json -o ./output --protocol devweb --mode single

# JMeter test plan
node src/cli.js convert-jmx -i plan.jmx -o ./jmx-converted --protocol web-http

# Analyse a collection without generating a script
node src/cli.js analyze -i collection.json
```

`--protocol` is `devweb` or `web-http`; `--mode` is `single` or `multi` (one script per top-level folder or thread group). Run `node src/cli.js <command> --help` for every option.

## Server routes

Every route answers both at the site root and under `/converter` (so it works whether IIS mounts the app at the root or as the `/converter` sub-application).

| Route | Purpose |
|---|---|
| `GET /converter` | The portal (sidebar, Home and every tool) |
| `GET /recorder`, `/har-explorer`, `/studio`, `/results-analyser` | Tool pages, loaded inside the portal |
| `POST /convert`, `POST /convert-jmx` | Collection and JMeter conversions (rate-limited: 60 per 5 minutes per address) |
| `GET /converter/download/:token` | Single-use ZIP download, valid for 5 minutes |
| `GET /downloads/cdp-recorder` | Pre-built CDP Recorder (`cdp-recorder/recorder/dist/cdp-recorder.zip`, falling back to `.exe`) |
| `/ra`, `/ra/engine`, `/ra/report` | Static files of the Results Analyser |
| `GET /health`, `GET /status` | Health and status checks |
| `POST /analytics/track` | Usage ping of the browser tools |
| `/admin` | Usage-statistics dashboard (only when `ADMIN_TOKEN` is set) |
| `/tools/recorder`, `/tools/studio` | Old links; redirect to `/converter/` |

## IIS deployment (production)

The application runs on IIS + iisnode (standard Windows Server stack). PM2 (`pm2.config.js`) is also available.

### Prerequisites

- Windows Server 2019 / 2022 with IIS 10
- Node.js 20 LTS or later, the same major version as the machine that builds `node_modules`
- iisnode 0.2.26
- IIS URL Rewrite Module 2.1

### Quick deploy steps

```powershell
# 1. On a machine with internet access and the server's Node.js major version:
npm install --omit=dev

# 2. Copy the application files and node_modules to the server, for example D:\WebApps\converter\

# 3. Set permissions: read on the application, write on logs (iisnode) and data (usage statistics)
icacls "D:\WebApps\converter" /grant "NetworkService:(OI)(CI)R"
mkdir D:\WebApps\converter\logs
mkdir D:\WebApps\converter\data
icacls "D:\WebApps\converter\logs" /grant "NetworkService:(OI)(CI)M"
icacls "D:\WebApps\converter\data" /grant "NetworkService:(OI)(CI)M"

# 4. In IIS Manager:
#    - Create Application Pool "perfx-studio-pool" (No Managed Code)
#    - Add Application "converter" under the site, pointing to D:\WebApps\converter
#    - Application Pool: perfx-studio-pool

# 5. CDP Recorder download (optional): build it once (see cdp-recorder/README.md)
#    and copy cdp-recorder.zip to D:\WebApps\converter\cdp-recorder\recorder\dist\
```

**After changing the Node.js major version:** `better-sqlite3`, which stores the usage statistics, is compiled for one version. The portal keeps working, but the admin pages answer `{"error":"analytics_unavailable"}`. Run `npm rebuild better-sqlite3` on a machine with the same version, copy `node_modules\better-sqlite3\` to the server and recycle the application pool. The reason is logged as `[analytics] Module load failed` in the iisnode `logs` folder.

The `web.config` in the repository is already configured for iisnode. The complete step-by-step guide is `Docs/deployment/DEPLOYMENT-IIS.md`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MAX_CONCURRENT_CONVERSIONS` | `8` | Conversions running at once; more return HTTP 503 `server_busy` |
| `ADMIN_TOKEN` | not set | Enables the `/admin` usage dashboard |
| `ANALYTICS_DB_PATH` | `data\analytics.db` in the working folder | Location of the usage-statistics database; the folder must be writable |
| `PERFX_LOG_DIR` | `logs` in the application folder | Folder for the daily application log, `perfx-YYYY-MM-DD.log` (IIS start through `app.js`); the folder must be writable |
| `ANALYTICS_RETENTION_DAYS` | `0` (keep forever) | Older usage statistics are deleted at start-up |

## Privacy model

Converter files are held **in memory**. Collection, environment, JMX, CSV and certificate files are written to the server's temporary folder only while the conversion runs, because the parsers read files by path, and are then deleted, even on failure. Generated scripts are never written to disk.

| Stage | What happens |
|---|---|
| Upload | `multer.memoryStorage()` — files stay in RAM (2 GB limit per file) |
| Temporary files | Input files are written to `os.tmpdir()` for the length of the conversion and removed in a `finally` block |
| Conversion | `AsyncLocalStorage` fs interceptor (`src/lib/memoryFsInterceptor.js`) redirects all `fs.writeFile` calls to an in-memory Map; 2-minute timeout |
| Download | ZIP streamed from the Map to the browser via `archiver.pipe(res)` — no ZIP file on disk |
| After download | Token deleted (single use, 5-minute lifetime); Map garbage-collected |

Each request has its own isolated `AsyncLocalStorage` context — no cross-request contamination.

The Recorder, the HAR Explorer, Script Studio and the Results Analyser run entirely in the user's browser: recordings and test results never reach the server. **Start recording** talks only to the CDP Recorder on the user's own PC (`127.0.0.1:8787`), never through the server. Only usage statistics (tool, file name, counts, machine name or IP address, browser details — no file contents) are recorded, in the analytics database.

## Project structure

```
<repository root>/
│
├── app.js                    ← IIS entry point (starts src/web/server.js)
├── package.json
├── web.config                ← IIS + iisnode configuration
├── pm2.config.js             ← alternative deployment
│
├── DevWebSdk.d.ts            ← TypeScript definitions (included in DevWeb output)
├── jwt-helper.js             ← DevWeb JWT signing helper (included in output)
├── dpop-helper.js            ← DevWeb DPoP helper
├── lre-utils.js              ← VuGen crypto runtime: DPoP, PKCE, JWT (keep identical to lre-utils.dat)
├── lre-utils.dat             ← copy shipped in VuGen ZIPs (must stay ES3 — see CLAUDE.md)
├── transport.pem             ← placeholder PEM key (included in JWT output)
│
├── src/
│   ├── cli.js                ← command line (convert, convert-jmx, analyze, web)
│   ├── index.js              ← programmatic entry point (module shim)
│   ├── tools/                ← collection-converter, jmx-converter
│   ├── parsers/              ← brunoParser, postmanParser, jmxParser, harParser
│   ├── analyzers/            ← correlationDetector, parameterizationEngine,
│   │                           authenticationHandler, customScriptParser (JWT/DPoP fingerprinting)
│   ├── generators/           ← devweb/ and vugen/ script + files generators, workloadExcelGenerator
│   ├── core/                 ← shared utilities, variable classifier, VuGen codegen
│   ├── lib/                  ← memoryFsInterceptor, jmxDependencyResolver, appLog (application log)
│   ├── analytics/            ← usage statistics (SQLite) and admin exports
│   └── web/
│       ├── server.js         ← Express app (routes listed above)
│       ├── views/            ← index.ejs (portal), partials/{shell,home,converter,help}.ejs, admin.ejs
│       └── public/
│           ├── portal/       ← sidebar shell, Home, converter, Help, Recorder, HAR Explorer, Studio page scripts and styles;
│           │                   record-live.js (Start recording), ds.css (design system)
│           ├── Recorder.html ← Recorder page (loads the VuGen-Recorder-*.js engine files)
│           ├── HarExplorer.html ← HAR Explorer page (reuses the Recorder and Studio engines)
│           ├── Studio.html   ← Script Studio page (loads the studio-*.js files)
│           ├── shared/       ← vugen-codegen.js, page-resources.js, host-params.js (shared by the tools)
│           └── VuGen-Recorder.html, VuGen-Script-Studio.html
│                             ← classic pages, kept only as the reference for parity tests (no route)
│
├── cdp-recorder/             ← CDP Recorder (Windows HAR recorder, replaces the extension)
├── lre-results-analyser/     ← Results Analyser (browser engine, reports, CLI)
├── tests/unit/               ← Jest unit tests
├── regression-tests/         ← old-against-new comparison tools (tools/); pipeline test skeleton
└── Docs/                     ← local-only documentation (not in the repository)
```

`CLAUDE.md` has the detailed file map, including load order and the architecture rules.

## Feature overview

### Authentication — detected and generated automatically

| Method | Detection |
|---|---|
| OAuth2 (Client Credentials, Password, Authorization Code) | `auth.type`, token endpoint, `grant_type` |
| JWT signing | jsrsasign, jsonwebtoken, jose, JJWT, nimbus-jose-jwt, BouncyCastle, JCA, Auth0 java-jwt |
| **DPoP (RFC 9449)** | `dpop` / `dpop-pf` headers |
| **PKCE (RFC 7636)** | `code_challenge=` in URL, `code_verifier=` in body |
| NTLM / Kerberos | `auth.type=ntlm`, Negotiate / NTLM challenges, variable name patterns |
| Basic | `auth.type=basic` |
| Bearer token | `Authorization: Bearer` header |
| API Key | `X-API-Key`, `api_key` query parameter |
| AWS Signature v4 | `AWS4-HMAC-SHA256` authorization |
| mTLS | Client certificate upload (`.pem`, `.p12`, `.pfx`, `.crt`, `.cer`) |

### Correlation — extractor types

JSONPath, XPath, regular expression, boundary (left / right), header, cookie. Script Studio adds SelectAll arrays, random selection and array reconstruction.

### Script Studio correlation strategies

- **Two-HAR diff (VBAC)** — compare two recordings; any value that differs is dynamic.
- **Single-HAR pattern** — UUID, JWT and entropy scoring, values traced back to an earlier response, and CSRF tokens detected by field name.
- **Correlation Advisor** — review, accept or skip each candidate; add your own with **+ Add Manual** or **Paste & Detect**.
- **Unresolved candidates** — TODO comments for tokens whose source was not in the HAR.
- **HAR Explorer** — look up any value by hand; **Correlate this** adds it to Script Studio, marked "From HAR Explorer".

### Static resources

The Recorder and Script Studio attach images, stylesheets and scripts to the page step that loaded them (VuGen `EXTRARES`, DevWeb `resources: [...]`), never as separate requests (`src/web/public/shared/page-resources.js`).

## Configuration

### Portal section visibility

Edit `PORTAL_CONFIG` in `src/web/views/index.ejs`. A section set to `false` is hidden from the sidebar:

```javascript
const PORTAL_CONFIG = {
  tabs: {
    home:      { enabled: true  },
    converter: { enabled: true  },  // Postman / Bruno and JMeter
    recorder:  { enabled: true  },
    explorer:  { enabled: true  },
    studio:    { enabled: true  },
    analyser:  { enabled: true  },  // Results Analyser
    help:      { enabled: true  }
  },
  iframes: { recorder: BASE_PATH + '/recorder', explorer: BASE_PATH + '/har-explorer', studio: BASE_PATH + '/studio', analyser: BASE_PATH + '/results-analyser' }
};
```

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 or later (`better-sqlite3` is compiled per major version) |
| Web framework | Express 4 (helmet, express-rate-limit) |
| Template | EJS |
| File upload | multer (memoryStorage) |
| ZIP streaming | archiver 6 (chunked, no Content-Length) |
| XML parsing | fast-xml-parser 4 |
| Excel output | ExcelJS 4 |
| Usage statistics | better-sqlite3 (SQLite), ua-parser-js; exports with ExcelJS and docx |
| Client ZIP | JSZip 3.10.1 |
| Results Analyser (browser) | ECharts, ExcelJS, docx, sql.js (bundled in `lre-results-analyser/web/vendor/`) |
| CDP Recorder | TypeScript, chrome-remote-interface, Node Single Executable Application; local API on `127.0.0.1:8787` |
| Deployment | IIS 10 + iisnode 0.2.26 (PM2 as the alternative) |

The portal uses system fonts only and makes no CDN or web-font requests, so it works on locked-down networks.

## Documentation

The `Docs/` folder is kept locally and is not part of the repository; the links below work only in a working copy that has it. **Read it as a site: open `Docs/PerfX-Studio-Docs.html`** (menu, search, screenshots, light and dark, works offline). The site is built from these sources: run `node build.js` in `Docs/site-src/`.

| Document | Audience | Link |
|---|---|---|
| **Documentation index** | All | [Docs/INDEX.md](Docs/INDEX.md) |
| Getting started | All users | [Docs/user/GETTING-STARTED.md](Docs/user/GETTING-STARTED.md) |
| Portal guide | All users | [Docs/user/PORTAL-GUIDE.md](Docs/user/PORTAL-GUIDE.md) |
| HAR Explorer guide | All users | [Docs/user/HAR-EXPLORER-GUIDE.html](Docs/user/HAR-EXPLORER-GUIDE.html) |
| Command line | All users | [Docs/user/COMMAND-LINE.md](Docs/user/COMMAND-LINE.md) |
| Admin reports | Admins | [Docs/deployment/ADMIN-REPORTS.md](Docs/deployment/ADMIN-REPORTS.md) |
| Troubleshooting | All users | [Docs/user/TROUBLESHOOTING.md](Docs/user/TROUBLESHOOTING.md) |
| Executive summary | Business stakeholders | [Docs/business/EXECUTIVE-SUMMARY.md](Docs/business/EXECUTIVE-SUMMARY.md) |
| Business case | IT management | [Docs/business/BUSINESS-CASE.md](Docs/business/BUSINESS-CASE.md) |
| Architecture | Architects | [Docs/technical/ARCHITECTURE.md](Docs/technical/ARCHITECTURE.md) |
| HLSD | Architecture board | [Docs/technical/HLSD.md](Docs/technical/HLSD.md) |
| DPoP guide | Security team | [Docs/technical/DPOP-GUIDE.md](Docs/technical/DPOP-GUIDE.md) |
| PKCE guide | Security team | [Docs/technical/PKCE-GUIDE.md](Docs/technical/PKCE-GUIDE.md) |
| Developer guide | Developers | [Docs/technical/DEVELOPER-GUIDE.md](Docs/technical/DEVELOPER-GUIDE.md) |
| IIS deployment | Admins | [Docs/deployment/DEPLOYMENT-IIS.md](Docs/deployment/DEPLOYMENT-IIS.md) |

Documentation inside the repository:

| Document | Link |
|---|---|
| Project map and architecture rules | [CLAUDE.md](CLAUDE.md) |
| How changes are made | [DEVELOPMENT-RULES.md](DEVELOPMENT-RULES.md) |
| Change history | [CHANGELOG.md](CHANGELOG.md) |
| Bug tracker | [BUGS.md](BUGS.md), older versions in [BUGS-ARCHIVE.md](BUGS-ARCHIVE.md) |
| CDP Recorder | [cdp-recorder/README.md](cdp-recorder/README.md) |
| Results Analyser | [lre-results-analyser/README.md](lre-results-analyser/README.md), [user guide](lre-results-analyser/docs/USER-GUIDE.md) |
| Regression tests | [regression-tests/README.md](regression-tests/README.md) |

The Help & guides section inside the portal is the authoritative user-facing help.

## Tests

```bash
npm test                                    # all Jest tests
npm test -- --testPathPattern=correlation   # one suite
npm test -- --coverage                      # with coverage
npx jest lre-results-analyser               # Results Analyser tests only
```

Notable suites in `tests/unit/`:

- `lreUtilsEs3Compat.test.js` — `lre-utils.js` / `lre-utils.dat` must parse as ES3 (run after every edit; `node --check` is not enough).
- `recorderCoreParity.test.js`, `studioPageParity.test.js`, `converterPageParity.test.js`, `helpPageParity.test.js` — keep the redesigned portal pages in step with the classic engine, ids, handlers and Help text.
- `harExplorerModel.test.js`, `harExplorerFind.test.js` — the HAR Explorer agrees with the Recorder and Script Studio, including a round trip through Studio.

## Version history

| Version | Key changes |
|---|---|
| **v2.11.0** | Portal redesign (left sidebar, new Home, Recorder, Script Studio, converter and Help pages; one address for the whole app); HAR Explorer; Results Analyser; CDP Recorder replaces the retired browser extension, with Start recording from the portal; JWT / DPoP / VuGen runtime fixes; application log file. See `CHANGELOG.md`. |
| **v2.10.14** | Script Studio usage tracking; admin dashboard redesign and exports |
| **v2.10.13** | Dead file cleanup; DPoP copy bug fix; Node 20 docs alignment; devErrors disabled |
| **v2.9.2** | PKCE (RFC 7636) support — Converter + Script Studio |
| **v2.9.0** | DPoP (RFC 9449) full support; HTML entity decoding for PEM keys |
| **v2.8.0** | Value-Based Auto-Correlation (VBAC) engine in Script Studio |
| **v2.7.0** | Memory-only processing; all log statements removed from generated scripts |
| **v2.6.0** | Per-request transaction naming with global sequential counter |
| **v2.5.0** | Multi-certificate upload; Bruno YAML folder collection support |
| **v2.4.0** | Proxy auto-detection; URL encoding fix for `{{variable}}` URLs |
| **v2.3.0** | JMeter converter; Workload Model Excel generation |
