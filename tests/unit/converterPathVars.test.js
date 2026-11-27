/**
 * Path variables (/orders/:id) in the collection converters — BUG-171.
 * Postman url.variable, Bruno YAML http.params and Bruno JSON request.params of type path.
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const { fillPathVariables } = require('../../src/core/utils');
const BrunoParser = require('../../src/parsers/brunoParser');
const Converter = require('../../src/tools/collection-converter/index.js');
const { buildPreview } = require('../../src/web/convertPreview');

describe('fillPathVariables', () => {
  const f = fillPathVariables;
  test('a whole path segment is filled, nothing else', () => {
    expect(f('https://api.example.com/orders/:id/items/:item?x=:id#:id', [{ key: 'id', value: '42' }, { key: 'item', value: 'a' }])).toBe('https://api.example.com/orders/42/items/a?x=:id#:id');
    expect(f('https://api.example.com:8080/v1/jobs:run/:id', [{ key: 'id', value: '1' }, { key: '8080', value: 'no' }, { key: 'run', value: 'no' }])).toBe('https://api.example.com:8080/v1/jobs:run/1');
    expect(f('{{base}}/:id', [{ key: 'id', value: '1' }])).toBe('{{base}}/1');
    expect(f('{{base}}:8080/:id/', [{ key: 'id', value: '1' }])).toBe('{{base}}:8080/1/');
    expect(f('/:idx', [{ key: 'id', value: '1' }])).toBe('/:idx');
  });
  test('variables are kept, characters that would end the path are encoded', () => {
    expect(f('{{b}}/:id', [{ key: 'id', value: 'A-{{order id}}?b c' }])).toBe('{{b}}/A-{{order id}}%3Fb%20c');
    expect(f('{{b}}/:id', [{ key: 'id', value: 'a/b%20$&' }])).toBe('{{b}}/a/b%20$&');
    expect(f('{{b}}/:id', [{ key: 'id', value: 7 }])).toBe('{{b}}/7');
    expect(f('{{b}}/:id', [{ key: 'id', value: 0 }])).toBe('{{b}}/0');
  });
  test('without a value: a variable to give a value to; a segment not in the list stays', () => {
    expect(f('{{b}}/:id/:x', [{ key: 'id', value: '' }])).toBe('{{b}}/{{id}}/:x');
    expect(f('{{b}}/:id', [{ key: 'id', value: null }])).toBe('{{b}}/{{id}}');
    expect(f('{{b}}/:a b', [{ key: 'a b', value: '' }])).toBe('{{b}}/:a b');
  });
  test('the last one with a name counts; names as key, name or id; none at all', () => {
    expect(f('/:id', [{ key: 'id', value: '1' }, { key: 'id', value: '2' }])).toBe('/2');
    expect(f('/:id', [{ name: 'id', value: '1' }])).toBe('/1');
    expect(f('/:id', [{ id: 'id', value: '1' }])).toBe('/1');
    expect(f('/:id', [{ key: ' id\n', value: '1' }])).toBe('/1');
    expect(f('/:id', [{ key: 'id', value: '1', disabled: true }])).toBe('/:id');
    expect(f('/:id', [])).toBe('/:id'); expect(f('/:id', undefined)).toBe('/:id'); expect(f('/:id', [null, {}])).toBe('/:id'); expect(f(undefined, [{ key: 'a' }])).toBe(undefined);
  });
});

describe('in the parsers', () => {
  const p = new BrunoParser('/x.json');
  test('Postman, with and without raw', () => {
    const variable = [{ key: 'id', value: '42' }];
    expect(p.normalizeRequest({ name: 'a', request: { method: 'GET', url: { raw: 'https://h.example.com/o/:id', variable } } }, '').url).toBe('https://h.example.com/o/42');
    expect(p.normalizeRequest({ name: 'a', request: { method: 'GET', url: { protocol: 'https', host: ['h', 'example', 'com'], path: ['o', ':id'], variable } } }, '').url).toBe('https://h.example.com/o/42');
    expect(p.normalizeRequest({ name: 'a', request: { method: 'GET', url: 'https://h.example.com/o/:id' } }, '').url).toBe('https://h.example.com/o/:id');
    expect(p.normalizeRequest({ name: 'a', request: 'https://h.example.com/o/:id' }, '').url).toBe('');
  });
  test('Bruno JSON and Bruno YAML; query parameters are not path variables', () => {
    const params = [{ name: 'id', value: '9', type: 'query' }, { name: 'id', value: '42', type: 'path' }];
    expect(p.normalizeRequest({ name: 'a', request: { method: 'GET', url: '{{b}}/o/:id?id=9', params } }, '').url).toBe('{{b}}/o/42?id=9');
    expect(p.normalizeBrunoYamlRequest({ info: { name: 'a' }, http: { method: 'GET', url: '{{b}}/o/:id?id=9', params } }, '').url).toBe('{{b}}/o/42?id=9');
    expect(p.normalizeBrunoYamlRequest({ info: { name: 'a' }, http: { method: 'GET', url: '{{b}}/o/:id' } }, '').url).toBe('{{b}}/o/:id');
  });
});

describe('in the scripts', () => {
  let dir; const keep = [console.log, console.warn];
  beforeAll(() => {
    console.log = console.warn = () => {};
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pathvars-'));
    const req = (name, raw, variable, test) => ({ name, request: { method: 'GET', header: [], url: { raw, variable } }, event: test ? [{ listen: 'test', script: { exec: [test] } }] : [] });
    fs.writeFileSync(path.join(dir, 'c.json'), JSON.stringify({ info: { name: 'Shop', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [
      req('New', 'https://api.example.com/new', undefined, "pm.environment.set('orderId', pm.response.json().id);"),
      req('Fixed', 'https://api.example.com/orders/:id', [{ key: 'id', value: '42' }]),
      req('Read', 'https://api.example.com/orders/:id', [{ key: 'id', value: '{{orderId}}' }]),
      req('Open', 'https://api.example.com/parts/:part', [{ key: 'part', value: '' }])] }));
  });
  afterAll(() => { [console.log, console.warn] = keep; fs.rmSync(dir, { recursive: true, force: true }); });
  const run = async (protocol, values) => {
    const out = path.join(dir, protocol + (values ? '-v' : ''));
    const c = new Converter({ inputFile: path.join(dir, 'c.json'), outputDir: out, protocol, scriptMode: 'single', values });
    await c.convertSingle();
    return { c, out, text: fs.readFileSync(path.join(out, protocol === 'devweb' ? 'main.js' : 'Action.c'), 'utf8') };
  };
  test('DevWeb: the value, the correlated value, and nothing sent as written', async () => {
    const { text } = await run('devweb');
    expect(text).toContain('/orders/42'); expect(text).toContain('/orders/${load.global.orderId}'); expect(text).not.toMatch(/\/:(id|part)/);
  });
  test('VuGen: the same', async () => {
    const { text } = await run('web-http');
    expect(text).toContain('/orders/42'); expect(text).toContain('/orders/{orderId}'); expect(text).not.toMatch(/\/:(id|part)/);
  });
  test('an empty one is listed as a value to give, and the value given is sent', async () => {
    const { c, out } = await run('devweb');
    const v = buildPreview({ kind: 'collection', ...c.previewSource, files: [], outputDir: out }).variables.find((x) => x.name === 'part');
    expect(v.source).toBe('missing'); expect(v.usedBy).toEqual([4]);
    const given = await run('devweb', { part: 'P-7' });
    expect(given.text).not.toContain('{{part}}');
    const all = fs.readdirSync(given.out).map((f) => fs.statSync(path.join(given.out, f)).isFile() ? fs.readFileSync(path.join(given.out, f), 'utf8') : '').join('\n');
    expect(all).toContain('P-7');
  });
});
