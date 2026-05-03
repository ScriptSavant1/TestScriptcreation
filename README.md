# LRE Toolkit — Performance Engineering

> Convert Postman/Bruno collections, JMeter scripts, and browser recordings into production-ready LoadRunner Enterprise VuGen scripts — automatically.

**Version:** 2.9.2 | **Internal tool — bank's performance engineering platform**

---

## What it does

The LRE Toolkit eliminates ~80% of manual VuGen scripting effort by automatically generating:

- **Correlation** — extracts all dynamic values (tokens, session IDs, CSRF tokens) from responses
- **3-tier parameterization** — classifies every variable as Dynamic / Config / Test Data
- **Authentication** — OAuth2, JWT signing, DPoP (RFC 9449), PKCE (RFC 7636), NTLM/Kerberos, Basic, Bearer, API Key, AWS Sig v4, mTLS
- **All mandatory files** — `.usr`, `rts.yml`, `scenario.yml`, `parameters.yml`, `Action.c`, `vuser_init.c`, parameter files, etc.
- **Per-request transactions** — sequential naming (`T01_Login`, `T02_GetAccount`)

---

## Three Tools

| Tool | Input | Best for |
|---|---|---|
| **Converter** | Postman v2.1, Bruno JSON/YAML/.bru, JMeter .jmx | Convert existing API collections or JMeter scripts |
| **Recorder** | Browser HAR export | Record journeys on VCSE/Azure VMs where VuGen proxy recording is blocked |
| **Script Studio** | 1 or 2 HAR files | Maximum-accuracy correlation using diff-based analysis |

---

## Output Formats

| Format | Protocol | Entry file | Choose when |
|---|---|---|---|
| 🟦 **DevWeb** | JavaScript | `main.js` | New projects, LRE 2021+ |
| 🟧 **Web HTTP/HTML** | C | `Action.c` | All LRE versions, existing projects |

---

## Quick Start

### Local development

```bash
npm install
npm start
# → http://localhost:3000/converter
```

### Custom port

```bash
PORT=8080 npm start
```

### Run directly

```bash
node src/web/server.js
```

### CLI (no web server)

```bash
node src/index.js \
  --input collection.json \
  --output ./output \
  --protocol devweb \
  --mode single
```

---

## IIS Deployment (Production)

The application runs on IIS + iisnode (standard Windows Server stack).

### Prerequisites

- Windows Server 2019/2022 with IIS 10
- Node.js 18 LTS
- iisnode 0.2.26
- IIS URL Rewrite Module 2.1

### Quick Deploy Steps

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
```

The `web.config` in the repository is already configured for iisnode. See [Docs/deployment/DEPLOYMENT-IIS.md](Docs/deployment/DEPLOYMENT-IIS.md) for the complete step-by-step guide.

---

## Privacy Model

All file processing is **entirely in-memory**. Nothing is ever written to disk.

| Stage | What happens |
|---|---|
| Upload | `multer.memoryStorage()` — files stay in RAM |
| Conversion | `AsyncLocalStorage` fs interceptor redirects all `fs.writeFile` calls → in-memory Map |
| Download | ZIP streamed from Map → browser via `archiver.pipe(res)` — no ZIP file on disk |
| After download | Token deleted; Map garbage-collected |

Each request has its own isolated `AsyncLocalStorage` context — no cross-request contamination.

---

## Project Structure

```
bruno-devweb-converter/
│
├── app.js                    ← IIS entry point
├── package.json
├── web.config                ← IIS + iisnode configuration
│
├── DevWebSdk.d.ts            ← TypeScript defs (included in output)
├── jwt-helper.js             ← DevWeb JWT signing helper (included in output)
├── jsrsasign.js              ← RSA/EC crypto for VuGen JS (included in output)
├── lre-utils.js              ← DPoP + PKCE + JWT crypto source (→ lre-utils.dat)
├── transport.pem             ← Placeholder PEM key (included in JWT output)
│
├── src/
│   ├── index.js              ← CLI entry point
│   ├── parsers/
│   │   ├── brunoParser.js    ← Postman v2.1 + Bruno all formats
│   │   └── jmxParser.js      ← JMeter .jmx XML
│   ├── analyzers/
│   │   ├── correlationDetector.js
│   │   ├── parameterizationEngine.js
│   │   ├── authenticationHandler.js
│   │   └── customScriptParser.js  ← JWT/DPoP library fingerprinting
│   ├── generators/
│   │   ├── advancedScriptGenerator.js       ← DevWeb main.js
│   │   ├── mandatoryFilesGenerator.js       ← DevWeb config files
│   │   ├── webHttpScriptGenerator.js        ← VuGen Action.c
│   │   └── webHttpMandatoryFilesGenerator.js
│   ├── converters/
│   │   └── jmxConverter.js
│   └── lib/
│       ├── memoryFsInterceptor.js    ← AsyncLocalStorage fs → RAM
│       └── jmxDependencyResolver.js
│
└── src/web/
    ├── server.js             ← Express app
    ├── views/index.ejs       ← Portal SPA
    └── public/
        ├── VuGen-Recorder.html
        ├── VuGen-Script-Studio.html
        ├── VuGen-Script-Studio-app.js        ← Studio code generator
        ├── VuGen-Script-Studio-correlation.js ← Studio correlation engine
        └── jszip.min.js
```

---

## Feature Overview

### Authentication — Auto-detected and generated

| Method | Detection |
|---|---|
| OAuth2 (CC, Password, Auth Code) | `auth.type`, token endpoint, `grant_type` |
| JWT signing (8 library signatures) | jsrsasign, jose, JJWT, nimbus, BouncyCastle, JCA, Auth0 java-jwt |
| **DPoP (RFC 9449)** | `dpop` / `dpop-pf` headers |
| **PKCE (RFC 7636)** | `code_challenge=` in URL, `code_verifier=` in body |
| NTLM / Kerberos | `auth.type=ntlm`, variable name patterns |
| Basic | `auth.type=basic` |
| Bearer Token | `Authorization: Bearer` header |
| API Key | `X-API-Key`, `api_key` query param |
| AWS Signature v4 | `AWS4-HMAC-SHA256` authorization |
| mTLS | `.pem`, `.p12`, `.jks` certificate upload |

### Correlation — All extractor types

JSON path, XPath, Regular expression, Boundary (left/right), Header, Cookie

### Script Studio Correlation Strategies

- **Two-HAR diff (VBAC)**: Compare two recordings — any value that differs = dynamic
- **Single-HAR pattern**: UUID, JWT, entropy scoring
- **Unresolved candidates**: TODO placeholders for Bearer tokens whose source wasn't in the HAR

---

## Configuration

### Portal tab visibility

Edit `PORTAL_CONFIG` in `src/web/views/index.ejs`:

```javascript
const PORTAL_CONFIG = {
  tabs: {
    home:      { enabled: true  },
    converter: { enabled: true  },
    recorder:  { enabled: true  },  // false → hides tab
    studio:    { enabled: true  },  // false → hides tab
    help:      { enabled: true  }
  }
};
```

---

## Tech Stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 18 LTS |
| Web framework | Express 4.18 |
| Template | EJS |
| File upload | multer (memoryStorage) |
| ZIP streaming | archiver 6 (chunked, no Content-Length) |
| XML parsing | fast-xml-parser 4.5 |
| Excel output | ExcelJS 4.4 |
| Client ZIP | JSZip 3.10.1 |
| Deployment | IIS 10 + iisnode 0.2.26 |

---

## Documentation

| Document | Audience | Link |
|---|---|---|
| **Documentation Index** | All | [Docs/INDEX.md](Docs/INDEX.md) |
| Executive Summary | Business stakeholders | [Docs/business/EXECUTIVE-SUMMARY.md](Docs/business/EXECUTIVE-SUMMARY.md) |
| Business Case | IT Management | [Docs/business/BUSINESS-CASE.md](Docs/business/BUSINESS-CASE.md) |
| Architecture | Architects | [Docs/technical/ARCHITECTURE.md](Docs/technical/ARCHITECTURE.md) |
| HLSD | Architecture board | [Docs/technical/HLSD.md](Docs/technical/HLSD.md) |
| DPoP Guide | Security team | [Docs/technical/DPOP-GUIDE.md](Docs/technical/DPOP-GUIDE.md) |
| PKCE Guide | Security team | [Docs/technical/PKCE-GUIDE.md](Docs/technical/PKCE-GUIDE.md) |
| Developer Guide | Developers | [Docs/technical/DEVELOPER-GUIDE.md](Docs/technical/DEVELOPER-GUIDE.md) |
| Getting Started | All users | [Docs/user/GETTING-STARTED.md](Docs/user/GETTING-STARTED.md) |
| IIS Deployment | Admins | [Docs/deployment/DEPLOYMENT-IIS.md](Docs/deployment/DEPLOYMENT-IIS.md) |
| Troubleshooting | All users | [Docs/user/TROUBLESHOOTING.md](Docs/user/TROUBLESHOOTING.md) |

---

## Tests

```bash
npm test                                    # All tests
npm test -- --testPathPattern=correlation  # Single suite
npm test -- --coverage                     # With coverage
```

---

## Version History

| Version | Key Changes |
|---|---|
| **v2.9.2** | PKCE (RFC 7636) support — Converter + Script Studio |
| **v2.9.0** | DPoP (RFC 9449) full support; HTML entity decoding for PEM keys |
| **v2.8.0** | Value-Based Auto-Correlation (VBAC) engine in Script Studio |
| **v2.7.0** | Memory-only processing; all log statements removed from generated scripts |
| **v2.6.0** | Per-request transaction naming with global sequential counter |
| **v2.5.0** | Multi-certificate upload; Bruno YAML folder collection support |
| **v2.4.0** | Proxy auto-detection; URL encoding fix for `{{variable}}` URLs |
| **v2.3.0** | JMeter converter; Workload Model Excel generation |
