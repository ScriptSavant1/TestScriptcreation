'use strict';

/**
 * Script Studio — an END bookmark without its START (BUG-113).
 *
 * The START bookmark fired before DevTools was recording, so the recording has only the END. Studio wrote
 * lr_end_transaction for a transaction it never started (VuGen: "Failed to end Transaction"). detectMarkers()
 * now repairs it like the Recorder does: the transaction starts where the previous one ended, or at the beginning.
 * Loads Studio's engine files unchanged (constants + correlation).
 */

const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');

function studio() {
  // eslint-disable-next-line no-new-func
  return new Function(read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') +
    '\nreturn { S, parseHar, detectMarkers, repairOrphanEnds };')();
}
const e = (url) => ({ startedDateTime: '2026-10-30T09:00:00.000Z', time: 10, request: { method: 'GET', url, headers: [] }, response: { status: url.includes('.invalid') ? 0 : 200, headers: [], content: { mimeType: 'text/html', text: '' } } });
const run = (urls, pages) => {
  const X = studio();
  const entries = X.parseHar({ log: { entries: urls.map(e), pages: pages || [] } });
  X.S.entries1 = entries;
  X.detectMarkers(entries);
  return { X, entries, shape: entries.map((x) => (x.isMarker ? (x.markerType === 'start' ? '[' : ']') + x.txnName : x.id + (x.txn ? ':' + x.txn : ''))) };
};

describe('Script Studio — END bookmark without START (BUG-113)', () => {
  test('the first transaction lost its START: it starts at the beginning', () => {
    const { X, shape } = run(['https://a.example.com/1', 'https://a.example.com/2', 'https://END-t01_login.invalid/',
      'https://START-t02_home.invalid/', 'https://a.example.com/5', 'https://END-t02_home.invalid/']);
    expect(shape).toEqual(['[t01_login', '1:t01_login', '2:t01_login', ']t01_login', '[t02_home', '5:t02_home', ']t02_home']);
    expect(X.S.txns.map((t) => t.name)).toEqual(['t01_login', 't02_home']);   // numbered in start order (SC01_01, SC01_02)
  });

  test('a START lost in the middle: the transaction starts where the previous one ended', () => {
    const { shape } = run(['https://START-t01_a.invalid/', 'https://a.example.com/2', 'https://END-t01_a.invalid/',
      'https://a.example.com/4', 'https://END-t02_b.invalid/', 'https://a.example.com/6']);
    expect(shape).toEqual(['[t01_a', '2:t01_a', ']t01_a', '[t02_b', '4:t02_b', ']t02_b', '6']);
  });

  test('matching pairs, and CDP Recorder pages, are left exactly as they were', () => {
    expect(run(['https://START-t01_a.invalid/', 'https://a.example.com/2', 'https://END-t01_a.invalid/']).shape)
      .toEqual(['[t01_a', '2:t01_a', ']t01_a']);
    const X = studio();
    const har = { log: { pages: [{ id: 'p1', title: 'T01_Login' }], entries: [Object.assign(e('https://a.example.com/1'), { pageref: 'p1' }), Object.assign(e('https://a.example.com/2'), { pageref: 'p1' })] } };
    const entries = X.parseHar(har); X.S.entries1 = entries; X.detectMarkers(entries);
    expect(entries.filter((x) => x.isMarker).map((x) => x.markerType + ':' + x.txnName)).toEqual(['start:T01_Login', 'end:T01_Login']);
    expect(X.repairOrphanEnds(entries)).toBe(0);
  });

  test('request ids are kept (the markers have id -1) — the HAR Explorer finds requests by them', () => {
    const { entries } = run(['https://a.example.com/1', 'https://END-t01_login.invalid/', 'https://a.example.com/3']);
    expect(entries.filter((x) => !x.isMarker).map((x) => x.id)).toEqual([1, 3]);
    expect(entries[0]).toMatchObject({ isMarker: true, markerType: 'start', id: -1 });
  });
});
