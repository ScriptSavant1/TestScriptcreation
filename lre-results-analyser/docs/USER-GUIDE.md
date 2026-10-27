# Results Analyser — User Guide

For **testers, admins, managers and anyone reading a performance-test report**. No technical
background is needed for sections 1–9; section 10 is for the admin team.

## 1. What this tool does

After a LoadRunner Enterprise (LRE) test finishes, LRE keeps the **raw results**: a folder (or
ZIP) full of files that record every single thing the virtual users did. The Results Analyser
reads those raw files — independently of LRE Analysis — and turns them into:

- a **dashboard** in the browser (tabs: Overview, Transactions, Charts, Errors, Workload,
  Insights);
- downloadable reports: **Excel**, **Word**, **PDF**, **HTML** and **JSON**.

**Your data stays on your computer.** The browser reads the files directly from your disk; nothing
is uploaded to or stored on the server.

## 2. Getting started

1. Open PerfX Studio and click **Results Analyser** in the left sidebar.
2. Click **Choose results ZIP** and pick the run's raw-results ZIP (for example
   `RawResults_2144.zip`) — or unzip it first and click **Choose results folder**, which is faster
   for very large runs. You can also drop the folder or ZIP onto the page.
3. Wait for the progress bar (a 1 GB run takes about a minute). **Cancel** stops the reading.
4. The dashboard opens on the **Overview** tab.

Which files matter: `RawData.eve` (every transaction and request — required), `res*.lrr`,
`RunInfo.ini`, `_t_rep.eve` and `RawData.map` (test name, times, schedule, when each virtual user
started and stopped, names — required), the script files `*.usp`, `*.cfg`, `*.usr` (pacing, think
time, transactions per script), `SqliteDb.db` (error messages) and `sum_data/` (load-generator CPU,
HTTP codes, pass / fail cross-check — optional).

## 3. Words you will see

| Word | Plain meaning |
|---|---|
| **VUser** (virtual user) | A simulated person using the application. 941 VUsers = 941 people at once. |
| **Script** | The list of steps a VUser repeats (log in, search, open an alert, log out…). |
| **Transaction** | One timed step inside a script, e.g. `00_000_Login`. |
| **Iteration** | One pass through the whole script. A VUser repeats its script many times. |
| **Instance** | One single execution of a transaction (one login by one VUser at one moment). |
| **Response time** | How long one transaction instance took, in **seconds**. |
| **Load generator (LG)** | A machine that runs the VUsers. |
| **Controller** | The machine that ran the test. |
| **Steady state** | The period when all VUsers were running together — the "real" test window. |
| **Ramp-up / ramp-down** | VUsers being started / stopped at the beginning / end. |
| **Pass / Fail** | A transaction instance that completed OK / reported an error. |
| **Error** | A message logged by a VUser (e.g. HTTP 500). One failure can log several errors. |
| **TPS** | Transactions per second. |
| **Hits** | HTTP requests sent to the application. |
| **Throughput** | Bytes received from the application. |
| **Think time** | Deliberate pauses that imitate a person reading. **Not** included in response times. |
| **Pacing** | How often each VUser starts a new iteration. |
| **SLA** | The response-time target you agreed (e.g. "P90 under 3 s"). |
| **Apdex** | A 0–1 user-satisfaction score: 1 = everyone happy, < 0.85 = users notice slowness. |

### The statistics columns

Imagine a transaction ran 10 times, all passed, with these times (seconds): 1, 1, 1, 1, 1, 1, 1, 1, 2, 10.

| Column | Meaning | In the example |
|---|---|---|
| **Count** | How many times it ran (passed + failed instances) | 10 |
| **Min** | The fastest single run | 1 |
| **Avg** | Total time ÷ count | 2.0 |
| **Max** | The slowest single run | 10 |
| **Std Dev** | How spread out the times are (0 = all identical) | 2.7 |
| **P50** (median) | Half the runs were faster than this | 1 |
| **P90** | 90 % of runs were this fast or faster | 2 |
| **P95 / P98 / P99** | 95 % / 98 % / 99 % of runs were this fast or faster | 10 |

Min, Avg, Max, Std Dev and the percentiles use the **passed** instances only; failed instances are
counted but not timed, as LRE does.

**Tip:** the average can hide problems; P90/P95 describe what most users experienced, and Max
shows the worst single case.

## 4. The top bar and settings

- **Run name and verdict** — the test name and an overall result: *No significant issues*,
  *Review findings* or *SLA not met*.
- **Export buttons** — **Excel**, **Word**, **PDF**, **HTML** and **More** (result data as JSON, and
  a redacted JSON that is safe to share).
- **? Explanations** — shows or hides the plain-English explanations on every panel (remembered in
  this browser).
- **New analysis** — open another run.
- **Settings summary** — a line under the header shows the current steady state (or analysis
  window) and SLA. Click **Change** to edit them:
  - **Analysis window** — by default the detected steady state. Pick a start and end date and time
    and press **Apply** to analyse another period; **Detected** goes back to the steady state. Every
    tab and export follows this window.
  - **SLA** — choose the percentile (P90 by default, or P95, P99, P50) and a default threshold in
    seconds, then **Apply**. You can also type an SLA per transaction in the Transactions tab. SLAs
    are remembered for this test in your browser.

Every panel can be folded away; **Collapse all / Expand all** works on the whole tab, and the page
remembers what you folded.

The charts use time slots chosen automatically (see 5.3). The results table always counts every
single transaction — see section 7.

## 5. The tabs

### 5.1 Overview

- **Verdict card:** the overall result, a one-line summary (VUsers, steady-state length, TPS,
  % failed, errors) and the top issues, with links to all findings and to the transactions.
- **Key figures (tiles):** Peak VUsers (and how many stopped early), Test duration, Steady state,
  Transactions per second, Transactions passed, Transactions failed, Errors logged (and how many
  different errors), and either SLA met or the slowest transaction (P90). Long durations are
  shortened ("1 d 3 h 37 min"); hover for the exact value.
- **Web traffic — whole test:** total hits, hits per second, total throughput and throughput per
  second, with peaks.
- **Load, throughput and errors over time:** one chart.
- **Slowest transactions — P90:** click a transaction for its details.
- **Findings:** the most important automatic findings (see Insights).
- **Test details — scenario, schedule, machines** (folded by default): scenario, project, run,
  start and end time, how the test ended, scripts, load generators, Controller, LoadRunner version,
  load behaviour; **Schedule — planned vs actual** (big differences mean the test did not run as
  planned); and the machines with their VUsers and CPU / memory peaks.

### 5.2 Transactions

The main results table, one row per transaction, grouped by script. A transaction used by several
scripts (Login, Logout…) has one row per script, with that script's own figures.

- **Steady state / Full run** switch at the top: *Steady state* (or *Analysis window*, if you
  changed it) uses only the analysis window — best for judging performance; *Full run* includes
  ramp-up and ramp-down. **Every column follows the chosen view**, including Pass and Fail.
- **Columns:** Transaction, Count, Pass, Fail, Fail %, Min, Avg, Max, Std dev, P50, P90, P95, P98,
  P99, TPS, and in the steady-state view SLA (s), Result (PASS/FAIL) and Apdex, plus a small
  **P90 trend** line. Hover over a column title for its meaning.
- **Sort** by clicking a column header; **filter** by typing part of a name.
- **Click a row** to open its details in a side drawer: count, failed, Avg, P90, P95 and Max;
  behaviour over time (average, P90, P95, max); the distribution of response times; a latency
  heatmap; and the figures per load generator. The drawer says which period its figures cover.
  Press **Esc** or the close button to close it.

For extremely large tests (more than 20 million transaction instances) an orange note above the
table says so: Count, Min, Avg, Max and Std dev are still exact, and the percentiles are within 0.5 %.

### 5.3 Charts

Pick transactions on the left (*5 slowest*, *5 busiest*, *All*, *None*) and the response-time
metric (Avg, P50, P90, P95, P99, Max). The shaded band is the analysis window. Drag the slider or
scroll inside a chart to zoom. The line above the charts says how many seconds each point covers
(chosen automatically: at most 1,500 points over the whole test — for example 30 s for an 8-hour
test, 120 s for a 27-hour test). Each point is one time slot: its Avg is the average of the
transactions in that slot, its Max the slowest one in that slot.

| Chart | What to look for |
|---|---|
| Load and throughput | VUsers and TPS over time. TPS should be flat during steady state. |
| Response time over time | Lines should be flat. A rising line = slowing down; a jump = something changed. |
| Transactions per second | Per-transaction throughput; dips usually mean slow responses or errors. |
| Latency heatmap | Dots per time × response-time band. Two bands = two behaviours (e.g. cache hit/miss); a dark top band = slow tail. |
| Throughput vs response time | Each dot is a time slot. A curve that bends upward at high TPS marks the capacity limit. |
| Errors over time | When errors happened — compare with response-time spikes. |
| HTTP responses per second | Count per HTTP status code (200 = OK, 4xx/5xx = problems). |
| Throughput (bytes received) | Data downloaded per second. |
| Load-generator CPU and memory | Should stay below ~85 %. Above that, the load generator itself may slow results down. |
| P90 per load generator | Lines should overlap. One LG consistently higher = LG/network issue, not the application. |
| Response time per VUser | One row per VUser. A single bright row = one problem user/data record. |

### 5.4 Errors

- **Grouped errors:** similar messages are merged (numbers and IDs are replaced by `<n>`), with
  count, code, script, how many VUsers saw it, which load generators, first and last time. Each
  group shows a real example message, including the script line.
- **Errors over time** chart.
- **Error log:** every error, searchable by message, code, VUser or load generator.

### 5.5 Workload

- **Workload design:** per script — VUsers, load generators, pacing, think time, iterations
  planned vs achieved (≥ 95 % is green), and how many VUsers stopped early, with a totals row.
- **Load generators — VUsers and resource usage:** VUsers per machine, CPU and memory peaks; the
  Controller is marked.
- **VUsers:** every virtual user with its group, script, machine, when it started and stopped
  (local time), iterations and average response time.

### 5.6 Insights

Automatic checks with a short explanation and the numbers behind them (open **Evidence** to see
them). The banner counts the findings by severity.

| Severity | Meaning |
|---|---|
| **High** | Likely affects the test result — act on it. |
| **Medium** | Worth investigating. |
| **Low / Info** | For information. |
| **Good** | A check that passed. |

Checks include: VUsers and steady state as planned (including VUsers that stopped early); pacing
achieved; transactions getting slower over time (trend) or changing level at a moment (step);
spikes, and whether errors happened at the same time; a slower load generator; LG CPU and memory;
errors and failed transactions; SLA and Apdex; stable throughput; clock-skew samples.

### How the numbers were produced

The page has no separate validation tab. The method is explained in **About this report** in the
Excel, Word and PDF reports, and the technical self-checks (which files were found, and OK / INFO /
WARN / FAIL checks) are in the **JSON** export. A *FAIL* self-check means the results cannot be
trusted (for example `RawData.eve` missing); *WARN* means something unusual that is explained in
the text.

## 6. Exports

| Export | Use it for |
|---|---|
| **Excel** | Sharing and further analysis — see below. |
| **Word** | An editable report with charts (landscape), for sign-off documents. |
| **PDF** | Opens a print-ready landscape report; choose *Save as PDF*. |
| **HTML** | The same report as a single web page. |
| **More → Result data (JSON)** | All result data, including the self-checks, for tools and automation. |
| **More → Result data — redacted** | Safe to share outside the client: host names become LG1, LG2…; IP addresses, script paths and error texts are removed. |

The Word and PDF reports open with an executive summary that mirrors the Overview (key figures,
web traffic, top findings, what was checked and is fine), then the test facts, the workload
design, the transaction tables (Count, Pass and Fail per period), every error group with its real
message, and the charts (two per page).

### Excel sheets

| Sheet | Contents |
|---|---|
| **Test Overview** | Cards: *Test Metadata* (project, test name, LRE result folder, Run ID, workload type), *Execution Time* (start, end, duration, time zone, run status), *Run Details* (scenario, goal profile, load behaviour, schedule), *High-Level Metrics* (passed, failed, failure rate, errors, steady state, **Results calculated** — "Every instance — exact, no granularity"), *Performance* (TPS, hits/s, total hits, throughput, peak VUsers), *VUsers per LG Count*, *HTTP Response Codes*, *Schedule — planned vs actual*. |
| **Transactions – Full Run** | One merged script cell per group, a row per transaction and a **Subtotal** row. Columns as in 5.2. |
| **Transactions – Steady State** | The same for the analysis window, with SLA result and Apdex. |
| **Workload Model** | Scripts, load generators and every VUser. |
| **Errors** | Grouped errors and the error log. |
| **Charts** | All report charts, two per row (only in the Excel exported from the page). |
| **Time Series** | One row per time slot (the slot size is stated in the sheet title): VUsers, TPS, errors, and per transaction count / avg / P90 / P95. |
| **LG Health** | CPU, memory and disk per load generator. |
| **Insights** | All findings with evidence. |
| **About this report** | How the figures were calculated and which files were used. |

Some LRE fields (Test ID, Timeslot ID, "Executed by") are not stored in the raw results, so they
cannot appear in the report.

## 7. Why some numbers differ from the LRE HTML report

**Short answer:** this tool reports what each transaction really took. LRE's summary table
*smooths* the numbers before it shows Min, Max, Std Dev and 90 Percent. Count, Pass, Fail and
Average are not affected by smoothing, so they always match.

**What smoothing means.** LRE first puts the transactions into small time slots and takes the
**average of each slot**. It then shows the fastest slot average as "Minimum", the slowest slot
average as "Maximum", and so on.

Example — three logins in the same slot took 1 s, 1 s and 10 s:

| | This tool | LRE summary table |
|---|---|---|
| What is used | 1, 1, 10 | the slot average: 4 |
| Max | **10** (the real worst case) | **4** |
| Min | **1** | **4** |
| Average | 4 | 4 — the same |

So LRE's Maximum is lower and its Minimum is higher, its Std Dev is smaller, and the Average is
identical. Transactions that run rarely (one per slot) are not changed by smoothing — that is why
*some* rows match exactly and others do not.

**Proof from a real run (2144).** LRE's own raw summary file (`sum_data/graph_4.dat`) records a
single `14_03_Search_ClickResultLink` that took **41.66 s** and one
`14_04_Back_to_MyItems` that took **2.04 s**. This tool shows those values (and the 45.80 s
instance next to them). The LRE summary table shows maxima of 7.421 s and 0.363 s.

**Is it the "(do not Include Think Time)" filter?** No. This tool also removes think time. If it
were the cause, the averages would differ too — and they match for every transaction.

**Which numbers should I use?** Use this tool's numbers to find real slow transactions and to
judge SLAs. Use LRE's table only when a figure must be quoted exactly as LRE shows it.

### Granularity — what it is and where it is used

*Granularity* is the length of the time slots used to group transactions (5 s, 2 min, 10 min…).

| Where | Granularity? |
|---|---|
| Results table (Transactions tab, Excel transaction sheets, reports) on the page | **No** — calculated over every single transaction, whatever the size of the test |
| Charts and the Excel Time Series sheet | **Yes** — chosen automatically |

**Why does the page not group the results table?** Because grouping hides the truth: with
5-minute slots, a 45-second transaction that sits in a slot with nine 4-second ones would show as
about 8 seconds. That is exactly why LRE's table looks different. Large tests do not need it
either — the tool reads the file in a stream and keeps the statistics compactly, so even hundreds
of GB are handled without grouping.

**What if my numbers must match an LRE report that has Data Aggregation switched on?** An admin
can produce LoadRunner-style averaged figures with the command line (`--granularity`, see
section 10), choosing the same granularity as in LRE Analysis (Analysis → Tools → Options → Result
Collection → Data Aggregation → Aggregation Configuration). Count, Pass, Fail and Average do not
change; Min, Max, Std Dev and the percentiles are then taken over the slot averages.

## 8. How to read a report in five minutes

1. **Overview — verdict and tiles.** Did the test run as planned (VUsers, steady state length)?
2. **Insights — High and Medium findings.** Read these first.
3. **Transactions (steady state).** Sort by P90. Compare with the SLAs. Look at Fail %.
4. **Charts — Response time over time.** Flat lines are good; rising lines or spikes need
   explaining.
5. **Errors.** What failed, how often, and when.

## 9. Questions and answers

| Question | Answer |
|---|---|
| A transaction shows 0.000 s Min. | One instance really had identical start and end times in the raw data. It is shown as it is. |
| Pass and Fail change when I switch between Steady state and Full run. | That is expected: every column follows the chosen view. |
| Hits/s, HTTP codes or LG Health show "not available". | The matching file was not in the ZIP (e.g. `sum_data/` for the LG monitor). |
| Errors show "needs SqliteDb.db". | Include `SqliteDb.db` in the ZIP. |
| A transaction is marked "unnamed". | Its internal id could not be matched to a transaction name, so the id is shown instead. |
| The run is very large and the browser is slow. | Use the command line (section 10). Reading takes roughly one minute per GB. |
| An orange note says "Large run … histograms". | The test has more than 20 million transaction instances. Count, Min, Avg, Max and Std dev are exact; percentiles are within 0.5 %. For exact percentiles ask an admin to run the command line with `--exact-limit`. |
| The charts look too spiky / too flat. | The page chooses the slot size automatically. An admin can produce charts with a coarser slot size from the command line (`--chart-granularity`). The results table does not change. |
| Can I choose the granularity of the results table? | Not on the page, on purpose — see section 7. LoadRunner-style averaged figures are available from the command line. |
| Can I share the report outside the client? | Use **More → Result data — redacted**, or check the report for host names first. |

## 10. For the admin team

- **Where it lives:** `lre-results-analyser/` in the PerfX Studio repository. The page is served
  at `/results-analyser` (also under `/converter`) and loaded inside the portal; static files at
  `/ra`, `/ra/engine`, `/ra/report`.
- **Privacy:** processing happens in the user's browser (Web Worker). The server only serves the
  page; it never receives result files.
- **Command line** (large runs, automation):

  ```bash
  node lre-results-analyser/cli/analyse.js "D:\Results\RawResults_2144.zip" --xlsx run.xlsx --html run.html
  ```

  Options: `--xlsx`, `--docx`, `--html`, `--out result.json`, `--sla 3`, `--sla-pct 95`,
  `--window 600-28800` (seconds from start), `--granularity 200` (LoadRunner-style averaged
  figures; default exact), `--per-vuser` (with `--granularity`: average each VUser separately),
  `--chart-granularity 300` (charts / Time Series only), `--exact-limit 100000000` (exact
  percentiles for very large runs; ~12 bytes per instance), `--redact`, `--quiet`.
  Exit code 0 = OK, 1 = a self-check failed, 2 = usage or read error.
- **Very large runs (hundreds of GB):** run the CLI on a machine close to the files, with more
  memory for Node, e.g. `node --max-old-space-size=16000 lre-results-analyser/cli/analyse.js … --exact-limit 500000000`.
  Without `--exact-limit` the tool still works and switches to histogram percentiles above 20 M instances.
- **Matching an LRE report with Data Aggregation:** `--granularity N` (`--lre-granularity` is an
  older name for the same option) produces LoadRunner-style smoothed figures in the reports. The
  page's own Granularity control is hidden for now (`FEATURES.granularity = false` in `web/app.js`).
- **Tests:** `npx jest lre-results-analyser` (synthetic data only — never commit real results).
- **How it works:** `README.md` (method table), `docs/TECHNICAL-DESIGN.md` and
  `docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md` (byte layout of `RawData.eve`, validation against
  LRE on runs 59 and 2144).
- **Validated:** names, counts, pass, fail, averages, hits, HTTP codes and throughput match LRE
  exactly on runs 59 (14 transactions) and 2144 (516 transactions).
