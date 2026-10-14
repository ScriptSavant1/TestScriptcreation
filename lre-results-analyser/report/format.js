/**
 * format.js — shared formatting for the dashboard, Excel, Word and PDF/HTML reports.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).format = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PCT_KEYS = ["p50", "p80", "p85", "p90", "p95", "p99"];

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
      { phase: "Initialise / ramp-up", planned: start ? `${start.vusers} VUsers, ${start.batch} every ${start.everySec} s (${hms(rampPlanned)})` : "-",
        actual: p.rampUpEndRelSec != null ? `t+00:00:00 → t+${hms(p.rampUpEndRelSec)} (${hms(p.rampUpEndRelSec)})` : "-" },
      { phase: "Steady state", planned: run ? `Run for ${hms(run.durationSec)}` : "-",
        actual: p.steady ? `t+${hms(p.steady.startRelSec)} → t+${hms(p.steady.endRelSec)} (${hms(p.steady.durationSec)})` : "-" },
      { phase: "Ramp-down", planned: stop ? `${stop.vusers} VUsers, ${stop.batch} every ${stop.everySec} s (${hms(downPlanned)})` : "-",
        actual: p.rampDownStartRelSec != null && p.lastExitRelSec != null ? `t+${hms(p.rampDownStartRelSec)} → t+${hms(p.lastExitRelSec)} (${hms(p.lastExitRelSec - p.rampDownStartRelSec)})` : "-" },
    ];
    if (model.window && !model.window.detected) rows.push({ phase: "Analysis window (user-set)", planned: "-", actual: `t+${hms(model.window.start)} → t+${hms(model.window.end)} (${hms(model.window.durationSec)})` });
    for (const u of (model.meta.schedule && model.meta.schedule.unparsed) || []) rows.push({ phase: "Unparsed schedule step", planned: u, actual: "-" });
    return rows;
  }

  return { hms, localTime, utcTime, zone, relLocal, num, int, sec, bytes, SEVERITY, VERDICT, PCT_KEYS, groupByScript, scheduleRows };
});
