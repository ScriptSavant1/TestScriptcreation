# LRE Results Analyser — Discovery, Feasibility & Development Plan

> **Status**: Pre-development — Analysis & Planning
> **Author**: RAM
> **Date**: 2025
> **Based on**: RawResults_59 (Run 59 — LRE263_DEV_Soak_100pct_27VU_8hr)

---

## 1. Feasibility Verdict: YES — Build From Raw Data, Not Summaries

The user's instinct is correct. **RawData.eve contains every individual transaction execution** — 422,225 raw records across 27 VUsers over 8 hours. We can compute our own percentiles, averages, spikes, and trends from scratch.
We do not need to trust LRE's pre-summarised `.dat` files.

**Why raw is better than summarised:**
- `.dat` files aggregate into 5-second buckets — we lose sub-second timing and individual VUser data
- `RawData.eve` has per-transaction, per-VUser, millisecond-precision timestamps
- We can compute true P90/P95/P99 from the actual distribution, not from bucket averages
- We can detect which specific VUser had a spike, at what exact time, in which iteration
- We can correlate failures across VUsers at the same timestamp
- The SQLite DB has the actual error messages with timestamps

---

## 2. File Inventory — What We Use

| File | Use |
|------|-----|
| `RawData.eve` | **PRIMARY** — 34MB binary, 422,225 transaction records, fully decoded |
| `RawData.map` | Transaction ID → name mapping (IDs 1-14) |
| `RunInfo.ini` | Session name, date, duration |
| `res59.lrr` | Scenario config (VUsers, ramp, protocol) |
| `SLAConfiguration.xml` | SLA transaction list |
| `SqliteDb.db` | Error messages with timestamps (4 rows) |
| `_t_rep.eve` | VUser lifecycle events (start/stop/ramp) — plain text |
| `sum_data/graph_0.dat` | VUser count per second (for ramp chart) |
| `sum_data/graph_1.dat` | LG CPU/Memory/Disk (monitoring data) |
| `sum_data/graph_10.dat` | HTTP 200/204/500 counts over time |

**Files we skip:**
- `ControllerMonitoring.eve` — binary, same data as graph_1.dat
- `sum_data/graph_2-9,11-14.dat` — redundant, we compute from raw
- `AnalysisDataBaseStructure.pdf` — compressed, not needed

---

## 3. RawData.eve — Fully Decoded Binary Format

### 3.1 File Structure

The file is a stream of length-prefixed binary records:

```
[recLen:uint32BE][type:uint32BE][payload...]
```

**Record types:**
| type | len | Meaning |
|------|-----|---------|
| 7 | 24 | File header (1 record, at offset 0) |
| 3 | varies | All data records (505,069 total) |

All 505,069 type-3 records are distinguished by a **sub-type ID** at payload offset +16:

| sub-type (val at +16) | len | Meaning |
|-----------------------|-----|---------|
| 762 (0x2FA) | 64 | **Transaction event** — one per transaction execution |
| 766 (0x2FE) | 72 | Monitoring data point (CPU/memory/network per LG) |
| 12586944 (0xC00100) | 76 | Transaction aggregate/summary |
| 12586945 (0xC00101) | 84 | Transaction start/end marker |
| 12619721 (0xC08009) | varies | Other |

### 3.2 Transaction Record Layout (sub-type 762, len=64)

```
Offset  Size  Type       Field
+0      4     uint32BE   recLen = 64
+4      4     uint32BE   type = 3
+8      4     uint32BE   field_id = 1
+12     4     uint32BE   field_len = 52
+16     4     uint32BE   sub_field_id = 1
+20     4     uint32BE   sub_field_len = 44
+24     4     uint32BE   sub_type = 762
+28     8     double BE  unix timestamp (seconds, millisecond precision)
+36     4     uint32BE   iteration number (0-113 across the 8hr run)
+40     4     uint32BE   (padding/flags = 0)
+44     8     double BE  response time in MILLISECONDS
+52     4     uint32BE   VUser ID (1-27)
+56     4     uint32BE   transaction ID (1-14, maps to RawData.map)
+60     4     uint32BE   (padding = 0)
```

### 3.3 Monitoring Record Layout (sub-type 766, len=72)

Contains LG CPU/Memory/Disk values. The payload includes:
- LG hostname string (e.g. `ctrl-host-03.corp.example [192.0.2.10]`)
- Metric name string (e.g. `CPU Usage`, `Memory Usage`, `Disk Usage`)
- Two double BE values (current value + something else)

### 3.4 Key Confirmed Facts

- **422,225 transaction records** in the file
- **27 VUsers** confirmed (IDs 1-27)
- **Timestamps** are IEEE 754 double BE, unix seconds with ms precision
- **Response times** are IEEE 754 double BE, in **milliseconds**
- **Iteration** field increments per VUser per loop (0 to ~113 over 8 hours)
- **Transaction IDs** 1-14 map directly to RawData.map names
- **TX_21** appears (6,740 records) — not in RawData.map, likely `Main_Transaction`
- Time range: t+11s to t+29063s = 484.2 minutes ✓ matches RunInfo.ini (485 min)

---

## 4. Transaction Statistics — Computed From Raw Data

These are computed directly from the 422,225 raw records. **These are the ground truth.**

| Transaction | Count | Avg | P50 | P90 | P95 | P99 | Max |
|-------------|-------|-----|-----|-----|-----|-----|-----|
| SC01_01_LAUNCH | 171,326 | 0.001s | 0.001s | 0.001s | 0.001s | 0.002s | 0.003s |
| SC01_02_AUTHENTICATE | 3,123 | 0.001s | 0.002s | 0.003s | 0.003s | 0.003s | 0.003s |
| SC01_03_HOME | 87,262 | 2.410s | 0.001s | 3.813s | 11.750s | 86.417s | 116.854s |
| SC01_04_TESTS_AND_SCRIPTS | 30,199 | 10.221s | 3.140s | 19.674s | 49.766s | 116.853s | 116.854s |
| SC01_05_SELECT_SCENARIO | 38,257 | 5.658s | 0.006s | 14.894s | 19.674s | 101.607s | 116.854s |
| SC01_06_CLICK_EDIT_TEST | 39,122 | 11.340s | 4.522s | 21.058s | 49.666s | 116.853s | 116.854s |
| SC01_07_RUNS | 27,347 | 17.853s | 7.561s | 51.737s | 104.026s | 116.854s | 116.854s |
| SC01_11_TIMESLOTS | 15,406 | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s |
| SC01_12_PERFORMANCE_TRENDING | 2,684 | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s |
| SC01_14_LOGOUT | 759 | 0.003s | 0.001s | 0.005s | 0.005s | 0.005s | 0.006s |
| TX_21 (Main_Transaction?) | 6,740 | 0.002s | 0.001s | 0.005s | 0.005s | 0.005s | 0.005s |

**Note**: Negative min values (-0.005s to -0.006s) on some transactions indicate clock skew between LGs — these are sub-millisecond and should be clamped to 0.

**Critical finding**: SC01_05_SELECT_SCENARIO has spikes starting at t+15s (VUser 3, 28.7s) — this is during ramp-up, not steady state. The SLA failure is real.

**Missing transactions**: SC01_08_MONITORS, SC01_09_ANALYSIS_TEMPLATES, SC01_10_HOSTS, SC01_13_SYSTEM_REPORTS have zero records — these pages were either not reached or not instrumented.

---

## 5. SQLite DB — Error Log

The `SqliteDb.db` contains 4 error records:

| Time | Error | VUser | Message |
|------|-------|-------|---------|
| 2026-09-29 14:33:49 | -82220 | 1 | Transfer all files to remote hosts before running scenario - Disabled |
| 2026-09-29 14:35:22 | -227822 | 2,3,4 | HTTP 500 from `https://app.example.test/loadtest/rest-pcweb/test/getRunTrends` |

The HTTP 500 error at 14:35:22 (t+112s) on VUsers 2, 3, 4 is the root cause of the early spikes.

---

## 6. _t_rep.eve — VUser Lifecycle Events

Plain text file, 139 lines. Format: `28 <eventType> <scriptName> <vuserNum> <timestamp> ...`

| Event Type | Count | Meaning |
|------------|-------|---------|
| 4 | 27 | VUser initialised (ramp-up) |
| 0 | 27 | VUser started running |
| 2 | 27 | VUser running (confirmed active) |
| 8 | 27 | VUser stopped |
| 1 | 27 | VUser ramped down |
| 10 | 2 | Load Generator connected |
| 11 | 1 | Scenario started |
| 12 | 1 | Scenario ended |

VUser ramp: VUser 1 starts at t+9s, VUser 27 starts at t+62s (1 VUser every ~2s, not 5s as in config — actual measured from file).

---

## 7. Architecture — 3 New Files Only

```
src/
├── parsers/
│   └── lreResultsParser.js     NEW — reads RawData.eve + supporting files
├── analyzers/
│   └── lreResultsAnalyser.js   NEW — computes stats, detects anomalies
└── generators/
    └── lreReportGenerator.js   NEW — produces self-contained HTML report
```

Zero changes to existing files. New CLI command: `node src/cli.js analyse-results -i RawResults_59/ -o report.html`

---

## 8. Parser Design — lreResultsParser.js

### 8.1 RawData.eve Parser

```javascript
parseEve(filePath) {
    // Returns: { transactions: [], monitoring: [] }
    // transactions[]: { ts, t, vuser, txId, rt, iteration }
    //   ts = unix timestamp (double)
    //   t  = seconds since scenario start
    //   rt = response time in milliseconds
    // monitoring[]: { ts, t, host, metric, value }
}
```

**Algorithm:**
1. Read file into Buffer
2. Skip 24-byte type-7 header
3. Loop: read recLen (uint32BE), skip if type≠3
4. Read sub-type at +24
5. If sub-type=762: extract ts(+28), iteration(+36), rt(+44), vuser(+52), txId(+56)
6. If sub-type=766: extract monitoring data (host string + metric string + double)

### 8.2 Supporting File Parsers

```javascript
parseRawDataMap(filePath)      // → { 1: 'SC01_01_LAUNCH', 2: 'SC01_02_AUTHENTICATE', ... }
parseRunInfo(filePath)         // → { sessionName, date, duration }
parseScenarioConfig(filePath)  // → { vusers, rampRate, protocol, scriptName }
parseSlaConfig(filePath)       // → ['SC01_01_LAUNCH', ...]
parseVuserLifecycle(filePath)  // → { startTime, endTime, vuserEvents[] }
parseGraphDat(filePath)        // → [{ id, ts, avg, count, min, max, stddev }]
parseSqliteErrors(filePath)    // → [{ time, errorCode, message, vuser }]
```

---

## 9. Analyser Design — lreResultsAnalyser.js

### 9.1 Core Statistics

```javascript
computeTransactionStats(transactions, txNameMap) {
    // Per transaction: count, avg, min, max, p50, p90, p95, p99, stddev
    // Steady-state only: exclude first 5% and last 5% of time range
    // Clamp negative RTs to 0 (clock skew artefact)
}
```

### 9.2 Spike Detection

```javascript
detectSpikes(transactions, txId) {
    // Z-score: flag any record where rt > mean + 2.5*stddev
    // Group consecutive spikes into "spike events"
    // Return: [{ startTime, endTime, peakRt, affectedVUsers }]
}
```

### 9.3 Trend Analysis

```javascript
detectDegradation(transactions, txId) {
    // Linear regression on 5-minute bucket averages
    // Return: { slope (ms/hour), r2, isDegrading }
}
```

### 9.4 Ramp Phase Isolation

```javascript
isolateSteadyState(transactions, vuserLifecycle) {
    // Exclude records before all 27 VUsers are active
    // Exclude records after first VUser starts ramping down
    // Return: { steadyStart, steadyEnd, steadyTransactions[] }
}
```

---

## 10. Report Generator Design — lreReportGenerator.js

Self-contained HTML with embedded Chart.js (CDN link, or inline minified for offline use).

### Report Sections

1. **Executive Summary** — session name, date, duration, VUsers, overall PASS/FAIL
2. **Transaction Summary Table** — per-transaction stats with PASS/FAIL badges
3. **Response Time Charts** — per-transaction time-series (5-min buckets)
4. **VUser Ramp Profile** — from graph_0.dat
5. **HTTP Error Timeline** — from graph_10.dat
6. **LG Health** — CPU/Memory from graph_1.dat
7. **Spike Report** — auto-detected anomalies with timestamps
8. **Error Log** — from SqliteDb.db

---

## 11. Development Phases

### Phase 1 — Parser (Week 1)
- `lreResultsParser.js`: parse RawData.eve + supporting files
- Deliverable: `--dump-json` outputs clean JSON data model

### Phase 2 — Analyser (Week 1-2)
- `lreResultsAnalyser.js`: stats, spikes, trends, steady-state isolation
- Deliverable: console summary output

### Phase 3 — Report Generator (Week 2)
- `lreReportGenerator.js`: HTML report with Chart.js charts
- Deliverable: self-contained `report.html`

### Phase 4 — CLI & Web UI Integration (Week 3)
- `src/cli.js`: add `analyse-results` command
- `src/web/server.js`: add `/analyse-results` POST endpoint
- `src/web/views/index.ejs`: add "Results Analyser" tab

---

## 12. Dependencies

Only one new runtime dependency:

```json
{ "better-sqlite3": "^9.x" }
```

Chart.js is embedded via CDN link in the output HTML (no server-side dependency).

---

## 13. Isolation Guarantee

| Existing Area | Impact |
|---------------|--------|
| Postman/Bruno → DevWeb | None |
| Postman/Bruno → VuGen | None |
| JMX → DevWeb/VuGen | None |
| Web UI | New tab only |
| Recorder / Script Studio | None |

New files only — zero changes to existing generators, parsers, or analyzers.

---

*End of Plan Document*
