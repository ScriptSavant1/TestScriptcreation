# Workload Modeller — Script table and a simpler Excel sheet (plan)

Status: Part A in progress · Part B waiting for Part A.
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
| B1 | Download: one sheet "Targets", columns Script name · Target · Size it by · Response time (s) · Notes; one plain coloured header row; the names of the loaded scripts already filled in; an empty cell means "keep the page's value"; a second sheet with short help | Not started |
| B2 | Upload fills the scripts by name (as now), with Undo and the same "not used" report; still reads the older 21-column sheet's headings | Not started |
| B3 | Remove the 21-column writer (grey/amber rules, input prompts) once B1 is accepted; keep the results workbook as it is | Not started |
| B4 | Tests: round trip, old sheet, names not found | Not started |

Open question for Part B: keep "Size it by" in the sheet (a small drop-down) or leave it to the page. Proposal: keep it,
default "TPS", since a requirements sheet sometimes gives volumes per hour.

## Change log

- 2026-11-12 — Plan written. Part A built (A1–A9): the page tests pass (100 scripts: typing, choices, keys, paste
  block / column / across with Undo, full card under a row, filter + Change several, Go there, remove + Undo, Cards ↔ Table
  remembered, both themes, phone width); older page tests and the 30 engine checks still pass (the 100-card test now
  chooses Cards). Waiting for review before Part B.
- 2026-11-12 — Review of Cards / Table: accepted. Fixed the panel that could not be closed (A10); all page tests pass.
- 2026-11-12 — Wording pass (A11) after review: every label says what a number means; all page tests pass.
- 2026-11-12 — Second-opinion review checked against the code; R1–R7 done; all 15 test scripts pass; Vusers / pacing /
  TPS unchanged in 100 of 100 comparison cases and every script count unchanged on 106 fixture scripts.
