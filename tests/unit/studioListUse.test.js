'use strict';

/**
 * BUG-150 — a list the Correlation Advisor reads with every match (SelectAll) that a later request sends back:
 *  - the merge keeps, for each use, the value it sends (tokenValue) and its place among the matches (listIdx) — the
 *    items before it that have the field, plus one (the order VuGen's name_1 … name_N and DevWeb's array give)
 *  - a value from another response is not in the list that is read: its use stays as before (not replaced)
 *  - advisorToCorrelation passes them on for a list only; every other candidate is as before
 *  - the generators write the element at that place: VuGen {name_K}, DevWeb load.global.name[K-1]; one at random:
 *    {name_selected} / a random pick, as before
 * Proved on the wire with both engines: regression-tests/tools/engines/studioextract.js (cases list-all, list-random).
 */

const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
global.VugenCodegen = require('../../src/web/public/shared/vugen-codegen.js');
global.PageResources = require('../../src/web/public/shared/page-resources.js');
global.HostParams = require('../../src/web/public/shared/host-params.js');

function engine() {
  const doc = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null, documentElement: { setAttribute() {}, classList: { add() {} } } };
  // eslint-disable-next-line no-new-func
  return new Function('document', 'window', 'localStorage', ['VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js', 'studio-codegen.js'].map(read).join('\n') +
    '\nreturn { S, _advMergeArrayCandidates, _advListPos, advisorToCorrelation, advisorAddList, genActionC, genMainJS, genDefaultCfg, devwebExtractorDecl, _listRef };')(doc, { location: { pathname: '/converter/studio' }, addEventListener() {} }, { getItem: () => null, setItem() {} });
}

let nextId = 1;
function ent(url, o = {}) {
  return Object.assign({
    id: nextId++, url, method: 'GET', status: 200, ct: 'application/json', dur: 200, startMs: 0,
    reqHdrs: [], hdrsMap: {}, respHdrsMap: {}, body: null, referer: '', _resourceType: 'xhr', respBody: '',
    isMarker: false, filtered: false,
  }, o);
}
const KEYS = ['img-aaaa-0001', 'img-bbbb-0002', 'img-cccc-0003', 'img-dddd-0004'];
// item 1 has no imageKey: the 4th item's value is the 3rd match
const recording = () => [
  ent('https://shop.example.com/api/products', { respBody: JSON.stringify({ items: [{ imageKey: KEYS[0] }, { sku: 'x' }, { imageKey: KEYS[2] }, { imageKey: KEYS[3] }] }) }),
  ent('https://shop.example.com/api/other', { respBody: JSON.stringify({ items: [{ imageKey: 'img-other-0009' }] }) }),
  ent('https://shop.example.com/api/wishlist', { method: 'POST', body: { mimeType: 'application/json', text: JSON.stringify({ primaryImage: KEYS[0], altImage: KEYS[3], note: 'x' }) } }),
];
const sib = (id, entryIdx, p, value, jp) => ({ id, value, source: { entryIdx, url: '/x', jsonPath: p }, usages: [{ entryIdx: 2, url: 'POST /wishlist', location: 'body_json', jsonPath: jp }], status: 'pending', confidence: 'high', valueType: 'uuid', varName: 'imageKey' });

describe('the merge keeps each use\'s value and place', () => {
  test('_advListPos: the items before it that have the field, plus one', () => {
    const E = engine(), r = recording();
    expect(E._advListPos(r[0], '$.items', 0, '.imageKey')).toBe(1);
    expect(E._advListPos(r[0], '$.items', 3, '.imageKey')).toBe(3);   // item 1 has no imageKey
    expect(E._advListPos(r[0], '$.items', 9, '.imageKey')).toBeNull();
    expect(E._advListPos({ respBody: 'not json' }, '$.items', 0, '.imageKey')).toBeNull();
  });
  test('siblings become one list; uses carry their value and place; a value from another response stays as before', () => {
    const E = engine();
    E.S.entries1 = recording();
    const other = sib('adv-2', 1, '$.items[0].imageKey', 'img-other-0009', '$.otherImage');
    const [list] = E._advMergeArrayCandidates([
      sib('adv-0', 0, '$.items[0].imageKey', KEYS[0], '$.primaryImage'),
      sib('adv-1', 0, '$.items[3].imageKey', KEYS[3], '$.altImage'),
      other,
    ]);
    expect(list._selectAll).toBe(true);
    expect(list.usages.map((u) => [u.jsonPath, u.tokenValue, u.listIdx])).toEqual([['$.primaryImage', KEYS[0], 1], ['$.altImage', KEYS[3], 3], ['$.otherImage', undefined, undefined]]);
    expect(list.usages[2]).toBe(other.usages[0]);
    const corr = E.advisorToCorrelation(list);
    expect(corr.usages.map((u) => [u.tokenValue, u.listIdx])).toEqual([[KEYS[0], 1], [KEYS[3], 3], [list.value, undefined]]);
  });
  test('any other candidate: its own value for every use, no place (as before)', () => {
    const E = engine();
    const c = Object.assign(sib('adv-0', 0, '$.token', 'tok-123456', '$.t'), {});
    c.usages[0].tokenValue = 'something-else'; c.usages[0].listIdx = 7;
    const u = E.advisorToCorrelation(c).usages[0];
    expect([u.tokenValue, u.originalValue, 'listIdx' in u]).toEqual(['tok-123456', 'tok-123456', false]);
  });
});

describe('the generators send the element at its place', () => {
  const corr = (type) => ({ name: 'imageKeyArr', sourceIdx: 0, extractorType: type, extractorConfig: { path: '$.items[*].imageKey', selectAll: true },
    usages: [{ reqIdx: 2, location: 'body_json', key: 'primaryImage', tokenValue: KEYS[0], originalValue: KEYS[0], prefix: '', listIdx: 1 },
      { reqIdx: 2, location: 'body_json', key: 'altImage', tokenValue: KEYS[3], originalValue: KEYS[3], prefix: '', listIdx: 3 }] });
  function scripts(c) {
    const E = engine(), S = E.S;
    Object.assign(S, { format: 'both', entries1: recording(), txns: [], params: [], correlations: [c], hostNames: {} });
    return { ac: E.genActionC(S.entries1, [c]), mj: E.genMainJS(S.entries1, [c]) };
  }
  test('every value: VuGen {name_K}, DevWeb load.global.name[K-1]', () => {
    const s = scripts(corr('jsonpath'));
    expect(s.ac).toContain('\\"primaryImage\\":\\"{imageKeyArr_1}\\",\\"altImage\\":\\"{imageKeyArr_3}\\"');
    expect(s.ac).not.toContain(KEYS[0]);
    expect(s.mj).toContain('"primaryImage":"${load.global.imageKeyArr[0]}","altImage":"${load.global.imageKeyArr[2]}"');
    expect(s.mj).not.toContain(KEYS[0]);
  });
  test('one at random: {name_selected} and a random pick, as the Rnd switch always wrote', () => {
    const s = scripts(corr('random_select'));
    expect(s.ac).toContain('\\"primaryImage\\":\\"{imageKeyArr_selected}\\"');
    expect(s.mj).toContain('load.global.imageKeyArr[Math.floor(Math.random()*load.global.imageKeyArr.length)]');
    expect(s.mj).not.toContain(KEYS[3]);
  });
  test('_listRef: only a list read with every match, and only a use with a place', () => {
    const E = engine(), c = corr('jsonpath');
    expect([E._listRef(c, { listIdx: 2 }, 'vugen'), E._listRef(c, { listIdx: 2 }, 'devweb'), E._listRef(c, {}, 'vugen')]).toEqual(['imageKeyArr_2', 'imageKeyArr[1]', 'imageKeyArr']);
    expect(E._listRef(corr('random_select'), { listIdx: 2 }, 'vugen')).toBe('imageKeyArr');
    expect(E._listRef({ name: 'tok', extractorType: 'jsonpath', extractorConfig: { path: '$.t' } }, { listIdx: 2 }, 'devweb')).toBe('tok');
  });
});

// Lists made in the editor: a JSON path or boundaries reading every match, and how each place uses the list
describe('lists made in the editor', () => {
  const E2 = require('../../src/web/public/portal/studio-editor.js');
  const page = '<select name="seatClass"><option value="economy">E</option><option value="business">B</option></select>' +
    '<select name="outbound"><option value="F-1;a">1</option><option value="F-2;b">2</option><option value="F-3;c">3</option></select>';
  test('listFrom: a <select> among others reads every <option value=", the list is its own options', () => {
    const r = E2.listFrom(page, page.indexOf('F-2'), 'F-2;b', null);
    expect([r.ext, r.from, r.to, r.name, r.values]).toEqual([{ extractorType: 'boundary', extractorConfig: { lb: '<option value="', rb: '"', all: true } }, 3, 5, 'outboundOptions', ['economy', 'business', 'F-1;a', 'F-2;b', 'F-3;c']]);
  });
  test('listFrom: JSON — the last index as [*], a generic field named after its list; a section selected limits the range', () => {
    const j = JSON.stringify({ seats: [{ id: 'S-1' }, { id: 'S-2' }, { id: 'S-3' }, { id: 'S-4' }] });
    const r = E2.listFrom(j, j.indexOf('S-2'), 'S-2', () => '$.seats[1].id');
    expect([r.ext.extractorConfig, r.from, r.to, r.name]).toEqual([{ path: '$.seats[*].id', selectAll: true }, 1, 4, 'seatIdArr']);
    const s = E2.listFrom(j, j.indexOf('S-2'), 'S-2', () => '$.seats[1].id', { at: j.indexOf('S-2') - 3, len: j.indexOf('S-3') + 6 - j.indexOf('S-2') });
    expect([s.from, s.to]).toEqual([2, 3]);
    expect(E2.listFrom(j, 0, 'x', () => '$.x').why).toMatch(/not one of a JSON list/);
  });
  test('listFrom: the text of repeated tags; one value alone is not a list', () => {
    const t = '<td class="c">T-111</td><td class="c">T-222</td>';
    expect(E2.listFrom(t, t.indexOf('T-222'), 'T-222', null).ext.extractorConfig).toEqual({ lb: '<td class="c">', rb: '</td', all: true });
    expect(E2.listFrom('<p><b>X-1</b></p>', 6, 'X-1', null).why).toMatch(/Only one/);
  });
  test('boundAll / jsonAll: every match in order, repeats kept', () => {
    expect(E2.boundAll(page, '<option value="', '"')).toHaveLength(5);
    expect(E2.jsonAll(JSON.stringify({ a: [{ k: 'x' }, { k: 'y' }, { k: 'x' }] }), '$.a[*].k')).toEqual(['x', 'y', 'x']);
  });

  function eng() {
    const E = engine();
    E.S.entries1 = [
      ent('https://travel.example.com/flights', { respBody: page, ct: 'text/html' }),
      ent('https://travel.example.com/book', { method: 'POST', body: { mimeType: 'application/x-www-form-urlencoded', text: 'outbound=F-2%3Bb', params: [{ name: 'outbound', value: 'F-2;b' }] } }),
    ];
    Object.assign(E.S, { advisorCandidates: [], correlations: [], format: 'both', txns: [], params: [], hostNames: {} });
    return E;
  }
  const ext = { extractorType: 'boundary', extractorConfig: { lb: '<option value="', rb: '"', all: true } };
  const vals = ['economy', 'business', 'F-1;a', 'F-2;b', 'F-3;c'];
  test('advisorAddList: uses of the list values in its range, with their place; the choice and range kept', () => {
    const E = eng();
    const c = E.advisorAddList(0, ext, 'outboundOptions', vals, { from: 3, to: 5, pick: 'rotate' });
    expect(c.usages.map((u) => [u.entryIdx, u.tokenValue, u.listIdx])).toEqual([[1, 'F-2;b', 4]]);
    expect([c._selectAll, c._pick, c._range, c.value]).toEqual([true, 'rotate', { from: 3, to: 5 }, '(list — 3 values)']);
    const corr = E.advisorToCorrelation(c);
    expect([corr.extractorType, corr.extractorConfig, corr.list]).toEqual(['boundary', ext.extractorConfig, { pick: 'rotate', from: 3, to: 5 }]);
  });
  test('the generators: every match, the place, the Nth, and the pick before the first use', () => {
    const run = (opts) => {
      const E = eng(), c = E.advisorAddList(0, ext, 'outboundOptions', vals, Object.assign({ from: 3, to: 5 }, opts)), corr = E.advisorToCorrelation(c);
      E.S.correlations = [corr];
      return { ac: E.genActionC(E.S.entries1, [corr]), mj: E.genMainJS(E.S.entries1, [corr]), decl: E.devwebExtractorDecl(corr) };
    };
    const rec = run({});
    expect(rec.ac).toContain('"Ord=ALL"');
    expect(rec.ac).toContain('"Value={outboundOptions_4}"');
    expect(rec.decl).toContain('occurrence: load.ExtractorOccurrenceType.All');
    expect(rec.mj).toContain('load.global.outboundOptions[3]');
    const nth = run({ pick: 'nth', nth: 5 });
    expect(nth.ac).toContain('{outboundOptions_5}');
    expect(nth.mj).toContain('load.global.outboundOptions[4]');
    const rot = run({ pick: 'rotate' });
    expect(rot.ac).toContain("LR.setParam('outboundOptions_turn',String(k+1))");
    expect(rot.ac).toContain(',f=3,t=5,');
    expect(rot.ac.indexOf('web_js_run')).toBeLessThan(rot.ac.indexOf('{outboundOptions_selected}'));
    expect(rot.mj).toContain('((load.config.runtime.iteration || 1) - 1) % (t - f + 1)');
    expect(rot.mj).toContain('load.global.outboundOptions_selected');
    const rnd = run({ pick: 'random' });
    expect(rnd.ac).toContain('f+Math.floor(Math.random()*(t-f+1))');
    expect(rnd.mj).toContain('Math.floor(Math.random() * (t - f + 1))');
  });
  test('the JavaScript engine is switched on in VuGen for a list pick', () => {
    const E = eng(), c = E.advisorAddList(0, ext, 'outboundOptions', vals, { pick: 'random' });
    E.S.correlations = [E.advisorToCorrelation(c)];
    expect(E.genDefaultCfg ? E.genDefaultCfg(null) : '').toMatch(/EnableJsForTransport=1|^$/);
  });
  test('an Advisor list: random, rotate and nth are list choices (the one picker)', () => {
    const E = engine();
    const c = { id: 'adv-0', value: '(array)', varName: 'imgArr', confidence: 'high', status: 'accepted', _selectAll: true, source: { entryIdx: 0, url: '/x', jsonPath: '$.items[*].img' }, usages: [] };
    c._pick = 'random'; expect([E.advisorToCorrelation(c).extractorType, E.advisorToCorrelation(c).list]).toEqual(['jsonpath', { pick: 'random' }]);
    c._pick = 'rotate'; expect([E.advisorToCorrelation(c).extractorType, E.advisorToCorrelation(c).list]).toEqual(['jsonpath', { pick: 'rotate' }]);
    c._pick = 'nth'; c._nth = 2; expect(E.advisorToCorrelation(c).list).toEqual({ pick: 'nth', nth: 2 });
  });
});
