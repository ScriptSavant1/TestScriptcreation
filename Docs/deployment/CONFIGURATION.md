# LRE Toolkit — Configuration Reference

**Version:** 2.9.2 | **Date:** May 2026

---

## Environment Variables

| Variable | Default | Required | Description |
|---|---|---|---|
| `PORT` | `3000` | No | HTTP port to listen on (local dev only; iisnode ignores this) |
| `NODE_ENV` | `development` | Recommended | Set to `production` in IIS. Enables Express production mode. |

---

## Portal Feature Flags

Edit `PORTAL_CONFIG` in [src/web/views/index.ejs](../../src/web/views/index.ejs) to control which tabs appear in the portal navigation.

```javascript
const PORTAL_CONFIG = {
  tabs: {
    home:      { enabled: true  },
    converter: { enabled: true  },
    recorder:  { enabled: true  },   // set false to hide the Recorder tab
    studio:    { enabled: true  },   // set false to hide Script Studio tab
    help:      { enabled: true  }
  }
};
```

Setting a tab to `enabled: false` hides it from the navigation bar. The underlying tool is not deleted — this is a display-only toggle.

---

## "Both Formats" Output Option

The Script Studio and Recorder tools have a hidden "Both formats" option that would generate DevWeb AND VuGen C in the same ZIP. This is currently hidden in the UI.

To enable it, remove `style="display:none"` from:
- `#fc-both` in `VuGen-Recorder.html` (Recorder)
- `#fmt-both` in `VuGen-Script-Studio.html` (Studio)

---

## Download Token Expiry

Download tokens expire after **5 minutes** and are single-use. To change the timeout:

In [src/web/server.js](../../src/web/server.js), find the cleanup/expiry logic and adjust the timeout value.

---

## Upload Size Limits

### multer (Node.js)

In [src/web/server.js](../../src/web/server.js), find the multer configuration:

```javascript
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 100 * 1024 * 1024 }  // 100MB per file
});
```

### IIS

In `web.config`:

```xml
<requestFiltering>
    <requestLimits maxAllowedContentLength="104857600" />  <!-- 100MB -->
</requestFiltering>
```

```xml
<system.web>
    <httpRuntime maxRequestLength="102400" />  <!-- 100MB in KB -->
</system.web>
```

Both limits must be increased together if you need to support larger files.

---

## iisnode Configuration

In `web.config`, the `<iisnode>` element controls Node.js process management:

```xml
<iisnode
  node_env="production"
  nodeProcessCommandLine="&quot;C:\Program Files\nodejs\node.exe&quot;"
  debuggingEnabled="false"
  logDirectory="iisnode"
  watchedFiles="*.js;iisnode.yml"
  maxRequestBodySize="104857600"
  maxNamedPipeConnectionPoolSize="512"
  maxNamedPipeConnectionRetry="100"
  namedPipeConnectionRetryDelay="250"
  maxRequestBodySize="104857600"
  devErrorsEnabled="false"
/>
```

| Setting | Purpose |
|---|---|
| `debuggingEnabled` | Must be `false` in production |
| `devErrorsEnabled` | Set `false` in production (hides stack traces) |
| `maxRequestBodySize` | Max upload size in bytes |
| `logDirectory` | Where iisnode writes stdout/stderr logs |
| `watchedFiles` | Triggers Node.js process restart when these files change |

---

## Think Time Defaults

The toolkit generates a default think time between requests. The default is configurable from the UI (1s, 2s, 3s, or 5s). If the collection has explicitly set think times, those are used instead.

To change the fallback default in the Converter:

In [src/generators/advancedScriptGenerator.js](../../src/generators/advancedScriptGenerator.js) and [src/generators/webHttpScriptGenerator.js](../../src/generators/webHttpScriptGenerator.js), find `thinkTime` in the constructor and change the default value.

---

## Version Number

The version shown in the portal navigation bar comes from the `version` field in [package.json](../../package.json).

```json
{
  "version": "2.9.2"
}
```

Update this when releasing a new version.

---

## IIS Application Pool — Multiple Node.js Processes

iisnode can run multiple Node.js processes for high-concurrency scenarios. In `web.config`:

```xml
<iisnode
  nodeProcessCountPerApplication="4"
/>
```

`4` means 4 Node.js processes, one per CPU core (recommended: match your CPU core count). IIS distributes requests across them. Each process is independent — `AsyncLocalStorage` isolation works correctly across processes.

For typical performance engineering team usage (10–20 concurrent users), 1 process is sufficient.

---

## Proxy Configuration for Outbound Requests

The LRE Toolkit makes **no outbound HTTP requests**. There is no proxy configuration needed for the server itself.

If corporate policy requires all Node.js outbound requests to use a proxy, you can set system-level proxy environment variables — but they will have no effect on this application since it makes no outbound calls.

---

*See also: [IIS Deployment Guide](DEPLOYMENT-IIS.md) | [Architecture](../technical/ARCHITECTURE.md)*
