# LRE Results Analyser

Analyses LoadRunner Enterprise **raw results** (`RawData.eve`, `_t_rep.eve`, `res*.lrr`, …)
independently of LRE Analysis, and produces a dashboard plus Excel, Word, PDF and HTML reports.
It is the **Results Analyser** tool of the PerfX Studio portal.

**Nothing is uploaded or stored on the server.** The browser reads the files straight from the
user's disk (a Web Worker streams them), so a run of any size works. The same engine also runs
from the command line for runs of hundreds of GB.

- User guide (admins, testers, non-technical readers): [docs/USER-GUIDE.md](docs/USER-GUIDE.md) · [docs/USER-GUIDE.html](docs/USER-GUIDE.html)
- Technical design for developers (data flow, every calculation, granularity): [docs/TECHNICAL-DESIGN.md](docs/TECHNICAL-DESIGN.md)
- Plan and phases: [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)
- File formats: [docs/SPEC-file-formats.md](docs/SPEC-file-formats.md) and [docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md](docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md)

**Status:** Phases 0–5 are built and validated against LRE Analysis on runs 59 and 2144 (see
*Validation against LRE Analysis* below).

## Use it in the portal

Click **Results Analyser** in the portal's left sidebar, then **Choose results ZIP** or **Choose
results folder** (faster for very large runs — nothing is unzipped). The page is served at
`/results-analyser` and loaded inside the portal; opened on its own in a browser tab it sends the
user to `…/converter/` with the Results Analyser open (`src/web/public/portal/frame-guard.js`).

| Tab | Shows |
|---|---|
| Overview | Verdict card with the top issues, eight key-figure tiles, "Web traffic — whole test" (hits, throughput), load / throughput / errors chart, slowest transactions (P90), findings, and a collapsed "Test details" panel (scenario, schedule planned vs actual, machines) |
| Transactions | Summary for the steady state (or analysis window) or the full run: count, pass, fail, fail %, min/avg/max, std dev, P50–P99 (with P98), TPS, SLA, Apdex, P90 trend. Pass and fail follow the chosen view. Click a row to open a side drawer with its behaviour over time, distribution, latency heatmap and figures per load generator |
| Charts | Load, response time, TPS, latency heatmap, TPS vs RT, errors, HTTP codes, throughput, LG CPU, RT per LG, RT per VUser |
| Errors | Errors grouped by code and message pattern, plus a searchable error log |
| Workload | Scripts (pacing, think time, iterations planned vs achieved), load generators, VUsers |
| Insights | Automatic findings with evidence, and an overall verdict |

The settings summary under the header shows the current window and SLA; **Change** opens the
editor. The **analysis window** defaults to the detected steady state and is chosen with date / time
pickers (**Apply**; **Detected** goes back to the steady state). **SLA** thresholds can be set as a
default (with the percentile: P90, P95, P99 or P50) or per transaction in the Transactions tab; they
are remembered per test in this browser. Every figure, chart and insight updates when either changes.
Every panel can be collapsed ("Collapse all / Expand all", remembered). **New analysis** starts again.

Exports: **Excel** (10 sheets from the page, including Charts; 9 from the CLI), **Word** (editable,
landscape, with charts), **PDF** (print-ready landscape report: choose "Save as PDF"), **HTML**, and
under **More**: **JSON** (full or redacted).

There is no Validation tab: the technical self-checks are in the JSON export (and the CLI console).

### Explanations on every panel

Each chart and table has a one-line explanation and an expandable "How to read it", written for non-technical readers.
The text lives in `web/notes.js` (edit the wording there). Column titles and overview tiles show help on hover.
The "? Explanations" button turns them off (remembered per browser).

## Command line

```bash
node lre-results-analyser/cli/analyse.js "D:\Results\Run_59" --xlsx run59.xlsx --html run59.html
node lre-results-analyser/cli/analyse.js Results_59.zip --sla 3 --docx run59.docx
```

| Option | Meaning |
|---|---|
| `--xlsx f.xlsx` / `--docx f.docx` / `--html f.html` | Excel workbook / Word report (no charts from the CLI) / print-ready HTML report with charts |
| `--out f.json` | Full result model |
| `--sla 2.5`, `--sla-pct 95` | SLA threshold in seconds for every named transaction, and the percentile it applies to (default 90) |
| `--window 600-28800` | Analysis window in seconds from scenario start (default: the detected steady state) |
| `--granularity 200` | LoadRunner-style figures: Min / Max / Std Dev / percentiles over 200-second averages, all VUsers together (as LRE Analysis with Data Aggregation on and "VuserID" ticked). Count, Pass, Fail and Average stay exact; charts use the same slots. Default `exact` (every transaction on its own). `--lre-granularity` is an older name for the same option |
| `--per-vuser` | With `--granularity`: average each VUser separately (LRE "VuserID" not ticked). `--all-vusers` (the default) is kept for older command lines |
| `--chart-granularity 300` | Charts and the Time Series sheet only, in seconds (default auto) |
| `--exact-limit 100000000` | Instances kept for exact percentiles (default 20,000,000 ≈ 240 MB, ~12 bytes each). Above it percentiles come from histograms (within 0.5 %) and a warning is shown |
| `--redact` | Host names become LG1, LG2…; IP addresses, script paths and error text are removed. Use it before sharing output outside the client |
| `--quiet` | No console summary |

Exit code: `0` = OK, `1` = a self-check failed (e.g. a required file is missing), `2` = usage or read error.
`SqliteDb.db` is read with `better-sqlite3`, or with the bundled `sql.js` when the native module
does not match the Node version.

## Try it without client data

```bash
node lre-results-analyser/tools/make-demo-run.js C:\Temp\DemoRun --zip
```

This writes a realistic but fully **synthetic** results folder and ZIP: 27 VUsers, 3 h, 2 load
generators, with sum_data and SqliteDb.db. It has built-in issues for the insights to find: a
gradual slowdown, a step change, a spike with HTTP 500 errors, a slower load generator on one
transaction, and high LG CPU.

## How the numbers are computed

| Figure | Method |
|---|---|
| Transactions | `RawData.eve` transaction records — sub-type `0x00C00FC0 + flags` (flag 0x8000 = failed); one record per transaction instance. Layout: `docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md` |
| Response time | End − start − wasted − think time of each record (seconds) = LRE's "do not include think time". Statistics use passed transactions; failed ones are counted (as LRE does) |
| Transaction names | Record ids are per VUser; the first record of each (VUser, id) carries its RawData.map id, so names are exact. `sum_data/` is not needed |
| Transaction summary basis | Every transaction instance — **no granularity** by default (Exact). Stated in the UI, Excel ("Results calculated", sheet subtitles), reports and the `method` self-check |
| Chart granularity | Charts and the Time Series sheet only: auto ≤ 1,500 points over the run (30 s for 8 h, 120 s for 27.6 h); coarser with `--chart-granularity`; merged from stored buckets without re-reading; insights always use the auto granularity |
| LRE-style min / max / std-dev / percentiles | **Off by default**. With `--granularity N` (CLI; the page control is hidden — see "Granularity" below), figures are taken over N-second averages, as LRE Analysis does with Data Aggregation on |
| Hits, HTTP codes, throughput | `RawData.eve` data points (762/766): Σ HTTP_xxx, Σ mic_recv bytes; per second = total ÷ (run seconds + 1), as LRE |
| Percentiles | Nearest-rank: P = sorted[⌈p/100·n⌉]. Exact when ≤ 20 M samples are kept; otherwise 1 % log histograms (≤ 0.5 % error). The method used is printed in every output |
| Std deviation | Population (÷ n), Welford |
| Steady state | Last VUser running → first VUser exit (`_t_rep.eve`); adjustable |
| TPS | Count ÷ window seconds |
| Pass / fail | From the transaction records; cross-checked with sum_data pass/fail graphs when present |
| Negative RT | Clamped to 0 and counted (clock skew) |
| Time | `.lrr` times are UTC. The local zone comes from `Time_Zone`/`Daylight_Bias` and is confirmed against `RunDate` |

Insights (all offline): Little's Law and pacing achieved; Mann-Kendall trend with Sen's slope; a
step is told apart from gradual drift; sustained change points, grouped across transactions;
spikes by median/MAD, with buckets merged to ≥ 10 samples and correlated with errors; LG bias;
LG CPU and memory; errors and failures; SLA and Apdex; throughput stability; clock skew.

## Validation against LRE Analysis (done — runs 59 and 2144)

| Figure | Run 59 (14 tx) | Run 2144 (516 tx, 27.6 h) |
|---|---|---|
| Names, Count, Pass, Fail | exact | exact |
| Average | exact | exact (515/515; one transaction never passed) |
| Hits, HTTP codes, throughput (total and per second) | exact | exact |
| Min / Max / Std dev / P90 | exact with LRE-style averaging (`--granularity`) | match only where LRE did not smooth (≈ 180 rows) |

**Why Min / Max / Std dev / P90 can differ from the LRE HTML report:** the analyser uses every
transaction instance. LRE's summary table averages instances into time buckets first and takes
min / max / std dev / P90 of those bucket averages — averaging pulls the extremes in and leaves
the average unchanged. Proof on run 2144: LRE's own `sum_data/graph_4.dat` holds single-instance
rows such as 14_03 = 41.660526 s and 14_04 = 2.040029 s, exactly the analyser's values, while the
LRE report shows maxima of 7.421 s and 0.363 s. The analyser's figures are the true ones; the
"(do not include think time)" filter is applied by both and is not the cause. Details:
`docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md` §7. User-facing explanation: `docs/USER-GUIDE.md`.

## Excel workbook

| Sheet | Contents |
|---|---|
| Test Overview | Cards: Test Metadata, Execution Time, Run Details, High-Level Metrics, Performance, VUsers per LG, HTTP codes, schedule planned vs actual |
| Transactions – Full Run / – Steady State | One merged script cell per group, a row per transaction (count, pass, fail, min/avg/max, std dev, P50–P99, TPS, SLA, Apdex) and a subtotal |
| Workload Model, Errors | Scripts, load generators and VUsers; grouped errors and the error log |
| Charts | All report charts, two per row (page export only — the CLI has no PNG renderer) |
| Time Series, LG Health | Plain data sheets (only the header row is frozen) |
| Insights, About this report | Findings with evidence; how the figures were produced (the self-checks are in the JSON export) |

The layout is agreed with the users — keep it.

## Layout

```
lre-results-analyser/
  docs/       SPEC, discovery plan, implementation plan
  engine/     UMD modules (Node require() and browser/worker LreRA.*)
    text, ini, files, scenario, trep, runlogic, rawmap, sla, collate   text parsers
    eve.js        streaming RawData.eve decoder + layout self-checks
    hist.js       mergeable log histogram     collector.js  one-pass statistics store
    stats.js      exact statistics            dat.js        sum_data graphs
    errors.js     SqliteDb.db query + grouping
    insights.js   data-science checks         analyse.js    orchestration, applySettings(), redact()
  report/     format.js, charts.js (ECharts options), xlsx.js, docx.js, html.js — shared by page and CLI
  web/        index.html, app.js, app.css, worker.js, zip.js, vendor/ (echarts, exceljs, docx, sql.js — licences included)
  cli/        analyse.js
  tools/      make-demo-run.js
  tests/      Jest (synthetic data only)
```

The server (`src/web/server.js`) serves `web/` at `/ra`, `engine/` at `/ra/engine` and `report/`
at `/ra/report`, and the page at `/results-analyser` (each also under `/converter`). Nothing
else on the server is involved.

## Tests

```bash
npx jest lre-results-analyser
```

Never add real results to the repo: they contain internal host names.

## Known limits

- Exact mode keeps about 12 bytes per instance (20 M ≈ 240 MB). Above that, histograms are used
  automatically (percentiles within 0.5 %; count/min/avg/max/std dev exact) and the UI, Excel and
  self-checks say so. Very large runs (hundreds of GB): use the CLI with `node --max-old-space-size=…`
  and, for exact percentiles, `--exact-limit`. Reading takes roughly 1 minute per GB.
- `SqliteDb.db` is loaded into memory in the browser (sql.js). Very large error logs are slow;
  use the CLI for those.
- The RawData.eve layout follows `docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md` (LRE 2025.1 and 2026.3, runs 2144 and 59). Other LRE versions are
  checked by the self-checks (`eve-tx`, `eve-tx-layout`, `eve-tx-identity`, `tx-names`).
- The web UI's HTTP-code and throughput *charts* still read `sum_data`; the totals come from RawData.eve.
- Word export from the CLI has no charts; the browser export embeds them.

### Granularity — exact or LoadRunner-style figures

> **Hidden in the page for now** (`FEATURES.granularity = false` in `web/app.js`): the page shows the exact figures.
> The engine and the CLI `--granularity` option still support the averaged view; set the switch to `true` to show the control again.

| Setting | What you see | Use it for |
|---|---|---|
| **Exact — every transaction** (default) | Every transaction counted on its own: Max is the slowest real response, percentiles are of real responses | SLAs, sign-off, finding slow requests |
| **5 s … 1 h — LoadRunner-style** | Response times averaged inside each time slot — all VUsers together when "combine VUsers" is ticked (default), otherwise each VUser separately; Min, Max, Std Dev and percentiles are of those averages, weighted by count. **Count, Pass, Fail and Average do not change.** Charts use the same slots | Matching a LoadRunner Analysis report that has Data Aggregation on — choose the same granularity (Analysis → Tools → Options → Result Collection → Data Aggregation → Aggregation Configuration). If **VuserID** is ticked there ("graph properties to aggregate"), keep "combine VUsers" ticked — in LoadRunner that tick merges the VUsers |

Averaging hides slow responses: ten 1 s responses and one 40 s response in the same 200 s slot show as 4.5 s.
That is why Exact is the default. Runs above 20 M transactions get 200 s per VUser prepared while reading;
other sizes need the CLI: `--granularity 300` (add `--per-vuser` to average each VUser separately).
Granularity does not make reading faster — reading the file is the slow part.

### Per-script rows, Count and errors

- Every row is **script × transaction**: a transaction used by several scripts (Login, Logout…) gets one row per
  script with that script's own figures, so script subtotals add up (as LRE's per-group figures).
  Each instance's script comes from the VUser that ran it. Charts and findings label such rows "name (script)".
- **Count** = passed + failed instances; Min/Avg/Max/Std Dev/percentiles use passed instances only.
- Percentiles: P50, P80, P85, P90, P95, **P98**, P99 (nearest-rank).
- Errors: rows of `SqliteDb.db` `Main` with **Type = 2**; other message types are listed in the self-checks.
