// VuGen Script Studio — Code Generators
// Split from VuGen-Script-Studio-app.js — Phase 4B
// Contains: utility helpers, extractor emitters, HAR filter,
//            genMainJS, genActionC, USR file generators, auth detection.
// Dependencies: VuGen-Script-Studio-constants.js (S state),
//               VuGen-Script-Studio-correlation.js, shared/vugen-codegen.js
// ═══════════════════════════════════════════════════════════════════════════
// UTILITY: escape for JS strings, template literals
// ═══════════════════════════════════════════════════════════════════════════
function escJs(s) {
  return String(s)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r");
}
function escTpl(s) {
  return String(s).replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}
function buildHdrHostMap(entries, primaryHost) {
  const map = {};
  if (primaryHost) map[primaryHost] = "SERVER_HOST";
  const seen = new Set(primaryHost ? [primaryHost] : []);
  const extra = [];
  for (const e of entries || []) {
    if (e.filtered || e.isMarker) continue;
    for (const h of e.reqHdrs || []) {
      let m,
        re = /https?:\/\/([^/\s?#:]+)(?::[0-9]+)?/g;
      while ((m = re.exec(h.value || "")) !== null) {
        if (!seen.has(m[1])) {
          seen.add(m[1]);
          extra.push(m[1]);
        }
      }
    }
  }
  extra.forEach((hh, i) => {
    map[hh] = "SERVER_HOST" + (i + 1);
  });
  return map;
}
function subHdrValMj(val, hostVarMap) {
  let r = val,
    ch = false;
  for (const [_h, _v] of Object.entries(hostVarMap).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (!_h) continue;
    const esc = _h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // Raw URL form: https://hostname/path
    const n = r.replace(
      new RegExp(
        "(https?://)" + esc + "(:[0-9]+)?(?=[/?#\\s\"'`]|$)",
        "g",
      ),
      "$1\x00HDRH_" + _v + "\x00$2",
    );
    if (n !== r) {
      ch = true;
      r = n;
    }
    // URL-encoded form: https%3A%2F%2Fhostname (common in redirect_uri= POST body params)
    const n2 = r.replace(
      new RegExp(
        "(https?%3A%2F%2F)" + esc + "(?=%2F|%3F|%23|&|\\s|$)",
        "gi",
      ),
      "$1\x00HDRH_" + _v + "\x00",
    );
    if (n2 !== r) {
      ch = true;
      r = n2;
    }
  }
  if (!ch) return '"' + escJs(val) + '"';
  return (
    "`" + escTpl(r).replace(/\x00HDRH_([^\x00]+)\x00/g, "${$1}") + "`"
  );
}
// Apply hostname substitution to raw text, returning text with \x00HDRH_VAR\x00 placeholders (for body/backtick emission)
function subRawMj(text, hostVarMap) {
  let r = text,
    ch = false;
  for (const [_h, _v] of Object.entries(hostVarMap).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (!_h) continue;
    const esc = _h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const n = r.replace(
      new RegExp(
        "(https?://)" + esc + "(:[0-9]+)?(?=[/?#\\s\"'`]|$)",
        "g",
      ),
      "$1\x00HDRH_" + _v + "\x00$2",
    );
    if (n !== r) {
      ch = true;
      r = n;
    }
    const n2 = r.replace(
      new RegExp(
        "(https?%3A%2F%2F)" + esc + "(?=%2F|%3F|%23|&|\\s|$)",
        "gi",
      ),
      "$1\x00HDRH_" + _v + "\x00",
    );
    if (n2 !== r) {
      ch = true;
      r = n2;
    }
  }
  return { text: r, changed: ch };
}
function subHdrValC(val, hostVarMap) {
  let r = val;
  for (const [_h, _v] of Object.entries(hostVarMap).sort(
    (a, b) => b[0].length - a[0].length,
  )) {
    if (!_h) continue;
    const esc = _h.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lrP =
      _v === "SERVER_HOST"
        ? "ServerHost"
        : "ServerHost" + _v.replace("SERVER_HOST", "");
    // Raw URL form: https://hostname/path
    r = r.replace(
      new RegExp(
        "(https?://)" + esc + "(:[0-9]+)?(?=[/?#\\s\"'`]|$)",
        "g",
      ),
      "$1{" + lrP + "}$2",
    );
    // URL-encoded form: https%3A%2F%2Fhostname (common in redirect_uri= POST body params)
    r = r.replace(
      new RegExp(
        "(https?%3A%2F%2F)" + esc + "(?=%2F|%3F|%23|&|\\s|$)",
        "gi",
      ),
      "$1{" + lrP + "}",
    );
  }
  return r;
}
function esc(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
function fmtSize(b) {
  if (!b || b <= 0) return "-";
  if (b < 1024) return b + "B";
  if (b < 1048576) return (b / 1024).toFixed(1) + "KB";
  return (b / 1048576).toFixed(1) + "MB";
}
// Returns true if body text requires BodyBinary= (non-printable chars outside \t \n \r range)
function needsBinary(text) {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 126) return true;
    if (c < 32 && c !== 9 && c !== 10 && c !== 13) return true;
  }
  return false;
}
// Escape body for BodyBinary= — encodes as C string safe for VuGen's attribute parser.
// Non-ASCII chars are emitted as UTF-8 bytes using \xHH sequences.
function escBodyBinary(text) {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 34)
      out += '\\"'; // " → \"
    else if (c === 92)
      out += "\\\\"; // \ → \\
    else if (c === 9)
      out += "\\t"; // tab
    else if (c === 10)
      out += "\\n"; // LF
    else if (c === 13)
      out += "\\r"; // CR
    else if (c < 32)
      out += "\\x" + c.toString(16).padStart(2, "0").toUpperCase(); // other ctrl
    else if (c < 127)
      out += text[i]; // printable ASCII
    else if (c < 0x800) {
      // 2-byte UTF-8 (U+0080..U+07FF)
      out +=
        "\\x" +
        (0xc0 | (c >> 6)).toString(16).toUpperCase().padStart(2, "0");
      out +=
        "\\x" +
        (0x80 | (c & 0x3f)).toString(16).toUpperCase().padStart(2, "0");
    } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      // surrogate pair → 4-byte UTF-8
      const lo = text.charCodeAt(i + 1);
      if (lo >= 0xdc00 && lo <= 0xdfff) {
        const cp = 0x10000 + ((c - 0xd800) << 10) + (lo - 0xdc00);
        out +=
          "\\x" +
          (0xf0 | (cp >> 18)).toString(16).toUpperCase().padStart(2, "0");
        out +=
          "\\x" +
          (0x80 | ((cp >> 12) & 0x3f))
            .toString(16)
            .toUpperCase()
            .padStart(2, "0");
        out +=
          "\\x" +
          (0x80 | ((cp >> 6) & 0x3f))
            .toString(16)
            .toUpperCase()
            .padStart(2, "0");
        out +=
          "\\x" +
          (0x80 | (cp & 0x3f))
            .toString(16)
            .toUpperCase()
            .padStart(2, "0");
        i++; // consume low surrogate
      }
    } else {
      // 3-byte UTF-8 (U+0800..U+FFFF)
      out +=
        "\\x" +
        (0xe0 | (c >> 12)).toString(16).toUpperCase().padStart(2, "0");
      out +=
        "\\x" +
        (0x80 | ((c >> 6) & 0x3f))
          .toString(16)
          .toUpperCase()
          .padStart(2, "0");
      out +=
        "\\x" +
        (0x80 | (c & 0x3f)).toString(16).toUpperCase().padStart(2, "0");
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════
// EXTRACTOR CODE GENERATORS
// ═══════════════════════════════════════════════════════════════════════════
// DevWeb (and VuGen) have a built-in cookie jar that automatically stores
// Set-Cookie values and sends them in subsequent Cookie headers.  A correlation
// whose ONLY usages are in Cookie request headers therefore needs zero code —
// the runtime handles it end-to-end.
//
// Suppression is based purely on usage locations, NOT extractorType.
// In 2-HAR diff mode a cookie value may be sourced from a JSON body
// (extractorType "boundary"/"jsonpath") yet still only appear in Cookie
// request headers — extractorType is irrelevant; all that matters is that
// no usage requires a script-level substitution.
//
// Exception: if any usage is "url_path" (;jsessionid=xxx) or "header" or
// "body_*", the value IS referenced in the generated code — keep the corr.
function isSuppressibleCookieCorr(c) {
  if (!c.usages || c.usages.length === 0) return false;
  return c.usages.every((u) => u.location === "cookie");
}
// Returns the bare constructor expression for an extractor (no indentation).
// Used by both genCorrelationsJS (file declarations) and devwebExtractorCode (inline).
function devwebExtractorDecl(corr) {
  const { name, extractorType, extractorConfig: cfg } = corr;
  switch (extractorType) {
    case "jsonpath":
      return `new load.JsonPathExtractor("${name}", "${cfg.path}")`;
    case "cookie":
      return `new load.CookieExtractor("${name}", {cookieName: "${cfg.cookieName}"})`;
    case "html":
      return `new load.HtmlExtractor("${name}", "${cfg.selector}", "${cfg.attr || "value"}")`;
    case "boundary_header":
      return `new load.BoundaryExtractor("${name}", {leftBoundary: "${escJs(cfg.lb)}", rightBoundary: "${escJs(cfg.rb)}", scope: load.ExtractorScope.Headers})`;
    case "generate":
      return null;
    case "boundary":
    default:
      return `new load.BoundaryExtractor("${name}", {leftBoundary: "${escJs(cfg.lb)}", rightBoundary: "${escJs(cfg.rb)}", scope: load.ExtractorScope.Body})`;
  }
}

function devwebExtractorCode(corr) {
  const decl = devwebExtractorDecl(corr);
  return decl ? `            ${decl}` : null;
}

// Generates correlations.js — all response extractor declarations, exported for main.js.
// Returns null when there are no applicable correlations.
function genCorrelationsJS(correlations) {
  const relevant = correlations.filter(
    (c) => c.extractorType !== "generate" && !isSuppressibleCookieCorr(c),
  );
  if (relevant.length === 0) return null;

  let o = "// correlations.js — Auto-generated by VuGen Script Studio\n";
  o += "// Response extractors shared across all action blocks in main.js.\n";
  o += "// 'load' is globally available in the DevWeb runtime — no import needed.\n\n";

  for (const c of relevant) {
    const decl = devwebExtractorDecl(c);
    if (decl) o += `const ${c.name}Extractor = ${decl};\n`;
  }

  o += "\nmodule.exports = {\n";
  for (const c of relevant) {
    if (devwebExtractorDecl(c)) o += `    ${c.name}Extractor,\n`;
  }
  o += "};\n";
  return o;
}

// ── Dynamic date detection & substitution ─────────────────────────────────
// Detects date-pattern values in HAR query params and request bodies, and
// substitutes them with runtime helper function calls so generated scripts
// use dates relative to today rather than hard-coded recording-time dates.
//
// Supported patterns (all checked against the HAR recording timestamp):
//   YYYY-MM-DD        → getTodayDate() / getDateDaysAgo(N) / getFutureDateDays(N)
//   ISO datetime Z    → getTodayStartUTC() / getTodayEndUTC() / getDateDaysAgoUTC(N)
//   13-digit epoch ms → getEpochMsDaysAgo(N)
//   10-digit epoch s  → getEpochSecsDaysAgo(N)
// Values outside ±730 days of the recording date are left as static strings.

const _DATE_ISO_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
const _DATE_ISODT_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])T\d{2}:\d{2}:\d{2}/;
const _DATE_EPOCH_MS_RE = /^\d{13}$/;
const _DATE_EPOCH_SEC_RE = /^1\d{9}$/;
// Non-padded datetime: "2026-5-15 23:59:59" / "2026-4-15 0:0:0" (HP ALM/PC graph filter format)
const _DATE_NPAD_DT_RE = /^\d{4}-\d{1,2}-\d{1,2}[T ]\d{1,2}:\d{1,2}:\d{1,2}(?:\.\d+)?$/;
// RFC 1123 / HTTP Date: "Fri, 15 May 2026 08:55:32 GMT"
const _DATE_RFC1123_RE = /^[A-Za-z]{3},\s+\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}:\d{2}\s+GMT$/;
// Embedded non-padded datetime pattern source (no g flag — regex created with g inside functions)
const _DATE_NPAD_EMBED_SRC = "\\d{4}-\\d{1,2}-\\d{1,2}[T ]\\d{1,2}:\\d{1,2}:\\d{1,2}(?:\\.\\d+)?";
const _DATE_MAX_DAYS = 730; // ignore dates outside 2-year window from recording date

// Returns {fn, arg} describing the runtime call to reproduce this value, or null.
// value: string or number; recordingMs: epoch ms of the HAR recording start.
// entryMs: optional, the HAR entry's own start time (used for RFC 1123 current-time detection).
function detectDateSubstitution(value, recordingMs, entryMs) {
  if (!recordingMs || value === undefined || value === null) return null;
  const str = String(value).trim();
  if (!str) return null;

  if (_DATE_ISO_RE.test(str)) {
    const d = new Date(str + "T00:00:00Z");
    if (isNaN(d.getTime())) return null;
    const recDay = new Date(recordingMs);
    recDay.setUTCHours(0, 0, 0, 0);
    const offsetDays = Math.round((recDay.getTime() - d.getTime()) / 86400000);
    if (Math.abs(offsetDays) > _DATE_MAX_DAYS) return null;
    if (offsetDays === 0) return { fn: "getTodayDate", arg: null };
    if (offsetDays > 0) return { fn: "getDateDaysAgo", arg: offsetDays };
    return { fn: "getFutureDateDays", arg: -offsetDays };
  }

  if (_DATE_ISODT_RE.test(str)) {
    let d;
    try { d = new Date(str); } catch { return null; }
    if (isNaN(d.getTime())) return null;
    const recDay = new Date(recordingMs);
    recDay.setUTCHours(0, 0, 0, 0);
    const dDay = new Date(d.getTime());
    dDay.setUTCHours(0, 0, 0, 0);
    const offsetDays = Math.round((recDay.getTime() - dDay.getTime()) / 86400000);
    if (Math.abs(offsetDays) > _DATE_MAX_DAYS) return null;
    // Month-boundary detection: first/last day of the recording month
    const recDate = new Date(recordingMs);
    if (d.getUTCFullYear() === recDate.getUTCFullYear() && d.getUTCMonth() === recDate.getUTCMonth()) {
      if (d.getUTCDate() === 1 && d.getUTCHours() === 0 && d.getUTCMinutes() === 0) {
        return { fn: "getStartOfCurrentMonthUTC", arg: null };
      }
      const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
      if (d.getUTCDate() === lastDay && d.getUTCHours() >= 22 && d.getUTCMinutes() >= 59) {
        return { fn: "getEndOfCurrentMonthUTC", arg: null };
      }
    }
    const isEnd = d.getUTCHours() === 23 && d.getUTCMinutes() >= 59 && d.getUTCSeconds() >= 59;
    if (offsetDays === 0) return isEnd ? { fn: "getTodayEndUTC", arg: null } : { fn: "getTodayStartUTC", arg: null };
    if (offsetDays > 0) return { fn: "getDateDaysAgoUTC", arg: offsetDays };
    return null; // future datetime — leave as static
  }

  if (_DATE_EPOCH_MS_RE.test(str)) {
    const ms = parseInt(str, 10);
    // Check local-time midnight / end-of-day first (getStartDateMillis / getEndDateMillis)
    const _dLocal = new Date(ms);
    const _lhr = _dLocal.getHours(), _lmn = _dLocal.getMinutes(), _lsc = _dLocal.getSeconds();
    const _isLocalStart = _lhr === 0 && _lmn === 0 && _lsc === 0;
    const _isLocalEnd   = _lhr === 23 && _lmn === 59 && _lsc >= 59;
    if (_isLocalStart || _isLocalEnd) {
      const recDayL = new Date(recordingMs); recDayL.setHours(0, 0, 0, 0);
      const dDayL   = new Date(ms);          dDayL.setHours(0, 0, 0, 0);
      const localOff = Math.round((recDayL.getTime() - dDayL.getTime()) / 86400000);
      if (localOff < 0 || localOff > _DATE_MAX_DAYS) return null;
      if (_isLocalEnd) return { fn: "getEndDateMillis", arg: null };
      return { fn: "getStartDateMillis", arg: localOff > 0 ? localOff : null };
    }
    // UTC-based epoch ms fallback
    const recDay = new Date(recordingMs);
    recDay.setUTCHours(0, 0, 0, 0);
    const dDay = new Date(ms);
    dDay.setUTCHours(0, 0, 0, 0);
    const offsetDays = Math.round((recDay.getTime() - dDay.getTime()) / 86400000);
    if (Math.abs(offsetDays) > _DATE_MAX_DAYS || offsetDays < 0) return null;
    return { fn: "getEpochMsDaysAgo", arg: offsetDays };
  }

  if (_DATE_EPOCH_SEC_RE.test(str)) {
    const ms = parseInt(str, 10) * 1000;
    const recDay = new Date(recordingMs);
    recDay.setUTCHours(0, 0, 0, 0);
    const dDay = new Date(ms);
    dDay.setUTCHours(0, 0, 0, 0);
    const offsetDays = Math.round((recDay.getTime() - dDay.getTime()) / 86400000);
    if (Math.abs(offsetDays) > _DATE_MAX_DAYS || offsetDays < 0) return null;
    return { fn: "getEpochSecsDaysAgo", arg: offsetDays };
  }

  // Non-padded datetime: "2026-5-15 23:59:59" / "2026-4-15 0:0:0" (HP ALM/PC graph filter format)
  if (_DATE_NPAD_DT_RE.test(str)) {
    const spIdx = str.search(/[T ]/);
    if (spIdx < 0) return null;
    const dp = str.slice(0, spIdx).split("-").map(Number);
    const tp = str.slice(spIdx + 1).split(":").map(Number);
    if (dp.length < 3 || tp.length < 3) return null;
    const [yr, mo, dy] = dp;
    const [hr, mn, sc] = tp;
    const d = new Date(Date.UTC(yr, mo - 1, dy));
    if (isNaN(d.getTime())) return null;
    const recDay = new Date(recordingMs);
    recDay.setUTCHours(0, 0, 0, 0);
    const offsetDays = Math.round((recDay.getTime() - d.getTime()) / 86400000);
    if (Math.abs(offsetDays) > _DATE_MAX_DAYS) return null;
    const isEnd = hr === 23 && mn >= 59 && sc >= 59;
    const isStart = hr === 0 && mn === 0 && sc === 0;
    if (isEnd && offsetDays >= 0) return { fn: "getEndDateForGraph", arg: null };
    if (isStart && offsetDays >= 0) return { fn: "getStartDateForGraph", arg: offsetDays };
    return null;
  }

  // RFC 1123 / HTTP Date: "Fri, 15 May 2026 08:55:32 GMT"
  if (_DATE_RFC1123_RE.test(str)) {
    let d;
    try { d = new Date(str); } catch { return null; }
    if (isNaN(d.getTime())) return null;
    // Use entry-level time for offset calculation when available (more accurate than recording start)
    const refMs = entryMs || recordingMs;
    const recDay = new Date(refMs);
    recDay.setUTCHours(0, 0, 0, 0);
    const dDay = new Date(d.getTime());
    dDay.setUTCHours(0, 0, 0, 0);
    // offsetDays: positive = future relative to recording day
    const offsetDays = Math.round((dDay.getTime() - recDay.getTime()) / 86400000);
    if (Math.abs(offsetDays) > _DATE_MAX_DAYS) return null;
    const hr = d.getUTCHours(), mn = d.getUTCMinutes(), sc = d.getUTCSeconds();
    // Accept hr >= 22 for end-of-day to handle UTC+1 timezone (22:59:59 UTC = 23:59:59 local)
    const isEnd = hr >= 22 && mn >= 59 && sc >= 59;
    // Accept hr === 0 (UTC) or hr === 23 (UTC+1 midnight = start of local day)
    const isUTCStart = hr === 0 && mn === 0 && sc === 0;
    const isUTCPlusOneStart = hr === 23 && mn === 0 && sc === 0;
    if (isEnd && offsetDays > 0) return { fn: "getEndOfFutureDayUTC", arg: offsetDays };
    if (isEnd) return { fn: "getEndOfTodayUTC", arg: null };
    if (isUTCStart && offsetDays === 0) return { fn: "getStartOfTodayUTC", arg: null };
    // UTC+1 midnight: 23:00 UTC on day N = start of day N+1 in UTC+1 local time
    if (isUTCPlusOneStart && offsetDays <= -1) {
      const daysAgo = -(offsetDays + 1);
      return { fn: "getStartDaysAgoUTC", arg: daysAgo > 0 ? daysAgo : null };
    }
    // "Current time" — only when entryMs is provided and value is within 5 min of the entry's recording time
    if (entryMs && Math.abs(d.getTime() - entryMs) < 300000) return { fn: "getCurrentTimeUTC", arg: null };
    return null;
  }

  return null;
}

// Scan a complex string value for embedded non-padded datetime substrings and replace them
// with ${fn()} template expressions. Returns modified content (safe inside a template literal)
// or null if no date substrings were found.
function substituteEmbeddedDates(str, recordingMs) {
  if (!recordingMs || !str || str.length < 10) return null;
  const re = new RegExp(_DATE_NPAD_EMBED_SRC, "g");
  const replacements = [];
  let m;
  while ((m = re.exec(str)) !== null) {
    const frag = m[0];
    const ds = detectDateSubstitution(frag, recordingMs);
    if (ds) {
      const call = ds.arg !== null ? `${ds.fn}(${ds.arg})` : `${ds.fn}()`;
      replacements.push({ frag, call });
    }
  }
  if (replacements.length === 0) return null;
  let out = escTpl(str);
  for (const { frag, call } of replacements) {
    const safe = frag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp(safe, "g"), `\${${call}}`);
  }
  return out;
}

// Pre-scan all entries (read-only) and return the Set of date helper function names needed.
// Called before genMainJS output starts so we know what to emit at module level.
function prescanDateHelpers(entries, recordingMs) {
  const fns = new Set();
  if (!recordingMs) return fns;
  function chk(v, entryMs) {
    if (typeof v !== "string" || !v) return;
    const ds = detectDateSubstitution(v, recordingMs, entryMs);
    if (ds) { fns.add(ds.fn); return; }
    // Also scan for non-padded datetime patterns embedded in complex string values
    const re = new RegExp(_DATE_NPAD_EMBED_SRC, "g");
    let m;
    while ((m = re.exec(v)) !== null) {
      const eDs = detectDateSubstitution(m[0], recordingMs);
      if (eDs) fns.add(eDs.fn);
    }
  }
  for (const e of entries) {
    if (e.filtered || e.isMarker) continue;
    // Query params — pass entry's own startMs for RFC 1123 current-time detection
    const qIdx = e.url ? e.url.indexOf("?") : -1;
    if (qIdx >= 0) {
      for (const pair of e.url.slice(qIdx + 1).split("&")) {
        const eqI = pair.indexOf("=");
        if (eqI < 0) continue;
        let val;
        try { val = decodeURIComponent(pair.slice(eqI + 1).replace(/\+/g, " ")); } catch { val = pair.slice(eqI + 1); }
        chk(val, e.startMs);
      }
    }
    // Request body
    if (e.body && e.body.text) {
      const mime = (e.body.mimeType || "").split(";")[0].trim();
      if (mime === "application/json" || mime === "text/json") {
        try {
          (function scanJ(v) {
            if (typeof v === "string") chk(v);
            else if (typeof v === "number") chk(String(v));
            else if (Array.isArray(v)) v.forEach(scanJ);
            else if (v && typeof v === "object") Object.values(v).forEach(scanJ);
          })(JSON.parse(e.body.text));
        } catch {}
      } else if (mime === "application/x-www-form-urlencoded") {
        for (const pair of e.body.text.split("&")) {
          const eqI = pair.indexOf("=");
          if (eqI < 0) continue;
          let val;
          try { val = decodeURIComponent(pair.slice(eqI + 1).replace(/\+/g, " ")); } catch { val = pair.slice(eqI + 1); }
          chk(val);
        }
      }
    }
  }
  return fns;
}

// Emit only the date helper function definitions that were actually used.
function emitDateHelpers(usedFns) {
  if (!usedFns || usedFns.size === 0) return "";
  const defs = {
    // ISO date (YYYY-MM-DD)
    getTodayDate:              "function getTodayDate() { return new Date().toISOString().split('T')[0]; }",
    getDateDaysAgo:            "function getDateDaysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return d.toISOString().split('T')[0]; }",
    getFutureDateDays:         "function getFutureDateDays(n) { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().split('T')[0]; }",
    // ISO UTC datetime
    getTodayStartUTC:          "function getTodayStartUTC() { const d = new Date(); d.setUTCHours(0,0,0,0); return d.toISOString(); }",
    getTodayEndUTC:            "function getTodayEndUTC() { const d = new Date(); d.setUTCHours(23,59,59,999); return d.toISOString(); }",
    getDateDaysAgoUTC:         "function getDateDaysAgoUTC(n) { const d = new Date(); d.setDate(d.getDate() - n); d.setUTCHours(0,0,0,0); return d.toISOString(); }",
    // ISO UTC month boundaries
    getStartOfCurrentMonthUTC: "function getStartOfCurrentMonthUTC() { const d = new Date(); d.setUTCDate(1); d.setUTCHours(0,0,0,0); return d.toISOString(); }",
    getEndOfCurrentMonthUTC:   "function getEndOfCurrentMonthUTC() { const d = new Date(); d.setUTCMonth(d.getUTCMonth()+1, 0); d.setUTCHours(23,59,59,999); return d.toISOString(); }",
    // Epoch milliseconds
    getEpochMsDaysAgo:         "function getEpochMsDaysAgo(n) { const d = new Date(); if (n) d.setDate(d.getDate() - n); d.setUTCHours(0,0,0,0); return d.getTime(); }",
    getEpochSecsDaysAgo:       "function getEpochSecsDaysAgo(n) { const d = new Date(); if (n) d.setDate(d.getDate() - n); d.setUTCHours(0,0,0,0); return Math.floor(d.getTime() / 1000); }",
    // Non-padded datetime (HP ALM/PC graph filter format: "2026-5-15 23:59:59")
    getEndDateForGraph:        "function getEndDateForGraph() { const d = new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()} 23:59:59`; }",
    getStartDateForGraph:      "function getStartDateForGraph(n) { const d = new Date(); if (n) d.setDate(d.getDate() - n); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()} 0:0:0`; }",
    // RFC 1123 / HTTP date format (used in timeslot queries)
    getCurrentTimeUTC:         "function getCurrentTimeUTC() { return new Date().toUTCString(); }",
    getEndOfTodayUTC:          "function getEndOfTodayUTC() { const d = new Date(); d.setUTCHours(23,59,59,999); return d.toUTCString(); }",
    getStartOfTodayUTC:        "function getStartOfTodayUTC() { const d = new Date(); d.setUTCHours(0,0,0,0); return d.toUTCString(); }",
    getStartDaysAgoUTC:        "function getStartDaysAgoUTC(n) { const d = new Date(); if (n) d.setDate(d.getDate() - n); d.setUTCHours(0,0,0,0); return d.toUTCString(); }",
    getEndOfFutureDayUTC:      "function getEndOfFutureDayUTC(n) { const d = new Date(); d.setDate(d.getDate() + n); d.setUTCHours(23,59,59,999); return d.toUTCString(); }",
    // Local-time epoch milliseconds (fromDate / toDate in booking/scheduler systems)
    getStartDateMillis:        "function getStartDateMillis(n) { const d = new Date(); if (n) d.setDate(d.getDate() - n); d.setHours(0,0,0,0); return d.getTime(); }",
    getEndDateMillis:          "function getEndDateMillis() { const d = new Date(); d.setHours(23,59,59,999); return d.getTime(); }",
  };
  const ordered = Object.keys(defs).filter((fn) => usedFns.has(fn));
  if (ordered.length === 0) return "";
  let out = "// Date helpers — compute dates relative to today at runtime\n";
  for (const fn of ordered) out += defs[fn] + "\n";
  return out + "\n";
}

// ── Basic auth credential detection ───────────────────────────────────────────
// When Authorization: Basic <base64(user:pass)> appears in the HAR, the generator
// emits `const encodedCredentials = btoa(...)` at module level and substitutes the
// raw base64 value everywhere it appears (auth header, request body, query params).
// Returns {b64, userKey, passKey} or null.  userKey/passKey are the load.params CSV
// keys to use; matched against S.params values if available, otherwise "username"/"password".
function prescanBasicAuth(entries) {
  if (!S.auth || ["ntlm", "kerberos", "negotiate"].includes(S.auth.type)) return null;
  for (const e of entries) {
    if (e.filtered || e.isMarker) continue;
    for (const hdr of e.reqHdrs || []) {
      if (hdr.name.toLowerCase() !== "authorization") continue;
      const bm = /^Basic\s+([A-Za-z0-9+/=]{8,})\s*$/i.exec(hdr.value);
      if (!bm) continue;
      let decoded;
      try { decoded = atob(bm[1]); } catch { continue; }
      const ci = decoded.indexOf(":");
      if (ci <= 0) continue;
      const decodedUser = decoded.slice(0, ci);
      const decodedPass = decoded.slice(ci + 1);
      let userKey = "username", passKey = "password";
      if (S.params) {
        const uParam = S.params.find((p) => p.value === decodedUser);
        const pParam = S.params.find((p) => p.value === decodedPass);
        if (uParam) userKey = uParam.csvKey;
        if (pParam) passKey = pParam.csvKey;
      }
      return { b64: bm[1], userKey, passKey };
    }
  }
  return null;
}

// ── Auto-follow redirect detection ────────────────────────────────────────────
// Entry i was auto-followed if its URL matches the Location header of the
// previous real entry, and that entry had a redirect status (300-303, 307).
// Extractors from auto-follow entries are re-anchored to the triggering entry.
// Web HTTP/HTML: web_reg_save_param placed before anchor scans ALL responses in chain
// (IgnoreRedirections=No default) — finds value in the final redirect's response body.
// DevWeb: extractor on triggering request sees final response automatically.
function buildAutoFollowMap(entries) {
  const autoFollowSet = new Set();
  for (let i = 1; i < entries.length; i++) {
    const curr = entries[i];
    if (curr.filtered || curr.isMarker) continue;
    let prevI = i - 1;
    while (
      prevI >= 0 &&
      (entries[prevI].filtered || entries[prevI].isMarker)
    )
      prevI--;
    if (prevI < 0) continue;
    const prev = entries[prevI];
    // 300-303, 307, 308 are browser-auto-followed redirects
    if (
      ![301, 302, 303, 307, 308].includes(prev.status) &&
      prev.status !== 300
    )
      continue;
    const locVal = (prev.respHdrsMap || {})["location"];
    if (!locVal) continue;
    try {
      const loc = new URL(locVal, prev.url);
      const tgt = new URL(curr.url);
      // Compare origin + pathname, then query via URLSearchParams (handles %-encoding differences)
      if (loc.origin === tgt.origin && loc.pathname === tgt.pathname) {
        const lp = [...new URLSearchParams(loc.search)].sort((a, b) =>
          a[0] < b[0] ? -1 : 1,
        );
        const tp = [...new URLSearchParams(tgt.search)].sort((a, b) =>
          a[0] < b[0] ? -1 : 1,
        );
        if (
          lp.length === tp.length &&
          lp.every((p, k) => p[0] === tp[k][0] && p[1] === tp[k][1])
        )
          autoFollowSet.add(i);
      }
    } catch {
      if (locVal === curr.url || curr.url.endsWith(locVal))
        autoFollowSet.add(i);
    }
  }
  // Also detect 401 challenge entries: same URL+method re-issued after 401.
  // VuGen handles 401→Negotiate/NTLM automatically via web_set_user() — skip the 401 entry,
  // keep only the successful (non-401) response entry.
  for (let i = 0; i < entries.length - 1; i++) {
    const curr = entries[i];
    if (curr.filtered || curr.isMarker || curr.status !== 401) continue;
    let nextI = i + 1;
    while (
      nextI < entries.length &&
      (entries[nextI].filtered || entries[nextI].isMarker)
    )
      nextI++;
    if (nextI >= entries.length) continue;
    const next = entries[nextI];
    try {
      if (
        new URL(next.url).href === new URL(curr.url).href &&
        next.method === curr.method
      )
        autoFollowSet.add(i);
    } catch {
      if (next.url === curr.url && next.method === curr.method)
        autoFollowSet.add(i);
    }
  }

  const anchorOf = {};
  for (const i of autoFollowSet) {
    let j = i - 1;
    while (
      j >= 0 &&
      (autoFollowSet.has(j) || entries[j].filtered || entries[j].isMarker)
    )
      j--;
    anchorOf[i] = j >= 0 ? j : 0;
  }
  return { autoFollowSet, anchorOf };
}

function webHttpCorrCode(corr, indent) {
  const { name, extractorType, extractorConfig: cfg } = corr;
  const t = indent || "\t";
  switch (extractorType) {
    case "jsonpath":
      return VugenCodegen.emitJson(name, cfg.path, t);

    case "cookie":
      // web_reg_save_param_cookie does NOT exist — extract from Set-Cookie header boundary.
      return VugenCodegen.emitBoundary(name, {
        lb: `${cfg.cookieName}=`, rb: ';', search: 'Headers', ord: 1,
      }, t);

    case "html": {
      // Map CSS selector + attr back to LB/RB boundary (no HTML extractor in VuGen C API)
      const sel = cfg.selector || "";
      const attr = cfg.attr || "value";
      const dataM = sel.match(/^\[data-([a-z][a-z0-9-]*)\]$/i);
      if (dataM) {
        return VugenCodegen.emitBoundary(name, {
          lb: `data-${dataM[1]}="`, rb: '"', ord: 1,
        }, t);
      }
      const metaM = sel.match(/^meta\[name=['"]([^'"]+)['"]\]$/i);
      if (metaM) {
        return VugenCodegen.emitBoundary(name, {
          lb: `name="${escJs(metaM[1])}" content="`, rb: '"', ord: 1,
        }, t);
      }
      const nameM = sel.match(/\[name=['"]([^'"]+)['"]\]/);
      const fieldName = nameM ? nameM[1] : sel;
      return VugenCodegen.emitBoundary(name, {
        lb: `name="${escJs(fieldName)}" ${attr}="`, rb: '"', ord: 1,
      }, t);
    }

    case "boundary_header":
      return VugenCodegen.emitBoundary(name, {
        lb: cfg.lb, rb: '\r\n', search: 'Headers', ord: 1,
      }, t);

    case "generate": {
      // Client-side token generation — lr_param_sprintf, not a web_reg_save_param call
      const pat = cfg.pattern || "alphanumeric";
      if (pat === "uuid")
        return `${t}lr_param_sprintf("${name}",\n${t}\t"%08x-%04x-4%03x-%04x-%04x%08x",\n${t}\trand(), rand()&0xffff, rand()&0x0fff, (rand()&0x3fff)|0x8000, rand()&0xffff, rand());\n`;
      if (pat === "hex64")
        return `${t}lr_param_sprintf("${name}",\n${t}\t"%08x%08x%08x%08x%08x%08x%08x%08x",\n${t}\trand(),rand(),rand(),rand(),rand(),rand(),rand(),rand());\n`;
      if (pat === "hex32")
        return `${t}lr_param_sprintf("${name}",\n${t}\t"%08x%08x%08x%08x",\n${t}\trand(),rand(),rand(),rand());\n`;
      if (pat === "hex16")
        return `${t}lr_param_sprintf("${name}",\n${t}\t"%08x%08x",\n${t}\trand(),rand());\n`;
      {
        const len = cfg.length || 19;
        const full8 = Math.floor(len / 8);
        const rem = len % 8;
        let fmt = "";
        const args = [];
        for (let i = 0; i < full8; i++) { fmt += "%08x"; args.push("rand()"); }
        if (rem > 0) { fmt += `%0${rem}x`; args.push("rand()"); }
        return `${t}lr_param_sprintf("${name}",\n${t}\t"${fmt}",\n${t}\t${args.join(",")});\n`;
      }
    }

    case "boundary":
    default:
      return VugenCodegen.emitBoundary(name, {
        lb: cfg.lb, rb: cfg.rb || '"', ord: 1,
      }, t);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// HEADER FILTER (same as VuGen-Recorder)
// ═══════════════════════════════════════════════════════════════════════════
function filtHdrs(e) {
  const h = {};
  for (const hdr of e.reqHdrs || []) {
    const k = hdr.name.toLowerCase();
    if (!SKIP_HDRS.has(k) && !k.startsWith(":")) h[hdr.name] = hdr.value;
  }
  return h;
}

function rqName(url) {
  try {
    const p = new URL(url);
    const segs = p.pathname.split("/").filter(Boolean);
    let r = segs[segs.length - 1] || p.hostname.split(".")[0] || "req";
    r =
      r
        .replace(/\.[^.]+$/, "")
        .replace(/[^a-zA-Z0-9]/g, "_")
        .replace(/^_+|_+$/g, "")
        .replace(/_+/g, "_")
        .substring(0, 30) || "request";
    if (/^\d/.test(r)) r = "req_" + r;
    return r;
  } catch {
    return "request";
  }
}

// Check whether a form/body field key is a known user-input parameter (not a server-generated token).
// Strips dot-prefix (order.creditCard → creditCard) and colon-prefix before matching PARAM_KEYS_MAP.
// Returns the matching entry or null.
function matchParamKey(key) {
  const keysToTry = [key];
  const dotIdx = key.lastIndexOf(".");
  if (dotIdx >= 0) {
    const s = key.substring(dotIdx + 1);
    if (s) keysToTry.push(s);
  }
  const colonIdx = key.lastIndexOf(":");
  if (colonIdx >= 0) {
    const s = key.substring(colonIdx + 1);
    if (s) keysToTry.push(s);
  }
  for (const pm of PARAM_KEYS_MAP) {
    if (keysToTry.some((k) => pm.pattern.test(k))) return pm;
  }
  return null;
}

function detectParams(entries, correlations) {
  // Build set of all values already handled as correlations (skip those)
  const corrValues = new Set();
  for (const c of correlations) {
    if (c.value1) corrValues.add(c.value1);
    if (c.value) corrValues.add(c.value);
    for (const u of c.usages || []) {
      if (u.originalValue) corrValues.add(u.originalValue);
      if (u.tokenValue) corrValues.add(u.tokenValue);
    }
  }
  for (const c of S.candidates || []) {
    if (c.fullValue) corrValues.add(c.fullValue);
    if (c.value) corrValues.add(c.value);
  }

  const params = [];
  const seen = new Map(); // csvKey → index in params

  function processField(reqIdx, key, value, location) {
    if (!value || value.length === 0) return;
    if (
      [
        "0",
        "1",
        "false",
        "true",
        "on",
        "off",
        "yes",
        "no",
        "null",
        "undefined",
      ].includes(String(value).toLowerCase())
    )
      return;
    if (String(value).length < 2) return;
    const sv = String(value);
    if (
      corrValues.has(sv) ||
      corrValues.has(decodeURIComponent(sv)) ||
      corrValues.has(encodeURIComponent(sv))
    )
      return;
    // Allow known user-input param fields (creditCard, username, etc.) to bypass the isDynamic gate.
    // These are user-entered values that look like tokens (e.g. 16-digit card = numericId) but are
    // never in a server response — they must be parameterised, not correlated.
    if (isDynamic(sv) && !matchParamKey(key)) return;
    // Try full key, dot-suffix ("order.creditCard"→"creditCard"), and colon-suffix ("f:cust:firstName"→"firstName")
    const keysToTry = [key];
    const dotIdx = key.lastIndexOf(".");
    if (dotIdx >= 0) {
      const s = key.substring(dotIdx + 1);
      if (s && !keysToTry.includes(s)) keysToTry.push(s);
    }
    const colonIdx = key.lastIndexOf(":");
    if (colonIdx >= 0) {
      const s = key.substring(colonIdx + 1);
      if (s && !keysToTry.includes(s)) keysToTry.push(s);
    }
    for (const pm of PARAM_KEYS_MAP) {
      if (keysToTry.some((k) => pm.pattern.test(k))) {
        if (seen.has(pm.csvKey)) {
          const idx = seen.get(pm.csvKey);
          const already = params[idx].usages.some(
            (u) => u.reqIdx === reqIdx && u.key === key,
          );
          if (!already)
            params[idx].usages.push({ reqIdx, key, location });
        } else {
          const ni = params.length;
          params.push({
            name: pm.name,
            csvKey: pm.csvKey,
            value: sv,
            usages: [{ reqIdx, key, location }],
          });
          seen.set(pm.csvKey, ni);
        }
        break;
      }
    }
  }

  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx];
    if (e.filtered || e.isMarker) continue;
    if (e.body && e.body.text) {
      const mime = (e.body.mimeType || "").toLowerCase();
      if (!mime.includes("json")) {
        try {
          const p = new URLSearchParams(e.body.text);
          p.forEach((v, k) => processField(idx, k, v, "body_form"));
        } catch {}
      } else {
        try {
          function _scanJson(o) {
            if (!o || typeof o !== "object") return;
            for (const [k, v] of Object.entries(o)) {
              if (typeof v === "string")
                processField(idx, k, v, "body_json");
              else if (v && typeof v === "object") _scanJson(v);
            }
          }
          _scanJson(JSON.parse(e.body.text));
        } catch {}
      }
    }
    if (e.body && e.body.params) {
      for (const p of e.body.params)
        processField(idx, p.name, p.value, "body_form");
    }
    try {
      const u = new URL(e.url);
      u.searchParams.forEach((v, k) => processField(idx, k, v, "query"));
    } catch {}
  }
  return params;
}

// ═══════════════════════════════════════════════════════════════════════════
// PARAMETER FILE GENERATORS
// ═══════════════════════════════════════════════════════════════════════════
function genParamsYml() {
  if (!S.params || S.params.length === 0) return "parameters: []\n";
  let o = "parameters:\n";
  for (const p of S.params) {
    o += `  - name: ${p.csvKey}\n    type: csv\n    fileName: collection_data.csv\n`;
    o += `    columnName: ${p.csvKey}\n    nextValue: iteration\n    nextRow: sequential\n    onEnd: loop\n`;
  }
  return o;
}

function genParamFilePrm() {
  if (!S.params || S.params.length === 0) return "";
  let o = "";
  for (const p of S.params) {
    const origVal = String(p.value || "").replace(/"/g, '\\"');
    o += `[parameter:${p.csvKey}]\n`;
    o += `ColumnName="${p.csvKey}"\n`;
    o += `Delimiter=","\n`;
    o += `GenerateNewVal="EachIteration"\n`;
    o += `OriginalValue="${origVal}"\n`;
    o += `OutOfRangePolicy="ContinueWithLast"\n`;
    o += `ParamName="${p.csvKey}"\n`;
    o += `SelectNextRow="Sequential"\n`;
    o += `StartRow="1"\n`;
    o += `Table="collection_data.dat"\n`;
    o += `TableLocation="Local"\n`;
    o += `Type="Table"\n`;
    o += `auto_allocate_block_size="1"\n`;
    o += `value_for_each_vuser=""\n`;
    o += "\n";
  }
  return o;
}

function genCollectionDataCsv() {
  if (!S.params || S.params.length === 0) return "";
  const header = S.params.map((p) => p.csvKey).join(",");
  const row = S.params
    .map((p) =>
      p.value.includes(",") || p.value.includes('"')
        ? `"${p.value.replace(/"/g, '""')}"`
        : p.value,
    )
    .join(",");
  return header + "\n" + row + "\n";
}

// ═══════════════════════════════════════════════════════════════════════════
// Groups HAR entries that fired concurrently (time-interval overlap) into Promise.all blocks.
// autoFollowSet: Set<idx> of redirect/challenge entries excluded from the generated script.
// excludeSet:    Set<idx> of entries that must remain sequential (DPoP proofs, extractor captures).
// Returns Map<idx, {size, pos}> — only entries in groups of size >= 2 are present.
function buildConcurrentGroups(entries, autoFollowSet, excludeSet) {
  const groupMap = new Map();
  let buf = [];
  let maxEnd = 0;

  function flush() {
    if (buf.length >= 2) {
      buf.forEach((idx, pos) => groupMap.set(idx, { size: buf.length, pos }));
    }
    buf = []; maxEnd = 0;
  }

  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.isMarker || e.filtered || autoFollowSet.has(i) || (excludeSet && excludeSet.has(i))) {
      flush(); continue;
    }
    // Navigation requests always break groups — they trigger the concurrent burst after them
    if ((e.hdrsMap && e.hdrsMap["sec-fetch-mode"]) === "navigate") { flush(); continue; }
    const startMs = e.startMs || 0;
    if (!startMs) { flush(); continue; } // no HAR timing (NetLog) → sequential
    const endMs = startMs + Math.max(e.dur || 0, 1);
    if (buf.length === 0 || startMs < maxEnd) {
      buf.push(i);
      if (endMs > maxEnd) maxEnd = endMs;
    } else {
      flush();
      buf.push(i);
      maxEnd = endMs;
    }
  }
  flush();
  return groupMap;
}

// DEVWEB CODE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════
function genMainJS(entries, correlations) {
  let o = "";
  let rid = 1;
  let _dpopPfUsedMJ = false;
  const nc = {};

  // Build lookup maps
  const corrSources = new Map(); // reqIdx → [corr]
  const corrUsages = new Map(); // reqIdx → [{name,location,key,originalValue,prefix,tokenValue}]
  for (const corr of correlations) {
    if (!corrSources.has(corr.sourceIdx))
      corrSources.set(corr.sourceIdx, []);
    corrSources.get(corr.sourceIdx).push(corr);
    for (const u of corr.usages) {
      if (!corrUsages.has(u.reqIdx)) corrUsages.set(u.reqIdx, []);
      corrUsages.get(u.reqIdx).push({
        ...u,
        name: corr.name,
        extractorType: corr.extractorType,
      });
    }
  }

  // Pre-compute filtered correlations (used throughout this function)
  const nonGenCorrs = correlations.filter(
    (c) => c.extractorType !== "generate" && !isSuppressibleCookieCorr(c),
  );
  const hasCorrFile = nonGenCorrs.length > 0;

  // Date detection pre-scan — read-only pass to find which helper functions are needed
  const _dateRecMs =
    entries.find((e) => !e.isMarker && !e.filtered && e.startMs > 0)?.startMs || 0;
  const _dateFns = prescanDateHelpers(entries, _dateRecMs);

  // Basic auth credential pre-scan — detect Authorization: Basic <b64(user:pass)>
  const _basicAuth = prescanBasicAuth(entries);

  // Detect auto-follow redirect entries and remap their extractors to the anchor entry.
  // In DevWeb, load.WebRequest follows redirects automatically; the extractor placed
  // on the triggering request sees the final redirect's response body/headers.
  const { autoFollowSet: mjAutoFollowSet, anchorOf: mjAnchorOf } =
    buildAutoFollowMap(entries);
  // corrSourcesRemap: anchorIdx → [corr]  (extractors from skipped entries moved here)
  const corrSourcesRemap = new Map();
  for (const [idx, corrs] of corrSources) {
    const effectiveIdx = mjAutoFollowSet.has(idx)
      ? (mjAnchorOf[idx] ?? idx)
      : idx;
    if (!corrSourcesRemap.has(effectiveIdx))
      corrSourcesRemap.set(effectiveIdx, []);
    for (const c of corrs) {
      if (corrSourcesRemap.get(effectiveIdx).includes(c)) continue;
      // Skip extractor if ALL usages are in auto-follow entries — value never used in generated script
      if (
        c.usages &&
        c.usages.length > 0 &&
        c.usages.every((u) => mjAutoFollowSet.has(u.reqIdx))
      )
        continue;
      corrSourcesRemap.get(effectiveIdx).push(c);
    }
  }

  // Default headers from first visible request
  const firstE = entries.find(
    (e, i) => !e.filtered && !e.isMarker && !mjAutoFollowSet.has(i),
  );
  const defHdrs = firstE
    ? filtHdrs(firstE)
    : { "accept-language": "en-US,en;q=0.9" };
  // Build set of header keys that are dynamic (correlated or unresolved) — exclude from global defaults
  const dynHdrKeysMj = new Set();
  for (const corr of correlations) {
    for (const u of corr.usages) {
      if (u.location === "header")
        dynHdrKeysMj.add((u.key || "").toLowerCase());
    }
  }
  if (S.candidates) {
    for (const cand of S.candidates) {
      for (const cu of cand.usages) {
        if (cu.location === "header")
          dynHdrKeysMj.add((cu.key || "").toLowerCase());
      }
    }
  }
  // When Basic auth credentials are detected, manage the Authorization header explicitly
  // via encodedCredentials — do not treat it as a dynamic/candidate correlation.
  if (_basicAuth) dynHdrKeysMj.delete("authorization");

  // ── module-level declarations ─────────────────────────────────────────────
  const _shHostMj = S.serverHost ? S.serverHost.host : "";
  const mjHostVarMap = buildHdrHostMap(entries, _shHostMj);

  // DPoP helper require (module-level)
  if (S.hasDpop) {
    o +=
      "// DPoP Helper \u2014 EC P-256 key generation and DPoP proof signing\n";
    o += "const { getDpopProof } = require('./dpop-helper.js');\n";
  }
  // Correlations file \u2014 pre-declared extractors shared across all action blocks
  if (hasCorrFile) {
    o += "const corr = require('./correlations');\n";
  }
  if (S.hasDpop || hasCorrFile) o += "\n";

  // Host variables
  o += `let SERVER_HOST = '${_shHostMj}';\n`;
  Object.entries(mjHostVarMap)
    .filter(([, v]) => v !== "SERVER_HOST")
    .forEach(([h, v]) => {
      o += `let ${v} = '${h}';\n`;
    });
  o += "\nlet think_time = 1;\n\n";

  // Basic auth credentials — btoa computed once per VUser from parameterised username:password
  if (_basicAuth) {
    o += `const encodedCredentials = btoa(\`\${load.params.${_basicAuth.userKey}}:\${load.params.${_basicAuth.passKey}}\`);\n\n`;
  }

  // Default request options (module-level)
  o += "// Default request options\n";
  o += "load.WebRequest.defaults.returnBody = false;\n";
  o += "load.WebRequest.defaults.downloadHtmlStaticResources = true;\n";
  o += "load.WebRequest.defaults.headers = {\n";
  for (const [k, v] of Object.entries(defHdrs)) {
    // Skip headers that are dynamic (correlated or unresolved candidate) — handled per-request
    if (dynHdrKeysMj.has(k)) continue;
    // Suppress Negotiate/NTLM tokens — session-specific, handled by setUserCredentials
    if (
      k.toLowerCase() === "authorization" &&
      /^(negotiate|ntlm)\s/i.test(v)
    )
      continue;
    // Substitute any correlated value embedded inside a default header string
    let dv = v;
    let isDynDef = false;
    for (const c of correlations) {
      for (const u of c.usages) {
        const rawVal = u.tokenValue || u.originalValue;
        if (rawVal && dv.includes(rawVal)) {
          dv = dv.split(rawVal).join(`\x00DYNSTART_${c.name}\x00DYNEND`);
          isDynDef = true;
        }
      }
    }
    if (isDynDef) {
      const expr = escTpl(dv).replace(
        /\x00DYNSTART_([^]+?)\x00DYNEND/g,
        "${load.global.$1}",
      );
      o += `    "${escJs(k)}": \`${expr}\`,\n`;
    } else {
      o += `    "${escJs(k)}": ${subHdrValMj(v, mjHostVarMap)},\n`;
    }
  }
  o += "};\n\n";

  // Transaction declarations (module-level)
  const txnNames = S.txns.map((t) => t.name);
  const hasMarkers = txnNames.length > 0;
  o += "// Transaction declarations\n";
  if (hasMarkers) {
    txnNames.forEach((nm, i) => {
      const tsNum = String(i + 1).padStart(2, "0");
      const scName = `SC01_${tsNum}_${nm.replace(/^[Tt]\d+[_-]/, "").toUpperCase()}`;
      o += `let TS${tsNum} = new load.Transaction("${scName}");\n`;
    });
  } else {
    o += 'let TS01 = new load.Transaction("SC01_01_Transaction");\n';
  }
  o += "\n";

  // Global correlation variables (module-level) — cookie-only correlations suppressed
  // because the runtime cookie jar handles them automatically (no code needed).
  if (nonGenCorrs.length > 0) {
    o += "// Correlated dynamic values — extracted at runtime\n";
    for (const c of nonGenCorrs) o += `load.global.${c.name} = null;\n`;
    o += "\n";
  }
  if (S.candidates && S.candidates.length > 0) {
    const hdrCands = S.candidates.filter((c) =>
      c.usages.some((u) => u.location === "header"),
    );
    if (hdrCands.length > 0) {
      o +=
        "// Unresolved dynamic headers — add extractors on the responses that set these values\n";
      for (const cand of hdrCands) {
        const safeHint = sanitizeCandHint(cand.hint);
        o += `load.global.${safeHint} = null; // TODO: add extractor\n`;
      }
      o += "\n";
    }
    const otherCands = S.candidates.filter(
      (c) => !c.usages.some((u) => u.location === "header"),
    );
    if (otherCands.length > 0) {
      o +=
        "// TODO: Unresolved correlations — source response body was not captured in HAR.\n";
      o +=
        '// Re-record with DevTools "Disable cache" enabled (\u2699 \u2192 Disable cache) to trace source.\n';
      o +=
        "// Once the extraction source is identified, add a TextCheckExtractor or JsonPathExtractor\n";
      o +=
        "// to the response that returns the value, and assign it to load.global.<name>.\n";
      for (const cand of otherCands) {
        const safeHint = sanitizeCandHint(cand.hint);
        const usedAt = (cand.usages || [])
          .map((u) => u.reqUrl || u.reqIdx)
          .filter(Boolean)
          .slice(0, 2)
          .join(", ");
        o += `//   • ${safeHint} — used in: ${usedAt || "request body"}\n`;
      }
      o += "\n";
    }
  }

  // ── Module-level gen_* functions — declared before initialize so callable from any action ──
  const genCorrsMj = correlations.filter((c) => c.extractorType === "generate");
  if (genCorrsMj.length > 0) {
    o += "// Dynamic token generators — return a fresh value each time they are called\n";
    for (const c of genCorrsMj) {
      const pat = c.extractorConfig.pattern || "alphanumeric";
      const len = c.extractorConfig.length || 19;
      o += `function gen_${c.name}() {\n`;
      if (pat === "uuid") o += `    return load.utils.uuid();\n`;
      else if (pat === "hex64")
        o += `    return load.utils.randomString(64, {hex: true});\n`;
      else if (pat === "hex32")
        o += `    return load.utils.randomString(32, {hex: true});\n`;
      else if (pat === "hex16")
        o += `    return load.utils.randomString(16, {hex: true});\n`;
      else o += `    return load.utils.randomString(${len});\n`;
      o += `}\n`;
    }
    o += "\n";
  }

  // Date helper functions — only emitted when date patterns were found in the HAR
  o += emitDateHelpers(_dateFns);

  // ── initialize ────────────────────────────────────────────────────────────
  const AUTH_LABELS_JS = {
    kerberos: "Kerberos",
    ntlm: "NTLM",
    negotiate: "Negotiate (Kerberos/NTLM)",
    basic: "Basic",
    digest: "Digest",
  };
  o += 'load.initialize("Initialize", async function() {\n';
  o += '    load.log("Initializing Vuser " + load.config.user.userId, load.LogLevel.debug);\n';

  if (S.hasDpop) {
    o +=
      "    // DPoP key pair \u2014 generated once, reused for all proofs in this VUser\n";
    o += "    load.global.dpop_jwk = null;\n\n";
  }
  if (S.auth && AUTH_LABELS_JS[S.auth.type]) {
    const lbl = AUTH_LABELS_JS[S.auth.type];
    o += `    // ${lbl} Authentication\n`;
    if (S.auth.type === "kerberos" || S.auth.type === "negotiate") {
      o += `    // Runtime Settings: Replay -> enableIntegratedAuthentication: true\n`;
      o += `    // Runtime Settings: Replay -> useCanonicalNameInSPN: true\n`;
    } else if (S.auth.type === "ntlm") {
      o += `    // Runtime Settings: Replay -> enableIntegratedAuthentication: true\n`;
    }
    const hostArg =
      S.auth.type === "basic" || S.auth.type === "digest"
        ? '"*"'
        : `"${S.auth.host || "server"}"`;
    const isWinAuth =
      S.auth.type === "kerberos" ||
      S.auth.type === "ntlm" ||
      S.auth.type === "negotiate";
    o += `    load.setUserCredentials({\n`;
    o += `        username: load.params['username'],\n`;
    o += `        password: load.params['password'],\n`;
    if (isWinAuth) o += `        domain: load.params['domain'],\n`;
    o += `        host: ${hostArg}\n`;
    o += `    });\n\n`;
  }
  o += '    load.log("Initialization complete", load.LogLevel.debug);\n';
  o += "});\n\n";

  // ── action ────────────────────────────────────────────────────────────────
  o += 'load.action("Action", async function() {\n';
  o += '    load.log("Starting action - Iteration " + load.config.runtime.iteration, load.LogLevel.debug);\n';
  if (S.hasPkce) {
    o += "    // PKCE — generate fresh code_verifier + code_challenge for this iteration\n";
    o += "    {\n";
    o += "        const _pkceChars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';\n";
    o += "        const _vBytes = crypto.getRandomValues(new Uint8Array(32));\n";
    o += "        load.global.pkce_verifier = Array.from(_vBytes).map(b => _pkceChars[b % _pkceChars.length]).join('');\n";
    o += "        const _hBuf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(load.global.pkce_verifier));\n";
    o += "        load.global.pkce_challenge = btoa(String.fromCharCode(...new Uint8Array(_hBuf)))\n";
    o += "            .replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '');\n";
    o += "    }\n\n";
  }
  if (!hasMarkers) {
    o += "    TS01.start();\n\n";
  }
  // Build concurrent group map from HAR timing overlap.
  // Entries with extractors (response capture) and DPoP entries stay sequential.
  const _mjExclude = new Set();
  for (let _i = 0; _i < entries.length; _i++) {
    const _e = entries[_i];
    const _hasSrc = corrSourcesRemap.has(_i) && (corrSourcesRemap.get(_i) || []).some((c) => c.extractorType !== "generate" && !isSuppressibleCookieCorr(c));
    if (_hasSrc) _mjExclude.add(_i);
    if (S.hasDpop && (_e.reqHdrs || []).some((h) => /^dpop(-pf)?$/i.test(h.name))) _mjExclude.add(_i);
  }
  const mjGroupMap = buildConcurrentGroups(entries, mjAutoFollowSet, _mjExclude);

  let currentTxn = null; // {name, tsNum}

  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx];

    // Handle transaction markers
    if (e.isMarker) {
      if (e.markerType === "start") {
        const ti = txnNames.indexOf(e.txnName);
        const tsNum = String(ti + 1).padStart(2, "0");
        currentTxn = { name: e.txnName, tsNum };
        o += `    TS${tsNum}.start();\n\n`;
      } else {
        if (currentTxn) {
          o += `    TS${currentTxn.tsNum}.stop();\n`;
          o += `    load.sleep(think_time);\n\n`;
          currentTxn = null;
        }
      }
      continue;
    }

    if (e.filtered) continue;

    // Skip auto-follow redirect entries (300-303/307) and 401 challenge entries — VuGen handles these automatically.
    // Correlation extractors have been re-anchored to the triggering entry above.
    if (mjAutoFollowSet.has(idx)) {
      o += `    // HTTP ${e.status} → VuGen auto-follows redirect to ${escJs(e.url)} (omitted)\n`;
      continue;
    }

    // Determine concurrent group membership — drives Promise.all grouping and indentation
    const _ginfo = mjGroupMap.get(idx);
    const _inGrp = !!(_ginfo && _ginfo.size >= 2);
    const _grpFirst = !_ginfo || _ginfo.pos === 0;
    const _grpLast  = !_ginfo || _ginfo.pos === _ginfo.size - 1;
    const ind = _inGrp ? "        " : "    ";        // request-line indent (8 or 4 spaces)
    const pi  = _inGrp ? "            " : "        ";  // property indent (12 or 8 spaces)
    const si  = _inGrp ? "                " : "            "; // sub-item indent (16 or 12 spaces)

    // Count auto-follows triggered by this entry and add a note
    {
      let _j = idx + 1,
        _fc = 0;
      while (_j < entries.length && mjAutoFollowSet.has(_j)) {
        _fc++;
        _j++;
      }
      if (_fc > 0)
        o += `${ind}// Note: VuGen auto-follows ${_fc} redirect(s) after this request — extractors scan the final response\n`;
    }

    const rn = (() => {
      const base = rqName(e.url);
      nc[base] = (nc[base] || 0) + 1;
      return nc[base] > 1 ? base + "_" + nc[base] : base;
    })();
    const numStr = String(rid).padStart(2, "0");
    const varN = `webResponse_${numStr}`;
    const hasSrc =
      corrSourcesRemap.has(idx) &&
      (corrSourcesRemap.get(idx) || []).some(
        (c) => c.extractorType !== "generate" && !isSuppressibleCookieCorr(c),
      );
    const reqUsages = corrUsages.get(idx) || [];

    // Build headers (only diff from defaults, apply correlation replacements)
    const allHdrs = filtHdrs(e);
    const extraHdrs = {}; // k → {value, dynamic, expr}
    for (const [k, v] of Object.entries(allHdrs)) {
      // Basic auth: replace raw base64 with parameterised encodedCredentials expression
      if (_basicAuth && k.toLowerCase() === "authorization" && v.includes(_basicAuth.b64)) {
        extraHdrs[k] = { dynamic: true, expr: `Basic \${encodedCredentials}` };
        continue;
      }
      const hdrUsage = reqUsages.find(
        (u) =>
          u.location === "header" &&
          u.key.toLowerCase() === k.toLowerCase(),
      );
      if (hdrUsage) {
        if (hdrUsage.extractorType === "generate") {
          // Call per-request generator inline — only this request gets the fresh token
          extraHdrs[k] = {
            dynamic: true,
            expr: `\${gen_${hdrUsage.name}()}`,
          };
          continue;
        }
        // Replace with dynamic expression — also substitute hostname in prefix
        let rawPfx = hdrUsage.prefix || "";
        for (const [_hh, _hv] of Object.entries(mjHostVarMap).sort(
          (a, b) => b[0].length - a[0].length,
        )) {
          if (!_hh) continue;
          const _re = _hh.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          rawPfx = rawPfx.replace(
            new RegExp(
              "(https?://)" + _re + "(:[0-9]+)?(?=[/?#\\s\"'`]|$)",
              "g",
            ),
            "$1\x00HDRH_" + _hv + "\x00$2",
          );
        }
        const subPfx = escTpl(rawPfx).replace(
          /\x00HDRH_([^\x00]+)\x00/g,
          "${$1}",
        );
        const expr = subPfx
          ? `${subPfx}\${load.global.${hdrUsage.name}}`
          : `\${load.global.${hdrUsage.name}}`;
        extraHdrs[k] = { dynamic: true, expr };
      } else if (k === "accept" && v === "*/*") {
        // DevWeb default — never needed
      } else if (
        k === "authorization" &&
        S.auth &&
        ["kerberos", "ntlm", "negotiate"].includes(S.auth.type) &&
        /^(negotiate|ntlm)\s/i.test(v)
      ) {
        // Negotiate/NTLM challenge — handled by load.setUserCredentials, never emit as static header
      } else if (
        defHdrs[k] === undefined ||
        defHdrs[k] !== v ||
        dynHdrKeysMj.has(k)
      ) {
        // Check if this header value is an unresolved candidate — never emit static dynamic values
        let candHintMj = null;
        if (S.candidates) {
          for (const cand of S.candidates) {
            if (
              cand.usages.some(
                (cu) =>
                  cu.location === "header" &&
                  (cu.key || "").toLowerCase() === k.toLowerCase(),
              )
            ) {
              candHintMj = sanitizeCandHint(cand.hint);
              break;
            }
          }
        }
        extraHdrs[k] = {
          dynamic: false,
          value: v,
          todo: candHintMj || null,
        };
      }
    }
    // Substitute correlated values embedded inside non-correlation header strings
    // e.g. jsessionid in Referer URL, or a token embedded mid-string in a custom header
    for (const [k, hh] of Object.entries(extraHdrs)) {
      if (hh.dynamic) continue; // already a full correlation replacement
      let v = hh.value;
      let changed = false;
      for (const c of correlations) {
        for (const u of c.usages) {
          const rawVal = u.tokenValue || u.originalValue;
          if (rawVal && v.includes(rawVal)) {
            v = v.split(rawVal).join(`\x00DYNSTART_${c.name}\x00DYNEND`);
            changed = true;
          }
        }
      }
      if (changed) {
        // Also substitute hostnames in non-placeholder portions before escaping
        let vSub = v;
        for (const [_hh, _hv] of Object.entries(mjHostVarMap).sort(
          (a, b) => b[0].length - a[0].length,
        )) {
          if (!_hh) continue;
          const _re = _hh.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          vSub = vSub.replace(
            new RegExp(
              "(https?://)" + _re + "(:[0-9]+)?(?=[/?#\\s\"'`\\x00]|$)",
              "g",
            ),
            "$1\x00HDRH_" + _hv + "\x00$2",
          );
        }
        const expr = escTpl(vSub)
          .replace(/\x00DYNSTART_([^]+?)\x00DYNEND/g, "${load.global.$1}")
          .replace(/\x00HDRH_([^\x00]+)\x00/g, "${$1}");
        extraHdrs[k] = { dynamic: true, expr };
      }
    }

    // Build body with correlation replacements
    let bodyText = null;
    let bodyHasDynamic = false;
    if (e.body && e.body.text) {
      bodyText = e.body.text;
      // Resolved correlations — replace in body (JSON, form-urlencoded, XML)
      const bodyUsages = reqUsages.filter(
        (u) =>
          u.location === "body_json" ||
          u.location === "body_form" ||
          u.location === "body_xml",
      );
      for (const u of bodyUsages) {
        const rawVal = u.tokenValue || u.originalValue;
        // Try exact, URL-encoded, and URL-decoded variants
        const variants = [
          rawVal,
          encodeURIComponent(rawVal),
          decodeURIComponent(rawVal || ""),
          String(rawVal).replace(/ /g, "+"),
        ];
        for (const sv of variants) {
          if (sv && bodyText.includes(sv)) {
            bodyText = bodyText.replace(
              sv,
              `\x00DYNSTART_${u.name}\x00DYNEND`,
            );
            bodyHasDynamic = true;
            break;
          }
        }
      }
      // Unresolved candidate values — replace with TODO placeholder
      if (S.candidates && S.candidates.length > 0) {
        const eBase = e.url.split("?")[0];
        for (const cand of S.candidates) {
          for (const cu of cand.usages) {
            const cuBase = cu.reqUrl ? cu.reqUrl.split("?")[0] : "";
            if (cuBase !== eBase) continue;
            if (
              cu.location !== "body_form" &&
              cu.location !== "body_json" &&
              cu.location !== "body_xml"
            )
              continue;
            const rawVal = cand.fullValue || cand.value;
            const variants = [
              rawVal,
              encodeURIComponent(rawVal),
              decodeURIComponent(rawVal || ""),
              String(rawVal).replace(/ /g, "+"),
            ];
            for (const sv of variants) {
              if (sv && bodyText.includes(sv)) {
                bodyText = bodyText.replace(
                  sv,
                  `\x00DYNSTART_${cand.hint}\x00DYNEND`,
                );
                bodyHasDynamic = true;
                break;
              }
            }
          }
        }
      }
      // Parameter substitution — replace user-entered values with load.params.*
      if (S.params && S.params.length > 0) {
        for (const param of S.params) {
          for (const pu of param.usages) {
            if (pu.reqIdx !== idx) continue;
            if (
              pu.location !== "body_form" &&
              pu.location !== "body_json" &&
              pu.location !== "body_xml"
            )
              continue;
            // Skip if this value should be replaced by a date helper function
            if (_dateRecMs && detectDateSubstitution(String(param.value), _dateRecMs)) continue;
            const rawVal = param.value;
            const variants = [
              rawVal,
              encodeURIComponent(rawVal),
              decodeURIComponent(rawVal || ""),
              String(rawVal).replace(/ /g, "+"),
            ];
            for (const sv of variants) {
              if (sv && bodyText.includes(sv)) {
                bodyText = bodyText.replace(
                  sv,
                  `\x00PARAM_${param.csvKey}\x00PARAMEND`,
                );
                bodyHasDynamic = true;
                break;
              }
            }
          }
        }
      }
    }

    // Build URL with correlation and param query substitutions
    let urlOut = e.url,
      urlHasDynamic = false;
    // URL path substitutions: matrix params (;jsessionid=xxx) AND REST path segment UUIDs
    const mjPathUsages = reqUsages.filter(
      (u) => u.location === "url_path" || u.location === "url_path_seg",
    );
    for (const u of mjPathUsages) {
      const rawVal = u.tokenValue || u.originalValue;
      if (rawVal && urlOut.includes(rawVal)) {
        urlOut = urlOut.replace(
          rawVal,
          `\x00DYNSTART_${u.name}\x00DYNEND`,
        );
        urlHasDynamic = true;
      }
    }
    const queryUsages = reqUsages.filter((u) => u.location === "query");
    for (const u of queryUsages) {
      const rawVal = u.tokenValue || u.originalValue;
      const variants = [
        rawVal,
        encodeURIComponent(rawVal),
        decodeURIComponent(rawVal || ""),
        String(rawVal).replace(/ /g, "+"),
      ];
      for (const sv of variants) {
        if (sv && urlOut.includes(sv)) {
          urlOut = urlOut.replace(sv, `\x00DYNSTART_${u.name}\x00DYNEND`);
          urlHasDynamic = true;
          break;
        }
      }
    }
    if (S.params && S.params.length > 0) {
      for (const param of S.params) {
        for (const pu of param.usages) {
          if (pu.reqIdx !== idx || pu.location !== "query") continue;
          // Skip if this value should be replaced by a date helper function
          if (_dateRecMs) {
            let _dpDec;
            try { _dpDec = decodeURIComponent(String(param.value).replace(/\+/g, " ")); } catch { _dpDec = String(param.value); }
            if (detectDateSubstitution(String(param.value), _dateRecMs, e.startMs) ||
                (_dpDec !== String(param.value) && detectDateSubstitution(_dpDec, _dateRecMs, e.startMs))) {
              continue;
            }
          }
          const rawVal = param.value;
          const variants = [
            encodeURIComponent(rawVal),
            rawVal,
            String(rawVal).replace(/ /g, "+"),
          ];
          for (const sv of variants) {
            if (sv && urlOut.includes(sv)) {
              urlOut = urlOut.replace(
                sv,
                `\x00PARAM_${param.csvKey}\x00PARAMEND`,
              );
              urlHasDynamic = true;
              break;
            }
          }
        }
      }
    }

    // ServerHost URL substitution — apply all known host variables (SERVER_HOST, SERVER_HOST1, …)
    for (const [_uh, _uv] of Object.entries(mjHostVarMap).sort(
      (a, b) => b[0].length - a[0].length,
    )) {
      if (!_uh) continue;
      const _ure = new RegExp(
        "^(https?://)" +
          _uh.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
          "(:[0-9]+)?(?=[/?#]|$)",
      );
      const _um = urlOut.match(_ure);
      if (_um) {
        urlOut =
          _um[1] +
          "\x00SRVHOST_" +
          _uv +
          "\x00" +
          (_um[2] || "") +
          urlOut.slice(_um[0].length);
        urlHasDynamic = true;
        break;
      }
    }

    // Split urlOut into base URL + query string parts
    const qMarkIdx = urlOut.indexOf("?");
    let urlBaseOut = urlOut,
      urlQsOut = "";
    if (qMarkIdx >= 0) {
      urlBaseOut = urlOut.slice(0, qMarkIdx);
      urlQsOut = urlOut.slice(qMarkIdx + 1);
    }
    const urlBaseDyn = urlBaseOut.includes("\x00");

    const srcCorrsForReq = (corrSourcesRemap.get(idx) || []).filter(
      (c) => c.extractorType !== "generate" && !isSuppressibleCookieCorr(c),
    );

    // Open Promise.all block before the first entry in a concurrent group
    if (_inGrp && _grpFirst) o += `    await Promise.all([\n`;

    const bodyMime = ((e.body && e.body.mimeType) || "")
      .split(";")[0]
      .trim();
    if (bodyMime === "multipart/form-data") {
      o += `${ind}// TODO: Multipart body detected. For file uploads in DevWeb:\n`;
      o += `${ind}// const formData = new load.FormData();\n`;
      o += `${ind}// formData.append('fieldName', load.utils.readFile('filename.pdf'), 'filename.pdf');\n`;
      o += `${ind}// Then use: body: formData  (remove the body property below and replace)\n`;
    }
    o += `${ind}// ${rn}\n`;

    // DPoP proof generation — fresh proof per request (DPoP entries are always sequential)
    if (S.hasDpop) {
      const dpopHdrs = (e.reqHdrs || []).filter((h) =>
        /^dpop(-pf)?$/i.test(h.name),
      );
      for (const dh of dpopHdrs) {
        const dk = dh.name.toLowerCase();
        if (dk === "dpop-pf" && _dpopPfUsedMJ) continue;
        const varName = dk === "dpop-pf" ? "dpop_pf_proof" : "dpop_proof";
        let htu = e.url;
        try {
          const pu = new URL(e.url);
          htu = pu.origin + pu.pathname;
        } catch {}
        try {
          const pl = JSON.parse(
            atob(
              dh.value
                .split(".")[1]
                .replace(/-/g, "+")
                .replace(/_/g, "/"),
            ),
          );
          if (pl.htu) htu = pl.htu;
        } catch {}
        if (dk === "dpop") {
          o += `        load.global.${varName} = getDpopProof('${htu}', '${e.method}', load.global.dpop_jwk, load.global.${S.dpopTokenVar});\n`;
        } else {
          o += `        load.global.${varName} = getDpopProof('${htu}', '${e.method}', load.global.dpop_jwk);\n`;
          _dpopPfUsedMJ = true;
        }
      }
    }

    // Request opening — no `await` inside Promise.all; hasSrc entries are always sequential
    if (_inGrp) {
      o += `${ind}new load.WebRequest({\n`;
    } else if (srcCorrsForReq.length > 0) {
      o += `    const ${varN} = await new load.WebRequest({\n`;
    } else {
      o += `    await new load.WebRequest({\n`;
    }
    o += `${pi}id: ${rid},\n`;
    // Base URL
    if (urlBaseDyn) {
      let urlEsc = escTpl(urlBaseOut);
      urlEsc = urlEsc.replace(
        /\x00DYNSTART_([^]+?)\x00DYNEND/g,
        "${load.global.$1}",
      );
      urlEsc = urlEsc.replace(
        /\x00PARAM_([^]+?)\x00PARAMEND/g,
        "${load.params.$1}",
      );
      urlEsc = urlEsc.replace(/\x00SRVHOST_([^\x00]+)\x00/g, "${$1}");
      o += `${pi}url: \`${urlEsc}\`,\n`;
    } else {
      o += `${pi}url: ${subHdrValMj(e.url.split("?")[0], mjHostVarMap)},\n`;
    }
    // queryString object
    if (urlQsOut) {
      o += `${pi}queryString: {\n`;
      for (const pair of urlQsOut.split("&")) {
        const eqI = pair.indexOf("=");
        const rawK = eqI >= 0 ? pair.slice(0, eqI) : pair;
        const rawV = eqI >= 0 ? pair.slice(eqI + 1) : "";
        let key;
        try {
          key = decodeURIComponent(rawK);
        } catch {
          key = rawK;
        }
        if (rawV.includes("\x00")) {
          let vx = escTpl(rawV);
          vx = vx.replace(
            /\x00DYNSTART_([^]+?)\x00DYNEND/g,
            "${load.global.$1}",
          );
          vx = vx.replace(
            /\x00PARAM_([^]+?)\x00PARAMEND/g,
            "${load.params.$1}",
          );
          const { text: vxSub, changed: vxCh } = subRawMj(
            vx,
            mjHostVarMap,
          );
          const vxFinal = vxCh
            ? vxSub.replace(/\x00HDRH_([^\x00]+)\x00/g, "${$1}")
            : vx;
          o += `${si}"${escJs(key)}": \`${vxFinal}\`,\n`;
        } else {
          let val;
          try {
            val = decodeURIComponent(rawV.replace(/\+/g, " "));
          } catch {
            val = rawV;
          }
          const _qds = _dateRecMs ? detectDateSubstitution(val, _dateRecMs, e.startMs) : null;
          if (_qds) {
            const _qcall = _qds.arg !== null ? `${_qds.fn}(${_qds.arg})` : `${_qds.fn}()`;
            o += `${si}"${escJs(key)}": \`\${${_qcall}}\`,\n`;
          } else {
            const _qEmbed = _dateRecMs ? substituteEmbeddedDates(val, _dateRecMs) : null;
            if (_qEmbed) {
              o += `${si}"${escJs(key)}": \`${_qEmbed}\`,\n`;
            } else if (_basicAuth && val === _basicAuth.b64) {
              o += `${si}"${escJs(key)}": \`\${encodedCredentials}\`,\n`;
            } else {
              o += `${si}"${escJs(key)}": ${subHdrValMj(val, mjHostVarMap)},\n`;
            }
          }
        }
      }
      o += `${pi}},\n`;
    }
    o += `${pi}method: "${e.method}",\n`;

    // Inject DPoP headers with dynamic proof values
    if (S.hasDpop) {
      const dpopHdrs = (e.reqHdrs || []).filter((h) =>
        /^dpop(-pf)?$/i.test(h.name),
      );
      for (const dh of dpopHdrs) {
        const dk = dh.name.toLowerCase();
        const varName = dk === "dpop-pf" ? "dpop_pf_proof" : "dpop_proof";
        extraHdrs[dh.name] = {
          dynamic: true,
          expr: `\${load.global.${varName}}`,
        };
      }
    }
    if (Object.keys(extraHdrs).length > 0) {
      o += `${pi}headers: {\n`;
      for (const [k, h] of Object.entries(extraHdrs)) {
        if (h.dynamic) o += `${si}"${escJs(k)}": \`${h.expr}\`,\n`;
        else if (h.todo) {
          // Preserve scheme prefix (Bearer / Token) if present in the original value
          const _schemeMatch = h.value && /^(Bearer|Token|Basic|Digest|API-Key)\s/i.exec(h.value);
          const _prefix = _schemeMatch ? _schemeMatch[0] : "";
          o += `${si}// TODO: corr — add extractor on the response that issues this token.\n`;
          o += `${si}"${escJs(k)}": \`${_prefix}\${load.global.${h.todo}}\`,\n`;
        } else
          o += `${si}"${escJs(k)}": ${subHdrValMj(h.value, mjHostVarMap)},\n`;
      }
      o += `${pi}},\n`;
    }
    // NetLog source: body was not captured — emit TODO comment
    if (
      e._fromNetLog &&
      bodyText === null &&
      e.method !== "GET" &&
      e.method !== "HEAD"
    ) {
      o += `${pi}// TODO: POST body not available in NetLog — add body property with your recorded request body\n`;
    }
    if (bodyText !== null) {
      const isFormBody =
        bodyMime === "application/x-www-form-urlencoded" &&
        bodyText.indexOf("=") >= 0;
      if (isFormBody) {
        const pairs = bodyText.split("&");
        o += `${pi}body: {\n`;
        for (const pair of pairs) {
          const eq = pair.indexOf("=");
          const rawK = eq >= 0 ? pair.substring(0, eq) : pair;
          const rawV = eq >= 0 ? pair.substring(eq + 1) : "";
          let k = rawK;
          try {
            k = decodeURIComponent(rawK.replace(/\+/g, " "));
          } catch (ex) {}
          const hasDyn =
            rawV.includes("\x00DYNSTART_") || rawV.includes("\x00PARAM_");
          if (hasDyn) {
            let vExpr = escTpl(rawV);
            vExpr = vExpr.replace(
              /\x00DYNSTART_([^]+?)\x00DYNEND/g,
              "${load.global.$1}",
            );
            vExpr = vExpr.replace(
              /\x00PARAM_([^]+?)\x00PARAMEND/g,
              "${load.params.$1}",
            );
            const { text: vSub, changed: vCh } = subRawMj(
              vExpr,
              mjHostVarMap,
            );
            const vFinal = vCh
              ? vSub.replace(/\x00HDRH_([^\x00]+)\x00/g, "${$1}")
              : vExpr;
            o += `${si}"${escJs(k)}": \`${vFinal}\`,\n`;
          } else {
            let v = rawV;
            try {
              v = decodeURIComponent(rawV.replace(/\+/g, " "));
            } catch (ex) {}
            const _fds = _dateRecMs ? detectDateSubstitution(v, _dateRecMs) : null;
            if (_fds) {
              const _fcall = _fds.arg !== null ? `${_fds.fn}(${_fds.arg})` : `${_fds.fn}()`;
              o += `${si}"${escJs(k)}": \`\${${_fcall}}\`,\n`;
            } else {
              const _fEmbed = _dateRecMs ? substituteEmbeddedDates(v, _dateRecMs) : null;
              if (_fEmbed) {
                o += `${si}"${escJs(k)}": \`${_fEmbed}\`,\n`;
              } else if (_basicAuth && v === _basicAuth.b64) {
                o += `${si}"${escJs(k)}": \`\${encodedCredentials}\`,\n`;
              } else {
                o += `${si}"${escJs(k)}": ${subHdrValMj(v, mjHostVarMap)},\n`;
              }
            }
          }
        }
        o += `${pi}},\n`;
      } else if (bodyHasDynamic) {
        let esc1 = escTpl(bodyText);
        esc1 = esc1.replace(
          /\x00DYNSTART_([^]+?)\x00DYNEND/g,
          "${load.global.$1}",
        );
        esc1 = esc1.replace(
          /\x00PARAM_([^]+?)\x00PARAMEND/g,
          "${load.params.$1}",
        );
        // Apply hostname substitution to the already-resolved expression (hostname sub on static parts)
        const { text: esc1Sub, changed: esc1Ch } = subRawMj(
          esc1,
          mjHostVarMap,
        );
        const esc1Final = esc1Ch
          ? esc1Sub.replace(/\x00HDRH_([^\x00]+)\x00/g, "${$1}")
          : esc1;
        o += `${pi}body: \`${esc1Final}\`,\n`;
      } else if (
        bodyMime === "application/json" ||
        bodyMime === "text/json"
      ) {
        // Pretty-print JSON body as formatted JS object literal
        const { text: bSub, changed: bCh } = subRawMj(
          bodyText,
          mjHostVarMap,
        );
        if (bCh) {
          o += `${pi}body: \`${escTpl(bSub).replace(/\x00HDRH_([^\x00]+)\x00/g, "${$1}")}\`,\n`;
        } else {
          try {
            const parsed = JSON.parse(bodyText);
            // Build substitution map for JSON string/number values:
            // includes both date patterns and encoded credentials.
            const _jsonDates = new Map();
            // _jsonEmbedded: complex strings containing embedded non-padded datetime substrings
            const _jsonEmbedded = new Map();
            if (_basicAuth) {
              // encodedCredentials variable replaces the raw base64 value
              _jsonDates.set(_basicAuth.b64, "encodedCredentials");
            }
            if (_dateRecMs) {
              (function _findJd(v) {
                if (typeof v === "string") {
                  if (!_jsonDates.has(v) && !_jsonEmbedded.has(v)) {
                    const ds = detectDateSubstitution(v, _dateRecMs);
                    if (ds) {
                      _jsonDates.set(v, ds.arg !== null ? `${ds.fn}(${ds.arg})` : `${ds.fn}()`);
                    } else {
                      const emb = substituteEmbeddedDates(v, _dateRecMs);
                      if (emb) _jsonEmbedded.set(v, emb);
                    }
                  }
                } else if (typeof v === "number") {
                  const sk = String(v);
                  if (!_jsonDates.has(sk)) {
                    const ds = detectDateSubstitution(sk, _dateRecMs);
                    if (ds) _jsonDates.set(sk, ds.arg !== null ? `${ds.fn}(${ds.arg})` : `${ds.fn}()`);
                  }
                } else if (Array.isArray(v)) { v.forEach(_findJd); }
                else if (v && typeof v === "object") { Object.values(v).forEach(_findJd); }
              })(parsed);
            }
            if (_jsonDates.size > 0 || _jsonEmbedded.size > 0) {
              // Render as a JS object literal where each substituted field gets its own
              // template literal value — avoids nested template literal syntax errors.
              function _renderJsVal(v, depth) {
                const ind = "    ".repeat(depth);
                const indm1 = "    ".repeat(depth - 1);
                if (v === null) return "null";
                if (typeof v === "boolean") return String(v);
                if (typeof v === "number") {
                  const sk = String(v);
                  // Epoch date → plain function call (no template literal needed)
                  return _jsonDates.has(sk) ? _jsonDates.get(sk) : sk;
                }
                if (typeof v === "string") {
                  // Standalone date / credential → `${fn()}` template literal
                  if (_jsonDates.has(v)) return `\`\${${_jsonDates.get(v)}}\``;
                  // Embedded dates → `$query={...'${fn()}'...}` template literal
                  if (_jsonEmbedded.has(v)) return `\`${_jsonEmbedded.get(v)}\``;
                  return JSON.stringify(v);
                }
                if (Array.isArray(v)) {
                  if (!v.length) return "[]";
                  return `[\n${v.map(i => `${ind}${_renderJsVal(i, depth + 1)}`).join(",\n")}\n${indm1}]`;
                }
                if (typeof v === "object") {
                  const keys = Object.keys(v);
                  if (!keys.length) return "{}";
                  const pairs = keys.map(k => `${ind}${JSON.stringify(k)}: ${_renderJsVal(v[k], depth + 1)}`).join(",\n");
                  return `{\n${pairs}\n${indm1}}`;
                }
                return JSON.stringify(v);
              }
              const _rendered = _renderJsVal(parsed, 1);
              const _rLines = _rendered.split("\n");
              o += `${pi}body: ${_rLines.map((l, i) => (i === 0 ? l : pi + l)).join("\n")},\n`;
            } else {
              const lines = JSON.stringify(parsed, null, 4).split("\n");
              o += `${pi}body: ${lines.map((l, i) => (i === 0 ? l : pi + l)).join("\n")},\n`;
            }
          } catch {
            o += `${pi}body: \`${escTpl(bodyText)}\`,\n`;
          }
        }
      } else {
        const { text: bSub, changed: bCh } = subRawMj(
          bodyText,
          mjHostVarMap,
        );
        if (bCh)
          o += `${pi}body: \`${escTpl(bSub).replace(/\x00HDRH_([^\x00]+)\x00/g, "${$1}")}\`,\n`;
        else o += `${pi}body: \`${escTpl(bodyText)}\`,\n`;
      }
    }
    if (srcCorrsForReq.length > 0) {
      o += `${pi}returnBody: true,\n`;
      // Reference pre-declared extractors from correlations.js for clean, compact code
      o += `${pi}extractors: [${srcCorrsForReq.map((c) => `corr.${c.name}Extractor`).join(", ")}],\n`;
    }
    // Request closing — concurrent: .send(), + optional Promise.all close; sequential: .send();\n\n
    if (_inGrp) {
      o += `${ind}}).send(),\n`;
      if (_grpLast) o += `    ]);\n\n`;
    } else {
      o += `    }).send();\n\n`;
      // Store extracted values (only for sequential entries with extractors)
      if (srcCorrsForReq.length > 0) {
        for (const c of srcCorrsForReq)
          o += `    load.global.${c.name} = ${varN}.extractors.${c.name};\n`;
        o += "\n";
      }
    }
    rid++;
  }

  // Close TS01 and the action block (only when no transaction markers defined)
  if (!hasMarkers) {
    o += "    TS01.stop();\n";
    o += "    load.sleep(think_time);\n\n";
  }
  o += '    load.log("Action complete", load.LogLevel.debug);\n';
  o += "});\n\n";

  // ── finalize ──────────────────────────────────────────────────────────────
  o += 'load.finalize("Finalize", async function() {\n';
  o += '    load.log("Finalizing Vuser " + load.config.user.userId, load.LogLevel.debug);\n';
  o += "    // Cleanup code here if needed\n";
  o += '    load.log("Finalization complete", load.LogLevel.debug);\n';
  o += "});\n";
  return o;
}

// ═══════════════════════════════════════════════════════════════════════════
// WEB HTTP/HTML CODE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════
function genActionC(entries, correlations) {
  const nc = {};
  function name(url) {
    let r = "request";
    try {
      const p = new URL(url);
      const segs = p.pathname.split("/").filter(Boolean);
      r = segs[segs.length - 1] || p.hostname.split(".")[0] || "req";
      r =
        r
          .replace(/\.[^.]+$/, "")
          .replace(/[^a-zA-Z0-9]/g, "_")
          .replace(/^_+|_+$/g, "")
          .replace(/_+/g, "_")
          .substring(0, 24) || "request";
      if (/^\d/.test(r)) r = "req_" + r;
    } catch {}
    nc[r] = (nc[r] || 0) + 1;
    return nc[r] > 1 ? r + "_" + nc[r] : r;
  }

  // Build lookup maps
  const corrSources = new Map();
  const corrUsages = new Map();
  for (const corr of correlations) {
    if (!corrSources.has(corr.sourceIdx))
      corrSources.set(corr.sourceIdx, []);
    corrSources.get(corr.sourceIdx).push(corr);
    for (const u of corr.usages) {
      if (!corrUsages.has(u.reqIdx)) corrUsages.set(u.reqIdx, []);
      corrUsages.get(u.reqIdx).push({
        ...u,
        name: corr.name,
        extractorType: corr.extractorType,
      });
    }
  }

  // Detect auto-follow redirect entries and remap extractors to the anchor entry.
  // web_reg_save_param placed before the triggering request scans ALL responses in
  // the auto-redirect chain (IgnoreRedirections=No default) — scans ALL intermediate
  // responses including the final destination body.
  const { autoFollowSet: acAutoFollowSet, anchorOf: acAnchorOf } =
    buildAutoFollowMap(entries);
  // corrSourcesRemap: anchorIdx → [corr]  (extractors from skipped entries moved to anchor)
  const corrSourcesRemap = new Map();
  for (const [idx, corrs] of corrSources) {
    const effectiveIdx = acAutoFollowSet.has(idx)
      ? (acAnchorOf[idx] ?? idx)
      : idx;
    if (!corrSourcesRemap.has(effectiveIdx))
      corrSourcesRemap.set(effectiveIdx, []);
    for (const c of corrs) {
      // Skip extractor if ALL usages are in auto-follow entries — value never used in generated script
      if (
        c.usages &&
        c.usages.length > 0 &&
        c.usages.every((u) => acAutoFollowSet.has(u.reqIdx))
      )
        continue;
      corrSourcesRemap.get(effectiveIdx).push(c);
    }
  }

  // ── Header analysis: determine universal (auto) vs per-request headers ────
  // Headers handled by VuGen attributes or managed internally — never emit via web_add_header
  const SKIP_HDR_AC = new Set([
    // VuGen attributes handle these — never emit via web_add_header
    "referer", // → "Referer=" attribute in web_url / web_custom_request
    "content-type", // → "EncType=" attribute (or auto for web_submit_data ITEMDATA)
    "content-length", // computed automatically by VuGen engine
    "host", // always added by VuGen from the URL
    "connection", // HTTP keep-alive managed by VuGen internally
    "keep-alive", // same — connection persistence managed by VuGen
    "transfer-encoding", // chunked encoding handled by VuGen
    "upgrade-insecure-requests", // browser-only security hint
    "expect", // 100-continue — connection-level, not needed in scripts
    "cookie",
    "cookie2", // managed by VuGen cookie jar
    "te",
    "trailer", // HTTP/1.1 connection-level
    "via", // proxy-inserted, irrelevant to load test
    "dnt", // Do Not Track — browser privacy hint
    "accept-encoding", // VuGen handles gzip/deflate/br decompression automatically
    "priority", // HTTP/2 urgency hint — not applicable to VuGen protocol layer
    // Conditional / cache headers — not needed in scripted replay
    "x-forwarded-for",
    "if-none-match",
    "if-modified-since",
    "if-unmodified-since",
    "if-match",
    "cache-control",
    "pragma",
    // Browser client hints / fetch metadata — browser-generated, meaningless in load test
    "sec-ch-ua",
    "sec-ch-ua-mobile",
    "sec-ch-ua-platform",
    "sec-fetch-dest",
    "sec-fetch-mode",
    "sec-fetch-site",
    "sec-fetch-user",
    // DPoP headers - replaced dynamically per-request
    "dpop",
    "dpop-pf",
  ]);
  // Convert "accept-language" → "Accept-Language" — split on hyphen, capitalise first char, rejoin
  function hdrTitleCase(n) {
    return n
      .split("-")
      .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
      .join("-");
  }
  // Count header name+value occurrences across scripted entries (non-filtered, non-marker, non-redirect)
  const visEntries = entries.filter(
    (e, i) => !e.filtered && !e.isMarker && !acAutoFollowSet.has(i),
  );
  const hdrFreq = {}; // k → Map<value, count-of-entries-with-that-value>
  const hdrKeyFreq = {}; // k → count-of-entries-that-have-this-header (any value)
  for (const ev of visEntries) {
    const seenKeys = new Set();
    for (const h of ev.reqHdrs || []) {
      const k = h.name.toLowerCase();
      if (SKIP_HDR_AC.has(k) || k.startsWith(":")) continue;
      if (!hdrFreq[k]) hdrFreq[k] = new Map();
      hdrFreq[k].set(h.value, (hdrFreq[k].get(h.value) || 0) + 1);
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        hdrKeyFreq[k] = (hdrKeyFreq[k] || 0) + 1;
      }
    }
  }
  // Global headers: key appears on ≥80% of entries → use most common value as web_add_auto_header
  const autoHdrs = {};
  const aThresh = Math.max(1, Math.ceil(visEntries.length * 0.8));
  for (const [k, valMap] of Object.entries(hdrFreq)) {
    if ((hdrKeyFreq[k] || 0) >= aThresh) {
      const [bestVal] = [...valMap.entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      autoHdrs[k] = bestVal;
    }
  }
  // Force-global: User-Agent and Accept-Language are always session-wide constants
  for (const fk of ["user-agent", "accept-language"]) {
    if (hdrFreq[fk] && autoHdrs[fk] === undefined) {
      const [bestVal] = [...hdrFreq[fk].entries()].sort(
        (a, b) => b[1] - a[1],
      )[0];
      autoHdrs[fk] = bestVal;
    }
  }
  // Suppress Authorization header only when value is a Negotiate/NTLM challenge — setUserCredentials handles those.
  // Bearer tokens must remain so they appear on every API request after SSO login.
  if (
    S.auth &&
    ["kerberos", "ntlm", "negotiate"].includes(S.auth.type) &&
    autoHdrs["authorization"] &&
    /^(negotiate|ntlm)\s/i.test(autoHdrs["authorization"])
  )
    delete autoHdrs["authorization"];
  // Remove headers managed by correlations — those need per-request dynamic substitution
  for (const corr of correlations) {
    for (const u of corr.usages) {
      if (u.location === "header")
        delete autoHdrs[(u.key || "").toLowerCase()];
    }
  }
  // Remove headers that are Unresolved candidates — must emit TODO, never a static global header
  if (S.candidates) {
    for (const cand of S.candidates) {
      for (const cu of cand.usages) {
        if (cu.location === "header")
          delete autoHdrs[(cu.key || "").toLowerCase()];
      }
    }
  }

  // Build helper functions for generate-type correlations.
  // Each function generates a fresh token value and adds the header for ONE request only.
  // Called before each request that needs the header — requests that don't need it are unaffected.
  const genCorrsAC = correlations.filter(
    (c) => c.extractorType === "generate",
  );
  let helperFns = "";
  for (const c of genCorrsAC) {
    const hdrKey = c.usages.find((u) => u.location === "header")?.key;
    if (!hdrKey) continue;
    helperFns += `void gen_${c.name}()\n{\n`;
    helperFns += webHttpCorrCode(c, "\t");
    helperFns += `\tweb_add_header("${hdrTitleCase(hdrKey)}", "{${c.name}}");\n`;
    helperFns += `}\n\n`;
  }
  // Build host variable map for header value substitution
  const acHostVarMap = buildHdrHostMap(
    entries,
    S.serverHost ? S.serverHost.host : "",
  );

  let _dpopPfUsedAC = false;
  // Pre-scan: collect DPoP proof specs per transaction group for batch generation
  // Split into "safe" (can batch) vs "deferred" (needs token from this txn)
  const _dpopBatchByTxn = new Map(); // txnName → [{idx,htu,htm,dk,paramName}]
  const _dpopDeferredSet = new Set(); // entry indices that must use per-request web_js_run
  if (S.hasDpop) {
    let curTxn = "_notxn_";
    let pfUsed = false;
    // First pass: find which txn extracts AccessToken (correlation source)
    const corrSourceTxns = new Set();
    {
      let ct = "_notxn_";
      for (const e of entries) {
        if (e.isMarker) {
          if (e.markerType === "start") ct = e.txnName;
          continue;
        }
        if (e.filtered) continue;
        // Check if this entry produces a correlation (AccessToken etc)
        if (corrSourcesRemap.has(entries.indexOf(e)))
          corrSourceTxns.add(ct);
      }
    }
    // Second pass: classify proofs
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      if (e.isMarker) {
        if (e.markerType === "start") curTxn = e.txnName;
        else curTxn = "_after_" + e.txnName;
        continue;
      }
      if (e.filtered || acAutoFollowSet.has(i)) continue;
      const dpH = (e.reqHdrs || []).filter((h) =>
        /^dpop(-pf)?$/i.test(h.name),
      );
      for (const dh of dpH) {
        const dk = dh.name.toLowerCase();
        if (dk === "dpop-pf" && pfUsed) continue;
        const needsAth = dk === "dpop"; // dpop proofs need ath (access token hash)
        const tokenExtractedInThisTxn = corrSourceTxns.has(curTxn);
        // If this proof needs ath AND the token is extracted in THIS transaction,
        // it can't be batched (token doesn't exist yet at txn start)
        if (needsAth && tokenExtractedInThisTxn) {
          _dpopDeferredSet.add(i);
          if (dk === "dpop-pf") pfUsed = true;
          continue;
        }
        if (!_dpopBatchByTxn.has(curTxn)) _dpopBatchByTxn.set(curTxn, []);
        let htu = e.url;
        try {
          const pu = new URL(e.url);
          htu = pu.origin + pu.pathname;
        } catch {}
        try {
          const pl = JSON.parse(
            atob(
              dh.value
                .split(".")[1]
                .replace(/-/g, "+")
                .replace(/_/g, "/"),
            ),
          );
          if (pl.htu) htu = pl.htu;
        } catch {}
        const seqN = _dpopBatchByTxn.get(curTxn).length + 1;
        const pn =
          dk === "dpop-pf"
            ? `_dpop_pf_proof_${seqN}`
            : `_dpop_proof_${seqN}`;
        _dpopBatchByTxn
          .get(curTxn)
          .push({ idx: i, htu, htm: e.method, dk, paramName: pn });
        if (dk === "dpop-pf") pfUsed = true;
      }
    }
  }
  const _dpopParamForEntry = new Map();
  for (const [, specs] of _dpopBatchByTxn) {
    for (const s of specs) {
      if (!_dpopParamForEntry.has(s.idx))
        _dpopParamForEntry.set(s.idx, {});
      _dpopParamForEntry.get(s.idx)[s.dk] = s.paramName;
    }
  }
  function emitDpopBatch(txnName) {
    const specs = _dpopBatchByTxn.get(txnName);
    if (!specs || specs.length === 0) return "";
    const kp = S.dpopKeyVar || "dpop_jwk",
      bv = S.dpopTokenVar || "AccessToken";
    if (specs.length === 1) {
      const s = specs[0];
      const sa = s.dk === "dpop" ? `, LR.getParam('` + bv + `')` : "";
      return `\t// DPoP proof (1 proof)\n\tweb_js_run(\n\t\t"Code=generateDpopProof('${escJs(s.htu)}', '${s.htm}'${sa});",\n\t\t"ResultParam=${s.paramName}",\n\t\tLAST);\n\n`;
    }
    const s = specs.map((s) => {
      const av = s.dk === "dpop" ? `'` + bv + `'` : "";
      return `\\\"htu\\\":\\\"${escJs(s.htu)}\\\",\\\"htm\\\":\\\"${s.htm}\\\",\\\"ath\\\":\\\"${av}\\\",\\\"paramName\\\":\\\"${s.paramName}\\\"`;
    });
    return `\t// Batch DPoP \u2014 ${specs.length} proofs in one JS engine call\n\tweb_js_run(\n\t\t"Code=generateDpopProofs('[${s.join(",")}]');",\n\t\t"ResultParam=_dpop_batch_status",\n\t\tLAST);\n\n`;
  }

  let o =
    helperFns +
    'Action()\n{\n\n\tweb_set_sockets_option("SSL_VERSION", "AUTO");\n\n';
  // Server configuration
  if (S.serverHost) {
    o += `\t// Server configuration — update "ServerHost" value to target different environments\n`;
    o += `\t// e.g. test: ${S.serverHost.host}  prod: prod-server.company.com\n`;
    o += `\tlr_save_string("${S.serverHost.host}", "ServerHost");\n`;
    // Extra hostnames found in headers
    Object.entries(acHostVarMap).forEach(([hh, hv]) => {
      if (hv === "SERVER_HOST") return;
      const lrP = "ServerHost" + hv.replace("SERVER_HOST", "");
      o += `\tlr_save_string("${hh}", "${lrP}");\n`;
    });
    o += "\n";
  }
  // Authentication
  const AUTH_LABELS_C = {
    kerberos: "Kerberos",
    ntlm: "NTLM",
    negotiate: "Negotiate (Kerberos/NTLM)",
    basic: "Basic",
    digest: "Digest",
  };
  if (S.auth && AUTH_LABELS_C[S.auth.type]) {
    const lbl = AUTH_LABELS_C[S.auth.type];
    o += `\t// ${lbl} Authentication\n`;
    if (S.auth.type === "kerberos" || S.auth.type === "negotiate") {
      o += `\t// Runtime Settings: Internet Protocol -> Preferences -> Authentication\n`;
      o += `\t//   [x] Enable Integrated Authentication\n`;
      o += `\t//   [x] Use canonical name in SPN\n`;
    } else if (S.auth.type === "ntlm") {
      o += `\t// Runtime Settings: Internet Protocol -> Preferences -> Authentication\n`;
      o += `\t//   [x] Enable Integrated Authentication\n`;
    }
    const ntlmHost = S.auth.host || "server";
    o += `\tweb_set_user("{username}", "{password}", "${ntlmHost}");\n\n`;
  }
  // Global headers (same value on every request) — set once with web_add_auto_header
  for (const [k, v] of Object.entries(autoHdrs)) {
    o += `\tweb_add_auto_header("${hdrTitleCase(k)}", "${escJs(subHdrValC(v, acHostVarMap))}");\n`;
  }
  if (Object.keys(autoHdrs).length) o += "\n";

  // PKCE (RFC 7636) — generate code_verifier + code_challenge at start of each iteration.
  // generatePkce() is defined in lre-utils.dat (loaded once in vuser_init).
  // It calls LR.setParam so {pkce_verifier} and {pkce_challenge} are available for this iteration.
  if (S.hasPkce) {
    o += "\t// PKCE — generate fresh code_verifier and code_challenge for this iteration\n";
    o += "\tweb_js_run(\n";
    o += '\t\t"Code=generatePkce();",\n';
    o += '\t\t"ResultParam=pkce_verifier",\n';
    o += "\t\tLAST);\n\n";
  }

  let snap = 1;
  const hasMarkers = entries.some((e) => e.isMarker);

  // Fallback single transaction when no markers present
  if (!hasMarkers)
    o += '\tlr_start_transaction("SC01_01_Transaction");\n\n';

  for (let idx = 0; idx < entries.length; idx++) {
    const e = entries[idx];

    // Handle transaction markers
    if (e.isMarker) {
      const acIdx = S.txns.findIndex((t) => t.name === e.txnName);
      const acSeq = String(acIdx + 1).padStart(2, "0");
      const acSc = `SC01_${acSeq}_${e.txnName.replace(/^[Tt]\d+[_-]/, "").toUpperCase()}`;
      if (e.markerType === "start") {
        o += `\tlr_start_transaction("${acSc}");\n\n`;
        if (S.hasDpop && _dpopBatchByTxn.has(e.txnName))
          o += emitDpopBatch(e.txnName);
      } else {
        o += `\tlr_end_transaction("${acSc}", LR_AUTO);\n\n`;
        o += `\tlr_think_time(3);\n\n`;
      }
      continue;
    }

    if (e.filtered) continue;

    // Skip auto-follow redirect entries (300-303/307) and 401 challenge entries — VuGen handles these automatically.
    // web_reg_save_param extractors have been re-anchored to the triggering entry.
    if (acAutoFollowSet.has(idx)) {
      o += `\t// HTTP ${e.status} → VuGen auto-follows redirect to ${e.url} (omitted)\n`;
      continue;
    }

    // Count auto-follows triggered by this entry and add a note
    {
      let _j = idx + 1,
        _fc = 0;
      while (_j < entries.length && acAutoFollowSet.has(_j)) {
        _fc++;
        _j++;
      }
      if (_fc > 0)
        o += `\t// Note: VuGen auto-follows ${_fc} request(s) — web_reg_save_param scans all responses in chain (IgnoreRedirections=No default)\n`;
    }

    const n = name(e.url);
    const ct = e.ct || "text/html";
    let ref = e.hdrsMap["referer"] || "";
    // Substitute correlated path params and REST segment IDs in Referer header
    for (const c of correlations) {
      const pu = c.usages.find(
        (u) => u.location === "url_path" || u.location === "url_path_seg",
      );
      if (pu && pu.originalValue && ref.includes(pu.originalValue))
        ref = ref.replace(pu.originalValue, `{${c.name}}`);
    }
    const sn = `t${snap++}.inf`;
    const reqUsages = corrUsages.get(idx) || [];

    // DPoP proofs: batched at txn start, or per-request if token not yet available
    if (S.hasDpop && _dpopDeferredSet.has(idx)) {
      const dpopHdrs = (e.reqHdrs || []).filter((h) =>
        /^dpop(-pf)?$/i.test(h.name),
      );
      for (const dh of dpopHdrs) {
        const dk = dh.name.toLowerCase();
        const resultParam =
          dk === "dpop-pf" ? "_dpop_pf_proof" : "_dpop_proof";
        let htu = e.url;
        try {
          const pu = new URL(e.url);
          htu = pu.origin + pu.pathname;
        } catch {}
        try {
          const pl = JSON.parse(
            atob(
              dh.value
                .split(".")[1]
                .replace(/-/g, "+")
                .replace(/_/g, "/"),
            ),
          );
          if (pl.htu) htu = pl.htu;
        } catch {}
        const athArg =
          dk === "dpop" ? `, LR.getParam('${S.dpopTokenVar}')` : "";
        o += ` \tweb_js_run(\n\t\t"Code=generateDpopProof('${escJs(htu)}', '${e.method}'${athArg});",\n\t\t"ResultParam=${resultParam}",\n\t\tLAST);\n`;
      }
    }

    // Inject web_reg_save_param BEFORE this request (includes extractors re-anchored from auto-follow entries).
    // Cookie-only correlations are suppressed — VuGen cookie jar (ENABLE_COOKIES) handles them automatically.
    const acSrcCorrs = (corrSourcesRemap.get(idx) || []).filter(
      (c) => !isSuppressibleCookieCorr(c),
    );
    if (acSrcCorrs.length > 0) {
      o += `\t// --- Correlation extraction for request: ${n}\n`;
      for (const corr of acSrcCorrs)
        o += webHttpCorrCode(corr, "\t");
      o += "\n";
    }
    // Inject TODO comment if this request uses an unresolved candidate value
    if (S.candidates && S.candidates.length > 0) {
      const eBase = e.url.split("?")[0];
      for (const cand of S.candidates) {
        const used = cand.usages.some((cu) => {
          const cuBase = cu.reqUrl ? cu.reqUrl.split("?")[0] : "";
          return cuBase === eBase;
        });
        if (used) {
          const safeHint = sanitizeCandHint(cand.hint);
          o += `\t// TODO: Correlate "${safeHint}" — source response body was not captured in HAR.\n`;
          o += `\t// Re-record with DevTools "Disable cache" enabled to trace extraction source.\n`;
          o += `\t// web_reg_save_param("${safeHint}", "LB=TODO_LEFT_BOUNDARY", "RB=TODO_RIGHT_BOUNDARY", LAST);\n\n`;
        }
      }
    }

    // Build URL with correlation and param substitutions
    let urlOut = e.url;
    // URL path substitutions: matrix params (;jsessionid=xxx) AND REST path segment IDs
    const pathUsages = reqUsages.filter(
      (u) => u.location === "url_path" || u.location === "url_path_seg",
    );
    for (const u of pathUsages) {
      const rawVal = u.tokenValue || u.originalValue;
      if (rawVal) urlOut = urlOut.replace(rawVal, `{${u.name}}`);
    }
    // Query param correlation substitutions
    const queryUsages = reqUsages.filter((u) => u.location === "query");
    for (const u of queryUsages) {
      urlOut = urlOut
        .replace(encodeURIComponent(u.originalValue), `{${u.name}}`)
        .replace(u.originalValue, `{${u.name}}`);
    }
    // Param query substitutions in URL (e.g. ?q={SearchQuery})
    if (S.params && S.params.length > 0) {
      for (const param of S.params) {
        for (const pu of param.usages) {
          if (pu.reqIdx !== idx || pu.location !== "query") continue;
          const raw = param.value;
          const variants = [
            encodeURIComponent(raw),
            raw,
            String(raw).replace(/ /g, "+"),
          ];
          for (const sv of variants) {
            if (sv && urlOut.includes(sv)) {
              urlOut = urlOut.replace(sv, `{${param.csvKey}}`);
              break;
            }
          }
        }
      }
    }
    // ServerHost URL substitution — apply all known host variables (ServerHost, ServerHost1, …)
    urlOut = subHdrValC(urlOut, acHostVarMap);
    if (ref) ref = subHdrValC(ref, acHostVarMap);

    // Build header injections for this request
    const hdrUsages = reqUsages.filter((u) => u.location === "header");
    for (const u of hdrUsages) {
      if (u.extractorType === "generate") {
        // Call per-request helper — generates a fresh token and adds the header for THIS request only
        o += `\tgen_${u.name}();\n`;
        continue;
      }
      const replVal = u.prefix ? `${u.prefix}{${u.name}}` : `{${u.name}}`;
      o += `\tweb_add_header("${hdrTitleCase(u.key)}", "${replVal}");\n`;
    }
    // Per-request headers: emit only when value DIFFERS from global default (acts as override)
    // DPoP headers — batch-assigned or per-request param names
    if (S.hasDpop) {
      if (_dpopParamForEntry.has(idx)) {
        const dpopParams = _dpopParamForEntry.get(idx);
        for (const [dk, paramName] of Object.entries(dpopParams)) {
          o += ` \tweb_add_header("${hdrTitleCase(dk)}", "{${paramName}}");\n`;
        }
      } else if (_dpopDeferredSet.has(idx)) {
        const dpopHdrs = (e.reqHdrs || []).filter((h) =>
          /^dpop(-pf)?$/i.test(h.name),
        );
        for (const dh of dpopHdrs) {
          const dk = dh.name.toLowerCase();
          const rp = dk === "dpop-pf" ? "_dpop_pf_proof" : "_dpop_proof";
          o += ` \tweb_add_header("${hdrTitleCase(dk)}", "{${rp}}");\n`;
        }
      }
    }
    const corrHdrKeys = new Set(
      hdrUsages.map((u) => u.key.toLowerCase()),
    );
    for (const h of e.reqHdrs || []) {
      const k = h.name.toLowerCase();
      if (SKIP_HDR_AC.has(k) || k.startsWith(":")) continue;
      if (autoHdrs[k] === h.value) continue; // global already covers this exact value — skip
      if (k === "accept" && h.value === "*/*") continue; // VuGen default — never needed
      if (
        k === "authorization" &&
        S.auth &&
        ["kerberos", "ntlm", "negotiate"].includes(S.auth.type) &&
        /^(negotiate|ntlm)\s/i.test(h.value)
      )
        continue;
      if (corrHdrKeys.has(k)) continue; // already emitted as correlation
      // Check if this header's value is an unresolved candidate — never emit static dynamic values
      let candHint = null;
      if (S.candidates) {
        for (const cand of S.candidates) {
          if (
            cand.usages.some(
              (cu) =>
                cu.location === "header" &&
                (cu.key || "").toLowerCase() === k,
            )
          ) {
            candHint = sanitizeCandHint(cand.hint);
            break;
          }
        }
      }
      if (candHint) {
        // Dynamic header — source response not captured in HAR; tester must add the extractor.
        // Preserve scheme prefix (Bearer / Token) if present in original header value.
        const _cSchemeMatch = h.value && /^(Bearer|Token|Digest)\s/i.exec(h.value);
        const _cPrefix = _cSchemeMatch ? _cSchemeMatch[0] : "";
        o += `\t// TODO: corr — add web_reg_save_param BEFORE the request that returns "${hdrTitleCase(k)}".\n`;
        o += `\t// Example: web_reg_save_param("${candHint}", "LB=\\"access_token\\":\\"", "RB=\\"", "Search=Body", "Ord=1", LAST);\n`;
        o += `\tweb_add_header("${hdrTitleCase(k)}", "${_cPrefix}{${candHint}}");\n`;
      } else {
        // Substitute any correlated token values embedded in this header
        // (e.g. Authorization: Bearer <token> where <token> was extracted by web_reg_save_param)
        let hdrVal = h.value;
        let hdrDynamic = false;
        for (const corr of correlations) {
          if (corr.extractorType === "generate") continue;
          for (const u of corr.usages) {
            const raw = u.tokenValue || u.originalValue;
            if (raw && hdrVal.includes(raw)) {
              hdrVal = hdrVal.split(raw).join(`{${corr.name}}`);
              hdrDynamic = true;
            }
          }
        }
        o += `\tweb_add_header("${hdrTitleCase(k)}", "${escJs(subHdrValC(h.value, acHostVarMap))}");\n`;
      }
    }

    if (e.method === "GET" || e.method === "HEAD") {
      o += `\tweb_url("${n}",\n\t\t"URL=${urlOut}",\n\t\t"Resource=0",\n`;
      o += `\t\t"RecContentType=${ct}",\n\t\t"Referer=${ref}",\n`;
      o += `\t\t"Snapshot=${sn}",\n\t\t"Mode=HTML",\n\t\tLAST);\n\n`;
    } else {
      let encType = "application/x-www-form-urlencoded";
      let rawBodyText = "";
      if (e.body) {
        encType = (e.body.mimeType || encType).split(";")[0].trim();
        rawBodyText = e.body.text || "";
      }
      // Detect content-type from request headers if body.mimeType not set
      const ctHdr = (e.hdrsMap["content-type"] || "")
        .split(";")[0]
        .trim();
      if (!e.body && ctHdr) encType = ctHdr;
      // NetLog source: POST body was not captured — emit TODO comment
      if (e._fromNetLog && !rawBodyText) {
        o += `\t// TODO: POST body not available in NetLog — add BodyBinary= with your recorded request body\n`;
      }
      // Multipart body detection
      if (encType === "multipart/form-data") {
        o += `\t// TODO: Multipart body detected. VuGen uses web_add_body_part() for multipart uploads.\n`;
        o += `\t// Consider splitting into parts using web_add_body_part() or record directly in VuGen.\n`;
      }
      // Large unsubstituted .NET hidden fields warning
      if (
        rawBodyText &&
        rawBodyText.length > 1500 &&
        /__VIEWSTATE|__EVENTVALIDATION|__RequestVerificationToken/.test(
          rawBodyText,
        )
      ) {
        // Check if any of these were NOT substituted (still have raw value)
        const hasRawLarge =
          /__VIEWSTATE=%2F|__VIEWSTATE=\/|__VIEWSTATE=[A-Za-z0-9+/]{100,}/.test(
            rawBodyText,
          );
        if (hasRawLarge) {
          o += `\t// TODO: Large .NET hidden field(s) detected. Re-record with two HARs in Script Studio for auto-correlation.\n`;
        }
      }
      const bodyUsages = reqUsages.filter(
        (u) =>
          u.location === "body_json" ||
          u.location === "body_form" ||
          u.location === "body_xml",
      );

      if (
        e.method === "POST" &&
        encType === "application/x-www-form-urlencoded" &&
        rawBodyText &&
        rawBodyText.indexOf("=") >= 0
      ) {
        // ── web_submit_data with ITEMDATA (standard HTML form POST) ──────────
        // Parse URL-encoded body into decoded {k,v} pairs — VuGen re-encodes automatically
        const formFields = rawBodyText.split("&").map((pair) => {
          const eq = pair.indexOf("=");
          try {
            return {
              k: decodeURIComponent(
                (eq >= 0 ? pair.substring(0, eq) : pair).replace(
                  /\+/g,
                  " ",
                ),
              ),
              v:
                eq >= 0
                  ? decodeURIComponent(
                      pair.substring(eq + 1).replace(/\+/g, " "),
                    )
                  : "",
            };
          } catch {
            return {
              k: eq >= 0 ? pair.substring(0, eq) : pair,
              v: eq >= 0 ? pair.substring(eq + 1) : "",
            };
          }
        });
        // Apply substitutions per-field on decoded values
        const subFields = formFields.map(({ k, v }) => {
          let sv = v;
          // 1. Correlation substitutions
          for (const u of bodyUsages) {
            const rv = String(u.tokenValue || u.originalValue || "");
            if (!rv) continue;
            let dec;
            try {
              dec = decodeURIComponent(rv.replace(/\+/g, " "));
            } catch {
              dec = rv;
            }
            if (sv.includes(rv)) sv = sv.split(rv).join(`{${u.name}}`);
            else if (dec && dec !== rv && sv.includes(dec))
              sv = sv.split(dec).join(`{${u.name}}`);
          }
          // 2. Candidate substitutions
          if (S.candidates && S.candidates.length > 0) {
            for (const cand of S.candidates) {
              for (const cu of cand.usages) {
                if (
                  cu.reqIdx !== idx ||
                  (cu.location !== "body_form" &&
                    cu.location !== "body_xml")
                )
                  continue;
                const rv = String(cand.fullValue || cand.value || "");
                if (!rv) continue;
                let dec;
                try {
                  dec = decodeURIComponent(rv.replace(/\+/g, " "));
                } catch {
                  dec = rv;
                }
                const safeHint = sanitizeCandHint(cand.hint);
                if (sv.includes(rv))
                  sv = sv.split(rv).join(`{${safeHint}}`);
                else if (dec && dec !== rv && sv.includes(dec))
                  sv = sv.split(dec).join(`{${safeHint}}`);
              }
            }
          }
          // 3. Parameter substitutions
          if (S.params && S.params.length > 0) {
            for (const param of S.params) {
              for (const pu of param.usages) {
                if (
                  pu.reqIdx !== idx ||
                  (pu.location !== "body_form" &&
                    pu.location !== "body_xml")
                )
                  continue;
                const rv = String(param.value || "");
                if (!rv) continue;
                let dec;
                try {
                  dec = decodeURIComponent(rv.replace(/\+/g, " "));
                } catch {
                  dec = rv;
                }
                if (sv.includes(rv))
                  sv = sv.split(rv).join(`{${param.csvKey}}`);
                else if (dec && dec !== rv && sv.includes(dec))
                  sv = sv.split(dec).join(`{${param.csvKey}}`);
              }
            }
          }
          // 4. Hostname substitution — replace https://hostname with {ServerHost} etc.
          sv = subHdrValC(sv, acHostVarMap);
          return { k: escJs(k), v: escJs(sv) };
        });
        o += `\tweb_submit_data("${n}",\n`;
        o += `\t\t"Action=${urlOut}",\n`;
        o += `\t\t"Method=POST",\n`;
        o += `\t\t"RecContentType=${ct}",\n`;
        o += `\t\t"Referer=${ref}",\n`;
        o += `\t\t"Snapshot=${sn}",\n`;
        o += `\t\t"Mode=HTML",\n`;
        o += `\t\tITEMDATA,\n`;
        for (const { k, v } of subFields)
          o += `\t\t"Name=${k}","Value=${v}",ENDITEM,\n`;
        o += `\t\tLAST);\n\n`;
      } else {
        // ── web_custom_request (JSON, XML, multipart, PUT, DELETE, PATCH) ───
        // Always use BodyBinary= to match VuGen native recording behavior.
        // Body= causes VuGen attribute parser errors with JSON braces, colons, and other special chars.
        const isBinary = true;
        let body = "";
        if (rawBodyText) {
          // Escape body for C string embedding (binary-safe or plain)
          body = isBinary
            ? escBodyBinary(rawBodyText)
            : rawBodyText
                .replace(/\\/g, "\\\\")
                .replace(/"/g, '\\"')
                .replace(/\r?\n/g, "\\n")
                .replace(/\t/g, "\\t");
          for (const u of bodyUsages) {
            const rawVal = u.tokenValue || u.originalValue;
            const variants = [
              rawVal,
              encodeURIComponent(rawVal),
              decodeURIComponent(rawVal || ""),
              String(rawVal).replace(/ /g, "+"),
            ];
            for (const sv of variants) {
              if (sv && body.includes(sv)) {
                body = body.replace(sv, `{${u.name}}`);
                break;
              }
            }
          }
          if (S.candidates && S.candidates.length > 0) {
            const eBase = e.url.split("?")[0];
            for (const cand of S.candidates) {
              for (const cu of cand.usages) {
                const cuBase = cu.reqUrl ? cu.reqUrl.split("?")[0] : "";
                if (cuBase !== eBase) continue;
                if (
                  cu.location !== "body_form" &&
                  cu.location !== "body_json" &&
                  cu.location !== "body_xml"
                )
                  continue;
                const rawVal = cand.fullValue || cand.value;
                const variants = [
                  rawVal,
                  encodeURIComponent(rawVal),
                  decodeURIComponent(rawVal || ""),
                  String(rawVal).replace(/ /g, "+"),
                ];
                const safeHint = sanitizeCandHint(cand.hint);
                for (const sv of variants) {
                  if (sv && body.includes(sv)) {
                    body = body.replace(sv, `{${safeHint}}`);
                    break;
                  }
                }
              }
            }
          }
          if (S.params && S.params.length > 0) {
            for (const param of S.params) {
              for (const pu of param.usages) {
                if (pu.reqIdx !== idx) continue;
                if (
                  pu.location !== "body_form" &&
                  pu.location !== "body_json" &&
                  pu.location !== "body_xml"
                )
                  continue;
                const rawVal = param.value
                  .replace(/\\/g, "\\\\")
                  .replace(/"/g, '\\"')
                  .replace(/\r?\n/g, "\\n");
                const variants = [
                  rawVal,
                  encodeURIComponent(rawVal),
                  decodeURIComponent(rawVal || ""),
                  String(rawVal).replace(/ /g, "+"),
                ];
                for (const sv of variants) {
                  if (sv && body.includes(sv)) {
                    body = body.replace(sv, `{${param.csvKey}}`);
                    break;
                  }
                }
              }
            }
          }
        }
        o += `\tweb_custom_request("${n}",\n\t\t"URL=${urlOut}",\n\t\t"Method=${e.method}",\n`;
        o += `\t\t"Resource=0",\n\t\t"RecContentType=${ct}",\n`;
        o += `\t\t"Referer=${ref}",\n\t\t"Snapshot=${sn}",\n\t\t"Mode=HTML",\n`;
        o += `\t\t"EncType=${encType}",\n`;
        if (body) {
          // Smart chunking — never break inside an escape sequence (\xHH, \X).
          // Splitting mid-escape produces invalid C hex literals e.g. "\xC""3..." → wrong byte.
          const bodyAttr = isBinary ? "BodyBinary" : "Body";
          const CHUNK = 200;
          if (body.length <= CHUNK) {
            o += `\t\t"${bodyAttr}=${body}",\n`;
          } else {
            const chunks = [];
            let pos = 0;
            while (pos < body.length) {
              let end = Math.min(pos + CHUNK, body.length);
              if (end < body.length) {
                // Back up to avoid splitting inside a \xHH or \X escape sequence
                if (body[end - 1] === "\\")
                  end--; // lone '\'
                else if (
                  end >= 2 &&
                  body[end - 2] === "\\" &&
                  body[end - 1] === "x"
                )
                  end -= 2; // '\x'
                else if (
                  end >= 3 &&
                  body[end - 3] === "\\" &&
                  body[end - 2] === "x"
                )
                  end -= 3; // '\xH'
              }
              chunks.push(body.substring(pos, end));
              pos = end;
            }
            // Output: attr= on first chunk, comma only on last chunk, no comma on middle chunks
            o += `\t\t"${bodyAttr}=${chunks[0]}"\n`;
            for (let i = 1; i < chunks.length; i++) {
              o +=
                i === chunks.length - 1
                  ? `\t\t"${chunks[i]}",\n`
                  : `\t\t"${chunks[i]}"\n`;
            }
          }
        }
        o += `\t\tLAST);\n\n`;
      }
    }
  }

  if (!hasMarkers)
    o += '\tlr_end_transaction("SC01_01_Transaction", LR_AUTO);\n\n';
  o += "\treturn 0;\n}\n";
  return o;
}

function genVuserInit() {
  if (S.hasDpop) {
    return (
      "vuser_init()\n{\n\n" +
      "\t// Load lre-utils.dat ONCE and initialize DPoP engine\n" +
      "\tweb_js_run(\n" +
      "\t\t\"Code=initDpopKey(LR.getParam('dpop_jwk')); 'DPoP engine initialized successfully':\",\n" +
      '\t\t"ResultParam=dpop_init_result",\n' +
      "\t\tSOURCES,\n" +
      '\t\t\t"File=lre-utils.dat", ENDITEM,\n' +
      "\t\tLAST);\n\n" +
      '\tlr_output_message("DPoP Initialization: %s", lr_eval_string("{dpop_init_result}"));\n\n' +
      "\treturn 0;\n}\n\n"
    );
  }
  if (S.hasPkce) {
    return (
      "vuser_init()\n{\n\n" +
      "\t// Load lre-utils.dat ONCE — provides generatePkce() for all Action() iterations\n" +
      "\tweb_js_run(\n" +
      '\t\t"Code=\'lre-utils loaded\';",\n' +
      '\t\t"ResultParam=_lre_init",\n' +
      "\t\tSOURCES,\n" +
      '\t\t\t"File=lre-utils.dat", ENDITEM,\n' +
      "\t\tLAST);\n\n" +
      "\treturn 0;\n}\n\n"
    );
  }
  return "vuser_init()\n{\n\treturn 0;\n}\n\n";
}
function genVuserEnd() {
  return "vuser_end()\n{\n\treturn 0;\n}\n";
}
function genGlobalsH() {
  // VuGen parameters set by web_reg_save_param are runtime-managed — no char* declarations needed.
  return `#ifndef _GLOBALS_H\n#define _GLOBALS_H\n\n//--------------------------------------------------------------------\n// Include Files\n#include "lrun.h"\n#include "web_api.h"\n#include "lrw_custom_body.h"\n\n//--------------------------------------------------------------------\n// Global Variables\n\n#endif // _GLOBALS_H\n`;
}

// ═══════════════════════════════════════════════════════════════════════════
// USR + METADATA
// ═══════════════════════════════════════════════════════════════════════════
function genUsrFile(scriptName) {
  const txnNames =
    S.txns.length > 0 ? S.txns.map((t) => t.name) : ["T01_Transaction"];
  const orderLine = `[TransactionsOrder]\nOrder="${txnNames.join("__*delimiter*__")}"\n`;
  const txnLines =
    "[Transactions]\n" + txnNames.map((n) => `${n}=`).join("\n") + "\n";
  const hasParams = S.params && S.params.length > 0;
  return `[General]
Type=Multi
DefaultCfg=default.cfg
ParameterFile=${hasParams ? "ParameterFile.prm" : ""}
GlobalParameterFile=
NewFunctionHeader=1
RunType=cci
ActionLogicExt=action_logic
LastActiveAction=Action
MajorVersion=25
MinorVersion=3
ActiveTypes=QTWeb
GenerateTypes=QTWeb
AdditionalTypes=QTWeb
DevelopTool=Vugen
LastModifyVer=25.3.0.0
DFERebrandFlag=Done
ParamLeftBrace={
ParamRightBrace=}
ScriptLanguage=C
LastCodeGenerationVer=25.3.0.0
DisableRegenerate=0
Encoding=ANSI
Description=
ScriptLocale=en-US
[Actions]
vuser_init=vuser_init.c
Action=Action.c
vuser_end=vuser_end.c
[RunLogicFiles]
Default Profile=default.usp
[VuserProfiles]
Profiles=Default Profile
[CfgFiles]
Default Profile=default.cfg
[ExtraFiles]
globals.h=
[Modified Actions]
vuser_init=0
Action=1
vuser_end=0
[Recorded Actions]
vuser_init=0
Action=1
vuser_end=0
[Replayed Actions]
vuser_init=0
Action=0
vuser_end=0
[Interpreters]
vuser_init=cci
Action=cci
vuser_end=cci
${orderLine}[StateManagement]
LastReplayStatus=0
[ActiveReplay]
LastReplayedRunName=
ActiveRunName=
${txnLines}${S.hasDpop || S.hasPkce ? "\n[ManuallyExtraFiles]\nlre-utils.dat=\n" : ""}`;
}

function genScriptUploadMetadata(scriptName) {
  const hasParams = S.params && S.params.length > 0;
  const paramEntries = hasParams
    ? `    <FileEntry Name="ParameterFile.prm" Filter="4" />\n    <FileEntry Name="collection_data.dat" Filter="4" />\n`
    : "";
  return `<?xml version="1.0" encoding="utf-8"?>
<VugenScriptMetadata>
  <ScriptName>${scriptName}</ScriptName>
  <Protocol>Web - HTTP/HTML</Protocol>
  <ActionFiles>
    <FileEntry Name="vuser_init.c" Filter="2" />
    <FileEntry Name="Action.c" Filter="2" />
    <FileEntry Name="vuser_end.c" Filter="2" />
  </ActionFiles>
  <GeneralFiles>
    <FileEntry Name="${scriptName}.usr" Filter="4" />
    <FileEntry Name="default.cfg" Filter="4" />
    <FileEntry Name="default.usp" Filter="4" />
    <FileEntry Name="globals.h" Filter="2" />
${paramEntries}    <FileEntry Name="Bookmarks.xml" Filter="1" />
    <FileEntry Name="Breakpoints.xml" Filter="1" />
    <FileEntry Name="custom_body_variables.txt" Filter="1" />
    <FileEntry Name="lrw_custom_body.h" Filter="1" />
    <FileEntry Name="ScriptUploadMetadata.xml" Filter="1" />
  ${S.hasDpop || S.hasPkce ? '\t<FileEntry Name="lre-utils.dat" Filter="2" />\n' : ""}</GeneralFiles>
</VugenScriptMetadata>`;
}

function genDevWebUsrFile(scriptName) {
  const txnNames =
    S.txns && S.txns.length > 0 ? S.txns.map((t) => t.name) : [];
  const orderVal = txnNames.join("__*delimiter*__");
  return `[General]
Type=DevWeb
DefaultCfg=default.cfg
MajorVersion=25
MinorVersion=3
ParameterFile=
GlobalParameterFile=
RunType=DevWeb
NewFunctionHeader=1
ActionLogicExt=action_logic
LastActiveAction=Main
ScriptLanguage=JavaScript
Encoding=UTF8
DevelopTool=Vugen
LastModifyVer=25.3.0.0
ActiveTypes=DevWeb
AdditionalTypes=DevWeb
GenerateTypes=DevWeb
ParamLeftBrace={
ParamRightBrace=}
LastCodeGenerationVer=
DisableRegenerate=0
Description=
ScriptLocale=en-US
[ExtraFiles]
parameters.yml=
rts.yml=
[Actions]
Main=main.js
[Recorded Actions]
Main=0
[Interpreters]
Main=DevWeb
[RunLogicFiles]
Default Profile=default.usp
[Modified Actions]
Main=0
[Replayed Actions]
Main=0
[TransactionsOrder]
Order=${orderVal}
[StateManagement]
LastReplayStatus=0
[ActiveReplay]
LastReplayedRunName=
ActiveRunName=
${S.hasDpop ? "\n[ManuallyExtraFiles]\ndpop-gelper.js=\n" : ""}
`;
}

function genDevWebScriptUploadMetadata(scriptName) {
  return `<?xml version="1.0" encoding="utf-8"?>
<VugenScriptMetadata>
  <ScriptName>${scriptName}</ScriptName>
  <Protocol>DevWeb</Protocol>
  <ActionFiles>
    <FileEntry Name="main.js" Filter="2" />
  </ActionFiles>
  <GeneralFiles>
    <FileEntry Name="${scriptName}.usr" Filter="4" />
    <FileEntry Name="default.cfg" Filter="4" />
    <FileEntry Name="default.usp" Filter="4" />
    <FileEntry Name="parameters.yml" Filter="2" />
    <FileEntry Name="rts.yml" Filter="2" />
    <FileEntry Name="Action.c" Filter="1" />
    <FileEntry Name="Bookmarks.xml" Filter="1" />
    <FileEntry Name="Breakpoints.xml" Filter="1" />
    <FileEntry Name="DevWebSdk.d.ts" Filter="1" />
    <FileEntry Name="tsconfig.json" Filter="1" />
    <FileEntry Name="UserTasks.xml" Filter="1" />
    <FileEntry Name="vuser_end.c" Filter="1" />
    <FileEntry Name="vuser_init.c" Filter="1" />
    <FileEntry Name="ScriptUploadMetadata.xml" Filter="1" />
  ${S.hasDpop ? '\t<FileEntry Name="dpop-helper.js" Filter="2" />\n' : ""}</GeneralFiles>
</VugenScriptMetadata>`;
}


// ═══════════════════════════════════════════════════════════════════════════
// AUTHENTICATION DETECTION
// ═══════════════════════════════════════════════════════════════════════════
function detectAuth(entries) {
  function urlParts(url) {
    try {
      const u = new URL(url);
      const port = u.port || (u.protocol === "https:" ? "443" : "80");
      return {
        host: u.hostname,
        port,
        hostport: u.hostname + ":" + port,
      };
    } catch {
      return { host: "", port: "443", hostport: "" };
    }
  }
  const PRIO = {
    kerberos: 7,
    ntlm: 6,
    negotiate: 5,
    digest: 4,
    basic: 3,
    bearer: 2,
    saml: 1,
  };
  let best = null;
  function set(type, parts, extra) {
    if (!best || (PRIO[type] || 0) > (PRIO[best.type] || 0))
      best = { type, ...parts, ...(extra || {}) };
  }
  for (const e of entries) {
    if (e.isMarker) continue;
    const parts = urlParts(e.url);
    // Check WWW-Authenticate in response headers
    const wwwAuth = (e.respHdrsMap || {})["www-authenticate"] || "";
    if (/^negotiate\b/i.test(wwwAuth)) set("negotiate", parts);
    else if (/^ntlm\b/i.test(wwwAuth)) set("ntlm", parts);
    else if (/^digest\b/i.test(wwwAuth)) {
      const realm =
        (wwwAuth.match(/realm="([^"]+)"/i) || [])[1] || parts.hostport;
      set("digest", parts, { realm });
    } else if (/^basic\b/i.test(wwwAuth)) {
      const realm =
        (wwwAuth.match(/realm="([^"]+)"/i) || [])[1] || parts.hostport;
      set("basic", parts, { realm });
    }
    // Check Authorization in request headers
    const authHdr = (e.hdrsMap || {})["authorization"] || "";
    if (/^negotiate /i.test(authHdr)) {
      let type = "negotiate";
      try {
        const tok = authHdr.split(" ")[1] || "";
        const dec = atob(tok.substring(0, 16));
        type = dec.includes("NTLMSSP") ? "ntlm" : "kerberos";
      } catch {}
      set(type, parts);
    } else if (/^ntlm /i.test(authHdr)) {
      set("ntlm", parts);
    } else if (/^basic /i.test(authHdr)) {
      let username = "";
      try {
        username = atob(authHdr.split(" ")[1] || "").split(":")[0];
      } catch {}
      set("basic", parts, { realm: parts.hostport, username });
    } else if (/^digest /i.test(authHdr)) {
      const realm =
        (authHdr.match(/realm="([^"]+)"/i) || [])[1] || parts.hostport;
      const username =
        (authHdr.match(/username="([^"]+)"/i) || [])[1] || "";
      set("digest", parts, { realm, username });
    } else if (/^bearer /i.test(authHdr)) {
      set("bearer", parts);
    }
    // Check SAML in POST body
    const postText = (e.body && e.body.text) || "";
    if (
      postText.includes("SAMLResponse") ||
      postText.includes("SAMLRequest")
    )
      set("saml", parts);
  }
  return best;
}

function genDefaultCfg(auth) {
  const overrides = {};
  if (S.hasDpop) overrides["EnableJsForTransport"] = "1";
  if (auth && ["kerberos", "negotiate", "ntlm"].includes(auth.type)) {
    if (auth.type === "kerberos" || auth.type === "negotiate") {
      overrides["IntegratedAuthentication"] = "1";
      overrides["SPNCNameLookup"] = "1";
    } else {
      overrides["IntegratedAuthentication"] = "1";
      overrides["UseNativeNTLM"] = "1";
      overrides["OverrideNTLMCreds"] = "1";
    }
  }
  if (!Object.keys(overrides).length) return WEB_DEFAULT_CFG;
  return WEB_DEFAULT_CFG.split("\n")
    .map((line) => {
      const eq = line.indexOf("=");
      if (eq < 0) return line;
      const key = line.substring(0, eq);
      return key in overrides ? key + "=" + overrides[key] : line;
    })
    .join("\n");
}

// Fallback: if Chrome omitted Negotiate headers from the HAR, infer Windows auth from
// corporate-internal TLD hostnames (e.g. .mde .local .corp .internal).
function detectCorporateAuth(entries, currentAuth) {
  if (
    currentAuth &&
    ["kerberos", "ntlm", "negotiate"].includes(currentAuth.type)
  )
    return currentAuth;
  const PUB =
    /\.(com|org|net|io|co|app|dev|cloud|gov|edu|biz|info|tech|site|online|store|tv|me|us|uk|au|ca|de|fr|jp|sg|in|eu|nz|nl|se|no|fi|dk|be|at|ch|es|it|pl|cz|ru|br|mx|ar|cl|za|ae|sa|kw|qa)(\.[a-z]{2})?$/i;
  const AZURE =
    /^(login\.microsoftonline\.com|sts\.windows\.net|login\.windows\.net)$/i;
  for (const e of entries || []) {
    if (e.isMarker || e.filtered) continue;
    let h = "";
    try {
      h = new URL(e.url).hostname;
    } catch {
      continue;
    }
    if (!h || /^\d{1,3}(\.\d{1,3}){3}$/.test(h) || h === "localhost")
      continue;
    if (!PUB.test(h) || AZURE.test(h)) {
      try {
        const u = new URL(e.url),
          port = u.port || (u.protocol === "https:" ? "443" : "80"),
          hp = u.hostname + ":" + port;
        return {
          type: "negotiate",
          host: u.hostname,
          port,
          hostport: hp,
          realm: hp,
        };
      } catch {}
    }
  }
  return currentAuth;
}

function genRtsYml(auth) {
  if (!auth || !["kerberos", "negotiate", "ntlm"].includes(auth.type))
    return DEVWEB_RTS_YML;
  return DEVWEB_RTS_YML.replace(
    "enableIntegratedAuthentication: false",
    "enableIntegratedAuthentication: true",
  );
}

function detectServerHost(entries) {
  const counts = {};
  for (const e of entries) {
    try {
      const u = new URL(e.url);
      if (!u.hostname) continue;
      const stdPort = u.protocol === "https:" ? "443" : "80";
      const portPart = u.port && u.port !== stdPort ? ":" + u.port : "";
      const host = u.hostname + portPart;
      const prefix = u.protocol + "//" + host;
      if (!counts[prefix])
        counts[prefix] = { host, proto: u.protocol, prefix, count: 0 };
      counts[prefix].count++;
    } catch {}
  }
  const sorted = Object.values(counts).sort((a, b) => b.count - a.count);
  if (!sorted.length) return null;
  const total = sorted.reduce((s, e) => s + e.count, 0);
  const top = sorted[0];
  if (top.count / total < 0.35 && sorted.length > 1) return null;
  return top;
}
