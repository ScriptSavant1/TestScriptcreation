# Bug Tracker — Bruno DevWeb Converter
# Maintained automatically. Updated after every session.

## Active Bugs

*(none currently)*

---

## Fixed (this session)

| ID | Severity | Fixed In | Description |
|----|----------|----------|-------------|
| BUG-034 | Critical | v2.10.9 / pending | DevWeb + VuGen: `detectScriptSetVariables()` declared one `/gm` regex (`setPattern`) and reused it across multiple `exec()` loops on different strings. In JavaScript, `/g` regexes maintain `lastIndex` state on the regex object itself — it does not reset when you call `exec()` on a new string. After `scanItem()` exhausted the regex on the collection's event scripts, `lastIndex` was left at a non-zero position. When the requests.forEach() loop ran, `exec()` started from the wrong position and missed matches — especially on short 2-line scripts like `postman.setEnvironmentVariable("access_token", ...)`. This was silently lenient in Node 16 (V8 9.x) but became a hard failure in Node 18+ (V8 10+) which strictly maintains `lastIndex` per the ECMAScript spec. Fix: add `setPattern.lastIndex = 0` before every `while (exec())` loop that starts a new string, in both DevWeb and VuGen generators. |
| BUG-033 | Critical | v2.10.9 / pending | DevWeb + VuGen: `analyzeRequests()` has a strict producer-before-consumer ordering constraint (`producedAt < i`). In many real-world Postman collections the token endpoint is placed AFTER the API requests that consume its token (e.g. in `DEPOSITS_TEST_CLIENT_NWB.postman_collection.json`, "3. Access token" is at index 6 while all consumers are at indices 0-5). The filter `producedAt < i` never passes for any consumer → 0 correlations → no extractor, no header injection. This has always been the behaviour; it was NOT introduced by any Node.js or regex change. BUG-031 (collection-level auth) was a partial fix — it added collection auth scanning but did not bypass the ordering constraint. Fix: new `injectScriptExtractors()` method in both generators, called after `analyzeRequests()` and `injectJmxExtractors()`. It iterates all requests, extracts post-response test scripts via `correlationDetector.extractTestScript()`, parses variable assignments via `correlationDetector.extractSetVariables()`, and directly injects a correlation for any script-set variable not already covered. Bypasses the ordering constraint entirely — token endpoint can appear anywhere in the collection. Also adds the variable to `scriptSetVarNames` so it's classified Tier 1 dynamic (`load.global.*` / `{varName}`). |
| BUG-032 | High | v2.10.7 / `5f961e0` | DevWeb: Bearer token Authorization header generated as `` `Bearer ${load.global.access-token}` `` — invalid JavaScript (hyphens are subtraction, not property access). Root cause: `authenticationHandler.parameterize()` extracted the raw `varName` from `{{access-token}}` and returned `load.global.${varName}` without sanitizing hyphens to underscores. The extractor correctly used `sanitizeVarName()` producing `access_token`, but the auth handler didn't. Fix: `parameterize()` now applies the same sanitization rule (replace non-JS-identifier chars with `_`) before constructing `load.global.X` or `load.params.X` references. |
| BUG-031 | High | v2.10.6 / `0edf516` | DevWeb and VuGen: when a Postman collection used **collection-level Bearer auth** (Auth tab on the collection, not individual requests), `correlationDetector.analyzeRequests()` found 0 correlations. Root cause: `detectConsumedValues()` step 5 only scanned `request.auth` (per-request auth). Requests that inherit collection-level auth have `request.auth === undefined`, so `{{access_token}}` in `collection.auth.bearer[0].value` was never found as a consumed value. The auth handler in both generators correctly inferred the `load.global.access_token` / `{access_token}` reference from collection auth, but the extractor (`new load.JsonPathExtractor` / `web_reg_save_param_json`) was never generated for the Login request. Fix: `analyzeRequests(requests, collection)` now accepts the optional collection object; new step 6 in `detectConsumedValues` scans `collectionAuth` for any request that has no per-request auth override; both DevWeb and VuGen generators pass `this.collection` to `analyzeRequests`. Affects all Postman/Bruno collections that use collection-level auth (the most common real-world pattern). |
| BUG-030 | High | v2.10.5 / `d2c984c` | VuGen Web HTTP/HTML: `postman.setEnvironmentVariable` (and all Postman/Bruno correlations) generated correct `web_reg_save_param_*` extractors but then referenced the saved parameter with a spurious `_` prefix in `web_add_header` and body values (e.g. `{_access-token}` instead of `{access-token}`). Root cause: `replaceParameters()` in `vugen/scriptGenerator.js` added `_` prefix for all `dynamicVarNames` (correlation targets), treating them like per-request dynamic vars (UUIDs/nonces). Per-request vars correctly use `_` prefix because `gen_uuid("_varName")` stores under `_varName`. But correlation extractors use `ParamName=name` (no prefix), so the reference must be plain `{name}`. Fix: removed the `dynamicVarNames` branch from `replaceParameters()` — only `perRequestVars` get `_` prefix. Regression since commit `9095f52` (4-phase refactor). |
| BUG-029 | High | v2.10.4 / `f43b2f5` | `jwt-helper.js` `generateJWT()` threw `DECODER routines::unsupported` on Node 18+ / OpenSSL 3.x when using a PKCS#1 RSA private key (`-----BEGIN RSA PRIVATE KEY-----`). Root cause: passing a raw PEM string to `sign.sign()` with PSS padding no longer works in OpenSSL 3.x — requires a `KeyObject` with explicit `type`. Additional causes: PEM keys corrupted by YAML `>` folded scalars (newlines→spaces), YAML `|` indentation (leading spaces), CSV literal `\\n` sequences, Windows `\r\n` endings. Fix: (1) `normalisePem()` function handles all four corruption modes + HTML entities; (2) `resolveSignKey()` creates a `KeyObject` with explicit `type: 'pkcs1'` or `type: 'pkcs8'`, falls back to raw PEM string for Node <11.6 where `createPrivateKey` does not exist, with intermediate fallback (no explicit type) for Node 12-14 edge cases; (3) diagnostic `try/catch` wrapper emits a 120-char key preview on failure. Tested: 9/9 corruption modes pass on Node 20 / OpenSSL 3.0. |
| BUG-028 | High | v2.10.3 / `d1baa43` | VuGen Web HTTP/HTML scripts generated JWT token unconditionally on every Action() iteration with no expiry check, mirroring no init in `vuser_init()`. DevWeb already had the correct pattern (generate once in `initialize()`, refresh with expiry check in `action()`). Fix: move `web_set_certificate_ex` + initial `createJWT` call to `generateVuserInitC()` — stores token AND `_jwt_expires_at` timestamp via `LR.setParam`. Replace Action()'s unconditional call with expiry-check ternary. Removes `SOURCES` from Action() since JS context persists from `vuser_init()`. Later refactored (v2.10.8 / `a7ec1a8`) — see REFACTOR-001. |
| BUG-025 | High | v2.10.2 / `b8431dc` | VuGen Web HTTP/HTML converter did not include `lre-utils.dat` in ZIP when Postman/Bruno collection contained JWT signing pre-request scripts. Root cause: `vugen/scriptGenerator.js` looked for `lre-utils-helper.js` in the project root (lines 570, 606) but the actual file is named `lre-utils.dat`. The `fs.existsSync` guard silently failed, hitting the warning branch and skipping the copy. Fix: change both source filename references from `lre-utils-helper.js` to `lre-utils.dat`. Only affects VuGen generator — DevWeb correctly uses `jwt-helper.js` which does exist. |
| BUG-026 | Medium | v2.10.2 / `2346e72` | Generated `vuser_init.c` setup comment block contained Unicode characters (`═` U+2550, `—` U+2014, `→` U+2192) that VuGen's C editor renders as garbage (e.g. `â•DCS$...`) because VuGen reads `.c` files as Windows-1252, not UTF-8. Also affected: DPoP batch comment in `Action.c`. Fix: replaced all three Unicode chars with ASCII equivalents (`=`, `-`, `->`) in the `lreSetupComment` template and the DPoP batch comment string in `vugen/scriptGenerator.js`. |
| BUG-027 | Medium | v2.10.2 / `a62b26f` | `lre-utils.dat` (the crypto library loaded by VuGen as `lre-utils.js`) contained 6 non-ASCII Unicode characters in its JS comments (`—` em-dash on lines 1, 401, 424, 430, 442, 459 and `→` arrow on line 192). VuGen's JS engine reads the file as Windows-1252, rendering them as garbage (e.g. `lre-utils.js â€" DPoP`). Fix: replaced all occurrences with ASCII equivalents (`-` and `->`). Comment-only change — no logic affected. |

---

## Refactors (this session)

| ID | Fixed In | Description |
|----|----------|-------------|
| REFACTOR-001 | v2.10.8 / `a7ec1a8` | VuGen JWT expiry check refactored from two ternary `web_js_run` calls in Action.c into a single `refreshJWT(clientId, aud, scope, kid, secret, tokenParam)` function in `lre-utils.dat`. The function owns all state: reads cached token, calls `createJWT()` if expired, updates `_jwt_expires_at` via `LR.setParam()` internally, and returns the token. Action.c now emits one `web_js_run` call instead of two. Users upgrading existing scripts should rename the two ternary blocks to a single `refreshJWT(...)` call — the setup comment in `vuser_init.c` is unchanged. |

---

## Fixed (this session)

| ID | Severity | Fixed In | Description |
|----|----------|----------|-------------|
| BUG-023 | High | v2.10.0 | Two-HAR mode created N separate correlations for each changed array item in request bodies. Root cause: `twoHarCorrelate` → `jsonDiffFlat` returns one diff entry per `$.array[i].field` path; all entries share the same hint (e.g. `NextAlerts_systemID`) but have unique values, so `valMap` value-dedup did not collapse them. Result: 16 `NextAlerts_systemID_*` correlations for a 16-item array. Fix: added `(reqIdx, hint)` group-dedup before `valMap` for `body_json` array-index paths — keeps only the first representative per group, reducing N correlations to 1. |
| BUG-024 | High | v2.10.1 | Conflict between auto-generated correlations (twoHarCorrelate / valueBasedCorrelate) and Correlation Advisor `array_reconstruct` — both tried to substitute the same body fields, producing duplicate/conflicting extractors. Fix: (1) tag all twoHarCorrelate and valueBasedCorrelate outputs with `_autoGenerated: true`; (2) when an `array_reconstruct` is accepted via the Advisor, auto-suppress any `_autoGenerated` correlations whose `body_json` usage path includes the same `targetArrayKey[` pattern; (3) codegen filters `_suppressed` correlations at call sites — one filter, zero loop changes; (4) pre-F2 advisor scan filter removes SelectAll candidates already covered by existing `array_reconstruct` columns, preventing duplicate candidates on re-scan. Manual correlations never suppressed. |

---

## Fixed (this session)

| ID | Severity | Fixed In | Description |
|----|----------|----------|-------------|
| BUG-019 | High | v2.9.9 | `array_reconstruct` deep scan (v2.9.8) was blind — it added ANY request containing `targetArrayKey` as an extra usage, even when that request's array came from a DIFFERENT source response. Fix: value-verification added to deep scan — requires ≥1 item in the candidate entry's array to match an anchor value from the source response. If no overlap, the request is skipped (belongs to a separate correlation). |
| BUG-020 | High | v2.9.9 | `_advMergeArrayCandidates` deduplicated usages by `entryIdx` only, discarding all but the first usage per request. When a value appeared at both `$.systemID` (standalone) AND `$.nextAlerts[0].systemID` (array) in the same request, only one survived. This prevented array-pattern detection for that entry. Fix: dedup changed to `(entryIdx, jsonPath, location)` so multiple usages per entry at different paths are preserved. |
| BUG-021 | Medium | v2.9.9 | ARRAY_USAGE_RE `/^\$\.([^[.]+)\[(\d+)\]\.(.+)$/` anchored to `^$\.` — only matched top-level array patterns. `$.ptfMessage.hitList[0].nextAlerts[0].systemID` did NOT match, so nested arrays were never detected as primary candidates. Fix: changed to `/.*\.([^[.\]]+)\[(\d+)\]\.([^[.\]]+)/` (greedy `.*` ensures last array segment matches). Now detects `nextAlerts` in nested paths. |
| BUG-022 | High | v2.9.9 | Standalone anchor values (e.g. `"systemID":"STF..."` at top of body outside the `nextAlerts` array) were handled by a companion `_selectAll` candidate (v2.9.8 approach). This caused a DUPLICATE `web_reg_save_param_json` for `systemIds` — the anchor was already extracted as an array_reconstruct column. Fix: companion candidate replaced with `body_json_standalone` usages embedded directly in the array_reconstruct candidate. Codegen handles these with a runtime random-pick picker (`web_js_run` for VuGen, `\x00DYNRND_\x00DYNEND` sentinel for DevWeb) without re-emitting the extractor. |

---

## Fixed (this session)

| ID | Severity | Fixed In | Description |
|----|----------|----------|-------------|
| BUG-011 | High | v2.9.5 / `346ddb9` | VuGen `web_js_run` syntax error "unexpected IDENTIFIER, wrong token = _t" — object literal `{}` and variable `_t` not supported in VuGen's ES3 JS engine. Fixed: use `new Object()`, rename to `_obj`, use dot notation for valid identifiers, hoist all `var` declarations. |
| BUG-012 | High | v2.9.5 / `346ddb9` | VuGen `web_js_run` "JS loading error" — code used lowercase `lr.getParam()`/`lr.setParam()`. VuGen's JS engine only exposes uppercase `LR`. Fixed: all 4 occurrences in array reconstruction generator corrected to `LR.getParam`/`LR.setParam`. |
| BUG-013 | High | v2.9.5 / `346ddb9` | VuGen `web_add_header` for Authorization emitted raw `h.value` (e.g. `Bearer <literal_token>`) instead of substituted `hdrVal` (e.g. `Bearer {AccessToken}`) — correlation only applied to first request. Fixed: emit `hdrDynamic ? hdrVal : h.value`. |
| BUG-014 | High | v2.9.5 / `d49d559` | Array reconstruction sentinel `@@ARRAY_RECONSTR_key@@` not replaced in body — `escBodyBinary()` had already C-escaped surrounding quotes to `\"`, but search used unescaped `"`. Fixed: search for `\\"` + sentinel + `\\"`. |
| BUG-015 | High | v2.9.5 / `d49d559` | `EnableJsForTransport=1` not written to `default.cfg` for scripts using array reconstruction — VuGen showed "JavaScript should be enabled" error at runtime. Fixed: `genDefaultCfg()` now sets the flag for `array_reconstruct` correlations and `S.hasPkce`. |
| BUG-016 | High | v2.9.5 / `9525705` | VuGen statement ordering wrong — `web_add_header` emitted before `web_js_run` instead of after. VuGen rule: `web_js_run → web_reg_save_param* → web_add_header → request`. Fixed: buffer all `web_add_header` calls into `hdrOut`, flush only after all `web_js_run` calls; move `web_reg_save_param` emission inside each branch, after `web_js_run`. |
| BUG-017 | Medium | v2.9.5 / `a9e05d1` | DYNJSON `web_js_run` escape call repeated before every request that used the correlated value in its body — one escape call per Action() is sufficient. Fixed: `_dynJsonEscEmitted` Set tracks which correlations have been escaped; subsequent usages skip re-emission. |
| BUG-018 | High | v2.9.6 / `d0c0a88` | VuGen array reconstruction `web_js_run` assigned `LR.getParam(...)` directly to `_obj.field` — when `web_reg_save_param_json` SelectAll finds no value at a path, it stores the literal string `"null"` or `""`. Direct assignment then put `"null"` into the JSON body, causing 400 errors. Fixed: each correlated column now fetches into a temp var (`_cv0`, `_cv1`, …), applies null-guard `if(!v||v=='null'){v=''}`, then assigns — generic for all columns regardless of whether they are nullable in the HAR. |

---

## Fixed Bugs (History)

| ID | Severity | Fixed In | Description |
|----|----------|----------|-------------|
| BUG-001 | High | v2.4.0 / `efbaf0e` | `new URL()` on `{{variable}}` URLs encoded braces to `%7B%7B` in correlationDetector.js |
| BUG-002 | High | v2.5.2 | Bruno YAML events stored in `req.tests[]` not `req.event[]` — script-set vars classified as Tier 2 instead of Tier 1 |
| BUG-003 | Medium | v2.9.2 / `c007dc3` | correlations.js missing from generated ZIP; duplicate variable declarations; dpop-helper typo |
| BUG-004 | Medium | v2.9.2 / `efbaf0e` | Correlation Advisor: 3 UI bugs — wrong field highlighted, source dropdown missing entries, card rendering crash on null value |
| BUG-005 | High | v2.9.3 / `58644b9` | JSON-in-JSON body substitution silent failure — JSON-escaped value form not matched during body text substitution for DevWeb and VuGen |
| BUG-006 | Medium | v2.9.2 | `web_reg_save_param_xpath` emitting `XPath=` instead of `QueryString=`, and wrongly emitting `Ord=` attribute |
| BUG-007 | Low | v2.9.0 | Private/crypto key patterns (PEM keys) classified as Tier 2 instead of Tier 1 — broke VuGen Parameters panel |
| BUG-008 | High | v2.9.4 | `JsonPathExtractor` third arg was `{all: true}` (object) — SDK requires `true` (boolean). All SelectAll and array_reconstruct extractors generated invalid DevWeb code. Fixed in studio-codegen.js (2 sites) + VuGen-Script-Studio-app.js (2 sites). |
| BUG-009 | High | v2.9.4 | Array reconstruct IIFE used `load.global.varName_count` / `["varName_" + _i]` (VuGen pattern) — DevWeb runtime stores SelectAll results as a plain JS array at `load.global.varName`, never using `_count`/`_N` suffixes. Fixed: generated code now uses `.map()` over `load.global.anchorVar`. |
| BUG-010 | Medium | v2.9.4 | `advisorFillArrayPaths` inferred placeholder source paths using the request-body field name (e.g. `systemID`) but the response JSON key may differ in case (e.g. `systemId`), causing JSONPath extraction to fail. Fixed: now resolves correct casing from a sample item of the source response body. |

---

## Bug Template (for new entries)

```
| BUG-XXX | High/Medium/Low | pending | One-line description |
```

Severity levels:
- **High** — functionality broken, script not generated correctly, crash
- **Medium** — wrong output in edge cases, minor UX issue
- **Low** — cosmetic, documentation, performance

When fixed:
- Change `pending` to `vX.Y.Z / commit-hash`
- Move to Fixed section
