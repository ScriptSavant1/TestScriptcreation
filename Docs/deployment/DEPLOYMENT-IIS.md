# PerfX Studio -- IIS Deployment Guide

**Version:** 2.8.0 | **Date:** July 2026
**Platform:** Windows Server 2019 or 2022 | IIS 10 | Node.js 18 LTS | iisnode 0.2.26

> **Visual guide available:** A formatted version with IIS dialog mockups is published alongside this file.

---

## Before You Start -- Prerequisites Checklist

Confirm all items below before starting. Every component must be installed on the **server**, not your local PC.

| # | Component | Where to get it |
|---|-----------|----------------|
| [ ] | Windows Server 2019 or 2022 with IIS enabled | Windows Features |
| [ ] | Node.js **18 LTS** (not 20 or 22) | nodejs.org -- choose "18.x.x LTS" |
| [ ] | IIS URL Rewrite Module 2.1 | Microsoft IIS downloads page -- `rewrite_amd64_en-US.msi` |
| [ ] | iisnode v0.2.26 | GitHub: Azure/iisnode Releases -- `iisnode-full-v0.2.26-x64.msi` |
| [ ] | PerfX Studio deployment package (ZIP) | Provided by your team |
| [ ] | Administrator access on the server | Required for all steps |

---

## Files and Folders to Deploy

The application is deployed to: `D:\MSINetData\WWW\converter\`

This folder sits inside your IIS website root (`D:\MSINetData\WWW\`) as the `converter` application.

### Copy these files and folders

```
D:\MSINetData\WWW\converter\
|
+-- src\                        <- entire folder, required
|   +-- analytics\
|   +-- analyzers\
|   +-- converters\
|   +-- generators\
|   +-- lib\
|   +-- parsers\
|   +-- tools\
|   +-- web\
|       +-- public\
|       +-- views\
|
+-- app.js                      <- IIS entry point (iisnode starts here)
+-- web.config                  <- IIS routing rules
+-- package.json                <- dependency list
+-- package-lock.json           <- exact dependency versions
|
+-- DevWebSdk.d.ts              <- packaged into generated scripts
+-- jwt-helper.js               <- packaged into generated scripts
+-- jsrsasign.js                <- JWT cryptography library
+-- lre-utils.js                <- LRE utility functions
+-- lre-utils.dat               <- LRE utils (AV-bypass format)
+-- lre-crypto.js               <- cryptography helpers
+-- dpop.js                     <- DPoP OAuth support
+-- dpop-helper.js              <- DPoP helpers
+-- dpop-service.js             <- DPoP service
+-- transport.pem               <- transport certificate
```

### Do NOT copy these

| Path | Why not |
|------|---------|
| `node_modules\` | Run `npm install` on the server instead -- never copy this folder |
| `.env` | Create fresh on the server (contains password) |
| `.git\` | Source control history -- not needed at runtime |
| `data\` | Auto-created by the app on first run |
| `Docs\`, `*.md`, `*.pdf`, `*.pptx` | Documentation only |
| `pm2.config.js` | PM2 config -- not used with IIS |
| `collection-examples\`, `examples\` | Sample files -- not needed |

---

## Step 1 of 11 -- Install Node.js 18 LTS

1. On the server, open a browser and go to **nodejs.org**
2. Download the installer labelled **"18.x.x LTS"** (green button). Do not choose version 20 or 22.
3. Run the installer as **Administrator**. Accept all defaults.
4. Verify in **Command Prompt (as Administrator)**:

```cmd
C:\> node --version
Should print:  v18.x.x

C:\> npm --version
Should print:  9.x.x or 10.x.x
```

> **Success:** Both commands print a version number. If you see "'node' is not recognized", close and reopen Command Prompt, then try again.

---

## Step 2 of 11 -- Install IIS URL Rewrite Module 2.1

Without this module, every page on the site returns a 404 error.

1. Search the web for **"IIS URL Rewrite 2.1 download"** and go to the Microsoft IIS downloads page
2. Download the **x64 English** installer (`rewrite_amd64_en-US.msi`)
3. Run the installer as **Administrator** -- accept the license and click **Install**
4. After installation, restart IIS:

```cmd
C:\> iisreset
```

---

## Step 3 of 11 -- Install iisnode

iisnode bridges IIS and Node.js, letting IIS host Node.js applications.

1. Go to **github.com/Azure/iisnode** -> click **Releases**
2. Download **iisnode-full-v0.2.26-x64.msi**
3. Run the installer as **Administrator**, accept all prompts

**How to confirm it worked:**
Open IIS Manager -> click the server name in the left panel -> double-click **Handler Mappings** -> look for an entry named **iisnode** in the list.

---

## Step 4 of 11 -- Copy Application Files to the Server

> **If you have already copied the files to `D:\MSINetData\WWW\converter\`, skip to Step 5.**

1. Open **Command Prompt as Administrator**
2. If the folder does not exist yet, create it:

```cmd
C:\> mkdir D:\MSINetData\WWW\converter
```

3. Copy all files from the "Files to Deploy" list into `D:\MSINetData\WWW\converter\`
4. Open File Explorer and verify: `app.js`, `web.config`, and the `src` folder must be visible **directly inside** `D:\MSINetData\WWW\converter\` -- not inside a subfolder

> **WARNING:** If everything is one level too deep (e.g., `converter\converter\app.js`), move all files up one level. `app.js` and `web.config` must be at the root of `D:\MSINetData\WWW\converter\`.

---

## Step 5 of 11 -- Install Node.js Dependencies

This command downloads all libraries the application needs. It reads `package.json` and creates the `node_modules` folder automatically.

```cmd
C:\> cd D:\MSINetData\WWW\converter

D:\MSINetData\WWW\converter> npm install --production
```

Wait 1-3 minutes. At the end you will see: `added NNN packages in Xs`

> **WARNING:** Do not close the window while it runs. Many lines scroll past -- this is normal.

> **Success:** A `node_modules` folder now appears in `D:\MSINetData\WWW\converter\`. It contains hundreds of subfolders -- this is correct.

---

## Step 6 of 11 -- Create IIS Application Pool

**Navigation:** IIS Manager -> Application Pools -> Add Application Pool...

1. Open **IIS Manager** (Start -> search "IIS Manager" -> open as Administrator)
2. Click **Application Pools** in the left panel
3. In the right panel (Actions), click **Add Application Pool...**
4. Fill in exactly:

| Field | Value |
|-------|-------|
| **Name** | `perfx-studio-pool` |
| **.NET CLR Version** | `No Managed Code` |
| **Managed Pipeline Mode** | `Integrated` |
| Start application pool immediately | checked |

5. Click **OK**
6. Find **perfx-studio-pool** in the list -> right-click -> **Advanced Settings...**
7. Set these additional values and click **OK**:

| Setting | Value | Where to find it |
|---------|-------|-----------------|
| Start Mode | `AlwaysRunning` | General section |
| Idle Time-out (minutes) | `0` | Process Model section |
| Ping Enabled | `False` | Process Model section |
| Identity | `NetworkService` | Process Model section |

---

## Step 7 of 11 -- Set the Admin Dashboard Password

PerfX Studio has an Admin Dashboard showing usage analytics -- who used which tools, error counts, file history, peak times, and more. It is protected by a password set as an IIS environment variable.

> **SECURITY RULE:** Never put this password in `web.config`, `pm2.config.js`, or any file. Set it only inside IIS Manager as shown below. It will never appear in a URL or browser history.

**Navigation:** IIS Manager -> Application Pools -> perfx-studio-pool -> Advanced Settings -> Environment Variables -> [...]

1. In IIS Manager, click **Application Pools**
2. Right-click **perfx-studio-pool** -> click **Advanced Settings...**
3. Scroll to the **General** section -> find the row **Environment Variables** -> click the **[...]** button on the right side
4. The **EnvironmentVariables Collection Editor** dialog opens -- click **Add**
5. Fill in the two fields:

| Field | Value |
|-------|-------|
| **Name** | `ADMIN_TOKEN` |
| **Value** | Your chosen password (minimum 12 characters, mix letters and numbers) |

> **IMPORTANT:** The Name must be typed exactly as `ADMIN_TOKEN` -- all capitals, underscore in the middle.

6. Click **OK** to close the Collection Editor -> click **OK** to close Advanced Settings
7. Right-click **perfx-studio-pool** -> click **Recycle...** to apply the change immediately

> **Tip:** Save this password in your team's password manager. All team members use this same password to log in at `/converter/admin`. Do not share it by email.

---

## Step 8 of 11 -- Register the IIS Application

**Navigation:** IIS Manager -> Sites -> Default Web Site -> Add Application...

1. In IIS Manager, expand **Sites** in the left panel
2. Right-click **Default Web Site** -> click **Add Application...**
3. Fill in:

| Field | Value |
|-------|-------|
| **Alias** | `converter` |
| **Application Pool** | click **Select...** and choose `perfx-studio-pool` |
| **Physical Path** | `D:\MSINetData\WWW\converter` |

4. Click **OK**

> **Note:** The alias `converter` must be exactly lowercase. This is what makes the app accessible at `https://your-server/converter`. The Physical Path must point directly to the folder containing `app.js`.

---

## Step 9 of 11 -- Set File Permissions

IIS runs as **NetworkService**. It needs read access to the application folder and write access only to the iisnode log subfolder.

```cmd
REM Grant read access to the application folder
icacls "D:\MSINetData\WWW\converter" /grant "NetworkService:(OI)(CI)R"

REM Create the log folder
mkdir "D:\MSINetData\WWW\converter\iisnode"

REM Grant write access to log folder only
icacls "D:\MSINetData\WWW\converter\iisnode" /grant "NetworkService:(OI)(CI)F"
```

> **WARNING:** Do not grant write access to the entire application folder -- only the `iisnode\` subfolder needs it. This is intentional for security.

---

## Step 10 of 11 -- Test the Deployment

Open a browser and test all three URLs. All must work before going live.

**Test 1 -- Main portal:**
```
https://loadrunner.webdev.banksvcs.net/converter
```
You should see: The PerfX Studio portal page with tool cards (Postman/Bruno Converter, JMX Converter, Script Studio).

**Test 2 -- Script Studio:**
```
https://loadrunner.webdev.banksvcs.net/converter/studio
```
You should see: The VuGen Script Studio page with a "Drop a HAR file here" upload area.

**Test 3 -- Admin dashboard:**
```
https://loadrunner.webdev.banksvcs.net/converter/admin
```
You should see: A login page. Enter the password you set in Step 7. You will be redirected to the analytics dashboard.

If something does not work, see the Troubleshooting section.

---

## Step 11 of 11 -- Using the Admin Dashboard

### Logging in

1. Go to `https://loadrunner.webdev.banksvcs.net/converter/admin`
2. Enter the `ADMIN_TOKEN` password set in Step 7
3. Click **Sign In** -- you stay logged in for **8 hours**

The password never appears in the URL or browser history. All team members can log in simultaneously with the same password.

### What the dashboard shows

| Section | What it shows |
|---------|--------------|
| KPI Cards | Total conversions, success rate, error count, timeout count, average duration, unique users |
| Tool Usage chart | Which converter is used most (Postman/Bruno, JMX, Script Studio) |
| Protocol chart | DevWeb JS vs VuGen C output split |
| Success Trend | Daily pass/fail chart over the selected period |
| Usage Heatmap | Which days and hours have peak activity |
| Top Files | Most frequently converted files with size and duration |
| Event Log | Every conversion: timestamp, machine, IP, tool, file, result, error code |

### Filtering the event log

Use the filters at the top of the event log:
- **Tool:** Postman/Bruno Converter, JMX Converter, Script Studio
- **Result:** success, failed, timeout
- **Date range:** from / to date pickers
- **Search:** machine hostname, IP address, or filename

### Understanding error codes

When a conversion fails, a red error code appears below the "failed" badge in the Result column.

| Error Code | Meaning | Action |
|-----------|---------|--------|
| `parse_error` | Uploaded file is invalid or corrupted | Ask user to re-export from Postman / JMeter |
| `unsupported_format` | File type not recognized by the selected converter | Check file type matches the tool being used |
| `empty_input` | File has no requests or items | Re-export -- file may be empty |
| `conversion_timeout` | Took longer than 120 seconds | File is very large -- split into smaller parts |
| `conversion_failed` | Unexpected error | Check iisnode logs in `D:\MSINetData\WWW\converter\iisnode\` |

### Downloading reports

Use the **Download** buttons at the top of the dashboard to export as **CSV**, **Excel (XLSX)**, or **Word (DOCX)**. Reports reflect the currently selected date range and tool filter.

### Logging out

Click the **Logout** button in the top-right corner of the dashboard.

---

## Updating the Application

When a new version is released, the ADMIN_TOKEN set in IIS persists -- you do not need to set it again.

1. Copy all files from the "Files to Deploy" list into `D:\MSINetData\WWW\converter\`, replacing existing files
2. Do **not** delete `node_modules\` unless instructed -- run npm install to update it

```cmd
cd D:\MSINetData\WWW\converter
npm install --production

REM Recycle the pool to load new code -- no IIS restart needed
%windir%\system32\inetsrv\appcmd recycle apppool /apppool.name:"perfx-studio-pool"
```

> **Success:** Recycling the Application Pool is enough. Other sites on the server are not affected.

---

## Environment Variables Reference

Set in IIS Manager -> Application Pool -> Advanced Settings -> Environment Variables (Step 7).
Only `ADMIN_TOKEN` is required.

| Variable | Required? | Default | Description |
|----------|-----------|---------|-------------|
| `ADMIN_TOKEN` | **Required for admin** | none (admin disabled) | Password for analytics admin dashboard. Without this, `/converter/admin` returns 404. |
| `MAX_CONCURRENT_CONVERSIONS` | Optional | 8 | Simultaneous conversions allowed. Set to number of physical CPU cores. |
| `ANALYTICS_RETENTION_DAYS` | Optional | 730 | Analytics older than this many days are deleted. Set to 0 to keep forever. |
| `ANALYTICS_DB_PATH` | Optional | `.\data\analytics.db` | Path to SQLite analytics database file. |
| `PORT` | Optional | 3000 | With iisnode, leave this unset -- iisnode uses named pipes, not TCP ports. |

---

## Troubleshooting

| What you see | Most likely cause | Fix |
|-------------|-------------------|-----|
| 502 Bad Gateway | Node.js failed to start | Check `D:\MSINetData\WWW\converter\iisnode\app.js-xxxxx.txt`. Also run `node app.js` from the app folder to see the error directly. |
| 404 Not Found | URL Rewrite not installed or web.config missing | Confirm `web.config` exists in `D:\MSINetData\WWW\converter\`. Confirm URL Rewrite installed (Step 2). Run `iisreset`. |
| 403 Forbidden | NetworkService lacks read permission | Re-run the `icacls` commands from Step 9. |
| Admin page is a 404 | ADMIN_TOKEN not set | Go back to Step 7. Confirm the name is exactly `ADMIN_TOKEN` (all caps). Recycle the app pool. |
| Blank page, no error | node_modules missing | Run `npm install --production` in `D:\MSINetData\WWW\converter\`. |
| 413 Request Entity Too Large | IIS blocking large file uploads | Confirm `maxAllowedContentLength="104857600"` in `web.config`. |
| App pool keeps crashing | Rapid-fail protection triggered | Open Windows Event Viewer -> Windows Logs -> Application. Look for WAS or iisnode errors. |
| Cannot find module 'better-sqlite3' | Wrong Node.js version during install | Confirm Node.js 18 (`node --version`). Delete `node_modules\` and rerun `npm install --production`. |

### Where to find log files

```
iisnode logs (check here first):
  D:\MSINetData\WWW\converter\iisnode\app.js-xxxxx.txt

IIS access logs:
  C:\inetpub\logs\LogFiles\W3SVC1\

Windows Event Log:
  Start -> Event Viewer -> Windows Logs -> Application
```

---

*See also: [Configuration Reference](CONFIGURATION.md) | [Architecture](../technical/ARCHITECTURE.md)*
