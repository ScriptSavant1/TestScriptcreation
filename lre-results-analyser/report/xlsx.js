/**
 * xlsx.js — Excel workbook from the result model (Phase 2). ExcelJS is injected, so the same
 * builder runs in the browser (vendored exceljs.min.js) and in the CLI (npm exceljs).
 *
 *   const wb = buildWorkbook(model, ExcelJS);  const buf = await wb.xlsx.writeBuffer();
 *
 * Sheets: 1 Test Overview · 2 Transactions – Full Run · 3 Transactions – Steady State ·
 * 4 Workload Model · 5 Errors · 6 Time Series · 7 LG Health · 8 Insights · 9 About this report
 * opts.images: { chartKey: { url: "data:image/png;base64,…", width, height } } — charts placed on the
 * Time Series and LG Health sheets (the page passes them; the CLI has no PNG renderer).
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
        ["Start Time", fmt.when(m.meta.startUtc, off)], ["End Time", fmt.when(m.meta.stopUtc, off)],
        ["Test Duration", fmt.dur(dur), { bold: true }],
        ["Time zone", fmt.zone(off) + (m.meta.localOffsetConfirmed ? " (confirmed)" : "")],
        ["Run Status", `${m.meta.stopReason || "-"}${verdict ? " · Result: " + verdict.text : ""}`, { color: vColor, bold: true }],
        ["Controller", (m.lgs.find((l) => l.role === "controller") || {}).name || "-"],
        ["LoadRunner version", [m.meta.product, m.meta.version].filter(Boolean).join(" ")],
      ]],
      ["Run Details", [
        ["Scenario", m.meta.sessionName], ["Scenario path", m.meta.scenarioPath],
        ["Goal profile", m.meta.goalProfile], ["Load behaviour", m.meta.loadBehavior],
        ["Start reason", m.meta.startReason], ["Schedule", m.meta.scheduleText || m.meta.schedule.raw],
        ["Scripts", `${m.workload.length} script${m.workload.length === 1 ? "" : "s"} (see Workload Model)`],
      ]],
      ["High-Level Metrics", [
        ["Transactions Passed", t.pass, { numFmt: INT, bold: true, color: "FF15803D" }],
        ["Transactions Failed", t.fail, { numFmt: INT, bold: true, color: t.fail ? "FFB91C1C" : TEXT }],
        ["Failure rate", failPct, { numFmt: "0.000%" }],
        ["Errors", t.errors, { numFmt: INT, bold: true, color: t.errors ? "FFB91C1C" : TEXT }],
        ["Transactions defined", t.transactionsDefined, { numFmt: INT }],
        [m.window && !m.window.detected ? "Analysis window (user-set)" : "Steady state", m.window ? `${fmt.dur(m.window.durationSec)} — ${fmt.relRange(m, m.window.start, m.window.end)}` : "-"],
        ["VUsers stopped early", m.lifecycle && m.lifecycle.earlyExits ? m.lifecycle.earlyExits.length : null, { numFmt: INT, color: m.lifecycle && m.lifecycle.earlyExits && m.lifecycle.earlyExits.length ? "FFB45309" : TEXT }],
        ["Results calculated", m.method.percentileMethod === "exact" ? "Every instance — exact, no granularity" : "Every instance — percentiles from histograms (±0.5 %)",
          { color: m.method.percentileMethod === "exact" ? TEXT : "FFB45309" }],
      ]],
      ["Performance", [
        ["Transactions per second (whole test)", t.tpsFull != null ? t.tpsFull : null, { numFmt: "0.00", bold: true }],
        ["Transactions per second (steady state)", t.tpsSteady != null ? t.tpsSteady : null, { numFmt: "0.00" }],
        ["Passed transactions ratio (passed ÷ all)", t.pass != null && t.fail != null && t.pass + t.fail ? t.pass / (t.pass + t.fail) : null, { numFmt: "0.000%" }],
        ["Hits per Sec (avg)", web ? web.hitsPerSec.avg : t.hitsPerSec ? t.hitsPerSec.avg : null, { numFmt: "#,##0.00", bold: true }],
        ["Total Hits", web ? web.hits : null, { numFmt: INT }],
        ["Throughput (avg bytes/s)", web ? web.throughputBytesPerSec.avg : t.throughputBytesPerSec ? t.throughputBytesPerSec.avg : null, { numFmt: INT, bold: true }],
        ["Total Throughput (bytes)", web ? web.throughputBytes : null, { numFmt: INT }],
        ["Total Throughput", web ? fmt.bytes(web.throughputBytes) : null],
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
    const win = which === "full" ? `Whole test: ${fmt.relRange(m, 0, m.meta.durationSec)} (${fmt.dur(m.meta.durationSec)})` :
      m.window ? `${m.window.detected ? "Steady state" : "Analysis window (user-set)"}: ${fmt.relRange(m, m.window.start, m.window.end)} (${fmt.dur(m.window.durationSec)})` : "No steady-state window";
    title(ws, name, `${win} · response times in seconds, from every passed transaction`);
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
        const pass = which === "full" ? t.pass : s.count, fail = which === "full" ? t.fail : s.fail || 0;
        ws.getRow(r).values = [g.script, t.name, pass + fail, pass, fail, pass + fail ? fail / (pass + fail) : null,
          s.min, s.avg, s.max, s.stdDev, sAt(s, "p50"), sAt(s, "p80"), sAt(s, "p85"), sAt(s, "p90"), sAt(s, "p95"), sAt(s, "p98"), sAt(s, "p99"),
          s.tps, which === "steady" && t.sla ? t.sla.threshold : null, slaRes, which === "steady" && t.sla ? t.sla.apdex : null];
        fmtRow(r, i % 2 ? ZEBRA : WHITE, false);
        if (slaRes) { const c = ws.getCell(r, 20); /* "SLA result" */ c.fill = solid(slaRes === "PASS" ? GREEN_FILL : RED_FILL); c.alignment = { horizontal: "center" }; c.font = { name: FONT, size: 10, bold: true, color: { argb: slaRes === "PASS" ? "FF15803D" : "FFB91C1C" } }; }
        if (fail) ws.getCell(r, 5).font = { name: FONT, size: 10, bold: true, color: { argb: "FFB91C1C" } };
        const fp = pass + fail ? (fail / (pass + fail)) * 100 : 0;
        if (fp > 1) ws.getCell(r, 6).fill = solid(fp > 5 ? RED_FILL : AMBER_FILL);
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
    title(ws, "Workload Model", "The workload design per script (pacing and think time from the script's run-time settings) and how much of it was delivered");
    const earlyBy = {};
    for (const v of (m.lifecycle && m.lifecycle.earlyExits) || []) earlyBy[String(v.script).toLowerCase()] = (earlyBy[String(v.script).toLowerCase()] || 0) + 1;
    header(ws, 3, ["Script", "Script name", "Group(s)", "Protocol", "Language", "VUsers", "Load generators (VUsers)", "Pacing", "Think time",
      "Iterations planned", "Iterations achieved", "Achieved %", "Transactions in script", "Transactions run", "VUsers stopped early"]);
    let r = 4;
    for (const s of m.workload) {
      ws.getRow(r).values = [s.key, s.scriptName, s.groups.join(", "), s.protocol, s.language, s.vusers,
        s.loadGenerators.map((l) => `${l.name} (${l.vusers})`).join("; "), s.pacing ? s.pacing.text : "-", s.thinkTime ? s.thinkTime.text : "-",
        s.iterationsExpected, s.iterationsAchieved, s.iterationsExpected ? s.iterationsAchieved / s.iterationsExpected : null,
        s.transactions.length, s.samples, earlyBy[String(s.key).toLowerCase()] || 0];
      ws.getCell(r, 12).numFmt = PCT;
      r++;
    }
    r += 2;
    ws.getCell(r, 1).value = "Load generators"; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    header(ws, r++, ["Host", "IP", "Role", "VUsers", "Scripts", "CPU peak %", "Memory peak %", "Scripts (VUsers)"]);
    for (const l of m.lgs) {
      ws.getRow(r).values = [l.name, l.ip || "-", l.role === "controller" ? "Controller" : l.vusers ? "Load generator" : "Monitored host", l.vusers, l.scripts.length, l.cpuPeak, l.memPeak, l.scripts.join("; ")];
      ws.getCell(r, 8).alignment = { wrapText: false };
      r++;
    }
    r += 2;
    ws.getCell(r, 1).value = "VUsers"; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    const early = new Set(((m.lifecycle && m.lifecycle.earlyExits) || []).map((v) => `${v.group}|${v.vuser}`));
    header(ws, r++, ["Group", "VUser", "Script", "Load generator", "Started (local)", "Stopped (local)", "Ran for", "Stopped early", "Iterations", "Transactions", "Avg RT (s)"]);
    for (const v of m.vusers) {
      ws.getRow(r).values = [v.group, v.vuser, v.script, v.lg, fmt.relWhen(m, v.runRelSec), fmt.relWhen(m, v.exitRelSec),
        v.runRelSec != null && v.exitRelSec != null ? fmt.dur(v.exitRelSec - v.runRelSec) : "-", early.has(`${v.group}|${v.vuser}`) ? "yes" : "", v.iterations, v.samples, v.avgRt];
      ws.getCell(r, 11).numFmt = SEC; r++;
    }
    widths(ws, [30, 28, 24, 26, 26, 14, 40, 30, 26, 12, 12, 11, 12, 12, 12]);
  }

  function errorsSheet(wb, m) {
    const ws = wb.addWorksheet("Errors", { views: [{ state: "frozen", ySplit: 3 }] });
    if (!m.errors) { title(ws, "Errors", "SqliteDb.db not available — no error data"); return; }
    title(ws, `Errors — ${m.errors.total} logged`, "Grouped by error code, script line and message (errors that differ only in IDs or numbers are counted together). Times are local.");
    header(ws, 3, ["Script", "Load generator(s)", "Error code", "Message (example)", "General form", "Count", "VUsers affected", "First seen", "Last seen", "Actions"]);
    let r = 4;
    for (const g of m.errors.summary) {
      ws.getRow(r).values = [g.script, g.injectors.join(", "), g.code, g.example, g.pattern, g.count, g.vusers.length,
        g.firstUtc != null ? fmt.when(g.firstUtc, m.meta.localOffsetSec) : "-", g.lastUtc != null ? fmt.when(g.lastUtc, m.meta.localOffsetSec) : "-", g.actions.join(", ")];
      r++;
    }
    ws.autoFilter = { from: { row: 3, column: 1 }, to: { row: 3, column: 10 } };
    r += 2;
    ws.getCell(r, 1).value = `Error log${m.errors.rowsTruncated ? " (first 20,000 rows)" : ""}`; ws.getCell(r, 1).font = { bold: true, color: { argb: BLUE } }; r++;
    header(ws, r++, ["Time (local)", "Code", "Message", "Script", "Action", "Load generator", "VUser", "Iteration", "Line"]);
    for (const e of m.errors.rows) {
      ws.getRow(r).values = [e.utc != null ? fmt.localTime(e.utc, m.meta.localOffsetSec) : e.time, e.code, e.message, e.script, e.action, e.injector, e.vuser, e.iteration, e.line];
      r++;
    }
    widths(ws, [26, 30, 11, 90, 60, 8, 12, 24, 24, 16]);
  }

  /**
   * "Charts" sheet: every report chart (opts.images, rendered by the page), two per row. Kept on a
   * sheet of its own so the data sheets scroll normally (freezing rows under a block of pictures
   * froze the whole screen). Not added when there are no images (CLI).
   */
  function chartsSheet(wb, m, opts) {
    const keys = ["load", "txBars", "rtOverTime", "throughput", "errors", "httpCodes", "bytes", "lgHealth", "rtPerLg", "tpsVsRt", "latencyHeat", "vuserHeat"];
    if (!keys.some((k) => opts.images && opts.images[k])) return;
    const ws = wb.addWorksheet("Charts", { views: [{ showGridLines: false }] });
    for (let c = 1; c <= 20; c++) ws.getColumn(c).width = 10; // ≈ 75 px each: the second chart starts at column J
    title(ws, "Charts", "The test at a glance — the data behind each chart is on the Time Series, LG Health and transaction sheets.");
    placeCharts(wb, ws, 4, opts.images, keys);
  }

  /** Place chart images in a grid of two per row from `row`; returns the first row below them. */
  function placeCharts(wb, ws, row, images, keys) {
    const list = keys.map((k) => images && images[k]).filter(Boolean);
    if (!list.length) return row;
    const W = 640, ROWPX = 20;
    let r = row;
    for (let i = 0; i < list.length; i += 2) {
      let hMax = 0;
      list.slice(i, i + 2).forEach((img, j) => {
        const h = Math.round((W * img.height) / img.width);
        hMax = Math.max(hMax, h);
        const id = wb.addImage({ base64: img.url, extension: "png" });
        ws.addImage(id, { tl: { col: j === 0 ? 0.2 : 9.2, row: r - 1 }, ext: { width: W, height: h } });
      });
      r += Math.ceil(hMax / ROWPX) + 1;
    }
    return r + 1;
  }

  function timeSeries(wb, m, opts) {
    const ws = wb.addWorksheet("Time Series", { views: [{ state: "frozen", xSplit: 2, ySplit: 4 }] });
    const tl = m.timeline;
    title(ws, "Time Series", `One row per ${tl.bucketSec}-second slot. Response times in seconds.${opts.images ? " The Charts sheet shows the same data as charts." : ""}`);
    const top = 4;
    const txs = m.transactions;
    const graphCols = [];
    for (const g of tl.graphs || []) if (["hits", "bytesReceived", "bytesSent", "httpCodes", "connections", "connectionsPerSec", "throughput"].includes(g.role))
      for (const ms of g.measurements) graphCols.push({ label: `${g.type}: ${ms.name}`, data: ms.avg });
    const cols = ["Time (local)", "Elapsed", "Running VUsers", "Total TPS", "Errors"]
      .concat(txs.flatMap((t) => [`${t.label || t.name} count`, `${t.label || t.name} avg`, `${t.label || t.name} P90`, `${t.label || t.name} P95`]))
      .concat(graphCols.map((g) => g.label));
    header(ws, top, cols);
    for (let b = 0; b < tl.buckets; b++) {
      const rel = b * tl.bucketSec;
      const row = [fmt.relLocal(m, rel), fmt.hms(rel), tl.vusers ? tl.vusers[b] : null, tl.totalTps[b], tl.errors ? tl.errors[b] : null];
      for (const t of txs) { const s = tl.tx[t.id]; row.push(s.count[b], s.avg[b], s.p90[b], s.p95[b]); }
      for (const g of graphCols) row.push(g.data[b]);
      ws.getRow(top + 1 + b).values = row;
    }
    ws.getColumn(1).width = 20; ws.getColumn(2).width = 10;
    for (let c = 3; c <= cols.length; c++) { ws.getColumn(c).width = 12; ws.getColumn(c).numFmt = "0.000"; }
    ws.getColumn(3).numFmt = INT; ws.getColumn(5).numFmt = INT;
  }

  function lgHealth(wb, m, opts) {
    const ws = wb.addWorksheet("LG Health");
    if (!m.lgHealth || !m.lgHealth.length) { title(ws, "LG Health", "No load-generator monitoring in sum_data (graph es_tr_lg_monitoring)"); return; }
    title(ws, "LG Health", "CPU / memory / disk of the test machines (LRE's load-generator monitor). Above 85 % the machine itself may slow the test down.");
    const top = 3;
    header(ws, top, ["Host", "IP", "CPU avg %", "CPU peak %", "Memory avg %", "Memory peak %", "Disk avg", "Disk peak"]);
    let r = top + 1;
    for (const h of m.lgHealth) {
      ws.getRow(r).values = [h.host, h.ip || "-", h.cpu && h.cpu.mean, h.cpu && h.cpu.max, h.memory && h.memory.mean, h.memory && h.memory.max, h.disk && h.disk.mean, h.disk && h.disk.max];
      [4, 6].forEach((c) => { const v = ws.getCell(r, c).value; if (v >= 85) ws.getCell(r, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: RED_FILL } }; });
      r++;
    }
    for (let c = 3; c <= 8; c++) ws.getColumn(c).numFmt = "0.0";
    r += 2;
    const cols = ["Time (local)", "Elapsed"];
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

  function about(wb, m) {
    const ws = wb.addWorksheet("About this report");
    title(ws, "About this report", "How the figures in this workbook are worked out, in plain words");
    kv(ws, 4, fmt.aboutRows(m));
    widths(ws, [34, 130]);
    ws.getColumn(2).alignment = { wrapText: true, vertical: "top" };
    ws.getColumn(1).alignment = { vertical: "top" };
  }

  function buildWorkbook(m, ExcelJS, opts) {
    opts = opts || {};
    const wb = new ExcelJS.Workbook();
    wb.creator = "LRE Results Analyser";
    wb.created = new Date();
    overview(wb, m);
    chartsSheet(wb, m, opts);
    txSheet(wb, m, "full");
    txSheet(wb, m, "steady");
    workload(wb, m);
    errorsSheet(wb, m);
    timeSeries(wb, m, opts);
    lgHealth(wb, m, opts);
    insightsSheet(wb, m);
    about(wb, m);
    return wb;
  }

  return { buildWorkbook };
});
