/**
 * PerfX Studio — drop a file anywhere on a tool page.
 * A page calls PerfxDrop.attach({ route }) where route(files) returns [{ input, files }] (or nothing). The files
 * are handed to that page's own <input type="file"> as if the user had picked them, so the page's existing
 * code does the rest — nothing about loading changes. Drop boxes that handle a drop themselves keep working
 * (their drop is left alone), and a file dropped outside them no longer replaces the page in the browser.
 */
(function () {
  "use strict";
  const ext = (f) => (/\.[^.]+$/.exec(f.name.toLowerCase()) || [""])[0];
  const hasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");

  function give(input, files) {
    if (!input || !files.length) return;
    const dt = new DataTransfer();
    (input.multiple ? files : files.slice(0, 1)).forEach((f) => dt.items.add(f));
    input.files = dt.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function attach(opts) {
    const doc = opts.document || document;
    const hint = doc.createElement("div");
    hint.className = "ds-dropall"; hint.hidden = true;
    hint.innerHTML = '<div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3"/><path d="m7 8 5-5 5 5"/><path d="M5 21h14"/></svg><b></b><span></span></div>';
    doc.body.appendChild(hint);
    let depth = 0;
    const show = (on) => {
      if (on) { const t = (opts.label && opts.label()) || ["Drop to load", ""]; hint.querySelector("b").textContent = t[0]; hint.querySelector("span").textContent = t[1] || ""; }
      hint.hidden = !on;
    };
    const active = () => !opts.when || opts.when();

    doc.addEventListener("dragenter", (e) => { if (hasFiles(e)) { depth++; if (active()) show(true); } });
    doc.addEventListener("dragleave", (e) => { if (hasFiles(e) && --depth <= 0) { depth = 0; show(false); } });
    doc.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      if (e.defaultPrevented) { show(false); return; }   // over a drop box that handles the drop itself
      e.preventDefault();                                 // never let the browser open the file instead of the app
      if (active()) { e.dataTransfer.dropEffect = "copy"; show(true); } else e.dataTransfer.dropEffect = "none";
    });
    doc.addEventListener("drop", (e) => {
      depth = 0; show(false);
      if (!hasFiles(e) || e.defaultPrevented) return;
      e.preventDefault();
      if (!active()) return;
      const files = [...e.dataTransfer.files];
      const plan = (opts.route(files, ext) || []).filter((p) => p.input && p.files.length);
      if (!plan.length) { if (opts.onNothing) opts.onNothing(files); return; }
      plan.forEach((p) => give(p.input, p.files));
    });
    doc.addEventListener("dragend", () => { depth = 0; show(false); });
  }

  window.PerfxDrop = { attach, ext };
})();
