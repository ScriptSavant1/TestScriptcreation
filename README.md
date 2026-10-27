# PerfX Studio — Performance Engineering Toolkit

> Turn Postman / Bruno collections, JMeter test plans and browser recordings into ready-to-run LoadRunner scripts (VuGen Web HTTP/HTML in C, or DevWeb in JavaScript), and turn the raw results of a LoadRunner Enterprise run into clear reports.

**Version:** 2.10.13 (plus the changes listed under "Not released yet" in `CHANGELOG.md`) | **Internal tool**

PerfX Studio was previously called the "LRE Toolkit" and, before that, the "Bruno DevWeb Converter". The npm package name is still `bruno-devweb-converter`.

## What it does

PerfX Studio removes most of the manual VuGen scripting effort by generating:

- **Correlation** — extracts dynamic values (tokens, session IDs, CSRF tokens) from responses and reuses them.
- **3-tier parameterisation** — classifies every variable as Dynamic, Config or Test Data.
- **Authentication** — OAuth2, JWT signing, DPoP (RFC 9449), PKCE (RFC 7636), NTLM / Kerberos, Basic, Bearer, API Key, AWS Signature v4, mTLS.
- **All mandatory files** — `.usr`, `Action.c`, `vuser_init.c`, `main.js`, `rts.yml`, `scenario.yml`, `parameters.yml`, parameter files and so on.
- **Per-request transactions** — sequential naming (`T01_Login`, `T02_GetAccount`).

## The tools

The portal has a collapsible left sidebar: **Home**, then **Create scripts** (Postman / Bruno, JMeter, Recorder, Script Studio), **Analyse** (Results Analyser) and **Learn** (Help & guides).

| Tool | Input | Best for |
|---|---|---|
| **Postman / Bruno** converter | Postman v2.1 or Bruno collection (`.json`, `.yml`, `.yaml`, `.bru`, zipped folder), optional environment file and client certificates | Converting existing API collections |
| **JMeter** converter | JMeter `.jmx`, optional CSV data files and certificates | Migrating JMeter tests; also produces a Workload Model Excel |
| **Recorder** | Browser HAR (or Chrome NetLog `.json`) | Recording journeys where VuGen proxy recording is blocked |
| **Script Studio** | 1 or 2 HAR files | Automatic correlation (pattern mode with 1 HAR, diff mode with 2) |
| **Results Analyser** | LoadRunner Enterprise raw results folder or ZIP | Transaction summary, steady state, insights; Excel, Word, PDF and HTML reports |
| **CDP Recorder** (Windows download) | Records a browser journey | A floating toolbar that records every tab and pop-up to a HAR, with no browser extension |

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

The browser address always stays at `…/converter/`. Every tool opens inside the portal; the address bar does not change when you switch tools. The routes `/recorder`, `/studio` and `/results-analyser` exist only to load the tool pages inside the portal: opened on their own in a browser tab, they send the user back to `…/converter/` with that tool open (`src/web/public/portal/frame-guard.js`). The server also blocks direct `.html` URLs on purpose.

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
| `GET /recorder`, `/studio`, `/results-analyser` | Tool pages, loaded inside the portal |
| `POST /convert`, `POST /convert-jmx` | Collection and JMeter conversions (rate-limited: 60 per 5 minutes per address) |
| `GET /converter/download/:token` | Single-use ZIP download, valid for 5 minutes |
| `GET /downloads/cdp-recorder` | Pre-built CDP Recorder (`cdp-recorder/recorder/dist/cdp-recorder.zip`, falling back to `.exe`) |
| `/ra`, `/ra/engine`, `/ra/report` | Static files of the Results Analyser |
| `GET /health`, `GET /status` | Health and status checks |
| `/admin` | Usage-statistics dashboard (only when `ADMIN_TOKEN` is set) |
| `/tools/recorder`, `/tools/studio` | Old links; redirect to `/converter/` |

## IIS deployment (production)

The application runs on IIS + iisnode (standard Windows Server stack). PM2 (`pm2.config.js`) and Docker (`Dockerfile`) are also available.

### Prerequisites

- Windows Server 2019 / 2022 with IIS 10
- Node.js 20 LTS or later
- iisnode 0.2.26
- IIS URL Rewrite Module 2.1

### Quick deploy steps

```powershell
# 1. Create site directory
mkdir C:\inetpub\lre-toolkit

# 2. Copy application files to C:\inetpub\lre-toolkit\

# 3. Install dependencies
cd C:\inetpub\lre-toolkit
npm install --production

# 4. Set permissions (NetworkService reads app code, writes iisnode logs)
icacls "C:\inetpub\lre-toolkit" /grant "NetworkService:(OI)(CI)R"
mkdir C:\inetpub\lre-toolkit\iisnode
icacls "C:\inetpub\lre-toolkit\iisnode" /grant "NetworkService:(OI)(CI)F"

# 5. In IIS Manager:
#    - Create Application Pool "lre-toolkit-pool" (No Managed Code)
#    - Create Site pointing to C:\inetpub\lre-toolkit
#    - Application Pool: lre-toolkit-pool

# 6. CDP Recorder download (optional): build it once (see cdp-recorder/README.md)
#    and copy cdp-recorder.zip to C:\inetpub\lre-toolkit\cdp-recorder\recorder\dist\
```

The `web.config` in the repository is already configured for iisnode. The complete step-by-step guide is `Docs/deployment/DEPLOYMENT-IIS.md`.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `MAX_CONCURRENT_CONVERSIONS` | `8` | Conversions running at once; more return HTTP 503 `server_busy` |
| `ADMIN_TOKEN` | not set | Enables the `/admin` usage dashboard |
| `ANALYTICS_DB_PATH` | see `src/analytics/db.js` | Location of the usage-statistics database |
| `ANALYTICS_RETENTION_DAYS` | see `src/web/server.js` | How long usage statistics are kept |

## Privacy model

Converter files are processed **entirely in memory**. Uploaded files and generated scripts are never written to disk.

| Stage | What happens |
|---|---|
| Upload | `multer.memoryStorage()` — files stay in RAM (2 GB limit per file) |
| Conversion | `AsyncLocalStorage` fs interceptor (`src/lib/memoryFsInterceptor.js`) redirects all `fs.writeFile` calls to an in-memory Map; 2-minute timeout |
| Download | ZIP streamed from the Map to the browser via `archiver.pipe(res)` — no ZIP file on disk |
| After download | Token deleted (single use, 5-minute lifetime); Map garbage-collected |

Each request has its own isolated `AsyncLocalStorage` context — no cross-request contamination.

The Recorder, Script Studio and the Results Analyser run entirely in the user's browser: recordings and test results never reach the server. Only usage statistics (tool, file name, counts — no file contents) are recorded, in the analytics database.

## Project structure

```
<repository root>/
│
├── app.js                    ← IIS entry point (starts src/web/server.js)
├── package.json
├── web.config                ← IIS + iisnode configuration
├── pm2.config.js, Dockerfile ← alternative deployments
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
│   ├── lib/                  ← memoryFsInterceptor, jmxDependencyResolver
│   ├── analytics/            ← usage statistics (SQLite) and admin exports
│   └── web/
│       ├── server.js         ← Express app (routes listed above)
│       ├── views/            ← index.ejs (portal), partials/{shell,home,converter,help}.ejs, admin.ejs
│       └── public/
│           ├── portal/       ← sidebar shell, Home, converter, Help, Recorder and Studio page scripts and styles
│           ├── Recorder.html ← Recorder page (loads the VuGen-Recorder-*.js engine files)
│           ├── Studio.html   ← Script Studio page (loads the studio-*.js files)
│           ├── shared/       ← vugen-codegen.js, page-resources.js (shared by Recorder and Studio)
│           └── VuGen-Recorder.html, VuGen-Script-Studio.html
│                             ← classic pages, kept only as the reference for parity tests (no route)
│
├── cdp-recorder/             ← CDP Recorder (Windows HAR recorder, replaces the extension)
├── lre-results-analyser/     ← Results Analyser (browser engine, reports, CLI)
├── tests/unit/               ← Jest unit tests
├── regression-tests/         ← pipeline regression test skeleton (no cases yet)
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
    studio:    { enabled: true  },
    analyser:  { enabled: true  },  // Results Analyser
    help:      { enabled: true  }
  },
  iframes: { recorder: BASE_PATH + '/recorder', studio: BASE_PATH + '/studio', analyser: BASE_PATH + '/results-analyser' }
};
```

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 20 or later |
| Web framework | Express 4 (helmet, express-rate-limit) |
| Template | EJS |
| File upload | multer (memoryStorage) |
| ZIP streaming | archiver 6 (chunked, no Content-Length) |
| XML parsing | fast-xml-parser 4 |
| Excel output | ExcelJS 4 |
| Usage statistics | better-sqlite3 |
| Client ZIP | JSZip 3.10.1 |
| Results Analyser (browser) | ECharts, ExcelJS, docx, sql.js (bundled in `lre-results-analyser/web/vendor/`) |
| CDP Recorder | TypeScript, chrome-remote-interface, Node Single Executable Application |
| Deployment | IIS 10 + iisnode 0.2.26 (PM2 or Docker as alternatives) |

The portal uses system fonts only and makes no CDN or web-font requests, so it works on locked-down networks.

## Documentation

The `Docs/` folder is kept locally and is not part of the repository; the links below work only in a working copy that has it.

| Document | Audience | Link |
|---|---|---|
| **Documentation index** | All | [Docs/INDEX.md](Docs/INDEX.md) |
| Getting started | All users | [Docs/user/GETTING-STARTED.md](Docs/user/GETTING-STARTED.md) |
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
| Change history | [CHANGELOG.md](CHANGELOG.md) |
| Bug tracker | [BUGS.md](BUGS.md) |
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

## Version history

| Version | Key changes |
|---|---|
| **Not released yet** | Portal redesign (left sidebar, task-based Home, new Recorder, Script Studio, converter and Help pages; one address for the whole app); Results Analyser; CDP Recorder replaces the retired browser extension; JWT / DPoP / VuGen runtime fixes. See `CHANGELOG.md`. |
| **v2.10.13** | Dead file cleanup; DPoP copy bug fix; Node 20 docs alignment; devErrors disabled |
| **v2.9.2** | PKCE (RFC 7636) support — Converter + Script Studio |
| **v2.9.0** | DPoP (RFC 9449) full support; HTML entity decoding for PEM keys |
| **v2.8.0** | Value-Based Auto-Correlation (VBAC) engine in Script Studio |
| **v2.7.0** | Memory-only processing; all log statements removed from generated scripts |
| **v2.6.0** | Per-request transaction naming with global sequential counter |
| **v2.5.0** | Multi-certificate upload; Bruno YAML folder collection support |
| **v2.4.0** | Proxy auto-detection; URL encoding fix for `{{variable}}` URLs |
| **v2.3.0** | JMeter converter; Workload Model Excel generation |
