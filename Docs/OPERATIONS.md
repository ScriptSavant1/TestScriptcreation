# PerfX Studio — Operations & Capacity Guide

*Audience: team leads, infrastructure, support engineers, and anyone asking "can this tool handle our load?"*

---

## What Is PerfX Studio?

PerfX Studio is an **internal performance engineering platform** that converts API traffic recordings into production-ready LoadRunner scripts. Performance testers use it to go from a recorded browser session or existing API collection to a fully working VuGen or DevWeb script — without writing the script manually.

It runs as a **Node.js web server** on a single internal server and is accessed by all team members through a browser. No installation is required on the tester's machine beyond opening a browser.

### Four Tools in One

| Tool | What you give it | What you get |
|------|-----------------|--------------|
| **Postman / Bruno Converter** | Postman or Bruno API collection | DevWeb JS or VuGen C script |
| **JMeter Converter** | Apache JMeter `.jmx` file | DevWeb JS or VuGen C script + Workload Excel |
| **Recorder** | Browser HAR recording | DevWeb JS or VuGen C script |
| **Script Studio** | HAR file(s) + correlation analysis | DevWeb JS or VuGen C script with dynamic value handling |

### What It Does NOT Do

- It does not store files. Uploaded files are deleted within seconds of conversion.
- It does not send data anywhere outside your network. All processing is on-server.
- It does not require user accounts or authentication. Access is network-controlled.
- It does not write to a database. There is no persistent state between sessions.

---

## Concurrent Users — The Full Picture

**All 70 users can use the tool at the same time.** There is no per-user session limit.

The concurrency limit (default: 8) applies only to the **active conversion step** — the 5–20 seconds the server spends processing a file after a user clicks Convert. Everything else — browsing the tool, uploading a file, configuring options, reviewing output, downloading the ZIP — is instant and does not consume a slot.

### What a Typical Session Looks Like

```
User opens tool in browser         ─ instant, no slot used
Upload collection file             ─ instant (file goes to server RAM)
Configure options                  ─ instant, no slot used
Click Convert ──────────────────── SLOT USED for ~10–20 seconds
Conversion completes               ─ SLOT RELEASED
Download ZIP                       ─ instant, no slot used
Open script in VuGen               ─ no slot used
```

The server is actively working for a user for roughly **10–20 seconds** out of a session that might be 15–30 minutes long. This means at any given moment, **fewer than 10% of active users are in the conversion step**.

### Concurrency Model

```
70 active users
  └─ ~5–10 are clicking Convert at any moment
       ├─ 8 slots available  → all 5–10 fit comfortably
       └─ if a brief burst sends 12 at once:
              first 8 → start immediately
              last 4  → HTTP 503 "server busy" (retry in ~15 seconds = works)
```

The 8-slot default is conservative. See [Tuning](#tuning) to increase it.

---

## Capacity Analysis

### For 60–70 Users on a Shared Internal Tool

| Metric | Value |
|--------|-------|
| Simultaneous users (browsing) | Unlimited |
| Simultaneous conversions (processing) | 8 (default, tunable) |
| Typical conversion time | 5–20 seconds |
| Throughput at 8 slots | ~24–96 conversions per minute |
| Realistic demand (70 users, one conversion per 20 min) | 3–4 conversions per minute |
| Safety margin | ~6–10× headroom |

**Conclusion:** 60–70 users is well within comfortable capacity. The server would need to be doing 24+ conversions per minute before users notice any slowdowns — a level only reachable if every user converts several times per minute simultaneously, which does not happen in practice.

### When Capacity Would Become a Concern

| Situation | Impact |
|-----------|--------|
| Very large HAR files (500 MB+) | Longer conversion (30–90 sec), holds a slot longer |
| Everyone converts at the same second (unusual burst) | Up to 4 users see HTTP 503 and retry |
| Memory climbs above 2.5 GB | PM2 restarts the process automatically (< 10 sec downtime) |
| 200+ users with aggressive usage patterns | Would need concurrency limit raised to 12–16 |

---

## Memory Usage

### Normal Operating Range

| State | Heap Used | RSS (total process) |
|-------|-----------|---------------------|
| Idle (no conversions) | 80–150 MB | 200–300 MB |
| 1–2 active conversions | 200–400 MB | 400–600 MB |
| 8 active conversions (peak) | 600 MB–1.2 GB | 800 MB–1.5 GB |
| After large HAR (100 MB+) | Spike to 800 MB, returns to baseline after GC | |

### What Drives Memory Up

1. **Large input files** — a 200 MB HAR file is parsed entirely into RAM. If 4 users do this simultaneously, peak usage can reach 1–2 GB.
2. **Pending downloads** — converted ZIPs are held in RAM until the user downloads them (or 5-minute expiry). Many unconsumed conversions increase memory.
3. **Node.js GC lag** — memory may not return to baseline immediately after conversion. GC runs on Node's own schedule.

### Memory Thresholds and Actions

| Memory Level | What Happens | Action Needed |
|--------------|-------------|---------------|
| Under 1.5 GB heap | Normal | None |
| 1.5–2.5 GB heap | Elevated but stable | Monitor; consider reducing `MAX_CONCURRENT_CONVERSIONS` temporarily |
| Above 3 GB RSS | PM2 restarts the process | Auto-handled; check logs if frequent |
| OOM kill (out of memory) | Process exits | Increase server RAM or reduce `--max-old-space-size` |

### Memory Configuration

```javascript
// pm2.config.js (current defaults)
max_memory_restart: "3G"        // PM2 restarts if RSS exceeds 3 GB
node_args: "--max-old-space-size=4096"  // Node heap limit: 4 GB
```

If the server has 8 GB RAM, these defaults are safe. For a 4 GB server, lower to `max_memory_restart: "1.5G"` and `--max-old-space-size=2048`.

---

## Monitoring

### Live Status Endpoint

Visit this URL at any time — no login required:

```
http://your-server:3000/converter/status
```

Example response:

```json
{
  "status": "ok",
  "activeConversions": 2,
  "maxConcurrent": 8,
  "pendingDownloads": 3,
  "memory": {
    "heapUsedMB": 312,
    "heapTotalMB": 512,
    "rssMB": 480
  },
  "uptime": "86400s"
}
```

### What Each Field Means

| Field | Meaning | Concern if... |
|-------|---------|---------------|
| `status` | `"ok"` or `"busy"` | `"busy"` = at max concurrent conversions |
| `activeConversions` | Files currently being converted | Stays at max for extended periods |
| `maxConcurrent` | The slot limit (default 8) | — |
| `pendingDownloads` | ZIPs in memory waiting to be downloaded | Climbs above 50 (users not downloading) |
| `heapUsedMB` | Node.js heap in use | Above 2,000 MB |
| `heapTotalMB` | Total heap allocated | — |
| `rssMB` | Total process RAM including OS buffers | Above 2,500 MB |
| `uptime` | Time since last start/restart | Low value = recent crash; check PM2 logs |

### PM2 Monitoring (if deployed with PM2)

```
pm2 monit           ← live dashboard: CPU %, RAM, restart count per process
pm2 logs perfx-studio   ← streaming log output
pm2 list            ← shows status, uptime, restart count
```

A non-zero restart count in `pm2 list` means the process has crashed or hit the memory limit at least once. Check the error log:

```
pm2 logs perfx-studio --err --lines 100
```

---

## Performance Characteristics

### Conversion Time by Input Type and Size

| Input | File Size | Typical Time |
|-------|-----------|-------------|
| Bruno / Postman collection | < 1 MB | 1–3 seconds |
| Bruno / Postman collection | 1–10 MB | 3–8 seconds |
| JMeter JMX (simple) | < 1 MB | 2–5 seconds |
| JMeter JMX (complex, many thread groups) | 1–5 MB | 5–15 seconds |
| HAR recording (Recorder / Studio) | < 10 MB | 3–8 seconds |
| HAR recording (long journey) | 50–200 MB | 15–60 seconds |
| HAR recording (very large) | 200 MB+ | 30–120 seconds |

All conversions have a **120-second hard timeout**. If processing exceeds this, the server returns HTTP 408 and the user sees "Conversion timed out — try splitting the file or reducing the number of requests."

### What Slows Conversions Down

1. **Number of requests in the collection** — 1,000 requests takes longer than 50
2. **Correlation detection** — Script Studio with deep correlation analysis on a large HAR is the most CPU-intensive operation
3. **Large request/response bodies** — 10 MB JSON response bodies require more parsing time
4. **Simultaneous conversions** — 8 conversions at once share the same CPU core

---

## Tuning

### Increasing the Concurrency Limit

The default of 8 suits most deployments. Increase it if users frequently see "server busy" messages.

**Option 1 — Environment variable (temporary):**
```
# Windows
set MAX_CONCURRENT_CONVERSIONS=12 && npm run web

# Linux
MAX_CONCURRENT_CONVERSIONS=12 npm run web
```

**Option 2 — PM2 config (permanent):**

Edit `pm2.config.js`:
```javascript
env: {
  MAX_CONCURRENT_CONVERSIONS: 12,   // change from 8
}
```
Then restart:
```
pm2 restart perfx-studio
```

**Rule of thumb:** Set to the number of **physical CPU cores** on the server. Do not exceed it — additional conversions beyond the physical core count will queue on the CPU and slow everything down rather than speeding it up.

| Server CPU | Recommended MAX_CONCURRENT_CONVERSIONS |
|------------|---------------------------------------|
| 2 cores | 4 |
| 4 cores | 8 (default) |
| 8 cores | 16 |
| 16 cores | 24 |

### Increasing Heap Memory

If conversions fail with "JavaScript heap out of memory" in the logs:

Edit `pm2.config.js`:
```javascript
node_args: "--max-old-space-size=8192",  // increase from 4096 to 8 GB
```

Only do this if the server has enough physical RAM. Set `--max-old-space-size` to at most **half the server's total RAM**.

---

## Failure Scenarios and Recovery

### Scenario 1 — Users Seeing "Server Busy" Frequently

**Symptom:** Multiple users report HTTP 503 "server busy" several times a day.

**Diagnosis:** Check `/converter/status` — if `activeConversions` is consistently at `maxConcurrent`, the limit is too low.

**Fix:** Increase `MAX_CONCURRENT_CONVERSIONS` in `pm2.config.js` and restart.

---

### Scenario 2 — Conversions Timing Out

**Symptom:** Users see "Conversion timed out" (HTTP 408) on large files.

**Cause options:**
- File is genuinely too large (200 MB+ HAR with thousands of requests)
- Server is under heavy load from other conversions

**Fix options:**
1. Ask the user to split the HAR — record separate journeys for each feature area
2. Reduce `MAX_CONCURRENT_CONVERSIONS` temporarily so each conversion gets more CPU
3. Upgrade server CPU

---

### Scenario 3 — Process Restarts Frequently (Memory)

**Symptom:** `pm2 list` shows a rising restart count; users occasionally see the tool briefly unavailable.

**Cause:** Process hit `max_memory_restart` threshold (3 GB).

**Diagnosis:** Check what users were converting at the time — likely large HAR files processed simultaneously.

**Fix options:**
1. Increase server RAM (recommended: 16 GB for heavy use)
2. Lower `MAX_CONCURRENT_CONVERSIONS` to reduce peak memory
3. Increase `max_memory_restart` threshold if RAM allows

---

### Scenario 4 — Process Does Not Start

**Symptom:** `pm2 start pm2.config.js` fails or process immediately exits.

**Diagnosis steps:**
```
pm2 logs perfx-studio --err --lines 50
node --check src/web/server.js
```

**Common causes:**
- Port 3000 already in use: `netstat -ano | findstr :3000` → kill the process or change `PORT` in pm2.config.js
- Missing `node_modules`: run `npm install --production`
- Node.js version too old: `node --version` must be v20+

---

### Scenario 5 — Downloads Failing ("Download Expired")

**Symptom:** User clicks Convert successfully but the ZIP download fails with "download expired."

**Cause (if running single PM2 instance):** Download token expired (5-minute window). User waited too long before downloading.

**Cause (if accidentally running multiple PM2 instances):** Token was created in one process, download request went to another process. This is why `instances: 1` is mandatory.

**Fix:** User clicks Convert again and downloads immediately. If the 5-minute window is consistently too short, it can be extended in `server.js` (search for `+5min` comment in the download token section).

---

## Recommended Server Specifications

### For 60–70 Users (current team size)

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU cores (physical) | 4 | 8 |
| RAM | 8 GB | 16 GB |
| Disk (free space for temp files) | 20 GB | 50 GB |
| OS | Windows Server 2019+ or Ubuntu 20.04+ | Ubuntu 22.04 LTS |
| Node.js | v20 LTS | v22 LTS |
| Network | 100 Mbps LAN | 1 Gbps LAN |

### For 200+ Users

- Increase `MAX_CONCURRENT_CONVERSIONS` to 16–24
- 8+ CPU cores, 32 GB RAM
- Implement a shared Redis store for download tokens
- Switch PM2 to `instances: "max"` (cluster mode) to use all cores

Contact the performance engineering team lead before scaling to multi-instance — it requires a small architectural change.

---

## Quick Reference Card

### Check Tool Health
```
http://your-server:3000/converter/status
```

### PM2 Commands
```
pm2 list                              — show status and restart count
pm2 monit                             — live CPU + RAM dashboard
pm2 logs perfx-studio                 — streaming output logs
pm2 logs perfx-studio --err           — error logs only
pm2 restart perfx-studio              — restart (e.g. after config change)
pm2 stop perfx-studio                 — stop the tool
pm2 start pm2.config.js               — start the tool
```

### Tuning Reference
```
MAX_CONCURRENT_CONVERSIONS=N          — set to number of physical CPU cores
max_memory_restart: "XG"             — in pm2.config.js; set to 75% of server RAM
--max-old-space-size=XXXX            — in pm2.config.js node_args; set to 50% of RAM in MB
```

### Key Timeouts
- Conversion timeout: **120 seconds** (HTTP 408 if exceeded)
- Download token expiry: **5 minutes** after conversion completes
- Rate limit: **60 conversion requests per 5 minutes per IP**

---

*Last updated: 2026-07-09 | Related: [SECURITY.md](SECURITY.md) | [SETUP-GUIDE.md](SETUP-GUIDE.md)*
