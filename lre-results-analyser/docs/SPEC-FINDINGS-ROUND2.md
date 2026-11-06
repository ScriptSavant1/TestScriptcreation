# LRE Results Analyser — Round 2 Findings (after the eve.js update)

> **Superseded** by `SPEC-RawData-eve-REVERSE-ENGINEERED.md` (final layout). Kept for history only.

Re-validated the **updated** code against LRE Analysis (run 59). The transaction decode is now
**much closer** — response times and counts for the common record are correct — but results are
still wrong because of **two** remaining defects. One is in `eve.js` (variant record offsets),
one is in `txnames.js` (name resolution). Both are described below with the exact fix.

Nothing in the code was changed by this review; only the docs were updated.

## What is now CORRECT (good progress)

- `eve.js` reads the right record **family** `{12586944, 12586945, 12619721}` and uses
  `endTs − startTs` in seconds. For the common record (12586944) the numbers match LRE:
  id 10 → count 2,995, avg 1.064 s (= SC01_04 `1.063`); id 14 → 0.257 s (= SC01_07); etc.
- subType 762 is correctly treated as a data-point stream, not a transaction.
- Total transaction records summed across the family = **30,304** = LRE's 30,301 pass + 3 fail. ✅

## DEFECT 1 — `eve.js`: the three variants are read at the SAME offsets (they must not be)

**Symptom in the output:** dozens of junk transaction ids (16511, 16632, 2793912102, …) and
several real ids showing impossible averages like `avg = 1790688908`, `min = 1000000000`
(these are raw timestamps, not durations).

**Cause:** `decodeTx()` reads `startTs=+28`, `endTs=+36`, `txId=+52` for **every** family member.
That is only correct for `12586944` (len 76). The other two variants insert extra fields, so the
timestamps and id are at different offsets:

| field | 12586944 (76) | 12586945 (84) | 12619721 (108) |
|---|---|---|---|
| startTs | +28 | **+36** | **+40** |
| endTs | +36 | **+44** | **+48** |
| txId | +52 | **+60** | **+64** |
| failed flag | — | — | +76 = `0xffffffff` |

Reading the 84/108-byte records at +28/+36/+52 subtracts the wrong bytes → garbage duration and a
garbage id (a chunk of a timestamp read as a uint32, e.g. 2793912102). The current plausibility
guard (`rt < -60 || rt > 7*86400`) catches the extreme ones but **not** all — some land in range
and corrupt a real transaction's stats (id 15 shows avg in the millions, count inflated by a few).

**Fix (either approach):**

- **A — branch on subType** and use the offset table above; set `failed = (sub === 12619721)` or
  `u32(+76) === 0xffffffff`.
- **B (preferred, version-proof) — locate the timestamps structurally:** within the record, find
  the one pair of **adjacent** Float64 big-endian values both in `1e9…2e9`; those are start/end.
  Take the first `uint32 < 100000` that appears after them as the txId. Keep the existing
  plausibility validation and **tally rejects per subType** instead of letting them through.

After the fix, the family must yield exactly 14 distinct transaction ids (not ~160), summing to
30,301 pass + 3 fail.

## DEFECT 2 — `txnames.js` / `analyse.js`: names are wrong or unresolved

**Symptoms in the output:**
- Names carry the raw sum_dat.ini string, e.g.
  `"SC01_04_TESTS_AND_SCRIPTS,26#0.000000#0.000000#0.000000#0.000000"`.
- Most ids fall back to `TX_11`, `TX_12`, … (method says "matched … 2 of 13 ids").
- Some ids get the wrong name (id 17 labelled `SC01_10_HOSTS` but its avg 0.209 is a different txn).

**Cause 1 — the match source is empty.** `analyse.js resolveNames()` feeds `txnames.resolve()` the
`es_tr_response_time` graph, filtered by `m.sumCount > 0`. In `sum_dat.ini` that graph's
measurements are `NAME,id#0.000000#0.000000#0.000000#0.000000` — **the stats are all zero**, and
the `.dat` provides little count. So the Hungarian statistical match has almost nothing to match
against and resolves only 2 ids by coincidence.

**Cause 2 — the name string is not parsed.** The measurement value
`SC01_04_TESTS_AND_SCRIPTS,26#0#0#0#0` is used almost verbatim; only a `group:` prefix is stripped
(`replace(/^.*:/, "")`), not the `,<id>#…` suffix. So even a "matched" name is dirty.

**Cause 3 — fuzzy matching is the wrong design here.** The id→name mapping is deterministic and
present in the result set; it should not be guessed from statistics at all.

**Fix:**
1. Parse the sum_dat.ini measurement value into `{ name, measurementId }` by splitting on the first
   `,` and cutting at the first `#`: `SC01_04_TESTS_AND_SCRIPTS,26#0#0#0#0` →
   name `SC01_04_TESTS_AND_SCRIPTS`, id `26`. (The same parsing is needed in `dat.js` for every
   graph that uses the `NAME,id#...` form — `es_tr_response_time`, `es_tr_tprange_pass/fail`.)
2. Build the authoritative transaction set from the **pass graph** (`es_tr_tprange_pass`,
   `graph_2`) and `es_tr_tprange_fail` — these give the exact per-name pass/fail counts LRE shows
   (SC01_04 = 3,022; SC01_05 = 3,019 pass + 3 fail; etc.).
3. Map the eve `+52` internal id to the name by matching **pass count** (exact or ±1), which is a
   strong, near-unique key once Defect 1 is fixed (the per-id counts become clean: 27, 27, 27,
   3022, 3019…). Response-time **mean/max are all zero in sum_dat.ini**, so do not rely on them.
4. If a clean 1-to-1 count match is not possible, surface a self-check failure — never emit
   `TX_<id>` or a raw `NAME,id#…` string in the report.

> Pass/fail itself is already available and correct in `Report2.csv` / `graph_2` / `graph_14`;
> once the names are parsed, `crossCheckSumData()` will reconcile cleanly.

## Acceptance checklist (unchanged — the target)

| Transaction | count | avg (s) | fail |
|---|---|---|---|
| SC01_01_LAUNCH | 27 | 11.227 | 0 |
| SC01_02_AUTHENTICATE | 27 | 0.445 | 0 |
| SC01_03_HOME | 27 | 2.075 | 0 |
| SC01_04_TESTS_AND_SCRIPTS | 3,022 | 1.063 | 0 |
| SC01_05_SELECT_SCENARIO | 3,019 | 0.582 | **3** |
| SC01_06_CLICK_EDIT_TEST | 3,019 | 0.688 | 0 |
| SC01_07_RUNS | 3,019 | 0.257 | 0 |
| SC01_08_MONITORS | 3,019 | 0.178 | 0 |
| SC01_09_ANALYSIS_TEMPLATES | 3,019 | 0.031 | 0 |
| SC01_10_HOSTS | 3,019 | 0.217 | 0 |
| SC01_11_TIMESLOTS | 3,019 | 0.264 | 0 |
| SC01_12_PERFORMANCE_TRENDING | 3,019 | 0.065 | 0 |
| SC01_13_SYSTEM_REPORTS | 3,019 | 2.103 | 0 |
| SC01_14_LOGOUT | 27 | 0.399 | 0 |
| **TOTAL** | **30,301** | — | **3** |

- Exactly **14** named transactions, **zero** `TX_<id>` and **zero** raw `NAME,id#…` strings.
- No transaction id with a billions-scale average (that is the Defect-1 signature).
- HTTP: 200 = 219,164, 204 = 18,117, 500 = 3. Max Vusers 27. Duration 29,063 s.

Reference: `Reports/Report/summary.html`, `Report2.csv` (pass/fail), `Report3.csv` (avg over time),
`Report4.csv` (percentiles).
