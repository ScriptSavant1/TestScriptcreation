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
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function short(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function size(n) { return n == null || n < 0 ? "—" : n < 1024 ? n + " B" : n < 1048576 ? (n / 1024).toFixed(1) + " KB" : (n / 1048576).toFixed(1) + " MB"; }
  function ms(n) { return n < 1000 ? Math.round(n) + " ms" : (n / 1000).toFixed(2) + " s"; }
  function split(url) { var m = /^([a-z][a-z0-9+.-]*:\/\/)([^/?#]*)(.*)$/i.exec(url || ""); return m ? { host: m[2], path: m[3] || "/" } : { host: "", path: url || "" }; }
  var SECRET = /^(authorization|proxy-authorization|cookie|set-cookie|x-xsrf-token|x-csrf-token|dpop)$|pass(word)?|secret|token|session|csrf|xsrf/i;
  function shown(name, value) { return M.mask && SECRET.test(name) ? "••••••" : value; }
  function methodClass(m) { return { GET: "get", POST: "post", PUT: "put", PATCH: "put", DELETE: "del" }[m] || "oth"; }

  // decoded response / request text (HAR bodies can be Base64)
  function bodyText(c) {
    if (!c || c.text == null) return null;
    if (c.encoding === "base64" && !/^image\//i.test(c.mimeType || "")) {
      try { var b = atob(c.text), a = new Uint8Array(b.length); for (var i = 0; i < b.length; i++) a[i] = b.charCodeAt(i); return new TextDecoder().decode(a); } catch (e) { return c.text; }
    }
    return c.text;
  }
  var BIG = 300000;   // characters drawn before "Show all"
  var PREVIEW_CSP = "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:\">";
  function codeBlock(text, mime, key) {
    var full = M.full[key], t = text, cut = !full && t.length > BIG;
    if (cut) t = t.slice(0, BIG);
    var out = '<pre class="hx-code">' + hl(pretty(t, mime)) + "</pre>";
    if (cut) out += '<button class="ds-btn ds-btn-sm hx-more" data-full="' + key + '">Show all (' + size(text.length) + ")</button>";
    return out;
  }
  function pretty(text, mime) {
    if (/json/i.test(mime || "") || /^\s*[{[]/.test(text)) {
      try {
        return esc(JSON.stringify(JSON.parse(text), null, 2)).replace(/(&quot;(?:[^&]|&(?!quot;))*?&quot;)(\s*:)?|\b(true|false|null)\b|(-?\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b)/g, function (m, str, colon, kw, num) {
          return str ? '<span class="' + (colon ? "k" : "s") + '">' + str + "</span>" + (colon || "") : kw ? '<span class="t">' + kw + "</span>" : '<span class="n">' + num + "</span>";
        });
      } catch (e) { /* not JSON */ }
    }
    return esc(text);
  }

  // ── state ──
  var M = null;   // { name, size, model, rows, sel, tab, closed, types, q, showOut, mask, full }

  // ── loading ──
  var input = $("#hx-file"), pick = $("#hx-pick"), drop = $("#hx-drop");
  function take(file) {
    if (!file) return;
    if (!/\.(har|json)$/i.test(file.name)) { toast(file.name + " is not a .har file."); return; }
    $("#hx-drop-busy").textContent = "Reading " + file.name + " …"; drop.classList.add("busy");
    var rd = new FileReader();
    rd.onerror = function () { drop.classList.remove("busy"); toast("The file could not be read."); };
    rd.onload = function () {
      setTimeout(function () {   // let "Reading …" show before the work starts
        var har;
        try { har = JSON.parse(rd.result); } catch (e) { drop.classList.remove("busy"); toast(file.name + " is not a valid HAR file (it is not JSON)."); return; }
        if (!har || !har.log || !Array.isArray(har.log.entries)) { drop.classList.remove("busy"); toast(file.name + " is not a HAR file — it has no list of requests (log.entries)."); return; }
        try { open(file.name, file.size, har, rd.result); M.file = file; } catch (e) { toast("The file could not be opened: " + e.message); }
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

  // ── the request list: rows (group headers, requests, "left out" lines), only those on screen are drawn ──
  var H = { grp: 40, req: 46, out: 36 };
  var rows = [], tops = [], total = 0;
  function build() {
    rows = []; tops = []; total = 0;
    var shownN = 0;
    M.model.groups.forEach(function (g, gi) {
      var vis = g.items.filter(visible), out = M.showOut ? [] : g.items.filter(function (it) { return it.out && !visible(it) && M.types[it.type] && (!M.q || it.e.url.toLowerCase().indexOf(M.q) >= 0); });
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

  // ── request details ──
  function kv(list, empty) {
    if (!list || !list.length) return '<p class="hx-none">' + (empty || "None") + "</p>";
    return '<table class="hx-kv">' + list.map(function (h) {
      return "<tr" + (M.mask && SECRET.test(h.name) ? ' class="secret"' : "") + "><td>" + esc(h.name) + "</td><td>" + hl(esc(shown(h.name, h.value))) + "</td></tr>";
    }).join("") + "</table>";
  }
  function sec(title, inner, right, closed) {
    return '<details class="hx-sec"' + (closed ? "" : " open") + '><summary><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
      title + (right ? '<span class="r">' + right + "</span>" : "") + "</summary>" + inner + "</details>";
  }
  function count(n) { return ' <span class="c">' + n + "</span>"; }
  function queryOf(rq) {
    if (rq.queryString && rq.queryString.length) return rq.queryString;
    var q = (rq.url || "").split("?")[1]; if (!q) return [];
    return q.split("#")[0].split("&").filter(Boolean).map(function (p) { var i = p.indexOf("="); return { name: decode(i < 0 ? p : p.slice(0, i)), value: i < 0 ? "" : p.slice(i + 1) }; });
  }
  function decode(s) { try { return decodeURIComponent(String(s).replace(/\+/g, " ")); } catch (e) { return s; } }
  function cookiesOf(list, headers, setCookie) {
    if (list && list.length) return list;
    var out = [];
    (headers || []).forEach(function (h) {
      if (setCookie ? !/^set-cookie$/i.test(h.name) : !/^cookie$/i.test(h.name)) return;
      (setCookie ? h.value.split(/\n/) : h.value.split(/;\s*/)).forEach(function (c) { var i = c.indexOf("="); if (i > 0) out.push({ name: c.slice(0, i).trim(), value: setCookie ? c.slice(i + 1).split(";")[0] : c.slice(i + 1) }); });
    });
    return out;
  }
  function maskBody(text) {
    return text.replace(/("(?:password|pass|pwd|secret|token|access_token|refresh_token|id_token|client_secret|_csrf)"\s*:\s*)"[^"]*"/gi, '$1"••••••"').replace(/((?:^|&)(?:password|pass|pwd|_csrf|token|client_secret)=)[^&]*/gi, "$1••••••");
  }

  function renderDetails() {
    if (M && M.view === "find") { renderFind(); return; }
    var d = $("#hx-det"), it = M && M.sel;
    if (!it) { d.innerHTML = '<p class="hx-none hx-pick">Click a request to see its headers, payload and response.</p>'; return; }
    var e = it.e, raw = it.raw || {}, rq = raw.request || {}, rs = raw.response || {}, content = rs.content || {}, pd = rq.postData;
    var body = bodyText(content), reqH = rq.headers || [], resH = rs.headers || [], query = queryOf(rq);
    var reqC = cookiesOf(rq.cookies, reqH, false), resC = cookiesOf(rs.cookies, resH, true);
    var tabs = [["headers", "Headers", reqH.length + resH.length], ["payload", "Payload", query.length + (pd ? 1 : 0)], ["response", "Response"], ["preview", "Preview"], ["cookies", "Cookies", reqC.length + resC.length], ["timing", "Timing"]];
    var h = "", mime = content.mimeType || "";
    if (M.tab === "headers") {
      var gen = [{ name: "Request URL", value: e.url }, { name: "Request method", value: e.method }, { name: "Status code", value: (rs.status || "—") + " " + (rs.statusText || "") }, { name: "HTTP version", value: rs.httpVersion || rq.httpVersion || "" }];
      if (rs.redirectURL) gen.push({ name: "Redirects to", value: rs.redirectURL });
      h += sec("General", kv(gen));
      h += sec("Response headers" + count(resH.length), kv(resH));
      h += sec("Request headers" + count(reqH.length), kv(reqH));
    } else if (M.tab === "payload") {
      if (query.length) h += sec("Query string parameters" + count(query.length), kv(query.map(function (p) { var v = p.value, dv = decode(v); return { name: p.name, value: dv !== v ? v + "    (decoded: " + dv + ")" : v }; })));
      if (pd) {
        var params = pd.params || [];
        if (params.length) h += sec("Form data" + count(params.length), kv(params.map(function (p) { return { name: p.name, value: p.value != null ? p.value : (p.fileName ? "[file " + p.fileName + "]" : "") }; })), '<span class="mono">' + esc(pd.mimeType || "") + "</span>");
        if (pd.text) h += sec(params.length ? "Raw body" : "Request body", codeBlock(M.mask ? maskBody(pd.text) : pd.text, pd.mimeType, "req"), '<span class="mono">' + esc(pd.mimeType || "") + " · " + size(pd.text.length) + "</span>", params.length > 0);
      }
      if (!h) h = '<p class="hx-none">This request sends no query string and no body.</p>';
    } else if (M.tab === "response") {
      if (/^image\//i.test(mime) && content.text) h = '<p class="hx-none">An image — see Preview.</p>';
      else if (body == null || body === "") h = '<p class="hx-none">' + (rs.status >= 300 && rs.status < 400 ? "A redirect has no body — see “Redirects to” under Headers." : "No response body in this HAR — the response was empty, or the browser did not keep it (for example, served from its cache).") + "</p>";
      else h = sec("Response body", codeBlock(M.mask ? maskBody(body) : body, mime, "res"), '<span class="mono">' + esc(mime) + " · " + size(body.length) + "</span>");
    } else if (M.tab === "preview") {
      if (/^image\//i.test(mime) && content.text && content.encoding === "base64") h = '<div class="hx-sec hx-img"><img alt="The response image" src="data:' + esc(mime) + ";base64," + esc(content.text) + '"></div>';
      else if (/^image\/svg/i.test(mime) && body) h = '<div class="hx-sec hx-img"><img alt="The response image" src="data:image/svg+xml;charset=utf-8,' + encodeURIComponent(body) + '"></div>';
      // nothing may leave the PC: no scripts (sandbox) and no images, styles or fonts fetched from the site (CSP)
      else if (/html/i.test(mime) && body) h = sec("Page preview — scripts, links and the site's images switched off", '<iframe class="hx-frame" sandbox="" srcdoc="' + esc(PREVIEW_CSP + body) + '" title="Page preview"></iframe>');
      else if (body && /json/i.test(mime)) h = sec("JSON", codeBlock(M.mask ? maskBody(body) : body, mime, "res"));
      else if (!body && /html|json|image/i.test(mime)) h = '<p class="hx-none">Nothing to preview — this HAR does not contain the response body (the browser did not keep it, for example because it came from its cache).</p>';
      else h = '<p class="hx-none">Nothing to preview for this response.</p>';
    } else if (M.tab === "cookies") {
      h += sec("Request cookies" + count(reqC.length), kv(reqC, "No cookies sent"));
      h += sec("Response cookies (Set-Cookie)" + count(resC.length), kv(resC.map(function (c) { return { name: c.name, value: c.value + (c.httpOnly ? " · HttpOnly" : "") + (c.secure ? " · Secure" : "") }; }), "No cookies set"));
      h += '<p class="ds-note hx-hint">VuGen and DevWeb keep cookies between requests by themselves — a value that only travels in cookies needs no correlation.</p>';
    } else if (M.tab === "timing") {
      var t = raw.timings || {}, parts = [["blocked", "Queued / blocked"], ["dns", "DNS lookup"], ["connect", "Initial connection"], ["ssl", "TLS handshake"], ["send", "Request sent"], ["wait", "Waiting for the server (TTFB)"], ["receive", "Content download"]];
      var sum = 0; parts.forEach(function (p) { sum += Math.max(0, t[p[0]] || 0); }); sum = Math.max(sum, 1);
      var acc = 0;
      h = sec("Timing — " + ms(it.dur), '<div class="hx-tl">' + parts.map(function (p, i) {
        var v = Math.max(0, t[p[0]] || 0), bar = v ? '<i class="c' + i + '" style="left:' + (acc / sum * 100) + "%;width:" + Math.max(0.8, v / sum * 100) + '%"></i>' : "";
        acc += v; return '<div class="row"><span>' + p[1] + '</span><span class="bar">' + bar + '</span><span class="v">' + (t[p[0]] == null || t[p[0]] < 0 ? "—" : ms(v)) + "</span></div>";
      }).join("") + '<div class="row"><span>Started at</span><span></span><span class="v">+' + ms(it.start) + "</span></div></div>");
      h += '<p class="ds-note hx-hint">Under load, <b>Waiting for the server (TTFB)</b> is the part that grows — it is the server\'s own time. DNS, connection and TLS happen once per new connection.</p>';
    }
    d.innerHTML = '<div class="hx-dh">' +
      (M.inv ? '<p class="hx-back"><mark class="hx-hl">' + esc(short(M.inv.value, 48)) + '</mark> is marked in this request<button type="button" class="ds-btn ds-btn-sm" data-back>Back to Find a value</button></p>' : "") +
      '<div class="hx-durl"><span class="hx-meth ' + methodClass(e.method) + '">' + esc(e.method) + "</span><code>" + hl(esc(e.url)) + "</code></div>" +
      '<div class="hx-dsum"><span>#<b>' + it.n + '</b></span><span>Status <b class="st s' + String(e.status).charAt(0) + '">' + (rs.status || "—") + " " + esc(rs.statusText || "") + "</b></span><span>Type <b>" + hxTypeLabel(it.type) + "</b></span><span>Size <b>" + size(e.size) + "</b></span><span>Time <b>" + ms(it.dur) + "</b></span>" +
      '<span class="r"><button type="button" class="ds-btn ds-btn-sm ds-btn-ghost" data-copy="url">' + ICON_COPY + 'Copy URL</button><button type="button" class="ds-btn ds-btn-sm ds-btn-ghost" data-copy="curl">' + ICON_COPY + "Copy as cURL</button></span></div>" +
      (it.out ? '<p class="hx-why"><b>Left out of the script:</b> ' + esc(hxWhy(it)) + "</p>" : "") +
      '<div class="hx-tabs" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="hx-tab" data-tab="' + t[0] + '" aria-selected="' + (M.tab === t[0]) + '">' + t[1] + (t[2] ? "<i>" + t[2] + "</i>" : "") + "</button>"; }).join("") + "</div></div>" +
      '<div class="hx-db">' + h + "</div>";
  }
  var ICON_COPY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
  $("#hx-det").addEventListener("click", function (e) {
    if (e.target.closest("[data-back]")) { M.view = "find"; draw(true); renderFind(); findButton(); return; }
    var go = e.target.closest("[data-go]"); if (go) { e.preventDefault(); select(+go.dataset.go, null, go.dataset.tab); return; }
    var sg = e.target.closest("[data-sugg]"); if (sg) { find(sg.dataset.sugg); return; }
    if (e.target.closest("[data-clear]")) { find(""); return; }
    var t = e.target.closest(".hx-tab"); if (t) { M.tab = t.dataset.tab; M.full = {}; renderDetails(); return; }
    var f = e.target.closest("[data-full]"); if (f) { M.full[f.dataset.full] = true; renderDetails(); return; }
    var c = e.target.closest("[data-copy]"); if (!c || !M.sel) return;
    var rq = M.sel.raw.request || {}, txt;
    if (c.dataset.copy === "url") txt = rq.url || M.sel.e.url;
    else {
      var q = function (s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; };
      txt = "curl -X " + (rq.method || "GET") + " " + q(rq.url) + (rq.headers || []).filter(function (h) { return h.name.charAt(0) !== ":"; }).map(function (h) { return " \\\n  -H " + q(h.name + ": " + shown(h.name, h.value)); }).join("") +
        (rq.postData && rq.postData.text ? " \\\n  --data-raw " + q(M.mask ? maskBody(rq.postData.text) : rq.postData.text) : "");
    }
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
      M.added.push({ value: inv.value, name: name, extractorType: inv.corr.extractorType, extractorConfig: inv.corr.extractorConfig, si: inv.corr.studioIdx, n: inv.src.n, uses: inv.corr.uses || [] });
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
            list.forEach(function (a) {
              var cand = w.advisorAddManual(a.si, "boundary", "", a.name, a.value);
              cand._explorer = { extractorType: a.extractorType, extractorConfig: a.extractorConfig };
              // the uses the Explorer found that Studio's own search did not (e.g. a URL-encoded form value)
              a.uses.forEach(function (u) {
                var known = cand.usages.some(function (k) { return k.entryIdx === u.si && k.location === u.location && (k.jsonPath || null) === u.jsonPath; });
                if (!known) cand.usages.push({ entryIdx: u.si, url: "", location: u.location, jsonPath: u.jsonPath });
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
