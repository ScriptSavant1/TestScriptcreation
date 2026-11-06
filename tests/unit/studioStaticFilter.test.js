'use strict';

/**
 * Script Studio applyFilters() — static files (CSS, JS, images, fonts) must
 * respect the resource-type selection.
 *
 * User report: with every resource type selected in Script Studio, the script
 * still had no static resources at all. applyFilters() dropped STATIC_CT /
 * STATIC_EXT entries unconditionally, before the resource-type check, so
 * selecting Img/CSS/JS/Font (or "All") could never include them. Now they are
 * dropped only when their type is not selected. Default selection (Fetch/XHR +
 * Doc) is unchanged.
 */

const fs = require('fs');
const path = require('path');

function loadStudio() {
  const pub = path.resolve(__dirname, '../../src/web/public');
  const constants = fs.readFileSync(path.join(pub, 'VuGen-Script-Studio-constants.js'), 'utf-8');
  const correlation = fs.readFileSync(path.join(pub, 'VuGen-Script-Studio-correlation.js'), 'utf-8');
  // eslint-disable-next-line no-new-func
  return new Function(constants + '\n' + correlation + '\nS.filterDomains = {};\nreturn { S, applyFilters };')();
}

const entry = (url, ct, rt) => ({ url, ct, _resourceType: rt, method: 'GET', hdrsMap: {}, body: null, isMarker: false });

function run(selection) {
  const { S, applyFilters } = loadStudio();
  S.filterResourceTypes = selection;
  const entries = [
    entry('https://shop.example.com/', 'text/html', 'document'),
    entry('https://shop.example.com/css/site.css', 'text/css', 'stylesheet'),
    entry('https://shop.example.com/img/logo.gif', 'image/gif', 'image'),
    entry('https://shop.example.com/js/app.js', 'application/javascript', 'script'),
    entry('https://shop.example.com/api/items', 'application/json', 'xhr'),
    entry('https://www.google-analytics.com/collect', 'image/gif', 'image'),
  ];
  applyFilters(entries);
  return entries.filter((e) => !e.filtered).map((e) => e.url.replace(/^https:\/\/[^/]+/, ''));
}

describe('Script Studio applyFilters — static files follow the resource-type selection', () => {
  test('default selection (Fetch/XHR + Doc) still drops static files', () => {
    expect(run(new Set(['fetch', 'document']))).toEqual(['/', '/api/items']);
  });

  test('"All" (null) keeps static files; known analytics hosts are still dropped', () => {
    expect(run(null)).toEqual(['/', '/css/site.css', '/img/logo.gif', '/js/app.js', '/api/items']);
  });

  test('selecting only Img keeps images, still drops CSS and JS', () => {
    expect(run(new Set(['fetch', 'document', 'image']))).toEqual(['/', '/img/logo.gif', '/api/items']);
  });

  test('data:, blob: and chrome-extension: URLs are always dropped, even with "All"', () => {
    const { S, applyFilters } = loadStudio();
    S.filterResourceTypes = null;
    const entries = [
      entry('data:image/png;base64,AAAA', 'image/png', 'image'),
      entry('blob:https://shop.example.com/1234', 'image/png', 'image'),
      entry('chrome-extension://abc/inject.js', 'application/javascript', 'script'),
      entry('https://shop.example.com/', 'text/html', 'document'),
    ];
    applyFilters(entries);
    expect(entries.map((e) => e.filtered)).toEqual([true, true, true, false]);
  });

  test('an empty selection behaves as before (no type filter, static dropped)', () => {
    expect(run(new Set())).toEqual(['/', '/api/items']);
  });
});
