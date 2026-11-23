/**
 * BUG-151 — a Correlation Advisor value that no response has before it is first sent was made in the browser (a hash,
 * a UUID a page script makes). It is marked (_browser), cannot be accepted into the script as a read value (it used to
 * become a boundary of its own first 8 characters), and the editor's own choice of a response still can.
 */
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
function studio() {
  const src = ['shared/vugen-codegen.js', 'VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js', 'studio-codegen.js', 'studio-ui.js'].map(read).join('\n') +
    '\nfunction regenerateFromAdvisor() { S._regen = (S._regen || 0) + 1; }\nfunction showToast(m) { S._toast = m; }';
  const el = { setAttribute() {}, classList: { add() {} } };
  const document = { documentElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', 'localStorage', src +
    '\nreturn { S, _advMadeInBrowser, advisorCanAccept, advisorAccept, advisorApplyAndRegen, advisorScan };')({ addEventListener() {} }, document, { getItem: () => null, setItem() {} });
}

let id = 1;
const ent = (url, o = {}) => Object.assign({ id: id++, url, method: 'GET', reqHdrs: [], hdrsMap: {}, body: null, respBody: '', respHdrsMap: {}, isMarker: false, filtered: false }, o);
const UUID = '92e274e0-a2e2-4c54-b6fe-dc5195b2ae59';
const cand = (o) => Object.assign({ id: 'adv-0', value: UUID, varName: 'correlationId', confidence: 'medium', status: 'pending', source: null,
  usages: [{ entryIdx: 2, url: 'POST /api/orders', location: 'header', jsonPath: 'X-Correlation-Id' }] }, o);

describe('_advMadeInBrowser', () => {
  test('no earlier response has it: made in the browser', () => {
    const E = studio();
    const es = [ent('https://shop.example.com/'), ent('https://shop.example.com/app.js', { respBody: 'function id(){return crypto.randomUUID()}' }), ent('https://shop.example.com/api/orders', { method: 'POST' }),
      ent('https://shop.example.com/later', { respBody: '{"id":"' + UUID + '"}' })];
    expect(E._advMadeInBrowser(cand(), es)).toBe(true);
  });
  test('an earlier body or header has it (as written or URL-encoded): not browser-made', () => {
    const E = studio();
    expect(E._advMadeInBrowser(cand(), [ent('https://a.example.com/', { respBody: '<meta content="' + UUID + '">' }), ent('https://a.example.com/x'), ent('https://a.example.com/y')])).toBe(false);
    expect(E._advMadeInBrowser(cand(), [ent('https://a.example.com/', { respHdrsMap: { 'set-cookie': 'cid=' + UUID + '; Path=/' } }), ent('https://a.example.com/x'), ent('https://a.example.com/y')])).toBe(false);
    const v = 'a/b+c=d==long-token-value';
    expect(E._advMadeInBrowser(cand({ value: v }), [ent('https://a.example.com/', { respHdrsMap: { location: '/next?t=' + encodeURIComponent(v) } }), ent('https://a.example.com/x'), ent('https://a.example.com/y')])).toBe(false);
  });
  test('a left-out response counts (the server sent it); a card with a source, a list or a manual one is never browser-made', () => {
    const E = studio();
    expect(E._advMadeInBrowser(cand(), [ent('https://shop.example.com/page', { respBody: UUID, filtered: true }), ent('https://a.example.com/x'), ent('https://a.example.com/y')])).toBe(false);
    const es = [ent('https://a.example.com/', { respBody: 'nothing' }), ent('https://a.example.com/x'), ent('https://a.example.com/y')];
    expect(E._advMadeInBrowser(cand(), es)).toBe(true);
    expect(E._advMadeInBrowser(cand({ source: { entryIdx: 0 } }), es)).toBe(false);
    expect(E._advMadeInBrowser(cand({ _selectAll: true }), es)).toBe(false);
    expect(E._advMadeInBrowser(cand({ _manual: true }), es)).toBe(false);
  });
});

describe('accepting a browser-made value', () => {
  test('cannot be accepted, nor applied; a toast says why', () => {
    const E = studio();
    const c = cand({ _browser: true });
    E.S.advisorCandidates = [c]; E.S.correlations = [];
    expect(E.advisorCanAccept(c)).toBe(false);
    E.advisorAccept(c.id);
    expect(c.status).toBe('pending');
    expect(E.S._toast).toMatch(/Made in the browser/);
    c.status = 'accepted';   // ticked some other way: still never written into the script
    E.advisorApplyAndRegen();
    expect(E.S.correlations).toEqual([]);
  });
  test('a response chosen in the editor (_edit) can be accepted', () => {
    const E = studio();
    const c = cand({ _browser: true, _edit: { extractorType: 'boundary', extractorConfig: { lb: 'id="', rb: '"' }, sourceIdx: 0 } });
    expect(E.advisorCanAccept(c)).toBe(true);
  });
});

describe('advisorScan marks them', () => {
  test('a UUID a page script put in a JSON body is marked; a value from a response is not', () => {
    const E = studio();
    const TOK = 'f1e2d3c4b5a6978877665544332211aa';
    E.S.entries1 = [
      ent('https://shop.example.com/api/login', { method: 'POST', respBody: JSON.stringify({ token: TOK }) }),
      ent('https://shop.example.com/api/orders', { method: 'POST', reqHdrs: [{ name: 'X-Token', value: TOK }], hdrsMap: { 'x-token': TOK },
        body: { mimeType: 'application/json', text: JSON.stringify({ correlationId: UUID, item: 'shoes' }) } }),
    ];
    E.S.correlations = [];
    E.advisorScan(E.S.entries1, []);
    const byVal = Object.fromEntries((E.S.advisorCandidates || []).map((c) => [c.value, c]));
    expect(byVal[UUID] && byVal[UUID]._browser).toBe(true);
    expect(byVal[TOK] && byVal[TOK]._browser).toBeFalsy();
  });
});
