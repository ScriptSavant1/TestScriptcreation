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
    // a page: value="…" first; other attributes are listed too (only those a later request sends back are marked)
    expect(E.valuesOf(r[3]).map((v) => v.value)).toEqual(['VS%2Fabc+12', 'hidden']);
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

// Regex and XPath in the editor; the generators write them for VuGen and DevWeb (checked on the wire with both
// engines: VuGen web_reg_save_param_regexp / _xpath with local-name() steps, DevWeb RegexpExtractor / XpathExtractor)
describe('Regex and XPath', () => {
  const page = '<script>window.__cfg = {"nonce":"NC-1234abcd5678", "v":2};</script>';
  test('compile: a valid expression with a ( ) group; says why otherwise', () => {
    expect(E.compile('a(b)').re).toBeInstanceOf(RegExp);
    expect(E.compile('ab').bad).toMatch(/group/);
    expect(E.compile('(').bad).toMatch(/valid/);
    expect(E.compile('').bad).toMatch(/Type/);
  });
  test('rx escapes text so it matches literally', () => {
    const s = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\o/p"q';
    expect(new RegExp('^' + E.rx(s) + '$').test(s)).toBe(true);
  });
  test('readWith: the first group of a regex; XPath through the page reader', () => {
    expect(E.readWith(resp(page), { extractorType: 'regexp', extractorConfig: { pattern: '"nonce":"([^"]+)"' } }).value).toBe('NC-1234abcd5678');
    expect(E.readWith(resp(page), { extractorType: 'regexp', extractorConfig: { pattern: '"none":"([^"]+)"' } }).none).toBe(true);
    expect(E.readWith(resp(page), { extractorType: 'regexp', extractorConfig: { pattern: 'nonce' } }).bad).toMatch(/group/);
    const xp = (body, p) => ({ value: body + '|' + p });
    expect(E.readWith(resp('<a/>'), { extractorType: 'xpath', extractorConfig: { path: '/a' } }, null, xp).value).toBe('<a/>|/a');
    expect(E.readWith(resp('<a/>'), { extractorType: 'xpath', extractorConfig: { path: '/a' } }).unknown).toBe(true);
  });
  test('fromSelection kind regexp: the safe boundaries as an expression whose first group is the value', () => {
    const x = E.fromSelection(resp(page), page.indexOf('NC-'), 'NC-1234abcd5678', 'regexp', null, St._advSafeBoundaries);
    expect(x.extractorType).toBe('regexp');
    expect(new RegExp(x.extractorConfig.pattern).exec(page)[1]).toBe('NC-1234abcd5678');
  });
  test('names: from the text in front of a value, from an XPath', () => {
    const b = '<input name="vs" value="VS1"> {"nonce":"NC-1"} <ns:Token a="1">T-1</ns:Token>';
    expect(['VS1', 'NC-1', 'T-1'].map((v) => E.nameBefore(b, b.indexOf(v)))).toEqual(['vs', 'nonce', 'Token']);
    expect([E.nameOfXpath('/config/build/@id'), E.nameOfXpath('/Env/Body/SessionToken[2]'), E.nameOfXpath('//key')]).toEqual(['buildId', 'SessionToken', 'key']);
  });
  test('valuesOf a page or XML: "name":"value" pairs, element text and attributes', () => {
    const xml = '<?xml version="1.0"?><config><build id="B-55aa66bb77">current</build><key>K-0099887766</key></config>';
    expect(E.valuesOf(resp(xml)).map((v) => v.value)).toEqual(expect.arrayContaining(['B-55aa66bb77', 'K-0099887766', 'current']));
    expect(E.valuesOf(resp(page)).map((v) => v.value)).toContain('NC-1234abcd5678');
  });
  test('the generators: VuGen regexp / xpath (local-name() steps), DevWeb RegexpExtractor / XpathExtractor (plain names)', () => {
    const rx = { name: 'nonce', extractorType: 'regexp', extractorConfig: { pattern: '"nonce":"([^"]+)"' } };
    const xp = { name: 'sid', extractorType: 'xpath', extractorConfig: { path: '/Envelope/Body/Token' } };
    expect(St.webHttpCorrCode(rx, '\t')).toBe('\tweb_reg_save_param_regexp("ParamName=nonce",\n\t    "RegExp=\\"nonce\\":\\"([^\\"]+)\\"",\n\t    "Group=1",\n\t    "Ordinal=1",\n\t    LAST);\n');
    expect(St.webHttpCorrCode(xp, '\t')).toBe("\tweb_reg_save_param_xpath(\"ParamName=sid\",\n\t    \"QueryString=/*[local-name()='Envelope']/*[local-name()='Body']/*[local-name()='Token']\",\n\t    LAST);\n");
    expect(St.devwebExtractorDecl(rx)).toBe('new load.RegexpExtractor("nonce", {expression: "\\"nonce\\":\\"([^\\"]+)\\"", flags: ""})');
    expect(St.devwebExtractorDecl(xp)).toBe('new load.XpathExtractor("sid", "/Envelope/Body/Token")');
  });
  test('vugenXpath: one rule in both copies of the VuGen writer, used by the converter', () => {
    const shared = require('../../src/web/public/shared/vugen-codegen.js'), core = require('../../src/core/vugenCodegen.js');
    const cases = { '//token': "//*[local-name()='token']", '/a/b[2]': "/*[local-name()='a']/*[local-name()='b'][2]", '/a/b/@id': "/*[local-name()='a']/*[local-name()='b']/@id", '//div[@class="x"]': '//div[@class="x"]', 'ns:a': 'ns:a' };
    Object.entries(cases).forEach(([q, want]) => { expect(shared.vugenXpath(q)).toBe(want); expect(core.vugenXpath(q)).toBe(want); });
    expect(fs.readFileSync(path.join(__dirname, '../../src/generators/vugen/scriptGenerator.js'), 'utf8')).toContain('return _vugen.vugenXpath(q);');
  });
});

describe('listValues (the values a list reads, marked in the editor)', () => {
  test('every match of each path, plain values once; not JSON or a missing path: none', () => {
    const body = JSON.stringify({ items: [{ sku: 'A1', img: 'i-1', o: { x: 1 } }, { sku: 'B2', img: 'i-1' }, { sku: 'C3' }] });
    expect(E.listValues(body, ['$.items[*].sku', '$.items[*].img'])).toEqual(['A1', 'B2', 'C3', 'i-1']);
    expect(E.listValues(body, ['$.items[*].o'])).toEqual([]);
    expect(E.listValues(body, ['$.nope[*].x'])).toEqual([]);
    expect(E.listValues('<html>', ['$.a'])).toEqual([]);
  });
});

describe('selections that read well', () => {
  test('readable: the left boundary widened by whole tokens while its first match is still the value', () => {
    const b = '<meta name="x" content="aa"><meta name="csrf-token" content="T0K-123456"><input type="hidden" name="userSession" value="143549.81">';
    expect(E.readable(b, b.indexOf('T0K'), { lb: 'tent="', rb: '"' })).toEqual({ lb: 'name="csrf-token" content="', rb: '"' });
    expect(E.readable(b, b.indexOf('1435'), { lb: 'ion" value="', rb: '"' })).toEqual({ lb: 'name="userSession" value="', rb: '"' });
    const j = '{"a":1,"nonce":"NC-1"}';
    expect(E.readable(j, j.indexOf('NC-'), { lb: 'nce":"', rb: '"' })).toEqual({ lb: '"nonce":"', rb: '"' });
    expect(E.readable(b, 5, null)).toBeNull();
  });
  test('Regex asked for on a JSON response gives a regex, not a JSON path', () => {
    const body = JSON.stringify({ tok: 'abc-123-xyz' });
    const x = E.fromSelection(resp(body), body.indexOf('abc'), 'abc-123-xyz', 'regexp', St.findJsonPath, St._advSafeBoundaries);
    expect(x.extractorType).toBe('regexp');
    expect(new RegExp(x.extractorConfig.pattern).exec(body)[1]).toBe('abc-123-xyz');
    expect(E.fromSelection(resp(body), body.indexOf('abc'), 'abc-123-xyz', 'any', St.findJsonPath, St._advSafeBoundaries).extractorType).toBe('jsonpath');
  });
  test('addresses and files a page links to are not values to correlate', () => {
    const page = '<a href="/login">x</a><frame src="nav.pl?in=home"><frame src="/WebTours/home.html"><img src="https://cdn.example.com/a.png"><input value="SESS-12345">';
    expect(E.valuesOf(resp(page)).map((v) => v.value)).toEqual(['SESS-12345']);
  });
});
