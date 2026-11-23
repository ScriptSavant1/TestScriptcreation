/* Script Studio — step 2, Correlate: the Correlation Advisor's findings as one table (window.SSC).
 * The engine stays the judge of everything: a tick is the candidate's "accepted" status (advisorAccept), Skip is
 * advisorSkip, the name is advisorSetName, "Add to the script" is advisorApplyAndRegen — the same calls the cards make,
 * so the script is exactly what the cards would give. The engine's cards stay on the page (Cards view); a list's options
 * (every value or one at random, how it is rebuilt) are in the editor (Options opens it).
 * High-confidence values come ticked when the user opens the step (once per reading); nothing reaches the script
 * before "Add to the script", and leaving the step with ticked values asks first (SS.leaveCorr). */
(function () {
  "use strict";
  var SS = window.SS;
  if (!SS || !document.getElementById("ss-corr")) return;
  var $ = SS.$, $$ = SS.$$, esc = SS.esc, plural = SS.plural, prefs = SS.prefs;

  var F = { q: "", type: "", conf: "", show: "review" };
  var tickedFor = null;   // the candidate list whose High values were ticked for the user
  var KIND = { jwt: "Sign-in token (JWT)", uuid: "Id (UUID)", hex: "Token (hex)", token: "Token", array: "List of values", list: "List of values", json: "JSON value", xml: "XML value", html: "HTML value", text: "Text", unknown: "Value" };
  function kind(c) { return KIND[c.valueType] || (c.valueType ? String(c.valueType).charAt(0).toUpperCase() + String(c.valueType).slice(1) : "Value"); }
  function tag(c) {
    return c._edit && !c._applied ? "Changed by you" : c._engineCorr ? (c._fixed ? "Made while it runs" : "Found by Studio") : c._more ? "Repeated value" : c._explorer ? "From HAR Explorer" : c._paste ? "From Paste & Detect" : c._manual ? "Manual" : c._arrayReconstruct ? "Array rebuild" : c._select ? "Options of a select" : c._selectAll ? "List" : "";
  }
  // the correlations Studio's own engines found are listed here too (advisorMirrorEngine, studio-advisor.js), after
  // every reading; what the user took out of them stays out over later readings of the same recording (by name and
  // response — the hooks analyze() calls before and after the Advisor's scan)
  var engineOut = { har: null, keys: [] };
  window.studioBeforeRead = function () {
    var prev = S.advisorCandidates || [];
    engineOut = { har: S.har1, keys: prev.filter(function (c) { return c._engineKey && !c._applied; }).map(function (c) { return c._engineKey; }) };
  };
  window.studioAfterAdvisor = function () {
    if (typeof advisorMirrorEngine === "function") advisorMirrorEngine(engineOut.har === S.har1 ? engineOut.keys : []);
  };
  function all() { return S.advisorCandidates || []; }
  function ticked() { return all().filter(function (c) { return c.status === "accepted" && !c._applied; }); }
  SS.corrTicked = function () { return ticked().length; };

  function shown(c) {
    if (F.show === "review" && (c._applied || c.status === "skipped")) return false;
    if (F.show === "script" && !c._applied) return false;
    if (F.show === "skipped" && c.status !== "skipped") return false;
    if (F.type && c.valueType !== F.type) return false;
    if (F.conf && (F.conf === "high") !== (c.confidence === "high")) return false;
    if (F.q) {
      var src = c.source && S.entries1 && S.entries1[c.source.entryIdx];
      var hay = [c.varName, c.value, c.preview, src && src.url].concat((c.usages || []).map(function (u) { var e = S.entries1 && S.entries1[u.entryIdx]; return e && e.url; })).join(" ").toLowerCase();
      if (hay.indexOf(F.q.toLowerCase()) === -1) return false;
    }
    return true;
  }

  // the engine's helpers draw the request links (#id METHOD /path, a click opens its details)
  function from(c) {
    if (c._gen) return '<span class="ss-cr-browser" title="The script makes a new UUID before the first request that sends it">A new UUID</span><small class="ss-muted">made by the script</small>';
    if (c._browser) return '<span class="ss-cr-browser" title="No response sends it before it is first sent: a script in the page made it, so the script cannot read it">Made in the browser</span><small class="ss-muted">not read from a response</small>';
    if (!c.source) return '<span class="ss-muted">Not in an earlier response</span>';
    return (typeof _advReqLink === "function" ? _advReqLink(c.source.entryIdx, c.source.url) : esc(c.source.url || "")) +
      (c.source.jsonPath ? '<small class="ss-cr-where">' + esc(c.source.jsonPath) + "</small>" : "");
  }
  function uses(c) {
    var us = c.usages || [];
    if (!us.length) return '<span class="ss-muted">No later request</span>';
    var u = us[0];
    return (typeof _advReqLink === "function" ? _advReqLink(u.entryIdx, u.url) : esc(u.url || "")) +
      '<small class="ss-cr-where">' + esc(typeof _advWhere === "function" ? _advWhere(u) : u.location || "") +
      (us.length > 1 ? ' <button type="button" class="adv-more" data-uses="' + esc(c.id) + '" title="Every place this value is sent back">+' + (us.length - 1) + " more</button>" : "") + "</small>";
  }
  // a token the server renews (the same name and field, a new value each time) is one row; it opens to the renewals
  var openG = {}, G = {};
  function gkey(c) { return c.varName + "|" + (c.source && c.source.jsonPath || "") + "|" + (c._applied ? 1 : 0) + (c._browser ? "|b" : ""); }
  function rowsHtml(rows) {
    var by = {}, order = [];
    G = {};
    rows.forEach(function (c) { var k = gkey(c); if (!by[k]) { by[k] = []; order.push(k); } by[k].push(c); });
    return order.map(function (k, i) {
      var g = by[k];
      if (g.length < 2) return row(g[0]);
      var gid = "g" + i; G[gid] = g.map(function (c) { return c.id; });
      return grow(gid, g, !!openG[k]) + (openG[k] ? g.map(function (c) { return row(c, true); }).join("") : "");
    }).join("");
  }
  // Generate a UUID (a value made in the browser, BUG-151): the script makes a new one before the first request that sends it
  function genBtn(on, attr, n) {
    return '<button type="button" class="ds-btn ds-btn-sm' + (on ? "" : " ss-btn-accent") + '" ' + attr + ' aria-pressed="' + !!on + '" title="' +
      (on ? "Back as it was: not in the script" : "The script makes a new UUID before the first request that sends " + (n > 1 ? "each of them" : "it") + " — then add it as any other value") + '">' +
      (on ? "Don't generate" : n > 1 ? "Generate UUIDs" : "Generate a UUID") + "</button>";
  }
  function grow(gid, g, open) {
    var c = g[0], ticked = g.filter(function (x) { return x.status === "accepted" || x._applied; }).length, uses = 0;
    g.forEach(function (x) { uses += (x.usages || []).length; });
    var conf = g.some(function (x) { return x.confidence === "high"; }) ? '<span class="ss-conf hi" title="Traced: earlier responses send these values">High</span>' : '<span class="ss-conf md" title="Found by shape only">Medium</span>';
    // made in the browser, every one (BUG-151): a new value each time, from no response — nothing to tick, unless the
    // script generates them (Generate UUIDs)
    var made = g.every(function (x) { return !advisorCanAccept(x); });
    var canGen = !c._applied && g.every(function (x) { return advisorCanGenerate(x) && x.status !== "skipped"; }), allGen = canGen && g.every(function (x) { return x._gen; });
    if (allGen) made = false;
    var newEach = made || canGen || g.every(function (x) { return x._gen; });   // the wording: a new value each time, not renewed by the server
    var act = (canGen ? genBtn(allGen, 'data-ggen="' + gid + '"', g.length) : "") + '<button type="button" class="ds-btn ds-btn-sm" data-gexp="' + gid + '" aria-expanded="' + open + '">' + (open ? "Hide the " : "Show the ") + g.length + "</button>" +
      (c._applied ? '<span class="ss-cr-in"><svg class="i"><use href="#i-ok"/></svg>In the script</span>' : '<button type="button" class="ds-btn ds-btn-sm" data-gskip="' + gid + '" title="Skip every renewal">Skip all</button>');
    return '<tr class="ss-cr-row ss-cr-grp' + (ticked === g.length && !c._applied ? " is-tick" : "") + (c._applied ? " is-in" : "") + '" data-gid="' + gid + '">' +
      '<td class="ss-cr-c0"><input type="checkbox" class="ss-cb" data-gtick' + (ticked === g.length ? " checked" : "") + (ticked && ticked < g.length ? " data-mixed" : "") + (c._applied || made ? " disabled" : "") + ' aria-label="Add every renewal of ' + esc(c.varName) + ' to the script"' + (made ? ' title="Made in the browser: nothing to read it from"' : "") + " /></td>" +
      '<td><input class="ss-field ss-cr-name" data-gname value="' + esc(c.varName) + '" spellcheck="false" aria-label="Name of ' + esc(c.varName) + '"' + (c._applied ? " disabled" : "") + " /></td>" +
      "<td>" + esc(kind(c)) + '<small class="ss-cr-tag">' + (newEach ? "New each time" : "Renewed") + "</small></td>" +
      '<td><code class="ss-cr-val">' + esc(String(c.preview || c.value).slice(0, 47)) + '</code><small class="ss-muted">' + g.length + (newEach ? " values: a new one each time" : " values: the server renews it") + "</small></td>" +
      "<td>" + from(c) + (newEach ? "" : '<small class="ss-muted">and ' + plural(g.length - 1, "later response") + "</small>") + "</td>" +
      "<td>" + plural(uses, "place") + '<small class="ss-muted">each renewal where it is sent back</small></td><td>' + conf + '</td><td class="ss-cr-act">' + act + "</td></tr>";
  }

  // names of new correlations: the field's own name, or with a p in front (remembered); names typed by the user,
  // manual ones and those in the script are left as they are
  var BASE = new WeakMap();   // the engine's own name of each candidate (kept by the page, not on the candidate)
  function styled(base, st) { return st === "p" ? "p" + base.charAt(0).toUpperCase() + base.slice(1) : base; }
  function names() {
    var st = prefs.corrNames === "p" ? "p" : "field", other = st === "p" ? "field" : "p";
    all().forEach(function (c) {
      if (c._applied || c._manual) return;
      if (!BASE.has(c)) BASE.set(c, c.varName);
      var base = BASE.get(c), want = styled(base, st);
      if (c.varName !== want && c.varName === styled(base, other)) advisorSetName(c.id, want);
    });
  }

  function row(c, member) {
    var v = String(c.value == null ? "" : c.value), pv = String(c.preview || v);
    var cls = "ss-cr-row" + (member ? " is-member" : "") + (c._applied ? " is-in" : "") + (c.status === "skipped" ? " is-skip" : "") + (c.status === "accepted" && !c._applied ? " is-tick" : "");
    var t = tag(c);
    var conf = c.confidence === "high"
      ? '<span class="ss-conf hi" title="Traced: an earlier response sends this value">High</span>'
      : c._more ? '<span class="ss-conf md" title="A response sends it and a later request sends it back: check that it changes for each user">Medium</span>'
      : '<span class="ss-conf md" title="Found by its shape only (JWT, UUID, token): no earlier response was found that sends it">Medium</span>';
    var act = c._applied ? '<span class="ss-cr-in"><svg class="i"><use href="#i-ok"/></svg>In the script</span><button type="button" class="ds-btn ds-btn-sm" data-out="' + esc(c.id) + '" title="Take it out of the script (Undo brings it back)"><svg class="i"><use href="#i-x"/></svg>Take out</button>'
      : c.status === "skipped" ? '<button type="button" class="ds-btn ds-btn-sm" data-skip="' + esc(c.id) + '" title="Back to the list to review"><svg class="i"><use href="#i-reset"/></svg>Put back</button>'
      : '<button type="button" class="ds-btn ds-btn-sm" data-skip="' + esc(c.id) + '" title="Not a value to correlate: hide it from the list">Skip</button>';
    if (!c._applied && c.status !== "skipped" && advisorCanGenerate(c)) act = genBtn(c._gen, 'data-gen="' + esc(c.id) + '"', 1) + act;
    act = '<button type="button" class="ds-btn ds-btn-sm ss-btn-accent" data-edit="' + esc(c.id) + '" title="Open it: how it is read, the response, every place it is sent back"><svg class="i"><use href="#i-' + (c._applied ? "eye" : "edit") + '"/></svg>' + (c._applied ? "Open" : "Review") + "</button>" + act;
    if (c._arrayReconstruct || c._selectAll) act += '<button type="button" class="ds-btn ds-btn-sm" data-opts="' + esc(c.id) + '" title="The list options (every value or one at random, or how it is rebuilt): in the editor">Options</button>';
    return '<tr class="' + cls + '" data-id="' + esc(c.id) + '">' +
      '<td class="ss-cr-c0"><input type="checkbox" class="ss-cb" data-tick' + (c.status === "accepted" || c._applied ? " checked" : "") + (c._applied || !advisorCanAccept(c) ? " disabled" : "") + ' aria-label="Add ' + esc(c.varName) + ' to the script"' + (advisorCanAccept(c) ? "" : ' title="Made in the browser: nothing to read it from"') + " /></td>" +
      '<td><input class="ss-field ss-cr-name" data-name value="' + esc(c.varName) + '" spellcheck="false" aria-label="Name of ' + esc(c.varName) + '"' + (c._applied ? " disabled title=\"In the script: the name is fixed\"" : "") + " /></td>" +
      "<td>" + esc(kind(c)) + (t ? '<small class="ss-cr-tag">' + esc(t) + "</small>" : "") + "</td>" +
      '<td><code class="ss-cr-val" title="' + esc(v.length > 400 ? v.slice(0, 400) + "…" : v) + '">' + esc(pv.length > 48 ? pv.slice(0, 47) + "…" : pv) + '</code><small class="ss-muted">' + (/^\((?:list|array) — \d+ (?:values|items)/.test(v) ? v.slice(1).replace(/^(?:list|array) — /, "").replace(/\).*$/, "") : plural(v.length, "character")) + "</small></td>" +
      "<td>" + from(c) + "</td><td>" + uses(c) + "</td><td>" + conf + '</td><td class="ss-cr-act">' + act + "</td></tr>";
  }

  function render() {
    var cs = all();
    // High values come ticked when the step is open — once per reading, never on a list the user has seen
    if (SS.curStep && SS.curStep() === 2 && tickedFor !== cs && cs.length) {
      tickedFor = cs;
      cs.forEach(function (c) { if (c.status === "pending" && c.confidence === "high" && !c._applied && typeof advisorAccept === "function") advisorAccept(c.id); });
    }
    // the Type list: the types of this reading
    var sel = $("#ss-cr-type"), types = [];
    cs.forEach(function (c) { if (c.valueType && types.indexOf(c.valueType) === -1) types.push(c.valueType); });
    var want = '<option value="">Every type</option>' + types.map(function (t) { return '<option value="' + esc(t) + '">' + esc(KIND[t] || t) + "</option>"; }).join("");
    if (sel.innerHTML !== want) { sel.innerHTML = want; sel.value = types.indexOf(F.type) !== -1 ? F.type : ""; F.type = sel.value; }
    names();
    var rows = cs.filter(shown);
    // how many each filter holds (manual correlations are under In the script once added)
    var cnt = { review: cs.filter(function (c) { return !c._applied && c.status !== "skipped"; }).length, script: cs.filter(function (c) { return c._applied; }).length,
      skipped: cs.filter(function (c) { return c.status === "skipped" && !c._applied; }).length, all: cs.length };
    $$("#ss-cr-show [data-show]").forEach(function (x) {
      var k = x.getAttribute("data-show"), lab = x.getAttribute("data-label") || x.textContent.trim();
      x.setAttribute("data-label", lab);
      var want = esc(lab) + ' <span class="ss-cnt">' + cnt[k] + "</span>";
      if (x.innerHTML !== want) x.innerHTML = want;
    });
    var body = $("#ss-cr-body"), focus = document.activeElement, fid = focus && focus.closest && focus.closest(".ss-cr-row") && focus.closest(".ss-cr-row").getAttribute("data-id"), fname = focus && focus.hasAttribute && focus.hasAttribute("data-name");
    if (fname && body.contains(focus)) { foot(); return; }   // never redraw under the user's typing
    body.innerHTML = rowsHtml(rows);
    if (fresh) { fresh.forEach(function (id) { var r = body.querySelector('[data-id="' + id + '"]'); if (r) r.classList.add("is-new"); }); fresh = null; }
    $$("[data-mixed]", body).forEach(function (x) { x.indeterminate = true; });
    if (fid) { var r = body.querySelector('[data-id="' + fid + '"] [data-tick]'); if (r) r.focus(); }
    var empty = $("#ss-cr-empty");
    empty.hidden = !!rows.length;
    $("#ss-cr-table").hidden = !rows.length;
    if (!rows.length) {
      empty.innerHTML = !cs.length
        ? "<b>No value found by itself.</b> If a value changes on every run, use <b>Add manual correlation</b> or <b>Can't find a value?</b>."
        : F.show === "review" && !cs.some(function (c) { return !c._applied && c.status !== "skipped"; })
        ? "<b>Nothing left to review.</b> Every value is in the script or skipped — see <b>In the script</b> or <b>All</b>."
        : "No value matches these filters.";
    }
    foot();
  }
  function foot() {
    var n = ticked().length, inn = all().filter(function (c) { return c._applied; }).length;
    $("#ss-cr-n").textContent = (n ? plural(n, "value") + " ticked" : "Nothing ticked") + (inn ? " · " + inn + " in the script" : "");
    var b = $("#ss-cr-apply"); b.disabled = !n; b.lastElementChild.textContent = n ? "Add " + n + " to the script" : "Add to the script";
    var high = all().filter(function (c) { return shown(c) && c.status === "pending" && c.confidence === "high"; }).length;
    $("#ss-cr-high").disabled = !high;
    $("#ss-cr-clear").disabled = !n;
  }

  // ── the table's controls ──
  var body = $("#ss-cr-body");
  body.addEventListener("change", function (e) {
    var gr = e.target.closest("[data-gid]");
    if (gr) {
      var ids = G[gr.getAttribute("data-gid")] || [], cs = all().filter(function (c) { return ids.indexOf(c.id) !== -1; });
      if (e.target.hasAttribute("data-gtick")) {
        var on = e.target.checked;
        cs.forEach(function (c) { if ((c.status === "accepted") !== on) advisorAccept(c.id); });
      } else if (e.target.hasAttribute("data-gname")) {
        cs.forEach(function (c) { advisorSetName(c.id, e.target.value); });
        setTimeout(render, 0);
      }
      return;
    }
    var tr = e.target.closest(".ss-cr-row"); if (!tr) return;
    var id = tr.getAttribute("data-id"), c = all().filter(function (x) { return x.id === id; })[0];
    if (!c) return;
    if (e.target.hasAttribute("data-gtick") || e.target.hasAttribute("data-gname")) return;
    if (e.target.hasAttribute("data-tick")) {
      // ticking a skipped value brings it back as ticked
      if (e.target.checked !== (c.status === "accepted")) advisorAccept(id);
    } else if (e.target.hasAttribute("data-name")) {
      advisorSetName(id, e.target.value);
      e.target.value = c.varName;
    }
  });
  body.addEventListener("keydown", function (e) { if (e.key === "Enter" && e.target.hasAttribute("data-name")) e.target.blur(); });
  body.addEventListener("focusout", function (e) { if (e.target.hasAttribute && e.target.hasAttribute("data-name")) setTimeout(render, 0); });
  body.addEventListener("click", function (e) {
    var b = e.target.closest("[data-gexp]");
    if (b) { var k0 = G[b.getAttribute("data-gexp")], c0 = k0 && all().filter(function (c) { return c.id === k0[0]; })[0]; if (c0) { var gk = gkey(c0); openG[gk] = !openG[gk]; render(); } return; }
    b = e.target.closest("[data-gskip]");
    if (b) { (G[b.getAttribute("data-gskip")] || []).forEach(function (id) { var c = all().filter(function (x) { return x.id === id; })[0]; if (c && c.status !== "skipped") advisorSkip(id); }); return; }
    b = e.target.closest("[data-gen]");
    if (b) { advisorSetGenerate(b.getAttribute("data-gen"), b.getAttribute("aria-pressed") !== "true"); render(); return; }
    b = e.target.closest("[data-ggen]");
    if (b) { var on = b.getAttribute("aria-pressed") !== "true"; (G[b.getAttribute("data-ggen")] || []).forEach(function (id) { advisorSetGenerate(id, on); }); render(); return; }
    b = e.target.closest("[data-out]");
    if (b) { takeOut(b.getAttribute("data-out")); return; }
    b = e.target.closest("[data-edit]");
    if (b) { if (window.SSE) SSE.open(b.getAttribute("data-edit")); return; }
    b = e.target.closest("[data-skip]");
    if (b) { advisorSkip(b.getAttribute("data-skip")); return; }
    b = e.target.closest("[data-uses]");
    if (b) { advisorShowUses(b.getAttribute("data-uses")); return; }
    b = e.target.closest("[data-opts]");
    if (!b && !e.target.closest("button, input, a, select")) { var tr = e.target.closest(".ss-cr-row"); if (tr && window.SSE && !window.getSelection().toString()) SSE.open(tr.getAttribute("data-id") || (G[tr.getAttribute("data-gid")] || [])[0]); return; }
    if (b) { if (window.SSE) SSE.open(b.getAttribute("data-opts")); }
  });
  $("#ss-cr-q").addEventListener("input", function () { F.q = this.value.trim(); render(); });
  $("#ss-cr-type").addEventListener("change", function () { F.type = this.value; render(); });
  $("#ss-cr-conf").addEventListener("change", function () { F.conf = this.value; render(); });
  $("#ss-cr-show").addEventListener("click", function (e) {
    var b = e.target.closest("[data-show]"); if (!b) return;
    F.show = b.getAttribute("data-show");
    $$("#ss-cr-show [data-show]").forEach(function (x) { x.setAttribute("aria-pressed", String(x === b)); });
    render();
  });
  $("#ss-cr-high").addEventListener("click", function () {
    all().forEach(function (c) { if (shown(c) && c.status === "pending" && c.confidence === "high") advisorAccept(c.id); });
    render();
  });
  $("#ss-cr-clear").addEventListener("click", function () { ticked().forEach(function (c) { advisorAccept(c.id); }); render(); });
  // Add manual correlation: the editor's add screen (the request on the left, its response on the right); the classic
  // dialog (openAdvisorModal) stays for the Cards view
  $("#ss-cr-manual").addEventListener("click", function () { if (window.SSE && SSE.add) SSE.add(); else if (typeof openAdvisorModal === "function") openAdvisorModal(); });
  $("#ss-cr-apply").addEventListener("click", function () { add(); });
  function add() {
    var n = ticked().length; if (!n) return;
    advisorApplyAndRegen();
    if (typeof showToast === "function") showToast(plural(n, "value") + " added to the script.", "success", 3500);
  }

  // take a correlation out of the script again (Undo puts the same one back)
  function takeOut(id) {
    var c = all().filter(function (x) { return x.id === id; })[0]; if (!c) return;
    var gone = advisorRemoveFromScript(id);
    if (!gone) return;
    var msg = c.varName + " taken out of the script — it stays ticked: change it, or add it again.";
    if (window.SSW && SSW.undoToast) SSW.undoToast(msg, function () { advisorRestoreToScript(id, gone); });
    else if (typeof showToast === "function") showToast(msg, "info", 4000);
  }
  SS.corrTakeOut = takeOut;

  // Test: the ticked values (none ticked: the ones in the script), each as the engine would put it in the script
  // (advisorToCorrelation), checked against the recording with the editor's StudioEdit.check — read only
  function testList() {
    var list = ticked(), what = "ticked";
    if (!list.length) { list = all().filter(function (c) { return c._applied; }); what = "in the script"; }
    var E = window.StudioEdit, dlg = $("#ss-test-dlg"), b = $("#ss-test-b"), sub = $("#ss-test-sub");
    var two = !!(S.entries2 && S.entries2.length);
    if (!list.length || !E) {
      sub.textContent = "";
      b.innerHTML = '<p class="ss-empty">Tick values in the list first, or add some to the script.</p>';
    } else {
      var rows = list.map(function (c) {
        var corr = null;
        try { corr = advisorToCorrelation(c); } catch (e) { corr = null; }
        var res = corr ? E.check({ entries: S.entries1 || [], corr: corr, firstMatch: _advFirstMatch, xp: window.SSE && SSE.xp, html: window.SSE && SSE.htmlRead, entries2: two ? S.entries2 : null }) : { verdict: "none", places: [] };
        return { c: c, tx: E.checkText(res) };
      });
      var n = { good: 0, warn: 0, bad: 0 };
      rows.forEach(function (r) { n[r.tx.cls]++; });
      var LABEL = { good: "OK", warn: "Check", bad: "Fails" };
      sub.textContent = plural(rows.length, "value") + " " + what + " — " + n.good + " OK" + (n.warn ? ", " + n.warn + " to check" : "") + (n.bad ? ", " + n.bad + " failing" : "") + ".";
      b.innerHTML = '<table class="ss-test-t"><thead><tr><th>Name</th><th>Result</th><th>What it found</th><th><span class="ss-vh">Open</span></th></tr></thead><tbody>' +
        rows.map(function (r) {
          return '<tr class="t-' + r.tx.cls + '"><td><code>' + esc(r.c.varName) + "</code></td>" +
            '<td><span class="ss-tres ' + r.tx.cls + '"><svg class="i"><use href="#i-' + (r.tx.cls === "good" ? "ok" : "warn") + '"/></svg>' + LABEL[r.tx.cls] + "</span></td>" +
            "<td><b>" + esc(r.tx.title) + "</b>" + r.tx.notes.map(function (x) { return "<small>" + esc(x) + "</small>"; }).join("") + "</td>" +
            '<td><button type="button" class="ds-btn ds-btn-sm ss-btn-accent" data-test-open="' + esc(r.c.id) + '">Open</button></td></tr>';
        }).join("") + "</tbody></table>" +
        '<p class="ss-muted ss-test-note">Checked against the recording' + (two ? " and the second recording" : "") + ". A real run needs VuGen or DevWeb.</p>";
    }
    if (dlg.open) dlg.close();
    dlg.showModal();
  }
  $("#ss-cr-test").addEventListener("click", testList);
  $("#ss-test-b").addEventListener("click", function (e) {
    var b = e.target.closest("[data-test-open]"); if (!b) return;
    $("#ss-test-dlg").close();
    if (window.SSE) SSE.open(b.getAttribute("data-test-open"));
  });
  SS.corrTest = testList;

  // also suggest the values the Advisor leaves out (short ones, numbers, past the first 20)
  $("#ss-cr-more").addEventListener("click", function () {
    var n = advisorSuggestMore((S.params || []).map(function (p) { return p.value; }));
    if (typeof renderAdvisorPanel === "function") renderAdvisorPanel();
    if (n && F.show !== "review" && F.show !== "all") { F.show = "review"; $$("#ss-cr-show [data-show]").forEach(function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-show") === "review")); }); }
    render();
    if (typeof showToast === "function") showToast(n ? plural(n, "more value") + " suggested as Medium, not ticked: tick the ones that change for each user." : "No other value is sent by a response and sent back later.", n ? "success" : "info", 5000);
  });

  // names menu
  var nb = $("#ss-cr-names"), nm = $("#ss-cr-names-m");
  function nmClose() { nm.hidden = true; nb.setAttribute("aria-expanded", "false"); }
  function nmMark() { $$("[data-names]", nm).forEach(function (x) { x.setAttribute("aria-checked", String(x.getAttribute("data-names") === (prefs.corrNames === "p" ? "p" : "field"))); }); }
  nb.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!nm.hidden) { nmClose(); return; }
    var r = nb.getBoundingClientRect();
    nm.style.top = (r.bottom + 6) + "px"; nm.style.right = Math.max(8, document.documentElement.clientWidth - r.right) + "px";
    nmMark(); nm.hidden = false; nb.setAttribute("aria-expanded", "true");
    var x = nm.querySelector("[aria-checked=true]"); if (x) x.focus();
  });
  nm.addEventListener("click", function (e) {
    var b = e.target.closest("[data-names]"); if (!b) return;
    prefs.corrNames = b.getAttribute("data-names"); SS.save(); nmClose(); render();
  });
  document.addEventListener("click", function (e) { if (!nm.hidden && !nm.contains(e.target)) nmClose(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !nm.hidden) { nmClose(); nb.focus(); } });

  // Can't find a value? — the three ways that exist: Find a value, Paste & Detect, the second recording
  var cant = $("#ss-cr-cant"), menu = $("#ss-cr-cant-m");
  function closeMenu() { menu.hidden = true; cant.setAttribute("aria-expanded", "false"); }
  cant.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!menu.hidden) { closeMenu(); return; }
    var r = cant.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + "px";
    menu.style.right = Math.max(8, document.documentElement.clientWidth - r.right) + "px";
    menu.hidden = false; cant.setAttribute("aria-expanded", "true");
    var f = menu.querySelector("[role=menuitem]"); if (f) f.focus();
  });
  menu.addEventListener("click", function (e) {
    var b = e.target.closest("[data-cant]"); if (!b) return;
    closeMenu();
    var w = b.getAttribute("data-cant");
    if (w === "find" && window.SSW) SSW.openFind();
    else if (w === "paste" && typeof openPasteCorrelate === "function") openPasteCorrelate();
    else if (w === "second") {
      var d = $("#ss-diff");
      if (d) { if (d.classList.contains("folded")) d.querySelector("[data-fold]").click(); d.scrollIntoView({ block: "start", behavior: "smooth" }); }
    }
  });
  document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) closeMenu(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { closeMenu(); cant.focus(); } });

  // Table / Cards (remembered)
  function view(v) {
    v = v === "cards" ? "cards" : "table";
    prefs.corrView = v; SS.save();
    $("#ss-t-corr").classList.toggle("ss-cr-cards", v === "cards");
    $$("#ss-cr-view [data-view]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-view") === v)); });
  }
  $("#ss-cr-view").addEventListener("click", function (e) { var b = e.target.closest("[data-view]"); if (b) view(b.getAttribute("data-view")); });
  view(prefs.corrView);

  // leaving the step with ticked values: add them, or keep them ticked for later — never applied or lost silently
  SS.leaveCorr = function (go) {
    var n = ticked().length;
    if (!n) return false;
    SS.ask("Add the " + plural(n, "ticked value") + " to the script?",
      "They are ticked but not in the script yet. Not now keeps them ticked: you can add them when you come back to Correlate.",
      "Add to the script", function () { add(); go(); }, { no: "Not now", otherwise: go });
    return true;
  };

  // the values the table shows now, in its order (the editor's previous / next)
  function list() { return all().filter(shown).map(function (c) { return c.id; }); }
  // a new recording: the filters start again (To review, no search)
  function reset() {
    F = { q: "", type: "", conf: "", show: "review" };
    $("#ss-cr-q").value = ""; $("#ss-cr-conf").value = ""; $("#ss-cr-type").value = "";
    $$("#ss-cr-show [data-show]").forEach(function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-show") === "review")); });
  }
  // show one filter (after Add manual correlation: In the script), the rows just added marked for a moment
  var fresh = null;
  function showOnly(k, ids) {
    F.show = k; fresh = ids || null;
    $$("#ss-cr-show [data-show]").forEach(function (x) { x.setAttribute("aria-pressed", String(x.getAttribute("data-show") === k)); });
    render();
  }
  window.SSC = { render: render, view: view, list: list, reset: reset, show: showOnly };
})();
