/**
 * Which script runs on which load generator (packPool + model). Expected values worked out by hand in the comments.
 * A machine "carries 100 Vusers" below means one Vuser takes cpu = 1/100 of it (memory far from the limit).
 */
const E = require('../engine/workload-engine.js');

const item = (name, vusers, perMachine, extra) => Object.assign({ id: name, name, vusers, cpu: 1 / perMachine, mem: 1 / 4300 }, extra);
const loads = (r) => r.machines.map((m) => m.items.map((x) => `${x.name}:${x.vusers}`).join('+'));

describe('packPool — the rules', () => {
  test("the owner's example: 200, 30 and 200 Vusers at 100 per machine → 5 machines, big scripts split evenly", () => {
    // 200 → 2 machines of 100; 200 → 2 machines of 100; total 4.3 → at least 5; 30 → the fifth, the only one with room
    const r = E.packPool([item('S1', 200, 100), item('S2', 30, 100), item('S4', 200, 100)]);
    expect(loads(r)).toEqual(['S1:100', 'S1:100', 'S4:100', 'S4:100', 'S2:30']);
    expect(r.lowerBound).toBe(5);
    expect(r.extra).toBeNull();
  });

  test('250 Vusers at 100 per machine → 3 machines: 84 + 83 + 83 (LRE splits a group evenly)', () => {
    expect(loads(E.packPool([item('S', 250, 100)]))).toEqual(['S:84', 'S:83', 'S:83']);
  });

  test('small scripts spread: 50, 40, 30, 20 on 2 machines → 50 + 20 and 40 + 30, both at 70% of the limit', () => {
    // total 1.4 → 2 machines; 50 → A, 40 → B, 30 → B (the less busy), 20 → A
    const r = E.packPool([item('a', 50, 100), item('b', 40, 100), item('c', 30, 100), item('d', 20, 100)]);
    expect(loads(r)).toEqual(['a:50+d:20', 'b:40+c:30']);
    expect(r.machines.map((m) => Math.round(m.cpu * 100))).toEqual([70, 70]);
  });

  test('whole scripts that do not pack: 60 + 60 + 60 → 3 machines, not 2; splitting the third (40 + 20) would save one', () => {
    const r = E.packPool([item('a', 60, 100), item('b', 60, 100), item('c', 60, 100)]);
    expect(r.machines.length).toBe(3);
    expect(r.lowerBound).toBe(2);
    expect(r.extra).toEqual({ id: 'c', name: 'c', vusers: 60, split: [40, 20] });
  });

  test('TruClient never shares a machine with HTTP scripts', () => {
    // web 100 at 280 per machine (0.36) + TruClient 5 at 11 per machine (0.45) would fit one machine together
    const r = E.packPool([item('web', 100, 280), item('browser', 5, 11, { browser: true })]);
    expect(loads(r)).toEqual(['web:100', 'browser:5']);
    expect(r.machines.map((m) => m.browser)).toEqual([false, true]);
  });

  test('memory counts too: a script at 30% CPU but 80% memory leaves no room for another at 30% memory', () => {
    const r = E.packPool([item('m', 1, 1, { cpu: 0.3, mem: 0.8 }), item('n', 1, 1, { cpu: 0.1, mem: 0.3 })]);
    expect(r.machines.length).toBe(2);
  });

  test('requests per second per machine: 60 Vusers × 0.5 requests per second each = 30', () => {
    expect(E.packPool([item('s', 60, 280, { hits: 0.5 })]).machines[0].hits).toBeCloseTo(30, 9);
  });

  test('empty or zero-Vuser input: no machines', () => {
    expect(E.packPool([]).machines).toEqual([]);
    expect(E.packPool([item('z', 0, 100)]).machines).toEqual([]);
  });
});

describe('model — machines named and given to the scripts', () => {
  const fixed = (name, vusers, extra) => Object.assign({ name, method: 'vusers', vusers, txPerIter: 1, pacing: { mode: 'fixed', fixed: 20 }, requestsPerIter: 4 }, extra);

  test('LG1, LG2 … numbered on across pools; an extra machine carries Vusers too (no idle spare)', () => {
    // pool A carries 100 web Vusers per machine (your figure): 150 → 2 machines needed + 1 extra = 3 × 50; pool B: 30 → 1
    const r = E.model({ scenario: { steadyMin: 60, workload: 'basic-group' },
      pools: [{ id: 'a', name: 'On-premise', capacity: { web: 100 }, extra: 1 }, { id: 'b', name: 'AWS', capacity: { web: 100 }, extra: 0 }],
      groups: [fixed('Orders', 150, { pool: 'a' }), fixed('Search', 30, { pool: 'b' })] });
    expect(r.machines.map((m) => [m.name, m.pool, m.items.map((x) => x.vusers).join('+')])).toEqual([
      ['LG1', 'On-premise', '50'], ['LG2', 'On-premise', '50'], ['LG3', 'On-premise', '50'], ['LG4', 'AWS', '30']]);
    expect(r.groups[0].lgs).toEqual([{ name: 'LG1', vusers: 50 }, { name: 'LG2', vusers: 50 }, { name: 'LG3', vusers: 50 }]);
    expect(r.lgTotal).toBe(4);
    expect(r.lg[0]).toMatchObject({ needed: 2, extra: 1, total: 3 });
    expect(r.lre).toMatch(/Load generators: LG1, LG2, LG3 \(50 Vusers each\)/);
    expect(r.lre).toMatch(/Load generators: LG4 \(30 Vusers\)/);
    expect(r.machines.some((m) => !m.items.length)).toBe(false);
    expect(r.machines[0].hits).toBeCloseTo(50 * 4 / 20, 9);              // 10 requests per second
  });

  test('a stepped test is sized for its highest step: stress peaks at 150% → 60 Vusers become 90 on the machines', () => {
    const r = E.model({ scenario: { steadyMin: 15, testType: 'stress', workload: 'real-world' }, pools: [{ id: 'p', name: 'P', capacity: { web: 100 }, extra: 0 }], groups: [fixed('S', 60, { pool: 'p' })] });
    expect(r.machines.reduce((a, m) => a + m.items.reduce((b, x) => b + x.vusers, 0), 0)).toBe(90);
  });

  test('one group per script: whole scripts that do not pack — a warning that names the way out', () => {
    const r = E.model({ scenario: { steadyMin: 60, workload: 'basic-group', lgFill: 'whole' }, pools: [{ id: 'p', name: 'P', capacity: { web: 100 }, extra: 0 }],
      groups: ['a', 'b', 'c'].map((n) => fixed(n, 60, { pool: 'p' })) });
    expect(r.lgTotal).toBe(3);
    const c = r.checks.find((x) => x.code === 'lg-packing');
    expect(c.level).toBe('warn');
    expect(c.text).toMatch(/3 load generators instead of 2[^]*Fill each machine[^]*split c into two groups \(40 \+ 20 Vusers\) to save one/);
  });

  test('fill each machine (the default): the same three scripts on 2 machines, one of them as two LRE groups', () => {
    const r = E.model({ scenario: { steadyMin: 60, workload: 'basic-group' }, pools: [{ id: 'p', name: 'P', capacity: { web: 100 }, extra: 0 }],
      groups: ['a', 'b', 'c'].map((n) => fixed(n, 60, { pool: 'p' })) });
    expect(r.lgTotal).toBe(2);
    expect(r.machines.every((m) => m.items.reduce((a, x) => a + x.vusers, 0) <= 100)).toBe(true);
    expect(r.lreGroups.length).toBe(4);                                    // one script split in two
    expect(r.lreGroups.reduce((a, x) => a + x.vusers, 0)).toBe(180);
    const split = r.lreGroups.filter((x) => x.parts === 2);
    expect(split.map((x) => x.name)).toEqual([split[0].name.replace(/_\d$/, '') + '_1', split[0].name.replace(/_\d$/, '') + '_2']);
    expect(r.checks.some((x) => x.code === 'lg-groups')).toBe(true);
    expect(r.checks.some((x) => x.code === 'lg-packing')).toBe(false);
    // the by-group schedule plans each LRE group: all start immediately and stop together
    expect(r.groupPlans.length).toBe(4);
    expect(r.groupPlans.every((p) => p.delay === 0)).toBe(true);
    expect(new Set(r.groupPlans.map((p) => p.ramp + p.actions[1].dur)).size).toBe(1);
    // the copy text names the script, never name_1 / name_2
    expect(r.lre).toMatch(/\n[abc] — \d+ Vusers \(added 2 times: this is 2 of 2\)/);
    expect(r.lre).not.toMatch(/[abc]_[12]\b/);
    expect(r.lre).toMatch(/Every group: Start Group Immediately/);
  });

  test('the lgText wording', () => {
    expect(E.lgText([{ name: 'LG1', vusers: 100 }, { name: 'LG2', vusers: 100 }])).toBe('LG1, LG2 (100 Vusers each)');
    expect(E.lgText([{ name: 'LG3', vusers: 67 }, { name: 'LG4', vusers: 66 }])).toBe('LG3 (67), LG4 (66)');
    expect(E.lgText([{ name: 'LG5', vusers: 1 }])).toBe('LG5 (1 Vuser)');
  });

  test('a pool without a machine size: no machines, no names, the usual check', () => {
    const r = E.model({ scenario: { workload: 'basic-group' }, pools: [{ id: 'p', name: 'Cloud' }], groups: [fixed('S', 10, { pool: 'p' })] });
    expect(r.machines).toEqual([]);
    expect(r.groups[0].lgs).toEqual([]);
    expect(r.checks.some((c) => c.code === 'lg-size')).toBe(true);
  });
});
