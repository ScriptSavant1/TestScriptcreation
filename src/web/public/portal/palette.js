/**
 * PerfX Studio — quick search (Ctrl+K / ⌘K, or the "Search" button in the top bar).
 * Finds any tool, Help section or FAQ question, and a few actions, and opens it through the shell
 * (window.PerfxShell). The list is read from the page itself (sidebar items, Help sections, FAQ), so it
 * never goes out of date. Ctrl+K also works while a tool page (iframe) has the focus.
 */
(function () {
  "use strict";
  const shell = window.PerfxShell;
  if (!shell) return;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const ICON = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const I_HELP = ICON('<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"/>');
  const I_FAQ = ICON('<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6"/><path d="M12 17h.01"/>');
  const I_THEME = ICON('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>');
  const I_MENU = ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>');
  const I_DL = ICON('<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>');

  /** Everything that can be found, read from the page each time the search opens. */
  function items() {
    const list = [];
    $$(".sb-item[data-page]").forEach((el) => {
      if (el.hidden || el.closest("[hidden]")) return;
      const page = el.dataset.page, p = shell.pages[page];
      list.push({ group: "Tools", title: p ? p.name : el.textContent.trim(), sub: (el.querySelector(".sb-sub") || {}).textContent || "",
        icon: (el.querySelector(".sb-ico svg") || {}).outerHTML || "", c: p && p.c, run: () => shell.go(page) });
    });
    $$("#portal-help .help-acc-item[id]").forEach((sec) => {
      const t = $(".help-acc-title", sec); if (!t) return;
      const sub = $(".help-acc-sub, .help-acc-meta", sec);
      list.push({ group: "Help", title: t.textContent.trim(), sub: sub ? sub.textContent.trim() : "Help & guides", icon: I_HELP, c: "--c-help", kw: sec.textContent.toLowerCase(),
        run: () => shell.go("help", { section: sec.id }) });
    });
    $$("#portal-help .help-faq-q").forEach((q) => {
      const btn = q.closest("button");
      list.push({ group: "Questions", title: q.textContent.trim(), sub: "Frequently asked questions", icon: I_FAQ, c: "--c-help",
        run: () => {
          shell.go("help", { section: "hacc-faq" });
          setTimeout(() => {   // open the answer once the jump has landed
            const item = btn && btn.closest(".help-faq-item");
            if (item && !item.classList.contains("open") && btn) btn.click();
            if (btn) btn.scrollIntoView({ block: "center" });
          }, 400);
        } });
    });
    list.push({ group: "Actions", title: "Switch light / dark theme", sub: "", icon: I_THEME, run: () => { const b = $("#tb-theme"); if (b) b.click(); } });
    if (innerWidth > 900) list.push({ group: "Actions", title: document.documentElement.classList.contains("sb-collapsed") ? "Expand the menu" : "Collapse the menu", sub: "Ctrl+B", icon: I_MENU, run: () => { const b = $(".sb-collapse"); if (b) b.click(); } });
    /* global PORTAL_CONFIG */
    const recOff = typeof PORTAL_CONFIG !== "undefined" && PORTAL_CONFIG.tabs && PORTAL_CONFIG.tabs.recorder && PORTAL_CONFIG.tabs.recorder.enabled === false;
    if (!recOff) list.push({ group: "Actions", title: "Get CDP Recorder", sub: "Download the recording toolbar", icon: I_DL, c: "--c-record",
      run: () => { location.href = (location.pathname.indexOf("/converter") === 0 ? "/converter" : "") + "/downloads/cdp-recorder"; } });
    return list;
  }

  /** Every word typed must appear (in the title or the line under it, or in a Help section's text); title matches rank first. */
  function search(list, q) {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return list.filter((x) => x.group !== "Questions");
    return list.map((x) => {
      const t = x.title.toLowerCase(), all = t + " " + x.sub.toLowerCase() + " " + x.group.toLowerCase();
      const inHead = words.every((w) => all.includes(w));
      if (!inHead && !(x.kw && words.every((w) => x.kw.includes(w)))) return null;   // Help sections: also their text
      const score = inHead ? (t.startsWith(words[0]) ? 0 : 2) + (words.every((w) => t.includes(w)) ? 0 : 1) : 4;
      return { x, score };
    }).filter(Boolean).sort((a, b) => a.score - b.score).map((r) => r.x);
  }

  // ── the dialog ──
  const box = document.createElement("div");
  box.className = "pal"; box.hidden = true;
  box.innerHTML =
    '<div class="pal-scrim"></div>' +
    '<div class="pal-dlg" role="dialog" aria-modal="true" aria-label="Quick search">' +
      '<label class="pal-input">' + ICON('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>') +
        '<input type="text" id="pal-q" placeholder="Search tools, Help and questions…" autocomplete="off" spellcheck="false" role="combobox" aria-expanded="true" aria-controls="pal-list" aria-autocomplete="list">' +
        '<kbd>Esc</kbd></label>' +
      '<div class="pal-list" id="pal-list" role="listbox" aria-label="Results"></div>' +
      '<div class="pal-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span><kbd>Esc</kbd> close</span></div>' +
    "</div>";
  document.body.appendChild(box);
  const input = $("#pal-q", box), listEl = $("#pal-list", box);
  let all = [], shown = [], sel = 0, back = null;

  function render() {
    shown = search(all, input.value).slice(0, 40);
    sel = Math.min(sel, Math.max(0, shown.length - 1));
    listEl.innerHTML = "";
    if (!shown.length) { listEl.innerHTML = '<div class="pal-empty">Nothing found. Try another word, or open Help & guides.</div>'; input.removeAttribute("aria-activedescendant"); return; }
    let group = null;
    shown.forEach((x, i) => {
      if (x.group !== group) { group = x.group; const g = document.createElement("div"); g.className = "pal-group"; g.textContent = group; listEl.appendChild(g); }
      const o = document.createElement("div");
      o.className = "pal-opt" + (i === sel ? " on" : ""); o.id = "pal-o" + i; o.setAttribute("role", "option"); o.setAttribute("aria-selected", String(i === sel));
      if (x.c) o.style.setProperty("--c", `var(${x.c})`);
      o.innerHTML = '<span class="pal-ico"></span><span class="pal-txt"><b></b><small></small></span>';
      o.querySelector(".pal-ico").innerHTML = x.icon;
      o.querySelector("b").textContent = x.title;
      o.querySelector("small").textContent = x.sub;
      o.addEventListener("mousemove", () => { if (sel !== i) { sel = i; mark(); } });
      o.addEventListener("click", () => choose(i));
      listEl.appendChild(o);
    });
    mark();
  }
  function mark() {
    $$(".pal-opt", listEl).forEach((o, i) => { o.classList.toggle("on", i === sel); o.setAttribute("aria-selected", String(i === sel)); });
    const on = $("#pal-o" + sel, listEl);
    if (on) { input.setAttribute("aria-activedescendant", on.id); on.scrollIntoView({ block: "nearest" }); }
  }
  function choose(i) { const x = shown[i]; if (!x) return; close(); x.run(); }
  function open() {
    if (!box.hidden) return;
    back = document.activeElement;
    all = items(); input.value = ""; sel = 0;
    box.hidden = false; document.documentElement.classList.add("pal-open");
    render(); input.focus();
  }
  function close() {
    if (box.hidden) return;
    box.hidden = true; document.documentElement.classList.remove("pal-open");
    if (back && document.contains(back) && back !== document.body) { try { back.focus(); } catch (_) { /* gone */ } }
  }
  input.addEventListener("input", () => { sel = 0; render(); });
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); sel = Math.min(sel + 1, shown.length - 1); mark(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); sel = Math.max(sel - 1, 0); mark(); }
    else if (e.key === "Home" && !input.value) { e.preventDefault(); sel = 0; mark(); }
    else if (e.key === "End" && !input.value) { e.preventDefault(); sel = shown.length - 1; mark(); }
    else if (e.key === "Enter") { e.preventDefault(); choose(sel); }
    else if (e.key === "Escape") { e.preventDefault(); close(); }
    else if (e.key === "Tab") e.preventDefault();   // focus stays in the dialog
  });
  $(".pal-scrim", box).addEventListener("click", close);

  // Ctrl+K / ⌘K anywhere — in the portal and inside the tool pages (same-origin iframes)
  function onKey(e) {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === "k" || e.key === "K")) { e.preventDefault(); box.hidden ? open() : close(); }
  }
  document.addEventListener("keydown", onKey);
  function hookFrame(f) {
    const attach = () => { try { const d = f.contentDocument; if (d && !d.__perfxPal) { d.__perfxPal = true; d.addEventListener("keydown", onKey); } } catch (_) { /* not same-origin */ } };
    f.addEventListener("load", attach); attach();
  }
  $$("iframe").forEach(hookFrame);
  new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => { if (n.tagName === "IFRAME") hookFrame(n); }))).observe(document.body, { childList: true, subtree: true });

  const btn = $("#tb-search");
  if (btn) btn.addEventListener("click", open);
  window.PerfxPalette = { open, close };
})();
