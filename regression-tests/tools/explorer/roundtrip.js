#!/usr/bin/env node
// Script Studio ↔ HAR Explorer, through the real portal, as a user: Open in HAR Explorer hands Studio's recording over;
// Continue in Script Studio adds the Explorer's values to the same work (no reload, no question), asks before replacing
// another recording (Cancel, Esc, a click outside = no), and opens a recording in an empty Studio as before (BUG-185).
//   node roundtrip.js [portal URL]   (default http://localhost:3999/converter/)
'use strict';
const path = require('path');
const R = path.resolve(__dirname, '../../..').split(path.sep).join('/') + '/';
const { chromium } = require(R + 'cdp-recorder/recorder/node_modules/playwright-core');
const SHOP = R + 'regression-tests/tools/studio/fixtures/rich-shop.har', WEB = R + 'collection-examples/WebTours.har';
const URL = process.argv[2] || 'http://localhost:3999/converter/';
let pass = 0, fail = 0; const ok = (n, c, i) => { if (c) pass++; else { fail++; console.log('FAIL ' + n + (i !== undefined ? '  ' + JSON.stringify(i).slice(0, 300) : '')); } };
(async () => {
  const b = await chromium.launch({ channel: 'msedge' }), p = await b.newPage({ viewport: { width: 1912, height: 980 } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  await p.goto(URL); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(600);
  const go = (g) => p.evaluate((x) => PerfxShell.go(x, { instant: true }), g);
  const fr = (id) => p.frames().find((x) => new RegExp(id).test(x.url()));
  // 1. Studio: a recording and some work (a script name of the user's own, a correlation applied)
  await go('studio'); await p.waitForTimeout(1500);
  let sf = fr('/studio'); sf.page().on('pageerror', (e) => errs.push('studio: ' + e.message));
  await sf.setInputFiles('#dz1 input[type=file]', SHOP);
  const idle = (f) => f.waitForFunction(() => document.body.classList.contains('ss-view-ws') && !document.body.classList.contains('ss-reading') && !(window.SS && SS.busy && SS.busy()), null, { timeout: 60000 });
  await idle(sf); await p.waitForTimeout(800);
  const bg = sf.locator('#ss-bg-dlg .bg-review-apply'); if (await bg.isVisible().catch(() => false)) { await bg.click(); await idle(sf); }
  ok('Studio: Open in HAR Explorer is offered in the portal with a recording open', await sf.isVisible('#ss-hx'));
  await sf.evaluate(() => { S.scriptName = 'MyWork'; });
  const before = await sf.evaluate(() => ({ id: SS.fileId, har: S.har1Name, corr: S.correlations.length, name: S.scriptName }));
  // 2. Open in HAR Explorer: the same recording there
  await sf.click('#ss-hx'); await p.waitForTimeout(2500);
  let hf = fr('har-explorer'); hf.page().on('pageerror', (e) => errs.push('explorer: ' + e.message));
  await hf.waitForFunction(() => window.HarExplorer && HarExplorer.state(), null, { timeout: 30000 });
  let hs = await hf.evaluate(() => HarExplorer.state());
  ok('the Explorer opened the same recording, knowing it came from this Studio', hs.file === before.har && hs.from && hs.from.studio === before.id, { hs, before });
  ok('… the portal shows the Explorer', await p.evaluate(() => document.documentElement.className.includes('page-explore') || !!document.querySelector('#iframe-explorer').offsetParent));
  // 3. a value added in the Explorer (Find a value → a suggestion → Add to Script Studio)
  await hf.click('#hx-findbtn'); await p.waitForTimeout(2500);
  const n = await hf.locator('[data-sugg]').count(); let added = 0;
  for (let i = 0; i < n && !added; i++) { await hf.locator('[data-sugg]').nth(i).click(); await p.waitForTimeout(900); const a = hf.locator('[data-add]'); if (await a.count()) { await a.first().click(); await p.waitForTimeout(300); added = (await hf.evaluate(() => HarExplorer.state().added)); } }
  ok('a value added in the Explorer', added === 1, { n, added });
  await p.keyboard.press('Escape'); await p.waitForTimeout(300);
  // 4. Continue in Script Studio: back to the same work, the value added to it — no question, no reload
  await hf.click('#hx-studio'); await p.waitForTimeout(400);
  ok('same recording: no question asked', !(await hf.evaluate(() => document.getElementById('hx-ask').open)));
  sf = fr('/studio'); await p.waitForTimeout(3000); await idle(sf);
  const after = await sf.evaluate(() => ({ id: SS.fileId, har: S.har1Name, corr: S.correlations.length, name: S.scriptName, fromHx: S.advisorCandidates.filter((c) => c._explorer).length }));
  ok('Studio kept its work (same opening, the user\'s script name)', after.id === before.id && after.name === 'MyWork', { before, after });
  ok('… and the Explorer\'s value is in it, applied', after.fromHx === 1 && after.corr >= before.corr + 1, { before, after });
  // 5. another recording in the Explorer: Continue asks before replacing Studio's work
  await go('explore'); await p.waitForTimeout(800); hf = fr('har-explorer');
  await hf.click('#hx-another'); await hf.setInputFiles('#hx-file', WEB); await hf.waitForSelector('#hx-ws:not([hidden])'); await p.waitForTimeout(600);
  hs = await hf.evaluate(() => HarExplorer.state());
  ok('a file chosen in the Explorer is not from Studio', hs.from === null, hs);
  await hf.click('#hx-studio'); await p.waitForTimeout(300);
  ok('another recording: the Explorer asks first', await hf.evaluate(() => document.getElementById('hx-ask').open && /rich-shop/.test(document.getElementById('hx-ask-t').textContent)));
  await hf.click('#hx-ask-no'); await p.waitForTimeout(400);
  ok('Cancel: the question closes, the Explorer stays', !(await hf.evaluate(() => document.getElementById('hx-ask').open)) && await p.evaluate(() => !!document.querySelector('#iframe-explorer').offsetParent));
  ok('… Studio untouched', (await fr('/studio').evaluate(() => ({ id: SS.fileId, name: S.scriptName }))).name === 'MyWork');
  await hf.click('#hx-studio'); await p.waitForTimeout(300);
  const box = await hf.evaluate(() => { const r = document.querySelector('#hx-ask').getBoundingClientRect(); return { x: r.left, y: r.top }; });
  await p.mouse.click(300, 900); await p.waitForTimeout(300);   // a click outside it, on the dimmed Explorer
  ok('a click outside the question closes it (no)', !(await hf.evaluate(() => document.getElementById('hx-ask').open)), box);
  await hf.click('#hx-studio'); await p.waitForTimeout(300); await hf.press('#hx-ask', 'Escape'); await p.waitForTimeout(300);
  ok('Esc closes it (no)', !(await hf.evaluate(() => document.getElementById('hx-ask').open)));
  await hf.click('#hx-studio'); await p.waitForTimeout(300); await hf.click('#hx-ask-yes'); await p.waitForTimeout(3000);
  sf = fr('/studio'); await idle(sf);
  const rep = await sf.evaluate(() => ({ har: S.har1Name, id: SS.fileId }));
  ok('Replace it: Studio opens the Explorer\'s recording', rep.har === 'WebTours.har' && rep.id !== before.id, rep);
  // 6. Studio with nothing open: Continue opens there without a question (as before)
  const q = await b.newPage({ viewport: { width: 1912, height: 980 } });
  await q.goto(URL); await q.evaluate(() => localStorage.clear()); await q.reload(); await q.waitForTimeout(600);
  await q.evaluate(() => PerfxShell.go('explore', { instant: true })); await q.waitForTimeout(1500);
  const qh = q.frames().find((x) => /har-explorer/.test(x.url()));
  await qh.setInputFiles('#hx-file', WEB); await qh.waitForSelector('#hx-ws:not([hidden])');
  await qh.click('#hx-studio'); await q.waitForTimeout(300);
  ok('Studio empty: no question', !(await qh.evaluate(() => document.getElementById('hx-ask').open)));
  await q.waitForTimeout(3500); const qs = q.frames().find((x) => /\/studio/.test(x.url()));
  ok('… the recording opens in Studio', await qs.evaluate(() => S.har1Name) === 'WebTours.har');
  ok('… and Open in HAR Explorer is offered there', await qs.isVisible('#ss-hx'));
  ok('no page errors', !errs.length, errs);
  console.log(pass + ' of ' + (pass + fail) + ' checks passed');
  await b.close(); process.exit(fail ? 1 : 0);
})();
