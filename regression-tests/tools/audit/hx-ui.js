// HAR Explorer screen walk-through inside the portal: load, tabs, keyboard, filters, left-out, mask, big files.
//   node hx-ui.js <outDir>
const { chromium } = require(require('path').resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const fs = require('fs'), path = require('path');
const OUT = process.argv[2]; fs.mkdirSync(OUT, { recursive: true });
const EX = require('path').resolve(__dirname, '../../../collection-examples').replace(/\\/g, '/') + '/';
const FX = path.join(__dirname, '..', 'studio', 'fixtures') + '/';
// a 20,000-request recording (synthetic) for the speed target
const BIG = path.join(OUT, 'big-20000.har');
if (!fs.existsSync(BIG)) {
  const t0 = Date.parse('2026-10-30T09:00:00Z'), entries = [], pages = [];
  for (let i = 0; i < 20000; i++) {
    const tx = 'tx_' + (1 + Math.floor(i / 500)); if (i % 500 === 0) pages.push({ id: tx, title: 'T' + String(pages.length + 1).padStart(2, '0') + '_Step' });
    const body = JSON.stringify({ id: i, token: 'tok-' + i.toString(36) + '-' + 'x'.repeat(1500), items: [1, 2, 3] });
    entries.push({ startedDateTime: new Date(t0 + i * 30).toISOString(), time: 20 + (i % 50), pageref: tx, _resourceType: i % 4 ? 'Fetch' : 'Script',
      request: { method: i % 3 ? 'GET' : 'POST', url: `https://api.example.com/v1/item/${i}?page=${i % 7}`, httpVersion: 'HTTP/1.1', headers: [{ name: 'Accept', value: 'application/json' }, { name: 'Authorization', value: 'Bearer abc.' + i }], queryString: [], cookies: [] },
      response: { status: 200, statusText: 'OK', headers: [{ name: 'Content-Type', value: i % 4 ? 'application/json' : 'application/javascript' }], cookies: [], content: { size: body.length, mimeType: i % 4 ? 'application/json' : 'application/javascript', text: body } },
      timings: { send: 1, wait: 15, receive: 4 } });
  }
  fs.writeFileSync(BIG, JSON.stringify({ log: { version: '1.2', creator: { name: 'PerfX Studio Recorder', version: '1.0.0' }, pages, entries } }));
}
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
  const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:3999' });
  await p.goto('http://localhost:3999/converter/', { waitUntil: 'networkidle' });
  await p.evaluate(() => PerfxShell.go('explore', { instant: true }));
  await p.waitForFunction(() => { const d = document.getElementById('iframe-explorer').contentDocument; return d && d.getElementById('hx-file'); });
  const f = await (await p.$('#iframe-explorer')).contentFrame();
  const shot = (n) => p.screenshot({ path: path.join(OUT, n + '.png') });
  const load = async (file) => { const t = Date.now(); await f.setInputFiles('#hx-file', file); await f.waitForSelector('#hx-ws:not([hidden])', { timeout: 120000 }); return Date.now() - t; };
  const another = async () => { await f.click('#hx-another'); await f.waitForSelector('#hx-start:not([hidden])'); };

  console.log('WebTours load', await load(EX + 'WebTours.har'), 'ms'); await shot('01-webtours-list');
  // click the login POST and walk the tabs
  const login = await f.$('.hx-req:has-text("/cgi-bin/login.pl")'); await login.click();
  for (const t of ['headers', 'payload', 'response', 'preview', 'cookies', 'timing']) { await f.click(`.hx-tab[data-tab="${t}"]`); await p.waitForTimeout(120); await shot('02-login-' + t); }
  console.log('payload has form data:', await f.evaluate(() => { document.querySelector('.hx-tab[data-tab="payload"]').click(); return /Form data/.test(document.getElementById('hx-det').textContent) && /userSession/.test(document.getElementById('hx-det').textContent); }));
  // keyboard
  await f.focus('#hx-list'); const before = await f.evaluate(() => document.querySelector('.hx-req.sel .num').textContent);
  await p.keyboard.press('ArrowDown'); await p.keyboard.press('ArrowDown');
  console.log('keyboard: from #' + before + ' to #' + await f.evaluate(() => document.querySelector('.hx-req.sel .num').textContent));
  // show left-out, filter, collapse
  await f.check('#hx-out'); const c1 = await f.textContent('#hx-count');
  await f.fill('#hx-q', 'nav.pl'); await p.waitForTimeout(100); const c2 = await f.textContent('#hx-count');
  await f.fill('#hx-q', ''); await f.click('#hx-fold'); const c3 = await f.evaluate(() => [document.querySelectorAll('.hx-req').length, document.getElementById('hx-fold').textContent]);
  await f.click('#hx-fold'); await f.uncheck('#hx-out');
  console.log('show left-out:', c1, '| filter nav.pl:', c2, '| collapse all → rows, button:', JSON.stringify(c3));
  // mask + copy as cURL
  await f.check('#hx-mask'); await f.click('.hx-tab[data-tab="headers"]'); await shot('03-masked');
  await f.click('[data-copy="curl"]'); await p.waitForTimeout(200);
  const clip = await p.evaluate(() => navigator.clipboard.readText().catch(() => '(no clipboard)'));
  console.log('cURL copied, first line:', clip.split('\n')[0], '| masked cookie in cURL:', /Cookie: ••••••/i.test(clip) || !/Cookie/i.test(clip));
  await f.uncheck('#hx-mask');
  await p.evaluate(() => document.getElementById('tb-theme').click()); await p.waitForTimeout(200); await shot('04-other-theme');
  await p.evaluate(() => document.getElementById('tb-theme').click());

  // perfmatrix: images / html preview
  await another(); console.log('perfmatrix load', await load(EX + 'perfmatrix.com.har'), 'ms');
  await f.click('.hx-req >> nth=0'); await f.click('.hx-tab[data-tab="preview"]'); await p.waitForTimeout(200); await shot('05-perfmatrix-preview');

  // 3000 requests: scroll to the end
  await another(); console.log('big-3000 load', await load(FX + 'big-3000.har'), 'ms');
  await f.check('#hx-out');
  const end = await f.evaluate(async () => { const l = document.getElementById('hx-list'); l.scrollTop = l.scrollHeight; await new Promise((r) => setTimeout(r, 120)); const nums = [...document.querySelectorAll('.hx-req .num')].map((x) => +x.textContent); return { rows: document.querySelectorAll('#hx-rows > *').length, last: Math.max(...nums), count: document.getElementById('hx-count').textContent }; });
  console.log('big-3000 scrolled to the end:', JSON.stringify(end)); await shot('06-big-3000-end');
  await f.uncheck('#hx-out');

  // 20,000 requests
  await another(); const big = fs.statSync(BIG).size;
  const tBig = await load(BIG);
  const drawn = await f.evaluate(() => document.querySelectorAll('#hx-rows > *').length);
  const tScroll = await f.evaluate(async () => { const l = document.getElementById('hx-list'), t = performance.now(); for (let i = 0; i < 40; i++) { l.scrollTop = i * 2000; await new Promise((r) => requestAnimationFrame(r)); } return Math.round(performance.now() - t); });
  const tClick = await f.evaluate(() => { const t = performance.now(); document.querySelector('.hx-req').click(); return Math.round(performance.now() - t); });
  console.log(`big-20000 (${(big / 1048576).toFixed(1)} MB): load ${tBig} ms, ${drawn} rows drawn, 40 scroll frames ${tScroll} ms, click ${tClick} ms`); await shot('07-big-20000');

  // errors: not JSON, not a HAR
  await another();
  await f.setInputFiles('#hx-file', FX + 'not-a-har.json'); await p.waitForTimeout(400); console.log('not a HAR →', await f.textContent('#hx-toast'));
  await f.setInputFiles('#hx-file', FX + 'invalid.har'); await p.waitForTimeout(400); console.log('invalid →', await f.textContent('#hx-toast'));
  await f.setInputFiles('#hx-file', FX + 'empty.har'); await p.waitForTimeout(600); console.log('empty →', await f.evaluate(() => [document.getElementById('hx-ws').hidden, document.getElementById('hx-count').textContent, document.getElementById('hx-empty').hidden]));
  // phone
  await another(); await load(EX + 'WebTours.har');
  await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(300); await shot('08-phone');
  console.log('sideways at 390:', await f.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1));
  console.log('errors:', JSON.stringify(errs));
  await b.close();
})();
