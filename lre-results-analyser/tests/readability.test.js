"use strict";

/**
 * Report readability fixes: steady state in long soaks with early VUser exits, error grouping that
 * keeps the script line, VuGen random think time, and human-readable times.
 */
const trep = require("../engine/trep");
const errors = require("../engine/errors");
const runlogic = require("../engine/runlogic");
const insights = require("../engine/insights");
const fmt = require("../report/format");

const T0 = 1791443259; // a Thursday, 07:07:39 UTC

/** n VUsers run from T0+10; `early` of them exit at the given times; the rest ramp down 1 every 2 s from `downAt`. */
function soak(n, early, downAt) {
  const lines = [`28 11 ${T0} 2 1 1 1`];
  for (let i = 1; i <= n; i++) lines.push(`28 4 g ${i} ${T0 + 5} 0 Script_1 lg1 0 1`, `28 2 g ${i} ${T0 + 10} 0 p 0 0`);
  let k = 1;
  for (const t of early) lines.push(`28 1 g ${k++} ${T0 + t} 0 2`);
  for (let j = 0; k <= n; k++, j++) lines.push(`28 1 g ${k} ${T0 + downAt + j * 2} 0 2`);
  lines.push(`28 12 ${T0 + downAt + n * 2 + 5} 1 0 0 9`);
  return lines.join("\n");
}

describe("steady state in a long soak", () => {
  test("VUsers that stop early do not end the steady state; the final burst of exits is the ramp-down", () => {
    // 20 VUsers, 3 stop on error after 2 h / 5 h / 20 h; the rest ramp down after 27 h
    const t = trep.parse(soak(20, [7200, 18000, 72000], 97200), { rampDownGapSec: 6 });
    expect(t.phases.steady).toEqual({ start: T0 + 10, end: T0 + 97200, durationSec: 97190 });
    expect(t.phases.rampDownStart).toBe(T0 + 97200);
    expect(t.earlyExits.map((v) => v.exitTs - T0)).toEqual([7200, 18000, 72000]);
  });
  test("without early exits the steady state ends at the first exit, as before", () => {
    const t = trep.parse(soak(5, [], 3600));
    expect(t.phases.steady.end).toBe(T0 + 3600);
    expect(t.earlyExits).toEqual([]);
  });
  test("early exits become a finding, sized by the share of VUsers", () => {
    const m = {
      meta: { startUtc: T0, localOffsetSec: 3600, schedule: { steps: [] } }, lifecycle: { vusers: 20, earlyExits: [{ script: "Script_1" }, { script: "Script_1" }] },
      transactions: [], workload: [], timeline: null, vusers: [], errors: null, lgHealth: [],
    };
    const f = insights.run(m).findings.find((x) => /stopped before the end/.test(x.title));
    expect(f).toMatchObject({ severity: "high", title: "2 VUsers stopped before the end of the test" });
    expect(f.text).toMatch(/Script_1 \(2\)/);
  });
});

describe("error grouping keeps where and what failed", () => {
  const msg = (line, param) => `Action.c(${line}): Error -26377: No match found for the requested parameter "${param}". Check id 12345`;
  test("script line and error code stay in the pattern; other numbers are replaced", () => {
    expect(errors.pattern(msg(230, "C_internal_ID"))).toBe('Action.c(230): Error -26377: No match found for the requested parameter "C_internal_ID". Check id <n>');
  });
  test("the same message on different script lines is two groups, each with a real example", () => {
    const rows = [msg(230, "C_X"), msg(230, "C_X").replace("12345", "999"), msg(481, "C_X")].map((message, i) => ({ code: -26377, type: 2, time: `2026-10-08 07:1${i}:00`, message, script: "s" }));
    const s = errors.summarise(rows, 0, null);
    expect(s.summary.map((g) => [g.count, g.example.slice(0, 14)])).toEqual([[2, "Action.c(230):"], [1, "Action.c(481):"]]);
  });
});

describe("VuGen random think time", () => {
  test("ThinkTimeRandomLow / High", () => {
    expect(runlogic.thinkTime("[ThinkTime]\nOptions=RANDOM\nThinkTimeRandomLow=50\nThinkTimeRandomHigh=150\nLimit=8\nLimitFlag=1").text).toBe("Random 50–150 % of recorded (limit 8 s)");
  });
  test("range missing → no 'undefined'", () => {
    expect(runlogic.thinkTime("[ThinkTime]\nOptions=RANDOM\nLimitFlag=0").text).toBe("Random % of recorded");
  });
});

describe("human-readable times", () => {
  const m = { meta: { startUtc: T0, localOffsetSec: 3600 } };
  test("durations in words", () => {
    expect(fmt.dur(99403)).toBe("1 day 3 h 36 min 43 s");
    expect(fmt.dur(6729)).toBe("1 h 52 min 09 s");
    expect(fmt.dur(250)).toBe("4 min 10 s");
    expect(fmt.dur(45)).toBe("45 s");
    expect(fmt.dur(null)).toBe("-");
  });
  test("dates in the run's local time", () => {
    expect(fmt.when(T0, 3600)).toBe("Thu 08 Oct 2026, 08:07:39");
    expect(fmt.when(T0, 3600, true)).toBe("08 Oct 08:07");
    expect(fmt.relWhen(m, 1425)).toBe("Thu 08 Oct 2026, 08:31:24");
  });
  test("ranges drop the repeated date", () => {
    expect(fmt.relRange(m, 1425, 6754)).toBe("Thu 08 Oct 2026, 08:31:24 → 10:00:13");
    expect(fmt.relRange(m, 1425, 90000)).toBe("Thu 08 Oct 2026, 08:31:24 → Fri 09 Oct 2026, 09:07:39");
  });
});

describe("shared report content", () => {
  test("passed checks are grouped: one line per kind, with how many", () => {
    const f = (title, severity = "good") => ({ title, severity });
    expect(fmt.goodSummary([f("Pacing achieved — A"), f("Pacing achieved — B"), f("Stable throughput"), f("Load generators agree"), f("Slow", "high")])).toEqual([
      { title: "Pacing achieved", count: 2, items: ["A", "B"] },
      { title: "Stable throughput", count: 0, items: [] },
      { title: "Load generators agree", count: 0, items: [] },
    ]);
  });
  test("test facts name the Controller host and count scripts instead of listing them", () => {
    const m = {
      meta: { startUtc: T0, stopUtc: T0 + 3600, durationSec: 3600, localOffsetSec: 3600, sessionName: "S", product: "Controller", version: "2025.1" },
      workload: [{ vusers: 3 }, { vusers: 2 }], lifecycle: { vusers: 5 },
      lgs: [{ name: "lg1", vusers: 5, role: "load generator" }, { name: "ctrl.example.test", vusers: 0, role: "controller" }],
    };
    const facts = Object.fromEntries(fmt.testFacts(m));
    expect(facts).toMatchObject({ Scripts: "2 scripts · 5 VUsers", Controller: "ctrl.example.test", "LoadRunner version": "Controller 2025.1", "Load generators": "1 machine ran the VUsers" });
    expect(fmt.roleName(m.lgs[1])).toBe("Controller");
  });
  test("About this report is plain words, no self-check jargon", () => {
    const rows = fmt.aboutRows({ meta: { localOffsetSec: 0 }, window: null, settings: null, engineVersion: "1", generatedAt: "2026-10-22T00:00:00Z" });
    expect(rows.map((r) => r[0])).toContain("Differences from LoadRunner Analysis");
    expect(JSON.stringify(rows)).not.toMatch(/sub-type|0x00C00FC0|selfCheck/);
  });
});
