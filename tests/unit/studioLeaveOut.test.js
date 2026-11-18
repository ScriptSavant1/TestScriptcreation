'use strict';

/**
 * Script Studio: one request left out by hand (request details → Leave out). applyFilters gives it the reason "user"
 * after the shared rules, so a request already left out by a rule keeps that reason; Put back (taking the id out of
 * S.leaveOutIds) brings it back; the generators leave it out like any other left-out request.
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
    '\nreturn { S, applyFilters, genActionC };')(doc, { location: { pathname: '/converter/studio' } });
}
const ent = (id, url, o = {}) => Object.assign({ id, url, method: 'GET', status: 200, ct: 'application/json', _resourceType: 'fetch', reqHdrs: [], hdrsMap: {}, respHdrsMap: {}, body: null, referer: '', respBody: '', isMarker: false, filtered: false, startMs: 0 }, o);
const entries = () => [
  ent(1, 'https://shop.example.com/', { ct: 'text/html', _resourceType: 'document' }),
  ent(2, 'https://api.example.com/v1/menu'),
  ent(3, 'https://api.example.com/v1/cart'),
  ent(4, 'https://shop.example.com/app.js', { ct: 'application/javascript', _resourceType: 'script' }),
];

// Studio's default types: pages, Fetch/XHR, media and other (JS, CSS, images and fonts left out)
const DEFAULT_TYPES = () => new Set(['document', 'fetch', 'media', 'other']);

function run(ids) {
  const E = engine(), S = E.S;
  Object.assign(S, { format: 'webhttp', entries1: entries(), txns: [], params: [], correlations: [], hostNames: {}, leaveOutIds: new Set(ids), filterResourceTypes: DEFAULT_TYPES() });
  E.applyFilters(S.entries1);
  return { S, ac: E.genActionC(S.entries1, []) };
}

describe('Script Studio — leave out one request', () => {
  test('a request left out by hand gets the reason "user" and is not in the script', () => {
    const { S, ac } = run([2]);
    const e2 = S.entries1.find((e) => e.id === 2);
    expect(e2.leftOut).toBe('user');
    expect(e2.filtered).toBe(true);
    expect(ac).not.toContain('/v1/menu');
    expect(ac).toContain('/v1/cart');
  });

  test('Put back: without the id the request is in the script again, the script as without any change', () => {
    const { S, ac } = run([]);
    expect(S.entries1.find((e) => e.id === 2).filtered).toBe(false);
    expect(ac).toContain('/v1/menu');
  });

  test('a request already left out by a rule keeps its own reason', () => {
    const { S } = run([4]);
    expect(S.entries1.find((e) => e.id === 4).leftOut).toBe('type');
  });

  test('no set (an older state) changes nothing', () => {
    const E = engine(), S = E.S;
    Object.assign(S, { entries1: entries(), filterResourceTypes: DEFAULT_TYPES() });
    delete S.leaveOutIds;
    E.applyFilters(S.entries1);
    expect(S.entries1.filter((e) => e.filtered).map((e) => e.id)).toEqual([4]);
  });
});
