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

Launches the browser (a **temporary, throwaway profile** by default — see
"Profile modes" below), connects, and drops you into a prompt:

```
recorder> start
Recording started.
recorder> tx start Login
Transaction started: Login
recorder> tx end
Transaction ended.
recorder> stop my-recording.har
Recording stopped. 14 entries written to my-recording.har
recorder> quit
```

Type `help` at the prompt for the full command list.

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
- No `recorder open <url>` convenience command — navigate manually in the
  browser window the tool launches.
