# Architecture Decision Records (ADR)

Short records of *why* significant technical choices were made. Drafted by AI,
approved by the project owner. See `documentation-automation-system.md` for
the rule on when new entries are added.

Format: one section per decision, newest first. Each section states the
decision, the context/drivers, the alternatives considered, and the outcome.

---

## ADR-007 — Unit tests use `new Function()` wrapper to load browser globals in Jest
**Date:** 2026-07-29
**Status:** Decided

**Decision:** Browser-side studio files (`studio-advisor.js`, `studio-codegen.js`) and
the extension's ES-module file (`har-builder.js`) are loaded in Jest tests by wrapping
the file content in `new Function()` factory calls rather than refactoring the source
files to export functions.

**Context:** Jest runs in Node.js (CommonJS, `testEnvironment: 'node'`). The studio
files are browser globals with no `module.exports`. `har-builder.js` uses ES module
`export` syntax. Adding Babel/ESM transforms to `jest.config.js` would risk breaking
the existing two test files. Refactoring source files to dual-export (CommonJS +
browser) would add maintenance overhead.

**Alternatives considered:**
- Add `@babel/preset-env` transform → rejected (adds build tooling risk)
- Enable `--experimental-vm-modules` for ESM Jest support → rejected (experimental
  flag, would affect all tests)
- Extract pure logic into shared Node-compatible modules → good long-term goal, out of
  scope for the immediate governance-gap fix

**Outcome:** `new Function('S', code + '\nreturn { fnName };')` loads the file in a
function scope, exposing only the named exports needed for testing. Side effects
(global-assignment code that runs at module load) are guarded by passing a minimal stub
for `S`. This approach is contained to three test files and has zero impact on the
production code or the extension build.

---

## ADR-006 — Extension distribution via download ZIP, not Chrome Web Store
**Date:** 2026-07 (confirmed during BUG-EXT-012 session)
**Status:** Decided

**Decision:** The PerfX Recorder Extension is distributed as a downloadable ZIP from
the tool's home page, not published to the Chrome Web Store.

**Context:** The tool is an internal enterprise product deployed on a customer-managed
IIS server. Publishing to the Chrome Web Store requires a Google developer account,
review turnaround, and makes the extension publicly searchable. The target users are
performance engineers operating within a single enterprise network; distribution via the
home page ZIP keeps the extension private and allows instant iteration.

**Corporate browser policy finding:** Enterprises using Chrome managed via a Group
Policy Object (e.g. `rbsconnect.rbs.com`) will block "Load unpacked" via policy. In
those environments the only way to allowlist an extension is via Chrome Web Store
publication followed by an IT allowlist request — `Load unpacked` cannot be enabled by
the user. This is a known limitation: document in the help UI and raise with IT when
encountered.

**Alternatives considered:**
- Chrome Web Store (CWS) publish → rejected for initial internal release (review delay,
  public visibility, increased maintenance); remains the path for future enterprise
  rollout if Group Policy conflicts become common
- Enterprise policy (JSON allowlist) without CWS → requires IT to manage Chrome policy
  files; more complex for customers than a ZIP download
- Browser extension API polyfill for Firefox/Safari → deferred; current target is
  Chromium (Chrome + Edge) only

**Outcome:** ZIP download from home page is the current distribution channel. Edge and
Chrome are both supported (extension uses standard MV3 APIs, tested in both). If CWS
publication is ever requested, the extension zip is already structured for submission.

---

## ADR-005 — Phase 4B: Monolith split (VuGen-Script-Studio-app.js → 3 files)
**Date:** 2026-06 (Phase 4B)
**Status:** Decided

**Decision:** The ~5200-line `VuGen-Script-Studio-app.js` monolith was split into three
files: `studio-app.js` (orchestrator + live state), `studio-codegen.js` (code
generation helpers), and `studio-ui.js` (advisor UI, modals, card rendering). The
original file was deleted (commit `d641ddc`).

**Context:** At ~5200 lines the monolith had become too large to read, edit, or review
safely. Any change required scanning the full file for unintended side effects. The
split was driven by the natural responsibility boundaries already present in the code:
orchestration/state vs. code generation vs. UI rendering.

**Alternatives considered:**
- Keep the monolith, add internal section markers → rejected; the file was simply too
  large to navigate and the problem would worsen over time
- Split into more than 3 files → rejected; 3 files maps cleanly to the three
  responsibilities and avoids over-engineering

**Load order dependency:** The split imposes a strict script load order in
`VuGen-Script-Studio.html`. The order is: `vugen-codegen.js` → `*-constants.js` →
`*-correlation.js` → `studio-codegen.js` → `studio-advisor.js` → `studio-ui.js` →
`studio-app.js`. Any future file splits must preserve this dependency graph.

**Outcome:** The three-file architecture is now the permanent structure. The monolith
MUST NOT be recreated — all functions live in one of the three split files. This is
documented in CLAUDE.md under "Critical File Map" and "Phase history."

---

## ADR-004 — Web privacy model: multer.memoryStorage() + in-memory FS interceptor
**Date:** 2026-05
**Status:** Decided

**Decision:** All uploaded files in the web app (HAR, collections, certificates) are
processed entirely in RAM. No file is written to disk at any point. ZIP output is
streamed directly to the browser response.

**Implementation:** `multer.memoryStorage()` keeps uploaded files as `Buffer` objects.
A custom `memoryFsInterceptor.js` (using Node.js `AsyncLocalStorage`) intercepts all
`fs.writeFile` / `fs.readFile` calls within a request's async context and redirects
them to an in-memory `Map`. The ZIP is built from this in-memory map and streamed in
the HTTP response body.

**Context:** The tool is deployed on customer-managed IIS servers. Users upload HAR
files and collection files that may contain session tokens, credentials, and internal
API details. Writing these to disk (even temporarily) creates a data exposure risk
under enterprise security policies. In-memory processing eliminates the risk.

**Alternatives considered:**
- Write to a temp directory and delete after → rejected; temp files can persist if the
  process crashes; deletion timing is non-trivial under concurrent load
- Write to a customer-controlled temp path → rejected; complicates deployment and
  doesn't eliminate the data-at-rest risk

**Outcome:** The `memoryFsInterceptor.js` is the single mechanism for this guarantee.
It is loaded in `server.js` before the route handlers. The CLI path (non-web) is
unaffected and writes normally to disk. Any future route that must handle file output
MUST go through the interceptor; never add direct `fs.writeFile` calls in a web
request context.

---

## ADR-003 — CDP via chrome.debugger API for extension (not proxy-based recording)
**Date:** 2026-06
**Status:** Decided

**Decision:** The PerfX Recorder Extension captures network traffic using the Chrome
Debugger Protocol (CDP) via `chrome.debugger.sendCommand`, not via a proxy or
DevTools Protocol over WebSockets.

**Context:** The classic recording approach (VuGen, Fiddler) requires installing a
system proxy, which is blocked by enterprise Group Policy on VCSE machines. The
bookmarklet/HAR approach requires DevTools open and is awkward on apps with popups.
CDP via the `debugger` permission gives direct access to all network events — including
requests from popups, service workers, and background tabs — without a proxy.

**Trade-offs:**
- `debugger` permission triggers a "debugger attached" banner in Chrome → accepted;
  this is visible to the user and serves as confirmation that recording is active
- Requires `minimum_chrome_version: "114"` (side panel API) → acceptable for current
  enterprise Chromium versions
- CDP body fetch adds latency at stop time → mitigated by 2000ms timeout with graceful
  fallback via `pendingBodyFetches`

**Outcome:** The extension is MV3, uses the `debugger` + `sidePanel` + `tabs` +
`storage` permissions with `<all_urls>` host permissions, and is structured as a
service worker (`background/service-worker.js`) per MV3 requirements. This architecture
is fixed — switching to a proxy model would require rewriting the extension from scratch.

---

## ADR-002 — Bookmarklet approach for Classic (browser-native) recording
**Date:** 2026-04
**Status:** Decided

**Decision:** The "classic" recording path for the Recorder tool uses a bookmarklet
(a JavaScript `href` executed from the browser toolbar) to mark the start of a recording
session in the HAR file, rather than requiring browser DevTools to be open or a proxy
to be installed.

**Context:** VCSE machines block proxy installation. DevTools-based HAR export exists
but gives no transaction markers. A bookmarklet injected into the browser's bookmark bar
requires no installation, no permissions, and no proxy — it runs inside the existing
page context.

**Alternatives considered:**
- Browser extension → preferred (now implemented as PerfX Recorder Extension); the
  bookmarklet path remains as a fallback for environments where extension install is
  also blocked
- DevTools Network tab `Export HAR` only → no transaction markers, poorer script quality

**Outcome:** Both paths co-exist: bookmarklet for minimal-friction start, Extension for
full transaction management and multi-tab support.

---

## ADR-001 — Studio-advisor.js Independence Rule: zero external dependencies
**Date:** 2026-05
**Status:** Decided

**Decision:** `studio-advisor.js` (the Correlation Advisor detection engine) has zero
dependencies on any other studio module. It reads only `S.entries1` and `S.correlations`
via the shared global `S`. It never imports, calls, or references `studio-codegen.js`,
`studio-ui.js`, or `studio-app.js`.

**Context:** The Correlation Advisor was originally part of the monolith. During the
Phase 4B split, isolation was deliberately enforced so the detection engine can be:
1. Tested independently (only needs `S.entries1` — no mocked code generators or UI)
2. Safely refactored without risk of breaking code generation or UI rendering
3. Loaded as a standalone worker if parallelization is ever needed

**Alternatives considered:**
- Allow advisor to call UI helpers for candidate formatting → rejected; UI and detection
  concerns are separate; formatting belongs in `studio-ui.js` post-detection

**Outcome:** The Independence Rule is a hard constraint documented in CLAUDE.md §5.
Any PR that adds an import from `studio-advisor.js` into another studio file must be
reviewed against this decision.
