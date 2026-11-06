"use strict";

const eve = require("../engine/eve");
const stats = require("../engine/stats");
const errors = require("../engine/errors");
const { analyse, applySettings, redact } = require("../engine/analyse");
const { txRecord, dataPoint, otherRecord, header, feedRandom, sampleRun, memorySource, START } = require("./helpers");

describe("stats.summarise", () => {
  test("nearest-rank percentiles and population std-dev", () => {
    const s = stats.summarise([5, 1, 4, 2, 3, 6, 7, 8, 9, 10]);
    expect(s).toMatchObject({ count: 10, min: 1, max: 10, avg: 5.5 });
    expect(s.stdDev).toBeCloseTo(Math.sqrt(8.25), 10);
    expect(s.p).toEqual({ p50: 5, p80: 8, p85: 9, p90: 9, p95: 10, p98: 10, p99: 10 });
  });
  test("scale and empty input", () => {
    expect(stats.summarise([1000, 3000], 0.001)).toMatchObject({ min: 1, max: 3, avg: 2 });
    expect(stats.summarise([])).toMatchObject({ count: 0, avg: null });
  });
});

describe("eve.createDecoder (layout per SPEC-RawData-eve-REVERSE-ENGINEERED)", () => {
  // VUser 1: internal 1 → map 10, internal 2 → map 11. VUser 2: internal 1 → map 11, internal 2 → map 10.
  const reg = { 1: { 1: 10, 2: 11 }, 2: { 1: 11, 2: 10 } };
  const recs = [header()];
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    const vuser = 1 + (i % 2), internalId = 1 + (Math.floor(i / 2) % 2);
    const key = vuser + "|" + internalId;
    const first = !seen.has(key); seen.add(key);
    recs.push(txRecord({ ts: START + 100 + i, iter: Math.floor(i / 4), rtMs: 100 + i, vuser, internalId, mapId: first ? reg[vuser][internalId] : null,
      failed: i === 5, think: i === 6 ? 2 : 0, wasted: i === 7 ? 0.5 : 0 }));
    recs.push(dataPoint({ ts: START + 100 + i, vuser: 1, internalId: 3, mapId: i === 0 ? 5 : null, value: 2 }));
    if (i % 5 === 0) recs.push(otherRecord(72, 15), otherRecord(132, 63));
  }
  const buf = Buffer.concat(recs);

  const decodeAll = (b, feed, opts) => {
    const got = [];
    const d = eve.createDecoder(Object.assign({ onTransaction: (end, it, rt, vu, id, failed, start, info) => got.push([id, +rt.toFixed(6), end, failed, info.flags]) }, opts));
    feed(d, b);
    return Object.assign(d.end(), { got });
  };
  const whole = decodeAll(buf, (d, b) => d.push(new Uint8Array(b)));

  test("ids resolve per VUser through the registration records", () => {
    expect(whole.tx.records).toBe(40);
    expect(whole.tx.unresolved).toBe(0);
    expect(whole.tx.dictionary).toBe(4);
    expect(whole.got[0]).toEqual([10, 0.1, START + 100, false, 0x01]);  // vuser 1 internal 1 (registration)
    expect(whole.got[1]).toEqual([11, 0.101, START + 101, false, 0x01]); // vuser 2 internal 1
    expect(whole.got[2]).toEqual([11, 0.102, START + 102, false, 0x01]); // vuser 1 internal 2
    expect(whole.got[4]).toEqual([10, 0.104, START + 104, false, 0]);    // vuser 1 internal 1, no name field
    expect(whole.transactions.map((t) => [t.id, t.count])).toEqual([[10, 20], [11, 20]]);
  });

  test("flags: failed (0x8000), think (0x20) and wasted (0x10) are decoded; RT excludes think and wasted", () => {
    expect(whole.tx.failed).toBe(1);
    expect(whole.got[5]).toEqual([11, 0.105, START + 105, true, 0x8000]);
    expect(whole.got[6]).toEqual([11, 0.106, START + 106, false, 0x20]);
    expect(whole.got[7]).toEqual([10, 0.107, START + 107, false, 0x10]);
    expect(whole.tx.thinkSec).toBeCloseTo(2, 9);
    expect(whole.tx.wastedSec).toBeCloseTo(0.5, 9);
    expect(whole.tx.bySubType).toEqual({ [0x00c00fc1]: 4, [0x00c00fc0]: 33, [0x00c08fc0]: 1, [0x00c00fe0]: 1, [0x00c00fd0]: 1 });
  });

  test("data points (762/766) resolve per VUser; values are summed", () => {
    expect(whole.dataPoints).toEqual([{ id: 5, count: 40, sum: 80 }]);
    expect(whole.dp).toMatchObject({ records: 40, registrations: 1, unresolved: 0 });
    expect(whole.subTypes[762]).toBe(39);
    expect(whole.subTypes[766]).toBe(1);
  });

  test("records before their registration are held back, then counted", () => {
    const b = Buffer.concat([header(),
      txRecord({ ts: START + 1, iter: 0, rtMs: 100, vuser: 3, internalId: 9 }),
      dataPoint({ ts: START + 1, vuser: 3, internalId: 4 }),
      txRecord({ ts: START + 2, iter: 0, rtMs: 200, vuser: 3, internalId: 9, mapId: 42 }),
      dataPoint({ ts: START + 2, vuser: 3, internalId: 4, mapId: 8 }),
      txRecord({ ts: START + 3, iter: 0, rtMs: 300, vuser: 4, internalId: 9 })]);
    const r = decodeAll(b, (d, x) => d.push(new Uint8Array(x)));
    expect(r.got.map((g) => g[0])).toEqual([42, 42]);
    expect(r.tx.unresolved).toBe(1); // vuser 4 never registered internal 9
    expect(r.dataPoints).toEqual([{ id: 8, count: 2, sum: 2 }]);
  });

  test("result is independent of chunk boundaries", () => {
    for (const seed of [1, 2, 3, 99]) {
      const r = decodeAll(buf, (d, b) => feedRandom(d, b, seed));
      expect(r.records).toBe(whole.records);
      expect(r.got).toEqual(whole.got);
    }
    const r1 = decodeAll(buf, (d, b) => { for (let i = 0; i < b.length; i++) d.push(new Uint8Array(b.subarray(i, i + 1))); });
    expect(r1.tx.records).toBe(40);
  });

  test("per-transaction tallies: vuser-iterations, failed", () => {
    const t10 = whole.transactions.find((t) => t.id === 10);
    expect(t10.maxPerVuserIteration).toBe(1);
    expect(t10.vuserIterations).toBe(20);
    expect(whole.transactions.find((t) => t.id === 11).failed).toBe(1);
    expect(whole.tx.vuserIds).toEqual([1, 2]);
    expect(whole.tx.iterMax).toBe(9);
  });

  test("negative durations clamped and counted; implausible records skipped and reported", () => {
    const bad = txRecord({ ts: START, iter: 0, rtMs: 10, vuser: 1, internalId: 1, mapId: 1 });
    bad.writeDoubleBE(12345, 36); // start time (after the 8-byte name field) not a unix timestamp
    const unknownFlag = txRecord({ ts: START, iter: 0, rtMs: 10, vuser: 1, internalId: 1 });
    unknownFlag.writeUInt32BE(0x00c00fc2, 24);
    const b = Buffer.concat([header(), txRecord({ ts: START, iter: 0, rtMs: -5, vuser: 1, internalId: 1, mapId: 10 }), bad, unknownFlag]);
    const r = decodeAll(b, (d, x) => d.push(new Uint8Array(x)));
    expect(r.tx.negativeRt).toBe(1);
    expect(r.got).toEqual([[10, 0, START, false, 0x01]]);
    expect(r.tx.implausible).toEqual({ [0x00c00fc1]: 1, [0x00c00fc2]: 1 });
  });

  test("other sub-types with two timestamps are reported as look-alikes, not counted", () => {
    const look = Buffer.alloc(72);
    look.writeUInt32BE(72, 0); look.writeUInt32BE(3, 4); look.writeUInt32BE(15, 24);
    look.writeDoubleBE(START, 28); look.writeDoubleBE(START + 1, 36);
    const r = decodeAll(Buffer.concat([header(), look]), (d, x) => d.push(new Uint8Array(x)));
    expect(r.lookalikes).toEqual({ 15: 1 });
    expect(r.tx.records).toBe(0);
  });

  test("lost sync stops with the offset; incomplete tail reported", () => {
    const one = txRecord({ ts: START, iter: 0, rtMs: 1, vuser: 1, internalId: 1, mapId: 1 });
    const bad = Buffer.concat([header(), one, Buffer.from([0, 0, 0, 2, 0, 0, 0, 3])]);
    const r = decodeAll(bad, (d, x) => d.push(new Uint8Array(x)));
    expect(r.stopped).toMatchObject({ offset: 24 + one.length, recLen: 2 });
    const cut = decodeAll(buf.subarray(0, buf.length - 10), (d, x) => d.push(new Uint8Array(x)));
    expect(cut.trailingBytes).toBeGreaterThan(0);
  });
});

describe("errors", () => {
  test("pattern grouping and local → UTC conversion", () => {
    const rows = [
      { code: -26612, time: "2025-11-14 23:15:00", message: "HTTP 500 for request 12 id 9f8e7d6c-1111-2222-3333-444455556666", vuser: "1", injector: "lg1.example.test", script: "Script_A_1", action: "Main" },
      { code: -26612, time: "2025-11-14 23:16:00", message: "HTTP 500 for request 13 id 0a0b0c0d-1111-2222-3333-444455556666", vuser: "2", injector: "lg2.example.test", script: "Script_A_1", action: "Main" },
      { code: -17999, time: "2025-11-14 23:17:00", message: "Timeout", vuser: "1", injector: "lg1.example.test", script: "Script_A_1", action: "Main" },
    ];
    const s = errors.summarise(rows, 3600, START);
    expect(s.total).toBe(3);
    expect(s.summary[0]).toMatchObject({ code: -26612, count: 2, pattern: "HTTP <n> for request <n> id <guid>", vusers: ["1", "2"] });
    expect(s.rows[0].utc).toBe(Date.UTC(2025, 10, 14, 22, 15) / 1000);
    expect(s.rows[0].relSec).toBe(Date.UTC(2025, 10, 14, 22, 15) / 1000 - START);
  });
});

describe("analyse (end to end, synthetic run)", () => {
  let result;
  beforeAll(async () => {
    const run = Object.assign(sampleRun(), { "Res9/SqliteDb.db": Buffer.from("x") });
    result = await analyse(memorySource(run, {
      chunk: 37,
      sqliteRows: [{ code: 500, time: "2025-11-14 23:15:00", message: "HTTP 500 at lg1.example.test", vuser: "1", injector: "lg1.example.test", script: "Script_A_1" }],
    }));
  });

  test("overview, phases and workload", () => {
    expect(result.meta.sessionName).toBe("Unit_Run");
    expect(result.files.root).toBe("Res9/");
    expect(result.phases.steady).toMatchObject({ startRelSec: 15, endRelSec: 400, durationSec: 385 });
    expect(result.workload).toHaveLength(1);
    expect(result.workload[0]).toMatchObject({
      key: "Script_A_1", protocol: "DevWeb", vusers: 2, transactions: ["T01_LOGIN", "T02_SUBMIT"],
      files: { usp: "script_a_1.usp", cfg: "script_a_1.cfg", usr: "script_a_1.usr.bak" },
    });
    expect(result.workload[0].pacing.text).toBe("Start every 100 s");
    expect(result.workload[0].thinkTime.text).toBe("As recorded (limit 3 s)");
  });

  test("per-VUser internal ids are named through the RawData.eve registration records", () => {
    expect(result.transactions.map((t) => [t.id, t.name, t.inMap])).toEqual([[1, "T01_LOGIN", true], [2, "T02_SUBMIT", true]]);
    expect(result.txNameResolution.unresolved).toEqual([]);
    expect(result.txNameResolution.method).toMatch(/registration records/);
  });

  test("transaction summary: passed timed, failed counted", () => {
    const login = result.transactions.find((t) => t.name === "T01_LOGIN");
    expect(login.full.count).toBe(6);
    expect(login).toMatchObject({ pass: 6, fail: 1, negativeRtClamped: 1 });
    expect(login.failPct).toBeCloseTo(100 / 7, 9);
    expect(login.full.min).toBeCloseTo(1.001, 6); // end - start of unix timestamps: ~0.2 µs resolution
    expect(login.full.avg).toBeCloseTo(1.1015, 6);
    expect(login.full.max).toBeCloseTo(1.202, 6);
    expect(login.steady.count).toBe(6);
    expect(login.steady.fail).toBe(1);
    expect(login.scripts).toEqual(["Script_A_1"]);
    expect(login.inSla).toBe(true);
    expect(login.maxPerVuserIteration).toBe(1);
    expect(result.transactions.find((t) => t.name === "T02_SUBMIT").recordTypes).toEqual({ [0x00c00fc1]: 2, [0x00c00fd0]: 2, [0x00c00fc0]: 2 });
    expect(login.thinkSec).toBeCloseTo(0.5, 9);
    expect(result.transactions.find((t) => t.name === "T02_SUBMIT").wastedSec).toBeCloseTo(0.5, 9);
    expect(result.dataPoints).toEqual([{ id: 2, name: "HTTP_200", count: 6, sum: 18 }]);
    expect(result.totals).toMatchObject({ samples: 12, pass: 12, fail: 1, hits: 18 });
    expect(result.web.httpCodes).toEqual([{ id: 2, name: "HTTP_200", count: 18, perSec: 18 / 411 }]);
  });

  test("granularity: exact by default; LRE-style aggregation on request, then back to exact", async () => {
    const r = await analyse(memorySource(sampleRun()));
    expect(r.aggregation).toMatchObject({ active: false, sec: null });
    const exact = r.transactions.find((t) => t.name === "T01_LOGIN").full;
    // T01_LOGIN ends at t+21/22 (1.001/1.002 s), t+121/122 (1.101/1.102 s), t+221/222 (1.201/1.202 s)
    // 200 s slots, all VUsers together: slot 0 → mean 1.0515 (×4), slot 1 → mean 1.2015 (×2)
    applySettings(r, { aggregation: { sec: 200, byVuser: false } });
    const a = r.transactions.find((t) => t.name === "T01_LOGIN").full;
    expect(a).toMatchObject({ count: 6, points: 2, granularitySec: 200, byVuser: false });
    expect(a.min).toBeCloseTo(1.0515, 6);
    expect(a.max).toBeCloseTo(1.2015, 6);
    expect(a.avg).toBeCloseTo(exact.avg, 9); // average unchanged
    expect(a.stdDev).toBeCloseTo(Math.sqrt(0.005), 6); // weighted: (4·0.05² + 2·0.1²) / 6
    expect(a.p.p50).toBeCloseTo(1.0515, 6); // running count 4 ≥ 3
    expect(a.p.p90).toBeCloseTo(1.2015, 6); // running count 6 ≥ 5.4
    expect(r.aggregation).toMatchObject({ active: true, sec: 200, byVuser: false });
    expect(r.method.summaryBasis).toMatch(/^Aggregated .*200-second slots across all VUsers/);
    // charts follow the granularity (capped at the coarsest chart option for this 7-minute run)
    expect(r.timeline.bucketSec).toBe(Math.min(200, Math.max(...r.granularity.options)));
    // per VUser (LRE "VuserID"): VUser 1 → slot 0 mean(1.001, 1.101) = 1.051 (×2), slot 1 → 1.201;
    // VUser 2 → 1.052 (×2), 1.202
    applySettings(r, { aggregation: { sec: 200, byVuser: true } });
    const v = r.transactions.find((t) => t.name === "T01_LOGIN").full;
    expect(v.points).toBe(4);
    expect(v.min).toBeCloseTo(1.051, 6);
    expect(v.max).toBeCloseTo(1.202, 6);
    expect(v.avg).toBeCloseTo(exact.avg, 9);
    applySettings(r, { aggregation: { sec: null } });
    expect(r.transactions.find((t) => t.name === "T01_LOGIN").full).toBe(r.transactions.find((t) => t.name === "T01_LOGIN").fullExact);
    expect(r.aggregation.active).toBe(false);
  });

  test("the summary basis is stated: exact over every instance, no granularity", () => {
    expect(result.method.percentileMethod).toBe("exact");
    expect(result.method.summaryBasis).toMatch(/^Exact: every transaction instance on its own, no granularity \(12 passed instances\)/);
    expect(result.aggregation.note).toMatch(/counted on its own/);
    expect(result.selfCheck.find((c) => c.id === "method").status).toBe("info");
  });

  test("histogram mode above the exact limit is flagged; Count/Min/Avg/Max stay exact", async () => {
    const r = await analyse(memorySource(sampleRun()), { exactLimit: 4 });
    expect(r.method.percentileMethod).toBe("histogram");
    expect(r.method.summaryBasis).toMatch(/^Every transaction instance, no granularity/);
    // the 200 s view is built while reading; other granularities are not available for such runs
    expect(r.aggregation.options.find((o) => o.sec === 200).available).toBe(true);
    expect(r.aggregation.options.find((o) => o.sec === 100).available).toBe(false);
    applySettings(r, { aggregation: { sec: 200, byVuser: false } });
    const h = r.transactions.find((t) => t.name === "T01_LOGIN").full;
    expect([h.count, h.points]).toEqual([6, 2]);
    expect(h.min).toBeCloseTo(1.0515, 6);
    expect(h.max).toBeCloseTo(1.2015, 6);
    applySettings(r, { aggregation: { sec: 100, byVuser: false } });
    expect(r.aggregation.partial).toBe(true); // falls back to exact values, and says so
    applySettings(r, { aggregation: { sec: null } });
    expect(r.selfCheck.find((c) => c.id === "method").status).toBe("warn");
    const a = r.transactions.find((t) => t.name === "T01_LOGIN").full, b = result.transactions.find((t) => t.name === "T01_LOGIN").full;
    expect([a.count, a.min, a.avg, a.max]).toEqual([b.count, b.min, b.avg, b.max]);
    expect(Math.abs(a.p.p90 - b.p.p90) / b.p.p90).toBeLessThan(0.005);
  });

  test("self-checks", () => {
    const byId = (id) => result.selfCheck.filter((c) => c.id === id);
    expect(byId("timezone")[0].status).toBe("ok");
    expect(byId("eve-sync")[0].status).toBe("ok");
    expect(byId("eve-tx")[0].text).toMatch(/13 transaction records \(12 passed, 1 failed\)/);
    expect(byId("eve-tx-layout")[0].status).toBe("ok");
    expect(byId("tx-names")[0].status).toBe("ok");
    expect(byId("eve-datapoints")[0].data).toEqual({ HTTP_200: 18 });
    expect(byId("eve-tx-identity")[0].status).toBe("ok");
    expect(byId("eve-vusers")[0].status).toBe("ok");
    expect(byId("negative-rt")).toHaveLength(1);
    expect(result.selfCheck.some((c) => c.status === "fail")).toBe(false);
    expect(result.errors.total).toBe(1);
  });

  test("chart granularity: auto by default, coarser on request, summary and insights unchanged", async () => {
    const r = await analyse(memorySource(sampleRun()));
    const g0 = r.granularity;
    expect(g0).toMatchObject({ auto: true, sec: g0.baseSec });
    expect(g0.options[0]).toBe(g0.baseSec);
    expect(g0.options).toContain(g0.baseSec * 10);
    const base = r.timeline;
    const summaryBefore = JSON.stringify(r.transactions.map((t) => [t.full, t.steady]));
    const findingsBefore = JSON.stringify(r.insights.findings);
    applySettings(r, { granularitySec: g0.baseSec * 10 });
    expect(r.granularity).toMatchObject({ auto: false, sec: g0.baseSec * 10 });
    expect(r.settings.granularitySec).toBe(g0.baseSec * 10);
    expect(r.timeline.bucketSec).toBe(g0.baseSec * 10);
    expect(r.timeline.buckets).toBe(Math.ceil(base.buckets / 10));
    for (const id of Object.keys(base.tx)) {
      const a = base.tx[id], b = r.timeline.tx[id];
      expect(b.count.reduce((x, y) => x + y, 0)).toBe(a.count.reduce((x, y) => x + y, 0));
      expect(b.fail.reduce((x, y) => x + y, 0)).toBe(a.fail.reduce((x, y) => x + y, 0));
      const maxA = Math.max(...a.max.filter((v) => v != null)), maxB = Math.max(...b.max.filter((v) => v != null));
      expect(maxB).toBeCloseTo(maxA, 9); // merged slots keep the true per-slot extremes
      for (let k = 0; k < b.count.length; k++) {
        const slice = a.count.slice(k * 10, k * 10 + 10), avgs = a.avg.slice(k * 10, k * 10 + 10);
        const n = slice.reduce((x, y) => x + y, 0);
        if (n) expect(b.avg[k]).toBeCloseTo(slice.reduce((s, c, i) => s + (c ? c * avgs[i] : 0), 0) / n, 9);
      }
    }
    expect(r.timeline.totalTps.reduce((x, y) => x + y, 0) * r.timeline.bucketSec).toBeCloseTo(12, 9);
    expect(JSON.stringify(r.transactions.map((t) => [t.full, t.steady]))).toBe(summaryBefore);
    expect(JSON.stringify(r.insights.findings)).toBe(findingsBefore);
    expect(r.method.chartGranularity).toMatch(/user-selected/);
    // not offered (finer than auto / unknown) → nearest allowed; "auto" resets
    applySettings(r, { granularitySec: 7 });
    expect(r.granularity.options).toContain(r.granularity.sec);
    applySettings(r, { granularitySec: "auto" });
    expect(r.timeline).toBe(base);
    expect(r.settings.granularitySec).toBe(null);
  });

  test("sum_data is not needed: same names and figures without it", async () => {
    const run = sampleRun();
    delete run["Res9/sum_data/sum_dat.ini"];
    delete run["Res9/sum_data/graph_4.dat"];
    const r = await analyse(memorySource(run));
    expect(r.transactions.map((t) => t.name)).toEqual(["T01_LOGIN", "T02_SUBMIT"]);
    expect(r.transactions.map((t) => [t.pass, t.fail, t.full.avg])).toEqual(result.transactions.map((t) => [t.pass, t.fail, t.full.avg]));
    expect(r.selfCheck.find((c) => c.id === "tx-names").status).toBe("ok");
  });

  test("redact removes host names, script paths, error text and ASCII in hex examples", () => {
    const r = redact(result);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/example\.test/);
    expect(json).not.toMatch(/D:\\\\scripts/);
    expect(r.lifecycle.loadGenerators.map((l) => l.name).sort()).toEqual(["LG1", "LG2"]);
    const mon = r.eve.signatures.find((s) => /\+24=63$/.test(s.signature));
    expect(mon.examples[0]).not.toMatch(/41414141/);
    expect(r.transactions.map((t) => [t.name, t.full, t.steady])).toEqual(result.transactions.map((t) => JSON.parse(JSON.stringify([t.name, t.full, t.steady]))));
    expect(r.transactions[0].perLg.map((l) => l.lg).sort()).toEqual(["LG1", "LG2"]);
  });

  test("missing RawData.eve is a failure, not a crash", async () => {
    const run = sampleRun();
    delete run["Res9/RawData.eve"];
    const r = await analyse(memorySource(run));
    expect(r.selfCheck.find((c) => c.status === "fail").text).toMatch(/RawData\.eve/);
    expect(r.transactions).toEqual([]);
  });
});
