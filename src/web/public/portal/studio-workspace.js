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
    if (SS.testDataNewFile) SS.testDataNewFile();
    if (typeof closeDet === "function" && D && detOpen()) closeDet();
    W.log = []; W.sel = new Set(); W.last = null; W.folded = {}; W.openOut = {}; W.q = ""; W.cur = null;
    S.leaveOut = { ads: true, options: true }; S.leaveOutIds = new Set();
    var q = $("#ss-q"); if (q) q.value = "";
    var d = $("#ss-dq"); if (d) d.value = "";
  }

  // ── read the recording again after a change. Correlations applied in the Advisor do not survive a new reading
  //    (the Advisor scans again), so the user is asked first. ──
  //    The engines' own correlations come back by themselves unless the user changed one (advisorEngineUntouched).
  function applied() { return (S.advisorCandidates || []).filter(function (c) { return c._applied && !(typeof advisorEngineUntouched === "function" && advisorEngineUntouched(c)); }).length; }
  function change(fn) {
    var n = applied();
    var go = function () { fn(); again(); };
    if (!n) { go(); return; }
    SS.ask("Read the recording again?", "This change reads the recording again and the Correlation Advisor scans it again: the " +
      plural(n, "correlation") + " you applied are taken off. The Advisor suggests its own ones again; ones you added yourself (Paste & Detect, Add Manual) need adding again.", "Continue", go);
  }
  var tAgain = null;
  function again() { clearTimeout(tAgain); tAgain = setTimeout(function () { tAgain = null; if (S.har1) window.analyze(); }, 120); }
  SS.queuedRead = function () { return tAgain != null; };
  SS.cancelAgain = function () { clearTimeout(tAgain); tAgain = null; };

  // ── filter bar: types ──
  function rules() { return { STATIC_CT: STATIC_CT, STATIC_EXT: STATIC_EXT, NOISY: NOISY, NOISY_URL: typeof NOISY_URL !== "undefined" ? NOISY_URL : null }; }
  function reqs() { return (S.entries1 || []).filter(function (e) { return !e.isMarker; }); }
  function typeOn(k) { var s = S.filterResourceTypes; return !(s instanceof Set) || s.has(k); }
  function renderTypes() {
    var counts = {}, r = rules();
    reqs().forEach(function (e) { var k = RequestFilter.typeKey(e, r); counts[k] = (counts[k] || 0) + 1; });
    // a type with no request in this recording is not shown (as in the mockup: nothing to choose)
    $("#ss-types").innerHTML = STUDIO_RT_TYPES.filter(function (t) { return counts[t.key] > 0; }).map(function (t) {
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
    var out = reqs().filter(isOut).length, fn = $("#ss-f-n");
    fn.hidden = !out; fn.textContent = out; $("#ss-filters-btn").title = "What goes into the script" + (out ? ": " + plural(out, "request") + " left out" : "");
    $("#ss-f-all").textContent = (reqs().length - out) + " of " + reqs().length + " requests are in the script.";
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
    var inS = {}, all = {}, nIn = {};
    reqs().forEach(function (e) { var h = hostOf(e.url); if (!h) return; all[h] = (all[h] || 0) + 1; if (!e.filtered) inS[h] = (inS[h] || 0) + 1; if (!isOut(e)) nIn[h] = (nIn[h] || 0) + 1; });
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
        '<span class="ss-meta">' + (nIn[h] || 0) + " of " + (all[h] || stats[h].count) + " in the script" + (ads ? ' · <span class="ss-tag">analytics / ads</span>' : "") + "</span>" +
        (srv.length ? '<span class="ss-srv">' + srv.map(function (s) {
          return '<button class="ss-par" type="button" data-rename="' + esc(s.key) + '" title="The server parameter of ' + esc(s.key) + ' in the script: click to change its name" aria-label="' + esc(s.name) + ", the server parameter of " + esc(s.key) + ': change its name"><code>' + esc(s.name) + '</code><svg class="i"><use href="#i-edit"/></svg></button>' + (s.main ? '<span class="ss-tag">main</span>' : "");
        }).join("") + "</span>" : "") +
        "</div>";
    }
    // three groups, as in the mockup: in the script (open), not in the script, analytics / ads (both folded); each
    // fold is remembered; a search opens them all
    var adsRest = rest.filter(function (h) { return adsOn && isAds(h); }), notIn = rest.filter(function (h) { return !(adsOn && isAds(h)); });
    var open = function (k, dflt) { return !!q || (prefs[k] === undefined ? dflt : !!prefs[k]); };
    var group = function (k, dflt, title, list, note) {
      if (!list.length) return "";
      var o = open(k, dflt);
      return '<button type="button" class="ss-dgrp" data-grp="' + k + '" aria-expanded="' + o + '"><svg class="i ss-chev"><use href="#i-chev"/></svg>' + title + ' <span class="ss-n">' + list.length + "</span>" + (note ? "<small>" + note + "</small>" : "") + "</button>" + (o ? list.map(row).join("") : "");
    };
    $("#ss-domains").innerHTML = group("domIn", true, "In the script", used, "") +
      group("domRest", false, "Not in the script", notIn, "switched off, or only left-out requests") +
      group("domAds", false, "Analytics / ads: always left out", adsRest, "Leave out: Analytics / ads") +
      (shown.length ? "" : '<p class="ss-empty">No domain matches “' + esc(q) + "”.</p>");
    $("#ss-dom-on").disabled = on === hosts.filter(function (h) { return !(adsOn && isAds(h)); }).length;
    $("#ss-dom-off").disabled = on === 0;
  }
  $("#ss-dq").addEventListener("input", renderDomains);
  $("#ss-domains").addEventListener("click", function (e) {
    var g = e.target.closest(".ss-dgrp");
    if (g) { prefs[g.getAttribute("data-grp")] = g.getAttribute("aria-expanded") !== "true"; SS.save(); renderDomains(); return; }
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
  var REASON = { report: "browser report", websocket: "WebSocket", nonhttp: "not HTTP", prefetch: "prefetched page opened later", domain: "domain switched off", options: "OPTIONS pre-flight", ads: "analytics / ads", type: "type left out", user: "left out by you" };
  function isOut(e) { return !SS.inScript(e); }
  function why(e) { return e.filtered ? REASON[e.leftOut] || "left out" : "repeats in the background"; }
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
      var ins = items.filter(function (e) { return !isOut(e); }), outs = items.filter(function (e) { return e.filtered; });
      var key = g.txn || "";
      var folded = !!W.folded[key];
      var openOut = showOut || W.openOut[gi] || !!q;
      var by = {};
      outs.forEach(function (e) { var w = why(e); by[w] = (by[w] || 0) + 1; });
      var whyAll = Object.keys(by).map(function (w) { return by[w] + " " + w; }).join(", ");
      var head = anyTxn || g.txn;
      // a group with a header: its "n left out" is the header's own button (shows / hides them) — no extra line (2026-11-27)
      if (head) { rows.push({ k: "h", g: g, gi: gi, key: key, n: ins.length, nOut: items.length - ins.length, outs: outs.length, open: !!W.openOut[gi], fixed: showOut || !!q, why: whyAll, folded: folded, y: y }); y += H.h; }
      if (folded) return;
      items.forEach(function (e) {
        if (!e.filtered || openOut) { rows.push({ k: "r", e: e, y: y }); y += H.r; }
      });
      if (outs.length && !openOut && !head) { rows.push({ k: "o", gi: gi, n: outs.length, why: whyAll, y: y }); y += H.o; }
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
      return '<div class="ss-txn' + (none ? " none" : "") + (r.folded ? " folded" : "") + '" style="top:' + r.y + 'px" data-key="' + esc(r.key) + '" data-gi="' + r.gi + '" role="listitem">' +
        '<button class="ss-fold" type="button" aria-expanded="' + !r.folded + '" aria-label="' + (r.folded ? "Unfold " : "Fold ") + esc(r.g.txn || "requests outside transactions") + '"><svg class="i ss-chev"><use href="#i-chev"/></svg></button>' +
        '<span class="ss-bar2"></span><b title="' + esc(r.g.txn || "Not in a transaction") + '">' + esc(r.g.txn || "Not in a transaction") + "</b><small>" + plural(r.n, "request") +
        (!r.nOut ? "" : r.outs && !r.fixed && !r.folded
          ? ' · <button type="button" class="ss-outlink" data-act="out" aria-expanded="' + r.open + '" title="' + esc(r.why) + (r.open ? " — hide them" : " — show them") + '">' + r.nOut + " left out</button>"
          : " · " + r.nOut + " left out") + "</small><span class=\"ss-grow\"></span>" +
        (none ? "" : '<button class="ds-btn ds-btn-xs ds-btn-ghost" type="button" data-act="rename" title="Rename this transaction"><svg class="i"><use href="#i-edit"/></svg><span class="ss-opt">Rename</span></button>' +
          '<button class="ds-btn ds-btn-xs ds-btn-ghost" type="button" data-act="ungroup" title="Remove this transaction; its requests stay in the script"><svg class="i"><use href="#i-ungroup"/></svg><span class="ss-opt">Ungroup</span></button>') +
        "</div>";
    }
    if (r.k === "o") {
      return '<button type="button" class="ss-outrow" style="top:' + r.y + 'px" data-gi="' + r.gi + '"><svg class="i"><use href="#i-eye"/></svg>' + plural(r.n, "request") + " left out — " + esc(r.why) + '<span class="ss-link">Show</span></button>';
    }
    var e = r.e, u = split(e.url), sel = W.sel.has(e.id), o = isOut(e), once = SS.setup(e);
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
        (o ? ' <span class="ss-why">' + esc(why(e)) + "</span>" : once ? ' <span class="ss-why">runs once at the start</span>' : "") + "</small></span>" +
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
    var all = reqs(), ins = all.filter(function (e) { return !isOut(e); }).length;
    $("#ss-req-n").textContent = ins + " in the script · " + (all.length - ins) + " left out";
    var so = $("#ss-showout"); so.setAttribute("aria-pressed", String(!!prefs.showOut));
    so.title = prefs.showOut ? "Hide left-out" : "Show left-out"; so.setAttribute("aria-label", so.title);
    var anyFold = Object.keys(W.folded).some(function (k) { return W.folded[k]; });
    var fa = $("#ss-fold-all"); fa.title = anyFold ? "Expand all" : "Collapse all"; fa.setAttribute("aria-label", fa.title);
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
      if (act && act.getAttribute("data-act") === "out") {
        var gi = +h.getAttribute("data-gi"); W.openOut[gi] = !W.openOut[gi]; renderReqs();
        var ob = inner.querySelector('.ss-txn[data-gi="' + gi + '"] [data-act=out]'); if (ob) ob.focus();
        return;
      }
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
    else openDet(id);
  });
  function cssEsc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/"/g, '\\"'); }
  // keyboard: arrows move, Space ticks, Enter folds a transaction
  box.addEventListener("keydown", function (e) {
    // a button in the list (fold, n left out, Rename, Ungroup) takes its own Enter / Space
    if ((e.key === "Enter" || e.key === " ") && e.target.closest && e.target.closest("button") && box.contains(e.target)) return;
    var list = W.rows.filter(function (r) { return r.k === "r"; });
    if (!list.length) return;
    var i = list.findIndex(function (r) { return r.e.id === W.cur; });
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      i = Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)));
      W.cur = list[i].e.id;
      var y = list[i].y;
      if (y < box.scrollTop) box.scrollTop = y; else if (y + H.r > box.scrollTop + box.clientHeight) box.scrollTop = y + H.r - box.clientHeight;
      if (D.id != null) openDet(W.cur); else draw();
    } else if (e.key === " " && i >= 0 && !list[i].e.filtered) { e.preventDefault(); tick(W.cur, !W.sel.has(W.cur), e.shiftKey); }
    else if (e.key === "Enter" && i >= 0) { e.preventDefault(); openDet(W.cur); }
    else if (e.key === "Escape" && (W.sel.size || W.picking)) { clearSel(); }
    else if (e.key === "Escape" && detOpen()) { closeDet(); }
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
    // only the last change can be undone (an older Undo would also take back everything done after it)
    $$("#toast-container .ss-undo").forEach(function (o) { o.remove(); });
    var t = document.createElement("div");
    t.className = "toast toast-success ss-undo";
    t.innerHTML = '<span class="toast-icon">✔</span><span class="toast-msg">' + esc(msg) + '</span><button type="button" class="ds-btn ds-btn-xs">Undo</button>';
    t.querySelector("button").addEventListener("click", function () { t.remove(); undo(); });
    c.appendChild(t);
    setTimeout(function () { if (t.parentNode) t.remove(); }, 8000);
  }

  // ── request details (portal/request-details.js — the same view as the HAR Explorer's): a sheet over the workspace,
  //    a panel of its own on desktops 2400 px and wider; previous / next follow the list as it is shown ──
  var det = $("#ss-det"), detB = $("#ss-det-b");
  var D = { id: null, tab: "headers", mask: !!prefs.mask, full: {} };
  $("#ss-det-mask").checked = D.mask;
  var rawList = { har: null, list: null };
  function rawOf(e) {
    if (S.har1 && !S.isNetLog1) {
      if (rawList.har !== S.har1) { rawList.har = S.har1; rawList.list = ((S.har1.log && S.har1.log.entries) || []).filter(function (x) { return x && x.request; }); }
      var r = rawList.list[e.id - 1];   // parseHar's id = position among the entries that have a request
      if (r && r.request.url === e.url) return r;
    }
    // a NetLog file has no HAR entry: the details come from the parsed request
    var rh = e.respHdrsMap || {};
    return { request: { method: e.method, url: e.url, headers: e.reqHdrs || [], postData: e.body || undefined },
      response: { status: e.status, headers: Object.keys(rh).map(function (k) { return { name: k, value: rh[k] }; }), content: { mimeType: e.respCt || e.ct || "", text: e.respBody || "" } } };
  }
  function byId(id) { var es = S.entries1 || []; for (var i = 0; i < es.length; i++) if (!es[i].isMarker && es[i].id === id) return es[i]; return null; }
  function shownIds() { return W.rows.filter(function (r) { return r.k === "r"; }).map(function (r) { return r.e.id; }); }
  function typeLabel(e) { var k = RequestFilter.typeKey(e, rules()); var t = STUDIO_RT_TYPES.filter(function (x) { return x.key === k; })[0]; return t ? t.label : k; }
  function renderDet() {
    var e = byId(D.id);
    if (!e) { closeDet(); return; }
    var raw = rawOf(e), rs = raw.response || {}, c = rs.content || {};
    var ids = shownIds(), at = ids.indexOf(e.id);
    $("#ss-det-pos").textContent = at >= 0 ? (at + 1) + " of " + ids.length : "";
    $("#ss-det-prev").disabled = at <= 0; $("#ss-det-next").disabled = at < 0 || at >= ids.length - 1;
    // Leave out / Put back this one request (a request left out by its type, domain or a rule is changed there)
    var lv = $("#ss-det-leave"), mine = e.leftOut === "user";
    lv.textContent = mine ? "Put back" : "Leave out";
    lv.disabled = e.filtered && !mine;
    lv.title = mine ? "Put this request back into the script" : e.filtered ? "Already left out (" + why(e) + ") — change that in the filters or Domains" : "Leave this request out of the script";
    var top = (D.fromFind != null ? '<p class="hx-back"><mark class="hx-hl">' + esc(RequestDetails.short(D.fromFind, 48)) + '</mark> is marked in this request<button type="button" class="ds-btn ds-btn-sm" data-back-find>Back to Find a value</button></p>' : "") +
      '<p class="ss-det-ctx">' + (e.txn ? "Transaction <b>" + esc(e.txn) + "</b>" : "Not in a transaction") + " · " +
      (isOut(e) ? "left out of the script (" + esc(why(e)) + ")" : '<span class="ss-in">in the script</span>' + (SS.setup(e) ? ", once at the start" : "")) + "</p>";
    detB.innerHTML = RequestDetails.html({
      n: e.id, e: { method: e.method, url: e.url, status: e.status, size: c.size >= 0 ? c.size : rs.bodySize >= 0 ? rs.bodySize : null }, raw: raw,
      type: esc(typeLabel(e)), dur: e.dur || 0, start: e.startMs && W.span ? e.startMs - W.span.t0 : 0,
      out: isOut(e), why: why(e), tab: D.tab, mask: D.mask, full: D.full, top: top,
      hl: markFound, extra: [dynTab(e)],
    });
  }
  // ── the code of the request, marked in the script (a background behind its lines: the code itself is not touched) ──
  var blocks = { text: null, map: null };
  function decodeURIComponentSafe(s) { try { return decodeURIComponent(s.replace(/\+/g, " ")); } catch (e) { return s; } }
  function codeMap(text) {
    if (blocks.text === text) return blocks.map;
    var L = text.split("\n"), list = [], map = {}, dev = S.tab === "mj";
    var head = dev ? /new load\.WebRequest\(\{\s*$/ : /^\s*web_(url|custom_request|submit_data|submit_form|link|rest)\(/;
    for (var i = 0; i < L.length; i++) {
      if (!head.test(L[i])) continue;
      var b = i; while (b < L.length - 1 && !(dev ? /^\s*\}\)\.send(Sync)?\(\)|^\s*\}\)[,;]?\s*$/ : /LAST\);/).test(L[b])) b++;
      var url = "", j; for (j = i; j <= b && !url; j++) { var m = dev ? /^\s*"?url"?:\s*(.*)$/.exec(L[j]) : /"(?:URL|Action)=([^"]*)/.exec(L[j]); if (m) url = m[1]; }
      var a = i; while (a > 0 && L[a - 1].trim() && !/lr_(start|end)_transaction|\.(start|stop)\(|lr_think_time|load\.thinkTime|LAST\);\s*$|\}\)\.send/.test(L[a - 1])) a--;
      list.push({ a: a, b: b, url: url.replace(/^[`'"]/, "") });
      i = b;
    }
    // the requests in the script and their blocks, both in order: the pairs with the same path (a part of it may be a
    // parameter by now) that together match the most; a query that is in the block says which of two equal paths it is
    var qs = reqs().filter(function (e) { return !isOut(e) && !SS.setup(e); });
    var pat = qs.map(function (e) {
      var p = split(e.url).path.split("?")[0].split("#")[0];
      return new RegExp("(^|[^/])/" + p.replace(/^\//, "").split("/").map(function (s) { return s ? "(?:" + s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "|[^/?`'\"]*\\{[^}]+\\}[^/?`'\"]*)" : ""; }).join("/") + "/?([?`'\"#]|$)");
    });
    var urls = list.map(function (b) { return b.url.replace(/^https?:\/\//, ""); }), texts = list.map(function (b) { return L.slice(b.a, b.b + 1).join("\n"); });
    var vals = qs.map(function (e) { return (split(e.url).path.split("?")[1] || "").split("#")[0].split("&").map(function (x) { return decodeURIComponentSafe(x.split("=").slice(1).join("=")); }).filter(function (v) { return v.length > 1; }); });
    var n = qs.length, m = list.length, score = function (a, b) { return !pat[a].test(urls[b]) ? 0 : 10 + (vals[a].length && vals[a].every(function (v) { return texts[b].indexOf(v) >= 0; }) ? 2 : 0); };
    if (n * m <= 1000000) {
      var T = [], x, y; for (x = 0; x <= n; x++) T.push(new Int32Array(m + 1));
      for (x = n - 1; x >= 0; x--) for (y = m - 1; y >= 0; y--) { var s = score(x, y); T[x][y] = Math.max(T[x + 1][y], T[x][y + 1], s ? s + T[x + 1][y + 1] : 0); }
      for (x = 0, y = 0; x < n && y < m;) { var s2 = score(x, y); if (s2 && T[x][y] === s2 + T[x + 1][y + 1]) { map[qs[x].id] = list[y]; x++; y++; } else if (T[x][y] === T[x + 1][y]) x++; else y++; }
    } else { var at = 0; qs.forEach(function (e, a) { for (var k = at; k < m && k < at + 40; k++) if (score(a, k)) { map[e.id] = list[k]; at = k + 1; return; } }); }
    // no block of its own: a redirect that is followed, a file listed on its page — the request before it
    var prev = null; qs.forEach(function (e) { if (map[e.id]) prev = map[e.id]; else if (prev) map[e.id] = prev; });
    // what runs once at the start (DevWeb initialize): its own line
    reqs().forEach(function (e) { if (!SS.setup(e)) return; for (var i = 0; i < L.length; i++) if (L[i].indexOf(e.url) >= 0) { map[e.id] = { a: i, b: i }; return; } });
    blocks = { text: text, map: map };
    return map;
  }
  function mark(go) {
    var pre = $("#code-body"), main = S.tab === "mj" || S.tab === "ac";
    var r = main && W.cur != null && SS.curStep() === 1 && byId(W.cur) ? codeMap(pre.textContent)[W.cur] : null;
    pre.classList.toggle("ss-hl", !!r);
    if (!r) return;
    var cs = getComputedStyle(pre), lh = parseFloat(cs.lineHeight) || 20, top = parseFloat(cs.paddingTop) || 0;
    pre.style.setProperty("--hl-y", (top + r.a * lh) + "px"); pre.style.setProperty("--hl-h", ((r.b - r.a + 1) * lh) + "px");
    if (go) { var y = top + r.a * lh; if (y < pre.scrollTop + 4 || top + (r.b + 1) * lh > pre.scrollTop + pre.clientHeight) pre.scrollTop = Math.max(0, y - 24); pre.scrollLeft = 0; }
  }
  // keepFind: opened from a Find a value answer (the value stays marked, with a way back)
  function homeTop(fb) { return window.innerWidth > 600 ? Math.max(12, Math.round(fb.bottom + 8)) + "px" : ""; }
  function openDet(id, keepFind) {
    if (!keepFind) D.fromFind = null;
    if (D.view !== "req") { D.view = "req"; $("#ss-det-h").textContent = "Request details"; }
    det.classList.remove("is-find");
    var first = D.id == null;
    if (D.id !== id) D.full = {};
    D.id = id; W.cur = id;
    // over the workspace, below the file bar (Download ZIP and the format stay in reach)
    var fb = $("#ss-filebar").getBoundingClientRect();
    if (!det.classList.contains("ss-det-moved")) det.style.top = homeTop(fb);   // a pop-up the user moved stays where it was put
    det.hidden = false;
    document.body.classList.add("ss-det-open");
    renderDet(); draw(); mark(true);
    if (first && !document.body.classList.contains("ss-dock")) detB.scrollTop = 0;
  }
  function detOpen() { return D.id != null || D.view === "find"; }
  function closeDet() {
    if (!detOpen()) return;
    D.id = null; D.view = "req"; D.fromFind = null; det.hidden = true;
    $("#ss-det-h").textContent = "Request details";
    document.body.classList.remove("ss-det-open");
    draw(); box.focus();
  }
  function step(d) { var ids = shownIds(), at = ids.indexOf(D.id); if (at < 0 || !ids[at + d]) return; openDet(ids[at + d]); scrollTo(ids[at + d]); }
  function scrollTo(id) { var r = W.rows.filter(function (x) { return x.k === "r" && x.e.id === id; })[0]; if (!r) return; if (r.y < box.scrollTop || r.y + H.r > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, r.y - box.clientHeight / 2); draw(); }
  $("#ss-det-x").addEventListener("click", closeDet);
  $("#ss-det-prev").addEventListener("click", function () { step(-1); });
  $("#ss-det-leave").addEventListener("click", function () {
    var id = D.id, e = byId(id); if (!e) return;
    change(function () {
      S.leaveOutIds = S.leaveOutIds || new Set();
      if (S.leaveOutIds.has(id)) S.leaveOutIds.delete(id); else S.leaveOutIds.add(id);
    });
  });
  $("#ss-det-next").addEventListener("click", function () { step(1); });
  $("#ss-det-mask").addEventListener("change", function () { D.mask = this.checked; prefs.mask = D.mask; SS.save(); renderDet(); });
  // ── Dynamic values (the Request Inspector, for the request on screen): values traced to an earlier response
  //    (+ Add → a card in the Correlation Advisor) and values that look dynamic but have no source (Paste & Detect).
  //    The Advisor's own functions do the work (advGetRequestFields, riAddCorrFromTrace, riOpenPasteForField). ──
  var LOC = { header: "header", query: "query string", body: "body", body_json: "JSON body", body_form: "form field", cookie: "cookie" };
  function dynFields(e) {
    var idx = (S.entries1 || []).indexOf(e);
    if (idx < 0 || e.filtered || typeof advGetRequestFields !== "function") return { idx: idx, list: [] };
    if (D.dynFor !== e) { D.dynFor = e; try { D.dyn = advGetRequestFields(idx) || []; } catch (x) { D.dyn = []; } }
    return { idx: idx, list: D.dyn };
  }
  function dynTab(e) {
    var f = dynFields(e), list = f.list;
    // the Advisor's card for the same value (its scan also reads HTML pages and hidden fields, which the Inspector's
    // own trace does not): its source is used, so both places give the same answer
    var cardOf = function (x) { return (S.advisorCandidates || []).filter(function (c) { return c.value === x.value && c.status !== "skipped"; })[0] || null; };
    var srcOf = function (x) { var c; return x.traceSource || ((c = cardOf(x)) && c.source) || null; };
    var green = list.filter(function (x) { return !!srcOf(x); }), yellow = list.filter(function (x) { return !srcOf(x); });
    var row = function (x) {
      var i = list.indexOf(x), v = String(x.value || "");
      var src = srcOf(x), srcE = src && (S.entries1 || [])[src.entryIdx], card = cardOf(x);
      return '<tr><td><b>' + esc(x.key) + '</b><small>' + esc(LOC[x.location] || x.location || "") + "</small></td>" +
        '<td><button type="button" class="ss-dyn-v" data-find="' + esc(v) + '" title="Find where this value comes from and where it goes"><code>' + esc(v.length > 60 ? v.slice(0, 59) + "…" : v) + "</code></button></td><td>" +
        (src
          ? (srcE ? '<button type="button" class="adv-req-link" data-open="' + srcE.id + '" title="Open the request that sends it">#' + srcE.id + " " + esc(srcE.method) + " " + esc(split(srcE.url).path.slice(0, 48)) + "</button>" + (src.jsonPath ? ' <span class="adv-where">' + esc(src.jsonPath) + "</span>" : "") : "") +
            "</td><td>" + (card
              ? '<span class="ss-pill ss-pill-acc" title="It has a card in the Correlation Advisor">In the Advisor</span>'
              : '<button type="button" class="ds-btn ds-btn-xs ds-btn-primary" data-dyn-add="' + i + '" title="Add it to the Correlation Advisor"><svg class="i"><use href="#i-plus"/></svg>Add</button>')
          : '<span class="ss-muted">source not found in the recording</span></td><td><button type="button" class="ds-btn ds-btn-xs" data-dyn-paste="' + i + '" title="Paste the server response that sends it"><svg class="i"><use href="#i-paste"/></svg>Paste &amp; Detect</button>') +
        "</td></tr>";
    };
    var table = function (title, rows, dot) {
      return rows.length ? '<details class="hx-sec" open><summary><span class="ss-dyn-dot ' + dot + '"></span>' + title + ' <span class="c">' + rows.length + '</span></summary><table class="ss-dyn"><tbody>' + rows.map(row).join("") + "</tbody></table></details>" : "";
    };
    var html = e.filtered
      ? '<p class="hx-none">This request is left out of the script, so nothing in it needs correlation.</p>'
      : list.length
        ? table("Traced to an earlier response — correlate these", green, "g") + table("Looks dynamic, source not found", yellow, "y") +
          '<p class="ds-note hx-hint"><span><b>Add</b> puts a card in the Correlation Advisor; <b>Apply &amp; Regenerate</b> there writes it into the script.</span> <button type="button" class="ds-btn ds-btn-xs" data-go-adv>Open the Correlation Advisor</button></p>'
        : '<p class="hx-none">No value in this request looks dynamic or comes from an earlier response.</p>';
    return { key: "dynamic", label: "Dynamic values", count: list.length || "", html: html };
  }
  detB.addEventListener("click", function (e) {
    if (e.target.closest("[data-go-adv]")) { if (!document.body.classList.contains("ss-dock")) closeDet(); SS.tab("corr"); return; }
    var fv = e.target.closest("[data-find]"); if (fv && D.view !== "find") { openFind(fv.getAttribute("data-find")); return; }
    var op = e.target.closest("[data-open]"); if (op) { openDet(+op.getAttribute("data-open")); scrollTo(+op.getAttribute("data-open")); return; }
    var ad = e.target.closest("[data-dyn-add], [data-dyn-paste]");
    if (ad) {
      var en0 = byId(D.id), f = en0 && dynFields(en0);
      if (!f) return;
      // the Advisor's functions read the Inspector's selection
      window._riFields = f.list; window._riEntryIdx = f.idx;
      if (ad.hasAttribute("data-dyn-add")) riAddCorrFromTrace(+ad.getAttribute("data-dyn-add"));
      else riOpenPasteForField(+ad.getAttribute("data-dyn-paste"));
      return;
    }
    var t = e.target.closest(".hx-tab"); if (t) { D.tab = t.getAttribute("data-tab"); D.full = {}; renderDet(); var n = detB.querySelector('.hx-tab[data-tab="' + D.tab + '"]'); if (n) n.focus(); return; }
    var f = e.target.closest("[data-full]"); if (f) { D.full[f.getAttribute("data-full")] = true; renderDet(); return; }
    var c = e.target.closest("[data-copy]"); if (!c) return;
    var en = byId(D.id); if (!en) return;
    var kind = c.getAttribute("data-copy"), txt = RequestDetails.copy(rawOf(en), kind, D.mask, en.url);
    var ok = function () { showToast(kind === "url" ? "Address copied." : "cURL command copied.", "success", 2500); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(ok, function () { showToast("Copying is not allowed here.", "warning"); });
    else showToast("Copying is not allowed here.", "warning");
  });
  det.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { e.preventDefault(); closeDet(); return; }
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName)) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      var tb = e.target.closest(".hx-tab"); if (!tb) return;
      var tabs = RequestDetails.TABS.concat(["dynamic"]), i = tabs.indexOf(D.tab);
      D.tab = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]; D.full = {}; renderDet();
      var n = detB.querySelector('.hx-tab[data-tab="' + D.tab + '"]'); if (n) n.focus();
    } else if ((e.key === "ArrowDown" || e.key === "ArrowUp") && e.target.closest(".hx-tab, .ss-det-bar")) { e.preventDefault(); step(e.key === "ArrowDown" ? 1 : -1); }
  });
  // As in the mockup: behind the sheet a backdrop dims (and blurs) the workspace; a press on it closes the sheet, and so
  // does a press anywhere in the portal around this page (sidebar, top bar). The docked panel (2400 px and wider) stays.
  var scrim = document.createElement("div");
  scrim.className = "ss-det-scrim"; scrim.id = "ss-det-scrim"; scrim.hidden = true;
  det.parentNode.insertBefore(scrim, det);
  // Escape closes the window wherever the focus is (opened from the table, say)
  document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !e.defaultPrevented && detOpen() && !document.body.classList.contains("ss-dock") && !document.querySelector("dialog[open]")) { e.preventDefault(); closeDet(); } });
  scrim.addEventListener("pointerdown", function (e) { e.preventDefault(); closeDet(); });
  new MutationObserver(function () { scrim.hidden = det.hidden || document.body.classList.contains("ss-dock"); }).observe(det, { attributes: true, attributeFilter: ["hidden"] });
  try {
    if (window.parent !== window) window.parent.document.addEventListener("pointerdown", function () { if (detOpen() && !document.body.classList.contains("ss-dock")) closeDet(); });
  } catch (err) { /* the portal is on another address: the backdrop still closes it */ }
  // A pop-up at every width; on screens 2400 px and wider the user may dock it as a fourth panel instead (pref dock,
  // the button in its bar) — before, it docked by itself there, which read as a missing pop-up on a large monitor
  var dockBtn = $("#ss-det-dock");
  function dock() {
    var wide = window.innerWidth >= 2400;
    document.body.classList.toggle("ss-dock", wide && !!prefs.dock);
    if (dockBtn) {
      dockBtn.hidden = !wide;
      dockBtn.setAttribute("aria-pressed", String(!!prefs.dock));
      dockBtn.title = prefs.dock ? "Open the details as a pop-up over the workspace" : "Show the details as a panel beside the requests (wide screens)";
      dockBtn.lastChild.textContent = prefs.dock ? "Pop-up" : "Dock";
    }
    scrim.hidden = det.hidden || document.body.classList.contains("ss-dock");
  }
  if (dockBtn) dockBtn.addEventListener("click", function () { prefs.dock = !prefs.dock; SS.save(); unmove(); dock(); });

  // The pop-up moves by its bar, like every Script Studio window: kept inside the window, it stays where it was put for
  // the next request; a double-click on the bar puts it back on the right. Not while docked.
  var bar = det.querySelector(".ss-det-bar");
  function unmove() { ["left", "right", "bottom", "height"].forEach(function (k) { det.style[k] = ""; }); det.classList.remove("ss-det-moved"); det.style.top = homeTop($("#ss-filebar").getBoundingClientRect()); }
  function clampDet() {
    if (!det.classList.contains("ss-det-moved")) return;
    var r = det.getBoundingClientRect();
    det.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, r.left)) + "px";
    det.style.top = Math.max(8, Math.min(window.innerHeight - 60, r.top)) + "px";
    det.style.height = Math.min(r.height, window.innerHeight - 16) + "px";
  }
  if (bar) {
    bar.title = "Drag to move; double-click puts it back";
    bar.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || document.body.classList.contains("ss-dock") || e.target.closest("button, input, label, select, a")) return;
      var r = det.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
      det.style.height = r.height + "px"; det.style.right = "auto"; det.style.bottom = "auto";
      det.classList.add("ss-det-moved"); det.style.left = r.left + "px"; det.style.top = r.top + "px";
      bar.setPointerCapture(e.pointerId); e.preventDefault();
      function move(ev) {
        det.style.left = Math.max(8, Math.min(window.innerWidth - r.width - 8, ev.clientX - dx)) + "px";
        det.style.top = Math.max(8, Math.min(window.innerHeight - 60, ev.clientY - dy)) + "px";
      }
      function up() { bar.removeEventListener("pointermove", move); bar.removeEventListener("pointerup", up); bar.removeEventListener("pointercancel", up); }
      bar.addEventListener("pointermove", move); bar.addEventListener("pointerup", up); bar.addEventListener("pointercancel", up);
    });
    bar.addEventListener("dblclick", function (e) { if (!e.target.closest("button, input, label, select, a")) unmove(); });
  }
  window.addEventListener("resize", clampDet);
  window.addEventListener("resize", dock); dock();

  // ── Find a value: where a value comes from and every request that sends it back, in the details sheet. The search runs
  //    in the HAR Explorer's worker (portal/har-explorer-worker.js — Studio's engine, unchanged); the answer is
  //    portal/find-value.js (the same as the Explorer's). Requests are named by Studio's request id; "Correlate this"
  //    adds the extractor to the Correlation Advisor and applies it (as Paste & Detect does). ──
  var FW = { w: null, har: null, dirty: true, seq: 0, sugg: null, studioDone: false, inv: null, map: null };
  function maps() {
    // the worker numbers requests by their place in the file (n); Studio by the entries that have a request (id)
    if (FW.map && FW.map.har === S.har1) return FW.map;
    var nToId = {}, idToN = {}, id = 0;
    ((S.har1 && S.har1.log && S.har1.log.entries) || []).forEach(function (e, i) { if (e && e.request) { id++; nToId[i + 1] = id; idToN[id] = i + 1; } });
    FW.map = { har: S.har1, nToId: nToId, idToN: idToN };
    return FW.map;
  }
  function worker() {
    if (!window.Worker || !S.har1 || S.isNetLog1) return false;
    if (!FW.w || FW.har !== S.har1) {
      if (FW.w) FW.w.terminate();
      try { FW.w = new Worker("portal/har-explorer-worker.js"); } catch (e) { FW.w = null; return false; }
      FW.har = S.har1; FW.dirty = true;
      FW.w.onmessage = function (ev) {
        var d = ev.data;
        if (d.type === "ready") { FW.sugg = d.suggestions; FW.studioDone = !!d.studioDone; if (D.view === "find") renderFind(); }
        else if (d.type === "found" && d.id === FW.seq) { FW.inv = d.result; if (D.view === "find") renderFind(); }
        else if (d.type === "error") showToast("Find a value: " + d.message, "warning");
      };
      FW.w.onerror = function () { FW.w = null; showToast("Find a value is not available in this browser.", "warning"); };
    }
    if (FW.dirty) {
      // what the script leaves out, and the Advisor's own findings (shown first, marked "Advisor")
      var m = maps(), out = [];
      reqs().forEach(function (e) { if (e.filtered && m.idToN[e.id]) out.push(m.idToN[e.id]); });
      FW.sugg = null; FW.studioDone = false; FW.dirty = false;
      FW.w.postMessage({ type: "load", text: JSON.stringify(S.har1), out: out });
      FW.w.postMessage({ type: "studioList", list: (S.advisorCandidates || []).map(function (c) { return { value: c.value, name: c.varName || "value", by: "studio" }; }) });
    }
    return true;
  }
  function find(value) {
    D.find = String(value || "").trim(); D.cn = "";
    FW.inv = null;
    if (D.find && worker()) FW.w.postMessage({ type: "find", id: ++FW.seq, value: D.find });
    renderFind();
  }
  function openFind(value) {
    if (!S.har1) return;
    if (S.isNetLog1) { showToast("Find a value needs a HAR file (a NetLog file has no response bodies).", "warning"); return; }
    D.view = "find"; D.id = null;
    det.classList.add("is-find");
    var fb = $("#ss-filebar").getBoundingClientRect();
    if (!det.classList.contains("ss-det-moved")) det.style.top = homeTop(fb);   // a pop-up the user moved stays where it was put
    det.hidden = false; document.body.classList.add("ss-det-open");
    $("#ss-det-h").textContent = "Find a value";
    worker();
    if (value != null) find(value); else renderFind();
    draw();
    var inp = $("#ss-fq"); if (inp) inp.focus();
  }
  function fnum(h) { var m = maps(); return m.nToId[h.n] || h.n; }
  function flink(h) {
    var id = fnum(h), e = byId(id) || { method: "", url: "" };
    return '<a href="#" data-go="' + id + '" data-tab="' + FindValue.tabFor(h) + '">#' + id + " " + esc(e.method) + " " + esc(split(e.url).path) + "</a>";
  }
  function inAdvisor(v) { return (S.advisorCandidates || []).filter(function (c) { return c.value === v && c.status !== "skipped"; })[0] || null; }
  function corrCode(c, name) {
    var code = S.format === "devweb" ? c.devweb : String(c.vugen || "").replace(/^\t/gm, "");
    if (!code) return "";
    return name === c.name ? code : code.split('"' + c.name + '"').join('"' + name + '"').split("ParamName=" + c.name + '"').join("ParamName=" + name + '"');
  }
  function corrPanel(inv) {
    var c = inv.corr;
    if (c.error) return '<div class="hx-corr"><div class="hx-corr-h"><h3>Correlate this</h3></div><p class="hx-corr-b ds-note warn">' + esc(c.error) + "</p></div>";
    var card = inAdvisor(inv.value), name = card ? card.varName : D.cn || c.name;
    var ref = function (n) { return S.format === "devweb" ? "${" + n + "}" : "{" + n + "}"; };
    return '<div class="hx-corr"><div class="hx-corr-h"><h3>Correlate this</h3><span class="ss-muted">' + (S.format === "devweb" ? "DevWeb" : "Web HTTP/HTML") + "</span></div>" +
      '<div class="hx-corr-b">' +
      '<label class="hx-cn"><span>Parameter name</span><input id="ss-cn" value="' + esc(name) + '" spellcheck="false" autocomplete="off"' + (card ? " disabled" : "") + "></label>" +
      '<p class="hx-corr-from">Captured from ' + esc(c.label) + " in " + flink(inv.src) + (S.format === "devweb" ? " — the extractor goes on that request" : " — registered just before that request") + ".</p>" +
      '<pre class="hx-code hx-corr-code" id="ss-corr-code">' + esc(corrCode(c, name)) + "</pre>" +
      '<p class="hx-corr-from">Then used in:</p><ul class="hx-corr-uses">' + inv.later.map(function (u) { return "<li>" + flink(u) + " — " + esc(u.where) + " → <code>" + esc(ref(name)) + "</code></li>"; }).join("") + "</ul>" +
      c.warn.map(function (w) { return '<p class="ds-note warn hx-corr-warn">' + esc(w) + "</p>"; }).join("") +
      '<div class="hx-corr-act">' + (card
        ? '<span class="hx-added"><svg class="i"><use href="#i-ok"/></svg>' + (card._applied ? "In the script" : "In the Correlation Advisor") + "</span>" + '<button type="button" class="ds-btn ds-btn-sm" data-go-adv>Open the Correlation Advisor</button>'
        : '<button type="button" class="ds-btn ds-btn-primary" data-corr-add><svg class="i"><use href="#i-ok"/></svg>Add and apply</button>') +
      '<button type="button" class="ds-btn" data-corr-copy><svg class="i"><use href="#i-copy"/></svg>Copy code</button></div>' +
      "</div></div>";
  }
  function renderFind() {
    if (D.view !== "find") return;
    var v = D.find || "", inv = FW.inv;
    var input = $("#ss-fq"), caret = input && document.activeElement === input ? input.selectionStart : null;
    var sugg = FW.sugg === null ? '<p class="hx-sugg-wait">Looking for values that change…</p>'
      : FW.sugg.length ? '<div class="hx-sugg" aria-label="Values the server sends that a later request sends back">' + FW.sugg.map(function (s) {
          return '<button type="button" data-sugg="' + esc(s.value) + '" title="' + esc(s.value) + (s.by === "studio" ? " — the Correlation Advisor suggests this one" : " — the Correlation Advisor does not find this one by itself") + '"' + (s.value === v ? ' aria-pressed="true"' : "") + ">" +
            (s.by === "studio" ? '<span class="by">Advisor</span>' : "") + "<b>" + esc(RequestDetails.short(s.name, 24)) + "</b><code>" + esc(RequestDetails.short(s.value, 22)) + "</code></button>";
        }).join("") + "</div>"
      : '<p class="hx-sugg-wait">No value in this recording comes back from the server and is sent again.</p>';
    var body;
    if (!v) body = '<p class="ds-note hx-hint">Type or paste a value above, pick one the server sends (marked <b>Advisor</b> when the Correlation Advisor suggests it too), or select a value in a request\'s Headers, Payload or Response.</p>';
    else if (!inv || inv.value !== v) body = '<p class="hx-none">Looking for ' + esc(RequestDetails.short(v, 60)) + " …</p>";
    else body = FindValue.html(inv, {
      num: fnum, link: flink, corr: inv.corr ? corrPanel(inv) : "",
      studio: function (i) { return '<p class="hx-studio">' + (i.studio || inAdvisor(i.value) ? "The Correlation Advisor suggests this one too." : "The Correlation Advisor does not find this one by itself — use <b>Correlate this</b> below.") + "</p>"; },
    });
    detB.innerHTML = '<div class="hx-dh hx-fh">' +
      "<p>Where it first came from, every request that sends it back, and what to do in the script. URL-encoded, JSON-escaped, Base64 and HTML-entity forms are found too.</p>" +
      '<div class="hx-fin"><label class="ss-search"><svg class="i"><use href="#i-search"/></svg><input class="ss-field" id="ss-fq" type="search" value="' + esc(v) + '" placeholder="e.g. a session id, a token, an order number" aria-label="Value to find" autocomplete="off" spellcheck="false"></label>' +
      (v ? '<button type="button" class="ds-btn ds-btn-sm" data-find-clear>Clear</button>' : "") + "</div>" + sugg + "</div>" +
      '<div class="hx-db">' + body + "</div>";
    $("#ss-det-pos").textContent = ""; $("#ss-det-prev").disabled = true; $("#ss-det-next").disabled = true;
    var inp = $("#ss-fq");
    if (caret != null && inp) { inp.focus(); inp.setSelectionRange(caret, caret); }
  }
  var findTimer = null;
  detB.addEventListener("input", function (e) {
    if (e.target.id === "ss-fq") { var v = e.target.value; clearTimeout(findTimer); findTimer = setTimeout(function () { find(v); }, 300); return; }
    if (e.target.id === "ss-cn" && FW.inv && FW.inv.corr) {
      D.cn = e.target.value.trim().replace(/[^A-Za-z0-9_]/g, "_");
      var n = D.cn || FW.inv.corr.name;
      $("#ss-corr-code").textContent = corrCode(FW.inv.corr, n);
      $$(".hx-corr-uses code", detB).forEach(function (c) { c.textContent = S.format === "devweb" ? "${" + n + "}" : "{" + n + "}"; });
    }
  });
  detB.addEventListener("keydown", function (e) { if (e.target.id === "ss-fq" && e.key === "Enter") { clearTimeout(findTimer); find(e.target.value); } });
  // a request in the answer opens its details (with the value marked and a way back)
  function backToFind() { var v = D.fromFind; D.fromFind = null; openFind(v); }
  function markFound(html) {
    var inv = D.fromFind != null && FW.inv;
    if (!inv || !inv.forms) return html;
    inv.forms.forEach(function (s) { var f = esc(s); if (f.length < 3) return; html = html.split(f).join("\u0001" + f + "\u0002"); });
    return html.replace(/\u0001/g, '<mark class="hx-hl">').replace(/\u0002/g, "</mark>");
  }
  function addAndApply(inv) {
    var c = inv.corr, name = (D.cn || c.name).replace(/[^A-Za-z0-9_]/g, "_");
    if (!/^[A-Za-z]/.test(name)) { showToast("The parameter name must start with a letter.", "warning"); return; }
    if ((S.correlations || []).some(function (x) { return x.name === name; }) || (S.advisorCandidates || []).some(function (x) { return x.varName === name && x.status !== "skipped"; })) {
      showToast("“" + name + "” is already used — choose another name.", "warning"); return;
    }
    var at = function (id) { var es = S.entries1 || []; for (var i = 0; i < es.length; i++) if (!es[i].isMarker && es[i].id === id) return i; return -1; };
    var src = at(c.studioId); if (src < 0) { showToast("That request is not in this reading of the recording.", "warning"); return; }
    var cand = advisorAddManual(src, "boundary", "", name, inv.value);
    cand._explorer = { extractorType: c.extractorType, extractorConfig: c.extractorConfig };
    (c.uses || []).forEach(function (u) {
      var ui = at(u.id); if (ui < 0) return;
      var known = cand.usages.some(function (k) { return k.entryIdx === ui && k.location === u.location && (k.jsonPath || null) === u.jsonPath; });
      if (!known) cand.usages.push({ entryIdx: ui, url: "", location: u.location, jsonPath: u.jsonPath });
    });
    renderAdvisorPanel();
    advisorApplyAndRegen();
    showToast("“" + name + "” added to the Correlation Advisor and applied: the script captures it at #" + c.studioId + ".", "success", 5000);
  }
  detB.addEventListener("click", function (e) {
    if (D.view !== "find") {
      if (e.target.closest("[data-back-find]")) backToFind();
      return;
    }
    var sg = e.target.closest("[data-sugg]"); if (sg) { find(sg.getAttribute("data-sugg")); return; }
    if (e.target.closest("[data-find-clear]")) { find(""); var i0 = $("#ss-fq"); if (i0) i0.focus(); return; }
    var go = e.target.closest("[data-go]");
    if (go) { e.preventDefault(); D.fromFind = D.find; D.tab = go.getAttribute("data-tab") || "headers"; D.full = {}; openDet(+go.getAttribute("data-go"), true); scrollTo(+go.getAttribute("data-go")); return; }
    if (!FW.inv || !FW.inv.corr) return;
    if (e.target.closest("[data-corr-add]")) { addAndApply(FW.inv); return; }
    if (e.target.closest("[data-corr-copy]")) {
      var txt = $("#ss-corr-code").textContent;
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(function () { showToast("Code copied.", "success", 2500); }, function () { showToast("Copying is not allowed here.", "warning"); });
    }
  });
  $("#ss-find").addEventListener("click", function () { openFind(D.view === "find" ? D.find : ""); });

  // select a value in a request's details → "Find where this value comes from"
  var selBtn = document.createElement("button");
  selBtn.type = "button"; selBtn.className = "hx-selbtn"; selBtn.hidden = true;
  selBtn.innerHTML = '<svg class="i"><use href="#i-search"/></svg>Find where this value comes from';
  document.body.appendChild(selBtn);
  document.addEventListener("mouseup", function (e) {
    if (e.target === selBtn || selBtn.contains(e.target)) return;
    setTimeout(function () {
      var s = window.getSelection(), txt = s ? s.toString().trim() : "";
      var db = $("#ss-det .hx-db");
      var inDet = D.view !== "find" && D.id != null && s && s.rangeCount && db && db.contains(s.anchorNode);
      if (!inDet || txt.length < 3 || txt.length > 2000 || /\n/.test(txt)) { selBtn.hidden = true; return; }
      var rc = s.getRangeAt(0).getBoundingClientRect();
      selBtn.style.left = Math.max(8, Math.min(window.innerWidth - 280, rc.left)) + "px";
      selBtn.style.top = Math.min(window.innerHeight - 44, rc.bottom + 6) + "px";
      selBtn.hidden = false; selBtn.dataset.v = txt;
    }, 0);
  });
  selBtn.addEventListener("click", function () { selBtn.hidden = true; openFind(selBtn.dataset.v); });

  // ── panels: hide to a rail (remembered), one click on the rail brings it back; drag the gaps to resize ──
  prefs.hide = prefs.hide || {};
  var cols = $("#ss-cols");
  function panes() {
    // steps 2 and 3 show only the right panel, at full width: never as a rail there (the step 1 choice is kept)
    var wide = document.body.classList.contains("ss-step-wide");
    ["dom", "req", "right"].forEach(function (p) { cols.classList.toggle("no-" + p, !!prefs.hide[p] && !(wide && p === "right")); });
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
    // the keyboard: the arrow keys move the bar (Shift: further), Enter puts the width back — as the drag
    rs.addEventListener("keydown", function (e) {
      var which = rs.getAttribute("data-rs"), pane = which === "dom" ? $("#ss-p-dom") : $("#ss-p-right");
      if (e.key === "Enter") { rs.dispatchEvent(new MouseEvent("dblclick")); e.preventDefault(); return; }
      if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
      e.preventDefault();
      var step = (e.shiftKey ? 96 : 24) * (e.key === "ArrowRight" ? 1 : -1) * (which === "dom" ? 1 : -1);
      var w = Math.round(pane.getBoundingClientRect().width + step);
      w = Math.max(which === "dom" ? 200 : 320, Math.min(which === "dom" ? 520 : 1400, w));
      cols.style.setProperty(which === "dom" ? "--ss-dw" : "--ss-rw", w + "px");
      if (which === "dom") prefs.wDom = w; else prefs.wRight = w;
      SS.save(); draw();
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
    // (Dynamic values are worked out again after every change: an applied correlation changes them)
    // (Find a value reads the new reading too: what is left out and the Advisor's findings may have changed)
    render: function () {
      renderTypes(); renderDomains(); renderReqs(); D.dynFor = null;
      var nc = (S.advisorCandidates || []).length, again = FW.forE !== S.entries1 || FW.forC !== nc;
      if (again) { FW.dirty = true; FW.forE = S.entries1; FW.forC = nc; }
      if (D.view === "find") { if (again) find(D.find); else renderFind(); } else if (D.id != null) renderDet();
    },
    openFind: function (v) { openFind(v); },
    openDetails: function (id) { openDet(id); },
    // "Show an example" in step 2, Correlate (as in the mockup): a request that sends back a value the
    // Advisor found, opened on its Dynamic values tab
    showExample: function () {
      var c = (S.advisorCandidates || []).filter(function (x) { return x.status !== "skipped" && x.usages && x.usages.length; })[0];
      var u = c && c.usages[0], e = u && (S.entries1 || [])[u.entryIdx];
      if (!e) { if (typeof showToast === "function") showToast("No dynamic value found in this recording yet.", "info", 4000); return; }
      D.tab = "dynamic"; D.full = {}; openDet(e.id); scrollTo(e.id);
    },
    undoToast: function (msg, undo) { undoToast(msg, undo); },
    mark: mark,
    closeDetails: function () { closeDet(); },
    showPane: showPane,
    panes: panes,
    state: W,
  };
})();
