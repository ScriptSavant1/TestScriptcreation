/**
 * Script Studio, step 2 — the engine functions behind the Correlate table's extra actions:
 *  - _advFindUsages: the usage scan of advisorAddManual as one function (JSON body, form, query, headers with or
 *    without Bearer, address path); advisorAddManual gives the same usages as before
 *  - advisorSuggestMore: values a JSON response sends that a later request sends back, which the Advisor's own scan
 *    leaves out (short, numbers, past 20) — Medium, not ticked, never twice, never a test data value or common word
 *  - advisorRemoveFromScript / advisorRestoreToScript: take an applied correlation out again, and Undo
 */
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
function studio() {
  const src = ['shared/vugen-codegen.js', 'VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js', 'studio-codegen.js', 'studio-ui.js'].map(read).join('\n') +
    '\nfunction regenerateFromAdvisor() { S._regen = (S._regen || 0) + 1; }';
  const el = { setAttribute() {}, classList: { add() {} } };
  const document = { documentElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', 'localStorage', src +
    '\nreturn { S, _advFindUsages, advisorAddManual, advisorSuggestMore, advisorApplyAndRegen, advisorRemoveFromScript, advisorRestoreToScript, advisorToCorrelation, advisorApplyOne, advisorSetListPick, toggleCorrRandSelect };')({ addEventListener() {} }, document, { getItem: () => null, setItem() {} });
}

let id = 1;
const ent = (url, o = {}) => Object.assign({ id: id++, url, method: 'GET', reqHdrs: [], body: null, respBody: '', isMarker: false, filtered: false }, o);
const recording = () => [
  ent('https://api.example.com/login', { method: 'POST', respBody: JSON.stringify({ token: 'tok-ABCDEFGHIJKL', cart: 4711, lang: 'en', short: 'Q7x2', note: 'two words', echo: 'shoes' }) }),
  ent('https://api.example.com/cart/4711', { reqHdrs: [{ name: 'Authorization', value: 'Bearer tok-ABCDEFGHIJKL' }] }),
  ent('https://api.example.com/items?code=Q7x2&lang=en', { method: 'POST', body: { mimeType: 'application/json', text: '{"q":"shoes","note":"two words"}' } }),
  ent('https://api.example.com/form', { method: 'POST', body: { mimeType: 'application/x-www-form-urlencoded', text: 't=tok-ABCDEFGHIJKL', params: [{ name: 't', value: 'tok-ABCDEFGHIJKL' }] } }),
];

describe('_advFindUsages (the scan of advisorAddManual)', () => {
  test('every kind of place, after the source only', () => {
    const E = studio();
    const us = E._advFindUsages(recording(), 0, 'tok-ABCDEFGHIJKL');
    expect(us.map((u) => [u.entryIdx, u.location, u.jsonPath])).toEqual([[1, 'header', 'Authorization'], [3, 'body_form', 't']]);
    expect(E._advFindUsages(recording(), 0, '4711').map((u) => u.location)).toEqual(['url_path']);
    expect(E._advFindUsages(recording(), 2, 'tok-ABCDEFGHIJKL').map((u) => u.entryIdx)).toEqual([3]);
    expect(E._advFindUsages(recording(), 0, 'en')).toEqual([]);   // under 4 characters
  });
  test('advisorAddManual gives the same usages', () => {
    const E = studio();
    Object.assign(E.S, { entries1: recording(), advisorCandidates: [], correlations: [] });
    const c = E.advisorAddManual(0, 'jsonpath', '$.token', 'token', 'tok-ABCDEFGHIJKL');
    expect(c.usages).toEqual(E._advFindUsages(E.S.entries1, 0, 'tok-ABCDEFGHIJKL'));
  });
});

describe('advisorSuggestMore', () => {
  test('adds what a response sends and a later request sends back, Medium and not ticked', () => {
    const E = studio();
    Object.assign(E.S, { entries1: recording(), advisorCandidates: [{ id: 'adv-0', value: 'tok-ABCDEFGHIJKL', status: 'pending' }], correlations: [] });
    const n = E.advisorSuggestMore(['shoes']);
    const more = E.S.advisorCandidates.filter((c) => c._more);
    expect(n).toBe(2);
    expect(more.map((c) => c.value).sort()).toEqual(['4711', 'Q7x2']);
    more.forEach((c) => { expect(c.confidence).toBe('medium'); expect(c.status).toBe('pending'); expect(c.usages.length).toBeGreaterThan(0); expect(c.source.entryIdx).toBe(0); });
    expect(more.map((c) => c.id)).toEqual(['adv-1', 'adv-2']);
    expect(E.advisorSuggestMore(['shoes'])).toBe(0);   // never twice
  });
  test('leaves out values with spaces, test data, short numbers and values already correlated', () => {
    const E = studio();
    const es = recording();
    Object.assign(E.S, { entries1: es, advisorCandidates: [], correlations: [{ name: 'cart', usages: [{ tokenValue: '4711' }] }] });
    E.advisorSuggestMore([]);
    const vals = E.S.advisorCandidates.map((c) => c.value);
    expect(vals).not.toContain('two words');
    expect(vals).not.toContain('4711');
    expect(vals).toContain('shoes');
  });
});

describe('advisorRemoveFromScript / advisorRestoreToScript', () => {
  test('out of the script and back, exactly the same correlation', () => {
    const E = studio();
    Object.assign(E.S, { entries1: recording(), advisorCandidates: [], correlations: [{ name: 'other', extractorType: 'jsonpath', extractorConfig: { path: '$.x' }, usages: [] }] });
    const c = E.advisorAddManual(0, 'jsonpath', '$.token', 'token', 'tok-ABCDEFGHIJKL');
    E.advisorApplyAndRegen();
    expect(c._applied).toBe(true);
    const before = JSON.stringify(E.S.correlations);
    const gone = E.advisorRemoveFromScript(c.id);
    expect(gone.name).toBe('token');
    expect(E.S.correlations.map((x) => x.name)).toEqual(['other']);
    expect([c._applied, c.status]).toEqual([false, 'accepted']);
    E.advisorRestoreToScript(c.id, gone);
    expect(JSON.stringify(E.S.correlations)).toBe(before);
    expect(c._applied).toBe(true);
    expect(E.advisorRemoveFromScript('nope')).toBeNull();
  });
});

describe('advisorApplyOne (Add manual correlation, Paste & Detect)', () => {
  test('puts this value in the script only — other ticked values wait — and never twice', () => {
    const E = studio();
    Object.assign(E.S, { entries1: recording(), advisorCandidates: [], correlations: [] });
    const other = E.advisorAddManual(0, 'jsonpath', '$.cart', 'cart', '4711');
    const c = E.advisorAddManual(0, 'jsonpath', '$.token', 'token', 'tok-ABCDEFGHIJKL');
    c._edit = { extractorType: 'boundary', extractorConfig: { lb: '"token":"', rb: '"' }, sourceIdx: 0 };
    const nc = E.advisorApplyOne(c);
    expect([nc.name, nc.extractorType, nc.extractorConfig]).toEqual(['token', 'boundary', { lb: '"token":"', rb: '"' }]);
    expect(E.S.correlations.map((x) => x.name)).toEqual(['token']);
    expect([c._applied, other._applied]).toEqual([true, undefined]);
    E.advisorApplyOne(c);
    expect(E.S.correlations).toHaveLength(1);
  });
});

// A list's options in the editor: every value or one at random (_pick), the same as the Rnd switch of Correlation details
describe('advisorSetListPick and _pick', () => {
  const list = () => ({ id: 'adv-0', value: '(list)', varName: 'imageKeyArr', confidence: 'high', status: 'accepted', _selectAll: true,
    source: { entryIdx: 0, url: '/products', jsonPath: '$.items[*].imageKey' }, usages: [{ entryIdx: 2, url: '/wishlist', location: 'body_json', jsonPath: '$.img' }] });
  test('without a choice the list is read as before (jsonpath, every match); One at random → the one list picker', () => {
    const E = studio();
    const c = list();
    expect(E.advisorToCorrelation(c)).toMatchObject({ extractorType: 'jsonpath', extractorConfig: { path: '$.items[*].imageKey', selectAll: true } });
    c._pick = 'random';
    expect(E.advisorToCorrelation(c)).toMatchObject({ extractorType: 'jsonpath', extractorConfig: { path: '$.items[*].imageKey', selectAll: true }, list: { pick: 'random' } });
  });
  test('before it is in the script: only the choice; in the script: the correlation changes too and the script is made again', () => {
    const E = studio();
    const c = list();
    Object.assign(E.S, { entries1: recording(), advisorCandidates: [c], correlations: [] });
    E.advisorSetListPick('adv-0', 'random');
    expect([c._pick, E.S.correlations.length, E.S._regen || 0]).toEqual(['random', 0, 0]);
    E.advisorApplyOne(c);
    expect(E.S.correlations[0].list).toEqual({ pick: 'random' });
    E.advisorSetListPick('adv-0', 'all');
    expect([c._pick, E.S.correlations[0].extractorType, E.S.correlations[0].list, E.S._regen]).toEqual([undefined, 'jsonpath', undefined, 1]);
    // the Rnd switch keeps the choice in step, so Take out still finds the correlation
    E.toggleCorrRandSelect(0);
    expect([E.S.correlations[0].list, c._pick]).toEqual([{ pick: 'random' }, 'random']);
    const gone = E.advisorRemoveFromScript('adv-0');
    expect(gone.list).toEqual({ pick: 'random' });
    // Undo puts it back; the switch again: every value
    E.advisorRestoreToScript('adv-0', gone);
    E.toggleCorrRandSelect(0);
    expect([E.S.correlations[0].list, c._pick]).toEqual([undefined, undefined]);
  });
  test('a rebuilt list and a plain value are left alone', () => {
    const E = studio();
    const a = Object.assign(list(), { _arrayReconstruct: true }), v = Object.assign(list(), { id: 'adv-1', _selectAll: false });
    Object.assign(E.S, { entries1: recording(), advisorCandidates: [a, v], correlations: [] });
    E.advisorSetListPick('adv-0', 'random'); E.advisorSetListPick('adv-1', 'random');
    expect([a._pick, v._pick]).toEqual([undefined, undefined]);
  });
});
