/* Postman / Bruno and JMeter converters — layout behaviour only (the converter itself is in
 * index.ejs): protocol cards work with the keyboard (Enter / Space, aria-checked follows the
 * selection), and the "How it works" section remembers whether it was folded away. */
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

  // "How it works": folded or open, remembered per browser
  const how = document.getElementById("cv-how");
  if (how) {
    try { if (localStorage.getItem("perfx-cv-how") === "closed") how.open = false; } catch (_) { /* storage blocked */ }
    how.addEventListener("toggle", () => { try { localStorage.setItem("perfx-cv-how", how.open ? "open" : "closed"); } catch (_) { /* ignore */ } });
  }
})();
