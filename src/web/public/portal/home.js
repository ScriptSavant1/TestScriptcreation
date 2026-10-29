/**
 * PerfX Studio — Home page behaviour: tool buttons (data-go), help links (data-help), in-page jumps (data-scroll),
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
      if (el) el.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "center" });
    }
  });

  // tools switched off in PORTAL_CONFIG: hide their cards and rows
  /* global PORTAL_CONFIG */
  if (typeof PORTAL_CONFIG !== "undefined" && PORTAL_CONFIG.tabs) {
    home.querySelectorAll("[data-tab]").forEach((el) => {
      const t = PORTAL_CONFIG.tabs[el.dataset.tab];
      if (t && t.enabled === false) el.hidden = true;
    });
  }
})();
