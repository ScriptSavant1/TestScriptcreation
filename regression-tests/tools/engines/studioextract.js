// Prove Script Studio's extractors and lists with the real engines.
//   node studioextract.js <studio page url> <out dir>      e.g. http://localhost:3999/studio C:/tmp/sx
// Each case writes a small recording and a second copy of it where every dynamic value is different. Script Studio
// (driven in Edge) reads the first and makes its Web HTTP/HTML and DevWeb ZIP files; they are replayed with VuGen
// (runvugen.js) and DevWeb (rundevweb.js) against the SECOND copy, so the last request must send the NEW values —
// only true when the script reads them from the responses.
//   extractors   SOAP XML in a namespace, plain XML with an attribute, a value inside a page script: XPath (×3) and
//                Regex, added the way the correlation editor does (advisorAddManual + _edit + advisorApplyOne)
//   list-all     a list of four items, a later request sends the 1st and 4th item's value: the Correlation Advisor's
//                own list (SelectAll), Every value — the new values at the same places (BUG-150)
//   list-random  the same list, One at random: one new value, picked once per iteration (both fields send it)
//   select-*     a page with two <select>s; a list made in the editor (advisorAddList) from the second one's options —
//                boundaries <option value=" … " with every match and the range of that select — and a JSON list:
//                select-recorded (the place recorded), select-rotate (the next each iteration, 2 iterations),
//                json-nth (always the 3rd), json-random (one of them)
'use strict';
const fs = require('fs'), path = require('path'), { execFileSync } = require('child_process');
const { chromium } = require(path.resolve(__dirname, '../../../cdp-recorder/recorder/node_modules/playwright-core'));
const [URL, OUT0] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (!URL || !OUT0) { console.error('usage: node studioextract.js <studio page url> <out dir>'); process.exit(2); }
const OUT = path.resolve(OUT0);
fs.mkdirSync(OUT, { recursive: true });

function har(entries) {
  let t = Date.parse('2026-01-01T10:00:00Z');
  return { log: { version: '1.2', creator: { name: 'studioextract', version: '1' }, pages: [], entries: entries.map(([method, url, mime, body, req]) => ({
    startedDateTime: new Date(t += 1000).toISOString(), time: 50,
    request: { method, url, httpVersion: 'HTTP/1.1', headers: [{ name: 'Accept', value: '*/*' }].concat(req ? [{ name: 'Content-Type', value: req.mime }] : []), queryString: [], cookies: [], headersSize: -1, bodySize: req ? req.text.length : 0, postData: req ? Object.assign({ mimeType: req.mime, text: req.text }, /urlencoded/.test(req.mime) ? { params: [...new URLSearchParams(req.text)].map(([name, value]) => ({ name, value })) } : {}) : undefined },
    response: { status: 200, statusText: 'OK', httpVersion: 'HTTP/1.1', headers: [{ name: 'Content-Type', value: mime }], cookies: [], content: { size: body.length, mimeType: mime, text: body }, redirectURL: '', headersSize: -1, bodySize: body.length },
    cache: {}, timings: { send: 1, wait: 40, receive: 9 },
  })) } };
}
const JSONM = 'application/json';

const EXTRACT = {
  old: { st: 'ST-7f3a9c2e41d8', build: 'B-55aa66bb77', key: 'K-0099887766', nonce: 'NC-1234abcd5678' },
  new: { st: 'ST-NEW000000001', build: 'B-NEW00000002', key: 'K-NEW0000003', nonce: 'NC-NEW00000004' },
  har: (v) => har([
    ['POST', 'https://api.example.com/soap/login', 'text/xml; charset=utf-8',
      `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><LoginResponse xmlns="urn:example:auth"><SessionToken>${v.st}</SessionToken><Expires>3600</Expires></LoginResponse></soap:Body></soap:Envelope>`,
      { mime: 'text/xml; charset=utf-8', text: '<?xml version="1.0"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body><Login xmlns="urn:example:auth"><User>tester</User></Login></soap:Body></soap:Envelope>' }],
    ['GET', 'https://api.example.com/plain.xml', 'application/xml', `<?xml version="1.0"?><config><build id="${v.build}">current</build><key>${v.key}</key></config>`],
    ['GET', 'https://api.example.com/page', 'text/html; charset=utf-8', `<!doctype html><html><head><script>window.__cfg = {"nonce":"${v.nonce}", "v":2};</script></head><body>ok</body></html>`],
    ['POST', 'https://api.example.com/use', JSONM, '{"ok":true}', { mime: JSONM, text: JSON.stringify({ session: v.st, key: v.key, build: v.build, nonce: v.nonce }) }],
  ]),
  // in the page: the four values, the way the editor adds them
  setup: (OLD) => {
    const S = PerfxStudio.state(), idx = (u) => S.entries1.findIndex((e) => e.url.endsWith(u));
    const add = (src, name, value, type, cfg) => { const c = advisorAddManual(idx(src), 'boundary', '', name, value); c._edit = { extractorType: type, extractorConfig: cfg, sourceIdx: idx(src) }; advisorApplyOne(c); };
    add('/soap/login', 'session', OLD.st, 'xpath', { path: '/Envelope/Body/LoginResponse/SessionToken' });
    add('/plain.xml', 'cfgKey', OLD.key, 'xpath', { path: '//key' });
    add('/plain.xml', 'build', OLD.build, 'xpath', { path: '/config/build/@id' });
    add('/page', 'nonce', OLD.nonce, 'regexp', { pattern: '"nonce":"([^"]+)"' });
    S.correlations = S.correlations.filter((c) => ['session', 'cfgKey', 'build', 'nonce'].includes(c.name));
    regenerateFromAdvisor({ quiet: true });
    return 'XPath ×3, Regex';
  },
  check: (sent, NEW) => {
    const want = { session: NEW.st, key: NEW.key, build: NEW.build, nonce: NEW.nonce };
    const wrong = Object.keys(want).filter((k) => sent[k] !== want[k]);
    return wrong.length ? 'WRONG ' + wrong.map((k) => k + '=' + sent[k]).join(', ') : '';
  },
};

const LIST_OLD = { img: ['a3f1c2d4-1111-4aaa-8bbb-000000000001', 'a3f1c2d4-2222-4aaa-8bbb-000000000002', 'a3f1c2d4-3333-4aaa-8bbb-000000000003', 'a3f1c2d4-4444-4aaa-8bbb-000000000004'] };
const LIST_NEW = { img: ['b9e8d7c6-1111-4ccc-9ddd-100000000001', 'b9e8d7c6-2222-4ccc-9ddd-100000000002', 'b9e8d7c6-3333-4ccc-9ddd-100000000003', 'b9e8d7c6-4444-4ccc-9ddd-100000000004'] };
const listHar = (v) => har([
  ['GET', 'https://shop.example.com/api/products?page=1', JSONM, JSON.stringify({ items: v.img.map((k, i) => ({ sku: 'SKU-' + (5000 + i), price: 10 + i, imageKey: k })), total: 4 })],
  ['POST', 'https://shop.example.com/api/wishlist', JSONM, '{"ok":true}', { mime: JSONM, text: JSON.stringify({ primaryImage: v.img[0], altImage: v.img[3], note: 'shortlist' }) }],
]);
// in the page: only the Correlation Advisor's list, every value or one at random
const listSetup = (pick) => {
  const S = PerfxStudio.state(), c = S.advisorCandidates.find((x) => x._selectAll && !x._arrayReconstruct);
  if (!c) return 'NO LIST FOUND';
  S.advisorCandidates.forEach((x) => { if (x !== c && x.status === 'accepted') advisorAccept(x.id); });
  if (c.status !== 'accepted') advisorAccept(c.id);
  if (pick === 'random') c._pick = 'random';
  advisorApplyAndRegen();
  return c.varName + ' ' + (pick === 'random' ? 'one at random' : 'every value') + ', places ' + S.correlations.find((x) => x.name === c.varName).usages.map((u) => u.listIdx).join(',');
};
const SEL_OLD = { flights: ['F-1001;0800;ab12', 'F-1002;1130;cd34', 'F-1003;1545;ef56', 'F-1004;1920;gh78'], seats: ['S-7A1B2C', 'S-7A1B2D', 'S-7A1B2E', 'S-7A1B2F'] };
const SEL_NEW = { flights: ['F-9001;0700;zz01', 'F-9002;1000;zz02', 'F-9003;1300;zz03', 'F-9004;1600;zz04'], seats: ['S-NEW001', 'S-NEW002', 'S-NEW003', 'S-NEW004'] };
const FORM = 'application/x-www-form-urlencoded';
const selHar = (v) => har([
  ['GET', 'https://travel.example.com/flights', 'text/html; charset=utf-8', '<!doctype html><html><body><form action="/book" method="post">' +
    '<select name="seatClass"><option value="economy">Economy</option><option value="business">Business</option><option value="first">First</option></select>' +
    '<select name="outbound">' + v.flights.map((x) => '<option value="' + x + '">' + x.split(';')[1] + '</option>').join('') + '</select></form></body></html>'],
  ['POST', 'https://travel.example.com/book', 'text/html', '<html>booked</html>', { mime: FORM, text: 'seatClass=economy&outbound=' + encodeURIComponent(v.flights[1]) }],
  ['GET', 'https://travel.example.com/api/seats', JSONM, JSON.stringify({ seats: v.seats.map((id, i) => ({ id, row: 7, n: i })) })],
  ['POST', 'https://travel.example.com/api/hold', JSONM, '{"ok":true}', { mime: JSONM, text: JSON.stringify({ seat: v.seats[2] }) }],
]);
// in the page: the list as the editor makes it (StudioEdit reads the values; advisorAddList; advisorApplyOne)
const selSetup = (arg) => {
  const S = PerfxStudio.state(), idx = (u) => S.entries1.findIndex((e) => e.url.endsWith(u));
  (S.advisorCandidates || []).forEach((x) => { if (x.status === 'accepted') advisorAccept(x.id); });
  let c;
  if (arg.kind === 'select') {
    const i = idx('/flights'), body = S.entries1[i].respBody, ext = { extractorType: 'boundary', extractorConfig: { lb: '<option value="', rb: '"', all: true } };
    const vals = StudioEdit.boundAll(body, '<option value="', '"');
    c = advisorAddList(i, ext, 'outbound', vals, { from: 4, to: 7, pick: arg.pick });
  } else {
    const i = idx('/api/seats'), ext = { extractorType: 'jsonpath', extractorConfig: { path: '$.seats[*].id', selectAll: true } };
    c = advisorAddList(i, ext, 'seatId', StudioEdit.jsonAll(S.entries1[i].respBody, '$.seats[*].id'), { pick: arg.pick, nth: arg.nth });
  }
  advisorApplyOne(c);
  S.correlations = S.correlations.filter((x) => x.name === c.varName);
  regenerateFromAdvisor({ quiet: true });
  return c.varName + ' ' + arg.pick + ', places ' + c.usages.map((u) => u.listIdx).join(',');
};
const form = (r) => { const o = {}; new URLSearchParams(r.body || '').forEach((v, k) => { o[k] = v; }); return o; };
const CASES = {
  extractors: { ...EXTRACT, last: /\/use$/ },
  'list-all': { old: LIST_OLD, new: LIST_NEW, har: listHar, last: /\/wishlist$/, setup: listSetup, arg: 'all',
    check: (sent, NEW) => sent.primaryImage === NEW.img[0] && sent.altImage === NEW.img[3] ? '' : 'WRONG primaryImage=' + sent.primaryImage + ', altImage=' + sent.altImage },
  'list-random': { old: LIST_OLD, new: LIST_NEW, har: listHar, last: /\/wishlist$/, setup: listSetup, arg: 'random',
    check: (sent, NEW) => NEW.img.includes(sent.primaryImage) && sent.altImage === sent.primaryImage ? '' : 'WRONG primaryImage=' + sent.primaryImage + ', altImage=' + sent.altImage },
  'select-recorded': { old: SEL_OLD, new: SEL_NEW, har: selHar, last: /\/book$/, iters: 2, setup: selSetup, arg: { kind: 'select', pick: 'all' },
    checkAll: (rs, NEW) => { const v = rs.map((r) => form(r).outbound); return v.length === 2 && v.every((x) => x === NEW.flights[1]) ? '' : 'WRONG ' + v.join(' / '); } },
  'select-rotate': { old: SEL_OLD, new: SEL_NEW, har: selHar, last: /\/book$/, iters: 2, setup: selSetup, arg: { kind: 'select', pick: 'rotate' },
    checkAll: (rs, NEW) => { const v = rs.map((r) => form(r).outbound); return v.join(' / ') === NEW.flights[0] + ' / ' + NEW.flights[1] ? '' : 'WRONG ' + v.join(' / '); } },
  'json-nth': { old: SEL_OLD, new: SEL_NEW, har: selHar, last: /\/api\/hold$/, iters: 2, setup: selSetup, arg: { kind: 'json', pick: 'nth', nth: 3 },
    checkAll: (rs, NEW) => { const v = rs.map((r) => JSON.parse(r.body || '{}').seat); return v.length === 2 && v.every((x) => x === NEW.seats[2]) ? '' : 'WRONG ' + v.join(' / '); } },
  'json-random': { old: SEL_OLD, new: SEL_NEW, har: selHar, last: /\/api\/hold$/, iters: 2, setup: selSetup, arg: { kind: 'json', pick: 'random' },
    checkAll: (rs, NEW) => { const v = rs.map((r) => JSON.parse(r.body || '{}').seat); return v.length === 2 && v.every((x) => NEW.seats.includes(x)) ? '' : 'WRONG ' + v.join(' / '); } },
};
const ONLY = (process.argv.find((a) => a.startsWith('--only=')) || '').slice(7);

(async () => {
  const b = await chromium.launch({ channel: 'msedge' });
  let bad = 0;
  for (const [name, C] of Object.entries(CASES)) {
    if (ONLY && !name.includes(ONLY)) continue;
    const dir = path.join(OUT, name);
    fs.mkdirSync(dir, { recursive: true });
    const REC = path.join(dir, 'rec.har'), REPLAY = path.join(dir, 'replay.har');
    fs.writeFileSync(REC, JSON.stringify(C.har(C.old)));
    fs.writeFileSync(REPLAY, JSON.stringify(C.har(C.new)));
    for (const [fmt, runner, engine] of [['webhttp', 'runvugen.js', 'VuGen '], ['devweb', 'rundevweb.js', 'DevWeb']]) {
      const p = await b.newPage();
      p.on('pageerror', (e) => console.log('page error:', e.message));
      await p.goto(URL);
      await p.evaluate((f) => setFmt(f), fmt);
      await p.setInputFiles('#dz1 input[type=file]', REC);
      await p.waitForFunction(() => document.body.classList.contains('ss-view-ws') && !document.body.classList.contains('ss-reading'), null, { timeout: 60000 });
      await p.waitForTimeout(500);
      if (await p.isVisible('.bg-review-apply')) { await p.click('.bg-review-apply'); await p.waitForTimeout(400); }
      const what = await p.evaluate(C.setup, C.arg !== undefined ? C.arg : C.old);
      await p.waitForTimeout(800);
      const files = await p.evaluate(async (f) => {
        let got = null; const orig = JSZip.prototype.generateAsync;
        JSZip.prototype.generateAsync = async function (o) { got = {}; for (const [n, x] of Object.entries(this.files)) if (!x.dir) got[n] = await x.async('string'); return orig.call(this, o); };
        try { await dlZip(f); } finally { JSZip.prototype.generateAsync = orig; }
        return got;
      }, fmt);
      await p.close();
      const sdir = path.join(dir, fmt);
      fs.rmSync(sdir, { recursive: true, force: true }); fs.mkdirSync(sdir, { recursive: true });
      for (const [n, x] of Object.entries(files)) fs.writeFileSync(path.join(sdir, path.basename(n)), x);
      const out = path.join(dir, 'run-' + fmt);
      execFileSync(process.execPath, [path.join(__dirname, runner), sdir, out, '--har=' + REPLAY, '--iters=' + (C.iters || 1)], { stdio: 'ignore' });
      const wire = fs.existsSync(path.join(out, 'wire.jsonl')) ? fs.readFileSync(path.join(out, 'wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
      const last = wire.find((r) => C.last.test(r.url));
      let sent = {}; try { sent = JSON.parse(last && last.body || '{}'); } catch (e) { sent = {}; }
      const lasts = wire.filter((r) => C.last.test(r.url));
      const wrong = !last ? 'the last request was not sent' : C.checkAll ? C.checkAll(lasts, C.new) : C.check(sent, C.new);
      if (wrong) bad++;
      console.log(name + ' ' + engine + ' (' + what + '): ' + (wrong || 'the new values sent'));
    }
  }
  await b.close();
  process.exit(bad ? 1 : 0);
})();
