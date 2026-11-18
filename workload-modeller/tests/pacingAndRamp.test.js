/**
 * Whole-second pacing (when it costs at most 1% of the TPS) and the start rate shared by scripts that ramp together
 * ("Basic schedule, by group"). Expected values worked out by hand in the comments.
 */
const E = require('../engine/workload-engine.js');
const run = (groups, sc) => E.model({ scenario: Object.assign({ steadyMin: 60, workload: 'basic-group' }, sc || {}), groups });

describe('Pacing chosen by the tool — whole seconds', () => {
  test('49 transactions × 5 s, think ignored, 20 TPS → 126 Vusers every 308 s (TPS 0.23% above), not 308.7 s', () => {
    // iteration 245 s; × 1.25 = 306.25 → 307 s; λ = 20 ÷ 49; Vusers ⌈λ × 307⌉ = 126; 126 ÷ λ = 308.7 → 308 s;
    // TPS = 126 × 49 ÷ 308 = 20.045 (+0.23%); exact whole seconds would need 140 Vusers (beyond +10%)
    const g = run([{ name: 'S', method: 'tps', targetTps: 20, txPerIter: 49, rtAvg: 5, thinkPerIter: 48, thinkMode: 'ignore' }]).groups[0];
    expect([g.vusers, g.pacing.mean]).toEqual([126, 308]);
    expect(g.tps).toBeCloseTo(126 * 49 / 308, 9);
    expect(g.why.join(' ')).toMatch(/pacing 308 s \(whole seconds\) — the TPS lands 0\.23% above the target/);
  });

  test('exact whole seconds still win when up to 10% more Vusers give them: 10 TPS worked example → 60 at 24 s', () => {
    const g = run([{ name: 'P', method: 'tps', targetTps: 10, txPerIter: 4, rtAvg: 1, thinkPerIter: 15 }]).groups[0];
    expect([g.vusers, g.pacing.mean, g.tps]).toEqual([60, 24, 10]);
  });

  test('a short pacing keeps 0.1 s: 0.9 TPS, 1 transaction, 3.5 s → 5 Vusers every 5.5 s (whole seconds would be +11%)', () => {
    // iteration 3.5 s × 1.25 = 4.375 → 5 s shortest; λ = 0.9 → ⌈4.5⌉ = 5 Vusers → 5.56 s.
    // Whole seconds: 5 Vusers → 5 s = +11%; 6 → 6.67 → 6 s = +11%; 7 → 7.78 → 7 s = +11% (7 = the +10% limit): none within 1%,
    // so 0.1 s as before: 5.5 s, TPS 5 ÷ 5.5 = 0.909
    const g = run([{ name: 'S', method: 'tps', targetTps: 0.9, txPerIter: 1, rtAvg: 3.5, thinkPerIter: 0 }]).groups[0];
    expect(g.vusers).toBe(5);
    expect(g.pacing.mean).toBe(5.5);
    expect(g.tps).toBeGreaterThanOrEqual(0.9);
    expect(g.why.join(' ')).toMatch(/to 0\.1 s: a whole second would put the TPS/);
  });

  test('random style: whole-second bounds around the same average', () => {
    // 10 TPS, 4 × 1 s + 15 s, 90th 2 s, ±20%: slow iteration 23 s ÷ 0.8 = 28.75 → 29 s; exact at 75 Vusers × 30 s
    const g = run([{ name: 'S', method: 'tps', targetTps: 10, txPerIter: 4, rtAvg: 1, rt90: 2, thinkPerIter: 15 }], { pacingStyle: 'random', randomPct: 20 }).groups[0];
    expect(g.pacing.mean).toBe(30);
    expect([g.pacing.min, g.pacing.max]).toEqual([24, 36]);       // ⌈30 × 0.8⌉ = 24, 60 − 24 = 36
    expect(g.pacing.min).toBeGreaterThanOrEqual(g.it.worst);
  });

  test('never below the target, at many sizes', () => {
    for (const tps of [0.3, 1, 2.5, 7, 20, 55]) for (const T of [1, 4, 12, 49]) for (const rt of [0.2, 1, 5]) {
      const g = run([{ name: 'S', method: 'tps', targetTps: tps, txPerIter: T, rtAvg: rt, thinkPerIter: 10 }]).groups[0];
      expect(g.tps).toBeGreaterThanOrEqual(tps - 1e-9);
      expect(g.pacing.mean).toBeGreaterThanOrEqual(Math.ceil((rt * T + 10) * 1.25 - 1e-9));
    }
  });
});

describe('Basic schedule by group — the start rate is shared', () => {
  const g5 = (i) => ({ name: 'G' + i, method: 'tps', targetTps: 5, txPerIter: 4, rtAvg: 1, thinkPerIter: 10 });
  const startsPerSecond = (r) => r.groupPlans.reduce((a, p) => a + (p.actions[0].all ? 0 : p.actions[0].perStep / p.actions[0].every), 0);

  test('20 scripts of 25 Vusers ramping together start at most 2 Vusers per second in all (was 8)', () => {
    const r = run(Array.from({ length: 20 }, (_, i) => g5(i)));
    expect(r.totals.vusers).toBe(500);
    expect(startsPerSecond(r)).toBeLessThanOrEqual(2 + 1e-9);
    // each script: 2 × 25 ÷ 500 = 0.1 per second → at least 25 ÷ 0.1 = 250 s wanted; "1 every 10 s" → 24 × 10 = 240 s (within 10%)
    expect(r.groupPlans[0].actions[0]).toMatchObject({ perStep: 1, every: 10 });
  });

  test('the stop rate is shared too (twice the start rate)', () => {
    const r = run(Array.from({ length: 20 }, (_, i) => g5(i)));
    const stops = r.groupPlans.reduce((a, p) => a + (p.actions[2].all ? 0 : p.actions[2].perStep / p.actions[2].every), 0);
    expect(stops).toBeLessThanOrEqual(4 + 1e-9);
  });

  test('one script on its own: the same schedule as with the full start rate', () => {
    const r = run([g5(0)]);
    expect(startsPerSecond(r)).toBeLessThanOrEqual(2 + 1e-9);
    expect(r.groupPlans[0].actions[0].count).toBe(r.groups[0].vusers);
  });

  test('a 1-Vuser script next to a big one still starts (at least 1 Vuser every 300 s)', () => {
    const r = run([{ name: 'Big', method: 'vusers', vusers: 2000, txPerIter: 1, pacing: { mode: 'fixed', fixed: 30 } }, { name: 'Tiny', method: 'vusers', vusers: 1, txPerIter: 1, pacing: { mode: 'fixed', fixed: 30 } }]);
    expect(r.ready).toBe(true);
    expect(r.groupPlans[1].actions[0].count).toBe(1);
  });

  test("the owner's four scripts: nothing stops all at once; script (3) stops 5 every 6 s (its share: 4 × 126 ÷ 553 = 0.91 per second)", () => {
    const g = (name, v, P, protocol) => ({ name, method: 'vusers', vusers: v, txPerIter: 1, protocol, pacing: { mode: 'fixed', fixed: P } });
    const r = run([g('s25', 149, 149, 'devweb'), g('s26', 126, 308, 'web'), g('s27', 152, 266, 'devweb'), g('s3', 126, 44, 'web')]);
    expect(r.groupPlans.every((p) => !p.actions[0].all && !p.actions[2].all)).toBe(true);
    expect(r.groupPlans[3].actions[2]).toMatchObject({ perStep: 5, every: 6 });
  });

  test('fitPlan: never ends after the target, never faster than the rate, one Vuser per step whenever it fits within 10%', () => {
    expect(E.fitPlan(40, 168, 0.89)).toMatchObject({ perStep: 1, every: 4, duration: 156 });
    expect(E.fitPlan(25, 168, 0.56)).toMatchObject({ perStep: 1, every: 7, duration: 168 });     // any whole second: one Vuser per step
    expect(E.fitPlan(75, 828, 0.5)).toMatchObject({ perStep: 1, every: 11, duration: 814 });    // was 4 every 45 s with round intervals
    expect(E.fitPlan(1, 100, 1)).toMatchObject({ all: true });
    let seed = 5; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 500; i++) {
      const V = 2 + Math.floor(rnd() * 600), target = 60 + Math.floor(rnd() * 1800), rate = [0.05, 0.3, 1, 2][i % 4];
      const p = E.fitPlan(V, target, rate);
      if (p.perStep / p.every <= rate + 1e-9 && (Math.ceil(V / p.perStep) - 1) * p.every <= target) continue;
      // only when nothing fits under the target at that rate: stepPlan's choice, still never faster than the rate
      expect(p.perStep / p.every).toBeLessThanOrEqual(rate + 1e-9);
      expect((V - 1) / rate).toBeGreaterThan(target * 0.5);
    }
  });

  test("the owner's four scripts: all start immediately and ramp over about the same length (the longest), full load and stop together", () => {
    const g = (name, v, P, protocol) => ({ name, method: 'vusers', vusers: v, txPerIter: 1, protocol, pacing: { mode: 'fixed', fixed: P } });
    const r = run([g('s25', 149, 149, 'devweb'), g('s26', 126, 308, 'web'), g('s27', 152, 266, 'devweb'), g('s3', 126, 44, 'web')]);
    expect(r.groupPlans.every((p) => p.delay === 0)).toBe(true);
    // each ramp within 10% of the longest (the slowest script sets it); the quicker ones were slowed down, never sped up
    r.groupPlans.forEach((p) => expect(p.ramp).toBeGreaterThanOrEqual(r.firstFull * 0.9 - 1e-9));
    expect(new Set(r.groupPlans.map((p) => p.ramp + p.actions[1].dur)).size).toBe(1);
    expect(r.lre).not.toMatch(/after the scenario begins/);
  });

  test('300 random scenarios: no script starts or stops faster than its share, nothing at once, ramp-down ≥ Vusers ÷ stop share', () => {
    let seed = 11; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 300; i++) {
      const n = 1 + Math.floor(rnd() * 12);
      const groups = Array.from({ length: n }, (_, j) => ({ name: 'G' + j, method: 'vusers', vusers: 1 + Math.floor(rnd() * 400), txPerIter: 1, pacing: { mode: 'fixed', fixed: 5 + Math.floor(rnd() * 400) } }));
      const rate = [0.5, 1, 2, 5][i % 4];
      const r = run(groups, { maxStartRate: rate, steadyMin: [15, 60, 480][i % 3] });
      const all = r.groups.reduce((a, g) => a + g.vusers, 0);
      // every group starts immediately and stops together: ramp + duration the same; nobody ramps longer than the first full load
      expect(r.groupPlans.every((p) => p.delay === 0 && p.ramp <= r.firstFull)).toBe(true);
      expect(new Set(r.groupPlans.map((p) => p.ramp + p.actions[1].dur)).size).toBe(1);
      expect(Math.min(...r.groupPlans.map((p) => p.actions[1].dur))).toBe(r.steadyTo - r.steadyFrom);
      r.groupPlans.forEach((p) => {
        const share = Math.max(1 / 300, rate * p.group.vusers / all);
        const [up, , down] = p.actions;
        if (p.group.vusers > 1) {
          expect(up.all || down.all).toBeFalsy();
          expect(up.perStep / up.every).toBeLessThanOrEqual(share + 1e-9);
          expect(down.perStep / down.every).toBeLessThanOrEqual(2 * share + 1e-9);
        }
      });
    }
  });

  test('by test: one schedule for all at the full rate — unchanged', () => {
    const r = run(Array.from({ length: 20 }, (_, i) => g5(i)), { workload: 'basic-scenario' });
    const a = r.actions[0];
    expect(a.perStep / a.every).toBeLessThanOrEqual(2 + 1e-9);
  });
});
