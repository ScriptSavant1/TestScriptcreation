# Bug Tracker — Bruno DevWeb Converter
# Maintained automatically. Updated after every session.

## Active Bugs

*(none currently)*

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
| BUG-018 | High | v2.9.6 / pending | VuGen array reconstruction `web_js_run` assigned `LR.getParam(...)` directly to `_obj.field` — when `web_reg_save_param_json` SelectAll finds no value at a path, it stores the literal string `"null"` or `""`. Direct assignment then put `"null"` into the JSON body, causing 400 errors. Fixed: each correlated column now fetches into a temp var (`_cv0`, `_cv1`, …), applies null-guard `if(!v||v=='null'){v=''}`, then assigns — generic for all columns regardless of whether they are nullable in the HAR. |

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
