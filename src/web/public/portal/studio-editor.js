/* Script Studio — step 2, the correlation editor: one value at a time (window.SSE on the page; UMD StudioEdit for the
 * pure helpers, unit-tested in tests/unit/studioEditor.test.js).
 * Left: why it was found, the response it is read from, how it is read (Auto = the engine's choice, JSON path,
 * Boundaries, Header), tested as you type, the name, the code the script gets. Right: that response (Body / Headers;
 * select or double-click a value to read it from there) and every request that sends the value back.
 * The choice is kept on the candidate as _edit = { extractorType, extractorConfig, sourceIdx }, which the engine's
 * advisorToCorrelation honours; the code shown is the generators' own (webHttpCorrCode / devwebExtractorDecl) for the
 * correlation advisorToCorrelation builds, so it is what the script gets. Accept ticks the value (advisorAccept);
 * "Add n to the script" in the table puts it in. A value already in the script is shown, not changed; a value no
 * later request sends back cannot be accepted.
 * Add manual correlation (SSE.add()) is the same screen for a new value: choose the request (by default only those
 * whose response has a value a later request sends back — StudioEdit.sentIndex / valuesOf), select the value or click
 * one of the marked ones; the value is what the extractor reads, its uses are the engine's (_advFindUsages); Add to
 * the script = advisorAddManual + _edit + advisorApplyOne (this value only) + regenerate. Keep, pick another puts the
 * value in "Values to add" (tray) and starts the next one; Add all n puts every kept value in (one regeneration).
 * Regex: the first ( ) group of a regular expression is the value (VuGen web_reg_save_param_regexp, DevWeb
 * RegexpExtractor; tried here with the browser's engine). XPath: for XML responses (VuGen web_reg_save_param_xpath with
 * local-name() steps — VugenCodegen.vugenXpath — DevWeb XpathExtractor with the plain names; tried here in the
 * local-name() form, which matches both).
 * A list (the Correlation Advisor's _selectAll / _arrayReconstruct) is read as the Advisor found it; the editor shows its
 * options instead of the ways to read it: every value or one at random (advisorSetListPick), or, for a list a later
 * request sends back rebuilt, its columns, the loop anchor (advisorSetArrayAnchor) and Fill the missing paths
 * (advisorFillArrayPaths) — the engine functions the cards use. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioEdit = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // the value at a JSON path ($.a.b[0].c, ['x'], [*] = every element: the first counts, as a single extractor reads)
  // → { value } | { none: true } | { unknown: true } (a path this reader does not follow: .., filters, functions)
  function jget(obj, path) {
    var r = jnodes(obj, path);
    if (!r.nodes) return r;
    var v = r.nodes[0];
    return { value: v !== null && typeof v === "object" ? JSON.stringify(v) : String(v) };
  }
  // every node a JSON path reaches → { nodes } | { none: true } | { unknown: true }
  function jnodes(obj, path) {
    path = String(path || "");
    if (path.charAt(0) !== "$" || /\.\.|\?\(|\(\)/.test(path)) return { unknown: true };
    var re = /\.([^.[\]]+)|\[(\d+|\*|'[^']*'|"[^"]*")\]/g, cur = [obj], pos = 1, m;
    while (pos < path.length) {
      re.lastIndex = pos; m = re.exec(path);
      if (!m || m.index !== pos) return { unknown: true };
      pos = re.lastIndex;
      var k = m[1] != null ? m[1] : m[2].replace(/^['"]|['"]$/g, ""), next = [];
      cur.forEach(function (o) {
        if (o == null || typeof o !== "object") return;
        if (k === "*") (Array.isArray(o) ? o : Object.keys(o).map(function (x) { return o[x]; })).forEach(function (v) { next.push(v); });
        else if (Object.prototype.hasOwnProperty.call(o, k)) next.push(o[k]);
      });
      cur = next;
      if (!cur.length) return { none: true };
    }
    return { nodes: cur };
  }
  // what a list's extractor reads, in order and with repeats (the places VuGen's name_1 … name_N and DevWeb's array
  // give): every plain value a JSON path reaches, or every match of a pair of boundaries
  function jsonAll(body, path) {
    var o = parse(String(body || "")), r = o === undefined ? {} : jnodes(o, path);
    return (r.nodes || []).filter(function (v) { return v !== null && typeof v !== "object"; }).map(String);
  }
  function boundAll(body, lb, rb) { return boundAt(body, lb, rb).map(function (m) { return m.v; }); }
  function boundAt(body, lb, rb) {
    var out = [], i = 0, j, k; body = String(body || "");
    if (!lb || !rb) return out;
    while ((j = body.indexOf(lb, i)) !== -1) {
      k = body.indexOf(rb, j + lb.length); if (k === -1) break;
      out.push({ v: body.slice(j + lb.length, k), at: j + lb.length }); i = k + rb.length;
    }
    return out;
  }
  // the value of one attribute in every <tag …>, whatever comes before it: <option\b[^>]*?\svalue="([^"]*)"
  function attrPattern(tag, attr, q) {
    var e = function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); };
    return "<" + e(tag) + "\\b[^>]*?\\s" + e(attr) + "=" + q + "([^" + q + "]*)" + q;
  }
  // every match of a regular expression whose first group ends right before its last character (an attribute's
  // closing quote): { v, at } with at = where the value starts
  function regexAt(body, pattern) {
    var out = [], re, m;
    try { re = new RegExp(pattern, "g"); } catch (x) { return out; }
    while ((m = re.exec(body))) {
      if (m[1] != null) out.push({ v: m[1], at: m.index + m[0].length - 1 - m[1].length });
      if (!m[0]) re.lastIndex++;
    }
    return out;
  }
  function regexAll(body, pattern) { return regexAt(String(body || ""), pattern).map(function (x) { return x.v; }); }
  // A list from one of its values (at = where it starts in the body; span = a selected section {at, len}):
  //  - JSON: the value's path with its last index as [*] ($.items[2].id → $.items[*].id), every match
  //  - a page: the same tag and attribute (<option value=") or the same opening tag (<td class="x"> … </td), every
  //    match; the list is the matches inside the section selected, else inside the <select> around the value, else all
  // → { ext, values, from, to, name, about } (from / to: 1-based, among every match) | { why }
  function listFrom(body, at, v, findPath, span) {
    body = String(body || ""); v = String(v || "");
    var o = parse(body), r, ms, from = 1, to, name, about;
    if (o !== null && typeof o === "object") {
      var p = findPath ? findPath(body, v) : null;
      if (!p || !/\[\d+\]/.test(p)) return { why: "This value is not one of a JSON list (its path has no [n])." };
      var star = p.replace(/\[\d+\](?!.*\[\d+\])/, "[*]"), vals = jsonAll(body, star);
      ms = []; var pos = 0;
      vals.forEach(function (x) { var q = JSON.stringify(x).slice(1, -1), k = body.indexOf(q, pos); ms.push({ v: x, at: k }); if (k !== -1) pos = k + q.length; });
      var key = (star.replace(/\[\*\]$/, "").match(/([A-Za-z_$][\w$]*)(?:\[\d+\])?$/) || [])[1] || "value";
      // a generic field takes its list's name: $.seats[*].id → seatId
      var parent = (star.match(/([A-Za-z_$][\w$]*)\[\*\][^[]*$/) || [])[1];
      if (parent && /^(id|value|name|key|code|uuid|token)$/i.test(key)) key = parent.replace(/ies$/, "y").replace(/s$/, "") + key.charAt(0).toUpperCase() + key.slice(1);
      r = { ext: { extractorType: "jsonpath", extractorConfig: { path: star, selectAll: true } } };
      name = key + "Arr"; about = "JSON path <code>" + star + "</code>";
    } else {
      var lt = body.lastIndexOf("<", at), pre = lt === -1 ? "" : body.slice(lt, at), lb, rb, m;
      if (pre.indexOf(">") === -1 && (m = /^<([A-Za-z][\w:-]*)\b[^<>]*?\s([\w:-]+)\s*=\s*(["'])$/.exec(pre))) {
        // an attribute: a regular expression, so the same attribute is read whatever comes before it in the tag
        // (<option selected="selected" value="…"> as well as <option value="…">), every match
        var pat = attrPattern(m[1], m[2], m[3]);
        ms = regexAt(body, pat);
        r = { ext: { extractorType: "regexp", extractorConfig: { pattern: pat, all: true } } };
        about = "the <code>" + m[2] + "</code> of every <code>&lt;" + m[1] + "&gt;</code>";
      } else if ((m = /^<([A-Za-z][\w:-]*)\b[^<>]*>$/.exec(pre))) {
        lb = pre; rb = "</" + m[1];
        about = "the text of every <code>" + pre.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</code>";
        ms = boundAt(body, lb, rb);
        r = { ext: { extractorType: "boundary", extractorConfig: { lb: lb, rb: rb, all: true } } };
      } else return { why: "Select a value inside a tag (an option, a link, a cell) to read every one like it." };
      var sel = body.lastIndexOf("<select", at), selEnd = sel === -1 ? -1 : body.indexOf("</select", sel);
      if (sel !== -1 && selEnd > at) {
        if (!span) span = { at: sel, len: selEnd - sel };   // a section selected keeps its own range; the name is the select's
        var sn = /^<select\b[^>]*\bname\s*=\s*["']([^"']+)/i.exec(body.slice(sel, sel + 300));
        if (sn) name = sn[1].replace(/[^\w]/g, "_") + "Options";
        about += sn ? " in <code>&lt;select name=\"" + sn[1].replace(/&/g, "&amp;").replace(/</g, "&lt;") + "\"&gt;</code>" : " in its &lt;select&gt;";
      }
      if (!name) name = (m[2] || m[1]) + "Arr";
    }
    if (ms.every(function (x) { return x.at !== at; })) return { why: "That value is not one of the matches." };
    to = ms.length;
    if (span) {
      var inside = ms.map(function (x, i) { return x.at >= span.at && x.at < span.at + span.len ? i + 1 : 0; }).filter(Boolean);
      if (inside.length) { from = inside[0]; to = inside[inside.length - 1]; }
    }
    if (to - from + 1 < 2) return { why: "Only one value: not a list." };
    r.values = ms.map(function (x) { return x.v; }); r.from = from; r.to = to; r.name = name; r.about = about;
    return r;
  }
  // the values a list reads from a JSON response (every match of each path; plain values only, each once)
  function listValues(body, paths) {
    var o = parse(String(body || "")), out = [], seen = {};
    if (o === undefined) return out;
    (paths || []).forEach(function (p) {
      (jnodes(o, p).nodes || []).forEach(function (v) {
        if (v === null || typeof v === "object") return;
        v = String(v); if (v && !seen[v]) { seen[v] = 1; out.push(v); }
      });
    });
    return out;
  }
  function parse(text) { try { return JSON.parse(text); } catch (e) { return undefined; } }
  function hdr(entry, name) {
    var map = entry && entry.respHdrsMap || {}, k = String(name || "").toLowerCase();
    return Object.prototype.hasOwnProperty.call(map, k) ? String(map[k]) : null;
  }
  // a regular expression for the editor: the first ( ) group is the value → { re } | { bad }
  function compile(pattern) {
    var re;
    try { re = new RegExp(String(pattern || "")); } catch (e) { return { bad: "Not a valid regular expression." }; }
    if (!pattern) return { bad: "Type a regular expression." };
    if (new RegExp(String(pattern) + "|").exec("").length < 2) return { bad: "Put the value in a ( ) group: the first group is what is read." };
    return { re: re };
  }
  // what an extractor reads from one response (firstMatch = the engine's _advFirstMatch; xp(body, path) = the page's
  // XPath reader → { value } | { none } | { bad })
  function readWith(entry, ext, firstMatch, xp) {
    if (!entry || !ext) return { none: true };
    var body = String(entry.respBody || ""), cfg = ext.extractorConfig || {};
    if (ext.extractorType === "jsonpath") {
      var o = parse(body);
      return o === undefined ? { none: true, why: "not JSON" } : jget(o, cfg.path);
    }
    if (ext.extractorType === "boundary") {
      if (!cfg.lb || !cfg.rb) return { unknown: true };
      var v = firstMatch(body, cfg.lb, cfg.rb);
      return v == null ? { none: true } : { value: v };
    }
    if (ext.extractorType === "regexp") {
      var c = compile(cfg.pattern); if (c.bad) return { bad: c.bad };
      var m = c.re.exec(body);
      return !m ? { none: true } : m[1] == null ? { none: true } : { value: m[1] };
    }
    if (ext.extractorType === "xpath") return xp ? xp(body, cfg.path) : { unknown: true };
    if (ext.extractorType === "boundary_header" && /^[\r\n]*$/.test(cfg.rb || "")) {
      var h = hdr(entry, String(cfg.lb || "").replace(/:\s*$/, ""));
      return h == null ? { none: true } : { value: h };
    }
    return { unknown: true };
  }
  // the headers of a response that carry the value exactly
  function headersWith(entry, value) {
    var map = entry && entry.respHdrsMap || {};
    return Object.keys(map).filter(function (k) { return String(map[k]) === value; });
  }
  // an extractor for a value selected in a response body: JSON path when the body is JSON and the engine finds the
  // value's path (findPath = findJsonPath), else boundaries that capture it as the first match (safe = _advSafeBoundaries)
  function fromSelection(entry, at, s, kind, findPath, safe) {
    var body = String(entry && entry.respBody || "");
    if (!s || body.slice(at, at + s.length) !== s) return null;
    if (kind === "any" || kind === "jsonpath") {
      var o = parse(body), p = o !== undefined && findPath ? findPath(body, s) : null;
      if (p && jget(o, p).value === s) return { extractorType: "jsonpath", extractorConfig: { path: p } };
      if (kind === "jsonpath") return null;
    }
    var b = readable(body, at, safe(body, at, s));
    if (b && kind === "regexp") {
      var p = rx(b.lb) + (/[\r\n]/.test(s) ? "([\\s\\S]+?)" : "(.+?)") + rx(b.rb), c = compile(p), m = c.re && c.re.exec(body);
      return m && m[1] === s ? { extractorType: "regexp", extractorConfig: { pattern: p } } : null;
    }
    return b ? { extractorType: "boundary", extractorConfig: { lb: b.lb, rb: b.rb } } : null;
  }
  // boundaries a person can read: the left one widened to the start of its token (content=" → not tent=", the
  // attribute name with name="x" value=", "key":" in JSON), kept only while its first match is still the value
  function readable(body, at, b) {
    if (!b || body.slice(at - b.lb.length, at) !== b.lb) return b;
    // token by token to the left (at most 4, never past the start of a tag or 80 characters) until it is the first match
    var i = at - b.lb.length, lim = Math.max(0, i - 80);
    for (var n = 0; n < 4 && i > lim; n++) {
      while (i > lim && !/[\s<>{},;&?[]/.test(body.charAt(i - 1))) i--;
      var lb = body.slice(i, at);
      if (lb.length > b.lb.length && body.indexOf(lb) + lb.length === at) return { lb: lb, rb: b.rb };
      if (/[<>{}[]/.test(body.charAt(i - 1))) break;
      while (i > lim && /\s/.test(body.charAt(i - 1))) i--;
    }
    return b;
  }
  // a name for a value from the text in front of it: name="vs" value="… → vs, "nonce":"… → nonce, <Token>… → Token
  function nameBefore(body, at) {
    var pre = String(body || "").slice(Math.max(0, at - 160), at), m;
    m = pre.match(/name\s*=\s*["']([\w.-]+)["'][^<>]*value\s*=\s*["']$/i) || pre.match(/([A-Za-z_][\w-]*)["']?\s*[:=]\s*["']?$/) || pre.match(/<(?:[\w.-]+:)?([A-Za-z_][\w.-]*)(?:\s[^<>]*)?>$/);
    return m ? m[1] : "";
  }
  // a name for an XPath: its element, or element + attribute (/a/build/@id → buildId)
  function nameOfXpath(p) {
    var m = String(p || "").match(/([A-Za-z_][\w.-]*)(?:\[\d+\])?\/@([A-Za-z_][\w.-]*)$/);
    if (m) return m[1] + m[2].charAt(0).toUpperCase() + m[2].slice(1);
    m = String(p || "").match(/([A-Za-z_][\w.-]*)(?:\[\d+\])?$/);
    return m ? m[1] : "";
  }
  // text as a regular expression that matches it literally (the same in the browser, VuGen and DevWeb)
  function rx(s) { return String(s).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&").replace(/\r/g, "\\r").replace(/\n/g, "\\n").replace(/\t/g, "\\t"); }

  // ── Add manual correlation: which values of a response a later request sends back ──
  // Response headers that are never a value to correlate (and Set-Cookie: cookies are sent back by the engine itself).
  var SKIP_HDRS = { "content-type": 1, "content-length": 1, "content-encoding": 1, "transfer-encoding": 1, "connection": 1, "date": 1, "server": 1,
    "x-powered-by": 1, "x-frame-options": 1, "strict-transport-security": 1, "x-content-type-options": 1, "x-xss-protection": 1,
    "access-control-allow-origin": 1, "access-control-allow-methods": 1, "access-control-allow-headers": 1, "access-control-allow-credentials": 1,
    "access-control-max-age": 1, "access-control-expose-headers": 1, "vary": 1, "cache-control": 1, "pragma": 1, "expires": 1, "etag": 1,
    "last-modified": 1, "p3p": 1, "x-ua-compatible": 1, "content-security-policy": 1, "set-cookie": 1, "age": 1, "accept-ranges": 1,
    "keep-alive": 1, "referrer-policy": 1, "permissions-policy": 1, "alt-svc": 1, "nel": 1, "report-to": 1 };
  // words that are sent back but are not values to correlate (the word before a token, booleans, common types)
  var WORDS = /^(true|false|null|none|undefined|bearer|basic|digest|negotiate|token|json|text|html|success|error|enabled|disabled|active|https?|application\/json|text\/html|text\/plain)$/i;
  // an address or a file (a link, a frame, a form action): the page sends it, it is not a value the server makes per user
  var ADDR = /^(https?:\/\/|\/|\.\.?\/|#|mailto:|javascript:)|\.(html?|php|pl|aspx?|jsp|cgi|js|mjs|css|png|gif|jpe?g|svg|ico|webp|woff2?|ttf|map|pdf)(\?|#|$)/i;
  // The values a response gives that could be correlated: JSON leaves (strings and numbers, with their path), else the
  // value="…" attributes of an HTML / text page, and the response headers above. 4 to 2000 characters, no spaces,
  // not a 1–3 digit number, not one of the WORDS; each value once.
  function valuesOf(entry) {
    var out = [], seen = {};
    function add(v, where, kind) {
      v = String(v);
      if (v.length < 4 || v.length > 2000 || /\s/.test(v) || /^\d{1,3}$/.test(v) || WORDS.test(v) || ADDR.test(v) || seen[v]) return;
      seen[v] = 1; out.push({ value: v, where: where, kind: kind });
    }
    var body = String(entry && entry.respBody || ""), o = body ? parse(body) : undefined, n = 0;
    (function walk(x, p, d) {
      if (d > 30 || n > 5000 || x == null) return;
      if (typeof x === "string" || typeof x === "number") { n++; add(x, p, "json"); return; }
      if (typeof x !== "object") return;
      if (Array.isArray(x)) x.forEach(function (v, i) { walk(v, p + "[" + i + "]", d + 1); });
      else Object.keys(x).forEach(function (k) { walk(x[k], /^[A-Za-z_$][\w$]*$/.test(k) ? p + "." + k : p + "['" + k + "']", d + 1); });
    })(o !== null && typeof o === "object" ? o : undefined, "$", 0);
    if (!(o !== null && typeof o === "object") && body) {
      var re = /\bvalue\s*=\s*(["'])([^"'<>]{4,2000})\1/gi, m;
      while ((m = re.exec(body))) add(m[2], "page", "body");
      // "name": "value" pairs in a page or text (JSON inside a script tag), and the text of XML elements
      var kv = /"[\w$.-]{1,80}"\s*:\s*"([^"\\<>]{4,2000})"/g;
      while ((m = kv.exec(body))) add(m[1], "page", "body");
      var tx = /<([\w.-]+(?::[\w.-]+)?)(?:\s[^<>]*)?>([^<>&\s]{4,2000})<\/\1>/g;
      while ((m = tx.exec(body))) add(m[2], "page", "body");
      // other attributes (an XML id="…"); only those sent back are marked. Not the attributes that name or shape the
      // page (a form field's name is sent back as the field's name, not a value), nor an HTML page's id
      var at = /\s([\w:.-]+)\s*=\s*"([^"<>\s]{4,2000})"/g, html = /<(!doctype\s+html|html|body|form|div|select|input)\b/i.test(body);
      var SHAPE = /^(name|class|type|for|method|action|href|src|rel|style|lang|charset|target|role|title|alt|placeholder|autocomplete|enctype|http-equiv|xmlns(:.*)?|xml:lang|width|height|align|border|size|maxlength)$/i;
      while ((m = at.exec(body))) if (!SHAPE.test(m[1]) && !(html && /^id$/i.test(m[1]))) add(m[2], "page", "body");
    }
    var map = entry && entry.respHdrsMap || {};
    Object.keys(map).sort().forEach(function (k) { if (!SKIP_HDRS[k.toLowerCase()]) add(map[k], k, "header"); });
    return out;
  }
  // Everything the requests send (address, headers except Cookie, body — as recorded and URL-decoded), for one
  // question: does a request after entries[i] send this value? → later(value, i). Built once per recording.
  var DELIM = /[\s"'&=?;,:{}[\]()<>\\|/+]+/;
  function sentIndex(entries) {
    var last = new Map(), text = [], off = [], len = 0;
    (entries || []).forEach(function (e, i) {
      off[i] = len;
      if (!e || e.isMarker || e.filtered) return;
      var s = String(e.url || "") + "\n" + (e.reqHdrs || []).filter(function (h) { return String(h.name).toLowerCase() !== "cookie"; })
        .map(function (h) { return h.name + ": " + h.value; }).join("\n") + "\n" + String(e.body && e.body.text || "");
      var d = s; try { d = decodeURIComponent(s.replace(/\+/g, " ")); } catch (x) { /* not URL-encoded */ }
      var all = d === s ? s : s + "\n" + d;
      all.split(DELIM).forEach(function (t) { if (t.length >= 4) last.set(t, i); });
      text.push(all, "\n\u0000\n"); len += all.length + 3;
    });
    off[(entries || []).length] = len;
    var big = text.join("");
    return {
      later: function (v, i) {
        v = String(v); if (v.length < 4) return false;
        if (!DELIM.test(v)) { var j = last.get(v); return j !== undefined && j > i; }
        return big.lastIndexOf(v) >= off[i + 1];
      },
    };
  }
  // the values of entries[i]'s response that a later request sends back
  function laterValues(entries, i, idx) {
    return valuesOf(entries[i]).filter(function (v) { return idx.later(v.value, i); });
  }
  // Test (Correlate): one correlation checked against the recording — what it reads from its response, how many
  // matches its boundaries / pattern have, and for every place it is sent back whether that request sent the value read;
  // with a second recording, what it reads from the same response there (a value worth correlating changes).
  // o = { entries, corr: { extractorType, extractorConfig, sourceIdx, usages: [{ reqIdx, tokenValue, location, key }] },
  //       firstMatch, xp, entries2 }
  // → { verdict: ok | differs | none | bad | unknown | runtime, value, values (a list), matches, distinct,
  //     places: [{ reqIdx, sent, same }], second: null | { found, value, differs }, why }
  function sameReq(entries, i, entries2) {
    var key = function (x) { return String(x.method || "") + " " + String(x.url || "").split("?")[0]; };
    var e = entries[i]; if (!e) return null;
    var want = key(e), k = 0, n = 0;
    for (var j = 0; j < i; j++) if (entries[j] && !entries[j].isMarker && key(entries[j]) === want) k++;
    for (var m = 0; m < (entries2 || []).length; m++) {
      var x = entries2[m];
      if (x && !x.isMarker && key(x) === want) { if (n === k) return x; n++; }
    }
    return null;
  }
  function uniq(a) { var s = {}, o = []; a.forEach(function (v) { if (!s[v]) { s[v] = 1; o.push(v); } }); return o; }
  function check(o) {
    var corr = (o && o.corr) || {}, entries = (o && o.entries) || [], t = corr.extractorType, cfg = corr.extractorConfig || {};
    var res = { verdict: "ok", value: null, values: null, matches: null, distinct: null, places: [], second: null, why: "" };
    if (t === "pkce" || t === "array_reconstruct" || t === "uuid" || t === "generate") { res.verdict = "runtime"; return res; }
    var src = corr.sourceIdx >= 0 ? entries[corr.sourceIdx] : null;
    if (!src) { res.verdict = "none"; res.why = "no response"; return res; }
    var body = String(src.respBody || ""), list = !!(cfg.selectAll || cfg.all);
    function read(entry) {
      var b = String(entry.respBody || "");
      // a value in a response header, between boundaries other than the line end: a query value of a redirect
      // (state=…&) is read as the generators write it — a regular expression on the headers (BUG-125, BUG-126)
      if (t === "boundary_header" && !/^[\r\n]*$/.test(cfg.rb || "")) {
        var hm = entry.respHdrsMap || {}, ht = Object.keys(hm).map(function (k) { return k + ": " + hm[k]; }).join("\r\n");
        var lb = String(cfg.lb || ""), rb = String(cfg.rb || "");
        if (/=$/.test(lb) && rb === "&") {
          var hq = new RegExp("(?:^|[?&;\\s])" + lb.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([^&\\r\\n]*)").exec(ht);
          return hq ? { value: hq[1] } : { none: true };
        }
        var hv = o.firstMatch ? o.firstMatch(ht, lb, rb) : null;
        return hv == null ? { none: true } : { value: hv };
      }
      // an element of the page (a CSS selector and its attribute): read by the page's own parser when it gives one
      if (t === "html") return o.html ? o.html(b, cfg.selector, cfg.attr) : { unknown: true };
      if (list) {
        var vs = t === "jsonpath" ? jsonAll(b, cfg.path) : t === "boundary" ? boundAll(b, cfg.lb, cfg.rb) : t === "regexp" ? regexAll(b, cfg.pattern) : null;
        return vs ? { values: vs } : { unknown: true };
      }
      return readWith(entry, corr, o.firstMatch, o.xp);
    }
    var r = read(src);
    if (r.bad) { res.verdict = "bad"; res.why = r.bad; return res; }
    if (r.unknown) { res.verdict = "unknown"; return res; }
    if (list) {
      // a list that is part of the matches (the options of one <select>: o.range or the list's own from / to)
      var rg = o.range || (corr.list && corr.list.from ? corr.list : null);
      res.values = rg && rg.from ? r.values.slice(rg.from - 1, rg.to) : r.values; res.matches = r.values.length; res.distinct = uniq(res.values).length;
      if (rg && rg.from) res.range = { from: rg.from, to: rg.to };
      if (!r.values.length) { res.verdict = "none"; return res; }
    } else {
      if (r.none) { res.verdict = "none"; res.why = r.why || ""; return res; }
      res.value = String(r.value);
      var ms = t === "boundary" && cfg.lb && cfg.rb ? boundAll(body, cfg.lb, cfg.rb) : t === "regexp" && cfg.pattern ? regexAll(body, cfg.pattern) : null;
      if (ms) { res.matches = ms.length; res.distinct = uniq(ms).length; } else res.matches = 1;
    }
    (corr.usages || []).forEach(function (u) {
      var sent = u.tokenValue != null ? String(u.tokenValue) : u.originalValue != null ? String(u.originalValue) : null;
      // a value sent in a URL or a form may be URL-encoded where it was read plain (or the other way round)
      var dec = function (v) { try { return decodeURIComponent(String(v).replace(/\+/g, " ")); } catch (e) { return String(v); } };
      var hit = function (v) { return v === sent || dec(v) === dec(sent); };
      res.places.push({ reqIdx: u.reqIdx, sent: sent, same: sent == null ? null : list ? res.values.some(hit) : hit(res.value) });
    });
    if (o.entries2 && o.entries2.length) {
      var e2 = sameReq(entries, corr.sourceIdx, o.entries2);
      if (!e2) res.second = { found: false };
      else {
        var r2 = read(e2), v2s = list && r2.values ? (res.range ? r2.values.slice(res.range.from - 1, res.range.to) : r2.values) : null, v2 = list ? (v2s && v2s.length ? v2s.join(", ") : null) : r2 && r2.value != null ? String(r2.value) : null;
        res.second = { found: true, value: v2, differs: v2 != null && v2 !== (list ? res.values.join(", ") : res.value) };
      }
    }
    if (res.places.some(function (p) { return p.same === false; })) res.verdict = "differs";
    return res;
  }
  // the result in words (the editor and the Test list share it): { cls: good | warn | bad, title, notes: [] }
  function checkText(res, short) {
    var sv = function (v) { v = String(v); return v.length > 60 ? v.slice(0, 59) + "…" : v; };
    var places = (res.places || []).filter(function (p) { return p.same !== null; }), same = places.filter(function (p) { return p.same; }).length, notes = [];
    var unknown = (res.places || []).length - places.length;
    if (res.verdict === "runtime") return { cls: "good", title: "Made while the script runs", notes: ["Not read from a response — nothing to test here."] };
    if (res.verdict === "unknown") return { cls: "warn", title: "Not tried here", notes: ["This way of reading is only run by VuGen / DevWeb."] };
    if (res.verdict === "bad") return { cls: "bad", title: "The pattern is not valid", notes: [res.why] };
    if (res.verdict === "none") return { cls: "bad", title: res.why === "no response" ? "No response to read from" : "Reads nothing", notes: [res.why === "not JSON" ? "The response is not JSON." : res.why === "not XML" ? "The response is not XML." : "Nothing in the response matches."] };
    var title = res.values ? "Reads a list of " + res.values.length + " value" + (res.values.length === 1 ? "" : "s") : "Reads " + sv(res.value);
    if (res.range && res.matches > res.values.length) notes.push("Matches " + res.range.from + "–" + res.range.to + " of the " + res.matches + " the pattern finds in this response.");
    if (places.length) notes.push(same + " of " + places.length + " place" + (places.length === 1 ? "" : "s") + " sent " + (res.values ? "one of these values" : "this value") + " back" + (same === places.length ? "." : " — the others sent another value."));
    else if (!unknown) notes.push("No later request sends it back.");
    if (unknown) notes.push(unknown + " place" + (unknown === 1 ? "" : "s") + " where the value sent was not recorded.");
    if (!res.values && res.distinct > 1) notes.push(res.matches + " matches with " + res.distinct + " different values: the first one is used.");
    if (res.second) notes.push(!res.second.found ? "The second recording has no such response." : res.second.value == null ? "Reads nothing in the second recording." : res.second.differs ? "The second recording gives another value (" + sv(res.second.value) + "): it changes, as it should." : "The second recording gives the same value: check that it really changes for each user.");
    var cls = res.verdict === "differs" || !(res.places || []).length ? "warn" : res.second && res.second.found && !res.second.differs ? "warn" : !res.values && res.distinct > 1 ? "warn" : "good";
    if (short) notes = notes.slice(0, 1);
    return { cls: cls, title: title, notes: notes };
  }
  // what a list sends, iteration by iteration (Test): "random" — one at random (a sample; rnd defaults to Math.random),
  // "rotate" — the next one each iteration and round again, "nth" — always value nth (null when the list is shorter),
  // "all" — each place its own position (no per-iteration choice: null) → [{ iter, value }] | null
  function picksOf(values, pick, nth, iters, rnd) {
    var v = values || [], n = v.length, out = [];
    if (!n || !pick || pick === "all") return null;
    rnd = rnd || Math.random;
    for (var i = 1; i <= (iters || 5); i++) {
      out.push({ iter: i, value: pick === "random" ? v[Math.floor(rnd() * n)] : pick === "rotate" ? v[(i - 1) % n] : pick === "nth" ? (nth >= 1 && nth <= n ? v[nth - 1] : null) : null });
    }
    return out;
  }
  return { picksOf: picksOf, check: check, checkText: checkText, sameReq: sameReq, jget: jget, listValues: listValues, jsonAll: jsonAll, boundAll: boundAll, regexAll: regexAll, attrPattern: attrPattern, listFrom: listFrom, readWith: readWith, headersWith: headersWith, fromSelection: fromSelection, compile: compile, rx: rx, readable: readable, nameBefore: nameBefore, nameOfXpath: nameOfXpath, valuesOf: valuesOf, sentIndex: sentIndex, laterValues: laterValues };
});

(function () {
  "use strict";
  if (typeof document === "undefined" || !window.SS || !document.getElementById("ss-corr")) return;
  var SS = window.SS, $ = SS.$, $$ = SS.$$, esc = SS.esc, plural = SS.plural, E = window.StudioEdit;
  var tab = $("#ss-t-corr");
  var box = document.createElement("section");
  box.className = "ss-ed"; box.id = "ss-ed"; box.hidden = true; box.setAttribute("aria-labelledby", "ss-ed-h");
  box.innerHTML =
    '<div class="ss-ed-head" id="ss-ed-head">' +
      '<button type="button" class="ds-btn ds-btn-sm" id="ss-ed-back"><svg class="i"><use href="#i-left"/></svg>Back to the list</button>' +
      '<h2 id="ss-ed-h"></h2><span class="ss-ed-tag" id="ss-ed-tag"></span><span class="ss-grow"></span>' +
      '<span class="ss-muted" id="ss-ed-pos"></span>' +
      '<button type="button" class="ds-btn ds-btn-sm ds-btn-ghost ss-icon" id="ss-ed-prev" title="Previous value" aria-label="Previous value"><svg class="i" style="transform:rotate(180deg)"><use href="#i-chev"/></svg></button>' +
      '<button type="button" class="ds-btn ds-btn-sm ds-btn-ghost ss-icon" id="ss-ed-next" title="Next value" aria-label="Next value"><svg class="i"><use href="#i-chev"/></svg></button>' +
    "</div>" +
    '<div class="ss-ed-cols" id="ss-ed-cols">' +
      '<div class="ss-ed-left" id="ss-ed-left">' +
        '<button type="button" class="ss-ed-rail" data-ed-show="left" title="Show how it is read"><svg class="i"><use href="#i-panel"/></svg>How it is read</button>' +
        '<div class="ss-ed-lh"><b id="ss-ed-lt">How it is read</b><span class="ss-grow"></span>' +
          '<button type="button" class="ds-btn ds-btn-xs ds-btn-ghost ss-icon" data-ed-hide="left" title="Hide this panel (the response gets the space)" aria-label="Hide how it is read"><svg class="i"><use href="#i-panel"/></svg></button></div>' +
        '<p class="ss-ed-why" id="ss-ed-why"></p>' +
        '<div class="ss-ed-tray" id="ss-ed-tray" hidden><div class="ss-ed-tray-h"><b>Values to add</b><span class="ss-muted" id="ss-ed-tray-n"></span></div><ul id="ss-ed-tray-l"></ul></div>' +
        '<div class="ss-ed-sec"><span class="ss-ed-num">1</span><label class="ss-fld" for="ss-ed-src" id="ss-ed-src-l">Read from the response of</label></div>' +
        '<div class="ss-ed-find" id="ss-ed-find" hidden>' +
          '<label class="ss-search"><svg class="i"><use href="#i-search"/></svg><input class="ss-field" id="ss-ed-srcq" type="search" placeholder="Filter by address or method" aria-label="Filter the requests" /></label>' +
          '<label class="ss-check"><input type="checkbox" id="ss-ed-only" checked /> Only requests with values sent back later</label></div>' +
        '<div class="ss-ed-src"><select class="ss-field" id="ss-ed-src"></select>' +
          '<button type="button" class="ds-btn ds-btn-sm ds-btn-ghost ss-icon" id="ss-ed-src-up" title="The request before" aria-label="The request before"><svg class="i" style="transform:rotate(180deg)"><use href="#i-chev"/></svg></button>' +
          '<button type="button" class="ds-btn ds-btn-sm ds-btn-ghost ss-icon" id="ss-ed-src-down" title="The request after" aria-label="The request after"><svg class="i"><use href="#i-chev"/></svg></button></div>' +
        '<div class="ss-ed-sec"><span class="ss-ed-num">2</span><span class="ss-fld" id="ss-ed-kind-l">How to read it</span></div>' +
        '<span class="ss-seg ss-ed-kind" id="ss-ed-kind" role="group" aria-labelledby="ss-ed-kind-l">' +
          '<button type="button" data-kind="auto" aria-pressed="true" title="What the Correlation Advisor chose">Auto</button>' +
          '<button type="button" data-kind="jsonpath" aria-pressed="false">JSON path</button>' +
          '<button type="button" data-kind="boundary" aria-pressed="false">Boundaries</button>' +
          '<button type="button" data-kind="regexp" aria-pressed="false">Regex</button>' +
          '<button type="button" data-kind="xpath" aria-pressed="false">XPath</button>' +
          '<button type="button" data-kind="header" aria-pressed="false">Header</button>' +
          '<button type="button" data-kind="list" aria-pressed="false" title="Every value like this one (the options of a select, the items of a JSON list): a list">List</button></span>' +
        '<div class="ss-ed-expr" id="ss-ed-expr"></div>' +
        '<p class="ss-ed-test" id="ss-ed-test" role="status" aria-live="polite"></p>' +
        '<div class="ss-ed-sec"><span class="ss-ed-num">3</span><label class="ss-fld" for="ss-ed-name">Name in the script</label></div>' +
        '<input class="ss-field ss-ed-name" id="ss-ed-name" spellcheck="false" autocomplete="off" />' +
        '<p class="ss-ed-err" id="ss-ed-nerr" hidden></p>' +
        '<span class="ss-fld">The code</span><pre class="ss-ed-code" id="ss-ed-code"></pre>' +
        '<div class="ss-ed-act"><button type="button" class="ds-btn ds-btn-primary" id="ss-ed-accept"><svg class="i"><use href="#i-ok"/></svg><span id="ss-ed-accept-t">Accept &amp; next</span></button>' +
          '<button type="button" class="ds-btn ss-btn-accent" id="ss-ed-keep" hidden title="Keep this value and choose another one; add them all at once"><svg class="i"><use href="#i-plus"/></svg>Keep, pick another</button>' +
          '<button type="button" class="ds-btn" id="ss-ed-skip">Skip</button>' +
          '<button type="button" class="ds-btn" id="ss-ed-run" title="Check it against the recording: what it reads, and every place it is sent back"><svg class="i"><use href="#i-play"/></svg>Test</button><span class="ss-grow"></span>' +
          '<button type="button" class="ds-btn ds-btn-sm ds-btn-ghost" id="ss-ed-reset" title="Back to what the Correlation Advisor chose">Undo my changes</button></div>' +
      "</div>" +
      '<div class="ss-ed-rs" id="ss-ed-rs" role="separator" aria-orientation="vertical" tabindex="0" aria-controls="ss-ed-left" aria-label="Width of the panels: drag, or the arrow keys; double-click puts it back" title="Drag to resize (double-click puts it back)"></div>' +
      '<div class="ss-ed-right" id="ss-ed-right">' +
        '<button type="button" class="ss-ed-rail" data-ed-show="right" title="Show the response"><svg class="i"><use href="#i-panel"/></svg>The response</button>' +
        '<div class="ss-ed-rh"><b id="ss-ed-rt">The response</b>' +
          '<span class="ss-seg ss-ed-rtab" id="ss-ed-rtab" role="group" aria-label="Show"><button type="button" data-rv="body" aria-pressed="true">Body</button><button type="button" data-rv="headers" aria-pressed="false">Headers</button></span>' +
          '<button type="button" class="ds-btn ds-btn-xs ds-btn-ghost ss-icon ss-ed-rhide" data-ed-hide="right" title="Hide this panel (how it is read gets the space)" aria-label="Hide the response"><svg class="i"><use href="#i-panel"/></svg></button>' +
          '<span class="ss-muted" id="ss-ed-hint">Select a value (or double-click it) to read it from here.</span></div>' +
        '<p class="ss-ed-legend" id="ss-ed-legend" hidden><mark class="later">value</mark> sent back by a later request — click one to use it</p>' +
        '<pre class="ss-ed-body" id="ss-ed-body" tabindex="0"></pre>' +
        '<div class="ss-ed-hdrs" id="ss-ed-hdrs" hidden></div>' +
        '<div class="ss-ed-empty" id="ss-ed-empty" hidden><p id="ss-ed-empty-t">This response is empty in the recording (the browser did not keep it).</p><button type="button" class="ds-btn ds-btn-sm" id="ss-ed-paste"><svg class="i"><use href="#i-paste"/></svg>Paste the response</button></div>' +
        '<div class="ss-ed-rh"><b>Sent back in</b><span class="ss-muted" id="ss-ed-n"></span></div>' +
        '<ul class="ss-ed-uses" id="ss-ed-uses"></ul>' +
      "</div>" +
    "</div>";
  tab.appendChild(box);

  // the two panels (how it is read · the response): drag the bar between them (or its arrow keys) to resize, hide one
  // to a rail — remembered in this browser (SS.prefs edW, edHide); never both hidden
  var EP = SS.prefs, edCols = $("#ss-ed-cols"), edRs = $("#ss-ed-rs"), MINL = 300;
  EP.edHide = EP.edHide || {};
  function edMax() { return Math.max(MINL, Math.round(edCols.getBoundingClientRect().width - 380)); }
  function edLayout() {
    if (EP.edHide.left && EP.edHide.right) EP.edHide.right = false;
    edCols.classList.toggle("no-left", !!EP.edHide.left);
    edCols.classList.toggle("no-right", !!EP.edHide.right);
    if (EP.edW) edCols.style.setProperty("--ss-edl", EP.edW + "px"); else edCols.style.removeProperty("--ss-edl");
    edRs.setAttribute("aria-valuemin", String(MINL));
    edRs.setAttribute("aria-valuemax", String(edMax()));
    edRs.setAttribute("aria-valuenow", String(Math.round($("#ss-ed-left").getBoundingClientRect().width)));
  }
  function edSetW(w) { EP.edW = Math.max(MINL, Math.min(edMax(), Math.round(w))); edLayout(); }
  edCols.addEventListener("click", function (e) {
    var hb = e.target.closest("[data-ed-hide]"), sb = e.target.closest("[data-ed-show]"), s;
    if (hb) {
      s = hb.getAttribute("data-ed-hide"); EP.edHide[s] = true;
      if (EP.edHide.left && EP.edHide.right) EP.edHide[s === "left" ? "right" : "left"] = false;
      SS.save(); edLayout();
      var rb = edCols.querySelector('[data-ed-show="' + s + '"]'); if (rb) rb.focus();
    } else if (sb) {
      s = sb.getAttribute("data-ed-show"); EP.edHide[s] = false; SS.save(); edLayout();
      var hb2 = edCols.querySelector('[data-ed-hide="' + s + '"]'); if (hb2) hb2.focus();
    }
  });
  edRs.addEventListener("pointerdown", function (e) {
    var x0 = e.clientX, w0 = $("#ss-ed-left").getBoundingClientRect().width;
    edRs.setPointerCapture(e.pointerId); edRs.classList.add("on");
    function move(ev) { edSetW(w0 + (ev.clientX - x0)); }
    function up() { edRs.removeEventListener("pointermove", move); edRs.removeEventListener("pointerup", up); edRs.classList.remove("on"); SS.save(); }
    edRs.addEventListener("pointermove", move); edRs.addEventListener("pointerup", up);
  });
  edRs.addEventListener("dblclick", function () { delete EP.edW; SS.save(); edLayout(); });
  // the keyboard scrolls a column even when the focus is not in it (on Cancel, the head, after a click on its edge):
  // the column the pointer was last over, else the left one. Inside a column, a field or the response: the browser's own.
  var edLast = null;
  edCols.addEventListener("pointermove", function (e) { var col = e.target.closest(".ss-ed-left, .ss-ed-right"); if (col) edLast = col; });
  box.addEventListener("keydown", function (e) {
    var k = e.key, t = e.target;
    if (!/^(ArrowUp|ArrowDown|PageUp|PageDown|Home|End)$/.test(k) || e.altKey || e.ctrlKey || e.metaKey) return;
    if (t.closest("input, select, textarea, [contenteditable], [role=separator], [role=radiogroup], [role=group], .ss-ed-left, .ss-ed-right")) return;
    var col = edLast && !edLast.closest(".no-left, .no-right") ? edLast : $("#ss-ed-left");
    if (edCols.classList.contains("no-left") && col.id === "ss-ed-left") col = $("#ss-ed-right");
    if (!col || col.scrollHeight <= col.clientHeight) return;
    var page = col.clientHeight * 0.9;
    var by = { ArrowUp: -48, ArrowDown: 48, PageUp: -page, PageDown: page }[k];
    if (k === "Home") col.scrollTop = 0; else if (k === "End") col.scrollTop = col.scrollHeight; else col.scrollTop += by;
    e.preventDefault();
  });
  edRs.addEventListener("keydown", function (e) {
    var w = $("#ss-ed-left").getBoundingClientRect().width, step = e.shiftKey ? 96 : 24;
    if (e.key === "ArrowLeft") edSetW(w - step);
    else if (e.key === "ArrowRight") edSetW(w + step);
    else if (e.key === "Home") edSetW(MINL);
    else if (e.key === "End") edSetW(edMax());
    else if (e.key === "Enter") { delete EP.edW; edLayout(); }
    else return;
    e.preventDefault(); SS.save();
  });

  var cur = null, kind = "auto", draft = null, srcIdx = null, rview = "body";
  // add mode: the new correlation being made (not in the Advisor's list until it is added)
  var adding = false, nc = null, nameTyped = false, idxFor = null, idx = null, laterFor = {}, hint = "", tray = [], listSt = null;
  function cand(id) { if (adding) return nc; return (S.advisorCandidates || []).filter(function (c) { return c.id === id; })[0] || null; }
  function isList(c) { return !!(c._arrayReconstruct || c._selectAll); }
  function locked(c) { return !adding && (!!c._applied || isList(c)); }
  function madeByScript(c) { return !!(c && (c._fixed || c._gen)); }
  function entry(i) { return (S.entries1 || [])[i]; }
  // the extractor the engine would use, without the user's choice
  function auto(c) { var x = Object.assign({}, c); delete x._edit; return advisorToCorrelation(x); }

  // XML responses: parse (null when not XML), read an XPath (in the local-name() form VuGen gets, which also matches
  // what DevWeb's plain names match), and find the XPath of a selected value (element text or attribute)
  var xmlFor = null, xmlDoc = null;
  function xml(body) {
    if (xmlFor === body) return xmlDoc;
    xmlFor = body; xmlDoc = null;
    if (!/^\s*</.test(body || "")) return null;
    try { var d = new DOMParser().parseFromString(body, "application/xml"); if (!d.getElementsByTagName("parsererror").length && d.documentElement) xmlDoc = d; } catch (e) { /* not XML */ }
    return xmlDoc;
  }
  function xp(body, path) {
    var d = xml(body); if (!d) return { none: true, why: "not XML" };
    if (!path) return { bad: "Type an XPath." };
    var q = typeof VugenCodegen !== "undefined" && VugenCodegen.vugenXpath ? VugenCodegen.vugenXpath(path) : path, n;
    try { n = d.evaluate(q, d, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue; } catch (e) { return { bad: "Not a valid XPath." }; }
    if (!n) return { none: true };
    return { value: n.nodeType === 2 ? n.value : n.textContent };
  }
  function xpathOf(body, s) {
    var d = xml(body); if (!d) return null;
    function step(el) { var n = 1, x = el; while ((x = x.previousElementSibling)) if (x.localName === el.localName) n++; var more = n > 1 || (function () { var y = el; while ((y = y.nextElementSibling)) if (y.localName === el.localName) return true; return false; })(); return "/" + el.localName + (more ? "[" + n + "]" : ""); }
    function path(el) { var p = ""; for (var x = el; x && x.nodeType === 1; x = x.parentNode) p = step(x) + p; return p; }
    var all = d.getElementsByTagName("*");
    for (var i = 0; i < all.length; i++) {
      var el = all[i];
      for (var j = 0; j < el.attributes.length; j++) if (el.attributes[j].value === s && !/^xmlns/.test(el.attributes[j].name)) { var pa = path(el) + "/@" + el.attributes[j].localName; if (xp(body, pa).value === s) return pa; }
      if (!el.children.length && el.textContent === s) { var pe = path(el); if (xp(body, pe).value === s) return pe; }
    }
    return null;
  }
  function selFor(e, at, s, want) {
    if (want === "xpath") { var p = xpathOf(String(e && e.respBody || ""), s); return p ? { extractorType: "xpath", extractorConfig: { path: p } } : null; }
    return E.fromSelection(e, at, s, want, typeof findJsonPath === "function" ? findJsonPath : null, _advSafeBoundaries);
  }

  // which requests send what back (built once per recording)
  function sent() {
    if (idxFor !== S.entries1) { idxFor = S.entries1; idx = E.sentIndex(S.entries1 || []); laterFor = {}; }
    return idx;
  }
  function later(i) {
    var ix = sent();   // first: a new recording resets the cache
    if (!laterFor[i]) laterFor[i] = E.laterValues(S.entries1 || [], i, ix);
    return laterFor[i];
  }

  // Edit a correlation that is in the script: it is taken out while it changes (every control unlocks), Save to the
  // script puts the changed one in, Cancel (or Discard on leaving) puts the one before back exactly as it was.
  var editing = null;   // { id, gone: the correlation taken out, snap: the candidate's choice before }
  function snapOf(c) { return JSON.stringify({ _edit: c._edit, _pick: c._pick, _nth: c._nth, varName: c.varName }); }
  function startEdit(c) {
    var snap = snapOf(c), gone = advisorRemoveFromScript(c.id);
    if (!gone) return;
    editing = { id: c.id, gone: gone, snap: snap };
    shownBody = null; draw();
  }
  function saveEdit(c) {
    save();
    advisorApplyOne(c);
    editing = null;
    regenerateFromAdvisor({ quiet: true });
    if (typeof showToast === "function") showToast(c.varName + " changed in the script.", "success", 3500);
    shownBody = null; draw();
  }
  function cancelEdit() {
    if (!editing) return;
    var c = (S.advisorCandidates || []).filter(function (x) { return x.id === editing.id; })[0], s = JSON.parse(editing.snap), gone = editing.gone;
    editing = null;
    if (!c) return;
    ["_edit", "_pick", "_nth"].forEach(function (k) { if (s[k] === undefined) delete c[k]; else c[k] = s[k]; });
    if (c.varName !== s.varName) advisorSetName(c.id, s.varName);
    advisorRestoreToScript(c.id, gone);
  }
  // leaving while a change is open: save it, or put the one before back
  function leaving(then) {
    if (!editing) { then(); return; }
    var c = (S.advisorCandidates || []).filter(function (x) { return x.id === editing.id; })[0];
    if (!c || !SS.ask) { cancelEdit(); then(); return; }
    SS.ask("Save the changes to " + c.varName + "?", "It is out of the script while you change it. Save puts the changed one in; Discard puts it back as it was.", "Save",
      function () { saveEdit(c); then(); }, { no: "Discard", otherwise: function () { cancelEdit(); then(); } });
  }
  function open(id) {
    if (editing && editing.id !== id) { leaving(function () { open(id); }); return; }
    var c = (S.advisorCandidates || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    adding = false; nc = null;
    cur = id; srcIdx = c._edit && c._edit.sourceIdx != null ? c._edit.sourceIdx : c.source ? c.source.entryIdx : null;
    draft = c._edit ? JSON.parse(JSON.stringify(c._edit)) : null;
    kind = draft ? (draft.extractorType === "boundary_header" ? "header" : draft.extractorType) : "auto";
    // a value read from a response header opens on the Headers (also when Auto reads it from one)
    var ax = null; try { ax = draft || auto(c); } catch (e) { ax = null; }
    rview = kind === "header" || (ax && ax.extractorType === "boundary_header") ? "headers" : "body";
    show();
  }
  // Add manual correlation: the same screen for a value the Correlation Advisor did not list
  function add(from) {
    adding = true; nameTyped = false; cur = "new"; draft = null; kind = "auto"; rview = "body"; tray = []; listSt = null;
    nc = { id: "new", value: "", preview: "", valueType: "token", confidence: "high", varName: "", usages: [], status: "accepted", _manual: true, source: null };
    srcIdx = from != null && entry(from) ? from : null;
    $("#ss-ed-srcq").value = "";
    if (srcIdx != null) nc.source = { entryIdx: srcIdx, url: typeof _advShortUrl === "function" ? _advShortUrl(entry(srcIdx)) : "", jsonPath: null };
    show();
    var s = $("#ss-ed-src"); if (s) s.focus();
  }
  function show() {
    tab.classList.add("ss-cr-editing"); box.hidden = false; box.classList.toggle("is-adding", adding);
    shownBody = null;
    draw();
    edLayout();
    if (!adding) $("#ss-ed-back").focus();
    var ws = $("#ss-t-corr"); if (ws.scrollTop) ws.scrollTop = 0;
  }
  function close(sure) {
    if (!cur) return;
    if (editing && !sure) { leaving(function () { close(true); }); return; }
    if (adding && tray.length && !sure && SS.ask) {
      SS.ask("Leave without adding?", plural(tray.length, "kept value") + " will not be added to the script.", "Leave", function () { close(true); }, { no: "Stay" });
      return;
    }
    var id = cur, was = adding; cur = null; adding = false; nc = null; tray = []; box.hidden = true; tab.classList.remove("ss-cr-editing");
    if (window.SSC) SSC.render();
    var r = was ? $("#ss-cr-manual") : document.querySelector('#ss-cr-body [data-id="' + id + '"] [data-edit]'); if (r) r.focus();
  }
  // keep the user's choice on the candidate (the engine reads it when the value is added to the script)
  function save() {
    var c = cand(cur); if (!c || locked(c)) return;
    if (adding) { c._edit = draft ? { extractorType: draft.extractorType, extractorConfig: draft.extractorConfig, sourceIdx: srcIdx } : undefined; sync(); return; }
    if (kind === "auto" && (srcIdx == null || (c.source && srcIdx === c.source.entryIdx))) delete c._edit;
    else if (draft) c._edit = { extractorType: draft.extractorType, extractorConfig: draft.extractorConfig, sourceIdx: srcIdx };
  }
  function ext(c) { return adding || kind !== "auto" ? draft : auto(c); }
  // add mode: the value is what the extractor reads; its uses are the engine's
  function sync() {
    var c = nc, e = entry(srcIdx), r = null;
    if (listSt) {
      var lab = "(list — " + (listSt.to - listSt.from + 1) + " values)";
      if (c.value !== lab || c._listKey !== listKey()) {
        c.value = lab; c._listKey = listKey(); c.preview = listSt.values.slice(listSt.from - 1, listSt.from + 2).join(", ");
        var us = [], seen = {};
        for (var pos = listSt.from; pos <= listSt.to; pos++) {
          var lv = listSt.values[pos - 1]; if (!lv || seen[lv]) continue; seen[lv] = 1;
          _advFindUsages(S.entries1 || [], srcIdx, lv).forEach(function (u) { us.push(Object.assign(u, { tokenValue: lv, listIdx: pos })); });
        }
        c.usages = us;
      }
      if (!nameTyped) c.varName = free(listSt.name);
      return;
    }
    if (e && draft) { try { r = E.readWith(e, draft, _advFirstMatch, xp); } catch (x) { r = null; } }
    var v = r && r.value != null ? String(r.value) : "";
    if (v !== c.value) {
      c.value = v; c.preview = v.length > 40 ? v.slice(0, 40) + "…" : v;
      c.usages = v ? _advFindUsages(S.entries1 || [], srcIdx, v) : [];
    }
    if (!nameTyped && v) {
      var hn = draft && draft.extractorType === "boundary_header" ? String(draft.extractorConfig.lb || "").replace(/:\s*$/, "") : null;
      // an XPath names it after its element or attribute (…/SessionToken → sessionToken), as a JSON path does
      var xn = draft && draft.extractorType === "xpath" ? E.nameOfXpath(draft.extractorConfig.path) : draft && /^(boundary|regexp)$/.test(draft.extractorType) ? hint : "";
      c.varName = free(_advSuggestName(draft && draft.extractorType === "jsonpath" ? draft.extractorConfig.path : xn ? "$." + xn : null, hn, v));
    }
  }
  function listKey() { return listSt ? JSON.stringify([listSt.ext, listSt.from, listSt.to]) : ""; }
  // names in use: correlations in the script and the Advisor's suggestions
  function taken(n) {
    return tray.some(function (x) { return x.varName === n; }) || (S.correlations || []).some(function (x) { return x.name === n; }) ||
      (S.advisorCandidates || []).some(function (x) { return x.varName === n && x.status !== "skipped"; });
  }
  function free(n) { n = n || "value"; if (!taken(n)) return n; for (var i = 2; i < 999; i++) if (!taken(n + "_" + i)) return n + "_" + i; return n; }

  function draw() {
    var c = cand(cur); if (!c) { close(); return; }
    var lock = locked(c), us = c.usages || [], list = window.SSC && !adding ? SSC.list() : [], at = list.indexOf(cur);
    $("#ss-ed-h").textContent = adding ? (c.varName || "New correlation") : c.varName;
    $("#ss-ed-tag").textContent = adding ? "Manual" : c._applied ? (c._engineCorr ? (c._fixed ? "In the script · made while it runs" : "In the script · found by Studio") : c._gen ? "In the script · a new UUID" : "In the script") : c._gen ? "A new UUID" : isList(c) ? "List" : c._edit ? "Changed by you" : c._explorer ? "From HAR Explorer" : c._paste ? "From Paste & Detect" : c._manual ? "Manual" : "";
    $("#ss-ed-pos").textContent = at >= 0 ? (at + 1) + " of " + list.length : "";
    $("#ss-ed-prev").hidden = $("#ss-ed-next").hidden = adding;
    $("#ss-ed-prev").disabled = at <= 0; $("#ss-ed-next").disabled = at < 0 || at >= list.length - 1;
    $("#ss-ed-back").lastChild.textContent = adding ? "Cancel" : "Back to the list";
    // why, in plain words
    var why;
    if (adding) why = "<b>Add a value yourself.</b> Choose the request whose response has it, then select the value on the right — or click one of the marked values. How it is read, its name and where it is sent back fill in.";
    else {
      why = !us.length ? "<b>No later request sends this value back</b>, so there is nothing to correlate. Skip it."
        : editing && editing.id === c.id ? "<b>Changing it.</b> It is out of the script until you click <b>Save to the script</b>; <b>Cancel</b> puts it back as it was."
        : c._gen ? "<b>A new UUID, made by the script.</b> The browser made this value (no response sends it), so the script makes a new one before the first request that sends it — renewed where the recording renewed it, kept where it kept it. Sent in " + plural(us.length, "place") + (c._applied ? "; or " + '<button type="button" class="adv-req-link" id="ss-ed-out">take it out of the script</button> (Undo puts it back).' : ". Add it to the script from the list, or choose Don't generate there.")
        : c._fixed && c._applied ? "<b>Made while the script runs.</b> The script creates this value itself (a PKCE code verifier or challenge, or a list it rebuilds) — it is not read from a response, so there is nothing to change here. Sent in " + plural(us.length, "place") + "; or " + '<button type="button" class="adv-req-link" id="ss-ed-out">take it out of the script</button> (Undo puts it back).'
        : c._applied ? "<b>This value is in the script.</b> It is read from the response below and sent back in " + plural(us.length, "place") + ". Click <b>Edit</b> to change how it is read, its name or its response; or " + '<button type="button" class="adv-req-link" id="ss-ed-out">take it out of the script</button> (Undo puts it back).'
        : c._browser && !c._gen ? "<b>Made in the browser.</b> No response sends this value before it is first sent — a script in the page made it (a hash, an id), so it is not read from a response. Sent in " + plural(us.length, "place") + ". Skip it; if you know a response that has it, choose it below and select the value."
        : c.confidence === "high" ? "<b>An earlier response sends this value</b> and " + plural(us.length, "later place") + " send it back. A new user gets a new value, so the script must read it from the response each time."
        : "<b>It looks like a " + esc(String(c.valueType || "token")) + "</b> by its shape, and " + plural(us.length, "later place") + " send it back. No earlier response was found that sends it: check the response, or use Can't find a value?";
      if (isList(c)) why += " It is a list: its options are below.";
    }
    $("#ss-ed-why").innerHTML = why;
    $("#ss-ed-lt").textContent = adding ? "The value" : "How it is read";
    $("#ss-ed-src-l").textContent = adding ? "Comes from (the request whose response has the value)" : "Read from the response of";
    $("#ss-ed-find").hidden = !adding;
    sources(c, lock, us);
    // how to read it
    var e = srcIdx != null ? entry(srcIdx) : null, btxt = String(e && e.respBody || "");
    var isJson = (function () { try { JSON.parse(btxt); return !!btxt.trim(); } catch (x) { return false; } })(), isXml = !!xml(btxt);
    var heads = adding ? Object.keys(e && e.respHdrsMap || {}) : E.headersWith(e, c.value);
    $("#ss-ed-kind-l").textContent = isList(c) && !adding ? "How the list is used" : "How to read it";
    $("#ss-ed-kind").hidden = isList(c) && !adding;
    $$("#ss-ed-kind [data-kind]").forEach(function (b) {
      var k = b.getAttribute("data-kind");
      b.hidden = adding && k === "auto";
      var on = adding ? (listSt ? k === "list" : draft && (k === "header" ? draft.extractorType === "boundary_header" : draft.extractorType === k)) : k === kind;
      b.hidden = (adding && k === "auto") || (!adding && k === "list");
      b.setAttribute("aria-pressed", String(!!on));
      b.disabled = lock || !e || (k === "jsonpath" && !isJson) || (k === "xpath" && !isXml) || (k === "regexp" && !btxt) || (k === "header" && !heads.length) || (k === "list" && !listSt && !c.value);
      b.title = k === "jsonpath" && !isJson ? "This response is not JSON" : k === "xpath" && !isXml ? "This response is not XML" : k === "header" && !heads.length ? "No header of this response has the value"
        : k === "auto" ? "What the Correlation Advisor chose" : k === "regexp" ? "A regular expression: the first ( ) group is the value" : k === "xpath" ? "An XPath in the XML response" : "";
    });
    expr(c, e, heads);
    rest();
  }
  // the source: requests before the first place the value is sent back (add mode: every request, filtered)
  function sources(c, lock, us) {
    var opts = [], sel = $("#ss-ed-src");
    if (adding) {
      var q = $("#ss-ed-srcq").value.trim().toLowerCase(), only = $("#ss-ed-only").checked;
      (S.entries1 || []).forEach(function (e, i) {
        if (e.isMarker || e.filtered) return;
        if (q && (String(e.method) + " " + String(e.url)).toLowerCase().indexOf(q) === -1 && i !== srcIdx) return;
        if (only && i !== srcIdx && !later(i).length) return;
        opts.push(i);
      });
    } else {
      var last = us.length ? Math.min.apply(null, us.map(function (u) { return u.entryIdx; })) : (S.entries1 || []).length;
      (S.entries1 || []).forEach(function (e, i) { if (i < last && !e.isMarker && !e.filtered) opts.push(i); });
      if (srcIdx != null && entry(srcIdx) && opts.indexOf(srcIdx) === -1) opts.push(srcIdx);   // (a value made while the script runs has no response)
    }
    sel.innerHTML = (srcIdx != null && !entry(srcIdx) ? '<option value="">— none: made while the script runs —</option>' : "") + (srcIdx == null ? '<option value="">' + (opts.length ? "— choose a request (" + opts.length + ") —" : "— no request matches —") + "</option>" : "") + opts.map(function (i) {
      var e = entry(i), p = String(e.url || "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "") || "/";
      var note = adding ? (later(i).length ? "  · " + plural(later(i).length, "value") + " sent back later" : "")
        : (String(e.respBody || "").indexOf(c.value) !== -1 || E.headersWith(e, c.value).length ? "  · has the value" : "");
      return '<option value="' + i + '"' + (i === srcIdx ? " selected" : "") + ">#" + e.id + " " + esc(e.method) + " " + esc(p.length > 70 ? p.slice(0, 69) + "…" : p) + note + "</option>";
    }).join("");
    sel.disabled = lock;
    $("#ss-ed-src-up").disabled = lock || opts.indexOf(srcIdx) <= 0;
    $("#ss-ed-src-down").disabled = lock || (srcIdx == null ? !opts.length : opts.indexOf(srcIdx) === -1 || opts.indexOf(srcIdx) >= opts.length - 1);
  }
  // everything below "how to read it": the test, the name, the code, the buttons, the response, where it is sent back
  function rest() {
    var c = cand(cur); if (!c) return;
    var lock = locked(c), us = c.usages || [], e = srcIdx != null ? entry(srcIdx) : null;
    test(c, e);
    var nm = $("#ss-ed-name"); if (document.activeElement !== nm) nm.value = c.varName; nm.disabled = !adding && !!c._applied;
    nm.placeholder = adding ? "Filled in when you choose a value" : "";
    var nameBad = adding && (!c.varName ? "" : taken(c.varName) ? "That name is in use: choose another." : "");
    $("#ss-ed-nerr").hidden = !nameBad; $("#ss-ed-nerr").textContent = nameBad || "";
    code(c);
    var acc = $("#ss-ed-accept");
    if (adding) {
      var ready = !!(c.value && c.varName && !nameBad && testOk), n = tray.length + (ready ? 1 : 0);
      $("#ss-ed-accept-t").textContent = n > 1 ? "Add all " + n + " to the script" : tray.length ? "Add the kept value" : "Add to the script";
      acc.disabled = !n;
      acc.title = !n ? "Choose a value first" : tray.length && !ready && c.value ? "Adds the kept values (the one shown is not ready: " + (nameBad || "check how it is read") + ")" : "Put " + (n > 1 ? "them" : "it") + " in the script now";
      $("#ss-ed-keep").disabled = !ready;
      trayDraw();
    } else {
      var ed = editing && editing.id === c.id;
      $("#ss-ed-accept-t").textContent = ed ? "Save to the script" : c._applied ? "Edit" : "Accept & next";
      acc.disabled = ed ? !us.length || !testOk : c._applied ? madeByScript(c) : c._gen ? false : !us.length || !testOk;
      acc.title = c._applied ? "Change how it is read, its name or its response — it is put back as it was if you cancel"
        : !us.length ? "No later request sends this value back" : !testOk ? "The way to read it does not give the value yet" : ed ? "Put the changed correlation in the script" : "Tick it and go to the next value";
    }
    $("#ss-ed-skip").hidden = adding;
    $("#ss-ed-keep").hidden = !adding;
    if (!adding) $("#ss-ed-tray").hidden = true;
    $("#ss-ed-skip").textContent = c.status === "skipped" ? "Put back" : "Skip";
    $("#ss-ed-skip").disabled = !!c._applied;
    $("#ss-ed-skip").hidden = adding || !!(editing && editing.id === c.id);
    $("#ss-ed-reset").hidden = adding || (!(editing && editing.id === c.id) && (lock || !c._edit && kind === "auto"));
    $("#ss-ed-reset").textContent = editing && editing.id === c.id ? "Cancel" : "Undo my changes";
    response(c, e);
    // sent back in
    $("#ss-ed-n").textContent = us.length ? plural(us.length, "place") : adding && !c.value ? "" : "nowhere";
    $("#ss-ed-uses").innerHTML = us.length ? us.map(function (u) {
      return "<li>" + (typeof _advReqLink === "function" ? _advReqLink(u.entryIdx, u.url) : esc(u.url || "")) + '<small class="ss-muted">' + esc(typeof _advWhere === "function" ? _advWhere(u) : u.location || "") + "</small></li>";
    }).join("") : '<li class="ss-muted">' + (adding && !c.value ? "Choose a value to see where it is sent back." : "No later request sends it back.") + "</li>";
  }
  // the code the script gets (the generators' own functions, on the correlation the engine builds)
  // the correlation the editor would put in the script now (its choice of response and extractor)
  function draftCorr(c) {
    var tmp = Object.assign({}, c); if (!adding && kind === "auto") delete tmp._edit; else if (draft) tmp._edit = { extractorType: draft.extractorType, extractorConfig: draft.extractorConfig, sourceIdx: srcIdx };
    if (!tmp.varName) tmp.varName = "value";
    return advisorToCorrelation(tmp);
  }
  function code(c) {
    var s = "";
    try {
      if (adding && !draft) throw new Error("none");
      if (!adding && kind === "auto" && c._browser && !c._gen) { $("#ss-ed-code").textContent = "// Made in the browser: not added to the script."; return; }
      var corr = draftCorr(c);
      s = corr.extractorType === "uuid" ? (S.format === "webhttp" ? webHttpCorrCode(corr, "") : "load.global." + corr.name + " = load.utils.uuid();") + "   // before the first request that sends it"
        : S.format === "webhttp" ? webHttpCorrCode(corr, "") : devwebExtractorDecl(corr);
    } catch (x) { s = "// The code is shown once a response and a value are chosen."; }
    $("#ss-ed-code").textContent = s;
  }

  // how a list is used: every value as recorded, one at random, the next each iteration, always the Nth
  function pickHtml(pick, nth, n, note) {
    pick = pick || "all";
    var opt = function (k, title, text) { return '<button type="button" role="radio" data-pick="' + k + '" aria-checked="' + (pick === k) + '" title="' + text + '"><b>' + title + "</b><small>" + text + "</small></button>"; };
    return '<div class="ss-ed-pick" role="radiogroup" aria-label="Which value is sent back">' +
      opt("all", "Every value, as recorded", "Each place sends back the value at the position it used in the recording.") +
      opt("random", "One at random each iteration", "A list the user picks from (a product, a flight): another one each iteration.") +
      opt("rotate", "The next one each iteration", "Iteration 1 takes the 1st value, iteration 2 the 2nd … and round again.") +
      '<div class="ss-ed-nth' + (pick === "nth" ? " on" : "") + '">' + opt("nth", "Always the same one", "The value at this position every time:") +
        '<label class="ss-ed-nthl">Position <input type="number" class="ss-field" id="ss-ed-nth" min="1"' + (n ? ' max="' + n + '"' : "") + ' value="' + (nth || 1) + '"' + (pick === "nth" ? "" : " disabled") + " />" + (n ? " of " + n : "") + "</label></div>" +
      "</div>" + (note ? '<p class="ss-muted ss-ed-note">' + note + "</p>" : "");
  }
  // a list being made (add mode): what it reads, then how it is used
  function listAddOpts() {
    var n = listSt.to - listSt.from + 1, vals = listSt.values.slice(listSt.from - 1, listSt.to);
    $("#ss-ed-expr").innerHTML = '<p class="ss-ed-lead">A list of <b>' + n + " values</b>: " + listSt.about + ", every match" +
      (listSt.from > 1 || listSt.to < listSt.values.length ? " (matches " + listSt.from + "–" + listSt.to + " of " + listSt.values.length + ")" : "") + '.</p><p class="ss-ed-vals">' +
      vals.slice(0, 6).map(function (x) { return "<code>" + esc(short(x)) + "</code>"; }).join(" ") + (n > 6 ? ' <span class="ss-muted">and ' + (n - 6) + " more</span>" : "") + "</p>" +
      '<span class="ss-fld">Which value is sent back</span>' + pickHtml(listSt.pick, listSt.nth, n);
  }
  // a list: every value or one at random; a rebuilt list: its columns, the loop anchor, the missing paths
  function listOpts(c) {
    var x = $("#ss-ed-expr"), a; try { a = auto(c); } catch (err) { a = null; }
    if (c._arrayReconstruct && c._arrayConfig) {
      var cfg = c._arrayConfig, cols = cfg.columns || [], st = cfg.staticFields || [], lock = !!c._applied;
      var miss = cols.filter(function (k) { return k._placeholder; }).length, real = cols.some(function (k) { return !k._placeholder && k.sourceJsonPath; });
      var anchor = (cols.filter(function (k) { return k.varName === cfg.countVar; })[0] || {}).targetKey || "";
      x.innerHTML = '<p class="ss-ed-lead">A later request sends this list back <b>rebuilt</b>: one item for each value the response sends, made from these fields.</p>' +
        '<div class="ss-ed-arr"><table><thead><tr><th>Read from the response</th><th>Name in the script</th><th>Field of each item</th></tr></thead><tbody>' +
        cols.map(function (k) {
          return "<tr" + (k._placeholder ? ' class="is-miss"' : "") + "><td>" + (k._placeholder ? '<span class="ss-muted">no source yet</span>' : "<code>" + esc(k.sourceJsonPath) + "</code>") +
            "</td><td><code>" + esc(k.varName) + "</code>" + (k.varName === cfg.countVar ? '<span class="ss-ed-anc">loop</span>' : "") + "</td><td><code>" + esc(k.targetKey) + "</code></td></tr>";
        }).join("") +
        st.map(function (s) { return '<tr class="is-static"><td><span class="ss-muted">the same in every item</span></td><td><code>' + esc(s.value) + "</code></td><td><code>" + esc(s.targetKey) + "</code></td></tr>"; }).join("") +
        "</tbody></table></div>" +
        '<label class="ss-fld" for="ss-ed-anchor">One item for each value of</label>' +
        '<select class="ss-field" id="ss-ed-anchor"' + (lock ? " disabled" : "") + ">" + cols.map(function (k) {
          return '<option value="' + esc(k.targetKey) + '"' + (k.targetKey === anchor ? " selected" : "") + (k._placeholder && !real ? " disabled" : "") + ">" + esc(k.targetKey) + (k._placeholder ? " (no source yet)" : "") + "</option>";
        }).join("") + "</select>" +
        (miss ? '<div class="ss-ed-miss"><svg class="i"><use href="#i-warn"/></svg><span>' + plural(miss, "field") + " of the items " + (miss === 1 ? "has" : "have") + " no source in the response yet." +
          (real ? "" : " There is no field to start from: correlate one of them first.") + "</span>" +
          (real ? '<button type="button" class="ds-btn ds-btn-sm" id="ss-ed-fill"' + (lock ? " disabled" : "") + ' title="Each missing field is read from the same items of the response, by its name">Fill the missing paths</button>' : "") + "</div>" : "") +
        (lock ? '<p class="ss-muted ss-ed-note">In the script: take it out first to change it.</p>' : "");
      return;
    }
    var cc = a; try { cc = advisorToCorrelation(c); } catch (err) { cc = a; }
    var how = cc && cc.extractorType === "boundary" ? "boundaries <code>" + esc(cc.extractorConfig.lb) + "</code> … <code>" + esc(cc.extractorConfig.rb) + "</code>"
      : cc && cc.extractorType === "regexp" ? (/^<option\b/.test(cc.extractorConfig.pattern) ? "the value of every <code>&lt;option&gt;</code>" : "the regular expression <code>" + esc(cc.extractorConfig.pattern) + "</code>")
      : "JSON path <code>" + esc(cc && cc.extractorConfig ? cc.extractorConfig.path : "") + "</code>";
    var vals = lvals(c);
    x.innerHTML = '<p class="ss-ed-lead">The response sends <b>' + (vals.length > 1 ? vals.length + " values" : "several values") + "</b> (" + how + ", every match) and the script reads them all. Which one is sent back:</p>" +
      pickHtml(c._pick, c._nth, vals.length, c._applied ? "In the script: a change makes the script again." : "");
  }
  function lvals(c) {
    var e = entry(srcIdx), body = String(e && e.respBody || ""), cc;
    try { cc = advisorToCorrelation(c); } catch (err) { return []; }
    var all = cc.extractorType === "regexp" && cc.extractorConfig.all ? E.regexAll(body, cc.extractorConfig.pattern)
      : cc.extractorType === "boundary" && cc.extractorConfig.all ? E.boundAll(body, cc.extractorConfig.lb, cc.extractorConfig.rb)
      : cc.extractorConfig && cc.extractorConfig.selectAll ? E.jsonAll(body, cc.extractorConfig.path) : [];
    return c._range ? all.slice(c._range.from - 1, c._range.to) : all;
  }
  function expr(c, e, heads) {
    var x = $("#ss-ed-expr"), cfg = draft && draft.extractorConfig || {};
    if (!adding && isList(c)) { listOpts(c); return; }
    if (adding && listSt) { listAddOpts(); return; }
    if (!adding && kind === "auto" && c._gen) { x.innerHTML = '<p class="ss-muted">Nothing reads it: the script makes a new UUID.</p>'; return; }
    if (!adding && kind === "auto" && c._browser && !c._gen) { x.innerHTML = '<p class="ss-muted">Nothing reads it: no response has it before it is sent.</p>'; return; }
    if (!adding && kind === "auto") {
      var a; try { a = auto(c); } catch (err) { a = null; }
      var t = !a ? "" : a.extractorType === "jsonpath" ? "JSON path <code>" + esc(a.extractorConfig.path) + "</code>" + (a.extractorConfig.selectAll ? " (every match)" : "")
        : a.extractorType === "boundary" ? "Boundaries <code>" + esc(a.extractorConfig.lb) + "</code> … <code>" + esc(a.extractorConfig.rb) + "</code>"
        : a.extractorType === "boundary_header" ? "A response header (<code>" + esc(String(a.extractorConfig.lb || "").replace(/:\s*$/, "")) + "</code>)"
        : a.extractorType === "cookie" ? "The cookie <code>" + esc(a.extractorConfig.cookieName) + "</code>"
        : a.extractorType === "regexp" ? "Regular expression <code>" + esc(a.extractorConfig.pattern) + "</code>"
        : a.extractorType === "xpath" ? "XPath <code>" + esc(a.extractorConfig.path) + "</code>"
        : a.extractorType === "array_reconstruct" ? "The list, rebuilt (list options)" : esc(a.extractorType);
      x.innerHTML = '<p class="ss-muted">The Correlation Advisor reads it by ' + t + ".</p>";
      return;
    }
    if (!adding && !draft) { x.innerHTML = ""; return; }
    if (adding && !draft) { x.innerHTML = '<p class="ss-muted">' + (e ? "Select a value in the response, or click a marked one." : "Choose a request first.") + "</p>"; return; }
    var dis = locked(c) ? " disabled" : "", k = draft.extractorType;
    if (k === "jsonpath") x.innerHTML = '<label class="ss-fld" for="ss-ed-path">JSON path</label><input class="ss-field ss-mono" id="ss-ed-path" spellcheck="false" value="' + esc(cfg.path || "") + '" placeholder="$.data.token"' + dis + " />";
    else if (k === "boundary") x.innerHTML = '<div class="ss-ed-lr"><span><label class="ss-fld" for="ss-ed-lb">Left boundary</label><input class="ss-field ss-mono" id="ss-ed-lb" spellcheck="false" value="' + esc(cfg.lb || "") + '"' + dis + ' /></span><span><label class="ss-fld" for="ss-ed-rb">Right boundary</label><input class="ss-field ss-mono" id="ss-ed-rb" spellcheck="false" value="' + esc(cfg.rb || "") + '"' + dis + " /></span></div>";
    else if (k === "regexp") x.innerHTML = '<label class="ss-fld" for="ss-ed-re">Regular expression</label><input class="ss-field ss-mono" id="ss-ed-re" spellcheck="false" value="' + esc(cfg.pattern || "") + '" placeholder="&quot;token&quot;:&quot;([^&quot;]+)&quot;"' + dis + ' /><p class="ss-muted ss-ed-note">The first <code>( )</code> group is the value. Keep to plain syntax (no look-behind): VuGen and DevWeb read it with their own engines.</p>';
    else if (k === "xpath") x.innerHTML = '<label class="ss-fld" for="ss-ed-xp">XPath</label><input class="ss-field ss-mono" id="ss-ed-xp" spellcheck="false" value="' + esc(cfg.path || "") + '" placeholder="/Envelope/Body/Token"' + dis + ' /><p class="ss-muted ss-ed-note">Element names without a prefix match in any namespace (VuGen gets <code>local-name()</code> steps). End with <code>/@name</code> for an attribute.</p>';
    else if (k === "boundary_header") {
      var h = String(cfg.lb || "").replace(/:\s*$/, "").toLowerCase();
      x.innerHTML = '<label class="ss-fld" for="ss-ed-hdr">Response header</label><select class="ss-field" id="ss-ed-hdr"' + dis + ">" + heads.map(function (k2) { return "<option" + (k2.toLowerCase() === h ? " selected" : "") + ">" + esc(k2) + "</option>"; }).join("") + "</select>";
    } else x.innerHTML = "";
  }

  var testOk = false;
  function test(c, e) {
    var p = $("#ss-ed-test"), x = ext(c), r;
    testOk = false;
    if (adding && listSt) {
      var ln = listSt.to - listSt.from + 1, un = (c.usages || []).length;
      testOk = ln >= 2; p.hidden = false;
      p.className = "ss-ed-test " + (un ? "good" : "warn");
      p.innerHTML = '<svg class="i"><use href="#i-' + (un ? "ok" : "warn") + '"/></svg><span>Reads <b>' + ln + " values</b>" + (un ? "; " + plural(un, "later place") + (un === 1 ? " sends" : " send") + " one of them back." : ". No later request sends one of them back as recorded.") + "</span>";
      return;
    }
    if (adding) {
      if (!e || !draft) { p.className = "ss-ed-test"; p.textContent = ""; p.hidden = true; return; }
      p.hidden = false;
      try { r = E.readWith(e, x, _advFirstMatch, xp); } catch (err) { r = { unknown: true }; }
      if (r.bad) { p.className = "ss-ed-test bad"; p.textContent = r.bad; return; }
      if (r.unknown) { p.className = "ss-ed-test bad"; p.textContent = draft.extractorType === "boundary" ? "Type both boundaries." : "Choose how to read it."; return; }
      if (r.none) { p.className = "ss-ed-test bad"; p.textContent = r.why === "not JSON" ? "This response is not JSON." : r.why === "not XML" ? "This response is not XML." : "Nothing found in this response."; return; }
      testOk = true;
      var n = (c.usages || []).length;
      // a value that is one of a list: say so, one click reads them all
      var bt = String(e.respBody || ""), lh = "";
      if (bt.length < 300000 && draft.extractorType !== "boundary_header") {
        var a0 = bt.indexOf(c.value); if (a0 === -1) a0 = bt.indexOf(JSON.stringify(c.value).slice(1, -1));
        var lr = a0 === -1 ? null : E.listFrom(bt, a0, c.value, typeof findJsonPath === "function" ? findJsonPath : null);
        if (lr && !lr.why) lh = ' It is one of <b>' + (lr.to - lr.from + 1) + '</b> like it: <button type="button" class="adv-req-link" data-kind="list">read them all as a List</button>.';
      }
      // the Correlation Advisor lists this value already: say so (adding it again makes a second extractor)
      var known = (S.advisorCandidates || []).filter(function (x) { return x.value === String(r.value) && x.status !== "skipped"; })[0];
      p.className = "ss-ed-test " + (n && !known ? "good" : "warn");
      p.innerHTML = '<svg class="i"><use href="#i-' + (n && !known ? "ok" : "warn") + '"/></svg><span>Reads <code>' + esc(short(r.value)) + "</code>" +
        (n ? ", sent back in " + plural(n, "later place") + "." : ". No later request sends it back as recorded: check that this is the value you want.") +
        (known ? ' The Correlation Advisor lists this value already as <b>' + esc(known.varName) + "</b>" + (known._applied ? " (in the script)" : "") +
          ': <button type="button" class="adv-req-link" data-known="' + esc(known.id) + '">open it</button> instead.' : "") + lh + "</span>";
      return;
    }
    p.hidden = false;
    if (!e && c._gen) { testOk = true; p.className = "ss-ed-test"; p.textContent = "Made by the script: a new UUID before the first request that sends it."; return; }
    if (!e && c._browser && !c._gen) { p.className = "ss-ed-test"; p.textContent = "Made in the browser: nothing to read it from, so it stays out of the script."; return; }
    if (!e) { p.className = "ss-ed-test bad"; p.textContent = "No earlier response was found that sends this value: choose one that has it (marked “has the value”), or use Can't find a value?"; return; }
    if (isList(c)) { testOk = true; p.className = "ss-ed-test"; p.textContent = "A list: every match is read when the script runs."; return; }
    try { r = E.readWith(e, x, _advFirstMatch, xp); } catch (err) { r = { unknown: true }; }
    if (r.bad) { p.className = "ss-ed-test bad"; p.textContent = r.bad; return; }
    if (r.unknown) {
      // a way of reading readWith does not know (a query value of a header, an HTML element): read as Test reads it
      var full = null;
      try { full = E.check({ entries: S.entries1 || [], corr: Object.assign({}, draftCorr(c), { usages: [] }), firstMatch: _advFirstMatch, xp: xp, html: htmlRead }); } catch (err) { full = null; }
      if (full && full.value != null) r = { value: full.value };
      else if (full && full.verdict === "none") r = { none: true, why: full.why };
      else { testOk = true; p.className = "ss-ed-test"; p.textContent = "Read when the script runs (this way of reading is not tried here)."; return; }
    }
    if (r.none) { p.className = "ss-ed-test bad"; p.textContent = r.why === "not JSON" ? "This response is not JSON." : r.why === "not XML" ? "This response is not XML." : "Nothing found in this response."; return; }
    if (r.value === c.value) { testOk = true; p.className = "ss-ed-test good"; p.innerHTML = '<svg class="i"><use href="#i-ok"/></svg><span>Reads <code>' + esc(short(r.value)) + "</code>, the value that is sent back.</span>"; return; }
    p.className = "ss-ed-test bad";
    p.innerHTML = '<svg class="i"><use href="#i-warn"/></svg><span>Reads <code>' + esc(short(r.value)) + "</code>, not the value sent back (<code>" + esc(short(c.value)) + "</code>).</span>";
  }
  function short(v) { v = String(v); return v.length > 80 ? v.slice(0, 79) + "…" : v; }

  // Test: the correlation as the editor would put it in the script, checked against the recording (StudioEdit.check)
  // an element of an HTML page (an engine's html extractor: a CSS selector and its attribute), read with the browser's parser
  function htmlRead(body, sel, attr) {
    try {
      var d = new DOMParser().parseFromString(String(body || ""), "text/html"), el = sel ? d.querySelector(sel) : null;
      if (!el) return { none: true };
      var v = attr ? el.getAttribute(attr) : el.textContent;
      return v == null ? { none: true } : { value: v };
    } catch (e) { return { unknown: true }; }
  }
  // a list's sends, iteration by iteration (Pick again draws a new random sample)
  var testPicks = null;
  function picksHtml() {
    var p = testPicks; if (!p) return "";
    var it = E.picksOf(p.values, p.pick, p.nth, p.pick === "rotate" ? Math.min(p.values.length + 2, 10) : p.pick === "nth" ? 3 : 6);
    var lead = p.pick === "random" ? "One value at random each iteration — for example:" : p.pick === "rotate" ? "The next value each iteration, then round again:" : "The same value every iteration:";
    return '<div class="ss-tv ss-tp" id="ss-tp"><b>What the script sends</b><span class="ss-muted">' + lead + "</span>" +
      '<ol class="ss-tp-l">' + (it || []).map(function (x) {
        return "<li><span>Iteration " + x.iter + "</span>" + (x.value == null ? '<span class="ss-muted">no value</span>' : "<code>" + esc(short(x.value)) + "</code>") + "</li>";
      }).join("") + "</ol>" +
      (p.pick === "random" ? '<button type="button" class="ds-btn ds-btn-xs" data-repick><svg class="i"><use href="#i-reset"/></svg>Pick again</button>' : "") + "</div>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#ss-test-b [data-repick]"); if (!b) return;
    var box = $("#ss-tp"); if (box) box.outerHTML = picksHtml();
    var nb = document.querySelector("#ss-test-b [data-repick]"); if (nb) nb.focus();
  });
  // the result opens in the Test dialog (#ss-test-dlg, shared with the table's Test): what it reads, every value of a
  // list, what a list sends each iteration, every place it is sent back with the value that place sent, the second recording
  function runTest(c) {
    var corr = null, dlg = $("#ss-test-dlg"), body = $("#ss-test-b");
    try { corr = draftCorr(c); } catch (e) { corr = null; }
    $("#ss-test-h").textContent = "Test: " + (c.varName || "new correlation");
    if (!corr || (adding && !draft && !listSt)) {
      $("#ss-test-sub").textContent = "";
      body.innerHTML = '<p class="ss-empty">Choose the response and how to read the value first.</p>';
      if (dlg.open) dlg.close(); dlg.showModal(); return;
    }
    var range = adding && listSt ? { from: listSt.from, to: listSt.to } : c._range && c._range.from ? c._range : null;
    // a list being made: each use keeps the value its request really sent (the candidate's value is the list's label)
    if (adding && listSt) corr = Object.assign({}, corr, { usages: (c.usages || []).map(function (u) { return { reqIdx: u.entryIdx, location: u.location, tokenValue: u.tokenValue }; }) });
    var res = E.check({ entries: S.entries1 || [], corr: corr, firstMatch: _advFirstMatch, xp: xp, html: htmlRead, range: range, entries2: S.entries2 && S.entries2.length ? S.entries2 : null });
    var tx = E.checkText(res), ents = S.entries1 || [], LABEL = { good: "OK", warn: "Check", bad: "Fails" };
    var src = ents[corr.sourceIdx], srcPath = src ? "#" + src.id + " " + src.method + " " + (String(src.url || "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").split("?")[0] || "/") : "";
    $("#ss-test-sub").textContent = (src ? "Read from the response of " + srcPath + " — " : "") + "checked against the recording" + (S.entries2 && S.entries2.length ? " and the second recording" : "") + ".";
    // a list: what the script sends, iteration by iteration (the choice "Which value is sent back")
    var pk = adding && listSt ? listSt.pick : c._pick || "all", nth = adding && listSt ? +listSt.nth || 1 : +c._nth || 1;
    if (res.values && pk && pk !== "all") {
      var PK = { random: "one at random each iteration", rotate: "the next one each iteration", nth: "always value " + nth };
      tx = Object.assign({}, tx, { title: tx.title + " — sends " + PK[pk] });
      if (pk === "nth" && nth > res.values.length) tx = Object.assign({}, tx, { cls: "bad", notes: ["There is no value " + nth + ": the list has " + res.values.length + "."].concat(tx.notes) });
    }
    testPicks = res.values && pk !== "all" ? { values: res.values, pick: pk, nth: nth } : null;
    var vals = picksHtml() + (res.values ? '<div class="ss-tv"><b>The values</b><div class="ss-tv-l">' + res.values.slice(0, 40).map(function (v) { return "<code>" + esc(short(v)) + "</code>"; }).join("") +
      (res.values.length > 40 ? '<span class="ss-muted">+' + (res.values.length - 40) + " more</span>" : "") + "</div></div>" : "");
    var places = (res.places || []).slice(0, 60).map(function (p) {
      var e = ents[p.reqIdx], path = e ? String(e.url || "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").split("?")[0] : "?";
      var st = p.same === false ? "warn" : p.same ? "good" : "info";
      return '<tr><td><code>#' + esc(e ? e.id : p.reqIdx) + " " + esc(e ? e.method : "") + " " + esc(path.length > 56 ? path.slice(0, 55) + "…" : path) + "</code></td>" +
        "<td>" + (p.sent == null ? '<span class="ss-muted">not recorded</span>' : "<code>" + esc(short(p.sent)) + "</code>") + "</td>" +
        '<td><span class="ss-tres ' + (st === "info" ? "warn" : st) + '"><svg class="i"><use href="#i-' + (st === "good" ? "ok" : "warn") + '"/></svg>' + (st === "good" ? "Same" : st === "warn" ? "Another value" : "Unknown") + "</span></td></tr>";
    }).join("");
    body.innerHTML =
      '<div class="ss-tr-h"><span class="ss-tres ' + tx.cls + '"><svg class="i"><use href="#i-' + (tx.cls === "good" ? "ok" : "warn") + '"/></svg>' + LABEL[tx.cls] + "</span><b>" + esc(tx.title) + "</b></div>" +
      '<ul class="ss-tr-notes">' + tx.notes.map(function (n) { return "<li>" + esc(n) + "</li>"; }).join("") + "</ul>" + vals +
      (places ? '<b class="ss-tr-sub">Sent back in</b><table class="ss-test-t"><thead><tr><th>Request</th><th>The value it sent</th><th>Result</th></tr></thead><tbody>' + places + "</tbody></table>" +
        ((res.places || []).length > 60 ? '<p class="ss-muted">… and ' + (res.places.length - 60) + " more places</p>" : "") : "") +
      '<p class="ss-muted ss-test-note">A real run needs VuGen or DevWeb.</p>';
    if (dlg.open) dlg.close();
    dlg.showModal();
  }

  // the response: Body (the value marked; in add mode also the values a later request sends back) or Headers.
  // Long bodies are cut for the screen (the test reads the whole body).
  var MAXB = 200000, shownBody = null;
  function response(c, e) {
    var pre = $("#ss-ed-body"), hd = $("#ss-ed-hdrs"), text = String(e && e.respBody || ""), hmap = e && e.respHdrsMap || {};
    var nh = Object.keys(hmap).length;
    $$("#ss-ed-rtab [data-rv]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-rv") === rview)); b.disabled = !e; });
    $("#ss-ed-rtab [data-rv=headers]").textContent = "Headers" + (nh ? " (" + nh + ")" : "");
    $("#ss-ed-rt").textContent = e ? "Response of #" + e.id + " " + e.method + " " + (String(e.url || "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "").split("?")[0] || "/") : "The response";
    var lat = adding && e ? later(srcIdx) : [];
    $("#ss-ed-legend").hidden = !adding || !lat.length;
    var empty = !e || (rview === "body" ? !text : !nh);
    $("#ss-ed-empty").hidden = !e || !empty;
    $("#ss-ed-empty-t").textContent = rview === "body" ? "This response is empty in the recording (the browser did not keep it)." : "The recording has no headers for this response.";
    $("#ss-ed-paste").hidden = rview !== "body" || adding;
    pre.hidden = rview !== "body" || !text;
    hd.hidden = rview !== "headers" || !nh;
    $("#ss-ed-hint").textContent = !e ? (adding ? "Choose a request on the left." : "") : !adding && isList(c) ? "The values of the list are marked." : locked(c) ? "The value is marked." : rview === "headers" ? "Click a header to read the value from it." : "Select a value (or double-click it) to read it from here.";
    // a list: the values it reads are marked (every match of its JSON path, or of each field of a rebuilt list)
    var lpaths = !adding && isList(c) ? (c._arrayReconstruct ? ((c._arrayConfig || {}).columns || []).map(function (k) { return k._placeholder ? "" : k.sourceJsonPath; }).filter(Boolean) : [c.source && c.source.jsonPath].filter(Boolean)) : [];
    var lmark = adding && listSt ? listSt.values.slice(listSt.from - 1, listSt.to) : !adding && isList(c) && !c._arrayReconstruct ? lvals(c) : null;
    var key = cur + "|" + srcIdx + "|" + rview + "|" + text.length + "|" + c.value + "|" + (draft ? JSON.stringify(draft) : "") + "|" + lpaths.join(",") + "|" + tray.length + "|" + listKey();
    if (shownBody === key) return;
    shownBody = key;
    var v = String(c.value || "");
    if (rview === "headers") {
      hd.innerHTML = Object.keys(hmap).sort().map(function (k) {
        var hv = String(hmap[k]), isCur = v && hv === v, isLat = lat.some(function (x) { return x.kind === "header" && x.where === k; });
        return '<button type="button" class="ss-ed-hrow' + (isCur ? " is-cur" : isLat ? " is-later" : "") + '" data-h="' + esc(k) + '"' + (locked(c) ? " disabled" : "") + "><b>" + esc(k) + "</b><code>" + esc(hv) + "</code></button>";
      }).join("");
      return;
    }
    // ranges: the chosen value (every place) and, when adding, the first place of each value sent back later
    var t = text.length > MAXB ? text.slice(0, MAXB) : text, rs = [], i, j;
    (lmark && lmark.length ? lmark.map(function (x) { return /^\s*[[{]/.test(text) ? JSON.stringify(x).slice(1, -1) : x; }) : lpaths.length ? E.listValues(text, lpaths).map(function (x) { return JSON.stringify(x).slice(1, -1); }) : [v]).forEach(function (w) {
      if (w.length < 2) return;
      i = 0; while ((j = t.indexOf(w, i)) !== -1) { rs.push([j, j + w.length, "cur"]); i = j + w.length; }
    });
    var kept = adding ? tray.filter(function (x) { return x.srcIdx === srcIdx; }).map(function (x) { return x.value; }) : [];
    lat.forEach(function (x) {
      if (x.kind === "header" || x.value === v) return;
      var q = x.kind === "json" ? JSON.stringify(x.value).slice(1, -1) : x.value, k = t.indexOf(q);
      if (k !== -1) rs.push([k, k + q.length, kept.indexOf(x.value) !== -1 ? "kept" : "later"]);
    });
    rs.sort(function (a, b) { return a[0] - b[0] || (a[2] === "cur" ? -1 : 1); });
    var h = "", pos = 0, first = true;
    rs.forEach(function (r) {
      if (r[0] < pos) return;
      h += esc(t.slice(pos, r[0])) + "<mark" + (r[2] === "later" ? ' class="later" data-at="' + r[0] + '" title="Sent back by a later request: click to use it"' : r[2] === "kept" ? ' class="kept" title="Kept: in Values to add"' : first ? ' id="ss-ed-first"' : "") + ">" + esc(t.slice(r[0], r[1])) + "</mark>";
      if (r[2] === "cur") first = false;
      pos = r[1];
    });
    pre.innerHTML = h + esc(t.slice(pos)) + (text.length > MAXB ? '<span class="ss-muted">\n… (' + plural(text.length - MAXB, "more character") + ")</span>" : "");
    var m = $("#ss-ed-first") || (adding ? pre.querySelector("mark.later") : null);
    if (m) setTimeout(function () { m.scrollIntoView({ block: "center" }); }, 0);
    else pre.scrollTop = 0;
  }
  // the offset of the selection in the body text (marks are plain text inside the pre)
  function selection() {
    var s = window.getSelection(), pre = $("#ss-ed-body");
    if (!s || !s.rangeCount || s.isCollapsed) return null;
    var r = s.getRangeAt(0); if (!pre.contains(r.startContainer)) return null;
    var pr = document.createRange(); pr.selectNodeContents(pre); pr.setEnd(r.startContainer, r.startOffset);
    var txt = s.toString(), at = pr.toString().length, lead = txt.length - txt.replace(/^\s+/, "").length;
    return { at: at + lead, s: txt.trim() };
  }
  // a section selected (several values, options of a select): the list of what is inside it
  function sectionList(at, s) {
    var body = String(entry(srcIdx) && entry(srcIdx).respBody || ""), a = -1, v = "", m;
    var oi = s.search(/<option\b[^>]*\bvalue\s*=\s*["']/i);
    if (oi !== -1) { m = /<option\b[^>]*\bvalue\s*=\s*(["'])([^"']*)\1/i.exec(s.slice(oi)); if (m) { a = at + oi + m[0].length - 1 - m[2].length; v = m[2]; } }   // the value's own place (after selected="…" too)
    if (a === -1) {
      var inside = later(srcIdx).filter(function (x) { return x.kind !== "header"; }).map(function (x) { var q = x.kind === "json" ? JSON.stringify(x.value).slice(1, -1) : x.value, k = body.indexOf(q, at); return { v: x.value, at: k }; })
        .filter(function (x) { return x.at >= at && x.at < at + s.length; }).sort(function (p, q) { return p.at - q.at; });
      if (inside.length < 2) {
        // a JSON section: the first value inside it that is one of a list (its path has [n])
        var js = E.valuesOf(entry(srcIdx)).filter(function (x) { return x.kind === "json" && /[d+]/.test(x.where); })
          .map(function (x) { return { v: x.value, at: body.indexOf(JSON.stringify(x.value).slice(1, -1), at) }; })
          .filter(function (x) { return x.at >= at && x.at < at + s.length; }).sort(function (p, q) { return p.at - q.at; });
        if (!js.length) return false;
        inside = js;
      }
      a = inside[0].at; v = inside[0].v;
    }
    var r = E.listFrom(body, a, v, typeof findJsonPath === "function" ? findJsonPath : null, { at: at, len: s.length });
    if (r.why) { if (typeof showToast === "function") showToast(r.why, "warning", 4000); return true; }
    setList(r); return true;
  }
  function setList(r) { listSt = r; listSt.pick = "all"; listSt.nth = 1; draft = r.ext; kind = "list"; save(); draw(); }
  function pickAt(at, s) {
    var c = cand(cur); if (!c || locked(c)) return;
    if (adding && (/<option\b/i.test(s) || s.length > 80 || /\n/.test(s)) && sectionList(at, s)) return;
    if (adding) listSt = null;
    if (adding) hint = E.nameBefore(String(entry(srcIdx) && entry(srcIdx).respBody || ""), at);
    var e = entry(srcIdx), cur0 = adding ? (draft ? draft.extractorType : "") : kind;
    var want = /^(boundary|regexp|xpath)$/.test(cur0) ? cur0 : !adding && cur0 === "jsonpath" ? "jsonpath" : "any";
    var x = selFor(e, at, s, want);
    if (!x && adding && want !== "any") x = selFor(e, at, s, "any");
    if (!x) { if (typeof showToast === "function") showToast(want === "jsonpath" ? "No JSON path found for that selection: try Boundaries." : want === "xpath" ? "No XPath reads exactly that selection: select an element's text or an attribute value." : "No boundaries capture exactly that selection as the first match.", "warning", 4000); return; }
    draft = x; if (!adding) kind = x.extractorType; save(); draw();
  }
  function pick() { var sel = selection(); if (sel && sel.s && sel.s.length <= 4000) pickAt(sel.at, sel.s); }
  $("#ss-ed-body").addEventListener("mouseup", function () { setTimeout(pick, 0); });
  $("#ss-ed-body").addEventListener("dblclick", function () { setTimeout(pick, 0); });
  $("#ss-ed-body").addEventListener("click", function (ev) {
    var m = ev.target.closest("mark.later"); if (!m || !adding) return;
    var s = window.getSelection(); if (s && !s.isCollapsed) return;
    pickAt(+m.getAttribute("data-at"), m.textContent);
  });
  // a header: read the value from it
  function setHeader(name) {
    var c = cand(cur), e = entry(srcIdx); if (!c || !e || locked(c)) return;
    if (!adding && String((e.respHdrsMap || {})[name]) !== c.value) { if (typeof showToast === "function") showToast("This header does not have the value that is sent back.", "warning", 4000); return; }
    draft = { extractorType: "boundary_header", extractorConfig: { lb: name + ": ", rb: "\r\n" } }; kind = "header"; save(); draw();
  }

  // ── the controls ──
  box.addEventListener("click", function (ev) {
    var t = ev.target.closest("button"); if (!t || t.disabled) return;
    var c = cand(cur);
    if (t.id === "ss-ed-back") close();
    else if (t.id === "ss-ed-prev" || t.id === "ss-ed-next") { var l = SSC.list(), i = l.indexOf(cur); var n = l[i + (t.id === "ss-ed-next" ? 1 : -1)]; if (n) open(n); }
    else if (t.hasAttribute("data-kind")) { setKind(t.getAttribute("data-kind")); }
    else if (t.hasAttribute("data-rv")) { rview = t.getAttribute("data-rv"); rest(); }
    else if (t.hasAttribute("data-h")) { setHeader(t.getAttribute("data-h")); }
    else if (t.hasAttribute("data-known")) { if (!tray.length) open(t.getAttribute("data-known")); else if (typeof showToast === "function") showToast("Add or remove the kept values first.", "info", 3000); }
    else if (t.id === "ss-ed-keep") keep();
    else if (t.id === "ss-ed-run") runTest(c);
    else if (t.hasAttribute("data-untray")) { tray.splice(+t.getAttribute("data-untray"), 1); shownBody = null; rest(); }
    else if (t.id === "ss-ed-accept") { if (adding) addNow(); else if (editing && editing.id === c.id) saveEdit(c); else if (c._applied) startEdit(c); else { save(); if (c.status !== "accepted") advisorAccept(c.id); var l2 = SSC.list(), k = l2.indexOf(cur), nx = l2[k + 1]; if (nx) open(nx); else close(); } }
    else if (t.id === "ss-ed-skip") { advisorSkip(c.id); draw(); }
    else if (t.id === "ss-ed-reset" && editing) { cancelEdit(); shownBody = null; draw(); }
    else if (t.id === "ss-ed-reset") { delete c._edit; draft = null; kind = "auto"; srcIdx = c.source ? c.source.entryIdx : null; draw(); }
    else if (t.id === "ss-ed-src-up" || t.id === "ss-ed-src-down") { var o = $$("#ss-ed-src option").map(function (x) { return x.value; }).filter(Boolean).map(Number), p = o.indexOf(srcIdx); var to = p === -1 ? o[0] : o[p + (t.id === "ss-ed-src-down" ? 1 : -1)]; if (to != null) setSrc(to); }
    else if (t.id === "ss-ed-out") { if (SS.corrTakeOut) SS.corrTakeOut(c.id); shownBody = null; draw(); }
    else if (t.id === "ss-ed-paste") { if (typeof openPasteCorrelate === "function") openPasteCorrelate(); }
    else if (t.hasAttribute("data-pick")) {
      var pk = t.getAttribute("data-pick"), nv = $("#ss-ed-nth") ? $("#ss-ed-nth").value : 1;
      if (adding && listSt) { listSt.pick = pk; draw(); } else { advisorSetListPick(c.id, pk, nv); afterList(); }
    }
    else if (t.id === "ss-ed-fill") { advisorFillArrayPaths(c.id, $("#ss-ed-anchor").value); afterList(); }
  });
  // add mode: put the new value in the script (this value only; other ticked values wait for Add to the script)
  // the value shown, as a kept one (null when it is not ready)
  function current() {
    var c = nc;
    if (!c || !c.value || !draft || !testOk || !c.varName || taken(c.varName)) return null;
    return { srcIdx: srcIdx, draft: JSON.parse(JSON.stringify(draft)), value: c.value, varName: c.varName, usages: (c.usages || []).length,
      list: listSt ? { values: listSt.values.slice(), from: listSt.from, to: listSt.to, pick: listSt.pick, nth: listSt.nth } : null };
  }
  function keep() {
    var k = current(); if (!k) return;
    tray.push(k);
    // the next value: the same response, nothing chosen yet
    draft = null; kind = "auto"; nc.value = ""; nc.usages = []; nc.varName = ""; nameTyped = false; hint = ""; nc._edit = undefined; listSt = null;
    shownBody = null; draw();
    var m = $("#ss-ed-body mark.later"); if (m) m.focus();
  }
  function trayDraw() {
    var box2 = $("#ss-ed-tray"); box2.hidden = !tray.length;
    $("#ss-ed-tray-n").textContent = tray.length ? plural(tray.length, "value") : "";
    $("#ss-ed-tray-l").innerHTML = tray.map(function (k, i) {
      var e = entry(k.srcIdx), how = k.list ? "List of " + (k.list.to - k.list.from + 1) + ({ random: ", one at random", rotate: ", the next each iteration", nth: ", always no. " + k.list.nth }[k.list.pick] || "") : k.draft.extractorType === "jsonpath" ? "JSON path" : k.draft.extractorType === "boundary_header" ? "Header" : k.draft.extractorType === "regexp" ? "Regex" : k.draft.extractorType === "xpath" ? "XPath" : "Boundaries";
      return '<li><code>' + esc(k.varName) + '</code><span class="ss-muted">' + esc(how) + " · #" + (e ? e.id : "?") + " · " + plural(k.usages, "place") + '</span><button type="button" class="ds-btn ds-btn-xs ds-btn-ghost ss-icon" data-untray="' + i + '" title="Remove ' + esc(k.varName) + '" aria-label="Remove ' + esc(k.varName) + '"><svg class="i"><use href="#i-x"/></svg></button></li>';
    }).join("");
  }
  function addNow() {
    var all = tray.slice(), k = current(); if (k) all.push(k);
    if (!all.length) return;
    var names = [], places = 0, ids = [];
    all.forEach(function (x) {
      if (x.list) {
        var li = advisorAddList(x.srcIdx, x.draft, x.varName, x.list.values, { from: x.list.from, to: x.list.to, pick: x.list.pick, nth: x.list.nth });
        advisorApplyOne(li);
        names.push(li.varName); places += (li.usages || []).length; ids.push(li.id);
        return;
      }
      var t = x.draft.extractorType, cfg = x.draft.extractorConfig;
      var made = advisorAddManual(x.srcIdx, t === "jsonpath" ? "jsonpath" : t === "boundary_header" ? "header" : "boundary",
        t === "jsonpath" ? cfg.path : t === "boundary_header" ? String(cfg.lb || "").replace(/:\s*$/, "") : cfg.lb, x.varName, x.value);
      made._edit = { extractorType: t, extractorConfig: cfg, sourceIdx: x.srcIdx };
      advisorApplyOne(made);
      names.push(made.varName); places += (made.usages || []).length; ids.push(made.id);
    });
    close(true);
    regenerateFromAdvisor({ quiet: true });
    if (window.SSC && SSC.show) SSC.show("script", ids);
    if (typeof showToast === "function") showToast((names.length > 1 ? plural(names.length, "value") + " added to the script (" + names.join(", ") + ")" : names[0] + " added to the script") + (places ? " — sent back in " + plural(places, "place") + "." : "."), "success", 5000);
  }
  // a new way to read it: start from the value in this response
  function setKind(k) {
    var c = cand(cur), e = entry(srcIdx); if (!c) return;
    if (k === "list") {
      if (listSt) return;
      var bt = String(e && e.respBody || ""), at0 = c.value ? bt.indexOf(c.value) : -1;
      if (at0 === -1 && c.value) at0 = bt.indexOf(JSON.stringify(c.value).slice(1, -1));
      var r = at0 === -1 ? { why: "Choose a value in the body first." } : E.listFrom(bt, at0, c.value, typeof findJsonPath === "function" ? findJsonPath : null);
      if (r.why) { if (typeof showToast === "function") showToast(r.why, "warning", 4000); return; }
      setList(r); return;
    }
    if (adding && listSt) { var first = listSt.values[listSt.from - 1]; listSt = null; c.value = first; }
    if (k === "header") {
      var hs = adding ? (draft && draft.extractorType === "boundary_header" ? [] : E.headersWith(e, c.value)) : E.headersWith(e, c.value);
      if (adding && !hs.length) { rview = "headers"; kind = "header"; draw(); return; }
      draft = { extractorType: "boundary_header", extractorConfig: { lb: (hs[0] || "") + ": ", rb: "\r\n" } }; kind = k; rview = "headers"; save(); draw(); return;
    }
    kind = k;
    if (k === "auto") { draft = null; srcIdx = c.source ? c.source.entryIdx : srcIdx; save(); draw(); return; }
    rview = "body";
    var bodyText = String(e && e.respBody || ""), at = c.value ? bodyText.indexOf(c.value) : -1;
    if (k === "xpath" && at === -1 && c.value) at = 0;   // an XML value may be written with entities: the XPath finder reads the parsed text
    draft = (at !== -1 && selFor(e, at, c.value, k)) ||
      (k === "jsonpath" ? { extractorType: "jsonpath", extractorConfig: { path: "$." } } : k === "regexp" ? { extractorType: "regexp", extractorConfig: { pattern: "" } }
        : k === "xpath" ? { extractorType: "xpath", extractorConfig: { path: "" } } : { extractorType: "boundary", extractorConfig: { lb: "", rb: "" } });
    save(); draw();
  }
  function setSrc(i) {
    srcIdx = i; shownBody = null;
    var c = cand(cur), e = entry(i);
    if (adding) {
      c.source = { entryIdx: i, url: typeof _advShortUrl === "function" ? _advShortUrl(e) : "", jsonPath: null };
      draft = null; kind = "auto"; c.value = ""; c.usages = []; hint = ""; listSt = null; if (!nameTyped) c.varName = "";
      rview = "body"; save(); draw(); return;
    }
    // the value in the new response: read it the same way if possible, else by boundaries around it
    var k = kind === "auto" ? "any" : kind === "header" ? "header" : kind;
    if (k === "header") { var hs = E.headersWith(e, c.value); draft = hs.length ? { extractorType: "boundary_header", extractorConfig: { lb: hs[0] + ": ", rb: "\r\n" } } : draft; }
    else {
      var at = String(e && e.respBody || "").indexOf(c.value);
      var x = at !== -1 || k === "xpath" ? selFor(e, Math.max(at, 0), c.value, k) : null;
      if (x) { draft = x; kind = x.extractorType; }
      else if (kind === "auto" && (!c.source || i !== c.source.entryIdx)) { kind = "boundary"; draft = { extractorType: "boundary", extractorConfig: { lb: "", rb: "" } }; }
    }
    save(); draw();
  }
  $("#ss-ed-src").addEventListener("change", function () { if (this.value !== "") setSrc(+this.value); });
  // a list option changed: the cards and the editor show it
  function afterList() { if (typeof renderAdvisorPanel === "function") renderAdvisorPanel(); draw(); }
  box.addEventListener("change", function (ev) {
    if (ev.target.id === "ss-ed-nth") {
      var c0 = cand(cur), nv = Math.max(1, parseInt(ev.target.value, 10) || 1);
      if (adding && listSt) { listSt.nth = nv; rest(); } else if (c0) { advisorSetListPick(c0.id, "nth", nv); afterList(); }
      return;
    }
    if (ev.target.id !== "ss-ed-anchor") return;
    var c = cand(cur); if (!c || !c._arrayConfig) return;
    var cols = c._arrayConfig.columns || [];
    if (cols.some(function (k) { return k._placeholder; })) advisorFillArrayPaths(c.id, ev.target.value);   // as the card's Fill & apply
    else advisorSetArrayAnchor(c.id, ev.target.value);
    afterList();
  });
  $("#ss-ed-only").addEventListener("change", function () { draw(); });
  $("#ss-ed-srcq").addEventListener("input", function () { var c = cand(cur); if (c) sources(c, false, c.usages || []); });
  box.addEventListener("input", function (ev) {
    var id = ev.target.id, c = cand(cur); if (!c) return;
    if (id === "ss-ed-name" && adding) { nameTyped = !!ev.target.value.trim(); c.varName = typeof _advSafeVarName === "function" ? _advSafeVarName(ev.target.value) : ev.target.value; $("#ss-ed-h").textContent = c.varName || "New correlation"; rest(); return; }
    if (!draft) return;
    if (id === "ss-ed-path") draft.extractorConfig = { path: ev.target.value.trim() };
    else if (id === "ss-ed-lb" || id === "ss-ed-rb") draft.extractorConfig = { lb: $("#ss-ed-lb").value, rb: $("#ss-ed-rb").value };
    else if (id === "ss-ed-re") draft.extractorConfig = { pattern: ev.target.value };
    else if (id === "ss-ed-xp") draft.extractorConfig = { path: ev.target.value.trim() };
    else return;
    save();
    if (adding) { rest(); return; }
    test(c, entry(srcIdx)); refreshCode(c);
  });
  box.addEventListener("change", function (ev) {
    var c = cand(cur); if (!c) return;
    if (ev.target.id === "ss-ed-hdr") { draft = { extractorType: "boundary_header", extractorConfig: { lb: ev.target.value + ": ", rb: "\r\n" } }; save(); draw(); }
    if (ev.target.id === "ss-ed-name" && !adding) { advisorSetName(c.id, ev.target.value); ev.target.value = c.varName; $("#ss-ed-h").textContent = c.varName; refreshCode(c); }
    if (ev.target.id === "ss-ed-name" && adding) { ev.target.value = c.varName; }
  });
  function refreshCode(c) {
    code(c);
    var us = c.usages || [];
    $("#ss-ed-accept").disabled = !!c._applied || !us.length || !testOk;
    $("#ss-ed-reset").hidden = locked(c) || !c._edit;
  }
  document.addEventListener("keydown", function (ev) {
    if (!cur || box.hidden) return;
    if (ev.key === "Escape" && !document.querySelector("dialog[open]") && !ev.target.closest("input, select, textarea")) close();
  });

  // Correlation details (the engine's list under the table, one item per correlation in S.correlations): every item
  // has Edit (the editor, as for the table's values) and Remove (the table's Take out, with Undo). The correlations
  // Studio's own engines found are candidates too (advisorMirrorEngine), so every item has one.
  function forCorr(corr) {
    var cs = S.advisorCandidates || [];
    return cs.filter(function (x) { return x._engineCorr === corr && x._applied; })[0] ||
      cs.filter(function (x) { return x._applied && x.varName === corr.name; })[0] || null;
  }
  function itemCorr(it) {
    var items = Array.prototype.slice.call(document.querySelectorAll("#corr-list .corr-item"));
    return (S.correlations || [])[items.indexOf(it)] || null;
  }
  function decorate() {
    var items = document.querySelectorAll("#corr-list .corr-item");
    // one look-up for every item (a recording can have a thousand correlations)
    var byCorr = new Map(), byName = new Map();
    (S.advisorCandidates || []).forEach(function (x) {
      if (!x._applied) return;
      if (x._engineCorr && !byCorr.has(x._engineCorr)) byCorr.set(x._engineCorr, x);
      if (!byName.has(x.varName)) byName.set(x.varName, x);
    });
    Array.prototype.forEach.call(items, function (it, i) {
      var corr = (S.correlations || [])[i], c = corr ? byCorr.get(corr) || byName.get(corr.name) || null : null, has = it.querySelector(".ss-ci-act");
      if (!c) { if (has) has.remove(); it.classList.remove("ss-ci"); return; }
      if (has && has.getAttribute("data-id") === c.id) return;
      if (has) has.remove();
      var a = document.createElement("span");
      a.className = "ss-ci-act"; a.setAttribute("data-id", c.id);
      a.innerHTML = '<button type="button" class="ds-btn ds-btn-sm ss-btn-accent" data-ci-edit title="' + (madeByScript(c) ? "Open it: made while the script runs" : "Change how it is read, its response or its name") + '">' +
          '<svg class="i"><use href="#i-' + (madeByScript(c) ? "eye" : "edit") + '"/></svg>' + (madeByScript(c) ? "Open" : "Edit") + "</button>" +
        '<button type="button" class="ds-btn ds-btn-sm" data-ci-out title="Take it out of the script (Undo brings it back)"><svg class="i"><use href="#i-x"/></svg>Remove</button>';
      it.classList.add("ss-ci");
      it.appendChild(a);
    });
  }
  var cl = document.getElementById("corr-list");
  if (cl) new MutationObserver(function () { decorate(); }).observe(cl, { childList: true });
  decorate();
  document.addEventListener("click", function (ev) {
    var it = ev.target.closest && ev.target.closest("#corr-list .corr-item");
    if (!it) return;
    var bOut = ev.target.closest("[data-ci-out]"), bEd = ev.target.closest("[data-ci-edit]");
    if (!bOut && !bEd && ev.target.closest("button, input, a, select")) return;
    var corr = itemCorr(it); if (!corr) return;
    var c = forCorr(corr); if (!c) return;
    if (bOut) { if (SS.corrTakeOut) SS.corrTakeOut(c.id); return; }
    if (SS.curStep && SS.curStep() !== 2) SS.step(2, true);
    open(c.id);
  });

  window.SSE = { xp: xp, htmlRead: htmlRead, open: open, add: add, close: close, isOpen: function () { return !!cur; }, isAdding: function () { return adding; }, redraw: function () { if (cur) { shownBody = null; draw(); } } };
})();
