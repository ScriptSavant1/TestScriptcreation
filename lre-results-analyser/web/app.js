/**
 * app.js — Results Analyser page: file picking, progress, dashboard tabs, settings and exports.
 * The analysis runs in worker.js; this file only renders the result model.
 */
/* global echarts */
(function () {
  "use strict";

  const L = window.LreRA;
  const fmt = L.format, C = L.charts;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => [...(el || document).querySelectorAll(s)];
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const n3 = (v) => fmt.num(v, 3);

  const state = {
    model: null, worker: null, dark: true, tab: "overview", txView: "steady", sort: null, filter: "",
    selected: new Set(), metric: "p90", detailTx: null, charts: new Map(), started: 0, lastSettings: {},
  };

  // ── theme (also driven by the portal when embedded) ─────────────────────────
  function setTheme(t) {
    state.dark = t !== "light";
    document.documentElement.setAttribute("data-theme", state.dark ? "dark" : "light");
    try { localStorage.setItem("lre-ra-theme", state.dark ? "dark" : "light"); } catch (_) { /* storage blocked */ }
    if (state.model) redrawCharts();
  }
  window.lrePortalInit = (theme) => { document.body.classList.add("embedded"); setTheme(theme); };
  window.lreSetTheme = setTheme;
  try { const t = localStorage.getItem("lre-ra-theme"); if (t) setTheme(t); } catch (_) { /* storage blocked */ }
  if (window.self !== window.top) document.body.classList.add("embedded");
  $("#btn-theme").onclick = () => setTheme(state.dark ? "light" : "dark");

  function toast(msg, err) {
    const t = $("#toast");
    t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
    clearTimeout(toast._h); toast._h = setTimeout(() => { t.hidden = true; }, err ? 9000 : 3500);
  }
  function show(view) { $$(".view").forEach((v) => v.classList.toggle("active", v.id === "view-" + view)); }

  // ── worker ──────────────────────────────────────────────────────────────────
  function worker() {
    if (state.worker) return state.worker;
    const w = new Worker("ra/worker.js");
    w.onmessage = (ev) => {
      const m = ev.data;
      if (m.type === "progress") progress(m);
      else if (m.type === "result") onResult(m.model);
      else if (m.type === "latency") onLatency(m);
      else if (m.type === "redacted") download(new Blob([JSON.stringify(m.model, null, 2)], { type: "application/json" }), fileBase() + "_redacted.json");
      else if (m.type === "error") onError(m.message);
    };
    w.onerror = (e) => onError(e.message || "The analysis stopped unexpectedly (out of memory?)");
    state.worker = w;
    return w;
  }
  function onError(msg) {
    setBusy(false);
    if (!state.model) { show("start"); const e = $("#start-error"); e.textContent = msg; e.hidden = false; }
    else toast(msg, true);
  }

  // ── picking files ───────────────────────────────────────────────────────────
  $("#in-folder").onchange = (e) => {
    const files = [...e.target.files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
    e.target.value = "";
    if (files.length) startFolder(files);
  };
  $("#in-zip").onchange = (e) => { const f = e.target.files[0]; e.target.value = ""; if (f) startZip(f); };
  const drop = $("#drop");
  ["dragenter", "dragover"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); drop.classList.add("over"); }));
  ["dragleave", "drop"].forEach((t) => document.addEventListener(t, (e) => { e.preventDefault(); if (t === "drop" || e.target === drop) drop.classList.remove("over"); }));
  document.addEventListener("drop", async (e) => {
    if (!$("#view-start").classList.contains("active")) return;
    const items = [...(e.dataTransfer.items || [])].map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null)).filter(Boolean);
    if (items.length === 1 && items[0].isFile && /\.zip$/i.test(items[0].name)) return items[0].file((f) => startZip(f));
    const files = [];
    for (const it of items) await walkEntry(it, "", files);
    if (files.length) startFolder(files);
    else if (e.dataTransfer.files[0] && /\.zip$/i.test(e.dataTransfer.files[0].name)) startZip(e.dataTransfer.files[0]);
  });
  function walkEntry(entry, prefix, out) {
    return new Promise((resolve) => {
      if (entry.isFile) entry.file((f) => { out.push({ path: prefix + entry.name, file: f }); resolve(); }, () => resolve());
      else if (entry.isDirectory) {
        const r = entry.createReader();
        const all = [];
        const next = () => r.readEntries(async (batch) => {
          if (!batch.length) { for (const c of all) await walkEntry(c, prefix + entry.name + "/", out); resolve(); }
          else { all.push(...batch); next(); }
        }, () => resolve());
        next();
      } else resolve();
    });
  }

  function startFolder(files) {
    if (!files.some((f) => /(^|\/)rawdata\.eve$/i.test(f.path))) {
      const zips = files.filter((f) => /\.zip$/i.test(f.path)).map((f) => f.path);
      return onError("RawData.eve was not found in the selected folder." + (zips.length ? `\nIt contains ZIP file(s): ${zips.slice(0, 3).join(", ")} — choose that ZIP instead.` : "\nChoose the run's raw-results folder (the one that holds RawData.eve, _t_rep.eve and res*.lrr)."));
    }
    begin({ kind: "folder", files }, files.reduce((a, f) => a + f.file.size, 0));
  }
  function startZip(file) { begin({ kind: "zip", file }, file.size); }

  function begin(source, bytes) {
    $("#start-error").hidden = true;
    state.model = null;
    disposeCharts();
    show("progress");
    state.started = Date.now();
    $("#prog-stage").textContent = "Opening " + (source.kind === "zip" ? source.file.name : "folder") + "…";
    $("#prog-meta").textContent = fmt.bytes(bytes) + " selected";
    $("#prog-fill").style.width = "0";
    $("#prog-fill").classList.add("indeterminate");
    worker().postMessage({ type: "analyse", source, settings: {} });
  }
  $("#btn-cancel").onclick = () => {
    if (state.worker) { state.worker.terminate(); state.worker = null; }
    show("start");
    toast("Analysis cancelled");
  };
  $("#btn-new").onclick = () => { disposeCharts(); state.model = null; show("start"); };

  function progress(m) {
    $("#prog-stage").textContent = m.stage || "Working…";
    const fill = $("#prog-fill");
    if (m.total) {
      fill.classList.remove("indeterminate");
      const pct = Math.min(100, (m.done / m.total) * 100);
      fill.style.width = pct.toFixed(1) + "%";
      const secs = (Date.now() - state.started) / 1000;
      const rate = m.done / Math.max(0.5, secs);
      const eta = rate ? (m.total - m.done) / rate : 0;
      $("#prog-meta").textContent = `${fmt.bytes(m.done)} of ${fmt.bytes(m.total)} · ${fmt.bytes(rate)}/s · about ${fmt.hms(eta)} left`;
    } else fill.classList.add("indeterminate");
  }

  // ── result ──────────────────────────────────────────────────────────────────
  function slaKey(m) { return "lre-ra-sla::" + (m.meta.sessionName || "run"); }
  function loadSla(m) { try { return JSON.parse(localStorage.getItem(slaKey(m)) || "null"); } catch (_) { return null; } }
  function saveSla(m, sla) { try { localStorage.setItem(slaKey(m), JSON.stringify(sla)); } catch (_) { /* storage blocked */ } }

  function onResult(model) {
    const first = !state.model;
    state.model = model;
    setBusy(false);
    if (first) {
      const named = model.transactions.some((t) => t.inMap) ? model.transactions.filter((t) => t.inMap) : model.transactions;
      state.selected = new Set(named.filter((t) => t.full.count).sort((a, b) => (b.steady.p.p90 || 0) - (a.steady.p.p90 || 0)).slice(0, 5).map((t) => t.id));
      state.detailTx = null;
      const saved = loadSla(model);
      if (saved && (saved.defaultSec != null || Object.keys(saved.perTx || {}).length)) { applySettings({ sla: saved }); toast("SLA thresholds restored from your last session for this test"); }
    }
    show("results");
    renderAll();
  }

  function applySettings(s) {
    state.lastSettings = Object.assign({}, state.lastSettings, s);
    setBusy(true);
    worker().postMessage({ type: "settings", settings: s });
  }
  function setBusy(b) { $$("#view-results .btn").forEach((x) => { if (!x.dataset.export) x.disabled = b; }); document.body.style.cursor = b ? "progress" : ""; }

  // ── settings bar ────────────────────────────────────────────────────────────
  function parseClock(s) {
    s = String(s || "").trim();
    if (!s) return null;
    if (/^\d+(\.\d+)?$/.test(s)) return Number(s);
    const p = s.split(":").map(Number);
    if (p.some((x) => !Number.isFinite(x))) return NaN;
    return p.reduce((a, x) => a * 60 + x, 0);
  }
  function syncSettingsBar() {
    const m = state.model;
    $("#win-start").value = m.window ? fmt.hms(m.window.start) : "";
    $("#win-end").value = m.window ? fmt.hms(m.window.end) : "";
    $("#win-local").textContent = m.window ? `${fmt.relLocal(m, m.window.start).slice(11)} – ${fmt.relLocal(m, m.window.end).slice(11)} local · ${m.window.detected ? "detected steady state" : "user-set"}` : "no steady state detected";
    const s = m.settings && m.settings.sla;
    $("#sla-pct").value = String((s && s.percentile) || 90);
    $("#sla-default").value = s && s.defaultSec != null ? s.defaultSec : "";
    const g = m.granularity;
    const sel = $("#gran");
    if (g) {
      const label = (sec) => (sec % 3600 === 0 ? `${sec / 3600} h` : sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`);
      sel.innerHTML = g.options.map((o) => `<option value="${o === g.baseSec ? "auto" : o}">${o === g.baseSec ? `Auto (${label(o)})` : label(o)}</option>`).join("");
      sel.value = g.auto ? "auto" : String(g.sec);
      $("#gran-hint").textContent = `${g.buckets.toLocaleString("en-GB")} points · charts & Time Series only · summary uses every instance`;
    }
  }
  $("#gran").onchange = () => { const v = $("#gran").value; applySettings({ granularitySec: v === "auto" ? null : Number(v) }); };
  $("#win-apply").onclick = () => {
    const a = parseClock($("#win-start").value), b = parseClock($("#win-end").value);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return toast("Enter a start and end as hh:mm:ss from the scenario start (end after start)", true);
    applySettings({ window: { start: a, end: b } });
  };
  $("#win-reset").onclick = () => applySettings({ window: null });
  $("#sla-apply").onclick = () => {
    const m = state.model;
    const d = $("#sla-default").value.trim();
    if (d && !(Number(d) > 0)) return toast("SLA must be a number of seconds", true);
    const sla = Object.assign({}, m.settings.sla, { percentile: Number($("#sla-pct").value), defaultSec: d ? Number(d) : null });
    saveSla(m, sla);
    applySettings({ sla });
  };

  // ── tabs ────────────────────────────────────────────────────────────────────
  $$("#tabs button").forEach((b) => { b.onclick = () => openTab(b.dataset.tab); });
  function openTab(tab) {
    state.tab = tab;
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.tab === tab));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === "tab-" + tab));
    renderTab(tab);
  }

  function renderAll() {
    const m = state.model;
    $("#run-name").textContent = m.meta.sessionName || "LRE run";
    $("#run-sub").textContent = `${fmt.localTime(m.meta.startUtc, m.meta.localOffsetSec)} – ${fmt.localTime(m.meta.stopUtc, m.meta.localOffsetSec)} (${fmt.zone(m.meta.localOffsetSec)}) · ${fmt.hms(m.meta.durationSec)} · ${m.meta.project || ""}`;
    const v = $("#verdict");
    v.textContent = m.insights.verdict.text; v.className = "verdict " + m.insights.verdict.status;
    const n = m.insights.findings.filter((f) => f.severity === "high").length;
    $("#ins-count").textContent = n ? String(n) : "";
    syncSettingsBar();
    disposeCharts();
    for (const p of $$(".panel")) p.dataset.rendered = "";
    renderTab(state.tab);
  }
  function renderTab(tab) {
    const panel = $("#tab-" + tab);
    if (panel.dataset.rendered === "1") { resizeCharts(panel); return; }
    panel.dataset.rendered = "1";
    ({ overview, transactions, charts: chartsTab, errors, workload, insights, validation })[tab](panel);
  }

  // ── charts helpers ──────────────────────────────────────────────────────────
  function mount(el, option, key) {
    if (!option) { el.innerHTML = `<div class="na">Not available for this run${key && NA[key] ? " — " + NA[key] : ""}.</div>`; el.style.height = "auto"; return null; }
    const ch = echarts.init(el, state.dark ? "dark" : null, { renderer: "canvas" });
    ch.setOption(option);
    // follow the card's size (grids re-flow as more cards are added, and on window/tab changes)
    if (window.ResizeObserver) { const ro = new ResizeObserver(() => { if (!ch.isDisposed()) ch.resize(); }); ro.observe(el); el._ro = ro; }
    state.charts.set(el, { chart: ch, key, build: el._build });
    return ch;
  }
  const NA = {
    errors: "needs SqliteDb.db with error rows", httpCodes: "needs sum_data (HTTP_RC graph)", bytes: "needs sum_data (mic_recv graph)",
    lgHealth: "needs sum_data (load-generator monitor)", rtPerLg: "needs 2+ load generators", latencyHeat: "select transactions",
  };
  /** Chart card whose option is rebuilt from the current model (so theme / settings changes redraw it). */
  function chartCard(parent, title, build, key, cls, sub) {
    const card = document.createElement("div");
    card.className = "card";
    card.dataset.chart = key || "";
    card.innerHTML = `<h3>${esc(title)}</h3>${sub ? `<div class="sub">${esc(sub)}</div>` : ""}<div class="chart ${cls || ""}"></div>`;
    parent.appendChild(card);
    const el = $(".chart", card);
    el._build = build;
    mount(el, build({ dark: state.dark, noTitle: true }), key);
    return card;
  }
  function redrawCharts() {
    for (const [el, c] of [...state.charts]) { // snapshot: mount() re-adds entries
      if (el._ro) el._ro.disconnect();
      c.chart.dispose();
      state.charts.delete(el);
      if (c.build) mount(el, c.build({ dark: state.dark, noTitle: true }), c.key);
    }
  }
  function disposeCharts() { for (const [el, c] of state.charts) { if (el._ro) el._ro.disconnect(); c.chart.dispose(); } state.charts.clear(); }
  function resizeCharts(scope) { for (const [el, c] of state.charts) if (!scope || scope.contains(el)) c.chart.resize(); }
  window.addEventListener("resize", () => { clearTimeout(resizeCharts._h); resizeCharts._h = setTimeout(() => resizeCharts(), 150); });

  function spark(values) {
    const v = values.map((x, i) => [i, x]).filter((p) => p[1] != null);
    if (v.length < 2) return "";
    const max = Math.max(...v.map((p) => p[1])), min = Math.min(...v.map((p) => p[1]));
    const w = 90, h = 22, n = values.length - 1 || 1;
    const pts = v.map(([i, y]) => `${((i / n) * w).toFixed(1)},${(h - 2 - ((y - min) / (max - min || 1)) * (h - 4)).toFixed(1)}`).join(" ");
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline fill="none" stroke="var(--primary)" stroke-width="1.3" points="${pts}"/></svg>`;
  }
  function downsample(arr, n) {
    if (arr.length <= n) return arr;
    const f = Math.ceil(arr.length / n), out = [];
    for (let i = 0; i < arr.length; i += f) { const s = arr.slice(i, i + f).filter((x) => x != null); out.push(s.length ? Math.max(...s) : null); }
    return out;
  }

  // ── Overview ────────────────────────────────────────────────────────────────
  function overview(p) {
    const m = state.model, t = m.totals, off = m.meta.localOffsetSec;
    const kpi = (l, v, s) => `<div class="kpi"><div class="v">${esc(v)}</div><div class="l">${esc(l)}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`;
    const issues = m.insights.findings.filter((f) => f.severity === "high" || f.severity === "medium");
    p.innerHTML = `
      ${m.method.percentileMethod === "exact" ? "" : `<div class="method-note warn"><b>Large run:</b> ${esc(m.method.summaryBasis)}. For exact percentiles use the command line with a higher <code>--exact-limit</code> on a machine with more memory.</div>`}
      <div class="kpis">
        ${kpi("Duration", fmt.hms(m.meta.durationSec), m.meta.stopReason ? "stopped: " + m.meta.stopReason : "")}
        ${kpi("Peak VUsers", fmt.int(t.peakVusers), m.lifecycle ? `${m.lifecycle.vusers} in total` : "")}
        ${kpi(m.window && !m.window.detected ? "Analysis window" : "Steady state", m.window ? fmt.hms(m.window.durationSec) : "-", m.window ? `t+${fmt.hms(m.window.start)} – t+${fmt.hms(m.window.end)}` : "")}
        ${kpi("Transactions", fmt.int(t.samples), `${m.transactions.length} names`)}
        ${kpi("TPS (window)", fmt.num(t.tpsSteady, 2), `full run ${fmt.num(t.tpsFull, 2)}`)}
        ${kpi("Failed", t.fail != null ? fmt.int(t.fail) : "n/a", t.fail != null && t.pass != null ? `${((t.fail / Math.max(1, t.pass + t.fail)) * 100).toFixed(2)} %` : "needs sum_data")}
        ${kpi("Errors", t.errors != null ? fmt.int(t.errors) : "n/a", t.errors == null ? "needs SqliteDb.db" : "")}
        ${kpi("Hits/s", t.hitsPerSec ? fmt.num(t.hitsPerSec.avg, 1) : "n/a", t.hitsPerSec ? "peak " + fmt.num(t.hitsPerSec.peak, 1) : "")}
      </div>
      <div class="grid-2">
        <div class="card"><h3>Test</h3><table class="t kv"><tbody>
          ${[["Scenario", m.meta.sessionName], ["Project", m.meta.project], ["Controller", [m.meta.product, m.meta.version].filter(Boolean).join(" ")],
            ["Start (local)", fmt.localTime(m.meta.startUtc, off) + " " + fmt.zone(off)], ["End (local)", fmt.localTime(m.meta.stopUtc, off)], ["Start (UTC)", fmt.utcTime(m.meta.startUtc)],
            ["Schedule", m.meta.scheduleText || m.meta.schedule.raw], ["Load behaviour", m.meta.loadBehavior], ["Scripts", m.workload.map((s) => `${s.key} (${s.vusers})`).join(", ")],
            ["Percentiles", m.method.percentile]].map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v == null ? "-" : v)}</td></tr>`).join("")}
        </tbody></table></div>
        <div class="card"><h3>Schedule — planned vs actual</h3><table class="t"><thead><tr><th>Phase</th><th>Planned</th><th>Actual</th></tr></thead><tbody>
          ${fmt.scheduleRows(m).map((r) => `<tr><td>${esc(r.phase)}</td><td>${esc(r.planned)}</td><td>${esc(r.actual)}</td></tr>`).join("")}
        </tbody></table>
        <h3 style="margin-top:14px">Load generators</h3><div class="table-wrap"><table class="t"><thead><tr><th>Host</th><th>IP</th><th class="num">VUsers</th><th class="num">CPU peak</th><th class="num">Mem peak</th></tr></thead><tbody>
          ${m.lgs.map((l) => `<tr title="${esc(l.role)}"><td>${esc(l.name)}${l.vusers ? "" : ` <span class="pill info">${l.role.startsWith("monitored") ? "no VUsers" : ""}</span>`}</td><td>${esc(l.ip || "-")}</td><td class="num">${l.vusers}</td><td class="num">${l.cpuPeak != null ? l.cpuPeak.toFixed(0) + " %" : "-"}</td><td class="num">${l.memPeak != null ? l.memPeak.toFixed(0) + " %" : "-"}</td></tr>`).join("")}
        </tbody></table></div></div>
      </div>
      <div class="card"><h3>Key findings</h3>
        ${issues.length ? issues.slice(0, 6).map(findingHtml).join("") : `<div class="na">No significant issues — see the Insights tab for every check.</div>`}
      </div>
      <div class="grid-2" id="ov-charts"></div>`;
    const g = $("#ov-charts", p);
    chartCard(g, "Load and throughput", (o) => C.load(state.model, o), "load");
    chartCard(g, "Response time per transaction (analysis window)", (o) => C.txBars(state.model, o, "steady"), "txBars");
    bindFindingLinks(p);
  }

  // ── Transactions ────────────────────────────────────────────────────────────
  const TX_COLS = [
    { k: "name", h: "Transaction" }, { k: "count", h: "Count", num: 1, f: (t, s) => fmt.int(s === t.full ? t.count : s.count + (s.fail || 0)), v: (t, s) => (s === t.full ? t.count : s.count + (s.fail || 0)) },
    { k: "pass", h: "Pass", num: 1, f: (t) => (t.pass == null ? "-" : fmt.int(t.pass)), v: (t) => t.pass },
    { k: "fail", h: "Fail", num: 1, f: (t) => (t.fail == null ? "-" : fmt.int(t.fail)), v: (t) => t.fail },
    { k: "failPct", h: "Fail %", num: 1, f: (t) => (t.failPct == null ? "-" : t.failPct.toFixed(2)), v: (t) => t.failPct },
    { k: "min", h: "Min", num: 1, f: (t, s) => n3(s.min), v: (t, s) => s.min }, { k: "avg", h: "Avg", num: 1, f: (t, s) => n3(s.avg), v: (t, s) => s.avg },
    { k: "max", h: "Max", num: 1, f: (t, s) => n3(s.max), v: (t, s) => s.max }, { k: "sd", h: "Std dev", num: 1, f: (t, s) => n3(s.stdDev), v: (t, s) => s.stdDev },
    { k: "p50", h: "P50", num: 1, f: (t, s) => n3(s.p.p50), v: (t, s) => s.p.p50 }, { k: "p90", h: "P90", num: 1, f: (t, s) => n3(s.p.p90), v: (t, s) => s.p.p90 },
    { k: "p95", h: "P95", num: 1, f: (t, s) => n3(s.p.p95), v: (t, s) => s.p.p95 }, { k: "p98", h: "P98", num: 1, f: (t, s) => n3(s.p.p98), v: (t, s) => s.p.p98 }, { k: "p99", h: "P99", num: 1, f: (t, s) => n3(s.p.p99), v: (t, s) => s.p.p99 },
    { k: "tps", h: "TPS", num: 1, f: (t, s) => fmt.num(s.tps, 4), v: (t, s) => s.tps },
  ];
  function transactions(p) {
    const m = state.model;
    const which = state.txView;
    const groups = fmt.groupByScript(m);
    const slaPerTx = (m.settings.sla && m.settings.sla.perTx) || {};
    let rows = [];
    const match = (t) => !state.filter || t.name.toLowerCase().includes(state.filter.toLowerCase());
    if (state.sort) {
      const col = TX_COLS.find((c) => c.k === state.sort.k);
      rows = m.transactions.filter(match).slice().sort((a, b) => {
        const va = col.v ? col.v(a, a[which]) : a.name, vb = col.v ? col.v(b, b[which]) : b.name;
        if (va == null) return 1; if (vb == null) return -1;
        return (va < vb ? -1 : va > vb ? 1 : 0) * (state.sort.asc ? 1 : -1);
      }).map((t) => ({ t }));
    } else for (const g of groups) { if (groups.length > 1) rows.push({ group: g.script }); for (const t of g.rows) if (match(t)) rows.push({ t }); }
    const slaCols = which === "steady";
    const tl = m.timeline;
    p.innerHTML = `
      <div class="tx-controls">
        <div class="seg"><button data-v="steady" class="${which === "steady" ? "on" : ""}">${m.window && !m.window.detected ? "Analysis window" : "Steady state"}</button><button data-v="full" class="${which === "full" ? "on" : ""}">Full run</button></div>
        <input id="tx-filter" placeholder="Filter transactions" value="${esc(state.filter)}">
        <span class="hint">${which === "steady" && m.window ? `t+${fmt.hms(m.window.start)} – t+${fmt.hms(m.window.end)} · ` : ""}seconds · click a row for detail${slaCols ? " · type an SLA (s) per transaction" : ""}</span>
      </div>
      <div class="method-note ${m.method.percentileMethod === "exact" ? "" : "warn"}"><b>How these figures are calculated:</b> ${esc(m.method.summaryBasis)}. Min/Max/Std dev/percentiles are not averaged into time slots (LRE's summary table does that, so busy transactions can differ from it). P90 trend: per ${m.timeline.bucketSec} s slot (chart granularity).</div>
      <div class="card"><div class="table-wrap"><table class="t" id="tx-table"><thead><tr>
        ${TX_COLS.map((c) => `<th class="sortable ${c.num ? "num" : ""} ${state.sort && state.sort.k === c.k ? "sorted" + (state.sort.asc ? " asc" : "") : ""}" data-k="${c.k}" ${which === "steady" && ["pass", "fail", "failPct"].includes(c.k) ? 'title="Whole-run count from sum_data"' : ""}>${c.h}${which === "steady" && ["pass", "fail", "failPct"].includes(c.k) ? " (run)" : ""}</th>`).join("")}
        ${slaCols ? `<th class="num">SLA (s)</th><th>Result</th><th class="num">Apdex</th>` : ""}<th>P90 trend</th>
      </tr></thead><tbody>
        ${rows.map((r) => {
          if (r.group) return `<tr class="group"><td colspan="${TX_COLS.length + (slaCols ? 4 : 1)}">${esc(r.group)}</td></tr>`;
          const t = r.t, s = t[which];
          const sla = slaCols ? `<td class="num"><input class="in-sla" data-tx="${esc(t.name)}" value="${slaPerTx[t.name] != null ? esc(slaPerTx[t.name]) : ""}" placeholder="${m.settings.sla.defaultSec != null && (t.inMap || !m.transactions.some((x) => x.inMap)) ? esc(m.settings.sla.defaultSec) : ""}"></td><td>${t.sla ? `<span class="pill ${t.sla.pass ? "pass" : "fail"}">${t.sla.pass ? "PASS" : "FAIL"}</span>` : ""}</td><td class="num">${t.sla && t.sla.apdex != null ? t.sla.apdex.toFixed(2) : ""}</td>` : "";
          return `<tr class="click ${state.detailTx === t.id ? "selected" : ""}" data-id="${t.id}">${TX_COLS.map((c) => `<td class="${c.num ? "num" : ""}">${c.k === "name" ? esc(state.sort ? t.label || t.name : t.name) + (t.inMap ? "" : ' <span class="pill warn" title="Internal id ' +
            t.id + ' could not be matched to a name — see Validation">unnamed</span>') : esc(c.f(t, s))}</td>`).join("")}${sla}<td>${spark(downsample(tl.tx[t.id].p90, 60))}</td></tr>`;
        }).join("")}
      </tbody></table></div></div>
      <div id="tx-detail"></div>`;
    $$(".seg button", p).forEach((b) => { b.onclick = () => { state.txView = b.dataset.v; rerender(p); }; });
    const fi = $("#tx-filter", p);
    fi.oninput = () => { state.filter = fi.value; clearTimeout(fi._h); fi._h = setTimeout(() => { rerender(p); const n = $("#tx-filter", p); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    $$("th.sortable", p).forEach((th) => { th.onclick = () => { const k = th.dataset.k; state.sort = state.sort && state.sort.k === k ? (state.sort.asc ? null : { k, asc: true }) : { k, asc: false }; rerender(p); }; });
    $$("tr.click", p).forEach((tr) => { tr.onclick = (e) => { if (e.target.tagName === "INPUT") return; state.detailTx = state.detailTx === +tr.dataset.id ? null : +tr.dataset.id; rerender(p); }; });
    $$(".in-sla", p).forEach((inp) => {
      inp.onchange = () => {
        const v = inp.value.trim();
        if (v && !(Number(v) > 0)) { toast("SLA must be a number of seconds", true); return; }
        const sla = Object.assign({}, m.settings.sla, { perTx: Object.assign({}, m.settings.sla.perTx) });
        if (v) sla.perTx[inp.dataset.tx] = Number(v); else delete sla.perTx[inp.dataset.tx];
        saveSla(m, sla);
        applySettings({ sla });
      };
    });
    if (state.detailTx != null) txDetail($("#tx-detail", p), state.detailTx);
  }
  function rerender(panel) {
    for (const [el, c] of [...state.charts]) if (panel.contains(el)) { if (el._ro) el._ro.disconnect(); c.chart.dispose(); state.charts.delete(el); }
    panel.dataset.rendered = "";
    renderTab(panel.id.slice(4));
  }

  function txDetail(el, id) {
    const m = state.model;
    const t = m.transactions.find((x) => x.id === id);
    if (!t) return;
    const lgRows = (t.perLg || []).map((l) => `<tr><td>${esc(l.lg)}</td><td class="num">${fmt.int(l.full.count)}</td><td class="num">${n3(l.full.avg)}</td><td class="num">${n3(l.full.p.p90)}</td><td class="num">${n3(l.full.p.p95)}</td><td class="num">${fmt.int(l.steady.count)}</td><td class="num">${n3(l.steady.avg)}</td><td class="num">${n3(l.steady.p.p90)}</td><td class="num">${n3(l.steady.p.p95)}</td></tr>`).join("");
    el.innerHTML = `<div class="detail"><h3 style="margin:0 0 8px">${esc(t.label || t.name)}</h3>
      <div class="sub" style="color:var(--text-2);font-size:12px;margin-bottom:8px">ID ${t.id} · scripts: ${esc(t.scripts.join(", ") || "-")} · first t+${fmt.hms(t.firstRelSec)} · last t+${fmt.hms(t.lastRelSec)} · ${t.vuserIterations} VUser-iterations${
        t.negativeRtClamped ? ` · ${t.negativeRtClamped} negative RT clamped` : ""}</div>
      <div class="grid-2" id="txd-charts"></div>
      <div class="card"><h3>Per load generator (histogram percentiles)</h3><div class="table-wrap"><table class="t"><thead><tr><th>Load generator</th><th class="num">Count</th><th class="num">Avg</th><th class="num">P90</th><th class="num">P95</th><th class="num">Steady count</th><th class="num">Steady avg</th><th class="num">Steady P90</th><th class="num">Steady P95</th></tr></thead><tbody>${lgRows}</tbody></table></div></div></div>`;
    const g = $("#txd-charts", el);
    chartCard(g, "Distribution (full run)", (o) => C.distribution(state.model, id, o), "dist");
    chartCard(g, "Over time — avg / P90 / P95 / max", (o) => {
      const mm = state.model;
      const opt = C.rtOverTime(mm, [id], "p90", o);
      if (!opt) return null;
      const s = mm.timeline.tx[id], bs = mm.timeline.bucketSec;
      const xy = (a) => a.map((v, b) => [b * bs, v]);
      opt.series = [
        { name: "Average", type: "line", showSymbol: false, data: xy(s.avg), markArea: opt.series[0].markArea },
        { name: "P90", type: "line", showSymbol: false, data: xy(s.p90) }, { name: "P95", type: "line", showSymbol: false, data: xy(s.p95) },
        { name: "Max", type: "line", showSymbol: false, lineStyle: { width: 1, type: "dotted" }, data: xy(s.max) },
      ];
      return opt;
    }, "txTime");
    const heatCard = chartCard(g, "Latency heatmap", () => null, "latencyHeat", "tall");
    $(".chart", heatCard).innerHTML = `<div class="na">Loading…</div>`;
    worker().postMessage({ type: "latency", ids: [id], cols: 240, rows: 40, target: "detail" });
    state.pendingHeat = $(".chart", heatCard);
  }
  function onLatency(msg) {
    const el = state.pendingHeat;
    state.pendingHeat = null;
    if (!el || !document.body.contains(el)) return;
    el.innerHTML = "";
    el.style.height = "";
    el._build = (o) => C.latencyHeat(state.model, msg.heat, o);
    mount(el, el._build({ dark: state.dark, noTitle: true }), "latencyHeat");
  }

  // ── Charts ──────────────────────────────────────────────────────────────────
  function chartsTab(p) {
    const m = state.model;
    const txs = m.transactions.filter((t) => t.full.count);
    p.innerHTML = `<div class="chart-layout">
      <aside class="tx-picker">
        <div class="actions"><button class="btn sm" data-sel="slow">5 slowest</button><button class="btn sm" data-sel="busy">5 busiest</button><button class="btn sm" data-sel="all">All</button><button class="btn sm ghost" data-sel="none">None</button></div>
        ${txs.map((t) => `<label><input type="checkbox" value="${t.id}" ${state.selected.has(t.id) ? "checked" : ""}> ${esc(t.label || t.name)}</label>`).join("")}
      </aside>
      <div>
        <div class="chart-controls"><span class="setting-label">Response-time metric</span>
          <div class="seg" id="metric">${["avg", "p50", "p90", "p95", "p99", "max"].map((k) => `<button data-m="${k}" class="${state.metric === k ? "on" : ""}">${k === "avg" ? "Avg" : k.toUpperCase()}</button>`).join("")}</div>
          <span class="hint">Granularity ${esc(m.granularity ? `${m.granularity.sec} s${m.granularity.auto ? " (auto)" : ""}` : m.timeline.bucketSec + " s")} — change it in the settings bar · drag the slider or scroll inside a chart to zoom · the shaded band is the analysis window</span></div>
        <div id="chart-grid"></div>
      </div></div>`;
    $$(".tx-picker input", p).forEach((cb) => { cb.onchange = () => { if (cb.checked) state.selected.add(+cb.value); else state.selected.delete(+cb.value); rerender(p); }; });
    $$(".tx-picker [data-sel]", p).forEach((b) => {
      b.onclick = () => {
        const k = b.dataset.sel;
        // wrappers missing from RawData.map (iteration totals) would always win "slowest" — leave them out
        const pool = txs.some((t) => t.inMap) ? txs.filter((t) => t.inMap) : txs;
        const sorted = (f) => pool.slice().sort(f).slice(0, 5).map((t) => t.id);
        state.selected = new Set(k === "all" ? txs.map((t) => t.id) : k === "none" ? [] : k === "slow" ? sorted((a, b2) => (b2.steady.p.p90 || 0) - (a.steady.p.p90 || 0)) : sorted((a, b2) => b2.full.count - a.full.count));
        rerender(p);
      };
    });
    $$("#metric button", p).forEach((b) => { b.onclick = () => { state.metric = b.dataset.m; rerender(p); }; });
    const g = $("#chart-grid", p);
    const ids = [...state.selected];
    const hasLatency = ids.length > 0;
    chartCard(g, "Load and throughput", (o) => C.load(state.model, o), "load");
    chartCard(g, `Response time over time — ${state.metric === "avg" ? "average" : state.metric.toUpperCase()}`, (o) => C.rtOverTime(state.model, ids, state.metric, o), "rtOverTime", "", ids.length ? "" : "Select transactions on the left");
    chartCard(g, "Transactions per second", (o) => C.tpsPerTx(state.model, ids, o), "throughput");
    const heat = chartCard(g, "Latency heatmap — selected transactions", () => null, "latencyHeat", "tall", "Samples per time × response-time band: banding, bimodal behaviour and slow tails show up here");
    if (hasLatency) { $(".chart", heat).innerHTML = `<div class="na">Loading…</div>`; state.pendingHeat = $(".chart", heat); worker().postMessage({ type: "latency", ids, cols: 240, rows: 40 }); }
    chartCard(g, "Throughput vs response time", (o) => C.tpsVsRt(state.model, o), "tpsVsRt", "", "Each point is one time bucket. A rising curve at high TPS marks the saturation point.");
    chartCard(g, "Errors over time", (o) => C.errorsOverTime(state.model, o), "errors");
    chartCard(g, "HTTP responses per second", (o) => C.graphRole(state.model, ["httpCodes"], "HTTP responses per second", "per second", o), "httpCodes");
    chartCard(g, "Throughput (bytes received)", (o) => C.graphRole(state.model, ["bytesReceived", "throughput"], "Throughput", "bytes/s", o), "bytes");
    chartCard(g, "Load-generator CPU and memory", (o) => C.lgHealth(state.model, o), "lgHealth");
    chartCard(g, "P90 per load generator", (o) => C.rtPerLg(state.model, o), "rtPerLg", "", "A load generator that is slower on most transactions points to the LG, not the application.");
    chartCard(g, "Response time per VUser", (o) => C.vuserHeat(state.model, o), "vuserHeat", "tall");
    if (state.scrollTo) { const el = $(`[data-chart="${state.scrollTo}"]`, p); state.scrollTo = null; if (el) setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }
  }

  // ── Errors ──────────────────────────────────────────────────────────────────
  function errors(p) {
    const m = state.model;
    if (!m.errors) { p.innerHTML = `<div class="card"><div class="na">No error data — SqliteDb.db was not found in the results.</div></div>`; return; }
    const off = m.meta.localOffsetSec;
    p.innerHTML = `<div class="card"><h3>${fmt.int(m.errors.total)} error(s), grouped</h3><div class="sub">Numbers, GUIDs and hex IDs in messages are replaced so similar errors group together. Times are local.</div>
      <div class="table-wrap"><table class="t"><thead><tr><th class="num">Count</th><th>Code</th><th>Message</th><th>Script</th><th class="num">VUsers</th><th>Injectors</th><th>First</th><th>Last</th></tr></thead><tbody>
      ${m.errors.summary.map((g) => `<tr><td class="num">${fmt.int(g.count)}</td><td>${esc(g.code)}</td><td title="${esc(g.example)}">${esc(g.pattern)}</td><td>${esc(g.script || "-")}</td><td class="num">${g.vusers.length}</td><td>${esc(g.injectors.join(", "))}</td>
        <td>${g.firstUtc != null ? esc(fmt.localTime(g.firstUtc, off).slice(11)) : "-"}</td><td>${g.lastUtc != null ? esc(fmt.localTime(g.lastUtc, off).slice(11)) : "-"}</td></tr>`).join("") || `<tr><td colspan="8" class="na">No errors were logged.</td></tr>`}
      </tbody></table></div></div>
      <div id="err-chart"></div>
      <div class="card"><h3>Error log</h3><div class="tx-controls"><input id="err-q" placeholder="Search message, code, VUser, injector…" style="min-width:320px"><span class="hint" id="err-n"></span></div>
      <div class="table-wrap" style="max-height:520px;overflow:auto"><table class="t"><thead><tr><th>Time (local)</th><th>t+</th><th>Code</th><th>Message</th><th>Script</th><th>VUser</th><th>Injector</th><th class="num">Iteration</th></tr></thead><tbody id="err-rows"></tbody></table></div></div>`;
    chartCard($("#err-chart", p), "Errors over time", (o) => C.errorsOverTime(state.model, o), "errors");
    const draw = () => {
      const q = $("#err-q", p).value.toLowerCase();
      const rows = m.errors.rows.filter((e) => !q || [e.message, e.code, e.vuser, e.injector, e.script, e.action].join(" ").toLowerCase().includes(q));
      $("#err-n", p).textContent = `${fmt.int(rows.length)} row(s)${rows.length > 1000 ? " — first 1,000 shown" : ""}${m.errors.rowsTruncated ? " · log truncated to 20,000 rows (all rows are in the Excel export)" : ""}`;
      $("#err-rows", p).innerHTML = rows.slice(0, 1000).map((e) => `<tr><td>${esc(e.utc != null ? fmt.localTime(e.utc, off) : e.time)}</td><td>${fmt.hms(e.relSec)}</td><td>${esc(e.code)}</td><td>${esc(e.message)}</td><td>${esc(e.script)}</td><td>${esc(e.vuser)}</td><td>${esc(e.injector)}</td><td class="num">${esc(e.iteration)}</td></tr>`).join("");
    };
    $("#err-q", p).oninput = () => { clearTimeout(draw._h); draw._h = setTimeout(draw, 200); };
    draw();
  }

  // ── Workload ────────────────────────────────────────────────────────────────
  function workload(p) {
    const m = state.model;
    p.innerHTML = `<div class="card"><h3>Scripts</h3><div class="table-wrap"><table class="t"><thead><tr><th>Script</th><th>Protocol</th><th class="num">VUsers</th><th>Load generators</th><th>Pacing</th><th>Think time</th><th class="num">Iterations</th><th class="num">Planned</th><th class="num">Achieved</th><th class="num">Transactions</th></tr></thead><tbody>
      ${m.workload.map((s) => `<tr><td>${esc(s.key)}<div class="hint">${esc(s.groups.join(", "))}</div></td><td>${esc(s.protocol || "-")}</td><td class="num">${s.vusers}</td><td>${esc(s.loadGenerators.map((l) => `${l.name} (${l.vusers})`).join(", "))}</td>
        <td>${esc(s.pacing ? s.pacing.text : "-")}</td><td>${esc(s.thinkTime ? s.thinkTime.text : "-")}</td><td class="num">${fmt.int(s.iterationsAchieved)}</td><td class="num">${s.iterationsExpected != null ? fmt.int(s.iterationsExpected) : "-"}</td>
        <td class="num">${s.iterationsExpected ? `<span class="pill ${s.iterationsAchieved / s.iterationsExpected >= 0.95 ? "ok" : "warn"}">${((s.iterationsAchieved / s.iterationsExpected) * 100).toFixed(0)} %</span>` : "-"}</td><td class="num">${s.transactions.length}</td></tr>`).join("")}
      </tbody></table></div></div>
      <div class="card"><h3>Load generators and hosts</h3><div class="table-wrap"><table class="t"><thead><tr><th>Host</th><th>IP</th><th>Role</th><th class="num">VUsers</th><th>Scripts</th><th class="num">CPU peak</th><th class="num">Memory peak</th></tr></thead><tbody>
      ${m.lgs.map((l) => `<tr><td>${esc(l.name)}</td><td>${esc(l.ip || "-")}</td><td>${esc(l.role)}</td><td class="num">${l.vusers}</td><td>${esc(l.scripts.join("; ") || "-")}</td><td class="num">${l.cpuPeak != null ? l.cpuPeak.toFixed(0) + " %" : "-"}</td><td class="num">${l.memPeak != null ? l.memPeak.toFixed(0) + " %" : "-"}</td></tr>`).join("")}
      </tbody></table></div></div>
      <div class="card"><h3>VUsers</h3><div class="table-wrap" style="max-height:480px;overflow:auto"><table class="t"><thead><tr><th>Group</th><th class="num">VUser</th><th>Script</th><th>Load generator</th><th>Running from</th><th>Exited</th><th class="num">Iterations</th><th class="num">Samples</th><th class="num">Avg RT</th></tr></thead><tbody>
      ${m.vusers.map((v) => `<tr><td>${esc(v.group)}</td><td class="num">${v.vuser}</td><td>${esc(v.script)}</td><td>${esc(v.lg)}</td><td>t+${fmt.hms(v.runRelSec)}</td><td>t+${fmt.hms(v.exitRelSec)}</td><td class="num">${fmt.int(v.iterations)}</td><td class="num">${fmt.int(v.samples)}</td><td class="num">${n3(v.avgRt)}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }

  // ── Insights ────────────────────────────────────────────────────────────────
  function findingHtml(f) {
    const show = (v) => (typeof v === "number" ? String(+v.toFixed(4)) : Array.isArray(v) ? (v.every((x) => typeof x !== "object") ? v.slice(0, 8).join(", ") + (v.length > 8 ? " …" : "") : null) : v && typeof v === "object" ? null : String(v));
    const ev = f.evidence ? Object.entries(f.evidence).map(([k, v]) => [k, show(v)]).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${v}`).join(" · ").slice(0, 400) : "";
    return `<div class="finding ${f.severity}"><div class="ft"><span class="pill ${f.severity}">${fmt.SEVERITY[f.severity].label}</span> ${esc(f.title)}</div>
      <div class="fx">${esc(f.text)}</div>${ev ? `<div class="ev">${esc(ev)}</div>` : ""}${f.chart ? `<button class="go" data-chart="${esc(f.chart)}">Show chart →</button>` : ""}</div>`;
  }
  function bindFindingLinks(p) {
    $$(".finding .go", p).forEach((b) => {
      b.onclick = () => {
        const key = b.dataset.chart;
        if (key === "slaChart") return openTab("transactions");
        state.scrollTo = { vusers: "load", rtOverTime: "rtOverTime", throughput: "throughput", rtPerLg: "rtPerLg", lgHealth: "lgHealth", errors: "errors" }[key] || key;
        const panel = $("#tab-charts"); panel.dataset.rendered = "";
        openTab("charts");
      };
    });
  }
  function insights(p) {
    const ins = state.model.insights;
    const groups = ["high", "medium", "low", "info", "good"];
    p.innerHTML = `<div class="verdict-banner ${ins.verdict.status}">${esc(ins.verdict.text)}</div>
      <div class="sub" style="color:var(--text-2);margin-bottom:12px">Every check runs offline on the raw results: Little's Law and pacing, Mann-Kendall trend test with Sen's slope, change-point detection, robust (median/MAD) spike detection, load-generator comparison, LG CPU/memory, errors, SLA and Apdex. Change the analysis window or SLAs to re-run them.</div>
      ${groups.map((s) => ins.findings.filter((f) => f.severity === s).map(findingHtml).join("")).join("") || '<div class="na">No findings.</div>'}`;
    bindFindingLinks(p);
  }

  // ── Validation ──────────────────────────────────────────────────────────────
  function validation(p) {
    const m = state.model;
    p.innerHTML = `<div class="grid-2">
      <div class="card"><h3>Method</h3><table class="t kv"><tbody>${Object.entries(m.method).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}</tbody></table></div>
      <div class="card"><h3>Files used</h3><table class="t kv"><tbody>${Object.entries(m.files.used).map(([k, v]) => `<tr><td>${esc(k)}</td><td>${v ? esc(v) : '<span class="pill warn">missing</span>'}</td></tr>`).join("")}
        <tr><td>sum_data graphs</td><td>${m.files.sumDataGraphs}</td></tr></tbody></table></div></div>
      <div class="card"><h3>Self-checks</h3><div class="sub">These confirm the binary layout of RawData.eve and the consistency of the scenario files. Compare the transaction counts with LRE Analysis — they must match exactly.</div>
      <table class="t"><thead><tr><th>Status</th><th>Check</th><th>Result</th></tr></thead><tbody>
      ${m.selfCheck.map((c) => `<tr><td><span class="pill ${c.status === "fail" ? "fail" : c.status === "ok" ? "ok" : c.status === "warn" ? "warn" : "info"}">${c.status.toUpperCase()}</span></td><td>${esc(c.id)}</td><td>${esc(c.text)}${c.data !== undefined ? `<div class="ev" style="font-family:var(--mono);font-size:11px;color:var(--text-3)">${esc(JSON.stringify(c.data).slice(0, 600))}</div>` : ""}</td></tr>`).join("")}
      </tbody></table></div>
      ${m.txNameResolution && m.txNameResolution.matches && m.txNameResolution.matches.length ? `<div class="card"><h3>Transaction names</h3><div class="sub">${esc(m.txNameResolution.method)}</div><div class="table-wrap"><table class="t"><thead><tr><th class="num">Internal id</th><th>Name</th><th class="num">Count</th><th class="num">LRE graph count</th><th class="num">Mean (s)</th><th class="num">LRE graph mean</th><th>Accepted</th></tr></thead><tbody>
        ${m.txNameResolution.matches.map((x) => `<tr><td class="num">${x.id}</td><td>${esc(x.name)}</td><td class="num">${fmt.int(x.count)}</td><td class="num">${fmt.int(x.graphCount)}</td><td class="num">${n3(x.mean)}</td><td class="num">${n3(x.graphMean)}</td><td>${x.accepted ? '<span class="pill ok">yes</span>' : '<span class="pill fail">no</span>'}</td></tr>`).join("")}
      </tbody></table></div></div>` : ""}
      ${m.dataPoints && m.dataPoints.length ? `<div class="card"><h3>Data points (RawData.eve sub-type 762)</h3><div class="sub">Per-request counters such as HTTP status codes — compare HTTP_200 / HTTP_500 with LRE's HTTP Responses summary.</div><table class="t"><thead><tr><th>Data point</th><th class="num">Records</th><th class="num">Sum of values</th></tr></thead><tbody>
        ${m.dataPoints.map((d) => `<tr><td>${esc(d.name)}</td><td class="num">${fmt.int(d.count)}</td><td class="num">${fmt.int(Math.round(d.sum))}</td></tr>`).join("")}
      </tbody></table></div>` : ""}
      ${m.eve ? `<div class="card"><h3>RawData.eve record types</h3><div class="table-wrap"><table class="t"><thead><tr><th class="num">Count</th><th>Signature</th><th>First bytes (hex)</th></tr></thead><tbody>
        ${m.eve.signatures.slice(0, 30).map((s) => `<tr><td class="num">${fmt.int(s.count)}</td><td><code>${esc(s.signature)}</code></td><td><code style="font-size:10.5px">${esc(s.examples[0] || "")}</code></td></tr>`).join("")}
      </tbody></table></div></div>` : ""}`;
  }

  // ── exports ─────────────────────────────────────────────────────────────────
  const loaded = new Map();
  function loadScript(src) {
    if (!loaded.has(src)) loaded.set(src, new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = () => rej(new Error("Could not load " + src)); document.head.appendChild(s); }));
    return loaded.get(src);
  }
  function fileBase() { return (state.model.meta.sessionName || "lre_run").replace(/[^\w.-]+/g, "_") + "_analysis"; }
  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }
  function svgCharts() {
    const out = {};
    for (const c of C.reportSet(state.model, { static: true, dark: false })) {
      const ch = echarts.init(null, null, { renderer: "svg", ssr: true, width: 1000, height: c.key === "vuserHeat" || c.key === "latencyHeat" ? 460 : 400 });
      try { ch.setOption(c.option); out[c.key] = ch.renderToSVGString(); } finally { ch.dispose(); }
    }
    return out;
  }
  async function pngCharts() {
    const out = {};
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;left:-10000px;top:0;width:1000px;height:420px;background:#fff";
    document.body.appendChild(host);
    try {
      for (const c of C.reportSet(state.model, { static: true, dark: false })) {
        const h = c.key === "vuserHeat" || c.key === "latencyHeat" ? 460 : 400;
        host.style.height = h + "px";
        const ch = echarts.init(host, null, { renderer: "canvas", width: 1000, height: h, devicePixelRatio: 2 });
        ch.setOption(c.option);
        const url = ch.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#ffffff" });
        ch.dispose();
        const bin = atob(url.split(",")[1]);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        out[c.key] = { data, width: 1000, height: h };
      }
    } finally { host.remove(); }
    return out;
  }

  const EXPORTS = {
    async xlsx() {
      await loadScript("ra/vendor/exceljs.min.js");
      await loadScript("ra/report/xlsx.js");
      const buf = await L.xlsx.buildWorkbook(state.model, window.ExcelJS).xlsx.writeBuffer();
      download(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), fileBase() + ".xlsx");
    },
    async docx() {
      await loadScript("ra/vendor/docx.iife.js");
      await loadScript("ra/report/html.js");
      await loadScript("ra/report/docx.js");
      const images = await pngCharts();
      const doc = L.docx.buildDocument(state.model, window.docx, { images });
      download(await window.docx.Packer.toBlob(doc), fileBase() + ".docx");
    },
    async pdf() {
      const w = window.open("", "_blank");
      await loadScript("ra/report/html.js");
      const html = L.html.buildReport(state.model, { charts: svgCharts() });
      if (!w) { download(new Blob([html], { type: "text/html" }), fileBase() + ".html"); toast("Pop-up blocked — the report was downloaded as HTML. Open it and print to PDF."); return; }
      w.document.open(); w.document.write(html); w.document.close();
      setTimeout(() => { try { w.focus(); w.print(); } catch (_) { /* user closed it */ } }, 600);
    },
    async html() {
      await loadScript("ra/report/html.js");
      download(new Blob([L.html.buildReport(state.model, { charts: svgCharts() })], { type: "text/html" }), fileBase() + ".html");
    },
    async json() { download(new Blob([JSON.stringify(state.model, null, 2)], { type: "application/json" }), fileBase() + ".json"); },
    async "json-redacted"() { worker().postMessage({ type: "redact" }); },
  };
  $$("[data-export]").forEach((b) => {
    b.onclick = async () => {
      $("#menu-more").hidden = true;
      const k = b.dataset.export;
      const label = b.textContent;
      b.disabled = true; b.textContent = "Preparing…";
      try { await EXPORTS[k](); } catch (e) { toast("Export failed: " + (e.message || e), true); }
      finally { b.disabled = false; b.textContent = label; }
    };
  });
  $("#btn-more").onclick = (e) => { e.stopPropagation(); $("#menu-more").hidden = !$("#menu-more").hidden; };
  document.addEventListener("click", (e) => { if (!e.target.closest(".menu")) $("#menu-more").hidden = true; });
})();
