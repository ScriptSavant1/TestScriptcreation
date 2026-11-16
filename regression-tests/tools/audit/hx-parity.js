// HAR Explorer vs Script Studio on real recordings: load each file through each tool's own screen in the portal and
// compare every request's transaction and left-out reason (and the order). Also times the Explorer's load.
// Studio keeps its default choices (background requests: the defaults of its background dialog).
//   node hx-parity.js <file.har> [...]
const { chromium } = require(require('path').resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const path = require('path');
const files = process.argv.slice(2);
const row = (e) => [e.method + ' ' + e.url, e.txn || null, e.leftOut || null];
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  let bad = 0;
  for (const file of files) {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:3999/converter/', { waitUntil: 'networkidle' });
    // Script Studio
    await p.evaluate(() => PerfxShell.go('studio', { instant: true }));
    await p.waitForFunction(() => { const w = document.getElementById('iframe-studio').contentWindow; return w && w.document.readyState === 'complete' && typeof w.loadFile === 'function'; }, null, { timeout: 20000 });
    const sf = await (await p.$('#iframe-studio')).contentFrame();
    await sf.setInputFiles('#dz1 input[type=file]', file);
    const idle = () => sf.waitForFunction(() => { const c = document.body.classList, d = document.getElementById('ss-bg-dlg'); return (c.contains('ss-view-ws') && !c.contains('ss-reading')) || (d && d.open); }, null, { timeout: 120000 });
    await idle();
    if (await sf.evaluate(() => { const d = document.getElementById('ss-bg-dlg'); return !!(d && d.open); })) {
      await sf.evaluate(() => applyBgDecisions());   // the dialog's defaults
      await idle();
    }
    const stu = await sf.evaluate((r) => { const f = new Function('e', 'return (' + r + ')(e)'); return window.PerfxStudio.state().entries1.filter((e) => !e.isMarker).map((e) => f(e)); }, row.toString());
    // HAR Explorer
    await p.evaluate(() => PerfxShell.go('explore', { instant: true }));
    await p.waitForFunction(() => { const d = document.getElementById('iframe-explorer').contentDocument; return d && d.getElementById('hx-file'); }, null, { timeout: 20000 });
    const xf = await (await p.$('#iframe-explorer')).contentFrame();
    const t = Date.now();
    await xf.setInputFiles('#hx-file', file); await xf.waitForSelector('#hx-ws:not([hidden])', { timeout: 60000 });
    const loadMs = Date.now() - t;
    // the model is inside the page's closure; read it back through the engine state it used
    const exp = await xf.evaluate((r) => { const f = new Function('e', 'return (' + r + ')(e)'); return S.entries.filter((e) => !e.isMarker).map((e) => f(e)); }, row.toString());
    const listInfo = await xf.evaluate(() => ({ count: document.getElementById('hx-count').textContent, rows: document.querySelectorAll('#hx-rows > *').length, src: document.getElementById('hx-fb-src').textContent, n: document.getElementById('hx-fb-n').textContent, tx: document.getElementById('hx-fb-tx').textContent }));
    const diff = [];
    if (stu.length !== exp.length) diff.push(`count ${stu.length} vs ${exp.length}`);
    stu.forEach((r, i) => { const x = exp[i] || []; if (r[0] !== x[0] || r[1] !== x[1] || r[2] !== x[2]) diff.push(`#${i + 1} studio ${JSON.stringify(r)} explorer ${JSON.stringify(x)}`); });
    bad += diff.length;
    console.log(path.basename(file).padEnd(40), `${stu.length} requests`, diff.length ? `DIFFERENT (${diff.length}): ${diff.slice(0, 3).join(' | ')}` : 'IDENTICAL',
      `| explorer load ${loadMs} ms | ${listInfo.count} shown, ${listInfo.rows} rows drawn | ${listInfo.src} | ${listInfo.n} | ${listInfo.tx}`, errs.length ? 'ERRORS ' + errs.join(' | ') : '');
    await p.close();
  }
  await b.close();
  console.log(bad ? `${bad} difference(s)` : 'ALL IDENTICAL');
})();
