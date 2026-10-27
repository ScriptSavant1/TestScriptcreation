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

  // ── light syntax colouring of the script preview (same as the Recorder): the Studio scripts write plain
  //    text into #code-body; this only wraps tokens in spans, so textContent stays the exact script ──
  var HL = /(\/\*[\s\S]*?\*\/|\/\/[^\n]*)|("(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\[\s\S])*`)|(#\w+)|\b(return|const|let|var|async|await|new|function|if|else|for|while|try|catch|throw|typeof|null|true|false|int|char|void|LAST|ENDITEM|ITEMDATA|EXTRARES)\b|\b([A-Za-z_$][\w$]*)(?=\s*\()/g;
  // built from text nodes, not HTML, so the text is kept byte for byte (HTML parsing would turn \r\n into \n,
  // and Copy reads textContent)
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
  var code = document.getElementById("code-body");
  if (code) {
    var painted = null;
    var paint = function () {
      if (code.firstElementChild) return;              // already coloured (or not plain text)
      var t = code.textContent;
      if (!t || t.length >= 400000 || t === painted) return;
      painted = t;                                      // a file with nothing to colour is not repainted (no loop)
      var frag = colour(t);
      if (frag) { code.textContent = ""; code.appendChild(frag); }
    };
    new MutationObserver(paint).observe(code, { childList: true, characterData: true, subtree: true });
    paint();
  }

  ["dz1", "dz2"].forEach(function (id) {
    var dz = document.getElementById(id), inp = dz && dz.querySelector("input[type=file]");
    if (!inp) return;
    inp.addEventListener("focus", function () { dz.classList.add("kb-focus"); });
    inp.addEventListener("blur", function () { dz.classList.remove("kb-focus"); });
  });
})();

// Drop .har / NetLog .json files anywhere on the start page: the first free recording slot (1, then 2) gets
// each file, through the slot's own file input — the same as choosing it in the box.
(function () {
  "use strict";
  if (!window.PerfxDrop) return;
  var upload = document.getElementById("ph-upload");
  function slotInput(n) { var dz = document.getElementById("dz" + n); return dz && dz.querySelector("input[type=file]"); }
  function loaded(n) { var dz = document.getElementById("dz" + n); return !!dz && dz.classList.contains("loaded"); }
  window.PerfxDrop.attach({
    when: function () { return !!upload && upload.offsetParent !== null; },
    label: function () { return ["Drop to load", "One or two .har / NetLog .json recordings"]; },
    route: function (files, ext) {
      var recs = files.filter(function (f) { return ext(f) === ".har" || ext(f) === ".json"; }).slice(0, 2);
      var free = [1, 2].filter(function (n) { return !loaded(n); });
      if (!free.length) free = [1, 2];
      return recs.map(function (f, i) { return { input: slotInput(free[i] || free[0]), files: [f] }; });
    },
  });
})();

// Remember the output format per browser (localStorage "perfx-studio-fmt"): restored through setFmt(), so it is
// exactly like clicking the button; nothing saved = the usual default (DevWeb).
(function () {
  "use strict";
  var KEY = "perfx-studio-fmt", OK = ["webhttp", "devweb"];
  var orig = window.setFmt;
  if (typeof orig !== "function") return;
  try { var f = localStorage.getItem(KEY); if (OK.indexOf(f) !== -1) orig(f); } catch (e) { /* storage blocked */ }
  window.setFmt = function (f) {
    var r = orig.apply(this, arguments);
    try { if (OK.indexOf(f) !== -1) localStorage.setItem(KEY, f); } catch (e) { /* storage blocked */ }
    return r;
  };
})();
