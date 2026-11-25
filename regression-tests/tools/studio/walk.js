#!/usr/bin/env node
// Script Studio clicked through as a user would, against the real server: the start page, the title and tool rows,
// requests and their code, the Request tab, Undo / Redo of every kind of change, Correlate, Test data, Download.
//   node walk.js [studioUrl=http://localhost:3999/converter/studio] [--show]
// Prints PASS / FAIL per check; exit code 1 when one fails. Needs the fixtures made by make-fixtures.js.
// After an Undo the script must be, character for character, the one before the change.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const JSZip = require(path.resolve(__dirname, '../../../node_modules/jszip'));
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:3999/converter/studio', FX = path.join(__dirname, 'fixtures') + path.sep;
let n = 0, fails = 0;
const ok = (name, c, more) => { n++; if (!c) fails++; if (!c || process.argv.includes('--show')) console.log((c ? 'PASS ' : 'FAIL ') + name + (c || more === undefined ? '' : '  — ' + JSON.stringify(more).slice(0, 400))); };

(async () => {
  const b = await chromium.launch({ channel: 'msedge' }), p = await b.newPage({ viewport: { width: 1288, height: 640 }, acceptDownloads: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  // the CDP Recorder of this computer is never asked
  await p.route('**://localhost:8787/**', (r) => r.abort());
  await p.route('**/analytics/track', (r) => r.fulfill({ status: 204 }));
  const vis = (s) => p.locator(s).first().isVisible(), txt = (s) => p.locator(s).first().innerText(), cnt = (s) => p.locator(s).count(), click = (s) => p.locator(s).first().click();
  const settle = async () => { await p.waitForTimeout(220); await p.waitForFunction(() => !SS.busy() && !SS.queuedRead() && !(window.SSH && SSH.busy()), null, { timeout: 30000 }); await p.waitForTimeout(220); };
  const script = () => p.evaluate(() => JSON.stringify(S.scripts)), code = () => p.evaluate(() => document.getElementById('code-body').textContent);
  const load = async (f) => {
    await p.goto(BASE); await p.evaluate(() => document.documentElement.classList.add('embedded')); await p.waitForTimeout(300);
    await p.setInputFiles('#dz1 input', FX + f); await p.waitForFunction(() => document.body.classList.contains('ss-view-ws'), null, { timeout: 30000 }); await settle();
    if (await vis('#ss-bg-dlg')) { await p.keyboard.press('Escape'); await settle(); }
  };
  const undo = async (what, before, more) => {
    const after = await script(); ok(what + ': the script changes', after !== before);
    ok(what + ': Undo is on', await p.locator('#ss-undo').isEnabled());
    await click('#ss-undo'); await settle(); const back = await script(); ok(what + ': Undo gives the script before, exactly', back === before, more);
    await click('#ss-redo'); await settle(); ok(what + ': Redo gives the changed script, exactly', (await script()) === after);
    await click('#ss-undo'); await settle(); ok(what + ': and Undo again', (await script()) === before);
  };
  try {
    // ── start ──
    await p.goto(BASE); await p.evaluate(() => document.documentElement.classList.add('embedded')); await p.waitForTimeout(500);
    ok('the band every tool has', /Script Studio/.test(await txt('#ss-band h1')) && (await cnt('#ss-band .ds-flow li')) === 3);
    ok('two ways to begin, nothing else', (await cnt('.ss-big')) === 2 && !(await vis('#fmt-dev')));
    // (the box's own click is counted and stopped: the browser's file window is not needed)
    await p.evaluate(() => { window.__n = 0; document.addEventListener('click', (e) => { if (e.target.type === 'file') { window.__n++; e.preventDefault(); } }, true); });
    const opens = async (act) => { await p.evaluate(() => { window.__n = 0; }); await act(); await p.waitForTimeout(120); return p.evaluate(() => window.__n); };
    const r = await p.locator('#dz1').boundingBox(), hits = [];
    for (const [x, y] of [[20, 20], [r.width - 20, r.height - 20], [r.width / 2, 30], [r.width / 2, r.height / 2], [r.width / 2, r.height - 30]]) hits.push(await opens(() => p.mouse.click(r.x + x, r.y + y)));
    ok('anywhere on the Open card opens the file window, once', hits.every((x) => x === 1), hits);
    for (const [btn, dlg] of [['#ss-how-btn', '#ss-how'], ['#ss-guide-btn', '#ss-guide']]) { await click(btn); ok(dlg + ' opens', await vis(dlg)); await p.mouse.click(4, 320); await p.waitForTimeout(150); ok(dlg + ' closes with a click outside', !(await vis(dlg))); }
    await click('#ss-guide-btn'); await click('#tab-classic'); ok('the guide has both ways', await vis('#how-classic') && !(await vis('#how-cdp'))); await click('#ss-guide [data-close]');
    ok('the start page does not scroll', await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));

    // ── the two rows ──
    await load('rich-shop.har');
    ok('two rows above the panels, and they fill the window', await p.evaluate(() => { const q = document.getElementById('ss-cols').getBoundingClientRect(); return q.top < 120 && Math.abs(q.bottom - innerHeight) < 4; }));
    ok('up to date, no Undo yet', /Up to date/.test(await txt('#ss-state')) && !(await p.locator('#ss-undo').isEnabled()) && !(await p.locator('#ss-redo').isEnabled()));
    ok('what it was made from', /from rich-shop\.har · 8 of 21 requests · 4 transactions · Bearer/.test(await txt('#ss-from')), await txt('#ss-from'));
    ok('each step has its count', (await p.locator('#ss-steps em:visible').allInnerTexts()).length === 4);

    // name
    await click('#ss-name-btn'); await p.keyboard.press('Escape'); ok('Escape leaves the name', await vis('#ss-name-btn') && (await txt('#ss-name-now')) === 'DevWebScript_Correlated');
    await click('#ss-name-btn'); await p.fill('#ss-sc-name', '1 bad'); await p.keyboard.press('Enter'); ok('a name that cannot be used is said', await vis('#ss-sc-err')); await p.fill('#ss-sc-name', 'My shop run'); await p.keyboard.press('Enter'); await settle();
    ok('the title is the new name', (await txt('#ss-name-now')) === 'My_shop_run');
    const [d] = await Promise.all([p.waitForEvent('download'), click('#ss-dl')]); const z = await JSZip.loadAsync(fs.readFileSync(await d.path()));
    ok('the ZIP and the .usr take it', d.suggestedFilename() === 'My_shop_run.zip' && Object.keys(z.files).some((f) => /My_shop_run\.usr$/.test(f)), [d.suggestedFilename(), Object.keys(z.files)]);
    await click('#ss-undo'); await settle(); ok('Undo: the name', (await txt('#ss-name-now')) === 'DevWebScript_Correlated'); await click('#ss-redo'); await settle(); ok('Redo: the name', (await txt('#ss-name-now')) === 'My_shop_run'); await click('#ss-undo'); await settle();

    // format
    let s0 = await script(); await click('#ss-fmt [data-fmt=webhttp]'); await settle(); ok('the other format at once', /web_url|web_custom_request/.test(await code())); await undo('format', s0);
    // think time
    await click('#ss-think-btn'); ok('think time opens', await vis('#ss-think-pop')); await click('#ss-think [data-think=none]'); await settle(); ok('… and stays open', await vis('#ss-think-pop')); ok('… said on its button', /No think time/.test(await txt('#ss-think-btn'))); await p.keyboard.press('Escape'); ok('Escape closes it', !(await vis('#ss-think-pop'))); await undo('think time', s0);
    await click('#ss-think-btn'); await p.fill('#ss-think-sec', '7'); await p.keyboard.press('Tab'); await settle(); ok('seconds', /think_time = 7/.test(await code())); await p.mouse.click(900, 26); ok("a click outside closes it", !(await vis('#ss-think-pop'))); await undo('seconds', s0);
    // filters
    await click('#ss-filters-btn'); await click('#ss-types [data-type=img], #ss-types [data-type=image]').catch(() => click('#ss-types [aria-pressed=false]')); await settle(); ok('Filters stays open while choosing', await vis('#ss-fbar')); await click('#ss-res-help'); ok('its help opens inside', await vis('#ss-res-pop')); await p.keyboard.press('Escape'); await p.keyboard.press('Escape'); ok('Escape closes it', !(await vis('#ss-fbar'))); await undo('a type', s0);
    await click('#ss-filters-btn'); await click('[data-leave=ads]'); await settle(); ok('analytics put in', await p.evaluate(() => S.leaveOut.ads === false)); await p.keyboard.press('Escape'); await click('#ss-undo'); await settle(); ok('… Undo', await p.evaluate(() => S.leaveOut.ads !== false) && (await script()) === s0);

    // domains
    const dom = '.ss-dom[data-host="api.example-outdoor.com"]';
    await click(dom + ' input'); await p.waitForTimeout(250); if (await vis('#ss-ask')) await click('#ss-ask-yes'); await settle(); await undo('a domain left out', s0);
    await click(dom + ' .ss-par'); await p.waitForTimeout(150); await p.fill('#host-modal-inp', 'Shop_Api'); await p.keyboard.press('Enter'); await settle(); ok('a domain parameter renamed everywhere', /Shop_Api/.test(await code()) && !/\bApi_Server\b/.test(await code())); await undo('a domain parameter', s0);

    // ── requests ──
    const row = (id) => `.ss-rq[data-id="${id}"]`;
    ok('the ticks are for a new transaction: none at first', !(await p.locator(row(10) + ' input').isChecked()));
    const leave = async (id) => { await click(row(id) + ' .ss-path'); await click('#ss-det-leave'); await settle(); await p.keyboard.press('Escape'); await p.waitForTimeout(80); };
    await leave(10); ok('left out in its window: its count', /7 of 21/.test(await txt('#ss-from'))); await undo('a request left out', s0);
    await leave(10); await click('#ss-showout'); await leave(10); await click('#ss-showout'); ok('put back: the same script', (await script()) === s0);
    await leave(12); await leave(13); await click('#ss-undo'); await settle(); await click('#ss-undo'); await settle(); ok('two changes taken back', (await script()) === s0);
    await leave(10); await p.focus('#ss-reqs'); await p.keyboard.press('Control+z'); await settle(); ok('Ctrl+Z', (await script()) === s0); await p.keyboard.press('Control+y'); await settle(); ok('Ctrl+Y', (await p.evaluate(() => S.leaveOutIds.has(10)))); await p.keyboard.press('Control+z'); await settle();
    await click('.ss-outrow').catch(() => {}); await p.evaluate(() => { SSW.state.openOut = {}; SSW.render(); });

    // each request's code is marked, in both formats
    for (const fmt of ['devweb', 'webhttp']) {
      if (fmt === 'webhttp') { await p.evaluate(() => SSW.closeDetails()); await click('#ss-fmt [data-fmt=webhttp]'); await settle(); }
      const bad = [];
      for (const id of await p.evaluate(() => S.entries1.filter((e) => !e.isMarker && SS.inScript(e) && (S.format === "devweb" || !SS.setup(e))).map((e) => e.id))) {
        await p.evaluate((i) => { SSW.openDetails(i); }, id); await p.waitForTimeout(40);
        const m = await p.evaluate((i) => { const pre = document.getElementById('code-body'); if (!pre.classList.contains('ss-hl')) return null; const cs = getComputedStyle(pre), lh = parseFloat(cs.lineHeight), y = parseFloat(pre.style.getPropertyValue('--hl-y')) - parseFloat(cs.paddingTop), h = parseFloat(pre.style.getPropertyValue('--hl-h')); const e = S.entries1.find((x) => x.id === i); return { text: pre.textContent.split('\n').slice(Math.round(y / lh), Math.round((y + h) / lh)).join('\n'), last: e.url.replace(/^https?:\/\/[^/]+/, '').split('?')[0].split('/').pop(), method: e.method }; }, id);
        if (!m) bad.push([id, 'not marked']);
        else if (m.last && m.text.indexOf(m.last) < 0 && !/\{/.test(m.text)) bad.push([id, m.last, m.text.slice(0, 120)]);
        else if ((m.text.match(/new load\.WebRequest|^\s*web_(url|custom_request|submit_data)\(/gm) || []).length !== 1) bad.push([id, 'not one request', m.text.slice(0, 160)]);
      }
      ok(fmt + ': every request in the script has its code marked', !bad.length, bad);
    }
    await p.evaluate(() => SSW.closeDetails()); await click('#ss-undo'); await settle();
    await click(row(10) + ' .ss-path'); await p.waitForTimeout(150); ok('a click opens the window over the page', await vis('#ss-det') && await vis('#ss-det-scrim')); await p.keyboard.press('Escape'); await p.waitForTimeout(100); ok('closed: its code is marked in the script', !(await vis('#ss-det')) && await vis('#code-body.ss-hl'));

    // find in this file
    await p.fill('#ss-code-q', 'webrequest'); await p.waitForTimeout(100); ok('find in this file', /^1 of \d+$/.test(await txt('#ss-code-n'))); await p.focus('#ss-code-q'); await p.keyboard.press('Enter'); ok('Enter: the next one', /^2 of/.test(await txt('#ss-code-n'))); ok('the code itself is not touched', (await code()) === (await p.evaluate(() => S.scripts.mj))); await p.fill('#ss-code-q', 'zzzz'); ok('none', (await txt('#ss-code-n')) === 'None'); await p.fill('#ss-code-q', '');

    // the window of a request
    await click(row(12) + ' .ss-path'); await click('#ss-det [data-tab=timing]'); await click('#ss-det-next'); ok('next request, same tab', /Waiting|Timing|ms/.test(await txt('#ss-det-b')));
    await p.mouse.click(5, 320); await p.waitForTimeout(200); ok('a click outside closes the window', !(await vis('#ss-det')) && !(await vis('#ss-det-scrim')));
    await click('#ss-find'); await p.waitForTimeout(250); ok('Find a value: a window', await vis('#ss-fq') && await vis('#ss-det-scrim')); await p.keyboard.press('Escape'); await p.waitForTimeout(200); ok('… closed', !(await vis('#ss-fq')));
    await p.evaluate(() => { document.getElementById('ss-reqs').scrollTop = 0; }); await p.waitForTimeout(100);

    // ── transactions ──
    await click(row(10) + ' input'); ok('a tick: the bar, the script as it was', await vis('#ss-selbar') && (await script()) === s0); await p.locator(row(13) + ' input').click({ modifiers: ['Shift'] }); ok('Shift: a range', (await p.evaluate(() => SSW.state.sel.size)) === 4); await click('#ss-sel-clear'); ok('Cancel', !(await vis('#ss-selbar')));
    ok('Next: Correlate', /Next: Correlate/.test(await txt('#ss-step-next'))); await click('#ss-step-next'); await p.waitForTimeout(250); ok('… goes there', (await p.evaluate(() => SS.curStep())) === 2); await click('#ss-step-back'); await p.waitForTimeout(250); if (await vis('#ss-ask')) { await click('#ss-ask-no'); await p.waitForTimeout(200); } ok('Back', (await p.evaluate(() => SS.curStep())) === 1);
    await click('#ss-new-txn'); await click(row(18) + ' input'); await click('#ss-sel-group'); await p.fill('#ss-txn-inp', 'T09_Mine'); await p.keyboard.press('Enter'); await settle(); ok("a new transaction", /_MINE"/i.test(await code())); await undo('a new transaction', s0);
    await click('.ss-txn [data-act=rename]'); await p.fill('#ss-txn-inp', 'T01_Landing'); await p.keyboard.press('Enter'); await settle(); await undo('a transaction renamed', s0);
    await click('.ss-txn [data-act=ungroup]'); await settle(); await undo('a transaction ungrouped', s0);

    // ── correlate ──
    await click('#ss-steps [data-step="2"]'); await p.waitForTimeout(400); ok('Correlate: one line, the text behind the question mark', !(await vis('#ss-corr-about'))); await click('[data-about=ss-corr-about]'); ok('… shown', await vis('#ss-corr-about')); await click('[data-about=ss-corr-about]');
    ok('the whole table row is in sight', await p.evaluate(() => [...document.querySelectorAll('#ss-cr-body tr')].every((x) => x.scrollWidth <= x.clientWidth + 1) && document.getElementById('ss-cr-wrap').scrollWidth <= document.getElementById('ss-cr-wrap').clientWidth + 1));
    s0 = await script(); const c0 = await p.evaluate(() => S.correlations.length); await click('#ss-cr-apply'); await settle(); ok('values added', (await p.evaluate(() => S.correlations.length)) > c0); await undo('correlations added', s0); ok('… and they are to review again', (await p.evaluate(() => S.advisorCandidates.filter((c) => !c._applied).length)) >= 3);
    await click('#ss-redo'); await settle(); await click('#ss-steps [data-step="1"]'); await settle(); if (await vis('#ss-ask')) { await click('#ss-ask-no'); await settle(); }
    const s1 = await script(); await click(row(12) + ' .ss-path'); await click('#ss-det-leave'); await p.waitForTimeout(300); ok('a change that takes correlations off asks first', await vis('#ss-ask')); await click('#ss-ask-no'); await p.waitForTimeout(200); ok('no: nothing changed', (await script()) === s1);
    await click('#ss-det-leave'); await p.waitForTimeout(300); await click('#ss-ask-yes'); await settle(); await p.keyboard.press('Escape'); await p.waitForTimeout(100); await undo('a request left out, with correlations', s1);
    await click('#ss-steps [data-step="2"]'); await p.waitForTimeout(300); const tk = '#ss-cr-body tr';
    await click('#ss-cr-show [data-show=review]'); if (await cnt(tk + ' [data-skip]')) { await click(tk + ' [data-skip]'); await settle(); ok('Skip can be undone', await p.locator('#ss-undo').isEnabled()); await click('#ss-undo'); await settle(); ok('… the script is as before', (await script()) === s1); }
    await click('#ss-cr-show [data-show=review]'); if (await cnt(tk + ' [data-edit]')) { await click(tk + ' [data-edit]'); await p.waitForTimeout(300); ok('the editor opens; Undo waits while it is open', await p.evaluate(() => SSE.isOpen())); await p.evaluate(() => SSE.close()); }
    if (await cnt('#ss-corr .adv-req-link')) { await click('#ss-cr-show [data-show=all]'); await click('#ss-corr .adv-req-link'); await p.waitForTimeout(250); ok('a request of the table opens as a window', await vis('#ss-det')); await p.keyboard.press('Escape'); }

    // ── test data ──
    await click('#ss-steps [data-step="3"]'); await settle(); if (await vis('#ss-ask')) { await click('#ss-ask-no'); await settle(); }
    const s2 = await script(); await p.locator('.ss-td-name').first().fill('LoginName'); await p.keyboard.press('Enter'); await settle(); ok('a parameter renamed', /LoginName/.test(await script())); await undo('a parameter renamed', s2); ok('… the table too', (await p.locator('.ss-td-name').first().inputValue()) === 'Username');
    await p.locator('#ss-td-body [data-set=take]').first().selectOption('random'); await settle(); await undo('how a value is taken', s2);
    // ── download ──
    await click('#ss-steps [data-step="4"]'); await p.waitForTimeout(200); ok('Download fits the window', await p.evaluate(() => { const q = document.querySelector('.ss-done-card').getBoundingClientRect(); return q.bottom <= innerHeight + 1 || document.getElementById('ss-done').scrollHeight > document.getElementById('ss-done').clientHeight; })); ok('no Filters on the other steps', !(await vis('#ss-filters-btn')));
    await click('#ss-dl-more'); ok('Ready to download?', await vis('#ss-ready')); await p.keyboard.press('Escape');
    await click('#ss-steps [data-step="1"]'); await settle();

    // ── another recording, notes ──
    await click('#ss-open-another'); ok('the open one is named', await vis('#ss-resume') && /rich-shop/.test(await txt('#ss-resume-name'))); await click('#ss-resume-go'); ok('back to it', await vis('#ss-cols'));
    await load('oauth-pkce-sso.har'); ok('a new recording starts without Undo', !(await p.locator('#ss-undo').isEnabled()));
    ok('its note: a button', await vis('.ss-note-b')); await click('.ss-note-b'); ok('… the whole text', /SSO/.test(await txt('#ss-notices'))); await click('#ss-notices [data-x]'); ok('… hidden when read', !(await vis('.ss-note-b')));
    await click('#ss-dl-more'); if (await cnt('#ss-ready [data-go=notice]')) { await click('#ss-ready [data-go=notice]'); ok('… Ready to download? brings it back', await vis('#ss-note-pop')); }
    await p.evaluate(() => clearAll()); await settle(); ok('Clear: the start page, nothing left', await vis('#dz1') && (await p.evaluate(() => !S.har1 && !S.entries1.length)) && !(await vis('#ss-resume')) && !(await p.locator('#ss-undo').isEnabled()));
    ok('no page errors', !errs.length, errs);
  } catch (e) { console.log('STOPPED: ' + e.message.split('\n').slice(0, 3).join(' ')); fails++; await p.screenshot({ path: path.join(require('os').tmpdir(), 'studio-walk.png') }).catch(() => {}); if (errs.length) console.log(errs); }
  console.log(`${n - fails} of ${n} checks passed` + (fails && n - fails > n ? '' : ''));
  await b.close(); process.exit(fails ? 1 : 0);
})();
