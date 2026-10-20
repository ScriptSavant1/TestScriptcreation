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
2. Read `BUGS.md` (repo root) → active bugs
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
| `src/web/public/shared/page-resources.js` | JS | Groups static resources under their page step (VuGen EXTRARES / DevWeb resources[]) — shared with the Recorder (UMD) |
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
4. `shared/page-resources.js` (also loaded by the Recorder — attaches static resources to their page step, BUG-056)
5. `studio-codegen.js`
6. `studio-advisor.js`
7. `studio-ui.js`
8. `studio-app.js` ← live orchestrator
9. `analytics-device.js` (deferred)

All share global state object `S` (defined in `studio-app.js`).

### VuGen Recorder (HAR → script, browser tool)
| File | Purpose |
|------|---------|
| `src/web/public/VuGen-Recorder.html` | Recorder tool HTML + UI |
| `src/web/public/VuGen-Recorder-parsers.js` | HAR parsing for Recorder; handles extension HARs (pageref markers, null-response guard); keeps `respBody` for HTML pages only (page-resource grouping) |
| `src/web/public/VuGen-Recorder-generators.js` | Script generation for Recorder tool — HTML-mode: form POSTs → `web_submit_data` (BUG-055), page resources via `shared/page-resources.js` (BUG-056) |

### CDP Recorder (browser recording — replaces the retired PerfX extension)
| File | Purpose |
|------|---------|
| `cdp-recorder/recorder/src/recorder.ts` | Session orchestrator — browser process + CDP connection, start/stop/transactions |
| `cdp-recorder/recorder/src/cdp-capture.ts` | CDP Network capture via `Target.setAutoAttach` (new tabs/popups paused before they run) |
| `cdp-recorder/recorder/src/har-builder.js` | HAR 1.2 assembler with `_perfx_*` fields, pendingBodyFetches (unit-tested by `tests/unit/harBuilder.test.js`) |
| `cdp-recorder/recorder/src/bg-detector.js` | Background-traffic classifier (CoV frequency analysis + known path patterns + burst grouping) |
| `cdp-recorder/recorder/src/url-normalizer.js` | URL normalisation for bg-detector (cache-busters, UUIDs, numeric ids) |
| `cdp-recorder/recorder/src/server.ts` | Local floating control toolbar (Start/Stop/Transaction) |

**Distribution**: `GET /downloads/cdp-recorder` (server.js) serves the pre-built `dist/cdp-recorder.zip`/`.exe`; home page banner "Get CDP Recorder".
HAR pages[]/pageref → synthetic isMarker entries injected by `_injectPagerefMarkers` in both Studio and Recorder detectMarkers().
The PerfX Chrome/Edge extension (`perfx-recorder-extension/`) was removed from the repo and its history — do not recreate it.

### LRE Results Analyser (separate module — phases 0–5 built)
| File | Purpose |
|------|---------|
| `lre-results-analyser/README.md` | How to use (portal + CLI), methods, layout, validation steps |
| `lre-results-analyser/docs/IMPLEMENTATION-PLAN.md` | Phases 0–6, outputs, architecture (browser-side, nothing uploaded) |
| `lre-results-analyser/engine/*.js` | UMD engine (`LreRA.*`): parsers, eve decoder (transactions = sub-types 12586944/12586945/12619721, RT = end−start s; 762 = data points), txnames (internal id → name via sum_data graph), collector/hist, dat, insights, analyse (`analyse()`, `applySettings()`, `redact()`) |
| `lre-results-analyser/report/*.js` | Shared by page + CLI: format, charts (ECharts options), xlsx, docx, html |
| `lre-results-analyser/web/` | Page (`index.html`, `app.js`, `app.css`), `worker.js`, `zip.js` (ZIP64 streaming), `vendor/` |
| `lre-results-analyser/cli/analyse.js` | CLI: `<folder|zip> [--xlsx] [--docx] [--html] [--out] [--sla] [--window] [--redact]` |
| `lre-results-analyser/tools/make-demo-run.js` | Synthetic demo run generator (no client data) |
| `lre-results-analyser/tests/` | Jest, synthetic data only — never add real results (internal host names) |

Server: `/results-analyser` page + static `/ra`, `/ra/engine`, `/ra/report` (also under `/converter`). Portal tab `analyser` (iframe).
Model rule: the model is plain JSON; the stats store is a NON-enumerable `model.store` (stays in the worker).

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

### 8. lre-utils.js / lre-utils.dat MUST be ES3 — `node --check` does NOT verify this
VuGen's `web_js_run` JS engine only accepts ES3-level syntax: no trailing commas in
object/array literals or function calls, no `let`/`const`/arrow functions/`Map`/`Set`/
template literals/`for...of`/destructuring. `node --check` (or any Node.js execution) is
**useless** as a compatibility gate for this specific file — Node's parser has accepted
every one of those constructs since ES5/ES2015 and will silently pass code that VuGen's
real engine rejects with a parse error at runtime (`SyntaxError`, sometimes reported as the
unrelated-looking `invalid label`).

This has broken production code twice from the exact same root cause (trailing commas):
BUG-040 (21 instances, in function-call args and array literals) and a follow-up (3 more
instances, this time in **object literals** — a category BUG-040's cleanup didn't check —
found only after a real user hit a VuGen runtime error running a DPoP script).

**Always run `tests/unit/lreUtilsEs3Compat.test.js`** (parses both files with `acorn` at
`ecmaVersion: 3`) after ANY edit to `lre-utils.js` — update `lre-utils.dat` identically
(`cp lre-utils.js lre-utils.dat`) and re-run the test to confirm both still parse. `git diff
lre-utils.js lre-utils.dat` should always be empty.

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
- [ ] Update `BUGS.md` at the repo root (mark fixed, add discovered)
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
- **`Docs/` is local-only** (in `.gitignore`, removed from GitHub history) — never `git add -f` it.
- **After bug fix**: Add entry to `BUGS.md` (repo root) as FIXED; add to `CHANGELOG.md`
- **After new feature**: Add one-liner to relevant section in `Docs/FUNCTIONAL-SPEC.md`; add to `CHANGELOG.md`
- **After correlation change**: Update `Docs/CORRELATION-LOGIC-EXPLAINED.md`
- **Always**: Update `memory/state.md` with current feature status
- **CHANGELOG.md**: Append-only, lives at project root. Never rewrite or summarize away old entries. When it exceeds ~1 year of entries, move older entries to `CHANGELOG-ARCHIVE.md`.
- **BUGS.md archiving**: When fixed-bugs list grows very long, move old FIXED entries to `BUGS-ARCHIVE.md` (repo root) — keep them findable but out of the active file.

## Known Governance Gaps (track, don't ignore)
- **`processField()` untested** — inner closure of `genParamSuggestions()` in `studio-codegen.js`; not directly accessible. Requires refactoring to export or testing via `genParamSuggestions()`. Lowest-priority remaining gap.
- **`/regression-tests/` has no test cases yet** — folder + README + `run-all.sh` skeleton exist; no input fixtures or expected outputs captured. See `regression-tests/README.md` for the prioritised list.
- **No route-registration tests for `server.js`** — BUG-EXT-013 (POST /convert, /convert-jmx, GET /recorder, /studio missing their bare-root registration) shipped and reached a user before being caught, because nothing exercises Express route matching. Needs a `supertest`-based harness that boots the app and asserts each route responds at both `/` and `/converter`. Not yet implemented.

## Governance items RESOLVED (2026-07-29)
- ~~No unit tests~~ → **FIXED**: 165 tests across 5 suites in `tests/unit/`. New: `harBuilder.test.js`, `advisorCsrfScan.test.js`, `studioCodegenDates.test.js`.
- ~~No `DECISIONS.md`~~ → **FIXED**: `Docs/DECISIONS.md` with 7 ADRs (monolith split, extension distribution, memory FS, CDP, bookmarklet, advisor independence, test loading).
- ~~No `/regression-tests/`~~ → **FIXED**: Folder structure, README (prioritised capture list), and `run-all.sh` skeleton created.
