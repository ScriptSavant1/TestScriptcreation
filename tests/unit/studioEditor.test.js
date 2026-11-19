/**
 * Script Studio — the correlation editor (portal/studio-editor.js, UMD StudioEdit) and the engine's side of it:
 *  - jget: the value at a JSON path ([*] = the first element, as a single extractor reads); paths it does not follow
 *    say so instead of failing
 *  - readWith: what an extractor reads from one response (JSON path, boundaries = first match, a response header)
 *  - fromSelection: a selected value → a JSON path when the body is JSON, else boundaries that capture it first
 *  - advisorToCorrelation honours the editor's choice (_edit: extractor + the response it is read from); without it
 *    nothing changes
 */
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
const fs = require('fs');
const path = require('path');
const E = require('../../src/web/public/portal/studio-editor.js');

const PUB = path.join(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
function studio() {
  const src = ['shared/vugen-codegen.js', 'VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js', 'studio-codegen.js'].map(read).join('\n');
  const el = { setAttribute() {}, classList: { add() {} } };
  const document = { documentElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', 'localStorage', src +
    '\nreturn { S, advisorToCorrelation, _advFirstMatch, _advSafeBoundaries, findJsonPath, webHttpCorrCode, devwebExtractorDecl };')({ addEventListener() {} }, document, { getItem: () => null, setItem() {} });
}
const St = studio();

const json = '{"session":{"id":"s-123456","list":[{"k":"a1"},{"k":"b2"}]},"other":"s-123456x"}';
const resp = (body, hdrs) => ({ respBody: body, respHdrsMap: hdrs || {} });

describe('StudioEdit.jget', () => {
  const o = JSON.parse(json);
  test('plain, indexed, quoted and [*] paths', () => {
    expect(E.jget(o, '$.session.id')).toEqual({ value: 's-123456' });
    expect(E.jget(o, '$.session.list[1].k')).toEqual({ value: 'b2' });
    expect(E.jget(o, "$['session']['id']")).toEqual({ value: 's-123456' });
    expect(E.jget(o, '$.session.list[*].k')).toEqual({ value: 'a1' });
  });
  test('a missing field is none; a path it does not follow is unknown', () => {
    expect(E.jget(o, '$.session.nope')).toEqual({ none: true });
    expect(E.jget(o, '$..id')).toEqual({ unknown: true });
    expect(E.jget(o, '$.session.list[?(@.k=="a1")]')).toEqual({ unknown: true });
    expect(E.jget(o, 'session.id')).toEqual({ unknown: true });
  });
});

describe('StudioEdit.readWith', () => {
  const fm = St._advFirstMatch;
  test('JSON path, boundaries (first match) and a header', () => {
    expect(E.readWith(resp(json), { extractorType: 'jsonpath', extractorConfig: { path: '$.session.id' } }, fm)).toEqual({ value: 's-123456' });
    expect(E.readWith(resp(json), { extractorType: 'boundary', extractorConfig: { lb: '"id":"', rb: '"' } }, fm)).toEqual({ value: 's-123456' });
    expect(E.readWith(resp('', { 'x-token': 'abc' }), { extractorType: 'boundary_header', extractorConfig: { lb: 'X-Token: ', rb: '\r\n' } }, fm)).toEqual({ value: 'abc' });
  });
  test('not JSON, nothing found, no right boundary, other extractors', () => {
    expect(E.readWith(resp('<html>'), { extractorType: 'jsonpath', extractorConfig: { path: '$.a' } }, fm)).toEqual({ none: true, why: 'not JSON' });
    expect(E.readWith(resp(json), { extractorType: 'boundary', extractorConfig: { lb: 'zzz', rb: '"' } }, fm)).toEqual({ none: true });
    expect(E.readWith(resp(json), { extractorType: 'boundary', extractorConfig: { lb: '"id":"', rb: '' } }, fm)).toEqual({ unknown: true });
    expect(E.readWith(resp(json), { extractorType: 'cookie', extractorConfig: { cookieName: 'a' } }, fm)).toEqual({ unknown: true });
  });
});

describe('StudioEdit.fromSelection', () => {
  const at = json.indexOf('s-123456');
  test('JSON body: the JSON path of the value', () => {
    expect(E.fromSelection(resp(json), at, 's-123456', 'any', St.findJsonPath, St._advSafeBoundaries)).toEqual({ extractorType: 'jsonpath', extractorConfig: { path: '$.session.id' } });
  });
  test('Boundaries asked for: boundaries whose first match is the value', () => {
    const x = E.fromSelection(resp(json), at, 's-123456', 'boundary', St.findJsonPath, St._advSafeBoundaries);
    expect(x.extractorType).toBe('boundary');
    expect(St._advFirstMatch(json, x.extractorConfig.lb, x.extractorConfig.rb)).toBe('s-123456');
  });
  test('HTML body: boundaries; a selection that is not at that place gives nothing', () => {
    const html = '<input name="a" value="v1"><input name="tok" value="T0K3N-99">';
    const x = E.fromSelection(resp(html), html.indexOf('T0K3N-99'), 'T0K3N-99', 'any', St.findJsonPath, St._advSafeBoundaries);
    expect(St._advFirstMatch(html, x.extractorConfig.lb, x.extractorConfig.rb)).toBe('T0K3N-99');
    expect(E.fromSelection(resp(html), 0, 'T0K3N-99', 'any', St.findJsonPath, St._advSafeBoundaries)).toBeNull();
  });
  test('headersWith lists the headers that carry the value exactly', () => {
    expect(E.headersWith(resp('', { 'x-a': 'v', 'x-b': 'vv', 'x-c': 'v' }), 'v')).toEqual(['x-a', 'x-c']);
  });
});

describe('advisorToCorrelation and the editor\'s choice (_edit)', () => {
  const cand = () => ({ id: 'adv-0', value: 's-123456', varName: 'sid', confidence: 'high', status: 'accepted', source: { entryIdx: 2, url: '/login', jsonPath: '$.session.id' }, usages: [{ entryIdx: 5, url: '/next', location: 'header', jsonPath: 'X-Session' }] });
  test('without _edit: the engine\'s own choice, as before', () => {
    const c = St.advisorToCorrelation(cand());
    expect([c.extractorType, c.extractorConfig, c.sourceIdx]).toEqual(['jsonpath', { path: '$.session.id' }, 2]);
  });
  test('with _edit: the chosen extractor and the chosen response', () => {
    const x = cand(); x._edit = { extractorType: 'boundary', extractorConfig: { lb: '"id":"', rb: '"' }, sourceIdx: 4 };
    const c = St.advisorToCorrelation(x);
    expect([c.extractorType, c.extractorConfig, c.sourceIdx, c.name]).toEqual(['boundary', { lb: '"id":"', rb: '"' }, 4, 'sid']);
    expect(c.usages).toHaveLength(1);
    expect(St.webHttpCorrCode(c, '')).toContain('web_reg_save_param');
    expect(St.devwebExtractorDecl(c)).toContain('new load.BoundaryExtractor("sid"');
  });
  test('a list being rebuilt keeps its own extractor', () => {
    const x = cand(); x._arrayReconstruct = true; x._arrayConfig = { targetArrayKey: 'lines', columns: [] }; x.usages = [{ entryIdx: 5, location: 'body_array' }];
    x._edit = { extractorType: 'boundary', extractorConfig: { lb: 'a', rb: 'b' }, sourceIdx: 4 };
    expect(St.advisorToCorrelation(x).extractorType).toBe('array_reconstruct');
  });
});

// Add manual correlation (the editor's add screen): which values of a response a later request sends back
describe('valuesOf / sentIndex / laterValues', () => {
  const ent = (o) => Object.assign({ method: 'GET', url: 'https://app.example.com/', reqHdrs: [], body: null, respBody: '', respHdrsMap: {} }, o);
  const rec = () => [
    ent({ url: 'https://app.example.com/login', respBody: JSON.stringify({ token_type: 'Bearer', access: 'tok-ABCDEF123', n: 4711, ok: true, small: 'ab', spaced: 'two words', echo: 'shoes' }),
      respHdrsMap: { 'content-type': 'application/json', 'x-csrf': 'csrf-998877', 'set-cookie': 'SID=cookie-value-1' } }),
    ent({ url: 'https://app.example.com/cart/4711', reqHdrs: [{ name: 'Authorization', value: 'Bearer tok-ABCDEF123' }, { name: 'Cookie', value: 'SID=cookie-value-1' }] }),
    ent({ url: 'https://app.example.com/save', method: 'POST', body: { text: 'csrf=csrf-998877&q=shoes' } }),
    ent({ url: 'https://app.example.com/page', respBody: '<form><input type="hidden" name="vs" value="VS%2Fabc+12"><input name="x" value="hi"></form>' }),
    ent({ url: 'https://app.example.com/post', method: 'POST', body: { text: 'vs=VS%2Fabc%2B12' } }),
  ];
  test('valuesOf: JSON leaves with their path, page value attributes, headers; not words, short, spaced or infrastructure', () => {
    const r = rec();
    expect(E.valuesOf(r[0]).map((v) => [v.value, v.where, v.kind])).toEqual([
      ['tok-ABCDEF123', '$.access', 'json'], ['4711', '$.n', 'json'], ['shoes', '$.echo', 'json'], ['csrf-998877', 'x-csrf', 'header']]);
    expect(E.valuesOf(r[3]).map((v) => v.value)).toEqual(['VS%2Fabc+12']);
    expect(E.valuesOf(ent({ respBody: JSON.stringify({ a: { 'b-c': ['x1y2z3'] } }) }))[0].where).toBe("$.a['b-c'][0]");
  });
  test('sentIndex.later: sent by a request AFTER the response (address, headers, body, URL-decoded); not the Cookie header', () => {
    const r = rec(), ix = E.sentIndex(r);
    expect(ix.later('tok-ABCDEF123', 0)).toBe(true);
    expect(ix.later('4711', 0)).toBe(true);
    expect(ix.later('csrf-998877', 0)).toBe(true);
    expect(ix.later('csrf-998877', 2)).toBe(false);          // not after its own request
    expect(ix.later('cookie-value-1', 0)).toBe(false);       // the engine sends cookies itself
    expect(ix.later('VS/abc+12', 3)).toBe(true);             // decoded form value, a value with delimiters
    expect(ix.later('abc', 0)).toBe(false);                  // under 4 characters
  });
  test('laterValues: the values of one response that are sent back later; filtered and marker requests send nothing', () => {
    const r = rec();
    expect(E.laterValues(r, 0, E.sentIndex(r)).map((v) => v.value)).toEqual(['tok-ABCDEF123', '4711', 'shoes', 'csrf-998877']);
    r[1].filtered = true; r[2].isMarker = true;
    expect(E.laterValues(r, 0, E.sentIndex(r)).map((v) => v.value)).toEqual([]);
  });
});
