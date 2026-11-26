#!/usr/bin/env node
// Home and Help, existing behaviour against new behaviour: the same user actions on two portals (the old one run from
// `git archive` on another port, the new one) — where every Home button and link leads, every Help section's words, the
// sidebar list, Previous / Next, search, the FAQ, what is remembered — and how it looks (font, size, weight, colours,
// borders, size of every kind of element). Every difference is listed.
//   node behave.js http://localhost:3989/converter/ http://localhost:3999/converter/ [--dump=<dir>]
// The old portal: git archive <commit> | tar -x -C <folder>; in it: NODE_PATH=<repo>/node_modules PORT=3989 node src/web/server.js
// Exit code 1 when something differs, a part stopped, or a part compared nothing.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium } = require(path.resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const args = process.argv.slice(2), [OLD, NEW] = args.filter((a) => !a.startsWith('--'));
const DUMP = (args.find((a) => a.startsWith('--dump=')) || '').slice(7);
const norm = (s) => String(s).replace(/\s+/g, ' ').trim();

async function walk(b, url, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h } }), p = await ctx.newPage(), out = {}, errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); await p.route('**/analytics/**', (r) => r.fulfill({ status: 204 }));
  const is = (k, v) => { out[k] = typeof v === 'string' ? norm(v) : v; };
  const ev = (f, a) => p.evaluate(f, a), wait = (ms) => p.waitForTimeout(ms);
  const part = async (name, f) => { try { await f(); } catch (e) { out[name + ': stopped'] = e.message.split('\n')[0].slice(0, 200); } };
  const open = async () => { await p.goto(url); await ev(() => { try { localStorage.clear(); sessionStorage.clear(); } catch (e) { /* none */ } }); await p.goto(url); await ev(() => document.documentElement.setAttribute('data-theme', 'light')); await wait(500); };
  const where = () => ev(() => { const tn = document.getElementById('tb-name').textContent.trim(); const sec = document.querySelector('#portal-help .help-acc-item.cur'); return tn + (/^Help/.test(tn) && sec ? ' / ' + sec.id : '') + (scrollY > 40 ? ' / scrolled' : ''); });
  const look = (sels) => ev((L) => L.map((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return s + ' —'; const c = getComputedStyle(e), r = e.getBoundingClientRect(); return s + ' ' + [c.fontFamily.split(',')[0], c.fontSize, c.fontWeight, c.color, c.backgroundColor, c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor, c.borderRadius, Math.round(r.width) + 'x' + Math.round(r.height)].join(' / '); }).join('\n'), sels);

  await open();
  // ── Home ──
  await part('home', async () => {
    is('home: text', await ev(() => document.getElementById('portal-home').innerText));
    is('home: sections', await ev(() => [...document.querySelectorAll('#portal-home h1, #portal-home h2, #portal-home h3')].map((x) => x.textContent.trim()).join(' | ')));
    is('home: look', await look(['.hm-hero', '.hm-hero h1', '.hm-tagline', '.hm-lead', '.hm-hero-actions .ds-btn', '.hm-tools', '.hm-tool', '.hm-tool-name', '.hm-tool-what', '.hm-tool-open', '.hm-panel', '.hm-panel-head', '.hm-step-list', '.hm-step-t', '.hm-help-tiles', '.hm-private', '.hm-foot', '.hm-map']));
  });
  await part('home links', async () => {
    const n = await ev(() => [...document.querySelectorAll('#portal-home a, #portal-home button')].filter((x) => x.offsetParent).length);
    const labels = await ev(() => [...document.querySelectorAll('#portal-home a, #portal-home button')].filter((x) => x.offsetParent).map((x) => (x.innerText || x.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 48)));
    for (let i = 0; i < n; i++) {
      await p.goto(url); await wait(350);
      await ev((i) => [...document.querySelectorAll('#portal-home a, #portal-home button')].filter((x) => x.offsetParent)[i].click(), i); await wait(500);
      is('home link: ' + labels[i], await where());
    }
  });
  // ── Help ──
  await open(); await ev(() => PerfxShell.go('help', { instant: true })); await wait(600);
  const ids = await ev(() => [...document.querySelectorAll('#portal-help .help-acc-item')].map((x) => x.id));
  is('help: sections', ids.join(' '));
  await part('help sections', async () => {
    for (const id of ids) {
      await ev((id) => haccJump(id), id); await wait(250);
      is('help ' + id + ': shown', await where());
      is('help ' + id + ': words', await ev((id) => { const s = document.getElementById(id); const c = s.cloneNode(true); c.querySelectorAll('.help-insec').forEach((x) => x.remove()); return c.textContent; }, id));
    }
    is('help: look', await look(['.help-acc-item.cur', '.help-acc-item.cur .help-acc-title', '.help-acc-item.cur .help-acc-sub', '.help-acc-item.cur .help-p', '.help-acc-item.cur .help-h3', '.help-acc-item.cur .help-list', '.help-acc-item.cur .help-table', '.help-pager', '#portal-help input[type=search], #help-search', '#sb-help-nav', '#sb-help-nav .cur, #sb-help-nav [aria-current]']));
  });
  await part('help sidebar list', async () => {
    const items = await ev(() => [...document.querySelectorAll('#sb-help-nav button, #sb-help-nav a')].filter((x) => x.offsetParent).map((x) => x.textContent.trim()));
    is('sidebar items', items.join(' | '));
    for (let i = 0; i < items.length; i++) { await ev((i) => [...document.querySelectorAll('#sb-help-nav button, #sb-help-nav a')].filter((x) => x.offsetParent)[i].click(), i); await wait(250); is('sidebar → ' + items[i], await where()); }
  });
  await part('help previous next', async () => {
    await ev((id) => haccJump(id), ids[0]); await wait(200); const seq = [];
    for (let i = 0; i < ids.length + 1; i++) { const nx = p.locator('.help-pager [data-dir=next], .help-pager .next, .help-pager button:has-text("Next")').first(); if (!(await nx.count()) || !(await nx.isVisible())) break; await nx.click(); await wait(200); seq.push(await ev(() => (document.querySelector('#portal-help .help-acc-item.cur') || {}).id)); }
    is('Next goes through', seq.join(' '));
    const pv = p.locator('.help-pager button:has-text("Previous")').first(); if (await pv.count()) { await pv.click(); await wait(200); is('Previous', await ev(() => (document.querySelector('#portal-help .help-acc-item.cur') || {}).id)); }
    await p.reload(); await wait(700); await ev(() => PerfxShell.go('help', { instant: true })); await wait(500); is('remembered after reload', await ev(() => (document.querySelector('#portal-help .help-acc-item.cur') || {}).id));
  });
  await part('help search', async () => {
    const box = p.locator('#portal-help input[type=search], #help-search').first();
    for (const q of ['correlation', 'pacing', 'DPoP', 'think time', 'stress', 'zzqqxx']) {
      await box.fill(q); await wait(500);
      is('search ' + q, await ev(() => [...document.querySelectorAll('#portal-help .help-acc-item')].filter((x) => x.offsetParent).map((x) => x.id).join(' ') + ' :: marks ' + document.querySelectorAll('#portal-help mark').length + ' :: ' + ((document.querySelector('#portal-help .help-search-count, #help-count') || {}).textContent || '')));
    }
    await box.fill(''); await wait(400); await p.keyboard.press('Escape');
    await ev(() => document.activeElement && document.activeElement.blur()); await p.keyboard.press('/'); await wait(200); is('"/" goes to search', await ev(() => !!(document.activeElement && document.activeElement.matches('input'))));
  });
  await part('help faq', async () => {
    await ev(() => haccJump('hacc-faq')); await wait(300);
    is('faq questions', await ev(() => [...document.querySelectorAll('#hacc-faq .help-faq-q')].map((x) => x.textContent.trim()).join(' | ')));
    const btns = p.locator('#hacc-faq .help-faq-btn'); const n = await btns.count();
    for (const i of [0, 3, n - 1]) { await btns.nth(i).click(); await wait(250); }
    is('faq opened', await ev(() => [...document.querySelectorAll('#hacc-faq .help-faq-item')].map((x, i) => (x.classList.contains('open') || x.querySelector('[aria-expanded=true]') ? i : null)).filter((x) => x != null).join(',')));
    is('faq answers shown', await ev(() => [...document.querySelectorAll('#hacc-faq .help-faq-a')].filter((x) => x.getClientRects().length && x.getBoundingClientRect().height > 2).length));
  });
  is('page errors', errs.join(' | '));
  await ctx.close(); return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'msedge' }); let bad = 0, n = 0;
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    const a = await walk(b, OLD, w, h), c = await walk(b, NEW, w, h);
    if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, 'old-' + w + '.json'), JSON.stringify(a, null, 1)); fs.writeFileSync(path.join(DUMP, 'new-' + w + '.json'), JSON.stringify(c, null, 1)); }
    for (const [o, v] of [['before', a], ['now', c]]) Object.keys(v).filter((k) => / stopped$/.test(k)).forEach((k) => { bad++; console.log(`${w}x${h}  ${o}: ${k} — ${v[k]}`); });
    for (const k of ['home: text', 'help: sections', 'faq questions', 'sidebar items', 'Next goes through']) if (!c[k]) { bad++; console.log(`${w}x${h}  empty, so nothing was compared: ${k}`); }
    for (const k of new Set([...Object.keys(a), ...Object.keys(c)])) { n++; if (JSON.stringify(a[k]) !== JSON.stringify(c[k])) { bad++; console.log(`${w}x${h}  ${k}\n    before: ${String(JSON.stringify(a[k])).slice(0, 500)}\n    now:    ${String(JSON.stringify(c[k])).slice(0, 500)}`); } }
  }
  console.log(`${n} behaviours compared, ${bad} differ`);
  await b.close(); process.exit(bad ? 1 : 0);
})();
