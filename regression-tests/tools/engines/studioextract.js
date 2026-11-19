// Prove Script Studio's Regex and XPath extractors with the real engines.
//   node studioextract.js <studio page url> <out dir>      e.g. http://localhost:3999/studio C:/tmp/sx
// Writes a small recording (SOAP XML in a namespace, plain XML with an attribute, a value inside a page script) and a
// second copy of it where every dynamic value is different. Script Studio (driven in Edge) reads the first, gets the
// four values by XPath (×3) and Regex the way its editor does (advisorAddManual + _edit + advisorApplyOne), and its
// Web HTTP/HTML and DevWeb ZIP files are replayed with VuGen (runvugen.js) and DevWeb (rundevweb.js) against the
// SECOND copy: the last request must send the new values — only true when each extractor reads its value.
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require(path.resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const [URL, OUT0] = process.argv.slice(2);
if (!URL || !OUT0) { console.error('usage: node studioextract.js <studio page url> <out dir>'); process.exit(2); }
const OUT = path.resolve(OUT0);
fs.mkdirSync(OUT, { recursive: true });

const OLD = { st: 'ST-7f3a9c2e41d8', build: 'B-55aa66bb77', key: 'K-0099887766', nonce: 'NC-1234abcd5678' };
const NEW = { st: 'ST-NEW000000001', build: 'B-NEW00000002', key: 'K-NEW0000003', nonce: 'NC-NEW00000004' };
function har(v) {
  let t = Date.parse('2026-01-01T10:00:00Z');
  const e = (method, url, mime, body, req) => ({
    startedDateTime: new Date(t += 1000).toISOString(), time: 50,
    request: { method, url, httpVersion: 'HTTP/1.1', headers: [{ name: 'Accept', value: '*/*' }].concat(req ? [{ name: 'Content-Type', value: req.mime }] : []), queryString: [], cookies: [], headersSize: -1, bodySize: req ? req.text.length : 0, postData: req ? { mimeType: req.mime, text: req.text } : undefined },
    response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [{ name: 'Content-Type', value: mime }], cookies: [], content: { size: body.length, mimeType: mime, text: body }, redirectURL: '', headersSize: -1, bodySize: body.length },
    cache: {}, timings: { send: 1, wait: 40, receive: 9 },
  });
  return { log: { version: '1.2', creator: { name: 'studioextract', version: '1' }, pages: [], entries: [
    e('POST', 'https://api.example.com/soap/login', 'text/xml; charset=utf-8',
      `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><LoginResponse xmlns="urn:example:auth"><SessionToken>${v.st}</SessionToken><Expires>3600</Expires></LoginResponse></soap:Body></soap:Envelope>`,
      { mime: 'text/xml; charset=utf-8', text: '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><Login xmlns="urn:example:auth"><User>tester</User></Login></soap:Body></soap:Envelope>' }),
    e('GET', 'https://api.example.com/plain.xml', 'application/xml', `<?xml version="1.0"?><config><build id="${v.build}">current</build><key>${v.key}</key></config>`),
    e('GET', 'https://api.example.com/page', 'text/html; charset=utf-8', `<!doctype html><html><head><script>window.__cfg = {"nonce":"${v.nonce}", "v":2};</script></head><body>ok</body></html>`),
    e('POST', 'https://api.example.com/use', 'application/json', '{"ok":true}', { mime: 'application/json', text: JSON.stringify({ session: v.st, key: v.key, build: v.build, nonce: v.nonce }) }),
  ] } };
}
const REC = path.join(OUT, 'rec.har'), REPLAY = path.join(OUT, 'replay.har');
fs.writeFileSync(REC, JSON.stringify(har(OLD)));
fs.writeFileSync(REPLAY, JSON.stringify(har(NEW)));

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  for (const fmt of ['webhttp', 'devweb']) {
    const p = await b.newPage();
    p.on('pageerror', (e) => console.log('page error:', e.message));
    await p.goto(URL);
    await p.evaluate((f) => setFmt(f), fmt);
    await p.setInputFiles('#dz1 input[type=file]', REC);
    await p.waitForFunction(() => document.body.classList.contains('ss-view-ws') && !document.body.classList.contains('ss-reading'), null, { timeout: 60000 });
    await p.waitForTimeout(500);
    if (await p.isVisible('.bg-review-apply')) { await p.click('.bg-review-apply'); await p.waitForTimeout(400); }
    await p.evaluate((OLD) => {
      const S = PerfxStudio.state(), idx = (u) => S.entries1.findIndex((e) => e.url.endsWith(u));
      const add = (src, name, value, type, cfg) => { const c = advisorAddManual(idx(src), 'boundary', '', name, value); c._edit = { extractorType: type, extractorConfig: cfg, sourceIdx: idx(src) }; advisorApplyOne(c); };
      add('/soap/login', 'session', OLD.st, 'xpath', { path: '/Envelope/Body/LoginResponse/SessionToken' });
      add('/plain.xml', 'cfgKey', OLD.key, 'xpath', { path: '//key' });
      add('/plain.xml', 'build', OLD.build, 'xpath', { path: '/config/build/@id' });
      add('/page', 'nonce', OLD.nonce, 'regexp', { pattern: '"nonce":"([^"]+)"' });
      S.correlations = S.correlations.filter((c) => ['session', 'cfgKey', 'build', 'nonce'].includes(c.name));
      regenerateFromAdvisor({ quiet: true });
    }, OLD);
    await p.waitForTimeout(800);
    const files = await p.evaluate(async (f) => {
      let got = null; const orig = JSZip.prototype.generateAsync;
      JSZip.prototype.generateAsync = async function (o) { got = {}; for (const [n, x] of Object.entries(this.files)) if (!x.dir) got[n] = await x.async('string'); return orig.call(this, o); };
      try { await dlZip(f); } finally { JSZip.prototype.generateAsync = orig; }
      return got;
    }, fmt);
    const dir = path.join(OUT, fmt);
    fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir, { recursive: true });
    for (const [n, x] of Object.entries(files)) fs.writeFileSync(path.join(dir, path.basename(n)), x);
    await p.close();
  }
  await b.close();

  let bad = 0;
  for (const [fmt, runner] of [['webhttp', 'runvugen.js'], ['devweb', 'rundevweb.js']]) {
    const out = path.join(OUT, 'run-' + fmt);
    execFileSync(process.execPath, [path.join(__dirname, runner), path.join(OUT, fmt), out, '--har=' + REPLAY, '--iters=1'], { stdio: 'inherit' });
    const wire = fs.existsSync(path.join(out, 'wire.jsonl')) ? fs.readFileSync(path.join(out, 'wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const use = wire.find((r) => /\/use$/.test(r.url));
    const sent = use ? JSON.parse(use.body || '{}') : {};
    const want = { session: NEW.st, key: NEW.key, build: NEW.build, nonce: NEW.nonce };
    const wrong = Object.keys(want).filter((k) => sent[k] !== want[k]);
    if (wrong.length) bad++;
    console.log((fmt === 'webhttp' ? 'VuGen ' : 'DevWeb') + ': ' + (use ? (wrong.length ? 'WRONG ' + wrong.map((k) => k + '=' + sent[k]).join(', ') : 'all four new values sent (XPath in a namespace, //key, @id, Regex)') : 'the last request was not sent'));
  }
  process.exit(bad ? 1 : 0);
})();
