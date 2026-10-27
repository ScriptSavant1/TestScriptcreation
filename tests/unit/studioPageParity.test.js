'use strict';

/**
 * Script Studio redesign (src/web/public/Studio.html) — guards that the new page runs the SAME
 * scripts as the classic page (VuGen-Script-Studio.html) and keeps every element the Studio
 * scripts look up. studio-ui.js / studio-app.js find their elements by id (getElementById) and a
 * few classes (.phase, .fmt-btn, .code-tab …); a missing one would silently break a feature.
 */

const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/\r\n/g, '\n');
const classic = read('VuGen-Script-Studio.html');
const page = read('Studio.html');
const scripts = (html) => [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((src) => src !== 'portal/frame-guard.js');

describe('Script Studio redesign — same scripts as the classic page', () => {
  test('Studio.html loads the classic scripts unchanged, in the same order, then its layout script', () => {
    const engine = scripts(classic);
    expect(scripts(page).slice(0, engine.length)).toEqual(engine);
    expect(scripts(page).slice(engine.length)).toEqual(['portal/studio-page.js']);
  });

  test('the classic stylesheet is still loaded (it styles what the scripts draw), then the new one', () => {
    const sheets = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]).filter((src) => src !== 'portal/frame-guard.js');
    // the portal design system (portal/ds.css) comes first, before the page's own sheets
    expect(sheets).toEqual(['portal/ds.css', 'VuGen-Script-Studio.css', 'portal/studio.css']);
  });
});

describe('Script Studio redesign — every element the scripts use exists', () => {
  const ui = read('studio-ui.js') + read('studio-app.js');
  const ids = [...new Set([...ui.matchAll(/getElementById\(\s*["']([\w-]+)["']\s*\)/g)].map((m) => m[1]))]
    // built from a slot number at run time ("dz" + slot + "-name") — checked below
    .filter((id) => !/^(dz|pstep)$/.test(id));
  // ids the scripts create themselves inside rendered HTML (not part of the page)
  const created = new Set([...ui.matchAll(/id=\\?["']([\w-]+)\\?["']/g)].map((m) => m[1]));

  test.each(ids.filter((id) => !created.has(id)))('#%s', (id) => {
    if (classic.includes('id="' + id + '"')) expect(page).toContain('id="' + id + '"');
  });

  test.each(['dz1', 'dz2', 'dz1-title', 'dz1-sub', 'dz1-name', 'dz1-clear', 'dz2-title', 'dz2-sub', 'dz2-name', 'dz2-clear', 'pstep-1', 'pstep-2', 'pstep-3'])(
    'slot / step element #%s', (id) => { expect(page).toContain('id="' + id + '"'); });

  test('every id in the classic page is in the new page (except the dropped header badges)', () => {
    const dropped = new Set(['har-count-badge']); // never read by any script
    const missing = [...classic.matchAll(/id="([\w-]+)"/g)].map((m) => m[1]).filter((id) => !dropped.has(id) && !page.includes('id="' + id + '"'));
    expect(missing).toEqual([]);
  });

  test('every onclick / onchange / oninput handler of the classic page is still wired', () => {
    const handlers = (html) => new Set([...html.matchAll(/on(?:click|change|input|drop|dragover|dragleave)="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ' ').trim()));
    const mine = handlers(page);
    expect([...handlers(classic)].filter((h) => !mine.has(h))).toEqual([]);
  });

  test('help and instruction text of the classic page is kept', () => {
    const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
    const mine = plain(page);
    [
      'Should I include Img / CSS / JS / Font?',
      'Leave them out',
      'are not downloaded from the HTML, so they are only downloaded if they are in the script.',
      'Known analytics/ads domains are always left out here.',
      'Shows up to 20 candidates',
      'Paste the server response body',
      'Load a HAR recording on the left to configure filters.',
      'For diff-based correlation',
    ].forEach((t) => expect(mine).toContain(t));
  });
});
