/**
 * docx.js — editable Word report (Phase 5) with the same content as the PDF report, on landscape
 * A4 pages so the wide tables keep every column readable.
 * The docx library is injected (browser: vendored docx.iife.js; CLI: npm "docx").
 *
 *   const doc = buildDocument(model, docx, { images: { load: {data: Uint8Array(png), width, height} … }, company });
 *   const blob = await docx.Packer.toBlob(doc);   // or Packer.toBuffer in Node
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./format"), require("./html"));
  else (root.LreRA = root.LreRA || {}).docx = factory(root.LreRA.format, root.LreRA.html);
})(typeof self !== "undefined" ? self : this, function (fmt, html) {
  "use strict";

  /** Fail % for the figures shown: whole test, or failed ÷ all inside the analysis window. */
  function failPctText(t, s, which) {
    const v = which === "full" ? t.failPct : s.count + (s.fail || 0) ? ((s.fail || 0) / (s.count + (s.fail || 0))) * 100 : null;
    return v == null ? "-" : v.toFixed(2) + " %";
  }

  const PAGE_W = 15398; // landscape A4 (16838 twips) minus 0.5" margins each side

  function buildDocument(m, D, opts) {
    opts = opts || {};
    const images = opts.images || {};
    const off = m.meta.localOffsetSec;
    const t = m.totals;
    const ins = m.insights || { verdict: { status: "warn", text: "-" }, findings: [] };
    const ACCENT = "1E40AF", MUTED = "475569";
    const { Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun, ShadingType, BorderStyle } = D;

    const P = (text, o) => new Paragraph(Object.assign({ children: [new TextRun(Object.assign({ text: String(text == null ? "" : text) }, (o && o.run) || {}))] }, (o && o.para) || {}));
    const H1 = (x) => new Paragraph({ text: x, heading: HeadingLevel.HEADING_1, pageBreakBefore: true });
    const H2 = (x) => new Paragraph({ text: x, heading: HeadingLevel.HEADING_2 });
    const cell = (x, o) => new TableCell({
      children: [new Paragraph({ alignment: o && o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: String(x == null ? "-" : x), bold: !!(o && o.bold), color: o && o.color, size: o && o.size || 17 })] })],
      shading: o && o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
      columnSpan: o && o.span, margins: { top: 40, bottom: 40, left: 70, right: 70 },
    });
    /** head: [label, {w: width %, num: right-aligned}] or plain labels. */
    function table(head, rows) {
      const cols = head.map((h) => (Array.isArray(h) ? { label: h[0], w: h[1] && h[1].w, num: h[1] && h[1].num } : { label: h }));
      const known = cols.reduce((a, c) => a + (c.w || 0), 0), free = cols.filter((c) => !c.w).length;
      const widths = cols.map((c) => Math.round(PAGE_W * (c.w || (100 - known) / Math.max(1, free)) / 100));
      return new Table({
        width: { size: PAGE_W, type: WidthType.DXA }, columnWidths: widths,
        rows: [new TableRow({ tableHeader: true, children: cols.map((c) => cell(c.label, { bold: true, color: "FFFFFF", fill: ACCENT, right: c.num })) })]
          .concat(rows.map((r, ri) => new TableRow({ cantSplit: true, children: r.map((v, i) => (v && v.cell ? cell(v.text, Object.assign({ right: cols[i] && cols[i].num }, v)) : cell(v, { right: cols[i] && cols[i].num, fill: ri % 2 ? "F8FAFC" : undefined }))) }))),
      });
    }
    const img = (key) => {
      const im = images[key];
      if (!im) return [];
      const w = 760, h = Math.round((w * im.height) / im.width); // two charts per landscape page
      return [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: im.data, transformation: { width: w, height: h } })] }),
        P(html.CHART_TITLES[key] || key, { para: { alignment: AlignmentType.CENTER }, run: { italics: true, size: 16, color: MUTED } })];
    };
    const n3 = (v) => fmt.num(v, 3);
    const w = m.window;
    const winName = w && !w.detected ? "Analysis window" : "Steady state";
    const total = t.pass != null && t.fail != null ? t.pass + t.fail : null;
    const pct = (a, b) => (a != null && b ? `${((a / b) * 100).toFixed(2)} %` : "-");
    const early = m.lifecycle && m.lifecycle.earlyExits ? m.lifecycle.earlyExits.length : 0;
    const short = (h) => String(h || "").split(".")[0];

    function txRows(which) {
      const rows = [];
      const groups = fmt.groupByScript(m);
      for (const g of groups) {
        if (groups.length > 1) rows.push([{ cell: true, text: g.script, bold: true, color: ACCENT, fill: "EEF2FF", span: 14 }]);
        for (const x of g.rows) {
          const s = x[which];
          const pass = which === "full" ? x.pass : s.count, fail = which === "full" ? x.fail : s.fail || 0;
          const sla = which === "steady" && x.sla ? { cell: true, text: `${x.sla.pass ? "PASS" : "FAIL"} ${n3(x.sla.threshold)}`, color: x.sla.pass ? "15803D" : "B91C1C", bold: true } : "-";
          rows.push([x.name, fmt.int(pass + fail), fmt.int(pass), fail ? { cell: true, text: fmt.int(fail), color: "B91C1C", bold: true } : "0", failPctText(x, s, which),
            n3(s.min), n3(s.avg), n3(s.max), n3(s.p.p50), n3(s.p.p90), n3(s.p.p95), n3(s.p.p99), fmt.num(s.tps, 3), sla]);
        }
      }
      const num = { num: true, w: 5.4 };
      return table([["Transaction", { w: 24 }], ["Count", num], ["Pass", num], ["Fail", { num: true, w: 4.5 }], ["Fail %", num], ["Min", num], ["Avg", num], ["Max", num],
        ["P50", num], ["P90", num], ["P95", num], ["P99", num], ["TPS", num], ["SLA", { num: true, w: 8 }]], rows);
    }
    const sev = (f) => new TextRun({ text: ` ${fmt.SEVERITY[f.severity].label.toUpperCase()} `, bold: true, color: "FFFFFF", shading: { type: ShadingType.CLEAR, color: "auto", fill: fmt.SEVERITY[f.severity].color.slice(1) }, size: 16 });

    const children = [];
    // Cover
    children.push(P(opts.company || m.meta.project || "", { run: { color: MUTED, size: 20, allCaps: true } }));
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: opts.title || `Performance test report — ${m.meta.sessionName || "LRE run"}`, color: ACCENT })] }));
    children.push(P(`${fmt.when(m.meta.startUtc, off)} → ${fmt.when(m.meta.stopUtc, off)} (${fmt.zone(off)}) · ${fmt.dur(m.meta.durationSec)}`, { run: { color: MUTED } }));
    children.push(new Paragraph({ spacing: { before: 400, after: 400 }, children: [new TextRun({ text: ins.verdict.text, bold: true, size: 36, color: fmt.VERDICT[ins.verdict.status].color.slice(1) })] }));
    children.push(P(`Worked out from the LRE raw results by LRE Results Analyser ${m.engineVersion} on ${m.generatedAt.slice(0, 10)}, independently of LRE Analysis.`, { run: { size: 16, color: MUTED } }));

    // 1 Executive summary — the eight headline figures as label / value / detail
    children.push(H1("1. Executive summary"));
    const which = w ? "steady" : "full";
    const slowest = m.transactions.filter((x) => x[which].count && (x.inMap || !m.transactions.some((y) => y.inMap)))
      .sort((a, b) => (b[which].p.p90 || 0) - (a[which].p.p90 || 0)).slice(0, 8);
    const kp = [
      ["Peak VUsers", fmt.int(t.peakVusers), m.lifecycle ? (early ? `${fmt.int(early)} of ${fmt.int(m.lifecycle.vusers)} stopped early` : `all ${fmt.int(m.lifecycle.vusers)} ran to the end`) : ""],
      ["Test duration", fmt.dur(m.meta.durationSec), `${fmt.when(m.meta.startUtc, off, true)} → ${fmt.when(m.meta.stopUtc, off, true)}`],
      [winName, w ? fmt.dur(w.durationSec) : "-", w ? `${fmt.relWhen(m, w.start, true)} → ${fmt.relWhen(m, w.end, true)}` : "not detected"],
      ["Transactions per second", fmt.num(t.tpsSteady, 2), `in the ${winName.toLowerCase()} · whole test ${fmt.num(t.tpsFull, 2)}`],
      ["Transactions passed", fmt.int(t.pass != null ? t.pass : t.samples), total ? `${pct(t.pass, total)} of ${fmt.int(total)}` : ""],
      ["Transactions failed", t.fail != null ? fmt.int(t.fail) : "n/a", total ? `${pct(t.fail, total)} of all transactions` : ""],
      ["Errors logged", t.errors != null ? fmt.int(t.errors) : "n/a", m.errors && m.errors.summary[0] ? `${fmt.int(m.errors.summary.length)} different · most common ${m.errors.summary[0].code}` : ""],
      ["Slowest (P90)", slowest[0] ? fmt.sec(slowest[0][which].p.p90) : "-", slowest[0] ? slowest[0].label || slowest[0].name : ""],
    ];
    children.push(table([["Figure", { w: 22 }], ["Value", { w: 22 }], ["Detail", { w: 56 }]], kp.map(([a, b, c]) => [{ cell: true, text: a, bold: true }, { cell: true, text: b, bold: true, color: ACCENT, size: 20 }, c])));
    const web = m.web && (m.web.hits || m.web.throughputBytes) ? m.web : null;
    if (web) children.push(P(`Web traffic (whole test): ${fmt.int(web.hits)} hits · ${fmt.num(web.hitsPerSec.avg, 2)} hits/s · ${web.throughputBytes ? `${fmt.bytes(web.throughputBytes)} received · ${fmt.bytes(web.throughputBytesPerSec.avg)}/s` : "throughput not recorded"}`, { run: { size: 18, color: MUTED }, para: { spacing: { before: 120 } } }));
    const issues = ins.findings.filter((f) => ["high", "medium"].includes(f.severity));
    children.push(H2(`Key findings${issues.length > 6 ? ` — top 6 of ${issues.length} (all in section 8)` : ""}`));
    if (!issues.length) children.push(P("No significant issues were found."));
    for (const f of issues.slice(0, 6)) children.push(new Paragraph({ bullet: { level: 0 }, children: [sev(f), new TextRun({ text: ` ${f.title}. `, bold: true }), new TextRun(f.text)] }));
    const good = fmt.goodSummary(ins.findings);
    if (good.length) {
      children.push(H2("Checked and fine"));
      for (const g of good) children.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: g.title + (g.count > 1 ? ` — ${g.count} ${g.title.startsWith("Pacing") ? "scripts" : "items"}` : g.count === 1 ? ` — ${g.items[0]}` : ""), color: "15803D", size: 18 })] }));
    }
    children.push(H2(`Slowest transactions (P90, ${which === "steady" ? winName.toLowerCase() : "whole test"})`));
    children.push(table([["Transaction", { w: 55 }], ["P90", { num: true }], ["Avg", { num: true }], ["Count", { num: true }]], slowest.map((x) => [x.label || x.name, fmt.sec(x[which].p.p90), fmt.sec(x[which].avg), fmt.int(x.count)])));

    // 2 Test & workload
    children.push(H1("2. Test and workload"));
    children.push(table([["Item", { w: 25 }], ["Value", { w: 75 }]], fmt.testFacts(m).map(([k, v]) => [{ cell: true, text: k, bold: true }, v])));
    children.push(H2("Schedule — planned vs actual"));
    children.push(table([["Phase", { w: 18 }], ["Planned", { w: 32 }], ["Actual", { w: 50 }]], fmt.scheduleRows(m).map((r) => [r.phase, r.planned, r.actual])));
    children.push(H2("Workload design"));
    const earlyBy = {};
    for (const v of (m.lifecycle && m.lifecycle.earlyExits) || []) earlyBy[String(v.script).toLowerCase()] = (earlyBy[String(v.script).toLowerCase()] || 0) + 1;
    children.push(table([["Script", { w: 26 }], ["Protocol", { w: 8 }], ["VUsers", { num: true, w: 5 }], ["Load generators", { w: 14 }], ["Pacing", { w: 11 }], ["Think time", { w: 11 }],
      ["Iterations planned", { num: true, w: 7 }], ["Achieved", { num: true, w: 6 }], ["Achieved %", { num: true, w: 6 }], ["Stopped early", { num: true, w: 6 }]],
      m.workload.map((s) => [s.key, s.protocol || "-", fmt.int(s.vusers), s.loadGenerators.map((l) => `${short(l.name)} (${l.vusers})`).join(", ") || "-",
        s.pacing ? s.pacing.text : "-", s.thinkTime ? s.thinkTime.text : "-", s.iterationsExpected != null ? fmt.int(s.iterationsExpected) : "-", fmt.int(s.iterationsAchieved),
        s.iterationsExpected ? `${((s.iterationsAchieved / s.iterationsExpected) * 100).toFixed(0)} %` : "-", earlyBy[String(s.key).toLowerCase()] || "-"])));
    children.push(H2("Machines"));
    children.push(table([["Host", { w: 40 }], ["Role", { w: 20 }], ["VUsers", { num: true }], ["Scripts", { num: true }], ["CPU peak", { num: true }], ["Memory peak", { num: true }]],
      m.lgs.map((l) => [l.name, fmt.roleName(l), fmt.int(l.vusers), l.scripts.length || "-",
        l.cpuPeak != null ? { cell: true, text: l.cpuPeak.toFixed(0) + " %", color: l.cpuPeak >= 85 ? "B91C1C" : undefined } : "-",
        l.memPeak != null ? { cell: true, text: l.memPeak.toFixed(0) + " %", color: l.memPeak >= 85 ? "B91C1C" : undefined } : "-"])));
    children.push(...img("load"));

    // 3 / 4 results
    children.push(H1(`3. Results — ${winName.toLowerCase()}`));
    if (m.aggregation && m.aggregation.active) children.push(P(`${m.aggregation.title}. ${m.aggregation.note}`, { run: { size: 18, color: "B45309" } }));
    children.push(P(w ? `${fmt.relRange(m, w.start, w.end)} (${fmt.dur(w.durationSec)}). Response times in seconds, from every passed transaction. Count, Pass and Fail cover the same period.` : "No steady-state window.", { run: { size: 18, color: MUTED } }));
    children.push(txRows("steady"));
    children.push(...img("txBars"));
    children.push(H1("4. Results — whole test"));
    children.push(P(`${fmt.relRange(m, 0, m.meta.durationSec)} (${fmt.dur(m.meta.durationSec)}), including ramp-up and ramp-down. Response times in seconds.`, { run: { size: 18, color: MUTED } }));
    children.push(txRows("full"));

    // 5 Behaviour over time
    children.push(H1("5. Behaviour over time"));
    for (const k of ["rtOverTime", "throughput", "latencyHeat", "tpsVsRt", "vuserHeat"]) children.push(...img(k));

    // 6 Errors — every group, with a real message (script line included)
    children.push(H1("6. Errors"));
    if (!m.errors) children.push(P("Error log (SqliteDb.db) not available."));
    else if (!m.errors.total) children.push(P("No errors were logged."));
    else {
      children.push(P(`${fmt.int(m.errors.total)} error(s) logged, in ${fmt.int(m.errors.summary.length)} group(s). Errors with the same code, script line and message are counted together; times are local.`));
      children.push(table([["Count", { num: true, w: 6 }], ["Code", { w: 6 }], ["Message (example)", { w: 46 }], ["Script", { w: 18 }], ["VUsers", { num: true, w: 5 }], ["First", { w: 9.5 }], ["Last", { w: 9.5 }]],
        m.errors.summary.map((g) => [fmt.int(g.count), g.code, g.example || g.pattern, g.script || "-", g.vusers.length,
          g.firstUtc != null ? fmt.when(g.firstUtc, off, true) : "-", g.lastUtc != null ? fmt.when(g.lastUtc, off, true) : "-"])));
    }
    children.push(...img("errors"), ...img("httpCodes"));

    // 7 Infrastructure
    if (images.lgHealth || images.rtPerLg || images.bytes) { children.push(H1("7. Load generators and network")); children.push(...img("lgHealth"), ...img("rtPerLg"), ...img("bytes")); }

    // 8 Findings
    children.push(H1("8. All findings"));
    for (const f of ins.findings) {
      children.push(new Paragraph({ spacing: { before: 140 }, keepNext: true, children: [sev(f), new TextRun({ text: " " + f.title, bold: true })] }));
      children.push(P(f.text, { run: { size: 18 } }));
    }

    // About
    children.push(H1("About this report"));
    children.push(table([["Item", { w: 24 }], ["How it is worked out", { w: 76 }]], fmt.aboutRows(m).map(([k, v]) => [{ cell: true, text: k, bold: true }, v])));

    return new D.Document({
      creator: "LRE Results Analyser",
      title: opts.title || `Performance test report — ${m.meta.sessionName || ""}`,
      styles: {
        default: { document: { run: { font: "Segoe UI", size: 20 } } },
        paragraphStyles: [
          { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { size: 30, bold: true, color: ACCENT }, paragraph: { spacing: { after: 160 }, border: { bottom: { color: ACCENT, space: 4, style: BorderStyle.SINGLE, size: 12 } } } },
          { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { size: 24, bold: true }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } },
        ],
      },
      sections: [{ properties: { page: { size: { orientation: D.PageOrientation.LANDSCAPE }, margin: { top: 720, bottom: 720, left: 720, right: 720 } } }, children }],
    });
  }

  return { buildDocument };
});
