#!/usr/bin/env node
// Generates the synthetic Studio fixtures (no real company data — every host is
// an example-* name, every value is derived from a seed with sha256).
//   node make-fixtures.js [fixturesDir]
// For each generated flow it writes <name>.har (seed 1) and <name>.r2.har
// (seed 2: same user inputs, different tokens / session ids / CSRF / UUIDs /
// timestamps) so the 2-HAR diff mode has something to find.
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const OUT = process.argv[2] || path.join(__dirname, 'fixtures');
fs.mkdirSync(OUT, { recursive: true });

// ---- deterministic value helpers -------------------------------------------
const H = (seed, label, n = 64) => crypto.createHash('sha256').update(seed + ':' + label).digest('hex').repeat(4).slice(0, n);
const uuid = (seed, label) => { const h = H(seed, label, 32); return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const b64u = s => Buffer.from(s).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const b64uHex = (seed, label, n) => Buffer.from(H(seed, label, 128), 'hex').toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_').slice(0, n);
const jwt = (seed, label, claims) => b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'k-' + H(seed, label + 'kid', 8) })) + '.' +
  b64u(JSON.stringify(Object.assign({ jti: uuid(seed, label + 'jti') }, claims))) + '.' + b64uHex(seed, label + 'sig', 86);
const num = (seed, label, mod) => parseInt(H(seed, label, 8), 16) % mod;

function makeHar(seed, pages) {
  const baseMs = Date.UTC(2026, 9, 23, 10, 0, 0) + (seed - 1) * 86400000 + (seed - 1) * 3600000; // r2 one day + 1 h later
  let t = 0;
  const entries = [];
  function add(o) {
    t += o.gap || 200;
    const reqHeaders = [{ name: 'User-Agent', value: 'Mozilla/5.0 (Synthetic Studio Fixture)' }, { name: 'Accept-Language', value: 'en-GB,en;q=0.9' }].concat(o.reqHeaders || []);
    const respHeaders = [{ name: 'Content-Type', value: o.mime || 'application/json' }].concat(o.respHeaders || []);
    const qs = (o.url.split('?')[1] || '').split('&').filter(Boolean).map(p => { const i = p.indexOf('='); return { name: p.slice(0, i), value: decodeURIComponent(p.slice(i + 1)) }; });
    const e = {
      startedDateTime: new Date(baseMs + t).toISOString(), time: o.time || 80,
      request: { method: o.method || 'GET', url: o.url, httpVersion: 'HTTP/1.1', headers: reqHeaders, queryString: qs, cookies: [], headersSize: -1, bodySize: o.post ? o.post.text.length : 0 },
      response: { status: o.status || 200, statusText: '', httpVersion: 'HTTP/1.1', headers: respHeaders, cookies: o.respCookies || [],
        content: { size: (o.body || '').length, mimeType: o.mime || 'application/json', text: o.body || '' }, redirectURL: o.redirect || '', headersSize: -1, bodySize: (o.body || '').length },
      cache: {}, timings: { send: 1, wait: (o.time || 80) - 2, receive: 1 }
    };
    if (o.post) e.request.postData = o.post;
    if (o.rt) e._resourceType = o.rt;
    if (o.pageref) e.pageref = o.pageref;
    if (o.perfx) Object.assign(e, o.perfx);
    entries.push(e);
    return e;
  }
  const marker = (kind, name) => add({ url: `https://${kind}-${name}.invalid/`, status: 0, mime: 'text/plain', rt: 'image', gap: 5 });
  const har = () => ({ log: { version: '1.2', creator: { name: 'studio synthetic', version: '1' }, pages: (pages || []).map(p => ({ startedDateTime: new Date(baseMs).toISOString(), id: p.id, title: p.title, pageTimings: { onContentLoad: -1, onLoad: 500 } })), entries } });
  return { add, marker, har, baseMs, now: () => baseMs + t };
}
const form = (obj) => ({ mimeType: 'application/x-www-form-urlencoded', text: Object.entries(obj).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&'), params: Object.entries(obj).map(([name, value]) => ({ name, value: encodeURIComponent(value) })) });
const json = (obj) => ({ mimeType: 'application/json', text: JSON.stringify(obj) });

// ---- 1. JSON API with tokens flowing response -> request (bookmarklet markers)
function apiTokens(seed) {
  const h = makeHar(seed);
  const API = 'https://api.example-retail.com';
  const at1 = jwt(seed, 'at1', { sub: 'user-4711', iat: Math.floor(h.baseMs / 1000), exp: Math.floor(h.baseMs / 1000) + 3600, scope: 'orders:read orders:write' });
  const rt = H(seed, 'refresh', 64), sid = uuid(seed, 'session'), xsrf = H(seed, 'xsrf', 40), cookie = H(seed, 'cookie', 32);
  const orders = [0, 1, 2].map(i => ({ orderId: 'ORD-' + (100000 + num(seed, 'ord' + i, 899999)), lineId: uuid(seed, 'line' + i), status: 'OPEN' }));
  const cursor = b64uHex(seed, 'cursor', 32);
  h.add({ url: 'https://shop.example-retail.com/', mime: 'text/html', rt: 'document', body: '<!doctype html><html><head><title>Shop</title></head><body><div id="app"></div></body></html>' });
  h.marker('START', 'T01_Login');
  h.add({ method: 'POST', url: API + '/v1/auth/login', rt: 'fetch', reqHeaders: [{ name: 'Content-Type', value: 'application/json' }],
    post: json({ username: 'test.user01', password: 'Secr3t!pass', rememberMe: true, deviceName: 'perf-lab-01' }),
    respHeaders: [{ name: 'X-XSRF-TOKEN', value: xsrf }, { name: 'Set-Cookie', value: 'SESSIONID=' + cookie + '; Path=/; HttpOnly' }],
    respCookies: [{ name: 'SESSIONID', value: cookie }],
    body: JSON.stringify({ access_token: at1, refresh_token: rt, token_type: 'Bearer', expires_in: 3600, session: { sessionId: sid, userId: 'user-4711' } }) });
  h.marker('END', 'T01_Login');
  h.marker('START', 'T02_Orders');
  const auth = tok => [{ name: 'Authorization', value: 'Bearer ' + tok }, { name: 'X-Session-Id', value: sid }, { name: 'Cookie', value: 'SESSIONID=' + cookie }];
  h.add({ url: API + '/v1/orders?userId=user-4711&_ts=' + h.now(), rt: 'fetch', reqHeaders: auth(at1), body: JSON.stringify({ orders, nextCursor: cursor, generatedAt: new Date(h.now()).toISOString() }) });
  h.add({ url: API + '/v1/orders/' + orders[1].orderId, rt: 'fetch', reqHeaders: auth(at1), body: JSON.stringify({ orderId: orders[1].orderId, lineId: orders[1].lineId, total: 42.5, currency: 'GBP' }) });
  h.add({ method: 'POST', url: API + '/v1/orders/' + orders[1].orderId + '/items', rt: 'fetch', reqHeaders: auth(at1).concat([{ name: 'Content-Type', value: 'application/json' }, { name: 'X-XSRF-TOKEN', value: xsrf }]),
    post: json({ sessionId: sid, orderId: orders[1].orderId, lineId: orders[1].lineId, quantity: 2, searchTerm: 'blue running shoes', requestedAt: new Date(h.now()).toISOString() }),
    body: JSON.stringify({ itemId: uuid(seed, 'item'), ok: true }) });
  h.add({ url: API + '/v1/orders?cursor=' + cursor, rt: 'fetch', reqHeaders: auth(at1), body: JSON.stringify({ orders: [], nextCursor: null }) });
  const at2 = jwt(seed, 'at2', { sub: 'user-4711', iat: Math.floor(h.now() / 1000) });
  h.add({ method: 'POST', url: API + '/v1/auth/refresh', rt: 'fetch', reqHeaders: [{ name: 'Content-Type', value: 'application/json' }], post: json({ refresh_token: rt, grant_type: 'refresh_token' }),
    body: JSON.stringify({ access_token: at2, token_type: 'Bearer', expires_in: 3600 }) });
  h.add({ url: API + '/v1/me', rt: 'fetch', reqHeaders: auth(at2).concat([{ name: 'X-XSRF-TOKEN', value: xsrf }]), body: JSON.stringify({ userId: 'user-4711', displayName: 'Test User' }) });
  h.marker('END', 'T02_Orders');
  return h.har();
}

// ---- 2. HTML form / CSRF flow -----------------------------------------------
function formCsrf(seed) {
  const h = makeHar(seed);
  const P = 'https://portal.example-insure.com';
  const rvt = b64uHex(seed, 'rvt', 92), vs = Buffer.from('viewstate:' + H(seed, 'vs', 48)).toString('base64'), vsg = H(seed, 'vsg', 8).toUpperCase();
  const aspSess = H(seed, 'asp', 24), sidQ = H(seed, 'sidq', 20), meta = b64uHex(seed, 'meta', 44), csrf2 = H(seed, 'csrf2', 40);
  const claim = 'CLM-' + (2000000 + num(seed, 'claim', 999999));
  h.add({ url: P + '/login', mime: 'text/html', rt: 'document', respHeaders: [{ name: 'Set-Cookie', value: 'ASP.NET_SessionId=' + aspSess + '; path=/; HttpOnly' }],
    body: `<!doctype html><html><head><title>Login</title><link rel="stylesheet" href="/css/site.css"></head><body><form method="post" action="/login">` +
      `<input type="hidden" name="__VIEWSTATE" id="__VIEWSTATE" value="${vs}" /><input type="hidden" name="__VIEWSTATEGENERATOR" value="${vsg}" />` +
      `<input name="__RequestVerificationToken" type="hidden" value="${rvt}" /><input name="username" /><input name="password" type="password" /></form></body></html>` });
  h.add({ url: P + '/css/site.css', mime: 'text/css', rt: 'stylesheet', body: 'body{margin:0}' });
  h.add({ url: P + '/js/app.js?v=3', mime: 'application/javascript', rt: 'script', body: 'console.log(1)' });
  h.add({ url: P + '/img/logo.png', mime: 'image/png', rt: 'image', body: '' });
  h.add({ method: 'POST', url: P + '/login', status: 302, mime: 'text/html', rt: 'document', redirect: P + '/dashboard?sid=' + sidQ,
    reqHeaders: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }, { name: 'Cookie', value: 'ASP.NET_SessionId=' + aspSess }],
    post: form({ __VIEWSTATE: vs, __VIEWSTATEGENERATOR: vsg, __RequestVerificationToken: rvt, username: 'jane.doe@example-insure.com', password: 'Pa55word!', remember: 'on' }),
    respHeaders: [{ name: 'Location', value: P + '/dashboard?sid=' + sidQ }], body: '' });
  h.add({ url: P + '/dashboard?sid=' + sidQ, mime: 'text/html', rt: 'document', reqHeaders: [{ name: 'Cookie', value: 'ASP.NET_SessionId=' + aspSess }],
    body: `<html><head><meta name="csrf-token" content="${meta}"></head><body><a href="/claims/view?claimId=${claim}">Claim ${claim}</a>` +
      `<form action="/logout" method="post"><input type="hidden" name="csrf_token" value="${csrf2}"></form></body></html>` });
  h.add({ method: 'POST', url: P + '/api/claims/notes', rt: 'fetch', reqHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-CSRF-Token', value: meta }, { name: 'Cookie', value: 'ASP.NET_SessionId=' + aspSess }],
    post: json({ claimId: claim, note: 'Windscreen damage, photos attached', policyNumber: 'POL-778812' }), body: JSON.stringify({ noteId: uuid(seed, 'note'), created: new Date(h.now()).toISOString() }) });
  h.add({ url: P + '/claims/view?claimId=' + claim, mime: 'text/html', rt: 'document', reqHeaders: [{ name: 'Cookie', value: 'ASP.NET_SessionId=' + aspSess }], body: '<html><body>Claim</body></html>' });
  h.add({ method: 'POST', url: P + '/logout', status: 302, mime: 'text/html', rt: 'document', redirect: P + '/login', reqHeaders: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }, { name: 'Cookie', value: 'ASP.NET_SessionId=' + aspSess }],
    post: form({ csrf_token: csrf2 }), respHeaders: [{ name: 'Location', value: P + '/login' }], body: '' });
  return h.har();
}

// ---- 3. Rich CDP-recorder style HAR: pages[], pageref, periodic + once traffic,
//         static resources on several domains, analytics noise, JSON tokens,
//         a SelectAll array and an array-reconstruction body.
function richShop(seed) {
  const pages = [{ id: 'tx_1', title: 'T01_Home' }, { id: 'tx_2', title: 'T02_Login' }, { id: 'tx_3', title: 'T03_Catalogue' }, { id: 'tx_4', title: 'T04_Checkout' }];
  const h = makeHar(seed, pages);
  const W = 'https://www.example-outdoor.com', A = 'https://api.example-outdoor.com', C = 'https://cdn.example-outdoor.com';
  const csrf = H(seed, 'csrf', 48), at = jwt(seed, 'at', { sub: 'cust-9001', iat: Math.floor(h.baseMs / 1000) }), cart = uuid(seed, 'cart'), corr = uuid(seed, 'corrid');
  const items = [0, 1, 2, 3].map(i => ({ sku: 'SKU-' + (5000 + i), price: 10 + i * 5, warehouseId: 'WH-' + H(seed, 'wh' + i, 6).toUpperCase(), offerToken: H(seed, 'offer' + i, 24), imageKey: uuid(seed, 'img' + i) }));
  const hb = (pr, i) => h.add({ url: A + '/v2/heartbeat?t=' + (h.now() + 1), rt: 'fetch', pageref: pr, body: '{"ok":true}', perfx: { _perfx_class: 'periodic', _perfx_interval: 15000, _perfx_occurrences: 4, _normalizedUrl: A + '/v2/heartbeat' } });
  const poll = (pr) => h.add({ url: A + '/v2/notifications/poll', rt: 'fetch', pageref: pr, body: '{"items":[]}', perfx: { _perfx_class: 'periodic', _perfx_interval: 30000, _perfx_occurrences: 2, _normalizedUrl: A + '/v2/notifications/poll' } });
  // T01 home
  h.add({ url: W + '/', mime: 'text/html', rt: 'document', pageref: 'tx_1', body: `<html><head><meta name="csrf-token" content="${csrf}"><link rel="stylesheet" href="${C}/css/main.css"><script src="${C}/js/app.js"></script></head><body><img src="${C}/img/hero.jpg"></body></html>` });
  h.add({ url: C + '/css/main.css', mime: 'text/css', rt: 'stylesheet', pageref: 'tx_1', body: 'h1{}' });
  h.add({ url: C + '/js/app.js', mime: 'application/javascript', rt: 'script', pageref: 'tx_1', body: 'void 0' });
  h.add({ url: C + '/img/hero.jpg', mime: 'image/jpeg', rt: 'image', pageref: 'tx_1' });
  h.add({ url: C + '/fonts/outdoor.woff2', mime: 'font/woff2', rt: 'font', pageref: 'tx_1' });
  h.add({ url: 'https://www.google-analytics.com/g/collect?v=2&tid=G-SYNTH&cid=' + H(seed, 'cid', 10), mime: 'image/gif', rt: 'image', pageref: 'tx_1' });
  h.add({ url: A + '/v2/config', rt: 'fetch', pageref: 'tx_1', body: JSON.stringify({ region: 'eu-west', features: ['a', 'b'] }), perfx: { _perfx_class: 'once', _normalizedUrl: A + '/v2/config' } });
  hb('tx_1'); poll('tx_1');
  // T02 login
  h.add({ method: 'POST', url: A + '/v2/session', rt: 'fetch', pageref: 'tx_2', reqHeaders: [{ name: 'Content-Type', value: 'application/json' }, { name: 'X-CSRF-Token', value: csrf }, { name: 'X-Correlation-Id', value: corr }],
    post: json({ email: 'hiker.one@example-outdoor.com', password: 'Tr41l-Mix!', csrf: csrf }), body: JSON.stringify({ token: at, customer: { id: 'cust-9001', tier: 'gold' }, cartId: cart }) });
  hb('tx_2');
  // T03 catalogue
  const bearer = [{ name: 'Authorization', value: 'Bearer ' + at }];
  h.add({ url: A + '/v2/products?category=tents&page=1', rt: 'fetch', pageref: 'tx_3', reqHeaders: bearer, body: JSON.stringify({ items, total: items.length }) });
  h.add({ url: A + '/v2/products/' + items[2].sku + '/availability?warehouse=' + items[2].warehouseId, rt: 'fetch', pageref: 'tx_3', reqHeaders: bearer, body: JSON.stringify({ inStock: true }) });
  // two siblings of items[*].imageKey used later -> SelectAll candidate
  h.add({ method: 'POST', url: A + '/v2/wishlist', rt: 'fetch', pageref: 'tx_3', reqHeaders: bearer.concat([{ name: 'Content-Type', value: 'application/json' }]), post: json({ primaryImage: items[0].imageKey, altImage: items[3].imageKey, note: 'tent shortlist' }), body: JSON.stringify({ saved: true }) });
  h.add({ url: C + '/img/products/' + items[2].sku + '.webp', mime: 'image/webp', rt: 'image', pageref: 'tx_3' });
  hb('tx_3'); poll('tx_3');
  // T04 checkout — array reconstruction: lines[] built from items[]
  h.add({ method: 'POST', url: A + '/v2/carts/' + cart + '/lines', rt: 'fetch', pageref: 'tx_4', reqHeaders: bearer.concat([{ name: 'Content-Type', value: 'application/json' }]),
    post: json({ lines: items.map(it => ({ sku: it.sku, warehouseId: it.warehouseId, offerToken: it.offerToken, qty: 1 })), currency: 'EUR' }), body: JSON.stringify({ cartId: cart, lineCount: 4, checkoutRef: 'CHK-' + H(seed, 'chk', 12) }) });
  h.add({ method: 'POST', url: A + '/v2/checkout', rt: 'fetch', pageref: 'tx_4', reqHeaders: bearer.concat([{ name: 'Content-Type', value: 'application/json' }, { name: 'X-CSRF-Token', value: csrf }]),
    post: json({ cartId: cart, checkoutRef: 'CHK-' + H(seed, 'chk', 12), deliveryDate: '2026-10-30', promo: 'AUTUMN10' }), body: JSON.stringify({ orderNumber: 'ON-' + num(seed, 'on', 99999999), status: 'PLACED' }) });
  hb('tx_4');
  h.add({ url: 'wss://push.example-outdoor.com/socket', status: 101, rt: 'websocket', pageref: 'tx_4' });
  return h.har();
}

// ---- 4. OAuth2 PKCE + SSO redirect chain on a corporate (non-public) TLD -----
function oauthPkce(seed) {
  const h = makeHar(seed);
  const APP = 'https://app.example-retail.com', SSO = 'https://sso.example-group.corp';
  const challenge = b64uHex(seed, 'chal', 43), verifier = b64uHex(seed, 'ver', 64), state = H(seed, 'state', 32), nonce = H(seed, 'nonce', 16), code = b64uHex(seed, 'code', 40);
  const idt = jwt(seed, 'idt', { sub: 'emp-1001', aud: 'perf-app', nonce }), at = jwt(seed, 'at', { sub: 'emp-1001', scp: 'api' });
  const authUrl = SSO + '/as/authorization.oauth2?response_type=code&client_id=perf-app&redirect_uri=' + encodeURIComponent(APP + '/callback') + '&scope=openid%20profile&state=' + state + '&nonce=' + nonce + '&code_challenge=' + challenge + '&code_challenge_method=S256';
  h.add({ url: APP + '/', status: 302, mime: 'text/html', rt: 'document', respHeaders: [{ name: 'Location', value: authUrl }], redirect: authUrl });
  h.add({ url: authUrl, status: 302, mime: 'text/html', rt: 'document', respHeaders: [{ name: 'Location', value: APP + '/callback?code=' + code + '&state=' + state }], redirect: APP + '/callback?code=' + code + '&state=' + state });
  h.add({ url: APP + '/callback?code=' + code + '&state=' + state, mime: 'text/html', rt: 'document', body: '<html><body>Signing in…</body></html>' });
  h.add({ method: 'POST', url: SSO + '/as/token.oauth2', rt: 'fetch', reqHeaders: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }],
    post: form({ grant_type: 'authorization_code', code, redirect_uri: APP + '/callback', client_id: 'perf-app', code_verifier: verifier }),
    body: JSON.stringify({ access_token: at, id_token: idt, token_type: 'Bearer', expires_in: 1200 }) });
  h.add({ url: APP + '/api/profile', rt: 'fetch', reqHeaders: [{ name: 'Authorization', value: 'Bearer ' + at }], body: JSON.stringify({ name: 'Employee One', employeeId: 'emp-1001' }) });
  h.add({ url: APP + '/api/tasks?assignee=emp-1001&from=2026-10-01', rt: 'fetch', reqHeaders: [{ name: 'Authorization', value: 'Bearer ' + at }], body: JSON.stringify({ tasks: [{ taskId: uuid(seed, 't1') }] }) });
  return h.har();
}

// ---- 5. DPoP-bound JWT access token ----------------------------------------
function dpopJwt(seed) {
  const h = makeHar(seed);
  const A = 'https://api.example-shop.test';
  const proof = (htm, htu) => b64u(JSON.stringify({ typ: 'dpop+jwt', alg: 'ES256', jwk: { kty: 'EC', crv: 'P-256', x: b64uHex(seed, 'x', 43), y: b64uHex(seed, 'y', 43) } })) + '.' + b64u(JSON.stringify({ htm, htu, iat: Math.floor(h.now() / 1000), jti: uuid(seed, htm + htu) })) + '.' + b64uHex(seed, 'psig' + htu, 86);
  const at = jwt(seed, 'at', { sub: 'acct-77', cnf: { jkt: H(seed, 'jkt', 43) } });
  h.add({ method: 'POST', url: A + '/oauth/token', rt: 'fetch', reqHeaders: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }, { name: 'DPoP', value: proof('POST', A + '/oauth/token') }],
    post: form({ grant_type: 'client_credentials', client_id: 'perf-client', scope: 'accounts' }), body: JSON.stringify({ access_token: at, token_type: 'DPoP', expires_in: 300 }) });
  h.add({ url: A + '/v1/accounts', rt: 'fetch', reqHeaders: [{ name: 'Authorization', value: 'Bearer ' + at }, { name: 'DPoP', value: proof('GET', A + '/v1/accounts') }], body: JSON.stringify({ accounts: [{ accountId: 'AC-' + H(seed, 'ac', 10) }] }) });
  h.add({ url: A + '/v1/accounts/AC-' + H(seed, 'ac', 10) + '/balance', rt: 'fetch', reqHeaders: [{ name: 'Authorization', value: 'Bearer ' + at }, { name: 'DPoP', value: proof('GET', A + '/v1/balance') }], body: JSON.stringify({ balance: 100 }) });
  return h.har();
}

// ---- 6. Big HAR: ~3000 entries (500 iterations x 6 requests) ---------------
function big(seed) {
  const h = makeHar(seed);
  const A = 'https://api.example-logistics.com';
  const tok = jwt(seed, 'big', { sub: 'svc-1' });
  h.add({ method: 'POST', url: A + '/auth', rt: 'fetch', post: json({ user: 'loadtest', pass: 'x9-Load!' }), body: JSON.stringify({ token: tok }) });
  for (let i = 0; i < 500; i++) {
    const sh = 'SHP-' + H(seed, 'shp' + i, 10), trk = uuid(seed, 'trk' + i);
    const au = [{ name: 'Authorization', value: 'Bearer ' + tok }];
    h.add({ url: A + '/v1/shipments?page=' + i, rt: 'fetch', reqHeaders: au, body: JSON.stringify({ shipments: [{ shipmentId: sh, trackingId: trk }] }), gap: 30 });
    h.add({ url: A + '/v1/shipments/' + sh, rt: 'fetch', reqHeaders: au, body: JSON.stringify({ shipmentId: sh, etag: H(seed, 'etag' + i, 16) }), gap: 30 });
    h.add({ method: 'POST', url: A + '/v1/tracking', rt: 'fetch', reqHeaders: au.concat([{ name: 'Content-Type', value: 'application/json' }]), post: json({ trackingId: trk, shipmentId: sh, scan: 'DEPOT-' + (i % 7) }), body: '{"ok":true}', gap: 30 });
    h.add({ url: 'https://cdn.example-logistics.com/icons/' + (i % 20) + '.png', mime: 'image/png', rt: 'image', gap: 10 });
    h.add({ url: 'https://cdn.example-logistics.com/app.' + (i % 3) + '.js', mime: 'application/javascript', rt: 'script', gap: 10 });
    h.add({ method: 'OPTIONS', url: A + '/v1/tracking', status: 204, rt: 'preflight', gap: 5 });
  }
  return h.har();
}

const FLOWS = { 'api-tokens': apiTokens, 'form-csrf': formCsrf, 'rich-shop': richShop, 'oauth-pkce-sso': oauthPkce, 'dpop-jwt': dpopJwt, 'big-3000': big };
for (const [name, fn] of Object.entries(FLOWS)) {
  fs.writeFileSync(path.join(OUT, name + '.har'), JSON.stringify(fn(1), null, 1));
  fs.writeFileSync(path.join(OUT, name + '.r2.har'), JSON.stringify(fn(2), null, 1));
  console.log(name, fn(1).log.entries.length, 'entries');
}
