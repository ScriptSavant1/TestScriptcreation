# Changelog — PerfX Studio

All notable changes, newest first. "Not released yet" lists changes in the current code that are not yet in a numbered release; within it, changes are grouped by area.

## Not released yet

### Portal and user interface

#### Changed — Every tool in the Home page's look

- Cross-check of every page (measured, both themes, 1366–2560): the header band is identical on every tool — title
  28px, tagline 17px, the picture panel in the same place, the note card one width, 22px to the first card; Home's
  welcome text starts on the same line as the cards on wide screens. Labels in sentence case (converter result,
  buttons, How it works, Studio's Start over / Recording warning / Download both) and one spelling: Analyse
  (Studio's button, the converter steps, three Help mentions). Generated scripts unchanged (only these labels differ
  in the golden harnesses).

- A shared header band for every tool page (in the design system): soft blue across the page, the tool's icon,
  a large title, one line about the tool, and a three-step picture (e.g. Browser recording → Recorder → VuGen / DevWeb
  script) with a handwritten note. On a phone it becomes a card. Final layout (as agreed on Script Studio): tool name
  with its tagline, a short lead, the picture in its own soft panel, the note in a tilted card at the far right.
- Every tool page now has it: Recorder ("Recorder — Turn a browser recording into a LoadRunner script"), Script
  Studio, Postman / Bruno ("Turn an API collection into a load test script"), JMeter ("Move a JMeter test plan to
  LoadRunner"), Results Analyser ("Analyse a LoadRunner Enterprise run") and Help (title and intro unchanged; the
  picture shows Quick start → Tool guides → Reference & FAQ, the note "Press / to search any time").
- Converters: step numbers in the tool's colour, stronger step titles, tinted drop areas. Results Analyser: tinted
  drop area, stronger headings. Output unchanged — converter golden harness (the only differences are the server
  names by role from the script-layout change), Help text capture (every word kept, 13/13 jumps), design audit clean.
- Recorder: the header band; a larger, tinted drop area; step numbers in the Recorder's colour; in the workspace the
  file bar in the band style and stronger pane titles. Nothing else changed — the generated scripts are byte for byte
  the same on every recording checked; design audit clean in both themes.
- Script Studio: the header band ("Script Studio — Turn a recording into a script that replays for many users";
  HAR recording → Analyse & Correlate → VuGen script in a soft panel, the note in a tilted card) and a four-step bar
  along the bottom of the band — Add recordings, Configure,
  Analyse, Download — that follows where you are (current step highlighted, finished steps ticked; on the results
  screen it sits at the top). Display only: it changes nothing. Tinted drop areas, stronger headings, sentence-case
  titles. Generated scripts byte for byte the same (Studio golden harness, real and synthetic recordings).
- NetLog (chrome://net-export/) is no longer offered: the Recorder and Script Studio drop areas, steps, file boxes,
  drop hints and Help talk about .har files only. (A NetLog file still loads if someone has one; its own notes remain.)
- Recorder: the request list no longer shrinks to a sliver on smaller or zoomed screens (BUG-110); slim scrollbars
  without arrow buttons everywhere (the panes' rounded corners cut the arrows off).

#### Changed — A new Home page

- Clients and colleagues found the Home page heavy and tutorial-like. The new Home follows the design the team chose:
  - **Welcome** band across the page — "Welcome to PerfX Studio", "Turn real-world performance scenarios into
    actionable insights", *Get started* and *Which tool do I need?*, and a picture of what goes in (browser recording,
    Postman / Bruno, JMeter test plan, LRE results) and what comes out (VuGen script, performance insights, reports).
  - **Quick actions** — the five tools as cards (Open Recorder, Open Converter, Open JMeter Converter, Open Script
    Studio, Open Results Analyser); the whole card opens the tool; *View all tools* opens Help.
  - **Your workflow** — record → correlate → run in LRE → analyse, each with its tool, plus a line to the converters.
  - **Need help?** — Quick Start, Documentation, FAQ, and the privacy note "Your files are never stored".
- Removed: the long explanations (they stay in Help & guides), the "Which tool" accordion and the CDP Recorder card
  (its download is on the Recorder page and in quick search, its live state in the sidebar).
- Layout follows the window: 5 cards in a row on a laptop and wider, 3 + 2 on a tablet, one column on a phone; the
  picture shows from laptop width. Design audit clean in both themes; every button checked.

#### Added — usage statistics for the Recorder and the Results Analyser; a clearer admin report

- The Recorder (one event per recording turned into a script) and the Results Analyser (one event per analysis, and
  failures: a folder without RawData.eve, an analysis that fails, is cancelled, or whose page is closed
  before it finishes) now record usage, like the other tools. Only file name, size, counts,
  format and duration are sent — never the recording or the results. Before, only the converters and Script Studio did.
- Admin report rethought: key figures (uses, machines, success rate, problems, most used tool); uses per day stacked by
  tool; one Tools table (uses, share, machines, success, problems, average time, DevWeb / VuGen) replacing three charts;
  Who uses it (machine, IP address, tools, success, last seen) replacing the machines table; Problems grouped by cause. The
  results doughnut (it repeated the key figures) is gone. Excel, Word and CSV follow.


#### Changed — admin usage analytics and its reports in the v4 design

- The admin dashboard and sign-in page use the portal's design system: same palette, light / dark toggle shared
  with the portal, line icons instead of emoji, sentence case, full width; charts follow the theme; the heatmap is
  days × hours; machines and files side by side; the event log scrolls inside its card. Every route, filter and
  export is unchanged. "AI-generated insights" is now "Insights" (they are worked out from the figures).
- Excel report: brand-coloured headers, real number / percentage formats, filters and frozen headers on every
  table, a new Protocols sheet. Word report: title block with key-figure tiles, real bullet lists, clean tables
  with right-aligned numbers, page numbers. Every figure is the same as before; the CSV is unchanged.


#### Changed — Help & guides: one section at a time

- Help shows one section at a time, open, like a documentation site: chosen in the sidebar list, "On this page",
  any Help link or quick search, with Previous / Next below it and its group above it. The last section read is
  remembered. Searching lists every matching section; clearing the search returns to the section being read.
- Replaces "every section expanded" and the two-column layout very wide screens got (sections out of reading
  order). Expand all / Collapse all are no longer needed and are hidden. Every word of Help is unchanged.
- File inputs no longer show the browser's "No file chosen" tooltip.

#### Added — quick search, drop a file anywhere, remembered options

- **Quick search** (Ctrl+K / ⌘K, or Search in the top bar, also while a tool page has the focus): finds any tool,
  Help section (including the text inside it), FAQ question, and the theme / menu / CDP Recorder actions;
  keyboard only (arrows, Enter, Escape). The list is read from the page, so it never goes out of date.
- **Drop a file anywhere** on the converter, Recorder and Script Studio pages: it goes to the right box (Postman:
  collection, then environment, certificates; JMeter: .jmx, .csv, certificates; Studio: the first free recording
  slot). A file dropped outside a box no longer makes the browser open it in place of the app.
- **Last-used options are remembered** per browser: converter protocol, script mode, think time, log level,
  Advanced switches and the JMeter options; the Recorder's script format; Script Studio's output format.
  A fresh browser still gets the usual defaults.

#### Fixed — Help: Results Analyser section brought up to date (BUG-084)

- Sidebar name, the six report tabs (no Validation tab), Excel 10 sheets, the HTML export, where the self-checks
  are now, and the command-line example path (its backslashes had been lost).

#### Changed — Portal redesign v4: one design system for every page

- New shared design system `portal/ds.css`, loaded by the portal and by the Recorder, Script Studio and Results
  Analyser pages: one neutral palette for both themes, one brand blue for actions (tool colours only on icons),
  sentence-case labels, shared buttons, cards, tiles, chips, fields, tabs, panels, tables, code views, drop zones
  and scroll bars. Every text colour is at least 4.5:1 in both themes.
- Every page uses the full width beside the sidebar (no centred column); start pages of the Recorder, Script
  Studio and the Results Analyser use two columns.
- Sidebar and Home follow how the tools are used: Recorder, Script Studio, Postman / Bruno, JMeter, then the
  Results Analyser. Home is grouped like the sidebar (Create scripts · Analyse results) with every card's
  description, "You need / You get" and feature list kept.
- Help opens with every section expanded; the duplicated page title is kept for screen readers only.
- Script Studio's script preview is coloured like the Recorder's. Both previews are built from text nodes, so
  Copy gives the exact script (Windows line endings were lost before when the preview was coloured).
- A client-specific machine name in Help and Home replaced by general wording ("virtual desktops").
- Generated output unchanged: converter, Recorder and Script Studio golden harnesses identical.

#### Changed — Portal redesign, round 2: use the window, one section at a time

- Each section was reviewed twice by a quality reviewer and a design reviewer; every tool's output is unchanged (golden harnesses identical).
- Help & guides: the section list lives in the left sidebar under "Help & guides" (fold by clicking it
  again, remembered) and the page uses the full width. One sticky search bar (search, "On this page" when
  the sidebar can't show the list, Expand / Collapse all); jumps land just below it. Line icons in each
  tool's colour, group headings, larger text, glossary as a two-column list, tables with row lines,
  Quick Start paths 4 / 2×2 / 1 by width, search keeps its place and shows the first result. Wording
  corrected: "Privacy & Security" (was "Technology & Privacy"), Quick Start path C mentions the CDP
  Recorder, the overview lists the Results Analyser. Every other Help word unchanged.
- Script Studio: the script preview is as tall as the window (was a fixed 520px box) and stays beside the
  review while it scrolls; "Script" only view fills the window with one scrollbar; always-visible code
  scrollbars; shorter summary tiles with line icons, download beside them on wide screens; one violet
  download button; Review / Script as one switch; calmer advisor cards, no text under 12px.
- Postman / Bruno and JMeter converters: up to 1440px wide, two columns from laptop width — steps 1–2 on
  the left, options + Convert on the right and always in view (Advanced settings below Convert); the .jmx
  box no longer stretches; compact upload boxes; line icons instead of emoji in the Convert button and
  file tags (same words); focus returns to Convert after Try Again / Convert Another; remove buttons
  named after their file.
- Recorder: start page 1440px wide; workspace file bar, filters and download bar each one line on
  laptops, so the request list and preview are taller (316 → 406px at 1366×768) and the list wider;
  no sideways scroll on phones; dialogs keep keyboard focus; tabs answer arrow keys; long names readable
  in full; "left out" rows and several labels now reach 4.5:1 contrast.
- Home: up to 1440px wide; layout follows the space beside the sidebar; shorter hero; "You need / You
  get" without nested boxes; card buttons line up; "Which tool do I need?" in two columns on wide pages;
  hero jumps land below the top bar; visible focus on the flow steps.
- Portal: sidebar fades at its edge when it scrolls; drawer closes when the window widens; favicon.
- Design rules everywhere: weights 400 / 600 / 700 only, text contrast ≥ 4.5:1, radius 16 / 12 / 10.

#### Changed — Design audit across every section (fonts, colours, shapes)

- Measured with Playwright on every section and tool, both themes: one text font and one code font everywhere,
  font weights 400 / 600 / 700 only (750 / 850 / 900 and bold-inside-bold rendered as blocky Segoe UI Black; buttons
  in Help and Studio fell back to Arial), text contrast ≥ 4.5:1 everywhere (sidebar and top-bar labels, Home buttons
  and tags, result numbers, Studio inspector, Help badges, Analyser status colours), one dark navy background for
  every tool, one shape scale (cards 16px, tiles 12px, buttons 10px). No page errors, no external requests.

#### Added — Portal redesign, step 5: Help & guides

- Search: type any word (or press "/") — only the sections and FAQ answers containing every word stay, open,
  with the words marked; Escape clears. Expand all / Collapse all.
- Two columns on wide screens: a contents list (Getting Started · Tools · Capabilities · Reference) that
  shows where you are, beside the sections; the "On this page" menu remains on narrow screens.
- Every word kept except navigation that described the old top bar (now the sidebar): Quick Start paths A–D,
  Postman / Bruno and JMeter step 1, Recorder ("Open Recorder in the sidebar and follow the Bookmarks +
  DevTools instructions"), Script Studio step 1. Checked word by word against the previous Help.
- Fixed BUG-079 / BUG-080. Markup moved to views/partials/help.ejs; portal/help.{css,js}.

#### Added — Portal redesign, step 4: Postman / Bruno and JMeter converters

- Same steps, new look: each converter opens with one sentence on what you upload and get, then 1 protocol
  (radio cards with a check, keyboard-selectable), 2 files (drop zones with clear loaded / drag states), 3
  options (segmented controls), Advanced settings, and one solid convert button in the protocol's colour.
  Icons replace the emoji; "How it works" can be folded away (remembered); results scroll in below the top
  bar. Text contrast ≥ 4.5:1 in both themes; works down to phone width.
- Markup moved out of index.ejs into views/partials/converter.ejs (every id, handler and help text kept);
  styles portal/converter.css (scoped to the converter), behaviour portal/converter.js.
- Same output: a golden harness drove 69 conversions (6 Postman / Bruno inputs × protocol × mode, every
  option and advanced switch, certificates, 3 JMX plans × protocol × mode × Workload Excel, CSV / certs,
  error cases) — the requests sent, server answers and ZIP contents are identical to before.
  tests/unit/converterPageParity.test.js keeps ids, handlers and help text in step.
- Independent validation (nothing missing, no behaviour regressed) — its findings fixed: option buttons wrap
  instead of spilling out at narrow widths, protocol icons / step numbers / tags / certificate chips reach
  4.5:1, protocol cards are one radio group (arrow keys), Advanced settings announces open / closed, one focus
  ring everywhere. Converter bugs fixed: BUG-077 (stale JMeter lists on a Postman result), BUG-078 (cert zone
  stayed green after Clear).

#### Added — Portal redesign, step 3: new Script Studio page

- Start page: a short intro, then two cards — 1 HAR recordings (drop zones, "One recording or two?"
  explains pattern vs diff mode), 2 output format, mode and Analyze; 3 request filters beside them.
- Results: summary row, then two columns — review (Correlation Advisor, correlation and parameter
  details) and the script preview with downloads, which stays in view while you scroll. "Review" and
  "Script" hide either column (one always stays; remembered). While the background-request review is
  pending only its table shows (no empty stats / "Loading…" preview). Escape closes the dialogs.
- Inside the portal: no second header or Clear; the portal's theme and Clear apply.
- Live at /studio (the portal's Script Studio). Downloads sit in their own bar, always visible. Independent
  validation (99 features, none missing) — its findings fixed: contrast ≥ 4.5:1 on advisor buttons, chips and
  labels; advisor cards never cut off and a skipped card can be restored; dialogs take focus, keep Tab inside
  and give it back; filter chips, code tabs and panel headers work with the keyboard; long stats wrap.
- Studio bugs fixed (BUG-072..075): a file that is not a recording is refused with a clear message and damaged
  entries are skipped with a warning (was a raw "Cannot read properties of undefined"); a new analysis starts
  clean, so old scripts can't be downloaded while background-request decisions are pending; the warning colour
  and "remove recording" no longer keep old results.
- Same scripts: Studio.html loads the classic scripts unchanged, in the same order, plus the classic
  stylesheet under portal/studio.css. A golden-output harness (60 runs, 29 steps, 9 edge checks)
  shows scripts, correlations, advisor, parameters, messages and ZIP contents identical to the
  classic page. tests/unit/studioPageParity.test.js keeps scripts, ids, handlers and help text in step.

#### Added — Portal redesign, step 2: new Recorder page

- The Recorder (HAR / NetLog → VuGen Web HTTP/HTML or DevWeb script) has a new page in the portal
  design: start page with the 4 steps, a large drop zone and the two ways to record as tabs (all
  instruction text kept word for word, can be folded away); after loading, a workspace with a summary
  bar (file, requests in the script, transactions, format, authentication), filters, and three panes
  (domains · requests grouped by transaction · script preview) above a download bar.
- Hide / show what you don't need: the domain list, the request list, the script preview (one of the
  last two always stays), the filter bar (folds to one
  line), the static-assets help and the recording instructions — remembered per browser. Panes can be
  resized; the workspace fits the window and works down to phone width.
- Every faded request says why it is left out (static asset, analytics, OPTIONS, domain or type off,
  WebSocket, security report); redirects followed automatically and resources added to their page step
  are marked. The script preview is colour-coded.
- Transactions: Rename and Ungroup (with Undo); manual transactions survive a format change; invalid
  names are shown in the dialog. "Correlate in Script Studio →" opens Studio with the same file loaded.
- Errors (wrong file, unreadable JSON, not a HAR, empty NetLog, damaged entries) are explained on the
  start page; a progress overlay shows while large files are read. Fixes BUG-067..070.
- Independent validation of the real page (all 151 features of the old page present) found issues in
  the first build, now fixed: choosing another file and cancelling no longer changes the open recording
  (a "still open — back to it" bar replaces the button inside the drop zone); Escape leaves Select mode
  anywhere; Create refuses a duplicate transaction name, like Rename; requests can be selected with the
  keyboard; focus returns to where you were after dialogs and domain switches; Undo is cleared by Clear,
  a new file or a format change; contrast raised to at least 4.5:1 (grey text, green buttons, step
  numbers). Large recordings: a progress overlay while the script is built or filters change, and the
  list shows the first 1,500 requests with "Show all" (the script always has every request) — 20,000
  requests now build in about 3 s instead of a 7 s blank freeze. /tools/recorder and /tools/studio
  redirect (BUG-071).
- Same engine: the page loads the classic engine files unchanged and keeps every function name and the
  shared state. A golden-output harness compared it with the classic page — scripts, ZIP contents,
  state and messages are byte-identical for 19 recordings × 3 formats plus 14 filter / transaction
  steps. tests/unit/recorderCoreParity.test.js keeps the copied engine functions identical.
- Sharper text across the portal, Script Studio and the 404 page: weight 800 has no Segoe UI face, so
  Windows drew Segoe UI Black (blocky letters) — headings now use the real Bold. Dialogs are solid,
  with no blur behind them.
- Code: src/web/public/Recorder.html, portal/recorder{.css,-ui.js,-core.js}. /recorder now serves the
  new page; the classic page stays at /recorder-classic as a fallback.

#### Added — Portal redesign, step 1: sidebar shell and new Home

- Collapsible left sidebar replaces the top tab bar: Home · Create scripts (Postman / Bruno, JMeter,
  Recorder, Script Studio) · Analyse (Results Analyser) · Learn (Help). Collapses to an icon rail with
  tooltips (remembered, Ctrl+B); slide-in drawer below 900 px. CDP Recorder "Running" badge.
- Top bar with the page title, "How it works" (opens that tool's Help section), Clear and theme.
- The address bar never changes: every page stays at …/converter, as before (also under IIS). An old
  #/record-style link opens its page once and the address is put back. Sidebar items are buttons.
- Home: a click anywhere on a tool card opens that tool (the card button stays the keyboard target).
- New Home, task-based for non-technical users: "What would you like to do?" cards (what you need /
  what you get / what is included), how the tools fit together, CDP Recorder card with live state and
  setup steps, "Which tool do I need?" (now also covers LRE results), good-to-know facts. All content
  from the previous Home is kept.
- Code: src/web/views/partials/{shell,home}.ejs, src/web/public/portal/{shell,home}.{css,js};
  index.ejs is 246 lines shorter. No build step, no new dependencies, no CDN requests.

#### Changed — One address for the whole app

- Only …/converter/ is ever shown. Recorder, Script Studio and Results Analyser pages opened on their own in a
  browser tab send the user to …/converter/ with that tool open (public/portal/frame-guard.js). The temporary
  /recorder-next, /recorder-classic, /studio-next and /studio-classic routes are removed; /tools/* go to the portal.

#### Changed — Portal polish across tools (visual only)

- Postman / Bruno and JMeter: inside the portal the converter banner and its own tab bar are hidden (the
  sidebar and top bar do that job); each form starts with one sentence saying what you upload and get.
- Script Studio inside the portal: its own header (title, badge, Clear) is hidden — the portal top bar and
  Clear replace it — and dark mode uses the portal navy. Help: the "On this page" bar sits under the top
  bar and a jumped-to section is never hidden beneath it. View-transition errors on fast clicks fixed.
- Checked side by side with the committed version (same clicks and files on both): converter ZIPs for
  Postman DevWeb, Postman Web HTTP/HTML and JMeter are identical apart from timestamps / temp paths.

#### Fixed — Help section accordion now single-open

Expanding a Help topic (e.g. "Converter") no longer leaves previously expanded topics open —
only one section stays expanded at a time, matching standard accordion behavior. Applies to
both clicking a section header and jumping via the "On this page" dropdown.

Files changed: `src/web/views/index.ejs` (`haccToggle()`, `haccJump()`)

### Performance

#### Performance — DPoP EC key resolution now cached (DevWeb)

Same redundant-parsing pattern as the JWT fix below, found while re-checking JWT/DPoP code
for other performance issues — and worse in practice, since a DPoP proof is generated once
per HTTP request rather than once per ~9-minute JWT refresh.

`getDpopProof()` in `dpop-helper.js` re-ran `JSON.parse()` + validation +
`crypto.createPrivateKey()` on every single call, even though the EC key never changes after
the first call in a Vuser session. Checked the VuGen equivalent (`lre-utils.dat`/`.js`
`generateDpopProof()`/`initDpopKey()`) and confirmed it was already correct — the key is
resolved once in `vuser_init()` and reused via a module-level cache, so no VuGen change was
needed. Also fixed the identical pattern in `dpop-service.js`'s `/dpop/vuser` endpoint (a
standalone optional helper — confirmed via grep to not be wired into any generator, fixed
for consistency anyway).

Fix: added a cache keyed by the exact raw JWK JSON string in both files
(`_dpopKeyCache` / `vuserKeyCache`, both `Map`), mirroring the JWT fix's approach. Every
existing validation branch and side effect (`console.log` messages, `load.global.dpop_jwk`
writes) is preserved exactly on the cache-miss path.

Verified with 8 new tests (`tests/unit/dpopHelperKeyCache.test.js`) that independently verify
every produced DPoP proof's ES256 signature via Node's own `crypto.verify()`
(`dsaEncoding: 'ieee-p1363'` for the raw R||S format RFC 7515 requires), covering the
empty/string/object/invalid-JWK branches, plus spies on `crypto.createPrivateKey` proving the
cache is hit/bypassed correctly. All 183 unit tests pass (was 175 after the JWT fix below).

Files changed: `dpop-helper.js`, `dpop-service.js`,
`tests/unit/dpopHelperKeyCache.test.js` (new)

#### Performance — JWT signing key parsing now cached (DevWeb + VuGen)

JWT generation re-parsed the same unchanging private key from scratch on every call instead
of reusing the already-resolved key — pure wasted CPU on a long-running load test, no
functional bug (reported by a user reviewing generated script performance).

DevWeb (`jwt-helper.js`): `generateJWT()` called `normalisePem()` + `resolveSignKey()`
(→ `crypto.createPrivateKey()`) every time, even though `getJwtToken()`'s own 9-minute
expiry gate means the same key text gets re-processed on every refresh across a multi-hour
run. VuGen (`lre-utils.dat` / `lre-utils.js`): `createJWT()` / `createJWTFromMap()` re-ran
the full PEM → DER → BigInteger parse (`_parseRsaKey`) every call — `createJWTFromMap`
(per-request JWTs) has no caller-side expiry gate at all, so it could re-parse the identical
secret once per request.

Fix: added a small cache keyed by the exact raw key/secret string — `getCachedSignKey()`
(a `Map`) in `jwt-helper.js`, and `_getRsaKey()` (a plain object — the file is ES3-only) in
`lre-utils.dat`/`lre-utils.js`. Keying by the raw string means a script signing with more
than one distinct secret still gets its own correct cache entry.

Verified with 10 new tests (`tests/unit/jwtHelperKeyCache.test.js`,
`tests/unit/lreUtilsRsaKeyCache.test.js`) that independently verify every produced JWT
signature against the matching RSA public key via Node's own `crypto.verify()` (PKCS#8,
PKCS#1, and HTML-entity-corrupted PEM inputs all covered), and confirm the cache is hit on
a repeat call with the same key but correctly bypassed for a different one. All 175 unit
tests pass (was 165).

Files changed: `jwt-helper.js`, `lre-utils.dat`, `lre-utils.js`,
`tests/unit/jwtHelperKeyCache.test.js` (new), `tests/unit/lreUtilsRsaKeyCache.test.js` (new)

### Results Analyser

#### Fixed — progress bar no longer flashes near the end (BUG-085)

- One progress bar for the whole analysis: each stage has its share, so the bar only moves forward; stages
  without a known size shimmer instead of switching to the sliding animation at full width.


#### Changed — Results Analyser matches the portal

- System fonts like the rest of the portal (no Google Fonts request — works the same on locked-down networks),
  drawn icons on the start cards instead of emoji, secondary text at ≥ 4.5:1 in both themes. The analysis,
  exports and CLI are unchanged (92 analyser tests pass).

#### Fixed / Changed — Results Analyser reports (BUG-065, BUG-066)

- Excel: new "Charts" sheet (all report charts, two per row); Time Series and LG Health are plain data
  sheets again and scroll normally (only the header row is frozen).
- PDF and Word: landscape A4; Executive summary mirrors the page (eight figures, web traffic, top
  findings, checked-and-fine summary); test facts with Controller host; full workload design; Count,
  Pass, Fail per period; every error group with its real message (script line included); readable
  times; two charts per page; "About this report" replaces the method/self-check appendix (the
  self-checks stay in the JSON export).
- HTML report is now its own button next to PDF (was under More).

#### Changed — Results Analyser: no duplicate figures, consistent periods

- Overview: "Test statistics" became "Web traffic — whole test" (hits, hits/s, throughput, throughput/s
  with peaks); the VUser, transaction and error figures are only in the tiles. Errors tile shows how
  many different errors; long durations are shortened in tiles ("1 d 3 h 37 min", exact on hover).
- Transactions (page, Excel, Word, PDF): Pass, Fail and Fail % follow the chosen view, so in the
  steady-state view every column covers the steady state (was: whole-run pass/fail beside
  steady-state counts). The details drawer says which period its figures cover.
- Insights: banner counts findings by severity; the errors finding quotes a real message; the steady-
  state finding mentions VUsers that stopped early. Clearer column names in Errors and Workload.
- Demo run (tools/make-demo-run.js) now records bytes received and error messages with script lines.

#### Fixed / Changed — Results Analyser: end-user review of every section

- Steady state in long soaks (BUG-061): ends at the start of the final ramp-down, not at the first VUser
  that stopped on error; VUsers that stopped early are counted, shown in the schedule and raise a finding.
- Workload iterations per script (BUG-062), random think time text (BUG-063), error groups keep the
  script line and show a real message (BUG-064).
- Times are human-readable everywhere ("Thu 08 Oct 2026, 07:31:24 → 09:23:33", "1 day 3 h 36 min");
  no more "t+hh:mm:ss". The analysis window is chosen with date/time pickers.
- Overview: eight tiles (Peak VUsers, Test duration, Steady state, Transactions per second, passed,
  failed, errors, slowest/SLA) and a "Test statistics" card with LRE's summary figures (hits, throughput
  in bytes, passed ratio). Test details: script count instead of ~80 names, Controller host, LoadRunner
  version, readable schedule.
- Workload: "Workload design" (totals row, stopped-early column), "Load generators — VUsers and resource
  usage" (script count, expandable list, Controller role), VUsers with local start/stop times.
- Excel: charts on the Time Series and LG Health sheets (page export), real error messages, readable
  times, "About this report" instead of "Method & Validation" (self-checks stay in the JSON export).

#### Fixed — Results Analyser: chart-library console error

- "Cannot read properties of null (reading 0)" in the browser console (inside ECharts) when charts were
  redrawn quickly, for example on a tab switch followed by a theme change. ECharts draws large charts over
  several frames and dispose() did not cancel the frame already queued. All chart disposal now goes through
  `killChart()` in `web/app.js`, which invalidates the queued frame first. No effect on figures or exports.

#### Changed — Results Analyser: granularity matches LRE's "VuserID" setting; modern results page

- Granularity: LoadRunner's "VuserID" tick under "graph properties to aggregate" MERGES the VUsers.
  The averaged view therefore combines all VUsers per time slot by default ("combine VUsers"),
  which reproduces LRE's aggregated Std Dev / Max / percentiles; untick it (CLI `--per-vuser`) to
  average each VUser separately. Saved settings from the previous version are not reused.
- Results page: compact sticky header with a one-line settings summary ("⚙ Change" opens the
  editor); every panel collapsible with "Collapse all / Expand all", remembered between visits;
  transaction details open in a side drawer (Esc to close) instead of below the table.
- New Overview: verdict card with the top issues, six key figures, one load/throughput/errors chart,
  slowest transactions (P90 bars) and compact findings; test details in a collapsed panel.
- Validation tab removed from the page (technical self-checks remain in the Excel "Method &
  Validation" sheet and the JSON export).
- Every panel now explains itself in plain English: a one-line "what this shows" and an expandable
  "How to read it" (text in `web/notes.js`); column titles and overview tiles have hover help;
  "? Hide / Show explanations" turns them off for experienced users (remembered). Icons on panels,
  tabs and tiles; finding evidence moved behind an "Evidence" toggle.
- The Granularity control is hidden for now (`FEATURES.granularity = false` in `web/app.js`): the
  page shows the exact figures only. The engine and the CLI `--granularity` option are unchanged.

#### Added — Results Analyser: Granularity (exact or LoadRunner-style averaged figures)

- New **Granularity** setting (page, Excel/Word/PDF, CLI `--granularity`). Default **Exact**: every
  transaction counted on its own (unchanged). Choosing 5 s … 1 h shows the figures LoadRunner
  Analysis shows with Data Aggregation on: response times are averaged per time slot (per VUser by
  default, as LRE's "VuserID" option), and Min, Max, Std Dev and percentiles are taken over those
  averages, weighted by count. Count, Pass, Fail and Average do not change. Charts use the same slots.
- Plain-English help on the page ("What is this?"), a banner whenever averaged figures are shown,
  and the same explanation in the reports' method sections. The choice is remembered per test.
- Very large runs (over 20 M transactions): 200 s per VUser is prepared while the file is read;
  other sizes via the CLI (`--granularity 300`, `--all-vusers`).
- Replaces the charts-only "Chart granularity" control (CLI: `--chart-granularity`) and the hidden
  load-generator-based `--lre-granularity` diagnostic.

#### Fixed — Results Analyser: shared transactions reported per script (BUG-060)

- A transaction used by several scripts (e.g. Login, Logout) now has one row per script with
  that script's own figures; previously the all-scripts total was repeated under every script
  and inflated each script's subtotal and TPS.
- "Count" is now passed + failed instances (as LRE's Transaction_Count); response-time
  statistics still use passed instances only.
- P98 added to the transaction summary.
- Error summary counts SqliteDb.db rows with Type 2 (errors); other message types are reported
  separately in the self-checks.
- CLI console: the Std Dev column was always "-"; fixed.

#### Fixed — Results Analyser transaction figures (BUG-059)

- RawData.eve transactions are now read from the transaction records (sub-types 12586944,
  12586945, 12619721), not from sub-type 762 (per-request data points). Response time is the
  record's end minus start time, in seconds. Counts, response times, percentiles, TPS, SLA,
  Apdex and insights were all wrong before this fix.
- Transaction names: RawData.eve uses internal ids that differ from RawData.map. Names are now
  matched against LRE's per-transaction response-time graph in sum_data (count, mean, max);
  unmatched ids are reported in the self-checks instead of being guessed.
- Pass / fail come from the transaction records (failed records counted, not timed, as LRE does);
  sum_data pass/fail graphs are used as a cross-check.
- sum_data: the "Name,measurementId" measurement format is now read.
- Validation tab: transaction-name matching table and data-point (HTTP code) counts.

#### Added — Results Analyser (LRE raw results), new portal menu "Results"

- New separate module `lre-results-analyser/`: analyses a LoadRunner Enterprise run from its raw
  results folder or ZIP, independently of LRE Analysis. Runs in the browser — results are never
  uploaded or stored on the server; any size is streamed (ZIP64 read in place).
- Transaction summary for the full run and the steady state (exact nearest-rank percentiles,
  TPS, pass/fail, SLA, Apdex), adjustable analysis window, workload model (pacing, think time,
  iterations planned vs achieved), errors from `SqliteDb.db`, load-generator health from sum_data.
- Dashboard with 12 charts (load, response time, TPS, latency and VUser heatmaps, TPS vs RT,
  errors, HTTP codes, throughput, LG CPU, RT per LG, distribution).
- Insights: pacing / Little's Law, degradation trend, level changes, spikes, LG bias, LG CPU,
  errors, SLA/Apdex; overall verdict.
- Exports: Excel (9 sheets), Word, PDF/HTML report, JSON (optionally redacted).
- Command line for very large runs: `node lre-results-analyser/cli/analyse.js`.
- Server: serves the module's static files at `/ra` and the page at `/results-analyser`
  (both also under `/converter`). Help: new "Results Analyser" section.

### CDP Recorder and the retired browser extension

#### Fixed — CDP Recorder no longer gives up on a registry value alone (BUG-111)

- The recorder always tries the browser, even when the registry has `RemoteDebuggingAllowed = 0`; the value only
  shortens the wait (12 s) and explains a real failure. Before, it stopped at once with "does not allow remote
  debugging on this machine" without trying.

#### Fixed — CDP Recorder would not start on some machines (BUG-086)

- The recording browser picks a free debug port itself (it was always 9333, which fails silently where that port is
  taken or reserved by Windows); the recorder connects over 127.0.0.1.
- A browser policy that blocks remote debugging is found in the registry before launch and named in the message;
  when Edge is blocked the recorder uses Chrome by itself, and the floating toolbar opens in the same browser.
- `--browser=chrome` (and every other `--option=value`) now works; before, the value was ignored.
- Clearer messages (port, connection error, browser exit); 30 s start-up wait; no Node deprecation warning.
- Rebuilt `dist/cdp-recorder.exe` / `.zip` — copy the new zip to the server's dist folder.

#### Removed — PerfX Recorder browser extension; Docs/ made local-only

- `perfx-recorder-extension/` deleted (replaced by the CDP Recorder) and purged from the GitHub history of
  every branch. Home page: hidden extension banner, install modal and its CSS/JS removed; tool card,
  decision guide and Recorder help now list two recording options (CDP Recorder, Classic bookmarklet).
  Server: `GET /downloads/recorder-extension` removed (`archiver` stays — the CDP Recorder download uses it).
- `tests/unit/harBuilder.test.js` now tests `cdp-recorder/recorder/src/har-builder.js` (the same code).
- `Docs/` is local-only: added to `.gitignore` and purged from the GitHub history of every branch.
  The bug tracker moved to `BUGS.md` at the repo root.
- `devweb-prompts/` is local-only: added to `.gitignore` and purged from the GitHub history of every branch.

#### Changed — Recorder page: CDP Recorder replaces the address-bar and net-export methods

- Removed the "Alternative: Address Bar Method" and "Multi-tab / Popup recording
  (chrome://net-export/)" panels from the Recorder tool. In their place, a CDP Recorder
  section: download the ZIP, extract, run `cdp-recorder.exe`, record in the recording
  window, and drop the HAR in. The download link works at `/recorder` and under `/converter`.

#### Changed — CDP Recorder is downloaded as a ZIP

- "Get CDP Recorder" now downloads `cdp-recorder.zip` (the `.exe` plus a README.txt)
  instead of a bare `.exe`, which some corporate proxies block. The ZIP is also smaller
  (about 35 MB against 90 MB).
- `npm run build:exe` now writes `dist/cdp-recorder.zip` as well; `npm run build:zip`
  re-zips an existing `.exe`. Deploy only the ZIP to the server's `dist` folder.
- Servers that still have only `dist/cdp-recorder.exe` keep working: the download falls
  back to it when no ZIP is present.
- Home page, help text, CDP Recorder user guide and IIS deployment guide updated
  ("extract the ZIP first, then run cdp-recorder.exe").

#### Fixed — CDP Recorder / extension downloads 404 on IIS (BUG-EXT-017)

- Download links (and the analytics script) on the home page now include the `/converter`
  prefix when the app runs under the IIS virtual directory; download routes answer at both
  `/downloads/...` and `/converter/downloads/...`.
- Clearer message when `cdp-recorder.exe` hasn't been copied to the server.
- IIS deployment guide: corrected the download test URL and split the 404 troubleshooting row.

#### Added — CDP Recorder user guide (HTML, with screenshots)

- `Docs/user/CDP-RECORDER-USER-GUIDE.html`: a single self-contained page for end users —
  download, launch, recording transactions, the "no requests" warning, saving, loading into
  Script Studio, using Chrome, data handling, troubleshooting and command-line options.
  All screenshots are captured from the real tool by
  `cdp-recorder/recorder/tests-manual/capture-guide-screenshots.mjs`; rebuild the page with
  `cdp-recorder/recorder/scripts/build-user-guide.mjs`.

#### Fixed — CDP Recorder toolbar layout (BUG-EXT-016)

- Completed-transaction chips no longer render oversized or spill out of their card; the
  toolbar scrolls instead of clipping when it's full.

#### Fixed — CDP Recorder: empty transactions, unclear recording window, Quit cleanup (BUG-EXT-014, BUG-EXT-015)

- The recording browser now opens on a "This is the RECORDING window" page instead of a blank
  `about:blank`, and the toolbar's notice points users to it — previously nothing identified
  which window was being recorded, and browsing in a normal browser silently captured nothing.
- The toolbar warns immediately when a transaction ends with zero captured requests.
- Script Studio no longer shows an empty transaction whose only traffic was filtered noise
  (`pruneEmptyPagerefTransactions()`), and no longer generates an empty transaction for it.
- Quit now actually runs cleanup on Windows (was leaking two temp Edge profiles per session).
- New Playwright end-to-end test: `cd cdp-recorder/recorder && npm run test:e2e`.

#### Added — CDP Recorder: standalone HAR recording with no browser extension

The existing `perfx-recorder-extension` requires installing a Chrome/Edge extension, which
corporate Group Policy blocks on several client machines (the original reason this track
started). CDP Recorder solves the same problem — recording a browsing session, including new
tabs and popups, into a HAR for Script Studio — using Chrome DevTools Protocol directly
instead, with no extension install at all.

Built in `cdp-recorder/` as a fully isolated, deletable folder (per the project's own "safe
to remove if it doesn't work" convention). Key pieces:

- `cdp-recorder/probe/` — Phase 0 feasibility probe, confirmed raw CDP access, custom launch
  flags, and `Target.setAutoAttach`'s popup-race fix all work on the actual corporate-managed
  machine, not just a dev box.
- `cdp-recorder/recorder/` — the real capture engine. `bg-detector.js`, `har-builder.js`,
  `url-normalizer.js` ported byte-identical from the extension (zero `chrome.*` dependency).
  `cdp-capture.ts` is the actual fix for the extension's reactive-attach popup race:
  `Target.setAutoAttach({waitForDebuggerOnStart: true})` pauses every new target, including
  the very first tab, before anything on it can run, and turns Network capture on before ever
  resuming it — architecturally closes the race instead of trying to win it.
- A local web UI (not a CLI) — a floating, chrome-less toolbar window (Edge/Chrome `--app=`
  mode), deliberately a separate browser process from the one being recorded, so its own
  traffic never pollutes the HAR. Start/Stop/Transaction buttons, live active/background
  counts, a completed-transactions trail.
- Transaction boundaries now embed a screenshot of every open page (main tab + any popup) in
  the HAR (`_perfx_screenshots_start`/`_perfx_screenshots_end`), extractable via
  `inspect-har.mjs` into real `.png` files.
- Packaged as a single self-contained `.exe` (Node's built-in Single Executable Applications
  feature + esbuild bundling) — no Node.js or npm install needed on the machine that runs it.
  Confirmed running clean on the real corporate-managed machine, no AV/EDR or SmartScreen
  block.
- Integrated into the Converter portal: a new banner on `/converter` (same visual slot as the
  currently-disabled extension banner) offers a download, or detects an already-running
  recorder via a local `fetch()` from the visitor's own browser and offers to open its toolbar
  directly instead.

Two real bugs found via actual corporate-machine testing, not assumed away: a `Network.enable`
timeout on a slow renderer start (corporate AV/EDR overhead, not reproducible on a dev
machine) that originally meant a target's first request was silently never captured — fixed
with a background retry instead of giving up after one timeout; and a stale deployment of
`src/web/public/VuGen-Script-Studio-correlation.js` on the corporate machine (no `git pull`
access there, prior updates had been ad-hoc copy-paste) that made transactions appear to not
work in Script Studio at all, traced down to the actual missing code via direct inspection of
the user's real `parseHar`/`detectMarkers` functions rather than guessed at.

Full history: `CDP-RECORDER-IMPLEMENTATION-PLAN.md`.

Files changed: `cdp-recorder/` (new), `src/web/server.js` (new `/downloads/cdp-recorder`
route), `src/web/views/index.ejs` (new banner + updated Help/decision-card copy),
`Docs/deployment/DEPLOYMENT-IIS.md`, `Docs/deployment/DEPLOYMENT-IIS-visual.html` (new Step 5c)

#### Changed — PerfX Recorder Extension home page banner temporarily hidden

The "New / PerfX Recorder Extension" promo banner on the home page is now hidden by default.
Several corporate environments block `chrome://extensions` → Load unpacked via Group Policy,
so promoting an install path some users can't complete was creating confusion.

Nothing was removed — the banner markup, CSS, download route, and install modal are all
still in place and functional. The extension is still reachable via the **Help → Recorder**
in-app doc link ("Get the extension →") and via `GET /downloads/recorder-extension` directly.

To re-enable: flip `SHOW_EXT_BANNER` from `false` to `true` in `src/web/views/index.ejs`
(just above the `<!-- PerfX Extension banner -->` block). See
`Docs/EXTENSION-RECORDER-PLAN.md` → "Distribution status" for full detail.

Files changed: `src/web/views/index.ejs`

#### Added — PerfX Recorder Extension download (home page)

Users can now download the PerfX Chrome extension directly from the home page without any new
user-facing URL. A banner card between the tool grid and "Which tool?" section shows the
extension, a comparison table (Bookmarklet vs Extension), and a 5-step install guide modal.

Implementation:
- `src/web/views/index.ejs`: extension banner HTML, modal HTML (comparison table + install steps),
  CSS for banner + modal components, `openExtModal()` / `closeExtModal()` JS
- `src/web/server.js`: `GET /downloads/recorder-extension` route — ZIPs
  `perfx-recorder-extension/` on demand via `archiver` and streams to browser
- Recorder card description updated to mention both recording methods
- Help section updated with "Two ways to record" callout + link to modal

### Script generation — JWT, DPoP and VuGen runtime

#### Fixed — Postman / Bruno / JMeter converter: scripts that did not run (BUG-097 … BUG-104, BUG-108)

Found by running the converter's outputs with the real VuGen and DevWeb engines through a test proxy, old and new
side by side.

- **VuGen sent `Bearer {access_token}` literally in the first iteration** (BUG-098): `Authorization` was an auto
  header set before the token existed. It is now added to each request that sends it; the token request sends none,
  as in Postman. DevWeb no longer sends an empty `Authorization` on the token request.
- **DPoP proofs are accepted** (BUG-097): one proof right before each request, for the URL actually sent (VuGen used
  to sign the literal `{base_url}/…`), with `ath` for the token the request presents; works from the second
  iteration on (BUG-092).
- **A URL ending in a line break** no longer breaks VuGen compilation (BUG-099).
- **DevWeb**: form-data bodies are real `load.MultipartBody` entries instead of a syntax error (BUG-101); rts.yml
  values such as `{{vault:key}}` are quoted so DevWeb loads them (BUG-100); a variable declared with an empty value
  sends nothing instead of a literal `{{site}}` that stopped the Vuser (BUG-102).
- Result on the sample collections: every DevWeb `main.js` parses (6 of 69 did not); the Salesforce and Bruno YAML
  scripts now compile in VuGen and run in DevWeb (74 requests, before 0).
- **XML responses**: a value a script reads with Postman's `xml2Json(...)` is an XPath extractor in both formats
  (was a broken JSON path); namespaced XML (Salesforce Bulk API) works in both engines (BUG-103, BUG-104).
- **Windows sign-in set on the collection** is used (it was ignored, BUG-108); VuGen `web_set_user` is in Action.

#### Fixed — VuGen: JavaScript helpers lost from the second iteration; DPoP in the Recorder and Script Studio (BUG-091 … BUG-096)

- With **Simulate a new user on each iteration**, VuGen empties its JavaScript engine, so DPoP / PKCE / JWT
  functions were "not defined" from iteration 2. Action now loads `lre-utils.js` again at its top (all tools)
  (BUG-092).
- **DPoP** (Script Studio, Recorder DevWeb): one proof per request for the URL as sent, with the right `ath`;
  the Recorder's DevWeb header was the literal text `load.global.dpop_proof` (BUG-093, BUG-094).
- **Script Studio DevWeb**: Basic-auth scripts no longer stop at once (BUG-095); recorded Negotiate / NTLM tickets
  are no longer replayed (BUG-096).
- Long VuGen bodies are split only between whole escape sequences — a github.com recording compiles (BUG-091).

#### Fixed — JWT stored under the signing library's name (BUG-081)

- A pre-request script that first keeps the downloaded signing library (`pm.globals.set('jsrsasign', …)`) and
  then stores the token now gets the token's real name (`jwt_token`): library-loading variables are skipped when
  the JWT output is chosen. Fixes the bundled `jwt_ps256_20api_collection.json` example in DevWeb and VuGen.

#### Fixed — VuGen JWT: "RSA parse: expected outer SEQUENCE" and "// line comment" warning (BUG-054)

- `lre-utils.js`/`.dat` now accept a private key whose newlines are written as `\n`, which
  is how `default.cfg` stores it — previously every VuGen JWT using a multi-line PEM from
  `[CommandArguments]` failed in vuser_init. DevWeb was unaffected.
- Generated VuGen JWT code no longer contains a literal `//` inside `web_js_run` (VuGen
  warning MWAR-26311).

#### Fixed (BUG-051) — Same VuGen "invalid label" typo in two more, separate generators

The user reported still hitting the "SyntaxError: invalid label" error after BUG-046, found
a colon-instead-of-semicolon typo in their own generated `vuser_init.c`, fixed it locally,
and asked for a cross-check. Confirmed via full git history that the server-side converter
(`src/generators/vugen/scriptGenerator.js`) has never had this typo — it lives in two other,
entirely separate VuGen generators that a prior fix never touched: `src/web/public/
studio-codegen.js` (Script Studio) and `src/web/public/VuGen-Recorder-generators.js`
(Recorder tool). Both render `'DPoP engine initialized successfully':` (colon) instead of
`;` in the DPoP init `Code=` string. Fixed both (one character each).

Self-correction during this fix: initially also suspected both files shared BUG-050's
DPoP-header-classification bug and added a matching fix to each, but direct end-to-end
testing (loading each file and calling its real code-generating function with fabricated
HAR data) showed both already correctly exclude DPoP headers from global classification via
their own pre-existing `SKIP_HDR_AC` set — that bug never existed there. Reverted those
unnecessary additions rather than leave dead code implying a fix that wasn't needed.

New regression test: `tests/unit/vugenClientCodegenDpopInit.test.js` (3 tests) — extracts
the real `Code=` string from each generator's live output and parses it with `new
Function()`; verified against the original typo. All 206 unit tests pass (was 203).

Files changed: `src/web/public/studio-codegen.js`, `src/web/public/VuGen-Recorder-generators.js`,
`tests/unit/vugenClientCodegenDpopInit.test.js` (new)

#### Fixed (BUG-050) — VuGen DPoP header sent unresolved/empty on every request

Found by cross-checking JWT+DPoP together after the user asked to verify DPoP worked
following an unrelated fix. `analyzeCommonHeaders()` in
`src/generators/vugen/scriptGenerator.js` classified a "DPoP" header as GLOBAL whenever it
appeared in >=70% of requests with the same value template — always true for DPoP, since
every request uses the literal same `{{dpop_proof}}` placeholder even though each one needs
a genuinely different, per-request-bound signed value.

That misclassification broke DPoP two ways at once: `generateAddHeaders()` skips any header
already in `globalHeaders`, so the already-correct per-request wiring
(`request._dpopParamMap`, sequence-numbered params like `_dpop_proof_1`/`_dpop_proof_2`)
never ran; the only thing emitted was `web_add_auto_header("DPoP", "{_dpop_proof}")`, a
parameter that is never populated anywhere. Every VuGen script with a DPoP header has
always sent an unresolved/empty value — in every DPoP script this tool has ever generated.

Fix: DPoP/DPoP-PF headers are now always forced into `perRequestKeys`, mirroring the
existing Content-Type special-case, so the already-correct per-request logic actually runs.

New regression test: `tests/unit/vugenDpopHeaderClassification.test.js` (4 tests) — verified
by reverting the fix and confirming all 4 correctly failed. DevWeb was unaffected (calls
`getDpopProof()` inline per-request already, never goes through this code path).

Files changed: `src/generators/vugen/scriptGenerator.js`,
`tests/unit/vugenDpopHeaderClassification.test.js` (new)

#### Fixed (BUG-049) — Shared JWT output-variable detection picked the wrong variable

The real root cause behind a user report that a combined JWT+DPoP script still failed
after BUG-048 was fixed. `CustomScriptParser.extractJwtClaimMap()`
(`src/analyzers/customScriptParser.js`, shared by both DevWeb and VuGen generators) scanned
every `.set()` call in a pre-request script and kept overwriting `map.output` on each
match, so the LAST `.set()` call won — regardless of whether it had anything to do with the
JWT. A script that signs a JWT and stores it first (`pm.environment.set('client_assertion',
sJWT)`), then does something unrelated afterward (e.g. a DPoP proof placeholder), ended up
with the JWT's output variable wrongly named after the LATER, unrelated `.set()` call.

BUG-048's fix (use `cm.output` as the storage variable) faithfully propagated this wrong
name — the JWT got stored under the wrong variable in both DevWeb and VuGen output, while
the real `{{client_assertion}}` reference in the request body was never assigned.

Fix: `extractJwtClaimMap()` now takes the FIRST `.set()` match, not the last — consistent
with `detectJwtUsage()`'s outputVars, which the generators' `_primaryOut` already treats as
"first non-library match wins" elsewhere in the same pipeline. Fixes both protocols at once
since the analyzer is shared.

New regression test: `tests/unit/extractJwtClaimMap.test.js` (4 tests) — verified by
reverting the fix and confirming 2 of 4 correctly failed. All 203 unit tests pass (was 195).

Files changed: `src/analyzers/customScriptParser.js`,
`tests/unit/extractJwtClaimMap.test.js` (new)

#### Fixed (BUG-048) — DevWeb primary JWT stored under the wrong variable, sent as undefined

Found while proactively reviewing the JWT path before the user had tested it (not a user
report). `generateInitialize()` and the refresh block in `generateAction()`
(`src/generators/devweb/scriptGenerator.js`) hardcoded `load.global.jwt_token` as the
storage variable for the primary JWT. But `replaceParameters()` substitutes the original
script's real output variable (e.g. `{{client_assertion}}` -> `load.global.client_assertion`,
extracted from `pm.environment.set('client_assertion', ...)` into
`jwtClaimMap.output`) — a different variable that was never assigned. The JWT was correctly
generated but stored somewhere nothing ever read; any request body/header referencing it sent
`undefined`. Invisible to `node --check` and to every existing test, since nothing previously
verified the variable a generated script *writes* matches the one it *reads*. Confirmed by
generating a realistic JWT-only script end-to-end and inspecting the actual output.

VuGen's generator was checked and already did this correctly
(`src/generators/vugen/scriptGenerator.js:1228`); DevWeb's per-request/secondary-JWT path
(BUG-036) was also already correct — only the primary JWT path in `generateInitialize()`/
`generateAction()` had the hardcoded literal.

Fix: both locations now derive the target variable from `cm.output` (sanitized), falling
back to `"jwt_token"` only when no output variable was ever detected.

New regression test: `tests/unit/devwebJwtOutputVar.test.js` (5 tests) — verified as a real
guard by reverting the fix and confirming it fails before restoring. All 195 unit tests pass
(was 190).

Files changed: `src/generators/devweb/scriptGenerator.js`,
`tests/unit/devwebJwtOutputVar.test.js` (new)

#### Fixed (BUG-047) — Hardened generated package.json against ESM/CJS ancestor conflicts

User reported `require is not defined in ES module scope, you can use import instead`
running a generated DevWeb script. Root cause is environmental: Node.js resolves module
type by walking UP the directory tree for the nearest `package.json`; if a DIFFERENT
`package.json` above the script's actual folder has `"type": "module"` (a stray file, or
an IDE-scaffolded DevWeb project template) and our own shipped `package.json` isn't present
in that exact folder, `require()` disappears entirely. Confirmed via direct reproduction
that our generated `package.json` never had `"type": "module"`.

Fix: `generatePackageJson()` in `src/tools/collection-converter/index.js` now explicitly
sets `"type": "commonjs"` (previously relied on the implicit default), and the generated
`README.md` now has a Troubleshooting entry explaining the directory-walk mechanism.

Files changed: `src/tools/collection-converter/index.js`

#### Fixed (BUG-046) — VuGen "invalid label" SyntaxError running DPoP or JWT scripts

User reported `Error from JS Engine: SyntaxError: invalid label` executing a generated
VuGen script with DPoP in real LoadRunner, right after generating it successfully.

Root cause: 3 ES3-illegal trailing commas in object literals in `lre-utils.js`/`.dat` —
in `_generateDpopKeyPair()`, `generateDpopProof()` (every per-request DPoP proof, not just
init), and `createJWT()` (every plain VuGen JWT, unrelated to DPoP). `git blame` traced them
to a commit that landed hours BEFORE BUG-040's cleanup the same day — that cleanup covered
function-call and array-literal trailing commas but never checked object literals, so these
3 survived. `node --check` cannot catch this class of bug: Node's parser has accepted
trailing commas in object/array literals since ES5/ES2015 and silently allows them, but
VuGen's real JS engine (ES3-level) rejects them.

Fix: removed all 3 trailing commas (semantically a no-op — all existing tests pass
unchanged) in both `lre-utils.js` and `lre-utils.dat` (kept byte-identical).

**New regression test**: `tests/unit/lreUtilsEs3Compat.test.js` parses both files under
`ecmaVersion: 3` via `acorn` (added as an explicit devDependency), plus an independent regex
cross-check and a byte-identical check — closing the gap that let this bug class through
twice. Verified as a real guard (not a false pass) by reintroducing one trailing comma and
confirming the test correctly fails. New CLAUDE.md rule (`CRITICAL Architecture Rules` #8)
documents that `node --check` is not a valid compatibility gate for this file.

Files changed: `lre-utils.js`, `lre-utils.dat`, `package.json`, `package-lock.json`,
`tests/unit/lreUtilsEs3Compat.test.js` (new), `CLAUDE.md`

#### Fixed (BUG-045) — Syntax error in every DevWeb script using DPoP

`generateInitialize()` in `src/generators/devweb/scriptGenerator.js` emitted a stray `"` in
the DPoP key-init line: `` load.global.${this.dpopKeyVar || "dpop_jwk"}" = load.global... ``.
This rendered as `load.global.dpop_jwk" = load.global.dpop_jwk || null;` in every generated
DevWeb script that uses DPoP signing — a JavaScript syntax error that broke the whole
`initialize()` block. Found while re-checking JWT/DPoP code for other issues (not previously
reported by a user).

Fix: removed the stray `"`, matching the dot-notation `load.global.<var>` pattern already used
everywhere else DPoP touches `load.global` in this file. Verified by calling the real
`generateInitialize()` (default and custom key-variable name) and parsing the actual returned
string with `new Function()`; confirmed the new regression test fails against the original
buggy code before confirming it passes against the fix.

Files changed: `src/generators/devweb/scriptGenerator.js`,
`tests/unit/devwebDpopInit.test.js` (new)

### Recorder and Script Studio — generated scripts

#### Changed — Servers: named by role, DevWeb override, only the servers used, renamable in Script Studio; prefetches and ad pixels left out (BUG-105 … BUG-107, BUG-109)

- **Default server names say what the server does** (all four tools, both formats): the recorded application is
  `App_Server`; `api.` / `login.` (`auth.`, `sso.` …) / `cdn.` (`static.` …) servers are `Api_Server`, `Auth_Server`,
  `Static_Server`; well-known services by purpose — `Recaptcha_Server`, `Google_Fonts`, `Okta_Server`,
  `Microsoft_Login`, `Cloudfront_Cdn` …; another server of the application `<Subdomain>_Server`, any other
  `<Organisation>_Server`; the application on another port `App_Server_8443`. Was `Host_<domain>`. Same requests on
  the wire in VuGen and DevWeb (only the names changed).
- **Script Studio Domains list**: analytics / ads servers are folded under "Analytics / ads — always left out"
  instead of looking ticked (BUG-109).

- **DevWeb runs against another environment without editing**, like VuGen's Runtime Settings attribute:
  `const App_Server = load.config.user.args["App_Server"] || 'shop.example.com';` — a user argument with the
  parameter's name (rts.yml `userArguments`, or `-userArgs`) wins. Recorder, Script Studio and the converters.
  Checked with DevWeb: without the argument the recorded server, with it the new one.
- **Only the servers the script uses are declared** (VuGen `set_server`, DevWeb `const`) — a server seen only in a
  header of a page resource no longer gets a parameter (BUG-105).
- **Script Studio: rename a server** — "Parameterization details" lists the servers with their parameters; Rename
  checks the name (letters, numbers, underscores; not already used), updates vuser_init, every step and main.js,
  and offers Undo. Names chosen in the Recorder still carry over when a recording is opened in Script Studio.
- **Browser prefetches** of a page that is then opened are left out ("browser prefetch") — the page was loaded twice
  (BUG-107). **Google ad pixels** (`www.google.com/ads/…`, `/pagead/…`) are analytics / ads; Script Studio
  uses the same analytics / ads list as the Recorder (BUG-106).
- DevWeb header names are written in lower case everywhere (recordings mixed `Referer` and `referer`).

#### Changed — Generated VuGen scripts laid out the way a performance engineer would (Recorder, Script Studio, converters)

The same rules in all four tools; checked by running old and new scripts with VuGen and DevWeb through a test proxy
(the requests on the wire are the same apart from the fixes listed above).

- **vuser_init** sets, once per Vuser: the servers (`set_server`), the SSL setting (`web_set_sockets_option`) and
  the headers **every** request sends with one value (`web_add_auto_header`). Action starts with one comment saying so.
- **Servers**: `set_server("App_Server", "shop.example.com")` — an attribute with the same name in **Runtime
  Settings › Additional attributes** wins, so one script runs against each environment without editing it. Script
  Studio and the converters now name servers like the Recorder (by role, see above; was `SERVER_HOST` / `ServerHost1`),
  replace the longest name first, and declare only the servers the script calls (the converters used to declare an
  unused `ServerHost`).
- **Headers**: a header is global only when every request sends it with one value (was: 70 % of requests, so the
  others got it too), and never `Authorization`, cookies, DPoP, `Origin` or CSRF headers. In a script made from a
  recording the browser's User-Agent goes to the run-time settings (Browser emulation). `web_set_user` stays in Action.
- **Think time** between steps, none after the last one (the converters added it twice between folders); DevWeb
  uses `load.thinkTime`, which follows the run-time settings, instead of `load.sleep`. Recorder / Studio: 3 s,
  in one `think_time` variable.
- **Mode=HTML** only on page loads; API calls use `Mode=HTTP` (all converter requests).
- Converter VuGen scripts use one indentation (4 spaces) and no runs of blank lines.
- Help: "Server names" updated, new "How the generated VuGen script is laid out".

#### Changed — Recorder: server names in vuser_init, renamable, used everywhere; one row of type buttons; left-out requests hidden (BUG-087 … BUG-090)

- **Server names.** Every server the script calls gets one parameter, named after its domain
  (first `Host_<domain>`; now by role — `App_Server`, `Api_Server` …, see the entry above), the
  same name in VuGen and DevWeb. VuGen sets them once per Vuser in `vuser_init.c` (`set_server`, see the entry above), DevWeb as
  a `const` at the top of `main.js`; Action.c says where they are. They are used in every URL, `Referer` /
  `Origin` / other header, `EXTRARES` / `resources[]` line, form value and body — also `https:\/\/host`
  (JSON) and `https%3A%2F%2Fhost` (`redirect_uri`), the DPoP proof URL, `web_set_user` and
  `setUserCredentials`. Before, only the busiest server and servers named in a header were parameters
  (`ServerHost`, `ServerHost1` …), set at the start of Action.
- The **main application** is the server of the first page of the journey (BUG-087).
- **Rename**: the Domains list shows each server's parameter with a Rename link; the new name is used
  everywhere, in both formats, also after a format change; names the script already uses are refused; Undo.
  The value stays the server name only (no `https://`), so encoded and scheme-less uses are covered too.
- **One row of type buttons** — Doc, Fetch/XHR, JS, CSS, Img, Font, Media, Other, each with its count —
  replaces the "Static assets" tick box plus the "Types in the script" chips, which could show CSS as on while
  "Static assets" still left it out. JS, CSS, Img and Font start off: by default exactly the same requests as
  before are in the script. JSONP or a pixel answering HTML count as Fetch/XHR / Other, so they stay in.
- **Left-out requests are hidden**: each transaction ends with one line — "+ 56 requests left out — 31 analytics
  / ads, 9 CSS …" — with Show; **Show left-out** draws them all, faded, as before (remembered).
  **Collapse all**, **Select mode** and **Show left-out** sit together in the Requests header (they act on the
  list), so the filter row stays one line; the request list hides with an icon, like the other panes.
- **Domains**: the ones in the script first, each with its parameter; the others folded under "Not in the
  script". Leaving out a domain the script seems to need (a page of the journey, a redirect to it, sign-in,
  cookies) asks first.
- **Analytics / ads** also leaves out Google's ad-consent, ad-quality and ad-tag servers and common ad exchanges
  and verification servers (fundingchoicesmessages, adtrafficquality, googleadservices, googletagservices,
  2mdn, casalemedia, criteo, …) — on a recording of a site with ads, 15 requests are now in the script instead of 65.
- Script generation is about 15 % faster on a 20,000-request recording (compiled server patterns are reused).
- A transaction whose START is missing from the recording (END only) now starts where the previous one ended,
  instead of an unmatched `lr_end_transaction` (VuGen) or a lost transaction (DevWeb) (BUG-090).
- Script Studio and the converters name servers the same way (see the entry above).

#### Fixed — Resources missing from every page after the first (BUG-058)

- Files the browser reused from its cache on later pages are listed on those pages again
  (VuGen `EXTRARES`, DevWeb `resources: [...]`), as VuGen records them; VuGen's "Simulate
  browser cache" decides on replay whether to download them. This reverses the "browser-cache
  hits are no longer scripted" rule from the entry below, which left page 2 onwards empty.
  Failed/cancelled loads and repeats on the same page are still skipped.
- Single-page apps: in a transaction with no page load, resources are now listed on the API
  request in progress instead of becoming separate requests; resources that load before a
  transaction's first request attach to it.

#### Fixed — Page resources now match VuGen's own HTML-mode recording (BUG-057)

- Script files (`<script src>`) and files requested by CSS or JavaScript are now listed on the
  page step (VuGen `EXTRARES`, DevWeb `resources: [...]`), as VuGen's own recording lists them.
  Only images and stylesheets named in real page-HTML tags are left to automatic download.
- A file name that merely appears in the page text (inline JavaScript, comments) no longer
  counts as "in the HTML".
- VuGen `EXTRARES` items include `Referer=` only when it differs from the page (e.g. an image
  requested by a CSS file), as VuGen writes them.
- Tool hints, Help and user guides reworded accordingly. Default output is unchanged.
- Also fixed: POST analytics beacons stay their own request (resource lists replay as GET);
  browser-cache hits, failed/cancelled loads and repeated files are no longer scripted (the
  page comment counts them); `data:`/`blob:`/extension URLs are filtered out; iframes named in
  the page HTML download automatically with the page instead of becoming separate steps;
  base64-encoded page HTML is decoded in Script Studio.

#### Added — "Should I include static assets?" guidance in the Recorder, Script Studio and Help

- Recorder: tooltips on the Static Assets / Analytics filters and an ⓘ button that opens the
  guidance under the toolbar. Script Studio: a collapsible hint under Resource Type.
  Help → Recorder: new "Static assets — should I include them?" section; Help → Script Studio
  filter text corrected (static files are not "never relevant").
- Rule: leave static assets out for server/API load; include them for realistic page load and
  for JavaScript-based apps — `downloadHtmlStaticResources` (DevWeb) and `Mode=HTML` (VuGen)
  only download files named in the page HTML; they do not run JavaScript.
- Recorder and Studio user guides, FUNCTIONAL-SPEC and FEATURE-CATALOG updated.

#### Fixed — Static resources belong to their page, not separate requests (BUG-056)

- When static assets or analytics are included (Recorder, Script Studio), CSS, JS, images,
  fonts and beacons are no longer scripted as separate requests. Each one is attached to
  the page that loaded it: resources in the page HTML are downloaded automatically
  (VuGen `Mode=HTML`, DevWeb `downloadHtmlStaticResources`); the rest are listed on the page
  step (VuGen `EXTRARES`, DevWeb `resources: [...]`). DevWeb no longer downloads them twice.
- Script Studio: selecting Img / CSS / JS / Font (or "All") in the resource-type filter now
  actually includes those files — they were always dropped before. Resources used by a
  correlation stay as their own request.
- Default output (static assets excluded) is unchanged.

#### Fixed — Recorder: HTML form POSTs now generated in HTML mode (BUG-055)

- The Recorder tool now writes standard HTML form POSTs (`application/x-www-form-urlencoded`)
  as `web_submit_data` with `ITEMDATA` fields, the same as Script Studio and VuGen's own
  HTML-mode recording, instead of `web_custom_request` with a raw body (URL-mode style).
  JSON, XML, multipart and PUT/PATCH/DELETE requests are unchanged. DevWeb output unchanged.

#### Fixed (BUG-044) — Script Studio: CSRF tokens auto-correlated in single-HAR uploads

CSRF / anti-forgery tokens (`authenticity_token`, `csrf_token`, `__RequestVerificationToken`,
`csrfmiddlewaretoken`, and 11 other well-known field names) were not auto-correlated in
single-HAR Script Studio uploads.

Root cause: The Correlation Advisor Phase 1 only extracts values from JSON response bodies. The
HTML login page that contains `<input type="hidden" name="authenticity_token">` is a Document-type
navigation request and is filtered before Phase 1 runs. Phase 2 (cross-reference) therefore never
finds the token value in its responseValueMap, so no correlation candidate is generated. Two-HAR
diff mode was unaffected because it detects by value CHANGE between sessions, not by source lookup.

Fix: Added Phase 2.5 (`_advCsrfScan`) to `studio-advisor.js`. Scans each request's form body for
fields whose name matches `_CSRF_FIELD_RE` (14 patterns). For each match, backward-scans all
preceding response bodies (including HTML) for the literal token value. Emits high-confidence
boundary-extractor candidates. Integrated into `advisorScan()` between Phase 2 and Phase 3.

Files changed: `src/web/public/studio-advisor.js`

#### Fixed (BUG-043) — Script Studio: login, username and email fields parameterised

Login/username fields (and any other fields matching `PARAM_KEYS_MAP` patterns such as `email`,
`usr`, `user_name`) were not parameterized in generated scripts despite the matching pattern
existing in `PARAM_KEYS_MAP`.

Root cause: In `processField()` inside `detectParams()`, the `corrValues.has(sv)` gate ran before
`matchParamKey(key)`. If the username value (e.g. `"jdoe1"`) was also the value of an
existing correlation (e.g. the same string appeared in a URL path segment that the Advisor had
correlated), the corrValues gate triggered an early return and the param-key check never executed.
The credential field was left hardcoded in the generated script body.

Fix: `isKnownParam = !!matchParamKey(key)` is computed first. Known param fields bypass the
corrValues gate entirely and always emit a `load.params.Username` / `load.params.Password`
substitution. The dynamic-value (isDynamic) gate also uses `isKnownParam` as an override.

Files changed: `src/web/public/studio-codegen.js`

#### Fixed (BUG-042) — Script Studio: current-time timestamps use Date.now()

`timestamp` fields containing a 13-digit millisecond epoch value were generated as
`${getEpochMsDaysAgo(0)}` (returns UTC midnight of the current day) instead of `${Date.now()}`
(current time at runtime).

Root cause: `detectDateSubstitution()` returned `{fn:"getEpochMsDaysAgo", arg:0}` when the value
matched today's date. The helper `getEpochMsDaysAgo(n)` uses `d.setUTCHours(0,0,0,0)`
unconditionally — correct for past days (rewind to start of that UTC day) but wrong for offset=0
(should be current precise time, not midnight).

Fix: Added `if (offsetDays === 0) return { fn: "Date.now", arg: null };` in
`detectDateSubstitution()`. Renders as `Date.now()` with no helper function emitted (`Date.now`
is a JS built-in; `emitDateHelpers()` silently skips it because it has no entry in its `defs` map).

Files changed: `src/web/public/studio-codegen.js`

### Server, deployment and operations

#### Fixed — converter uploads match what the converter supports (BUG-082, BUG-083)

- Certificate private keys (`.key`) are accepted, so a `.pem` / `.crt` + `.key` pair can be uploaded for mutual
  TLS; both certificate boxes accept the same list as the server, and the JMeter box explains that a Java
  keystore (`.jks`) must be converted to `.p12` first.
- Bruno `.bru` environment files are accepted (the converter already read them; the server refused them).

#### Added — scripts/merge-analytics-db.js (moving from two IIS servers to one)

- One-time merge of the second server's analytics database into the main one: backs up the main
  database first, copies every column except the id, skips records already present (safe to run
  twice), `--dry-run` to preview. Tests: `tests/unit/mergeAnalyticsDb.test.js` (skipped where the
  native better-sqlite3 module cannot load, e.g. a newer local Node; run with the server's Node 20).

#### Fixed (BUG-EXT-013) — Conversion / Recorder / Studio 404 at bare site root

Converting a Postman/Bruno collection (or JMX file) failed with "Conversion Failed — Server
error (404): Not Found" whenever the app was reached at the bare root URL (`/`) instead of
`/converter`. The Recorder and Studio tabs would fail the same way — their iframes couldn't
load either.

Root cause: `POST /convert`, `POST /convert-jmx`, `GET /recorder`, and `GET /studio` were only
registered under the `/converter/*` prefix in `server.js`, while the home page itself renders
at both `/` and `/converter`, and the client's `BASE_PATH` (used to build these request URLs)
is computed from `window.location.pathname` — empty at root, `/converter` under the IIS
virtual directory. Every other route in the file (home, downloads, crypto helper files,
`/status`, `/health`, `/analytics/track`) was already dual-registered at both paths; these
four were the exception.

Fix: registered all four routes at both paths using Express array-path syntax, e.g.
`this.app.post(["/convert", "/converter/convert"], ...)`.

Files changed: `src/web/server.js`

## Released versions

### v2.10.14 — 2026-07-10
- Script Studio usage tracking via POST /analytics/track (tool, protocol, filename, requestCount, correlations)
- Admin dashboard redesigned: icon KPI cards, 3-chart top row (doughnut + bar), gradient trend line, heatmap, top machines/files tables, event log with Correlations column
- Exports: CSV, Excel (6 sheets), Word (.docx), Print/PDF

### v2.10.13 — 2026-07-09
- Deleted dead file VuGen-Script-Studio-app.js (was not loaded by any HTML)
- Fixed DPoP copy bug: removed inverted ! from fs.existsSync in devweb/scriptGenerator.js
- Security hardening: rate limiting, path traversal fix, crypto.randomBytes tokens, helmet(), generic error codes, XSS via JMX/cert fixes, file type allowlist, temp cleanup try/finally, font CDN removed, withTimeout() on conversions
- Concurrency limiter (MAX_CONCURRENT=8) + /converter/status endpoint
- BUG-041: toggleCorrRandSelect() restored from git history into studio-ui.js

### v2.10.12 — June 2026
- BUG-039/038: createJWTFromMap() added to lre-utils.js/dat; 5 formatting defects in generatePerRequestJwtCode fixed

### v2.10.11
- BUG-037: All 3 VuGen generators emit "File=lre-utils.js" in SOURCES (not lre-utils.dat); user setup reduced from 3 to 2 steps

### v2.10.10
- BUG-036: perRequestJwt Map in both generators for multi-JWT collections
- BUG-035: VuGen replaceParameters() _ prefix for JWT output vars fixed (latent bug)

### v2.10.9
- BUG-034: setPattern.lastIndex = 0 before every exec() loop (Node 18+ V8 10+ strict lastIndex)
- BUG-033: injectScriptExtractors() bypasses producedAt < i ordering constraint

### v2.10.8
- REFACTOR-001: refreshJWT() in lre-utils.dat — one web_js_run instead of two ternary calls

### v2.10.7
- BUG-032: load.global.access-token invalid JS → sanitizeVarName() in authenticationHandler.parameterize()
- BUG-031: collection-level Bearer auth now creates extractors — analyzeRequests accepts collection object

### v2.10.6
- BUG-031 (part 1): detectConsumedValues step 6 scans collectionAuth for requests with no per-request auth

### v2.10.5
- BUG-030: VuGen replaceParameters() — correlation targets use plain {name}, not {_name}

### v2.10.4
- BUG-029: PKCS#1 key + PEM corruption fixes in jwt-helper.js; normalisePem() handles 4 corruption modes

### v2.10.3
- BUG-028: VuGen JWT init moved to vuser_init.c; expiry-check refresh ternary in Action.c
