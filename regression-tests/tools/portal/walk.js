#!/usr/bin/env node
// Home and Help, as a user: the tool grid, the picture's outputs, the workflow, Documentation, Quick Start's six paths,
// "In this section" and the FAQ topics — every check says what it proves.
//   node walk.js [portal URL]          (default http://localhost:3999/converter/)
'use strict';
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const URL = process.argv[2] || 'http://localhost:3999/converter/';
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); } };

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  for (const [w, h] of [[1920, 1080], [1366, 768], [1000, 800], [420, 900]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }), errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(URL); await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } }); await p.reload(); await p.waitForTimeout(600);
    const W = w + ' px: ';
    // ── Home ──
    const grid = await p.evaluate(() => [...document.querySelectorAll('#portal-home .hm-tool')].map((x) => { const r = x.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.width)]; }));
    const rows = [...new Set(grid.map((g) => g[0]))].length, widths = [...new Set(grid.map((g) => g[1]))];
    const want = w >= 1300 ? 2 : w >= 800 ? 3 : 6;   // three per row, two per row, one per row (the page width beside the sidebar)
    ok(W + 'six tools, ' + want + ' rows, every card the same width', grid.length === 6 && rows === want && widths.length === 1, { rows, widths });
    if (w >= 1000) ok(W + 'the picture: four inputs, four outputs (the LRE scenario too)', await p.evaluate(() => document.querySelectorAll('.hm-map-in li').length === 4 && [...document.querySelectorAll('.hm-map-out li')].map((x) => x.textContent.trim()).join('|') === 'VuGen script|Performance insights|Reports (Excel / PDF)|LRE scenario (Vusers, pacing)'));
    const steps = await p.evaluate(() => [...document.querySelectorAll('.hm-step-list li')].map((x) => x.querySelector('b').textContent + '>' + ((x.querySelector('button') || {}).textContent || 'In LRE').trim()));
    ok(W + 'the workflow: five steps, Plan the load before running it', steps.join(' | ') === 'Record a user journey>Open | Correlate dynamic values>Open | Plan the load>Plan | Run the load test>In LRE | Analyse the results>Analyse', steps);
    await p.click('.hm-step-list li:nth-child(3) button'); await p.waitForTimeout(500);
    ok(W + 'Plan opens the Workload Modeller', (await p.textContent('#tb-name')).trim() === 'Workload Modeller');
    await p.goto(URL); await p.waitForTimeout(400);
    await p.click('.hm-help-tiles button:has-text("Documentation")'); await p.waitForTimeout(500);
    ok(W + 'Documentation opens the tool guides (Overview), Quick Start its own card', (await p.evaluate(() => (document.querySelector('#portal-help .help-acc-item.cur') || {}).id)) === 'hacc-overview');
    // ── Help: Quick Start ──
    await p.evaluate(() => haccJump('hacc-quickstart')); await p.waitForTimeout(300);
    const paths = await p.evaluate(() => [...document.querySelectorAll('#hacc-quickstart .help-path')].map((x) => { const r = x.getBoundingClientRect(); return [x.querySelector('.help-path-title').textContent.trim().slice(0, 6), Math.round(r.top)]; }));
    ok(W + 'Quick Start: six paths, A to F', paths.map((x) => x[0]).join(',') === 'Path A,Path B,Path C,Path D,Path E,Path F' && /Six paths/.test(await p.textContent('#hacc-quickstart .help-acc-sub')), paths);
    if (w >= 1366) ok(W + 'three paths to a row', [...new Set(paths.map((x) => x[1]))].length === 2);
    // ── Help: In this section ──
    await p.evaluate(() => haccJump('hacc-studio')); await p.waitForTimeout(400);
    const ins = await p.evaluate(() => { const n = document.querySelector('#hacc-studio .help-insec'); return n ? { shown: !!n.getClientRects().length, items: [...n.querySelectorAll('button')].map((x) => x.textContent), heads: [...document.querySelectorAll('#hacc-studio .help-acc-inner > .help-h3')].map((x) => x.textContent.trim()) } : null; });
    ok(W + 'In this section lists every heading of the section', ins && ins.items.join('|') === ins.heads.join('|') && ins.items.length >= 3, ins);
    ok(W + (w >= 1900 ? 'shown beside the text' : 'not shown (the section is too narrow)'), ins && ins.shown === (w >= 1900));
    if (w >= 1900) {
      const box = await p.evaluate(() => { const n = document.querySelector('#hacc-studio .help-insec').getBoundingClientRect(), t = [...document.querySelectorAll('#hacc-studio .help-p')].map((x) => x.getBoundingClientRect().right); return { navLeft: n.left, textRight: Math.max(...t), right: n.right, inner: document.querySelector('#hacc-studio .help-acc-inner').getBoundingClientRect().right }; });
      ok(W + '… beside the text, never over it, inside the section', box.navLeft > box.textRight + 16 && box.right <= box.inner, box);
      const k = 6; await p.click(`#hacc-studio .help-insec button >> nth=${k}`); await p.waitForTimeout(900);
      const at = await p.evaluate((k) => { const hd = document.querySelectorAll('#hacc-studio .help-acc-inner > .help-h3')[k].getBoundingClientRect().top; const n = document.querySelector('#hacc-studio .help-insec'); return { hd: Math.round(hd), cur: (n.querySelector('[aria-current]') || {}).textContent, want: document.querySelectorAll('#hacc-studio .help-acc-inner > .help-h3')[k].textContent.trim(), navTop: Math.round(n.getBoundingClientRect().top) }; }, k);
      ok(W + 'a click goes to that heading and marks it', at.hd > 60 && at.hd < 260 && at.cur === at.want, at);
      ok(W + '… and the list stays in view', at.navTop > 60 && at.navTop < 260, at);
      await p.evaluate(() => window.scrollTo(0, document.body.scrollHeight)); await p.waitForTimeout(300);
      const end = await p.evaluate(() => { const n = document.querySelector('#hacc-studio .help-insec'), r = n.getBoundingClientRect(), s = document.querySelector('#hacc-studio').getBoundingClientRect(); return { navBottom: r.bottom, secBottom: s.bottom, vis: getComputedStyle(n).visibility }; });
      ok(W + 'at the end of the section the list stops inside it', end.vis === 'hidden' || end.navBottom <= end.secBottom + 1, end);
    }
    await p.evaluate(() => haccJump('hacc-privacy')); await p.waitForTimeout(300);
    const few = await p.evaluate(() => ({ heads: document.querySelectorAll('#hacc-privacy .help-acc-inner > .help-h3').length, nav: !!document.querySelector('#hacc-privacy .help-insec') }));
    ok(W + 'a section with fewer than three headings has no list', few.heads >= 3 || !few.nav, few);
    // ── Help: the FAQ topics ──
    await p.evaluate(() => haccJump('hacc-faq')); await p.waitForTimeout(300);
    const vis = () => p.evaluate(() => [...document.querySelectorAll('#hacc-faq .help-faq-item')].filter((x) => x.getClientRects().length).length);
    const chips = await p.evaluate(() => [...document.querySelectorAll('.help-faq-topics button')].map((x) => x.textContent.replace(/\s+/g, ' ').trim()));
    const sum = chips.slice(1).reduce((a, c) => a + +c.split(' ').pop(), 0);
    ok(W + 'FAQ topics: All 19, the topics add up to 19', chips[0] === 'All 19' && sum === 19 && (await vis()) === 19, chips);
    await p.click('.help-faq-topics [data-topic=recording]'); await p.waitForTimeout(150);
    ok(W + 'Recording: only its 5 questions', (await vis()) === 5 && (await p.getAttribute('.help-faq-topics [data-topic=recording]', 'aria-pressed')) === 'true');
    await p.fill('#portal-help input[type=search], #help-search', 'DPoP'); await p.waitForTimeout(500);
    ok(W + 'while searching the topics step aside and every match shows', !(await p.isVisible('.help-faq-topics')) && (await p.evaluate(() => [...document.querySelectorAll('#hacc-faq .help-faq-item')].filter((x) => x.getClientRects().length && /DPoP/.test(x.textContent)).length)) >= 1);
    await p.fill('#portal-help input[type=search], #help-search', ''); await p.waitForTimeout(400); await p.evaluate(() => haccJump('hacc-faq')); await p.waitForTimeout(200);
    await p.click('.help-faq-topics [data-topic=""]'); await p.waitForTimeout(150);
    ok(W + 'All: every question again', (await vis()) === 19);
    await p.focus('.help-faq-topics [data-topic=security]'); await p.keyboard.press('Enter'); await p.waitForTimeout(150);
    ok(W + 'the keyboard chooses a topic', (await vis()) === 5);
    ok(W + 'no sideways scroll', (await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) <= 0);
    ok(W + 'no page errors', !errs.length, errs);
    await p.close();
  }
  await b.close();
  console.log(`${pass} of ${pass + fail} checks passed`); process.exit(fail ? 1 : 0);
})();
