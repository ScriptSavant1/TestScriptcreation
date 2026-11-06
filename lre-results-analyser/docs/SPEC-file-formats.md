# LRE Results Analyser — Complete Technical Specification

> **Partly superseded (2026-10-16).** Parts 1, 2 and 4 (folder layout, text files, sum_data) are still
> valid. **Part 3 and the RawData.eve constants in Parts 14–16 are wrong** — see
> `SPEC-RawData-eve-REVERSE-ENGINEERED.md`. How figures are calculated: `TECHNICAL-DESIGN.md`.

> **Status**: Ready to Build
> **Last Updated**: 2025
> **Purpose**: Complete reference — no re-analysis needed. Everything decoded and documented here.

## PART 1 — RAW RESULTS FOLDER STRUCTURE

### 1.1 Folder Layout

```
RawResults_59/                                      (root — zip this for upload)
├── RawData.eve                         34,436,952  PRIMARY: binary, 422,225 tx records
├── RawData.map                                562  text: measurement ID → name map
├── _t_rep.eve                               9,364  text: VUser lifecycle events
├── RunInfo.ini                                162  text: session metadata
├── res59.lrr                                1,029  text: scenario config
├── SLAConfiguration.xml                       662  XML: SLA transaction list
├── SqliteDb.db                             49,152  SQLite3: error log
├── lre_upgrade_263_nft_scripts_1.cfg        4,140  text: DevWeb rts.yml + run config
├── lre_upgrade_263_nft_scripts_1.usp        1,803  text: run logic (action pacing)
├── collate.txt                                412  text: LG hostnames + .eve file paths
├── collateLog.txt                             133  text: collation status
├── remote_results.txt                         328  text: same as collate.txt
├── ControllerMonitoring.eve             1,884,084  binary: LG monitoring (SKIP — use graph_1.dat)
├── ControllerMonitoring.map                     0  empty
├── offline.dat                                  0  empty
├── res.ini                                      0  empty
├── AnalysisDataBaseStructure.pdf          299,613  PDF: compressed, not needed
└── sum_data/
    ├── sum_dat.ini                          3,658  text: graph metadata + measurement ID map
    ├── graph_0.dat                      1,569,029  text: VUser count per second
    ├── graph_1.dat                      2,778,208  text: LG CPU/Memory/Disk monitoring
    ├── graph_2.dat                      1,158,138  text: transaction pass counts per 5s
    ├── graph_3.dat                      1,158,138  text: cumulative transaction pass counts
    ├── graph_4.dat                      1,136,696  text: response times per 5s (summarised)
    ├── graph_5.dat                        423,661  text: web connections per second
    ├── graph_6.dat                        295,712  text: HTTP response codes per host
    ├── graph_7.dat                        354,403  text: network bytes received
    ├── graph_8.dat                        347,751  text: network bytes sent
    ├── graph_9.dat                        524,676  text: TCP connections
    ├── graph_10.dat                       524,676  text: HTTP 200/204/500 counts
    ├── graph_11.dat                       428,121  text: web connections count
    ├── graph_12.dat                           159  text: transaction error distribution (tiny)
    ├── graph_13.dat                           318  text: VUser error distribution (tiny)
    └── graph_14.dat                            54  text: SLA fail transactions (tiny)
```

### 1.2 Files We Parse (in priority order)

| Priority | File | Why |
|----------|------|-----|
| 1 — MUST | `RawData.eve` | 422,225 individual transaction records — ground truth |
| 2 — MUST | `RawData.map` | Transaction ID → name lookup |
| 3 — MUST | `RunInfo.ini` | Session name, date, duration |
| 4 — MUST | `res59.lrr` | VUser count, ramp schedule, protocol, start/stop timestamps |
| 5 — MUST | `SLAConfiguration.xml` | Which transactions are in SLA scope |
| 6 — MUST | `SqliteDb.db` | Error messages with exact timestamps |
| 7 — MUST | `_t_rep.eve` | VUser ramp-up/ramp-down exact timestamps |
| 8 — NICE | `sum_data/graph_1.dat` | LG CPU/Memory/Disk over time |
| 9 — NICE | `sum_data/graph_10.dat` | HTTP 200/204/500 counts over time |
| 10 — NICE | `sum_data/graph_0.dat` | VUser count per second (for ramp chart) |
| 11 — SKIP | `ControllerMonitoring.eve` | Binary, same data in graph_1.dat |
| 12 — SKIP | `sum_data/graph_4.dat` | Summarised RT — we compute from raw |
| 13 — SKIP | All other .dat files | Redundant or derivable |

## PART 2 — FILE FORMATS (COMPLETE DECODE)

### 2.1 RunInfo.ini

INI format, UTF-8 with BOM.

```ini
[Report]
CompanyName=DEV_POC
SessionName=LRE263_DEV_Soak_100pct_27VU_8hr
RunDate=29-September-2026 02:33:05 PM
Duration=485
UserNotes=
TestDescription=
```

**Fields extracted:**
- `CompanyName` → project/domain label
- `SessionName` → test run name (display title)
- `RunDate` → human-readable date string
- `Duration` → total duration in minutes (integer)

**Parse with:** `ini` style parser — split on `=`, trim values.

### 2.2 res59.lrr

INI format, Windows line endings.

```ini
[Scenario]
Product=Professional Performance Engineering Controller
Version=2026.3.0.0
Start_time=1790688830
Stop_time=1790717893
[Scenario_summary]
Scenario Duration=Start all Vusers: 1 every 00:00:05 (HH:MM:SS); Run for 08:00:00 (HH:MM:SS); Stop all Vusers: 1 every 00:00:05 (HH:MM:SS)
Global Schedule=ST27_1E5;R28800;SP27_1E5;
[Scripts_types]
LRE_Upgrade_263_NFT_Scripts_1=DevWeb
```

**Fields extracted:**
- `Start_time` → unix timestamp (integer seconds) — scenario start
- `Stop_time` → unix timestamp — scenario end
- `Version` → LRE product version
- `Global Schedule` → `ST27_1E5` = Start 27 VUsers 1 every 5s; `R28800` = Run 28800s (8hr); `SP27_1E5` = Stop 27 VUsers 1 every 5s
- `Scripts_types` key → protocol (`DevWeb` or `Web`)
- Script name → `LRE_Upgrade_263_NFT_Scripts_1`

**Derived values:**
- Total duration seconds = `Stop_time - Start_time` = 29,063s
- Peak VUsers = 27 (from `ST27`)
- Ramp-up rate = 1 VUser every 5s (from `1E5`)
- Steady-state duration = 28,800s = 8 hours (from `R28800`)

### 2.3 RawData.map

INI format, two sections.

```ini
[DATA_POINT]
1="tcp_connection_count"
2="tcp_connect"
3="HOST_app.example.test"
4="mic_recv"
5="HTTP_200"
6="mic_sent"
7="HTTP_204"
8="HTTP_500"
9="tcp_shutdown"

[END_TRANSACTION]
1="SC01_01_LAUNCH"
2="SC01_02_AUTHENTICATE"
3="SC01_03_HOME"
4="SC01_04_TESTS_AND_SCRIPTS"
5="SC01_05_SELECT_SCENARIO"
6="SC01_06_CLICK_EDIT_TEST"
7="SC01_07_RUNS"
8="SC01_08_MONITORS"
9="SC01_09_ANALYSIS_TEMPLATES"
10="SC01_10_HOSTS"
11="SC01_11_TIMESLOTS"
12="SC01_12_PERFORMANCE_TRENDING"
13="SC01_13_SYSTEM_REPORTS"
14="SC01_14_LOGOUT"
```

**Note:** IDs 8, 9, 10, 13 appear in the map but have ZERO records in RawData.eve — those transactions were never reached during the test.

**Parse:** regex `^(\d+)="(.+)"` per line, build two Maps: `dataPointMap` and `transactionMap`.

### 2.4 SLAConfiguration.xml

```xml
<SLA Version="1.0">
  <TxList>
    <Tx>SC01_10_HOSTS</Tx>
    <Tx>SC01_03_HOME</Tx>
    ... (15 transactions total including Main_Transaction)
  </TxList>
  <SLARules>
    <TrackingPeriodType>Default</TrackingPeriodType>
  </SLARules>
</SLA>
```

**All 15 SLA transactions:**
SC01_01_LAUNCH, SC01_02_AUTHENTICATE, SC01_03_HOME, SC01_04_TESTS_AND_SCRIPTS,
SC01_05_SELECT_SCENARIO, SC01_06_CLICK_EDIT_TEST, SC01_07_RUNS, SC01_08_MONITORS,
SC01_09_ANALYSIS_TEMPLATES, SC01_10_HOSTS, SC01_11_TIMESLOTS, SC01_12_PERFORMANCE_TRENDING,
SC01_13_SYSTEM_REPORTS, SC01_14_LOGOUT, Main_Transaction

**Note:** No numeric thresholds defined in this file — SLA rules are configured in LRE UI, not stored here. We apply our own thresholds or flag all as "measured".

**Parse:** simple XML — extract all `<Tx>` text nodes into a Set.

### 2.5 SqliteDb.db

Standard SQLite3 database. Use `better-sqlite3` npm package.

**Tables:**

```
Actions          (Action_ID INTEGER, Action_Name TEXT)
ErrorMessages    (Message_ID INTEGER, Message_String TEXT)
Injectors        (Injector_ID INTEGER, Injector_Name TEXT)
Main             (Row_ID, Error_Code, Time DATETIME, Type, Line, Area, Iteration,
                  Action_ID, Message_ID, Injector_ID, Script_ID, Vuser_ID)
Metadata         (Id INTEGER, UpdatedAt DATETIME)
Scripts          (Script_ID INTEGER, Script_Name TEXT)
VusersID         (Vuser_ID INTEGER, Vuser_ID_Name TEXT)
```

**Actual data (Run 59):**

Actions:
- 1 = "" (init/global)
- 2 = "Main"

ErrorMessages:
- 1 = "Transfer all files to remote hosts before running scenario - Disabled"
- 2 = "Error: Vuser action was stopped after receiving HTTP error: 'HTTP Status-Code=500 for https://app.example.test/loadtest/rest-pcweb/test/getRunTrends'. (./main.js:752:5)"

Injectors:
- 1 = "Controller"
- 2 = "lg-host-01.corp.example"

Main (4 error rows):
```
Row 1: Error=-82220,  Time=2026-09-29T14:33:49, Type=1, Iter=0, Action=1, Msg=1, Inj=1, Script=1, VUser=1
Row 2: Error=-227822, Time=2026-09-29T14:35:22, Type=2, Iter=1, Action=2, Msg=2, Inj=2, Script=2, VUser=2
Row 3: Error=-227822, Time=2026-09-29T14:35:22, Type=2, Iter=1, Action=2, Msg=2, Inj=2, Script=2, VUser=3
Row 4: Error=-227822, Time=2026-09-29T14:35:22, Type=2, Iter=1, Action=2, Msg=2, Inj=2, Script=2, VUser=4
```

VusersID:
- 1 = "None"
- 2 = "lre_upgrade_263_nft_scripts:4"
- 3 = "lre_upgrade_263_nft_scripts:10"
- 4 = "lre_upgrade_263_nft_scripts:12"

Scripts:
- 1 = "" (controller)
- 2 = "LRE_Upgrade_263_NFT_Scripts_1"

**Key insight:** HTTP 500 from `getRunTrends` endpoint at t+112s hit VUsers 2, 3, 4 simultaneously — this is the root cause of early spikes.

**Query to use:**
```javascript
const errors = db.prepare(`
  SELECT m.Time, m.Error_Code, m.Iteration, m.Vuser_ID,
         e.Message_String, i.Injector_Name, s.Script_Name, v.Vuser_ID_Name
  FROM Main m
  JOIN ErrorMessages e ON m.Message_ID = e.Message_ID
  JOIN Injectors i ON m.Injector_ID = i.Injector_ID
  JOIN Scripts s ON m.Script_ID = s.Script_ID
  JOIN VusersID v ON m.Vuser_ID = v.Vuser_ID
  ORDER BY m.Time
`).all();
```

### 2.6 _t_rep.eve

Plain text, Windows line endings. Format: `28 <eventType> <fields...>`

**Event types decoded:**

| Type | Meaning | Fields after type |
|------|---------|-------------------|
| 11 | Scenario started | `<timestamp> <field2> <field3> <field4> <field5>` |
| 12 | Scenario ended | `<timestamp> <field2> <endTimestamp> <field4> <durationMs>` |
| 4 | VUser initialised | `<scriptName> <vuserNum> <timestamp> 0 <scriptInstanceName> <lgHostname> 0 1` |
| 0 | VUser started running | `<scriptName> <vuserNum> <timestamp> 0 <lgHostname> 0` |
| 8 | VUser running confirmed | `<scriptName> <vuserNum> (empty) 0 0` |
| 2 | VUser active/running | `<scriptName> <vuserNum> <timestamp> 0 p 0 0` |
| 10 | LG connected | `<lgHostname> <maxVUsers> 0 0` |
| 1 | VUser ramping down | `<scriptName> <vuserNum> <timestamp> 0 2` |

**Full VUser ramp-up timeline (from file):**

| VUser | Init Timestamp | Start Timestamp | LG |
|-------|----------------|-----------------|----|
| 1 | 1790688839 (t+9s) | 1790688845 (t+15s) | lg-host-02 |
| 2 | 1790688846 (t+16s) | 1790688919 (t+89s) | lg-host-01 |
| 3 | 1790688841 (t+11s) | 1790688846 (t+16s) | lg-host-02 |
| 4 | 1790688846 (t+16s) | 1790688919 (t+89s) | lg-host-01 |
| 5 | 1790688851 (t+21s) | 1790688856 (t+26s) | lg-host-02 |
| 6 | 1790688856 (t+26s) | 1790688918 (t+88s) | lg-host-01 |
| 7 | 1790688861 (t+31s) | 1790688866 (t+36s) | lg-host-02 |
| 8 | 1790688866 (t+36s) | 1790688919 (t+89s) | lg-host-01 |
| 9 | 1790688871 (t+41s) | 1790688876 (t+46s) | lg-host-02 |
| 10 | 1790688876 (t+46s) | 1790688919 (t+89s) | lg-host-01 |
| 11 | 1790688881 (t+51s) | 1790688886 (t+56s) | lg-host-02 |
| 12 | 1790688886 (t+56s) | 1790688919 (t+89s) | lg-host-01 |
| 13 | 1790688891 (t+61s) | 1790688896 (t+66s) | lg-host-02 |
| 14 | 1790688896 (t+66s) | 1790688918 (t+88s) | lg-host-01 |
| 15 | 1790688901 (t+71s) | 1790688906 (t+76s) | lg-host-02 |
| 16 | 1790688906 (t+76s) | 1790688918 (t+88s) | lg-host-01 |
| 17 | 1790688911 (t+81s) | 1790688916 (t+86s) | lg-host-02 |
| 18 | 1790688916 (t+86s) | 1790688922 (t+92s) | lg-host-01 |
| 19 | 1790688921 (t+91s) | 1790688926 (t+96s) | lg-host-02 |
| 20 | 1790688926 (t+96s) | 1790688931 (t+101s) | lg-host-01 |
| 21 | 1790688931 (t+101s) | 1790688936 (t+106s) | lg-host-02 |
| 22 | 1790688937 (t+107s) | 1790688942 (t+112s) | lg-host-01 |
| 23 | 1790688942 (t+112s) | 1790688947 (t+117s) | lg-host-02 |
| 24 | 1790688947 (t+117s) | 1790688951 (t+121s) | lg-host-01 |
| 25 | 1790688952 (t+122s) | 1790688957 (t+127s) | lg-host-02 |
| 26 | 1790688957 (t+127s) | 1790688961 (t+131s) | lg-host-01 |
| 27 | 1790688962 (t+132s) | 1790688967 (t+137s) | lg-host-02 |

**All 27 VUsers running from t+137s. Steady state starts at t+137s.**

**Ramp-down timeline:**
- VUser 1 ramps down at 1790717764 (t+28934s)
- VUser 27 ramps down at 1790717892 (t+29062s)
- Scenario ends at 1790717893 (t+29063s)

**Steady state window: t+137s to t+28934s = 28,797 seconds = ~8 hours**

**LG assignment:**
- lg-host-02: VUsers 1,3,5,7,9,11,13,15,17,19,21,23,25,27 (odd)
- lg-host-01: VUsers 2,4,6,8,10,12,14,16,18,20,22,24,26 (even)

### 2.7 lre_upgrade_263_nft_scripts_1.cfg

INI format. Contains DevWeb rts.yml settings and run configuration.

**Key extracted values:**

```
[DevWeb] rts.yml settings:
  requestTimeout: 120s
  connectTimeout: 120s
  keepAliveTimeout: 60s
  maxPersistentConnectionsPerHost: 6
  maxConnectedHosts: 30
  tlsMaxVersion: tls12
  thinkTime.type: asRecorded
  thinkTime.limit: 3s
  logMode: error
  userArguments: Domain=LRE_ADMIN, Project=DEV_POC, TestName=Demo

[Iterations]
  IterationPace: IterationASAP (run iterations as fast as possible)
  NumOfIterations: 1 (but overridden by scenario duration)

[General]
  ContinueOnError: 0 (stop VUser on error)
  Encoding: UTF8
```

### 2.8 lre_upgrade_263_nft_scripts_1.usp

INI format. Defines action pacing.

**Key values:**
```
RunLogicPaceType: Const
RunLogicPaceConstAfterTime: 60    (60s pacing between iterations)
RunLogicPaceConstTime: 260        (260s total iteration time budget)
```

This means each VUser waits 60 seconds after completing an iteration before starting the next one. With 27 VUsers and ~260s per iteration, throughput is approximately 27/260 = ~0.1 iterations/second.

## PART 3 — RAWDATA.EVE BINARY FORMAT (COMPLETE DECODE)

> **SUPERSEDED:** the transaction layout in this part is wrong — sub-type 762 is a per-request data
> point, not a transaction. The authoritative layout is `SPEC-RawData-eve-REVERSE-ENGINEERED.md`:
> transactions = sub-type `0x00C00FC0 + flags`, per-VUser internal ids named by registration records,
> RT = end − start − wasted − think. Kept for history.

### 3.1 File Overview

- Size: 34,436,952 bytes (34 MB)
- Format: stream of length-prefixed binary records, big-endian
- Total records: 505,070
- Transaction records: 422,225 (sub-type 762)
- Monitoring records: ~82,845 (sub-type 766)

### 3.2 Record Envelope

Every record starts with an 8-byte envelope:

```
Offset  Size  Type       Value
+0      4     uint32BE   recLen   (total record length including this header)
+4      4     uint32BE   type     (always 3, except first record which is type 7)
```

The one type-7 record is the file header at offset 0, length 24. Skip it.
All 505,069 type-3 records follow from offset 0x18 (24).

### 3.3 Type-3 Record Sub-Types

After the 8-byte envelope, type-3 records have a nested field structure.
The sub-type is identified by the uint32BE at payload offset +16 (absolute offset +24):

```
Absolute +8:   uint32BE  outer_field_id   (1 = transaction/monitoring data)
Absolute +12:  uint32BE  outer_field_len
Absolute +16:  uint32BE  inner_field_id
Absolute +20:  uint32BE  inner_field_len
Absolute +24:  uint32BE  SUB_TYPE_ID      ← key discriminator
```

| Sub-type value | Hex | Record len | Meaning |
|----------------|-----|------------|---------|
| 762 | 0x2FA | 64 | Transaction event (MAIN DATA) |
| 766 | 0x2FE | 72 | LG monitoring data point |
| 12586944 | 0xC00100 | 76 | Transaction aggregate |
| 12586945 | 0xC00101 | 84 | Transaction start/end marker |
| 12619721 | 0xC08009 | varies | Other internal event |

### 3.4 Transaction Record Layout (sub-type 762, recLen=64) — THE IMPORTANT ONE

```
Offset  Size  Type       Field                  Notes
+0      4     uint32BE   recLen = 64
+4      4     uint32BE   type = 3
+8      4     uint32BE   outer_field_id = 1
+12     4     uint32BE   outer_field_len = 52
+16     4     uint32BE   inner_field_id = 1
+20     4     uint32BE   inner_field_len = 44
+24     4     uint32BE   sub_type = 762
+28     8     double BE  timestamp              Unix seconds, ms precision (e.g. 1790688848.099)
+36     4     uint32BE   iteration              Iteration number (0-based, 0 to ~113)
+40     4     uint32BE   padding = 0
+44     8     double BE  response_time_ms       Response time in MILLISECONDS (e.g. 2722.0)
+52     4     uint32BE   vuser_id               VUser number 1-27
+56     4     uint32BE   transaction_id         Maps to RawData.map [END_TRANSACTION] (1-14)
+60     4     uint32BE   padding = 0
```

**CRITICAL NOTES:**
- Response time is in **MILLISECONDS** — divide by 1000 for seconds
- Timestamp is IEEE 754 double big-endian — use `buf.readDoubleBE(offset + 28)`
- Response time is IEEE 754 double big-endian — use `buf.readDoubleBE(offset + 44)`
- Negative RT values (-0.005s to -0.006s) occur due to LG clock skew — clamp to 0
- transaction_id maps to `[END_TRANSACTION]` section of RawData.map
- TX_21 (6,740 records) does not appear in RawData.map — it is `Main_Transaction`

### 3.5 Monitoring Record Layout (sub-type 766, recLen=72)

```
Offset  Size  Type       Field
+0      4     uint32BE   recLen = 72
+4      4     uint32BE   type = 3
+8      4     uint32BE   outer_field_id = 16 (0x10)
+12     4     uint32BE   outer_field_len = 60
... nested fields containing:
        string: LG hostname (e.g. "ctrl-host-03.corp.example [192.0.2.10]")
        string: metric name (e.g. "CPU Usage", "Memory Usage", "Disk Usage")
        double BE: current value (percentage for CPU/Memory, GB for Disk)
        double BE: secondary value
```

**Use graph_1.dat instead** — same data, already parsed as text.

### 3.6 Node.js Parser Code Pattern

```javascript
function parseEve(filePath) {
    const buf = fs.readFileSync(filePath);
    const SCENARIO_START = 1790688830; // from res59.lrr Start_time
    const transactions = [];
    let offset = 24; // skip 24-byte type-7 header

    while (offset + 64 <= buf.length) {
        const recLen = buf.readUInt32BE(offset);
        if (recLen < 8 || recLen > 100000) break;

        // Check sub-type at offset+24
        if (recLen === 64 && buf.readUInt32BE(offset + 8) === 1) {
            const subType = buf.readUInt32BE(offset + 24);
            if (subType === 762) {
                const ts        = buf.readDoubleBE(offset + 28);
                const iteration = buf.readUInt32BE(offset + 36);
                const rtMs      = buf.readDoubleBE(offset + 44);
                const vuser     = buf.readUInt32BE(offset + 52);
                const txId      = buf.readUInt32BE(offset + 56);
                transactions.push({
                    ts,
                    t: ts - SCENARIO_START,     // seconds into run
                    iteration,
                    rt: Math.max(0, rtMs),      // clamp negatives
                    vuser,
                    txId
                });
            }
        }
        offset += recLen;
    }
    return transactions;
}
```

### 3.7 Confirmed Statistics from RawData.eve

Total records parsed: **422,225**
Time range: t+11s to t+29063s (484.2 minutes)
VUser IDs present: 1 through 27 (all 27 confirmed)
Iteration range: 0 to 113

**Per-transaction record counts and statistics (RT in seconds, from raw ms data):**

| txId | Transaction Name | Count | Avg RT | Min RT | Max RT | P50 | P90 | P95 | P99 |
|------|------------------|-------|--------|--------|--------|-----|-----|-----|-----|
| 1 | SC01_01_LAUNCH | 171,326 | 0.001s | 0.000s | 0.003s | 0.001s | 0.001s | 0.001s | 0.002s |
| 2 | SC01_02_AUTHENTICATE | 3,123 | 0.001s | 0.000s | 0.003s | 0.002s | 0.003s | 0.003s | 0.003s |
| 3 | SC01_03_HOME | 87,262 | 2.410s | 0.000s | 116.854s | 0.001s | 3.813s | 11.750s | 86.417s |
| 4 | SC01_04_TESTS_AND_SCRIPTS | 30,199 | 10.221s | 0.000s | 116.854s | 3.140s | 19.674s | 49.766s | 116.853s |
| 5 | SC01_05_SELECT_SCENARIO | 38,257 | 5.658s | 0.000s | 116.854s | 0.006s | 14.894s | 19.674s | 101.607s |
| 6 | SC01_06_CLICK_EDIT_TEST | 39,122 | 11.340s | 0.000s | 116.854s | 4.522s | 21.058s | 49.666s | 116.853s |
| 7 | SC01_07_RUNS | 27,347 | 17.853s | 0.000s | 116.854s | 7.561s | 51.737s | 104.026s | 116.854s |
| 11 | SC01_11_TIMESLOTS | 15,406 | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s |
| 12 | SC01_12_PERFORMANCE_TRENDING | 2,684 | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s | 0.001s |
| 14 | SC01_14_LOGOUT | 759 | 0.003s | 0.001s | 0.006s | 0.001s | 0.005s | 0.005s | 0.005s |
| 21 | Main_Transaction (TX_21) | 6,740 | 0.002s | 0.001s | 0.005s | 0.001s | 0.005s | 0.005s | 0.005s |

**Transactions with ZERO records (never reached):**
- txId 8: SC01_08_MONITORS
- txId 9: SC01_09_ANALYSIS_TEMPLATES
- txId 10: SC01_10_HOSTS
- txId 13: SC01_13_SYSTEM_REPORTS

**SLA failure confirmed:** SC01_05_SELECT_SCENARIO — first spike at t+15s (VUser 3, 28.7s RT)

## PART 4 — SUM_DATA .DAT FILE FORMATS

### 4.1 Universal .dat Format

All graph_N.dat files share the same 7-column space-delimited format:

```
<measurementId> <unixTimestamp> <avg> <count> <min> <max> <stddev>
```

- `measurementId` — integer, maps to sum_dat.ini Measurement_N entries
- `unixTimestamp` — unix seconds (integer)
- `avg` — average value in the sampling interval
- `count` — number of samples (-1 means cumulative/special)
- `min` — minimum value
- `max` — maximum value
- `stddev` — standard deviation

**Sampling intervals:**
- graph_0.dat (VUsers): 1-second granularity
- All others: 5-second granularity

### 4.2 sum_dat.ini — Graph Metadata

```ini
[General]
Version=1
GraphsNumber=15
ScenarioStartTime=1790688830
ScenarioDuration=29063

[graph_0]   GraphType=es_tr_runtime_vusers        measurementId 1 = "Running"
[graph_1]   GraphType=es_tr_lg_monitoring         9 measurements (3 LGs × 3 metrics)
[graph_2]   GraphType=es_tr_tprange_pass          14 measurements (one per transaction)
[graph_3]   GraphType=es_tr_total_trpass          1 measurement (total)
[graph_4]   GraphType=es_tr_response_time         14 measurements (one per transaction)
[graph_5]   GraphType=Web_Connections_Per_Second  2 measurements
[graph_6]   GraphType=HOST_RC                     1 measurement (HTTP codes per host)
[graph_7]   GraphType=mic_recv                    1 measurement (bytes received)
[graph_8]   GraphType=mic_sent                    1 measurement (bytes sent)
[graph_9]   GraphType=mic_conn                    1 measurement (TCP connections)
[graph_10]  GraphType=HTTP_RC                     3 measurements (200, 204, 500)
[graph_11]  GraphType=Web_Connections             1 measurement
[graph_12]  GraphType=es_tr_errors_distribution   1 measurement
[graph_13]  GraphType=es_tr_vusers_errors_distribution 1 measurement
[graph_14]  GraphType=es_tr_tprange_fail          1 measurement (SLA fail)
```

### 4.3 graph_0.dat — VUser Count Per Second

measurementId=1 (Running VUsers)

```
1 1790688831 0.000000 1 0.000000 0.000000 0.000000    ← t+1s, 0 VUsers
1 1790688840 0.000000 1 0.000000 0.000000 0.000000    ← t+10s, still 0
...
1 1790717889 1.000000 1 1.000000 1.000000 0.000000    ← near end, 1 VUser left
1 1790717893 0.000000 1 0.000000 0.000000 0.000000    ← t+29063s, 0 VUsers
```

Lines: 28,535 | Granularity: 1 second
The `avg` column = VUser count at that second.

### 4.4 graph_1.dat — LG Monitoring (CPU/Memory/Disk)

9 measurement IDs from sum_dat.ini:

| ID | Metric |
|----|--------|
| 2 | lg-host-01 - CPU Usage (%) |
| 3 | lg-host-01 - Memory Usage (%) |
| 4 | lg-host-01 - Disk Usage (%) |
| 5 | lg-host-02 - CPU Usage (%) |
| 6 | lg-host-02 - Memory Usage (%) |
| 7 | lg-host-02 - Disk Usage (%) |
| 8 | ctrl-host-03 - CPU Usage (%) |
| 9 | ctrl-host-03 - Memory Usage (%) |
| 10 | ctrl-host-03 - Disk Usage (%) |

Sample rows:
```
2 1790688833 40.299531 1 40.299531 40.299531 0.000000    ← lg-host-01 CPU 40.3%
3 1790688833 19.656665 1 19.656665 19.656665 0.000000    ← lg-host-01 Memory 19.7%
4 1790688833  7.736638 1  7.736638  7.736638 0.000000    ← lg-host-01 Disk 7.7%
5 1790688836  0.000000 1  0.000000  0.000000 0.000000    ← lg-host-02 CPU 0%
```

Lines: 52,257 | Granularity: ~3 seconds (irregular)

### 4.5 graph_10.dat — HTTP Status Codes Over Time

3 measurement IDs:

| ID | Metric |
|----|--------|
| 23 | HTTP_200 count |
| 29 | HTTP_204 count |
| 49 | HTTP_500 count |

Sample rows:
```
23 1790688840 10.800000  8 1.000000 18.000000 6.628537    ← 10.8 avg HTTP 200s per 5s bucket
29 1790688845  0.400000  2 1.000000  1.000000 0.000000    ← 0.4 avg HTTP 204s
```

Note: `avg` here is the average count per second within the 5s bucket. Multiply by 5 for total count.
HTTP 500s (id=49) appear only in graph_14.dat area — check for id=49 rows in graph_10.dat.

Lines: 9,819 | Granularity: 5 seconds

### 4.6 graph_14.dat — SLA Failures

measurementId=48 = SC01_05_SELECT_SCENARIO (from sum_dat.ini graph_14 Measurement_0)

```
48 1790688920 3.000000 -1 3.000000 3.000000 0.000000
```

One row only. Timestamp 1790688920 = t+90s. Value 3.0 = 3 SLA violations recorded.
count=-1 indicates this is a cumulative/event record not a time-series average.

### 4.7 graph_12.dat — Transaction Error Distribution

measurementId=46 = "lre_upgrade_263_nft_scripts_1:Main:-1"

```
46 1790688922 1.000000 1 1.000000 1.000000 0.000000
46 1790688922 1.000000 1 1.000000 1.000000 0.000000
46 1790688922 1.000000 1 1.000000 1.000000 0.000000
```

3 rows at t+92s — 3 transaction errors recorded (matches SQLite DB rows 2,3,4).

### 4.8 graph_13.dat — VUser Error Distribution

measurementId=47 = "lre_upgrade_263_nft_scripts_1:Main:-1"

```
47 1790688922 1.000000 1 1.000000 1.000000 0.000000    ← VUser error at t+92s
47 1790688922 2.000000 1 2.000000 2.000000 0.000000    ← VUser error at t+92s
47 1790688922 3.000000 1 3.000000 3.000000 0.000000    ← VUser error at t+92s
47 1790717777 2.000000 1 2.000000 2.000000 0.000000    ← VUser error near end
47 1790717807 1.000000 1 1.000000 1.000000 0.000000
47 1790717817 0.000000 1 0.000000 0.000000 0.000000
```

### 4.9 graph_4.dat — Response Times (Summarised — for reference only)

measurementId maps from sum_dat.ini graph_4:

| ID | Transaction |
|----|-------------|
| 13 | SC01_02_AUTHENTICATE |
| 15 | SC01_03_HOME |
| 17 | SC01_01_LAUNCH |
| 26 | SC01_04_TESTS_AND_SCRIPTS |
| 28 | SC01_05_SELECT_SCENARIO |
| 31 | SC01_06_CLICK_EDIT_TEST |
| 33 | SC01_08_MONITORS |
| 35 | SC01_07_RUNS |
| 37 | SC01_12_PERFORMANCE_TRENDING |
| 39 | SC01_10_HOSTS |
| 41 | SC01_11_TIMESLOTS |
| 43 | SC01_09_ANALYSIS_TEMPLATES |
| 45 | SC01_13_SYSTEM_REPORTS |
| 52 | SC01_14_LOGOUT |

Sample: `13 1790688840 0.138000 2 0.127000 0.149000 0.011000`
= SC01_02_AUTHENTICATE at t+10s: avg=0.138s, 2 samples, min=0.127s, max=0.149s, stddev=0.011s

**We do NOT use this file** — we compute better stats from RawData.eve directly.

## PART 5 — SCENARIO FACTS SUMMARY

| Property | Value |
|----------|-------|
| Session name | LRE263_DEV_Soak_100pct_27VU_8hr |
| Company/Project | DEV_POC |
| Run date | 29-September-2026 14:33:05 UTC |
| Scenario start (unix) | 1790688830 |
| Scenario end (unix) | 1790717893 |
| Total duration | 29,063 seconds = 484.4 minutes |
| Peak VUsers | 27 |
| Ramp-up | 1 VUser every 5s (config) / actual ~5s measured |
| Ramp-up complete | t+137s (all 27 VUsers running) |
| Steady state | t+137s to t+28934s = 28,797s = ~8 hours |
| Ramp-down start | t+28934s |
| Protocol | DevWeb (JavaScript) |
| Script name | LRE_Upgrade_263_NFT_Scripts_1 |
| Load Generators | lg-host-02 (odd VUsers), lg-host-01 (even VUsers) |
| Monitoring LG | ctrl-host-03 (3rd LG, monitoring only) |
| Think time | asRecorded, max 3s |
| Iteration pacing | 60s after iteration completes |
| Request timeout | 120s |
| SLA transactions | 15 (all 14 named + Main_Transaction) |
| SLA failures | 1 (SC01_05_SELECT_SCENARIO) |
| HTTP errors | HTTP 500 at t+92s on VUsers 2,3,4 |
| Total tx records | 422,225 |
| Transactions with data | 10 of 14 (4 never reached) |

## PART 6 — ANALYTICS & DATA SCIENCE PLAN

### 6.1 Steady-State Isolation

```javascript
// Exclude ramp-up and ramp-down periods
const STEADY_START = 137;     // t+137s — all 27 VUsers running
const STEADY_END   = 28934;   // t+28934s — first VUser starts ramping down
const steadyRecords = txRecords.filter(r => r.t >= STEADY_START && r.t <= STEADY_END);
```

### 6.2 Per-Transaction Statistics

For each transaction ID, compute from steady-state records:

```javascript
function computeStats(rts) {
    // rts = array of response times in ms (already clamped >= 0)
    const sorted = [...rts].sort((a, b) => a - b);
    const n = sorted.length;
    const sum = rts.reduce((a, b) => a + b, 0);
    const avg = sum / n;
    const variance = rts.reduce((a, b) => a + (b - avg) ** 2, 0) / n;
    return {
        count:  n,
        avg:    avg / 1000,
        min:    sorted[0] / 1000,
        max:    sorted[n - 1] / 1000,
        p50:    sorted[Math.floor(n * 0.50)] / 1000,
        p75:    sorted[Math.floor(n * 0.75)] / 1000,
        p90:    sorted[Math.floor(n * 0.90)] / 1000,
        p95:    sorted[Math.floor(n * 0.95)] / 1000,
        p99:    sorted[Math.floor(n * 0.99)] / 1000,
        stddev: Math.sqrt(variance) / 1000,
        cv:     Math.sqrt(variance) / avg   // coefficient of variation
    };
}
```

### 6.3 Time-Bucketed Trend (5-minute buckets)

```javascript
function bucketByTime(records, bucketSizeSeconds = 300) {
    const buckets = {};
    for (const r of records) {
        const bucket = Math.floor(r.t / bucketSizeSeconds) * bucketSizeSeconds;
        if (!buckets[bucket]) buckets[bucket] = [];
        buckets[bucket].push(r.rt);
    }
    return Object.entries(buckets).map(([t, rts]) => ({
        t: Number(t),
        avg: rts.reduce((a, b) => a + b, 0) / rts.length / 1000,
        p90: [...rts].sort((a,b)=>a-b)[Math.floor(rts.length*0.9)] / 1000,
        count: rts.length
    })).sort((a, b) => a.t - b.t);
}
```

### 6.4 Z-Score Spike Detection

```javascript
function detectSpikes(buckets, zThreshold = 2.5) {
    const avgs = buckets.map(b => b.avg);
    const mean = avgs.reduce((a, b) => a + b, 0) / avgs.length;
    const stddev = Math.sqrt(avgs.reduce((a, b) => a + (b - mean) ** 2, 0) / avgs.length);
    return buckets
        .map(b => ({ ...b, z: (b.avg - mean) / stddev }))
        .filter(b => b.z > zThreshold);
}
```

### 6.5 Linear Regression (Degradation Detection)

```javascript
function linearRegression(buckets) {
    // Returns slope in ms/hour — positive = degrading
    const n = buckets.length;
    const xs = buckets.map(b => b.t / 3600); // hours
    const ys = buckets.map(b => b.avg * 1000); // ms
    const xMean = xs.reduce((a, b) => a + b, 0) / n;
    const yMean = ys.reduce((a, b) => a + b, 0) / n;
    const slope = xs.reduce((a, x, i) => a + (x - xMean) * (ys[i] - yMean), 0) /
                  xs.reduce((a, x) => a + (x - xMean) ** 2, 0);
    const intercept = yMean - slope * xMean;
    const r2 = 1 - (ys.reduce((a, y, i) => a + (y - (slope * xs[i] + intercept)) ** 2, 0) /
                    ys.reduce((a, y) => a + (y - yMean) ** 2, 0));
    return { slopePerHour: slope, r2, isDegrading: slope > 5 && r2 > 0.3 };
}
```

### 6.6 Throughput (Transactions Per Second)

```javascript
function computeThroughput(records, bucketSizeSeconds = 60) {
    const buckets = {};
    for (const r of records) {
        const bucket = Math.floor(r.t / bucketSizeSeconds) * bucketSizeSeconds;
        buckets[bucket] = (buckets[bucket] || 0) + 1;
    }
    return Object.entries(buckets).map(([t, count]) => ({
        t: Number(t),
        tps: count / bucketSizeSeconds
    })).sort((a, b) => a.t - b.t);
}
```

### 6.7 Per-VUser Analysis

```javascript
function perVUserStats(records) {
    const byVUser = {};
    for (const r of records) {
        if (!byVUser[r.vuser]) byVUser[r.vuser] = { count: 0, totalRt: 0, errors: 0 };
        byVUser[r.vuser].count++;
        byVUser[r.vuser].totalRt += r.rt;
    }
    return byVUser;
}
```

### 6.8 Percentile Distribution (Histogram)

```javascript
function histogram(rts, buckets = 20) {
    const max = Math.max(...rts);
    const bucketSize = max / buckets;
    const hist = new Array(buckets).fill(0);
    for (const rt of rts) {
        const idx = Math.min(Math.floor(rt / bucketSize), buckets - 1);
        hist[idx]++;
    }
    return hist.map((count, i) => ({
        from: i * bucketSize / 1000,
        to: (i + 1) * bucketSize / 1000,
        count
    }));
}
```

## PART 7 — ARCHITECTURE & FILE PLAN

### 7.1 New Files (zero changes to existing code)

```
src/
├── parsers/
│   └── lreResultsParser.js       NEW
├── analyzers/
│   └── lreResultsAnalyser.js     NEW
└── generators/
    └── lreReportGenerator.js     NEW
```

### 7.2 lreResultsParser.js — Public API

```javascript
class LreResultsParser {
    async parse(folderPath) {
        // Returns complete data model:
        return {
            meta: {
                sessionName, companyName, runDate, durationMinutes,
                startTime, stopTime, peakVUsers, rampRate,
                protocol, scriptName, lreVersion,
                steadyStateStart, steadyStateEnd,
                loadGenerators: [{ name, vuserIds }]
            },
            transactions: [
                { ts, t, iteration, rt, vuser, txId }  // 422,225 records
            ],
            txNameMap: { 1: 'SC01_01_LAUNCH', ... },   // from RawData.map
            slaTransactions: Set<string>,              // from SLAConfiguration.xml
            errors: [
                { time, errorCode, message, vuser, iteration, injector }
            ],
            vuserLifecycle: [
                { vuser, initTime, startTime, stopTime, lg }
            ],
            lgMonitoring: [
                { t, lg, metric, value }                       // from graph_1.dat
            ],
            httpCodes: [
                { t, code, count }                             // from graph_10.dat
            ],
            vuserCounts: [
                { t, count }                                   // from graph_0.dat
            ]
        };
    }
}
```

### 7.3 lreResultsAnalyser.js — Public API

```javascript
class LreResultsAnalyser {
    analyse(parsedData) {
        return {
            summary: {
                totalTransactions, totalVUsers, durationMinutes,
                overallStatus,   // 'PASS' | 'WARN' | 'FAIL'
                slaBreaches: []
            },
            perTransaction: {
                'SC01_01_LAUNCH': {
                    stats: { count, avg, min, max, p50, p75, p90, p95, p99, stddev, cv },
                    steadyStats: { ... },   // steady-state only
                    trend: { slopePerHour, r2, isDegrading },
                    spikes: [{ t, avg, z, bucketStart, bucketEnd }],
                    throughput: [{ t, tps }],
                    timeSeries: [{ t, avg, p90, count }],  // 5-min buckets
                    histogram: [{ from, to, count }],
                    slaStatus: 'PASS' | 'FAIL' | 'NO_DATA'
                }
            },
            lgHealth: {
                'lg-host-02': {
                    peakCpu, avgCpu, peakMemory, avgMemory,
                    cpuTimeSeries: [{ t, value }],
                    memTimeSeries: [{ t, value }]
                }
            },
            httpErrors: {
                total500s, errorRate,
                timeSeries: [{ t, http200, http204, http500 }]
            },
            vuserRamp: [{ t, count }],
            errorLog: [{ time, message, vuser }]
        };
    }
}
```

### 7.4 lreReportGenerator.js — Public API

```javascript
class LreReportGenerator {
    generate(analysedData, options = {}) {
        // Returns: { html: string, xlsx: Buffer, summary: object }
        // html = self-contained HTML with embedded Chart.js
        // xlsx = Excel workbook with all data tables
    }
}
```

### 7.5 CLI Command

```bash
node src/cli.js analyse-results -i RawResults_59/ -o report.html
node src/cli.js analyse-results -i results.zip -o report.html --format xlsx
```

### 7.6 Web UI — New Tab

- Tab label: "Results Analyser"
- Upload: ZIP file containing the raw results folder
- Server extracts ZIP to memory (using `adm-zip` or `unzipper`)
- Runs parser + analyser + generator in-memory
- Returns: downloadable HTML report + optional XLSX

### 7.7 Web Server Endpoints

```
POST /analyse-results     multipart ZIP upload → returns download token
GET  /download/:token     one-time download (reuses existing memoryFsInterceptor)
```

## PART 8 — REPORT SECTIONS (UI DESIGN)

### 8.1 Executive Summary Card
- Test name, date, duration, peak VUsers, protocol
- Overall PASS / WARN / FAIL banner (green/amber/red)
- Key numbers: total transactions, error count, SLA breaches
- Root cause callout if errors found in SQLite DB

### 8.2 Transaction Summary Table
Columns: Transaction | Count | Avg | P90 | P95 | P99 | Max | Trend | SLA
- Colour-coded rows: green (fast), amber (moderate), red (slow/failed)
- Trend arrow: ↑ degrading, → stable, ↓ improving
- SLA badge: PASS / FAIL / NO DATA

### 8.3 Response Time Charts (per transaction)
- Line chart: avg + P90 over time (5-min buckets)
- Spike markers: red dots where z-score > 2.5
- Steady-state shading: grey overlay on ramp-up/ramp-down periods
- Hover tooltip: exact time, avg, P90, sample count

### 8.4 VUser Ramp Profile
- Area chart: VUser count over time
- Annotations: "Ramp-up complete", "Ramp-down starts"
- Source: graph_0.dat

### 8.5 Throughput Chart
- Line chart: transactions per second over time
- One line per transaction (or top 5 by volume)

### 8.6 HTTP Error Timeline
- Stacked area: HTTP 200 / 204 / 500 over time
- Error rate % line overlay
- Source: graph_10.dat

### 8.7 Load Generator Health
- Multi-line chart: CPU % for each LG over time
- Multi-line chart: Memory % for each LG over time
- Threshold lines at 80% CPU, 85% Memory
- Source: graph_1.dat

### 8.8 Spike & Anomaly Report
- Table: timestamp | transaction | avg RT | normal avg | z-score | affected VUsers
- Correlation note: "coincides with LG CPU peak" if within 60s window

### 8.9 Error Log
- Table from SQLite DB: time | VUser | error code | message
- Formatted timestamps, not unix integers

### 8.10 Per-VUser Heatmap (optional advanced)
- Grid: VUser (rows) × time buckets (columns)
- Cell colour = avg RT for that VUser in that time window
- Reveals if specific VUsers or LGs are slower

## PART 9 — DOWNLOADABLE REPORT FORMATS

### 9.1 HTML Report (primary)
- Self-contained: all CSS + Chart.js + data embedded inline
- No external dependencies — works offline
- Print-friendly CSS for PDF via browser print
- Dark/light theme toggle

### 9.2 Excel (.xlsx) via exceljs
Sheets:
1. **Summary** — executive summary table
2. **Transaction Stats** — full stats table (count, avg, min, max, p50, p75, p90, p95, p99, stddev)
3. **Response Time Series** — per-transaction 5-min bucket data
4. **LG Monitoring** — CPU/Memory time series per LG
5. **HTTP Codes** — 200/204/500 counts over time
6. **VUser Ramp** — VUser count per second
7. **Error Log** — SQLite error records
8. **Raw Stats** — all 422,225 records (optional, large sheet)

### 9.3 PDF
- Browser print of HTML report (no server-side Puppeteer needed for MVP)
- "Download PDF" button triggers `window.print()` with print CSS

## PART 10 — DEPENDENCIES

### New runtime dependency (1 only):
```json
"better-sqlite3": "^9.x"
```

### Already available in project:
- `exceljs` — Excel generation (already used for JMX workload model)
- `archiver` — ZIP streaming (already used for web downloads)
- `adm-zip` or `unzipper` — ZIP extraction for uploaded results (need to add)
- `express`, `multer` — already in place

### Embedded in HTML output (no server dep):
- Chart.js 4.x via CDN: `https://cdn.jsdelivr.net/npm/chart.js`

### Optional (for offline HTML):
- Bundle Chart.js minified inline (~200KB) for fully offline reports

## PART 11 — ISOLATION GUARANTEE

Zero changes to any existing file. New files only:

| Existing Area | Impact |
|---------------|--------|
| Postman/Bruno → DevWeb | None |
| Postman/Bruno → VuGen | None |
| JMX → DevWeb/VuGen | None |
| Web UI existing tabs | None — new tab only |
| Recorder | None |
| Script Studio | None |
| All existing tests | None |

## PART 12 — KNOWN EDGE CASES & GOTCHAS

1. **Negative response times** — clock skew between LGs produces -0.005s values. Always clamp: `Math.max(0, rt)`.

2. **Missing transactions** — txIds 8,9,10,13 have zero records. Show "No Data" not zero.

3. **TX_21** — not in RawData.map. Map it to "Main_Transaction" manually.

4. **graph_0.dat VUser counts** — the `avg` column shows 0.0 even when VUsers are running (the count is in the `min`/`max` columns for some rows). Use the `avg` column — it correctly shows 0 during ramp-up and 1-27 during run.

5. **graph_10.dat HTTP counts** — `avg` is average per second within the 5s bucket. Multiply by `count` (number of sub-samples) to get total, or multiply avg by 5 for approximate total per bucket.

6. **SLA thresholds** — not stored in the results folder. SLAConfiguration.xml only lists which transactions are in scope, not the threshold values. We must either: (a) let user set thresholds in UI, or (b) flag based on our own computed percentiles.

7. **graph_14.dat** — only 1 row, count=-1. This is an event record not a time-series. The value 3.0 means 3 SLA violations were recorded by LRE.

8. **_t_rep.eve event type 8** — "VUser running confirmed" has empty vuserNum field (just spaces). Parse defensively.

9. **res59.lrr filename** — the `59` is the run number. The filename will differ per run. Parse by looking for `*.lrr` in the folder.

10. **ZIP upload** — the user zips the entire `RawResults_59/` folder. The ZIP may contain the folder as a top-level directory or files directly. Handle both cases when extracting.

11. **Large file memory** — RawData.eve is 34MB. Reading into Buffer is fine for Node.js. The 422,225 transaction objects will use ~50MB RAM. This is acceptable.

12. **sum_dat.ini measurement IDs** — the IDs in sum_dat.ini (e.g. `graph_4 Measurement_0=SC01_01_LAUNCH,17`) are the measurementIds used in the .dat files. The number after the comma (17) is the measurementId for that graph's data. These are DIFFERENT from the transaction IDs in RawData.map.

*End of Specification — All files decoded, all formats documented, ready to build.*

## PART 13 — GAP FIXES & UNAMBIGUOUS RULES

> These sections resolve the 5 identified ambiguities. Any AI building from this spec MUST follow these rules exactly.

### 13.1 GAP 1 — res*.lrr Filename Resolution (FIXED)

The `.lrr` filename changes per run (e.g. `res59.lrr`, `res60.lrr`, `res123.lrr`).

**Rule — always use this exact algorithm:**

```javascript
function findLrrFile(folderPath) {
    const files = fs.readdirSync(folderPath);
    const lrr = files.filter(f => f.endsWith('.lrr'));
    if (lrr.length === 0) throw new Error('No .lrr file found in results folder');
    if (lrr.length === 1) return path.join(folderPath, lrr[0]);
    // Multiple .lrr files — pick the one matching the folder name
    const folderName = path.basename(folderPath).toLowerCase();
    const match = lrr.find(f => f.toLowerCase().includes(folderName));
    return path.join(folderPath, match || lrr[0]);
}
```

**Same rule applies to these dynamic filenames:**

| File pattern | Rule |
|--------------|------|
| `res*.lrr` | Use algorithm above |
| `*.cfg` | Take first `.cfg` file that is NOT `.cfg.bak` |
| `*.usp` | Take first `.usp` file |
| `RawData.eve` | Always this exact name — never changes |
| `RawData.map` | Always this exact name — never changes |
| `_t_rep.eve` | Always this exact name — never changes |
| `RunInfo.ini` | Always this exact name — never changes |
| `SLAConfiguration.xml` | Always this exact name — never changes |
| `SqliteDb.db` | Always this exact name — never changes |
| `sum_data/` | Always this exact folder name — never changes |
| `sum_data/sum_dat.ini` | Always this exact name — never changes |
| `sum_data/graph_N.dat` | N is 0-14, always present |

### 13.2 GAP 2 — ZIP Extraction Path Handling (FIXED)

The user uploads a ZIP. The ZIP may be structured in two ways:

**Case A** — folder is top-level entry (most common, created by right-click → Send to ZIP):
```
RawResults_59.zip
└── RawResults_59/
    ├── RawData.eve
    ├── RunInfo.ini
    └── sum_data/
        └── graph_0.dat
```

**Case B** — files are at ZIP root (created by selecting all files → ZIP):
```
RawResults_59.zip
├── RawData.eve
├── RunInfo.ini
└── sum_data/
    └── graph_0.dat
```

**Rule — use this exact detection and normalisation algorithm:**

```javascript
const AdmZip = require('adm-zip');

function extractResultsZip(zipBuffer) {
    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries().map(e => e.entryName);

    // Detect if RawData.eve is at root or inside a subfolder
    const rawDataEntry = entries.find(e => e.endsWith('RawData.eve'));
    if (!rawDataEntry) throw new Error('RawData.eve not found in ZIP');

    // rootPrefix = '' for Case B, 'RawResults_59/' for Case A
    const rootPrefix = rawDataEntry.replace('RawData.eve', '');

    // Build in-memory file map: { 'RawData.eve': Buffer, 'sum_data/graph_0.dat': Buffer, ... }
    const files = {};
    zip.getEntries().forEach(entry => {
        if (entry.isDirectory) return;
        const relativePath = entry.entryName.replace(rootPrefix, '');
        files[relativePath] = entry.getData(); // Buffer
    });

    return files; // keys are always relative to results root
}
```

**Then all parsers receive the `files` map and read like:**
```javascript
const runInfoBuf = files['RunInfo.ini'];
const rawDataBuf = files['RawData.eve'];
const graph1Buf  = files['sum_data/graph_1.dat'];
```

**No disk writes. Everything stays in memory.**

### 13.3 GAP 3 — VUser Count Source (FIXED)

**graph_0.dat is unreliable for VUser counts.** The `avg` column shows the running VUser count but only updates when a VUser state changes — it does NOT emit a row every second during steady state. Many seconds are missing.

**Rule — derive VUser count from `_t_rep.eve` event types, NOT graph_0.dat:**

```javascript
function buildVuserTimeline(trepContent, scenarioStart) {
    // Returns array of { t, count } — one entry per state change
    const lines = trepContent.split(/\r?\n/).filter(l => l.startsWith('28 '));
    const timeline = [{ t: 0, count: 0 }];
    let count = 0;

    for (const line of lines) {
        const parts = line.split(' ');
        const eventType = parseInt(parts[1]);
        // Event type 2 = VUser confirmed running (use this for ramp-up)
        // Event type 1 = VUser ramping down
        if (eventType === 2) {
            const ts = parseInt(parts[4]);
            count++;
            timeline.push({ t: ts - scenarioStart, count });
        } else if (eventType === 1) {
            const ts = parseInt(parts[4]);
            count--;
            timeline.push({ t: ts - scenarioStart, count: Math.max(0, count) });
        }
    }
    return timeline.sort((a, b) => a.t - b.t);
}
```

**Use graph_0.dat ONLY for the VUser ramp chart** (it has 1-second granularity which looks smooth on a chart). For all analytical purposes (steady-state detection, phase boundaries), use `_t_rep.eve`.

**Steady-state boundaries — always derive from _t_rep.eve:**
```javascript
// steadyStateStart = timestamp when last VUser (27th) fires event type 2
// steadyStateEnd   = timestamp when first VUser fires event type 1 (ramp-down)
```

### 13.4 GAP 4 — Report HTML Structure (FIXED)

**Technology choices — non-negotiable:**
- Chart.js 4.4.x via CDN: `https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js`
- No CSS framework — pure CSS only (keeps file self-contained)
- Fonts: system font stack — `-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`
- Monospace: `'Consolas', 'Monaco', monospace`
- All data embedded as a single `const REPORT_DATA = {...}` JSON block in a `<script>` tag
- All Chart.js instances initialised from `REPORT_DATA` — no inline data in chart calls

**Colour scheme:**

```css
/* Light theme (default) */
--bg:          #f8f9fa;
--surface:     #ffffff;
--border:      #e2e8f0;
--text:        #1a202c;
--text-muted:  #718096;
--pass:        #38a169;   /* green */
--warn:        #d69e2e;   /* amber */
--fail:        #e53e3e;   /* red */
--nodata:      #a0aec0;   /* grey */
--accent:      #3182ce;   /* blue */
--spike:       #e53e3e;   /* red dot on charts */
--rampshade:   rgba(0,0,0,0.04);

/* Dark theme (toggled by class on <body>) */
--bg:          #0f1117;
--surface:     #1a1d27;
--border:      #2d3748;
--text:        #e2e8f0;
--text-muted:  #718096;
```

**HTML skeleton:**

```html
<!DOCTYPE html>
<html lang="en" data-theme="light">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>LRE Results — {SESSION_NAME}</title>
  <style>/* ALL CSS INLINE HERE */</style>
</head>
<body>
  <!-- HEADER BAR -->
  <header>
    <div class="header-title">LRE Results Analyser</div>
    <div class="header-meta">{SESSION_NAME} · {RUN_DATE} · {DURATION}</div>
    <button id="themeToggle">☀️ / 🌙</button>
    <div class="download-buttons">
      <button onclick="downloadXlsx()">⬇ Excel</button>
      <button onclick="window.print()">⬇ PDF</button>
    </div>
  </header>

  <!-- SECTION 1: EXECUTIVE SUMMARY -->
  <section id="summary">...</section>

  <!-- SECTION 2: TRANSACTION SUMMARY TABLE -->
  <section id="tx-table">...</section>

  <!-- SECTION 3: RESPONSE TIME CHARTS -->
  <section id="rt-charts">
    <!-- One <canvas> per transaction, rendered by Chart.js -->
  </section>

  <!-- SECTION 4: VUSER RAMP -->
  <section id="vuser-ramp"><canvas id="chart-vuser"></canvas></section>

  <!-- SECTION 5: THROUGHPUT -->
  <section id="throughput"><canvas id="chart-tps"></canvas></section>

  <!-- SECTION 6: HTTP ERRORS -->
  <section id="http-errors"><canvas id="chart-http"></canvas></section>

  <!-- SECTION 7: LG HEALTH -->
  <section id="lg-health">
    <!-- One chart per LG: CPU + Memory on same chart (dual Y-axis) -->
  </section>

  <!-- SECTION 8: SPIKE REPORT -->
  <section id="spikes"><!-- HTML table --></section>

  <!-- SECTION 9: ERROR LOG -->
  <section id="error-log"><!-- HTML table from SQLite --></section>

  <!-- SECTION 10: PER-VUSER HEATMAP -->
  <section id="vuser-heatmap"><!-- CSS grid, no Chart.js --></section>

  <!-- ALL DATA + CHART.JS + LOGIC -->
  <script>const REPORT_DATA = {/* JSON */};</script>
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js"></script>
  <script>/* ALL CHART INIT + XLSX EXPORT LOGIC */</script>
</body>
</html>
```

**Chart types per section:**

| Section | Chart type | X-axis | Y-axis | Notes |
|---------|------------|--------|--------|-------|
| Response time per TX | Line | Time (minutes) | RT (seconds) | Two datasets: avg + P90. Red dot annotations for spikes. Grey shading for ramp phases. |
| VUser ramp | Area (filled line) | Time (minutes) | VUser count | Annotation lines: "Steady start", "Ramp-down" |
| Throughput | Line | Time (minutes) | TPS | One line per transaction (top 5 by volume) |
| HTTP codes | Stacked bar | Time (minutes) | Count | Three datasets: 200 (green), 204 (blue), 500 (red) |
| LG CPU | Line | Time (minutes) | % | One line per LG. Dashed red threshold at 80% |
| LG Memory | Line | Time (minutes) | % | One line per LG. Dashed red threshold at 85% |
| VUser heatmap | CSS grid | Time buckets (cols) | VUser ID (rows) | Cell background = colour scale from green→red based on avg RT |

**Chart.js global defaults (set once):**
```javascript
Chart.defaults.font.family = "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
Chart.defaults.font.size = 12;
Chart.defaults.color = getComputedStyle(document.body).getPropertyValue('--text-muted');
Chart.defaults.plugins.legend.position = 'top';
Chart.defaults.plugins.tooltip.mode = 'index';
Chart.defaults.plugins.tooltip.intersect = false;
```

### 13.5 GAP 5 — Excel Sheet Structure (FIXED)

Use `exceljs` (already in project). All sheets follow these formatting rules:

**Global rules:**
- Header row: bold, background `#2B5797` (dark blue), font colour white, height 20px
- Freeze top row on all sheets: `worksheet.views = [{ state: 'frozen', ySplit: 1 }]`
- Auto-filter on all sheets: `worksheet.autoFilter = { from: 'A1', to: '{lastCol}1' }`
- Number format for seconds: `'0.000"s"'`
- Number format for percentages: `'0.0"%"'`
- Number format for counts: `'#,##0'`
- Column widths: set explicitly (do not use auto-fit — it's slow)

**Sheet 1 — Summary**

| Column | Header | Width | Format |
|--------|--------|-------|--------|
| A | Property | 35 | text |
| B | Value | 40 | text |

Rows: Session Name, Run Date, Duration, Peak VUsers, Protocol, Script Name,
Total Transactions, Steady State Duration, SLA Breaches, Overall Status

**Sheet 2 — Transaction Statistics**

| Column | Header | Width | Format |
|--------|--------|-------|--------|
| A | Transaction | 35 | text |
| B | Count | 12 | #,##0 |
| C | Avg (s) | 12 | 0.000 |
| D | Min (s) | 12 | 0.000 |
| E | Max (s) | 12 | 0.000 |
| F | P50 (s) | 12 | 0.000 |
| G | P75 (s) | 12 | 0.000 |
| H | P90 (s) | 12 | 0.000 |
| I | P95 (s) | 12 | 0.000 |
| J | P99 (s) | 12 | 0.000 |
| K | Std Dev | 12 | 0.000 |
| L | CV | 10 | 0.00 |
| M | Trend (ms/hr) | 15 | 0.00 |
| N | SLA Status | 12 | text |

Conditional formatting on column N: "FAIL" → red fill, "PASS" → green fill, "NO DATA" → grey fill.
Conditional formatting on column C (Avg): colour scale green→amber→red based on value.

**Sheet 3 — Response Time Series**

| Column | Header | Width | Format |
|--------|--------|-------|--------|
| A | Transaction | 35 | text |
| B | Time (min) | 12 | 0.0 |
| C | Avg (s) | 12 | 0.000 |
| D | P90 (s) | 12 | 0.000 |
| E | P95 (s) | 12 | 0.000 |
| F | Count | 10 | #,##0 |
| G | Is Spike | 10 | text |

One row per transaction per 5-minute bucket. "Is Spike" = "YES" if z-score > 2.5, else blank.

**Sheet 4 — LG Monitoring**

| Column | Header | Width | Format |
|--------|--------|-------|--------|
| A | Load Generator | 30 | text |
| B | Metric | 20 | text |
| C | Time (min) | 12 | 0.0 |
| D | Value | 12 | 0.0 |

**Sheet 5 — HTTP Codes**

| Column | Header | Width | Format |
|--------|--------|-------|--------|
| A | Time (min) | 12 | 0.0 |
| B | HTTP 200 | 12 | #,##0 |
| C | HTTP 204 | 12 | #,##0 |
| D | HTTP 500 | 12 | #,##0 |
| E | Error Rate % | 14 | 0.00% |

**Sheet 6 — VUser Ramp**

| Column | Header | Width | Format |
|--------|--------|-------|--------|
| A | Time (min) | 12 | 0.0 |
| B | VUser Count | 14 | #,##0 |
| C | Phase | 15 | text |

Phase column values: "Ramp-Up", "Steady State", "Ramp-Down"

**Sheet 7 — Error Log**

| Column | Header | Width | Format |
|--------|--------|-------|--------|
| A | Timestamp | 25 | text |
| B | VUser | 10 | #,##0 |
| C | Error Code | 14 | text |
| D | Injector | 30 | text |
| E | Message | 80 | text |

**Sheet 8 — Spike Report**

| Column | Header | Width | Format |
|--------|--------|-------|--------|
| A | Transaction | 35 | text |
| B | Time (min) | 12 | 0.0 |
| C | Avg RT (s) | 14 | 0.000 |
| D | Normal Avg (s) | 16 | 0.000 |
| E | Z-Score | 12 | 0.00 |
| F | Affected VUsers | 20 | text |
| G | LG CPU at time | 16 | 0.0% |

## PART 14 — GENERIC FILE HANDLING (works for ANY run, not just Run 59)

Since every LRE raw results ZIP has the same structure, the parser must be fully generic — no hardcoded values from Run 59.

### 14.1 Values That MUST be read dynamically (never hardcode)

| Value | Source | How to read |
|-------|--------|-------------|
| Scenario start time | `res*.lrr` → `Start_time` | parseInt |
| Scenario end time | `res*.lrr` → `Stop_time` | parseInt |
| Peak VUsers | `res*.lrr` → `Global Schedule` → parse `ST{N}` | regex `/ST(\d+)/` |
| Ramp rate | `res*.lrr` → `Global Schedule` → parse `1E{N}` | regex `/1E(\d+)/` → N seconds |
| Steady run duration | `res*.lrr` → `Global Schedule` → parse `R{N}` | regex `/R(\d+)/` → N seconds |
| Transaction names | `RawData.map` → `[END_TRANSACTION]` section | parse all `N="name"` pairs |
| SLA transaction list | `SLAConfiguration.xml` → `<Tx>` nodes | XML parse |
| LG names | `sum_data/sum_dat.ini` → `[graph_1]` Measurement entries | parse before `-` in name |
| Measurement IDs | `sum_data/sum_dat.ini` → each graph's `Measurement_N` | parse number after comma |
| Steady state start | `_t_rep.eve` → last event type 2 timestamp | parse |
| Steady state end | `_t_rep.eve` → first event type 1 timestamp | parse |

### 14.2 Values That Are Always Constant (safe to hardcode)

| Value | Constant |
|-------|----------|
| RawData.eve sub-type for transactions | 762 |
| RawData.eve sub-type for monitoring | 766 |
| Transaction record length | 64 bytes |
| Timestamp field offset | +28 (double BE) |
| Response time field offset | +44 (double BE) |
| VUser ID field offset | +52 (uint32BE) |
| Transaction ID field offset | +56 (uint32BE) |
| Iteration field offset | +36 (uint32BE) |
| File header size to skip | 24 bytes |
| TX_21 name | "Main_Transaction" |
| Response time unit | milliseconds (divide by 1000 for seconds) |
| .dat file column order | measurementId, timestamp, avg, count, min, max, stddev |
| graph_0.dat measurement ID | 1 (Running VUsers) |

### 14.3 Transaction ID to Name Resolution (generic)

```javascript
function buildTxNameMap(rawDataMapContent) {
    const map = {};
    let inTxSection = false;
    for (const line of rawDataMapContent.split(/\r?\n/)) {
        if (line.trim() === '[END_TRANSACTION]') { inTxSection = true; continue; }
        if (line.startsWith('[') && line !== '[END_TRANSACTION]') { inTxSection = false; continue; }
        if (inTxSection) {
            const m = line.match(/^(\d+)="(.+)"/);
            if (m) map[parseInt(m[1])] = m[2];
        }
    }
    // TX_21 is always Main_Transaction — not in map file
    map[21] = 'Main_Transaction';
    return map;
}
```

### 14.4 Measurement ID Resolution from sum_dat.ini (generic)

```javascript
function buildMeasurementMap(sumDatIniContent) {
    // Returns: { graphN: { measurementId: metricName, ... }, ... }
    const result = {};
    let currentGraph = null;
    for (const line of sumDatIniContent.split(/\r?\n/)) {
        const graphMatch = line.match(/^\[graph_(\d+)\]/);
        if (graphMatch) { currentGraph = `graph_${graphMatch[1]}`; result[currentGraph] = {}; continue; }
        if (!currentGraph) continue;
        const mMatch = line.match(/^Measurement_\d+=(.+),(\d+)/);
        if (mMatch) result[currentGraph][parseInt(mMatch[2])] = mMatch[1].trim();
    }
    return result;
}
```

### 14.5 Global Schedule Parser (generic)

```javascript
function parseGlobalSchedule(scheduleStr) {
    // e.g. "ST27_1E5;R28800;SP27_1E5;"
    const vuserMatch = scheduleStr.match(/ST(\d+)/);
    const rampMatch  = scheduleStr.match(/1E(\d+)/);
    const runMatch   = scheduleStr.match(/R(\d+)/);
    return {
        peakVUsers:       vuserMatch ? parseInt(vuserMatch[1]) : null,
        rampIntervalSecs: rampMatch  ? parseInt(rampMatch[1])  : null,
        runDurationSecs:  runMatch   ? parseInt(runMatch[1])   : null
    };
}
```

### 14.6 .dat File Parser (generic — works for all graph_N.dat files)

```javascript
function parseDatFile(content, measurementIdFilter = null) {
    // Returns array of { id, ts, avg, count, min, max, stddev }
    const rows = [];
    for (const line of content.split(/\r?\n/)) {
        const parts = line.trim().split(/\s+/);
        if (parts.length < 7) continue;
        const id = parseInt(parts[0]);
        if (measurementIdFilter && !measurementIdFilter.includes(id)) continue;
        rows.push({
            id,
            ts:     parseInt(parts[1]),
            avg:    parseFloat(parts[2]),
            count:  parseInt(parts[3]),
            min:    parseFloat(parts[4]),
            max:    parseFloat(parts[5]),
            stddev: parseFloat(parts[6])
        });
    }
    return rows;
}
```

## PART 15 — COMPLETE PARSER FLOW (step by step)

This is the exact sequence the parser must follow. No steps can be skipped or reordered.

```
Step 1:  Extract ZIP → build files{} map (Part 13.2)
Step 2:  Parse RunInfo.ini → meta.sessionName, meta.companyName, meta.runDate, meta.durationMinutes
Step 3:  Find and parse *.lrr → meta.startTime, meta.stopTime, meta.peakVUsers,
                                meta.rampIntervalSecs, meta.runDurationSecs,
                                meta.protocol, meta.scriptName, meta.lreVersion
Step 4:  Parse RawData.map → txNameMap (including TX_21 = Main_Transaction)
Step 5:  Parse SLAConfiguration.xml → slaTransactions Set
Step 6:  Parse sum_data/sum_dat.ini → measurementMap (all graph measurement IDs)
Step 7:  Parse _t_rep.eve → vuserLifecycle[], meta.steadyStateStart, meta.steadyStateEnd,
                            meta.loadGenerators[]
Step 8:  Parse RawData.eve → transactions[] (422k+ records)
         - Use meta.startTime from Step 3 to compute t = ts - startTime
Step 9:  Parse SqliteDb.db → errors[]
Step 10: Parse sum_data/graph_1.dat → lgMonitoring[] (use measurementMap from Step 6)
Step 11: Parse sum_data/graph_10.dat → httpCodes[] (use measurementMap from Step 6)
Step 12: Parse sum_data/graph_0.dat → vuserCounts[] (for chart only)
Step 13: Return complete data model
```

## PART 16 — WHAT SCALES WITH LARGER RESULT SETS

As the user confirmed: future ZIPs will have the same file structure but potentially more data.

| What scales | Impact | Handling |
|-------------|--------|----------|
| More transactions (>422k) | RawData.eve grows | Parser loop handles any size — no limit |
| More VUsers (>27) | More records per transaction | All algorithms are N-agnostic |
| Longer run (>8hr) | More .dat rows | All parsers handle any row count |
| More transactions defined (>14) | RawData.map has more entries | buildTxNameMap() handles any count |
| Different transaction names | RawData.map changes | Always read dynamically — never hardcode names |
| Different LG names | sum_dat.ini changes | Always read from measurementMap |
| Different run number | *.lrr filename changes | findLrrFile() handles this |
| More LGs (>3) | graph_1.dat has more measurement IDs | measurementMap handles any count |
| Different HTTP codes | graph_10.dat measurement IDs change | Read from measurementMap |

**The only thing that will NOT change across runs:**
- Binary format of RawData.eve (sub-type 762 layout, byte offsets)
- File names of the fixed files (RawData.eve, RunInfo.ini, etc.)
- The 7-column .dat format
- The SQLite schema

*End of Gap Fixes — Specification is now complete and unambiguous.*
*Any AI can build the full system from SPEC.md alone without access to the raw results files.*
