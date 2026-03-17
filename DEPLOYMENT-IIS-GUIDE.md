# Bruno DevWeb Converter — IIS Deployment Guide
## Server: devecpvm026127
## Final URL: https://loadrunner.webdev.banksvcs.net/converter/

---

## Read This First — Common Confusions

### ✅ "node src/web/server.js keeps running" — THIS IS CORRECT
A web server is supposed to run forever. It sits and waits for user requests.
Ctrl+C stops it. When running via IIS (iisnode), you never start it manually — IIS does it automatically.

### ❌ "npm install --production runs forever" — NO INTERNET ON SERVER
Do NOT run `npm install` on the server. The server has no internet.
**Solution: copy the `node_modules` folder directly from your development machine to the server.**

### ✅ Concurrent users — already handled
The app is built with Node.js async/await and per-request memory isolation.
It handles many users at the same time with no issues.

---

## Architecture

```
Users → https://loadrunner.webdev.banksvcs.net/converter/
            │
            F5 (no changes needed)
            │
            IIS on devecpvm026127
            │
            iisnode module (runs Node.js inside IIS)
            │
            D:\MSINetData\WWW\converter\src\web\server.js
```

---

## What You Need (All One-Time)

| Requirement | Status |
|-------------|--------|
| Node.js installed on server | ✅ Done |
| iisnode installed on server | ✅ Done |
| Project files copied to server | ✅ Done |
| URL Rewrite module | ❓ Check below |
| node_modules copied from dev machine | ❓ Check below |
| web.config created | ❓ Check below |
| IIS Application Pool — No Managed Code | ❓ Most likely missing |
| Folder permissions for IIS | ❓ Most likely missing |

---

## STEP 1 — Verify URL Rewrite Module Is Installed

The `web.config` we use needs this module. Without it, IIS gives error 500.19.

**How to check:**
1. Open IIS Manager (`Windows + R` → type `inetmgr` → Enter)
2. Click the **server name** (top of left panel)
3. In the middle panel, look for **"URL Rewrite"** icon
4. If you see it → ✅ installed, skip to Step 2

**If NOT installed — do this on any machine that has internet, then copy the installer to the server:**
1. Download: `rewrite_amd64_en-US.msi` from Microsoft
   (search "IIS URL Rewrite download" — it's a free Microsoft download)
2. Copy the `.msi` file to the server via `\\devecpvm026127\c$\Temp\`
3. On the server, run the `.msi` → Next → Accept → Install → Finish
4. No server restart needed

---

## STEP 2 — Copy node_modules From Your Dev Machine

Since the server has no internet, `npm install` won't work.
You must copy `node_modules` from your development machine.

**On your development machine:**
1. Open File Explorer
2. Go to your project folder (e.g., `C:\Workspace\bruno-devweb-converter\`)
3. You will see a `node_modules` folder there

**Copy to server:**
1. Open: `\\devecpvm026127\d$\MSINetData\WWW\converter\`
2. Copy the entire `node_modules` folder into `converter\`

This folder is large (~50,000 files). It may take a few minutes to copy.

**After copying, verify:**
The folder `D:\MSINetData\WWW\converter\node_modules\` should exist on the server.

---

## STEP 3 — Verify All Required Files Are Present

Open `\\devecpvm026127\d$\MSINetData\WWW\converter\` and confirm these exist:

```
converter\
  ├── src\                    ← REQUIRED
  ├── devweb-prompts\         ← REQUIRED
  ├── node_modules\           ← REQUIRED (copied in Step 2)
  ├── package.json            ← REQUIRED
  ├── web.config              ← REQUIRED (create/replace in Step 4)
  ├── DevWebSdk.d.ts          ← REQUIRED
  ├── jwt-helper.js           ← REQUIRED
  ├── jsrsasign.js            ← REQUIRED
  ├── transport.pem           ← REQUIRED
  └── logs\                   ← create this empty folder if missing
```

---

## STEP 4 — Create the Correct web.config

**Delete any existing web.config in the `converter` folder first.**

Then create a new one:
1. Open **Notepad** on the server
2. Copy and paste the EXACT content below
3. **File → Save As**
4. Navigate to: `D:\MSINetData\WWW\converter\`
5. File name: `web.config`
6. **Save as type: All Files (\*.\*)** ← CRITICAL — must not save as `.txt`
7. Click Save

```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>

    <handlers>
      <add name="iisnode"
           path="src/web/server.js"
           verb="*"
           modules="iisnode" />
    </handlers>

    <rewrite>
      <rules>
        <rule name="NodeApp" stopProcessing="true">
          <match url=".*" />
          <conditions>
            <add input="{REQUEST_FILENAME}"
                 matchType="IsFile"
                 negate="true" />
          </conditions>
          <action type="Rewrite" url="src/web/server.js" />
        </rule>
      </rules>
    </rewrite>

    <security>
      <requestFiltering>
        <hiddenSegments>
          <add segment="node_modules" />
        </hiddenSegments>
      </requestFiltering>
    </security>

    <iisnode
      nodeProcessCommandLine="&quot;C:\Program Files\nodejs\node.exe&quot;"
      watchedFiles="*.js;web.config"
      loggingEnabled="true"
      logDirectory="logs"
      maxLogFiles="10"
      maxNamedPipeConnectionRetry="100"
      namedPipeConnectionRetryDelay="250" />

  </system.webServer>
</configuration>
```

> **Note on `nodeProcessCommandLine`:** This tells iisnode exactly where Node.js is installed.
> If Node.js is installed somewhere else, update this path. To find it, open Command Prompt and type:
> `where node` — it will show the full path.

---

## STEP 5 — Set Up IIS Application and Application Pool

This is the most critical section. Most iisnode failures are caused by wrong Application Pool settings.

### 5A — Create a Dedicated Application Pool

We create a SEPARATE application pool for the converter so it cannot affect any existing IIS sites.

1. Open **IIS Manager** (`Windows + R` → `inetmgr` → Enter)
2. In the left panel, right-click **"Application Pools"**
3. Click **"Add Application Pool..."**
4. Fill in:
   - **Name:** `BrunoConverter`
   - **.NET CLR Version:** `No Managed Code`  ← **CRITICAL — must be exactly this**
   - **Managed Pipeline Mode:** `Integrated`
5. Click **OK**

### 5B — Convert the converter Folder to an Application

1. In IIS Manager, expand the left panel:
   - **Sites** → your site (e.g. `Default Web Site`)
2. Find **`converter`** in the list
3. **Right-click `converter`** → click **"Convert to Application"**
4. A dialog opens
5. Click **"Select..."** next to Application Pool
6. Select **`BrunoConverter`** (the one we just created)  ← **CRITICAL**
7. Click **OK** → **OK**

The `converter` folder icon should change to show a small blue globe symbol.

---

## STEP 6 — Set Folder Permissions

IIS runs the Node.js app under the Application Pool identity account.
This account needs permission to read and execute files in the converter folder.

1. Open File Explorer on the server
2. Navigate to `D:\MSINetData\WWW\`
3. Right-click the **`converter`** folder → **Properties**
4. Click the **Security** tab
5. Click **Edit...**
6. Click **Add...**
7. In the text box, type exactly:
   ```
   IIS AppPool\BrunoConverter
   ```
8. Click **Check Names** — it should underline/resolve the name ✓
9. Click **OK**
10. With `IIS AppPool\BrunoConverter` selected, check these boxes:
    - ✅ Read & execute
    - ✅ List folder contents
    - ✅ Read
11. Click **Apply** → **OK** → **OK**

---

## STEP 7 — Quick Sanity Check Before Testing

Open Command Prompt on the server and run this:

```cmd
cd D:\MSINetData\WWW\converter
node src\web\server.js
```

You should see something like:
```
Bruno DevWeb Converter web server running on port 3000
Browse to: http://localhost:3000
```

**If you see this → Node.js and the app are working. Press Ctrl+C to stop.**

**If you see an error like `Cannot find module 'express'`** → `node_modules` is missing or incomplete. Repeat Step 2.

---

## STEP 8 — Test via Browser

1. On any machine (not just the server), open a browser
2. Go to: `https://loadrunner.webdev.banksvcs.net/converter/`
3. The converter page should load ✓

---

## STEP 9 — Verify After Server Reboot

After Windows team restarts the server:
1. Wait 2 minutes for IIS to start
2. Browse to `https://loadrunner.webdev.banksvcs.net/converter/`
3. First request may take 3–5 seconds (iisnode starts Node.js on first hit)
4. It should work automatically — no manual steps ✓

---

## Troubleshooting

### Error: 500.19 — Cannot read configuration file
**Cause:** `web.config` has a syntax error, OR URL Rewrite module is not installed.
**Fix:** Reinstall URL Rewrite module (Step 1). Then recreate `web.config` exactly as shown in Step 4.

### Error: 500.21 — Handler "iisnode" has bad module "iisnode"
**Cause:** iisnode module is not installed or not registered in IIS.
**Fix:** Reinstall iisnode. After install, open IIS Manager and click **Server → Modules** to confirm "iisnode" appears in the list.

### Error: 500 — Internal Server Error (iisnode log shows "Cannot find module")
**Cause:** `node_modules` folder missing or incomplete.
**Fix:** Copy `node_modules` from dev machine again (Step 2). Make sure the copy completed fully.

### Error: 500 — iisnode log shows "ENOENT" or "spawn error"
**Cause:** Node.js path in `web.config` is wrong.
**Fix:** On server, open CMD and type `where node`. Use that path in `nodeProcessCommandLine` in `web.config`.

### Error: 403 — Access Denied
**Cause:** IIS AppPool identity doesn't have permission on the folder.
**Fix:** Redo Step 6 — set permissions for `IIS AppPool\BrunoConverter`.

### Error: 404 — Not Found
**Cause:** The `converter` folder was not "Converted to Application" (Step 5B was skipped).
**Fix:** In IIS Manager, right-click `converter` → Convert to Application → select `BrunoConverter` pool.

### Where to find iisnode error logs
When something goes wrong, iisnode writes detailed logs to:
```
D:\MSINetData\WWW\converter\logs\
```
Open the newest `.txt` file there — it shows the exact Node.js error.

---

## How to Update the Application (Future Versions)

Since there is no internet on the server, updating works like this:

1. On your **dev machine**: run `npm install --production` once after any package changes
2. Copy updated files to `\\devecpvm026127\d$\MSINetData\WWW\converter\`
3. If `package.json` dependencies changed → also re-copy `node_modules`
4. iisnode detects file changes automatically and restarts Node.js
5. No IIS restart needed ✓

---

## Quick Reference

| Item | Value |
|------|-------|
| App folder on server | `D:\MSINetData\WWW\converter\` |
| Application Pool name | `BrunoConverter` |
| Application Pool .NET version | No Managed Code |
| Error logs | `D:\MSINetData\WWW\converter\logs\` |
| Node.js path (default) | `C:\Program Files\nodejs\node.exe` |
| Public URL | `https://loadrunner.webdev.banksvcs.net/converter/` |

---

## Does This Affect Existing IIS Sites?

**No.** Here is why:
- We create a **new, isolated Application Pool** (`BrunoConverter`) — it runs in a completely separate process from all other sites
- We only add a new `/converter/` application — all other paths (`/vugen/`, etc.) are completely untouched
- We do NOT enable global ARR proxy — no global IIS settings are changed
- If the converter app crashes or is stopped, no other site is affected

---

*Bruno DevWeb Converter — Deployment Guide v2.7.0*
*Last updated: March 2026*
