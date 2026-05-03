# LRE Toolkit — IIS Deployment Guide

**Version:** 2.9.2 | **Date:** May 2026  
**Platform:** Windows Server 2019 or 2022 · IIS 10 · Node.js 18 LTS · iisnode 0.2.26

---

## Prerequisites

Before starting, ensure the following are installed on the server:

| Component | Version | Download |
|---|---|---|
| Windows Server | 2019 or 2022 | — |
| IIS | 10 (included with Windows Server) | Windows Features |
| IIS URL Rewrite Module | 2.1+ | iis.net (Microsoft download) |
| Node.js | 18 LTS (18.x.x) | nodejs.org |
| iisnode | 0.2.26 | GitHub: Azure/iisnode |
| Git | Latest | git-scm.com (optional — for updates) |

### IIS Features Required

In **Windows Features → Web Server (IIS)**, enable:

- Web Server → Common HTTP Features (all)
- Web Server → Application Development → **CGI**
- Web Server → Application Development → **ISAPI Filters**
- Web Server → Application Development → **ISAPI Extensions**
- Management Tools → IIS Management Console

---

## Step 1: Install Node.js

1. Download Node.js 18 LTS from [nodejs.org](https://nodejs.org)
2. Run the installer as Administrator
3. Verify: open Command Prompt and run `node --version` — should show `v18.x.x`
4. Verify npm: `npm --version`

---

## Step 2: Install IIS URL Rewrite Module

1. Download the **URL Rewrite 2.1** installer from Microsoft's IIS downloads page
2. Run the installer (requires IIS to be installed first)
3. Restart IIS: `iisreset`

---

## Step 3: Install iisnode

1. Download `iisnode-full-v0.2.26.msi` (x64) from the iisnode GitHub releases
2. Run the installer as Administrator
3. The installer registers the iisnode handler in IIS automatically
4. Verify: in IIS Manager → server-level → **Handler Mappings** — you should see an `iisnode` entry

---

## Step 4: Deploy the Application

### 4.1 Create the IIS Site Directory

```
mkdir C:\inetpub\lre-toolkit
```

### 4.2 Copy Application Files

Copy the application to the server. Options:
- **Git clone**: `git clone <repo-url> C:\inetpub\lre-toolkit`
- **ZIP deploy**: extract the application ZIP to `C:\inetpub\lre-toolkit`
- **Robocopy from network share**: `robocopy \\server\share C:\inetpub\lre-toolkit /E`

The directory should contain:
```
C:\inetpub\lre-toolkit\
├── app.js
├── package.json
├── web.config
├── src\
├── DevWebSdk.d.ts
├── jwt-helper.js
├── jsrsasign.js
├── lre-utils.js
└── transport.pem
```

### 4.3 Install Node.js Dependencies

```
cd C:\inetpub\lre-toolkit
npm install --production
```

---

## Step 5: Configure IIS

### 5.1 Create Application Pool

1. Open **IIS Manager** (Start → IIS Manager)
2. Right-click **Application Pools** → **Add Application Pool**
3. Name: `lre-toolkit-pool`
4. .NET CLR Version: **No Managed Code**
5. Managed Pipeline Mode: **Integrated**
6. Click OK

### 5.2 Advanced Settings for Application Pool

Right-click `lre-toolkit-pool` → **Advanced Settings**:

| Setting | Value |
|---|---|
| Identity | `NetworkService` (or a dedicated service account) |
| Start Mode | `AlwaysRunning` |
| Idle Time-out (minutes) | `0` (disable idle timeout) |
| Rapid-Fail Protection → Max Failures | `5` |
| Process Model → Ping Enabled | `False` |

### 5.3 Create the IIS Site (or Application)

**Option A — New Site:**

1. Right-click **Sites** → **Add Website**
2. Site name: `LRE Toolkit`
3. Application Pool: `lre-toolkit-pool`
4. Physical Path: `C:\inetpub\lre-toolkit`
5. Binding: HTTPS, port 443 (or HTTP port 80 for internal-only)
6. SSL Certificate: select your internal CA certificate
7. Click OK

**Option B — Add as Application under Default Web Site:**

1. Right-click `Default Web Site` → **Add Application**
2. Alias: `lre-toolkit`
3. Application Pool: `lre-toolkit-pool`
4. Physical Path: `C:\inetpub\lre-toolkit`
5. Click OK

The toolkit is then available at `https://server/lre-toolkit/converter`

---

## Step 6: Verify web.config

The `web.config` file must exist at the root of the deployment and contain:

```xml
<?xml version="1.0" encoding="utf-8"?>
<configuration>
  <system.webServer>
    
    <!-- iisnode handler — routes all requests through Node.js -->
    <handlers>
      <add name="iisnode" path="app.js" verb="*" modules="iisnode" />
    </handlers>

    <!-- URL rewrite — send all requests to app.js -->
    <rewrite>
      <rules>
        <rule name="NodeInspector" patternSyntax="ECMAScript" stopProcessing="true">
          <match url="^app.js\/debug[\/]?" />
        </rule>
        <rule name="StaticContent">
          <conditions>
            <add input="{REQUEST_FILENAME}" matchType="IsFile" />
          </conditions>
          <action type="None" />
        </rule>
        <rule name="DynamicContent">
          <conditions>
            <add input="{REQUEST_FILENAME}" matchType="IsFile" negate="True" />
          </conditions>
          <action type="Rewrite" url="app.js" />
        </rule>
      </rules>
    </rewrite>

    <!-- iisnode configuration -->
    <iisnode
      node_env="production"
      nodeProcessCommandLine="&quot;C:\Program Files\nodejs\node.exe&quot;"
      debuggingEnabled="false"
      logDirectory="iisnode"
      watchedFiles="*.js;iisnode.yml"
      maxRequestBodySize="104857600"
    />

    <!-- Increase request size limits (100MB for large JMX/HAR files) -->
    <security>
      <requestFiltering>
        <requestLimits maxAllowedContentLength="104857600" />
      </requestFiltering>
    </security>

  </system.webServer>

  <system.web>
    <httpRuntime maxRequestLength="102400" />
  </system.web>
</configuration>
```

**If your web.config doesn't match this exactly**, update it — this is the correct configuration for iisnode + Express URL routing.

---

## Step 7: Set File System Permissions

The IIS Application Pool identity (`NetworkService` or your service account) needs:

| Path | Permission |
|---|---|
| `C:\inetpub\lre-toolkit\` | **Read** (application code — read-only) |
| `C:\inetpub\lre-toolkit\iisnode\` | **Read + Write** (iisnode logs) |
| `C:\Program Files\nodejs\` | **Read + Execute** |

The application does **NOT** need write access to any other folder — all processing is in-memory.

```powershell
# Grant read access to application code
icacls "C:\inetpub\lre-toolkit" /grant "NetworkService:(OI)(CI)R"

# Grant write access for iisnode logs only
New-Item -ItemType Directory -Path "C:\inetpub\lre-toolkit\iisnode" -Force
icacls "C:\inetpub\lre-toolkit\iisnode" /grant "NetworkService:(OI)(CI)F"
```

---

## Step 8: Test the Deployment

1. Open a browser and navigate to `https://your-server/converter` (or `https://your-server/lre-toolkit/converter` if deployed as sub-application)
2. The LRE Toolkit portal should load
3. Test a conversion: upload a small Postman collection and verify the ZIP downloads
4. Test Script Studio: upload a HAR file and verify script generation

### Health Check

Navigate to `https://your-server/` — you should get a redirect to `/converter` or a portal page. A `502 Bad Gateway` means Node.js failed to start. Check the iisnode logs.

---

## Step 9: Configure for Production

### 9.1 Disable Debug Endpoints

In `web.config`, ensure `debuggingEnabled="false"` in the `<iisnode>` element.

### 9.2 Configure IIS Logging

In IIS Manager → Site → Logging, enable W3C logging. Log fields to include:
- Date, Time, Client IP, Method, URI Stem, Status, Bytes Sent

### 9.3 Set Up Application Pool Recycling

In Application Pool → Advanced Settings → Recycling:
- Regular Time Interval: `0` (disable time-based recycling)
- Specific Times: configure a daily recycle at a low-traffic time (e.g. 2:00 AM)

### 9.4 Configure SSL (HTTPS)

1. Obtain an SSL certificate from your internal CA
2. In IIS Manager → Sites → [your site] → Bindings → Add
3. Type: `https`, Port: `443`, SSL certificate: select your certificate

---

## Updating the Application

```powershell
# Navigate to application directory
cd C:\inetpub\lre-toolkit

# Pull latest code (if using git)
git pull origin main

# Install any new dependencies
npm install --production

# Recycle the Application Pool to pick up changes
Invoke-Command { & "$env:SystemRoot\system32\inetsrv\appcmd.exe" recycle apppool /apppool.name:"lre-toolkit-pool" }
```

**No restart of IIS or the server is required** for code changes — only an Application Pool recycle.

---

## iisnode Log Files

iisnode writes stdout/stderr to log files in `C:\inetpub\lre-toolkit\iisnode\`:

- `app.js-xxxxx.txt` — Node.js stdout output (console.log, errors)

Check these files first when troubleshooting `502 Bad Gateway` errors.

---

## Common Deployment Issues

| Symptom | Cause | Fix |
|---|---|---|
| `502 Bad Gateway` | Node.js process crashed | Check iisnode logs; run `node app.js` manually |
| `404 Not Found` | URL rewrite not configured | Verify `web.config` rewrite rules |
| `403 Forbidden` | Application Pool lacks read permission | Check icacls permissions on app directory |
| `413 Request Entity Too Large` | File size exceeds IIS limit | Increase `maxAllowedContentLength` in `web.config` |
| Upload hangs | iisnode `maxRequestBodySize` too low | Increase in `<iisnode>` element |
| `Cannot find module` | `npm install` not run | Run `npm install --production` |
| Application Pool keeps crashing | Rapid-fail triggered | Check Event Log; increase max failures limit |

---

## Environment Variables

Set in Application Pool → Advanced Settings → Environment Variables (or in web.config `<iisnode>` section):

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `PORT` | (not needed — iisnode uses named pipes) |

---

*See also: [Configuration Reference](CONFIGURATION.md) | [Architecture](../technical/ARCHITECTURE.md)*
