'use strict';

/**
 * HAR Explorer — the model (src/web/public/portal/har-explorer-model.js).
 *
 * The Explorer reads a HAR with the Recorder's own engine (VuGen-Recorder-state.js, VuGen-Recorder-parsers.js,
 * portal/recorder-core.js — loaded unchanged), so its transactions and left-out requests must be exactly the
 * Recorder's: bookmark START / END markers, CDP Recorder pages, files with neither. Checked here on synthetic
 * recordings: every request once, in the Recorder's order, in the Recorder's transaction, with the Recorder's
 * left-out reason, and linked to its own HAR entry (headers, bodies, timings).
 */

const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8');

function loadExplorer() {
  const document = { getElementById: () => null };   // the Recorder's filter tick boxes are not on this page → defaults
  // eslint-disable-next-line no-new-func
  const f = new Function('document',
    read('VuGen-Recorder-state.js') + '\n' + read('VuGen-Recorder-parsers.js') + '\n' + read('portal/recorder-core.js') + '\n' +
    read('portal/har-explorer-model.js') +
    '\nreturn { S, hxBuild, hxWhy, hxOutSummary, hxTypeLabel, recLeftOut, recFilterFlags, _repairOrphanEnds };');
  return f(document);
}

const t0 = Date.parse('2026-10-30T09:00:00.000Z');
let k = 0;
function entry(url, o = {}) {
  k++;
  return {
    startedDateTime: new Date(t0 + k * 100).toISOString(), time: o.time || 50, pageref: o.pageref, _resourceType: o.rt || '',
    request: { method: o.method || 'GET', url, httpVersion: 'HTTP/1.1', headers: o.headers || [], queryString: [], cookies: [], postData: o.post },
    response: { status: o.status == null ? 200 : o.status, statusText: 'OK', headers: [], cookies: [], content: { size: 10, mimeType: o.ct || 'application/json', text: o.text || '{}' }, redirectURL: '' },
    timings: { send: 1, wait: 40, receive: 9 },
  };
}
const har = (entries, extra = {}) => ({ log: Object.assign({ version: '1.2', creator: { name: 'WebInspector', version: '537.36' }, entries }, extra) });

function invariants(X, h) {
  const model = X.hxBuild(h);
  const real = X.S.entries.filter((e) => !e.isMarker);
  // every request once, in the Recorder's order
  expect(model.items.map((it) => it.e)).toEqual(real);
  // in the Recorder's transaction (txn groups) or outside any (the others)
  model.groups.forEach((g) => g.items.forEach((it) => expect(it.e.txn).toBe(g.txn ? g.name : null)));
  // the transactions in the Recorder's order
  expect(model.groups.filter((g) => g.txn).map((g) => g.name)).toEqual(X.S.txns.map((t) => t.name));
  // the Recorder's left-out reason
  const flags = X.recFilterFlags();
  model.items.forEach((it) => expect(it.out).toBe(X.recLeftOut(it.e, flags)));
  // linked to its own HAR entry
  model.items.forEach((it) => expect(it.raw.request.url).toBe(it.e.url));
  return model;
}

describe('HAR Explorer model — the Recorder\'s transactions and left-out rules', () => {
  test('bookmark START / END markers become transactions; the markers themselves are not requests', () => {
    const X = loadExplorer();
    const h = har([
      entry('https://shop.example.com/', { ct: 'text/html', rt: 'document', text: '<html></html>' }),
      entry('https://START-T01_Login.invalid/', { status: 0 }),
      entry('https://shop.example.com/login', { ct: 'text/html', rt: 'document', text: '<html></html>' }),
      entry('https://shop.example.com/app.css', { ct: 'text/css', rt: 'stylesheet', text: 'a{}' }),
      entry('https://www.google-analytics.com/g/collect?v=2', { method: 'POST', ct: 'text/plain', status: 204 }),
      entry('https://api.example.com/v1/login', { method: 'POST', rt: 'fetch', post: { mimeType: 'application/json', text: '{"u":"a"}' } }),
      entry('https://END-T01_Login.invalid/', { status: 0 }),
      entry('https://START-T02_Search.invalid/', { status: 0 }),
      entry('https://api.example.com/v1/search?q=x', { method: 'OPTIONS', rt: 'preflight', status: 204 }),
      entry('https://api.example.com/v1/search?q=x', { rt: 'fetch' }),
      entry('https://END-T02_Search.invalid/', { status: 0 }),
      entry('https://shop.example.com/bye', { ct: 'text/html', rt: 'document', text: '<html></html>' }),
    ]);
    const m = invariants(X, h);
    expect(m.source).toBe('bookmarks');
    expect(m.groups.map((g) => [g.name, g.items.length])).toEqual([[null, 1], ['T01_Login', 4], ['T02_Search', 2], [null, 1]]);
    expect(m.items.map((it) => it.n)).toEqual([1, 3, 4, 5, 6, 9, 10, 12]);   // numbers in the file; the markers are 2, 7, 8, 11
    const why = Object.fromEntries(m.items.filter((it) => it.out).map((it) => [it.e.url, it.out]));
    expect(why).toEqual({
      'https://shop.example.com/app.css': 'type',
      'https://www.google-analytics.com/g/collect?v=2': 'ads',
      'https://api.example.com/v1/search?q=x': 'options',
    });
    expect(X.hxWhy(m.items.find((it) => it.out === 'type'))).toBe('CSS — a static file, replayed as a page resource');
    expect(X.hxOutSummary(m.groups[1].items.filter((it) => it.out))).toBe('1 CSS, 1 analytics / ads');
  });

  test('CDP Recorder pages become transactions, named by the page titles; requests without a page stay outside', () => {
    const X = loadExplorer();
    const h = har([
      entry('https://shop.example.com/', { ct: 'text/html', rt: 'Document', text: '<html></html>' }),
      entry('https://api.example.com/v1/login', { method: 'POST', rt: 'Fetch', pageref: 'tx_1' }),
      entry('https://api.example.com/v1/me', { rt: 'Fetch', pageref: 'tx_1' }),
      entry('https://api.example.com/v1/cart', { method: 'POST', rt: 'Fetch', pageref: 'tx_2' }),
    ], { creator: { name: 'PerfX Studio Recorder', version: '1.0.0' }, pages: [{ id: 'tx_1', title: 'T01_Login' }, { id: 'tx_2', title: 'T02_Cart' }] });
    const m = invariants(X, h);
    expect(m.source).toBe('cdp');
    expect(m.groups.map((g) => [g.name, g.items.length])).toEqual([[null, 1], ['T01_Login', 2], ['T02_Cart', 1]]);
    expect(m.items.map((it) => it.n)).toEqual([1, 2, 3, 4]);
  });

  test('an END bookmark without its START (recording started late): the requests before it join that transaction, as in the Recorder', () => {
    const X = loadExplorer();
    const h = har([
      entry('https://shop.example.com/', { ct: 'text/html', rt: 'document', text: '<html></html>' }),
      entry('https://shop.example.com/login', { ct: 'text/html', rt: 'document', text: '<html></html>' }),
      entry('https://END-T01_Login.invalid/', { status: 0 }),
      entry('https://START-T02_Home.invalid/', { status: 0 }),
      entry('https://shop.example.com/home', { ct: 'text/html', rt: 'document', text: '<html></html>' }),
      entry('https://END-T02_Home.invalid/', { status: 0 }),
    ]);
    const m = invariants(X, h);
    expect(m.groups.map((g) => [g.name, g.items.length])).toEqual([['T01_Login', 2], ['T02_Home', 1]]);
    expect(X.S.txns.map((t) => t.name)).toEqual(['T01_Login', 'T02_Home']);
  });

  test('a HAR with neither markers nor pages: one group, "No transactions"', () => {
    const X = loadExplorer();
    const m = invariants(X, har([entry('https://a.example.com/x'), entry('https://a.example.com/y')]));
    expect(m.source).toBe('none');
    expect(m.groups.map((g) => [g.name, g.txn, g.items.length])).toEqual([[null, false, 2]]);
  });

  test('pages from another tool (DevTools) are transactions too, as in the Recorder — but not called CDP Recorder', () => {
    const X = loadExplorer();
    const h = har([entry('https://a.example.com/', { pageref: 'page_1' }), entry('https://a.example.com/b', { pageref: 'page_2' })],
      { pages: [{ id: 'page_1', title: 'https://a.example.com/' }, { id: 'page_2', title: 'https://a.example.com/b' }] });
    const m = invariants(X, h);
    expect(m.source).toBe('pages');
    expect(m.groups.filter((g) => g.txn).length).toBe(2);
  });

  test('timeline: start times from the first request, the end covers the longest one', () => {
    const X = loadExplorer();
    const m = X.hxBuild(har([entry('https://a.example.com/1', { time: 30 }), entry('https://a.example.com/2', { time: 500 })]));
    expect(m.items[0].start).toBe(0);
    expect(m.items[1].start).toBe(100);
    expect(m.end).toBe(600);
  });
});
