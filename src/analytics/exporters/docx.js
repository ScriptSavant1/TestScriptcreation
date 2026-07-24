"use strict";

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType,
  PageOrientation,
} = require("docx");

const TOOL_LABELS = {
  converter: "Postman / Bruno Converter",
  jmx:       "JMeter Converter",
  recorder:  "Recorder",
  studio:    "Script Studio",
};

function heading1(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 400, after: 200 },
  });
}

function heading2(text) {
  return new Paragraph({
    text,
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 300, after: 120 },
  });
}

function para(text, opts = {}) {
  return new Paragraph({
    children: [new TextRun({ text, size: 22, ...opts })],
    spacing:  { before: 80, after: 80 },
  });
}

function bullet(text) {
  return new Paragraph({
    children: [new TextRun({ text: "• " + text, size: 22 })],
    spacing:  { before: 60, after: 60 },
    indent:   { left: 400 },
  });
}

function spacer() {
  return new Paragraph({ text: "", spacing: { before: 120, after: 0 } });
}

function makeTable(headers, dataRows) {
  const BLUE_BG = { fill: "1E40AF", type: ShadingType.CLEAR, color: "FFFFFF" };
  const STRIPE  = { fill: "EFF6FF", type: ShadingType.CLEAR, color: "auto" };
  const BORDER  = { style: BorderStyle.SINGLE, size: 4, color: "CBD5E1" };
  const BORDERS = { top: BORDER, bottom: BORDER, left: BORDER, right: BORDER };

  const headerRow = new TableRow({
    tableHeader: true,
    children: headers.map((h) =>
      new TableCell({
        shading: BLUE_BG,
        borders: BORDERS,
        children: [new Paragraph({
          children: [new TextRun({ text: h, bold: true, color: "FFFFFF", size: 20 })],
          alignment: AlignmentType.CENTER,
        })],
      })
    ),
  });

  const bodyRows = dataRows.map((row, idx) =>
    new TableRow({
      children: row.map((cell) =>
        new TableCell({
          shading: idx % 2 === 1 ? STRIPE : undefined,
          borders: BORDERS,
          children: [new Paragraph({
            children: [new TextRun({ text: String(cell ?? "—"), size: 20 })],
          })],
        })
      ),
    })
  );

  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows:  [headerRow, ...bodyRows],
  });
}

/**
 * Generate a DOCX management report and stream it to the Express response.
 * @param {object} res    - Express response
 * @param {object} stats  - from reports.getStats()
 * @param {string} period - human-readable period label
 */
async function streamDocx(res, stats, period = "All time") {
  const generated = new Date().toLocaleString();

  const doc = new Document({
    sections: [{
      properties: {
        page: { size: { orientation: PageOrientation.PORTRAIT } },
      },
      children: [
        // ── Title Page ────────────────────────────────────────────────────
        new Paragraph({
          children: [new TextRun({ text: "PerfX Studio", bold: true, size: 56, color: "1E40AF" })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 2000, after: 200 },
        }),
        new Paragraph({
          children: [new TextRun({ text: "Usage Analytics Report", size: 36, color: "374151" })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 0, after: 400 },
        }),
        new Paragraph({
          children: [new TextRun({ text: `Period: ${period}`, size: 24, color: "6B7280" })],
          alignment: AlignmentType.CENTER,
        }),
        new Paragraph({
          children: [new TextRun({ text: `Generated: ${generated}`, size: 24, color: "6B7280" })],
          alignment: AlignmentType.CENTER,
          spacing: { after: 2000 },
        }),

        // ── Executive Summary ─────────────────────────────────────────────
        heading1("Executive Summary"),
        para(`During the selected period (${period}), PerfX Studio processed ${stats.total.toLocaleString()} script conversions with a ${stats.successRate}% success rate. Average conversion time was ${stats.avgDurationLabel}.`),
        spacer(),

        heading2("Key Insights"),
        ...stats.insights.map(bullet),
        spacer(),

        // ── Key Metrics ────────────────────────────────────────────────────
        heading1("Key Metrics"),
        makeTable(
          ["Metric", "Value"],
          [
            ["Total Conversions",  stats.total.toLocaleString()],
            ["Successful",         stats.successCount.toLocaleString()],
            ["Failed",             stats.failCount.toLocaleString()],
            ["Timed Out",          stats.timeoutCount.toLocaleString()],
            ["Success Rate",       stats.successRate + "%"],
            ["Average Duration",   stats.avgDurationLabel],
            ["Unique Machines",    stats.uniqueHosts.toLocaleString()],
            ["Unique Devices",     stats.uniqueDevices.toLocaleString()],
          ]
        ),
        spacer(),

        // ── Tool Usage ─────────────────────────────────────────────────────
        heading1("Tool Usage"),
        makeTable(
          ["Tool", "Conversions", "Share"],
          stats.toolRows.map((t) => [TOOL_LABELS[t.tool] || t.tool, t.count.toLocaleString(), t.pct + "%"])
        ),
        spacer(),

        // ── Protocol Split ─────────────────────────────────────────────────
        heading1("Protocol Split"),
        makeTable(
          ["Protocol", "Conversions", "Share"],
          stats.protoRows.map((p) => [p.label, p.count.toLocaleString(), p.pct + "%"])
        ),
        spacer(),

        // ── Top Machines ───────────────────────────────────────────────────
        heading1("Most Active Machines"),
        makeTable(
          ["Machine / Hostname", "IP Address", "Conversions", "Success Rate", "Last Seen"],
          stats.machineRows.slice(0, 15).map((m) => [
            m.machine, m.ip_address, m.count.toLocaleString(), m.success_rate + "%", m.last_seen || "—",
          ])
        ),
        spacer(),

        // ── Top Files ──────────────────────────────────────────────────────
        heading1("Most Converted Files"),
        makeTable(
          ["Filename", "Type", "Times Converted", "Avg Size", "Avg Duration"],
          stats.fileRows.slice(0, 15).map((f) => [
            f.filename, f.ext, f.count.toLocaleString(), f.avg_size_label, f.avg_duration_s ? f.avg_duration_s + "s" : "—",
          ])
        ),
        spacer(),

        // ── Footer ─────────────────────────────────────────────────────────
        new Paragraph({
          children: [new TextRun({ text: "Generated by PerfX Studio — Internal Performance Engineering Platform", size: 18, color: "9CA3AF" })],
          alignment: AlignmentType.CENTER,
          spacing: { before: 800 },
        }),
      ],
    }],
  });

  const buf = await Packer.toBuffer(doc);
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  res.setHeader("Content-Disposition", `attachment; filename="perfx-report-${today()}.docx"`);
  res.end(buf);
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

module.exports = { streamDocx };
