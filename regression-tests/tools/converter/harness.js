#!/usr/bin/env node
// Converter golden-output harness: drives the Postman/Bruno and JMeter panels of the portal through
// the real form controls and the page's own setters; captures the request the page sends, the
// server's answer, the result panel text, alerts and the ZIP contents.
//   node harness.js <portalUrl> <outDir> [--only=substr]
'use strict';
const { chromium } = require(require('path').resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const JSZip = require(require('path').resolve(__dirname, '../../../node_modules/jszip'));
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const [BASE, OUT] = args.filter(a => !a.startsWith('--'));
const ONLY = (args.find(a => a.startsWith('--only=')) || '').slice(7);
const R = require('path').resolve(__dirname, '../../../collection-examples').replace(/\\/g, '/') + '/';
const I = path.join(__dirname, 'inputs') + '/';

function norm(s) {
  return String(s)
    .replace(/\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z?/g, '<TS>')
    .replace(/\b\d{1,2}\/\d{1,2}\/\d{4},? \d{1,2}:\d\d(:\d\d)?\s?(AM|PM)?/gi, '<TS>')
    .replace(/lr-([a-z-]+?)-\d{6,}/g, 'lr-$1-<N>')
    .replace(/"examplesPath": "[^"]*"/g, '"examplesPath": "<P>"')
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    .replace(/\/download\/[A-Za-z0-9_-]+/g, '/download/<TOKEN>')
    .replace(/C:\\\\Users\\\\[^"]*?\\\\Temp\\\\/g, '<TMP>\\\\');
}
function w(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }

const PM = [
  ['postman', R + 'postman_collection.json', R + 'postman_environment.json'],
  ['advanced', R + 'advanced_enterprise_postman_collection.json', R + 'advanced_enterprise_environment.json'],
  ['jwt-ps256', R + 'jwt_ps256_20api_collection.json', R + 'jwt_ps256_environment.json'],
  ['bruno-yaml', R + 'Salesforce Platform APIs.yml', null],
  ['salesforce-json', R + 'Salesforce_Platform_APIs.postman_collection.json', null],
];
const RUNS = [];
for (const [n, col, env] of PM) for (const proto of ['devweb', 'web-http']) for (const mode of ['single', 'multi'])
  RUNS.push({ id: `pm-${n}-${proto}-${mode}`, kind: 'pm', col, env, proto, mode });
const base = { kind: 'pm', col: R + 'postman_collection.json', env: R + 'postman_environment.json', proto: 'devweb', mode: 'single' };
RUNS.push({ ...base, id: 'pm-opt-tt3', tt: 3 }, { ...base, id: 'pm-opt-tt5-webhttp', tt: 5, proto: 'web-http' }, { ...base, id: 'pm-opt-debug', ll: 'debug' });
for (const o of ['opt-corr', 'opt-param', 'opt-auth', 'opt-cmt']) RUNS.push({ ...base, id: 'pm-off-' + o, off: [o] }, { ...base, id: 'pm-off-' + o + '-webhttp', proto: 'web-http', off: [o] });
RUNS.push({ ...base, id: 'pm-all-off', off: ['opt-corr', 'opt-param', 'opt-auth', 'opt-cmt'] });
RUNS.push({ ...base, id: 'pm-cert', certs: [I + 'client.pem'] });
RUNS.push({ id: 'pm-err-nofile', kind: 'pm', col: null, proto: 'devweb', mode: 'single' });
RUNS.push({ id: 'pm-err-invalid', kind: 'pm', col: I + 'invalid.json', proto: 'devweb', mode: 'single' });
RUNS.push({ id: 'pm-err-empty', kind: 'pm', col: I + 'empty-collection.json', proto: 'devweb', mode: 'single' });
RUNS.push({ id: 'pm-err-txt', kind: 'pm', col: I + 'notes.txt', proto: 'web-http', mode: 'single' });
for (const n of ['simple', 'rich', 'setup-teardown']) for (const proto of ['devweb', 'web-http']) for (const mode of ['single', 'multi']) for (const wlm of [true, false])
  RUNS.push({ id: `jmx-${n}-${proto}-${mode}-${wlm ? 'wlm' : 'nowlm'}`, kind: 'jmx', jmx: I + n + '.jmx', proto, mode, wlm });
RUNS.push({ id: 'jmx-rich-csv-cert', kind: 'jmx', jmx: I + 'rich.jmx', proto: 'devweb', mode: 'single', wlm: true, csv: [I + 'users.csv'], certs: [I + 'client.pem'] });
RUNS.push({ id: 'jmx-rich-tt3-webhttp', kind: 'jmx', jmx: I + 'rich.jmx', proto: 'web-http', mode: 'multi', wlm: true, tt: 3 });
RUNS.push({ id: 'jmx-err-nofile', kind: 'jmx', jmx: null, proto: 'devweb', mode: 'single', wlm: true });
RUNS.push({ id: 'jmx-err-broken', kind: 'jmx', jmx: I + 'broken.jmx', proto: 'devweb', mode: 'single', wlm: true });

async function zipText(buf) {
  const z = await JSZip.loadAsync(buf), out = {};
  for (const n of Object.keys(z.files).sort()) {
    const f = z.files[n]; if (f.dir) continue;
    if (/\.xlsx$/i.test(n)) {
      const x = await JSZip.loadAsync(await f.async('nodebuffer'));
      for (const p of Object.keys(x.files).sort()) if (!x.files[p].dir && !/docProps\/core\.xml$/.test(p)) out[n + '!' + p] = await x.files[p].async('string');
    } else out[n] = norm(await f.async('string'));
  }
  return out;
}
function parseMultipart(buf, ct) {
  const b = (ct.match(/boundary=([^;]+)/) || [])[1]; if (!b) return { raw: norm(buf.toString('latin1')) };
  const parts = buf.toString('latin1').split('--' + b).slice(1, -1);
  return parts.map(p => {
    const [head, ...rest] = p.split('\r\n\r\n'); const body = rest.join('\r\n\r\n').replace(/\r\n$/, '');
    const name = (head.match(/name="([^"]*)"/) || [])[1], file = (head.match(/filename="([^"]*)"/) || [])[1];
    return file !== undefined ? { name, file, size: Buffer.byteLength(body, 'latin1') } : { name, value: body };
  });
}

async function run(browser, r) {
  // each run is its own client for the server's rate limiter (60 conversions / 5 min / address); 192.0.2.x = documentation range
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, timezoneId: 'UTC', locale: 'en-GB', extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.' + (1 + RUNS.indexOf(r)) } });
  const errors = [], alerts = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  page.on('dialog', d => { alerts.push(d.message()); d.accept(); });
  let request = null;
  page.on('request', q => { if (/\/convert(-jmx)?$/.test(q.url()) && q.method() === 'POST') request = { url: q.url().replace(/^https?:\/\/[^/]+/, ''), fields: parseMultipart(q.postDataBuffer() || Buffer.alloc(0), q.headers()['content-type'] || '') }; });
  await page.goto(BASE); await page.waitForLoadState('networkidle');
  await page.evaluate(k => openConverterTab(k), r.kind === 'jmx' ? 'jmx' : 'bruno');
  let response = null;
  const respP = page.waitForResponse(x => /\/convert(-jmx)?$/.test(x.url()), { timeout: 90000 }).then(async x => { response = { status: x.status(), body: await x.json().catch(() => null) }; }).catch(() => {});
  if (r.kind === 'pm') {
    if (r.proto) await page.evaluate(p => setProto(p), r.proto);
    await page.evaluate(m => setMode(m), r.mode);
    if (r.tt) await page.evaluate(t => setTT(t), r.tt);
    if (r.ll) await page.evaluate(l => setLL(l), r.ll);
    if (r.off) { await page.click('#adv-btn'); for (const id of r.off) await page.click(`label.switch:has(#${id})`); }
    if (r.col) await page.setInputFiles('#fi-col', r.col);
    if (r.env) await page.setInputFiles('#fi-env', r.env);
    if (r.certs) await page.setInputFiles('#fi-bru-cert', r.certs);
    await page.click('#btn-cvt');
  } else {
    await page.evaluate(p => setJmxProto(p), r.proto);
    await page.evaluate(m => setJmxMode(m), r.mode);
    await page.evaluate(v => setJmxWlm(v), r.wlm);
    if (r.tt) await page.evaluate(t => setJmxTT(t), r.tt);
    if (r.jmx) await page.setInputFiles('#fi-jmx', r.jmx);
    if (r.csv) await page.setInputFiles('#fi-csv', r.csv);
    if (r.certs) await page.setInputFiles('#fi-cert', r.certs);
    await page.click('#btn-jmx');
  }
  const expectRequest = r.kind === 'pm' ? !!r.col : !!r.jmx;
  if (expectRequest) {
    await respP;
    await page.waitForFunction(() => ['res-ok', 'res-err'].some(id => { const e = document.getElementById(id); return e && e.style.display === 'block'; }), null, { timeout: 90000 }).catch(() => {});
  } else await page.waitForTimeout(500);
  const ui = await page.evaluate(() => {
    const vis = id => { const e = document.getElementById(id); return e && e.style.display === 'block'; };
    const txt = id => { const e = document.getElementById(id); return e ? e.innerText.replace(/\s+/g, ' ').trim() : null; };
    return { ok: vis('res-ok'), err: vis('res-err'), okText: vis('res-ok') ? txt('res-ok') : null, errText: vis('res-err') ? txt('err-msg') : null, dl: (document.getElementById('btn-dl') || {}).getAttribute && document.getElementById('btn-dl').getAttribute('href') };
  });
  let zip = null;
  if (ui.ok && ui.dl && ui.dl !== '#') {
    const b64 = await page.evaluate(async h => { const x = await fetch(h); const a = new Uint8Array(await x.arrayBuffer()); let s = ''; for (const c of a) s += String.fromCharCode(c); return btoa(s); }, ui.dl);
    zip = await zipText(Buffer.from(b64, 'base64'));
  }
  await page.close();
  const dir = path.join(OUT, r.id);
  fs.rmSync(dir, { recursive: true, force: true });
  if (response && response.body) { delete response.body.downloadUrl; }
  w(path.join(dir, 'request.json'), norm(JSON.stringify(request, null, 2)) + '\n');
  w(path.join(dir, 'response.json'), norm(JSON.stringify(response, null, 2)) + '\n');
  w(path.join(dir, 'ui.json'), norm(JSON.stringify({ ...ui, dl: ui.dl ? norm(ui.dl) : null, alerts }, null, 2)) + '\n');
  w(path.join(dir, 'diagnostics.json'), JSON.stringify({ errors }, null, 2) + '\n');
  if (zip) for (const [n, t] of Object.entries(zip)) w(path.join(dir, 'zip', n.replace(/[<>:"|?*]/g, '_')), t);
  return `${r.id}: ${ui.ok ? 'ok' : ui.err ? 'error' : 'no result'}${zip ? ' (' + Object.keys(zip).length + ' files)' : ''}${alerts.length ? ' alert' : ''}`;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch({ channel: 'msedge' });
  const list = RUNS.filter(r => !ONLY || r.id.includes(ONLY));
  const t0 = Date.now(); let i = 0;
  const jobs = 4; const lines = [];
  await Promise.all(Array.from({ length: jobs }, async () => { while (i < list.length) { const r = list[i++]; try { lines.push(await run(b, r)); } catch (e) { lines.push(r.id + ': HARNESS ERROR ' + e.message.split('\n')[0]); } } }));
  await b.close();
  lines.sort(); console.log(lines.join('\n'));
  console.log(`done: ${list.length} runs in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);
})();
