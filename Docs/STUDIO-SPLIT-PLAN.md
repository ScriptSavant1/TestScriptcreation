# VuGen-Script-Studio.html — Refactor / Split Plan

**File:** `src/web/public/VuGen-Script-Studio.html`  
**Current size:** 321 lines (after Phases 0–3c — COMPLETE ✅)  
**Goal:** Split into maintainable modules without breaking any functionality,  
keeping IIS deployment working exactly as today.

---

## How to resume this work in a new session

Tell Claude:
> "Read Docs/STUDIO-SPLIT-PLAN.md and continue the Studio refactor from where we left off."

Claude should read this file first, then read the current state of the HTML and any already-created split files before touching anything.

---

## IIS / Deployment Rules (NEVER violate these)

1. **All new files go in `src/web/public/`** — same folder as the HTML.  
   Express serves this folder as static. IIS serves it the same way.  
   No subdirectories — keeps relative paths simple and safe.

2. **Reference new files with bare relative paths** — `href="VuGen-Script-Studio.css"`,  
   `src="VuGen-Script-Studio-constants.js"` etc. No `./` prefix needed, no absolute paths.

3. **No `type="module"` on any `<script>` tag** — ES modules require MIME-type config  
   that may not be set on IIS. Use traditional `<script src="">` loading in dependency order.

4. **No online URLs anywhere** — fonts, libraries, anything. The organization has no  
   internet access. Everything must be a local file in the project.

5. **Load order matters** — each script can only use globals defined by earlier scripts.  
   Always load: constants → engine/logic → codegen → app (last).

6. **`jszip.min.js`, `DevWebSdk.d.ts`, `dpop-helper.js`, `lre-utils.dat`** — already local,  
   already working. Do not move or rename them.

---

## File Structure After Full Split

```
src/web/public/
  VuGen-Script-Studio.html              ← HTML skeleton only (~300 lines)
  VuGen-Script-Studio.css               ← all CSS (~920 lines) [Phase 2]
  VuGen-Script-Studio-constants.js      ← state S + all constants + static templates [Phase 3a]
  VuGen-Script-Studio-correlation.js    ← HAR parsing + correlation engine [Phase 3b]
                                           ← FUTURE HOME for value-based auto-correlation
  VuGen-Script-Studio-codegen.js        ← all code generators (DevWeb + VuGen) [Phase 3c]
  VuGen-Script-Studio-app.js            ← UI, analyze(), ZIP, render, utils [Phase 3d]
  DevWebSdk.d.ts                        ← unchanged, already exists
  jszip.min.js                          ← unchanged, already exists
  VuGen-Recorder.html                   ← untouched in this refactor
  404.html                              ← untouched
```

`<script>` loading order in the new HTML:
```html
<script src="jszip.min.js"></script>
<script src="VuGen-Script-Studio-constants.js"></script>
<script src="VuGen-Script-Studio-correlation.js"></script>
<script src="VuGen-Script-Studio-codegen.js"></script>
<script src="VuGen-Script-Studio-app.js"></script>
```

---

## Phases

---

### Phase 0 — Fix Online Dependencies (do this FIRST, ~30 min)

**Status: COMPLETE ✅**

**Problem:** Lines 6–11 of the HTML have Google Fonts `<link>` tags pointing to  
`fonts.googleapis.com` and `fonts.gstatic.com`. These timeout silently in offline environments,  
causing a noticeable page load delay and falling back to browser defaults.

**Fix:** Remove all Google Fonts `<link>` tags. Update the CSS font variables to  
use offline-safe system font stacks:

```css
/* UI font — replaces Inter */
--font-ui: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;

/* Code font — replaces JetBrains Mono */
--font-code: 'Consolas', 'Cascadia Code', 'Courier New', monospace;
```

Find all `font-family` references in the CSS (lines 12–932) that reference `'Inter'`  
or `'JetBrains Mono'` and replace with the variables above.

**Files changed:** `VuGen-Script-Studio.html` only  
**Risk:** Near zero — visual difference only (slightly different font rendering)  
**Test:** Open the tool, verify layout looks correct, no console errors about fonts

---

### Phase 1 — Remove Embedded DEVWEB_SDK_DTS (biggest size reduction, ~1 hour)

**Status: COMPLETE ✅**

**Problem:** The constant `DEVWEB_SDK_DTS` (lines 6253–9036, **2,783 lines**) is a full  
copy of `DevWebSdk.d.ts` embedded as a JS string. It is used only in `makeDevWebZip()`  
to write the file into the output ZIP. The same content already exists as the static  
file `public/DevWebSdk.d.ts`.

**Fix:** Replace the constant with a `fetch()` inside `makeDevWebZip()`:

```javascript
// BEFORE (embedded string constant — 2,783 lines):
const DEVWEB_SDK_DTS = `/// <reference ...
... 2783 lines ...
`;

// AFTER (fetch at ZIP time — 1 line):
// In makeDevWebZip():
const sdkDts = await fetch('DevWebSdk.d.ts').then(r => r.text());
// then use sdkDts wherever DEVWEB_SDK_DTS was used
```

`makeDevWebZip()` is already async (it uses `await` for other fetches like  
`dpop-helper.js` and `lre-utils.dat`), so adding `await fetch()` here is clean.

**Files changed:** `VuGen-Script-Studio.html` only  
**Size reduction:** ~2,783 lines removed from the HTML  
**Risk:** Near zero — identical content, same output ZIP  
**Test:** Generate a DevWeb ZIP, verify `DevWebSdk.d.ts` is present in the ZIP and  
has the correct content

---

### Phase 2 — Extract CSS (clean separation, ~1 hour)

**Status: COMPLETE ✅**

**What moves:** Everything inside `<style>...</style>` (lines 12–932, ~920 lines)

**Target file:** `src/web/public/VuGen-Script-Studio.css`

**Replacement in HTML:**
```html
<link rel="stylesheet" href="VuGen-Script-Studio.css">
```

**Important:** Check if any CSS uses JavaScript-injected class names or inline style  
strings that reference the CSS variable names — these stay in JS, only the stylesheet  
definition moves.

**Files changed:** HTML (remove CSS block, add link tag), new `.css` file  
**Risk:** Near zero  
**Test:** Open tool, verify all styles apply correctly (dark/light theme, buttons,  
upload zones, result panels, code display)

---

### Phase 3a — Extract Constants File (~2 hours)

**Status: COMPLETE ✅**

**What moves to `VuGen-Script-Studio-constants.js`:**

| Content | Current lines | Approx size |
|---------|--------------|-------------|
| Global state object `S` | 1247–1265 | 20 lines |
| `STATIC_CT` set | 1268–1290 | 25 lines |
| `STATIC_EXT` regex | ~1291 | 5 lines |
| `NOISY` regex | ~1295 | 15 lines |
| `SKIP_HDRS` set | ~1310 | 40 lines |
| `DYNAMIC_PATTERNS` object | ~1355 | 30 lines |
| `SESSION_COOKIE_NAMES` set | ~1370 | 15 lines |
| `CSRF_HEADER_NAMES` set | ~1380 | 10 lines |
| `CSRF_HEADER_PATTERN` regex | ~1385 | 5 lines |
| `AUTH_HEADER_NAMES` set | ~1390 | 10 lines |
| `PARAM_KEYS_MAP` object | 3741–3870 | ~130 lines |
| `WEB_DEFAULT_CFG` template | 5907–6069 | ~163 lines |
| `WEB_DEFAULT_USP` template | 6071–6139 | ~70 lines |
| `LRW_CUSTOM_BODY_H` | 6141 | ~5 lines |
| `CUSTOM_BODY_VARIABLES_TXT` | 6142 | ~5 lines |
| `DEVWEB_RTS_YML` template | 6144–6225 | ~82 lines |
| `DEVWEB_SCENARIO_YML` | 6227–6236 | ~10 lines |
| `DEVWEB_TSCONFIG_JSON` | 6238–6251 | ~14 lines |
| `DEVWEB_DEFAULT_CFG` | 9039–9067 | ~30 lines |
| `DEVWEB_DEFAULT_USP` | 9069–9125 | ~57 lines |

**Note:** `DEVWEB_SDK_DTS` is NOT moved here — it is removed in Phase 1.

**All variables remain as plain `var`/`const` globals** — no export/import syntax.  
They are visible to all subsequent scripts loaded after this file.

**Risk:** Low — pure move, no logic change  
**Test:** Verify constants are accessible in browser console  

---

### Phase 3b — Extract Correlation + HAR Engine (~3 hours)

**Status: COMPLETE ✅**

**Target file:** `src/web/public/VuGen-Script-Studio-correlation.js`

**This is the most important split — this file is the future home of the  
value-based auto-correlation engine.**

**What moves:**

| Function | Current lines | Description |
|----------|--------------|-------------|
| `parseHar()` | 1579–1650 | Convert HAR entries to internal format |
| `isNetLog()` | 1651 | Detect NetLog vs HAR format |
| `parseNetLog()` | 1652–1780 | Parse Chrome net-export JSON |
| `parseNetLogHeaderBlock()` | 1781–1820 | Parse HTTP header blocks from NetLog |
| `applyFilters()` | 1821–1843 | Remove static/noise entries |
| `detectMarkers()` | 1848–1887 | Find transaction START/END markers |
| `extractUrlPathParams()` | 1892–1930 | Parse ;jsessionid= matrix params |
| `normalizeUrlKey()` | 1931–2000 | Normalize URLs for matching |
| `parseCookieHdr()` | 2001–2030 | Parse Cookie request header |
| `extractDynamicPathSegments()` | 2031–2067 | Find changed REST path segments |
| `xmlDiffFlat()` | 2068–2090 | Flatten XML differences |
| `jsonDiffFlat()` | 2091–2097 | Flatten JSON differences |
| `diffObjects()` | ~2098 | Recursive object diff |
| `isDynamic()` | 2098–2140 | Check if value matches dynamic patterns |
| `genParamName()` | 2141–2180 | Generate parameter names |
| `sanitizeCandHint()` | 2181–2220 | Clean hints to valid identifiers |
| `findValueInResponse()` | 2221–2300 | Locate value in response (all types) |
| `findValueBefore()` | 2301–2354 | Search previous responses |
| `escapeRegex()` | ~2355 | Escape special regex chars |
| `singleHarCorrelate()` | 2372–2674 | Pattern-based single-HAR correlation |
| `twoHarCorrelate()` | 2695–3287 | Diff-based two-HAR correlation |

**[RESERVED SPACE] Future value-based correlation:**
```javascript
// Add after twoHarCorrelate():
function valueBasedCorrelate(entries) {
  // Pass 1: index all response values
  // Pass 2: find those values in subsequent requests
  // Emit correlations automatically
}
```

**Risk:** Medium — many interdependencies with `S` (state) and constants.  
Before moving, verify each function only depends on: `S`, constants from  
constants.js, and other functions within this file.  
**Test:** Run single-HAR and two-HAR analysis, verify correlations detected correctly

---

### Phase 3c — Extract Code Generators + App Logic (~3 hours)

**Status: COMPLETE ✅**

**Note:** Combined Phases 3c + 3d into one extraction for safety. All application logic
(UI helpers, file loading, utilities, code generators, analyze, ZIP, render) was moved
to `VuGen-Script-Studio-app.js` (3,869 lines). The HTML is now pure markup at 321 lines.

**Target file:** `src/web/public/VuGen-Script-Studio-codegen.js`

**What moves:**

| Function | Current lines | Description |
|----------|--------------|-------------|
| `devwebExtractorCode()` | 3527–3590 | DevWeb extractor objects |
| `webHttpCorrCode()` | 3591–3707 | VuGen web_reg_save_param_* calls |
| `matchParamKey()` | 3741–3870 | Check field against PARAM_KEYS_MAP |
| `detectParams()` | 3871–4012 | Detect parameterisable values |
| `genParamsYml()` | 4018–4035 | DevWeb parameters.yml |
| `genParamFilePrm()` | 4036–4055 | VuGen ParameterFile.prm |
| `genCollectionDataCsv()` | 4056–4063 | CSV data file |
| `genMainJS()` | 4068–4979 | DevWeb main.js generator |
| `genActionC()` | 4984–5877 | VuGen Action.c generator |
| All `genVuserInitC()`, `genVuserEndC()`, `genGlobalsH()`, `genUsrFile()` etc. | 5878–5905 | VuGen supporting files |
| `genDevWebUsrFile()`, `genDevWebScriptUploadMetadata()` etc. | ~9126–9310 | DevWeb supporting files |
| `detectAuth()`, `detectCorporateAuth()` | 9601–9700 | Auth detection |
| `genDefaultCfg()`, `genRtsYml()` | 9701–9754 | Config generation with auth |
| `detectServerHost()` | 9756–9777 | Server host detection |

**Depends on:** constants.js globals, correlation.js `findValueInResponse()`  
**Risk:** Medium — large functions with many internal references  
**Test:** Generate Web HTTP and DevWeb ZIPs, verify all generated files are correct

---

### Phase 3d — Extract App / UI Layer (~2 hours)

**Status: MERGED INTO Phase 3c ✅**

**Target file:** `src/web/public/VuGen-Script-Studio-app.js`

**What moves (everything remaining in the inline script):**

| Function | Description |
|----------|-------------|
| `showPhase()`, `setMsg()`, `goBack()` | Phase switching UI |
| `toggleCorrPanel()`, `toggleParamPanel()` | Panel collapse/expand |
| `setFmt()` | Output format selection |
| `onFilePick()`, `onDrop()`, `onDragOver()`, `onDragLeave()` | File input handlers |
| `loadFile()`, `markLoaded()`, `clearSlot()`, `clearAll()`, `updateUploadState()` | File state |
| `escJs()`, `escTpl()`, `esc()`, `fmtSize()`, `needsBinary()`, `escBodyBinary()` | Utility functions |
| `buildHdrHostMap()`, `subHdrValMj()`, `subRawMj()`, `subHdrValC()` | String substitution |
| `tick()`, `showToast()`, `copyCode()`, `toggleTheme()` | General UI |
| `analyze()` | Main orchestration function |
| `dlZip()`, `makeWebHttpZip()`, `makeDevWebZip()` | ZIP generation |
| `switchTab()`, `renderCorrelations()`, `renderParams()`, `renderTabs()`, `renderDlBar()` | Results rendering |
| `window.lrePortalInit()`, `window.lreSetTheme()` | Portal integration |

**Depends on:** all previous files  
**Risk:** Low for utility functions; medium for `analyze()` which calls everything  
**Test:** Full end-to-end: load HAR, click Analyze, verify results, download ZIP

---

### Phase 4 — Value-Based Auto-Correlation (NEW FEATURE)

**Status: COMPLETE ✅ — implemented 2026-05-01**

**Target file:** `VuGen-Script-Studio-correlation.js` — add new function at the bottom

**Algorithm:**
```
Pass 1 — Build response value index:
  For each entry (in order):
    Extract all values from: response body (JSON paths, form values),
    response headers (each header value), Set-Cookie values
    Map: value → { entryIndex, sourceType, extractPath/headerName/cookieName }
    Only index values with length >= 8 chars (avoid false positives)
    Skip: status codes, content-type values, server names

Pass 2 — Scan requests for indexed values:
  For each entry (starting from entry 2):
    Scan: URL query params, request headers (each value), request body
    For each value found: check if it exists in index from an EARLIER entry
    If match: emit correlation for the producing entry + substitution in consuming entry
    De-duplicate: one correlation per unique value

Post-process — False positive filter:
  Remove correlations where value appears in more than 5 requests (likely static)
  Remove correlations where value is a known static token (Content-Type values etc.)
```

**Why this solves the user's x-xsrf-token / financial-id problem:**
The current pattern-based engine only looks for known header names. The value-based  
engine sees that the value `"abc123xyz789"` appeared in response 1's body AND in  
request 2's `x-custom-financial-id` header — regardless of the header name.

---

## What to Tell Claude at Start of Each Session

```
Read Docs/STUDIO-SPLIT-PLAN.md. Then check which phases are complete by looking at 
what files exist in src/web/public/ (VuGen-Script-Studio-constants.js etc.) and 
check the Status fields in the plan. Then continue from the first NOT STARTED phase.
Do not start coding until you have read the plan AND verified current file state.
```

---

## Testing Checklist (run after each phase)

- [ ] Page loads without console errors
- [ ] Dark/light theme toggle works
- [ ] HAR file drag-and-drop works (both slots)
- [ ] NetLog file parsing works
- [ ] Analyze button triggers correctly
- [ ] Single-HAR correlation produces results
- [ ] Two-HAR correlation produces results
- [ ] Web HTTP/HTML ZIP downloads correctly and contains: Action.c, vuser_init.c, vuser_end.c, globals.h, ParameterFile.prm, collection_data.dat, default.cfg
- [ ] DevWeb ZIP downloads correctly and contains: main.js, parameters.yml, DevWebSdk.d.ts, rts.yml, scenario.yml
- [ ] Copy-to-clipboard works on each code tab
- [ ] Portal theme sync works (if embedded in main web UI)
- [ ] IIS deployment: copy public/ folder to IIS site, verify all assets load (no 404s in Network tab)

---

*Last updated: 2026-05-01*  
*Branch: dpop-Test*  
*HTML size: 10,323 → 7,538 lines after Phase 0 + Phase 1*  
*Next: Phase 2 — extract CSS to VuGen-Script-Studio.css*
