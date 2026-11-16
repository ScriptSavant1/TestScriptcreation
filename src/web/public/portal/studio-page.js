/* Script Studio page — the start screen and the workspace frame. The Studio scripts (studio-ui.js, studio-app.js …)
 * are loaded unchanged and do all the work (reading the recording, correlating, generating, downloading); this file
 * decides when they run and shows the result:
 *  - a recording is read as soon as it is opened (no Analyse button); analyze() runs one at a time
 *  - the start screen ⇄ the workspace (#ph-upload / #ph-res; #ph-proc is an overlay while the file is read)
 *  - the file bar (counts, sign-in found, format switch, Open another, Download ZIP + "Ready to download?")
 *  - the notices, the right-panel tabs (Script · Correlation Advisor · Test data), the background-requests dialog
 *  - Escape / focus for the engine's dialogs, keyboard for the controls the engine draws as divs, script colouring
 *  - the format remembered (localStorage "perfx-studio-fmt"), page layout remembered ("perfx-studio-ui")
 *  - "Start recording" (portal/record-live.js), drop anywhere, window.PerfxStudio for the HAR Explorer hand-off
 * The filter bar, Domains, Requests and transactions are portal/studio-workspace.js (window.SSW). */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function plural(n, w) { return n + " " + w + (n === 1 ? "" : "s"); }

  // ── layout preferences (per browser) ──
  var KEY = "perfx-studio-ui";
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { prefs = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private window */ } }

  var SS = window.SS = { prefs: prefs, save: save, esc: esc, plural: plural, $: $, $$: $$ };

  // ── one reading at a time: the page starts one when a file is opened or a choice changes; the HAR Explorer's
  //    hand-off and the regression harness call analyze() too. A call while one runs asks for one more reading
  //    afterwards (the inputs may have changed — a second recording opened during the first reading), and every
  //    caller gets a promise that settles when the page is idle again, with the latest inputs read. ──
  var engineAnalyze = window.analyze;
  var running = false, again = false, waiters = [];
  function start() {
    running = true;
    if (SS.cancelAgain) SS.cancelAgain();   // a reading the page had queued is this one
    Promise.resolve().then(function () { return engineAnalyze(); }).then(finish, finish);
  }
  // the usage ping (sent by the engine after a reading, once per opened recording) waits for the last reading of a
  // burst — a second recording opened during the first reading is counted as the diff reading it leads to
  var owed = false;
  function finish() {
    running = false;
    if (again) { again = false; if (owed) { owed = false; S._usageSent = false; } start(); return; }
    owed = false;
    afterAnalysis();
    var w = waiters; waiters = [];
    w.forEach(function (f) { f(); });
  }
  window.analyze = function () {
    if (running) {
      again = true;
      if (!S._usageSent) { S._usageSent = true; owed = true; }   // held for the reading that follows
    } else start();
    return new Promise(function (r) { waiters.push(r); });
  };
  SS.busy = function () { return running; };

  // ── start screen ⇄ workspace: follow the engine's phases; the reading overlay keeps the view under it ──
  var upload = $("#ph-upload"), proc = $("#ph-proc"), res = $("#ph-res");
  function view(v) {
    document.body.classList.toggle("ss-view-ws", v === "ws");
    document.body.classList.toggle("ss-view-home", v !== "ws");
    if (v !== "ws") resume();
  }
  SS.view = view;
  // the engine's showPhase() moves the "active" class between the three phases — only those changes count
  var phases = new MutationObserver(function (list) {
    var to = null;
    list.forEach(function (m) { if (m.target.classList.contains("active")) to = m.target; });
    if (to === res) view("ws");
    else if (to === upload) view("home");
    document.body.classList.toggle("ss-reading", proc.classList.contains("active"));
  });
  [upload, proc, res].forEach(function (el) { phases.observe(el, { attributes: true, attributeFilter: ["class"] }); });
  view("home");

  // a file is read as soon as it is opened (recording 1 or the second recording)
  var engineMarkLoaded = window.markLoaded;
  window.markLoaded = function (slot) {
    var r = engineMarkLoaded.apply(this, arguments);
    if (slot === 1 && window.SSW) SSW.newFile();
    setTimeout(function () { if (S.har1) window.analyze(); }, 0);
    return r;
  };
  // the second recording removed: read again in pattern mode
  var engineClearSlot = window.clearSlot;
  window.clearSlot = function (slot) {
    var r = engineClearSlot.apply(this, arguments);
    if (slot === 2 && S.har1) setTimeout(function () { window.analyze(); }, 0);
    if (slot === 1) view("home");
    return r;
  };

  function afterAnalysis() {
    if (!S.har1) return;
    var bg = $("#bgReviewPanel");
    var gate = bg && bg.style.display !== "none";
    SS.bgSummary = typeof _buildPeriodicSummary === "function" ? _buildPeriodicSummary(S.entries1 || []) : [];
    if (gate) openBg(true);
    refresh();
  }

  // everything the page shows from S (called after an analysis and after each regeneration)
  function refresh() {
    if (!S.har1) return;
    fileBar();
    notices();
    badges();
    if (window.SSW) SSW.render();
  }
  // the engine draws several parts one after another — the page follows once
  var queued = false;
  function later() { if (queued) return; queued = true; setTimeout(function () { queued = false; refresh(); }, 0); }
  SS.refresh = later;
  ["regenerateFromAdvisor", "renderParams", "renderAdvisorPanel", "renderCorrelations", "advisorAccept", "advisorSkip"].forEach(function (fn) {
    var orig = window[fn];
    if (typeof orig !== "function") return;
    window[fn] = function () { var r = orig.apply(this, arguments); later(); return r; };
  });

  // ── file bar ──
  var AUTH = { kerberos: "Kerberos", ntlm: "NTLM", negotiate: "Negotiate", basic: "Basic", digest: "Digest", bearer: "Bearer", saml: "SAML" };
  function fileBar() {
    var es = S.entries1 || [];
    var reqs = es.filter(function (e) { return !e.isMarker; });
    $("#ss-file-name").textContent = S.har1Name || "";
    $("#ss-file-name").title = S.har1Name || "";
    var src = S.isNetLog1 ? "NetLog file" : (S.harPages && S.harPages.size ? "Recorded with the CDP Recorder (pages are transactions)" : "HAR file");
    if (S.har2) src += " · second recording: " + (S.har2Name || "") + " (diff mode)";
    $("#ss-file-src").textContent = src;
    $("#ss-k-in").textContent = reqs.filter(function (e) { return !e.filtered; }).length;
    $("#ss-k-all").textContent = reqs.length;
    $("#ss-k-tx").textContent = (S.txns || []).length;
    var a = $("#ss-auth");
    a.hidden = !S.auth;
    if (S.auth) { a.lastElementChild.textContent = AUTH[S.auth.type] || S.auth.type; a.title = "Sign-in found in the recording: " + (AUTH[S.auth.type] || S.auth.type) + ". The script signs in the same way (web_set_user / user credentials)."; }
    fmtButtons();
  }

  // ── script format: the start screen's buttons are the engine's (setFmt); the file bar's switch changes the
  //    script at once (the generators run again on the same analysis — nothing is read again) ──
  var FKEY = "perfx-studio-fmt", FOK = ["webhttp", "devweb"];
  var engineSetFmt = window.setFmt;
  try { var f0 = localStorage.getItem(FKEY); if (FOK.indexOf(f0) !== -1) engineSetFmt(f0); } catch (e) { /* storage blocked */ }
  window.setFmt = function (f) {
    var r = engineSetFmt.apply(this, arguments);
    try { if (FOK.indexOf(f) !== -1) localStorage.setItem(FKEY, f); } catch (e) { /* storage blocked */ }
    fmtButtons();
    return r;
  };
  function fmtButtons() {
    $$("#ss-fmt [data-fmt]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-fmt") === S.format)); });
  }
  $("#ss-fmt").addEventListener("click", function (e) {
    var b = e.target.closest("[data-fmt]");
    if (!b || b.getAttribute("data-fmt") === S.format) return;
    window.setFmt(b.getAttribute("data-fmt"));
    if (!S.entries1 || !S.entries1.length || running) return;
    S.scripts = {};
    S.tab = S.format === "devweb" ? "mj" : "ac";
    regenerateFromAdvisor({ quiet: true });
    showToast("Script format: " + (S.format === "devweb" ? "DevWeb (JavaScript)" : "Web HTTP/HTML (C)") + ".", "success", 2500);
  });
  fmtButtons();

  // ── open another / download ──
  $("#ss-open-another").addEventListener("click", function () { view("home"); var i = $("#dz1 input[type=file]"); if (i) i.focus(); });
  $("#ss-resume-go").addEventListener("click", function () { if (S.har1 && S.entries1 && S.entries1.length) view("ws"); });
  function resume() {
    var on = !!(S.har1 && S.entries1 && S.entries1.length && S.scripts && (S.scripts.ac || S.scripts.mj));
    $("#ss-resume").hidden = !on;
    if (on) $("#ss-resume-name").textContent = S.har1Name || "The recording";
  }
  $("#ss-dl").addEventListener("click", function () { closeReady(); dlZip(S.format === "both" ? "both" : S.format); });

  // "Ready to download?" — what is worth a look before downloading; each item opens its place; never blocks
  function readyItems() {
    var out = [];
    var pend = (S.advisorCandidates || []).filter(function (c) { return c.status === "pending"; }).length;
    if (pend) out.push({ warn: true, text: plural(pend, "correlation suggestion") + " not reviewed yet", go: "corr" });
    if (S.harWarning) out.push({ warn: true, text: "The recording has a warning — read it before you run the script", go: "notice" });
    var bg = (SS.bgSummary || []).length;
    if (bg) out.push({ text: plural(bg, "background endpoint") + " (repeated by the page) — left out unless you choose otherwise", go: "bg" });
    var p = (S.params || []).length;
    out.push({ text: p ? plural(p, "test data parameter") + " — fill the data file for many users" : "No test data parameters (no typed values found)", go: "data" });
    var hp = S.hostParams && S.hostParams.keys ? S.hostParams.keys.length : 0;
    if (hp) out.push({ text: plural(hp, "server parameter") + " (" + S.hostParams.keys.slice(0, 2).map(function (k) { return S.hostParams.map[k]; }).join(", ") + (hp > 2 ? " …" : "") + ") — rename in Domains", go: "dom" });
    return out;
  }
  function badges() {
    var pend = (S.advisorCandidates || []).filter(function (c) { return c.status === "pending"; }).length;
    var n = $("#ss-adv-n"); n.hidden = !pend; n.textContent = pend; n.title = plural(pend, "suggestion") + " to review";
    var d = $("#ss-data-n"), p = (S.params || []).length; d.hidden = !p; d.textContent = p;
    $("#ss-data-empty").hidden = !!p;
    var warn = readyItems().filter(function (i) { return i.warn; }).length;
    var r = $("#ss-ready-n"); r.hidden = !warn; r.textContent = warn;
  }
  SS.badges = badges;
  var menu = $("#ss-ready"), more = $("#ss-dl-more");
  function closeReady() { menu.hidden = true; more.setAttribute("aria-expanded", "false"); }
  more.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!menu.hidden) { closeReady(); return; }
    var items = readyItems();
    menu.innerHTML = '<div class="ss-menu-h"><b>Ready to download?</b><span class="ss-muted">Worth a look first — the download is never blocked.</span></div>' +
      items.map(function (i) { return '<button type="button" role="menuitem" data-go="' + i.go + '"' + (i.warn ? ' class="warn"' : "") + '><svg class="i"><use href="#i-' + (i.warn ? "warn" : "ok") + '"/></svg><span>' + esc(i.text) + "</span></button>"; }).join("") +
      '<div class="ss-menu-f"><button type="button" class="ds-btn ds-btn-sm ds-btn-primary" data-go="dl"><svg class="i"><use href="#i-down"/></svg>Download ZIP</button></div>';
    var r = more.getBoundingClientRect();
    menu.style.top = (r.bottom + 6) + "px";
    menu.style.right = Math.max(8, document.documentElement.clientWidth - r.right) + "px";
    menu.hidden = false; more.setAttribute("aria-expanded", "true");
    var first = menu.querySelector("button"); if (first) first.focus();
  });
  menu.addEventListener("click", function (e) {
    var b = e.target.closest("[data-go]"); if (!b) return;
    var go = b.getAttribute("data-go");
    closeReady();
    if (go === "dl") $("#ss-dl").click();
    else if (go === "corr" || go === "data") tab(go);
    else if (go === "bg") openBg(false);
    else if (go === "notice") { var n = $("#ss-notices .ss-notice"); if (n) { n.classList.add("open"); n.scrollIntoView({ block: "nearest" }); } }
    else if (go === "dom" && window.SSW) SSW.showPane("dom", true);
  });
  document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) closeReady(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { closeReady(); more.focus(); } });

  // ── notices: the engine's warning (cache, NetLog, SSO, diff mode …) — one line, Details opens it ──
  var hiddenWarn = null;
  function notices() {
    var box = $("#ss-notices");
    var w = S.harWarning || "";
    if (!w || w === hiddenWarn) { box.innerHTML = ""; return; }
    box.innerHTML = '<div class="ss-notice"><svg class="i"><use href="#i-warn"/></svg><span class="ss-nt">' + esc(w) + '</span>' +
      '<button class="ds-btn ds-btn-xs ds-btn-ghost" type="button" data-more aria-expanded="false">Details</button>' +
      '<button class="ds-btn ds-btn-xs ds-btn-ghost ss-icon" type="button" data-x aria-label="Hide this message"><svg class="i"><use href="#i-x"/></svg></button></div>';
  }
  $("#ss-notices").addEventListener("click", function (e) {
    var n = e.target.closest(".ss-notice"); if (!n) return;
    if (e.target.closest("[data-x]")) { hiddenWarn = S.harWarning; n.remove(); badges(); return; }
    if (e.target.closest("[data-more]")) { var o = n.classList.toggle("open"); e.target.closest("[data-more]").setAttribute("aria-expanded", String(o)); e.target.closest("[data-more]").textContent = o ? "Less" : "Details"; }
  });

  // ── right panel tabs ──
  function tab(name) {
    $$(".ss-tabs [role=tab]").forEach(function (b) { b.setAttribute("aria-selected", String(b.getAttribute("data-tab") === name)); });
    ["script", "corr", "data"].forEach(function (t) { $("#ss-t-" + t).hidden = t !== name; });
    prefs.tab = name; save();
    if (window.SSW) SSW.showPane("right", true);
  }
  SS.tab = tab;
  $(".ss-tabs").addEventListener("click", function (e) { var b = e.target.closest("[role=tab]"); if (b) tab(b.getAttribute("data-tab")); });
  $(".ss-tabs").addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    var t = $$(".ss-tabs [role=tab]"), i = t.indexOf(document.activeElement); if (i < 0) return;
    var n = t[(i + (e.key === "ArrowRight" ? 1 : t.length - 1)) % t.length]; n.focus(); n.click();
  });
  tab(["script", "corr", "data"].indexOf(prefs.tab) !== -1 ? prefs.tab : "script");

  // ── background requests: the engine stops for them after reading (as before); here they open in a dialog over
  //    the workspace. Closing it without a choice keeps the default (all left out) and makes the script. ──
  var bgDlg = $("#ss-bg-dlg");
  function openBg(gate) {
    var sum = SS.bgSummary || [];
    if (!sum.length) return;
    if (!gate) {
      renderBackgroundReview(sum);
      // show the current choices, not the defaults
      $$(".bg-decision-toggle", bgDlg).forEach(function (g) {
        var v = S.bgDecisions && S.bgDecisions.get(g.dataset.url);
        if (v) $$(".bg-dec", g).forEach(function (b) { b.classList.toggle("active", b.dataset.val === v); });
      });
    }
    bgDlg.dataset.gate = gate ? "1" : "";
    if (!bgDlg.open) { try { bgDlg.showModal(); } catch (e) { bgDlg.setAttribute("open", ""); } }
  }
  SS.openBg = openBg;
  var engineApplyBg = window.applyBgDecisions;
  window.applyBgDecisions = function () {
    bgDlg.dataset.gate = "";
    if (bgDlg.open) bgDlg.close();
    return Promise.resolve(engineApplyBg.apply(this, arguments)).then(function (r) { refresh(); return r; });
  };
  bgDlg.addEventListener("close", function () {
    if (bgDlg.dataset.gate === "1") { bgDlg.dataset.gate = ""; window.applyBgDecisions(); }   // the defaults
    else $("#bgReviewPanel").style.display = "none";
  });
  bgDlg.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) bgDlg.close(); });

  // a question before a change that throws away work (dialog #ss-ask)
  SS.ask = function (title, text, okLabel, then) {
    var d = $("#ss-ask");
    $("#ss-ask-h").textContent = title; $("#ss-ask-t").textContent = text; $("#ss-ask-yes").textContent = okLabel || "Continue";
    d.returnValue = "";
    d.onclose = function () { d.onclose = null; if (d.returnValue === "yes") then(); };
    try { d.showModal(); } catch (e) { if (window.confirm(title + "\n\n" + text)) then(); }
  };

  // ── start screen: hide the introduction, fold the cards ──
  function heroPref() { $("#ss-hero").hidden = !!prefs.noHero; }
  $("#ss-hero-hide").addEventListener("click", function () { prefs.noHero = true; save(); heroPref(); });
  heroPref();
  prefs.fold = prefs.fold || {};
  $$("[data-fold]").forEach(function (h) {
    var k = h.getAttribute("data-fold"), card = h.parentNode;
    h.setAttribute("role", "button"); h.setAttribute("tabindex", "0");
    if (prefs.fold[k] !== undefined) card.classList.toggle("folded", !!prefs.fold[k]);
    h.setAttribute("aria-expanded", String(!card.classList.contains("folded")));
    function flip(e) {
      if (e.target.closest("button, a, input, select, .drop-zone") && e.target !== h) return;
      var f = card.classList.toggle("folded");
      h.setAttribute("aria-expanded", String(!f)); prefs.fold[k] = f; save();
    }
    h.addEventListener("click", flip);
    h.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); flip(e); } });
  });

  // ── the engine's dialogs: focus moves in on open, Tab stays inside, Escape closes, focus returns on close ──
  var DIALOGS = [
    { overlay: "adv-modal-overlay", open: "openAdvisorModal", close: "closeAdvisorModal", first: "adv-src-filter" },
    { overlay: "pc-modal-overlay", open: "openPasteCorrelate", close: "closePasteCorrelate", first: "pc-response-body" },
    { overlay: "host-modal-overlay", open: "openHostRename", close: "closeHostRename", first: "host-modal-inp" },
  ];
  function isOpen(d) { var o = document.getElementById(d.overlay); return o && o.style.display !== "none"; }
  DIALOGS.forEach(function (d) {
    var open = window[d.open], close = window[d.close];
    if (typeof open !== "function" || typeof close !== "function") return;
    window[d.open] = function () {
      d.back = document.activeElement;
      var r = open.apply(this, arguments);
      setTimeout(function () { var f = document.getElementById(d.first); if (f && isOpen(d)) f.focus(); }, 30);
      return r;
    };
    window[d.close] = function () {
      var r = close.apply(this, arguments);
      if (d.back && document.contains(d.back)) d.back.focus();
      d.back = null;
      return r;
    };
  });
  document.addEventListener("keydown", function (e) {
    var d = DIALOGS.filter(isOpen)[0];
    if (!d) return;
    if (e.key === "Escape") { window[d.close](); return; }
    if (e.key !== "Tab") return;
    var box = document.querySelector("#" + d.overlay + " .adv-modal");
    var items = Array.prototype.filter.call(box.querySelectorAll("button, input, select, textarea, [tabindex]:not([tabindex='-1'])"),
      function (el) { return !el.disabled && el.offsetParent !== null; });
    if (!items.length) return;
    var first = items[0], last = items[items.length - 1];
    if (!box.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ── keyboard for controls the Studio scripts draw as plain divs (code tabs, panel headers) ──
  var KB = ".code-tab, .adv-panel-hdr, .adv-inspector-hdr, .corr-panel-hdr";
  function markKeyboard(root) {
    $$(KB, root).forEach(function (el) {
      if (!el.hasAttribute("tabindex")) { el.setAttribute("tabindex", "0"); el.setAttribute("role", "button"); }
    });
  }
  markKeyboard();
  new MutationObserver(function () { markKeyboard(); }).observe(res, { childList: true, subtree: true });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var el = e.target.closest && e.target.closest(KB);
    if (!el || e.target !== el) return;
    e.preventDefault();
    el.click();
  });

  // ── light syntax colouring of the script preview: the Studio scripts write plain text into #code-body; this only
  //    wraps tokens in spans, so textContent stays the exact script (built from text nodes: \r\n kept, Copy exact) ──
  var HL = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`)|(#\w+)|\b(return|const|let|var|async|await|new|function|if|else|for|while|try|catch|throw|typeof|null|true|false|int|char|void|LAST|ENDITEM|ITEMDATA|EXTRARES)\b|\b([A-Za-z_$][\w$]*)(?=\s*\()/g;
  function colour(text) {
    var frag = document.createDocumentFragment(), last = 0, m, n = 0;
    HL.lastIndex = 0;
    while ((m = HL.exec(text))) {
      if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
      var span = document.createElement("span");
      span.className = m[1] ? "c" : m[2] ? "s" : (m[3] || m[4]) ? "k" : "f";
      span.textContent = m[0];
      frag.appendChild(span); n++;
      last = HL.lastIndex;
    }
    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
    return n ? frag : null;
  }
  var code = $("#code-body");
  var painted = null;
  function paint() {
    if (code.firstElementChild) return;
    var t = code.textContent;
    if (!t || t.length >= 400000 || t === painted) return;
    painted = t;
    var frag = colour(t);
    if (frag) { code.textContent = ""; code.appendChild(frag); }
  }
  new MutationObserver(paint).observe(code, { childList: true, characterData: true, subtree: true });
  paint();

  var dz1 = $("#dz1"), in1 = dz1.querySelector("input[type=file]");
  in1.addEventListener("focus", function () { dz1.classList.add("kb-focus"); });
  in1.addEventListener("blur", function () { dz1.classList.remove("kb-focus"); });

  // Studio's state object S is declared with const, so other pages in the portal (the HAR Explorer's "Continue in
  // Script Studio") cannot reach it as window.S — this is the one way in.
  window.PerfxStudio = { state: function () { return S; } };
})();

// Drop .har / NetLog .json files anywhere on the page: the start screen opens it as the recording; in the workspace a
// dropped file is opened as a new recording too (the second recording has its own box in the Correlation Advisor tab).
(function () {
  "use strict";
  if (!window.PerfxDrop) return;
  var input = document.querySelector("#dz1 input[type=file]");
  window.PerfxDrop.attach({
    when: function () { return true; },
    label: function () { return ["Drop to open", "A .har recording"]; },
    route: function (files, ext) {
      var rec = files.filter(function (f) { return ext(f) === ".har" || ext(f) === ".json"; })[0];
      return rec ? [{ input: input, files: [rec] }] : [];
    },
  });
})();

// "Start recording" (portal/record-live.js draws the window and the live view): the live view takes the place of the
// start screen's cards while recording; the saved recording opens as the recording, or as the second recording when
// "Record it now" was used in the Correlation Advisor tab (diff mode) — through loadFile(), as a dropped file.
(function () {
  var btn = document.getElementById("ss-rec-btn");
  if (!btn || !window.PerfxRecordLive) return;
  var up = document.getElementById("ph-upload"), home = up && up.querySelector(".ss-home");
  var cards = [document.querySelector(".ss-choices"), document.getElementById("ss-how"), document.getElementById("ss-resume"), document.getElementById("ss-hero")];
  var target = 1, was = [];
  window.PerfxRecordLive.mount({
    host: home,
    chips: document.getElementById("ss-rec-chips"),
    subtitle: "Choose what to open and how. The recording opens in Script Studio when you stop.",
    isIdle: function () { return document.body.classList.contains("ss-view-home") && !cards[0].hidden; },
    before: function () { was = cards.map(function (c) { return c && c.hidden; }); cards.forEach(function (c) { if (c) c.hidden = true; }); },
    after: function () { cards.forEach(function (c, i) { if (c) c.hidden = was[i]; }); },
    onSaved: function (file) {
      if (typeof loadFile !== "function") return;
      loadFile(file, target);
      if (typeof showToast === "function") setTimeout(function () { showToast(target === 2 ? "Opened as the second recording (diff mode)." : file.name + " opened.", "success", 5000); }, 600);
      target = 1;
    },
  });
  btn.addEventListener("click", function () { target = 1; window.PerfxRecordLive.open(); });
  window.SS.recordSecond = function () { target = 2; window.SS.view("home"); window.PerfxRecordLive.open(); };
})();
