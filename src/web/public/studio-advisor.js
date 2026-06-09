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
// PUBLIC: main entry point
// Call after S.entries1 is populated and S.correlations is finalized.
// Populates S.advisorCandidates.
// ---------------------------------------------------------------------------
function advisorScan(entries, existingCorrelations) {
  S.advisorCandidates = [];
  if (!entries || entries.length === 0) return;

  // Phase 1
  const responseValueMap = _advExtractResponseValues(entries);

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

// URL query-string value decoder (+ → space, %XX → char)
function _advQsDecode(s) {
  try { return decodeURIComponent((s || '').replace(/\+/g, ' ')); } catch { return s || ''; }
}
