'use strict';

/**
 * The converters' preview (Postman / Bruno and JMeter panels): what the ZIP holds, shown before the download.
 *  - server (src/web/convertPreview.js): requests grouped by top-level folder / thread group, the servers they call
 *    (addresses resolved with the collection and environment variables, never with new URL()), each server's state —
 *    resolved, set while the script runs (a script or an extractor), or missing — and the files as the ZIP names them
 *    (keys, certificates, binary and too-large files listed but not shown)
 *  - page (src/web/public/portal/convert-preview.js): filter, groups, the first file, files by folder
 */

const path = require('path');
const C = require('../../src/web/convertPreview.js');
const P = require('../../src/web/public/portal/convert-preview.js');

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

describe('convert-preview (page helpers)', () => {
  const reqs = [
    { n: 1, name: 'Login', folder: 'Auth', group: 'Auth', method: 'POST', address: 'https://a.example.com/login', host: 'a.example.com' },
    { n: 2, name: 'Orders', folder: 'Shop', group: 'Shop', method: 'GET', address: 'https://b.example.com/orders', host: 'b.example.com' },
    { n: 3, name: 'Logout', folder: 'Auth', group: 'Auth', method: 'GET', address: 'https://a.example.com/logout', host: 'a.example.com' },
  ];
  test('filterRequests: one server, words in the name or address', () => {
    expect(P.filterRequests(reqs, 'a.example.com', '').map((r) => r.n)).toEqual([1, 3]);
    expect(P.filterRequests(reqs, '', 'ORDERS').map((r) => r.n)).toEqual([2]);
    expect(P.filterRequests(reqs, 'b.example.com', 'login')).toEqual([]);
  });
  test('groupRequests: in order, one group per folder / thread group', () => {
    expect(P.groupRequests(reqs).map((g) => [g.name, g.requests.map((r) => r.n)])).toEqual([['Auth', [1, 3]], ['Shop', [2]]]);
  });
  test('defaultFile: main.js for DevWeb, else Action.c, else the first shown', () => {
    expect(P.defaultFile([{ path: 'Action.c', text: 'x' }, { path: 'main.js', text: 'y' }])).toBe('main.js');
    expect(P.defaultFile([{ path: 'a.usr', text: 'x' }, { path: 'Action.c', text: 'y' }])).toBe('Action.c');
    expect(P.defaultFile([{ path: 'k.pem', text: null }, { path: 'r.md', text: 'z' }])).toBe('r.md');
    expect(P.defaultFile([])).toBeNull();
  });
  test('stateOf: a tick for several requests — all in, none in, some', () => {
    expect(P.stateOf([1, 2], new Set())).toBe('all');
    expect(P.stateOf([1, 2], new Set([1, 2, 5]))).toBe('none');
    expect(P.stateOf([1, 2], new Set([2]))).toBe('some');
  });
  test('sameSet: the choice equals the ZIP (no Update needed)', () => {
    expect(P.sameSet(new Set([1, 2]), new Set([2, 1]))).toBe(true);
    expect(P.sameSet(new Set([1]), new Set([2]))).toBe(false);
    expect(P.sameSet(new Set(), new Set([2]))).toBe(false);
  });
  test('needed: a value set only by left-out requests and sent by a kept one', () => {
    const list = [
      { n: 1, sets: ['token'] }, { n: 2, uses: ['token'] }, { n: 3, sets: ['id'] }, { n: 4, sets: ['id'], uses: ['id'] }, { n: 5, uses: ['token', 'id'] },
    ];
    expect(P.needed(list, new Set())).toEqual([]);
    expect(P.needed(list, new Set([1]))).toEqual([{ name: 'token', by: [1], usedBy: [2, 5] }]);
    expect(P.needed(list, new Set([3]))).toEqual([]);                       // request 4 still sets id
    expect(P.needed(list, new Set([1, 2, 5]))).toEqual([]);                 // nobody kept sends token
    expect(P.needed(list, new Set([3, 4])).map((x) => [x.name, x.usedBy])).toEqual([['id', [5]]]);
  });
  test('fileGroups: the root first, then one group per script folder', () => {
    expect(P.fileGroups([{ path: 'B/main.js' }, { path: 'a.md' }, { path: 'A/main.js' }]).map((g) => g.dir)).toEqual(['', 'A', 'B']);
  });
});
