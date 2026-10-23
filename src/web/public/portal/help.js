/* Help & guides (portal v3) — behaviour added around the existing Help functions in
 * views/partials/help.ejs (haccToggle, haccJump, hTocToggle, hTocSetCur stay the source of truth):
 *  - a contents list beside the sections (built from the "On this page" menu), highlighting where you are
 *  - search: shows only the sections (and FAQ answers) that contain every word, opens them and marks the words
 *  - Expand all / Collapse all
 *  - a jump opens its section and scrolls only after the accordion has settled (it used to land too high
 *    because the previous section was still closing)
 *  - "/" focuses the search box while Help is open; Escape in the box clears it */
(function () {
  "use strict";
  const help = document.getElementById("portal-help");
  if (!help) return;
  const $ = (s, r) => (r || help).querySelector(s);
  const $$ = (s, r) => [...(r || help).querySelectorAll(s)];
  const items = $$(".help-acc-item");
  const side = $("#help-side");

  // ── contents list, grouped like the "On this page" menu ──
  if (side) {
    const html = $$(".htoc-group").map((g) => {
      const label = (g.querySelector(".htoc-group-label") || {}).textContent || "";
      const links = [...g.querySelectorAll(".htoc-link")].map((b) => {
        const id = ((b.getAttribute("onclick") || "").match(/haccJump\('([\w-]+)'\)/) || [])[1];
        const icon = (b.querySelector(".htoc-link-icon") || {}).textContent || "";
        const text = b.textContent.replace(icon, "").trim();
        return id ? `<button type="button" class="help-side-link" data-id="${id}"><span class="help-side-ico" aria-hidden="true">${icon}</span>${text}</button>` : "";
      }).join("");
      return `<div class="help-side-group"><div class="help-side-label">${label}</div>${links}</div>`;
    }).join("");
    side.innerHTML = `<div class="help-side-title">Contents</div>${html}`;
    side.addEventListener("click", (e) => {
      const b = e.target.closest(".help-side-link");
      if (b) window.haccJump(b.dataset.id);
    });
  }
  let lockUntil = 0;   // after a jump, keep its section highlighted until the user scrolls on
  function setActive(id) {
    $$(".help-side-link").forEach((b) => b.classList.toggle("on", b.dataset.id === id));
    $$(".help-side-link").forEach((b) => { if (b.dataset.id === id) b.setAttribute("aria-current", "true"); else b.removeAttribute("aria-current"); });
  }

  // ── jumps: no accordion animation while jumping, so the scroll target is final ──
  const origJump = window.haccJump, origSetCur = window.hTocSetCur;
  if (typeof origJump === "function") {
    window.haccJump = function (id) {
      help.classList.add("help-instant");
      const r = origJump.apply(this, arguments);
      setActive(id); lockUntil = Date.now() + 1200;
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
  // where you are: the first open section near the top of the window
  if ("IntersectionObserver" in window && side) {
    const visible = new Map();
    const io = new IntersectionObserver((entries) => {
      entries.forEach((en) => visible.set(en.target.id, en.isIntersecting ? en.boundingClientRect.top : null));
      const best = items.filter((i) => visible.get(i.id) != null && !i.hidden).sort((a, b) => Math.abs(visible.get(a.id)) - Math.abs(visible.get(b.id)))[0];
      if (best && Date.now() > lockUntil) setActive(best.id);
    }, { rootMargin: "-80px 0px -55% 0px" });
    items.forEach((i) => io.observe(i));
  }

  // ── Expand all / Collapse all ──
  const exp = $("#help-expand-all"), col = $("#help-collapse-all");
  if (exp) exp.addEventListener("click", () => items.forEach((i) => { if (!i.hidden) i.classList.add("open"); }));
  if (col) col.addEventListener("click", () => items.forEach((i) => i.classList.remove("open")));

  // ── search ──
  const q = $("#help-q"), count = $("#help-q-count"), none = $("#help-noresult");
  let saved = null, timer = null;
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
    unmark();
    if (!words.length) {
      items.forEach((i) => { i.hidden = false; });
      $$(".help-faq-item").forEach((f) => { f.hidden = false; });
      if (saved) { items.forEach((i) => i.classList.toggle("open", saved.has(i.id))); saved = null; }
      $$(".help-side-link").forEach((b) => b.classList.remove("dim"));
      count.textContent = ""; none.hidden = true;
      return;
    }
    if (!saved) saved = new Set(items.filter((i) => i.classList.contains("open")).map((i) => i.id));
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
    });
    count.textContent = n ? `${n} section${n === 1 ? "" : "s"}` : "";
    none.hidden = n > 0;
  }
  if (q) {
    q.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 140); });
    q.addEventListener("keydown", (e) => { if (e.key === "Escape" && q.value) { e.stopPropagation(); q.value = ""; run(); } });
  }
  const clr = $("#help-q-clear");
  if (clr) clr.addEventListener("click", () => { q.value = ""; run(); q.focus(); });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
    if (help.style.display === "none" || e.target.closest("input, textarea, select, [contenteditable]")) return;
    e.preventDefault(); q.focus();
  });
})();
