#!/usr/bin/env node
// Workload Modeller, existing behaviour against new behaviour: the same user actions on two versions of the page, what
// each one gives (the plan, the result text, tiles, checks, LRE settings, the Excel workbook, which fields are shown) and
// every difference listed. Run it before and after any change of the page.
//   node serve.js <old folder> 3993 ; node serve.js "" 3994         (see serve.js)
//   node behave.js http://localhost:3993/converter/workload-modeller http://localhost:3994/converter/workload-modeller [--dump=<dir>]
// Exit code 1 when something differs, a part stopped, or a part compared nothing.
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const ROOT = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(ROOT, 'cdp-recorder/recorder/node_modules/playwright-core'));
const JSZip = require(path.join(ROOT, 'node_modules/jszip')), ExcelJS = require(path.join(ROOT, 'node_modules/exceljs'));
const args = process.argv.slice(2), [OLD, NEW] = args.filter((a) => !a.startsWith('--'));
const DUMP = (args.find((a) => a.startsWith('--dump=')) || '').slice(7);

// two small script ZIPs (VuGen C and DevWeb) and a HAR recording — synthetic, example.com only
async function fixtures() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wm-behave-'));
  const c = new JSZip();
  c.file('Action.c', 'Action()\n{\n\tlr_start_transaction("T01_Home");\n\tweb_url("home", "URL=https://www.example.com/", LAST);\n\tlr_end_transaction("T01_Home", LR_AUTO);\n\tlr_think_time(5);\n\tlr_start_transaction("T02_Search");\n\tweb_url("s", "URL=https://www.example.com/search?q=a", LAST);\n\tweb_custom_request("api", "URL=https://api.example.com/items", "Method=GET", LAST);\n\tlr_end_transaction("T02_Search", LR_AUTO);\n\tlr_think_time(5);\n\treturn 0;\n}\n');
  c.file('vuser_init.c', 'vuser_init()\n{\n\treturn 0;\n}\n'); c.file('Shop.usr', '[General]\nType=QTWeb\n');
  fs.writeFileSync(path.join(dir, 'Shop.zip'), await c.generateAsync({ type: 'nodebuffer' }));
  const d = new JSZip();
  d.file('main.js', 'load.action("Action", async () => {\n  const t1 = new load.Transaction("T01_Login"); t1.start();\n  await new load.WebRequest({ url: "https://api.example.com/login", method: "POST" }).send();\n  t1.stop();\n  load.thinkTime(3);\n  const t2 = new load.Transaction("T02_Orders"); t2.start();\n  await new load.WebRequest({ url: "https://api.example.com/orders" }).send();\n  t2.stop();\n});\n');
  d.file('Orders.usr', '[General]\nType=DevWeb\n'); d.file('rts.yml', 'thinkTime:\n  type: asRecorded\n');
  fs.writeFileSync(path.join(dir, 'Orders.zip'), await d.generateAsync({ type: 'nodebuffer' }));
  return { dir, zips: [path.join(dir, 'Shop.zip'), path.join(dir, 'Orders.zip')], har: path.join(ROOT, 'regression-tests/tools/studio/fixtures/rich-shop.har') };
}

async function walk(b, url, w, h, fx) {
  const p = await b.newPage({ viewport: { width: w, height: h }, acceptDownloads: true }), out = {}, errs = [];
  p.on('pageerror', (e) => errs.push(e.message)); await p.route('**/analytics/track', (r) => r.fulfill({ status: 204 }));
  const is = (k, v) => { out[k] = typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : v; };
  const ev = (f, a) => p.evaluate(f, a), wait = (ms) => p.waitForTimeout(ms);
  const part = async (name, f) => { try { await f(); } catch (e) { out[name + ': stopped'] = e.message.split('\n')[0].slice(0, 200); } };
  // what the plan gives: the engine's result and what the page shows of it
  const snap = async (k) => {
    await wait(150);
    is(k + ': plan', await ev(() => { const r = last; if (!r) return 'none'; return JSON.stringify({ sc: state.scenario, peak: r.peakVusers, dur: Math.round(r.duration), tot: r.totals && { v: r.totals.vusers, tps: +r.totals.tps.toFixed(3), it: r.totals.iters }, groups: (r.groups || []).map((g) => [g.name, g.vusers, g.pacing && +(+g.pacing.mean).toFixed(3), +(g.tps || 0).toFixed(3)]), actions: r.actions, lgs: r.machines && r.machines.length }); }));
    for (const s of ['#summary', '#tiles', '#checks', '#phases', '#lre', '#sum-test', '#sum-result']) is(k + ': ' + s, await ev((s) => { const e = document.querySelector(s); return e ? e.textContent : 'missing'; }, s));
  };
  const shown = async (k) => is(k + ': fields shown', await ev(() => [...document.querySelectorAll('#inputs-col input, #inputs-col select, #inputs-col button')].filter((x) => x.offsetParent || x.closest('label.ds-btn')).map((x) => x.id || x.dataset.tt || x.dataset.clear || x.textContent.trim().slice(0, 20)).filter(Boolean).join(' ')));
  const excel = async (k) => {
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 20000 }), p.click('#btn-xlsx')]);
    const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(await d.path());
    const sheets = {}; wb.eachSheet((ws) => { const rows = []; ws.eachRow({ includeEmpty: false }, (r) => rows.push(JSON.stringify(r.values.map((v) => (v && typeof v === 'object' ? (v.result !== undefined ? v.result : v.text || v.richText && v.richText.map((x) => x.text).join('') || JSON.stringify(v)) : v))))); sheets[ws.name] = rows.join('\n'); });
    is(k + ': excel name', d.suggestedFilename().replace(/\d{4}-\d{2}-\d{2}/, 'DATE')); Object.keys(sheets).forEach((n) => is(k + ': excel ' + n, sheets[n].replace(/\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2})?/g, 'DATE').replace(/\d{4}-\d{2}-\d{2}/g, 'DATE')));
  };

  await p.goto(url); await ev(() => { try { localStorage.clear(); } catch (e) { /* none */ } }); await p.reload(); await ev(() => { document.documentElement.classList.add('embedded'); }); await wait(600);
  await part('start', async () => { await snap('start'); await shown('start'); is('test types', await ev(() => [...document.querySelectorAll('[data-tt]')].map((x) => x.dataset.tt + ' ' + x.querySelector('b').textContent).join(' · '))); });
  await part('example', async () => { await p.click('#btn-example'); await snap('example'); });
  await part('excel', async () => { await excel('excel'); });
  await part('layout', async () => {
    await p.click('#btn-hide-res'); is('results hidden', await ev(() => document.querySelector('.wm-page').classList.contains('res-hidden'))); await ev(() => document.getElementById('rail').click());
    await p.click('#btn-hide-in'); is('inputs hidden', await ev(() => document.querySelector('.wm-page').classList.contains('in-hidden'))); await ev(() => document.getElementById('rail-in').click());
    for (const t of ['per', 'lg', 'how', 'setup']) { await p.click('[role=tab][data-tab=' + t + ']'); await wait(80); is('tab ' + t, await ev(() => [...document.querySelectorAll('.wm-pane.on')].map((s) => s.id + ' ' + s.textContent.replace(/\s+/g, ' '))[0] || 'none')); }
  });
  for (const tt of ['load', 'soak', 'stress', 'capacity', 'spike']) await part('type ' + tt, async () => { await p.click('[data-tt=' + tt + ']'); await snap(tt); await shown(tt); });
  await part('stress schedules', async () => {
    await p.click('[data-tt=stress]');
    for (const wl of ['basic-scenario', 'basic-group', 'real-world', 'goal']) { await p.selectOption('#sc-workload', wl); await snap('stress ' + wl); }
    await p.selectOption('#sc-workload', 'real-world');
  });
  await part('detailed', async () => {
    await p.click('#v-detail'); await wait(150); await shown('detailed');
    await p.click('[data-tt=stress]'); if (await p.locator('[data-shape=steps]').count()) await p.click('[data-shape=steps]'); await p.fill('#sc-levels', '100, 150'); await p.dispatchEvent('#sc-levels', 'change'); await p.fill('#sc-hold', '20'); await p.dispatchEvent('#sc-hold', 'input'); await snap('stress 100,150 hold 20');
    await p.click('[data-tt=spike]'); await p.fill('#sc-hold', '5'); await p.dispatchEvent('#sc-hold', 'input'); await snap('spike hold 5');
    await p.click('[data-tt=load]'); await p.fill('#sc-steady', '90'); await p.dispatchEvent('#sc-steady', 'input'); await p.fill('#sc-growth', '1.5'); await p.dispatchEvent('#sc-growth', 'input'); await snap('load 90 min growth 1.5');
    await p.selectOption('#sc-ramp', 'own'); await p.fill('#sc-start-per', '2'); await p.dispatchEvent('#sc-start-per', 'input'); await p.fill('#sc-start-every', '10'); await p.dispatchEvent('#sc-start-every', 'input'); await snap('own ramp');
    await p.fill('#sc-licence', '50'); await p.dispatchEvent('#sc-licence', 'input'); await snap('licence 50');
    await p.click('#v-simple'); await wait(150); await shown('simple again');
  });
  await part('fill', async () => {
    await p.click('[data-clear=test]'); await wait(200); await snap('test reset');
    await p.setInputFiles('#in-fill', fx.zips.concat([fx.har])); await p.waitForFunction(() => state.groups.length >= 4, null, { timeout: 30000 }); await wait(800);
    is('fill: scripts', await ev(() => state.groups.map((g) => [g.name, g.protocol, g.txPerIter, g.thinkPerIter, g.requestsPerIter].join('/')).join(' | '))); await snap('filled');
    await p.click('[data-tt=stress]'); await snap('filled stress');
  });
  await part('table', async () => { await p.click('#sview [data-v=table]'); await wait(200); is('table rows', await ev(() => document.getElementById('tv') ? document.getElementById('tv').innerText : 'none')); await p.click('#sview [data-v=cards]'); });
  await part('clear', async () => {
    await p.click('[data-clear=scripts]'); await wait(200); await snap('scripts cleared'); is('undo offered', await ev(() => !document.getElementById('toast').hidden));
    await p.click('#toast-undo'); await wait(200); await snap('undone');
    await p.click('#btn-reset-all'); await wait(200); await snap('start over');
  });
  is('page errors', errs.join(' | '));
  await p.close(); return out;
}

(async () => {
  const b = await chromium.launch({ channel: 'msedge' }), fx = await fixtures(); let bad = 0, n = 0;
  for (const [w, h] of [[1366, 768], [1920, 1000]]) {
    const a = await walk(b, OLD, w, h, fx), c = await walk(b, NEW, w, h, fx);
    if (DUMP) { fs.mkdirSync(DUMP, { recursive: true }); fs.writeFileSync(path.join(DUMP, 'old-' + w + '.json'), JSON.stringify(a, null, 1)); fs.writeFileSync(path.join(DUMP, 'new-' + w + '.json'), JSON.stringify(c, null, 1)); }
    // a part that stopped compared nothing: a fault of this check (or of the page), never "no difference"
    for (const [o, v] of [['before', a], ['now', c]]) Object.keys(v).filter((k) => / stopped$/.test(k)).forEach((k) => { bad++; console.log(`${w}x${h}  ${o}: ${k} — ${v[k]}`); });
    for (const k of ['example: plan', 'filled: plan', 'fill: scripts', 'excel: excel name', 'table rows']) if (!c[k] || c[k] === 'none') { bad++; console.log(`${w}x${h}  empty, so nothing was compared: ${k}`); }
    for (const k of new Set([...Object.keys(a), ...Object.keys(c)])) { n++; if (JSON.stringify(a[k]) !== JSON.stringify(c[k])) { bad++; console.log(`${w}x${h}  ${k}\n    before: ${String(JSON.stringify(a[k])).slice(0, 700)}\n    now:    ${String(JSON.stringify(c[k])).slice(0, 700)}`); } }
  }
  fs.rmSync(fx.dir, { recursive: true, force: true });
  console.log(`${n} behaviours compared, ${bad} differ`);
  await b.close(); process.exit(bad ? 1 : 0);
})();
