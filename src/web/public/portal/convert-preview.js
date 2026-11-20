/* The converters' preview (Postman / Bruno and JMeter panels): after a conversion, what the ZIP holds — the servers
 * the requests call, every request grouped by folder (or thread group), and the generated files with their code —
 * in the same panel layout as Script Studio (data.preview from the server, src/web/convertPreview.js).
 * Choosing what goes in: a tick on each server, folder / thread group and request; the summary bar says how many are in
 * and, once the choice differs from the ZIP, offers Update the script — the panel's own doConvert / doConvertJmx again,
 * with the numbers of the requests left out (form field leaveOut, read by src/core/requestSelection.js: the converters
 * drop them right after parsing). The view (filter, folds, file) stays. While a change is not applied, Download waits.
 * Also: the download link is single-use and kept 5 minutes on the server; once used or expired, the button becomes
 * Convert again (the same choice).
 *   ConvertPreview.show(data, kind)   kind "pm" | "jmx" — called by showResult / showJmxResult (index.ejs)
 *   ConvertPreview.hide()             called by hideResults
 *   ConvertPreview.addTo(formData)    called by doConvert / doConvertJmx: adds leaveOut on an update, nothing otherwise
 * Pure helpers (UMD, tests/unit/convertPreview.test.js): filterRequests, groupRequests, defaultFile, fileGroups,
 * stateOf, sameSet. */
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

  var api = { filterRequests: filterRequests, groupRequests: groupRequests, defaultFile: defaultFile, fileGroups: fileGroups, stateOf: stateOf, sameSet: sameSet, needed: needed };
  if (typeof document === "undefined") return api;

  // ── the page ──
  var esc = function (s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); };
  var plural = function (n, w) { return n + " " + w + (n === 1 ? "" : "s"); };
  var KEEP_MS = 5 * 60 * 1000 - 15000;   // the server keeps the download 5 minutes; a little earlier, to be safe
  var P = null, kind = "pm", host = "", q = "", file = null, folded = {}, showAll = {}, timer = null, used = false, expired = false;
  var out = new Set(), gen = new Set();       // left out now (the ticks) / left out in the ZIP
  var updating = false, keepView = false, source = null;
  var ICON = {
    server: '<path d="M4 5h16v6H4zM4 13h16v6H4z"/><path d="M8 8h.01M8 16h.01"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><path d="M14 3v6h6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    chev: '<path d="m6 9 6 6 6-6"/>',
    warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
    redo: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  };
  var ico = function (k) { return '<svg class="cv-pv-i" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICON[k] + "</svg>"; };
  var nums = function (list) { return list.map(function (r) { return r.n; }); };
  var tick = function (attr, st, label) {
    return '<input type="checkbox" class="cv-pv-cb" ' + attr + (st === "all" ? " checked" : "") + (st === "some" ? " data-some" : "") + ' aria-label="' + esc(label) + '" />';
  };

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
    el.addEventListener("input", function (e) { if (e.target.id === "cv-pv-q") { q = e.target.value; drawRequests(); } });
    return el;
  }
  function currentFile() {
    try { return kind === "jmx" ? (typeof JX !== "undefined" && JX.file) : (typeof F !== "undefined" && F.collection); } catch (e) { return null; }
  }

  function show(data, k) {
    var el = box(); if (!el) return;
    var keep = keepView; keepView = false;
    P = data && data.preview; kind = k === "jmx" ? "jmx" : "pm";
    if (!keep) { host = ""; q = ""; folded = {}; showAll = {}; file = null; }
    used = false; expired = false;
    if (!P || !P.requests) { el.hidden = true; el.innerHTML = ""; return; }
    gen = new Set(P.requests.filter(function (r) { return r.out; }).map(function (r) { return r.n; }));
    out = new Set(gen);
    source = currentFile();
    if (!file || !P.files.some(function (f) { return f.path === file; })) file = defaultFile(P.files);
    var missing = P.hosts.filter(function (h) { return (h.state || (h.resolved ? "resolved" : "missing")) === "missing"; });
    el.innerHTML =
      '<div class="cv-pv-head"><div><h3>What the script contains</h3><p>Untick what the script should leave out, then <b>Update the script</b>. ' +
        (kind === "jmx" ? "Requests are grouped by thread group." : "Requests are grouped by folder.") + "</p></div></div>" +
      (missing.length ? '<div class="cv-pv-warn" role="note">' + ico("warn") + "<span><b>" + (missing.length === 1 ? "1 server is a variable with no value" : missing.length + " servers are variables with no value") + "</b> (" +
        missing.map(function (h) { return "<code>" + esc(h.host) + "</code>"; }).join(", ") + "): " +
        (kind === "jmx" ? "the test plan does not give it one, so the script calls it as written." : "add the environment file that defines it, or the script calls it as written.") + "</span></div>" : "") +
      '<div class="cv-pv-bar" id="cv-pv-bar" role="status" aria-live="polite"></div>' +
      '<div class="cv-pv-cols">' +
        '<div class="cv-pv-pane" id="cv-pv-hosts"><div class="cv-pv-ph">' + ico("server") + '<h4>Servers</h4><span class="cv-pv-n">' + P.hosts.length + "</span></div>" +
          '<div class="cv-pv-body" id="cv-pv-hlist"></div></div>' +
        '<div class="cv-pv-pane" id="cv-pv-reqs"><div class="cv-pv-ph">' + ico("list") + '<h4>Requests</h4><span class="cv-pv-n" id="cv-pv-rn"></span>' +
          '<label class="cv-pv-search">' + ico("search") + '<input id="cv-pv-q" type="search" placeholder="Filter by name or address" aria-label="Filter the requests" value="' + esc(q) + '" /></label></div>' +
          '<div class="cv-pv-body" id="cv-pv-rlist"></div></div>' +
        '<div class="cv-pv-pane" id="cv-pv-files"><div class="cv-pv-ph">' + ico("file") + '<h4>Files</h4><span class="cv-pv-n">' + P.files.length + "</span>" +
          '<select id="cv-pv-file" class="cv-pv-sel" aria-label="File to show"></select>' +
          '<button type="button" class="cv-pv-btn" id="cv-pv-copy" title="Copy this file">' + ico("copy") + "Copy</button></div>" +
          '<div class="cv-pv-body cv-pv-codebox"><pre class="cv-pv-code" id="cv-pv-code" tabindex="0"></pre></div></div>' +
      "</div>";
    el.hidden = false;
    drawAll(); drawFiles(); drawFile();
    watchDownload();
    if (keep) setTimeout(function () { el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
  }
  function hide() {
    var el = document.getElementById("cv-pv");
    clearTimeout(timer);
    if (updating) { if (el) el.hidden = true; return; }   // an update: the choice and the view come back with the answer
    if (el) { el.hidden = true; el.innerHTML = ""; }
    P = null; keepView = false; out = new Set(); gen = new Set(); resetDownload();
  }
  // the form of the next conversion: on an update, the requests left out (none → the field is not sent, as before)
  function addTo(fd) {
    if (!updating) { keepView = false; return; }
    updating = false; keepView = true;
    if (out.size && fd && fd.append) fd.append("leaveOut", JSON.stringify(Array.from(out).sort(function (a, b) { return a - b; })));
  }
  function update() {
    if (!P) return;
    if (currentFile() !== source) { out = new Set(); }            // another file was chosen: start from all its requests
    updating = true;
    if (kind === "jmx" && typeof window.doConvertJmx === "function") window.doConvertJmx();
    else if (typeof window.doConvert === "function") window.doConvert();
    else updating = false;
  }

  function drawAll() { drawBar(); drawHosts(); drawRequests(); }
  function drawBar() {
    var total = P.requests.length, inn = total - out.size, pending = !sameSet(out, gen);
    var bar = document.getElementById("cv-pv-bar");
    bar.className = "cv-pv-bar" + (pending ? " pending" : "");
    bar.innerHTML = '<span class="cv-pv-sum"><b>' + inn + " of " + total + "</b> " + (total === 1 ? "request" : "requests") + " in the script" +
      (gen.size && !pending ? ' <span class="cv-pv-muted">· ' + gen.size + " left out</span>" : "") + "</span>" +
      (pending ? '<span class="cv-pv-note">' + (inn ? "Changed — the ZIP does not have it yet." : "Keep at least one request.") + "</span>" +
        '<span class="cv-pv-grow"></span><button type="button" class="cv-pv-btn" id="cv-pv-undo">Undo changes</button>' +
        '<button type="button" class="cv-pv-btn primary" id="cv-pv-update"' + (inn ? "" : " disabled") + ">" + ico("redo") + "Update the script</button>"
        : gen.size ? '<span class="cv-pv-grow"></span><button type="button" class="cv-pv-btn" id="cv-pv-all">Put all back</button>' : "");
    var need = needed(P.requests, out), listN = function (a) { return a.length > 4 ? a.slice(0, 4).join(", ") + " and " + (a.length - 4) + " more" : a.join(", "); };
    if (need.length) bar.innerHTML += '<div class="cv-pv-need" role="note">' + ico("warn") + "<span>" + need.slice(0, 3).map(function (x) {
      return "<code>" + esc(x.name) + "</code> is set by " + (x.by.length === 1 ? "request " : "requests ") + listN(x.by) + " (left out) and sent by " + (x.usedBy.length === 1 ? "request " : "requests ") + listN(x.usedBy);
    }).join("; ") + (need.length > 3 ? "; and " + (need.length - 3) + " more values" : "") + ". Without " + (need.length === 1 ? "it" : "them") + " the script sends " + (need.length === 1 ? "it" : "them") + " empty — keep the request that sets " + (need.length === 1 ? "it" : "them") + ", or give " + (need.length === 1 ? "it a value" : "them values") + " in the " + (kind === "jmx" ? "test plan" : "environment") + ".</span></div>";
    var dl = document.getElementById("btn-dl");
    if (dl) { dl.classList.toggle("cv-pv-wait", pending); if (pending) dl.setAttribute("aria-disabled", "true"); else dl.removeAttribute("aria-disabled"); }
  }

  function drawHosts() {
    var allNums = nums(P.requests);
    document.getElementById("cv-pv-hlist").innerHTML =
      '<div class="cv-pv-host' + (host ? "" : " on") + '">' + tick('data-tick-all', stateOf(allNums, out), "Every request") +
        '<button type="button" class="cv-pv-hb" data-host="" aria-pressed="' + !host + '"><span class="cv-pv-hn">All servers</span><span class="cv-pv-c">' + P.requests.length + "</span></button></div>" +
      P.hosts.map(function (h) {
        var st = h.state || (h.resolved ? "resolved" : "missing"), hn = nums(P.requests.filter(function (r) { return r.host === h.host; }));
        return '<div class="cv-pv-host' + (h.host === host ? " on" : "") + (st === "missing" ? " var" : "") + (stateOf(hn, out) === "none" ? " is-out" : "") + '">' +
          tick('data-tick-host="' + esc(h.host) + '"', stateOf(hn, out), "Requests to " + h.host) +
          '<button type="button" class="cv-pv-hb" data-host="' + esc(h.host) + '" aria-pressed="' + (h.host === host) + '"' +
          (st === "missing" ? ' title="A variable nothing gives a value: the script calls it as written"' : st === "runtime" ? ' title="Set while the script runs (by a script or an extractor)"' : ' title="Show only its requests"') +
          '><span class="cv-pv-hn">' + (st === "missing" ? ico("warn") : "") + esc(h.host) +
          (st === "runtime" ? '<small class="cv-pv-rtag">set while the script runs</small>' : "") + '</span><span class="cv-pv-c">' + h.count + "</span></button></div>";
      }).join("");
    someMarks("cv-pv-hlist");
  }

  var MAX_ROWS = 300;   // per group, before "Show all"
  function drawRequests() {
    var list = filterRequests(P.requests, host, q), groups = groupRequests(list);
    document.getElementById("cv-pv-rn").textContent = list.length === P.requests.length ? String(list.length) : list.length + " of " + P.requests.length;
    var html = groups.map(function (g) {
      var f = !!folded[g.name], rows = showAll[g.name] ? g.requests : g.requests.slice(0, MAX_ROWS), gs = stateOf(nums(g.requests), out);
      return '<div class="cv-pv-grp' + (f ? " folded" : "") + (gs === "none" ? " is-out" : "") + '"><div class="cv-pv-gh">' +
        tick('data-tick-group="' + esc(g.name) + '"', gs, "Every request in " + g.name) +
        '<button type="button" class="cv-pv-gb" data-group="' + esc(g.name) + '" aria-expanded="' + !f + '">' + ico("chev") +
        '<b>' + esc(g.name) + '</b><span class="cv-pv-muted">' + plural(g.requests.length, "request") + "</span></button></div>" +
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
    else if (t.hasAttribute("data-tick-group")) { var g = t.getAttribute("data-tick-group"); setOut(nums(filterRequests(P.requests, host, q).filter(function (r) { return r.group === g; })), t.checked); }
    else if (t.hasAttribute("data-tick-host")) { var h = t.getAttribute("data-tick-host"); setOut(nums(P.requests.filter(function (r) { return r.host === h; })), t.checked); }
    else if (t.hasAttribute("data-tick-all")) setOut(nums(P.requests), t.checked);
  }
  function onClick(e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.hasAttribute("data-host")) { var h = b.getAttribute("data-host"); host = host === h ? "" : h; drawHosts(); drawRequests(); }
    else if (b.hasAttribute("data-group")) { var g = b.getAttribute("data-group"); folded[g] = !folded[g]; drawRequests(); }
    else if (b.hasAttribute("data-all")) { showAll[b.getAttribute("data-all")] = true; drawRequests(); }
    else if (b.id === "cv-pv-update") update();
    else if (b.id === "cv-pv-undo") { out = new Set(gen); drawAll(); }
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
        if (!sameSet(out, gen)) {
          e.preventDefault();
          var bar = document.getElementById("cv-pv-bar"), up = document.getElementById("cv-pv-update");
          if (bar) { bar.classList.remove("flash"); void bar.offsetWidth; bar.classList.add("flash"); bar.scrollIntoView({ behavior: "smooth", block: "center" }); }
          if (up && !up.disabled) up.focus();
          return;
        }
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
    if (!a._cvLabel) return;
    a.innerHTML = a._cvLabel; a.classList.remove("cv-pv-again"); a.setAttribute("download", ""); a.removeAttribute("title");
  }

  api.show = show; api.hide = hide; api.addTo = addTo; api.update = update;
  return api;
});
