#!/usr/bin/env node
/**
 * LRE Results Analyser — command line (same engine as the browser page).
 *
 *   node lre-results-analyser/cli/analyse.js <results-folder | results.zip> [options]
 *     --xlsx report.xlsx    Excel workbook (9 sheets)
 *     --docx report.docx    Word report (tables and findings; the browser version also embeds charts)
 *     --html report.html    print-ready HTML report with charts (open it and "Save as PDF")
 *     --out result.json     full result model
 *     --sla 2.5             SLA threshold in seconds for every transaction
 *     --sla-pct 90          percentile the SLA applies to (default 90)
 *     --window 600-28800    analysis window in seconds from scenario start (default: detected steady state)
 *     --granularity 300     chart / Time Series granularity in seconds (default auto; coarser than auto only).
 *                           The transaction summary never uses a granularity.
 *     --exact-limit 1e8     keep up to this many samples for exact percentiles (default 20,000,000 ≈ 240 MB;
 *                           about 12 bytes each). Above it percentiles come from histograms (within 0.5 %)
 *     --lre-granularity 2   diagnostic: also compute LRE Analysis-style min/max/std-dev/p90 over the means of
 *                           N-second × load-generator buckets, printed to the console only (default off)
 *     --redact              host names → LG1, LG2…; IPs, script paths and error text removed (safe to share)
 *     --quiet               no console summary
 *
 * Reads an LRE raw-results folder (the one holding RawData.eve) or its ZIP. Nothing is uploaded
 * anywhere — this is also the path for very large runs (hundreds of GB).
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { analyse, redact } = require("../engine/analyse");

const CHUNK = 8 * 1024 * 1024;

function parseArgs(argv) {
  const a = { folder: null, out: null, xlsx: null, docx: null, html: null, sla: null, slaPct: 90, window: null, redact: false, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--out") a.out = argv[++i];
    else if (x === "--xlsx") a.xlsx = argv[++i];
    else if (x === "--docx") a.docx = argv[++i];
    else if (x === "--html") a.html = argv[++i];
    else if (x === "--sla") a.sla = Number(argv[++i]);
    else if (x === "--sla-pct") a.slaPct = Number(argv[++i]);
    else if (x === "--window") {
      const m = /^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/.exec(argv[++i] || "");
      if (!m) throw new Error("--window expects start-end in seconds, e.g. 600-28800");
      a.window = { start: +m[1], end: +m[2] };
    }
    else if (x === "--lre-granularity") a.lreGranularity = Number(argv[++i]);
    else if (x === "--granularity") a.granularity = argv[++i];
    else if (x === "--exact-limit") {
      a.exactLimit = Number(argv[++i]);
      if (!(a.exactLimit >= 0)) throw new Error("--exact-limit expects a number of samples, e.g. 100000000");
    }
    else if (x === "--redact") a.redact = true;
    else if (x === "--quiet") a.quiet = true;
    else if (x === "-h" || x === "--help") a.help = true;
    else if (!a.folder) a.folder = x;
    else throw new Error(`Unexpected argument: ${x}`);
  }
  return a;
}

function walk(dir, base, out) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, d.name);
    const rel = path.relative(base, full).split(path.sep).join("/");
    if (d.isDirectory()) walk(full, base, out);
    else if (d.isFile()) out.push(rel);
  }
  return out;
}

/**
 * Query SqliteDb.db: better-sqlite3 when its native module matches this Node version, otherwise the
 * bundled sql.js (WebAssembly — no native build needed).
 */
let sqlJs = null;
async function querySqlite(file, sql) {
  try {
    const Database = require("better-sqlite3");
    const db = new Database(file, { readonly: true, fileMustExist: true });
    try { return db.prepare(sql).all(); } finally { db.close(); }
  } catch (e) {
    if (!/NODE_MODULE_VERSION|Cannot find module|was compiled against|invalid ELF|not a valid Win32/i.test(String(e.message))) throw e;
    if (!sqlJs) sqlJs = await require("../web/vendor/sql-wasm.js")({ locateFile: (f) => path.join(__dirname, "..", "web", "vendor", f) });
    const db = new sqlJs.Database(fs.readFileSync(file));
    try {
      const res = db.exec(sql);
      if (!res.length) return [];
      return res[0].values.map((row) => Object.fromEntries(res[0].columns.map((c, i) => [c, row[i]])));
    } finally { db.close(); }
  }
}

function folderSource(folder) {
  const abs = (rel) => path.join(folder, ...rel.split("/"));
  return {
    list: async () => walk(folder, folder, []),
    readBytes: async (rel) => fs.promises.readFile(abs(rel)),
    size: async (rel) => (await fs.promises.stat(abs(rel))).size,
    stream: (rel, onChunk) => new Promise((resolve, reject) => {
      const s = fs.createReadStream(abs(rel), { highWaterMark: CHUNK });
      s.on("data", (b) => onChunk(new Uint8Array(b.buffer, b.byteOffset, b.byteLength)));
      s.on("end", resolve);
      s.on("error", reject);
    }),
    sqlite: async (rel, sql) => querySqlite(abs(rel), sql),
  };
}

/** Source over a ZIP file (random access; entries streamed one at a time, nothing extracted). */
async function zipSource(file) {
  const zip = require("../web/zip");
  const z = await zip.open(await fs.openAsBlob(file));
  return {
    list: async () => z.entries.map((e) => e.name),
    readBytes: (p) => z.read(p),
    size: async (p) => z.size(p),
    stream: (p, cb) => z.stream(p, cb),
    sqlite: async (rel, sql) => {
      // better-sqlite3 needs a file: write the (small) database to a temp file and remove it straight after
      const tmp = path.join(require("os").tmpdir(), `lre-ra-${process.pid}-${Date.now()}.db`);
      fs.writeFileSync(tmp, await z.read(rel));
      try { return await querySqlite(tmp, sql); } finally { try { fs.unlinkSync(tmp); } catch (_) { /* already gone */ } }
    },
  };
}

/** Report charts as SVG strings (ECharts server-side rendering). */
function renderSvgCharts(model) {
  const echarts = require("../web/vendor/echarts.min.js");
  const charts = require("../report/charts");
  const out = {};
  for (const c of charts.reportSet(model, { static: true, dark: false })) {
    const ch = echarts.init(null, null, { renderer: "svg", ssr: true, width: 1000, height: c.key === "vuserHeat" || c.key === "latencyHeat" ? 460 : 400 });
    try { ch.setOption(c.option); out[c.key] = ch.renderToSVGString(); } finally { ch.dispose(); }
  }
  return out;
}

// ── console report ──────────────────────────────────────────────────────────
const fmt = (v, d = 3) => (v == null ? "-" : Number(v).toFixed(d));
const hms = (s) => {
  if (s == null) return "-";
  const t = Math.round(s), h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}`;
};
const localTime = (utc, off) => (utc == null ? "-" : new Date((utc + (off || 0)) * 1000).toISOString().replace("T", " ").slice(0, 19));

function table(rows, cols) {
  const w = cols.map((c) => Math.max(c.h.length, ...rows.map((r) => String(c.f(r)).length)));
  const line = (cells) => cells.map((v, i) => (cols[i].left ? String(v).padEnd(w[i]) : String(v).padStart(w[i]))).join("  ");
  return [line(cols.map((c) => c.h)), w.map((n) => "-".repeat(n)).join("  "), ...rows.map((r) => line(cols.map((c) => c.f(r))))].join("\n");
}

function report(r) {
  const m = r.meta;
  const out = [];
  out.push(`LRE Results Analyser ${r.engineVersion}`);
  out.push("");
  out.push("== Test overview ==");
  out.push(`Session      : ${m.sessionName || "-"}   Project: ${m.project || "-"}`);
  out.push(`Start (local): ${localTime(m.startUtc, m.localOffsetSec)}   End: ${localTime(m.stopUtc, m.localOffsetSec)}   Duration: ${hms(m.durationSec)}`);
  out.push(`LRE          : ${m.product || "-"} ${m.version || "-"}   Stop reason: ${m.stopReason || "-"}`);
  out.push(`Schedule     : ${m.schedule.described.join("; ") || m.schedule.raw || "-"}`);
  if (r.lifecycle) out.push(`VUsers       : ${r.lifecycle.vusers} (max running ${r.lifecycle.maxRunning}) on ${r.lifecycle.loadGenerators.map((l) => `${l.name} (${l.vusers})`).join(", ")}`);
  if (r.phases) {
    const p = r.phases;
    out.push(`Phases       : ramp-up ends t+${hms(p.rampUpEndRelSec)}; steady ${p.steady ? `t+${hms(p.steady.startRelSec)} – t+${hms(p.steady.endRelSec)} (${hms(p.steady.durationSec)})` : "-"}; last exit t+${hms(p.lastExitRelSec)}`);
  }
  if (r.window && !r.window.detected) out.push(`Window       : user-set t+${hms(r.window.start)} – t+${hms(r.window.end)}`);
  out.push(`Summary      : ${r.method.summaryBasis}`);
  out.push(`Granularity  : ${r.method.chartGranularity}`);
  out.push("");
  out.push("== Workload ==");
  for (const s of r.workload) {
    out.push(`${s.key} [${s.protocol || "?"}] — ${s.vusers} VUsers; pacing: ${s.pacing ? s.pacing.text : "-"}; think time: ${s.thinkTime ? s.thinkTime.text : "-"}; ${s.transactions.length} transactions; iterations ${s.iterationsAchieved}${s.
      iterationsExpected != null ? ` of ~${s.iterationsExpected} planned` : ""}`);
  }
  for (const [label, key] of [["Transaction summary — full run", "full"], ["Transaction summary — steady state", "steady"]]) {
    out.push("");
    out.push(`== ${label} (seconds) ==`);
    out.push(`Calculated: ${r.method.summaryBasis}`);
    const cols = [
      { h: "Transaction", f: (t) => t.name, left: true },
      { h: "Count", f: (t) => t[key].count },
      { h: "Min", f: (t) => fmt(t[key].min) },
      { h: "Avg", f: (t) => fmt(t[key].avg) },
      { h: "Max", f: (t) => fmt(t[key].max) },
      { h: "StdDev", f: (t) => fmt(t[key].stddev) },
      { h: "P50", f: (t) => fmt(t[key].p.p50) },
      { h: "P90", f: (t) => fmt(t[key].p.p90) },
      { h: "P95", f: (t) => fmt(t[key].p.p95) },
      { h: "P99", f: (t) => fmt(t[key].p.p99) },
      { h: "TPS", f: (t) => fmt(t[key].tps, 4) },
    ];
    if (key === "full" && r.transactions.some((t) => t.fail != null)) cols.splice(2, 0, { h: "Pass", f: (t) => (t.pass == null ? "-" : t.pass) }, { h: "Fail", f: (t) => (t.fail == null ? "-" : t.fail) });
    if (key === "steady" && r.transactions.some((t) => t.sla)) cols.push({ h: "SLA", f: (t) => (t.sla ? `${t.sla.pass ? "PASS" : "FAIL"} ${fmt(t.sla.threshold, 2)}` : "-") });
    out.push(table(r.transactions, cols));
  }
  if (r.transactions.some((t) => t.lre)) {
    const g = (r.transactions.find((t) => t.lre) || {}).lre.granularitySec;
    out.push("");
    out.push(`== Transaction summary — LRE Analysis style (means of ${g} s × load-generator buckets; count/avg are exact) ==`);
    out.push(table(r.transactions.filter((t) => t.lre), [
      { h: "Transaction", f: (t) => t.name, left: true },
      { h: "Pass", f: (t) => t.pass }, { h: "Fail", f: (t) => t.fail },
      { h: "Min", f: (t) => fmt(t.lre.min) }, { h: "Avg", f: (t) => fmt(t.lre.avg) }, { h: "Max", f: (t) => fmt(t.lre.max) },
      { h: "StdDev", f: (t) => fmt(t.lre.stddev) }, { h: "P90", f: (t) => fmt(t.lre.p.p90) },
    ]));
  }
  if (r.web) {
    out.push("");
    out.push("== Web (from RawData.eve data points) ==");
    out.push(`Total hits: ${r.web.hits}   avg hits/s: ${fmt(r.web.hitsPerSec.avg, 2)}   total throughput: ${r.web.throughputBytes} bytes   avg bytes/s: ${fmt(r.web.throughputBytesPerSec.avg, 0)}`);
    out.push("HTTP codes: " + r.web.httpCodes.map((c) => `${c.name}=${c.count}`).join("  "));
  }
  if (r.errors) {
    out.push("");
    out.push(`== Errors (${r.errors.total}) ==`);
    for (const g of r.errors.summary.slice(0, 20)) out.push(`${String(g.count).padStart(8)}  code ${g.code}  ${g.pattern.slice(0, 140)}`);
  }
  if (r.insights) {
    out.push("");
    out.push(`== Insights — ${r.insights.verdict.text} ==`);
    for (const f of r.insights.findings) out.push(`${f.severity.toUpperCase().padEnd(8)} ${f.title}: ${f.text}`);
  }
  if (r.eve) {
    out.push("");
    out.push("== RawData.eve record signatures ==");
    for (const s of r.eve.signatures.slice(0, 20)) out.push(`${String(s.count).padStart(12)}  ${s.signature}`);
  }
  out.push("");
  out.push("== Self-check ==");
  for (const c of r.selfCheck) {
    out.push(`${c.status.toUpperCase().padEnd(4)} ${c.id}: ${c.text}`);
    if (c.data !== undefined) out.push("       " + JSON.stringify(c.data));
  }
  return out.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.folder) {
    console.log("Usage: node lre-results-analyser/cli/analyse.js <results-folder | results.zip> [--xlsx f.xlsx] [--docx f.docx] [--html f.html] [--out f.json]\n" +
      "       [--sla seconds] [--sla-pct 90] [--window start-end] [--granularity s] [--exact-limit n] [--lre-granularity s] [--redact] [--quiet]");
    process.exit(args.help ? 0 : 2);
  }
  const input = path.resolve(args.folder);
  if (!fs.existsSync(input)) throw new Error(`Not found: ${input}`);
  const st = fs.statSync(input);
  const isZip = st.isFile() && /\.zip$/i.test(input);
  if (!isZip && !st.isDirectory()) throw new Error(`Not a folder or .zip file: ${input}`);

  const t0 = Date.now();
  let lastPct = -1;
  const settings = { window: args.window, sla: { percentile: args.slaPct, defaultSec: Number.isFinite(args.sla) ? args.sla : null, perTx: {} },
    granularitySec: args.granularity && args.granularity !== "auto" ? Number(args.granularity) : null };
  let result = await analyse(isZip ? await zipSource(input) : folderSource(input), {
    settings,
    lreGranularitySec: Number.isFinite(args.lreGranularity) ? args.lreGranularity : undefined,
    exactLimit: Number.isFinite(args.exactLimit) ? args.exactLimit : undefined,
    onProgress: (done, total) => {
      if (args.quiet || !total || !process.stderr.isTTY) return;
      const pct = Math.floor((done / total) * 100);
      if (pct !== lastPct) { lastPct = pct; process.stderr.write(`\rRawData.eve ${pct}%`); }
    },
  });
  if (lastPct >= 0) process.stderr.write("\n");
  if (args.redact) result = redact(result);
  result.elapsedSec = (Date.now() - t0) / 1000;

  if (!args.quiet) console.log(report(result));
  const written = [];
  if (args.xlsx) {
    const ExcelJS = require("exceljs");
    const { buildWorkbook } = require("../report/xlsx");
    await buildWorkbook(result, ExcelJS).xlsx.writeFile(args.xlsx);
    written.push(args.xlsx);
  }
  if (args.docx) {
    const D = require("docx");
    const { buildDocument } = require("../report/docx");
    fs.writeFileSync(args.docx, await D.Packer.toBuffer(buildDocument(result, D, {})));
    written.push(args.docx);
  }
  if (args.html) {
    const { buildReport } = require("../report/html");
    fs.writeFileSync(args.html, buildReport(result, { charts: renderSvgCharts(result) }));
    written.push(args.html);
  }
  if (args.out) {
    fs.writeFileSync(args.out, JSON.stringify(result, null, 2));
    written.push(args.out);
  }
  if (written.length && !args.quiet) console.log(`\nWritten: ${written.join(", ")} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
  process.exit(result.selfCheck.some((c) => c.status === "fail") ? 1 : 0);
}

if (require.main === module) {
  main().catch((e) => { process.stderr.write(`Error: ${e.message || e}\n`); process.exit(2); });
}

module.exports = { folderSource, zipSource, renderSvgCharts, report, parseArgs };
