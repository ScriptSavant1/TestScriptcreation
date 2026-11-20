'use strict';

/**
 * What goes into a converted script (src/core/requestSelection.js): the requests left out on the page after a
 * conversion (the preview's numbers, 1-based in the parser's order) are dropped right after parsing.
 *  - readLeaveOut: the form field → Set of numbers; anything odd → nothing left out (the conversion as before)
 *  - keepSelected: the same objects, in order (JMeter's thread groups are filtered by object); every request left
 *    out → error code nothing_selected (the server answers 400)
 */

const { readLeaveOut, keepSelected, leaveOutOption } = require('../../src/core/requestSelection');

describe('readLeaveOut', () => {
  test('a JSON array of numbers, an array or a Set', () => {
    expect([...readLeaveOut('[2,3]')]).toEqual([2, 3]);
    expect([...readLeaveOut([1, '4'])]).toEqual([1, 4]);
    expect([...readLeaveOut(new Set([5]))]).toEqual([5]);
  });
  test('absent, empty or not valid → nothing left out', () => {
    [undefined, null, '', 'oops', '{"a":1}', '3', '[]'].forEach((v) => expect(readLeaveOut(v).size).toBe(0));
  });
  test('only whole numbers above zero', () => {
    expect([...readLeaveOut('[0,-1,1.5,"x",2,2]')]).toEqual([2]);
  });
});

describe('keepSelected', () => {
  const list = [{ name: 'a' }, { name: 'b' }, { name: 'c' }];
  test('nothing left out → the list itself', () => {
    expect(keepSelected(list, undefined)).toBe(list);
    expect(keepSelected(list, '')).toBe(list);
  });
  test('drops by number, keeps the same objects in order', () => {
    const kept = keepSelected(list, '[2]');
    expect(kept.map((r) => r.name)).toEqual(['a', 'c']);
    expect(kept[0]).toBe(list[0]);
    expect(kept[1]).toBe(list[2]);
  });
  test('a number past the end is ignored', () => {
    expect(keepSelected(list, new Set([9])).length).toBe(3);
  });
  test('every request left out → nothing_selected', () => {
    expect(() => keepSelected(list, '[1,2,3]')).toThrow(expect.objectContaining({ code: 'nothing_selected' }));
  });
});

describe('leaveOutOption', () => {
  test('nothing left out → no option (the answer echoes the options: unchanged); else a sorted array', () => {
    expect(leaveOutOption(undefined)).toEqual({});
    expect(leaveOutOption('[]')).toEqual({});
    expect(leaveOutOption('[5,2]')).toEqual({ leaveOut: [2, 5] });
  });
});
