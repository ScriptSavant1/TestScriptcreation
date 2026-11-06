// HAR Explorer vs Recorder on real recordings: load each file through each tool's own screen in the portal and
// compare every request's transaction and left-out reason (and the order). Also times the Explorer's load.
//   node hx-parity.js <file.har> [...]
const { chromium } = require(require('path').resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const path = require('path');
const files = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  let bad = 0;
  for (const file of files) {
    const p = await b.newPage({ viewport: { width: 1600, height: 900 } });
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto('http://localhost:3999/converter/', { waitUntil: 'networkidle' });
    // Recorder
    await p.evaluate(() => PerfxShell.go('record', { instant: true }));
    await p.waitForFunction(() => { const w = document.getElementById('iframe-recorder').contentWindow; return w && w.JSZip; }, null, { timeout: 20000 });
    const rf = await (await p.$('#iframe-recorder')).contentFrame();
    await rf.setInputFiles('#hf', file); await rf.click('#fmt-go'); await rf.waitForSelector('#main:not([hidden])', { timeout: 60000 });
    const rec = await rf.evaluate(() => S.entries.filter((e) => !e.isMarker).map((e) => [e.id, e.txn || null, e.leftOut || null]));
    // Explorer
    await p.evaluate(() => PerfxShell.go('explore', { instant: true }));
    await p.waitForFunction(() => { const d = document.getElementById('iframe-explorer').contentDocument; return d && d.getElementById('hx-file'); }, null, { timeout: 20000 });
    const xf = await (await p.$('#iframe-explorer')).contentFrame();
    const t = Date.now();
    await xf.setInputFiles('#hx-file', file); await xf.waitForSelector('#hx-ws:not([hidden])', { timeout: 60000 });
    const loadMs = Date.now() - t;
    const exp = await xf.evaluate(() => {
      const out = []; const doc = document;
      // the model is inside the page's closure; read it back through the list it drew and the Recorder state it used
      return S.entries.filter((e) => !e.isMarker).map((e) => [e.id, e.txn || null, e.leftOut || null]);
    });
    const listInfo = await xf.evaluate(() => ({ count: document.getElementById('hx-count').textContent, rows: document.querySelectorAll('#hx-rows > *').length, src: document.getElementById('hx-fb-src').textContent, n: document.getElementById('hx-fb-n').textContent, tx: document.getElementById('hx-fb-tx').textContent }));
    const diff = [];
    if (rec.length !== exp.length) diff.push(`count ${rec.length} vs ${exp.length}`);
    rec.forEach((r, i) => { const x = exp[i] || []; if (r[0] !== x[0] || r[1] !== x[1] || r[2] !== x[2]) diff.push(`#${r[0]} recorder ${JSON.stringify(r)} explorer ${JSON.stringify(x)}`); });
    bad += diff.length;
    console.log(path.basename(file).padEnd(40), `${rec.length} requests`, diff.length ? `DIFFERENT (${diff.length}): ${diff.slice(0, 3).join(' | ')}` : 'IDENTICAL',
      `| explorer load ${loadMs} ms | ${listInfo.count} shown, ${listInfo.rows} rows drawn | ${listInfo.src} | ${listInfo.n} | ${listInfo.tx}`, errs.length ? 'ERRORS ' + errs.join(' | ') : '');
    await p.close();
  }
  await b.close();
  console.log(bad ? `${bad} difference(s)` : 'ALL IDENTICAL');
})();
