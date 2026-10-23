/* Script Studio page (portal design) — layout behaviour only. The Studio scripts (studio-ui.js,
 * studio-app.js …) are loaded unchanged and do all the work; this file adds:
 *  - show / hide the Review column and the Script column on the results page (one always stays,
 *    remembered per browser — localStorage "perfx-studio-ui")
 *  - Escape closes the "Add Custom Correlation" and "Paste & Detect" dialogs
 *  - keyboard focus ring on the drop zones (the file input inside them is the focus target) */
(function () {
  "use strict";
  var KEY = "perfx-studio-ui";
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (e) { prefs = {}; }
  function save() { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (e) { /* private window */ } }

  var ws = document.getElementById("ss-ws");
  var bReview = document.getElementById("btn-hide-review");
  var bScript = document.getElementById("btn-hide-script");
  function apply() {
    ws.classList.toggle("no-review", !!prefs.noReview);
    ws.classList.toggle("no-script", !!prefs.noScript);
    bReview.setAttribute("aria-pressed", String(!prefs.noReview));
    bScript.setAttribute("aria-pressed", String(!prefs.noScript));
  }
  bReview.addEventListener("click", function () {
    prefs.noReview = !prefs.noReview;
    if (prefs.noReview) prefs.noScript = false;   // never hide both
    save(); apply();
  });
  bScript.addEventListener("click", function () {
    prefs.noScript = !prefs.noScript;
    if (prefs.noScript) prefs.noReview = false;
    save(); apply();
  });
  apply();

  // ── dialogs: focus moves in on open, Tab stays inside, Escape closes, focus returns on close ──
  var DIALOGS = [
    { overlay: "adv-modal-overlay", open: "openAdvisorModal", close: "closeAdvisorModal", first: "adv-src-filter" },
    { overlay: "pc-modal-overlay", open: "openPasteCorrelate", close: "closePasteCorrelate", first: "pc-response-body" },
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

  // ── keyboard for controls the Studio scripts draw as plain divs (filter chips, code tabs, panel
  //    headers): reachable with Tab, Enter / Space clicks them ──
  var KB = ".rt-filter-row, .code-tab, .adv-panel-hdr, .adv-inspector-hdr, .corr-panel-hdr";
  function markKeyboard(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll(KB), function (el) {
      if (!el.hasAttribute("tabindex")) { el.setAttribute("tabindex", "0"); el.setAttribute("role", "button"); }
    });
  }
  markKeyboard();
  new MutationObserver(function () { markKeyboard(); }).observe(document.body, { childList: true, subtree: true });
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Enter" && e.key !== " ") return;
    var el = e.target.closest && e.target.closest(KB);
    if (!el || e.target !== el) return;
    e.preventDefault();
    el.click();
  });

  ["dz1", "dz2"].forEach(function (id) {
    var dz = document.getElementById(id), inp = dz && dz.querySelector("input[type=file]");
    if (!inp) return;
    inp.addEventListener("focus", function () { dz.classList.add("kb-focus"); });
    inp.addEventListener("blur", function () { dz.classList.remove("kb-focus"); });
  });
})();
