# LRE Toolkit — User Guide

> For performance engineers and testers. Step-by-step instructions for all three tools.
> No coding knowledge required.

---

## Contents

1. [What is this toolkit?](#1-what-is-this-toolkit)
2. [Getting started](#2-getting-started)
3. [Output formats explained](#3-output-formats-explained)
4. [Tool 1 — Converter](#4-tool-1--converter)
   - [Postman / Bruno collections](#postman--bruno-collections)
   - [JMeter scripts (.jmx)](#jmeter-scripts-jmx)
5. [Tool 2 — Recorder](#5-tool-2--recorder)
6. [Tool 3 — Script Studio](#6-tool-3--script-studio)
7. [Opening your script in VuGen](#7-opening-your-script-in-vugen)
8. [FAQ](#8-faq)
9. [Glossary](#9-glossary)

---

## 1. What is this toolkit?

This is a set of three browser-based tools that generate LoadRunner VuGen scripts automatically — without writing code from scratch.

LoadRunner Enterprise (LRE) uses **VuGen** to simulate real users under load. VuGen scripts describe what those simulated users do: log in, navigate pages, submit forms, call APIs. Writing these scripts manually is time-consuming and error-prone. This toolkit generates them from files you already have.

**All three tools share one rule: nothing is stored on the server.** Every file you upload is processed in RAM and immediately discarded. Only the downloaded ZIP leaves the server. Your data is private.

---

## 2. Getting started

Open the portal at: `http://<your-server>/converter`

The top navigation bar has five sections:

| Tab | Purpose |
|-----|---------|
| **Home** | Overview and tool selector |
| **Converter** | Convert Postman, Bruno, or JMeter files |
| **Recorder** | Convert a HAR file recorded in your browser |
| **Script Studio** | Generate correlated scripts from 1 or 2 HAR files |
| **Help** | Full documentation (inline) |

Click any tab or click a tool card on the Home page to get started.

---

## 3. Output formats explained

All three tools can generate scripts in either of two formats. Choose one before converting.

### 🟦 DevWeb · JavaScript
- Scripts are written in JavaScript and run in a Node.js-like runtime
- Main output file: `main.js`
- Recommended for new projects on LRE 2021 or later
- Config files: `rts.yml`, `scenarios.yml`, `collection_data.csv`

### 🟧 Web HTTP/HTML · C
- Scripts are written in C using classic VuGen functions (`web_url`, `web_custom_request`)
- Main output file: `Action.c`, plus `vuser_init.c`, `vuser_end.c`, `globals.h`
- Compatible with all LRE versions
- Config files: `default.cfg`, `ParameterFile.prm`, `collection_data.dat`

**Not sure which to choose?** Ask your LRE administrator which protocol your project uses. When in doubt, choose **DevWeb**.

---

## 4. Tool 1 — Converter

Use the Converter when you have an existing **Postman collection**, **Bruno collection**, or **JMeter script (.jmx)** and want to convert it into a VuGen script.

Navigate to: **Converter** tab → choose sub-tab **Postman / Bruno** or **JMeter (.jmx)**

---

### Postman / Bruno Collections

#### Supported file formats

| Format | How to get it |
|--------|--------------|
| Postman v2.1 JSON | Postman → Collections → ⋯ → Export → Collection v2.1 |
| Bruno JSON (`.json`) | Bruno → Export |
| Bruno YAML (`.yml` / `.yaml`) | Bruno YAML format files |
| Bruno folder | Directory of `.bru` files (zip the folder and upload) |
| Single `.bru` file | A single Bruno request file |

#### Environment file (optional)
An environment file fills in variable values — base URLs, API keys, usernames. Upload it alongside your collection.

| Format | Source |
|--------|--------|
| Postman environment JSON | Postman → Environments → Export |
| Bruno environment file | Bruno environment export |

#### Step-by-step

1. Click **Converter** in the nav → select **Postman / Bruno** tab
2. Choose output format: **DevWeb** or **Web HTTP/HTML**
3. Choose mode: **Single script** (all requests in one script) or **Multi-script** (one script per folder)
4. Drag and drop your collection file into the **Collection File** drop zone, or click to browse
5. Optionally drag your environment file into the **Environment File** drop zone
6. Configure options:
   - **Think Time** — pause between requests (seconds). Recommended: 1–3s
   - **Transactions** — wraps each request in `lr_start/end_transaction`. Keep enabled
   - **Correlation** — auto-detects and extracts dynamic values (tokens, session IDs). Keep enabled
   - **Parameterization** — replaces hard-coded credentials with parameter files. Keep enabled
   - **Authentication** — generates auth code for OAuth2, JWT, API Key etc. Keep enabled
   - **Comments** — adds explanatory comments to the generated script
7. Click **Convert**
8. When complete: review the analysis summary, then click **Download ZIP**
9. Extract the ZIP and open the `.usr` file in VuGen

---

### JMeter Scripts (.jmx)

#### What you need

| File | Required? | Notes |
|------|-----------|-------|
| `.jmx` file | Required | Export from Apache JMeter: File → Save Test Plan |
| CSV files | If used | Upload any CSV files referenced by CSVDataSet elements |
| Certificate files | If used | Client certificates used for authentication |

#### Step-by-step

1. Click **Converter** → select **JMeter (.jmx)** tab
2. Choose output format: **DevWeb** or **Web HTTP/HTML**
3. Choose mode: **Single script** or **Multi-script** (one script per thread group)
4. Drag your `.jmx` file into the **JMX File** drop zone
5. If your script uses CSV data files, drag them into the **CSV Files** drop zone (up to 30 files)
6. If your script uses certificates, drag them into the **Certificate Files** drop zone
7. Configure options (same as above)
8. Click **Convert JMeter Script**
9. Download and open the ZIP in VuGen

> **Note on multi-script mode:** Each JMeter Thread Group becomes its own VuGen script. setUp and tearDown Thread Groups map to `initialize()`/`finalize()` in DevWeb or `vuser_init.c`/`vuser_end.c` in Web HTTP/HTML.

---

## 5. Tool 2 — Recorder

Use the Recorder when **VuGen's built-in recording does not work on your machine** (common on VCSE machines where proxy installation is blocked by policy).

This tool converts a **HAR file** — a recording of browser network traffic — into a VuGen script.

Navigate to: **Recorder** tab

### What is a HAR file?

A HAR (HTTP Archive) file captures every network request your browser makes during a session. Your browser's Developer Tools (F12) can export one. It contains all URLs, headers, request bodies, and response data.

### One-time setup: install the bookmarklet

The bookmarklet marks the start of your recording session so the Recorder can identify your user journey correctly.

1. Open the **Recorder** tab
2. Follow the **Bookmarklet Setup** instructions in the welcome screen
3. Drag the bookmarklet link into your browser's bookmarks bar
4. You only need to do this once per browser

### Recording your user journey

1. Open your browser and navigate to the application
2. Press **F12** to open Developer Tools → go to the **Network** tab
3. Ensure the recording button (red circle) is active — click it if not
4. Click the bookmarklet in your bookmarks bar to mark the start of your journey
5. Perform your complete user journey (login, navigate, submit forms)
6. In DevTools Network tab, click the **Export HAR** button (download icon) and save the `.har` file

### Converting the HAR file

1. Drag the `.har` file into the Recorder's drop zone, or click to browse
2. The request table will populate with all captured requests
3. **Filter domains:** uncheck any domains you don't want in your script (CDNs, analytics, fonts, telemetry)
4. **Set transactions:** drag request rows to group them into named transactions
5. Choose output format: **DevWeb** or **Web HTTP/HTML**
6. Click **Generate Script** (or the format card if prompted)
7. Click **Download ZIP**
8. Extract and open in VuGen

> **Tip:** For more complete correlation, record the same journey **twice** (with different test data) and use both HAR files in **Script Studio** instead.

---

## 6. Tool 3 — Script Studio

Use Script Studio when you need **correlation** built into your script — so it works correctly on every load test run, not just the first time.

Navigate to: **Script Studio** tab

### What is correlation?

When you log into a web application, the server returns a **session token** or **access token**. Every subsequent request must include this token. If your script has the token hard-coded from your recording session, it will fail when run again because the server issues a new token each time.

**Correlation** means the script automatically captures this token from the server's response and passes it forward — exactly like a real browser does.

Without correlation, your script will fail on replay. Script Studio generates all the extraction and substitution code automatically.

### 1 HAR vs 2 HARs

| | 1 HAR | 2 HARs (recommended) |
|--|-------|---------------------|
| **Method** | Pattern-based analysis | Diff-based comparison |
| **How it works** | Finds values that look dynamic (UUIDs, long random strings, timestamps) | Compares two recordings and finds every value that changed between runs |
| **Quality** | Good for simple apps | Best for any app with login, tokens, sessions |
| **Best use** | Quick result, simpler apps | Production-quality scripts |

**To use 2 HARs:** record the exact same user journey twice using different test credentials or data sets (e.g. user1@company.com then user2@company.com). The tool finds everything that changed — those are the values that must be correlated.

### Step-by-step

1. Open **Script Studio** from the navigation
2. Drag your **first HAR file** into the **Recording 1** drop zone
3. For 2-HAR mode: drag a second HAR into the **Recording 2** drop zone
4. Choose output format: **DevWeb** or **Web HTTP/HTML**
5. Click **Analyze**
6. Review the correlation and parameterization results
7. Click **Download ZIP**
8. Extract and open in VuGen

---

## 7. Opening your script in VuGen

All three tools produce a ZIP file containing a complete VuGen script package.

1. Download and extract the ZIP to a folder on your machine
2. In VuGen: **File → Open** → navigate to the extracted folder → select the `.usr` file
3. VuGen loads the script with all transactions, correlations, and parameters ready
4. Run a single-user trial to verify the script replays correctly before adding load

---

## 8. FAQ

**Which output format should I choose?**
Ask your LRE administrator or project lead. For new projects on LRE 2021+, use DevWeb. For existing projects or older LRE, use Web HTTP/HTML.

**My download link didn't work / ZIP was empty.**
Download links are single-use and expire after 5 minutes. Go back and run the conversion again — it only takes seconds.

**My script replays but fails with "invalid token" or "session expired".**
A value needs to be correlated. Record the same journey twice and use Script Studio with both HAR files. The diff-based analysis will find the exact values causing the failure.

**The Converter produced a script but it looks incomplete.**
Check you uploaded the right format (Postman v2.1, not v2.0). For JMeter, ensure all referenced CSV files were uploaded alongside the `.jmx`.

**Are my files stored anywhere?**
No. All processing happens in-memory. Nothing is written to disk. Nothing persists between requests.

**Can I use this tool offline / on an internal network?**
Yes, the tool is deployed on your IIS server and works entirely within your internal network. No internet connection is required for conversion (fonts are loaded from Google Fonts if available, but this is cosmetic only).

---

## 9. Glossary

| Term | Meaning |
|------|---------|
| **VuGen** | Virtual User Generator — the tool used to create and edit LoadRunner scripts |
| **LRE / LoadRunner Enterprise** | The performance testing platform this toolkit generates scripts for |
| **DevWeb** | Modern LoadRunner protocol — scripts in JavaScript, main file is `main.js` |
| **Web HTTP/HTML** | Classic LoadRunner protocol — scripts in C, main file is `Action.c` |
| **HAR file** | HTTP Archive — a JSON recording of all browser network activity during a session |
| **Correlation** | Capturing a dynamic server value (token, ID) and reusing it in later requests |
| **Parameterization** | Replacing a hard-coded value (username/password) with a variable fed from a data file |
| **Transaction** | A named timing boundary in a script — LRE measures response time per transaction |
| **Thread Group** | A JMeter concept for a group of virtual users running a scenario — maps to a VuGen script |
| **CSVDataSet** | JMeter feature for reading test data from a CSV file at runtime |
| **JWT** | JSON Web Token — a signed token used for authentication, auto-detected and handled |
| **OAuth2** | An authorisation framework — access tokens are auto-correlated by the Converter |
| **VCSE** | Virtual Client Scripting Environment — the machine type where VuGen recording is restricted |
