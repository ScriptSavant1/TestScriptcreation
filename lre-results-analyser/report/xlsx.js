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

  // Palette: deep purple headers, lavender group bands, slate text (modern, prints well in greyscale)
  const BLUE = "FF4C1D95", HEAD_FILL = "FF5B21B6", SUB_FILL = "FFEDE9FE", ZEBRA = "FFFAF9FE", GROUP_FILL = "FFF5F3FF";
  const RED_FILL = "FFFEE2E2", GREEN_FILL = "FFDCFCE7", AMBER_FILL = "FFFEF3C7";
  const TEXT = "FF1E293B", MUTED = "FF64748B", LINE = "FFE2E8F0", WHITE = "FFFFFFFF";
  const FONT = "Segoe UI";
  const SEC = "0.000", INT = "#,##0", RATE = "0.0000", PCT = "0.00%";
  const solid = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const thin = (argb) => ({ style: "thin", color: { argb: argb || LINE } });

  function header(ws, row, cells, fromCol) {
    const c0 = fromCol || 1;
    const r = ws.getRow(row);
    cells.forEach((c, i) => {
      const cell = r.getCell(c0 + i);
      cell.value = c;
      cell.font = { name: FONT, bold: true, size: 10, color: { argb: WHITE } };
      cell.fill = solid(HEAD_FILL);
      cell.alignment = { vertical: "middle", horizontal: i < 2 && c0 === 1 ? "left" : "center", wrapText: true };
      cell.border = { top: thin(HEAD_FILL), bottom: thin(HEAD_FILL), left: thin("FF7C3AED"), right: thin("FF7C3AED") };
    });
    r.height = 32;
    return r;
  }
  function title(ws, text, sub) {
    ws.getCell("A1").value = text;
    ws.getCell("A1").font = { name: FONT, bold: true, size: 16, color: { argb: BLUE } };
    ws.getRow(1).height = 26;
    if (sub) { ws.getCell("A2").value = sub; ws.getCell("A2").font = { name: FONT, italic: true, size: 9, color: { argb: MUTED } }; }
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

  // ── sheet builders ──────────────────────────────────────────────────────────
  /**
   * One "card": a merged purple title bar over two columns, then label / value rows.
   * pairs: [label, value, {numFmt, color, bold}?]. Returns the next free row.
   */
  function card(ws, row, col, heading, pairs) {
    ws.mergeCells(row, col, row, col + 1);
    const h = ws.getCell(row, col);
    h.value = heading;
    h.font = { name: FONT, bold: true, size: 11, color: { argb: WHITE } };
    h.fill = solid(HEAD_FILL);
    h.alignment = { horizontal: "center", vertical: "middle" };
    ws.getRow(row).height = Math.max(ws.getRow(row).height || 0, 22);
    let r = row + 1;
    for (const [label, value, o] of pairs) {
      const k = ws.getCell(r, col), v = ws.getCell(r, col + 1);
      k.value = label;
      k.font = { name: FONT, size: 10, color: { argb: MUTED } };
      v.value = value == null || value === "" ? "-" : value;
      v.font = { name: FONT, size: 10, bold: !!(o && o.bold), color: { argb: (o && o.color) || TEXT } };
      v.alignment = { horizontal: "left", vertical: "middle", wrapText: true };
      if (o && o.numFmt) v.numFmt = o.numFmt;
      for (const c of [k, v]) c.border = { bottom: thin() };
      k.border = { bottom: thin(), left: thin() }; v.border = { bottom: thin(), right: thin() };
      r++;
    }
    return r;
  }

  /** Lay cards out in two columns (B–C and E–F), row by row, keeping each pair of cards aligned. */
  function cardGrid(ws, startRow, cards) {
    let r = startRow;
    for (let i = 0; i < cards.length; i += 2) {
      const a = card(ws, r, 2, cards[i][0], cards[i][1]);
      const b = cards[i + 1] ? card(ws, r, 5, cards[i + 1][0], cards[i + 1][1]) : r;
      r = Math.max(a, b) + 1;
    }
    return r;
  }

  function overview(wb, m) {
    const ws = wb.addWorksheet("Test Overview", { properties: { tabColor: { argb: BLUE } }, views: [{ showGridLines: false }] });
    const off = m.meta.localOffsetSec, t = m.totals, web = m.web;
    widths(ws, [3, 28, 40, 4, 28, 40, 3]);

    // banner
    ws.mergeCells(2, 2, 2, 6);
    const b = ws.getCell(2, 2);
    b.value = `Test Overview — ${m.meta.sessionName || "LRE run"}`;
    b.font = { name: FONT, bold: true, size: 18, color: { argb: WHITE } };
    b.fill = solid(BLUE);
    b.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(2).height = 36;
    ws.mergeCells(3, 2, 3, 6);
    const s = ws.getCell(3, 2);
    s.value = `Generated ${m.generatedAt.slice(0, 19).replace("T", " ")} UTC by LRE Results Analyser ${m.engineVersion} · all figures decoded from RawData.eve · times in ${fmt.zone(off)}`;
    s.font = { name: FONT, italic: true, size: 9, color: { argb: MUTED } };
    s.alignment = { indent: 1 };

    const verdict = m.insights ? m.insights.verdict : null;
    const vColor = verdict ? { pass: "FF15803D", warn: "FFB45309", fail: "FFB91C1C" }[verdict.status] : null;
    const failPct = t.pass != null && t.fail != null && t.pass + t.fail ? t.fail / (t.pass + t.fail) : null;
    const dur = m.meta.durationSec;
    const lgRows = m.lgs.filter((l) => l.vusers).map((l) => [l.name + (l.ip ? ` [${l.ip}]` : ""), l.vusers, { numFmt: INT, bold: true }]);

    const next = cardGrid(ws, 5, [
      ["Test Metadata", [
        ["Project / Domain", m.meta.project], ["Test Name", m.meta.sessionName],
        ["LRE result folder", m.meta.lreResultFolder], ["Run ID", m.meta.runId, { bold: true }],
        ["Result name", m.meta.resultName], ["Workload Type", [m.meta.scenarioType, m.meta.scheduleMode].filter(Boolean).join(" · ")],
      ]],
      ["Execution Time", [
        ["Start Time", fmt.localTime(m.meta.startUtc, off)], ["End Time", fmt.localTime(m.meta.stopUtc, off)],
        ["Test Duration", fmt.hms(dur), { bold: true }],
        ["Time zone", fmt.zone(off) + (m.meta.localOffsetConfirmed ? " (confirmed)" : "")],
        ["Run Status", `${m.meta.stopReason || "-"}${verdict ? " · Result: " + verdict.text : ""}`, { color: vColor, bold: true }],
        ["Controller software", [m.meta.product, m.meta.version].filter(Boolean).join(" ")],
      ]],
      ["Run Details", [
        ["Scenario", m.meta.sessionName], ["Scenario path", m.meta.scenarioPath],
        ["Goal profile", m.meta.goalProfile], ["Load behaviour", m.meta.loadBehavior],
        ["Start reason", m.meta.startReason], ["Schedule", m.meta.scheduleText || m.meta.schedule.raw],
      ]],
      ["High-Level Metrics", [
        ["Transactions Passed", t.pass, { numFmt: INT, bold: true, color: "FF15803D" }],
        ["Transactions Failed", t.fail, { numFmt: INT, bold: true, color: t.fail ? "FFB91C1C" : TEXT }],
        ["Failure rate", failPct, { numFmt: "0.000%" }],
        ["Errors", t.errors, { numFmt: INT, bold: true, color: t.errors ? "FFB91C1C" : TEXT }],
        ["Transactions defined", t.transactionsDefined, { numFmt: INT }],
        ["Steady state", m.phases && m.phases.steady ? fmt.hms(m.phases.steady.durationSec) : "-"],
        ["Results calculated", m.method.percentileMethod === "exact" ? "Every instance — exact, no granularity" : "Every instance — percentiles from histograms (±0.5 %)",
          { color: m.method.percentileMethod === "exact" ? TEXT : "FFB45309" }],
      ]],
      ["Performance", [
        ["Transactions/Sec (Passed)", t.tpsFull != null ? t.tpsFull : null, { numFmt: "0.00", bold: true }],
        ["Hits per Sec (avg)", web ? web.hitsPerSec.avg : t.hitsPerSec ? t.hitsPerSec.avg : null, { numFmt: "#,##0.00", bold: true }],
        ["Total Hits", web ? web.hits : null, { numFmt: INT }],
        ["Throughput (avg bytes/s)", web ? web.throughputBytesPerSec.avg : t.throughputBytesPerSec ? t.throughputBytesPerSec.avg : null, { numFmt: INT, bold: true }],
        ["Total Throughput (bytes)", web ? web.throughputBytes : null, { numFmt: INT }],
        ["Peak running VUsers", t.peakVusers, { numFmt: INT }],
      ]],
      ["VUsers per LG Count", lgRows.length ? lgRows : [["(no load generators)", null]]],
    ]);

    // HTTP codes + schedule tables under the cards
    let r = next;
    if (web && web.httpCodes.length) {
      r = card(ws, r, 2, "HTTP Response Codes", web.httpCodes.map((c) => [c.name, c.count, { numFmt: INT, bold: true, color: /^HTTP_[45]/.test(c.name) ? "FFB91C1C" : TEXT }]));
      r++;
    }
    ws.mergeCells(r, 2, r, 6);
    const st = ws.getCell(r, 2);
    st.value = "Schedule — planned vs actual";
    st.font = { name: FONT, bold: true, size: 11, color: { argb: WHITE } }; st.fill = solid(HEAD_FILL); st.alignment = { horizontal: "center" };
    r++;
    for (const row of fmt.scheduleRows(m)) {
      ws.getCell(r, 2).value = row.phase; ws.getCell(r, 2).font = { name: FONT, size: 10, bold: true, color: { argb: TEXT } };
      ws.mergeCells(r, 3, r, 4); ws.getCell(r, 3).value = row.planned;
      ws.mergeCells(r, 5, r, 6); ws.getCell(r, 5).value = row.actual;
      for (const c of [2, 3, 5]) { const x = ws.getCell(r, c); x.border = { bottom: thin() }; x.alignment = { wrapText: true, vertical: "middle" }; if (c > 2) x.font = { name: FONT, size: 10, color: { argb: TEXT } }; }
      r++;
    }
  }

  const TX_COLS = [
    ["Script", 32], ["Transaction", 46], ["Count", 10, INT], ["Pass", 10, INT], ["Fail", 8, INT], ["Fail %", 8, PCT],
    ["Min (s)", 9, SEC], ["Avg (s)", 9, SEC], ["Max (s)", 9, SEC], ["Std Dev (s)", 10, SEC],
    ["P50 (s)", 9, SEC], ["P80 (s)", 9, SEC], ["P85 (s)", 9, SEC], ["P90 (s)", 9, SEC], ["P95 (s)", 9, SEC], ["P98 (s)", 9, SEC], ["P99 (s)", 9, SEC],
    ["TPS", 9, RATE], ["SLA (s)", 9, SEC], ["SLA result", 10], ["Apdex", 8, "0.00"],
  ];

  function txSheet(wb, m, which) {
    const name = which === "full" ? "Transactions – Full Run" : "Transactions – Steady State";
    const ws = wb.addWorksheet(name, { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    const win = which === "full" ? `Whole run: ${fmt.hms(m.meta.durationSec)}` :
      m.window ? `${m.window.detected ? "Steady state (detected)" : "Analysis window (user-set)"}: t+${fmt.hms(m.window.start)} – t+${fmt.hms(m.window.end)} (${fmt.relLocal(m, m.window.start)} – ${fmt.relLocal(m, m.window.end)}), ${fmt.hms(m.window.durationSec)}` : "No steady-state window";
    title(ws, name, `${win} · response times in seconds · ${m.method.summaryBasis || "every passed instance"} · pass/fail: whole-run counts`);
    const N = TX_COLS.length;
    header(ws, 4, TX_COLS.map((c) => c[0]));
    ws.autoFilter = { from: { row: 4, column: 2 }, to: { row: 4, column: N } };
    TX_COLS.forEach((c, i) => { ws.getColumn(i + 1).width = c[1]; });
    const fmtRow = (r, fill, bold) => {
      for (let c = 2; c <= N; c++) {
        const cell = ws.getCell(r, c);
        cell.font = { name: FONT, size: 10, bold: !!bold, color: { argb: TEXT } };
        if (fill) cell.fill = solid(fill);
        if (TX_COLS[c - 1][2]) cell.numFmt = TX_COLS[c - 1][2];
        cell.alignment = { vertical: "middle", horizontal: c === 2 ? "left" : "right" };
        cell.border = { bottom: thin(), right: c === N ? thin("FFC4B5FD") : undefined };
      }
    };
    let r = 5;
    for (const g of fmt.groupByScript(m)) {
      const first = r;
      g.rows.forEach((t, i) => {
        const s = t[which];
        const slaRes = which === "steady" && t.sla ? (t.sla.pass ? "PASS" : "FAIL") : "";
        ws.getRow(r).values = [g.script, t.name, which === "full" ? t.count : s.count + (s.fail || 0), t.pass, t.fail, t.failPct != null ? t.failPct / 100 : null,
          s.min, s.avg, s.max, s.stdDev, sAt(s, "p50"), sAt(s, "p80"), sAt(s, "p85"), sAt(s, "p90"), sAt(s, "p95"), sAt(s, "p98"), sAt(s, "p99"),
          s.tps, which === "steady" && t.sla ? t.sla.threshold : null, slaRes, which === "steady" && t.sla ? t.sla.apdex : null];
        fmtRow(r, i % 2 ? ZEBRA : WHITE, false);
        if (slaRes) { const c = ws.getCell(r, 20); /* "SLA result" */ c.fill = solid(slaRes === "PASS" ? GREEN_FILL : RED_FILL); c.alignment = { horizontal: "center" }; c.font = { name: FONT, size: 10, bold: true, color: { argb: slaRes === "PASS" ? "FF15803D" : "FFB91C1C" } }; }
        if (t.fail) ws.getCell(r, 5).font = { name: FONT, size: 10, bold: true, color: { argb: "FFB91C1C" } };
        if (t.failPct != null && t.failPct > 1) ws.getCell(r, 6).fill = solid(t.failPct > 5 ? RED_FILL : AMBER_FILL);
        r++;
      });
      const sub = ws.getRow(r);
      sub.values = [g.script, "Subtotal", { formula: `SUM(C${first}:C${r - 1})` }, g.rows.some((t) => t.pass != null) ? { formula: `SUM(D${first}:D${r - 1})` } : null,
        g.rows.some((t) => t.fail != null) ? { formula: `SUM(E${first}:E${r - 1})` } : null, null, null, null, null, null, null, null, null, null, null, null, null,
        { formula: `SUM(R${first}:R${r - 1})` }]; // R = TPS
      fmtRow(r, SUB_FILL, true);
      for (let c = 2; c <= N; c++) ws.getCell(r, c).border = { top: thin("FFC4B5FD"), bottom: thin("FFC4B5FD") };
      // the script name: one merged, vertically centred cell for the whole group (incl. subtotal)
      ws.mergeCells(first, 1, r, 1);
      const sc = ws.getCell(first, 1);
      sc.font = { name: FONT, size: 10, bold: true, color: { argb: BLUE } };
      sc.fill = solid(GROUP_FILL);
      sc.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
      sc.border = { top: thin("FFC4B5FD"), left: thin("FFC4B5FD"), bottom: thin("FFC4B5FD"), right: thin("FFC4B5FD") };
      r += 2;
    }
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
    ws.getCell(r, 1).value = "Load generators"; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
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
    title(ws, "Time Series", `Granularity ${tl.bucketSec} s${m.granularity && !m.granularity.auto ? " (user-selected)" : " (auto)"}: one row per time slot. Response times in seconds (slot percentiles from 2 % histograms). The transaction sheets do not use this granularity.`);
    const txs = m.transactions;
    const graphCols = [];
    for (const g of tl.graphs || []) if (["hits", "bytesReceived", "bytesSent", "httpCodes", "connections", "connectionsPerSec", "throughput"].includes(g.role))
      for (const ms of g.measurements) graphCols.push({ label: `${g.type}: ${ms.name}`, data: ms.avg });
    const cols = ["Time (local)", "t+", "Running VUsers", "Total TPS", "Errors"]
      .concat(txs.flatMap((t) => [`${t.label || t.name} count`, `${t.label || t.name} avg`, `${t.label || t.name} P90`, `${t.label || t.name} P95`]))
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
      ["Steady state", m.method.steadyState], ["Analysis window used", m.window ? `t+${fmt.hms(m.window.start)} – t+${fmt.hms(m.window.end)}${m.window.detected ? " (detected)" : " (user-set)"}` : "-"],
      ["Sample time", m.method.sampleTime], ["Negative response times", m.method.negativeResponseTimes],
      ["Transaction summary basis", m.method.summaryBasis], ["Chart / Time Series granularity", m.method.chartGranularity],
      ["TPS", m.method.tps], ["Pass / fail counts", m.method.passFail],
      ["Samples analysed", m.method.totalSamples], ["Exact-percentile limit", m.method.exactLimit],
      ["Time zone", `${fmt.zone(m.meta.localOffsetSec)} — ${m.meta.localOffsetSource}`],
      ["SLA", m.settings && m.settings.sla && (m.settings.sla.defaultSec != null || Object.keys(m.settings.sla.perTx || {}).length) ? `P${m.settings.sla.percentile} against user thresholds; Apdex T = threshold` : "No thresholds set"],
      ["Comparison with LRE Analysis", "Names, counts, pass/fail, averages, hits, HTTP codes and throughput match LRE exactly. Min / Max / Std Dev / percentiles can differ on busy transactions: LRE's summary table averages instances into time slots first; this tool uses every instance"],
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
