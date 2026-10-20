# LRE Results Analyser

Analyses LoadRunner Enterprise **raw results** (`RawData.eve`, `_t_rep.eve`, `res*.lrr`, …)
independently of LRE Analysis, and produces a dashboard plus Excel, Word and PDF reports.

**Nothing is uploaded or stored on the server.** The browser reads the files straight from the
user's disk (a Web Worker streams them), so a run of any size works. The same engine also runs
from the command line for runs of hundreds of GB.

- Plan and phases: [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)
- File formats: [docs/SPEC-file-formats.md](docs/SPEC-file-formats.md)

- User guide (admins, testers, non-technical readers): [docs/USER-GUIDE.md](docs/USER-GUIDE.md) · [docs/USER-GUIDE.html](docs/USER-GUIDE.html)
- Technical design for developers (data flow, every calculation, granularity): [docs/TECHNICAL-DESIGN.md](docs/TECHNICAL-DESIGN.md)

**Status:** Phases 0–5 are built and validated against LRE Analysis on runs 59 and 2144 (see
*Validation against LRE Analysis* below).

## Use it in the portal

Open **Results** in the PerfX menu (or go to `/results-analyser`), then choose the run's raw-results
**ZIP** or its unzipped **folder**.

| Tab | Shows |
|---|---|
| Overview | Key figures, test details, schedule planned vs actual, load generators, key findings |
| Transactions | Summary for the steady state or the full run: count, pass/fail, min/avg/max, std dev, P50–P99, TPS, SLA, Apdex, P90 trend. Click a row for its distribution, behaviour over time, latency heatmap and figures per load generator |
| Charts | Load, response time, TPS, latency heatmap, TPS vs RT, errors, HTTP codes, throughput, LG CPU, RT per LG, RT per VUser |
| Errors | Errors grouped by code and message pattern, plus a searchable error log |
| Workload | Scripts (pacing, think time, iterations planned vs achieved), load generators, VUsers |
| Insights | Automatic findings with evidence, and an overall verdict |
| Validation | Method, files used, self-checks, RawData.eve record types |

The **analysis window** defaults to the detected steady state and can be changed. **SLA**
thresholds can be set as a default or per transaction; they are remembered per test in this
browser. Every figure, chart and insight updates when either changes.

Exports: **Excel** (9 sheets), **Word** (editable, with charts), **PDF** (print-ready report:
choose "Save as PDF"), **HTML**, **JSON** (full or redacted).

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
| `--granularity 600` | Chart / Time Series granularity in seconds (default auto; coarser than auto only). The transaction summary never uses a granularity |
| `--exact-limit 100000000` | Instances kept for exact percentiles (default 20,000,000 ≈ 240 MB, ~12 bytes each). Above it percentiles come from histograms (within 0.5 %) and a warning is shown |
| `--lre-granularity 2` | Diagnostic only: also compute LRE-style min/max/std-dev/P90 over N-second × LG bucket means, printed to the console (default off; never in reports) |
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
| Transaction summary basis | Every transaction instance — **no granularity**. Stated in the UI (note above the Transactions table), Excel ("Results calculated", sheet subtitles), reports and the `method` self-check |
| Chart granularity | Charts and the Time Series sheet only: auto ≤ 1,500 points over the run (30 s for 8 h, 120 s for 27.6 h); users can choose coarser (settings bar / `--granularity`); merged from stored buckets without re-reading; insights always use the auto granularity |
| LRE-style min / max / std-dev / P90 | Diagnostic, **off by default** (`--lre-granularity 2` reproduces run 59's LRE table). Never shown in reports |
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
| Min / Max / Std dev / P90 | exact with LRE-style buckets | match only where LRE did not smooth (≈ 180 rows) |

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
| Workload Model, Errors, Time Series, LG Health, Insights, Method & Validation | as named |

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

| Setting | What you see | Use it for |
|---|---|---|
| **Exact — every transaction** (default) | Every transaction counted on its own: Max is the slowest real response, percentiles are of real responses | SLAs, sign-off, finding slow requests |
| **5 s … 1 h — LoadRunner-style** | Response times averaged inside each time slot (per VUser when "per VUser" is ticked); Min, Max, Std Dev and percentiles are of those averages, weighted by count. **Count, Pass, Fail and Average do not change.** Charts use the same slots | Matching a LoadRunner Analysis report that has Data Aggregation on — choose the same granularity (Analysis → Tools → Options → Result Collection → Data Aggregation → Aggregation Configuration) and tick "per VUser" if "VuserID" is ticked there |

Averaging hides slow responses: ten 1 s responses and one 40 s response in the same 200 s slot show as 4.5 s.
That is why Exact is the default. Runs above 20 M transactions get 200 s per VUser prepared while reading;
other sizes need the CLI: `--granularity 300` (add `--all-vusers` to average all VUsers together).
Granularity does not make reading faster — reading the file is the slow part.

### Per-script rows, Count and errors

- Every row is **script × transaction**: a transaction used by several scripts (Login, Logout…) gets one row per
  script with that script's own figures, so script subtotals add up (as LRE's per-group figures).
  Each instance's script comes from the VUser that ran it. Charts and findings label such rows "name (script)".
- **Count** = passed + failed instances; Min/Avg/Max/Std Dev/percentiles use passed instances only.
- Percentiles: P50, P80, P85, P90, P95, **P98**, P99 (nearest-rank).
- Errors: rows of `SqliteDb.db` `Main` with **Type = 2**; other message types are listed in the self-checks.
