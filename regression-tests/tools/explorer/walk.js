#!/usr/bin/env node
// HAR Explorer, the parts that are easier to read — checked as a user, at four widths:
// folded panels look like buttons, the response preview shows its focus, the tabs fit one row when the details are
// wide enough (never a tab out of sight), the address breaks only after / ? & = (its text unchanged), Hide secrets sits
// with Copy URL and Copy as cURL and still works, long domain names wrap instead of being cut, a narrow request list
// drops the timeline then the size (never the address), Find a value shows three ways to begin.
//   node walk.js [page URL]   (default http://localhost:3999/converter/har-explorer)
'use strict';
const path = require('path');
const ROOT = path.resolve(__dirname, '../../..');
const { chromium } = require(path.join(ROOT, 'cdp-recorder/recorder/node_modules/playwright-core'));
const URL = process.argv[2] || 'http://localhost:3999/converter/har-explorer';
const HAR = path.join(ROOT, 'regression-tests/tools/studio/fixtures/rich-shop.har'), WEB = path.join(ROOT, 'collection-examples/WebTours.har');
let ok = 0, bad = 0;
const check = (w, what, pass, got) => { if (pass) ok++; else { bad++; console.log(`FAIL ${w}  ${what}${got !== undefined ? ' — ' + JSON.stringify(got) : ''}`); } };

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  for (const [w, h] of [[1912, 980], [1600, 900], [1366, 768], [1100, 800]]) {
    for (const theme of ['light', 'dark']) {
      const W = w + ' ' + theme, p = await b.newPage({ viewport: { width: w, height: h } }), errs = [];
      p.on('pageerror', (e) => errs.push(e.message)); await p.route('**/analytics/**', (r) => r.fulfill({ status: 204 }));
      await p.goto(URL); await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } }); await p.reload();
      await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await p.setInputFiles('#hx-file', HAR); await p.waitForSelector('#hx-ws:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(800);
      await p.click('.hx-req >> nth=6'); await p.waitForTimeout(400);
      const d = await p.evaluate(() => {
        const q = (s) => document.querySelector(s), tabs = [...document.querySelectorAll('#hx-det .hx-tab')], code = q('#hx-det .hx-durl code');
        const need = tabs.reduce((s, x) => s + x.getBoundingClientRect().width, 0) + 2 * (tabs.length - 1);
        const box = q('#hx-det').getBoundingClientRect();
        return {
          rows: new Set(tabs.map((x) => Math.round(x.getBoundingClientRect().top))).size, room: q('#hx-det .hx-tabs').clientWidth, need,
          inside: tabs.every((x) => { const r = x.getBoundingClientRect(); return r.right <= box.right + 1 && r.left >= box.left - 1; }),
          wbr: code.querySelectorAll('wbr').length, text: code.textContent, sel: q('.hx-req.sel .u .p').textContent,
          maskInRow: !!q('#hx-det .hx-dsum .r #hx-maskbtn'), maskAfter: (() => { const m = q('#hx-maskbtn'), c = q('#hx-det [data-copy=curl]'); return !!(m && c && c.compareDocumentPosition(m) & Node.DOCUMENT_POSITION_FOLLOWING); })(),
          over: (() => { const hb = q('#hx-det-hide'); if (!hb || !hb.offsetParent) return false; const r = hb.getBoundingClientRect(); return [...document.querySelectorAll('#hx-det .hx-dh button, #hx-det .hx-durl code')].filter((x) => x !== hb).some((x) => { const o = x.getBoundingClientRect(); return o.right > r.left && o.left < r.right && o.bottom > r.top && o.top < r.bottom; }); })(),
          docked: q('#hx-panes').classList.contains('dock-dom'),
          domCut: [...document.querySelectorAll('#hx-dom-list .hx-dom-row .h')].filter((x) => x.offsetParent && x.scrollWidth > x.clientWidth + 1).length,
          listW: q('#hx-reqpane').clientWidth, wf: !!(q('.hx-req > .wf') && q('.hx-req > .wf').offsetParent), sz: !!(q('.hx-req > .sz') && q('.hx-req > .sz').offsetParent),
          addrW: q('.hx-req .u').getBoundingClientRect().width,
        };
      });
      // tabs: one row when there is room for them; never one outside the panel
      if (d.room >= d.need) check(W, 'tabs on one row when they fit', d.rows === 1, d); else check(W, 'tabs wrap (no room) — none out of sight', d.inside, d);
      check(W, 'every tab inside the panel', d.inside);
      // the address: break hints, text unchanged
      check(W, 'address has break hints', d.wbr >= 3, d.wbr);
      check(W, 'address text unchanged', /^https:\/\/api\.example-outdoor\.com\/v2\//.test(d.text) && d.text.endsWith(d.sel.replace(/^\/v2\//, '').slice(-4)), d.text);
      // Hide secrets in the row with Copy URL / cURL, after them, and clear of the hide button
      check(W, 'Hide secrets in the buttons row, after Copy as cURL', d.maskInRow && d.maskAfter);
      check(W, 'nothing under the panel\'s hide button', !d.over);
      const before = await p.evaluate(() => document.getElementById('hx-det').innerText);
      await p.click('#hx-maskbtn'); await p.waitForTimeout(150);
      const masked = await p.evaluate(() => ({ t: document.getElementById('hx-det').innerText, pressed: document.getElementById('hx-maskbtn').getAttribute('aria-pressed'), inRow: !!document.querySelector('#hx-det .hx-dsum .r #hx-maskbtn') }));
      check(W, 'Hide secrets hides the token', masked.t !== before && !/Bearer eyJ/.test(masked.t) && /Bearer eyJ/.test(before), masked.t.slice(0, 80));
      check(W, 'Hide secrets pressed and still in the row after the redraw', masked.pressed === 'true' && masked.inRow, masked);
      await p.click('#hx-maskbtn'); await p.waitForTimeout(150);
      check(W, 'Show secrets brings them back', await p.evaluate((b0) => document.getElementById('hx-det').innerText === b0, before));
      // domains: wrapped, not cut (docked panel)
      if (d.docked) check(W, 'domain names not cut', d.domCut === 0, d.domCut);
      // a narrow list: timeline, then size go; the address stays
      if (d.listW <= 560) check(W, 'narrow list: no timeline, no size', !d.wf && !d.sz, d);
      else if (d.listW <= 700) check(W, 'narrower list: no timeline, size kept', !d.wf && d.sz, d);
      else check(W, 'wide list: timeline and size', d.wf && d.sz, d);
      check(W, 'address column has room', d.addrW >= 150, d.addrW);
      // Find a value: three ways to begin, and it still finds
      await p.click('#hx-findbtn'); await p.waitForTimeout(1800);
      const f = await p.evaluate(() => { const s = document.querySelector('.hx-fstart'); return s ? { items: s.querySelectorAll('ol li').length, head: s.querySelector('.hx-fstart-h').textContent, by: !!s.querySelector('.by') } : null; });
      check(W, 'Find a value: three ways to begin', f && f.items === 3 && f.head === 'Three ways to begin' && f.by, f);
      await p.locator('[data-sugg]').first().click(); await p.waitForTimeout(900);
      check(W, 'a suggestion gives an answer (the start steps go)', await p.evaluate(() => !document.querySelector('.hx-fstart') && document.getElementById('hx-det').innerText.length > 200));
      await p.keyboard.press('Escape'); await p.waitForTimeout(300);
      // folded panels: a filled rail, a different fill on hover, opens again
      const ids = await p.evaluate(() => ['hx-dom-hide', 'hx-hide', 'hx-det-hide'].filter((id) => { const x = document.getElementById(id); return x && x.offsetParent; }));
      for (const id of ids) {
        await p.click('#' + id); await p.mouse.move(2, 2); await p.waitForTimeout(200);   // the rail opens under the mouse: move away first
        const rail = await p.evaluate(() => { const r = [...document.querySelectorAll('.hx-rail')].find((x) => x.offsetParent); if (!r) return null; return { id: r.id, bg: getComputedStyle(r).backgroundColor, page: getComputedStyle(r.parentElement).backgroundColor }; });
        check(W, 'folded ' + id + ': rail has a fill', rail && rail.bg !== 'rgba(0, 0, 0, 0)' && rail.bg !== rail.page, rail);
        if (rail) { await p.hover('#' + rail.id); await p.waitForTimeout(120); const hov = await p.evaluate((rid) => getComputedStyle(document.getElementById(rid)).backgroundColor, rail.id); check(W, 'rail ' + rail.id + ' changes on hover', hov !== rail.bg, hov); await p.click('#' + rail.id); await p.waitForTimeout(200); }
      }
      check(W, 'panels back', await p.evaluate(() => !/no-(dom|list|det)/.test(document.getElementById('hx-panes').className)));
      // the response preview shows its focus (a recording with pages: WebTours) — reached with Tab, as a keyboard user
      await p.click('#hx-another'); await p.waitForTimeout(300); await p.setInputFiles('#hx-file', WEB); await p.waitForSelector('#hx-ws:not([hidden])', { timeout: 60000 }); await p.waitForTimeout(800);
      await p.click('.hx-req >> nth=4'); await p.click('#hx-det .hx-tab[data-tab="preview"]'); await p.waitForTimeout(300);
      let fr = null;
      for (let i = 0; i < 40 && !fr; i++) { await p.keyboard.press('Tab'); fr = await p.evaluate(() => { const a = document.activeElement; if (!a || a.tagName !== 'IFRAME') return null; const c = getComputedStyle(a); return { cls: a.className, style: c.outlineStyle, width: c.outlineWidth }; }); }
      check(W, 'Tab reaches the preview', !!fr);
      check(W, 'preview shows a focus ring', fr && fr.style !== 'none' && parseFloat(fr.width) >= 2, fr);
      await p.keyboard.press('Shift+Tab'); await p.waitForTimeout(80);
      check(W, 'the ring goes when the focus leaves', await p.evaluate(() => { const f = document.querySelector('#hx-det .hx-frame'); return document.activeElement !== f && getComputedStyle(f).outlineStyle === 'none'; }));
      check(W, 'no page errors', !errs.length, errs);
      check(W, 'no sideways scroll', await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await p.close();
    }
  }
  console.log(`${ok} passed, ${bad} failed`);
  await b.close(); process.exit(bad ? 1 : 0);
})();
