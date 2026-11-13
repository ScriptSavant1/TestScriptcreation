/**
 * Workload Modeller engine — the worked cases of the spec (docs/SPEC section 9) and the edge cases.
 * Expected values are worked out by hand in the comments, not taken from the engine.
 */
const E = require('../engine/workload-engine.js');

const pool = [{ id: 'p1', name: 'On-premise', cores: 8, ramGb: 32, extra: 1 }];
const run = (groups, scenario) => E.model({ scenario: Object.assign({ steadyMin: 60, workload: 'basic-scenario' }, scenario || {}), groups, pools: pool });
const near = (a, b, eps = 1e-9) => Math.abs(a - b) < eps;

describe('Workload engine — sizing', () => {
  test('worked example: 10 TPS, 4 transactions, 1 s, 15 s think → 60 Vusers at 24 s', () => {
    // iteration 4×1 + 15 = 19 s; +25% = 23.75 → 24 s; Vusers = 10 × 24 ÷ 4 = 60
    const g = run([{ name: 'Payments', method: 'tps', targetTps: 10, txPerIter: 4, rtAvg: 1, thinkPerIter: 15 }]).groups[0];
    expect([g.vusers, g.pacing.mean]).toEqual([60, 24]);
    expect(near(g.tps, 10)).toBe(true);
    expect(g.iters.steady).toBe(9000);                       // 60 × 3600 ÷ 24
  });

  test('Vusers + fixed pacing without a response time → TPS and the response-time limit', () => {
    const r = run([{ name: 'S', method: 'vusers', vusers: 50, txPerIter: 4, thinkPerIter: 15, pacing: { mode: 'fixed', fixed: 24 } }]);
    const g = r.groups[0];
    expect(near(g.tps, 50 * 4 / 24)).toBe(true);
    expect(near(g.rtBudget, 2.25)).toBe(true);                // (24 − 15) ÷ 4
    expect(r.ready).toBe(true);
    expect(g.checks.some((c) => c.code === 'rt-budget' && c.level === 'info')).toBe(true);
  });

  test('Vusers, as soon as possible, no response time → what-if table and ceiling', () => {
    const r = run([{ name: 'S', method: 'vusers', vusers: 50, txPerIter: 4, thinkPerIter: 15, pacing: { mode: 'asap' } }]);
    const g = r.groups[0];
    expect(g.status).toBe('estimate');
    expect(near(g.ceilingTps, 200 / 15)).toBe(true);
    expect(near(g.whatIf[1].tps, 200 / 17)).toBe(true);       // 0.5 s × 4 + 15 = 17 s
    expect(r.ready).toBe(false);
  });

  test('Vusers only, automatic pacing, no response time → asks for it', () => {
    const g = run([{ name: 'S', method: 'vusers', vusers: 50, txPerIter: 4, thinkPerIter: 15 }]).groups[0];
    expect([g.status, g.needs]).toEqual(['needs-input', 'rt']);
  });

  test('Vusers and TPS that cannot fit → not possible, with the Vusers needed', () => {
    // iteration 4 × 1.25 + 15 = 20 s; 100 TPS ÷ 4 = 25 iterations/s × 20 × 1.25 = 625 Vusers
    const g = run([{ name: 'S', method: 'vusers_tps', vusers: 50, targetTps: 100, txPerIter: 4, rtAvg: 1.25, thinkPerIter: 15 }]).groups[0];
    expect(g.status).toBe('infeasible');
    expect(g.checks.some((c) => c.code === 'pacing-too-short' && /625 Vusers/.test(c.text))).toBe(true);
  });

  test('three scripts with their own TPS add up exactly', () => {
    const r = run([
      { name: 'Login', method: 'tps', targetTps: 2, txPerIter: 1, rtAvg: 1, thinkPerIter: 5 },
      { name: 'Search', method: 'tps', targetTps: 6, txPerIter: 2, rtAvg: 0.5, thinkPerIter: 10 },
      { name: 'Payment', method: 'tps', targetTps: 2, txPerIter: 4, rtAvg: 1, thinkPerIter: 15 },
    ]);
    expect(near(r.totals.tps, 10)).toBe(true);
  });

  test('random pacing 20–28 s: TPS at the mean, range at the ends, low headroom', () => {
    const g = run([{ name: 'S', method: 'vusers', vusers: 50, txPerIter: 4, thinkPerIter: 15, rtAvg: 1, pacing: { mode: 'random', min: 20, max: 28 } }]).groups[0];
    expect(near(g.tps, 200 / 24) && near(g.tpsMin, 200 / 28) && near(g.tpsMax, 10)).toBe(true);
    expect(g.checks.some((c) => c.code === 'low-headroom')).toBe(true);   // 20 < 19 × 1.25
  });

  test('random think 50–150% with 24 s pacing → slow iterations overrun (warning)', () => {
    // longest think 22.5 + 4 = 26.5 s > 24 s
    const g = run([{ name: 'S', method: 'vusers', vusers: 50, txPerIter: 4, thinkPerIter: 15, rtAvg: 1, thinkMode: 'random', thinkMinPct: 50, thinkMaxPct: 150, pacing: { mode: 'fixed', fixed: 24 } }]).groups[0];
    expect(g.checks.some((c) => c.code === 'pacing-tight')).toBe(true);
  });

  test('share of the total: 60% of 10 TPS = 6; shares that do not add up to 100% are flagged', () => {
    let r = run([{ name: 'A', method: 'share', sharePct: 60, txPerIter: 2, rtAvg: 1, thinkPerIter: 8 }, { name: 'B', method: 'share', sharePct: 40, txPerIter: 1, rtAvg: 1, thinkPerIter: 4 }], { totalTps: 10 });
    expect(near(r.groups[0].target, 6)).toBe(true);
    expect(Math.abs(r.totals.tps - 10)).toBeLessThan(0.2);
    r = run([{ name: 'A', method: 'share', sharePct: 60, txPerIter: 2, rtAvg: 1, thinkPerIter: 8 }], { totalTps: 10 });
    expect(r.checks.some((c) => c.code === 'share-total')).toBe(true);
  });

  test('36,000 per hour × growth 1.5 → 15 TPS', () => {
    expect(near(run([{ name: 'V', method: 'volume', volumePerHour: 36000, txPerIter: 4, rtAvg: 1, thinkPerIter: 15 }], { growth: 1.5 }).groups[0].target, 15)).toBe(true);
  });

  test('think time longer than the pacing is flagged', () => {
    expect(run([{ name: 'S', method: 'vusers', vusers: 5, txPerIter: 1, thinkPerIter: 30, pacing: { mode: 'fixed', fixed: 20 } }]).checks.some((c) => c.code === 'think-exceeds-pacing')).toBe(true);
  });

  test('iterations target: 7,200 × 2 ÷ 3,600 s = 4 TPS; too few data rows flagged', () => {
    const r = run([{ name: 'D', method: 'iterations', iterations: 7200, txPerIter: 2, rtAvg: 1, thinkPerIter: 8, dataRows: 5000 }]);
    expect(near(r.groups[0].target, 4)).toBe(true);
    expect(r.checks.some((c) => c.code === 'data-short')).toBe(true);
  });

  test('automatic random pacing: the shortest wait covers the slowest iteration', () => {
    const g = run([{ name: 'S', method: 'tps', targetTps: 10, txPerIter: 4, rtAvg: 1, rt90: 2, thinkPerIter: 15 }], { pacingStyle: 'random', randomPct: 20 }).groups[0];
    expect(g.pacing.min).toBeGreaterThanOrEqual(g.it.worst - 1e-9);
    expect(Math.abs(g.tps - 10)).toBeLessThan(0.05);
  });

  test('TPS with a given fixed pacing: Vusers rounded up and said', () => {
    // 2 TPS ÷ 4 × 23 s = 11.5 → 12
    const g = run([{ name: 'S', method: 'tps', targetTps: 2, txPerIter: 4, pacing: { mode: 'fixed', fixed: 23 } }]).groups[0];
    expect(g.vusers).toBe(12);
    expect(g.checks.some((c) => c.code === 'rounded')).toBe(true);
  });

  test('licence limit', () => {
    expect(run([{ name: 'S', method: 'vusers', vusers: 600, txPerIter: 1, pacing: { mode: 'fixed', fixed: 10 } }], { licenceVusers: 500 }).checks.some((c) => c.code === 'licence')).toBe(true);
  });
});

describe('Workload engine — schedule', () => {
  test('ramp step plan close to the wanted length; one user starts at once', () => {
    const sp = E.stepPlan(60, 72);
    expect(sp.duration).toBeGreaterThan(0);
    expect(Math.abs(sp.duration - 72) / 72).toBeLessThanOrEqual(0.25);
    expect(E.stepPlan(1, 60).all).toBe(true);
  });

  test('basic schedule by group: every group full together; steady iterations = Vusers × 3600 ÷ pacing', () => {
    const r = E.model({ scenario: { steadyMin: 60, workload: 'basic-group' }, pools: pool, groups: [
      { name: 'Login', method: 'tps', targetTps: 2, txPerIter: 1, rtAvg: 1, thinkPerIter: 5 },
      { name: 'Payment', method: 'tps', targetTps: 2, txPerIter: 4, rtAvg: 1, thinkPerIter: 15 }] });
    expect(r.ready).toBe(true);
    expect(r.groups.map((x) => x.iters.steady)).toEqual([16 * 3600 / 8, 12 * 3600 / 24]);
  });

  test('stress in a real-world schedule peaks at 150% (90 Vusers); a basic schedule is flagged', () => {
    const g = [{ name: 'S', method: 'tps', targetTps: 10, txPerIter: 4, rtAvg: 1, thinkPerIter: 15 }];
    expect(run(g, { testType: 'stress', workload: 'real-world' }).peakVusers).toBe(90);
    expect(run(g, { testType: 'stress', workload: 'basic-scenario' }).checks.some((c) => c.code === 'needs-real-world')).toBe(true);
  });

  test('spike peaks at 200% (120 Vusers)', () => {
    expect(run([{ name: 'S', method: 'tps', targetTps: 10, txPerIter: 4, rtAvg: 1, thinkPerIter: 15 }], { testType: 'spike', workload: 'real-world' }).peakVusers).toBe(120);
  });

  test('iterations per phase add up; the timeline peaks at the Vusers', () => {
    const r = run([{ name: 'S', method: 'tps', targetTps: 10, txPerIter: 4, rtAvg: 1, thinkPerIter: 15 }]);
    const it = r.totals.iters;
    expect(it.rampUp + it.steady + it.rampDown).toBe(it.total);
    expect(Math.max(...r.timeline.map((x) => x.vusers))).toBe(60);
  });

  test('2,000 Vusers never start faster than 2 per second', () => {
    const r = E.model({ scenario: { steadyMin: 60, workload: 'basic-scenario' }, pools: [{ id: 'p1', name: 'x', capacity: { web: 500 } }], groups: [{ name: 'Big', method: 'vusers', vusers: 2000, txPerIter: 1, pacing: { mode: 'fixed', fixed: 30 } }] });
    const a = r.actions[0];
    expect(a.perStep / a.every).toBeLessThanOrEqual(2.2);
  });
});

describe('Workload engine — load generators', () => {
  test('capacity from cores and memory; missing size flagged; from a past run', () => {
    expect(E.lgCapacity({ cores: 8, ramGb: 32 }, 'web', E.PROTOCOLS).cap).toBe(Math.min(Math.floor(30 * 1024 * 0.7 / 5), Math.floor(8 * 50 * 0.7)));
    const r = E.model({ scenario: { workload: 'basic-scenario' }, pools: [{ id: 'p1', name: 'Cloud' }], groups: [{ name: 'S', method: 'vusers', vusers: 10, txPerIter: 1, pacing: { mode: 'fixed', fixed: 10 } }] });
    expect(r.checks.some((c) => c.code === 'lg-size') && r.lgTotal === null).toBe(true);
    expect(E.capacityFromRun(200, 45, 60, 70)).toBe(233);    // 200 × 70 ÷ 60
    expect(E.capacityFromRun(0, 45, 60, 70)).toBeNull();
    expect(E.capacityFromRun(200, 0, 0, 70)).toBeNull();
  });

  test('two pools with their own figures: 300 ÷ 250 → 2 + 1 extra; 30 ÷ 20 → 2', () => {
    const r = E.model({ scenario: { workload: 'basic-scenario' }, pools: [{ id: 'a', name: 'On-prem', capacity: { web: 250 }, extra: 1 }, { id: 'b', name: 'Cloud', capacity: { truclient: 20 }, extra: 0 }],
      groups: [{ name: 'W', protocol: 'web', pool: 'a', method: 'vusers', vusers: 300, txPerIter: 1, pacing: { mode: 'fixed', fixed: 10 } },
        { name: 'T', protocol: 'truclient', pool: 'b', method: 'vusers', vusers: 30, txPerIter: 1, pacing: { mode: 'fixed', fixed: 60 } }] });
    expect([r.lg[0].total, r.lg[1].total, r.lgTotal]).toEqual([3, 2, 5]);
  });
});

describe('Workload engine — empty and malformed input', () => {
  test('no scripts: not ready, says so', () => {
    const r = E.model({ scenario: {}, groups: [] });
    expect(r.ready).toBe(false);
    expect(r.checks.some((c) => c.code === 'no-scripts')).toBe(true);
  });

  test('no input object fields at all: does not throw', () => {
    expect(() => E.model({})).not.toThrow();
  });

  test('negative, zero or text numbers are treated as missing, never as values', () => {
    for (const bad of [-5, 0, 'abc', NaN, null]) {
      const g = run([{ name: 'S', method: 'tps', targetTps: bad, txPerIter: 4, rtAvg: 1 }]).groups[0];
      expect([g.status, g.needs]).toEqual(['needs-input', 'target']);
    }
    const g = run([{ name: 'S', method: 'tps', targetTps: 5, txPerIter: -3, rtAvg: 1, thinkPerIter: 'x' }]).groups[0];
    expect(g.T).toBe(1);                                       // a bad transaction count counts as 1
    expect(g.status).toBe('ok');
  });

  test('fixed pacing without its seconds asks for them', () => {
    const g = run([{ name: 'S', method: 'vusers', vusers: 5, txPerIter: 1, pacing: { mode: 'fixed' } }]).groups[0];
    expect([g.status, g.needs]).toEqual(['needs-input', 'pacing']);
  });
});
