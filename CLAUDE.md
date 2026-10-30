#| `src/web/public/portal/palette.js` | Quick search (Ctrl+K / ⌘K, top-bar Search): tools, Help sections + text, FAQ questions, actions; read from the page; also hooks Ctrl+K inside the tool iframes |
| `src/web/public/portal/drop-anywhere.js` | `PerfxDrop.attach({ when, label, route })` — a page-wide drop hands files to the page's own file inputs (used by converter.js, recorder-ui.js, studio-page.js); drops on a box that handles them itself are left alone |
 Bruno DevWeb Converter — CLAUDE.md
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

## Session Startup Protocol (MANDATORY)
1. Read `C:/Users/karrir/.claude/projects/c--Workspace-bruno-devweb-converter/memory/state.md` → current feature status
2. Read `BUGS.md` (repo root) → active bugs
3. Proceed with task
4. At end of session → update state.md, BUGS.md, any affected Docs/

## What This Tool Does
Converts HAR recordings, Bruno/Postman collections, and JMX files into:
- **DevWeb scripts** (JavaScript, LoadRunner Enterprise)
- **VuGen Web HTTP/HTML scripts** (C code, LoadRunner Professional)
- **VuGen Script Studio** — browser-based HAR analyzer at `/converter/studio`
  - Correlation Advisor (auto-detect + manual correlation)
  - Parameterization engine
  - Code generation for both protocols

## Critical File Map

### VuGen Script Studio (primary feature, most active)
| File | Size | Purpose |
|------|------|---------|
| `src/web/public/VuGen-Script-Studio.html` | HTML | All HTML/modals for Studio |
| `src/web/public/shared/vugen-codegen.js` | JS | Shared VuGen codegen (UMD, works browser+Node) — loaded first |
| `src/web/public/shared/page-resources.js` | JS | Groups static resources under their page step (VuGen EXTRARES / DevWeb resources[]) — shared with the Recorder (UMD) |
| `src/web/public/VuGen-Script-Studio-constants.js` | JS | Shared constants |
| `src/web/public/VuGen-Script-Studio-correlation.js` | JS | Correlation state management; `detectMarkers()` also runs `repairOrphanEnds()` (END bookmark without START → START inserted, the Recorder's rule — BUG-113) |
| `src/web/public/studio-codegen.js` | JS (large) | Shared codegen helpers (DevWeb + VuGen body substitution) |
| `src/web/public/studio-advisor.js` | JS | Correlation Advisor detection engine |
| `src/web/public/studio-ui.js` | JS (large) | Advisor UI, modals, card rendering |
| `src/web/public/studio-app.js` | JS | **Live orchestrator** — app logic + DevWeb/VuGen C codegen wiring |
| `src/web/public/analytics-device.js` | JS | Client-side fingerprint tracking (deferred load) |
| `src/web/public/VuGen-Script-Studio.css` | CSS | All styles |

**Phase history:** `VuGen-Script-Studio-app.js` was the Phase 3c monolithic file
(~5200 lines). In Phase 4B it was split into `studio-app.js` (orchestrator),
`studio-codegen.js` (codegen), and `studio-ui.js` (UI). The HTML was updated to
load the split files. The monolithic file is **DELETED**.
Do NOT recreate it — all its functions exist in the three split files above.

### Portal shell (sidebar + Home) — redesign in progress
| File | Purpose |
|------|---------|
| `src/web/views/partials/shell.ejs` | Collapsible sidebar + top bar markup (included by index.ejs with the icon map `I`) |
| `src/web/views/partials/home.ejs` | Home v6 — welcome band (headline, tagline, inputs → outputs picture), Quick actions (5 tool cards), "Your workflow" (record → correlate → run in LRE → analyse), "Need help?" + privacy note, footer line. Explanations belong in Help, not here (clients found the old Home heavy). Quick search's "Get CDP Recorder" links to the download directly (palette.js) |
| `src/web/public/portal/shell.js` | Page switching WITHOUT touching the address bar (always …/converter/; old #/x links open once and are cleaned), wraps switchPortalTab / openConverterTab / switchTab, collapse (localStorage `perfx-sidebar`), drawer, rail tooltips, CDP Recorder probe (`window.PerfxRecorder`, event `perfx:recorder`) |
| `src/web/public/portal/home.js` | Home buttons (`data-go`, `data-help`, `data-scroll`), PORTAL_CONFIG flags (`data-tab`) — nothing else |
| `src/web/public/portal/{shell,home}.css` | Styles; tool colours `--c-convert/-jmeter/-record/-studio/-results/-help` |

| `src/web/public/portal/track.js` | `PerfxTrack.send({...})` — usage ping of the browser tools (Recorder, HAR Explorer, Results Analyser) to …/analytics/track; Script Studio pings from studio-app.js |

Usage statistics: tools `recorder`, `explorer`, `studio`, `converter`, `jmx`, `analyser` (each list: server.js BROWSER_TOOLS, analytics/reports.js, exporters/{xlsx,docx}.js, views/admin.ejs). Machine = reverse DNS of `req.ip`, else the IP (anonymous IIS authentication — no user names).
Remembered options (localStorage): `perfx-cv-prefs` (converter.js), `perfx-rec-format` (recorder-ui.js), `perfx-studio-fmt` (studio-page.js) — restored through the pages' own setters.
Rule: the old switchers in index.ejs stay the source of truth; the shell only wraps them. Tool panels (Converter, Recorder, Studio, Analyser, Help) are redesigned one at a time — keep every piece of Help text.

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

### Recorder page (portal v3 redesign) — served at /recorder
| File | Purpose |
|------|---------|
| `src/web/public/Recorder.html` | New Recorder page (start page + workspace). Loads the classic engine files below UNCHANGED, in the same order, then the two files below |
| `src/web/public/portal/recorder-core.js` | VERBATIM copies of the engine functions the classic page keeps inline (detectMarkers, _recInjectPagerefMarkers, _makeRecMarker, classifyHarEntry, refresh) — `tests/unit/recorderCoreParity.test.js` fails if they drift, change both together. Own (since the type buttons): `applyFilters`, `recLeftOut(e, flags)` (reason code per request → `e.leftOut`), `recTypeKey(e)` (static file → JS/CSS/Img/Font by content, else browser type, unknown → other), `recFilterFlags()`, `_repairOrphanEnds()` (moved here unchanged from recorder-ui.js so the HAR Explorer repairs END-without-START exactly like the Recorder) |
| `src/web/public/portal/recorder-ui.js` | Replaces the display functions of VuGen-Recorder-ui.js / the inline script with the SAME global names and the same effect on `S` (renderTable, renderStats, showToast, confirmFmt, confirmTxn …). Extras: why-left-out, left-out requests hidden behind one summary line per transaction (`_openOut`, "Show left-out" = pref `showOut`), type buttons with counts (`S.typeOff`), Domains in two parts with each server's parameter + Rename dialog (`S.hostNames`, Undo) and a warning before leaving out a needed domain (`_domainNeeds`), rename/ungroup + undo, txn replay after format change, hide/show panes (localStorage `perfx-recorder-ui`), Studio hand-off |
| `src/web/public/portal/recorder.css` | Styles (portal tokens, `.rc-*`) |
| `src/web/public/shared/host-params.js` | Server parameters (UMD `HostParams`, loaded by both Recorder pages, both Studio pages and required by both converters): `plan(entries, scripted, renames, reserved)` → `{main, keys, map, list}` — every server of the scripted requests (+ non-cookie header values), main = first page load, names by role (`App_Server`, `Api_Server`, `Auth_Server`, `Static_Server`, known services `KNOWN`, else `<Org>_Server`; `defaultNames(keys, {paths})`); `validName`, `hostKey`. The generators read `S.hostParams` (set in `buildScripts`): VuGen `set_server` in vuser_init, DevWeb `const`, `_subHosts` (VuGen-Recorder-ui.js) substitutes `https://`, `https:\/\/` and `https%3A%2F%2F` forms |

Rule: engine behaviour must stay byte-identical to the classic page — check with the golden harness
(scratchpad `recorder-golden/harness.js` + `compare.js`, baseline from `/recorder-classic`). Deliberate exceptions (BUG-087..089):
server parameters and the type buttons — `harness-hosts.js` (type-button steps) + `compare-hosts.js` (server names normalised)
compare against the baseline `pre-hosts` / `pre-real`.
The classic pages (`VuGen-Recorder.html`, `VuGen-Script-Studio.html`) have no route any more (one address for the
whole app); they stay on disk only as the reference for the parity tests. The address bar must only ever show …/converter/.

### Help & guides (portal v3 redesign)
| File | Purpose |
|------|---------|
| `src/web/views/partials/help.ejs` | Help markup + its inline functions (haccToggle, haccJump, hTocToggle, hTocSetCur, hfaqToggle) — keep every word; 14 sections hacc-* |
| `src/web/public/portal/help.js` | Search ("/" shortcut), section list built into the portal sidebar (`#sb-help-nav` in shell.ejs; fold = click Help again, localStorage `perfx-help-nav`) + where-you-are by scroll position, sticky bar height → `--help-sticky-h`; reading mode: ONE section at a time (class `help-reader`, current section `.cur`, Previous / Next, last section in localStorage `perfx-help-section`), search lists all matches (`help-searching`) |
| `src/web/public/portal/help.css` | Styles, scoped to `body.has-shell #portal-help` |

Rule: `tests/unit/helpPageParity.test.js` must pass; check text parity with the Help capture
(scratchpad `help-golden/capture.js` + `diff.js`, word-level diff against the previous Help).

### Converter panels (portal v3 redesign)
| File | Purpose |
|------|---------|
| `src/web/views/partials/converter.ejs` | Postman / Bruno + JMeter panel markup (included by index.ejs). Keeps every id / handler the converter functions in index.ejs use (setProto, doConvert, doConvertJmx …) |
| `src/web/public/portal/converter.css` | Styles, scoped to `body.has-shell #portal-converter` |
| `src/web/public/portal/converter.js` | Keyboard on protocol cards (aria-checked), "How it works" fold remembered (localStorage `perfx-cv-how`) |

Rule: `tests/unit/converterPageParity.test.js` must pass; check output parity with the converter golden
harness (scratchpad `converter-golden/`; the server rate-limits /convert to 60 per 5 min per address — the
harness sends a different `X-Forwarded-For` per run).

### Script Studio page (portal v3 redesign) — served at /studio
| File | Purpose |
|------|---------|
| `src/web/public/Studio.html` | New Studio page. Loads the classic Studio scripts UNCHANGED, in the same order, and `VuGen-Script-Studio.css` under `portal/studio.css`; keeps every element id the scripts use |
| `src/web/public/portal/studio.css` | Maps the classic colour tokens onto the portal palette (both themes) and lays out the new page |
| `src/web/public/portal/studio-page.js` | `window.PerfxStudio.state()` = Studio's `S` (a const — NOT `window.S`; BUG-112) for the Recorder / HAR Explorer hand-offs. Layout behaviour only: Review / Script show-hide (localStorage `perfx-studio-ui`), dialog focus (in, trapped, returned; Escape closes), keyboard for script-drawn chips / tabs / headers, drop-zone focus ring; step bar `#ss-steps` (display only: step from the active phase + `#dz1.loaded` + a click in `#dl-bar`; moved into `#ph-res` on results) |
| `src/web/public/portal/frame-guard.js` | One address: a tool page (`<html data-portal-tool=record|studio|results>`) opened on its own goes to …/converter/ and the shell opens that tool (sessionStorage `perfx-open`); skipped for automated test browsers (`navigator.webdriver`) |

Rule: `tests/unit/studioPageParity.test.js` must pass; check output parity with the golden harness
(scratchpad `studio-golden/harness.js` + `compare.js`, baseline from the classic `/studio`).
The server blocks direct `.html` URLs on purpose — pages are reached through routes only.

### HAR Explorer (Create scripts, between Recorder and Script Studio — plan: Docs/HAR-EXPLORER-PLAN.md, illustrated guide: Docs/guides/har-explorer-guide.html)
| File | Purpose |
|------|---------|
| `src/web/public/HarExplorer.html` | The page (`data-portal-tool="explore"`), route `/har-explorer` + `/converter/har-explorer`; portal tab `explorer`, shell page `explore`, colour `--c-explore`, theme key `hx-theme` |
| `src/web/public/portal/har-explorer-model.js` | `hxBuild(har)` → `{groups, items, source}`: the Recorder's own reading — the page loads `VuGen-Recorder-state.js`, `VuGen-Recorder-parsers.js`, `portal/recorder-core.js` UNCHANGED, calls `processHAR()` + `_repairOrphanEnds()` (its drawing steps are no-ops here). `tests/unit/harExplorerModel.test.js` checks groups / left-out = the Recorder's |
| `src/web/public/portal/har-explorer-worker.js` | Find a value, in a Web Worker (importScripts the Studio engine UNCHANGED: constants, correlation, studio-advisor — they cannot share the page with the Recorder engine, same global names). Messages: `load {text, out}` → `ready` (own suggestions), `find {id, value}` → `found` (verdict kinds: correlate, cookie, redirect, outonly, unused, input, generated, missing, none; trail; forms for highlighting); a SECOND copy gets `studio {text}` → Studio's findings → page forwards `studioList` → `ready` with Studio's first. Referer / Origin and left-out requests are not uses. Also loads `shared/vugen-codegen.js` + `studio-codegen.js`: `correlation()` builds `{name, extractorType, extractorConfig}` (jsonpath / html / cookie / boundary_header / boundary — boundaries widened until the FIRST match is the value) and the code via Studio's `webHttpCorrCode` / `devwebExtractorDecl`; `uses` in Studio's usage form. `tests/unit/harExplorerFind.test.js` (incl. agreement + round trip through Studio) |
| `src/web/public/portal/har-explorer.{js,css}` | Start page, workspace (file bar, filters, request list — only the rows on screen are drawn — and details: Headers, Payload, Response, Preview, Cookies, Timing; Hide secrets, Copy URL / cURL), theme hooks, prefs localStorage `hx-ui` (listW, showOut). All 6 steps of the plan done; Help section `hacc-explorer`; usage ping `tool: "explorer"` (portal/track.js) per opened file |

Hand-off "Continue in Script Studio" (har-explorer.js): `clearAll` → `setFmt` → `loadFile` → `analyze()` → (after the background review, if any) — requests named by Studio's request id (`parseHar` id, never shifts; resolved to the current `S.entries1` index — Studio inserts markers: CDP pages, BUG-113 repair) → `advisorAddManual` per value with `cand._explorer = {extractorType, extractorConfig}` + the Explorer's uses → `advisorApplyAndRegen()`. `studio-advisor.js advisorToCorrelation` honours `_explorer` (else unchanged); `studio-ui.js` labels it "From HAR Explorer".
Rule: reuse, never copy — transactions / left-out from `portal/recorder-core.js`, suggestions and boundaries from `studio-advisor.js` (Advisor agreement test planned).
Parity check on real recordings: scratchpad `audit/hx-parity.js <files>` (each file through the Recorder screen and the Explorer screen, every request's transaction + left-out compared); screen walk-through `audit/hx-ui.js`.

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
| `src/generators/devweb/scriptGenerator.js` | DevWeb script generation from Bruno/Postman/JMX (`advancedScriptGenerator.js` is a shim) |
| `src/generators/vugen/scriptGenerator.js` | VuGen C script generation from Bruno/Postman/JMX (`webHttpScriptGenerator.js` is a shim) |
| `src/web/public/shared/vugen-codegen.js` | Shared VuGen codegen (UMD, works browser+Node) |

### Generated script layout — same rules in Recorder, Script Studio and both converters
- vuser_init: `set_server(name, value)` for the servers the script USES (Runtime Settings attribute with that name wins),
  `web_set_sockets_option("SSL_VERSION","AUTO")`, `web_add_auto_header` for headers on EVERY request with ONE value.
  Never global: authorization, proxy-authorization, cookie, dpop(-pf), origin, access-control-request-*, *csrf*/*xsrf*.
  `web_set_user` is in Action in all tools (converter NTLM / Kerberos too; collection-level auth is inherited).
  Only servers the finished script writes are declared (`HostParams.usedKeys`; Studio reads `S._stActionC`).
- Action: a pointer comment, `lre-utils.js` reloaded at the top when DPoP/PKCE/JWT is used (VuGen empties its JS
  engine every new-user iteration — BUG-092), one DPoP proof right before each request (htu = URL as sent, via
  `LR.getParam`; `ath` only when the request presents a token), think time between steps but not after the last,
  `Mode=HTTP` except page loads, 4-space indentation. DevWeb: `const App_Server = load.config.user.args["App_Server"] || 'host';`
  (user argument wins — checked with DevWeb, module level is fine), lower-case header names, `load.thinkTime`.
- Left out in Recorder + Studio: browser prefetch of a page later opened (`recPrefetchDuplicates`), analytics / ads by
  server (`NOISY`, the SAME list in `VuGen-Recorder-state.js` and `VuGen-Script-Studio-constants.js`) and by path
  (`NOISY_URL`: Google `/ads/`, `/pagead/`).
- Studio: server rename in "Parameterization details" (`openHostRename` / `confirmHostRename` in studio-ui.js,
  dialog `#host-modal-overlay` in Studio.html, registered in portal/studio-page.js) → `S.hostNames` → `regenerateFromAdvisor({quiet:true})`.
- XPath: converter correlations from `xml2Json(...)` are XPath; DevWeb gets plain names (`/a/b` — no `local-name()`
  support), VuGen gets `local-name()` (namespace-aware) via `_vugenXpath`. A script's explicit extractor kind wins over
  the name-guessed type in VuGen.
- Converter VuGen: auto headers live in `this._autoHeaderBlock` (written into vuser_init) — `generate()` scans it for
  undeclared `{params}` too; `tidyC` collapses blank-line runs.
- Proof: scratchpad `vugen-run/` — `mockproxy.js` (TLS test proxy, HAR replay, DPoP verifier), `runvugen.js` /
  `rundevweb.js` (real engines), `wirediff.js`, `withkeys.js` (throwaway key + cert for the sample collections),
  `convwire.sh` / `recwire.sh` / `studiowire.sh`. Compare old vs new on the wire before changing generated code.

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

## Session-End Checklist (run after EVERY code change session)
- [ ] Impact analysis was done for any non-trivial change (see playbook)
- [ ] `node --check` on all modified .js files
- [ ] Unit tests written/updated for new or changed functions
- [ ] Update `BUGS.md` at the repo root (mark fixed, add discovered)
- [ ] Update `C:/Users/karrir/.claude/projects/c--Workspace-bruno-devweb-converter/memory/state.md`
- [ ] Update `Docs/CORRELATION-LOGIC-EXPLAINED.md` if correlation logic changed
- [ ] `git add` + `git commit` with descriptive message
- [ ] No `console.error` or unhandled exceptions in modified code paths

## CSS / Design System
**`src/web/public/portal/ds.css` is the design system (v4)** — tokens `--ds-*` for both themes and shared
components `ds-btn`, `ds-card`, `ds-chip`, `ds-tile`, `ds-seg`, `ds-tabs`, `ds-panel`, `ds-table`, `ds-code`,
`ds-drop`, `ds-note`, and (v5) the tool header band `ds-band` (soft blue, edge to edge; `ds-band-title` icon tile + h1,
`ds-band-lead`, `ds-flow` three-step picture with `is-tool`, `ds-hand` handwritten caption; the page sets `--band-top` = its top
padding) — the Home page's look on every tool page. Every tool uses the panel layout `ds-band-panel` (tool name + `ds-band-tag`
tagline, short lead, the picture in a soft panel, the note in a tilted card; in the portal, converter.css / help.css narrow the
breakpoints with their container width because the window width includes the sidebar). Loaded first by index.ejs, Recorder.html, Studio.html and the Results Analyser page; the
portal's older tokens (`--bg`, `--text`, `--glass` …) are mapped onto it in shell.css. Rules: one brand blue for
actions (one primary button per area), tool colours only on icons, sentence case, pages use the full width
beside the sidebar (`--ds-page-max: 100%`), no emoji in the interface (SVG line icons).
The admin pages use it too: `src/web/views/admin.ejs` links `portal/ds.css` (prefix from `adminBase`); the sign-in page
(`adminLoginHtml()` in server.js) carries the same tokens inline. Admin reports: `src/analytics/exporters/{xlsx,docx}.js`.
Portal design rules (checked by the design audit — scratchpad `audit/audit.js`, every section, both themes):
- One text font (system: Segoe UI on Windows) + one code font (Cascadia Code / Consolas); no web-font requests.
  One agreed exception: the Home picture caption uses Windows' handwriting font (Segoe Print — installed, not downloaded).
- Font weights 400 / 600 / 700 ONLY. Segoe UI has no 500/650/750/800/850 face — 750+ renders as Segoe UI Black (blocky).
  `b, strong { font-weight: 700 }` everywhere (the default "bolder" turns bold-in-bold into 900). Controls inherit the font.
- Text contrast ≥ 4.5:1 in both themes (muted text: dark #8191ab, light #56677f; light-theme blue #2563eb;
  white text only on deep colours — tool colour mixed ~58% with black).
- Shapes: cards / panels 16px, tiles 12px, buttons 10px (small 9px, large 12px).
All design tokens in `:root` in `VuGen-Script-Studio.css`.
Key token groups: `--bg-*`, `--text-*`, `--accent-*`, `--border-*`, `--radius-*`, `--shadow-*`
Component naming: `.adv-*` (advisor), `.corr-*` (correlations), `.param-*` (parameters), `.studio-*` (main studio).
Dark mode: `.dark` class on `<body>`.

## Auto-maintenance Conventions
- **`Docs/` is local-only** (in `.gitignore`, removed from GitHub history) — never `git add -f` it.
- **After bug fix**: move the row in `BUGS.md` (repo root) to "Fixed — not released yet" with the cause and fix; add an entry to `CHANGELOG.md`
- **After new feature**: Add one-liner to relevant section in `Docs/FUNCTIONAL-SPEC.md`; add an entry to `CHANGELOG.md`
- **After correlation change**: Update `Docs/CORRELATION-LOGIC-EXPLAINED.md`
- **Always**: Update `memory/state.md` with current feature status
- **CHANGELOG.md**: at the project root, newest first. New entries go under "Not released yet" in their area (Portal, Performance, Results Analyser, CDP Recorder, Script generation, Recorder and Script Studio, Server) as a `####` heading; at release time they move under the version. Never summarise away old entries. When it exceeds ~1 year of entries, move older versions to `CHANGELOG-ARCHIVE.md`.
- **BUGS.md**: sections Open bugs · Known limitations · Fixed — not released yet · Fixed in released versions (by version) · Performance · Refactors · Process improvements. When the fixed list grows very long, move old versions to `BUGS-ARCHIVE.md` (repo root).
- **No repository details in any file**: never write the GitHub account, repository name or URL, branch names, or commit IDs into documents or code comments — refer to a version number or describe the change instead. No `---` divider lines in documents.

## Known Governance Gaps (track, don't ignore)
- **`processField()` untested** — inner closure of `genParamSuggestions()` in `studio-codegen.js`; not directly accessible. Requires refactoring to export or testing via `genParamSuggestions()`. Lowest-priority remaining gap.
- **`/regression-tests/` has no test cases yet** — folder + README + `run-all.sh` skeleton exist; no input fixtures or expected outputs captured. See `regression-tests/README.md` for the prioritised list.
- **No route-registration tests for `server.js`** — BUG-EXT-013 (POST /convert, /convert-jmx, GET /recorder, /studio missing their bare-root registration) shipped and reached a user before being caught, because nothing exercises Express route matching. Needs a `supertest`-based harness that boots the app and asserts each route responds at both `/` and `/converter`. Not yet implemented.

## Governance items RESOLVED (2026-07-29)
- ~~No unit tests~~ → **FIXED**: 165 tests across 5 suites in `tests/unit/`. New: `harBuilder.test.js`, `advisorCsrfScan.test.js`, `studioCodegenDates.test.js`.
- ~~No `DECISIONS.md`~~ → **FIXED**: `Docs/DECISIONS.md` with 7 ADRs (monolith split, extension distribution, memory FS, CDP, bookmarklet, advisor independence, test loading).
- ~~No `/regression-tests/`~~ → **FIXED**: Folder structure, README (prioritised capture list), and `run-all.sh` skeleton created.
