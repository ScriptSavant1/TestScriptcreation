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
    expect(scripts(page).slice(engine.length)).toEqual(['portal/track.js', 'portal/drop-anywhere.js', 'portal/record-live.js', 'portal/studio-txn.js', 'portal/request-details.js', 'portal/find-value.js', 'portal/plan-load.js', 'portal/studio-page.js', 'portal/studio-workspace.js', 'portal/studio-testdata.js', 'portal/studio-corr.js', 'portal/studio-editor.js', 'portal/studio-history.js']);
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
  // toggleCorrPanel: the list is a section of its own now, opened by its bar (studio-corr.js section)
  const REPLACED = new Set(['studioToggleAllDomains(true)', 'studioToggleAllDomains(false)', 'studioRenderDomains(this.value)', 'goBack()', 'toggleCorrPanel()']);
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
    ['ss-tab-script', 'ss-t-script', 'ss-t-corr', 'ss-t-data'].forEach((id) => expect(page).toContain('id="' + id + '"'));
    expect(js).toContain('var TAB_STEP = { script: 1, corr: 2, data: 3 }');
    expect(js).toContain('function tab(name) { step(TAB_STEP[name] || 1); }');
    expect(js).toContain('if (slot === 1) { step(1, true); S.scriptName = ""; nameShow(); if (window.SSE) SSE.close(); if (window.SSC) SSC.reset(); if (window.SSH) SSH.reset(); }');
    // step 1 settings: the script name and the think time
    ['id="ss-name-btn"', 'id="ss-sc-name"', 'id="ss-think"', 'id="ss-think-sec"'].forEach((id) => expect(page).toContain(id));
  });
  test('two rows above the panels: title, counts, Undo, Redo, Download; steps, format, think time, filters', () => {
    const top = page.slice(page.indexOf('id="ss-filebar"'), page.indexOf('id="ss-cols"'));
    ['id="ss-name-btn"', 'id="ss-from"', 'id="ss-k-in"', 'id="ss-k-all"', 'id="ss-k-tx"', 'id="ss-auth"', 'id="ss-open-another"', 'id="ss-state"', 'id="ss-notices"', 'id="ss-undo"', 'id="ss-redo"', 'id="ss-wm"', 'id="ss-dl"', 'id="ss-dl-more"', 'id="ss-steps"', 'id="ss-fmt"', 'id="ss-think-pop"', 'id="ss-fbar"', 'id="ss-types"', 'data-leave="ads"', 'data-leave="options"', 'id="ss-bg-btn"', 'id="ss-res-pop"'].forEach((x) => expect(top).toContain(x));
  });
  test('the start page: the band every tool has, two ways, two links; Find in this file', () => {
    ['id="ss-code-q"', 'class="ds-band ds-band-panel ss-band"', 'id="ss-rec-btn"', 'id="dz1"', 'id="ss-how-btn"', 'id="ss-guide-btn"'].forEach((x) => expect(page).toContain(x));
    expect(page).not.toMatch(/id="ss-hero"|data-fold="(rec|open|how|guide)"/);
  });
  test('a click on a request opens its window; its tick is for a new transaction (owner, 2026-11-25: keep both)', () => {
    const ws = read('portal/studio-workspace.js');
    expect(js).toContain('SS.inScript = function (e) { return !e.filtered && (typeof shouldIncludeEntry !== "function" || shouldIncludeEntry(e, S.bgDecisions) || SS.setup(e)); };');
    expect(ws).toContain('if (!cb.disabled && (e.target === cb || W.sel.size || W.picking)) tick(id, e.target === cb ? cb.checked : !W.sel.has(id), e.shiftKey);\n    else openDet(id);');
    expect(page).not.toMatch(/id="ss-tab-req"|id="ss-t-req"/);
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
    ['advisorAccept(', 'advisorSkip(', 'advisorSetName(', 'advisorApplyAndRegen()', 'advisorShowUses(', 'openAdvisorModal()', 'openPasteCorrelate()', 'SSW.openFind()', 'advisorRemoveFromScript(', 'advisorRestoreToScript(', 'advisorSuggestMore('].forEach((f) => expect(js).toContain(f));
    expect(js).not.toMatch(/S\.correlations\s*=|\.status\s*=[^=]|_applied\s*=[^=]/);
  });
});

// Add manual correlation is the editor's add screen (portal/studio-editor.js): the value goes in through the engine —
// advisorAddManual (uses found the engine's way), the exact extractor as _edit, advisorApplyOne (this value only)
describe('Script Studio — Add manual correlation', () => {
  const corr = read('portal/studio-corr.js'), ed = read('portal/studio-editor.js');
  test('the table button opens the add screen of the editor; the classic dialog stays for the Cards view', () => {
    expect(corr).toContain('if (window.SSE && SSE.add) SSE.add(); else if (typeof openAdvisorModal === "function") openAdvisorModal();');
    expect(page).toContain('id="adv-modal-overlay"');
  });
  test('several values: kept in Values to add, all added at once through the same engine calls, one regeneration', () => {
    ['function keep()', 'tray.push(k)', 'var all = tray.slice(), k = current(); if (k) all.push(k);', '"Add all " + n + " to the script"', 'Leave without adding?'].forEach((f) => expect(ed).toContain(f));
    expect((ed.match(/regenerateFromAdvisor\(\{ quiet: true \}\)/g) || []).length).toBeGreaterThan(0);
  });
  test('Edit a correlation in the script: taken out while it changes, saved back or put back as it was', () => {
    ['function startEdit(c)', 'advisorRemoveFromScript(c.id)', 'advisorApplyOne(c)', 'advisorRestoreToScript(c.id, gone)', 'Save to the script', '"Discard"'].forEach((f) => expect(ed).toContain(f));
    expect(ed).toContain('closest("#corr-list .corr-item")');   // Correlation details: a click opens the editor
    expect(read('portal/studio-corr.js')).toContain('show: showOnly');
  });
  test('the add screen uses the engine functions', () => {
    ['advisorAddManual(', 'advisorApplyOne(made)', '_advFindUsages(', 'regenerateFromAdvisor({ quiet: true })', 'made._edit = {'].forEach((f) => expect(ed).toContain(f));
    expect(ed).not.toMatch(/S\.correlations\s*=|S\.advisorCandidates\s*=/);
    expect(read('studio-ui.js')).toContain('  advisorApplyOne(cand);');   // Paste & Detect: the same function
  });
});

// A list's options are in the editor: the engine functions the cards use, nothing written to the engine state by the page
describe('Script Studio — list options in the editor', () => {
  const ed = read('portal/studio-editor.js'), corr = read('portal/studio-corr.js');
  test('every value / one at random, the loop anchor and the missing paths go through the engine', () => {
    ['advisorSetListPick(c.id, pk, nv)', 'advisorSetListPick(c0.id, "nth", nv)', 'advisorAddList(', 'advisorFillArrayPaths(', 'advisorSetArrayAnchor(', 'renderAdvisorPanel()'].forEach((f) => expect(ed).toContain(f));
    expect(ed).not.toMatch(/_pick\s*=[^=]|countVar\s*=[^=]|\.extractorType\s*=[^=]/);   // reads (===) are fine
  });
  test('Options on a list row opens the editor', () => {
    expect(corr).toContain('if (b) { if (window.SSE) SSE.open(b.getAttribute("data-opts")); }');
  });
});

// Fit to the window: steps 2, 3 and 4 use the whole width beside the sidebar (no cap, not centred); step 4 shows the
// script files with their code, read from the engine's S.scripts only (nothing written to the engine)
describe('Script Studio — steps fit the window', () => {
  const css = read('portal/studio.css'), page = read('portal/studio-page.js'), html = read('Studio.html');
  test('no width cap on Correlate, Test data or Download', () => {
    expect(css).not.toMatch(/#ss-t-(corr|data) \{[^}]*max-width: 1500px/);
    expect(css).not.toMatch(/\.ss-done-card \{[^}]*max-width/);
    expect(css).toContain('body.ss-step-wide #ss-t-corr > .ss-sec.is-open { flex: 1 1 0;');
  });
  test('Correlate: three named sections, one open; everything of before is in them', () => {
    const corr = html.slice(html.indexOf('id="ss-t-corr"'), html.indexOf('id="ss-t-data"'));
    const at = ['data-sec="values"', 'data-sec="script"', 'data-sec="second"'].map((x) => corr.indexOf(x));
    expect(at.every((x) => x > 0) && at[0] < at[1] && at[1] < at[2]).toBe(true);
    const inside = (from, to, ids) => ids.forEach((id) => { const i = corr.indexOf('id="' + id + '"'); expect([id, i > from && i < to]).toEqual([id, true]); });
    inside(at[0], at[1], ['ss-sec-n1', 'ss-cr-manual', 'ss-cr-cant', 'ss-cr-view', 'ss-cr-tools', 'ss-cr-table', 'ss-cr-foot', 'ss-cr-apply', 'adv-panel', 'adv-cards', 'adv-btn-regen']);
    inside(at[1], at[2], ['ss-sec-n2', 'ss-sec-w2', 'corr-list', 'corr-toggle-icon']);
    inside(at[2], corr.length, ['ss-sec-n3', 'mode-badge', 'dz2', 'dz2-clear']);
    expect((corr.match(/class="ss-sec-b"/g) || []).length).toBe(3);
    expect((corr.match(/aria-expanded="true" aria-controls="ss-cr-wrap"/g) || []).length).toBe(1);
  });
  test('step 4: the files and their code beside the Ready list, every old id kept', () => {
    ['ss-done-list', 'ss-done-fh', 'ss-done-files', 'ss-done-dl', 'ss-done-ftabs', 'ss-done-pre', 'ss-done-copy'].forEach((id) => expect(html).toContain('id="' + id + '"'));
    const fn = page.slice(page.indexOf('function doneFiles()'), page.indexOf('$("#ss-done-ftabs").addEventListener("click"'));
    expect(fn).toContain('S.scripts[doneKey]');
    expect(fn).not.toMatch(/S\.\w+\s*=[^=]/);
  });
});

// Plan the load in Workload Modeller: the same ZIP as Download ZIP, built with a collector (nothing downloaded) and
// handed over by the shared helper; without a collector dlZip downloads, as always
describe('Script Studio — Plan the load', () => {
  const app = read('studio-app.js'), page = read('portal/studio-page.js'), html = read('Studio.html');
  test('dlZip(fmt, opts): a collector gets the ZIPs; the download is the default', () => {
    expect(app).toContain('async function dlZip(fmt, opts) {');
    expect(app).toContain('if (opts && Array.isArray(opts.collect)) { opts.collect.push({ name, blob }); return; }');
    expect(app.split('deliver(blob, nm + ".zip");').length - 1).toBe(2);
  });
  test('the buttons, only inside the portal, through portal/plan-load.js', () => {
    ['ss-wm', 'ss-done-wm'].forEach((id) => expect(html).toContain('id="' + id + '"'));
    expect(page).toContain('dlZip(S.format, { collect: files })');
    expect(page).toContain('PerfxPlanLoad.send(');
    expect(page).toContain('var canPlan = !!(window.PerfxPlanLoad && PerfxPlanLoad.available());');
  });
});

// the review (regression-tests/tools/audit/review.js) findings fixed: every step button is named, a long notice is
// cut instead of widening the page, and step 1's resize bars take the keyboard
describe('Script Studio — review fixes', () => {
  const html = read('Studio.html'), css = read('portal/studio.css'), ws = read('portal/studio-workspace.js');
  test('step buttons named; notices cannot widen the page; step 1 bars are keyboard separators', () => {
    ['Requests', 'Correlate', 'Test data', 'Download'].forEach((n, i) => expect(html).toContain('data-step="' + (i + 1) + '" aria-label="Step ' + (i + 1) + ': ' + n + '" aria-describedby="ss-st-' + (i + 1) + '"'));
    expect(css).toContain('.ss-notices { display: grid; grid-template-columns: minmax(0, 1fr);');
    expect(html.match(/class="ss-rs"[^>]*role="separator"[^>]*tabindex="0"/g).length).toBe(2);
    expect(ws).toContain('rs.addEventListener("keydown"');
  });
});
