/**
 * docx.js — editable Word report (Phase 5) with the same content as the PDF report.
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

  function buildDocument(m, D, opts) {
    opts = opts || {};
    const images = opts.images || {};
    const off = m.meta.localOffsetSec;
    const ins = m.insights || { verdict: { status: "warn", text: "-" }, findings: [] };
    const ACCENT = "1E40AF";
    const { Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, WidthType, AlignmentType, ImageRun, ShadingType, PageBreak, BorderStyle } = D;

    const P = (text, o) => new Paragraph(Object.assign({ children: [new TextRun(Object.assign({ text: String(text == null ? "" : text) }, (o && o.run) || {}))] }, (o && o.para) || {}));
    const H1 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_1, pageBreakBefore: true });
    const H2 = (t) => new Paragraph({ text: t, heading: HeadingLevel.HEADING_2 });
    const cell = (t, o) => new TableCell({
      children: [new Paragraph({ alignment: o && o.right ? AlignmentType.RIGHT : AlignmentType.LEFT, children: [new TextRun({ text: String(t == null ? "-" : t), bold: !!(o && o.bold), color: o && o.color, size: 16 })] })],
      shading: o && o.fill ? { type: ShadingType.CLEAR, color: "auto", fill: o.fill } : undefined,
      margins: { top: 40, bottom: 40, left: 60, right: 60 },
    });
    function table(head, rows, opt) {
      opt = opt || {};
      return new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [new TableRow({ tableHeader: true, children: head.map((h) => cell(h, { bold: true, color: "FFFFFF", fill: ACCENT })) })]
          .concat(rows.map((r) => new TableRow({ children: r.map((v, i) => (v && v.cell ? cell(v.text, v) : cell(v, { right: opt.rightFrom != null && i >= opt.rightFrom }))) }))),
      });
    }
    const img = (key) => {
      const im = images[key];
      if (!im) return [];
      const w = 620, h = Math.round((w * im.height) / im.width);
      return [new Paragraph({ alignment: AlignmentType.CENTER, children: [new ImageRun({ type: "png", data: im.data, transformation: { width: w, height: h } })] }),
        P(html.CHART_TITLES[key] || key, { para: { alignment: AlignmentType.CENTER }, run: { italics: true, size: 16, color: "475569" } })];
    };
    const n3 = (v) => fmt.num(v, 3);
    function txRows(which) {
      const rows = [];
      const groups = fmt.groupByScript(m);
      for (const g of groups) {
        if (groups.length > 1) rows.push([{ cell: true, text: g.script, bold: true, fill: "EEF2FF" }, "", "", "", "", "", "", "", "", "", ""]);
        for (const t of g.rows) {
          const s = t[which];
          const sla = which === "steady" && t.sla ? { cell: true, text: `${t.sla.pass ? "PASS" : "FAIL"} (${n3(t.sla.threshold)})`, color: t.sla.pass ? "15803D" : "B91C1C", bold: true } : "-";
          rows.push([t.name, fmt.int(s.count), t.failPct != null ? t.failPct.toFixed(2) + " %" : "-", n3(s.min), n3(s.avg), n3(s.p.p90), n3(s.p.p95), n3(s.p.p99), n3(s.max), fmt.num(s.tps, 3), sla]);
        }
      }
      return table(["Transaction", "Count", "Fail %", "Min", "Avg", "P90", "P95", "P99", "Max", "TPS", "SLA"], rows, { rightFrom: 1 });
    }
    const sev = (f) => new TextRun({ text: ` ${fmt.SEVERITY[f.severity].label.toUpperCase()} `, bold: true, color: "FFFFFF", shading: { type: ShadingType.CLEAR, color: "auto", fill: fmt.SEVERITY[f.severity].color.slice(1) }, size: 16 });

    const w = m.window;
    const children = [];
    // Cover
    children.push(P(opts.company || m.meta.project || "", { run: { color: "475569", size: 20, allCaps: true } }));
    children.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: opts.title || `Performance test report — ${m.meta.sessionName || "LRE run"}`, color: ACCENT })] }));
    children.push(P(`${fmt.localTime(m.meta.startUtc, off)} – ${fmt.localTime(m.meta.stopUtc, off)} (${fmt.zone(off)}) · ${fmt.hms(m.meta.durationSec)}`, { run: { color: "475569" } }));
    children.push(new Paragraph({ spacing: { before: 400, after: 400 }, children: [new TextRun({ text: ins.verdict.text, bold: true, size: 36, color: fmt.VERDICT[ins.verdict.status].color.slice(1) })] }));
    children.push(P(`Computed from the LRE raw results by LRE Results Analyser ${m.engineVersion} on ${m.generatedAt.slice(0, 10)}. Independent of LRE Analysis.`, { run: { size: 16, color: "475569" } }));

    // 1 Executive summary
    children.push(H1("1. Executive summary"));
    children.push(table(["Peak VUsers", "Steady state", "Transactions", "TPS (steady)", "Failed", "Errors"], [[
      fmt.int(m.totals.peakVusers), w ? fmt.hms(w.durationSec) : "-", fmt.int(m.totals.samples), fmt.num(m.totals.tpsSteady, 2),
      m.totals.fail != null ? fmt.int(m.totals.fail) : "n/a", m.totals.errors != null ? fmt.int(m.totals.errors) : "n/a"]]));
    children.push(H2("Key findings"));
    const issues = ins.findings.filter((f) => ["high", "medium"].includes(f.severity));
    if (!issues.length) children.push(P("No significant issues were found."));
    for (const f of issues.slice(0, 8)) children.push(new Paragraph({ bullet: { level: 0 }, children: [sev(f), new TextRun({ text: ` ${f.title}. `, bold: true }), new TextRun(f.text)] }));
    const good = ins.findings.filter((f) => f.severity === "good");
    if (good.length) children.push(P("Also checked and fine: " + good.map((f) => f.title).join(" · ") + ".", { run: { size: 18, color: "475569" } }));

    // 2 Test & workload
    children.push(H1("2. Test and workload"));
    children.push(table(["Item", "Value"], [
      ["Scenario", m.meta.sessionName], ["Project", m.meta.project], ["Controller", [m.meta.product, m.meta.version].filter(Boolean).join(" ")],
      ["Start / end (local)", `${fmt.localTime(m.meta.startUtc, off)} → ${fmt.localTime(m.meta.stopUtc, off)} (${fmt.zone(off)})`],
      ["Stop reason", m.meta.stopReason], ["Schedule", m.meta.scheduleText || m.meta.schedule.raw], ["Load behaviour", m.meta.loadBehavior],
    ]));
    children.push(H2("Schedule — planned vs actual"));
    children.push(table(["Phase", "Planned", "Actual"], fmt.scheduleRows(m).map((r) => [r.phase, r.planned, r.actual])));
    children.push(H2("Workload model"));
    children.push(table(["Script", "Protocol", "VUsers", "Pacing", "Think time", "Iterations achieved / planned"], m.workload.map((s) => [s.key, s.protocol, s.vusers,
      s.pacing ? s.pacing.text : "-", s.thinkTime ? s.thinkTime.text : "-", `${fmt.int(s.iterationsAchieved)} / ${s.iterationsExpected != null ? fmt.int(s.iterationsExpected) : "-"}`])));
    children.push(H2("Load generators"));
    children.push(table(["Host", "IP", "Role", "VUsers", "CPU peak", "Memory peak"], m.lgs.map((l) => [l.name, l.ip || "-", l.role, l.vusers,
      l.cpuPeak != null ? l.cpuPeak.toFixed(0) + " %" : "-", l.memPeak != null ? l.memPeak.toFixed(0) + " %" : "-"])));
    children.push(...img("load"));

    // 3 / 4 results
    children.push(H1("3. Results — steady state"));
    children.push(P(w ? `${w.detected ? "Detected steady state" : "User-set analysis window"}: t+${fmt.hms(w.start)} → t+${fmt.hms(w.end)} (${fmt.relLocal(m, w.start)} → ${fmt.relLocal(m, w.end)}). Response times in seconds.` : "No steady-state window.", { run: { size: 18, color: "475569" } }));
    children.push(txRows("steady"));
    children.push(...img("txBars"));
    children.push(H1("4. Results — full run"));
    children.push(txRows("full"));

    // 5 Behaviour over time
    children.push(H1("5. Behaviour over time"));
    for (const k of ["rtOverTime", "throughput", "latencyHeat", "tpsVsRt", "vuserHeat"]) children.push(...img(k));

    // 6 Errors
    children.push(H1("6. Errors"));
    if (!m.errors) children.push(P("Error log (SqliteDb.db) not available."));
    else if (!m.errors.total) children.push(P("No errors were logged."));
    else {
      children.push(P(`${fmt.int(m.errors.total)} error(s) logged.`));
      children.push(table(["Code", "Message pattern", "Script", "Count", "VUsers", "First (local)", "Last (local)"], m.errors.summary.slice(0, 25).map((g) => [g.code, g.pattern.slice(0, 160), g.script || "-",
        fmt.int(g.count), g.vusers.length, g.firstUtc != null ? fmt.localTime(g.firstUtc, off) : "-", g.lastUtc != null ? fmt.localTime(g.lastUtc, off) : "-"])));
    }
    children.push(...img("errors"), ...img("httpCodes"));

    // 7 Infrastructure
    if (images.lgHealth || images.rtPerLg || images.bytes) { children.push(H1("7. Load generators and network")); children.push(...img("lgHealth"), ...img("rtPerLg"), ...img("bytes")); }

    // 8 Findings
    children.push(H1("8. All findings"));
    for (const f of ins.findings) {
      children.push(new Paragraph({ spacing: { before: 120 }, children: [sev(f), new TextRun({ text: " " + f.title, bold: true })] }));
      children.push(P(f.text));
    }

    // Appendix
    children.push(H1("Appendix — method and validation"));
    children.push(table(["Item", "Method"], [
      ["Source", "RawData.eve transaction records; scenario files (.lrr, RunInfo.ini, _t_rep.eve, .usp, .cfg, .usr); SqliteDb.db; sum_data"],
      ["Percentiles", m.method.percentile], ["Standard deviation", m.method.stdDev], ["Steady state", m.method.steadyState],
      ["TPS", m.method.tps], ["Pass / fail", m.method.passFail], ["Negative response times", m.method.negativeResponseTimes],
      ["Time zone", `${fmt.zone(off)} — ${m.meta.localOffsetSource}`],
    ]));
    children.push(H2("Self-checks"));
    const stc = { ok: "15803D", warn: "B45309", fail: "B91C1C", info: "475569" };
    children.push(table(["Status", "Check", "Result"], m.selfCheck.map((s) => [{ cell: true, text: s.status.toUpperCase(), bold: true, color: stc[s.status] }, s.id, s.text])));

    return new D.Document({
      creator: "LRE Results Analyser",
      title: opts.title || `Performance test report — ${m.meta.sessionName || ""}`,
      styles: {
        default: { document: { run: { font: "Segoe UI", size: 20 } } },
        paragraphStyles: [
          { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", run: { size: 30, bold: true, color: ACCENT }, paragraph: { spacing: { after: 160 }, border: { bottom: { color: ACCENT, space: 4, style: BorderStyle.SINGLE, size: 12 } } } },
          { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", run: { size: 24, bold: true }, paragraph: { spacing: { before: 240, after: 120 } } },
        ],
      },
      sections: [{ properties: { page: { margin: { top: 800, bottom: 800, left: 800, right: 800 } } }, children }],
    });
  }

  return { buildDocument };
});
