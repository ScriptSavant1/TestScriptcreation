'use strict';

/**
 * Converters — request bodies, as Postman / Bruno send them (each rule checked on the VuGen and DevWeb engines):
 *   - the Content-Type they add by themselves (BUG-165), the same in both formats;
 *   - VuGen: a multipart body is written (BUG-166); a text or XML body keeps its spaces (BUG-167);
 *   - DevWeb: a JSON body under another content type is written as JSON text (BUG-168); a multi-line text body is sent
 *     as it is, without the code's indentation (BUG-169).
 */

const VuGen = require('../../src/generators/vugen/scriptGenerator.js');
const DevWeb = require('../../src/generators/devweb/scriptGenerator.js');
const { impliedContentType, looksLikeJson } = require('../../src/core/utils.js');

beforeAll(() => { jest.spyOn(console, 'log').mockImplementation(() => {}); jest.spyOn(console, 'warn').mockImplementation(() => {}); });
afterAll(() => jest.restoreAllMocks());

const COLLECTION = { info: { name: 'Bodies' } };
const req = (body, headers = [], method = 'POST') => ({ name: 'Send it', folder: '', method, url: 'https://api.example.com/it', headers, body });
const raw = (s, language) => ({ mode: 'raw', raw: s, ...(language ? { options: { raw: { language } } } : {}) });
async function devweb(...a) { const g = new DevWeb([req(...a)], COLLECTION, { thinkTime: 1 }); await g.analyze(); return g.generateAction(); }
async function vugen(...a) { const g = new VuGen([req(...a)], COLLECTION, { thinkTime: 1 }); await g.analyze(); return g.generateActionC(); }
// what DevWeb is given: the options of new load.WebRequest, run with stand-ins
const sent = (code) => {
  const at = code.indexOf('new load.WebRequest('), end = code.indexOf('}).sendSync()', at);
  const load = { global: {}, params: {}, config: { user: { args: {} } }, utils: { uuid: () => 'u' }, MultipartBody: class { constructor(p) { this.parts = p; } } };
  load.MultipartBody.StringEntry = class { constructor(n, v) { this.n = n; this.v = v; } };
  load.MultipartBody.FileEntry = class { constructor(n, f) { this.n = n; this.f = f; } };
  return new Function('load', 'App_Server', 'Api_Server', 'return ' + code.slice(at + 'new load.WebRequest('.length, end + 1))(load, 'h', 'h');
};

describe('impliedContentType', () => {
  test.each([
    [raw('{"a":1}'), 'application/json'], [raw('  [1]'), 'application/json'], [raw('{ "id": {{n}} }'), 'application/json'],
    [raw('{{payload}}'), 'text/plain'], [raw('hello'), 'text/plain'], [raw('hello', 'json'), 'text/plain'], [raw('<a/>'), 'application/xml'], [raw('<a/>', 'xml'), 'application/xml'],
    [raw('<p>x</p>', 'html'), 'text/html'], [raw('x=1', 'javascript'), 'application/javascript'],
    [{ mode: 'urlencoded', urlencoded: [] }, 'application/x-www-form-urlencoded'], [{ mode: 'formdata', formdata: [] }, null], [raw('   '), null], [null, null],
  ])('%j → %s', (b, want) => expect(impliedContentType(b)).toBe(want));
  test('looksLikeJson', () => { expect([looksLikeJson('{'), looksLikeJson(' ['), looksLikeJson('{{x}}'), looksLikeJson('a{'), looksLikeJson(null)]).toEqual([true, true, false, false, false]); });
});

describe('DevWeb', () => {
  test.each([['application/vnd.api+json'], ['application/scim+json'], ['text/json'], ['text/plain']])('%s: JSON text, not an object', async (ct) => {
    const o = sent(await devweb(raw('{"a":"x y","l":[1,2]}'), [{ key: 'Content-Type', value: ct }]));
    expect(typeof o.body).toBe('string'); expect(JSON.parse(o.body)).toEqual({ a: 'x y', l: [1, 2] });
  });
  test.each([['application/json'], ['application/json; charset=utf-8'], ['Application/JSON'], ['{{ct}}']])('%s: an object', async (ct) => {
    expect(await devweb(raw('{"a":1}'), [{ key: 'Content-Type', value: ct }])).not.toContain('JSON.stringify');
  });
  test('values put in by the script are inside the JSON text', async () => {
    expect(await devweb(raw('{"token":"{{t}}","n":1}'), [{ key: 'Content-Type', value: 'text/json' }])).toMatch(/JSON\.stringify\(\{[\s\S]*"n": 1\s*\}\)/);
  });
  test.each([['plain  text "q"\nline 2\r\nline 3'], ['<a b="1">\n  <c>John  Smith</c>\n</a>'], ['one line'], ['tick ` and "quote"\nnext']])('text body %j is sent as it is', async (s) => {
    expect(sent(await devweb(raw(s))).body).toBe(s);
  });
});

describe('VuGen', () => {
  const bodyOf = (code) => JSON.parse('"' + /"Body=((?:[^"\\]|\\.)*)"/.exec(code)[1] + '"');
  test('a text body keeps its spaces and its type', async () => {
    const c = await vugen(raw('plain  text\nline 2')); expect(bodyOf(c)).toBe('plain  text\nline 2'); expect(c).toContain('"EncType=text/plain"');
  });
  test('an XML body too', async () => {
    const c = await vugen(raw('<a>\n  <c>John  Smith</c>\n</a>')); expect(bodyOf(c)).toBe('<a>\n  <c>John  Smith</c>\n</a>'); expect(c).toContain('"EncType=application/xml"');
  });
  test('JSON with unquoted variables is still compacted', async () => {
    const c = await vugen(raw('{\n  "id": {{num}},\n  "t": "a b"\n}')); expect(c).toContain('\\"id\\":'); expect(c).not.toContain('\\n  ');
  });
  const parts = [{ key: 'a', value: '1 "q"' }, { key: 'off', value: 'no', disabled: true }, { key: 'meta', value: '{"x":1}', contentType: 'application/json' }];
  const file = { key: 'doc', type: 'file', src: '/C:/data/my file.pdf' };
  test('multipart POST: web_submit_data with its parts; a file by its name; no Content-Type header of its own', async () => {
    const c = await vugen({ mode: 'formdata', formdata: [...parts, file] }, [{ key: 'Content-Type', value: 'multipart/form-data' }, { key: 'X-A', value: '1' }]);
    expect(c).toContain('web_submit_data("Send_it"'); expect(c).toContain('"EncType=multipart/form-data"');
    expect(c).toContain('"Name=a", "Value=1 \\"q\\"", ENDITEM'); expect(c).toContain('"ContentType=application/json", ENDITEM');
    expect(c).toContain('"Name=doc", "Value=my file.pdf", "File=Yes", ENDITEM'); expect(c).toContain('// Put my file.pdf into the script folder');
    expect(c).not.toContain('Name=off'); expect(c).not.toMatch(/web_add_header\("Content-Type"/i);
  });
  test('several files under one name are several parts', async () => {
    const c = await vugen({ mode: 'formdata', formdata: [{ key: 'f', type: 'file', src: ['/a/1.txt', '/a/2.txt'] }] });
    expect(c.match(/"Name=f", "Value=\d\.txt", "File=Yes"/g)).toHaveLength(2);
  });
  test('multipart PUT: the parts in the body; a file part is left to a comment', async () => {
    const c = await vugen({ mode: 'formdata', formdata: [...parts, file] }, [], 'PUT');
    expect(c).toContain('"Method=PUT"'); expect(c).toContain('"EncType=multipart/form-data; boundary=----PerfXFormBoundary"');
    expect(c).toContain('name=\\"a\\"\\r\\n\\r\\n1 \\"q\\"\\r\\n'); expect(c).toContain('------PerfXFormBoundary--\\r\\n'); expect(c).toContain('// PUT with a file part (my file.pdf): add the file by hand');
  });
  test('an empty raw body keeps application/json', async () => { expect(await vugen(raw(''))).toContain('"EncType=application/json"'); });
  test('an empty form-data body: the request as before', async () => {
    expect(await vugen({ mode: 'formdata', formdata: [{ key: 'a', value: 'x', disabled: true }] })).toContain('web_custom_request("Send_it"');
  });
});
