#!/usr/bin/env node
// Results Analyser, existing behaviour against new behaviour: the same user actions on two versions of the page, and
// everything each one gives — every tab's text and tables, the charts (titles, series, points), the drawer, the
// settings (window, SLA, granularity), collapsing, every export file (Excel cells, Word text, HTML, JSON, the PDF
// page) — and how it looks: font, size, weight, colours, borders and size of every kind of element. Every difference
// is listed. Run it before and after any change of the page.
//   node serve.js <old folder> 3990 ; node serve.js "" 3991
//   node behave.js http://localhost:3990/converter/results-analyser http://localhost:3991/converter/results-analyser [--zip=<run.zip>] [--dump=<dir>] [--no-look]
// Exit code 1 when something differs, a part stopped, or a part compared nothing.
'use strict';
const path = require('path'), fs = require('fs');
const ROOT = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(ROOT, 'cdp-recorder/recorder/node_modules/playwright-core'));
const JSZip = require(path.join(ROOT, 'node_modules/jszip')), ExcelJS = require(path.join(ROOT, 'node_modules/exceljs'));
const args = process.argv.slice(2), [OLD, NEW] = args.filter((a) => !a.startsWith('--'));
const opt = (k) => (args.find((a) => a.startsWith('--' + k + '=')) || '').split('=').slice(1).join('=');
const ZIP = opt('zip') || path.join(__dirname, '../qa/demo-run.zip'), DUMP = opt('dump'), LOOK = !args.includes('--no-look');
const norm = (s) => String(s).replace(/\s+/g, ' ').replace(/\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z?/g, 'DATE').trim();

async function walk(b, url, w, h) {
  const ctx = await b.newContext({ viewport: { width: w, height: h }, acceptDownloads: true });
  const p = await ctx.newPage(), out = {}, errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  const is = (k, v) => { out[k] = typeof v === 'string' ? norm(v) : v; };
  const ev = (f, a) => p.evaluate(f, a), wait = (ms) => p.waitForTimeout(ms);
  const part = async (name, f) => { try { await f(); } catch (e) { out[name + ': stopped'] = e.message.split('\n')[0].slice(0, 200); } };
  const tab = async (t) => { await p.click(`#tabs [data-tab="${t}"]`); await wait(500); };
  // what a tab shows: its text, its cards (title, folded or not), its tables (rows × columns) and its charts (title, series, points)
  const panel = (k, t) => ev((t) => {
    const pn = document.getElementById('tab-' + t), txt = pn.innerText;
    const cards = [...pn.querySelectorAll('.card')].map((c) => (c.querySelector('.card-head') || c).textContent.trim().slice(0, 60) + (c.classList.contains('collapsed') ? ' [folded]' : ''));
    const tables = [...pn.querySelectorAll('table')].map((x) => x.rows.length + '×' + (x.rows[0] ? x.rows[0].cells.length : 0));
    const charts = [...pn.querySelectorAll('.chart, [data-chart] .chart, #ov-load')].map((el) => { const c = window.echarts && echarts.getInstanceByDom(el); if (!c) return 'no chart'; const o = c.getOption(); return (o.series || []).map((s) => (s.name || s.type) + ':' + (Array.isArray(s.data) ? s.data.length : 0)).join(','); });
    return { txt, cards, tables, charts };
  }, t).then((r) => { is(k + ': text', r.txt); is(k + ': cards', r.cards.join(' | ')); is(k + ': tables', r.tables.join(' ')); is(k + ': charts', r.charts.join(' | ')); });
  // how it looks: the computed style of the first element of each kind
  const LOOKS = ['.ra-header', '.head-card', '.run-name', '.run-sub', '.verdict', '#settings-chips .pill, #settings-chips > *', '#btn-settings', '[data-export="xlsx"]', '#btn-more', '#btn-explain', '#btn-new', '#tabs', '#tabs [data-tab].active', '#tabs [data-tab]:not(.active)', '#tabs .count', '.panel.active', '.panel.active .card', '.panel.active .card-head', '.panel.active .card-body', '.panel.active .explain', '.panel.active .explain summary', '.panel.active .kpi', '.panel.active .kpi .v', '.panel.active .hero-card', '.panel.active table.t', '.panel.active table.t th', '.panel.active table.t td', '.panel.active .panel-tools .btn', '.panel.active .seg', '.panel.active .seg button.on', '.panel.active .seg button:not(.on)', '.panel.active .finding', '.panel.active .finding .go', '.panel.active .pill', '.panel.active input', '.panel.active .tx-picker', '.panel.active .btn', '.panel.active .chart'];
  const look = async (k) => { if (!LOOKS) return; is(k + ': look', await ev((L) => L.map((s) => { const e = document.querySelector(s); if (!e || !e.getClientRects().length) return s + ' —'; const c = getComputedStyle(e), r = e.getBoundingClientRect(); return s + ' ' + [c.fontFamily.split(',')[0], c.fontSize, c.fontWeight, c.color, c.backgroundColor, c.borderTopWidth + ' ' + c.borderTopStyle + ' ' + c.borderTopColor, c.borderRadius, c.padding, Math.round(r.width) + 'x' + Math.round(r.height)].join(' / '); }).join('\n'), LOOKS)); };
  // an export button in sight is clicked; one inside the menu: the menu opens first (any version of the page)
  const download = async (sel) => { if (!(await p.locator(sel).isVisible())) { await p.click('#btn-more'); await wait(150); } const [d] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), p.click(sel)]); return { name: d.suggestedFilename(), file: await d.path() }; };

  await p.goto(url); await ev(() => { try { localStorage.clear(); } catch (e) { /* none */ } document.documentElement.setAttribute('data-theme', 'light'); }); await p.reload(); await ev(() => { document.documentElement.classList.add('embedded'); document.documentElement.setAttribute('data-theme', 'light'); }); await wait(500);
  await part('start', async () => { is('start: text', await ev(() => document.getElementById('view-start').innerText)); if (LOOK) is('start: look', await ev(() => ['#drop', '.pick-card', '.start-card', '.info h3'].map((s) => { const e = document.querySelector(s), c = getComputedStyle(e), r = e.getBoundingClientRect(); return s + ' ' + [c.fontSize, c.fontWeight, c.backgroundColor, c.borderTopWidth + ' ' + c.borderTopStyle, Math.round(r.width) + 'x' + Math.round(r.height)].join(' / '); }).join('\n'))); });
  await p.setInputFiles('#in-zip', ZIP); await p.waitForSelector('#view-results.active', { timeout: 120000 }); await wait(2500);
  await part('header', async () => {
    is('header: text', await ev(() => document.querySelector('.head-card').innerText));
    is('header: buttons', await ev(() => [...document.querySelectorAll('.head-card button')].filter((x) => x.getClientRects().length).map((x) => x.textContent.trim() || x.getAttribute('aria-label')).join(' · ')));
  });
  for (const t of ['overview', 'transactions', 'charts', 'errors', 'workload', 'insights']) await part('tab ' + t, async () => { await tab(t); await panel(t, t); if (LOOK) await look(t); });
  // overview links
  await part('overview links', async () => {
    await tab('overview'); await p.click('.hero-actions [data-goto]'); await wait(300); is('All findings opens', await ev(() => document.querySelector('#tabs [data-tab].active').dataset.tab));
    await tab('overview'); const n = await p.locator('.hero-actions [data-goto]').count(); if (n > 1) { await p.locator('.hero-actions [data-goto]').nth(1).click(); await wait(300); is('second hero button opens', await ev(() => document.querySelector('#tabs [data-tab].active').dataset.tab)); }
    await tab('overview'); await p.click('#tab-overview tr.click'); await wait(800); is('overview row: drawer', await ev(() => document.getElementById('drawer-title').textContent)); await p.keyboard.press('Escape'); await wait(200); is('Esc closes the drawer', await ev(() => document.getElementById('drawer').hidden));
  });
  // collapsing: one card, all, remembered across tabs
  await part('collapse', async () => {
    await tab('overview'); const h = p.locator('#tab-overview .card .card-head').first(); await h.click(); await wait(150);
    is('one card folded', await ev(() => [...document.querySelectorAll('#tab-overview .card')].map((c) => c.classList.contains('collapsed')).join(',')));
    await tab('charts'); await tab('overview'); is('… kept after another tab', await ev(() => document.querySelector('#tab-overview .card').classList.contains('collapsed')));
    await h.press('Enter'); await wait(100); is('Enter unfolds it', await ev(() => !document.querySelector('#tab-overview .card').classList.contains('collapsed')));
    await p.click('#tab-overview [data-ca=collapse]'); await wait(150); is('Collapse all', await ev(() => [...document.querySelectorAll('#tab-overview .card[data-enh]')].every((c) => c.classList.contains('collapsed'))));
    await p.click('#tab-overview [data-ca=expand]'); await wait(300); is('Expand all', await ev(() => [...document.querySelectorAll('#tab-overview .card[data-enh]')].every((c) => !c.classList.contains('collapsed'))));
  });
  // transactions: views, filter, sort, SLA, drawer
  await part('transactions', async () => {
    await tab('transactions');
    await p.click('#tab-transactions .seg [data-v=full]'); await wait(300); await panel('tx full run', 'transactions');
    await p.click('#tab-transactions .seg [data-v=steady]'); await wait(300);
    await p.fill('#tx-filter', 'SEARCH'); await wait(600); is('tx filter rows', await ev(() => document.querySelectorAll('#tx-table tbody tr').length)); await p.fill('#tx-filter', ''); await wait(600);
    await p.click('#tx-table th[data-k=avg], #tx-table th.sortable:nth-child(7)'); await wait(300); is('sorted', await ev(() => [...document.querySelectorAll('#tx-table tbody tr td:first-child')].map((x) => x.textContent).join(',')));
    await p.click('#tx-table th[data-k=avg], #tx-table th.sortable:nth-child(7)'); await wait(300); await p.click('#tx-table th[data-k=avg], #tx-table th.sortable:nth-child(7)'); await wait(300);
    await p.click('#tx-table tbody tr.click'); await wait(1200); is('drawer: title', await ev(() => document.getElementById('drawer-title').textContent + ' | ' + document.getElementById('drawer-sub').textContent));
    is('drawer: text', await ev(() => document.getElementById('drawer-body').innerText)); is('drawer: charts', await ev(() => [...document.querySelectorAll('#drawer .chart')].map((el) => { const c = echarts.getInstanceByDom(el); return c ? (c.getOption().series || []).map((s) => s.name + ':' + (s.data || []).length).join(',') : 'no chart'; }).join(' | ')));
    if (LOOK) is('drawer: look', await ev(() => ['#drawer', '.drawer-head', '#drawer .card', '#drawer .kpi, #drawer .ds-tile'].map((s) => { const e = document.querySelector(s); if (!e) return s + ' —'; const c = getComputedStyle(e), r = e.getBoundingClientRect(); return s + ' ' + [c.fontSize, c.backgroundColor, c.borderTopWidth + ' ' + c.borderTopStyle, Math.round(r.width) + 'x' + Math.round(r.height)].join(' / '); }).join('\n')));
    await p.click('#drawer-close'); await wait(300);
  });
  // the SLA per transaction and by default, the window, the granularity
  await part('settings', async () => {
    await tab('transactions');
    // the SLA boxes: in sight at once, or after "Set SLAs" (any version of the page)
    if (!(await p.locator('#tx-table input.in-sla').count())) { await p.click('#tx-sla-edit'); await wait(300); }
    is('SLA boxes', await ev(() => [...document.querySelectorAll('#tx-table input.in-sla')].map((x) => x.dataset.tx).join(',')));
    const sla = p.locator('#tx-table input.in-sla').first(); await sla.fill('0.5'); await sla.press('Enter'); await sla.dispatchEvent('change'); await wait(1500);
    await panel('tx with one SLA', 'transactions'); is('chips with one SLA', await ev(() => document.getElementById('settings-chips').innerText));
    await tab('overview'); await panel('overview with one SLA', 'overview');
    await p.click('#btn-settings'); await wait(200); is('settings: text', await ev(() => document.getElementById('settings-bar').innerText));
    await p.fill('#sla-default', '2'); await p.click('#sla-apply'); await wait(1500); is('chips with default SLA', await ev(() => document.getElementById('settings-chips').innerText));
    await tab('transactions'); await panel('tx with default SLA', 'transactions'); await tab('insights'); await panel('insights with SLA', 'insights');
    const st = await p.inputValue('#win-start'), en = await p.inputValue('#win-end');
    const mid = await ev(([a, b]) => { const s = new Date(a).getTime(), e = new Date(b).getTime(), x = new Date(s + (e - s) / 4), y = new Date(s + (e - s) / 2), f = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 19); return [f(x), f(y)]; }, [st, en]);
    await p.fill('#win-start', mid[0]); await p.fill('#win-end', mid[1]); await p.click('#win-apply'); await wait(2000);
    is('chips with a window', await ev(() => document.getElementById('settings-chips').innerText)); await tab('overview'); await panel('overview with a window', 'overview'); await tab('transactions'); await panel('tx with a window', 'transactions');
    await p.click('#win-reset'); await wait(2000); is('window reset', await ev(() => document.getElementById('settings-chips').innerText));
    const aggs = await ev(() => [...document.querySelectorAll('#agg option')].map((o) => o.value)), aggOn = await p.locator('#agg').isVisible();
    is('granularity shown', aggOn);
    if (aggOn && aggs.length > 1) { await p.selectOption('#agg', aggs[aggs.length > 2 ? 2 : 1]); await wait(4000); is('granularity: chips', await ev(() => document.getElementById('settings-chips').innerText)); await tab('transactions'); await panel('tx with granularity', 'transactions'); await p.selectOption('#agg', aggs[0]); await wait(4000); }
    if (aggOn) { await p.click('#agg-help-btn'); is('granularity help', await ev(() => !document.getElementById('agg-help').hidden)); await p.click('#agg-help-btn'); }
    await p.click('#btn-settings'); await wait(200); is('settings closed', await ev(() => document.getElementById('settings-bar').hidden));
  });
  // charts: the metric, the picker
  await part('charts', async () => {
    await tab('charts');
    for (const m of ['avg', 'p99', 'max', 'p90']) { await p.click(`#metric [data-m=${m}]`); await wait(400); is('metric ' + m, await ev(() => [...document.querySelectorAll('#tab-charts .card-head')].map((h) => h.textContent.trim()).join(' | ') + ' :: ' + [...document.querySelectorAll('#tab-charts .chart')].slice(0, 3).map((el) => { const c = echarts.getInstanceByDom(el); return c ? (c.getOption().series || []).map((s) => s.name).join(',') : '-'; }).join(' | '))); }
    for (const s of ['slow', 'busy', 'all', 'none']) { await p.click(`.tx-picker [data-sel=${s}]`); await wait(500); is('picker ' + s, await ev(() => [...document.querySelectorAll('.tx-picker input:checked')].map((x) => x.value).join(','))); }
    await p.click('.tx-picker [data-sel=slow]'); await wait(400);
  });
  await part('errors and workload', async () => {
    await tab('errors'); const f = p.locator('#tab-errors input[type=search], #tab-errors input').first(); if (await f.count()) { await f.fill('500'); await wait(600); is('error search', await ev(() => document.getElementById('tab-errors').innerText.length)); await f.fill(''); await wait(400); }
    await tab('workload'); const lg = p.locator('#tab-workload tr.click, #tab-workload [data-lg]').first(); if (await lg.count()) { await lg.click(); await wait(1000); is('LG drawer', await ev(() => document.getElementById('drawer-title').textContent + ' | ' + document.getElementById('drawer-body').innerText)); await p.keyboard.press('Escape'); await wait(200); }
  });
  await part('insights links', async () => { await tab('insights'); await p.locator('#tab-insights .finding .go').first().click(); await wait(800); is('Show chart opens', await ev(() => document.querySelector('#tabs [data-tab].active').dataset.tab)); });
  await part('explanations', async () => { await p.click('#btn-explain'); await wait(150); is('explanations off', await ev(() => document.body.classList.contains('no-explain') + ' ' + document.getElementById('btn-explain').textContent.trim())); await p.click('#btn-explain'); await wait(150); });
  // the exports
  await part('exports', async () => {
    const x = await download('[data-export=xlsx]'); const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(x.file);
    is('excel name', x.name); wb.eachSheet((ws) => { const rows = []; ws.eachRow({ includeEmpty: false }, (r) => rows.push(JSON.stringify(r.values.map((v) => (v && typeof v === 'object' ? (v.result !== undefined ? v.result : v.text || (v.richText && v.richText.map((y) => y.text).join('')) || '') : v))))); is('excel ' + ws.name, rows.join('\n')); });
    const d = await download('[data-export=docx]'); const dz = await JSZip.loadAsync(fs.readFileSync(d.file)); is('word name', d.name); is('word text', (await dz.file('word/document.xml').async('string')).replace(/<w:p[ >]/g, '\n<w:p ').replace(/<[^>]+>/g, '')); is('word files', Object.keys(dz.files).filter((f) => !/media\//.test(f)).sort().join(' '));
    const hh = await download('[data-export=html]'); is('html name', hh.name); is('html text', fs.readFileSync(hh.file, 'utf8').replace(/<svg[\s\S]*?<\/svg>/g, '[chart]').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' '));
    const j = await download('[data-export=json]'); is('json name', j.name); is('json', JSON.stringify(JSON.parse(fs.readFileSync(j.file, 'utf8'), (k, v) => (/generated|exportedAt|createdAt/i.test(k) ? 'DATE' : v))));
    const jr = await download('[data-export=json-redacted]'); is('json redacted name', jr.name); is('json redacted', JSON.stringify(JSON.parse(fs.readFileSync(jr.file, 'utf8'), (k, v) => (/generated|exportedAt|createdAt/i.test(k) ? 'DATE' : v))));
    if (!(await p.locator('[data-export=pdf]').isVisible())) { await p.click('#btn-more'); await wait(150); }
    const [pop] = await Promise.all([ctx.waitForEvent('page', { timeout: 30000 }), p.click('[data-export=pdf]')]); await pop.waitForLoadState(); await pop.evaluate(() => { window.print = () => {}; }); await wait(800);
    is('pdf page', (await pop.content()).replace(/<svg[\s\S]*?<\/svg>/g, '[chart]').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<[^>]+>/g, ' ')); await pop.close();
  });
  await part('new analysis', async () => { await p.click('#btn-new'); await wait(500); is('New analysis: the start page', await ev(() => document.getElementById('view-start').classList.contains('active'))); });
  is('page errors', errs.join(' | '));
  await ctx.close(); return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'msedge' }); let bad = 0, n = 0;
  for (const [w, h] of [[1366, 768], [1920, 1080]]) {
    const a = await walk(b, OLD, w, h), c = await walk(b, NEW, w, h);
    if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, 'old-' + w + '.json'), JSON.stringify(a, null, 1)); fs.writeFileSync(path.join(DUMP, 'new-' + w + '.json'), JSON.stringify(c, null, 1)); }
    for (const [o, v] of [['before', a], ['now', c]]) Object.keys(v).filter((k) => / stopped$/.test(k)).forEach((k) => { bad++; console.log(`${w}x${h}  ${o}: ${k} — ${v[k]}`); });
    for (const k of ['overview: text', 'transactions: tables', 'charts: charts', 'drawer: text', 'excel name', 'word text', 'html text', 'json', 'pdf page', 'tx with default SLA: text']) if (!c[k] || c[k] === 'none') { bad++; console.log(`${w}x${h}  empty, so nothing was compared: ${k}`); }
    for (const k of new Set([...Object.keys(a), ...Object.keys(c)])) { n++; if (JSON.stringify(a[k]) !== JSON.stringify(c[k])) { bad++; console.log(`${w}x${h}  ${k}\n    before: ${String(JSON.stringify(a[k])).slice(0, 600)}\n    now:    ${String(JSON.stringify(c[k])).slice(0, 600)}`); } }
  }
  console.log(`${n} behaviours compared, ${bad} differ`);
  await b.close(); process.exit(bad ? 1 : 0);
})();
