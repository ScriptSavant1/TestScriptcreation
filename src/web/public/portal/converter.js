/* Postman / Bruno and JMeter converters — layout behaviour only (the converter itself is in
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
    // option buttons (Script mode, Think time …): the selected one is announced as pressed
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

  // "Try Again" / "Convert Another" hide the result box that holds the focused button: bring the form back
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
          // one column (phones, narrow windows): the button is further down — show it, not the top of the form
          const r = btn.getBoundingClientRect();
          if (r.bottom > innerHeight || r.top < 0) btn.scrollIntoView({ block: "center" });
        }
      }
      return r;
    };
  }

  // certificate chips: the × button is named after its file ("Remove client.pem")
  const nameChips = () => root.querySelectorAll(".cert-chip").forEach((chip) => {
    const rm = chip.querySelector(".chip-rm");
    if (!rm || rm.hasAttribute("aria-label")) return;
    const name = [...chip.childNodes].filter((n) => n !== rm && !(n.classList && n.classList.contains("chip-ext"))).map((n) => n.textContent).join(" ").replace(/\s+/g, " ").trim();
    rm.setAttribute("aria-label", "Remove " + (name || "certificate"));
  });
  // the × that clears an upload box: named after its file, like the chips
  const nameClears = () => root.querySelectorAll(".drop-zone .dz-clear").forEach((x) => {
    if (x.hasAttribute("aria-label")) return;
    const zone = x.closest(".drop-zone"), file = zone && zone.querySelector(".dz-name");
    const name = file ? file.textContent.replace(/^[\s✓]+/, "").trim() : "";
    x.setAttribute("aria-label", "Remove " + (name || "file"));
  });
  new MutationObserver(() => { nameChips(); nameClears(); }).observe(root, { subtree: true, childList: true, characterData: true });
  // keyboard: after a × removes a file, focus stays in that upload box (the removed button took it away)
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
  }, true);   // capture: the converter's own × handlers stop the click from bubbling

  // "How it works": folded or open, remembered per browser
  const how = document.getElementById("cv-how");
  if (how) {
    try { if (localStorage.getItem("perfx-cv-how") === "closed") how.open = false; } catch (_) { /* storage blocked */ }
    how.addEventListener("toggle", () => { try { localStorage.setItem("perfx-cv-how", how.open ? "open" : "closed"); } catch (_) { /* ignore */ } });
  }
})();
