/**
 * BUG-144 — a Correlation Advisor card with no known source path (Medium confidence) used to become a boundary of the
 * value's own first 8 characters and no right boundary. advisorToCorrelation now reads it from the response that has
 * it (the card's source first, else the nearest earlier response), with boundaries whose first match is the value.
 */
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
function studio() {
  const src = ['shared/vugen-codegen.js', 'VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js'].map(read).join('\n');
  const el = { setAttribute() {}, classList: { add() {} } };
  const document = { documentElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', 'localStorage', src +
    '\nreturn { S, advisorToCorrelation, _advFirstMatch, _advPatternScan };')({ addEventListener() {} }, document, { getItem: () => null, setItem() {} });
}

let id = 1;
const ent = (url, o = {}) => Object.assign({ id: id++, url, method: 'GET', reqHdrs: [], body: null, respBody: '', isMarker: false, filtered: false }, o);
const TOKEN = 'k9Fz2Qw8Lm4Xr7Tb';
const page = '<html><body><form><input type="hidden" name="csrf_token" value="' + TOKEN + '"><input name="q" value=""></form>' +
  '<script>var other = "' + TOKEN.slice(0, 8) + 'zzzz";</script></body></html>';
const card = (o) => Object.assign({ id: 'c1', varName: 'csrf_token', value: TOKEN, confidence: 'medium', status: 'accepted',
  usages: [{ entryIdx: 2, location: 'body_form', jsonPath: 'csrf_token' }] }, o);

describe('advisorToCorrelation: a value with no known source path (BUG-144)', () => {
  test('read from the nearest earlier response that has it; the first match is the value', () => {
    const E = studio();
    E.S.entries1 = [ent('https://shop.example.com/', { respBody: '<html>home</html>' }), ent('https://shop.example.com/form', { respBody: page }),
      ent('https://shop.example.com/send', { method: 'POST' })];
    const c = E.advisorToCorrelation(card());
    expect(c.extractorType).toBe('boundary');
    expect(c.extractorConfig.lb).not.toBe(TOKEN.slice(0, 8));
    expect(c.extractorConfig.rb).toBe('"');
    expect(E._advFirstMatch(page, c.extractorConfig.lb, c.extractorConfig.rb)).toBe(TOKEN);
    expect(c.sourceIdx).toBe(1);
  });

  test("the card's own source wins over a nearer response", () => {
    const E = studio();
    E.S.entries1 = [ent('https://shop.example.com/a', { respBody: page }), ent('https://shop.example.com/b', { respBody: '{"t":"' + TOKEN + '"}' }),
      ent('https://shop.example.com/send', { method: 'POST' })];
    const c = E.advisorToCorrelation(card({ source: { entryIdx: 0 } }));
    expect(c.sourceIdx).toBe(0);
    expect(E._advFirstMatch(page, c.extractorConfig.lb, c.extractorConfig.rb)).toBe(TOKEN);
  });

  test('left-out requests and requests after the first use are not read', () => {
    const E = studio();
    E.S.entries1 = [ent('https://ads.example.net/x', { respBody: page, filtered: true }), ent('https://shop.example.com/send', { method: 'POST' }),
      ent('https://shop.example.com/form', { respBody: page })];
    const c = E.advisorToCorrelation(card({ usages: [{ entryIdx: 1, location: 'body_form', jsonPath: 'csrf_token' }] }));
    // no response before the use has it: the old fallback, unchanged
    expect(c.extractorConfig).toEqual({ lb: TOKEN.slice(0, 8), rb: '' });
  });

  test('a card with a JSON path is unchanged', () => {
    const E = studio();
    E.S.entries1 = [ent('https://api.example.com/t', { respBody: '{"t":"' + TOKEN + '"}' }), ent('https://api.example.com/u')];
    const c = E.advisorToCorrelation(card({ source: { entryIdx: 0, jsonPath: '$.t' }, usages: [{ entryIdx: 1, location: 'header', jsonPath: 'X-T' }] }));
    expect(c.extractorType).toBe('jsonpath');
    expect(c.extractorConfig).toEqual({ path: '$.t' });
  });
});

describe('_advPatternScan: a form body is not one value (BUG-144)', () => {
  const HEX = '63cb3d7b70ae25339aba254ddf4f91a6d02f739e';
  test('a form post is not read as a single token', () => {
    const E = studio();
    const form = ent('https://shop.example.com/logout', { method: 'POST', body: { mimeType: 'application/x-www-form-urlencoded', text: 'csrf_token=' + HEX, params: [{ name: 'csrf_token', value: HEX }] } });
    expect(E._advPatternScan([form], new Set()).map((c) => c.value)).not.toContain('csrf_token=' + HEX);
    const noMime = ent('https://shop.example.com/logout', { method: 'POST', body: { text: 'csrf_token=' + HEX, params: [{ name: 'csrf_token', value: HEX }] } });
    expect(E._advPatternScan([noMime], new Set())).toEqual([]);
  });
  test('a plain-text body that is a token is still found', () => {
    const E = studio();
    const plain = ent('https://api.example.com/renew', { method: 'POST', body: { mimeType: 'text/plain', text: HEX } });
    expect(E._advPatternScan([plain], new Set()).map((c) => c.value)).toEqual([HEX]);
  });
});
