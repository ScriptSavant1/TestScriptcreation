// Help content capture: every section's title, subtitle, full text and links, plus jump behaviour.
//   node capture.js <portalUrl> <out.json>
'use strict';
const { chromium } = require(require('path').resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const fs = require('fs');
const [BASE, OUT] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
  const errs = []; p.on('pageerror', e => errs.push(e.message));
  await p.goto(BASE); await p.waitForLoadState('networkidle');
  await p.evaluate(() => PerfxShell.go('help', { instant: true }));
  await p.waitForTimeout(300);
  // open every section so innerText includes the bodies
  const data = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#portal-help .help-acc-item')];
    items.forEach(i => i.classList.add('open'));
    const norm = s => s.replace(/\s+/g, ' ').trim();
    return items.map(i => ({
      id: i.id,
      title: norm((i.querySelector('.help-acc-title') || {}).textContent || ''),
      sub: norm((i.querySelector('.help-acc-sub') || {}).textContent || ''),
      text: norm((i.querySelector('.help-acc-body') || i).textContent || ''),
      links: [...i.querySelectorAll('a[href]')].map(a => norm(a.textContent) + ' -> ' + a.getAttribute('href')),
      jumps: [...i.querySelectorAll('[onclick]')].map(a => a.getAttribute('onclick')).filter(x => !/haccToggle/.test(x)),
    }));
  });
  const pageText = await p.evaluate(() => document.querySelector('#portal-help .help-page-title') ? document.querySelector('#portal-help .help-page-title').textContent.replace(/\s+/g, ' ').trim() : '');
  // jump behaviour: each section can be opened by haccJump and is then visible below the top bar
  const jumps = [];
  for (const d of data) {
    await p.evaluate(id => { document.querySelectorAll('#portal-help .help-acc-item').forEach(i => i.classList.remove('open')); haccJump(id); }, d.id);
    await p.waitForTimeout(700);
    jumps.push(await p.evaluate(id => { const el = document.getElementById(id), r = el.getBoundingClientRect(); return { id, open: el.classList.contains('open'), topVisible: r.top >= 50 && r.top < innerHeight - 40 }; }, d.id));
  }
  fs.writeFileSync(OUT, JSON.stringify({ pageText, sections: data, jumps, errors: errs }, null, 2));
  console.log(data.length + ' sections, ' + data.reduce((n, d) => n + d.text.length, 0) + ' characters; jumps ok: ' + jumps.filter(j => j.open && j.topVisible).length + '/' + jumps.length + '; errors: ' + errs.length);
  await b.close();
})();
