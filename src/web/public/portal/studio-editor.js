/* Script Studio — step 2, the correlation editor: one value at a time (window.SSE on the page; UMD StudioEdit for the
 * pure helpers, unit-tested in tests/unit/studioEditor.test.js).
 * Left: why it was found, the response it is read from, how it is read (Auto = the engine's choice, JSON path,
 * Boundaries, Header), tested as you type, the name, the code the script gets. Right: that response (select or
 * double-click a value to read it from there) and every request that sends the value back.
 * The choice is kept on the candidate as _edit = { extractorType, extractorConfig, sourceIdx }, which the engine's
 * advisorToCorrelation honours; the code shown is the generators' own (webHttpCorrCode / devwebExtractorDecl) for the
 * correlation advisorToCorrelation builds, so it is what the script gets. Accept ticks the value (advisorAccept);
 * "Add n to the script" in the table puts it in. A value already in the script is shown, not changed; a value no
 * later request sends back cannot be accepted. Regular expressions and XPath are not offered: the generators have no
 * extractor for them. */
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
  // what an extractor reads from one response (firstMatch = the engine's _advFirstMatch)
  function readWith(entry, ext, firstMatch) {
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
    return b ? { extractorType: "boundary", extractorConfig: { lb: b.lb, rb: b.rb } } : null;
  }
  return { jget: jget, readWith: readWith, headersWith: headersWith, fromSelection: fromSelection };
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
        '<label class="ss-fld" for="ss-ed-src">Read from the response of</label>' +
        '<div class="ss-ed-src"><select class="ss-field" id="ss-ed-src"></select>' +
          '<button type="button" class="ds-btn ds-btn-sm ds-btn-ghost ss-icon" id="ss-ed-src-up" title="The request before" aria-label="The request before"><svg class="i" style="transform:rotate(180deg)"><use href="#i-chev"/></svg></button>' +
          '<button type="button" class="ds-btn ds-btn-sm ds-btn-ghost ss-icon" id="ss-ed-src-down" title="The request after" aria-label="The request after"><svg class="i"><use href="#i-chev"/></svg></button></div>' +
        '<span class="ss-fld" id="ss-ed-kind-l">How to read it</span>' +
        '<span class="ss-seg ss-ed-kind" id="ss-ed-kind" role="group" aria-labelledby="ss-ed-kind-l">' +
          '<button type="button" data-kind="auto" aria-pressed="true" title="What the Correlation Advisor chose">Auto</button>' +
          '<button type="button" data-kind="jsonpath" aria-pressed="false">JSON path</button>' +
          '<button type="button" data-kind="boundary" aria-pressed="false">Boundaries</button>' +
          '<button type="button" data-kind="header" aria-pressed="false">Header</button></span>' +
        '<div class="ss-ed-expr" id="ss-ed-expr"></div>' +
        '<p class="ss-ed-test" id="ss-ed-test" role="status" aria-live="polite"></p>' +
        '<label class="ss-fld" for="ss-ed-name">Name in the script</label>' +
        '<input class="ss-field ss-ed-name" id="ss-ed-name" spellcheck="false" autocomplete="off" />' +
        '<span class="ss-fld">The code</span><pre class="ss-ed-code" id="ss-ed-code"></pre>' +
        '<div class="ss-ed-act"><button type="button" class="ds-btn ds-btn-primary" id="ss-ed-accept"><svg class="i"><use href="#i-ok"/></svg>Accept &amp; next</button>' +
          '<button type="button" class="ds-btn" id="ss-ed-skip">Skip</button><span class="ss-grow"></span>' +
          '<button type="button" class="ds-btn ds-btn-sm ds-btn-ghost" id="ss-ed-reset" title="Back to what the Correlation Advisor chose">Undo my changes</button></div>' +
      "</div>" +
      '<div class="ss-ed-right">' +
        '<div class="ss-ed-rh"><b>The response</b><span class="ss-muted" id="ss-ed-hint">Select a value (or double-click it) to read it from here.</span></div>' +
        '<pre class="ss-ed-body" id="ss-ed-body" tabindex="0"></pre>' +
        '<div class="ss-ed-empty" id="ss-ed-empty" hidden><p>This response is empty in the recording (the browser did not keep it).</p><button type="button" class="ds-btn ds-btn-sm" id="ss-ed-paste"><svg class="i"><use href="#i-paste"/></svg>Paste the response</button></div>' +
        '<div class="ss-ed-rh"><b>Sent back in</b><span class="ss-muted" id="ss-ed-n"></span></div>' +
        '<ul class="ss-ed-uses" id="ss-ed-uses"></ul>' +
      "</div>" +
    "</div>";
  tab.appendChild(box);

  var cur = null, kind = "auto", draft = null, srcIdx = null;
  function cand(id) { return (S.advisorCandidates || []).filter(function (c) { return c.id === id; })[0] || null; }
  function isList(c) { return !!(c._arrayReconstruct || c._selectAll); }
  function locked(c) { return !!c._applied || isList(c); }
  function entry(i) { return (S.entries1 || [])[i]; }
  // the extractor the engine would use, without the user's choice
  function auto(c) { var x = Object.assign({}, c); delete x._edit; return advisorToCorrelation(x); }
  function corrNow(c) { return advisorToCorrelation(c); }

  function open(id) {
    var c = cand(id); if (!c) return;
    cur = id; srcIdx = c._edit && c._edit.sourceIdx != null ? c._edit.sourceIdx : c.source ? c.source.entryIdx : null;
    draft = c._edit ? JSON.parse(JSON.stringify(c._edit)) : null;
    kind = draft ? (draft.extractorType === "boundary_header" ? "header" : draft.extractorType) : "auto";
    tab.classList.add("ss-cr-editing"); box.hidden = false;
    draw();
    $("#ss-ed-back").focus();
    var ws = $("#ss-t-corr"); if (ws.scrollTop) ws.scrollTop = 0;
  }
  function close() {
    if (!cur) return;
    var id = cur; cur = null; box.hidden = true; tab.classList.remove("ss-cr-editing");
    if (window.SSC) SSC.render();
    var r = document.querySelector('#ss-cr-body [data-id="' + id + '"] [data-edit]'); if (r) r.focus();
  }
  // keep the user's choice on the candidate (the engine reads it when the value is added to the script)
  function save() {
    var c = cand(cur); if (!c || locked(c)) return;
    if (kind === "auto" && (srcIdx == null || (c.source && srcIdx === c.source.entryIdx))) delete c._edit;
    else if (draft) c._edit = { extractorType: draft.extractorType, extractorConfig: draft.extractorConfig, sourceIdx: srcIdx };
  }
  function ext(c) { return kind === "auto" ? auto(c) : draft; }

  function draw() {
    var c = cand(cur); if (!c) { close(); return; }
    var lock = locked(c), us = c.usages || [], list = window.SSC ? SSC.list() : [], at = list.indexOf(cur);
    $("#ss-ed-h").textContent = c.varName;
    $("#ss-ed-tag").textContent = c._applied ? "In the script" : isList(c) ? "List" : c._edit ? "Changed by you" : c._explorer ? "From HAR Explorer" : c._paste ? "From Paste & Detect" : c._manual ? "Manual" : "";
    $("#ss-ed-pos").textContent = at >= 0 ? (at + 1) + " of " + list.length : "";
    $("#ss-ed-prev").disabled = at <= 0; $("#ss-ed-next").disabled = at < 0 || at >= list.length - 1;
    // why, in plain words
    var why = !us.length ? "<b>No later request sends this value back</b>, so there is nothing to correlate. Skip it."
      : c._applied ? "<b>This value is in the script.</b> It is read from the response below and sent back in " + plural(us.length, "place") + "."
      : c.confidence === "high" ? "<b>An earlier response sends this value</b> and " + plural(us.length, "later place") + " send it back. A new user gets a new value, so the script must read it from the response each time."
      : "<b>It looks like a " + esc(String(c.valueType || "token")) + "</b> by its shape, and " + plural(us.length, "later place") + " send it back. No earlier response was found that sends it: check the response, or use Can't find a value?";
    if (isList(c) && !c._applied) why += ' It is a list: how it is read and sent back is set in its <button type="button" class="adv-req-link" id="ss-ed-opts">list options</button>.';
    $("#ss-ed-why").innerHTML = why;
    // the source: requests before the first place the value is sent back
    var last = us.length ? Math.min.apply(null, us.map(function (u) { return u.entryIdx; })) : (S.entries1 || []).length;
    var opts = [];
    (S.entries1 || []).forEach(function (e, i) { if (i < last && !e.isMarker && !e.filtered) opts.push(i); });
    if (srcIdx != null && opts.indexOf(srcIdx) === -1) opts.push(srcIdx);
    var sel = $("#ss-ed-src");
    sel.innerHTML = (srcIdx == null ? '<option value="">— choose a request —</option>' : "") + opts.map(function (i) {
      var e = entry(i), p = String(e.url || "").replace(/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i, "") || "/";
      var has = String(e.respBody || "").indexOf(c.value) !== -1 || E.headersWith(e, c.value).length;
      return '<option value="' + i + '"' + (i === srcIdx ? " selected" : "") + ">#" + e.id + " " + esc(e.method) + " " + esc(p.length > 70 ? p.slice(0, 69) + "…" : p) + (has ? "  · has the value" : "") + "</option>";
    }).join("");
    sel.disabled = lock;
    $("#ss-ed-src-up").disabled = lock || opts.indexOf(srcIdx) <= 0;
    $("#ss-ed-src-down").disabled = lock || opts.indexOf(srcIdx) === -1 || opts.indexOf(srcIdx) >= opts.length - 1;
    // how to read it
    var e = srcIdx != null ? entry(srcIdx) : null, btxt = String(e && e.respBody || "");
    var isJson = (function () { try { JSON.parse(btxt); return !!btxt.trim(); } catch (x) { return false; } })();
    var heads = E.headersWith(e, c.value);
    $$("#ss-ed-kind [data-kind]").forEach(function (b) {
      var k = b.getAttribute("data-kind");
      b.setAttribute("aria-pressed", String(k === kind));
      b.disabled = lock || (k === "jsonpath" && !isJson) || (k === "header" && !heads.length);
      b.title = k === "jsonpath" && !isJson ? "This response is not JSON" : k === "header" && !heads.length ? "No header of this response has the value" : b.title;
    });
    expr(c, e, heads);
    test(c, e);
    var nm = $("#ss-ed-name"); if (document.activeElement !== nm) nm.value = c.varName; nm.disabled = !!c._applied;
    // the code the script gets (the generators' own functions, on the correlation the engine builds)
    var code = "";
    try {
      var tmp = Object.assign({}, c); if (kind === "auto") delete tmp._edit; else if (draft) tmp._edit = { extractorType: draft.extractorType, extractorConfig: draft.extractorConfig, sourceIdx: srcIdx };
      var corr = advisorToCorrelation(tmp);
      code = S.format === "webhttp" ? webHttpCorrCode(corr, "") : devwebExtractorDecl(corr);
    } catch (x) { code = "// (the code is shown once a response and a way to read it are chosen)"; }
    $("#ss-ed-code").textContent = code;
    var ok = testOk;
    $("#ss-ed-accept").disabled = !!c._applied || !us.length || !ok;
    $("#ss-ed-accept").title = !us.length ? "No later request sends this value back" : !ok ? "The way to read it does not give the value yet" : "Tick it and go to the next value";
    $("#ss-ed-skip").textContent = c.status === "skipped" ? "Put back" : "Skip";
    $("#ss-ed-skip").disabled = !!c._applied;
    $("#ss-ed-reset").hidden = lock || !c._edit && kind === "auto";
    body(c, e);
    // sent back in
    $("#ss-ed-n").textContent = us.length ? plural(us.length, "place") : "nowhere";
    $("#ss-ed-uses").innerHTML = us.length ? us.map(function (u) {
      return "<li>" + (typeof _advReqLink === "function" ? _advReqLink(u.entryIdx, u.url) : esc(u.url || "")) + '<small class="ss-muted">' + esc(typeof _advWhere === "function" ? _advWhere(u) : u.location || "") + "</small></li>";
    }).join("") : '<li class="ss-muted">No later request sends it back.</li>';
  }

  function expr(c, e, heads) {
    var x = $("#ss-ed-expr"), cfg = draft && draft.extractorConfig || {};
    if (kind === "auto") {
      var a; try { a = auto(c); } catch (err) { a = null; }
      var t = !a ? "" : a.extractorType === "jsonpath" ? "JSON path <code>" + esc(a.extractorConfig.path) + "</code>" + (a.extractorConfig.selectAll ? " (every match)" : "")
        : a.extractorType === "boundary" ? "Boundaries <code>" + esc(a.extractorConfig.lb) + "</code> … <code>" + esc(a.extractorConfig.rb) + "</code>"
        : a.extractorType === "boundary_header" ? "A response header (<code>" + esc(String(a.extractorConfig.lb || "").replace(/:\s*$/, "")) + "</code>)"
        : a.extractorType === "cookie" ? "The cookie <code>" + esc(a.extractorConfig.cookieName) + "</code>"
        : a.extractorType === "array_reconstruct" ? "The list, rebuilt (list options)" : esc(a.extractorType);
      x.innerHTML = '<p class="ss-muted">The Correlation Advisor reads it by ' + t + ".</p>";
      return;
    }
    var dis = locked(c) ? " disabled" : "";
    if (kind === "jsonpath") x.innerHTML = '<label class="ss-fld" for="ss-ed-path">JSON path</label><input class="ss-field ss-mono" id="ss-ed-path" spellcheck="false" value="' + esc(cfg.path || "") + '" placeholder="$.data.token"' + dis + " />";
    else if (kind === "boundary") x.innerHTML = '<div class="ss-ed-lr"><span><label class="ss-fld" for="ss-ed-lb">Left boundary</label><input class="ss-field ss-mono" id="ss-ed-lb" spellcheck="false" value="' + esc(cfg.lb || "") + '"' + dis + ' /></span><span><label class="ss-fld" for="ss-ed-rb">Right boundary</label><input class="ss-field ss-mono" id="ss-ed-rb" spellcheck="false" value="' + esc(cfg.rb || "") + '"' + dis + " /></span></div>";
    else if (kind === "header") {
      var h = String(cfg.lb || "").replace(/:\s*$/, "");
      x.innerHTML = '<label class="ss-fld" for="ss-ed-hdr">Response header</label><select class="ss-field" id="ss-ed-hdr"' + dis + ">" + heads.map(function (k) { return "<option" + (k === h.toLowerCase() ? " selected" : "") + ">" + esc(k) + "</option>"; }).join("") + "</select>";
    }
  }

  var testOk = false;
  function test(c, e) {
    var p = $("#ss-ed-test"), x = ext(c), r;
    testOk = false;
    if (!e) { p.className = "ss-ed-test bad"; p.textContent = "No earlier response was found that sends this value: choose one that has it (marked “has the value”), or use Can't find a value?"; return; }
    if (isList(c)) { testOk = true; p.className = "ss-ed-test"; p.textContent = "A list: every match is read when the script runs (see its list options)."; return; }
    try { r = E.readWith(e, x, _advFirstMatch); } catch (err) { r = { unknown: true }; }
    if (r.unknown) { testOk = true; p.className = "ss-ed-test"; p.textContent = isList(c) ? "A list: every match is read when the script runs." : "Read when the script runs (this way of reading is not tried here)."; return; }
    if (r.none) { p.className = "ss-ed-test bad"; p.textContent = r.why === "not JSON" ? "This response is not JSON." : "Nothing found in this response."; return; }
    if (r.value === c.value) { testOk = true; p.className = "ss-ed-test good"; p.innerHTML = '<svg class="i"><use href="#i-ok"/></svg><span>Reads <code>' + esc(short(r.value)) + "</code>, the value that is sent back.</span>"; return; }
    p.className = "ss-ed-test bad";
    p.innerHTML = '<svg class="i"><use href="#i-warn"/></svg><span>Reads <code>' + esc(short(r.value)) + "</code>, not the value sent back (<code>" + esc(short(c.value)) + "</code>).</span>";
  }
  function short(v) { v = String(v); return v.length > 80 ? v.slice(0, 79) + "…" : v; }

  // the response, the value marked; long bodies are cut for the screen (the test reads the whole body)
  var MAXB = 200000, shownBody = null;
  function body(c, e) {
    var pre = $("#ss-ed-body"), text = String(e && e.respBody || "");
    $("#ss-ed-empty").hidden = !!text || !e;
    pre.hidden = !text;
    $("#ss-ed-hint").textContent = !e ? "" : !text ? "" : locked(c) ? "The value is marked." : "Select a value (or double-click it) to read it from here.";
    var key = cur + "|" + srcIdx + "|" + text.length;
    if (shownBody === key) return;
    shownBody = key;
    var t = text.length > MAXB ? text.slice(0, MAXB) : text, v = String(c.value || ""), h = "", i = 0, j, first = true;
    while (v.length >= 2 && (j = t.indexOf(v, i)) !== -1) { h += esc(t.slice(i, j)) + '<mark' + (first ? ' id="ss-ed-first"' : "") + ">" + esc(v) + "</mark>"; i = j + v.length; first = false; }
    pre.innerHTML = h + esc(t.slice(i)) + (text.length > MAXB ? '<span class="ss-muted">\n… (' + plural(text.length - MAXB, "more character") + ")</span>" : "");
    var m = $("#ss-ed-first"); if (m) setTimeout(function () { m.scrollIntoView({ block: "center" }); }, 0);
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
  function pick() {
    var c = cand(cur); if (!c || locked(c)) return;
    var sel = selection(); if (!sel || !sel.s || sel.s.length > 4000) return;
    var e = entry(srcIdx);
    var x = E.fromSelection(e, sel.at, sel.s, kind === "boundary" ? "boundary" : kind === "jsonpath" ? "jsonpath" : "any", typeof findJsonPath === "function" ? findJsonPath : null, _advSafeBoundaries);
    if (!x) { if (typeof showToast === "function") showToast(kind === "jsonpath" ? "No JSON path found for that selection: try Boundaries." : "No boundaries capture exactly that selection as the first match.", "warning", 4000); return; }
    draft = x; kind = x.extractorType; save(); draw();
  }
  $("#ss-ed-body").addEventListener("mouseup", function () { setTimeout(pick, 0); });
  $("#ss-ed-body").addEventListener("dblclick", function () { setTimeout(pick, 0); });

  // ── the controls ──
  box.addEventListener("click", function (ev) {
    var t = ev.target.closest("button"); if (!t || t.disabled) return;
    var c = cand(cur);
    if (t.id === "ss-ed-back") close();
    else if (t.id === "ss-ed-prev" || t.id === "ss-ed-next") { var l = SSC.list(), i = l.indexOf(cur); var n = l[i + (t.id === "ss-ed-next" ? 1 : -1)]; if (n) open(n); }
    else if (t.hasAttribute("data-kind")) { setKind(t.getAttribute("data-kind")); }
    else if (t.id === "ss-ed-accept") { save(); if (c.status !== "accepted") advisorAccept(c.id); var l2 = SSC.list(), k = l2.indexOf(cur), nx = l2[k + 1]; if (nx) open(nx); else close(); }
    else if (t.id === "ss-ed-skip") { advisorSkip(c.id); draw(); }
    else if (t.id === "ss-ed-reset") { delete c._edit; draft = null; kind = "auto"; srcIdx = c.source ? c.source.entryIdx : null; draw(); }
    else if (t.id === "ss-ed-src-up" || t.id === "ss-ed-src-down") { var o = $$("#ss-ed-src option").map(function (x) { return x.value; }).filter(Boolean).map(Number), p = o.indexOf(srcIdx); var to = o[p + (t.id === "ss-ed-src-down" ? 1 : -1)]; if (to != null) setSrc(to); }
    else if (t.id === "ss-ed-paste") { if (typeof openPasteCorrelate === "function") openPasteCorrelate(); }
    else if (t.id === "ss-ed-opts") { close(); SSC.view("cards"); var card = document.getElementById("advc-" + c.id); if (card) card.scrollIntoView({ block: "center" }); }
  });
  // a new way to read it: start from the value in this response
  function setKind(k) {
    var c = cand(cur), e = entry(srcIdx); if (!c) return;
    kind = k;
    if (k === "auto") { draft = null; srcIdx = c.source ? c.source.entryIdx : srcIdx; save(); draw(); return; }
    var bodyText = String(e && e.respBody || ""), at = bodyText.indexOf(c.value);
    if (k === "header") { var hs = E.headersWith(e, c.value); draft = { extractorType: "boundary_header", extractorConfig: { lb: (hs[0] || "") + ": ", rb: "\r\n" } }; }
    else draft = (at !== -1 && E.fromSelection(e, at, c.value, k, typeof findJsonPath === "function" ? findJsonPath : null, _advSafeBoundaries)) ||
      (k === "jsonpath" ? { extractorType: "jsonpath", extractorConfig: { path: "$." } } : { extractorType: "boundary", extractorConfig: { lb: "", rb: "" } });
    save(); draw();
  }
  function setSrc(i) {
    srcIdx = i; shownBody = null;
    var c = cand(cur), e = entry(i);
    // the value in the new response: read it the same way if possible, else by boundaries around it
    var k = kind === "auto" ? "any" : kind === "header" ? "header" : kind;
    if (k === "header") { var hs = E.headersWith(e, c.value); draft = hs.length ? { extractorType: "boundary_header", extractorConfig: { lb: hs[0] + ": ", rb: "\r\n" } } : draft; }
    else {
      var at = String(e && e.respBody || "").indexOf(c.value);
      var x = at !== -1 ? E.fromSelection(e, at, c.value, k, typeof findJsonPath === "function" ? findJsonPath : null, _advSafeBoundaries) : null;
      if (x) { draft = x; kind = x.extractorType; }
      else if (kind === "auto" && (!c.source || i !== c.source.entryIdx)) { kind = "boundary"; draft = { extractorType: "boundary", extractorConfig: { lb: "", rb: "" } }; }
    }
    save(); draw();
  }
  $("#ss-ed-src").addEventListener("change", function () { if (this.value !== "") setSrc(+this.value); });
  box.addEventListener("input", function (ev) {
    var id = ev.target.id, c = cand(cur); if (!c || !draft) return;
    if (id === "ss-ed-path") draft.extractorConfig = { path: ev.target.value.trim() };
    else if (id === "ss-ed-lb" || id === "ss-ed-rb") draft.extractorConfig = { lb: $("#ss-ed-lb").value, rb: $("#ss-ed-rb").value };
    else return;
    save(); test(c, entry(srcIdx)); refreshCode(c);
  });
  box.addEventListener("change", function (ev) {
    var c = cand(cur); if (!c) return;
    if (ev.target.id === "ss-ed-hdr") { draft = { extractorType: "boundary_header", extractorConfig: { lb: ev.target.value + ": ", rb: "\r\n" } }; save(); draw(); }
    if (ev.target.id === "ss-ed-name") { advisorSetName(c.id, ev.target.value); ev.target.value = c.varName; $("#ss-ed-h").textContent = c.varName; refreshCode(c); }
  });
  function refreshCode(c) {
    try { var corr = advisorToCorrelation(c); $("#ss-ed-code").textContent = S.format === "webhttp" ? webHttpCorrCode(corr, "") : devwebExtractorDecl(corr); } catch (x) { /* shown on the next draw */ }
    var us = c.usages || [];
    $("#ss-ed-accept").disabled = !!c._applied || !us.length || !testOk;
    $("#ss-ed-reset").hidden = locked(c) || !c._edit;
  }
  document.addEventListener("keydown", function (ev) {
    if (!cur || box.hidden) return;
    if (ev.key === "Escape" && !document.querySelector("dialog[open]") && !ev.target.closest("input, select, textarea")) close();
  });

  window.SSE = { open: open, close: close, isOpen: function () { return !!cur; }, redraw: function () { if (cur) { shownBody = null; draw(); } } };
})();
