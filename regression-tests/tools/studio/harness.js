#!/usr/bin/env node
// Script Studio golden-output harness.
//   node harness.js <pageUrl> <outDir> [--only=substr] [--fixtures=dir] [--no-steps] [--jobs=N]
// Drives the Studio page ONLY through its global functions and the shared `S`
// state object (page.evaluate). DOM is touched only where a Studio function
// reads a DOM value itself (modal inputs / selects, background-review toggle
// buttons, code-tab elements passed to switchTab). Element ids are the
// contract, so the same harness runs against the classic page and the redesign.
//
// Normalisation (see README):
//   * ZIPs are captured as {file name -> text} by wrapping JSZip.prototype.generateAsync
//     (no ZIP timestamps / compression bytes).
//   * Page URL / origin in any captured text -> <PAGE> / <ORIGIN>.
//   * Studio's analytics beacon (POST .../analytics/track) is intercepted and answered
//     204 (never reaches the server DB); its body is kept with `duration` -> null,
//     its URL path is kept (origin-normalised).
//   * Browser pinned to timezone UTC / locale en-GB.
'use strict';
const { chromium } = require(require('path').resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const args = process.argv.slice(2);
const pos = args.filter(a => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter(a => a.startsWith('--')).map(a => { const [k, v] = a.slice(2).split('='); return [k, v === undefined ? true : v]; }));
if (pos.length < 2) { console.error('usage: node harness.js <pageUrl> <outDir> [--only=substr] [--fixtures=dir] [--no-steps] [--jobs=N]'); process.exit(2); }
const [PAGE_URL, OUT] = pos;
const FIX_DIR = opt.fixtures || path.join(__dirname, 'fixtures');
const FORMATS = ['webhttp', 'devweb'];
const ORIGIN = new URL(PAGE_URL).origin;
const PAGE_DIR = new URL(PAGE_URL).pathname.replace(/[^/]*$/, ''); // "/converter/" for /converter/studio
const JOBS = Math.max(1, parseInt(opt.jobs || '4', 10));
const STEP_FIXTURE = 'rich-shop.har';

// The page URL is replaced only as a whole URL (".../studio" must not eat the
// prefix of ".../studio-app.js"); the origin is replaced everywhere.
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const PAGE_RE = new RegExp(reEsc(PAGE_URL.replace(/\/$/, '')) + '(?![\\w.\\-/])', 'g');
function norm(s) {
  if (typeof s !== 'string') return s;
  return s.replace(PAGE_RE, '<PAGE>').split(ORIGIN).join('<ORIGIN>');
}
function normDeep(o) { return JSON.parse(norm(JSON.stringify(o === undefined ? null : o))); }
function writeJson(p, obj) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(normDeep(obj), null, 2) + '\n'); }
function writeText(p, s) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, norm(String(s))); }
function safe(n) { return String(n).replace(/[^A-Za-z0-9._-]/g, '_'); }

// ---- in-page helpers (installed after each navigation) ----------------------
function installHooks() {
  window.__toasts = []; window.__zips = []; window.__downloads = []; window.__copies = [];
  const origToast = window.showToast;
  window.showToast = function (msg, type) { window.__toasts.push({ msg: String(msg), type: type || 'info' }); try { return origToast && origToast.apply(this, arguments); } catch (e) { } };
  const origClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download || /^blob:/.test(this.href)) { window.__downloads.push(this.download || ''); return; }
    return origClick.apply(this, arguments);
  };
  try {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copies.push(String(t)); return Promise.resolve(); } } });
  } catch (e) { }
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
  const plain = v => v instanceof Set ? Array.from(v).sort() : v instanceof Map ? Array.from(v.entries()) : v;
  const clone = v => { try { return JSON.parse(JSON.stringify(v, (k, x) => plain(x))); } catch (e) { return '<<unserialisable: ' + e.message + '>>'; } };
  const $ = id => document.getElementById(id);
  const txt = id => { const e = $(id); return e ? e.textContent : null; };
  const html = id => { const e = $(id); return e ? e.innerHTML : null; };
  const disp = id => { const e = $(id); return e ? e.style.display : null; };
  window.__state = function () {
    const ents = S.entries1 || [];
    const nonMarker = ents.filter(e => !e.isMarker);
    const compact = e => ({ id: e.id, method: e.method, url: e.url, status: e.status, ct: e.ct, rt: e._resourceType || '', filtered: !!e.filtered, isMarker: !!e.isMarker, markerType: e.markerType || null, txnName: e.txnName || null, txn: e.txn || null, pageref: e.pageref || null, perfx: e._perfx_class || null });
    return {
      format: S.format, mode: S.mode, tab: S.tab,
      har1Loaded: !!S.har1, har2Loaded: !!S.har2, har1Name: S.har1Name || null, har2Name: S.har2Name || null,
      isNetLog1: !!S.isNetLog1, isNetLog2: !!S.isNetLog2,
      auth: clone(S.auth || null), serverHost: clone(S.serverHost || null),
      hasDpop: !!S.hasDpop, hasPkce: !!S.hasPkce, dpopTokenVar: S.dpopTokenVar === undefined ? null : S.dpopTokenVar,
      harWarning: S.harWarning || '',
      txns: clone(S.txns || []), harPages: clone(S.harPages || null), bgDecisions: clone(S.bgDecisions || null),
      filterResourceTypes: clone(S.filterResourceTypes === undefined ? '<undef>' : S.filterResourceTypes),
      filterDomains: clone(S.filterDomains || {}), domainStats: clone(S.domainStats || {}),
      counts: { entries1: ents.length, entries2: (S.entries2 || []).length, markers: ents.length - nonMarker.length, requests: nonMarker.length, filtered: nonMarker.filter(e => e.filtered).length, included: nonMarker.filter(e => !e.filtered).length },
      entries: ents.length > 2000 ? null : ents.map(compact),
      entriesDigest: ents.length > 2000 ? ents.map(e => (e.isMarker ? 'M' + (e.markerType || '') + ':' + e.txnName : (e.filtered ? 'F' : 'I') + e.id + ':' + (e.txn || ''))).join('|') : null,
      scriptKeys: Object.keys(S.scripts || {}).sort()
    };
  };
  window.__corr = function () {
    return {
      correlations: clone(S.correlations || []),
      candidates: clone(S.candidates || []),
      advisorCandidates: clone(S.advisorCandidates || []),
      advisorSummary: (S.advisorCandidates || []).map(c => ({ id: c.id, value: c.value, status: c.status, confidence: c.confidence, valueType: c.valueType || null, varName: c.varName || null, applied: !!c._applied, manual: !!c._manual, usages: (c.usages || []).length })),
      params: clone(S.params || [])
    };
  };
  window.__ui = function () {
    const act = document.querySelector('.phase.active');
    const statCls = id => { const e = $(id); const s = e && e.closest && e.closest('.stat'); return s ? s.className : null; };
    const rt = $('rt-filter-list');
    const codeBody = $('code-body');
    return {
      phase: act ? act.id : null,
      stats: { req: txt('st-req'), txn: txt('st-txn'), corr: txt('st-corr'), corrClass: statCls('st-corr'), params: txt('st-params'), paramsClass: statCls('st-params'), mode: txt('st-mode'), fmt: txt('st-fmt'), auth: txt('st-auth'), authWrapDisplay: disp('st-auth-wrap'), authWrapClass: $('st-auth-wrap') ? $('st-auth-wrap').className : null },
      upload: { modeBadge: html('mode-badge'), analyzeText: txt('btn-analyze'), analyzeDisabled: $('btn-analyze') ? $('btn-analyze').disabled : null, dz1Name: txt('dz1-name'), dz2Name: txt('dz2-name'), dz1Clear: disp('dz1-clear'), dz2Clear: disp('dz2-clear'), clearHdr: disp('btn-clear-hdr'),
        fmtActive: Array.from(document.querySelectorAll('.fmt-btn.active')).map(b => b.id), filterSection: disp('filter-section'), filterEmpty: disp('filter-empty-state'), domainRow: disp('domain-filter-row'),
        rtRows: rt ? Array.from(rt.querySelectorAll('.rt-filter-row')).map(r => r.dataset.key + ':' + (r.classList.contains('rt-row-on') ? 'on' : 'off')) : null,
        domainChips: html('domain-chip-bar'), domainSearchPlaceholder: $('studio-dp-search') ? $('studio-dp-search').placeholder : null },
      proc: { step: txt('proc-step'), msg: txt('proc-msg') },
      bg: { display: disp('bgReviewPanel'), subtitle: txt('bgReviewSubtitle'), stats: txt('bgReviewStats'), body: html('bgReviewBody') },
      advisor: { display: disp('adv-panel'), badge: txt('adv-badge'), badgeClass: $('adv-badge') ? $('adv-badge').className : null, footer: disp('adv-footer'), footerSummary: html('adv-footer-summary'), regenDisabled: $('adv-btn-regen') ? $('adv-btn-regen').disabled : null, cards: html('adv-cards'), inspectorOptions: html('adv-insp-req-sel') },
      corrList: html('corr-list'),
      params: { display: disp('param-panel'), list: html('param-list') },
      codeTabs: html('code-tabs'), dlBar: html('dl-bar'),
      codeBody: { len: codeBody ? codeBody.textContent.length : null, equalsCurrentTab: codeBody ? codeBody.textContent === ((S.scripts || {})[S.tab] || '// No content') : null }
    };
  };
  window.__snapToasts = function () { const t = window.__toasts.slice(); window.__toasts = []; return t; };
}

async function freshPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: 'UTC', locale: 'en-GB' });
  const page = await ctx.newPage();
  const errors = [], beacons = [];
  page.on('pageerror', e => errors.push('pageerror: ' + norm(e.message)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + norm(m.text())); });
  page.on('response', r => { if (r.status() >= 400) errors.push('http ' + r.status() + ': ' + norm(r.url())); });
  page.on('requestfailed', r => errors.push('requestfailed: ' + norm(r.url())));
  page.on('dialog', d => d.accept());
  await page.route('**/analytics/track', async route => {
    let body = null; try { body = JSON.parse(route.request().postData() || 'null'); } catch (e) { body = route.request().postData(); }
    if (body && typeof body === 'object' && 'duration' in body) body.duration = body.duration == null ? null : '<ms>';
    // Path relative to the page directory: identical for /converter/studio and
    // /converter/studio-next ONLY if the beacon resolves to the same endpoint.
    const p = new URL(route.request().url()).pathname;
    beacons.push({ pathFromPageDir: p.startsWith(PAGE_DIR) ? p.slice(PAGE_DIR.length) : p, body });
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto(PAGE_URL, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof JSZip !== 'undefined' && typeof S === 'object' && typeof analyze === 'function', null, { timeout: 15000 });
  await page.evaluate(installHooks);
  return { ctx, page, errors, beacons };
}

// ---- in-page actions ---------------------------------------------------------
async function loadSlot(page, slot, name, text) {
  return page.evaluate(async ({ slot, name, text }) => {
    const key = slot === 1 ? 'har1' : 'har2';
    const prev = S[key]; const t0 = window.__toasts.length;
    loadFile(new File([text], name, { type: 'application/json' }), slot);
    const start = Date.now();
    while (S[key] === prev && window.__toasts.length === t0 && Date.now() - start < 60000) await new Promise(r => setTimeout(r, 20));
    return { loaded: S[key] !== prev && !!S[key], netlog: !!S[slot === 1 ? 'isNetLog1' : 'isNetLog2'] };
  }, { slot, name, text });
}
// analyze(); if the background-review gate stops it, record that and (optionally)
// apply decisions: {normalizedUrl|index: 'exclude'|'once'|'all'} set via the panel buttons.
async function runAnalyze(page, bgDecisions) {
  return page.evaluate(async (bgDecisions) => {
    let threw = null;
    try { await analyze(); } catch (e) { threw = String(e && e.message || e); }
    const act = document.querySelector('.phase.active');
    const bgPanel = document.getElementById('bgReviewPanel');
    const bgShown = !!(bgPanel && bgPanel.style.display !== 'none' && act && act.id === 'ph-res' && document.querySelectorAll('.bg-decision-toggle').length > 0);
    let bgUi = null, bgState = null, bgApplied = null;
    if (bgShown) {
      bgUi = window.__ui().bg; bgUi.scriptKeysAtGate = Object.keys(S.scripts || {}).sort(); bgState = Array.from(S.bgDecisions || []);
      const rows = Array.from(document.querySelectorAll('.bg-decision-toggle'));
      if (bgDecisions) rows.forEach((g, i) => {
        const want = bgDecisions[g.dataset.url] || bgDecisions[i];
        if (want) { const b = g.querySelector('.bg-dec[data-val="' + want + '"]'); if (b) b.click(); }
      });
      bgApplied = rows.map(g => g.dataset.url + '=' + ((g.querySelector('.bg-dec.active') || {}).dataset || {}).val);
      try { await applyBgDecisions(); } catch (e) { threw = 'applyBgDecisions: ' + String(e && e.message || e); }
    }
    return { threw, phaseAfterAnalyze: act ? act.id : null, bgShown, bgUi, bgState, bgApplied, phase: (document.querySelector('.phase.active') || {}).id || null };
  }, bgDecisions || null);
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
// Click every code tab (switchTab via its own onclick), then copyCode().
async function tabsAndCopy(page) {
  return page.evaluate(async () => {
    const out = [];
    const tabs = Array.from(document.querySelectorAll('#code-tabs .code-tab'));
    for (const el of tabs) {
      el.click();
      const body = document.getElementById('code-body').textContent;
      window.__copies = [];
      copyCode();
      await new Promise(r => setTimeout(r, 30));
      const h = s => { let x = 0; for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0; return x; };
      out.push({ label: el.textContent, tab: S.tab, active: el.classList.contains('act'), bodyLen: body.length, bodyEqualsScript: body === (S.scripts[S.tab] || '// Not generated'),
        copied: window.__copies.length ? { len: window.__copies[0].length, hash: h(window.__copies[0]), equalsBody: window.__copies[0] === body } : null,
        copyBtn: (document.getElementById('btn-copy') || {}).textContent || null });
    }
    if (tabs[0]) tabs[0].click();
    return out;
  });
}

function dumpScripts(dir, sc) { for (const [k, v] of Object.entries(sc)) writeText(path.join(dir, 'scripts', safe(k) + '.txt'), String(v)); }
function dumpZips(dir, z) {
  const meta = { thrown: z.thrown, downloads: z.downloads, zips: [] };
  z.zips.forEach((zz, i) => {
    const zname = safe(z.downloads[i] || ('zip' + i));
    meta.zips.push({ name: zname, files: zz.order });
    for (const f of zz.order) writeText(path.join(dir, 'zip', zname, safe(f)), zz.files[f]);
  });
  writeJson(path.join(dir, 'zip.json'), meta);
}
// Capture everything for one checkpoint into dir.
async function capture(page, ctxInfo, dir, extra) {
  const state = await page.evaluate(() => window.__state());
  const corr = await page.evaluate(() => window.__corr());
  const ui = await page.evaluate(() => window.__ui());
  const toasts = await page.evaluate(() => window.__snapToasts());
  writeJson(path.join(dir, 'state.json'), Object.assign({}, extra || {}, state));
  writeJson(path.join(dir, 'correlations.json'), corr.correlations);
  writeJson(path.join(dir, 'candidates.json'), corr.candidates);
  writeJson(path.join(dir, 'advisor.json'), { summary: corr.advisorSummary, full: corr.advisorCandidates });
  writeJson(path.join(dir, 'params.json'), corr.params);
  writeJson(path.join(dir, 'ui.json'), ui);
  writeJson(path.join(dir, 'toasts.json'), toasts);
  writeJson(path.join(dir, 'analytics.json'), ctxInfo.beacons.splice(0));
  writeJson(path.join(dir, 'diagnostics.json'), { errors: ctxInfo.errors.splice(0) });
  fs.rmSync(path.join(dir, 'scripts'), { recursive: true, force: true });
  dumpScripts(dir, await scripts(page));
  return { state, corr, ui, toasts };
}
const ev = (page, fn, arg) => page.evaluate(`(async()=>{try{const r=await (${fn.toString()})(${JSON.stringify(arg === undefined ? null : arg)});return {ok:true,r:r===undefined?null:r}}catch(e){return {ok:false,err:String(e&&e.message||e)}}})()`);

// ---- one fixture x format x mode run ----------------------------------------
async function runOne(browser, fx, fmt, mode, r2) {
  const dir = path.join(OUT, safe(fx), mode + '-' + fmt);
  fs.rmSync(dir, { recursive: true, force: true });
  const info = await freshPage(browser);
  const { page } = info;
  try {
    await page.evaluate(f => setFmt(f), fmt);
    const text = fs.readFileSync(path.join(FIX_DIR, fx), 'utf8');
    const l1 = await loadSlot(page, 1, fx, text);
    let l2 = null;
    if (mode === 'diff') l2 = await loadSlot(page, 2, r2, fs.readFileSync(path.join(FIX_DIR, r2), 'utf8'));
    const an = await runAnalyze(page, null);
    const res = await capture(page, info, dir, { load1: l1, load2: l2, analyze: an });
    writeJson(path.join(dir, 'tabs.json'), await tabsAndCopy(page));
    dumpZips(dir, await zips(page, fmt));
    writeJson(path.join(dir, 'zip-toasts.json'), await page.evaluate(() => window.__snapToasts()));
    return { phase: res.ui.phase, bg: an.bgShown, corr: res.corr.correlations.length, adv: res.corr.advisorSummary.length, params: res.corr.params.length, scripts: res.state.scriptKeys.length, toasts: res.toasts.length };
  } finally { await info.ctx.close(); }
}

// ---- step sequence on the rich fixture --------------------------------------
async function runSteps(browser) {
  const fx = STEP_FIXTURE, r2 = fx.replace(/\.har$/, '.r2.har');
  const base = path.join(OUT, safe(fx), 'steps');
  fs.rmSync(base, { recursive: true, force: true });
  const info = await freshPage(browser);
  const { page } = info;
  const text = fs.readFileSync(path.join(FIX_DIR, fx), 'utf8');
  const log = [];
  let n = 0;
  async function step(name, action, opts = {}) {
    const sdir = path.join(base, String(++n).padStart(2, '0') + '-' + name);
    const res = action ? await action() : null;
    await capture(page, info, sdir, { step: name, result: res });
    if (opts.zip) dumpZips(sdir, await zips(page, await page.evaluate(() => S.format)));
    if (opts.tabs) writeJson(path.join(sdir, 'tabs.json'), await tabsAndCopy(page));
    log.push(name);
  }
  const reanalyze = (decisions) => runAnalyze(page, decisions);
  try {
    await step('load-webhttp', async () => { await page.evaluate(() => setFmt('webhttp')); return loadSlot(page, 1, fx, text); });
    await step('analyze-bg-review-defaults', () => reanalyze(null), { zip: true });
    await step('bg-once-and-all', async () => { await page.evaluate(() => goBack()); return reanalyze({ 0: 'once', 1: 'all' }); }, { zip: true });
    await step('rt-add-css-js-img-font', async () => { await ev(page, () => { goBack(); ['stylesheet', 'script', 'image', 'font'].forEach(k => studioToggleRt(k)); }); return reanalyze(null); });
    await step('rt-all', async () => { await ev(page, () => { goBack(); studioToggleRt('__all__'); }); return reanalyze(null); });
    await step('rt-none-fetch-only', async () => { await ev(page, () => { goBack(); studioToggleRtNone(); }); return reanalyze(null); });
    await step('rt-all-domain-cdn-off', async () => { await ev(page, () => { goBack(); studioToggleRt('__all__'); studioToggleDomain('cdn.example-outdoor.com', false); }); return reanalyze(null); });
    await step('domains-none', async () => { await ev(page, () => { goBack(); studioToggleAllDomains(false); }); return reanalyze(null); });
    await step('domains-all-search', async () => { await ev(page, () => { goBack(); studioToggleAllDomains(true); studioRenderDomains('api'); }); return reanalyze(null); });
    await step('filters-reset-default', async () => { await ev(page, () => { goBack(); studioInitFilters(); studioToggleDomain('www.google-analytics.com'); studioToggleDomain('www.google-analytics.com'); studioRenderDomains(''); }); return reanalyze(null); });
    await step('advisor-skip-first-then-unskip', () => ev(page, () => { const c = S.advisorCandidates[0]; if (!c) return 'no candidates'; advisorSkip(c.id); const s1 = c.status; advisorSkip(c.id); return [s1, c.status]; }));
    await step('advisor-apply-none-accepted', () => ev(page, () => { advisorApplyAndRegen(); }));
    await step('advisor-array-anchor-buttons', () => ev(page, () => {
      // Array-reconstruction card: pick the last primary-key option and press the
      // card's own "fill paths" / "set anchor" button (they read the card <select>).
      const out = [];
      for (const c of (S.advisorCandidates || []).filter(x => x._arrayReconstruct)) {
        const card = document.getElementById('advc-' + c.id); if (!card) { out.push(c.id + ':no-card'); continue; }
        const sel = card.querySelector('select'); if (sel && sel.options.length) sel.value = sel.options[sel.options.length - 1].value;
        const btn = Array.from(card.querySelectorAll('button')).find(b => /advisorFillArrayPaths|advisorSetArrayAnchor/.test(b.getAttribute('onclick') || ''));
        if (btn) btn.click();
        out.push(c.id + ':' + (sel ? sel.value : '-') + ':' + (btn ? (btn.getAttribute('onclick').match(/advisor\w+/) || [''])[0] : 'no-button') + ':' + ((c._arrayConfig || {}).countVar || ''));
      }
      return out;
    }));
    await step('advisor-rename-accept-all-apply', () => ev(page, () => { const p = (S.advisorCandidates || []).filter(c => c.status === 'pending'); if (p[0]) advisorSetName(p[0].id, '  RenamedByHarness  '); if (p[1]) advisorSetName(p[1].id, '   '); p.forEach(c => advisorAccept(c.id)); advisorApplyAndRegen(); return S.correlations.length; }), { zip: true });
    await step('manual-modal-submit-without-field', () => ev(page, () => { openAdvisorModal(); submitAdvisorManual(); const o = document.getElementById('adv-modal-overlay').style.display; closeAdvisorModal(); return o; }));
    await step('manual-modal-add-customer-id', () => ev(page, () => {
      openAdvisorModal();
      const opts = Array.from(document.getElementById('adv-src-select').options).map(o => o.value + ' ' + o.textContent);
      const idx = (S.entries1 || []).findIndex(e => !e.filtered && !e.isMarker && e.method === 'POST' && /\/v2\/session$/.test(e.url));
      filterAdvisorSrcDropdown('session');
      const sel = document.getElementById('adv-src-select'); sel.value = String(idx);
      onAdvisorSrcChange(sel.value);
      const fields = _advFieldList.map(f => f.extType + ':' + f.path);
      filterAdvisorFields('customer');
      const fi = _advFieldList.findIndex(f => f.path === '$.customer.id');
      selectAdvisorField(fi);
      const suggested = document.getElementById('adv-varname-input').value;
      document.getElementById('adv-varname-input').value = 'CustomerId';
      submitAdvisorManual();
      advisorApplyAndRegen();
      return { idx, opts, fields, fi, suggested };
    }), { zip: true });
    await step('paste-detect-order-number', () => ev(page, () => {
      const i = (S.entries1 || []).findIndex(e => !e.filtered && !e.isMarker && /\/v2\/checkout$/.test(e.url));
      const e = S.entries1[i]; const val = JSON.parse(e.respBody).orderNumber;
      openPasteCorrelate(val);
      document.getElementById('pc-response-body').value = e.respBody;
      document.getElementById('pc-src-select').value = String(i);
      runPasteDetect();
      const result = document.getElementById('pc-result-section').innerHTML;
      document.getElementById('pc-varname-input').value = 'OrderNumber';
      submitPasteCorrelate();
      return { i, val, result };
    }));
    await step('paste-detect-fallback-jwt', () => ev(page, () => {
      const tok = (S.entries1.find(e => /\/v2\/session$/.test(e.url)) || {}).respBody;
      const v = JSON.parse(tok).token;
      openPasteCorrelate(v);
      document.getElementById('pc-response-body').value = '';
      runPasteDetect();
      const result = document.getElementById('pc-result-section').innerHTML;
      closePasteCorrelate();
      return { result };
    }));
    await step('inspector-trace-add', () => ev(page, () => {
      const i = (S.entries1 || []).findIndex(e => !e.filtered && !e.isMarker && /\/v2\/checkout$/.test(e.url));
      onInspectorReqChange(String(i));
      const list = document.getElementById('ri-field-list').innerHTML;
      const fields = _riFields.map(f => ({ key: f.key, status: f.status, location: f.location }));
      const g = _riFields.findIndex(f => f.status === 'green');
      if (g >= 0) { riTraceField(g); }
      const trace = document.getElementById('ri-trace-panel').innerHTML;
      if (g >= 0) { riAddCorrFromTrace(g); advisorApplyAndRegen(); }
      return { i, list, fields, g, trace };
    }));
    await step('rand-select-toggle', () => ev(page, () => {
      const idx = S.correlations.findIndex(c => (c.extractorType === 'jsonpath' && c.extractorConfig && c.extractorConfig.selectAll) || c.extractorType === 'random_select');
      if (idx >= 0) toggleCorrRandSelect(idx);
      return idx;
    }), { zip: true });
    await step('panels-toggle', () => ev(page, () => { toggleCorrPanel(); toggleParamPanel(); toggleAdvisorPanel(); toggleInspector(); const r = [document.getElementById('corr-list').style.display, document.getElementById('param-list').style.display, document.getElementById('adv-panel').className, document.getElementById('adv-insp-body').style.display]; toggleCorrPanel(); toggleParamPanel(); toggleAdvisorPanel(); toggleInspector(); return r; }), { tabs: true });
    await step('format-switch-devweb', async () => { await ev(page, () => { goBack(); setFmt('devweb'); }); return reanalyze(null); }, { zip: true, tabs: true });
    await step('diff-load-r2', async () => { await ev(page, () => goBack()); return loadSlot(page, 2, r2, fs.readFileSync(path.join(FIX_DIR, r2), 'utf8')); });
    await step('diff-analyze', () => reanalyze(null), { zip: true });
    await step('diff-clear-slot2-analyze', async () => { await ev(page, () => { goBack(); clearSlot(2); }); return reanalyze(null); });
    await step('start-over-clear-all', () => ev(page, () => { clearAll(); }));
    await step('analyze-without-file', () => reanalyze(null));
    await step('reload-webhttp-analyze', async () => { await page.evaluate(() => setFmt('webhttp')); const l = await loadSlot(page, 1, fx, text); return [l, await reanalyze(null)]; }, { zip: true });
    await step('clear-slot1', () => ev(page, () => { goBack(); clearSlot(1); }));
  } finally { await info.ctx.close(); }
  return log;
}

// ---- edge cases on a fresh page ---------------------------------------------
async function runEdge(browser) {
  const base = path.join(OUT, '_edge');
  fs.rmSync(base, { recursive: true, force: true });
  const info = await freshPage(browser);
  const { page } = info;
  let n = 0;
  async function step(name, fn) { const r = await ev(page, fn); await capture(page, info, path.join(base, String(++n).padStart(2, '0') + '-' + name), { step: name, result: r }); }
  try {
    await step('initial-page', () => null);
    await step('analyze-no-file', async () => { await analyze(); });
    await step('dlzip-no-scripts', async () => { await dlZip('webhttp'); return window.__downloads.slice(); });
    await step('apply-regen-nothing', () => { advisorApplyAndRegen(); });
    await step('drop-wrong-extension', () => { onDrop({ preventDefault() { }, dataTransfer: { files: [new File(['x'], 'notes.txt')] } }, 1); });
    await step('filepick-har', async () => { onFilePick({ target: { files: [new File(['{"log":{"entries":[]}}'], 'picked.har')] } }, 1); for (let i = 0; i < 100 && !S.har1; i++) await new Promise(r => setTimeout(r, 20)); return !!S.har1; });
    await step('drop-har-slot2', async () => { onDragOver({ preventDefault() { } }, 2); onDragLeave(2); onDrop({ preventDefault() { }, dataTransfer: { files: [new File(['{"log":{"entries":[]}}'], 'dropped.har')] } }, 2); for (let i = 0; i < 100 && !S.har2; i++) await new Promise(r => setTimeout(r, 20)); return S.mode; });
    await step('theme-toggle', () => { toggleTheme(); const a = document.documentElement.getAttribute('data-theme'); toggleTheme(); return [a, document.documentElement.getAttribute('data-theme')]; });
    await step('clear-all', () => { clearAll(); });
  } finally { await info.ctx.close(); }
}

async function pool(items, n, fn) {
  const res = []; let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; res[k] = await fn(items[k]); } }));
  return res;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const all = fs.readdirSync(FIX_DIR).filter(f => /\.(har|json)$/i.test(f)).sort();
  const fixtures = all.filter(f => !/\.r2\.(har|json)$/i.test(f)).filter(f => !opt.only || f.includes(opt.only));
  const jobs = [];
  for (const fx of fixtures) {
    const r2 = fx.replace(/\.(har|json)$/i, '.r2.$1');
    for (const fmt of FORMATS) {
      jobs.push({ fx, fmt, mode: 'pattern' });
      if (all.includes(r2)) jobs.push({ fx, fmt, mode: 'diff', r2 });
    }
  }
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const summary = { pageUrl: '<PAGE>', formats: FORMATS, runs: {} };
  const t0 = Date.now();
  try {
    await pool(jobs, JOBS, async j => {
      const t = Date.now();
      let r;
      try { r = await runOne(browser, j.fx, j.fmt, j.mode, j.r2); } catch (e) { r = { harnessError: String(e && e.message || e) }; }
      summary.runs[j.fx + ' ' + j.mode + '-' + j.fmt] = r;
      process.stdout.write(`${j.fx} [${j.mode}-${j.fmt}] ${JSON.stringify(r)} ${((Date.now() - t) / 1000).toFixed(1)}s\n`);
    });
    if (!opt['no-steps'] && (!opt.only || STEP_FIXTURE.includes(opt.only))) summary.steps = await runSteps(browser);
    if (!opt['no-steps'] && !opt.only) { await runEdge(browser); summary.edge = true; }
  } finally { await browser.close(); }
  summary.runs = Object.fromEntries(Object.entries(summary.runs).sort());
  writeJson(path.join(OUT, 'summary.json'), summary);
  console.log(`done: ${jobs.length} fixture x format x mode runs${summary.steps ? ' + ' + summary.steps.length + ' steps' : ''}${summary.edge ? ' + edge' : ''} in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${OUT}`);
})().catch(e => { console.error(e); process.exit(1); });
