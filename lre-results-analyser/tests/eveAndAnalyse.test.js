"use strict";

const eve = require("../engine/eve");
const stats = require("../engine/stats");
const errors = require("../engine/errors");
const { analyse, redact } = require("../engine/analyse");
const { txRecord, otherRecord, header, feedRandom, sampleRun, memorySource, START } = require("./helpers");

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

describe("eve.createDecoder", () => {
  const recs = [header()];
  for (let i = 0; i < 40; i++) {
    recs.push(txRecord({ ts: START + i, iter: Math.floor(i / 4), rtMs: 100 + i, vuser: 1 + (i % 2), txId: 1 + (i % 2), f60: i === 3 ? 1 : 0 }));
    if (i % 5 === 0) recs.push(otherRecord(72, 766), otherRecord(84, 0xc00101));
  }
  const buf = Buffer.concat(recs);

  // collects (id, rt) via onSample so tests can compare what the statistics layer receives
  const decodeAll = (b, feed, opts) => {
    const got = [];
    const d = eve.createDecoder(Object.assign({ onSample: (ts, it, rt, vu, id) => got.push([id, rt, ts]) }, opts));
    feed(d, b);
    return Object.assign(d.end(), { got });
  };
  const whole = decodeAll(buf, (d, b) => d.push(new Uint8Array(b)));

  test("decodes every record; result is independent of chunk boundaries", () => {
    expect(whole.records).toBe(1 + 40 + 16);
    expect(whole.tx.records).toBe(40);
    expect(whole.trailingBytes).toBe(0);
    expect(whole.stopped).toBeNull();
    for (const seed of [1, 2, 3, 99]) {
      const r = decodeAll(buf, (d, b) => feedRandom(d, b, seed));
      expect(r.records).toBe(whole.records);
      expect(r.transactions.map((t) => [t.id, t.count])).toEqual(whole.transactions.map((t) => [t.id, t.count]));
      expect(r.got).toEqual(whole.got);
    }
    // single-byte chunks
    const r1 = decodeAll(buf, (d, b) => { for (let i = 0; i < b.length; i++) d.push(new Uint8Array(b.subarray(i, i + 1))); });
    expect(r1.tx.records).toBe(40);
  });

  test("signature tally, sub-types and field tallies", () => {
    expect(whole.subTypes).toEqual({ 762: 40, 766: 8, [0xc00101]: 8 });
    expect(whole.signatures[0]).toMatchObject({ signature: "len=64 type=3 +8=1 +16=1 +24=762", count: 40 });
    expect(whole.signatures.find((s) => s.signature === "len=24 type=7")).toBeTruthy();
    expect(whole.signatures[0].examples).toHaveLength(3);
    expect(whole.tx.f40).toEqual({ 0: 40 });
    expect(whole.tx.f60).toEqual({ 0: 39, 1: 1 });
    expect(whole.tx.recLenVariants).toEqual({ 64: 40 });
  });

  test("samples per (vuser, iteration)", () => {
    const r = decodeAll(buf, (d, b) => d.push(new Uint8Array(b)));
    const t1 = r.transactions.find((t) => t.id === 1);
    expect(t1.count).toBe(20);
    expect(t1.maxPerVuserIteration).toBe(2); // vuser 1 runs tx 1 at i and i+2 within one 4-sample iteration
    expect(r.got).toHaveLength(40);
    expect(r.tx.vuserIds).toEqual([1, 2]);
    expect(r.tx.iterMax).toBe(9);
  });

  test("negative RT clamped and counted; unknown IDs reported", () => {
    const b = Buffer.concat([header(), txRecord({ ts: START, iter: 0, rtMs: -6, vuser: 1, txId: 21 }), txRecord({ ts: START, iter: 0, rtMs: 10, vuser: 1, txId: 1 })]);
    const r = decodeAll(b, (d, x) => d.push(new Uint8Array(x)), { knownTxIds: new Set([1]) });
    expect(r.tx.negativeRt).toBe(1);
    expect(r.got.find((g) => g[0] === 21)[1]).toBe(0);
    expect(r.tx.unknownTxIds).toEqual({ 21: 1 });
  });

  test("lost sync stops with the offset; incomplete tail reported", () => {
    const bad = Buffer.concat([header(), txRecord({ ts: START, iter: 0, rtMs: 1, vuser: 1, txId: 1 }), Buffer.from([0, 0, 0, 2, 0, 0, 0, 3])]);
    const r = decodeAll(bad, (d, x) => d.push(new Uint8Array(x)));
    expect(r.stopped).toMatchObject({ offset: 88, recLen: 2 });
    const cut = decodeAll(buf.subarray(0, buf.length - 10), (d, x) => d.push(new Uint8Array(x)));
    expect(cut.trailingBytes).toBe(buf.subarray(0, buf.length - 10).length - (cut.bytesRead - cut.trailingBytes));
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

  test("transaction summary (seconds) full and steady", () => {
    const login = result.transactions.find((t) => t.name === "T01_LOGIN");
    expect(login.full.count).toBe(6);
    expect(login.full.min).toBeCloseTo(1.001, 9);
    expect(login.full.max).toBeCloseTo(1.202, 9);
    expect(login.steady.count).toBe(6); // all samples between t+21 and t+307
    expect(login.scripts).toEqual(["Script_A_1"]);
    expect(login.inSla).toBe(true);
    expect(login.maxPerVuserIteration).toBe(1);
    const unknown = result.transactions.find((t) => t.id === 21);
    expect(unknown).toMatchObject({ name: "TX_21", inMap: false, negativeRtClamped: 1 });
  });

  test("self-checks flag what Phase 0 must confirm", () => {
    const byId = (id) => result.selfCheck.filter((c) => c.id === id);
    expect(byId("timezone")[0].status).toBe("ok");
    expect(byId("eve-sync")[0].status).toBe("ok");
    expect(byId("eve-f40")[0].status).toBe("ok");
    expect(byId("eve-tx-ids").map((c) => c.text)).toEqual(expect.arrayContaining([expect.stringMatching(/not in RawData.map/), expect.stringMatching(/SLAConfiguration/)]));
    expect(byId("eve-vusers")[0].status).toBe("ok");
    expect(byId("negative-rt")).toHaveLength(1);
    expect(result.selfCheck.some((c) => c.status === "fail")).toBe(false);
    expect(result.errors.total).toBe(1);
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
