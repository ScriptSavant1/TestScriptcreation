// Local test proxy for replaying generated scripts with the real LoadRunner engines (VuGen mdrv.exe / DevWeb).
// Every request — http, or https through CONNECT (TLS ended here with a self-signed certificate) — reaches this
// process, so nothing goes to the real websites. Answers with the recorded HAR response for the same method + host +
// path (in recorded order), else a small default. Logs each request as one JSON line and checks DPoP proofs.
//   node mockproxy.js <port> <logFile> [har ...]
'use strict';
const http = require('http'), https = require('https'), fs = require('fs'), crypto = require('crypto'), path = require('path');
const [PORT, LOG, ...HARS] = process.argv.slice(2);
const log = fs.createWriteStream(LOG, { flags: 'w' });
let seq = 0;

// recorded responses: key -> queue
const byFull = new Map(), byPath = new Map();
for (const f of HARS) {
  const har = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const e of (har.log && har.log.entries) || []) {
    const m = /^(https?):\/\/([^/?#]+)([^#]*)/i.exec((e.request || {}).url || '');
    if (!m) continue;
    const r = e.response || {}, c = r.content || {};
    let body = c.text || '';
    let buf = c.encoding === 'base64' ? Buffer.from(body, 'base64') : Buffer.from(body, 'utf8');
    const item = { status: r.status || 200, headers: r.headers || [], mime: c.mimeType || '', body: buf };
    const method = (e.request.method || 'GET').toUpperCase();
    const host = m[2].toLowerCase().replace(/:(443|80)$/, ''), p = m[3] || '/';
    for (const [map, k] of [[byFull, method + ' ' + host + p], [byPath, method + ' ' + p]]) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(item);
    }
  }
}
const used = new Map();
function pick(map, k) {
  const q = map.get(k); if (!q) return null;
  const n = used.get(k) || 0; used.set(k, n + 1);
  return q[Math.min(n, q.length - 1)];
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
function checkDpop(proof, method, url, authz) {
  try {
    const [h, p, s] = proof.split('.');
    const hdr = JSON.parse(Buffer.from(h, 'base64url')), pl = JSON.parse(Buffer.from(p, 'base64url'));
    const key = crypto.createPublicKey({ key: hdr.jwk, format: 'jwk' });
    const okSig = crypto.verify('sha256', Buffer.from(h + '.' + p), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'));
    const htu = url.split('?')[0];
    const tok = (/^(?:DPoP|Bearer)\s+(.+)$/i.exec(authz || '') || [])[1];
    const athWant = tok ? b64u(crypto.createHash('sha256').update(tok).digest()) : null;
    return { sig: okSig, htm: pl.htm === method, htu: pl.htu === htu, gotHtu: pl.htu, ath: pl.ath || null, athOk: athWant ? pl.ath === athWant : !pl.ath, jkt: b64u(crypto.createHash('sha256').update(JSON.stringify({ crv: hdr.jwk.crv, kty: hdr.jwk.kty, x: hdr.jwk.x, y: hdr.jwk.y })).digest()) };
  } catch (e) { return { error: e.message }; }
}

function handle(scheme) {
  return (req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let host = (req.headers.host || '').toLowerCase().replace(/:(443|80)$/, ''), p = req.url;
      const abs = /^https?:\/\/([^/]+)(.*)$/i.exec(req.url);
      if (abs) { host = abs[1].toLowerCase().replace(/:(443|80)$/, ''); p = abs[2] || '/'; }
      const body = Buffer.concat(chunks).toString('utf8');
      const url = scheme + '://' + host + p;
      const rec = { seq: ++seq, method: req.method, url, headers: req.rawHeaders.reduce((a, v, i, arr) => (i % 2 ? a : a.concat([[v, arr[i + 1]]])), []), body };
      const dp = req.headers.dpop;
      if (dp) rec.dpop = checkDpop(dp, req.method, url, req.headers.authorization);
      log.write(JSON.stringify(rec) + '\n');
      let hit = pick(byFull, req.method + ' ' + host + p) || pick(byPath, req.method + ' ' + p);
      if (!hit && process.env.RAW_HDRS) {   // the same request with its query in another order (DevWeb sorts a followed Location)
        const norm = (s) => { const [a, q] = s.split('?'); const u = new URLSearchParams(q || ''); u.sort(); return a + '?' + u; };
        const want = req.method + ' ' + host + norm(p);
        for (const k of byFull.keys()) if (k.split(' ')[0] + ' ' + norm(k.slice(k.indexOf(' ') + 1)) === want) { hit = pick(byFull, k); break; }
      }
      if (hit) {
        const out = {};
        for (const h of hit.headers) {
          const n = h.name.toLowerCase();
          if (/^(content-length|content-encoding|transfer-encoding|connection|keep-alive|:)/.test(n)) continue;
          if (n === 'set-cookie') { (out[n] = out[n] || []).push(h.value); continue; }
          out[n] = h.value;
        }
        if (!out['content-type'] && hit.mime) out['content-type'] = hit.mime;
        // 401 challenges would make the engine retry sign-in forever against a proxy that cannot answer them
        const st = hit.status === 401 || hit.status < 100 ? 200 : hit.status;
        // RAW_HDRS=1: headers exactly as recorded (case, repeats) — default stays as the old comparisons ran
        if (process.env.RAW_HDRS) res.writeHead(st, hit.headers.flatMap((h) => [h.name, h.value]));
        else res.writeHead(st, out);
        res.end(hit.body);
      } else {
        const json = /json/i.test(req.headers.accept || '') || /json/i.test(req.headers['content-type'] || '');
        res.writeHead(200, { 'content-type': json ? 'application/json' : 'text/html' });
        res.end(json ? '{"mock":true}' : '<html><body>mock</body></html>');
      }
    });
  };
}

const tlsServer = https.createServer({ key: fs.readFileSync(path.join(__dirname, 'mock.key')), cert: fs.readFileSync(path.join(__dirname, 'mock.crt')) }, handle('https'));
const server = http.createServer(handle('http'));
server.on('connect', (req, socket) => {
  socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
  tlsServer.emit('connection', socket);
});
server.listen(+PORT, '127.0.0.1', () => console.log('mock proxy on ' + PORT));
