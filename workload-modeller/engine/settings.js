/**
 * settings.js — the team settings (UMD, browser + Node).
 * The figures a team agrees on — machine types with their Vusers per machine, the load-generator limits, the schedule
 * defaults, the protocol assumptions — live in workload-modeller/config/workload-settings.json on the server. An admin
 * edits that file; every user gets the new figures on the next page load (nothing to build or restart). Users can still
 * change any figure on the page for one plan: the file only sets the starting values.
 *
 *   const { settings, problems } = WorkloadSettings.read(json);
 *
 * Every value is checked; a missing or wrong one keeps the built-in default and is named in `problems`, so a typing
 * mistake in the file never breaks the page. Unknown keys are ignored.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WorkloadSettings = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const DEFAULTS = {
    updated: null,
    machineTypes: [
      { id: "onprem-win", label: "On-premise Windows server", location: "On-premise", cores: 8, memoryGb: 32, diskGb: 230, webVusersPerLg: 100, apiVusersPerLg: 250 },
      { id: "aws-linux", label: "AWS c6a.4xlarge — Linux", location: "AWS", cores: 16, memoryGb: 32, webVusersPerLg: 200, apiVusersPerLg: 500, cpuWord: "vCPU" },
      { id: "aws-win", label: "AWS c6a.4xlarge — Windows", location: "AWS", cores: 16, memoryGb: 32, webVusersPerLg: 200, apiVusersPerLg: 500, cpuWord: "vCPU" },
    ],
    loadGenerators: { busyLimitPct: 70, extraMachines: 1, smallestGroup: 5, fastLoopRequestsPerSecond: 2 },
    schedule: { headroomPct: 25, maxStartRatePerSecond: 2 },
    protocols: {
      web: { memoryMbPerVuser: 5, vusersPerCore: 50 }, devweb: { memoryMbPerVuser: 3, vusersPerCore: 80 },
      truclient: { memoryMbPerVuser: 350, vusersPerCore: 2 }, other: { memoryMbPerVuser: 10, vusersPerCore: 30 },
    },
  };
  // [key, lowest, highest, whole number]
  const LG = [["busyLimitPct", 10, 100, false], ["extraMachines", 0, 50, true], ["smallestGroup", 1, 1000, true], ["fastLoopRequestsPerSecond", 0.1, 1000, false]];
  const SCHED = [["headroomPct", 0, 500, false], ["maxStartRatePerSecond", 0.01, 1000, false]];
  const PROTO = [["memoryMbPerVuser", 0.1, 100000, false], ["vusersPerCore", 0.1, 100000, false]];
  const TYPE_NUM = [["cores", 1, 1024, false], ["memoryGb", 1, 16384, false], ["diskGb", 1, 1000000, false], ["webVusersPerLg", 1, 100000, false], ["apiVusersPerLg", 1, 100000, false]];

  const clone = (x) => JSON.parse(JSON.stringify(x));
  const isObj = (x) => x && typeof x === "object" && !Array.isArray(x);
  function num(src, key, lo, hi, whole, where, problems) {
    if (!isObj(src) || !(key in src)) return undefined;
    const v = src[key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < lo || v > hi || (whole && !Number.isInteger(v))) {
      problems.push(`${where}.${key}: ${JSON.stringify(v)} is not ${whole ? "a whole number" : "a number"} from ${lo} to ${hi} — the built-in value is used`);
      return undefined;
    }
    return v;
  }
  function section(src, defs, base, where, problems) {
    if (src !== undefined && !isObj(src)) { problems.push(`${where}: not a group of settings — the built-in values are used`); return base; }
    defs.forEach(([k, lo, hi, whole]) => { const v = num(src, k, lo, hi, whole, where, problems); if (v !== undefined) base[k] = v; });
    return base;
  }

  function read(json) {
    const problems = [], s = clone(DEFAULTS);
    if (!isObj(json)) return { settings: s, problems: ["the settings file is not a JSON object — the built-in values are used"] };
    if (typeof json.updated === "string" && json.updated.length <= 40) s.updated = json.updated;
    section(json.loadGenerators, LG, s.loadGenerators, "loadGenerators", problems);
    section(json.schedule, SCHED, s.schedule, "schedule", problems);
    if (json.protocols !== undefined) {
      if (!isObj(json.protocols)) problems.push("protocols: not a group of settings — the built-in values are used");
      else Object.keys(json.protocols).forEach((k) => {
        if (!s.protocols[k]) { problems.push(`protocols.${k}: not a protocol the tool knows (web, devweb, truclient, other) — ignored`); return; }
        section(json.protocols[k], PROTO, s.protocols[k], "protocols." + k, problems);
      });
    }
    if (json.machineTypes !== undefined) {
      if (!Array.isArray(json.machineTypes)) problems.push("machineTypes: not a list — the built-in machine types are used");
      else {
        const types = [], ids = new Set();
        json.machineTypes.forEach((t, i) => {
          const where = `machineTypes[${i}]`;
          if (!isObj(t)) { problems.push(`${where}: not a machine type — left out`); return; }
          const id = typeof t.id === "string" && /^[a-z0-9-]{1,40}$/i.test(t.id) ? t.id : null;
          const label = typeof t.label === "string" && t.label.trim() && t.label.length <= 80 ? t.label.trim() : null;
          if (!id || id === "custom" || ids.has(id)) { problems.push(`${where}: needs a unique "id" (letters, digits, -; not "custom") — left out`); return; }
          if (!label) { problems.push(`${where} (${id}): needs a "label" — left out`); return; }
          const out = { id, label, location: typeof t.location === "string" && t.location.trim() ? t.location.trim().slice(0, 40) : label.split(/\s+[—-]\s+/)[0] };
          if (typeof t.cpuWord === "string" && t.cpuWord.length <= 20) out.cpuWord = t.cpuWord;
          TYPE_NUM.forEach(([k, lo, hi, whole]) => { const v = num(t, k, lo, hi, whole, `${where} (${id})`, problems); if (v !== undefined) out[k] = v; });
          if (!out.cores || !out.memoryGb) { problems.push(`${where} (${id}): needs "cores" and "memoryGb" — left out`); return; }
          ids.add(id); types.push(out);
        });
        if (types.length) s.machineTypes = types;
        else problems.push("machineTypes: no usable machine type — the built-in machine types are used");
      }
    }
    return { settings: s, problems };
  }
  // "8 CPU cores · 32 GB memory · 230 GB disk"
  const note = (t) => `${t.cores} ${t.cpuWord || "CPU cores"} · ${t.memoryGb} GB memory${t.diskGb ? ` · ${t.diskGb} GB disk` : ""}`;
  return { read, note, DEFAULTS: clone(DEFAULTS) };
});
