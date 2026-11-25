/* The converter page (Postman / Bruno and JMeter): files → Convert → one screen with the script.
 *   start      three file boxes and Convert; nothing else
 *   workspace  title (the script's name — click to rename), files, state, Undo / Redo, Plan the load, Download;
 *              format · scripts · think time · Settings; Domains | Requests · Values | Script · Request
 * Every choice converts again by itself (a conversion takes 20 to 200 ms): the script shown and the ZIP are always the
 * same. A failed update keeps the last script and every choice. Each tool keeps its own files, choices and script.
 *   ConverterApp.state(kind)            "pm" | "jmx" — { files, c (the choices), data (the last answer), status, err }
 *   ConverterApp.set(kind, key, value)  a choice: fmt mode tt ll wlm, or adv.corr … (as a click)
 *   ConverterApp.convert(kind), .clear(kind), .zip(kind) → Promise<File>
 * Sent to the server: the same fields as ever; on an update also leaveOut, scriptName, serverNames, varNames, values
 * (src/core/requestSelection.js, scriptSettings.js), update=1 (not counted as a use) and replaces (the ZIP it replaces).
 * Pure helpers (UMD, tests/unit/converterApp.test.js): see api below. Styles: portal/converter.css (cx-*). */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ConverterApp = api;
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── pure helpers ──
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
  function plural(n, w) { return n + " " + w + (Number(n) === 1 ? "" : "s"); }
  function serverKey(host) { return String(host || "").trim().toLowerCase().replace(/:(443|80)$/, ""); }
  // the script name as the server keeps it (src/core/scriptSettings.js cleanScriptName — keep the two in step)
  function cleanName(text) {
    var s = String(text == null ? "" : text).replace(/[^A-Za-z0-9 _.-]/g, "_").replace(/\s+/g, " ").trim().slice(0, 60);
    return /[A-Za-z0-9]/.test(s) ? s : "";
  }
  // the choices that make the script; what a new file starts with
  function freshChoices(prefs) {
    var p = prefs || {}, ok = function (v, list, d) { return list.indexOf(v) >= 0 ? v : d; };
    return {
      fmt: ok(p.fmt, ["devweb", "web-http"], "devweb"), mode: ok(p.mode, ["single", "multi"], "single"), tt: ok(p.tt, [1, 2, 3, 5], 1),
      ll: ok(p.ll, ["info", "debug"], "info"), wlm: p.wlm !== false,
      adv: { corr: (p.adv || {}).corr !== false, param: (p.adv || {}).param !== false, auth: (p.adv || {}).auth !== false, cmt: (p.adv || {}).cmt !== false },
      out: [], name: "", names: {}, varNames: {}, values: {},
    };
  }
  // the choices of one request only (they belong to the file): what a change of the main file drops
  function keepSettings(c) { var n = freshChoices(c); n.adv = Object.assign({}, c.adv); return n; }
  function filterRequests(list, o) {
    var q = String(o.q || "").trim().toLowerCase(), use = o.use;
    return (list || []).filter(function (r) {
      if (o.host && r.host !== o.host) return false;
      if (use && use.usedBy.indexOf(r.n) < 0 && use.setBy.indexOf(r.n) < 0) return false;
      return !q || (r.name + " " + r.address + " " + r.method + " " + r.folder).toLowerCase().indexOf(q) >= 0;
    });
  }
  function groupRequests(list) {
    var order = [], by = {};
    (list || []).forEach(function (r) { if (!by[r.group]) { by[r.group] = []; order.push(r.group); } by[r.group].push(r); });
    return order.map(function (g) { return { name: g, requests: by[g] }; });
  }
  // a tick for several requests: "all" in, "none" in, "some"
  function stateOf(nums, out) { var o = nums.filter(function (n) { return out.indexOf(n) >= 0; }).length; return o === 0 ? "all" : o === nums.length ? "none" : "some"; }
  // values the kept requests would send empty: set only by left-out requests, sent by a kept one, no value given
  function needed(list, out, values, variables) {
    var setIn = {}, setOut = {}, order = [];
    (list || []).forEach(function (r) { (r.sets || []).forEach(function (k) { var m = out.indexOf(r.n) >= 0 ? setOut : setIn; if (!setIn[k] && !setOut[k]) order.push(k); (m[k] = m[k] || []).push(r.n); }); });
    return order.filter(function (k) { return setOut[k] && !setIn[k] && (values || {})[k] == null; }).map(function (k) {
      return { name: k, by: setOut[k], usedBy: (list || []).filter(function (r) { return out.indexOf(r.n) < 0 && (r.uses || []).indexOf(k) >= 0; }).map(function (r) { return r.n; }) };
    }).filter(function (x) { return x.usedBy.length; });
  }
  // a thread group's settings in words: "10 users · ramp-up 10 s · hold 5 min · loops until stopped"
  function tgText(t) {
    var p = [], s = function (n) { return Number(n) >= 120 && Number(n) % 60 === 0 ? Number(n) / 60 + " min" : n + " s"; };
    if (t.type && /^(setup|teardown)$/i.test(t.type)) p.push(/^setup$/i.test(t.type) ? "setUp" : "tearDown");
    if (t.virtualUsers != null) p.push(plural(t.virtualUsers, "user"));
    if (Number(t.rampUpSec) > 0) p.push("ramp-up " + s(t.rampUpSec));
    if (Number(t.holdSec) > 0) p.push("hold " + s(t.holdSec));
    if (t.iterations != null && t.iterations !== "") p.push(/^infinite$/i.test(String(t.iterations)) || Number(t.iterations) < 0 ? "loops until stopped" : plural(t.iterations, "loop"));
    if (t.enabled === false) p.push("off in the test plan");
    return p.join(" · ");
  }
  // the main scripts of a ZIP: main.js for DevWeb (its Action.c is VuGen's empty stub), else Action.c
  function mainFiles(files) {
    var shown = (files || []).filter(function (f) { return f.text != null; }), pick = function (re) { return shown.filter(function (f) { return re.test(f.path); }); };
    var m = pick(/(^|\/)main\.js$/);
    return m.length ? m : pick(/(^|\/)Action\.c$/);
  }
  function dirOf(p) { var i = p.lastIndexOf("/"); return i < 0 ? "" : p.slice(0, i); }
  function baseOf(p) { return p.slice(p.lastIndexOf("/") + 1); }
  // the main script of a request: its folder's / thread group's in a multi-script ZIP
  function fileOf(files, r) {
    var m = mainFiles(files), norm = function (s) { return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, ""); };
    if (!r) return m[0] || null;
    var own = m.filter(function (f) { return norm(dirOf(f.path)) === norm(r.group); })[0];
    return own || m.filter(function (f) { return r.tx && f.text.indexOf('"' + r.tx + '"') >= 0; })[0] || m[0] || null;
  }
  // the tabs: the files most people look at, beside the main one
  function tabFiles(files, f) {
    if (!f) return [];
    var dir = dirOf(f.path), dev = mainFiles(files).some(function (x) { return /main\.js$/.test(x.path); });
    var want = dev ? ["main.js", "parameters.yml", "rts.yml"] : ["Action.c", "vuser_init.c", "globals.h"];
    return want.map(function (n) { return (files || []).filter(function (x) { return x.path === (dir ? dir + "/" : "") + n; })[0]; }).filter(Boolean);
  }
  function fileGroups(files) {
    var order = [], by = {};
    (files || []).forEach(function (f) { var d = dirOf(f.path); if (!by[d]) { by[d] = []; order.push(d); } by[d].push(f); });
    order.sort(function (a, b) { return a === "" ? -1 : b === "" ? 1 : a.localeCompare(b); });
    return order.map(function (d) { return { dir: d, files: by[d] }; });
  }
  // the lines of a request in its script: [first, last], from the start of its transaction to its end
  function codeRange(text, tx) {
    if (!text || !tx) return null;
    var L = text.split("\n"), q = '"' + tx + '"', a = -1, b = -1, v = "";
    for (var i = 0; i < L.length; i++) {
      var m = /(?:const|let|var) (\w+) = new load\.Transaction\(/.exec(L[i]);
      if (m && L[i].indexOf(q) >= 0) v = m[1];
      if (v && a < 0 && L[i].indexOf(v + ".start()") >= 0) a = i;
      else if (v && a >= 0 && L[i].indexOf(v + ".stop(") >= 0) { b = i; break; }
      else if (!v && a < 0 && L[i].indexOf("lr_start_transaction(" + q) >= 0) a = i;
      else if (!v && a >= 0 && L[i].indexOf("lr_end_transaction(" + q) >= 0) { b = i; break; }
    }
    return a >= 0 && b >= a ? [a, b] : null;
  }
  var GROUPS = [["missing", "Needs a value"], ["given", "Given here"], ["empty", "Empty"], ["set", "Read from a response"], ["environment", "From the environment"], ["collection", "From the collection"], ["data", "From a data file"], ["builtin", "Made by the script"]];
  var keyOf = function (v) { return v.orig || v.name; };   // a value's name in the file: what the choices are kept under
  function sourceOf(v, values) { return (values || {})[keyOf(v)] != null ? "given" : v.source; }
  // the Values tab: [{ key, title, list }] in the order above, none empty
  function valueGroups(variables, values, q, kind) {
    q = String(q || "").trim().toLowerCase();
    var l = (variables || []).filter(function (v) { return !q || (v.name + " " + (v.value || "") + " " + (v.how || "") + " " + ((values || {})[keyOf(v)] || "")).toLowerCase().indexOf(q) >= 0; });
    return GROUPS.map(function (g) {
      return { key: g[0], title: g[0] === "collection" && kind === "jmx" ? "From the test plan" : g[1], list: l.filter(function (v) { return sourceOf(v, values) === g[0]; }) };
    }).filter(function (g) { return g.list.length; });
  }
  // how a value is read, in short: "json $.id" → { kind: "JSON path", text: "$.id" }
  function howOf(v) {
    var m = /^(json\w*|regexp?|boundary|xpath\w*|css|html)\s+([\s\S]+)$/i.exec(v.how || "");
    if (!m) return { kind: v.how ? "" : "set by a script", text: v.how || "" };
    var k = m[1].toLowerCase();
    return { kind: k.indexOf("json") === 0 ? "JSON path" : k.indexOf("reg") === 0 ? "regular expression" : k.indexOf("xpath") === 0 ? "XPath" : k, text: m[2] };
  }
  // a domain's parameter names: the script's own (param) or the variables its address is made of
  function domainNames(h, variables) {
    if (h.param) return [{ type: "param", name: h.param, key: serverKey(h.host), can: true }];
    return (h.vars || []).map(function (n) {
      var v = (variables || []).filter(function (x) { return x.name === n; })[0] || { name: n, setBy: [], source: "missing" };
      var can = /^(environment|collection)$/.test(v.source) && !v.setBy.length;
      return { type: "var", name: n, key: keyOf(v), can: can, source: v.source, value: v.value, hidden: !!v.hidden, why: can ? "" : v.setBy.length ? "Set while the script runs" : v.source === "data" ? "A column of a data file" : v.source === "missing" || v.source === "empty" ? "Needs a value first" : "" };
    });
  }
  // the part of an address worth a narrow column: the path (the domain has its own panel); one that is still a variable as it is
  function shortAddress(a) {
    var m = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*(.*)$/i.exec(String(a || ""));
    return m ? m[1] || "/" : String(a || "");
  }
  // the fields of an update beside the plain ones (nothing for what was not chosen)
  function choiceFields(c) {
    var f = [];
    if (c.out.length) f.push(["leaveOut", JSON.stringify(c.out.slice().sort(function (a, b) { return a - b; }))]);
    if (c.name) f.push(["scriptName", c.name]);
    [["names", "serverNames"], ["varNames", "varNames"], ["values", "values"]].forEach(function (x) { if (Object.keys(c[x[0]]).length) f.push([x[1], JSON.stringify(c[x[0]])]); });
    return f;
  }
  // the plain fields, in the order the page always sent them
  function plainFields(kind, c) {
    if (kind === "jmx") return [["protocol", c.fmt], ["thinkTime", c.tt], ["generateWlmExcel", c.wlm], ["mode", c.mode], ["useTransactions", "true"], ["useCorrelation", "true"], ["useParameterization", "true"], ["useAuthentication", "true"], ["addComments", "true"]];
    return [["protocol", c.fmt], ["mode", c.mode], ["thinkTime", c.tt], ["logLevel", c.ll], ["useCorrelation", c.adv.corr], ["useParameterization", c.adv.param], ["useAuthentication", c.adv.auth], ["addComments", c.adv.cmt]];
  }
  var ERR = {
    conversion_failed: "The file could not be read as a {what}. Check that it is complete and of the right kind.", conversion_timeout: "It took too long. Try again, or leave requests out of a very large file.",
    server_busy: "The server is busy.", rate_limit_exceeded: "Too many conversions in a short time. Wait a moment.", nothing_selected: "Keep at least one request.",
    unsupported_file_type: "This kind of file cannot be read here.", no_requests: "The file holds no requests.",
    collection_file_required: "Choose a collection first.", jmx_file_required: "Choose a test plan first.", network: "The server did not answer.",
  };
  function errorText(code, kind) {
    var t = ERR[code];
    return t ? t.replace("{what}", kind === "jmx" ? "JMeter test plan" : "Postman or Bruno collection") : String(code || "Unknown error");
  }
  // files by box: [{ slot, files }] for what was dropped (a collection first, then an environment)
  function sortFiles(files, kind, hasMain) {
    var ext = function (f) { var m = /\.[^.]+$/.exec(String(f.name).toLowerCase()); return m ? m[0] : ""; };
    var CERT = [".p12", ".pfx", ".pem", ".crt", ".cer", ".key"], by = function (l) { return files.filter(function (f) { return l.indexOf(ext(f)) >= 0; }); };
    if (kind === "jmx") return [{ slot: "main", files: by([".jmx"]).slice(0, 1) }, { slot: "csv", files: by([".csv"]) }, { slot: "cert", files: by(CERT) }].filter(function (x) { return x.files.length; });
    var out = [{ slot: "cert", files: by(CERT) }], rest = by([".json", ".yml", ".yaml", ".bru"]);
    // a name that says environment goes to its box also when both come together
    var envs = rest.filter(function (f) { return /environment/i.test(f.name) && /\.(json|bru)$/i.test(f.name); }), cols = rest.filter(function (f) { return envs.indexOf(f) < 0; });
    if (!hasMain && !cols.length && envs.length) { cols = [envs.shift()]; }
    if (cols.length && !hasMain) out.unshift({ slot: "main", files: [cols.shift()] });
    var env = envs[0] || cols.filter(function (f) { return /\.(json|bru)$/i.test(f.name); })[0];
    if (env) out.push({ slot: "env", files: [env] });
    return out.filter(function (x) { return x.files.length; });
  }
  // one line of C / JavaScript with its parts marked (the text itself is escaped)
  var CODE = /(\/\/.*$|^\s*\*.*$|\/\*.*?(?:\*\/|$))|("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`[^`]*`)|\b(const|let|var|function|async|await|new|return|if|else|for|while|true|false|null|int|char|void|LAST|ENDITEM|ITEMDATA|LR_AUTO)\b|\b(\d+(?:\.\d+)?)\b|\b([A-Za-z_]\w*)(?=\()/g;
  function colorLine(l) {
    if (l.length > 2000) return esc(l);
    var out = "", at = 0, m; CODE.lastIndex = 0;
    while ((m = CODE.exec(l))) {
      if (!m[0]) { CODE.lastIndex++; continue; }
      out += esc(l.slice(at, m.index)) + '<span class="cx-' + (m[1] ? "com" : m[2] ? "str" : m[3] ? "kw" : m[4] ? "num" : "fun") + '">' + esc(m[0]) + "</span>"; at = m.index + m[0].length;
    }
    return out + esc(l.slice(at));
  }
  var api = { esc: esc, plural: plural, serverKey: serverKey, cleanName: cleanName, freshChoices: freshChoices, keepSettings: keepSettings, filterRequests: filterRequests, groupRequests: groupRequests, stateOf: stateOf, needed: needed, tgText: tgText, mainFiles: mainFiles, fileOf: fileOf, tabFiles: tabFiles, fileGroups: fileGroups, codeRange: codeRange, valueGroups: valueGroups, sourceOf: sourceOf, howOf: howOf, domainNames: domainNames, shortAddress: shortAddress, choiceFields: choiceFields, plainFields: plainFields, errorText: errorText, sortFiles: sortFiles, colorLine: colorLine };
  if (typeof document === "undefined") return api;

  // ── the page ──
  var $ = function (id) { return document.getElementById(id); };
  var IC = {
    api: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>', mig: '<path d="m17 2 4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.8 12.2 8.2-8.2M17 6l2 2M14 9l2 2"/>', shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>', table: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M9 4v16"/>', file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>', ok: '<path d="M20 6 9 17l-5-5"/>', warn: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/>', chev: '<path d="m6 9 6 6 6-6"/>', next: '<path d="m9 6 6 6-6 6"/>', sliders: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>', chart: '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>', list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>', code: '<path d="m8 7-5 5 5 5M16 7l5 5-5 5"/>', panel: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16"/>', pen: '<path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>', copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>', undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-1"/>', redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h1"/>', down: '<path d="M12 3v12M7 10l5 5 5-5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>', up: '<path d="M12 15V3M7 8l5-5 5 5M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>', fold: '<path d="m7 14 5-5 5 5M7 19h10"/>', users: '<path d="M17 21v-2a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v2"/><circle cx="10" cy="7" r="4"/><path d="M21 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8"/>',
  };
  var i = function (k, c) { return '<svg class="cx-i' + (c ? " " + c : "") + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[k] + "</svg>"; };
  var PANEL = { pm: "panel-bruno", jmx: "panel-jmx" };
  var MAX_ROWS = 300, MAX_COLOR = 400000;

  // remembered in this browser: the settings (the keys the page always used) and the layout
  var PKEY = "perfx-cv-prefs", UKEY = "perfx-cv-ui", prefs = load(PKEY), ui = load(UKEY);
  function load(k) { try { return JSON.parse(localStorage.getItem(k) || "{}") || {}; } catch (e) { return {}; } }
  function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* storage blocked */ } }
  ui.hide = ui.hide || {}; ui.fold = ui.fold || {}; ui.vfold = ui.vfold || { collection: 1, environment: 1, data: 1, builtin: 1 };
  var NAMES = { pm: { fmt: "setProto", mode: "setMode", tt: "setTT", ll: "setLL" }, jmx: { fmt: "setJmxProto", mode: "setJmxMode", tt: "setJmxTT", wlm: "setJmxWlm" } }, ADV = { corr: "opt-corr", param: "opt-param", auth: "opt-auth", cmt: "opt-cmt" };
  function startChoices(kind) {
    var p = { adv: {} }; Object.keys(NAMES[kind]).forEach(function (k) { p[k] = prefs[NAMES[kind][k]]; });
    if (kind === "pm") Object.keys(ADV).forEach(function (k) { p.adv[k] = prefs[ADV[k]]; });
    return freshChoices(p);
  }
  function remember(kind) {
    var c = T[kind].c; Object.keys(NAMES[kind]).forEach(function (k) { prefs[NAMES[kind][k]] = c[k]; });
    if (kind === "pm") Object.keys(ADV).forEach(function (k) { prefs[ADV[k]] = c.adv[k]; });
    save(PKEY, prefs);
  }
  function fresh(kind) {
    return { files: { main: null, env: null, csv: [], cert: [] }, c: startChoices(kind), undo: [], redo: [], data: null, status: "idle", err: "", bad: "", zip: null, defNames: {}, origName: "", seq: 0, abort: null, timer: 0,
      tab: "req", rtab: "code", q: "", vq: "", cq: "", hit: 0, host: "", use: "", sel: 0, file: "", fold: {}, all: {}, edit: "", ren: "", renName: "", renErr: "", naming: false };
  }
  var T = { pm: fresh("pm"), jmx: fresh("jmx") }, dlgKind = "", dlgFor = "pm";
  var cur = function () { var j = $("panel-jmx"); return j && j.style.display !== "none" ? "jmx" : "pm"; };
  var P = function (k) { return T[k].data && T[k].data.preview; };
  var slots = function (kind) {
    return kind === "pm"
      ? [["main", "fi-col", "api", "Collection", true, "Postman v2.1 JSON · Bruno JSON / YAML · .bru"], ["env", "fi-env", "key", "Environment", false, "Postman environment JSON · Bruno .bru vars. Provides variable values."], ["cert", "fi-bru-cert", "shield", "Client certificates", false, ".p12 / .pfx · .pem / .crt / .cer · .key. Several files, for mutual TLS."]]
      : [["main", "fi-jmx", "mig", "JMeter test plan", true, ".jmx file"], ["csv", "fi-csv", "table", "CSV data files", false, "The .csv files the test plan reads. Several files."], ["cert", "fi-cert", "shield", "Certificates", false, ".p12 .pfx .pem .crt .cer .key. Convert a Java keystore (.jks) to .p12 first (keytool -importkeystore)."]];
  };

  // ── converting ──
  function form(kind, update) {
    var t = T[kind], fd = new FormData(), add = function (x) { fd.append(x[0], x[1]); };
    if (kind === "pm") {
      fd.append("collection", t.files.main); if (t.files.env) fd.append("environment", t.files.env);
      t.files.cert.forEach(function (f) { fd.append("certFiles", f); }); plainFields(kind, t.c).forEach(add);
    } else {
      fd.append("jmxFile", t.files.main); plainFields(kind, t.c).forEach(add);
      t.files.csv.forEach(function (f) { fd.append("csvFiles", f); }); t.files.cert.forEach(function (f) { fd.append("certFiles", f); });
    }
    if (update) choiceFields(t.c).concat([["update", "1"]]).forEach(add);
    var m = t.data && /\/download\/([0-9a-f]{64})/.exec(t.data.downloadUrl || "");
    if (m) fd.append("replaces", m[1]);
    return fd;
  }
  function post(kind, fd, signal, tries) {
    return fetch((typeof BASE_PATH === "string" ? BASE_PATH : "") + (kind === "jmx" ? "/convert-jmx" : "/convert"), { method: "POST", body: fd, signal: signal }).then(function (r) {   /* global BASE_PATH (index.ejs) */
      var json = (r.headers.get("content-type") || "").indexOf("application/json") >= 0;
      return (json ? r.json() : r.text().then(function () { return { error: r.status === 413 ? "The file is too large." : "Server error (" + r.status + "). Try again." }; })).then(function (d) {
        if (r.ok) return d;
        if (d.error === "server_busy" && tries > 0) return new Promise(function (go) { setTimeout(go, 600); }).then(function () { return post(kind, fd, signal, tries - 1); });
        throw { code: d.error };
      });
    }, function (e) { throw e && e.name === "AbortError" ? e : { code: "network" }; });
  }
  // update: the same file again after a choice; else a new conversion
  function convert(kind, update) {
    var t = T[kind]; if (!t.files.main) return Promise.resolve(false);
    update = !!(update && t.data); clearTimeout(t.timer); if (t.abort) t.abort.abort();
    var seq = ++t.seq, ctl = t.abort = new AbortController();
    t.status = "up"; t.err = ""; t.bad = "";
    if (t.data) drawState(kind); else draw(kind);
    return (t.running = post(kind, form(kind, update), ctl.signal, 4).then(function (d) {
      if (seq !== t.seq) return false;
      var first = !update || !t.data; t.data = d; t.dataNo = (t.dataNo || 0) + 1; t.zip = null; t.status = "ok"; t.abort = null;
      if (!d.preview) { t.data = null; t.status = "idle"; t.err = "The script was made but could not be shown. Try again."; draw(kind); return false; }
      if (!d.preview.requests.length) { t.data = null; t.status = "idle"; t.err = errorText("no_requests", kind); draw(kind); return false; }
      if (first) { t.origName = d.preview.scriptName || ""; t.defNames = {}; t.sel = 0; t.file = ""; t.tab = "req"; t.rtab = "code"; t.host = t.use = t.q = t.vq = t.cq = ""; t.fold = {}; t.all = {}; }
      settle(kind); draw(kind); return true;
    }, function (e) {
      if (seq !== t.seq || (e && e.name === "AbortError")) return false;
      t.abort = null; var text = errorText(e && e.code ? e.code : "network", kind);
      if (t.data) { t.status = "bad"; t.bad = text; } else { t.status = "idle"; t.err = text; }
      draw(kind); return false;
    }));
  }
  // the server's verdict: names it did not take go back; what no longer exists is dropped
  function settle(kind) {
    var t = T[kind], p = P(kind), c = t.c, refused = [];
    p.hosts.forEach(function (h) {
      if (!h.param) return; var k = serverKey(h.host);
      if (!c.names[k]) t.defNames[k] = h.param; else if (c.names[k] !== h.param) { refused.push(c.names[k]); delete c.names[k]; }
    });
    Object.keys(c.varNames).forEach(function (k) { if (!p.variables.some(function (v) { return v.orig === k && v.name === c.varNames[k]; }) && p.variables.some(function (v) { return v.name === k; })) { refused.push(c.varNames[k]); delete c.varNames[k]; } });
    if (c.name && p.scriptName !== c.name) c.name = p.scriptName === t.origName ? "" : p.scriptName;
    if (t.host && !p.hosts.some(function (h) { return h.host === t.host; })) t.host = "";
    if (t.use && !p.variables.some(function (v) { return v.name === t.use; })) t.use = "";
    if (t.file && !p.files.some(function (f) { return f.path === t.file; })) t.file = "";
    if (refused.length) toast("“" + esc(refused[0]) + "” cannot be used: the script already uses that name.");
  }
  // a choice: kept for Undo, remembered, converted after a short pause (several ticks are one conversion)
  function change(kind, fn, o) {
    var t = T[kind]; o = o || {};
    if (t.data) { t.undo.push(JSON.stringify(t.c)); if (t.undo.length > 100) t.undo.shift(); t.redo = []; }
    fn(t.c); remember(kind);
    if (!t.data) { draw(kind); return; }
    later(kind, o.wait); draw(kind);
    if (o.toast) toast(o.toast, function () { undo(kind); });
  }
  function later(kind, wait) { var t = T[kind]; t.status = "up"; clearTimeout(t.timer); t.timer = setTimeout(function () { convert(kind, true); }, wait == null ? 150 : wait); }
  function undo(kind) { var t = T[kind]; if (!t.undo.length) return; t.redo.push(JSON.stringify(t.c)); t.c = JSON.parse(t.undo.pop()); remember(kind); later(kind, 0); draw(kind); }
  function redo(kind) { var t = T[kind]; if (!t.redo.length) return; t.undo.push(JSON.stringify(t.c)); t.c = JSON.parse(t.redo.pop()); remember(kind); later(kind, 0); draw(kind); }
  // the ZIP of the script shown, as a File: read once from the server (its link works once) and kept; a link that ran
  // out is made again first
  function zip(kind) {
    var t = T[kind];
    var ready = t.status === "up" ? (t.timer ? convert(kind, true) : t.running) : t.status === "bad" ? convert(kind, true) : Promise.resolve(true);
    return Promise.resolve(ready).then(function () {
      if (t.status !== "ok") throw new Error("not updated");
      if (t.zip) return t.zip;
      var get = function () {
        return fetch(t.data.downloadUrl).then(function (r) {
          if (!r.ok) throw new Error("gone");
          var m = /filename="([^"]+)"/.exec(r.headers.get("content-disposition") || "");
          return r.blob().then(function (b) { t.zip = new File([b], m ? m[1] : "loadrunner_script.zip", { type: "application/zip" }); return t.zip; });
        });
      };
      return get().catch(function () { return convert(kind, true).then(function (ok) { if (!ok) throw new Error("not updated"); return get(); }); });
    });
  }
  function download(kind) {
    var b = document.querySelector("#" + PANEL[kind] + " [data-act=dl]"); if (b) b.disabled = true;
    zip(kind).then(function (f) {
      var a = document.createElement("a"), u = URL.createObjectURL(f); a.href = u; a.download = f.name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(u); }, 60000);
    }, function () { toast("The ZIP could not be made. Try again."); }).then(function () { if (b) b.disabled = false; });
  }
  function plan(kind) { zip(kind).then(function (f) { if (window.PerfxPlanLoad) window.PerfxPlanLoad.send([f]); }, function () { toast("The ZIP could not be made. Try again."); }); }

  // ── files ──
  function addFiles(kind, slot, files) {
    var t = T[kind], had = t.data; files = Array.prototype.slice.call(files || []); if (!files.length) return;
    if (slot === "main" || slot === "env") t.files[slot] = files[0];
    else { var names = files.map(function (f) { return f.name; }); t.files[slot] = t.files[slot].filter(function (f) { return names.indexOf(f.name) < 0; }).concat(files); }
    t.err = "";
    if (slot === "main" && had) { t.c = keepSettings(t.c); t.undo = []; t.redo = []; convert(kind, false); }   // another file: its own choices
    else if (had) later(kind, 0);
    draw(kind); if (dlgKind === "files" && $("cx-dlg").open) dialog("files", kind);
  }
  function removeFile(kind, slot, n) {
    var t = T[kind];
    if (slot === "main" || slot === "env") t.files[slot] = null; else t.files[slot].splice(n, 1);
    slots(kind).forEach(function (x) { if (x[0] === slot && $(x[1])) $(x[1]).value = ""; });
    if (t.data && slot !== "main") later(kind, 0);
    draw(kind); if (dlgKind === "files" && $("cx-dlg").open) dialog("files", kind);
  }
  function clear(kind, quiet) {
    var old = T[kind]; if (old.abort) old.abort.abort(); clearTimeout(old.timer);
    T[kind] = fresh(kind); slots(kind).forEach(function (x) { if ($(x[1])) $(x[1]).value = ""; });
    if (old.status === "up") old.status = old.data ? "ok" : "idle";
    draw(kind);
    if (!quiet && (old.files.main || old.files.env || old.files.csv.length || old.files.cert.length)) toast("Cleared. The other converter is untouched.", function () { T[kind] = old; draw(kind); });
  }

  // ── drawing: the start page ──
  function chips(kind, slot) { return T[kind].files[slot].map(function (f, n) { return '<span class="cx-chip"><span title="' + esc(f.name) + '">' + esc(f.name) + '</span><button type="button" class="cx-icon" data-rm="' + slot + '" data-n="' + n + '" aria-label="Remove ' + esc(f.name) + '">' + i("x") + "</button></span>"; }).join(""); }
  function startHtml(kind) {
    var t = T[kind], ready = !!t.files.main, many = function (s) { return s === "csv" || s === "cert"; };
    return '<div class="cx-start"><section class="cx-stage"><div class="cx-in"><h1>' + (kind === "pm" ? "Turn an API collection into a load test script" : "Move a JMeter test plan to LoadRunner") + "</h1><p>Drop your files anywhere on this page, or choose them here.</p>" +
      (t.err ? '<div class="cx-note bad" role="alert" id="cx-err-' + kind + '">' + i("warn") + "<span><b>Conversion failed.</b> " + esc(t.err) + '</span><button type="button" class="ds-btn ds-btn-sm" data-act="convert">Try again</button><button type="button" class="cx-icon" data-act="noerr" aria-label="Close this message">' + i("x") + "</button></div>" : "") +
      '<div class="cx-tiles">' + slots(kind).map(function (x) {
        var s = x[0], f = t.files[s], has = many(s) ? f.length : !!f;
        return '<div class="cx-tile' + (has ? " has" : x[4] ? " need" : "") + '"><div class="cx-th"><i>' + i(has ? "ok" : x[2]) + "</i><div><b>" + x[3] + "</b><small>" + (x[4] ? "Needed" : "Optional") + "</small></div></div>" +
          (has ? (many(s) ? '<div class="cx-chips">' + chips(kind, s) + "</div>" : '<span class="cx-fn">' + esc(f.name) + "</span>") : "<small>" + x[5] + "</small>") +
          '<div class="cx-ta"><button type="button" class="ds-btn ds-btn-sm' + (x[4] && !has ? " ds-btn-primary" : "") + '" data-pick="' + x[1] + '"' + (has && !many(s) ? "" : ' aria-label="' + (has ? "Add more" : "Choose") + ": " + x[3] + '"') + ">" + (has ? (many(s) ? "Add more" : "Change") : "Choose file") + "</button>" +
          (has && !many(s) ? '<button type="button" class="ds-btn ds-btn-sm" data-rm="' + s + '" aria-label="Remove ' + esc(f.name) + '">Remove</button>' : "") + "</div></div>";
      }).join("") + "</div>" +
      '<button type="button" class="ds-btn ds-btn-primary cx-go" id="cx-go-' + kind + '" data-act="convert"' + (ready && t.status !== "up" ? "" : " disabled") + ">" + (t.status === "up" ? '<span class="cx-spin"></span>Converting…' : "Convert" + i("next")) + "</button>" +
      '<p class="cx-muted">' + (ready ? "You choose the script format and the settings next. " : "Add the " + (kind === "pm" ? "collection" : "test plan") + " to start. ") + "Uploaded files are deleted when the conversion ends — nothing kept on the server. " +
      '<button type="button" class="cx-link" data-dlg="how">How it works</button></p></div></section></div>';
  }

  // ── drawing: the workspace ──
  function seg(k, opts, val, label) { return '<span class="cx-seg" role="group" aria-label="' + label + '">' + opts.map(function (x) { return '<button type="button" data-set="' + k + '" data-v="' + x[0] + '" aria-pressed="' + (String(x[0]) === String(val)) + '"' + (x[2] ? ' title="' + esc(x[2]) + '"' : "") + ">" + x[1] + "</button>"; }).join("") + "</span>"; }
  var FT = { pm: { devweb: "Modern JS protocol for LRE. Generates main.js with per-request transactions, correlations, JWT helper & full config files.", "web-http": "Classic C-based VuGen protocol. Generates Action.c with web_custom_request, NTLM/Kerberos, jsrsasign & all VuGen config." }, jmx: { devweb: "Generates main.js with transactions, correlations, auth & Workload Model Excel.", "web-http": "Generates Action.c with web_reg_save_param, NTLM/Kerberos auth & Workload Model Excel." } };
  var nameNow = function (kind) { return T[kind].c.name || (P(kind) && P(kind).scriptName) || T[kind].origName || "Script"; };
  var missing = function (kind) { return P(kind).variables.filter(function (v) { return sourceOf(v, T[kind].c.values) === "missing"; }); };
  function csvMissing(kind) {
    var d = T[kind].data.dependency, have = T[kind].files.csv.map(function (f) { return f.name.toLowerCase(); });
    return ((d && d.missing) || []).filter(function (m) { return have.indexOf(String(m.basename).toLowerCase()) < 0; });
  }
  var need = function (kind) { return needed(P(kind).requests, T[kind].c.out, T[kind].c.values); };
  function checks(kind) { return (missing(kind).length ? 1 : 0) + (csvMissing(kind).length ? 1 : 0) + (need(kind).length ? 1 : 0); }
  function stateHtml(kind) {
    var t = T[kind];
    return t.status === "up" ? '<span class="cx-state up" role="status"><i></i>Updating…</span>' : t.status === "bad" ? '<span class="cx-state bad" role="status"><i></i>Not updated</span>' : '<span class="cx-state" role="status" title="The script shown and the ZIP are the same"><i></i>Up to date</span>';
  }
  function drawState(kind) { var b = document.querySelector("#" + PANEL[kind] + " .cx-state"); if (b) b.outerHTML = stateHtml(kind); var x = $(PANEL[kind]); if (x && x._parts) x._parts[0][1] = ""; }
  function barHtml(kind) {
    var t = T[kind], ck = checks(kind), tg = t.data.threadGroups || [], users = tg.reduce(function (a, x) { return a + (Number(x.virtualUsers) || 0); }, 0), sub = [];
    if (kind === "pm") sub.push(t.files.env ? "with " + t.files.env.name : "no environment"); else sub.push(plural(tg.length, "thread group") + " · " + plural(users, "user"));
    if (kind === "jmx" && t.files.csv.length) sub.push(plural(t.files.csv.length, "data file"));
    if (t.files.cert.length) sub.push(plural(t.files.cert.length, "certificate"));
    return '<div class="cx-bar"><div class="cx-title">' +
      (t.naming ? '<form data-form="name"><input id="cx-name" maxlength="60" spellcheck="false" autocomplete="off" aria-label="Script name" value="' + esc(nameNow(kind)) + '"><button class="ds-btn ds-btn-sm ds-btn-primary">Save</button><button type="button" class="ds-btn ds-btn-sm" data-act="noname">Cancel</button></form>'
        : '<button type="button" class="cx-name" data-act="name" title="Rename the script: the name is given to the .usr file' + (t.c.mode === "multi" ? " of every script" : "") + ' and to the ZIP"><b>' + esc(nameNow(kind)) + "</b>" + i("pen") + "</button>") +
      '<small title="' + esc(t.files.main.name) + '">from ' + esc(t.files.main.name) + " · " + esc(sub.join(" · ")) + '</small></div><button type="button" class="ds-btn" data-dlg="files" title="Change, add or remove files, or convert another">' + i("file") + "Files</button>" + stateHtml(kind) +
      '<span class="cx-grow"></span><button type="button" class="cx-icon" data-act="undo" aria-label="Undo" title="Undo the last change (Ctrl+Z)"' + (t.undo.length ? "" : " disabled") + ">" + i("undo") + '</button><button type="button" class="cx-icon" data-act="redo" aria-label="Redo" title="Redo (Ctrl+Y)"' + (t.redo.length ? "" : " disabled") + ">" + i("redo") + "</button>" +
      (window.PerfxShell ? '<button type="button" class="ds-btn" data-act="plan" aria-label="Plan the load" title="Open this script in the Workload Modeller: Vusers, pacing and load generators">' + i("chart") + '<span class="cx-w2">Plan the load</span></button>' : "") +
      '<span class="cx-split"><button type="button" class="ds-btn ds-btn-primary" data-act="dl">' + i("down") + 'Download ZIP</button><button type="button" class="ds-btn ds-btn-primary" data-dlg="check" aria-label="Ready to download? ' + (ck ? plural(ck, "thing") + " worth a look" : "Everything is fine") + '" title="Ready to download?">' + (ck ? "<em>" + ck + "</em>" : i("ok")) + i("chev") + "</button></span></div>" +
      '<div class="cx-tools"><span class="cx-set"><span class="cx-lbl">Format</span>' + seg("fmt", [["web-http", "<i>C</i>Web HTTP/HTML", FT[kind]["web-http"]], ["devweb", "<i>JS</i>DevWeb", FT[kind].devweb]], t.c.fmt, "Script format") + '</span><span class="cx-set"><span class="cx-lbl">Scripts</span>' +
      seg("mode", kind === "pm" ? [["single", "Single"], ["multi", "Multi-script", "One script per top-level folder"]] : [["single", "Single"], ["multi", "Per thread group"]], t.c.mode, "Script mode") + '</span><span class="cx-set"><span class="cx-lbl" title="The pause between steps">Think time</span>' + seg("tt", [[1, "1 s"], [2, "2 s"], [3, "3 s"], [5, "5 s"]], t.c.tt, "Think time: the pause between steps") +
      '</span><span class="cx-grow"></span><button type="button" class="ds-btn ds-btn-sm" data-dlg="sett">' + i("sliders") + "Settings</button></div>";
  }
  function noticesHtml(kind) {
    var t = T[kind], h = "", csv = csvMissing(kind), nd = need(kind);
    if (t.status === "bad") h += '<div class="cx-note bad" role="alert">' + i("warn") + "<span><b>The last change could not be applied.</b> " + esc(t.bad) + ' The script below is the one before it; your choices are kept.</span><button type="button" class="ds-btn ds-btn-sm" data-act="retry">Try again</button></div>';
    if (csv.length) h += '<div class="cx-note">' + i("warn") + "<span>The test plan reads " + csv.slice(0, 3).map(function (m) { return "<code>" + esc(m.basename) + "</code>" + (m.variables && m.variables.length ? " (" + esc(m.variables.slice(0, 4).join(", ")) + (m.variables.length > 4 ? " …" : "") + ")" : ""); }).join(", ") + (csv.length > 3 ? " and " + (csv.length - 3) + " more" : "") + ", not added yet. The script needs " + (csv.length === 1 ? "it" : "them") + ' at run time.</span><button type="button" class="ds-btn ds-btn-sm" data-pick="fi-csv">Add ' + (csv.length === 1 ? esc(csv[0].basename) : "the files") + "</button></div>";
    if (nd.length) h += '<div class="cx-note">' + i("warn") + "<span><code>" + esc(nd[0].name) + "</code> is set by request " + nd[0].by.slice(0, 4).join(", ") + " (left out) and sent by " + plural(nd[0].usedBy.length, "other") + (nd.length > 1 ? "; " + plural(nd.length - 1, "more value") + " too" : "") + ". Put it back, or give a value in Values.</span>" + '<button type="button" class="ds-btn ds-btn-sm" data-act="putneeded">Put it back</button></div>';
    return h;
  }
  var tickHtml = function (kind, ns, label) { var k = stateOf(ns, T[kind].c.out); return '<input type="checkbox" class="cx-cb" data-tick="' + ns.join() + '"' + (k === "all" ? " checked" : "") + (k === "some" ? " data-some" : "") + ' aria-label="' + esc(label) + ' in the script" title="Untick what the script should leave out">'; };
  var nums = function (l) { return l.map(function (r) { return r.n; }); };
  var hideBtn = function (k, n) { return '<button type="button" class="cx-icon" data-hide="' + k + '" aria-label="Hide ' + n + '" title="Hide this panel (the others get the space)">' + i("panel") + "</button>"; };
  var railHtml = function (k, ic, n) { return '<section class="cx-pane cx-rail"><button type="button" data-show="' + k + '" title="Show ' + n + '">' + i(ic) + "<span>" + n + "</span></button></section>"; };

  function domainsHtml(kind) {
    var t = T[kind], p = P(kind);
    return '<section class="cx-pane cx-dom"><div class="cx-ph"><button type="button" class="cx-fold" data-fold-dom aria-expanded="' + !ui.domFold + '">' + i("chev", "cx-chev") + i("globe") + "<b>Domains</b><span class=\"cx-n\">" + p.hosts.length + "</span></button>" + hideBtn("d", "Domains") + "</div>" +
      (ui.domFold ? "" : '<div class="cx-pb">' + p.hosts.map(function (h) {
        var ns = nums(p.requests.filter(function (r) { return r.host === h.host; })), names = domainNames(h, p.variables), st = stateOf(ns, t.c.out), open = t.ren === h.host && names.some(function (n) { return n.can && n.name === t.renName; });
        return '<div class="cx-dr' + (t.host === h.host ? " on" : "") + (st === "none" ? " off" : "") + '" role="group" aria-label="' + esc(h.host) + '">' + tickHtml(kind, ns, "Requests to " + h.host) + '<div class="cx-dm"><button type="button" class="cx-dn" data-host="' + esc(h.host) + '" aria-pressed="' + (t.host === h.host) + '" title="Show only its requests">' + esc(h.host).replace(/\./g, ".<wbr>") + '</button><div class="cx-dp">' +
          (names.length ? names.map(function (n) { return n.can ? '<button type="button" class="cx-param" data-ren="' + esc(h.host) + '" data-rn="' + esc(n.name) + '" aria-expanded="' + (open && n.name === t.renName) + '" title="Parameter in the script — click to change its name' + (n.type === "var" ? " or address" : "") + '"><code>' + esc(n.name) + "</code>" + i("pen") + "</button>" : n.why === "Needs a value first" ? '<button type="button" class="cx-param warn" data-goval="' + esc(n.name) + '" title="Nothing gives it a value: the script calls it as written">Needs a value</button>' : '<span class="cx-param fix" title="' + esc(n.why) + '"><code>' + esc(n.name) + "</code></span>"; }).join("") : '<span class="cx-muted">no parameter</span>') +
          "</div></div><span class=\"cx-n\" title=\"" + plural(h.count, "request") + '">' + h.count + "</span></div>" + (open ? renHtml(kind, h, names) : "");
      }).join("") + "</div>") + "</section>";
  }
  function renHtml(kind, h, names) {
    var t = T[kind], l = names.filter(function (n) { return n.can && n.name === t.renName; });
    return '<form class="cx-ren" data-form="ren" data-host="' + esc(h.host) + '">' + l.map(function (n, k) {
      return '<label>Parameter name<input class="ds-field" name="n' + k + '" maxlength="40" spellcheck="false" autocomplete="off" value="' + esc(n.name) + '"' + (t.renErr ? ' aria-invalid="true" aria-describedby="cx-ren-err"' : "") + "></label>" +
        (n.type === "var" ? '<label>Address<input class="ds-field" name="v' + k + '" spellcheck="false" autocomplete="off" value="' + esc(t.c.values[n.key] != null ? t.c.values[n.key] : n.value || "") + '"' + (n.hidden ? ' placeholder="hidden: leave empty to keep it"' : "") + "></label>" : "");
    }).join("") + (t.renErr ? '<p class="cx-err" id="cx-ren-err" role="alert">' + esc(t.renErr) + "</p>" : "") + '<div><button class="ds-btn ds-btn-sm ds-btn-primary">Save</button><button type="button" class="ds-btn ds-btn-sm" data-act="noren">Cancel</button></div></form>';
  }
  function visible(kind) {
    var t = T[kind], p = P(kind), use = t.use && p.variables.filter(function (v) { return v.name === t.use; })[0];
    return filterRequests(p.requests, { q: t.q, host: t.host, use: use });
  }
  function leftHtml(kind) {
    var t = T[kind], p = P(kind), miss = missing(kind).length;
    var tab = function (k, n, cnt, warn) { return '<button type="button" role="tab" data-tab="' + k + '" aria-selected="' + (t.tab === k) + '" tabindex="' + (t.tab === k ? 0 : -1) + '">' + n + ' <span class="cx-n' + (warn ? " warn" : "") + '">' + cnt + "</span></button>"; };
    return '<section class="cx-pane cx-left"><div class="cx-ph"><div role="tablist" aria-label="Requests and values">' + tab("req", "Requests", (t.c.out.length ? p.requests.length - t.c.out.length + " of " : "") + p.requests.length) + tab("val", "Values", miss ? miss + " to give" : p.variables.length, miss) + '</div><span class="cx-grow"></span>' + hideBtn("l", "Requests and values") + "</div>" +
      (t.tab === "req" ? reqHead(kind) + '<div class="cx-pb" id="cx-rl-' + kind + '">' + reqList(kind) + "</div>" : '<div class="cx-pt"><label class="cx-search">' + i("search") + '<input class="ds-field" type="search" data-in="vq" value="' + esc(t.vq) + '" placeholder="Filter by name or value" aria-label="Filter the values"></label></div><div class="cx-pb" id="cx-vl-' + kind + '">' + valList(kind) + "</div>") + "</section>";
  }
  function reqHead(kind) {
    var t = T[kind], gs = groupRequests(visible(kind)), all = gs.length > 0 && gs.every(function (g) { return t.fold[g.name]; });
    return '<div class="cx-pt"><label class="cx-search">' + i("search") + '<input class="ds-field" type="search" data-in="q" value="' + esc(t.q) + '" placeholder="Filter by name or address" aria-label="Filter the requests"></label>' +
      (t.c.out.length ? '<button type="button" class="ds-btn ds-btn-xs" data-act="putback">Put back ' + t.c.out.length + "</button>" : "") + '<button type="button" class="cx-icon" data-act="foldall" aria-label="' + (all ? "Expand all" : "Collapse all") + '" title="' + (all ? "Expand all" : "Collapse all") + '">' + i("fold") + "</button></div>" +
      (t.host || t.use ? '<div class="cx-pt cx-filters">Showing ' + (t.host ? '<span class="cx-chip"><span>' + esc(t.host) + '</span><button type="button" class="cx-icon" data-act="nohost" aria-label="Show every domain">' + i("x") + "</button></span>" : "") + (t.use ? '<span class="cx-chip"><span>using <code>' + esc(t.use) + '</code></span><button type="button" class="cx-icon" data-act="nouse" aria-label="Show every request">' + i("x") + "</button></span>" : "") + "</div>" : "");
  }
  function reqList(kind) {
    var t = T[kind], gs = groupRequests(visible(kind)), TG = {}; (t.data.threadGroups || []).forEach(function (x) { TG[x.name] = x; });
    return gs.map(function (g) {
      var f = !!t.fold[g.name], rows = t.all[g.name] ? g.requests : g.requests.slice(0, MAX_ROWS), tx = TG[g.name] ? tgText(TG[g.name]) : "";
      return '<div class="cx-g"><div class="cx-gh">' + tickHtml(kind, nums(g.requests), "Every request in " + g.name) + '<button type="button" data-fold="' + esc(g.name) + '" aria-expanded="' + !f + '">' + i("chev", "cx-chev") + "<b>" + esc(g.name) + '</b><span title="' + esc(tx) + '">' + (tx ? esc(tx) : g.requests.length) + "</span></button></div>" +
        (f ? "" : rows.map(function (r) {
          var o = t.c.out.indexOf(r.n) >= 0, sub = r.folder && r.folder !== g.name ? r.folder.replace(g.name + "/", "") : "";
          return '<div role="group" aria-label="Request ' + r.n + '" class="cx-row' + (o ? " off" : "") + (t.sel === r.n ? " sel" : "") + '">' + tickHtml(kind, [r.n], r.name) + '<span class="cx-no">' + r.n + '</span><span class="cx-m ' + esc(r.method) + '">' + esc(r.method) + '</span><button type="button" data-req="' + r.n + '" aria-pressed="' + (t.sel === r.n) + '" title="' + esc(r.method + " " + r.address) + '"><b><span class="cx-rn">' + esc(r.name) + "</span>" + (sub ? ' <em>' + esc(sub) + "</em>" : "") + (o ? " <em>left out</em>" : "") + "</b><code>" + esc(shortAddress(r.address)) + "</code></button>" + i("next", "cx-gt") + "</div>";
        }).join("") + (g.requests.length > rows.length ? '<button type="button" class="ds-btn ds-btn-sm cx-more" data-all="' + esc(g.name) + '">Show all ' + g.requests.length + "</button>" : "")) + "</div>";
    }).join("") || '<p class="cx-empty">No request matches.</p>';
  }
  var GIVE = { missing: 1, empty: 1, environment: 1, collection: 1, given: 1 };
  function valList(kind) {
    var t = T[kind], gs = valueGroups(P(kind).variables, t.c.values, t.vq, kind);
    if (!gs.length) return '<p class="cx-empty">' + (t.vq ? "No value matches." : "The requests send no variables.") + "</p>";
    return gs.map(function (g) {
      var f = !t.vq && !!ui.vfold[g.key];
      return '<div class="cx-g"><div class="cx-gh"><button type="button" data-vfold="' + g.key + '" aria-expanded="' + !f + '">' + i("chev", "cx-chev") + "<b>" + g.title + '</b><span class="cx-n' + (g.key === "missing" ? " warn" : "") + '">' + g.list.length + "</span></button></div>" + (f ? "" : g.list.map(function (v) { return valRow(kind, v, g.key); }).join("")) + "</div>";
    }).join("");
  }
  function valRow(kind, v, src) {
    var t = T[kind], k = keyOf(v), mine = t.c.values[k] != null, ed = src === "missing" || t.edit === k, hw = howOf(v);
    var val = ed ? '<form data-form="give" data-k="' + esc(k) + '"><input class="ds-field" value="' + esc(mine ? t.c.values[k] : v.hidden ? "" : v.value || "") + '" placeholder="Type a value" spellcheck="false" autocomplete="off" aria-label="Value for ' + esc(v.name) + '"><button class="ds-btn ds-btn-sm ds-btn-primary">Use</button>' + (src === "missing" ? "" : '<button type="button" class="ds-btn ds-btn-sm" data-act="noedit">Cancel</button>') + "</form>"
      : mine ? "<code>" + esc(t.c.values[k]) + "</code>" : src === "set" ? (hw.text ? "<code>" + esc(hw.text) + "</code>" : "") + "<small>" + (hw.kind ? esc(hw.kind) + " · " : "") + "request " + v.setBy.slice(0, 4).join(", ") + (v.setBy.length > 4 ? " and " + (v.setBy.length - 4) + " more" : "") + "</small>"
        : src === "builtin" ? "a new value each time it is sent" : src === "data" ? "a column of <code>" + esc(v.file) + "</code>" : src === "empty" ? "declared with no value" : v.hidden ? "hidden (looks like a secret)" : "<code>" + esc(v.value) + "</code>";
    return '<div class="cx-val' + (src === "missing" ? " need" : "") + (t.use === v.name ? " on" : "") + '"><div><code><b>' + esc(v.name) + "</b></code>" + (v.orig ? "<small>" + esc(v.orig) + " in the file</small>" : "") + "</div><div>" + val + '</div><div class="cx-va">' +
      (mine && !ed ? '<button type="button" class="ds-btn ds-btn-xs" data-ungive="' + esc(k) + '">Use the file&#39;s value</button>' : "") + (GIVE[src] && !ed ? '<button type="button" class="cx-icon" data-edit="' + esc(k) + '" aria-label="' + (src === "empty" ? "Give a value to " : "Change the value of ") + esc(v.name) + '" title="' + (src === "empty" ? "Give a value" : "Change the value") + '">' + i("pen") + "</button>" : "") +
      (v.usedBy.length || v.setBy.length ? '<button type="button" class="cx-link" data-use="' + esc(v.name) + '" title="Show the requests that send or set it">' + plural(v.usedBy.length, "use") + "</button>" : "") + "</div></div>";
  }
  var selReq = function (kind) { var t = T[kind]; return t.sel ? P(kind).requests.filter(function (r) { return r.n === t.sel; })[0] : null; };
  function curFile(kind) { var t = T[kind], p = P(kind); return p.files.filter(function (f) { return f.path === t.file; })[0] || fileOf(p.files, selReq(kind) || p.requests.filter(function (r) { return t.c.out.indexOf(r.n) < 0; })[0]) || p.files.filter(function (f) { return f.text != null; })[0] || p.files[0]; }
  function rightHtml(kind) {
    var t = T[kind], p = P(kind), r = selReq(kind), f = curFile(kind), tab = function (k, n) { return '<button type="button" role="tab" data-rtab="' + k + '" aria-selected="' + (t.rtab === k) + '" tabindex="' + (t.rtab === k ? 0 : -1) + '">' + n + "</button>"; };
    return '<section class="cx-pane cx-right"><div class="cx-ph"><div role="tablist" aria-label="Script and request">' + tab("code", 'Script <span class="cx-n">' + plural(p.files.length, "file") + "</span>") + tab("req", "Request" + (r ? ' <span class="cx-n">' + r.n + "</span>" : "")) + '</div><span class="cx-grow"></span>' + (t.rtab === "code" ? '<button type="button" class="ds-btn ds-btn-xs" data-act="copy"' + (f && f.text != null ? "" : " disabled") + ">" + i("copy") + "<span>Copy</span></button>" : "") + hideBtn("r", "Script") + "</div>" +
      (t.rtab === "req" ? '<div class="cx-pb">' + (r ? reqDetails(kind, r) : '<p class="cx-empty">Choose a request to see its headers, body, scripts and values.</p>') + "</div>"
        : '<div class="cx-pt"><div class="cx-ftabs" role="tablist" aria-label="Main files">' + tabFiles(p.files, f).map(function (x) { return '<button type="button" role="tab" data-file="' + esc(x.path) + '" aria-selected="' + (x === f) + '">' + esc(baseOf(x.path)) + "</button>"; }).join("") + '</div><select class="ds-field" data-in="file" aria-label="All files in the ZIP">' + fileGroups(p.files).map(function (g) { var o = g.files.map(function (x) { return '<option value="' + esc(x.path) + '"' + (x === f ? " selected" : "") + ">" + esc((g.dir ? g.dir + " / " : "") + baseOf(x.path)) + (x.text == null ? " (not shown)" : "") + "</option>"; }).join(""); return g.dir ? '<optgroup label="' + esc(g.dir) + '/">' + o + "</optgroup>" : o; }).join("") + '</select><label class="cx-search">' + i("search") + '<input class="ds-field" type="search" data-in="cq" value="' + esc(t.cq) + '" placeholder="Find in this file" aria-label="Find in this file (Enter: the next one)"></label><span class="cx-muted cx-hits"></span></div><div class="cx-pb cx-code" id="cx-code-' + kind + '" tabindex="0" role="region" aria-label="Code"></div>') + "</section>";
  }
  // the code is drawn (a large script takes a while) only when something about it changed; a redraw of the page keeps it
  function drawCode(kind, old) {
    var t = T[kind], box = $("cx-code-" + kind); if (!box) return;
    var f = curFile(kind), key = [t.dataNo, f && f.path, t.cq, t.file ? 0 : t.sel].join("|");
    if (box._key === key) return;
    if (old && old.key === key) { box.replaceWith(old.el); return; }
    box.innerHTML = codeHtml(kind, f); box._key = key;
  }
  function codeHtml(kind, f) {
    var t = T[kind], p = P(kind); if (!f) return "";
    if (f.text == null) return '<p class="cx-empty">' + esc(f.path) + " (" + Number(f.size).toLocaleString("en-GB") + " bytes) is in the ZIP but not shown here: " + (/\.(pem|key|crt|cer|p12|pfx|jks|der)$/i.test(f.path) ? "a key or certificate." : /\.xlsx$/i.test(f.path) ? "an Excel workbook." : p.truncated ? "too large to show." : "not a text file.") + "</p>";
    if (!f.text) return '<p class="cx-empty">(empty file)</p>';
    var r = selReq(kind), rg = r && r.tx && !t.file ? codeRange(f.text, r.tx) : null, code = /\.(js|c|h|ts)$/i.test(f.path) && f.text.length < MAX_COLOR, q = t.cq.toLowerCase();
    return "<pre>" + f.text.replace(/\r\n/g, "\n").split("\n").map(function (l, n) {
      var x;
      if (q && l.toLowerCase().indexOf(q) >= 0) { x = ""; var low = l.toLowerCase(), at = 0, k; while ((k = low.indexOf(q, at)) >= 0) { x += esc(l.slice(at, k)) + "<mark>" + esc(l.slice(k, k + q.length)) + "</mark>"; at = k + q.length; } x += esc(l.slice(at)); }
      else x = code ? colorLine(l) : esc(l);
      return '<div' + (rg && n >= rg[0] && n <= rg[1] ? ' class="hl"' : "") + ">" + (x || " ") + "</div>";
    }).join("") + "</pre>";
  }
  function reqDetails(kind, r) {
    var t = T[kind], p = P(kind), d = r.details || {}, kv = function (l) { return '<table class="cx-kv"><tbody>' + l.map(function (x) { return "<tr><td>" + esc(x[0]) + "</td><td><code>" + esc(x[1]) + "</code></td></tr>"; }).join("") + "</tbody></table>"; };
    var vt = function (l) { return '<table class="cx-kv"><tbody>' + l.map(function (v) { var s = sourceOf(v, t.c.values), h = howOf(v); return "<tr><td><code>" + esc(v.name) + "</code></td><td>" + (s === "given" ? "<code>" + esc(t.c.values[keyOf(v)]) + "</code>" : s === "set" ? (h.text ? "<code>" + esc(h.text) + "</code> " : "") + '<span class="cx-muted">request ' + v.setBy.slice(0, 4).join(", ") + "</span>" : s === "missing" ? '<span class="cx-tag warn">Needs a value</span>' : s === "builtin" ? "made by the script" : s === "data" ? "a column of " + esc(v.file) : v.hidden ? "hidden" : "<code>" + esc(v.value) + "</code>") + "</td></tr>"; }).join("") + "</tbody></table>"; };
    var uses = p.variables.filter(function (v) { return v.usedBy.indexOf(r.n) >= 0; }), sets = p.variables.filter(function (v) { return v.setBy.indexOf(r.n) >= 0; }), o = t.c.out.indexOf(r.n) >= 0, sec = function (h, b) { return "<section><h3>" + h + "</h3>" + b + "</section>"; };
    return '<div class="cx-rq"><div class="cx-rt"><span class="cx-m ' + esc(r.method) + '">' + esc(r.method) + "</span><code>" + esc(r.address) + '</code><button type="button" class="ds-btn ds-btn-sm" data-act="leave">' + (o ? "Put back" : "Leave out") + '</button><button type="button" class="ds-btn ds-btn-sm" data-rtab="code">' + i("code") + "Show in script</button></div>" +
      sec("Headers", d.headers ? kv(d.headers) : '<p class="cx-muted">None of its own</p>') + (d.auth ? sec("Sign-in", '<p class="cx-muted">' + esc(d.auth) + "</p>") : "") + (d.body ? sec("Body", "<pre>" + esc(d.body) + "</pre>") : d.form ? sec("Form fields", kv(d.form)) : "") + (uses.length ? sec("Values it sends", vt(uses)) : "") + (sets.length ? sec("Values it sets", vt(sets)) : "") + (d.scripts || []).map(function (s) { return sec(s[0], "<pre>" + esc(s[1]) + "</pre>"); }).join("") + "</div>";
  }
  var RS = '<div class="cx-rs" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Width of Script: drag, or the arrow keys; double-click puts it back" title="Drag to resize (double-click puts it back)"></div>';
  // the parts of the workspace: only those that changed are drawn again (a collection can have hundreds of requests)
  function parts(kind) {
    return [[".cx-top", barHtml(kind)], [".cx-notes", noticesHtml(kind)], ["d", ui.hide.d ? railHtml("d", "globe", "Domains") : domainsHtml(kind)], ["l", ui.hide.l ? railHtml("l", "list", "Requests and values") : leftHtml(kind)], ["r", ui.hide.r ? railHtml("r", "code", "Script") : rightHtml(kind)]];
  }
  function drawWs(kind, box) {
    var ps = parts(kind), ws = box.querySelector(".cx-ws");
    if (!ws || !box._parts) {
      box.innerHTML = '<div class="cx-ws"><div class="cx-top">' + ps[0][1] + '</div><div class="cx-notes">' + ps[1][1] + '</div><div class="cx-grid" data-grid>' + ps[2][1] + ps[3][1] + RS + ps[4][1] + "</div></div>";
      box._parts = ps;
    } else {
      var g = ws.querySelector("[data-grid]");
      ps.forEach(function (p, n) {
        if (p[1] === box._parts[n][1]) return;
        if (n < 2) ws.querySelector(p[0]).innerHTML = p[1];
        else { var el = g.children[n === 4 ? 3 : n - 2]; el.outerHTML = p[1]; }
      });
      box._parts = ps;
    }
  }
  function layout(kind) {
    var g = document.querySelector("#" + PANEL[kind] + " [data-grid]"); if (!g) return;
    g.className = "cx-grid" + (ui.hide.d ? " nd" : "") + (ui.hide.l ? " nl" : "") + (ui.hide.r ? " nr" : "") + (ui.domFold ? " fd" : "");
    if (ui.w) g.style.setProperty("--cx-r", ui.w + "px"); else g.style.removeProperty("--cx-r");
    g.querySelectorAll("[data-hide]").forEach(function (b) { var k = b.getAttribute("data-hide"), last = k !== "d" && ui.hide[k === "l" ? "r" : "l"]; b.disabled = !!last; if (last) b.title = "The last panel shown stays"; });
    var rs = g.querySelector(".cx-rs"), off = !!(ui.hide.l || ui.hide.r); rs.classList.toggle("off", off); rs.tabIndex = off ? -1 : 0;
  }
  var SCROLL = [".cx-dom .cx-pb", ".cx-left .cx-pb", ".cx-right .cx-pb", ".cx-stage"], FOCUS = ["data-set", "data-tick", "data-fold", "data-vfold", "data-fold-dom", "data-tab", "data-rtab", "data-req", "data-act", "data-host", "data-ren", "data-edit", "data-in", "data-file", "data-pick", "data-dlg", "data-hide", "data-show"];
  function draw(kind) {
    var box = $(PANEL[kind]); if (!box) return;
    var t = T[kind], a = document.activeElement, inside = a && box.contains(a), sel = "", at = null, typed = null, keep = {};
    if (inside) { FOCUS.some(function (k) { if (!a.hasAttribute(k)) return false; sel = "[" + k + '="' + CSS.escape(a.getAttribute(k)) + '"]' + (k === "data-set" ? '[data-v="' + CSS.escape(a.getAttribute("data-v")) + '"]' : ""); return true; }); if (a.id) sel = "#" + a.id; var fm = a.tagName === "INPUT" && a.closest("form[data-form]"); if (fm) { typed = a.value; sel = fm.getAttribute("data-form") === "give" ? 'form[data-k="' + CSS.escape(fm.getAttribute("data-k")) + '"] input' : fm.getAttribute("data-form") === "ren" ? '.cx-ren input[name="' + a.name + '"]' : "#cx-name"; } try { at = a.selectionStart; } catch (e) { at = null; } }
    SCROLL.forEach(function (s) { var e = box.querySelector(s); if (e) keep[s] = [e.scrollTop, e.scrollLeft, e.id]; });
    var oc = $("cx-code-" + kind), old = oc && oc._key ? { key: oc._key, el: oc } : null;
    if (t.data) drawWs(kind, box); else { box.innerHTML = startHtml(kind); box._parts = null; }
    if (t.data) { layout(kind); drawCode(kind, old); }
    box.querySelectorAll("[data-tick]").forEach(function (x) { x.checked = x.defaultChecked; });
    marks(box);
    SCROLL.forEach(function (s) { var e = box.querySelector(s); if (e && keep[s] && keep[s][2] === e.id) { e.scrollTop = keep[s][0]; e.scrollLeft = keep[s][1]; } });
    hits(kind, false);
    if (sel) { var n = box.querySelector(sel); if (n) { if (typed != null && n.value !== typed) n.value = typed; n.focus({ preventScroll: true }); if (at != null) try { n.setSelectionRange(at, at); } catch (e) { /* no caret */ } } }
    document.body.classList.toggle("cx-has-ws", !!T[cur()].data);
  }
  function marks(box) { box.querySelectorAll("[data-some]").forEach(function (x) { x.indeterminate = true; }); }
  function part(kind, sel, html) { var e = document.querySelector("#" + PANEL[kind] + " " + sel); if (e) { e.innerHTML = html; marks(e); } $(PANEL[kind])._parts = null; }
  function hits(kind, go) {
    var t = T[kind], box = $("cx-code-" + kind), out = document.querySelector("#" + PANEL[kind] + " .cx-hits"); if (!box || !out) return;
    var m = box.querySelectorAll("mark"); out.textContent = t.cq ? (m.length ? (m.length === 1 ? "1 found" : m.length + " found") : "Not found") : "";
    if (!go || !m.length) return;
    t.hit = (t.hit + m.length) % m.length; m.forEach(function (x, n) { x.className = n === t.hit ? "on" : ""; }); within(box, m[t.hit]);
  }
  function within(box, e) { var b = box.getBoundingClientRect(), r = e.getBoundingClientRect(); box.scrollTop += r.top - b.top - box.clientHeight / 3; if (r.left < b.left || r.right > b.right - 20) box.scrollLeft += r.left - b.left - 60; }
  function showSel(kind) {
    var box = $("cx-code-" + kind), h = box && box.querySelector(".hl"), row = document.querySelector("#" + PANEL[kind] + " .cx-row.sel"), list = $("cx-rl-" + kind);
    if (box) { box.scrollLeft = 0; box.scrollTop = h ? box.scrollTop + h.getBoundingClientRect().top - box.getBoundingClientRect().top - 16 : box.scrollTop; }
    if (row && list) { var a = row.getBoundingClientRect(), b = list.getBoundingClientRect(); if (a.top < b.top + 36 || a.bottom > b.bottom) list.scrollTop += a.top - b.top - list.clientHeight / 3; }
  }

  // ── windows ──
  var ADVT = [["corr", "Correlation Detection", "Extract dynamic values from API responses — access_token, userId, sessionId, CSRF tokens"], ["param", "Parameterization", "Convert static variables into CSV parameters — baseUrl, clientId, API keys"], ["auth", "Authentication Handling", "OAuth2, Bearer (dynamic-aware), Basic, API Key, JWT (PS256 / RS256 / HS256), AWS Sig v4"], ["cmt", "Add Code Comments", "Inline explanatory comments in the generated script to guide manual review"]];
  function dialog(k, kind) {
    var d = $("cx-dlg"), t = T[kind], head = function (x) { return '<div class="cx-dh"><h2>' + x + '</h2><button type="button" class="cx-icon" data-close aria-label="Close">' + i("x") + "</button></div>"; }, h = ""; dlgKind = k; dlgFor = kind;
    if (k === "files") h = head("Files") + '<div class="cx-db">' + slots(kind).map(function (x) {
      var s = x[0], f = t.files[s], many = s === "csv" || s === "cert", has = many ? f.length : !!f;
      return '<div class="cx-frow' + (has ? " has" : "") + '"><i>' + i(has ? "ok" : x[2]) + '</i><div class="cx-grow"><b>' + x[3] + "</b>" + (many && has ? '<div class="cx-chips">' + chips(kind, s) + "</div>" : "<small>" + (has ? esc(f.name) : "None") + "</small>") + '</div><button type="button" class="ds-btn ds-btn-sm" data-pick="' + x[1] + '" aria-label="' + (many ? "Add" : has ? "Change" : "Choose") + ": " + x[3] + '">' + (many ? "Add" : has ? "Change" : "Choose") + "</button>" + (has && !many && !x[4] ? '<button type="button" class="cx-icon" data-rm="' + s + '" aria-label="Remove ' + esc(f.name) + '">' + i("x") + "</button>" : "") + "</div>";
    }).join("") + '</div><div class="cx-df"><span class="cx-muted cx-grow">A changed file is converted at once</span><button type="button" class="ds-btn" data-act="another">' + i("up") + 'Convert another</button><button type="button" class="ds-btn ds-btn-primary" data-close>Done</button></div>';
    if (k === "sett") h = head("Settings") + '<div class="cx-db">' + (kind === "jmx" ? '<div class="cx-opt"><div class="cx-grow"><b>Workload workbook</b><small>Workload Model Excel (.xlsx) in the ZIP</small></div>' + seg("wlm", [[true, "Include"], [false, "Leave out"]], t.c.wlm, "Workload workbook") + "</div>"
      : '<div class="cx-opt"><div class="cx-grow"><b>Log level</b><small>How much the script writes to its log</small></div>' + seg("ll", [["info", "Info"], ["debug", "Debug"]], t.c.ll, "Log level") + "</div>" + ADVT.map(function (a) { return '<label class="cx-opt"><div class="cx-grow"><b>' + a[1] + "</b><small>" + a[2] + '</small></div><span class="cx-sw"><input type="checkbox" data-adv="' + a[0] + '"' + (t.c.adv[a[0]] ? " checked" : "") + ' aria-label="' + a[1] + '"><span></span></span></label>'; }).join("")) + '</div><div class="cx-df"><span class="cx-muted cx-grow">Remembered for the next conversion</span><button type="button" class="ds-btn ds-btn-primary" data-close>Done</button></div>';
    if (k === "check") {
      var p = P(kind), ms = missing(kind), nd = need(kind), csv = csvMissing(kind), it = function (ok, x, a) { return (a ? '<button type="button" ' + a : "<div") + ' class="cx-di' + (ok ? "" : " warn") + '">' + i(ok ? "ok" : "warn") + "<span>" + x + "</span>" + (a ? i("next") + "</button>" : "</div>"); }, found = ((t.data.dependency || {}).found || []).filter(function (f) { return f.type === "csv"; }).length;
      h = head("Ready to download?") + '<div class="cx-db">' + it(true, p.requests.length - t.c.out.length + " of " + plural(p.requests.length, "request") + " in the script", 'data-go="req"') + (ms.length ? it(false, plural(ms.length, "value") + (ms.length === 1 ? " has" : " have") + " nothing that gives " + (ms.length === 1 ? "it" : "them") + " a value: " + ms.slice(0, 6).map(function (v) { return "<code>" + esc(v.name) + "</code>"; }).join(", ") + (ms.length > 6 ? " …" : ""), 'data-go="val"') : it(true, "Every value has a source", 'data-go="val"')) + (nd.length ? it(false, "A left-out request sets a value that others send: <code>" + esc(nd[0].name) + "</code>", 'data-go="req"') : "") + it(true, plural(p.variables.filter(function (v) { return v.source === "set"; }).length, "value") + " read while the script runs", 'data-go="val"') + csv.map(function (m) { return it(false, esc(m.message || m.basename + " was not added"), 'data-dlg="files"'); }).join("") + (found ? it(true, plural(found, "CSV file") + " added — in the ZIP") : "") + ((t.data.dependency || {}).warnings || []).map(function (w) { return it(false, esc(w)); }).join("") + (kind === "jmx" ? it(true, t.c.wlm ? "Workload workbook included" : "Workload workbook left out") : it(true, t.files.env ? "Environment: " + esc(t.files.env.name) : "No environment file")) + it(true, plural(p.files.length, "file") + " in the ZIP") + '</div><div class="cx-df"><span class="cx-muted cx-grow">Nothing here stops you</span><button type="button" class="ds-btn ds-btn-primary" data-act="dl">' + i("down") + "Download ZIP</button></div>";
    }
    if (k === "how") h = head("How it works") + '<div class="cx-db"><ol class="cx-steps">' + [["Upload", kind === "pm" ? "Drop your Postman or Bruno file. Add an environment file for variable values." : "Drop your JMeter test plan, with the CSV data files it uses."], ["Analyse", "Detects correlations, JWT, auth, proxy, headers and classifies all variables into 3 tiers."], ["Generate", "Creates a complete LR script with all config files — per-request transactions included."], ["Download", "Get a .zip. Open the .usr in VuGen or upload directly to LoadRunner Enterprise."]].map(function (x, n) { return "<li><em>" + (n + 1) + "</em><div><b>" + x[0] + "</b><span>" + x[1] + "</span></div></li>"; }).join("") + "</ol>" + (kind === "jmx" ? '<h3>What gets generated</h3><ul class="cx-steps">' + ["DevWeb JS or VuGen C script per thread group", "Regex / JSON / Boundary / XPath / CSS extractors", "Global + per-request headers correctly scoped", "Loop / If / ForEach controller context preserved", "CSV parameter files + dependency report", "Workload Model Excel (.xlsx)"].map(function (x) { return "<li>" + i("ok") + "<span>" + x + "</span></li>"; }).join("") + "</ul>" : "") + '<div class="cx-chips">' + (kind === "pm" ? ["Postman v2.1 JSON", "Bruno JSON / YAML / .bru"] : ["JMeter .jmx"]).concat(["DevWeb JS output", "VuGen C output"]).map(function (x) { return '<span class="cx-tag">' + x + "</span>"; }).join("") + '</div></div><div class="cx-df"><button type="button" class="ds-btn" data-act="help">Open the Help</button><button type="button" class="ds-btn ds-btn-primary" data-close>Close</button></div>';
    d.innerHTML = h; d.setAttribute("aria-label", d.querySelector("h2").textContent); if (!d.open) { d.style.cssText = ""; d.showModal(); }
  }
  function toast(msg, un) {
    document.querySelectorAll(".cx-toast").forEach(function (x) { x.remove(); });
    var e = document.createElement("div"); e.className = "cx-toast ds-brand"; e.setAttribute("role", "status"); e.innerHTML = "<span>" + msg + "</span>" + (un ? '<button type="button">Undo</button>' : "");
    if (un) e.querySelector("button").onclick = function () { e.remove(); un(); };
    ($("cx-dlg") && $("cx-dlg").open ? $("cx-dlg") : document.body).appendChild(e); setTimeout(function () { e.remove(); }, 6000);
  }

  // ── what a click does ──
  function act(k, kind) {
    var t = T[kind];
    if (k === "convert") { convert(kind, false).then(function (ok) { if (ok) { var b = document.querySelector("#" + PANEL[kind] + " .cx-name"); if (b) b.focus({ preventScroll: true }); } }); return; }
    if (k === "retry") return convert(kind, true);
    if (k === "noerr") t.err = ""; else if (k === "undo") return undo(kind); else if (k === "redo") return redo(kind);
    else if (k === "dl") { if ($("cx-dlg").open) $("cx-dlg").close(); return download(kind); } else if (k === "plan") return plan(kind);
    else if (k === "name") { t.naming = true; draw(kind); var n = $("cx-name"); if (n) { n.focus(); n.select(); } return; } else if (k === "noname") { t.naming = false; draw(kind); var b = document.querySelector("#" + PANEL[kind] + " .cx-name"); if (b) b.focus(); return; }
    else if (k === "putback") return change(kind, function (c) { c.out = []; }, { toast: "Every request is in the script again." });
    else if (k === "putneeded") { var nd = need(kind)[0]; return nd && change(kind, function (c) { c.out = c.out.filter(function (x) { return nd.by.indexOf(x) < 0; }); }); }
    else if (k === "leave") return change(kind, function (c) { var x = c.out.indexOf(t.sel); if (x >= 0) c.out.splice(x, 1); else if (c.out.length + 1 < P(kind).requests.length) c.out.push(t.sel); else toast("Keep at least one request."); });
    else if (k === "foldall") { var gs = groupRequests(visible(kind)), all = gs.every(function (g) { return t.fold[g.name]; }); gs.forEach(function (g) { t.fold[g.name] = !all; }); }
    else if (k === "nohost") t.host = ""; else if (k === "nouse") t.use = ""; else if (k === "noren") { t.ren = t.renErr = ""; } else if (k === "noedit") t.edit = "";
    else if (k === "another") { $("cx-dlg").close(); var old = T[kind]; if (old.abort) old.abort.abort(); clearTimeout(old.timer); if (old.status === "up") old.status = "ok"; clear(kind, true); toast("Choose the next file.", function () { T[kind] = old; draw(kind); }); return; }
    else if (k === "help") { $("cx-dlg").close(); var h = $("tb-help"); if (h) h.click(); return; }
    else if (k === "copy") { var f = curFile(kind); if (f && f.text != null && navigator.clipboard) navigator.clipboard.writeText(f.text).then(function () { var s = document.querySelector("#" + PANEL[kind] + " [data-act=copy] span"); if (s) { s.textContent = "Copied"; setTimeout(function () { s.textContent = "Copy"; }, 1500); } }); return; }
    draw(kind);
  }
  function setChoice(kind, k, v) {
    change(kind, function (c) { if (k.indexOf("adv.") === 0) c.adv[k.slice(4)] = !!v; else c[k] = k === "tt" ? Number(v) : k === "wlm" ? v === true || v === "true" : v; if (k === "fmt" || k === "mode") T[kind].file = ""; });
  }
  function onClick(e) {
    var d = $("cx-dlg");
    if (e.target === d) { var r0 = d.getBoundingClientRect(); if (e.clientX < r0.left || e.clientX > r0.right || e.clientY < r0.top || e.clientY > r0.bottom) d.close(); return; }
    var b = e.target.closest("button"); if (!b || b.disabled) return;
    var inDlg = d.contains(b), kind = inDlg ? dlgFor : b.closest("#panel-jmx") ? "jmx" : "pm", t = T[kind], g = function (k) { return b.getAttribute(k); }, has = function (k) { return b.hasAttribute(k); };
    if (has("data-close")) return d.close();
    if (has("data-dlg")) return dialog(g("data-dlg"), kind);
    if (has("data-set")) { setChoice(kind, g("data-set"), g("data-v")); if (inDlg) { dialog(dlgKind, kind); var s = d.querySelector('[data-set="' + g("data-set") + '"][data-v="' + g("data-v") + '"]'); if (s) s.focus(); } return; }
    if (has("data-act")) return act(g("data-act"), kind);
    if (has("data-pick")) { var fi = $(g("data-pick")); if (fi) fi.click(); return; }
    if (has("data-rm")) return removeFile(kind, g("data-rm"), Number(g("data-n")));
    if (has("data-go")) { d.close(); t.tab = g("data-go"); ui.hide.l = false; return draw(kind); }
    if (has("data-tab")) { t.tab = g("data-tab"); return draw(kind); }
    if (has("data-rtab")) { t.rtab = g("data-rtab"); if (t.rtab === "code" && t.sel) t.file = ""; draw(kind); if (t.rtab === "code") showSel(kind); return; }
    if (has("data-fold-dom")) { ui.domFold = !ui.domFold; save(UKEY, ui); return draw(kind); }
    if (has("data-fold")) { t.fold[g("data-fold")] = !t.fold[g("data-fold")]; return draw(kind); }
    if (has("data-vfold")) { var vk = g("data-vfold"); if (ui.vfold[vk]) delete ui.vfold[vk]; else ui.vfold[vk] = 1; save(UKEY, ui); return draw(kind); }
    if (has("data-all")) { t.all[g("data-all")] = true; return draw(kind); }
    if (has("data-hide") || has("data-show")) { var hk = g("data-hide") || g("data-show"); ui.hide[hk] = has("data-hide"); if (ui.hide.l && ui.hide.r) ui.hide[hk === "l" ? "r" : "l"] = false; save(UKEY, ui); draw("pm"); draw("jmx"); var nb = document.querySelector("#" + PANEL[kind] + " [data-" + (has("data-hide") ? "show" : "hide") + '="' + hk + '"]'); if (nb) nb.focus(); return; }
    if (has("data-file")) { t.file = g("data-file"); t.hit = 0; draw(kind); var c1 = $("cx-code-" + kind); if (c1) c1.scrollTop = c1.scrollLeft = 0; return; }
    if (has("data-req")) { var n = Number(g("data-req")); t.sel = t.sel === n ? 0 : n; t.file = ""; ui.hide.r = false; draw(kind); if (t.sel) showSel(kind); return; }
    if (has("data-host")) { t.host = t.host === g("data-host") ? "" : g("data-host"); t.tab = "req"; return draw(kind); }
    if (has("data-ren")) { var same = t.ren === g("data-ren") && t.renName === g("data-rn"); t.ren = same ? "" : g("data-ren"); t.renName = same ? "" : g("data-rn"); t.renErr = ""; draw(kind); var ri = document.querySelector("#" + PANEL[kind] + " .cx-ren input"); if (ri) { ri.focus(); ri.select(); ri.closest("form").scrollIntoView({ block: "nearest" }); } return; }
    if (has("data-goval")) { t.tab = "val"; t.vq = ""; delete ui.vfold.missing; draw(kind); var gi = document.querySelector("#" + PANEL[kind] + ' form[data-k="' + CSS.escape(g("data-goval")) + '"] input'); if (gi) gi.focus(); return; }
    if (has("data-use")) { t.use = t.use === g("data-use") ? "" : g("data-use"); t.tab = "req"; t.q = t.host = ""; return draw(kind); }
    if (has("data-edit")) { t.edit = g("data-edit"); draw(kind); var ei = document.querySelector("#" + PANEL[kind] + ' form[data-k="' + CSS.escape(t.edit) + '"] input'); if (ei) { ei.focus(); ei.select(); } return; }
    if (has("data-ungive")) { var uk = g("data-ungive"); return change(kind, function (c) { delete c.values[uk]; }, { toast: "The file’s value is used again." }); }
  }
  function onSubmit(e) {
    var f = e.target, w = f.getAttribute("data-form"); if (!w) return; e.preventDefault();
    var kind = f.closest("#panel-jmx") ? "jmx" : "pm", t = T[kind];
    if (w === "name") { var n = cleanName(f.querySelector("input").value); t.naming = false; if (n && n !== nameNow(kind)) change(kind, function (c) { c.name = n === t.origName ? "" : n; }, { wait: 0 }); else draw(kind); var b = document.querySelector("#" + PANEL[kind] + " .cx-name"); if (b) b.focus(); }
    if (w === "give") { var k = f.getAttribute("data-k"), v = f.querySelector("input").value; if (v === "" ) return; t.edit = ""; change(kind, function (c) { c.values[k] = v; }, { wait: 0, toast: "The script uses it now." }); }
    if (w === "ren") rename(kind, f);
  }
  function rename(kind, f) {
    var t = T[kind], p = P(kind), host = f.getAttribute("data-host"), h = p.hosts.filter(function (x) { return x.host === host; })[0]; if (!h) return;
    var l = domainNames(h, p.variables).filter(function (n) { return n.can && n.name === t.renName; }), taken = {}, err = "", todo = [];
    p.hosts.forEach(function (x) { if (x.param && x !== h) taken[x.host] = x.param; });
    l.forEach(function (n, k) {
      var name = f.elements["n" + k].value.trim(), others = p.variables.map(function (v) { return v.name; }).filter(function (x) { return x !== n.name; });
      if (name !== n.name) {
        err = err || (window.HostParams && window.HostParams.validName ? window.HostParams.validName(name, host, taken, others) : /^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name) ? "" : "Use letters, numbers and underscores only, starting with a letter or an underscore.");
        todo.push(function (c) { if (n.type === "param") { if (name === t.defNames[n.key]) delete c.names[n.key]; else c.names[n.key] = name; } else if (name === n.key) delete c.varNames[n.key]; else c.varNames[n.key] = name; });
      }
      var box = f.elements["v" + k], now = t.c.values[n.key] != null ? t.c.values[n.key] : n.value || "";
      if (box && box.value.trim() !== now && box.value.trim() !== "") { var v = box.value.trim(); todo.push(function (c) { c.values[n.key] = v; }); }
    });
    if (err) { t.renErr = err; var vals = Array.prototype.map.call(f.querySelectorAll("input"), function (x) { return x.value; }); draw(kind); document.querySelectorAll("#" + PANEL[kind] + " .cx-ren input").forEach(function (x, k) { x.value = vals[k]; if (!k) x.focus(); }); return; }
    t.ren = t.renErr = "";
    if (todo.length) change(kind, function (c) { todo.forEach(function (x) { x(c); }); }, { wait: 0, toast: "The script uses it now." }); else draw(kind);
  }
  function onChange(e) {
    var x = e.target;
    if (x.type === "file") { var s = null, kd = ""; ["pm", "jmx"].forEach(function (k) { slots(k).forEach(function (y) { if (y[1] === x.id) { s = y[0]; kd = k; } }); }); if (s) { addFiles(kd, s, x.files); if (s === "cert" || s === "csv") x.value = ""; } return; }
    var kind = $("cx-dlg").contains(x) ? dlgFor : x.closest("#panel-jmx") ? "jmx" : "pm", t = T[kind];
    if (x.hasAttribute("data-tick")) {
      var ns = x.getAttribute("data-tick").split(",").map(Number), out = t.c.out.filter(function (n) { return ns.indexOf(n) < 0; }).concat(x.checked ? [] : ns);
      if (out.length >= P(kind).requests.length) { toast("Keep at least one request."); return draw(kind); }
      change(kind, function (c) { c.out = out; }, { wait: 400 });
    } else if (x.hasAttribute("data-adv")) setChoice(kind, "adv." + x.getAttribute("data-adv"), x.checked);
    else if (x.getAttribute("data-in") === "file") { t.file = x.value; t.hit = 0; draw(kind); var c1 = $("cx-code-" + kind); if (c1) c1.scrollTop = c1.scrollLeft = 0; }
  }
  function onInput(e) {
    var x = e.target, k = x.getAttribute("data-in"); if (!k) return;
    var kind = x.closest("#panel-jmx") ? "jmx" : "pm", t = T[kind];
    if (k === "q") { t.q = x.value; part(kind, "#cx-rl-" + kind, reqList(kind)); } else if (k === "vq") { t.vq = x.value; part(kind, "#cx-vl-" + kind, valList(kind)); }
    else if (k === "cq") { t.cq = x.value; t.hit = 0; clearTimeout(t.cqt); t.cqt = setTimeout(function () { drawCode(kind); hits(kind, true); }, ((curFile(kind) || {}).text || "").length > 60000 ? 200 : 0); }
  }
  function onKey(e) {
    var x = e.target, kind = cur(), t = T[kind], panel = $(PANEL[kind]);
    if (!panel || panel.offsetParent === null) return;
    if (x.closest && x.closest("#cx-dlg")) return;
    if (e.key === "Escape") { var f = x.closest && x.closest("form[data-form]"); if (f) { var w = f.getAttribute("data-form"); if (w === "name") act("noname", kind); else if (w === "ren") { var ho = t.ren; act("noren", kind); var rb = panel.querySelector('[data-ren="' + CSS.escape(ho) + '"]'); if (rb) rb.focus(); } else if (w === "give" && t.edit) act("noedit", kind); e.preventDefault(); return; } }
    if (x.getAttribute && x.getAttribute("data-in") === "cq" && e.key === "Enter") { e.preventDefault(); t.hit += e.shiftKey ? -1 : 1; hits(kind, true); return; }
    if (x.getAttribute && x.getAttribute("role") === "tab" && /^Arrow(Left|Right)$/.test(e.key)) { var l = Array.prototype.slice.call(x.parentNode.querySelectorAll('[role="tab"]')), n = l[(l.indexOf(x) + (e.key === "ArrowRight" ? 1 : -1) + l.length) % l.length]; e.preventDefault(); n.click(); return; }
    if (x.classList && x.classList.contains("cx-rs") && /^Arrow(Left|Right)$/.test(e.key)) { resize(kind, rw(kind) + (e.key === "ArrowLeft" ? 24 : -24) * (e.shiftKey ? 4 : 1)); save(UKEY, ui); e.preventDefault(); return; }
    if (x.hasAttribute && x.hasAttribute("data-req") && /^Arrow(Up|Down)$/.test(e.key)) { var rows = Array.prototype.slice.call(panel.querySelectorAll("[data-req]")), nx = rows[rows.indexOf(x) + (e.key === "ArrowDown" ? 1 : -1)]; e.preventDefault(); if (nx) { var id = nx.getAttribute("data-req"); nx.click(); var f2 = panel.querySelector('[data-req="' + id + '"]'); if (f2) f2.focus({ preventScroll: true }); } return; }
    if ((e.ctrlKey || e.metaKey) && !e.altKey && /^[zy]$/i.test(e.key) && t.data && !/^(INPUT|TEXTAREA|SELECT)$/.test(x.tagName || "")) { e.preventDefault(); if (e.key.toLowerCase() === "y" || e.shiftKey) redo(kind); else undo(kind); }
  }
  var rw = function (kind) { var p = document.querySelector("#" + PANEL[kind] + " .cx-right"); return p ? p.getBoundingClientRect().width : 0; };
  function resize(kind, w) { var g = document.querySelector("#" + PANEL[kind] + " [data-grid]"); if (!g || ui.hide.l || ui.hide.r) return; var d = g.querySelector(".cx-dom"), dw = d && getComputedStyle(g).gridTemplateRows.split(" ").length < 2 ? d.getBoundingClientRect().width : 0; ui.w = Math.round(Math.max(320, Math.min(g.clientWidth - dw - 400, w))); g.style.setProperty("--cx-r", ui.w + "px"); }
  function onDown(e) {
    var r = e.target.closest(".cx-rs"), h = e.target.closest(".cx-dh");
    if (r && !r.classList.contains("off")) {
      var kind = r.closest("#panel-jmx") ? "jmx" : "pm", x0 = e.clientX, w0 = rw(kind); e.preventDefault(); r.setPointerCapture(e.pointerId);
      var mv = function (ev) { resize(kind, w0 - (ev.clientX - x0)); }, up = function () { r.removeEventListener("pointermove", mv); r.removeEventListener("pointerup", up); r.removeEventListener("pointercancel", up); save(UKEY, ui); };
      r.addEventListener("pointermove", mv); r.addEventListener("pointerup", up); r.addEventListener("pointercancel", up);
    } else if (h && !e.target.closest("button")) {
      var d = $("cx-dlg"), b = d.getBoundingClientRect(), ox = e.clientX - b.left, oy = e.clientY - b.top, m2 = function (ev) { d.style.margin = "0"; d.style.left = Math.max(0, Math.min(innerWidth - b.width, ev.clientX - ox)) + "px"; d.style.top = Math.max(0, Math.min(innerHeight - 60, ev.clientY - oy)) + "px"; }, u2 = function () { document.removeEventListener("pointermove", m2); document.removeEventListener("pointerup", u2); };
      document.addEventListener("pointermove", m2); document.addEventListener("pointerup", u2);
    }
  }
  function boot() {
    var root = $("portal-converter"); if (!root || !$("cx-dlg")) return;
    root.addEventListener("click", onClick); root.addEventListener("submit", onSubmit); root.addEventListener("change", onChange); root.addEventListener("input", onInput); root.addEventListener("pointerdown", onDown); document.addEventListener("keydown", onKey);
    root.addEventListener("dblclick", function (e) { if (e.target.closest(".cx-rs")) { delete ui.w; save(UKEY, ui); draw("pm"); draw("jmx"); } if (e.target.closest(".cx-dh") && !e.target.closest("button")) $("cx-dlg").style.cssText = ""; });
    $("cx-dlg").addEventListener("close", function () { $("cx-dlg").style.cssText = ""; dlgKind = ""; });
    // files dropped anywhere on the page go to their box
    if (window.PerfxDrop) window.PerfxDrop.attach({
      when: function () { return root.offsetParent !== null || getComputedStyle(root).display !== "none"; },
      label: function () { return cur() === "jmx" ? ["Drop to load", ".jmx test plan · .csv data files · certificates"] : ["Drop to load", "Collection (.json .yml .yaml .bru) · environment · certificates"]; },
      route: function (files) { var k = cur(); return sortFiles(files, k, !!T[k].files.main).map(function (x) { var s = slots(k).filter(function (y) { return y[0] === x.slot; })[0]; return { input: $(s[1]), files: x.files }; }); },
    });
    draw("pm"); draw("jmx");
  }
  Object.assign(api, { state: function (k) { return T[k]; }, set: setChoice, convert: convert, clear: clear, zip: zip, draw: draw, current: cur });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
  return api;
});
