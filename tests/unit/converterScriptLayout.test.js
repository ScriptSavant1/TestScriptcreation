'use strict';

/**
 * Postman / Bruno / JMeter converter — script layout, the same rules as the Recorder and Script Studio:
 *   - servers are named by role (App_Server, Api_Server, Auth_Server …), the longest name replaced first, and only the
 *     servers the script uses are declared (VuGen: set_server in vuser_init, DevWeb: const);
 *   - VuGen: the SSL setting and the headers every request sends are set once in vuser_init;
 *   - a header is global only when EVERY request sends it with one value, and never Authorization /
 *     Cookie / DPoP / Origin / CSRF (an Authorization auto header was set before the token existed and
 *     sent the literal "{access_token}" in the first iteration — checked with VuGen);
 *   - think time between steps, none after the last; VuGen Mode=HTTP (API calls).
 */

const WebHttpScriptGenerator = require('../../src/generators/vugen/scriptGenerator.js');
const DevWebScriptGenerator = require('../../src/generators/devweb/scriptGenerator.js');

const H = (key, value) => ({ key, value });
function requests() {
  return [
    { name: 'Get Token', method: 'POST', url: 'https://auth.shop.com/oauth/token',
      headers: [H('Accept', 'application/json'), H('X-Client', 'web')],
      body: { mode: 'urlencoded', urlencoded: [{ key: 'grant_type', value: 'client_credentials' }] } },
    { name: 'List Orders', method: 'GET', url: 'https://api.shop.com/orders',
      headers: [H('Accept', 'application/json'), H('X-Client', 'web'), H('Authorization', 'Bearer {{access_token}}')] },
    { name: 'Get Order', method: 'GET', url: 'https://api.shop.com/orders/1',
      headers: [H('Accept', 'application/json'), H('Authorization', 'Bearer {{access_token}}')] },
  ];
}
const COLLECTION = { info: { name: 'Layout Test' } };

async function vugen(opts = {}) {
  const g = new WebHttpScriptGenerator(requests(), COLLECTION, { thinkTime: 2, ...opts });
  g.log = () => {};
  await g.analyze();
  const action = g.generateActionC();
  const init = g.generateVuserInitC();
  return { g, action, init };
}

describe('converter VuGen — vuser_init holds the servers, the SSL setting and the common headers', () => {
  let out;
  beforeAll(async () => { out = await vugen(); });

  test('servers are named from the domain and set once in vuser_init (Runtime Settings can override)', () => {
    expect(out.init).toContain('void set_server(char *name, char *value_here)');
    expect(out.init).toContain('set_server("Api_Server", "api.shop.com");');
    expect(out.init).toContain('set_server("Auth_Server", "auth.shop.com");');
    expect(out.action).toContain('"URL=https://{Api_Server}/orders"');
    expect(out.action).toContain('"URL=https://{Auth_Server}/oauth/token"');
    expect(out.action).not.toMatch(/lr_save_string\("[^"]*shop\.com"/);
  });

  test('the SSL setting is in vuser_init, not in Action', () => {
    expect(out.init).toContain('web_set_sockets_option("SSL_VERSION", "AUTO");');
    expect(out.action).not.toContain('web_set_sockets_option');
  });

  test('a header every request sends with one value is an auto header in vuser_init', () => {
    expect(out.init).toContain('web_add_auto_header("Accept", "application/json");');
    expect(out.action).not.toContain('web_add_auto_header');
    expect(out.action).not.toContain('web_add_header("Accept"');
  });

  test('a header only some requests send stays on those requests', () => {
    expect(out.init).not.toContain('"X-Client"');
    expect((out.action.match(/web_add_header\("X-Client", "web"\)/g) || []).length).toBe(2);
  });

  test('Authorization is never global — the token request sends none, the others send the token', () => {
    expect(out.init).not.toContain('Authorization');
    const tokenStep = out.action.slice(0, out.action.indexOf('lr_end_transaction'));
    expect(tokenStep).not.toContain('Authorization');
    expect((out.action.match(/web_add_header\("Authorization", "Bearer \{access_token\}"\)/g) || []).length).toBe(2);
  });

  test('think time between steps only, and API calls use Mode=HTTP', () => {
    expect((out.action.match(/lr_think_time\(2\)/g) || []).length).toBe(2);
    const last = out.action.lastIndexOf('lr_end_transaction');
    expect(out.action.slice(last)).not.toContain('lr_think_time');
    expect(out.action).not.toContain('Mode=HTML');
    expect((out.action.match(/"Mode=HTTP"/g) || []).length).toBe(3);
  });

  test('one indentation step (4 spaces) for the transactions and requests', () => {
    expect(out.action).toMatch(/^ {4}lr_start_transaction\(/m);
    expect(out.action).not.toMatch(/^ {6}lr_(start|end)_transaction\(/m);
    expect(out.action).toMatch(/^ {4}return 0;/m);
  });

  test('a parameter used only in an auto header is still declared', async () => {
    const g = new WebHttpScriptGenerator(
      requests().map((r) => ({ ...r, headers: [...r.headers, H('X-Tenant', '{{tenant}}')] })),
      { ...COLLECTION, variable: [{ key: 'tenant', value: 't1' }] }, { thinkTime: 0 });
    g.log = () => {};
    await g.analyze();
    const action = g.generateActionC();
    g.scanForUndeclaredParams(action + (g._autoHeaderBlock || ''));
    expect(g._autoHeaderBlock).toContain('web_add_auto_header("X-Tenant", "{tenant}")');
    expect(g.parameters.has('tenant')).toBe(true);
  });
});

describe('converter server names — longest first, only the used ones', () => {
  test('applyHostVars never half-replaces a longer host name', async () => {
    const g = new WebHttpScriptGenerator([
      { name: 'A', method: 'GET', url: 'https://shop.com/', headers: [] },
      { name: 'B', method: 'GET', url: 'https://api.shop.com/x', headers: [] },
    ], COLLECTION, {});
    g.log = () => {};
    await g.analyze();
    expect(g.applyHostVars('https://api.shop.com/x')).toBe(`https://{${g.hostVarMap.get('api.shop.com')}}/x`);
    expect(g.applyHostVars('https://shop.com/')).toBe(`https://{${g.hostVarMap.get('shop.com')}}/`);
  });

  test('VuGen declares no server the script does not use', async () => {
    const g = new WebHttpScriptGenerator([
      { name: 'A', method: 'GET', url: '{{base_url}}/a', headers: [H('X-Ref', 'https://other.example.org/ns')] },
    ], { ...COLLECTION, variable: [{ key: 'base_url', value: 'https://api.shop.com' }] }, {});
    g.log = () => {};
    await g.analyze();
    const action = g.generateActionC();
    const init = g.generateVuserInitC();
    for (const [, v] of g.hostVarMap) {
      if (!action.includes(`{${v}}`)) expect(init).not.toContain(`set_server("${v}"`);
    }
  });

  test('DevWeb: servers as const <Role>_Server, only the used ones, think time with load.thinkTime', async () => {
    const g = new DevWebScriptGenerator(requests(), COLLECTION, { thinkTime: 2 });
    const res = await g.generate(null);
    const js = res.script;
    expect(js).toContain("const Api_Server = load.config.user.args[\"Api_Server\"] || 'api.shop.com';");
    expect(js).toContain("const Auth_Server = load.config.user.args[\"Auth_Server\"] || 'auth.shop.com';");
    expect(js).not.toMatch(/SERVER_HOST/);
    for (const m of js.matchAll(/^const (\w+) = load\.config\.user\.args/gm)) expect(js).toContain('${' + m[1] + '}');
    expect((js.match(/load\.thinkTime\(2\)/g) || []).length).toBe(2);
    expect(js).not.toContain('load.sleep(');
  });

  test('DevWeb: a header only some requests send is not a default for all', async () => {
    const g = new DevWebScriptGenerator(requests(), COLLECTION, { thinkTime: 0 });
    const js = (await g.generate(null)).script;
    const defaults = js.slice(js.indexOf('load.WebRequest.defaults'), js.indexOf('load.initialize'));
    expect(defaults).not.toContain('X-Client');
    expect((js.match(/"X-Client": "web"/g) || []).length).toBe(2);
  });
});

describe('converter — collection values that broke the generated script', () => {
  const quiet = async (fn) => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };

  test('DevWeb: a form-data body becomes real MultipartBody entries (was a literal "[...]" syntax error)', async () => {
    const g = new DevWebScriptGenerator([{
      name: 'Upload', method: 'POST', url: 'https://api.shop.com/up', headers: [],
      body: { mode: 'formdata', formdata: [
        { key: 'grant_type', value: 'code', type: 'text' },
        { key: 'off', value: 'x', type: 'text', disabled: true },
        { key: 'doc', type: 'file', src: 'C:\\data\\report.pdf' },
      ] },
    }], COLLECTION, { thinkTime: 0 });
    const js = (await quiet(() => g.generate(null))).script;
    expect(js).toContain('new load.MultipartBody([new load.MultipartBody.StringEntry("grant_type", "code"), ' +
      'new load.MultipartBody.FileEntry("doc", "./report.pdf")])');
    expect(js).not.toContain('[...]');
    expect(js).not.toContain('"off"');
    expect(() => new Function(js.replace(/^import .*$/gm, ''))).not.toThrow();
  });

  test('DevWeb: a variable declared with an empty value sends nothing (was a literal "{{site}}" in the URL)', async () => {
    const g = new DevWebScriptGenerator([
      { name: 'Init', method: 'GET', url: '{{url}}{{site}}/services/init', headers: [] },
    ], { ...COLLECTION, variable: [{ key: 'url', value: 'https://login.example.com' }, { key: 'site', value: '' }] },
    { thinkTime: 0 });
    const js = (await quiet(() => g.generate(null))).script;
    expect(js).not.toContain('{{site}}');
    expect(js).toMatch(/"url": `\$\{load\.config\.user\.args\["url"\]\}\/services\/init`/);
  });

  test('a URL with a trailing line break is trimmed (VuGen C string broke, compile error)', () => {
    const BrunoParser = require('../../src/parsers/brunoParser.js');
    const p = Object.create(BrunoParser.prototype);
    expect(p.normalizeUrl({ raw: '{{base}}/records/:id\n' })).toBe('{{base}}/records/:id');
    expect(p.normalizeUrl('  https://a.example.com/x \r\n')).toBe('https://a.example.com/x');
  });

  test('DevWeb rts.yml: a value YAML would misread (e.g. {{vault:key}}) is quoted, plain values are unchanged', () => {
    const FG = require('../../src/generators/devweb/filesGenerator.js');
    const y = Object.create(FG.prototype)._formatUserArguments({
      url: 'https://login.example.com', clientId: '{{vault:consumer-key}}', note: "it's: odd", n: '5',
    });
    expect(y).toContain('  url: https://login.example.com\n');
    expect(y).toContain("  clientId: '{{vault:consumer-key}}'\n");
    expect(y).toContain("  note: 'it''s: odd'\n");
    expect(y).toContain('  n: 5\n');
    const yaml = require('js-yaml');
    expect(yaml.load('a:' + y).a.clientId).toBe('{{vault:consumer-key}}');
  });
});

describe('converter — XML correlations, Windows sign-in, server overrides', () => {
  const quiet = async (fn) => { const l = console.log; console.log = () => {}; try { return await fn(); } finally { console.log = l; } };
  const xmlRequests = () => [
    { name: 'Create Batch', method: 'POST', url: 'https://api.example.com/job/7/batch', headers: [], body: { mode: 'raw', raw: '<batch/>' },
      tests: [{ listen: 'test', script: { exec: ['var xmlTree = xml2Json(pm.response.text());',
        "pm.collectionVariables.set('_batchId', xmlTree['batchInfo']['id']);"] } }] },
    { name: 'Batch Result', method: 'GET', url: 'https://api.example.com/job/7/batch/{{_batchId}}/result', headers: [] },
  ];

  test('BUG-103: xml2Json(...) values are XPath — plain names for DevWeb, local-name() for VuGen (both checked with the engines)', async () => {
    const D = require('../../src/analyzers/correlationDetector.js');
    const d = Object.create(D.prototype);
    const [v] = d.extractSetVariables("var t = xml2Json(pm.response.text());\npm.environment.set('_batchId', t['batchInfo']['id']);");
    expect(v).toMatchObject({ extractorType: 'xpath', xpathQuery: '/batchInfo/id' });
    expect(d.extractSetVariables("var r = xml2Json(responseBody); pm.environment.set('x', r['soapenv:Envelope'].items[1].name);")[0].xpathQuery)
      .toBe('/Envelope/items[2]/name');

    const vg = new WebHttpScriptGenerator(xmlRequests(), COLLECTION, { thinkTime: 0, useCorrelation: true });
    vg.log = () => {};
    await quiet(() => vg.analyze());
    const ac = vg.generateActionC();
    expect(ac).toContain(`web_reg_save_param_xpath("ParamName=_batchId",\n        "QueryString=/*[local-name()='batchInfo']/*[local-name()='id']",`);
    expect(ac).not.toContain('web_reg_save_param_json("ParamName=_batchId"');

    const dw = new DevWebScriptGenerator(xmlRequests(), COLLECTION, { thinkTime: 0, useCorrelation: true });
    const js = (await quiet(() => dw.generate(null))).script;
    expect(js).toContain('new load.XpathExtractor("_batchId", "/batchInfo/id")');
  });

  test('VuGen XPath: a plain element path gets local-name(); anything else is kept', () => {
    const g = Object.create(WebHttpScriptGenerator.prototype);
    expect(g._vugenXpath('//token')).toBe("//*[local-name()='token']");
    expect(g._vugenXpath('//div[@class="x"]')).toBe('//div[@class="x"]');
  });

  test('NTLM: web_set_user is in Action (every iteration), with the server parameter; collection-level auth is inherited', async () => {
    const reqs = [
      { name: 'Home', method: 'GET', url: 'https://intranet.example.com/', headers: [] },
      { name: 'Report', method: 'GET', url: 'https://intranet.example.com/report', headers: [] },
    ];
    const col = { ...COLLECTION, auth: { type: 'ntlm', ntlm: [{ key: 'username', value: 'perfuser' }, { key: 'password', value: 'x' }] } };
    const g = new WebHttpScriptGenerator(reqs, col, { thinkTime: 0 });
    g.log = () => {};
    await quiet(() => g.analyze());
    const ac = g.generateActionC();
    const vi = g.generateVuserInitC();
    expect(ac).toContain('web_set_user("{username}", "{password}", "{App_Server}");');
    expect(ac.indexOf('web_set_user')).toBeLessThan(ac.indexOf('lr_start_transaction'));
    expect(vi).not.toContain('web_set_user');
    expect(vi).toContain('set_server("App_Server", "intranet.example.com");');
    expect(ac).toContain('// Set in vuser_init: the servers and the SSL setting\n');
  });

  test('DevWeb: a user argument with the server name wins (rts.yml userArguments / -userArgs)', async () => {
    const g = new DevWebScriptGenerator([{ name: 'Home', method: 'GET', url: 'https://shop.example.com/', headers: [] }], COLLECTION, { thinkTime: 0 });
    const js = (await quiet(() => g.generate(null))).script;
    expect(js).toContain("const App_Server = load.config.user.args[\"App_Server\"] || 'shop.example.com';");
    expect(js).toContain('// name (rts.yml userArguments, or -userArgs) — it wins over the value here');
  });
});

describe('HostParams.usedKeys — only the servers a script writes are declared', () => {
  const HostParams = require('../../src/web/public/shared/host-params.js');
  test('a planned server that appears in no {Name} / ${Name} is not used', () => {
    const p = { keys: ['a.example.com', 'ads.example.net'], map: { 'a.example.com': 'Host_a', 'ads.example.net': 'Host_ads' } };
    expect(HostParams.usedKeys(p, 'web_url("x", "URL=https://{Host_a}/")')).toEqual(['a.example.com']);
    expect(HostParams.usedKeys(p, 'url: `https://${Host_ads}/`')).toEqual(['ads.example.net']);
    expect(HostParams.usedKeys(p, 'nothing')).toEqual([]);
    expect(HostParams.usedKeys(null, 'x')).toEqual([]);
  });
});
