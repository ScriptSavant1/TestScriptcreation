# LRE Results Analyser

Analyses LoadRunner Enterprise **raw results** (`RawData.eve`, `_t_rep.eve`, `res*.lrr`, …)
independently of LRE Analysis, and produces a dashboard plus Excel, Word and PDF reports.

**Nothing is uploaded or stored on the server.** The browser reads the files straight from the
user's disk (a Web Worker streams them), so a run of any size works. The same engine also runs
from the command line for runs of hundreds of GB.

- Plan and phases: [docs/IMPLEMENTATION-PLAN.md](docs/IMPLEMENTATION-PLAN.md)
- File formats: [docs/SPEC-file-formats.md](docs/SPEC-file-formats.md)

**Status:** Phases 0–5 are built. Phase 0 sign-off is still open: the transaction counts must be
compared with LRE Analysis on a real run (see *Validate against LRE Analysis* below).

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
| Transactions | `RawData.eve` transaction records — sub-types 12586944 / 12586945 / 12619721 (failed); one record per completed transaction. Sub-type 762 records are per-request data points (HTTP codes etc.), counted separately |
| Response time | End time − start time of each transaction record (seconds). Statistics use passed transactions; failed ones are counted (as LRE does) |
| Transaction names | RawData.eve uses internal ids, not RawData.map ids. Names are matched to LRE's per-transaction response-time graph in `sum_data` (count, mean and max must agree). **Keep `sum_data/` in the ZIP** — without it the names cannot be confirmed |
| Percentiles | Nearest-rank: P = sorted[⌈p/100·n⌉]. Exact when ≤ 20 M samples are kept; otherwise 1 % log histograms (≤ 0.5 % error). The method used is printed in every output |
| Std deviation | Population (÷ n), Welford |
| Steady state | Last VUser running → first VUser exit (`_t_rep.eve`); adjustable |
| TPS | Count ÷ window seconds |
| Pass / fail | From the transaction records; cross-checked with sum_data pass/fail graphs |
| Negative RT | Clamped to 0 and counted (clock skew) |
| Time | `.lrr` times are UTC. The local zone comes from `Time_Zone`/`Daylight_Bias` and is confirmed against `RunDate` |

Insights (all offline): Little's Law and pacing achieved; Mann-Kendall trend with Sen's slope; a
step is told apart from gradual drift; sustained change points, grouped across transactions;
spikes by median/MAD, with buckets merged to ≥ 10 samples and correlated with errors; LG bias;
LG CPU and memory; errors and failures; SLA and Apdex; throughput stability; clock skew.

## Validate against LRE Analysis (Phase 0 sign-off)

1. Run the CLI on a real run:

   ```bash
   node lre-results-analyser/cli/analyse.js "<run folder or zip>" --redact > check.txt
   ```

2. Compare it with LRE Analysis → Transaction Summary for the same run:
   - **Count**: must match exactly.
   - **Avg / Min / Max**: should match to within rounding.
   - **Percentiles**: may differ slightly (method).
3. Read the self-checks:
   - `eve-f40` / `eve-f60`: whether a status field exists.
   - `eve-tx-ids`: wrapper transactions such as `Main_Transaction`.
   - `tx-per-iteration`
   - `vuser-id-scope`
   - `pass-fail`

## Layout

```
lre-results-analyser/
  docs/      SPEC, discovery plan, implementation plan
  engine/    UMD modules (Node require() and browser/worker LreRA.*)
    text, ini, files, scenario, trep, runlogic, rawmap, sla, collate   text parsers
    eve.js        streaming RawData.eve decoder + layout self-checks
    hist.js       mergeable log histogram     collector.js  one-pass statistics store
    stats.js      exact statistics            dat.js        sum_data graphs
    errors.js     SqliteDb.db query + grouping
    insights.js   data-science checks         analyse.js    orchestration, applySettings(), redact()
  report/    format.js, charts.js (ECharts options), xlsx.js, docx.js, html.js — shared by page and CLI
  web/       index.html, app.js, app.css, worker.js, zip.js, vendor/ (echarts, exceljs, docx, sql.js — licences included)
  cli/       analyse.js
  tools/     make-demo-run.js
  tests/     Jest (synthetic data only)
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

- In the browser, exact mode keeps about 12 bytes per sample (20 M samples ≈ 240 MB). Above that,
  histograms are used automatically.
- `SqliteDb.db` is loaded into memory in the browser (sql.js). Very large error logs are slow;
  use the CLI for those.
- The RawData.eve layout follows `docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md` (LRE 2026, run 59). Other LRE versions are
  checked by the self-checks (`eve-tx`, `eve-tx-layout`, `tx-names`).
- Word export from the CLI has no charts; the browser export embeds them.
