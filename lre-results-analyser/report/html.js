/**
 * html.js — self-contained, print-optimised HTML report (Phase 5). The browser prints it to PDF
 * ("Save as PDF"); the page also offers it as a downloadable .html file; the CLI writes it as a file.
 * Charts are passed in as SVG strings or image data URLs keyed by chart key (see charts.reportSet),
 * so no script runs inside the report. Landscape A4, so the wide tables keep every column readable.
 *
 *   buildReport(model, { charts: { load: "<svg…>", … }, title, logoDataUrl, company })
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./format"));
  else (root.LreRA = root.LreRA || {}).html = factory(root.LreRA.format);
})(typeof self !== "undefined" ? self : this, function (fmt) {
  "use strict";

  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const n3 = (v) => fmt.num(v, 3);

  const CHART_TITLES = {
    load: "Load and throughput", txBars: "Response time per transaction (steady state)", rtOverTime: "P90 over time — slowest transactions",
    throughput: "Transactions per second", latencyHeat: "Latency heatmap", tpsVsRt: "Throughput vs response time", errors: "Errors over time",
    httpCodes: "HTTP responses per second", bytes: "Throughput (bytes)", lgHealth: "Load-generator CPU and memory", rtPerLg: "P90 per load generator", vuserHeat: "Response time per VUser",
  };

  function figure(charts, key, caption) {
    const c = charts && charts[key];
    if (!c) return "";
    const body = /^\s*<svg/i.test(c) ? c.replace(/^\s*<svg/i, '<svg class="chart" preserveAspectRatio="xMidYMid meet"') : `<img class="chart" src="${esc(c)}" alt="${esc(CHART_TITLES[key] || key)}">`;
    return `<figure>${body}<figcaption>${esc(caption || CHART_TITLES[key] || key)}</figcaption></figure>`;
  }

  /**
   * head: [label, {w: column width %, num: right-aligned and not wrapped}] or plain labels.
   * rows: arrays of cells; a cell is text, or {html, cls}; a row may be {_cls, cells}.
   */
  function table(head, rows, cls) {
    const cols = head.map((h) => (Array.isArray(h) ? { label: h[0], w: h[1] && h[1].w, num: h[1] && h[1].num } : { label: h }));
    const colgroup = cols.some((c) => c.w) ? `<colgroup>${cols.map((c) => `<col${c.w ? ` style="width:${c.w}%"` : ""}>`).join("")}</colgroup>` : "";
    return `<table class="${cls || ""}">${colgroup}<thead><tr>${cols.map((c) => `<th${c.num ? ' class="num"' : ""}>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${
      rows.map((r) => `<tr${r._cls ? ` class="${r._cls}"` : ""}>${(r.cells || r).map((c, i) => {
        const num = cols[i] && cols[i].num ? "num" : "";
        return c && c.html != null ? `<td class="${[num, c.cls].filter(Boolean).join(" ")}"${c.span ? ` colspan="${c.span}"` : ""}>${c.html}</td>` : `<td${num ? ' class="num"' : ""}>${esc(c)}</td>`;
      }).join("")}</tr>`).join("")
    }</tbody></table>`;
  }

  /** Fail % for the figures shown: whole test, or failed ÷ all inside the analysis window. */
  function failPctText(t, s, which) {
    const v = which === "full" ? t.failPct : s.count + (s.fail || 0) ? ((s.fail || 0) / (s.count + (s.fail || 0))) * 100 : null;
    return v == null ? "-" : v.toFixed(2) + " %";
  }

  function txTable(m, which) {
    const rows = [];
    const groups = fmt.groupByScript(m);
    const N = 14;
    for (const g of groups) {
      if (groups.length > 1) rows.push({ _cls: "group", cells: [{ html: `<b>${esc(g.script)}</b>`, span: N }] });
      for (const t of g.rows) {
        const s = t[which];
        const pass = which === "full" ? t.pass : s.count, fail = which === "full" ? t.fail : s.fail || 0;
        const sla = which === "steady" && t.sla ? { html: t.sla.pass ? `<span class="ok">PASS ${n3(t.sla.threshold)}</span>` : `<span class="bad">FAIL ${n3(t.sla.threshold)}</span>` } : "-";
        rows.push([t.name, fmt.int(pass + fail), fmt.int(pass), fail ? { html: `<span class="bad">${fmt.int(fail)}</span>` } : "0", failPctText(t, s, which),
          n3(s.min), n3(s.avg), n3(s.max), n3(s.p.p50), n3(s.p.p90), n3(s.p.p95), n3(s.p.p99), fmt.num(s.tps, 3), sla]);
      }
    }
    const num = { num: true, w: 5.4 };
    return table([["Transaction", { w: 24 }], ["Count", num], ["Pass", num], ["Fail", { num: true, w: 4.5 }], ["Fail %", num], ["Min", num], ["Avg", num], ["Max", num],
      ["P50", num], ["P90", num], ["P95", num], ["P99", num], ["TPS", num], ["SLA", { num: true, w: 8 }]], rows, "tx");
  }

  function buildReport(m, opts) {
    opts = opts || {};
    const c = opts.charts || {};
    const off = m.meta.localOffsetSec;
    const t = m.totals;
    const ins = m.insights || { verdict: { status: "warn", text: "-" }, findings: [] };
    const vcol = fmt.VERDICT[ins.verdict.status].color;
    const issues = ins.findings.filter((f) => ["high", "medium"].includes(f.severity));
    const good = fmt.goodSummary(ins.findings);
    const w = m.window;
    const winName = w && !w.detected ? "Analysis window" : "Steady state";
    const title = opts.title || `Performance test report — ${m.meta.sessionName || "LRE run"}`;
    const total = t.pass != null && t.fail != null ? t.pass + t.fail : null;
    const pct = (a, b) => (a != null && b ? `${((a / b) * 100).toFixed(2)} %` : "-");
    const early = m.lifecycle && m.lifecycle.earlyExits ? m.lifecycle.earlyExits.length : 0;
    const kpi = (label, value, sub, cls) => `<div class="kpi ${cls || ""}"><div class="kl">${esc(label)}</div><div class="kv">${esc(value)}</div>${sub ? `<div class="ks">${esc(sub)}</div>` : ""}</div>`;
    const which = w ? "steady" : "full";
    const slowest = m.transactions.filter((x) => x[which].count && (x.inMap || !m.transactions.some((y) => y.inMap)))
      .sort((a, b) => (b[which].p.p90 || 0) - (a[which].p.p90 || 0)).slice(0, 8);
    const web = m.web && (m.web.hits || m.web.throughputBytes) ? m.web : null;
    const short = (h) => String(h || "").split(".")[0];

    const sections = [];
    // Cover
    sections.push(`<section class="cover">
      ${opts.logoDataUrl ? `<img class="logo" src="${esc(opts.logoDataUrl)}" alt="logo">` : ""}
      <div class="eyebrow">${esc(opts.company || m.meta.project || "")}</div>
      <h1>${esc(title)}</h1>
      <p class="lead">${esc(fmt.when(m.meta.startUtc, off))} → ${esc(fmt.when(m.meta.stopUtc, off))} (${esc(fmt.zone(off))}) · ${esc(fmt.dur(m.meta.durationSec))}</p>
      <div class="verdict" style="border-color:${vcol};color:${vcol}">${esc(ins.verdict.text)}</div>
      <p class="muted">Worked out from the LRE raw results by LRE Results Analyser ${esc(m.engineVersion)} on ${esc(m.generatedAt.slice(0, 10))}, independently of LRE Analysis.</p>
    </section>`);

    // 1 Executive summary
    sections.push(`<section><h2>1. Executive summary</h2>
      <div class="kpis">
        ${kpi("Peak VUsers", fmt.int(t.peakVusers), m.lifecycle ? (early ? `${fmt.int(early)} of ${fmt.int(m.lifecycle.vusers)} stopped early` : `all ${fmt.int(m.lifecycle.vusers)} ran to the end`) : "", early ? "warn" : "")}
        ${kpi("Test duration", fmt.durShort(m.meta.durationSec), `${fmt.when(m.meta.startUtc, off, true)} → ${fmt.when(m.meta.stopUtc, off, true)}`)}
        ${kpi(winName, w ? fmt.durShort(w.durationSec) : "-", w ? `${fmt.relWhen(m, w.start, true)} → ${fmt.relWhen(m, w.end, true)}` : "not detected")}
        ${kpi("Transactions per second", fmt.num(t.tpsSteady, 2), `in the ${winName.toLowerCase()} · whole test ${fmt.num(t.tpsFull, 2)}`)}
        ${kpi("Transactions passed", fmt.int(t.pass != null ? t.pass : t.samples), total ? `${pct(t.pass, total)} of ${fmt.int(total)}` : "", "ok")}
        ${kpi("Transactions failed", t.fail != null ? fmt.int(t.fail) : "n/a", total ? `${pct(t.fail, total)} of all transactions` : "", t.fail ? "warn" : "ok")}
        ${kpi("Errors logged", t.errors != null ? fmt.int(t.errors) : "n/a", m.errors && m.errors.summary[0] ? `${fmt.int(m.errors.summary.length)} different · most common ${m.errors.summary[0].code}` : "", t.errors ? "bad" : "ok")}
        ${kpi("Slowest (P90)", slowest[0] ? fmt.sec(slowest[0][which].p.p90) : "-", slowest[0] ? slowest[0].label || slowest[0].name : "")}
      </div>
      ${web ? `<p class="traffic"><b>Web traffic (whole test):</b> ${fmt.int(web.hits)} hits · ${fmt.num(web.hitsPerSec.avg, 2)} hits/s · ${web.throughputBytes ? `${fmt.bytes(web.throughputBytes)} received · ${fmt.bytes(web.throughputBytesPerSec.avg)}/s` : "throughput not recorded"}</p>` : ""}
      <div class="two">
        <div><h3>Key findings${issues.length > 6 ? ` — top 6 of ${issues.length} (all in section 8)` : ""}</h3>
          ${issues.length ? `<ul class="findings">${issues.slice(0, 6).map((f) => `<li><span class="sev" style="background:${fmt.SEVERITY[f.severity].color}">${fmt.SEVERITY[f.severity].label}</span> <b>${esc(f.title)}.</b> ${esc(f.text)}</li>`).join("")}</ul>`
            : "<p>No significant issues were found.</p>"}</div>
        <div><h3>Slowest transactions (P90, ${which === "steady" ? winName.toLowerCase() : "whole test"})</h3>
          ${table([["Transaction", { w: 58 }], ["P90", { num: true }], ["Avg", { num: true }], ["Count", { num: true }]], slowest.map((x) => [x.label || x.name, fmt.sec(x[which].p.p90), fmt.sec(x[which].avg), fmt.int(x.count)]))}
          ${good.length ? `<h3>Checked and fine</h3><ul class="good">${good.map((g) => `<li>${esc(g.title)}${g.count > 1 ? ` — ${g.count} ${g.title.startsWith("Pacing") ? "scripts" : "items"}` : g.count === 1 ? ` — ${esc(g.items[0])}` : ""}</li>`).join("")}</ul>` : ""}
        </div>
      </div>
    </section>`);

    // 2 Test & workload
    const earlyBy = {};
    for (const v of (m.lifecycle && m.lifecycle.earlyExits) || []) earlyBy[String(v.script).toLowerCase()] = (earlyBy[String(v.script).toLowerCase()] || 0) + 1;
    sections.push(`<section><h2>2. Test and workload</h2>
      <div class="two">
        <div><h3>Test</h3>${table(["Item", "Value"], fmt.testFacts(m), "kvt")}</div>
        <div><h3>Schedule — planned vs actual</h3>${table([["Phase", { w: 20 }], ["Planned", { w: 32 }], ["Actual", { w: 48 }]], fmt.scheduleRows(m).map((r) => [r.phase, r.planned, r.actual]))}
          <h3>Machines</h3>${table([["Host", { w: 34 }], ["Role", { w: 18 }], ["VUsers", { num: true, w: 11 }], ["Scripts", { num: true, w: 11 }], ["CPU peak", { num: true, w: 12 }], ["Memory peak", { num: true, w: 14 }]],
            m.lgs.map((l) => [l.name, fmt.roleName(l), fmt.int(l.vusers), l.scripts.length || "-", l.cpuPeak != null ? { html: `<span class="${l.cpuPeak >= 85 ? "bad" : ""}">${l.cpuPeak.toFixed(0)} %</span>` } : "-", l.memPeak != null ? { html: `<span class="${l.memPeak >= 85 ? "bad" : ""}">${l.memPeak.toFixed(0)} %</span>` } : "-"]))}</div>
      </div>
      <h3>Workload design</h3>
      ${table([["Script", { w: 26 }], ["Protocol", { w: 8 }], ["VUsers", { num: true, w: 5 }], ["Load generators", { w: 14 }], ["Pacing", { w: 11 }], ["Think time", { w: 11 }],
        ["Iterations planned", { num: true, w: 7 }], ["Achieved", { num: true, w: 6 }], ["Achieved %", { num: true, w: 6 }], ["Stopped early", { num: true, w: 6 }]],
        m.workload.map((s) => [s.key, s.protocol || "-", fmt.int(s.vusers), s.loadGenerators.map((l) => `${short(l.name)} (${l.vusers})`).join(", ") || "-",
          s.pacing ? s.pacing.text : "-", s.thinkTime ? s.thinkTime.text : "-", s.iterationsExpected != null ? fmt.int(s.iterationsExpected) : "-", fmt.int(s.iterationsAchieved),
          s.iterationsExpected ? `${((s.iterationsAchieved / s.iterationsExpected) * 100).toFixed(0)} %` : "-", earlyBy[String(s.key).toLowerCase()] || "-"]), "wl")}
      ${figure(c, "load")}
    </section>`);

    // 3 & 4 results
    const aggNote = m.aggregation && m.aggregation.active ? `<div class="aggnote"><b>${esc(m.aggregation.title)}.</b> ${esc(m.aggregation.note)}</div>` : "";
    const slaSet = m.settings && m.settings.sla && Object.keys(m.settings.sla.perTx || {}).length + (m.settings.sla.defaultSec != null ? 1 : 0);
    sections.push(`<section><h2>3. Results — ${winName.toLowerCase()}</h2>
      ${aggNote}
      <p class="muted">${w ? `${esc(fmt.relRange(m, w.start, w.end))} (${esc(fmt.dur(w.durationSec))}).` : "No steady-state window."} Response times in seconds, from every passed transaction. Count, Pass and Fail cover the same period.${slaSet ? ` SLA on P${m.settings.sla.percentile}.` : ""}</p>
      ${txTable(m, "steady")}
      ${figure(c, "txBars")}
    </section>`);
    sections.push(`<section><h2>4. Results — whole test</h2>${aggNote}<p class="muted">${esc(fmt.relRange(m, 0, m.meta.durationSec))} (${esc(fmt.dur(m.meta.durationSec))}), including ramp-up and ramp-down. Response times in seconds.</p>${txTable(m, "full")}</section>`);

    // 5 Trends
    sections.push(`<section><h2>5. Behaviour over time</h2>${["rtOverTime", "throughput", "latencyHeat", "tpsVsRt", "vuserHeat"].map((k) => figure(c, k)).join("")}</section>`);

    // 6 Errors — every group, with a real message (script line included)
    sections.push(`<section><h2>6. Errors</h2>${m.errors ? (m.errors.total ? `<p>${fmt.int(m.errors.total)} error(s) logged, in ${fmt.int(m.errors.summary.length)} group(s). Errors with the same code, script line and message are counted together; times are local.</p>` +
      table([["Count", { num: true, w: 6 }], ["Code", { w: 6 }], ["Message (example)", { w: 46 }], ["Script", { w: 18 }], ["VUsers", { num: true, w: 5 }], ["First", { w: 9.5 }], ["Last", { w: 9.5 }]],
        m.errors.summary.map((g) => [fmt.int(g.count), g.code, g.example || g.pattern, g.script || "-", g.vusers.length,
          g.firstUtc != null ? fmt.when(g.firstUtc, off, true) : "-", g.lastUtc != null ? fmt.when(g.lastUtc, off, true) : "-"]), "err") : "<p>No errors were logged.</p>") : "<p>Error log (SqliteDb.db) not available.</p>"}
      ${figure(c, "errors")}${figure(c, "httpCodes")}</section>`);

    // 7 Infrastructure
    if (c.lgHealth || c.rtPerLg || c.bytes) sections.push(`<section><h2>7. Load generators and network</h2>${figure(c, "lgHealth")}${figure(c, "rtPerLg")}${figure(c, "bytes")}</section>`);

    // 8 Findings
    sections.push(`<section><h2>8. All findings</h2>${ins.findings.length ? ins.findings.map((f) => `<div class="finding" style="border-left-color:${fmt.SEVERITY[f.severity].color}"><span class="sev" style="background:${fmt.SEVERITY[f.severity].color}">${fmt.SEVERITY[f.severity].label}</span> <b>${esc(f.title)}</b><p>${esc(f.text)}</p></div>`).join("") : "<p>No findings.</p>"}</section>`);

    // About
    sections.push(`<section><h2>About this report</h2>${table([["Item", { w: 24 }], ["How it is worked out", { w: 76 }]], fmt.aboutRows(m), "kvt")}</section>`);

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @page { size: A4 landscape; margin: 12mm 12mm 14mm; }
  :root { --ink:#0f172a; --muted:#475569; --line:#e2e8f0; --accent:#1e40af; --soft:#eef2ff; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Inter, system-ui, sans-serif; color: var(--ink); background: #fff; font-size: 10pt; line-height: 1.45; margin: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  main { max-width: 273mm; margin: 0 auto; padding: 4mm 0; }
  h1 { font-size: 26pt; margin: 6mm 0 3mm; color: var(--accent); line-height: 1.15; }
  h2 { font-size: 16pt; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 2mm; margin: 0 0 4mm; }
  h3 { font-size: 11.5pt; margin: 4mm 0 2mm; }
  section { break-before: page; }
  section.cover { break-before: auto; min-height: 170mm; display: flex; flex-direction: column; justify-content: center; }
  .eyebrow { text-transform: uppercase; letter-spacing: .12em; color: var(--muted); font-size: 9pt; }
  .lead { font-size: 13pt; color: var(--muted); }
  .verdict { display: inline-block; border: 2px solid; border-radius: 6px; padding: 3mm 6mm; font-size: 17pt; font-weight: 700; margin: 8mm 0; align-self: flex-start; }
  .logo { max-height: 18mm; max-width: 60mm; align-self: flex-start; margin-bottom: 10mm; }
  .muted { color: var(--muted); font-size: 9pt; }
  .aggnote { background: #fef3c7; border-left: 3px solid #d97706; padding: 2mm 3mm; font-size: 9pt; margin: 0 0 3mm; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 3mm; margin: 0 0 3mm; }
  .kpi { border: 1px solid var(--line); border-left: 3px solid var(--accent); border-radius: 6px; padding: 2.5mm 3mm; break-inside: avoid; }
  .kpi.ok { border-left-color: #16a34a; } .kpi.warn { border-left-color: #d97706; } .kpi.bad { border-left-color: #dc2626; }
  .kl { font-size: 8.5pt; color: var(--muted); } .kv { font-size: 16pt; font-weight: 700; white-space: nowrap; } .ks { font-size: 8pt; color: var(--muted); }
  .kpi.ok .kv { color: #15803d; } .kpi.warn .kv { color: #b45309; } .kpi.bad .kv { color: #b91c1c; }
  .traffic { font-size: 9.5pt; background: var(--soft); border-radius: 6px; padding: 2mm 3mm; margin: 0 0 2mm; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 6mm; align-items: start; }
  table { width: 100%; border-collapse: collapse; margin: 1mm 0 3mm; font-size: 8.5pt; table-layout: fixed; }
  th { background: var(--accent); color: #fff; text-align: left; padding: 1.5mm 1.8mm; font-weight: 600; vertical-align: bottom; }
  td { border-bottom: 1px solid var(--line); padding: 1.2mm 1.8mm; vertical-align: top; overflow-wrap: anywhere; }
  th.num, td.num { text-align: right; font-variant-numeric: tabular-nums; }
  td.num { white-space: nowrap; overflow-wrap: normal; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  table.kvt td:first-child { font-weight: 600; width: 32%; }
  table.err td:nth-child(2) { white-space: nowrap; }
  tr.group td { background: var(--soft); color: var(--accent); }
  tbody tr:nth-child(even) td { background: #f8fafc; } tr.group td { background: var(--soft) !important; }
  .ok { color: #15803d; font-weight: 600; } .bad { color: #b91c1c; font-weight: 600; }
  .sev { display: inline-block; color: #fff; border-radius: 3px; padding: 0 1.5mm; font-size: 7.5pt; font-weight: 700; vertical-align: 1px; }
  ul.findings { padding-left: 4mm; margin: 0; } ul.findings li { margin: 1.5mm 0; font-size: 9pt; break-inside: avoid; }
  ul.good { padding-left: 4mm; margin: 0; columns: 2; column-gap: 6mm; font-size: 8.5pt; color: #15803d; } ul.good li { break-inside: avoid; margin: .6mm 0; }
  .finding { border-left: 3px solid var(--line); padding: 1mm 0 1mm 3mm; margin: 2mm 0; break-inside: avoid; } .finding p { margin: 1mm 0 0; font-size: 9pt; }
  figure { margin: 3mm 0 5mm; break-inside: avoid; } figcaption { font-size: 8.5pt; color: var(--muted); text-align: center; }
  .chart { width: 100%; max-width: 215mm; max-height: 82mm; height: auto; display: block; margin: 0 auto; } /* two charts per landscape page */
  @media screen { body { background: #f1f5f9; } main { background: #fff; padding: 12mm; margin: 6mm auto; box-shadow: 0 1px 6px rgba(0,0,0,.12); } section { border-top: 1px dashed var(--line); padding-top: 6mm; margin-top: 8mm; } section.cover { border: 0; min-height: auto; } }
</style></head><body><main>${sections.join("\n")}</main></body></html>`;
  }

  return { buildReport, CHART_TITLES };
});
