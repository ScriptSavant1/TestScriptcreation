# PerfX Studio — Local Setup Guide

This guide walks you through setting up PerfX Studio on your Windows machine from scratch.

---

## What PerfX Studio Does

A four-tool platform that generates production-ready LoadRunner VuGen scripts from any starting point:

| Tool | Input | Output |
|------|-------|--------|
| Postman/Bruno Converter | Postman v2.1 JSON, Bruno JSON/YAML/.bru | DevWeb JS or VuGen C script |
| JMeter Converter | Apache JMeter `.jmx` file | DevWeb JS or VuGen C script + Workload Excel |
| Recorder | Browser HAR recording (DevTools export) | DevWeb JS or VuGen C script |
| Script Studio | HAR file(s) with correlation engine | DevWeb JS or VuGen C script |

Access all four tools through a browser at `http://localhost:3000/converter`.

---

## Step 1 — Install Git

If you do not already have Git installed:

1. Download from **https://git-scm.com/download/win**
2. Run the installer — accept all defaults
3. Verify: open **Command Prompt** and run:
   ```
   git --version
   ```
   Expected output: `git version 2.x.x`

---

## Step 2 — Install Node.js

The tool requires **Node.js version 14 or newer** (v20 LTS recommended).

1. Download the **LTS** installer from **https://nodejs.org**
2. Run the installer — accept all defaults (includes npm automatically)
3. Verify: open a **new** Command Prompt and run:
   ```
   node --version
   npm --version
   ```
   Expected output: `v20.x.x` and `10.x.x` (or similar — any v14+ is fine)

---

## Step 3 — Clone the Repository

Open **Command Prompt** or **PowerShell** and run:

```
git clone https://github.com/ScriptSavant1/TestScriptcreation.git
```

Then enter the project folder:

```
cd TestScriptcreation
```

> **Note:** If your organisation uses SSH keys for GitHub, use the SSH URL instead:
> `git clone git@github.com:ScriptSavant1/TestScriptcreation.git`

---

## Step 4 — Install Dependencies

Inside the project folder, run:

```
npm install --production
```

This downloads all required packages into a `node_modules/` folder.
It takes about 30–60 seconds on first run.

> `--production` skips test/lint tools — sufficient for day-to-day use.
> If you plan to run tests or lint, use `npm install` (without the flag) instead.

---

## Step 5 — Start the Web GUI

```
npm run web
```

You should see:

```
  Converter UI  →  http://localhost:3000/converter
```

Open that URL in your browser. The tool is ready to use.

**To stop the server:** press `Ctrl + C` in the terminal.

---

## Using the Web GUI

**URL:** `http://localhost:3000/converter`

The home page shows all four tools as clickable cards. Click any card to open that tool.

### Postman / Bruno Converter
Click **Postman / Bruno Converter** on the home page (or **Converter** in top nav → **Postman / Bruno** tab).

1. Choose output protocol: **DevWeb** (JavaScript) or **Web HTTP/HTML** (VuGen C)
2. Upload your collection file (`.json`, `.yml`, `.bru`) and optionally an environment file
3. Configure options (think time, script mode, correlation toggles)
4. Click **Convert** — a ZIP downloads automatically
5. Open the `.usr` file in VuGen, or upload to LoadRunner Enterprise

### JMeter Converter
Click **JMeter Converter** on the home page (or **Converter** in navigation → **JMeter (.jmx)** tab).

1. Upload your `.jmx` file; optionally upload CSV data files and certificate files
2. Choose output protocol and script mode (single or per-thread-group)
3. Click **Convert** — ZIP includes scripts + Workload Model Excel

### Recorder
Click **Recorder** in the home page or top navigation.

1. Follow Bookmarklet Setup instructions to install the browser helper (one-time)
2. Open your application in a browser, press F12 → Network tab
3. Perform your complete user journey
4. Export HAR from DevTools (download icon in the Network tab)
5. Upload the `.har`, filter domains, set transactions, click **Generate Script**

### Script Studio (HAR Correlation Engine)
Click **Script Studio** in the home page or top navigation.

1. Upload 1 HAR (pattern-based) or 2 HARs (diff-based for deepest correlation)
2. Click **Analyze** — Correlation Advisor lists all found dynamic values
3. Review, accept correlations, click **Apply & Regenerate**
4. Download the ZIP and open in VuGen

---

## Using the Command Line (CLI)

If you prefer the command line over the browser:

**Basic conversion:**
```
node src/cli.js convert -i MyCollection.json -o ./output
```

**Convert to VuGen Web HTTP/HTML instead of DevWeb:**
```
node src/cli.js convert -i MyCollection.json --protocol web-http -o ./output
```

**With a Postman environment file:**
```
node src/cli.js convert -i MyCollection.json -e MyEnvironment.json -o ./output
```

**All options:**
```
node src/cli.js convert --help
```

---

## Pulling Latest Changes

When a teammate pushes an update, get it with:

```
git pull
npm install --production
```

Then restart the server (`npm run web`).

---

## Troubleshooting

**Port 3000 already in use**
Another app is using port 3000. Either stop that app, or start the converter on a different port:
```
PORT=3001 npm run web
```
Then open `http://localhost:3001/converter`.

**`node` or `npm` not found after installing Node.js**
Close and reopen your terminal — the PATH update only applies to new windows.

**`npm install` fails with permission errors**
Run Command Prompt as Administrator, or check your corporate proxy settings:
```
npm config set proxy http://your-proxy:8080
npm config set https-proxy http://your-proxy:8080
npm install --production
```

**Blank page or 404 in the browser**
Make sure the server is still running (check the terminal). If it crashed, restart with `npm run web` and check the error message.

**ZIP downloads but VuGen cannot open the script**
- DevWeb scripts: open the `.usr` file in LRE/VuGen
- VuGen Web HTTP/HTML scripts: if the script uses JWT or DPoP, follow the 2-step setup comment at the top of `vuser_init.c` (rename `lre-utils.dat` → `lre-utils.js` and re-add it in VuGen Extra Files)

---

## Folder Structure (reference)

```
TestScriptcreation/
├── src/
│   ├── cli.js                  CLI entry point
│   ├── web/server.js           Web GUI server
│   ├── generators/
│   │   ├── devweb/             DevWeb (JavaScript) script generator
│   │   └── vugen/              VuGen Web HTTP/HTML (C) script generator
│   └── tools/                  Converter orchestration
├── jwt-helper.js               JWT signing for DevWeb scripts
├── lre-utils.dat               JWT/DPoP crypto library for VuGen scripts
├── Docs/                       Documentation
└── package.json
```

---

## Capacity & Scaling — How Many Users Can It Handle?

### Short answer

| Scenario | Result |
|----------|--------|
| 60–70 users working throughout the day (realistic) | ✅ Handles comfortably |
| 60–70 users all converting at exactly the same second | ⚠️ First 8 convert; rest receive "server busy" and retry |
| Very large files (100 MB+ JMX or collection) | ✅ Supported; 120-second timeout per conversion |

### Why it works for 60–70 users

A typical workflow is: export collection (5 min) → configure options (2 min) → click Convert (5–20 sec) → review output (10 min). Of 70 users, at any given moment only **5–10 are in the middle of a conversion** — everyone else is configuring, reading output, or working in VuGen. The tool is not under significant load for the other 99% of each user's session.

### How it handles a burst (everyone clicks Convert at once)

The server limits simultaneous conversions to **8 by default** (set via `MAX_CONCURRENT_CONVERSIONS` environment variable). If more than 8 arrive at the same time:
- The first 8 start immediately.
- Any beyond 8 receive an immediate `HTTP 503 server_busy` response.
- The UI can display: *"Server is busy — please click Convert again in a few seconds."*
- Users retry; by the time they click again, a slot is almost certainly free.

This is far better than the alternative (all 70 pile up and each waits 10 minutes).

### Recommended server specification for 60–70 users

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| CPU | 4 cores | 8 cores |
| RAM | 8 GB | 16 GB |
| OS | Windows Server 2019+ or Ubuntu 20.04+ | Same |
| Node.js | 20 LTS | 20 LTS or 22 LTS |
| Disk (temp) | 50 GB free | 100 GB free (for temp conversion files) |

### Monitoring live load

Once the server is running, visit:
```
http://your-server:3000/converter/status
```
This returns a live snapshot:
```json
{
  "status": "ok",
  "activeConversions": 2,
  "maxConcurrent": 8,
  "pendingDownloads": 5,
  "memory": { "heapUsedMB": 312, "heapTotalMB": 512, "rssMB": 480 },
  "uptime": "3600s"
}
```
If `activeConversions` is frequently at `maxConcurrent`, increase `MAX_CONCURRENT_CONVERSIONS` (up to the number of physical CPU cores) or move to a larger server.

### Tuning the concurrency limit

Set the environment variable before starting the server:

```
# Windows (Command Prompt)
set MAX_CONCURRENT_CONVERSIONS=12
npm run web

# Linux / macOS
MAX_CONCURRENT_CONVERSIONS=12 npm run web

# PM2 (edit pm2.config.js, then restart)
# Change: MAX_CONCURRENT_CONVERSIONS: 12
pm2 restart perfx-studio
```

Rule of thumb: set to the number of **physical** CPU cores (not logical/hyperthreaded). The tool is CPU-intensive during parsing; hyperthreads do not help here.

---

## Production Deployment with PM2

For a permanent server deployment (as opposed to development), use PM2 — a process manager that provides auto-restart on crash, memory limit enforcement, log rotation, and startup scripts.

### Step 1 — Install PM2 (one-time, globally)

```
npm install pm2 -g
```

### Step 2 — Start PerfX Studio via PM2

```
pm2 start pm2.config.js
```

### Step 3 — Verify it is running

```
pm2 list
pm2 logs perfx-studio
```

### Step 4 — Auto-start on server reboot

```
pm2 save
pm2 startup
```
Follow the instruction printed by `pm2 startup` — it generates a command you run once as Administrator/root to register the service.

### Day-to-day PM2 commands

| Task | Command |
|------|---------|
| Start | `pm2 start pm2.config.js` |
| Stop | `pm2 stop perfx-studio` |
| Restart after code update | `git pull && npm install --production && pm2 restart perfx-studio` |
| View live logs | `pm2 logs perfx-studio` |
| Live dashboard (CPU, RAM, restarts) | `pm2 monit` |
| Check status | `pm2 list` |

### Important: do NOT use more than 1 PM2 instance

The pm2.config.js is set to `instances: 1`. Do not change this to `max` or any number greater than 1 without first moving download tokens to a shared store. The current architecture stores download tokens in process memory — if you run 4 PM2 workers, a user's Convert request might be handled by worker 1 but their Download request might go to worker 2, which does not have the token, causing "download expired" errors.

If you need to scale beyond a single core, contact the performance engineering team lead — it requires a small architectural change (shared Redis token store).

---

## Quick Reference

| Task | Command |
|------|---------|
| Start (development) | `npm run web` |
| Start (production) | `pm2 start pm2.config.js` |
| Restart after update | `pm2 restart perfx-studio` |
| View status | `http://your-server:3000/converter/status` |
| CLI convert (DevWeb) | `node src/cli.js convert -i file.json -o ./out` |
| CLI convert (VuGen C) | `node src/cli.js convert -i file.json --protocol web-http -o ./out` |
| Get latest code | `git pull && npm install --production` |
| Run tests | `npm test` |

---

*Repo: https://github.com/ScriptSavant1/TestScriptcreation*
