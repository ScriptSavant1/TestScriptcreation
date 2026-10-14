/**
 * trep.js — _t_rep.eve (text): per-VUser lifecycle, load generators, actual phases.
 *
 * Line formats seen (space-separated; event 8 has an empty time field → two spaces):
 *   28 11 <startTs> ...                                    scenario start
 *   28 4  <group> <vuser#> <ts> 0 <script> <LG> 0 1        VUser initialising (assigned to LG)
 *   28 0  <group> <vuser#> <ts> 0 <LG> 0                   VUser ready
 *   28 8  <group> <vuser#>  0 0                            (no time — meaning unknown, counted)
 *   28 2  <group> <vuser#> <ts> 0 p 0 0                    VUser running
 *   28 1  <group> <vuser#> <ts> 0 2                        VUser exited
 *   28 10 <LG> 30 0 0                                      LG connected
 *   28 12 <endTs> 1 <endTs> 0 <n>                          scenario end
 * Unrecognised lines/events are tallied, never guessed.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./text"));
  else (root.LreRA = root.LreRA || {}).trep = factory(root.LreRA.text);
})(typeof self !== "undefined" ? self : this, function (text) {
  "use strict";

  const num = (s) => { const n = Number(s); return s !== "" && Number.isFinite(n) ? n : null; };

  function parse(input) {
    const vusers = new Map(); // key "group|vuser#"
    const lgs = new Map();    // name → {name, connectedEvents, vusers}
    const unknown = {};
    let scenarioStart = null;
    let scenarioEnd = null;
    let lines = 0;

    const vu = (group, id) => {
      const key = group + "|" + id;
      if (!vusers.has(key)) vusers.set(key, { group, vuser: id, script: null, lg: null, initTs: null, readyTs: null, runTs: null, exitTs: null, exitCode: null });
      return vusers.get(key);
    };
    const lg = (name) => {
      if (!lgs.has(name)) lgs.set(name, { name, connected: 0, vusers: 0 });
      return lgs.get(name);
    };
    const tally = (k) => { unknown[k] = (unknown[k] || 0) + 1; };

    for (const raw of text.lines(text.decode(input))) {
      const line = raw.replace(/\s+$/, "");
      if (!line) continue;
      lines++;
      const f = line.split(" ");
      if (f[0] !== "28") { tally("prefix " + f[0]); continue; }
      const ev = f[1];
      switch (ev) {
        case "11": scenarioStart = num(f[2]); break;
        case "12": scenarioEnd = num(f[2]); break;
        case "10": lg(f[2]).connected++; break;
        case "4": { const v = vu(f[2], num(f[3])); v.initTs = num(f[4]); v.script = f[6] || null; v.lg = f[7] || null; break; }
        case "0": { const v = vu(f[2], num(f[3])); v.readyTs = num(f[4]); if (!v.lg && f[6]) v.lg = f[6]; break; }
        case "2": vu(f[2], num(f[3])).runTs = num(f[4]); break;
        case "1": { const v = vu(f[2], num(f[3])); v.exitTs = num(f[4]); v.exitCode = f[6] !== undefined ? f[6] : null; break; }
        case "8": vu(f[2], num(f[3])); tally("event 8 (no time, ignored)"); break;
        default: tally("event " + ev);
      }
    }

    const list = [...vusers.values()].sort((a, b) => (a.group < b.group ? -1 : a.group > b.group ? 1 : a.vuser - b.vuser));
    for (const v of list) if (v.lg) lg(v.lg).vusers++;

    // Actual phases: ramp-up ends when the last VUser starts running; steady state ends at the first exit.
    const runs = list.map((v) => v.runTs).filter((t) => t != null);
    const exits = list.map((v) => v.exitTs).filter((t) => t != null);
    const rampUpEnd = runs.length ? Math.max(...runs) : null;
    const firstExit = exits.length ? Math.min(...exits) : null;
    const lastExit = exits.length ? Math.max(...exits) : null;
    const steady = rampUpEnd != null && firstExit != null && firstExit > rampUpEnd
      ? { start: rampUpEnd, end: firstExit, durationSec: firstExit - rampUpEnd } : null;

    // VUser-ID scope: are numbers reused across groups? (decides how RawData.eve vuser_id is keyed)
    const idGroups = new Map();
    for (const v of list) {
      if (!idGroups.has(v.vuser)) idGroups.set(v.vuser, new Set());
      idGroups.get(v.vuser).add(v.group);
    }
    const sharedIds = [...idGroups.entries()].filter(([, g]) => g.size > 1).map(([id]) => id);
    const groups = [...new Set(list.map((v) => v.group))];

    // Max concurrently running VUsers (run → exit intervals)
    const edges = [];
    for (const v of list) if (v.runTs != null) { edges.push([v.runTs, 1]); edges.push([v.exitTs != null ? v.exitTs : Infinity, -1]); }
    edges.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    let cur = 0, maxRunning = 0;
    for (const [, d] of edges) { cur += d; if (cur > maxRunning) maxRunning = cur; }

    return {
      lines,
      scenarioStart, scenarioEnd,
      vusers: list,
      loadGenerators: [...lgs.values()],
      groups,
      maxRunning,
      phases: { scenarioStart, rampUpEnd, steady, rampDownStart: firstExit, lastExit, scenarioEnd },
      vuserIdScope: groups.length < 2 ? "single group (cannot tell)" : sharedIds.length ? "per group (numbers reused across groups)" : "global (unique across groups)",
      sharedVuserIds: sharedIds,
      neverRan: list.filter((v) => v.runTs == null).map((v) => v.group + "#" + v.vuser),
      neverExited: list.filter((v) => v.runTs != null && v.exitTs == null).map((v) => v.group + "#" + v.vuser),
      unknown,
    };
  }

  return { parse };
});
