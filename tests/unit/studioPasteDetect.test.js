/**
 * Script Studio — Paste & Detect: the source request, a boundary that captures the value as its FIRST match,
 * safe parameter names (studio-advisor.js _advSafeVarName, _advFirstMatch, _advSafeBoundaries; studio-ui.js
 * _pcFindSource, _pcSafeOccurrences). The page itself (card, uses, message) is checked in the browser.
 */
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');   // as the pages load it, before the engines
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');

function studio() {
  const src = ['shared/vugen-codegen.js', 'VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js', 'studio-codegen.js', 'studio-ui.js'].map(read).join('\n');
  const el = { setAttribute() {}, classList: { add() {} } };
  const document = { documentElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const window = { addEventListener() {} };
  const localStorage = { getItem: () => null, setItem() {} };
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', 'localStorage', src +
    '\nreturn { S, advPasteDetect, advisorAddManual, advisorToCorrelation, _advSafeVarName, _advFirstMatch, _advSafeBoundaries, _pcFindSource, _pcSafeOccurrences };')(window, document, localStorage);
}

const HMAC = 'f0ff4da8ca9bbed39da69549f4ae022b9599e7a032ae8c711138264aad805d82';
const PAGE = '<meta name="visitor-payload" content="eyJhIjoxfQ==" data-turbo-transient="true" />\n' +
  '<meta name="visitor-hmac" content="' + HMAC + '" data-turbo-transient="true" />';

describe('_advSafeVarName — a parameter name VuGen and DevWeb accept', () => {
  const X = studio();
  test.each([
    ['visitor-hmac', 'visitor_hmac'],
    ['my name 2', 'my_name_2'],
    ['  OrderNumber  ', 'OrderNumber'],
    ['2fa-code', 'v_2fa_code'],
    ['', ''],
    ['   ', ''],
    [null, ''],
  ])('%p → %p', (a, b) => expect(X._advSafeVarName(a)).toBe(b));

  test('Add Manual keeps a valid name and makes a hyphen safe', () => {
    X.S.entries1 = []; X.S.advisorCandidates = [];
    expect(X.advisorAddManual(0, 'boundary', 'x', 'CustomerId', null).varName).toBe('CustomerId');
    expect(X.advisorAddManual(0, 'boundary', 'x', 'visitor-hmac', null).varName).toBe('visitor_hmac');
  });
});

describe('Boundaries that capture the value as their first match', () => {
  const X = studio();
  test('_advFirstMatch: what a boundary extractor captures (Ord=1)', () => {
    expect(X._advFirstMatch(PAGE, 'content="', '"')).toBe('eyJhIjoxfQ==');      // the first meta, not the value
    expect(X._advFirstMatch(PAGE, 'nope', '"')).toBe(null);
  });
  test('_advSafeBoundaries widens the left boundary until the first match is the value', () => {
    const at = PAGE.indexOf(HMAC);
    const b = X._advSafeBoundaries(PAGE, at, HMAC, 'content="', '"');
    expect(X._advFirstMatch(PAGE, b.lb, b.rb)).toBe(HMAC);
    expect(b.lb.endsWith('content="')).toBe(true);
  });
  test('Paste & Detect: the widened boundary, readable from the start of the word, no occurrence number', () => {
    const res = X.advPasteDetect(PAGE, HMAC);
    expect(res.lb).toBe('content="');                                           // Detect alone: the first meta would be captured
    X._pcSafeOccurrences(res, PAGE);
    expect(res.lb).toBe('name="visitor-hmac" content="');
    expect(res.rb).toBe('"');
    expect(X._advFirstMatch(PAGE, res.lb, res.rb)).toBe(HMAC);
    expect(res.allOccurrences[0]._first).toBe(true);
  });
  test('a boundary that already captures the value keeps working (widened at most to the start of the word)', () => {
    const v = 'Zq9Kx2Lm7Np4';
    const text = '<form><input type="hidden" name="sid" value="' + v + '"></form>';
    const res = X.advPasteDetect(text, v);
    expect(res.extType).toBe('boundary');
    const lb = res.lb;
    X._pcSafeOccurrences(res, text);
    expect(X._advFirstMatch(text, res.lb, res.rb)).toBe(v);
    expect(res.lb.endsWith(lb)).toBe(true);
  });
  test('a regular-expression result (a hex token) is left alone', () => {
    const text = 'token=' + HMAC + '; end';
    const res = X.advPasteDetect(text, HMAC);
    const before = JSON.stringify(res);
    X._pcSafeOccurrences(res, text);
    expect(res.extType).toBe('regexp');
    expect(JSON.stringify(res)).toBe(before);
  });
  test('a JSON result is left alone', () => {
    const res = X.advPasteDetect('{"hmac":"' + HMAC + '"}', HMAC);
    X._pcSafeOccurrences(res, '{"hmac":"' + HMAC + '"}');
    expect([res.extType, res.path]).toEqual(['jsonpath', '$.hmac']);
  });
});

describe('_pcFindSource — the request whose recorded response holds the value', () => {
  const X = studio();
  const e = (respBody, o) => Object.assign({ respBody, url: 'https://app.example.com/x', method: 'GET' }, o || {});
  beforeEach(() => {
    X.S.entries1 = [e('{"ok":true}'), e(PAGE), e('{"items":[]}'), e('{"saved":true}'), e('again ' + HMAC), e('{}')];
  });
  test('no request picked in step 3: the first response that holds it', () => expect(X._pcFindSource(HMAC, NaN)).toBe(1));
  test('a later user picked: the last response before it', () => {
    expect(X._pcFindSource(HMAC, 3)).toBe(1);
    expect(X._pcFindSource(HMAC, 5)).toBe(4);
  });
  test('the source itself picked in step 3: that request', () => {
    X.S.entries1[1].respBody = '{}';
    expect(X._pcFindSource(HMAC, 4)).toBe(4);
  });
  test('filtered requests and markers are skipped; nowhere → -1', () => {
    X.S.entries1[1].filtered = true; X.S.entries1[4].isMarker = true;
    expect(X._pcFindSource(HMAC, NaN)).toBe(-1);
    expect(X._pcFindSource('', NaN)).toBe(-1);
  });
});

describe('a Paste & Detect card becomes the same correlation', () => {
  test('the exact extractor (_paste) wins over the manual type', () => {
    const X = studio();
    X.S.entries1 = []; X.S.advisorCandidates = [];
    const cand = X.advisorAddManual(0, 'boundary', 'content="', 'visitor-hmac', null);
    cand._paste = { extractorType: 'boundary', extractorConfig: { lb: 'name="visitor-hmac" content="', rb: '"' } };
    const corr = X.advisorToCorrelation(cand);
    expect([corr.name, corr.extractorType, corr.extractorConfig]).toEqual(['visitor_hmac', 'boundary', { lb: 'name="visitor-hmac" content="', rb: '"' }]);
  });
});
