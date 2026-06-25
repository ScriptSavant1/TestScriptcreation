# Bug Tracker — Bruno DevWeb Converter
# Maintained automatically. Updated after every session.

## Active Bugs

*(none currently)*

---

## Fixed (this session)

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
