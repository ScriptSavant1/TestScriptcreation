/* Script Studio — Undo and Redo for every choice (window.SSH): script name, format, think time, filters, domains,
 * left-out requests, background requests, transactions, server names, correlations and test data.
 * The page calls look() after everything it draws. When nothing is running and what the script is made from has changed,
 * the state before the change goes on the Undo list. Putting a state back: the choices that decide what is read are set
 * and the recording is read again (analyze(), as for any change); then the correlations and the test data of that state
 * are put back and the script is generated again. Nothing is written to the server; a new recording starts empty. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StudioHistory = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  var MAX = 50;
  /** The list of states: look(state) says whether it changed; undo() / redo() give the state to put back. */
  function create(max) {
    var back = [], fwd = [], now = null;
    max = max || MAX;
    return {
      reset: function () { back = []; fwd = []; now = null; },
      look: function (st) {
        if (!now) { now = st; return false; }
        if (st.key === now.key) { now = st; return false; }   // the same choices: the newest copy is kept
        back.push(now); if (back.length > max) back.shift();
        fwd = []; now = st;
        return true;
      },
      undo: function () { if (!back.length) return null; fwd.push(now); now = back.pop(); return now; },
      redo: function () { if (!fwd.length) return null; back.push(now); now = fwd.pop(); return now; },
      can: function () { return { undo: back.length > 0, redo: fwd.length > 0 }; },
    };
  }
  /** What decides the reading (a change reads the recording again), as plain data. */
  function reading(S, log, bg) {
    var dom = {}; Object.keys(S.filterDomains || {}).sort().forEach(function (h) { if (S.filterDomains[h] === false) dom[h] = false; });
    return {
      types: S.filterResourceTypes instanceof Set ? Array.from(S.filterResourceTypes).sort() : null,
      dom: dom,
      leave: { ads: !(S.leaveOut && S.leaveOut.ads === false), options: !(S.leaveOut && S.leaveOut.options === false) },
      out: Array.from(S.leaveOutIds || []).sort(function (a, b) { return a - b; }),
      log: JSON.parse(JSON.stringify(log || [])),   // a copy: the list itself grows
      bg: bg ? Array.from(bg) : null,
    };
  }
  return { create: create, reading: reading };
});

(function () {
  "use strict";
  if (typeof document === "undefined" || !window.SS || !document.getElementById("ss-undo")) return;
  var SS = window.SS, $ = SS.$, H = StudioHistory.create(), busy = false;
  var ub = $("#ss-undo"), rb = $("#ss-redo");

  function open() { return !!document.querySelector("dialog[open]") || !!(window.SSE && SSE.isOpen()); }
  function read() { return StudioHistory.reading(S, window.SSW ? SSW.state.log : [], SS.bgFor === S.har1 ? SS.bgChoice : null); }
  function corrKey() {
    return JSON.stringify((S.correlations || []).map(function (c) { return [c.name, c.sourceIdx, c.extractorType, c.extractorConfig, c.list || null, (c.usages || []).length, !!c._suppressed]; })) +
      (S.advisorCandidates || []).filter(function (c) { return c.status === "skipped"; }).map(function (c) { return c.id; }).join();
  }
  function take() {
    var st = { read: read(), name: S.scriptName || "", fmt: S.format, think: SS.thinkNow(), hosts: Object.assign({}, S.hostNames || {}), data: SS.testData ? JSON.parse(JSON.stringify(SS.testData())) : null };
    st.key = JSON.stringify(st) + corrKey();
    st.seen = !!(SS.corrSeen && SS.corrSeen(true));
    // the lists together, so that what one shares with the other stays shared
    try { st.corr = structuredClone({ c: S.advisorCandidates || [], r: S.correlations || [] }); } catch (e) { st.corr = null; }
    return st;
  }
  function buttons() { var c = H.can(); ub.disabled = busy || !c.undo; rb.disabled = busy || !c.redo; }
  function look() {
    if (busy || !S.har1 || !S.entries1 || SS.busy() || (SS.queuedRead && SS.queuedRead()) || document.querySelector("#ss-bg-dlg[open]")) return;
    H.look(take()); buttons();
  }
  function idle() {
    return new Promise(function (ok) { (function wait(n) { if ((!SS.busy() && !(SS.queuedRead && SS.queuedRead())) || n > 600) ok(); else setTimeout(function () { wait(n + 1); }, 50); })(0); });
  }
  function put(st) {
    if (!st) return;
    busy = true; buttons();
    var now = read(), again = JSON.stringify(now) !== JSON.stringify(st.read);
    S.scriptName = st.name; S.hostNames = Object.assign({}, st.hosts);
    SS.thinkSet({ mode: st.think.mode, sec: st.think.sec });
    if (st.fmt !== S.format) { window.setFmt(st.fmt); S.scripts = {}; S.tab = st.fmt === "devweb" ? "mj" : "ac"; }
    if (st.data && SS.testData) SS.testData(JSON.parse(JSON.stringify(st.data)));
    var p = Promise.resolve();
    if (again) {
      S.filterResourceTypes = st.read.types ? new Set(st.read.types) : null;
      Object.keys(S.filterDomains || {}).forEach(function (h) { S.filterDomains[h] = st.read.dom[h] !== false; });
      S.leaveOut = Object.assign({}, st.read.leave); S.leaveOutIds = new Set(st.read.out);
      SSW.state.log = JSON.parse(JSON.stringify(st.read.log));
      if (st.read.bg) { SS.bgChoice = new Map(st.read.bg); SS.bgFor = S.har1; }
      if (SS.cancelAgain) SS.cancelAgain();
      p = window.analyze().then(idle);
    }
    p.then(function () {
      if (st.corr) { var c = structuredClone(st.corr); S.advisorCandidates = c.c; S.correlations = c.r; if (st.seen && SS.corrSeen) SS.corrSeen(); }
      if (st.data && SS.testData) SS.testData(JSON.parse(JSON.stringify(st.data)));
      regenerateFromAdvisor({ quiet: true });
      SS.refresh();
    }).catch(function (e) { showToast("The change could not be taken back: " + e.message + ".", "warning", 5000); }).then(function () {
      setTimeout(function () { busy = false; buttons(); look(); }, 30);
    });
  }
  function undo() { if (!busy && !SS.busy() && !open()) put(H.undo()); }
  function redo() { if (!busy && !SS.busy() && !open()) put(H.redo()); }
  ub.addEventListener("click", undo); rb.addEventListener("click", redo);
  document.addEventListener("keydown", function (e) {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || !document.body.classList.contains("ss-view-ws")) return;
    var k = e.key.toLowerCase(); if (k !== "z" && k !== "y") return;
    if (e.target.closest && e.target.closest("input:not([type=checkbox]), textarea, select, [contenteditable]")) return;
    if (open()) return;
    e.preventDefault();
    if (k === "y" || e.shiftKey) redo(); else undo();
  });
  window.SSH = { look: look, reset: function () { H.reset(); buttons(); }, undo: undo, redo: redo, busy: function () { return busy; } };
})();
