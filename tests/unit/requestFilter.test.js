/**
 * One rule set for which recorded requests go into the script (shared/request-filter.js) — the Recorder engine
 * (portal/recorder-core.js) and Script Studio's engine (VuGen-Script-Studio-correlation.js applyFilters) must decide
 * every request the same way, with the same reason (BUG-142: the same recording used to give a different script).
 */
const fs = require('fs');
const path = require('path');
const RequestFilter = require('../../src/web/public/shared/request-filter.js');
global.RequestFilter = RequestFilter;   // as the pages load it, before the engines

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');

// The two engines use the same global names (applyFilters, S …), so each runs in its own scope
function recorderEngine() {
  const document = { getElementById: () => null };   // Recorder tick boxes absent → their defaults (on)
  // eslint-disable-next-line no-new-func
  return new Function('document', read('VuGen-Recorder-state.js') + '\n' + read('VuGen-Recorder-parsers.js') + '\n' +
    read('portal/recorder-core.js') + '\nreturn { S, applyFilters };')(document);
}
function studioEngine() {
  // eslint-disable-next-line no-new-func
  return new Function(read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') + '\nreturn { S, applyFilters };')();
}
// Script Studio's default type buttons, read from studio-ui.js (the screen sets them)
const studioDefault = () => new Set(JSON.parse(read('studio-ui.js').match(/STUDIO_RT_DEFAULT = new Set\((\[[^\]]*\])\)/)[1]));

const req = (url, o = {}) => Object.assign({ url, method: 'GET', ct: 'application/json', hdrsMap: {}, body: null, _resourceType: '', isMarker: false }, o);
// [name, request, reason with the default buttons]
const CASES = [
  ['page', req('https://shop.example.com/', { ct: 'text/html', _resourceType: 'document' }), null],
  ['XHR', req('https://api.example.com/api/items', { _resourceType: 'xhr' }), null],
  ['JS file', req('https://cdn.example.com/app.js', { ct: 'application/javascript', _resourceType: 'script' }), 'type'],
  ['CSS by extension', req('https://cdn.example.com/site.css', { ct: '', _resourceType: '' }), 'type'],
  ['favicon answered as HTML', req('https://shop.example.com/favicon.ico', { ct: 'text/html', _resourceType: 'other' }), 'type'],
  ['font', req('https://cdn.example.com/f.woff2', { ct: 'font/woff2', _resourceType: 'font' }), 'type'],
  ['video', req('https://cdn.example.com/v.mp4', { ct: 'video/mp4', _resourceType: 'media' }), null],
  ['beacon (unknown browser type)', req('https://api.example.com/beacon', { ct: 'text/plain', _resourceType: 'ping', method: 'POST' }), null],
  ['JSONP (a "script" answering JSON)', req('https://api.example.com/cb', { ct: 'application/json', _resourceType: 'script' }), null],
  ['manifest', req('https://shop.example.com/m.webmanifest', { ct: 'application/manifest+json', _resourceType: 'manifest' }), null],
  ['OPTIONS pre-flight', req('https://api.example.com/api/items', { method: 'OPTIONS' }), 'options'],
  ['analytics server', req('https://www.google-analytics.com/collect', { _resourceType: 'xhr' }), 'ads'],
  ['ad address on google.com', req('https://www.google.com/pagead/conv', { ct: 'text/html', _resourceType: 'document' }), 'ads'],
  ['reCAPTCHA on google.com', req('https://www.google.com/recaptcha/api2/anchor', { ct: 'text/html', _resourceType: 'document' }), null],
  ['WebSocket', req('wss://push.example.com/socket'), 'websocket'],
  ['data: URL', req('data:image/png;base64,AAAA'), 'nonhttp'],
  ['CSP report', req('https://shop.example.com/csp', { method: 'POST', hdrsMap: { 'content-type': 'application/csp-report' } }), 'report'],
  ['prefetch of a page opened later', req('https://shop.example.com/next', { ct: 'text/html', _resourceType: 'document', hdrsMap: { 'sec-purpose': 'prefetch' } }), 'prefetch'],
  ['…the page opened', req('https://shop.example.com/next', { ct: 'text/html', _resourceType: 'document' }), null],
];
const fresh = () => CASES.map(([, r]) => JSON.parse(JSON.stringify(r)));

function decide(engine, setup) {
  const E = engine === 'recorder' ? recorderEngine() : studioEngine();
  const entries = fresh();
  setup(E.S);
  if (engine === 'recorder') { E.S.entries = entries; E.applyFilters(); } else E.applyFilters(entries);
  return entries.map((e) => e.leftOut);
}

describe('shared/request-filter.js — one rule set for every tool', () => {
  test('loads in Node and in a page (UMD); the eight types', () => {
    expect(RequestFilter.TYPES).toEqual(['document', 'fetch', 'script', 'stylesheet', 'image', 'font', 'media', 'other']);
    ['classify', 'typeKey', 'prefetchDuplicates', 'leftOut'].forEach((f) => expect(typeof RequestFilter[f]).toBe('function'));
  });

  test('Script Studio starts with the Recorder\'s default types (Doc, Fetch/XHR, Media, Other)', () => {
    const recOff = recorderEngine().S.typeOff;
    expect([...studioDefault()].sort()).toEqual(RequestFilter.TYPES.filter((k) => !recOff.has(k)).sort());
  });

  test.each(CASES.map(([n, , r], i) => [n, i, r]))('default buttons — %s: the same decision in the Recorder and Script Studio', (name, i, want) => {
    const rec = decide('recorder', () => {});
    const stu = decide('studio', (S) => { S.filterResourceTypes = studioDefault(); S.filterDomains = {}; });
    expect([rec[i], stu[i]]).toEqual([want, want]);
  });

  test('every type on (Studio "All") — the same in both: static files in, the always-left-out ones still out', () => {
    const rec = decide('recorder', (S) => { S.typeOff = new Set(); });
    const stu = decide('studio', (S) => { S.filterResourceTypes = null; S.filterDomains = {}; });
    expect(stu).toEqual(rec);
    expect(rec.filter((x) => x === 'type')).toEqual([]);
    expect(rec.filter(Boolean).sort()).toEqual(['ads', 'ads', 'nonhttp', 'options', 'prefetch', 'report', 'websocket']);
  });

  test('a domain switched off — the same in both', () => {
    const rec = decide('recorder', (S) => { S.domainFilter = { 'cdn.example.com': false }; });
    const stu = decide('studio', (S) => { S.filterResourceTypes = studioDefault(); S.filterDomains = { 'cdn.example.com': false }; });
    expect(stu).toEqual(rec);
    expect(rec[CASES.findIndex(([n]) => n === 'video')]).toBe('domain');
  });

  test('Script Studio records the reason on each request; markers stay', () => {
    const E = studioEngine();
    E.S.filterResourceTypes = studioDefault(); E.S.filterDomains = {};
    const list = [{ isMarker: true, url: 'https://START-T01.invalid/' }].concat(fresh());
    E.applyFilters(list);
    expect([list[0].filtered, list[0].leftOut]).toEqual([false, null]);
    expect(list.slice(1).every((e) => e.filtered === !!e.leftOut)).toBe(true);
  });
});
