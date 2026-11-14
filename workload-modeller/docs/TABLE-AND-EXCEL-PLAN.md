# Workload Modeller — Script table and a simpler Excel sheet (plan)

Status: Part A done · Part B done (2026-11-14, as below — a trimmed scripts sheet rather than a separate Targets sheet).
Built into the portal module (`IMPLEMENTATION-PLAN.md`); Part B follows the portal phases.

## Why

With 50–100 scripts the cards are slow to fill in one by one, and the 21-column Excel sheet that tried to copy
the card was hard to read (many columns, a three-row header, 150 rows of repeated default text, grey stripes).
Decision: the page does the editing, Excel only carries the numbers that come from outside.

- Part A: a Table view of the scripts — one line per script, edited like a spreadsheet, looking like the page.
- Part B: the Excel sheet becomes a small "Targets" sheet (names filled in from the loaded scripts).

## Part A — Table view (UI first)

| Step | What | Status |
|------|------|--------|
| A1 | "Cards / Table" switch in the Scripts bar; the choice is remembered (localStorage `wm-sview`). Before any choice: Cards below 8 scripts, Table from 8 | Done |
| A2 | One row per script. Columns: Script (name, editable, status dot) · Size it by · Target (unit shown in the cell; "Vusers + TPS" has two boxes) · Transactions · Think time (s) · Response time (s) · Pacing (+ its seconds) · Think time at replay · Vusers and TPS worked out · remove | Done |
| A3 | Same behaviour as the cards: amber cell where input is needed, common values as "x — common" placeholders, a field that does not apply is not shown (pacing with "Vusers + TPS" says "follows") | Done |
| A4 | Find, the status filter, Change several, Paste targets, "Go there" (focuses the cell), "Show them", remove with Undo — all work on the table | Done |
| A5 | Keyboard: ↑ / ↓ and Enter move to the same column in the next row (number boxes do not step their value) | Done |
| A6 | Paste a block copied from Excel into a cell: fills down the rows shown, and across the editable cells to the right; one Undo | Done |
| A7 | The chevron at the start of a row opens that script's full card (for the rare fields: 90th percentile, requests, data rows, think-time factor, response time source, pool) | Done |
| A8 | 100 scripts stay quick (a change redraws one row, not the table); the table scrolls inside its own box with the header and the name column fixed; while columns are cut off, a line offers "hide the results"; both themes; phone width without page overflow; weights 400/600/700 only | Done |
| A9 | Page tests (100 scripts: typing, keys, paste, full card, filter, remove, Cards ↔ Table) and SPEC §8b updated | Done |
| A10 | Review fixes: "Change several" renamed "Set for all scripts" (says it replaces each script's value; "Set for the N shown" while filtered); close × and Esc on both panels; the panel checks Fixed / Random pacing seconds and says what is missing inside it; Pacing's seconds fields no longer show while Pacing is "keep"; "Same for every script" renamed "Defaults for every script"; Undo only on messages about a change | Done |
| A11 | Wording pass over every section for non-technical users: "Size it by" → "Target type" with plain choices (TPS — transactions per second, Transactions per hour, Number of Vusers …); "Paste targets" → "Paste from Excel" with three numbered steps, the kind of number chosen before pasting, and the loaded scripts' names as the example; clear hints (units, "1 = today's peak"); card parts renamed; Simple / Detailed explained; Checks no longer repeats the "Almost there" list; Expand / Collapse cards hidden for one script. Old names still read from Excel | Done |
| A12 | "Set for all scripts" renamed "Overwrite all scripts" ("Overwrite the N shown" while filtered); its panel starts "Overwrites now, once" and points to Defaults for values that should stay in force; Defaults starts "Stays in force: fills only empty fields — also in scripts added later" | Done |

Rules kept: the cards stay as they are (no behaviour removed); one state for both views (`state.groups`); every edit
goes through the same `setKey` + `calc` path as the cards; Undo through `clearWith`.

## Review fixes — second opinion (checked against the code, one at a time)

| Step | What | Status |
|------|------|--------|
| R1 | A name that fits more than one script (e.g. "loadrunner_script" for "(24)" and "(22)") changes none and says so — Paste from Excel and the Excel upload; matching: exact, then without punctuation, then without the copy number | Done |
| R2 | Growth factor: raises TPS targets only; Vusers and Iterations stay as entered — said under the field and in Checks | Done |
| R3 | Import: transactions inside other transactions listed (VuGen; DevWeb ends with `.stop()`); vuser_end / load.finalize listed as "at the end"; text in quotes no longer read as a comment ("https://") | Done |
| R4 | Past run under 35% busy: "rough guess" warning | Done |
| R5 | Load generators: CPU and memory added up apart when scripts share a pool (one protocol: unchanged in 320 of 320 cases) | Done |
| R6 | "How it is worked out": Vusers added for a whole-second pacing; the "as soon as possible" / "after + delay" lines. Test length: the longer of pacing and slow iteration | Done |
| R7 | SPEC: pacing cycle table, expected-value model, averages, growth, sizing | Done |

Checked and NOT changed (the engine was already right): interval vs delay pacing, random pacing mean, response-time
limit, GB/MB, iterations started = finished. Not done: a random delay after the iteration (a new LRE option, not a fix).
Tests: `tests/review.test.js` (hand-worked numbers), `tests/scriptReader.test.js`, and the page tests (unclear names, growth note, past-run warning, Cards ↔ Table).

## Part B — Excel "Targets" sheet (after Part A is reviewed)

| Step | What | Status |
|------|------|--------|
| B1 | Download: the scripts sheet trimmed to 10 columns (Script name, Protocol, Kind of script, Target type, Target, Transactions per iteration, Think time, Response time, Think time at replay, Pacing (s)); one purple header row; the loaded scripts filled in, empty rows truly empty; hints on click; an advanced setting a script uses brings its column back; a short second sheet | Done |
| B2 | Upload fills the scripts by name (as before), with Undo and the same "not used" report; Pacing (s) alone: a number = fixed, "auto" = the tool chooses; still reads the older full sheet's headings | Done |
| B3 | The full-width writer replaced (group bands, hint row, prefilled empty rows, "Target means" formula gone); the results workbook is the one-sheet LRE scenario | Done |
| B4 | Page test: 10 columns, empty rows empty, hints, round trip with edits (auto / fixed / kind / new script), advanced columns come back and survive the round trip, older full sheet read | Done |
| B6 | The sheet = what a script ZIP gives + the NFRs (owner): Think time (s) added after Transactions per iteration; targets ordered Transactions per hour, TPS, Vusers | Done |
| B5 | The sheet asks only for the NFRs (owner: still too much): the test duration once above the table; Script name, Script type (protocol), Transactions per iteration, Response time, and ONE of TPS / Transactions per hour / Vusers (a rate + Vusers = Vusers and TPS); think time, pacing, kind and the advanced columns no longer written (still read from older sheets); page test updated | Done |

Open question for Part B: keep "Size it by" in the sheet (a small drop-down) or leave it to the page. Proposal: keep it,
default "TPS", since a requirements sheet sometimes gives volumes per hour.

## Change log

- 2026-11-14 — Part B, step B6: Think time (s) column; Transactions per hour first among the targets.
- 2026-11-14 — Part B, step B5: the sheet trimmed to the NFRs — 7 columns plus the test duration; one target column per kind instead of Target type + Target.
- 2026-11-14 — Part B done (owner: the sheet asked for too much): 23 columns → 10, the rest only when a script uses it;
  empty rows empty; hints on click; older sheets still read. Page test passes; the other page tests updated for the new
  header row.
- 2026-11-12 — Plan written. Part A built (A1–A9): the page tests pass (100 scripts: typing, choices, keys, paste
  block / column / across with Undo, full card under a row, filter + Change several, Go there, remove + Undo, Cards ↔ Table
  remembered, both themes, phone width); older page tests and the 30 engine checks still pass (the 100-card test now
  chooses Cards). Waiting for review before Part B.
- 2026-11-12 — Review of Cards / Table: accepted. Fixed the panel that could not be closed (A10); all page tests pass.
- 2026-11-12 — Wording pass (A11) after review: every label says what a number means; all page tests pass.
- 2026-11-12 — Second-opinion review checked against the code; R1–R7 done; all 15 test scripts pass; Vusers / pacing /
  TPS unchanged in 100 of 100 comparison cases and every script count unchanged on 106 fixture scripts.
