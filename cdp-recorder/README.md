# CDP Standalone Recorder — experimental track

**This entire folder is self-contained and safe to delete.** Nothing outside
`cdp-recorder/` depends on anything in here, and nothing in here touches the
existing `perfx-recorder-extension/`, `src/web/`, or any other part of this
repo. If Phase 0 (below) shows raw CDP access is blocked in your corporate
environment, delete this folder and nothing else needs to change — see
`../CDP-RECORDER-IMPLEMENTATION-PLAN.md` for what to do instead (§2's
"if 2.1–2.3 fail" note).

## Two subfolders

- **`probe/`** — Phase 0's feasibility probe. Answers one yes/no question
  (does raw CDP access work here at all?) and does nothing else. Confirmed
  PASS on both the dev machine and the real corporate-managed machine — see
  `../CDP-RECORDER-IMPLEMENTATION-PLAN.md` §2.
- **`recorder/`** — Phase 1's actual capture engine. A CLI tool that records
  real HAR files, built on the mechanism `probe/` proved viable. See
  `recorder/README.md`.

## What this is

The feasibility probe for a possible extension-free recorder, described in
`../CDP-RECORDER-IMPLEMENTATION-PLAN.md`. It answers one question before
anything else gets built: **can a process outside the browser open a CDP
connection to your corporate-managed Edge at all?**

## Before you run this

Read `../CDP-RECORDER-IMPLEMENTATION-PLAN.md` §2 and §8 first. In short:
run this with your IT/security team's awareness, not quietly. CDP-over-
WebSocket is a legitimate, common automation technique (Playwright, Puppeteer,
and Selenium's CDP mode all use it) — but it's also a known technique in
session-cookie-stealing malware, and a bank's SOC may have detection for
exactly this connection pattern. Better to be transparent about what this is
and why, up front, than to have it flagged as an incident later.

## What it does NOT do

- Does not touch your normal, already-open browser profile or windows.
- Does not extract, log, or store passwords, cookies, tokens, or any
  credential material — it only checks whether a *connection* is possible.
- Does not attempt to bypass any corporate control. If a check fails because
  policy blocks it, the probe reports that and stops — it does not try a
  workaround.
- Does not install anything system-wide, require administrator rights, or
  change any browser/OS setting.

## Running it

```bash
cd probe
npm install
npm start
```

This launches Edge with a **temporary, throwaway profile** (not your real
one — see "Two modes" below) and `--remote-debugging-port`, checks five
things independently, and prints a PASS/FAIL/BLOCKED report for each. It
closes the temporary browser instance itself when done.

## Two modes

- **Default (safe) mode** — uses a fresh temporary profile directory. Tests
  whether CDP access works *at all* in this environment, without touching
  your real browsing session or requiring you to close anything. This is
  enough to answer the main feasibility question (§2.1–2.3, §2.5 in the
  plan).
- **Real-profile mode** (`npm start -- --real-profile`) — attaches to your
  actual default Edge profile instead, to specifically check whether your
  corporate SSO/Kerberos identity survives a relaunch with the debug flag
  (§2.4 in the plan). **This requires fully closing every open Edge window
  first** — Edge won't let a second instance attach to a profile that's
  already in use. The script will tell you if it detects Edge is still
  running and stop rather than trying to force it closed. Only run this
  mode once the default mode has already passed.

## Reading the output

The script prints one line per check, in this shape:

```
[2.1] Launch with custom flag           PASS
[2.2] Remote debugging port opens       PASS
[2.3] External WebSocket connects       PASS
[2.5] Target.setAutoAttach + popup race PASS
```

If anything is `FAIL` or `BLOCKED`, the printed reason tells you which layer
stopped it (process launch, the port itself, the WebSocket connection, or
the CDP session) — that's the detail to bring back to
`CDP-RECORDER-IMPLEMENTATION-PLAN.md` §2 to decide what happens next.
