'use strict';
/**
 * What goes into a converted script (Postman / Bruno and JMeter, chosen on the page after a conversion — the preview,
 * src/web/convertPreview.js): the requests the user left out, by their number (1-based, the parser's order — the same
 * numbers the preview shows), are dropped right after parsing, before anything else reads the list.
 *
 *   readLeaveOut(text)          the form field (JSON array of numbers) → Set of numbers; anything else → empty Set
 *   keepSelected(list, leaveOut) → the requests kept (the same objects, in order); none left out → the list itself.
 *                                  Every request left out → an Error with code "nothing_selected".
 *   leaveOutOption(text)        → { leaveOut: [numbers] } or {} (spread into the converter options by server.js)
 */

const MAX = 50000;

function readLeaveOut(text) {
  const out = new Set();
  if (text == null || text === '') return out;
  if (text instanceof Set) text = [...text];
  let arr;
  try { arr = Array.isArray(text) ? text : JSON.parse(String(text)); } catch (e) { return out; }
  if (!Array.isArray(arr)) return out;
  for (const v of arr.slice(0, MAX)) {
    const n = Number(v);
    if (Number.isInteger(n) && n > 0) out.add(n);
  }
  return out;
}

function keepSelected(list, leaveOut) {
  const set = leaveOut instanceof Set ? leaveOut : readLeaveOut(leaveOut);
  if (!set.size) return list;
  const kept = (list || []).filter((r, i) => !set.has(i + 1));
  if (!kept.length) {
    const e = new Error('Every request was left out: keep at least one.');
    e.code = 'nothing_selected';
    throw e;
  }
  return kept;
}

// the converter option from the form field: { leaveOut: [numbers] }, or {} when nothing is left out — the options are
// echoed in the answer's analysis, so a conversion without a choice answers exactly as before
function leaveOutOption(text) {
  const set = readLeaveOut(text);
  return set.size ? { leaveOut: [...set].sort((a, b) => a - b) } : {};
}

module.exports = { readLeaveOut, keepSelected, leaveOutOption };
