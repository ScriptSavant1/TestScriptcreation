# PerfX Studio — Usage Analytics & Reporting
# Implementation Plan

**Status:** Draft — awaiting confirmation before implementation  
**Date:** 2026-07-09  
**Audience:** Internal — performance engineering team lead + infra

---

## 1. What This Feature Does

Silently records every conversion made in PerfX Studio — who used it (machine/device), what they uploaded, which tool they used, how long it took, and whether it succeeded. An admin-only dashboard shows the data as reports and allows CSV download for management presentations.

**Users see nothing.** No prompts, no notifications, no change to their workflow.

---

## 2. What We Capture (Automatically, Zero User Action)

### Server-side (from every HTTP request — no JS needed)

| Field | Source | Example |
|-------|--------|---------|
| Timestamp (start) | Server clock | `2026-07-09 14:23:01 UTC` |
| Timestamp (end) | Server clock | `2026-07-09 14:23:09 UTC` |
| Duration | End − Start | `8,412 ms` |
| IP address | `req.ip` | `10.20.5.44` |
| X-Forwarded-For | Proxy header | `10.20.5.44, 192.168.1.1` |
| Machine hostname | Reverse DNS on IP (async) | `VCSE-PERF-044` |
| Browser | User-Agent parsed | `Chrome 126` |
| OS | User-Agent parsed | `Windows 11` |
| Tool used | Which endpoint was called | `studio` / `converter` / `jmx` |
| Protocol | Form field | `devweb` / `vugen` |
| Script mode | Form field | `single` / `multi` |
| Input filename | Upload metadata | `checkout-journey.har` |
| File extension | From filename | `.har` / `.json` / `.jmx` / `.bru` |
| File size | Upload metadata | `18,432 KB` |
| Request count | Parsed from file | `342` |
| Result | Try/catch | `success` / `failed` / `timeout` |
| Error code | Error object | `conversion_timeout` / `conversion_failed` |
| Correlations found | Analysis result | `14` (Studio only) |
| Correlations accepted | Analysis result | `9` (Studio only) |

### Client-side (tiny JS snippet on page load, sent silently with first request)

| Field | Source | Example |
|-------|--------|---------|
| Device ID | UUID generated once, stored in `localStorage` | `a3f7c2b1-9d4e-4f2a-b831-cc4d8e2f1a09` |
| Screen resolution | `screen.width x screen.height` | `1920x1080` |
| Timezone | `Intl.DateTimeFormat().resolvedOptions().timeZone` | `Asia/Kolkata` |
| Language | `navigator.language` | `en-GB` |
| Platform | `navigator.platform` | `Win32` |

**Device ID behaviour:**
- Generated once per browser profile using `crypto.randomUUID()`
- Stored in `localStorage` key `perfx_device_id`
- On **AVD / VCSE** (each user has their own VM): persists forever → same user always same ID
- On **Citrix with roaming profiles**: persists per user Windows profile → same user same ID
- On **Citrix without roaming profiles**: resets each session → tracks sessions, not users
- Never sent to any external service — only to PerfX Studio's own server

---

## 3. SQLite Database — Full Detail

### Why SQLite

| Reason | Detail |
|--------|--------|
| Zero setup | No database server to install or configure |
| Single file | Entire database is one `.db` file |
| Portable | Copy the file to move the database anywhere |
| Reliable | Used in production by billions of devices (Android, iOS, Firefox, etc.) |
| Fast enough | Handles millions of rows with no performance issues for this use case |
| Free tools | Open with DB Browser for SQLite (free GUI) for ad-hoc queries |

### File Location

```
perfx-studio/
├── data/
│   └── analytics.db        ← the database (auto-created on first run)
├── src/
├── Docs/
└── package.json
```

The `data/` folder is created automatically when the server starts for the first time. It is listed in `.gitignore` — **analytics data is never committed to Git.**

### Database Schema

```sql
-- Main table: one row per conversion attempt
CREATE TABLE conversions (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,

  -- Timing
  started_at            TEXT NOT NULL,    -- ISO8601 UTC e.g. "2026-07-09T14:23:01.000Z"
  ended_at              TEXT,             -- NULL if timeout/error before completion
  duration_ms           INTEGER,          -- milliseconds; NULL if no end time

  -- Machine identity (server-side)
  ip_address            TEXT,             -- "10.20.5.44"
  ip_forwarded          TEXT,             -- X-Forwarded-For header (may reveal real IP)
  hostname              TEXT,             -- reverse DNS result e.g. "VCSE-PERF-044"

  -- Browser identity (client-side, sent with request)
  device_id             TEXT,             -- UUID from localStorage (persistent browser ID)
  browser               TEXT,             -- "Chrome 126"
  os                    TEXT,             -- "Windows 11"
  screen_res            TEXT,             -- "1920x1080"
  timezone              TEXT,             -- "Asia/Kolkata"
  lang                  TEXT,             -- "en-GB"
  platform              TEXT,             -- "Win32"

  -- What they did
  tool                  TEXT NOT NULL,    -- "converter" | "jmx" | "recorder" | "studio"
  protocol              TEXT,             -- "devweb" | "vugen"
  script_mode           TEXT,             -- "single" | "multi"

  -- Input file
  filename              TEXT,             -- original uploaded filename
  file_ext              TEXT,             -- ".har" | ".json" | ".jmx" | ".bru" | ".yml"
  file_size_kb          INTEGER,          -- rounded to KB

  -- Parsed metrics
  request_count         INTEGER,          -- number of requests in the collection/HAR

  -- Output
  result                TEXT NOT NULL,    -- "success" | "failed" | "timeout"
  error_code            TEXT,             -- error code if failed (never err.message)

  -- Studio-specific
  correlations_found    INTEGER,          -- advisor candidates detected
  correlations_accepted INTEGER           -- candidates the user accepted
);

-- Indexes for fast filtering in reports
CREATE INDEX idx_started_at  ON conversions (started_at);
CREATE INDEX idx_device_id   ON conversions (device_id);
CREATE INDEX idx_ip_address  ON conversions (ip_address);
CREATE INDEX idx_hostname     ON conversions (hostname);
CREATE INDEX idx_tool         ON conversions (tool);
CREATE INDEX idx_result       ON conversions (result);
```

### How Big Will the Database Get?

**Assumptions:** 70 users, average 10 conversions per day each (generous estimate).

| Period | Rows | Estimated DB Size |
|--------|------|-------------------|
| 1 day | 700 | ~0.5 MB |
| 1 month | ~21,000 | ~15 MB |
| 6 months | ~126,000 | ~90 MB |
| 1 year | ~252,000 | ~180 MB |
| 2 years | ~504,000 | ~360 MB |
| 5 years | ~1,260,000 | ~900 MB |

**Conclusion:** SQLite handles this comfortably. It supports databases up to 281 TB and performs well up to hundreds of millions of rows with proper indexes. At 5 years of usage, the database will be under 1 GB — no issues.

### Portability

Moving the entire project including analytics data to a new machine:

```
Step 1: Stop the server
  pm2 stop perfx-studio

Step 2: Copy the entire project folder (including data/)
  xcopy /E /H /C "C:\perfx-studio" "D:\new-location\perfx-studio"

Step 3: Start on new machine
  cd D:\new-location\perfx-studio
  npm install --production
  pm2 start pm2.config.js
```

All historical data is preserved. No export/import step needed — the `.db` file is self-contained.

### Maintenance

#### Routine (no action needed)
SQLite is self-maintaining for this scale. No vacuum, no index rebuild, no tuning required during normal operation.

#### Backup (recommended: weekly)
The database is a single file. Back it up by copying it:
```
# Windows scheduled task (weekly)
copy "C:\perfx-studio\data\analytics.db" "C:\backups\analytics-%DATE%.db"

# Or include it in your existing server backup process
```

A backup of the `.db` file is a complete backup — no dump/restore process.

#### Archiving old data (recommended: after 2 years)
When the database grows large (after 2+ years), archive old records:
```
# Via admin endpoint (to be built):
POST /admin/archive?before=2024-01-01
  → moves rows older than the date to data/analytics-archive-2024.db
  → runs VACUUM on main DB to reclaim space

# Or manually with SQLite CLI:
sqlite3 data/analytics.db
> DELETE FROM conversions WHERE started_at < '2024-01-01';
> VACUUM;
> .quit
```

#### Data retention policy (recommended)
Set a retention period in `pm2.config.js`:
```javascript
env: {
  ANALYTICS_RETENTION_DAYS: 730   // keep 2 years; 0 = keep forever
}
```
The server auto-deletes records older than this on startup.

#### Viewing raw data (optional, for ad-hoc queries)
Download **DB Browser for SQLite** (free, at sqlitebrowser.org) — open `data/analytics.db` directly. Write SQL queries, export to CSV, no server changes needed.

---

## 4. Admin Access — How It Works

### Configuration

Add to `pm2.config.js`:
```javascript
env: {
  ADMIN_TOKEN: "your-secret-token-here"   // choose any strong password
}
```

### Access

Admin opens the dashboard in a browser:
```
http://your-server:3000/admin?token=your-secret-token-here
```

Or bookmark it — the token is in the URL. Users who visit `/admin` without the token get a plain `404 Not Found` — identical to any other missing page. No hint that an admin panel exists.

### Routes (all require valid ADMIN_TOKEN)

| Route | Method | Returns |
|-------|--------|---------|
| `/admin` | GET | HTML dashboard (full report UI) |
| `/admin/api/stats` | GET | JSON summary: totals, rates, top tools, top machines |
| `/admin/api/events` | GET | JSON paginated event list (filters: date, tool, result, hostname) |
| `/admin/download/csv` | GET | Streaming CSV — all data or filtered by date range |
| `/admin/download/json` | GET | Full JSON export |
| `/admin/download/csv?from=2026-07-01&to=2026-07-31` | GET | Monthly CSV for management |

---

## 5. Admin Dashboard — What the Admin Sees

### Summary Cards (top of page)

```
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Total           │  │ Success Rate    │  │ Unique Machines │  │ Avg Duration    │
│ 847             │  │ 96.2%           │  │ 38              │  │ 6.2 sec         │
│ conversions     │  │ 815 ok / 32 fail│  │ this month      │  │ this month      │
└─────────────────┘  └─────────────────┘  └─────────────────┘  └─────────────────┘
```

Time filter toggle: **Last 7 days / Last 30 days / Last 90 days / All time / Custom range**

### Charts

**Tool Usage (bar chart)**
```
Script Studio    ████████████████████  44%  (373)
Converter        ████████████          27%  (228)
JMeter           ████████              18%  (152)
Recorder         ████                  11%   (94)
```

**Protocol Split (donut)**
```
DevWeb JS    58%
VuGen C      42%
```

**Conversions Per Day (line chart)**
```
Daily volume over selected period — shows usage trends,
peaks on certain days, drops on weekends/holidays
```

**Peak Hours Heatmap**
```
Hour →  08  09  10  11  12  13  14  15  16  17
Mon  |   1   5  12   8   3   2   9  11   6   2
Tue  |   2   8  18  15   4   3  14  16   8   3
Wed  |   1   6  11  14   5   4  12  13   5   2
Thu  |   2   7  16  12   4   3  11  14   7   1
Fri  |   1   4   9   8   2   1   7   8   3   0

(darker = more conversions — shows when team is most active)
```

### Top Machines Table

| Machine | IP | Device ID | Conversions | Success | Last Seen |
|---|---|---|---|---|---|
| VCSE-PERF-044 | 10.20.5.44 | a3f7c2b1 | 62 | 98% | Today 14:23 |
| AVD-PERF-023 | 10.20.6.23 | b8d2e941 | 48 | 95% | Today 11:07 |
| CITRIX-FARM-02 | 10.20.1.10 | multiple | 89 | 94% | Today 15:44 |

*(Citrix shows multiple device IDs under the same IP — each represents a separate user session)*

### Most Used Files

| Filename | Extension | Times Uploaded | Avg Size | Avg Duration |
|---|---|---|---|---|
| checkout-journey.har | .har | 23 | 18 MB | 8.4s |
| mobile-banking.postman_collection.json | .json | 18 | 2.1 MB | 1.8s |
| load-test-full.jmx | .jmx | 14 | 5.3 MB | 6.2s |

### Detailed Event Log (filterable)

All conversions, reverse chronological. Filters: date range, tool, protocol, result, hostname/IP search.

```
14:23  VCSE-PERF-044  Chrome/Win11  Studio    VuGen C   checkout.har     18MB  8.4s  ✅
14:11  AVD-PERF-023   Chrome/Win11  Converter DevWeb    orders.json       2MB  1.2s  ✅
13:55  10.20.5.91     Edge/Win10    JMeter    VuGen C   load-test.jmx     5MB  --    ❌ timeout
13:42  VCSE-PERF-012  Chrome/Win11  Recorder  DevWeb    session.har      12MB  5.1s  ✅
```

Click any row → expand to see full detail (all fields including screen resolution, timezone, etc.)

### Download Buttons

```
[ Download Full CSV ]   [ Download This Month ]   [ Download JSON ]
```

---

## 6. What You Can Show Management

With this data you can present:

- **"In July, the team made 847 conversions with a 96% success rate"**
- **"Script Studio is the most adopted tool (44% of all conversions)"**
- **"38 unique machines used the tool — good adoption across the team"**
- **"Peak usage: Tuesday–Thursday, 10–11am (team scripts after Monday planning)"**
- **"Average conversion time: 6.2 seconds — consistent performance"**
- **"3 timeout failures — all were HAR files over 150MB (user education opportunity)"**
- **"VuGen C adoption growing: 42% of conversions vs 31% last quarter"**
- **"Top 3 files converted repeatedly: same journeys being refined by multiple team members"**

---

## 7. Privacy & Security

- **IP addresses are collected** — standard for internal operational tools. Document in SECURITY.md.
- **No personal names captured** — machine hostname and device ID only.
- **Device ID is auto-generated** — not linked to any directory or HR system.
- **Data never leaves the server** — analytics.db stays on-premise.
- **Admin route is invisible** — 404 to anyone without the token.
- **Data stored securely** — file permissions on `data/` directory; accessible only by the service account running Node.js.
- **Recommended addition** — one line in the Help section: *"This tool records anonymous usage data (machine, tool used, file size, timing) for internal operational reporting."*

---

## 8. New Files to Create

| File | Purpose |
|------|---------|
| `src/analytics/db.js` | SQLite wrapper — open DB, create schema, insert event, query helpers |
| `src/analytics/collector.js` | Build event object from req + result, call db.js |
| `src/analytics/reports.js` | Query functions for stats, events, top machines, etc. |
| `src/web/public/analytics-device.js` | Client-side: generate/read device ID + fingerprint, send to server |
| `src/web/views/admin.ejs` | Admin dashboard HTML (self-contained, no CDN) |

### Files to Modify

| File | Change |
|------|--------|
| `src/web/server.js` | Add admin routes; call collector in convert handlers |
| `src/web/views/index.ejs` | Load `analytics-device.js` + expose `window._perfxFingerprint` |
| `pm2.config.js` | Add `ADMIN_TOKEN` and `ANALYTICS_RETENTION_DAYS` env vars |
| `.gitignore` | Add `data/` directory |
| `Docs/SECURITY.md` | Add "Data Collected" section |
| `Docs/OPERATIONS.md` | Add "Analytics DB" maintenance section |

---

## 9. Implementation Phases

### Phase 1 — Data Collection (backend + client fingerprint)
- Install `better-sqlite3` package
- Create `data/` directory + `analytics.db` schema on server start
- Add `analytics-device.js` to `index.ejs` (device ID + fingerprint)
- Instrument `/converter/convert` and `/converter/convert-jmx` in server.js
- Async reverse DNS hostname lookup (non-blocking)
- All data flowing into DB

### Phase 2 — Admin API
- `ADMIN_TOKEN` middleware
- `/admin/api/stats` — summary JSON
- `/admin/api/events` — paginated + filtered
- `/admin/download/csv` and `/admin/download/json`

### Phase 3 — Admin Dashboard UI
- `admin.ejs` — self-contained HTML with inline CSS/JS
- Summary cards with time-range toggle
- Bar charts (Canvas API, no external library)
- Heatmap (HTML table with CSS colour scale)
- Filterable event log table with pagination
- Download buttons wired to Phase 2 endpoints

### Phase 4 — Polish & Documentation
- Data retention auto-cleanup on server start
- `SECURITY.md` + `OPERATIONS.md` updates
- `.gitignore` update
- `memory/state.md` and `memory/architecture.md` updates

---

## 10. Dependencies to Add

| Package | Version | Purpose |
|---------|---------|---------|
| `better-sqlite3` | `^9.x` | Fast synchronous SQLite for Node.js |
| `ua-parser-js` | `^1.x` | Parse User-Agent string → browser name + OS name |

Both are small, well-maintained, zero native dependencies on Windows.

---

## 11. Configuration Summary

All settings in `pm2.config.js` (or environment variables):

| Variable | Default | Description |
|----------|---------|-------------|
| `ADMIN_TOKEN` | *(required)* | Secret for admin dashboard access |
| `ANALYTICS_DB_PATH` | `./data/analytics.db` | Path to SQLite file |
| `ANALYTICS_RETENTION_DAYS` | `730` | Delete records older than N days (0 = keep forever) |

---

## 12. Timeline Estimate

| Phase | Effort | What gets delivered |
|-------|--------|---------------------|
| Phase 1 | ~3 hours | Data silently flowing into DB |
| Phase 2 | ~2 hours | Admin API endpoints working |
| Phase 3 | ~4 hours | Full visual dashboard |
| Phase 4 | ~1 hour | Docs + cleanup |
| **Total** | **~10 hours** | **Complete analytics + reporting system** |

---

*Confirm to proceed → implementation starts with Phase 1.*
