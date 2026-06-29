// =============================================================================
// CORRELATION ADVISOR — studio-advisor.js
//
// Standalone detection engine. Reads S.entries1 (already-parsed HAR).
// Writes S.advisorCandidates.
//
// Algorithm:
//   Phase 1 — Extract all leaf string values from response bodies
//   Phase 2 — Cross-reference: which of those values appear in later request bodies?
//   Phase 3 — Pattern scan (secondary): JWT/UUID/token shapes not found in Phase 2
//   Phase 4 — Filter, deduplicate, cap, auto-name
//
// Coupling: NONE. Does not call any other studio module. Does not know about
// code generators, UI, or server. Only reads S.entries1 and S.correlations.
// =============================================================================

// ---------------------------------------------------------------------------
// INTERNAL CONSTANTS
// ---------------------------------------------------------------------------

const ADV_MIN_LEN = 10;     // minimum value length to consider
const ADV_MAX_CANDIDATES = 20; // safety cap — very noisy HARs won't flood UI

// Values that look dynamic but are almost always static config or enum strings.
// Key insight: if a value matches one of these it almost certainly doesn't need
// correlation even if it happens to appear in a response body.
const ADV_SKIP_VALUES = new Set([
  'true','false','null','undefined','none','yes','no','ok','error',
  'success','failure','pending','active','inactive','enabled','disabled',
  'public','private','internal','external','read','write','admin','user',
  'get','post','put','patch','delete','application/json','application/xml',
  'text/plain','text/html','utf-8','utf8','gzip','identity','chunked',
  'keep-alive','close','no-cache','no-store','max-age','must-revalidate',
]);

// Header names that carry well-known dynamic values — used for usage-location labelling
const ADV_AUTH_HDRS = new Set([
  'authorization','x-auth-token','x-access-token','x-token',
  'x-api-key','x-csrf-token','x-xsrf-token','x-request-id','x-correlation-id',
]);

// Request headers that are always static infrastructure and should not be correlated
const ADV_SKIP_REQ_HDRS = new Set([
  'host','connection','content-type','content-length','content-encoding',
  'accept','accept-encoding','accept-language','accept-charset',
  'user-agent','referer','origin','cache-control','pragma',
  'upgrade-insecure-requests','sec-fetch-mode','sec-fetch-site',
  'sec-fetch-dest','sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform',
  'if-modified-since','if-none-match','transfer-encoding','te',
  'cookie', // cookies handled separately
]);

// ---------------------------------------------------------------------------
// UTILITY: safe JSON parse (returns null on failure)
// ---------------------------------------------------------------------------
function _advParseJson(str) {
  if (!str || typeof str !== 'string') return null;
  const t = str.trim();
  if ((t[0] !== '{' && t[0] !== '[')) return null;
  try { return JSON.parse(t); } catch { return null; }
}

// ---------------------------------------------------------------------------
// UTILITY: return the first string value found at `path` in `obj`.
// Handles JSONPath segments: .key, [N], [*] — returns null when not found.
// ---------------------------------------------------------------------------
function _advGetValueAtPath(obj, path) {
  const segs = [];
  let rem = (path || '').replace(/^\$/, '');
  while (rem.length > 0) {
    const dm = rem.match(/^\.([^[.]+)(.*)/);
    if (dm) { segs.push({ t: 'k', k: dm[1] }); rem = dm[2]; continue; }
    const am = rem.match(/^\[(\d+)\](.*)/);
    if (am) { segs.push({ t: 'i', i: parseInt(am[1]) }); rem = am[2]; continue; }
    const wm = rem.match(/^\[\*\](.*)/);
    if (wm) { segs.push({ t: 'a' }); rem = wm[1]; continue; }
    break;
  }
  function _w(cur, si) {
    if (si >= segs.length) return (cur !== null && cur !== undefined && typeof cur !== 'object') ? String(cur) : null;
    const s = segs[si];
    if (!cur || typeof cur !== 'object') return null;
    if (s.t === 'k') return _w(cur[s.k], si + 1);
    if (s.t === 'i') return Array.isArray(cur) && s.i < cur.length ? _w(cur[s.i], si + 1) : null;
    if (s.t === 'a') {
      if (!Array.isArray(cur)) return null;
      for (const item of cur) { const r = _w(item, si + 1); if (r !== null) return r; }
      return null;
    }
    return null;
  }
  return _w(obj, 0);
}

// ---------------------------------------------------------------------------
// UTILITY: return true if key exists as an OWN array-valued property at ANY
// nesting level within obj (depth-limited to avoid runaway on huge bodies).
// ---------------------------------------------------------------------------
function _advDeepContainsKey(obj, key, _depth) {
  _depth = _depth || 0;
  if (_depth > 12 || !obj || typeof obj !== 'object') return false;
  if (Array.isArray(obj)) {
    for (let _i = 0; _i < Math.min(obj.length, 30); _i++) {
      if (_advDeepContainsKey(obj[_i], key, _depth + 1)) return true;
    }
    return false;
  }
  if (Object.prototype.hasOwnProperty.call(obj, key) && Array.isArray(obj[key])) return true;
  for (const k of Object.keys(obj)) {
    if (_advDeepContainsKey(obj[k], key, _depth + 1)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// UTILITY: walk all leaf string values in a JSON object/array.
// Calls cb(value, jsonPath) for each leaf string.
// Stops recursion at depth > 10 to guard against circular / deeply-nested docs.
// ---------------------------------------------------------------------------
function _advWalkLeaves(obj, path, cb, depth) {
  if (depth > 10 || obj === null || obj === undefined) return;
  if (typeof obj === 'string') { cb(obj, path); return; }
  if (typeof obj === 'number') { cb(String(obj), path); return; }
  if (Array.isArray(obj)) {
    // Only walk first 50 items — large arrays would flood the map
    const limit = Math.min(obj.length, 50);
    for (let i = 0; i < limit; i++) _advWalkLeaves(obj[i], path + '[' + i + ']', cb, depth + 1);
    return;
  }
  if (typeof obj === 'object') {
    for (const k of Object.keys(obj)) {
      _advWalkLeaves(obj[k], path ? path + '.' + k : k, cb, depth + 1);
    }
  }
}

// ---------------------------------------------------------------------------
// UTILITY: decide the value type for the badge display
// ---------------------------------------------------------------------------
function _advValueType(val) {
  if (!val || val.length < 6) return 'unknown';
  if (/^eyJ[A-Za-z0-9+/=_-]{10,}\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$/.test(val)) return 'jwt';
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)) return 'uuid';
  if (/^[0-9a-f]{32,}$/i.test(val)) return 'hex';
  if (/^[A-Za-z0-9+/=_.\-]{32,}$/.test(val)) return 'token';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// UTILITY: decide if a value matches any known dynamic pattern
// (used for Phase 3 medium-confidence scan)
// ---------------------------------------------------------------------------
function _advMatchesPattern(val) {
  if (!val || val.length < ADV_MIN_LEN) return false;
  return (
    /^eyJ[A-Za-z0-9+/=_-]{10,}\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$/.test(val) || // JWT
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val)    || // UUID
    /^[0-9a-f]{64}$/i.test(val) ||  // hex64
    /^[0-9a-f]{32}$/i.test(val) ||  // hex32
    /^[0-9a-f]{16}$/i.test(val) ||  // hex16
    /^[A-Za-z0-9+/=_.\-]{40,}$/.test(val)  // long opaque token
  );
}

// ---------------------------------------------------------------------------
// UTILITY: suggest a clean camelCase variable name from a JSON path or key
// e.g. "$.data.access_token" → "accessToken"
//      "Authorization"       → "authToken"
// ---------------------------------------------------------------------------
function _advSuggestName(jsonPath, headerKey, value) {
  let raw = '';
  if (jsonPath) {
    // take the last segment of the path
    raw = jsonPath.replace(/^.*[.\[]/, '').replace(/\]$/, '');
  } else if (headerKey) {
    raw = headerKey;
  } else {
    // derive from value type
    const t = _advValueType(value);
    raw = t === 'jwt' ? 'jwtToken' : t === 'uuid' ? 'correlationId' : 'dynamicValue';
  }
  // clean up and camelCase
  return raw
    .replace(/[-_\s]+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^[A-Z]/, c => c.toLowerCase())
    .replace(/[^a-zA-Z0-9]/g, '') || 'dynamicValue';
}

// ---------------------------------------------------------------------------
// UTILITY: truncate value for display
// ---------------------------------------------------------------------------
function _advPreview(val) {
  if (!val) return '';
  if (val.length <= 44) return val;
  return val.slice(0, 40) + '…';
}

// ---------------------------------------------------------------------------
// UTILITY: short URL label for display (method + last path segment)
// e.g. "https://api.example.com/v1/oauth/token" → "/oauth/token"
// ---------------------------------------------------------------------------
function _advShortUrl(entry) {
  if (!entry) return '?';
  const m = (entry.method || 'GET').toUpperCase();
  try {
    const u = entry.url || '';
    const path = u.replace(/^https?:\/\/[^/]+/, '').split('?')[0] || '/';
    return m + ' ' + path;
  } catch { return m; }
}

// ---------------------------------------------------------------------------
// UTILITY: check if a value is already handled by the existing correlation engine
// ---------------------------------------------------------------------------
function _advAlreadyCorrelated(value, existingCorrelations) {
  if (!existingCorrelations || !existingCorrelations.length) return false;
  for (const c of existingCorrelations) {
    if (!c.usages) continue;
    for (const u of c.usages) {
      const tv = u.tokenValue || u.originalValue || '';
      if (tv === value) return true;
      // Strip Bearer prefix from either side before comparing
      const tvStripped = tv.replace(/^bearer\s+/i, '');
      const valWithBearer = 'Bearer ' + value;
      if (tvStripped === value || tv === valWithBearer) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// PHASE 1: build a map of  value → {entryIdx, url, jsonPath}
// from all response bodies (in HAR order).
// We keep FIRST occurrence only (the response that produces the value).
// entries = S.entries1 (full array including filtered); i is the S.entries1 index.
// ---------------------------------------------------------------------------
function _advExtractResponseValues(entries) {
  const map = new Map(); // value → {entryIdx, url, jsonPath}
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.filtered || e.isMarker) continue; // skip filtered/marker, but keep i as original index
    const body = e.respBody || '';
    if (!body) continue;
    const obj = _advParseJson(body);
    if (!obj) {
      // Try plain string response: some APIs return just a token as bare string
      const trimmed = body.trim().replace(/^"|"$/g, '');
      if (trimmed.length >= ADV_MIN_LEN && _advMatchesPattern(trimmed) && !map.has(trimmed)) {
        map.set(trimmed, { entryIdx: i, url: _advShortUrl(e), jsonPath: null });
      }
      continue;
    }
    _advWalkLeaves(obj, '$', (val, path) => {
      if (val.length < ADV_MIN_LEN) return;
      if (ADV_SKIP_VALUES.has(val.toLowerCase())) return;
      if (!map.has(val)) {
        map.set(val, { entryIdx: i, url: _advShortUrl(e), jsonPath: path });
      }
    }, 0);
  }
  return map;
}

// ---------------------------------------------------------------------------
// PHASE 2: find response values that appear in later request bodies.
// Returns array of high-confidence candidate objects.
// NOTE: e.body is the HAR postData object {mimeType, text, params} — NOT a string.
//       e.body.text holds the raw body string.
//       e.body.params holds URL-encoded form fields [{name,value}].
// entries = S.entries1; i is the correct S.entries1 index used in correlation format.
// ---------------------------------------------------------------------------
function _advCrossReference(entries, responseValueMap) {
  const found = new Map(); // value → AdvisorCandidate (deduplicating across entries)

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.filtered || e.isMarker) continue; // skip, keep i as original S.entries1 index
    // Extract raw body text from the HAR postData object
    const bodyText = (e.body && e.body.text) || '';
    const bodyParams = (e.body && e.body.params) || []; // form-encoded fields

    // --- Scan JSON body ---
    if (bodyText) {
      const obj = _advParseJson(bodyText);
      if (!obj) {
        // plain string body — check direct match
        const trimmed = bodyText.trim().replace(/^"|"$/g, '');
        if (trimmed.length >= ADV_MIN_LEN && responseValueMap.has(trimmed)) {
          const src = responseValueMap.get(trimmed);
          if (src.entryIdx < i) {
            _advAddUsage(found, trimmed, src, { entryIdx: i, url: _advShortUrl(e), location: 'body_json', jsonPath: null }, 'high');
          }
        }
      } else {
        _advWalkLeaves(obj, '$', (val, path) => {
          if (val.length < ADV_MIN_LEN) return;
          if (ADV_SKIP_VALUES.has(val.toLowerCase())) return;
          if (!responseValueMap.has(val)) return;
          const src = responseValueMap.get(val);
          if (src.entryIdx >= i) return; // only use values from PRIOR responses
          _advAddUsage(found, val, src, { entryIdx: i, url: _advShortUrl(e), location: 'body_json', jsonPath: path }, 'high');
        }, 0);
      }
    }

    // --- Scan URL-encoded form params ---
    for (const p of bodyParams) {
      const val = String(p.value || '');
      if (val.length < ADV_MIN_LEN) continue;
      if (ADV_SKIP_VALUES.has(val.toLowerCase())) continue;
      if (!responseValueMap.has(val)) continue;
      const src = responseValueMap.get(val);
      if (src.entryIdx >= i) continue;
      // form params use body_form location so codegen emits correct substitution
      _advAddUsage(found, val, src, { entryIdx: i, url: _advShortUrl(e), location: 'body_form', jsonPath: p.name }, 'high');
    }

    // --- F4: Scan request headers (runs for ALL requests, not just those with a body) ---
    for (const h of (e.reqHdrs || [])) {
      const headerName = (h.name || '').toLowerCase();
      if (ADV_SKIP_REQ_HDRS.has(headerName)) continue;
      const val = String(h.value || '');
      // For Bearer tokens, strip the scheme prefix before lookup so we match the raw token
      const stripped = /^bearer\s+/i.test(val) ? val.replace(/^bearer\s+/i, '') : val;
      const lookupVal = responseValueMap.has(val) ? val : (responseValueMap.has(stripped) ? stripped : null);
      if (!lookupVal || lookupVal.length < ADV_MIN_LEN) continue;
      if (ADV_SKIP_VALUES.has(lookupVal.toLowerCase())) continue;
      const src = responseValueMap.get(lookupVal);
      if (src.entryIdx >= i) continue;
      _advAddUsage(found, lookupVal, src, { entryIdx: i, url: _advShortUrl(e), location: 'header', jsonPath: h.name }, 'high');
    }

    // --- F5: Scan URL path segments (REST path params: /api/resources/286522) ---
    // Only checks path segments (not query string — that's handled by Phase 2 query scan)
    const urlPath = (e.url || '').split('?')[0];
    for (const seg of urlPath.split('/')) {
      if (!seg || seg.length < ADV_MIN_LEN) continue;
      if (ADV_SKIP_VALUES.has(seg.toLowerCase())) continue;
      if (!responseValueMap.has(seg)) continue;
      const src = responseValueMap.get(seg);
      if (src.entryIdx >= i) continue; // value must come from a PRIOR response
      _advAddUsage(found, seg, src, { entryIdx: i, url: _advShortUrl(e), location: 'url_path', jsonPath: null }, 'high');
    }
  }
  return Array.from(found.values());
}

// ---------------------------------------------------------------------------
// PHASE 3: pattern scan — catch dynamic values in request bodies that weren't
// found in any response (e.g. truncated HAR, first-ever recording).
// Returns array of medium-confidence candidate objects.
// NOTE: same e.body structure as Phase 2 — use e.body.text not e.body directly.
// entries = S.entries1; i is the correct S.entries1 index.
// ---------------------------------------------------------------------------
function _advPatternScan(entries, alreadyFoundValues) {
  const found = new Map();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.filtered || e.isMarker) continue; // skip, keep i as original S.entries1 index
    const bodyText = (e.body && e.body.text) || '';
    if (!bodyText) continue;
    const obj = _advParseJson(bodyText);
    if (!obj) {
      // Check plain string body directly
      const trimmed = bodyText.trim().replace(/^"|"$/g, '');
      if (trimmed.length >= ADV_MIN_LEN && !alreadyFoundValues.has(trimmed) && _advMatchesPattern(trimmed)) {
        _advAddUsage(found, trimmed, null, { entryIdx: i, url: _advShortUrl(e), location: 'body_json', jsonPath: null }, 'medium');
      }
      continue;
    }

    _advWalkLeaves(obj, '$', (val, path) => {
      if (alreadyFoundValues.has(val)) return; // Phase 2 already covered it
      if (!_advMatchesPattern(val)) return;
      if (ADV_SKIP_VALUES.has(val.toLowerCase())) return;
      _advAddUsage(found, val, null, { entryIdx: i, url: _advShortUrl(e), location: 'body_json', jsonPath: path }, 'medium');
    }, 0);
  }
  return Array.from(found.values());
}

// ---------------------------------------------------------------------------
// HELPER: add or merge a usage into the found-map for a given value
// ---------------------------------------------------------------------------
function _advAddUsage(foundMap, value, source, usage, confidence) {
  if (foundMap.has(value)) {
    const existing = foundMap.get(value);
    // only add usage if not duplicate entry
    if (!existing.usages.some(u => u.entryIdx === usage.entryIdx)) {
      existing.usages.push(usage);
    }
  } else {
    foundMap.set(value, {
      id: 'adv-' + foundMap.size,
      value,
      preview: _advPreview(value),
      valueType: _advValueType(value),
      confidence,
      varName: _advSuggestName(source ? source.jsonPath : null, null, value),
      source: source ? { entryIdx: source.entryIdx, url: source.url, jsonPath: source.jsonPath } : null,
      usages: [usage],
      status: 'pending',
    });
  }
}

// ---------------------------------------------------------------------------
// F1: Merge array-sibling candidates into a single SelectAll candidate.
// When multiple candidates share the same array base path (e.g. $.items[0].id,
// $.items[1].id, $.items[2].id), merge them into one candidate with
// source.jsonPath = $.items[*].id and _selectAll = true.
// This generates web_reg_save_param_json with SelectAll=Yes (VuGen) or
// {all: true} (DevWeb) so a loop-skeleton can iterate the captured array.
// ---------------------------------------------------------------------------
function _advMergeArrayCandidates(candidates) {
  // Map: basePath → array of candidates
  const arrayGroups = new Map();
  const nonArray = [];

  for (const c of candidates) {
    if (!c.source || !c.source.jsonPath) { nonArray.push(c); continue; }
    // Match any array index in the path: $.items[0], $.tokens[2].value, etc.
    const m = c.source.jsonPath.match(/^(.*)\[(\d+)\](.*)$/);
    if (!m) { nonArray.push(c); continue; }
    const basePath = m[1] + '[*]' + m[3];
    if (!arrayGroups.has(basePath)) arrayGroups.set(basePath, []);
    arrayGroups.get(basePath).push(c);
  }

  const result = [...nonArray];

  for (const [basePath, group] of arrayGroups) {
    if (group.length < 2) {
      // Single element — not really an array pattern, keep unchanged
      result.push(group[0]);
      continue;
    }
    // Merge all sibling candidates into one SelectAll candidate
    const first = group[0];
    const seenEntries = new Set();
    const allUsages = group.flatMap(c => c.usages).filter(u => {
      if (seenEntries.has(u.entryIdx)) return false;
      seenEntries.add(u.entryIdx);
      return true;
    });
    result.push({
      id: first.id,
      value: '(array — ' + group.length + ' items)',
      preview: basePath,
      valueType: first.valueType,
      confidence: 'high',
      varName: _advSuggestName(basePath, null, '') + 'Arr',
      source: { entryIdx: first.source.entryIdx, url: first.source.url, jsonPath: basePath },
      usages: allUsages,
      status: 'pending',
      isArray: true,
      _selectAll: true,
    });
  }

  return result;
}

// ---------------------------------------------------------------------------
// F2 helper: find fields in the target array that are dynamic (values vary
// across items) but were NOT detected as correlated columns or static fields.
// These become placeholder columns so the codegen always emits every field.
// ---------------------------------------------------------------------------
function _advFindUnresolvedFields(entry, targetArrayKey, knownKeys) {
  if (!entry) return [];
  const bText = (entry.body && entry.body.text) || '';
  if (!bText) return [];
  let arr;
  try { const bObj = JSON.parse(bText); arr = bObj && bObj[targetArrayKey]; } catch {}
  if (!Array.isArray(arr) || arr.length === 0) return [];
  const firstItem = arr[0];
  if (!firstItem || typeof firstItem !== 'object') return [];
  const result = [];
  for (const k of Object.keys(firstItem)) {
    if (knownKeys.has(k)) continue;
    const values = arr.map(item => (item && item[k] != null) ? String(item[k]) : '');
    const nonEmpty = values.filter(v => v !== '');
    if (nonEmpty.length === 0) continue;                                           // all empty → skip
    if (new Set(nonEmpty).size === 1 && nonEmpty.length === arr.length) continue;  // constant → already static
    result.push(k);
  }
  return result;
}

// ---------------------------------------------------------------------------
// F2 helper: choose countVar anchor — the non-placeholder column whose
// targetKey has the most non-empty values across all items in the HAR array.
// Avoids picking a sparsely-populated field (e.g. pairingID) over one that
// is always present (e.g. systemID).
// ---------------------------------------------------------------------------
function _advBestAnchorVarName(columns, entry, targetArrayKey) {
  const candidates = columns.filter(c => !c._placeholder);
  if (!candidates.length) return (columns[0] && columns[0].varName) || 'items';
  const bText = (entry && entry.body && entry.body.text) || '';
  if (!bText) return candidates[0].varName;
  let arr;
  try { const bObj = JSON.parse(bText); arr = bObj && bObj[targetArrayKey]; } catch {}
  if (!Array.isArray(arr) || !arr.length) return candidates[0].varName;
  let bestVar = candidates[0].varName, bestCount = -1;
  for (const col of candidates) {
    const count = arr.filter(item => {
      const v = item && item[col.targetKey];
      return v != null && String(v) !== '';
    }).length;
    if (count > bestCount) { bestVar = col.varName; bestCount = count; }
  }
  return bestVar;
}

// ---------------------------------------------------------------------------
// F2: After SelectAll merging, detect when multiple _selectAll candidates all
// feed into the SAME target array in a request body.
// Groups them into a single _arrayReconstruct meta-candidate so the codegen
// can emit a runtime loop instead of hardcoded array items.
//
// Detection: usage.jsonPath matching $.arrayKey[N].fieldName pattern indicates
// this SelectAll column feeds into a target array position.
// Groups by (targetReqIdx, targetArrayKey). Requires ≥1 column per group.
// Absorbed _selectAll candidates are removed; ungroupable ones stay as-is.
// ---------------------------------------------------------------------------
function _advDetectArrayGroups(candidates) {
  const ARRAY_USAGE_RE = /^\$\.([^[.]+)\[(\d+)\]\.(.+)$/;
  const selectAllCandidates = candidates.filter(c => c._selectAll && !c._manual);
  const otherCandidates    = candidates.filter(c => !c._selectAll || c._manual);

  // Map: "reqIdx::arrayKey" → [candidate]
  const groups    = new Map();
  const ungroupable = [];

  for (const c of selectAllCandidates) {
    if (!c.usages || !c.usages.length) { ungroupable.push(c); continue; }

    // Find the (reqIdx, arrayKey) pair that appears most in usages
    const tally = new Map();
    for (const u of c.usages) {
      if (u.location !== 'body_json' || !u.jsonPath) continue;
      const m = u.jsonPath.match(ARRAY_USAGE_RE);
      if (!m) continue;
      const key = u.entryIdx + '::' + m[1];
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    if (tally.size === 0) { ungroupable.push(c); continue; }

    // Take the most frequent (reqIdx, arrayKey)
    let best = null, bestCount = 0;
    for (const [k, cnt] of tally) { if (cnt > bestCount) { best = k; bestCount = cnt; } }

    if (!groups.has(best)) groups.set(best, []);
    groups.get(best).push(c);
  }

  const result = [...otherCandidates, ...ungroupable];

  for (const [groupKey, groupCandidates] of groups) {
    const sep = groupKey.indexOf('::');
    const reqIdx         = parseInt(groupKey.slice(0, sep));
    const targetArrayKey = groupKey.slice(sep + 2);

    // Build column list — each _selectAll candidate becomes one column
    const columns = [];
    for (const c of groupCandidates) {
      if (!c.source || !c.source.jsonPath) continue;
      // Derive target field from first matching usage
      let targetKey = '';
      for (const u of c.usages) {
        if (!u.jsonPath) continue;
        const m = u.jsonPath.match(ARRAY_USAGE_RE);
        if (m && m[1] === targetArrayKey) { targetKey = m[3]; break; }
      }
      if (!targetKey) {
        // Fallback: use the leaf segment of the source path
        targetKey = c.source.jsonPath.replace(/^.*[.[]/g, '').replace(/[\]*]/g, '');
      }
      const rawName = _advSuggestName(c.source.jsonPath, null, '').replace(/Arr$/, '');
      const varName = rawName ? rawName + 's' : (targetArrayKey + '_' + targetKey);
      columns.push({ sourceJsonPath: c.source.jsonPath, varName, targetKey });
    }

    if (columns.length === 0) {
      result.push(...groupCandidates);
      continue;
    }

    // Infer static fields from HAR body of target entry
    const targetEntry     = (S.entries1 || [])[reqIdx];
    const knownTargetKeys = new Set(columns.map(col => col.targetKey));
    const staticFields    = _advInferStaticFields(targetEntry, targetArrayKey, knownTargetKeys);

    // Placeholder columns: dynamic fields present in array items but not auto-detected
    // as correlated. Codegen emits a TODO comment so users know to add the correlation.
    const staticFieldKeys = new Set(staticFields.map(f => f.targetKey));
    const allKnownKeys    = new Set([...knownTargetKeys, ...staticFieldKeys]);
    const unresolved = _advFindUnresolvedFields(targetEntry, targetArrayKey, allKnownKeys);
    for (const k of unresolved) {
      const vn = _advSuggestName('$.' + targetArrayKey + '[*].' + k, null, '').replace(/Arr$/, '') + 's';
      columns.push({ sourceJsonPath: null, varName: vn, targetKey: k, _placeholder: true });
    }

    // Anchor: non-placeholder column with the most non-empty values in the HAR body
    // so the loop count reflects the fullest field (e.g. systemID over pairingID).
    const anchorVarName = _advBestAnchorVarName(columns, targetEntry, targetArrayKey);

    const first = groupCandidates[0];

    // Determine item count hint from HAR
    let itemCountHint = 0;
    if (targetEntry) {
      const bText = (targetEntry.body && targetEntry.body.text) || '';
      if (bText) {
        try {
          const bObj = JSON.parse(bText);
          const arr = bObj && bObj[targetArrayKey];
          if (Array.isArray(arr)) itemCountHint = arr.length;
        } catch {}
      }
    }

    const detectedCols    = columns.filter(c => !c._placeholder).length;
    const placeholderCols = columns.length - detectedCols;
    const colsLabel = placeholderCols > 0
      ? detectedCols + ' cols + ' + placeholderCols + ' TODO'
      : detectedCols + ' cols';
    const labelCount = itemCountHint > 0 ? itemCountHint + ' items' : 'N items';
    // Primary usage at the first detected request
    const _primaryUsage = {
      entryIdx: reqIdx,
      url: targetEntry ? _advShortUrl(targetEntry) : '?',
      location: 'body_array',
      jsonPath: targetArrayKey,
    };

    // Additional usages: scan ALL entries for the same targetArrayKey at any nesting depth.
    // This handles cases where the same array pattern appears in multiple requests
    // (e.g., nextAlerts at top-level in t6.inf AND nested inside hitList[0] in t12.inf).
    const _extraUsages = [];
    const _seenExtras = new Set([reqIdx]);
    const _allEntries2 = (typeof S !== 'undefined' && S.entries1) || [];
    for (let _ei2 = 0; _ei2 < _allEntries2.length; _ei2++) {
      if (_seenExtras.has(_ei2)) continue;
      const _e2 = _allEntries2[_ei2];
      if (!_e2 || _e2.filtered || _e2.isMarker) continue;
      const _bt2 = (_e2.body && _e2.body.text) || '';
      if (!_bt2) continue;
      let _bObj2;
      try { _bObj2 = JSON.parse(_bt2); } catch { continue; }
      if (_advDeepContainsKey(_bObj2, targetArrayKey)) {
        _seenExtras.add(_ei2);
        _extraUsages.push({
          entryIdx: _ei2,
          url: _advShortUrl(_e2),
          location: 'body_array',
          jsonPath: targetArrayKey,
        });
      }
    }

    result.push({
      id: first.id,
      value: '(array — ' + colsLabel + ' × ' + labelCount + ')',
      preview: targetArrayKey + '[*]',
      valueType: 'array',
      confidence: 'high',
      varName: targetArrayKey.charAt(0).toLowerCase() + targetArrayKey.slice(1),
      source: first.source,
      usages: [_primaryUsage, ..._extraUsages],
      status: 'pending',
      _arrayReconstruct: true,
      _arrayConfig: {
        targetArrayKey,
        countVar: anchorVarName,
        columns,
        staticFields,
        _itemCountHint: itemCountHint,
      },
    });

    // Companion candidate: standalone occurrences of the anchor column's values
    // outside the target array. Surfaced as a separate SelectAll card so the user
    // can accept it and toggle it to random_select.
    // Example: nextAlerts array_reconstruct built from systemIds → but the request
    // body ALSO has a standalone "systemID" field (the selected alert) that needs
    // independent parameterization.
    const _anchorCol = columns.find(col => col.varName === anchorVarName && !col._placeholder);
    if (_anchorCol && _anchorCol.sourceJsonPath) {
      const _srcE = (_allEntries2 && _allEntries2[first.source.entryIdx]);
      const _srcResBody = (_srcE && ((_srcE.response && _srcE.response.body && _srcE.response.body.text) || _srcE.resBody)) || '';
      let _sampleVal = null;
      if (_srcResBody) {
        try { _sampleVal = _advGetValueAtPath(JSON.parse(_srcResBody), _anchorCol.sourceJsonPath); } catch {}
      }
      if (_sampleVal && _sampleVal.length >= ADV_MIN_LEN) {
        const _companionUsages = [];
        const _seenComp = new Set();
        for (let _ci2 = 0; _ci2 < _allEntries2.length; _ci2++) {
          const _ce2 = _allEntries2[_ci2];
          if (!_ce2 || _ce2.filtered || _ce2.isMarker) continue;
          const _cbt2 = (_ce2.body && _ce2.body.text) || '';
          if (!_cbt2 || !_cbt2.includes(_sampleVal)) continue;
          let _cbObj2;
          try { _cbObj2 = JSON.parse(_cbt2); } catch { continue; }
          let _foundPath = null;
          _advWalkLeaves(_cbObj2, '$', function(v, p) {
            if (_foundPath || v !== _sampleVal) return;
            // Skip if the path is inside the target array: $.arrayKey[N].field or nested
            if (p.includes(targetArrayKey + '[')) return;
            _foundPath = p;
          }, 0);
          if (_foundPath && !_seenComp.has(_ci2)) {
            _seenComp.add(_ci2);
            _companionUsages.push({
              entryIdx: _ci2,
              url: _advShortUrl(_ce2),
              location: 'body_json',
              jsonPath: _foundPath,
              originalValue: _sampleVal,
              tokenValue: _sampleVal,
            });
          }
        }
        if (_companionUsages.length > 0) {
          const _compVarName = _anchorCol.varName.replace(/s$/, '') + '_pick';
          result.push({
            id: first.id + '-standalone',
            value: _sampleVal,
            preview: _anchorCol.sourceJsonPath + ' (standalone)',
            valueType: 'string',
            confidence: 'medium',
            varName: _compVarName,
            source: {
              entryIdx: first.source.entryIdx,
              jsonPath: _anchorCol.sourceJsonPath,
              url: first.source.url || '',
            },
            _selectAll: true,
            usages: _companionUsages,
            status: 'pending',
            _companionOf: targetArrayKey,
          });
        }
      }
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Helper: infer static fields from the target array's first item in the HAR
// request body. Keys NOT in knownKeys with a consistent value across all items
// are returned as static field definitions.
// ---------------------------------------------------------------------------
function _advInferStaticFields(entry, targetArrayKey, knownKeys) {
  if (!entry) return [];
  const bText = (entry.body && entry.body.text) || '';
  if (!bText) return [];
  let parsed;
  try { parsed = JSON.parse(bText); } catch { return []; }
  if (!parsed) return [];

  const arr = parsed[targetArrayKey];
  if (!Array.isArray(arr) || arr.length === 0) return [];

  const firstItem = arr[0];
  if (!firstItem || typeof firstItem !== 'object') return [];

  const staticFields = [];
  for (const [k, v] of Object.entries(firstItem)) {
    if (knownKeys.has(k)) continue;
    if (v === null || v === undefined) continue;
    const vStr = String(v);
    const consistent = arr.every(item => {
      const iv = item[k];
      return iv === v || iv === null || iv === undefined || String(iv) === vStr;
    });
    if (consistent) staticFields.push({ targetKey: k, value: vStr });
  }
  return staticFields;
}

// ---------------------------------------------------------------------------
// PUBLIC: main entry point
// Call after S.entries1 is populated and S.correlations is finalized.
// Populates S.advisorCandidates.
// ---------------------------------------------------------------------------
function advisorScan(entries, existingCorrelations) {
  S.advisorCandidates = [];
  if (!entries || entries.length === 0) return;

  // Phase 1
  const responseValueMap = _advExtractResponseValues(entries);
  S._advValueMap = responseValueMap; // stored for Request Inspector use

  // Phase 2
  const highConf = _advCrossReference(entries, responseValueMap);

  // Phase 3 — only for values not already in Phase 2
  const highConfValues = new Set(highConf.map(c => c.value));
  const medConf = _advPatternScan(entries, highConfValues);

  // Merge
  let all = [...highConf, ...medConf];

  // Phase 4 — filter
  all = all.filter(c => {
    if (c.value.length < ADV_MIN_LEN) return false;
    if (ADV_SKIP_VALUES.has(c.value.toLowerCase())) return false;
    if (_advAlreadyCorrelated(c.value, existingCorrelations)) return false;
    // skip pure numerics — could be IDs but unlikely to be dynamic
    if (/^\d+$/.test(c.value) && c.value.length < 15) return false;
    return true;
  });

  // Deduplicate by value (safety net — shouldn't be needed but guards Map edge cases)
  const seen = new Set();
  all = all.filter(c => { if (seen.has(c.value)) return false; seen.add(c.value); return true; });

  // F1: Merge array siblings into SelectAll candidates
  all = _advMergeArrayCandidates(all);

  // F2: Detect groups of SelectAll candidates that feed the same target array
  // and promote them to _arrayReconstruct meta-candidates
  all = _advDetectArrayGroups(all);

  // Re-index IDs after filtering
  all.forEach((c, i) => { c.id = 'adv-' + i; });

  // Cap
  S.advisorCandidates = all.slice(0, ADV_MAX_CANDIDATES);

  console.log('[Advisor] scan complete —', S.advisorCandidates.length, 'candidates found',
    '(high:', S.advisorCandidates.filter(c=>c.confidence==='high').length,
    ' medium:', S.advisorCandidates.filter(c=>c.confidence==='medium').length, ')');
}

// ---------------------------------------------------------------------------
// PUBLIC: convert an accepted AdvisorCandidate into the existing S.correlations
// entry format used by studio-codegen.js.
// Called by applyAndRegen() in studio-app.js for each accepted candidate.
// ---------------------------------------------------------------------------
function advisorToCorrelation(candidate) {
  const usages = candidate.usages.map(u => ({
    reqIdx: u.entryIdx,                         // correct S.entries1 index
    location: u.location,                        // 'body_json' | 'body_form' | 'header'
    key: u.jsonPath ? u.jsonPath.split('.').pop().replace(/[\[\]]/g, '') : 'value',
    tokenValue: candidate.value,
    originalValue: candidate.value,
    prefix: '',
  }));

  // Array reconstruction: short-circuit — all config is already in _arrayConfig.
  // Map ALL detected body_array usages so array sentinel is placed in every request
  // that contains the target array key (e.g. top-level in t6.inf AND nested in t12.inf).
  if (candidate._arrayReconstruct) {
    const _arrUsages = candidate.usages
      .filter(u => u.location === 'body_array')
      .map(u => ({
        reqIdx: u.entryIdx,
        location: 'body_array',
        key: candidate._arrayConfig.targetArrayKey,
        tokenValue: 'array',
        originalValue: 'array',
        prefix: '',
      }));
    // Always have at least the primary usage
    if (_arrUsages.length === 0) {
      _arrUsages.push({
        reqIdx: candidate.usages[0].entryIdx,
        location: 'body_array',
        key: candidate._arrayConfig.targetArrayKey,
        tokenValue: 'array',
        originalValue: 'array',
        prefix: '',
      });
    }
    return {
      name: candidate.varName,
      sourceIdx: candidate.source ? candidate.source.entryIdx : 0,
      extractorType: 'array_reconstruct',
      extractorConfig: candidate._arrayConfig,
      usages: _arrUsages,
      _fromAdvisor: true,
    };
  }

  // Determine extractor type and config
  let extractorType, extractorConfig;
  if (candidate._manual) {
    // User explicitly chose the extract method via the modal
    const et = candidate._extractType || 'jsonpath';
    if (et === 'jsonpath') {
      extractorType = 'jsonpath';
      extractorConfig = { path: candidate._extractValue };
    } else if (et === 'header') {
      // Extract from response header — use boundary_header with header-name LB
      extractorType = 'boundary_header';
      extractorConfig = { lb: candidate._extractValue + ': ', rb: '\r\n' };
    } else {
      // boundary: user-supplied left boundary string, empty RB (they review the script)
      extractorType = 'boundary';
      extractorConfig = { lb: candidate._extractValue, rb: '' };
    }
  } else if (candidate.source && candidate.source.jsonPath) {
    // Auto-detected via HAR response scan: use the JSON path we traced
    extractorType = 'jsonpath';
    extractorConfig = candidate._selectAll
      ? { path: candidate.source.jsonPath, selectAll: true }
      : { path: candidate.source.jsonPath };
  } else {
    // Medium-confidence, no known source path: boundary fallback
    extractorType = 'boundary';
    extractorConfig = { lb: candidate.value.slice(0, 8), rb: '' };
  }

  return {
    name: candidate.varName,
    sourceIdx: candidate.source ? candidate.source.entryIdx : (usages[0] ? Math.max(0, usages[0].reqIdx - 1) : 0),
    extractorType,
    extractorConfig,
    usages,
    _fromAdvisor: true,
  };
}

// ---------------------------------------------------------------------------
// PUBLIC: add a manual candidate directly (from the "Add Manual" modal)
// sourceEntryIdx — index in S.entries1 of the response to extract from
// extractType    — "jsonpath" | "boundary" | "header"
// extractValue   — the JSON path, boundary string, or header name
// varName        — user-supplied variable name
// actualValue    — (optional) the already-resolved field value from the field browser;
//                  used to scan all subsequent requests for usages to substitute
// ---------------------------------------------------------------------------
function advisorAddManual(sourceEntryIdx, extractType, extractValue, varName, actualValue) {
  const entry = (S.entries1 || [])[sourceEntryIdx];
  const id = 'adv-' + (S.advisorCandidates.length);

  // Auto-scan all SUBSEQUENT requests for the extracted value so the codegen
  // can substitute it everywhere (queryString, body, headers).
  const autoUsages = [];
  if (actualValue && actualValue.length >= 4) {
    const entries = S.entries1 || [];
    for (let i = sourceEntryIdx + 1; i < entries.length; i++) {
      const e = entries[i];
      if (e.filtered || e.isMarker) continue;

      const bodyText = (e.body && e.body.text) || '';
      const bodyParams = (e.body && e.body.params) || [];

      // JSON body
      if (bodyText) {
        const obj = _advParseJson(bodyText);
        if (obj) {
          _advWalkLeaves(obj, '$', (val, jpath) => {
            if (val === actualValue) {
              autoUsages.push({ entryIdx: i, url: _advShortUrl(e), location: 'body_json', jsonPath: jpath });
            }
          }, 0);
        }
      }

      // Form-encoded params
      for (const p of bodyParams) {
        if (String(p.value || '') === actualValue) {
          autoUsages.push({ entryIdx: i, url: _advShortUrl(e), location: 'body_form', jsonPath: p.name });
        }
      }

      // Query string — manual split to avoid URL() encoding {{variables}}
      const urlStr = e.url || '';
      const qIdx = urlStr.indexOf('?');
      if (qIdx >= 0) {
        const qs = urlStr.slice(qIdx + 1);
        for (const part of qs.split('&')) {
          const eqI = part.indexOf('=');
          if (eqI < 0) continue;
          const k = part.slice(0, eqI);
          const v = _advQsDecode(part.slice(eqI + 1));
          if (v === actualValue) {
            autoUsages.push({ entryIdx: i, url: _advShortUrl(e), location: 'query', jsonPath: k });
          }
        }
      }

      // Request headers (check with and without Bearer prefix)
      for (const h of (e.reqHdrs || [])) {
        const val = String(h.value || '');
        const stripped = val.replace(/^bearer\s+/i, '');
        if (val === actualValue || stripped === actualValue) {
          autoUsages.push({ entryIdx: i, url: _advShortUrl(e), location: 'header', jsonPath: h.name });
        }
      }

      // URL path segments (REST path params: /api/resources/286522)
      const urlPath = (urlStr.split('?')[0]);
      for (const seg of urlPath.split('/')) {
        if (seg === actualValue) {
          autoUsages.push({ entryIdx: i, url: _advShortUrl(e), location: 'url_path', jsonPath: null });
          break; // only push once per request even if the value appears in multiple segments
        }
      }
    }
  }

  const candidate = {
    id,
    value: actualValue || '(manual)',
    preview: actualValue ? (actualValue.length > 40 ? actualValue.slice(0, 40) + '…' : actualValue) : extractValue,
    valueType: 'token',
    confidence: 'high',
    varName: varName || _advSuggestName(extractType === 'jsonpath' ? extractValue : null, extractType === 'header' ? extractValue : null, actualValue || ''),
    source: { entryIdx: sourceEntryIdx, url: entry ? _advShortUrl(entry) : '?', jsonPath: extractType === 'jsonpath' ? extractValue : null },
    usages: autoUsages,
    status: 'accepted', // manual adds go straight to accepted
    _manual: true,
    _extractType: extractType,
    _extractValue: extractValue,
  };
  S.advisorCandidates.push(candidate);
  return candidate;
}

// ---------------------------------------------------------------------------
// PUBLIC: fill inferred source paths for ALL placeholder columns and set anchor.
// candidateId — the candidate's .id (e.g. "adv-0")
// primaryKey  — targetKey of the field to use as loop anchor (e.g. "systemID")
//
// How inference works: takes the base path from any already-detected column
// (e.g. "$.alerts[*].pairingID" → base = "$.alerts[*]") and appends the
// placeholder's targetKey to derive its source path automatically.
// ---------------------------------------------------------------------------

// Navigate a parsed JSON object to the array identified by a [*]-terminated
// JSONPath (e.g. "$.liveCountDetails[0].liveGridData[*]") and return the first
// item of that array, used to resolve correct field-name casing.
function _advSampleItemAtPath(obj, starPath) {
  if (!obj || !starPath) return null;
  // Strip leading "$." and trailing "[*]"
  const inner = starPath.replace(/^\$\.?/, '').replace(/\[\*\]$/, '');
  let cur = obj;
  if (!inner) return Array.isArray(cur) ? cur[0] || null : null;
  for (const seg of inner.split('.')) {
    if (!cur || typeof cur !== 'object') return null;
    const m = seg.match(/^([^\[]+)\[(\d+)\]$/);
    if (m) {
      cur = cur[m[1]];
      if (!Array.isArray(cur)) return null;
      cur = cur[parseInt(m[2])];
    } else {
      cur = cur[seg];
    }
  }
  return Array.isArray(cur) ? cur[0] || null : (cur || null);
}

function advisorFillArrayPaths(candidateId, primaryKey) {
  const candidate = (S.advisorCandidates || []).find(c => c.id === candidateId);
  if (!candidate || !candidate._arrayReconstruct) return;
  const cfg = candidate._arrayConfig || {};
  const columns = cfg.columns || [];

  // Need at least one real (non-placeholder) column to infer the base path
  const realCol = columns.find(c => !c._placeholder && c.sourceJsonPath);
  if (!realCol) return;

  // Strip last field segment: "$.alerts[*].pairingId" → "$.alerts[*]"
  const basePath = realCol.sourceJsonPath.replace(/\.[^.[]+$/, '');

  // Get a sample item from the source response to resolve correct field-name casing.
  // The response key may differ in case from the request key (e.g. "systemId" vs "systemID").
  let sampleItem = null;
  const srcEntry = (S.entries1 || [])[(candidate.source && candidate.source.entryIdx != null ? candidate.source.entryIdx : -1)];
  if (srcEntry && srcEntry.respBody) {
    try { sampleItem = _advSampleItemAtPath(JSON.parse(srcEntry.respBody), basePath); } catch {}
  }

  // Promote every placeholder column to a real column with a case-correct inferred path
  for (const col of columns) {
    if (!col._placeholder) continue;
    let fieldName = col.targetKey;
    if (sampleItem && typeof sampleItem === 'object') {
      const lower = col.targetKey.toLowerCase();
      const actual = Object.keys(sampleItem).find(k => k.toLowerCase() === lower);
      if (actual) fieldName = actual;
    }
    col.sourceJsonPath = basePath + '.' + fieldName;
    delete col._placeholder;
  }

  // Set the loop anchor to the chosen primary key
  const primaryCol = columns.find(c => c.targetKey === primaryKey);
  if (primaryCol) cfg.countVar = primaryCol.varName;

  // Refresh the candidate display label (removes "+ N TODO" suffix)
  const hint = cfg._itemCountHint || 0;
  const labelCount = hint > 0 ? hint + ' items' : 'N items';
  candidate.value = '(array — ' + columns.length + ' cols × ' + labelCount + ')';
}

// ---------------------------------------------------------------------------
// PUBLIC: change only the loop anchor of an already-complete array reconstruct.
// (Used when all paths are filled but user wants a different primary key.)
// ---------------------------------------------------------------------------
function advisorSetArrayAnchor(candidateId, primaryKey) {
  const candidate = (S.advisorCandidates || []).find(c => c.id === candidateId);
  if (!candidate || !candidate._arrayReconstruct) return;
  const cfg = candidate._arrayConfig || {};
  const col = (cfg.columns || []).find(c => c.targetKey === primaryKey && !c._placeholder);
  if (col) cfg.countVar = col.varName;
}

// ---------------------------------------------------------------------------
// REQUEST INSPECTOR: get all request fields, classified by traffic-light status
// Returns [{key, value, location, status, traceSource}]
// status: 'green' (traced to prior response) | 'yellow' (dynamic pattern) | 'static'
// ---------------------------------------------------------------------------
function advGetRequestFields(entryIdx) {
  const entries = S.entries1 || [];
  const e = entries[entryIdx];
  if (!e) return [];

  // Ensure response map is available (may not exist if advisor scan hasn't run yet)
  const map = S._advValueMap || _advExtractResponseValues(entries);
  if (!S._advValueMap) S._advValueMap = map;

  const fields = [];

  function classify(val, stripped) {
    const lookup = stripped || val;
    const src = map.get(val) || (stripped ? map.get(stripped) : null);
    if (src && src.entryIdx < entryIdx) return { status: 'green', traceSource: src };
    if (_advMatchesPattern(lookup)) return { status: 'yellow', traceSource: null };
    return { status: 'static', traceSource: null };
  }

  // Request headers
  for (const h of (e.reqHdrs || [])) {
    const hname = (h.name || '').toLowerCase();
    if (ADV_SKIP_REQ_HDRS.has(hname)) continue;
    const hval = String(h.value || '');
    if (!hval || hval.length < 4) continue;
    const stripped = /^bearer\s+/i.test(hval) ? hval.replace(/^bearer\s+/i, '') : null;
    const cl = classify(hval, stripped);
    if (cl.status === 'static' && !ADV_AUTH_HDRS.has(hname)) continue; // skip boring static headers
    fields.push({ key: h.name, value: hval, location: 'header', ...cl });
  }

  // JSON body
  const bodyText = (e.body && e.body.text) || '';
  if (bodyText) {
    const bodyObj = _advParseJson(bodyText);
    if (bodyObj) {
      _advWalkLeaves(bodyObj, '$', (val, path) => {
        if (!val || val.length < 4) return;
        const cl = classify(val, null);
        if (cl.status === 'static' && !_advMatchesPattern(val)) return;
        fields.push({ key: path, value: val, location: 'body_json', ...cl });
      }, 0);
    }
    for (const bp of ((e.body && e.body.params) || [])) {
      const bval = String(bp.value || '');
      if (!bval || bval.length < 4) continue;
      const cl = classify(bval, null);
      fields.push({ key: bp.name, value: bval, location: 'body_form', ...cl });
    }
  }

  // Query string
  const urlStr = e.url || '';
  const qIdx = urlStr.indexOf('?');
  if (qIdx >= 0) {
    for (const part of urlStr.slice(qIdx + 1).split('&')) {
      const eqI = part.indexOf('=');
      if (eqI < 0) continue;
      const k = part.slice(0, eqI);
      const v = _advQsDecode(part.slice(eqI + 1));
      if (!v || v.length < 4) continue;
      const cl = classify(v, null);
      if (cl.status === 'static') continue;
      fields.push({ key: k, value: v, location: 'query', ...cl });
    }
  }

  // URL path segments (REST path params: /api/resources/286522)
  const urlPathOnly = urlStr.split('?')[0];
  for (const seg of urlPathOnly.split('/')) {
    if (!seg || seg.length < 4) continue;
    // Only show segments that look dynamic (numeric IDs, UUIDs, tokens)
    if (!/^\d{4,}$|^[0-9a-f]{8,}$/i.test(seg) && !_advMatchesPattern(seg)) continue;
    const cl = classify(seg, null);
    if (cl.status === 'static') continue;
    fields.push({ key: 'path:' + seg, value: seg, location: 'url_path', ...cl });
  }

  return fields;
}

// ---------------------------------------------------------------------------
// PASTE & CORRELATE: detect the best extractor for a value in pasted response text.
//
// Handles: JSON (single + multi-path), HTML attributes, HTML tag content,
// query-string parameters, JSON-in-plain-text, JWT/UUID/hex shapes.
//
// Returns {
//   extType, path, allPaths,                  ← JSON case
//   lb, rb, pattern, group,                   ← boundary / regexp case
//   allOccurrences, ordinal,                  ← when value found N > 1 times
//   contextType, contextLabel,                ← 'html_attribute' | 'html_tag' | …
//   varName, value, contentType, occurrences, confidence
// }
// or null (value genuinely not present)
// ---------------------------------------------------------------------------

function _advDetectContentType(text) {
  const t = (text || '').trim();
  if (!t) return 'empty';
  // Try JSON parse
  if (t[0] === '{' || t[0] === '[') {
    try { JSON.parse(t); return 'json'; } catch { /* fall through */ }
  }
  if (/^<\?xml/i.test(t) || (/^<[a-zA-Z]/.test(t) && /<\/[a-zA-Z]/.test(t) && !/<html/i.test(t))) return 'xml';
  if (/<html|<body|<!DOCTYPE/i.test(t) || /<(div|input|form|table|td|span|p|a)[^>]*>/i.test(t)) return 'html';
  return 'text';
}

// Analyse the characters BEFORE and AFTER the found value to determine the
// best extractor. Returns an occurrence descriptor object.
function _advBoundaryContext(before, after, value, contentType) {
  // 1. HTML attribute:  name="VALUE"  or  name='VALUE'
  const attrM = before.match(/([\w:_-]+=["'])$/);
  if (attrM) {
    const q = attrM[1].slice(-1); // the opening quote
    const rb = q; // matching close quote
    // Try to include full attribute name for specificity: take last attr=quote combo
    const lb = attrM[1];
    return { extType: 'boundary', lb, rb, contextType: 'html_attribute', contextLabel: 'HTML attribute value' };
  }

  // 2. HTML tag content: <tag...>VALUE</tag>
  const tagEndM = before.match(/<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>$/);
  if (tagEndM && contentType !== 'text') {
    const closeTag = '</' + tagEndM[1] + '>';
    if (after.trimStart().startsWith('</' + tagEndM[1])) {
      return { extType: 'boundary', lb: '<' + tagEndM[1] + '>', rb: closeTag, contextType: 'html_tag', contextLabel: 'HTML <' + tagEndM[1] + '> content' };
    }
  }

  // 3. JSON key-value in plain text: "key":"VALUE"
  const jsonKvM = before.match(/"([^"\\]{1,60})":"$/);
  if (jsonKvM) {
    const closeQ = after.startsWith('"') ? '"' : (after.match(/^[^,}\]\n"]*/) || [''])[0].length > 0 ? '' : '"';
    return { extType: 'boundary', lb: '"' + jsonKvM[1] + '":"', rb: '"', contextType: 'json_kv', contextLabel: 'JSON field "' + jsonKvM[1] + '"' };
  }

  // 4. Query-string parameter: ?param=VALUE or &param=VALUE
  const qsM = before.match(/[?&]([^&=\s]{1,40})=$/);
  if (qsM) {
    const rbChar = (after.match(/^([&\s"'\n])/) || [, '&'])[1];
    return { extType: 'boundary', lb: qsM[1] + '=', rb: rbChar, contextType: 'query_string', contextLabel: 'Query param "' + qsM[1] + '"' };
  }

  // 5. Generic HTML tag text content: look for > before value and < after
  if ((before.match(/>$/) || before.match(/>\s*$/)) && contentType !== 'text') {
    const tagBefore = before.match(/<([a-zA-Z][a-zA-Z0-9]*)(?:\s[^>]*)?>(?:\s*)$/);
    if (tagBefore) {
      return { extType: 'boundary', lb: '>' , rb: '<', contextType: 'html_content', contextLabel: 'HTML element content' };
    }
  }

  // 6. JWT/UUID/hex pattern → regexp is better than boundary
  if (/^eyJ[A-Za-z0-9+\/=_-]{10,}\.[A-Za-z0-9+\/=_-]+\.[A-Za-z0-9+\/=_-]+$/.test(value)) {
    return { extType: 'regexp', pattern: 'eyJ[A-Za-z0-9+/=_-]+\\.[A-Za-z0-9+/=_-]+\\.[A-Za-z0-9+/=_-]+', group: 0, contextType: 'jwt', contextLabel: 'JWT token (regexp)' };
  }
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    return { extType: 'regexp', pattern: '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}', group: 0, contextType: 'uuid', contextLabel: 'UUID (regexp)' };
  }
  if (/^[0-9a-f]{16,64}$/i.test(value)) {
    return { extType: 'regexp', pattern: '[0-9a-fA-F]{' + value.length + '}', group: 0, contextType: 'hex', contextLabel: 'Hex token (regexp)' };
  }

  // 7. Fallback: surrounding chars as boundary
  const lb = before.replace(/\n/g, '\\n').slice(-18);
  const rb = after.replace(/\n/g, '\\n').slice(0, 18).split('\n')[0];
  return { extType: 'boundary', lb, rb, contextType: 'generic', contextLabel: 'Surrounding text (generic boundary)' };
}

function advPasteDetect(responseText, targetValue) {
  if (!responseText || !targetValue || targetValue.length < 1) return null;
  const tv = targetValue.trim();
  const contentType = _advDetectContentType(responseText);
  const varName = _advSuggestName(null, null, tv);

  // ── JSON response ──────────────────────────────────────────────────────────
  if (contentType === 'json') {
    let bodyObj;
    try { bodyObj = JSON.parse(responseText.trim()); } catch { bodyObj = null; }
    if (bodyObj) {
      const allPaths = [];
      _advWalkLeaves(bodyObj, '$', (val, path) => {
        if (val === tv) allPaths.push({ path, exact: true, value: val });
        else if (typeof val === 'string' && val.includes(tv)) allPaths.push({ path, exact: false, value: val, _partial: true });
      }, 0);

      if (allPaths.length === 0) return null;

      // Best path: prefer exact match, then shortest path (less nested = more reliable)
      const exactPaths = allPaths.filter(p => p.exact);
      const best = (exactPaths.length ? exactPaths : allPaths)
        .sort((a, b) => (a.path.split('.').length + (a.path.match(/\[/g) || []).length)
                       - (b.path.split('.').length + (b.path.match(/\[/g) || []).length))[0];

      // Detect if array path: $.items[0] → suggest SelectAll hint
      const hasArrayIndex = /\[\d+\]/.test(best.path);

      return {
        extType: 'jsonpath',
        path: best.path,
        allPaths,
        varName: _advSuggestName(best.path, null, tv),
        value: tv,
        contentType: 'json',
        occurrences: allPaths.filter(p => p.exact).length || allPaths.length,
        confidence: exactPaths.length ? 'high' : 'medium',
        hasArrayIndex,
      };
    }
  }

  // ── Non-JSON: find all occurrences with context ────────────────────────────
  const lower = responseText.toLowerCase();
  const tvLower = tv.toLowerCase();
  if (!lower.includes(tvLower)) return null;

  const allOccurrences = [];
  let pos = 0;
  while (allOccurrences.length < 20) { // cap at 20 occurrences
    const fi = lower.indexOf(tvLower, pos);
    if (fi === -1) break;
    const actualVal = responseText.substring(fi, fi + tv.length);
    const before = responseText.substring(Math.max(0, fi - 100), fi);
    const after  = responseText.substring(fi + tv.length, fi + tv.length + 100);
    const ctx    = _advBoundaryContext(before, after, actualVal, contentType);
    allOccurrences.push({ ...ctx, position: fi, snippet: (before.slice(-20) + '【' + actualVal + '】' + after.slice(0, 20)).replace(/\n/g, ' ') });
    pos = fi + tv.length;
  }

  if (allOccurrences.length === 0) return null;

  // Pick first high-confidence occurrence as default
  const best = allOccurrences.find(o => o.contextType !== 'generic') || allOccurrences[0];

  return {
    extType: best.extType,
    lb: best.lb,
    rb: best.rb,
    pattern: best.pattern,
    group: best.group,
    contextType: best.contextType,
    contextLabel: best.contextLabel,
    allOccurrences,
    ordinal: allOccurrences.indexOf(best) + 1,
    varName,
    value: tv,
    contentType,
    occurrences: allOccurrences.length,
    confidence: best.contextType !== 'generic' ? 'high' : 'medium',
  };
}

// URL query-string value decoder (+ → space, %XX → char)
function _advQsDecode(s) {
  try { return decodeURIComponent((s || '').replace(/\+/g, ' ')); } catch { return s || ''; }
}
