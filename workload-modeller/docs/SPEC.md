# Workload Modeller — calculation spec

Status: built. Every formula is in `engine/workload-engine.js`; the page is `web/`; the script reader `engine/script-reader.js`.
Nothing is in the portal yet; implementation starts after review.

## 1. The rule

For each script group:

    TPS = Vusers × transactions per iteration ÷ pacing
    iteration time = response times + think time
    pacing must be ≥ iteration time (otherwise iterations overrun and the TPS drops)

Vusers, pacing and TPS: give two, the third follows. Response time is needed only to
choose a pacing, or when there is no pacing. When it is unknown and a pacing is given,
the tool reports the response-time limit instead:

    response-time limit per transaction = (shortest pacing − longest think time) ÷ transactions

The limit is an AVERAGE over the script's transactions (one slow transaction may be over it while others are under).

Pacing, as LRE runs it (the cycle = time from one iteration's start to the next):

| Pacing | Cycle | Used as |
|---|---|---|
| Fixed interval P | the longer of P and the iteration | P; an iteration longer than P → "not possible" (the real TPS it drops to is shown) |
| Random interval a..b | the longer of the drawn interval and the iteration | (a+b)/2 — over a long run the rate is 1 ÷ the average interval, whatever the spread; a shortest interval below the iteration → "not possible" |
| As soon as possible | the iteration | iteration mean |
| After the previous iteration + delay d | the iteration + d | iteration mean + d (a random delay is not offered) |

## 2. Inputs

### Test
- Test type: load, soak, stress, capacity, spike. Sets the recommended LRE workload type and the duration default.
- Full-load duration (minutes), growth factor (multiplies the TPS targets: TPS, volume, share, the TPS of "Vusers and
  TPS"; Vusers and Iterations stay as entered — Checks says so when the factor is not 1), scenario total TPS (only for
  "share" scripts).
- Detailed view: licence limit, steps for stress / capacity (% of the target), hold per step.

### Per script (one Vuser group in LRE)
Target type (formerly "Size it by"), one of:

| Method | Input | Target TPS |
|---|---|---|
| TPS | target TPS | as given × growth |
| Volume per hour | business transactions per hour | volume ÷ 3600 × growth |
| Share | % of the scenario total | total × growth × % |
| Vusers | Vusers | none: TPS is an output |
| Vusers and TPS | both | as given × growth; pacing follows |
| Iterations | iterations at full load | iterations × transactions ÷ full-load seconds (no growth) |

One iteration: transactions that count for the TPS, think time (total, as recorded), average response time per
transaction without think time (as LRE reports it by default; may be unknown), and where it comes from (SLA, baseline run, recording, estimate). Detailed view: 90th
percentile, requests per iteration (hits per second), data rows available.

Replay settings (LRE runtime settings):
- Pacing: auto (the tool chooses), fixed, random between two values, as soon as possible, after the previous iteration + delay.
- Think time: as recorded, ignore, multiply, random % of recorded.

### Load generators
Pools, each of one machine type: on-premise Windows server (8 cores, 32 GB, 230 GB disk), AWS c6a.4xlarge Linux or
Windows (16 vCPU, 32 GB), or another machine (its cores and memory entered). Choosing a type fills its size; changing a
size makes the pool "another machine"; the pool keeps a name the user gave it. A new pool starts as AWS c6a.4xlarge Linux.
The list is `LG_TYPES` in `web/app.js`; cores = the CPUs the system shows (vCPUs on AWS); disk is not used in the sizing.
Also: the team rule (Vusers per machine for web pages / API calls — on-premise 100 / 250, AWS 200 / 500, filled by the
type unless typed), machines available, extra machines (default 1 in the first pool; they carry Vusers), and (detailed)
Vusers per machine per protocol from a past run. Each script runs on one pool. Per script: kind (from the script, web
pages, API calls; the reader counts pages and API calls — `pages`, `pageShare`) and (detailed) its own Vusers per machine.

## 3. Calculations per group

Let T = transactions per iteration, h = headroom (default 25%), r = random spread (default ±15%).

Think time (mean / longest): as recorded t / t; ignore 0 / 0; multiply t×f / t×f; random t×(min+max)/200 / t×max/100.

Iteration: mean = RT avg × T + think mean; longest = RT 90th (or avg) × T + think longest.
- RT avg × T is exact when RT avg is the average over the script's transactions; time outside transactions is not
  counted. Transactions inside other transactions are all counted (as LRE counts them), so their time counts twice —
  the import note warns (on the safe side: a longer pacing).
- "Longest" adds the 90th percentiles, which is longer than the 90th percentile of a whole iteration: on the safe side.
  It is used only for warnings, the "random" pacing style and the test length.

Target known (λ = target ÷ T iterations per second):
- Fixed pacing P: Vusers = ⌈λ × P⌉.
- Random pacing a..b: P = (a+b)/2, Vusers = ⌈λ × P⌉; TPS min at b, max at a.
- Auto: shortest pacing b = ⌈iteration mean × (1+h)⌉ (random style: also ≥ longest ÷ (1−r)); Vusers = ⌈λ × b⌉;
  then whole-second pacing: exact when up to 10% (at least 2) more Vusers give one; else the fewest Vusers in that
  range whose pacing ⌊Vusers ÷ λ⌋ keeps the TPS ≤ 1% above the target; else (short pacing) ⌊Vusers ÷ λ⌋ to 0.1 s as
  before. Never below b, never below the target. Random style: pMin = ⌈P(1 − r)⌉, pMax = 2P − pMin (same average).
  Needs the response time. "How it is worked out" shows b, the Vusers, the pacing, how many Vusers were added and
  how far the TPS lands above the target.
- As soon as possible / after + delay: cycle = iteration mean (+ delay); Vusers = ⌈λ × cycle⌉; needs the response time.
- Vusers and TPS: pacing = Vusers ÷ λ. Pacing < iteration mean → not possible; minimum Vusers = ⌈λ × iteration × (1+h)⌉.

Vusers only:
- Fixed / random pacing: TPS = Vusers × T ÷ P. No response time needed; the limit is reported.
- Auto: pacing = ⌈iteration × (1+h)⌉; needs the response time.
- As soon as possible / after + delay without a response time: a what-if table (response time 0.25, 0.5, 1, 2, 3, 5 s →
  iteration, TPS) and the ceiling Vusers × T ÷ (think + delay).

Checks per group: think time longer than the pacing (bad), pacing below the mean iteration (bad, with the fix),
below the longest iteration (warn), below iteration × (1+h) (warn), no fixed pacing (warn: the TPS follows the
response times), rounding changed the TPS by > 1% (info), response-time limit (ok when the response time is known,
info when not).

## 4. Ramp-up and ramp-down (chosen by the tool)

    wanted ramp-up = max( min( max(60 s, 3 × longest pacing), min(30 min, full load ÷ 4) ), Vusers ÷ start rate )

- 3 pacings: the Vusers' iterations interleave evenly and the start-up burst stays small.
- Start rate (default 2 new Vusers per second, editable): log-ins are the heaviest step; it always wins over the cap.
- "Start X Vusers every N seconds": the fewest Vusers per step whose interval is a round number
  (1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 45, 60, 90, 120, 180, 300 s) and gives a ramp within 10% of the wanted one;
  never faster than the start rate.
- Ramp-down: half the ramp-up, at up to twice the start rate, never shorter than Vusers ÷ the stop rate; Vusers finish their
  current iteration. Steps: per step size the nearest listed interval that is not faster than the rate; all at once only
  without a rate (the spike burst) or for one Vuser.
- Basic schedule by group: every group starts immediately and ramps over the longest ramp L any group needs on its own;
  a quicker group is slowed down by `fitPlan(V, L, its rate)` — the fewest Vusers per step, at any whole-second interval up to
  300 s, whose steps end within 10% before L (never after it), else the longest that fits. LRE counts Duration from the end of each group's ramp, so a
  group's Duration = steady state + (L − its ramp): all reach full load by L and stop together.
- Basic schedule by group: the scripts ramp at the same time, so the start rate is shared — each group's rate = rate ×
  its Vusers ÷ all Vusers (at least 1 / 300 s); the stop rate likewise. Σ starts per second ≤ the start rate.
- Spike: the burst starts within one pacing (at most 1 minute), then stops all at once.

## 5. LRE workload types

| Type | Output |
|---|---|
| Basic schedule, by test | one Start / Duration / Stop for all Vusers; Vusers per group with the percentage |
| Basic schedule, by group | every group: Start Group Immediately, Initialize just before it runs; its own Start / Duration / Stop, all ramping over the same length (the longest), Duration padded by any difference, so every group reaches full load and stops together |
| Real-world schedule | stress / capacity: a Start + Duration per step (default 50, 75, 100, 125, 150% / 100–200%), hold = max(10 min, 5 pacings); spike: normal load, burst, recovery |
| Goal-oriented | goal = TPS, Vusers min 50% / max 150% of the plan, run time after the goal is reached |

Recommended by test type: load / soak → basic by group; stress / capacity / spike → real-world (a warning when a
basic schedule is chosen for a stepped test). Every action is written in LRE's wording ("Start 60 Vusers: 3 Vusers every
00:00:04 (HH:MM:SS)"). Names to be checked against the LRE 26.3 screens before release.

## 6. Totals and timeline

The schedule is simulated per Vuser (start time, stop time; last started stops first). It is an expected-value
model: each Vuser starts an iteration at its start and then every cycle (the pacing's mean, or the iteration (+ delay)
without pacing). A plan whose iterations overrun is marked "not possible" rather than simulated. Iterations are counted
per phase: ramp-up, full load (the last hold), ramp-down; with gradual exit every iteration started also finishes.
Transactions = iterations × T. Timeline: Vusers and expected TPS per bucket (≥ 10 s, about 240 points). Test length =
end of the schedule + the longer of the pacing and the longest iteration (a stopped Vuser finishes its current
iteration). Data rows: warn when total iterations exceed the rows available.

## 7. Load generators

    team rule  = 1 ÷ ( p ÷ webPerLg + (1 − p) ÷ apiPerLg )      p = share of page requests (kind web = 1, api = 0, unknown = 1)
    by memory  = (memory − 2 GB) × 1,024 × 70% ÷ MB per Vuser;   by CPU = cores × Vusers per core × 70%
    Vusers per machine = min(team rule, by CPU, by memory); the script's own figure, else the pool's past-run figure, replaces all
    machines needed = ⌈ max( Σ peak Vusers ÷ team rule, Σ peak Vusers ÷ by CPU, Σ peak Vusers ÷ by memory ) ⌉
    total = needed + extra (cut to available); the Vusers spread over all of them

CPU and memory are added up apart, so a CPU-heavy and a memory-heavy script can share a machine (one protocol alone
gives the same as Vusers ÷ Vusers per machine). A "your figure" capacity counts against both. Memory is in MB throughout.

Fill each machine (`fillPool(items, limit, spread)`, scenario `lgFill: "fill"`, the default): largest first; whole onto the
fullest machine with room (spread = n: n machines open, the least busy), else fill the fullest machine with room for at
least 5 Vusers and continue (no remainder under 5); new machines once none has room. `res.lreGroups` = one LRE group per
script and set of machines LRE can share evenly (sizes within 1 Vuser): `{ id, scriptId, gi, name (name_k, internal),
part, parts, vusers (planned, in proportion to the peak split), lgs }`. A by-group schedule is planned per LRE group (the
load generators are assigned before the schedule; all start immediately and reach full load together); LRE setup, the
copy text and the Excel sheet have one row per LRE group, shown by the script's name only (add the script once per row). Check `lg-groups` lists the split scripts.
Extra machines: `bestOf` the filled and the whole layouts spread to n (`spreadTo`) and a grid of limits × (pack, spread)
(`fewestGroups`): exactly n machines, none empty, none over the limit, the fewest groups, then the coolest machine.
One group per script (`lgFill: "whole"`) — Assignment (`packPool(items, limit, more)`): three limits per machine (CPU, memory, team rule; 1 = full). Per pool,
browser scripts (TruClient) and the others on separate machines; a script needing more than one machine gets ⌈load ÷
limit⌉ machines of its own (never more than its Vusers), Vusers split evenly (the first machines take the remainder);
then the others, largest first, onto the least-busy machine where all three stay ≤ the limit; machines as many as
⌈max(Σ CPU, Σ memory, Σ rule) ÷ limit⌉ of the class to start with, one more when a script fits nowhere whole (check
`lg-packing`, with the split into two groups that would save it). Extra machines: a halving search for the lowest limit
that still fits into needed + extra machines (starting at total ÷ machines), then the machines left one at a time to the
own-machine script with the busiest machines (`more`). Names LG1 … across pools. Checks: `lg-basis` (what set the count),
`lg-extra-cut`, `lg-fast` (more than 2 requests per second per Vuser). Each group gets `lgs` = [{ name, vusers }]; the LRE text names them ("Load generators: LG1, LG2 (100 Vusers each)").

From a past run (Results Analyser, load-generator health): Vusers per machine = Vusers it ran × 70 ÷ max(CPU %, memory %).
A straight line: when the machine was under 35% busy the page says the figure is a rough guess.
Protocol starting assumptions (memory MB per Vuser / Vusers per core) are editable and are not vendor figures:
Web HTTP/HTML 5 / 50, DevWeb 3 / 80, TruClient 350 / 2, other 10 / 30. Checks: machine size missing, more machines needed
than available, licence limit.

## 8. Outputs

Screen: plain-language summary, tiles (Vusers, TPS with range, load generators, test length, iterations, transactions,
hits per second), chart, checks, tabs: LRE setup (one row per LRE group by script name: Vusers, load generators, pacing,
think time, Start (ramp-up), Duration (steady state), Stop (ramp-down) in HH:MM:SS; a shared schedule's steps under it; the copy text folded underneath), per
script (calculation results only), load generators (one row per machine: scripts and Vusers, expected CPU and memory,
requests per second, share of the team rule; per script kind, Vusers per machine and what decided it), how it is worked out (with the what-if tables and all the formulas).
Simple view hides the detailed fields; Detailed shows them all.

Phases (under the chart): a bar aligned to the chart and a table — phase, from, to, length on the test clock. Basic
schedule: Ramp-up · Steady state (full load, "measure here") · Ramp-down · Last iterations finish (up to one pacing or one slow iteration after the
schedule ends). Stepped tests: every start / hold / stop; the 100% step (stress, capacity) or "normal load" (spike) is
the one marked "measure here". Tiles: "Steady state" (length and its window) or "Held steps" (N × hold, the 100% step's
window); "Test length" says its parts in words. The LRE settings text and the Excel Summary end with the window(s) to
use in the analysis.

Excel (`workload-model.xlsx`): one sheet, "LRE scenario" — test type, LRE workload type, load generators, total test
length, steady state, the schedule line (by group: Start Group Immediately, Initialize just before it runs; otherwise
the shared schedule's steps); one row per LRE group by script name: Vusers, % of Vusers, response time, think time,
pacing, load generators, Start (ramp-up), Duration (steady state), Stop (ramp-down) in HH:MM:SS, expected iterations
(the script's total × the group's share of its Vusers), expected TPS; a total row; two notes.

## 9. Team settings

`config/workload-settings.json`, served at `wm/config/` with `Cache-Control: no-cache`, read once when the page opens by
`engine/settings.js` (`WorkloadSettings.read(json)` → `{ settings, problems }`; every value range-checked, a wrong one
keeps the built-in value and is named; unknown keys ignored; `DEFAULTS` = the built-in values = the shipped file, checked
by `tests/settings.test.js`). Applied to the starting values only: machine types (`LG_TYPES`, "Another machine" last), the
first pool when untouched, `headroomPct`, `maxStartRate`, `minGroup`, `fastLoopRps`, the protocol assumptions, the busy
limit (`TEAM.limitPct`). The Load generators section says which figures are in use (`#settings-note`).

## 8a. Fill from scripts (`engine/script-reader.js`)

All scripts at once: choose or drop any number of files; each script becomes (or updates, by name) a card.
- Script ZIP, Web HTTP/HTML: transactions = `lr_start_transaction` in the Action files (vuser_init and vuser_end run once
  per Vuser and are not counted; listed as "at the start" / "at the end" — e.g. login in vuser_init, logout in vuser_end); think time = sum of `lr_think_time(n)`; requests = `web_url`,
  `web_custom_request`, `web_submit_data`, `web_submit_form`, `web_link`, `web_image`, `web_rest`; replay think time from
  `default.cfg` [ThinkTime] Options (NOTHINK → ignore); the script's own pacing is reported and replaced by the plan's.
- Script ZIP, DevWeb (main.js + rts.yml): transactions = `.start()` calls inside `load.action` (declared anywhere;
  load.initialize / load.finalize listed as "at the start" / "at the end");
  think time = `load.thinkTime(n)` / `load.sleep(n)`; requests = `new load.WebRequest`; replay think time from rts.yml.
- One ZIP may hold several scripts (every folder with a .usr, or main.js + rts.yml). Comments are ignored; text in
  quotes is kept (a "https://" is not a comment).
- Transactions inside other transactions (a start while another is open; DevWeb ends one with `.stop()`): listed, all
  counted. Calls in if / else branches are each counted — the count is what is written, not what runs.
- HAR: steps = its pages (Recorder transactions), else split at pauses over 1.5 s; response time per step and pauses
  from the timings (one user: a first estimate, marked "From the recording").
- A script zipped without its .usr also counts: a folder with Action.c (Web HTTP/HTML), or a main.js with `load.action` (DevWeb).
- Not a ZIP / HAR, or no script inside: listed under "N files were not read", with the reason, in amber; the
  headline says "N scripts filled in from M files". The same script in two files: the last one is used, and said.
- Loops are counted once (said in the import note); targets are never guessed — each card asks for its TPS / volume / Vusers.
- To confirm on 26.3: the [ThinkTime] Options and IterationPace values VuGen writes for each choice.

## 8b. Layout for many scripts

- Every section folds (chevron or a click on its title); folded sections show a one-line summary; remembered per browser.
- Script and pool cards fold too. Folded, a card shows its important values: what it must reach, one iteration
  (transactions, think time, "ignored" when it is), response time, pacing and the plan — values still missing in amber.
  A click on the summary opens the card; Expand all / Collapse all. Filled-in scripts arrive folded.
- Card header: name, protocol, source file, a short status (ready, needs input, estimate, not possible); the open card
  starts with its plan in one sentence.
- Each column has a bar: its name, Expand all / Collapse all (its sections), and a hide arrow on the edge it folds to.
  Every section folds on its own, the Result card too (folded, it shows Vusers, TPS, load generators and test length).
- One column hides at a time, to a strip, and the other gets the full width: the Results strip keeps Vusers, TPS and
  the checks count; the Inputs strip keeps the number of scripts and whether any needs input. A click on a strip
  brings the column back. Remembered per browser; on a narrow screen the strip is a bar.
- Clear: Reset on The test, Load generators and Fine tuning (back to the defaults), Clear all on Scripts, × on every
  script card, and Start over in the top bar (every section). Each clear can be undone from the message that follows
  (8 s); nothing asks "are you sure".
- Many scripts (50–100 are common): a folded script is one row under column heads (Script, Protocol, Target, One
  iteration, Response, Pacing, Plan, Status); when the list is narrower (both columns shown) Protocol and One iteration
  move into the row's tooltip, and on a phone a row becomes two lines. A click anywhere on a row opens it; one script
  is open at a time (the others fold; Expand cards still opens all). Full wording of each cell is in its tooltip.
- Table view (plan: `PLAN-SCRIPT-TABLE.md`): "Cards / Table" in the Scripts bar, remembered per browser; before a choice,
  Cards below 8 scripts and Table from 8. One line per script, edited like a spreadsheet: name (with a status dot),
  Target type, Target (unit in the box; "Vusers + TPS" has two boxes), transactions, think time, response time, pacing
  (+ its seconds), think time at replay, and the Vusers and TPS worked out. The box still needed is amber, common values
  are placeholders, a field that does not apply is not shown ("follows" for pacing with Vusers + TPS). ↑ / ↓ and Enter
  move down the same column (number boxes do not step); a block pasted from Excel fills down the rows shown and across
  the boxes to the right (a pacing or think-time choice adds its boxes before the next value; empty cells keep the value;
  values that fit nowhere are counted; one Undo). The chevron opens the script's full card under its row (one at a time)
  for the rare fields. Find, the filter, Overwrite all scripts, Paste from Excel, Go there, remove and Undo work the same. The table
  scrolls inside its own box with the heads and names fixed; while columns are cut off a line offers "hide the results".
  A change of choice redraws that row only.
- From 6 scripts: Find (by name) and a filter All / Needs input / Not possible / Ready with counts. From 2 scripts:
  "Overwrite all scripts" (formerly "Overwrite all scripts"; label "Overwrite the N shown" while Find or the filter narrows the list; response time, pacing,
  think time or one target TPS — REPLACES each shown script's own value once, on Apply; "keep" / empty leaves it; pacing
  Fixed needs its seconds and Random both waits, said inside the panel; closes on Apply, Close, × or Esc) and "Paste from Excel" (three steps: copy name + target from Excel, say what the targets are, paste; the box's example uses the loaded scripts' names; two columns: name and number, as TPS, per hour, Vusers, share or
  iterations; names matched ignoring case, a "(2)" copy suffix and punctuation; names with no card are listed). Both undoable.
- "Defaults for every script" ("stays in force", from 2 scripts, above the list): one response time and one target TPS for every script
  that has no value of its own — a script's own value always wins, and values taken from here show in italics (folded
  row) and as the field's placeholder (open card). Target TPS is either "Each script" (every script without a target
  gets it) or "In total" (the total minus what scripts with their own target reach — TPS, volume or share — shared
  evenly by the rest; when nothing is left it says so). Applies to scripts added later too; the Excel sheet keeps
  only the scripts' own values (an empty cell = the common value). "Overwrite all scripts" is the one-off overwrite.
- Messages offer Undo only after a change that can be undone (never on "nothing to change").
- Wording: every label says what a number is and its unit (TPS = transactions per second, Vusers = virtual users);
  card parts "Target", "One iteration — one run through the script", "Replay in LRE — runtime settings"; the card's
  "Needs:" line does not repeat the script's name. Earlier choice names (e.g. "It must reach a TPS", column
  "Size it by") are still read from Excel. While the plan is not ready, Checks shows one line pointing to the list
  under Result instead of a second copy of it.
- The find / filter bar shows from 4 scripts and always while a filter is on. A filter never hides silently: a script
  whose status changes (it just got its target) stays in view until the user changes the filter, an open script is
  never hidden, and "No script matches the filter — Show all" when nothing is left.
- Excel sheet (round trip, for many scripts): "Fill in with Excel" downloads `workload-scripts.xlsx` with one row per script
  already on the page (plus empty rows). Coloured group bands (Script · What it must do · One iteration · Pacing and think
  time at replay · Load generators and data), tinted column heads with a red * on the needed ones, a hint row, frozen
  heads and names, drop-down lists (protocol, size it by, pacing, think time, pool) and number checks; a second sheet
  "How to fill it in". The filled-in sheet is dropped on the page like a script (scripts and sheet together are fine):
  names update their cards, new names add scripts, an empty cell keeps the page's value, values that are not a list
  choice or a number are listed and not used. Undoable.
  The sheet mirrors a script card: the same fields (incl. response time from, 90th percentile, requests, multiply /
  random % for think time) and the page's own words in the drop-down lists (older short words still read). Empty rows
  already hold the page's defaults (protocol, size it by, response time from, pacing, think time, pool). "Target means"
  is a formula that says what Target holds for the chosen "Target type" (as the card's label changes). Conditional
  formatting: grey = does not apply to the row's choices (as the card hides the field), amber = still needed
  (target; pacing seconds; response time when the tool chooses the pacing — left out when "Defaults for every script"
  gives the value). Works in Excel 2007 and later.
- The same missing input on more than 3 scripts: one line ("97 scripts have no target yet") with "Show them" (the
  filter); more than 5 response-time limits: one line pointing to Details › Per script. The import note for more than
  8 scripts counts the warnings by kind and folds the full list. A ZIP with 100 scripts reads in about 2 s.
- Result before everything is filled in: a numbered list of what is still missing, no empty chart. A missing input is
  amber ("to fill in", not "to fix") and each has "Go there" (opens the card, puts the cursor in the field).
- Response time on the card says when it is needed (auto pacing, the field outlined: "your SLA will do") and when it
  is optional (fixed or random pacing: Checks then give the slowest response time the plan allows).

## 9. Test cases (Jest: `tests/engine.test.js`, `tests/review.test.js`)

1. 10 TPS, 4 transactions, 1 s, 15 s think → 60 Vusers, 24 s pacing, 9,000 iterations at full load.
2. 50 Vusers, 24 s fixed pacing, no response time → 8.33 TPS, limit 2.25 s.
3. 50 Vusers, as soon as possible, no response time → what-if table, ceiling 13.33 TPS, not ready.
4. Vusers only, auto pacing, no response time → asks for the response time or a pacing.
5. 100 TPS with 50 Vusers, 20 s iteration → not possible, at least 625 Vusers.
6. Login 2 / Search 6 / Payment 2 TPS → 16 / 42 / 12 Vusers, 8 / 14 / 24 s, total exactly 10 TPS.
7. Random pacing 20–28 s → TPS 8.33 (7.14 – 10); low-headroom warning.
8. Random think time 50–150% with 24 s pacing → longest iteration 26.5 s, warning.
9. Shares 60 / 40 of 10 TPS; shares not adding up to 100% → error.
10. 36,000 per hour × 1.5 growth → 15 TPS.
11. Step plan: 60 Vusers, about 72 s → 3 Vusers every 4 s; 1 Vuser → starts at once.
12. Basic by group: aligned full load, iterations = Vusers × duration ÷ pacing per group.
13. Stress 50–150% → peak 90 Vusers; 14. stress with a basic schedule → warning; 15. spike → peak 120.
16. Machine sizing, missing size, from a past run (200 Vusers at 45% CPU / 60% memory → 233), two pools with mixed protocols.
17. Think time longer than the pacing; 18. iterations method + data rows short; 19. random auto pacing ≥ longest iteration;
20. Vusers rounded up → info; 21. licence limit; 22. iterations by phase add up, timeline peak = Vusers;
23. 2,000 Vusers → never faster than 2 per second.

## 10. Implementation

Built as its own module in PerfX Studio: the phases, the impact analysis and the measurements are in
`IMPLEMENTATION-PLAN.md`; the Cards / Table views and the simpler Excel sheet (Part B) in `TABLE-AND-EXCEL-PLAN.md`.
Later ideas: "Use measured values" (response times and load-generator capacity from the Results Analyser), a Word
summary, and applying pacing / think time to a script's runtime settings (default.cfg / rts.yml).
