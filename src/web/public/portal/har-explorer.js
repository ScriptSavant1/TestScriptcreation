/* HAR Explorer — page behaviour.
 *  - theme: own key "hx-theme"; inside the portal the portal's theme (lrePortalInit / lreSetTheme)
 *  - start page: choose or drop a .har file → read in the browser (nothing is uploaded) → hxBuild() (har-explorer-model.js:
 *    the Recorder's own reading, so transactions and left-out requests match the Recorder)
 *  - workspace: the request list (grouped by transaction; only the rows on screen are drawn, so very large recordings
 *    stay fast), filters, and the request details: Headers, Payload, Response, Preview, Cookies, Timing
 *  - remembered per browser (localStorage "hx-ui"): list width, "Show left-out requests" */
(function () {
  "use strict";
  var html = document.documentElement;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  // ── theme ──
  function setTheme(t) {
    html.setAttribute("data-theme", t || "dark");
    try { localStorage.setItem("hx-theme", t || "dark"); } catch (e) { /* storage blocked */ }
  }
  window.lrePortalInit = function (theme) { html.classList.add("embedded"); setTheme(theme); };
  window.lreSetTheme = function (theme) { setTheme(theme); };
  $("#hx-theme").addEventListener("click", function () { setTheme(html.getAttribute("data-theme") === "dark" ? "light" : "dark"); });

  // ── per-browser preferences ──
  var prefs = {};
  try { prefs = JSON.parse(localStorage.getItem("hx-ui") || "{}") || {}; } catch (e) { prefs = {}; }
  function savePrefs() { try { localStorage.setItem("hx-ui", JSON.stringify(prefs)); } catch (e) { /* storage blocked */ } }

  // ── helpers ──
  var toastEl = $("#hx-toast"), toastTimer;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("on"); clearTimeout(toastTimer); toastTimer = setTimeout(function () { toastEl.classList.remove("on"); }, 3500); }
  // the request details view and its small helpers are shared with Script Studio (portal/request-details.js)
  var RD = window.RequestDetails;
  var esc = RD.esc, short = RD.short, size = RD.size, ms = RD.ms, methodClass = RD.methodClass;
  function split(url) { var m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(url || ""); return m ? { host: m[2], path: m[3] || "/" } : { host: "", path: url || "" }; }
  // ── state ──
  var M = null;   // { name, size, model, rows, sel, tab, closed, types, q, showOut, mask, full }

  // ── usage statistics (portal/track.js): one record per opened file — the figures only, never the recording ──
  function track(file, t0, result, extra) {
    if (!window.PerfxTrack) return;
    var p = { tool: "explorer", filename: file.name, sizeKb: Math.round(file.size / 1024), result: result, duration: Date.now() - t0 };
    Object.keys(extra || {}).forEach(function (k) { p[k] = extra[k]; });
    window.PerfxTrack.send(p);
  }

  // ── loading ──
  var input = $("#hx-file"), pick = $("#hx-pick"), drop = $("#hx-drop");
  function take(file) {
    if (!file) return;
    var t0 = Date.now();
    if (!/\.(har|json)$/i.test(file.name)) { toast(file.name + " is not a .har file."); track(file, t0, "failed", { errorCode: "unsupported_file_type" }); return; }
    $("#hx-drop-busy").textContent = "Reading " + file.name + " …"; drop.classList.add("busy");
    var rd = new FileReader();
    rd.onerror = function () { drop.classList.remove("busy"); toast("The file could not be read."); };
    rd.onload = function () {
      setTimeout(function () {   // let "Reading …" show before the work starts
        var har;
        try { har = JSON.parse(rd.result); } catch (e) { drop.classList.remove("busy"); toast(file.name + " is not a valid HAR file (it is not JSON)."); track(file, t0, "failed", { errorCode: "parse_error" }); return; }
        if (!har || !har.log || !Array.isArray(har.log.entries)) { drop.classList.remove("busy"); toast(file.name + " is not a HAR file — it has no list of requests (log.entries)."); track(file, t0, "failed", { errorCode: "not_a_har" }); return; }
        try {
          open(file.name, file.size, har, rd.result); M.file = file;
          track(file, t0, "success", { requestCount: M.model.items.length, mode: M.model.source });
        } catch (e) { toast("The file could not be opened: " + e.message); track(file, t0, "failed", { errorCode: "unreadable_recording" }); }
        drop.classList.remove("busy");
      }, 30);
    };
    rd.readAsText(file);
  }
  input.addEventListener("change", function () { take(input.files[0]); input.value = ""; });
  pick.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); input.click(); } });
  ["dragenter", "dragover"].forEach(function (t) { document.addEventListener(t, function (e) { if (!$("#hx-start").hidden) { e.preventDefault(); drop.classList.add("over"); } }); });
  document.addEventListener("dragleave", function (e) { if (!e.relatedTarget) drop.classList.remove("over"); });
  document.addEventListener("drop", function (e) { if ($("#hx-start").hidden) return; e.preventDefault(); drop.classList.remove("over"); take(e.dataTransfer.files[0]); });

  function open(name, bytes, har, text) {
    var model = hxBuild(har);
    clearTimeout(toastTimer); toastEl.classList.remove("on");   // an earlier message is about another file
    M = { name: name, size: bytes, model: model, sel: null, tab: "headers", closed: {}, types: {}, q: "", showOut: !!prefs.showOut, mask: false, full: {},
      view: "req", find: "", inv: null, hits: null, sugg: null, studioCount: 0, byN: {},
      // "Correlate this": the script format (Script Studio's remembered choice, else DevWeb — Studio's default),
      // the name typed for the value on screen, and the correlations to hand to Studio
      fmt: (function () { try { return localStorage.getItem("perfx-studio-fmt") === "webhttp" ? "webhttp" : "devweb"; } catch (e) { return "devweb"; } })(),
      corrName: "", added: [] };
    addedButton();
    model.items.forEach(function (it) { M.byN[it.n] = it; });
    findButton();   // a new file opens on its requests, not on "Find a value"
    startWorker(text);
    HX_TYPES.forEach(function (t) { M.types[t[0]] = true; });
    initDomains();
    $("#hx-out").checked = M.showOut; $("#hx-mask").checked = false; $("#hx-q").value = "";
    // the file bar
    var inScript = model.items.filter(function (it) { return !it.out; }).length, tx = model.groups.filter(function (g) { return g.txn; }).length;
    $("#hx-fb-name").textContent = name;
    $("#hx-fb-sub").textContent = size(bytes) + " · " + (model.creator.name || "unknown tool") + (model.creator.version ? " " + model.creator.version : "");
    $("#hx-fb-src").textContent = { bookmarks: "Bookmark transactions (START / END)", cdp: "PerfX CDP Recorder transactions", pages: "Transactions from the page loads", none: "No transactions in this file" }[model.source];
    $("#hx-fb-src").title = { bookmarks: "Transactions from the START / END bookmarks in the recording — grouped as the Recorder groups them", cdp: "Recorded with the PerfX CDP Recorder — its transactions, as the Recorder shows them", pages: "The recording's page loads (pages in the HAR), as the Recorder uses them", none: "This recording has no bookmarks and no pages" }[model.source];
    $("#hx-fb-src").classList.toggle("none", model.source === "none");
    $("#hx-fb-n").innerHTML = "<b>" + inScript + "</b>&nbsp;of " + model.items.length + " requests in the script";
    $("#hx-fb-tx").innerHTML = "<b>" + tx + "</b>&nbsp;transaction" + (tx === 1 ? "" : "s");
    $("#hx-fb-dur").innerHTML = "<b>" + ms(model.end) + "</b>&nbsp;recorded";
    $("#hx-start").hidden = true; $(".hx-band").hidden = true; $("#hx-ws").hidden = false; html.classList.add("hx-has-file");
    M.sel = model.items.filter(visible)[0] || null;
    renderTypes(); build(); renderDetails();
    $("#hx-list").scrollTop = 0; $("#hx-list").focus({ preventScroll: true });
  }
  $("#hx-another").addEventListener("click", function () {
    if (worker) { worker.terminate(); worker = null; }
    if (studioWorker) { studioWorker.terminate(); studioWorker = null; }
    selBtn.hidden = true;
    M = null; $("#hx-ws").hidden = true; $("#hx-start").hidden = false; $(".hx-band").hidden = false; html.classList.remove("hx-has-file");
    $("#hx-rows").innerHTML = ""; $("#hx-det").innerHTML = "";
  });

  // ── filters ──
  function visible(it) {
    if (it.out && !M.showOut && !(M.hits && M.hits[it.n])) return false;   // a request where the looked-up value is stays visible
    if (!M.types[it.type]) return false;
    if (!M.hostOn[it.host]) return false;
    if (M.q && it.e.url.toLowerCase().indexOf(M.q) < 0) return false;
    return true;
  }
  function renderTypes() {
    $("#hx-types").innerHTML = HX_TYPES.map(function (t) {
      var all = M.model.items.filter(function (it) { return it.type === t[0]; }), hidden = M.showOut ? 0 : all.filter(function (it) { return it.out; }).length;
      var note = all.length && hidden === all.length ? " · left out" : hidden ? " · " + hidden + " left out" : "";
      return '<button type="button" class="hx-chip" data-type="' + t[0] + '" aria-pressed="' + !!M.types[t[0]] + '" title="' + all.length + " in the file" + (hidden ? ", " + hidden + " left out of the script" : "") + '">' + t[1] + " <i>" + all.length + note + "</i></button>";
    }).join("");
  }
  $("#hx-types").addEventListener("click", function (e) { var c = e.target.closest(".hx-chip"); if (!c) return; M.types[c.dataset.type] = !M.types[c.dataset.type]; renderTypes(); build(); });
  $("#hx-q").addEventListener("input", function (e) { M.q = e.target.value.trim().toLowerCase(); build(); });
  $("#hx-out").addEventListener("change", function (e) { M.showOut = e.target.checked; prefs.showOut = M.showOut; savePrefs(); renderTypes(); build(); });
  $("#hx-mask").addEventListener("change", function (e) { M.mask = e.target.checked; renderDetails(); });

  // ── domains: show or hide the requests of each server (with the address and type filters) ──
  // The host is read from the address by splitting, never with new URL() — addresses may hold {{variables}}.
  function hostOf(url) { var m = /^[a-z][a-z0-9+.-]*:\/\/([^\/?#]+)/i.exec(url || ""); return m ? m[1].replace(/^[^@]*@/, "").toLowerCase() : "(no domain)"; }
  function initDomains() {
    var count = {};
    M.model.items.forEach(function (it) {
      it.host = hostOf(it.e.url);
      var c = count[it.host] || (count[it.host] = { host: it.host, n: 0, inScript: 0 });
      c.n++; if (!it.out) c.inScript++;
    });
    M.hosts = Object.keys(count).map(function (h) { return count[h]; }).sort(function (a, b) { return b.n - a.n || (a.host < b.host ? -1 : 1); });
    M.hostOn = {}; M.hosts.forEach(function (h) { M.hostOn[h.host] = true; });
    $("#hx-dom-q").value = ""; closeDomains();
    renderDomains();
  }
  function renderDomains() {
    var on = M.hosts.filter(function (h) { return M.hostOn[h.host]; }).length, all = M.hosts.length;
    $("#hx-dom-label").textContent = on === all ? "All domains" : on === 0 ? "No domains" : on === 1 ? M.hosts.filter(function (h) { return M.hostOn[h.host]; })[0].host : on + " of " + all + " domains";
    $("#hx-dom-n").textContent = on === all ? " " + all : "";
    $("#hx-dom-btn").setAttribute("aria-pressed", String(on < all));
    $("#hx-dom-sum").textContent = on + " of " + all + " shown";
    var q = $("#hx-dom-q").value.trim().toLowerCase();
    var list = M.hosts.filter(function (h) { return !q || h.host.indexOf(q) >= 0; });
    $("#hx-dom-list").innerHTML = list.length ? list.map(function (h) {
      var note = h.inScript === h.n ? "" : h.inScript ? " · " + (h.n - h.inScript) + " left out" : " · left out";
      return '<div class="hx-dom-row"><label><input type="checkbox" data-host="' + esc(h.host) + '"' + (M.hostOn[h.host] ? " checked" : "") + '><span class="h" title="' + esc(h.host) + '">' + esc(h.host) + '</span><span class="c">' + h.n + note + '</span></label>' +
        '<button type="button" class="hx-dom-only" data-only="' + esc(h.host) + '" title="Show only ' + esc(h.host) + '">Only</button></div>';
    }).join("") : '<p class="hx-dom-none">No domain contains "' + esc(q) + '".</p>';
  }
  function setDomains(fn) { M.hosts.forEach(function (h) { M.hostOn[h.host] = fn(h.host); }); renderDomains(); build(); }
  function openDomains() { $("#hx-dom-pop").hidden = false; $("#hx-dom-btn").setAttribute("aria-expanded", "true"); renderDomains(); $("#hx-dom-q").focus(); }
  function closeDomains(focus) { $("#hx-dom-pop").hidden = true; $("#hx-dom-btn").setAttribute("aria-expanded", "false"); if (focus) $("#hx-dom-btn").focus(); }
  $("#hx-dom-btn").addEventListener("click", function () { if ($("#hx-dom-pop").hidden) openDomains(); else closeDomains(); });
  $("#hx-dom-q").addEventListener("input", renderDomains);
  $("#hx-dom-all").addEventListener("click", function () { setDomains(function () { return true; }); });
  $("#hx-dom-none").addEventListener("click", function () { setDomains(function () { return false; }); });
  $("#hx-dom-list").addEventListener("change", function (e) { var c = e.target.closest("[data-host]"); if (!c) return; M.hostOn[c.dataset.host] = c.checked; renderDomains(); build(); });
  $("#hx-dom-list").addEventListener("click", function (e) { var b = e.target.closest("[data-only]"); if (!b) return; var only = b.dataset.only; setDomains(function (h) { return h === only; }); });
  $("#hx-dom-pop").addEventListener("keydown", function (e) { if (e.key === "Escape") { e.stopPropagation(); closeDomains(true); } });
  // pressing outside closes the list — on pointerdown, before any click redraws what was clicked (a "click" target
  // can already be detached by then, and would look like it was outside)
  document.addEventListener("pointerdown", function (e) { if (!$("#hx-dom-pop").hidden && !e.target.closest("#hx-dom")) closeDomains(); });

  // ── the request list: rows (group headers, requests, "left out" lines), only those on screen are drawn ──
  var H = { grp: 40, req: 46, out: 36 };
  var rows = [], tops = [], total = 0;
  function build() {
    rows = []; tops = []; total = 0;
    var shownN = 0;
    M.model.groups.forEach(function (g, gi) {
      var vis = g.items.filter(visible), out = M.showOut ? [] : g.items.filter(function (it) { return it.out && !visible(it) && M.types[it.type] && M.hostOn[it.host] && (!M.q || it.e.url.toLowerCase().indexOf(M.q) >= 0); });
      if (!vis.length && !out.length) return;
      push({ kind: "grp", g: g, gi: gi, n: vis.length });
      if (M.closed[gi]) return;
      vis.forEach(function (it) { push({ kind: "req", it: it }); shownN++; });
      if (out.length) push({ kind: "out", g: g, items: out });
    });
    $("#hx-vlist").style.height = total + "px";
    $("#hx-count").textContent = shownN + " of " + M.model.items.length;
    $("#hx-empty").hidden = rows.length > 0;
    var allClosed = M.model.groups.every(function (g, gi) { return M.closed[gi]; });
    $("#hx-fold").textContent = allClosed ? "Expand all" : "Collapse all";
    draw(true);
  }
  function push(r) { tops.push(total); total += H[r.kind]; rows.push(r); }
  var drawn = { a: -1, b: -1 };
  function draw(force) {
    var list = $("#hx-list"), top = list.scrollTop, bottom = top + list.clientHeight;
    var lo = 0, hi = rows.length - 1;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (tops[mid] <= top) lo = mid; else hi = mid - 1; }
    var a = Math.max(0, lo - 12), b = a;
    while (b < rows.length && tops[b] < bottom) b++;
    b = Math.min(rows.length, b + 12);
    if (!force && a === drawn.a && b === drawn.b) return;
    drawn = { a: a, b: b };
    var out = [];
    for (var i = a; i < b; i++) out.push(rowHtml(rows[i], tops[i], i));
    $("#hx-rows").innerHTML = out.join("");
  }
  function rowHtml(r, top, i) {
    var st = 'style="top:' + top + 'px"';
    if (r.kind === "grp") {
      var g = r.g, closed = !!M.closed[r.gi];
      var dur = g.items.length ? Math.max.apply(null, g.items.map(function (it) { return it.start + it.dur; })) - g.items[0].start : 0;
      return '<div class="hx-grp' + (g.txn ? "" : " none") + (closed ? " closed" : "") + '" ' + st + ' data-gi="' + r.gi + '" role="button" tabindex="-1" aria-expanded="' + !closed + '">' +
        '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg><span class="bar"></span>' +
        "<b>" + esc(g.txn ? g.name : "Not in a transaction") + '</b><span class="meta">' + r.n + " request" + (r.n === 1 ? "" : "s") + " · " + ms(dur) + "</span></div>";
    }
    if (r.kind === "out") {
      return '<div class="hx-outline" ' + st + ">+ " + r.items.length + " left out — " + esc(hxOutSummary(r.items)) + '<button type="button" data-showout>Show</button></div>';
    }
    var it = r.it, e = it.e, u = split(e.url), sel = M.sel === it && M.view === "req";
    var inv = M.inv, isSrc = inv && inv.src && inv.src.n === it.n, isUse = inv && !isSrc && (inv.src ? inv.later : inv.uses).some(function (x) { return x.n === it.n; });
    return '<div class="hx-req' + (sel ? " sel" : "") + (it.out ? " out" : "") + (isSrc ? " is-src" : isUse ? " is-use" : "") + '" ' + st + ' data-n="' + it.n + '" role="option" aria-selected="' + sel + '">' +
      (isSrc ? '<span class="hx-tag src">comes from</span>' : isUse ? '<span class="hx-tag use">sent</span>' : "") +
      '<span class="num">' + it.n + '</span><span class="hx-meth ' + methodClass(e.method) + '">' + esc(e.method) + "</span>" +
      '<span class="u"><span class="p" title="' + esc(e.url) + '">' + esc(u.path) + '</span><span class="h">' + esc(u.host) + " · " + hxTypeLabel(it.type) + (it.out ? ' · <em>left out</em>' : "") + "</span></span>" +
      '<span class="st s' + String(e.status).charAt(0) + '">' + (e.status || "—") + '</span><span class="sz">' + size(e.size) + '</span><span class="tm">' + ms(it.dur) + "</span>" +
      '<span class="wf"><i style="left:' + (it.start / M.model.end * 100) + "%;width:" + Math.max(0.6, it.dur / M.model.end * 100) + '%"></i></span></div>';
  }
  $("#hx-list").addEventListener("scroll", function () { draw(false); }, { passive: true });
  window.addEventListener("resize", function () { if (M) draw(true); });
  $("#hx-list").addEventListener("click", function (e) {
    var g = e.target.closest(".hx-grp"); if (g) { var gi = +g.dataset.gi; M.closed[gi] = !M.closed[gi]; build(); return; }
    if (e.target.closest("[data-showout]")) { $("#hx-out").checked = true; M.showOut = prefs.showOut = true; savePrefs(); renderTypes(); build(); return; }
    var r = e.target.closest(".hx-req"); if (r) select(+r.dataset.n);
  });
  $("#hx-list").addEventListener("keydown", function (e) {
    if (!M || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    var reqs = []; rows.forEach(function (r, i) { if (r.kind === "req") reqs.push(i); });
    if (!reqs.length) return;
    var at = -1; reqs.forEach(function (ri, k) { if (rows[ri].it === M.sel) at = k; });
    var k = Math.min(reqs.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)));
    select(rows[reqs[k]].it.n, reqs[k]);
  });
  function select(n, rowIndex, tab) {
    M.sel = M.byN[n] || null; M.view = "req"; if (tab) M.tab = tab;
    if (rowIndex == null) rows.forEach(function (r, i) { if (r.kind === "req" && r.it.n === n) rowIndex = i; });
    if (rowIndex != null) {   // keep the row on screen
      var list = $("#hx-list"), t = tops[rowIndex];
      if (t < list.scrollTop) list.scrollTop = t; else if (t + H.req > list.scrollTop + list.clientHeight) list.scrollTop = t + H.req - list.clientHeight;
    }
    draw(true); renderDetails(); findButton();
    var mark = $("#hx-det .hx-hl"); if (mark) mark.scrollIntoView({ block: "center" });   // the looked-up value, on screen
  }
  $("#hx-fold").addEventListener("click", function () {
    var allClosed = M.model.groups.every(function (g, gi) { return M.closed[gi]; });
    M.closed = {}; if (!allClosed) M.model.groups.forEach(function (g, gi) { M.closed[gi] = true; });
    build();
  });

  // drag the divider between the list and the details (remembered)
  (function () {
    // the request list hides to a rail (remembered); one click on the rail brings it back
    var panes = $("#hx-panes");
    function listShown(on) {
      panes.classList.toggle("no-list", !on); prefs.noList = !on; savePrefs();
      if (on) { if (M) draw(true); $("#hx-list").focus(); } else $("#hx-rail").focus();
    }
    panes.classList.toggle("no-list", !!prefs.noList);
    $("#hx-hide").addEventListener("click", function () { listShown(false); });
    $("#hx-rail").addEventListener("click", function () { listShown(true); });
    $("#hx-reqpane .hx-ph").addEventListener("click", function (e) { if (e.target === e.currentTarget || e.target.tagName === "H2") listShown(false); });
    var sp = $("#hx-split"), ws = $("#hx-panes"), on = false;
    if (prefs.listW) ws.style.setProperty("--hx-list-w", prefs.listW + "%");
    sp.addEventListener("pointerdown", function (e) { on = true; sp.setPointerCapture(e.pointerId); });
    sp.addEventListener("pointermove", function (e) {
      if (!on) return;
      var r = ws.getBoundingClientRect(), p = Math.min(70, Math.max(28, (e.clientX - r.left) / r.width * 100));
      ws.style.setProperty("--hx-list-w", p + "%"); prefs.listW = Math.round(p);
    });
    sp.addEventListener("pointerup", function () { if (on) { on = false; savePrefs(); draw(true); } });
    sp.addEventListener("keydown", function (e) {
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      prefs.listW = Math.min(70, Math.max(28, (prefs.listW || 46) + (e.key === "ArrowLeft" ? -2 : 2)));
      ws.style.setProperty("--hx-list-w", prefs.listW + "%"); savePrefs();
    });
  })();

  // ── the looked-up value, marked wherever it appears (every form: as recorded, URL-encoded, JSON-escaped …) ──
  function hl(html) {
    if (!M.inv || !M.inv.forms) return html;
    M.inv.forms.forEach(function (s) {
      var f = esc(s); if (f.length < 3) return;
      html = html.split(f).join("\u0001" + f + "\u0002");
    });
    return html.replace(/\u0001/g, '<mark class="hx-hl">').replace(/\u0002/g, "</mark>");
  }

  // ── request details (portal/request-details.js) ──
  function renderDetails() {
    if (M && M.view === "find") { renderFind(); return; }
    var d = $("#hx-det"), it = M && M.sel;
    if (!it) { d.innerHTML = '<p class="hx-none hx-pick">Click a request to see its headers, payload and response.</p>'; return; }
    d.innerHTML = RD.html({
      n: it.n, e: it.e, raw: it.raw, type: hxTypeLabel(it.type), dur: it.dur, start: it.start, out: it.out, why: it.out ? hxWhy(it) : "",
      tab: M.tab, mask: M.mask, full: M.full, hl: hl,
      top: M.inv ? '<p class="hx-back"><mark class="hx-hl">' + esc(short(M.inv.value, 48)) + '</mark> is marked in this request<button type="button" class="ds-btn ds-btn-sm" data-back>Back to Find a value</button></p>' : "",
    });
  }
  var ICON_COPY = RD.ICON_COPY;
  $("#hx-det").addEventListener("click", function (e) {
    if (e.target.closest("[data-back]")) { M.view = "find"; draw(true); renderFind(); findButton(); return; }
    var go = e.target.closest("[data-go]"); if (go) { e.preventDefault(); select(+go.dataset.go, null, go.dataset.tab); return; }
    var sg = e.target.closest("[data-sugg]"); if (sg) { find(sg.dataset.sugg); return; }
    if (e.target.closest("[data-clear]")) { find(""); return; }
    var t = e.target.closest(".hx-tab"); if (t) { M.tab = t.dataset.tab; M.full = {}; renderDetails(); return; }
    var f = e.target.closest("[data-full]"); if (f) { M.full[f.dataset.full] = true; renderDetails(); return; }
    var c = e.target.closest("[data-copy]"); if (!c || !M.sel) return;
    var txt = RD.copy(M.sel.raw, c.dataset.copy, M.mask, M.sel.e.url);
    var done = function () { toast(c.dataset.copy === "url" ? "Address copied" : "cURL command copied"); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(done, function () { toast("Copying is not allowed here."); });
    else toast("Copying is not allowed here.");
  });

  // ══════════════ FIND A VALUE ══════════════
  // The search runs in a background worker (portal/har-explorer-worker.js), which also runs Script Studio's own
  // analysis for the suggestions; the page draws the answer.
  var worker = null, studioWorker = null, findSeq = 0;
  function startWorker(text) {
    if (worker) worker.terminate();
    if (studioWorker) studioWorker.terminate();
    try { worker = new Worker("portal/har-explorer-worker.js"); } catch (e) { worker = null; return; }
    // Script Studio's own analysis runs in a second copy, so a very large recording never makes Find a value wait
    try {
      studioWorker = new Worker("portal/har-explorer-worker.js");
      studioWorker.onmessage = function (ev) { if (ev.data.type === "studio" && worker) worker.postMessage({ type: "studioList", list: ev.data.list }); studioWorker.terminate(); studioWorker = null; };
      studioWorker.onerror = function () { if (worker) worker.postMessage({ type: "studioList", list: [] }); studioWorker = null; };
      studioWorker.postMessage({ type: "studio", text: text });
    } catch (e) { studioWorker = null; }
    worker.onmessage = function (ev) {
      var d = ev.data;
      if (!M) return;
      if (d.type === "ready") { M.sugg = d.suggestions; M.studioCount = d.studioCount; M.studioDone = d.studioDone || !studioWorker; if (M.view === "find") renderFind(); }
      else if (d.type === "found" && d.id === findSeq) {
        M.inv = d.result; M.hits = null;
        if (M.inv) { M.hits = {}; M.inv.hitNs.forEach(function (n) { M.hits[n] = true; }); }
        build(); renderFind();
      } else if (d.type === "error") { toast("Find a value: " + d.message); }
    };
    worker.onerror = function () { toast("Find a value is not available in this browser."); worker = null; };
    worker.postMessage({ type: "load", text: text, out: M.model.items.filter(function (it) { return it.out; }).map(function (it) { return it.n; }) });
  }
  // ── "Correlate this": the extractor Script Studio would write, and the hand-over ──
  function codeFor(corr, name) {
    var code = M.fmt === "devweb" ? corr.devweb : corr.vugen.replace(/^\t/gm, "");
    if (!code) return "";
    // the name the user typed (the worker wrote the code with the suggested one)
    return name === corr.name ? code : code.split('"' + corr.name + '"').join('"' + name + '"').split("ParamName=" + corr.name + '"').join("ParamName=" + name + '"');
  }
  function corrName(inv) { var a = addedFor(inv.value); return a ? a.name : M.corrName || inv.corr.name; }
  function addedFor(value) { return M.added.filter(function (a) { return a.value === value; })[0] || null; }
  function corrPanel(inv) {
    var c = inv.corr;
    if (c.error) return '<div class="hx-corr"><div class="hx-corr-h"><h3>Correlate this</h3></div><p class="hx-corr-b ds-note warn">' + esc(c.error) + "</p></div>";
    var name = corrName(inv), added = addedFor(inv.value), src = M.byN[inv.src.n];
    var ref = function (n) { return M.fmt === "devweb" ? "${" + n + "}" : "{" + n + "}"; };
    return '<div class="hx-corr"><div class="hx-corr-h"><h3>Correlate this</h3>' +
      '<div class="ds-seg hx-fmt" role="group" aria-label="Script format"><button type="button" data-fmt="webhttp" aria-pressed="' + (M.fmt === "webhttp") + '">VuGen Web HTTP/HTML</button><button type="button" data-fmt="devweb" aria-pressed="' + (M.fmt === "devweb") + '">DevWeb</button></div></div>' +
      '<div class="hx-corr-b">' +
      '<label class="hx-cn"><span>Parameter name</span><input id="hx-cn" value="' + esc(name) + '" spellcheck="false" autocomplete="off"' + (added ? " disabled" : "") + "></label>" +
      '<p class="hx-corr-from">Captured from ' + esc(c.label) + " in " + trailLink(inv.src) + (M.fmt === "devweb" ? " — the extractor goes on that request" : " — registered just before that request") + ".</p>" +
      '<pre class="hx-code hx-corr-code" id="hx-corr-code">' + esc(codeFor(c, name)) + "</pre>" +
      '<p class="hx-corr-from">Then used in:</p><ul class="hx-corr-uses">' + inv.later.map(function (u) { return "<li>" + trailLink(u) + " — " + esc(u.where) + " → <code>" + esc(ref(name)) + "</code></li>"; }).join("") + "</ul>" +
      c.warn.map(function (w) { return '<p class="ds-note warn hx-corr-warn">' + esc(w) + "</p>"; }).join("") +
      '<div class="hx-corr-act">' + (added
        ? '<span class="hx-added">' + ICON_CHECK + "Added — Script Studio gets it when you continue there</span>" + '<button type="button" class="ds-btn ds-btn-sm" data-remove>Remove</button>'
        : '<button type="button" class="ds-btn ds-btn-primary" data-add>' + ICON_CHECK + "Add to Script Studio</button>") +
      '<button type="button" class="ds-btn" data-copycode>' + ICON_COPY + "Copy code</button></div>" +
      "</div></div>";
  }
  var ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  function addedButton() {
    var n = M ? M.added.length : 0, b = $("#hx-studio");
    // nothing added: Studio only opens with this file (you analyse there); with correlations it analyses and applies them
    b.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/></svg>' +
      (n ? 'Continue in Script Studio <span class="hx-count-badge">' + n + " correlation" + (n === 1 ? "" : "s") + "</span>" : "Open in Script Studio");
    b.title = n ? "Script Studio opens this file, analyses it and applies the " + n + " correlation" + (n === 1 ? "" : "s") + " you added here"
      : "Script Studio opens this file — choose the filters there and click Analyse. (Add correlations with Find a value → Correlate this, and Studio applies them for you.)";
  }
  $("#hx-det").addEventListener("click", function (e) {
    if (!M || !M.inv || !M.inv.corr) return;
    var inv = M.inv;
    var f = e.target.closest("[data-fmt]"); if (f) { M.fmt = f.dataset.fmt; renderFind(); return; }
    if (e.target.closest("[data-add]")) {
      var name = String(($("#hx-cn") || {}).value || inv.corr.name).trim().replace(/[^A-Za-z0-9_]/g, "_");
      if (!/^[A-Za-z]/.test(name)) { toast("The parameter name must start with a letter."); return; }
      if (M.added.some(function (a) { return a.name === name; })) { toast("“" + name + "” is already used by another value — choose another name."); return; }
      M.added.push({ value: inv.value, name: name, extractorType: inv.corr.extractorType, extractorConfig: inv.corr.extractorConfig, studioId: inv.corr.studioId, n: inv.src.n, uses: inv.corr.uses || [] });
      M.corrName = ""; addedButton(); renderFind(); toast("“" + name + "” added — continue in Script Studio to build the script with it."); return;
    }
    if (e.target.closest("[data-remove]")) { M.added = M.added.filter(function (a) { return a.value !== inv.value; }); addedButton(); renderFind(); return; }
    if (e.target.closest("[data-copycode]")) {
      var txt = $("#hx-corr-code").textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { toast("Code copied"); }, function () { toast("Copying is not allowed here."); });
      else toast("Copying is not allowed here.");
    }
  });
  $("#hx-det").addEventListener("input", function (e) {
    if (e.target.id !== "hx-cn" || !M.inv || !M.inv.corr) return;
    M.corrName = e.target.value.trim().replace(/[^A-Za-z0-9_]/g, "_");
    var name = M.corrName || M.inv.corr.name;
    $("#hx-corr-code").textContent = codeFor(M.inv.corr, name);
    var ref = M.fmt === "devweb" ? "${" + name + "}" : "{" + name + "}";
    Array.prototype.forEach.call(document.querySelectorAll(".hx-corr-uses code"), function (c) { c.textContent = ref; });
  });

  // Continue in Script Studio: the same file, the format chosen here, and the correlations added here — accepted
  // (Studio's own advisorAddManual + advisorApplyAndRegen), marked "From HAR Explorer"
  $("#hx-studio").addEventListener("click", function () {
    var shell = null;
    try { shell = window.parent !== window && window.parent.PerfxShell ? window.parent : null; } catch (e) { shell = null; }
    if (!shell || !M.file) { toast("Open the HAR Explorer from the portal to continue in Script Studio."); return; }
    var file = M.file, list = M.added.slice(), fmt = M.fmt;
    shell.PerfxShell.go("studio");
    var w = null;
    function frame() { var f = shell.document.getElementById("iframe-studio"); return f && f.contentWindow; }
    function st() { return w.PerfxStudio.state(); }   // Studio's S (a const there — published by studio-page.js)
    function later(test, then, max) {
      var t = 0; (function poll() { var ok = false; try { ok = test(); } catch (e) { ok = false; } if (ok) then(); else if (++t < (max || 150)) setTimeout(poll, 100); })();
    }
    later(function () { w = frame(); return w && w.document.readyState === "complete" && typeof w.loadFile === "function" && w.PerfxStudio && w.document.getElementById("dz1"); }, function () {
      try { if (typeof w.clearAll === "function") w.clearAll(); if (typeof w.goBack === "function") w.goBack(); } catch (e) { /* a fresh Studio */ }
      try { if (typeof w.setFmt === "function") w.setFmt(fmt); } catch (e) { /* Studio keeps its own format */ }
      w.loadFile(file, 1);
      if (!list.length) {
        if (typeof w.showToast === "function") w.showToast(file.name + " opened from the HAR Explorer — choose the format and filters, then click Analyse.", "info");
        return;
      }
      later(function () { return st().har1; }, function () {
        Promise.resolve(w.analyze()).then(function () {
          // a recording with background traffic stops at Studio's review first — add the correlations after it
          later(function () {
            var bg = w.document.getElementById("bgReviewPanel");
            return w.document.getElementById("ph-res").classList.contains("active") && !(bg && bg.style.display !== "none" && bg.offsetParent !== null) && st().entries1 && st().entries1.length;
          }, function () {
            // Studio's list has transaction markers in it (CDP pages, a repaired START): find each request by its id
            var at = function (id) { var es = st().entries1; for (var i = 0; i < es.length; i++) if (!es[i].isMarker && es[i].id === id) return i; return -1; };
            list.forEach(function (a) {
              var src = at(a.studioId); if (src < 0) return;
              var cand = w.advisorAddManual(src, "boundary", "", a.name, a.value);
              cand._explorer = { extractorType: a.extractorType, extractorConfig: a.extractorConfig };
              // the uses the Explorer found that Studio's own search did not (e.g. a URL-encoded form value)
              a.uses.forEach(function (u) {
                var ui = at(u.id); if (ui < 0) return;
                var known = cand.usages.some(function (k) { return k.entryIdx === ui && k.location === u.location && (k.jsonPath || null) === u.jsonPath; });
                if (!known) cand.usages.push({ entryIdx: ui, url: "", location: u.location, jsonPath: u.jsonPath });
              });
            });
            if (typeof w.renderAdvisorPanel === "function") w.renderAdvisorPanel();
            w.advisorApplyAndRegen();
            if (typeof w.showToast === "function") w.showToast(list.length + " correlation" + (list.length === 1 ? "" : "s") + " from the HAR Explorer added and applied.", "success");
          }, 6000);
        });
      }, 300);
    }, 300);
  });

  function find(value) {
    M.find = (value || "").trim(); M.view = "find"; M.corrName = "";
    if (!M.find) { findSeq++; M.inv = null; M.hits = null; build(); renderFind(); return; }
    if (!worker) { toast("Find a value is not available in this browser."); return; }
    worker.postMessage({ type: "find", id: ++findSeq, value: M.find });
    renderFind(true);
  }
  function findButton() { $("#hx-findbtn").setAttribute("aria-pressed", String(!!M && M.view === "find")); }
  $("#hx-findbtn").addEventListener("click", function () {
    if (M.view === "find") { if (!M.sel) M.sel = M.model.items.filter(visible)[0] || null; M.view = "req"; }
    else M.view = "find";
    draw(true); renderDetails(); findButton();
  });

  var VERDICT = {
    correlate: ["ok", "Correlate it", function (i) { return "The server sends it in <b>#" + i.src.n + "</b> and the journey sends it back <b>" + i.later.length + "</b> time" + (i.later.length === 1 ? "" : "s") + ". Every virtual user gets a different value — capture it at #" + i.src.n + " and use it in the requests below."; }],
    cookie: ["plain", "Nothing to do — it travels in cookies only", function (i) { return "Set by the server in #" + i.src.n + " and only sent back as a cookie. VuGen and DevWeb keep cookies by themselves."; }],
    redirect: ["plain", "Nothing to do — a redirect the script follows", function (i) { return "#" + i.src.n + " redirects to it and the next request only follows that redirect, as VuGen and DevWeb do by themselves."; }],
    outonly: ["plain", "Nothing to do — only sent to requests left out of the script", function (i) { return "Every request that sends it back is left out of the script (analytics, static files …), so the script never needs it."; }],
    unused: ["plain", "Never sent back", function (i) { return i.src ? "The server returns it, but no later request sends it — nothing to correlate." : "It is in the recording, but no request sends it."; }],
    missing: ["warn", "Its source is not in this recording", function (i) { return "No response in this HAR contains it — but <b>" + i.missing + "</b> earlier response" + (i.missing === 1 ? " has" : "s have") + " no body in the file (the browser kept no copy, for example because it served the page from its cache), so it probably comes from one of those. Without that response there is nothing to capture it from, so <b>Correlate this</b> cannot be offered. Record the journey again with DevTools “Disable cache” ticked, or with the PerfX CDP Recorder, and look it up again."; }],
    input: ["param", "A value typed in the journey — make it a parameter", function () { return "It never comes back from the server before it is sent: the user typed or chose it (a user name, a search term …). Give it a parameter with test data, so each virtual user can use a different one."; }],
    generated: ["param", "Made by the browser — generate it in the script", function () { return "It never comes from the server and looks like a time stamp or a GUID created by the page's JavaScript. Generate a new one in the script (VuGen: lr_save_timestamp / lr_generate_uuid; DevWeb: Date.now() / a uuid function)."; }],
    none: ["plain", "Not found in this recording", function () { return "Check the spelling, or try a shorter part of the value."; }],
  };
  function tabFor(h) { return h.side === "res" ? (h.header ? "headers" : "response") : h.kind === "body" || /^query/.test(h.where) ? "payload" : h.kind === "cookie" ? "cookies" : "headers"; }
  function trailLink(h) {
    var it = M.byN[h.n], e = it ? it.e : { method: "", url: "" };
    return '<a href="#" data-go="' + h.n + '" data-tab="' + tabFor(h) + '">#' + h.n + " " + esc(e.method) + " " + esc(split(e.url).path) + "</a>";
  }
  function renderFind(busy) {
    var d = $("#hx-det"), inv = M.inv, v = M.find;
    var input = $("#hx-fq"), caret = input && document.activeElement === input ? input.selectionStart : null;
    var sugg = M.sugg === null ? '<p class="hx-sugg-wait">Looking for values that change…</p>'
      : M.sugg.length ? '<div class="hx-sugg" aria-label="Values the server sends that a later request sends back">' + M.sugg.map(function (s) {
          return '<button type="button" data-sugg="' + esc(s.value) + '" title="' + esc(s.value) + (s.by === "studio" ? " — Script Studio finds this one too" : " — Script Studio does not find this one by itself") + '"' + (s.value === v ? ' aria-pressed="true"' : "") + ">" +
            (s.by === "studio" ? '<span class="by">Studio</span>' : "") + "<b>" + esc(short(s.name, 24)) + "</b><code>" + esc(short(s.value, 22)) + "</code></button>";
        }).join("") + "</div>"
      : '<p class="hx-sugg-wait">No value in this recording comes back from the server and is sent again.</p>';
    if (M.sugg !== null && !M.studioDone) sugg += '<p class="hx-sugg-wait">Script Studio\'s own analysis is still running — its findings will be added here.</p>';
    var body = "";
    if (!v) body = '<p class="ds-note hx-hint">Type or paste a value above, pick one the server sends (Studio marks the ones Script Studio finds by itself), or select any value in a request\'s Headers, Payload or Response.</p>';
    else if (busy || !inv || inv.value !== v) body = '<p class="hx-none">Looking for ' + esc(short(v, 60)) + " …</p>";
    else {
      var V = VERDICT[inv.kind];
      body += '<div class="hx-verdict ' + V[0] + '"><div><h3>' + V[1] + "</h3><p>" + V[2](inv) + "</p>" +
        (inv.kind === "correlate" ? '<p class="hx-studio">' + (inv.studio ? "Script Studio correlates this one by itself." : "Script Studio does not find this one by itself — add it there with <b>Paste &amp; Detect</b> or <b>Add Manual</b>.") + "</p>" : "") + "</div></div>";
      var steps = [];
      if (inv.src) steps.push('<li class="from"><span class="hx-badge src">Comes from</span><span>' + trailLink(inv.src) + '<span class="wh">' + esc(inv.src.where) + (inv.src.enc ? ' · <span class="hx-badge enc">' + esc(inv.src.enc) + "</span>" : "") + "</span></span></li>");
      (inv.src ? inv.later : inv.uses).forEach(function (u) {
        steps.push('<li><span class="hx-badge use">Sent in</span><span>' + trailLink(u) + '<span class="wh">' + esc(u.where) + (u.enc ? ' · <span class="hx-badge enc">sent ' + esc(u.enc) + "</span>" : "") + "</span></span></li>");
      });
      if (steps.length) body += '<ol class="hx-trail">' + steps.join("") + "</ol>";
      var aside = [];
      if (inv.outsideCount) aside.push("sent to " + inv.outsideCount + " request" + (inv.outsideCount === 1 ? "" : "s") + " left out of the script (" + inv.outside.slice(0, 6).map(function (o) { return trailLink(o).replace(/>#(\d+)[^<]*</, ">#$1<"); }).join(", ") + (inv.outsideCount > 6 ? " …" : "") + ")");
      if (inv.referer) aside.push("in the Referer / Origin header of " + inv.referer + " request" + (inv.referer === 1 ? "" : "s") + " — the page address, which the script copies as it is");
      if (aside.length) body += '<p class="hx-also">Also ' + aside.join("; and ") + ". Not counted above.</p>";
      if (inv.also.length) body += '<p class="hx-also">Also returned later by ' + inv.also.map(function (o) { return trailLink(o).replace(/>#(\d+)[^<]*</, ">#$1<") + " (" + esc(o.where) + ")"; }).join(", ") + " — the first one is the one to capture.</p>";
      if (inv.corr) body += corrPanel(inv);
    }
    d.innerHTML = '<div class="hx-dh hx-fh"><h2>Find a value</h2>' +
      "<p>Where it first came from, every request that sends it back, and what to do in the script. URL-encoded, JSON-escaped, Base64 and HTML-entity forms are found too.</p>" +
      '<div class="hx-fin"><label class="hx-search"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>' +
      '<input id="hx-fq" type="search" value="' + esc(v) + '" placeholder="e.g. a session id, a token, an order number" aria-label="Value to find" autocomplete="off" spellcheck="false"></label>' +
      (v ? '<button type="button" class="ds-btn ds-btn-sm" data-clear>Clear</button>' : "") + "</div>" + sugg + "</div>" +
      '<div class="hx-db">' + body + "</div>";
    var inp = $("#hx-fq");
    if (caret != null) { inp.focus(); inp.setSelectionRange(caret, caret); }
    findButton();
  }
  var findTimer;
  $("#hx-det").addEventListener("input", function (e) {
    if (e.target.id !== "hx-fq") return;
    var v = e.target.value; clearTimeout(findTimer);
    findTimer = setTimeout(function () { find(v); }, 300);
  });
  $("#hx-det").addEventListener("keydown", function (e) { if (e.target.id === "hx-fq" && e.key === "Enter") { clearTimeout(findTimer); find(e.target.value); } });

  // select a value in a request → "Find where this value comes from"
  var selBtn = document.createElement("button");
  selBtn.type = "button"; selBtn.className = "hx-selbtn"; selBtn.hidden = true;
  selBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1" fill="currentColor"/></svg>Find where this value comes from';
  document.body.appendChild(selBtn);
  document.addEventListener("mouseup", function (e) {
    if (e.target === selBtn || selBtn.contains(e.target)) return;
    setTimeout(function () {
      var s = window.getSelection(), txt = s ? s.toString().trim() : "";
      var inDetails = M && M.view === "req" && s && s.rangeCount && $("#hx-det .hx-db") && $("#hx-det .hx-db").contains(s.anchorNode);
      if (!inDetails || txt.length < 3 || txt.length > 2000 || /\n/.test(txt)) { selBtn.hidden = true; return; }
      var rc = s.getRangeAt(0).getBoundingClientRect();
      selBtn.style.left = Math.min(window.innerWidth - 290, Math.max(8, rc.left)) + "px";
      selBtn.style.top = Math.max(8, rc.top - 40) + "px";
      selBtn.dataset.v = txt; selBtn.hidden = false;
    }, 0);
  });
  selBtn.addEventListener("click", function () { selBtn.hidden = true; window.getSelection().removeAllRanges(); find(selBtn.dataset.v); });
  document.addEventListener("scroll", function () { selBtn.hidden = true; }, true);
})();
