# Changelog — PerfX Studio (Bruno DevWeb Converter)
# Append-only. Newest entries at top.

---

## [Unreleased] — branch: best_Practices

### Added — PerfX Recorder Extension download (home page)
Users can now download the PerfX Chrome extension directly from the home page without any new
user-facing URL. A banner card between the tool grid and "Which tool?" section shows the
extension, a comparison table (Bookmarklet vs Extension), and a 5-step install guide modal.

Implementation:
- `src/web/views/index.ejs`: extension banner HTML, modal HTML (comparison table + install steps),
  CSS for banner + modal components, `openExtModal()` / `closeExtModal()` JS
- `src/web/server.js`: `GET /downloads/recorder-extension` route — ZIPs
  `perfx-recorder-extension/` on demand via `archiver` and streams to browser
- Recorder card description updated to mention both recording methods
- Help section updated with "Two ways to record" callout + link to modal

---

### Fixed (BUG-044) — studio-advisor.js
CSRF / anti-forgery tokens (`authenticity_token`, `csrf_token`, `__RequestVerificationToken`,
`csrfmiddlewaretoken`, and 11 other well-known field names) were not auto-correlated in
single-HAR Script Studio uploads.

Root cause: The Correlation Advisor Phase 1 only extracts values from JSON response bodies. The
HTML login page that contains `<input type="hidden" name="authenticity_token">` is a Document-type
navigation request and is filtered before Phase 1 runs. Phase 2 (cross-reference) therefore never
finds the token value in its responseValueMap, so no correlation candidate is generated. Two-HAR
diff mode was unaffected because it detects by value CHANGE between sessions, not by source lookup.

Fix: Added Phase 2.5 (`_advCsrfScan`) to `studio-advisor.js`. Scans each request's form body for
fields whose name matches `_CSRF_FIELD_RE` (14 patterns). For each match, backward-scans all
preceding response bodies (including HTML) for the literal token value. Emits high-confidence
boundary-extractor candidates. Integrated into `advisorScan()` between Phase 2 and Phase 3.

Files changed: `src/web/public/studio-advisor.js`

---

### Fixed (BUG-043) — studio-codegen.js
Login/username fields (and any other fields matching `PARAM_KEYS_MAP` patterns such as `email`,
`usr`, `user_name`) were not parameterized in generated scripts despite the matching pattern
existing in `PARAM_KEYS_MAP`.

Root cause: In `processField()` inside `detectParams()`, the `corrValues.has(sv)` gate ran before
`matchParamKey(key)`. If the username value (e.g. `"ScriptSavant1"`) was also the value of an
existing correlation (e.g. the same string appeared in a URL path segment that the Advisor had
correlated), the corrValues gate triggered an early return and the param-key check never executed.
The credential field was left hardcoded in the generated script body.

Fix: `isKnownParam = !!matchParamKey(key)` is computed first. Known param fields bypass the
corrValues gate entirely and always emit a `load.params.Username` / `load.params.Password`
substitution. The dynamic-value (isDynamic) gate also uses `isKnownParam` as an override.

Files changed: `src/web/public/studio-codegen.js`

---

### Fixed (BUG-042) — studio-codegen.js
`timestamp` fields containing a 13-digit millisecond epoch value were generated as
`${getEpochMsDaysAgo(0)}` (returns UTC midnight of the current day) instead of `${Date.now()}`
(current time at runtime).

Root cause: `detectDateSubstitution()` returned `{fn:"getEpochMsDaysAgo", arg:0}` when the value
matched today's date. The helper `getEpochMsDaysAgo(n)` uses `d.setUTCHours(0,0,0,0)`
unconditionally — correct for past days (rewind to start of that UTC day) but wrong for offset=0
(should be current precise time, not midnight).

Fix: Added `if (offsetDays === 0) return { fn: "Date.now", arg: null };` in
`detectDateSubstitution()`. Renders as `Date.now()` with no helper function emitted (`Date.now`
is a JS built-in; `emitDateHelpers()` silently skips it because it has no entry in its `defs` map).

Files changed: `src/web/public/studio-codegen.js`

---

## v2.10.14 — 2026-07-10 (committed 6bcd0f4)
- Script Studio usage tracking via POST /analytics/track (tool, protocol, filename, requestCount, correlations)
- Admin dashboard redesigned: icon KPI cards, 3-chart top row (doughnut + bar), gradient trend line, heatmap, top machines/files tables, event log with Correlations column
- Exports: CSV, Excel (6 sheets), Word (.docx), Print/PDF

## v2.10.13 — 2026-07-09 (committed d641ddc + follow-ups)
- Deleted dead file VuGen-Script-Studio-app.js (was not loaded by any HTML)
- Fixed DPoP copy bug: removed inverted ! from fs.existsSync in devweb/scriptGenerator.js
- Security hardening: rate limiting, path traversal fix, crypto.randomBytes tokens, helmet(), generic error codes, XSS via JMX/cert fixes, file type allowlist, temp cleanup try/finally, font CDN removed, withTimeout() on conversions
- Concurrency limiter (MAX_CONCURRENT=8) + /converter/status endpoint
- BUG-041: toggleCorrRandSelect() restored from git history into studio-ui.js

## v2.10.12 — 2026-06-xx (committed 318b884)
- BUG-039/038: createJWTFromMap() added to lre-utils.js/dat; 5 formatting defects in generatePerRequestJwtCode fixed

## v2.10.11 — (committed 76367cb)
- BUG-037: All 3 VuGen generators emit "File=lre-utils.js" in SOURCES (not lre-utils.dat); user setup reduced from 3 to 2 steps

## v2.10.10 — (committed 9c8d43e)
- BUG-036: perRequestJwt Map in both generators for multi-JWT collections
- BUG-035: VuGen replaceParameters() _ prefix for JWT output vars fixed (latent bug)

## v2.10.9 — (committed 6fc2e0f)
- BUG-034: setPattern.lastIndex = 0 before every exec() loop (Node 18+ V8 10+ strict lastIndex)
- BUG-033: injectScriptExtractors() bypasses producedAt < i ordering constraint

## v2.10.8 — (committed a7ec1a8)
- REFACTOR-001: refreshJWT() in lre-utils.dat — one web_js_run instead of two ternary calls

## v2.10.7 — (committed 5f961e0)
- BUG-032: load.global.access-token invalid JS → sanitizeVarName() in authenticationHandler.parameterize()
- BUG-031: collection-level Bearer auth now creates extractors — analyzeRequests accepts collection object

## v2.10.6 — (committed 0edf516)
- BUG-031 (part 1): detectConsumedValues step 6 scans collectionAuth for requests with no per-request auth

## v2.10.5 — (committed d2c984c)
- BUG-030: VuGen replaceParameters() — correlation targets use plain {name}, not {_name}

## v2.10.4 — (committed f43b2f5)
- BUG-029: PKCS#1 key + PEM corruption fixes in jwt-helper.js; normalisePem() handles 4 corruption modes

## v2.10.3 — (committed d1baa43)
- BUG-028: VuGen JWT init moved to vuser_init.c; expiry-check refresh ternary in Action.c
