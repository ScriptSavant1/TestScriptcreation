"use strict";

const ExcelJS = require("exceljs");

const TOOL_LABELS = {
  converter: "Postman / Bruno Converter",
  jmx:       "JMeter Converter",
  recorder:  "Recorder",
  studio:    "Script Studio",
};

const HEADER_STYLE = {
  font:      { bold: true, color: { argb: "FFFFFFFF" } },
  fill:      { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E40AF" } },
  alignment: { vertical: "middle", horizontal: "center" },
  border: {
    bottom: { style: "medium", color: { argb: "FF1E3A8A" } },
  },
};

function applyHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font      = HEADER_STYLE.font;
    cell.fill      = HEADER_STYLE.fill;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border    = HEADER_STYLE.border;
  });
  row.height = 22;
}

function autoWidth(sheet, minW = 10, maxW = 50) {
  sheet.columns.forEach((col) => {
    let max = minW;
    col.eachCell({ includeEmpty: false }, (cell) => {
      const len = cell.value ? String(cell.value).length : 0;
      if (len > max) max = len;
    });
    col.width = Math.min(max + 2, maxW);
  });
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
  wb.creator   = "PerfX Studio";
  wb.created   = new Date();
  wb.modified  = new Date();

  // ── Sheet 1: Summary ──────────────────────────────────────────────────────
  const summary = wb.addWorksheet("Summary", { properties: { tabColor: { argb: "FF1E40AF" } } });
  summary.addRow(["PerfX Studio — Usage Analytics Report"]);
  summary.getRow(1).font = { bold: true, size: 14, color: { argb: "FF1E40AF" } };
  summary.addRow([`Period: ${period}`]);
  summary.addRow([`Generated: ${new Date().toLocaleString()}`]);
  summary.addRow([]);

  const summaryData = [
    ["Metric", "Value"],
    ["Total Conversions",  stats.total],
    ["Successful",         stats.successCount],
    ["Failed",             stats.failCount],
    ["Timed Out",          stats.timeoutCount],
    ["Success Rate",       stats.successRate + "%"],
    ["Avg Duration",       stats.avgDurationLabel],
    ["Unique Machines",    stats.uniqueHosts],
    ["Unique Devices",     stats.uniqueDevices],
  ];
  summaryData.forEach((r, i) => {
    const row = summary.addRow(r);
    if (i === 0) applyHeaderRow(row);
    else {
      row.getCell(1).font = { bold: true };
      row.getCell(2).alignment = { horizontal: "right" };
    }
  });

  summary.addRow([]);
  summary.addRow(["Auto-Generated Insights"]);
  summary.lastRow.font = { bold: true, size: 12 };
  for (const ins of stats.insights) {
    summary.addRow(["• " + ins]);
  }
  autoWidth(summary);

  // ── Sheet 2: Tool Breakdown ───────────────────────────────────────────────
  const tools = wb.addWorksheet("Tool Breakdown", { properties: { tabColor: { argb: "FF059669" } } });
  const toolHeader = tools.addRow(["Tool", "Conversions", "Share (%)"]);
  applyHeaderRow(toolHeader);
  for (const t of stats.toolRows) {
    tools.addRow([TOOL_LABELS[t.tool] || t.tool, t.count, t.pct + "%"]);
  }
  autoWidth(tools);

  // ── Sheet 3: Top Machines ─────────────────────────────────────────────────
  const machines = wb.addWorksheet("Top Machines", { properties: { tabColor: { argb: "FFF59E0B" } } });
  const machHeader = machines.addRow(["Machine / Hostname", "IP Address", "Conversions", "Success Rate", "Last Seen"]);
  applyHeaderRow(machHeader);
  for (const m of stats.machineRows) {
    machines.addRow([m.machine, m.ip_address, m.count, m.success_rate + "%", m.last_seen]);
  }
  autoWidth(machines);

  // ── Sheet 4: Top Files ────────────────────────────────────────────────────
  const files = wb.addWorksheet("Top Files", { properties: { tabColor: { argb: "FF7C3AED" } } });
  const fileHeader = files.addRow(["Filename", "Extension", "Times Converted", "Avg Size", "Avg Duration (s)"]);
  applyHeaderRow(fileHeader);
  for (const f of stats.fileRows) {
    files.addRow([f.filename, f.ext, f.count, f.avg_size_label, f.avg_duration_s]);
  }
  autoWidth(files);

  // ── Sheet 5: Daily Trend ──────────────────────────────────────────────────
  const trend = wb.addWorksheet("Daily Trend", { properties: { tabColor: { argb: "FFDC2626" } } });
  const trendHeader = trend.addRow(["Date", "Total Conversions", "Successful"]);
  applyHeaderRow(trendHeader);
  for (const d of stats.dailyTrend) {
    trend.addRow([d.day, d.n, d.success_count]);
  }
  autoWidth(trend);

  // ── Sheet 6: Raw Events ───────────────────────────────────────────────────
  const events = wb.addWorksheet("All Events", { properties: { tabColor: { argb: "FF374151" } } });
  const evtHeaders = [
    "ID","Started At","Duration (ms)","Hostname","IP","Device ID",
    "Browser","OS","Tool","Protocol","Filename","File Size (KB)",
    "Requests","Result","Error Code","Correlations Found",
  ];
  const evtHeader = events.addRow(evtHeaders);
  applyHeaderRow(evtHeader);
  events.views = [{ state: "frozen", ySplit: 1 }];

  for (const r of rows) {
    const row = events.addRow([
      r.id, r.started_at, r.duration_ms,
      r.hostname, r.ip_address, r.device_id ? r.device_id.slice(0, 8) : null,
      r.browser, r.os, r.tool, r.protocol,
      r.filename, r.file_size_kb, r.request_count,
      r.result, r.error_code, r.correlations_found,
    ]);
    // Colour code result
    const resultCell = row.getCell(14);
    if (r.result === "success") {
      resultCell.font = { color: { argb: "FF059669" }, bold: true };
    } else if (r.result === "timeout") {
      resultCell.font = { color: { argb: "FFF59E0B" }, bold: true };
    } else {
      resultCell.font = { color: { argb: "FFDC2626" }, bold: true };
    }
  }
  autoWidth(events, 8, 40);

  // Stream to response
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename="perfx-analytics-${today()}.xlsx"`);
  await wb.xlsx.write(res);
  res.end();
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { streamXlsx };
