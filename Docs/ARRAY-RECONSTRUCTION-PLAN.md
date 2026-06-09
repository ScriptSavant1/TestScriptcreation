# Array Reconstruction Correlation

## Problem Statement

When a load test script issues a request whose JSON body contains a large array whose
items were all returned by a prior response, hardcoding that array defeats the purpose
of parameterisation.

**Example**: `POST /alert_tuned` sends:
```json
{
  "systemID": "STF0420...",
  "nextAlerts": [
    { "systemID": "STF0320...", "pairingID": "8110...", "relatedRef": "LTR...", "lockId": "0" },
    { "systemID": "STF0120...", "pairingID": "7210...", "relatedRef": "LTR...", "lockId": "0" },
    ...2000 more items
  ]
}
```

All `systemID`, `pairingID`, and `relatedRef` values were extracted from
`GET /sfcm/home` → `$.liveGridData[*].systemId`, `.pairingId`, `.relatedRef`.

The script must extract all three columns using **SelectAll** extractors, then
rebuild `nextAlerts[]` at runtime with a loop before the target request.

---

## Supported Protocols

| Protocol | Loop mechanism | Body injection |
|----------|---------------|---------------|
| DevWeb (JS) | IIFE `const _arr = (() => { for(...) })()` | Template literal `${JSON.stringify(_arr)}` |
| VuGen Web HTTP/HTML (C) | `web_js_run(...)` → LR parameter `{arrKey_json}` | `BodyBinary=` body with `{arrKey_json}` substitution |

---

## Data Model

### New correlation type: `array_reconstruct`

```
S.correlations[i] = {
  name:          "nextAlerts",          // target array key (camelCase)
  sourceIdx:     3,                     // S.entries1 index of the source response
  extractorType: "array_reconstruct",
  extractorConfig: {
    targetArrayKey: "nextAlerts",
    countVar:       "liveGridSystemIDs",   // first column drives the loop count
    columns: [
      { sourceJsonPath: "$.liveGridData[*].systemId",  varName: "liveGridSystemIDs",  targetKey: "systemID"   },
      { sourceJsonPath: "$.liveGridData[*].pairingId", varName: "liveGridPairingIDs", targetKey: "pairingID"  },
      { sourceJsonPath: "$.liveGridData[*].relatedRef",varName: "liveGridRelatedRefs",targetKey: "relatedRef" },
    ],
    staticFields: [
      { targetKey: "lockId", value: "0" },
    ],
  },
  usages: [{ reqIdx: 6, location: "body_array", key: "nextAlerts",
             tokenValue: "array", originalValue: "array" }],
  _fromAdvisor: true,
}
```

### Usage location: `body_array`

A new value for `u.location` indicating that the entire JSON key's value (an array)
must be replaced by a runtime-built variable — NOT a scalar text substitution.

---

## Detection Algorithm (`_advDetectArrayGroups`)

Runs **after** `_advMergeArrayCandidates` in `advisorScan()`.

1. Collect all `_selectAll` candidates (not manual).
2. For each, look at `u.jsonPath` on each usage.
3. If `u.jsonPath` matches `$.arrayKey[N].fieldName`, record
   `(entryIdx, arrayKey) → candidate`.
4. Group candidates by `(entryIdx, arrayKey)`.
5. For each group, create one `_arrayReconstruct` meta-candidate:
   - `columns[]`: one entry per `_selectAll` candidate (sourceJsonPath + varName + targetKey)
   - `staticFields[]`: inferred from HAR body (`_advInferStaticFields`)
   - `source`: from the first group member
   - `usages`: single entry `{ location: 'body_array', entryIdx, jsonPath: arrayKey }`
6. Remove absorbed `_selectAll` candidates from result; keep ungroupable ones unchanged.

**Threshold**: groups with ≥1 member are promoted (a single column still needs a loop).

### Static field inference (`_advInferStaticFields`)

Parse the HAR request body of the target entry. Find `body[targetArrayKey][0]`.
Collect keys NOT in the `knownKeys` set (the column target keys). For each such key,
check that its value is identical across all array items (or absent) → static field.

---

## Code Generation

### correlations.js — DevWeb extractors

For each `array_reconstruct` correlation, emit **one extractor per column**:

```js
// Array reconstruct: nextAlerts  (source: $.liveGridData)
const liveGridSystemIDsExtractor  = new load.JsonPathExtractor("liveGridSystemIDs",  "$.liveGridData[*].systemId",  {all: true});
const liveGridPairingIDsExtractor = new load.JsonPathExtractor("liveGridPairingIDs", "$.liveGridData[*].pairingId", {all: true});
const liveGridRelatedRefsExtractor= new load.JsonPathExtractor("liveGridRelatedRefs","$.liveGridData[*].relatedRef",{all: true});
```

Export all column extractors (NOT a `nextAlertsExtractor` — that doesn't exist).

### DevWeb main.js — source request

Flatten all column extractors into the `extractors[]` array:
```js
extractors: [corr.liveGridSystemIDsExtractor, corr.liveGridPairingIDsExtractor, corr.liveGridRelatedRefsExtractor],
```

After `.send()` in sequential flow, store first items (auto-populated `_1`, `_count` etc.
are set by the extractor into `load.global` automatically; we store `_1` for any scalar usage):
```js
load.global.liveGridSystemIDs  = r3.extractors.liveGridSystemIDs;   // first item
load.global.liveGridPairingIDs = r3.extractors.liveGridPairingIDs;
load.global.liveGridRelatedRefs= r3.extractors.liveGridRelatedRefs;
```

### DevWeb main.js — builder IIFE before target request

Emitted immediately before the `await new load.WebRequest({...})` of the target entry:

```js
// Build nextAlerts array from correlated liveGridData values
const _nextAlerts_arr = (() => {
  const _n = parseInt(load.global.liveGridSystemIDs_count) || 0;
  const _arr = [];
  for (let _i = 1; _i <= _n; _i++) {
    _arr.push({
      "systemID":   load.global["liveGridSystemIDs_"   + _i] || "",
      "pairingID":  load.global["liveGridPairingIDs_"  + _i] || "",
      "relatedRef": load.global["liveGridRelatedRefs_" + _i] || "",
      "lockId":     "0",
    });
  }
  return _arr;
})();
```

### DevWeb main.js — body substitution

Body is always emitted as a template literal when `body_array` usages exist.

Sentinel replacement: before body text processing, parse the JSON body object, replace
`body.nextAlerts` with the sentinel string `@@ARRAY_RECONSTR_nextAlerts@@`, re-serialize.
In the template literal output, replace `"@@ARRAY_RECONSTR_nextAlerts@@"` (JSON string
with surrounding `"..."`) with `${JSON.stringify(_nextAlerts_arr)}`:

```js
body: `{
  "systemID": "${load.global.liveGridSystemIDs_1}",
  "lastOperator": "M01EUROPA",
  "nextAlerts": ${JSON.stringify(_nextAlerts_arr)}
}`,
```

### VuGen Action.c — SelectAll before source request

For each column, one `web_reg_save_param_json` with `SelectAll=Yes` (via existing
`VugenCodegen.emitJsonAll()`):

```c
web_reg_save_param_json("ParamName=liveGridSystemIDs",
    "QueryString=$.liveGridData[*].systemId", "SelectAll=Yes", LAST);
```

Emitted by the existing `acSrcCorrs` loop that iterates `corrSourcesRemap`.
`webHttpCorrCode()` must handle `array_reconstruct` by emitting ALL column regs.

### VuGen Action.c — web_js_run builder before target request

Emitted just before the target request (detected by `body_array` usage):

```c
/* Build nextAlerts JSON array from correlated parameters */
web_js_run(
    "Code="
    "var _n=parseInt(lr.getParam('liveGridSystemIDs_count'))||0;"
    "var _r=[];"
    "for(var _i=1;_i<=_n;_i++){"
    "var _t={};"
    "_t[\"systemID\"]=lr.getParam(\"liveGridSystemIDs_\"+_i)||\"\";"
    "_t[\"pairingID\"]=lr.getParam(\"liveGridPairingIDs_\"+_i)||\"\";"
    "_t[\"relatedRef\"]=lr.getParam(\"liveGridRelatedRefs_\"+_i)||\"\";"
    "_t[\"lockId\"]=\"0\";"
    "_r.push(_t);"
    "}"
    "lr.setParam(\"nextAlerts_json\",JSON.stringify(_r));",
    "ResultParam=_arr_build_result",
    LAST);
```

### VuGen Action.c — body substitution

Same sentinel approach: replace `"nextAlerts"` array with `@@ARRAY_RECONSTR_nextAlerts@@`
in the raw body, then after `escBodyBinary` replace `"@@ARRAY_RECONSTR_nextAlerts@@"` with
`{nextAlerts_json}` (LR parameter reference without surrounding quotes).

VuGen's runtime substitutes `{nextAlerts_json}` at execution time.

---

## Impact Analysis

### Files changed

| File | Change | Risk |
|------|--------|------|
| `studio-advisor.js` | Add `_advDetectArrayGroups`, `_advInferStaticFields`; update `advisorScan`, `advisorToCorrelation` | Medium — new detection path, existing paths unchanged |
| `studio-codegen.js` | `genCorrelationsJS` + DevWeb body/extractor + VuGen body/web_js_run | Medium — guarded by `extractorType === 'array_reconstruct'` checks |
| `VuGen-Script-Studio-app.js` | Identical changes as studio-codegen.js | Same |
| `studio-ui.js` | New advisor card template + manual UI | Low — additive |
| `VuGen-Script-Studio.css` | New card styles | None |

### What CANNOT break

- Scalar correlations (`jsonpath`, `boundary`, `boundary_header`, `cookie`, `html`)  
  → All guarded by `extractorType !== 'array_reconstruct'` checks
- SelectAll correlations (`_selectAll: true` → `{ selectAll: true }` config)  
  → Only absorbed when usage path confirms array-indexed target; otherwise kept unchanged
- VuGen `web_reg_save_param_json` SelectAll (non-reconstruct)  
  → `webHttpCorrCode` dispatches on `extractorType`; existing path untouched
- DevWeb `returnBody + extractors[]` for scalar correlations  
  → `srcCorrsForReq.flatMap(...)` new helper returns `[corr.nameExtractor]` for non-reconstruct
- Body generation for requests WITHOUT `body_array` usages  
  → Sentinel insertion is conditional; existing paths fire normally

---

## Implementation Phases

| Phase | Component | Description |
|-------|-----------|-------------|
| 1 | `studio-advisor.js` | Detection: `_advDetectArrayGroups` + `_advInferStaticFields` + wire into `advisorScan` |
| 2 | `studio-advisor.js` | `advisorToCorrelation` for `_arrayReconstruct` |
| 3 | `studio-codegen.js` + `VuGen-Script-Studio-app.js` | `genCorrelationsJS` column extractor emission |
| 4 | `studio-codegen.js` + `VuGen-Script-Studio-app.js` | DevWeb body sentinel + IIFE builder + extractor flatMap |
| 5 | `studio-codegen.js` + `VuGen-Script-Studio-app.js` | VuGen `webHttpCorrCode` + `web_js_run` + body sentinel |
| 6 | `studio-ui.js` + CSS | Advisor card for `_arrayReconstruct` |

---

## Edge Cases & Constraints

1. **Target array not found in HAR body** — `_advInferStaticFields` returns `[]`; still valid
2. **Single-column group** — emitted as reconstruct (loop of 1 field); not fallback to scalar
3. **Zero rows at runtime** — `_n = 0` → empty array `[]` sent; script doesn't crash
4. **Concurrent request groups (DevWeb)** — builder IIFE is emitted OUTSIDE `Promise.all([])`; this requires hoisting the builder before the concurrent group if the target is inside one
5. **VuGen `Body=` vs `BodyBinary=`** — sentinel is all ASCII printable; not affected by binary escaping
6. **Non-JSON bodies** — array reconstruct only triggers for `application/json` request bodies
7. **`body_array` usage + scalar correlations in same request** — both apply: scalars via DYNSTART, array key via sentinel
