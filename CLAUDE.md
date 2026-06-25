# Bruno DevWeb Converter — CLAUDE.md
# READ THIS FIRST. Updated automatically after every session.

## Session Startup Protocol (MANDATORY)
1. Read `C:/Users/karrir/.claude/projects/c--Workspace-bruno-devweb-converter/memory/state.md` → current feature status
2. Read `Docs/BUGS.md` → active bugs
3. Proceed with task
4. At end of session → update state.md, BUGS.md, any affected Docs/

---

## What This Tool Does
Converts HAR recordings, Bruno/Postman collections, and JMX files into:
- **DevWeb scripts** (JavaScript, LoadRunner Enterprise)
- **VuGen Web HTTP/HTML scripts** (C code, LoadRunner Professional)
- **VuGen Script Studio** — browser-based HAR analyzer at `/converter/studio`
  - Correlation Advisor (auto-detect + manual correlation)
  - Parameterization engine
  - Code generation for both protocols

---

## Critical File Map

### VuGen Script Studio (primary feature, most active)
| File | Size | Purpose |
|------|------|---------|
| `src/web/public/VuGen-Script-Studio.html` | 364 L | All HTML/modals for Studio |
| `src/web/public/VuGen-Script-Studio-app.js` | ~5000 L | App logic + DevWeb codegen + VuGen C codegen |
| `src/web/public/VuGen-Script-Studio.css` | 1395 L | All styles |
| `src/web/public/studio-advisor.js` | 776 L | Correlation Advisor detection engine |
| `src/web/public/studio-ui.js` | 1069 L | Advisor UI, modals, card rendering |
| `src/web/public/studio-codegen.js` | ~3760 L | Shared codegen helpers (DevWeb + VuGen body substitution) |

### Entry Point
`src/web/public/VuGen-Script-Studio.html` loads scripts in this order:
1. `studio-advisor.js`
2. `studio-ui.js`
3. `studio-codegen.js`
4. `VuGen-Script-Studio-app.js`

All share global state object `S` (defined in app.js).

### Converters (less active)
| File | Purpose |
|------|---------|
| `src/generators/advancedScriptGenerator.js` | DevWeb script generation from Bruno/Postman |
| `src/generators/webHttpScriptGenerator.js` | VuGen C script generation from Bruno/Postman |
| `src/web/public/shared/vugen-codegen.js` | Shared VuGen codegen (UMD, works browser+Node) |

---

## Global State Object `S` (app.js)
```
S.entries1        — full HAR entries array (ALL entries, including filtered)
S.correlations    — [{name, sourceIdx, extractorType, extractorConfig, usages[]}]
S.advisorCandidates — [{id, value, source, usages, status, ...}]
S.params          — parameterization entries
S.scripts         — generated script files map
S.auth            — detected auth config
S.hasDpop         — DPoP enabled flag
```

---

## CRITICAL Architecture Rules (NEVER BREAK THESE)

### 1. Index Rule
All `sourceIdx`, `reqIdx`, `entryIdx` in correlations/usages ALWAYS reference `S.entries1` (the FULL array including filtered entries). Never reindex after filtering.

### 2. Filtered Entry Rule
`e.filtered` and `e.isMarker` entries MUST be skipped in:
- All dropdowns
- All scans (body, header, query)
- All advisor detection loops
Never remove them from `S.entries1`.

### 3. URL Rule
NEVER use `new URL()` on URLs that may contain `{{variables}}` — it encodes braces to `%7B%7B`. Use manual string splitting (`url.split('?')`).

### 4. Event Storage Rule
Bruno/Postman events are stored in `req.tests[]` NOT `req.event[]`. Always use:
```javascript
const events = req.tests || req.event || [];
```

### 5. studio-advisor.js Independence Rule
`studio-advisor.js` has ZERO dependencies on other modules. It only reads `S.entries1` and `S.correlations`. Never import/call other modules from it.

### 6. Body Substitution Sentinels
| Sentinel | Meaning | Generated expression |
|----------|---------|---------------------|
| `\x00DYNSTART_name\x00DYNEND` | Correlation value | `${load.global.name}` |
| `\x00DYNJSON_name\x00DYNEND` | Correlation value needing JSON re-escape | `${JSON.stringify(load.global.name\|\|'').slice(1,-1)}` |
| `\x00PARAM_key\x00PARAMEND` | Parameter value | `${load.params.key}` |
| `\x00PARAMJSON_key\x00PARAMEND` | Parameter value needing JSON re-escape | `${JSON.stringify(load.params.key\|\|'').slice(1,-1)}` |
| `@@ARRAY_RECONSTR_key@@` | Array reconstruction | `${JSON.stringify(_key_arr)}` |

### 7. Extractor Types
| Type | DevWeb | VuGen C |
|------|--------|---------|
| `jsonpath` | `new load.JsonPathExtractor(name, path)` | `web_reg_save_param_json(...)` |
| `jsonpath+selectAll` | third arg `true` (boolean) | `SelectAll=Yes` |
| `boundary` | `new load.BoundaryExtractor(name, {leftBoundary, rightBoundary, scope: load.ExtractorScope.Body})` | `web_reg_save_param(LB=..., RB=...)` |
| `boundary_header` | `new load.BoundaryExtractor(name, {leftBoundary, rightBoundary, scope: load.ExtractorScope.Headers})` | `web_reg_save_param(LB=..., RB=..., Search=Headers)` |
| `regexp` | `new load.RegExpExtractor(name, pattern)` | `web_reg_save_param_regexp(...)` |
| `array_reconstruct` | IIFE loop + SelectAll extractors | `web_js_run` builder + SelectAll |
| `cookie` | suppressed (not emitted) | suppressed |

---

## Body Generation: DevWeb vs VuGen

### DevWeb (JavaScript)
- Body emitted as template literal when dynamic: `` body: `{"key":"${load.global.token}"}` ``
- Body emitted as JS object when static (via `_renderJsVal`)
- Large bodies: inline JS object

### VuGen C
- Body emitted as C string inline `"Body=..."` or split across multiple string literals
- Body ALWAYS goes through `escBodyBinary()` — escapes `"→\"`, `\→\\`, `\n→\n`
- Parameters use `{paramName}` syntax substituted at runtime
- Correlations use `{corrName}` syntax

---

## Correlation Advisor: Key Functions
| File | Function | Purpose |
|------|----------|---------|
| studio-advisor.js | `advisorScan()` | Main entry — phases 1-4 |
| studio-advisor.js | `_advExtractResponseValues()` | Phase 1: walk all response bodies |
| studio-advisor.js | `_advCrossReference()` | Phase 2: find values in later requests |
| studio-advisor.js | `_advPatternScan()` | Phase 3: JWT/UUID pattern detection |
| studio-advisor.js | `_advMergeArrayCandidates()` | F1: merge array siblings → SelectAll |
| studio-advisor.js | `_advDetectArrayGroups()` | F2: detect array reconstruction |
| studio-advisor.js | `advisorToCorrelation()` | Convert candidate → S.correlations entry |
| studio-advisor.js | `advisorAddManual()` | Manual correlation via field browser |
| studio-ui.js | `renderAdvisorPanel()` | Render candidate cards |
| studio-ui.js | `_advCardHtml()` | HTML for one candidate card |
| studio-ui.js | `openAdvisorModal()` | Open Add Manual modal |
| studio-ui.js | `advisorApplyAndRegen()` | Accept candidates + regenerate |

---

## Session-End Checklist (run after EVERY code change session)
- [ ] `node --check` on all modified .js files
- [ ] Update `Docs/BUGS.md` (mark fixed, add discovered)
- [ ] Update `C:/Users/karrir/.claude/projects/c--Workspace-bruno-devweb-converter/memory/state.md`
- [ ] Update `Docs/CORRELATION-LOGIC-EXPLAINED.md` if correlation logic changed
- [ ] `git add` + `git commit` with descriptive message
- [ ] No `console.error` or unhandled exceptions in modified code paths

---

## CSS / Design System
All design tokens in `:root` in `VuGen-Script-Studio.css`.
Key token groups: `--bg-*`, `--text-*`, `--accent-*`, `--border-*`, `--radius-*`, `--shadow-*`
Component naming: `.adv-*` (advisor), `.corr-*` (correlations), `.param-*` (parameters), `.studio-*` (main studio).
Dark mode: `.dark` class on `<body>`.

---

## Auto-maintenance Conventions
- **After bug fix**: Add entry to `Docs/BUGS.md` as FIXED
- **After new feature**: Add one-liner to relevant section in `Docs/FUNCTIONAL-SPEC.md`
- **After correlation change**: Update `Docs/CORRELATION-LOGIC-EXPLAINED.md`
- **Always**: Update `memory/state.md` with current feature status
