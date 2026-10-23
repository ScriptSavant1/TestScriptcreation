'use strict';

/**
 * Converter redesign (src/web/views/partials/converter.ejs) — guards that the Postman / Bruno and
 * JMeter panels keep every element the converter functions in index.ejs look up, every handler,
 * and their help text. The converter golden harness proves requests, answers and ZIPs identical;
 * this test catches a missing id / handler before anything runs.
 */
const fs = require('fs');
const path = require('path');

const VIEWS = path.resolve(__dirname, '../../src/web/views');
const read = (f) => fs.readFileSync(path.join(VIEWS, f), 'utf-8').replace(/\r\n/g, '\n');
const index = read('index.ejs');
// rendered, so ids produced by the partial's template helpers are included
const partial = require('ejs').render(read('partials/converter.ejs'), {}, { filename: path.join(VIEWS, 'partials/converter.ejs') });

describe('Converter panels — markup the converter functions need', () => {
  test('index.ejs includes the converter partial exactly once and no longer has its own copy', () => {
    expect(index.match(/include\('partials\/converter'\)/g)).toHaveLength(1);
    expect(index).not.toContain('id="panel-bruno"');
  });

  // every getElementById(...) the converter script uses for its panels
  const ids = [...new Set([...index.matchAll(/getElementById\(\s*'([\w-]+)'\s*\)/g)].map((m) => m[1]))]
    .filter((id) => /^(panel-|tab-|pc-|jpc-|btn-(cvt|jmx|dl)|btn-lbl|jbtn-lbl|m-|tt-|ll-|jtt-|jwlm-|jmode-|adv-(btn|panel)|dz-|fi-|lbl-|bru-cert|res-|err-msg|stats-row|spinner|jspinner|prog-|jprog-|opt-)/.test(id));

  test('the id list is not empty (the filter still matches the converter script)', () => {
    expect(ids.length).toBeGreaterThan(40);
  });
  test.each(ids)('#%s exists in the converter partial', (id) => {
    expect(partial).toContain('id="' + id + '"');
  });

  test.each([
    "setProto('devweb')", "setProto('web-http')", "setJmxProto('devweb')", "setJmxProto('web-http')",
    "setMode('single')", "setMode('multi')", 'setTT(1)', 'setTT(2)', 'setTT(3)', 'setTT(5)', "setLL('info')", "setLL('debug')",
    "setJmxMode('single')", "setJmxMode('multi')", 'setJmxTT(1)', 'setJmxTT(5)', 'setJmxWlm(true)', 'setJmxWlm(false)',
    'toggleAdv()', 'doConvert()', 'doConvertJmx()', 'resetResult()', "switchTab('bruno')", "switchTab('jmx')",
    "onPick('dz-col','fi-col','lbl-col','collection')", "onPick('dz-env','fi-env','lbl-env','environment')",
    'onPickBrunoCert()', 'onDropBrunoCert(event)', 'onPickJmx()', 'onDropJmx(event)', 'onPickCsv()', 'onDropCsv(event)',
    'onPickCert()', 'onDropCert(event)', "onDrop(event,'dz-col','collection')", "onDrop(event,'dz-env','environment')",
  ])('handler %s is wired', (h) => { expect(partial).toContain(h); });

  test('advanced options keep their checkbox inside label.switch (the converter reads .checked)', () => {
    ['opt-corr', 'opt-param', 'opt-auth', 'opt-cmt'].forEach((id) =>
      expect(partial).toMatch(new RegExp('<label class="switch"><input type="checkbox" id="' + id + '" checked')));
  });

  test('help and instruction text is kept', () => {
    [
      'Extract dynamic values from API responses — access_token, userId, sessionId, CSRF tokens',
      'Convert static variables into CSV parameters — baseUrl, clientId, API keys',
      'OAuth2, Bearer (dynamic-aware), Basic, API Key, JWT (PS256 / RS256 / HS256), AWS Sig v4',
      'Inline explanatory comments in the generated script to guide manual review',
      'Optional — mutual TLS authentication', 'Optional — provides variable values',
      'Regex / JSON / Boundary / XPath / CSS extractors', 'Loop / If / ForEach controller context preserved',
      'Multiple .csv files — added to output ZIP', 'Detects correlations, JWT, auth, proxy, headers and classifies all variables into 3 tiers.',
      'Get a .zip. Open the .usr in VuGen or upload directly to LoadRunner Enterprise.',
      'Files processed in-memory — nothing stored on server',
    ].forEach((t) => expect(partial).toContain(t));
  });
});
