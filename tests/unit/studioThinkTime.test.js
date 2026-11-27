'use strict';

/**
 * Script Studio — think time between transactions (S.thinkTime, set on the page's step 1):
 *  - default (nothing chosen): 3 s, exactly what Studio has always written
 *  - fixed N: N seconds after every transaction but the last
 *  - recorded: the pause in the recording, from the end of the transaction's last request in the script to the start
 *    of the next request in the script, in whole seconds; under a second writes nothing; left-out requests ignored
 *  - none: no think time at all
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
  const doc = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  // eslint-disable-next-line no-new-func
  return new Function('document', 'window', read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') + '\n' + read('studio-codegen.js') +
    '\nreturn { S, genActionC, genMainJS, _thinkAfter };')(doc, { location: { pathname: '/converter/studio' } });
}

let nextId = 1;
function ent(url, o = {}) {
  return Object.assign({
    id: nextId++, url, method: 'GET', status: 200, ct: 'application/json', dur: 200, startMs: 0,
    reqHdrs: [], hdrsMap: {}, respHdrsMap: {}, body: null, referer: '', _resourceType: 'xhr', respBody: '',
    isMarker: false, filtered: false,
  }, o);
}
const mark = (type, name) => ({ id: nextId++, isMarker: true, markerType: type, txnName: name, url: 'https://' + type.toUpperCase() + '-' + name + '.invalid/' });

// T01 ends at 1.2 s, T02 starts at 6.3 s (5.1 s pause); T02 ends at 6.5 s, T03 starts at 6.8 s (0.3 s pause)
const recording = () => [
  mark('start', 'T01_Login'), ent('https://app.example.com/login', { startMs: 1000 }), mark('end', 'T01_Login'),
  mark('start', 'T02_Search'), ent('https://app.example.com/search', { startMs: 6300 }), mark('end', 'T02_Search'),
  mark('start', 'T03_Open'), ent('https://app.example.com/item/1', { startMs: 6800 }), mark('end', 'T03_Open'),
];

function scripts(think, entries) {
  const E = engine(), S = E.S;
  Object.assign(S, { format: 'both', entries1: entries || recording(), txns: [{ name: 'T01_Login' }, { name: 'T02_Search' }, { name: 'T03_Open' }], params: [], correlations: [], hostNames: {} });
  if (think) S.thinkTime = think;
  return { ac: E.genActionC(S.entries1, []), mj: E.genMainJS(S.entries1, []), E, S };
}
const count = (s, re) => (s.match(re) || []).length;

describe('Script Studio — think time between transactions', () => {
  test('default: 3 s after every transaction but the last, as before', () => {
    const { ac, mj } = scripts(null);
    expect(count(ac, /lr_think_time\(3\);/g)).toBe(2);
    expect(count(ac, /lr_think_time/g)).toBe(2);
    expect(mj).toContain('let think_time = 3;');
    expect(count(mj, /load\.thinkTime\(think_time\);/g)).toBe(2);
  });

  test('a fixed number of seconds', () => {
    const { ac, mj } = scripts({ mode: 'fixed', sec: 7 });
    expect(count(ac, /lr_think_time\(7\);/g)).toBe(2);
    expect(mj).toContain('let think_time = 7;');
    expect(count(mj, /load\.thinkTime\(think_time\);/g)).toBe(2);
  });

  test('a fixed value out of range falls back to 3 s', () => {
    expect(count(scripts({ mode: 'fixed', sec: 0 }).ac, /lr_think_time\(3\);/g)).toBe(2);
    expect(count(scripts({ mode: 'fixed', sec: 2.5 }).ac, /lr_think_time\(3\);/g)).toBe(2);
  });

  test('as recorded: the pause in whole seconds; a pause under a second writes nothing', () => {
    const { ac, mj } = scripts({ mode: 'recorded' });
    expect(count(ac, /lr_think_time\(5\);/g)).toBe(1);
    expect(count(ac, /lr_think_time/g)).toBe(1);
    expect(mj).not.toContain('think_time =');
    expect(count(mj, /load\.thinkTime\(5\);/g)).toBe(1);
    expect(count(mj, /load\.thinkTime/g)).toBe(1);
  });

  test('as recorded: a left-out request during the pause does not shorten it', () => {
    const es = recording();
    es.splice(3, 0, ent('https://ads.example.net/ping', { startMs: 3000, filtered: true }));
    expect(count(scripts({ mode: 'recorded' }, es).ac, /lr_think_time\(5\);/g)).toBe(1);
  });

  test('none: no think time in either format', () => {
    const { ac, mj } = scripts({ mode: 'none' });
    expect(ac).not.toContain('lr_think_time');
    expect(mj).not.toContain('thinkTime');
    expect(mj).not.toContain('think_time');
  });

  test('never after the last transaction', () => {
    const { ac } = scripts({ mode: 'fixed', sec: 4 });
    const last = ac.lastIndexOf('lr_end_transaction');
    expect(ac.slice(last)).not.toContain('lr_think_time');
  });
});
