// VuGen Script Studio — HAR Processing + Correlation Engine
// Extracted from VuGen-Script-Studio.html — Phase 3b
// Dependencies: VuGen-Script-Studio-constants.js (S, STATIC_CT, STATIC_EXT, NOISY, SKIP_HDRS, DYNAMIC_PATTERNS,
//               SESSION_COOKIE_NAMES, CSRF_HEADER_NAMES, CSRF_HEADER_PATTERN, AUTH_HEADER_NAMES)

// ═══════════════════════════════════════════════════════════════════════════
// HAR PROCESSING
// ═══════════════════════════════════════════════════════════════════════════
function parseHar(har) {
  const raw = (har.log && har.log.entries) || [];
  let id = 0;
  return raw.map((e) => {
    const hdrsMap = {};
    (e.request.headers || []).forEach((h) => {
      hdrsMap[h.name.toLowerCase()] = h.value;
    });
    const respHdrsMap = {};
    (e.response.headers || []).forEach((h) => {
      respHdrsMap[h.name.toLowerCase()] = h.value;
    });
    const ct = ((e.response.content && e.response.content.mimeType) || "")
      .split(";")[0]
      .trim();
    const respBody =
      (e.response.content && e.response.content.text) || "";
    return {
      id: ++id,
      url: e.request.url || "",
      method: (e.request.method || "GET").toUpperCase(),
      status: e.response.status || 0,
      ct,
      reqHdrs: e.request.headers || [],
      hdrsMap,
      body: e.request.postData || null,
      respCt: ct,
      respBody,
      respHdrsMap,
      respCookies: e.response.cookies || [],
      filtered: false,
      isMarker: false,
      markerType: null,
      txnName: null,
      txn: null,
    };
  });
}

// ─── NetLog detection & parsing ────────────────────────────────────────────
// chrome://net-export/ produces JSON with top-level "constants" + flat "events" array.
function isNetLog(obj) {
  // chrome://net-export/ always has top-level "constants" and "events" array
  // logEventTypes may be absent in newer Chrome versions — check constants alone
  return !!(
    obj &&
    obj.constants &&
    Array.isArray(obj.events) &&
    !obj.log
  );
}

function parseNetLogHeaderBlock(raw) {
  if (!raw) return [];
  const lines = raw.split(/\r?\n/);
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    // skip status/request line
    const colon = lines[i].indexOf(":");
    if (colon < 1) continue;
    out.push({
      name: lines[i].slice(0, colon).trim(),
      value: lines[i].slice(colon + 1).trim(),
    });
  }
  return out;
}

// Returns entries in Studio shape (same as parseHar), with respBody='' and _fromNetLog=true.
// Response bodies are unavailable in NetLog — correlation engine will use pattern mode only.
function parseNetLog(netlog) {
  const evTypes = netlog.constants.logEventTypes || {}; // name → number
  const evNames = {};
  for (const [name, num] of Object.entries(evTypes)) evNames[num] = name;
  // Handle both old format (ev.type=number) and new Chrome format (ev.type=string)
  const getEvName = (ev) =>
    typeof ev.type === "string" ? ev.type : evNames[ev.type] || "";

  const sources = {};
  for (const ev of netlog.events) {
    if (ev.source == null) continue;
    const sid = ev.source.id;
    if (sid == null) continue;
    if (!sources[sid]) sources[sid] = { type: ev.source.type, evs: [] };
    sources[sid].evs.push(ev);
  }

  const tickOffset = parseInt(
    netlog.constants.timeTickOffset || netlog.constants.tickOffset || 0,
  );
  const entries = [];

  for (const src of Object.values(sources)) {
    // Identify URL_REQUEST sources by the presence of URL_REQUEST_START_JOB —
    // more robust than checking source.type numbers which change across Chrome versions
    if (!src.evs.some((ev) => getEvName(ev) === "URL_REQUEST_START_JOB"))
      continue;

    let url = "",
      method = "GET",
      reqHdrsRaw = "",
      respHdrsRaw = "",
      startTime = 0;

    for (const ev of src.evs) {
      const name = getEvName(ev);
      const params = ev.params || {};

      if (name === "URL_REQUEST_START_JOB") {
        url = params.url || "";
        method = (params.method || "GET").toUpperCase();
        startTime = tickOffset + parseInt(ev.time || 0);
      }
      if (
        name.includes("SEND_REQUEST_HEADERS") ||
        name === "HTTP_TRANSACTION_SEND_REQUEST"
      ) {
        if (params.headers) {
          reqHdrsRaw = Array.isArray(params.headers)
            ? "_ARRAY_\r\n" + params.headers.join("\r\n")
            : params.headers;
        }
      }
      if (
        name.includes("READ_RESPONSE_HEADERS") ||
        name === "HTTP_TRANSACTION_READ_RESPONSE"
      ) {
        if (params.headers) {
          respHdrsRaw = Array.isArray(params.headers)
            ? "_ARRAY_\r\n" + params.headers.join("\r\n")
            : params.headers;
        }
      }
    }

    if (!url) continue;

    // Parse request headers
    let reqHdrs = [];
    if (reqHdrsRaw.startsWith("_ARRAY_\r\n")) {
      for (const line of reqHdrsRaw.slice(9).split("\r\n")) {
        const c = line.indexOf(":");
        if (c < 1) continue;
        reqHdrs.push({
          name: line.slice(0, c).trim(),
          value: line.slice(c + 1).trim(),
        });
      }
    } else {
      reqHdrs = parseNetLogHeaderBlock(reqHdrsRaw);
    }

    const hdrsMap = {};
    for (const h of reqHdrs) hdrsMap[h.name.toLowerCase()] = h.value;

    // Parse response headers
    let status = 0,
      ct = "";
    const respHdrsMap = {};
    let respHdrsList = [];
    if (respHdrsRaw.startsWith("_ARRAY_\r\n")) {
      const lines = respHdrsRaw.slice(9).split("\r\n");
      const sm = (lines[0] || "").match(/\s(\d{3})\s/);
      if (sm) status = parseInt(sm[1]);
      for (let i = 1; i < lines.length; i++) {
        const c = lines[i].indexOf(":");
        if (c < 1) continue;
        respHdrsList.push({
          name: lines[i].slice(0, c).trim(),
          value: lines[i].slice(c + 1).trim(),
        });
      }
    } else if (respHdrsRaw) {
      const sm = respHdrsRaw.match(/\s(\d{3})\s/);
      if (sm) status = parseInt(sm[1]);
      respHdrsList = parseNetLogHeaderBlock(respHdrsRaw);
    }
    for (const h of respHdrsList) {
      const k = h.name.toLowerCase();
      respHdrsMap[k] = h.value;
      if (k === "content-type") ct = h.value.split(";")[0].trim();
    }

    entries.push({
      id: 0,
      _startTime: startTime,
      url,
      method,
      status,
      ct,
      reqHdrs,
      hdrsMap,
      body: null, // POST bodies not available in NetLog
      respCt: ct,
      respBody: "", // response bodies not available in NetLog
      respHdrsMap,
      respCookies: [], // Set-Cookie requires body parsing not supported here
      filtered: false,
      isMarker: false,
      markerType: null,
      txnName: null,
      txn: null,
      _fromNetLog: true,
    });
  }

  entries.sort((a, b) => a._startTime - b._startTime);
  entries.forEach((e, i) => {
    e.id = i + 1;
    delete e._startTime;
  });
  return entries;
}

function applyFilters(entries) {
  for (const e of entries) {
    if (e.isMarker) {
      e.filtered = false;
      continue;
    } // always keep transaction markers
    // Filter CSP violation reports — browser auto-sends these when our bookmarklet
    // .invalid marker URLs are blocked by the app's Content Security Policy
    const reqCt = (e.hdrsMap["content-type"] || "")
      .split(";")[0]
      .trim()
      .toLowerCase();
    if (
      reqCt === "application/csp-report" ||
      reqCt === "application/reports+json"
    ) {
      e.filtered = true;
      continue;
    }
    if (e.body && e.body.text && e.body.text.includes('"blocked-uri"')) {
      e.filtered = true;
      continue;
    }
    // Filter WebSocket upgrade requests — wss:// and ws:// cannot be replayed by VuGen
    // Web HTTP/HTML protocol; including them causes 400 Bad Request errors
    if (/^wss?:\/\//i.test(e.url)) {
      e.filtered = true;
      continue;
    }
    const ct = e.ct;
    if (e.method === "OPTIONS") {
      e.filtered = true;
      continue;
    }
    if (STATIC_CT.has(ct)) {
      e.filtered = true;
      continue;
    }
    if (STATIC_EXT.test(e.url.split("?")[0])) {
      e.filtered = true;
      continue;
    }
    try {
      if (NOISY.test(new URL(e.url).hostname)) {
        e.filtered = true;
        continue;
      }
    } catch {}
    e.filtered = false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSACTION MARKER DETECTION
// ═══════════════════════════════════════════════════════════════════════════
function detectMarkers(entries) {
  S.txns = [];
  const seenNames = {};

  for (const e of entries) {
    const url = e.url;
    const sm =
      url.match(/\/\/START[-_]([^/.\s?]+)\.invalid/i) ||
      url.match(/\/\/([^/.\s?]+)[-_]START\.invalid/i);
    const em =
      url.match(/\/\/END[-_]([^/.\s?]+)\.invalid/i) ||
      url.match(/\/\/([^/.\s?]+)[-_]END\.invalid/i);

    if (sm) {
      const name = sm[1].replace(/[-]/g, "_");
      e.isMarker = true;
      e.markerType = "start";
      e.txnName = name;
      if (!seenNames[name]) {
        seenNames[name] = true;
        S.txns.push({ name });
      }
    } else if (em) {
      const name = em[1].replace(/[-]/g, "_");
      e.isMarker = true;
      e.markerType = "end";
      e.txnName = name;
    }
  }

  // Assign txn membership to requests between markers
  let active = null;
  for (const e of entries) {
    if (e.isMarker) {
      active = e.markerType === "start" ? e.txnName : null;
    } else {
      e.txn = active;
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// URL NORMALIZATION
// ═══════════════════════════════════════════════════════════════════════════
function extractUrlPathParams(url) {
  // Extract ;key=value matrix parameters from URL path (e.g. ;jsessionid=xxx)
  try {
    const path = new URL(url).pathname;
    const params = {};
    const parts = path.split(";");
    for (let i = 1; i < parts.length; i++) {
      const eq = parts[i].indexOf("=");
      if (eq > 0) {
        const k = decodeURIComponent(parts[i].substring(0, eq));
        const v = decodeURIComponent(parts[i].substring(eq + 1));
        if (k && v) params[k] = v;
      }
    }
    return params;
  } catch {
    return {};
  }
}

function normalizeUrlKey(url) {
  try {
    const p = new URL(url);
    const normSegs = p.pathname
      .replace(/;[^/?#]*/g, "")
      .split("/")
      .map((seg) => {
        if (!seg) return seg;
        const d = decodeURIComponent(seg);
        // UUID
        if (
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            d,
          )
        )
          return "{uuid}";
        // Hex IDs (exact length checks — avoids matching short hex words)
        if (/^[0-9a-f]{64}$/i.test(d)) return "{hex64}";
        if (/^[0-9a-f]{32}$/i.test(d)) return "{hex32}";
        if (/^[0-9a-f]{16}$/i.test(d)) return "{hex16}";
        // JWT in path (rare but possible)
        if (
          /^eyJ[A-Za-z0-9+/=_-]{6,}\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$/.test(
            d,
          )
        )
          return "{jwt}";
        // Pure numeric IDs (4+ digits)
        if (/^\d{4,}$/.test(d)) return "{num}";
        // Long opaque tokens (32+ chars, only safe chars — e.g. Base64URL, API keys in paths)
        if (d.length >= 32 && /^[A-Za-z0-9+/=_.\-]+$/.test(d))
          return "{token}";
        // Mid-length IDs with separator chars (AWS/GCP style: i-0a1b, inst_abc123, req-xyz456)
        // OR mixed alpha+digit ≥20 chars. Must have no dots (dots = version strings, not IDs).
        if (/^[A-Za-z0-9_\-]+$/.test(d) && d.length >= 10) {
          const hasAlpha = /[A-Za-z]/.test(d),
            hasDigit = /[0-9]/.test(d),
            hasSep = /[_\-]/.test(d);
          const digitRatio = (d.match(/[0-9]/g) || []).length / d.length;
          // Token if: mixed chars with 25%+ digit ratio, OR 20+ chars mixed — avoids pure words
          if (
            hasAlpha &&
            hasDigit &&
            (digitRatio >= 0.25 || d.length >= 20)
          )
            return "{token}";
          // Separator-based IDs (e.g. inst_abc123, req-xyz456) — sep AND both alpha+digit
          if (hasSep && hasAlpha && hasDigit) return "{token}";
        }
        return seg;
      });
    return p.hostname + normSegs.join("/");
  } catch {
    return url.split("?")[0];
  }
}

// Parse Cookie request header into {name: value} map
function parseCookieHdr(hdr) {
  const m = {};
  hdr.split(";").forEach((part) => {
    const eq = part.indexOf("=");
    if (eq > 0) {
      m[part.substring(0, eq).trim()] = part.substring(eq + 1).trim();
    }
  });
  return m;
}

// Extract dynamic path segments that differ between two matching URLs
// Returns [{segIdx, v1, v2, hint}] for segments where both values pass isDynamic()
function extractDynamicPathSegments(url1, url2) {
  const result = [];
  try {
    const segs1 = new URL(url1).pathname
      .replace(/;[^/?#]*/g, "")
      .split("/")
      .filter(Boolean);
    const segs2 = new URL(url2).pathname
      .replace(/;[^/?#]*/g, "")
      .split("/")
      .filter(Boolean);
    for (let i = 0; i < Math.min(segs1.length, segs2.length); i++) {
      const s1 = decodeURIComponent(segs1[i]);
      const s2 = decodeURIComponent(segs2[i]);
      if (s1 === s2 || !isDynamic(s1) || !isDynamic(s2)) continue;
      // Derive hint from the preceding segment name (singularize simple plurals)
      const prev = (segs1[i - 1] || "item")
        .toLowerCase()
        .replace(/ies$/, "y")
        .replace(/s$/, ""); // orders→order, categories→category
      const base = prev.replace(/[^a-zA-Z0-9]/g, "") + "Id";
      result.push({
        segIdx: i,
        v1: s1,
        v2: s2,
        hint: base.charAt(0).toUpperCase() + base.slice(1),
      });
    }
  } catch {}
  return result;
}

// Diff XML bodies — extract leaf <tag>value</tag> pairs and find changed values
function xmlDiffFlat(b1str, b2str) {
  const diffs = [];
  try {
    const extractTags = (s) => {
      const m = {};
      const re = /<([A-Za-z_][A-Za-z0-9_:-]*)>([^<]{1,500})<\/\1>/g;
      let mt;
      while ((mt = re.exec(s)) !== null) m[mt[1]] = mt[2].trim();
      return m;
    };
    const m1 = extractTags(b1str),
      m2 = extractTags(b2str);
    for (const [k, v1] of Object.entries(m1)) {
      const v2 = m2[k];
      if (v2 && v1 !== v2) diffs.push({ path: k, v1, v2 });
    }
  } catch {}
  return diffs;
}

// ═══════════════════════════════════════════════════════════════════════════
// JSON UTILITIES
// ═══════════════════════════════════════════════════════════════════════════
function findJsonPath(jsonStr, value) {
  try {
    const obj = JSON.parse(jsonStr);
    return searchObj(obj, String(value), "$");
  } catch {
    return null;
  }
}
function searchObj(obj, value, path) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj === "string" && obj === value) return path;
  if (
    (typeof obj === "number" || typeof obj === "boolean") &&
    String(obj) === value
  )
    return path;
  if (Array.isArray(obj)) {
    for (let i = 0; i < Math.min(obj.length, 50); i++) {
      const f = searchObj(obj[i], value, `${path}[${i}]`);
      if (f) return f;
    }
  } else if (typeof obj === "object") {
    for (const [k, v] of Object.entries(obj)) {
      const f = searchObj(v, value, `${path}.${k}`);
      if (f) return f;
    }
  }
  return null;
}

function jsonDiffFlat(b1str, b2str) {
  // Returns [{path, v1, v2}] for leaf values that changed
  const diffs = [];
  try {
    const o1 = JSON.parse(b1str),
      o2 = JSON.parse(b2str);
    diffObjects(o1, o2, "$", diffs);
  } catch {}
  return diffs;
}
function diffObjects(o1, o2, path, out) {
  if (o1 === null && o2 === null) return;
  if (typeof o1 !== typeof o2) return;
  if (typeof o1 !== "object") {
    if (String(o1) !== String(o2))
      out.push({ path, v1: String(o1), v2: String(o2) });
    return;
  }
  if (Array.isArray(o1) && Array.isArray(o2)) {
    const len = Math.min(o1.length, o2.length, 20);
    for (let i = 0; i < len; i++)
      diffObjects(o1[i], o2[i], `${path}[${i}]`, out);
  } else if (!Array.isArray(o1)) {
    for (const k of Object.keys(o1)) {
      if (k in o2) diffObjects(o1[k], o2[k], `${path}.${k}`, out);
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CORRELATION HELPERS
// ═══════════════════════════════════════════════════════════════════════════
function isDynamic(value) {
  if (!value || value.length < 8) return false;
  const v = String(value);
  return (
    DYNAMIC_PATTERNS.jwt.test(v) ||
    DYNAMIC_PATTERNS.uuid.test(v) ||
    DYNAMIC_PATTERNS.hex64.test(v) ||
    DYNAMIC_PATTERNS.hex32.test(v) ||
    DYNAMIC_PATTERNS.hex16.test(v) ||
    (v.length >= 20 && DYNAMIC_PATTERNS.longToken.test(v)) ||
    DYNAMIC_PATTERNS.midToken.test(v) ||
    DYNAMIC_PATTERNS.numericId.test(v) ||
    DYNAMIC_PATTERNS.compound.test(v)
  );
}

function genParamName(hint, counter) {
  let base = (hint || "DynParam")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!base || /^\d/.test(base)) base = "Param_" + base;
  base = base.charAt(0).toUpperCase() + base.slice(1);
  const n = (counter[base] || 0) + 1;
  counter[base] = n;
  return n > 1 ? base + "_" + n : base;
}
// Sanitize a raw hint (may contain HTTP header hyphens etc.) into a valid VuGen/C identifier
function sanitizeCandHint(hint) {
  let s = (hint || "DynParam")
    .replace(/[^a-zA-Z0-9]/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  if (!s || /^\d/.test(s)) s = "Param_" + s;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Find value in a single response entry → returns {type, config} or null
function findValueInResponse(value, entry) {
  if (!value || value.length < 4) return null;
  const v = String(value);

  // 1. Cookies (highest specificity)
  for (const ck of entry.respCookies || []) {
    if (ck.value === v)
      return { type: "cookie", config: { cookieName: ck.name } };
  }
  const setCk = entry.respHdrsMap["set-cookie"] || "";
  if (setCk && setCk.includes(v)) {
    const m = setCk.match(/^([^=;,\s]+)=/);
    if (m) return { type: "cookie", config: { cookieName: m[1].trim() } };
  }

  // 1b. 3xx redirect — Location header with dynamic URL path segment or query param
  // Must be before the generic header search (section 2) which would extract the full URL incorrectly.
  // Handles: OAuth2 state/code, OIDC session tokens, PingFederate AS session IDs, etc.
  if (entry.status >= 300 && entry.status < 400) {
    const loc = (entry.respHdrsMap || {})["location"] || "";
    if (loc && loc.includes(v)) {
      const vidx = loc.indexOf(v);
      const pre = loc.substring(0, vidx);
      const post = loc.substring(vidx + v.length);
      // Distinguish: query param (last = after last /) vs path segment
      const lastEq = pre.lastIndexOf("=");
      const lastSlash = pre.lastIndexOf("/");
      let lb, rb;
      if (lastEq > lastSlash) {
        // Query param: "...?paramName=VALUE&..." → LB="paramName=", RB="&" or "\r\n"
        const sepIdx = Math.max(
          pre.lastIndexOf("&"),
          pre.lastIndexOf("?"),
        );
        lb = pre.substring(sepIdx + 1); // e.g. "state=" or "code="
        rb = post.startsWith("&") ? "&" : "\r\n";
      } else {
        // Path segment: ".../segment/VALUE/next/..." → LB="/segment/", RB="/"
        const prevSlash = pre.lastIndexOf("/", pre.length - 1); // the slash just before VALUE
        const prevPrev = pre.lastIndexOf("/", prevSlash - 1); // the slash before that
        lb = pre.substring(prevPrev >= 0 ? prevPrev : prevSlash); // e.g. "/as/" or "/"
        rb = post.startsWith("/")
          ? "/"
          : post.startsWith("?")
            ? "?"
            : "\r\n";
      }
      return { type: "boundary_header", config: { lb, rb } };
    }
  }

  // 2. Response headers (non-cookie, non-redirect-Location)
  for (const [k, hv] of Object.entries(entry.respHdrsMap)) {
    if (k === "set-cookie") continue;
    if (k === "location" && entry.status >= 300 && entry.status < 400)
      continue; // handled above
    if (hv === v) {
      // Exact match → extract the full header value
      return {
        type: "boundary_header",
        config: { lb: k + ": ", rb: "\r\n" },
      };
    }
    if (hv.includes(v)) {
      // Partial match → tight boundaries around the value within the header string
      const hidx = hv.indexOf(v);
      const hpre = hv.substring(0, hidx);
      const hpost = hv.substring(hidx + v.length);
      // LB: header-name + ': ' + up to 20 chars of value-prefix
      const lb = (k + ": " + hpre).slice(-30);
      // RB: first separator after value (or up to 15 chars)
      const rbM = hpost.match(/^([;,\s"'\r\n])/);
      const rb = rbM
        ? rbM[1]
        : hpost.substring(0, Math.min(hpost.length, 10)) || "\r\n";
      return { type: "boundary_header", config: { lb, rb } };
    }
  }

  // 3. Response body
  if (entry.respBody && entry.respBody.includes(v)) {
    const ct = entry.respCt || "";

    // JSON
    if (ct.includes("json") || ct.includes("javascript")) {
      const jp = findJsonPath(entry.respBody, v);
      if (jp) return { type: "jsonpath", config: { path: jp } };
      // Fallback boundary in JSON
      const idx = entry.respBody.indexOf(v);
      const before = entry.respBody.substring(Math.max(0, idx - 20), idx);
      const after = entry.respBody.substring(
        idx + v.length,
        idx + v.length + 3,
      );
      return {
        type: "boundary",
        config: { lb: before.slice(-10), rb: after || '"' },
      };
    }

    // XML — find surrounding <tag>…</tag> for the value
    if (ct.includes("xml")) {
      // Try to find an enclosing tag (simple single-level match)
      const reXmlTag = new RegExp(
        `<([A-Za-z_][A-Za-z0-9_:-]*)(?:\\s[^>]*)?>\\s*${escapeRegex(v)}\\s*</\\1>`,
        "i",
      );
      const mXml = entry.respBody.match(reXmlTag);
      if (mXml) {
        const tag = mXml[1];
        return {
          type: "boundary",
          config: { lb: `<${tag}>`, rb: `</${tag}>` },
        };
      }
    }

    // HTML — check for hidden input
    if (ct.includes("html")) {
      const reHidden = new RegExp(
        `<input[^>]+(?:name|id)=["']([^"']+)["'][^>]+value=["']${escapeRegex(v)}["']` +
          `|<input[^>]+value=["']${escapeRegex(v)}["'][^>]+(?:name|id)=["']([^"']+)["']`,
        "i",
      );
      const m = entry.respBody.match(reHidden);
      if (m) {
        const fn = m[1] || m[2];
        if (fn)
          return {
            type: "html",
            config: { selector: `input[name='${fn}']`, attr: "value" },
          };
      }
      // Vue/React/Blade server-rendered component prop: :prop="&quot;VALUE&quot;" or :prop="VALUE"
      // Example: <auth-login :token="&quot;abc123&quot;"> (Laravel/Vue SPA pattern)
      const reVueProp = new RegExp(
        `:([a-z][a-z0-9-]*)=["'](?:&quot;)?${escapeRegex(v)}(?:&quot;)?["']`,
        "i",
      );
      const mVue = entry.respBody.match(reVueProp);
      if (mVue) {
        const hasEntities = mVue[0].includes("&quot;");
        const lb = `:${mVue[1]}="${hasEntities ? "&quot;" : ""}`;
        const rb = hasEntities ? '&quot;"' : '"';
        return { type: "boundary", config: { lb, rb } };
      }
      // data-* attribute: data-token="VALUE" or data-csrf="VALUE"
      // Use HtmlExtractor (DOM-parsed, reliable) not BoundaryExtractor (text search)
      const reDataAttr = new RegExp(
        `data-([a-z][a-z0-9-]*)=["']${escapeRegex(v)}["']`,
        "i",
      );
      const mData = entry.respBody.match(reDataAttr);
      if (mData) {
        const dAttr = `data-${mData[1]}`;
        return {
          type: "html",
          config: { selector: `[${dAttr}]`, attr: dAttr },
        };
      }
      // JavaScript variable assignment: var token = "VALUE" or const csrfToken = 'VALUE'
      const reJsVar = new RegExp(
        `(?:var|let|const)\\s+[A-Za-z_][A-Za-z0-9_]*\\s*=\\s*["']${escapeRegex(v)}["']`,
        "i",
      );
      const mJs = entry.respBody.match(reJsVar);
      if (mJs) {
        const eqIdx = mJs[0].indexOf("=");
        const lb =
          mJs[0]
            .substring(0, eqIdx + 1)
            .replace(/\s+/g, " ")
            .trimEnd() + ' "';
        return { type: "boundary", config: { lb, rb: '"' } };
      }
      // meta tag: <meta name="csrf-token" content="VALUE">
      // Use HtmlExtractor (DOM-parsed) not BoundaryExtractor — more reliable for meta content
      const reMeta = new RegExp(
        `<meta[^>]+(?:name|id)=["'][^"']*["'][^>]+content=["']${escapeRegex(v)}["']` +
          `|<meta[^>]+content=["']${escapeRegex(v)}["'][^>]+(?:name|id)=["']([^"']+)["']`,
        "i",
      );
      const mMeta = entry.respBody.match(reMeta);
      if (mMeta) {
        const nameM = entry.respBody.match(
          new RegExp(
            `<meta[^>]+name=["']([^"']+)["'][^>]+content=["']${escapeRegex(v)}["']`,
            "i",
          ),
        );
        const metaName = nameM ? nameM[1] : "csrf-token";
        return {
          type: "html",
          config: {
            selector: `meta[name='${escJs(metaName)}']`,
            attr: "content",
          },
        };
      }
    }

    // Universal boundary fallback — works for any content type
    const idx = entry.respBody.indexOf(v);
    const before = entry.respBody.substring(Math.max(0, idx - 15), idx);
    const after = entry.respBody.substring(
      idx + v.length,
      idx + v.length + 3,
    );
    return {
      type: "boundary",
      config: { lb: before.slice(-8), rb: after || '"' },
    };
  }

  return null;
}

function findValueBefore(value, entries, maxIdx) {
  for (let i = 0; i < maxIdx; i++) {
    if (entries[i].filtered) continue;
    const f = findValueInResponse(value, entries[i]);
    if (f) return { ...f, idx: i };
  }
  return null;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLE-HAR CORRELATION (Pattern-based)
// ═══════════════════════════════════════════════════════════════════════════
function singleHarCorrelate(entries) {
  const corrs = [];
  const counter = {};
  const seen = new Set(); // avoid duplicate correlations for same source+name
  // Unresolved: dynamic values found in requests but source response not captured in HAR.
  // Exposed via S.candidates so the codegen emits TODO hints instead of hardcoded strings.
  const unresolvedCandidates = [];

  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx];
    if (e.filtered) continue;

    // Check Authorization header
    for (const h of e.reqHdrs) {
      const k = h.name.toLowerCase();
      if (!AUTH_HEADER_NAMES.has(k)) continue;
      let token = h.value;
      let prefix = "";
      if (token.startsWith("Bearer ")) {
        prefix = "Bearer ";
        token = token.substring(7);
      } else if (token.startsWith("Basic ")) {
        continue;
      } // Basic auth is static
      if (!isDynamic(token)) continue;
      const key = token.substring(0, 16);
      if (seen.has(key)) continue;
      seen.add(key);
      const src = findValueBefore(token, entries, idx);
      if (src) {
        const name = genParamName(
          k === "authorization" ? "AccessToken" : k.replace(/^x-/, ""),
          counter,
        );
        addUsage(corrs, name, src, {
          reqIdx: idx,
          location: "header",
          key: h.name,
          originalValue: h.value,
          prefix,
          tokenValue: token,
        });
      } else {
        // Source response not found in HAR (body not captured or response missing).
        // Add to unresolved so codegen can emit a TODO comment + load.global placeholder.
        const hintName = k === "authorization" ? "AccessToken" : sanitizeCandHint(k.replace(/^x-/, ""));
        unresolvedCandidates.push({
          hint: hintName,
          prefix: prefix,
          value: token.substring(0, 80),
          usages: [{ location: "header", key: h.name, reqUrl: e.url || "" }],
        });
      }
    }

    // Check CSRF headers — known set OR broad pattern (catches x-xsrf-header, x-csrf-header, etc.)
    for (const h of e.reqHdrs) {
      const k = h.name.toLowerCase();
      if (!CSRF_HEADER_NAMES.has(k) && !CSRF_HEADER_PATTERN.test(k))
        continue;
      const v = h.value;
      if (!v || v.length < 4) continue;
      const key = v.substring(0, 16);
      if (seen.has(key)) continue;
      seen.add(key);
      const src = findValueBefore(v, entries, idx);
      if (src) {
        const name = genParamName("CsrfToken", counter);
        addUsage(corrs, name, src, {
          reqIdx: idx,
          location: "header",
          key: h.name,
          originalValue: v,
          prefix: "",
        });
      } else {
        // Fallback: CSRF tokens are often read from a cookie by JS and sent as a header.
        // Check the Cookie request header of this same request for a cookie value that matches.
        const cookieHdr = e.hdrsMap["cookie"] || "";
        let matchCkName = null;
        cookieHdr.split(";").forEach((ck) => {
          const eq = ck.indexOf("=");
          if (eq < 1) return;
          if (ck.substring(eq + 1).trim() === v)
            matchCkName = ck.substring(0, eq).trim();
        });
        if (matchCkName) {
          // Use the earliest non-marker response as the extraction source
          let srcIdx = 0;
          for (let i = 0; i < idx; i++) {
            if (!entries[i].filtered && !entries[i].isMarker) {
              srcIdx = i;
              break;
            }
          }
          const name = genParamName("CsrfToken", counter);
          addUsage(
            corrs,
            name,
            {
              type: "cookie",
              config: { cookieName: matchCkName },
              idx: srcIdx,
            },
            {
              reqIdx: idx,
              location: "header",
              key: h.name,
              originalValue: v,
              prefix: "",
            },
          );
        }
      }
    }

    // Check session cookies being sent
    const cookieHdr = e.hdrsMap["cookie"] || "";
    if (cookieHdr) {
      cookieHdr.split(";").forEach((ck) => {
        const eq = ck.indexOf("=");
        if (eq < 1) return;
        const cname = ck.substring(0, eq).trim();
        const cval = ck.substring(eq + 1).trim();
        if (!SESSION_COOKIE_NAMES.has(cname.toLowerCase())) return;
        if (!cval || cval.length < 4) return;
        const key = "ck_" + cname.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        // Find Set-Cookie in previous responses
        for (let i = 0; i < idx; i++) {
          if (entries[i].filtered) continue;
          const ckFound = entries[i].respCookies.find(
            (c) => c.name.toLowerCase() === cname.toLowerCase(),
          );
          if (
            ckFound ||
            entries[i].respHdrsMap["set-cookie"]
              ?.toLowerCase()
              .includes(cname.toLowerCase() + "=")
          ) {
            const name = genParamName(cname, counter);
            addUsage(
              corrs,
              name,
              { type: "cookie", config: { cookieName: cname }, idx: i },
              {
                reqIdx: idx,
                location: "cookie",
                key: cname,
                originalValue: cval,
                prefix: "",
              },
            );
            break;
          }
        }
      });
    }

    // Check session tokens in URL path params (;jsessionid=xxx, etc.)
    try {
      const pathParams = extractUrlPathParams(e.url);
      for (const [k, v] of Object.entries(pathParams)) {
        if (!SESSION_COOKIE_NAMES.has(k.toLowerCase())) continue;
        if (!v || v.length < 4) continue;
        const key = "ck_path_" + k.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        for (let i = 0; i < idx; i++) {
          if (entries[i].filtered) continue;
          const ckFound = entries[i].respCookies.find(
            (c) => c.name.toLowerCase() === k.toLowerCase(),
          );
          if (
            ckFound ||
            entries[i].respHdrsMap["set-cookie"]
              ?.toLowerCase()
              .includes(k.toLowerCase() + "=")
          ) {
            const cname = genParamName(k, counter);
            addUsage(
              corrs,
              cname,
              { type: "cookie", config: { cookieName: k }, idx: i },
              {
                reqIdx: idx,
                location: "url_path",
                key: k,
                originalValue: v,
                prefix: "",
              },
            );
            break;
          }
        }
      }
    } catch {}
  }

  // ── Redirect chain correlations ────────────────────────────────────────────
  // Generic: handles OAuth2 state/code, OIDC/PingFederate session tokens,
  // any dynamic path segment or query param in a 3xx Location header that is
  // subsequently used in the next request's URL or POST body.
  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx];
    if (e.filtered || !e.status || e.status < 300 || e.status >= 400)
      continue;
    const loc = (e.respHdrsMap || {})["location"] || "";
    if (!loc) continue;
    let locUrl;
    try {
      locUrl = new URL(loc);
    } catch {
      continue;
    }

    // ── Path segments ──────────────────────────────────────────────────────
    const segs = locUrl.pathname.split("/").filter(Boolean);
    for (const seg of segs) {
      if (!isDynamic(seg)) continue;
      const seenKey = "redir_path_" + seg.substring(0, 20);
      if (seen.has(seenKey)) continue;
      for (let j = idx + 1; j < entries.length; j++) {
        const ne = entries[j];
        if (ne.filtered) continue;
        // Check if this dynamic segment appears in the next request's URL
        if (
          ne.url.includes("/" + seg + "/") ||
          ne.url.includes("/" + seg + "?") ||
          ne.url.endsWith("/" + seg) ||
          ne.url.includes("/" + seg + "#")
        ) {
          seen.add(seenKey);
          const name = genParamName(
            sanitizeCandHint(
              seg.length > 12 ? seg.substring(0, 12) : seg,
            ),
            counter,
          );
          // Compute LB/RB around the segment in the Location URL
          const vidx = loc.indexOf(seg);
          const pre = loc.substring(0, vidx);
          const post = loc.substring(vidx + seg.length);
          const prevSlash = pre.lastIndexOf("/", pre.length - 1);
          const prevPrev = pre.lastIndexOf("/", prevSlash - 1);
          const lb = pre.substring(prevPrev >= 0 ? prevPrev : prevSlash);
          const rb = post.startsWith("/")
            ? "/"
            : post.startsWith("?")
              ? "?"
              : "\r\n";
          addUsage(
            corrs,
            name,
            { type: "boundary_header", config: { lb, rb }, idx },
            {
              reqIdx: j,
              location: "url_path_seg",
              key: "$" + name,
              originalValue: seg,
              tokenValue: seg,
            },
          );
          break;
        }
      }
    }

    // ── Query params ───────────────────────────────────────────────────────
    for (const [k, v] of locUrl.searchParams) {
      if (!isDynamic(v)) continue;
      const seenKey =
        "redir_qp_" + k.toLowerCase() + "_" + v.substring(0, 12);
      if (seen.has(seenKey)) continue;
      for (let j = idx + 1; j < entries.length; j++) {
        const ne = entries[j];
        if (ne.filtered) continue;
        const usedInUrl = ne.url.includes(v);
        const usedInBody = ne.body && (ne.body.text || "").includes(v);
        if (!usedInUrl && !usedInBody) continue;
        seen.add(seenKey);
        const name = genParamName(sanitizeCandHint(k), counter);
        // Compute LB/RB around the param in the Location URL
        const eqIdx = loc.indexOf(k + "=");
        if (eqIdx < 0) break;
        const afterEq = eqIdx + k.length + 1;
        const preInLoc = loc.substring(0, afterEq);
        const sepIdx = Math.max(
          preInLoc.lastIndexOf("?"),
          preInLoc.lastIndexOf("&"),
        );
        const lb = preInLoc.substring(sepIdx + 1); // e.g. "state=" or "code="
        const afterVal = loc.substring(afterEq + v.length);
        const rb = afterVal.startsWith("&") ? "&" : "\r\n";
        const location = usedInUrl ? "query" : "body_form";
        addUsage(
          corrs,
          name,
          { type: "boundary_header", config: { lb, rb }, idx },
          {
            reqIdx: j,
            location,
            key: k,
            originalValue: v,
            tokenValue: v,
          },
        );
        break;
      }
    }
  }

  // Expose unresolved dynamic headers so the codegen can emit TODO hints
  // instead of hardcoded token strings. Dedup against corrs that were fully resolved.
  if (unresolvedCandidates.length > 0) {
    const resolvedKeys = new Set(
      corrs.flatMap((c) =>
        c.usages
          .filter((u) => u.location === "header")
          .map((u) => (u.key || "").toLowerCase()),
      ),
    );
    const filtered = unresolvedCandidates.filter(
      (uc) =>
        !resolvedKeys.has((uc.usages[0] && uc.usages[0].key || "").toLowerCase()),
    );
    if (filtered.length > 0) {
      S.candidates = (S.candidates || []).concat(filtered);
    }
  }

  return corrs;
}

function addUsage(corrs, name, src, usage) {
  // Check if a correlation with same name already exists
  const existing = corrs.find((c) => c.name === name);
  if (existing) {
    existing.usages.push(usage);
  } else {
    corrs.push({
      name,
      sourceIdx: src.idx,
      extractorType: src.type,
      extractorConfig: src.config,
      usages: [usage],
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// TWO-HAR CORRELATION (Diff-based)
// ═══════════════════════════════════════════════════════════════════════════
function twoHarCorrelate(entries1, entries2) {
  let corrs = [];
  const counter = {};
  const seen = new Set();

  // Match request pairs by method + normalized URL
  // Use a used-set so that duplicate URLs (e.g. multiple POSTs to same endpoint)
  // are matched in order, not all against the first entry in entries2.
  const matched = [];
  const used2Set = new Set();
  for (const e1 of entries1) {
    if (e1.filtered) continue;
    const key1 = e1.method + "|" + normalizeUrlKey(e1.url);
    const e2 = entries2.find(
      (e) =>
        !e.filtered &&
        !used2Set.has(e) &&
        e.method + "|" + normalizeUrlKey(e.url) === key1,
    );
    if (e2) {
      used2Set.add(e2);
      matched.push({
        e1,
        e2,
        idx1: entries1.indexOf(e1),
        idx2: entries2.indexOf(e2),
      });
    }
  }

  // Collect changed values per matched pair
  const changedVals = []; // {reqIdx, reqIdx2, location, key, value1, value2, hint}

  for (const { e1, e2, idx1, idx2 } of matched) {
    // ── URL path matrix params (;key=value like ;jsessionid=xxx) ──────────────
    try {
      const pp1 = extractUrlPathParams(e1.url),
        pp2 = extractUrlPathParams(e2.url);
      for (const [k, v1] of Object.entries(pp1)) {
        const v2 = pp2[k];
        if (v2 && v1 !== v2 && isDynamic(v1)) {
          const hint =
            k.toLowerCase() === "jsessionid" ? "JSessionId" : k;
          changedVals.push({
            reqIdx: idx1,
            reqIdx2: idx2,
            location: "url_path",
            key: k,
            value1: v1,
            value2: v2,
            hint,
          });
        }
      }
    } catch {}

    // ── URL path segment dynamic values (UUIDs / tokens embedded in REST paths) ──
    // e.g. /api/orders/UUID1/items ↔ /api/orders/UUID2/items
    for (const { v1, v2, hint } of extractDynamicPathSegments(
      e1.url,
      e2.url,
    )) {
      changedVals.push({
        reqIdx: idx1,
        reqIdx2: idx2,
        location: "url_path_seg",
        key: "$" + hint,
        value1: v1,
        value2: v2,
        hint,
      });
    }

    // ── URL query params ───────────────────────────────────────────────────────
    try {
      const p1 = new URL(e1.url),
        p2 = new URL(e2.url);
      p1.searchParams.forEach((v1, k) => {
        const v2 = p2.searchParams.get(k);
        if (v2 && v1 !== v2 && isDynamic(v1))
          changedVals.push({
            reqIdx: idx1,
            reqIdx2: idx2,
            location: "query",
            key: k,
            value1: v1,
            value2: v2,
            hint: k,
          });
      });
    } catch {}

    // ── Request headers (all except SKIP_HDRS; cookie handled separately below) ─
    for (const h1 of e1.reqHdrs) {
      const k = h1.name.toLowerCase();
      if (SKIP_HDRS.has(k)) continue;
      const h2 = e2.reqHdrs.find((h) => h.name.toLowerCase() === k);
      if (!h2 || h1.value === h2.value) continue;
      let v1 = h1.value,
        v2 = h2.value,
        hint = k,
        prefix = "";
      if (k === "authorization") {
        if (v1.startsWith("Bearer ")) {
          prefix = "Bearer ";
          v1 = v1.substring(7);
          v2 = v2?.substring(7) || v2;
        }
        hint = "AccessToken";
      } else if (
        CSRF_HEADER_NAMES.has(k) ||
        CSRF_HEADER_PATTERN.test(k)
      ) {
        // Keep original header name as hint so genParamName produces a meaningful name
        // (e.g. X_Xsrf_Token, X_Csrf_Header) and FALLBACK 2c pattern match still works
        hint = k;
      }
      if (isDynamic(v1))
        changedVals.push({
          reqIdx: idx1,
          reqIdx2: idx2,
          location: "header",
          key: h1.name,
          value1: v1,
          value2: v2,
          hint,
          prefix,
          originalHeaderValue: h1.value,
        });
    }

    // ── Cookie request header — parse individual name=value pairs ─────────────
    // Detects dynamic cookie values that change between sessions.
    // VuGen/DevWeb cookie jars handle Cookie: headers automatically — we only need
    // to find which Set-Cookie response sets each dynamic cookie value.
    {
      const ck1 = e1.hdrsMap?.["cookie"] || "",
        ck2 = e2.hdrsMap?.["cookie"] || "";
      if (ck1 && ck2) {
        const map1 = parseCookieHdr(ck1),
          map2 = parseCookieHdr(ck2);
        for (const [ckName, v1] of Object.entries(map1)) {
          const v2 = map2[ckName];
          if (!v2 || v1 === v2 || !isDynamic(v1)) continue;
          changedVals.push({
            reqIdx: idx1,
            reqIdx2: idx2,
            location: "cookie",
            key: ckName,
            value1: v1,
            value2: v2,
            hint: ckName,
          });
        }
      }
    }

    // ── Request body (JSON, form-urlencoded, XML) ──────────────────────────────
    if (e1.body && e2.body) {
      const mime = (e1.body.mimeType || "").toLowerCase();
      if (mime.includes("json")) {
        const diffs = jsonDiffFlat(
          e1.body.text || "",
          e2.body.text || "",
        );
        for (const { path, v1, v2 } of diffs) {
          if (isDynamic(v1)) {
            const hint = path
              .replace(/^\$\./, "")
              .replace(/\[.*?\]/g, "")
              .replace(/\./g, "_");
            changedVals.push({
              reqIdx: idx1,
              reqIdx2: idx2,
              location: "body_json",
              key: path,
              value1: v1,
              value2: v2,
              hint,
            });
          }
        }
      } else if (
        mime.includes("form") ||
        mime.includes("urlencoded") ||
        !mime
      ) {
        // form-urlencoded or params array
        try {
          const p1 = new URLSearchParams(e1.body.text || "");
          const p2 = new URLSearchParams(e2.body.text || "");
          p1.forEach((v1, k) => {
            const v2 = p2.get(k);
            if (v2 !== null && v1 !== v2 && isDynamic(v1))
              changedVals.push({
                reqIdx: idx1,
                reqIdx2: idx2,
                location: "body_form",
                key: k,
                value1: v1,
                value2: v2,
                hint: k,
              });
          });
        } catch {}
        // Also handle HAR params array (some browsers use this instead of text)
        if (e1.body.params && e2.body.params) {
          for (const p of e1.body.params) {
            const p2 = e2.body.params.find((x) => x.name === p.name);
            if (p2 && p.value !== p2.value && isDynamic(p.value))
              changedVals.push({
                reqIdx: idx1,
                reqIdx2: idx2,
                location: "body_form",
                key: p.name,
                value1: p.value,
                value2: p2.value,
                hint: p.name,
              });
          }
        }
      } else if (mime.includes("xml")) {
        // XML body — extract <tag>value</tag> leaf pairs
        const diffs = xmlDiffFlat(e1.body.text || "", e2.body.text || "");
        for (const { path, v1, v2 } of diffs) {
          if (isDynamic(v1))
            changedVals.push({
              reqIdx: idx1,
              reqIdx2: idx2,
              location: "body_xml",
              key: path,
              value1: v1,
              value2: v2,
              hint: path,
            });
        }
      }
    }
  }

  // Deduplicate by value1 (same value in multiple places → one correlation)
  const valMap = new Map();
  for (const cv of changedVals) {
    const k = cv.value1;
    if (!valMap.has(k))
      valMap.set(k, {
        hint: cv.hint,
        prefix: cv.prefix || "",
        usages: [],
      });
    valMap.get(k).usages.push(cv);
  }

  // Back-trace each value in entries1
  // Known framework-generated hidden form fields — extractor is deterministic even without seeing body
  const KNOWN_HIDDEN_FIELD =
    /^(_sourcePage|__fp|__VIEWSTATE|__EVENTVALIDATION|__VIEWSTATEGENERATOR|__RequestVerificationToken|authenticity_token|_csrf_token|csrfmiddlewaretoken|_csrf|_token|csrf_token|form_key|javax\.faces\.ViewState|com\.sun\.faces\.VIEW|__EVENTTARGET|__EVENTARGUMENT|struts\.token\.name|struts\.token|wicket:interface|wicket:pageMapName)$/i;

  const candidates = [];
  for (const [value1, info] of valMap) {
    if (seen.has(value1.substring(0, 16))) continue;
    seen.add(value1.substring(0, 16));
    const firstUsageIdx = Math.min(...info.usages.map((u) => u.reqIdx));
    let src = findValueBefore(value1, entries1, firstUsageIdx);

    if (!src) {
      // ── FALLBACK 1: Cross-HAR search ──────────────────────────────────────
      // The value is different between recordings, but the extractor pattern is the same.
      // Look for value2 in HAR2 responses and re-use the discovered extractor config.
      const firstUsage =
        info.usages.find((u) => u.reqIdx === firstUsageIdx) ||
        info.usages[0];
      const value2 = firstUsage?.value2;
      const firstUsageIdx2 = firstUsage?.reqIdx2 ?? entries2.length;
      if (value2 && entries2) {
        const src2 = findValueBefore(value2, entries2, firstUsageIdx2);
        if (src2) {
          // Map the HAR2 source entry back to entries1 by matching normalised URL
          const srcUrl2 = normalizeUrlKey(entries2[src2.idx]?.url || "");
          let idx1src = -1;
          for (let i = firstUsageIdx - 1; i >= 0; i--) {
            if (
              !entries1[i].filtered &&
              normalizeUrlKey(entries1[i].url) === srcUrl2
            ) {
              idx1src = i;
              break;
            }
          }
          if (idx1src >= 0) {
            const name = genParamName(info.hint || "DynParam", counter);
            const usages = info.usages.map((u) => ({
              reqIdx: u.reqIdx,
              location: u.location,
              key: u.key,
              originalValue: u.originalHeaderValue || u.value1,
              tokenValue: u.value1,
              prefix: u.prefix || "",
            }));
            corrs.push({
              name,
              sourceIdx: idx1src,
              extractorType: src2.type,
              extractorConfig: src2.config,
              usages,
            });
            continue;
          }
        }
      }

      // ── FALLBACK 2: Pattern-based known hidden form fields ─────────────────
      // For Apache Struts _sourcePage/__fp, ASP.NET __VIEWSTATE etc., the HTML
      // extraction syntax is deterministic from the field name alone — no body needed.
      if (KNOWN_HIDDEN_FIELD.test(info.hint || "")) {
        const fieldName = info.hint;
        // Find the last GET on the same host before the first POST usage
        let usageHost = "";
        try {
          usageHost = new URL(entries1[firstUsageIdx]?.url || "")
            .hostname;
        } catch {}
        let formGetIdx = -1;
        for (let i = firstUsageIdx - 1; i >= 0; i--) {
          if (!entries1[i].filtered && entries1[i].method === "GET") {
            let eHost = "";
            try {
              eHost = new URL(entries1[i].url).hostname;
            } catch {}
            if (eHost === usageHost) {
              formGetIdx = i;
              break;
            }
          }
        }
        if (formGetIdx >= 0) {
          const name = genParamName(fieldName, counter);
          const usages = info.usages.map((u) => ({
            reqIdx: u.reqIdx,
            location: u.location,
            key: u.key,
            originalValue: u.originalHeaderValue || u.value1,
            tokenValue: u.value1,
            prefix: u.prefix || "",
          }));
          corrs.push({
            name,
            sourceIdx: formGetIdx,
            extractorType: "html",
            extractorConfig: {
              selector: `input[name='${fieldName}']`,
              attr: "value",
            },
            usages,
          });
          continue;
        }
      }

      // ── FALLBACK 2b: Session cookie in URL path params (;jsessionid=xxx) ────
      // HAR often omits the Set-Cookie response header for session tokens.
      // We know these are server-managed session cookies — place
      // web_reg_save_param_cookie before the first request to extract the value.
      const isSessionPathParam =
        info.usages.some((u) => u.location === "url_path") &&
        SESSION_COOKIE_NAMES.has((info.hint || "").toLowerCase());
      if (isSessionPathParam) {
        let sessionSrcIdx = 0;
        for (let i = 0; i < firstUsageIdx; i++) {
          if (!entries1[i].filtered && !entries1[i].isMarker) {
            sessionSrcIdx = i;
            break;
          }
        }
        // Reconstruct the cookie name from the original URL path param key
        const origKey =
          info.usages.find((u) => u.location === "url_path")?.key ||
          info.hint ||
          "jsessionid";
        const cookieName =
          origKey.toUpperCase() === "JSESSIONID" ? "JSESSIONID" : origKey;
        const name = genParamName(info.hint || "DynParam", counter);
        const usages = info.usages.map((u) => ({
          reqIdx: u.reqIdx,
          location: u.location,
          key: u.key,
          originalValue: u.originalHeaderValue || u.value1,
          tokenValue: u.value1,
          prefix: u.prefix || "",
        }));
        corrs.push({
          name,
          sourceIdx: sessionSrcIdx,
          extractorType: "cookie",
          extractorConfig: { cookieName },
          usages,
        });
        continue;
      }

      // ── FALLBACK 2c: CSRF/XSRF request header → matching request cookie ──────
      // CSRF tokens sent as request headers are almost always derived from a server-set
      // cookie that JavaScript reads and echoes as a header (double-submit cookie pattern).
      // Even when Set-Cookie is absent from HAR (cached response), the Cookie request
      // header of the same request will contain the token — use that to find the cookie name.
      const isCsrfHdr =
        info.usages.some((u) => u.location === "header") &&
        (CSRF_HEADER_NAMES.has((info.hint || "").toLowerCase()) ||
          CSRF_HEADER_PATTERN.test(info.hint || ""));
      if (isCsrfHdr) {
        const firstReq = entries1[firstUsageIdx];
        const cookieHdr = firstReq?.hdrsMap?.["cookie"] || "";
        let matchCkName = null;
        // Pass 1: exact, URL-decoded, or URL-encoded value match
        cookieHdr.split(";").forEach((ck) => {
          if (matchCkName) return;
          const eq = ck.indexOf("=");
          if (eq < 1) return;
          const ckName = ck.substring(0, eq).trim();
          const ckVal = ck.substring(eq + 1).trim();
          try {
            if (
              ckVal === value1 ||
              decodeURIComponent(ckVal) === value1 ||
              ckVal === encodeURIComponent(value1)
            ) {
              matchCkName = ckName;
            }
          } catch {
            if (ckVal === value1) matchCkName = ckName;
          }
        });
        // Pass 2: no value match (browser may have decoded before sending) — use cookie NAME pattern
        // Look for any cookie named XSRF-TOKEN, csrf_token, CSRF-TOKEN, etc.
        if (!matchCkName) {
          const XSRF_CK_PAT = /xsrf.?token|csrf.?token|xsrf|csrf/i;
          cookieHdr.split(";").forEach((ck) => {
            if (matchCkName) return;
            const eq = ck.indexOf("=");
            if (eq < 1) return;
            const ckName = ck.substring(0, eq).trim();
            if (XSRF_CK_PAT.test(ckName)) matchCkName = ckName;
          });
        }
        if (matchCkName) {
          let srcIdx = 0;
          for (let i = 0; i < firstUsageIdx; i++) {
            if (!entries1[i].filtered && !entries1[i].isMarker) {
              srcIdx = i;
              break;
            }
          }
          const hdrKey =
            info.usages.find((u) => u.location === "header")?.key ||
            info.hint ||
            "CsrfToken";
          const name = genParamName(sanitizeCandHint(hdrKey), counter);
          const usages = info.usages.map((u) => ({
            reqIdx: u.reqIdx,
            location: u.location,
            key: u.key,
            originalValue: u.originalHeaderValue || u.value1,
            tokenValue: u.value1,
            prefix: u.prefix || "",
          }));
          corrs.push({
            name,
            sourceIdx: srcIdx,
            extractorType: "cookie",
            extractorConfig: { cookieName: matchCkName },
            usages,
          });
          continue;
        }
      }

      // ── FALLBACK 2d: Dynamic header with UUID/hex/token pattern → generate at runtime ───
      // Covers: client-generated CSRF tokens, per-iteration nonces, random API keys.
      // These are never in any server response — the client JS generates them.
      // Use lr_param_sprintf / crypto.randomUUID() to produce a matching format each iteration.
      if (info.usages.some((u) => u.location === "header")) {
        let genPat = null;
        if (DYNAMIC_PATTERNS.uuid.test(value1)) genPat = "uuid";
        else if (DYNAMIC_PATTERNS.hex64.test(value1)) genPat = "hex64";
        else if (DYNAMIC_PATTERNS.hex32.test(value1)) genPat = "hex32";
        else if (DYNAMIC_PATTERNS.hex16.test(value1)) genPat = "hex16";
        else if (isCsrfHdr) genPat = "alphanumeric"; // CSRF header — best effort
        if (genPat) {
          const hdrKey =
            info.usages.find((u) => u.location === "header")?.key ||
            info.hint ||
            "DynToken";
          const name = genParamName(sanitizeCandHint(hdrKey), counter);
          const usages = info.usages.map((u) => ({
            reqIdx: u.reqIdx,
            location: u.location,
            key: u.key,
            originalValue: u.originalHeaderValue || u.value1,
            tokenValue: u.value1,
            prefix: u.prefix || "",
          }));
          corrs.push({
            name,
            sourceIdx: -1,
            extractorType: "generate",
            extractorConfig: { pattern: genPat, length: value1.length },
            usages,
          });
          continue;
        }
      }

      // ── FALLBACK 3: Record as unresolved candidate ─────────────────────────
      // Skip if all usages are body form/JSON fields whose KEY matches PARAM_KEYS_MAP.
      // These are user-entered values (creditCard, username, etc.) — not server-generated tokens.
      // detectParams() will handle them with the correct parameter substitution.
      const allBodyUsages = info.usages.every(
        (u) =>
          u.location === "body_form" ||
          u.location === "body_json" ||
          u.location === "body_xml",
      );
      if (allBodyUsages && matchParamKey(info.hint || "")) {
        continue; // drop — let detectParams() parameterise it instead
      }
      candidates.push({
        hint: info.hint || "DynParam",
        value: value1.substring(0, 80), // truncated for display
        fullValue: value1, // full value for body substitution
        usages: info.usages.map((u) => ({
          location: u.location,
          key: u.key,
          reqUrl: entries1[u.reqIdx] ? entries1[u.reqIdx].url : "",
        })),
      });
      continue;
    }

    const name = genParamName(info.hint || "DynParam", counter);
    const usages = info.usages.map((u) => ({
      reqIdx: u.reqIdx,
      location: u.location,
      key: u.key,
      originalValue: u.originalHeaderValue || u.value1,
      tokenValue: u.value1,
      prefix: u.prefix || "",
    }));
    corrs.push({
      name,
      sourceIdx: src.idx,
      extractorType: src.type,
      extractorConfig: src.config,
      usages,
    });
  }

  // Consolidate generate-type correlations sharing the same header key.
  // Per-request rotating tokens produce one corr per matched pair (each unique value1 → its own corr).
  // Merge them into ONE correlation (same parameter name) so we generate one fresh value
  // before each individual request — instead of emitting N separate lr_param_sprintf calls at action start.
  {
    const nonGen = [],
      genByKey = new Map();
    for (const c of corrs) {
      if (c.extractorType !== "generate") {
        nonGen.push(c);
        continue;
      }
      const hdrKey = (
        c.usages.find((u) => u.location === "header")?.key || ""
      ).toLowerCase();
      if (!genByKey.has(hdrKey)) {
        genByKey.set(hdrKey, {
          corr: { ...c, usages: [...c.usages] },
          origCount: 1,
        });
      } else {
        genByKey.get(hdrKey).corr.usages.push(...c.usages);
        genByKey.get(hdrKey).origCount++;
      }
    }
    corrs = [...nonGen];
    for (const [, { corr, origCount }] of genByKey) {
      corr.usages.sort((a, b) => a.reqIdx - b.reqIdx);
      // origCount > 1 → multiple distinct token values (per-request rotation) → generate before EACH request
      // origCount === 1 → single session-scoped token (same value all requests) → generate once at iteration start
      corr.rotatingPerRequest = origCount > 1;
      corrs.push(corr);
    }
  }
  S.candidates = candidates;
  return corrs;
}

// ─── Phase 4: Value-Based Auto-Correlation (Request-First Engine) ────────────
//
// Starts from REQUESTS — extracts dynamic-looking values from request
// headers/body/URL using smart heuristics, then traces each value backward
// to the specific earlier response that produced it.
//
// Design principles (performance-tester's perspective):
//   1. Request-first  — start from what's in requests, not response index
//   2. Smart selection — known token field names + isDynamic() heuristics
//   3. Cookie skip    — VuGen cookie jar handles Cookie: header automatically
//   4. HTML/JSON/XML  — all three response content types supported
//   5. Two-HAR aware  — values unchanged between sessions are static → skip
//   6. Frequency cap  — value in > 3 requests is likely a static API token
//   7. Zero false positives — unknown fields require isDynamic() to pass
//
// @param {Array}  entries   - Primary HAR entries (parseHar / parseNetLog)
// @param {Array}  existing  - Correlations already found (avoid duplicates)
// @param {Array}  [entries2]- Second HAR (two-HAR mode) for change validation
// @returns {Array} New correlation objects, same shape as singleHarCorrelate
//
function valueBasedCorrelate(entries, existing, entries2) {
  if (!Array.isArray(entries) || entries.length < 2) return [];

  var MIN_LEN    = 8;  // values shorter than this are never dynamic tokens
  var MAX_USAGES = 3;  // value in > 3 distinct requests → probably static CDN/API token

  // ── Known dynamic token request HEADER names (lowercase) ─────────────────
  var KNOWN_TOKEN_HDRS = {
    'authorization': true,
    'x-csrf-token': true,
    'x-xsrf-token': true,
    'x-anti-forgery-token': true,
    'x-request-id': true,
    'x-correlation-id': true,
    'x-auth-token': true,
    'x-access-token': true,
    'x-session-token': true,
    'x-session-id': true,
    'x-api-key': true,
    'x-api-token': true,
    'x-token': true,
    'x-id-token': true,
    'x-refresh-token': true,
    'x-client-id': true,
    'x-trace-id': true,
    'x-b3-traceid': true,
    'x-b3-spanid': true,
    'x-amz-security-token': true,
    'x-aws-access-token': true,
    'if-none-match': true,
  };

  // ── Known dynamic URL query parameter names (lowercase) ──────────────────
  var KNOWN_TOKEN_PARAMS = {
    'access_token': true, 'token': true, 'id_token': true,
    'refresh_token': true, 'session_token': true, 'code': true,
    'state': true, 'nonce': true, 'auth_code': true, 'authcode': true,
    'oauth_token': true, 'oauth_verifier': true, 'sessionid': true,
    'session_id': true, 'sid': true, 'requesttoken': true,
    'request_token': true, 'csrftoken': true, 'csrf_token': true,
    'xsrf_token': true, 'jwt': true, 'assertion': true,
    'client_assertion': true, 'device_code': true, 'user_code': true,
  };

  // ── Known dynamic JSON request body field names (lowercase) ──────────────
  var KNOWN_TOKEN_FIELDS = {
    'access_token': true, 'token': true, 'id_token': true,
    'refresh_token': true, 'auth_token': true, 'accesstoken': true,
    'idtoken': true, 'refreshtoken': true, 'sessiontoken': true,
    'sessionid': true, 'code': true, 'state': true, 'nonce': true,
    'authcode': true, 'auth_code': true, 'assertion': true,
    'client_assertion': true, 'device_code': true, 'user_code': true,
    'grant_token': true, 'authorization_code': true, 'exchange_token': true,
    'session': true, 'csrf': true, 'csrftoken': true, 'csrf_token': true,
    'xsrf_token': true, 'requestverificationtoken': true,
    '__requestverificationtoken': true, '_token': true, 'authenticity_token': true,
  };

  // ── Known dynamic form-body field names (lowercase) ───────────────────────
  var KNOWN_FORM_FIELDS = {
    '__requestverificationtoken': true, '__viewstate': true,
    '__eventvalidation': true, '__viewstategenerator': true,
    '_token': true, 'csrf': true, 'csrf_token': true, 'xsrf_token': true,
    'csrfmiddlewaretoken': true, 'authenticity_token': true,
    'form_key': true, 'nonce': true, 'state': true, 'code': true,
    'session_id': true, 'sessionid': true, 'sid': true,
  };

  // ── Already-correlated values — deduplicate against pattern engine ─────────
  var alreadyCorrelated = {};
  try {
    for (var ci = 0; ci < (existing || []).length; ci++) {
      var ec = existing[ci];
      for (var ui = 0; ui < (ec.usages || []).length; ui++) {
        var eu = ec.usages[ui];
        if (eu.originalValue) alreadyCorrelated[String(eu.originalValue)] = true;
        if (eu.tokenValue)    alreadyCorrelated[String(eu.tokenValue)]    = true;
      }
    }
  } catch (e) { /* non-fatal */ }

  // ── Two-HAR: collect values from session 2 for static-value detection ─────
  // A value that is IDENTICAL in both sessions is a static token → skip it.
  var session2Values = null;
  if (Array.isArray(entries2) && entries2.length > 0) {
    session2Values = {};
    try {
      for (var si = 0; si < entries2.length; si++) {
        var se = entries2[si];
        if (!se || se.filtered || se.isMarker) continue;
        var seHdrs = se.reqHdrs || [];
        for (var shi = 0; shi < seHdrs.length; shi++) {
          var sh = seHdrs[shi];
          if (!sh || !sh.value) continue;
          var shn = (sh.name || '').toLowerCase();
          if (shn === 'cookie') continue;
          if (!KNOWN_TOKEN_HDRS[shn] && shn.indexOf('x-') !== 0) continue;
          var shv = String(sh.value);
          var am2 = /^(Bearer|Basic|Token)\s+(\S.*)$/i.exec(shv);
          session2Values[am2 ? am2[2] : shv] = true;
        }
        var seUrl = se.url || '';
        var seQ = seUrl.indexOf('?');
        if (seQ >= 0) {
          var seQs = seUrl.slice(seQ + 1).split('#')[0].split('&');
          for (var sqi = 0; sqi < seQs.length; sqi++) {
            var sqEq = seQs[sqi].indexOf('=');
            if (sqEq < 0) continue;
            var sqName = seQs[sqi].slice(0, sqEq).toLowerCase();
            var sqVal  = seQs[sqi].slice(sqEq + 1);
            try { sqVal = decodeURIComponent(sqVal.replace(/\+/g, ' ')); } catch(e2) {}
            if (KNOWN_TOKEN_PARAMS[sqName] && sqVal.length >= MIN_LEN) {
              session2Values[sqVal] = true;
            }
          }
        }
      }
    } catch (e) { /* non-fatal */ }
  }

  // ── Helper: should this value be considered a correlation candidate? ───────
  function isCorrelatable(val, forceByName) {
    if (!val) return false;
    var v = String(val).trim();
    if (v.length < MIN_LEN) return false;
    if (alreadyCorrelated[v]) return false;
    if (/^(true|false|null|undefined|none|n\/a)$/i.test(v)) return false;
    if (/^[0-9]{1,15}$/.test(v)) return false;               // plain integer
    if (/^[0-9]{4}-[0-9]{2}-[0-9]{2}/.test(v)) return false; // ISO date
    if (/^(text|application|image|audio|video|font|multipart)\//i.test(v)) return false;
    if (/^https?:\/\//i.test(v)) return false;                // bare URL
    if (forceByName) return true;   // known field name → trust it
    return isDynamic(v);            // unknown field → must be structurally dynamic
  }

  // ── Helper: JSON walker ───────────────────────────────────────────────────
  function walkJson(obj, path, cb) {
    if (obj === null || obj === undefined) return;
    try {
      if (typeof obj === 'string') { cb(obj, path); return; }
      if (typeof obj === 'number') { cb(String(obj), path); return; }
      if (Array.isArray(obj)) {
        for (var ai = 0; ai < obj.length; ai++) {
          walkJson(obj[ai], path + '[' + ai + ']', cb);
        }
      } else if (typeof obj === 'object') {
        var ks = Object.keys(obj);
        for (var ki = 0; ki < ks.length; ki++) {
          walkJson(obj[ks[ki]], path ? path + '.' + ks[ki] : ks[ki], cb);
        }
      }
    } catch (e) { /* ignore */ }
  }

  // ── Pass 1: Extract candidate dynamic values FROM requests ────────────────
  // Map: value → { reqIdxList, location, fieldName, prefix, forceByName }
  var candidates = {};
  var candidateOrder = []; // preserve insertion order (ES5 safe)

  function addCandidate(val, reqIdx, location, fieldName, prefix, forceByName) {
    try {
      var s = String(val || '').trim();
      if (!isCorrelatable(s, forceByName)) return;
      // Two-HAR: if the same value appears in session 2 → it is static → skip
      if (session2Values && session2Values[s]) return;
      if (!candidates[s]) {
        candidates[s] = {
          reqIdxList:  [reqIdx],
          location:    location,
          fieldName:   fieldName || '',
          prefix:      prefix || '',
          forceByName: !!forceByName,
        };
        candidateOrder.push(s);
      } else {
        var cnd = candidates[s];
        if (cnd.reqIdxList.indexOf(reqIdx) < 0) {
          cnd.reqIdxList.push(reqIdx);
        }
      }
    } catch (e) { /* non-fatal */ }
  }

  for (var j = 1; j < entries.length; j++) {
    var reqEntry = entries[j];
    if (!reqEntry || reqEntry.filtered || reqEntry.isMarker) continue;

    // ── Request headers ────────────────────────────────────────────────────
    try {
      var reqHdrs = reqEntry.reqHdrs || [];
      for (var rhi = 0; rhi < reqHdrs.length; rhi++) {
        var rh = reqHdrs[rhi];
        if (!rh || !rh.name || !rh.value) continue;
        var rhName = rh.name.toLowerCase();

        // ALWAYS skip Cookie: header — VuGen cookie jar manages this automatically
        if (rhName === 'cookie') continue;

        var rhVal = String(rh.value || '');

        if (rhName === 'authorization') {
          // Strip Bearer/Basic/Token scheme — correlate the credential, not the scheme
          var authM = /^(Bearer|Basic|Token)\s+(\S.*)$/i.exec(rhVal);
          if (authM) {
            addCandidate(authM[2], j, 'header', rh.name, authM[1] + ' ', true);
          } else if (rhVal.length >= MIN_LEN) {
            addCandidate(rhVal, j, 'header', rh.name, '', true);
          }
        } else if (KNOWN_TOKEN_HDRS[rhName]) {
          // Known token header name → accept if long enough
          if (rhVal.length >= MIN_LEN) {
            addCandidate(rhVal, j, 'header', rh.name, '', true);
          }
        } else if (rhName.indexOf('x-') === 0) {
          // Other X-* headers → require isDynamic (structural check)
          addCandidate(rhVal, j, 'header', rh.name, '', false);
        }
        // Standard headers (Accept, Content-Type, User-Agent, etc.) → intentionally ignored
      }
    } catch (e) { /* non-fatal */ }

    // ── URL query parameters ───────────────────────────────────────────────
    try {
      var qIdx = (reqEntry.url || '').indexOf('?');
      if (qIdx >= 0) {
        var qs = reqEntry.url.slice(qIdx + 1).split('#')[0];
        var pairs = qs.split('&');
        for (var pi = 0; pi < pairs.length; pi++) {
          var eq = pairs[pi].indexOf('=');
          if (eq < 0) continue;
          var pKey = pairs[pi].slice(0, eq);
          var pVal = pairs[pi].slice(eq + 1);
          try { pVal = decodeURIComponent(pVal.replace(/\+/g, ' ')); } catch (e2) {}
          addCandidate(pVal, j, 'query', pKey, '', !!KNOWN_TOKEN_PARAMS[pKey.toLowerCase()]);
        }
      }
    } catch (e) { /* non-fatal */ }

    // ── Request body — JSON ────────────────────────────────────────────────
    var reqCt = (reqEntry.ct || reqEntry.reqCt || '').toLowerCase();
    if (reqEntry.body && reqCt.indexOf('json') >= 0) {
      try {
        var raw = '';
        if (typeof reqEntry.body === 'string') raw = reqEntry.body;
        else if (reqEntry.body && reqEntry.body.raw) raw = reqEntry.body.raw;
        if (raw) {
          var reqJson = null;
          try { reqJson = JSON.parse(raw); } catch (pe) {}
          if (reqJson) {
            (function(jIdx) {
              walkJson(reqJson, '', function(val, path) {
                var leafKey = path.replace(/^.*[.\[]/, '').replace(/\]$/, '').toLowerCase();
                addCandidate(val, jIdx, 'body_json', path, '', !!KNOWN_TOKEN_FIELDS[leafKey]);
              });
            }(j));
          }
        }
      } catch (e) { /* non-fatal */ }
    }

    // ── Request body — form-urlencoded ─────────────────────────────────────
    try {
      var formParams = (reqEntry.body && reqEntry.body.urlencoded)
        ? reqEntry.body.urlencoded : [];
      for (var fi = 0; fi < formParams.length; fi++) {
        var fp = formParams[fi];
        if (!fp || !fp.value) continue;
        var fpKey = (fp.key || '').toLowerCase();
        addCandidate(fp.value, j, 'body_form', fp.key || '', '', !!KNOWN_FORM_FIELDS[fpKey]);
      }
    } catch (e) { /* non-fatal */ }

    // ── URL path segments — UUID / long-hex style dynamic IDs ─────────────
    try {
      var urlPath = (reqEntry.url || '').split('?')[0].split('#')[0];
      var segments = urlPath.split('/');
      for (var sgi = 0; sgi < segments.length; sgi++) {
        var seg = segments[sgi];
        if (seg.length < MIN_LEN) continue;
        // Only accept UUID or long hex (32+ hex chars) — very high confidence dynamic IDs
        if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(seg) ||
            /^[0-9a-f]{32,}$/i.test(seg)) {
          addCandidate(seg, j, 'url_path', 'PathId', '', true);
        }
      }
    } catch (e) { /* non-fatal */ }
  }

  if (candidateOrder.length === 0) return [];

  // ── Pass 2: Trace each candidate back to the earliest producing response ──
  var counter = {};
  var newCorrs = [];

  for (var ci2 = 0; ci2 < candidateOrder.length; ci2++) {
    var value = candidateOrder[ci2];
    var cand  = candidates[value];
    if (!cand) continue;

    try {
      // Frequency guard — value in > MAX_USAGES distinct requests → static token
      if (cand.reqIdxList.length > MAX_USAGES) continue;

      var firstReqIdx = cand.reqIdxList[0];
      var sourceEntry = null;
      var sourceIdx   = -1;

      // Search backward through all entries BEFORE the first usage
      for (var ri = 0; ri < firstReqIdx; ri++) {
        var re = entries[ri];
        if (!re || re.filtered || re.isMarker) continue;
        if (!re.status || re.status < 200 || re.status >= 400) continue;
        if (!re.respBody && (!re.respHdrsMap || !Object.keys(re.respHdrsMap).length)) continue;

        var found = false;

        // Check response body first (most common extraction point)
        if (re.respBody && re.respBody.indexOf(value) >= 0) {
          found = true;
        }

        // Check response headers (excluding Set-Cookie — cookie jar handles those)
        if (!found && re.respHdrsMap) {
          var rHdrKeys = Object.keys(re.respHdrsMap);
          for (var rk = 0; rk < rHdrKeys.length; rk++) {
            var rkn = rHdrKeys[rk];
            if (rkn === 'set-cookie') continue;  // skip — cookie jar handles cookies
            var rkv = String(re.respHdrsMap[rkn] || '');
            if (rkv.indexOf(value) >= 0) { found = true; break; }
          }
        }

        if (found) {
          sourceEntry = re;
          sourceIdx   = ri;
          break; // use the EARLIEST occurrence (best extraction point)
        }
      }

      if (!sourceEntry) continue; // value not in any earlier response → skip

      // Get extraction config using the existing response-analysis engine
      var extraction = null;
      try { extraction = findValueInResponse(value, sourceEntry); } catch (e) {}
      if (!extraction) continue;

      // Skip cookie-type extraction — VuGen cookie jar handles this automatically
      if (extraction.type === 'cookie') continue;

      // Build parameter name from the request field name (most descriptive hint)
      var nameHint  = cand.fieldName
        ? sanitizeCandHint(cand.fieldName)
        : sanitizeCandHint('DynParam');
      var paramName = genParamName(nameHint, counter);

      // Build one usage entry per request that sends this value
      var usages = [];
      for (var ui2 = 0; ui2 < cand.reqIdxList.length; ui2++) {
        usages.push({
          reqIdx:        cand.reqIdxList[ui2],
          location:      cand.location,
          key:           cand.fieldName,
          originalValue: value,
          tokenValue:    value,
          prefix:        cand.prefix,
        });
      }

      newCorrs.push({
        name:            paramName,
        sourceIdx:       sourceIdx,
        extractorType:   extraction.type,
        extractorConfig: extraction.config,
        usages:          usages,
        _vbac:           true,  // produced by value-based engine (for UI annotation)
      });

    } catch (e) { /* non-fatal — skip this candidate */ }
  }

  return newCorrs;
}
