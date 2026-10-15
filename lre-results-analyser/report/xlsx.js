/**
 * xlsx.js — Excel workbook from the result model (Phase 2). ExcelJS is injected, so the same
 * builder runs in the browser (vendored exceljs.min.js) and in the CLI (npm exceljs).
 *
 *   const wb = buildWorkbook(model, ExcelJS);  const buf = await wb.xlsx.writeBuffer();
 *
 * Sheets: 1 Test Overview · 2 Transactions – Full Run · 3 Transactions – Steady State ·
 * 4 Workload Model · 5 Errors · 6 Time Series · 7 LG Health · 8 Insights · 9 Method & Validation
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./format"));
  else (root.LreRA = root.LreRA || {}).xlsx = factory(root.LreRA.format);
})(typeof self !== "undefined" ? self : this, function (fmt) {
  "use strict";

  const BLUE = "FF1E3A8A", HEAD_FILL = "FF1E40AF", SUB_FILL = "FFE0E7FF", ZEBRA = "FFF8FAFC";
  const RED_FILL = "FFFEE2E2", GREEN_FILL = "FFDCFCE7", AMBER_FILL = "FFFEF3C7";
  const SEC = "0.000", INT = "#,##0", RATE = "0.0000", PCT = "0.00%";

  function header(ws, row, cells) {
    const r = ws.getRow(row);
    cells.forEach((c, i) => { r.getCell(i + 1).value = c; });
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.alignment = { vertical: "middle", wrapText: true };
    r.height = 30;
    cells.forEach((_, i) => { r.getCell(i + 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: HEAD_FILL } }; });
    return r;
  }
  function title(ws, text, sub) {
    ws.getCell("A1").value = text;
    ws.getCell("A1").font = { bold: true, size: 14, color: { argb: BLUE } };
    if (sub) { ws.getCell("A2").value = sub; ws.getCell("A2").font = { italic: true, color: { argb: "FF475569" } }; }
  }
  function kv(ws, startRow, pairs, sectionName) {
    let r = startRow;
    if (sectionName) { ws.getCell(r, 1).value = sectionName; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++; }
    for (const [k, v] of pairs) {
      ws.getCell(r, 1).value = k; ws.getCell(r, 1).font = { bold: true };
      ws.getCell(r, 2).value = v == null ? "-" : v;
      r++;
    }
    return r + 1;
  }
  const widths = (ws, list) => list.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  const sAt = (o, k) => (o && o.p ? o.p[k] : null);

  // ── sheet builders ─────────────────────────────────────────────────────
  function overview(wb, m) {
    const ws = wb.addWorksheet("Test Overview", { properties: { tabColor: { argb: BLUE } } });
    const off = m.meta.localOffsetSec;
    title(ws, `Test Overview — ${m.meta.sessionName || "LRE run"}`, `Generated ${m.generatedAt.slice(0, 19).replace("T", " ")} UTC by LRE Results Analyser ${m.engineVersion} — times in ${fmt.zone(off)} unless stated`);
    let r = kv(ws, 4, [
      ["Scenario", m.meta.sessionName], ["Project", m.meta.project], ["Result name", m.meta.resultName],
      ["Controller software", [m.meta.product, m.meta.version].filter(Boolean).join(" ")],
      ["Start (local)", fmt.localTime(m.meta.startUtc, off)], ["End (local)", fmt.localTime(m.meta.stopUtc, off)],
      ["Start (UTC)", fmt.utcTime(m.meta.startUtc)], ["Time zone", fmt.zone(off) + (m.meta.localOffsetConfirmed ? " (confirmed by RunDate)" : " (not confirmed)")],
      ["Duration", fmt.hms(m.meta.durationSec)], ["Start reason", m.meta.startReason], ["Stop reason", m.meta.stopReason],
      ["Scenario type", m.meta.scenarioType], ["Schedule mode", m.meta.scheduleMode], ["Load behaviour", m.meta.loadBehavior],
      ["Schedule (as configured)", m.meta.scheduleText || m.meta.schedule.raw],
    ], "Run");
    r = kv(ws, r, [
      ["VUsers (total)", m.lifecycle ? m.lifecycle.vusers : null], ["Peak running VUsers", m.totals.peakVusers],
      ["Scripts", m.workload.map((s) => `${s.key} (${s.protocol || "?"}, ${s.vusers} VUsers)`).join("; ")],
      ["Load generators", m.lgs.filter((l) => l.vusers).length],
      ["Transactions (samples, full run)", m.totals.samples], ["Transactions (samples, analysis window)", m.totals.samplesSteady],
      ["TPS — full run", m.totals.tpsFull != null ? +m.totals.tpsFull.toFixed(4) : null], ["TPS — analysis window", m.totals.tpsSteady != null ? +m.totals.tpsSteady.toFixed(4) : null],
      ["Passed / failed (sum_data)", m.totals.pass != null ? `${m.totals.pass} / ${m.totals.fail}` : "not available"],
      ["Errors logged", m.totals.errors],
      ["Hits/s avg / peak", m.totals.hitsPerSec ? `${m.totals.hitsPerSec.avg.toFixed(2)} / ${m.totals.hitsPerSec.peak.toFixed(2)}` : "not available"],
      ["Throughput avg / peak", m.totals.throughputBytesPerSec ? `${fmt.bytes(m.totals.throughputBytesPerSec.avg)}/s / ${fmt.bytes(m.totals.throughputBytesPerSec.peak)}/s` : "not available"],
      ["Overall verdict", m.insights ? m.insights.verdict.text : "-"],
    ], "Load and results");

    ws.getCell(r, 1).value = "Schedule — planned vs actual"; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    header(ws, r++, ["Phase", "Planned", "Actual"]);
    for (const s of fmt.scheduleRows(m)) { ws.getRow(r).values = [s.phase, s.planned, s.actual]; r++; }
    r++;
    ws.getCell(r, 1).value = "Load generators and hosts"; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    header(ws, r++, ["Host", "IP", "Role", "VUsers", "Scripts", "CPU peak %", "Memory peak %"]);
    for (const l of m.lgs) { ws.getRow(r).values = [l.name, l.ip || "-", l.role, l.vusers, l.scripts.join("; ") || "-", l.cpuPeak, l.memPeak]; r++; }
    widths(ws, [34, 44, 40, 10, 40, 12, 14]);
    ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
  }

  const TX_COLS = [
    ["Script", 28], ["Transaction", 34], ["Count", 10, INT], ["Pass", 10, INT], ["Fail", 8, INT], ["Fail %", 8, PCT],
    ["Min (s)", 9, SEC], ["Avg (s)", 9, SEC], ["Max (s)", 9, SEC], ["Std Dev (s)", 10, SEC],
    ["P50 (s)", 9, SEC], ["P80 (s)", 9, SEC], ["P85 (s)", 9, SEC], ["P90 (s)", 9, SEC], ["P95 (s)", 9, SEC], ["P99 (s)", 9, SEC],
    ["TPS", 9, RATE], ["SLA (s)", 9, SEC], ["SLA result", 10], ["Apdex", 8, "0.00"],
  ];

  function txSheet(wb, m, which) {
    const name = which === "full" ? "Transactions – Full Run" : "Transactions – Steady State";
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    const win = which === "full" ? `Whole run: ${fmt.hms(m.meta.durationSec)}` :
      m.window ? `${m.window.detected ? "Steady state (detected)" : "Analysis window (user-set)"}: t+${fmt.hms(m.window.start)} → t+${fmt.hms(m.window.end)} (${fmt.relLocal(m, m.window.start)} → ${fmt.relLocal(m, m.window.end)}), ${fmt.hms(m.window.durationSec)}` : "No steady-state window";
    title(ws, name, `${win} · response times in seconds · percentiles: ${m.method.percentile} · pass/fail (whole-run counts): ${m.method.passFail}`);
    header(ws, 4, TX_COLS.map((c) => c[0]));
    ws.autoFilter = { from: { row: 4, column: 1 }, to: { row: 4, column: TX_COLS.length } };
    let r = 5;
    for (const g of fmt.groupByScript(m)) {
      const first = r;
      for (const t of g.rows) {
        const s = t[which];
        const slaRes = which === "steady" && t.sla ? (t.sla.pass ? "PASS" : "FAIL") : "";
        ws.getRow(r).values = [g.script, t.name, s.count, t.pass, t.fail, t.failPct != null ? t.failPct / 100 : null,
          s.min, s.avg, s.max, s.stdDev, sAt(s, "p50"), sAt(s, "p80"), sAt(s, "p85"), sAt(s, "p90"), sAt(s, "p95"), sAt(s, "p99"),
          s.tps, which === "steady" && t.sla ? t.sla.threshold : null, slaRes, which === "steady" && t.sla ? t.sla.apdex : null];
        if ((r - first) % 2) ws.getRow(r).eachCell((c) => { c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: ZEBRA } }; });
        if (slaRes) ws.getCell(r, 19).fill = { type: "pattern", pattern: "solid", fgColor: { argb: slaRes === "PASS" ? GREEN_FILL : RED_FILL } };
        if (t.failPct != null && t.failPct > 1) ws.getCell(r, 6).fill = { type: "pattern", pattern: "solid", fgColor: { argb: t.failPct > 5 ? RED_FILL : AMBER_FILL } };
        r++;
      }
      const sub = ws.getRow(r);
      sub.values = [g.script, "Subtotal", { formula: `SUM(C${first}:C${r - 1})` }, g.rows.some((t) => t.pass != null) ? { formula: `SUM(D${first}:D${r - 1})` } : null,
        g.rows.some((t) => t.fail != null) ? { formula: `SUM(E${first}:E${r - 1})` } : null, null, null, null, null, null, null, null, null, null, null, null,
        { formula: `SUM(Q${first}:Q${r - 1})` }];
      sub.font = { bold: true };
      sub.eachCell({ includeEmpty: true }, (c, i) => { if (i <= TX_COLS.length) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SUB_FILL } }; });
      r += 2;
    }
    TX_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c[1]; if (c[2]) ws.getColumn(i + 1).numFmt = c[2]; });
  }

  function workload(wb, m) {
    const ws = wb.addWorksheet("Workload Model", { views: [{ state: "frozen", ySplit: 3 }] });
    title(ws, "Workload Model", "Per script: run-time settings from the .usp / .cfg / .usr files; VUsers and iterations from _t_rep.eve / RawData.eve");
    header(ws, 3, ["Script", "Script name", "Group(s)", "Protocol", "Language", "VUsers", "Load generators (VUsers)", "Pacing", "Think time",
      "Iterations planned", "Iterations achieved", "Achieved %", "Transactions in script", "Samples"]);
    let r = 4;
    for (const s of m.workload) {
      ws.getRow(r).values = [s.key, s.scriptName, s.groups.join(", "), s.protocol, s.language, s.vusers,
        s.loadGenerators.map((l) => `${l.name} (${l.vusers})`).join("; "), s.pacing ? s.pacing.text : "-", s.thinkTime ? s.thinkTime.text : "-",
        s.iterationsExpected, s.iterationsAchieved, s.iterationsExpected ? s.iterationsAchieved / s.iterationsExpected : null,
        s.transactions.length, s.samples];
      ws.getCell(r, 12).numFmt = PCT;
      r++;
    }
    r += 2;
    ws.getCell(r, 1).value = "Load generator load"; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    header(ws, r++, ["Host", "IP", "Role", "VUsers", "Scripts (VUsers)", "CPU peak %", "Memory peak %"]);
    for (const l of m.lgs) { ws.getRow(r).values = [l.name, l.ip || "-", l.role, l.vusers, l.scripts.join("; "), l.cpuPeak, l.memPeak]; r++; }
    r += 2;
    ws.getCell(r, 1).value = "VUsers"; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    header(ws, r++, ["Group", "VUser", "Script", "Load generator", "Started running (t+)", "Exited (t+)", "Iterations", "Samples", "Avg RT (s)"]);
    for (const v of m.vusers) {
      ws.getRow(r).values = [v.group, v.vuser, v.script, v.lg, fmt.hms(v.runRelSec), fmt.hms(v.exitRelSec), v.iterations, v.samples, v.avgRt];
      ws.getCell(r, 9).numFmt = SEC; r++;
    }
    widths(ws, [30, 28, 24, 12, 12, 8, 40, 30, 26, 12, 12, 11, 12, 12]);
  }

  function errorsSheet(wb, m) {
    const ws = wb.addWorksheet("Errors", { views: [{ state: "frozen", ySplit: 3 }] });
    if (!m.errors) { title(ws, "Errors", "SqliteDb.db not available — no error data"); return; }
    title(ws, `Errors — ${m.errors.total} logged`, "Grouped by code + message pattern (numbers/IDs replaced) + script. Times are local.");
    header(ws, 3, ["Script", "Injector(s)", "Error code", "Message (pattern)", "Example", "Count", "VUsers affected", "First seen", "Last seen", "Actions"]);
    let r = 4;
    for (const g of m.errors.summary) {
      ws.getRow(r).values = [g.script, g.injectors.join(", "), g.code, g.pattern, g.example, g.count, g.vusers.length,
        g.firstUtc != null ? fmt.localTime(g.firstUtc, m.meta.localOffsetSec) : "-", g.lastUtc != null ? fmt.localTime(g.lastUtc, m.meta.localOffsetSec) : "-", g.actions.join(", ")];
      r++;
    }
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 10 } };
    r += 2;
    ws.getCell(r, 1).value = `Error log${m.errors.rowsTruncated ? " (first 20,000 rows)" : ""}`; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    header(ws, r++, ["Time (local)", "t+", "Code", "Message", "Script", "Action", "Injector", "VUser", "Iteration", "Line"]);
    for (const e of m.errors.rows) {
      ws.getRow(r).values = [e.utc != null ? fmt.localTime(e.utc, m.meta.localOffsetSec) : e.time, fmt.hms(e.relSec), e.code, e.message, e.script, e.action, e.injector, e.vuser, e.iteration, e.line];
      r++;
    }
    widths(ws, [26, 30, 11, 70, 60, 8, 12, 20, 20, 16]);
  }

  function timeSeries(wb, m) {
    const ws = wb.addWorksheet("Time Series", { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    const tl = m.timeline;
    title(ws, "Time Series", `One row per ${tl.bucketSec} s bucket. Response times in seconds (bucket percentiles from 2 % histograms).`);
    const txs = m.transactions;
    const graphCols = [];
    for (const g of tl.graphs || []) if (["hits", "bytesReceived", "bytesSent", "httpCodes", "connections", "connectionsPerSec", "throughput"].includes(g.role))
      for (const ms of g.measurements) graphCols.push({ label: `${g.type}: ${ms.name}`, data: ms.avg });
    const cols = ["Time (local)", "t+", "Running VUsers", "Total TPS", "Errors"]
      .concat(txs.flatMap((t) => [`${t.name} count`, `${t.name} avg`, `${t.name} P90`, `${t.name} P95`]))
      .concat(graphCols.map((g) => g.label));
    header(ws, 4, cols);
    for (let b = 0; b < tl.buckets; b++) {
      const rel = b * tl.bucketSec;
      const row = [fmt.relLocal(m, rel), fmt.hms(rel), tl.vusers ? tl.vusers[b] : null, tl.totalTps[b], tl.errors ? tl.errors[b] : null];
      for (const t of txs) { const s = tl.tx[t.id]; row.push(s.count[b], s.avg[b], s.p90[b], s.p95[b]); }
      for (const g of graphCols) row.push(g.data[b]);
      ws.getRow(5 + b).values = row;
    }
    ws.getColumn(1).width = 20; ws.getColumn(2).width = 10;
    for (let c = 3; c <= cols.length; c++) { ws.getColumn(c).width = 12; ws.getColumn(c).numFmt = "0.000"; }
    ws.getColumn(3).numFmt = INT; ws.getColumn(5).numFmt = INT;
  }

  function lgHealth(wb, m) {
    const ws = wb.addWorksheet("LG Health");
    if (!m.lgHealth || !m.lgHealth.length) { title(ws, "LG Health", "No load-generator monitoring in sum_data (graph es_tr_lg_monitoring)"); return; }
    title(ws, "LG Health", "CPU / memory / disk from LRE's load-generator monitor (sum_data). 85 % is the usual warning level.");
    header(ws, 3, ["Host", "IP", "CPU avg %", "CPU peak %", "Memory avg %", "Memory peak %", "Disk avg", "Disk peak"]);
    let r = 4;
    for (const h of m.lgHealth) {
      ws.getRow(r).values = [h.host, h.ip || "-", h.cpu && h.cpu.mean, h.cpu && h.cpu.max, h.memory && h.memory.mean, h.memory && h.memory.max, h.disk && h.disk.mean, h.disk && h.disk.max];
      [4, 6].forEach((c) => { const v = ws.getCell(r, c).value; if (v >= 85) ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED_FILL } }; });
      r++;
    }
    for (let c = 3; c <= 8; c++) ws.getColumn(c).numFmt = "0.0";
    r += 2;
    const cols = ["Time (local)", "t+"];
    const series = [];
    for (const h of m.lgHealth) for (const k of ["cpu", "memory", "disk"]) if (h[k]) { cols.push(`${h.host} ${k}`); series.push(h[k].series); }
    header(ws, r++, cols);
    for (let b = 0; b < m.timeline.buckets; b++) {
      const rel = b * m.timeline.bucketSec;
      ws.getRow(r++).values = [fmt.relLocal(m, rel), fmt.hms(rel)].concat(series.map((s) => s[b]));
    }
    widths(ws, [26, 14, 12, 12, 13, 13, 12, 12]);
  }

  function insightsSheet(wb, m) {
    const ws = wb.addWorksheet("Insights", { views: [{ state: "frozen", ySplit: 4 }] });
    const ins = m.insights || { verdict: { text: "-" }, findings: [] };
    title(ws, `Insights — ${ins.verdict.text}`, "Rule-based checks computed offline from the raw results. Evidence holds the numbers behind each finding.");
    header(ws, 4, ["Severity", "Area", "Finding", "Detail", "Evidence", "Chart"]);
    let r = 5;
    const fills = { high: RED_FILL, medium: AMBER_FILL, good: GREEN_FILL };
    for (const f of ins.findings) {
      ws.getRow(r).values = [fmt.SEVERITY[f.severity].label, f.category, f.title, f.text, f.evidence ? JSON.stringify(f.evidence) : "", f.chart || ""];
      if (fills[f.severity]) ws.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fills[f.severity] } };
      ws.getRow(r).alignment = { wrapText: true, vertical: "top" };
      r++;
    }
    widths(ws, [10, 12, 42, 90, 50, 14]);
  }

  function method(wb, m) {
    const ws = wb.addWorksheet("Method & Validation");
    title(ws, "Method & Validation", "How every figure is computed, and the self-checks run on the raw files");
    let r = kv(ws, 4, [
      ["Engine", `LRE Results Analyser ${m.engineVersion}`],
      ["Transactions", m.method.transactionSource || "-"], ["Response time", m.method.responseTimeUnit], ["Transaction names", m.method.transactionNames || "-"],
      ["Percentiles", m.method.percentile], ["Standard deviation", m.method.stdDev],
      ["Steady state", m.method.steadyState], ["Analysis window used", m.window ? `t+${fmt.hms(m.window.start)} → t+${fmt.hms(m.window.end)}${m.window.detected ? " (detected)" : " (user-set)"}` : "-"],
      ["Sample time", m.method.sampleTime], ["Negative response times", m.method.negativeResponseTimes],
      ["TPS", m.method.tps], ["Time-series bucket", `${m.method.bucketSec} s`], ["Pass / fail counts", m.method.passFail],
      ["Samples analysed", m.method.totalSamples], ["Exact-percentile limit", m.method.exactLimit],
      ["Time zone", `${fmt.zone(m.meta.localOffsetSec)} — ${m.meta.localOffsetSource}`],
      ["SLA", m.settings && m.settings.sla && (m.settings.sla.defaultSec != null || Object.keys(m.settings.sla.perTx || {}).length) ? `P${m.settings.sla.percentile} against user thresholds; Apdex T = threshold` : "No thresholds set"],
      ["Comparison with LRE Analysis", "Counts should match LRE exactly; averages within rounding; percentiles can differ slightly (LRE interpolates, this tool reports real samples)"],
    ], "Method");
    ws.getCell(r, 1).value = "Self-checks"; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    header(ws, r++, ["Status", "Check", "Result", "Data"]);
    const fills = { fail: RED_FILL, warn: AMBER_FILL, ok: GREEN_FILL };
    for (const c of m.selfCheck) {
      ws.getRow(r).values = [c.status.toUpperCase(), c.id, c.text, c.data !== undefined ? JSON.stringify(c.data).slice(0, 2000) : ""];
      if (fills[c.status]) ws.getCell(r, 1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: fills[c.status] } };
      r++;
    }
    r += 2;
    ws.getCell(r, 1).value = "Files used"; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    for (const [k, v] of Object.entries(m.files.used)) { ws.getRow(r++).values = [k, v || "(missing)"]; }
    widths(ws, [30, 22, 100, 60]);
    ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(3).alignment = { wrapText: true, vertical: "top" };
  }

  function buildWorkbook(m, ExcelJS) {
    const wb = new ExcelJS.Workbook();
    wb.creator = "LRE Results Analyser";
    wb.created = new Date();
    overview(wb, m);
    txSheet(wb, m, "full");
    txSheet(wb, m, "steady");
    workload(wb, m);
    errorsSheet(wb, m);
    timeSeries(wb, m);
    lgHealth(wb, m);
    insightsSheet(wb, m);
    method(wb, m);
    return wb;
  }

  return { buildWorkbook };
});
