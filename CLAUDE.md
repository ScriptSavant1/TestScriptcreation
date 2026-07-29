# Bruno DevWeb Converter — CLAUDE.md
# READ THIS FIRST. Updated automatically after every session.

## Standing Rules (read once, apply always)

Also read and follow, every session:
- ai-assisted-development-playbook.md
- documentation-automation-system.md
- testing-strategy-and-definition-of-done.md

These govern: impact analysis before non-trivial changes, unit test
requirements for new/changed functions, the documentation update matrix, and
the Definition of Done checklist. They apply in addition to everything below
— nothing below is overridden by them.

---

## Session Startup Protocol (MANDATORY)
1. Read `C:/Users/karrir/.claude/projects/c--Workspace-bruno-devweb-converter/memory/state.md` → current feature status
2. Read `Docs/BUGS.md` → active bugs
3. Proceed with task
4. At end of session → update state.md, BUGS.md, any affected Docs/

---

## What This Tool Does
Converts HAR recordings, Bruno/Postman collections, and JMX files into:
- **DevWeb scripts** (JavaScript, LoadRunner Enterprise)
- **VuGen Web HTTP/HTML scripts** (C code, LoadRunner Professional)
- **VuGen Script Studio** — browser-based HAR analyzer at `/converter/studio`
  - Correlation Advisor (auto-detect + manual correlation)
  - Parameterization engine
  - Code generation for both protocols

---

## Critical File Map

### VuGen Script Studio (primary feature, most active)
| File | Size | Purpose |
|------|------|---------|
| `src/web/public/VuGen-Script-Studio.html` | HTML | All HTML/modals for Studio |
| `src/web/public/shared/vugen-codegen.js` | JS | Shared VuGen codegen (UMD, works browser+Node) — loaded first |
| `src/web/public/VuGen-Script-Studio-constants.js` | JS | Shared constants |
| `src/web/public/VuGen-Script-Studio-correlation.js` | JS | Correlation state management |
| `src/web/public/studio-codegen.js` | JS (large) | Shared codegen helpers (DevWeb + VuGen body substitution) |
| `src/web/public/studio-advisor.js` | JS | Correlation Advisor detection engine |
| `src/web/public/studio-ui.js` | JS (large) | Advisor UI, modals, card rendering |
| `src/web/public/studio-app.js` | JS | **Live orchestrator** — app logic + DevWeb/VuGen C codegen wiring |
| `src/web/public/analytics-device.js` | JS | Client-side fingerprint tracking (deferred load) |
| `src/web/public/VuGen-Script-Studio.css` | CSS | All styles |

**Phase history:** `VuGen-Script-Studio-app.js` was the Phase 3c monolithic file
(~5200 lines). In Phase 4B it was split into `studio-app.js` (orchestrator),
`studio-codegen.js` (codegen), and `studio-ui.js` (UI). The HTML was updated to
load the split files. The monolithic file is **DELETED** (commit `d641ddc`).
Do NOT recreate it — all its functions exist in the three split files above.

### Entry Point
`src/web/public/VuGen-Script-Studio.html` loads scripts in this order
(confirmed by reading the HTML's `<script>` tags directly, not inferred):
1. `shared/vugen-codegen.js`
2. `VuGen-Script-Studio-constants.js`
3. `VuGen-Script-Studio-correlation.js`
4. `studio-codegen.js`
5. `studio-advisor.js`
6. `studio-ui.js`
7. `studio-app.js` ← live orchestrator
8. `analytics-device.js` (deferred)

All share global state object `S` (defined in `studio-app.js`).

### VuGen Recorder (HAR → script, browser tool)
| File | Purpose |
|------|---------|
| `src/web/public/VuGen-Recorder.html` | Recorder tool HTML + UI |
| `src/web/public/VuGen-Recorder-parsers.js` | HAR parsing for Recorder; handles extension HARs (pageref markers, null-response guard) |
| `src/web/public/VuGen-Recorder-generators.js` | Script generation for Recorder tool |

### PerfX Recorder Chrome/Edge Extension
| File | Purpose |
|------|---------|
| `perfx-recorder-extension/manifest.json` | MV3 manifest — permissions: debugger, tabs, storage, sidePanel; host_permissions: `<all_urls>`; minimum_chrome_version: 114 |
| `perfx-recorder-extension/background/service-worker.js` | Session lifecycle, port management, SETTLED fallback timer |
| `perfx-recorder-extension/background/cdp-capture.js` | CDP capture, active/background count separation, stale watchdog |
| `perfx-recorder-extension/background/har-builder.js` | HAR 1.2 assembler with `_perfx_*` fields, pendingBodyFetches |
| `perfx-recorder-extension/background/bg-detector.js` | BackgroundDetector: CoV frequency analysis (stdDev/mean < 0.30, ≥3 calls, ≤30s mean) + known path-pattern pre-classification (27 fragments: /ping, /heartbeat, /analytics/event, etc.) + 200ms burst grouping |
| `perfx-recorder-extension/background/url-normalizer.js` | normalize() strips 20 known cache-buster params, replaces UUIDs and numeric path segments (4+ digits) with `{id}`, drops fragment. Note: uses `new URL()` safely — CDP URLs are fully resolved, not `{{variable}}` templates |
| `perfx-recorder-extension/content/gesture-detector.js` | USER_GESTURE messages on click/submit/Enter |
| `perfx-recorder-extension/sidepanel/sidepanel.html` | Side panel HTML |
| `perfx-recorder-extension/sidepanel/sidepanel.js` | 7-state UI machine (IDLE→RECORDING_LOADING→RECORDING_READY→NAMING→TX_LOADING→TX_READY→STOPPED) |
| `perfx-recorder-extension/sidepanel/sidepanel.css` | Side panel styles |

**Extension distribution**: Users download via `GET /downloads/recorder-extension` (server.js route — ZIPs the folder on demand via `archiver`). Accessed from the home page banner. **Load unpacked is blocked by enterprise Group Policy at corporate clients (e.g. NatWest/RBS) — the only route there is IT allowlisting via Chrome Web Store publishing.**

**Key extension architecture rules:**
- `startSettledTimer()` in cdp-capture.js only fires when a request FINISHES. If recording starts on an idle page, a 600ms fallback in service-worker.js `START_RECORDING` broadcasts SETTLED directly (BUG-EXT-012).
- PERSISTENT_TYPES (WebSocket, EventSource) are excluded from ACTIVE_REQUESTS — they never fire loadingFinished.
- 8s stale watchdog per request as universal fallback for stuck connections.
- `harBuilder.pendingBodyFetches` (Set of Promises) — STOP_RECORDING awaits them before flush().
- HAR pages[]/pageref → synthetic isMarker entries injected by `_injectPagerefMarkers` in both Studio and Recorder detectMarkers().

### Converters (less active)
| File | Purpose |
|------|---------|
| `src/generators/advancedScriptGenerator.js` | DevWeb script generation from Bruno/Postman |
| `src/generators/webHttpScriptGenerator.js` | VuGen C script generation from Bruno/Postman |
| `src/web/public/shared/vugen-codegen.js` | Shared VuGen codegen (UMD, works browser+Node) |

---

## Global State Object `S` (studio-app.js)
```
S.entries1        — full HAR entries array (ALL entries, including filtered)
S.correlations    — [{name, sourceIdx, extractorType, extractorConfig, usages[]}]
S.advisorCandidates — [{id, value, source, usages, status, ...}]
S.params          — parameterization entries
S.scripts         — generated script files map
S.auth            — detected auth config
S.hasDpop         — DPoP enabled flag
S.harPages        — Map<pageref, title> built from har.log.pages[] (extension HARs only; empty for bookmarklet HARs)
S.bgDecisions     — Map<requestId, 'once'|'periodic'|'all'> — background traffic classification from Phase 5
```

---

## CRITICAL Architecture Rules (NEVER BREAK THESE)

### 1. Index Rule
All `sourceIdx`, `reqIdx`, `entryIdx` in correlations/usages ALWAYS reference `S.entries1` (the FULL array including filtered entries). Never reindex after filtering.

### 2. Filtered Entry Rule
`e.filtered` and `e.isMarker` entries MUST be skipped in:
- All dropdowns
- All scans (body, header, query)
- All advisor detection loops
Never remove them from `S.entries1`.

### 3. URL Rule
NEVER use `new URL()` on URLs that may contain `{{variables}}` — it encodes braces to `%7B%7B`. Use manual string splitting (`url.split('?')`).

### 4. Event Storage Rule
Bruno/Postman events are stored in `req.tests[]` NOT `req.event[]`. Always use:
```javascript
const events = req.tests || req.event || [];
```

### 5. studio-advisor.js Independence Rule
`studio-advisor.js` has ZERO dependencies on other modules. It only reads `S.entries1` and `S.correlations`. Never import/call other modules from it.

### 6. Body Substitution Sentinels
Sentinels are only used in `studio-codegen.js` (client-side Studio). The server-side generators use `replaceParameters()` directly on `{{varName}}` syntax.

| Sentinel | Meaning | Generated expression |
|----------|---------|---------------------|
| `\x00DYNSTART_name\x00DYNEND` | Correlation value | `${load.global.name}` |
| `\x00DYNJSON_name\x00DYNEND` | Correlation value needing JSON re-escape | `${JSON.stringify(load.global.name\|\|'').slice(1,-1)}` |
| `\x00DYNRND_name\x00DYNEND` | Random element from correlation array (`random_select`) | `${load.global.name[Math.floor(Math.random()*load.global.name.length)]}` |
| `\x00PARAM_key\x00PARAMEND` | Parameter value | `${load.params.key}` |
| `\x00PARAMJSON_key\x00PARAMEND` | Parameter value needing JSON re-escape | `${JSON.stringify(load.params.key\|\|'').slice(1,-1)}` |
| `@@ARRAY_RECONSTR_key@@` | Array reconstruction | `${JSON.stringify(_key_arr)}` |
| `\x00SRVHOST_VarName\x00` | Host parameterization | `${VarName}` |

**Resolution order** in `genMainJS()` (order matters — ARRAY_RECONSTR mutates the body object first):
`@@ARRAY_RECONSTR@@` → `DYNSTART` → `DYNRND` → `DYNJSON` → `PARAM` → `PARAMJSON`

**Unresolved sentinels** produce silently broken output (NUL bytes in JS source or C string truncation at first NUL).

### 7. Extractor Types
| Type | DevWeb | VuGen C |
|------|--------|---------|
| `jsonpath` | `new load.JsonPathExtractor(name, path)` | `web_reg_save_param_json(...)` |
| `jsonpath+selectAll` | third arg `true` (boolean); runtime stores result as **JS array** at `load.global.name` (NOT `name_1`/`name_count`) | `SelectAll=Yes`; VuGen stores `{name}_1..N` + `{name}_count` |
| `boundary` | `new load.BoundaryExtractor(name, {leftBoundary, rightBoundary, scope: load.ExtractorScope.Body})` | `web_reg_save_param(LB=..., RB=...)` |
| `boundary_header` | `new load.BoundaryExtractor(name, {leftBoundary, rightBoundary, scope: load.ExtractorScope.Headers})` | `web_reg_save_param(LB=..., RB=..., Search=Headers)` |
| `regexp` | `new load.RegExpExtractor(name, pattern)` | `web_reg_save_param_regexp(...)` |
| `html` | `new load.BoundaryExtractor` with HTML-aware boundaries | `web_reg_save_param` with HTML boundary pair |
| `random_select` | emits `DYNRND` sentinel; random array element picker at runtime | same as `jsonpath+selectAll` with random index |
| `array_reconstruct` | IIFE `.map()` over `load.global.anchorVar` (JS array) | `web_js_run` builder + `_count`/`_N` indexing |
| `cookie` | suppressed when ALL usages are in cookie headers; emitted as boundary extractor when mixed usage | suppressed when ALL usages are in cookie headers |

---

## Body Generation: DevWeb vs VuGen

### DevWeb (JavaScript)
- Body emitted as template literal when dynamic: `` body: `{"key":"${load.global.token}"}` ``
- Body emitted as JS object when static (via `_renderJsVal`)
- Large bodies: inline JS object

### VuGen C
- Body emitted as C string inline `"Body=..."` or split across multiple string literals
- Body ALWAYS goes through `escBodyBinary()` — escapes `"→\"`, `\→\\`, `\n→\n`
- Parameters use `{paramName}` syntax substituted at runtime
- Correlations use `{corrName}` syntax

---

## Correlation Advisor: Key Functions
| File | Function | Purpose |
|------|----------|---------|
| studio-advisor.js | `advisorScan()` | Main entry — phases 1-4 |
| studio-advisor.js | `_advExtractResponseValues()` | Phase 1: walk all response bodies |
| studio-advisor.js | `_advCrossReference()` | Phase 2: find values in later requests |
| studio-advisor.js | `_advCsrfScan()` | Phase 2.5: detect CSRF tokens by field NAME (`_CSRF_FIELD_RE`, 14 patterns); backward-scans all preceding responses (including HTML) |
| studio-advisor.js | `_advPatternScan()` | Phase 3: JWT/UUID pattern detection |
| studio-advisor.js | `_advMergeArrayCandidates()` | F1: merge array siblings → SelectAll |
| studio-advisor.js | `_advDetectArrayGroups()` | F2: detect array reconstruction |
| studio-advisor.js | `advisorToCorrelation()` | Convert candidate → S.correlations entry |
| studio-advisor.js | `advisorAddManual()` | Manual correlation via field browser |
| studio-ui.js | `renderAdvisorPanel()` | Render candidate cards |
| studio-ui.js | `_advCardHtml()` | HTML for one candidate card |
| studio-ui.js | `openAdvisorModal()` | Open Add Manual modal |
| studio-ui.js | `advisorApplyAndRegen()` | Accept candidates + regenerate |

---

## Session-End Checklist (run after EVERY code change session)
- [ ] Impact analysis was done for any non-trivial change (see playbook)
- [ ] `node --check` on all modified .js files
- [ ] Unit tests written/updated for new or changed functions
- [ ] Update `Docs/BUGS.md` (mark fixed, add discovered)
- [ ] Update `C:/Users/karrir/.claude/projects/c--Workspace-bruno-devweb-converter/memory/state.md`
- [ ] Update `Docs/CORRELATION-LOGIC-EXPLAINED.md` if correlation logic changed
- [ ] `git add` + `git commit` with descriptive message
- [ ] No `console.error` or unhandled exceptions in modified code paths

---

## CSS / Design System
All design tokens in `:root` in `VuGen-Script-Studio.css`.
Key token groups: `--bg-*`, `--text-*`, `--accent-*`, `--border-*`, `--radius-*`, `--shadow-*`
Component naming: `.adv-*` (advisor), `.corr-*` (correlations), `.param-*` (parameters), `.studio-*` (main studio).
Dark mode: `.dark` class on `<body>`.

---

## Auto-maintenance Conventions
- **After bug fix**: Add entry to `Docs/BUGS.md` as FIXED; add to `CHANGELOG.md`
- **After new feature**: Add one-liner to relevant section in `Docs/FUNCTIONAL-SPEC.md`; add to `CHANGELOG.md`
- **After correlation change**: Update `Docs/CORRELATION-LOGIC-EXPLAINED.md`
- **After extension change**: Update `Docs/EXTENSION-RECORDER-PLAN.md` phase status table
- **Always**: Update `memory/state.md` with current feature status
- **CHANGELOG.md**: Append-only, lives at project root. Never rewrite or summarize away old entries. When it exceeds ~1 year of entries, move older entries to `CHANGELOG-ARCHIVE.md`.
- **BUGS.md archiving**: When fixed-bugs list grows very long, move old FIXED entries to `Docs/BUGS-ARCHIVE.md` — keep them findable but out of the active file.

## Known Governance Gaps (track, don't ignore)
- **`processField()` untested** — inner closure of `genParamSuggestions()` in `studio-codegen.js`; not directly accessible. Requires refactoring to export or testing via `genParamSuggestions()`. Lowest-priority remaining gap.
- **`fetchBodyAndFinish()` untested** — `perfx-recorder-extension/background/cdp-capture.js`; depends on live Chrome `chrome.debugger` API. Requires a Chrome mock or integration test. Not yet implemented.
- **`/regression-tests/` has no test cases yet** — folder + README + `run-all.sh` skeleton exist; no input fixtures or expected outputs captured. See `regression-tests/README.md` for the prioritised list.

## Governance items RESOLVED (2026-07-29)
- ~~No unit tests~~ → **FIXED**: 165 tests across 5 suites in `tests/unit/`. New: `harBuilder.test.js`, `advisorCsrfScan.test.js`, `studioCodegenDates.test.js`.
- ~~No `DECISIONS.md`~~ → **FIXED**: `Docs/DECISIONS.md` with 7 ADRs (monolith split, extension distribution, memory FS, CDP, bookmarklet, advisor independence, test loading).
- ~~No `/regression-tests/`~~ → **FIXED**: Folder structure, README (prioritised capture list), and `run-all.sh` skeleton created.
