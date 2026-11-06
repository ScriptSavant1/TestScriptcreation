#!/usr/bin/env node
// Recorder golden-output harness.
//   node harness.js <pageUrl> <outDir> [--only=fixtureSubstring] [--fixtures=<dir>]
// Drives the Recorder page ONLY through its global engine functions / the `S`
// state object (page.evaluate), never through DOM selectors, so the same
// harness runs against the classic page and the redesigned page.
//
// Normalisation (see NORMALISATION below and README section in the report):
//   * ZIPs are captured as {file name -> text content} by wrapping
//     JSZip.prototype.generateAsync, so ZIP-internal timestamps / compression
//     bytes never enter the output.
//   * Manually created transaction markers get id = -Date.now()-Math.random();
//     marker ids are written as null.
//   * Error messages: anything that looks like a page URL/origin is replaced
//     with <ORIGIN> so classic and redesigned URLs compare equal.
'use strict';
const { chromium } = require(require('path').resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
if (pos.length < 2) { console.error('usage: node harness.js <pageUrl> <outDir> [--only=substr] [--fixtures=dir]'); process.exit(2); }
const [PAGE_URL, OUT] = pos;
const FIX_DIR = opt.fixtures || path.join(__dirname, 'fixtures');
const FORMATS = ['webhttp', 'devweb', 'both'];
const ORIGIN = new URL(PAGE_URL).origin;

function norm(s) {
  if (typeof s !== 'string') return s;
  return s.split(PAGE_URL).join('<PAGE>').split(ORIGIN).join('<ORIGIN>');
}
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n'); }
function writeText(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, s); }
function safe(n) { return String(n).replace(/[^A-Za-z0-9._-]/g, '_'); }

// ---- in-page helpers (installed after each navigation) ----------------------
function installHooks() {
  window.__toasts = []; window.__zips = []; window.__downloads = [];
  const origToast = window.showToast;
  window.showToast = function (msg, type) { window.__toasts.push({ msg: String(msg), type: type || 'info' }); try { return origToast && origToast.apply(this, arguments); } catch (e) { } };
  // Never really download: record blob-anchor clicks instead.
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download || /^blob:/.test(this.href)) { window.__downloads.push(this.download || ''); return; }
    return origClick.apply(this, arguments);
  };
  if (window.JSZip && !window.JSZip.prototype.__wrapped) {
    const orig = window.JSZip.prototype.generateAsync;
    window.JSZip.prototype.generateAsync = async function (o) {
      const files = {}; const order = [];
      for (const name of Object.keys(this.files)) {
        const f = this.files[name]; if (f.dir) continue;
        order.push(name); files[name] = await f.async('string');
      }
      window.__zips.push({ order, files });
      return orig.call(this, o);
    };
    window.JSZip.prototype.__wrapped = true;
  }
  window.__snap = function () {
    const ents = (S.entries || []);
    const nonMarker = ents.filter(e => !e.isMarker);
    const toPlain = v => v instanceof Set ? Array.from(v).sort() : v instanceof Map ? Array.from(v.entries()) : v;
    return {
      format: S.format,
      isNetLogSource: !!S.isNetLogSource,
      auth: S.auth || null,
      serverHost: S.serverHost || null,
      hasDpop: !!S.hasDpop,
      dpopTokenVar: S.dpopTokenVar === undefined ? null : S.dpopTokenVar,
      dpopBearerToken: S.dpopBearerToken === undefined ? null : S.dpopBearerToken,
      txns: (S.txns || []).map(t => ({ name: t.name, color: t.color })),
      harPages: toPlain(S.harPages || null),
      counts: {
        entries: ents.length, markers: ents.length - nonMarker.length,
        requests: nonMarker.length,
        filtered: nonMarker.filter(e => e.filtered).length,
        included: nonMarker.filter(e => !e.filtered).length
      },
      domainStats: S.domainStats || {},
      domainFilter: S.domainFilter || {},
      resourceTypeFilter: toPlain(S.resourceTypeFilter),
      selMode: !!S.selMode,
      selIds: toPlain(S.selIds),
      entries: ents.length > 2000 ? null : ents.map(e => ({
        id: e.isMarker ? null : e.id, method: e.method, url: e.url, status: e.status, ct: e.ct,
        filtered: !!e.filtered, isMarker: !!e.isMarker, markerType: e.markerType || null,
        txnName: e.txnName || null, txn: e.txn || null, rt: e._resourceType || ''
      })),
      // Hash-free compact listing for very large inputs
      entriesDigest: ents.length > 2000 ? ents.map(e => (e.isMarker ? 'M' + (e.markerType || '') + ':' + e.txnName : (e.filtered ? 'F' : 'I') + e.id + ':' + (e.txn || ''))).join('|') : null,
      scriptKeys: Object.keys(S.scripts || {}).sort(),
      toasts: window.__toasts.slice()
    };
  };
}

async function freshPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + norm(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + norm(m.text())); });
  page.on('response', r => { if (r.status() >= 400) errors.push('http ' + r.status() + ': ' + norm(r.url())); });
  page.on('requestfailed', r => errors.push('requestfailed: ' + norm(r.url())));
  page.on('dialog', d => d.accept());
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof window.JSZip !== 'undefined' && typeof window.S === 'object' || (typeof S === 'object' && typeof JSZip !== 'undefined'), null, { timeout: 15000 });
  await page.evaluate(installHooks);
  return { ctx, page, errors };
}

// Load file text exactly as the file input does: readFile(File) -> FileReader ->
// JSON.parse -> isNetLog -> S.pendingHar|S.pendingNetLog -> openFmtModal.
async function loadFile(page, name, text) {
  return page.evaluate(async ({ name, text }) => {
    S.pendingHar = null; S.pendingNetLog = null;
    const t0 = window.__toasts.length;
    let via;
    if (typeof readFile === 'function') {
      via = 'readFile';
      readFile(new File([text], name, { type: 'application/json' }));
    } else {
      via = 'direct';
      try { const p = JSON.parse(text); if (isNetLog(p)) S.pendingNetLog = p; else S.pendingHar = p; }
      catch (e) { showToast('Could not parse file: ' + e.message, 'error'); }
    }
    const start = Date.now();
    while (!S.pendingHar && !S.pendingNetLog && window.__toasts.length === t0 && Date.now() - start < 30000) await new Promise(r => setTimeout(r, 20));
    return { via, pending: S.pendingNetLog ? 'netlog' : S.pendingHar ? 'har' : null };
  }, { name, text });
}

async function confirm(page, fmt) {
  return page.evaluate((fmt) => {
    try { selectFmt(fmt); } catch (e) { S.format = fmt; }
    try { confirmFmt(); return null; } catch (e) { return String(e && e.message || e); }
  }, fmt);
}

async function scripts(page) { return page.evaluate(() => Object.assign({}, S.scripts || {})); }

async function zips(page, fmt) {
  return page.evaluate(async (fmt) => {
    window.__zips = []; window.__downloads = [];
    let thrown = null;
    try { await dlZip(fmt); } catch (e) { thrown = String(e && e.message || e); }
    return { thrown, downloads: window.__downloads.slice(), zips: window.__zips.slice() };
  }, fmt);
}

function dumpScripts(dir, sc) {
  for (const [k, v] of Object.entries(sc)) writeText(path.join(dir, 'scripts', safe(k) + '.txt'), String(v));
}
function dumpZips(dir, z) {
  const meta = { thrown: z.thrown, downloads: z.downloads, zips: [] };
  z.zips.forEach((zz, i) => {
    const zname = safe(z.downloads[i] || ('zip' + i));
    meta.zips.push({ name: zname, files: zz.order });
    for (const f of zz.order) writeText(path.join(dir, 'zip', zname, safe(f)), norm(zz.files[f]));
  });
  writeJson(path.join(dir, 'zip.json'), meta);
}
// Page/console/network errors go to diagnostics.json (non-functional; compare.js
// reports them but does not count them as a functional difference).
function finalizeSnap(s, errors, dir) { writeJson(path.join(dir, 'diagnostics.json'), { errors: errors.slice() }); s.toasts = s.toasts.map(t => ({ msg: norm(t.msg), type: t.type })); return s; }

// ---- state-change sequence on the bookmarklet fixture -----------------------
const STEPS = [
  ['01-static-off', () => { document.getElementById('f-static').checked = false; refresh(); }],
  ['02-static-on', () => { document.getElementById('f-static').checked = true; refresh(); }],
  ['03-analytics-off', () => { document.getElementById('f-noise').checked = false; refresh(); }],
  ['04-analytics-on', () => { document.getElementById('f-noise').checked = true; refresh(); }],
  ['05-options-off', () => { document.getElementById('f-opts').checked = false; refresh(); }],
  ['06-options-on', () => { document.getElementById('f-opts').checked = true; refresh(); }],
  ['07-rt-toggle-fetch', () => { setRecorderRt('fetch'); }],          // all types except Fetch/XHR
  ['08-rt-only-document', () => { ['stylesheet', 'script', 'font', 'image', 'media', 'other'].forEach(k => setRecorderRt(k)); setRecorderRt('fetch'); setRecorderRt('fetch'); }],
  ['09-rt-all', () => { setRecorderRt('__all__'); }],
  ['10-domain-api-off', () => { toggleDomain('api.example-retail.com', false); }],
  ['11-domain-api-on', () => { toggleDomain('api.example-retail.com', true); }],
  ['12-domain-all-off', () => { toggleAllDomains(false); }],
  ['13-domain-all-on', () => { toggleAllDomains(true); }],
  ['14-selmode-range-T09_Manual', () => {
    toggleSelMode();
    [17, 18, 19].forEach(id => rowClick(id));
    openTxnModal();
    document.getElementById('txn-inp').value = 'T09_Manual';
    confirmTxn();
  }]
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const fixtures = fs.readdirSync(FIX_DIR).filter(f => /\.(har|json)$/i.test(f)).sort()
    .filter(f => !opt.only || f.includes(opt.only));
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const summary = { pageUrl: '<PAGE>', formats: FORMATS, fixtures: {} };
  const t0 = Date.now();
  try {
    for (const fx of fixtures) {
      const text = fs.readFileSync(path.join(FIX_DIR, fx), 'utf8');
      summary.fixtures[fx] = {};
      for (const fmt of FORMATS) {
        const dir = path.join(OUT, safe(fx), fmt);
        fs.rmSync(dir, { recursive: true, force: true });
        const { ctx, page, errors } = await freshPage(browser);
        const load = await loadFile(page, fx, text);
        let confirmErr = null;
        if (load.pending) confirmErr = await confirm(page, fmt);
        const snap = finalizeSnap(await page.evaluate(() => window.__snap()), errors, dir);
        snap.load = load; snap.confirmThrew = confirmErr ? norm(confirmErr) : null;
        writeJson(path.join(dir, 'state.json'), snap);
        dumpScripts(dir, await scripts(page));
        if (load.pending) dumpZips(dir, await zips(page, fmt));
        summary.fixtures[fx][fmt] = { pending: load.pending, confirmThrew: snap.confirmThrew, counts: snap.counts, txns: snap.txns.length, auth: snap.auth && snap.auth.type, scripts: snap.scriptKeys, toasts: snap.toasts.length };

        if (fx === 'bookmarklet-markers.har' && load.pending) {
          for (const [name, fn] of STEPS) {
            const sdir = path.join(dir, 'steps', name);
            const err = await page.evaluate(`(()=>{try{(${fn.toString()})();return null}catch(e){return String(e&&e.message||e)}})()`);
            const s = finalizeSnap(await page.evaluate(() => window.__snap()), errors, sdir);
            s.stepThrew = err;
            writeJson(path.join(sdir, 'state.json'), s);
            dumpScripts(sdir, await scripts(page));
          }
          dumpZips(path.join(dir, 'steps', 'zz-final'), await zips(page, fmt));
        }
        await ctx.close();
        process.stdout.write(`${fx} [${fmt}] ${load.pending || 'no-load'} ${confirmErr ? 'THREW ' : ''}\n`);
      }
    }
  } finally { await browser.close(); }
  writeJson(path.join(OUT, 'summary.json'), summary);
  console.log(`done: ${fixtures.length} fixtures x ${FORMATS.length} formats in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
