'use strict';

/**
 * Sign-in credentials in generated scripts (web_set_user / load.setUserCredentials), checked against the real
 * VuGen and DevWeb 26.3 engines with a local test server (Basic and NTLM):
 *
 *  - BUG-130: the host argument must be the host name alone on port 80 / 443 (DevWeb does not match "host:443"),
 *    and "host:port" on any other port (neither engine matches the host name alone there). The tools wrote the host
 *    name alone everywhere. They now use the same key as the server parameters (HostParams.hostKey).
 *  - BUG-131: VuGen with UseNativeNTLM=1 and OverrideNTLMCreds=1 together signs in with the Windows account it runs
 *    under and ignores web_set_user. No tool writes OverrideNTLMCreds=1 any more; integrated and native NTLM stay on.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const HostParams = require('../../src/web/public/shared/host-params.js');
const PageResources = require('../../src/web/public/shared/page-resources.js');
const VugenCodegen = require('../../src/web/public/shared/vugen-codegen.js');
const WebHttpScriptGenerator = require('../../src/generators/vugen/scriptGenerator.js');
const DevWebScriptGenerator = require('../../src/generators/devweb/scriptGenerator.js');
const VugenFiles = require('../../src/generators/vugen/filesGenerator.js');
const JmxParser = require('../../src/parsers/jmxParser.js');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8');
const quiet = async (fn) => {
  const spies = ['log', 'warn'].map((k) => jest.spyOn(console, k).mockImplementation(() => {}));
  try { return await fn(); } finally { spies.forEach((s) => s.mockRestore()); }
};
const ini = (text, key) => (new RegExp('^' + key + '=(.*)$', 'm').exec(text) || [])[1];

// ---- converters ---------------------------------------------------------------------------------------------------
const ntlmCollection = { info: { name: 'Auth' }, auth: { type: 'ntlm', ntlm: [{ key: 'username', value: 'perfuser' }, { key: 'password', value: 'x' }] } };
const reqs = (base) => [{ name: 'Home', method: 'GET', url: base + '/', headers: [] }, { name: 'Report', method: 'GET', url: base + '/report', headers: [] }];

async function converterVugen(base) {
  const g = new WebHttpScriptGenerator(reqs(base), ntlmCollection, { thinkTime: 0 });
  g.log = () => {};
  await quiet(() => g.analyze());
  return { ac: g.generateActionC(), vi: g.generateVuserInitC() };
}
async function converterDevweb(base) {
  const g = new DevWebScriptGenerator(reqs(base), ntlmCollection, { thinkTime: 0 });
  return (await quiet(() => g.generate(null))).script;
}

describe('converters: the credentials host (BUG-130)', () => {
  test('port 443: the host name alone (through the server parameter)', async () => {
    const { ac, vi } = await converterVugen('https://intranet.example.com');
    expect(ac).toContain('web_set_user("{username}", "{password}", "{App_Server}");');
    expect(vi).toContain('set_server("App_Server", "intranet.example.com");');
    expect(await converterDevweb('https://intranet.example.com')).toContain("host:     'intranet.example.com'");
  });

  test('another port: host:port — through the server parameter, whose value has the port', async () => {
    const { ac, vi } = await converterVugen('https://intranet.example.com:8443');
    expect(ac).toContain('web_set_user("{username}", "{password}", "{App_Server}");');
    expect(vi).toContain('set_server("App_Server", "intranet.example.com:8443");');
    expect(await converterDevweb('https://intranet.example.com:8443')).toContain("host:     'intranet.example.com:8443'");
  });

  test('a default port written out (":443") is left off — DevWeb does not match "host:443"', async () => {
    expect(await converterDevweb('https://intranet.example.com:443')).toContain("host:     'intranet.example.com'");
    expect(await converterDevweb('http://intranet.example.com:80')).toContain("host:     'intranet.example.com'");
  });

  test('a server given as a variable keeps the old fallback (no crash, no invented host)', async () => {
    const g = new DevWebScriptGenerator([{ name: 'Home', method: 'GET', url: '{{base_url}}/home', headers: [] }], ntlmCollection, { thinkTime: 0 });
    const js = (await quiet(() => g.generate(null))).script;
    expect(js).toContain('load.setUserCredentials');
    expect(js).not.toMatch(/host:\s+'[^']*:\d+'/);
  });
});

describe('JMX: the AuthManager URL gives host:port only for another port (BUG-130)', () => {
  const jmx = (authUrl) => `<?xml version="1.0" encoding="UTF-8"?>
<jmeterTestPlan version="1.2" properties="5.0" jmeter="5.6"><hashTree>
<TestPlan guiclass="TestPlanGui" testclass="TestPlan" testname="Plan" enabled="true"/><hashTree>
<ThreadGroup guiclass="ThreadGroupGui" testclass="ThreadGroup" testname="TG" enabled="true"/><hashTree>
<AuthManager guiclass="AuthPanel" testclass="AuthManager" testname="Auth" enabled="true"><collectionProp name="AuthManager.auth_list">
<elementProp name="" elementType="Authorization"><stringProp name="Authorization.url">${authUrl}</stringProp>
<stringProp name="Authorization.username">perfuser</stringProp><stringProp name="Authorization.password">x</stringProp>
<stringProp name="Authorization.domain">TEST</stringProp><stringProp name="Authorization.realm"></stringProp>
<stringProp name="Authorization.mechanism">BASIC_DIGEST</stringProp></elementProp></collectionProp></AuthManager><hashTree/>
<HTTPSamplerProxy guiclass="HttpTestSampleGui" testclass="HTTPSamplerProxy" testname="Home" enabled="true">
<stringProp name="HTTPSampler.domain">intranet.example.com</stringProp><stringProp name="HTTPSampler.protocol">https</stringProp>
<stringProp name="HTTPSampler.path">/</stringProp><stringProp name="HTTPSampler.method">GET</stringProp></HTTPSamplerProxy><hashTree/>
</hashTree></hashTree></hashTree></jmeterTestPlan>`;

  async function hostportOf(authUrl) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authhost-'));
    try {
      const f = path.join(dir, 't.jmx');
      fs.writeFileSync(f, jmx(authUrl));
      const p = new JmxParser(f);
      await quiet(() => p.parse());
      const found = [];
      (function walk(o) {
        if (!o || typeof o !== 'object') return;
        if (o.auth && o.auth.hostport !== undefined) found.push(o.auth.hostport);
        Object.values(o).forEach(walk);
      })(p.collection);
      return found[0];
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }

  test.each([
    ['https://intranet.example.com:8443/', 'intranet.example.com:8443'],
    ['https://intranet.example.com/', 'intranet.example.com'],
    ['https://intranet.example.com:443/', 'intranet.example.com'],
    ['http://intranet.example.com:8080', 'intranet.example.com:8080'],
    ['', ''],
  ])('%s -> %s', async (url, want) => {
    expect(await hostportOf(url)).toBe(want);
  });
});

describe('converter VuGen default.cfg for NTLM / Kerberos (BUG-131)', () => {
  test('integrated and native NTLM on, OverrideNTLMCreds off — so web_set_user is used', () => {
    const cfg = new VugenFiles({ scriptName: 'T' }).generateDefaultCfg(null, true);
    expect([ini(cfg, 'IntegratedAuthentication'), ini(cfg, 'UseNativeNTLM'), ini(cfg, 'OverrideNTLMCreds')]).toEqual(['1', '1', '0']);
  });
  test('without Windows sign-in all three stay off', () => {
    const cfg = new VugenFiles({ scriptName: 'T' }).generateDefaultCfg(null, false);
    expect([ini(cfg, 'IntegratedAuthentication'), ini(cfg, 'UseNativeNTLM'), ini(cfg, 'OverrideNTLMCreds')]).toEqual(['0', '0', '0']);
  });
  test('WebRecorderVersion is written, as by the Recorder and Script Studio — without it VuGen answers NTLM with Basic (BUG-132)', () => {
    for (const ntlm of [true, false]) expect(ini(new VugenFiles({ scriptName: 'T' }).generateDefaultCfg(null, ntlm), 'WebRecorderVersion')).toBe('10');
  });
});

// ---- Recorder and Script Studio -------------------------------------------------------------------------------------
let nextId = 1;
function ent(url, o = {}) {
  return Object.assign({
    id: nextId++, url, method: 'GET', status: 200, ct: 'text/html', size: 10, dur: 5, startMs: 0, reqHdrs: [], hdrsMap: {},
    respHdrsMap: {}, body: null, referer: '', _resourceType: 'document', respBody: '', pageref: null, isMarker: false,
    markerType: null, txnName: null, txn: null, filtered: false,
  }, o);
}
const challenge = (url, scheme) => ent(url, { status: 401, respHdrsMap: { 'www-authenticate': scheme } });

function loadRecorder() {
  // eslint-disable-next-line no-new-func
  return new Function('PageResources', 'HostParams',
    read('VuGen-Recorder-state.js') + '\n' + read('VuGen-Recorder-templates.js') + '\n' + read('VuGen-Recorder-ui.js') + '\n' + read('VuGen-Recorder-generators.js')
    + '\nreturn { S, buildScripts, detectAuth, detectCorporateAuth, genDefaultCfg };')(PageResources, HostParams);
}
function loadStudio() {
  // eslint-disable-next-line no-new-func
  return new Function('PageResources', 'HostParams', 'VugenCodegen', 'VUGEN_TEMPLATES',
    read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') + '\n' + read('studio-codegen.js')
    + '\nreturn { S, genActionC, genMainJS, genDefaultCfg, detectAuth, detectCorporateAuth };')(PageResources, HostParams, VugenCodegen, {});
}

describe.each([['Recorder', 'recorder'], ['Script Studio', 'studio']])('%s: the credentials host (BUG-130)', (tool, kind) => {
  function scripts(base, scheme) {
    const entries = [challenge(base + '/', scheme), ent(base + '/'), ent(base + '/report')];
    if (kind === 'recorder') {
      const r = loadRecorder();
      r.S.entries = entries;
      r.S.format = 'both';
      r.buildScripts();
      return { ac: r.S.scripts.ac, vi: r.S.scripts.vi, mj: r.S.scripts.mj, auth: r.S.auth };
    }
    const r = loadStudio();
    r.S.entries1 = entries;
    r.S.correlations = [];
    r.S.params = [];
    r.S.auth = r.detectCorporateAuth(entries, r.detectAuth(entries));
    return { ac: r.genActionC(entries, []), mj: r.genMainJS(entries, []), auth: r.S.auth };
  }

  test('auth detection keeps the server key: the port only when it is not the default', () => {
    expect(scripts('https://intranet.example.com:8443', 'NTLM').auth.hostKey).toBe('intranet.example.com:8443');
    expect(scripts('https://intranet.example.com', 'NTLM').auth.hostKey).toBe('intranet.example.com');
  });

  test('port 443: VuGen and DevWeb get the host name alone (or its server parameter)', () => {
    const s = scripts('https://intranet.example.com', 'NTLM');
    expect(s.ac).toMatch(/web_set_user\("\{username\}", "\{password\}", "(\{App_Server\}|intranet\.example\.com)"\);/);
    expect(s.mj).toMatch(/host: ("intranet\.example\.com"|App_Server)\n/);
  });

  test('another port: host:port, or the server parameter whose value has the port', () => {
    const s = scripts('https://intranet.example.com:8443', 'NTLM');
    const vuser = /web_set_user\("\{username\}", "\{password\}", "([^"]+)"\);/.exec(s.ac)[1];
    expect(['{App_Server}', 'intranet.example.com:8443']).toContain(vuser);
    if (vuser === '{App_Server}' && s.vi) expect(s.vi).toContain('"intranet.example.com:8443"');
    expect(s.mj).toMatch(/host: ("intranet\.example\.com:8443"|App_Server)\n/);
    expect(s.ac).not.toContain('"intranet.example.com");');
  });

  test('Basic sign-in in DevWeb still matches every host ("*")', () => {
    expect(scripts('https://shop.example.com:8443', 'Basic realm="x"').mj).toContain('host: "*"');
  });
});

describe.each([['Recorder', loadRecorder], ['Script Studio', loadStudio]])('%s default.cfg for NTLM / Kerberos (BUG-131)', (tool, load) => {
  test('NTLM: integrated and native NTLM on, OverrideNTLMCreds off', () => {
    const cfg = load().genDefaultCfg({ type: 'ntlm', host: 'intranet.example.com' });
    expect([ini(cfg, 'IntegratedAuthentication'), ini(cfg, 'UseNativeNTLM'), ini(cfg, 'OverrideNTLMCreds')]).toEqual(['1', '1', '0']);
  });
  test('Kerberos: integrated on, as before', () => {
    const cfg = load().genDefaultCfg({ type: 'kerberos', host: 'intranet.example.com' });
    expect([ini(cfg, 'IntegratedAuthentication'), ini(cfg, 'OverrideNTLMCreds')]).toEqual(['1', '0']);
  });
});
