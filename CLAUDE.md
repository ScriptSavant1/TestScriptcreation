# PerfX Studio (formerly Bruno DevWeb Converter) — CLAUDE.md
Read this first. Keep it up to date when files or rules change.

## Standing Rules (read once, apply always)

Also read and follow `DEVELOPMENT-RULES.md`, every session: impact analysis before non-trivial changes, unit tests for new or changed functions, which documents to update, secrets and generic wording, and the definition of done. It applies in addition to everything below.

## Session Startup Protocol (MANDATORY)
1. Read `memory/state.md` → current feature status
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

### Server log
`src/lib/appLog.js` — started first by `app.js` (IIS): copies every console line to `logs/perfx-YYYY-MM-DD.log` with a synchronous write, plus start, exit and crashes (`uncaughtExceptionMonitor`); keeps 14 days; `PERFX_LOG_DIR` overrides the folder. `server.js` logs every 5xx response, never the query string. `web.config` is deployment-sensitive: do not change it.

### VuGen Script Studio (primary feature, most active)
| File | Size | Purpose |
|------|------|---------|
| `src/web/public/VuGen-Script-Studio.html` | HTML | All HTML/modals for Studio |
| `src/web/public/shared/vugen-codegen.js` | JS | Shared VuGen codegen (UMD, works browser+Node) — loaded first |
| `src/web/public/shared/request-filter.js` | JS | One rule set for which recorded requests go into the script (UMD `RequestFilter`): `TYPES` (8 type buttons), `typeKey`, `leftOut` (reason: report, websocket, nonhttp, prefetch, domain, options, ads, type), `prefetchDuplicates`. Used by the HAR reading engine (`recorder-core.js`), Studio `applyFilters` and the HAR Explorer (page + worker) — BUG-142; `tests/unit/requestFilter.test.js` |
| `src/web/public/shared/page-resources.js` | JS | Groups static resources under their page step (VuGen EXTRARES / DevWeb resources[]) (UMD) |
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
| `src/web/views/partials/home.ejs` | Home v6 — welcome band (headline, tagline, inputs → outputs picture), Quick actions (6 tool cards, icons as in the sidebar), "Your workflow" (record → correlate → run in LRE → analyse), "Need help?" + privacy note, footer line. Explanations belong in Help, not here (clients found the old Home heavy). Quick search's "Get CDP Recorder" links to the download directly (palette.js) |
| `src/web/public/portal/shell.js` | Page switching WITHOUT touching the address bar (always …/converter/; old #/x links open once and are cleaned), wraps switchPortalTab / openConverterTab / switchTab, collapse (localStorage `perfx-sidebar`), drawer, rail tooltips, CDP Recorder probe (`window.PerfxRecorder`, event `perfx:recorder`) |
| `src/web/public/portal/home.js` | Home buttons (`data-go`, `data-help`, `data-scroll`), PORTAL_CONFIG flags (`data-tab`) — nothing else |
| `src/web/public/portal/{shell,home}.css` | Styles; tool colours `--c-convert/-jmeter/-record/-studio/-results/-help` |
| `src/web/public/portal/palette.js` | Quick search (Ctrl+K / ⌘K, top-bar Search): tools, Help sections + text, FAQ questions, actions (incl. "Start recording" → Script Studio, `SS.view("home")` + `PerfxRecordLive.open()` in its iframe; a title equal to the typed words ranks first); read from the page; also hooks Ctrl+K inside the tool iframes |
| `src/web/public/portal/drop-anywhere.js` | `PerfxDrop.attach({ when, label, route })` — a page-wide drop hands files to the page's own file inputs (used by converter.js, studio-page.js); drops on a box that handles them itself are left alone |
| `src/web/public/portal/track.js` | `PerfxTrack.send({...})` — usage ping of the browser tools (Script Studio for recordings made with Start recording, HAR Explorer, Results Analyser) to …/analytics/track; Script Studio pings from studio-app.js |

Usage statistics: tools `recorder`, `explorer`, `studio`, `converter`, `jmx`, `workload`, `analyser` (each list: server.js BROWSER_TOOLS, analytics/reports.js, exporters/{xlsx,docx}.js, views/admin.ejs). Machine = reverse DNS of `req.ip`, else the IP (anonymous IIS authentication — no user names).
Remembered options (localStorage): `perfx-cv-prefs` (converter.js), `perfx-studio-fmt` (studio-page.js) — restored through the pages' own setters.
Rule: the old switchers in index.ejs stay the source of truth; the shell only wraps them. Tool panels (Converter, Studio, Analyser, Help) are redesigned one at a time — keep every piece of Help text.

### Script Studio load order
`src/web/public/Studio.html` (the live page, see below) and the classic `VuGen-Script-Studio.html` (reference for the parity tests) load the Studio scripts in this order:
1. `shared/vugen-codegen.js`
2. `shared/request-filter.js` (also loaded by the HAR Explorer — which requests go into the script, BUG-142)
3. `VuGen-Script-Studio-constants.js`
4. `VuGen-Script-Studio-correlation.js`
5. `shared/page-resources.js` (attaches static resources to their page step, BUG-056)
6. `shared/host-params.js`
7. `studio-codegen.js`
8. `studio-advisor.js`
9. `studio-ui.js`
10. `studio-app.js` ← live orchestrator
11. `analytics-device.js` (deferred)

Then `Studio.html` loads its own page scripts: `portal/track.js`, `portal/drop-anywhere.js`, `portal/record-live.js`, `portal/studio-txn.js`,
`portal/studio-page.js`, `portal/studio-workspace.js`.

All share global state object `S` (defined in `studio-app.js`).

### Recording and the HAR reading engine (the Recorder tool is part of Script Studio — step 6 of Docs/redesign/plan.md)
| File | Purpose |
|------|---------|
| `src/web/public/portal/record-live.js`, `record-live.css` | "Start recording" (mounted by Script Studio at the end of `portal/studio-page.js`: card `#ss-rec`; saved file → `loadFile(file, 1 or 2)`, `SS.recordSecond` for the second recording; "Not set up yet?" → `onHow` opens the How to record guide): `PerfxRecordLive.mount({host, chips, isIdle, before, after, onSaved, onHow, subtitle})` draws the window (`#lv-dlg`) and the live view (`#rl-live`, classes `rl-*`), `PerfxRecordLive.open()`. Drives the CDP Recorder on localhost:8787 — `perfx-recorder:` link when it is not running (or older than 0.2.1), `POST /api/ask` (Allow on its toolbar) when it runs without this page — BUG-119, `POST /api/session`, polls `/api/status` + `/api/live`, transactions (one box: `fullName` numbers a typed name with `nextNum()` — after the highest number used, shown in `#lv-prefix`; optional planned steps `#lv-plan`, pref `plan`, an empty Enter starts the next; status `transactions` = the finished ones, `activeTransaction` = the running one), Stop → `/api/download` → `onSaved(new File(...))` (the dropped-file path). Prefs localStorage `perfx-rec-live`. `LATEST` = the CDP Recorder version the pages expect (keep equal to `cdp-recorder/recorder/src/version.ts`) |
| `src/web/public/portal/recorder-core.js` | The HAR reading engine's transactions and filters (detectMarkers, _recInjectPagerefMarkers, _makeRecMarker, classifyHarEntry, refresh, `applyFilters`, `recLeftOut(e, flags)` (reason code per request → `e.leftOut`), `recTypeKey(e)`, `recFilterFlags()`, `_repairOrphanEnds()`), with `VuGen-Recorder-state.js` (S, STATIC_CT, NOISY …) and `VuGen-Recorder-parsers.js` (processHAR). Used by the HAR Explorer (`portal/har-explorer-model.js`); Script Studio follows the same rules through `shared/request-filter.js` (`tests/unit/harExplorerModel.test.js`, `requestFilter.test.js`; on recordings `regression-tests/tools/audit/hx-parity.js`) |
| `src/web/public/shared/host-params.js` | Server parameters (UMD `HostParams`, loaded by both Studio pages and required by both converters): `plan(entries, scripted, renames, reserved)` → `{main, keys, map, list}` — every server of the scripted requests (+ non-cookie header values), main = first page load, names by role (`App_Server`, `Api_Server`, `Auth_Server`, `Static_Server`, known services `KNOWN`, else `<Org>_Server`; `defaultNames(keys, {paths})`); `validName`, `hostKey`. The generators read `S.hostParams` (set in `buildScripts`): VuGen `set_server` in vuser_init, DevWeb `const`, `_subHosts` (studio-codegen.js) substitutes `https://`, `https:\/\/` and `https%3A%2F%2F` forms — in URLs, headers, form values and bodies (BUG-146) (`tests/unit/hostParams.test.js`, `studioServerParams.test.js`) |

The Recorder page and its generators were removed (one generator: Studio's — `tests/unit/studioServerParams.test.js` holds what the Recorder's generator tests checked). `/recorder` and `/converter/recorder` redirect (301) to Studio;
the shell maps `record` → `studio`, `#/record` → `#/studio`, `#/help/recorder` → `#/help/studio`; `switchPortalTab('recorder')` opens Studio.
Usage statistics keep the key `recorder`: Studio pings it once per recording made with Start recording (`mode: "cdp"`); opening a recording pings `studio`.
The classic page `VuGen-Script-Studio.html` has no route (one address for the whole app); it stays on disk only as the
reference for the parity tests. The address bar must only ever show …/converter/.

### Help & guides (portal v3 redesign)
| File | Purpose |
|------|---------|
| `src/web/views/partials/help.ejs` | Help markup + its inline functions (haccToggle, haccJump, hTocToggle, hTocSetCur, hfaqToggle) — keep every word; 14 sections hacc-* |
| `src/web/public/portal/help.js` | Search ("/" shortcut), section list built into the portal sidebar (`#sb-help-nav` in shell.ejs; fold = click Help again, localStorage `perfx-help-nav`) + where-you-are by scroll position, sticky bar height → `--help-sticky-h`; reading mode: ONE section at a time (class `help-reader`, current section `.cur`, Previous / Next, last section in localStorage `perfx-help-section`), search lists all matches (`help-searching`) |
| `src/web/public/portal/help.css` | Styles, scoped to `body.has-shell #portal-help` |

Rule: `tests/unit/helpPageParity.test.js` must pass; check text parity with the Help capture
(`regression-tests/tools/help/capture.js` + `diff.js`, word-level diff against the previous Help).

### Converter panels (portal v3 redesign)
| File | Purpose |
|------|---------|
| `src/web/views/partials/converter.ejs` | Postman / Bruno + JMeter panel markup (included by index.ejs). Keeps every id / handler the converter functions in index.ejs use (setProto, doConvert, doConvertJmx …) |
| `src/web/public/portal/converter.css` | Styles, scoped to `body.has-shell #portal-converter` |
| `src/web/public/portal/converter.js` | Keyboard on protocol cards (aria-checked), "How it works" fold remembered (localStorage `perfx-cv-how`) |

Rule: `tests/unit/converterPageParity.test.js` must pass; check output parity with the converter golden
harness (`regression-tests/tools/converter/`; the server rate-limits /convert to 60 per 5 min per address — the
harness sends a different `X-Forwarded-For` per run).

### Script Studio page (one workspace, redesign step 2 — plan: Docs/redesign/plan.md) — served at /studio
| File | Purpose |
|------|---------|
| `src/web/public/Studio.html` | Start screen (`#ph-upload`: Record in a browser, Open a recording `#dz1`, format, How it works, How to record your journey `#ss-guide` — the Recorder page's guide with both ways and the bookmarks, folded at first, tab pref `method`) and workspace (`#ph-res`: file bar, notices, filter bar, Domains · Requests · right panel with Script / Correlation Advisor / Test data tabs); `#ph-proc` is an overlay while a file is read. Loads the classic Studio scripts UNCHANGED, in the same order; keeps every element id they use (`#ss-engine` holds the ones with no place on the page — never shown). The second recording (`#dz2`) is in the Advisor tab, "Advanced: second recording". Dialogs: `#ss-txn-dlg` (new / rename transaction), `#ss-bg-dlg` (holds `#bgReviewPanel`), `#ss-ask`; menu `#ss-ready` |
| `src/web/public/portal/studio.css` | Classic tokens → portal palette, the purple brand (as the Workload Modeller), the engine-drawn panels, and the start / workspace layout (panels sized by the screen; under 1100 px they stack) |
| `src/web/public/portal/studio-page.js` | `window.SS`. A file is read as soon as it is opened (wraps `markLoaded`; no Analyse button). `analyze()` is wrapped: one reading at a time; a call during one asks for one more reading after it; every caller gets a promise that settles when the page is idle (HAR Explorer hand-off, harness). Views follow the engine phases (`body.ss-view-home` / `ss-view-ws` / `ss-reading`). File bar, format switch (regenerates, no new reading), Download ZIP + "Ready to download?" (never blocks), notices, tabs, background-requests dialog (opened when the engine stops for it; closing keeps the defaults), dialog focus / keyboard for engine-drawn controls, script colouring, prefs `perfx-studio-ui`, format `perfx-studio-fmt`, Start recording mount (`SS.recordSecond` for the second recording), drop anywhere, `window.PerfxStudio.state()` = Studio's `S` (a const — NOT `window.S`; BUG-112) |
| `src/web/public/portal/studio-workspace.js` | `window.SSW`: filter bar (type chips with counts through the engine's `studioToggleRt` / `studioInitFilters`; Leave out `S.leaveOut = {ads, options}`; Background), Domains (in the script / left out, server parameter + Rename, a warning before leaving out a needed domain), Requests (one virtual list grouped by transaction, left-out requests behind one line per group, Show left-out, fold, address filter, tick + New transaction, Rename / Ungroup with Undo), panels hidden to rails and resized; request details `#ss-det` (`RequestDetails`): a click on a request (not while ticking) or Enter opens it, below the file bar; previous / next and the list's arrow keys move it; Esc closes; Hide secrets (pref `mask`); docked as a fourth panel at 2400 px and wider (`body.ss-dock`); the raw HAR entry is found by request id (NetLog: built from the parsed request). Its own tab **Dynamic values** (`RequestDetails.html` option `extra`): `advGetRequestFields` for that request; the source is the field's trace or else the Advisor card's for the same value; Add → `riAddCorrFromTrace`, Paste & Detect → `riOpenPasteForField` (the Inspector's functions, `_riFields` set first). The Advisor tab's `#adv-inspector` is hidden on this page (kept for the engine and the harness). Every change goes through the engine state, then `analyze()` again; it asks first when applied correlations would be lost |
| `src/web/public/portal/request-details.js`, `request-details.css` | UMD `RequestDetails`: ONE request-details view for the HAR Explorer and Script Studio — summary line, Copy URL / Copy as cURL (`copy`), tabs Headers · Payload · Response · Preview (sandboxed, CSP blocks every outside request) · Cookies · Timing, Hide secrets, "Show all" over 300 000 characters (`html(o)`). Moved unchanged from har-explorer.js (proof: the Explorer's details HTML for every tab of 996 request views identical). The "left out" note is `.hx-left` (`.hx-why` is the Explorer's start-page panel). `tests/unit/requestDetails.test.js` |
| `src/web/public/portal/find-value.js`, `find-value.css` | UMD `FindValue`: the answer of Find a value, shared by the HAR Explorer and Script Studio — `VERDICT` (kind → style, title, text(inv, num)), `html(inv, {num, link, studio, corr})`, `tabFor(h)`. Moved unchanged from har-explorer.js (proof: 126 Explorer answers identical). Studio (studio-workspace.js `openFind`, `SSW.openFind`): the same worker (`portal/har-explorer-worker.js`, `load` + `studioList` from `S.advisorCandidates` with `by: "studio"`), file number n ↔ Studio id through `maps()`, "Correlate this" → `advisorAddManual` + `_explorer` + `advisorApplyAndRegen` (Add and apply); the worker reloads only when the reading or the Advisor's findings change. `tests/unit/findValue.test.js` |
| `src/web/public/portal/studio-testdata.js` | UMD `TestData` (`apply`, `usagesOf`, `nameError`) + the Test data tab: edits by the parameter's first name (`by[orig] = {name, removed, take, update, file, rows}`, `added[]`), applied by `studioAfterParams` (called by `analyze()` after all parameters are known) and again on each change (`regenerateFromAdvisor({quiet:true})`). Generators (studio-codegen.js): `p.take` / `p.update` / `p.file` / `p.rows` → `.prm` (SelectNextRow, GenerateNewVal, Table), `parameters.yml` (nextRow, nextValue, fileName), `genParamDataFiles()` (one file per group, shared `collection_data` first; `genCollectionDataCsv` = the shared one); dlZip writes each file; `.usr` metadata lists them. Defaults = the files as before. Excel via `ra/vendor/exceljs.min.js` (loaded on first use). `tests/unit/studioTestData.test.js` |
| `src/web/public/portal/brand.css` | The purple brand of the Create-scripts tools (Script Studio, HAR Explorer): the `--ds-*` accent tokens for both themes plus `--br-head` / `--br-zebra` / `--br-sel`; loaded right after `portal/ds.css` |
| `src/web/public/portal/studio-txn.js` | UMD `StudioTxn`: the user's transactions as operations by request id (create / rename / ungroup), replayed by `studioAfterMarkers` (called by `analyze()` after `detectMarkers`); markers shaped as the engine's own; `S.txns` in journey order. `tests/unit/studioTxn.test.js` |
| `src/web/public/portal/frame-guard.js` | One address: a tool page (`<html data-portal-tool=record|explore|studio|workload|results>`) opened on its own goes to …/converter/ and the shell opens that tool (sessionStorage `perfx-open`); skipped for automated test browsers (`navigator.webdriver`) |

Rule: `tests/unit/studioPageParity.test.js` must pass; check output parity with the golden harness
(`regression-tests/tools/studio/harness.js` + `compare.js`): script and ZIP files identical; the harness drives the page
through its global functions, so a step captured right after opening a file shows the reading (`ph-proc`).
Usage ping `studio`: once per opened recording (`S._usageSent`, reset by `loadFile` slot 1), not per reading; when a newer reading is queued the ping waits for it (the counts are those of the last reading).
The server blocks direct `.html` URLs on purpose — pages are reached through routes only.

### HAR Explorer (Create scripts, after Script Studio — plan: Docs/archive/plans/HAR-EXPLORER-PLAN.md, illustrated guide: Docs/user/HAR-EXPLORER-GUIDE.html)
| File | Purpose |
|------|---------|
| `src/web/public/HarExplorer.html` | The page (`data-portal-tool="explore"`), route `/har-explorer` + `/converter/har-explorer`; portal tab `explorer`, shell page `explore`, colour `--c-explore`, theme key `hx-theme` |
| `src/web/public/portal/har-explorer-model.js` | `hxBuild(har)` → `{groups, items, source}`: the HAR reading engine — the page loads `VuGen-Recorder-state.js`, `VuGen-Recorder-parsers.js`, `portal/recorder-core.js` UNCHANGED, calls `processHAR()` + `_repairOrphanEnds()` (its drawing steps are no-ops here). `tests/unit/harExplorerModel.test.js` checks groups / left-out = the engine's |
| `src/web/public/portal/har-explorer-worker.js` | Find a value, in a Web Worker (importScripts `shared/request-filter.js`, then the Studio engine UNCHANGED: constants, correlation, studio-advisor — they cannot share the page with the HAR reading engine, same global names). Messages: `load {text, out}` → `ready` (own suggestions), `find {id, value}` → `found` (verdict kinds: correlate, cookie, redirect, outonly, unused, input, generated, missing, none; trail; forms for highlighting); a SECOND copy gets `studio {text}` → Studio's findings → page forwards `studioList` → `ready` with Studio's first. Referer / Origin and left-out requests are not uses. Also loads `shared/vugen-codegen.js` + `studio-codegen.js`: `correlation()` builds `{name, extractorType, extractorConfig}` (jsonpath / html / cookie / boundary_header / boundary — boundaries widened until the FIRST match is the value — `_advFirstMatch` / `_advSafeBoundaries` in studio-advisor.js, shared with Paste & Detect) and the code via Studio's `webHttpCorrCode` / `devwebExtractorDecl`; `uses` in Studio's usage form. `tests/unit/harExplorerFind.test.js` (incl. agreement + round trip through Studio) |
| `src/web/public/portal/har-explorer.{js,css}` | Details through `portal/request-details.js`; the request list hides to a rail (`#hx-hide` / `#hx-rail`, a click on its header bar too; pref `noList`). Start page, workspace (file bar = band as in Studio, filters — address, Domains (`initDomains`: host per request by splitting the address, `M.hostOn`; `#hx-dom-pop` is docked as a left panel `#hx-dompane` at 1250 px and wider (`dockDomains`, class `docked`, never closes), else a popover that closes on pointerdown outside), types —, request list — only the rows on screen are drawn — and details: Headers, Payload, Response, Preview, Cookies, Timing; Hide secrets, Copy URL / cURL), theme hooks, prefs localStorage `hx-ui` (listW, showOut). All 6 steps of the plan done; Help section `hacc-explorer`; usage ping `tool: "explorer"` (portal/track.js) per opened file |

Hand-off "Continue in Script Studio" (har-explorer.js): `clearAll` → `setFmt` → `loadFile` → `analyze()` → (after the background review, if any) — requests named by Studio's request id (`parseHar` id, never shifts; resolved to the current `S.entries1` index — Studio inserts markers: CDP pages, BUG-113 repair) → `advisorAddManual` per value with `cand._explorer = {extractorType, extractorConfig}` + the Explorer's uses → `advisorApplyAndRegen()`. `studio-advisor.js advisorToCorrelation` honours `_explorer` (else unchanged); `studio-ui.js` labels it "From HAR Explorer".
Rule: reuse, never copy — transactions / left-out from `portal/recorder-core.js`, suggestions and boundaries from `studio-advisor.js` (Advisor agreement test planned).
Parity check on recordings: `regression-tests/tools/audit/hx-parity.js <files>` (each file through the Script Studio screen and the Explorer screen, every request's transaction + left-out compared); screen walk-through `hx-ui.js` in the same folder.

### CDP Recorder (browser recording — replaces the retired PerfX extension)
| File | Purpose |
|------|---------|
| `cdp-recorder/recorder/src/recorder.ts` | Session orchestrator — browser process + CDP connection, start/stop/transactions |
| `cdp-recorder/recorder/src/cdp-capture.ts` | CDP Network capture via `Target.setAutoAttach` (new tabs/popups paused before they run) |
| `cdp-recorder/recorder/src/har-builder.js` | HAR 1.2 assembler with `_perfx_*` fields, pendingBodyFetches (unit-tested by `tests/unit/harBuilder.test.js`) |
| `cdp-recorder/recorder/src/bg-detector.js` | Background-traffic classifier (CoV frequency analysis + known path patterns + burst grouping) |
| `cdp-recorder/recorder/src/url-normalizer.js` | URL normalisation for bg-detector (cache-busters, UUIDs, numeric ids) |
| `cdp-recorder/recorder/src/server.ts` | Local control server (127.0.0.1:8787): toolbar page + API; who may call — toolbar, local programs, portal origins from the link; other pages get the bare status (BUG-114). Portal API: `/api/session`, `/api/live`, `/api/windows` (after a page-started recording is saved: windows close after 10 s; keep / close), `/api/allow`. Toolbar (`control-page.html`): questions are in-toolbar cards (no prompt/confirm — BUG-117). A recorder started by hand: an unknown page `POST /api/ask` → toolbar Allow / Don't allow (`createAskQueue` in portal-mode.js; `/api/ask/answer` toolbar only) → remembered in `%LOCALAPPDATA%\PerfX\cdp-recorder\allowed-pages.json` (`loadAllowedPages` / `saveAllowedPages` in portal-link.ts) — BUG-119; the toolbar polls `/api/status?toolbar=1` (`toolbarOpen()`, never two toolbars) |
| `cdp-recorder/recorder/src/app.ts` | Start-up shared by `src/main.ts` and `pkg-prototype/entry.ts`: classic (double-click) or portal mode (`--portal <perfx-recorder: link>`: waits for the PerfX Studio page, saves to Downloads, 1 h idle exit; a link while one runs only hands its page over) |
| `cdp-recorder/recorder/src/portal-link.ts`, `portal-mode.js` | HKCU `perfx-recorder` link registration (every packaged start), Downloads folder; pure helpers (`tests/unit/cdpPortalMode.test.js`), incl. the transaction names (`txName`, `nextTxNumber`, `planSteps`, `nextPlanned` — the same rules as record-live.js `fullName` / `nextNum`: keep the two in step). Server (0.2.2): `/api/tx/start` with `auto: true` numbers the name (an empty one takes the next planned step), a running transaction ends first (`endActive`, BUG-145), status `nextTx`, session `plan`. Manual tests: `tests-manual/portal-session.mjs`, `packaged-link.mjs`, `private-window-probe.mjs`, `repro-multi-tx.mjs` (port 8799), `packaged-classic.mjs` (8795) |

**Distribution**: `GET /downloads/cdp-recorder` (server.js) serves the pre-built `dist/cdp-recorder.zip`/`.exe`; home page banner "Get CDP Recorder".
HAR pages[]/pageref → synthetic isMarker entries injected by `_injectPagerefMarkers` in both Studio and the HAR reading engine's detectMarkers().
The PerfX Chrome/Edge extension (`perfx-recorder-extension/`) was removed from the repo and its history — do not recreate it.

### Workload Modeller (separate module — plan: workload-modeller/docs/IMPLEMENTATION-PLAN.md)
| File | Purpose |
|------|---------|
| `workload-modeller/engine/workload-engine.js` | UMD `WorkloadEngine.model(input)` — every formula (TPS = Vusers × T ÷ pacing; auto pacing with headroom; ramp; schedule simulation; load generators with CPU and memory added up apart; checks with `gid` + `field`); `packPool` assigns scripts to machines → `res.machines` (LG1 …) and each group's `lgs` |
| `workload-modeller/engine/settings.js`, `workload-modeller/config/workload-settings.json` | Team settings: the JSON file (machine types + Vusers per machine, LG limits, schedule defaults, protocol assumptions) is edited on the server, served at `wm/config/` with no-cache, checked by `WorkloadSettings.read` (wrong values keep the built-in ones and are named on the page); `DEFAULTS` must equal the shipped file (`tests/settings.test.js`) |
| `workload-modeller/engine/script-reader.js` | UMD `ScriptReader.readFiles(files)` — script ZIPs (VuGen C, DevWeb) and HAR: transactions per iteration (init / end listed, nested listed), think time, requests; needs the Analyser's `web/zip.js` |
| `workload-modeller/web/index.html` | Page (`data-portal-tool="workload"`), route `/workload-modeller` + `/converter/…`; loads `portal/ds.css`, `wm/app.css`, the engine, `ra/zip.js`, the reader, `wm/app.js` → `wm/excel.js` → `wm/page.js` (classic scripts sharing globals, in this order), `portal/track.js` |
| `workload-modeller/web/app.js` | State `state.groups`, inputs (test, cards, Table view, load generators — machine types `LG_TYPES` from the team settings file (`config/workload-settings.json` — edit the file, not the code, when the machines change)), results (summary, tiles, chart, phases, checks, details); `formulas(sc)` = "All the formulas" — keep in step with the engine and `docs/USER-GUIDE.md` §6 |
| `workload-modeller/web/excel.js` | Results workbook + scripts sheet (download / read back); ExcelJS from `ra/vendor/exceljs.min.js` on first use (`loadExcel`); usage ping `used(mode)` |
| `workload-modeller/web/page.js` | Simple / Detailed, theme (`wm-theme`, `lrePortalInit` / `lreSetTheme`), folding, Find / filter, Overwrite all scripts, Paste from Excel (`matchScript`: never a guess), Defaults, Fill from scripts, Undo (`clearWith`, `toast(msg, canUndo)`) |
| `workload-modeller/tests/*.test.js` | Engine, review fixes, script reader (Jest) |

Server: `/workload-modeller` page + static `/wm`, `/wm/engine` (also under `/converter`). Portal tab / shell page `workload`, colour `--c-work`, Help `hacc-workload`.
Rule: every edit goes through `setKey` + `calc` (cards and table share `state.groups`); nothing is sent to the server except the usage ping (feature + count).

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

### VuGen version — project files every tool writes (both protocols)
| File | Purpose |
|------|---------|
| `vugen-reference/<version>/DevWeb/`, `/qtweb/` | VuGen's own templates, copied UNCHANGED from `<VuGen install>\template\` (never recorded scripts: they hold browser data) |
| `vugen-reference/version.json` | `current` (e.g. 26.3) and `usrVersion` (26.3.0.0) — the version all four tools write into `.usr` |
| `vugen-reference/compare.js` | `node vugen-reference/compare.js <old> <new>` lists added / removed / changed settings per file; its helpers are used by the test |
| `tests/unit/vugenReference.test.js` | Every tool (DevWeb + VuGen converters, Script Studio) against the reference: every template setting present in rts.yml / default.cfg / default.usp / .usr (values are the tool's choice; deliberate gaps in `DECIDED`), `.usr` version, tsconfig compiler options, and every DevWebSdk.d.ts copy equal to the reference |

Where the version-dependent text lives (change all together; the test fails otherwise):
rts.yml — `src/generators/devweb/filesGenerator.js` (`generateRtsYml`) and `VuGen-Script-Studio-constants.js` (`DEVWEB_RTS_YML`).
`.usr` — both converter `filesGenerator.js`, `studio-codegen.js` (`genUsrFile`, `genDevWebUsrFile`).
DevWebSdk.d.ts — ONE copy, `src/web/public/DevWebSdk.d.ts`: the converters copy it (`copySdk` in the DevWeb `filesGenerator.js`), Script Studio fetches it from the server next to its page (a warning toast when it cannot be loaded). Never add another copy.
DevWeb 26.3 (DevWeb.exe run directly) refuses an rts.yml without `network.ipVersion` — BUG-129.

### Generated script layout — same rules in Script Studio and both converters
- vuser_init: `set_server(name, value)` for the servers the script USES (Runtime Settings attribute with that name wins),
  `web_set_sockets_option("SSL_VERSION","AUTO")`, `web_add_auto_header` for headers on EVERY request with ONE value.
  Never global: authorization, proxy-authorization, cookie, dpop(-pf), origin, access-control-request-*, *csrf*/*xsrf*.
  `web_set_user` is in Action in all tools (converter NTLM / Kerberos too; collection-level auth is inherited).
  Its host (and DevWeb `setUserCredentials`' host) is the server key `HostParams.hostKey`: `host:port` only on a port other than
  80 / 443 (VuGen and DevWeb 26.3 match nothing else; DevWeb never matches `host:443`) — BUG-130. VuGen NTLM: never
  `OverrideNTLMCreds=1` (with `UseNativeNTLM=1` the engine signs in as its Windows account — BUG-131); `WebRecorderVersion`
  must be in `default.cfg` (without it VuGen answers NTLM with Basic — BUG-132). The user for VuGen NTLM is `DOMAIN\user`.
  Only servers the finished script writes are declared (`HostParams.usedKeys`; Studio reads `S._stActionC`).
- Action: a pointer comment, `lre-utils.js` reloaded at the top when DPoP/PKCE/JWT is used (VuGen empties its JS
  engine every new-user iteration — BUG-092), one DPoP proof right before each request (htu = URL as sent, via
  `LR.getParam`; `ath` only when the request presents a token), think time between steps but not after the last,
  `Mode=HTTP` except page loads, 4-space indentation. DevWeb: `const App_Server = load.config.user.args["App_Server"] || 'host';`
  (user argument wins — checked with DevWeb, module level is fine), lower-case header names, `load.thinkTime`.
- Left out in Studio (and the HAR Explorer): browser prefetch of a page later opened (`recPrefetchDuplicates`), analytics / ads by
  server (`NOISY`, the SAME list in `VuGen-Recorder-state.js` and `VuGen-Script-Studio-constants.js`) and by path
  (`NOISY_URL`: Google `/ads/`, `/pagead/`).
- Studio: server rename in "Parameterization details" (`openHostRename` / `confirmHostRename` in studio-ui.js,
  dialog `#host-modal-overlay` in Studio.html, registered in portal/studio-page.js) → `S.hostNames` → `regenerateFromAdvisor({quiet:true})`.
- XPath: converter correlations from `xml2Json(...)` are XPath; DevWeb gets plain names (`/a/b` — no `local-name()`
  support), VuGen gets `local-name()` (namespace-aware) via `_vugenXpath`. A script's explicit extractor kind wins over
  the name-guessed type in VuGen.
- Converter VuGen: auto headers live in `this._autoHeaderBlock` (written into vuser_init) — `generate()` scans it for
  undeclared `{params}` too; `tidyC` collapses blank-line runs.
- Proof: `regression-tests/tools/engines/` — `mockproxy.js` (TLS test proxy, HAR replay, DPoP verifier), `runvugen.js` /
  `rundevweb.js` (real engines), `wirediff.js`, `withkeys.js` (throwaway key + cert for the sample collections),
  `convwire.sh` / `studiowire.sh`. Compare old vs new on the wire before changing generated code.

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
| `boundary_header` | `devwebHeaderExtractorDecl`: `new load.BoundaryExtractor(name, {leftBoundary, rightBoundary, scope: load.ExtractorScope.Headers})`, right boundary `""` when the stored one is a line ending (the engine reads each header with no line ending); a query value by `RegexpExtractor` (the engine sorts a followed `Location` query) — BUG-125 | `web_reg_save_param(LB/IC=..., RB=..., Search=Headers)` (`LB/IC` when the left boundary starts with a header name); a query value by `web_reg_save_param_regexp(..., SEARCH_FILTERS, "Scope=Headers", LAST)` — BUG-126, BUG-127 |
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
| studio-advisor.js | `_advCsrfScan()` | Phase 2.5: detect CSRF tokens by field NAME (`_CSRF_FIELD_RE`, 14 patterns); backward-scans all preceding responses (including HTML); the extractor is a boundary read from that page (`_extract`, BUG-143) |
| studio-advisor.js | `_advHiddenFieldScan()` | Phase 2.6: form fields whose value the nearest earlier page sent in an HTML hidden input, under any name; generated-looking values only (BUG-141) |
| studio-advisor.js | `_advHtmlValueExtractor()` | Boundary for a value in an HTML / text response, read from the page (`name="x" value="` … `"`) and widened until its first match is the value; used by Phases 2.5 and 2.6 |
| studio-advisor.js | `_advPatternScan()` | Phase 3: JWT/UUID pattern detection |
| studio-advisor.js | `_advMergeArrayCandidates()` | F1: merge array siblings → SelectAll |
| studio-advisor.js | `_advDetectArrayGroups()` | F2: detect array reconstruction |
| studio-advisor.js | `advisorToCorrelation()` | Convert candidate → S.correlations entry |
| studio-advisor.js | `advisorAddManual()` | Manual correlation via field browser |
| studio-ui.js | `renderAdvisorPanel()` | Render candidate cards |
| studio-ui.js | `_advCardHtml()` | HTML for one candidate card: **Source** / **Replaced in** as "#id METHOD /path" (`_advReqLink`, `_advWhere`; a click → `advisorOpenRequest` → `SSW.openDetails`), "+n more" → `advisorShowUses` (dialog `#adv-uses-dlg`, every place) |
| studio-ui.js | `advisorAcceptAllHigh()` | "Accept all high (n)" in the footer (`#adv-btn-allhigh`, added by `_advUpdateFooter`) |
| studio-ui.js | `openAdvisorModal()` | Open Add Manual modal |
| studio-ui.js | `advisorApplyAndRegen()` | Accept candidates + regenerate |
| studio-ui.js | `submitPasteCorrelate()` | Paste & Detect → an Advisor card via `advisorAddManual` + `_paste` (exact extractor), applied at once; source `_pcFindSource`, safe boundary `_pcSafeOccurrences`; names via `_advSafeVarName` |

## Session-End Checklist (run after EVERY code change session)
- [ ] Impact analysis was done for any non-trivial change (see `DEVELOPMENT-RULES.md`)
- [ ] `node --check` on all modified .js files
- [ ] Unit tests written/updated for new or changed functions
- [ ] Update `BUGS.md` at the repo root (mark fixed, add discovered)
- [ ] Update `memory/state.md`
- [ ] Update `Docs/CORRELATION-LOGIC-EXPLAINED.md` if correlation logic changed
- [ ] Commit and push only when the user asks
- [ ] No `console.error` or unhandled exceptions in modified code paths

## CSS / Design System
**`src/web/public/portal/ds.css` is the design system (v4)** — tokens `--ds-*` for both themes and shared
components `ds-btn`, `ds-card`, `ds-chip`, `ds-tile`, `ds-seg`, `ds-tabs`, `ds-panel`, `ds-table`, `ds-code`,
`ds-drop`, `ds-note`, and (v5) the tool header band `ds-band` (soft blue, edge to edge; `ds-band-title` icon tile + h1,
`ds-band-lead`, `ds-flow` three-step picture with `is-tool`, `ds-hand` handwritten caption; the page sets `--band-top` = its top
padding) — the Home page's look on every tool page. Every tool uses the panel layout `ds-band-panel` (tool name + `ds-band-tag`
tagline, short lead, the picture in a soft panel, the note in a tilted card; in the portal, converter.css / help.css narrow the
breakpoints with their container width because the window width includes the sidebar). Loaded first by index.ejs, Studio.html, HarExplorer.html and the Results Analyser page; the
portal's older tokens (`--bg`, `--text`, `--glass` …) are mapped onto it in shell.css. Pilot: the Workload Modeller overrides the brand to purple with solid section boxes (block at the end of `workload-modeller/web/app.css`) — the other tools follow after review; until then the rules below say blue. Rules: one brand blue for
actions (one primary button per area), tool colours only on icons, sentence case, pages use the full width
beside the sidebar (`--ds-page-max: 100%`), no emoji in the interface (SVG line icons).
The admin pages use it too: `src/web/views/admin.ejs` links `portal/ds.css` (prefix from `adminBase`); the sign-in page
(`adminLoginHtml()` in server.js) carries the same tokens inline. Admin reports: `src/analytics/exporters/{xlsx,docx}.js`.
Portal design rules (checked by the design audit — `regression-tests/tools/audit/audit.js`, every section, both themes):
- One text font (system: Segoe UI on Windows) + one code font (Cascadia Code / Consolas); no web-font requests.
  One agreed exception: the Home picture caption uses Windows' handwriting font (Segoe Print — installed, not downloaded).
- Font weights 400 / 600 / 700 ONLY. Segoe UI has no 500/650/750/800/850 face — 750+ renders as Segoe UI Black (blocky).
  `b, strong { font-weight: 700 }` everywhere (the default "bolder" turns bold-in-bold into 900). Controls inherit the font.
- Text contrast ≥ 4.5:1 in both themes (muted text: dark #8191ab, light #56677f; light-theme blue #2563eb;
  white text only on deep colours — tool colour mixed ~58% with black).
- Shapes: cards / panels 16px, tiles 12px, buttons 10px (small 9px, large 12px).
The classic Studio stylesheet `VuGen-Script-Studio.css` has its own tokens in `:root`; `portal/studio.css` maps them onto the portal palette.
Key token groups there: `--bg-*`, `--text-*`, `--accent-*`, `--border-*`, `--radius-*`, `--shadow-*`
Component naming: `.adv-*` (advisor), `.corr-*` (correlations), `.param-*` (parameters), `.studio-*` (main studio).
Theme: `data-theme="dark|light"` on `<html>`; dark is the default.

## Auto-maintenance Conventions
- **`Docs/` is local-only** (in `.gitignore`, removed from GitHub history) — never `git add -f` it.
- **After bug fix**: move the row in `BUGS.md` (repo root) to "Fixed — not released yet" with the cause and fix; add an entry to `CHANGELOG.md`
- **After new feature**: Add one-liner to relevant section in `Docs/FUNCTIONAL-SPEC.md`; add an entry to `CHANGELOG.md`
- **After correlation change**: Update `Docs/CORRELATION-LOGIC-EXPLAINED.md`
- **Always**: Update `memory/state.md` with current feature status
- **CHANGELOG.md**: at the project root, newest first. New entries go under "Not released yet" in their area (Portal, Performance, Results Analyser, CDP Recorder, Script generation, Recorder and Script Studio, Server) as a `####` heading; at release time they move under the version. Never summarise away old entries. When it exceeds ~1 year of entries, move older versions to `CHANGELOG-ARCHIVE.md`.
- **BUGS.md**: sections Open bugs · Known limitations · Fixed — not released yet · Fixed in released versions (by version) · Performance · Refactors · Process improvements. When the fixed list grows very long, move old versions to `BUGS-ARCHIVE.md` (repo root).
- **Generic wording in every file**: never write company or client names, internal host names, user names, local folder paths, the GitHub account, repository name or URL, branch names, or commit IDs into documents, code comments, tests or commit messages — use `example.com` style names, and refer to a version number or describe the change. No `---` divider lines in documents.

## Known Governance Gaps (track, don't ignore)
- **`processField()` untested** — inner closure of `genParamSuggestions()` in `studio-codegen.js`; not directly accessible. Requires refactoring to export or testing via `genParamSuggestions()`. Lowest-priority remaining gap.
- **`/regression-tests/` has no pipeline cases yet** — `run-all.sh` is a skeleton with no expected outputs captured. Old-against-new comparison is done with `regression-tests/tools/` (see its README).
- **No route-registration tests for `server.js`** — BUG-EXT-013 (POST /convert, /convert-jmx, GET /recorder, /studio missing their bare-root registration) shipped and reached a user before being caught, because nothing exercises Express route matching. Needs a `supertest`-based harness that boots the app and asserts each route responds at both `/` and `/converter`. Not yet implemented.
