// Cross-section design audit: fonts, weights, text contrast, cards, buttons — every portal section, both themes.
//   node audit.js [outDir]
'use strict';
const { chromium } = require(require('path').resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const path = require('path'), fs = require('fs');
const OUT = process.argv[2] || path.join(__dirname, 'run');
fs.mkdirSync(OUT, { recursive: true });
const BASE = 'http://localhost:3999/converter/';
const FX = require('path').resolve(__dirname, '../').replace(/\\/g, '/') + '/';
const COL = require('path').resolve(__dirname, '../../../collection-examples').replace(/\\/g, '/') + '/';

// runs inside a document: measure every visible text element
function measure() {
  const parse = (c) => {
    const s = c.match(/color\(srgb ([^)]+)\)/);
    if (s) { const q = s[1].split(/[ /]+/).filter(Boolean).map(Number); return { r: q[0] * 255, g: q[1] * 255, b: q[2] * 255, a: q.length > 3 ? q[3] : 1 }; }
    const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a), g: top.g * top.a + bot.g * (1 - top.a), b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  function bgOf(el) {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) layers.push(c);
      if (c && c.a >= 1) break;
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && /gradient/.test(cs.backgroundImage)) { const g = parse(cs.backgroundImage); if (g) { layers.push(g); if (g.a >= 1) break; } }
    }
    let base = document.documentElement.getAttribute('data-theme') === 'light' ? { r: 255, g: 255, b: 255, a: 1 } : { r: 6, g: 11, b: 21, a: 1 };
    for (let i = layers.length - 1; i >= 0; i--) base = over(layers[i], base);
    return base;
  }
  const visible = (el) => { const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(el); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && r.bottom > 0 && r.top < innerHeight * 3; };
  const fams = {}, weights = {}, sizes = {}, fails = [];
  const els = [...document.querySelectorAll('body *')].filter((el) => [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim().length > 1) && visible(el) && !el.closest('svg, script, style, noscript, code, pre, .rc-code, #code-body'));
  for (const el of els) {
    const cs = getComputedStyle(el);
    const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim();
    fams[fam] = (fams[fam] || 0) + 1; weights[cs.fontWeight] = (weights[cs.fontWeight] || 0) + 1;
    const fs = Math.round(parseFloat(cs.fontSize)); sizes[fs] = (sizes[fs] || 0) + 1;
    let op = 1; for (let e = el; e; e = e.parentElement) op *= +getComputedStyle(e).opacity;
    if (parseFloat(cs.fontSize) === 0) continue;   // zero-size text draws nothing (e.g. an emoji replaced by a CSS icon)
    const fg = parse(cs.color); if (!fg) continue;
    const bg = bgOf(el); const fgc = over({ ...fg, a: fg.a * op }, bg);
    const L1 = lum(fgc), L2 = lum(bg); const ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const large = fs >= 24 || (fs >= 19 && +cs.fontWeight >= 700);
    const disabled = el.closest('[disabled], :disabled, .dim, tr.dim, .rc-why, [aria-disabled="true"]');
    if (ratio < (large ? 3 : 4.5) && !disabled) fails.push({ text: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue.trim()).join(' ').slice(0, 50), ratio: +ratio.toFixed(2), cls: (el.className && el.className.baseVal === undefined ? el.className : '').toString().slice(0, 40), tag: el.tagName.toLowerCase(), fs });
  }
  // cards / panels and buttons
  const pick = (sel) => [...document.querySelectorAll(sel)].filter(visible).slice(0, 3).map((e) => { const cs = getComputedStyle(e); return { sel, radius: cs.borderTopLeftRadius, border: cs.borderTopColor + ' ' + cs.borderTopWidth, bg: cs.backgroundColor }; });
  const cards = pick('.hm-card, .card, .rc-card, .rc-pane, .rc-sum, .ss-card, .adv-panel, .corr-panel, .pick-card, .kpi, .help-acc-item, .result-box, .rc-actions, .rc-filters, .stat');
  const btn = (sel) => [...document.querySelectorAll(sel)].filter(visible).slice(0, 2).map((e) => { const cs = getComputedStyle(e); return { sel, bg: cs.backgroundColor, color: cs.color, radius: cs.borderTopLeftRadius, h: Math.round(e.getBoundingClientRect().height), fw: cs.fontWeight, fs: cs.fontSize }; });
  const buttons = [...btn('.hm-btn'), ...btn('.btn-convert'), ...btn('.rc-btn:not(.ghost)'), ...btn('.btn-analyze'), ...btn('.ss-btn'), ...btn('.btn-dl'), ...btn('#ph-res > .dl-bar .btn'), ...btn('.help-mini'), ...btn('.rc-btn.ghost'), ...btn('.btn-primary, .btn.primary, button.primary')];
  const bodyCs = getComputedStyle(document.body);
  return { fams, weights, sizes, fails, cards, buttons, bodyBg: bodyCs.backgroundColor, bodyFont: bodyCs.fontFamily.split(',')[0], textCount: els.length };
}

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const report = {};
  for (const theme of ['dark', 'light']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    const errs = [], ext = [];
    p.on('pageerror', (e) => errs.push(e.message));
    p.on('request', (r) => { if (!/localhost/.test(r.url()) && !/^data:/.test(r.url())) ext.push(r.url()); });
    await p.goto(BASE); await p.waitForLoadState('networkidle');
    await p.evaluate((t) => { if (document.documentElement.getAttribute('data-theme') !== t) document.getElementById('tb-theme').click(); }, theme);
    await p.waitForTimeout(300);
    const frameOf = async (id) => { const h = await p.$('#iframe-' + id); return h.contentFrame(); };
    const run = async (name, target) => {
      await p.waitForTimeout(500);
      const shell = await p.evaluate(measure);
      const inner = target ? await (await frameOf(target)).evaluate(measure) : null;
      report[theme + ' · ' + name] = { shell, inner };
      await p.screenshot({ path: path.join(OUT, `${theme}-${name.replace(/\W+/g, '-')}.png`) });
    };
    const go = (pg) => p.evaluate((x) => PerfxShell.go(x, { instant: true }), pg);
    let f;
    await go('home'); await run('Home');
    await go('postman'); await run('Postman');
    await p.setInputFiles('#fi-col', COL + 'postman_collection.json'); await p.click('#btn-cvt');
    await p.waitForSelector('#res-ok', { state: 'visible', timeout: 60000 }); await run('Postman result');
    await go('jmeter'); await run('JMeter');
    await go('record'); await p.waitForFunction(() => { const w = document.getElementById('iframe-recorder').contentWindow; return w && w.JSZip; }, null, { timeout: 20000 });
    await run('Recorder start', 'recorder');
    f = await frameOf('recorder');
    await f.setInputFiles('#hf', FX + 'recorder/fixtures/bookmarklet-markers.har'); await f.click('#fmt-go'); await f.waitForSelector('#main:not([hidden])');
    await run('Recorder workspace', 'recorder');
    await go('explore'); await p.waitForFunction(() => { const d = document.getElementById('iframe-explorer').contentDocument; return d && d.getElementById('hx-file'); }, null, { timeout: 20000 });
    await run('Explorer start', 'explorer');
    f = await frameOf('explorer'); await f.setInputFiles('#hx-file', require('path').resolve(__dirname, '../../../collection-examples').replace(/\\/g, '/') + '/' + 'WebTours.har'); await f.waitForSelector('#hx-ws:not([hidden])');
    await f.click('.hx-req >> nth=4'); await f.click('.hx-tab[data-tab="payload"]').catch(() => {});
    await run('Explorer workspace', 'explorer');
    await f.click('#hx-findbtn'); await f.waitForSelector('.hx-sugg button', { timeout: 30000 }); await f.click('.hx-sugg button >> nth=0'); await f.waitForSelector('.hx-verdict', { timeout: 30000 });
    await run('Explorer find', 'explorer');
    await go('studio'); await p.waitForFunction(() => { const w = document.getElementById('iframe-studio').contentWindow; return w && w.document.readyState === 'complete' && typeof w.loadFile === 'function'; }, null, { timeout: 20000 });
    await run('Studio start', 'studio');
    f = await frameOf('studio');
    await f.setInputFiles('#dz1 input[type=file]', FX + 'studio/fixtures/api-tokens.har'); await p.waitForTimeout(400); await f.click('#btn-analyze');
    await f.waitForSelector('#ph-res.active', { timeout: 60000 }); await p.waitForTimeout(800);
    if (await f.isVisible('.bg-review-apply')) { await f.click('.bg-review-apply'); await p.waitForTimeout(1200); }
    await run('Studio results', 'studio');
    await go('results'); await p.waitForFunction(() => { const d = document.getElementById('iframe-analyser').contentDocument; return d && d.getElementById('in-zip'); }, null, { timeout: 20000 });
    await run('Analyser start', 'analyser');
    f = await frameOf('analyser'); await f.setInputFiles('#in-zip', FX + 'qa/demo-run.zip'); await p.waitForTimeout(9000);
    await run('Analyser report', 'analyser');
    await go('help'); await run('Help');
    report[theme + ' · _meta'] = { errors: errs, external: [...new Set(ext)] };
    await p.close();
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  // summary
  const lines = [];
  for (const [k, v] of Object.entries(report)) {
    if (k.endsWith('_meta')) { lines.push(`${k}: page errors ${v.errors.length}${v.errors.length ? ' ' + v.errors.join(' | ') : ''}; external requests ${v.external.length}${v.external.length ? ' ' + v.external.join(', ') : ''}`); continue; }
    for (const part of ['shell', 'inner']) {
      const m = v[part]; if (!m) continue;
      const fams = Object.entries(m.fams).sort((a, b) => b[1] - a[1]).map(([f, n]) => `${f}(${n})`).join(' ');
      const w = Object.keys(m.weights).sort().join('/');
      lines.push(`${k}${part === 'inner' ? ' [tool frame]' : ' [portal]'}: bg ${m.bodyBg} | fonts ${fams} | weights ${w} | contrast fails ${m.fails.length}`);
    }
  }
  console.log(lines.join('\n'));
})().catch((e) => { console.error(e); process.exit(1); });
