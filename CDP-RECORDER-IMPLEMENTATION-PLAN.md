# CDP Standalone Recorder — Implementation Plan

**Status:** Phase 1 (minimal capture engine, CLI, no UI) CONFIRMED on the real corporate-managed machine — full `start`/`tx start`/`tx end`/`status`/`stop`/`quit` lifecycle ran clean, 66 entries captured and written to a real HAR file, no errors. Phase 0 is also CONFIRMED there (all 4 automated checks PASS). Raw CDP access, the auto-attach mechanism, and the actual capture pipeline all work in this environment end-to-end. Still open: 2.4 (SSO/Kerberos survives a `--real-profile` relaunch — manual, untested), an explicit popup/new-tab capture test on the corporate machine (the run reported so far didn't confirm one), a multi-target transaction test, and process-cleanup confirmation (`quit` reported no errors, but leftover `msedge.exe` processes haven't been explicitly checked for on that machine).
**Created:** 2026-09-30 · **Phase 0 (local) landed:** 2026-09-30 · **Phase 0 (corporate machine) confirmed:** 2026-09-30 · **Phase 1 (local) landed:** 2026-09-30 · **Phase 1 (corporate machine) confirmed:** 2026-09-30
**Owner:** (assign)
**Prerequisite reading:** `enterprise_browser_performance_recorder_plan.md` (the ChatGPT-authored architecture doc this plan is built on and adapts to this specific codebase)

Update this file as work lands: tick checkboxes, fill in dated notes, append to the Change Log. Don't rewrite history — mark superseded decisions rather than deleting them.

---

## 1. The two problems, kept separate on purpose

| | Problem 1 — Distribution | Problem 2 — Popup/new-tab race |
|---|---|---|
| What | `perfx-recorder-extension` can't be installed — corporate GPO disables "Load unpacked"; only route past it is IT publishing to the Chrome Web Store and allowlisting | Even where the extension *is* loaded, `service-worker.js` attaches to new tabs/popups *reactively* (`chrome.tabs.onCreated` → wait for "loading" → `chrome.debugger.attach()` → `Network.enable()`) — a real race window a fast SSO/redirect popup can beat |
| Root cause | Enterprise extension-management policy | Home-grown per-tab attach instead of CDP's native `Target.setAutoAttach` (can pause a new target at birth until the debugger is ready) |
| Fixed by a CDP-standalone rewrite? | Yes, if raw CDP access is itself permitted (§2) | Yes, *if* built on `Target.setAutoAttach` — not by copying today's reactive pattern |
| Fixable without the rewrite? | No | Yes — smaller, contained change to the existing extension, independent of everything else in this plan |

Keeping these separate matters: if §2's feasibility check fails, Problem 2 is still worth fixing on its own, in the extension, for any environment where the extension does load.

---

## 2. Phase 0 — CDP feasibility probe (the one thing that decides everything else)

**Do not build anything past this phase until it passes.** This is not a formality — extension-install blocks and raw-CDP blocks are different enterprise controls, and it's genuinely unknown which apply here.

**Run this with IT/security's awareness, not quietly.** Two reasons: it's the right way to operate in a bank environment, and CDP-over-WebSocket is a known technique in session-cookie-stealing malware — a mature SOC may have EDR detection for exactly this connection pattern. If this tool is ever going into regular use, it needs the same kind of sanctioned approval the extension needed (§8), not a personal workaround that gets flagged later.

Break the check into independent sub-questions — this fails in layers in practice, not as one yes/no:

- [x] **2.1 — Can the browser launch with a custom flag at all?** `msedge.exe --remote-debugging-port=9333 --user-data-dir=<new-or-existing-profile>`. **PASS on this dev machine, and CONFIRMED PASS on the real corporate-managed machine** (`C:\Workarea\RAM_Projects\...`, Edge at `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`, pid 19172, safe-mode temp profile). AppLocker/SRP typically gates *which binaries* run, not their arguments — confirmed true here, not just assumed.
- [x] **2.2 — Does the port actually open?** **PASS** — `http://localhost:9333/json/version` responded (`Edg/154.0.4258.37` on dev; `Edg/154.0.4258.37` on the corporate machine too). **CONFIRMED on the corporate machine** — this environment does not disable `--remote-debugging-port` via `DeveloperToolsAvailability` or an equivalent policy.
- [x] **2.3 — Can an external process open a WebSocket to it without being blocked/flagged?** **PASS on dev, and CONFIRMED PASS on the corporate machine** — no interference observed, no EDR-shaped reset. This is the check that most directly answers whether raw CDP is viable in this environment, and it is.
- [ ] **2.4 — Does corporate SSO/Kerberos carry over on relaunch?** **Still not tested** — this is real-profile mode (`npm start -- --real-profile`), manual, requires closing the real browser first. The corporate run so far used safe-mode (temp profile), so this remains the one open question before auth-carrying flows can be trusted.
- [x] **2.5 — End-to-end, on a local test page**: **PASS on dev (6 consecutive runs), and CONFIRMED PASS on the corporate machine** (popup target `55E87F42B37EE526A8151864B682A711` paused, attached, resumed, and observed to load — race window closed). `Target.setAutoAttach({waitForDebuggerOnStart: true})` genuinely pauses a newly-opened popup before it can run anything. This is now verified in the actual target environment, not just proven theoretically viable elsewhere — the direct fix for the race bug in today's extension (§1).

**Deliverable — built and working**: `cdp-recorder/probe/` — a small, self-contained TypeScript script (`npm install && npm start`), Node.js + [`chrome-remote-interface`](https://www.npmjs.com/package/chrome-remote-interface) (not Puppeteer, for the reasons in the original plan). Full instructions and safety notes in `cdp-recorder/README.md`.

**Two real bugs found and fixed while building this — worth knowing about since they'll recur in Phase 1 if not carried forward:**

1. **Chromium blocks a *script-triggered* top-level navigation to a `data:` URL** (anti-phishing measure) — the probe's first version had the popup navigate to `data:text/html,...`, which silently never finished loading (the popup opened and attached correctly, `Page.enable`/`Runtime.runIfWaitingForDebugger` both completed without error, but `Page.loadEventFired` simply never arrived — found only by tracing the raw event stream, not from any error message). CDP's own `Page.navigate` is exempt from this restriction, which is why the *driver* page's identical-looking data: URL navigation worked fine — it's specifically `window.open(dataURL)`/script-triggered navigation that's blocked. Fixed by having the popup open to `about:blank` instead. **Implication for Phase 1**: real corporate SSO popups navigate to real `https://` URLs, so this specific trap won't recur there — but it's a good reminder that Chromium's popup/navigation security model has sharp edges worth testing against, not assuming.
2. **`child.kill()` only terminates the one process Node spawned — Chromium is multi-process, and the child renderer/GPU/utility processes it spawns are not Node's children.** First real run left 6 orphaned `msedge.exe` processes and 12 leftover temp profile directories (the rmSync cleanup failed silently on the still-open file handles). Fixed with `taskkill /F /T /PID` (Windows tree-kill) instead of `child.kill()`, plus a short delay before cleanup and retry logic on the directory removal. Verified clean (zero leftover processes, zero leftover directories) across repeated runs afterward. **This matters for Phase 1 too** — the real recorder will launch and eventually need to cleanly release the browser at the end of every session; this exact bug class would otherwise leak a browser process per recording.

**Outcomes:**
- **All pass, including 2.4 on the real corporate machine** → proceed to Phase 1.
- **2.1–2.3 fail there** (even though they pass here) → raw CDP is blocked the same way extensions are on that machine specifically. Stop the standalone track — don't try to work around it (ChatGPT plan §3: never attempt to bypass corporate controls). Redirect effort to the smaller, independent fix: apply `Target.setAutoAttach` to the *existing* extension (closes Problem 2 wherever the extension does run) and pursue Chrome Web Store allowlisting through IT for Problem 1.
- **2.4 has friction, everything else passes** → proceed, but document the relaunch step plainly in the eventual user-facing instructions.

**What this dev-machine result does and doesn't tell us**: it proves the *mechanism* and the *probe script* are both correct — the CDP approach genuinely fixes the popup race when it can run at all. It says nothing about whether the corporate-managed machine's policies allow any of this, since none of the enterprise controls this whole plan is designed around (AppLocker, `DeveloperToolsAvailability`, EDR) are present on this dev box. **§2.1–2.5 still need to be re-run on an actual corporate-managed machine, with IT/security's awareness, before Phase 1 starts.**

---

## 3. Reuse plan — this is a transport swap under proven logic, not a rewrite

Confirmed by direct inspection (not assumed): `perfx-recorder-extension/background/{har-builder,bg-detector,url-normalizer}.js` (644 of 1,223 lines — 53% of the extension's background code) have **zero** dependency on `chrome.*` extension APIs. They're pure functions over CDP event payloads (`Network.requestWillBeSent`, `Network.responseReceived`, etc.), which look identical whether delivered via `chrome.debugger.onEvent` inside an extension or a raw CDP WebSocket in a standalone process.

| Existing file | Reuse plan |
|---|---|
| `har-builder.js` | Port near-verbatim. Add the sensitive-data scrubber here (§6) — currently absent entirely. |
| `bg-detector.js` | Port near-verbatim (background-traffic classification logic, no extension coupling). |
| `url-normalizer.js` | Port verbatim (45 lines, pure string logic). |
| `cdp-capture.js` | **Rewrite the event-source wiring** (currently `chrome.debugger.attach`/`sendCommand`/`onEvent`) to use `chrome-remote-interface`'s session API instead. Keep the event-*handling* logic (how a `Network.requestWillBeSent` payload becomes a HAR entry) — that part isn't extension-specific either. |
| `service-worker.js` | **Rewrite**, not port. Its job (track attached targets, auto-attach new ones, handle Start/Stop/Transaction) maps onto CDP's own `Target` domain (`Target.setAutoAttach`, `Target.attachedToTarget`, `Target.targetDestroyed`) — and doing it this way is what actually fixes Problem 2, not an incidental side effect. |
| `content/gesture-detector.js` | Extension content-script injection has a direct CDP equivalent: `Page.addScriptToEvaluateOnNewDocument` (auto-injects into every new page/frame without needing a content script or an extension at all). |

**Downstream compatibility, also confirmed by direct inspection**: `src/web/public/VuGen-Recorder-parsers.js` already consumes standard HAR 1.2 (`log.pages[]`/`pageref` for transaction grouping) — nothing PerfX-extension-specific. **If the new recorder emits the same HAR shape the extension already does, it plugs directly into the existing VuGen Script Studio / VuGen Recorder pipeline with no changes there.** This removes most of the ChatGPT plan's own Phase 9–11 (it proposes building fresh HAR/DevWeb/LRE exporters from scratch) — that half of the system already exists, and is already tested.

---

## 4. What this plan deliberately does NOT do in V1

Same list the ChatGPT plan correctly insists on, kept here because it matters just as much for this adapted version:

- No Kerberos/SAML/OAuth implementation — the browser authenticates itself; the recorder only *observes* the resulting requests.
- No credential/token/cookie extraction or persistence in raw form.
- No attempt to bypass AppLocker, GPO, EDR, or any corporate control if Phase 0 fails.
- No system-wide proxy changes.
- No administrator privilege requirement.
- No claim that a successfully *recorded* authentication flow is automatically *replayable* in a generated script — mark it "observed," not "replayable" (see §7).
- No full DOM recording, screenshots, or video.
- No automatic correlation in the first pass — build the event model first, correlate later, conservatively (false correlations are worse than missing ones).

---

## 5. Phased delivery

### Phase 0 — CDP feasibility probe
See §2. Everything below is contingent on this passing.

### Phase 1 — Minimal capture engine (CLI, no UI) — DONE (local), 2026-09-30
- [x] `cdp-capture` rewritten against `chrome-remote-interface`, using `Target.setAutoAttach({autoAttach: true, waitForDebuggerOnStart: true, flatten: true})` at the browser session level — this is the actual fix for Problem 2. `cdp-recorder/recorder/src/cdp-capture.ts`: enables `Network.enable` on each newly-attached page session *before* sending `Runtime.runIfWaitingForDebugger`, so nothing the page does after resume is ever missed — a stronger guarantee than the extension's reactive attach ever had. Verified by an end-to-end manual test (real navigation to `https://example.com`, not just `about:blank`): HAR entries came back with full headers, response, and timings, confirming the whole session-keyed event path works, not just that it type-checks.
- [x] Port `har-builder.js`, `bg-detector.js`, `url-normalizer.js` with minimal adaptation — ported byte-identical (zero `chrome.*` dependency, confirmed true), living in `cdp-recorder/recorder/src/`. Only their JSDoc `@param {number} tabId` annotations are now semantically a `sessionId: string` — same opaque-key usage, so imported as `any` in the TS callers rather than fighting stale JSDoc types call-site by call-site.
- [x] CLI: `recorder start`, `recorder stop` → writes `recording.har` in the exact shape the extension already produces. Implemented as an interactive REPL (`cdp-recorder/recorder/src/cli.ts`), not separate process invocations — the CDP connection has to stay open for the whole session, so `start`/`stop`/`tx start`/`tx end`/`status`/`quit` are typed commands at a `recorder>` prompt, matching the extension's session-lifecycle shape (`service-worker.js`'s message handler) without the `chrome.storage.session` / side-panel-port plumbing a CLI doesn't need. Same 600ms SETTLED-fallback timer ported from `service-worker.js` (a page with nothing in flight at Start would otherwise never emit SETTLED).
- [x] Multi-tab and popup tracking — this is what `Target.setAutoAttach` at the browser level gets for free: every new page target (tab or popup) is auto-attached and captured without any `chrome.tabs.onCreated` equivalent at all. Not yet exercised with an actual popup in Phase 1's manual test (that's what Phase 0 §2.5 already proved on its own, real corporate machine included); Phase 1's test covered single-tab navigation only.
- **Resource cleanup verified**: ran the full CLI lifecycle (`start` → `tx start` → `tx end` → `stop` → `quit`) and the manual navigation test back to back, then checked `tasklist` and the temp dir — zero leaked `msedge.exe` processes, zero leftover `cdp-recorder-*` temp dirs. Reuses the exact `killProcessTree`/`taskkill /F /T` fix from the Phase 0 probe (`cdp-recorder/recorder/src/browser-launcher.ts`), so the same leak that bit the probe once didn't reappear here.
- **Not yet done**: run on the actual corporate-managed machine (Phase 0 was; Phase 1 hasn't been yet) — a clean dev-machine run doesn't by itself prove Network.getResponseBody, multi-target capture, etc. behave the same there, though §2's checks already cover the lower-level mechanism this all sits on.

### Phase 2 — Transaction boundaries — DONE as part of Phase 1 above
Folded into Phase 1's CLI rather than built separately: `recorder.ts`'s `startTransaction()`/`endTransaction()` wrap `harBuilder`'s existing transaction methods (unchanged from the extension), driven by the CLI's `tx start <name>` / `tx end` commands. Verified in the manual lifecycle test above. **Not yet verified**: a transaction spanning *multiple concurrently open targets* (main tab + popup) — Phase 1's test only exercised a single target, and this is the specific multi-target tagging behavior §10's acceptance tests call out. Worth an explicit test before relying on it for a popup-heavy flow (e.g. an SSO redirect mid-transaction).

### Phase 3 — Sensitive-data scrubbing (mandatory before this touches anything real)
- [ ] Header scrubber (`Authorization`, cookies) — genuinely missing from the current extension too; add it here first since this is the first point this data would ever be written to disk
- [ ] JSON-body field scrubber (`password`, `secret`, common field-name patterns)
- [ ] Pattern-based detection (JWT shape, bearer tokens) — don't rely on field names alone
- [ ] Raw (unscrubbed) capture mode exists only if explicitly enabled, clearly warned, local-only, and never what gets exported

### Phase 4 — Prove the reuse thesis for real, not just on paper
- [ ] Record a local test page (§9) through the new tool, feed the resulting HAR into the existing VuGen Script Studio / VuGen Recorder pipeline unmodified, confirm it parses and generates a sane script — this is the test that validates §3's whole premise
- [ ] If it *doesn't* just work, that's real, valuable information about where the two HAR shapes actually diverge — fix the narrower gap rather than assuming and building around it

### Phase 5 — Minimal UI — DONE, 2026-10-01 (pulled forward from its original position after Phase 4)
- [x] Decided: a small local web UI, not CLI-only. User feedback after confirming Phase 1 worked end-to-end on the corporate machine: the typed-command REPL was real friction for non-technical users. Built as a plain local webpage (`http://localhost:8787`, `cdp-recorder/recorder/src/control-page.html` + `server.ts`), **not a browser extension** — deliberately, since that's the exact thing the corporate extension-install block (Problem 1, §1) would catch. Visually modeled on `perfx-recorder-extension/sidepanel/sidepanel.html`'s button states and CSS custom-property tokens, reusing its UX concepts as originally planned, just not its packaging.
- [x] Opens automatically in the user's normal browser, separate from the dedicated recording browser this tool launches — the two must never be the same browser context, or the control page's own traffic would pollute the HAR and confuse `Target.setAutoAttach`.
- [x] Status (active/background counts, settled, completed transactions) is polled every ~1s rather than pushed — user explicitly chose simple polling over a WebSocket for this first version.
- [x] `cli.ts`'s REPL removed entirely (user explicitly chose UI-only over UI+CLI) — `main.ts` is the new entry point.
- **Verified against the real HTTP API**, not just type-checked: full start → two transactions (one with real navigation, one with a real popup via `window.open()`) → stop → download cycle, confirmed via `inspect-har.mjs` that both transactions landed with correct entry counts, nothing merged or dropped.
- **Not yet run on the corporate machine** — built and verified locally only so far.

### Phase 6 — Independent, can run in parallel regardless of Phase 0's outcome
- [ ] Apply `Target.setAutoAttach` to the *existing* extension's `cdp-capture.js`/`service-worker.js` — fixes Problem 2 wherever the extension is actually installed, whether or not the standalone track ever ships
- [ ] Pursue Chrome Web Store publishing + IT allowlisting for the extension (Problem 1's only real fix, per your own `CLAUDE.md`) — independent of and not blocked by anything in this plan

---

## 6. Sensitive-data scrubbing — do this early, not last

Unlike the ChatGPT plan's own ordering (Phase 5 of 11), this plan puts it at Phase 3 — before Phase 4 ever writes a HAR file that might be looked at, shared, or fed into the existing pipeline.

**Correction (2026-10-01) to this section's original reference behavior**, found while actually implementing it: the ChatGPT plan's §25 example (redact `Authorization`/`Cookie` headers wholesale to a placeholder) does not survive contact with how `src/web/public/VuGen-Script-Studio-correlation.js`'s `singleHarCorrelate()` actually works — confirmed by reading the code, not assumed. It reads `Authorization`/session-cookie header **values** specifically to detect which ones are dynamic tokens worth extracting into the generated script (`AUTH_HEADER_NAMES`/`SESSION_COOKIE_NAMES` checks around lines 948/1059). Redact those to a fixed placeholder before correlation ever runs, and every request shows the identical literal string — the engine can no longer tell "this token came from that earlier response," which is the entire point of the tool. Full header/cookie scrubbing is incompatible with this project's own correlation engine, not just an oversight to fix later.

What's actually safe to redact, implemented in `cdp-recorder/recorder/src/scrub-har.ts` (Phase 1, shipped 2026-10-01, ahead of the rest of Phase 3): one-way secret fields a script never re-extracts from a prior response — `password`, PIN, CVV, SSN, generic `secret` fields — in request bodies only. Deliberately excludes card/account numbers too: in a banking app specifically, an account number is often legitimately something extracted from one response and reused in another, the same category of problem as cookies.

```
{"password": "secret"}              →  {"password": "[REDACTED]"}     (safe — one-way secret, done)
password=secret&csrf=abc            →  password=[REDACTED]&csrf=abc   (safe — only the password field)
Authorization: Bearer eyJ...        →  left untouched                 (would break correlation if redacted)
Cookie: SESSION=abcdef...           →  left untouched                 (would break correlation if redacted)
```

**The recorded `.har` file still contains real cookies, auth headers, and full response bodies in plaintext.** Handle it like credential material — don't email it, attach it to tickets, or store it longer than needed. This remains an open gap shared with `perfx-recorder-extension`'s HARs too (never scrubbed either) — not a regression introduced by this track.

---

## 7. Authentication — the one conceptual trap to avoid

The ChatGPT plan's §45 makes an important, easy-to-miss distinction, worth restating because it directly matters to what this tool can honestly promise:

**A successful browser recording does not mean the generated performance script can replay the same authentication.** Kerberos/Windows Integrated Auth/client certificates are things the *browser* does, transparently, using the logged-in user's identity — a generated DevWeb/VuGen script has none of that context. Mark every authentication-related event `AUTHENTICATION OBSERVED`, never `AUTHENTICATION REPLAYABLE`. This isn't a nice-to-have label — it's the difference between a script that's honestly incomplete at the auth boundary versus one that silently looks finished and fails (or worse, "succeeds" against a caching layer) the first time it's actually run under load.

---

## 8. Getting this approved, not just working

Mirroring what your own `CLAUDE.md` already says about the extension's path to real usage (Chrome Web Store + IT allowlisting, not a personal workaround) — assume the standalone tool needs the equivalent: explicit IT/security sign-off, likely an EDR exclusion or an approved-software-list entry, before it's something more than one person's local script. Loop this in starting at Phase 0 (§2), not after Phase 5.

---

## 9. Test application (before touching anything real)

Same principle as the ChatGPT plan §57 — build a tiny local test app first, not the real corporate application:

```
localhost:8080
├── /login
├── /home
├── /popup        (window.open, fast redirect chain — the exact shape that breaks today)
├── /newtab
├── /redirect
├── /api/token
└── /api/data
```

Validate Phase 1–4 against this before ever pointing the tool at a real, authenticated corporate app.

---

## 10. Acceptance tests (trimmed to what actually matters for your situation)

- [ ] **Popup race**: `/popup` triggers a `window.open()` that immediately fires 2 redirects before landing — confirm all requests in that chain are captured, none lost. This is the direct regression test for Problem 2.
- [ ] **Multi-target**: two tabs + one popup open simultaneously, each with in-flight requests — confirm no event is attributed to the wrong target.
- [ ] **Transaction spans targets**: `Start Transaction`, click through main tab → popup → back to main tab, `End Transaction` — confirm every request in between is tagged, regardless of which target it happened on.
- [ ] **Sensitive data**: a request with `Authorization`, a session cookie, and a JSON `password` field — confirm the exported HAR contains none of the raw values.
- [ ] **HAR compatibility**: output from this tool, fed into the existing VuGen Script Studio, produces a stub/script the same way an extension-recorded HAR would.
- [ ] **CDP disconnect mid-recording**: doesn't crash, flushes what it has, says plainly that the recording may be incomplete — never silently produces a "complete-looking" recording that's actually missing data.

---

## Change Log

| Date | Change |
|---|---|
| 2026-09-30 | Initial plan drafted, adapting `enterprise_browser_performance_recorder_plan.md` to this specific codebase. Key findings that reshaped it from the original ChatGPT draft: (1) confirmed via direct code inspection that 53% of the existing extension's capture logic has no extension-API dependency and is portable as-is; (2) confirmed the existing HAR-consuming pipeline (VuGen Script Studio) needs no changes if the new tool matches the current HAR shape, eliminating most of the original plan's proposed exporter phases; (3) split Phase 0 feasibility into 5 independent sub-checks instead of one pass/fail, since extension-install and raw-CDP blocks are different enterprise controls that can fail independently; (4) moved sensitive-data scrubbing earlier (Phase 3, not Phase 5); (5) added an explicit "pursue this with IT/security's knowledge" note given CDP-over-WebSocket's overlap with known malware technique, and the bank-environment context already established elsewhere in this project's docs. |
| 2026-09-30 | Phase 0 built and run for real in `cdp-recorder/probe/` (fully isolated, self-contained, deletable folder — see its own README). 4 of 5 automated checks (2.1, 2.2, 2.3, 2.5) PASS on this dev machine, reliably across 6 consecutive runs; 2.4 deliberately deferred to a real corporate machine (manual, requires closing the real browser first). **Two real bugs found and fixed while getting there, not assumed away**: (1) Chromium blocks script-triggered top-level navigation to a `data:` URL — the popup's own navigation silently never completed until switched to `about:blank`, diagnosed by tracing the raw CDP event stream after the generic error-free "it should have worked" path gave no signal; (2) `child.kill()` doesn't terminate Chromium's child processes on Windows — first real run leaked 6 `msedge.exe` processes and 12 temp profile directories, fixed with `taskkill /F /T` and verified clean afterward. **Explicitly not yet done**: running this same probe on an actual corporate-managed machine — a clean local result proves the mechanism and the script both work, it does not answer the question Phase 0 exists to answer. That's the next concrete action before Phase 1 starts. |
| 2026-09-30 | **Phase 0 CONFIRMED on the real corporate-managed machine** (`C:\Workarea\RAM_Projects\bruno-devweb-converter\cdp-recorder\probe`, Edge `Edg/154.0.4258.37`, safe-mode temp profile). All 4 automated checks — 2.1, 2.2, 2.3, 2.5 — PASS, matching the dev-machine result exactly, including the popup-race check (popup target attached, paused, resumed, observed to load). This is the actual answer Phase 0 exists to produce: raw CDP access is not blocked by this bank's AppLocker/SRP, GPO, or EDR, at least not on this machine/profile. Two side observations from the run, neither blocking: `npm install` emitted an "Unknown user config http-proxy" warning (corporate npm proxy config, harmless) and skipped `esbuild@0.28.2`'s postinstall script under `npm warn install-scripts` (an `allowScripts`-style gate on install scripts) — worth remembering for Phase 1+, since a future dependency that *requires* its postinstall step to function could silently misbehave under the same policy; `esbuild`/`tsx` clearly didn't need theirs here. **Only 2.4 (SSO/Kerberos survival across a real-profile relaunch) remains untested** — manual, requires closing the real browser first; do this before trusting the tool on auth-carrying flows. Phase 1 (the actual `cdp-capture` rewrite) can now start on the strength of 2.1/2.2/2.3/2.5. |
| 2026-09-30 | **Phase 1 (minimal capture engine, CLI, no UI) built and verified on the dev machine** in `cdp-recorder/recorder/` (separate subfolder from `probe/`, same "self-contained, deletable" convention). `har-builder.js`, `bg-detector.js`, `url-normalizer.js` ported byte-identical, confirming §3's portability claim in practice, not just in the earlier code-reading analysis. `cdp-capture.ts` is the actual Problem-2 fix, rewritten against `chrome-remote-interface`'s browser-level `Target.setAutoAttach`, replacing `service-worker.js`'s entire reactive `chrome.tabs.onCreated`/`chrome.tabs.onUpdated` attach dance with one call — every new page target, including the very first tab, is paused until Network capture is already on for it. CLI is an interactive REPL (`start`/`stop`/`tx start`/`tx end`/`status`/`quit`) since the CDP connection must stay open for the session's duration. **Verified two ways, not just type-checked**: (1) a full CLI lifecycle test (start → transaction → stop → quit) against `about:blank`, confirming the plumbing and cleanup work; (2) a separate manual integration test driving a real navigation to `https://example.com` via a second CDP connection (simulating a user click), confirming actual HAR entries come back with real headers/response/timing data through the new session-keyed event path — the about:blank test alone couldn't have caught a broken request/response pipeline since it has no traffic. Resource cleanup re-verified clean after both runs (zero leaked `msedge.exe`, zero leftover temp dirs), reusing the probe's `taskkill /F /T` fix unchanged. One real integration bug found while wiring this up: the ported modules' JSDoc (`@param {number} tabId`) no longer matches reality now that the key is a CDP `sessionId: string`, which `tsc` flagged as type errors at every call site — worked around by importing them as `any` rather than fighting stale JSDoc annotations, documented inline. **Not yet done**: running Phase 1 on the actual corporate-managed machine (only Phase 0 has been); a multi-target transaction test (popup + main tab tagged by the same transaction); Phase 3's sensitive-data scrubbing, without which nothing with real credentials should be recorded yet. |
| 2026-09-30 | **Phase 1 CONFIRMED on the real corporate-managed machine** (`C:\Workarea\RAM_Projects\bruno-devweb-converter\cdp-recorder\recorder`). Full lifecycle run: `npm install` (same harmless proxy-config warning and esbuild postinstall skip as the Phase 0 run there), `npm start`, then `start` → `tx start login` → `tx end` → `status` → `stop test-recording.har` → `quit`. 66 entries captured and written to a real HAR file, no errors anywhere in the run. This is the actual capture pipeline — not just the underlying CDP mechanism Phase 0 checked — working end-to-end on the target environment. **Still not confirmed from this run**: whether a popup/new tab opened during recording was actually captured (the transcript shows `tx start` immediately followed by `tx end`, no evidence a popup was triggered in between); a multi-target transaction; and explicit process cleanup (Task Manager not checked after `quit` — the console reported a clean shutdown with no errors, consistent with but not proof of zero leaked `msedge.exe`). Next concrete step: repeat the test specifically triggering a popup/new tab mid-transaction, and check Task Manager after `quit`. |
| 2026-09-30 | **Bug found on the follow-up popup test**: "new tab opened but page is not loading at all" on the corporate machine. Root-caused a real latent bug in `cdp-capture.ts`'s `handleAttached()`: `Network.enable` and the `Runtime.runIfWaitingForDebugger` resume were in one try/catch — if `Network.enable` threw, the resume was never reached and the target stayed paused (blank/frozen) forever. Fixed: resume now runs unconditionally in `finally`, plus added attach/failure console log lines for future diagnosis. **Caveat, stated plainly**: reproduced a real `window.open()`-to-a-real-URL popup locally (a scenario Phase 0's probe never covered — it only ever opened to `about:blank` first) against both the pre-fix and post-fix code, and the pre-fix code actually rendered the popup fine in that specific repro. So this fix closes a real correctness gap, but is **not confirmed** to be the exact cause of what was seen on the corporate machine — could be environment-specific (proxy/security software latency, a different trigger mechanism than plain `window.open()`, e.g. Ctrl+click/middle-click/context-menu "open in new tab", or a slower Network.enable round-trip there than locally). Needs a re-test on the corporate machine with this fix, paying attention to whether the new `[cdp-recorder] new page target attached: ...` log line appears for the stuck tab and whether any `Network.enable failed` warning follows it. |
| 2026-10-01 | **Re-tested on the corporate machine — still frozen, but with a more precise signal this time**: the `[cdp-recorder] new page target attached: ...` log fired for the new tab, and critically, **no** `Network.enable failed`/`FAILED to resume` warning ever printed, yet the page stayed blank indefinitely. That ruled out the previous fix's hypothesis (a throw being swallowed) — the only explanation left is that a CDP command (`Network.enable` or the `Runtime.runIfWaitingForDebugger` resume) was *hanging*, never resolving or rejecting at all. A `try/finally` cannot recover from an `await` that never settles; execution was still parked on it, which is exactly why no warning ever printed. Replaced the error-handling approach with a hard timeout: `sendWithTimeout()` races every attach-path CDP command against a 4s deadline and forces the resume to fire either way, now with a visible "timed out" warning if it does. Verified the race mechanism itself fires correctly (synthetic test with a promise designed to never resolve), and re-confirmed no regression in the normal fast-path popup scenario locally. **Root cause of the hang itself is still not confirmed** — plausible candidates are slower renderer startup under corporate AV/EDR process hooking, or something intercepting loopback CDP traffic, but this fix only bounds the wait rather than explaining it. Needs a third corporate-machine test: does the tab now unfreeze within ~4s, and if so, does a "timed out" warning print alongside it? |
| 2026-10-01 | **Timeout fix CONFIRMED on the corporate machine**: popup opened, `Network.enable timed out ... resuming anyway` printed, and the page loaded properly this time. Phase 0's §2.5 fix (the whole point of this track) is now working end-to-end in the real target environment. Separately, two things surfaced from this same test run, investigated the same day: (1) **Ecosia homepage traffic recorded despite starting the transaction afterward** — confirmed this is by design, not a bug: the recorder captures everything between `start`/`stop`, transactions only tag time windows, so anything that loads before the first `tx start` (Edge's own default homepage, in this case) is correctly present but untagged (`pageref: null`). Documented as expected; Script Studio's existing domain-filter panel is the right tool to exclude it from a generated script. (2) **Two transactions recorded, Script Studio showed only one** — `inspect-har.mjs` confirmed the HAR itself was correct (42+32 entries, correctly split, 0 untagged). Built `diagnose-codegen.mjs`, which runs Script Studio's *actual* production parsing/codegen files in a Node VM against a real HAR outside the browser: ran it against synthetic data shaped exactly like the report, and both VuGen C and DevWeb JS codegen correctly produced two separate transaction blocks. This rules out the HAR format, transaction detection, and code generation — the bug, if confirmed against the user's real file, is downstream in the browser-side UI, not in parsing or generation. **Awaiting the user running `diagnose-codegen.mjs` against their actual `popup-test.har`** to confirm this conclusively before chasing the UI layer. |
| 2026-10-01 | **Phase 5 (minimal UI) built**, pulled forward from its original post-Phase-4 slot — user feedback directly after confirming the recorder works correctly: a typed-command REPL is real friction for non-technical users, and asked for something closer to the extension's sidepanel popup. Decision made explicitly with the user (not assumed): a local web UI (not CLI+UI both), simple polling (not WebSocket) — see the Phase 5 section above for what was built and how it was verified. Key architectural point carried over from Problem 1 (§1): the control page is a plain webpage, not a browser extension, specifically so the corporate extension-install block can't catch it too — and it must run in a different browser context than the dedicated recording browser, or its own traffic would end up in the HAR. |
| 2026-10-01 | **Corporate-machine deployment diagnosis**: a fresh Script Studio bug report ("two transactions recorded, only one shows up") traced all the way down turned out not to be a code bug at all — the corporate machine's `src/web/public/` was out of sync (no `git pull` access there; file transfer had been ad-hoc per-file copy-paste, which is how `diagnose-codegen.mjs` itself briefly regressed mid-session too). `findstr` confirmed the old deleted monolithic `VuGen-Script-Studio-app.js` was still present alongside the current split files, and `VuGen-Script-Studio-correlation.js` genuinely predated `harPages`/pageref support — confirmed by direct inspection of the user's actual `parseHar`/`detectMarkers` function bodies, not inferred. Gave a precise, minimal patch (two function replacements + two new functions) rather than a full ~2250-line file replacement, as the safer option for hand copy-paste; user ultimately found a way to download and replace the whole project from GitHub directly, resolving the drift for good. **Process note for future sessions**: this machine has no `git pull`/`git clone` path — a full project download (browser-based) is the user's working fallback for getting updates there; per-file copy-paste is fragile and already caused one real regression this session. |
| 2026-10-01 | **Floating toolbar replaces the browser-tab control page**: after confirming the UI worked on the corporate machine, user feedback — a full browser tab means juggling two full browser windows, unlike VuGen's own recording toolbar (a separate floating window, not living inside the browser being recorded). Asked for a recommendation between that and other options; floating toolbar was the clear pick, confirmed by the user. `launchAppWindow()` in `browser-launcher.ts` now spawns the control page via Edge/Chrome's `--app=` mode (strips address bar/tabs) in its own isolated profile — still a separate process from the recording browser, same reasoning as before, just packaged to feel like a toolbar rather than a browser tab. `server.ts`'s Quit button now signals `SIGTERM` rather than tearing down in-handler, so it goes through the same unified shutdown path as Ctrl+C (needed so the toolbar's own browser process — which the handler has no direct reference to — actually gets torn down too). Verified via direct process inspection: toolbar launches as a genuinely separate `msedge.exe` (`--app=http://...`), its API responds correctly, and quitting kills both browser processes cleanly (zero leaked processes; two leftover temp dirs were the same pre-existing Windows file-lock timing issue already documented, not a new regression). **Not yet run on the corporate machine.** |
