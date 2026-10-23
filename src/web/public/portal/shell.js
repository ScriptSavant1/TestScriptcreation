/**
 * PerfX Studio — portal shell (sidebar + top bar + routing).
 *
 * Wraps the portal's existing page switchers (switchPortalTab, openConverterTab, switchTab,
 * haccJump in index.ejs) so every tool keeps working unchanged, and adds:
 *  - the address bar is never changed: every page lives at the same address (…/converter),
 *    as before the redesign (works the same under IIS)
 *  - a collapsible sidebar (remembered per browser), an off-canvas drawer below 900 px
 *  - the top bar title for the current page, and a "How it works" link to its Help section
 *  - one CDP Recorder check shared by the sidebar and the Home page (event "perfx:recorder")
 */
(function () {
  "use strict";

  const PAGES = {
    home:    { hash: "#/home",            tab: "home",      group: "PerfX Studio",   name: "Home",                    c: "--c-home",    help: "hacc-quickstart" },
    postman: { hash: "#/convert/postman", tab: "converter", sub: "bruno", group: "Create scripts", name: "Postman / Bruno converter", c: "--c-convert", help: "hacc-converter" },
    jmeter:  { hash: "#/convert/jmeter",  tab: "converter", sub: "jmx",   group: "Create scripts", name: "JMeter converter",          c: "--c-jmeter",  help: "hacc-jmeter" },
    record:  { hash: "#/record",          tab: "recorder",  group: "Create scripts", name: "Recorder",                c: "--c-record",  help: "hacc-recorder" },
    studio:  { hash: "#/studio",          tab: "studio",    group: "Create scripts", name: "Script Studio",           c: "--c-studio",  help: "hacc-studio" },
    results: { hash: "#/results",         tab: "analyser",  group: "Analyse",        name: "Results Analyser",        c: "--c-results", help: "hacc-analyser" },
    help:    { hash: "#/help",            tab: "help",      group: "Learn",          name: "Help & guides",           c: "--c-help",    help: null },
  };
  const html = document.documentElement;
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
  const store = { get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* storage blocked */ } } };

  let current = "home";
  let applying = false; // true while the shell itself drives the old switchers

  /** Which page is showing, from the old portal state (tab + converter sub-tab). */
  function pageOf(tab) {
    if (tab === "converter") {
      const jmx = $("#panel-jmx");
      return jmx && jmx.style.display !== "none" ? "jmeter" : "postman";
    }
    return Object.keys(PAGES).find((k) => PAGES[k].tab === tab) || "home";
  }

  /** Reflect the current page in the sidebar, the top bar and the document title. */
  function reflect(page) {
    current = page;
    const p = PAGES[page];
    $$(".sb-item[data-page]").forEach((a) => {
      if (a.dataset.page === page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    const ico = $("#tb-ico"), src = $(`.sb-item[data-page="${page}"] .sb-ico`);
    if (ico && src) { ico.innerHTML = src.innerHTML; ico.style.setProperty("--c", `var(${p.c})`); }
    $("#tb-crumb").textContent = p.group;
    $("#tb-name").textContent = p.name;
    const helpBtn = $("#tb-help");
    if (helpBtn) helpBtn.hidden = !p.help;
    document.title = page === "home" ? "PerfX Studio — Performance Script Generation" : `${p.name} — PerfX Studio`;
    html.classList.remove("sb-open");
  }

  /** Open a page through the portal's own switchers (with a view transition where supported). */
  function go(page, opts) {
    opts = opts || {};
    const p = PAGES[page];
    if (!p) return;
    const run = () => {
      applying = true;
      try {
        if (p.tab === "converter" && typeof window.openConverterTab === "function") window.openConverterTab(p.sub);
        else window.switchPortalTab(p.tab);
        if (page === "help" && opts.section && typeof window.haccJump === "function") setTimeout(() => window.haccJump(opts.section), 60);
      } finally { applying = false; }
      reflect(page);
    };
    if (document.startViewTransition && !opts.instant && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      // a second click during the animation skips the first one — that is expected, not an error
      const t = document.startViewTransition(run);
      [t.ready, t.finished, t.updateCallbackDone].forEach((pr) => pr && pr.catch(() => {}));
    } else run();
  }

  /** "#/help/recorder" → { page: "help", section: "hacc-recorder" } */
  function parseHash(h) {
    const m = /^#\/help\/([\w-]+)$/.exec(h || "");
    if (m) return { page: "help", section: "hacc-" + m[1] };
    const page = Object.keys(PAGES).find((k) => PAGES[k].hash === h);
    return { page: page || "home" };
  }

  // keep the shell in step when the old code switches pages itself (tool cards, "Back", Clear …)
  function wrap(name, after) {
    const orig = window[name];
    if (typeof orig !== "function") return;
    window[name] = function () {
      const r = orig.apply(this, arguments);
      if (!applying) after.apply(this, arguments);
      return r;
    };
  }
  wrap("switchPortalTab", (tab) => reflect(pageOf(tab)));
  wrap("switchTab", (sub) => { if (current === "postman" || current === "jmeter") reflect(sub === "jmx" ? "jmeter" : "postman"); });

  // ── sidebar: navigation, collapse, drawer ──
  $$(".sb-item[data-page]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); go(a.dataset.page); }));
  $(".sb-brand").addEventListener("click", (e) => { e.preventDefault(); go("home"); });
  $(".sb-collapse").addEventListener("click", () => {
    const on = !html.classList.contains("sb-collapsed");
    html.classList.toggle("sb-collapsed", on);
    store.set("perfx-sidebar", on ? "collapsed" : "open");
    $(".sb-collapse").setAttribute("aria-expanded", String(!on));
    $(".sb-collapse .sb-label").textContent = on ? "Expand menu" : "Collapse menu";
    hideTip();
  });
  $(".sb-collapse").setAttribute("aria-expanded", String(!html.classList.contains("sb-collapsed")));
  $(".sb-collapse .sb-label").textContent = html.classList.contains("sb-collapsed") ? "Expand menu" : "Collapse menu";
  $("#tb-menu").addEventListener("click", () => html.classList.toggle("sb-open"));
  $(".sb-scrim").addEventListener("click", () => html.classList.remove("sb-open"));
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") html.classList.remove("sb-open");
    // Ctrl/⌘ + B toggles the sidebar, as in most editors
    if ((e.ctrlKey || e.metaKey) && (e.key === "b" || e.key === "B") && !e.target.closest("input, textarea, [contenteditable]")) { e.preventDefault(); $(".sb-collapse").click(); }
  });

  // tooltip for the collapsed rail
  const tip = document.createElement("div");
  tip.className = "sb-tip"; tip.setAttribute("role", "tooltip");
  document.body.appendChild(tip);
  function showTip(el) {
    if (!html.classList.contains("sb-collapsed") || innerWidth <= 900) return;
    const label = el.querySelector(".sb-label"), sub = el.querySelector(".sb-sub");
    tip.innerHTML = ""; tip.append(label ? label.textContent : "");
    if (sub && sub.textContent) { const s = document.createElement("small"); s.textContent = sub.textContent; tip.append(s); }
    const r = el.getBoundingClientRect();
    tip.style.left = r.right + 10 + "px"; tip.style.top = r.top + r.height / 2 + "px";
    tip.classList.add("show");
  }
  function hideTip() { tip.classList.remove("show"); }
  $$(".sb .sb-item").forEach((el) => {
    el.addEventListener("mouseenter", () => showTip(el)); el.addEventListener("mouseleave", hideTip);
    el.addEventListener("focus", () => showTip(el)); el.addEventListener("blur", hideTip);
  });

  // ── top bar ──
  $("#tb-help").addEventListener("click", () => { const p = PAGES[current]; if (p.help) go("help", { section: p.help }); });
  $("#tb-theme").addEventListener("click", () => { if (typeof window.toggleTheme === "function") window.toggleTheme(); });

  // ── start on Home. An old "#/record"-style link still opens its page once; the address is then
  //    put back to the plain one, so the address bar always shows only …/converter ──
  if (/^#\//.test(location.hash)) {
    const r = parseHash(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    go(r.page, { section: r.section, instant: true });
  } else reflect("home");
  // a tool page opened on its own redirected here (portal/frame-guard.js): open that tool
  {
    let want = null;
    try { want = sessionStorage.getItem("perfx-open"); sessionStorage.removeItem("perfx-open"); } catch (_) { /* storage blocked */ }
    if (want && PAGES[want]) go(want, { instant: true });
  }
  // the same for a "#/…" link opened while the portal is already open
  window.addEventListener("hashchange", () => {
    if (!/^#\//.test(location.hash)) return;
    const r = parseHash(location.hash);
    history.replaceState(null, "", location.pathname + location.search);
    go(r.page, { section: r.section, instant: true });
  });

  // other scripts (the Home page) navigate through the shell
  window.PerfxShell = { go, pages: PAGES };

  // ── CDP Recorder: is one running on this machine? (best effort, silent when not) ──
  const REC = "http://localhost:8787";
  const recorder = { running: false, recording: false, active: 0, background: 0, url: REC };
  window.PerfxRecorder = recorder;
  if (window.AbortSignal && AbortSignal.timeout) {
    fetch(REC + "/api/status", { signal: AbortSignal.timeout(1500) })
      .then((r) => { if (!r.ok) throw new Error("not ok"); return r.json(); })
      .then((s) => {
        Object.assign(recorder, { running: true, recording: !!s.recording, active: s.active || 0, background: s.background || 0 });
        const badge = $("#sb-rec-badge");
        if (badge) { badge.hidden = false; badge.textContent = s.recording ? "Recording" : "Running"; }
        document.dispatchEvent(new CustomEvent("perfx:recorder", { detail: recorder }));
      })
      .catch(() => { /* nothing running locally — normal */ });
  }
})();
