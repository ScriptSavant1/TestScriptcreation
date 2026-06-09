# Correlation Advisor — Design & Implementation Plan

**Goal:** Surface the 3–10 request-body values that will break under load — automatically,
with minimal UI noise — and let the user confirm/add correlations before regenerating the script.

**Scope:** Script Studio only (`src/web/public/`). No other tool is touched.

**Principle:** Expert performance testers look at request bodies and payloads. Not everything
is dynamic. Only values that came from a prior response actually need correlation. The tool
surfaces exactly those — nothing more.

---

## Architecture Decision

The feature lives in a single new file: **`studio-advisor.js`**.
It reads `S.entries1` (already parsed HAR) and writes `S.advisorCandidates`.
It has ZERO coupling to any other tool, generator, or server-side code.

```
VuGen-Script-Studio-constants.js   S.advisorCandidates = []  (1-line addition)
studio-advisor.js                  NEW — detection engine only, no UI
studio-ui.js                       renderAdvisorPanel() + modal functions (additive)
studio-app.js                      call advisorScan() after correlate step (additive)
VuGen-Script-Studio.html           advisor panel div + modal + CSS (additive)
```

Nothing is removed or restructured. All changes are purely additive.

---

## Files

| File | Change | Lines |
|------|--------|-------|
| `Docs/CORRELATION-ADVISOR-PLAN.md` | NEW — this file | — |
| `src/web/public/studio-advisor.js` | NEW — detection engine | ~350 |
| `VuGen-Script-Studio-constants.js` | +1 line (`advisorCandidates: []`) | — |
| `VuGen-Script-Studio.html` | +advisor panel HTML + modal + CSS | ~120 |
| `src/web/public/studio-ui.js` | +renderAdvisorPanel + modal fns | ~130 |
| `src/web/public/studio-app.js` | +advisorScan call + applyAndRegen | ~25 |

---

## Detection Algorithm (studio-advisor.js)

### Phase 1 — Extract all leaf values from response bodies

```
for each entry in entries (in HAR order):
  if entry.respBody is valid JSON:
    walk all leaf nodes → collect {value, jsonPath}
    filter: string length >= 10 chars
    filter: not a common word / enum / boolean string
    store: responseValueMap[value] = {entryIdx, url, jsonPath}
```

### Phase 2 — Cross-reference with subsequent request bodies

```
for each entry in entries:
  if entry.body (JSON or form):
    walk all leaf values
    for each value:
      if value in responseValueMap AND responseValueMap[value].entryIdx < currentIdx:
        → HIGH CONFIDENCE candidate
          source: responseValueMap[value]
          usedIn: current entry, jsonPath in body
```

### Phase 3 — Pattern scan (secondary, for truncated HARs)

```
for each entry in entries:
  for each request body value NOT already found in Phase 2:
    if matches DYNAMIC_PATTERNS (JWT, UUID, hex32, hex64, longToken):
      → MEDIUM CONFIDENCE candidate
```

### Phase 4 — Filter & deduplicate

- Remove values already in `S.correlations` (existing engine already handled them)
- Remove values shorter than 10 chars
- Remove values that are pure numbers, booleans, or common enum strings
- Deduplicate by value (same token used in 5 requests → one candidate, 5 usages)
- Limit to 20 candidates max (safety cap — if > 20 the HAR is very noisy)

---

## Data Structure

```javascript
// AdvisorCandidate
{
  id:          "adv-0",           // unique ID for UI binding
  value:       "eyJhbGci...",     // the raw hardcoded value
  preview:     "eyJhbGci...{8}",  // truncated for display (max 40 chars + "…")
  valueType:   "jwt" | "uuid" | "hex" | "token" | "unknown",
  confidence:  "high" | "medium", // high = found in prior response; medium = pattern only
  varName:     "accessToken",     // auto-suggested, user-editable
  // Where it came from
  source: {
    entryIdx: 3,
    url:      "POST /oauth/token",
    jsonPath: "$.access_token"    // null if not extractable
  } | null,
  // Where it is used
  usages: [
    { entryIdx: 5, url: "GET /api/orders", location: "body", jsonPath: "$.token" },
    { entryIdx: 7, url: "POST /api/cart",  location: "body", jsonPath: "$.auth"  }
  ],
  // User decision
  status: "pending" | "accepted" | "skipped"
}
```

---

## UI Design

### Position in Results phase

```
[Stats bar]
[Correlation Advisor panel]     ← NEW (between stats and existing corr-panel)
[Correlation Details panel]     (existing, unchanged)
[Parameterization Details panel](existing, unchanged)
[Code area]                     (existing, unchanged)
```

### Advisor panel — header

```
┌─────────────────────────────────────────────────────────────────┐
│  🔍 Correlation Advisor   [3 pending]   [+ Add Manual]  [▾]    │
└─────────────────────────────────────────────────────────────────┘
```

- Badge shows pending count. Turns green when all resolved.
- Collapsed by default if 0 candidates. Expanded if ≥1.
- `[+ Add Manual]` opens the manual-add modal.
- `[▾]` toggles collapse.

### Candidate card

```
┌──────────────────────────────────────────────────────────────────┐
│ [JWT] ● HIGH     access_token              [✓ Accept] [✕ Skip]  │
│ eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c2Vy…                         │
│ ← From  POST /oauth/token  →  $.access_token                    │
│ → Used in  Authorization header  (3 requests)                   │
│ Variable name: [access_token_____________________]              │
└──────────────────────────────────────────────────────────────────┘
```

- Left border color: green (high confidence) / amber (medium confidence)
- Type badge: JWT=blue, UUID=purple, hex=teal, token=orange
- Confidence dot: filled=high, outline=medium
- Variable name input: editable inline, auto-populated from JSON path key
- Accept/Skip buttons: smooth card fade-out on action

### Footer (when ≥1 accepted)

```
  2 accepted · 1 skipped · 0 pending          [▶ Apply & Regenerate]
```

`Apply & Regenerate`:
1. Convert accepted candidates → `S.correlations` entries (using existing format)
2. Re-run code generation pipeline (reuses existing `buildScripts()` / `analyze()` tail)
3. Updates code preview — no full page reload

### Manual add modal

```
┌───────────────────────────────────────────────────────┐
│  Add Custom Correlation                          [✕]  │
│                                                       │
│  Source request                                       │
│  [dropdown — all entry URLs]                          │
│                                                       │
│  Extract from                                         │
│  ○ Response body (JSON path)   ○ Response header      │
│                                                       │
│  JSON Path / Header name                              │
│  [$.data.session_id_________________]                 │
│                                                       │
│  Variable name                                        │
│  [session_id________________________]                 │
│                                                       │
│                              [Cancel]  [Add]          │
└───────────────────────────────────────────────────────┘
```

---

## Integration with Existing Correlation Engine

`applyAndRegen()` converts each accepted `AdvisorCandidate` to the existing correlation
object format used by `studio-codegen.js`:

```javascript
// Existing correlation format (S.correlations entries):
{
  name: "access_token",
  sourceIdx: 3,
  extractorType: "jsonpath",
  extractorConfig: { path: "$.access_token" },
  usages: [
    { reqIdx: 5, location: "body_json", key: "token", tokenValue: "eyJ...", originalValue: "eyJ..." }
  ]
}
```

The advisor converts its candidates to this exact format, then appends to `S.correlations`,
then calls the last section of `analyze()` that regenerates scripts and re-renders the UI.
The existing code generation pipeline is NOT changed — it already handles `S.correlations`.

---

## What is NOT Changed

- `VuGen-Script-Studio-correlation.js` — untouched
- `studio-codegen.js` — untouched
- `VuGen-Script-Studio-constants.js` — 1 line added only
- All other tools: Recorder, collection converter, JMX converter — untouched
- Server routes — untouched

---

## Implementation Phases

| Phase | Task | Status |
|-------|------|--------|
| 0 | Create this plan document | ✅ done |
| 1 | Add `advisorCandidates: []` to `S` in constants | ✅ done |
| 2 | Create `studio-advisor.js` — detection engine | ✅ done |
| 3 | Add advisor panel HTML + modal + CSS to HTML | ✅ done |
| 4 | Add advisor UI functions to `studio-ui.js` | ✅ done |
| 5 | Wire `advisorScan()` into `studio-app.js` | ✅ done |
| 6 | Fix body format bug (`e.body.text` not `e.body`) | ✅ done |
| 7 | Fix index mismatch (pass full `S.entries1`, filter internally) | ✅ done |
| 8 | Fix location labels (`body_json`/`body_form`) + passthrough | ✅ done |
| 9 | Fix `advisorToCorrelation` for manual candidates | ✅ done |
| 10 | Fix `clearAll()` to reset `S.advisorCandidates` + hide panel | ✅ done |

---

## Future Enhancements (not in scope for this phase)

| ID | Feature | Effort | Status |
|----|---------|--------|--------|
| F1 | **Array correlation + SelectAll** — detect array siblings in source (e.g. `$.items[0].id`, `$.items[1].id`) and merge into `SelectAll=Yes` (VuGen) / `{all:true}` (DevWeb). Merges siblings into one candidate. | Large | ✅ done |
| F2 | **Inline script annotation** — highlight hardcoded values in the code preview that the advisor flagged; click to open advisor panel for that candidate | Medium | deferred |
| F3 | **Advisor-tagged rows in Correlation Details** — show `[Advisor]` badge on correlations that came from the advisor, distinct from auto-detected ones | Small | ✅ done |
| F4 | **Header value scanning** — extend Phase 2 to also check request headers (not just request bodies) for values that appeared in prior responses | Small | ✅ done |
| F5 | **Field browser manual modal** — redesigned Add Manual modal: select source, auto-parse response body + headers, show clickable field list, auto-detect extractor type | Medium | ✅ done |
