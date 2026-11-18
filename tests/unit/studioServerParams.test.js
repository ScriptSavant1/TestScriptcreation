'use strict';

/**
 * Script Studio's generator (the one generator since the Recorder tool was merged into Script Studio) — the checks
 * that guarded the Recorder's own generator, on Studio's:
 *  - server parameters: set once in vuser_init (VuGen) / as consts (DevWeb), used in EVERY URL, header, form value
 *    and body that carries the server — https://, https:\/\/ (escaped JSON) and https%3A%2F%2F (redirect_uri) forms;
 *    a rename reaches all of them (BUG-146: a server in a Web HTTP/HTML body stayed written out)
 *  - headers sent on every request with one value go once per Vuser; tokens, Origin, CORS never do
 *  - Mode=HTML for pages, Mode=HTTP for calls; think time between transactions only
 *  - HTML form POSTs as web_submit_data + ITEMDATA, other bodies as web_custom_request (BUG-055)
 *  - page resources under their page step (BUG-056)
 */

const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
global.VugenCodegen = require('../../src/web/public/shared/vugen-codegen.js');
global.PageResources = require('../../src/web/public/shared/page-resources.js');
global.HostParams = require('../../src/web/public/shared/host-params.js');

function engine() {
  const doc = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  // eslint-disable-next-line no-new-func
  return new Function('document', 'window', read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') + '\n' + read('studio-codegen.js') +
    '\nreturn { S, genActionC, genVuserInit, genMainJS, subHdrValC, subHdrValMj };')(doc, { location: { pathname: '/converter/studio' } });
}
// the scripts Studio writes for these entries (both formats)
function scripts(entries, set) {
  const E = engine(), S = E.S;
  Object.assign(S, { format: 'both', entries1: JSON.parse(JSON.stringify(entries)), txns: [], params: [], correlations: [], hostNames: {} }, set || {});
  const ac = E.genActionC(S.entries1, []);
  return { ac, vi: E.genVuserInit(), mj: E.genMainJS(S.entries1, []), S, E };
}

let nextId = 1;
function ent(url, o = {}) {
  const reqHdrs = o.reqHdrs || [];
  const hdrsMap = {};
  reqHdrs.forEach((h) => { hdrsMap[h.name.toLowerCase()] = h.value; });
  return Object.assign({
    id: nextId++, url, method: 'GET', status: 200, ct: 'application/json', dur: 5, startMs: 0,
    reqHdrs, hdrsMap, respHdrsMap: {}, body: null, referer: hdrsMap.referer || '', _resourceType: 'xhr', respBody: '',
    isMarker: false, filtered: false,
  }, o, { reqHdrs, hdrsMap });
}
const page = (url, o = {}) => ent(url, Object.assign({ ct: 'text/html', _resourceType: 'document' }, o));
const codeOnly = (s) => s.split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');

const recording = () => [
  page('https://shop.example.com/', { reqHdrs: [{ name: 'User-Agent', value: 'UA' }] }),
  ent('https://shop.example.com/api/menu', { reqHdrs: [{ name: 'Referer', value: 'https://shop.example.com/' }, { name: 'Origin', value: 'https://shop.example.com' }] }),
  ent('https://login.example.org/oauth2/token', { method: 'POST',
    body: { mimeType: 'application/x-www-form-urlencoded', text: 'grant_type=code&redirect_uri=https%3A%2F%2Fshop.example.com%2Fcallback&code=1' },
    reqHdrs: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }] }),
  ent('https://api.example.com:8443/v1/cart', { method: 'POST',
    body: { mimeType: 'application/json', text: '{"returnUrl":"https:\\/\\/shop.example.com\\/basket","site":"https://shop.example.com/"}' },
    reqHdrs: [{ name: 'Content-Type', value: 'application/json' }, { name: 'Origin', value: 'https://shop.example.com' }] }),
];

describe('Script Studio — every use of a server is its parameter', () => {
  test('VuGen: servers set once in vuser_init (main first); no server written out in a step — bodies included (BUG-146)', () => {
    const { ac, vi } = scripts(recording());
    expect(vi).toContain('\tset_server("App_Server", "shop.example.com");\t// main application\n' +
      '\tset_server("Auth_Server", "login.example.org");\n' +
      '\tset_server("Api_Server", "api.example.com:8443");\n');
    expect(ac).toContain('// Set in vuser_init: the servers ({App_Server}, {Auth_Server}, …), the SSL setting');
    expect(ac).not.toMatch(/lr_save_string|set_server|web_set_sockets_option/);
    expect(ac).toContain('"URL=https://{App_Server}/api/menu"');
    expect(ac).toContain('"Referer=https://{App_Server}/"');
    expect(ac).toContain('web_add_header("Origin", "https://{App_Server}");');
    expect(ac).toContain('"Action=https://{Auth_Server}/oauth2/token"');
    expect(ac).toContain('"Name=redirect_uri","Value=https://{App_Server}/callback"');    // decoded form value
    expect(ac).toContain('"URL=https://{Api_Server}/v1/cart"');
    expect(ac).toContain('https:\\\\/\\\\/{App_Server}\\\\/basket');                      // escaped-slash JSON, in a C string
    expect(ac).toContain('\\"site\\":\\"https://{App_Server}/\\"');
    expect(codeOnly(ac)).not.toMatch(/shop\.example\.com|login\.example\.org|api\.example\.com/);
  });

  test('DevWeb: one const per server, the same names, ${Name} everywhere', () => {
    const { mj } = scripts(recording());
    expect(mj).toContain("const App_Server = load.config.user.args[\"App_Server\"] || 'shop.example.com';   // main application\n" +
      "const Auth_Server = load.config.user.args[\"Auth_Server\"] || 'login.example.org';\n" +
      "const Api_Server = load.config.user.args[\"Api_Server\"] || 'api.example.com:8443';\n");
    expect(mj).toContain('url: `https://${App_Server}/api/menu`,');
    expect(mj).toContain('url: `https://${Api_Server}/v1/cart`,');
    expect(mj).toContain('"returnUrl":"https:\\/\\/${App_Server}\\/basket"');
    expect(codeOnly(mj).replace(/^const \w+ = load\.config\.user\.args[^\n]*$/gm, '')).not.toMatch(/shop\.example\.com|login\.example\.org|api\.example\.com/);
  });

  test('a rename reaches vuser_init, every step and main.js; nothing else changes', () => {
    const a = scripts(recording());
    const b = scripts(recording(), { hostNames: { 'shop.example.com': 'Shop_Server' } });
    expect(b.ac + b.vi + b.mj).not.toContain('App_Server');
    expect(b.vi).toContain('set_server("Shop_Server", "shop.example.com");\t// main application');
    expect(b.ac).toBe(a.ac.split('App_Server').join('Shop_Server'));
    expect(b.mj).toBe(a.mj.split('App_Server').join('Shop_Server'));
    expect((b.ac.match(/\{Shop_Server\}/g) || []).length).toBeGreaterThanOrEqual(7);
  });

  test('a longer server name is never half-replaced by a shorter one; encoded and template forms', () => {
    const { subHdrValC, subHdrValMj } = engine();
    expect(subHdrValC('https://example.com/a https://api.example.com/b https://example.community/c',
      { 'example.com': 'Host_example', 'api.example.com': 'Host_api' })).toBe('https://{Host_example}/a https://{Host_api}/b https://example.community/c');
    expect(subHdrValMj('x', { 'example.com': 'H' })).toBe('"x"');
    expect(subHdrValMj('https://example.com/a`b', { 'example.com': 'H' })).toBe('`https://${H}/a\\`b`');
    expect(subHdrValC('back=https%3A%2F%2Fapi.example.com%3A8443%2Fx', { 'api.example.com:8443': 'H' })).toBe('back=https%3A%2F%2F{H}%2Fx');
  });

  test('no servers (nothing in the script): no set_server, no server parameter', () => {
    const { vi, ac } = scripts([ent('https://shop.example.com/a.css', { ct: 'text/css', filtered: true })]);
    expect(vi).not.toMatch(/set_server/);
    expect(ac).not.toMatch(/\{App_Server\}/);
  });
});

describe('Script Studio — headers, modes and think time', () => {
  test('headers: once per Vuser only when every step sent them with one value; never tokens, Origin, CORS', () => {
    const H = (pairs) => pairs.map(([name, value]) => ({ name, value }));
    const { ac, vi, mj } = scripts([
      page('https://shop.example.com/', { reqHdrs: H([['User-Agent', 'UA'], ['Accept-Language', 'en'], ['X-Env', 'perf'], ['Authorization', 'Bearer t'], ['Origin', 'https://shop.example.com'], ['Accept', 'text/html']]) }),
      ent('https://shop.example.com/api/a', { reqHdrs: H([['User-Agent', 'UA'], ['X-Env', 'perf'], ['Authorization', 'Bearer t'], ['Origin', 'https://shop.example.com'], ['X-Req', '1']]) }),
      ent('https://shop.example.com/api/b', { reqHdrs: H([['User-Agent', 'UA'], ['Accept-Language', 'en'], ['X-Env', 'perf'], ['Authorization', 'Bearer t'], ['Origin', 'https://shop.example.com']]) }),
    ]);
    expect(vi).toContain('web_add_auto_header("X-Env", "perf");');
    expect(vi).not.toMatch(/Authorization|Origin|X-Req/);
    expect((ac.match(/web_add_header\("Authorization", "Bearer t"\);/g) || []).length).toBe(3);   // per request, as recorded
    expect((ac.match(/web_add_header\("X-Req", "1"\);/g) || []).length).toBe(1);                   // only on the step that sent it
    expect(mj).toMatch(/"x-env": "perf"/i);                // header names as recorded (HTTP header names are case-insensitive)
    expect((mj.match(/"x-req": "1"/gi) || []).length).toBe(1);
  });

  test('Mode=HTML for pages, Mode=HTTP for calls made by JavaScript; think time between transactions only', () => {
    const mk = (type, name) => ({ id: -1, url: '', method: 'GET', isMarker: true, markerType: type, txnName: name, reqHdrs: [], hdrsMap: {}, respHdrsMap: {}, filtered: false });
    const { ac, mj } = scripts([mk('start', 'T01_A'), page('https://shop.example.com/'), ent('https://shop.example.com/api/x', { _resourceType: 'fetch' }), mk('end', 'T01_A'),
      mk('start', 'T02_B'), ent('https://shop.example.com/api/y', { _resourceType: 'xhr' }), mk('end', 'T02_B')], { txns: [{ name: 'T01_A' }, { name: 'T02_B' }] });
    expect(ac).toMatch(/web_url\("shop",[\s\S]*?"Mode=HTML",/);
    expect(ac).toMatch(/web_url\("x",[\s\S]*?"Mode=HTTP",/);
    expect((ac.match(/lr_think_time\(3\);/g) || []).length).toBe(1);   // after T01, not after the last transaction
    expect((mj.match(/load\.thinkTime\(think_time\);/g) || []).length).toBe(1);
  });
});

describe('Script Studio — form POSTs and page resources (HTML mode)', () => {
  const post = (url, mimeType, text) => ent(url, { method: 'POST', ct: 'text/html', _resourceType: 'document',
    reqHdrs: [{ name: 'Content-Type', value: mimeType }], body: { mimeType, text } });

  test('a URL-encoded form POST becomes web_submit_data with decoded ITEMDATA fields (BUG-055)', () => {
    const { ac } = scripts([post('https://app.example.com/session', 'application/x-www-form-urlencoded', 'authenticity_token=abc%2B1&username=test.user&message=hello+world%21')], { format: 'webhttp' });
    expect(ac).toContain('web_submit_data("session",');
    expect(ac).toContain('"Action=https://{App_Server}/session",');
    expect(ac).toContain('"Method=POST",');
    expect(ac).toContain('ITEMDATA,');
    expect(ac).toContain('"Name=authenticity_token","Value=abc+1",ENDITEM,');
    expect(ac).toContain('"Name=username","Value=test.user",ENDITEM,');
    expect(ac).toContain('"Name=message","Value=hello world!",ENDITEM,');
    expect(ac).not.toContain('web_custom_request');
  });
  test('a JSON POST, and a URL-encoded body without name=value pairs, stay web_custom_request', () => {
    const j = scripts([post('https://app.example.com/api/orders', 'application/json', '{"itemId":"itm-1","quantity":2}')], { format: 'webhttp' }).ac;
    expect(j).toContain('web_custom_request("orders",');
    expect(j).toContain('"EncType=application/json",');
    expect(j).toContain('BodyBinary={\\"itemId\\":\\"itm-1\\",\\"quantity\\":2}');
    const k = scripts([post('https://app.example.com/ping', 'application/x-www-form-urlencoded', 'keepalive')], { format: 'webhttp' }).ac;
    expect(k).toContain('web_custom_request("ping",');
    expect(k).not.toContain('web_submit_data');
  });
  test('a form value with a double quote is escaped for the C string', () => {
    const { ac } = scripts([post('https://app.example.com/comment', 'application/x-www-form-urlencoded', 'text=say+%22hi%22')], { format: 'webhttp' });
    expect(ac).toContain('"Name=text","Value=say \\"hi\\"",ENDITEM,');
  });
  test('static resources belong to their page step: HTML-referenced ones are not scripted, script-loaded ones go under EXTRARES (BUG-056)', () => {
    const get = (url, ct, rt, extra = {}) => ent(url, Object.assign({ ct, _resourceType: rt, referer: 'https://shop.example.com/' }, extra));
    const { ac } = scripts([
      get('https://shop.example.com/', 'text/html', 'document', { referer: '', respBody: '<img src="/img/logo.gif">' }),
      get('https://shop.example.com/img/logo.gif', 'image/gif', 'image'),
      get('https://www.google-analytics.com/collect?v=1', 'image/gif', 'image'),
    ], { format: 'webhttp' });
    expect((ac.match(/web_url\(/g) || []).length).toBe(1);
    expect(ac).not.toContain('logo.gif');
    expect(ac).toContain('// Page resources: 1 images/stylesheets in the page HTML download automatically (Mode=HTML); 1 other (scripts, CSS/JS-loaded files) is listed under EXTRARES');
    expect(ac).toMatch(/EXTRARES,\n\t\t"Url=https:\/\/\{Google_Analytics_Server\}\/collect\?v=1", ENDITEM,/);
  });
});
