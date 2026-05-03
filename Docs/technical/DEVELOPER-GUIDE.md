# LRE Toolkit — Developer Guide

**Version:** 2.9.2 | **Date:** May 2026  
For engineers adding features, fixing bugs, or extending the toolkit.

---

## Prerequisites

- Node.js 18 LTS
- Git
- A text editor (VS Code recommended)
- Basic familiarity with: JavaScript (ES2020), Express, VuGen scripting concepts

---

## Setup

```bash
git clone <repo-url>
cd bruno-devweb-converter
npm install
npm start        # → http://localhost:3000/converter
```

### Test suite

```bash
npm test         # Jest, all tests
npm test -- --watch   # Watch mode
npm test -- --testPathPattern=jmxConverter  # Single file
```

---

## Mental Model: Two Code Paths

Every feature must be implemented in TWO separate paths:

```
Path A: Server-side Converter
  ┌─────────────────────────────────────────────────────┐
  │  brunoParser → analyzers → generators               │
  │  src/parsers/  src/analyzers/  src/generators/      │
  └─────────────────────────────────────────────────────┘

Path B: Client-side Studio / Recorder
  ┌─────────────────────────────────────────────────────┐
  │  VuGen-Script-Studio-app.js                         │
  │  VuGen-Script-Studio-correlation.js                 │
  │  (Recorder: VuGen-Recorder.html)                    │
  └─────────────────────────────────────────────────────┘
```

The Studio runs entirely in the browser. It has its own:
- HAR parser
- Authentication detector  
- Correlation engine
- Code generator (DevWeb + VuGen)
- ZIP assembler

Changes to server-side generators must be **mirrored** in the Studio.

---

## Adding a New Authentication Type

### Step 1 — Detect it (server-side)

In [src/analyzers/authenticationHandler.js](../../src/analyzers/authenticationHandler.js), add a new detection method:

```javascript
detectMyAuth() {
    // Check collection auth.type, headers, variable names
    for (const req of this.requests) {
        if (req.auth?.type === 'myauth') {
            this.authConfig.type = 'myauth';
            this.authConfig.myParam = req.auth.myParam;
            return;
        }
    }
}
```

Call it from `detectAuth()` in the right priority order.

### Step 2 — Generate code (server-side)

In `advancedScriptGenerator.js`:

```javascript
// In generateAuth() or generateInitialize()
if (this.authConfig.type === 'myauth') {
    o += "    // My Auth\n";
    o += "    const myToken = await getMyAuthToken(load.params.my_param);\n";
    o += "    load.global.my_token = myToken;\n";
}
```

In `webHttpScriptGenerator.js`:

```c
// In generateVuserInit()
if (this.authConfig.type === 'myauth') {
    o += "\tweb_add_header(\"X-My-Token\", \"{my_token}\");\n";
}
```

### Step 3 — Mirror in Studio

In [VuGen-Script-Studio-app.js](../../src/web/public/VuGen-Script-Studio-app.js), find the auth detection block and add:

```javascript
// After the DPoP detection block
S.hasMyAuth = false;
for (const e of S.entries1) {
    if ((e.headers || []).some(h => h.name === 'X-My-Auth')) {
        S.hasMyAuth = true;
        break;
    }
}
```

Then in the DevWeb/VuGen generation sections:

```javascript
if (S.hasMyAuth) {
    o += "    // My Auth generation code\n";
    // ...
}
```

### Step 4 — Add to parameter classification

If the new auth type has credentials, add them to `classifyVariables()` in both `advancedScriptGenerator.js` and `webHttpScriptGenerator.js`:

```javascript
// In classifyVariables()
if (key.match(/my.?auth.?param/i)) {
    tier = 'testdata'; // Per-user credentials
}
```

---

## Adding a New Extractor Type (Correlation)

### Step 1 — Detection in correlationDetector.js

In `extractFromResponse(responseBody, mimeType, targetValue)`:

```javascript
// After JSON path extraction
if (mimeType.includes('my-type')) {
    const result = tryMyExtraction(responseBody, targetValue);
    if (result) return { extractorType: 'mytype', extractorConfig: result };
}
```

### Step 2 — Code generation (server-side)

In `advancedScriptGenerator.js` `generateExtractor(corr)`:

```javascript
case 'mytype':
    return `    load.global.${corr.name} = extractMyType(response.body, '${corr.extractorConfig.path}');\n`;
```

In `webHttpScriptGenerator.js`:

```javascript
case 'mytype':
    return `web_reg_save_param_mytype("${corr.name}",\n    "QueryString=${corr.extractorConfig.path}",\n    LAST);\n`;
```

### Step 3 — Mirror in Studio correlation engine

In `VuGen-Script-Studio-correlation.js`, add your extraction logic to `valueBasedCorrelate()` and `singleHarCorrelate()`.

In `VuGen-Script-Studio-app.js`, add the `case 'mytype':` to both the DevWeb and VuGen extractor generation blocks.

---

## Adding a New Output File (Mandatory Files)

### DevWeb

In [src/generators/mandatoryFilesGenerator.js](../../src/generators/mandatoryFilesGenerator.js):

```javascript
async generateMyNewFile() {
    const content = `# My new config file\nproperty: ${this.scriptName}\n`;
    await this.writeFile(`my-new-file.yml`, content);
}
```

Call it from `generateAll()`.

### VuGen

In [src/generators/webHttpMandatoryFilesGenerator.js](../../src/generators/webHttpMandatoryFilesGenerator.js) — same pattern.

### Studio (client-side)

In `VuGen-Script-Studio-app.js`, find the JSZip assembly block and add:

```javascript
zip.file('my-new-file.yml', `# My new config\nproperty: ${S.scriptName}\n`);
```

---

## Key Invariants — Don't Break These

### URL handling

**NEVER** use `new URL()` on URLs with `{{variable}}` placeholders. Variables like `{{baseUrl}}/path` are not valid URLs and `new URL()` will throw or produce `%7B%7B`.

```javascript
// WRONG
const parsed = new URL(req.url);  // Throws if url contains {{vars}}

// RIGHT
const [base, qs] = req.url.split('?');
```

### Event storage in brunoParser

Scripts are stored in `req.tests[]`, not `req.event[]`. Always access as:

```javascript
const events = req.tests || req.event || [];
```

### Private key classification

PEM keys and other crypto material must be classified as Tier 1 Dynamic. The pattern list in `classifyVariables()` must be kept up to date. If a private key ends up in a CSV/PRM file, VuGen crashes.

### Snapshot counter in VuGen

Every `web_url`, `web_custom_request`, etc. must have a unique `"Snapshot=tN.inf"` attribute. The generator uses `this.snapshotCounter` which increments globally per `Action.c`. NEVER hard-code snapshot numbers — always use the counter.

```javascript
const snap = this.snapshotCounter++;
o += `\t\t"Snapshot=t${snap}.inf",\n`;
```

### C89 variable declarations

VuGen `Action.c` is compiled as C89. ALL variable declarations must be at the TOP of the function, before any statements. The generators never emit `var char * x;` mid-function.

### DYNSTART markers

Body/URL injection uses `\x00DYNSTART_VarName\x00DYNEND` as a placeholder. These are expanded in a second pass. Never expand them prematurely or the second pass will miss them.

---

## Testing

### Test file location

```
src/__tests__/
├── advancedScriptGenerator.test.js
├── webHttpScriptGenerator.test.js
├── correlationDetector.test.js
├── authenticationHandler.test.js
├── jmxConverter.test.js
└── brunoParser.test.js
```

### Writing a test

```javascript
const { AdvancedScriptGenerator } = require('../../generators/advancedScriptGenerator');

test('generates PKCE code when hasPkce is true', () => {
    const gen = new AdvancedScriptGenerator(mockRequests, mockOptions);
    gen.hasPkce = true;
    const code = gen.generateAction();
    expect(code).toContain('pkce_challenge');
    expect(code).toContain('crypto.subtle.digest');
});
```

### Running a specific test

```bash
npm test -- --testPathPattern=pkce
```

---

## Deployment (dev → production)

1. Merge feature branch to `main`
2. On the IIS server: `git pull origin main`
3. `npm install --production` (if new dependencies added)
4. Restart the IIS Application Pool:
   - IIS Manager → Application Pools → `lre-toolkit-pool` → Recycle
   - Or: `iisreset /noforce` (stops and restarts IIS)
5. Verify: open the tool URL and run a test conversion

No build step required. The application runs directly from source.

---

## Common Mistakes

| Mistake | Symptom | Fix |
|---|---|---|
| Forgetting to mirror server change in Studio | Converter works, Studio doesn't | Check VuGen-Script-Studio-app.js |
| Using `new URL()` on `{{var}}` URL | `TypeError: Invalid URL` | Use `url.split('?')` manually |
| `req.event[]` instead of `req.tests[]` | Bruno YAML collections miss scripts | Use `req.tests \|\| req.event \|\| []` |
| Hardcoded snapshot numbers | Duplicate snapshots in VuGen | Use `this.snapshotCounter++` |
| Variable declaration inside if-block in C | VuGen compile error | Move declarations to top of function |
| Not calling `decodeHtmlEntities()` on PEM values | JWT crypto fails | Apply decoder before any crypto use |
| Private key in CSV column | VuGen Parameters panel crashes | Ensure private-key pattern in classifier |

---

## Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `PORT` | `3000` | HTTP port to listen on |
| `NODE_ENV` | `development` | Set to `production` in IIS |

No other environment variables are required at runtime.

---

*See also: [Architecture](ARCHITECTURE.md) | [Code Structure](CODE-STRUCTURE.md) | [Correlation Engine](CORRELATION-ENGINE.md)*
