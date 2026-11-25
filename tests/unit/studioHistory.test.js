/**
 * Script Studio: Undo and Redo (portal/studio-history.js) — the list of states and what decides a reading.
 * regression-tests/tools/studio/walk.js proves on the page that Undo gives the script before, character for character.
 */
'use strict';
const H = require('../../src/web/public/portal/studio-history.js');
const st = (key, v) => ({ key, v });

describe('the list of states', () => {
  test('the first state is the start; the same choices are no change (the newest copy is kept)', () => {
    const h = H.create();
    expect(h.look(st('a', 1))).toBe(false); expect(h.look(st('a', 2))).toBe(false); expect(h.can()).toEqual({ undo: false, redo: false });
    h.look(st('b')); expect(h.undo()).toEqual(st('a', 2));
  });
  test('undo, redo, and a new change ends what could be redone', () => {
    const h = H.create(); ['a', 'b', 'c'].forEach((k) => h.look(st(k)));
    expect(h.undo().key).toBe('b'); expect(h.undo().key).toBe('a'); expect(h.undo()).toBe(null); expect(h.can()).toEqual({ undo: false, redo: true });
    expect(h.redo().key).toBe('b'); expect(h.look(st('b'))).toBe(false); expect(h.can()).toEqual({ undo: true, redo: true });
    expect(h.look(st('d'))).toBe(true); expect(h.can()).toEqual({ undo: true, redo: false }); expect(h.redo()).toBe(null);
    expect(h.undo().key).toBe('b');
  });
  test('no more than the limit; a new recording starts empty', () => {
    const h = H.create(3); for (let i = 0; i < 9; i++) h.look(st(String(i)));
    let n = 0; while (h.undo()) n++; expect(n).toBe(3);
    h.reset(); expect(h.can()).toEqual({ undo: false, redo: false }); expect(h.look(st('x'))).toBe(false);
  });
});

describe('what decides a reading', () => {
  test('plain data, in a fixed order, no reference to the page\'s own lists', () => {
    const log = [{ op: 'create', name: 'A', ids: [1] }];
    const S = { filterResourceTypes: new Set(['xhr', 'doc']), filterDomains: { 'b.example.com': false, 'a.example.com': true }, leaveOut: { ads: false }, leaveOutIds: new Set([9, 2]) };
    const r = H.reading(S, log, new Map([['u', 'once']]));
    expect(r).toEqual({ types: ['doc', 'xhr'], dom: { 'b.example.com': false }, leave: { ads: false, options: true }, out: [2, 9], log, bg: [['u', 'once']] });
    log.push({ op: 'ungroup', name: 'A' }); expect(r.log).toHaveLength(1);
  });
  test('nothing chosen yet', () => { expect(H.reading({}, null, null)).toEqual({ types: null, dom: {}, leave: { ads: true, options: true }, out: [], log: [], bg: null }); });
});
