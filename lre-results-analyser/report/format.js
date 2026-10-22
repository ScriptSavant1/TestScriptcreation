/**
 * format.js — shared formatting for the dashboard, Excel, Word and PDF/HTML reports.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).format = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PCT_KEYS = ["p50", "p80", "p85", "p90", "p95", "p98", "p99"];

  function hms(s) {
    if (s == null || !Number.isFinite(s)) return "-";
    const neg = s < 0, t = Math.round(Math.abs(s));
    const out = `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
    return neg ? "-" + out : out;
  }

  /** "2026-09-29 14:33:50" in the run's local time (offset seconds), from unix seconds. */
  function localTime(utc, offsetSec) {
    if (utc == null) return "-";
    return new Date((utc + (offsetSec || 0)) * 1000).toISOString().replace("T", " ").slice(0, 19);
  }
  function utcTime(utc) { return utc == null ? "-" : new Date(utc * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC"; }
  function zone(offsetSec) {
    const h = (offsetSec || 0) / 3600;
    return "UTC" + (h >= 0 ? "+" : "-") + Math.abs(h).toString().replace(/\.5$/, ":30");
  }
  /** Relative seconds → local clock time of the run. */
  function relLocal(model, rel) {
    return model && model.meta && model.meta.startUtc != null ? localTime(model.meta.startUtc + rel, model.meta.localOffsetSec) : hms(rel);
  }

  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const p2 = (n) => String(n).padStart(2, "0");

  /** Duration in words: "1 day 3 h 36 min 43 s", "1 h 52 min 09 s", "4 min 10 s", "45 s". */
  function dur(s) {
    if (s == null || !Number.isFinite(s)) return "-";
    const t = Math.round(Math.abs(s));
    const d = Math.floor(t / 86400), h = Math.floor((t % 86400) / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
    const out = d ? `${d} day${d > 1 ? "s" : ""} ${h} h ${p2(m)} min ${p2(x)} s` : h ? `${h} h ${p2(m)} min ${p2(x)} s` : m ? `${m} min ${p2(x)} s` : `${x} s`;
    return (s < 0 ? "−" : "") + out;
  }
  /** Compact duration for tiles: "1 d 3 h 37 min", "3 h 04 min", "52 min 10 s", "45 s". */
  function durShort(s) {
    if (s == null || !Number.isFinite(s)) return "-";
    const t = Math.round(Math.abs(s));
    if (t >= 3600) {
      const m = Math.round(t / 60), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mi = m % 60;
      return (d ? `${d} d ${h} h` : `${h} h`) + ` ${p2(mi)} min`;
    }
    return t >= 60 ? `${Math.floor(t / 60)} min ${p2(t % 60)} s` : `${t} s`;
  }
  /** "Thu 08 Oct 2026, 07:07:39" (local, from unix s); short: "08 Oct 07:07". */
  function when(utc, offsetSec, short) {
    if (utc == null || !Number.isFinite(utc)) return "-";
    const d = new Date((utc + (offsetSec || 0)) * 1000);
    const clock = `${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}${short ? "" : ":" + p2(d.getUTCSeconds())}`;
    return short ? `${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${clock}`
      : `${DAYS[d.getUTCDay()]} ${p2(d.getUTCDate())} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${clock}`;
  }
  /** Seconds from the scenario start → "Thu 08 Oct 2026, 07:31:24" in the run's local time. */
  function relWhen(model, rel, short) {
    return model && model.meta && model.meta.startUtc != null && rel != null ? when(model.meta.startUtc + rel, model.meta.localOffsetSec, short) : hms(rel);
  }
  /** "Thu 08 Oct 2026, 07:31:24 → 09:23:33" (end date shown only when it differs). */
  function relRange(model, a, b) {
    const x = relWhen(model, a), y = relWhen(model, b);
    const day = (v) => v.split(", ")[0];
    return `${x} → ${y.includes(", ") && day(x) === day(y) ? y.split(", ")[1] : y}`;
  }

  const num = (v, d) => (v == null || !Number.isFinite(v) ? "-" : Number(v).toFixed(d == null ? 3 : d));
  const int = (v) => (v == null ? "-" : Number(v).toLocaleString("en-GB"));
  const sec = (s) => (s == null ? "-" : s < 1 ? `${(s * 1000).toFixed(0)} ms` : `${s.toFixed(s < 10 ? 2 : 1)} s`);
  const bytes = (b) => {
    if (b == null) return "-";
    const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0, v = b;
    while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 ? 2 : 1)} ${u[i]}`;
  };

  const SEVERITY = {
    high: { label: "High", color: "#dc2626" },
    medium: { label: "Medium", color: "#d97706" },
    low: { label: "Low", color: "#2563eb" },
    info: { label: "Info", color: "#64748b" },
    good: { label: "Good", color: "#16a34a" },
  };
  const VERDICT = { pass: { color: "#16a34a" }, warn: { color: "#d97706" }, fail: { color: "#dc2626" } };

  /** Transactions grouped by script: [{script, rows:[tx]}] (a tx listed in several scripts appears under each). */
  function groupByScript(model) {
    const groups = new Map();
    for (const t of model.transactions) {
      const keys = t.scripts && t.scripts.length ? t.scripts : [model.workload && model.workload.length === 1 ? model.workload[0].key : "(not in a script)"];
      for (const k of keys) { if (!groups.has(k)) groups.set(k, []); groups.get(k).push(t); }
    }
    return [...groups.entries()].map(([script, rows]) => ({ script, rows }));
  }

  /** Schedule rows: planned (from .lrr) vs actual (from _t_rep.eve). */
  function scheduleRows(model) {
    const steps = (model.meta.schedule && model.meta.schedule.steps) || [];
    const p = model.phases || {};
    const start = steps.find((s) => s.kind === "start"), run = steps.find((s) => s.kind === "run"), stop = steps.find((s) => s.kind === "stop");
    const rampPlanned = start ? Math.max(0, Math.ceil(start.vusers / start.batch) - 1) * start.everySec : null;
    const downPlanned = stop ? Math.max(0, Math.ceil(stop.vusers / stop.batch) - 1) * stop.everySec : null;
    const rows = [
      { phase: "Initialise / ramp-up", planned: start ? `${start.vusers} VUsers, ${start.batch} every ${start.everySec} s (${dur(rampPlanned)})` : "-",
        actual: p.rampUpEndRelSec != null ? `${relRange(model, 0, p.rampUpEndRelSec)} (${dur(p.rampUpEndRelSec)})` : "-" },
      { phase: "Steady state", planned: run ? `Run for ${dur(run.durationSec)}` : "-",
        actual: p.steady ? `${relRange(model, p.steady.startRelSec, p.steady.endRelSec)} (${dur(p.steady.durationSec)})` : "-" },
      { phase: "Ramp-down", planned: stop ? `${stop.vusers} VUsers, ${stop.batch} every ${stop.everySec} s (${dur(downPlanned)})` : "-",
        actual: p.rampDownStartRelSec != null && p.lastExitRelSec != null ? `${relRange(model, p.rampDownStartRelSec, p.lastExitRelSec)} (${dur(p.lastExitRelSec - p.rampDownStartRelSec)})` : "-" },
    ];
    const early = model.lifecycle && model.lifecycle.earlyExits ? model.lifecycle.earlyExits.length : 0;
    if (early) rows.push({ phase: "Stopped early", planned: "-", actual: `${early} VUser${early > 1 ? "s" : ""} stopped before the ramp-down` });
    if (model.window && !model.window.detected) rows.push({ phase: "Analysis window (user-set)", planned: "-", actual: `${relRange(model, model.window.start, model.window.end)} (${dur(model.window.durationSec)})` });
    for (const u of (model.meta.schedule && model.meta.schedule.unparsed) || []) rows.push({ phase: "Unparsed schedule step", planned: u, actual: "-" });
    return rows;
  }

  /** What a machine was used for, in words. */
  function roleName(l) { return l.role === "controller" ? "Controller" : l.vusers ? "Load generator" : "Monitored host"; }

  /** The test's key facts as [label, value] — the same on the page and in every report. */
  function testFacts(m) {
    const off = m.meta.localOffsetSec;
    const controller = (m.lgs || []).find((l) => l.role === "controller");
    const used = (m.lgs || []).filter((l) => l.vusers);
    const vusers = m.lifecycle ? m.lifecycle.vusers : (m.workload || []).reduce((a, x) => a + x.vusers, 0);
    return [
      ["Scenario", m.meta.sessionName], ["Project", m.meta.project],
      ["Run", [m.meta.runId != null ? `Run ${m.meta.runId}` : null, m.meta.resultName].filter(Boolean).join(" · ") || null],
      ["Start", `${when(m.meta.startUtc, off)} (${zone(off)})`], ["End", when(m.meta.stopUtc, off)], ["Duration", dur(m.meta.durationSec)],
      ["How it ended", m.meta.stopReason],
      ["Scripts", `${(m.workload || []).length} script${(m.workload || []).length === 1 ? "" : "s"} · ${int(vusers)} VUsers`],
      ["Load generators", `${used.length} machine${used.length === 1 ? "" : "s"} ran the VUsers`],
      ["Controller", controller ? controller.name : null], ["LoadRunner version", [m.meta.product, m.meta.version].filter(Boolean).join(" ")],
      ["Load behaviour", m.meta.loadBehavior],
    ].filter(([, v]) => v != null && v !== "");
  }

  /** "About this report": how the figures are worked out, in plain words — for every report. */
  function aboutRows(m) {
    const sla = m.settings && m.settings.sla && (m.settings.sla.defaultSec != null || Object.keys(m.settings.sla.perTx || {}).length);
    return [
      ["Where the numbers come from", "The raw results LoadRunner Enterprise saved for this run (RawData.eve and the files next to it). Nothing is estimated: every transaction the VUsers completed is counted."],
      ["Response time", "Seconds from the start to the end of each transaction, without think time and without wasted time — the same as LoadRunner Analysis."],
      ["Min, Avg, Max, percentiles", "Worked out from every passed transaction on its own. P90 = 90 % of the transactions were this fast or faster. Failed transactions are counted in Fail but left out of the timings, as LoadRunner does."],
      ["Steady state", m.window ? `${relRange(m, m.window.start, m.window.end)} (${dur(m.window.durationSec)})${m.window.detected ? " — from the end of the ramp-up (the last VUser started) to the start of the ramp-down (the final burst of VUsers stopping). VUsers that stopped earlier are listed, not used to cut the period short." : " — set by the user."}` : "Not detected."],
      ["Transactions per second", "Count ÷ length of the period in seconds."],
      ["Hits and throughput", "Hits = HTTP requests; throughput = bytes received from the application; averages are over the whole test, as in LoadRunner Analysis."],
      ["Errors", "Errors logged by the VUsers (LoadRunner's error log, error type only). Errors with the same code, script line and message are counted together."],
      ["SLA", sla ? `P${m.settings.sla.percentile} of each transaction against the thresholds entered; Apdex uses the threshold as T.` : "No thresholds were set."],
      ["Time zone", `All times are local to the test: ${zone(m.meta.localOffsetSec)}.`],
      ["Differences from LoadRunner Analysis", "Names, counts, pass/fail, averages, hits, HTTP codes and throughput match LoadRunner Analysis. Min, Max, Std Dev and percentiles can differ on busy transactions when LoadRunner Analysis has data aggregation switched on: it averages transactions into time slots first, while this report uses every transaction."],
      ["Produced by", `LRE Results Analyser ${m.engineVersion} on ${String(m.generatedAt || "").slice(0, 10)}`],
    ];
  }

  /**
   * Checks that passed, grouped: "Pacing achieved — <script>" × 62 becomes one line
   * "Pacing achieved — 62 scripts". Returns [{ title, count, items }].
   */
  function goodSummary(findings) {
    const groups = new Map();
    for (const f of findings || []) {
      if (f.severity !== "good") continue;
      const i = f.title.indexOf(" — ");
      const head = i > 0 ? f.title.slice(0, i) : f.title;
      if (!groups.has(head)) groups.set(head, []);
      if (i > 0) groups.get(head).push(f.title.slice(i + 3));
    }
    return [...groups.entries()].map(([title, items]) => ({ title, count: items.length, items }));
  }

  return { hms, dur, durShort, when, relWhen, relRange, localTime, utcTime, zone, relLocal, num, int, sec, bytes, SEVERITY, VERDICT, PCT_KEYS, groupByScript, scheduleRows,
    roleName, testFacts, aboutRows, goodSummary };
});
