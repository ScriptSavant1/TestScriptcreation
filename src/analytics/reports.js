"use strict";

const db = require("./db");

const TOOL_LABELS = {
  recorder:  "Recorder",
  explorer:  "HAR Explorer",
  studio:    "Script Studio",
  converter: "Postman / Bruno Converter",
  jmx:       "JMeter Converter",
  analyser:  "Results Analyser",
};
// the order the tools are shown in everywhere (sidebar order)
const TOOL_ORDER = ["recorder", "explorer", "studio", "converter", "jmx", "analyser"];

const ERROR_LABELS = {
  timeout: "Took too long (time-out)",
  parse_error: "File could not be read",
  unsupported_file_type: "Unsupported file type",
  file_too_large: "File too large",
  unreadable_recording: "Recording could not be read",
  rawdata_missing: "RawData.eve not in the folder",
  out_of_memory: "Browser ran out of memory",
  analysis_error: "Analysis failed",
  cancelled: "Cancelled before it finished",
  page_closed: "Page closed before it finished",
  client_error: "Failed in the browser",
  unknown: "Unknown error",
};

const fmtDuration = (ms) => (!ms ? "—" : ms < 1000 ? Math.round(ms) + " ms" : ms < 60000 ? (ms / 1000).toFixed(1) + " s" : Math.round(ms / 60000) + " min");

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Returns the full stats object used by the admin dashboard.
 * @param {object} opts  { from, to } — ISO date strings (YYYY-MM-DD)
 */
function getStats(opts = {}) {
  const raw = db.queryStats(opts);
  const { totals, toolBreakdown, protocolBreakdown, topMachines, topFiles, dailyTrend, hourlyHeatmap, toolSummary, topPeople, problems, dailyByTool } = raw;

  const total        = totals.total        || 0;
  const successCount = totals.success_count || 0;
  const failCount    = totals.fail_count    || 0;
  const timeoutCount = totals.timeout_count || 0;
  const successRate  = total > 0 ? Math.round((successCount / total) * 100) : 0;
  const avgDurationMs = totals.avg_duration_ms || 0;

  // Tool breakdown — add label + percentage
  const toolRows = toolBreakdown.map((r) => ({
    tool:    r.tool,
    label:   TOOL_LABELS[r.tool] || r.tool,
    count:   r.n,
    pct:     total > 0 ? Math.round((r.n / total) * 100) : 0,
  }));

  // Protocol breakdown
  const protoRows = protocolBreakdown.map((r) => ({
    protocol: r.protocol || "unknown",
    label:    r.protocol === "devweb" ? "DevWeb JS" : r.protocol === "vugen" ? "VuGen C" : (r.protocol || "Unknown"),
    count:    r.n,
    pct:      total > 0 ? Math.round((r.n / total) * 100) : 0,
  }));

  // Top machines — add success rate
  const machineRows = topMachines.map((m) => ({
    machine:      m.machine,
    ip_address:   m.ip_address,
    device_id:    m.device_id ? m.device_id.slice(0, 8) : null, // show short prefix only
    count:        m.n,
    success_rate: m.n > 0 ? Math.round((m.success_count / m.n) * 100) : 0,
    last_seen:    m.last_seen ? m.last_seen.slice(0, 16).replace("T", " ") : null,
  }));

  // Top files — format sizes
  const fileRows = topFiles.map((f) => ({
    filename:       f.filename,
    ext:            f.file_ext || "",
    count:          f.n,
    avg_size_kb:    f.avg_size_kb,
    avg_size_label: formatSize(f.avg_size_kb),
    avg_duration_s: f.avg_duration_ms ? (f.avg_duration_ms / 1000).toFixed(1) : null,
  }));

  // Peak hour + day from heatmap
  let peakHour = null;
  let peakDow  = null;
  let peakVal  = 0;
  for (const h of hourlyHeatmap) {
    if (h.n > peakVal) { peakVal = h.n; peakHour = h.hour; peakDow = h.dow; }
  }

  // Build 24×7 heatmap matrix [hour][dow] = count
  const heatmap = Array.from({ length: 24 }, () => Array(7).fill(0));
  for (const h of hourlyHeatmap) {
    heatmap[h.hour][h.dow] = h.n;
  }

  // ── per tool: uses, people, success, average time, DevWeb / VuGen ──
  const toolSummaryRows = toolSummary
    .sort((a, b) => TOOL_ORDER.indexOf(a.tool) - TOOL_ORDER.indexOf(b.tool))
    .map((t) => ({
      tool:        t.tool,
      label:       TOOL_LABELS[t.tool] || t.tool,
      count:       t.n,
      pct:         total > 0 ? Math.round((t.n / total) * 100) : 0,
      people:      t.people,
      successRate: t.n > 0 ? Math.round((t.success_count / t.n) * 100) : 0,
      problems:    t.problem_count,
      avgDurationMs:    t.avg_duration_ms || 0,
      avgDurationLabel: fmtDuration(t.avg_duration_ms),
      devweb:      t.devweb,
      vugen:       t.vugen,
      outputLabel: t.devweb || t.vugen ? `DevWeb ${t.devweb} · VuGen ${t.vugen}` : "—",
    }));

  // ── who uses it: one row per machine ──
  const peopleRows = topPeople.map((p) => ({
    person:      p.person,
    machine:     p.hostname || p.ip_address || null,
    ip_address:  p.ip_address || null,
    count:       p.n,
    pct:         total > 0 ? Math.round((p.n / total) * 100) : 0,
    successRate: p.n > 0 ? Math.round((p.success_count / p.n) * 100) : 0,
    tools:       String(p.tools || "").split(",").filter(Boolean).sort((a, b) => TOOL_ORDER.indexOf(a) - TOOL_ORDER.indexOf(b)).map((t) => TOOL_LABELS[t] || t),
    firstSeen:   p.first_seen ? p.first_seen.slice(0, 10) : null,
    lastSeen:    p.last_seen ? p.last_seen.slice(0, 16).replace("T", " ") : null,
  }));

  // ── problems: failures and time-outs grouped by error and tool ──
  const problemRows = problems.map((e) => ({
    code:     e.error_code,
    label:    ERROR_LABELS[e.error_code] || e.error_code,
    tools:    String(e.tools || "").split(",").filter(Boolean).sort((a, b) => TOOL_ORDER.indexOf(a) - TOOL_ORDER.indexOf(b)),
    toolLabel: String(e.tools || "").split(",").filter(Boolean).sort((a, b) => TOOL_ORDER.indexOf(a) - TOOL_ORDER.indexOf(b)).map((t) => TOOL_LABELS[t] || t).join(", "),
    count:    e.n,
    people:   e.people,
    lastSeen: e.last_seen ? e.last_seen.slice(0, 16).replace("T", " ") : null,
  }));

  // ── uses per day and tool, every day of the period (zero days included, so the chart is a true timeline) ──
  const dayList = [];
  const first = opts.from || (dailyByTool[0] && dailyByTool[0].day);
  const last  = opts.to   || (dailyByTool.length ? dailyByTool[dailyByTool.length - 1].day : null);
  if (first && last) {
    for (let d = new Date(first + "T00:00:00Z"), end = new Date(last + "T00:00:00Z"); d <= end && dayList.length < 400; d.setUTCDate(d.getUTCDate() + 1)) dayList.push(d.toISOString().slice(0, 10));
  }
  const toolsSeen = TOOL_ORDER.filter((t) => dailyByTool.some((r) => r.tool === t)).concat([...new Set(dailyByTool.map((r) => r.tool))].filter((t) => !TOOL_ORDER.includes(t)));
  const dailyTools = {
    days:   dayList,
    series: toolsSeen.map((t) => ({ tool: t, label: TOOL_LABELS[t] || t, counts: dayList.map((day) => (dailyByTool.find((r) => r.day === day && r.tool === t) || {}).n || 0) })),
  };

  return {
    total, successCount, failCount, timeoutCount, successRate,
    avgDurationMs,
    avgDurationLabel: (avgDurationMs / 1000).toFixed(1) + "s",
    uniqueDevices:  totals.unique_devices || 0,
    uniqueHosts:    totals.unique_hosts   || 0,
    uniquePeople:   totals.unique_people  || 0,
    toolRows, protoRows, machineRows, fileRows,
    toolSummaryRows, peopleRows, problemRows, dailyTools,
    busiestTool: toolSummaryRows.slice().sort((a, b) => b.count - a.count)[0] || null,
    dailyTrend, heatmap,
    peakHour, peakDow,
    peakDayLabel: peakDow !== null ? DAY_NAMES[peakDow] : null,
    insights: generateInsights({ total, successCount, failCount, timeoutCount, successRate, avgDurationMs, toolRows, peakHour, peakDow, peopleRows, uniquePeople: totals.unique_people || 0, problemRows }),
  };
}

/**
 * Auto-generated natural-language insights from the stats data.
 */
function generateInsights(s) {
  const insights = [];
  if (s.total === 0) return ["No use of PerfX Studio was recorded in this period."];

  // Reliability
  if (s.successRate >= 98) {
    insights.push(`Excellent reliability — ${s.successRate}% success rate across ${s.total.toLocaleString()} uses.`);
  } else if (s.successRate >= 90) {
    insights.push(`Good reliability at ${s.successRate}% success. ${s.failCount} failure${s.failCount !== 1 ? "s" : ""} worth reviewing under Problems.`);
  } else {
    insights.push(`Success rate is ${s.successRate}% — below expectations. ${s.failCount} failures recorded — see Problems.`);
  }

  // Top tool
  if (s.toolRows.length > 0) {
    const top = s.toolRows[0];
    const notes = {
      studio:    "indicating deep HAR correlation work is the primary activity",
      converter: "indicating collection-based scripting is the most common workflow",
      jmx:       "indicating JMeter migration is an active workstream",
      recorder:  "indicating browser-capture recording is frequently used",
      explorer:  "indicating recordings are investigated value by value before scripting",
      analyser:  "indicating test-result analysis is the main activity",
    };
    insights.push(`${top.label} is the most used tool at ${top.pct}% of uses (${top.count.toLocaleString()} total), ${notes[top.tool] || ""}.`);
  }

  // People
  if (s.uniquePeople > 0 && s.peopleRows.length) {
    const who = "machines";
    const lead = s.peopleRows[0];
    insights.push(`${s.uniquePeople.toLocaleString()} ${s.uniquePeople === 1 ? who.slice(0, -1) : who} used PerfX Studio; the most active was ${lead.person} with ${lead.count.toLocaleString()} use${lead.count === 1 ? "" : "s"} (${lead.pct}%).`);
  }

  // Most common problem
  if (s.problemRows && s.problemRows.length) {
    const p = s.problemRows[0];
    insights.push(`The most common problem was "${p.label}" (${p.count.toLocaleString()} time${p.count === 1 ? "" : "s"}, in ${p.toolLabel}) — see Problems.`);
  }

  // Peak time
  if (s.peakHour !== null && s.peakDow !== null) {
    const dayName  = DAY_NAMES[s.peakDow];
    const period   = s.peakHour < 12 ? "morning" : s.peakHour < 17 ? "afternoon" : "evening";
    insights.push(`Peak usage is ${dayName} ${s.peakHour}:00–${s.peakHour + 1}:00 — most scripting happens on ${dayName} ${period}s.`);
  }

  // Timeouts
  if (s.timeoutCount > 0) {
    insights.push(`${s.timeoutCount} conversion${s.timeoutCount !== 1 ? "s" : ""} timed out. These typically occur with HAR files over 150 MB — splitting large recordings into smaller journeys will resolve this.`);
  }

  return insights;
}

/** Build date filter for common presets. Returns { from, to } ISO date strings. */
function dateRangePreset(preset) {
  const now  = new Date();
  const pad  = (n) => String(n).padStart(2, "0");
  const fmt  = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const today = fmt(now);

  const ago  = (days) => { const d = new Date(now); d.setDate(d.getDate() - days); return fmt(d); };

  switch (preset) {
    case "7d":  return { from: ago(6),   to: today };
    case "30d": return { from: ago(29),  to: today };
    case "90d": return { from: ago(89),  to: today };
    case "mtd": {
      const d = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: fmt(d), to: today };
    }
    default:    return { from: null, to: null };  // all time
  }
}

function formatSize(kb) {
  if (!kb) return "—";
  if (kb < 1024) return kb + " KB";
  if (kb < 1048576) return (kb / 1024).toFixed(1) + " MB";
  return (kb / 1048576).toFixed(2) + " GB";
}

module.exports = { getStats, dateRangePreset };
