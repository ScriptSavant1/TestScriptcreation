/**
 * script-reader.js — "Fill from scripts" (UMD, browser + Node).
 * Reads any number of files at once and returns one entry per script found:
 *   - a script ZIP: Web HTTP/HTML (VuGen: *.usr + *.c) or DevWeb (main.js); one ZIP may hold several scripts
 *   - a HAR recording (also gives recorded response times)
 *
 *   const { scripts, skipped } = await ScriptReader.readFiles(fileList);
 *   scripts[i] = { name, file, protocol, txPerIter, txNames, initTx, endTx, nestedTx, thinkPerIter, requestsPerIter, pages, pageShare, thinkMode, thinkFactor, rtAvg, notes }
 *
 * pages / pageShare: the requests that load a page like a browser (a page with its images, styles and scripts) against
 * API calls — for the load generators' Vusers-per-machine rule. Web HTTP/HTML and DevWeb both can hold either.
 *
 * Counts are per ITERATION: vuser_init / vuser_end (VuGen) and load.initialize / load.finalize (DevWeb) run once
 * per Vuser and are left out. Loops are not unrolled — the notes say so and the user corrects the card.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("../../lre-results-analyser/web/zip.js"));
  else root.ScriptReader = factory(root.LreRA && root.LreRA.zip);
})(typeof self !== "undefined" ? self : this, function (zip) {
  "use strict";

  // Comments out, strings kept: "https://…" inside quotes is not a // comment.
  function stripC(s) {
    let out = "", i = 0, q = null;
    while (i < s.length) {
      const c = s[i], d = s[i + 1];
      if (q) { out += c; if (c === "\\") { out += d || ""; i += 2; continue; } if (c === q || (c === "\n" && q !== "`")) q = null; i++; }
      else if (c === "/" && d === "*") { const e = s.indexOf("*/", i + 2); out += " "; i = e < 0 ? s.length : e + 2; }
      else if (c === "/" && d === "/") { const e = s.indexOf("\n", i); out += " "; i = e < 0 ? s.length : e; }
      else { if (c === '"' || c === "'" || c === "`") q = c; out += c; i++; }
    }
    return out;
  }
  const sumNums = (re, s) => { let t = 0, m; re.lastIndex = 0; while ((m = re.exec(s))) t += parseFloat(m[1]) || 0; return t; };
  const count = (re, s) => (s.match(re) || []).length;
  const names = (re, s) => { const out = []; let m; re.lastIndex = 0; while ((m = re.exec(s))) out.push(m[1]); return out; };
  const uniq = (a) => [...new Set(a)];
  const r1 = (x) => Math.round(x * 10) / 10;
  const short = (list) => (list.length > 4 ? `${list.slice(0, 3).join(", ")} and ${list.length - 3} more` : list.join(", "));
  // Transactions that contain other transactions: walk the starts and ends in the order they are written; a start while
  // another transaction is open makes the open one a container. events = [{ at, start: true|false, name }]
  function containers(events) {
    const open = [], outer = new Set();
    events.sort((a, b) => a.at - b.at).forEach((e) => {
      if (e.start) { open.forEach((n) => outer.add(n)); open.push(e.name); }
      else { const i = open.lastIndexOf(e.name); if (i >= 0) open.splice(i, 1); }
    });
    return [...outer];
  }
  const events = (re, s, start) => { const out = []; let m; re.lastIndex = 0; while ((m = re.exec(s))) out.push({ at: m.index, start, name: m[1] }); return out; };

  /* ---------- Web HTTP/HTML (VuGen C) ---------- */
  const VUGEN_REQ = /\bweb_(?:url|custom_request|submit_data|submit_form|link|image|rest)\s*\(/g;
  // one request, as written: from its call to the next request call (or the end)
  function requestCalls(re, s) {
    const at = []; let m; re.lastIndex = 0;
    while ((m = re.exec(s))) at.push({ i: m.index, fn: m[0] });
    return at.map((x, k) => ({ fn: x.fn, text: s.slice(x.i, k + 1 < at.length ? at[k + 1].i : s.length) }));
  }
  // a page: web_submit_data / _form, web_link, web_image; web_url unless Mode=HTTP without page resources (EXTRARES);
  // web_custom_request only with Mode=HTML or EXTRARES. API: web_rest, the rest of web_custom_request / web_url.
  function vugenIsPage(c) {
    if (/web_(?:submit_data|submit_form|link|image)/.test(c.fn)) return true;
    if (/web_rest/.test(c.fn)) return false;
    if (/\bEXTRARES\b/.test(c.text) || /"Mode=HTML"/i.test(c.text)) return true;
    return /web_url/.test(c.fn) && !/"Mode=HTTP"/i.test(c.text);
  }
  // DevWeb: a request with a resources list (the page's images, styles, scripts) or asking for HTML is a page
  const devwebIsPage = (c) => /\bresources\s*:/.test(c.text) || /["']?accept["']?\s*:\s*["'`][^"'`]*text\/html/i.test(c.text);
  const share = (pages, n) => (n ? Math.round(pages / n * 1000) / 1000 : null);
  function readVugen(name, files) {
    const action = [], init = [], end = [];
    Object.keys(files).filter((f) => /\.c$/i.test(f)).forEach((f) => {
      (/(^|\/)vuser_init\.c$/i.test(f) ? init : /(^|\/)vuser_end\.c$/i.test(f) ? end : action).push(stripC(files[f]));
    });
    const a = action.join("\n"), i = init.join("\n");
    const START = /\blr_start_transaction\s*\(\s*"([^"]*)"/g, END = /\blr_end_transaction\s*\(\s*"([^"]*)"/g;
    const tx = names(START, a);
    const s = { name, protocol: "web", txPerIter: tx.length, txNames: uniq(tx),
      initTx: uniq(names(START, i)), endTx: uniq(names(START, end.join("\n"))),
      nestedTx: action.length ? uniq([].concat(...action.map((c) => containers(events(START, c, true).concat(events(END, c, false)))))) : [],
      thinkPerIter: r1(sumNums(/\blr_think_time\s*\(\s*([\d.]+)\s*\)/g, a)),
      requestsPerIter: count(VUGEN_REQ, a), notes: [] };
    s.pages = requestCalls(VUGEN_REQ, a).filter(vugenIsPage).length; s.pageShare = share(s.pages, s.requestsPerIter);
    const cfg = Object.keys(files).find((f) => /(^|\/)default\.cfg$/i.test(f));
    if (cfg) {
      const opt = (files[cfg].match(/^\s*Options\s*=\s*(\w+)/mi) || [])[1] || "";
      const factor = parseFloat((files[cfg].match(/^\s*Factor\s*=\s*([\d.]+)/mi) || [])[1]);
      if (/^NOTHINK$/i.test(opt)) s.thinkMode = "ignore";
      else if (/MULTIPLY/i.test(opt)) { s.thinkMode = "multiply"; s.thinkFactor = factor || 1; }
      else if (/RANDOM/i.test(opt)) s.thinkMode = "random";
      else if (/RECORD/i.test(opt)) s.thinkMode = "recorded";
      const pace = (files[cfg].match(/^\s*IterationPace\s*=\s*(\w+)/mi) || [])[1];
      if (pace) s.scriptPacing = pace;
    }
    return finish(s, "Action");
  }

  /* ---------- DevWeb (JavaScript) ---------- */
  function actionPart(js) {
    // keep only load.action(...) blocks; load.initialize / load.finalize run once per Vuser
    const marks = []; const re = /\bload\.(initialize|action|finalize)\s*\(/g; let m;
    while ((m = re.exec(js))) marks.push({ kind: m[1], at: m.index });
    if (!marks.length) return { action: js, init: "", end: "" };
    let action = "", init = "", end = "";
    marks.forEach((k, n) => { const part = js.slice(k.at, n + 1 < marks.length ? marks[n + 1].at : js.length); if (k.kind === "action") action += part; else if (k.kind === "finalize") end += part; else init += part; });
    return { action, init, end };
  }
  function readDevweb(name, files) {
    const mainKey = Object.keys(files).find((f) => /(^|\/)main\.js$/i.test(f));
    const js = stripC(files[mainKey]);
    const { action, init, end } = actionPart(js);
    // transactions are usually declared at the top (const T1 = new load.Transaction("x")) and started in an action:
    // count the starts — T1.start() and new load.Transaction("x").start() — per part
    const vars = new Map(); let m;
    const decl = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*new\s+load\.Transaction\s*\(\s*["'`]([^"'`]+)["'`]/g;
    while ((m = decl.exec(js))) vars.set(m[1], m[2]);
    const starts = (part) => {
      const out = []; let k;
      const re = /([A-Za-z_$][\w$]*)\s*\.\s*start\s*\(|new\s+load\.Transaction\s*\(\s*["'`]([^"'`]+)["'`]\s*\)\s*\.\s*start\s*\(/g;
      while ((k = re.exec(part))) { if (k[2]) out.push(k[2]); else if (vars.has(k[1])) out.push(vars.get(k[1])); }
      return out;
    };
    const tx = starts(action);
    const calls = (part, verb) => { const out = []; let k; const re = new RegExp("([A-Za-z_$][\\w$]*)\\s*\\.\\s*" + verb + "\\s*\\(", "g");
      while ((k = re.exec(part))) if (vars.has(k[1])) out.push({ at: k.index, start: verb === "start", name: vars.get(k[1]) }); return out; };
    const s = { name, protocol: "devweb", txPerIter: tx.length, txNames: uniq(tx), initTx: uniq(starts(init)), endTx: uniq(starts(end)),
      nestedTx: containers(calls(action, "start").concat(calls(action, "stop"))),   // the SDK ends a transaction with stop()
      thinkPerIter: r1(sumNums(/\bload\.(?:thinkTime|sleep)\s*\(\s*([\d.]+)/g, action)),
      requestsPerIter: count(/new\s+load\.WebRequest\s*\(/g, action), notes: [] };
    s.pages = requestCalls(/new\s+load\.WebRequest\s*\(/g, action).filter(devwebIsPage).length; s.pageShare = share(s.pages, s.requestsPerIter);
    const rts = Object.keys(files).find((f) => /(^|\/)rts\.yml$/i.test(f));
    if (rts) {
      const type = (files[rts].match(/thinkTime:\s*(?:#[^\n]*)?\n\s*type:\s*"?(\w+)/) || [])[1] || "";
      s.thinkMode = ({ ignore: "ignore", asRecorded: "recorded", multiply: "multiply", randomPercentage: "random" })[type];
    }
    return finish(s, "load.action");
  }

  // " · 3 pages, 17 API calls" — what the Vusers-per-machine rule reads
  function kindText(s) {
    if (!s.requestsPerIter || s.pages == null) return "";
    const api = s.requestsPerIter - s.pages;
    return ` (${s.pages ? `${s.pages} page${s.pages === 1 ? "" : "s"}` : ""}${s.pages && api ? ", " : ""}${api ? `${api} API call${api === 1 ? "" : "s"}` : ""})`;
  }
  function finish(s, where) {
    // s.brief: one short line for the import list; s.warnings: only what the user must look at; s.notes: everything
    s.warnings = []; s.warnCodes = [];
    const warn = (code, text) => { s.warnCodes.push(code); s.warnings.push(text); };
    if (!s.txPerIter) warn("no-tx", `no transaction found in ${where} — each request counts as one; correct it if needed`);
    if (s.initTx && s.initTx.length) warn("init-tx", `${short(s.initTx)} run${s.initTx.length === 1 ? "s" : ""} once per Vuser at the start (${where === "Action" ? "vuser_init" : "load.initialize"}), not counted`);
    if (s.endTx && s.endTx.length) warn("end-tx", `${short(s.endTx)} run${s.endTx.length === 1 ? "s" : ""} once per Vuser at the end (${where === "Action" ? "vuser_end" : "load.finalize"}), not counted`);
    if (s.nestedTx && s.nestedTx.length) warn("nested-tx", `${short(s.nestedTx)} contain${s.nestedTx.length === 1 ? "s" : ""} other transactions — all are counted (as LRE counts them), so the iteration time is on the high side and the tool may choose a longer pacing than needed`);
    if (s.thinkMode === "ignore" && s.thinkPerIter) warn("think-ignored", `the script ignores its ${s.thinkPerIter} s think time at replay — change “Think time” on the card if LRE should use it`);
    if (!s.txPerIter) s.txPerIter = Math.max(1, s.requestsPerIter || 1);
    s.brief = `${s.txPerIter} transaction${s.txPerIter === 1 ? "" : "s"} · ${s.thinkPerIter} s think · ${s.requestsPerIter} requests${kindText(s)}`;
    s.notes = [s.brief + (s.txNames.length ? ` (${short(s.txNames)})` : "")].concat(s.warnings);
    if (s.scriptPacing) s.notes.push(`the script's own pacing (${s.scriptPacing}) is replaced by the plan's`);
    return s;
  }

  /* ---------- HAR ---------- */
  // Steps = the HAR's pages (Recorder transactions); without pages, a pause over 1.5 s starts a new step.
  function harIsPage(e) {
    const type = String(e._resourceType || "").toLowerCase();
    if (/^(document|stylesheet|script|image|font|media|manifest)$/.test(type)) return true;
    if (/^(xhr|fetch|websocket|eventsource|ping)$/.test(type)) return false;
    return !/json|xml|grpc|protobuf/i.test(mime(e)) && !/xmlhttprequest/i.test(header(e, "x-requested-with"));
  }
  const mime = (e) => (e.response && e.response.content && e.response.content.mimeType) || "";
  const header = (e, n) => ((e.request.headers || []).find((h) => String(h.name).toLowerCase() === n) || {}).value || "";
  function readHar(name, har) {
    const log = har && har.log;
    if (!log || !Array.isArray(log.entries)) throw new Error("not a HAR file");
    const es = log.entries.filter((e) => e.request && e.request.url && /^https?:/i.test(e.request.url))
      .map((e) => ({ start: Date.parse(e.startedDateTime), time: Math.max(0, e.time || 0), page: e.pageref || null, isPage: harIsPage(e) }))
      .filter((e) => Number.isFinite(e.start)).sort((a, b) => a.start - b.start);
    if (!es.length) throw new Error("no requests in the HAR");
    const steps = [];
    const titles = new Map((log.pages || []).map((p) => [p.id, p.title || p.id]));
    es.forEach((e) => {
      const last = steps[steps.length - 1];
      const same = titles.size ? last && last.page === e.page : last && e.start - last.end <= 1500;
      if (same) { last.end = Math.max(last.end, e.start + e.time); last.n++; }
      else steps.push({ page: e.page, start: e.start, end: e.start + e.time, n: 1 });
    });
    let think = 0, rt = 0;
    steps.forEach((s, i) => { rt += s.end - s.start; if (i) think += Math.max(0, s.start - steps[i - 1].end); });
    const s = { name, protocol: "web", txPerIter: steps.length, txNames: steps.map((x, i) => titles.get(x.page) || "Step " + (i + 1)).slice(0, 12),
      thinkPerIter: r1(think / 1000), requestsPerIter: es.length, rtAvg: Math.round(rt / steps.length) / 1000, notes: [] };
    s.pages = es.filter((e) => e.isPage).length; s.pageShare = share(s.pages, es.length);
    s.brief = `${steps.length} step${steps.length === 1 ? "" : "s"} · ${s.thinkPerIter} s pauses · ${es.length} requests${kindText(s)} · ${s.rtAvg} s response`;
    s.warnCodes = ["har"];
    s.warnings = [`steps ${titles.size ? "are the recording's transactions" : "split where the recording pauses over 1.5 s"}; the response time is one user's — a first estimate`];
    s.notes = [s.brief].concat(s.warnings);
    return s;
  }

  /* ---------- files ---------- */
  const base = (n) => n.replace(/\\/g, "/").split("/").filter(Boolean).pop() || n;
  const noExt = (n) => n.replace(/\.[^.]+$/, "");
  async function readZip(file) {
    const z = await zip.open(file);
    const dec = new TextDecoder("utf-8");
    const byName = new Map(z.entries.map((e) => [e.name.replace(/\\/g, "/"), e]));
    const list = [...byName.keys()].filter((n) => !/(^|\/)(__MACOSX|node_modules)\//.test(n) && !n.endsWith("/"));
    const has = new Set(list);
    // a script folder holds a .usr (VuGen and DevWeb) or main.js + rts.yml (DevWeb)
    const dirs = new Set();
    list.forEach((n) => {
      const dir = n.slice(0, n.lastIndexOf("/") + 1);
      if (/\.usr$/i.test(n) || (/(^|\/)main\.js$/i.test(n) && has.has(dir + "rts.yml"))) dirs.add(dir);
    });
    // a script zipped without its project file: a folder with Action.c (Web HTTP/HTML) or a main.js with load.action (DevWeb)
    for (const n of list) {
      const dir = n.slice(0, n.lastIndexOf("/") + 1);
      if (dirs.has(dir)) continue;
      if (/(^|\/)action\.c$/i.test(n)) dirs.add(dir);
      else if (/(^|\/)main\.js$/i.test(n)) {
        const en = byName.get(n);
        if (en && en.size < 20 * 1024 * 1024 && /\bload\.action\s*\(/.test(dec.decode(await z.read(en.name)))) dirs.add(dir);
      }
    }
    const out = [], inDir = new Map();
    list.forEach((n) => { const d = n.slice(0, n.lastIndexOf("/") + 1); if (!inDir.has(d)) inDir.set(d, []); inDir.get(d).push(n); });
    // script folders are read in parallel (8 at a time) — a ZIP with 100 scripts holds about 1,000 small files
    const one = async (dir) => {
      const own = inDir.get(dir) || [];
      const files = {};                                   // kept in ZIP order, whatever order the reads finish in
      const texts = await Promise.all(own.filter((n) => /\.(c|h|js|cfg|usp|yml|usr)$/i.test(n)).map(async (n) => {
        const en = byName.get(n);
        return [n, en && en.size < 20 * 1024 * 1024 ? dec.decode(await z.read(en.name)) : null];
      }));
      texts.forEach(([n, x]) => { if (x != null) files[n] = x; });
      const name = dir ? base(dir) : noExt(base(file.name));
      const isDev = own.some((n) => /(^|\/)main\.js$/i.test(n));
      const s = isDev ? readDevweb(name, files) : readVugen(name, files);
      s.file = base(file.name);
      return s;
    };
    const order = [...dirs];
    const res = new Array(order.length); let next = 0;
    await Promise.all(Array.from({ length: Math.min(8, order.length) }, async () => {
      while (next < order.length) { const k = next++; res[k] = await one(order[k]); }
    }));
    out.push(...res);
    return out;
  }
  async function readFiles(fileList) {
    const scripts = [], skipped = [];
    for (const f of [...fileList]) {
      try {
        if (/\.zip$/i.test(f.name)) {
          const found = await readZip(f);
          if (!found.length) skipped.push(`${f.name} — no LoadRunner script inside (a Web HTTP/HTML script has a .usr or Action.c file; a DevWeb script has main.js)`);
          scripts.push(...found);
        } else if (/\.(har|json)$/i.test(f.name)) {
          const s = readHar(noExt(base(f.name)), JSON.parse(await f.text()));
          s.file = base(f.name); scripts.push(s);
        } else skipped.push(`${f.name} — not a script ZIP or a HAR file`);
      } catch (e) { skipped.push(`${f.name} — could not be read (${e.message})`); }
    }
    return { scripts, skipped };
  }
  return { readFiles, readVugen, readDevweb, readHar, actionPart };
});
