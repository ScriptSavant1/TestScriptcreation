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
