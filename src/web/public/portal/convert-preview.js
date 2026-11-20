/* The converters' preview (Postman / Bruno and JMeter panels): after a conversion, what the ZIP holds — the servers
 * the requests call, every request grouped by folder (or thread group), the generated files with their code and the
 * values the requests send — in the same panel layout as Script Studio (data.preview from the server,
 * src/web/convertPreview.js).
 * Choosing what goes in: a tick on each server, folder / thread group and request; script settings — the script name,
 * the think time (the form's own setTT / setJmxTT, kept in step) and a server parameter's name (Rename, checked with
 * shared/host-params.js validName). Once anything differs from the ZIP, the summary bar offers Update the script — the
 * panel's own doConvert / doConvertJmx again, with the form fields leaveOut (src/core/requestSelection.js), scriptName
 * and serverNames (src/core/scriptSettings.js). The view (filter, folds, file, tab) stays. While a change is not
 * applied, Download waits.
 * Values tab: every variable the requests send or set, where its value comes from, which requests send it (a click
 * shows them); the ones with no value are named at the top.
 * Also: the download link is single-use and kept 5 minutes on the server; once used or expired, the button becomes
 * Convert again (the same choice).
 *   ConvertPreview.show(data, kind)   kind "pm" | "jmx" — called by showResult / showJmxResult (index.ejs)
 *   ConvertPreview.hide()             called by hideResults
 *   ConvertPreview.addTo(formData)    called by doConvert / doConvertJmx: notes the think time sent; on an update adds
 *                                     the choice (nothing otherwise — a plain conversion sends what it always sent)
 * Pure helpers (UMD, tests/unit/convertPreview.test.js): filterRequests, groupRequests, defaultFile, fileGroups,
 * stateOf, sameSet, needed, cleanName, serverKey, changesOf, sortValues. */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ConvertPreview = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // the requests shown: one server (or all), words in the name or the address (or none)
  function filterRequests(list, host, q) {
    q = String(q || "").trim().toLowerCase();
    return (list || []).filter(function (r) {
      if (host && r.host !== host) return false;
      if (!q) return true;
      return (r.name + " " + r.address + " " + r.method + " " + r.folder).toLowerCase().indexOf(q) !== -1;
    });
  }
  // in the order of the collection / test plan, one group per top-level folder or thread group
  function groupRequests(list) {
    var order = [], by = {};
    (list || []).forEach(function (r) {
      if (!by[r.group]) { by[r.group] = []; order.push(r.group); }
      by[r.group].push(r);
    });
    return order.map(function (g) { return { name: g, requests: by[g] }; });
  }
  // the file to show first: the main script — main.js for DevWeb (its Action.c is VuGen's empty stub), else Action.c —
  // else the first one that can be shown
  function defaultFile(files) {
    var shown = (files || []).filter(function (f) { return f.text != null; });
    var pick = function (re) { return shown.filter(function (f) { return re.test(f.path); })[0]; };
    var f = pick(/(^|\/)main\.js$/) || pick(/(^|\/)Action\.c$/) || shown[0] || (files || [])[0];
    return f ? f.path : null;
  }
  // files by folder (multi-script ZIPs have one folder per script): [{ dir, files }]
  function fileGroups(files) {
    var order = [], by = {};
    (files || []).forEach(function (f) {
      var i = f.path.lastIndexOf("/"), dir = i === -1 ? "" : f.path.slice(0, i);
      if (!by[dir]) { by[dir] = []; order.push(dir); }
      by[dir].push(f);
    });
    order.sort(function (a, b) { return a === "" ? -1 : b === "" ? 1 : a.localeCompare(b); });
    return order.map(function (d) { return { dir: d, files: by[d] }; });
  }
  // a tick for several requests: "all" in, "none" in, or "some"
  function stateOf(nums, out) {
    var o = 0; nums.forEach(function (n) { if (out.has(n)) o++; });
    return o === 0 ? "all" : o === nums.length ? "none" : "some";
  }
  function sameSet(a, b) {
    if (a.size !== b.size) return false;
    var same = true; a.forEach(function (x) { if (!b.has(x)) same = false; });
    return same;
  }

  // values the kept requests would send empty: set only by requests left out, used by a kept one
  // → [{ name, by: [numbers left out that set it], usedBy: [kept numbers that send it] }]
  function needed(list, out) {
    var setIn = {}, setOut = {}, order = [];
    (list || []).forEach(function (r) {
      (r.sets || []).forEach(function (k) {
        var m = out.has(r.n) ? setOut : setIn;
        if (!setIn[k] && !setOut[k]) order.push(k);
        (m[k] = m[k] || []).push(r.n);
      });
    });
    return order.filter(function (k) { return setOut[k] && !setIn[k]; }).map(function (k) {
      return { name: k, by: setOut[k], usedBy: (list || []).filter(function (r) { return !out.has(r.n) && (r.uses || []).indexOf(k) !== -1; }).map(function (r) { return r.n; }) };
    }).filter(function (x) { return x.usedBy.length; });
  }

  // the script name as the server keeps it (src/core/scriptSettings.js cleanScriptName — keep the two in step)
  function cleanName(text) {
    var s = String(text == null ? "" : text).replace(/[^A-Za-z0-9 _.-]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
    return /[A-Za-z0-9]/.test(s) ? s : "";
  }
  // how a server is compared (scriptSettings.js serverKey)
  function serverKey(host) { return String(host || "").trim().toLowerCase().replace(/:(443|80)$/, ""); }

  // what differs from the ZIP: [label] — st = { out, gen, name, genName, tt, genTT, renamed, env, values, wlm }
  function changesOf(st) {
    var c = [];
    if (!sameSet(st.out, st.gen)) c.push("the requests");
    if (st.name !== st.genName) c.push("the script name");
    if (st.tt != null && st.genTT != null && Number(st.tt) !== Number(st.genTT)) c.push("the think time");
    if (st.renamed) c.push(st.renamed === 1 ? "a server name" : st.renamed + " server names");
    if (st.env) c.push("the environment");
    if (st.values) c.push(st.values === 1 ? "a value" : st.values + " values");
    if (st.wlm) c.push("the workload workbook");
    return c;
  }

  // the Values tab's order: no value first, then empty, then as the requests first send them
  var RANK = { missing: 0, empty: 1 };
  function sortValues(list) {
    return (list || []).map(function (v, i) { return { v: v, i: i }; }).sort(function (a, b) {
      var ra = RANK[a.v.source] != null ? RANK[a.v.source] : 2, rb = RANK[b.v.source] != null ? RANK[b.v.source] : 2;
      return ra - rb || a.i - b.i;
    }).map(function (x) { return x.v; });
  }

  // a JMeter thread group's settings in words: "setUp · 10 users · ramp-up 10 s · hold 300 s · loops until stopped"
  function tgText(t) {
    var p = [], s = function (n) { return Number(n) >= 120 && Number(n) % 60 === 0 ? Number(n) / 60 + " min" : n + " s"; };
    if (t.type && /^(setup|teardown)$/i.test(t.type)) p.push(/^setup$/i.test(t.type) ? "setUp" : "tearDown");
    if (t.virtualUsers != null) p.push(t.virtualUsers + (Number(t.virtualUsers) === 1 ? " user" : " users"));
    if (Number(t.rampUpSec) > 0) p.push("ramp-up " + s(t.rampUpSec));
    if (Number(t.holdSec) > 0) p.push("hold " + s(t.holdSec));
    if (t.iterations != null && t.iterations !== "") p.push(/^infinite$/i.test(String(t.iterations)) || Number(t.iterations) < 0 ? "loops until stopped" : t.iterations + (Number(t.iterations) === 1 ? " loop" : " loops"));
    if (t.enabled === false) p.push("off in the test plan");
    return p.join(" · ");
  }

  var api = { tgText: tgText, filterRequests: filterRequests, groupRequests: groupRequests, defaultFile: defaultFile, fileGroups: fileGroups, stateOf: stateOf, sameSet: sameSet, needed: needed, cleanName: cleanName, serverKey: serverKey, changesOf: changesOf, sortValues: sortValues };
  if (typeof document === "undefined") return api;

  // ── the page ──
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  var plural = function (n, w) { return n + " " + w + (n === 1 ? "" : "s"); };
  var KEEP_MS = 5 * 60 * 1000 - 15000;   // the server keeps the download 5 minutes; a little earlier, to be safe
  var TT = [1, 2, 3, 5];                 // the form's think-time choices
  var P = null, kind = "pm", host = "", q = "", file = null, folded = {}, showAll = {}, timer = null, used = false, expired = false;
  var out = new Set(), gen = new Set();       // left out now (the ticks) / left out in the ZIP
  var updating = false, keepView = false, source = null;
  var tab = "files", vf = "", ren = "", renErr = "", renVal = "";   // right pane tab, a value's requests shown, the server being renamed
  // the user's script settings — kept over updates and sent with each one; orig = the converter's own choices
  var chosen = { name: "", names: {}, values: {} }, atGen = { name: "", names: {}, values: {} }, orig = { name: "", params: {} };
  var sentTT = null, genTT = null, sentEnv = null, genEnv = null, sentWlm = null, genWlm = null;
  var editV = "", editVal = "";                // the value being given in the Values tab
  var TG = {};                                 // JMeter: the thread groups' settings by name (data.threadGroups)
  var blobUrl = "", zipFile = null, handAfter = false;   // the ZIP kept in the browser once handed to the Workload Modeller
  var ICON = {
    server: '<path d="M4 5h16v6H4zM4 13h16v6H4z"/><path d="M8 8h.01M8 16h.01"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    vars: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    redo: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
  };
  var ico = function (k) { return '<svg class="cv-pv-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + "</svg>"; };
  var nums = function (list) { return list.map(function (r) { return r.n; }); };
  var tick = function (attr, st, label) {
    return '<input type="checkbox" class="cv-pv-cb" ' + attr + (st === "all" ? " checked" : "") + (st === "some" ? " data-some" : "") + ' aria-label="' + esc(label) + '" />';
  };
  var listN = function (a) { return a.length > 4 ? a.slice(0, 4).join(", ") + " and " + (a.length - 4) + " more" : a.join(", "); };

  function box() {
    var el = document.getElementById("cv-pv");
    if (el) return el;
    var ok = document.getElementById("res-ok"), act = ok && ok.querySelector(".res-actions");
    if (!ok) return null;
    el = document.createElement("section");
    el.id = "cv-pv"; el.className = "cv-pv"; el.hidden = true; el.setAttribute("aria-label", "What the script contains");
    ok.insertBefore(el, act || null);
    el.addEventListener("click", onClick);
    el.addEventListener("change", onChange);
    el.addEventListener("input", onInput);
    el.addEventListener("keydown", function (e) { if (!onRsKey(e)) onKey(e); });
    el.addEventListener("pointerdown", onRsDown);
    el.addEventListener("dblclick", function (e) { var r = e.target.closest(".cv-pv-rs"); if (!r) return; if (r.getAttribute("data-pv-rs") === "hosts") delete lay.w1; else delete lay.w3; laySave(); layout(); });
    window.addEventListener("resize", function () { if (P) layout(); });
    // the form's think time and the strip's stay in step (the form's setters are the source of truth)
    document.addEventListener("change", function (e) { if (P && e.target && e.target.id === "fi-env") setTimeout(function () { drawSet(); drawBar(); }, 0); });
    ["setTT", "setJmxTT", "setJmxWlm", "clearFile", "attachFile"].forEach(function (fn) {
      var o = window[fn];
      if (typeof o !== "function" || o._cvPv) return;
      window[fn] = function () { var r = o.apply(this, arguments); if (P) { drawSet(); drawBar(); } return r; };
      window[fn]._cvPv = true;
    });
    return el;
  }
  function currentFile() {
    try { return kind === "jmx" ? (typeof JX !== "undefined" && JX.file) : (typeof F !== "undefined" && F.collection); } catch (e) { return null; }
  }
  function curTT() {
    try { return kind === "jmx" ? (typeof JX !== "undefined" ? JX.tt : null) : (typeof S !== "undefined" ? S.tt : null); } catch (e) { return null; }
  }
  function setTTNow(t) {
    var fn = kind === "jmx" ? window.setJmxTT : window.setTT;
    if (typeof fn === "function") fn(t);
  }
  function curEnv() { try { return typeof F !== "undefined" ? F.environment || null : null; } catch (e) { return null; } }
  function curWlm() { try { return typeof JX !== "undefined" ? String(!!JX.wlm) : null; } catch (e) { return null; } }
  function valuesChanged() {
    var a = chosen.values, b = atGen.values, n = 0;
    Object.keys(a).forEach(function (k) { if (a[k] !== b[k]) n++; });
    Object.keys(b).forEach(function (k) { if (!(k in a)) n++; });
    return n;
  }
  var nameNow = function () { return chosen.name || orig.name; };
  var paramNow = function (h) { return chosen.names[serverKey(h.host)] || orig.params[serverKey(h.host)] || h.param; };
  function renamedCount() { return P.hosts.filter(function (h) { return h.param && paramNow(h) !== h.param; }).length; }
  function changes() {
    return changesOf({ out: out, gen: gen, name: nameNow(), genName: P.scriptName, tt: curTT(), genTT: genTT, renamed: renamedCount(),
      env: kind === "pm" && curEnv() !== genEnv, wlm: kind === "jmx" && genWlm != null && curWlm() !== genWlm, values: valuesChanged() });
  }

  function show(data, k) {
    var el = box(); if (!el) return;
    var keep = keepView; keepView = false;
    P = data && data.preview; kind = k === "jmx" ? "jmx" : "pm";
    if (!keep) {
      host = ""; q = ""; folded = {}; showAll = {}; file = null; tab = "files"; vf = "";
      chosen = { name: "", names: {}, values: {} };
      orig = { name: P ? P.scriptName || "" : "", params: {} };
      if (P && P.hosts) P.hosts.forEach(function (h) { if (h.param) orig.params[serverKey(h.host)] = h.param; });
    }
    ren = ""; renErr = ""; editV = ""; editVal = "";
    used = false; expired = false;
    if (blobUrl) { try { URL.revokeObjectURL(blobUrl); } catch (e) { /* gone */ } }
    blobUrl = ""; zipFile = null;
    TG = {};
    ((data && data.threadGroups) || []).forEach(function (t) { if (t && t.name) TG[t.name] = t; });
    if (!P || !P.requests) { el.hidden = true; el.innerHTML = ""; handAfter = false; return; }
    gen = new Set(P.requests.filter(function (r) { return r.out; }).map(function (r) { return r.n; }));
    out = new Set(gen);
    genTT = sentTT != null ? sentTT : curTT();
    genEnv = kind === "pm" ? sentEnv : null;
    genWlm = kind === "jmx" ? (sentWlm != null ? sentWlm : curWlm()) : null;
    // the server's verdict wins: a name it did not take is dropped from the choice
    if (chosen.name && chosen.name !== P.scriptName) chosen.name = P.scriptName === orig.name ? "" : P.scriptName;
    P.hosts.forEach(function (h) { var key = serverKey(h.host); if (chosen.names[key] && h.param && chosen.names[key] !== h.param) delete chosen.names[key]; });
    atGen = { name: chosen.name, names: Object.assign({}, chosen.names), values: Object.assign({}, chosen.values) };
    if (vf && !(P.variables || []).some(function (v) { return v.name === vf; })) vf = "";
    source = currentFile();
    if (!file || !P.files.some(function (f) { return f.path === file; })) file = defaultFile(P.files);
    var vars = P.variables || [], noValue = vars.filter(function (v) { return v.source === "missing"; });
    var missingHosts = P.hosts.filter(function (h) { return (h.state || (h.resolved ? "resolved" : "missing")) === "missing"; });
    el.innerHTML =
      '<div class="cv-pv-head"><div><h3>What the script contains</h3><p>Untick what the script should leave out, change its settings, then <b>Update the script</b>. ' +
        (kind === "jmx" ? "Requests are grouped by thread group." : "Requests are grouped by folder.") + "</p></div>" +
        (window.PerfxShell ? '<button type="button" class="cv-pv-btn" id="cv-pv-wm" title="Open this ZIP in the Workload Modeller to work out the Vusers, pacing and load generators">' + ico("chart") + "Plan the load in Workload Modeller</button>" : "") +
        "</div>" +
      warnHtml(missingHosts, noValue) +
      '<div class="cv-pv-bar" id="cv-pv-bar" role="status" aria-live="polite"></div>' +
      '<div class="cv-pv-set" id="cv-pv-set"></div>' +
      '<div class="cv-pv-cols" id="cv-pv-cols">' +
        '<div class="cv-pv-pane" id="cv-pv-hosts">' + rail("hosts", "server", "Servers", P.hosts.length) + '<div class="cv-pv-ph">' + ico("server") + '<h4>Servers</h4><span class="cv-pv-n">' + P.hosts.length + "</span>" + hideBtn("hosts", "Servers") + "</div>" +
          '<div class="cv-pv-body" id="cv-pv-hlist"></div></div>' +
        rsBar("hosts", "Width of Servers") +
        '<div class="cv-pv-pane" id="cv-pv-reqs">' + rail("reqs", "list", "Requests", P.requests.length) + '<div class="cv-pv-ph">' + ico("list") + '<h4>Requests</h4><span class="cv-pv-n" id="cv-pv-rn"></span>' +
          '<label class="cv-pv-search">' + ico("search") + '<input id="cv-pv-q" type="search" placeholder="Filter by name or address" aria-label="Filter the requests" value="' + esc(q) + '" /></label>' +
          '<span id="cv-pv-vfchip"></span>' + hideBtn("reqs", "Requests") + "</div>" +
          '<div class="cv-pv-body" id="cv-pv-rlist"></div></div>' +
        rsBar("files", "Width of Files and Values") +
        '<div class="cv-pv-pane" id="cv-pv-files">' + rail("files", "file", "Files · Values", P.files.length) + '<div class="cv-pv-ph">' +
          '<div class="cv-pv-tabs" role="tablist" aria-label="Files and values">' +
            '<button type="button" role="tab" class="cv-pv-tab" id="cv-pv-tab-files" data-tab="files" aria-controls="cv-pv-fbody">' + ico("file") + 'Files <span class="cv-pv-n">' + P.files.length + "</span></button>" +
            '<button type="button" role="tab" class="cv-pv-tab" id="cv-pv-tab-values" data-tab="values" aria-controls="cv-pv-vlist">' + ico("vars") + 'Values <span class="cv-pv-n' + (noValue.length ? " warn" : "") + '">' + vars.length + "</span></button>" +
          "</div>" +
          '<span class="cv-pv-ftools"><select id="cv-pv-file" class="cv-pv-sel" aria-label="File to show"></select>' +
          '<button type="button" class="cv-pv-btn" id="cv-pv-copy" title="Copy this file">' + ico("copy") + "Copy</button></span>" + hideBtn("files", "Files and Values") + "</div>" +
          '<div class="cv-pv-body cv-pv-codebox" id="cv-pv-fbody" role="tabpanel" aria-labelledby="cv-pv-tab-files"><pre class="cv-pv-code" id="cv-pv-code" tabindex="0"></pre></div>' +
          '<div class="cv-pv-body" id="cv-pv-vlist" role="tabpanel" aria-labelledby="cv-pv-tab-values"></div></div>' +
      "</div>";
    el.hidden = false;
    drawSet(); drawAll(); drawFiles(); drawFile(); drawValues(); drawTab(); layout();
    watchDownload();
    if (handAfter) { handAfter = false; handOff(); }
    else if (keep) setTimeout(function () { el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
  }
  // ── the three panels: hide one to a rail, drag the bar between two (or its arrow keys; double-click puts it back) —
  //    remembered in this browser (localStorage perfx-cv-pv); never all hidden; on narrow screens they stack, all shown ──
  var LKEY = "perfx-cv-pv", lay = { hide: {} };
  try { lay = JSON.parse(localStorage.getItem(LKEY) || "{}") || {}; } catch (e) { lay = {}; }
  lay.hide = lay.hide || {};
  function laySave() { try { localStorage.setItem(LKEY, JSON.stringify(lay)); } catch (e) { /* private window */ } }
  var PANES = { hosts: "cv-pv-hosts", reqs: "cv-pv-reqs", files: "cv-pv-files" };
  function hideBtn(k, name) {
    return '<button type="button" class="cv-pv-ibtn cv-pv-hide" data-pv-hide="' + k + '" title="Hide this panel (the others get the space)" aria-label="Hide ' + name + '">' + ico("panel") + "</button>";
  }
  function rail(k, icon, name, n) {
    return '<button type="button" class="cv-pv-rail" data-pv-show="' + k + '" title="Show ' + name + '">' + ico(icon) + "<span>" + name + '</span><span class="cv-pv-n">' + n + "</span></button>";
  }
  function rsBar(k, label) {
    return '<div class="cv-pv-rs" data-pv-rs="' + k + '" role="separator" aria-orientation="vertical" tabindex="0" aria-label="' + label + ': drag, or the arrow keys; double-click puts it back" title="Drag to resize (double-click puts it back)"></div>';
  }
  function layout() {
    var cols = document.getElementById("cv-pv-cols"); if (!cols) return;
    var h = lay.hide;
    if (h.hosts && h.reqs && h.files) h.reqs = false;
    Object.keys(PANES).forEach(function (k) { var p = document.getElementById(PANES[k]); if (p) p.classList.toggle("is-hidden", !!h[k]); });
    var c1 = h.hosts ? "44px" : lay.w1 ? lay.w1 + "px" : "minmax(200px, 260px)";
    var c3 = h.files ? "44px" : h.reqs ? "minmax(0, 1fr)" : lay.w3 ? lay.w3 + "px" : "minmax(0, 1.15fr)";
    var c2 = h.reqs ? "44px" : "minmax(0, 1fr)";
    if (h.reqs && h.files) c2 = "minmax(0, 1fr)";
    cols.style.setProperty("--cv-cols", c1 + " 12px " + c2 + " 12px " + c3);
    // the last panel shown cannot be hidden
    Object.keys(PANES).forEach(function (k) {
      var hb = cols.querySelector('[data-pv-hide="' + k + '"]'), last = Object.keys(PANES).every(function (x) { return x === k || h[x]; });
      if (hb) { hb.disabled = last; hb.title = last ? "The last panel shown stays" : "Hide this panel (the others get the space)"; }
    });
    Array.prototype.forEach.call(cols.querySelectorAll(".cv-pv-rs"), function (r) {
      var k = r.getAttribute("data-pv-rs"), off = k === "hosts" ? !!(h.hosts || h.reqs) : !!(h.files || h.reqs);
      r.classList.toggle("off", off); r.tabIndex = off ? -1 : 0;
      var pane = document.getElementById(PANES[k]);
      if (pane) r.setAttribute("aria-valuenow", String(Math.round(pane.getBoundingClientRect().width)));
    });
  }
  function setPane(k, on) {
    var others = Object.keys(PANES).filter(function (x) { return x !== k; });
    if (!on && others.every(function (x) { return lay.hide[x]; })) return;   // the last panel shown stays
    lay.hide[k] = !on;
    laySave(); layout();
    var b = document.querySelector('#cv-pv [data-pv-' + (on ? "hide" : "show") + '="' + k + '"]'); if (b) b.focus();
  }
  function setW(k, w) {
    var cols = document.getElementById("cv-pv-cols"); if (!cols) return;
    var total = cols.getBoundingClientRect().width, max = Math.max(260, total - 520);
    w = Math.max(k === "hosts" ? 180 : 300, Math.min(max, Math.round(w)));
    if (k === "hosts") lay.w1 = w; else lay.w3 = w;
    layout();
  }
  function onRsDown(e) {
    var r = e.target.closest(".cv-pv-rs"); if (!r || r.classList.contains("off")) return;
    var k = r.getAttribute("data-pv-rs"), pane = document.getElementById(PANES[k]), x0 = e.clientX, w0 = pane.getBoundingClientRect().width;
    e.preventDefault(); r.setPointerCapture(e.pointerId); r.classList.add("on");
    function move(ev) { setW(k, k === "hosts" ? w0 + (ev.clientX - x0) : w0 - (ev.clientX - x0)); }
    function up() { r.removeEventListener("pointermove", move); r.removeEventListener("pointerup", up); r.classList.remove("on"); laySave(); }
    r.addEventListener("pointermove", move); r.addEventListener("pointerup", up);
  }
  function onRsKey(e) {
    var r = e.target.closest && e.target.closest(".cv-pv-rs"); if (!r || r.classList.contains("off")) return false;
    var k = r.getAttribute("data-pv-rs"), w = document.getElementById(PANES[k]).getBoundingClientRect().width, step = e.shiftKey ? 96 : 24;
    var grow = k === "hosts" ? 1 : -1;   // the Files bar: the arrow points the way the bar moves
    if (e.key === "ArrowRight") setW(k, w + grow * step);
    else if (e.key === "ArrowLeft") setW(k, w - grow * step);
    else if (e.key === "Enter") { if (k === "hosts") delete lay.w1; else delete lay.w3; layout(); }
    else return false;
    e.preventDefault(); laySave(); return true;
  }
  // the warning above the panels: the values nothing gives a value, the servers among them named
  function warnHtml(missingHosts, noValue) {
    if (!missingHosts.length && !noValue.length) return "";
    var names = noValue.slice(0, 6).map(function (v) { return "<code>" + esc(v.name) + "</code>"; }).join(", ") + (noValue.length > 6 ? " …" : "");
    var hosts = missingHosts.map(function (h) { return "<code>" + esc(h.host) + "</code>"; }).join(", ");
    var n = noValue.length || missingHosts.length;
    return '<div class="cv-pv-warn" role="note">' + ico("warn") + "<span><b>" + (n === 1 ? "1 value has" : n + " values have") + " nothing that gives " + (n === 1 ? "it" : "them") + " a value</b>" +
      (names ? " (" + names + ")" : "") + (hosts ? " — " + (missingHosts.length === 1 ? "the server " : "the servers ") + hosts + (missingHosts.length === 1 ? " is" : " are") + " among them" : "") +
      ": the script sends " + (n === 1 ? "it" : "them") + " as written. " + (kind === "jmx" ? "Give " + (n === 1 ? "it a value" : "them values") + " in Values." : "Add the environment file that defines " + (n === 1 ? "it" : "them") + ", or give " + (n === 1 ? "it a value" : "them values") + " in Values.") +
      ' <button type="button" class="cv-pv-link" data-tab="values">See Values</button></span></div>';
  }

  function hide() {
    var el = document.getElementById("cv-pv");
    clearTimeout(timer);
    if (updating) { if (el) el.hidden = true; return; }   // an update: the choice and the view come back with the answer
    if (el) { el.hidden = true; el.innerHTML = ""; }
    P = null; keepView = false; out = new Set(); gen = new Set(); resetDownload();
  }
  // the form of the next conversion: notes the think time sent; on an update, the choice (only what was chosen — a
  // plain conversion sends exactly what it always sent)
  function addTo(fd) {
    try {
      if (fd && fd.get) {
        var t = Number(fd.get("thinkTime")); sentTT = isFinite(t) ? t : null;
        sentEnv = fd.get("environment") || null;
        var w = fd.get("generateWlmExcel"); sentWlm = w == null ? null : String(w === true || w === "true");
      }
    } catch (e) { sentTT = null; sentEnv = null; sentWlm = null; }
    if (!updating) { keepView = false; return; }
    updating = false; keepView = true;
    if (!fd || !fd.append) return;
    if (out.size) fd.append("leaveOut", JSON.stringify(Array.from(out).sort(function (a, b) { return a - b; })));
    if (chosen.name) fd.append("scriptName", chosen.name);
    if (Object.keys(chosen.names).length) fd.append("serverNames", JSON.stringify(chosen.names));
    if (Object.keys(chosen.values).length) fd.append("values", JSON.stringify(chosen.values));
  }
  function update() {
    if (!P) return;
    if (currentFile() !== source) { out = new Set(); }            // another file was chosen: start from all its requests
    updating = true;
    if (kind === "jmx" && typeof window.doConvertJmx === "function") window.doConvertJmx();
    else if (typeof window.doConvert === "function") window.doConvert();
    else updating = false;
  }
  function undo() {
    out = new Set(gen);
    chosen = { name: atGen.name, names: Object.assign({}, atGen.names), values: Object.assign({}, atGen.values) };
    ren = ""; renErr = ""; editV = "";
    if (genTT != null && Number(curTT()) !== Number(genTT)) setTTNow(genTT);
    if (kind === "jmx" && genWlm != null && curWlm() !== genWlm && typeof window.setJmxWlm === "function") window.setJmxWlm(genWlm === "true");
    if (kind === "pm" && curEnv() !== genEnv) {
      if (genEnv && typeof window.attachFile === "function") window.attachFile("dz-env", "environment", genEnv);
      else if (!genEnv && typeof window.clearFile === "function") window.clearFile("dz-env", "environment");
    }
    drawValues();
    drawSet(); drawAll();
  }

  function drawAll() { drawBar(); drawHosts(); drawRequests(); }
  function drawBar() {
    var total = P.requests.length, inn = total - out.size, ch = changes(), pending = ch.length > 0;
    var bar = document.getElementById("cv-pv-bar");
    bar.className = "cv-pv-bar" + (pending ? " pending" : "");
    bar.hidden = !pending && !gen.size && !out.size;
    bar.innerHTML = '<span class="cv-pv-sum"><b>' + inn + " of " + total + "</b> " + (total === 1 ? "request" : "requests") + " in the script" +
      (gen.size && !pending ? ' <span class="cv-pv-muted">· ' + gen.size + " left out</span>" : "") + "</span>" +
      (pending ? '<span class="cv-pv-note">' + (inn ? "Changed: " + ch.join(", ") + " — the ZIP does not have it yet." : "Keep at least one request.") + "</span>" +
        '<span class="cv-pv-grow"></span><button type="button" class="cv-pv-btn" id="cv-pv-undo">Undo changes</button>' +
        '<button type="button" class="cv-pv-btn primary" id="cv-pv-update"' + (inn ? "" : " disabled") + ">" + ico("redo") + "Update the script</button>"
        : gen.size ? '<span class="cv-pv-grow"></span><button type="button" class="cv-pv-btn" id="cv-pv-all">Put all back</button>' : "");
    var need = needed(P.requests, out);
    if (need.length) bar.innerHTML += '<div class="cv-pv-need" role="note">' + ico("warn") + "<span>" + need.slice(0, 3).map(function (x) {
      return "<code>" + esc(x.name) + "</code> is set by " + (x.by.length === 1 ? "request " : "requests ") + listN(x.by) + " (left out) and sent by " + (x.usedBy.length === 1 ? "request " : "requests ") + listN(x.usedBy);
    }).join("; ") + (need.length > 3 ? "; and " + (need.length - 3) + " more values" : "") + ". Without " + (need.length === 1 ? "it" : "them") + " the script sends " + (need.length === 1 ? "it" : "them") + " empty — keep the request that sets " + (need.length === 1 ? "it" : "them") + ", or give " + (need.length === 1 ? "it a value" : "them values") + " in the " + (kind === "jmx" ? "test plan" : "environment") + ".</span></div>";
    var dl = document.getElementById("btn-dl");
    if (dl) { dl.classList.toggle("cv-pv-wait", pending); if (pending) dl.setAttribute("aria-disabled", "true"); else dl.removeAttribute("aria-disabled"); }
  }

  // the script settings: name (the .usr, the metadata and the ZIP — every script of a multi-script ZIP), think time
  function drawSet() {
    var box = document.getElementById("cv-pv-set"); if (!box || !P) return;
    var tt = Number(curTT()), active = document.activeElement && document.activeElement.id === "cv-pv-name";
    var html =
      '<label class="cv-pv-field cv-pv-fname"><span class="cv-pv-flabel">Script name</span>' +
        '<input id="cv-pv-name" type="text" maxlength="60" spellcheck="false" autocomplete="off" placeholder="' + esc(orig.name || "Script") + '" value="' + esc(nameNow()) + '" aria-describedby="cv-pv-name-h" /></label>' +
      '<div class="cv-pv-field"><span class="cv-pv-flabel" id="cv-pv-l-tt">Think time</span>' +
        '<div class="seg-btns" role="group" aria-labelledby="cv-pv-l-tt">' + TT.map(function (n) {
          return '<button type="button" class="seg-btn' + (n === tt ? " active" : "") + '" data-tt="' + n + '" aria-pressed="' + (n === tt) + '">' + n + "s</button>";
        }).join("") + "</div></div>" +
      (kind === "pm" ? (function () {
        var env = curEnv();
        return '<div class="cv-pv-field"><span class="cv-pv-flabel" id="cv-pv-l-env">Environment</span><div class="cv-pv-env" role="group" aria-labelledby="cv-pv-l-env">' +
          '<span class="cv-pv-envname' + (env ? "" : " none") + '" title="' + esc(env ? env.name : "") + '">' + esc(env ? env.name : "None") + "</span>" +
          '<button type="button" class="cv-pv-btn" data-env-pick>' + (env ? "Change" : "Choose") + "…</button>" +
          (env ? '<button type="button" class="cv-pv-btn" data-env-clear>Remove</button>' : "") + "</div></div>";
      })() : (function () {
        var w = curWlm() === "true";
        return '<div class="cv-pv-field"><span class="cv-pv-flabel" id="cv-pv-l-wlm">Workload workbook</span><div class="seg-btns" role="group" aria-labelledby="cv-pv-l-wlm">' +
          '<button type="button" class="seg-btn' + (w ? " active" : "") + '" data-wlm="1" aria-pressed="' + w + '">Include</button>' +
          '<button type="button" class="seg-btn' + (w ? "" : " active") + '" data-wlm="0" aria-pressed="' + !w + '">Leave out</button></div></div>';
      })()) +
      '<p class="cv-pv-muted cv-pv-fhelp" id="cv-pv-name-h">The name is given to the .usr file' + (P.files.some(function (f) { return f.path.indexOf("/") !== -1; }) ? " of every script" : "") + " and to the ZIP; the think time is the pause between steps.</p>";
    var typed = active ? document.getElementById("cv-pv-name") : null, v = typed && typed.value, at = typed && typed.selectionStart;
    box.innerHTML = html;
    if (typed) {   // typing in the name: the field keeps what is typed, the focus and the caret
      var i = document.getElementById("cv-pv-name");
      i.value = v; i.focus(); try { i.setSelectionRange(at, at); } catch (e) { /* not a text field */ }
    }
  }

  function drawHosts() {
    var allNums = nums(P.requests);
    document.getElementById("cv-pv-hlist").innerHTML =
      '<div class="cv-pv-host' + (host ? "" : " on") + '">' + tick('data-tick-all', stateOf(allNums, out), "Every request") +
        '<button type="button" class="cv-pv-hb" data-host="" aria-pressed="' + !host + '"><span class="cv-pv-hn">All servers</span><span class="cv-pv-c">' + P.requests.length + "</span></button></div>" +
      P.hosts.map(function (h) {
        var st = h.state || (h.resolved ? "resolved" : "missing"), hn = nums(P.requests.filter(function (r) { return r.host === h.host; }));
        var key = serverKey(h.host), pn = h.param ? paramNow(h) : "";
        return '<div class="cv-pv-hwrap"><div class="cv-pv-host' + (h.host === host ? " on" : "") + (st === "missing" ? " var" : "") + (stateOf(hn, out) === "none" ? " is-out" : "") + '">' +
          tick('data-tick-host="' + esc(h.host) + '"', stateOf(hn, out), "Requests to " + h.host) +
          '<button type="button" class="cv-pv-hb" data-host="' + esc(h.host) + '" aria-pressed="' + (h.host === host) + '"' +
          (st === "missing" ? ' title="A variable nothing gives a value: the script calls it as written"' : st === "runtime" ? ' title="Set while the script runs (by a script or an extractor)"' : ' title="Show only its requests"') +
          '><span class="cv-pv-hn">' + (st === "missing" ? ico("warn") : "") + esc(h.host) +
          (st === "runtime" ? '<small class="cv-pv-rtag">set while the script runs</small>' : "") +
          (pn ? '<small class="cv-pv-param">Parameter <code>' + esc(pn) + "</code>" + (pn !== h.param ? ' <span class="cv-pv-chg">changed</span>' : "") + "</small>" : "") +
          '</span><span class="cv-pv-c">' + h.count + "</span></button>" +
          (pn ? '<button type="button" class="cv-pv-ibtn" data-rename="' + esc(h.host) + '" title="Rename the parameter ' + esc(pn) + '" aria-label="Rename the parameter ' + esc(pn) + '">' + ico("pen") + "</button>" : "") +
          "</div>" +
          (ren === h.host ? '<div class="cv-pv-ren"><label class="cv-pv-flabel" for="cv-pv-ren-in">Parameter name</label>' +
            '<input id="cv-pv-ren-in" type="text" maxlength="40" spellcheck="false" autocomplete="off" value="' + esc(renVal) + '" aria-describedby="cv-pv-ren-err"' + (renErr ? ' aria-invalid="true"' : "") + " />" +
            '<button type="button" class="cv-pv-btn primary" data-ren-ok="' + esc(key) + '">Save</button><button type="button" class="cv-pv-btn" data-ren-cancel>Cancel</button>' +
            '<p class="cv-pv-err" id="cv-pv-ren-err" role="alert">' + esc(renErr) + "</p></div>" : "") +
          "</div>";
      }).join("");
    someMarks("cv-pv-hlist");
    if (ren) { var i = document.getElementById("cv-pv-ren-in"); if (i) { i.focus(); i.select(); } }
  }
  function saveRename(key) {
    var input = document.getElementById("cv-pv-ren-in"), h = P.hosts.filter(function (x) { return serverKey(x.host) === key; })[0];
    if (!input || !h) return;
    var name = input.value.trim(), taken = {};
    P.hosts.forEach(function (x) { if (x.param && x !== h) taken[x.host] = paramNow(x); });
    var extra = (P.variables || []).map(function (v) { return v.name; });
    var err = window.HostParams && window.HostParams.validName ? window.HostParams.validName(name, h.host, taken, extra)
      : (/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name) ? "" : "Use letters, numbers and underscores only, starting with a letter or an underscore.");
    if (err) { renErr = err; drawHosts(); return; }
    if (name === orig.params[key]) delete chosen.names[key]; else chosen.names[key] = name;
    ren = ""; renErr = "";
    drawAll();
  }

  var MAX_ROWS = 300;   // per group, before "Show all"
  function visible() {
    var list = P.requests;
    if (vf) { var v = (P.variables || []).filter(function (x) { return x.name === vf; })[0], set = new Set(v ? v.usedBy.concat(v.setBy) : []); list = list.filter(function (r) { return set.has(r.n); }); }
    return filterRequests(list, host, q);
  }
  function drawRequests() {
    var list = visible(), groups = groupRequests(list);
    document.getElementById("cv-pv-rn").textContent = list.length === P.requests.length ? String(list.length) : list.length + " of " + P.requests.length;
    document.getElementById("cv-pv-vfchip").innerHTML = vf ? '<button type="button" class="cv-pv-chip" data-vf-clear title="Show every request">Using <code>' + esc(vf) + "</code>" + ico("x") + "</button>" : "";
    var html = groups.map(function (g) {
      var f = !!folded[g.name], rows = showAll[g.name] ? g.requests : g.requests.slice(0, MAX_ROWS), gs = stateOf(nums(g.requests), out);
      return '<div class="cv-pv-grp' + (f ? " folded" : "") + (gs === "none" ? " is-out" : "") + '"><div class="cv-pv-gh">' +
        tick('data-tick-group="' + esc(g.name) + '"', gs, "Every request in " + g.name) +
        '<button type="button" class="cv-pv-gb" data-group="' + esc(g.name) + '" aria-expanded="' + !f + '">' + ico("chev") +
        '<b>' + esc(g.name) + '</b><span class="cv-pv-muted">' + plural(g.requests.length, "request") + "</span>" +
        (TG[g.name] ? '<span class="cv-pv-tg">' + esc(tgText(TG[g.name])) + "</span>" : "") + "</button></div>" +
        (f ? "" : '<ol class="cv-pv-rows">' + rows.map(function (r) {
          var o = out.has(r.n);
          return '<li class="cv-pv-row' + (o ? " is-out" : "") + '">' + tick('data-tick-req="' + r.n + '"', o ? "none" : "all", r.name) +
            '<span class="cv-pv-num">' + r.n + '</span><span class="cv-pv-m m-' + esc(r.method.toLowerCase()) + '">' + esc(r.method) + "</span>" +
            '<span class="cv-pv-rt"><span class="cv-pv-rname">' + esc(r.name) + (o ? '<small class="cv-pv-otag">left out</small>' : "") + '</span><span class="cv-pv-raddr' + ((r.state || (r.resolved ? "resolved" : "missing")) === "missing" ? " var" : "") + '" title="' + esc(r.url) + '">' + esc(r.address) + "</span>" +
            (r.folder && r.folder !== g.name ? '<span class="cv-pv-muted">' + esc(r.folder) + "</span>" : "") + "</span></li>";
        }).join("") + "</ol>" +
        (g.requests.length > rows.length ? '<button type="button" class="cv-pv-more" data-all="' + esc(g.name) + '">Show all ' + g.requests.length + "</button>" : "")) + "</div>";
    }).join("");
    document.getElementById("cv-pv-rlist").innerHTML = html || '<p class="cv-pv-empty">No request matches.</p>';
    someMarks("cv-pv-rlist");
  }
  function someMarks(id) { Array.prototype.forEach.call(document.querySelectorAll("#" + id + " [data-some]"), function (x) { x.indeterminate = true; }); }

  function drawTab() {
    ["files", "values"].forEach(function (t) {
      var b = document.getElementById("cv-pv-tab-" + t); if (!b) return;
      b.setAttribute("aria-selected", String(tab === t)); b.tabIndex = tab === t ? 0 : -1; b.classList.toggle("on", tab === t);
    });
    document.getElementById("cv-pv-fbody").hidden = tab !== "files";
    document.getElementById("cv-pv-vlist").hidden = tab !== "values";
    document.querySelector("#cv-pv .cv-pv-ftools").hidden = tab !== "files";
  }
  // where a value comes from, in words
  var SRC = {
    set: function (v) { return ["Set while it runs", "by " + (v.setBy.length === 1 ? "request " : "requests ") + listN(v.setBy) + (v.how ? " · " + v.how : "")]; },
    environment: function () { return ["Environment", ""]; },
    collection: function () { return [kind === "jmx" ? "Test plan" : "Collection", ""]; },
    data: function (v) { return ["Data file", v.file ? "a column of " + v.file : ""]; },
    builtin: function () { return ["Made by the tool", "a new value each time it is sent"]; },
    empty: function () { return ["Empty", "declared with no value — the script sends it empty unless the run gives it one"]; },
    missing: function () { return ["No value", "nothing gives it a value — the script sends it as written"]; },
  };
  function drawValues() {
    var box = document.getElementById("cv-pv-vlist"), vars = sortValues(P.variables || []);
    if (!vars.length) { box.innerHTML = '<p class="cv-pv-empty">The requests send no variables.</p>'; return; }
    box.innerHTML = '<ul class="cv-pv-vars">' + vars.map(function (v) {
      var s = (SRC[v.source] || SRC.missing)(v), val = v.hidden ? "hidden (looks like a secret)" : v.value != null ? v.value : "";
      var sent = v.usedBy.length, mine = Object.prototype.hasOwnProperty.call(chosen.values, v.name);
      var pend = mine ? chosen.values[v.name] !== atGen.values[v.name] : Object.prototype.hasOwnProperty.call(atGen.values, v.name);
      var canGive = GIVE[v.source] || mine || v.given;
      return '<li class="cv-pv-var s-' + esc(v.source) + (vf === v.name ? " on" : "") + '"><div class="cv-pv-vh"><code class="cv-pv-vn">' + esc(v.name) + "</code>" +
        (v.given || mine ? '<span class="cv-pv-gtag">Given here</span>' : "") +
        '<span class="cv-pv-src">' + (v.source === "missing" && !mine ? ico("warn") : "") + esc(s[0]) + "</span></div>" +
        (s[1] && !(v.given || mine) ? '<div class="cv-pv-vd">' + esc(s[1]) + "</div>" : "") +
        (pend ? '<div class="cv-pv-vd cv-pv-vnew">' + (mine ? "New value <code>" + esc(chosen.values[v.name]) + "</code>" : "Back to the value from the file") + " — Update the script to use it</div>"
          : val !== "" ? '<div class="cv-pv-vd">' + (v.source === "set" ? "Starts as " : "Value ") + (v.hidden ? '<span class="cv-pv-muted">' + esc(val) + "</span>" : "<code>" + esc(val) + "</code>") + "</div>" : "") +
        (editV === v.name ? '<div class="cv-pv-vedit"><label class="cv-pv-flabel" for="cv-pv-val">Value for <code>' + esc(v.name) + "</code></label>" +
          '<input id="cv-pv-val" type="text" spellcheck="false" autocomplete="off" value="' + esc(editVal) + '" />' +
          '<button type="button" class="cv-pv-btn primary" data-give-ok="' + esc(v.name) + '">Save</button><button type="button" class="cv-pv-btn" data-give-cancel>Cancel</button></div>' : "") +
        '<div class="cv-pv-vact">' +
        (sent || v.setBy.length ? '<button type="button" class="cv-pv-vuse" data-vf="' + esc(v.name) + '" aria-pressed="' + (vf === v.name) + '">' +
          (sent ? "Sent by " + plural(sent, "request") : "Not sent by any request") + "</button>" : "") +
        (canGive && editV !== v.name ? '<button type="button" class="cv-pv-vuse" data-give="' + esc(v.name) + '">' + (mine || v.source === "environment" || v.source === "collection" ? "Change the value" : "Give a value") + "</button>" : "") +
        (mine ? '<button type="button" class="cv-pv-vuse" data-ungive="' + esc(v.name) + '">Use the file\'s value</button>' : "") +
        "</div></li>";
    }).join("") + "</ul>";
    if (editV) { var i = document.getElementById("cv-pv-val"); if (i) { i.focus(); i.select(); } }
  }
  // a value given here goes where the script reads it (src/core/scriptSettings.js applyValues); set while it runs, a
  // data file column or a value the tool makes cannot be given
  var GIVE = { missing: 1, empty: 1, environment: 1, collection: 1 };
  function saveValue(name) {
    var i = document.getElementById("cv-pv-val"); if (!i) return;
    chosen.values[name] = i.value;
    editV = ""; editVal = "";
    drawValues(); drawBar();
  }

  function drawFiles() {
    document.getElementById("cv-pv-file").innerHTML = fileGroups(P.files).map(function (g) {
      var opts = g.files.map(function (f) {
        var name = g.dir ? f.path.slice(g.dir.length + 1) : f.path;
        return '<option value="' + esc(f.path) + '"' + (f.path === file ? " selected" : "") + ">" + esc(name) + (f.text == null ? " (not shown)" : "") + "</option>";
      }).join("");
      return g.dir ? '<optgroup label="' + esc(g.dir) + '/">' + opts + "</optgroup>" : opts;
    }).join("");
  }
  function drawFile() {
    var f = P.files.filter(function (x) { return x.path === file; })[0], pre = document.getElementById("cv-pv-code");
    document.getElementById("cv-pv-copy").disabled = !f || f.text == null;
    if (!f) { pre.textContent = ""; return; }
    if (f.text == null) {
      pre.innerHTML = '<span class="cv-pv-muted">' + esc(f.path) + " (" + f.size.toLocaleString() + " bytes) is in the ZIP but not shown here — " +
        (/\.(pem|key|crt|cer|p12|pfx|jks|der)$/i.test(f.path) ? "a key or certificate." : /\.xlsx$/i.test(f.path) ? "an Excel workbook." : P.truncated ? "too large to show." : "not a text file.") + "</span>";
      return;
    }
    pre.textContent = f.text || "(empty file)";
    pre.scrollTop = 0;
  }

  // the ticks: a request, a folder / thread group, a server, or all
  function setOut(list, keepIn) { list.forEach(function (n) { if (keepIn) out.delete(n); else out.add(n); }); drawAll(); }
  function onChange(e) {
    var t = e.target;
    if (t.id === "cv-pv-file") { file = t.value; drawFile(); return; }
    if (t.hasAttribute("data-tick-req")) setOut([+t.getAttribute("data-tick-req")], t.checked);
    else if (t.hasAttribute("data-tick-group")) { var g = t.getAttribute("data-tick-group"); setOut(nums(visible().filter(function (r) { return r.group === g; })), t.checked); }
    else if (t.hasAttribute("data-tick-host")) { var h = t.getAttribute("data-tick-host"); setOut(nums(P.requests.filter(function (r) { return r.host === h; })), t.checked); }
    else if (t.hasAttribute("data-tick-all")) setOut(nums(P.requests), t.checked);
  }
  function onInput(e) {
    var t = e.target;
    if (t.id === "cv-pv-q") { q = t.value; drawRequests(); }
    else if (t.id === "cv-pv-name") { var c = cleanName(t.value); chosen.name = c === orig.name ? "" : c; drawBar(); }
    else if (t.id === "cv-pv-ren-in") renVal = t.value;
    else if (t.id === "cv-pv-val") editVal = t.value;
    if (t.id === "cv-pv-ren-in" && renErr) { renErr = ""; var p = document.getElementById("cv-pv-ren-err"); if (p) p.textContent = ""; t.removeAttribute("aria-invalid"); }
  }
  function onKey(e) {
    var t = e.target;
    if (t.id === "cv-pv-ren-in") {
      if (e.key === "Enter") { e.preventDefault(); saveRename(serverKey(ren)); }
      else if (e.key === "Escape") { e.preventDefault(); var h = ren; ren = ""; renErr = ""; drawHosts(); var b = document.querySelector('#cv-pv [data-rename="' + (window.CSS && CSS.escape ? CSS.escape(h) : h) + '"]'); if (b) b.focus(); }
    } else if (t.id === "cv-pv-name" && e.key === "Enter") { e.preventDefault(); t.value = nameNow(); }
    else if (t.id === "cv-pv-val" && e.key === "Enter") { e.preventDefault(); saveValue(editV); }
    else if (t.id === "cv-pv-val" && e.key === "Escape") { e.preventDefault(); var gn = editV; editV = ""; drawValues(); var gb = document.querySelector('#cv-pv [data-give="' + (window.CSS && CSS.escape ? CSS.escape(gn) : gn) + '"]'); if (gb) gb.focus(); }
    else if (t.getAttribute && t.getAttribute("role") === "tab" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault(); tab = tab === "files" ? "values" : "files"; drawTab(); document.getElementById("cv-pv-tab-" + tab).focus();
    }
  }
  function onClick(e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-host")) { var h = b.getAttribute("data-host"); host = host === h ? "" : h; drawHosts(); drawRequests(); }
    else if (b.hasAttribute("data-group")) { var g = b.getAttribute("data-group"); folded[g] = !folded[g]; drawRequests(); }
    else if (b.hasAttribute("data-all")) { showAll[b.getAttribute("data-all")] = true; drawRequests(); }
    else if (b.hasAttribute("data-tt")) setTTNow(+b.getAttribute("data-tt"));
    else if (b.hasAttribute("data-wlm")) { if (typeof window.setJmxWlm === "function") window.setJmxWlm(b.getAttribute("data-wlm") === "1"); }
    else if (b.hasAttribute("data-env-pick")) { var fi = document.getElementById("fi-env"); if (fi) fi.click(); }
    else if (b.hasAttribute("data-env-clear")) { if (typeof window.clearFile === "function") window.clearFile("dz-env", "environment"); }
    else if (b.hasAttribute("data-give")) {
      editV = b.getAttribute("data-give");
      var gv = (P.variables || []).filter(function (x) { return x.name === editV; })[0];
      editVal = Object.prototype.hasOwnProperty.call(chosen.values, editV) ? chosen.values[editV] : gv && !gv.hidden && gv.value != null ? gv.value : "";
      drawValues();
    }
    else if (b.hasAttribute("data-give-ok")) saveValue(b.getAttribute("data-give-ok"));
    else if (b.hasAttribute("data-give-cancel")) { editV = ""; drawValues(); }
    else if (b.hasAttribute("data-ungive")) { delete chosen.values[b.getAttribute("data-ungive")]; drawValues(); drawBar(); }
    else if (b.id === "cv-pv-wm") handOff();
    else if (b.hasAttribute("data-pv-hide")) setPane(b.getAttribute("data-pv-hide"), false);
    else if (b.hasAttribute("data-pv-show")) setPane(b.getAttribute("data-pv-show"), true);
    else if (b.hasAttribute("data-rename")) { ren = b.getAttribute("data-rename"); renErr = ""; var rh = P.hosts.filter(function (x) { return x.host === ren; })[0]; renVal = rh ? paramNow(rh) : ""; drawHosts(); }
    else if (b.hasAttribute("data-ren-ok")) saveRename(b.getAttribute("data-ren-ok"));
    else if (b.hasAttribute("data-ren-cancel")) { ren = ""; renErr = ""; drawHosts(); }
    else if (b.hasAttribute("data-tab")) { tab = b.getAttribute("data-tab"); drawTab(); if (b.classList.contains("cv-pv-link")) document.getElementById("cv-pv-files").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
    else if (b.hasAttribute("data-vf")) { var n = b.getAttribute("data-vf"); vf = vf === n ? "" : n; drawValues(); drawRequests(); }
    else if (b.hasAttribute("data-vf-clear")) { vf = ""; drawValues(); drawRequests(); }
    else if (b.id === "cv-pv-update") update();
    else if (b.id === "cv-pv-undo") undo();
    else if (b.id === "cv-pv-all") { out = new Set(); drawAll(); }
    else if (b.id === "cv-pv-copy") {
      var f = P.files.filter(function (x) { return x.path === file; })[0];
      if (f && f.text != null && navigator.clipboard) navigator.clipboard.writeText(f.text).then(function () { b.lastChild.textContent = "Copied"; setTimeout(function () { b.lastChild.textContent = "Copy"; }, 1500); });
    }
  }

  // the download: single-use, kept 5 minutes — afterwards the button converts again (the same choice); while a change
  // is not applied it waits for Update the script
  function dl() { return document.getElementById("btn-dl"); }
  function watchDownload() {
    var a = dl(); if (!a) return;
    clearTimeout(timer);
    resetDownload();
    if (!a._cvWatched) {
      a._cvWatched = true;
      a.addEventListener("click", function (e) {
        if (!P) return;
        if (changes().length) {
          e.preventDefault();
          var bar = document.getElementById("cv-pv-bar"), up = document.getElementById("cv-pv-update");
          if (bar) { bar.classList.remove("flash"); void bar.offsetWidth; bar.classList.add("flash"); bar.scrollIntoView({ behavior: "smooth", block: "center" }); }
          if (up && !up.disabled) up.focus();
          return;
        }
        if (blobUrl) return;                       // the ZIP is kept in the browser: download it as often as needed
        if (used || expired) { e.preventDefault(); update(); return; }
        used = true;
        setTimeout(function () { setAgain("Downloaded. The link works once: Convert again to download it again."); }, 400);
      });
    }
    timer = setTimeout(function () { expired = true; setAgain("The download was kept 5 minutes: Convert again to make it again (the same files, options and choice)."); }, KEEP_MS);
  }
  function setAgain(why) {
    var a = dl(); if (!a || !P) return;
    if (!a._cvLabel) a._cvLabel = a.innerHTML;
    a.classList.add("cv-pv-again");
    a.removeAttribute("download");
    a.innerHTML = a._cvLabel.replace(/Download script \(\.zip\)/, "Convert again");
    a.title = why;
  }
  function resetDownload() {
    var a = dl(); if (!a) return;
    a.classList.remove("cv-pv-wait"); a.removeAttribute("aria-disabled");
    if (a._cvBlob) { a._cvBlob = false; a.setAttribute("download", ""); }
    if (!a._cvLabel) return;
    a.innerHTML = a._cvLabel; a.classList.remove("cv-pv-again"); a.setAttribute("download", ""); a.removeAttribute("title");
  }

  // Plan the load in Workload Modeller: the generated ZIP, handed to the Workload Modeller page in the portal
  // (window.WorkloadModeller.addScripts — the same as choosing the file there). The single-use link is read once and
  // the ZIP kept in this browser, so Download goes on working from it. A used or expired link converts again first.
  function handOff() {
    if (!P) return;
    var btn = document.getElementById("cv-pv-wm");
    if (changes().length) { var bar = document.getElementById("cv-pv-bar"); if (bar) { bar.classList.remove("flash"); void bar.offsetWidth; bar.classList.add("flash"); } return; }
    if (zipFile) { send(zipFile); return; }
    if (used || expired) { handAfter = true; update(); return; }
    var a = dl(); if (!a || !a.href) return;
    if (btn) { btn.disabled = true; btn.lastChild.textContent = "Reading the ZIP…"; }
    fetch(a.href).then(function (r) {
      if (!r.ok) throw new Error("gone");
      var cd = r.headers.get("content-disposition") || "", m = /filename="([^"]+)"/.exec(cd), name = m ? m[1] : "loadrunner_script.zip";
      return r.blob().then(function (blob) { return { blob: blob, name: name }; });
    }).then(function (z) {
      zipFile = new File([z.blob], z.name, { type: "application/zip" });
      blobUrl = URL.createObjectURL(z.blob);
      clearTimeout(timer); used = false; expired = false;
      a.href = blobUrl; a.setAttribute("download", z.name); a._cvBlob = true;
      if (btn) { btn.disabled = false; btn.lastChild.textContent = "Plan the load in Workload Modeller"; }
      send(zipFile);
    }).catch(function () {
      if (btn) { btn.disabled = false; btn.lastChild.textContent = "Plan the load in Workload Modeller"; }
      handAfter = true; update();               // the link was used or expired meanwhile: convert again, then hand over
    });
  }
  // the hand-over itself is shared with Script Studio (portal/plan-load.js)
  function send(fileObj) {
    if (window.PerfxPlanLoad) window.PerfxPlanLoad.send([fileObj]);
  }

  api.show = show; api.hide = hide; api.addTo = addTo; api.update = update;
  return api;
});
