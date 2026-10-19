# LRE Results Analyser — Round 3: transaction decode SOLVED, and the correct data source

> **Superseded.** The offsets and the "source the table from sum_data" plan below are obsolete.
> The final, validated layout (flag-based records, per-VUser registration ids, no sum_data) is in
> `SPEC-RawData-eve-REVERSE-ENGINEERED.md`. Kept for history only.

This round fully reverse-engineered the transaction records in `RawData.eve` AND identified why a
pure-eve approach can never match LRE exactly. The conclusion is concrete and verified against
run 59 (`Reports/Report/summary.html`, `Report2.csv`, `Report3.csv`, `Report4.csv`).

## 1. What the eve transaction records actually are (verified byte-by-byte)

Three record sub-types carry transactions. They do NOT share field offsets:

| sub-type | len | start ts | end ts | id field | notes |
|---|---|---|---|---|---|
| 12586944 | 76 | +28 | +36 | **+52** | base record — the 10 steady-loop transactions |
| 12586945 | 84 | +36 | +44 | +60 | has an ASCII **step label** at +32 ("1".."14") |
| 12619721 | 108 | +40 | +48 | +64 | failed transaction (`0xffffffff` marker); ASCII label too |

Response time = `endTs − startTs` in **seconds** (verified: reproduces LRE durations).

### The base record identity (+52) is a per-step id, resolvable by start order
Within one VUser iteration the base records appear in **script order**. For run 59, ordering the
distinct `+52` ids by first start time gives:

`10→SC01_04, 12→SC01_05, 13→SC01_06, 14→SC01_07, 15→SC01_08, 16→SC01_09, 17→SC01_10,
18→SC01_11, 19→SC01_12, 20→SC01_13` (the 10 loop transactions).

The one-time transactions (SC01_01/02/03/14, 27 each) and some first-iteration instances come from
the 12586945 / 12619721 variants, whose ASCII label at +32 is literally the step number ("1".."14").

### Why a pure-eve table cannot match LRE exactly
When all variants are summed, the per-step counts come out slightly low/high (e.g. SC01_05 2246 vs
3019, SC01_07 2687 vs 3019) because a few hundred first-iteration instances are stored under
separate internal ids (seen as ids 11, 21, 22 — 444/329/329 records) that are hard to attribute to
the right step from the binary alone. The averages for a few steps drift for the same reason.
**The internal +52 id is not a clean 1:1 transaction key**, so no offset fix makes eve alone exact.

## 2. The authoritative source: sum_data graph_4 / graph_2 / graph_14

`sum_data/graph_4.dat` (GraphType `es_tr_response_time`) aggregated per measurement **reproduces
LRE's transaction table EXACTLY**. Each line is `measId ts avg count min max stddev`; the measId→name
map is in `sum_dat.ini` (`SC01_04_TESTS_AND_SCRIPTS,26#...` → measId 26). Verified for run 59:

| name | graph_4 count | graph_4 avg | LRE |
|---|---|---|---|
| SC01_01_LAUNCH | 27 | 11.227 | ✅ exact |
| SC01_02_AUTHENTICATE | 27 | 0.445 | ✅ |
| SC01_03_HOME | 27 | 2.075 | ✅ |
| SC01_04_TESTS_AND_SCRIPTS | 3022 | 1.063 | ✅ |
| SC01_05_SELECT_SCENARIO | 3019 | 0.582 | ✅ |
| SC01_06_CLICK_EDIT_TEST | 3019 | 0.688 | ✅ |
| SC01_07_RUNS | 3019 | 0.257 | ✅ |
| SC01_08_MONITORS | 3019 | 0.178 | ✅ |
| SC01_09_ANALYSIS_TEMPLATES | 3019 | 0.031 | ✅ |
| SC01_10_HOSTS | 3019 | 0.217 | ✅ |
| SC01_11_TIMESLOTS | 3019 | 0.264 | ✅ |
| SC01_12_PERFORMANCE_TRENDING | 3019 | 0.065 | ✅ |
| SC01_13_SYSTEM_REPORTS | 3019 | 2.103 | ✅ |
| SC01_14_LOGOUT | 27 | 0.399 | ✅ |

- **Pass/fail**: `graph_2` (es_tr_tprange_pass, per-name pass) + `graph_14` (es_tr_tprange_fail →
  SC01_05 = 3). `Report2.csv` confirms (SC01_05: 3019 pass, 3 fail; all others 0 fail).
- **Min/Max/percentiles**: `graph_4.dat` min/max columns, and `Report4.csv` holds the full
  percentile distribution per transaction (P1..P100).

## 3. Recommended implementation (the correct fix)

Drive the **transaction summary table** (count, avg, min, max, pass, fail, TPS) from **sum_data**,
not from the eve `+52` id:

1. Parse `graph_4.dat` per measId → `{count=Σcnt, avg=Σ(avg·cnt)/Σcnt, min, max}`; name via
   `sum_dat.ini` (`dat.js` already strips the `#...` suffix after this round's fix).
2. Pass/fail per name from `graph_2`/`graph_14` (and reconcile with `Report2.csv` semantics).
3. Keep RawData.eve for the **distribution/percentile** panels and per-LG splits, matched to the
   name by response-time average (now unambiguous because the sum_data averages are exact).
4. Keep the eve total (30,304 records = 30,301 pass + 3 fail) as a self-check against the sum_data
   totals; surface a validation warning if they diverge beyond a small tolerance.

This matches how LRE Analysis itself builds the report, so the numbers will line up exactly.

## 4. Status of code changes made this session

- `eve.js`: variant-aware offsets + structural fallback + per-id `startMin` — correct for decoding,
  and good enough for distributions. Totals now exactly 30,301 pass / 3 fail (was 422,225).
- `dat.js`: measurement parsing now strips the `#...` suffix (names are clean) — **required** for
  the sum_data-driven table.
- `txnames.js` / `analyse.js`: name matching improved; but the transaction table is still eve-id
  keyed, which is why 6 of 14 still drift. **The remaining work is to source the table from
  sum_data (§3)** — an architecture change in `analyse.js` (and the store/UI consumers), not a
  one-line patch.

## 5. Acceptance (unchanged)
Totals 30,301 pass / 3 fail; the 14 rows exactly as the graph_4 table above; HTTP 200/204/500 =
219,164 / 18,117 / 3; max VUsers 27; duration 29,063 s.
