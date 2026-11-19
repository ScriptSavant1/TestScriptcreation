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
    expect(scripts(page).slice(engine.length)).toEqual(['portal/track.js', 'portal/drop-anywhere.js', 'portal/record-live.js', 'portal/studio-txn.js', 'portal/request-details.js', 'portal/find-value.js', 'portal/studio-page.js', 'portal/studio-workspace.js', 'portal/studio-testdata.js', 'portal/studio-corr.js']);
  });

  test('the classic stylesheet is still loaded (it styles what the scripts draw), then the new one', () => {
    const sheets = [...page.matchAll(/<link rel="stylesheet" href="([^"]+)"/g)].map((m) => m[1]).filter((src) => src !== 'portal/frame-guard.js');
    // the portal design system (portal/ds.css) comes first, before the page's own sheets
    expect(sheets).toEqual(['portal/ds.css', 'portal/brand.css', 'VuGen-Script-Studio.css', 'portal/request-details.css', 'portal/find-value.css', 'portal/studio.css', 'portal/record-live.css']);
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

  // The classic set-up screen's domain list and its Start over button are gone: the workspace's Domains panel calls the
  // same engine functions (studioToggleAllDomains for All on / All off) and draws its own list and search; the start
  // screen is one click away (Open another), and nothing restarts when a choice changes.
  const REPLACED = new Set(['studioToggleAllDomains(true)', 'studioToggleAllDomains(false)', 'studioRenderDomains(this.value)', 'goBack()']);
  test('every onclick / onchange / oninput handler of the classic page is still wired', () => {
    const handlers = (html) => new Set([...html.matchAll(/on(?:click|change|input|drop|dragover|dragleave)="([^"]+)"/g)].map((m) => m[1].replace(/\s+/g, ' ').trim()));
    const mine = handlers(page);
    expect([...handlers(classic)].filter((h) => !mine.has(h) && !REPLACED.has(h))).toEqual([]);
    const ws = fs.readFileSync(path.join(PUB, 'portal/studio-workspace.js'), 'utf-8');
    ['studioToggleAllDomains(true)', 'studioToggleAllDomains(false)'].forEach((h) => expect(ws).toContain(h));
  });

  test('help and instruction text of the classic page is kept', () => {
    const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
    const mine = plain(page);
    [
      'Should I include Img / CSS / JS / Font?',
      'Leave them out',
      'are not downloaded from the HTML, so they are only downloaded if they are in the script.',
      'Known analytics/ads domains are always left out here unless you untick',
      'Shows up to 20 candidates',
      'Paste the server response body',
      'For diff-based correlation',
    ].forEach((t) => expect(mine).toContain(t));
  });

  // The Recorder tool is part of Script Studio: its "How to record your journey" guide lives on Studio's start screen
  test('the How to record guide moved from the Recorder page is on the start screen, with both ways and the bookmarks', () => {
    const plain = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, ' ');
    const mine = plain(page);
    [
      'How to record your journey',
      'Set up once on this computer',
      'Or start it yourself',
      'Install the transaction bookmarks',
      'Bookmarklets only work on real websites.',
      'Required: enable "Allow to generate HAR with Sensitive Data" before recording',
      'Keep the Developer Tools (F12) open for the entire recording session. Closing it loses all recorded data.',
    ].forEach((t) => expect(mine).toContain(t));
    ['id="cdp-dl"', 'id="tab-cdp"', 'id="tab-classic"', 'id="how-cdp"', 'id="how-classic"', "new Image().src='https://START-'", "new Image().src='https://END-'"].forEach((t) => expect(page).toContain(t));
    expect(page).not.toMatch(/Select mode/);
  });

  test('old Recorder addresses and links lead to Script Studio', () => {
    const server = fs.readFileSync(path.resolve(__dirname, '../../src/web/server.js'), 'utf-8');
    expect(server).toMatch(/app\.get\(\["\/recorder", "\/converter\/recorder"\][^]*?res\.redirect\(301, req\.path\.replace\(\/recorder\$\/, "studio"\)\)/);
    const shell = fs.readFileSync(path.join(PUB, 'portal/shell.js'), 'utf-8');
    expect(shell).toContain('const ALIAS = { record: "studio" };');
    expect(shell).toContain('"#/record": "#/studio"');
    expect(fs.existsSync(path.join(PUB, 'Recorder.html'))).toBe(false);
  });
});

// The workspace in four steps (portal/studio-page.js): each step is a view of the same workspace, and the old tabs
// open their step, so every caller that opened a tab (the engine, Ready to download, request details) still works.
describe('Script Studio — the four steps', () => {
  const js = read('portal/studio-page.js');
  test('the step line has Requests, Correlate, Test data and Download, with Next / Back', () => {
    [1, 2, 3, 4].forEach((n) => expect(page).toContain('data-step="' + n + '"'));
    ['id="ss-steps"', 'id="ss-step-next"', 'id="ss-step-back"', 'id="ss-done"', 'id="ss-done-dl"', 'id="ss-done-list"'].forEach((id) => expect(page).toContain(id));
  });
  test('the tabs are kept (the engine and the harness use them) and each one opens its step', () => {
    ['ss-tab-script', 'ss-tab-corr', 'ss-tab-data', 'ss-t-script', 'ss-t-corr', 'ss-t-data'].forEach((id) => expect(page).toContain('id="' + id + '"'));
    expect(js).toContain('var TAB_STEP = { script: 1, corr: 2, data: 3 }');
    expect(js).toContain('function tab(name) { step(TAB_STEP[name] || 1); }');
    expect(js).toContain('if (slot === 1) { step(1, true); S.scriptName = ""; nameShow(); }');
    // step 1 settings: the script name and the think time
    ['id="ss-setbar"', 'id="ss-sc-name"', 'id="ss-think"', 'id="ss-think-sec"'].forEach((id) => expect(page).toContain(id));
  });
});

// Step 2 (portal/studio-corr.js): the table only drives the engine — a tick is advisorAccept, Skip advisorSkip, the name
// advisorSetName, Add to the script advisorApplyAndRegen — so the script is what the cards give; the cards stay (Cards view).
describe('Script Studio — the Correlate table', () => {
  const js = read('portal/studio-corr.js');
  test('the table, its tools and the Cards view are on the page', () => {
    ['ss-corr', 'ss-cr-table', 'ss-cr-body', 'ss-cr-apply', 'ss-cr-high', 'ss-cr-clear', 'ss-cr-manual', 'ss-cr-cant', 'ss-cr-cant-m', 'ss-cr-view', 'adv-panel', 'adv-cards'].forEach((id) => expect(page).toContain('id="' + id + '"'));
  });
  test('every change goes through the engine functions the cards use', () => {
    ['advisorAccept(', 'advisorSkip(', 'advisorSetName(', 'advisorApplyAndRegen()', 'advisorShowUses(', 'openAdvisorModal()', 'openPasteCorrelate()', 'SSW.openFind()'].forEach((f) => expect(js).toContain(f));
    expect(js).not.toMatch(/S\.correlations\s*=|\.status\s*=[^=]|_applied\s*=[^=]/);
  });
});
