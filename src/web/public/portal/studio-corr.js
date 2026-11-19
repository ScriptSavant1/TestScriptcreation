/* Script Studio — step 2, Correlate: the Correlation Advisor's findings as one table (window.SSC).
 * The engine stays the judge of everything: a tick is the candidate's "accepted" status (advisorAccept), Skip is
 * advisorSkip, the name is advisorSetName, "Add to the script" is advisorApplyAndRegen — the same calls the cards make,
 * so the script is exactly what the cards would give. The engine's cards stay on the page (Cards view): they carry the
 * list / array options until the editor has them.
 * High-confidence values come ticked when the user opens the step (once per reading); nothing reaches the script
 * before "Add to the script", and leaving the step with ticked values asks first (SS.leaveCorr). */
(function () {
  "use strict";
  var SS = window.SS;
  if (!SS || !document.getElementById("ss-corr")) return;
  var $ = SS.$, $$ = SS.$$, esc = SS.esc, plural = SS.plural, prefs = SS.prefs;

  var F = { q: "", type: "", conf: "", show: "review" };
  var tickedFor = null;   // the candidate list whose High values were ticked for the user
  var KIND = { jwt: "Sign-in token (JWT)", uuid: "Id (UUID)", hex: "Token (hex)", token: "Token", array: "List of values", json: "JSON value", xml: "XML value", html: "HTML value", text: "Text", unknown: "Value" };
  function kind(c) { return KIND[c.valueType] || (c.valueType ? String(c.valueType).charAt(0).toUpperCase() + String(c.valueType).slice(1) : "Value"); }
  function tag(c) {
    return c._explorer ? "From HAR Explorer" : c._paste ? "From Paste & Detect" : c._manual ? "Manual" : c._arrayReconstruct ? "Array rebuild" : c._selectAll ? "List" : "";
  }
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
  function row(c) {
    var v = String(c.value == null ? "" : c.value), pv = String(c.preview || v);
    var cls = "ss-cr-row" + (c._applied ? " is-in" : "") + (c.status === "skipped" ? " is-skip" : "") + (c.status === "accepted" && !c._applied ? " is-tick" : "");
    var t = tag(c);
    var conf = c.confidence === "high"
      ? '<span class="ss-conf hi" title="Traced: an earlier response sends this value">High</span>'
      : '<span class="ss-conf md" title="Found by its shape only (JWT, UUID, token): no earlier response was found that sends it">Medium</span>';
    var act = c._applied ? '<span class="ss-cr-in"><svg class="i"><use href="#i-ok"/></svg>In the script</span>'
      : c.status === "skipped" ? '<button type="button" class="ds-btn ds-btn-xs" data-skip="' + esc(c.id) + '" title="Back to the list to review">Put back</button>'
      : '<button type="button" class="ds-btn ds-btn-xs ds-btn-ghost" data-skip="' + esc(c.id) + '" title="Not a value to correlate: hide it from the list">Skip</button>';
    if (c._arrayReconstruct || c._selectAll) act += '<button type="button" class="ds-btn ds-btn-xs ds-btn-ghost" data-opts="' + esc(c.id) + '" title="The list options (rebuild, every value or one at random): in the Cards view">Options</button>';
    return '<tr class="' + cls + '" data-id="' + esc(c.id) + '">' +
      '<td class="ss-cr-c0"><input type="checkbox" class="ss-cb" data-tick' + (c.status === "accepted" || c._applied ? " checked" : "") + (c._applied ? " disabled" : "") + ' aria-label="Add ' + esc(c.varName) + ' to the script" /></td>' +
      '<td><input class="ss-field ss-cr-name" data-name value="' + esc(c.varName) + '" spellcheck="false" aria-label="Name of ' + esc(c.varName) + '"' + (c._applied ? " disabled title=\"In the script: the name is fixed\"" : "") + " /></td>" +
      "<td>" + esc(kind(c)) + (t ? '<small class="ss-cr-tag">' + esc(t) + "</small>" : "") + "</td>" +
      '<td><code class="ss-cr-val" title="' + esc(v.length > 400 ? v.slice(0, 400) + "…" : v) + '">' + esc(pv.length > 48 ? pv.slice(0, 47) + "…" : pv) + '</code><small class="ss-muted">' + plural(v.length, "character") + "</small></td>" +
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
    var rows = cs.filter(shown);
    var body = $("#ss-cr-body"), focus = document.activeElement, fid = focus && focus.closest && focus.closest(".ss-cr-row") && focus.closest(".ss-cr-row").getAttribute("data-id"), fname = focus && focus.hasAttribute && focus.hasAttribute("data-name");
    if (fname && body.contains(focus)) { foot(); return; }   // never redraw under the user's typing
    body.innerHTML = rows.map(row).join("");
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
    var tr = e.target.closest(".ss-cr-row"); if (!tr) return;
    var id = tr.getAttribute("data-id"), c = all().filter(function (x) { return x.id === id; })[0];
    if (!c) return;
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
    var b = e.target.closest("[data-skip]");
    if (b) { advisorSkip(b.getAttribute("data-skip")); return; }
    b = e.target.closest("[data-uses]");
    if (b) { advisorShowUses(b.getAttribute("data-uses")); return; }
    b = e.target.closest("[data-opts]");
    if (b) { view("cards"); var card = document.getElementById("advc-" + b.getAttribute("data-opts")); if (card) { card.scrollIntoView({ block: "center" }); card.classList.add("ss-flash"); setTimeout(function () { card.classList.remove("ss-flash"); }, 1600); } }
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
  $("#ss-cr-manual").addEventListener("click", function () { if (typeof openAdvisorModal === "function") openAdvisorModal(); });
  $("#ss-cr-apply").addEventListener("click", function () { add(); });
  function add() {
    var n = ticked().length; if (!n) return;
    advisorApplyAndRegen();
    if (typeof showToast === "function") showToast(plural(n, "value") + " added to the script.", "success", 3500);
  }

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

  window.SSC = { render: render, view: view };
})();
