# Workload Modeller — user guide

The Workload Modeller designs a LoadRunner Enterprise (LRE) scenario from what each script must reach. You say the
target of each script; it works out the virtual users (Vusers), the pacing, the ramp-up and ramp-down, the load
generators and the iterations, and gives you the LRE settings to type in and a one-sheet Excel file for the scenario.

It runs in your browser: scripts, recordings and Excel sheets are read on your PC and never sent to the server.

Open it from the PerfX Studio sidebar: **Plan → Workload Modeller**.

## 1. Quick start

1. **The test** — choose the kind of test (Load, Soak, Stress, Capacity, Spike) and how long full load lasts.
2. **Scripts** — drop your script ZIPs or HAR recordings on the Scripts section. Each script's transactions, think
   time and requests are filled in.
3. Give each script its **target** (for example 5 TPS) and a **response time** (your SLA will do).
4. **Load generators** — choose the machine type: the on-premise Windows servers or AWS c6a.4xlarge.
5. Read the **Result** and the **Checks**, then use the two buttons at the top of the page — **Copy LRE settings** and
   **Download Excel** (one sheet: what to type into the LRE scenario and what to expect). They stay in view while you
   scroll.

The page works out the plan as you type. A section you have not touched keeps sensible starting values.

## 2. Words used on the page

| Word | Meaning |
|---|---|
| TPS | Transactions per second — how many business transactions a script completes each second |
| Vuser | A virtual user: one copy of the script running in a loop |
| Iteration | One run through the script's Action part (vuser_init and vuser_end run only once per Vuser) |
| Transactions per iteration (T) | The transactions in one iteration that count for the TPS |
| Pacing | How often a Vuser starts a new iteration (for example every 24 s) |
| Think time | The pauses written in the script between steps |
| Response time | How long one transaction takes, on average (your SLA is a good value to start with) |
| Headroom | How much longer the pacing is than one iteration, so slower responses do not break the TPS (25% by default) |
| Steady state (full load) | The part of the test where every Vuser runs — the window to analyse |

## 3. The sections

### The test
- **What kind of test**: Load (normal busy hour, held), Soak (many hours), Stress and Capacity (steps above the
  target), Spike (normal load, a burst, back).
- **Full-load duration**: how long all users run together after the ramp-up.
- **LRE workload type**: Basic schedule by group (recommended for load and soak), by test, Real-world (needed for
  stepped tests) or Goal-oriented.
- **Growth factor**: 1 = today's peak; 1.5 = 50% more TPS. Scripts sized by Vusers or iterations keep their numbers.
- Detailed view: the licence limit, and the steps and hold time of stepped tests.

### Scripts
- **Fill from scripts**: script ZIPs (Web HTTP/HTML or DevWeb; one ZIP may hold several scripts) and HAR files. The
  import note lists what was read and anything to check: transactions that run once at the start (vuser_init /
  load.initialize) or at the end (vuser_end / load.finalize) and are not counted, transactions inside other
  transactions, a script that ignores its think time. Loops are counted once — correct the transaction count if a
  script repeats steps.
- **Target type** and **Target**: TPS, transactions per hour, a share of the total TPS, a number of Vusers, Vusers and
  TPS together (checked against each other), or a number of iterations (data rows).
- **Response time**: average per transaction, without think time.
- **Replay in LRE**: pacing (let the tool choose — recommended —, fixed, random, as soon as possible, after the
  previous iteration + a delay) and think time (as recorded, ignore, multiply, random %).

Many scripts:
- **Cards / Table**: the table shows one line per script and is edited like a spreadsheet (arrow keys, Enter, paste a
  block copied from Excel).
- **Find** and the **filter** (Needs input, Not possible, Ready) narrow the list.
- **Defaults for every script** stay in force: they fill only empty fields, also in scripts added later.
- **Overwrite all scripts** writes one value into every script shown, once (you can undo it).
- **Paste from Excel**: two columns, script name and target; a name that fits more than one script changes none.
- **Fill in with Excel**: download a sheet with your scripts in it, fill in the targets, drop it back. (The plan
  itself is **Download Excel** at the top of the page.)

### Load generators
Choose the **machine type** of each pool:

| Machine type | Size | Team rule: Vusers per machine | Machine size (starting assumptions) |
|---|---|---|---|
| On-premise Windows server | 8 CPU cores, 32 GB memory (230 GB disk) | web pages 100 · API calls 250 | Web HTTP/HTML 280 · DevWeb 448 · TruClient 11 |
| AWS c6a.4xlarge — Linux | 16 vCPU, 32 GB memory | web pages 200 · API calls 500 | Web HTTP/HTML 560 · DevWeb 896 · TruClient 22 |
| AWS c6a.4xlarge — Windows | 16 vCPU, 32 GB memory | web pages 200 · API calls 500 | Web HTTP/HTML 560 · DevWeb 896 · TruClient 22 |
| Another machine | enter its cores and memory | enter your own (or leave empty) | worked out from what you enter |

- **The team rule** is the Vusers one machine carries for a script of web pages and for a script of API calls. Both
  Web HTTP/HTML and DevWeb scripts can be either, so the tool reads each script when you drop it: requests that load a
  page like a browser (a page with its images, styles and scripts — `EXTRARES`, `Mode=HTML`, form submits; DevWeb
  `resources`) count as pages, the others as API calls. A script of both counts in proportion. On the script card,
  **Kind of script** shows what was read and lets you set **Web pages** or **API calls**; a script typed in by hand
  counts as web pages (the cautious side).
- **Vusers per machine is the smallest of three limits**: the team rule, the machine's CPU and its memory (both kept
  under 70%). Checks say which one set the count. On AWS the rule is twice the on-premise one — twice the CPUs — but the
  memory is the same, so for heavy web scripts memory may decide.
- **Extra machines** (one in the first pool to start with) are added to the count and carry Vusers too: the scripts are
  spread over all the machines, each further below its limit. No machine stands idle.
- **A measured figure is best**: after the first run, enter the Vusers one machine carried — for the script on its card
  (Detailed view, **Vusers per machine**) or for the pool (**From a past run**). It replaces the rule and the machine size.
- A script whose Vusers send more than 2 requests per second each (a fast loop) is flagged: the figures above assume a
  normal pace.
- Use **Another machine** for a project with its own load generators. Changing the size of a listed type turns the
  pool into "Another machine". Changing the type fills its rule figures, unless you typed your own.
- Add a second pool when a test uses two kinds, for example on-premise and AWS, and choose on each script where it runs.
- Disk space is not used in the sizing.

### Results
- **Result**: a plain-language summary, the tiles (Vusers, TPS, load generators, test length, steady state,
  iterations, transactions, hits per second), the chart, and the phases with their times on the test clock.
- **Checks**: what must be filled in, what cannot work and why, and the response-time limit of each script.
- **Details**:
  - **LRE setup** — one row per LRE group, by script name (a script split to fill the machines has one row per
    group), everything to build the scenario in LRE: Vusers, load generators (LG1, LG2 …), pacing, think time, then
    LRE's own fields **Start (ramp-up)**, **Duration (steady state)** and **Stop (ramp-down)**, times in HH:MM:SS as LRE
    asks for them. By group, every group is "Start Group: Immediately" and "Initialize each Vuser just before it runs".
    With a schedule for all groups together (by test, real-world, goal-oriented) the steps are listed under the table. While columns are cut off, a line offers **hide the inputs** to see them all. The same
    as text, for **Copy LRE settings**, is folded underneath.
  - **Per script** — the calculation results: iteration time, TPS, response-time limit, iterations per phase.
  - **Load generators** — one row per machine: its scripts and their Vusers, how much of the team rule it uses, the
    expected CPU and memory, requests per second; per script, the kind, the Vusers per machine and what decided it.
  - **How it is worked out** — every step for each script, and **All the formulas** (the same as chapter 6 of this
    guide, with your page's settings).

### Download Excel

One sheet, **LRE scenario** — what to type into the scenario and what to expect:

- At the top: test type, LRE workload type, the load generators (how many, their names, needed + extra), the total
  test length and the steady state (when to measure).
- One row per LRE group, by script name (a script that fills one load generator and goes on to another has two rows
  with its name — add it to the scenario once per row): Vusers, % of Vusers, response time, think time, pacing, load
  generators, Start (ramp-up), Duration (steady state), Stop (ramp-down), expected iterations and expected TPS — and a
  total row. Times are HH:MM:SS.
- By group, the "Schedule" line at the top says what is the same for every group: Start Group Immediately, Initialize
  each Vuser just before it runs.
- With a schedule for all groups together (by test, real-world, goal-oriented) its steps are on the "Schedule" line at
  the top instead of in each row.

The calculation detail (iteration time, CPU and memory per machine, the checks, every formula) stays on the page under
**Details**.

## 5. Team settings

The figures a team agrees on are in one file on the server, `workload-modeller/config/workload-settings.json`:

| Setting | What it is | Shipped value |
|---|---|---|
| `machineTypes` | each machine type: `id`, `label`, `location` (the pool name), `cores`, `memoryGb`, `diskGb`, `webVusersPerLg`, `apiVusersPerLg` (the team rule), `cpuWord` (e.g. vCPU) | on-premise 8 cores, 32 GB, 100 / 250 · AWS c6a.4xlarge Linux and Windows 16 vCPU, 32 GB, 200 / 500 |
| `loadGenerators.busyLimitPct` | the CPU and memory limit of a machine | 70 |
| `loadGenerators.extraMachines` | extra machines in the first pool | 1 |
| `loadGenerators.smallestGroup` | no LRE group smaller than this when a script is split | 5 |
| `loadGenerators.fastLoopRequestsPerSecond` | above this per Vuser, Checks flags a fast loop | 2 |
| `schedule.headroomPct` | pacing chosen this much above the iteration time | 25 |
| `schedule.maxStartRatePerSecond` | the fastest start rate | 2 |
| `protocols` | memory per Vuser (MB) and Vusers per CPU core, per protocol (web, devweb, truclient, other) | 5 / 50, 3 / 80, 350 / 2, 10 / 30 |

- To change a figure (for example 150 Vusers per on-premise machine for web pages), edit the file on the server, save
  it and set `updated` to today's date. Every user gets the new figures the next time they open the page — nothing to
  build or restart; the browser never keeps an old copy.
- A machine type can be added (a unique `id`, a `label`, `cores` and `memoryGb` are needed). "Another machine" is always
  offered as well.
- Every value is checked. A wrong or missing value keeps the built-in one, and the Load generators section names it
  ("1 value in the settings file was not used: …"). The line under the pools says which figures are in use and the
  `updated` date.
- The file only sets the starting values: anyone can still change a figure on the page for their own plan.
- Keep the file in the repository too, so the next release does not put the old figures back.

## 6. How the numbers are worked out

T = transactions per iteration · G = growth factor · λ = the iterations per second a target needs (TPS ÷ T) ·
⌈x⌉ = x rounded up. Default settings: headroom 25%, random spread ±15%, start rate 2 Vusers per second (Fine tuning).

### 6.1 The TPS each script needs

| Target type | TPS needed |
|---|---|
| TPS | target × G |
| Transactions per hour | per hour ÷ 3,600 × G |
| Share of the total TPS | total TPS × G × share % ÷ 100 (the shares must add up to 100%) |
| Vusers and TPS | TPS × G; the Vusers stay as entered |
| Iterations | iterations × T ÷ full-load seconds (no growth) |
| Number of Vusers | none — the TPS is a result |

Defaults for every script: "Each script" gives the default TPS to every script without a target; "In total" shares
(total − the TPS of the scripts with their own target) evenly between the scripts without one.

### 6.2 One iteration

- Think time: as recorded t · ignore 0 · multiply t × factor · random % on average t × (lowest % + highest %) ÷ 200,
  at most t × highest % ÷ 100.
- **Iteration = response time × T + think time** (averages).
- **Slow iteration = the 90th percentile (or the average, whichever is larger) × T + the longest think time.** It adds
  the 90th percentiles, so it errs on the long side; it is used only for warnings, the random pacing style and the
  test length.

### 6.3 Pacing and Vusers

The rule behind everything: **TPS = Vusers × T ÷ pacing**, and the pacing must be at least one iteration.

| Pacing | Vusers |
|---|---|
| Chosen by the tool | shortest pacing = ⌈iteration × (1 + headroom)⌉ s (random style: also at least slow iteration ÷ (1 − spread)); Vusers = ⌈λ × shortest pacing⌉; then the pacing in **whole seconds**: exact if a few more Vusers (up to 10%, at least 2) give a whole number; otherwise the fewest Vusers whose whole-second pacing keeps the TPS at most 1% above the target; only a short pacing, where one second is a big step, is kept to 0.1 s. The TPS never falls below the target. Random style: whole-second bounds around the same average |
| Fixed, every P seconds | ⌈λ × P⌉ |
| Random, between a and b seconds | P = (a + b) ÷ 2; ⌈λ × P⌉; the TPS lies between Vusers × T ÷ b and Vusers × T ÷ a |
| As soon as possible / after the previous iteration + d | one Vuser's cycle = iteration + d; ⌈λ × cycle⌉ |
| Vusers and TPS given | the pacing follows: Vusers ÷ λ |
| Number of Vusers given | TPS = Vusers × T ÷ pacing |

Also: iterations per second = Vusers ÷ pacing; hits per second = requests per iteration × iterations per second.

### 6.4 Checks

| Check | When |
|---|---|
| Response-time limit | (shortest pacing − longest think time) ÷ T — the slowest average per transaction that keeps the TPS |
| Not possible | shortest pacing < iteration: iterations overrun and the TPS drops to about Vusers × T ÷ iteration; enough Vusers = ⌈λ × iteration × (1 + headroom)⌉ |
| Some iterations overrun | shortest pacing < slow iteration |
| Little headroom | shortest pacing < iteration × (1 + headroom) |
| Others | think time longer than the pacing; rounding moved the TPS by more than 1%; more iterations than data rows; more Vusers than the licence; shares not adding up to 100% |

### 6.5 Ramp-up and ramp-down

- **Wanted ramp-up** = the larger of (Vusers ÷ start rate) and the smaller of (3 × the longest pacing, at least 60 s)
  and (a quarter of the full-load time, at least 60 s, at most 30 minutes). Three pacings let the Vusers' iterations
  spread out evenly; the start rate protects the log-ins.
- **"Start X Vusers every N seconds"**: the fewest Vusers per step whose interval is 1, 2, 3, 4, 5, 6, 10, 12, 15, 20,
  30, 45, 60, 90, 120, 180 or 300 s and gives a ramp within 10% of the wanted one, never faster than the start rate.
- **Ramp-down**: half the ramp-up worked out with twice the start rate, but never shorter than Vusers ÷ the stop rate, so no step stops many Vusers at once; each Vuser finishes its current iteration.
- **Basic schedule by group**: every group starts immediately (LRE "Start Group: Immediately") and ramps over the same
  length — the longest ramp any script needs on its own. A quicker script starts its Vusers more slowly (one Vuser
  per step whenever it fits, at any whole-second interval, ending at most 10% before that length, never after it), so every script reaches full load
  at about the same moment. LRE counts a group's **Duration** from the end of its own ramp, so a group whose last step
  comes a little earlier gets that much more Duration (e.g. 01:00:24 instead of 01:00:00): all stop together, and all
  are at full load for the whole steady state. Example: script A (100 Vusers) needs 8:20, script B (20 Vusers) only
  3:20 on its own → B starts 1 Vuser every 25 s instead of every 10 s; both are at full load at 8:20. The scripts ramp
  at the same time, so they **share the start rate**: each gets the start rate ×
  its share of the Vusers (at least 1 Vuser every 300 s), and together they never start more than the start rate — 2 new
  Vusers per second by default; the stop rate likewise. Example: 20 scripts of 25 Vusers start 1 Vuser every 10 s each
  (2 per second in all), not 2 per second each.
- **Stress / Capacity**: steps at a percentage of the Vusers (50, 75, 100, 125, 150% / 100 to 200%), each held
  10 minutes or 5 × the longest pacing, whichever is longer (or the hold you set).
- **Spike**: normal load (50%) held; the burst to 200% starts within one pacing (10 to 60 s) and holds up to 10
  minutes; the burst stops at once; recovery is held; then everything stops.
- **Goal-oriented**: the goal is the total TPS; Vusers from 50% to 150% of the plan; run for the full-load time
  after the goal is reached.

### 6.6 Timeline and totals

- Each Vuser starts an iteration when it starts and then once per pacing until it stops. This is an expected-value
  model, not a replay: it shows what the plan should give.
- Iterations are counted per phase (ramp-up, full load, ramp-down); transactions = iterations × T. With gradual
  exit every iteration that starts also finishes.
- Expected TPS at any moment = the running Vusers × T ÷ pacing, added up over the scripts.
- **Test length** = end of the schedule + the longer of the pacing and the slow iteration.

### 6.7 Load generators

- **Team rule** for a script: Vusers per machine = 1 ÷ (p ÷ web + (1 − p) ÷ API), where p is the script's share of
  page requests (Web pages = 1, API calls = 0, typed in by hand = 1). Example with 100 / 250 and 3 pages in 20 requests:
  1 ÷ (0.15 ÷ 100 + 0.85 ÷ 250) = 204.
- **Machine size**: by memory (memory − 2 GB) × 1,024 × 70% ÷ MB per Vuser; by CPU cores × Vusers per core × 70%.
- **Vusers per machine** of a script = the smallest of the team rule, by CPU and by memory. Your figure (the script's,
  else the pool's for the protocol) replaces all three. TruClient: CPU and memory only.
- **Machines needed in a pool** = ⌈the largest of Σ (peak Vusers ÷ team rule), Σ (peak Vusers ÷ by CPU) and Σ (peak
  Vusers ÷ by memory)⌉. The three are added up apart, so a CPU-heavy and a memory-heavy script can share a machine.
- **Extra machines**: total = needed + extra (cut to the machines available), and the Vusers are spread over all of
  them — the lowest load per machine that still fits; when that cannot land on the total exactly, the machines left go
  one at a time to the script whose machines are the busiest. A script is never split over more machines than it has
  Vusers.
- **From a past run**: Vusers per machine = Vusers it ran × 70 ÷ the higher of its peak CPU % and memory %. This is a
  straight line; below 35% busy it is a rough guess.
- **Which script runs on which machine.** A script's load = its peak Vusers × its share of one machine (the busiest of
  the team rule, CPU and memory). LRE splits a group's Vusers evenly over the load generators you give it (250 Vusers on
  3 machines: 84 + 83 + 83), so a half-full machine cannot be topped up with part of a group. Choose under **Load
  generators › How the Vusers go onto the machines**:
  - **Fill each machine** (the default, the fewest machines): largest script first; it goes whole onto the fullest
    machine with room, otherwise it fills a machine and continues on the next. A script that continues runs in LRE as
    one group per set of machines, with the same runtime settings: LRE setup and Excel show the script on two rows (by
    its name), each with its load generators and its schedule (all reach full load together); add the script once per
    row — LRE names the second group itself. No group smaller than 5 Vusers. Example: 126 Vusers of a page script at
    105 per machine → 105 on LG1 and 21 on LG2, next to other scripts.
  - **One group per script** (the simplest setup): a script that needs more than one machine gets ⌈load⌉ machines of its
    own, its Vusers split evenly; the others, largest first, go onto the least-busy machine with room. Whole scripts
    often do not fit into the plain total (three scripts of 0.6 of a machine each: 1.8 → 2, but 0.6 + 0.6 does not fit
    one machine), so more machines are used — Checks warns and says how many Fill each machine would use.
  - With extra machines, the layout that uses all of them with the fewest groups is chosen (then the coolest busiest
    machine). TruClient scripts (real browsers) run on machines of their own either way.
  - Names: LG1, LG2 … numbered on from one pool to the next.
- Expected CPU (or memory) of a machine = its load × 70%. Requests per second of a machine = Σ Vusers × requests per
  iteration ÷ pacing.
- Starting assumptions (editable in Detailed view → Sizing assumptions): Web HTTP/HTML 5 MB per Vuser and 50 Vusers per
  core; DevWeb 3 MB and 80; TruClient 350 MB and 2; other protocols 10 MB and 30.

### 6.8 A worked example

A script with 4 transactions per iteration, 1 s average response time, 15 s think time and 12 requests must reach
10 TPS for one hour. Pacing chosen by the tool, on-premise Windows servers.

| Step | Working | Result |
|---|---|---|
| Iterations per second needed | 10 TPS ÷ 4 | λ = 2.5 |
| One iteration | 1 s × 4 + 15 s | 19 s |
| Shortest pacing | ⌈19 × 1.25⌉ = ⌈23.75⌉ | 24 s |
| Vusers | ⌈2.5 × 24⌉ | 60 |
| Pacing for an exact TPS | 60 ÷ 2.5 (already a whole number) | 24 s |
| Planned TPS | 60 × 4 ÷ 24 | 10.00 |
| Response-time limit | (24 − 15) ÷ 4 | 2.25 s per transaction |
| Hits per second | 12 × 60 ÷ 24 | 30 |
| Wanted ramp-up | larger of 60 ÷ 2 = 30 s and smaller of (3 × 24 = 72 s) and (3,600 ÷ 4 = 900 s) | 72 s |
| Start steps | 3 Vusers every 4 s: 20 steps → 19 × 4 | 76 s (within 10% of 72) |
| Ramp-down | 3 Vusers every 2 s | 38 s |
| Test length | 76 s + 60 min + 38 s + 24 s (one pacing; the iteration is shorter) | 1 h 2 min 18 s |
| Iterations at full load | 60 × 3,600 ÷ 24 | 9,000 (9,165 in the whole test) |
| Load generators | Typed in by hand, so web pages: team rule 100; machine size 8 × 50 × 70% = 280; the smaller, 100, decides: 60 ÷ 100 → 1, + 1 extra | 2: LG1 and LG2 run 30 Vusers each (30% of the team rule, 30 ÷ 280 × 70% = 8% CPU) |

The LRE settings for this plan:

```
Start Vusers: Start 60 Vusers: 3 Vusers every 00:00:04 (HH:MM:SS)
Duration: Run for 01:00:00
Stop Vusers: Stop 60 Vusers: 3 Vusers every 00:00:02 (HH:MM:SS)
Pacing: Start new iteration: at fixed intervals, every 24 seconds
```

## 7. Good to know

- Nothing is saved: closing the page clears it. Use **Fill in with Excel** to keep a set of targets.
- The figures are a plan. After the first run, compare with the Results Analyser: if the response times were higher
  than planned, check the response-time limit; if the load generators were busier than 70% (or far less busy than
  the team rule assumed), enter the measured Vusers per machine.
- Start over clears every section and can be undone.
