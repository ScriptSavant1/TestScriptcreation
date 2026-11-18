'use strict';

/**
 * Script Studio: the script ID of a recording made with Start recording (CDP Recorder 0.2.3 writes it as
 * log._perfx_scriptId) starts the transaction names (SC07_01_…); any other recording keeps SC01, as before.
 */

const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
global.VugenCodegen = require('../../src/web/public/shared/vugen-codegen.js');
global.PageResources = require('../../src/web/public/shared/page-resources.js');
global.HostParams = require('../../src/web/public/shared/host-params.js');

function scripts(har1) {
  const doc = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  // eslint-disable-next-line no-new-func
  const E = new Function('document', 'window', read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') + '\n' + read('studio-codegen.js') +
    '\nreturn { S, genActionC, genMainJS };')(doc, { location: { pathname: '/converter/studio' } });
  const e = { id: 1, url: 'https://shop.example.com/api/menu', method: 'GET', status: 200, ct: 'application/json', _resourceType: 'fetch', reqHdrs: [], hdrsMap: {}, respHdrsMap: {}, body: null, referer: '', respBody: '', isMarker: false, filtered: false, startMs: 0 };
  Object.assign(E.S, { format: 'both', entries1: [e], txns: [], params: [], correlations: [], hostNames: {}, har1: har1 });
  return { ac: E.genActionC(E.S.entries1, []), mj: E.genMainJS(E.S.entries1, []) };
}

describe('Script Studio — script ID in transaction names', () => {
  test('a recording with a script ID: its transactions start with it', () => {
    const { ac, mj } = scripts({ log: { entries: [], _perfx_scriptId: 'SC07' } });
    expect(ac).toContain('SC07_01_Transaction');
    expect(ac).not.toContain('SC01_');
    expect(mj).toContain('SC07_01_Transaction');
  });

  test('without one (any other recording): SC01, as before', () => {
    expect(scripts({ log: { entries: [] } }).ac).toContain('SC01_01_Transaction');
    expect(scripts(null).ac).toContain('SC01_01_Transaction');
  });

  test('a value that is not a script ID is ignored', () => {
    expect(scripts({ log: { _perfx_scriptId: 'sc 07"; x' } }).ac).toContain('SC01_01_Transaction');
  });
});
