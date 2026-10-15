"use strict";

const archiver = require("archiver");
const { PassThrough } = require("stream");
const ExcelJS = require("exceljs");
const zip = require("../web/zip");
const { analyse, applySettings } = require("../engine/analyse");
const { buildWorkbook } = require("../report/xlsx");
const { sampleRun, memorySource } = require("./helpers");

/** Build a ZIP in memory with archiver (deflate; optionally forced ZIP64). */
function makeZip(filesMap, opts) {
  return new Promise((resolve, reject) => {
    const a = archiver("zip", Object.assign({ zlib: { level: 6 } }, opts));
    const out = new PassThrough();
    const parts = [];
    out.on("data", (d) => parts.push(d));
    out.on("end", () => resolve(Buffer.concat(parts)));
    a.on("error", reject);
    a.pipe(out);
    for (const [name, data] of Object.entries(filesMap)) a.append(typeof data === "string" ? Buffer.from(data) : data, { name, store: name.endsWith(".txt") });
    a.finalize();
  });
}

/** Source over a ZIP (what the browser worker does). */
function zipSource(z) {
  return {
    list: async () => z.entries.map((e) => e.name),
    readBytes: (p) => z.read(p),
    size: async (p) => z.size(p),
    stream: (p, cb) => z.stream(p, cb),
  };
}

describe("zip reader", () => {
  test.each([["standard", {}], ["ZIP64", { forceZip64: true }]])("%s archive: list, read, stream", async (_, opts) => {
    const run = sampleRun();
    run["Res9/notes.txt"] = "stored entry";
    const z = await zip.open(new Blob([await makeZip(run, opts)]));
    expect(z.entries.map((e) => e.name).sort()).toEqual(Object.keys(run).sort());
    expect(Buffer.from(await z.read("Res9/RunInfo.ini")).toString()).toBe(run["Res9/RunInfo.ini"]);
    expect(Buffer.from(await z.read("Res9/notes.txt")).toString()).toBe("stored entry");
    const parts = [];
    await z.stream("Res9/RawData.eve", (c) => parts.push(Buffer.from(c)));
    expect(Buffer.concat(parts).equals(run["Res9/RawData.eve"])).toBe(true);
  });

  test("analysis from a ZIP equals analysis from the folder", async () => {
    const run = sampleRun();
    const z = await zip.open(new Blob([await makeZip(run)]));
    const a = await analyse(zipSource(z));
    const b = await analyse(memorySource(run));
    expect(a.transactions.map((t) => [t.name, t.full])).toEqual(b.transactions.map((t) => [t.name, t.full]));
  });

  test("clear errors for non-ZIP data and unknown entries", async () => {
    await expect(zip.open(new Blob([Buffer.alloc(100)]))).rejects.toThrow(/Not a ZIP/);
    const z = await zip.open(new Blob([await makeZip({ "a.ini": "x" })]));
    await expect(z.read("nope")).rejects.toThrow(/not found/);
  });
});

describe("Excel workbook", () => {
  test("nine sheets with the transaction figures", async () => {
    const m = await analyse(memorySource(sampleRun()));
    applySettings(m, { sla: { defaultSec: 1.5 } });
    const buf = await buildWorkbook(m, ExcelJS).xlsx.writeBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    expect(wb.worksheets.map((w) => w.name)).toEqual(["Test Overview", "Transactions – Full Run", "Transactions – Steady State",
      "Workload Model", "Errors", "Time Series", "LG Health", "Insights", "Method & Validation"]);
    const ws = wb.getWorksheet("Transactions – Steady State");
    const rows = [];
    ws.eachRow((r, i) => { if (i > 4) rows.push(r.values.slice(1)); });
    const login = rows.find((r) => r[1] === "T01_LOGIN");
    expect(login[2]).toBe(6);
    expect(login[18]).toBe("PASS");
    expect(rows.some((r) => r[1] === "Subtotal")).toBe(true);
    const ov = wb.getWorksheet("Test Overview");
    let found = false;
    ov.eachRow((r) => { if (r.getCell(1).value === "Scenario" && r.getCell(2).value === "Unit_Run") found = true; });
    expect(found).toBe(true);
  });
});

describe("charts, HTML (PDF) and Word reports", () => {
  let m;
  beforeAll(async () => {
    m = await analyse(memorySource(sampleRun()));
    applySettings(m, { sla: { defaultSec: 1.5 } });
  });

  test("report chart set renders to SVG (server-side ECharts)", () => {
    const echarts = require("../web/vendor/echarts.min.js");
    const charts = require("../report/charts");
    const set = charts.reportSet(m, { static: true });
    expect(set.map((c) => c.key)).toEqual(expect.arrayContaining(["load", "txBars", "rtOverTime", "latencyHeat", "vuserHeat"]));
    for (const c of set) {
      const ch = echarts.init(null, null, { renderer: "svg", ssr: true, width: 800, height: 300 });
      try { ch.setOption(c.option); expect(ch.renderToSVGString()).toMatch(/^<svg/); } finally { ch.dispose(); }
    }
    expect(charts.distribution(m, 10, { static: true }).series[0].data.reduce((a, b) => a + b, 0)).toBe(6);
    expect(charts.errorsOverTime(m, {})).toBeNull(); // no SqliteDb.db in the sample
  });

  test("HTML report has every section, escapes text and embeds charts", () => {
    const { buildReport } = require("../report/html");
    const html = buildReport(m, { charts: { load: '<svg width="10"></svg>' }, company: "A<B" });
    for (const h of ["1. Executive summary", "2. Test and workload", "3. Results — steady state", "4. Results — full run", "8. All findings", "Appendix — method and validation"]) expect(html).toContain(h);
    expect(html).toContain("A&lt;B");
    expect(html).toContain('<svg class="chart"');
    expect(html).toContain("T01_LOGIN");
  });

  test("Word report builds a valid .docx", async () => {
    const D = require("docx");
    const { buildDocument } = require("../report/docx");
    const buf = await D.Packer.toBuffer(buildDocument(m, D, {}));
    expect(buf.slice(0, 2).toString()).toBe("PK"); // ZIP container
    const z = await zip.open(new Blob([buf]));
    const xml = Buffer.from(await z.read("word/document.xml")).toString();
    expect(xml).toContain("Executive summary");
    expect(xml).toContain("T02_SUBMIT");
  });
});
