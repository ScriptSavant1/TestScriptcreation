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

// Known CSRF / hidden-form-token field names — always server-generated per-session values
// that must be correlated even in single-HAR mode (two-HAR mode detects them via value diff).
const _CSRF_FIELD_RE = /^(authenticity_token|csrf_?token|_csrf_?token|_?csrf|csrfToken|csrfmiddlewaretoken|__RequestVerificationToken|_token|form_token|antiforgery|__antiForgery|__VIEWSTATE|__VIEWSTATEGENERATOR|__EVENTVALIDATION|xsrf_?token|x-xsrf-token|x-csrf-token)$/i;

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
// UTILITY: return the first Array found at `key` at any nesting level, or null.
// ---------------------------------------------------------------------------
function _advDeepFindArray(obj, key, _depth) {
  _depth = _depth || 0;
  if (_depth > 12 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (let _i = 0; _i < Math.min(obj.length, 20); _i++) {
      const _r = _advDeepFindArray(obj[_i], key, _depth + 1);
      if (_r) return _r;
    }
    return null;
  }
  if (Object.prototype.hasOwnProperty.call(obj, key) && Array.isArray(obj[key])) return obj[key];
  for (const _k of Object.keys(obj)) {
    const _r = _advDeepFindArray(obj[_k], key, _depth + 1);
    if (_r) return _r;
  }
  return null;
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
// PHASE 2.5: CSRF / hidden-form-token scan (single-HAR mode).
//
// Two-HAR comparison mode detects CSRF tokens by value difference between
// sessions. In single-HAR mode those values are the same in source + usage,
// so Phase 2 (responseValueMap lookup) never fires. This phase catches them
// by NAME pattern instead:
//   1. Walk each request's form body looking for fields whose name matches
//      _CSRF_FIELD_RE (authenticity_token, csrf_token, __RequestVerificationToken…)
//   2. For each such field, backward-scan ALL preceding response bodies
//      (HTML, JSON, plain text) for the token value
//   3. Emit a high-confidence boundary-extractor candidate
//
// entries must be the same S.entries1 slice passed to Phase 2.
// highConfValues is the Set of values already captured by Phase 2 — CSRF
// tokens that Phase 2 already found are skipped to avoid duplicates.
// ---------------------------------------------------------------------------
function _advCsrfScan(entries, highConfValues) {
  const found = new Map();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.filtered || e.isMarker) continue;

    // Collect CSRF-named fields from the request body
    const csrfFields = [];

    // Path A: HAR parser already split body into params array
    const bodyParams = (e.body && e.body.params) || [];
    for (const p of bodyParams) {
      const name = p.name || '';
      const val = String(p.value || '');
      if (_CSRF_FIELD_RE.test(name) && val.length >= ADV_MIN_LEN) {
        csrfFields.push({ name, value: val });
      }
    }

    // Path B: raw text body (application/x-www-form-urlencoded)
    if (!csrfFields.length) {
      for (const f of _advFormFieldsFromText(e.body)) {
        if (_CSRF_FIELD_RE.test(f.name) && f.value && f.value.length >= ADV_MIN_LEN) csrfFields.push(f);
      }
    }

    if (!csrfFields.length) continue;

    for (const cf of csrfFields) {
      if (highConfValues.has(cf.value)) continue; // Phase 2 already found it
      if (found.has(cf.value)) continue;           // deduplicate across requests

      // Backward-scan ALL preceding responses (including HTML) for the token value
      for (let j = i - 1; j >= 0; j--) {
        const src = entries[j];
        if (src.filtered || src.isMarker) continue;
        const srcBody = src.respBody || '';
        if (srcBody.length < cf.value.length || !srcBody.includes(cf.value)) continue;

        // Found the CSRF token in a prior response body
        _advAddUsage(
          found,
          cf.value,
          { entryIdx: j, url: _advShortUrl(src), jsonPath: cf.name },
          { entryIdx: i, url: _advShortUrl(e), location: 'body_form', jsonPath: cf.name },
          'high'
        );
        // The source is HTML / text, not JSON: boundaries read from the page itself (BUG-143 — this used to
        // become a JSON-path extractor named after the field, which finds nothing on an HTML page)
        const ext = _advHtmlValueExtractor(srcBody, cf.value);
        if (ext) found.get(cf.value)._extract = ext;
        break; // use the nearest (most recent) preceding response
      }
    }
  }

  return Array.from(found.values());
}

// ---------------------------------------------------------------------------
// Form fields of a URL-encoded request body ({name, value}, decoded); [] for any other body
// ---------------------------------------------------------------------------
function _advFormFieldsFromText(body) {
  const out = [];
  if (!body || !body.text) return out;
  const mime = (body.mimeType || '').toLowerCase();
  if (!(mime.includes('x-www-form-urlencoded') || mime.includes('form'))) return out;
  try {
    for (const part of body.text.split('&')) {
      const eqIdx = part.indexOf('=');
      if (eqIdx < 0) continue;
      const name = decodeURIComponent(part.slice(0, eqIdx).replace(/\+/g, ' '));
      let val;
      try { val = decodeURIComponent(part.slice(eqIdx + 1).replace(/\+/g, ' ')); }
      catch { val = part.slice(eqIdx + 1); }
      out.push({ name, value: val });
    }
  } catch { /* malformed body — skip */ }
  return out;
}

// ---------------------------------------------------------------------------
// Boundaries for a value inside an HTML / text response, read from the text itself and widened until the
// FIRST match is the value (a boundary extractor takes the first match). For an <input> or <meta> tag the left
// boundary starts at its name attribute when that comes first: name="userSession" value="  …  "
// Returns {extractorType: 'boundary', extractorConfig: {lb, rb}, field} or null.
// ---------------------------------------------------------------------------
function _advHtmlValueExtractor(text, value) {
  if (!text || !value) return null;
  const tagRe = /<(input|meta)\b[^>]*>/gi;
  let m;
  while ((m = tagRe.exec(text))) {
    const tag = m[0];
    const vm = /\b(value|content)\s*=\s*(["'])([^"']*)\2/i.exec(tag);
    if (!vm || vm[3] !== value) continue;
    const at = m.index + vm.index + vm[0].length - 1 - value.length;          // where the value starts in text
    const nm = /\bname\s*=\s*(["'])([^"']*)\1/i.exec(tag);
    const fromName = nm && nm.index < vm.index ? tag.slice(nm.index, vm.index + vm[0].length - 1 - value.length) : '';
    const lb0 = fromName || tag.slice(vm.index, vm.index + vm[0].length - 1 - value.length);
    const b = _advSafeBoundaries(text, at, value, lb0, vm[2]);
    if (b) return { extractorType: 'boundary', extractorConfig: { lb: b.lb, rb: b.rb }, field: nm ? nm[2] : null };
  }
  const at = text.indexOf(value);
  if (at < 0) return null;
  const b = _advSafeBoundaries(text, at, value, '', '');
  return b ? { extractorType: 'boundary', extractorConfig: { lb: b.lb, rb: b.rb }, field: null } : null;
}

// ---------------------------------------------------------------------------
// PHASE 2.6: HTML hidden-field scan (single-HAR mode) — BUG-141.
// A server keeps state in <input type="hidden" name=… value=…>; the next form post sends it back, under any
// field name (userSession, state, nonce …), so neither Phase 1 (JSON only) nor Phase 2.5 (CSRF names) sees it.
// For every form field of a request, the nearest earlier response that has the value in a HIDDEN input is the
// source. Only generated-looking values count (no spaces; a digit, or 20+ characters), so typed test data
// echoed into a hidden field stays test data.
// ---------------------------------------------------------------------------
function _advHiddenFieldScan(entries, knownValues) {
  const found = new Map();
  const generated = (v) => !/\s/.test(v) && (/\d/.test(v) || v.length >= 20);
  const hiddenIn = (text, v) => {
    const re = /<input\b[^>]*>/gi; let m;
    while ((m = re.exec(text))) {
      if (!/\btype\s*=\s*(["']?)hidden\1/i.test(m[0])) continue;
      const vm = /\bvalue\s*=\s*(["'])([^"']*)\1/i.exec(m[0]);
      if (vm && vm[2] === v) return true;
    }
    return false;
  };
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.filtered || e.isMarker) continue;
    const params = (e.body && e.body.params && e.body.params.length) ? e.body.params.map((p) => ({ name: p.name || '', value: String(p.value || '') })) : _advFormFieldsFromText(e.body);
    for (const f of params) {
      const v = f.value;
      if (v.length < ADV_MIN_LEN || knownValues.has(v) || ADV_SKIP_VALUES.has(v.toLowerCase()) || !generated(v)) continue;
      const usage = { entryIdx: i, url: _advShortUrl(e), location: 'body_form', jsonPath: f.name };
      if (found.has(v)) { _advAddUsage(found, v, null, usage, 'high'); continue; }
      for (let j = i - 1; j >= 0; j--) {
        const src = entries[j];
        if (src.filtered || src.isMarker) continue;
        const body = src.respBody || '';
        if (body.length < v.length || body.indexOf(v) < 0 || !hiddenIn(body, v)) continue;
        const ext = _advHtmlValueExtractor(body, v);
        if (!ext) break;
        _advAddUsage(found, v, { entryIdx: j, url: _advShortUrl(src), jsonPath: ext.field || f.name }, usage, 'high');
        found.get(v)._extract = ext;
        break;
      }
    }
  }
  return Array.from(found.values());
}

// ---------------------------------------------------------------------------
// PHASE 2.7: lists a page offers in a <select> (flights, slots, accounts) whose options look generated and that a
// later request sends one of back. One High candidate per <select>: a regular expression for the value of every
// <option …> (any attributes before it; VuGen Ordinal=ALL, DevWeb occurrence All), the range of this select's options
// among every match on the page (_range),
// each use with the value it sends and its place (tokenValue, listIdx — as BUG-150's lists). Used every value as
// recorded unless the user chooses otherwise (_pick). Options without value="…" (single quotes, no value) are left to
// Add manual correlation. Single candidates for one of its values from that page are dropped.
// ---------------------------------------------------------------------------
function _advSelectScan(entries, existingCorrelations) {
  const out = [];
  // the value of every <option …> on the page, whatever comes before it in the tag (selected="selected" …)
  const PATTERN = '<option\\b[^>]*?\\svalue="([^"]*)"';
  const generated = (v) => !/\s/.test(v) && v.length >= 4 && !/^\d{1,6}$/.test(v) && (/\d/.test(v) || v.length >= 20);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.filtered || e.isMarker) continue;
    const body = e.respBody || '';
    if (body.indexOf('<select') < 0 || body.indexOf('<option') < 0) continue;
    // every match on the page, in order (the places the extractor gives)
    const all = [], ore = new RegExp(PATTERN, 'g');
    let om;
    while ((om = ore.exec(body))) all.push({ at: om.index, v: om[1] });
    const re = /<select\b([^>]*)>([\s\S]*?)<\/select\s*>/gi;
    let m;
    while ((m = re.exec(body))) {
      const start = m.index, end = m.index + m[0].length;
      const tags = m[2].match(/<option\b[^>]*>/gi) || [];
      if (tags.length < 2 || tags.some(t => !/\svalue="/.test(t))) continue;
      const mine = all.map((x, n) => ({ v: x.v, pos: n + 1, at: x.at })).filter(x => x.at > start && x.at < end);
      if (mine.length !== tags.length) continue;
      const values = mine.map(x => x.v);
      if (values.some(v => _advAlreadyCorrelated(v, existingCorrelations))) continue;
      const usages = [], seen = new Set();
      for (const x of mine) {
        if (!x.v || seen.has(x.v) || !generated(x.v)) continue;
        seen.add(x.v);
        _advFindUsages(entries, i, x.v).forEach(u => usages.push(Object.assign(u, { tokenValue: x.v, listIdx: x.pos })));
      }
      if (!usages.length || values.filter(generated).length * 2 < values.length) continue;
      const nm = (/\bname\s*=\s*["']([^"']+)["']/i.exec(m[1]) || /\bid\s*=\s*["']([^"']+)["']/i.exec(m[1]) || [])[1];
      const from = mine[0].pos, to = mine[mine.length - 1].pos;
      const c = {
        value: '(list — ' + values.length + ' values)',
        preview: values.slice(0, 3).join(', ') + (values.length > 3 ? ', …' : ''),
        valueType: 'list',
        confidence: 'high',
        varName: (_advSafeVarName(nm || 'select') || 'select') + 'Options',
        source: { entryIdx: i, url: _advShortUrl(e), jsonPath: null },
        usages,
        status: 'pending',
        _selectAll: true,
        _select: nm || '',
        _extract: { extractorType: 'regexp', extractorConfig: { pattern: PATTERN, all: true } },
      };
      if (from > 1 || to < all.length) c._range = { from, to };
      out.push(c);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// PHASE 3: pattern scan — catch dynamic values in request bodies that weren't
// found in any response (e.g. truncated HAR, first-ever recording).
// Returns array of medium-confidence candidate objects.
// NOTE: same e.body structure as Phase 2 — use e.body.text not e.body directly.
// entries = S.entries1; i is the correct S.entries1 index.
// ---------------------------------------------------------------------------
// Phase 3b: a UUID that is a whole request header value or a whole query value, not already a candidate. Not: cookies
// (the engines keep them), the request's own addresses (referer, origin, host), sign-in headers, DPoP proofs.
const _ADV_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const _ADV_UUID_SKIP_HDR = /^(:|cookie$|referer$|origin$|host$|authorization$|proxy-authorization$|dpop(-pf)?$|user-agent$|if-none-match$|etag$)/i;
function _advUuidScan(entries, alreadyFoundValues) {
  const found = new Map();
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.filtered || e.isMarker) continue;
    (e.reqHdrs || []).forEach(h => {
      const v = String(h.value || '').trim();
      if (!_ADV_UUID_RE.test(v) || _ADV_UUID_SKIP_HDR.test(h.name || '') || alreadyFoundValues.has(v)) return;
      const before = found.has(v);
      _advAddUsage(found, v, null, { entryIdx: i, url: _advShortUrl(e), location: 'header', jsonPath: h.name }, 'medium');
      if (!before) found.get(v).varName = _advSuggestName(null, h.name, v);
    });
    const q = String(e.url || '').split('#')[0].split('?')[1];   // never new URL(): {{variables}} (CLAUDE.md rule 3)
    if (q) q.split('&').forEach(pair => {
      const k = pair.split('=')[0], raw = pair.slice(k.length + 1);
      const v = _advQsDecode(raw);
      if (!k || !_ADV_UUID_RE.test(v) || alreadyFoundValues.has(v)) return;
      const before = found.has(v);
      _advAddUsage(found, v, null, { entryIdx: i, url: _advShortUrl(e), location: 'query', jsonPath: _advQsDecode(k) }, 'medium');
      if (!before) found.get(v).varName = _advSuggestName(null, _advQsDecode(k), v);
    });
  }
  return Array.from(found.values());
}

function _advPatternScan(entries, alreadyFoundValues) {
  const found = new Map();

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.filtered || e.isMarker) continue; // skip, keep i as original S.entries1 index
    const bodyText = (e.body && e.body.text) || '';
    if (!bodyText) continue;
    const obj = _advParseJson(bodyText);
    if (!obj) {
      // A form (name=value&…) has fields, not one value: the whole body is not a token (BUG-144 — `csrf_token=<hex>`
      // became a card whose value no page has, read with a weak boundary)
      if ((e.body.params && e.body.params.length) || /x-www-form-urlencoded|multipart\/form-data/i.test(e.body.mimeType || '')) continue;
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
// ---------------------------------------------------------------------------
// The position (1-based) of the value at <prefix>[idx]<sub> among the matches of <prefix>[*]<sub> in a response —
// the order VuGen (SelectAll: name_1 … name_N) and DevWeb (an array) give: the items before it that have the field,
// plus one. null when the response cannot be read. (BUG-150)
// ---------------------------------------------------------------------------
function _advAt(obj, path) {
  const re = /\.([^.[\]]+)|\[(\d+)\]/g;
  let cur = obj, m;
  const p = String(path || '').replace(/^\$/, '');
  while ((m = re.exec(p))) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = m[1] != null ? cur[m[1]] : cur[+m[2]];
  }
  return cur;
}
function _advListPos(entry, prefix, idx, sub) {
  const obj = entry && _advParseJson(entry.respBody || '');
  const arr = obj ? _advAt(obj, prefix) : undefined;
  if (!Array.isArray(arr) || idx >= arr.length) return null;
  let n = 0;
  for (let j = 0; j < idx; j++) {
    const v = _advAt(arr[j], sub);
    if (v !== undefined && v !== null && typeof v !== 'object') n++;
  }
  return n + 1;
}

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
    // Merge all sibling candidates into one SelectAll candidate.
    // Dedup by (entryIdx, jsonPath, location) so both standalone usages ($.systemID)
    // and array usages ($.nextAlerts[0].systemID) from the same entry are preserved.
    const first = group[0];
    const seenUsageKeys = new Set();
    // Each use sends ONE value of the list: keep that value (tokenValue) and its place in the list (listIdx), so the
    // script sends the value at the same place (BUG-150 — before, every use had the list's label and nothing was
    // replaced). Values from another response are not in the list read here: they stay as before (not replaced), as a SelectAll list has no plain {name}.
    const _srcEntry = (S.entries1 || [])[first.source.entryIdx];
    const allUsages = group.flatMap(c => {
      const m2 = c.source.jsonPath.match(/^(.*)\[(\d+)\](.*)$/);
      const pos = c.source.entryIdx === first.source.entryIdx ? _advListPos(_srcEntry, m2[1], +m2[2], m2[3]) : null;
      return c.usages.map(u => pos ? Object.assign({}, u, { tokenValue: u.tokenValue || c.value, listIdx: pos }) : u);
    }).filter(u => {
      const _uk = u.entryIdx + '\x01' + (u.jsonPath || '') + '\x01' + (u.location || '');
      if (seenUsageKeys.has(_uk)) return false;
      seenUsageKeys.add(_uk);
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
  // Greedy .*\. ensures we match the LAST array segment in any path depth.
  // $.nextAlerts[0].field → OK (top-level)
  // $.parent.hitList[0].nextAlerts[0].field → m[1]='nextAlerts' (nested)
  const ARRAY_USAGE_RE = /.*\.([^[.\]]+)\[(\d+)\]\.([^[.\]]+)/;

  const selectAllCandidates = candidates.filter(c => c._selectAll && !c._manual);
  const otherCandidates    = candidates.filter(c => !c._selectAll || c._manual);

  const groups    = new Map(); // "reqIdx::arrayKey" → [candidate]
  const ungroupable = [];

  for (const c of selectAllCandidates) {
    if (!c.usages || !c.usages.length) { ungroupable.push(c); continue; }
    const tally = new Map();
    for (const u of c.usages) {
      if (u.location !== 'body_json' || !u.jsonPath) continue;
      const m = u.jsonPath.match(ARRAY_USAGE_RE);
      if (!m) continue;
      const key = u.entryIdx + '::' + m[1];
      tally.set(key, (tally.get(key) || 0) + 1);
    }
    if (tally.size === 0) { ungroupable.push(c); continue; }
    let best = null, bestCount = 0;
    for (const [k, cnt] of tally) { if (cnt > bestCount) { best = k; bestCount = cnt; } }
    if (!groups.has(best)) groups.set(best, []);
    groups.get(best).push(c);
  }

  const result = [...otherCandidates, ...ungroupable];
  const _allEntries = (typeof S !== 'undefined' && S.entries1) || [];

  for (const [groupKey, groupCandidates] of groups) {
    const sep = groupKey.indexOf('::');
    const reqIdx         = parseInt(groupKey.slice(0, sep));
    const targetArrayKey = groupKey.slice(sep + 2);

    // Build column list from grouped SelectAll candidates
    const columns = [];
    for (const c of groupCandidates) {
      if (!c.source || !c.source.jsonPath) continue;
      let targetKey = '';
      for (const u of c.usages) {
        if (!u.jsonPath) continue;
        const m = u.jsonPath.match(ARRAY_USAGE_RE);
        if (m && m[1] === targetArrayKey) { targetKey = m[3]; break; }
      }
      if (!targetKey) {
        targetKey = c.source.jsonPath.replace(/^.*[.[]/g, '').replace(/[\]*]/g, '');
      }
      const rawName = _advSuggestName(c.source.jsonPath, null, '').replace(/Arr$/, '');
      const varName = rawName ? rawName + 's' : (targetArrayKey + '_' + targetKey);
      columns.push({ sourceJsonPath: c.source.jsonPath, varName, targetKey });
    }
    if (columns.length === 0) { result.push(...groupCandidates); continue; }

    const targetEntry     = (_allEntries)[reqIdx];
    const knownTargetKeys = new Set(columns.map(col => col.targetKey));
    const staticFields    = _advInferStaticFields(targetEntry, targetArrayKey, knownTargetKeys);
    const staticFieldKeys = new Set(staticFields.map(f => f.targetKey));
    const allKnownKeys    = new Set([...knownTargetKeys, ...staticFieldKeys]);
    const unresolved      = _advFindUnresolvedFields(targetEntry, targetArrayKey, allKnownKeys);
    for (const k of unresolved) {
      const vn = _advSuggestName('$.' + targetArrayKey + '[*].' + k, null, '').replace(/Arr$/, '') + 's';
      columns.push({ sourceJsonPath: null, varName: vn, targetKey: k, _placeholder: true });
    }

    const anchorVarName = _advBestAnchorVarName(columns, targetEntry, targetArrayKey);
    const first = groupCandidates[0];

    // Item count: use deep-find since the array may be nested in the primary entry
    let itemCountHint = 0;
    if (targetEntry) {
      try {
        const _bObj0 = JSON.parse((targetEntry.body && targetEntry.body.text) || '');
        const _arr0 = _advDeepFindArray(_bObj0, targetArrayKey);
        if (_arr0) itemCountHint = _arr0.length;
      } catch {}
    }

    // -----------------------------------------------------------------------
    // Build anchor value set from the source response — used for:
    //   (a) Value verification when deep-scanning extra entries
    //   (b) Detecting standalone anchor-value occurrences outside the array
    // -----------------------------------------------------------------------
    const _anchorValues = new Set();
    const _anchorCol = columns.find(col => col.varName === anchorVarName && !col._placeholder);
    if (_anchorCol && _anchorCol.sourceJsonPath) {
      const _srcE = _allEntries[first.source.entryIdx];
      const _srcResBody = (_srcE && (
        (_srcE.response && _srcE.response.body && _srcE.response.body.text) || _srcE.resBody
      )) || '';
      if (_srcResBody) {
        try {
          const _srcObj = JSON.parse(_srcResBody);
          // Match values whose path fits the anchor's source path pattern (all [N] → [\d+])
          const _pathRe = new RegExp('^' +
            _anchorCol.sourceJsonPath
              .replace(/\./g, '\\.')
              .replace(/\[\*\]/g, '\\[\\d+\\]')
            + '$');
          _advWalkLeaves(_srcObj, '$', function(v, p) {
            if (_anchorValues.size >= 40 || !v || v.length < ADV_MIN_LEN) return;
            if (_pathRe.test(p)) _anchorValues.add(v);
          }, 0);
        } catch {}
      }
    }

    // -----------------------------------------------------------------------
    // Deep scan: find OTHER requests containing targetArrayKey as an array.
    // Value-verify against _anchorValues to confirm same-source lineage —
    // prevents incorrectly linking req7 (sourced from Response6) to a
    // correlation sourced from Response2.
    // Adds body_array usages for confirmed same-source occurrences.
    // -----------------------------------------------------------------------
    const _extraBodyArrayUsages = [];
    const _seenExtras = new Set([reqIdx]);

    for (let _ei = 0; _ei < _allEntries.length; _ei++) {
      if (_seenExtras.has(_ei)) continue;
      const _e2 = _allEntries[_ei];
      if (!_e2 || _e2.filtered || _e2.isMarker) continue;
      const _bt2 = (_e2.body && _e2.body.text) || '';
      if (!_bt2) continue;
      let _bObj2;
      try { _bObj2 = JSON.parse(_bt2); } catch { continue; }
      if (!_advDeepContainsKey(_bObj2, targetArrayKey)) continue;

      // Value verification: require ≥1 item in the array that matches an anchor value.
      // If _anchorValues is empty (source parse failed) we skip verification and include.
      if (_anchorValues.size > 0 && _anchorCol) {
        const _arr2 = _advDeepFindArray(_bObj2, targetArrayKey);
        let _overlap = false;
        if (_arr2) {
          for (let _ai = 0; _ai < Math.min(_arr2.length, 30); _ai++) {
            const _v2 = _arr2[_ai] && _arr2[_ai][_anchorCol.targetKey];
            if (_v2 && _anchorValues.has(String(_v2))) { _overlap = true; break; }
          }
        }
        if (!_overlap) continue; // different source — belongs to a different correlation
      }

      _seenExtras.add(_ei);
      _extraBodyArrayUsages.push({
        entryIdx: _ei,
        url: _advShortUrl(_e2),
        location: 'body_array',
        jsonPath: targetArrayKey,
      });
    }

    // -----------------------------------------------------------------------
    // Standalone detection: anchor column values appearing OUTSIDE the target
    // array in request bodies. Added as body_json_standalone usages so the
    // codegen replaces them with a random-pick placeholder WITHOUT creating
    // a duplicate extractor.
    //
    // Example: "systemID":"STF..." at top of body (outside nextAlerts array).
    // The extraction is already covered by the array_reconstruct column;
    // only a runtime picker is needed to select one value per iteration.
    // -----------------------------------------------------------------------
    const _standaloneUsages = [];
    if (_anchorValues.size > 0) {
      const _standaloneSeenEntries = new Set();
      for (let _si = 0; _si < _allEntries.length; _si++) {
        const _se = _allEntries[_si];
        if (!_se || _se.filtered || _se.isMarker) continue;
        const _sbt = (_se.body && _se.body.text) || '';
        if (!_sbt) continue;
        // Quick string check before JSON parse
        let _matchedAnchorVal = null;
        for (const _av of _anchorValues) {
          if (_sbt.includes(_av)) { _matchedAnchorVal = _av; break; }
        }
        if (!_matchedAnchorVal) continue;
        let _sObj;
        try { _sObj = JSON.parse(_sbt); } catch { continue; }

        // Walk the body for every anchor value — collect first standalone hit per entry
        for (const _av of _anchorValues) {
          if (!_sbt.includes(_av) || _standaloneSeenEntries.has(_si + '\x01' + _av)) continue;
          let _stPath = null;
          _advWalkLeaves(_sObj, '$', function(v, p) {
            if (_stPath || v !== _av) return;
            // Skip paths inside the target array (at any depth)
            if (p.includes(targetArrayKey + '[')) return;
            _stPath = p;
          }, 0);
          if (_stPath) {
            _standaloneSeenEntries.add(_si + '\x01' + _av);
            if (!_standaloneSeenEntries.has(_si + '\x01__entry')) {
              _standaloneSeenEntries.add(_si + '\x01__entry');
              _standaloneUsages.push({
                entryIdx: _si,
                url: _advShortUrl(_se),
                location: 'body_json_standalone',
                jsonPath: _stPath,
                tokenValue: _av,
                originalValue: _av,
              });
            }
          }
        }
      }
    }

    const detectedCols    = columns.filter(c => !c._placeholder).length;
    const placeholderCols = columns.length - detectedCols;
    const colsLabel = placeholderCols > 0
      ? detectedCols + ' cols + ' + placeholderCols + ' TODO'
      : detectedCols + ' cols';
    const labelCount = itemCountHint > 0 ? itemCountHint + ' items' : 'N items';

    result.push({
      id: first.id,
      value: '(array — ' + colsLabel + ' × ' + labelCount + ')',
      preview: targetArrayKey + '[*]',
      valueType: 'array',
      confidence: 'high',
      varName: targetArrayKey.charAt(0).toLowerCase() + targetArrayKey.slice(1),
      source: first.source,
      usages: [
        { entryIdx: reqIdx, url: targetEntry ? _advShortUrl(targetEntry) : '?', location: 'body_array', jsonPath: targetArrayKey },
        ..._extraBodyArrayUsages,
        ..._standaloneUsages,
      ],
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

  // Phase 2.5 — CSRF / hidden-form-token scan (single-HAR mode)
  // Catches tokens like authenticity_token that are never in Phase 1's responseValueMap
  // because the HTML page that contains them is filtered as a Document-type navigation request.
  const highConfValues = new Set(highConf.map(c => c.value));
  const csrfCandidates = _advCsrfScan(entries, highConfValues);

  // Phase 2.6 — HTML hidden fields sent back by a form post, under any name (BUG-141)
  const hiddenCandidates = _advHiddenFieldScan(entries, new Set([...highConfValues, ...csrfCandidates.map(c => c.value)]));

  // Phase 3 — only for values not already in Phase 2, 2.5 or 2.6
  const allHighValues = new Set([...highConfValues, ...csrfCandidates.map(c => c.value), ...hiddenCandidates.map(c => c.value)]);
  const medConf = _advPatternScan(entries, allHighValues);

  // Phase 3b — UUIDs a request sends in a header or the query string that the scans above do not cover (a page script
  // made them: X-Request-Id, a correlation id); marked browser-made below when no earlier response has them
  const uuidCands = _advUuidScan(entries, new Set([...allHighValues, ...medConf.map(c => c.value)]));

  // Merge: Phase 2 (high) → Phase 2.5 CSRF (high) → Phase 2.6 hidden fields (high) → Phase 3 (medium) → Phase 3b
  let all = [...highConf, ...csrfCandidates, ...hiddenCandidates, ...medConf, ...uuidCands];

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

  // Pre-F2: Remove SelectAll candidates already covered by an existing array_reconstruct
  // correlation (prevents re-running the Advisor from showing already-accepted candidates).
  const _existingArrReconstr = (existingCorrelations || []).filter(
    c => c.extractorType === 'array_reconstruct'
  );
  if (_existingArrReconstr.length > 0) {
    const _coveredPaths = new Set();
    for (const _ar of _existingArrReconstr) {
      for (const _col of ((_ar.extractorConfig && _ar.extractorConfig.columns) || [])) {
        if (_col.sourceJsonPath) _coveredPaths.add(_col.sourceJsonPath);
      }
    }
    all = all.filter(c => {
      if (!c._selectAll || !c.source || !c.source.jsonPath) return true;
      return !_coveredPaths.has(c.source.jsonPath);
    });
  }

  // F2: Detect groups of SelectAll candidates that feed the same target array
  // and promote them to _arrayReconstruct meta-candidates
  all = _advDetectArrayGroups(all);

  // Phase 2.7 — lists in a <select>: placed with the High candidates; a single candidate for one of a list's values from
  // the same page is covered by the list
  const selects = _advSelectScan(entries, existingCorrelations);
  if (selects.length) {
    const covered = new Set();
    selects.forEach(s => s.usages.forEach(u => covered.add(s.source.entryIdx + '\x01' + u.tokenValue)));
    all = all.filter(c => c._selectAll || !c.source || !covered.has(c.source.entryIdx + '\x01' + c.value));
    const firstMed = all.findIndex(c => c.confidence !== 'high');
    all.splice(firstMed === -1 ? all.length : firstMed, 0, ...selects);
  }

  // Made in the browser (BUG-151): no source, and no response before the value is first sent has it (a page's own
  // script made it: a hash, a UUID) — there is nothing to read it from, so it is never added to the script as a read value
  all.forEach(c => { if (_advMadeInBrowser(c, entries)) c._browser = true; });
  // a UUID made in the browser can be generated by the script: it needs every place it is sent, not only the place the
  // scan that found it looks at (a body value also sent in a query string) — the use scan of advisorAddManual
  all.forEach(c => {
    if (!c._browser || !_ADV_UUID_RE.test(c.value)) return;
    const have = new Set(c.usages.map(u => u.entryIdx + '|' + u.location + '|' + (u.jsonPath || '')));
    _advFindUsages(entries, -1, c.value).forEach(u => {
      const k = u.entryIdx + '|' + u.location + '|' + (u.jsonPath || '');
      if (!have.has(k)) { have.add(k); c.usages.push(u); }
    });
    c.usages.sort((a, b) => a.entryIdx - b.entryIdx);
    // named after the field it is sent in (traceId, xRequestId), not after its shape (correlationId)
    const u0 = c.usages[0];
    if (u0 && c.varName === _advSuggestName(null, null, c.value)) {
      c.varName = u0.location === 'header' || u0.location === 'query' || u0.location === 'body_form'
        ? _advSuggestName(null, u0.jsonPath, c.value)
        : _advSuggestName(u0.jsonPath, null, c.value);
    }
  });

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
  const usages = candidate.usages.map(u => Object.assign({
    reqIdx: u.entryIdx,                         // correct S.entries1 index
    location: u.location,                        // 'body_json' | 'body_form' | 'header'
    key: u.jsonPath ? u.jsonPath.split('.').pop().replace(/[\[\]]/g, '') : 'value',
    // a list's use sends one of its values (BUG-150); every other candidate: its own value, as before
    tokenValue: candidate._selectAll && u.tokenValue ? u.tokenValue : candidate.value,
    originalValue: candidate._selectAll && u.tokenValue ? u.tokenValue : candidate.value,
    prefix: '',
  }, candidate._selectAll && u.listIdx ? { listIdx: u.listIdx } : {}));

  // Array reconstruction: short-circuit — all config is already in _arrayConfig.
  // Maps body_array usages (sentinel placement) AND body_json_standalone usages
  // (random-pick replacement for standalone anchor values outside the array).
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
    // Standalone usages: preserve tokenValue so codegen can locate+replace the
    // recorded value with a runtime random-pick placeholder.
    const _standaloneUsages = candidate.usages
      .filter(u => u.location === 'body_json_standalone')
      .map(u => ({
        reqIdx: u.entryIdx,
        location: 'body_json_standalone',
        key: u.jsonPath ? u.jsonPath.split('.').pop().replace(/[\[\]]/g, '') : 'value',
        tokenValue: u.tokenValue || u.originalValue || '',
        originalValue: u.originalValue || u.tokenValue || '',
        prefix: '',
      }));
    return {
      name: candidate.varName,
      sourceIdx: candidate.source ? candidate.source.entryIdx : 0,
      extractorType: 'array_reconstruct',
      extractorConfig: candidate._arrayConfig,
      usages: [..._arrUsages, ..._standaloneUsages],
      _fromAdvisor: true,
    };
  }

  // Made by the script (BUG-151 part 2): a new UUID, set right before the first request that sends this recorded
  // value — so a value the recording renewed is renewed at the same places, and one it kept is kept for the iteration.
  // No extractor, no source. extractorConfig.value = the recorded value (it also keeps same-named ones apart).
  if (candidate._gen && candidate._gen.kind === 'uuid') {
    return { name: candidate.varName, sourceIdx: -1, extractorType: 'uuid', extractorConfig: { value: candidate.value }, usages, _fromAdvisor: true };
  }

  // Determine extractor type and config
  let extractorType, extractorConfig, _fb = null;
  const exact = candidate._explorer || candidate._paste;
  if (candidate._edit && candidate._edit.extractorType) {
    // Chosen in Script Studio's correlation editor (how to read it, and from which response): the user's choice wins
    extractorType = candidate._edit.extractorType;
    extractorConfig = candidate._edit.extractorConfig;
  } else if (candidate._engineCorr) {
    // Found by Studio's own correlation engines (advisorMirrorEngine): their extractor, exactly
    extractorType = candidate._engineCorr.extractorType;
    extractorConfig = candidate._engineCorr.extractorConfig;
  } else if (candidate._manual && exact && exact.extractorType) {
    // Handed over by the HAR Explorer, or built by Paste & Detect: the exact extractor (same types and config as Studio's own)
    extractorType = exact.extractorType;
    extractorConfig = exact.extractorConfig;
  } else if (candidate._manual) {
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
  } else if (candidate._extract && candidate._extract.extractorType) {
    // Found in an HTML / text response (CSRF name scan, hidden-field scan): boundaries read from that page
    extractorType = candidate._extract.extractorType;
    extractorConfig = candidate._extract.extractorConfig;
  } else if (candidate.source && candidate.source.jsonPath) {
    // Auto-detected via HAR response scan: use the JSON path we traced (a list: every match; how it is used is _pick,
    // below — one random picker for every list, the editor's and the Rnd switch)
    extractorType = 'jsonpath';
    extractorConfig = candidate._selectAll
      ? { path: candidate.source.jsonPath, selectAll: true }
      : { path: candidate.source.jsonPath };
  } else if ((_fb = _advBoundaryFromResponses(candidate, usages))) {
    // No known source path: boundaries read from the response that has the value, widened until their first
    // match is the value (BUG-144 — before, the value's own first 8 characters with no right boundary)
    extractorType = _fb.extractorType;
    extractorConfig = _fb.extractorConfig;
  } else {
    // Medium-confidence, no response has the value: boundary fallback (to be reviewed in the editor)
    extractorType = 'boundary';
    extractorConfig = { lb: candidate.value.slice(0, 8), rb: '' };
  }

  // A list (_selectAll) and how each place uses it (Script Studio's editor, the Rnd switch): _pick "random" (one value
  // at random each iteration), "rotate" (the next value each iteration), "nth" (always value _nth); _range = the matches
  // that belong to it (the options of one <select>). None of these: every value as recorded, as before.
  const out = {
    name: candidate.varName,
    sourceIdx: candidate._edit && candidate._edit.extractorType && candidate._edit.sourceIdx != null ? candidate._edit.sourceIdx
      : _fb ? _fb.sourceIdx
      : candidate.source ? candidate.source.entryIdx : (usages[0] ? Math.max(0, usages[0].reqIdx - 1) : 0),
    extractorType,
    extractorConfig,
    usages,
    _fromAdvisor: true,
  };
  const pick = candidate._selectAll ? candidate._pick : null;
  if (pick === 'rotate' || pick === 'nth' || pick === 'random') {
    out.list = { pick };
    if (pick === 'nth') out.list.nth = Math.max(1, parseInt(candidate._nth, 10) || 1);
    if (candidate._range && candidate._range.from) { out.list.from = candidate._range.from; out.list.to = candidate._range.to; }
  }
  // Found by Studio's own engines: their own uses (a Bearer prefix, the header and body forms they found) and their
  // other settings — only the extractor, its response and the name can be changed in the editor. Uses before the
  // response it is read from are dropped (the value does not exist yet there).
  const eng = candidate._engineCorr;
  if (eng) {
    out.usages = (eng.usages || []).filter(u => !(out.sourceIdx >= 0) || u.reqIdx > out.sourceIdx).map(u => Object.assign({}, u));
    Object.keys(eng).forEach(k => { if (!(k in out) && k !== '_suppressed' && k !== '_suppressedBy') out[k] = eng[k]; });
    if (!eng._fromAdvisor) delete out._fromAdvisor;
  }
  return out;
}

// ---------------------------------------------------------------------------
// PUBLIC: the correlations Studio's own engines found (pattern, second recording, value-based, PKCE) listed as
// candidates already in the script — so the Correlate table, the editor, Take out and Undo work for them as for the
// Advisor's own. The script does not change: each candidate points at the engine's correlation (_engineCorr), which
// stays in S.correlations until the user takes it out or saves a change (the editor). Values made while the script
// runs (PKCE) or rebuilt arrays cannot be read from a response: _fixed (Take out only).
// outKeys — advisorEngineKey()s the user took out before this reading: taken out again (listed under Skipped).
// ---------------------------------------------------------------------------
function advisorEngineKey(corr, entries) {
  const e = (entries || S.entries1 || [])[corr.sourceIdx];
  return corr.name + '|' + (e ? (e.method || '') + ' ' + String(e.url || '').split('?')[0] : corr.extractorType);
}
function advisorMirrorEngine(outKeys) {
  const out = new Set(outKeys || []);
  const ents = S.entries1 || [];
  (S.correlations || []).slice().forEach(corr => {
    if (!corr || corr._suppressed || corr._fromAdvisor) return;
    if ((S.advisorCandidates || []).some(c => c._engineCorr === corr)) return;
    const u0 = (corr.usages || [])[0] || {};
    const value = String(u0.tokenValue || u0.originalValue || '');
    const src = corr.sourceIdx >= 0 ? ents[corr.sourceIdx] : null;
    const cand = {
      id: 'adv-' + S.advisorCandidates.length,
      value: value || '(made while the script runs)',
      preview: value.length > 40 ? value.slice(0, 40) + '…' : value,
      valueType: 'token',
      confidence: 'high',
      varName: corr.name,
      source: { entryIdx: corr.sourceIdx, url: src ? _advShortUrl(src) : '', jsonPath: corr.extractorType === 'jsonpath' && corr.extractorConfig ? corr.extractorConfig.path || null : null },
      usages: (corr.usages || []).map(u => ({ entryIdx: u.reqIdx, url: ents[u.reqIdx] ? _advShortUrl(ents[u.reqIdx]) : '', location: u.location, jsonPath: u.key, tokenValue: u.tokenValue })),
      status: 'accepted',
      _applied: true,
      _engineCorr: corr,
      _engineKey: advisorEngineKey(corr, ents),
      _fixed: !src || corr.extractorType === 'pkce' || corr.extractorType === 'array_reconstruct',
    };
    S.advisorCandidates.push(cand);
    if (out.has(cand._engineKey)) {
      const i = S.correlations.indexOf(corr);
      if (i >= 0) S.correlations.splice(i, 1);
      cand._outAt = i; cand._applied = false; cand.status = 'skipped';
    }
  });
}
// A candidate found by Studio's engines and not changed by the user: its own correlation is still in the script
function advisorEngineUntouched(c) {
  return !!(c && c._engineCorr && (S.correlations || []).indexOf(c._engineCorr) >= 0);
}

// ---------------------------------------------------------------------------
// A name a user typed, made safe as a parameter name: VuGen {name} and DevWeb load.global.name take letters, digits
// and _ only ("visitor-hmac" → "visitor_hmac"); a leading digit gets "v_". Empty or only spaces → "".
// ---------------------------------------------------------------------------
function _advSafeVarName(name) {
  const s = String(name == null ? '' : name).trim();
  if (!s) return '';
  const safe = s.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[0-9]/.test(safe) ? 'v_' + safe : safe;
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
// ---------------------------------------------------------------------------
// Every later request that sends `actualValue` back (after entries[sourceEntryIdx]): JSON body leaves, form fields,
// query values, request headers (with or without "Bearer "), address path segments. Values under 4 characters: none.
// Used by advisorAddManual and advisorSuggestMore.
// ---------------------------------------------------------------------------
function _advFindUsages(entries, sourceEntryIdx, actualValue) {
  const autoUsages = [];
  if (actualValue && actualValue.length >= 4) {
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

  return autoUsages;
}

// ---------------------------------------------------------------------------
// PUBLIC: "Also suggest other repeated values" (Script Studio, step 2). The scan above keeps values of 10 characters
// or more, leaves short numbers out and shows 20 at most; this adds the other values a JSON response sends that a
// later request sends back — 4 characters or more, numbers too — as Medium suggestions, not ticked (_more). Values
// already suggested or in the script, the values in skipValues (the page passes the test data values) and common
// words are left out.
// Returns the number added.
// ---------------------------------------------------------------------------
function advisorSuggestMore(skipValues) {
  const entries = S.entries1 || [];
  const known = new Set((S.advisorCandidates || []).map(c => c.value));
  (skipValues || []).forEach(v => { if (v != null) known.add(String(v)); });
  const seen = new Set();
  const added = [];
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.filtered || e.isMarker || !e.respBody) continue;
    const obj = _advParseJson(e.respBody);
    if (!obj) continue;
    _advWalkLeaves(obj, '$', (val, path) => {
      if (val.length < 4 || val.length > 2000 || seen.has(val) || known.has(val)) return;
      seen.add(val);
      if (ADV_SKIP_VALUES.has(val.toLowerCase()) || /\s/.test(val) || /^\d{1,3}$/.test(val)) return;
      if (_advAlreadyCorrelated(val, S.correlations)) return;
      const usages = _advFindUsages(entries, i, val);
      if (!usages.length) return;
      added.push({
        id: 'adv-' + ((S.advisorCandidates || []).length + added.length),
        value: val,
        preview: val.length > 40 ? val.slice(0, 40) + '…' : val,
        valueType: _advValueType(val),
        confidence: 'medium',
        varName: _advSuggestName(path, null, val),
        source: { entryIdx: i, url: _advShortUrl(e), jsonPath: path },
        usages,
        status: 'pending',
        _more: true,
      });
    }, 0);
  }
  S.advisorCandidates = (S.advisorCandidates || []).concat(added);
  return added.length;
}

// ---------------------------------------------------------------------------
// PUBLIC: a list made in Script Studio's editor — a JSON path or boundaries that read every match.
// values = what the extractor reads from the response, in order (every match); opts.from / opts.to = the matches that
// belong to the list (1-based, e.g. the options of one <select> among others; default all); opts.pick = "random" |
// "rotate" | "nth" (opts.nth), default every value as recorded. Each later request that sends one of the values back
// is a use with that value and its place (tokenValue, listIdx — as for a list the Correlation Advisor merges, BUG-150).
// The candidate is ticked (as advisorAddManual's); the caller puts it in the script (advisorApplyOne).
// ---------------------------------------------------------------------------
function advisorAddList(sourceEntryIdx, ext, varName, values, opts) {
  opts = opts || {};
  const all = (values || []).map(String);
  const from = Math.max(1, opts.from || 1), to = Math.min(all.length, opts.to || all.length);
  const usages = [], seen = new Set();
  for (let pos = from; pos <= to; pos++) {
    const v = all[pos - 1];
    if (!v || seen.has(v)) continue;
    seen.add(v);
    _advFindUsages(S.entries1 || [], sourceEntryIdx, v).forEach(u => usages.push(Object.assign(u, { tokenValue: v, listIdx: pos })));
  }
  const cfg = ext.extractorConfig || {};
  const c = advisorAddManual(sourceEntryIdx, ext.extractorType === 'jsonpath' ? 'jsonpath' : 'boundary', cfg.path || cfg.lb || '', varName, all[from - 1] || '');
  const n = Math.max(0, to - from + 1);
  c.usages = usages;
  c.value = '(list — ' + n + ' values)';
  c.preview = all.slice(from - 1, Math.min(to, from + 2)).join(', ') + (n > 3 ? ', …' : '');
  c.valueType = 'list';
  c._selectAll = true;
  c._edit = { extractorType: ext.extractorType, extractorConfig: cfg, sourceIdx: sourceEntryIdx };
  if (opts.pick === 'random' || opts.pick === 'rotate' || opts.pick === 'nth') c._pick = opts.pick;
  if (opts.pick === 'nth') c._nth = Math.max(1, parseInt(opts.nth, 10) || 1);
  if (from > 1 || to < all.length) c._range = { from, to };
  return c;
}

function advisorAddManual(sourceEntryIdx, extractType, extractValue, varName, actualValue) {
  const entry = (S.entries1 || [])[sourceEntryIdx];
  const id = 'adv-' + (S.advisorCandidates.length);

  // Auto-scan all SUBSEQUENT requests for the extracted value so the codegen
  // can substitute it everywhere (queryString, body, headers).
  const autoUsages = _advFindUsages(S.entries1 || [], sourceEntryIdx, actualValue);

  const candidate = {
    id,
    value: actualValue || '(manual)',
    preview: actualValue ? (actualValue.length > 40 ? actualValue.slice(0, 40) + '…' : actualValue) : extractValue,
    valueType: 'token',
    confidence: 'high',
    varName: _advSafeVarName(varName) || _advSuggestName(extractType === 'jsonpath' ? extractValue : null, extractType === 'header' ? extractValue : null, actualValue || ''),
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

// ---------------------------------------------------------------------------
// Boundaries that capture the right value. A boundary extractor (VuGen web_reg_save_param, DevWeb BoundaryExtractor)
// takes the FIRST text between the left and the right boundary, so `content="` … `"` on a page with several meta tags
// captures the first one, not the value. Shared by Paste & Detect (studio-ui.js) and the HAR Explorer's worker.
// ---------------------------------------------------------------------------
// The value between the first `lb` and the next `rb` — what a boundary extractor (first match, Ord=1) captures
function _advFirstMatch(text, lb, rb) {
  var a = text.indexOf(lb); if (a < 0) return null;
  a += lb.length; var b = rb ? text.indexOf(rb, a) : -1;
  return b < 0 ? null : text.slice(a, b);
}
// Boundaries around the value at `at` that capture exactly it as the FIRST match: start from `lb0`, or the text just
// before the value, and widen to the left (same line) until the first match is the value itself
// A value no response has before it is first sent (BUG-151): no source, and neither the body nor a header of an earlier
// response holds it, as written or URL-encoded. A left-out response counts (the server sent it: putting that request
// back makes it readable), markers do not. Lists and rebuilt arrays are never browser-made (they are read from a response).
function _advMadeInBrowser(c, entries) {
  if (!c || c.source || c._selectAll || c._arrayReconstruct || c._manual || typeof c.value !== 'string' || !c.value) return false;
  const first = (c.usages || []).reduce((m, u) => (u.entryIdx != null && u.entryIdx < m ? u.entryIdx : m), (entries || []).length);
  const forms = [c.value];
  try { const enc = encodeURIComponent(c.value); if (enc !== c.value) forms.push(enc); } catch (e) { /* as written only */ }
  for (let i = 0; i < first && i < entries.length; i++) {
    const e = entries[i];
    if (!e || e.isMarker) continue;
    const hdrs = e.respHdrsMap ? Object.keys(e.respHdrsMap).map(k => e.respHdrsMap[k]).join('\n') : '';
    const text = (e.respBody || '') + '\n' + hdrs;
    if (forms.some(f => text.indexOf(f) >= 0)) return false;
  }
  return true;
}

// A value with no known source path (BUG-144): the response that has it — the card's own source first, else the nearest
// response before its first use (filtered and marker entries skipped) — and boundaries read from that page, widened
// until their first match is the value. → { extractorType, extractorConfig, sourceIdx } or null (no response has it)
function _advBoundaryFromResponses(candidate, usages) {
  const all = (typeof S !== 'undefined' && S.entries1) || [];
  const value = candidate && candidate.value;
  if (!value || typeof value !== 'string' || !all.length) return null;
  const text = (e) => (e && (e.respBody || (e.response && e.response.body && e.response.body.text) || e.resBody)) || '';
  const tryAt = (i) => {
    const e = all[i];
    if (!e || e.isMarker) return null;
    const x = _advHtmlValueExtractor(text(e), value);
    return x ? { extractorType: x.extractorType, extractorConfig: x.extractorConfig, sourceIdx: i } : null;
  };
  if (candidate.source && candidate.source.entryIdx != null) {
    const own = tryAt(candidate.source.entryIdx);
    if (own) return own;
  }
  const firstUse = (usages || []).reduce((m, u) => (u.reqIdx != null && u.reqIdx < m ? u.reqIdx : m), all.length);
  for (let i = Math.min(firstUse, all.length) - 1; i >= 0; i--) {
    if (all[i] && all[i].filtered) continue;
    const r = tryAt(i);
    if (r) return r;
  }
  return null;
}

function _advSafeBoundaries(text, at, s, lb0, rb0) {
  var after = text.slice(at + s.length, at + s.length + 12);
  var rb = rb0 || ((/^["'&;,<\s}\])]/.exec(after) || [after.charAt(0)])[0] || "");
  if (!rb) return null;
  var lineStart = text.lastIndexOf("\n", at - 1) + 1;
  var minLen = lb0 && text.slice(at - lb0.length, at) === lb0 ? lb0.length : Math.min(6, at - lineStart);
  for (var len = Math.max(1, minLen); at - len >= Math.max(0, lineStart - 0) && len <= 120; len++) {
    var lb = text.slice(at - len, at);
    if (_advFirstMatch(text, lb, rb) === s) return { lb: lb, rb: rb };
  }
  return null;
}

// URL query-string value decoder (+ → space, %XX → char)
function _advQsDecode(s) {
  try { return decodeURIComponent((s || '').replace(/\+/g, ' ')); } catch { return s || ''; }
}
