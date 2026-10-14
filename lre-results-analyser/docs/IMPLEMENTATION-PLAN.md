# LRE Results Analyser — Implementation Plan

> **Status:** Phases 0–5 built (2026-10-14). Phase 0 sign-off — counts compared with LRE Analysis on a real run — still open (§11 items 1–2)
> **Date:** 2026-10-14
> **Inputs:** `SPEC-file-formats.md` (file formats), `DISCOVERY-PLAN.md` (discovery) — both in this
> `docs/` folder; sample text files in `RawResults_59/` at the repo root (never committed — internal host names)
> **Owner decisions still open:** see [§11 Inputs still needed](#11-inputs-still-needed)

---

## 1. Goal

A new **Results Analyser** menu in the portal. A performance engineer selects an LRE raw-results
folder (or its ZIP) and gets, computed **independently of LRE Analysis** from the raw data:

1. An **interactive dashboard** in the browser
2. An **Excel workbook** (multi-sheet — §6.1)
3. A **PDF report** and an editable **Word report** with charts and findings (§6.3)

The numbers must be **provably correct**: every figure is reproducible, its method is documented
in the output, and the engine is validated against LRE Analysis on real runs (Phase 0).

### Non-functional requirements

| Requirement | How it is met |
|---|---|
| Results are **never stored on the server** | Processing happens in the user's browser; nothing is uploaded (§3) |
| **No impact** on server performance | The server only serves static files; all CPU/memory use is on the user's PC |
| **Any size** — from a few MB to **500 GB** | Streaming parser, constant memory, mergeable statistics (§5) |
| Works on locked-down corporate PCs | No CDN, no external calls; all libraries vendored; no install for the web path |
| Isolated module | New folder; existing tools untouched except one portal menu entry |

---

## 2. Sources of data (verified against `RawResults_59/` text files)

| Source | Provides | Notes / corrections to SPEC |
|---|---|---|
| `RunInfo.ini` | Session name, project, run date, duration (min) | `RunDate` is **local time**, not UTC |
| `res*.lrr` | Start/stop (unix **UTC**), LRE version, schedule, groups→scripts, protocol, start/stop reason, time zone (`Time_Zone`, `Daylight_Bias`) | Use `Time_Zone`/`Daylight_Bias` to convert to local time. `Global Schedule` needs a general parser (§4.3) |
| `_t_rep.eve` | Per-VUser lifecycle: **group, VUser #, script, LG**, init/run/exit times; LG connects; scenario start/end | Event 4 = `28 4 <group> <vuser#> <ts> 0 <script> <LG> 0 1`. Actual ramp, steady state, VUsers per LG/script all come from here |
| `*.cfg` (not `.cfg.bak`) | Run-time settings per script (DevWeb `rts.yml`: think time, timeouts, cache…; classic `[ThinkTime]`, `[Log]`, `[General]`) | Think-time source depends on protocol (DevWeb → `rts.yml`) |
| `*.usp` | Run logic / **pacing** | `RunLogicPaceType=Const` ⇒ **start every `RunLogicPaceConstTime` s** (260 s in run 59), *not* "60 s after". Map all pace types (§4.4) |
| `*.usr` / `*.usr.bak` | Script type, language, **transaction list per script** (`[TransactionsOrder]`, `[Transactions]`) | Not in SPEC — second source for script→transaction grouping |
| `collate.txt`, `remote_results.txt`, `collateLog.txt` | LG host list, collation status | No IPs here |
| `RawData.map` | Transaction IDs (`[END_TRANSACTION]`), data-point IDs (`[DATA_POINT]`) | IDs overlap between the two sections — the parser must not confuse them (§4.2) |
| `RawData.eve` | Every transaction sample: time, iteration, response time, VUser, transaction ID | Binary layout per SPEC §3; **status field and record-kind field to be confirmed in Phase 0** |
| `SqliteDb.db` | Errors: code, message, time (local), type, iteration, action, injector, script, VUser | `Main.*_ID` are foreign keys → join lookup tables (`VusersID` gives the real VUser name) |
| `sum_data/sum_dat.ini` + `graph_N.dat` | VUsers/s, LG CPU/mem/disk (with `host [ip]`), hits, throughput, HTTP codes, connections | 7-column format per SPEC §4; measurement IDs from `sum_dat.ini` |
| `SLAConfiguration.xml` | Transactions in SLA scope | No thresholds — user supplies them (§6.4) |

**Controller host:** not named in the text files. A monitored host with no VUsers (run 59: a
third host in `graph_1`) is probably the Controller — to be confirmed (§11).

---

## 3. Architecture

### 3.1 Where processing runs

```
 User's PC (browser)                                         IIS server
 ┌──────────────────────────────────────────────┐            ┌──────────────────────┐
 │ Results Analyser page                        │  static    │ serves HTML/JS/WASM  │
 │  ├─ pick folder / ZIP  (File System Access,  │◄───────────│ only — no upload,    │
 │  │   <input webkitdirectory>, or ZIP file)   │   files    │ no processing,       │
 │  ├─ Web Worker: streaming engine (§5)        │            │ nothing stored       │
 │  ├─ dashboard (ECharts)                      │            └──────────────────────┘
 │  └─ exporters: XLSX · DOCX · PDF (download)  │
 └──────────────────────────────────────────────┘
 Same engine also runs as a local CLI (Node) for very large runs (§5.4)
```

Rationale: no upload limit (IIS currently caps requests at 100 MB), raw results never leave the
user's machine (client data), zero server load, same model as Recorder and Script Studio.

### 3.2 Module layout (separate top-level module, like `cdp-recorder/`)

```
lre-results-analyser/
  README.md
  docs/                          SPEC-file-formats.md, DISCOVERY-PLAN.md, this plan
  engine/                        UMD — runs in a Web Worker, in Node (CLI) and in Jest.
                                 Pure byte/text processing; file access is injected.
    _umd.js-style headers        each file registers on LreRA.<name> in the browser
    text.js                      bytes → text (BOM, UTF-8/UTF-16)
    ini.js                       INI parser (lrr, usp, cfg, usr, map, RunInfo, collate)
    files.js                     results-root + file discovery (res*.lrr, *.cfg …)
    scenario.js                  RunInfo + lrr → run identity, time zone, schedule
    trep.js                      _t_rep.eve → VUser lifecycle, groups, LGs, phases
    runlogic.js                  usp/cfg/usr → pacing, think time, script transactions
    rawmap.js · sla.js · collate.js
    eve.js                       RawData.eve streaming decoder + survey (self-checks)
    stats.js                     exact stats (Phase 0); Welford + HDR histogram (Phase 1)
    errors.js                    SqliteDb.db rows → error summary (SQL runner injected)
    analyse.js                   orchestration → single result model (JSON)
    dat.js · insights.js         (Phase 1 / Phase 4)
  cli/analyse.js                 Node CLI (folder input) — Phase 0 tool, later the large-run path
  web/                           page, worker, dashboard, exporters, vendor libs (Phase 3+)
  tests/*.test.js                unit + golden tests (picked up by the repo's Jest config)
```

Integration with the portal (Phase 3): the server exposes `lre-results-analyser/web` as static
files and the portal menu gets one entry — the only changes outside this folder, plus
documentation. Libraries are **vendored** (like `jszip.min.js` today) — no CDN.

### 3.3 Libraries

| Need | Library | Notes |
|---|---|---|
| ZIP (incl. ZIP64), streaming | **fflate** | Small, streaming inflate. Folder selection avoids unzip entirely |
| SQLite in browser | **sql.js** (WASM) | Reads `SqliteDb.db` from memory |
| Charts | **Apache ECharts** | Large time series, zoom/brush, heatmaps, dual axes; renders to PNG for reports |
| Excel | **ExcelJS** (browser build) | Already a server dependency |
| Word | **docx** (browser build) | Already a server dependency |
| PDF | Print-optimised report HTML → browser "Save as PDF" | No server-side rendering; programmatic PDF (pdf-lib) only if needed later |

---

## 4. Parsing rules

### 4.1 File discovery
Locate the results root by finding `RawData.eve` (ZIP may have a top folder or not). Dynamic names:
first `*.lrr`; every `*.cfg` except `*.cfg.bak`; every `*.usp`; `*.usr` else `*.usr.bak`.
Missing optional files degrade gracefully (section shown as "not available"), never crash.

### 4.2 RawData.eve (streaming)
- Read sequentially in chunks (e.g. 8 MB); carry partial records across chunk boundaries.
- Envelope: `uint32BE recLen`, `uint32BE type`; header record type 7; data records type 3.
- Transaction samples: SPEC §3.4 layout (timestamp double BE @+28, iteration @+36, response
  time ms double BE @+44, VUser @+52, transaction ID @+56).
- **Phase 0 confirms:** (a) which field distinguishes transaction samples from data-point
  samples (IDs overlap with `[DATA_POINT]`), (b) the transaction **status** (pass/fail/stop),
  (c) the meaning of sub-types `0xC00100` / `0xC00101`, (d) whether VUser IDs are global or
  per group. Until confirmed, the parser **counts and reports** unknown field values instead of
  guessing (self-check output, §8).
- Negative response times (clock skew): clamp to 0 **and count them** (reported in Method sheet).
- Transaction names from `RawData.map [END_TRANSACTION]`. IDs not in the map are reported as
  `TX_<id>`; no hard-coded "21 = Main_Transaction" — resolve from the map/SLA list when present.

### 4.3 Schedule
General parser for `Global Schedule` and `Scenario Duration` (all-at-once, *N* every *T* s,
multi-step, per-group schedules, run-until-complete). Report **planned vs actual** — actual from
`_t_rep.eve`.

### 4.4 Pacing and think time (per script)
Pace types from `.usp`: as soon as possible; after previous ends — fixed (`PaceConstAfterTime`) /
random (`AfterPaceMin..Max`); at fixed intervals (`Const` → `PaceConstTime`); at random intervals
(`RandomPaceMin..Max`). Think time: DevWeb → `rts.yml thinkTime` (type, limit); other protocols →
`.cfg [ThinkTime]`. Shown in the workload sheet in plain words (e.g. "Start every 260 s").

### 4.5 Time
All internal times = seconds since scenario start (UTC epoch from `.lrr`). Displayed in local
time using the run's time-zone fields; the sheet header states the zone. SQLite error times are
local — convert before correlating with samples.

---

## 5. Statistics engine

### 5.1 Data never fully held in memory
One pass over `RawData.eve`, updating aggregates keyed by
**script × transaction × phase (full / steady) × time bucket** and **× LG**, **× VUser**.

### 5.2 Per aggregate
| Statistic | Method | Exact? |
|---|---|---|
| Count, Pass, Fail, Stop | counters | exact |
| Min, Max, Sum, Avg | running | exact |
| Std deviation | Welford's online algorithm | exact |
| P50, P80, P85, P90, P95, P99 (+ any) | **exact** when the run is small enough (all samples kept as Float32 per transaction, threshold configurable, default ~50 M samples); otherwise **HDR histogram** with ≤ 1 % relative error | stated in output |
| TPS | count ÷ phase/bucket seconds | exact |

The Method sheet states, per run, which percentile method was used and its accuracy.

### 5.3 Phases and steady state
- Ramp-up / steady / ramp-down boundaries from `_t_rep.eve` (last VUser running → first VUser
  exiting), per group and overall.
- The user can **adjust** the steady window in the dashboard (draggable band); steady-state
  sheet and figures recompute from per-bucket aggregates (no re-parse).

### 5.4 Scale
| Run size | Path | Expected time |
|---|---|---|
| ≤ ~5 GB | Browser, folder or ZIP | seconds – minutes |
| 5 – 100 GB | Browser, **folder** selection (no unzip) | minutes |
| 100 – 500 GB+ | **Local CLI** (same engine, Node streams) | ~10–30 min at disk speed |

Progress bar, cancel, and memory guard in all paths.

### 5.5 Granularity
Base aggregation at 1 s; chart buckets chosen automatically to give ~300–600 points per chart
(1 s, 5 s, 15 s, 30 s, 1 min, 5 min, 15 min). User can override.

---

## 6. Outputs

### 6.1 Excel workbook

| # | Sheet | Content |
|---|---|---|
| 1 | **Test Overview** | Scenario, project, LRE version, start/end (local + UTC), duration, start/stop reason, total & peak VUsers, groups/scripts, LGs with IP and VUsers each, Controller, total transactions, overall & steady TPS, peak/avg hits/s, throughput, errors. **Schedule**: initialise / ramp-up / steady / ramp-down — planned vs actual |
| 2 | **Transaction Summary — Full Run** | Script, Transaction, Count, Pass, Fail, Stop, Fail %, Min, Avg, Max, Std Dev, P50, P80, P85, P90, P95, P99, TPS, SLA verdict. Grouped by script with subtotals |
| 3 | **Transaction Summary — Steady State** | Same columns, steady window only (window shown in header) |
| 4 | **Workload Model** | Script, script ID, group, protocol, VUsers, LGs (name, IP, VUsers on each), pacing (plain words), think time, iterations planned vs achieved, run-time settings of note. **LG load table**: per LG — scripts, total VUsers, peak CPU/memory |
| 5 | **Error Summary** | Script, injector, error code, message (grouped), count, affected VUsers, first/last seen; plus full error log |
| 6 | Time Series | Per bucket: VUsers, TPS, avg/P90/P95 per transaction, hits/s, throughput, errors |
| 7 | LG Health | CPU/memory/disk per LG over time, peak/avg |
| 8 | Insights | All findings with evidence (§7) |
| 9 | Method & Validation | How each figure is computed, percentile method, steady window, clamped samples, self-check results, comparison with LRE where supplied |

Formatting: frozen header, filters, number formats (s / % / counts), conditional formatting for
SLA and fail %, explicit column widths.

### 6.2 Dashboard (and chart set used by all reports)

| Area | Charts |
|---|---|
| Load | Running VUsers with phase bands; VUsers by script (stacked) |
| Throughput | TPS overall / per transaction; hits/s; throughput MB/s; passed vs failed TPS |
| Response time | Avg / P90 / P95 / P99 bands over time; **latency heatmap** (time × RT bins); histogram (log) + percentile curve per transaction |
| Combined | VUsers + TPS + P95 on one time axis; **TPS vs RT scatter** (saturation knee); **VUsers vs throughput** scalability curve |
| Errors | Errors over time by type with RT overlay; HTTP codes over time; errors by LG / script |
| Infrastructure | LG CPU / memory with 80 / 85 % thresholds; **RT per LG side by side**; VUser × time heatmap |
| Overview | Health card per script / transaction: sparkline, P95, fail %, trend, verdict |

Filters: script, transaction, LG, phase, time range (brush). Light/dark theme.

### 6.3 PDF and Word
Same content and chart images: cover + executive summary (verdict, key numbers, top findings),
test & workload overview, transaction results (full and steady), trends, errors, LG health,
findings with evidence, method appendix. Word is fully editable; PDF via print layout.
Company template/logo if provided (§11).

### 6.4 SLA
User enters thresholds per transaction (or a default, e.g. P90 ≤ x s) in the UI; optional save to
browser storage; SLA-scope list from `SLAConfiguration.xml`. Apdex per transaction from the
same thresholds.

---

## 7. Insights (data-science checks)

All offline and rule-based; every finding shows the evidence and the chart it comes from.

| Check | Method |
|---|---|
| Test validity — throughput consistent with load | **Little's Law**: VUsers ≈ X × (R + Z); flags pacing not achieved or saturated LGs |
| Pacing achieved | iterations per VUser vs planned |
| Degradation over time (soak) | robust slope + Mann-Kendall trend test |
| When behaviour changed | change-point detection (e.g. PELT / CUSUM) on per-bucket P90 and TPS |
| Spikes | robust z-score (median / MAD) per bucket |
| LG bottleneck | RT and errors per LG compared; correlation with LG CPU/memory |
| Error / spike correlation | errors, RT spikes, VUser changes, LG CPU within the same window |
| Clock skew | negative RTs and cross-LG timestamp offsets |
| SLA / Apdex | against user thresholds |

Findings are written in plain English (e.g. "SC01_07 P95 rose 34 % over the soak; 92 % of its
slow samples ran on LG-B, whose CPU exceeded 85 % for 41 min"). An optional AI-written narrative is
out of scope until approved (client data must not leave the machine).

---

## 8. Validation & testing

- **Self-check output** on every run: record counts per type, unknown field values, transactions
  per iteration (flag ≫ 1), negative-RT count, files found/missing.
- **Golden tests:** sanitised slices of real `RawData.eve` + expected aggregates (bytes in,
  numbers out), built in Phase 0.
- **LRE cross-check:** Transaction Summary vs LRE Analysis for the same run — counts must match
  exactly; averages/percentiles within the documented method difference.
- Unit tests per engine module; scale test with a synthetic multi-GB `.eve` (memory flat,
  throughput measured); browser test (Playwright) for the page and exports.

---

## 9. Phases

| Phase | Scope | Exit criteria |
|---|---|---|
| **0 — Prove the decode** | Engine skeleton: file discovery, all text parsers, streaming `.eve` decoder per SPEC, self-checks, minimal console/JSON summary. Run on real run 59 (by the user) and compare with LRE Analysis | Transaction counts match LRE; record kinds and status field identified (or documented as absent); VUser-ID scope known (multi-script sample) |
| **1 — Engine** | Statistics (exact + HDR), phases, steady window, per script/LG/VUser aggregates, result model, Web Worker, progress/cancel | Golden tests pass; 1 GB synthetic run in browser with flat memory |
| **2 — Excel** | Sheets 1–9 | Workbook opens cleanly; figures equal the engine model |
| **3 — Dashboard & menu** | Portal menu entry, page, folder/ZIP picker, all charts, filters, granularity control, steady-state band, SLA input | Playwright test: load sample → charts render → exports download |
| **4 — Insights** | §7 checks + findings text, Insights sheet | Each check unit-tested with synthetic patterns (trend, change-point, LG bias) |
| **5 — PDF & Word** | Report layouts, chart images, template/logo | Reports generated for sample runs; reviewed |
| **6 — CLI & extras** | Local CLI for very large runs; baseline-vs-run comparison; saved SLA profiles | CLI output identical to browser for the same input |

Phase 0 is the gate: no reporting work starts until the decode is confirmed on real data.

---

## 10. Risks

| Risk | Mitigation |
|---|---|
| `.eve` layout differs between LRE versions or protocols | Version check from `.lrr`; self-checks flag unknown records; golden files per version |
| Status field not present in `.eve` | Derive pass/fail from aggregate records or `sum_data` fail graphs; document the source |
| Very large runs exceed browser limits | Folder selection (no unzip), streaming, CLI path |
| Corporate browser blocks WASM / File System Access | Fallbacks: `<input webkitdirectory>`; sql.js-free error sheet from `sum_data` if WASM blocked |
| Users compare with LRE and see differences | Method & Validation sheet explains each difference (percentile method, steady window, clamping) |

---

## 11. Inputs still needed

| # | Item | Blocks |
|---|---|---|
| 1 | LRE Analysis **Transaction Summary / Summary Report** for run 59 | Phase 0 sign-off |
| 2 | The user runs the Phase 0 tool on real run 59 and returns the self-check + summary output (numbers only) | Phase 0 sign-off |
| 3 | Text files from a run with **2+ scripts / groups** (`*.lrr`, `_t_rep.eve`, all `*.cfg` / `*.usp` / `*.usr*`, `collate.txt`, `sum_data/sum_dat.ini`) | Script grouping, workload sheet |
| 4 | A run **with failed transactions** (LRE summary + self-check output) | Pass/fail columns |
| 5 | `sum_data/sum_dat.ini` + first 300 lines of each `graph_*.dat` | Hits, throughput, HTTP codes, LG charts |
| 6 | Confirm the Controller host (is the monitored host with no VUsers the Controller?) | Test Overview |
| 7 | Largest expected results size and typical one | Default path (browser vs CLI) |
| 8 | SLA thresholds — user-entered or a standard set? | §6.4 |
| 9 | Company template / logo for PDF and Word | Phase 5 |

---

## 12. Documentation to update as phases land

`Docs/FUNCTIONAL-SPEC.md` (new section), `Docs/TECHNICAL-REFERENCE.md`, `Docs/DECISIONS.md`
(ADR: browser-side streaming engine; percentile method), `CHANGELOG.md`, user guide
(`Docs/user/RESULTS-ANALYSER-GUIDE.md`), `CLAUDE.md` file map.
