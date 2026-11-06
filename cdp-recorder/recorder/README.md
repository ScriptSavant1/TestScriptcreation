# CDP Recorder — capture engine and toolbar

The recorder that end users run as `cdp-recorder.exe`. It is built on the mechanism the Phase 0 probe (`../probe/`) proved viable — including on a real corporate-managed machine. It produces a standard HAR 1.2 file that the PerfX Studio Recorder (`VuGen-Recorder-parsers.js`) and Script Studio read directly.

## Before you run this against anything real

Same posture as the probe: run it with your IT / security team's awareness, not quietly. See `../README.md`.

## Running it

End users run the packaged `cdp-recorder.exe` (see `pkg-prototype/README.md` for the build). From source, for development:

```bash
npm install
npm start          # tsx src/main.ts
```

Either way, it launches two separate browser processes:

1. A **dedicated, isolated recording browser** (a temporary, throwaway profile by default — see "Profile modes" below). It opens on a "This is the RECORDING window" page and has an orange border; this is the one you browse your target application in.
2. A **floating control toolbar** — a small window with no address bar or tabs (Edge / Chrome `--app=` mode) with **Start Recording** / **Stop Recording**, **Start Transaction** / **End Transaction**, **Download HAR** and **Quit**. It shows live active / background request counts and a trail of completed transactions, and warns when a transaction ends with no requests captured. It is the closest equivalent to VuGen's own recording toolbar: a separate floating window, not something living inside the browser being recorded.

These are deliberately separate processes with separate profiles. The toolbar is a plain local web page (`http://localhost:8787` by default) opened in its own minimal browser window — not a browser extension — so the corporate extension-install block does not affect it. It must also stay out of the recording browser: if it ran there, its own traffic (status polling) would pollute the HAR and it would be captured by `Target.setAutoAttach`.

If the floating toolbar fails to open, the terminal prints the control page's URL and opens it as a normal tab in your default browser instead. Status refreshes about every second by polling — no WebSocket dependency.

When you click **Stop Recording**, the HAR is written to the output folder (by default the folder the program was started from — for a double-clicked `cdp-recorder.exe`, the folder it is in). Press Ctrl+C in the terminal, or click **Quit** on the toolbar, to stop everything and clean up the recording browser and its temporary profiles.

The PerfX Studio portal detects a running recorder through `GET /api/status` on the control port and shows a "Running" badge in its sidebar.

### Options

- `--out <dir>` — where recorded `.har` files are written (default: the current folder)
- `--browser edge|chrome` — which browser to record with (default: Edge, falling back to Chrome when Edge's debug port is blocked). `--browser=chrome` works too
- `--ui-port <n>` — control page port (default 8787)
- `--cdp-port <n>` — CDP debug port for the dedicated recording browser (default: automatic — the browser picks a free port and the recorder reads it from the profile's `DevToolsActivePort` file)
- `--profile <dir>` / `--real-profile` — see "Profile modes" below
- `--portal "<perfx-recorder: link>"` — started by the PerfX Studio Recorder page (see below); not typed by hand

### Control API (local only)

`server.ts` listens on this computer only (127.0.0.1) and serves the toolbar page at `/` and a small JSON API: `GET /api/status`, `POST /api/start`, `POST /api/tx/start`, `POST /api/tx/end`, `POST /api/stop`, `GET /api/download`, `POST /api/quit`, and for the Recorder page `POST /api/session` {url, browser, private, name, firstTx}, `GET /api/live?since=n` (requests seen so far), `POST /api/windows` (keep the windows of a saved recording open, or close them now), `POST /api/allow` (programs only), `POST /api/ask` (any web page — asks to be allowed; the toolbar shows the question) and `POST /api/ask/answer` {portal, allow} (the toolbar only).

Who may call it: the toolbar, programs on this computer (no Origin header), PerfX Studio pages whose origin arrived through a `perfx-recorder:` link, and pages allowed on the toolbar. Any other web page only gets the running / recording counts (the portal sidebar badge) — everything else is refused.

## Recording started from the PerfX Studio Recorder page

Every start of the packaged `cdp-recorder.exe` registers the `perfx-recorder:` link for the current Windows user (`HKCU\Software\Classes\perfx-recorder`, no administrator rights) — so the user extracts the ZIP to a folder that stays and double-clicks the .exe once. After that the Recorder page's **Start recording** opens `perfx-recorder://start?portal=<the portal's origin>`: the browser asks once, the recorder starts and waits (no window yet). The page then sends the address, browser and private-window choice (`/api/session`); the recorder opens the recording window and the toolbar, records, opens the address once capture is confirmed, and on Stop saves `<name>_<date>_<time>.har` to the user's Downloads folder (the redirected one too); the toolbar then says so and the windows close after a 10-second countdown (Keep open / Close windows on the toolbar, `POST /api/windows {action: "keep" | "close"}`). It waits for the next recording and closes itself after an hour without use. A link that arrives while a recorder is running only hands its page to the running one.

Where the browser may not start programs, the link does nothing: the user starts `cdp-recorder.exe` by hand, and the page — seeing a recorder that does not list it (`canAsk` in the bare status) — sends `POST /api/ask`. The toolbar (opened if it is not) shows **Allow this page to start recordings?** with the page's origin; nothing is allowed until **Allow** is clicked. One question at a time, it lapses after two minutes, and after **Don't allow** the same page is not asked about again for a minute. Allowed pages are remembered for the Windows user in `%LOCALAPPDATA%\PerfX\cdp-recorder\allowed-pages.json` (`CDP_RECORDER_ALLOWED_FILE` overrides the path; delete the file to forget them). End-to-end, with the link blocked: `tests-manual/portal-ask.mjs`.

The link carries only the portal's origin — never an application address. Pop-ups and new tabs are captured in private windows too (`tests-manual/private-window-probe.mjs`). End-to-end: `tests-manual/portal-session.mjs [edge|chrome] [private|normal]`; packaged .exe + link: `tests-manual/packaged-link.mjs`; pure helpers: `tests/unit/cdpPortalMode.test.js` in the main repository.

## Profile modes

The same three modes as the probe, for the same reasons:

- **Default (temporary)** — a fresh throwaway profile, deleted when you quit. No login persists between runs. Fine for anything that does not need your corporate SSO session.
- **`--profile <dir>`** — a persistent profile directory you choose. Log in once and it stays logged in on the next run. The practical middle ground for repeated real recordings without touching your actual default profile.
- **`--real-profile`** — your actual default Edge profile. Requires closing every open Edge window first (Edge will not let a second instance attach to a profile already in use). Check first on your machine that your single sign-on survives the relaunch.

## Source files

| File | Purpose |
|---|---|
| `src/main.ts` / `pkg-prototype/entry.ts` | Entry points (sources / packaged .exe) — both call `src/app.ts` |
| `src/app.ts` | Start-up: options, classic start (recording window + toolbar) or portal start (wait for the Recorder page), link registration, shutdown |
| `src/portal-link.ts`, `src/portal-mode.js` | Link registration and the Downloads folder (Windows); pure helpers — link, who may call, session request, file name, live rows |
| `src/recorder.ts` | Session orchestrator — browser process and CDP connection, start / stop / transactions |
| `src/cdp-capture.ts` | CDP Network capture through `Target.setAutoAttach` (new tabs and pop-ups paused before they run) |
| `src/browser-launcher.ts` | Finds Edge / Chrome, creates profiles, launches windows, tears down |
| `src/server.ts` | Local control server and API (above) |
| `src/control-page.html` | The toolbar page |
| `src/har-builder.js` | HAR 1.2 assembler with `_perfx_*` fields (tested by `tests/unit/harBuilder.test.js` in the main repository) |
| `src/bg-detector.js`, `src/url-normalizer.js` | Background-traffic classification and URL normalisation |
| `src/scrub-har.ts` | Narrow sensitive-data redaction (see below) |

## What changed from the retired PerfX browser extension

`bg-detector.js`, `har-builder.js` and `url-normalizer.js` were ported **unchanged** from the extension — they have no `chrome.*` dependency. Only the capture layer changed (`cdp-capture.js` → `cdp-capture.ts`), and that change is the point of this whole track. Instead of the extension's reactive `chrome.tabs.onCreated` → wait for "loading" → `chrome.debugger.attach()` sequence (a real race that a fast pop-up can win), this uses `Target.setAutoAttach({waitForDebuggerOnStart: true})` at the browser-session level. That pauses every new target — including the very first tab — before anything on it can run, and turns Network capture on before resuming it. Verified end-to-end by the probe, on both a development machine and a real corporate-managed one.

A `Network.enable` call that times out on a slow renderer start (seen with corporate AV / EDR overhead) is retried in the background, so a target's first request is not lost.

## Transaction screenshots

Every **Start Transaction** / **End Transaction** takes a screenshot of every open page (the main tab, and any pop-up open at that moment) and embeds it in the HAR, on that transaction's `log.pages[]` entry — `_perfx_screenshots_start` / `_perfx_screenshots_end`, arrays of base64 PNG `data:` URLs. This is not part of the standard HAR 1.2 specification; it follows the same convention as the project's other `_perfx_*` custom fields.

They are not meant to be read as raw base64 text — use `inspect-har.mjs` (below), which extracts them into `.png` files next to the HAR.

## Limits

- Only *narrow* sensitive-data redaction (password / PIN / CVV-type request-body fields — see `scrub-har.ts`). Cookies, auth headers and response bodies are still recorded in full. Do not record anything with real credentials in it without understanding that, and do not share a recorded `.har` casually.
- Background-traffic classification is stored in the HAR's `_perfx_*` fields. The toolbar only shows counts; the per-endpoint review happens in Script Studio ("Background Requests Detected").
- No "open this URL for me" convenience — navigate yourself in the recording window.

## Tests and checks

```bash
npm run typecheck   # tsc --noEmit
npm run test:e2e    # Playwright end-to-end test (tests-manual/repro-multi-tx.mjs)
```

`tests-manual/capture-guide-screenshots.mjs` captures the screenshots used by the HTML user guide; `scripts/build-user-guide.mjs` rebuilds the guide.

## Diagnostic scripts

Two standalone scripts for troubleshooting a recorded `.har` without opening it in a browser:

- `node inspect-har.mjs <file.har>` — prints the transactions recorded and how many requests landed in each (and how many fell outside any transaction — for example traffic from before the first **Start Transaction**). Also extracts any embedded transaction screenshots into `.png` files in a `<file>-screenshots/` folder next to the HAR.
- `node diagnose-codegen.mjs <file.har>` — runs Script Studio's *actual* parsing and code-generation files (not a re-implementation) against the HAR outside the browser, and prints the transactions it detects and the generated VuGen C / DevWeb JS transaction code. Useful for telling "the HAR itself is wrong" apart from "Script Studio's page is not showing something that is actually there".
