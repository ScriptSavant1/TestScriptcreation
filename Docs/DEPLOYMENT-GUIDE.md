# LRE Toolkit — IIS Deployment Guide

> Step-by-step instructions for deploying the LRE Toolkit on the IIS server.
> Intended for administrators. No programming knowledge required.

---

## Environment

| Item | Detail |
|------|--------|
| **Application name** | LRE Toolkit |
| **Application URL** | `https://loadrunner.webdev.banksvcs.net/converter/` |
| **IIS server** | `devecpvm026127` |
| **Server share path** | `\\devecpvm026127\d$\MSINetData\WWW\converter` |
| **Physical path on server** | `D:\MSINetData\WWW\converter` |
| **IIS Application Pool** | `LREToolkitAppPool` |
| **IIS site** | `loadrunner.webdev.banksvcs.net` |
| **IIS alias** | `converter` |
| **Node.js entry point** | `app.js` (root wrapper → `src/web/server.js`) |

---

## Architecture

```
Users (any browser)
    │
    ▼
https://loadrunner.webdev.banksvcs.net/converter/
    │
    F5 Load Balancer  (no config changes needed)
    │
    ▼
IIS on devecpvm026127
    │
    iisnode module  (translates IIS requests → Node.js)
    │
    ▼
D:\MSINetData\WWW\converter\app.js  →  src/web/server.js
    │
    ├── GET  /converter            → Portal home page
    ├── GET  /tools/recorder       → HAR Recorder tool
    ├── GET  /tools/studio         → Script Studio tool
    ├── POST /convert              → Postman / Bruno conversion
    ├── POST /convert-jmx          → JMeter conversion
    ├── GET  /download/:token      → ZIP file stream (single-use, 5 min TTL)
    └── GET  /health               → Health check (JSON)
```

---

## Contents

1. [Important notes before you start](#1-important-notes-before-you-start)
2. [One-time software installation](#2-one-time-software-installation)
3. [Prepare the deployment package (local machine)](#3-prepare-the-deployment-package-local-machine)
4. [Copy files to the IIS server](#4-copy-files-to-the-iis-server)
5. [Verify the deployment files](#5-verify-the-deployment-files)
6. [IIS configuration](#6-iis-configuration)
7. [Set file permissions](#7-set-file-permissions)
8. [Test the deployment](#8-test-the-deployment)
9. [Updating the application](#9-updating-the-application)
10. [Troubleshooting](#10-troubleshooting)

---

## 1. Important notes before you start

### Why no `npm install` on the server?

The IIS server has **no internet or proxy access** to download Node.js packages. The `node_modules` folder must be installed on your **local machine** (where internet access is available) and copied to the server along with the rest of the project. This is the standard approach for restricted/air-gapped environments.

### The web server process — expected behaviour

When Node.js is running correctly through iisnode, it runs **continuously** waiting for requests. This is normal — a web server is supposed to run forever. You do not start or stop it manually; IIS manages the process automatically.

### Concurrent users — already handled

The application is built with Node.js `async/await` and per-request memory isolation. It handles multiple concurrent users with no configuration changes required.

---

## 2. One-time software installation

These must be installed on the IIS server **once only** by an administrator. If the server already has these from a previous deployment, skip to Section 3.

### Install Node.js

1. Download the Windows Installer (`.msi`) for **Node.js LTS** from https://nodejs.org
2. Run the installer as Administrator — accept all defaults
3. After installation, verify from Command Prompt:
   ```cmd
   node --version
   npm --version
   ```
   Both commands must print version numbers. If not, reboot and try again.

### Install iisnode

iisnode is the IIS module that allows IIS to host Node.js applications.

1. Download `iisnode-full-v*.msi` from https://github.com/Azure/iisnode/releases
   - Choose the **`full`** installer (not `core`)
2. Run the installer as Administrator — accept all defaults
3. Open IIS Manager: `Win + R` → type `inetmgr` → Enter
4. Click the **server name** in the left panel
5. In the Features view, verify **iisnode** is listed
6. If it does not appear: run `iisreset` from Command Prompt, then recheck

### Install URL Rewrite Module

The URL Rewrite Module routes all browser requests through the Node.js server.

1. Download from: https://www.iis.net/downloads/microsoft/url-rewrite
2. Run the installer as Administrator
3. Run `iisreset` after installation completes

> **All three components are required.** The application will not work if any one is missing.

---

## 3. Prepare the deployment package (local machine)

Before copying to the server, install the Node.js modules **on your local machine** where internet access is available.

Open Command Prompt in the project root folder and run:

```cmd
npm install --production
```

This creates (or updates) the `node_modules` folder with all required runtime packages. The `--production` flag excludes development tools (Jest, ESLint) that are not needed on the server.

> **Run this on your local machine only — never on the IIS server.**

### What to exclude when copying

Do **not** copy the following to the server:

| Excluded item | Reason |
|---------------|--------|
| `.git\` | Version control history — not needed on server |
| `test\` | Unit tests — not needed on server |
| `Docs\` | Documentation files — not needed on server |
| `*.md` files in root | Documentation — not needed on server |

---

## 4. Copy files to the IIS server

1. Open **File Explorer** on your local machine
2. In the address bar, paste the server share path and press Enter:
   ```
   \\devecpvm026127\d$\MSINetData\WWW\converter
   ```
3. Copy the **entire project folder contents** into this location, excluding the items listed above

The files land at this physical path on the server:
```
D:\MSINetData\WWW\converter
```

---

## 5. Verify the deployment files

After copying, confirm the following exist at `D:\MSINetData\WWW\converter`:

| Item | Type | Notes |
|------|------|-------|
| `src\` | Folder | Application source code |
| `node_modules\` | Folder | Pre-installed packages — copied from your local machine |
| `logs\` | Folder | **Create manually if missing** — see note below |
| `app.js` | File | iisnode entry point — must be in the root |
| `web.config` | File | IIS routing configuration — must be in the root |
| `package.json` | File | Project metadata |
| `package-lock.json` | File | Dependency lock file |
| `DevWebSdk.d.ts` | File | DevWeb TypeScript definitions |
| `jwt-helper.js` | File | JWT generation helper |
| `jsrsasign.js` | File | JWT crypto library |
| `transport.pem` | File | JWT certificate |

> **If the `logs\` folder does not exist**, create it manually before starting the application:
> ```cmd
> mkdir "D:\MSINetData\WWW\converter\logs"
> ```
> The application writes log files here. Without this folder you will get 500 errors on startup.

---

## 6. IIS configuration

### Step 1 — Create the Application Pool

1. Open **IIS Manager**: `Win + R` → type `inetmgr` → Enter
2. In the left panel, right-click **Application Pools** → click **Add Application Pool...**
3. Fill in the dialog:

   | Field | Value |
   |-------|-------|
   | Name | `LREToolkitAppPool` |
   | .NET CLR Version | **No Managed Code** ← CRITICAL |
   | Managed pipeline mode | `Integrated` |

4. Click **OK**

> **`.NET CLR Version` must be `No Managed Code`** — required for all Node.js applications in IIS. Any .NET version here will cause a 500 error.

### Step 2 — Create the Application

1. In the left panel, expand **Sites**
2. Expand the site: **`loadrunner.webdev.banksvcs.net`**
3. Right-click the site → click **Add Application...**
4. Fill in the dialog:

   | Field | Value |
   |-------|-------|
   | Alias | `converter` |
   | Application Pool | Click **Select...** → choose `LREToolkitAppPool` |
   | Physical path | `D:\MSINetData\WWW\converter` |

5. Click **OK**

After clicking OK, `converter` appears under the site with a small gear/application icon.

Users access the toolkit at: **`https://loadrunner.webdev.banksvcs.net/converter/`**

---

## 7. Set file permissions

The IIS worker process needs full access to the application folder to read files, write logs, and create temporary files during conversion.

Open **Command Prompt as Administrator** (right-click Command Prompt → "Run as Administrator") and run both commands:

```cmd
:: Grant permissions to IIS_IUSRS (built-in IIS user group)
icacls "D:\MSINetData\WWW\converter" /grant "IIS_IUSRS:(OI)(CI)F" /T

:: Grant permissions to the LRE Toolkit application pool identity
icacls "D:\MSINetData\WWW\converter" /grant "IIS AppPool\LREToolkitAppPool:(OI)(CI)F" /T
```

### Verify permissions were applied

```cmd
icacls "D:\MSINetData\WWW\converter" /T | findstr "IIS_IUSRS"
```

Expected output:
```
D:\MSINetData\WWW\converter IIS_IUSRS:(OI)(CI)(F)
```

> **Without correct permissions you will get HTTP 500 errors** when the application tries to read source files or write to the logs folder.

---

## 8. Test the deployment

### Basic access test

1. Open a browser from **any machine** (not only the server)
2. Navigate to: `https://loadrunner.webdev.banksvcs.net/converter/`
3. The **LRE Toolkit** portal home page should load with all tool cards visible

### Health check

Open a second browser tab and go to:
```
https://loadrunner.webdev.banksvcs.net/converter/health
```

Expected response:
```json
{ "status": "ok", "version": "2.9.1" }
```

If this returns 200 with JSON, Node.js is running correctly.

### Functional smoke test

1. Click the **Converter** tab → upload a Postman or Bruno collection JSON → click **Convert** → click **Download ZIP** and verify the file downloads
2. Click the **Recorder** tab → the HAR Recorder should load inside the portal
3. Click the **Script Studio** tab → Script Studio should load inside the portal
4. Click the **Help** tab → inline documentation should load

### Navigation test

| URL / Action | Expected result |
|-------------|-----------------|
| `https://loadrunner.webdev.banksvcs.net/converter/` | Portal home page |
| `/converter/health` | JSON: `{ "status": "ok" }` |
| Click **Converter** tab | Converter form loads |
| Click **Recorder** tab | HAR Recorder loads inside portal |
| Click **Script Studio** tab | Script Studio loads inside portal |
| Click **Help** tab | Inline documentation loads |
| Direct access to a `.html` URL | Returns 404 (security — direct HTML access is blocked by design) |

---

## 9. Updating the application

When a new version is released:

1. **On your local machine** — pull the latest code and run:
   ```cmd
   npm install --production
   ```

2. **Stop the application** in IIS Manager:
   - Expand **Sites → loadrunner.webdev.banksvcs.net → converter**
   - Right-click `converter` → **Manage Application → Stop**

3. **Copy the updated files** to `\\devecpvm026127\d$\MSINetData\WWW\converter`
   - Overwrite all files — do **not** delete the `logs\` folder

4. **Start the application** in IIS Manager:
   - Right-click `converter` → **Manage Application → Start**

5. **Force iisnode to reload** the Node.js process:
   ```cmd
   copy /b "D:\MSINetData\WWW\converter\web.config" +,,
   ```
   This touches the file timestamp without changing its content, which tells iisnode to recycle the worker process.

6. **Verify** using the test steps in Section 8

---

## 10. Troubleshooting

---

### Issue: HTTP 500.1002 — "The specified module could not be found"

**Cause:** iisnode is not installed, or was installed before IIS was enabled.

**Fix:**
1. Uninstall iisnode from **Programs and Features**
2. Ensure IIS is running with the CGI feature enabled:
   Server Manager → IIS → Application Development → **CGI** (must be checked)
3. Re-run the iisnode installer
4. Run `iisreset`

---

### Issue: HTTP 500.19 — "Configuration Error"

**Cause:** `web.config` is missing/malformed, or the URL Rewrite Module is not installed.

**Fix:**
1. Confirm `web.config` exists at `D:\MSINetData\WWW\converter\web.config`
2. Open in Notepad — check for malformed XML (unclosed tags)
3. Install the URL Rewrite Module if not already done
4. Run `iisreset`

---

### Issue: HTTP 500 — Permission errors in logs

**Cause:** The application pool identity does not have write access.

**Fix:** Re-run the icacls commands from Section 7 using the exact pool name `LREToolkitAppPool`.

---

### Issue: "Cannot find module 'express'" in logs

**Cause:** `node_modules` was not copied to the server or the copy was incomplete.

**Solution 1 — Copy from local machine:**
```cmd
xcopy /E /I "C:\[your-local-path]\node_modules" "D:\MSINetData\WWW\converter\node_modules"
```

**Solution 2 — If the server has temporary internet access:**
```cmd
cd D:\MSINetData\WWW\converter
npm install --production
```

---

### Issue: "Request Rejected" — ZIP download blocked by F5

**Symptoms:** After clicking Convert, a page appears with:
> *"Your request was rejected. Please contact servicedesk, quoting KB0043997"*

**Cause:** The F5 Load Balancer is blocking the file upload. This is a network policy — not an application bug.

**Solution — Raise a ticket with the Network Traffic Management (NTMS) team:**

1. On the "Request Rejected" page, press **F12** → **Elements** tab
2. Find the Request ID in the HTML:
   ```html
   Your request was rejected. Please contact service desk,
   quoting KB0043997 and request ID: 8422097247368511591
   ```
3. Raise an incident with NTMS providing:
   - The **Request ID** from the page
   - The **URL**: `https://loadrunner.webdev.banksvcs.net/converter/`
   - The **KB reference**: KB0043997
   - Description: *"File upload to internal IIS/Node.js application blocked by F5 policy"*

---

### Issue: "Download link expired or already used"

**Cause:** The download token is single-use and expires in 5 minutes. If the app pool recycled between Convert and Download, the token is lost.

**Fix:** Click **Convert** again and download immediately.

To prevent premature pool recycling:
1. IIS Manager → **Application Pools** → `LREToolkitAppPool`
2. Right-click → **Advanced Settings**
3. Set **Idle Time-out (minutes)** to `0`

---

### Log file locations

| Log | Location |
|-----|----------|
| Application logs (Node.js output) | `D:\MSINetData\WWW\converter\logs\` |
| iisnode process logs | `D:\MSINetData\WWW\converter\iisnode\` |
| IIS HTTP access logs | `C:\inetpub\logs\LogFiles\` |
| Windows Event Viewer | Event Viewer → Windows Logs → Application |

---

## Quick Reference

| Task | Action |
|------|--------|
| First-time setup | Sections 2 → 7 |
| Update the app | Section 9 |
| Force Node.js reload | `copy /b "D:\MSINetData\WWW\converter\web.config" +,,` |
| Health check URL | `https://loadrunner.webdev.banksvcs.net/converter/health` |
| Portal URL | `https://loadrunner.webdev.banksvcs.net/converter/` |
| Server share | `\\devecpvm026127\d$\MSINetData\WWW\converter` |
| App Pool name | `LREToolkitAppPool` |
| View Node.js logs | `D:\MSINetData\WWW\converter\logs\` |
| F5 block — who to contact | NTMS team, quote KB0043997 + Request ID from error page |
