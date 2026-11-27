#!/usr/bin/env node
// Workload Modeller: the test types and the page layout, as a user — every check says what it proves.
//   node serve.js "" 3994 ; node walk.js http://localhost:3994/converter/workload-modeller
'use strict';
const path = require('path');
const { chromium } = require(path.resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const URL = process.argv[2] || 'http://localhost:3994/converter/workload-modeller';
let pass = 0, fail = 0;
const ok = (name, cond, info) => { if (cond) pass++; else { fail++; console.log('FAIL ' + name + (info !== undefined ? '  ' + JSON.stringify(info).slice(0, 300) : '')); } };

async function page(b, w, h, team) {
  const p = await b.newPage({ viewport: { width: w, height: h } }), errs = [];
  p.on('pageerror', (e) => errs.push(e.message));
  if (team) await p.route('**/wm/config/workload-settings.json', async (r) => { const res = await r.fetch(); const j = await res.json(); team(j); r.fulfill({ response: res, body: JSON.stringify(j) }); });
  await p.goto(URL); await p.evaluate(() => { try { localStorage.clear(); } catch (e) { /* none */ } }); await p.reload(); await p.waitForTimeout(500);
  p.errs = errs; return p;
}
const vis = (p, s) => p.locator(s).first().isVisible();
// the scripts table as people see it: laid out as a table, one row per script, each row under the headings and in sight
// (the test-type cards once shared its class name and turned it into a grid: the row lay under the headings)
const tableInfo = (p) => p.evaluate(() => { const tb = document.querySelector('#tv table'); if (!tb) return { table: false };
  const head = tb.tHead.rows[0].getBoundingClientRect(), rows = [...tb.querySelectorAll('tbody tr[data-id]')].filter((r) => !r.hidden).map((r) => r.getBoundingClientRect());
  return { display: getComputedStyle(tb).display, rows: rows.length, groups: state.groups.length, under: rows.every((r, i) => r.top >= head.bottom - 1 && r.height > 20 && (!i || r.top >= rows[i - 1].bottom - 1)) }; });
const tableOk = async (p) => { const x = await tableInfo(p); return x.display === 'table' && x.rows === x.groups && x.rows > 0 && x.under; };
const plan = (p) => p.evaluate(() => ({ peak: last.peakVusers, vusers: last.totals.vusers, holds: (last.actions || []).filter((a) => a.type === 'hold').map((a) => a.dur), sc: state.scenario }));

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  let p = await page(b, 1600, 900);
  // ── the cards ──
  const cards = await p.evaluate(() => [...document.querySelectorAll('#test-types .wm-choice')].map((x) => { const r = x.getBoundingClientRect(); return { k: x.dataset.tt, w: Math.round(r.width), top: Math.round(r.top), svg: !!x.querySelector('svg.wm-tt-shape path'), line: !!x.querySelector('.wm-tt-100') }; }));
  ok('five cards in one row, the same width', cards.length === 5 && cards.every((c) => c.top === cards[0].top && Math.abs(c.w - cards[0].w) <= 1), cards);
  ok('each card draws its load, with the 100% line', cards.every((c) => c.svg && c.line));
  ok('Load is chosen at first, full load 60 min (team)', (await plan(p)).sc.testType === 'load' && (await p.inputValue('#sc-steady')) === '60');
  // ── About this test ──
  const NAMES = { load: 'Load test', soak: 'Soak test (endurance)', stress: 'Stress test', capacity: 'Capacity test (breakpoint)', spike: 'Spike test' };
  for (const k of Object.keys(NAMES)) {
    await p.click('[data-tt=' + k + ']'); await p.waitForTimeout(80);
    const a = await p.evaluate(() => ({ h: (document.querySelector('#tt-about-h') || {}).textContent, dts: [...document.querySelectorAll('.wm-about-facts dt')].map((x) => x.textContent).join('|'), dd: [...document.querySelectorAll('.wm-about-facts dd')].every((x) => x.textContent.length > 20), svg: !!document.querySelector('.wm-about-fig path.wm-about-line') }));
    ok(k + ': About names it and has Why · Load · How long · What to look at · When', a.h === NAMES[k] && a.dts === 'Why|Load|How long|What to look at|When' && a.dd && a.svg, a);
  }
  // ── stress: the team's standard, held ──
  await p.click('[data-tt=stress]'); let r = await plan(p);
  ok('Stress starts at the team standard: 150% held 120 min', JSON.stringify(r.sc.levels) === '[150]' && r.sc.stepHoldMin === 120 && r.holds.length === 1 && r.holds[0] === 7200 && r.peak === Math.ceil(r.vusers * 1.5), r);
  ok('… the About text says so', /Your team:\s*150% of the peak for 2 hours/.test(await p.locator('#tt-about').innerText()));
  ok('… fields: how it rises, level, hold at 150% (no full-load box)', await vis(p, '#f-shape') && await vis(p, '#f-level') && (await p.locator('#hold-label').innerText()) === 'Hold at 150%' && !(await vis(p, '#f-steady')) && !(await vis(p, '#f-levels')));
  ok('… the TPS tile shows the level too', /about [\d.]+ at the held 150%/.test(await p.locator('#tiles').innerText()));
  ok('… the summary names the held level', /at the held level, 150% of the target/.test(await p.locator('#summary').innerText()));
  ok('… LRE: one start, one 2-hour hold', /Run for 02:00:00\s+—\s+150% of the target/.test(await p.locator('#lre').textContent()));
  await p.fill('#sc-level', '175'); await p.dispatchEvent('#sc-level', 'input'); r = await plan(p);
  ok('a level typed: 175% → its Vusers and label', r.peak === Math.ceil(r.vusers * 1.75) && (await p.locator('#hold-label').innerText()) === 'Hold at 175%', r);
  await p.fill('#sc-hold', '90'); await p.dispatchEvent('#sc-hold', 'input'); r = await plan(p);
  ok('… and a hold typed: 90 min', r.holds[0] === 5400);
  await p.click('[data-shape=steps]'); r = await plan(p);
  ok('In steps: the tool\'s steps 50 … 150%, each 10 min', r.sc.levels === null && r.holds.length === 5 && r.holds.every((x) => x === 600) && await vis(p, '#f-levels') && !(await vis(p, '#f-level')) && (await p.locator('#hold-label').innerText()) === 'Hold at each step', r);
  ok('… the buttons say which one', (await p.getAttribute('[data-shape=steps]', 'aria-pressed')) === 'true' && (await p.getAttribute('[data-shape=hold]', 'aria-pressed')) === 'false');
  await p.click('[data-shape=hold]'); r = await plan(p);
  ok('back to held: the team standard again', JSON.stringify(r.sc.levels) === '[150]' && r.sc.stepHoldMin === 120);
  // ── the other types ──
  await p.click('[data-tt=capacity]'); r = await plan(p);
  ok('Capacity: its steps and hold in Simple view, no stress fields', await vis(p, '#f-levels') && await vis(p, '#f-hold') && !(await vis(p, '#f-shape')) && r.sc.stepHoldMin === null && r.holds.length === 6, r);
  await p.click('[data-tt=spike]');
  ok('Spike: Hold normal load', (await p.locator('#hold-label').innerText()) === 'Hold normal load' && !(await vis(p, '#f-levels')));
  await p.click('[data-tt=soak]'); r = await plan(p);
  ok('Soak: 480 min full load, no step fields', r.sc.steadyMin === 480 && await vis(p, '#f-steady') && !(await vis(p, '#f-hold')) && r.sc.stepHoldMin === null);
  await p.click('[data-tt=stress]'); await p.selectOption('#sc-workload', 'basic-group');
  ok('Stress on a basic schedule: the full-load box is back, with why', await vis(p, '#f-steady') && /Real-world schedule/.test(await p.locator('#steady-help').innerText()));
  await p.selectOption('#sc-workload', 'real-world');
  // ── spike: normal load → burst ──
  await p.click('[data-tt=spike]'); r = await plan(p);
  ok('Spike: Normal load 50% → Burst to 200% (team), peak = 2 × the Vusers', await vis(p, '#f-spike') && (await p.inputValue('#sc-spike-base')) === '50' && (await p.inputValue('#sc-spike-peak')) === '200' && r.peak === r.vusers * 2, r);
  await p.fill('#sc-spike-base', '70'); await p.fill('#sc-spike-peak', '300'); r = await plan(p);
  ok('… 70% → 300%: the plan follows', r.sc.spikeBase === 70 && r.sc.spikePeak === 300 && r.peak === Math.ceil(r.vusers * 3) && /spike \(\d+ Vusers\)/.test(await p.locator('#lre').textContent()), r.sc);
  ok('… the notes and the drawing follow', /Normal load \(70%\), a jump to 300%/.test(await p.locator('#tt-about').innerText()));
  await p.fill('#sc-spike-peak', '60'); r = await plan(p);
  ok('… a burst below normal load is said and not used', await vis(p, '#spike-err') && /above normal load/.test(await p.locator('#spike-err').innerText()) && r.sc.spikePeak === 300 && (await p.getAttribute('#sc-spike-peak', 'aria-invalid')) !== null);
  await p.fill('#sc-spike-peak', '250'); ok('… fixed: the message goes', !(await vis(p, '#spike-err')) && (await plan(p)).sc.spikePeak === 250);
  await p.click('[data-tt=load]'); r = await plan(p);
  ok('another test: the spike levels are not kept', r.sc.spikeBase === null && r.sc.spikePeak === null && !(await vis(p, '#f-spike')));
  await p.click('[data-tt=spike]'); ok('back to spike: the team levels again', (await p.inputValue('#sc-spike-peak')) === '200');
  await p.click('[data-tt=load]');
  // ── script cards: what a field means is said once ──
  await p.click('#btn-example'); await p.click('#btn-unfold-all').catch(() => {}); await p.evaluate(() => state.groups.forEach((g) => foldCard(g, false))); await p.waitForTimeout(150);
  const helps = () => p.evaluate(() => [...document.querySelectorAll('#scripts .wm-script')].map((c) => ({ help: c.classList.contains('wm-help-card'), shown: [...c.querySelectorAll('small.wm-gh')].filter((x) => x.offsetParent).length, all: c.querySelectorAll('small.wm-gh').length, own: [...c.querySelectorAll('.wm-f > small:not(.wm-gh)')].filter((x) => x.offsetParent).length })));
  let hs = await helps();
  ok('three cards open: the first explains its fields, the others do not repeat it', hs.length === 3 && hs[0].help && hs[0].shown > 3 && hs.slice(1).every((x) => !x.help && x.shown === 0 && x.all > 3), hs);
  ok('… what is about each script still shows in every card', hs.every((x) => x.own >= 2), hs);
  await p.locator('#scripts .wm-script').nth(2).locator('[data-k=thinkPerIter]').focus();
  ok('… a field of another card shows its help while it has the focus', await p.evaluate(() => { const s = document.activeElement.closest('.wm-f').querySelector('small.wm-gh'); return !!(s && s.offsetParent); }));
  await p.evaluate(() => { document.activeElement.blur(); foldCard(state.groups[0], true); }); await p.waitForTimeout(100); hs = await helps();
  ok('the first card folded: the next open card explains', hs[1].help && hs[1].shown > 3 && hs[2].shown === 0, hs);
  await p.click('#sview [data-v=table]'); await p.waitForTimeout(150);
  ok('Table: a real table, every script a row of its own under the headings', await tableOk(p), await tableInfo(p));
  await p.evaluate(() => { const b = document.querySelector('#tv [data-open], #tv .wm-tv-open, #tv button'); if (b) b.click(); }); await p.waitForTimeout(150);
  await p.click('#sview [data-v=cards]'); await p.click('#btn-reset-all'); await p.waitForTimeout(150); await p.click('[data-tt=stress]');
  // ── hide / show the notes, remembered ──
  await p.click('#tt-about [data-about="0"]');
  ok('Hide: one line instead of the notes', !(await vis(p, '.wm-about')) && /What is a stress test/.test(await p.locator('#tt-about').innerText()));
  await p.reload(); await p.waitForTimeout(400);
  ok('… remembered after a reload', !(await vis(p, '.wm-about')) && await vis(p, '.wm-about-show'));
  await p.click('.wm-about-show'); ok('… and shown again', await vis(p, '.wm-about'));
  // ── reset puts the test back ──
  await p.click('[data-tt=stress]'); await p.click('[data-clear=test]'); r = await plan(p);
  ok('Reset: Load, 60 min, nothing held', r.sc.testType === 'load' && r.sc.steadyMin === 60 && r.sc.levels === null && r.sc.stepHoldMin === null, r.sc);
  // ── working on a plan: the band and the notes ──
  ok('at first: the band, and the notes open', await vis(p, '.wm-band') && await p.evaluate(() => document.getElementById('script-notes').open));
  await p.click('#btn-example');
  await p.waitForFunction(() => !document.getElementById('script-notes').open && !document.querySelector('.wm-band').offsetParent, null, { timeout: 2000 }).catch(() => {});   // folds after the recalculation
  ok('with an example: the band gives its room, the notes fold', !(await vis(p, '.wm-band')) && !(await p.evaluate(() => document.getElementById('script-notes').open)), await p.evaluate(() => ({ band: !!document.querySelector('.wm-band').offsetParent, notes: document.getElementById('script-notes').open, working: document.body.className, groups: state.groups.length, pref: localStorage.getItem('wm-notes') })));
  await p.click('#script-notes summary'); await p.click('#btn-reset-all');
  await p.waitForFunction(() => !!document.querySelector('.wm-band').offsetParent, null, { timeout: 2000 }).catch(() => {});
  ok('Start over: the band is back', await vis(p, '.wm-band'));
  ok('the notes stay as the user left them (opened)', await p.evaluate(() => document.getElementById('script-notes').open));
  await p.focus('#script-notes summary'); await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  ok('folded with the keyboard: remembered as the user’s choice', await p.evaluate(() => !document.getElementById('script-notes').open && localStorage.getItem('wm-notes') === 'closed'));
  await p.keyboard.press('Enter'); await p.waitForTimeout(100);
  // ── the results stay in view ──
  await p.click('#btn-example'); await p.waitForTimeout(150);
  await p.evaluate(() => window.scrollTo(0, 2500)); await p.waitForTimeout(150);
  const res = await p.evaluate(() => { const r = document.getElementById('results-col').getBoundingClientRect(); return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight, scroll: document.getElementById('results-col').scrollHeight > document.getElementById('results-col').clientHeight }; });
  ok('scrolled down the inputs: the results are still on screen, scrolling on their own', res.top >= 0 && res.top < 120 && res.bottom <= res.h + 1 && res.scroll, res);
  ok('no page errors', !p.errs.length, p.errs);
  await p.close();

  // ── the team settings file decides ──
  p = await page(b, 1600, 900, (j) => { j.testTypes.load.fullLoadMin = 90; j.testTypes.stress = { shape: 'steps' }; });
  ok('team file: load starts at 90 min', (await p.inputValue('#sc-steady')) === '90');
  await p.click('[data-tt=stress]'); r = await plan(p);
  ok('team file: stress in steps', r.sc.levels === null && r.holds.length === 5 && /in steps up to 150%/.test(await p.locator('#tt-about').innerText()), r);
  await p.close();
  p = await page(b, 1600, 900, (j) => { j.testTypes.stress = { shape: 'wave', levelPct: 99 }; });
  ok('team file: wrong stress values keep the built-in ones and are named', /testTypes\.stress\.levelPct.*testTypes\.stress\.shape|testTypes\.stress\.shape.*levelPct/s.test(await p.locator('#settings-note').innerText()) || /2 values in the settings file/.test(await p.locator('#settings-note').innerText()), await p.locator('#settings-note').innerText());
  await p.click('[data-tt=stress]'); r = await plan(p);
  ok('… stress still 150% for 120 min', JSON.stringify(r.sc.levels) === '[150]' && r.sc.stepHoldMin === 120);
  await p.close();

  // ── every width: one row of cards, nothing sideways ──
  for (const [w, h] of [[1366, 768], [1920, 1080], [2560, 1300], [1000, 800], [400, 860]]) {
    p = await page(b, w, h); await p.click('[data-tt=stress]');
    const m = await p.evaluate(() => ({ side: document.documentElement.scrollWidth - innerWidth, rows: new Set([...document.querySelectorAll('#test-types .wm-choice')].map((x) => Math.round(x.getBoundingClientRect().top))).size, cut: [...document.querySelectorAll('#test-types b, .wm-about-facts dd, #f-shape button')].filter((x) => x.scrollWidth > x.clientWidth + 1).map((x) => x.textContent) }));
    ok(w + ' px: no sideways scroll, the cards on ' + (w < 521 ? 'two rows' : 'one row') + ', no text cut', m.side <= 0 && m.rows === (w < 521 ? 2 : 1) && !m.cut.length, m);
    await p.close();
  }
  {
    // Plan the load from another tool (WorkloadModeller.addScripts) while Table view is the remembered choice
    const q = await page(b, 1912, 900);
    await q.evaluate(() => localStorage.setItem('wm-sview', 'table')); await q.reload(); await q.waitForTimeout(500);
    const har = require('fs').readFileSync(path.resolve(__dirname, '../../../collection-examples/petstore.octoperf.com.har'), 'utf8');
    await q.evaluate((t) => WorkloadModeller.addScripts([new File([t], 'petstore.octoperf.com.har')]), har); await q.waitForTimeout(1500);
    ok('Plan the load into Table view: the script is a row people can see', await tableOk(q), await tableInfo(q));
    await q.click('#sview [data-v=cards]'); await q.waitForTimeout(150); await q.click('#sview [data-v=table]'); await q.waitForTimeout(150);
    ok('… and after switching to cards and back', await tableOk(q), await tableInfo(q));
    const empty = await q.evaluate(() => ['#res-notes', '#phbar', '#phases'].filter((s) => { const e = document.querySelector(s); return e && e.offsetParent && !e.children.length; }));
    ok('no plan yet: no empty notes, phase bar or phase table under Result', !empty.length, empty);
    const tgt = q.locator('#tv [data-k=targetTps]').first(); await tgt.focus();
    ok('the Target that still needs a value shows the keyboard focus', await tgt.evaluate((e) => getComputedStyle(e).boxShadow.includes('3px')));
    ok('no page errors (hand-off)', !q.errs.length, q.errs);
    await q.close();
  }
  {
    // Table view wider than its column: the results fold to their strip by themselves (not remembered); opened again by
    // the user they stay open; back to Cards they open again
    const q = await page(b, 1920, 1000);
    await q.click('#btn-example'); await q.waitForTimeout(200);
    const har = require('fs').readFileSync(path.resolve(__dirname, '../../../collection-examples/petstore.octoperf.com.har'), 'utf8');
    await q.evaluate((t) => WorkloadModeller.addScripts([new File([t], 'petstore.octoperf.com.har')]), har); await q.waitForTimeout(1200);
    const st = () => q.evaluate(() => ({ folded: document.querySelector('.wm-page').classList.contains('res-hidden'), side: (() => { const tv = document.getElementById('tv'); return tv.hidden ? 0 : tv.scrollWidth - tv.clientWidth; })(), saved: localStorage.getItem('wm-layout') }));
    let s = await st(); ok('1920 px, Cards: the results beside the inputs', !s.folded, s);
    await q.click('#sview [data-v=table]'); await q.waitForTimeout(300); s = await st();
    ok('Table: the results fold to the strip by themselves and the whole table fits', s.folded && s.side <= 2, s);
    ok('… with a message saying why', /folded to the strip/.test(await q.evaluate(() => document.body.innerText)));
    ok('… not remembered', s.saved !== 'res-hidden', s);
    ok('… the table rows still under the headings', await tableOk(q), await tableInfo(q));
    await q.click('#rail'); await q.waitForTimeout(300); s = await st();
    ok('the strip opens the results again and the table does not fold them again', !s.folded, s);
    await q.evaluate(() => window.dispatchEvent(new Event('resize'))); await q.waitForTimeout(200); s = await st();
    ok('… not even after a resize (the user chose; the hint line offers it)', !s.folded && await q.isVisible('#tv-more'), s);
    await q.click('#sview [data-v=cards]'); await q.waitForTimeout(200); await q.click('#sview [data-v=table]'); await q.waitForTimeout(300); s = await st();
    ok('Table chosen again: folded again', s.folded, s);
    await q.click('#sview [data-v=cards]'); await q.waitForTimeout(300); s = await st();
    ok('back to Cards: the results open again', !s.folded, s);
    await q.click('#btn-hide-res'); await q.waitForTimeout(200); await q.click('#sview [data-v=table]'); await q.waitForTimeout(200); await q.click('#sview [data-v=cards]'); await q.waitForTimeout(200); s = await st();
    ok('results hidden by the user stay hidden in Cards (their choice, remembered)', s.folded && s.saved === 'res-hidden', s);
    await q.click('#rail'); await q.waitForTimeout(200);
    ok('no page errors (fold)', !q.errs.length, q.errs);
    await q.close();
    // a laptop: the compact table — nothing behind a sideways scroll, every choice readable, the rare field in the row's card
    for (const [w, h] of [[1366, 768], [1536, 700]]) {
      const c = await page(b, w, h);
      await c.click('#btn-example'); await c.evaluate((t) => WorkloadModeller.addScripts([new File([t], 'petstore.octoperf.com.har')]), har); await c.waitForTimeout(1200);
      await c.click('#sview [data-v=table]'); await c.waitForTimeout(400);
      const m = await c.evaluate(() => { const tv = document.getElementById('tv'); const cut = []; const cx = document.createElement('canvas').getContext('2d');
        document.querySelectorAll('#tv tr[data-id] select').forEach((s) => { if (!s.offsetParent) return; cx.font = getComputedStyle(s).font; const cs = getComputedStyle(s), room = s.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight); [...s.options].forEach((o) => { if (cx.measureText(o.text).width > room + 1) cut.push(o.text); }); });
        // a long script name may scroll in its box (as in the wide table), shown whole on hover; every number shows whole
        document.querySelectorAll('#tv tr[data-id] input').forEach((i) => { if (!i.offsetParent || i.scrollWidth <= i.clientWidth + 1) return; if (i.dataset.k === 'name' && i.title.startsWith(i.value)) return; cut.push('box ' + i.dataset.k + ' ' + i.value); });
        return { side: tv.scrollWidth - tv.clientWidth, cut: [...new Set(cut)] }; });
      ok(w + ' px Table: nothing behind a sideways scroll', m.side <= 2, m);
      await c.waitForTimeout(700);   // the results fold with an animation
      ok(w + ' px: no "More columns to the right" hint once the table fits', !(await c.isVisible('#tv-more')));
      ok(w + ' px Table: every list choice and number readable in full', !m.cut.length, m);
      ok(w + ' px Table: still a real table, rows under the headings', await tableOk(c), await tableInfo(c));
      await c.click('#tv tr[data-id] [data-open] >> nth=0'); await c.waitForTimeout(300);
      ok(w + ' px: Think time at replay is in the row\'s full card', await c.evaluate(() => [...document.querySelectorAll('#tv .wm-tv-card [data-k=thinkMode]')].some((e) => e.offsetParent)));
      ok(w + ' px: no page errors', !c.errs.length, c.errs);
      await c.close();
    }
    const n = await page(b, 3840, 1900);   // a table that fits beside the results: nothing folds
    await n.click('#btn-example'); await n.click('#sview [data-v=table]'); await n.waitForTimeout(300);
    ok('3840 px: the table fits beside the results — they stay', !(await n.evaluate(() => document.querySelector('.wm-page').classList.contains('res-hidden'))));
    await n.close();
  }
  await b.close();
  console.log(`${pass} of ${pass + fail} checks passed`); process.exit(fail ? 1 : 0);
})();
