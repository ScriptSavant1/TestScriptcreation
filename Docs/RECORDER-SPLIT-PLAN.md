# VuGen-Recorder.html — Split Into Modules

**Goal:** Break the 258 KB / 6,224-line monolithic HTML into focused files for maintainability.
Zero behaviour changes — pure structural refactoring.

**Reference:** Follows the same pattern already used for `VuGen-Script-Studio.html`
(which has `VuGen-Script-Studio.css`, `VuGen-Script-Studio-constants.js`, etc.).

---

## Status

| # | File | Contents | Actual lines | Status |
|---|------|----------|------------|--------|
| 1 | `VuGen-Recorder.css` | All CSS — design system vars, layout, buttons, table, panels | 439 | ✅ done |
| 2 | `VuGen-Recorder-state.js` | Shared mutable state `S`, `COLORS`, `FILE_NAMES`; filter sets `STATIC_CT`, `STATIC_EXT`, `NOISY`; generator set `SKIP_HDRS` | 77 | ✅ done |
| 3 | `VuGen-Recorder-templates.js` | Template-string constants: `WEB_DEFAULT_CFG`, `WEB_DEFAULT_USP`, `LRW_CUSTOM_BODY_H`, `CUSTOM_BODY_VARIABLES_TXT`, `DEVWEB_RTS_YML`, `DEVWEB_SCENARIO_YML`, `DEVWEB_TSCONFIG_JSON`, `DEVWEB_SDK_DTS`, `DEVWEB_DEFAULT_CFG`, `DEVWEB_DEFAULT_USP` | 3,237 | ✅ done |
| 4 | `VuGen-Recorder-parsers.js` | `isNetLog`, `parseNetLogHeaderBlock`, `parseNetLog`, `processHAR`, `processNetLog` | 235 | ✅ done |
| 5 | `VuGen-Recorder-generators.js` | `buildAutoFollowMap`, `genActionC`, `buildConcurrentGroups`, `genMainJS`, `genVuserInit`, `genVuserEnd`, `genGlobalsH`, `detectAuth`, `detectCorporateAuth`, `genDefaultCfg`, `genRtsYml`, `detectServerHost`, `buildScripts` | 849 | ✅ done |
| 6 | `VuGen-Recorder-usr-gen.js` | `genUsrFile`, `genScriptUploadMetadata`, `genDevWebUsrFile`, `genDevWebScriptUploadMetadata`, `dlZip` | 264 | ✅ done |
| 7 | `VuGen-Recorder-ui.js` | `renderTable`, `toggleTxn`, `applyCollapse`, `collapseAll`, `expandAll`, `toggleCollapseAll`, `updateCollapseAllBtn`, `markerRow`, `entryRow`, `renderStats`, `switchTab`, `showScript`, `dl`, `toggleSelMode`, `rowClick`, `clearSel`, `openTxnModal`, `closeModal`, `confirmTxn`, `buildDomainStats`, `renderDomainPanel`, `onDpClick`, `toggleDomain`, `toggleAllDomains`, `openFmtModal`, `selectFmt`, `closeFmtModal`, `confirmFmt`, `applyFmtUI`, `showWelcome`, `clearAll`, `esc`, `escJs`, `escTpl`, `buildHdrHostMap`, `subHdrValMj`, `subRawMj`, `subHdrValC`, `needsBinary`, `escBodyBinary`, `fmtSize`, `setupResizer` | 564 | ✅ done |
| — | `VuGen-Recorder.html` (updated) | HTML structure + jszip loader + theme/portal IIFE + `toggleTheme`, `showToast`, `copyCode` + `onFilePick`, `onDrop`, `readFile` + `detectMarkers`, `classifyHarEntry`, `applyFilters`, `refresh`, `setRecorderRt` | **574** (was 6,224) | ✅ done |

---

## Script Loading Order (inside HTML, before `</body>`)

```html
<!-- 1 — MUST be first: provides S, COLORS, SKIP_HDRS used by all other modules -->
<script src="VuGen-Recorder-state.js"></script>

<!-- 2 — pure data, no deps -->
<script src="VuGen-Recorder-templates.js"></script>

<!-- 3 — refs S, detectMarkers (inline) -->
<script src="VuGen-Recorder-parsers.js"></script>

<!-- 4 — refs S, SKIP_HDRS, template constants -->
<script src="VuGen-Recorder-generators.js"></script>

<!-- 5 — refs S, template constants, genUsrFile called from buildScripts -->
<script src="VuGen-Recorder-usr-gen.js"></script>

<!-- 6 — refs S, COLORS, FILE_NAMES, esc helpers -->
<script src="VuGen-Recorder-ui.js"></script>

<!-- 7 — inline: theme IIFE, file drop handlers, filter/classification (refs S, STATIC_CT) -->
<script> ... </script>
```

---

## Path Strategy — IIS-safe

All new files sit in `src/web/public/` alongside the HTML file.

| Reference | Tag | Value |
|-----------|-----|-------|
| CSS | `<link rel="stylesheet" href="VuGen-Recorder.css">` | relative |
| JS files | `<script src="VuGen-Recorder-state.js">` etc. | relative |

**Why relative paths are safe:**
- `express.static` serves `public/` at `/` AND at `/converter/`
- When page is at `/recorder`, `VuGen-Recorder.css` resolves to `/VuGen-Recorder.css` ✓
- When page is at `/converter/recorder`, it resolves to `/converter/VuGen-Recorder.css` ✓  
  (second static mount serves that path)
- IIS uses `iisnode` — all requests route through Express unchanged
- **No `web.config` changes needed**

This is identical to how `VuGen-Script-Studio.html` loads its CSS and JS modules.

---

## Source Line Map (original VuGen-Recorder.html)

| Content | Lines |
|---------|-------|
| CSS block (inside `<style>`) | 10 – 449 |
| jszip loader inline script | 451 – 459 |
| HTML structure (header, welcome, panels, modals) | 460 – 747 |
| Main `<script>` block starts | 748 |
| Theme IIFE + portal init (`lrePortalInit`, `lreSetTheme`) | 749 – 780 |
| `toggleTheme`, `showToast`, `copyCode` | 771 – 815 |
| `S`, `COLORS`, `FILE_NAMES` | 819 – 850 |
| File handlers: `onFilePick`, `onDrop`, `readFile` | 855 – 888 |
| NetLog parsers (`isNetLog` … `parseNetLog`) | 889 – 1047 |
| `processHAR`, `processNetLog` | 1051 – 1119 |
| `detectMarkers` | 1123 – 1156 |
| `STATIC_CT`, `STATIC_EXT`, `NOISY` | 1160 – 1168 |
| `classifyHarEntry`, `applyFilters`, `refresh`, `setRecorderRt` | 1170 – 1266 |
| `renderTable` … `renderStats` (table rendering) | 1267 – 1408 |
| `buildAutoFollowMap` | 1409 – 1461 |
| `genActionC` | 1465 – 1732 |
| `SKIP_HDRS` | 1737 – 1765 |
| `buildConcurrentGroups`, `genMainJS` | 1766 – 2093 |
| `genVuserInit`, `genVuserEnd`, `genGlobalsH` | 2097 – 2124 |
| `detectAuth` … `buildScripts` | 2128 – 2284 |
| `switchTab`, `showScript`, `dl` | 2288 – 2312 |
| Template string constants | 2313 – 5549 |
| `genUsrFile` … `genDevWebScriptUploadMetadata` | 5554 – 5815 |
| Selection mode, transactions, domain stats | 5816 – 5969 |
| Format modal (`openFmtModal` … `applyFmtUI`) | 5972 – 6036 |
| `showWelcome`, `clearAll` | 6038 – 6057 |
| Utility functions (`esc` … `fmtSize`) | 6058 – 6174 |
| `setupResizer` | 6175 – 6222 |

---

## Progress Log

- [x] `VuGen-Recorder.css` created
- [x] `VuGen-Recorder-state.js` created
- [x] `VuGen-Recorder-templates.js` created
- [x] `VuGen-Recorder-parsers.js` created
- [x] `VuGen-Recorder-generators.js` created
- [x] `VuGen-Recorder-usr-gen.js` created
- [x] `VuGen-Recorder-ui.js` created
- [x] `VuGen-Recorder.html` updated (link + script tags, extracted content removed)
- [ ] Smoke-tested: page loads, HAR drop works, both output formats generate correctly
