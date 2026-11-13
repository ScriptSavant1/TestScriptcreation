# Workload Modeller — implementation plan (portal)

Status: Phases 1–5b, 7–14 done · Phase 6 (Part B, the Targets Excel sheet) waits for the owner's review. Nothing committed. Updated at the end of every phase.

The Workload Modeller turns what each script must reach (TPS, transactions per hour, Vusers, a share of the total,
iterations) into an LRE scenario: Vusers, pacing, ramp-up and ramp-down, load generators, the LRE settings to type in,
and an Excel workbook. The reviewed draft (Cards / Table views, Fill from scripts, Overwrite all scripts, Defaults,
Paste from Excel, the second-opinion fixes) moves into PerfX Studio as its own module, built like the Results Analyser.
The calculation spec stays the reference for the numbers.

## Rules this plan keeps

- **Nothing is sent to or saved on the server.** Scripts, HAR files and Excel sheets are read in the browser; the server
  only serves static files (no upload route, no temp file, no database row except the usual anonymous usage ping).
- **Its own module**, like `lre-results-analyser/`: `workload-modeller/engine` (UMD, browser + Node), `web` (page),
  `tests` (Jest), `docs`. Shared code is reused, never copied: `portal/ds.css` (design system), `portal/frame-guard.js`,
  `portal/track.js`, the Analyser's `zip.js` and `vendor/exceljs.min.js`.
- **Same look as the other tools**: design-system tokens and components, both themes, system fonts, weights 400/600/700,
  text contrast ≥ 4.5:1, no emoji, the tool header band; checked by the design audit.
- **Fast and light**: about 200 KB on first open; the 950 KB Excel library loads only the first time Excel is used;
  100 scripts load in under 2 s; a change redraws one row; no polling, no timers left running.
- **No behaviour change** to the reviewed draft: the draft's Playwright tests run against the portal page and must give
  the same results; the 30 engine checks and the review tests become Jest tests.

## Impact analysis

| Area | Files | Change | Risk |
|---|---|---|---|
| New module | `workload-modeller/**` | engine, reader, page, tests, docs | none outside the module |
| Server | `src/web/server.js` | page route `/workload-modeller` (+ `/converter/…`), static `/wm` (+ `/converter/wm`); usage tool `workload` | static files only; same pattern as `/results-analyser` and `/ra` |
| Design tokens | `src/web/public/portal/ds.css` | tool colour `--c-work` (both themes) | additive |
| Portal shell | `partials/shell.ejs`, `portal/shell.js`, `index.ejs` | sidebar entry, page `workload`, iframe panel, feature flag, theme sync | additive; the old switchers stay the source of truth |
| Home | `partials/home.ejs` | a 7th Quick-actions card | layout checked at every width |
| Help | `partials/help.ejs`, `tests/unit/helpPageParity.test.js` | section `hacc-workload` (15 sections) | every existing word kept; parity test updated for the new section only |
| Usage statistics | `server.js` BROWSER_TOOLS, `analytics/reports.js`, `exporters/xlsx.js`, `exporters/docx.js`, `views/admin.ejs` | tool `workload` in every list | additive; unknown tools already fall back |
| Audits | `regression-tests/tools/audit/audit.js` | the new page in the design audit | test tool only |
| Not touched | `web.config`, the converters, Recorder, Studio, HAR Explorer, Results Analyser code | | |

## Phases

| Phase | What | Status |
|---|---|---|
| 1 | Module skeleton; engine + script reader moved unchanged (reader's zip path relative to the module); the 30 engine checks, the review checks and the reader checks as Jest tests in `workload-modeller/tests` | Done — `engine.test.js` (27), `review.test.js` (9), `scriptReader.test.js` (13): 49 pass, incl. empty and malformed input; `npm test` 930 pass |
| 2 | Page: the draft split into `web/index.html` (markup), `web/app.css`, `web/app.js` (model, inputs, table, results), `web/excel.js` (Excel files), `web/page.js` (page behaviour, Fill from scripts, Undo) — same order, same code; draft banner removed; ExcelJS loaded on first use; theme from the portal (`lreSetTheme`); usage ping; server routes | Done — 12 page tests give the same output on the served page as on the draft (only timings differ); first open 11 files ≈ 245 KB, ExcelJS (948 KB) only on the first Excel use; no console errors |
| 3 | Portal: `--c-work`, sidebar entry (group "Plan", between "Create scripts" and "Analyse"), shell page, iframe panel, Home card, Help section, quick search, usage statistics lists | Done — portal walk-through passes: 7 Home cards (4 + 3), sidebar "Plan", address stays …/converter/, theme follows the portal both ways, fill + Excel inside the portal, Help section, quick search finds it, a tool page opened on its own lands in the portal with the tool open, no page overflow at phone width; usage rows `workload` (feature + count only) |
| 4 | Proof: `npm test`; the draft's Playwright tests on the portal page (same results); design audit (both themes, every width); performance (load time, memory with 100 scripts, first-open size); no request leaves the browser except the page's own files and the usage ping | Done — see the measurements below |
| 5 | Documents: CHANGELOG, CLAUDE.md file map, README, FUNCTIONAL-SPEC, module README; state notes | Done — also BUGS.md (BUG-133, BUG-134: older issues found on the way); SPEC and the table plan moved into `docs/` (one copy) |
| 5b | After review: load generators by machine type (on-premise Windows server 8 cores / 32 GB; AWS c6a.4xlarge Linux or Windows 16 vCPU / 32 GB; another machine), "All the formulas" on the page, `docs/USER-GUIDE.md` (every formula, worked example) also in the documentation site, Getting Started / Portal Guide / Help updated, draft folder deleted | Done |
| 6 | Part B — the small "Targets" Excel sheet (see the table-view plan) | After review of 1–5 |
| 7 | Load-generator assignment and the LRE setup table (owner's request, see below) | Done |
| 8 | After the owner's screen review: start rate shared by scripts ramping together (by group); whole-second pacing within 1% of the TPS; LRE setup column order, "Start" explained, "hide the inputs" hint; toolbar rows; tile wording | Done |
| 9 | Ramp steps never at once (BUG-135); buttons redesigned (outputs in the top bar, every action recognisable, "Fill in with Excel"); Undo only after a change (BUG-136); phone layout | Done |
| 10 | Look pilot: purple brand, solid section boxes with tinted header bars, filled tabs / choices / table headers (one block at the end of `web/app.css`, tokens only); the other tools after the owner's review | Done |
| 11 | Load generators by the team rule: Vusers per machine for web pages / API calls per machine type (on-premise 100 / 250, AWS 200 / 500), the script's pages and API calls read from the script (kind on the card, own figure), the smallest of rule / CPU / memory decides; extra machines carry Vusers (no idle spare) | Done |
| 12 | Fill each machine (default): machines filled up, a script that does not fit whole runs as LRE groups name_1, name_2 (LRE setup one row per group, by-group schedule per group); one group per script kept as a choice, warns when it costs machines; extra machines: fewest groups | Done |
| 13 | Team settings file (`config/workload-settings.json`, `engine/settings.js`, served no-cache) and the one-sheet Excel ("LRE scenario") | Done |
| 14 | LRE 26.3 schedule as it is typed: every group Start Group Immediately, all ramping over the longest ramp (`fitPlan`), Duration padded so all stop together; times HH:MM:SS; LRE's field names as columns; rows by script name (no name_1 / name_2) | Done |

## Phase 7 — which script runs on which load generator, and one LRE setup table

Asked by the owner: with 20 scripts and 4 load generators, say which script runs on which machine (LG1, LG2 …), and give
one table to build the scenario from — script, Vusers, load generators, ramp-up, duration (DD:HH:MM:SS), ramp-down,
pacing, think time — without showing the same information on several screens.

Rules (`assignLoadGenerators` in the engine; the page, the LRE text and Excel all use its result):
- Each script's load = its peak Vusers (highest step of a stepped test) × its share of one machine, by CPU and by memory
  (the machine type's figures, or the pool's "Vusers per machine").
- TruClient (real browsers) gets its own machines; Web HTTP/HTML, DevWeb and other protocols may share.
- A script that needs more than one machine gets its own machines, its Vusers split evenly (LRE splits a group's Vusers
  evenly over its load generators — to be confirmed by the owner on 26.3).
- The other scripts, largest first, go onto the least-busy machine with room (spread), so every machine stays under 70%.
- If whole scripts need more machines than the plain total, Checks says so and names the script that, split into two
  groups, would save one (the owner decides; nothing is split automatically).
- Names LG1, LG2 … numbered on from one pool to the next. (Phase 11: no idle spares — extra machines carry Vusers.)

Screens: Details › **LRE setup** (new, first) replaces the LRE settings text tab (its text stays for Copy LRE settings,
folded under the table); **Per script** keeps only the calculation results; **Load generators** shows one row per
machine. Excel: the "LRE schedule" and "Load generators" sheets follow the same tables.

Impact: `engine/workload-engine.js` (new function; the load-generator count now comes from the assignment, so it can be
one higher than the plain total when whole scripts do not pack — said in Checks), `web/app.js`, `web/excel.js`,
`web/index.html` (tab names), tests (`engine.test.js` / `review.test.js`: the memory-heavy example uses "other protocol",
since TruClient no longer shares machines), USER-GUIDE §4.7, SPEC §7, Help. Nothing outside the module except Help.

## Measurements (Phase 4, portal on a local server, Edge)

| What | Result |
|---|---|
| First open of the tool | 125 ms, 8 files, 216 KB; the Excel library (948 KB) not loaded until Excel is used |
| 100 scripts (Fill from scripts) | 0.85–0.98 s, shown as the table |
| Type a target in a table of 100 | plan updated in 0.25 s (one row redrawn) |
| Switch 100 scripts to cards | 0.26 s |
| JS memory (portal tab, after garbage collection) | 3.4 MB with the tool idle; 4.9 MB with 100 scripts; 5.7–5.9 MB after each of 5 rounds of load + Start over — flat, no leak (the rise is once, on first use) |
| Design audit (Home, the tool start + model, Help; both themes) | one text font, weights 400/600/700, 0 contrast failures, 0 page errors, 0 external requests |
| Server | static files only; usage rows hold the feature and a count, never names or values |

## Decisions

- Usage tool name `workload`; shell page `workload`; portal tab `workload`; `<html data-portal-tool="workload">`.
- Sidebar group "Plan" (a test is planned after the scripts exist and before results are analysed).
- The draft folder stays as the baseline for the parity tests until Phase 4 passes; then the owner decides whether it
  is removed (no duplicate code kept afterwards). Phase 4 passed: the draft folder now holds only the draft's code
  (index.html, engine, reader), kept until the owner decides; the spec and plans live in this folder.
- Tool colour lime, not the draft's purple (too close to Script Studio's violet in the sidebar).
- Home lays seven cards out as four then three (two columns with the last full width on smaller screens).

## Change log

- 2026-11-12 — Plan written (the spec's §10 had five lines and predated the table view, script reading and the review fixes).
- 2026-11-13 — Phase 14 done (owner's LRE 26.3 screens: Start Group Immediately / With delay; Initialize; Start and
  Stop gradually "N every HH:MM:SS"; Duration counted from the end of the group's ramp). "Start after" was right but
  harder to type; every group now starts immediately and ramps over the same length, and a group whose ramp ends a
  little earlier gets that much more Duration, so all are at full load and stop together. Times in HH:MM:SS (LRE's
  format, was DD:HH:MM:SS), columns named after LRE's fields, rows by script name. Tests: fitPlan (never after the
  target, never faster than the rate), 300 random plans (all immediate, ramp + Duration equal), page tests.
- 2026-11-13 — Phase 13 done (owner: change the Vusers per machine later without code; the workbook had too much): the
  team settings file, checked value by value (tests/settings.test.js: shipped file valid and equal to the built-in
  values, wrong values named and replaced, machine types, the engine uses smallest group and fast loop); Download Excel
  is one sheet with the owner's columns plus "Start after" (needed for a by-group schedule) and a total row. Page test:
  real, changed, wrong, missing and broken settings file; the sheet matches the plan.
- 2026-11-13 — Phase 12 done (owner: "553 users on 6 LGs, LG1 and LG2 with 63 each — waste"): with one group per
  script LRE's even split left machines at about 60%. Fill each machine: 3 machines needed instead of 5 for that plan
  (4 with the extra one; only one script runs as two groups). Load generators assigned before a by-group schedule so
  each LRE group gets its own ramp. Tests: assignment (both ways), lgRule (300 random plans in both modes: every Vuser
  placed, LRE groups add up, no machine idle or over the limit), page tests; engine 13–27 ms for 100 scripts.
- 2026-11-13 — Phase 11 done: the team rule (owner's practice: about 100 Vusers per on-premise machine for web scripts,
  200 to 300 for APIs, AWS twice) as a third limit next to CPU and memory, blended by the script's share of page
  requests (read from VuGen C, DevWeb and HAR — both protocols can hold either); a script typed in counts as web pages.
  Extra machines replace spares and carry Vusers (halving search + one at a time to the busiest script). Tests:
  `tests/lgRule.test.js` (rule, mix, kinds, own figures, fast loop, extra machines, 1,000 random plans: none idle, every
  Vuser placed, no limit exceeded), reader tests for pages and API calls; page test for the card, pool, AWS figures,
  Excel round trip and the load-generator tab.
- 2026-11-13 — Phase 9 done: BUG-135 (step chooser + ramp-down floor; 1,159 all-at-once steps in 1,000 random plans → 0;
  481 of those plans get a different schedule, all from this fix), BUG-136 (Undo shown on every message). Every button
  listed and given one of five styles (main action, action, quiet control with icon, choice, in-text link); Copy LRE
  settings and Download Excel in the sticky top bar only; "Excel sheet" renamed "Fill in with Excel". Tests: button test
  (no text-only button, outputs in view at the bottom of the page, copy feedback, Undo only after a change, no overflow
  at 1920 / 1366 / 390 px in both themes), `pacingAndRamp.test.js` +2; page tests unchanged except the button list;
  design audit clean.
- 2026-11-12 — Phase 8 done: on 2,000 random scripts the new engine gives whole-second pacing everywhere except 94 short
  pacings (kept to 0.1 s so the TPS stays right), never a TPS below the target, and no case further above the target
  than before (19 cases over 1%, all from 0.1 s rounding that was there before; 2 fewer than before). By group, 20
  scripts of 25 Vusers start 2 per second in all (was 8); one script alone is unchanged. Tests:
  `pacingAndRamp.test.js` (10); `npm test` 954 pass; page tests unchanged except the intended ramp-up (2 min 4 s for
  250 Vusers by group) and the new hint; design audit clean; 100 scripts load in about 0.9 s.
- 2026-11-12 — Phase 7 done: `packPool` + `lgText` in the engine; `res.machines` (LG1 …), each group's `lgs`, the LRE
  text names them; check `lg-packing`. Page: Details › LRE setup (new, first), Per script without Vusers / pacing, Load
  generators one row per machine; Excel "LRE schedule" and "Load generators" sheets the same. Tests: `assignment.test.js`
  (13, incl. the owner's example 200 / 30 / 200 at 100 per machine → 5 machines), the memory-heavy example in
  `review.test.js` now "other protocol"; `npm test` 944 pass; page tests unchanged except the tab names and Per script
  columns (on purpose); 100 scripts recalculate in 0.28 s with 25 machines; design audit clean. The even split is how LRE
  is believed to work — the owner checks it on 26.3 after the commit.
- 2026-11-12 — Phase 5b done (owner's review): machine types `LG_TYPES` in `web/app.js` — the engine is unchanged (it
  still takes cores and memory); cores count what the system shows, so AWS uses its 16 vCPUs; disk is not used in the
  sizing. "All the formulas" (`formulas(sc)`) shows the page's own headroom, spread and start rate; every line checked
  against the engine. User guide with a worked example whose numbers come from the engine. The 12 page tests give the
  same output as before; the new machine-type test, the portal walk-through and the design audit pass; the
  documentation site builds (37 pages) and its check passes on every page in both themes. The draft folder was deleted.
- 2026-11-12 — Phase 5 done: CHANGELOG (Workload Modeller, Portal), CLAUDE.md (module file map, usage tools, frame
  guard), README (sidebar, tools, routes, privacy, layout, flags, libraries, docs, tests), FUNCTIONAL-SPEC §12b, module
  README, BUGS.md. Scan of every changed file: no names, local paths or secrets. `npm test` 931 pass.
- 2026-11-12 — Phase 4 done: `npm test` 931 pass; the 12 page tests identical on the portal page; portal walk-through
  passes; design audit clean after one fix (light-theme "ready" chip 4.32:1 → the Analyser's darker green, page only);
  measurements above. Found on the way, not changed: the full design audit stops at a Recorder fixture that is not in
  the repository (`regression-tests/tools/recorder/fixtures/bookmarklet-markers.har`); the audit gained two Workload
  Modeller stops (start, model) that need no fixture.
- 2026-11-12 — Phase 3 done: sidebar group "Plan"; shell page `workload`; panel `#portal-workload`; Home grid for seven
  tools (two columns with the last full width; four then three on a 12-column grid); Help `hacc-workload` (15 sections,
  contents, tools table, What's New, "Seven tools"); admin and reports know `workload` (unit "scripts"). Two changes to
  the page found on the way: "Complete the inputs first" is a page message instead of a browser alert, and no usage
  ping when no file was made; inside the portal the tool's own bar keeps only Simple / Detailed and Start over (its name
  and theme button are in the portal's bar), as the other tools hide theirs.
- 2026-11-12 — Phase 2 done: `web/index.html`, `app.css`, `app.js`, `excel.js`, `page.js` (the draft's code in its own order);
  routes `/workload-modeller` + static `/wm` (server.js), usage tool `workload` accepted; tool colour `--c-work` lime
  (#a3e635 / #4d7c0f) — the draft's purple was too close to Script Studio's violet next to it in the sidebar; theme key
  `wm-theme` + `lrePortalInit` / `lreSetTheme`; usage ping on Excel, scripts sheet, Copy LRE settings and Fill from
  scripts (feature and number of scripts only).
- 2026-11-12 — Phase 1 done: engine and reader in `workload-modeller/engine` (headers no longer say draft; the reader finds the
  Analyser's zip.js from the module); 49 Jest tests.
