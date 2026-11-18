/* Load generators by the team's rule of thumb (Vusers per machine for web pages / API calls), blended by the script's
   share of page requests; extra machines carry Vusers (no idle spare); a script's own figure wins. */
const E = require('../engine/workload-engine.js');

const onprem = (extra) => ({ id: 'p1', name: 'On-premise', cores: 8, ramGb: 32, webPerLg: 100, apiPerLg: 250, extra: extra || 0 });
const script = (name, vusers, more) => Object.assign({ name, method: 'vusers', vusers, txPerIter: 1, protocol: 'web', pacing: { mode: 'fixed', fixed: 60 }, requestsPerIter: 10 }, more);
const run = (pool, groups) => E.model({ scenario: { steadyMin: 60, workload: 'basic-group' }, pools: [pool], groups });

describe('the team rule for one script', () => {
  test('all pages 100, all API 250, a mix in proportion', () => {
    const p = onprem();
    expect(E.ruleCapacity(p, { protocol: 'web', pageShare: 1 })).toBe(100);
    expect(E.ruleCapacity(p, { protocol: 'devweb', pageShare: 0 })).toBe(250);
    // 3 pages out of 20 requests: 1 / (0.15 / 100 + 0.85 / 250) = 204.08
    expect(E.ruleCapacity(p, { protocol: 'devweb', pageShare: 0.15 })).toBe(204);
  });
  test('the kind set on the card wins; an unknown share counts as web pages (cautious)', () => {
    const p = onprem();
    expect(E.ruleCapacity(p, { protocol: 'web', pageShare: 0, kind: 'web' })).toBe(100);
    expect(E.ruleCapacity(p, { protocol: 'web', pageShare: 1, kind: 'api' })).toBe(250);
    expect(E.ruleCapacity(p, { protocol: 'web' })).toBe(100);
  });
  test('not for TruClient; without figures on the pool there is no rule', () => {
    expect(E.ruleCapacity(onprem(), { protocol: 'truclient', pageShare: 1 })).toBeNull();
    expect(E.ruleCapacity({ cores: 8, ramGb: 32 }, { protocol: 'web' })).toBeNull();
    expect(E.ruleCapacity({ webPerLg: 120 }, { protocol: 'web', kind: 'api' })).toBe(120);   // one figure only: used for both
  });
});

describe('the model', () => {
  test('553 web Vusers: the rule (100) decides, not CPU (280): 6 machines', () => {
    const r = run(onprem(), [script('Shop', 553, { pageShare: 1 })]);
    expect(r.lgTotal).toBe(6);
    expect(r.lg[0].rows[0]).toMatchObject({ cap: 100, from: 'team rule' });
    expect(r.checks.find((c) => c.code === 'lg-basis').text).toMatch(/set by the team rule \(100 Vusers per machine for web pages, 250 for API calls\)/);
  });
  test('500 API Vusers (DevWeb): 250 per machine → 2', () => {
    const r = run(onprem(), [script('Api', 500, { protocol: 'devweb', kind: 'api' })]);
    expect(r.lgTotal).toBe(2);
  });
  test('the machine size decides when it allows fewer Vusers than the rule', () => {
    const p = Object.assign(onprem(), { webPerLg: 500 });
    const r = run(p, [script('Shop', 553, { pageShare: 1 })]);
    expect(r.lg[0].rows[0]).toMatchObject({ cap: 280, from: 'CPU' });
    expect(r.lgTotal).toBe(2);
    expect(r.checks.find((c) => c.code === 'lg-basis').text).toMatch(/set by CPU \(the machine size — more than the team rule asks for\)/);
  });
  test('a web script and an API script share machines in proportion', () => {
    // 60 web (0.6 of a machine) + 100 API (0.4) = 1 machine
    const r = run(onprem(), [script('Web', 60, { kind: 'web' }), script('Api', 100, { protocol: 'devweb', kind: 'api' })]);
    expect(r.lgTotal).toBe(1);
    expect(r.machines[0].items.map((x) => x.vusers).sort((a, b) => a - b)).toEqual([60, 100]);
    expect(r.machines[0].rule).toBeCloseTo(1, 9);
  });
});

describe('extra machines carry Vusers', () => {
  test('553 web Vusers + 1 extra: 7 machines, the Vusers spread (79 each), none idle', () => {
    const r = run(onprem(1), [script('Shop', 553, { pageShare: 1 })]);
    expect(r.lg[0]).toMatchObject({ needed: 6, extra: 1, total: 7 });
    expect(r.machines.map((m) => m.items[0].vusers)).toEqual([79, 79, 79, 79, 79, 79, 79]);
    expect(r.summary || r.lre).not.toMatch(/spare/);
  });
  test('several scripts over the extra machine: every machine used, none above the rule', () => {
    const r = run(onprem(1), [script('A', 120, { kind: 'web' }), script('B', 90, { kind: 'web' }), script('C', 300, { protocol: 'devweb', kind: 'api' })]);
    expect(r.lg[0].extra).toBe(1);
    expect(r.machines.every((m) => m.items.length > 0 && m.rule <= 1 + 1e-9)).toBe(true);
    expect(r.machines.reduce((a, m) => a + m.items.reduce((b, x) => b + x.vusers, 0), 0)).toBe(510);
  });
  test('the extra machines are cut to the machines available', () => {
    const r = run(Object.assign(onprem(2), { available: 7 }), [script('Shop', 553, { pageShare: 1 })]);
    expect(r.lgTotal).toBe(7);
    expect(r.checks.some((c) => c.code === 'lg-extra-cut')).toBe(true);
    expect(r.checks.some((c) => c.code === 'lg-short')).toBe(false);
  });
  test('an older plan\'s "spare" is read as extra machines', () => {
    const p = onprem(); delete p.extra; p.spare = 1;
    expect(run(p, [script('Shop', 553, { pageShare: 1 })]).lgTotal).toBe(7);
  });
  test('one Vuser cannot be split: no extra machine is used', () => {
    expect(run(onprem(1), [script('One', 1)]).lgTotal).toBe(1);
  });
});

describe('your own figures and the pace', () => {
  test('a script\'s own Vusers per machine wins over the rule and the machine size', () => {
    const r = run(onprem(), [script('Shop', 553, { pageShare: 1, perLg: 50 })]);
    expect(r.lg[0].rows[0]).toMatchObject({ cap: 50, from: 'script figure' });
    expect(r.lgTotal).toBe(12);
  });
  test('a pool figure from a past run replaces the rule', () => {
    const p = Object.assign(onprem(), { capacity: { web: 400 } });
    const r = run(p, [script('Shop', 553, { pageShare: 1 })]);
    expect(r.lg[0].rows[0]).toMatchObject({ cap: 400, from: 'your figure' });
    expect(r.lgTotal).toBe(2);
  });
  test('a fast loop (more than 2 requests per second per Vuser) is flagged', () => {
    const r = run(onprem(), [script('Api', 100, { protocol: 'devweb', kind: 'api', pacing: { mode: 'fixed', fixed: 2 }, requestsPerIter: 10 })]);
    expect(r.checks.find((c) => c.code === 'lg-fast').text).toMatch(/Api: each Vuser sends 5 requests per second/);
  });
});

describe('extra machines when one limit for all cannot reach the count', () => {
  test('two scripts of 600 web Vusers (6 machines each) + 1 extra: 13 machines, one script on 7', () => {
    const r = run(onprem(1), [script('A', 600, { kind: 'web' }), script('B', 600, { kind: 'web' })]);
    expect(r.lg[0]).toMatchObject({ needed: 12, extra: 1, total: 13 });
    const per = r.groups.map((g) => g.lgs.length).sort();
    expect(per).toEqual([6, 7]);
    expect(r.machines.every((m) => m.items.length > 0)).toBe(true);
  });
  test('300 random plans: never more machines than needed + extra, none idle, every Vuser placed', () => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let n = 0; n < 300; n++) {
      const extra = Math.floor(rnd() * 3);
      const groups = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) => script('S' + i, 1 + Math.floor(rnd() * 900), { kind: rnd() < 0.5 ? 'web' : 'api', protocol: rnd() < 0.5 ? 'web' : 'devweb' }));
      const r = E.model({ scenario: { steadyMin: 60, workload: 'basic-group', lgFill: n % 3 ? 'fill' : 'whole' }, pools: [onprem(extra)], groups });
      const x = r.lg[0];
      expect(r.lreGroups.reduce((a, g) => a + g.vusers, 0)).toBe(groups.reduce((a, g) => a + g.vusers, 0));
      expect(x.total).toBeLessThanOrEqual(x.needed + extra);
      expect(x.total).toBe(x.needed + x.extra);
      expect(r.machines.every((m) => m.items.length > 0 && m.items.every((it) => it.vusers > 0))).toBe(true);
      expect(r.machines.reduce((a, m) => a + m.items.reduce((b, it) => b + it.vusers, 0), 0)).toBe(groups.reduce((a, g) => a + g.vusers, 0));
      expect(r.machines.every((m) => m.rule <= 1 + 1e-9 && m.cpu <= 1 + 1e-9 && m.mem <= 1 + 1e-9)).toBe(true);
    }
  });
});
