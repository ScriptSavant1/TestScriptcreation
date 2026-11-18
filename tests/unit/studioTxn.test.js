/**
 * Script Studio — the user's own transactions (portal/studio-txn.js): create from ticked requests, rename, ungroup,
 * kept by request id and applied again after every reading of the recording. The rules are the Recorder's: START
 * before the first ticked request, END after the last; ungroup keeps the requests in the script.
 */
const StudioTxn = require('../../src/web/public/portal/studio-txn.js');

let nextId = 0;
const req = (path, txn) => ({ id: ++nextId, url: 'https://shop.example.com' + path, method: 'GET', isMarker: false, filtered: false, txn: txn || null });
const mk = (type, name) => StudioTxn.marker(type, name);
const shape = (es) => es.map((e) => (e.isMarker ? (e.markerType === 'start' ? '[' : ']') + e.txnName : e.id + ':' + (e.txn || '-')));

function journey() {
  nextId = 0;
  const es = [req('/'), req('/login'), req('/home'), req('/search'), req('/item')];
  StudioTxn.assign(es);
  return es;
}

describe('StudioTxn — the user\'s transactions', () => {
  test('create: START before the first ticked request, END after the last; requests between are in it', () => {
    const es = journey();
    expect(StudioTxn.applyOne(es, { op: 'create', name: 'T01_Login', ids: [2, 3] })).toBe(true);
    expect(shape(es)).toEqual(['1:-', '[T01_Login', '2:T01_Login', '3:T01_Login', ']T01_Login', '4:-', '5:-']);
    expect(StudioTxn.names(es)).toEqual(['T01_Login']);
  });

  test('markers look like the engine\'s own (the generators treat them the same way)', () => {
    const m = mk('start', 'T01_A');
    expect([m.isMarker, m.markerType, m.txnName, m.filtered, m.url, m.id]).toEqual([true, 'start', 'T01_A', false, '', -1]);
  });

  test('names are in journey order (the order the script numbers them), not in the order they were made', () => {
    const es = journey();
    StudioTxn.applyOne(es, { op: 'create', name: 'T02_Search', ids: [4, 5] });
    StudioTxn.applyOne(es, { op: 'create', name: 'T01_Launch', ids: [1] });
    expect(StudioTxn.names(es)).toEqual(['T01_Launch', 'T02_Search']);
  });

  test('rename keeps the requests; a taken name or an unknown one changes nothing', () => {
    const es = journey();
    StudioTxn.applyOne(es, { op: 'create', name: 'A', ids: [1] });
    StudioTxn.applyOne(es, { op: 'create', name: 'B', ids: [3] });
    expect(StudioTxn.applyOne(es, { op: 'rename', from: 'A', to: 'B' })).toBe(false);
    expect(StudioTxn.applyOne(es, { op: 'rename', from: 'Z', to: 'C' })).toBe(false);
    expect(StudioTxn.applyOne(es, { op: 'rename', from: 'A', to: 'T01_Home' })).toBe(true);
    expect(shape(es)).toEqual(['[T01_Home', '1:T01_Home', ']T01_Home', '2:-', '[B', '3:B', ']B', '4:-', '5:-']);
  });

  test('ungroup removes the markers; the requests stay and belong to the transaction around them', () => {
    const es = journey();
    StudioTxn.applyOne(es, { op: 'create', name: 'Outer', ids: [1, 5] });
    StudioTxn.applyOne(es, { op: 'create', name: 'Inner', ids: [3] });
    expect(shape(es)).toContain('3:Inner');
    expect(StudioTxn.applyOne(es, { op: 'ungroup', name: 'Inner' })).toBe(true);
    expect(shape(es)).toEqual(['[Outer', '1:Outer', '2:Outer', '3:Outer', '4:Outer', '5:Outer', ']Outer']);
    expect(es.filter((e) => !e.isMarker).length).toBe(5);
  });

  test('a recorded transaction (bookmark markers) can be renamed and ungrouped too', () => {
    nextId = 0;
    const es = [Object.assign(mk('start', 'T01_Launch'), { _userTxn: false }), req('/'), req('/a'), Object.assign(mk('end', 'T01_Launch'), { _userTxn: false }), req('/b')];
    StudioTxn.assign(es);
    expect(StudioTxn.applyOne(es, { op: 'rename', from: 'T01_Launch', to: 'T01_Open' })).toBe(true);
    expect(StudioTxn.applyOne(es, { op: 'ungroup', name: 'T01_Open' })).toBe(true);
    expect(shape(es)).toEqual(['1:-', '2:-', '3:-']);
  });

  test('replay after a new reading: every operation applied in order; one whose requests are gone is dropped', () => {
    const log = [{ op: 'create', name: 'T01_Login', ids: [2, 3] }, { op: 'rename', from: 'T01_Login', to: 'T01_SignIn' }, { op: 'create', name: 'Gone', ids: [99] }];
    const es = journey();
    const kept = StudioTxn.replay(es, log);
    expect(kept).toEqual(log.slice(0, 2));
    expect(StudioTxn.names(es)).toEqual(['T01_SignIn']);
    // the same log on a fresh reading gives the same result
    const again = journey();
    StudioTxn.replay(again, kept);
    expect(shape(again)).toEqual(shape(es));
  });

  test('nameError: the Recorder\'s rules and messages', () => {
    expect(StudioTxn.nameError('', [])).toBe('Enter a transaction name.');
    expect(StudioTxn.nameError('1abc', [])).toMatch(/start with a letter/);
    expect(StudioTxn.nameError('a-b', [])).toMatch(/only letters, numbers, underscores/);
    expect(StudioTxn.nameError('T01', ['T01'])).toMatch(/already exists/);
    expect(StudioTxn.nameError('T01', ['T01'], 'T01')).toBe('');   // renaming to its own name
    expect(StudioTxn.nameError('T02_Search', ['T01'])).toBe('');
  });
});

describe('StudioTxn through Script Studio\'s generator — a created transaction is in the script', () => {
  const fs = require('fs');
  const path = require('path');
  const PUB = path.resolve(__dirname, '../../src/web/public');
  const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
  global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
  global.VugenCodegen = require('../../src/web/public/shared/vugen-codegen.js');
  global.PageResources = require('../../src/web/public/shared/page-resources.js');
  global.HostParams = require('../../src/web/public/shared/host-params.js');

  test('Web HTTP/HTML: lr_start_transaction / lr_end_transaction around the ticked requests, numbered in journey order', () => {
    const doc = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
    // eslint-disable-next-line no-new-func
    const E = new Function('document', 'window', 'StudioTxn',
      read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') + '\n' + read('studio-codegen.js') +
      '\nreturn { S, parseHar, detectMarkers, applyFilters, genActionC };')(doc, { location: { pathname: '/converter/studio' } }, StudioTxn);
    const har = { log: { entries: ['/', '/login', '/home', '/search'].map((p, i) => ({
      startedDateTime: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), time: 50,
      request: { method: 'GET', url: 'https://shop.example.com' + p, headers: [{ name: 'Accept', value: 'text/html' }], queryString: [] },
      response: { status: 200, headers: [{ name: 'Content-Type', value: 'text/html' }], content: { mimeType: 'text/html', text: '<html></html>' } },
      _resourceType: 'document',
    })) } };
    const S = E.S;
    S.format = 'webhttp';
    S.entries1 = E.parseHar(har);
    E.detectMarkers(S.entries1);
    StudioTxn.replay(S.entries1, [{ op: 'create', name: 'T02_Search', ids: [4] }, { op: 'create', name: 'T01_Login', ids: [2, 3] }]);
    S.txns = StudioTxn.names(S.entries1).map((n) => ({ name: n }));
    S.filterResourceTypes = null; S.filterDomains = {};
    E.applyFilters(S.entries1);
    const c = E.genActionC(S.entries1, []);
    const at = (s) => c.indexOf(s);
    expect(at('lr_start_transaction("SC01_01_LOGIN")')).toBeGreaterThan(-1);
    expect(at('lr_end_transaction("SC01_01_LOGIN", LR_AUTO)')).toBeGreaterThan(at('lr_start_transaction("SC01_01_LOGIN")'));
    expect(at('lr_start_transaction("SC01_02_SEARCH")')).toBeGreaterThan(at('lr_end_transaction("SC01_01_LOGIN", LR_AUTO)'));
    // the first request is outside every transaction, the ticked ones inside
    expect(at('web_url("shop"')).toBeLessThan(at('lr_start_transaction("SC01_01_LOGIN")'));
    expect(at('web_url("login"')).toBeGreaterThan(at('lr_start_transaction("SC01_01_LOGIN")'));
    expect(at('web_url("home"')).toBeLessThan(at('lr_end_transaction("SC01_01_LOGIN", LR_AUTO)'));
    expect(at('web_url("search"')).toBeGreaterThan(at('lr_start_transaction("SC01_02_SEARCH")'));
  });
});
