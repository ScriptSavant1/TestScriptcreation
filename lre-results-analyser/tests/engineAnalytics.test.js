"use strict";

const hist = require("../engine/hist");
const collector = require("../engine/collector");
const dat = require("../engine/dat");
const insights = require("../engine/insights");
const { analyse, applySettings } = require("../engine/analyse");
const { sampleRun, memorySource, START } = require("./helpers");

// deterministic PRNG
function rng(seed) { let s = seed; return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; }; }

describe("hist", () => {
  test("quantiles within 0.5 % of exact; merge = union", () => {
    const r = rng(3), a = hist.create(), b = hist.create(), all = [];
    for (let i = 0; i < 20000; i++) { const v = Math.exp(r() * 9); all.push(v); (i % 2 ? a : b).add(v); }
    all.sort((x, y) => x - y);
    a.merge(b);
    expect(a.count).toBe(20000);
    for (const p of [50, 90, 95, 99]) {
      const exact = all[Math.ceil((p / 100) * all.length) - 1];
      expect(Math.abs(a.quantile(p) / exact - 1)).toBeLessThan(0.006);
    }
    expect(a.min).toBe(all[0]);
    expect(a.max).toBe(all[all.length - 1]);
    expect(a.quantiles([50, 99])).toEqual([a.quantile(50), a.quantile(99)]);
  });
  test("precision mismatch refuses to merge", () => {
    const b = hist.create(0.02);
    b.add(5);
    expect(() => hist.create(0.01).merge(b)).toThrow(/precision/);
  });
});

describe("collector", () => {
  function fill(c) {
    const r = rng(11);
    for (let i = 0; i < 6000; i++) {
      const rel = i * 0.5; // 0 … 3000 s
      c.add(START + rel, Math.floor(i / 20), 200 + r() * 800 + (rel > 2000 ? 500 : 0), 1 + (i % 3), 1 + (i % 2));
    }
  }
  const vuserInfo = new Map([[1, { lg: "lgA" }], [2, { lg: "lgB" }], [3, { lg: "lgA" }]]);
  const mk = (exactLimit) => { const c = collector.createCollector({ startUtc: START, durationSec: 3000, vuserInfo, steady: { start: 500, end: 2500 }, exactLimit }); fill(c); return c.finish(); };
  const exact = mk(undefined), approx = mk(0);

  test("bucket size chosen from duration", () => {
    expect(collector.chooseBucketSec(3000)).toBe(2);
    expect(collector.chooseBucketSec(28800)).toBe(30);
    expect(exact.bucketSec).toBe(2);
  });
  test("exact and histogram modes agree (counts exact, percentiles ≤ 1 %)", () => {
    expect(exact.method).toBe("exact");
    expect(approx.method).toBe("histogram");
    const e = exact.summary(1, null), a = approx.summary(1, null);
    expect(a.count).toBe(e.count);
    expect(a.avg).toBeCloseTo(e.avg, 9);
    expect(a.stdDev).toBeCloseTo(e.stdDev, 9);
    for (const k of ["p50", "p90", "p99"]) expect(Math.abs(a.p[k] / e.p[k] - 1)).toBeLessThan(0.01);
  });
  test("window summaries", () => {
    const w = { start: 0, end: 999.9 };
    const e = exact.summary(2, w), a = approx.summary(2, w);
    expect(e.count).toBe(1000); // ids alternate: 2000 samples in the first 1000 s
    expect(a.count).toBe(1000);
    expect(exact.countIn(w)).toBe(2000);
    expect(exact.summary(1, { start: 2100, end: 3000 }).avg).toBeGreaterThan(exact.summary(1, { start: 0, end: 1900 }).avg + 0.4);
  });
  test("timeline, per-LG, VUser figures, heatmaps, distribution, apdex", () => {
    const tl = exact.timeline();
    expect(tl.tx[1].count.reduce((x, y) => x + y, 0)).toBe(3000);
    expect(tl.tx[1].p90.filter((v) => v != null).length).toBeGreaterThan(100);
    const lg = exact.perLg(1);
    expect(lg.map((l) => l.lg)).toEqual(["lgA", "lgB"]);
    expect(lg[0].full.count + lg[1].full.count).toBe(3000);
    expect(lg[0].steady.count + lg[1].steady.count).toBe(exact.summary(1, { start: 500, end: 2500 }).count);
    const vu = exact.vuserList();
    expect(vu.map((v) => v.vuser)).toEqual([1, 2, 3]);
    expect(vu[0].iterations).toBe(300);
    const heat = exact.vuserHeat(100);
    expect(heat.values).toHaveLength(3);
    expect(heat.cols).toBeLessThanOrEqual(100);
    const lh = exact.latencyHeat([1, 2], 50, 20);
    expect(lh.cells.reduce((x, c) => x + c[2], 0)).toBe(6000);
    const d = exact.distribution(1, 30);
    expect(d.reduce((x, c) => x + c[2], 0)).toBe(3000);
    expect(d.length).toBeLessThanOrEqual(31);
    const ap = exact.apdexCounts(1, 500, null), aph = approx.apdexCounts(1, 500, null);
    expect(ap.n).toBe(3000);
    expect(Math.abs(aph.satisfied - ap.satisfied) / ap.n).toBeLessThan(0.02);
  });
  test("buckets grow when samples run past the expected duration", () => {
    const c = collector.createCollector({ startUtc: START, durationSec: 10, bucketSec: 1 });
    c.add(START + 5, 0, 100, 1, 1);
    c.add(START + 500, 0, 300, 1, 1);
    const s = c.finish();
    expect(s.buckets).toBe(501);
    expect(s.timeline().tx[1].count[500]).toBe(1);
  });
});

describe("dat", () => {
  test("tolerant sum_dat.ini measurement keys", () => {
    const i = dat.parseIni("[General]\nScenarioStartTime=100\n[graph_2]\nGraphType=es_tr_tprange_pass\nMeasurement_0=11,T01_LOGIN\nMeasurement_1=12 T02_SUBMIT\n" +
      "[graph_1]\nGraphType=es_tr_lg_monitoring\nMeasurementId_0=2\nMeasurementName_0=lg1 [10.0.0.1] - CPU Usage (%)\n[graph_9]\nGraphType=Something_New\n");
    expect(i.scenarioStart).toBe(100);
    const g2 = i.graphs.find((g) => g.n === 2);
    expect(g2.role).toBe("txPass");
    expect(g2.measurements).toEqual([{ id: 11, name: "T01_LOGIN" }, { id: 12, name: "T02_SUBMIT" }]);
    expect(i.graphs.find((g) => g.n === 1).measurements).toEqual([{ id: 2, name: "lg1 [10.0.0.1] - CPU Usage (%)" }]);
    expect(i.graphs.find((g) => g.n === 9).role).toBeNull();
    expect(dat.splitLgName("lg1 [10.0.0.1] - CPU Usage (%)")).toEqual({ host: "lg1", ip: "10.0.0.1", metric: "CPU Usage (%)" });
  });
  test("graph resampling onto buckets", () => {
    const m = dat.parseGraph("2 100 40 1 40 40 0\n2 103 60 1 60 60 0\n2 111 10 1 10 10 0\nbad line\n48 105 3 -1 3 3 0\n", 100, 10, 3);
    const cpu = m.get(2);
    expect(cpu.avg).toEqual([50, 10, null]);
    expect(cpu.maxSeries).toEqual([60, 10, null]);
    expect(cpu.max).toBe(60);
    expect(cpu.step).toBe(3);
    expect(m.get(48)).toMatchObject({ cumulativeRows: 1, sumAvgCount: 3 });
  });
});

describe("insights statistics", () => {
  test("Mann-Kendall + Sen slope", () => {
    const up = Array.from({ length: 60 }, (_, i) => 1 + i * 0.01 + (i % 3) * 0.002);
    const mk = insights.mannKendall(up);
    expect(mk.p).toBeLessThan(0.001);
    expect(mk.z).toBeGreaterThan(0);
    expect(insights.senSlope(up)).toBeCloseTo(0.01, 2);
    const r = rng(5);
    const flat = Array.from({ length: 60 }, () => 1 + r() * 0.1);
    expect(insights.mannKendall(flat).p).toBeGreaterThan(0.01);
    expect(insights.mannKendall([1, 2, 3])).toBeNull();
  });
  test("change points find a level shift", () => {
    const r = rng(9);
    const x = Array.from({ length: 80 }, (_, i) => (i < 50 ? 1 : 2) + r() * 0.1);
    const cps = insights.changePoints(x);
    expect(cps).toHaveLength(1);
    expect(cps[0].index).toBe(50);
    expect(cps[0].after / cps[0].before).toBeGreaterThan(1.8);
    expect(insights.changePoints(Array.from({ length: 80 }, () => 1 + r() * 0.1))).toEqual([]);
  });
  test("robust z flags outliers only", () => {
    const x = [1, 1.1, 0.9, 1, 1.05, 0.95, 10, 1];
    const z = insights.robustZ(x);
    expect(z[6]).toBeGreaterThan(3.5);
    expect(z.filter((v) => v > 3.5)).toHaveLength(1);
  });
});

/** sampleRun + sum_data (pass/fail graphs, LG CPU) */
function runWithSumData() {
  const run = sampleRun();
  run["Res9/sum_data/sum_dat.ini"] = [
    "[General]", `ScenarioStartTime=${START}`,
    "[graph_1]", "GraphType=es_tr_lg_monitoring", "Measurement_0=2,lg1 [10.1.2.3] - CPU Usage (%)", "Measurement_1=3,lg1 [10.1.2.3] - Memory Usage (%)",
    "[graph_2]", "GraphType=es_tr_tprange_pass", "Measurement_0=11,T01_LOGIN", "Measurement_1=12,T02_SUBMIT",
    "[graph_14]", "GraphType=es_tr_tprange_fail", "Measurement_0=13,T01_LOGIN",
  ].join("\r\n");
  run["Res9/sum_data/graph_1.dat"] = `2 ${START + 30} 90 1 90 92 0\n2 ${START + 60} 50 1 50 50 0\n3 ${START + 30} 40 1 40 40 0\n`;
  run["Res9/sum_data/graph_2.dat"] = `11 ${START + 50} 1 3 1 1 0\n11 ${START + 150} 1 3 1 1 0\n12 ${START + 50} 2 3 2 2 0\n`;
  run["Res9/sum_data/graph_14.dat"] = `13 ${START + 90} 1 -1 1 1 0\n`;
  return run;
}

describe("analyse — Phase 1–4 model", () => {
  let m;
  beforeAll(async () => { m = await analyse(memorySource(runWithSumData(), { chunk: 64 })); });

  test("timeline, VUsers, LG health and LGs", () => {
    expect(m.timeline.bucketSec).toBe(1);
    expect(m.timeline.vusers[12]).toBe(1);
    expect(m.timeline.vusers[100]).toBe(2);
    expect(m.timeline.totalTps.reduce((a, b) => a + b, 0)).toBe(13);
    expect(m.vusers.map((v) => [v.vuser, v.lg, v.iterations])).toEqual([[1, "lg1.example.test", 3], [2, "lg2.example.test", 3]]);
    expect(m.lgHealth[0]).toMatchObject({ host: "lg1", ip: "10.1.2.3", cpu: { max: 92 } });
    expect(m.lgs.find((l) => l.name === "lg1.example.test")).toMatchObject({ ip: "10.1.2.3", vusers: 1, cpuPeak: 92 });
    expect(m.workload[0]).toMatchObject({ iterationsAchieved: 6 });
  });

  test("pass/fail calibrated from sum_data", () => {
    const login = m.transactions.find((t) => t.name === "T01_LOGIN");
    expect(login).toMatchObject({ pass: 6, fail: 1 });
    expect(login.failPct).toBeCloseTo(100 / 7, 6);
    expect(m.method.passFail).toMatch(/Σ avg×count/);
    expect(m.transactions.find((t) => t.name === "T02_SUBMIT")).toMatchObject({ pass: 6, fail: 0 });
  });

  test("applySettings: custom window and SLA recompute in place", () => {
    expect(m.window).toMatchObject({ start: 15, end: 400, detected: true });
    const before = m.transactions.find((t) => t.name === "T01_LOGIN").steady.count;
    applySettings(m, { window: { start: 100, end: 400 }, sla: { percentile: 90, defaultSec: 1.15, perTx: { T02_SUBMIT: 1 } } });
    const login = m.transactions.find((t) => t.name === "T01_LOGIN");
    expect(before).toBe(6);
    expect(login.steady.count).toBe(4);
    expect(m.window).toMatchObject({ start: 100, end: 400, detected: false });
    expect(login.sla).toMatchObject({ threshold: 1.15, pass: false });
    expect(login.sla.apdex).toBeCloseTo(0.75, 6); // 2 satisfied (≤1.15 s) + 2 tolerating of 4
    expect(m.transactions.find((t) => t.name === "T02_SUBMIT").sla.pass).toBe(false);
    expect(m.insights.verdict.status).toBe("fail");
    expect(m.insights.findings.some((f) => f.category === "sla" && f.severity === "high")).toBe(true);
    applySettings(m, { window: null, sla: { defaultSec: null, perTx: {} } });
    expect(m.window.detected).toBe(true);
    expect(m.transactions.every((t) => t.sla === null)).toBe(true);
  });

  test("insights: LG CPU, pacing and verdict", () => {
    const f = m.insights.findings;
    expect(f.find((x) => x.title === "High CPU on lg1")).toBeTruthy();
    expect(f.find((x) => /Pacing/.test(x.title))).toBeTruthy();
    expect(["pass", "warn", "fail"]).toContain(m.insights.verdict.status);
  });

  test("model is JSON-serialisable and the store is not", () => {
    const j = JSON.parse(JSON.stringify(m));
    expect(j.store).toBeUndefined();
    expect(typeof m.store.summary).toBe("function");
  });
});

describe("insights.run on a degrading soak", () => {
  test("trend, change point and spike findings", () => {
    const n = 400, bs = 60;
    const r = rng(21);
    const p90 = Array.from({ length: n }, (_, i) => 1 + (i > 250 ? 0.6 : 0) + i * 0.0005 + r() * 0.05);
    p90[100] = 6; // spike
    const count = Array(n).fill(10);
    const model = {
      meta: { startUtc: START, localOffsetSec: 0, schedule: { steps: [] } },
      phases: { steady: { startRelSec: 0, endRelSec: n * bs, durationSec: n * bs } },
      transactions: [{ id: 1, name: "T_SLOW", full: { count: 4000 }, steady: { count: 4000 }, perLg: [] }],
      timeline: { bucketSec: bs, tx: { 1: { p90, count } }, errors: Array(n).fill(0).map((_, i) => (i === 100 ? 4 : 0)), totalTps: Array(n).fill(10 / bs) },
      workload: [], vusers: [], errors: null, lgHealth: [],
    };
    const res = insights.run(model);
    const titles = res.findings.map((x) => x.title);
    expect(titles).toContain("T_SLOW slows down over time");
    expect(titles.some((t) => /changed level/.test(t))).toBe(true);
    const spike = res.findings.find((x) => x.category === "spike");
    expect(spike.evidence.errors).toBe(4);
    expect(spike.text).toMatch(/likely related/);
    expect(res.verdict.status).toBe("warn");
  });
});
