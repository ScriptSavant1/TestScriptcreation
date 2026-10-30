"use strict";

const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, Header, Footer, PageNumber,
  HeadingLevel, AlignmentType, WidthType, BorderStyle, ShadingType, LevelFormat, VerticalAlign,
  PageOrientation,
} = require("docx");

// Same look as the portal (design system v4): slate text, brand blue accents, light table headers.
const C = { accent: "2563EB", text: "0F172A", text2: "3A495F", text3: "58687F", border: "E1E6EE", head: "F1F5F9", band: "F7F9FC", ok: "15803D", bad: "C42727" };
const FONT = "Calibri";

const TOOL_LABELS = {
  recorder:  "Recorder",
  explorer:  "HAR Explorer",
  studio:    "Script Studio",
  converter: "Postman / Bruno Converter",
  jmx:       "JMeter Converter",
  analyser:  "Results Analyser",
};

const heading1 = (text) => new Paragraph({ text, heading: HeadingLevel.HEADING_1, spacing: { before: 360, after: 140 } });
const para = (text, opts = {}) => new Paragraph({ children: [new TextRun({ text, ...opts })], spacing: { before: 60, after: 120 } });
const bullet = (text) => new Paragraph({ children: [new TextRun({ text })], numbering: { reference: "bullets", level: 0 }, spacing: { before: 40, after: 80 } });
const spacer = () => new Paragraph({ text: "", spacing: { before: 60, after: 60 } });

const LINE = { style: BorderStyle.SINGLE, size: 4, color: C.border };
const NONE = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" };

/**
 * A clean table: light header row, thin row lines, numbers right-aligned.
 * cols: [{ header, width (%), num? }]
 */
function makeTable(cols, dataRows) {
  const cell = (text, col, opts = {}) => new TableCell({
    width: { size: col.width, type: WidthType.PERCENTAGE },
    verticalAlign: VerticalAlign.CENTER,
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
    borders: { top: NONE, left: NONE, right: NONE, bottom: LINE },
    margins: { top: 70, bottom: 70, left: 110, right: 110 },
    children: [new Paragraph({
      alignment: col.num ? AlignmentType.RIGHT : AlignmentType.LEFT,
      children: [new TextRun({ text: String(text ?? "—"), bold: !!opts.bold, color: opts.color || C.text, size: 20 })],
    })],
  });
  const head = new TableRow({ tableHeader: true, children: cols.map((c) => cell(c.header, c, { fill: C.head, bold: true })) });
  const body = dataRows.map((row, i) => new TableRow({
    children: row.map((v, k) => cell(v, cols[k], { fill: i % 2 === 1 ? C.band : undefined })),
  }));
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: LINE, bottom: LINE, left: NONE, right: NONE, insideHorizontal: LINE, insideVertical: NONE },
    rows: [head, ...body],
  });
}

/** Key figures as a row of tiles: big number, small label. */
function figures(items) {
  const w = Math.floor(100 / items.length);
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: { top: NONE, bottom: NONE, left: NONE, right: NONE, insideHorizontal: NONE, insideVertical: NONE },
    rows: [new TableRow({
      children: items.map(([label, value, color]) => new TableCell({
        width: { size: w, type: WidthType.PERCENTAGE },
        shading: { fill: C.band, type: ShadingType.CLEAR, color: "auto" },
        borders: { top: { style: BorderStyle.SINGLE, size: 6, color: "FFFFFF" }, bottom: { style: BorderStyle.SINGLE, size: 6, color: "FFFFFF" }, left: { style: BorderStyle.SINGLE, size: 24, color: "FFFFFF" }, right: { style: BorderStyle.SINGLE, size: 24, color: "FFFFFF" } },
        margins: { top: 140, bottom: 140, left: 160, right: 160 },
        children: [
          new Paragraph({ children: [new TextRun({ text: String(value), bold: true, size: String(value).length > 7 ? 26 : 36, color: color || C.text })] }),
          new Paragraph({ children: [new TextRun({ text: label, size: 18, color: C.text3 })] }),
        ],
      })),
    })],
  });
}

/**
 * Generate a DOCX management report and stream it to the Express response.
 * @param {object} res    - Express response
 * @param {object} stats  - from reports.getStats()
 * @param {string} period - human-readable period label
 */
async function streamDocx(res, stats, period = "All time") {
  const generated = new Date().toLocaleString("en-GB");
  const fails = stats.failCount + stats.timeoutCount;

  const doc = new Document({
    creator: "PerfX Studio",
    title: "PerfX Studio — usage analytics report",
    styles: {
      default: { document: { run: { font: FONT, size: 22, color: C.text } } },
      paragraphStyles: [
        { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 30, bold: true, color: C.text }, paragraph: { spacing: { before: 360, after: 140 }, keepNext: true } },
        { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true, run: { font: FONT, size: 24, bold: true, color: C.text }, paragraph: { spacing: { before: 240, after: 100 }, keepNext: true } },
      ],
    },
    numbering: {
      config: [{ reference: "bullets", levels: [{ level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 360, hanging: 240 } }, run: { color: C.accent } } }] }],
    },
    sections: [{
      properties: { page: { size: { orientation: PageOrientation.PORTRAIT }, margin: { top: 1100, bottom: 1100, left: 1100, right: 1100 } } },
      headers: { default: new Header({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: `PerfX Studio · usage analytics · ${period}`, size: 16, color: C.text3 })] })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ children: ["Page ", PageNumber.CURRENT, " of ", PageNumber.TOTAL_PAGES], size: 16, color: C.text3 })] })] }) },
      children: [
        // ── title ────────────────────────────────────────────────────────
        new Paragraph({ children: [new TextRun({ text: "PERFX STUDIO", bold: true, size: 20, color: C.accent, characterSpacing: 40 })], spacing: { before: 200, after: 80 } }),
        new Paragraph({ children: [new TextRun({ text: "Usage analytics report", bold: true, size: 52, color: C.text })], spacing: { after: 120 } }),
        new Paragraph({ children: [new TextRun({ text: `Period: ${period}`, size: 24, color: C.text2 })], spacing: { after: 40 } }),
        new Paragraph({ children: [new TextRun({ text: `Generated: ${generated}`, size: 20, color: C.text3 })], spacing: { after: 280 } }),

        figures([
          ["Uses", stats.total.toLocaleString()],
          ["Machines", stats.uniquePeople.toLocaleString()],
          ["Success rate", stats.successRate + "%", stats.total ? (stats.successRate >= 95 ? C.ok : stats.successRate < 75 ? C.bad : C.text) : C.text],
          ["Problems", fails.toLocaleString(), fails ? C.bad : C.text],
          ["Most used tool", stats.busiestTool ? stats.busiestTool.label.replace(" Converter", "") : "—"],
        ]),

        // ── summary ──────────────────────────────────────────────────────
        heading1("Executive summary"),
        para(`During the selected period (${period}), PerfX Studio was used ${stats.total.toLocaleString()} times on ${stats.uniquePeople.toLocaleString()} machines, with a ${stats.successRate}% success rate (${stats.failCount.toLocaleString()} failed, ${stats.timeoutCount.toLocaleString()} timed out).`),
        new Paragraph({ text: "Key insights", heading: HeadingLevel.HEADING_2 }),
        ...stats.insights.map(bullet),

        // ── tools ────────────────────────────────────────────────────────
        heading1("Tools"),
        makeTable([{ header: "Tool", width: 28 }, { header: "Uses", width: 10, num: true }, { header: "Share", width: 10, num: true }, { header: "Machines", width: 12, num: true },
          { header: "Success", width: 11, num: true }, { header: "Average time", width: 13, num: true }, { header: "Output", width: 16 }],
          stats.toolSummaryRows.map((t) => [t.label, t.count.toLocaleString(), t.pct + "%", t.people.toLocaleString(), t.successRate + "%", t.avgDurationLabel, t.devweb || t.vugen ? "DevWeb " + t.devweb + " · VuGen " + t.vugen : "—"])),

        // ── people ───────────────────────────────────────────────────────
        heading1("Who uses it"),
        makeTable([{ header: "Machine", width: 26 }, { header: "Uses", width: 9, num: true }, { header: "Success", width: 10, num: true }, { header: "Tools", width: 40 }, { header: "Last seen", width: 15 }],
          stats.peopleRows.slice(0, 15).map((p) => [p.machine || "—", p.count.toLocaleString(), p.successRate + "%", p.tools.map((x) => x.replace(" Converter", "")).join(", "), p.lastSeen || "—"])),

        // ── problems ─────────────────────────────────────────────────────
        heading1("Problems"),
        ...(stats.problemRows.length
          ? [makeTable([{ header: "What went wrong", width: 30 }, { header: "Tools", width: 36 }, { header: "Times", width: 10, num: true }, { header: "Machines", width: 10, num: true }, { header: "Last seen", width: 14 }],
              stats.problemRows.map((e) => [e.label, e.toolLabel.replace(/ Converter/g, ""), e.count.toLocaleString(), e.people.toLocaleString(), e.lastSeen || "—"]))]
          : [para("No failures or time-outs in this period.")]),

        // ── files ────────────────────────────────────────────────────────
        heading1("Most used files"),
        makeTable([{ header: "File", width: 40 }, { header: "Type", width: 10 }, { header: "Uses", width: 14, num: true }, { header: "Average size", width: 18, num: true }, { header: "Average time", width: 18, num: true }],
          stats.fileRows.slice(0, 15).map((f) => [f.filename, (f.ext || "").replace(/^\./, ""), f.count.toLocaleString(), f.avg_size_label, f.avg_duration_s ? f.avg_duration_s + "s" : "—"])),

        spacer(),
        new Paragraph({
          children: [new TextRun({ text: "Generated by PerfX Studio — Internal Performance Engineering Platform", size: 16, color: C.text3 })],
          alignment: AlignmentType.LEFT,
          spacing: { before: 400 },
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
