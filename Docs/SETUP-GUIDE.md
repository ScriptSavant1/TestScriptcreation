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

## Quick Reference

| Task | Command |
|------|---------|
| Start web GUI | `npm run web` |
| CLI convert (DevWeb) | `node src/cli.js convert -i file.json -o ./out` |
| CLI convert (VuGen C) | `node src/cli.js convert -i file.json --protocol web-http -o ./out` |
| Get latest code | `git pull && npm install --production` |
| Run tests | `npm test` |

---

*Repo: https://github.com/ScriptSavant1/TestScriptcreation*
