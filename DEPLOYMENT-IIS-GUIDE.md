# Bruno DevWeb Converter — IIS Deployment Guide
## Server: devecpvm026127
## URL: https://loadrunner.webdev.banksvcs.net/converter/

---

## How It Works (Simple Picture)

```
User's Browser
      │
      │  https://loadrunner.webdev.banksvcs.net/converter/
      ▼
F5 Load Balancer  ──────────────────── (no changes needed here)
      │
      ▼
IIS on devecpvm026127
      │
      │  iisnode module (runs Node.js inside IIS natively)
      ▼
Node.js App  ←──  files in D:\MSINetData\WWW\converter\
```

**iisnode** is a free Microsoft module that lets IIS run Node.js apps directly —
no separate service, no reverse proxy, no proxy settings to enable.
IIS manages the Node.js process automatically: starts it, restarts it on crash,
and restarts it after every server reboot.

---

## Folder Structure We Will Create

```
D:\MSINetData\WWW\converter\        ← App lives here (same as your HTML files)
    src\
    devweb-prompts\
    node_modules\                   ← created by npm install
    logs\                           ← create this folder manually
    package.json
    web.config                      ← we create this
    DevWebSdk.d.ts
    jwt-helper.js
    jsrsasign.js
    transport.pem
```

---

## PART A — One-Time Server Setup (do once, never again)

> RDP into devecpvm026127 and do all steps on the server itself.

---

### A1. Install Node.js

1. Open a browser on the server
2. Go to: `https://nodejs.org`
3. Click the **"LTS"** download button (the recommended version)
4. Run the downloaded installer (e.g., `node-v20.xx.x-x64.msi`)
5. Click **Next → Next → Next → Install → Finish**
   (accept all defaults, no changes needed)

**Verify it worked:**
1. Press `Windows + R`, type `cmd`, press **Enter**
2. Type: `node --version` and press Enter
3. You should see something like: `v20.11.1` ✓

---

### A2. Install iisnode

iisnode is a free Microsoft module — it teaches IIS how to run Node.js apps.

1. Open a browser on the server
2. Go to: `https://github.com/azure/iisnode/releases`
3. Find the latest release, download: `iisnode-full-v0.2.26-x64.msi`
   (or whatever the latest version shows)
4. Run the installer → **Next → Next → Install → Finish**
5. When asked to restart IIS — click **Yes**

**Verify it worked:**
1. Open **IIS Manager** (`Windows + R` → type `inetmgr` → Enter)
2. Click on the **server name** in the left panel (top level)
3. In the middle panel, look for an **"iisnode"** icon
4. If you see it → iisnode is installed ✓

---

### A3. Install URL Rewrite Module

This free Microsoft module is needed to route all `/converter/` requests through Node.js.

1. Open a browser on the server
2. Go to: `https://www.iis.net/downloads/microsoft/url-rewrite`
3. Click **"Install this extension"**
4. Follow the prompts → Install → Finish

**Check if already installed:**
- Open IIS Manager → click server name → look for **"URL Rewrite"** icon in the middle panel
- If you see it → already installed, skip this step ✓

---

## PART B — Deploy the Application

---

### B1. Create the App Folder

1. Open **File Explorer**
2. Navigate to: `D:\MSINetData\WWW\`
3. Create a new folder called: `converter`
4. Inside `converter`, create a folder called: `logs`

Result:
```
D:\MSINetData\WWW\converter\
D:\MSINetData\WWW\converter\logs\
```

---

### B2. Copy Application Files

Copy the following files/folders into `D:\MSINetData\WWW\converter\`:

| Copy This | Notes |
|-----------|-------|
| `src\` folder | All application code |
| `devweb-prompts\` folder | Prompt template files |
| `package.json` | Dependency list |
| `DevWebSdk.d.ts` | DevWeb type definitions |
| `jwt-helper.js` | JWT support |
| `jsrsasign.js` | JWT library |
| `transport.pem` | JWT certificate |

**Do NOT copy these:**
- `node_modules\` — we install fresh in next step
- `output\` — not needed
- `.git\` — not needed
- `*.md` files — optional, documentation only

---

### B3. Install Dependencies

1. Press `Windows + R`, type `cmd`, press **Enter**
2. Type the following and press Enter:
   ```
   cd D:\MSINetData\WWW\converter
   ```
3. Then type and press Enter:
   ```
   npm install --production
   ```
4. Wait 1–3 minutes while packages download
5. You will see: `added NNN packages` when done ✓
6. A `node_modules` folder will appear inside `converter` ✓

---

### B4. Create the web.config File

This file tells IIS: *"run server.js with Node.js for all requests"*.

1. Open **Notepad**
2. Copy and paste exactly this content:

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
      watchedFiles="*.js;web.config"
      loggingEnabled="true"
      logDirectory="logs"
      maxLogFiles="10" />

  </system.webServer>
</configuration>
```

3. Click **File → Save As**
4. Navigate to: `D:\MSINetData\WWW\converter\`
5. In **"File name"** box, type: `web.config`
6. In **"Save as type"**, select: **All Files (\*.\*)**
   (IMPORTANT — if you leave it as "Text Documents", it saves as `web.config.txt` which won't work)
7. Click **Save**

---

## PART C — IIS Configuration (Minimal — One Step Only)

This is the only step that requires IIS Manager, and it takes under 1 minute.

We need to tell IIS that `converter` is an **Application** (not just a folder),
so iisnode can run inside it.

1. Open **IIS Manager** (`Windows + R` → type `inetmgr` → Enter)
2. In the **left panel**, expand:
   - **Sites**
   - Expand your site (e.g., `Default Web Site` or `loadrunner.webdev.banksvcs.net`)
3. You should see **`converter`** listed under the site
4. **Right-click** on `converter` → click **"Convert to Application"**
5. A dialog box opens — leave everything as default
6. Click **OK**

The `converter` folder icon will change to show a small gear/application symbol ✓

That's it. IIS Manager is done.

---

## PART D — Test

1. Open a browser **from any machine** (not just the server)
2. Go to: `https://loadrunner.webdev.banksvcs.net/converter/`
3. The Bruno DevWeb Converter page should load ✓
4. Try converting a collection to verify the full flow works ✓

---

## PART E — Verify After Server Restart

After the Windows team restarts the server:
1. Wait 1–2 minutes for IIS to start
2. Browse to: `https://loadrunner.webdev.banksvcs.net/converter/`
3. It should load automatically — no manual steps needed ✓

IIS automatically starts Node.js on the first request after reboot.

---

## PART F — Updating the Application

When a new version is released:

1. Copy new files to `D:\MSINetData\WWW\converter\` (overwrite existing)
2. If `package.json` changed:
   - Open Command Prompt
   - Run:
     ```
     cd D:\MSINetData\WWW\converter
     npm install --production
     ```
3. iisnode automatically detects file changes and restarts Node.js
4. No IIS restart needed ✓

---

## Troubleshooting

### Page shows "500 Internal Server Error"
- Node.js error in the app
- Check: `D:\MSINetData\WWW\converter\logs\` — open the latest log file
- Most common cause: `npm install` was not run

### Page shows "404 Not Found"
- `web.config` is missing or saved as `web.config.txt`
- OR the "Convert to Application" step (Part C) was not done

### Page shows "500.19 — web.config error"
- `web.config` content has a typo or formatting issue
- Recreate the file using the exact content from Part B4

### Page shows "500.21 — iisnode handler not found"
- iisnode module not installed (Part A2 not done)
- Reinstall iisnode

### URL Rewrite error in web.config
- URL Rewrite module not installed (Part A3 not done)
- Install URL Rewrite module

### node_modules folder is very large / copy takes too long
- Do NOT copy `node_modules` from developer machine
- Run `npm install --production` on the server instead (Part B3)
- This installs only what's needed (no dev tools)

---

## Quick Reference

| Item | Location |
|------|----------|
| Application files | `D:\MSINetData\WWW\converter\` |
| Log files | `D:\MSINetData\WWW\converter\logs\` |
| IIS config file | `D:\MSINetData\WWW\converter\web.config` |
| Public URL | `https://loadrunner.webdev.banksvcs.net/converter/` |
| Node.js (after install) | `C:\Program Files\nodejs\node.exe` |

---

## Appendix — Fallback: ARR Reverse Proxy

> Only use this if iisnode does not work for any reason.

### What changes vs iisnode approach:
- Node.js runs as a **Windows Service** (NSSM) on port 3001
- IIS **reverse proxies** `/converter/` requests to `localhost:3001`
- Requires enabling **ARR global proxy** in IIS

### Additional steps needed:

**1. Install NSSM** (download from `https://nssm.cc/download`, place `nssm.exe` in `D:\Tools\nssm\`)

**2. Run Node.js as Windows Service** (Command Prompt as Administrator):
```cmd
D:\Tools\nssm\nssm.exe install BrunoConverter "C:\Program Files\nodejs\node.exe"
D:\Tools\nssm\nssm.exe set BrunoConverter AppDirectory "D:\MSINetData\WWW\converter"
D:\Tools\nssm\nssm.exe set BrunoConverter AppParameters "src/web/server.js"
D:\Tools\nssm\nssm.exe set BrunoConverter AppEnvironmentExtra "PORT=3001"
D:\Tools\nssm\nssm.exe set BrunoConverter Start SERVICE_AUTO_START
D:\Tools\nssm\nssm.exe set BrunoConverter AppStdout "D:\MSINetData\WWW\converter\logs\service.log"
D:\Tools\nssm\nssm.exe set BrunoConverter AppStderr "D:\MSINetData\WWW\converter\logs\error.log"
net start BrunoConverter
```

**3. Enable ARR proxy in IIS:**
- IIS Manager → Server name → Application Request Routing Cache
- Server Proxy Settings → check "Enable proxy" → Apply

**4. Replace web.config content with:**
```xml
<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <system.webServer>
    <rewrite>
      <rules>
        <rule name="BrunoConverter-Proxy" stopProcessing="true">
          <match url="(.*)" />
          <action type="Rewrite" url="http://localhost:3001/{R:1}" />
        </rule>
      </rules>
    </rewrite>
  </system.webServer>
</configuration>
```

**5. "Convert to Application" in IIS Manager** — same as Part C above.

---

*Bruno DevWeb Converter — Deployment Guide v2.7.0*
*Last updated: March 2026*
