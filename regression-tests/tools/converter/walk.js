#!/usr/bin/env node
// The converter page clicked through as a user would: both tools, every control, against the real server.
//   node walk.js [portalUrl=http://localhost:3999/converter/] [--show]
// Prints PASS / FAIL per check; exit code 1 when one fails. Needs the samples made by make-inputs.js (inputs/).
'use strict';
const path = require('path'), fs = require('fs'), os = require('os');
const { chromium } = require(path.resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const JSZip = require(path.resolve(__dirname, '../../../node_modules/jszip'));
const BASE = process.argv.slice(2).find((a) => !a.startsWith('--')) || 'http://localhost:3999/converter/';
const IN = path.join(__dirname, 'inputs') + path.sep, TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'cv-walk-'));

// an invented shop: folders (one nested), tokens, an address in the environment, one written out, one with no value
const script = (...l) => [{ listen: 'test', script: { exec: l } }];
const req = (name, method, url, o = {}) => ({ name, event: o.test || [], request: { method, url: { raw: url }, header: [{ key: 'Accept', value: 'application/json' }, ...(o.noauth ? [] : [{ key: 'Authorization', value: 'Bearer {{access_token}}' }])], ...(o.body ? { body: { mode: 'raw', raw: JSON.stringify(o.body) } } : {}) } });
const COL = { info: { name: 'Shop API', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, item: [
  { name: 'Sign in', item: [req('Get token', 'POST', '{{auth_url}}/token', { noauth: 1, body: { user: '{{username}}', password: '{{password}}' }, test: script('pm.environment.set("access_token", pm.response.json().access_token);') }), req('My profile', 'GET', '{{base_url}}/me')] },
  { name: 'Order', item: [req('Place order', 'POST', '{{base_url}}/orders', { body: { code: '{{voucher}}' }, test: script('pm.environment.set("order_id", pm.response.json().id);') }), { name: 'Payment', item: [req('Pay', 'POST', '{{base_url}}/pay/{{order_id}}')] }, req('Picture', 'GET', 'https://media.example.com/1', { noauth: 1 }), req('Health', 'GET', '{{status_url}}/health', { noauth: 1 })] },
] };
const ENV = { name: 'Test', values: Object.entries({ base_url: 'https://api.example.com', auth_url: 'https://login.example.com', username: 'user01', password: 'not-a-real-one' }).map(([key, value]) => ({ key, value, enabled: true })) };
const F = (n, c) => { fs.writeFileSync(path.join(TMP, n), typeof c === 'string' ? c : JSON.stringify(c)); return path.join(TMP, n); };
const col = F('Shop.json', COL), env = F('Test.postman_environment.json', ENV), col2 = F('Other.json', { ...COL, info: { ...COL.info, name: 'Other API' } }), bad = F('bad.json', '{ not json'), pem = F('client.pem', '-----BEGIN CERTIFICATE-----\nx\n-----END CERTIFICATE-----\n'), key = F('client.key', 'k');

let fails = 0, n = 0;
const ok = (name, c, more) => { n++; if (!c) fails++; if (!c || process.argv.includes('--show')) console.log((c ? 'PASS ' : 'FAIL ') + name + (c || more === undefined ? '' : '  — ' + JSON.stringify(more))); };

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  const p = await b.newPage({ viewport: { width: 1536, height: 700 }, acceptDownloads: true, extraHTTPHeaders: { 'X-Forwarded-For': '192.0.2.' + (1 + Math.floor(Math.random() * 250)) } });
  const errs = [], alerts = [], posts = [];
  p.on('pageerror', (e) => errs.push(e.message)); p.on('dialog', (d) => { alerts.push(d.message()); d.dismiss(); });
  p.on('request', (q) => { if (/\/convert(-jmx)?$/.test(q.url())) posts.push(q.url()); });
  await p.addInitScript(() => { window.__forms = []; const f0 = window.fetch; window.fetch = function (u, o) { if (o && o.body instanceof FormData) window.__forms.push(Object.fromEntries([...o.body.entries()].map(([k, v]) => [k, v instanceof File ? v.name : v]))); return f0.apply(this, arguments); }; });
  const last = () => p.evaluate(() => window.__forms[window.__forms.length - 1]);   // the form as the page sent it
  await p.goto(BASE); await p.waitForLoadState('networkidle');
  const go = async (k) => { await p.evaluate((x) => PerfxShell.go(x, { instant: true }), k); await p.waitForTimeout(150); };
  let kind = 'pm';
  const panel = () => (kind === 'pm' ? '#panel-bruno ' : '#panel-jmx '), $ = (s) => p.locator(panel() + s).first(), vis = (s) => $(s).isVisible(), txt = (s) => $(s).innerText(), count = (s) => p.locator(panel() + s).count();
  const click = (s) => $(s).click(), code = () => txt('.cx-code');
  const settle = async () => { await p.waitForTimeout(60); await p.waitForFunction((k) => ConverterApp.state(k).status !== 'up', kind, { timeout: 20000 }); await p.waitForTimeout(60); };
  const st = (f, a) => p.evaluate(new Function('a', 'const s = ConverterApp.state(a.k); return (' + f + ')'), { k: kind, a });
  const zip = async () => { const [d] = await Promise.all([p.waitForEvent('download'), click('[data-act=dl]')]); return { name: d.suggestedFilename(), z: await JSZip.loadAsync(fs.readFileSync(await d.path())) }; };

  // ── start
  await go('postman');
  ok('Convert waits for the collection', await $('.cx-go').isDisabled()); ok('three boxes, nothing else', (await count('.cx-tile')) === 3 && !(await count('.cx-seg')));
  await click('[data-dlg=how]'); ok('How it works opens', await p.locator('#cx-dlg .cx-steps').first().isVisible()); await p.mouse.click(6, 350); ok('… and closes with a click outside', !(await p.locator('#cx-dlg').isVisible()));
  await p.setInputFiles('#fi-col', bad); ok('one file is enough', await $('.cx-go').isEnabled());
  await click('.cx-go'); await p.waitForSelector('#cx-err-pm'); ok('a broken file: said in words, the file stays', /could not be read as a Postman/.test(await txt('#cx-err-pm')) && (await count('.cx-tile.has')) === 1, await txt('#cx-err-pm'));
  await p.setInputFiles('#fi-col', F('empty.json', { info: { name: 'E', schema: COL.info.schema }, item: [] })); await click('.cx-go'); await p.waitForSelector('#cx-err-pm'); ok('an empty collection: said in words', /no requests/.test(await txt('#cx-err-pm')));
  await p.setInputFiles('#fi-col', col); ok('another file: the message goes', !(await count('#cx-err-pm')));
  await p.setInputFiles('#fi-env', env); await p.setInputFiles('#fi-bru-cert', [pem, key]); await p.setInputFiles('#fi-bru-cert', pem);
  ok('certificates add up, none twice', (await count('.cx-tile .cx-chip')) === 2); await click('.cx-chip [aria-label="Remove client.key"]'); ok('one removed', (await count('.cx-tile .cx-chip')) === 1);
  await click('.cx-tile [data-rm=env]'); ok('environment removed', (await count('.cx-tile.has')) === 2); await p.setInputFiles('#fi-env', env);

  // ── the workspace
  await click('.cx-go'); await p.waitForSelector('#panel-bruno .cx-ws'); await settle();
  ok('the title is the script\'s name', (await txt('.cx-name')) === 'Shop API'); ok('DevWeb first', (await code()).includes('load.action')); ok('6 requests, 4 domains', (await count('.cx-row')) === 6 && (await count('.cx-dr')) === 4);
  ok('the page does not scroll', await p.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1));
  ok('a plain conversion is not an update', (await last()).protocol === 'devweb' && !('update' in (await last())));
  // format, mode, think time: by themselves
  await click('[data-set=fmt][data-v=web-http]'); await settle(); ok('VuGen at once', (await code()).includes('lr_start_transaction')); ok('an update is marked, and replaces the last ZIP', (await last()).update === '1' && /^[0-9a-f]{64}$/.test((await last()).replaces));
  await click('[data-act=undo]'); await settle(); ok('Undo: DevWeb', (await code()).includes('load.action')); await click('[data-act=redo]'); await settle(); ok('Redo: VuGen', (await code()).includes('lr_start_transaction'));
  await p.evaluate(() => document.activeElement.blur()); await p.keyboard.press('Control+z'); await settle(); ok('Ctrl+Z', (await code()).includes('load.action'));
  await click('[data-set=tt][data-v="5"]'); await settle(); ok('think time', (await code()).includes('thinkTime(5)'));
  await click('[data-set=mode][data-v=multi]'); await settle(); ok('one script per folder', (await p.locator(panel() + 'select optgroup').count()) === 2); await click('[data-set=mode][data-v=single]'); await settle();
  // the order, and a request's own code
  const names = await p.locator(panel() + '.cx-rn').allInnerTexts(); ok('the order of the collection', names.join() === 'Get token,My profile,Place order,Pay,Picture,Health', names);
  await click('[data-req="4"]'); const hl = await p.locator(panel() + '.hl').allInnerTexts(); ok('a request shows its code', hl.length > 4 && hl.join().includes('/pay/'), hl.slice(0, 4));
  ok('… from its first line', await p.evaluate(() => { const a = document.querySelector('#panel-bruno .hl').getBoundingClientRect(), c = document.getElementById('cx-code-pm').getBoundingClientRect(); return a.top >= c.top - 1 && a.top < c.top + 60; }));
  await click('[data-rtab=req]'); ok('its details', (await txt('.cx-rq')).includes('Bearer {{access_token}}')); await click('[data-act=leave]'); await settle(); ok('left out from its details', (await count('.cx-row.off')) === 1); await click('[data-act=leave]'); await settle(); await click('.cx-rq [data-rtab=code]');
  await $('[data-req="4"]').focus(); await p.keyboard.press('ArrowDown'); ok('arrow keys move in the list', (await st('s.sel')) === 5);
  // left out
  await click('.cx-row .cx-cb'); await settle(); ok('left out of the code', !(await code()).includes('GET_TOKEN')); ok('a value others send: said', /access_token.*left out/.test(await txt('.cx-notes'))); ok('counted on the tab', /5 of 6/.test(await txt('[data-tab=req]')));
  await click('[data-act=putneeded]'); await settle(); ok('put back', (await code()).includes('GET_TOKEN') && !(await count('.cx-note')));
  for (let k = 0; k < 2; k++) await p.locator(panel() + '.cx-row .cx-cb').nth(k).click(); const before = posts.length; await settle(); await p.waitForTimeout(500); ok('two quick ticks are one conversion', posts.length - before <= 1, posts.length - before); await click('[data-act=putback]'); await settle();
  await p.locator(panel() + '.cx-dr .cx-cb').first().click(); await settle(); ok('a domain left out', (await count('.cx-dr.off')) === 1); await click('[data-act=undo]'); await settle();
  for (const g of await p.locator(panel() + '.cx-left .cx-gh .cx-cb').all()) await g.click().catch(() => {}); await settle(); ok('never all of them', (await st('s.data.preview.requests.length - s.c.out.length')) >= 1); if (await count('[data-act=putback]')) { await click('[data-act=putback]'); await settle(); }
  // domains
  await click('[data-host="media.example.com"]'); ok('a domain shows its requests', (await count('.cx-row')) === 1 && (await count('.cx-filters'))); await click('[data-act=nohost]');
  await click('[data-ren="media.example.com"]'); await $('.cx-ren input').fill('9 bad'); await p.keyboard.press('Enter'); ok('a name that cannot be used: said', /letters, numbers/.test(await txt('.cx-err')) && (await $('.cx-ren input').inputValue()) === '9 bad'); await $('.cx-ren input').fill('Media_Server'); await p.keyboard.press('Enter'); await settle(); ok('the script\'s own parameter renamed', (await code()).includes('Media_Server') && (await txt('.cx-dom')).includes('Media_Server'));
  await click('[data-ren="api.example.com"]'); await $('.cx-ren input[name=n0]').fill('Shop_Server'); await p.keyboard.press('Enter'); await settle(); ok('a collection variable renamed, everywhere', (await code()).includes('Shop_Server') && !(await code()).includes('base_url') && (await txt('.cx-dom')).includes('Shop_Server'));
  await click('[data-ren="api.example.com"]'); await $('.cx-ren input[name=v0]').fill('https://test.example.com'); await p.keyboard.press('Enter'); await settle(); ok('its address changed', (await count('.cx-ren')) === 0 && (await txt('.cx-dom')).includes('test.example.com') && !(await txt('.cx-dom')).includes('api.example.com'), await txt('.cx-dom'));
  await click('[data-ren="test.example.com"]'); await $('.cx-ren input[name=n0]').fill('username'); await p.keyboard.press('Enter'); ok('a name already used: said', /already used/.test(await txt('.cx-err'))); await p.keyboard.press('Escape'); ok('Esc closes it', !(await count('.cx-ren')));
  await click('[data-set=fmt][data-v=web-http]'); await settle(); ok('the names hold in the other format', (await code()).includes('{Shop_Server}') && (await code()).includes('{Media_Server}')); await click('[data-set=fmt][data-v=devweb]'); await settle();
  await click('[data-fold-dom]'); ok('Domains fold', !(await count('.cx-dr'))); await click('[data-fold-dom]'); await click('[data-goval]'); ok('Needs a value → the field', await p.evaluate(() => document.activeElement.closest('form') && document.activeElement.closest('form').dataset.k === 'status_url'));
  // values
  const groups = await p.locator(panel() + '[data-vfold] b').allInnerTexts(); ok('values in groups, those to give first', groups[0] === 'Needs a value' && groups.includes('From the environment'), groups);
  ok('groups fold', !(await count('[data-edit=username]'))); await click('[data-vfold=environment]'); ok('… and open', (await count('[data-edit=username]')) === 1); ok('a secret is hidden', (await txt('.cx-left')).includes('hidden (looks like a secret)') && !(await txt('.cx-left')).includes('not-a-real-one'));
  await $('form[data-k=voucher] input').fill('SAVE10'); await p.keyboard.press('Enter'); await settle(); ok('a value given', (await st('JSON.stringify(s.data.preview.files)')).includes('SAVE10')); ok('one fewer to give', /1 to give/.test(await txt('[data-tab=val]')));
  await click('[data-edit=username]'); await $('form[data-k=username] input').fill('perf99'); await p.keyboard.press('Enter'); await settle(); ok('a value changed', (await st('JSON.stringify(s.data.preview.files)')).includes('perf99')); await click('[data-ungive=username]'); await settle(); ok('the file\'s value again', !(await st('JSON.stringify(s.data.preview.files)')).includes('perf99'));
  await click('[data-use=order_id]'); ok('a value\'s requests', (await count('.cx-row')) === 2); await click('[data-act=nouse]');
  // text being typed stays when an update arrives
  await click('[data-set=tt][data-v="3"]'); await $('form[data-k=status_url] input').count() || await click('[data-tab=val]'); await click('[data-tab=val]'); await $('form[data-k=status_url] input').fill('https://stat'); await p.evaluate(() => ConverterApp.set('pm', 'tt', 5)); await settle(); ok('text being typed stays', (await $('form[data-k=status_url] input').inputValue()) === 'https://stat'); await click('[data-tab=req]');
  // search, find
  await $('[data-in=q]').fill('pay'); ok('filter', (await count('.cx-row')) === 1); await $('[data-in=q]').fill('zzz'); ok('nothing found', await vis('.cx-empty')); await $('[data-in=q]').fill('');
  await $('[data-in=cq]').fill('token'); await p.waitForTimeout(260); ok('find in the file', (await count('mark.on')) === 1 && /found/.test(await txt('.cx-hits'))); await p.keyboard.press('Enter'); ok('the next one', (await st('s.hit')) === 1); ok('the field keeps the focus', await p.evaluate(() => document.activeElement.dataset.in === 'cq')); await $('[data-in=cq]').fill('');
  await $('select[data-in=file]').selectOption({ label: 'rts.yml' }); ok('another file', (await code()).includes('thinkTime'));
  await $('select[data-in=file]').selectOption('client.pem').catch(() => {}); ok('a certificate is not shown', /not shown here/.test(await txt('.cx-right')));
  // name, settings
  await click('[data-act=name]'); await $('#cx-name').fill('My/Shop run'); await p.keyboard.press('Enter'); await settle(); ok('renamed, made safe', (await txt('.cx-name')) === 'My_Shop run'); await click('[data-act=name]'); await p.keyboard.press('Escape'); ok('Esc keeps the name', (await txt('.cx-name')) === 'My_Shop run');
  await click('[data-dlg=sett]'); await p.locator('#cx-dlg [data-adv=cmt]').click(); await p.locator('#cx-dlg [data-set=ll][data-v=debug]').click(); await settle(); ok('settings apply at once', (await st('s.c.ll + s.c.adv.cmt')) === 'debugfalse' && (await last()).addComments === 'false'); await p.mouse.click(6, 350); ok('closed with a click outside', !(await p.locator('#cx-dlg').isVisible()));
  await click('[data-dlg=check]'); ok('ready list', (await p.locator('#cx-dlg .cx-di').count()) >= 5); await p.locator('#cx-dlg [data-go=val]').first().click(); ok('… goes to Values', await vis('[data-vfold]'));
  // download, twice, and after the link ran out
  let d = await zip(); ok('the ZIP has the name and what is shown', d.name === 'My_Shop_run.zip' && (await d.z.file('main.js').async('string')).includes('Shop_Server'), d.name); d = await zip(); ok('again, with no new conversion', d.name === 'My_Shop_run.zip');
  await p.evaluate(() => { const s = ConverterApp.state('pm'); s.zip = null; }); d = await zip(); ok('a used link is made again by itself', !!d.z.file('main.js'));
  await click('[data-set=tt][data-v="2"]'); d = await zip(); ok('Download waits for a change in progress', (await d.z.file('main.js').async('string')).includes('thinkTime(2)'));
  // a failed update keeps everything
  await p.route('**/convert', (r) => r.abort()); await click('[data-set=fmt][data-v=web-http]'); await settle(); ok('not updated: said, the script stays', /Not updated/.test(await txt('.cx-state')) && /did not answer/.test(await txt('.cx-notes')) && (await code()).includes('load.action')); await p.unroute('**/convert'); await click('[data-act=retry]'); await settle(); ok('Try again', (await code()).includes('lr_start_transaction') && (await txt('.cx-name')) === 'My_Shop run');
  let busy = 2; await p.route('**/convert', (r) => (busy-- > 0 ? r.fulfill({ status: 503, contentType: 'application/json', body: '{"error":"server_busy"}' }) : r.continue())); await click('[data-set=fmt][data-v=devweb]'); await p.waitForTimeout(1600); await settle(); ok('a busy server is asked again', (await code()).includes('load.action')); await p.unroute('**/convert');
  // panels
  const x = await p.locator(panel() + '.cx-rs').boundingBox(); await p.mouse.move(x.x + 7, x.y + 100); await p.mouse.down(); await p.mouse.move(x.x - 93, x.y + 100, { steps: 8 }); await p.mouse.up(); const y = await p.locator(panel() + '.cx-rs').boundingBox(); ok('the panels resize', Math.abs(x.x - y.x - 100) < 8, [x.x, y.x]); await p.locator(panel() + '.cx-rs').dblclick(); ok('double-click puts it back', Math.abs((await p.locator(panel() + '.cx-rs').boundingBox()).x - x.x) < 3);
  for (const k of ['d', 'l', 'r']) { await click(`[data-hide=${k}]`); ok('hidden: ' + k, await vis(`[data-show=${k}]`)); if (k === 'l') ok('the last panel stays', await $('[data-hide=r]').isDisabled()); await click(`[data-show=${k}]`); }
  // both tools keep their own
  kind = 'jmx'; await go('jmeter'); ok('JMeter at its own start', await vis('.cx-tile')); await p.setInputFiles('#fi-jmx', IN + 'rich.jmx'); await click('.cx-go'); await p.waitForSelector('#panel-jmx .cx-ws'); await settle();
  ok('thread groups with their load', /10 users/.test(await txt('.cx-left'))); ok('the missing CSV: said', /users\.csv/.test(await txt('.cx-notes'))); await p.setInputFiles('#fi-csv', IN + 'users.csv'); await settle(); ok('added', !(await count('.cx-note')));
  await click('[data-set=mode][data-v=multi]'); await settle(); ok('several scripts: the first request\'s first', (await $('select[data-in=file]').inputValue()) === 'Buyers/main.js'); await click('[data-set=fmt][data-v=web-http]'); await settle(); d = await zip(); ok('the CSV is in each script folder', !!d.z.file('Buyers/users.csv') && !!d.z.file('Browsers/users.csv'), Object.keys(d.z.files).slice(0, 5));
  await click('[data-req="4"]'); ok('a request in its thread group\'s script', (await $('select[data-in=file]').inputValue()) === 'Browsers/Action.c' && (await count('.hl')) > 3);
  await click('[data-ren]'); await $('.cx-ren input[name=n0]').fill('Shop_Host'); await p.keyboard.press('Enter'); await settle(); ok('a JMeter variable renamed', (await txt('.cx-dom')).includes('Shop_Host') && (await st('JSON.stringify(s.data.preview.files)')).includes('Shop_Host'));
  await click('[data-dlg=sett]'); await p.locator('#cx-dlg [data-set=wlm][data-v=false]').click(); await settle(); ok('workbook left out', !(await st('s.data.preview.files.map(f => f.path).join()')).includes('.xlsx')); await p.locator('#cx-dlg .cx-df [data-close]').click();
  kind = 'pm'; await go('postman'); ok('Postman as it was', (await txt('.cx-name')) === 'My_Shop run'); await go('home'); await go('postman'); ok('… also after another page', await vis('.cx-ws'));
  // another file, clear
  await p.setInputFiles('#fi-col', col2); await settle(); ok('another collection: its own name, no old choices', (await txt('.cx-name')) === 'Other API' && (await st('JSON.stringify(s.c.varNames) + s.c.name')) === '{}');
  await p.evaluate(() => globalClear()); ok('Clear: the start', await vis('.cx-tile') && !(await count('.cx-tile.has'))); await p.locator('.cx-toast button').click(); ok('… and Undo', await vis('.cx-ws')); kind = 'jmx'; ok('the other tool untouched', (await st('!!s.data')) === true); kind = 'pm';
  await click('[data-dlg=files]'); await p.locator('#cx-dlg [data-act=another]').click(); ok('Convert another', await vis('.cx-tile')); await p.locator('.cx-toast button').click(); ok('… and back', await vis('.cx-ws'));
  await click('[data-dlg=files]'); await p.locator('#cx-dlg [data-rm=env]').click(); await settle(); await p.locator('#cx-dlg .cx-df [data-close]').click(); ok('no environment: more values to give', /[3-9] to give/.test(await txt('[data-tab=val]')), await txt('[data-tab=val]'));
  // dropped anywhere; remembered
  await p.evaluate(() => globalClear()); await p.evaluate(([a, e]) => { const t = new DataTransfer(); t.items.add(new File([a], 'Shop.json')); t.items.add(new File([e], 'Test.postman_environment.json')); for (const k of ['dragenter', 'dragover', 'drop']) document.body.dispatchEvent(new DragEvent(k, { dataTransfer: t, bubbles: true, cancelable: true })); }, [JSON.stringify(COL), JSON.stringify(ENV)]); await p.waitForTimeout(200); ok('two files dropped go to their boxes', (await count('.cx-tile.has')) === 2 && (await st('s.files.main.name + s.files.env.name')) === 'Shop.jsonTest.postman_environment.json');
  await click('.cx-go'); await p.waitForSelector('#panel-bruno .cx-ws'); await settle(); ok('remembered: think time and log level', (await st('s.c.tt + s.c.ll')) === '2debug');
  await p.reload(); await p.waitForLoadState('networkidle'); ok('… also after a reload', (await st('s.c.tt + s.c.ll')) === '2debug');
  ok('the address never changed', /\/converter\/?$/.test(p.url()) && !p.url().includes('#')); ok('no browser alert', !alerts.length, alerts); ok('no page error', !errs.length, errs);
  await b.close(); fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`${n - fails} of ${n} checks passed`); process.exitCode = fails ? 1 : 0;
})().catch((e) => { console.error('STOPPED: ' + e.message.split('\n').slice(0, 4).join(' ')); console.log(`${n - fails} of ${n} checks passed before it stopped`); process.exit(1); });
