'use strict';

/**
 * The converter page's server side: a domain's variable under the name chosen on the page (applyVarNames), and the
 * preview's domain variables and request details.
 */

const fs = require('fs'), os = require('os'), path = require('path');
const S = require('../../src/core/scriptSettings.js');
const C = require('../../src/web/convertPreview.js');
const CollectionConverter = require('../../src/tools/collection-converter');

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => jest.restoreAllMocks());

describe('readVarNames', () => {
  test('valid names only; none → no option', () => {
    expect(S.readVarNames('{"base_url":"App_Server","a.b":"Ok","same":"same","x":"9bad","y":"has space","9z":"Z"}')).toEqual({ base_url: 'App_Server', 'a.b': 'Ok' });
    for (const bad of [null, '', '[]', 'x', '{}', '{"a":"a"}']) expect(S.readVarNames(bad)).toBeNull();
    expect(S.settingsOptions({ varNames: '{"base_url":"App_Server"}' })).toEqual({ varNames: { base_url: 'App_Server' } });
    expect(S.settingsOptions({})).toEqual({});
  });
});

describe('applyVarNames', () => {
  const make = () => {
    const requests = [{ name: 'A', url: '{{base_url}}/x?u={{ base_url }}&k={{base_url2}}', headers: [{ key: 'H', value: 'v {{base_url}}' }], body: { mode: 'raw', raw: '{"u":"{{base_url}}"}' },
      tests: [{ listen: 'test', script: { exec: ['const u = pm.environment.get("base_url");', "x('base_url'); // base_url", 'pm.variables.replaceIn("{{base_url}}")'] } }] }];
    return { requests, collection: { info: { name: 'base_url' }, item: requests, variable: [{ key: 'auth_url', value: 'https://a' }] }, environmentVars: { base_url: 'https://api', other: '{{base_url}}/z' } };
  };
  test('everywhere it is sent and read, and where its value is; not a look-alike, not other text', () => {
    const o = make();
    expect(S.applyVarNames(o, { base_url: 'App_Server', auth_url: 'Auth_Server' })).toEqual({ base_url: 'App_Server', auth_url: 'Auth_Server' });
    const r = o.requests[0];
    expect(r.url).toBe('{{App_Server}}/x?u={{ App_Server }}&k={{base_url2}}');
    expect(r.headers[0].value).toBe('v {{App_Server}}'); expect(r.body.raw).toBe('{"u":"{{App_Server}}"}');
    expect(r.tests[0].script.exec).toEqual(['const u = pm.environment.get("App_Server");', "x('base_url'); // base_url", 'pm.variables.replaceIn("{{App_Server}}")']);
    expect(o.environmentVars).toEqual({ App_Server: 'https://api', other: '{{App_Server}}/z' });
    expect(o.collection.variable[0].key).toBe('Auth_Server'); expect(o.collection.info.name).toBe('base_url');
  });
  test('refused: unknown, set by a script, a name in use, two the same, a reserved word', () => {
    const t = (names, taken) => { const o = make(); return S.applyVarNames({ ...o, taken }, names); };
    expect(t({ nothing: 'X' })).toEqual({});
    expect(t({ base_url: 'X1' }, ['base_url'])).toEqual({});
    expect(t({ base_url: 'OTHER' })).toEqual({});
    expect(t({ base_url: 'token' }, ['token'])).toEqual({});
    expect(t({ base_url: 'Same', auth_url: 'same' })).toEqual({ base_url: 'Same' });
    expect(t({ base_url: 'load' })).toEqual({});
    expect(t(null)).toEqual({});
  });
  test('JMeter: ${name}, a thread group\'s own variables', () => {
    const tg = new Map([[0, { HOST: 'h', P: '${HOST}' }]]);
    const o = { requests: [{ url: 'https://${HOST}/a', preScripts: [{ code: 'vars.get("HOST")' }] }], collection: { variable: { HOST: 'x' } }, environmentVars: {}, threadGroupVars: tg };
    expect(S.applyVarNames(o, { HOST: 'App_Server' })).toEqual({ HOST: 'App_Server' });
    expect(o.requests[0]).toEqual({ url: 'https://${App_Server}/a', preScripts: [{ code: 'vars.get("App_Server")' }] });
    expect(o.collection.variable).toEqual({ App_Server: 'x' }); expect(tg.get(0)).toEqual({ App_Server: 'h', P: '${App_Server}' });
  });
  test.each(['devweb', 'web-http'])('%s: the generated script uses the new name only, with its value', async (protocol) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-test-')), f = path.join(dir, 'c.json'), e = path.join(dir, 'e.json'), out = path.join(dir, 'out');
    fs.writeFileSync(f, JSON.stringify({ info: { name: 'M', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [{ name: 'a', request: { method: 'GET', url: { raw: '{{base_url}}/a' }, header: [] } }] }));
    fs.writeFileSync(e, JSON.stringify({ values: [{ key: 'base_url', value: 'https://api.example.com', enabled: true }] }));
    const c = new CollectionConverter({ inputFile: f, environmentFile: e, outputDir: out, protocol, mode: 'single', values: { base_url: 'https://test.example.com' }, varNames: { base_url: 'Shop_Server' } });
    await c.convert();
    const all = fs.readdirSync(out).filter((x) => /\.(js|c|yml|prm|dat|csv|usr|h|cfg)$/.test(x)).map((x) => fs.readFileSync(path.join(out, x), 'utf8')).join('\n');
    expect(all).toContain('Shop_Server'); expect(all).not.toContain('base_url'); expect(all).toContain('test.example.com');
    const p = C.buildPreview({ kind: 'pm', ...c.previewSource, files: [], outputDir: out });
    expect(p.variables[0]).toMatchObject({ name: 'Shop_Server', orig: 'base_url', given: true, source: 'environment' });
    expect(p.hosts[0]).toMatchObject({ host: 'test.example.com', vars: ['Shop_Server'] });
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('preview: domain variables and request details', () => {
  test('hostVars', () => {
    expect([C.hostVars('{{base_url}}/x/{{id}}'), C.hostVars('https://{{HOST}}:{{PORT}}/{{id}}'), C.hostVars('https://${HOST}/a'), C.hostVars('https://api.example.com/{{id}}'), C.hostVars('/a'), C.hostVars(null)]).toEqual([['base_url'], ['HOST', 'PORT'], ['HOST'], [], [], []]);
  });
  const d = (r, col) => C.detailsOf(r, col);
  test('headers, body, form, scripts, auth', () => {
    expect(d({ headers: [{ key: 'A', value: '1' }, { key: 'off', value: 'x', disabled: true }], body: { mode: 'raw', raw: '{"a":"{{x}}"}' }, tests: [{ listen: 'prerequest', script: { exec: ['p();'] } }, { listen: 'test', script: { exec: 't();' } }, { listen: 'test', script: { exec: [''] } }], auth: { type: 'bearer' } }))
      .toEqual({ headers: [['A', '1']], body: '{"a":"{{x}}"}', scripts: [['Before the request', 'p();'], ['After the response', 't();']], auth: 'bearer' });
    expect(d({ body: { mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: '/C:/a/b.pdf' }, { key: 'a', value: '1' }, { key: 'o', value: 'x', disabled: true }] } })).toEqual({ form: [['f', 'file: b.pdf'], ['a', '1']] });
    expect(d({ preScripts: [{ code: 'vars.put("a","b")' }], postScripts: ['x()'] })).toEqual({ scripts: [['Before the request', 'vars.put("a","b")'], ['After the response', 'x()']] });
    expect(d({}, { auth: { type: 'noauth' } })).toBeNull(); expect(d({ auth: { type: 'noauth' } }, { auth: { type: 'basic' } })).toBeNull();
  });
  test('a secret written out is not shown; a variable is', () => {
    const r = d({ headers: [{ key: 'Authorization', value: 'Bearer abc' }, { key: 'X-Api-Key', value: '{{key}}' }], body: { mode: 'raw', raw: '{"password":"p1","user":"u","client_secret":"{{s}}"}' } });
    expect(r.headers).toEqual([['Authorization', '(hidden)'], ['X-Api-Key', '{{key}}']]);
    expect(r.body).toBe('{"password":"(hidden)","user":"u","client_secret":"{{s}}"}');
    expect(d({ body: { mode: 'urlencoded', urlencoded: [{ key: 'password', value: 'p' }, { key: 'u', value: 'v' }] } }).form).toEqual([['password', '(hidden)'], ['u', 'v']]);
  });
  test('a long body is cut; the request stays usable', () => {
    expect(d({ body: { mode: 'raw', raw: 'x'.repeat(30000) } }).body).toMatch(/^x{20000}\n… \(10,000 more characters\)$/);
  });
});
