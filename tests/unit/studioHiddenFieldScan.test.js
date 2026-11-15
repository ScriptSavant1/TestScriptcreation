/**
 * Script Studio — Correlation Advisor: values a server keeps in an HTML hidden field and a later form post sends
 * back, under any field name (BUG-141), and boundaries read from the page for HTML / text sources, also for the
 * CSRF name scan (BUG-143). studio-advisor.js: _advHiddenFieldScan, _advHtmlValueExtractor, _advFormFieldsFromText,
 * advisorScan, advisorToCorrelation.
 */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');

function advisor() {
  const src = read('studio-advisor.js');   // zero dependencies (CLAUDE.md rule 5): only S comes from outside
  const S = { entries1: [], correlations: [], advisorCandidates: [] };
  const quiet = { log() {}, warn() {}, error() {} };
  // eslint-disable-next-line no-new-func
  return new Function('S', 'console', src +
    '\nreturn { S, advisorScan, advisorToCorrelation, _advHiddenFieldScan, _advHtmlValueExtractor, _advFormFieldsFromText, _advFirstMatch };')(S, quiet);
}

const SES = '143549.817415958HDiDitDpHDDDDDDDttDADpAzct';
const TOK = 'f0e4c2a1b7d94e3a8c5d6b2e1f0a9c8d';
const page = (inputs) => '<html><body><form action="/login.pl" method="post">' + inputs + '<input name="username"/></form></body></html>';
const get = (url, respBody) => ({ method: 'GET', url: 'https://app.example.com' + url, respBody, reqHdrs: [], body: null });
const post = (url, fields, asText) => ({
  method: 'POST', url: 'https://app.example.com' + url, respBody: '<html>ok</html>', reqHdrs: [],
  body: asText
    ? { mimeType: 'application/x-www-form-urlencoded', text: fields.map(([n, v]) => n + '=' + encodeURIComponent(v)).join('&') }
    : { mimeType: 'application/x-www-form-urlencoded', params: fields.map(([name, value]) => ({ name, value })) },
});

describe('_advHtmlValueExtractor — boundaries read from the page, first match = the value', () => {
  const X = advisor();
  test('name before value: the left boundary starts at the name attribute', () => {
    const t = page('<input type="hidden" name="userSession" value="' + SES + '"/>');
    const e = X._advHtmlValueExtractor(t, SES);
    expect(e).toEqual({ extractorType: 'boundary', extractorConfig: { lb: 'name="userSession" value="', rb: '"' }, field: 'userSession' });
    expect(X._advFirstMatch(t, e.extractorConfig.lb, e.extractorConfig.rb)).toBe(SES);
  });
  test('value before name: the boundary is widened until its first match is the value', () => {
    const t = page('<input type="hidden" value="aaaa" name="other"/><input type="hidden" value="' + SES + '" name="userSession"/>');
    const e = X._advHtmlValueExtractor(t, SES);
    expect(X._advFirstMatch(t, e.extractorConfig.lb, e.extractorConfig.rb)).toBe(SES);
    expect(e.field).toBe('userSession');
  });
  test('single quotes and a <meta> tag', () => {
    const t = "<head><meta name='csrf-token' content='" + TOK + "'></head>";
    const e = X._advHtmlValueExtractor(t, TOK);
    expect(e.extractorConfig).toEqual({ lb: "name='csrf-token' content='", rb: "'" });
  });
  test('not in a tag: the nearest safe boundary around the value', () => {
    const t = 'var s = "' + SES + '";';
    const e = X._advHtmlValueExtractor(t, SES);
    expect(X._advFirstMatch(t, e.extractorConfig.lb, e.extractorConfig.rb)).toBe(SES);
  });
  test('value not in the text → null', () => expect(X._advHtmlValueExtractor('<html></html>', SES)).toBe(null));
});

describe('_advFormFieldsFromText — URL-encoded bodies only', () => {
  const X = advisor();
  test('decodes names and values', () => {
    expect(X._advFormFieldsFromText({ mimeType: 'application/x-www-form-urlencoded', text: 'a=1&user+name=jo%20jo&s=' + encodeURIComponent(SES) }))
      .toEqual([{ name: 'a', value: '1' }, { name: 'user name', value: 'jo jo' }, { name: 's', value: SES }]);
  });
  test('JSON or missing body → []', () => {
    expect(X._advFormFieldsFromText({ mimeType: 'application/json', text: '{"a":1}' })).toEqual([]);
    expect(X._advFormFieldsFromText(null)).toEqual([]);
  });
});

describe('BUG-141 — a hidden field sent back by a form post, under any name', () => {
  test('found with High confidence, source = the page with the hidden input, boundary extractor', () => {
    const X = advisor();
    X.S.entries1 = [get('/home', '<html>welcome</html>'), get('/nav.pl', page('<input type="hidden" name="userSession" value="' + SES + '"/>')), post('/login.pl', [['userSession', SES], ['username', 'jojo']])];
    X.advisorScan(X.S.entries1, []);
    const c = X.S.advisorCandidates.find((x) => x.value === SES);
    expect(c).toBeTruthy();
    expect([c.confidence, c.varName, c.source.entryIdx, c.usages.map((u) => [u.entryIdx, u.location, u.jsonPath])]).toEqual(['high', 'userSession', 1, [[2, 'body_form', 'userSession']]]);
    const corr = X.advisorToCorrelation(c);
    expect([corr.extractorType, corr.extractorConfig, corr.sourceIdx]).toEqual(['boundary', { lb: 'name="userSession" value="', rb: '"' }, 1]);
  });
  test('also from a raw text body, and every later post is a use', () => {
    const X = advisor();
    X.S.entries1 = [get('/form', page('<input type="hidden" name="state" value="' + SES + '"/>')), post('/a', [['state', SES]], true), post('/b', [['state', SES]], true)];
    const found = X._advHiddenFieldScan(X.S.entries1, new Set());
    expect(found.map((c) => [c.source.entryIdx, c.usages.map((u) => u.entryIdx)])).toEqual([[0, [1, 2]]]);
  });
  test('the nearest earlier page that has it hidden is the source', () => {
    const X = advisor();
    const hid = page('<input type="hidden" name="nonce" value="' + SES + '"/>');
    X.S.entries1 = [get('/one', hid), get('/two', hid), post('/go', [['nonce', SES]])];
    expect(X._advHiddenFieldScan(X.S.entries1, new Set())[0].source.entryIdx).toBe(1);
  });
  test('typed test data echoed into a hidden field stays test data (spaces, no digits)', () => {
    const X = advisor();
    X.S.entries1 = [get('/search', page('<input type="hidden" name="q" value="running shoes for trail"/>')), post('/go', [['q', 'running shoes for trail']])];
    expect(X._advHiddenFieldScan(X.S.entries1, new Set())).toEqual([]);
  });
  test('a value shown as text, not in a hidden input, is not a hidden-field source', () => {
    const X = advisor();
    X.S.entries1 = [get('/p', '<html><p>Your code: ' + SES + '</p><input name="code"/></html>'), post('/go', [['code', SES]])];
    expect(X._advHiddenFieldScan(X.S.entries1, new Set())).toEqual([]);
  });
  test('values already found by another phase are skipped; filtered requests and markers are ignored', () => {
    const X = advisor();
    const hid = page('<input type="hidden" name="s" value="' + SES + '"/>');
    X.S.entries1 = [get('/p', hid), post('/go', [['s', SES]])];
    expect(X._advHiddenFieldScan(X.S.entries1, new Set([SES]))).toEqual([]);
    X.S.entries1 = [Object.assign(get('/p', hid), { filtered: true }), post('/go', [['s', SES]])];
    expect(X._advHiddenFieldScan(X.S.entries1, new Set())).toEqual([]);
  });
});

describe('BUG-143 — a CSRF token on an HTML page gets boundaries, not a JSON path named after the field', () => {
  test('authenticity_token: boundary from the page', () => {
    const X = advisor();
    X.S.entries1 = [get('/form', page('<input type="hidden" name="authenticity_token" value="' + TOK + '"/>')), post('/save', [['authenticity_token', TOK]])];
    X.advisorScan(X.S.entries1, []);
    const c = X.S.advisorCandidates.find((x) => x.value === TOK);
    const corr = X.advisorToCorrelation(c);
    expect([corr.extractorType, corr.extractorConfig]).toEqual(['boundary', { lb: 'name="authenticity_token" value="', rb: '"' }]);
  });
  test('a JSON source keeps its JSON path (unchanged)', () => {
    const X = advisor();
    X.S.entries1 = [get('/api/login', JSON.stringify({ token: TOK })), post('/save', [['csrf_token', TOK]])];
    X.advisorScan(X.S.entries1, []);
    const corr = X.advisorToCorrelation(X.S.advisorCandidates.find((x) => x.value === TOK));
    expect([corr.extractorType, corr.extractorConfig]).toEqual(['jsonpath', { path: '$.token' }]);
  });
});
