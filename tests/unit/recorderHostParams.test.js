'use strict';

/**
 * Recorder — server (host) parameters.
 *
 *  1. shared/host-params.js: which servers the script uses, the main one (first page load, not the server
 *     with the most requests), default names taken from the domain, name rules, the user's renames.
 *  2. VuGen-Recorder-generators.js: the names are set once in vuser_init (VuGen) / as consts (DevWeb) and
 *     used in EVERY URL, header, EXTRARES / resources[] line, form value and body that carries the server —
 *     including https:\/\/ (escaped JSON) and https%3A%2F%2F (redirect_uri) forms, the DPoP "htu" and
 *     web_set_user / setUserCredentials. A rename reaches all of them.
 *
 * Loads the real Recorder engine files (state, ui helpers, generators) into a Function scope.
 */

const fs = require('fs');
const path = require('path');
const HostParams = require('../../src/web/public/shared/host-params.js');
const PageResources = require('../../src/web/public/shared/page-resources.js');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8');

function loadRecorder() {
  // eslint-disable-next-line no-new-func
  const f = new Function('PageResources', 'HostParams',
    read('VuGen-Recorder-state.js') + '\n' + read('VuGen-Recorder-ui.js') + '\n' + read('VuGen-Recorder-generators.js') +
    '\nreturn { S, buildScripts, subHdrValC, subHdrValMj, escBodyBinary };');
  return f(PageResources, HostParams);
}

let nextId = 1;
function ent(url, o = {}) {
  const reqHdrs = o.reqHdrs || [];
  const hdrsMap = {};
  reqHdrs.forEach((h) => { hdrsMap[h.name.toLowerCase()] = h.value; });
  return Object.assign({
    id: nextId++, url, method: 'GET', status: 200, ct: 'application/json', size: 10, dur: 5, startMs: 0,
    reqHdrs, hdrsMap, respHdrsMap: {}, body: null, referer: hdrsMap.referer || '', _resourceType: '', respBody: '',
    pageref: null, isMarker: false, markerType: null, txnName: null, txn: null, filtered: false,
  }, o, { reqHdrs, hdrsMap });
}
const page = (url, o = {}) => ent(url, Object.assign({ ct: 'text/html', _resourceType: 'document' }, o));
const codeOnly = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

describe('host-params — servers, main server, names', () => {
  test('hostKey: lower case, default port dropped, other ports kept, user info ignored, not http(s) -> ""', () => {
    expect(HostParams.hostKey('HTTPS://User:pw@Shop.Example.com:443/a?b')).toBe('shop.example.com');
    expect(HostParams.hostKey('http://h.example.com:80/')).toBe('h.example.com');
    expect(HostParams.hostKey('https://h.example.com:8443/x')).toBe('h.example.com:8443');
    expect(HostParams.hostKey('https://h.example.com/{{id}}')).toBe('h.example.com');
    expect(HostParams.hostKey('/relative')).toBe('');
    expect(HostParams.hostKey('data:text/plain,x')).toBe('');
  });

  test('default names by role: App_Server, Api_Server, Auth_Server, Static_Server, known services, else <Organisation>_Server', () => {
    expect(HostParams.defaultNames(['perfmatrix.com', 'www.google.com', 'fundingchoicesmessages.google.com', 'ep2.adtrafficquality.google',
      'app.bank.co.uk', 'api.bank.co.uk', 'perf-env.internal.corp', '10.1.2.3:8080', 'localhost:3000'],
    { paths: { 'www.google.com': ['/recaptcha/api2/aframe'] } })).toEqual({
      'perfmatrix.com': 'App_Server', 'www.google.com': 'Recaptcha_Server', 'fundingchoicesmessages.google.com': 'Google_Server',
      'ep2.adtrafficquality.google': 'Adtrafficquality_Server', 'app.bank.co.uk': 'Bank_Server', 'api.bank.co.uk': 'Api_Server',
      'perf-env.internal.corp': 'Perf_Env_Server', '10.1.2.3:8080': 'Ip_10_1_2_3_Server', 'localhost:3000': 'Localhost_Server',
    });
    // the application's own servers by their subdomain role; well-known services by purpose; clashes take the organisation
    expect(HostParams.defaultNames(['shop.example.com', 'api.example.com', 'login.example.org', 'cdn.example.com', 'partner.example.com',
      'corp.okta.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'api.other.com', 'www.google.com'])).toEqual({
      'shop.example.com': 'App_Server', 'api.example.com': 'Api_Server', 'login.example.org': 'Auth_Server', 'cdn.example.com': 'Static_Server',
      'partner.example.com': 'Partner_Server', 'corp.okta.com': 'Okta_Server', 'fonts.googleapis.com': 'Google_Fonts',
      'fonts.gstatic.com': 'Google_Fonts_Files', 'api.other.com': 'Other_Api_Server', 'www.google.com': 'Google_Server',
    });
    // same server on two ports
    expect(HostParams.defaultNames(['bank.com', 'bank.com:8443'])).toEqual({ 'bank.com': 'App_Server', 'bank.com:8443': 'App_Server_8443' });
    // long names are cut to 40 characters and stay unique
    const long = HostParams.defaultNames(['a.' + 'x'.repeat(60) + '.com', 'b.' + 'x'.repeat(60) + '.com']);
    Object.values(long).forEach((n) => expect(n.length).toBeLessThanOrEqual(42));
    expect(new Set(Object.values(long)).size).toBe(2);
  });

  test('name rules: identifier, length, words the script uses, other servers (case-insensitive)', () => {
    expect(HostParams.validName('Shop_Server', 'a', {})).toBe('');
    expect(HostParams.validName('_x1', 'a', {})).toBe('');
    expect(HostParams.validName('', 'a', {})).toMatch(/Enter a name/);
    expect(HostParams.validName('9lives', 'a', {})).toMatch(/letters, numbers and underscores/);
    expect(HostParams.validName('my-host', 'a', {})).toMatch(/letters, numbers and underscores/);
    expect(HostParams.validName('x'.repeat(41), 'a', {})).toMatch(/40 characters/);
    ['load', 'while', 'username', 'think_time', 'TS03', 'LR', 'const'].forEach((w) => expect(HostParams.validName(w, 'a', {})).toMatch(/already used by the script/));
    expect(HostParams.validName('AccessToken', 'a', {}, ['AccessToken'])).toMatch(/already used by the script/);
    expect(HostParams.validName('host_API', 'a', { b: 'Host_api' })).toMatch(/already the name of b/);
    expect(HostParams.validName('Host_api', 'b', { b: 'Host_api' })).toBe('');    // its own name
  });

  test('main server = first page load, even when an ad server has more requests; then servers in order of use', () => {
    const entries = [
      ent('https://ads.example-ads.com/a'), ent('https://ads.example-ads.com/b'), ent('https://ads.example-ads.com/c'),
      page('https://shop.example.com/'),
      ent('https://api.example.com/v1/x', { reqHdrs: [{ name: 'Origin', value: 'https://shop.example.com' }, { name: 'Referer', value: 'https://idp.example.org/login' },
        { name: 'Cookie', value: 'back=https://cookie-only.example.net/' }] }),
    ];
    const p = HostParams.plan(entries, () => true, {});
    expect(p.main).toBe('shop.example.com');
    expect(p.keys).toEqual(['shop.example.com', 'ads.example-ads.com', 'api.example.com', 'idp.example.org']);   // cookie values are not servers to call
    expect(p.list.find((x) => x.main).key).toBe('shop.example.com');
  });

  test('no page load (API recording): the server with the most steps is the main one', () => {
    const p = HostParams.plan([ent('https://a.example.com/1'), ent('https://b.example.com/1'), ent('https://b.example.com/2')], () => true, {});
    expect(p.main).toBe('b.example.com');
    expect(p.keys[0]).toBe('b.example.com');
  });

  test('only scripted requests count; a page load that failed is not the main page', () => {
    const entries = [page('https://err.example.com/', { status: 500 }), page('https://left.example.com/'), page('https://shop.example.com/')];
    const p = HostParams.plan(entries, (e) => !e.url.includes('left.'), {});
    expect(p.main).toBe('shop.example.com');
    expect(p.keys).not.toContain('left.example.com');
  });

  test('the user\'s names win; a name that can no longer be used falls back to the default; defaults step aside', () => {
    const entries = [page('https://shop.example.com/'), ent('https://api.example.com/x')];
    let p = HostParams.plan(entries, () => true, { 'api.example.com': 'App_Server' });
    expect(p.map).toEqual({ 'api.example.com': 'App_Server', 'shop.example.com': 'App_Server_2' });
    expect(p.list.find((x) => x.key === 'api.example.com').renamed).toBe(true);
    p = HostParams.plan(entries, () => true, { 'api.example.com': 'load', 'gone.example.com': 'Old' });
    expect(p.map['api.example.com']).toBe('Api_Server');
    expect(Object.keys(p.map)).not.toContain('gone.example.com');
    p = HostParams.plan(entries, () => true, { 'shop.example.com': 'AccessToken' }, ['AccessToken']);
    expect(p.map['shop.example.com']).toBe('App_Server');
  });
});

describe('Recorder scripts — every use of a server is its parameter', () => {
  function recording(S, extra = []) {
    S.entries = [
      page('https://shop.example.com/', { reqHdrs: [{ name: 'User-Agent', value: 'UA' }] }),
      ent('https://shop.example.com/api/menu', { reqHdrs: [{ name: 'Referer', value: 'https://shop.example.com/' }, { name: 'Origin', value: 'https://shop.example.com' }] }),
      ent('https://login.example.org/oauth2/token', { method: 'POST', ct: 'application/json',
        body: { mimeType: 'application/x-www-form-urlencoded', text: 'grant_type=code&redirect_uri=https%3A%2F%2Fshop.example.com%2Fcallback&code=1' },
        reqHdrs: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }] }),
      ent('https://api.example.com:8443/v1/cart', { method: 'POST', ct: 'application/json',
        body: { mimeType: 'application/json', text: '{"returnUrl":"https:\\/\\/shop.example.com\\/basket","site":"https://shop.example.com/"}' },
        reqHdrs: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Origin', value: 'https://shop.example.com' }] }),
      ...extra,
    ];
    S.format = 'both';
    return S;
  }

  test('VuGen: servers set once in vuser_init (main first), Action.c points there, no server written out in a step', () => {
    const r = loadRecorder();
    recording(r.S);
    r.buildScripts();
    const { ac, vi } = r.S.scripts;
    expect(vi).toBe('// Server value: the Runtime Settings attribute with this name when there is one, else the recorded value\n' +
      'void set_server(char *name, char *recorded)\n{\n\tchar *value = lr_get_attrib_string(name);\n' +
      '\tlr_save_string(value != NULL && value[0] != \'\\0\' ? value : recorded, name);\n}\n\n' +
      'vuser_init()\n{\n\n' +
      '\t// Servers — change a value here to run against another environment, or add an attribute with the same\n' +
      '\t// name in Runtime Settings > Additional attributes (it wins over the value here)\n' +
      '\tset_server("App_Server", "shop.example.com");\t// main application\n' +
      '\tset_server("Auth_Server", "login.example.org");\n' +
      '\tset_server("Api_Server", "api.example.com:8443");\n\n' +
      '\tweb_set_sockets_option("SSL_VERSION", "AUTO");\n\n' +
      '\treturn 0;\n}\n');
    expect(ac).toContain('// Set in vuser_init: the servers ({App_Server}, {Auth_Server}, …), the SSL setting');
    expect(ac).not.toMatch(/lr_save_string|set_server|web_set_sockets_option/);
    expect(ac).toContain('"URL=https://{App_Server}/api/menu"');
    expect(ac).toContain('"Referer=https://{App_Server}/"');
    expect(ac).toContain('web_add_header("Origin", "https://{App_Server}");');
    expect(ac).toContain('"Action=https://{Auth_Server}/oauth2/token"');
    expect(ac).toContain('"Name=redirect_uri","Value=https://{App_Server}/callback"');      // decoded form value
    expect(ac).toContain('"URL=https://{Api_Server}/v1/cart"');
    expect(ac).toContain('https:\\\\/\\\\/{App_Server}\\\\/basket');                       // escaped-slash JSON, in a C string
    expect(ac).toContain('\\"site\\":\\"https://{App_Server}/\\"');
    expect(codeOnly(ac)).not.toMatch(/shop\.example\.com|login\.example\.org|api\.example\.com/);
  });

  test('DevWeb: one const per server, the same names, ${Name} everywhere — default headers too', () => {
    const r = loadRecorder();
    recording(r.S);
    r.S.entries[0].reqHdrs.push({ name: 'Referer', value: 'https://shop.example.com/start' });
    r.buildScripts();
    const mj = r.S.scripts.mj;
    expect(mj).toContain("// Servers — change a value here to run against another environment, or set a user argument with the same\n" +
      "// name (rts.yml userArguments, or -userArgs) — it wins over the value here\n" +
      "const App_Server = load.config.user.args[\"App_Server\"] || 'shop.example.com';   // main application\n" +
      "const Auth_Server = load.config.user.args[\"Auth_Server\"] || 'login.example.org';\n" +
      "const Api_Server = load.config.user.args[\"Api_Server\"] || 'api.example.com:8443';\n\n" +
      '// Think time between transactions (seconds) — Runtime Settings > Think Time decides how it is used, as in VuGen\nlet think_time = 3;');
    expect(mj).toContain('"referer": `https://${App_Server}/start`,');               // headers of that request
    expect(mj).toContain('url: `https://${App_Server}/api/menu`,');
    expect(mj).toContain('"redirect_uri": `https://${App_Server}/callback`,');
    expect(mj).toContain('url: `https://${Api_Server}/v1/cart`,');
    expect(mj).toContain('https:\\\\/\\\\/${App_Server}\\\\/basket');
    expect(codeOnly(mj).replace(/^const \w+ = load\.config\.user\.args[^\n]*$/gm, '')).not.toMatch(/shop\.example\.com|login\.example\.org|api\.example\.com/);
  });

  test('a rename reaches vuser_init, every step and main.js; the old name is gone', () => {
    const r = loadRecorder();
    recording(r.S);
    r.buildScripts();
    const before = { ac: r.S.scripts.ac, mj: r.S.scripts.mj };
    r.S.hostNames = { 'shop.example.com': 'Shop_Server' };
    r.buildScripts();
    const all = r.S.scripts.ac + r.S.scripts.vi + r.S.scripts.mj;
    expect(all).not.toContain('App_Server');
    expect(r.S.scripts.vi).toContain('set_server("Shop_Server", "shop.example.com");\t// main application');
    // exactly the old name swapped for the new one, everywhere — nothing else in the scripts changes
    expect(r.S.scripts.ac).toBe(before.ac.split('App_Server').join('Shop_Server'));
    expect(r.S.scripts.mj).toBe(before.mj.split('App_Server').join('Shop_Server'));
    expect((r.S.scripts.ac.match(/\{Shop_Server\}/g) || []).length).toBeGreaterThanOrEqual(7);
    expect(r.S.scripts.mj).toContain("const Shop_Server = load.config.user.args[\"Shop_Server\"] || 'shop.example.com';");
    expect(r.S.scripts.mj).toContain('url: `https://${Shop_Server}/api/menu`,');
  });

  test('a longer server name is never half-replaced by a shorter one', () => {
    const r = loadRecorder();
    expect(r.subHdrValC('https://example.com/a https://api.example.com/b https://example.community/c',
      { 'example.com': 'Host_example', 'api.example.com': 'Host_api' })).toBe('https://{Host_example}/a https://{Host_api}/b https://example.community/c');
    expect(r.subHdrValMj('x', { 'example.com': 'H' })).toBe('"x"');
    expect(r.subHdrValMj('https://example.com/a`b', { 'example.com': 'H' })).toBe('`https://${H}/a\\`b`');
    expect(r.subHdrValC('back=https%3A%2F%2Fapi.example.com%3A8443%2Fx', { 'api.example.com:8443': 'H' })).toBe('back=https%3A%2F%2F{H}%2Fx');
  });

  test('DPoP: the proof URL uses the server parameter in both formats', () => {
    const r = loadRecorder();
    r.S.entries = [ent('https://api.example.com/v1/me', { reqHdrs: [{ name: 'DPoP', value: 'a.' + Buffer.from('{"htu":"https://api.example.com/v1/me"}').toString('base64') + '.c' },
      { name: 'Authorization', value: 'Bearer tok' }] })];
    r.S.format = 'both';
    r.buildScripts();
    expect(r.S.scripts.ac).toContain("\"Code=generateDpopProof('https://' + LR.getParam('Api_Server') + '/v1/me', 'GET', LR.getParam('AccessToken'));\"");
    expect(r.S.scripts.mj).toContain('getDpopProof(`https://${Api_Server}/v1/me`, \'GET\', load.global.dpop_jwk, load.global.AccessToken);');
    // the host lines come before the DPoP engine set-up
    const vi = r.S.scripts.vi;
    expect(vi.indexOf('set_server("Api_Server", "api.example.com")')).toBeGreaterThan(0);
    expect(vi.indexOf('set_server("Api_Server"')).toBeLessThan(vi.indexOf('initDpopKey'));
    // "Simulate a new user" empties the JavaScript engine every iteration: Action loads lre-utils.js once at the
    // top, before the first proof (BUG-092, found by replaying with VuGen)
    const ac = r.S.scripts.ac;
    expect(ac).toMatch(/web_js_run\(\n\t\t"Code=initDpopKey\(LR\.getParam\('dpop_jwk'\)\); 'DPoP engine ready';",\n\t\t"ResultParam=dpop_init_result",\n\t\tSOURCES,\n\t\t"File=lre-utils\.js", ENDITEM,/);
    expect(ac.indexOf("'DPoP engine ready'")).toBeLessThan(ac.indexOf('generateDpopProof'));
    // DevWeb: the header is the proof variable, not the text "${load.global.dpop_proof}" (BUG-093)
    expect(r.S.scripts.mj).toContain('"dpop": load.global.dpop_proof,');
    expect(r.S.scripts.mj).not.toContain('"${load.global.dpop_proof}"');
  });

  test('headers: once per Vuser only when every step sent them with one value; never tokens, Origin, CORS', () => {
    const r = loadRecorder();
    const H = (pairs) => pairs.map(([name, value]) => ({ name, value }));
    r.S.entries = [
      page('https://shop.example.com/', { reqHdrs: H([['User-Agent', 'UA'], ['Accept-Language', 'en'], ['X-Env', 'perf'], ['Authorization', 'Bearer t'], ['Origin', 'https://shop.example.com'], ['Accept', 'text/html']]) }),
      ent('https://shop.example.com/api/a', { reqHdrs: H([['User-Agent', 'UA'], ['X-Env', 'perf'], ['Authorization', 'Bearer t'], ['Origin', 'https://shop.example.com'], ['X-Req', '1']]) }),
      ent('https://shop.example.com/api/b', { reqHdrs: H([['User-Agent', 'UA'], ['Accept-Language', 'en'], ['X-Env', 'perf'], ['Authorization', 'Bearer t'], ['Origin', 'https://shop.example.com']]) }),
    ];
    r.S.format = 'both';
    r.buildScripts();
    // X-Env on all three, Accept-Language on the ones that recorded it (cached requests lack it in a HAR)
    expect(Object.keys(r.S.initHeaders).sort()).toEqual(['accept-language', 'user-agent', 'x-env']);
    expect(r.S.recordedUA).toBe('UA');
    const { ac, vi, mj } = r.S.scripts;
    expect(vi).toContain('\tweb_add_auto_header("Accept-Language", "en");\n\tweb_add_auto_header("X-Env", "perf");\n');
    expect(vi).not.toMatch(/User-Agent|Authorization|Origin|X-Req/);
    expect(ac).not.toMatch(/web_add_auto_header|"User-Agent"/);
    expect((ac.match(/web_add_header\("Authorization", "Bearer t"\);/g) || []).length).toBe(3);   // per request, as recorded
    expect((ac.match(/web_add_header\("Origin"/g) || []).length).toBe(3);
    expect((ac.match(/web_add_header\("X-Req", "1"\);/g) || []).length).toBe(1);                   // only on the step that sent it
    // DevWeb: the same rule for load.WebRequest.defaults.headers (user agent included)
    expect(mj).toMatch(/load\.WebRequest\.defaults\.headers = \{\n    "user-agent": "UA",\n    "accept-language": "en",\n    "x-env": "perf",\n\};/);
    expect((mj.match(/"x-req": "1"/g) || []).length).toBe(1);   // header names in lower case, as HTTP/2 sends them
  });

  test('Mode=HTML for pages, Mode=HTTP for calls made by JavaScript; think time between transactions only', () => {
    const r = loadRecorder();
    const mk = (type, name) => ({ id: -1, url: '', isMarker: true, markerType: type, txnName: name, reqHdrs: [], hdrsMap: {} });
    r.S.entries = [mk('start', 'T01_A'), page('https://shop.example.com/'), ent('https://shop.example.com/api/x', { _resourceType: 'fetch' }), mk('end', 'T01_A'),
      mk('start', 'T02_B'), ent('https://shop.example.com/api/y', { _resourceType: 'xhr' }), mk('end', 'T02_B')];
    r.S.txns = [{ name: 'T01_A' }, { name: 'T02_B' }];
    r.S.format = 'both';
    r.buildScripts();
    const { ac, mj } = r.S.scripts;
    expect(ac).toMatch(/web_url\("shop",[\s\S]*?"Mode=HTML",/);
    expect(ac).toMatch(/web_url\("x",[\s\S]*?"Mode=HTTP",/);
    expect((ac.match(/lr_think_time\(3\);/g) || []).length).toBe(1);   // after T01, not after the last transaction
    expect((mj.match(/load\.thinkTime\(think_time\);/g) || []).length).toBe(1);
    expect(mj).not.toContain('load.sleep(');
  });

  test('long bodies are split between escape sequences only (BUG-091: "\\\\" split in two broke the C string)', () => {
    const r = loadRecorder();
    // JSON whose strings hold escaped quotes: \" in the JSON becomes \\\" in C — 4 characters that must stay together
    const json = JSON.stringify({ flags: JSON.stringify(Array.from({ length: 60 }, (_, i) => 'feature_flag_' + i)) , é: 'ü' });
    r.S.entries = [ent('https://api.example.com/collect', { method: 'POST', body: { mimeType: 'application/json', text: json }, reqHdrs: [{ name: 'Content-Type', value: 'application/json' }] })];
    r.S.format = 'webhttp';
    r.buildScripts();
    const lines = r.S.scripts.ac.split('\n').filter((l) => /^\t\t"/.test(l) && !/^\t\t"(URL|Method|Resource|RecContentType|Referer|Snapshot|Mode|EncType)=/.test(l));
    expect(lines.length).toBeGreaterThan(3);
    // every chunk is a complete C string literal: no chunk ends in an unfinished escape
    for (const l of lines) {
      const body = l.replace(/^\t\t"(BodyBinary=)?/, '').replace(/",?$/, '');
      expect(body).toMatch(/^(?:[^\\]|\\[\\"ntr]|\\x[0-9A-F]{2})*$/);
    }
    // joined back, the chunks are the escaped body
    const joined = lines.map((l) => l.replace(/^\t\t"(BodyBinary=)?/, '').replace(/",?$/, '')).join('');
    expect(joined).toBe(r.escBodyBinary(json));
  });

  test('Windows sign-in: web_set_user and setUserCredentials use the server parameter', () => {
    const r = loadRecorder();
    r.S.entries = [page('https://intranet.example.com/', { respHdrsMap: { 'www-authenticate': 'Negotiate' } })];
    r.S.format = 'both';
    r.buildScripts();
    expect(r.S.scripts.ac).toContain('web_set_user("{username}", "{password}", "{App_Server}");');
    expect(r.S.scripts.mj).toContain('host: App_Server\n');
  });

  test('no servers (nothing in the script): vuser_init and main.js are as before', () => {
    const r = loadRecorder();
    r.S.entries = [ent('https://shop.example.com/a.css', { ct: 'text/css', filtered: true })];
    r.S.format = 'both';
    r.buildScripts();
    expect(r.S.scripts.vi).toBe('vuser_init()\n{\n\n\tweb_set_sockets_option("SSL_VERSION", "AUTO");\n\n\treturn 0;\n}\n');
    expect(r.S.scripts.mj.startsWith('// Think time between transactions')).toBe(true);
    expect(r.S.scripts.ac).not.toMatch(/set_server|\{App_Server\}/);
    expect(r.S.serverHost).toBeNull();
  });
});
