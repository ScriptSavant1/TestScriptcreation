/* Script Studio workspace — the filter bar, Domains, Requests and the user's transactions (window.SSW).
 * Every choice goes through the engine's own state and functions (S.filterResourceTypes via studioToggleRt,
 * S.filterDomains via studioToggleDomain, S.leaveOut, S.bgDecisions), then the recording is read again with
 * analyze() — the same path as before, so the script is what Studio has always written for those choices.
 * Transactions made here are kept as operations by request id (portal/studio-txn.js) and applied again after each
 * reading (studioAfterMarkers, called by analyze()).
 * Remembered per browser (SS.prefs, "perfx-studio-ui"): hidden panels, panel widths, Show left-out, filters folded. */
(function () {
  "use strict";
  var SS = window.SS, $ = SS.$, $$ = SS.$$, esc = SS.esc, plural = SS.plural, prefs = SS.prefs;

  var W = { log: [], sel: new Set(), last: null, folded: {}, openOut: {}, q: "", rows: [], cur: null };

  // ── the user's transactions, applied again on every reading (called by analyze() after detectMarkers) ──
  window.studioAfterMarkers = function (entries) {
    if (!W.log.length) return;
    W.log = StudioTxn.replay(entries, W.log);
    S.txns = StudioTxn.names(entries).map(function (n) { return { name: n }; });
  };

  function newFile() {
    W.log = []; W.sel = new Set(); W.last = null; W.folded = {}; W.openOut = {}; W.q = ""; W.cur = null;
    S.leaveOut = { ads: true, options: true };
    var q = $("#ss-q"); if (q) q.value = "";
    var d = $("#ss-dq"); if (d) d.value = "";
  }

  // ── read the recording again after a change. Correlations applied in the Advisor do not survive a new reading
  //    (the Advisor scans again), so the user is asked first. ──
  function applied() { return (S.advisorCandidates || []).filter(function (c) { return c._applied; }).length; }
  function change(fn) {
    var n = applied();
    var go = function () { fn(); again(); };
    if (!n) { go(); return; }
    SS.ask("Read the recording again?", "This change reads the recording again and the Correlation Advisor scans it again: the " +
      plural(n, "correlation") + " you applied are taken off. The Advisor suggests its own ones again; ones you added yourself (Paste & Detect, Add Manual) need adding again.", "Continue", go);
  }
  var tAgain = null;
  function again() { clearTimeout(tAgain); tAgain = setTimeout(function () { tAgain = null; if (S.har1) window.analyze(); }, 120); }
  SS.cancelAgain = function () { clearTimeout(tAgain); tAgain = null; };

  // ── filter bar: types ──
  function rules() { return { STATIC_CT: STATIC_CT, STATIC_EXT: STATIC_EXT, NOISY: NOISY, NOISY_URL: typeof NOISY_URL !== "undefined" ? NOISY_URL : null }; }
  function reqs() { return (S.entries1 || []).filter(function (e) { return !e.isMarker; }); }
  function typeOn(k) { var s = S.filterResourceTypes; return !(s instanceof Set) || s.has(k); }
  function renderTypes() {
    var counts = {}, r = rules();
    reqs().forEach(function (e) { var k = RequestFilter.typeKey(e, r); counts[k] = (counts[k] || 0) + 1; });
    $("#ss-types").innerHTML = STUDIO_RT_TYPES.map(function (t) {
      return '<button class="ss-chip" type="button" data-type="' + t.key + '" aria-pressed="' + typeOn(t.key) + '" style="--k:' + t.color + '" title="' +
        (typeOn(t.key) ? "In the script — click to leave " + t.label + " out" : "Left out — click to put " + t.label + " in the script") + '">' +
        '<span class="ss-dot"></span>' + esc(t.label) + ' <span class="ss-n">' + (counts[t.key] || 0) + "</span></button>";
    }).join("");
    // what is left out by itself (counted whichever way the chips are)
    var base = { rules: r, noise: true, options: true, typeOff: new Set(), domainOff: {}, prefetchDup: new Set() };
    var ads = 0, opt = 0;
    reqs().forEach(function (e) { var w = RequestFilter.leftOut(e, base); if (w === "ads") ads++; else if (w === "options") opt++; });
    $("#ss-n-ads").textContent = ads; $("#ss-n-opt").textContent = opt;
    $$("[data-leave]").forEach(function (b) { var k = b.getAttribute("data-leave"); b.setAttribute("aria-pressed", String(!(S.leaveOut && S.leaveOut[k] === false))); });
    var bg = (SS.bgSummary || []).length, bb = $("#ss-bg-btn");
    bb.hidden = !bg; $("#ss-n-bg").textContent = bg;
    var inc = S.bgDecisions ? Array.from(S.bgDecisions.values()).filter(function (v) { return v !== "exclude"; }).length : 0;
    bb.setAttribute("aria-pressed", String(!inc));
    bb.title = inc ? plural(inc, "background endpoint") + " put in the script — click to choose" : "Requests the page repeats in the background: left out — click to choose per endpoint";
    var on = STUDIO_RT_TYPES.filter(function (t) { return typeOn(t.key); }).map(function (t) { return t.label; });
    var outs = [];
    if (!(S.leaveOut && S.leaveOut.ads === false)) outs.push("analytics / ads");
    if (!(S.leaveOut && S.leaveOut.options === false)) outs.push("OPTIONS");
    $("#ss-f-sum").textContent = "In the script: " + (on.length === STUDIO_RT_TYPES.length ? "every type" : on.join(", ")) + (outs.length ? " · leaving out " + outs.join(" and ") : "");
  }
  $("#ss-types").addEventListener("click", function (e) {
    var b = e.target.closest("[data-type]"); if (!b) return;
    window.studioToggleRt(b.getAttribute("data-type"));
  });
  // the engine's type functions (also behind All / None): the choice, then a new reading
  ["studioToggleRt", "studioToggleRtNone"].forEach(function (fn) {
    var orig = window[fn];
    window[fn] = function () {
      var self = this, args = arguments;
      change(function () { orig.apply(self, args); renderTypes(); });
    };
  });
  $("#ss-types-default").addEventListener("click", function () {
    change(function () { studioInitFilters(); renderTypes(); });
  });
  $$("[data-leave]").forEach(function (b) {
    b.addEventListener("click", function () {
      var k = b.getAttribute("data-leave");
      change(function () { S.leaveOut = S.leaveOut || { ads: true, options: true }; S.leaveOut[k] = S.leaveOut[k] === false; renderTypes(); });
    });
  });
  $("#ss-bg-btn").addEventListener("click", function () { SS.openBg(false); });
  // filters fold to one line (remembered)
  var fbar = $("#ss-fbar"), ffold = $("#ss-fbar-fold");
  function fbarFold(f) { fbar.classList.toggle("folded", f); ffold.setAttribute("aria-expanded", String(!f)); }
  ffold.addEventListener("click", function () { prefs.fbarFolded = !fbar.classList.contains("folded"); SS.save(); fbarFold(prefs.fbarFolded); });
  fbar.querySelector(".ss-fbar-row").addEventListener("click", function (e) { if (e.target === e.currentTarget) ffold.click(); });
  fbarFold(!!prefs.fbarFolded);
  // "Should I put JS, CSS … in the script?"
  var help = $("#ss-res-help"), pop = $("#ss-res-pop");
  help.addEventListener("click", function (e) { e.stopPropagation(); pop.hidden = !pop.hidden; help.setAttribute("aria-expanded", String(!pop.hidden)); });
  document.addEventListener("click", function (e) { if (!pop.hidden && !pop.contains(e.target) && e.target !== help) { pop.hidden = true; help.setAttribute("aria-expanded", "false"); } });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !pop.hidden) { pop.hidden = true; help.setAttribute("aria-expanded", "false"); help.focus(); } });

  // ── Domains ──
  function hostOf(url) { try { return new URL(url).hostname; } catch (e) { return ""; } }
  var SIGN_IN = /\/(login|logon|signin|sign-in|oauth2?|authorize|token|saml2?|sso|adfs|openid|auth)(\/|\?|\.|$)/i;
  function pathOf(url) { var p = String(url || "").replace(/^[a-z]+:\/\/[^/]+/i, "") || "/"; return p.length > 70 ? p.slice(0, 70) + "…" : p; }
  // why the script may not work without a domain (the Recorder's warning, same rules)
  function needs(d) {
    var page = null, sso = null, cookie = false, from = null;
    (S.entries1 || []).forEach(function (e) {
      if (e.isMarker || e.filtered) return;
      var h = hostOf(e.url);
      if (h === d) {
        if (!page && HostParams.isPageLoad(e)) page = e;
        if (!sso && SIGN_IN.test(pathOf(e.url))) sso = e;
        if ((e.respHdrsMap || {})["set-cookie"]) cookie = true;
      } else if (!from && e.status >= 300 && e.status < 400 && hostOf((e.respHdrsMap || {}).location || "") === d) from = h;
    });
    var r = [];
    if (page) r.push("it loads a page of your journey (" + pathOf(page.url) + ")");
    if (from) r.push(from + " redirects to it");
    if (sso) r.push("it looks like sign-in (" + pathOf(sso.url) + ")");
    if (cookie) r.push("it sets cookies that later requests send back");
    return r;
  }
  function serverNames(h) {
    var hp = S.hostParams;
    if (!hp || !hp.keys) return [];
    return hp.keys.filter(function (k) { return HostParams.hostName(k) === h; }).map(function (k) { return { key: k, name: hp.map[k], main: k === hp.main }; });
  }
  function renderDomains() {
    var stats = S.domainStats || {}, hosts = Object.keys(stats);
    var inS = {}, all = {};
    reqs().forEach(function (e) { var h = hostOf(e.url); if (!h) return; all[h] = (all[h] || 0) + 1; if (!e.filtered) inS[h] = (inS[h] || 0) + 1; });
    var q = ($("#ss-dq").value || "").trim().toLowerCase();
    var adsOn = !(S.leaveOut && S.leaveOut.ads === false);
    var isAds = function (h) { return NOISY.test(h); };
    hosts.sort(function (a, b) { return (inS[b] || 0) - (inS[a] || 0) || stats[b].count - stats[a].count || (a < b ? -1 : 1); });
    var shown = hosts.filter(function (h) { return !q || h.indexOf(q) !== -1; });
    var used = shown.filter(function (h) { return inS[h]; }), rest = shown.filter(function (h) { return !inS[h]; });
    var on = hosts.filter(function (h) { return S.filterDomains[h] !== false && !(adsOn && isAds(h)); }).length;
    var used0 = hosts.filter(function (h) { return inS[h]; }).length;
    $("#ss-dom-n").textContent = used0 + "/" + hosts.length;
    $("#ss-dom-n").title = used0 + " of " + hosts.length + " domains have requests in the script";
    function row(h) {
      var off = S.filterDomains[h] === false, ads = adsOn && isAds(h);
      var srv = serverNames(h).filter(function (s) { return s.name; });
      return '<div class="ss-dom' + (off || ads ? " off" : "") + '" data-host="' + esc(h) + '">' +
        '<input type="checkbox" class="ss-cb" ' + (off || ads ? "" : "checked ") + (ads ? "disabled " : "") + 'aria-label="' + esc(h) + (ads ? " — analytics / ads, left out (Leave out: Analytics / ads)" : off ? " — left out; tick to put it in the script" : " — in the script; untick to leave it out") + '">' +
        '<span class="ss-host" title="' + esc(h) + '">' + esc(h) + "</span>" +
        '<span class="ss-meta">' + (inS[h] || 0) + " of " + (all[h] || stats[h].count) + " in the script" + (ads ? ' · <span class="ss-tag">analytics / ads</span>' : "") + "</span>" +
        (srv.length ? '<span class="ss-srv">' + srv.map(function (s) {
          return '<code title="The server parameter of ' + esc(s.key) + ' in the script">' + esc(s.name) + "</code>" + (s.main ? '<span class="ss-tag">main</span>' : "") +
            '<button class="ds-btn ds-btn-xs ds-btn-ghost" type="button" data-rename="' + esc(s.key) + '" aria-label="Rename the server parameter of ' + esc(s.key) + '"><svg class="i"><use href="#i-edit"/></svg>Rename</button>';
        }).join("") + "</span>" : "") +
        "</div>";
    }
    var restOpen = !!q || !!prefs.domRest;
    $("#ss-domains").innerHTML = (used.length ? '<div class="ss-dgrp-h">In the script <span class="ss-n">' + used.length + "</span></div>" + used.map(row).join("") : "") +
      (rest.length ? '<button type="button" class="ss-dgrp" aria-expanded="' + restOpen + '"><svg class="i ss-chev"><use href="#i-chev"/></svg>Left out <span class="ss-n">' + rest.length + "</span><small>switched off, analytics, or only left-out requests</small></button>" +
        (restOpen ? rest.map(row).join("") : "") : "") +
      (shown.length ? "" : '<p class="ss-empty">No domain matches “' + esc(q) + "”.</p>");
    $("#ss-dom-on").disabled = on === hosts.filter(function (h) { return !(adsOn && isAds(h)); }).length;
    $("#ss-dom-off").disabled = on === 0;
  }
  $("#ss-dq").addEventListener("input", renderDomains);
  $("#ss-domains").addEventListener("click", function (e) {
    var g = e.target.closest(".ss-dgrp");
    if (g) { prefs.domRest = g.getAttribute("aria-expanded") !== "true"; SS.save(); renderDomains(); return; }
    var rn = e.target.closest("[data-rename]");
    if (rn) { openHostRename(rn.getAttribute("data-rename")); return; }
    var d = e.target.closest(".ss-dom"); if (!d) return;
    var cb = d.querySelector("input"); if (cb.disabled) return;
    if (e.target !== cb) cb.checked = !cb.checked;
    setDomain(d.getAttribute("data-host"), cb.checked, cb);
  });
  function setDomain(h, on, cb) {
    var run = function () { change(function () { studioToggleDomain(h, on); }); };
    var why = on ? [] : needs(h);
    if (!why.length) { run(); return; }
    SS.ask("Leave out " + h + "?", "The script may not work without it: " + why.join("; ") + ".", "Leave it out", run);
    // cancelled: the box shows the real state again
    var d = $("#ss-ask"); var back = function () { d.removeEventListener("close", back); setTimeout(function () { if (cb) cb.checked = S.filterDomains[h] !== false; }, 0); };
    d.addEventListener("close", back);
  }
  $("#ss-dom-on").addEventListener("click", function () { change(function () { studioToggleAllDomains(true); }); });
  $("#ss-dom-off").addEventListener("click", function () {
    SS.ask("Leave out every domain?", "Nothing would be left in the script. Switch the domains you need back on afterwards.", "Leave them all out", function () { change(function () { studioToggleAllDomains(false); }); });
  });

  // ── Requests: one list, grouped by transaction; left-out requests behind one line per group ──
  var H = { h: 40, r: 44, o: 32 };
  var REASON = { report: "browser report", websocket: "WebSocket", nonhttp: "not HTTP", prefetch: "prefetched page opened later", domain: "domain switched off", options: "OPTIONS pre-flight", ads: "analytics / ads", type: "type left out" };
  function groups() {
    var out = [], cur = null;
    (S.entries1 || []).forEach(function (e) {
      if (e.isMarker) {
        if (e.markerType === "start") { cur = { txn: e.txnName, items: [] }; out.push(cur); }
        else cur = null;
        return;
      }
      var t = e.txn || null;
      if (!cur || cur.txn !== t) { cur = { txn: t, items: [] }; out.push(cur); }
      cur.items.push(e);
    });
    return out;
  }
  function build() {
    var q = W.q.toLowerCase(), showOut = !!prefs.showOut, rows = [], y = 0;
    var gs = groups(), anyTxn = (S.txns || []).length > 0;
    var t0 = 0, t1 = 0;
    reqs().forEach(function (e) { if (!e.startMs) return; if (!t0 || e.startMs < t0) t0 = e.startMs; if (e.startMs + (e.dur || 0) > t1) t1 = e.startMs + (e.dur || 0); });
    W.span = { t0: t0, len: Math.max(1, t1 - t0) };
    gs.forEach(function (g, gi) {
      var items = q ? g.items.filter(function (e) { return e.url.toLowerCase().indexOf(q) !== -1; }) : g.items;
      if (q && !items.length) return;
      var ins = items.filter(function (e) { return !e.filtered; }), outs = items.filter(function (e) { return e.filtered; });
      var key = g.txn || "";
      var folded = !!W.folded[key];
      if (anyTxn || g.txn) { rows.push({ k: "h", g: g, gi: gi, key: key, n: ins.length, nOut: outs.length, folded: folded, y: y }); y += H.h; }
      if (folded) return;
      var openOut = showOut || W.openOut[gi] || !!q;
      items.forEach(function (e) {
        if (!e.filtered || openOut) { rows.push({ k: "r", e: e, y: y }); y += H.r; }
      });
      if (outs.length && !openOut) {
        var why = {};
        outs.forEach(function (e) { var w = REASON[e.leftOut] || "left out"; why[w] = (why[w] || 0) + 1; });
        rows.push({ k: "o", gi: gi, n: outs.length, why: Object.keys(why).map(function (w) { return why[w] + " " + w; }).join(", "), y: y }); y += H.o;
      }
    });
    W.rows = rows; W.height = y;
  }
  function statusCls(s) { return s >= 500 ? "s5" : s >= 400 ? "s4" : s >= 300 ? "s3" : s >= 200 ? "s2" : "s0"; }
  function split(url) {
    var m = /^([a-z]+:\/\/[^/?#]+)?(.*)$/i.exec(url || "") || [];
    return { host: (m[1] || "").replace(/^[a-z]+:\/\//i, ""), path: m[2] || "/" };
  }
  function rowHtml(r) {
    if (r.k === "h") {
      var none = !r.g.txn;
      return '<div class="ss-txn' + (none ? " none" : "") + (r.folded ? " folded" : "") + '" style="top:' + r.y + 'px" data-key="' + esc(r.key) + '" role="listitem">' +
        '<button class="ss-fold" type="button" aria-expanded="' + !r.folded + '" aria-label="' + (r.folded ? "Unfold " : "Fold ") + esc(r.g.txn || "requests outside transactions") + '"><svg class="i ss-chev"><use href="#i-chev"/></svg></button>' +
        '<span class="ss-bar2"></span><b>' + esc(r.g.txn || "Not in a transaction") + "</b><small>" + plural(r.n, "request") + (r.nOut ? " · " + r.nOut + " left out" : "") + "</small><span class=\"ss-grow\"></span>" +
        (none ? "" : '<button class="ds-btn ds-btn-xs ds-btn-ghost" type="button" data-act="rename" title="Rename this transaction"><svg class="i"><use href="#i-edit"/></svg><span class="ss-opt">Rename</span></button>' +
          '<button class="ds-btn ds-btn-xs ds-btn-ghost" type="button" data-act="ungroup" title="Remove this transaction; its requests stay in the script"><svg class="i"><use href="#i-ungroup"/></svg><span class="ss-opt">Ungroup</span></button>') +
        "</div>";
    }
    if (r.k === "o") {
      return '<button type="button" class="ss-outrow" style="top:' + r.y + 'px" data-gi="' + r.gi + '"><svg class="i"><use href="#i-eye"/></svg>' + plural(r.n, "request") + " left out — " + esc(r.why) + '<span class="ss-link">Show</span></button>';
    }
    var e = r.e, u = split(e.url), sel = W.sel.has(e.id);
    var tl = "";
    if (e.startMs && W.span) {
      var l = (e.startMs - W.span.t0) / W.span.len * 100, w = Math.max(0.6, (e.dur || 0) / W.span.len * 100);
      tl = '<i style="left:' + l.toFixed(2) + "%;width:" + Math.min(w, 100 - l).toFixed(2) + '%"></i>';
    }
    return '<div class="ss-rq' + (e.filtered ? " out" : "") + (sel ? " sel" : "") + (W.cur === e.id ? " cur" : "") + '" style="top:' + r.y + 'px" data-id="' + e.id + '" role="listitem">' +
      '<input type="checkbox" class="ss-cb" tabindex="-1"' + (sel ? " checked" : "") + (e.filtered ? " disabled" : "") + ' aria-label="Tick request ' + e.id + ' for a new transaction">' +
      '<span class="ss-rn">' + e.id + "</span>" +
      '<span class="ss-m ' + esc(e.method) + '">' + esc(e.method) + "</span>" +
      '<span class="ss-path"><b title="' + esc(e.url) + '">' + esc(u.path) + "</b><small>" + esc(u.host) +
        (e.filtered ? ' <span class="ss-why">' + esc(REASON[e.leftOut] || "left out") + "</span>" : "") + "</small></span>" +
      '<span class="ss-st ' + statusCls(e.status) + '">' + (e.status || "—") + "</span>" +
      '<span class="ss-num">' + (e.dur ? e.dur + " ms" : "") + "</span>" +
      '<span class="ss-tl">' + tl + "</span></div>";
  }
  var box = $("#ss-reqs"), inner = $("#ss-reqs-in");
  function draw() {
    inner.style.height = W.height + "px";
    var top = box.scrollTop - 400, bot = box.scrollTop + box.clientHeight + 400;
    var html = "";
    for (var i = 0; i < W.rows.length; i++) {
      var r = W.rows[i], h = r.k === "h" ? H.h : r.k === "o" ? H.o : H.r;
      if (r.y + h < top) continue;
      if (r.y > bot) break;
      html += rowHtml(r);
    }
    if (!W.rows.length) html = '<p class="ss-empty">' + (W.q ? "No request address contains “" + esc(W.q) + "”." : "No requests.") + "</p>";
    inner.innerHTML = html;
  }
  var raf = 0;
  box.addEventListener("scroll", function () { if (!raf) raf = requestAnimationFrame(function () { raf = 0; draw(); }); });
  function renderReqs() {
    build(); draw();
    var all = reqs(), ins = all.filter(function (e) { return !e.filtered; }).length;
    $("#ss-req-n").textContent = ins + " in the script · " + (all.length - ins) + " left out";
    var so = $("#ss-showout"); so.setAttribute("aria-pressed", String(!!prefs.showOut));
    so.querySelector("span").textContent = prefs.showOut ? "Hide left-out" : "Show left-out";
    var anyFold = Object.keys(W.folded).some(function (k) { return W.folded[k]; });
    $("#ss-fold-all span").textContent = anyFold ? "Expand all" : "Collapse all";
    selbar();
  }
  $("#ss-q").addEventListener("input", function () { W.q = this.value.trim(); box.scrollTop = 0; renderReqs(); });
  $("#ss-showout").addEventListener("click", function () { prefs.showOut = !prefs.showOut; SS.save(); renderReqs(); });
  $("#ss-fold-all").addEventListener("click", function () {
    var anyFold = Object.keys(W.folded).some(function (k) { return W.folded[k]; });
    W.folded = {};
    if (!anyFold) groups().forEach(function (g) { W.folded[g.txn || ""] = true; });
    renderReqs();
  });

  // selection → New transaction
  function selbar() {
    var n = W.sel.size;
    $("#ss-selbar").hidden = !n;
    $("#ss-sel-n").textContent = n + " selected";
    $("#ss-p-req").classList.toggle("picking", !!W.picking || n > 0);
  }
  function tick(id, on, range) {
    var list = W.rows.filter(function (r) { return r.k === "r" && !r.e.filtered; }).map(function (r) { return r.e.id; });
    var ids = [id];
    if (range && W.last != null && list.indexOf(W.last) !== -1) {
      var a = list.indexOf(W.last), b = list.indexOf(id);
      ids = list.slice(Math.min(a, b), Math.max(a, b) + 1);
    }
    ids.forEach(function (x) { if (on) W.sel.add(x); else W.sel.delete(x); });
    W.last = id;
    draw(); selbar();
  }
  inner.addEventListener("click", function (e) {
    var out = e.target.closest(".ss-outrow");
    if (out) { var gi = +out.getAttribute("data-gi"); W.openOut[gi] = true; renderReqs(); return; }
    var h = e.target.closest(".ss-txn");
    if (h) {
      var key = h.getAttribute("data-key"), act = e.target.closest("[data-act]");
      if (act && act.getAttribute("data-act") === "rename") { openTxn("rename", key); return; }
      if (act && act.getAttribute("data-act") === "ungroup") { ungroup(key); return; }
      W.folded[key] = !W.folded[key]; renderReqs();
      var b = inner.querySelector('.ss-txn[data-key="' + cssEsc(key) + '"] .ss-fold'); if (b) b.focus();
      return;
    }
    var r = e.target.closest(".ss-rq"); if (!r) return;
    var id = +r.getAttribute("data-id");
    W.cur = id;
    var cb = r.querySelector("input");
    if (!cb.disabled && (e.target === cb || W.sel.size || W.picking)) tick(id, e.target === cb ? cb.checked : !W.sel.has(id), e.shiftKey);
    else draw();
  });
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }
  // keyboard: arrows move, Space ticks, Enter folds a transaction
  box.addEventListener("keydown", function (e) {
    var list = W.rows.filter(function (r) { return r.k === "r"; });
    if (!list.length) return;
    var i = list.findIndex(function (r) { return r.e.id === W.cur; });
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      i = Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      W.cur = list[i].e.id;
      var y = list[i].y;
      if (y < box.scrollTop) box.scrollTop = y; else if (y + H.r > box.scrollTop + box.clientHeight) box.scrollTop = y + H.r - box.clientHeight;
      draw();
    } else if (e.key === " " && i >= 0 && !list[i].e.filtered) { e.preventDefault(); tick(W.cur, !W.sel.has(W.cur), e.shiftKey); }
    else if (e.key === "Escape" && (W.sel.size || W.picking)) { clearSel(); }
  });
  function clearSel() { W.sel = new Set(); W.picking = false; W.last = null; draw(); selbar(); }
  $("#ss-sel-clear").addEventListener("click", clearSel);
  $("#ss-sel-group").addEventListener("click", function () { openTxn("create"); });
  $("#ss-new-txn").addEventListener("click", function () {
    if (W.sel.size) { openTxn("create"); return; }
    W.picking = true; selbar();
    showToast("Tick the requests for the new transaction (Shift-click ticks a range), then Create transaction.", "info", 5000);
    box.focus();
  });

  // ── transaction dialog (create / rename) and ungroup, each with Undo ──
  var dlg = $("#ss-txn-dlg"), inp = $("#ss-txn-inp"), err = $("#ss-txn-err"), mode = null;
  function openTxn(m, name) {
    mode = { m: m, name: name };
    $("#ss-txn-h").textContent = m === "rename" ? "Rename transaction" : "New transaction";
    $("#ss-txn-ok").textContent = m === "rename" ? "Rename" : "Create";
    $("#ss-txn-sub").textContent = m === "rename" ? "The requests stay as they are." : "From the first to the last of the " + plural(W.sel.size, "ticked request") + ".";
    var next = "T" + String((S.txns || []).length + 1).padStart(2, "0") + "_";
    inp.value = m === "rename" ? name : next; err.hidden = true; inp.removeAttribute("aria-invalid");
    try { dlg.showModal(); } catch (e) { dlg.setAttribute("open", ""); }
    inp.focus(); inp.setSelectionRange(inp.value.length, inp.value.length);
  }
  dlg.addEventListener("click", function (e) { if (e.target.closest("[data-close]")) dlg.close(); });
  $("#ss-txn-form").addEventListener("submit", function (e) {
    e.preventDefault();
    var name = inp.value.trim();
    var taken = StudioTxn.names(S.entries1 || []);
    var why = StudioTxn.nameError(name, taken, mode.m === "rename" ? mode.name : null);
    if (why) { err.textContent = why; err.hidden = false; inp.setAttribute("aria-invalid", "true"); inp.focus(); return; }
    dlg.close();
    if (mode.m === "rename") {
      if (name === mode.name) return;
      if (W.folded[mode.name]) { W.folded[name] = true; delete W.folded[mode.name]; }
      edit({ op: "rename", from: mode.name, to: name }, "Renamed " + mode.name + " to " + name + ".");
    } else {
      var ids = Array.from(W.sel).sort(function (a, b) { return a - b; });
      W.sel = new Set(); W.picking = false;
      edit({ op: "create", name: name, ids: ids }, "Transaction " + name + " created.");
    }
  });
  function ungroup(name) { edit({ op: "ungroup", name: name }, "Transaction " + name + " removed — its requests stay in the script."); }
  function edit(op, msg) {
    change(function () {
      var before = W.log.slice();
      W.log.push(op);
      undoToast(msg, function () { change(function () { W.log = before; }); });
    });
  }

  // a message with Undo (the engine's messages have no button)
  function undoToast(msg, undo) {
    var c = $("#toast-container"); if (!c) return;
    var t = document.createElement("div");
    t.className = "toast toast-success ss-undo";
    t.innerHTML = '<span class="toast-icon">✔</span><span class="toast-msg">' + esc(msg) + '</span><button type="button" class="ds-btn ds-btn-xs">Undo</button>';
    t.querySelector("button").addEventListener("click", function () { t.remove(); undo(); });
    c.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 8000);
  }

  // ── panels: hide to a rail (remembered), one click on the rail brings it back; drag the gaps to resize ──
  prefs.hide = prefs.hide || {};
  var cols = $("#ss-cols");
  function panes() {
    ["dom", "req", "right"].forEach(function (p) { cols.classList.toggle("no-" + p, !!prefs.hide[p]); });
    if (prefs.wDom) cols.style.setProperty("--ss-dw", prefs.wDom + "px");
    if (prefs.wRight) cols.style.setProperty("--ss-rw", prefs.wRight + "px");
  }
  function showPane(p, on) {
    if (!!prefs.hide[p] === !on) return;
    prefs.hide[p] = !on;
    // never hide everything: the request list comes back
    if (prefs.hide.dom && prefs.hide.req && prefs.hide.right) prefs.hide.req = false;
    SS.save(); panes();
    if (p === "req" && on) draw();
  }
  cols.addEventListener("click", function (e) {
    var hb = e.target.closest("[data-hide]");
    if (hb) { showPane(hb.getAttribute("data-hide"), false); return; }
    var sb = e.target.closest("[data-show]");
    if (sb) { showPane(sb.getAttribute("data-show"), true); return; }
    var head = e.target.closest("[data-hide-head]");
    if (head && e.target === head || head && e.target.tagName === "H3") showPane(head.getAttribute("data-hide-head"), false);
  });
  $$(".ss-rs", cols).forEach(function (rs) {
    rs.addEventListener("pointerdown", function (e) {
      var which = rs.getAttribute("data-rs"), x0 = e.clientX;
      var pane = which === "dom" ? $("#ss-p-dom") : $("#ss-p-right"), w0 = pane.getBoundingClientRect().width;
      rs.setPointerCapture(e.pointerId);
      function move(ev) {
        var w = Math.round(which === "dom" ? w0 + (ev.clientX - x0) : w0 - (ev.clientX - x0));
        w = Math.max(which === "dom" ? 200 : 320, Math.min(which === "dom" ? 520 : 1400, w));
        cols.style.setProperty(which === "dom" ? "--ss-dw" : "--ss-rw", w + "px");
        if (which === "dom") prefs.wDom = w; else prefs.wRight = w;
      }
      function up() { rs.removeEventListener("pointermove", move); rs.removeEventListener("pointerup", up); SS.save(); draw(); }
      rs.addEventListener("pointermove", move); rs.addEventListener("pointerup", up);
    });
    rs.addEventListener("dblclick", function () {
      var which = rs.getAttribute("data-rs");
      cols.style.removeProperty(which === "dom" ? "--ss-dw" : "--ss-rw");
      if (which === "dom") delete prefs.wDom; else delete prefs.wRight;
      SS.save();
    });
  });
  panes();
  if (window.ResizeObserver) new ResizeObserver(function () { if (W.rows.length) draw(); }).observe(box);

  // the second recording: "Record it now" next to its box
  var diff = $("#ss-diff .ss-card-b");
  if (diff && SS.recordSecond) {
    var b = document.createElement("button");
    b.type = "button"; b.className = "ds-btn ds-btn-sm"; b.innerHTML = '<svg class="i"><use href="#i-rec"/></svg>Record it now';
    b.addEventListener("click", SS.recordSecond);
    var row = document.createElement("div"); row.className = "ss-row"; row.appendChild(b);
    diff.appendChild(row);
  }

  window.SSW = {
    newFile: newFile,
    render: function () { renderTypes(); renderDomains(); renderReqs(); },
    showPane: showPane,
    state: W,
  };
})();
