/* HAR Explorer — background worker: "Find a value" and the suggestions.
 *
 * Runs in its own scope so Script Studio's engine (VuGen-Script-Studio-constants.js, VuGen-Script-Studio-correlation.js,
 * studio-advisor.js — loaded unchanged) can sit beside the Recorder's engine on the page without their names clashing,
 * and so a search through a large recording never freezes the page.
 *
 * Messages in:  { type: "load", text, out }         the HAR file's text; out: the requests left out of the script
 *               { type: "find", id, value }         look a value up
 *               { type: "studio", text }            (a second copy) run Script Studio's analysis → { type: "studio", list }
 *               { type: "studioList", list }        Studio's findings, from that second copy
 * Messages out: { type: "ready", suggestions, studioCount, studioDone } suggestions: [{ value, name, by: "studio" | "explorer" }]
 *               { type: "found", id, result }       see investigate()
 *               { type: "error", message }
 * Requests are named by their number in the file (n = index + 1), the same numbers the page shows. */
"use strict";
// In Studio's order; studio-codegen.js and shared/vugen-codegen.js write the extractor code exactly as Studio writes it
importScripts("../shared/vugen-codegen.js", "../VuGen-Script-Studio-constants.js", "../VuGen-Script-Studio-correlation.js",
  "../studio-advisor.js", "../studio-codegen.js");

var E = [];   // per request: { n, url, method, query, reqH, reqBody, params, resH, resBody, mime }

function decodeBody(c) {
  if (!c || c.text == null) return "";
  var mime = c.mimeType || "";
  if (/^(image|font|audio|video)\//i.test(mime) || /octet-stream|wasm|zip|pdf/i.test(mime)) return "";
  if (c.encoding === "base64") {
    try { var b = atob(c.text), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new TextDecoder().decode(a); } catch (e) { return ""; }
  }
  return c.text;
}

// ── Script Studio's own analysis (one recording), as studio-app.js runs it before the Advisor ──
function studioFindings(har) {
  var log = console.log; console.log = function () {};   // the Advisor reports to the console
  try {
    var withRequest = [];   // Studio skips entries without a request: its index → the request's number in the file
    ((har.log && har.log.entries) || []).forEach(function (e, i) { if (e && e.request) withRequest.push(i + 1); });
    S.entries1 = parseHar(har); S.entries2 = [];
    detectMarkers(S.entries1); applyFilters(S.entries1); pruneEmptyPagerefTransactions(S.entries1);
    S.correlations = singleHarCorrelate(S.entries1);
    try { var v = valueBasedCorrelate(S.entries1, S.correlations, S.entries2); if (v && v.length) S.correlations = S.correlations.concat(v); } catch (e) { /* as in Studio: non-fatal */ }
    try { advisorScan(S.entries1, S.correlations.filter(function (c) { return !c._suppressed; })); } catch (e) { S.advisorCandidates = []; }
    var out = [], seen = {};
    S.correlations.filter(function (c) { return !c._suppressed; }).forEach(function (c) {
      var u = (c.usages || [])[0]; if (!u) return;
      var value = u.tokenValue || String(u.originalValue || "").slice((u.prefix || "").length);
      if (value && !seen[value]) { seen[value] = 1; out.push({ value: value, name: c.name, by: "studio", kind: "auto" }); }
    });
    (S.advisorCandidates || []).forEach(function (c) {
      if (c.value && !seen[c.value]) { seen[c.value] = 1; out.push({ value: c.value, name: c.varName || "value", by: "studio", kind: "advisor", confidence: c.confidence }); }
    });
    return out;
  } finally { console.log = log; }
}

// ── every form a value can travel in ──
function variants(v) {
  var out = [{ form: "", s: v }];
  function add(form, s) { if (s && s !== v && s.length >= 3 && !out.some(function (o) { return o.s === s; })) out.push({ form: form, s: s }); }
  add("URL-encoded", encodeURIComponent(v));
  add("URL-encoded", encodeURIComponent(v).replace(/%20/g, "+"));
  add("JSON-escaped", JSON.stringify(v).slice(1, -1));
  add("HTML entities", v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"));
  try { add("Base64", btoa(unescape(encodeURIComponent(v))).replace(/=+$/, "")); } catch (e) { /* not encodable */ }
  try { add("URL-decoded", decodeURIComponent(v)); } catch (e) { /* not encoded */ }
  return out;
}

function jsonPath(text, val) {
  var t = (text || "").trim(); if (t.charAt(0) !== "{" && t.charAt(0) !== "[") return null;
  var obj; try { obj = JSON.parse(t); } catch (e) { return null; }
  var found = null;
  (function walk(o, p) {
    if (found) return;
    if (typeof o === "string" || typeof o === "number") { if (String(o) === val) found = p; return; }
    if (Array.isArray(o)) { for (var i = 0; i < o.length && !found; i++) walk(o[i], p + "[" + i + "]"); }
    else if (o && typeof o === "object") Object.keys(o).forEach(function (k) { walk(o[k], /^[A-Za-z_$][\w$]*$/.test(k) ? p + "." + k : p + "['" + k + "']"); });
  })(obj, "$");
  return found;
}
function cookieName(header, s) { var part = header.split(/;\s*/).filter(function (c) { return c.indexOf(s) >= 0; })[0]; return part ? part.split("=")[0] : "cookie"; }
function escRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

// every place the value (in any form) appears: what the browser sent, and what the server returned
function locate(v) {
  var hits = [], forms = variants(v);
  E.forEach(function (x) {
    function push(side, where, kind, f, extra) {
      if (hits.some(function (h) { return h.n === x.n && h.side === side && h.where === where; })) return;
      var h = { n: x.n, side: side, where: where, kind: kind, enc: f.form };
      if (extra) Object.keys(extra).forEach(function (k) { h[k] = extra[k]; });
      hits.push(h);
    }
    forms.forEach(function (f) {
      var s = f.s;
      if (x.url.indexOf(s) >= 0) {
        var qp = x.query.filter(function (p) { return String(p.value).indexOf(s) >= 0; })[0];
        push("req", qp ? "query parameter " + qp.name : "address", "url", f);
      }
      x.reqH.forEach(function (h) {
        if (String(h.value).indexOf(s) < 0 || h.name.charAt(0) === ":") return;
        if (/^cookie$/i.test(h.name)) push("req", "cookie " + cookieName(h.value, s), "cookie", f);
        else if (/^(referer|origin)$/i.test(h.name)) push("req", "header " + h.name, "referer", f);   // the page address, copied as it is — Studio's Advisor ignores these too
        else push("req", "header " + h.name, "header", f);
      });
      if (x.reqBody && x.reqBody.indexOf(s) >= 0) {
        var fp = x.params.filter(function (p) { return String(p.value).indexOf(s) >= 0; })[0], jp = !fp && jsonPath(x.reqBody, v);
        push("req", fp ? "form field " + fp.name : jp ? "JSON body " + jp : "body", "body", f);
      }
      x.resH.forEach(function (h) {
        if (String(h.value).indexOf(s) < 0) return;
        if (/^set-cookie$/i.test(h.name)) push("res", "Set-Cookie " + h.value.split("=")[0], "setcookie", f, { header: h.name });
        else if (/^location$/i.test(h.name)) push("res", "redirect (Location header)", "location", f, { header: h.name });
        else push("res", "response header " + h.name, "rheader", f, { header: h.name });
      });
      if (x.resBody && x.resBody.indexOf(s) >= 0) {
        var jp2 = !f.form && jsonPath(x.resBody, v);
        var hid = !jp2 && /html/i.test(x.mime) && new RegExp("name=[\"']([^\"']+)[\"'][^>]*value=[\"']" + escRe(s)).exec(x.resBody);
        push("res", jp2 ? "JSON " + jp2 : hid ? "HTML field " + hid[1] : "response body", jp2 ? "json" : "text", f, jp2 ? { path: jp2 } : hid ? { field: hid[1] } : null);
      }
    });
  });
  // by request; within one request, what was sent before what came back; otherwise in the order found
  hits.forEach(function (h, i) { h._i = i; });
  hits.sort(function (a, b) { return a.n - b.n || (a.side === b.side ? a._i - b._i : a.side === "req" ? -1 : 1); });
  hits.forEach(function (h) { delete h._i; });
  return hits;
}

// where it comes from, where it goes, and what to do in the script
var RANK = { json: 0, text: 1, rheader: 2, location: 3, setcookie: 4 };
function investigate(v) {
  var hits = locate(v), back = hits.filter(function (h) { return h.side === "res"; });
  var sent = hits.filter(function (h) { return h.side === "req"; });
  // what counts: requests in the script, not the Referer / Origin copy of the page address
  var uses = sent.filter(function (h) { return h.kind !== "referer" && !OUT[h.n]; });
  var aside = { referer: sent.filter(function (h) { return h.kind === "referer"; }).length, outside: sent.filter(function (h) { return h.kind !== "referer" && OUT[h.n]; }) };
  var firstUse = uses.length ? uses[0].n : Infinity;
  var before = back.filter(function (h) { return h.n < firstUse; });
  var src = null;
  if (before.length) src = before.filter(function (h) { return h.n === before[0].n; }).sort(function (a, b) { return RANK[a.kind] - RANK[b.kind] || (a.enc ? 1 : 0) - (b.enc ? 1 : 0); })[0];
  var later = src ? uses.filter(function (u) { return u.n > src.n; }) : uses;
  // responses before the first use that the HAR kept no body of (the browser's cache): the value may be in one of them
  var missing = src ? 0 : E.filter(function (x) { return x.n < firstUse && x.noBody; }).length;
  var kind, madeByPage = /^\d{13}$/.test(v) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);   // a time stamp or a GUID
  if (!hits.length) kind = "none";
  else if (!src && madeByPage) kind = "generated";
  else if (!src && uses.length && missing) kind = "missing";
  else if (!src) kind = uses.length ? "input" : "unused";
  else if (later.length && later.every(function (u) { return u.kind === "cookie"; })) kind = "cookie";
  else if (src.kind === "location" && later.length && later.every(function (u) { return u.kind === "url" && u.n === src.n + 1; })) kind = "redirect";
  else kind = later.length ? "correlate" : aside.outside.length ? "outonly" : "unused";
  var also = back.filter(function (b) { return b !== src && (!src || b.n > src.n); }).slice(0, 8);
  return { value: v, kind: kind, src: src, later: later, uses: uses, also: also, missing: missing,
    corr: kind === "correlate" ? correlation(v, src, later) : null,
    referer: aside.referer, outside: aside.outside.slice(0, 20), outsideCount: aside.outside.length,
    hitNs: (src ? [src] : []).concat(src ? later : uses).map(function (h) { return h.n; }), studio: !!STUDIO[v],   // marked in the list
    forms: variants(v).map(function (f) { return f.s; }) };
}

// ── "Correlate this": the extractor, in Script Studio's own correlation shape {name, extractorType, extractorConfig},
//    written by Studio's own code writers (webHttpCorrCode / devwebExtractorDecl) ──
// The value between the first `lb` and the next `rb` — what a boundary extractor (first match, Ord=1) captures
function firstMatch(text, lb, rb) {
  var a = text.indexOf(lb); if (a < 0) return null;
  a += lb.length; var b = rb ? text.indexOf(rb, a) : -1;
  return b < 0 ? null : text.slice(a, b);
}
// Boundaries around the value at `at` that capture exactly it as the FIRST match: start from `lb0`, or the text just
// before the value, and widen to the left (same line) until the first match is the value itself
function safeBoundaries(text, at, s, lb0, rb0) {
  var after = text.slice(at + s.length, at + s.length + 12);
  var rb = rb0 || ((/^["'&;,<\s}\])]/.exec(after) || [after.charAt(0)])[0] || "");
  if (!rb) return null;
  var lineStart = text.lastIndexOf("\n", at - 1) + 1;
  var minLen = lb0 && text.slice(at - lb0.length, at) === lb0 ? lb0.length : Math.min(6, at - lineStart);
  for (var len = Math.max(1, minLen); at - len >= Math.max(0, lineStart - 0) && len <= 120; len++) {
    var lb = text.slice(at - len, at);
    if (firstMatch(text, lb, rb) === s) return { lb: lb, rb: rb };
  }
  return null;
}
function safeName(n) { n = String(n || "value").replace(/[^A-Za-z0-9_]/g, "_").replace(/^_+|_+$/g, ""); return /^[A-Za-z]/.test(n) ? n : "c_" + (n || "value"); }
function correlation(v, src, later) {
  var x = E[src.n - 1]; if (!x) return null;
  var s = (variants(v).filter(function (f) { return f.form === src.enc; })[0] || { s: v }).s;   // the value as it is in the response
  var type, cfg, name, label, warn = [];
  if (src.kind === "json" && src.path) {
    type = "jsonpath"; cfg = { path: src.path }; name = _advSuggestName(src.path, null, v); label = "JSON field " + src.path;
  } else if (src.kind === "setcookie") {
    var cn = src.where.split(" ")[1];
    type = "cookie"; cfg = { cookieName: cn }; name = _advSuggestName(null, cn, v); label = "the " + cn + " cookie (Set-Cookie)";
  } else if (src.header) {
    var h = x.resH.filter(function (y) { return y.name === src.header && String(y.value).indexOf(s) >= 0; })[0];
    var hv = String(h.value), at = hv.indexOf(s), suffix = hv.slice(at + s.length);
    type = "boundary_header"; cfg = { lb: h.name + ": " + hv.slice(0, at), rb: "\r\n" };
    name = src.kind === "location" ? _advSuggestName(null, null, v) : _advSuggestName(null, h.name, v);
    label = "the " + h.name + " header";
    if (suffix) warn.push("The value is followed by more text in the " + h.name + " header (“" + suffix.slice(0, 30) + "”) — the extractor reads to the end of the line; check the captured value.");
  } else {
    var text = x.resBody, at2 = text.indexOf(s), b = null;
    if (src.field && text.indexOf('name="' + src.field + '" value="' + s + '"') >= 0 && firstMatch(text, 'name="' + src.field + '" value="', '"') === s) {
      type = "html"; cfg = { selector: "input[name='" + src.field + "']", attr: "value" }; label = "the HTML field " + src.field;   // Studio's own selector form
    } else {
      var ctx = advPasteDetect(text, s) || {};
      if (ctx.extType === "jsonpath" && ctx.path && !src.enc) { type = "jsonpath"; cfg = { path: ctx.path }; label = "JSON field " + ctx.path; }
      else {
        b = safeBoundaries(text, at2, s, ctx.extType === "boundary" && ctx.contextType !== "generic" ? ctx.lb : null, ctx.extType === "boundary" && ctx.contextType !== "generic" ? ctx.rb : null);
        if (!b) return { error: "No left / right boundary in this response captures exactly this value — use Paste & Detect in Script Studio." };
        type = "boundary"; cfg = { lb: b.lb, rb: b.rb }; label = ctx.contextLabel && ctx.contextType !== "generic" ? ctx.contextLabel : "the response body";
      }
      name = ctx.varName || _advSuggestName(null, null, v);
      if (b && b.lb.length > 40) warn.push("The left boundary is long because the page has the same field more than once (for example a list of options) — it captures the one in the same place as in the recording. For a choice from a list, a random pick may suit a load test better.");
    }
    if (src.field) name = src.field;   // an HTML field: its own name says most
  }
  if (src.enc) warn.push("In the response the value is " + src.enc + " — the captured text is in that form.");
  var enc = later.filter(function (u) { return u.enc; });
  if (enc.length) warn.push("It is sent " + enc[0].enc + " in " + enc.map(function (u) { return "#" + u.n; }).join(", ") + " — check that the script encodes the captured value there.");
  name = safeName(name);
  var c = { name: name, extractorType: type, extractorConfig: cfg };
  // where it is sent back, in Script Studio's usage form (Studio's own search misses encoded form values, for example)
  var uses = later.map(function (u) {
    var y = E[u.n - 1], m;
    if ((m = /^form field (.+)$/.exec(u.where))) return { id: y.si + 1, location: "body_form", jsonPath: m[1] };
    if ((m = /^JSON body (.+)$/.exec(u.where))) return { id: y.si + 1, location: "body_json", jsonPath: m[1] };
    if ((m = /^query parameter (.+)$/.exec(u.where))) return { id: y.si + 1, location: "query", jsonPath: m[1] };
    if ((m = /^header (.+)$/.exec(u.where))) return { id: y.si + 1, location: "header", jsonPath: m[1] };
    if (u.where === "address") return { id: y.si + 1, location: "url_path", jsonPath: null };
    return null;   // cookies: VuGen and DevWeb send them by themselves
  }).filter(Boolean);
  return {
    name: name, extractorType: type, extractorConfig: cfg, label: label, warn: warn, studioId: x.si + 1, uses: uses,   // Script Studio's request id (parseHar) — never shifts
    vugen: webHttpCorrCode(c, "\t"), devweb: devwebExtractorDecl(c),
  };
}

// sent back after request `after` by a request in the script — not as a cookie, not in the Referer / Origin copy of
// the page address
function sentBack(v, after) {
  var forms = variants(v);
  return E.some(function (o) {
    return o.n > after && !OUT[o.n] && forms.some(function (f) {
      return o.url.indexOf(f.s) >= 0 || (o.reqBody && o.reqBody.indexOf(f.s) >= 0) || o.reqH.some(function (h) { return !/^(cookie|referer|origin)$/i.test(h.name) && h.name.charAt(0) !== ":" && String(h.value).indexOf(f.s) >= 0; });
    });
  });
}

// ── the Explorer's own suggestions: values the server sends that a later request sends back ──
// not a web address or a path (those are page links, not values that change)
function dynamic(v) {
  if (/^(https?:|\/|www\.)|:\/\/|%3A%2F%2F/i.test(v)) return false;
  return v.length >= 16 || (v.length >= 8 && /\d/.test(v) && /[A-Za-z]/.test(v) && !/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(v));
}
// Every value a request in the script sends, whole (query and form values, path segments, header values and their
// parts, JSON body fields) → the last request that sends it. Checking a suggestion is then one look-up, not a scan of
// the whole recording (a 20,000-request file took over a minute the other way).
var SENT = null;
function sentIndex() {
  SENT = new Map();
  function put(s, n) { s = String(s == null ? "" : s).trim(); if (s.length < 6 || s.length > 4000) return; SENT.set(s, n); try { var d = decodeURIComponent(s.replace(/\+/g, " ")); if (d !== s) SENT.set(d, n); } catch (e) { /* not encoded */ } }
  function leaves(o, n) { if (typeof o === "string" || typeof o === "number") put(o, n); else if (o && typeof o === "object") Object.keys(o).forEach(function (k) { leaves(o[k], n); }); }
  E.forEach(function (x) {
    if (OUT[x.n]) return;
    var n = x.n, u = x.url.split("#")[0], path = u.replace(/^[a-z]+:\/\/[^/]*/i, "").split("?")[0];
    path.split(/[/;]/).forEach(function (seg) { put(seg, n); var i = seg.indexOf("="); if (i > 0) put(seg.slice(i + 1), n); });
    x.query.forEach(function (p) { put(p.value, n); });
    x.reqH.forEach(function (h) {
      if (/^(cookie|referer|origin)$/i.test(h.name) || h.name.charAt(0) === ":") return;
      put(h.value, n); String(h.value).split(/[\s,;]+/).forEach(function (p) { put(p, n); var i = p.indexOf("="); if (i > 0) put(p.slice(i + 1), n); });
    });
    x.params.forEach(function (p) { put(p.value, n); });
    var b = x.reqBody;
    if (b) {
      var t = b.trim();
      if (t.charAt(0) === "{" || t.charAt(0) === "[") { try { leaves(JSON.parse(t), n); } catch (e) { put(t, n); } }
      else if (/^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(t)) t.split("&").forEach(function (p) { var i = p.indexOf("="); put(i < 0 ? p : p.slice(i + 1), n); });
      else put(t, n);
    }
  });
}
function sentBackFast(v, after) {
  if (!SENT) sentIndex();
  return variants(v).some(function (f) { var n = SENT.get(f.s); return n != null && n > after; });
}
function ownSuggestions(skip) {
  var seen = {}, out = [];
  E.forEach(function (x) {
    var cand = [], body = x.resBody;
    if (/json/i.test(x.mime) && body) {
      try { (function walk(o, k) { if (typeof o === "string" && o.length >= 6 && o.length <= 2000 && !/\s/.test(o)) cand.push([k, o]); else if (o && typeof o === "object") Object.keys(o).forEach(function (kk) { walk(o[kk], Array.isArray(o) ? k : kk); }); })(JSON.parse(body), "value"); } catch (e) { /* not JSON */ }
    }
    if (/html/i.test(x.mime) && body) {
      var re = /name=["']([^"']+)["'][^>]*value=["']([^"']{6,})["']/g, m;
      while ((m = re.exec(body))) cand.push([m[1], m[2]]);
      var re2 = /[?&;]([A-Za-z_][\w.-]{0,40})=([^&"'#\s<>;]{8,200})/g;   // values in the page's links (…;jsessionid=…, ?token=…)
      while ((m = re2.exec(body))) cand.push([m[1], m[2]]);
    }
    x.resH.forEach(function (h) { if (/^location$/i.test(h.name)) { var seg = String(h.value).split(/[/?&=;]/).pop(); if (seg && seg.length >= 5) cand.push(["redirect", seg]); } });
    cand.forEach(function (c) {
      var k = c[0], v = c[1];
      if (seen[v] || skip[v] || !dynamic(v)) return;
      seen[v] = 1;
      if (sentBackFast(v, x.n)) out.push({ value: v, name: k, by: "explorer" });
    });
  });
  var likely = function (k) { return /token|session|csrf|xsrf|nonce|state|key|code|id$|^id/i.test(k) ? 0 : 1; };
  return out.sort(function (a, b) { return likely(a.name) - likely(b.name); }).slice(0, 10);
}

var STUDIO = {}, OUT = {};   // OUT: numbers of the requests the Recorder's rules leave out of the script (from the page)
onmessage = function (ev) {
  var d = ev.data;
  try {
    if (d.type === "studio") {
      // A second copy of this worker only runs Script Studio's analysis (on a very large recording it can take a minute,
      // and Find a value must not wait for it)
      var log = console.log; console.log = function () {};
      try { postMessage({ type: "studio", list: studioFindings(JSON.parse(d.text)) }); } finally { console.log = log; }
      return;
    }
    if (d.type === "studioList") {
      // Studio's findings arrived: keep those a request in the script sends back, put them first, and suggest again
      STUDIO = {};
      var list = (d.list || []).filter(function (s) { return sentBack(s.value, 0); });
      list.forEach(function (s) { STUDIO[s.value] = s; });
      postMessage({ type: "ready", suggestions: list.concat(ownSuggestions(STUDIO)), studioCount: list.length, studioDone: true });
      return;
    }
    if (d.type === "load") {
      var har = JSON.parse(d.text), withReq = 0;
      OUT = {}; (d.out || []).forEach(function (n) { OUT[n] = true; });
      SENT = null;
      E = ((har.log && har.log.entries) || []).map(function (e, i) {
        var rq = e.request || {}, rs = e.response || {}, pd = rq.postData || {};
        var url = rq.url || "", q = url.split("?")[1] || "";
        return {
          n: i + 1, url: url, method: rq.method || "GET",
          query: (rq.queryString && rq.queryString.length ? rq.queryString : q.split("#")[0].split("&").filter(Boolean).map(function (p) { var k = p.indexOf("="); return { name: k < 0 ? p : p.slice(0, k), value: k < 0 ? "" : p.slice(k + 1) }; })),
          reqH: rq.headers || [], reqBody: pd.text || "", params: pd.params || [],
          resH: rs.headers || [], resBody: decodeBody(rs.content), mime: (rs.content && rs.content.mimeType) || "",
        };
      }).map(function (x, i) {
        // a page / API answer the HAR kept no body of (served from the browser's cache, or not kept)
        var rs = (har.log.entries[i] || {}).response || {};
        // Script Studio's request id is this + 1 (parseHar numbers the entries that have a request)
        x.si = withReq; if (har.log.entries[i] && har.log.entries[i].request) withReq++;
        x.noBody = !x.resBody && rs.status === 200 && x.method !== "HEAD" && /html|json|xml|javascript|text\/plain/i.test(x.mime);
        return x;
      });
      // the Explorer's own suggestions at once; Studio's findings follow (message "studioList") when they are ready
      STUDIO = {};
      postMessage({ type: "ready", suggestions: ownSuggestions(STUDIO), studioCount: 0, studioDone: false });
    } else if (d.type === "find") {
      postMessage({ type: "found", id: d.id, result: d.value ? investigate(d.value) : null });
    }
  } catch (e) { postMessage({ type: "error", message: e.message }); }
};
