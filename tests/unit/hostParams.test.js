'use strict';

/**
 * Server (host) parameters — shared/host-params.js: which servers the script uses, the main one (first page load,
 * not the server with the most requests), default names taken from the domain, name rules, the user's renames.
 * How the generator uses them (vuser_init / DevWeb consts, every URL, header and body): studioServerParams.test.js.
 */

const HostParams = require('../../src/web/public/shared/host-params.js');

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
      'app.acme.co.uk', 'api.acme.co.uk', 'perf-env.internal.corp', '10.1.2.3:8080', 'localhost:3000'],
    { paths: { 'www.google.com': ['/recaptcha/api2/aframe'] } })).toEqual({
      'perfmatrix.com': 'App_Server', 'www.google.com': 'Recaptcha_Server', 'fundingchoicesmessages.google.com': 'Google_Server',
      'ep2.adtrafficquality.google': 'Adtrafficquality_Server', 'app.acme.co.uk': 'Acme_Server', 'api.acme.co.uk': 'Api_Server',
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
    expect(HostParams.defaultNames(['acme.com', 'acme.com:8443'])).toEqual({ 'acme.com': 'App_Server', 'acme.com:8443': 'App_Server_8443' });
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
