/**
 * scenario.js — run identity, time zone and schedule from RunInfo.ini + res*.lrr.
 *
 * Times: res*.lrr Start_time/Stop_time are UTC epoch seconds. RunInfo RunDate (and the
 * SqliteDb error times) are LOCAL controller time. The local offset is derived from the .lrr
 * Time_Zone / Daylight_Bias fields and confirmed against RunDate (see localOffset()).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ini"));
  else (root.LreRA = root.LreRA || {}).scenario = factory(root.LreRA.ini);
})(typeof self !== "undefined" ? self : this, function (ini) {
  "use strict";

  const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august",
                  "september", "october", "november", "december"];

  /** "29-September-2026 02:33:05 PM" → wall-clock seconds as if UTC (no zone), or null. */
  function parseRunDate(s) {
    const m = /^(\d{1,2})-([A-Za-z]+)-(\d{4})\s+(\d{1,2}):(\d{2}):(\d{2})\s*(AM|PM)?$/i.exec(String(s || "").trim());
    if (!m) return null;
    const mon = MONTHS.indexOf(m[2].toLowerCase());
    if (mon < 0) return null;
    let h = parseInt(m[4], 10);
    if (m[7]) { const pm = m[7].toUpperCase() === "PM"; if (h === 12) h = pm ? 12 : 0; else if (pm) h += 12; }
    return Date.UTC(parseInt(m[3], 10), mon, parseInt(m[1], 10), h, parseInt(m[5], 10), parseInt(m[6], 10)) / 1000;
  }

  /**
   * Local offset (seconds to ADD to UTC). Candidates from the Windows TZ fields: -(Bias) and
   * -(Bias + DaylightBias); the units of Time_Zone are not documented, so both minutes and seconds
   * are tried. The candidate that puts RunDate closest to (and not after) the scenario start wins.
   */
  function localOffset(lrrTz, lrrDaylight, runDateWall, startUtc) {
    const tz = Number(lrrTz) || 0;
    const dl = Number(lrrDaylight) || 0;
    // Windows convention: local = UTC - Bias (minutes); in daylight time also - DaylightBias.
    // Time_Zone in seconds (seen in some LoadRunner files) is the second pair.
    const cands = new Set([-tz * 60, -(tz + dl) * 60, -tz, -(tz + dl * 60)]);
    let best = null;
    if (runDateWall != null && startUtc) {
      for (const off of cands) {
        const diff = startUtc + off - runDateWall; // >= 0: RunDate is the session start, slightly before scenario start
        if (diff >= -60 && diff <= 3600 && (best === null || Math.abs(diff) < Math.abs(best.diff))) best = { off, diff };
      }
    }
    if (best) return { seconds: best.off, source: "lrr time-zone fields, confirmed by RunDate", confirmed: true };
    return { seconds: -(tz + dl) * 60, source: "lrr time-zone fields (not confirmed by RunDate)", confirmed: false };
  }

  /** "ST27_1E5;R28800;SP27_1E5;" → steps. Unknown tokens are kept verbatim, never guessed. */
  function parseSchedule(raw) {
    const steps = [];
    const unparsed = [];
    for (const tok of String(raw || "").split(";").map((t) => t.trim()).filter(Boolean)) {
      let m;
      if ((m = /^ST(\d+)_(\d+)E(\d+)$/.exec(tok))) steps.push({ kind: "start", vusers: +m[1], batch: +m[2], everySec: +m[3], token: tok });
      else if ((m = /^SP(\d+)_(\d+)E(\d+)$/.exec(tok))) steps.push({ kind: "stop", vusers: +m[1], batch: +m[2], everySec: +m[3], token: tok });
      else if ((m = /^R(\d+)$/.exec(tok))) steps.push({ kind: "run", durationSec: +m[1], token: tok });
      else unparsed.push(tok);
    }
    return { raw: String(raw || ""), steps, unparsed };
  }

  function describeStep(s) {
    if (s.kind === "start") return `Start ${s.vusers} Vusers: ${s.batch} every ${s.everySec}s`;
    if (s.kind === "stop") return `Stop ${s.vusers} Vusers: ${s.batch} every ${s.everySec}s`;
    if (s.kind === "run") return `Run for ${s.durationSec}s`;
    return s.token;
  }

  /**
   * @param {string|Uint8Array} runInfoBytes
   * @param {string|Uint8Array} lrrBytes
   */
  function parse(runInfoBytes, lrrBytes) {
    const ri = ini.parse(runInfoBytes || "");
    const lrr = ini.parse(lrrBytes || "");
    const startUtc = parseInt(lrr.get("Scenario", "Start_time"), 10) || null;
    const stopUtc = parseInt(lrr.get("Scenario", "Stop_time"), 10) || null;
    const runDate = ri.get("Report", "RunDate") || null;
    const offset = localOffset(lrr.get("Scenario", "Time_Zone"), lrr.get("Scenario", "Daylight_Bias"), parseRunDate(runDate), startUtc);

    const scripts = lrr.section("Scripts");
    const types = lrr.section("Scripts_types");
    const groups = scripts ? scripts.entries.map(([group, path]) => ({
      group,
      scriptPath: path,
      scriptName: String(path).split(/[\\/]/).pop().replace(/\.usr$/i, ""),
      protocol: (types && (types.values[group] || "")) || "",
    })) : [];

    const schedule = parseSchedule(lrr.get("Scenario_summary", "Global Schedule"));
    return {
      sessionName: ri.get("Report", "SessionName") || null,
      project: ri.get("Report", "CompanyName") || null,
      runDateLocal: runDate,
      durationMinutes: parseInt(ri.get("Report", "Duration"), 10) || null,
      product: lrr.get("Scenario", "Product") || null,
      version: lrr.get("Scenario", "Version") || null,
      resultName: lrr.get("Scenario", "ResultName") || null,
      startUtc, stopUtc,
      durationSec: startUtc && stopUtc ? stopUtc - startUtc : null,
      localOffsetSec: offset.seconds,
      localOffsetSource: offset.source,
      localOffsetConfirmed: offset.confirmed,
      startReason: lrr.get("Running_mode", "Start_reason") || null,
      stopReason: lrr.get("Running_mode", "Stop_reason") || null,
      scenarioType: lrr.get("Scenario_summary", "Scenario Type") || null,
      scheduleMode: lrr.get("Scenario_summary", "Mode") || null,
      loadBehavior: lrr.get("Scenario_summary", "Load Behavior") || null,
      scheduleText: lrr.get("Scenario_summary", "Scenario Duration") || null,
      schedule: Object.assign(schedule, { described: schedule.steps.map(describeStep) }),
      groups,
    };
  }

  return { parse, parseSchedule, parseRunDate, localOffset };
});
