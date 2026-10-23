/**
 * PerfX Studio — Home page behaviour: task buttons, help links, the CDP Recorder card's live state,
 * and hiding anything that belongs to a tool switched off in PORTAL_CONFIG (index.ejs).
 * Navigation goes through the shell (window.PerfxShell, public/portal/shell.js).
 */
(function () {
  "use strict";
  const home = document.getElementById("portal-home");
  if (!home || !window.PerfxShell) return;
  const shell = window.PerfxShell;

  home.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (go) { e.preventDefault(); shell.go(go.dataset.go); return; }
    const help = e.target.closest("[data-help]");
    if (help) { e.preventDefault(); shell.go("help", { section: help.dataset.help }); return; }
    const scroll = e.target.closest("[data-scroll]");
    if (scroll) {
      const el = document.getElementById(scroll.dataset.scroll);
      if (el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
      return;
    }
    // a click anywhere on a tool card opens that tool (its button stays the keyboard target)
    const card = e.target.closest(".hm-card");
    const main = card && card.querySelector(".hm-btn[data-go]");
    if (main && !e.target.closest("a, button, input, select, textarea, summary, details") && !String(window.getSelection && window.getSelection()).trim()) shell.go(main.dataset.go);
  });

  // tools switched off in PORTAL_CONFIG: hide their cards, guide entries and sidebar items
  /* global PORTAL_CONFIG */
  if (typeof PORTAL_CONFIG !== "undefined" && PORTAL_CONFIG.tabs) {
    document.querySelectorAll("[data-tab]").forEach((el) => {
      const t = PORTAL_CONFIG.tabs[el.dataset.tab];
      if (t && t.enabled === false) el.hidden = true;
    });
  }

  // CDP Recorder card: "running" state when a recorder answers on this machine (shell.js checks once)
  function showRecorder(r) {
    if (!r || !r.running) return;
    const card = document.getElementById("hm-rec"), state = document.getElementById("hm-rec-state"), btn = document.getElementById("hm-rec-btn");
    card.classList.add("running");
    state.textContent = r.recording
      ? `Recording in progress (${r.active} active, ${r.background} background requests)`
      : "Running on this computer and ready";
    btn.querySelector("span").textContent = "Open the toolbar";
    btn.setAttribute("href", r.url);
    btn.addEventListener("click", (e) => { e.preventDefault(); window.open(r.url, "cdpRecorderToolbar", "width=300,height=480"); });
  }
  showRecorder(window.PerfxRecorder);
  document.addEventListener("perfx:recorder", (e) => showRecorder(e.detail));
})();
