/**
 * Bruno's own formats — .bru files (BUG-172), the JSON export (BUG-173), zipped folders — give the same scripts as the
 * same collection exported from Postman.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path'), JSZip = require('jszip');
const B = require('../../src/parsers/brunoFormat');
const BrunoParser = require('../../src/parsers/brunoParser');
const Converter = require('../../src/tools/collection-converter/index.js');
const { readZip } = require('../../src/core/zipReader');

// ── one journey, in each format ──
const kv = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));
const POSTMAN = {
  info: { name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' },
  variable: [{ key: 'base', value: 'https://api.example.com' }],
  item: [
    { name: 'Sign in', item: [{ name: 'Login', event: [{ listen: 'test', script: { exec: ["bru.setEnvVar('token', res.body.token)"] } }], request: { method: 'POST', url: { raw: '{{base}}/login?x=1' }, header: [{ key: 'X-App', value: 'shop' }], auth: { type: 'noauth' }, body: { mode: 'raw', raw: '{\n  "user": "{{user}}",\n  "n": 1\n}', options: { raw: { language: 'json' } } } } }] },
    { name: 'Orders', item: [
      { name: 'Read', request: { method: 'GET', url: { raw: '{{base}}/orders/:id', variable: [{ key: 'id', value: '42' }] }, header: [{ key: 'Accept', value: 'application/json' }, { key: 'Off', value: '1', disabled: true }], auth: { type: 'bearer', bearer: kv({ token: '{{token}}' }) } } },
      { name: 'Form', request: { method: 'POST', url: { raw: '{{base}}/form' }, header: [], auth: { type: 'noauth' }, body: { mode: 'urlencoded', urlencoded: [{ key: 'a', value: '1 2' }, { key: 'b', value: 'x', disabled: true }] } } },
      { name: 'Upload', request: { method: 'POST', url: { raw: '{{base}}/upload' }, header: [], auth: { type: 'noauth' }, body: { mode: 'formdata', formdata: [{ key: 'note', value: 'hello', type: 'text' }, { key: 'doc', type: 'file', src: ['files/a.pdf'] }] } } },
      { name: 'Soap', request: { method: 'POST', url: { raw: '{{base}}/soap' }, header: [{ key: 'Content-Type', value: 'text/xml' }], auth: { type: 'noauth' }, body: { mode: 'raw', raw: '<a>\n  <b>1 2</b>\n</a>', options: { raw: { language: 'xml' } } } } },
      { name: 'Graph', request: { method: 'POST', url: { raw: '{{base}}/graphql' }, header: [], auth: { type: 'noauth' }, body: { mode: 'graphql', graphql: { query: 'query q($id: ID) { order(id: $id) { total } }', variables: '{"id": 7}' } } } },
      { name: 'Basic', request: { method: 'GET', url: { raw: '{{base}}/basic' }, header: [], auth: { type: 'basic', basic: kv({ username: 'u', password: 'p' }) } } },
      { name: 'Key', request: { method: 'GET', url: { raw: '{{base}}/key' }, header: [], auth: { type: 'apikey', apikey: kv({ key: 'X-Key', value: '{{k}}', in: 'header' }) } } }] }],
};
const h = (name, value, enabled = true) => ({ name, value, enabled });
const none = { mode: 'none' };
const req = (name, seq, r, tests) => ({ type: 'http', name, seq, request: { headers: [], params: [], auth: none, body: { mode: 'none' }, script: {}, vars: {}, tests: '', ...r, ...(tests || {}) } });
const BRUNO = {
  name: 'Shop', version: '1', environments: [{ name: 'Test', variables: [h('base', 'https://api.example.com')] }],
  items: [
    { type: 'folder', name: 'Sign in', items: [req('Login', 1, { method: 'POST', url: '{{base}}/login?x=1', headers: [h('X-App', 'shop')], params: [{ name: 'x', value: '1', type: 'query', enabled: true }], body: { mode: 'json', json: '{\n  "user": "{{user}}",\n  "n": 1\n}' }, script: { res: "bru.setEnvVar('token', res.body.token)" } })] },
    { type: 'folder', name: 'Orders', items: [
      req('Read', 1, { method: 'GET', url: '{{base}}/orders/:id', params: [{ name: 'id', value: '42', type: 'path', enabled: true }], headers: [h('Accept', 'application/json'), h('Off', '1', false)], auth: { mode: 'bearer', bearer: { token: '{{token}}' } } }),
      req('Form', 2, { method: 'POST', url: '{{base}}/form', body: { mode: 'formUrlEncoded', formUrlEncoded: [h('a', '1 2'), h('b', 'x', false)] } }),
      req('Upload', 3, { method: 'POST', url: '{{base}}/upload', body: { mode: 'multipartForm', multipartForm: [{ type: 'text', ...h('note', 'hello') }, { type: 'file', ...h('doc', ['files/a.pdf']) }] } }),
      req('Soap', 4, { method: 'POST', url: '{{base}}/soap', headers: [h('Content-Type', 'text/xml')], body: { mode: 'xml', xml: '<a>\n  <b>1 2</b>\n</a>' } }),
      req('Graph', 5, { method: 'POST', url: '{{base}}/graphql', body: { mode: 'graphql', graphql: { query: 'query q($id: ID) { order(id: $id) { total } }', variables: '{"id": 7}' } } }),
      req('Basic', 6, { method: 'GET', url: '{{base}}/basic', auth: { mode: 'basic', basic: { username: 'u', password: 'p' } } }),
      req('Key', 7, { method: 'GET', url: '{{base}}/key', auth: { mode: 'apikey', apikey: { key: 'X-Key', value: '{{k}}', placement: 'header' } } })] }],
};
const block = (name, lines) => name + ' {\n' + lines.split('\n').map((l) => (l ? '  ' + l : l)).join('\n') + '\n}\n';
const bru = (name, seq, method, url, o, ...rest) => [block('meta', 'name: ' + name + '\ntype: http\nseq: ' + seq), block(method, 'url: ' + url + '\nbody: ' + (o.body || 'none') + '\nauth: ' + (o.auth || 'none'))].concat(rest).join('\n');
const FILES = {
  'shop/bruno.json': '{"version":"1","name":"Shop","type":"collection"}',
  'shop/environments/Test.bru': 'vars {\n  base: https://api.example.com\n  ~old: 1\n}\nvars:secret [\n  k\n]\n',
  'shop/Orders/folder.bru': block('meta', 'name: Orders\nseq: 2'),
  'shop/Login area/folder.bru': block('meta', 'name: Sign in\nseq: 1'),
  'shop/Login area/Login.bru': bru('Login', 1, 'post', '{{base}}/login?x=1', { body: 'json' }, block('params:query', 'x: 1'), block('headers', 'X-App: shop'), block('body:json', '{\n  "user": "{{user}}",\n  "n": 1\n}'), block('script:post-response', "bru.setEnvVar('token', res.body.token)")),
  'shop/Orders/Read.bru': bru('Read', 1, 'get', '{{base}}/orders/:id', { auth: 'bearer' }, block('params:path', 'id: 42'), block('headers', 'Accept: application/json\n~Off: 1'), block('auth:bearer', 'token: {{token}}')),
  'shop/Orders/Form.bru': bru('Form', 2, 'post', '{{base}}/form', { body: 'formUrlEncoded' }, block('body:form-urlencoded', 'a: 1 2\n~b: x')),
  'shop/Orders/Upload.bru': bru('Upload', 3, 'post', '{{base}}/upload', { body: 'multipartForm' }, block('body:multipart-form', 'note: hello\ndoc: @file(files/a.pdf)')),
  'shop/Orders/Soap.bru': bru('Soap', 4, 'post', '{{base}}/soap', { body: 'xml' }, block('headers', 'Content-Type: text/xml'), block('body:xml', '<a>\n  <b>1 2</b>\n</a>')),
  'shop/Orders/Graph.bru': bru('Graph', 5, 'post', '{{base}}/graphql', { body: 'graphql' }, block('body:graphql', 'query q($id: ID) { order(id: $id) { total } }'), block('body:graphql:vars', '{"id": 7}')),
  'shop/Orders/Basic.bru': bru('Basic', 6, 'get', '{{base}}/basic', { auth: 'basic' }, block('auth:basic', 'username: u\npassword: p')),
  'shop/Orders/Key.bru': bru('Key', 7, 'get', '{{base}}/key', { auth: 'apikey' }, block('auth:apikey', 'key: X-Key\nvalue: {{k}}\nplacement: header')),
};

let dir; const keep = [console.log, console.warn];
beforeAll(async () => {
  console.log = console.warn = () => {};
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brunofmt-'));
  const put = (f, t) => { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), t); };
  put('postman.json', JSON.stringify(POSTMAN)); put('bruno.json', JSON.stringify(BRUNO));
  const z = new JSZip(), crlf = new JSZip();
  Object.entries(FILES).forEach(([f, t]) => { z.file(f, t); crlf.file(f, t.replace(/\n/g, '\r\n')); put('folder/' + f.replace('shop/', ''), t); });
  put('shop.zip', await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })); put('crlf.zip', await crlf.generateAsync({ type: 'nodebuffer' }));
  const y = new JSZip(); y.file('y/opencollection.yml', 'opencollection: 1.0.0\ninfo:\n  name: Yam\nrequest:\n  auth:\n    type: bearer\n    token: "{{t}}"\n'); y.file('y/One/folder.yml', 'info:\n  name: Folder one\n'); y.file('y/One/a.yml', 'info:\n  name: A\n  type: http\n  seq: 1\nhttp:\n  method: GET\n  url: https://h.example.com/a\n  auth: inherit\n'); y.file('y/One/b.yml', 'info:\n  name: B\n  type: http\n  seq: 2\nhttp:\n  method: GET\n  url: https://h.example.com/b\n  auth:\n    type: basic\n    username: u\n    password: p\n'); y.file('y/One/c.yml', 'info:\n  name: C\n  type: http\n  seq: 3\nhttp:\n  method: GET\n  url: https://h.example.com/c\n');
  put('yaml.zip', await y.generateAsync({ type: 'nodebuffer' }));
  const j = new JSZip(); j.file('export/Shop.json', JSON.stringify(POSTMAN)); j.file('export/Test.environment.json', '{}'); put('one.zip', await j.generateAsync({ type: 'nodebuffer' }));
  const e = new JSZip(); e.file('readme.txt', 'x'); put('empty.zip', await e.generateAsync({ type: 'nodebuffer' }));
});
afterAll(() => { [console.log, console.warn] = keep; fs.rmSync(dir, { recursive: true, force: true }); });

const made = async (file, protocol) => {
  const out = path.join(dir, 'out-' + file.replace(/\W/g, '_') + '-' + protocol);
  await new Converter({ inputFile: path.join(dir, file), outputDir: out, protocol, scriptMode: 'single' }).convertSingle();
  return Object.fromEntries((protocol === 'devweb' ? ['main.js', 'rts.yml', 'parameters.yml'] : ['Action.c', 'vuser_init.c', 'globals.h', 'default.cfg']).filter((f) => fs.existsSync(path.join(out, f))).map((f) => [f, fs.readFileSync(path.join(out, f), 'utf8')]));
};

describe.each(['devweb', 'web-http'])('the same scripts as from Postman: %s', (protocol) => {
  let want; beforeAll(async () => { want = await made('postman.json', protocol); });
  test('the Postman script holds everything the journey has (guard)', () => {
    const t = Object.values(want).join('\n');
    ['X-App', '/orders/42', 'a.pdf', 'text/xml', 'order(id: $id)', 'Bearer'].forEach((x) => expect(t).toContain(x));
    expect(t).not.toContain('"Off"');
  });
  test.each(['bruno.json', 'shop.zip', 'crlf.zip', 'folder'])('%s', async (file) => { expect(await made(file, protocol)).toEqual(want); });
});

describe('.bru text', () => {
  test('real .bru and the older text without braces are told apart', () => {
    expect(B.isBru('meta {\n  name: A\n}\nget {\n  url: x\n}\n')).toBe(true);
    expect(B.isBru('meta\nname: A\n\nget https://x.example.com\n')).toBe(false);
  });
  test('blocks end at a brace in the first column', () => {
    expect(B.bruBlocks('body:json {\n  {\n    "a": {}\n  }\n}\ntests {\n  if (x) {\n  }\n}\nvars:secret [\n  a\n]\nempty {}\n')).toEqual({ 'body:json': '  {\n    "a": {}\n  }', tests: '  if (x) {\n  }', 'vars:secret': '  a', empty: '' });
  });
  test('pairs: values with colons, switched off, quoted names, several lines', () => {
    expect(B.bruPairs("  a: http://h:80/x\n  ~b: 1\n  \"c: d\": 2\n  // note\n  e: '''\n    one\n    two\n  '''\n  f:")).toEqual([{ name: 'a', value: 'http://h:80/x', enabled: true }, { name: 'b', value: '1', enabled: false }, { name: 'c: d', value: '2', enabled: true }, { name: 'e', value: 'one\ntwo', enabled: true }, { name: 'f', value: '', enabled: true }]);
  });
  test('a file that holds no request', () => { expect(B.bruToItem('meta {\n  name: A\n}\n')).toBe(null); });
  test('a single request file', async () => {
    const f = path.join(dir, 'One.bru'); fs.writeFileSync(f, FILES['shop/Orders/Read.bru']);
    const p = new BrunoParser(f), r = await p.parse();
    expect(r).toHaveLength(1); expect(r[0]).toMatchObject({ name: 'Read', method: 'GET', url: '{{base}}/orders/42' }); expect(p.collection.item).toHaveLength(1); expect(p.getMetadata().name).toBe('Read');
  });
  test('the older text is still read, and can be converted', async () => {
    const f = path.join(dir, 'old.bru'); fs.writeFileSync(f, 'meta\nname: Old one\n\nget https://api.example.com/old\n\nheaders\nX-A: 1\n');
    const p = new BrunoParser(f), r = await p.parse(); expect(r[0].url).toBe('https://api.example.com/old'); expect(p.collection.info.name).toBe('Old one');
    expect((await made('old.bru', 'devweb'))['main.js']).toContain('api.example.com');
  });
  test('environment: values with braces, switched off left out', () => { expect(B.bruEnvironment('vars {\n  host: h\n  base: https://{{host}}/x\n  ~off: 1\n}\n')).toEqual({ host: 'h', base: 'https://{{host}}/x' }); });
  test('multipart: content type of a part, several files', () => {
    const i = B.bruToItem('meta {\n  name: U\n}\npost {\n  url: x\n  body: multipartForm\n}\nbody:multipart-form {\n  j: {"a":1} @contentType(application/json)\n  f: @file(a.txt|b.txt)\n}\n');
    expect(B.brunoBody(i.request.body).formdata).toEqual([{ key: 'j', value: '{"a":1}', disabled: false, description: '', type: 'text', contentType: 'application/json' }, { key: 'f', type: 'file', src: ['a.txt', 'b.txt'], disabled: false, contentType: undefined }]);
  });
});

describe('sign-in, headers, scripts handed down', () => {
  const col = (root, folder, r) => B.collectionFromJson({ name: 'C', root: { request: root }, items: [{ type: 'folder', name: 'F', root: { request: folder }, items: [{ type: 'http', name: 'R', request: { method: 'GET', url: 'https://h.example.com/', ...r } }] }] }, () => 'id');
  const bearer = (t) => ({ mode: 'bearer', bearer: { token: t } });
  test('inherit: the nearest folder, else the collection; none switches it off', () => {
    const auth = (c) => c.requests[0].auth && (c.requests[0].auth.bearer ? c.requests[0].auth.bearer[0].value : c.requests[0].auth.type);
    expect(auth(col({ auth: bearer('c') }, {}, { auth: { mode: 'inherit' } }))).toBe('c');
    expect(auth(col({ auth: bearer('c') }, { auth: bearer('f') }, { auth: { mode: 'inherit' } }))).toBe('f');
    expect(auth(col({ auth: bearer('c') }, { auth: { mode: 'inherit' } }, {}))).toBe('c');
    expect(auth(col({ auth: bearer('c') }, {}, { auth: { mode: 'none' } }))).toBe('noauth');
    expect(auth(col({}, {}, {}))).toBe(null);
  });
  test('headers: the collection\'s, the folder\'s, the request\'s own wins', () => {
    const c = col({ headers: [h('X-All', '1')] }, { headers: [h('X-F', 'f'), h('X-R', 'f')] }, { headers: [h('x-r', 'own')] });
    expect(c.collection.collectionHeaders).toEqual([{ key: 'X-All', value: '1' }]); expect(c.requests[0].headers.map((x) => x.key + '=' + x.value)).toEqual(['X-F=f', 'x-r=own']);
  });
  test('scripts: the collection\'s on the collection, the folder\'s before the request\'s; values read after a response', () => {
    const c = col({ script: { req: 'c' } }, { script: { res: 'f' } }, { vars: { res: [h('tok', 'res.body.t'), h('off', 'res.body.o', false)] }, script: { req: 'p' }, tests: 't' });
    expect(c.collection.event.map((e) => e.script.exec[0])).toEqual(['c']);
    expect(c.requests[0].tests.map((e) => e.listen + ' ' + e.script.exec.join('|'))).toEqual(['test f', 'prerequest p', 'test bru.setVar("tok", res.body.t);', 'test t']);
  });
  test('variables: collection, request and the one environment; several environments: none of them', () => {
    const E = (n) => ({ name: n, variables: [h('e', n), h('x', '1', false)] });
    const mk = (envs) => B.collectionFromJson({ name: 'C', root: { request: { vars: { req: [h('a', '1')] } } }, environments: envs, items: [{ type: 'http', name: 'R', request: { url: '', vars: { req: [h('b', '2'), h('a', 'no')] } } }] }, () => 'id').collection.variable;
    expect(mk([E('one')])).toEqual([{ key: 'a', value: '1' }, { key: 'e', value: 'one' }, { key: 'b', value: '2' }]); expect(mk([E('one'), E('two')]).map((v) => v.key)).toEqual(['a', 'b']);
  });
  test('other kinds of sign-in', () => {
    expect(B.brunoAuth({ mode: 'ntlm', ntlm: { username: 'u', password: 'p', domain: 'd' } }).ntlm).toEqual(kv({ username: 'u', password: 'p', domain: 'd' }));
    expect(B.brunoAuth({ mode: 'awsv4', awsv4: { accessKeyId: 'a', secretAccessKey: 's', region: 'r', service: 'x' } }).awsv4).toEqual(kv({ accessKey: 'a', secretKey: 's', service: 'x', region: 'r' }));
    expect(B.brunoAuth({ mode: 'oauth2', oauth2: { grantType: 'client_credentials', accessTokenUrl: 'u', clientId: 'c', clientSecret: 's' } }).oauth2).toEqual(kv({ grant_type: 'client_credentials', accessTokenUrl: 'u', clientId: 'c', clientSecret: 's' }));
    expect(B.brunoAuth({ mode: 'apikey', apikey: { key: 'k', value: 'v', placement: 'queryparams' } }).apikey[2]).toEqual({ key: 'in', value: 'query' });
    expect(B.brunoAuth({ type: 'basic', username: 'u', password: 'p' }).basic[0].value).toBe('u'); expect(B.brunoAuth(undefined)).toBe(null); expect(B.brunoAuth('inherit')).toBe(null);
  });
  test('GraphQL: variables as an object, or as they are when they are not JSON', () => {
    expect(B.graphqlText({ query: 'q', variables: '{"a":1}' })).toBe('{"query":"q","variables":{"a":1}}'); expect(B.graphqlText({ query: 'q', variables: '{"a": {{n}}}' })).toBe('{"query":"q","variables":{"a": {{n}}}}'); expect(B.graphqlText({ query: 'q', variables: '' })).toBe('{"query":"q"}'); expect(B.graphqlText({ query: '' })).toBe('');
  });
});

describe('which JSON is Bruno\'s', () => {
  test('Postman and the plain shape are left to their reader', () => {
    expect(B.isBrunoJson(POSTMAN)).toBe(false); expect(B.isBrunoJson(BRUNO)).toBe(true); expect(B.isBrunoJson({ name: 'x', items: [{ name: 'a', request: { method: 'GET', url: 'u', header: [{ key: 'a', value: '1' }] } }] })).toBe(false); expect(B.isBrunoJson({ items: [] })).toBe(false); expect(B.isBrunoJson(null)).toBe(false);
  });
});

describe('zips', () => {
  test('a Bruno YAML folder: names, order, the request\'s own and the inherited sign-in', async () => {
    const p = new BrunoParser(path.join(dir, 'yaml.zip')), r = await p.parse();
    expect(r.map((x) => [x.name, x.folder, x.auth && x.auth.type])).toEqual([['A', 'Folder one', 'bearer'], ['B', 'Folder one', 'basic'], ['C', 'Folder one', null]]); expect(p.getMetadata().name).toBe('Yam');
  });
  test('one exported file; nothing to convert', async () => {
    expect((await new BrunoParser(path.join(dir, 'one.zip')).parse()).length).toBe(8);
    await expect(new BrunoParser(path.join(dir, 'empty.zip')).parse()).rejects.toThrow('no Bruno or Postman collection');
  });
  test('not a ZIP, too many files, too large, names that point outside', async () => {
    expect(() => readZip(Buffer.from('hello'))).toThrow('not a ZIP'); expect(() => readZip(Buffer.alloc(0))).toThrow('not a ZIP');
    const z = new JSZip(); z.file('a.txt', 'x'.repeat(2000)); z.file('b.txt', 'y'); const buf = await z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    expect(readZip(buf)['b.txt'].toString()).toBe('y'); expect(() => readZip(buf, { maxFiles: 1 })).toThrow('more than 1'); expect(() => readZip(buf, { maxBytes: 1000 })).toThrow('larger than');
    const evil = Buffer.from(buf); for (let i = evil.indexOf('b.txt'); i >= 0; i = evil.indexOf('b.txt', i + 1)) evil.write('../.t', i); expect(Object.keys(readZip(evil))).toEqual(['a.txt']);
    expect(() => readZip(buf.subarray(40))).toThrow();
  });
});
