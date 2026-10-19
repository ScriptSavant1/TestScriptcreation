/**
 * html.js — print-ready HTML report.
 * [Lines 1–6 of the original header comment were not in the photos — replace this block with the original.]
 *
 *
 *
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

  function table(head, rows, cls) {
    return `<table class="${cls || ""}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${
      rows.map((r) => `<tr${r._cls ? ` class="${r._cls}"` : ""}>${(r.cells || r).map((c) => (c && c.html != null ? `<td class="${c.cls || ""}">${c.html}</td>` : `<td>${esc(c)}</td>`)).join("")}</tr>`).join("")
    }</tbody></table>`;
  }

  function txTable(m, which) {
    const rows = [];
    for (const g of fmt.groupByScript(m)) {
      if (fmt.groupByScript(m).length > 1) rows.push({ _cls: "group", cells: [{ html: `<b>${esc(g.script)}</b>`, cls: "" }, "", "", "", "", "", "", "", "", "", ""] });
      for (const t of g.rows) {
        const s = t[which];
        const sla = which === "steady" && t.sla ? { html: t.sla.pass ? `<span class="ok">✔ ${n3(t.sla.threshold)}</span>` : `<span class="bad">✘ ${n3(t.sla.threshold)}</span>` } : "-";
        rows.push([t.name, fmt.int(s.count), t.failPct != null ? t.failPct.toFixed(2) + " %" : "-", n3(s.min), n3(s.avg), n3(s.p.p90), n3(s.p.p95), n3(s.p.p99), n3(s.max), fmt.num(s.tps, 3), sla]);
      }
    }
    return table(["Transaction", "Count", "Fail %", "Min", "Avg", "P90", "P95", "P99", "Max", "TPS", "SLA"], rows, "tx");
  }

  function buildReport(m, opts) {
    opts = opts || {};
    const c = opts.charts || {};
    const off = m.meta.localOffsetSec;
    const ins = m.insights || { verdict: { status: "warn", text: "-" }, findings: [] };
    const vcol = fmt.VERDICT[ins.verdict.status].color;
    const issues = ins.findings.filter((f) => ["high", "medium"].includes(f.severity));
    const good = ins.findings.filter((f) => f.severity === "good");
    const w = m.window;
    const title = opts.title || `Performance test report — ${m.meta.sessionName || "LRE run"}`;
    const kpi = (label, value, sub) => `<div class="kpi"><div class="kv">${esc(value)}</div><div class="kl">${esc(label)}</div>${sub ? `<div class="ks">${esc(sub)}</div>` : ""}</div>`;
    const slowest = m.transactions.filter((t) => t.steady.count).sort((a, b) => (b.steady.p.p90 || 0) - (a.steady.p.p90 || 0)).slice(0, 5);

    const sections = [];
    // Cover
    sections.push(`<section class="cover">
      ${opts.logoDataUrl ? `<img class="logo" src="${esc(opts.logoDataUrl)}" alt="logo">` : ""}
      <div class="eyebrow">${esc(opts.company || m.meta.project || "")}</div>
      <h1>${esc(title)}</h1>
      <p class="lead">${esc(fmt.localTime(m.meta.startUtc, off))} – ${esc(fmt.localTime(m.meta.stopUtc, off))} (${esc(fmt.zone(off))}) · ${esc(fmt.hms(m.meta.durationSec))}</p>
      <div class="verdict" style="border-color:${vcol};color:${vcol}">${esc(ins.verdict.text)}</div>
      <p class="muted">Computed from the LRE raw results by LRE Results Analyser ${esc(m.engineVersion)} on ${esc(m.generatedAt.slice(0, 10))}. Independent of LRE Analysis.</p>
    </section>`);

    // 1 Executive summary
    sections.push(`<section><h2>1. Executive summary</h2>
      <div class="kpis">
        ${kpi("Peak VUsers", fmt.int(m.totals.peakVusers))}
        ${kpi("Steady state", w ? fmt.hms(w.durationSec) : "-", w && !w.detected ? "user-set window" : "")}
        ${kpi("Transactions", fmt.int(m.totals.samples))}
        ${kpi("TPS (steady)", fmt.num(m.totals.tpsSteady, 2))}
        ${kpi("Failed", m.totals.fail != null ? fmt.int(m.totals.fail) : "n/a")}
        ${kpi("Errors", m.totals.errors != null ? fmt.int(m.totals.errors) : "n/a")}
      </div>
      <h3>Key findings</h3>
      ${issues.length ? `<ul class="findings">${issues.slice(0, 8).map((f) => `<li><span class="sev" style="background:${fmt.SEVERITY[f.severity].color}">${fmt.SEVERITY[f.severity].label}</span> <b>${esc(f.title)}.</b> ${esc(f.text)}</li>`).join("")}</ul>` : "<p>No significant issues were found.</p>"}
      ${good.length ? `<p class="muted">Also checked and fine: ${good.map((f) => esc(f.title)).join(" · ")}.</p>` : ""}
      <h3>Slowest transactions (steady state, P90)</h3>
      ${table(["Transaction", "P90", "P95", "Avg", "Count"], slowest.map((t) => [t.name, fmt.sec(t.steady.p.p90), fmt.sec(t.steady.p.p95), fmt.sec(t.steady.avg), fmt.int(t.steady.count)]))}
    </section>`);

    // 2 Test & workload
    sections.push(`<section><h2>2. Test and workload</h2>
      ${table(["Item", "Value"], [
        ["Scenario", m.meta.sessionName], ["Project", m.meta.project], ["Controller", [m.meta.product, m.meta.version].filter(Boolean).join(" ")],
        ["Start / end (local)", `${fmt.localTime(m.meta.startUtc, off)} – ${fmt.localTime(m.meta.stopUtc, off)} (${fmt.zone(off)})`],
        ["Stop reason", m.meta.stopReason], ["Schedule", m.meta.scheduleText || m.meta.schedule.raw], ["Load behaviour", m.meta.loadBehavior],
      ], "kvt")}
      <h3>Schedule — planned vs actual</h3>
      ${table(["Phase", "Planned", "Actual"], fmt.scheduleRows(m).map((r) => [r.phase, r.planned, r.actual]))}
      <h3>Workload model</h3>
      ${table(["Script", "Protocol", "VUsers", "Pacing", "Think time", "Iterations (achieved / planned)"], m.workload.map((s) => [s.key, s.protocol, s.vusers, s.pacing ? s.pacing.text : "-", s.thinkTime ? s.thinkTime.text : "-",
        `${fmt.int(s.iterationsAchieved)} / ${s.iterationsExpected != null ? fmt.int(s.iterationsExpected) : "-"}`]))}
      <h3>Load generators</h3>
      ${table(["Host", "IP", "Role", "VUsers", "CPU peak", "Memory peak"], m.lgs.map((l) => [l.name, l.ip || "-", l.role, l.vusers, l.cpuPeak != null ? l.cpuPeak.toFixed(0) + " %" : "-", l.memPeak != null ? l.memPeak.toFixed(0) + " %" : "-"]))}
      ${figure(c, "load")}
    </section>`);

    // 3 & 4 results
    sections.push(`<section><h2>3. Results — steady state</h2>
      <p class="muted">${w ? `${w.detected ? "Detected steady state" : "User-set analysis window"}: t+${fmt.hms(w.start)} – t+${fmt.hms(w.end)} (${esc(fmt.relLocal(m, w.start))} – ${esc(fmt.relLocal(m, w.end))}).` : "No steady-state window."} Response times in seconds. ${esc(m.method.summaryBasis || "")}. ${m.settings && m.settings.sla && Object.keys(m.settings.sla.perTx || {}).length + (m.settings.sla.defaultSec != null ? 1 : 0) ? `SLA on P${m.settings.sla.percentile}.` : ""}</p>
      ${txTable(m, "steady")}
      ${figure(c, "txBars")}
    </section>`);
    sections.push(`<section><h2>4. Results — full run</h2>${txTable(m, "full")}</section>`);

    // 5 Trends
    sections.push(`<section><h2>5. Behaviour over time</h2>${["rtOverTime", "throughput", "latencyHeat", "tpsVsRt", "vuserHeat"].map((k) => figure(c, k)).join("")}</section>`);

    // 6 Errors
    sections.push(`<section><h2>6. Errors</h2>${m.errors ? (m.errors.total ? `<p>${fmt.int(m.errors.total)} error(s) logged.</p>` +
      table(["Code", "Message pattern", "Script", "Count", "VUsers", "First (local)", "Last (local)"], m.errors.summary.slice(0, 25).map((g) => [g.code, g.pattern.slice(0, 160), g.script || "-", fmt.int(g.count), g.vusers.length,
        g.firstUtc != null ? fmt.localTime(g.firstUtc, off) : "-", g.lastUtc != null ? fmt.localTime(g.lastUtc, off) : "-"])) : "<p>No errors were logged.</p>") : "<p>Error log (SqliteDb.db) not available.</p>"}
      ${figure(c, "errors")}${figure(c, "httpCodes")}</section>`);

    // 7 Infrastructure
    if (c.lgHealth || c.rtPerLg || c.bytes) sections.push(`<section><h2>7. Load generators and network</h2>${figure(c, "lgHealth")}${figure(c, "rtPerLg")}${figure(c, "bytes")}</section>`);

    // 8 Findings
    sections.push(`<section><h2>8. All findings</h2>${ins.findings.length ? ins.findings.map((f) => `<div class="finding"><span class="sev" style="background:${fmt.SEVERITY[f.severity].color}">${fmt.SEVERITY[f.severity].label}</span> <b>${esc(f.title)}
      </b><p>${esc(f.text)}</p></div>`).join("") : "<p>No findings.</p>"}</section>`);
    // Appendix
    sections.push(`<section class="appendix"><h2>Appendix — method and validation</h2>
      ${table(["Item", "Method"], [
        ["Source", "RawData.eve (transactions, HTTP codes, hits, throughput); scenario files (.lrr, RunInfo.ini, _t_rep.eve, .usp, .cfg, .usr); SqliteDb.db (errors); sum_data only for LG health"],
        ["Transactions", m.method.transactionSource || "-"], ["Response time", m.method.responseTimeUnit], ["Transaction names", m.method.transactionNames || "-"],
        ["Transaction summary basis", m.method.summaryBasis || "-"], ["Chart granularity", m.method.chartGranularity || "-"],
        ["Percentiles", m.method.percentile], ["Standard deviation", m.method.stdDev], ["Steady state", m.method.steadyState],
        ["TPS", m.method.tps], ["Pass / fail", m.method.passFail], ["Negative response times", m.method.negativeResponseTimes],
        ["Time zone", `${fmt.zone(off)} — ${m.meta.localOffsetSource}`],
      ], "kvt")}
      <h3>Self-checks</h3>
      ${table(["Status", "Check", "Result"], m.selfCheck.map((s) => ({ cells: [{ html: `<span class="st st-${s.status}">${s.status.toUpperCase()}</span>` }, s.id, s.text] })))}
    </section>`);

    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 14mm 12mm 16mm; }
  :root { --ink:#0f172a; --muted:#475569; --line:#e2e8f0; --accent:#1e40af; }
  * { box-sizing: border-box; }
  body { font-family: "Segoe UI", Inter, system-ui, sans-serif; color: var(--ink); background: #fff; font-size: 10.5pt; line-height: 1.45; margin: 0; }
  main { max-width: 190mm; margin: 0 auto; padding: 8mm 0; }
  h1 { font-size: 24pt; margin: 6mm 0 3mm; color: var(--accent); line-height: 1.15; }
  h2 { font-size: 15pt; color: var(--accent); border-bottom: 2px solid var(--accent); padding-bottom: 2mm; margin: 0 0 4mm; }
  h3 { font-size: 11.5pt; margin: 5mm 0 2mm; }
  section { break-before: page; }
  section.cover { break-before: auto; min-height: 240mm; display: flex; flex-direction: column; justify-content: center; }
  .eyebrow { text-transform: uppercase; letter-spacing: .12em; color: var(--muted); font-size: 9pt; }
  .lead { font-size: 12pt; color: var(--muted); }
  .verdict { display: inline-block; border: 2px solid; border-radius: 6px; padding: 3mm 6mm; font-size: 16pt; font-weight: 700; margin: 8mm 0; align-self: flex-start; }
  .logo { max-height: 18mm; max-width: 60mm; align-self: flex-start; margin-bottom: 10mm; }
  .muted { color: var(--muted); font-size: 9pt; }
  .kpis { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin: 2mm 0 4mm; }
  .kpi { border: 1px solid var(--line); border-radius: 6px; padding: 3mm; }
  .kv { font-size: 16pt; font-weight: 700; color: var(--accent); }
  .kl { font-size: 9pt; color: var(--muted); } .ks { font-size: 8pt; color: var(--muted); }
  table { width: 100%; border-collapse: collapse; margin: 2mm 0 4mm; font-size: 8.5pt; page-break-inside: auto; }
  th { background: #1e40af; color: #fff; text-align: left; padding: 1.6mm 2mm; font-weight: 600; }
  td { border-bottom: 1px solid var(--line); padding: 1.3mm 2mm; vertical-align: top; }
  tr { break-inside: avoid; }
  table.tx td:not(:first-child), table.tx th:not(:first-child) { text-align: right; }
  table.kvt td:first-child { width: 32%; font-weight: 600; }
  tr.group td { background: #eef2ff; }
  .ok { color: #15803d; font-weight: 600; } .bad { color: #b91c1c; font-weight: 600; }
  .sev { display: inline-block; color: #fff; border-radius: 3px; padding: 0 1.5mm; font-size: 8pt; font-weight: 700; }
  ul.findings { padding-left: 4mm; } ul.findings li { margin: 1.5mm 0; }
  .finding { border-left: 3px solid var(--line); padding: 1mm 0 1mm 3mm; margin: 2mm 0; break-inside: avoid; } .finding p { margin: 1mm 0 0; }
  figure { margin: 4mm 0; break-inside: avoid; } figcaption { font-size: 8.5pt; color: var(--muted); text-align: center; }
  .chart { width: 100%; height: auto; display: block; }
  .st { font-weight: 700; font-size: 8pt; } .st-ok { color: #15803d; } .st-warn { color: #b45309; } .st-fail { color: #b91c1c; } .st-info { color: #475569; }
  @media screen { body { background: #f1f5f9; } main { background: #fff; padding: 12mm; margin: 6mm auto; box-shadow: 0 1px 6px rgba(0,0,0,.12); } section { border-top: 1px dashed var(--line); padding-top: 6mm; margin-top: 8mm; } section.cover { border: 0; min-height: auto; } }
</style></head><body><main>${sections.join("\n")}</main></body></html>`;
  }

  return { buildReport, CHART_TITLES };
});
