#!/usr/bin/env node
// Script Studio as a user, on a recording with many dynamic values (fixtures/travel-booking.har: 7 transactions, 28 values
// found, 18 High): open it, Requests (Filters, a transaction's "n left out" by mouse and keyboard, Rename / Ungroup on
// hover), Correlate (the High values ticked, Add to the script, the editor and its Test), Add manual correlation (before
// and after a request is chosen), Test data, Download — the ZIP read back and its value reads counted. Every screen goes
// through the design checks of audit/review.js. Both formats.
//   node journey.js [studioUrl=http://localhost:3999/converter/studio] [--old=<studioUrl of the old version>] [--har=<file>] [--out=<dir>] [--shots]
// With --old the same clicks run on the old page (its checks that need the new page are skipped) and every script file
// and every ZIP file must be the same. Needs the fixtures made by make-fixtures.js. Exit code 1 when a check fails.
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium, inspect } = require(path.resolve(__dirname, '../audit/review.js'));
const JSZip = require(path.resolve(__dirname, '../../../node_modules/jszip'));
const args = process.argv.slice(2), opt = (k, d) => ((args.find((a) => a.startsWith('--' + k + '=')) || '').slice(k.length + 3) || d);
const NEWURL = args.find((a) => !a.startsWith('--')) || 'http://localhost:3999/converter/studio', OLDURL = opt('old', '');
const HAR = opt('har', path.join(__dirname, 'fixtures', 'travel-booking.har')), OUTROOT = opt('out', path.join(os.tmpdir(), 'studio-journey'));
const SHOTS = args.includes('--shots');
let failed = 0;

async function run(URL, OUT, FMT) {
  const dir = path.join(OUT, FMT); fs.mkdirSync(dir, { recursive: true });
  const checks = []; const ok = (name, pass, info) => { checks.push({ name, pass: !!pass, info }); if (!pass) failed++; console.log((pass ? 'PASS ' : 'FAIL ') + name + (pass || info === undefined ? '' : ' — ' + JSON.stringify(info).slice(0, 300))); };

  const b = await chromium.launch({ channel: 'msedge' });
  const p = await b.newPage({ viewport: { width: 1920, height: 1000 }, acceptDownloads: true });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  const idle = () => p.waitForFunction(() => window.SS && !SS.busy() && !document.body.classList.contains('ss-reading'), null, { timeout: 120000 }).then(() => p.waitForTimeout(400));
  const isNew = async () => !!(await p.$('.ss-req-act #ss-filters'));
  const look = async (name) => {
    const r = await p.evaluate(inspect);
    const bad = ['overlap', 'clipped', 'unnamed', 'sideways', 'plain', 'table', 'primary', 'codefont', 'idle', 'cutoff'].flatMap((k) => r[k].map((x) => k + ': ' + x));
    ok(name + ': the design checks find nothing', !bad.length, bad);
    if (SHOTS) await p.screenshot({ path: path.join(dir, name.replace(/\W+/g, '-') + '.jpg'), type: 'jpeg', quality: 70 });
  };
  await p.goto(URL);
  await p.setInputFiles('#dz1 input[type=file]', HAR);
  await p.waitForFunction(() => document.body.classList.contains('ss-view-ws') && !document.body.classList.contains('ss-reading'), null, { timeout: 120000 });
  if (await p.isVisible('.bg-review-apply')) { await p.click('.bg-review-apply'); }
  await idle();
  if (!(await p.isVisible('#ss-fmt'))) await p.click('#ss-think-btn'); await p.click('#ss-fmt [data-fmt=' + FMT + ']'); await p.keyboard.press('Escape'); await idle();
  const NEW = await isNew();
  const st = () => p.evaluate(() => { const S = PerfxStudio.state(); return { cands: (S.advisorCandidates || []).length, high: (S.advisorCandidates || []).filter((c) => c.confidence === 'high').length, corr: (S.correlations || []).length, params: (S.params || []).length, reqs: (S.entries1 || []).filter((e) => !e.isMarker && !e.filtered).length }; });
  const s1 = await st(); ok('the recording is read: ' + JSON.stringify(s1), s1.reqs > 0);

  // ── step 1: Requests ──
  if (NEW) {
    await look('Requests');
    await p.click('#ss-filters-btn');
    const pop = await p.evaluate(() => { const f = document.getElementById('ss-fbar'), b = document.getElementById('ss-filters-btn').getBoundingClientRect(); const r = f.getBoundingClientRect(); return { shown: !f.hidden, below: r.top >= b.bottom - 1, inWindow: r.left >= 0 && r.right <= innerWidth && r.top >= 0, chips: f.querySelectorAll('#ss-types [data-type], #ss-types button').length }; });
    ok('Filters: the pop-up opens under its button, inside the window, with its type chips', pop.shown && pop.below && pop.inWindow && pop.chips > 0, pop);
    await p.keyboard.press('Escape'); ok('Filters: Escape closes it', await p.evaluate(() => document.getElementById('ss-fbar').hidden));
    const link = await p.$('.ss-txn [data-act=out]');
    if (link) {
      const n0 = await p.evaluate(() => document.querySelectorAll('#ss-reqs .ss-rq.out').length);
      await link.click(); await p.waitForTimeout(250);
      const n1 = await p.evaluate(() => document.querySelectorAll('#ss-reqs .ss-rq.out').length);
      await p.click('.ss-txn [data-act=out][aria-expanded=true]'); await p.waitForTimeout(250);
      const n2 = await p.evaluate(() => document.querySelectorAll('#ss-reqs .ss-rq.out').length);
      ok('"n left out" in a header shows its requests and hides them again', n1 > n0 && n2 === n0, { n0, n1, n2 });
      await p.focus('.ss-txn [data-act=out]'); await p.keyboard.press('Enter'); await p.waitForTimeout(250);
      ok('… and the keyboard does the same (Enter)', await p.evaluate(() => !!document.querySelector('.ss-txn [data-act=out][aria-expanded=true]')));
      await p.keyboard.press('Enter'); await p.waitForTimeout(250);
    }
    const t = await p.$('.ss-txn:not(.none)');
    if (t) { await t.hover(); await p.waitForTimeout(250); ok('Rename / Ungroup appear on the transaction under the pointer', await p.evaluate(() => getComputedStyle(document.querySelector('.ss-txn:not(.none):hover [data-act=rename]')).opacity === '1')); }
  }

  // ── step 2: Correlate ──
  await p.mouse.move(5, 500);
  await p.click('#ss-steps [data-step="2"]'); await p.evaluate(() => SSC.section('values')); await idle();
  const ticked = await p.evaluate(() => (PerfxStudio.state().advisorCandidates || []).filter((c) => c.status === 'accepted' && !c._applied).length);
  ok('Correlate: the High values come ticked (' + ticked + ')', ticked > 0);
  if (NEW) {
    await look('Correlate, values ticked');
    const soft = await p.evaluate(() => { const n = getComputedStyle(document.getElementById('ss-step-next')).backgroundColor, a = getComputedStyle(document.getElementById('ss-cr-apply')).backgroundColor; return n !== a; });
    ok('Correlate: "Add n to the script" is the one main button, Next is soft', soft);
  }
  await p.click('#ss-cr-apply'); await idle();
  const s2 = await st(); ok('Add to the script: ' + s2.corr + ' correlations in the script', s2.corr >= ticked, s2);
  await p.evaluate(() => SSC.section('script')); await p.waitForTimeout(300);
  if (NEW) await look('Correlate, in the script');
  await p.click('[data-sec-b=values]'); await p.waitForTimeout(200);
  // the editor on a value in the script, and its Test
  const id = await p.evaluate(() => { const c = (PerfxStudio.state().advisorCandidates || []).find((x) => x._applied); return c && c.id; });
  if (id) {
    await p.evaluate((i) => SSE.open(i), id); await p.waitForTimeout(500);
    if (NEW) await look('Editor, a value in the script');
    await p.click('#ss-ed-run'); await p.waitForTimeout(800);
    ok('Editor: Test opens with what it reads', await p.evaluate(() => { const d = document.getElementById('ss-test-dlg'); return d.open && d.textContent.length > 40; }));
    await p.evaluate(() => document.getElementById('ss-test-dlg').close());
    await p.evaluate(() => SSE.close());
  }
  // Add manual correlation: the right side says what to do; choosing a request brings the ways to read it
  await p.evaluate(() => SSE.add()); await p.waitForTimeout(500);
  if (NEW) {
    ok('Add manual: "Choose a request on the left" until one is chosen, no greyed choices', await p.evaluate(() => !document.getElementById('ss-ed-pick').hidden && document.getElementById('ss-ed-kind').hidden));
    await look('Add manual correlation');
    const sel = await p.$('#ss-ed .ss-ed-left select');
    if (sel) {
      await p.evaluate(() => { const s = document.querySelector('#ss-ed .ss-ed-left select'); s.selectedIndex = 1; s.dispatchEvent(new Event('change', { bubbles: true })); });
      await p.waitForTimeout(600);
      ok('Add manual: a request chosen — its response shows, the ways to read it appear', await p.evaluate(() => document.getElementById('ss-ed-pick').hidden && !document.getElementById('ss-ed-kind').hidden && document.querySelectorAll('#ss-ed-kind [data-kind]:not([hidden]):not(:disabled)').length > 0));
      await look('Add manual, a request chosen');
    }
  }
  await p.evaluate(() => SSE.close()); await p.waitForTimeout(200);

  // ── step 3: Test data ──
  await p.click('#ss-steps [data-step="3"]'); await p.waitForTimeout(300); if (await p.isVisible('#ss-ask')) await p.click('#ss-ask-no'); await idle();
  if (NEW) await look('Test data');
  // ── step 4: Download ──
  await p.click('#ss-steps [data-step="4"]'); await idle();
  if (NEW) await look('Download');
  const scripts = await p.evaluate(() => PerfxStudio.state().scripts);
  fs.writeFileSync(path.join(dir, 'scripts.json'), JSON.stringify(scripts, null, 1));
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click('#ss-done-dl')]);
  const zp = path.join(dir, await dl.suggestedFilename()); await dl.saveAs(zp);
  const zip = await JSZip.loadAsync(fs.readFileSync(zp)); const files = {};
  for (const n of Object.keys(zip.files)) if (!zip.files[n].dir) files[n] = await zip.files[n].async('string');
  fs.writeFileSync(path.join(dir, 'zip.json'), JSON.stringify(files, null, 1));
  const main = Object.keys(files).find((n) => /(^|\/)(main\.js|Action\.c)$/.test(n));
  const code = Object.keys(files).filter((n) => /\.(js|c|h)$/.test(n)).map((n) => files[n]).join('\n');
  const reads = main ? (code.match(FMT === 'devweb' ? /new load\.\w*Extractor\(/g : /web_reg_save_param\w*\(/g) || []).length : 0;
  ok('the ZIP (' + Object.keys(files).length + ' files) has the script with ' + reads + ' value reads', main && reads > 0, Object.keys(files));
  ok('no page errors', !errs.length, errs);
  fs.writeFileSync(path.join(dir, 'checks.json'), JSON.stringify(checks, null, 1));
  await b.close();
}

(async () => {
  if (!fs.existsSync(HAR)) { console.error('no ' + HAR + ' — run make-fixtures.js first'); process.exit(2); }
  for (const fmt of ['devweb', 'webhttp']) {
    console.log('== ' + fmt + ' ' + NEWURL);
    await run(NEWURL, path.join(OUTROOT, 'new'), fmt);
    if (!OLDURL) continue;
    console.log('== ' + fmt + ' ' + OLDURL + ' (old)');
    await run(OLDURL, path.join(OUTROOT, 'old'), fmt);
    const rd = (w, f) => JSON.parse(fs.readFileSync(path.join(OUTROOT, w, fmt, f), 'utf8'));
    const diff = (x, y) => [...new Set([...Object.keys(x), ...Object.keys(y)])].filter((k) => x[k] !== y[k]);
    const ds = diff(rd('old', 'scripts.json'), rd('new', 'scripts.json')), dz = diff(rd('old', 'zip.json'), rd('new', 'zip.json'));
    const same = !ds.length && !dz.length;
    if (!same) failed++;
    console.log((same ? 'PASS ' : 'FAIL ') + fmt + ': old and new give the same script files and ZIP files' + (same ? '' : ' — differ: ' + ds.concat(dz).join(', ')));
  }
  console.log(failed ? failed + ' check(s) failed' : 'every check passed');
  process.exitCode = failed ? 1 : 0;
})();
