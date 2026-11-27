'use strict';

/** The converter page's own rules (src/web/public/portal/converter-app.js) — the parts that need no page. */

const A = require('../../src/web/public/portal/converter-app.js');

const R = (n, o) => ({ n, name: 'R' + n, group: 'G', folder: 'G', method: 'GET', address: 'https://a.example.com/' + n, host: 'a.example.com', ...o });

describe('choices', () => {
  test('what a new file starts with; remembered settings, wrong ones ignored', () => {
    expect(A.freshChoices()).toEqual({ fmt: 'devweb', mode: 'single', tt: 1, ll: 'info', wlm: true, adv: { corr: true, param: true, auth: true, cmt: true }, out: [], name: '', names: {}, varNames: {}, values: {} });
    expect(A.freshChoices({ fmt: 'web-http', mode: 'multi', tt: 5, ll: 'debug', wlm: false, adv: { cmt: false } })).toMatchObject({ fmt: 'web-http', mode: 'multi', tt: 5, ll: 'debug', wlm: false, adv: { corr: true, cmt: false } });
    expect(A.freshChoices({ fmt: 'x', tt: 99, mode: 1 })).toMatchObject({ fmt: 'devweb', tt: 1, mode: 'single' });
  });
  test('another file keeps the settings, not what belongs to the old file', () => {
    const c = Object.assign(A.freshChoices({ fmt: 'web-http', tt: 3, adv: { auth: false } }), { out: [1], name: 'X', names: { a: 'B' }, varNames: { c: 'D' }, values: { e: 'f' } });
    expect(A.keepSettings(c)).toEqual(Object.assign(A.freshChoices({ fmt: 'web-http', tt: 3, adv: { auth: false } })));
    expect(A.keepSettings(c).adv).not.toBe(c.adv);
  });
  test('the fields sent: the same plain ones as ever, in order', () => {
    expect(A.plainFields('pm', A.freshChoices())).toEqual([['protocol', 'devweb'], ['mode', 'single'], ['thinkTime', 1], ['logLevel', 'info'], ['useCorrelation', true], ['useParameterization', true], ['useAuthentication', true], ['addComments', true]]);
    expect(A.plainFields('jmx', A.freshChoices({ wlm: false })).map((x) => x.join('='))).toEqual(['protocol=devweb', 'thinkTime=1', 'generateWlmExcel=false', 'mode=single', 'useTransactions=true', 'useCorrelation=true', 'useParameterization=true', 'useAuthentication=true', 'addComments=true']);
  });
  test('the fields of an update: only what was chosen', () => {
    expect(A.choiceFields(A.freshChoices())).toEqual([]);
    expect(A.choiceFields(Object.assign(A.freshChoices(), { out: [3, 1], name: 'N', names: { h: 'P' }, varNames: { base_url: 'App' }, values: { a: '1' } }))).toEqual([['leaveOut', '[1,3]'], ['scriptName', 'N'], ['serverNames', '{"h":"P"}'], ['varNames', '{"base_url":"App"}'], ['values', '{"a":"1"}']]);
  });
});

describe('requests', () => {
  const reqs = [R(1, { name: 'Login', group: 'Auth' }), R(2, { name: 'Orders', group: 'Shop', host: 'b.example.com', address: 'https://b.example.com/orders' }), R(3, { name: 'Logout', group: 'Auth' })];
  test('filter by domain, words, a value', () => {
    expect(A.filterRequests(reqs, {}).length).toBe(3);
    expect(A.filterRequests(reqs, { host: 'a.example.com' }).map((r) => r.n)).toEqual([1, 3]);
    expect(A.filterRequests(reqs, { q: 'ORDERS' }).map((r) => r.n)).toEqual([2]);
    expect(A.filterRequests(reqs, { use: { usedBy: [2], setBy: [1] } }).map((r) => r.n)).toEqual([1, 2]);
    expect(A.filterRequests(reqs, { host: 'b.example.com', q: 'login' })).toEqual([]);
  });
  test('groups in order; a tick for several', () => {
    expect(A.groupRequests(reqs).map((g) => [g.name, g.requests.map((r) => r.n)])).toEqual([['Auth', [1, 3]], ['Shop', [2]]]);
    expect([A.stateOf([1, 2], []), A.stateOf([1, 2], [1, 2, 5]), A.stateOf([1, 2], [2])]).toEqual(['all', 'none', 'some']);
  });
  test('needed: a value set only by left-out requests and sent by a kept one; given ones are fine', () => {
    const list = [{ n: 1, sets: ['token'] }, { n: 2, uses: ['token'] }, { n: 3, sets: ['id'] }, { n: 4, sets: ['id'] }, { n: 5, uses: ['id', 'token'] }];
    expect(A.needed(list, [])).toEqual([]);
    expect(A.needed(list, [1])).toEqual([{ name: 'token', by: [1], usedBy: [2, 5] }]);
    expect(A.needed(list, [1], { token: 'x' })).toEqual([]);
    expect(A.needed(list, [3])).toEqual([]);
    expect(A.needed(list, [1, 2, 5])).toEqual([]);
    expect(A.needed(list, [3, 4]).map((x) => [x.name, x.usedBy])).toEqual([['id', [5]]]);
  });
  test('a JMeter thread group in words', () => {
    expect(A.tgText({ type: 'Standard', virtualUsers: 10, rampUpSec: 10, holdSec: 300, iterations: 'Infinite', enabled: true })).toBe('10 users · ramp-up 10 s · hold 5 min · loops until stopped');
    expect(A.tgText({ type: 'SetUp', virtualUsers: 1, rampUpSec: 0, holdSec: 0, iterations: 1 })).toBe('setUp · 1 user · 1 loop');
    expect(A.tgText({ virtualUsers: 5, iterations: 3, holdSec: 90, enabled: false })).toBe('5 users · hold 90 s · 3 loops · off in the test plan');
  });
});

describe('files', () => {
  const F = (path, text = 'x') => ({ path, text });
  test('the main scripts: main.js for DevWeb (its Action.c is a stub), else Action.c', () => {
    expect(A.mainFiles([F('Action.c'), F('main.js')]).map((f) => f.path)).toEqual(['main.js']);
    expect(A.mainFiles([F('a.usr'), F('A/Action.c'), F('B/Action.c')]).map((f) => f.path)).toEqual(['A/Action.c', 'B/Action.c']);
    expect(A.mainFiles([F('main.js', null)])).toEqual([]);
  });
  test('a request\'s script in a multi-script ZIP: by its folder, else by its transaction', () => {
    const files = [F('Browsers/main.js', '"T1"'), F('My_Buyers/main.js', '"T2"')];
    expect(A.fileOf(files, R(1, { group: 'My Buyers' })).path).toBe('My_Buyers/main.js');
    expect(A.fileOf(files, R(1, { group: 'Other', tx: 'T2' })).path).toBe('My_Buyers/main.js');
    expect(A.fileOf(files, null).path).toBe('Browsers/main.js');
    expect(A.fileOf([F('readme.md')], null)).toBeNull();
  });
  test('the tabs: the main file and its neighbours, in the same folder', () => {
    const files = [F('A/Action.c'), F('A/globals.h'), F('A/vuser_init.c'), F('B/Action.c'), F('A/x.usr')];
    expect(A.tabFiles(files, files[0]).map((f) => f.path)).toEqual(['A/Action.c', 'A/vuser_init.c', 'A/globals.h']);
    expect(A.tabFiles([F('main.js'), F('rts.yml'), F('Action.c')], F('main.js')).map((f) => f.path)).toEqual(['main.js', 'rts.yml']);
    expect(A.tabFiles([], null)).toEqual([]);
  });
  test('by folder, the top first', () => { expect(A.fileGroups([{ path: 'B/main.js' }, { path: 'a.md' }, { path: 'A/main.js' }]).map((g) => g.dir)).toEqual(['', 'A', 'B']); });
  test('a request\'s lines: DevWeb, VuGen, none', () => {
    const dev = 'const TS01 = new load.Transaction("SC01_01_A");\nconst TS02 = new load.Transaction("SC01_02_A");\nTS01.start();\nx\nTS01.stop(1);\nTS02.start();\ny\nTS02.stop(1);';
    expect(A.codeRange(dev, 'SC01_02_A')).toEqual([5, 7]); expect(A.codeRange(dev, 'SC01_01_A')).toEqual([2, 4]);
    const c = 'lr_start_transaction("SC01_01_A");\nweb_url();\nlr_end_transaction("SC01_01_A", LR_AUTO);\nlr_start_transaction("SC01_01_AB");\nlr_end_transaction("SC01_01_AB", LR_AUTO);';
    expect(A.codeRange(c, 'SC01_01_A')).toEqual([0, 2]); expect(A.codeRange(c, 'SC01_01_AB')).toEqual([3, 4]);
    expect([A.codeRange(c, 'SC01_09'), A.codeRange('', 'x'), A.codeRange(c, '')]).toEqual([null, null, null]);
  });
});

describe('values and domains', () => {
  const vars = [{ name: 'App', orig: 'base_url', source: 'environment', value: 'https://a', usedBy: [1], setBy: [] }, { name: 'tok', source: 'set', how: 'json $.t', usedBy: [2], setBy: [1] }, { name: 'v', source: 'missing', usedBy: [1], setBy: [] }, { name: 'col', source: 'collection', value: 'c', usedBy: [], setBy: [] }];
  test('grouped by where they come from, those that need a value first; a given one by its name in the file', () => {
    expect(A.valueGroups(vars, {}, '', 'pm').map((g) => [g.key, g.list.map((v) => v.name)])).toEqual([['missing', ['v']], ['set', ['tok']], ['environment', ['App']], ['collection', ['col']]]);
    expect(A.valueGroups(vars, { base_url: 'x', v: '1' }, '', 'pm').map((g) => g.key)).toEqual(['given', 'set', 'collection']);
    expect(A.valueGroups(vars, {}, 'https', 'pm').map((g) => g.list[0].name)).toEqual(['App']);
    expect(A.valueGroups(vars, {}, '', 'jmx')[3].title).toBe('From the test plan');
    expect(A.valueGroups(vars, {}, '', 'pm')[1].title).toBe('Set while the script runs'); // a script's values are not read from a response
  });
  test('how a value is read', () => {
    expect([A.howOf({ how: 'json $.a' }), A.howOf({ how: 'regex a(.+)b' }), A.howOf({ how: 'xpath //a' }), A.howOf({})]).toEqual([{ kind: 'JSON path', text: '$.a' }, { kind: 'regular expression', text: 'a(.+)b' }, { kind: 'XPath', text: '//a' }, { kind: 'set by a script', text: '' }]);
  });
  test('a domain\'s parameter: the script\'s own, or its variables — which of them can be renamed, and why not', () => {
    expect(A.domainNames({ host: 'M.example.com:443', param: 'Static_Server' }, vars)).toEqual([{ type: 'param', name: 'Static_Server', key: 'm.example.com', can: true }]);
    const n = A.domainNames({ host: 'a', vars: ['App', 'tok', 'v', 'nothere'] }, vars);
    expect(n.map((x) => [x.name, x.key, x.can, x.why])).toEqual([['App', 'base_url', true, ''], ['tok', 'tok', false, 'Set while the script runs'], ['v', 'v', false, 'Needs a value first'], ['nothere', 'nothere', false, 'Needs a value first']]);
    expect(A.domainNames({ host: 'localhost' }, vars)).toEqual([]);
  });
  test('the short address: the path', () => {
    expect([A.shortAddress('https://a.example.com/x/{{id}}?q=1'), A.shortAddress('https://a.example.com'), A.shortAddress('{{base}}/x'), A.shortAddress('')]).toEqual(['/x/{{id}}?q=1', '/', '{{base}}/x', '']);
  });
  test('names', () => {
    expect([A.cleanName('  a/b  c*  '), A.cleanName('***'), A.serverKey('API.example.com:443')]).toEqual(['a_b c_', '', 'api.example.com']);
  });
});

describe('dropped files go to their box', () => {
  const f = (...n) => n.map((name) => ({ name })), s = (...a) => A.sortFiles(...a).map((x) => x.slot + ':' + x.files.map((y) => y.name));
  test('Postman / Bruno', () => {
    expect(s(f('Shop.json', 'Test.postman_environment.json', 'a.pem', 'b.KEY'), 'pm', false).sort()).toEqual(['cert:a.pem,b.KEY', 'env:Test.postman_environment.json', 'main:Shop.json']);
    expect(s(f('Test.postman_environment.json', 'Shop.json'), 'pm', false).sort()).toEqual(['env:Test.postman_environment.json', 'main:Shop.json']);
    expect(s(f('My environment.json'), 'pm', false)).toEqual(['main:My environment.json']);
    expect(s(f('x.json'), 'pm', true)).toEqual(['env:x.json']); expect(s(f('x.yml'), 'pm', true)).toEqual([]); expect(s(f('c.yaml'), 'pm', false)).toEqual(['main:c.yaml']);
  });
  test('JMeter', () => { expect(s(f('p.jmx', 'u.csv', 'v.csv', 'k.p12', 'note.txt'), 'jmx', false)).toEqual(['main:p.jmx', 'csv:u.csv,v.csv', 'cert:k.p12']); });
});

describe('text', () => {
  test('what went wrong, in words', () => {
    expect(A.errorText('conversion_failed', 'jmx')).toContain('JMeter test plan'); expect(A.errorText('conversion_failed', 'pm')).toContain('Postman or Bruno');
    expect(A.errorText('rate_limit_exceeded')).toContain('Too many'); expect(A.errorText('Odd text')).toBe('Odd text'); expect(A.errorText()).toBe('Unknown error');
  });
  test('code is escaped and marked', () => {
    expect(A.colorLine('const a = "<b>"; // x & y')).toBe('<span class="cx-kw">const</span> a = <span class="cx-str">&quot;&lt;b&gt;&quot;</span>; <span class="cx-com">// x &amp; y</span>');
    expect(A.colorLine('x'.repeat(3000))).toBe('x'.repeat(3000));
    expect(A.colorLine('lr_think_time(5);')).toContain('<span class="cx-fun">lr_think_time</span>');
  });
});
