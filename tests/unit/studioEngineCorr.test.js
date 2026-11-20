/**
 * Script Studio, step 2 — the correlations Studio's own engines found (pattern, second recording, value-based, PKCE),
 * listed with the Correlation Advisor's values (studio-advisor.js advisorMirrorEngine):
 *  - each is a candidate already in the script that points at the engine's correlation: the script does not change
 *  - advisorToCorrelation gives the engine's own extractor and uses (Bearer prefix kept), so Take out / Undo / Add
 *    again / Edit + Save keep the script as it was; a change of response drops the uses before it
 *  - Take out and Undo work as for the Advisor's own; a taken-out one stays out after a new reading (outKeys)
 *  - advisorEngineUntouched: still the engine's own correlation (nothing lost when the recording is read again)
 *  - PKCE values (made while the script runs) are _fixed
 * And Test (portal/studio-editor.js StudioEdit.check / checkText): what an extractor reads, every place it is sent
 * back, a header query value, a list, the second recording.
 */
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
const fs = require('fs');
const path = require('path');
const E = require('../../src/web/public/portal/studio-editor.js');

const PUB = path.join(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
function studio() {
  const src = ['shared/vugen-codegen.js', 'VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js', 'studio-codegen.js', 'studio-ui.js'].map(read).join('\n') +
    '\nfunction regenerateFromAdvisor() { S._regen = (S._regen || 0) + 1; }';
  const el = { setAttribute() {}, classList: { add() {} } };
  const document = { documentElement: el, getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  // eslint-disable-next-line no-new-func
  return new Function('window', 'document', 'localStorage', src +
    '\nreturn { S, advisorMirrorEngine, advisorEngineKey, advisorEngineUntouched, advisorToCorrelation, advisorRemoveFromScript, advisorRestoreToScript, advisorApplyOne, advisorApplyAndRegen, _advFirstMatch };')({ addEventListener() {} }, document, { getItem: () => null, setItem() {} });
}

let id = 1;
const ent = (url, o = {}) => Object.assign({ id: id++, url, method: 'GET', reqHdrs: [], body: null, respBody: '', respHdrsMap: {}, isMarker: false, filtered: false }, o);
function setup() {
  const X = studio(), S = X.S;
  S.entries1 = [
    ent('https://api.example.com/login', { method: 'POST', respBody: '{"access_token":"tok-ABCDEFGHIJKL"}' }),
    ent('https://api.example.com/cart', { reqHdrs: [{ name: 'Authorization', value: 'Bearer tok-ABCDEFGHIJKL' }] }),
    ent('https://api.example.com/pay', { method: 'POST' }),
  ];
  const tok = { name: 'AccessToken', sourceIdx: 0, extractorType: 'jsonpath', extractorConfig: { path: '$.access_token' },
    usages: [{ reqIdx: 1, location: 'header', key: 'Authorization', originalValue: 'Bearer tok-ABCDEFGHIJKL', prefix: 'Bearer ', tokenValue: 'tok-ABCDEFGHIJKL' }] };
  const pkce = { name: 'pkce_verifier', sourceIdx: -1, extractorType: 'pkce', extractorConfig: { role: 'verifier' },
    usages: [{ reqIdx: 2, location: 'body_form', key: 'code_verifier', tokenValue: 'v'.repeat(43), originalValue: 'v'.repeat(43) }] };
  S.correlations = [tok, pkce];
  S.advisorCandidates = [];
  return { X, S, tok, pkce };
}

describe('advisorMirrorEngine', () => {
  test('every engine correlation becomes a candidate in the script; S.correlations is untouched', () => {
    const { X, S, tok, pkce } = setup();
    X.advisorMirrorEngine([]);
    expect(S.correlations).toEqual([tok, pkce]);
    expect(S.advisorCandidates.map((c) => [c.varName, c._applied, c.status, c._fixed, c._engineCorr === (c.varName === 'AccessToken' ? tok : pkce)]))
      .toEqual([['AccessToken', true, 'accepted', false, true], ['pkce_verifier', true, 'accepted', true, true]]);
    const c = S.advisorCandidates[0];
    expect([c.value, c.source.entryIdx, c.usages.map((u) => [u.entryIdx, u.location, u.jsonPath])]).toEqual(['tok-ABCDEFGHIJKL', 0, [[1, 'header', 'Authorization']]]);
    X.advisorMirrorEngine([]);
    expect(S.advisorCandidates.length).toBe(2);   // never twice
  });
  test('advisorToCorrelation: the engine\'s own extractor and uses (the Bearer prefix kept) — Add to the script adds nothing twice', () => {
    const { X, S, tok } = setup();
    X.advisorMirrorEngine([]);
    const conv = X.advisorToCorrelation(S.advisorCandidates[0]);
    expect([conv.name, conv.extractorType, conv.extractorConfig, conv.sourceIdx, conv._fromAdvisor]).toEqual(['AccessToken', 'jsonpath', { path: '$.access_token' }, 0, undefined]);
    expect(conv.usages).toEqual(tok.usages);
    expect(conv.usages[0]).not.toBe(tok.usages[0]);
    S.advisorCandidates.push({ id: 'adv-x', status: 'accepted', varName: 'other', value: 'zzz', usages: [{ entryIdx: 2, location: 'body_form', jsonPath: 'z' }], source: { entryIdx: 0, jsonPath: '$.z' } });
    X.advisorApplyAndRegen();
    expect(S.correlations.map((c) => c.name)).toEqual(['AccessToken', 'pkce_verifier', 'other']);
  });
  test('Take out and Undo give the same correlation back at its place; Save after an edit puts it back at its place', () => {
    const { X, S, tok } = setup();
    X.advisorMirrorEngine([]);
    const c = S.advisorCandidates[0];
    expect(X.advisorEngineUntouched(c)).toBe(true);
    const gone = X.advisorRemoveFromScript(c.id);
    expect(gone).toBe(tok);
    expect(S.correlations.map((x) => x.name)).toEqual(['pkce_verifier']);
    expect(X.advisorEngineUntouched(c)).toBe(false);
    X.advisorRestoreToScript(c.id, gone);
    expect(S.correlations[0]).toBe(tok);
    // the editor: Edit (taken out) → Save with another extractor → back at index 0, with the engine's uses
    X.advisorRemoveFromScript(c.id);
    c._edit = { extractorType: 'boundary', extractorConfig: { lb: '"access_token":"', rb: '"' }, sourceIdx: 0 };
    X.advisorApplyOne(c);
    expect(S.correlations.map((x) => [x.name, x.extractorType])).toEqual([['AccessToken', 'boundary'], ['pkce_verifier', 'pkce']]);
    expect(S.correlations[0].usages[0].prefix).toBe('Bearer ');
    expect(X.advisorEngineUntouched(c)).toBe(false);
  });
  test('a response chosen later than a use: that use is dropped', () => {
    const { X, S } = setup();
    X.advisorMirrorEngine([]);
    const c = S.advisorCandidates[0];
    c._edit = { extractorType: 'jsonpath', extractorConfig: { path: '$.access_token' }, sourceIdx: 1 };
    expect(X.advisorToCorrelation(c).usages).toEqual([]);
  });
  test('taken out before a new reading: out again, under Skipped (the key: name + response)', () => {
    const { X, S } = setup();
    expect(X.advisorEngineKey(S.correlations[0])).toBe('AccessToken|POST https://api.example.com/login');
    X.advisorMirrorEngine(['AccessToken|POST https://api.example.com/login']);
    const c = S.advisorCandidates[0];
    expect([c._applied, c.status, S.correlations.map((x) => x.name)]).toEqual([false, 'skipped', ['pkce_verifier']]);
  });
  test('the page hooks: called before the reset and after the Advisor\'s scan; the footer and Apply ignore them', () => {
    const app = read('studio-app.js');
    expect(app.indexOf('studioBeforeRead()')).toBeLessThan(app.indexOf('S.advisorCandidates = [];'));
    expect(app.indexOf('studioAfterAdvisor()')).toBeGreaterThan(app.indexOf('advisorScan('));
    expect(app).toContain('.filter((c) => !c._engineCorr).length + _corrs.length');
    const ui = read('studio-ui.js');
    expect(ui.split('return c.status === "accepted" && !(c._engineCorr && c._applied);').length - 1).toBe(2);
  });
});

describe('Test — StudioEdit.check / checkText', () => {
  const entries = [
    { method: 'POST', url: 'https://a.example.com/login', respBody: '{"t":"tok-1","items":[{"id":"a1"},{"id":"a2"}]}', respHdrsMap: { location: 'https://a.example.com/cb?code=C0DE123&state=st-9' } },
    { method: 'GET', url: 'https://a.example.com/x', respBody: '<input name="k" value="v-1"><input name="k" value="v-2">' },
    { method: 'GET', url: 'https://a.example.com/use' },
  ];
  const fm = (b, l, r) => { const i = b.indexOf(l); if (i < 0) return null; const j = b.indexOf(r, i + l.length); return j < 0 ? null : b.slice(i + l.length, j); };
  test('reads the value; every place sent it back → ok', () => {
    const res = E.check({ entries, firstMatch: fm, corr: { extractorType: 'jsonpath', extractorConfig: { path: '$.t' }, sourceIdx: 0, usages: [{ reqIdx: 2, tokenValue: 'tok-1' }] } });
    expect([res.verdict, res.value, res.places]).toEqual(['ok', 'tok-1', [{ reqIdx: 2, sent: 'tok-1', same: true }]]);
    expect(E.checkText(res)).toEqual({ cls: 'good', title: 'Reads tok-1', notes: ['1 of 1 place sent this value back.'] });
  });
  test('a place that sent another value → differs; boundaries with several values → a note', () => {
    const res = E.check({ entries, firstMatch: fm, corr: { extractorType: 'boundary', extractorConfig: { lb: 'value="', rb: '"' }, sourceIdx: 1, usages: [{ reqIdx: 2, tokenValue: 'v-2' }] } });
    expect([res.verdict, res.value, res.matches, res.distinct]).toEqual(['differs', 'v-1', 2, 2]);
    const tx = E.checkText(res);
    expect(tx.cls).toBe('warn');
    expect(tx.notes).toContain('2 matches with 2 different values: the first one is used.');
  });
  test('a query value of a response header (as the generators read it); URL-encoded uses match', () => {
    const res = E.check({ entries, firstMatch: fm, corr: { extractorType: 'boundary_header', extractorConfig: { lb: 'state=', rb: '&' }, sourceIdx: 0, usages: [{ reqIdx: 2, tokenValue: 'st-9' }] } });
    expect([res.verdict, res.value]).toEqual(['ok', 'st-9']);
    const enc = E.check({ entries, firstMatch: fm, corr: { extractorType: 'jsonpath', extractorConfig: { path: '$.t' }, sourceIdx: 0, usages: [{ reqIdx: 2, tokenValue: 'tok%2D1' }] } });
    expect(enc.verdict).toBe('ok');
  });
  test('a list: every value; a place sending one of them is fine', () => {
    const res = E.check({ entries, corr: { extractorType: 'jsonpath', extractorConfig: { path: '$.items[*].id', selectAll: true }, sourceIdx: 0, usages: [{ reqIdx: 2, tokenValue: 'a2' }] } });
    expect([res.verdict, res.values]).toEqual(['ok', ['a1', 'a2']]);
    expect(E.checkText(res).title).toBe('Reads a list of 2 values');
  });
  test('nothing read, made while it runs, a kind not tried here', () => {
    expect(E.check({ entries, corr: { extractorType: 'jsonpath', extractorConfig: { path: '$.nope' }, sourceIdx: 0, usages: [] } }).verdict).toBe('none');
    expect(E.check({ entries, corr: { extractorType: 'pkce', sourceIdx: -1 } }).verdict).toBe('runtime');
    expect(E.check({ entries, corr: { extractorType: 'html', extractorConfig: { selector: 'meta', attr: 'content' }, sourceIdx: 1 } }).verdict).toBe('unknown');
    expect(E.check({ entries, corr: { extractorType: 'html', extractorConfig: { selector: 'x' }, sourceIdx: 1, usages: [] }, html: () => ({ value: 'h-1' }) }).value).toBe('h-1');
  });
  test('the second recording: the same request (by method, path and order); a value that changes is as it should be', () => {
    const e2 = [{ method: 'POST', url: 'https://a.example.com/login', respBody: '{"t":"tok-2"}' }];
    const corr = { extractorType: 'jsonpath', extractorConfig: { path: '$.t' }, sourceIdx: 0, usages: [{ reqIdx: 2, tokenValue: 'tok-1' }] };
    const res = E.check({ entries, corr, entries2: e2 });
    expect(res.second).toEqual({ found: true, value: 'tok-2', differs: true });
    expect(E.checkText(res).notes[1]).toMatch(/changes, as it should/);
    const same = E.check({ entries, corr, entries2: [{ method: 'POST', url: 'https://a.example.com/login', respBody: '{"t":"tok-1"}' }] });
    expect(E.checkText(same).cls).toBe('warn');
    expect(E.sameReq(entries, 1, e2)).toBeNull();
  });
});
