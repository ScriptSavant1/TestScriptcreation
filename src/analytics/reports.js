"use strict";

const db = require("./db");

const TOOL_LABELS = {
  converter: "Postman / Bruno Converter",
  jmx:       "JMeter Converter",
  recorder:  "Recorder",
  studio:    "Script Studio",
};

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/**
 * Returns the full stats object used by the admin dashboard.
 * @param {object} opts  { from, to } — ISO date strings (YYYY-MM-DD)
 */
function getStats(opts = {}) {
  const raw = db.queryStats(opts);
  const { totals, toolBreakdown, protocolBreakdown, topMachines, topFiles, dailyTrend, hourlyHeatmap } = raw;

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

  return {
    total, successCount, failCount, timeoutCount, successRate,
    avgDurationMs,
    avgDurationLabel: (avgDurationMs / 1000).toFixed(1) + "s",
    uniqueDevices:  totals.unique_devices || 0,
    uniqueHosts:    totals.unique_hosts   || 0,
    toolRows, protoRows, machineRows, fileRows,
    dailyTrend, heatmap,
    peakHour, peakDow,
    peakDayLabel: peakDow !== null ? DAY_NAMES[peakDow] : null,
    insights: generateInsights({ total, successCount, failCount, timeoutCount, successRate, avgDurationMs, toolRows, peakHour, peakDow }),
  };
}

/**
 * Auto-generated natural-language insights from the stats data.
 */
function generateInsights(s) {
  const insights = [];
  if (s.total === 0) return ["No conversions recorded in this period."];

  // Reliability
  if (s.successRate >= 98) {
    insights.push(`Excellent reliability — ${s.successRate}% success rate across ${s.total.toLocaleString()} conversions.`);
  } else if (s.successRate >= 90) {
    insights.push(`Good reliability at ${s.successRate}% success. ${s.failCount} failure${s.failCount !== 1 ? "s" : ""} worth reviewing in the event log.`);
  } else {
    insights.push(`Success rate is ${s.successRate}% — below expectations. ${s.failCount} failures recorded; review error codes in the event log.`);
  }

  // Top tool
  if (s.toolRows.length > 0) {
    const top = s.toolRows[0];
    const notes = {
      studio:    "indicating deep HAR correlation work is the primary activity",
      converter: "indicating collection-based scripting is the most common workflow",
      jmx:       "indicating JMeter migration is an active workstream",
      recorder:  "indicating browser-capture recording is frequently used",
    };
    insights.push(`${top.label} is the most used tool at ${top.pct}% of conversions (${top.count.toLocaleString()} total), ${notes[top.tool] || ""}.`);
  }

  // Peak time
  if (s.peakHour !== null && s.peakDow !== null) {
    const dayName  = DAY_NAMES[s.peakDow];
    const period   = s.peakHour < 12 ? "morning" : s.peakHour < 17 ? "afternoon" : "evening";
    insights.push(`Peak usage is ${dayName} ${s.peakHour}:00–${s.peakHour + 1}:00, suggesting scripting sessions align with ${period} ${dayName.toLowerCase()} workflows.`);
  }

  // Timeouts
  if (s.timeoutCount > 0) {
    insights.push(`${s.timeoutCount} conversion${s.timeoutCount !== 1 ? "s" : ""} timed out. These typically occur with HAR files over 150 MB — splitting large recordings into smaller journeys will resolve this.`);
  }

  // Performance
  if (s.avgDurationMs > 0) {
    const sec = (s.avgDurationMs / 1000).toFixed(1);
    const rating = s.avgDurationMs < 5000 ? "excellent" : s.avgDurationMs < 15000 ? "good" : "moderate";
    insights.push(`Average conversion time is ${sec}s — ${rating} performance, well within the 120-second timeout limit.`);
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
  return (kb / 1024).toFixed(1) + " MB";
}

module.exports = { getStats, dateRangePreset };
