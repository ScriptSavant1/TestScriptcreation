'use strict';

/**
 * HAR Explorer — "Find a value" (src/web/public/portal/har-explorer-worker.js).
 *
 * The worker runs Script Studio's engine (constants, correlation, studio-advisor — unchanged) beside its own search.
 * Loaded here exactly as the browser runs it (importScripts = the Studio files, messages in and out):
 *  - every verdict: correlate (JSON / HTML field / redirect), cookie only, followed redirect, typed value, made by the
 *    browser, not found; encoded forms (URL-encoded) are matched to the original
 *  - agreement with Script Studio: every value Studio correlates by itself is a suggestion marked "studio", and Find
 *    names the same request as its source
 */

const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');

function loadWorker() {
  const studio = ['VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js'].map(read).join('\n');
  const out = [];
  // eslint-disable-next-line no-new-func
  const f = new Function('importScripts', 'postMessage', 'onmessage', studio + '\n' + read('portal/har-explorer-worker.js') + '\nreturn function (m) { onmessage({ data: m }); };');
  const send = f(() => {}, (m) => out.push(m), undefined);
  return {
    // as the page does: the Explorer's own suggestions at once, then Script Studio's findings from a second copy
    load(har, left) {
      out.length = 0;
      const text = JSON.stringify(har);
      send({ type: 'load', text, out: left || [] });
      const first = out.pop();
      expect(first.studioDone).toBe(false);
      send({ type: 'studio', text });
      const list = out.pop().list;
      send({ type: 'studioList', list });
      return out.pop();
    },
    find(value) { out.length = 0; send({ type: 'find', id: 1, value }); return out.pop().result; },
  };
}

const t0 = Date.parse('2026-10-30T09:00:00.000Z');
let k = 0;
const H = (o) => Object.entries(o).map(([name, value]) => ({ name, value }));
function entry(url, o = {}) {
  k++;
  return {
    startedDateTime: new Date(t0 + k * 100).toISOString(), time: 50, _resourceType: o.rt || 'Fetch',
    request: { method: o.method || 'GET', url, httpVersion: 'HTTP/1.1', headers: H(o.rh || {}), queryString: o.query || [], cookies: [],
      postData: o.body ? { mimeType: o.bodyMime || 'application/json', text: o.body, params: o.params } : undefined },
    response: { status: o.status || 200, statusText: 'OK', headers: H(Object.assign({ 'Content-Type': o.mime || 'application/json' }, o.sh || {})), cookies: [],
      content: { size: (o.text || '').length, mimeType: o.mime || 'application/json', text: o.text || '' }, redirectURL: '' },
    timings: { send: 1, wait: 40, receive: 9 },
  };
}

const SID = 'a3f9c2e1-7b44-4d0e-9a51-2c8e6f1d0b7a', CSRF = 'k8Jd2pQx9LmZ4Rt7', CUR = 'eyJwYWdlIjoyfQ==', REQID = '5b1e0c9a-2f4d-4e8b-9c3a-7d6f1e2b4a90';
const JWT = 'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyMDEiLCJleHAiOjE3OTk5OTk5OTl9.c2lnbmF0dXJlLXNhbXBsZQ';
const shop = () => ({ log: { version: '1.2', creator: { name: 'test' }, entries: [
  /* 1 */ entry('https://shop.example.com/login', { rt: 'Document', mime: 'text/html',
    text: `<form><input type="hidden" name="_csrf" value="${CSRF}"><input name="username"></form>`, sh: { 'Set-Cookie': `XSRF-TOKEN=${CSRF}; Path=/` } }),
  /* 2 */ entry('https://api.example.com/v1/auth/login', { method: 'POST', rh: { 'X-XSRF-TOKEN': CSRF, Cookie: `XSRF-TOKEN=${CSRF}` },
    body: JSON.stringify({ username: 'user01', password: 'Secret#2026' }),
    text: JSON.stringify({ access_token: JWT, session: { sessionId: SID } }), sh: { 'Set-Cookie': `SESSION=${SID}; Path=/; HttpOnly` } }),
  /* 3 */ entry('https://api.example.com/v1/products?page=1', { rh: { Authorization: 'Bearer ' + JWT, 'X-Session-Id': SID },
    text: JSON.stringify({ page: 1, next: CUR, items: [{ id: 'P-1001' }] }) }),
  /* 4 */ entry('https://api.example.com/v1/products?cursor=' + encodeURIComponent(CUR), { rh: { Authorization: 'Bearer ' + JWT },
    query: [{ name: 'cursor', value: encodeURIComponent(CUR) }], text: '{"page":2}' }),
  /* 5 */ entry('https://api.example.com/v1/cart', { method: 'POST', rh: { Authorization: 'Bearer ' + JWT, 'X-Request-Id': REQID, Cookie: `SESSION=${SID}` },
    body: '{"productId":"P-1001"}', text: '{"cartId":"C-88231"}' }),
  /* 6 */ entry('https://shop.example.com/checkout', { method: 'POST', rt: 'Document', status: 302, rh: { Cookie: `SESSION=${SID}` },
    bodyMime: 'application/x-www-form-urlencoded', body: `_csrf=${CSRF}&cartId=C-88231`, params: [{ name: '_csrf', value: CSRF }, { name: 'cartId', value: 'C-88231' }],
    sh: { Location: '/order/O-55102' }, mime: 'text/html' }),
  /* 7 */ entry('https://shop.example.com/order/O-55102', { rt: 'Document', mime: 'text/html', text: '<h1>Thank you</h1>', rh: { Cookie: `SESSION=${SID}` } }),
  /* 8 */ entry('https://api.example.com/v1/orders/O-55102', { rh: { Authorization: 'Bearer ' + JWT } }),
  /* 9 */ entry('https://api.example.com/v1/poll?_=1793350804123', {}),
  /* 10 */ entry('https://shop.example.com/after', { rh: { Cookie: 'tracker=abcdef1234567890xyz' }, sh: {} }),
] } });

describe('HAR Explorer — Find a value', () => {
  const w = loadWorker();
  w.load(shop());

  test('a JSON value the server sends and later requests send back: correlate it, captured from the JSON field', () => {
    const r = w.find(SID);
    expect(r.kind).toBe('correlate');
    expect([r.src.n, r.src.where]).toEqual([2, 'JSON $.session.sessionId']);       // the JSON field, not the Set-Cookie of the same response
    expect(r.later.map((u) => `${u.n} ${u.where}`)).toEqual(['3 header X-Session-Id', '5 cookie SESSION', '6 cookie SESSION', '7 cookie SESSION']);
  });

  test('an HTML hidden field (CSRF): captured from the field, sent back in a header, a cookie and a form field', () => {
    const r = w.find(CSRF);
    expect(r.kind).toBe('correlate');
    expect([r.src.n, r.src.where]).toEqual([1, 'HTML hidden field _csrf']);
    expect(r.later.map((u) => u.where)).toEqual(['header X-XSRF-TOKEN', 'cookie XSRF-TOKEN', 'form field _csrf']);
  });

  test('sent URL-encoded: matched to the original, and the encoding is named', () => {
    const r = w.find(CUR);
    expect(r.kind).toBe('correlate');
    expect([r.src.n, r.src.where]).toEqual([3, 'JSON $.next']);
    expect(r.later.map((u) => [u.n, u.where, u.enc])).toEqual([[4, 'query parameter cursor', 'URL-encoded']]);
    expect(r.forms).toContain(encodeURIComponent(CUR));
  });

  test('a redirect whose value is used again later: correlate it from the Location header', () => {
    const r = w.find('O-55102');
    expect(r.kind).toBe('correlate');
    expect([r.src.n, r.src.where]).toEqual([6, 'redirect (Location header)']);
    expect(r.later.map((u) => u.n)).toEqual([7, 8]);
  });

  test('typed by the user, made by the browser, cookies only, not found', () => {
    expect(w.find('Secret#2026').kind).toBe('input');
    expect(w.find(REQID).kind).toBe('generated');
    expect(w.find('1793350804123').kind).toBe('generated');
    expect(w.find('zzz-not-in-this-recording').kind).toBe('none');
    const cookieOnly = loadWorker();
    cookieOnly.load({ log: { entries: [
      entry('https://a.example.com/login', { method: 'POST', sh: { 'Set-Cookie': 'JSESSIONID=9f8e7d6c5b4a39281706; Path=/' } }),
      entry('https://a.example.com/home', { rh: { Cookie: 'JSESSIONID=9f8e7d6c5b4a39281706' } }),
    ] } });
    expect(cookieOnly.find('9f8e7d6c5b4a39281706').kind).toBe('cookie');
  });

  test('earlier responses without a body (browser cache): "its source is not in this recording", not "typed by the user"', () => {
    const r = loadWorker();
    r.load({ log: { entries: [
      entry('https://a.example.com/catalog', { rt: 'Document', mime: 'text/html', text: '' }),   // page kept without its body
      entry('https://a.example.com/account;jsessionid=0C2652FC68580E62B937790C8D1F3157', { rt: 'Document', mime: 'text/html', text: '<p>ok</p>' }),
    ] } });
    const v = r.find('0C2652FC68580E62B937790C8D1F3157');
    expect([v.kind, v.missing]).toEqual(['missing', 1]);
  });

  test('only sent to requests left out of the script, or only in the Referer: not counted, said apart', () => {
    const r = loadWorker();
    const h = { log: { entries: [
      entry('https://a.example.com/page', { rt: 'Document', mime: 'text/html', text: '<script>var cid="CAQSPgDnonV5Rb2dYJysK9";</script>' }),
      entry('https://ads.example.net/collect?cid=CAQSPgDnonV5Rb2dYJysK9', { rt: 'Ping' }),                      // left out (ads)
      entry('https://a.example.com/next?t=Zx81Kq2Lm9Pp4Rt7Yw', { rt: 'Document', mime: 'text/html', text: '<p>ok</p>' }),
      entry('https://a.example.com/logo.png', { rt: 'Image', rh: { Referer: 'https://a.example.com/next?t=Zx81Kq2Lm9Pp4Rt7Yw' } }),
    ] } };
    const s = r.load(h, [2, 4]);
    expect(s.suggestions.map((x) => x.value)).not.toContain('CAQSPgDnonV5Rb2dYJysK9');   // only an ad server sends it back
    const ad = r.find('CAQSPgDnonV5Rb2dYJysK9');
    expect([ad.kind, ad.outsideCount, ad.hitNs]).toEqual(['outonly', 1, [1]]);
    const t = r.find('Zx81Kq2Lm9Pp4Rt7Yw');
    expect([t.uses.map((u) => u.n), t.referer]).toEqual([[3], 1]);                       // the Referer copy is said apart, not a use
  });

  test('a redirect that is only followed: nothing to do', () => {
    const r = loadWorker();
    r.load({ log: { entries: [
      entry('https://a.example.com/go', { method: 'POST', status: 302, sh: { Location: '/next/R-77821' } }),
      entry('https://a.example.com/next/R-77821', { rt: 'Document' }),
    ] } });
    expect(r.find('R-77821').kind).toBe('redirect');
  });

  test('suggestions: values the server sends that a later request sends back — Studio\'s first, then the Explorer\'s own', () => {
    const s = w.load(shop());
    const values = s.suggestions.map((x) => x.value);
    expect(values).toEqual(expect.arrayContaining([SID, CSRF, CUR, JWT]));
    expect(values).not.toContain('Secret#2026');   // typed, not returned by the server
    const firstOwn = s.suggestions.findIndex((x) => x.by === 'explorer');
    expect(s.suggestions.slice(0, s.studioCount).every((x) => x.by === 'studio')).toBe(true);
    if (firstOwn >= 0) expect(firstOwn).toBe(s.studioCount);
  });
});

describe('HAR Explorer — agrees with Script Studio', () => {
  test('every value Script Studio correlates by itself is a "studio" suggestion, and Find names the same source request', () => {
    // Script Studio's own analysis of the same recording, run directly
    const studioSrc = ['VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js'].map(read).join('\n');
    // eslint-disable-next-line no-new-func
    const studio = new Function('har', studioSrc + '\nconst log = console.log; console.log = () => {};' +
      '\nS.entries1 = parseHar(har); S.entries2 = []; detectMarkers(S.entries1); applyFilters(S.entries1); pruneEmptyPagerefTransactions(S.entries1);' +
      '\nS.correlations = singleHarCorrelate(S.entries1); const v = valueBasedCorrelate(S.entries1, S.correlations, S.entries2); if (v && v.length) S.correlations = S.correlations.concat(v);' +
      '\nadvisorScan(S.entries1, S.correlations.filter((c) => !c._suppressed)); console.log = log; return S;');
    const har = shop();
    const S = studio(har);
    const fromStudio = [];
    S.correlations.filter((c) => !c._suppressed).forEach((c) => { const u = c.usages[0]; fromStudio.push({ value: u.tokenValue || String(u.originalValue).slice((u.prefix || '').length), n: c.sourceIdx + 1 }); });
    S.advisorCandidates.forEach((c) => fromStudio.push({ value: c.value, n: c.source.entryIdx + 1 }));
    expect(fromStudio.length).toBeGreaterThan(0);

    const w = loadWorker();
    const s = w.load(har);
    fromStudio.forEach((st) => {
      expect(s.suggestions.find((x) => x.value === st.value && x.by === 'studio')).toBeTruthy();
      const r = w.find(st.value);
      expect(r.studio).toBe(true);
      expect(r.src && r.src.n).toBe(st.n);
    });
  });
});
