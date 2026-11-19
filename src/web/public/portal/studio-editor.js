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
 * the script = advisorAddManual + _edit + advisorApplyOne (this value only) + regenerate.
 * Regex: the first ( ) group of a regular expression is the value (VuGen web_reg_save_param_regexp, DevWeb
 * RegexpExtractor; tried here with the browser's engine). XPath: for XML responses (VuGen web_reg_save_param_xpath with
 * local-name() steps — VugenCodegen.vugenXpath — DevWeb XpathExtractor with the plain names; tried here in the
 * local-name() form, which matches both). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.StudioEdit = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  // the value at a JSON path ($.a.b[0].c, ['x'], [*] = every element: the first counts, as a single extractor reads)
  // → { value } | { none: true } | { unknown: true } (a path this reader does not follow: .., filters, functions)
  function jget(obj, path) {
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
    var v = cur[0];
    return { value: v !== null && typeof v === "object" ? JSON.stringify(v) : String(v) };
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
    if (kind !== "boundary") {
      var o = parse(body), p = o !== undefined && findPath ? findPath(body, s) : null;
      if (p && jget(o, p).value === s) return { extractorType: "jsonpath", extractorConfig: { path: p } };
      if (kind === "jsonpath") return null;
    }
    var b = safe(body, at, s);
    if (b && kind === "regexp") {
      var p = rx(b.lb) + (/[\r\n]/.test(s) ? "([\\s\\S]+?)" : "(.+?)") + rx(b.rb), c = compile(p), m = c.re && c.re.exec(body);
      return m && m[1] === s ? { extractorType: "regexp", extractorConfig: { pattern: p } } : null;
    }
    return b ? { extractorType: "boundary", extractorConfig: { lb: b.lb, rb: b.rb } } : null;
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
  // The values a response gives that could be correlated: JSON leaves (strings and numbers, with their path), else the
  // value="…" attributes of an HTML / text page, and the response headers above. 4 to 2000 characters, no spaces,
  // not a 1–3 digit number, not one of the WORDS; each value once.
  function valuesOf(entry) {
    var out = [], seen = {};
    function add(v, where, kind) {
      v = String(v);
      if (v.length < 4 || v.length > 2000 || /\s/.test(v) || /^\d{1,3}$/.test(v) || WORDS.test(v) || seen[v]) return;
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
      var at = /\s[\w:.-]+\s*=\s*"([^"<>\s]{4,2000})"/g;   // other attributes (an XML id="…"); only those sent back are marked
      while ((m = at.exec(body))) add(m[1], "page", "body");
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
  return { jget: jget, readWith: readWith, headersWith: headersWith, fromSelection: fromSelection, compile: compile, rx: rx, nameBefore: nameBefore, nameOfXpath: nameOfXpath, valuesOf: valuesOf, sentIndex: sentIndex, laterValues: laterValues };
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
    '<div class="ss-ed-cols">' +
      '<div class="ss-ed-left">' +
        '<p class="ss-ed-why" id="ss-ed-why"></p>' +
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
          '<button type="button" data-kind="header" aria-pressed="false">Header</button></span>' +
        '<div class="ss-ed-expr" id="ss-ed-expr"></div>' +
        '<p class="ss-ed-test" id="ss-ed-test" role="status" aria-live="polite"></p>' +
        '<div class="ss-ed-sec"><span class="ss-ed-num">3</span><label class="ss-fld" for="ss-ed-name">Name in the script</label></div>' +
        '<input class="ss-field ss-ed-name" id="ss-ed-name" spellcheck="false" autocomplete="off" />' +
        '<p class="ss-ed-err" id="ss-ed-nerr" hidden></p>' +
        '<span class="ss-fld">The code</span><pre class="ss-ed-code" id="ss-ed-code"></pre>' +
        '<div class="ss-ed-act"><button type="button" class="ds-btn ds-btn-primary" id="ss-ed-accept"><svg class="i"><use href="#i-ok"/></svg><span id="ss-ed-accept-t">Accept &amp; next</span></button>' +
          '<button type="button" class="ds-btn" id="ss-ed-skip">Skip</button><span class="ss-grow"></span>' +
          '<button type="button" class="ds-btn ds-btn-sm ds-btn-ghost" id="ss-ed-reset" title="Back to what the Correlation Advisor chose">Undo my changes</button></div>' +
      "</div>" +
      '<div class="ss-ed-right">' +
        '<div class="ss-ed-rh"><b id="ss-ed-rt">The response</b>' +
          '<span class="ss-seg ss-ed-rtab" id="ss-ed-rtab" role="group" aria-label="Show"><button type="button" data-rv="body" aria-pressed="true">Body</button><button type="button" data-rv="headers" aria-pressed="false">Headers</button></span>' +
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

  var cur = null, kind = "auto", draft = null, srcIdx = null, rview = "body";
  // add mode: the new correlation being made (not in the Advisor's list until it is added)
  var adding = false, nc = null, nameTyped = false, idxFor = null, idx = null, laterFor = {}, hint = "";
  function cand(id) { if (adding) return nc; return (S.advisorCandidates || []).filter(function (c) { return c.id === id; })[0] || null; }
  function isList(c) { return !!(c._arrayReconstruct || c._selectAll); }
  function locked(c) { return !adding && (!!c._applied || isList(c)); }
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

  function open(id) {
    var c = (S.advisorCandidates || []).filter(function (x) { return x.id === id; })[0]; if (!c) return;
    adding = false; nc = null;
    cur = id; srcIdx = c._edit && c._edit.sourceIdx != null ? c._edit.sourceIdx : c.source ? c.source.entryIdx : null;
    draft = c._edit ? JSON.parse(JSON.stringify(c._edit)) : null;
    kind = draft ? (draft.extractorType === "boundary_header" ? "header" : draft.extractorType) : "auto";
    rview = kind === "header" ? "headers" : "body";
    show();
  }
  // Add manual correlation: the same screen for a value the Correlation Advisor did not list
  function add(from) {
    adding = true; nameTyped = false; cur = "new"; draft = null; kind = "auto"; rview = "body";
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
    if (!adding) $("#ss-ed-back").focus();
    var ws = $("#ss-t-corr"); if (ws.scrollTop) ws.scrollTop = 0;
  }
  function close() {
    if (!cur) return;
    var id = cur, was = adding; cur = null; adding = false; nc = null; box.hidden = true; tab.classList.remove("ss-cr-editing");
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
  // names in use: correlations in the script and the Advisor's suggestions
  function taken(n) {
    return (S.correlations || []).some(function (x) { return x.name === n; }) ||
      (S.advisorCandidates || []).some(function (x) { return x.varName === n && x.status !== "skipped"; });
  }
  function free(n) { n = n || "value"; if (!taken(n)) return n; for (var i = 2; i < 999; i++) if (!taken(n + "_" + i)) return n + "_" + i; return n; }

  function draw() {
    var c = cand(cur); if (!c) { close(); return; }
    var lock = locked(c), us = c.usages || [], list = window.SSC && !adding ? SSC.list() : [], at = list.indexOf(cur);
    $("#ss-ed-h").textContent = adding ? (c.varName || "New correlation") : c.varName;
    $("#ss-ed-tag").textContent = adding ? "Manual" : c._applied ? "In the script" : isList(c) ? "List" : c._edit ? "Changed by you" : c._explorer ? "From HAR Explorer" : c._paste ? "From Paste & Detect" : c._manual ? "Manual" : "";
    $("#ss-ed-pos").textContent = at >= 0 ? (at + 1) + " of " + list.length : "";
    $("#ss-ed-prev").hidden = $("#ss-ed-next").hidden = adding;
    $("#ss-ed-prev").disabled = at <= 0; $("#ss-ed-next").disabled = at < 0 || at >= list.length - 1;
    $("#ss-ed-back").lastChild.textContent = adding ? "Cancel" : "Back to the list";
    // why, in plain words
    var why;
    if (adding) why = "<b>Add a value yourself.</b> Choose the request whose response has it, then select the value on the right — or click one of the marked values. How it is read, its name and where it is sent back fill in.";
    else {
      why = !us.length ? "<b>No later request sends this value back</b>, so there is nothing to correlate. Skip it."
        : c._applied ? "<b>This value is in the script.</b> It is read from the response below and sent back in " + plural(us.length, "place") + ". To change how it is read, " + '<button type="button" class="adv-req-link" id="ss-ed-out">take it out of the script</button> first (Undo puts it back).'
        : c.confidence === "high" ? "<b>An earlier response sends this value</b> and " + plural(us.length, "later place") + " send it back. A new user gets a new value, so the script must read it from the response each time."
        : "<b>It looks like a " + esc(String(c.valueType || "token")) + "</b> by its shape, and " + plural(us.length, "later place") + " send it back. No earlier response was found that sends it: check the response, or use Can't find a value?";
      if (isList(c) && !c._applied) why += ' It is a list: how it is read and sent back is set in its <button type="button" class="adv-req-link" id="ss-ed-opts">list options</button>.';
    }
    $("#ss-ed-why").innerHTML = why;
    $("#ss-ed-src-l").textContent = adding ? "Comes from (the request whose response has the value)" : "Read from the response of";
    $("#ss-ed-find").hidden = !adding;
    sources(c, lock, us);
    // how to read it
    var e = srcIdx != null ? entry(srcIdx) : null, btxt = String(e && e.respBody || "");
    var isJson = (function () { try { JSON.parse(btxt); return !!btxt.trim(); } catch (x) { return false; } })(), isXml = !!xml(btxt);
    var heads = adding ? Object.keys(e && e.respHdrsMap || {}) : E.headersWith(e, c.value);
    $$("#ss-ed-kind [data-kind]").forEach(function (b) {
      var k = b.getAttribute("data-kind");
      b.hidden = adding && k === "auto";
      var on = adding ? draft && (k === "header" ? draft.extractorType === "boundary_header" : draft.extractorType === k) : k === kind;
      b.setAttribute("aria-pressed", String(!!on));
      b.disabled = lock || !e || (k === "jsonpath" && !isJson) || (k === "xpath" && !isXml) || (k === "regexp" && !btxt) || (k === "header" && !heads.length);
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
      if (srcIdx != null && opts.indexOf(srcIdx) === -1) opts.push(srcIdx);
    }
    sel.innerHTML = (srcIdx == null ? '<option value="">' + (opts.length ? "— choose a request (" + opts.length + ") —" : "— no request matches —") + "</option>" : "") + opts.map(function (i) {
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
      $("#ss-ed-accept-t").textContent = "Add to the script";
      acc.disabled = !c.value || !c.varName || !!nameBad || !testOk;
      acc.title = !c.value ? "Choose a value first" : nameBad || "Put it in the script now (only this value)";
    } else {
      $("#ss-ed-accept-t").textContent = "Accept & next";
      acc.disabled = !!c._applied || !us.length || !testOk;
      acc.title = !us.length ? "No later request sends this value back" : !testOk ? "The way to read it does not give the value yet" : "Tick it and go to the next value";
    }
    $("#ss-ed-skip").hidden = adding;
    $("#ss-ed-skip").textContent = c.status === "skipped" ? "Put back" : "Skip";
    $("#ss-ed-skip").disabled = !!c._applied;
    $("#ss-ed-reset").hidden = adding || lock || !c._edit && kind === "auto";
    response(c, e);
    // sent back in
    $("#ss-ed-n").textContent = us.length ? plural(us.length, "place") : adding && !c.value ? "" : "nowhere";
    $("#ss-ed-uses").innerHTML = us.length ? us.map(function (u) {
      return "<li>" + (typeof _advReqLink === "function" ? _advReqLink(u.entryIdx, u.url) : esc(u.url || "")) + '<small class="ss-muted">' + esc(typeof _advWhere === "function" ? _advWhere(u) : u.location || "") + "</small></li>";
    }).join("") : '<li class="ss-muted">' + (adding && !c.value ? "Choose a value to see where it is sent back." : "No later request sends it back.") + "</li>";
  }
  // the code the script gets (the generators' own functions, on the correlation the engine builds)
  function code(c) {
    var s = "";
    try {
      if (adding && !draft) throw new Error("none");
      var tmp = Object.assign({}, c); if (!adding && kind === "auto") delete tmp._edit; else if (draft) tmp._edit = { extractorType: draft.extractorType, extractorConfig: draft.extractorConfig, sourceIdx: srcIdx };
      if (!tmp.varName) tmp.varName = "value";
      var corr = advisorToCorrelation(tmp);
      s = S.format === "webhttp" ? webHttpCorrCode(corr, "") : devwebExtractorDecl(corr);
    } catch (x) { s = "// The code is shown once a response and a value are chosen."; }
    $("#ss-ed-code").textContent = s;
  }

  function expr(c, e, heads) {
    var x = $("#ss-ed-expr"), cfg = draft && draft.extractorConfig || {};
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
    if (adding) {
      if (!e || !draft) { p.className = "ss-ed-test"; p.textContent = ""; p.hidden = true; return; }
      p.hidden = false;
      try { r = E.readWith(e, x, _advFirstMatch, xp); } catch (err) { r = { unknown: true }; }
      if (r.bad) { p.className = "ss-ed-test bad"; p.textContent = r.bad; return; }
      if (r.unknown) { p.className = "ss-ed-test bad"; p.textContent = draft.extractorType === "boundary" ? "Type both boundaries." : "Choose how to read it."; return; }
      if (r.none) { p.className = "ss-ed-test bad"; p.textContent = r.why === "not JSON" ? "This response is not JSON." : r.why === "not XML" ? "This response is not XML." : "Nothing found in this response."; return; }
      testOk = true;
      var n = (c.usages || []).length;
      // the Correlation Advisor lists this value already: say so (adding it again makes a second extractor)
      var known = (S.advisorCandidates || []).filter(function (x) { return x.value === String(r.value) && x.status !== "skipped"; })[0];
      p.className = "ss-ed-test " + (n && !known ? "good" : "warn");
      p.innerHTML = '<svg class="i"><use href="#i-' + (n && !known ? "ok" : "warn") + '"/></svg><span>Reads <code>' + esc(short(r.value)) + "</code>" +
        (n ? ", sent back in " + plural(n, "later place") + "." : ". No later request sends it back as recorded: check that this is the value you want.") +
        (known ? ' The Correlation Advisor lists this value already as <b>' + esc(known.varName) + "</b>" + (known._applied ? " (in the script)" : "") +
          ': <button type="button" class="adv-req-link" data-known="' + esc(known.id) + '">open it</button> instead.' : "") + "</span>";
      return;
    }
    p.hidden = false;
    if (!e) { p.className = "ss-ed-test bad"; p.textContent = "No earlier response was found that sends this value: choose one that has it (marked “has the value”), or use Can't find a value?"; return; }
    if (isList(c)) { testOk = true; p.className = "ss-ed-test"; p.textContent = "A list: every match is read when the script runs (see its list options)."; return; }
    try { r = E.readWith(e, x, _advFirstMatch, xp); } catch (err) { r = { unknown: true }; }
    if (r.bad) { p.className = "ss-ed-test bad"; p.textContent = r.bad; return; }
    if (r.unknown) { testOk = true; p.className = "ss-ed-test"; p.textContent = "Read when the script runs (this way of reading is not tried here)."; return; }
    if (r.none) { p.className = "ss-ed-test bad"; p.textContent = r.why === "not JSON" ? "This response is not JSON." : r.why === "not XML" ? "This response is not XML." : "Nothing found in this response."; return; }
    if (r.value === c.value) { testOk = true; p.className = "ss-ed-test good"; p.innerHTML = '<svg class="i"><use href="#i-ok"/></svg><span>Reads <code>' + esc(short(r.value)) + "</code>, the value that is sent back.</span>"; return; }
    p.className = "ss-ed-test bad";
    p.innerHTML = '<svg class="i"><use href="#i-warn"/></svg><span>Reads <code>' + esc(short(r.value)) + "</code>, not the value sent back (<code>" + esc(short(c.value)) + "</code>).</span>";
  }
  function short(v) { v = String(v); return v.length > 80 ? v.slice(0, 79) + "…" : v; }

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
    $("#ss-ed-hint").textContent = !e ? (adding ? "Choose a request on the left." : "") : locked(c) ? "The value is marked." : rview === "headers" ? "Click a header to read the value from it." : "Select a value (or double-click it) to read it from here.";
    var key = cur + "|" + srcIdx + "|" + rview + "|" + text.length + "|" + c.value + "|" + (draft ? JSON.stringify(draft) : "");
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
    if (v.length >= 2) { i = 0; while ((j = t.indexOf(v, i)) !== -1) { rs.push([j, j + v.length, "cur"]); i = j + v.length; } }
    lat.forEach(function (x) {
      if (x.kind === "header" || x.value === v) return;
      var q = x.kind === "json" ? JSON.stringify(x.value).slice(1, -1) : x.value, k = t.indexOf(q);
      if (k !== -1) rs.push([k, k + q.length, "later"]);
    });
    rs.sort(function (a, b) { return a[0] - b[0] || (a[2] === "cur" ? -1 : 1); });
    var h = "", pos = 0, first = true;
    rs.forEach(function (r) {
      if (r[0] < pos) return;
      h += esc(t.slice(pos, r[0])) + "<mark" + (r[2] === "later" ? ' class="later" data-at="' + r[0] + '" title="Sent back by a later request: click to use it"' : first ? ' id="ss-ed-first"' : "") + ">" + esc(t.slice(r[0], r[1])) + "</mark>";
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
  function pickAt(at, s) {
    var c = cand(cur); if (!c || locked(c)) return;
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
    else if (t.hasAttribute("data-known")) { open(t.getAttribute("data-known")); }
    else if (t.id === "ss-ed-accept") { if (adding) addNow(); else { save(); if (c.status !== "accepted") advisorAccept(c.id); var l2 = SSC.list(), k = l2.indexOf(cur), nx = l2[k + 1]; if (nx) open(nx); else close(); } }
    else if (t.id === "ss-ed-skip") { advisorSkip(c.id); draw(); }
    else if (t.id === "ss-ed-reset") { delete c._edit; draft = null; kind = "auto"; srcIdx = c.source ? c.source.entryIdx : null; draw(); }
    else if (t.id === "ss-ed-src-up" || t.id === "ss-ed-src-down") { var o = $$("#ss-ed-src option").map(function (x) { return x.value; }).filter(Boolean).map(Number), p = o.indexOf(srcIdx); var to = p === -1 ? o[0] : o[p + (t.id === "ss-ed-src-down" ? 1 : -1)]; if (to != null) setSrc(to); }
    else if (t.id === "ss-ed-out") { if (SS.corrTakeOut) SS.corrTakeOut(c.id); shownBody = null; draw(); }
    else if (t.id === "ss-ed-paste") { if (typeof openPasteCorrelate === "function") openPasteCorrelate(); }
    else if (t.id === "ss-ed-opts") { close(); SSC.view("cards"); var card = document.getElementById("advc-" + c.id); if (card) card.scrollIntoView({ block: "center" }); }
  });
  // add mode: put the new value in the script (this value only; other ticked values wait for Add to the script)
  function addNow() {
    var c = nc; if (!c || !c.value || !draft || !testOk) return;
    var t = draft.extractorType;
    var made = advisorAddManual(srcIdx, t === "jsonpath" ? "jsonpath" : t === "boundary_header" ? "header" : "boundary",
      t === "jsonpath" ? draft.extractorConfig.path : t === "boundary_header" ? String(draft.extractorConfig.lb || "").replace(/:\s*$/, "") : draft.extractorConfig.lb, c.varName, c.value);
    made._edit = { extractorType: t, extractorConfig: draft.extractorConfig, sourceIdx: srcIdx };
    advisorApplyOne(made);
    var name = made.varName, n = (made.usages || []).length;
    close();
    regenerateFromAdvisor({ quiet: true });
    if (typeof showToast === "function") showToast(name + " added to the script" + (n ? " — sent back in " + plural(n, "place") + "." : "."), "success", 4000);
  }
  // a new way to read it: start from the value in this response
  function setKind(k) {
    var c = cand(cur), e = entry(srcIdx); if (!c) return;
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
      draft = null; kind = "auto"; c.value = ""; c.usages = []; hint = ""; if (!nameTyped) c.varName = "";
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

  window.SSE = { open: open, add: add, close: close, isOpen: function () { return !!cur; }, isAdding: function () { return adding; }, redraw: function () { if (cur) { shownBody = null; draw(); } } };
})();
