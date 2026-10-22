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
  const NT = L.notes;
  // Feature switches. Granularity (LRE-style averaged figures) is built and tested but hidden for
  // now: the page shows the exact figures only. Set to true to bring the control back.
  const FEATURES = { granularity: false };

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
      let agg = null;
      try { agg = JSON.parse(localStorage.getItem(aggKey(model)) || "null"); } catch (_) { /* storage blocked */ }
      if (FEATURES.granularity && agg && agg.sec) { applySettings({ aggregation: agg }); toast(`Granularity ${agg.sec} s restored from your last session for this test — choose “Exact” to see every transaction`); }
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
  /** Seconds from the scenario start ↔ a datetime-local value in the run's local time. */
  function relToInput(m, rel) {
    if (rel == null || m.meta.startUtc == null) return "";
    return new Date((m.meta.startUtc + rel + (m.meta.localOffsetSec || 0)) * 1000).toISOString().slice(0, 19);
  }
  function inputToRel(m, v) {
    const x = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(String(v || ""));
    if (!x || m.meta.startUtc == null) return NaN;
    const wall = Date.UTC(+x[1], +x[2] - 1, +x[3], +x[4], +x[5], +(x[6] || 0)) / 1000;
    return wall - (m.meta.localOffsetSec || 0) - m.meta.startUtc;
  }
  function syncSettingsBar() {
    const m = state.model;
    $("#win-start").value = m.window ? relToInput(m, m.window.start) : "";
    $("#win-end").value = m.window ? relToInput(m, m.window.end) : "";
    $("#win-start").min = $("#win-end").min = relToInput(m, 0);
    $("#win-start").max = $("#win-end").max = relToInput(m, m.meta.durationSec);
    $("#win-local").textContent = m.window ? `${fmt.relRange(m, m.window.start, m.window.end)} · ${fmt.dur(m.window.durationSec)} · ${m.window.detected ? "detected steady state" : "user-set"}` : "no steady state detected";
    const s = m.settings && m.settings.sla;
    $("#sla-pct").value = String((s && s.percentile) || 90);
    $("#sla-default").value = s && s.defaultSec != null ? s.defaultSec : "";
    // granularity: exact (default) or LRE-style aggregated figures — hidden while FEATURES.granularity is off
    const a = FEATURES.granularity ? m.aggregation : null;
    $("#agg-setting").hidden = !FEATURES.granularity;
    if (!FEATURES.granularity) { $("#agg-help").hidden = true; $("#agg-banner").hidden = true; }
    if (a) {
      const label = (sec) => (sec % 3600 === 0 ? `${sec / 3600} h` : sec % 60 === 0 ? `${sec / 60} min` : `${sec} s`);
      $("#agg").innerHTML = `<option value="">Exact — every transaction (recommended)</option>` +
        a.options.map((o) => `<option value="${o.sec}" ${o.available ? "" : "disabled"}>${label(o.sec)} — LRE-style${o.available ? "" : " (very large run: use the CLI)"}</option>`).join("");
      $("#agg").value = a.sec ? String(a.sec) : "";
      $("#agg-combine").checked = !a.byVuser;
      $("#agg-combine").disabled = !a.active;
      $("#agg-hint").textContent = a.active
        ? `averaged figures · charts ${m.granularity ? (m.granularity.sec % 60 ? m.granularity.sec + " s" : m.granularity.sec / 60 + " min") : ""}`
        : `exact figures · charts ${m.granularity ? (m.granularity.sec % 60 ? m.granularity.sec + " s" : m.granularity.sec / 60 + " min") : ""} (auto)`;
      const b = $("#agg-banner");
      b.hidden = !a.active;
      b.innerHTML = a.active ? `<b>⚠ ${esc(a.title)}.</b> Min, Max, Std Dev and percentiles are of ${a.sec}-second averages${a.byVuser ? " per VUser" : ""}; Count, Pass, Fail and Average are exact.` +
        (a.partial ? " Some figures could not be averaged at this size (very large run or user-set window) and show exact values." : "") +
        ` <button class="btn sm" id="agg-exact">Show exact values</button>` : "";
      const ex = $("#agg-exact");
      if (ex) ex.onclick = () => setAggregation(null, !$("#agg-combine").checked);
    }
    // one-line summary of the current settings (the editor opens with "Change")
    const chips = [];
    chips.push(m.window ? `<span class="chip" title="${esc(fmt.relRange(m, m.window.start, m.window.end))}">${m.window.detected ? "Steady state" : "Analysis window"} <b>${esc(fmt.relWhen(m, m.window.start, true))} → ${esc(fmt.relWhen(m, m.window.end, true))}</b> · ${esc(fmt.dur(m.window.durationSec))}</span>` : `<span class="chip">No steady state</span>`);
    chips.push(s && s.defaultSec != null ? `<span class="chip">SLA <b>P${s.percentile} ≤ ${s.defaultSec} s</b></span>` : `<span class="chip">SLA <b>${s && Object.keys(s.perTx || {}).length ? "per transaction" : "not set"}</b></span>`);
    if (FEATURES.granularity) chips.push(a && a.active ? `<span class="chip warn">Granularity <b>${a.sec} s${a.byVuser ? " per VUser" : ""}</b> (LRE-style)</span>` : `<span class="chip">Granularity <b>Exact</b></span>`);
    $("#settings-chips").innerHTML = chips.join("");
  }
  function aggKey(m) { return "lre-ra-agg2::" + (m.meta.sessionName || "run"); }
  function setAggregation(sec, byVuser) {
    const agg = { sec: sec ? Number(sec) : null, byVuser: !!byVuser };
    try { localStorage.setItem(aggKey(state.model), JSON.stringify(agg)); } catch (_) { /* storage blocked */ }
    applySettings({ aggregation: agg });
  }
  $("#agg").onchange = () => setAggregation($("#agg").value, !$("#agg-combine").checked);
  $("#agg-combine").onchange = () => setAggregation($("#agg").value, !$("#agg-combine").checked);
  $("#btn-settings").onclick = () => {
    const bar = $("#settings-bar");
    bar.hidden = !bar.hidden;
    $("#btn-settings").setAttribute("aria-expanded", String(!bar.hidden));
    $("#btn-settings").textContent = bar.hidden ? "⚙ Change" : "✓ Done";
    if (bar.hidden) $("#agg-help").hidden = true;
  };
  $("#agg-help-btn").onclick = () => {
    const h = $("#agg-help");
    h.hidden = !h.hidden;
    $("#agg-help-btn").setAttribute("aria-expanded", String(!h.hidden));
  };
  $("#win-apply").onclick = () => {
    const m = state.model;
    const a = inputToRel(m, $("#win-start").value), b = inputToRel(m, $("#win-end").value);
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return toast("Choose a start and an end date/time within the test (end after start)", true);
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

  // ── explanations on/off (remembered per browser) ──────────────────────────
  function setExplain(on) {
    document.body.classList.toggle("no-explain", !on);
    $("#btn-explain").setAttribute("aria-pressed", String(on));
    $("#btn-explain").textContent = on ? "? Hide explanations" : "? Show explanations";
    try { localStorage.setItem("lre-ra-explain", on ? "1" : "0"); } catch (_) { /* storage blocked */ }
  }
  { let on = true; try { on = localStorage.getItem("lre-ra-explain") !== "0"; } catch (_) { /* default on */ } setExplain(on); }
  $("#btn-explain").onclick = () => setExplain(document.body.classList.contains("no-explain"));
  // tab icons
  { const TAB_ICONS = { overview: "gauge", transactions: "table", charts: "line", errors: "alert", workload: "users", insights: "bulb" };
    $$("#tabs button").forEach((b) => b.insertAdjacentHTML("afterbegin", NT.icon(TAB_ICONS[b.dataset.tab] || "info"))); }

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
    $("#run-sub").textContent = `${fmt.when(m.meta.startUtc, m.meta.localOffsetSec)} → ${fmt.when(m.meta.stopUtc, m.meta.localOffsetSec)} (${fmt.zone(m.meta.localOffsetSec)}) · ${fmt.dur(m.meta.durationSec)}${m.meta.project ? " · " + m.meta.project : ""}`;
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
    ({ overview, transactions, charts: chartsTab, errors, workload, insights })[tab](panel);
    if ($$(".card > h3", panel).length > 1) {
      panel.insertAdjacentHTML("afterbegin", `<div class="panel-tools"><button class="btn sm ghost" data-ca="collapse">Collapse all</button><button class="btn sm ghost" data-ca="expand">Expand all</button></div>`);
      $$(".panel-tools [data-ca]", panel).forEach((b) => { b.onclick = () => setAllCards(panel, b.dataset.ca === "collapse"); });
    }
    enhanceCards(panel, tab);
  }

  // ── collapsible cards (state remembered per tab + card title) ───────────────
  const COLLAPSE_KEY = "lre-ra-collapsed";
  function collapsedSet() { try { return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "[]")); } catch (_) { return new Set(); } }
  function saveCollapsed(set) { try { localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...set].slice(-300))); } catch (_) { /* storage blocked */ } }
  function enhanceCards(scope, tab) {
    const saved = collapsedSet();
    for (const card of $$(".card", scope)) {
      if (card.dataset.enh) continue;
      const h = card.querySelector(":scope > h3");
      if (!h) continue;
      card.dataset.enh = "1";
      const body = document.createElement("div");
      body.className = "card-body";
      while (h.nextSibling) body.appendChild(h.nextSibling);
      card.appendChild(body);
      const key = tab + "::" + (card.dataset.ckey || h.textContent.trim());
      card.dataset.key = key;
      const note = NT.NOTES[card.dataset.ckey];
      if (note) {
        h.insertAdjacentHTML("afterbegin", `<span class="card-ico">${NT.icon(note.icon)}</span>`);
        body.insertAdjacentHTML("afterbegin", explainHtml(card.dataset.ckey));
      }
      h.classList.add("card-head");
      h.tabIndex = 0;
      h.setAttribute("role", "button");
      h.insertAdjacentHTML("beforeend", '<span class="chev" aria-hidden="true"></span>');
      setCard(card, saved.has(key) ? true : saved.has("!" + key) ? false : card.dataset.collapsed === "1", false);
      const toggle = () => setCard(card, !card.classList.contains("collapsed"), true);
      h.onclick = (e) => { if (!e.target.closest("button:not(.chev), input, select, a")) toggle(); };
      h.onkeydown = (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); } };
    }
  }
  function setCard(card, collapsed, remember) {
    card.classList.toggle("collapsed", collapsed);
    const h = card.querySelector(":scope > h3");
    if (h) h.setAttribute("aria-expanded", String(!collapsed));
    if (remember) {
      const set = collapsedSet();
      set.delete(card.dataset.key); set.delete("!" + card.dataset.key);
      set.add(collapsed ? card.dataset.key : "!" + card.dataset.key);
      saveCollapsed(set);
    }
    if (!collapsed) setTimeout(() => resizeCharts(card), 0);
  }
  /** "What this shows" line + expandable "How to read it" tips (web/notes.js). */
  function explainHtml(key) {
    const n = NT.NOTES[key];
    if (!n) return "";
    return `<div class="explain"><span class="explain-ico">${NT.icon("info")}</span><div class="explain-text"><span>${esc(n.what)}</span>
      ${n.read && n.read.length ? `<details><summary>How to read it</summary><ul>${n.read.map((r) => `<li>${esc(r)}</li>`).join("")}</ul></details>` : ""}</div></div>`;
  }
  function setAllCards(panel, collapsed) { for (const c of $$(".card[data-enh]", panel)) setCard(c, collapsed, true); }

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
    if (key) card.dataset.ckey = key;
    card.innerHTML = `<h3>${esc(title)}</h3>${sub && !(key && NT.NOTES[key]) ? `<div class="sub">${esc(sub)}</div>` : ""}<div class="chart ${cls || ""}"></div>`;
    parent.appendChild(card);
    const el = $(".chart", card);
    el._build = build;
    mount(el, build({ dark: state.dark, noTitle: true }), key);
    return card;
  }
  function redrawCharts() {
    for (const [el, c] of [...state.charts]) { // snapshot: mount() re-adds entries
      if (el._ro) el._ro.disconnect();
      killChart(c.chart);
      state.charts.delete(el);
      if (c.build) mount(el, c.build({ dark: state.dark, noTitle: true }), c.key);
    }
  }
  /**
   * Dispose a chart safely. ECharts paints large charts over several animation frames and dispose()
   * does not cancel the frame already queued, which then throws inside ECharts ("Cannot read
   * properties of null (reading 0)"). The queued frame only paints if the redraw id still matches,
   * so invalidate it first.
   */
  function killChart(ch) {
    if (!ch || ch.isDisposed()) return;
    const zr = ch.getZr && ch.getZr();
    if (zr && zr.painter && "_redrawId" in zr.painter) zr.painter._redrawId = -1;
    ch.dispose();
  }
  function disposeCharts() { for (const [el, c] of state.charts) { if (el._ro) el._ro.disconnect(); killChart(c.chart); } state.charts.clear(); }
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
    const m = state.model, t = m.totals, ins = m.insights, off = m.meta.localOffsetSec;
    // full: the exact value, shown on hover when the tile shows a shortened one
    const kpi = (l, v, sub, cls, key, ico, full) => `<div class="kpi ${cls ? "kpi-" + cls : ""}" title="${esc((full ? full + " — " : "") + (NT.KPIS[key] || ""))}"><div class="kpi-top"><span class="kpi-ico">${NT.icon(ico || "info")}</span><span class="l">${esc(l)}</span></div><div class="v ${cls || ""}">${esc(v)}</div>${sub ? `<div class="s">${esc(sub)}</div>` : ""}</div>`;
    const issues = ins.findings.filter((f) => f.severity === "high" || f.severity === "medium");
    const total = t.pass != null && t.fail != null ? t.pass + t.fail : null;
    const failPct = total ? (t.fail / total) * 100 : null;
    const slaRows = m.transactions.filter((x) => x.sla);
    const slaFail = slaRows.filter((x) => x.sla.pass === false);
    const which = m.window ? "steady" : "full";
    const named = m.transactions.filter((x) => x[which] && x[which].count && (x.inMap || !m.transactions.some((y) => y.inMap)));
    const slow = named.slice().sort((a, b) => (b[which].p.p90 || 0) - (a[which].p.p90 || 0)).slice(0, 8);
    const maxP90 = slow.length ? slow[0][which].p.p90 || 1 : 1;
    const top = slow[0];
    const early = m.lifecycle && m.lifecycle.earlyExits ? m.lifecycle.earlyExits.length : 0;
    const winName = m.window && !m.window.detected ? "Analysis window" : "Steady state";
    const line = [
      t.peakVusers != null ? `${fmt.int(t.peakVusers)} VUsers` : null,
      m.window ? `${winName.toLowerCase()} ${fmt.durShort(m.window.durationSec)}` : null,
      t.tpsSteady != null ? `${fmt.num(t.tpsSteady, 2)} transactions/s` : null,
      failPct != null ? `${failPct.toFixed(2)} % failed` : null,
      t.errors != null ? `${fmt.int(t.errors)} errors` : null,
    ].filter(Boolean).join(" · ");
    const pct = (a, b) => (a != null && b ? `${((a / b) * 100).toFixed(2)} %` : "-");
    // web traffic over the whole test (hits and data received), as on LoadRunner Analysis' summary
    // page; the VUser, transaction and error figures are in the tiles above, so they are not repeated
    const web = m.web;
    const hits = web && web.hits ? web.hits : null, bytes = web && web.throughputBytes ? web.throughputBytes : null; // 0 = not recorded in this run
    const stat = (l, v, sub, ico) => `<div class="stat"><div class="stat-top"><span class="stat-ico">${NT.icon(ico)}</span><span class="stat-l">${esc(l)}</span></div><div class="stat-v">${esc(v)}</div>${sub ? `<div class="stat-s">${esc(sub)}</div>` : ""}</div>`;
    const traffic = hits == null && bytes == null ? "" : [
      stat("Total hits", hits != null ? fmt.int(hits) : "-", hits != null ? "HTTP requests sent to the application" : "not recorded in this run", "globe"),
      stat("Hits per second", hits != null ? fmt.num(web.hitsPerSec.avg, 2) : "-", hits != null && web.hitsPerSec.peak != null ? `average · peak ${fmt.num(web.hitsPerSec.peak, 1)}` : "", "gauge"),
      stat("Total throughput", bytes != null ? fmt.bytes(bytes) : "-", bytes != null ? `${fmt.int(Math.round(bytes))} bytes received` : "not recorded in this run", "download"),
      stat("Throughput per second", bytes != null ? `${fmt.bytes(web.throughputBytesPerSec.avg)}/s` : "-", bytes != null ? `average${web.throughputBytesPerSec.peak != null ? ` · peak ${fmt.bytes(web.throughputBytesPerSec.peak)}/s` : ""}` : "", "line"),
    ].join("");
    const controller = m.lgs.find((l) => l.role === "controller");
    const lgsUsed = m.lgs.filter((l) => l.vusers);
    const facts = [
      ["Scenario", m.meta.sessionName], ["Project", m.meta.project],
      ["Run", [m.meta.runId != null ? `Run ${m.meta.runId}` : null, m.meta.resultName].filter(Boolean).join(" · ") || null],
      ["Start", fmt.when(m.meta.startUtc, off) + " (" + fmt.zone(off) + ")"], ["End", fmt.when(m.meta.stopUtc, off)], ["Duration", fmt.dur(m.meta.durationSec)],
      ["How it ended", m.meta.stopReason], ["Scripts", `${m.workload.length} script${m.workload.length === 1 ? "" : "s"} · ${fmt.int(m.lifecycle ? m.lifecycle.vusers : m.workload.reduce((a, x) => a + x.vusers, 0))} VUsers — details in Workload`],
      ["Load generators", `${lgsUsed.length} machine${lgsUsed.length === 1 ? "" : "s"} ran the VUsers`],
      ["Controller", controller ? controller.name : null], ["LoadRunner version", [m.meta.product, m.meta.version].filter(Boolean).join(" ")],
      ["Load behaviour", m.meta.loadBehavior],
    ].filter(([, v]) => v != null && v !== "");
    p.innerHTML = `
      ${m.method.percentileMethod === "exact" ? "" : `<div class="method-note warn"><b>Large run:</b> ${esc(m.method.summaryBasis)}.</div>`}
      <div class="ov-top">
        <div class="hero-card ${ins.verdict.status}">
          <div class="hero-status">${ins.verdict.status === "pass" ? "✓" : ins.verdict.status === "fail" ? "✕" : "!"} ${esc(ins.verdict.text)}</div>
          <div class="hero-line">${esc(line)}</div>
          ${issues.length ? `<ul class="hero-issues">${issues.slice(0, 4).map((f) => `<li><span class="pill ${f.severity}">${fmt.SEVERITY[f.severity].label}</span><span>${esc(f.title)}</span></li>`).join("")}</ul>`
            : `<div class="hero-line">No significant issues were found.</div>`}
          <div class="hero-actions"><button class="btn sm" data-goto="insights">All findings (${ins.findings.length}) →</button><button class="btn sm ghost" data-goto="transactions">Transactions →</button></div>
        </div>
        <div class="ov-kpis">
          ${kpi("Peak VUsers", fmt.int(t.peakVusers), m.lifecycle ? (early ? `${fmt.int(early)} of ${fmt.int(m.lifecycle.vusers)} stopped early` : `all ${fmt.int(m.lifecycle.vusers)} ran to the end`) : "", early ? "warn" : "", "vusers", "users")}
          ${kpi("Test duration", fmt.durShort(m.meta.durationSec), `${fmt.when(m.meta.startUtc, off, true)} → ${fmt.when(m.meta.stopUtc, off, true)}`, "", "duration", "clock", fmt.dur(m.meta.durationSec))}
          ${kpi(winName, m.window ? fmt.durShort(m.window.durationSec) : "-", m.window ? `${fmt.relWhen(m, m.window.start, true)} → ${fmt.relWhen(m, m.window.end, true)}` : "not detected", "", "steady", "clock", m.window ? fmt.dur(m.window.durationSec) : "")}
          ${kpi("Transactions per second", t.tpsSteady != null ? fmt.num(t.tpsSteady, 2) : "-", `TPS in the ${winName.toLowerCase()} · whole test ${fmt.num(t.tpsFull, 2)}`, "", "throughput", "gauge")}
          ${kpi("Transactions passed", fmt.int(t.pass != null ? t.pass : t.samples), total ? `${pct(t.pass, total)} of ${fmt.int(total)}` : "", "ok", "passed", "check")}
          ${kpi("Transactions failed", t.fail != null ? fmt.int(t.fail) : "n/a", total ? `${pct(t.fail, total)} of all transactions` : "", t.fail ? (failPct >= 1 ? "bad" : "warn") : "ok", "failed", "alert")}
          ${kpi("Errors logged", t.errors != null ? fmt.int(t.errors) : "n/a", m.errors && m.errors.summary[0] ? `${fmt.int(m.errors.summary.length)} different · most common ${m.errors.summary[0].code} (${fmt.int(m.errors.summary[0].count)}×)` : t.errors === 0 ? "no errors logged" : "", t.errors ? "bad" : "ok", "errors", "alert")}
          ${slaRows.length ? kpi("SLA", `${slaRows.length - slaFail.length} / ${slaRows.length} met`, slaFail.length ? `${slaFail.length} missed` : "all within threshold", slaFail.length ? "bad" : "ok", "sla", "check")
            : kpi("Slowest (P90)", top ? fmt.sec(top[which].p.p90) : "-", top ? top.label || top.name : "", "", "slowest", "bar")}
        </div>
      </div>
      ${traffic ? `<div class="card" data-ckey="stats"><h3>Web traffic — whole test</h3><div class="stats-grid">${traffic}</div></div>` : ""}
      <div class="card" data-ckey="load"><h3>Load, throughput and errors over time</h3><div class="chart" id="ov-load"></div></div>
      <div class="grid-2">
        <div class="card" data-ckey="slowest"><h3>Slowest transactions — P90 (${which === "steady" ? winName.toLowerCase() : "whole test"})</h3>
          <div class="table-wrap"><table class="t"><thead><tr><th>Transaction</th><th>P90</th><th class="num">Avg</th><th class="num">Count</th>${slaRows.length ? "<th>SLA</th>" : ""}</tr></thead><tbody>
          ${slow.map((x) => `<tr class="click" data-id="${x.id}"><td>${esc(x.label || x.name)}</td>
            <td><div class="bar-cell"><span class="num" style="min-width:52px">${n3(x[which].p.p90)}</span><span class="bar-track"><span class="bar-fill ${x.sla && x.sla.pass === false ? "bad" : ""}" style="width:${Math.max(2, ((x[which].p.p90 || 0) / maxP90) * 100).toFixed(1)}%"></span></span></div></td>
            <td class="num">${n3(x[which].avg)}</td><td class="num">${fmt.int(x.count)}</td>${slaRows.length ? `<td>${x.sla ? `<span class="pill ${x.sla.pass ? "pass" : "fail"}">${x.sla.pass ? "PASS" : "FAIL"}</span>` : ""}</td>` : ""}</tr>`).join("")}
          </tbody></table></div>
          <div class="hint" style="margin-top:6px">Seconds · click a transaction for its details</div></div>
        <div class="card" data-ckey="findings"><h3>Findings</h3>
          ${issues.length ? issues.slice(0, 5).map((f) => findingHtml(f, true)).join("") : `<div class="na">No significant issues — see Insights for every check.</div>`}
        </div>
      </div>
      <div class="card" data-ckey="details" data-collapsed="1"><h3>Test details — scenario, schedule, machines</h3>
        <div class="facts-grid">
          <div><h4>Test</h4><table class="t kv"><tbody>
            ${facts.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join("")}
          </tbody></table></div>
          <div><h4>Schedule — planned vs actual</h4><table class="t"><thead><tr><th>Phase</th><th>Planned</th><th>Actual</th></tr></thead><tbody>
            ${fmt.scheduleRows(m).map((r) => `<tr><td>${esc(r.phase)}</td><td>${esc(r.planned)}</td><td>${esc(r.actual)}</td></tr>`).join("")}
          </tbody></table>
          <h4 style="margin-top:12px">Machines</h4><div class="table-wrap"><table class="t"><thead><tr><th>Host</th><th class="num">VUsers</th><th class="num">CPU peak</th><th class="num">Mem peak</th></tr></thead><tbody>
            ${m.lgs.map((l) => `<tr><td>${esc(l.name)} ${l.role === "controller" ? '<span class="pill info">Controller</span>' : l.vusers ? "" : '<span class="pill info">no VUsers</span>'}</td><td class="num">${l.vusers}</td><td class="num">${pctCell(l.cpuPeak)}</td><td class="num">${pctCell(l.memPeak)}</td></tr>`).join("")}
          </tbody></table></div></div>
        </div>
      </div>`;
    const el = $("#ov-load", p);
    el._build = (o) => C.load(state.model, o);
    mount(el, el._build({ dark: state.dark, noTitle: true }), "load");
    $$("[data-goto]", p).forEach((b) => { b.onclick = () => openTab(b.dataset.goto); });
    $$("tr.click", p).forEach((tr) => { tr.onclick = () => openDrawer(+tr.dataset.id); });
    bindFindingLinks(p);
  }
  /** CPU / memory peak cell: red from 85 % (the usual warning level). */
  function pctCell(v) { return v == null ? "-" : `<span class="${v >= 85 ? "bad-txt" : ""}">${v.toFixed(0)} %</span>`; }

  // ── Transactions ────────────────────────────────────────────────────────────
  // s = the figures shown (t.full or t.steady); the window keeps passed in s.count and failed in s.fail
  const passOf = (t, s) => (s === t.full ? t.pass : s.count);
  const failOf = (t, s) => (s === t.full ? t.fail : s.fail || 0);
  const failPctOf = (t, s) => { const p = passOf(t, s), f = failOf(t, s); return p + f ? (f / (p + f)) * 100 : null; };
  const TX_COLS = [
    { k: "name", h: "Transaction" }, { k: "count", h: "Count", num: 1, f: (t, s) => fmt.int(s === t.full ? t.count : s.count + (s.fail || 0)), v: (t, s) => (s === t.full ? t.count : s.count + (s.fail || 0)) },
    // pass / fail follow the view (whole test or the analysis window), like every other column
    { k: "pass", h: "Pass", num: 1, f: (t, s) => fmt.int(passOf(t, s)), v: (t, s) => passOf(t, s) },
    { k: "fail", h: "Fail", num: 1, f: (t, s) => fmt.int(failOf(t, s)), v: (t, s) => failOf(t, s) },
    { k: "failPct", h: "Fail %", num: 1, f: (t, s) => (failPctOf(t, s) == null ? "-" : failPctOf(t, s).toFixed(2)), v: (t, s) => failPctOf(t, s) },
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
        <span class="hint">${which === "steady" && m.window ? `${esc(fmt.relRange(m, m.window.start, m.window.end))} · ` : ""}seconds · click a row for detail${slaCols ? " · type an SLA (s) per transaction" : ""}</span>
      </div>
      ${m.method.percentileMethod === "exact" ? "" : `<div class="method-note warn"><b>How these figures are calculated:</b> ${esc(m.method.summaryBasis)}. ${FEATURES.granularity && m.aggregation && m.aggregation.active ? "Choose “Exact” in Granularity to see every transaction on its own." : "Every figure is calculated from the individual transactions — nothing is averaged into time slots first."} P90 trend: per ${m.timeline.bucketSec} s slot (chart granularity).</div>`}
      <div class="card" data-ckey="txTable"><h3>Transaction summary — ${which === "steady" ? (m.window && !m.window.detected ? "analysis window" : "steady state") : "full run"}</h3><div class="table-wrap"><table class="t" id="tx-table"><thead><tr>
        ${TX_COLS.map((c) => `<th class="sortable ${c.num ? "num" : ""} ${state.sort && state.sort.k === c.k ? "sorted" + (state.sort.asc ? " asc" : "") : ""}" data-k="${c.k}" title="${esc(NT.COLUMNS[c.k] || "")}">${c.h}</th>`).join("")}
        ${slaCols ? `<th class="num" title="${esc(NT.COLUMNS.sla)}">SLA (s)</th><th title="${esc(NT.COLUMNS.result)}">Result</th><th class="num" title="${esc(NT.COLUMNS.apdex)}">Apdex</th>` : ""}<th title="${esc(NT.COLUMNS.trend)}">P90 trend</th>
      </tr></thead><tbody>
        ${rows.map((r) => {
          if (r.group) return `<tr class="group"><td colspan="${TX_COLS.length + (slaCols ? 4 : 1)}">${esc(r.group)}</td></tr>`;
          const t = r.t, s = t[which];
          const sla = slaCols ? `<td class="num"><input class="in-sla" data-tx="${esc(t.name)}" value="${slaPerTx[t.name] != null ? esc(slaPerTx[t.name]) : ""}" placeholder="${m.settings.sla.defaultSec != null && (t.inMap || !m.transactions.some((x) => x.inMap)) ? esc(m.settings.sla.defaultSec) : ""}"></td><td>${t.sla ? `<span class="pill ${t.sla.pass ? "pass" : "fail"}">${t.sla.pass ? "PASS" : "FAIL"}</span>` : ""}</td><td class="num">${t.sla && t.sla.apdex != null ? t.sla.apdex.toFixed(2) : ""}</td>` : "";
          return `<tr class="click ${state.detailTx === t.id ? "selected" : ""}" data-id="${t.id}">${TX_COLS.map((c) => `<td class="${c.num ? "num" : ""}">${c.k === "name" ? esc(state.sort ? t.label || t.name : t.name) + (t.inMap ? "" : ' <span class="pill warn" title="Internal id ' +
            t.id + ' could not be matched to a name">unnamed</span>') : esc(c.f(t, s))}</td>`).join("")}${sla}<td>${spark(downsample(tl.tx[t.id].p90, 60))}</td></tr>`;
        }).join("")}
      </tbody></table></div></div>`;
    $$(".seg button", p).forEach((b) => { b.onclick = () => { state.txView = b.dataset.v; rerender(p); }; });
    const fi = $("#tx-filter", p);
    fi.oninput = () => { state.filter = fi.value; clearTimeout(fi._h); fi._h = setTimeout(() => { rerender(p); const n = $("#tx-filter", p); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 250); };
    $$("th.sortable", p).forEach((th) => { th.onclick = () => { const k = th.dataset.k; state.sort = state.sort && state.sort.k === k ? (state.sort.asc ? null : { k, asc: true }) : { k, asc: false }; rerender(p); }; });
    $$("tr.click", p).forEach((tr) => { tr.onclick = (e) => { if (e.target.tagName === "INPUT") return; openDrawer(+tr.dataset.id); }; });
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
  }
  function rerender(panel) {
    for (const [el, c] of [...state.charts]) if (panel.contains(el)) { if (el._ro) el._ro.disconnect(); killChart(c.chart); state.charts.delete(el); }
    panel.dataset.rendered = "";
    renderTab(panel.id.slice(4));
  }

  // ── transaction details drawer ──────────────────────────────────────────────
  function openDrawer(id) {
    const m = state.model;
    const t = m.transactions.find((x) => x.id === id);
    if (!t) return;
    closeDrawer(true);
    state.detailTx = id;
    $$("tr.click").forEach((tr) => tr.classList.toggle("selected", +tr.dataset.id === id));
    const w = m.window ? t.steady : t.full;
    $("#drawer-title").textContent = t.label || t.name;
    $("#drawer-sub").textContent = `${t.script} · first ${fmt.relWhen(m, t.firstRelSec, true)} · last ${fmt.relWhen(m, t.lastRelSec, true)}${m.aggregation && m.aggregation.active ? " · figures: " + m.aggregation.title : ""}`;
    const kpi = (l, v) => `<div class="kpi"><div class="v" style="font-size:17px">${esc(v)}</div><div class="l">${esc(l)}</div></div>`;
    const lgRows = (t.perLg || []).map((l) => `<tr><td>${esc(l.lg)}</td><td class="num">${fmt.int(l.full.count)}</td><td class="num">${n3(l.full.avg)}</td><td class="num">${n3(l.full.p.p90)}</td><td class="num">${n3(l.full.p.p95)}</td><td class="num">${fmt.int(l.steady.count)}</td><td class="num">${n3(l.steady.avg)}</td><td class="num">${n3(l.steady.p.p90)}</td></tr>`).join("");
    const body = $("#drawer-body");
    body.innerHTML = `<div class="drawer-kpis">
        ${kpi("Count", fmt.int(passOf(t, w) + failOf(t, w)))}${kpi("Failed", fmt.int(failOf(t, w)))}${kpi("Avg", fmt.sec(w.avg))}${kpi("P90", fmt.sec(w.p.p90))}${kpi("P95", fmt.sec(w.p.p95))}${kpi("Max", fmt.sec(w.max))}
      </div>
      <div class="hint" style="margin:-4px 0 10px">${m.window ? `Figures for the ${m.window.detected ? "steady state" : "analysis window"}: ${esc(fmt.relRange(m, m.window.start, m.window.end))}` : "Figures for the whole test"} · seconds</div>
      <div id="txd-charts"></div>
      <div class="card" data-ckey="lg"><h3>Per load generator</h3><div class="table-wrap"><table class="t"><thead><tr><th>Load generator</th><th class="num">Count</th><th class="num">Avg</th><th class="num">P90</th><th class="num">P95</th><th class="num">Window count</th><th class="num">Window avg</th><th class="num">Window P90</th></tr></thead><tbody>${lgRows}</tbody></table></div></div>`;
    const g = $("#txd-charts", body);
    chartCard(g, "Over time — average, P90, P95, max", (o) => {
      const mm = state.model;
      const opt = C.rtOverTime(mm, [id], "p90", o);
      if (!opt) return null;
      const sr = mm.timeline.tx[id], bs = mm.timeline.bucketSec;
      const xy = (a) => a.map((v, b) => [b * bs, v]);
      opt.series = [
        { name: "Average", type: "line", showSymbol: false, data: xy(sr.avg), markArea: opt.series[0].markArea },
        { name: "P90", type: "line", showSymbol: false, data: xy(sr.p90) }, { name: "P95", type: "line", showSymbol: false, data: xy(sr.p95) },
        { name: "Max", type: "line", showSymbol: false, lineStyle: { width: 1, type: "dotted" }, data: xy(sr.max) },
      ];
      return opt;
    }, "txTime");
    chartCard(g, "Distribution of response times (every transaction)", (o) => C.distribution(state.model, id, o), "dist");
    const heatCard = chartCard(g, "Latency heatmap", () => null, "latencyHeat", "tall");
    heatCard.dataset.collapsed = "1";
    $(".chart", heatCard).innerHTML = `<div class="na">Loading…</div>`;
    worker().postMessage({ type: "latency", ids: [id], cols: 240, rows: 40, target: "detail" });
    state.pendingHeat = $(".chart", heatCard);
    enhanceCards(body, "drawer");
    $("#drawer").hidden = false;
    $("#drawer-backdrop").hidden = false;
    $("#drawer-close").focus();
  }
  function closeDrawer(keepOpen) {
    const body = $("#drawer-body");
    for (const [el, c] of [...state.charts]) if (body.contains(el)) { if (el._ro) el._ro.disconnect(); killChart(c.chart); state.charts.delete(el); }
    body.innerHTML = "";
    if (keepOpen) return;
    $("#drawer").hidden = true;
    $("#drawer-backdrop").hidden = true;
    state.detailTx = null;
    $$("tr.click.selected").forEach((tr) => tr.classList.remove("selected"));
  }
  $("#drawer-close").onclick = () => closeDrawer();
  $("#drawer-backdrop").onclick = () => closeDrawer();
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !$("#drawer").hidden) closeDrawer(); });

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
          <span class="hint">Each point = ${esc(m.granularity ? `${m.granularity.sec}` : String(m.timeline.bucketSec))} s of the test · drag the slider or scroll inside a chart to zoom · the shaded band is the analysis window</span></div>
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
    if (state.scrollTo) { const el = $(`[data-chart="${state.scrollTo}"]`, p); state.scrollTo = null; if (el) setTimeout(() => { if (el.classList.contains("collapsed")) setCard(el, false, true); el.scrollIntoView({ behavior: "smooth", block: "start" }); }, 50); }
  }

  // ── Errors ──────────────────────────────────────────────────────────────────
  function errors(p) {
    const m = state.model;
    if (!m.errors) { p.innerHTML = `<div class="card"><div class="na">No error data — SqliteDb.db was not found in the results.</div></div>`; return; }
    const off = m.meta.localOffsetSec;
    p.innerHTML = `<div class="card" data-ckey="errGroups"><h3>${fmt.int(m.errors.total)} error(s), grouped</h3><div class="sub" hidden>Numbers, GUIDs and hex IDs in messages are replaced so similar errors group together. Times are local.</div>
      <div class="table-wrap"><table class="t"><thead><tr><th class="num">Count</th><th>Code</th><th>Message</th><th>Script</th><th class="num">VUsers</th><th>Load generator</th><th>First</th><th>Last</th></tr></thead><tbody>
      ${m.errors.summary.map((g) => `<tr><td class="num">${fmt.int(g.count)}</td><td>${esc(g.code)}</td><td title="${esc("General form: " + g.pattern)}">${esc(g.example)}</td><td>${esc(g.script || "-")}</td><td class="num">${g.vusers.length}</td><td title="${esc(g.injectors.join(", "))}">${g.injectors.length === 1 ? esc(g.injectors[0]) : g.injectors.length + " machines"}</td>
        <td>${g.firstUtc != null ? esc(fmt.when(g.firstUtc, off, true)) : "-"}</td><td>${g.lastUtc != null ? esc(fmt.when(g.lastUtc, off, true)) : "-"}</td></tr>`).join("") || `<tr><td colspan="8" class="na">No errors were logged.</td></tr>`}
      </tbody></table></div></div>
      <div id="err-chart"></div>
      <div class="card" data-ckey="errLog"><h3>Error log</h3><div class="tx-controls"><input id="err-q" placeholder="Search message, code, script, VUser, load generator…" style="min-width:320px"><span class="hint" id="err-n"></span></div>
      <div class="table-wrap" style="max-height:520px;overflow:auto"><table class="t"><thead><tr><th>Time (local)</th><th>Code</th><th>Message</th><th>Script</th><th>VUser</th><th>Load generator</th><th class="num">Iteration</th></tr></thead><tbody id="err-rows"></tbody></table></div></div>`;
    chartCard($("#err-chart", p), "Errors over time", (o) => C.errorsOverTime(state.model, o), "errors");
    const draw = () => {
      const q = $("#err-q", p).value.toLowerCase();
      const rows = m.errors.rows.filter((e) => !q || [e.message, e.code, e.vuser, e.injector, e.script, e.action].join(" ").toLowerCase().includes(q));
      $("#err-n", p).textContent = `${fmt.int(rows.length)} row(s)${rows.length > 1000 ? " — first 1,000 shown" : ""}${m.errors.rowsTruncated ? " · log truncated to 20,000 rows (all rows are in the Excel export)" : ""}`;
      $("#err-rows", p).innerHTML = rows.slice(0, 1000).map((e) => `<tr><td style="white-space:nowrap">${esc(e.utc != null ? fmt.when(e.utc, off, true) + ":" + fmt.localTime(e.utc, off).slice(17) : e.time)}</td><td>${esc(e.code)}</td><td>${esc(e.message)}</td><td>${esc(e.script)}</td><td>${esc(e.vuser)}</td><td>${esc(e.injector)}</td><td class="num">${esc(e.iteration)}</td></tr>`).join("");
    };
    $("#err-q", p).oninput = () => { clearTimeout(draw._h); draw._h = setTimeout(draw, 200); };
    draw();
  }

  // ── Workload ────────────────────────────────────────────────────────────────
  function workload(p) {
    const m = state.model;
    const short = (h) => String(h || "").split(".")[0];
    const early = new Set(((m.lifecycle && m.lifecycle.earlyExits) || []).map((v) => `${v.group}|${v.vuser}`));
    const earlyBy = {};
    for (const v of (m.lifecycle && m.lifecycle.earlyExits) || []) earlyBy[String(v.script).toLowerCase()] = (earlyBy[String(v.script).toLowerCase()] || 0) + 1;
    const anyEarly = early.size > 0;
    const sum = (f) => m.workload.reduce((a, s) => a + (f(s) || 0), 0);
    const planned = sum((s) => s.iterationsExpected), achieved = sum((s) => s.iterationsAchieved);
    const achievedPill = (a, e) => (e ? `<span class="pill ${a / e >= 0.95 && a / e <= 1.05 ? "ok" : "warn"}">${((a / e) * 100).toFixed(0)} %</span>` : "-");
    const hasIp = m.lgs.some((l) => l.ip);
    const role = (l) => (l.role === "controller" ? "Controller" : l.vusers ? "Load generator" : "Monitored host");
    p.innerHTML = `<div class="card" data-ckey="wlScripts"><h3>Workload design — scripts, VUsers, pacing and iterations</h3><div class="table-wrap"><table class="t"><thead><tr><th>Script</th><th>Protocol</th><th class="num">VUsers</th><th>Load generators</th><th>Pacing</th><th>Think time</th><th class="num">Iterations planned</th><th class="num">Achieved</th><th class="num">Achieved %</th><th class="num" title="Transactions defined in the script">Transactions in script</th>${anyEarly ? '<th class="num">Stopped early</th>' : ""}</tr></thead><tbody>
      ${m.workload.map((s) => `<tr><td>${esc(s.key)}${s.groups.length && s.groups.join() !== s.key ? `<div class="hint">${esc(s.groups.join(", "))}</div>` : ""}</td><td>${esc(s.protocol || "-")}</td><td class="num">${s.vusers}</td>
        <td title="${esc(s.loadGenerators.map((l) => `${l.name} (${l.vusers})`).join(", "))}">${esc(s.loadGenerators.map((l) => `${short(l.name)} (${l.vusers})`).join(", ") || "-")}</td>
        <td>${esc(s.pacing ? s.pacing.text : "-")}</td><td>${esc(s.thinkTime ? s.thinkTime.text : "-")}</td><td class="num">${s.iterationsExpected != null ? fmt.int(s.iterationsExpected) : "-"}</td><td class="num">${fmt.int(s.iterationsAchieved)}</td>
        <td class="num">${achievedPill(s.iterationsAchieved, s.iterationsExpected)}</td><td class="num">${s.transactions.length}</td>${anyEarly ? `<td class="num">${earlyBy[String(s.key).toLowerCase()] ? `<span class="pill warn">${earlyBy[String(s.key).toLowerCase()]}</span>` : ""}</td>` : ""}</tr>`).join("")}
      </tbody><tfoot><tr><td>Total — ${m.workload.length} script${m.workload.length === 1 ? "" : "s"}</td><td></td><td class="num">${fmt.int(sum((s) => s.vusers))}</td><td></td><td></td><td></td><td class="num">${planned ? fmt.int(planned) : "-"}</td><td class="num">${fmt.int(achieved)}</td><td class="num">${achievedPill(achieved, planned)}</td><td></td>${anyEarly ? `<td class="num">${early.size}</td>` : ""}</tr></tfoot></table></div></div>
      <div class="card" data-ckey="wlLgs"><h3>Load generators — VUsers and resource usage</h3><div class="table-wrap"><table class="t"><thead><tr><th>Host</th>${hasIp ? "<th>IP</th>" : ""}<th>Role</th><th class="num">VUsers</th><th>Scripts</th><th class="num">CPU peak</th><th class="num">Memory peak</th></tr></thead><tbody>
      ${m.lgs.map((l) => `<tr><td>${esc(l.name)}</td>${hasIp ? `<td>${esc(l.ip || "-")}</td>` : ""}<td>${role(l)}</td><td class="num">${fmt.int(l.vusers)}</td>
        <td>${l.scripts.length ? `<details class="mini"><summary>${l.scripts.length} script${l.scripts.length === 1 ? "" : "s"}</summary><div class="hint">${esc(l.scripts.join(" · "))}</div></details>` : "-"}</td>
        <td class="num">${pctCell(l.cpuPeak)}</td><td class="num">${pctCell(l.memPeak)}</td></tr>`).join("")}
      </tbody></table></div></div>
      <div class="card" data-ckey="wlVusers"><h3>VUsers — when each one ran, and what it completed</h3><div class="table-wrap" style="max-height:480px;overflow:auto"><table class="t"><thead><tr><th class="num">VUser</th><th>Script</th><th>Load generator</th><th>Started</th><th>Stopped</th><th class="num">Ran for</th><th class="num">Iterations</th><th class="num" title="Transactions this VUser completed">Transactions run</th><th class="num">Avg RT (s)</th></tr></thead><tbody>
      ${m.vusers.map((v) => `<tr><td class="num">${v.vuser}</td><td>${esc(v.script)}</td><td title="${esc(v.lg)}">${esc(short(v.lg))}</td><td>${esc(fmt.relWhen(m, v.runRelSec, true))}</td>
        <td>${esc(fmt.relWhen(m, v.exitRelSec, true))}${early.has(`${v.group}|${v.vuser}`) ? ' <span class="pill warn" title="Stopped before the ramp-down">early</span>' : ""}</td>
        <td class="num">${v.runRelSec != null && v.exitRelSec != null ? esc(fmt.dur(v.exitRelSec - v.runRelSec)) : "-"}</td><td class="num">${fmt.int(v.iterations)}</td><td class="num">${fmt.int(v.samples)}</td><td class="num">${n3(v.avgRt)}</td></tr>`).join("")}
      </tbody></table></div></div>`;
  }

  // ── Insights ────────────────────────────────────────────────────────────────
  function findingHtml(f, compact) {
    const show = (v) => (typeof v === "number" ? String(+v.toFixed(4)) : Array.isArray(v) ? (v.every((x) => typeof x !== "object") ? v.slice(0, 8).join(", ") + (v.length > 8 ? " …" : "") : null) : v && typeof v === "object" ? null : String(v));
    const ev = f.evidence ? Object.entries(f.evidence).map(([k, v]) => [k, show(v)]).filter(([, v]) => v != null && v !== "").map(([k, v]) => `${k}: ${v}`).join(" · ").slice(0, 400) : "";
    return `<div class="finding ${f.severity}"><div class="ft"><span class="pill ${f.severity}">${fmt.SEVERITY[f.severity].label}</span> ${esc(f.title)}</div>
      <div class="fx${compact ? " clamp" : ""}">${esc(f.text)}</div>${ev && !compact ? `<details class="ev-wrap"><summary>Evidence (numbers behind this finding)</summary><div class="ev">${esc(ev)}</div></details>` : ""}${f.chart ? `<button class="go" data-chart="${esc(f.chart)}">Show chart →</button>` : ""}</div>`;
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
    const counts = groups.map((s) => [s, ins.findings.filter((f) => f.severity === s).length]).filter(([, n]) => n);
    p.innerHTML = `<div class="verdict-banner ${ins.verdict.status}"><span>${esc(ins.verdict.text)}</span>
        <span class="vb-counts">${counts.map(([s, n]) => `<span class="pill ${s}">${n} ${fmt.SEVERITY[s].label.toLowerCase()}</span>`).join("")}</span></div>
      ${explainHtml("insights")}
      ${groups.map((s) => ins.findings.filter((f) => f.severity === s).map(findingHtml).join("")).join("") || '<div class="na">No findings.</div>'}`;
    bindFindingLinks(p);
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
        killChart(ch);
        const bin = atob(url.split(",")[1]);
        const data = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) data[i] = bin.charCodeAt(i);
        out[c.key] = { data, url, width: 1000, height: h };
      }
    } finally { host.remove(); }
    return out;
  }

  const EXPORTS = {
    async xlsx() {
      await loadScript("ra/vendor/exceljs.min.js");
      await loadScript("ra/report/xlsx.js");
      const buf = await L.xlsx.buildWorkbook(state.model, window.ExcelJS, { images: await pngCharts() }).xlsx.writeBuffer();
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
