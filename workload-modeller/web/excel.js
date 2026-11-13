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
// One row per script, the same fields and the same words as a script card on the page. Downloaded with the page's
// scripts in it and empty rows that already hold the page's defaults (pick from the drop-down lists to change them);
// filled in in Excel; dropped back. Excel behaves like the card: cells that do not apply to the row's choices turn
// grey, a value still needed turns amber, and "Target means" says what the Target number is.
// Reading back: empty cell = keep the page's value; a name matches a card (ignoring case, a "(2)" copy suffix and
// punctuation); a new name adds a script. The older short words (TPS, Fixed, Auto …) are still understood.
const XL_LISTS = {
  protocol: Object.entries(PROTOS).map(([k, v]) => [k, v.label, ({ web: ["Web HTTP/HTML", "Web HTTP", "Web"], other: ["Other"] })[k] || []]),
  method: METHODS.map(([k, l]) => [k, l, [METHODS_OLD[k]].concat(({ tps: ["TPS"], volume: ["Volume per hour", "Volume"], share: ["Share of total (%)", "Share"], vusers: ["Vusers"], vusers_tps: ["Vusers and TPS"], iterations: ["Iterations"] })[k])]),
  pacing: PACING.map(([k, l]) => [k, l, ({ auto: ["Auto (the tool chooses)", "Auto"], fixed: ["Fixed"], random: ["Random"], asap: ["As soon as possible", "ASAP"], after: ["After + delay", "After"] })[k]]),
  thinkMode: THINK.map(([k, l]) => [k, l, ({ random: ["Random %"] })[k] || []]),
  rtSource: RTSRC.map(([k, l]) => [k, l, []]),
  kind: KINDS.map(([k, l]) => [k, l, ({ auto: ["Auto", "From script"], web: ["Web", "Pages"], api: ["API"] })[k]]),
};
const xlL = (list, key) => (XL_LISTS[list].find((x) => x[0] === key) || [])[1] || "";
// key, header, group, width, needed, hint, kind (list name | num | text | calc)
const XL_COLS = [
  ["name", "Script name", 0, 30, true, "one row per script", "text"],
  ["protocol", "Protocol", 0, 17, false, "pick from the list", "protocol"],
  ["method", "Target type", 1, 34, true, "pick from the list", "method"],
  ["target", "Target", 1, 12, true, "a number — see “Target means”", "num"],
  ["unit", "Target means", 1, 24, false, "filled in by Excel", "calc"],
  ["tps2", "Target TPS (with Vusers)", 1, 14, false, "only with “Vusers and TPS”", "num"],
  ["txPerIter", "Transactions per iteration", 2, 14, false, "that count for the TPS", "num"],
  ["thinkPerIter", "Think time (s)", 2, 12, false, "total, as recorded", "num"],
  ["rtAvg", "Response time (s)", 2, 13, false, "average per transaction", "num"],
  ["rtSource", "Response time from", 2, 28, false, "pick from the list", "rtSource"],
  ["rt90", "90th percentile (s)", 2, 13, false, "optional — the worst case", "num"],
  ["requestsPerIter", "Requests", 2, 11, false, "per iteration — hits per second", "num"],
  ["pacing", "Pacing", 3, 36, false, "pick from the list", "pacing"],
  ["pace1", "Pacing (s)", 3, 12, false, "Fixed: every · Random: shortest · After: delay", "num"],
  ["pace2", "Longest pacing (s)", 3, 12, false, "Random only", "num"],
  ["thinkMode", "Think time at replay", 3, 22, false, "pick from the list", "thinkMode"],
  ["thinkFactor", "Multiply by", 3, 11, false, "with “Multiply recorded”", "num"],
  ["thinkMinPct", "Random from (%)", 3, 12, false, "with “Random %”", "num"],
  ["thinkMaxPct", "Random to (%)", 3, 12, false, "with “Random %”", "num"],
  ["pool", "Runs on", 4, 18, false, "a load-generator pool", "pool"],
  ["dataRows", "Data rows available", 4, 13, false, "optional — warns when short", "num"],
  ["kind", "Kind of script", 4, 18, false, "for the load generators", "kind"],
  ["perLg", "Vusers per machine", 4, 13, false, "optional — your figure, replaces the rule", "num"],
];
// groups: name, band colour, header tint
const XL_GROUPS = [["Script", "FF1E3A8A", "FFE0E7FF"], ["Target", "FF2563EB", "FFDBEAFE"], ["One iteration", "FF0F766E", "FFCCFBF1"],
  ["Replay in LRE", "FF6D28D9", "FFEDE9FE"], ["Load generators and data", "FF475569", "FFE2E8F0"]];
const XL_HINT = "one row per script";
const XL_UNIT = { tps: "TPS", volume: "transactions per hour", share: "% of the scenario TPS", vusers: "Vusers", vusers_tps: "Vusers (TPS in the next column)", iterations: "iterations in full load" };
const xlNorm = (s) => String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9%+]+/g, "");
const xlCol = (key) => { const i = XL_COLS.findIndex((x) => x[0] === key); return String.fromCharCode(65 + i); };   // 23 columns: A..W
function xlRow(g) {
  const p = g.pacing || {}, m = g.method, pm = p.mode || "auto";
  const target = { tps: g.targetTps, volume: g.volumePerHour, share: g.sharePct, vusers: g.vusers, vusers_tps: g.vusers, iterations: g.iterations }[m];
  return { name: g.name, protocol: xlL("protocol", g.protocol), method: xlL("method", m), target, tps2: m === "vusers_tps" ? g.targetTps : null,
    txPerIter: g.txPerIter, thinkPerIter: g.thinkPerIter, rtAvg: g.rtAvg, rtSource: xlL("rtSource", g.rtSource || "sla"), rt90: g.rt90, requestsPerIter: g.requestsPerIter,
    pacing: xlL("pacing", pm), pace1: pm === "fixed" ? p.fixed : pm === "random" ? p.min : pm === "after" ? p.delay : null, pace2: pm === "random" ? p.max : null,
    thinkMode: xlL("thinkMode", g.thinkMode || "recorded"), thinkFactor: g.thinkMode === "multiply" ? g.thinkFactor ?? 1 : null,
    thinkMinPct: g.thinkMode === "random" ? g.thinkMinPct ?? 50 : null, thinkMaxPct: g.thinkMode === "random" ? g.thinkMaxPct ?? 150 : null,
    pool: (state.pools.find((x) => x.id === g.pool) || state.pools[0] || {}).name, dataRows: g.dataRows, kind: xlL("kind", g.kind || "auto"), perLg: g.perLg, _m: m };
}
async function downloadSheet() {
  const wb = new ExcelJS.Workbook(); wb.creator = "Workload Modeller";
  wb.calcProperties.fullCalcOnLoad = true;                  // "Target means" is always worked out afresh when the file opens
  const ws = wb.addWorksheet("Scripts", { views: [{ state: "frozen", xSplit: 1, ySplit: 3, zoomScale: 90 }] });
  const thin = { style: "thin", color: { argb: "FFCBD5E1" } }, box = { top: thin, left: thin, bottom: thin, right: thin };
  const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb }, bgColor: { argb } });
  const C = (k) => xlCol(k);
  // row 1: the coloured group bands
  let c = 1;
  XL_GROUPS.forEach(([label, band], gi) => {
    const n = XL_COLS.filter((x) => x[2] === gi).length; if (!n) return;
    if (n > 1) ws.mergeCells(1, c, 1, c + n - 1);
    const cell = ws.getCell(1, c);
    cell.value = label; cell.fill = fill(band); cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 12 };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    c += n;
  });
  ws.getRow(1).height = 26;
  // row 2: the column names (tinted by group; needed ones marked); row 3: a short hint per column
  XL_COLS.forEach(([key, head, gi, width, needed, hint, kind], i) => {
    const [, band, tint] = XL_GROUPS[gi];
    const h = ws.getCell(2, i + 1);
    h.value = needed ? { richText: [{ text: head + " ", font: { bold: true, color: { argb: "FF0F172A" } } }, { text: "*", font: { bold: true, color: { argb: "FFDC2626" } } }] } : head;
    if (!needed) h.font = { bold: true, color: { argb: kind === "calc" ? "FF475569" : "FF0F172A" }, italic: kind === "calc" };
    h.fill = fill(tint); h.alignment = { vertical: "middle", wrapText: true }; h.border = { top: thin, left: thin, right: thin, bottom: { style: "medium", color: { argb: band } } };
    const s = ws.getCell(3, i + 1);
    s.value = hint; s.font = { italic: true, size: 9, color: { argb: "FF64748B" } }; s.fill = fill("FFF8FAFC");
    s.alignment = { vertical: "top", wrapText: true }; s.border = box;
    ws.getColumn(i + 1).width = width;
  });
  ws.getRow(2).height = 34; ws.getRow(3).height = 40;
  // rows: the page's scripts (not the untouched sample), then empty rows that already hold the page's defaults
  const rows = state.groups.filter((g) => !g.sample).map(xlRow);
  const blank = xlRow({ name: "", protocol: "web", method: "tps", rtSource: "sla", thinkMode: "recorded", pacing: { mode: "auto" }, pool: state.pools[0] && state.pools[0].id });   // the page's defaults
  ["name", "target", "txPerIter", "thinkPerIter", "rtAvg", "requestsPerIter"].forEach((k) => { blank[k] = null; });
  const first = 4, lastRow = first - 1 + Math.max(rows.length + 100, 150);
  const unitFormula = (r) => {
    const m = `$${C("method")}${r}`;
    return `IF(${m}="","",` + XL_LISTS.method.map(([k, l]) => `IF(${m}="${l}","${XL_UNIT[k]}",`).join("") + `"pick “Target type”"` + ")".repeat(XL_LISTS.method.length) + ")";
  };
  for (let r = first; r <= lastRow; r++) {
    const d = rows[r - first] || blank;
    XL_COLS.forEach(([key, , , , , , kind], i) => {
      const cell = ws.getCell(r, i + 1);
      if (kind === "calc") {
        cell.value = { formula: unitFormula(r), result: d._m ? XL_UNIT[d._m] : "" };
        cell.font = { italic: true, color: { argb: "FF475569" } }; cell.fill = fill("FFF1F5F9");
      } else {
        if (d[key] != null && d[key] !== "") cell.value = d[key];
        if (r % 2) cell.fill = fill("FFF8FAFC");
      }
      cell.border = box;
    });
  }
  // drop-down lists (the page's own words) and number checks
  const listOf = (k) => `"${XL_LISTS[k].map((x) => x[1].replace(/[",]/g, " ")).join(",")}"`;
  const lists = { protocol: listOf("protocol"), method: listOf("method"), pacing: listOf("pacing"), thinkMode: listOf("thinkMode"), rtSource: listOf("rtSource"), kind: listOf("kind"),
    pool: `"${state.pools.map((x) => x.name.replace(/[",]/g, " ")).join(",")}"` };
  XL_COLS.forEach(([key, head, , , , , kind], i) => {
    if (kind === "calc" || kind === "text") return;
    const dv = lists[kind] ? { type: "list", allowBlank: true, formulae: [lists[kind]], showErrorMessage: true, errorStyle: "warning", errorTitle: head, error: "Pick a value from the list.",
      showInputMessage: true, promptTitle: head, prompt: "Pick from the list (the arrow on the right of the cell)." }
      : { type: "decimal", operator: "greaterThanOrEqual", allowBlank: true, formulae: [0], showErrorMessage: true, errorStyle: "warning", errorTitle: head, error: "Enter a number (0 or more)." };
    for (let r = first; r <= lastRow; r++) ws.getCell(r, i + 1).dataValidation = dv;
  });
  // Excel behaves like the card: grey = does not apply to this row's choices; amber = still needed
  const rng = (k) => `${C(k)}${first}:${C(k)}${lastRow}`;
  const v = (k) => `$${C(k)}${first}`;
  const grey = { fill: fill("FFE5E7EB"), font: { color: { argb: "FF9CA3AF" } } };
  const amber = { fill: fill("FFFEF3C7") };
  const cf = (k, formula, style, priority) => ws.addConditionalFormatting({ ref: rng(k), rules: [{ type: "expression", priority, formulae: [formula], style }] });
  const P = (k) => xlL("pacing", k), T = (k) => xlL("thinkMode", k);
  cf("tps2", `${v("method")}<>"${xlL("method", "vusers_tps").replace(/[",]/g, " ")}"`, grey, 1);
  cf("pace1", `AND(${v("pacing")}<>"${P("fixed")}",${v("pacing")}<>"${P("random")}",${v("pacing")}<>"${P("after")}")`, grey, 2);
  cf("pace2", `${v("pacing")}<>"${P("random")}"`, grey, 3);
  cf("thinkFactor", `${v("thinkMode")}<>"${T("multiply")}"`, grey, 4);
  cf("thinkMinPct", `${v("thinkMode")}<>"${T("random")}"`, grey, 5);
  cf("thinkMaxPct", `${v("thinkMode")}<>"${T("random")}"`, grey, 6);
  // needed: the target (unless the page gives every script a TPS), the pacing seconds, the response time when the tool chooses the pacing
  if (!(state.common.tps > 0)) cf("target", `AND(${v("name")}<>"",${v("target")}="")`, amber, 7);
  cf("tps2", `AND(${v("name")}<>"",${v("method")}="${xlL("method", "vusers_tps")}",${v("tps2")}="")`, amber, 8);
  cf("pace1", `AND(${v("name")}<>"",${v("pace1")}="",OR(${v("pacing")}="${P("fixed")}",${v("pacing")}="${P("random")}"))`, amber, 9);
  cf("pace2", `AND(${v("name")}<>"",${v("pace2")}="",${v("pacing")}="${P("random")}")`, amber, 10);
  if (!(state.common.rtAvg > 0)) cf("rtAvg", `AND(${v("name")}<>"",${v("rtAvg")}="",${v("method")}<>"${xlL("method", "vusers_tps")}",OR(${v("pacing")}="${P("auto")}",${v("pacing")}="${P("asap")}",${v("pacing")}="${P("after")}"))`, amber, 11);

  // second sheet: how to fill it in
  const hw = wb.addWorksheet("How to fill it in");
  hw.getColumn(1).width = 28; hw.getColumn(2).width = 80; hw.getColumn(3).width = 34;
  hw.addRow(["Workload Modeller — the scripts sheet"]).font = { bold: true, size: 15, color: { argb: "FF1E3A8A" } };
  hw.addRow([]);
  ["1. One row per script. The name must match the script's name on the page to update it; a new name adds a script.",
   "2. Empty rows already hold the defaults (as on the page). Change them by picking from the list — the arrow on the right of a cell.",
   "3. Columns marked * are needed: pick “Target type”, then put that number in “Target” (“Target means” tells you what it is).",
   "4. Grey cells do not apply to the choices in that row. Amber cells are still needed.",
   "5. An empty cell keeps what the page has (or the tool's choice) — fill in only what you know.",
   "6. Save, then drop the file on the page (“Drop all your scripts here”). Scripts and this sheet can be dropped together.",
  ].forEach((x) => hw.addRow([x]));
  const legend = hw.addRow(["Grey", "does not apply to this row"]); legend.getCell(1).fill = grey.fill; legend.getCell(1).font = grey.font;
  const legend2 = hw.addRow(["Amber", "still needed"]); legend2.getCell(1).fill = amber.fill;
  hw.addRow([]);
  const hh = hw.addRow(["Column", "What to write", "Example"]);
  hh.eachCell((x) => { x.font = { bold: true, color: { argb: "FFFFFFFF" } }; x.fill = fill("FF1E3A8A"); });
  const EX = { name: "Login", protocol: xlL("protocol", "web"), method: xlL("method", "tps"), target: 2, unit: "TPS", tps2: "", txPerIter: 3, thinkPerIter: 15, rtAvg: 1.5,
    rtSource: xlL("rtSource", "sla"), rt90: 2.5, requestsPerIter: 12, pacing: xlL("pacing", "auto"), pace1: "", pace2: "", thinkMode: xlL("thinkMode", "recorded"),
    thinkFactor: "", thinkMinPct: "", thinkMaxPct: "", pool: state.pools[0] ? state.pools[0].name : "On-premise", dataRows: 5000, kind: xlL("kind", "auto"), perLg: "" };
  const WHAT = {
    method: XL_LISTS.method.map((x) => x[1]).join(" · ") + ". With “A share of the scenario's total TPS”, set the scenario's total TPS on the page.",
    target: "The number “Target type” asks for: TPS, transactions per hour, a percentage, Vusers or iterations",
    unit: "Filled in by Excel from “Target type” — do not type here",
    tps2: "Only with “Vusers and TPS”: the TPS (Target then holds the Vusers)",
    rtAvg: "Average response time per transaction. Needed when the tool chooses the pacing (unless the page gives every script one); your SLA is fine",
    pacing: XL_LISTS.pacing.map((x) => x[1]).join(" · "),
    pace1: "Fixed: every N seconds · Random: the shortest · After the previous iteration: the delay",
    thinkMode: XL_LISTS.thinkMode.map((x) => x[1]).join(" · "),
    kind: "From the script (its pages and API calls, read when the script was dropped) · Web pages · API calls — sets the Vusers one load generator carries (the team rule on the pool)",
  };
  XL_COLS.forEach(([key, head, gi, , needed, hint], i) => {
    const row = hw.addRow([head + (needed ? " *" : ""), WHAT[key] || hint, EX[key]]);
    row.getCell(1).font = { bold: true, color: { argb: XL_GROUPS[gi][1] } };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
    row.getCell(1).alignment = row.getCell(3).alignment = { vertical: "top" };
    if (i % 2) row.eachCell((x) => { x.fill = fill("FFF8FAFC"); });
  });
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
  let headRow = 0; const col = {};
  for (let r = 1; r <= Math.min(10, ws.rowCount) && !headRow; r++) {
    ws.getRow(r).eachCell((cell) => { if (xlNorm(cellText(cell.value)).replace(/\*/g, "") === "scriptname") headRow = r; });
    if (headRow) ws.getRow(r).eachCell((cell, ci) => {
      const h = xlNorm(cellText(cell.value));
      const k = XL_COLS.find((x) => xlNorm(x[1]) === h) || (h === xlNorm("TPS (Vusers and TPS)") ? XL_COLS.find((x) => x[0] === "tps2") : h === xlNorm("Size it by") ? XL_COLS.find((x) => x[0] === "method") : null);   // older sheets
      if (k && k[6] !== "calc") col[k[0]] = ci;
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
  return { rows, problems };
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
    [["txPerIter", "Transactions"], ["thinkPerIter", "Think time"], ["rtAvg", "Response time"], ["rt90", "90th percentile"], ["requestsPerIter", "Requests"], ["dataRows", "Data rows"],
     ["thinkFactor", "Multiply by"], ["thinkMinPct", "Random from"], ["thinkMaxPct", "Random to"], ["perLg", "Vusers per machine"]].forEach(([k, head]) => {
      if (v[k] != null) { const f = num(v[k], r, head); if (f != null) { g[k] = f; if (k === "rtAvg" && !g.rtSource) g.rtSource = "sla"; } }
    });
    if (v.rtSource != null) { const k = pick("rtSource", v.rtSource, r, "Response time from"); if (k) g.rtSource = k; }
    if (v.pacing != null) { const k = pick("pacing", v.pacing, r, "Pacing"); if (k) g.pacing = Object.assign({}, g.pacing, { mode: k }); }
    const pm = (g.pacing && g.pacing.mode) || "auto";
    if (v.pace1 != null) { const f = num(v.pace1, r, "Pacing"); if (f != null) { g.pacing = Object.assign({}, g.pacing); g.pacing[pm === "random" ? "min" : pm === "after" ? "delay" : "fixed"] = f; } }
    if (v.pace2 != null) { const f = num(v.pace2, r, "Longest pacing"); if (f != null) { g.pacing = Object.assign({}, g.pacing, { max: f }); } }
    if (v.thinkMode != null) { const k = pick("thinkMode", v.thinkMode, r, "Think time at replay"); if (k) g.thinkMode = k; }
    if (v.kind != null) { const k = pick("kind", v.kind, r, "Kind of script"); if (k) g.kind = k; }
    if (v.pool != null) {
      const pool = state.pools.find((y) => y.name.trim().toLowerCase() === String(v.pool).trim().toLowerCase());
      if (pool) g.pool = pool.id; else problems.push(`row ${r}: no load-generator pool called “${v.pool}” — kept`);
    }
  });
  const did = [updated && `${updated} script${updated === 1 ? "" : "s"} updated`, added && `${added} script${added === 1 ? "" : "s"} added`].filter(Boolean).join(", ") || "no rows with a script name";
  return `<b>${esc(x.file)}: ${did}.</b>${
    problems.length ? `<div class="wm-skip"><b>${problems.length} value${problems.length === 1 ? " was" : "s were"} not used:</b><ul>${problems.slice(0, 15).map((y) => `<li>${esc(y)}</li>`).join("")}${problems.length > 15 ? `<li>and ${problems.length - 15} more</li>` : ""}</ul></div>` : ""}`;
}
