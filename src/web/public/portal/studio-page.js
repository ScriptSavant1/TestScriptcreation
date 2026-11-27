/* Script Studio page — the start screen and the workspace frame. The Studio scripts (studio-ui.js, studio-app.js …)
 * are loaded unchanged and do all the work (reading the recording, correlating, generating, downloading); this file
 * decides when they run and shows the result:
 *  - a recording is read as soon as it is opened (no Analyse button); analyze() runs one at a time
 *  - the start screen ⇄ the workspace (#ph-upload / #ph-res; #ph-proc is an overlay while the file is read)
 *  - the title row (script name, counts, sign-in found, Open another, notes, Download ZIP + "Ready to download?") and
 *    the tool row (the four steps Requests · Correlate · Test data · Download, format, think time, filters; pop-ups)
 *  - the right panel's Script and Request tabs, the background-requests dialog
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
  // "Up to date" / "Updating…" beside the title
  function state() { var s = $("#ss-state"); if (!s) return; s.classList.toggle("up", running); s.lastElementChild.textContent = running ? "Updating…" : "Up to date"; }
  function start() {
    running = true; state();
    if (SS.cancelAgain) SS.cancelAgain();   // a reading the page had queued is this one
    Promise.resolve().then(function () { return engineAnalyze(); }).then(finish, finish);
  }
  // the usage ping (sent by the engine after a reading, once per opened recording) waits for the last reading of a
  // burst — a second recording opened during the first reading is counted as the diff reading it leads to
  var owed = false;
  function finish() {
    running = false; state();
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
  SS.busy = function () { return running || applying > 0; };
  var applying = 0;   // a background-requests answer being applied

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

  // the opened recording itself and the number of its opening (Open in HAR Explorer hands the file over; the Explorer's
  // Continue in Script Studio adds its values to this work when the number is still the same)
  var fileNo = 0; SS.file1 = null; SS.fileId = 0;
  var engineLoadFile = window.loadFile;
  window.loadFile = function (file, slot) {
    if (slot === 1) { SS.file1 = file; SS.fileId = ++fileNo; }
    return engineLoadFile.apply(this, arguments);
  };
  // a file is read as soon as it is opened (recording 1 or the second recording)
  var engineMarkLoaded = window.markLoaded;
  window.markLoaded = function (slot) {
    var r = engineMarkLoaded.apply(this, arguments);
    if (slot === 1 && window.SSW) SSW.newFile();
    if (slot === 1) hxButton();
    if (slot === 1) { step(1, true); S.scriptName = ""; nameShow(); if (window.SSE) SSE.close(); if (window.SSC) SSC.reset(); if (window.SSH) SSH.reset(); }   // a new recording starts at step 1, with the default name
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
    if (gate && SS.bgChoice && SS.bgFor === S.har1) {
      // answered already for this file: a new reading (a type, a domain, a transaction ...) keeps that answer
      renderBackgroundReview(SS.bgSummary);
      $$(".bg-decision-toggle", bgDlg).forEach(function (g) {
        var v = SS.bgChoice.get(g.dataset.url);
        if (v) $$(".bg-dec", g).forEach(function (b) { b.classList.toggle("active", b.dataset.val === v); });
      });
      window.applyBgDecisions();
      return;
    }
    if (gate) openBg(true);
    refresh();
  }

  // everything the page shows from S (called after an analysis and after each regeneration)
  function refresh() {
    if (!S.har1) return;
    fileBar();
    SS.settings();
    notices();
    badges();
    if (window.SSW) SSW.render();
    if (window.SSC) SSC.render();
    if (window.SSE && SSE.isOpen()) SSE.redraw();
    if (window.SSH) SSH.look();
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

  // in the script: not left out by a rule, a type, a domain or the user, and not a background endpoint that is left out
  // (the generators' own answer: shouldIncludeEntry for the journey, getSetupEntries for what runs once at the start)
  SS.setup = function (e) { return !e.filtered && typeof getSetupEntries === "function" && getSetupEntries([e], S.bgDecisions).length > 0; };
  SS.inScript = function (e) { return !e.filtered && (typeof shouldIncludeEntry !== "function" || shouldIncludeEntry(e, S.bgDecisions) || SS.setup(e)); };

  // ── file bar ──
  var AUTH = { kerberos: "Kerberos", ntlm: "NTLM", negotiate: "Negotiate", basic: "Basic", digest: "Digest", bearer: "Bearer", saml: "SAML" };
  // where the transactions come from — the HAR Explorer's rule (har-explorer-model.js): START / END bookmarks first,
  // then the pages of a PerfX CDP Recorder file, then the page loads of any other HAR
  function sourceLabel(es, har, pages) {
    if (es.some(function (e) { return e.isMarker && /\.invalid([/:?]|$)/i.test(e.url || ""); })) return "HAR file · bookmark transactions (START / END)";
    if (!pages || !pages.size) return "HAR file";
    var creator = (har && har.log && har.log.creator && har.log.creator.name) || "";
    return /perfx/i.test(creator) ? "Recorded with the CDP Recorder (pages are transactions)" : "HAR file · the page loads are transactions";
  }
  function fileBar() {
    var es = S.entries1 || [];
    var reqs = es.filter(function (e) { return !e.isMarker; });
    $("#ss-file-name").textContent = S.har1Name || "";
    $("#ss-file-name").title = S.har1Name || "";
    var src = S.isNetLog1 ? "NetLog file" : sourceLabel(es, S.har1, S.harPages);
    if (S.har2) src += " · second recording: " + (S.har2Name || "") + " (diff mode)";
    $("#ss-file-src").textContent = " · " + src; $("#ss-from").title = (S.har1Name || "") + " · " + src;
    $("#ss-k-in").textContent = reqs.filter(SS.inScript).length;
    $("#ss-k-all").textContent = reqs.length;
    var tx = (S.txns || []).length; $("#ss-k-tx").textContent = tx; $("#ss-k-txw").textContent = tx === 1 ? "transaction" : "transactions";
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

  // ── the script's settings (step 1): its name and the think time between transactions ──
  // the name: letters, digits and underscores, starting with a letter (VuGen's rule); the ZIP and the .usr take it
  // (dlZip reads S.scriptName); empty = the recording's own name (studio-app.js studioScriptName). It belongs to the
  // recording: a new file starts empty.
  var nameIn = $("#ss-sc-name"), nameErr = $("#ss-sc-err");
  function defaultName() { return studioScriptName(S.format); }
  SS.scriptName = function () { return S.scriptName || defaultName(); };
  var nameBtn = $("#ss-name-btn"), nameForm = $("#ss-name-f");
  function nameShow() { nameIn.placeholder = defaultName(); $("#ss-name-now").textContent = SS.scriptName(); if (document.activeElement !== nameIn) nameIn.value = S.scriptName || ""; nameErr.hidden = true; nameIn.removeAttribute("aria-invalid"); }
  function nameOpen(on) { nameForm.hidden = !on; nameBtn.hidden = on; $("#ss-from").hidden = on; if (on) { nameIn.value = SS.scriptName(); nameIn.focus(); nameIn.select(); } else { nameIn.blur(); nameShow(); } }
  function nameSet() {
    var v = nameIn.value.trim().replace(/[\s-]+/g, "_");
    if (v === defaultName()) v = "";   // the default name follows the recording
    if (v && !/^[A-Za-z][A-Za-z0-9_]{0,59}$/.test(v)) {
      nameErr.textContent = "Letters, numbers and underscores only, starting with a letter.";
      nameErr.hidden = false; nameIn.setAttribute("aria-invalid", "true"); nameIn.focus();
      return;
    }
    S.scriptName = v || ""; nameOpen(false); badges(); nameBtn.focus(); if (window.SSH) SSH.look();
  }
  nameBtn.addEventListener("click", function () { nameOpen(true); });
  nameForm.addEventListener("submit", function (e) { e.preventDefault(); nameSet(); });
  $("#ss-name-x").addEventListener("click", function () { nameOpen(false); nameBtn.focus(); });
  nameIn.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); nameOpen(false); nameBtn.focus(); } });
  nameIn.addEventListener("input", function () { if (!nameErr.hidden) { nameErr.hidden = true; nameIn.removeAttribute("aria-invalid"); } });
  // think time: Fixed N s (default 3 — what Studio has always written) / As recorded / None; remembered per browser
  var thinkSec = $("#ss-think-sec");
  function thinkNow() { var t = prefs.think || {}; return { mode: ["fixed", "recorded", "none"].indexOf(t.mode) !== -1 ? t.mode : "fixed", sec: t.sec >= 1 && t.sec <= 3600 ? Math.round(t.sec) : 3 }; }
  function thinkShow() {
    var t = thinkNow();
    S.thinkTime = { mode: t.mode, sec: t.sec };
    $$("#ss-think [data-think]").forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-think") === t.mode)); });
    $("#ss-think-secw").hidden = t.mode !== "fixed";
    if (document.activeElement !== thinkSec) thinkSec.value = t.sec;
    var note = "";
    if (t.mode === "fixed") note = t.sec + " s after each transaction but the last. Run-time settings decide how it is replayed.";
    else if (t.mode === "none") note = "No think time in the script.";
    else {
      var gaps = (S.entries1 || []).map(function (e, i) { return e.isMarker && e.markerType === "end" && typeof _thinkAfter === "function" ? _thinkAfter(S.entries1, i) : undefined; }).filter(function (v) { return v !== undefined; });
      gaps.pop();   // never after the last transaction
      var n = gaps.filter(function (g) { return g != null; });
      note = !gaps.length ? "The pauses of the recording between transactions — none here (one transaction or none)." :
        !n.length ? "No pause of a second or more between the transactions of this recording: no think time is written." :
        "The pauses of the recording: " + n.slice(0, 8).map(function (g) { return g + " s"; }).join(", ") + (n.length > 8 ? " …" : "") +
        (n.length < gaps.length ? (n.length ? "; " : "") + plural(gaps.length - n.length, "pause") + " under a second, left out" : "") + ".";
    }
    $("#ss-think-note").textContent = note;
    $("#ss-think-now").textContent = t.mode === "fixed" ? t.sec + " s" : t.mode === "none" ? "No think time" : "As recorded";
  }
  function thinkSet(t) {
    prefs.think = t; save(); thinkShow();
    if (S.entries1 && S.entries1.length && !running) regenerateFromAdvisor({ quiet: true });
  }
  SS.thinkNow = thinkNow;
  SS.thinkSet = function (t) { prefs.think = t; save(); thinkShow(); };
  $("#ss-think").addEventListener("click", function (e) {
    var b = e.target.closest("[data-think]"); if (!b) return;
    var t = thinkNow(); if (t.mode === b.getAttribute("data-think")) return;
    t.mode = b.getAttribute("data-think"); thinkSet(t);
    if (t.mode === "fixed") thinkSec.focus();
  });
  thinkSec.addEventListener("change", function () {
    var v = Math.round(+thinkSec.value);
    if (!(v >= 1 && v <= 3600)) { thinkSec.value = thinkNow().sec; return; }
    var t = thinkNow(); t.sec = v; thinkSet(t);
  });
  thinkShow();
  SS.settings = function () { nameShow(); thinkShow(); };

  // ── open another / download ──
  $("#ss-open-another").addEventListener("click", function () { view("home"); var i = $("#dz1 input[type=file]"); if (i) i.focus(); });
  $("#ss-resume-go").addEventListener("click", function () { if (S.har1 && S.entries1 && S.entries1.length) view("ws"); });
  function resume() {
    var on = !!(S.har1 && S.entries1 && S.entries1.length && S.scripts && (S.scripts.ac || S.scripts.mj));
    $("#ss-resume").hidden = !on;
    if (on) $("#ss-resume-name").textContent = S.har1Name || "The recording";
    // the open recording is named in the bar above, so the box is ready for the next file (it replaces this one once read)
    $("#dz1").classList.toggle("ss-fresh", on);
  }
  $("#ss-dl").addEventListener("click", function () { closeReady(); dlZip(S.format === "both" ? "both" : S.format); });

  // "Ready to download?" — what is worth a look before downloading; each item opens its place; never blocks
  function readyItems() {
    var out = [];
    var pend = (S.advisorCandidates || []).filter(function (c) { return c.status === "pending"; }).length;
    if (pend) out.push({ warn: true, text: plural(pend, "correlation suggestion") + " not reviewed yet", go: "corr" });
    var tk = SS.corrTicked ? SS.corrTicked() : 0;
    if (tk) out.push({ warn: true, text: plural(tk, "value") + " ticked in Correlate but not added to the script yet", go: "corr" });
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
    $("#ss-data-empty").hidden = !!(S.params || []).length;
    var warn = readyItems().filter(function (i) { return i.warn; }).length;
    var r = $("#ss-ready-n"); r.hidden = !warn; r.textContent = warn;
    stepNotes();
    if (cur === 4) done();
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
    closeReady();
    go(b.getAttribute("data-go"));
  });
  // where a Ready item leads (the menu and step 4)
  function go(to) {
    if (to === "dl") $("#ss-dl").click();
    else if (to === "corr" || to === "data") tab(to);
    else if (to === "bg") openBg(false);
    else if (to === "notice") { hiddenWarn = null; notices(); popOpen("ss-note-pop"); }
    else if (to === "dom") { tab("script"); if (window.SSW) SSW.showPane("dom", true); }
  }
  document.addEventListener("click", function (e) { if (!menu.hidden && !menu.contains(e.target)) closeReady(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !menu.hidden) { closeReady(); more.focus(); } });

  // ── notices: the engine's warning (cache, NetLog, SSO, diff mode …) — one line, Details opens it ──
  var hiddenWarn = null;
  function notices() {
    var box = $("#ss-notices");
    var w = S.harWarning || "";
    $("#ss-note").hidden = !w || w === hiddenWarn;
    if (!w || w === hiddenWarn) { box.innerHTML = ""; if (!$("#ss-note-pop").hidden) popClose(); return; }
    box.innerHTML = '<div class="ss-notice"><svg class="i"><use href="#i-warn"/></svg><span class="ss-nt">' + esc(w) + '</span>' +
      '</div><div class="ss-row ss-note-f"><button class="ds-btn ds-btn-sm" type="button" data-x>Got it, hide the note</button></div>';
  }
  $("#ss-notices").addEventListener("click", function (e) {
    if (e.target.closest("[data-x]")) { hiddenWarn = S.harWarning; notices(); badges(); }
  });

  // ── the right panel's parts (Script · Correlate · Test data): each one is shown by its step ──
  function showTab(name) {
    ["script", "corr", "data"].forEach(function (t) { $("#ss-t-" + t).hidden = t !== name; });
  }
  // every caller that opened a tab (the engine's links, the Ready list, request details) now opens its step
  var TAB_STEP = { script: 1, corr: 2, data: 3 }, STEP_TAB = { 1: "script", 2: "corr", 3: "data" };
  function tab(name) { step(TAB_STEP[name] || 1); }
  SS.tab = tab;

  // ── the four steps: 1 Requests · 2 Correlate · 3 Test data · 4 Download. One workspace, four views of it: step 1
  //    is the workspace as it was; steps 2 and 3 give the whole width to the Correlation Advisor / the Test data
  //    table; step 4 lists what is worth a look and downloads. Nothing is applied or lost by moving between steps. ──
  var NEXT = { 1: "Next: Correlate", 2: "Next: Test data", 3: "Next: Download" };
  var cur = 0;
  function step(n, sure) {
    n = n >= 1 && n <= 4 ? n : 1;
    if (cur === 2 && n !== 2 && !sure && SS.leaveCorr && SS.leaveCorr(function () { step(n, true); })) return;
    var was = cur; cur = n;
    for (var i = 1; i <= 4; i++) document.body.classList.toggle("ss-step-" + i, i === n);
    document.body.classList.toggle("ss-step-wide", n === 2 || n === 3);
    $$("#ss-steps [data-step]").forEach(function (b) { b.setAttribute("aria-current", +b.getAttribute("data-step") === n ? "step" : "false"); });
    marks();
    if (STEP_TAB[n]) showTab(STEP_TAB[n]);
    $("#ss-done").hidden = n !== 4;
    $("#ss-step-back").hidden = n === 1;
    var nx = $("#ss-step-next"); nx.hidden = n === 4; if (NEXT[n]) nx.firstElementChild.textContent = NEXT[n];
    popClose();
    if (window.SSW && SSW.panes) SSW.panes();
    if (n === 4) done();
    if (n === 2 && window.SSC) SSC.render();   // High values come ticked when the step opens
    if (was && was !== n) {
      // Correlate and Test data start at the top, whatever was scrolled before (another recording, an earlier look)
      [$("#ph-res")].concat(n === 2 || n === 3 ? [$("#ss-t-" + STEP_TAB[n])].concat($$("#ss-cr-wrap, #adv-panel, #corr-list, #ss-diff-b, .ss-td-wrap")) : []).forEach(function (x) { if (x.scrollTop) x.scrollTop = 0; });
    }
  }
  SS.step = step;
  SS.curStep = function () { return cur; };
  $("#ss-steps").addEventListener("click", function (e) { var b = e.target.closest("[data-step]"); if (b) step(+b.getAttribute("data-step")); });
  $("#ss-step-next").addEventListener("click", function () { step(cur + 1); });
  $("#ss-step-back").addEventListener("click", function () { step(cur - 1); });
  $("#ss-steps").addEventListener("keydown", function (e) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    var t = $$("#ss-steps [data-step]"), i = t.indexOf(document.activeElement); if (i < 0) return;
    var n = t[(i + (e.key === "ArrowRight" ? 1 : t.length - 1)) % t.length]; n.focus(); n.click();
  });
  // the steps: the ones before the current one show a tick (or ! when something there is worth a look); each has its
  // count, and its state in words for the screen reader and the tooltip (stepNotes sets ST)
  var ST = {};
  function marks() {
    $$("#ss-steps [data-step]").forEach(function (b) {
      var n = +b.getAttribute("data-step"), i = b.querySelector("i"), st = ST[n] || "";
      var icon = n < cur ? (st === "warn" ? "warn" : "ok") : "";
      if (i.getAttribute("data-ic") !== icon) { i.setAttribute("data-ic", icon); i.innerHTML = icon ? '<svg class="i"><use href="#i-' + icon + '"/></svg>' : String(n); }
      b.classList.toggle("is-past", n < cur);
      b.parentNode.classList.toggle("is-reached", n <= cur);
      b.querySelector("em").className = st ? "st-" + st : "";
      b.title = b.querySelector("small").textContent;
    });
  }
  function stepNotes() {
    var es = S.entries1 || [], reqs = es.filter(function (e) { return !e.isMarker; });
    var inn = reqs.filter(SS.inScript).length;
    $("#ss-st-1").textContent = reqs.length ? inn + " of " + reqs.length + " requests in the script" : "Domains, requests, the script";
    var cs = S.advisorCandidates || [];
    var pend = cs.filter(function (c) { return c.status === "pending"; }).length;
    var inScript = (S.correlations || []).length;
    var tk = SS.corrTicked ? SS.corrTicked() : 0;
    $("#ss-st-2").textContent = tk ? tk + " ticked, not added yet" : pend ? plural(pend, "value") + " to review" : inScript ? plural(inScript, "correlation") + " in the script" : "Nothing to review";
    $("#ss-steps [data-step='2']").classList.toggle("ss-todo", !!(pend || tk));
    var p = (S.params || []).length;
    $("#ss-st-3").textContent = p ? plural(p, "parameter") : "No typed values found";
    var warn = readyItems().filter(function (i) { return i.warn; }).length;
    $("#ss-st-4").textContent = warn ? plural(warn, "thing") + " worth a look" : "Ready";
    [inn, tk || pend, p, warn].forEach(function (v, i) { var em = $("#ss-steps [data-step='" + (i + 1) + "'] em"); em.hidden = !v; em.textContent = v || ""; });
    ST = { 1: reqs.length ? "ok" : "", 2: tk || pend ? "warn" : inScript ? "ok" : "", 3: p ? "info" : "", 4: warn ? "warn" : "ok" };
    marks();
  }
  // step 4: the Ready list in full, the script files, the download
  function done() {
    var items = readyItems();
    $("#ss-done-list").innerHTML = items.map(function (i) {
      return '<button type="button" class="ss-done-i' + (i.warn ? " warn" : "") + '" data-go="' + i.go + '"><svg class="i"><use href="#i-' + (i.warn ? "warn" : "ok") + '"/></svg><span>' + esc(i.text) + '</span><svg class="i ss-done-go"><use href="#i-left"/></svg></button>';
    }).join("");
    var files = $$("#code-tabs .code-tab").map(function (t) { return t.textContent.trim(); }).filter(Boolean);
    $("#ss-done-fh").textContent = "Files in " + SS.scriptName() + ".zip";
    $("#ss-done-files").textContent = (files.length ? files.join(", ") + ", " : "") + "and the project files VuGen and LoadRunner Enterprise need (.usr, run-time settings" + ((S.params || []).length ? ", the test data files" : "") + ").";
    doneFiles();
  }
  // step 4, right column: the script files with their code — the Script tab's own files (#code-tabs: each calls
  // switchTab(this, key)) read from the engine's S.scripts[key]; nothing is written to the engine
  var doneKey = "";
  function doneTabs() {
    return $$("#code-tabs .code-tab").map(function (t) {
      var m = /switchTab\(\s*this\s*,\s*'([^']+)'\s*\)/.exec(t.getAttribute("onclick") || "");
      return m ? { key: m[1], name: t.textContent.trim() } : null;
    }).filter(function (x) { return x && x.name; });
  }
  function doneFiles() {
    var tabs = doneTabs();
    if (!tabs.some(function (x) { return x.key === doneKey; })) doneKey = tabs.length ? tabs[0].key : "";
    $("#ss-done-ftabs").innerHTML = tabs.map(function (x) {
      var on = x.key === doneKey;
      return '<button type="button" role="tab" id="ss-done-ft-' + esc(x.key) + '" aria-selected="' + on + '" tabindex="' + (on ? 0 : -1) + '" data-file="' + esc(x.key) + '">' + esc(x.name) + "</button>";
    }).join("");
    var pre = $("#ss-done-pre"), text = doneKey && S.scripts ? S.scripts[doneKey] || "" : "";
    pre.setAttribute("aria-labelledby", "ss-done-ft-" + doneKey);
    pre.textContent = "";
    var frag = text && text.length < 400000 ? colour(text) : null;
    if (frag) pre.appendChild(frag); else pre.textContent = text || "Nothing generated yet.";
    pre.scrollTop = 0;
    $("#ss-done-copy").disabled = !text;
  }
  $("#ss-done-ftabs").addEventListener("click", function (e) {
    var b = e.target.closest("[data-file]"); if (!b) return;
    doneKey = b.getAttribute("data-file"); doneFiles();
    var nb = $("#ss-done-ft-" + doneKey); if (nb) nb.focus();
  });
  $("#ss-done-ftabs").addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    var tabs = doneTabs(), i = tabs.findIndex(function (x) { return x.key === doneKey; });
    if (i < 0 || !tabs.length) return;
    e.preventDefault();
    doneKey = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length].key; doneFiles();
    var nb = $("#ss-done-ft-" + doneKey); if (nb) nb.focus();
  });
  $("#ss-done-copy").addEventListener("click", function () {
    var text = doneKey && S.scripts ? S.scripts[doneKey] : "", b = this;
    if (!text || !navigator.clipboard) return;
    navigator.clipboard.writeText(text).then(function () { var l = b.lastChild; l.textContent = "Copied"; setTimeout(function () { l.textContent = "Copy"; }, 1500); });
  });
  $("#ss-done-dl").addEventListener("click", function () { $("#ss-dl").click(); });

  // every dialog of the page (.ss-dlg) moves by its title bar — kept on screen; it opens centred again next time
  document.addEventListener("pointerdown", function (e) {
    var h = e.target.closest && e.target.closest("dialog.ss-dlg[open] .ss-dlg-h");
    if (!h || e.button !== 0 || e.target.closest("button, input, select, textarea, a")) return;
    var d = h.closest("dialog"), r = d.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    e.preventDefault(); h.setPointerCapture(e.pointerId); d.classList.add("ss-moving");
    function move(ev) {
      var x = Math.max(120 - r.width, Math.min(innerWidth - 120, ev.clientX - dx)), y = Math.max(0, Math.min(innerHeight - 48, ev.clientY - dy));
      d.style.margin = "0"; d.style.inset = "auto"; d.style.left = Math.round(x) + "px"; d.style.top = Math.round(y) + "px";
    }
    function up() { h.removeEventListener("pointermove", move); h.removeEventListener("pointerup", up); d.classList.remove("ss-moving"); }
    h.addEventListener("pointermove", move); h.addEventListener("pointerup", up);
    if (!d._ssMove) { d._ssMove = true; d.addEventListener("close", function () { ["margin", "inset", "left", "top"].forEach(function (k) { d.style[k] = ""; }); }); }
  });
  $$("dialog.ss-dlg .ss-dlg-h").forEach(function (h) { if (!h.title) h.title = "Drag to move"; });
  // a click outside a dialog closes it, as Esc does (the same cancel step, so a dialog that asks first still asks) —
  // only when the press and the release are both outside (a text selection dragged out of it does not close it)
  var downOut = null;
  function outside(d, e) { var r = d.getBoundingClientRect(); return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom; }
  document.addEventListener("pointerdown", function (e) { var d = e.target; downOut = d && d.matches && d.matches("dialog.ss-dlg[open]") && outside(d, e) ? d : null; }, true);
  document.addEventListener("click", function (e) {
    var d = downOut; downOut = null;
    if (!d || e.target !== d || !d.open || !outside(d, e)) return;
    var ev = new Event("cancel", { cancelable: true });
    if (d.dispatchEvent(ev)) d.close();
  });

  // Plan the load in Workload Modeller (file bar and step 4): the same ZIP as Download ZIP — dlZip with a collector,
  // nothing downloaded — handed to the Workload Modeller in the portal (portal/plan-load.js). Only inside the portal.
  var canPlan = !!(window.PerfxPlanLoad && PerfxPlanLoad.available());
  $("#ss-wm").hidden = $("#ss-done-wm").hidden = !canPlan;
  function planLoad(btn) {
    if (!canPlan || btn.disabled) return;
    var files = [];
    btn.disabled = true; btn.setAttribute("aria-busy", "true");
    Promise.resolve(typeof dlZip === "function" ? dlZip(S.format, { collect: files }) : null).then(function () {
      if (!files.length) return false;
      return PerfxPlanLoad.send(files.map(function (f) { return new File([f.blob], f.name, { type: "application/zip" }); }));
    }).then(function (ok) {
      if (ok === false && typeof showToast === "function" && files.length) showToast("The Workload Modeller did not open: open it from the sidebar and add the ZIP there.", "warning", 6000);
    }).catch(function (e) {
      if (typeof showToast === "function") showToast("Could not make the ZIP: " + e.message, "error", 6000);
    }).then(function () { btn.disabled = false; btn.removeAttribute("aria-busy"); });
  }
  $("#ss-wm").addEventListener("click", function () { planLoad(this); });
  // Open in HAR Explorer (file bar): the same recording in the Explorer, in the portal; a NetLog file is not a HAR
  function hxButton() { $("#ss-hx").hidden = !(canPlan && SS.file1 && S.har1 && !S.isNetLog1); }
  function openInExplorer() {
    var top = null;
    try { top = window.parent !== window && window.parent.PerfxShell ? window.parent : null; } catch (e) { top = null; }
    if (!top || !SS.file1) return;
    var file = SS.file1, id = SS.fileId, t = 0;
    top.PerfxShell.go("explore");
    (function poll() {
      var w = null;
      try { var fr = top.document.getElementById("iframe-explorer"); w = fr && fr.contentWindow; } catch (e) { w = null; }
      if (w && w.document.readyState === "complete" && w.HarExplorer) { w.HarExplorer.open(file, { studio: id }); return; }
      if (++t < 200) setTimeout(poll, 100);
      else if (typeof showToast === "function") showToast("The HAR Explorer did not open: open it from the sidebar and choose " + file.name + " there.", "warning", 6000);
    })();
  }
  $("#ss-hx").addEventListener("click", openInExplorer);
  hxButton();
  $("#ss-done-wm").addEventListener("click", function () { planLoad(this); });
  $("#ss-done-list").addEventListener("click", function (e) { var b = e.target.closest("[data-go]"); if (b) go(b.getAttribute("data-go")); });
  step(1);

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
    applying++;
    return Promise.resolve(engineApplyBg.apply(this, arguments)).then(function (r) { applying--; return r; }, function (e) { applying--; throw e; }).then(function (r) {
      // the answer for this file, kept for the next readings (afterAnalysis)
      if (S.bgDecisions && S.har1) { SS.bgChoice = new Map(S.bgDecisions); SS.bgFor = S.har1; }
      refresh(); return r;
    });
  };
  bgDlg.addEventListener("close", function () {
    if (bgDlg.dataset.gate === "1") { bgDlg.dataset.gate = ""; window.applyBgDecisions(); }   // the defaults
    else $("#bgReviewPanel").style.display = "none";
  });
  bgDlg.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) bgDlg.close(); });

  // a question before a change that throws away work (dialog #ss-ask)
  // opt (optional): { no: label of the other button, otherwise: what it does — without it, the other button cancels }
  SS.ask = function (title, text, okLabel, then, opt) {
    var d = $("#ss-ask");
    opt = opt || {};
    $("#ss-ask-h").textContent = title; $("#ss-ask-t").textContent = text; $("#ss-ask-yes").textContent = okLabel || "Continue";
    $("#ss-ask-no").textContent = opt.no || "Cancel";
    d.returnValue = "";
    d.onclose = function () { d.onclose = null; if (d.returnValue === "yes") then(); else if (d.returnValue === "no" && opt.otherwise) opt.otherwise(); };
    try { d.showModal(); } catch (e) { if (window.confirm(title + "\n\n" + text)) then(); }
  };

  // ── pop-ups of the two top rows (think time, filters, notes): one open at a time; a click outside or Escape closes ──
  function popBtn(id) { return $('[data-pop="' + id + '"]'); }
  function popOpen(id) {
    popClose();
    var p = document.getElementById(id), b = popBtn(id); if (!p || !b) return;
    p.hidden = false; b.setAttribute("aria-expanded", "true"); p.style.transform = "";
    var r = p.getBoundingClientRect(), w = document.documentElement.clientWidth;
    if (r.left < 8) p.style.transform = "translateX(" + Math.round(8 - r.left) + "px)";
    else if (r.right > w - 8) p.style.transform = "translateX(" + Math.round(w - 8 - r.right) + "px)";
    p.style.maxHeight = Math.max(160, window.innerHeight - r.top - 12) + "px";
    var f = p.querySelector("button:not([disabled]), input"); if (f) f.focus({ preventScroll: true });
  }
  function popClose(back) {
    $$(".ss-pp").forEach(function (p) { if (p.hidden) return; p.hidden = true; var b = popBtn(p.id); if (b) { b.setAttribute("aria-expanded", "false"); if (back) b.focus(); } });
  }
  SS.popOpen = popOpen; SS.popClose = popClose;
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("[data-pop]"); if (!b) return;
    var id = b.getAttribute("data-pop"), was = document.getElementById(id).hidden; popClose(); if (was) popOpen(id);
  });
  // (the press, not the click: what is pressed may be drawn again before the click is through)
  document.addEventListener("pointerdown", function (e) { if (!(e.target.closest && e.target.closest(".ss-pp, [data-pop], dialog, .ss-menu, .toast"))) popClose(); }, true);
  try { if (window.parent !== window) window.parent.document.addEventListener("pointerdown", function () { popClose(); }); } catch (err) { /* the portal is on another address */ }
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !document.querySelector("dialog[open]") && $$(".ss-pp").some(function (p) { return !p.hidden; })) popClose(true); });

  // "What is this?" in Correlate and Test data: the text behind the question mark (remembered)
  prefs.about = prefs.about || {};
  $$("[data-about]").forEach(function (b) {
    var id = b.getAttribute("data-about"), box = document.getElementById(id);
    function show(on) { box.hidden = !on; b.setAttribute("aria-expanded", String(on)); }
    show(!!prefs.about[id]);
    b.addEventListener("click", function () { prefs.about[id] = box.hidden; save(); show(box.hidden); });
  });

  // ── start screen: the two windows behind its links ──
  function openDlg(id) { var d = document.getElementById(id); try { d.showModal(); } catch (e) { d.setAttribute("open", ""); } }
  SS.openGuide = function () { openDlg("ss-guide"); };
  $("#ss-how-btn").addEventListener("click", function () { openDlg("ss-how"); });
  $("#ss-guide-btn").addEventListener("click", SS.openGuide);
  ["ss-how", "ss-guide"].forEach(function (id) { document.getElementById(id).addEventListener("click", function (e) { if (e.target.closest("[data-close]")) this.close(); }); });
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

  // ── How to record: the two ways as tabs (remembered), the bookmarks are dragged, not clicked ──
  var dl = document.getElementById("cdp-dl");   // works at /studio and under the IIS /converter virtual directory
  if (dl) dl.href = (location.pathname.indexOf("/converter") === 0 ? "/converter" : "") + "/downloads/cdp-recorder";
  $$(".ss-gtab").forEach(function (t) {
    t.addEventListener("click", function () {
      $$(".ss-gtab").forEach(function (x) { x.setAttribute("aria-selected", String(x === t)); });
      $$(".ss-gpanel").forEach(function (p) { p.hidden = p.id !== t.getAttribute("aria-controls"); });
      prefs.method = t.id; save();
    });
  });
  if (prefs.method && document.getElementById(prefs.method)) document.getElementById(prefs.method).click();
  $$(".ss-bm a").forEach(function (a) {
    a.addEventListener("click", function (e) { e.preventDefault(); if (typeof showToast === "function") showToast("Drag this button to your Bookmarks Bar — do not click it here.", "warning"); });
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
  var KB = ".code-tab, .adv-panel-hdr, .adv-inspector-hdr";
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

  // ── the Script tab: the file list (narrow panel) and Find in this file — nothing is written into the code
  //    (the browser's highlights mark the hits, so textContent stays the exact script) ──
  var sel = $("#ss-code-sel"), cq = $("#ss-code-q"), hits = [], hit = 0;
  function codeFiles() {
    var tabs = $$("#code-tabs .code-tab");
    sel.innerHTML = tabs.map(function (t, i) { return '<option value="' + i + '"' + (t.classList.contains("act") ? " selected" : "") + ">" + esc(t.textContent.trim()) + "</option>"; }).join("");
  }
  sel.addEventListener("change", function () { var t = $$("#code-tabs .code-tab")[+sel.value]; if (t) t.click(); });
  new MutationObserver(function () { codeFiles(); findCode(false); if (window.SSW && SSW.mark) SSW.mark(); }).observe($("#code-tabs"), { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
  function findCode(go) {
    var q = cq.value, pre = $("#code-body"), n = $("#ss-code-n"); hits = [];
    var hl = window.CSS && CSS.highlights && window.Highlight;
    if (hl) { CSS.highlights.delete("ss-find"); CSS.highlights.delete("ss-find-on"); }
    if (!q) { n.textContent = ""; hit = 0; return; }
    var w = document.createTreeWalker(pre, NodeFilter.SHOW_TEXT), nodes = [], text = "", x;
    while ((x = w.nextNode())) { nodes.push([text.length, x]); text += x.data; }
    var low = text.toLowerCase(), k = q.toLowerCase(), at = low.indexOf(k);
    function point(pos) { var a = 0, b = nodes.length - 1; while (a < b) { var m = (a + b + 1) >> 1; if (nodes[m][0] <= pos) a = m; else b = m - 1; } return [nodes[a][1], pos - nodes[a][0]]; }
    while (at >= 0 && hits.length < 2000) { var r = document.createRange(), s = point(at), e = point(at + k.length - 1); r.setStart(s[0], s[1]); r.setEnd(e[0], e[1] + 1); hits.push(r); at = low.indexOf(k, at + k.length); }
    if (go) hit = 0;
    hit = hits.length ? Math.min(hit, hits.length - 1) : 0;
    n.textContent = hits.length ? (hit + 1) + " of " + hits.length : "None";
    if (hl && hits.length) { CSS.highlights.set("ss-find", new Highlight(...hits)); CSS.highlights.set("ss-find-on", new Highlight(hits[hit])); }
    if (go && hits.length) showHit();
  }
  function showHit() {
    var r = hits[hit].getBoundingClientRect(), b = $("#code-body"), q = b.getBoundingClientRect();
    if (r.top < q.top + 8 || r.bottom > q.bottom - 24) b.scrollTop += r.top - q.top - b.clientHeight / 3;
    if (r.left < q.left || r.right > q.right - 16) b.scrollLeft += r.left - q.left - 60;
  }
  cq.addEventListener("input", function () { findCode(true); });
  cq.addEventListener("keydown", function (e) {
    if (e.key === "Enter" && hits.length) { e.preventDefault(); hit = (hit + (e.shiftKey ? hits.length - 1 : 1)) % hits.length; findCode(false); showHit(); }
    if (e.key === "Escape" && cq.value) { e.stopPropagation(); cq.value = ""; findCode(false); }
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
    findCode(false); if (window.SSW && SSW.mark) SSW.mark();
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
// dropped file is opened as a new recording too (the second recording has its own box in step 2, Correlate).
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
// "Record it now" was used in step 2, Correlate (diff mode) — through loadFile(), as a dropped file.
(function () {
  var btn = document.getElementById("ss-rec-btn");
  if (!btn || !window.PerfxRecordLive) return;
  var up = document.getElementById("ph-upload"), home = up && up.querySelector(".ss-home");
  var cards = [document.querySelector(".ss-choices"), document.querySelector(".ss-links"), document.getElementById("ss-resume"), document.getElementById("ss-band")];
  var target = 1, was = [];
  function openGuide() {
    var t = document.getElementById("tab-cdp"); if (t) t.click();
    window.SS.openGuide();
  }
  window.PerfxRecordLive.mount({
    host: home,
    chips: document.getElementById("ss-rec-chips"),
    subtitle: "Choose what to open and how. The recording opens in Script Studio when you stop.",
    isIdle: function () { return document.body.classList.contains("ss-view-home") && !cards[0].hidden; },
    before: function () { was = cards.map(function (c) { return c && c.hidden; }); cards.forEach(function (c) { if (c) c.hidden = true; }); },
    after: function () { cards.forEach(function (c, i) { if (c) c.hidden = was[i]; }); },
    onHow: openGuide,
    onSaved: function (file) {
      // a recording made here counts as Recorder usage (correlation work counts as Script Studio)
      if (window.PerfxTrack) window.PerfxTrack.send({ tool: "recorder", protocol: null, mode: "cdp", filename: file.name || null, sizeKb: file.size ? Math.round(file.size / 1024) : null, requestCount: null, result: "success", errorCode: null, duration: null });
      if (typeof loadFile !== "function") return;
      loadFile(file, target);
      if (typeof showToast === "function") setTimeout(function () { showToast(target === 2 ? "Opened as the second recording (diff mode)." : file.name + " opened.", "success", 5000); }, 600);
      target = 1;
    },
  });
  btn.addEventListener("click", function () { target = 1; window.PerfxRecordLive.open(); });
  window.SS.recordSecond = function () { target = 2; window.SS.view("home"); window.PerfxRecordLive.open(); };
})();
