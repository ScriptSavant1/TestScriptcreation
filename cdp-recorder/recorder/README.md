# CDP Recorder — Phase 1 capture engine

The real recorder, built on the mechanism the Phase 0 probe (`../probe/`)
proved viable — including on the actual corporate-managed machine (see
`../../CDP-RECORDER-IMPLEMENTATION-PLAN.md` §2). Produces a standard HAR 1.2
file compatible with the existing `VuGen-Recorder-parsers.js` / VuGen Script
Studio pipeline, same as `perfx-recorder-extension` does today — no changes
needed on that side.

## Before you run this against anything real

Same posture as the probe: run with your IT/security team's awareness, not
quietly. See `../README.md` and plan §8.

## Running it

```bash
npm install
npm start
```

This launches two separate browser processes:

1. A **dedicated, isolated recording browser** (a temporary, throwaway
   profile by default — see "Profile modes" below) — this is the one you
   actually browse your target application in.
2. A **floating control toolbar** — a small, chrome-less window (no address
   bar or tabs, via Edge/Chrome's `--app=` mode) with Start/Stop Recording
   and Start/End Transaction buttons, modeled on
   `perfx-recorder-extension/sidepanel/sidepanel.html`'s layout. The closest
   equivalent to VuGen's own recording toolbar: a separate floating window,
   not something living inside the browser being recorded.

These are deliberately separate processes with separate profiles: the
control toolbar is a plain local webpage (`http://localhost:8787` by
default) opened in its own minimal browser window, not a browser extension,
so it isn't affected by the corporate extension-install block this whole
project exists to work around. It must also stay out of the dedicated
recording browser — if it ran there, its own traffic (status polling) would
pollute the HAR and it would get needlessly captured by
`Target.setAutoAttach`.

If the floating toolbar fails to open for any reason, the terminal prints
the control page's URL and falls back to opening it as a normal tab in your
default browser instead. Status (active/background request counts,
"settled", completed transactions) refreshes every ~1s by polling — no
WebSocket dependency.

Press Ctrl+C in the terminal, or click **Quit** on the control page, to stop
everything and clean up the recording browser.

### Options

- `--out <dir>` — where recorded `.har` files are written (default: current directory)
- `--ui-port <n>` — control page port (default 8787)
- `--cdp-port <n>` — CDP debug port for the dedicated recording browser (default 9333)
- `--profile <dir>` / `--real-profile` — see "Profile modes" below

## Profile modes

Same three modes as the probe, same reasoning:

- **Default (temporary)** — fresh throwaway profile, deleted when you quit.
  No login persists between runs. Fine for anything that doesn't need your
  corporate SSO session.
- **`--profile <dir>`** — a persistent custom profile directory you point at
  yourself. Log in once, it stays logged in on the next run. This is the
  practical middle ground for repeated real recordings without touching your
  actual default profile.
- **`--real-profile`** — your actual default Edge profile. Requires closing
  every open Edge window first (Edge won't let a second instance attach to a
  profile already in use). Only use this once §2.4 in the plan has been
  confirmed on your machine (SSO survives the relaunch) — untested as of
  this writing.

## What changed vs. the extension (`perfx-recorder-extension`)

`bg-detector.js`, `har-builder.js`, and `url-normalizer.js` are ported
**unchanged** — zero `chrome.*` dependency, confirmed at planning time (plan
§3). Only `cdp-capture.js` → `cdp-capture.ts` actually changed, and the
change is the point of this whole track: instead of the extension's reactive
`chrome.tabs.onCreated` → wait for "loading" → `chrome.debugger.attach()`
dance (a real race a fast popup can beat), this uses
`Target.setAutoAttach({waitForDebuggerOnStart: true})` at the browser-session
level, which pauses every new target — including the very first tab — before
anything on it can run, and turns Network capture on before ever resuming it.
Verified end-to-end by the Phase 0 probe's §2.5 check, on both the dev
machine and the real corporate-managed one.

## What this does NOT do yet

- No sensitive-data scrubbing (plan §6, Phase 3) — don't record anything
  with real credentials in it until that lands.
- No background-vs-foreground UI surfacing (the classification data is in
  the HAR's `_perfx_*` fields, same as the extension, but nothing displays
  it yet — that's Phase 5+ / studio-side work).
- No "open this URL for me" convenience — navigate manually in the dedicated
  recording browser window.

## Diagnostic scripts

Two standalone scripts for troubleshooting a specific recorded `.har`
without needing to open it in a browser:

- `node inspect-har.mjs <file.har>` — prints the transactions recorded and
  how many requests landed in each (and how many fell outside any
  transaction — e.g. traffic from before the first `Start Transaction`).
- `node diagnose-codegen.mjs <file.har>` — runs Script Studio's *actual*
  production parsing and code-generation files (not a reimplementation)
  against the HAR outside the browser, and prints what transactions it
  detects and what the generated VuGen C / DevWeb JS transaction code looks
  like. Useful for telling apart "the HAR itself is wrong" from "Script
  Studio's browser-side UI isn't showing something that's actually there."
