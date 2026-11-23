// Every screen of every tool, checked control by control (the design audit, audit.js, checks fonts and contrast):
//   - overlap: a visible control covered by something else (its centre and corners)
//   - clipped: text cut off with no ellipsis and no title (the whole text cannot be read)
//   - unnamed: a button or field with no accessible name (text, aria-label, title, a label)
//   - focus: a control that shows nothing when it has the keyboard focus
//   - sideways: the page (or a panel) scrolls sideways
//   - plain: a button with words but no border, no background and no underline — it cannot be told from text
//   - dismiss: an open pop-up (dialog) that a click outside it does not close
// At 1366, 1920 and 2560 px wide, dark and light; a JPEG of each screen and report.json for the gallery.
//   node review.js [outDir] [--sizes=1366,1920,2560] [--themes=dark,light] [--only=substr]
'use strict';
const { chromium } = require(require('path').resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const path = require('path'), fs = require('fs');
const args = process.argv.slice(2);
const OUT = args.find((a) => !a.startsWith('--')) || path.join(__dirname, 'review');
const opt = (k, d) => ((args.find((a) => a.startsWith('--' + k + '=')) || '').split('=')[1] || d);
const SIZES = opt('sizes', '1366,1920,2560').split(',').map(Number);
const THEMES = opt('themes', 'dark,light').split(',');
const ONLY = opt('only', '');
const BASE = 'http://localhost:3999/converter/';
const FX = path.resolve(__dirname, '../').replace(/\\/g, '/') + '/';
const COL = path.resolve(__dirname, '../../../collection-examples').replace(/\\/g, '/') + '/';
const HEIGHT = { 1100: 800, 1280: 720, 1366: 768, 1920: 1000, 2560: 1300 };

// runs in a document: the checks
function inspect() {
  // the part of an element that can be seen: its box cut by every ancestor that clips (a scrolling panel) and the window
  const seen = (e) => {
    let r = e.getBoundingClientRect(), x1 = r.left, y1 = r.top, x2 = r.right, y2 = r.bottom;
    for (let n = e.parentElement; n && n !== document.documentElement; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') { const a = n.getBoundingClientRect(); x1 = Math.max(x1, a.left); y1 = Math.max(y1, a.top); x2 = Math.min(x2, a.right); y2 = Math.min(y2, a.bottom); }
    }
    x1 = Math.max(x1, 0); y1 = Math.max(y1, 0); x2 = Math.min(x2, innerWidth); y2 = Math.min(y2, innerHeight);
    return x2 - x1 >= 2 && y2 - y1 >= 2 ? { left: x1, top: y1, right: x2, bottom: y2, width: x2 - x1, height: y2 - y1 } : null;
  };
  const vis = (e) => { if (!e.isConnected) return false; const r = e.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return false; const cs = getComputedStyle(e); return cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05 && !!seen(e); };
  // a modal dialog open: only what is in it can be used
  const modal = [...document.querySelectorAll('dialog[open]')].find((d) => d.matches(':modal'));
  const label = (e) => { const t = (e.getAttribute('aria-label') || e.getAttribute('title') || e.innerText || e.value || e.placeholder || '').trim().replace(/\s+/g, ' '); return (e.id ? '#' + e.id + ' ' : '') + e.tagName.toLowerCase() + (t ? ' "' + t.slice(0, 40) + '"' : ''); };
  const where = (e) => { const s = []; let n = e; while (n && n !== document.body && s.length < 4) { s.unshift(n.id ? '#' + n.id : n.tagName.toLowerCase() + (n.classList[0] ? '.' + n.classList[0] : '')); if (n.id) break; n = n.parentElement; } return s.join(' > '); };
  const out = { overlap: [], clipped: [], unnamed: [], focus: [], sideways: [], plain: [], dismiss: [] };
  const ctrls = [...(modal || document).querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=tab], [role=button], [role=separator][tabindex], summary')].filter(vis);
  // overlap: centre and corners (inset 3 px) belong to the control
  ctrls.forEach((e) => {
    const r = seen(e), pts = [[r.left + r.width / 2, r.top + r.height / 2], [r.left + 3, r.top + 3], [r.right - 3, r.bottom - 3]];
    // (content scrolled under a sticky or fixed bar — the top bar, a group heading — is not covered)
    const stuck = (h) => { for (let n = h; n && n !== document.body; n = n.parentElement) { const pz = getComputedStyle(n).position; if (pz === 'sticky' || pz === 'fixed') return !n.contains(e); } return false; };
    const bad = pts.filter(([x, y]) => { if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return false; const h = document.elementFromPoint(x, y); return h && h !== e && !e.contains(h) && !h.contains(e) && !(e.labels && [...e.labels].some((l) => l.contains(h))) && !stuck(h); });
    if (bad.length >= 2) { const h = document.elementFromPoint(bad[0][0], bad[0][1]); out.overlap.push(label(e) + ' — under ' + (h ? where(h) : '?')); }
  });
  // clipped text: overflows its box, the overflow hidden, no ellipsis, no title (inputs and code panes scroll on purpose)
  document.querySelectorAll('body *').forEach((e) => {
    if (!vis(e) || /^(INPUT|TEXTAREA|SELECT|PRE|CODE|svg|path|OPTION|IMG|CANVAS)$/i.test(e.tagName)) return;
    const own = [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()); if (!own) return;
    const cs = getComputedStyle(e);
    const hidX = /hidden|clip/.test(cs.overflowX) && e.scrollWidth > e.clientWidth + 1;
    const hidY = /hidden|clip/.test(cs.overflowY) && e.scrollHeight > e.clientHeight + 2 && cs.webkitLineClamp === 'none';
    if ((hidX && cs.textOverflow !== 'ellipsis') || hidY) {
      if (e.title || (e.closest('[title]') && e.closest('[title]') !== document.body)) return;
      out.clipped.push(where(e) + ' "' + e.textContent.trim().slice(0, 40) + '"');
    }
  });
  // unnamed controls
  ctrls.forEach((e) => {
    const name = (e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || e.getAttribute('title') || (e.innerText || '').trim() || (e.labels && e.labels.length) || e.getAttribute('placeholder') || (e.tagName === 'INPUT' && /^(submit|button)$/.test(e.type) && e.value));
    if (!name) out.unnamed.push(where(e));
  });
  // looks like text: words, but no border, no background (other than what is behind it) and no underline. Not judged:
  // tabs, choices in a group (radio, segmented, pressed / selected / current), menu items, fold toggles, navigation
  const CLEAR = /rgba\(0, 0, 0, 0\)|transparent/;
  const behind = (n) => { for (; n; n = n.parentElement) { const b = getComputedStyle(n).backgroundColor; if (!CLEAR.test(b)) return b; } return 'rgb(255, 255, 255)'; };
  ctrls.filter((e) => e.tagName === 'BUTTON' || e.getAttribute('role') === 'button').forEach((e) => {
    if (e.matches('[role=tab],[role=radio],[role=menuitem],[role=menuitemradio],[role=switch],[aria-pressed],[aria-selected],[aria-current],[aria-expanded]')) return;
    // the sidebar logo (goes Home), file tabs (the current one underlined), rows of a list (the row is the control)
    if (e.matches('.sb-brand, .code-tab, .ss-ed-hrow')) return;
    if (e.closest('nav, [role=navigation], [role=tablist], [role=radiogroup], [role=menu], [role=listbox], [role=group]')) return;
    const txt = (e.innerText || '').trim(); if (!/[\p{L}\p{N}]/u.test(txt)) return;   // no words: an icon (✕ included)
    const cs = getComputedStyle(e);
    const border = ['Top', 'Right', 'Bottom', 'Left'].some((s) => parseFloat(cs['border' + s + 'Width']) > 0 && !CLEAR.test(cs['border' + s + 'Color']));
    const fill = !CLEAR.test(cs.backgroundColor) && cs.backgroundColor !== behind(e.parentElement);
    const under = [e, ...e.querySelectorAll('*')].some((x) => /underline/.test(getComputedStyle(x).textDecorationLine));
    if (!border && !fill && !under) out.plain.push(where(e) + ' "' + txt.slice(0, 30) + '"');
  });
  // sideways scroll: the page, or a panel whose content is wider than it (not code and tables, which scroll on purpose)
  const de = document.documentElement;
  if (de.scrollWidth > de.clientWidth + 2) out.sideways.push('page +' + (de.scrollWidth - de.clientWidth) + 'px');
  // a panel that scrolls sideways may hold wide content, but never a control that can only be reached by scrolling it
  [...document.querySelectorAll('*')].forEach((n) => {
    if (n.scrollWidth <= n.clientWidth + 2 || !/auto|scroll/.test(getComputedStyle(n).overflowX) || !n.offsetParent) return;
    const r = n.getBoundingClientRect(); if (r.width < 40 || r.bottom < 0 || r.top > innerHeight) return;
    const cut = [...n.querySelectorAll('button, a[href], input:not([type=hidden]), select, [role=button]')].filter((c) => {
      const q = c.getBoundingClientRect(); if (!q.width || q.bottom < r.top || q.top > r.bottom) return false;
      return q.right > r.left + n.clientWidth + 1 || q.left < r.left - 1;
    });
    if (cut.length) out.sideways.push(where(n) + ' hides ' + cut.length + ' control(s) sideways, e.g. ' + where(cut[0]));
  });
  return out;
}

// the open pop-up of a document (a modal <dialog>, or an engine overlay with role=dialog aria-modal): where to click
// outside it → { x, y, id } in that document's coordinates, or null
function popupOf() {
  const d = [...document.querySelectorAll('dialog[open]')].find((x) => x.matches(':modal'));
  const o = d || [...document.querySelectorAll('[role=dialog][aria-modal=true]')].find((x) => x.offsetParent && x.getBoundingClientRect().width > 0);
  if (!o) return null;
  const r = o.getBoundingClientRect();
  const x = r.left > 40 ? 12 : r.right < innerWidth - 40 ? innerWidth - 12 : r.left + r.width / 2;
  const y = r.top > 40 ? 12 : r.bottom < innerHeight - 40 ? innerHeight - 12 : r.top + r.height / 2;
  return { x, y, id: o.id || o.getAttribute('aria-label') || o.className };
}
function popupOpen(id) {
  const o = document.getElementById(id) || [...document.querySelectorAll('[role=dialog][aria-modal=true]')].find((x) => (x.getAttribute('aria-label') || x.className) === id);
  if (!o) return false;
  return o.tagName === 'DIALOG' ? o.open : !!o.offsetParent;
}
const POPUPS = new Set();   // the pop-ups the dismiss check clicked outside of (printed, so a skipped one shows)
async function dismissCheck(p, frameId) {
  const fr = frameId ? await (await p.$('#iframe-' + frameId)).contentFrame() : p.mainFrame();
  const at = await fr.evaluate(popupOf);
  if (!at) return [];
  POPUPS.add(String(at.id).slice(0, 40));
  let ox = 0, oy = 0;
  if (frameId) { const b = await (await p.$('#iframe-' + frameId)).boundingBox(); ox = b.x; oy = b.y; }
  await p.mouse.click(ox + at.x, oy + at.y);
  await p.waitForTimeout(250);
  return (await fr.evaluate(popupOpen, at.id)) ? ['"' + String(at.id).slice(0, 40) + '" stays open after a click outside it'] : [];
}

async function focusCheck(p, max) {
  const found = [];
  for (let i = 0; i < max; i++) {
    await p.keyboard.press('Tab');
    const r = await p.evaluate(() => {
      let d = document, a = d.activeElement;
      while (a && a.tagName === 'IFRAME') { try { d = a.contentDocument; a = d.activeElement; } catch (e) { break; } }
      if (!a || a === d.body || a === d.documentElement) return null;
      if (a.dataset.rvFocus) return { again: true };
      a.dataset.rvFocus = '1';
      // the control or the box around it (a search field shows its focus on its frame, :focus-within)
      const one = (x) => { const c = getComputedStyle(x); return [c.outlineStyle !== 'none' && parseFloat(c.outlineWidth) > 0 ? c.outlineWidth + ' ' + c.outlineColor : '', c.boxShadow, c.borderColor, c.backgroundColor, c.textDecorationLine].join('|'); };
      const sig = () => [a, a.parentElement, a.parentElement && a.parentElement.parentElement].filter(Boolean).map(one).join('#');
      const on = sig(); a.blur(); const off = sig(); a.focus({ preventScroll: true });
      const t = (a.getAttribute('aria-label') || a.getAttribute('title') || a.innerText || a.value || a.placeholder || '').trim().replace(/\s+/g, ' ');
      return on === off ? { bad: (a.id ? '#' + a.id + ' ' : '') + a.tagName.toLowerCase() + (t ? ' "' + t.slice(0, 40) + '"' : '') } : {};
    });
    if (!r) continue;
    if (r.again) break;   // round the page once
    if (r.bad) found.push(r.bad);
  }
  // clean the markers (the next screen starts afresh)
  await p.evaluate(() => { const clean = (d) => { d.querySelectorAll('[data-rv-focus]').forEach((x) => delete x.dataset.rvFocus); d.querySelectorAll('iframe').forEach((fr) => { try { clean(fr.contentDocument); } catch (e) { /* other origin */ } }); }; clean(document); });
  return found;
}

// --selftest: one planted problem of each kind; every check must find its own (proves the checks see what they claim)
const PLANTED = `<!doctype html><html><head><style>
  body { font: 14px sans-serif; margin: 20px; } button { font: inherit; }
  .cover { position: absolute; left: 20px; top: 20px; width: 160px; height: 40px; background: #eee; }
  .clip { width: 80px; overflow: hidden; white-space: nowrap; }
  .nofocus:focus { outline: none; }
  .wide { width: 3000px; height: 4px; }
</style></head><body>
  <button id="under" style="width:150px;height:30px">Covered button</button><div class="cover"></div>
  <div style="margin-top:60px" class="clip" id="clipped">This sentence is far too long for its box</div>
  <button id="noname"><svg width="10" height="10"></svg></button>
  <button id="nofocus" class="nofocus" style="border:1px solid #888;background:#fff">No focus ring</button>
  <div class="wide"></div>
  <div id="strip" style="width:120px;overflow-x:auto;white-space:nowrap"><span style="display:inline-block;width:300px">Wide</span><button>Past the edge</button></div>
  <button id="flat" style="border:0;background:none;font:inherit">Take out</button>
  <dialog id="stay"><p>A pop-up</p><button>Close</button></dialog>
</body></html>`;
async function selftest(b) {
  const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
  await p.setContent(PLANTED);
  const r = await p.evaluate(inspect);
  r.focus = await focusCheck(p, 20);
  await p.evaluate(() => document.getElementById('stay').showModal());
  r.dismiss = await dismissCheck(p, null);
  const want = { overlap: /#under/, clipped: /#clipped/, unnamed: /#noname/, focus: /#nofocus/, sideways: /page \+/, panel: /#strip hides/, plain: /#flat/, dismiss: /stay/ };
  let fail = 0;
  for (const k of Object.keys(want)) {
    const hit = (r[k === 'panel' ? 'sideways' : k] || []).some((x) => want[k].test(x));
    console.log((hit ? 'PASS ' : 'FAIL ') + k + ' finds its planted problem' + (hit ? '' : ' — got ' + JSON.stringify(r[k])));
    if (!hit) fail++;
  }
  await p.close();
  return fail;
}

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  if (args.includes('--selftest')) { const n = await selftest(b); await b.close(); process.exitCode = n ? 1 : 0; return; }
  fs.mkdirSync(OUT, { recursive: true });
  const report = [];
  for (const theme of THEMES) for (const w of SIZES) {
    const p = await b.newPage({ viewport: { width: w, height: HEIGHT[w] || 1000 }, extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.' + (40 + SIZES.indexOf(w) + THEMES.indexOf(theme) * 5) } });
    const errs = [];
    p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(BASE); await p.waitForLoadState('networkidle');
    await p.evaluate((t) => { if (document.documentElement.getAttribute('data-theme') !== t) document.getElementById('tb-theme').click(); }, theme);
    await p.waitForTimeout(250);
    const go = (pg) => p.evaluate((x) => PerfxShell.go(x, { instant: true }), pg);
    const frameOf = async (id) => (await p.$('#iframe-' + id)).contentFrame();
    const run = async (name, frameId) => {
      if (ONLY && !name.toLowerCase().includes(ONLY.toLowerCase())) return;
      await p.waitForTimeout(400);
      const shell = await p.evaluate(inspect);
      const inner = frameId ? await (await frameOf(frameId)).evaluate(inspect) : null;
      const file = `${theme}-${w}-${name.replace(/\W+/g, '-')}.jpg`;
      await p.screenshot({ path: path.join(OUT, file), type: 'jpeg', quality: 55 });
      const merge = {}; Object.keys(shell).forEach((k) => { merge[k] = shell[k].concat(inner ? inner[k] : []); });
      merge.focus = await focusCheck(p, 80);
      merge.dismiss = await dismissCheck(p, frameId);
      report.push({ theme, w, name, file, ...merge });
      process.stdout.write('.');
    };
    let f;
    await go('home'); await run('Home');
    await go('postman'); await run('Postman');
    await p.setInputFiles('#fi-col', COL + 'advanced_enterprise_postman_collection.json'); await p.setInputFiles('#fi-env', COL + 'advanced_enterprise_environment.json');
    await p.click('#btn-cvt'); await p.waitForSelector('#cv-pv:not([hidden]) #cv-pv-cols', { timeout: 60000 });
    await p.$eval('#cv-pv', (x) => x.scrollIntoView()); await run('Postman result');
    await p.click('#cv-pv-tab-values'); await run('Postman values'); await p.click('#cv-pv-tab-files');
    await go('jmeter'); await run('JMeter');
    await p.setInputFiles('#fi-jmx', FX + 'converter/inputs/rich.jmx'); await p.click('#btn-jmx');
    await p.waitForSelector('#cv-pv:not([hidden]) #cv-pv-cols', { timeout: 60000 });
    await p.$eval('#cv-pv', (x) => x.scrollIntoView()); await run('JMeter result');
    await go('explore'); await p.waitForFunction(() => { const d = document.getElementById('iframe-explorer').contentDocument; return d && d.getElementById('hx-file'); }, null, { timeout: 20000 });
    await run('Explorer start', 'explorer');
    f = await frameOf('explorer'); await f.setInputFiles('#hx-file', COL + 'WebTours.har'); await f.waitForSelector('#hx-ws:not([hidden])');
    await f.click('.hx-req >> nth=4'); await run('Explorer workspace', 'explorer');
    await go('studio'); await p.waitForFunction(() => { const x = document.getElementById('iframe-studio').contentWindow; return x && x.document.readyState === 'complete' && typeof x.loadFile === 'function'; }, null, { timeout: 20000 });
    await run('Studio start', 'studio');
    f = await frameOf('studio');
    await f.setInputFiles('#dz1 input[type=file]', FX + 'studio/fixtures/oauth-pkce-sso.har');
    await f.waitForFunction(() => document.body.classList.contains('ss-view-ws') && !document.body.classList.contains('ss-reading'), null, { timeout: 60000 });
    if (await f.isVisible('.bg-review-apply')) { await f.click('.bg-review-apply'); await p.waitForTimeout(1000); }
    await run('Studio 1 requests', 'studio');
    // every Studio pop-up once, so the dismiss check clicks outside each of them (closed again if it stayed open)
    const shut = () => f.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => d.close());
      ['closeHostRename', 'closeAdvisorModal', 'closePasteCorrelate'].forEach((k) => { try { if (document.querySelector('.adv-modal-overlay[style*="flex"], .adv-modal-overlay[style*="block"]')) window[k](); } catch (e) { /* closed */ } });
    });
    const pops = [
      ['Studio new transaction', () => { const b = document.getElementById('ss-sel-group'); b.disabled = false; b.click(); }],
      ['Studio question', () => SS.ask('Leave this step?', 'A question the page asks.', 'Leave', () => {})],
      ['Studio server rename', () => openHostRename(Object.keys(PerfxStudio.state().hostParams.map)[0])],
      ['Studio every place', () => advisorShowUses(PerfxStudio.state().advisorCandidates[0].id)],
      ['Studio add custom correlation', () => openAdvisorModal()],
    ];
    for (const [name, open] of pops) { await f.evaluate(open); await run(name, 'studio'); await shut(); }
    await f.click('#ss-steps [data-step="2"]'); await run('Studio 2 correlate', 'studio');
    await f.click('#ss-cr-show [data-show="script"]'); await run('Studio 2 in the script', 'studio'); await f.click('#ss-cr-show [data-show="review"]');
    await f.evaluate(() => { const c = PerfxStudio.state().advisorCandidates.find((x) => x.varName === 'State') || PerfxStudio.state().advisorCandidates[0]; if (c) SSE.open(c.id); });
    await run('Studio editor', 'studio');
    await f.click('#ss-ed-run').catch(() => {}); await run('Studio editor test', 'studio'); await f.evaluate(() => { const d = document.getElementById('ss-test-dlg'); if (d.open) d.close(); });
    await f.evaluate(() => SSE.close()); await f.evaluate(() => SSE.add()); await run('Studio add manual', 'studio'); await f.evaluate(() => SSE.close());
    await f.evaluate(() => openPasteCorrelate()); await run('Studio paste and detect', 'studio'); await f.evaluate(() => { try { closePasteCorrelate(); } catch (e) { /* closed */ } });
    await f.click('#ss-cr-test'); await run('Studio test dialog', 'studio'); await f.evaluate(() => { const d = document.getElementById('ss-test-dlg'); if (d.open) d.close(); });
    await f.evaluate(() => document.getElementById('corr-panel').scrollIntoView()); await run('Studio correlation details', 'studio');
    await f.click('#ss-steps [data-step="3"]'); await p.waitForTimeout(200);
    if (await f.isVisible('#ss-ask')) await f.click('#ss-ask-no');
    await run('Studio 3 test data', 'studio');
    await f.click('#ss-steps [data-step="4"]'); await run('Studio 4 download', 'studio');
    await f.click('#ss-steps [data-step="1"]');
    await go('workload'); await p.waitForFunction(() => { const d = document.getElementById('iframe-workload').contentDocument; return d && d.getElementById('dropzone'); }, null, { timeout: 20000 });
    await run('Workload start', 'workload');
    f = await frameOf('workload'); await f.click('#btn-example'); await f.click('#v-detail').catch(() => {}); await run('Workload model', 'workload');
    // a recording filled in: every transaction of one iteration in a window
    await f.setInputFiles('#in-fill', COL + 'petstore.octoperf.com.har');
    await f.waitForFunction(() => document.querySelector('[data-txlist]'), null, { timeout: 30000 });
    await f.evaluate(() => openTxList(document.querySelector('[data-txlist]').dataset.txlist)); await run('Workload transactions', 'workload');
    await f.evaluate(() => { const d = document.getElementById('wm-tx-dlg'); if (d && d.open) d.close(); });
    await go('results'); await p.waitForFunction(() => { const d = document.getElementById('iframe-analyser').contentDocument; return d && d.getElementById('in-zip'); }, null, { timeout: 20000 });
    await run('Analyser start', 'analyser');
    if (fs.existsSync(FX + 'qa/demo-run.zip')) { f = await frameOf('analyser'); await f.setInputFiles('#in-zip', FX + 'qa/demo-run.zip'); await p.waitForTimeout(9000); await run('Analyser report', 'analyser'); }
    await go('help'); await run('Help');
    report.push({ theme, w, name: '_errors', errs });
    await p.close();
  }
  await b.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 1));
  // summary: each finding once (by screen), with the sizes / themes it was seen at
  const by = new Map();
  report.filter((r) => r.name !== '_errors').forEach((r) => ['overlap', 'clipped', 'unnamed', 'focus', 'sideways', 'plain', 'dismiss'].forEach((k) => (r[k] || []).forEach((x) => {
    const key = r.name + '|' + k + '|' + x; if (!by.has(key)) by.set(key, []); by.get(key).push(r.theme + ' ' + r.w);
  })));
  console.log('\npop-ups checked for a click outside: ' + ([...POPUPS].join(' · ') || 'none'));
  console.log(by.size + ' distinct findings');
  [...by.entries()].sort().forEach(([k, at]) => { const [n, kind, x] = k.split('|'); console.log(`${n.padEnd(26)} ${kind.padEnd(8)} ${x}  [${at.length === SIZES.length * THEMES.length ? 'all' : at.join(', ')}]`); });
  report.filter((r) => r.name === '_errors' && r.errs.length).forEach((r) => console.log(`page errors ${r.theme} ${r.w}: ${r.errs.join(' | ')}`));
})();
