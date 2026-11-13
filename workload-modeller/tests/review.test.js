/**
 * The second-opinion review fixes: load generators with CPU and memory added up apart, test length with a slow last
 * iteration, the growth factor note, and the explanations in "How it is worked out". Hand-worked numbers in the comments.
 */
const E = require('../engine/workload-engine.js');

const pool = [{ id: 'p1', name: 'On-premise', cores: 8, ramGb: 32, extra: 1 }];
const sc = (x) => Object.assign({ steadyMin: 60, workload: 'basic-scenario' }, x || {});
const fx = (v, P, extra) => Object.assign({ method: 'vusers', vusers: v, txPerIter: 1, pacing: { mode: 'fixed', fixed: P }, pool: 'p1' }, extra);

describe('Load generators — CPU and memory added up apart', () => {
  // 8 cores, 32 GB, 2 GB kept, 70%: memory 30 × 1024 × 0.7 = 21,504 MB.
  // web 50/core, 5 MB → CPU 280, memory 4,300. "other protocol" set to 20/core, 350 MB → CPU 112, memory 61.
  // (TruClient would not do: browser scripts get machines of their own — see assignment.test.js.)
  const protos = { other: { label: 'Other protocol', memMb: 350, perCore: 20 } };
  const mixed = (a, b) => E.model({ scenario: sc(), pools: pool, protocols: protos, groups: [fx(a, 10, { name: 'W', protocol: 'web' }), fx(b, 60, { name: 'T', protocol: 'other' })] });

  test('150 web + 40 memory-heavy share one machine: CPU 0.893, memory 0.691 → 1 + 1 extra', () => {
    const r = mixed(150, 40);
    expect(r.lg[0].needed).toBe(1);
    expect(r.lgTotal).toBe(2);
  });

  test('280 web + 61 memory-heavy: CPU 1 + 0.545 = 1.545 → 2 machines', () => {
    expect(mixed(280, 61).lg[0].needed).toBe(2);
  });

  test('one protocol alone: machines = ⌈Vusers ÷ capacity⌉ + 1 extra (never more machines than Vusers), at every size', () => {
    for (const cores of [2, 4, 8, 16]) for (const ram of [8, 16, 32, 64]) for (const v of [1, 37, 280, 999, 5000]) for (const proto of ['web', 'devweb', 'truclient', 'other']) {
      const p = { id: 'p1', name: 'P', cores, ramGb: ram, extra: 1 };
      const r = E.model({ scenario: sc(), pools: [p], groups: [fx(v, 20, { name: 'S', protocol: proto })] });
      expect(r.lgTotal).toBe(Math.min(v, Math.ceil(v / E.lgCapacity(p, proto, E.PROTOCOLS).cap - 1e-9) + 1));
    }
  });
});

describe('Test length — the last iterations finish', () => {
  test('slow iteration 3 × 4 s = 12 s, longer than the 10 s pacing: 12 s after the schedule', () => {
    const r = E.model({ scenario: sc(), pools: pool, groups: [{ name: 'S', method: 'vusers', vusers: 20, txPerIter: 3, rtAvg: 1, rt90: 4, pacing: { mode: 'fixed', fixed: 10 }, pool: 'p1' }] });
    expect(r.tail).toBe(12);
    expect(r.duration).toBe(r.marks[r.marks.length - 1].to + 12);
  });

  test('iteration 3 s, shorter than the 10 s pacing: one pacing after the schedule', () => {
    const r = E.model({ scenario: sc(), pools: pool, groups: [{ name: 'S', method: 'vusers', vusers: 20, txPerIter: 3, rtAvg: 1, pacing: { mode: 'fixed', fixed: 10 }, pool: 'p1' }] });
    expect(r.tail).toBe(10);
  });
});

describe('Growth factor — TPS targets only', () => {
  test('1.5: 2 TPS → 30 Vusers; 7 Vusers stay 7; 3,600 iterations stay 10 Vusers; Checks says so', () => {
    const r = E.model({ scenario: sc({ growth: 1.5 }), pools: pool, groups: [
      { name: 'A', method: 'tps', targetTps: 2, txPerIter: 1, rtAvg: 1, pacing: { mode: 'fixed', fixed: 10 } },
      { name: 'B', method: 'vusers', vusers: 7, txPerIter: 1, pacing: { mode: 'fixed', fixed: 10 } },
      { name: 'C', method: 'iterations', iterations: 3600, txPerIter: 1, rtAvg: 1, pacing: { mode: 'fixed', fixed: 10 } }] });
    expect(r.groups.map((g) => g.vusers)).toEqual([30, 7, 10]);
    expect(r.checks.find((c) => c.code === 'growth-kept').text).toMatch(/2 scripts keep their Vusers or iterations/);
  });

  test('growth 1 or missing: no note', () => {
    for (const growth of [1, undefined, null, 'x']) {
      expect(E.model({ scenario: sc({ growth }), pools: pool, groups: [fx(7, 10, { name: 'B' })] }).checks.some((c) => c.code === 'growth-kept')).toBe(false);
    }
  });
});

describe('How it is worked out', () => {
  test('automatic pacing: 1.5 TPS needs 5 Vusers at 3.33 s; 6 give a whole 4 s — said', () => {
    const g = E.model({ scenario: sc(), pools: pool, groups: [{ name: 'A', method: 'tps', targetTps: 1.5, txPerIter: 1, rtAvg: 2 }] }).groups[0];
    expect([g.vusers, g.pacing.mean]).toEqual([6, 4]);
    expect(g.why.some((w) => /1 more than the 5/.test(w))).toBe(true);
  });

  test('the worked example needs no extra Vusers and says nothing about it', () => {
    const g = E.model({ scenario: sc(), pools: pool, groups: [{ name: 'P', method: 'tps', targetTps: 10, txPerIter: 4, rtAvg: 1, thinkPerIter: 15 }] }).groups[0];
    expect(g.why.some((w) => /more than the/.test(w))).toBe(false);
  });

  test('as soon as possible: iteration 2 × 1 + 3 = 5 s → 2 × 5 ÷ 2 = 5 Vusers', () => {
    const g = E.model({ scenario: sc(), pools: pool, groups: [{ name: 'A', method: 'tps', targetTps: 2, txPerIter: 2, rtAvg: 1, thinkPerIter: 3, pacing: { mode: 'asap' } }] }).groups[0];
    expect(g.vusers).toBe(5);
    expect(g.why.join(' ')).toMatch(/as soon as the previous one ends[^]*rounded up = 5/);
  });

  test('after the previous iteration + 2 s: 7 s → 7 Vusers', () => {
    const g = E.model({ scenario: sc(), pools: pool, groups: [{ name: 'A', method: 'tps', targetTps: 2, txPerIter: 2, rtAvg: 1, thinkPerIter: 3, pacing: { mode: 'after', delay: 2 } }] }).groups[0];
    expect(g.vusers).toBe(7);
    expect(g.why.join(' ')).toMatch(/starts 2 s after the previous one ends/);
  });
});
