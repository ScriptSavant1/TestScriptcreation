#!/usr/bin/env node
// Script Studio, existing behaviour against new behaviour: the same user actions on two versions of the page, what each
// one does written in plain words, and every difference listed. Run it before and after any change of the page.
//   node behave.js <oldUrl> <newUrl>          e.g. node behave.js http://localhost:3998/converter/studio http://localhost:3999/converter/studio
// The old version: git archive <commit> src/web/public | tar -x -C <folder>, then node serve-old.js <folder> 3998
// Exit code 1 when something differs: each difference is agreed with the owner, or it is a fault.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const [OLD, NEW] = process.argv.slice(2).filter((a) => !a.startsWith('--')), FX = path.join(__dirname, 'fixtures') + path.sep;

async function walk(b, url, w, h) {
  const p = await b.newPage({ viewport: { width: w, height: h }, acceptDownloads: true }), out = {}, errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.route('**://localhost:8787/**', (r) => r.abort()); await p.route('**/analytics/track', (r) => r.fulfill({ status: 204 }));
  const is = (k, v) => { out[k] = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v; };
  const vis = (s) => p.locator(s).first().isVisible(), ev = (f, a) => p.evaluate(f, a), wait = (ms) => p.waitForTimeout(ms);
  const idle = async () => { await wait(350); await p.waitForFunction(() => !SS.busy() && !document.body.classList.contains('ss-reading'), null, { timeout: 60000 }); await wait(350); };
  // a control that may stand in a pop-up now: opened first
  const reach = async (s) => { if (await vis(s)) return true; for (const btn of ['#ss-filters-btn', '#ss-think-btn', '.ss-note-b', '#ss-name-btn', '#ss-guide-btn', '#ss-how-btn']) { if (!(await p.locator(btn).count()) || !(await vis(btn))) continue; await p.locator(btn).first().click(); await wait(80); if (await vis(s)) return true; await p.keyboard.press('Escape'); await wait(60); } return false; };
  const click = async (s, o) => { if (!(await reach(s))) throw new Error('not in reach: ' + s); await p.locator(s).first().click(o); await wait(120); };
  const part = async (name, f) => { try { await f(); } catch (e) { out[name + ': stopped'] = e.message.split('\n')[0].slice(0, 160); } for (let i = 0; i < 3; i++) { await p.keyboard.press('Escape'); await wait(40); } };
  const row = (id) => `.ss-rq[data-id="${id}"]`, code = () => ev(() => JSON.stringify(S.scripts));

  await p.goto(url); await ev(() => { document.documentElement.classList.add('embedded'); }); await wait(500);
  await part('start', async () => {
    for (const [k, s] of [['Start recording', '#ss-rec-btn'], ['open a file', '#dz1'], ['CDP Recorder download', '#cdp-dl'], ['bookmarks way', '#tab-classic']]) is('start: ' + k, await reach(s));
    await p.keyboard.press('Escape');
  });
  await p.goto(url); await ev(() => { document.documentElement.classList.add('embedded'); }); await wait(400);
  await p.setInputFiles('#dz1 input', FX + 'rich-shop.har'); await p.waitForFunction(() => document.body.classList.contains('ss-view-ws'), null, { timeout: 60000 }); await idle();
  is('background window opens by itself', await vis('#ss-bg-dlg')); await p.keyboard.press('Escape'); await idle();

  await part('a request', async () => {
    await click(row(10) + ' .ss-path'); is('click on a request: opens a window over the page', await vis('#ss-det') && await ev(() => getComputedStyle(document.getElementById('ss-det')).position === 'fixed')); is('its title', await p.locator('#ss-det-h').innerText()); is('its tabs', await ev(() => [...document.querySelectorAll('#ss-det-b .hx-tab')].map((x) => x.textContent.replace(/\d/g, '').trim()).join(' · '))); is('the page behind is dimmed', await vis('#ss-det-scrim'));
    is('its buttons', await ev(() => [...document.querySelectorAll('#ss-det .ss-det-bar button, #ss-det .ss-det-bar label')].filter((x) => x.offsetParent).map((x) => x.textContent.trim() || x.getAttribute('aria-label')).join(' · ')));
    await p.keyboard.press('Escape'); is('Escape closes it', !(await vis('#ss-det')));
    await click(row(10) + ' .ss-path'); await p.mouse.click(4, h - 4); await wait(120); is('a click outside closes it', !(await vis('#ss-det')));
    await click(row(10) + ' .ss-path'); await click('#ss-det-next'); is('next request', await p.locator('#ss-det-pos').innerText().then((x) => x.replace(/ of .*/, ' of n'))); await click('#ss-det-x'); is('the close button closes it', !(await vis('#ss-det')));
    await p.focus('#ss-reqs'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Enter'); await wait(120); is('arrow + Enter opens the window', await vis('#ss-det')); await p.keyboard.press('Escape');
    const s0 = await code(); await click(row(10) + ' .ss-path'); await click('#ss-det-leave'); await idle(); is('Leave out in the window: the script changes', (await code()) !== s0); is('… and says', await p.locator('#ss-det-leave').innerText()); await click('#ss-det-leave'); await idle(); is('Put back: the script as before', (await code()) === s0); await p.keyboard.press('Escape');
  });
  await part('ticks', async () => {
    is('ticks at first', await ev(() => [...document.querySelectorAll('#ss-reqs .ss-rq input')].some((x) => x.checked))); const s0 = await code();
    await click(row(10) + ' input'); await idle(); is('a tick: the script changes', (await code()) !== s0); is('a tick: the bar', await vis('#ss-selbar') ? await p.locator('#ss-selbar').innerText() : 'none');
    await click(row(13) + ' input', { modifiers: ['Shift'] }); is('Shift-tick: how many', (await p.locator('#ss-sel-n').innerText().catch(() => 'none')).replace(/\d+/, (x) => (+x > 1 ? 'several' : x)));
    await click('#ss-sel-group'); is('New transaction window', await vis('#ss-txn-dlg')); await p.fill('#ss-txn-inp', 'T09_Mine'); await p.keyboard.press('Enter'); await idle(); is('transaction made', await ev(() => S.txns.map((x) => x.name).includes('T09_Mine')));
    await click('.ss-txn[data-key="T09_Mine"] [data-act=ungroup]'); await idle(); is('ungrouped', await ev(() => !S.txns.map((x) => x.name).includes('T09_Mine')));
    await click('#ss-new-txn'); is('New transaction without ticks: message', await ev(() => [...document.querySelectorAll('.toast-msg')].map((x) => x.textContent).join('|').includes('Tick the requests'))); await click(row(10) + ' .ss-path'); is('… a click on a row ticks it', await ev(() => document.querySelector('.ss-rq[data-id="10"] input').checked)); await click('#ss-sel-clear');
    await p.focus('#ss-reqs'); await p.keyboard.press('ArrowDown'); await p.keyboard.press('Space'); await wait(120); is('Space ticks', await vis('#ss-selbar')); await p.keyboard.press('Escape');
  });
  await part('list', async () => {
    const n = () => ev(() => [...document.querySelectorAll('#ss-reqs .ss-rq')].length);
    await p.fill('#ss-q', 'session'); await wait(150); is('address filter: rows', await n()); await p.fill('#ss-q', ''); await wait(100);
    const a = await n(); await click('#ss-showout'); is('Show left-out shows more', (await n()) > a); await click('#ss-showout');
    await click('#ss-fold-all'); is('Collapse all: rows', await n()); await click('#ss-fold-all');
    await click('#ss-find'); is('Find a value: a window', await vis('#ss-fq')); await p.keyboard.press('Escape'); is('… closes', !(await vis('#ss-fq')));
    await click('.ss-outrow, .ss-txn [data-act=out]'); is('"n left out" opens', await n() > a);
  });
  await part('filters', async () => {
    for (const s of ['#ss-types [data-type]', '#ss-types-default', '[data-leave=ads]', '[data-leave=options]', '#ss-bg-btn', '#ss-res-help']) is('filters: ' + s, await reach(s));
    is('types', await ev(() => [...document.querySelectorAll('#ss-types [data-type]')].map((x) => x.textContent.trim() + (x.getAttribute('aria-pressed') === 'true' ? '+' : '-')).join(' ')));
    const s0 = await code(); await click('#ss-types [aria-pressed=false]'); await idle(); is('a type: the script changes', (await code()) !== s0); await click('#ss-types-default'); await idle(); is('Default: the script as before', (await code()) === s0);
    await click('#ss-bg-btn'); is('Background opens its window', await vis('#ss-bg-dlg')); await p.keyboard.press('Escape'); await idle();
  });
  await part('domains', async () => {
    is('domains', await ev(() => [...document.querySelectorAll('.ss-dom .ss-host')].map((x) => x.textContent).join(' '))); is('groups', await ev(() => [...document.querySelectorAll('.ss-dgrp')].map((x) => x.firstElementChild.nextSibling.textContent.trim()).join(' · ')));
    await click('.ss-dom [data-rename]'); const win = await vis('#host-modal-overlay .adv-modal'); is('rename a server parameter: a window', win); if (win) await p.fill('#host-modal-inp', 'My_Server'); else await p.fill('.ss-ren input', 'My_Server'); await p.keyboard.press('Enter'); await idle(); is('renamed in the script', (await code()).includes('My_Server')); await click('.ss-dom [data-rename]'); if (await vis('#host-modal-default')) await click('#host-modal-default'); else await click('.ss-ren [data-ren=default]'); await idle();
    const s0 = await code(); for (const h of ['api.example-outdoor.com', 'www.example-outdoor.com']) { await click('.ss-dom[data-host="' + h + '"] input'); await wait(250); const asks = await vis('#ss-ask'); is('leaving out ' + h + ' asks', asks); if (asks) { await click('#ss-ask-no'); await idle(); is(h + ', no: nothing changed', (await code()) === s0); } else { await idle(); is(h + ': the script changes', (await code()) !== s0); if (!(await vis('.ss-dom[data-host="' + h + '"]'))) await click('[data-grp=domRest]'); await click('.ss-dom[data-host="' + h + '"] input'); await idle(); is(h + ' back: as before', (await code()) === s0); } }
    await click('#ss-dom-off'); is('All off asks', await vis('#ss-ask')); await click('#ss-ask-no'); await p.fill('#ss-dq', 'www'); await wait(100); is('domain search', await p.locator('.ss-dom').count()); await p.fill('#ss-dq', '');
  });
  await part('panels', async () => { for (const k of ['dom', 'req', 'right']) { await click('[data-hide=' + k + ']'); is('hide ' + k, await ev((x) => document.getElementById('ss-cols').classList.contains('no-' + x), k)); await click('[data-show=' + k + ']'); is('show ' + k, await ev((x) => !document.getElementById('ss-cols').classList.contains('no-' + x), k)); } is('resize bars', await p.locator('#ss-cols .ss-rs:visible').count()); });
  await part('script', async () => {
    is('script files', await ev(() => [...document.querySelectorAll('#code-tabs .code-tab')].map((x) => x.textContent.trim()).join(' '))); is('Copy', await vis('#btn-copy'));
    await click('#ss-fmt [data-fmt=webhttp]'); await idle(); is('the other format', await ev(() => [...document.querySelectorAll('#code-tabs .code-tab')].map((x) => x.textContent.trim()).join(' '))); await click('#ss-fmt [data-fmt=devweb]'); await idle();
    const s0 = await code(); await click('#ss-think [data-think=none]'); await idle(); is('think time None: the script changes', (await code()) !== s0); await click('#ss-think [data-think=fixed]'); await idle(); is('Fixed: as before', (await code()) === s0);
    await ev(() => SS.popClose()); await wait(100);   // as a click outside would (the settings pop-up is in the title row since round 3)
    is('script name box', await reach('#ss-sc-name')); await p.fill('#ss-sc-name', 'My_run'); await p.keyboard.press('Enter'); await wait(200); is('the name', await ev(() => SS.scriptName()));
    const [d] = await Promise.all([p.waitForEvent('download'), click('#ss-dl')]); is('the ZIP', d.suggestedFilename());
    await click('#ss-dl-more'); is('Ready to download?', await ev(() => [...document.querySelectorAll('#ss-ready [data-go]')].map((x) => x.getAttribute('data-go')).join(' '))); await p.keyboard.press('Escape');
  });
  await part('steps', async () => {
    is('steps', await ev(() => [...document.querySelectorAll('#ss-steps [data-step] b')].map((x) => x.textContent).join(' · ')));
    for (let i = 1; i <= 3; i++) { is('Next on step ' + i, await vis('#ss-step-next') ? await p.locator('#ss-step-next').innerText() : 'none'); await click('#ss-step-next'); await wait(250); if (await vis('#ss-ask')) { is('leaving step ' + i + ' asks', await p.locator('#ss-ask-h').innerText()); await click('#ss-ask-no'); await wait(250); } is('… goes to step', await ev(() => SS.curStep())); is('Back on step ' + (i + 1), await vis('#ss-step-back')); }
    is('Next on step 4', await vis('#ss-step-next')); is('step 4: files', await ev(() => [...document.querySelectorAll('#ss-done-ftabs button')].map((x) => x.textContent).join(' '))); await click('#ss-step-back'); await wait(200); is('Back goes to step', await ev(() => SS.curStep()));
  });
  await part('correlate', async () => {
    await click('#ss-steps [data-step="2"]'); await wait(400);
    for (const s of ['#ss-cr-q', '#ss-cr-type', '#ss-cr-conf', '#ss-cr-show', '#ss-cr-high', '#ss-cr-clear', '#ss-cr-names', '#ss-cr-manual', '#ss-cr-cant', '#ss-cr-view', '#ss-cr-more', '#ss-cr-test', '#ss-cr-apply']) is('correlate: ' + s, await vis(s));
    is('columns', await ev(() => [...document.querySelectorAll('#ss-cr-table th')].map((x) => x.textContent).join(' · '))); is('rows', await ev(() => [...document.querySelectorAll('#ss-cr-body tr')].map((x) => x.querySelector('.ss-cr-name').value + (x.querySelector('[data-tick]').checked ? '+' : '-') + [...x.querySelectorAll('.ss-cr-act button')].map((y) => y.textContent.trim()).join('/')).join(' · ')));
    await click('#ss-corr .adv-req-link'); is('a request in the table: a window', await vis('#ss-det') && await vis('#ss-det-scrim')); await p.keyboard.press('Escape'); await wait(100); if (await vis('#ss-det')) await click('#ss-det-x');
    await click('#ss-cr-body [data-edit]'); is('Review: the editor', await ev(() => SSE.isOpen())); await ev(() => SSE.close());
    await click('#ss-cr-cant'); is('Can\'t find a value?', await ev(() => [...document.querySelectorAll('#ss-cr-cant-m [data-cant]')].length)); await p.keyboard.press('Escape');
    // Cards view retired (owner, 2026-11-27): the old page offers it, the new one does not — a listed difference
    if (await vis('#ss-cr-view')) { await click('#ss-cr-view [data-view=cards]'); is('Cards', await vis('#adv-panel')); await click('#ss-cr-view [data-view=table]'); } else is('Cards', 'retired');
    await click('#ss-cr-apply'); await idle(); is('Add to the script', await ev(() => S.correlations.map((c) => c.name).join(' ')));
  });
  // the parts below the table: the correlations in the script, the second recording (a section each, opened by its bar)
  const sec = async (name, old) => { if (await p.locator('[data-sec-b=' + name + ']').count()) { if (!(await ev((n) => document.querySelector('[data-sec=' + n + ']').classList.contains('is-open'), name))) await p.click('[data-sec-b=' + name + ']'); } else if (old && await p.locator(old).count() && await ev((s) => document.querySelector(s).parentNode.classList.contains('folded'), old)) await p.click(old); await wait(150); };
  await part('in the script', async () => {
    await click('#ss-steps [data-step="2"]'); await wait(300);
    const gone = await ev(() => { const s = document.getElementById('corr-panel'); return !!s && s.classList.contains('ss-sec-gone'); });
    is('the values in the script: a section of their own', !gone);   // a listed difference (round 3: the table's filter)
    const open = async () => { if (gone) { await ev(() => SSC.section('script')); await wait(200); } else await sec('script'); };
    const names = () => ev(() => PerfxStudio.state().correlations.map((c) => c.name).sort().join(' '));
    await open(); is('in the script: the values', await names());
    if (gone) await p.locator('#ss-cr-body [data-edit]').first().click(); else await p.locator('#corr-list [data-ci-edit]').first().click();
    await wait(200); is('its Edit / Open opens the editor', await ev(() => SSE.isOpen())); await ev(() => SSE.close()); await wait(150);
    await open(); const s0 = await code(), n0 = await names();
    if (gone) await p.locator('#ss-cr-body [data-out]').first().click(); else await p.locator('#corr-list [data-ci-out]').first().click();
    await idle(); is('Take out / Remove: one value fewer', (await names()).split(' ').length === n0.split(' ').length - 1); is('Take out / Remove: the script changes', (await code()) !== s0);
    await click('#ss-undo'); await idle(); is('Undo: the script as before', (await code()) === s0); is('Undo: the values', await names());
  });
  await part('cards', async () => {
    await sec('values'); if (!(await vis('#ss-cr-view'))) { is('cards view', 'retired'); return; }
    await click('#ss-cr-view [data-view=cards]'); is('cards: how many', await ev(() => [...document.querySelectorAll('#adv-cards .adv-card')].filter((x) => x.offsetParent).length)); is('cards: buttons', await ev(() => [...document.querySelectorAll('#adv-panel .adv-panel-hdr-right button')].filter((x) => x.offsetParent).map((x) => x.textContent.trim()).join(' · ')));
    for (const [n, s] of [['Paste & Detect', '.adv-btn-paste'], ['Add Manual', '.adv-panel-hdr-right .adv-btn-add:last-of-type']]) { await p.locator(s).first().click(); await wait(250); is('cards: ' + n + ' opens', await ev(() => [...document.querySelectorAll('.adv-modal-overlay')].some((x) => x.getClientRects().length) || SSE.isOpen())); await p.keyboard.press('Escape'); await wait(100); await ev(() => { document.querySelectorAll('.adv-modal-overlay').forEach((x) => { x.style.display = 'none'; }); SSE.close(); }); await wait(100); }
    await sec('values'); await click('#ss-cr-view [data-view=table]');
  });
  await part('second recording', async () => {
    await click('#ss-steps [data-step="2"]'); await wait(250); await sec('values'); await click('#ss-cr-cant'); await p.click('[data-cant=second]'); await wait(600); is('Use a second recording: its box', await vis('#dz2')); is('its mode', await p.locator('#mode-badge').innerText());
    is('Record it now', await ev(() => [...document.querySelectorAll('#ss-diff button')].some((x) => x.offsetParent && /Record it now/.test(x.textContent))));
    await p.setInputFiles('#dz2 input', FX + 'rich-shop.r2.har'); await idle(); if (await vis('#ss-bg-dlg')) { await p.keyboard.press('Escape'); await idle(); }
    is('two recordings: mode', await p.locator('#mode-badge').innerText()); is('two recordings: correlations', await ev(() => S.correlations.map((c) => c.name).join(' '))); is('two recordings: values', await ev(() => S.advisorCandidates.map((c) => c.varName).join(' ')));
    await click('#ss-steps [data-step="2"]'); await wait(250); await sec('second', '#ss-diff [data-fold]'); await p.click('#dz2-clear'); await idle(); if (await vis('#ss-bg-dlg')) { await p.keyboard.press('Escape'); await idle(); }
    is('removed: mode', await p.locator('#mode-badge').innerText()); is('removed: correlations', await ev(() => S.correlations.map((c) => c.name).join(' ')));
  });
  await part('names', async () => {
    await p.reload(); await ev(() => { document.documentElement.classList.add('embedded'); }); await wait(400); await p.setInputFiles('#dz1 input', FX + 'rich-shop.har'); await p.waitForFunction(() => document.body.classList.contains('ss-view-ws'), null, { timeout: 60000 }); await idle(); await p.keyboard.press('Escape'); await idle();
    is('the script name', await p.locator('#ss-name-now').innerText()); const [d] = await Promise.all([p.waitForEvent('download'), click('#ss-dl')]); is('the ZIP', d.suggestedFilename());
    await click('#ss-fmt [data-fmt=webhttp]'); await idle(); is('the script name, other format', await p.locator('#ss-name-now').innerText()); await click('#ss-fmt [data-fmt=devweb]'); await idle();
  });
  await part('the script panel', async () => {
    await click('#ss-steps [data-step="1"]'); await wait(250); if (await vis('#ss-ask')) await click('#ss-ask-no'); is('Script: its title', await p.locator('#ss-tab-script').innerText()); await click('#ss-p-right [data-hide=right]'); is('its hide button', !(await vis('#code-body'))); await p.locator('#ss-p-right .ss-rail').click(); await wait(150); is('… and back', await vis('#code-body'));
  });
  await part('test data', async () => { await click('#ss-steps [data-step="3"]'); await wait(250); if (await vis('#ss-ask')) await click('#ss-ask-no'); for (const s of ['#ss-td-add', '#ss-td-xl-down', '#ss-td-xl-up', '#ss-td-table']) is('test data: ' + s, await vis(s)); is('parameters', await ev(() => [...document.querySelectorAll('.ss-td-name')].map((x) => x.value).join(' '))); });
  await part('another', async () => { await click('#ss-open-another'); is('Open another: the start page', await vis('#dz1')); is('the open one is named', await vis('#ss-resume')); await click('#ss-resume-go'); is('back to it', await vis('#ss-cols')); });
  is('page errors', errs.join(' | '));
  await p.close();
  return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'msedge' }); let bad = 0, n = 0;
  for (const [w, h] of [[1118, 708], [1845, 800]]) {
    const a = await walk(b, OLD, w, h), c = await walk(b, NEW, w, h);
    // a part that stopped compared nothing: it is a fault of this check (or of the page), never "no difference"
    for (const [o, v] of [['before', a], ['now', c]]) Object.keys(v).filter((k) => / stopped$/.test(k)).forEach((k) => { bad++; console.log(`${w}x${h}  ${o}: ${k} — ${v[k]}`); });
    for (const k of ['rows', 'in the script: the values', 'two recordings: correlations', 'parameters']) if (!c[k]) { bad++; console.log(`${w}x${h}  empty, so nothing was compared: ${k}`); }
    for (const k of new Set([...Object.keys(a), ...Object.keys(c)])) { n++; if (JSON.stringify(a[k]) !== JSON.stringify(c[k])) { bad++; console.log(`${w}x${h}  ${k}\n    before: ${JSON.stringify(a[k])}\n    now:    ${JSON.stringify(c[k])}`); } }
  }
  console.log(`${n} behaviours compared, ${bad} differ`);
  await b.close(); process.exit(bad ? 1 : 0);
})();
