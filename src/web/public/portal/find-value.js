/* Find a value — the answer, shared by the HAR Explorer and Script Studio: the verdict (correlate it, cookie only, a
 * redirect, only in left-out requests, never sent back, typed by the user, made by the browser, source missing, not
 * found), where it comes from and every request that sends it back. The search itself runs in
 * portal/har-explorer-worker.js (message "found" → result); each page draws its own request links and its own
 * "Correlate this" (the Explorer hands it to Script Studio, Script Studio adds it to its Advisor).
 * Moved unchanged from portal/har-explorer.js.
 *
 *   FindValue.html(inv, o) → the answer's HTML. o = { num(h) → the request number the page shows, link(h) → a link to
 *                            that request ('…>#N METHOD /path<…'), studio(inv) → a line about Script Studio (or ""),
 *                            corr → the page's "Correlate this" HTML (or "") }
 *   FindValue.tabFor(h)    → the details tab that shows the place (headers, response, payload, cookies)
 *   FindValue.VERDICT      → kind → [style, title, text(inv, num)] */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.FindValue = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }

  var VERDICT = {
    correlate: ["ok", "Correlate it", function (i, num) { return "The server sends it in <b>#" + num(i.src) + "</b> and the journey sends it back <b>" + i.later.length + "</b> time" + (i.later.length === 1 ? "" : "s") + ". Every virtual user gets a different value — capture it at #" + num(i.src) + " and use it in the requests below."; }],
    cookie: ["plain", "Nothing to do — it travels in cookies only", function (i, num) { return "Set by the server in #" + num(i.src) + " and only sent back as a cookie. VuGen and DevWeb keep cookies by themselves."; }],
    redirect: ["plain", "Nothing to do — a redirect the script follows", function (i, num) { return "#" + num(i.src) + " redirects to it and the next request only follows that redirect, as VuGen and DevWeb do by themselves."; }],
    outonly: ["plain", "Nothing to do — only sent to requests left out of the script", function () { return "Every request that sends it back is left out of the script (analytics, static files …), so the script never needs it."; }],
    unused: ["plain", "Never sent back", function (i) { return i.src ? "The server returns it, but no later request sends it — nothing to correlate." : "It is in the recording, but no request sends it."; }],
    missing: ["warn", "Its source is not in this recording", function (i) { return "No response in this HAR contains it — but <b>" + i.missing + "</b> earlier response" + (i.missing === 1 ? " has" : "s have") + " no body in the file (the browser kept no copy, for example because it served the page from its cache), so it probably comes from one of those. Without that response there is nothing to capture it from, so <b>Correlate this</b> cannot be offered. Record the journey again with DevTools “Disable cache” ticked, or with the PerfX CDP Recorder, and look it up again."; }],
    input: ["param", "A value typed in the journey — make it a parameter", function () { return "It never comes back from the server before it is sent: the user typed or chose it (a user name, a search term …). Give it a parameter with test data, so each virtual user can use a different one."; }],
    generated: ["param", "Made by the browser — generate it in the script", function () { return "It never comes from the server and looks like a time stamp or a GUID created by the page's JavaScript. Generate a new one in the script (VuGen: lr_save_timestamp / lr_generate_uuid; DevWeb: Date.now() / a uuid function)."; }],
    none: ["plain", "Not found in this recording", function () { return "Check the spelling, or try a shorter part of the value."; }],
  };
  function tabFor(h) { return h.side === "res" ? (h.header ? "headers" : "response") : h.kind === "body" || /^query/.test(h.where) ? "payload" : h.kind === "cookie" ? "cookies" : "headers"; }

  function html(inv, o) {
    var num = o.num, link = o.link, body = "";
    var V = VERDICT[inv.kind];
    body += '<div class="hx-verdict ' + V[0] + '"><div><h3>' + V[1] + "</h3><p>" + V[2](inv, num) + "</p>" +
      (inv.kind === "correlate" ? (o.studio ? o.studio(inv) : "") : "") + "</div></div>";
    var steps = [];
    if (inv.src) steps.push('<li class="from"><span class="hx-badge src">Comes from</span><span>' + link(inv.src) + '<span class="wh">' + esc(inv.src.where) + (inv.src.enc ? ' · <span class="hx-badge enc">' + esc(inv.src.enc) + "</span>" : "") + "</span></span></li>");
    (inv.src ? inv.later : inv.uses).forEach(function (u) {
      steps.push('<li><span class="hx-badge use">Sent in</span><span>' + link(u) + '<span class="wh">' + esc(u.where) + (u.enc ? ' · <span class="hx-badge enc">sent ' + esc(u.enc) + "</span>" : "") + "</span></span></li>");
    });
    if (steps.length) body += '<ol class="hx-trail">' + steps.join("") + "</ol>";
    var aside = [];
    if (inv.outsideCount) aside.push("sent to " + inv.outsideCount + " request" + (inv.outsideCount === 1 ? "" : "s") + " left out of the script (" + inv.outside.slice(0, 6).map(function (x) { return link(x).replace(/>#(\d+)[^<]*</, ">#$1<"); }).join(", ") + (inv.outsideCount > 6 ? " …" : "") + ")");
    if (inv.referer) aside.push("in the Referer / Origin header of " + inv.referer + " request" + (inv.referer === 1 ? "" : "s") + " — the page address, which the script copies as it is");
    if (aside.length) body += '<p class="hx-also">Also ' + aside.join("; and ") + ". Not counted above.</p>";
    if (inv.also.length) body += '<p class="hx-also">Also returned later by ' + inv.also.map(function (x) { return link(x).replace(/>#(\d+)[^<]*</, ">#$1<") + " (" + esc(x.where) + ")"; }).join(", ") + " — the first one is the one to capture.</p>";
    if (o.corr) body += o.corr;
    return body;
  }

  return { html: html, tabFor: tabFor, VERDICT: VERDICT };
});
