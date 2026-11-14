/* Workload Modeller — Excel: the results workbook and the scripts sheet (download, read back). ExcelJS (the Results
   Analyser's vendor copy) is loaded the first time Excel is used, so the page opens without its 950 KB. */
"use strict";
// ExcelJS on first use (one copy for the whole portal: the Results Analyser's vendor file); a failed load can be retried
let excelLib = null;
function loadExcel() {
  if (window.ExcelJS) return Promise.resolve();
  return excelLib || (excelLib = new Promise((ok, fail) => {
    const s = document.createElement("script"); s.src = "ra/vendor/exceljs.min.js";
    s.onload = () => (window.ExcelJS ? ok() : fail(new Error("the Excel library did not start")));
    s.onerror = () => { excelLib = null; s.remove(); fail(new Error("the Excel library could not be loaded")); };
    document.head.append(s);
  }));
}
// a button that writes an Excel file: says so when the library cannot be loaded instead of failing silently
const withExcel = (fn, mode) => async () => {
  try { await loadExcel(); if ((await fn()) !== false) used(mode); }
  catch (e) { toast(`Excel file not made: ${e.message}. Check the connection to PerfX Studio and try again.`); }
};
// usage statistics (portal/track.js): which feature was used and for how many scripts — never names or numbers
function used(mode, n) {
  if (window.PerfxTrack) window.PerfxTrack.send({ tool: "workload", mode, requestCount: n == null ? state.groups.length : n, result: "success" });
}
/* ---------- Excel: what to type into the LRE scenario, and what to expect — one sheet ----------
   A few lines about the test, then one row per LRE group by script name (a script split to fill the machines has one
   row per group): Vusers, share, response time, think time, pacing, load generators, Start (ramp-up), Duration (steady
   state), Stop (ramp-down) — LRE's own fields, times HH:MM:SS as LRE asks for them —, the expected iterations and TPS,
   and a total. The calculation detail stays on the page (Details). */
async function excel() {
  const r = last; if (!r || !r.ready) { toast("Complete the inputs first — see Checks."); return false; }   // nothing made: no usage ping
  const wb = new ExcelJS.Workbook(); wb.creator = "PerfX Studio — Workload Modeller";
  const ws = wb.addWorksheet("LRE scenario", { views: [{ state: "frozen", ySplit: 9 }] });
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
  const PURPLE = "FF5B21B6", t = r.totals, byGroup = r.workload === "basic-group";
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
  const line = { style: "thin", color: { argb: "FFD6D0E6" } }, box = { top: line, left: line, bottom: line, right: line };
  ws.addRow(["Workload model — LRE scenario"]).font = { bold: true, size: 15, color: { argb: "FF4C1D95" } };
  const ph = phases(r).rows, steady = ph.find((x) => x.steady);
  const machines = r.machines.map((m) => m.name);
  [["Test type", E.TEST_TYPES[r.scenario.testType].label.replace(/ \(.*/, "")], ["LRE workload type", r.workloadLabel],
   ["Load generators", r.lgTotal == null ? "machine size needed" : `${r.lgTotal}${machines.length ? ` (${machines.length > 6 ? machines[0] + " – " + machines[machines.length - 1] : machines.join(", ")})` : ""} — ${r.lg.filter((x) => x.total).map((x) => `${x.pool.name}${x.extra ? `: ${x.needed} + ${x.extra} extra` : ""}`).join(", ")}`],
   ["Total test length", E.hms(r.duration)],
   ["Steady state — measure here", steady ? `${E.hms(steady.from)} → ${E.hms(steady.to)} (${E.hms(steady.to - steady.from)})` : "—"],
  ].forEach(([k, v]) => { const row = ws.addRow([k, v]); row.getCell(1).font = { bold: true }; ws.mergeCells(row.number, 2, row.number, 8); });
  // a schedule for all groups together: its steps (a by-group schedule has them per row)
  const steps1 = byGroup ? [] : r.lre.split("\n").filter((l) => /^(Start Vusers|Duration|Stop Vusers|Goal type|Reach goal|Number of Vusers|Run for)/.test(l));
  const sline = ws.addRow(["Schedule", byGroup
    ? `Every group: Start Group Immediately · Initialize each Vuser just before it runs · Start, Duration and Stop per row below — all reach full load at ${E.hms(r.firstFull)} and stop together`
    : ["Initialize each Vuser just before it runs"].concat(steps1).join("  ·  ")]);
  sline.getCell(1).font = { bold: true }; ws.mergeCells(sline.number, 2, sline.number, 12); sline.getCell(2).alignment = { wrapText: true };
  ws.addRow([]);
  const nameW = Math.min(60, Math.max(20, ...r.groups.map((g) => String(g.name).length + 2)));
  const cols = [["Script", nameW], ["Vusers", 9], ["% of Vusers", 11], ["Response time (s)", 12], ["Think time", 18], ["Pacing", 16], ["Load generators", 18],
    ["Start (ramp-up)", 22], ["Duration (steady state)", 13], ["Stop (ramp-down)", 22], ["Expected iterations", 13], ["Expected TPS", 11]];
  const h = ws.addRow(cols.map((c) => c[0]));
  h.height = 30; h.eachCell((c) => { c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = fill(PURPLE); c.alignment = { vertical: "middle", wrapText: true }; c.border = box; });
  cols.forEach(([, w], i) => { ws.getColumn(i + 1).width = w; });
  const src = lastResolved || state.groups;
  let iters = 0, tps = 0;
  (r.lreGroups || []).forEach((x, k) => {
    const g = r.groups[x.gi], share = g.vusers ? x.vusers / g.vusers : 0;
    const rt = src[x.gi] && src[x.gi].rtAvg != null ? +src[x.gi].rtAvg : g.rtBudget > 0 ? `under ${+g.rtBudget.toFixed(2)} (limit)` : "—";
    const pl = byGroup && r.groupPlans.find((p) => p.group.id === x.id);
    const sched = pl ? [steps(pl.actions[0]), E.hms(pl.actions[1].dur), steps(pl.actions[2])]
      : ["see Schedule", steady ? E.hms(steady.to - steady.from) : "—", "see Schedule"];
    const it = Math.round(g.iters.total * share), tp = g.tps * share;
    iters += it; tps += tp;
    const row = ws.addRow([g.name, x.vusers, t.vusers ? x.vusers / t.vusers : 0, rt,
      thinkShort(x.gi), paceShort(g.pacing), x.lgs && x.lgs.length ? lgNames(x.lgs) : "machine size needed", ...sched, it, +tp.toFixed(2)]);
    row.eachCell({ includeEmpty: true }, (c) => { c.border = box; if (k % 2) c.fill = fill("FFF7F5FC"); c.alignment = { vertical: "middle" }; });
  });
  const tot = ws.addRow(["Total", t.vusers, 1, "", "", "", r.lgTotal == null ? "" : `${r.lgTotal} load generator${r.lgTotal === 1 ? "" : "s"}`, "", steady ? E.hms(steady.to - steady.from) : "", "", iters, +tps.toFixed(2)]);
  tot.eachCell({ includeEmpty: true }, (c) => { c.font = { bold: true }; c.border = { top: { style: "medium", color: { argb: PURPLE } }, bottom: line }; c.fill = fill("FFEDE9FE"); });
  ws.getColumn(3).numFmt = "0.0%"; ws.getColumn(11).numFmt = "#,##0"; ws.getColumn(12).numFmt = "0.00";
  ws.addRow([]);
  const notes = ["Times are HH:MM:SS, as LRE asks for them. Start and Stop: gradually — Vusers per step, every interval · the whole length; each Vuser finishes its current iteration when it stops. LRE counts the Duration from the end of the group's start."];
  if ((r.lreGroups || []).some((x) => x.parts > 1)) notes.push("A script on two rows fills one load generator and goes on to another: add it to the scenario once per row (LRE names the second group itself), with the same runtime settings.");
  notes.forEach((n) => { const row = ws.addRow([n]); row.getCell(1).font = { italic: true, size: 9, color: { argb: "FF56677F" } }; ws.mergeCells(row.number, 1, row.number, 12); });
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = "workload-model.xlsx"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$("#btn-xlsx").addEventListener("click", withExcel(excel, "excel"));
$("#btn-copy").addEventListener("click", async () => {
  if (!last || !last.ready) { toast("Complete the inputs first — see Checks."); return; }
  try { await navigator.clipboard.writeText($("#lre").textContent); used("copy"); toast("LRE settings copied — paste them where you need them."); }
  catch (e) { toast("The browser did not allow copying — open “The same as text” under Details › LRE setup and copy from there."); }
});

/* ---------- the scripts as an Excel sheet ---------- */
// One row per script — only what the requirements give (see XL_COLS); empty rows are truly empty, the hint for a column
// shows when a cell is clicked. Reading back: by column name; an empty cell or a missing column keeps the page's value; a name
// matches a card (ignoring case, a "(2)" copy suffix and punctuation); a new name adds a script. Older sheets (every
// column, the older short words TPS, Fixed, Auto …) are still understood.
const XL_LISTS = {
  protocol: Object.entries(PROTOS).map(([k, v]) => [k, v.label, ({ web: ["Web HTTP/HTML", "Web HTTP", "Web"], other: ["Other"] })[k] || []]),
  method: METHODS.map(([k, l]) => [k, l, [METHODS_OLD[k]].concat(({ tps: ["TPS"], volume: ["Volume per hour", "Volume"], share: ["Share of total (%)", "Share"], vusers: ["Vusers"], vusers_tps: ["Vusers and TPS"], iterations: ["Iterations"] })[k])]),
  pacing: PACING.map(([k, l]) => [k, l, ({ auto: ["Auto (the tool chooses)", "Auto"], fixed: ["Fixed"], random: ["Random"], asap: ["As soon as possible", "ASAP"], after: ["After + delay", "After"] })[k]]),
  thinkMode: THINK.map(([k, l]) => [k, l, ({ random: ["Random %"] })[k] || []]),
  rtSource: RTSRC.map(([k, l]) => [k, l, []]),
  kind: KINDS.map(([k, l]) => [k, l, ({ auto: ["Auto", "From script"], web: ["Web", "Pages"], api: ["API"] })[k]]),
};
const xlL = (list, key) => (XL_LISTS[list].find((x) => x[0] === key) || [])[1] || "";
// The sheet asks only for what the requirements (NFRs) give: the script, its type, one iteration, the response time and
// ONE target — TPS, transactions per hour or Vusers — plus the test duration once, above the table. Everything else
// (think time, pacing, load generators …) is read from the script ZIP or chosen by the tool, and can be changed on the page.
// key, header, width, needed, hint (shown when a cell is clicked), kind (list name | num | text)
const XL_ONE = "Fill ONE of Transactions per hour, TPS or Vusers (per hour or TPS together with Vusers = those Vusers reaching that rate).";
const XL_COLS = [
  ["name", "Script name", 34, true, "One row per script. The same name as on the page updates that script; a new name adds one.", "text"],
  ["protocol", "Script type (protocol)", 24, false, "Pick from the list. Empty: read from the script ZIP, else Web - HTTP/HTML.", "protocol"],
  ["txPerIter", "Transactions per iteration", 16, true, "The transactions in one iteration of the script. Read from the script ZIP when you drop it too.", "num"],
  ["thinkPerIter", "Think time (s)", 12, false, "The think time of one whole iteration, in seconds. Read from the script ZIP when you drop it too. Empty: the page keeps its value (10 s for a new script).", "num"],
  ["rtAvg", "Response time (s)", 14, true, "Per transaction: the expected response time (SLA) or a measured average.", "num"],
  ["perHour", "Transactions per hour", 15, false, "Transactions in the peak hour — what the requirements usually give. " + XL_ONE, "num"],
  ["tps", "TPS", 11, false, "Transactions per second the script must reach. " + XL_ONE, "num"],
  ["vusers", "Vusers", 11, false, "The Vusers to run. " + XL_ONE, "num"],
];
// columns of older sheets — still read (by name), never written
const XL_OLD = [["protocol", "Protocol"], ["kind", "Kind of script"], ["method", "Target type"], ["method", "Size it by"], ["target", "Target"],
  ["tps2", "Target TPS (with Vusers)"], ["tps2", "TPS (Vusers and TPS)"], ["rtSource", "Response time from"], ["rt90", "90th percentile (s)"],
  ["thinkMode", "Think time at replay"], ["pacing", "Pacing"], ["pace1", "Pacing (s)"], ["pace2", "Longest pacing (s)"], ["thinkFactor", "Multiply by"],
  ["thinkMinPct", "Random from (%)"], ["thinkMaxPct", "Random to (%)"], ["pool", "Runs on"], ["dataRows", "Data rows available"], ["perLg", "Vusers per machine"],
  ["requestsPerIter", "Requests"]];
const XL_ALL = XL_COLS.map((x) => [x[0], x[1]]).concat(XL_OLD);   // [key, header]: every column the reader knows
const XL_DUR = "Test duration — steady state (minutes)";
const XL_HINT = "one row per script";   // the hint row of older sheets
const xlNorm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9%+]+/g, "");
// a page script as a row; a target the sheet has no column for (a share, iterations) stays empty — the page keeps it
function xlRow(g) {
  const m = g.method;
  return { name: g.name, protocol: g.protocol ? xlL("protocol", g.protocol) : null, txPerIter: g.txPerIter, thinkPerIter: g.thinkPerIter, rtAvg: g.rtAvg,
    tps: m === "tps" || m === "vusers_tps" ? g.targetTps : null, perHour: m === "volume" ? g.volumePerHour : null, vusers: m === "vusers" || m === "vusers_tps" ? g.vusers : null };
}
async function downloadSheet() {
  const wb = new ExcelJS.Workbook(); wb.creator = "Workload Modeller";
  const scripts = state.groups.filter((g) => !g.sample);
  const cols = XL_COLS;
  const HEAD = 4;                                          // title, one line, the test duration, then the column names
  const ws = wb.addWorksheet("Scripts", { views: [{ state: "frozen", xSplit: 1, ySplit: HEAD, zoomScale: 100 }] });
  const PURPLE = "FF5B21B6", line = { style: "thin", color: { argb: "FFD6D0E6" } }, box = { top: line, left: line, bottom: line, right: line };
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb }, bgColor: { argb } });
  const C = (k) => { const i = cols.findIndex((x) => x[0] === k); return i < 0 ? null : (i >= 26 ? "A" : "") + String.fromCharCode(65 + (i % 26)); };
  ws.getCell(1, 1).value = "Workload model — scripts";
  ws.getCell(1, 1).font = { bold: true, size: 15, color: { argb: "FF4C1D95" } };
  ws.getCell(2, 1).value = "One row per script. Columns with * are needed, and ONE of Transactions per hour, TPS or Vusers. Pacing and load generators are worked out by the tool. Click a cell to see what it wants.";
  ws.getCell(2, 1).font = { italic: true, size: 10, color: { argb: "FF56677F" } };
  // the test duration: once for the whole test
  const dl = ws.getCell(3, 1), dv3 = ws.getCell(3, 2);
  dl.value = XL_DUR; dl.font = { bold: true, color: { argb: "FF4C1D95" } }; dl.alignment = { vertical: "middle" };
  dv3.value = state.scenario.steadyMin; dv3.font = { bold: true }; dv3.fill = fill("FFEDE9FE"); dv3.border = box; dv3.alignment = { horizontal: "left", vertical: "middle" };
  dv3.dataValidation = { type: "decimal", operator: "greaterThan", allowBlank: true, formulae: [0], showErrorMessage: true, errorStyle: "warning", errorTitle: "Test duration",
    error: "Enter the minutes at full load.", showInputMessage: true, promptTitle: "Test duration (minutes)", prompt: "How long the test runs at full load (the steady state), in minutes — for every script." };
  ws.getRow(3).height = 22;
  const h = ws.getRow(HEAD); h.height = 32;
  cols.forEach(([key, head, width, needed], i) => {
    const c = h.getCell(i + 1);
    c.value = needed ? { richText: [{ text: head + " ", font: { bold: true, color: { argb: "FFFFFFFF" } } }, { text: "*", font: { bold: true, color: { argb: "FFFDE68A" } } }] } : head;
    c.font = { bold: true, color: { argb: "FFFFFFFF" } }; c.fill = fill(PURPLE); c.border = box;
    c.alignment = { vertical: "middle", wrapText: true };
    ws.getColumn(i + 1).width = width;
  });
  // the page's scripts, then empty rows (nothing written in them: an empty cell means "the page's default")
  const rows = scripts.map(xlRow);
  const first = HEAD + 1, lastRow = first - 1 + Math.max(rows.length + 30, 50);
  for (let r = first; r <= lastRow; r++) {
    const d = rows[r - first] || {};
    cols.forEach(([key], i) => {
      const cell = ws.getCell(r, i + 1);
      if (d[key] != null && d[key] !== "") cell.value = d[key];
      cell.border = box;
      if ((r - first) % 2) cell.fill = fill("FFF7F5FC");
    });
  }
  // drop-down list for the script type (the page's own words), number checks, and the hint when a cell is clicked
  const lists = { protocol: `"${XL_LISTS.protocol.map((x) => x[1].replace(/[",]/g, " ")).join(",")}"` };
  cols.forEach(([key, head, , , hint, kind], i) => {
    const tip = { showInputMessage: true, promptTitle: head.slice(0, 32), prompt: hint.slice(0, 255) };
    const dv = lists[kind] ? Object.assign({ type: "list", allowBlank: true, formulae: [lists[kind]], showErrorMessage: true, errorStyle: "warning", errorTitle: head, error: "Pick a value from the list." }, tip)
      : kind === "num" ? Object.assign({ type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorStyle: "warning", errorTitle: head, error: "Enter a number (0 or more)." }, tip)
      : Object.assign({ type: "textLength", operator: "lessThanOrEqual", allowBlank: true, formulae: [200] }, tip);
    for (let r = first; r <= lastRow; r++) ws.getCell(r, i + 1).dataValidation = dv;
  });
  // amber = still needed on a row with a script name. The target: not on a page script whose target the sheet has no
  // column for (a share of the total, iterations) — the page keeps that one.
  const amber = { fill: fill("FFFEF3C7") };
  let pri = 1;
  // one rule per block of rows; the formula speaks of the block's first row (Excel moves it down the block)
  const cf = (k1, k2, a, b, test) => ws.addConditionalFormatting({ ref: `${C(k1)}${a}:${C(k2)}${b}`,
    rules: [{ type: "expression", priority: pri++, formulae: [test((k) => `$${C(k)}${a}`)], style: amber }] });
  cf("txPerIter", "txPerIter", first, lastRow, (v) => `AND(${v("name")}<>"",${v("txPerIter")}="")`);
  if (!(state.common.rtAvg > 0)) cf("rtAvg", "rtAvg", first, lastRow, (v) => `AND(${v("name")}<>"",${v("rtAvg")}="")`);
  if (!(state.common.tps > 0)) {
    const kept = new Set(scripts.map((g, i) => (["share", "iterations"].includes(g.method) ? first + i : 0)));
    let a = null;
    for (let r = first; r <= lastRow + 1; r++) {
      const on = r <= lastRow && !kept.has(r);
      if (on && a == null) a = r;
      if (!on && a != null) { cf("perHour", "vusers", a, r - 1, (v) => `AND(${v("name")}<>"",${v("tps")}="",${v("perHour")}="",${v("vusers")}="")`); a = null; }
    }
  }

  // second sheet: how to fill it in — short
  const hw = wb.addWorksheet("How to fill it in");
  hw.getColumn(1).width = 28; hw.getColumn(2).width = 90;
  hw.addRow(["Workload model — the scripts sheet"]).font = { bold: true, size: 15, color: { argb: "FF4C1D95" } };
  hw.addRow([]);
  ["1. Write the test duration (minutes at full load) once, above the table.",
   "2. One row per script: its name, script type, the transactions and think time of one iteration (what a script ZIP gives) and the response time (SLA or a measured average).",
   "3. Give each script ONE target from your requirements: transactions per hour, TPS, or Vusers. Amber cells are still needed.",
   "4. Save, then drop the file on the page (“Fill in with Excel”). Drop the script ZIPs with it and the transactions, script type and think time are read from them.",
  ].forEach((x) => hw.addRow([x]));
  hw.addRow([]);
  const hh = hw.addRow(["Column", "What to write"]);
  hh.eachCell((x) => { x.font = { bold: true, color: { argb: "FFFFFFFF" } }; x.fill = fill(PURPLE); });
  [[XL_DUR, "Once for the whole test: how long it runs at full load, in minutes."]].concat(cols.map(([, head, , needed, hint]) => [head + (needed ? " *" : ""), hint])).forEach(([a, b], i) => {
    const row = hw.addRow([a, b]);
    row.getCell(1).font = { bold: true }; row.getCell(2).alignment = { wrapText: true, vertical: "top" }; row.getCell(1).alignment = { vertical: "top", wrapText: true };
    if (i % 2) row.eachCell((x) => { x.fill = fill("FFF7F5FC"); });
  });
  hw.addRow([]);
  hw.addRow(["", "Pacing, ramp-up and load generators are worked out by the tool. Change them on the page if you need to — an empty cell or a missing column never overwrites what the page has."]).getCell(2).font = { italic: true, color: { argb: "FF56677F" } };
  const buf = await wb.xlsx.writeBuffer();
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  a.download = "workload-scripts.xlsx"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
$("#btn-xl-tpl").addEventListener("click", withExcel(downloadSheet, "sheet"));

// read a filled-in sheet: { rows: [{ row, values }], problems }
const cellText = (v) => (v == null ? "" : typeof v === "object" ? (v.richText ? v.richText.map((x) => x.text).join("") : v.result != null ? v.result : v.text != null ? v.text : v.formula ? "" : "") : v);
async function readSheet(file) {
  await loadExcel();
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.getWorksheet("Scripts") || wb.worksheets[0];
  if (!ws) throw new Error("no sheet");
  let headRow = 0, duration = null; const col = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headRow; r++) {
    ws.getRow(r).eachCell((cell) => { if (xlNorm(cellText(cell.value)).replace(/\*/g, "") === "scriptname") headRow = r; });
    if (headRow) ws.getRow(r).eachCell((cell, ci) => {
      const h = xlNorm(cellText(cell.value));
      const k = XL_ALL.find((x) => xlNorm(x[1]) === h);
      if (k) col[k[0]] = ci;
    });
    // the test duration: the first value right of its label, above the table
    else ws.getRow(r).eachCell((cell, ci) => {
      if (duration == null && xlNorm(cellText(cell.value)).startsWith("testduration")) {
        for (let c = ci + 1; c <= ci + 3; c++) { const v = cellText(ws.getRow(r).getCell(c).value); if (v !== "" && v != null) { duration = v; break; } }
      }
    });
  }
  if (!headRow) throw new Error("no “Script name” column — use the sheet from “Excel sheet”");
  const rows = [], problems = [];
  for (let r = headRow + 1; r <= ws.rowCount; r++) {
    const row = ws.getRow(r), values = {};
    Object.keys(col).forEach((k) => { const v = cellText(row.getCell(col[k]).value); if (v !== "" && v != null) values[k] = typeof v === "string" ? v.trim() : v; });
    if (!values.name || xlNorm(values.name) === xlNorm(XL_HINT)) continue;
    rows.push({ row: r, values });
  }
  // without a "Pacing" choice column, "Pacing (s)" alone says it: a number = fixed, "auto" (or the like) = the tool chooses
  return { rows, problems, duration, paceOnly: col.pace1 != null && col.pacing == null };
}
// apply one sheet to the cards; returns the line for the import note
function applySheet(x) {
  let updated = 0, added = 0;
  const problems = x.problems.slice();
  const pick = (list, v, r, head) => {
    const n = xlNorm(v);
    const hit = XL_LISTS[list].find(([k, l, al]) => xlNorm(l) === n || xlNorm(k) === n || (al || []).some((a) => xlNorm(a) === n))
      || XL_LISTS[list].find(([, l]) => n && xlNorm(l).startsWith(n));
    if (!hit) problems.push(`row ${r}: “${v}” is not a ${head} choice — kept the page's value`);
    return hit && hit[0];
  };
  const num = (v, r, head) => { const f = typeof v === "number" ? v : parseFloat(String(v).replace(/[\s,]/g, "")); if (!Number.isFinite(f) || f < 0) { problems.push(`row ${r}: ${head} “${v}” is not a number — kept`); return null; } return f; };
  x.rows.forEach(({ row: r, values: v }) => {
    const m = matchScript(v.name);
    if (m.many) { problems.push(`row ${r}: “${v.name}” fits more than one script (${m.many.map((y) => y.name).join(", ")}) — row not used; write the full name`); return; }
    let g = m.g;
    if (g) updated++;
    else { g = newScript({ name: String(v.name), targetTps: null, pool: state.pools[0].id, folded: true, source: x.file }); state.groups.push(g); added++; }
    g.sample = false; g.folded = true;
    if (v.protocol != null) { const k = pick("protocol", v.protocol, r, "Protocol"); if (k) g.protocol = k; }
    if (v.method != null) { const k = pick("method", v.method, r, "Target type"); if (k) g.method = k; }
    if (v.target != null) {
      const f = num(v.target, r, "Target");
      if (f != null) { const key = { tps: "targetTps", volume: "volumePerHour", share: "sharePct", vusers: "vusers", vusers_tps: "vusers", iterations: "iterations" }[g.method]; g[key] = f; }
    }
    if (v.tps2 != null) { const f = num(v.tps2, r, "Target TPS"); if (f != null) g.targetTps = f; }
    // the target: ONE of TPS, transactions per hour, Vusers; a rate together with Vusers = those Vusers reaching that rate
    if (v.tps != null || v.perHour != null || v.vusers != null) {
      const t = v.tps != null ? num(v.tps, r, "TPS") : null, h = v.perHour != null ? num(v.perHour, r, "Transactions per hour") : null, u = v.vusers != null ? num(v.vusers, r, "Vusers") : null;
      if (t != null && h != null) problems.push(`row ${r}: both TPS and transactions per hour — used the TPS`);
      if (u != null && (t != null || h != null)) { g.method = "vusers_tps"; g.vusers = u; g.targetTps = t != null ? t : h / 3600; }
      else if (u != null) { g.method = "vusers"; g.vusers = u; }
      else if (t != null) { g.method = "tps"; g.targetTps = t; }
      else if (h != null) { g.method = "volume"; g.volumePerHour = h; }
    }
    [["txPerIter", "Transactions"], ["thinkPerIter", "Think time"], ["rtAvg", "Response time"], ["rt90", "90th percentile"], ["requestsPerIter", "Requests"], ["dataRows", "Data rows"],
     ["thinkFactor", "Multiply by"], ["thinkMinPct", "Random from"], ["thinkMaxPct", "Random to"], ["perLg", "Vusers per machine"]].forEach(([k, head]) => {
      if (v[k] != null) { const f = num(v[k], r, head); if (f != null) { g[k] = f; if (k === "rtAvg" && !g.rtSource) g.rtSource = "sla"; } }
    });
    if (v.rtSource != null) { const k = pick("rtSource", v.rtSource, r, "Response time from"); if (k) g.rtSource = k; }
    if (v.pacing != null) { const k = pick("pacing", v.pacing, r, "Pacing"); if (k) g.pacing = Object.assign({}, g.pacing, { mode: k }); }
    const pm = (g.pacing && g.pacing.mode) || "auto";
    if (v.pace1 != null && x.paceOnly) {
      if (/^(auto|tool|let|the tool)/i.test(String(v.pace1).trim())) g.pacing = Object.assign({}, g.pacing, { mode: "auto" });
      else { const f = num(v.pace1, r, "Pacing"); if (f != null) g.pacing = Object.assign({}, g.pacing, { mode: "fixed", fixed: f }); }
    } else if (v.pace1 != null) { const f = num(v.pace1, r, "Pacing"); if (f != null) { g.pacing = Object.assign({}, g.pacing); g.pacing[pm === "random" ? "min" : pm === "after" ? "delay" : "fixed"] = f; } }
    if (v.pace2 != null) { const f = num(v.pace2, r, "Longest pacing"); if (f != null) { g.pacing = Object.assign({}, g.pacing, { max: f }); } }
    if (v.thinkMode != null) { const k = pick("thinkMode", v.thinkMode, r, "Think time at replay"); if (k) g.thinkMode = k; }
    if (v.kind != null) { const k = pick("kind", v.kind, r, "Kind of script"); if (k) g.kind = k; }
    if (v.pool != null) {
      const pool = state.pools.find((y) => y.name.trim().toLowerCase() === String(v.pool).trim().toLowerCase());
      if (pool) g.pool = pool.id; else problems.push(`row ${r}: no load-generator pool called “${v.pool}” — kept`);
    }
  });
  let dur = null;
  if (x.duration != null) {
    const f = num(x.duration, 3, "Test duration");
    if (f > 0) { state.scenario.steadyMin = f; dur = `test duration ${fmt(f, f % 1 ? 1 : 0)} min`; } else if (f === 0) problems.push("row 3: a test duration of 0 minutes — kept the page's value");
  }
  const did = [updated && `${updated} script${updated === 1 ? "" : "s"} updated`, added && `${added} script${added === 1 ? "" : "s"} added`, dur].filter(Boolean).join(", ") || "no rows with a script name";
  return `<b>${esc(x.file)}: ${did}.</b>${
    problems.length ? `<div class="wm-skip"><b>${problems.length} value${problems.length === 1 ? " was" : "s were"} not used:</b><ul>${problems.slice(0, 15).map((y) => `<li>${esc(y)}</li>`).join("")}${problems.length > 15 ? `<li>and ${problems.length - 15} more</li>` : ""}</ul></div>` : ""}`;
}
