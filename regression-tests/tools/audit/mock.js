// A mockup, checked with the same checks as the real screens (review.js: overlap, clipped, unnamed, focus, sideways,
// plain, dismiss, fill; audit.js: fonts, weights, contrast), on every screen, both themes, several sizes — plus
//   - reach: a screen's main button (data-reach, or .ds-btn-primary outside a scrolling panel) is in the window without scrolling
//   - gap: no two cards / panels / buttons side by side or one above the other touch
//   - cut: a card or panel head squeezed so that its own content is cut off (it has no scroll bar of its own)
//   - inventory: every ID of the inventory (rows not "Remove" or "not drawn") is on some screen (data-inv)
//   node mock.js <mockup.html> [--inventory=<file.md>] [--out=<folder>] [--sizes=1366,1920,2560,3840] [--themes=light,dark]
// The mockup gives window.MK = { tool(id), jump(screen) } and the lists #mk-tool [data-v], #mk-state option.
'use strict';
const path = require('path'), fs = require('fs');
const { chromium, inspect, focusCheck, dismissCheck, HEIGHT } = require('./review.js');
const { measure } = require('./audit.js');
const args = process.argv.slice(2), file = args.find((a) => !a.startsWith('--'));
const opt = (k, d) => { const a = args.find((x) => x.startsWith('--' + k + '=')); return a ? a.slice(k.length + 3) : d; };
const SIZES = opt('sizes', '1366,1920,2560,3840').split(',').map(Number), THEMES = opt('themes', 'light,dark').split(',');
const OUT = opt('out', ''), INV = opt('inventory', '');

function reach() {
  const out = [], modal = document.querySelector('dialog[open]');
  (modal || document).querySelectorAll('[data-reach], .ds-btn-primary').forEach((e) => {
    if (!e.offsetParent || e.closest('table, .mk')) return;
    const r = e.getBoundingClientRect();
    if (r.bottom > innerHeight + 1 || r.right > innerWidth + 1 || r.top < -1) out.push('"' + e.innerText.trim().slice(0, 30) + '" ends at ' + Math.round(r.right) + ' x ' + Math.round(r.bottom) + ' in ' + innerWidth + ' x ' + innerHeight);
  });
  return out;
}
function gaps() {
  const out = [], box = [...document.querySelectorAll('.card, .pane, .setbar, .note, .hero')].filter((e) => e.offsetParent && !e.closest('dialog') && !e.closest('.rv'));
  const btn = [...document.querySelectorAll('.ds-btn')].filter((e) => e.offsetParent && !e.closest('.split, dialog'));
  const near = (list) => list.forEach((a, i) => list.slice(i + 1).forEach((b) => {
    if (a.contains(b) || b.contains(a)) return;
    const p = a.getBoundingClientRect(), q = b.getBoundingClientRect();
    const x = Math.max(p.left, q.left) - Math.min(p.right, q.right), y = Math.max(p.top, q.top) - Math.min(p.bottom, q.bottom);
    if ((x < -1 && y < 4 && y > -60) || (y < -1 && x < 4 && x > -60)) out.push((a.innerText || '').trim().slice(0, 20) + ' / ' + (b.innerText || '').trim().slice(0, 20) + ' ' + Math.round(Math.max(x, y)) + ' px apart');
  }));
  near(box); near(btn.filter((e) => { const r = e.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }).filter((e) => !e.closest('.pb, .home')));
  return out;
}

function cut() {
  return [...document.querySelectorAll('.card, .hero, .note, .frows, .adv, .setbar, .ph, .pt, .steps, .fbar, .chg')].filter((e) => e.offsetParent && e.scrollHeight > e.clientHeight + 2 && getComputedStyle(e).overflowY !== 'auto')
    .map((e) => '.' + e.classList[0] + ' "' + (e.innerText || '').trim().slice(0, 24) + '" ' + (e.scrollHeight - e.clientHeight) + ' px cut off');
}

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const by = new Map(), seen = new Set(), fams = new Set(), weights = new Set();
  let screens = 0, errs = [], ext = new Set();
  const add = (k, at) => { if (!by.has(k)) by.set(k, new Set()); by.get(k).add(at); };
  for (const theme of THEMES) for (const w of SIZES) {
    const p = await b.newPage({ viewport: { width: w, height: HEIGHT[w] || 1000 } });
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('request', (r) => { if (!/^(file|data|blob):/.test(r.url())) ext.add(r.url()); });
    await p.goto('file:///' + path.resolve(file).replace(/\\/g, '/'));
    await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    const tools = await p.$$eval('#mk-tool [data-v]', (l) => l.map((x) => x.dataset.v)), states = await p.$$eval('#mk-state option', (l) => l.map((x) => x.value));
    for (const t of tools) for (const s of states) {
      await p.evaluate(([x, y]) => { MK.tool(x); MK.jump(y); }, [t, s]);
      await p.waitForTimeout(120);
      screens++;
      const at = theme + ' ' + w, name = t + '-' + s, r = await p.evaluate(inspect), m = await p.evaluate(measure);
      if (s === 'busy') r.overlap = [];   // the reading box covers the page on purpose
      r.reach = await p.evaluate(reach); r.gap = await p.evaluate(gaps); r.cut = await p.evaluate(cut);
      Object.keys(m.fams).forEach((x) => fams.add(x)); Object.keys(m.weights).forEach((x) => weights.add(x));
      r.contrast = m.fails.map((x) => '"' + x.text.slice(0, 40) + '" ' + x.ratio);
      (await p.$$eval('[data-inv]', (l) => l.filter((e) => e.offsetParent || getComputedStyle(e).position === 'fixed').map((e) => e.dataset.inv))).forEach((x) => x.split(' ').forEach((y) => seen.add(y)));
      if (OUT) { fs.mkdirSync(OUT, { recursive: true }); await p.screenshot({ path: path.join(OUT, `${name}-${w}-${theme}.jpg`), type: 'jpeg', quality: 60 }); }
      if (w === SIZES[0] && s !== 'busy') r.focus = await focusCheck(p, 90);
      r.dismiss = await dismissCheck(p, null);
      Object.keys(r).forEach((k) => (r[k] || []).forEach((x) => add(name + '|' + k + '|' + x, at)));
      process.stdout.write('.');
    }
    await p.close();
  }
  await b.close();
  let missing = [], total = 0;
  if (INV) {
    const ids = fs.readFileSync(INV, 'utf8').split('\n').map((l) => /^\| ([A-Z]\d+) \|(.*)$/.exec(l.trim())).filter(Boolean).filter((x) => !/\| (Remove|[^|]*not drawn)[^|]*\|/i.test(x[2])).map((x) => x[1]);
    total = ids.length; missing = ids.filter((x) => !seen.has(x));
  }
  console.log('\n' + screens + ' screens checked; fonts ' + [...fams].join(', ') + '; weights ' + [...weights].sort().join(', ') + '; page errors ' + errs.length + (errs.length ? ' ' + [...new Set(errs)].join(' | ') : '') + '; outside requests ' + ext.size);
  if (INV) console.log('inventory: ' + (total - missing.length) + ' of ' + total + ' on a screen' + (missing.length ? '; missing ' + missing.join(', ') : ''));
  console.log(by.size + ' findings');
  [...by.entries()].sort().forEach(([k, at]) => { const [n, kind, ...x] = k.split('|'); console.log(`${n.padEnd(14)} ${kind.padEnd(9)} ${x.join('|').slice(0, 150)}  [${at.size === SIZES.length * THEMES.length ? 'all' : [...at].join(', ')}]`); });
  process.exitCode = by.size || missing.length || errs.length ? 1 : 0;
})();
