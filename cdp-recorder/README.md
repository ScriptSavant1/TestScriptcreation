# CDP Recorder

A small Windows program that records a browser journey — including every new tab and pop-up — into a HAR file for the PerfX Studio Recorder and Script Studio. It uses the Chrome DevTools Protocol (CDP) directly, so it needs **no browser extension**. It replaces the retired PerfX Chrome / Edge extension, which corporate Group Policy blocked on several machines.

Users download it from the portal (**Get CDP Recorder** on Home, or the Recorder page) as `cdp-recorder.zip`, extract it, and run `cdp-recorder.exe`. The user-facing guide is the **Recorder** section of Help & guides in the portal, and the local HTML guide `Docs/user/CDP-RECORDER-USER-GUIDE.html` (rebuilt by `recorder/scripts/build-user-guide.mjs`).

Full history and design decisions: `../CDP-RECORDER-IMPLEMENTATION-PLAN.md`.

## Folders

| Folder | What it is |
|---|---|
| `recorder/` | The recorder itself: capture engine, local control toolbar, packaging into a single `.exe`. See [recorder/README.md](recorder/README.md) |
| `recorder/pkg-prototype/` | How the single self-contained `.exe` is built (Node Single Executable Application). See [recorder/pkg-prototype/README.md](recorder/pkg-prototype/README.md) |
| `probe/` | Phase 0 feasibility probe: does raw CDP access work on this machine at all? Kept for diagnosing new machines |

## How it connects to the rest of the repository

The folder is self-contained, with its own `package.json` and `node_modules`. Only three things outside it refer to it:

- `src/web/server.js` serves the built `recorder/dist/cdp-recorder.zip` (falling back to `recorder/dist/cdp-recorder.exe`) at `GET /downloads/cdp-recorder` (also under `/converter`). If neither file is there, the route answers 404 with `cdp_recorder_not_built`.
- `tests/unit/harBuilder.test.js` tests `recorder/src/har-builder.js`.
- The portal (`src/web/public/portal/shell.js`) checks whether a recorder is running on the user's machine (`http://localhost:8787/api/status`) and shows a "Running" badge on the Recorder item in the sidebar.

The HAR it writes is standard HAR 1.2 plus `_perfx_*` fields (transaction pages, background-traffic classification, screenshots). The Recorder and Script Studio read it with no special handling beyond those fields.

## Build and distribute

```bash
cd cdp-recorder/recorder
npm install
npm run build:exe   # writes dist/cdp-recorder.exe and dist/cdp-recorder.zip
npm run build:zip   # re-zips an existing dist/cdp-recorder.exe only
```

`dist/` is not in the repository (the `.exe` is about 90 MB; the ZIP about 35 MB). An administrator copies `cdp-recorder.zip` to `cdp-recorder\recorder\dist\` inside the application folder on the server (see `Docs/deployment/DEPLOYMENT-IIS.md`). The server picks up the new file on the next request. Some corporate proxies block `.exe` downloads, which is why the ZIP is preferred.

## Before you run it against anything real

Run it with your IT / security team's awareness, not quietly. CDP over WebSocket is a legitimate, common automation technique (Playwright, Puppeteer and Selenium's CDP mode all use it) — but it is also a known technique in session-cookie-stealing malware, and a security operations team may have detection for exactly this connection pattern. Be transparent about what it is and why, up front, rather than have it flagged as an incident later. See `../CDP-RECORDER-IMPLEMENTATION-PLAN.md` §2 and §8.

## The Phase 0 probe (`probe/`)

The probe answers one question before anything else: **can a process outside the browser open a CDP connection to your corporate-managed Edge at all?** It was confirmed PASS on both a development machine and a real corporate-managed machine. Use it to check a new kind of machine.

### What the probe does NOT do

- It does not touch your normal, already-open browser profile or windows.
- It does not extract, log or store passwords, cookies, tokens or any credential material — it only checks whether a *connection* is possible.
- It does not try to bypass any corporate control. If a check fails because policy blocks it, the probe reports that and stops.
- It does not install anything system-wide, need administrator rights, or change any browser or OS setting.

### Running the probe

```bash
cd probe
npm install
npm start
```

This launches Edge with a **temporary, throwaway profile** (not your real one — see "Two modes" below) and `--remote-debugging-port`, checks each layer independently, and prints a PASS / FAIL / BLOCKED report for each. It closes the temporary browser itself when done.

### Two modes

- **Default (safe) mode** — uses a fresh temporary profile directory. Tests whether CDP access works *at all* in this environment, without touching your real browsing session or asking you to close anything. This answers the main feasibility question (§2.1–2.3 and §2.5 in the plan).
- **Real-profile mode** (`npm start -- --real-profile`) — attaches to your actual default Edge profile instead, to check whether your corporate SSO / Kerberos identity survives a relaunch with the debug flag (§2.4 in the plan). **This requires closing every open Edge window first** — Edge will not let a second instance attach to a profile that is already in use. The script tells you if Edge is still running and stops rather than forcing it closed. Only run this mode once the default mode has passed.

### Reading the output

The probe prints one line per check, in this shape:

```
[2.1] Launch with custom flag           PASS
[2.2] Remote debugging port opens       PASS
[2.3] External WebSocket connects       PASS
[2.5] Target.setAutoAttach + popup race PASS
```

If anything is `FAIL` or `BLOCKED`, the printed reason tells you which layer stopped it (process launch, the port itself, the WebSocket connection, or the CDP session). Take that detail to `CDP-RECORDER-IMPLEMENTATION-PLAN.md` §2 to decide what happens next.
