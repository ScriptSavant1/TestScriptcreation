/* Team settings (config/workload-settings.json): the shipped file is valid, every value is checked, a wrong value keeps
   the built-in one and is named; the engine uses the smallest-group and fast-loop figures. */
const fs = require('fs'), path = require('path');
const S = require('../engine/settings.js');
const E = require('../engine/workload-engine.js');
const FILE = path.join(__dirname, '..', 'config', 'workload-settings.json');

describe('the shipped settings file', () => {
  test('is valid JSON with no problems, and the same as the built-in values', () => {
    const { settings, problems } = S.read(JSON.parse(fs.readFileSync(FILE, 'utf8')));
    expect(problems).toEqual([]);
    const strip = (x) => Object.assign({}, x, { updated: null });
    expect(strip(settings)).toEqual(strip(S.DEFAULTS));
    expect(settings.updated).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('reading', () => {
  test('a changed figure is used (on-premise web pages 150)', () => {
    const json = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    json.machineTypes[0].webVusersPerLg = 150; json.loadGenerators.extraMachines = 0;
    const { settings, problems } = S.read(json);
    expect(problems).toEqual([]);
    expect(settings.machineTypes[0].webVusersPerLg).toBe(150);
    expect(settings.loadGenerators.extraMachines).toBe(0);
  });
  test('wrong values keep the built-in ones and are named', () => {
    const { settings, problems } = S.read({ loadGenerators: { busyLimitPct: 'seventy', extraMachines: 1.5, smallestGroup: 0 }, schedule: { headroomPct: -1 }, protocols: { web: { vusersPerCore: 0 }, sap: {} } });
    expect(settings.loadGenerators).toEqual(S.DEFAULTS.loadGenerators);
    expect(settings.schedule.headroomPct).toBe(25);
    expect(settings.protocols.web.vusersPerCore).toBe(50);
    expect(problems.length).toBe(6);
    expect(problems.join('\n')).toMatch(/busyLimitPct: "seventy" is not a number/);
    expect(problems.join('\n')).toMatch(/protocols.sap: not a protocol the tool knows/);
  });
  test('machine types: a bad entry is left out, a list with none usable keeps the built-in list', () => {
    const r1 = S.read({ machineTypes: [{ id: 'big', label: 'Big box', cores: 32, memoryGb: 128, webVusersPerLg: 300 }, { id: 'big', label: 'Twice', cores: 1, memoryGb: 1 }, { label: 'No id', cores: 4, memoryGb: 8 }, { id: 'x', label: 'No size' }] });
    expect(r1.settings.machineTypes.map((t) => t.id)).toEqual(['big']);
    expect(r1.settings.machineTypes[0].location).toBe('Big box');
    expect(r1.problems.length).toBe(3);
    const r2 = S.read({ machineTypes: [{ id: 'custom', label: 'Reserved', cores: 4, memoryGb: 8 }] });
    expect(r2.settings.machineTypes).toEqual(S.DEFAULTS.machineTypes);
    expect(r2.problems.join('\n')).toMatch(/no usable machine type/);
  });
  test('not an object at all: the built-in values', () => {
    expect(S.read(null)).toEqual({ settings: S.DEFAULTS, problems: [expect.stringMatching(/not a JSON object/)] });
  });
  test('the machine note', () => {
    expect(S.note(S.DEFAULTS.machineTypes[0])).toBe('8 CPU cores · 32 GB memory · 230 GB disk');
    expect(S.note(S.DEFAULTS.machineTypes[1])).toBe('16 vCPU · 32 GB memory');
  });
});

describe('the engine uses the settings', () => {
  const pool = { id: 'p1', name: 'P', cores: 8, ramGb: 32, webPerLg: 100, apiPerLg: 250, extra: 0 };
  const g = (name, v, more) => Object.assign({ name, method: 'vusers', vusers: v, txPerIter: 1, protocol: 'web', kind: 'web', pacing: { mode: 'fixed', fixed: 60 }, requestsPerIter: 10 }, more);
  test('fast loop: flagged above the figure in the settings', () => {
    const groups = [g('Api', 100, { kind: 'api', pacing: { mode: 'fixed', fixed: 4 } })];   // 2.5 requests per second per Vuser
    expect(E.model({ scenario: { steadyMin: 60, workload: 'basic-group' }, pools: [pool], groups }).checks.some((c) => c.code === 'lg-fast')).toBe(true);
    expect(E.model({ scenario: { steadyMin: 60, workload: 'basic-group', fastLoopRps: 3 }, pools: [pool], groups }).checks.some((c) => c.code === 'lg-fast')).toBe(false);
  });
  test('smallest group: no LRE group below the figure', () => {
    const groups = [g('A', 97), g('B', 8)];
    for (const minGroup of [5, 8]) {
      const r = E.model({ scenario: { steadyMin: 60, workload: 'basic-group', minGroup }, pools: [pool], groups });
      expect(r.lreGroups.every((x) => x.vusers >= Math.min(minGroup, 8))).toBe(true);
    }
  });
});
