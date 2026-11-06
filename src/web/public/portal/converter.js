/* Postman / Bruno and JMeter converters Ã¢â‚¬â€ layout behaviour only (the converter itself is in
 * index.ejs): protocol cards work with the keyboard (Enter / Space, aria-checked follows the
 * selection), option buttons announce aria-pressed, and the "How it works" section remembers
 * whether it was folded away. */
(function () {
  "use strict";
  const root = document.getElementById("portal-converter");
  if (!root) return;

  // protocol cards are divs with onclick, grouped as a radio group: one Tab stop (the selected card),
  // arrow keys move to and select the other card, Enter / Space select; aria-checked mirrors the class.
  // "Advanced settings" announces open / closed (aria-expanded mirrors its .open class).
  const syncChecked = () => {
    root.querySelectorAll(".proto-card").forEach((c) => {
      const on = /\bactive-/.test(c.className);
      c.setAttribute("aria-checked", String(on));
      c.setAttribute("tabindex", on ? "0" : "-1");
    });
    const adv = document.getElementById("adv-btn");
    if (adv) adv.setAttribute("aria-expanded", String(adv.classList.contains("open")));
    // option buttons (Script mode, Think time Ã¢â‚¬Â¦): the selected one is announced as pressed
    root.querySelectorAll(".seg-btn").forEach((b) => b.setAttribute("aria-pressed", String(b.classList.contains("active"))));
  };
  root.addEventListener("keydown", (e) => {
    const card = e.target.closest && e.target.closest(".proto-card");
    if (!card) return;
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); card.click(); return; }
    if (!/^Arrow(Left|Right|Up|Down)$/.test(e.key)) return;
    e.preventDefault();
    const cards = [...card.parentElement.querySelectorAll(".proto-card")];
    const next = cards[(cards.indexOf(card) + (/Left|Up/.test(e.key) ? -1 : 1) + cards.length) % cards.length];
    next.click(); next.focus();
  });
  new MutationObserver(syncChecked).observe(root, { subtree: true, attributes: true, attributeFilter: ["class"] });
  syncChecked();

  // "Try again" / "Convert another" hide the result box that holds the focused button: bring the form back
  // into view and put the focus on its Convert button, so keyboard users continue where the form is
  const origReset = window.resetResult;
  if (typeof origReset === "function") {
    window.resetResult = function () {
      const hadFocus = document.activeElement && document.activeElement.closest && document.activeElement.closest(".result-box");
      const r = origReset.apply(this, arguments);
      const panel = [...root.querySelectorAll(".cv-panel")].find((p) => p.style.display !== "none");
      if (panel) {
        panel.scrollIntoView({ block: "start" });
        const btn = panel.querySelector(".btn-convert");
        if (hadFocus && btn) {
          btn.focus({ preventScroll: true });
          // one column (phones, narrow windows): the button is further down Ã¢â‚¬â€ show it, not the top of the form
          const r = btn.getBoundingClientRect();
          if (r.bottom > innerHeight || r.top < 0) btn.scrollIntoView({ block: "center" });
        }
      }
      return r;
    };
  }

  // certificate chips: the Ãƒâ€” button is named after its file ("Remove client.pem")
  const nameChips = () => root.querySelectorAll(".cert-chip").forEach((chip) => {
    const rm = chip.querySelector(".chip-rm");
    if (!rm || rm.hasAttribute("aria-label")) return;
    const name = [...chip.childNodes].filter((n) => n !== rm && !(n.classList && n.classList.contains("chip-ext"))).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
    rm.setAttribute("aria-label", "Remove " + (name || "certificate"));
  });
  // the Ãƒâ€” that clears an upload box: named after its file, like the chips
  const nameClears = () => root.querySelectorAll(".drop-zone .dz-clear").forEach((x) => {
    if (x.hasAttribute("aria-label")) return;
    const zone = x.closest(".drop-zone"), file = zone && zone.querySelector(".dz-name");
    const name = file ? file.textContent.replace(/^[\sÃ¢Å“â€œ]+/, "").trim() : "";
    x.setAttribute("aria-label", "Remove " + (name || "file"));
  });
  new MutationObserver(() => { nameChips(); nameClears(); }).observe(root, { subtree: true, childList: true, characterData: true });
  // keyboard: after a Ãƒâ€” removes a file, focus stays in that upload box (the removed button took it away)
  root.addEventListener("click", (e) => {
    const x = e.target.closest && e.target.closest(".dz-clear, .chip-rm");
    if (!x) return;
    const zone = x.closest(".drop-zone"), chips = x.closest(".cert-chip-list");
    const after = chips ? [...chips.querySelectorAll(".chip-rm")].indexOf(x) : -1;
    setTimeout(() => {
      if (document.activeElement && document.activeElement !== document.body) return;
      const nextChip = chips && chips.querySelectorAll(".chip-rm")[Math.max(0, after)];
      const target = (nextChip && nextChip.isConnected && nextChip) || (zone && zone.querySelector("input[type=file]"));
      if (target) target.focus({ preventScroll: true });
    }, 0);
  }, true);   // capture: the converter's own Ãƒâ€” handlers stop the click from bubbling

  // "How it works": folded or open, remembered per browser
  const how = document.getElementById("cv-how");
  if (how) {
    try { if (localStorage.getItem("perfx-cv-how") === "closed") how.open = false; } catch (_) { /* storage blocked */ }
    how.addEventListener("toggle", () => { try { localStorage.setItem("perfx-cv-how", how.open ? "open" : "closed"); } catch (_) { /* ignore */ } });
  }
  // â”€â”€ drop a file anywhere on the converter page (portal/drop-anywhere.js) â”€â”€
  //    Postman / Bruno: a collection first (an environment .json once a collection is loaded), certificates to
  //    their box. JMeter: .jmx, CSV data files, certificates. Other portal pages: the file is not opened by
  //    the browser in place of the app.
  if (window.PerfxDrop) {
    const $id = (id) => document.getElementById(id);
    const shown = (el) => !!el && el.offsetParent !== null && getComputedStyle(el).display !== "none";
    const jmx = () => shown($id("panel-jmx"));
    const CERT = [".p12", ".pfx", ".pem", ".crt", ".cer", ".key"];
    window.PerfxDrop.attach({
      when: () => shown(root),
      label: () => jmx() ? ["Drop to load", ".jmx test plan Â· .csv data files Â· certificates"] : ["Drop to load", "Collection (.json .yml .yaml .bru) Â· environment Â· certificates"],
      route(files, ext) {
        const by = (list) => files.filter((f) => list.includes(ext(f)));
        if (jmx()) return [{ input: $id("fi-jmx"), files: by([".jmx"]) }, { input: $id("fi-csv"), files: by([".csv"]) }, { input: $id("fi-cert"), files: by(CERT) }];
        const plan = [{ input: $id("fi-bru-cert"), files: by(CERT) }];
        const col = by([".json", ".yml", ".yaml", ".bru"]);
        const hasCol = typeof F !== "undefined" && F.collection;   /* global F (index.ejs) */
        if (col.length && !hasCol) { plan.push({ input: $id("fi-col"), files: [col[0]] }); col.shift(); }
        const env = col.filter((f) => [".json", ".bru"].includes(ext(f)));
        if (env.length) plan.push({ input: $id("fi-env"), files: [env[0]] });
        return plan;
      },
    });
  }
  // ── remember the last-used options per browser (localStorage "perfx-cv-prefs"): output protocol, script mode,
  //    think time, log level, the four Advanced switches, and the JMeter options. Restored through the page's
  //    own setters, so a restored choice behaves exactly like a click. Nothing saved = the usual defaults. ──
  {
    const KEY = "perfx-cv-prefs";
    let prefs = {};
    try { prefs = JSON.parse(localStorage.getItem(KEY) || "{}") || {}; } catch (_) { prefs = {}; }
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(prefs)); } catch (_) { /* storage blocked */ } };
    const ALLOWED = {
      setProto: ["devweb", "web-http"], setMode: ["single", "multi"], setTT: [1, 2, 3, 5], setLL: ["info", "debug"],
      setJmxProto: ["devweb", "web-http"], setJmxMode: ["single", "multi"], setJmxTT: [1, 2, 3, 5], setJmxWlm: [true, false],
    };
    Object.keys(ALLOWED).forEach((name) => {
      const orig = window[name];
      if (typeof orig !== "function") return;
      if (name in prefs && ALLOWED[name].includes(prefs[name])) orig(prefs[name]);   // restore first …
      window[name] = function (v) { const r = orig.apply(this, arguments); if (ALLOWED[name].includes(v)) { prefs[name] = v; save(); } return r; };
    });
    ["opt-corr", "opt-param", "opt-auth", "opt-cmt"].forEach((id) => {
      const box = document.getElementById(id);
      if (!box) return;
      if (typeof prefs[id] === "boolean") box.checked = prefs[id];
      box.addEventListener("change", () => { prefs[id] = box.checked; save(); });
    });
  }
})();
