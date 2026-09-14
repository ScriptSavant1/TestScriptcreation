# Changelog — PerfX Studio (Bruno DevWeb Converter)
# Append-only. Newest entries at top.

---

## [Unreleased] — branch: best_Practices

### Fixed (BUG-048) — DevWeb primary JWT stored under the wrong variable, sent as undefined
Found while proactively reviewing the JWT path before the user had tested it (not a user
report). `generateInitialize()` and the refresh block in `generateAction()`
(`src/generators/devweb/scriptGenerator.js`) hardcoded `load.global.jwt_token` as the
storage variable for the primary JWT. But `replaceParameters()` substitutes the original
script's real output variable (e.g. `{{client_assertion}}` -> `load.global.client_assertion`,
extracted from `pm.environment.set('client_assertion', ...)` into
`jwtClaimMap.output`) — a different variable that was never assigned. The JWT was correctly
generated but stored somewhere nothing ever read; any request body/header referencing it sent
`undefined`. Invisible to `node --check` and to every existing test, since nothing previously
verified the variable a generated script *writes* matches the one it *reads*. Confirmed by
generating a realistic JWT-only script end-to-end and inspecting the actual output.

VuGen's generator was checked and already did this correctly
(`src/generators/vugen/scriptGenerator.js:1228`); DevWeb's per-request/secondary-JWT path
(BUG-036) was also already correct — only the primary JWT path in `generateInitialize()`/
`generateAction()` had the hardcoded literal.

Fix: both locations now derive the target variable from `cm.output` (sanitized), falling
back to `"jwt_token"` only when no output variable was ever detected.

New regression test: `tests/unit/devwebJwtOutputVar.test.js` (5 tests) — verified as a real
guard by reverting the fix and confirming it fails before restoring. All 195 unit tests pass
(was 190).

Files changed: `src/generators/devweb/scriptGenerator.js`,
`tests/unit/devwebJwtOutputVar.test.js` (new)

---

### Fixed (BUG-047) — Hardened generated package.json against ESM/CJS ancestor conflicts
User reported `require is not defined in ES module scope, you can use import instead`
running a generated DevWeb script. Root cause is environmental: Node.js resolves module
type by walking UP the directory tree for the nearest `package.json`; if a DIFFERENT
`package.json` above the script's actual folder has `"type": "module"` (a stray file, or
an IDE-scaffolded DevWeb project template) and our own shipped `package.json` isn't present
in that exact folder, `require()` disappears entirely. Confirmed via direct reproduction
that our generated `package.json` never had `"type": "module"`.

Fix: `generatePackageJson()` in `src/tools/collection-converter/index.js` now explicitly
sets `"type": "commonjs"` (previously relied on the implicit default), and the generated
`README.md` now has a Troubleshooting entry explaining the directory-walk mechanism.

Files changed: `src/tools/collection-converter/index.js`

---

### Fixed (BUG-046) — VuGen "invalid label" SyntaxError running DPoP or JWT scripts
User reported `Error from JS Engine: SyntaxError: invalid label` executing a generated
VuGen script with DPoP in real LoadRunner, right after generating it successfully.

Root cause: 3 ES3-illegal trailing commas in object literals in `lre-utils.js`/`.dat` —
in `_generateDpopKeyPair()`, `generateDpopProof()` (every per-request DPoP proof, not just
init), and `createJWT()` (every plain VuGen JWT, unrelated to DPoP). `git blame` traced them
to a commit that landed hours BEFORE BUG-040's cleanup the same day — that cleanup covered
function-call and array-literal trailing commas but never checked object literals, so these
3 survived. `node --check` cannot catch this class of bug: Node's parser has accepted
trailing commas in object/array literals since ES5/ES2015 and silently allows them, but
VuGen's real JS engine (ES3-level) rejects them.

Fix: removed all 3 trailing commas (semantically a no-op — all existing tests pass
unchanged) in both `lre-utils.js` and `lre-utils.dat` (kept byte-identical).

**New regression test**: `tests/unit/lreUtilsEs3Compat.test.js` parses both files under
`ecmaVersion: 3` via `acorn` (added as an explicit devDependency), plus an independent regex
cross-check and a byte-identical check — closing the gap that let this bug class through
twice. Verified as a real guard (not a false pass) by reintroducing one trailing comma and
confirming the test correctly fails. New CLAUDE.md rule (`CRITICAL Architecture Rules` #8)
documents that `node --check` is not a valid compatibility gate for this file.

Files changed: `lre-utils.js`, `lre-utils.dat`, `package.json`, `package-lock.json`,
`tests/unit/lreUtilsEs3Compat.test.js` (new), `CLAUDE.md`

---

### Fixed (BUG-045) — Syntax error in every DevWeb script using DPoP
`generateInitialize()` in `src/generators/devweb/scriptGenerator.js` emitted a stray `"` in
the DPoP key-init line: `` load.global.${this.dpopKeyVar || "dpop_jwk"}" = load.global... ``.
This rendered as `load.global.dpop_jwk" = load.global.dpop_jwk || null;` in every generated
DevWeb script that uses DPoP signing — a JavaScript syntax error that broke the whole
`initialize()` block. Found while re-checking JWT/DPoP code for other issues (not previously
reported by a user).

Fix: removed the stray `"`, matching the dot-notation `load.global.<var>` pattern already used
everywhere else DPoP touches `load.global` in this file. Verified by calling the real
`generateInitialize()` (default and custom key-variable name) and parsing the actual returned
string with `new Function()`; confirmed the new regression test fails against the original
buggy code before confirming it passes against the fix.

Files changed: `src/generators/devweb/scriptGenerator.js`,
`tests/unit/devwebDpopInit.test.js` (new)

---

### Performance — DPoP EC key resolution now cached (DevWeb)
Same redundant-parsing pattern as the JWT fix below, found while re-checking JWT/DPoP code
for other performance issues — and worse in practice, since a DPoP proof is generated once
per HTTP request rather than once per ~9-minute JWT refresh.

`getDpopProof()` in `dpop-helper.js` re-ran `JSON.parse()` + validation +
`crypto.createPrivateKey()` on every single call, even though the EC key never changes after
the first call in a Vuser session. Checked the VuGen equivalent (`lre-utils.dat`/`.js`
`generateDpopProof()`/`initDpopKey()`) and confirmed it was already correct — the key is
resolved once in `vuser_init()` and reused via a module-level cache, so no VuGen change was
needed. Also fixed the identical pattern in `dpop-service.js`'s `/dpop/vuser` endpoint (a
standalone optional helper — confirmed via grep to not be wired into any generator, fixed
for consistency anyway).

Fix: added a cache keyed by the exact raw JWK JSON string in both files
(`_dpopKeyCache` / `vuserKeyCache`, both `Map`), mirroring the JWT fix's approach. Every
existing validation branch and side effect (`console.log` messages, `load.global.dpop_jwk`
writes) is preserved exactly on the cache-miss path.

Verified with 8 new tests (`tests/unit/dpopHelperKeyCache.test.js`) that independently verify
every produced DPoP proof's ES256 signature via Node's own `crypto.verify()`
(`dsaEncoding: 'ieee-p1363'` for the raw R||S format RFC 7515 requires), covering the
empty/string/object/invalid-JWK branches, plus spies on `crypto.createPrivateKey` proving the
cache is hit/bypassed correctly. All 183 unit tests pass (was 175 after the JWT fix below).

Files changed: `dpop-helper.js`, `dpop-service.js`,
`tests/unit/dpopHelperKeyCache.test.js` (new)

---

### Performance — JWT signing key parsing now cached (DevWeb + VuGen)
JWT generation re-parsed the same unchanging private key from scratch on every call instead
of reusing the already-resolved key — pure wasted CPU on a long-running load test, no
functional bug (reported by a user reviewing generated script performance).

DevWeb (`jwt-helper.js`): `generateJWT()` called `normalisePem()` + `resolveSignKey()`
(→ `crypto.createPrivateKey()`) every time, even though `getJwtToken()`'s own 9-minute
expiry gate means the same key text gets re-processed on every refresh across a multi-hour
run. VuGen (`lre-utils.dat` / `lre-utils.js`): `createJWT()` / `createJWTFromMap()` re-ran
the full PEM → DER → BigInteger parse (`_parseRsaKey`) every call — `createJWTFromMap`
(per-request JWTs) has no caller-side expiry gate at all, so it could re-parse the identical
secret once per request.

Fix: added a small cache keyed by the exact raw key/secret string — `getCachedSignKey()`
(a `Map`) in `jwt-helper.js`, and `_getRsaKey()` (a plain object — the file is ES3-only) in
`lre-utils.dat`/`lre-utils.js`. Keying by the raw string means a script signing with more
than one distinct secret still gets its own correct cache entry.

Verified with 10 new tests (`tests/unit/jwtHelperKeyCache.test.js`,
`tests/unit/lreUtilsRsaKeyCache.test.js`) that independently verify every produced JWT
signature against the matching RSA public key via Node's own `crypto.verify()` (PKCS#8,
PKCS#1, and HTML-entity-corrupted PEM inputs all covered), and confirm the cache is hit on
a repeat call with the same key but correctly bypassed for a different one. All 175 unit
tests pass (was 165).

Files changed: `jwt-helper.js`, `lre-utils.dat`, `lre-utils.js`,
`tests/unit/jwtHelperKeyCache.test.js` (new), `tests/unit/lreUtilsRsaKeyCache.test.js` (new)

---

### Fixed (BUG-EXT-013) — Conversion / Recorder / Studio 404 at bare site root
Converting a Postman/Bruno collection (or JMX file) failed with "Conversion Failed — Server
error (404): Not Found" whenever the app was reached at the bare root URL (`/`) instead of
`/converter`. The Recorder and Studio tabs would fail the same way — their iframes couldn't
load either.

Root cause: `POST /convert`, `POST /convert-jmx`, `GET /recorder`, and `GET /studio` were only
registered under the `/converter/*` prefix in `server.js`, while the home page itself renders
at both `/` and `/converter`, and the client's `BASE_PATH` (used to build these request URLs)
is computed from `window.location.pathname` — empty at root, `/converter` under the IIS
virtual directory. Every other route in the file (home, downloads, crypto helper files,
`/status`, `/health`, `/analytics/track`) was already dual-registered at both paths; these
four were the exception.

Fix: registered all four routes at both paths using Express array-path syntax, e.g.
`this.app.post(["/convert", "/converter/convert"], ...)`.

Files changed: `src/web/server.js`

---

### Changed — PerfX Recorder Extension home page banner temporarily hidden
The "New / PerfX Recorder Extension" promo banner on the home page is now hidden by default.
Several corporate environments block `chrome://extensions` → Load unpacked via Group Policy,
so promoting an install path some users can't complete was creating confusion.

Nothing was removed — the banner markup, CSS, download route, and install modal are all
still in place and functional. The extension is still reachable via the **Help → Recorder**
in-app doc link ("Get the extension →") and via `GET /downloads/recorder-extension` directly.

To re-enable: flip `SHOW_EXT_BANNER` from `false` to `true` in `src/web/views/index.ejs`
(just above the `<!-- PerfX Extension banner -->` block). See
`Docs/EXTENSION-RECORDER-PLAN.md` → "Distribution status" for full detail.

Files changed: `src/web/views/index.ejs`

---

### Fixed — Help section accordion now single-open
Expanding a Help topic (e.g. "Converter") no longer leaves previously expanded topics open —
only one section stays expanded at a time, matching standard accordion behavior. Applies to
both clicking a section header and jumping via the "On this page" dropdown.

Files changed: `src/web/views/index.ejs` (`haccToggle()`, `haccJump()`)

---

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
