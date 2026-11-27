'use strict';

/**
 * The converters' preview (Postman / Bruno and JMeter panels): what the ZIP holds, shown before the download.
 *  - server (src/web/convertPreview.js): requests grouped by top-level folder / thread group, the servers they call
 *    (addresses resolved with the collection and environment variables, never with new URL()), each server's state —
 *    resolved, set while the script runs (a script or an extractor), or missing — and the files as the ZIP names them
 *    (keys, certificates, binary and too-large files listed but not shown)
 *  - the page itself: tests/unit/converterApp.test.js
 */

const path = require('path');
const C = require('../../src/web/convertPreview.js');

const OUT = path.join('/tmp', 'lr-out-1').replace(/\\/g, '/');
const files = (o) => new Map(Object.entries(o).map(([k, v]) => [OUT + '/' + k, v]));

describe('convertPreview (server)', () => {
  test('resolve: {{name}} and ${name}, nested, unknown kept as written', () => {
    const vars = { base: 'https://{{host}}/v1', host: 'api.example.com', H: 'shop.example.com' };
    expect(C.resolve('{{base}}/orders', vars)).toBe('https://api.example.com/v1/orders');
    expect(C.resolve('https://${H}/x?{{none}}', vars)).toBe('https://shop.example.com/x?{{none}}');
  });
  test('hostOf: by hand, port kept, user info dropped, a variable kept as written (case too)', () => {
    expect(C.hostOf('HTTPS://API.Example.com:8443/a?b')).toBe('api.example.com:8443');
    expect(C.hostOf('https://user:pw@api.example.com/a')).toBe('api.example.com');
    expect(C.hostOf('{{baseUrl}}/a')).toBe('{{baseUrl}}');
    expect(C.hostOf('https://{{HOST}}/a')).toBe('{{HOST}}');
  });
  test('variablesOf: the environment wins; a name with no value is only declared', () => {
    const declared = new Set();
    const v = C.variablesOf({ variable: [{ key: 'a', value: '1' }, { key: 'b', value: '2' }, { key: 'off', value: 'x', disabled: true }] }, { b: '3', c: '' }, declared);
    expect(v).toEqual({ a: '1', b: '3' });
    expect([...declared]).toEqual(['c']);
  });
  test('runtimeNames: set by a script or an extractor', () => {
    const n = C.runtimeNames([
      { tests: [{ listen: 'test', script: { exec: ['pm.environment.set("token", j.t);', 'bru.setVar(\'sid\', x)'] } }] },
      { extractors: [{ listen: 'extractor', extractor: { name: 'csrf' } }] },
      { preScripts: ['vars.put("orderId", "1")'] },
    ], ['declared']);
    expect([...n].sort()).toEqual(['csrf', 'declared', 'orderId', 'sid', 'token']);
  });
  test('buildPreview: Postman — groups by top folder, servers with their state, files named as in the ZIP', () => {
    const pv = C.buildPreview({
      kind: 'pm',
      requests: [
        { name: 'Login', folder: 'Auth', method: 'post', url: '{{base}}/login', tests: [{ script: { exec: ['pm.environment.set("api", v)'] } }] },
        { name: 'Orders', folder: 'Shop/Orders', method: 'GET', url: '{{api}}/orders' },
        { name: 'Ping', folder: '', method: 'GET', url: '{{nowhere}}/ping' },
      ],
      collection: { variable: [{ key: 'base', value: 'https://auth.example.com' }] },
      environmentVars: {},
      files: files({ 'main.js': 'load.initialize();', 'client.pem': '-----BEGIN', 'data.xlsx': Buffer.from([80, 75, 3, 4, 0, 0]), 'Auth/notes.md': 'x' }),
      outputDir: OUT,
    });
    expect(pv.requests.map((r) => [r.n, r.group, r.method, r.address, r.host, r.state])).toEqual([
      [1, 'Auth', 'POST', 'https://auth.example.com/login', 'auth.example.com', 'resolved'],
      [2, 'Shop', 'GET', '{{api}}/orders', '{{api}}', 'runtime'],
      [3, '(no folder)', 'GET', '{{nowhere}}/ping', '{{nowhere}}', 'missing'],
    ]);
    expect(pv.groups).toEqual([{ name: 'Auth', count: 1 }, { name: 'Shop', count: 1 }, { name: '(no folder)', count: 1 }]);
    expect(pv.hosts.map((h) => h.state).sort()).toEqual(['missing', 'resolved', 'runtime']);
    expect(pv.files.map((f) => [f.path, f.text == null])).toEqual([['Auth/notes.md', false], ['client.pem', true], ['data.xlsx', true], ['main.js', false]]);
  });
  test('buildPreview: JMeter — groups by thread group; a variable declared with no value is set while the script runs', () => {
    const pv = C.buildPreview({
      kind: 'jmx',
      requests: [{ name: 'Login', folder: 'Tx', method: 'POST', url: 'https://{{HOST}}/login', threadGroupName: 'Buyers' }, { name: 'Next', method: 'GET', url: 'https://{{T}}/x', threadGroupName: 'Browsers' }],
      collection: { variable: [{ key: 'HOST', value: 'shop.example.com' }] },
      environmentVars: { HOST: '', T: '' },
      files: new Map(), outputDir: OUT,
    });
    expect(pv.requests.map((r) => [r.group, r.host, r.state])).toEqual([['Buyers', 'shop.example.com', 'resolved'], ['Browsers', '{{T}}', 'runtime']]);
  });
  test('buildPreview: every request listed, the ones left out on the page marked out', () => {
    const reqs = [{ name: 'a', url: 'https://x.example.com/a' }, { name: 'b', url: 'https://x.example.com/b' }, { name: 'c', url: 'https://y.example.com/c' }];
    const pv = C.buildPreview({ kind: 'pm', requests: reqs, leftOut: new Set([2]), files: new Map(), outputDir: OUT });
    expect(pv.requests.map((r) => [r.n, r.out])).toEqual([[1, false], [2, true], [3, false]]);
    expect(C.buildPreview({ kind: 'pm', requests: reqs, files: new Map(), outputDir: OUT }).requests.every((r) => r.out === false)).toBe(true);
  });
  test('buildPreview: what a request sets and the set values it sends (only when any)', () => {
    const reqs = [
      { name: 'token', url: '{{base}}/token', tests: [{ listen: 'test', script: { exec: ['pm.environment.set("access_token", j.t);'] } }] },
      { name: 'use', url: '{{base}}/a', headers: [{ key: 'Authorization', value: 'Bearer {{access_token}}' }] },
      { name: 'jmx', url: 'https://${HOST}/b?id=${orderId}', extractors: [{ extractor: { name: 'orderId' } }] },
    ];
    const pv = C.buildPreview({ kind: 'pm', requests: reqs, collection: { variable: [{ key: 'base', value: 'https://api.example.com' }] }, files: new Map(), outputDir: OUT });
    expect(pv.requests.map((r) => [r.sets, r.uses])).toEqual([[['access_token'], undefined], [undefined, ['access_token']], [['orderId'], ['orderId']]]);
  });
  test('buildPreview: every value the requests send or set, and where it comes from', () => {
    const reqs = [
      { name: 'a', url: '{{base}}/x?id={{$guid}}&e={{blank}}', headers: [{ key: 'Authorization', value: 'Bearer {{access_token}}' }, { key: 'K', value: '{{api_key}}' }],
        tests: [{ script: { exec: ['pm.environment.set("next", 1)'] } }] },
      { name: 'b', url: 'https://${HOST}/{{next}}/{{nope}}?t=${__time()}&u={{token_url}}', extractors: [{ extractor: { type: 'jsonpath', name: 'access_token', jsonPath: '$.t' } }] },
    ];
    const pv = C.buildPreview({
      kind: 'pm', requests: reqs, files: new Map(), outputDir: OUT,
      collection: { variable: [{ key: 'base', value: 'https://api.example.com' }], csvDataSets: [{ filename: 'u.csv', variableNames: 'HOST' }] },
      environmentVars: { access_token: 'abc', api_key: 'k-123', blank: '', token_url: 'https://id.example.com/token' },
    });
    const by = Object.fromEntries(pv.variables.map((v) => [v.name, v]));
    expect(Object.fromEntries(pv.variables.map((v) => [v.name, v.source]))).toEqual({
      base: 'collection', $guid: 'builtin', blank: 'empty', access_token: 'set', api_key: 'environment', next: 'set', HOST: 'data', nope: 'missing', '__time()': 'builtin', token_url: 'environment',
    });
    expect([by.access_token.setBy, by.access_token.usedBy, by.access_token.how]).toEqual([[2], [1], 'jsonpath $.t']);
    expect([by.api_key.value, by.api_key.hidden]).toEqual([null, true]);              // looks secret: not shown
    expect([by.token_url.value, by.token_url.hidden]).toEqual(['https://id.example.com/token', undefined]);   // an address is not
    expect(by.HOST.file).toBe('u.csv');
    expect(by.base.value).toBe('https://api.example.com');
  });
  test('buildPreview: a value given on the page is marked given', () => {
    const pv = C.buildPreview({ kind: 'pm', requests: [{ name: 'a', url: '{{base}}/x' }], environmentVars: { base: 'https://api.example.com' }, given: ['base'], files: new Map(), outputDir: OUT });
    expect(pv.variables).toEqual([expect.objectContaining({ name: 'base', source: 'environment', given: true })]);
    expect(pv.hosts[0].state).toBe('resolved');
  });
  test('buildPreview: a server parameter only when the script writes it; the script name', () => {
    const reqs = [{ name: 'a', url: 'https://api.example.com/a' }, { name: 'b', url: 'https://cdn.example.com/b' }];
    const pv = C.buildPreview({
      kind: 'pm', requests: reqs, outputDir: OUT, collection: { info: { name: 'Shop' } },
      servers: { 'api.example.com': 'Api_Server', 'cdn.example.com': 'Cdn_Server' },
      files: files({ 'main.js': "const Api_Server = load.config.user.args[\"Api_Server\"] || 'api.example.com';" }),
    });
    expect(pv.hosts.map((h) => [h.host, h.param])).toEqual([['api.example.com', 'Api_Server'], ['cdn.example.com', undefined]]);
    expect(pv.scriptName).toBe('Shop');
  });
  test('large files are listed but not shown, and the preview says so', () => {
    const big = 'x'.repeat(500 * 1024);
    const pv = C.buildPreview({ kind: 'pm', requests: [], files: files({ 'Action.c': big }), outputDir: OUT });
    expect([pv.files[0].text, pv.truncated]).toEqual([null, true]);
  });
  test('safePreview never throws (a conversion is never broken by its preview)', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(C.safePreview({ kind: 'pm', requests: [{ get url() { throw new Error('boom'); } }] })).toBeNull();
    warn.mockRestore();
  });
});
