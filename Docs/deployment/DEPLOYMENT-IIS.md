# PerfX Studio -- IIS Deployment Guide

**Version:** 2.8.0 | **Date:** July 2026
**Platform:** Windows Server 2019 or 2022 | IIS 10 | Node.js 18 LTS | iisnode 0.2.26

> **Visual guide available:** A formatted version with IIS dialog mockups is published alongside this file.

---

## Before You Start -- Prerequisites Checklist

The IIS server is a **zero-trust machine with no internet access**. All installers must be downloaded on your local machine (or any internet-connected machine) and transferred to the server via file share or shared drive before starting.

**What must be installed on the IIS server:**

| # | Component | Where to get it |
|---|-----------|----------------|
| [ ] | Windows Server 2019 or 2022 with IIS enabled | Windows Features |
| [ ] | Node.js **18 LTS** installer (`.msi`) | Download on local machine from nodejs.org, then copy to server |
| [ ] | IIS URL Rewrite Module 2.1 (`rewrite_amd64_en-US.msi`) | Download on local machine from Microsoft IIS downloads page, then copy to server |
| [ ] | iisnode v0.2.26 (`iisnode-full-v0.2.26-x64.msi`) | Download on local machine from GitHub: Azure/iisnode Releases, then copy to server |
| [ ] | Administrator access on the server | Required for all steps |

**What must be installed on your local developer machine (VCSE):**

| # | Component | Why needed |
|---|-----------|-----------|
| [ ] | Node.js **18 LTS** (same version as the server) | To run `npm install` in Step 5 -- must match server version exactly |
| [ ] | PerfX Studio source code | To build `node_modules` and prepare deployment files |

---

## Files and Folders to Deploy

The application is deployed to: `D:\MSINetData\WWW\converter\`

This folder sits inside your IIS website root (`D:\MSINetData\WWW\`) as the `converter` application.

### Copy these files and folders to the server

All items below go into `D:\MSINetData\WWW\converter\` on the IIS server.
`node_modules\` is built on your local machine first (Step 5), then copied here.

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
+-- node_modules\               <- built locally (Step 5), then copied here
|                                  tens of thousands of files -- copy last
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
| `.env` | Create fresh on the server (contains password) |
| `.git\` | Source control history -- not needed at runtime |
| `data\` | Auto-created by the app on first run |
| `Docs\`, `*.md`, `*.pdf`, `*.pptx` | Documentation only |
| `pm2.config.js` | PM2 config -- not used with IIS |
| `collection-examples\`, `examples\` | Sample files -- not needed |

---

## Step 1 of 11 -- Install Node.js 18 LTS

> **The server has no internet access.** Download the installer on your local machine and copy it to the server first.

1. On your **local machine**, go to **nodejs.org** and download the Windows installer labelled **"18.x.x LTS"** (file: `node-v18.x.x-x64.msi`). Do not choose version 20 or 22.
2. Copy the `.msi` file to the IIS server via file share or shared drive
3. On the server, run the `.msi` installer as **Administrator**. Accept all defaults.
4. Verify in **Command Prompt (as Administrator)** on the server:

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

> **The server has no internet access.** Download the installer on your local machine and copy it to the server first.

1. On your **local machine**, search the web for **"IIS URL Rewrite 2.1 download"** and download the **x64 English** installer (`rewrite_amd64_en-US.msi`) from the Microsoft IIS downloads page
2. Copy the `.msi` file to the IIS server via file share or shared drive
3. On the server, run the installer as **Administrator** -- accept the license and click **Install**
4. After installation, restart IIS:

```cmd
C:\> iisreset
```

---

## Step 3 of 11 -- Install iisnode

iisnode bridges IIS and Node.js, letting IIS host Node.js applications.

> **The server has no internet access.** Download the installer on your local machine and copy it to the server first.

1. On your **local machine**, go to **github.com/Azure/iisnode** -> click **Releases** -> download **iisnode-full-v0.2.26-x64.msi**
2. Copy the `.msi` file to the IIS server via file share or shared drive
3. On the server, run the installer as **Administrator**, accept all prompts

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

3. Copy all application source files from the "Files and Folders to Deploy" list into `D:\MSINetData\WWW\converter\` -- everything **except** `node_modules\` (that comes in Step 5)
4. Open File Explorer and verify: `app.js`, `web.config`, and the `src` folder must be visible **directly inside** `D:\MSINetData\WWW\converter\` -- not inside a subfolder

> **WARNING:** If everything is one level too deep (e.g., `converter\converter\app.js`), move all files up one level. `app.js` and `web.config` must be at the root of `D:\MSINetData\WWW\converter\`.

---

## Step 5 of 11 -- Build and Copy Node.js Dependencies

The IIS server is a zero-trust machine with no internet access, so `npm install` must run on your **local developer machine** (VCSE machine). You then copy the resulting `node_modules` folder to the server.

> **Why:** `npm install` downloads packages from the internet (npmjs.com or an Artifactory registry). Without internet access on the server, it would fail.

### 5a -- Run npm install on your local machine

Open **Command Prompt or PowerShell** on your local developer machine:

```cmd
cd C:\path\to\your\bruno-devweb-converter

npm install --production
```

Wait 1-3 minutes. At the end you will see: `added NNN packages in Xs`

> **Note:** Run this with the **same Node.js 18 version** that is installed on the IIS server. If versions differ, some native modules (e.g., `better-sqlite3`) may fail to load on the server.

### 5b -- Copy node_modules to the IIS server

Copy the entire `node_modules` folder from your local machine to the server:

```
Source (your local machine):
  C:\path\to\bruno-devweb-converter\node_modules\

Destination (IIS server):
  D:\MSINetData\WWW\converter\node_modules\
```

Use any file transfer method available on your network -- Windows file share (UNC path), SFTP, or a shared drive.

> **WARNING:** `node_modules` contains tens of thousands of small files. Copying over a network can take several minutes. Do not interrupt the transfer.

> **Success:** After copying, `D:\MSINetData\WWW\converter\node_modules\` exists on the server and contains many subfolders (express, multer, better-sqlite3, etc.).

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

All tools live at the single URL below. The browser URL never changes when switching between tools -- tabs load inline or in embedded frames.

**Test 1 -- Main portal (the only URL users need):**
```
https://loadrunner.webdev.banksvcs.net/converter
```
You should see: The PerfX Studio portal page with tool tabs at the top -- Converter, Recorder, Script Studio.
Click each tab to confirm it loads its tool without any error.

> **Note:** `/converter/studio` and `/converter/recorder` exist as internal routes used by the portal's
> embedded frames, but users never visit them directly. Always point users to `/converter`.

**Test 2 -- Admin dashboard:**
```
https://loadrunner.webdev.banksvcs.net/converter/admin
```
You should see: A password login page. Enter the ADMIN_TOKEN set in Step 7. You will be redirected to the analytics dashboard.

If something does not work, see the Troubleshooting section.

---

## Step 11 of 11 -- Using the Admin Dashboard

> **The admin dashboard is the only URL separate from the main portal.**
> All other tools (Converter, Recorder, Script Studio) are accessed at `/converter`.

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

1. Copy all updated files from the "Files to Deploy" list into `D:\MSINetData\WWW\converter\`, replacing existing files
2. On your **local developer machine**, run `npm install --production` to update `node_modules`, then copy it to the server (same procedure as Step 5)
3. Skip step 2 if `package.json` has not changed -- no new dependencies means no need to re-copy `node_modules`

```cmd
REM On the IIS server -- recycle the pool to load new code (no IIS restart needed)
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
| Blank page, no error | node_modules missing or incomplete | On your **local machine** run `npm install --production`, then copy the `node_modules\` folder to `D:\MSINetData\WWW\converter\` on the server (Step 5). |
| 413 Request Entity Too Large | IIS blocking large file uploads | Confirm `maxAllowedContentLength="104857600"` in `web.config`. |
| App pool keeps crashing | Rapid-fail protection triggered | Open Windows Event Viewer -> Windows Logs -> Application. Look for WAS or iisnode errors. |
| Cannot find module 'better-sqlite3' | Node.js version mismatch between local machine and server | Run `node --version` on both machines -- both must print `v18.x.x`. Fix whichever is wrong, then re-run `npm install --production` on your local machine and re-copy `node_modules\` to the server. |

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
