'use strict';

/**
 * Converters — what the script sends, and from where:
 *   - the script keeps the order of the collection / test plan (a request in a sub-folder stays where it is) and has one
 *     transaction per request, also for two requests with one name (BUG-158, BUG-164);
 *   - an uploaded data file is named as the ZIP holds it and lies next to each script that reads it (BUG-159);
 *   - DevWeb sends the Content-Type Postman adds by itself (BUG-165);
 *   - counts: each value once, every thread group; a value the script makes is not "no value" (BUG-162);
 *   - the answers hold no server folder (BUG-163).
 */

const fs = require('fs'), os = require('os'), path = require('path');
const VuGen = require('../../src/generators/vugen/scriptGenerator.js');
const DevWeb = require('../../src/generators/devweb/scriptGenerator.js');
const JmxConverter = require('../../src/tools/jmx-converter');
const CollectionConverter = require('../../src/tools/collection-converter');
const Resolver = require('../../src/lib/jmxDependencyResolver.js');
const { buildPreview, publicAnalysis, publicScripts } = require('../../src/web/convertPreview.js');

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => jest.restoreAllMocks());

const req = (name, folder, o = {}) => ({ name, folder, method: 'GET', url: 'https://api.example.com/' + name.replace(/ /g, '-'), headers: [], ...o });
const COLLECTION = { info: { name: 'Order Test' } };
async function devweb(list, opts = {}) { const g = new DevWeb(list, COLLECTION, { thinkTime: 1, ...opts }); await g.analyze(); g.buildTransactionMap(); return { g, code: g.generateAction() }; }
async function vugen(list, opts = {}) { const g = new VuGen(list, COLLECTION, { thinkTime: 1, ...opts }); await g.analyze(); return { g, code: g.generateActionC() }; }
const urls = (code) => [...code.matchAll(/(?:"url": `https:\/\/[^/]+|"URL=https:\/\/[^/]+)\/([\w-]+)/g)].map((m) => m[1]);

describe('the order of the collection', () => {
  const list = () => [req('Place order', 'Order'), req('Pay order', 'Order/Payment'), req('Delete basket', 'Order'), req('Sign out', '')];
  const order = ['Place-order', 'Pay-order', 'Delete-basket', 'Sign-out'];
  test('DevWeb: a request in a sub-folder stays where it is', async () => { expect(urls((await devweb(list())).code)).toEqual(order); });
  test('VuGen: the same', async () => { expect(urls((await vugen(list())).code)).toEqual(order); });
  test('transactions are numbered in that order', async () => {
    const { g } = await devweb(list());
    expect([...g.requestTxMap.values()].map((t) => t.txName.replace(/^SC01_/, ''))).toEqual(['01_PLACE_ORDER', '02_PAY_ORDER', '03_DELETE_BASKET', '04_SIGN_OUT']);
    expect((await vugen(list())).g.transactionNames.map((t) => t.replace(/^SC01_/, ''))).toEqual(['01_PLACE_ORDER', '02_PAY_ORDER', '03_DELETE_BASKET', '04_SIGN_OUT']);
  });
  test('think time between steps, none after the last', async () => {
    const d = (await devweb(list())).code, v = (await vugen(list())).code;
    expect(d.match(/load\.thinkTime\(/g)).toHaveLength(3);
    expect(v.match(/lr_think_time\(/g)).toHaveLength(3);
  });
  test('DevWeb: two requests with one name are two transactions', async () => {
    const { g, code } = await devweb([req('Get status', ''), req('Save', ''), req('Get status', '')]);
    expect([...g.requestTxMap.values()].map((t) => t.txVar)).toEqual(['TS01', 'TS02', 'TS03']);
    expect([...code.matchAll(/(TS\d+)\.start\(\)/g)].map((m) => m[1])).toEqual(['TS01', 'TS02', 'TS03']);
    expect([...code.matchAll(/(TS\d+)\.stop\(/g)].map((m) => m[1])).toEqual(['TS01', 'TS02', 'TS03']);
  });
});

describe('DevWeb: the Content-Type of a body sent with none', () => {
  const body = (b, headers = []) => devweb([req('Post it', '', { method: 'POST', body: b, headers })]).then((r) => r.code);
  const raw = (s) => ({ mode: 'raw', raw: s });
  test('JSON object and list: application/json', async () => {
    expect(await body(raw('{"a":1}'))).toContain('"Content-Type": "application/json"');
    expect(await body(raw('[{"a":1}]'))).toContain('"Content-Type": "application/json"');
  });
  test('form fields: application/x-www-form-urlencoded', async () => {
    expect(await body({ mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1' }] })).toContain('"Content-Type": "application/x-www-form-urlencoded"');
  });
  test('the request\'s own Content-Type stays, once', async () => {
    const own = await body(raw('{"a":1}'), [{ key: 'content-type', value: 'application/json; charset=utf-8' }, { key: 'X-A', value: '1' }]);
    expect(own).not.toContain('"Content-Type"');
  });
  test('a disabled Content-Type does not count', async () => {
    expect(await body(raw('{"a":1}'), [{ key: 'Content-Type', value: 'text/xml', disabled: true }])).toContain('"Content-Type": "application/json"');
  });
  test('plain text, XML and multipart: nothing added; GET: nothing', async () => {
    expect(await body(raw('hello'))).not.toContain('Content-Type');
    expect(await body(raw('<a/>'))).not.toContain('Content-Type');
    expect(await body({ mode: 'formdata', formdata: [{ key: 'a', value: '1' }] })).not.toContain('Content-Type');
    expect((await devweb([req('Get it', '', { body: raw('{"a":1}') })])).code).not.toContain('Content-Type');
  });
  test('a common Content-Type header (every request sends it) is enough', async () => {
    const h = () => [{ key: 'Content-Type', value: 'application/json' }];
    const { code } = await devweb([req('One', '', { method: 'POST', body: raw('{"a":1}'), headers: h() }), req('Two', '', { method: 'POST', body: raw('{"a":2}'), headers: h() })]);
    expect((code.match(/Content-Type/g) || []).length).toBeLessThanOrEqual(2);
  });
});

describe('JMeter: data files', () => {
  const conv = (paths) => Object.assign(Object.create(JmxConverter.prototype), { options: { csvFilePaths: paths } });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-test-'));
  const up = path.join(tmp, 'my_users.csv');
  beforeAll(() => fs.writeFileSync(up, 'USER,PASS\na,b\n'));
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  test.each(['data/My Users.csv', 'C:\\jmeter\\data\\my users.CSV', 'my users.csv'])('%s is named as the ZIP holds it', (name) => {
    const ds = [{ filename: name, variableNames: 'USER,PASS' }];
    conv({ 'My Users.csv': up }).nameUploadedCsvFiles(ds);
    expect(ds[0]).toMatchObject({ filename: 'my_users.csv', uploadedName: 'My Users.csv' });
  });
  test('a file that was not uploaded keeps the test plan\'s path', () => {
    const ds = [{ filename: 'data/other.csv' }, { filename: '' }];
    conv({ 'My Users.csv': up }).nameUploadedCsvFiles(ds);
    expect(ds).toEqual([{ filename: 'data/other.csv' }, { filename: '' }]);
  });
  test('it is written next to the script, once', async () => {
    const out = fs.mkdtempSync(path.join(tmp, 'out-')), ds = [{ filename: 'data/My Users.csv' }, { filename: 'My Users.csv' }, { filename: 'none.csv' }];
    const c = conv({ 'My Users.csv': up });
    c.nameUploadedCsvFiles(ds); await c.copyUploadedCsvFiles(ds, out);
    expect(fs.readdirSync(out)).toEqual(['my_users.csv']);
    expect(fs.readFileSync(path.join(out, 'my_users.csv'), 'utf8')).toBe('USER,PASS\na,b\n');
  });
  test('the dependency report still finds it under its uploaded name', () => {
    const r = new Resolver([{ filename: 'my_users.csv', uploadedName: 'My Users.csv', variableNames: 'USER' }], [{ originalname: 'My Users.csv', size: 5 }]).resolve();
    expect(r.missing).toEqual([]); expect(r.summary).toMatchObject({ found: 1, missing: 0 });
  });
});

describe('JMeter, one script per thread group', () => {
  const PLAN = `<?xml version="1.0"?><jmeterTestPlan version="1.2"><hashTree><TestPlan testname="Two groups" enabled="true"/><hashTree>
    <CSVDataSet testclass="CSVDataSet" testname="Users" enabled="true"><stringProp name="filename">data/users.csv</stringProp><stringProp name="variableNames">USER</stringProp></CSVDataSet><hashTree/>
    ${['Buyers', 'Browsers'].map((g) => `<ThreadGroup testclass="ThreadGroup" testname="${g}" enabled="true"><stringProp name="ThreadGroup.num_threads">1</stringProp></ThreadGroup><hashTree>
      ${['One', 'Two'].map((n) => `<HTTPSamplerProxy testclass="HTTPSamplerProxy" testname="${g} ${n}" enabled="true"><stringProp name="HTTPSampler.domain">api.example.com</stringProp><stringProp name="HTTPSampler.protocol">https</stringProp><stringProp name="HTTPSampler.path">/${g}/${n}?u=\${USER}</stringProp><stringProp name="HTTPSampler.method">GET</stringProp></HTTPSamplerProxy><hashTree/>`).join('')}
    </hashTree>`).join('')}
  </hashTree></hashTree></jmeterTestPlan>`;
  test.each(['devweb', 'web-http'])('%s: the data file is in each script folder; every thread group is counted', async (protocol) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-test-')), jmx = path.join(dir, 'p.jmx'), csv = path.join(dir, 'users.csv'), out = path.join(dir, 'out');
    fs.writeFileSync(jmx, PLAN); fs.writeFileSync(csv, 'USER\nalice\n');
    const r = await new JmxConverter({ inputFile: jmx, outputDir: out, protocol, mode: 'multi', generateWlmExcel: false, useParameterization: true, useCorrelation: true, useTransactions: true, useAuthentication: true, csvFilePaths: { 'users.csv': csv } }).convert();
    for (const g of ['Buyers', 'Browsers']) {
      expect(fs.readFileSync(path.join(out, g, 'users.csv'), 'utf8')).toBe('USER\nalice\n');
      const ref = fs.readFileSync(path.join(out, g, protocol === 'devweb' ? 'parameters.yml' : 'ParameterFile.prm'), 'utf8');
      expect(ref).toContain('users.csv'); expect(ref).not.toContain('data/users.csv');
    }
    expect(r.analysis.requests.total).toBe(4);
    expect(r.analysis.parameters.totalParameters).toBeGreaterThanOrEqual(1);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('counts and answers', () => {
  test('a value used many times is one value', async () => {
    const tests = [{ listen: 'test', script: { exec: ['pm.environment.set("token", pm.response.json().token);'] } }];
    const use = (n) => req(n, '', { headers: [{ key: 'Authorization', value: 'Bearer {{token}}' }] });
    const a = (await devweb([req('Sign in', '', { method: 'POST', tests }), use('A'), use('B'), use('C')])).g.getAnalysisReport().correlations;
    expect(a.totalValues).toBe(1); expect(a.totalCorrelations).toBeGreaterThan(1);
  });
  test('Postman / Bruno multi-script: the answer has the counts of every script', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-test-')), f = path.join(dir, 'c.json');
    const it = (n) => ({ name: n, request: { method: 'GET', url: { raw: 'https://api.example.com/' + n }, header: [] } });
    fs.writeFileSync(f, JSON.stringify({ info: { name: 'M', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: 'F1', item: [it('a'), it('b')] }, { name: 'F2', item: [it('c')] }] }));
    const r = await new CollectionConverter({ inputFile: f, outputDir: path.join(dir, 'out'), protocol: 'devweb', mode: 'multi' }).convert();
    expect(r.analysis.requests.total).toBe(3); expect(r.analysis.correlations.totalValues).toBe(0);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  test('a value the script makes is not "no value"; one nothing makes still is', () => {
    const p = buildPreview({ kind: 'pm', requests: [req('A', '', { headers: [{ key: 'X-Request-Id', value: '{{xRequestId}}' }, { key: 'X-B', value: '{{nothing}}' }] })], collection: COLLECTION, environmentVars: {}, files: [], made: ['xRequestId'] });
    expect(p.variables.map((v) => [v.name, v.source])).toEqual([['xRequestId', 'builtin'], ['nothing', 'missing']]);
  });
  test('an environment value wins over "made"', () => {
    const p = buildPreview({ kind: 'pm', requests: [req('A', '', { headers: [{ key: 'X', value: '{{id}}' }] })], collection: COLLECTION, environmentVars: { id: '7' }, files: [], made: ['id'] });
    expect(p.variables[0].source).toBe('environment');
  });
  test('no server folder in the answers', () => {
    expect(publicAnalysis({ requests: { total: 1 }, options: { outputDir: '/srv/tmp' } })).toEqual({ requests: { total: 1 } });
    expect(publicScripts([{ safeDirName: 'A', outputDir: '/srv/tmp/A', analysis: { requests: {}, options: { inputFile: '/srv' } } }, { folder: 'B', outputDir: '/x' }])).toEqual([{ safeDirName: 'A', analysis: { requests: {} } }, { folder: 'B' }]);
    expect(publicScripts(undefined)).toBeNull(); expect(publicAnalysis(undefined)).toBeUndefined();
  });
});
