'use strict';

/**
 * Script Studio — layout of the generated scripts and the DPoP / PKCE fixes found by replaying them with the real
 * LoadRunner engines (VuGen mdrv.exe and DevWeb.exe through a local test proxy):
 *
 *  - vuser_init: the servers (set_server, overridable in Runtime Settings), the SSL setting and the headers EVERY step
 *    sent with the same value; the user agent goes to default.cfg (Runtime Settings > Browser Emulation)
 *  - DPoP: one fresh proof right before each request (BUG-094: batched proofs were never written without transaction
 *    markers, and their "ath" carried the parameter's name); the proof URL is the URL the script sends (correlated
 *    parts included); "ath" only when the request presents a token — the token it sends
 *  - "Simulate a new user on each iteration" empties the JavaScript engine: Action loads lre-utils.js again (BUG-092)
 *  - long bodies are split between escape sequences only (BUG-091)
 *  - DevWeb: Basic sign-in credentials read inside the action (load.params does not exist at module level);
 *    the recorded Negotiate / NTLM handshake is never sent as a fixed header
 */

const fs = require('fs');
const path = require('path');
const PageResources = require('../../src/web/public/shared/page-resources.js');
const HostParams = require('../../src/web/public/shared/host-params.js');
const VugenCodegen = require('../../src/web/public/shared/vugen-codegen.js');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8');

function loadStudio() {
  // eslint-disable-next-line no-new-func
  const factory = new Function('PageResources', 'HostParams', 'VugenCodegen', 'VUGEN_TEMPLATES',
    read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') + '\n' + read('studio-codegen.js') +
    '\nreturn { S, genActionC, genVuserInit, genMainJS, genDefaultCfg, _cChunks, _cUrlToJs, escBodyBinary: typeof escBodyBinary === "function" ? escBodyBinary : null };');
  return factory(PageResources, HostParams, VugenCodegen, {});
}

let nextId = 1;
function ent(url, o = {}) {
  const reqHdrs = o.reqHdrs || [];
  const hdrsMap = {};
  reqHdrs.forEach((h) => { hdrsMap[h.name.toLowerCase()] = h.value; });
  return Object.assign({
    id: nextId++, url, method: 'GET', status: 200, ct: 'application/json', size: 10, dur: 5, startMs: 0,
    reqHdrs, hdrsMap, respHdrsMap: {}, body: null, _resourceType: '', respBody: '', isMarker: false, filtered: false, txn: null,
  }, o, { reqHdrs, hdrsMap });
}
const H = (pairs) => pairs.map(([name, value]) => ({ name, value }));
const proof = (htu, htm) => 'eyJ0eXAiOiJkcG9wK2p3dCJ9.' + Buffer.from(JSON.stringify({ htu, htm })).toString('base64url') + '.sig';

function generate(r, entries, correlations = []) {
  r.S.entries1 = entries;
  r.S.correlations = correlations;
  r.S.params = r.S.params || [];
  const ac = r.genActionC(entries, correlations);
  const vi = r.genVuserInit();
  const mj = r.genMainJS(entries, correlations);
  return { ac, vi, mj };
}

describe('Studio scripts — vuser_init layout', () => {
  test('servers, SSL setting and every-request headers in vuser_init; user agent in default.cfg; Action points there', () => {
    const r = loadStudio();
    const hdrs = H([['User-Agent', 'UA/1'], ['Accept-Language', 'en'], ['X-Env', 'perf']]);
    const { ac, vi } = generate(r, [
      ent('https://shop.example.com/', { _resourceType: 'document', ct: 'text/html', reqHdrs: hdrs }),
      ent('https://api.example.com/v1/items', { _resourceType: 'fetch', reqHdrs: hdrs.concat(H([['Origin', 'https://shop.example.com']])) }),
    ]);
    expect(vi).toContain('void set_server(char *name, char *recorded)');
    expect(vi).toContain('\tset_server("App_Server", "shop.example.com");\t// main application\n\tset_server("Api_Server", "api.example.com");\n');
    expect(vi).toContain('\tweb_set_sockets_option("SSL_VERSION", "AUTO");\n');
    expect(vi).toContain('\tweb_add_auto_header("Accept-Language", "en");\n\tweb_add_auto_header("X-Env", "perf");\n');
    expect(vi).not.toMatch(/User-Agent|Origin/);
    expect(ac).toContain('// Set in vuser_init: the servers ({App_Server}, {Api_Server}), the SSL setting and the headers every request sends');
    expect(ac).not.toMatch(/web_set_sockets_option|web_add_auto_header|lr_save_string\("|"User-Agent"/);
    expect(ac).toContain('"URL=https://{Api_Server}/v1/items"');
    expect(ac).toContain('web_add_header("Origin", "https://{App_Server}");');
    expect(ac).toMatch(/web_url\("items",[\s\S]*?"Mode=HTTP",/);       // a call made by JavaScript
    expect(ac).toMatch(/web_url\("shop",[\s\S]*?"Mode=HTML",/);        // a page the browser opened
    expect(r.genDefaultCfg(null)).toMatch(/^CustomUserAgent=UA\/1$/m);
  });
});

describe('Studio scripts — DPoP proofs (checked against a DPoP verifier with VuGen and DevWeb)', () => {
  const tokenUrl = 'https://api.example.com/oauth/token';
  const accUrl = 'https://api.example.com/v1/accounts/AC-1/balance';
  function dpopRecording() {
    return [
      ent(tokenUrl, { method: 'POST', reqHdrs: H([['DPoP', proof(tokenUrl, 'POST')], ['Content-Type', 'application/x-www-form-urlencoded']]),
        body: { mimeType: 'application/x-www-form-urlencoded', text: 'grant_type=client_credentials' } }),
      ent(accUrl, { reqHdrs: H([['DPoP', proof(accUrl, 'GET')], ['Authorization', 'Bearer rec.tok.en']]) }),
    ];
  }

  test('no transaction markers: every request still gets its own proof, written right before it', () => {
    const r = loadStudio();
    r.S.hasDpop = true; r.S.dpopTokenVar = 'AccessToken';
    const { ac } = generate(r, dpopRecording());
    expect(ac).not.toMatch(/_dpop_proof_\d|generateDpopProofs/);       // no batch parameters left
    expect((ac.match(/"Code=generateDpopProof\(/g) || []).length).toBe(2);
    // the token request presents no token: no ath
    expect(ac).toContain("\"Code=generateDpopProof('https://' + LR.getParam('Api_Server') + '/oauth/token', 'POST');\"");
    // a recorded (not correlated) token: ath of exactly that token
    expect(ac).toContain("'/v1/accounts/AC-1/balance', 'GET', 'rec.tok.en');\"");
    // proof right before the header and the request it belongs to
    expect(ac).toMatch(/generateDpopProof\([^\n]*balance[^\n]*\n\t\t"ResultParam=_dpop_proof",\n\t\tLAST\);\n[\s\S]*?web_add_header\("Dpop", "\{_dpop_proof\}"\);\n[\s\S]*?web_url\("balance"/);
  });

  test('the proof URL is the URL the script sends: a correlated path part is read from its parameter', () => {
    const r = loadStudio();
    r.S.hasDpop = true; r.S.dpopTokenVar = 'AccessToken';
    const rec = dpopRecording();
    const corrs = [
      { name: 'AccessToken', sourceIdx: 0, extractorType: 'jsonpath', extractorConfig: { path: '$.access_token' },
        usages: [{ reqIdx: 1, location: 'header', key: 'Authorization', prefix: 'Bearer ', originalValue: 'rec.tok.en' }] },
      { name: 'AccountId', sourceIdx: 0, extractorType: 'jsonpath', extractorConfig: { path: '$.account' },
        usages: [{ reqIdx: 1, location: 'url_path_seg', originalValue: 'AC-1' }] },
    ];
    const { ac } = generate(r, rec, corrs);
    expect(ac).toContain("\"Code=generateDpopProof('https://' + LR.getParam('Api_Server') + '/v1/accounts/' + LR.getParam('AccountId') + '/balance', 'GET', LR.getParam('AccessToken'));\"");
  });

  test('"Simulate a new user" empties the JavaScript engine: Action loads lre-utils.js again, before the first proof', () => {
    const r = loadStudio();
    r.S.hasDpop = true; r.S.dpopTokenVar = 'AccessToken';
    const { ac, vi } = generate(r, dpopRecording());
    expect(ac).toMatch(/web_js_run\(\n\t\t"Code=initDpopKey\(LR\.getParam\('dpop_jwk'\)\); 'DPoP engine ready';",\n\t\t"ResultParam=dpop_init_result",\n\t\tSOURCES,\n\t\t"File=lre-utils\.js", ENDITEM,/);
    expect(ac.indexOf("'DPoP engine ready'")).toBeLessThan(ac.indexOf('generateDpopProof'));
    expect(vi).toContain("initDpopKey(LR.getParam('dpop_jwk')); 'DPoP engine initialized successfully';");   // still checked once at start
  });

  test('DevWeb: proof URL as sent, ath only with a token, the header is the proof variable', () => {
    const r = loadStudio();
    r.S.hasDpop = true; r.S.dpopTokenVar = 'AccessToken';
    const { mj } = generate(r, dpopRecording());
    expect(mj).toContain("load.global.dpop_proof = getDpopProof(`https://${Api_Server}/oauth/token`, 'POST', load.global.dpop_jwk);");
    expect(mj).toContain("load.global.dpop_proof = getDpopProof(`https://${Api_Server}/v1/accounts/AC-1/balance`, 'GET', load.global.dpop_jwk, 'rec.tok.en');");
  });
});

describe('Studio scripts — PKCE, bodies, DevWeb sign-in', () => {
  test('PKCE: generatePkce() loads lre-utils.js itself on every iteration', () => {
    const r = loadStudio();
    r.S.hasPkce = true;
    const { ac } = generate(r, [ent('https://login.example.com/authorize?code_challenge=x')]);
    expect(ac).toMatch(/"Code=generatePkce\(\);",\n\t\t"ResultParam=pkce_verifier",\n\t\tSOURCES,\n\t\t"File=lre-utils\.js", ENDITEM,\n\t\tLAST\);/);
  });

  test('long bodies are split between escape sequences only (BUG-091)', () => {
    const r = loadStudio();
    const esc = 'x'.repeat(198) + '\\\\\\"' + 'y'.repeat(50) + '\\xC3\\xA9';     // "\\" and "\"" straddling the 200 mark
    const chunks = r._cChunks(esc, 200);
    expect(chunks.join('')).toBe(esc);
    chunks.forEach((c) => expect(c).toMatch(/^(?:[^\\]|\\[\\"ntr]|\\x[0-9A-F]{2})*$/));
    expect(chunks[0]).toBe('x'.repeat(198) + '\\\\');
  });

  test('a {Param} URL as a JavaScript expression for web_js_run', () => {
    const r = loadStudio();
    expect(r._cUrlToJs("https://{Host_a}/x/{Id}/y'z")).toBe("'https://' + LR.getParam('Host_a') + '/x/' + LR.getParam('Id') + '/y\\'z'");
    expect(r._cUrlToJs('{Only}')).toBe("LR.getParam('Only')");
  });

  test('DevWeb Basic sign-in: credentials set inside the action — load.params does not exist at module level', () => {
    const r = loadStudio();
    r.S.auth = { type: 'basic', host: 'shop.example.com' };
    const b64 = Buffer.from('user:pass').toString('base64');
    r.S.params = [{ name: 'username', csvKey: 'username', value: 'user', usages: [] }, { name: 'password', csvKey: 'password', value: 'pass', usages: [] }];
    const { mj } = generate(r, [ent('https://shop.example.com/secure', { reqHdrs: H([['Authorization', 'Basic ' + b64]]) })]);
    const action = mj.indexOf('load.action("Action"');
    if (mj.includes('encodedCredentials')) {
      expect(mj).toMatch(/^let encodedCredentials = '';/m);
      expect(mj.indexOf('encodedCredentials = btoa(')).toBeGreaterThan(action);
    }
    expect(mj.slice(0, action)).not.toMatch(/load\.params\./);
  });

  test('DevWeb: a recorded Negotiate / NTLM handshake is never sent as a fixed header', () => {
    const r = loadStudio();
    r.S.auth = { type: 'ntlm', host: 'intranet.example.com' };
    const { mj } = generate(r, [ent('https://intranet.example.com/', { reqHdrs: H([['Authorization', 'NTLM TlRMTVNTUAABAAAA']]) })]);
    expect(mj).not.toContain('TlRMTVNTUAABAAAA');
  });
});
