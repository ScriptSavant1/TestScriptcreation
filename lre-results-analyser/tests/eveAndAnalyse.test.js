"use strict";

const eve = require("../engine/eve");
const stats = require("../engine/stats");
const errors = require("../engine/errors");
const { analyse, redact } = require("../engine/analyse");
const { txRecord, dataPoint, otherRecord, header, feedRandom, sampleRun, memorySource, START } = require("./helpers");

describe("stats.summarise", () => {
  test("nearest-rank percentiles and population std-dev", () => {
    const s = stats.summarise([5, 1, 4, 2, 3, 6, 7, 8, 9, 10]);
    expect(s).toMatchObject({ count: 10, min: 1, max: 10, avg: 5.5 });
    expect(s.stdDev).toBeCloseTo(Math.sqrt(8.25), 10);
    expect(s.p).toEqual({ p50: 5, p80: 8, p85: 9, p90: 9, p95: 10, p99: 10 });
  });
  test("scale and empty input", () => {
    expect(stats.summarise([1000, 3000], 0.001)).toMatchObject({ min: 1, max: 3, avg: 2 });
    expect(stats.summarise([])).toMatchObject({ count: 0, avg: null });
  });
});

describe("eve.createDecoder (layout per SPEC-RawData-eve-REVERSE-ENGINEERED)", () => {
  const recs = [header()];
  for (let i = 0; i < 40; i++) {
    recs.push(txRecord({ ts: START + 100 + i, iter: Math.floor(i / 4), rtMs: 100 + i, vuser: 1 + (i % 2), txId: 10 + (i % 2), sub: i === 3 ? 12586945 : i === 5 ? 12619721 : 12586944 }));
    recs.push(dataPoint({ ts: START + 100 + i, vuser: 1, dpId: 5 }));
    if (i % 5 === 0) recs.push(otherRecord(72, 766), otherRecord(132, 63));
  }
  const buf = Buffer.concat(recs);

  const decodeAll = (b, feed, opts) => {
    const got = [];
    const d = eve.createDecoder(Object.assign({ onTransaction: (end, it, rt, vu, id, failed, start, sub) => got.push([id, +rt.toFixed(6), end, failed, sub]) }, opts));
    feed(d, b);
    return Object.assign(d.end(), { got });
  };
  const whole = decodeAll(buf, (d, b) => d.push(new Uint8Array(b)));

  test("transactions come from the 12586944 family; response time = end − start in seconds", () => {
    expect(whole.tx.records).toBe(40);
    expect(whole.tx.bySubType).toEqual({ 12586944: 38, 12586945: 1, 12619721: 1 });
    expect(whole.tx.failed).toBe(1);
    expect(whole.got[0]).toEqual([10, 0.1, START + 100, false, 12586944]);
    expect(whole.got[5]).toEqual([11, 0.105, START + 105, true, 12619721]);
    expect(whole.got[3][4]).toBe(12586945); // variant record decoded with the same offsets
  });

  test("subType 762 is a data point, never a transaction", () => {
    expect(whole.dataPoints).toEqual([{ id: 5, count: 40, sum: 40 }]);
    expect(whole.subTypes).toEqual({ 762: 40, 766: 8, 63: 8, 12586944: 38, 12586945: 1, 12619721: 1 });
    expect(whole.transactions.map((t) => t.id)).toEqual([10, 11]);
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

  test("per-transaction tallies: vuser-iterations, failed, sub-types; +44 cross-check", () => {
    const t10 = whole.transactions.find((t) => t.id === 10);
    expect(t10.count).toBe(20);
    expect(t10.maxPerVuserIteration).toBe(2);
    const t11 = whole.transactions.find((t) => t.id === 11);
    expect(t11.failed).toBe(1);
    expect(whole.tx.vuserIds).toEqual([1, 2]);
    expect(whole.tx.iterMax).toBe(9);
    expect(whole.tx.f44Agrees).toBe(40); // the helper writes round(rt ms) at +44
  });

  test("negative durations clamped and counted; implausible records skipped and reported", () => {
    const bad = txRecord({ ts: START, iter: 0, rtMs: 10, vuser: 1, txId: 10 });
    bad.writeDoubleBE(12345, 28); // start time not a unix timestamp
    const b = Buffer.concat([header(), txRecord({ ts: START, iter: 0, rtMs: -6, vuser: 1, txId: 10 }), bad]);
    const r = decodeAll(b, (d, x) => d.push(new Uint8Array(x)));
    expect(r.tx.negativeRt).toBe(1);
    expect(r.got).toEqual([[10, 0, START, false, 12586944]]);
    expect(r.tx.implausible).toEqual({ 12586944: 1 });
  });

  test("other sub-types with two timestamps are reported as look-alikes, not counted", () => {
    const look = Buffer.alloc(72);
    look.writeUInt32BE(72, 0); look.writeUInt32BE(3, 4); look.writeUInt32BE(766, 24);
    look.writeDoubleBE(START, 28); look.writeDoubleBE(START + 1, 36);
    const r = decodeAll(Buffer.concat([header(), look]), (d, x) => d.push(new Uint8Array(x)));
    expect(r.lookalikes).toEqual({ 766: 1 });
    expect(r.tx.records).toBe(0);
  });

  test("lost sync stops with the offset; incomplete tail reported", () => {
    const bad = Buffer.concat([header(), txRecord({ ts: START, iter: 0, rtMs: 1, vuser: 1, txId: 10 }), Buffer.from([0, 0, 0, 2, 0, 0, 0, 3])]);
    const r = decodeAll(bad, (d, x) => d.push(new Uint8Array(x)));
    expect(r.stopped).toMatchObject({ offset: 100, recLen: 2 });
    const cut = decodeAll(buf.subarray(0, buf.length - 10), (d, x) => d.push(new Uint8Array(x)));
    expect(cut.trailingBytes).toBeGreaterThan(0);
  });
});

describe("errors", () => {
  test("pattern grouping and local → UTC conversion", () => {
    const rows = [
      { code: -26612, time: "2023-11-14 23:15:00", message: "HTTP 500 for request 12 id 9f8e7d6c-1111-2222-3333-444455556666", vuser: "1", injector: "lg1.example.test", script: "Script_A_1", action: "Main" },
      { code: -26612, time: "2023-11-14 23:16:00", message: "HTTP 500 for request 13 id 0a0b0c0d-1111-2222-3333-444455556666", vuser: "2", injector: "lg2.example.test", script: "Script_A_1", action: "Main" },
      { code: -17999, time: "2023-11-14 23:17:00", message: "Timeout", vuser: "1", injector: "lg1.example.test", script: "Script_A_1", action: "Main" },
    ];
    const s = errors.summarise(rows, 3600, START);
    expect(s.total).toBe(3);
    expect(s.summary[0]).toMatchObject({ code: -26612, count: 2, pattern: "HTTP <n> for request <n> id <guid>", vusers: ["1", "2"] });
    expect(s.rows[0].utc).toBe(Date.UTC(2023, 10, 14, 22, 15) / 1000);
    expect(s.rows[0].relSec).toBe(Date.UTC(2023, 10, 14, 22, 15) / 1000 - START);
  });
});

describe("analyse (end to end, synthetic run)", () => {
  let result;
  beforeAll(async () => {
    const run = Object.assign(sampleRun(), { "Res9/SqliteDb.db": Buffer.from("x") });
    result = await analyse(memorySource(run, {
      chunk: 37,
      sqliteRows: [{ code: 500, time: "2023-11-14 23:15:00", message: "HTTP 500 at lg1.example.test", vuser: "1", injector: "lg1.example.test", script: "Script_A_1" }],
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

  test("internal ids are named from sum_data (not by RawData.map id)", () => {
    expect(result.transactions.map((t) => [t.id, t.name, t.inMap])).toEqual([[10, "T01_LOGIN", true], [11, "T02_SUBMIT", true]]);
    expect(result.txNameResolution.unresolved).toEqual([]);
    expect(result.txNameResolution.method).toMatch(/per-transaction graph/);
  });

  test("transaction summary: passed timed, failed counted", () => {
    const login = result.transactions.find((t) => t.name === "T01_LOGIN");
    expect(login.full.count).toBe(6);
    expect(login).toMatchObject({ pass: 6, fail: 1, negativeRtClamped: 1 });
    expect(login.failPct).toBeCloseTo(100 / 7, 9);
    expect(login.full.min).toBeCloseTo(1.001, 6); // end − start of unix timestamps: ~0.2 µs resolution
    expect(login.full.avg).toBeCloseTo(1.1015, 6);
    expect(login.full.max).toBeCloseTo(1.202, 6);
    expect(login.steady.count).toBe(6);
    expect(login.steady.fail).toBe(1);
    expect(login.scripts).toEqual(["Script_A_1"]);
    expect(login.inSla).toBe(true);
    expect(login.maxPerVuserIteration).toBe(1);
    expect(result.transactions.find((t) => t.name === "T02_SUBMIT").recordTypes).toEqual({ 12586944: 5, 12586945: 1 });
    expect(result.dataPoints).toEqual([{ id: 2, name: "HTTP_200", count: 6, sum: 6 }]);
    expect(result.totals).toMatchObject({ samples: 12, pass: 12, fail: 1 });
  });

  test("self-checks", () => {
    const byId = (id) => result.selfCheck.filter((c) => c.id === id);
    expect(byId("timezone")[0].status).toBe("ok");
    expect(byId("eve-sync")[0].status).toBe("ok");
    expect(byId("eve-tx")[0].text).toMatch(/13 transaction records \(12 passed, 1 failed\)/);
    expect(byId("eve-tx-layout")[0].status).toBe("ok");
    expect(byId("tx-names")[0].status).toBe("ok");
    expect(byId("eve-datapoints")[0].data).toEqual({ HTTP_200: 6 });
    expect(byId("eve-vusers")[0].status).toBe("ok");
    expect(byId("negative-rt")).toHaveLength(1);
    expect(result.selfCheck.some((c) => c.status === "fail")).toBe(false);
    expect(result.errors.total).toBe(1);
  });

  test("without sum_data the internal ids stay unnamed and the self-check fails", async () => {
    const run = sampleRun();
    delete run["Res9/sum_data/sum_dat.ini"];
    delete run["Res9/sum_data/graph_4.dat"];
    const r = await analyse(memorySource(run));
    expect(r.transactions.map((t) => t.name)).toEqual(["TX_10", "TX_11"]);
    expect(r.selfCheck.find((c) => c.id === "tx-names").status).toBe("fail");
  });

  test("redact removes host names, script paths, error text and ASCII in hex examples", () => {
    const r = redact(result);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/example\.test/);
    expect(json).not.toMatch(/D:\\\\scripts/);
    expect(r.lifecycle.loadGenerators.map((l) => l.name).sort()).toEqual(["LG1", "LG2"]);
    const mon = r.eve.signatures.find((s) => /\+24=766/.test(s.signature));
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
