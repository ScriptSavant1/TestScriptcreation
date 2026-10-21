/**
 * charts.js — ECharts option builders shared by the dashboard (canvas), the PDF/HTML report
 * (SVG, server-side rendering in the CLI or browser) and the Word report (PNG).
 *
 * X axes are relative seconds formatted as the run's LOCAL clock (not the viewer's time zone).
 * Every builder returns null when its data is not available.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./format"));
  else (root.LreRA = root.LreRA || {}).charts = factory(root.LreRA.format);
})(typeof self !== "undefined" ? self : this, function (fmt) {
  "use strict";

  const PALETTE = ["#3b82f6", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16", "#f97316", "#6366f1",
    "#14b8a6", "#eab308", "#a855f7", "#22c55e", "#0ea5e9", "#e11d48"];

  function theme(dark) {
    return dark
      ? { text: "#cbd5e1", sub: "#94a3b8", grid: "#334155", bg: "transparent", band: "rgba(59,130,246,0.10)", band2: "rgba(148,163,184,0.08)", tooltipBg: "#1e293b" }
      : { text: "#1e293b", sub: "#475569", grid: "#e2e8f0", bg: "transparent", band: "rgba(59,130,246,0.08)", band2: "rgba(100,116,139,0.06)", tooltipBg: "#ffffff" };
  }

  function clockOf(m) {
    const off = (m.meta && m.meta.localOffsetSec) || 0, start = m.meta && m.meta.startUtc;
    return (rel, withSec) => {
      if (start == null) return fmt.hms(rel);
      const d = new Date((start + rel + off) * 1000);
      const s = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
      return withSec ? s + ":" + String(d.getUTCSeconds()).padStart(2, "0") : s;
    };
  }

  function base(m, o, title, extra) {
    const t = theme(o.dark);
    const clock = clockOf(m);
    return Object.assign({
      backgroundColor: t.bg,
      animation: !o.static,
      color: PALETTE,
      textStyle: { color: t.text, fontFamily: "Inter, Segoe UI, system-ui, sans-serif" },
      title: o.noTitle ? undefined : { text: title, left: 8, top: 4, textStyle: { fontSize: 13, fontWeight: 600, color: t.text } },
      grid: { left: 60, right: 60, top: o.noTitle ? 50 : 60, bottom: o.static ? 40 : 64, containLabel: false },
      tooltip: { trigger: "axis", backgroundColor: t.tooltipBg, borderColor: t.grid, textStyle: { color: t.text, fontSize: 12 } },
      legend: { type: "scroll", top: o.noTitle ? 2 : 26, left: 8, right: 90, textStyle: { color: t.sub, fontSize: 11 } },
      xAxis: {
        type: "value", min: 0, max: m.timeline ? m.timeline.buckets * m.timeline.bucketSec : undefined,
        axisLabel: { color: t.sub, formatter: (v) => clock(v) }, axisLine: { lineStyle: { color: t.grid } }, splitLine: { show: false },
        axisPointer: { label: { formatter: (p) => `${fmt.relWhen(m, p.value, true)}:${clock(p.value, true).slice(6)}` } },
      },
      dataZoom: o.static ? undefined : [{ type: "inside", xAxisIndex: 0 }, { type: "slider", xAxisIndex: 0, height: 18, bottom: 8, textStyle: { color: t.sub }, labelFormatter: (v) => clock(v) }],
      toolbox: o.static ? undefined : { right: 8, top: 0, feature: { saveAsImage: { title: "PNG", pixelRatio: 2 }, dataZoom: { title: { zoom: "Zoom", back: "Reset" }, yAxisIndex: "none" } }, iconStyle: { borderColor: t.sub } },
    }, extra || {});
  }

  const yAxis = (o, name, extra) => {
    const t = theme(o.dark);
    return Object.assign({ type: "value", name, nameTextStyle: { color: t.sub, fontSize: 11 }, axisLabel: { color: t.sub }, splitLine: { lineStyle: { color: t.grid } } }, extra || {});
  };

  /** Phase bands (ramp-up / steady / ramp-down) + analysis window, as markArea on a series. */
  function phaseBands(m, o) {
    const t = theme(o.dark);
    const p = m.phases;
    const areas = [];
    if (p && p.rampUpEndRelSec != null) areas.push([{ xAxis: 0, name: "Ramp-up", itemStyle: { color: t.band2 } }, { xAxis: p.rampUpEndRelSec }]);
    if (p && p.rampDownStartRelSec != null && p.lastExitRelSec != null) areas.push([{ xAxis: p.rampDownStartRelSec, name: "Ramp-down", itemStyle: { color: t.band2 } }, { xAxis: p.lastExitRelSec }]);
    if (m.window) areas.push([{ xAxis: m.window.start, name: m.window.detected ? "Steady state" : "Analysis window", itemStyle: { color: t.band } }, { xAxis: m.window.end }]);
    return { silent: true, label: { color: t.sub, fontSize: 10, position: "insideTop" }, data: areas };
  }

  const xy = (m, arr) => arr.map((v, b) => [b * m.timeline.bucketSec, v]);

  // ── charts ─────────────────────────────────────────────────────────────
  function load(m, o) {
    o = o || {};
    if (!m.timeline) return null;
    const series = [];
    if (m.timeline.vusers) series.push({ name: "Running VUsers", type: "line", step: "end", showSymbol: false, areaStyle: { opacity: 0.15 }, data: xy(m, m.timeline.vusers), markArea: phaseBands(m, o) });
    series.push({ name: "Transactions/s", type: "line", yAxisIndex: 1, showSymbol: false, smooth: false, data: xy(m, m.timeline.totalTps), markArea: series.length ? undefined : phaseBands(m, o) });
    if (m.timeline.errors && m.timeline.errors.some((v) => v)) series.push({ name: "Errors", type: "bar", yAxisIndex: 2, barMaxWidth: 6, itemStyle: { color: "#ef4444" }, data: xy(m, m.timeline.errors) });
    const opt = base(m, o, "Load and throughput");
    opt.yAxis = [yAxis(o, "VUsers", { minInterval: 1 }), yAxis(o, "TPS", { splitLine: { show: false } }), yAxis(o, "Errors", { show: false, minInterval: 1 })];
    opt.series = series;
    return opt;
  }

  /** Response time over time — metric: avg | p50 | p90 | p95 | p99 | max */
  function rtOverTime(m, ids, metric, o) {
    o = o || {};
    if (!m.timeline || !ids.length) return null;
    const names = new Map(m.transactions.map((t) => [t.id, t.label || t.name]));
    const opt = base(m, o, `Response time over time — ${metric === "avg" ? "average" : metric.toUpperCase()}`);
    opt.yAxis = [yAxis(o, "seconds")];
    opt.tooltip.valueFormatter = (v) => (v == null ? "-" : `${Number(v).toFixed(3)} s`);
    opt.series = ids.map((id, i) => ({
      name: names.get(id), type: "line", showSymbol: false, connectNulls: false, sampling: "lttb",
      data: xy(m, m.timeline.tx[id][metric]), markArea: i === 0 ? phaseBands(m, o) : undefined,
    }));
    return opt;
  }

  function tpsPerTx(m, ids, o) {
    o = o || {};
    if (!m.timeline || !ids.length) return null;
    const bs = m.timeline.bucketSec;
    const names = new Map(m.transactions.map((t) => [t.id, t.label || t.name]));
    const opt = base(m, o, "Transactions per second");
    opt.yAxis = [yAxis(o, "TPS")];
    opt.tooltip.valueFormatter = (v) => (v == null ? "-" : Number(v).toFixed(3));
    opt.series = ids.map((id, i) => ({ name: names.get(id), type: "line", showSymbol: false, data: xy(m, m.timeline.tx[id].count.map((c) => c / bs)), markArea: i === 0 ? phaseBands(m, o) : undefined }));
    return opt;
  }

  /** Latency heatmap (time × response-time band, counts). heat = store.latencyHeat output. */
  function latencyHeat(m, heat, o, title) {
    o = o || {};
    if (!heat || !heat.cells || !heat.cells.length) return null;
    const t = theme(o.dark);
    const clock = clockOf(m);
    const xs = Array.from({ length: heat.cols }, (_, c) => clock(c * heat.colSec));
    const ys = heat.edgesSec.slice(0, -1).map((e, r) => `${fmt.sec(e)}–${fmt.sec(heat.edgesSec[r + 1])}`);
    const max = Math.max(...heat.cells.map((c) => c[2]));
    return {
      backgroundColor: t.bg, animation: !o.static,
      textStyle: { color: t.text, fontFamily: "Inter, Segoe UI, system-ui, sans-serif" },
      title: o.noTitle ? undefined : { text: title || "Latency heatmap (samples per time × response-time band)", left: 8, top: 4, textStyle: { fontSize: 13, fontWeight: 600, color: t.text } },
      tooltip: { position: "top", backgroundColor: t.tooltipBg, textStyle: { color: t.text }, formatter: (p) => `${xs[p.value[0]]} · ${ys[p.value[1]]}<br/>${p.value[2]} samples` },
      grid: { left: 110, right: 70, top: 44, bottom: o.static ? 40 : 60 },
      xAxis: { type: "category", data: xs, axisLabel: { color: t.sub }, splitArea: { show: false } },
      yAxis: { type: "category", data: ys, axisLabel: { color: t.sub, fontSize: 10, interval: Math.max(0, Math.floor(ys.length / 10) - 1) } },
      visualMap: { type: "continuous", min: 1, max: Math.max(2, max), calculable: !o.static, orient: "vertical", right: 4, top: 44, itemHeight: 140, textStyle: { color: t.sub },
                   inRange: { color: o.dark ? ["#1e3a8a", "#2563eb", "#f59e0b", "#ef4444"] : ["#dbeafe", "#60a5fa", "#f59e0b", "#dc2626"] } },
      dataZoom: o.static ? undefined : [{ type: "inside", xAxisIndex: 0 }, { type: "slider", xAxisIndex: 0, height: 16, bottom: 6 }],
      series: [{ type: "heatmap", data: heat.cells.filter((c) => c[2] > 0), progressive: 4000 }],
    };
  }

  /** Distribution (log bins) + cumulative % for one transaction. */
  function distribution(m, id, o) {
    o = o || {};
    const t = m.transactions.find((x) => x.id === id);
    if (!t || !t.distribution || !t.distribution.length) return null;
    const th = theme(o.dark);
    const total = t.distribution.reduce((a, d) => a + d[2], 0);
    let acc = 0;
    const cum = t.distribution.map((d) => { acc += d[2]; return +(acc / total * 100).toFixed(2); });
    const labels = t.distribution.map((d) => fmt.sec(d[0]));
    const marks = ["p50", "p90", "p95", "p99"].map((k) => ({ k, v: t.full.p[k] })).filter((x) => x.v != null).map((x) => ({
      name: x.k.toUpperCase(), xAxis: Math.max(0, t.distribution.findIndex((d) => x.v >= d[0] && x.v < d[1])),
      label: { formatter: `${x.k.toUpperCase()} ${fmt.sec(x.v)}`, color: th.sub, fontSize: 10 },
    }));
    return {
      backgroundColor: th.bg, animation: !o.static, color: PALETTE,
      textStyle: { color: th.text, fontFamily: "Inter, Segoe UI, system-ui, sans-serif" },
      title: o.noTitle ? undefined : { text: `Response-time distribution — ${t.label || t.name}`, left: 8, top: 4, textStyle: { fontSize: 13, fontWeight: 600, color: th.text } },
      tooltip: { trigger: "axis", backgroundColor: th.tooltipBg, textStyle: { color: th.text } },
      legend: { top: o.noTitle ? 2 : 26, left: 8, right: 70, textStyle: { color: th.sub } },
      grid: { left: 60, right: 60, top: 56, bottom: 50 },
      xAxis: { type: "category", data: labels, name: "response time (log bands)", nameLocation: "middle", nameGap: 30, nameTextStyle: { color: th.sub }, axisLabel: { color: th.sub, fontSize: 10 } },
      yAxis: [yAxis(o, "samples"), yAxis(o, "cumulative %", { max: 100, splitLine: { show: false } })],
      series: [
        { name: "Samples", type: "bar", data: t.distribution.map((d) => d[2]), markLine: { symbol: "none", lineStyle: { type: "dashed", color: "#ef4444" }, data: marks } },
        { name: "Cumulative %", type: "line", yAxisIndex: 1, showSymbol: false, data: cum },
      ],
    };
  }

  /** Throughput vs response time per bucket (saturation knee). */
  function tpsVsRt(m, o) {
    o = o || {};
    if (!m.timeline) return null;
    const ids = m.transactions.filter((t) => t.full.count).map((t) => t.id);
    const pts = [];
    for (let b = 0; b < m.timeline.buckets; b++) {
      let n = 0, w = 0;
      for (const id of ids) { const s = m.timeline.tx[id]; if (s.count[b] && s.p90[b] != null) { n += s.count[b]; w += s.count[b] * s.p90[b]; } }
      if (n) pts.push([m.timeline.totalTps[b], w / n, m.timeline.vusers ? m.timeline.vusers[b] : 0, b * m.timeline.bucketSec]);
    }
    if (!pts.length) return null;
    const th = theme(o.dark);
    const clock = clockOf(m);
    return {
      backgroundColor: th.bg, animation: !o.static, color: PALETTE,
      textStyle: { color: th.text, fontFamily: "Inter, Segoe UI, system-ui, sans-serif" },
      title: o.noTitle ? undefined : { text: "Throughput vs response time (each point = one time bucket)", left: 8, top: 4, textStyle: { fontSize: 13, fontWeight: 600, color: th.text } },
      tooltip: { backgroundColor: th.tooltipBg, textStyle: { color: th.text }, formatter: (p) => `${clock(p.value[3], true)}<br/>TPS ${p.value[0].toFixed(3)} · P90 ${p.value[1].toFixed(3)} s · ${p.value[2]} VUsers` },
      grid: { left: 60, right: 90, top: 44, bottom: 50 },
      xAxis: yAxis(o, "TPS", { nameLocation: "middle", nameGap: 28 }),
      yAxis: yAxis(o, "weighted P90 (s)"),
      visualMap: m.timeline.vusers ? { dimension: 2, min: 0, max: Math.max(1, ...m.timeline.vusers), right: 4, top: 44, itemHeight: 120, text: ["VUsers", ""], textStyle: { color: th.sub }, inRange: { color: ["#93c5fd", "#1d4ed8"] } } : undefined,
      series: [{ type: "scatter", symbolSize: 6, data: pts, large: pts.length > 2000 }],
    };
  }

  function errorsOverTime(m, o) {
    o = o || {};
    if (!m.timeline || !m.timeline.errors || !m.errors || !m.errors.total) return null;
    const bs = m.timeline.bucketSec, nb = m.timeline.buckets;
    const top = m.errors.summary.slice(0, 6);
    const key = (r) => `${r.code}|${r.script || ""}`;
    const idx = new Map(top.map((g, i) => [`${g.code}|${g.script || ""}`, i]));
    const series = top.map((g) => ({ name: `${g.code}: ${g.pattern.slice(0, 40)}`, type: "bar", stack: "e", barMaxWidth: 10, data: new Array(nb).fill(0) }));
    const other = { name: "Other", type: "bar", stack: "e", barMaxWidth: 10, data: new Array(nb).fill(0) };
    for (const r of m.errors.rows) {
      if (r.relSec == null) continue;
      const b = Math.floor(r.relSec / bs);
      if (b < 0 || b >= nb) continue;
      const i = idx.get(key(r));
      (i == null ? other : series[i]).data[b]++;
    }
    if (other.data.some((v) => v)) series.push(other);
    for (const s of series) s.data = xy(m, s.data);
    // overall weighted P90 overlay
    const ids = m.transactions.map((t) => t.id);
    const rt = [];
    for (let b = 0; b < nb; b++) { let n = 0, w = 0; for (const id of ids) { const s = m.timeline.tx[id]; if (s.count[b] && s.p90[b] != null) { n += s.count[b]; w += s.count[b] * s.p90[b]; } } rt.push(n ? w / n : null); }
    series.push({ name: "Weighted P90 (s)", type: "line", yAxisIndex: 1, showSymbol: false, lineStyle: { width: 1 }, itemStyle: { color: "#94a3b8" }, data: xy(m, rt) });
    series[0].markArea = phaseBands(m, o);
    const opt = base(m, o, "Errors over time (by code) with response time");
    opt.yAxis = [yAxis(o, "errors", { minInterval: 1 }), yAxis(o, "P90 (s)", { splitLine: { show: false } })];
    opt.series = series;
    return opt;
  }

  /** sum_data rate graphs (http codes, hits, bytes, connections). */
  function graphRole(m, roles, title, unit, o) {
    o = o || {};
    if (!m.timeline || !m.timeline.graphs) return null;
    const gs = m.timeline.graphs.filter((g) => roles.includes(g.role));
    if (!gs.length) return null;
    const opt = base(m, o, title);
    opt.yAxis = [yAxis(o, unit)];
    opt.series = [];
    for (const g of gs) for (const ms of g.measurements) opt.series.push({ name: ms.name, type: "line", showSymbol: false, data: xy(m, ms.avg) });
    if (opt.series.length) opt.series[0].markArea = phaseBands(m, o);
    if (unit === "bytes/s") { opt.tooltip.valueFormatter = (v) => (v == null ? "-" : fmt.bytes(v) + "/s"); opt.yAxis[0].axisLabel.formatter = (v) => fmt.bytes(v); }
    return opt;
  }

  function lgHealth(m, o) {
    o = o || {};
    if (!m.lgHealth || !m.lgHealth.length) return null;
    const opt = base(m, o, "Load-generator CPU and memory (%)");
    opt.yAxis = [yAxis(o, "%", { max: 100 })];
    opt.series = [];
    for (const h of m.lgHealth) for (const k of ["cpu", "memory"]) if (h[k]) opt.series.push({ name: `${h.host} ${k === "cpu" ? "CPU" : "memory"}`, type: "line", showSymbol: false, lineStyle: k === "memory" ? { type: "dashed" } : undefined, data: xy(m, h[k].series) });
    if (opt.series.length) opt.series[0].markLine = { symbol: "none", silent: true, label: { formatter: "{b}", color: "#ef4444", fontSize: 10 }, lineStyle: { color: "#ef4444", type: "dotted" }, data: [{ yAxis: 85, name: "85 %" }, { yAxis: 80, name: "80 %", lineStyle: { color: "#f59e0b" } }] };
    return opt;
  }

  /** P90/P95 per load generator for each transaction (steady when available). */
  function rtPerLg(m, o, metric) {
    o = o || {};
    metric = metric || "p90";
    const txs = m.transactions.filter((t) => t.perLg && t.perLg.length > 1);
    if (!txs.length) return null;
    const lgs = [...new Set(txs.flatMap((t) => t.perLg.map((l) => l.lg)))];
    const th = theme(o.dark);
    return {
      backgroundColor: th.bg, animation: !o.static, color: PALETTE,
      textStyle: { color: th.text, fontFamily: "Inter, Segoe UI, system-ui, sans-serif" },
      title: o.noTitle ? undefined : { text: `${metric.toUpperCase()} per load generator (steady state)`, left: 8, top: 4, textStyle: { fontSize: 13, fontWeight: 600, color: th.text } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: th.tooltipBg, textStyle: { color: th.text }, valueFormatter: (v) => (v == null ? "-" : `${Number(v).toFixed(3)} s`) },
      legend: { top: o.noTitle ? 2 : 26, left: 8, right: 70, textStyle: { color: th.sub } },
      grid: { left: 60, right: 20, top: 56, bottom: 110 },
      xAxis: { type: "category", data: txs.map((t) => t.label || t.name), axisLabel: { color: th.sub, rotate: 35, fontSize: 10 } },
      yAxis: yAxis(o, "seconds"),
      series: lgs.map((lg) => ({ name: lg, type: "bar", data: txs.map((t) => { const r = t.perLg.find((x) => x.lg === lg); return r ? ((r.steady.count ? r.steady : r.full).p[metric] ?? null) : null; }) })),
    };
  }

  function vuserHeat(m, o) {
    o = o || {};
    const h = m.vuserHeat;
    if (!h || !h.values || !h.values.length) return null;
    const th = theme(o.dark);
    const clock = clockOf(m);
    const xs = Array.from({ length: h.cols }, (_, c) => clock(c * h.colSec));
    const data = [];
    let max = 0;
    h.values.forEach((row, r) => row.forEach((v, c) => { if (v != null) { data.push([c, r, +v.toFixed(3)]); if (v > max) max = v; } }));
    const lgOf = new Map((m.vusers || []).map((v) => [v.vuser, v.lg]));
    return {
      backgroundColor: th.bg, animation: !o.static,
      textStyle: { color: th.text, fontFamily: "Inter, Segoe UI, system-ui, sans-serif" },
      title: o.noTitle ? undefined : { text: "Average response time per VUser over time", left: 8, top: 4, textStyle: { fontSize: 13, fontWeight: 600, color: th.text } },
      tooltip: { position: "top", backgroundColor: th.tooltipBg, textStyle: { color: th.text }, formatter: (p) => `VUser ${h.vusers[p.value[1]]} (${lgOf.get(h.vusers[p.value[1]]) || "?"})<br/>${xs[p.value[0]]} · avg ${p.value[2]} s` },
      grid: { left: 70, right: 70, top: 40, bottom: o.static ? 30 : 56 },
      xAxis: { type: "category", data: xs, axisLabel: { color: th.sub } },
      yAxis: { type: "category", data: h.vusers.map((v) => "VU " + v), axisLabel: { color: th.sub, fontSize: 9, interval: Math.max(0, Math.floor(h.vusers.length / 30) - 1) } },
      visualMap: { min: 0, max: Math.max(0.001, max), calculable: !o.static, right: 4, top: 40, itemHeight: 140, textStyle: { color: th.sub }, inRange: { color: o.dark ? ["#0f172a", "#2563eb", "#f59e0b", "#ef4444"] : ["#eff6ff", "#60a5fa", "#f59e0b", "#dc2626"] } },
      dataZoom: o.static ? undefined : [{ type: "inside", xAxisIndex: 0 }, { type: "slider", xAxisIndex: 0, height: 16, bottom: 6 }],
      series: [{ type: "heatmap", data, progressive: 4000 }],
    };
  }

  /** Percentile bars per transaction (+ SLA thresholds when set). */
  function txBars(m, o, which) {
    o = o || {};
    which = which || "steady";
    const txs = m.transactions.filter((t) => t[which] && t[which].count);
    if (!txs.length) return null;
    const th = theme(o.dark);
    const hasSla = txs.some((t) => t.sla);
    const series = [
      { name: "Average", type: "bar", data: txs.map((t) => t[which].avg) },
      { name: "P90", type: "bar", data: txs.map((t) => t[which].p.p90) },
      { name: "P95", type: "bar", data: txs.map((t) => t[which].p.p95) },
    ];
    if (hasSla) series.push({ name: "SLA threshold", type: "scatter", symbol: "rect", symbolSize: [18, 3], itemStyle: { color: "#ef4444" }, data: txs.map((t) => (t.sla ? t.sla.threshold : null)) });
    return {
      backgroundColor: th.bg, animation: !o.static, color: PALETTE,
      textStyle: { color: th.text, fontFamily: "Inter, Segoe UI, system-ui, sans-serif" },
      title: o.noTitle ? undefined : { text: `Response time per transaction (${which === "steady" ? "steady state" : "full run"})`, left: 8, top: 4, textStyle: { fontSize: 13, fontWeight: 600, color: th.text } },
      tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, backgroundColor: th.tooltipBg, textStyle: { color: th.text }, valueFormatter: (v) => (v == null ? "-" : `${Number(v).toFixed(3)} s`) },
      legend: { top: o.noTitle ? 2 : 26, left: 8, right: 70, textStyle: { color: th.sub } },
      grid: { left: 60, right: 20, top: 56, bottom: 110 },
      xAxis: { type: "category", data: txs.map((t) => t.label || t.name), axisLabel: { color: th.sub, rotate: 35, fontSize: 10 } },
      yAxis: yAxis(o, "seconds"),
      series,
    };
  }

  /** Default chart set for reports: [{key, title, option}] */
  function reportSet(m, o) {
    const ids = m.transactions.filter((t) => t.full.count).sort((a, b) => (b.steady.p.p90 || 0) - (a.steady.p.p90 || 0)).slice(0, 8).map((t) => t.id);
    const list = [
      ["load", load(m, o)], ["txBars", txBars(m, o, "steady")], ["rtOverTime", rtOverTime(m, ids, "p90", o)], ["throughput", tpsPerTx(m, ids, o)],
      ["latencyHeat", latencyHeat(m, m.latencyHeat, o)], ["tpsVsRt", tpsVsRt(m, o)], ["errors", errorsOverTime(m, o)],
      ["httpCodes", graphRole(m, ["httpCodes"], "HTTP responses per second", "per second", o)],
      ["bytes", graphRole(m, ["bytesReceived", "throughput"], "Throughput (bytes received)", "bytes/s", o)],
      ["lgHealth", lgHealth(m, o)], ["rtPerLg", rtPerLg(m, o)], ["vuserHeat", vuserHeat(m, o)],
    ];
    return list.filter(([, opt]) => opt).map(([key, option]) => ({ key, option }));
  }

  return { load, rtOverTime, tpsPerTx, latencyHeat, distribution, tpsVsRt, errorsOverTime, graphRole, lgHealth, rtPerLg, vuserHeat, txBars, reportSet, PALETTE, clockOf };
});
