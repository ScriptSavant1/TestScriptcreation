# LRE Results Analyser — Technical Design

For developers who maintain or extend the analyser. It explains how the raw results are read,
how every figure is calculated, and why figures can differ from the LRE Analysis HTML report.

Related documents:

| Document | Contents |
|---|---|
| `SPEC-RawData-eve-REVERSE-ENGINEERED.md` | Byte layout of `RawData.eve`; validation against LRE |
| `USER-GUIDE.md` / `.html` | What users see in each tab, column and export |
| `../README.md` | Usage, CLI options, method table |
| `SPEC-file-formats.md` | Text file formats (`.lrr`, `RunInfo.ini`, `_t_rep.eve`, `sum_data`, SQLite). Its RawData.eve part is superseded |

---

## 1. Principles

1. **Raw data only.** Every transaction figure, every HTTP code count, every hit and every byte
   comes from `RawData.eve`. LRE's pre-aggregated `sum_data/` is not needed; when present, it is
   used only for load-generator CPU/memory, a few web charts, and an optional cross-check.
2. **One instance = one sample.** Statistics are computed over the individual transaction
   instances. Nothing is averaged into time buckets before Min, Max, Std Dev or percentiles are
   taken.
3. **No guessing.** Anything that cannot be decoded or resolved is counted and reported in the
   self-checks, never silently estimated.
4. **One engine, every surface.** The same engine (`engine/`, UMD modules) runs in the browser's
   Web Worker and in the Node CLI. Reports (`report/`) are shared by the page and the CLI.
5. **Privacy.** The browser reads files from the user's disk; the server never receives them.

## 2. Architecture and data flow

```
              Browser (web/worker.js)  or  CLI (cli/analyse.js)
                                  │  "source": list() · readBytes() · stream() · sqlite()
                                  ▼
 engine/analyse.js  analyse(source)
   ├─ files.discover()                which files exist, required / optional
   ├─ scenario.parse()                res*.lrr + RunInfo.ini → test name, times, schedule, run id
   ├─ trep.parse()                    _t_rep.eve → VUser lifecycle, steady state, LGs
   ├─ rawmap.parse()                  RawData.map → transaction names, data-point names
   ├─ sla / collate / runlogic        SLAConfiguration.xml, LG hosts, pacing / think time per script
   ├─ eve.createDecoder()  ◀────────  RawData.eve streamed in 8 MB chunks
   │     onVuser ──────────────────▶  vuserInfo (VUser → LG, group)
   │     onTransaction ────────────▶  collector.add()        (one call per instance)
   │     onDataPoint ──────────────▶  webCollector.add()     (HTTP codes, bytes)
   ├─ collector.finish() → store      exact samples, histograms, time buckets, per LG, per VUser
   ├─ errors.summarise()              SqliteDb.db → grouped errors
   ├─ readSumData()  (optional)       sum_data graphs (LG health, some charts)
   └─ model  ──▶  applySettings(model, {window, sla})  ──▶  insights.run(model)
                                  │
                                  ▼
       report/xlsx.js · docx.js · html.js · charts.js · web/app.js (dashboard)
```

`analyse()` returns a plain, JSON-serialisable **model**. The heavy statistics **store** is attached
as a non-enumerable property, so `applySettings()` can recompute everything that depends on the
analysis window or SLAs without reading the files again.

### Module map

| File | Responsibility |
|---|---|
| `engine/files.js` | Discover files in a folder/ZIP listing |
| `engine/scenario.js` | `.lrr` + `RunInfo.ini`: names, UTC start/stop, local offset, schedule, run id |
| `engine/trep.js` | `_t_rep.eve`: VUser lifecycle events → phases and steady state |
| `engine/rawmap.js` | `RawData.map`: `[END_TRANSACTION]` and `[DATA_POINT]` id → name |
| `engine/eve.js` | Streaming `RawData.eve` decoder (records, identity, data points, VUsers) |
| `engine/collector.js` | One-pass statistics store |
| `engine/hist.js` | Mergeable log histogram |
| `engine/stats.js` | Exact percentile (nearest-rank) |
| `engine/errors.js` | SQLite error query, message-pattern grouping |
| `engine/dat.js` | `sum_data` parsing (optional) |
| `engine/insights.js` | Rule-based findings |
| `engine/analyse.js` | Orchestration, model, `applySettings()`, `redact()`, self-checks |
| `report/*.js` | Excel, Word, HTML/PDF, chart options, formatting |
| `web/*` | Dashboard page, worker, ZIP reader |
| `cli/analyse.js` | Command line |

## 3. Decoding RawData.eve (summary)

Full byte layout: `SPEC-RawData-eve-REVERSE-ENGINEERED.md`. In short:

- The file is a stream of big-endian, length-prefixed records. The decoder accepts chunks split at
  any byte and keeps the remainder for the next chunk.
- **Transaction instance** = type 3, sub-type `0x00C00FC0 + flags`. Flags add optional fields:
  `0x01` name registration, `0x08` u32, `0x10` wasted time, `0x20` think time, `0x8000` failed.
  Then: start, end, seq, parent, internal id, VUser, g, status, iteration.
- **Identity.** The internal id is unique only within one VUser. The first record of each
  `(VUser, internal id)` carries the RawData.map id as text. The decoder keeps a dictionary
  `vuser|internalId → mapId` and resolves every record through it. A record that arrives before
  its registration is held and released when the registration arrives; any still unresolved at
  the end are counted (`eve-tx-identity` self-check) and not used.
- **Data points** (sub-types 766 registration + sample, 762 sample) use the same scheme. Values are
  counts for `HTTP_xxx`, bytes for `mic_recv` / `mic_sent`.
- **VUser descriptor** (sub-type 63): VUser id → group, script, LG host. Used for per-LG figures,
  because `_t_rep.eve` numbers VUsers per group (numbers repeat across groups).

The decoder emits one callback per instance:

```js
onTransaction(endTs, iteration, rtSec, vuser, mapId, failed, startTs, info)
// rtSec = max(0, end − start − wasted − think);  info = { subType, flags, wasted, think, parent, rawSec }
```

## 4. How each figure is calculated

### 4.1 Response time of one instance

```
RT = end − start − wasted time − think time          (seconds; negative → 0 and counted)
```

This equals LRE's "(do not Include Think Time)" figure. The collector stores RT in milliseconds
internally; the model reports seconds.

### 4.2 Count, Pass, Fail

| Figure | Rule |
|---|---|
| **Pass** | Instances without the failed flag (`0x8000`) |
| **Fail** | Instances with the failed flag |
| **Count** | Passed instances in the selected window (Full run = whole test) |
| **Fail %** | Fail ÷ (Pass + Fail) × 100 |

Failed instances are counted but not timed, as in LRE. Pass/Fail in the steady-state table are
whole-run counts.

### 4.3 Min, Avg, Max, Std Dev

Over **every passed instance** in the window:

```
Min     = smallest RT
Max     = largest RT
Avg     = Σ RT ÷ n
Std Dev = √( Σ (RT − Avg)² ÷ n )          population standard deviation
```

For the full run they are maintained incrementally (Welford's algorithm: count, mean, M2, min,
max), so no second pass is needed. For a window, the exact samples inside the window are used.

### 4.4 Percentiles (P50, P80, P85, P90, P95, P99)

**Nearest-rank** on the sorted samples:

```
rank = ceil(p / 100 × n)          P = sorted[rank − 1]
```

Every reported percentile is a real measured value (no interpolation).

**Exact vs histogram mode.** The collector keeps every sample (RT as Float64 + time as Float32,
about 12 bytes each) up to 20 million samples in total (`exactLimit`, CLI `--exact-limit`). Above
that it drops the raw samples and answers from log histograms with 1 % bins: the reported value is
the bin's geometric midpoint clamped to the exact min/max, so the relative error is ≤ 0.5 %. Count,
Min, Max, Avg and Std Dev stay exact in both modes (Welford). In histogram mode the analysis-window
figures are merged from whole time buckets, so the window edges are rounded to the chart's base
bucket. Run 2144 (2.8 M instances) runs in exact mode.

The mode is stated everywhere: `method.percentileMethod` (`exact` / `histogram`),
`method.summaryBasis` (plain sentence with the instance count), the `method` self-check (`info` in
exact mode, `warn` in histogram mode), a note above the Transactions table and on the Overview
(histogram mode), the transaction sheets' subtitle and the "Results calculated" row of the Excel
Test Overview, and the report appendices.

**Neither mode uses a granularity.** Memory depends on the number of instances (exact) or on the
number of distinct 1 % bins (histogram: a few hundred per transaction), not on file size or run
length.

### 4.5 TPS

```
TPS = Count ÷ window length in seconds
```

### 4.6 Steady state and the analysis window

From `_t_rep.eve`: **steady state = from the moment the last VUser started running to the moment
the first VUser exited.** The user can override it with any window (`t+` seconds from the scenario
start). Each instance belongs to a window by its **end time**. Window-dependent figures (Count,
Min…P99, TPS, SLA, Apdex) are recomputed by `applySettings()`; whole-run figures are not.

### 4.7 SLA and Apdex

- **SLA result** = PASS when the chosen percentile (default P90) in the window ≤ the threshold.
- **Apdex** (T = threshold): `(satisfied + tolerating / 2) ÷ n`, where satisfied = RT ≤ T and
  tolerating = T < RT ≤ 4T.

### 4.8 Per load generator

The same statistics per LG (full run and steady state), from histograms with 1 % bins. The LG of
an instance comes from the VUser descriptor (sub-type 63) of its VUser.

### 4.9 Web figures

| Figure | Rule |
|---|---|
| HTTP code totals | Σ value of every `HTTP_xxx` data point |
| Total hits | Σ of all HTTP code values |
| Total throughput | Σ `mic_recv` bytes |
| Per second (codes, hits, throughput) | total ÷ (Stop_time − Start_time + 1) s — LRE's convention, verified on both runs |
| Peak per second | highest time bucket ÷ bucket length |

### 4.10 Time series (charts and the "Time Series" sheet)

This is the **only** place a granularity is used. The run is cut into buckets of `bucketSec`
seconds, chosen so there are at most 1,500 buckets:

```
bucketSec = first of [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600] with duration ÷ c ≤ 1500
```

Run 59 (8 h) → 30 s; run 2144 (27.6 h) → 120 s; a 7-day run → 600 s. Per bucket and transaction the
collector keeps count, mean, M2, min, max and a 2 % histogram (for per-bucket P50/P90/P95/P99), plus
failures. Charts, trend/spike insights and the Time Series sheet read these buckets. **The
transaction summary table never uses them.**

**User-selected chart granularity.** The automatic size is the *base*. Users can choose a coarser
one (settings bar "Chart granularity", CLI `--granularity <s>`, `applySettings(model,
{granularitySec})`). It is built from the base buckets without re-reading the file:

| Series | Merge of k base buckets |
|---|---|
| Transaction count, failures, errors | sum |
| Transaction mean, min, max | exact merge (Welford: n, mean, M2, min, max) |
| Transaction P50/P90/P95/P99 per slot | from the merged 2 % histograms |
| Running VUsers | max |
| TPS, hits/s, throughput, HTTP codes/s, sum_data graph averages, LG CPU/memory/disk | mean |
| sum_data graph maxima | max |

Choices (`granularityOptions()`): base × {1, 2, 3, 4, 5, 6, 10, 15, 20, 30, 60} plus 5 s … 2 h values
that are multiples of the base, limited to ≥ ~10 points per chart. Finer than the base is not
offered (it would need a re-read). An unknown value snaps to the next allowed one; `"auto"` / `null`
returns to the base. The model exposes `granularity = { sec, baseSec, auto, options, buckets }`,
`settings.granularitySec` (null = auto) and `method.chartGranularity`.

**Insights always use the base timeline**, so findings do not change when a user changes the chart
view. Implementation: `store.timeline(k)` (`collector.js`), `applyGranularity()` / `mergeSeries()`
(`analyse.js`); the base timeline and LG-health series are kept on the non-enumerable
`model._base`.

## 5. Granularity — this tool vs LRE Analysis

**This tool:** the transaction summary (Min, Avg, Max, Std Dev, percentiles) is computed from the
individual instances, with no granularity. Granularity only shapes the charts (§4.10).

**LRE Analysis:** the summary table first aggregates. Each **point** is the mean RT of the
instances that ended in the same time bucket (and, as far as we could reproduce, on the same load
generator). Min / Max / Std Dev / 90 Percent are then taken over those points, weighted by their
instance counts. The weighted mean of bucket means equals the overall mean, so **Average and
counts are unaffected**, but extremes are pulled towards the mean.

Worked example — three instances of 1 s, 1 s and 10 s end in the same bucket:

| | This tool | LRE (one point = 4 s, weight 3) |
|---|---|---|
| Min | 1 | 4 |
| Max | 10 | 4 |
| Avg | 4 | 4 |
| Std Dev | 4.24 | 0 |

Consequences: busy transactions (several instances per bucket) differ; rare transactions (one
instance per bucket) are identical in both tools.

What was established empirically:

| Run | LRE's aggregation |
|---|---|
| 59 (8 h, 1 group, 2 LGs) | 2 s buckets of **end time** from `.lrr Start_time`, per load generator — reproduces all 14 rows on all four figures |
| 2144 (27.6 h, 71 groups, 2 LGs) | Not reproducible from the raw data: > 100 variants tested (1 s … 4096 s; keys none / LG / group / LG+group / VUser / iteration; start vs end time; fixed instance counts); best ≈ 182 of 515 rows. The setting lives in the Analysis session / template, which is not in the raw results |

Proof that the per-instance values are right (run 2144): LRE's own `sum_data/graph_4.dat` stores
5 s × LG rows with count and mean; rows with count 1 are single instances and equal the decoder's
values to 6 decimals (e.g. 14_03 = 41.660526 s, 14_04 = 2.040029 s), while LRE's report shows maxima
of 7.421 s and 0.363 s. Instance counts in that file equal the decoder's for 515 / 515 transactions.

### 5.1 The LRE-style figures in the engine (diagnostic only)

`collector.lreSummary(id)` implements LRE's aggregation over `lreGranularitySec` × LG buckets. It is
**off by default** (it keeps one entry per bucket × LG × transaction — wasted memory on multi-day
runs, and no report uses it). Enable it with the `lreGranularitySec` option or CLI
`--lre-granularity 2`; it then appears as `transaction.lre` in the model and as an extra table in
the CLI console. **By the product owner's decision it is never shown in the Excel, Word, HTML
reports or the dashboard** — reports show the exact figures only.

## 5.2 Very large runs (hundreds of GB)

| Concern | How it is handled |
|---|---|
| Reading the file | Streamed in 8 MB chunks; memory does not depend on file size. Time is roughly proportional to size (≈ 1 min per GB on a laptop) |
| Transaction statistics | Exact up to `exactLimit` instances (default 20 M ≈ 240 MB), then 1 % histograms automatically (percentiles within 0.5 %, everything else exact). Raise `--exact-limit` on a machine with more memory for exact percentiles (12 bytes per instance; 100 M ≈ 1.2 GB) |
| Charts / Time Series | ≤ 1,500 base buckets whatever the length; coarser on request |
| Per VUser heatmap | Limited to 2,000 VUsers |
| Browser vs CLI | The browser is limited by its own memory; use the CLI (`node --max-old-space-size=…`) for very large runs |
| What is never done | No granularity is applied to the transaction summary, whatever the size |

## 6. Insights (`engine/insights.js`)

| Check | Method |
|---|---|
| VUsers / steady state as planned | Schedule from `.lrr` vs `_t_rep.eve` |
| Pacing achieved | Little's Law: VUsers ÷ observed iteration cycle vs pacing |
| Trend | Mann-Kendall test with Sen's slope on per-bucket P90 in the window; a step is told apart from gradual drift |
| Level change | Sustained change points, grouped across transactions at the same moment |
| Spikes | Robust z-score (median / MAD) on per-bucket P90, buckets merged to ≥ 10 samples; correlated with errors and VUser changes |
| LG bias | P90 per LG vs the fastest LG (≥ 25 % on most transactions = LG problem) |
| LG health | CPU / memory peaks (≥ 85 % high) from `sum_data` |
| Errors / failures | Totals, top pattern, errors per 100 iterations |
| SLA / Apdex | Per transaction in the window; Apdex < 0.85 flagged |
| Throughput stability | Coefficient of variation of TPS per bucket |
| Clock skew | Count of negative RTs clamped to 0 |

Verdict: *SLA not met* if any SLA fails, otherwise *Review findings* if any high finding,
otherwise *No significant issues*.

## 7. Reports

| Output | Builder | Notes |
|---|---|---|
| Excel | `report/xlsx.js` (ExcelJS injected) | Sheets: Test Overview (cards), Transactions – Full Run / – Steady State (merged script cell per group + Subtotal), Workload Model, Errors, Time Series, LG Health, Insights, Method & Validation. Layout approved by the users — keep it |
| Word | `report/docx.js` | Editable; the browser export embeds charts |
| HTML / PDF | `report/html.js` | Print-ready; the CLI renders charts as SVG (ECharts SSR) |
| Charts | `report/charts.js` | ECharts options shared by dashboard and reports |
| JSON | model | `redact()` replaces hosts with LG1…, removes IPs, script paths and error text |

## 8. Self-checks (Validation tab, "Method & Validation" sheet)

| Id | Confirms |
|---|---|
| `eve-sync` | The file was read to a record boundary |
| `eve-tx` | Transaction records found, passed/failed counts, by sub-type |
| `eve-tx-layout` | Every transaction record matched the flag-based layout |
| `eve-tx-identity` | Every record resolved through a registration; no conflicts |
| `eve-datapoints` | Data points resolved; totals per data point |
| `eve-vusers` | Every VUser with transactions has a descriptor |
| `tx-names` | Every id has a RawData.map name |
| `tx-per-iteration` | Transactions per VUser iteration |
| `method` | Summary basis: `info` = exact over every instance; `warn` = large run, percentiles from histograms |
| `steady-state`, `vusers`, `timezone`, `eve-time` | Scenario consistency |

A `fail` makes the CLI exit with code 1.

## 9. Validating against LRE

1. Run the CLI: `node lre-results-analyser/cli/analyse.js <folder|zip> --out model.json`.
2. From LRE's `Report/summary.html`, take `TransactionsTable` (Name, Min, Avg, Max, Std. Deviation,
   90 Percent, Pass, Fail).
3. Compare per transaction name. Expected: Pass, Fail, Average equal (± 0.0015 s rounding); Min / Max
   / Std Dev / P90 equal only where LRE did not aggregate; hits, HTTP codes, throughput equal.
4. To prove a disputed value, look the instance up in `sum_data/graph_4.dat` (single-instance rows)
   or list the instance with its VUser, start and end from the decoder's `onTransaction` callback.

Results to date: run 59 — all columns equal (with LRE-style buckets); run 2144 — 516 / 516 names,
Pass, Fail; 515 / 515 averages (one transaction never passed); hits 41,415,508, throughput
2.11308275197E12, all HTTP codes and per-second figures equal.

## 10. Extending and maintaining

- **New LRE version / new sub-type combination:** the flag-based parser handles new combinations of
  known flags. An unknown flag bit makes the record "implausible" (counted in `eve-tx-layout`,
  shown with hex examples in the Validation tab) — extend `parseTx()` and `KNOWN_FLAGS` in
  `eve.js`, add a test in `tests/eveAndAnalyse.test.js` and a section in the SPEC.
- **New figure:** add it to the collector/store (one pass), expose it in `analyse.js`, then in the
  report builders. Keep figures window-aware via `applySettings()` if they depend on the window.
- **Synthetic test data:** `tests/helpers.js` (`txRecord`, `dataPoint`) and
  `tools/make-demo-run.js` write the real record layout. Never commit real results (internal host
  names).
- **Tests:** `npx jest lre-results-analyser`.
- **Open items:** the dashboard's HTTP-code and throughput charts still read `sum_data`; the totals
  come from RawData.eve.
