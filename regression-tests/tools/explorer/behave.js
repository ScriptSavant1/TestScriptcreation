#!/usr/bin/env node
// HAR Explorer, existing behaviour against new behaviour: the same user actions on two versions of the page — every
// request's details on every tab (two recordings), the filters, the domains, folding, Find a value's answer for every
// suggested value, Copy as cURL, Hide secrets, Show left-out — and how it looks (font, size, weight, colours,
// borders, size of every kind of element). Every difference is listed.
//   node behave.js http://localhost:3989/converter/har-explorer http://localhost:3999/converter/har-explorer [--dump=<dir>]
// The old page: git archive <commit> | tar -x -C <folder>; in it NODE_PATH=<repo>/node_modules PORT=3989 node src/web/server.js
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(ROOT, 'cdp-recorder/recorder/node_modules/playwright-core'));
const args = process.argv.slice(2), [OLD, NEW] = args.filter((a) => !a.startsWith('--'));
const DUMP = (args.find((a) => a.startsWith('--dump=')) || '').slice(7);
const FILES = [path.join(ROOT, 'regression-tests/tools/studio/fixtures/rich-shop.har'), path.join(ROOT, 'collection-examples/WebTours.har')];
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

async function walk(b, url, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, permissions: ['clipboard-read', 'clipboard-write'] }), p = await ctx.newPage(), out = {}, errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); await p.route('**/analytics/**', (r) => r.fulfill({ status: 204 }));
  const is = (k, v) => { out[k] = typeof v === 'string' ? norm(v) : v; };
  const ev = (f, a) => p.evaluate(f, a), wait = (ms) => p.waitForTimeout(ms);
  const part = async (name, f) => { try { await f(); } catch (e) { out[name + ': stopped'] = e.message.split('\n')[0].slice(0, 200); } };
  const look = (k, sels) => ev((L) => L.map((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return s + ' —'; const c = getComputedStyle(e), r = e.getBoundingClientRect(); return s + ' ' + [c.fontFamily.split(',')[0], c.fontSize, c.fontWeight, c.color, c.backgroundColor, c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor, c.borderRadius, Math.round(r.width) + 'x' + Math.round(r.height)].join(' / '); }).join('\n'), sels).then((v) => is(k, v));
  // the details pane's text without the address's line-break hints
  const det = () => ev(() => document.getElementById('hx-det').innerText);

  await p.goto(url); await ev(() => { try { localStorage.clear(); } catch (e) { /* none */ } document.documentElement.setAttribute('data-theme', 'light'); }); await p.reload(); await ev(() => document.documentElement.setAttribute('data-theme', 'light')); await wait(400);
  await part('start', async () => { is('start: text', await ev(() => document.getElementById('hx-start').innerText)); await look('start: look', ['#hx-drop', '#hx-pick', '.hx-why', '.hx-band']); });
  for (const [fi, file] of FILES.entries()) {
    const F = 'file ' + (fi + 1) + ' ';
    if (fi) { await p.click('#hx-another'); await wait(300); }
    await p.setInputFiles('#hx-file', file); await p.waitForSelector('#hx-ws:not([hidden])', { timeout: 60000 }); await wait(900);
    await part(F + 'workspace', async () => {
      is(F + 'file bar', await ev(() => document.querySelector('.hx-fb, #hx-ws > header, #hx-fb-name').closest('div, header').innerText));
      is(F + 'types', await ev(() => document.getElementById('hx-types').innerText));
      is(F + 'domains', await ev(() => document.getElementById('hx-dom-list').innerText + ' | ' + document.getElementById('hx-dom-sum').textContent));
      is(F + 'count', await ev(() => document.getElementById('hx-count').textContent));
    });
    // every request in the list, every tab of its details (Arrow down walks the list as a user would)
    await part(F + 'requests', async () => {
      await p.click('.hx-req >> nth=0'); await wait(250);
      const seen = [];
      for (let i = 0; i < 80; i++) {
        const n = await ev(() => { const s = document.querySelector('.hx-req.sel'); return s ? s.dataset.n : null; }); if (!n || seen.includes(n)) break; seen.push(n);
        is(F + 'row ' + n, await ev(() => document.querySelector('.hx-req.sel').innerText));
        const tabs = await ev(() => [...document.querySelectorAll('#hx-det .hx-tab')].map((t) => t.dataset.tab));
        for (const t of tabs) { await p.click(`#hx-det .hx-tab[data-tab="${t}"]`); await wait(60); is(F + 'req ' + n + ' ' + t, (await det()).slice(0, 4000)); }
        await p.click('#hx-det .hx-tab[data-tab="headers"]'); await wait(40);
        await p.focus('#hx-list'); await p.keyboard.press('ArrowDown'); await wait(80);
      }
      is(F + 'requests walked', seen.join(','));
      if (!fi) await look('details look', ['#hx-det .hx-dh', '#hx-det .hx-durl code', '#hx-det .hx-dsum', '#hx-det .hx-tabs', '#hx-det .hx-tab', '#hx-det .hx-tab[aria-selected=true]', '#hx-det .hx-sec', '#hx-det .hx-kv td', '#hx-det [data-copy]', '#hx-maskbtn', '#hx-det-hide', '.hx-req', '.hx-req .u .p', '.hx-req .wf', '.hx-grp', '#hx-dom-list .hx-dom-row', '#hx-dom-list .h', '.hx-chip, #hx-types button', '#hx-findbtn']);
    });
    await part(F + 'controls', async () => {
      await p.click('.hx-req >> nth=2'); await wait(200);
      await p.click('#hx-det [data-copy=curl]'); await wait(150); is(F + 'cURL', await ev(() => navigator.clipboard.readText()));
      await p.click('#hx-det [data-copy=url]'); await wait(150); is(F + 'URL', await ev(() => navigator.clipboard.readText()));
      await p.click('#hx-maskbtn'); await wait(150); is(F + 'secrets hidden', (await det()).slice(0, 3000)); await p.click('#hx-maskbtn'); await wait(150);
      await p.click('#hx-outbtn'); await wait(250); is(F + 'left-out shown', await ev(() => document.getElementById('hx-count').textContent + ' ' + document.querySelectorAll('.hx-req.out').length)); await p.click('#hx-outbtn'); await wait(200);
      await p.click('#hx-fold'); await wait(200); is(F + 'collapse all', await ev(() => document.querySelectorAll('.hx-grp.closed').length + '/' + document.querySelectorAll('.hx-grp').length)); await p.click('#hx-fold'); await wait(200);
      await p.fill('#hx-q', 'v2'); await wait(300); is(F + 'address filter', await ev(() => document.getElementById('hx-count').textContent)); await p.fill('#hx-q', ''); await wait(300);
      const t1 = p.locator('#hx-types [data-type], #hx-types button').first(); if (await t1.count()) { await t1.click(); await wait(250); is(F + 'a type off', await ev(() => document.getElementById('hx-count').textContent)); await t1.click(); await wait(250); }
      await ev(() => { const x = document.querySelector('#hx-dom-list input'); if (x) x.click(); }); await wait(250); is(F + 'a domain off', await ev(() => document.getElementById('hx-count').textContent + ' ' + document.getElementById('hx-dom-sum').textContent)); await ev(() => document.getElementById('hx-dom-all').click()); await wait(250);
    });
    // Find a value: every suggestion, its answer
    await part(F + 'find', async () => {
      await p.click('#hx-findbtn'); await p.waitForFunction(() => !document.querySelector('.hx-sugg-wait') || !/Looking/.test(document.querySelector('.hx-sugg-wait').textContent), null, { timeout: 30000 }); await wait(1500);
      is(F + 'find: start', await det());
      const n = await p.locator('[data-sugg]').count();
      for (let i = 0; i < Math.min(n, 12); i++) { await p.locator('[data-sugg]').nth(i).click(); await wait(900); is(F + 'find ' + i, (await det()).slice(0, 4000)); }
      await p.fill('#hx-fq', 'no-such-value-anywhere'); await wait(1000); is(F + 'find: nothing', await det());
      if (!fi) await look('find look', ['#hx-det.hx-find-sheet', '#hx-det .hx-fh', '#hx-fq', '.hx-sugg button', '#hx-det .hx-db']);
      await p.keyboard.press('Escape'); await wait(300); is(F + 'Escape closes Find', await ev(() => !document.getElementById('hx-det').classList.contains('hx-find-sheet')));
    });
    // the panels fold to rails and come back
    await part(F + 'panels', async () => {
      const ids = await ev(() => ['hx-dom-hide', 'hx-hide', 'hx-det-hide'].filter((id) => { const b = document.getElementById(id); return b && b.offsetParent; }));
      for (const id of ids) { await p.click('#' + id); await wait(200); is(F + 'fold ' + id, await ev(() => document.getElementById('hx-panes').className)); const rail = await ev(() => [...document.querySelectorAll('.hx-rail, [id$=-rail]')].filter((x) => x.offsetParent).map((x) => x.id)[0]); if (rail) { await p.click('#' + rail); await wait(200); } }
      is(F + 'panels back', await ev(() => document.getElementById('hx-panes').className));
    });
  }
  is('page errors', errs.join(' | '));
  await ctx.close(); return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'msedge' }); let bad = 0, n = 0;
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    const a = await walk(b, OLD, w, h), c = await walk(b, NEW, w, h);
    if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, 'old-' + w + '.json'), JSON.stringify(a, null, 1)); fs.writeFileSync(path.join(DUMP, 'new-' + w + '.json'), JSON.stringify(c, null, 1)); }
    for (const [o, v] of [['before', a], ['now', c]]) Object.keys(v).filter((k) => / stopped$/.test(k)).forEach((k) => { bad++; console.log(`${w}x${h}  ${o}: ${k} — ${v[k]}`); });
    for (const k of ['file 1 requests walked', 'file 2 requests walked', 'file 1 find 0', 'file 1 cURL', 'details look']) if (!c[k]) { bad++; console.log(`${w}x${h}  empty, so nothing was compared: ${k}`); }
    for (const k of new Set([...Object.keys(a), ...Object.keys(c)])) { n++; if (JSON.stringify(a[k]) !== JSON.stringify(c[k])) { bad++; console.log(`${w}x${h}  ${k}\n    before: ${String(JSON.stringify(a[k])).slice(0, 500)}\n    now:    ${String(JSON.stringify(c[k])).slice(0, 500)}`); } }
  }
  console.log(`${n} behaviours compared, ${bad} differ`);
  await b.close(); process.exit(bad ? 1 : 0);
})();
