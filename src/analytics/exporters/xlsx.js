"use strict";

const ExcelJS = require("exceljs");

// Same look as the portal (design system v4): brand blue headers, slate text, light row bands.
const C = {
  accent: "FF2563EB", text: "FF0F172A", text2: "FF3A495F", text3: "FF58687F",
  border: "FFE1E6EE", band: "FFF7F9FC", soft: "FFEEF3FD",
  ok: "FF15803D", warn: "FFA85B06", bad: "FFC42727",
};
const FONT = "Calibri";

const TOOL_LABELS = {
  recorder:  "Recorder",
  studio:    "Script Studio",
  converter: "Postman / Bruno Converter",
  jmx:       "JMeter Converter",
  analyser:  "Results Analyser",
};
const RESULT_LABELS = { success: "Success", failed: "Failed", timeout: "Timed out" };

const THIN = { style: "thin", color: { argb: C.border } };

/**
 * A formatted table: blue header row, banded body, number formats per column, filter + frozen header.
 * cols: [{ header, key?, width, fmt?, align? }]; rows: arrays in column order. Returns the last row number.
 */
function addTable(ws, startRow, cols, rows, opts = {}) {
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = Math.max(ws.getColumn(i + 1).width || 0, c.width); });
  const head = ws.getRow(startRow);
  cols.forEach((c, i) => {
    const cell = head.getCell(i + 1);
    cell.value = c.header;
    cell.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.accent } };
    cell.alignment = { vertical: "middle", horizontal: c.align || (c.fmt ? "right" : "left"), wrapText: true };
    cell.border = { bottom: THIN };
  });
  head.height = 24;
  rows.forEach((r, k) => {
    const row = ws.getRow(startRow + 1 + k);
    r.forEach((v, i) => {
      const cell = row.getCell(i + 1);
      cell.value = v === undefined ? null : v;
      cell.font = { name: FONT, size: 11, color: { argb: C.text } };
      cell.alignment = { vertical: "middle", horizontal: cols[i].align || (cols[i].fmt ? "right" : "left") };
      if (cols[i].fmt) cell.numFmt = cols[i].fmt;
      cell.border = { bottom: THIN };
      if (k % 2 === 1) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: C.band } };
    });
    if (opts.styleRow) opts.styleRow(row, r);
  });
  const last = startRow + rows.length;
  if (rows.length && opts.filter !== false) ws.autoFilter ={ from: { row: startRow, column: 1 }, to: { row: last, column: cols.length } };
  return last;
}

/** Sheet title + one-line description above a table. */
function sheetTitle(ws, title, sub) {
  ws.getCell("A1").value = title;
  ws.getCell("A1").font = { name: FONT, bold: true, size: 16, color: { argb: C.text } };
  ws.getCell("A2").value = sub;
  ws.getCell("A2").font = { name: FONT, size: 11, color: { argb: C.text3 } };
  ws.getRow(1).height = 26;
}

function newSheet(wb, name, tab, frozenRow) {
  return wb.addWorksheet(name, { properties: { tabColor: { argb: tab } }, views: [{ state: "frozen", ySplit: frozenRow, showGridLines: false }] });
}

/**
 * Generate an XLSX report and stream it to the Express response.
 * @param {object} res    - Express response
 * @param {object} stats  - from reports.getStats()
 * @param {Array}  rows   - raw DB rows from queryAllForExport()
 * @param {string} period - e.g. "Last 30 days"
 */
async function streamXlsx(res, stats, rows, period = "All time") {
  const wb = new ExcelJS.Workbook();
  wb.creator  = "PerfX Studio";
  wb.created  = new Date();
  wb.modified = new Date();
  const sub = `PerfX Studio · ${period} · generated ${new Date().toLocaleString("en-GB")}`;

  // ── Summary: key figures + insights ──────────────────────────────────────
  const summary = wb.addWorksheet("Summary", { properties: { tabColor: { argb: C.accent } }, views: [{ showGridLines: false }] });
  summary.getColumn(1).width = 30; summary.getColumn(2).width = 18; summary.getColumn(3).width = 70;
  sheetTitle(summary, "Usage analytics report", sub);
  const figs = [
    ["Uses (all tools)", stats.total, "#,##0"],
    ["Machines", stats.uniquePeople, "#,##0"],
    ["Success rate", stats.successRate / 100, "0%"],
    ["Successful", stats.successCount, "#,##0"],
    ["Failed", stats.failCount, "#,##0"],
    ["Timed out", stats.timeoutCount, "#,##0"],
    ["Most used tool", stats.busiestTool ? stats.busiestTool.label : "—", null],
  ];
  let r = addTable(summary, 4, [{ header: "Key figure", width: 30 }, { header: "Value", width: 18, fmt: "#,##0", align: "right" }],
    figs.map((f) => [f[0], f[1]]), { filter: false });
  figs.forEach((f, i) => { const c = summary.getCell(`B${5 + i}`); if (f[2]) c.numFmt = f[2]; else c.alignment = { horizontal: "right" }; });
  r += 2;
  summary.getCell(`A${r}`).value = "Insights";
  summary.getCell(`A${r}`).font = { name: FONT, bold: true, size: 13, color: { argb: C.text } };
  for (const ins of stats.insights) {
    r++;
    summary.mergeCells(`A${r}:C${r}`);
    const cell = summary.getCell(`A${r}`);
    cell.value = ins;
    cell.font = { name: FONT, size: 11, color: { argb: C.text2 } };
    cell.alignment = { wrapText: true, vertical: "top", indent: 1 };
    summary.getRow(r).height = Math.max(18, Math.ceil(ins.length / 110) * 16);
  }

  // ── Tools ────────────────────────────────────────────────────────────────
  const tools = newSheet(wb, "Tools", "FF7C5CE6", 4);
  sheetTitle(tools, "Each tool: uses, machines, success and output", sub);
  addTable(tools, 4, [
    { header: "Tool", width: 28 }, { header: "Uses", width: 10, fmt: "#,##0" }, { header: "Share", width: 10, fmt: "0%" },
    { header: "Machines", width: 12, fmt: "#,##0" }, { header: "Success rate", width: 13, fmt: "0%" },
    { header: "Problems", width: 11, fmt: "#,##0" }, { header: "Average time (s)", width: 16, fmt: "0.0" },
    { header: "DevWeb", width: 10, fmt: "#,##0" }, { header: "VuGen", width: 10, fmt: "#,##0" },
  ], stats.toolSummaryRows.map((t) => [t.label, t.count, t.pct / 100, t.people, t.successRate / 100, t.problems, t.avgDurationMs / 1000, t.devweb || null, t.vugen || null]));

  // ── People ───────────────────────────────────────────────────────────────
  const people = newSheet(wb, "Machines", "FF0E9FB5", 4);
  sheetTitle(people, "Who uses PerfX Studio — by machine", sub);
  addTable(people, 4, [
    { header: "Machine", width: 24 }, { header: "IP address", width: 16 }, { header: "Uses", width: 10, fmt: "#,##0" },
    { header: "Share", width: 10, fmt: "0%" }, { header: "Success rate", width: 13, fmt: "0%" }, { header: "Tools", width: 50 },
    { header: "First seen", width: 13 }, { header: "Last seen", width: 18 },
  ], stats.peopleRows.map((p) => [p.machine, p.ip_address, p.count, p.pct / 100, p.successRate / 100, p.tools.join(", "), p.firstSeen, p.lastSeen]), {
    styleRow: (row, v) => { const c = row.getCell(5); c.font = { name: FONT, bold: true, color: { argb: v[4] >= 0.95 ? C.ok : v[4] >= 0.75 ? C.warn : C.bad } }; },
  });

  // ── Problems ─────────────────────────────────────────────────────────────
  const probs = newSheet(wb, "Problems", "FFC42727", 4);
  sheetTitle(probs, "What went wrong — failures and time-outs by cause", sub);
  addTable(probs, 4, [
    { header: "What went wrong", width: 32 }, { header: "Error code", width: 24 }, { header: "Tools", width: 60 },
    { header: "Times", width: 10, fmt: "#,##0" }, { header: "Machines", width: 12, fmt: "#,##0" }, { header: "Last seen", width: 18 },
  ], stats.problemRows.map((e) => [e.label, e.code, e.toolLabel, e.count, e.people, e.lastSeen]));

  // ── Files ────────────────────────────────────────────────────────────────
  const files = newSheet(wb, "Files", "FF16A34A", 4);
  sheetTitle(files, "Most used files", sub);
  addTable(files, 4, [
    { header: "File", width: 40 }, { header: "Type", width: 10 }, { header: "Uses", width: 10, fmt: "#,##0" },
    { header: "Average size", width: 14, align: "right" }, { header: "Average time (s)", width: 16, fmt: "0.0" },
  ], stats.fileRows.map((f) => [f.filename, (f.ext || "").replace(/^\./, ""), f.count, f.avg_size_label, f.avg_duration_s != null ? Number(f.avg_duration_s) : null]));

  // ── Uses per day, one column per tool ────────────────────────────────────
  const trend = newSheet(wb, "Daily", "FF2F6FE4", 4);
  sheetTitle(trend, "Uses per day, by tool", sub);
  const series = stats.dailyTools.series;
  addTable(trend, 4, [{ header: "Date", width: 13 }].concat(series.map((s) => ({ header: s.label, width: Math.max(12, s.label.length + 2), fmt: "#,##0" }))).concat([{ header: "Total", width: 10, fmt: "#,##0" }]),
    stats.dailyTools.days.map((day, i) => [day].concat(series.map((s) => s.counts[i])).concat([series.reduce((a, s) => a + s.counts[i], 0)])));

  // ── All events ───────────────────────────────────────────────────────────
  const events = newSheet(wb, "All events", "FF64748B", 4);
  sheetTitle(events, "Every event in the period", sub);
  addTable(events, 4, [
    { header: "ID", width: 8, fmt: "0" }, { header: "Started at", width: 22 }, { header: "Duration (ms)", width: 14, fmt: "#,##0" },
    { header: "Machine", width: 18 }, { header: "IP address", width: 16 }, { header: "Device", width: 11 },
    { header: "Browser", width: 14 }, { header: "OS", width: 14 }, { header: "Tool", width: 24 }, { header: "Output", width: 10 },
    { header: "File", width: 36 }, { header: "Size (KB)", width: 12, fmt: "#,##0" }, { header: "Requests / transactions", width: 22, fmt: "#,##0" },
    { header: "Result", width: 12 }, { header: "Error code", width: 22 }, { header: "Correlations found", width: 18, fmt: "#,##0" },
  ], rows.map((e) => [
    e.id, e.started_at, e.duration_ms, e.hostname, e.ip_address, e.device_id ? e.device_id.slice(0, 8) : null,
    e.browser, e.os, TOOL_LABELS[e.tool] || e.tool, e.protocol, e.filename, e.file_size_kb, e.request_count,
    RESULT_LABELS[e.result] || e.result, e.error_code, e.correlations_found,
  ]), {
    styleRow: (row, v) => { const c = row.getCell(14); c.font = { name: FONT, bold: true, color: { argb: v[13] === "Success" ? C.ok : v[13] === "Timed out" ? C.warn : C.bad } }; },
  });

  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="perfx-analytics-${today()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { streamXlsx };
