#!/usr/bin/env node
// Serves the Results Analyser page from a folder (the present code, or an older one extracted with git archive), with
// the same addresses as the server: /converter/results-analyser, ra/…, ra/engine/…, ra/report/…, portal/….
//   git archive <commit> lre-results-analyser src/web/public | tar -x -C <folder>
//   node serve.js <folder> <port>          (no folder, or "": the present code)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '../../..')), PORT = +process.argv[3] || 3991;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.wasm': 'application/wasm' };
function file(p) {
  p = p.replace(/^\/converter/, '');
  if (p === '/results-analyser') return 'lre-results-analyser/web/index.html';
  const m = /^\/(ra|portal)\/(.*)$/.exec(p); if (!m) return null;
  if (m[1] === 'portal') return 'src/web/public/portal/' + m[2];
  if (/^(engine|report)\//.test(m[2])) return 'lre-results-analyser/' + m[2];
  return 'lre-results-analyser/web/' + m[2];
}
http.createServer((q, r) => {
  if (q.method === 'POST') { r.writeHead(204); r.end(); return; }   // the usage ping
  const rel = file(decodeURIComponent(q.url.split('?')[0])), f = rel && path.join(ROOT, rel);
  if (!f || !f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': (TYPES[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(r);
}).listen(PORT, '127.0.0.1', () => console.log('Results Analyser from ' + ROOT + ' on ' + PORT));
