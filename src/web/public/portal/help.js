/* Help & guides (portal v3) — behaviour added around the existing Help functions in
 * views/partials/help.ejs (haccToggle, haccJump, hTocToggle, hTocSetCur stay the source of truth):
 *  - a contents list beside the sections (built from the "On this page" menu), highlighting where you are
 *  - search: shows only the sections (and FAQ answers) that contain every word, opens them and marks the words
 *  - Expand all / Collapse all
 *  - a jump opens its section and scrolls only after the accordion has settled (it used to land too high
 *    because the previous section was still closing)
 *  - "/" focuses the search box while Help is open; Escape in the box clears it
 *  - the search bar stays at the top; its height is measured (--help-sticky-h) so a jump never lands under it */
(function () {
  "use strict";
  const help = document.getElementById("portal-help");
  if (!help) return;
  const $ = (s, r) => (r || help).querySelector(s);
  const $$ = (s, r) => [...(r || help).querySelectorAll(s)];
  const $$all = (s) => [...document.querySelectorAll(s)];
  const items = $$(".help-acc-item");
  const side = document.getElementById("sb-help-nav");   // the section list lives in the portal sidebar
  const idOf = (b) => ((b.getAttribute("onclick") || "").match(/haccJump\('([\w-]+)'\)/) || [])[1];
  // the "On this page" links take their section's colour, like the sidebar list
  $$(".htoc-link").forEach((b) => { const it = document.getElementById(idOf(b)); if (it) b.style.setProperty("--c-tool", it.style.getPropertyValue("--c-tool")); });

  // ── contents list, grouped like the "On this page" menu ──
  if (side) {
    const html = $$(".htoc-group").map((g) => {
      const label = (g.querySelector(".htoc-group-label") || {}).textContent || "";
      const links = [...g.querySelectorAll(".htoc-link")].map((b) => {
        const id = idOf(b);
        const icon = (b.querySelector(".htoc-link-icon") || {}).innerHTML || "";
        const text = b.textContent.trim();
        const tool = (document.getElementById(id) || help).style.getPropertyValue("--c-tool");
        return id ? `<button type="button" class="help-side-link" data-id="${id}" style="--c-tool:${tool}"><span class="help-side-ico" aria-hidden="true">${icon}</span><span class="help-side-txt">${text}</span></button>` : "";
      }).join("");
      return `<div class="help-side-group"><div class="help-side-label">${label}</div>${links}</div>`;
    }).join("");
    side.innerHTML = html;
    side.addEventListener("click", (e) => {
      const b = e.target.closest(".help-side-link");
      if (!b) return;
      if (help.style.display === "none" && window.PerfxShell) window.PerfxShell.go("help", { instant: true });
      window.haccJump(b.dataset.id);
      document.documentElement.classList.remove("sb-open");   // narrow screens: close the drawer
    });
  }
  let lockUntil = 0;   // after a jump, keep its section highlighted until the user scrolls on
  function setActive(id) {
    $$all(".help-side-link").forEach((b) => {
      b.classList.toggle("on", b.dataset.id === id);
      if (b.dataset.id === id) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current");
    });
    // the "On this page" button names the same section
    const curName = document.getElementById("htoc-cur"), link = side && side.querySelector(`[data-id="${id}"]`);
    if (curName && link) curName.textContent = link.textContent.trim();
    $$(".htoc-link").forEach((b) => b.classList.toggle("on", idOf(b) === id));
    // keep the current section visible in the sidebar list (short laptop screens), clear of the edge fade
    const cur = side && side.querySelector(".help-side-link.on");
    const navBox = cur && !side.hidden && cur.closest(".sb-nav");
    if (navBox) {   // scroll only the sidebar list (scrollIntoView would interrupt the page's own smooth scroll)
      const r = cur.getBoundingClientRect(), n = navBox.getBoundingClientRect(), m = 34;
      if (r.top < n.top + m) navBox.scrollTop -= (n.top + m - r.top);
      else if (r.bottom > n.bottom - m) navBox.scrollTop += (r.bottom - n.bottom + m);
    }
  }

  // ── jumps: no accordion animation while jumping, so the scroll target is final ──
  const origJump = window.haccJump, origSetCur = window.hTocSetCur;
  if (typeof origJump === "function") {
    window.haccJump = function (id) {
      // a section hidden by the search: clear the search first, so the jump has somewhere to land
      const target = document.getElementById(id);
      if (target && target.hidden && q && q.value) { q.value = ""; run(); }
      help.classList.add("help-instant");
      const r = origJump.apply(this, arguments);
      setActive(id); lockUntil = Date.now() + 1200;
      setTimeout(spy, 1250);   // re-check once the lock ends (the reader may have scrolled meanwhile)
      setTimeout(() => help.classList.remove("help-instant"), 500);
      return r;
    };
  }
  if (typeof origSetCur === "function") {
    window.hTocSetCur = function (id) {
      const r = origSetCur.apply(this, arguments);
      const el = document.getElementById("htoc-cur"), item = document.getElementById(id);
      // sections missing from the menu's name list still show their own title
      if (el && item && !el.textContent.trim()) el.textContent = (item.querySelector(".help-acc-title") || {}).textContent || "";
      setActive(id);
      return r;
    };
  }
  // where you are: the last section whose header has passed the bottom of the search bar
  // (or the first one, at the top of the page) — works on any window height
  let spyQueued = false;
  function spy() {
    spyQueued = false;
    if (help.style.display === "none" || Date.now() < lockUntil) return;
    const shown = items.filter((i) => !i.hidden);
    if (!shown.length) return;
    // a section counts as current once its header is in the top part of the reading area
    const barEl = $(".help-search-bar"), line = (barEl ? barEl.getBoundingClientRect().bottom : 0) + Math.min(120, innerHeight * 0.2);
    let best = shown[0];
    if (scrollY > 4) shown.forEach((i) => { if (i.getBoundingClientRect().top <= line) best = i; });
    setActive(best.id);
  }
  addEventListener("scroll", () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });
  // the reader takes over (wheel, keys, touch): the post-jump lock ends at once
  ["wheel", "keydown", "touchstart"].forEach((t) => addEventListener(t, () => { lockUntil = 0; }, { passive: true }));
  // and when Help is opened (the portal shows it by changing its style)
  if ("MutationObserver" in window) new MutationObserver(() => requestAnimationFrame(spy)).observe(help, { attributes: true, attributeFilter: ["style"] });
  spy();

  // ── the search bar: its height feeds the jump offset; a line under it once it sticks ──
  const bar = $(".help-search-bar"), root = document.documentElement;
  if (bar) {
    const measure = () => { if (bar.offsetHeight) root.style.setProperty("--help-sticky-h", bar.offsetHeight + "px"); };
    if ("ResizeObserver" in window) new ResizeObserver(measure).observe(bar);
    measure();
    const onScroll = () => {
      const tb = parseFloat(getComputedStyle(bar).top) || 0;
      bar.classList.toggle("stuck", scrollY > 0 && bar.getBoundingClientRect().top <= tb + 0.5);
    };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
  }

  // ── open / closed state for screen readers (the inline functions only toggle classes) ──
  function syncExpanded() {
    items.forEach((i) => { const h = $(".help-acc-hdr", i); if (h) h.setAttribute("aria-expanded", String(i.classList.contains("open"))); });
    $$(".help-faq-item").forEach((f) => { const b = $(".help-faq-btn", f); if (b) b.setAttribute("aria-expanded", String(f.classList.contains("open"))); });
  }
  if ("MutationObserver" in window) new MutationObserver(syncExpanded).observe(help, { subtree: true, attributes: true, attributeFilter: ["class"] });
  syncExpanded();

  // Escape closes the "On this page" menu (inline code) — give focus back to its button
  const tocBtn = document.getElementById("htoc-btn"), tocPanel = document.getElementById("htoc-panel");
  // the menu opens under its button but always inside the window (the bar can wrap the button to the right)
  const origToc = window.hTocToggle;
  if (typeof origToc === "function" && tocPanel) {
    window.hTocToggle = function () {
      const r = origToc.apply(this, arguments);
      tocPanel.style.left = ""; tocPanel.style.maxHeight = "";
      if (tocPanel.classList.contains("open")) {
        const p = tocPanel.getBoundingClientRect(), over = p.right - (document.documentElement.clientWidth - 16);
        if (over > 0 && !matchMedia("(max-width: 600px)").matches) tocPanel.style.left = Math.min(0, -over) + "px";
        // short windows: the list scrolls inside the panel instead of running past the bottom
        tocPanel.style.maxHeight = Math.max(160, innerHeight - tocPanel.getBoundingClientRect().top - 16) + "px";
      }
      return r;
    };
  }
  // Tab / Shift+Tab moving out of the menu (or off its button) closes it
  const tocOut = (e) => {
    const to = e.relatedTarget;
    if (to && !tocPanel.contains(to) && to !== tocBtn && tocPanel.classList.contains("open") && typeof window.hTocClose === "function") window.hTocClose();
  };
  if (tocPanel) { tocPanel.addEventListener("focusout", tocOut); if (tocBtn) tocBtn.addEventListener("focusout", tocOut); }

  // wide tables on small screens: the scroll box takes keyboard focus only while it actually scrolls
  if ("ResizeObserver" in window) $$(".help-table-wrap").forEach((w) => new ResizeObserver(() => {
    if (!w.clientWidth) return;
    if (w.scrollWidth > w.clientWidth + 1) { w.tabIndex = 0; w.setAttribute("role", "region"); w.setAttribute("aria-label", "Table — scroll sideways to see all columns"); }
    else { w.removeAttribute("tabindex"); w.removeAttribute("role"); w.removeAttribute("aria-label"); }
  }).observe(w));
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && tocPanel && tocPanel.classList.contains("open") && tocBtn) setTimeout(() => tocBtn.focus(), 0);
  }, true);

  // ── Expand all / Collapse all ──
  const exp = $("#help-expand-all"), col = $("#help-collapse-all");
  if (exp) exp.addEventListener("click", () => items.forEach((i) => { if (!i.hidden) i.classList.add("open"); }));
  if (col) col.addEventListener("click", () => items.forEach((i) => i.classList.remove("open")));

  // ── search ──
  const q = $("#help-q"), count = $("#help-q-count"), none = $("#help-noresult");
  let saved = null, savedFaq = null, savedY = 0, timer = null;
  function unmark() {
    $$("mark.help-hl").forEach((m) => { const t = document.createTextNode(m.textContent); m.replaceWith(t); });
    items.forEach((i) => i.normalize());
  }
  function mark(root, words) {
    const re = new RegExp("(" + words.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|") + ")", "gi");
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) => (n.nodeValue.trim() && !n.parentElement.closest("script, style, mark, svg") ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
    });
    const nodes = []; while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => {
      if (!re.test(n.nodeValue)) return; re.lastIndex = 0;
      const frag = document.createDocumentFragment(); let last = 0, m;
      while ((m = re.exec(n.nodeValue))) {
        frag.append(n.nodeValue.slice(last, m.index));
        const mk = document.createElement("mark"); mk.className = "help-hl"; mk.textContent = m[0]; frag.append(mk);
        last = re.lastIndex;
      }
      frag.append(n.nodeValue.slice(last)); n.replaceWith(frag);
    });
  }
  function run() {
    const words = q.value.toLowerCase().split(/\s+/).filter((w) => w.length > 1);
    // no open / close animation while the results change, so every scroll below lands on the final layout
    help.classList.add("help-instant"); clearTimeout(run.t); run.t = setTimeout(() => help.classList.remove("help-instant"), 400);
    unmark();
    if (!words.length) {
      items.forEach((i) => { i.hidden = false; });
      $$(".help-faq-item").forEach((f) => { f.hidden = false; });
      $$(".help-group-h").forEach((h) => { h.hidden = false; });
      if (saved) {   // back to how the page was before the search
        items.forEach((i) => i.classList.toggle("open", saved.has(i.id)));
        $$(".help-faq-item").forEach((f, k) => f.classList.toggle("open", savedFaq.has(k)));
        saved = savedFaq = null;
        scrollTo(0, savedY);
      }
      requestAnimationFrame(spy);
      $$all(".help-side-link, #htoc-panel .htoc-link").forEach((b) => b.classList.remove("dim"));
      count.textContent = ""; none.hidden = true;
      return;
    }
    if (!saved) {
      saved = new Set(items.filter((i) => i.classList.contains("open")).map((i) => i.id));
      savedFaq = new Set($$(".help-faq-item").map((f, k) => (f.classList.contains("open") ? k : -1)).filter((k) => k >= 0));
      savedY = scrollY;
    }
    let n = 0;
    items.forEach((i) => {
      const hit = words.every((w) => i.textContent.toLowerCase().includes(w));
      i.hidden = !hit; i.classList.toggle("open", hit);
      if (hit) {
        n++;
        // FAQ: show only the questions that match, opened
        const faqs = $$(".help-faq-item", i);
        if (faqs.length) faqs.forEach((f) => { const h = words.every((w) => f.textContent.toLowerCase().includes(w)); f.hidden = !h && faqs.some((x) => words.every((w) => x.textContent.toLowerCase().includes(w))); f.classList.toggle("open", h); });
        mark(i, words);
      }
      const link = side && side.querySelector(`[data-id="${i.id}"]`);
      if (link) link.classList.toggle("dim", !hit);
      const tl = document.querySelector(`#htoc-panel .htoc-link[onclick*="'${i.id}'"]`);
      if (tl) tl.classList.toggle("dim", !hit);
    });
    count.textContent = n ? `${n} section${n === 1 ? "" : "s"}` : "";
    none.hidden = n > 0;
    // a group heading shows only while one of its sections does
    $$(".help-group-h").forEach((h) => {
      let any = false;
      for (let el = h.nextElementSibling; el && !el.matches(".help-group-h"); el = el.nextElementSibling) if (el.matches(".help-acc-item") && !el.hidden) any = true;
      h.hidden = !any;
    });
    // show the results from the first one, wherever the page was scrolled to
    const first = items.find((i) => !i.hidden);
    if (first) {
      const barEl = $(".help-search-bar"), top = first.getBoundingClientRect().top, line = barEl ? barEl.getBoundingClientRect().bottom : 0;
      if (top < line || top > innerHeight * 0.6) first.scrollIntoView({ block: "start" });
    }
    requestAnimationFrame(spy);
  }
  if (q) {
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 140); });
    q.addEventListener("keydown", (e) => { if (e.key === "Escape" && q.value) { e.stopPropagation(); q.value = ""; run(); } });
  }
  // a narrow search box: a short placeholder that fits
  if (q && q.dataset.short && "ResizeObserver" in window) {
    const long = q.placeholder;
    new ResizeObserver(() => { if (q.clientWidth) q.placeholder = q.clientWidth < 400 ? q.dataset.short : long; }).observe(q);
  }
  const clr = $("#help-q-clear");
  if (clr) clr.addEventListener("click", () => { q.value = ""; run(); q.focus(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (help.style.display === "none" || e.target.closest("input, textarea, select, [contenteditable]")) return;
    e.preventDefault(); q.focus();
  });
})();
