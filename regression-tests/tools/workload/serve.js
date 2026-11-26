#!/usr/bin/env node
// Serves the Workload Modeller page from a folder (the present code, or an older one extracted with git archive), with
// the same addresses as the server: /converter/workload-modeller, wm/…, wm/engine/…, wm/config/…, ra/…, portal/….
//   git archive <commit> workload-modeller src/web/public lre-results-analyser/web | tar -x -C <folder>
//   node serve.js <folder> <port>          (no folder: the present code)
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.resolve(process.argv[2] || path.join(__dirname, '../../..')), PORT = +process.argv[3] || 3994;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
function file(p) {
  p = p.replace(/^\/converter/, '');
  if (p === '/workload-modeller') return 'workload-modeller/web/index.html';
  const m = /^\/(wm|ra|portal)\/(.*)$/.exec(p); if (!m) return null;
  if (m[1] === 'portal') return 'src/web/public/portal/' + m[2];
  if (m[1] === 'ra') return 'lre-results-analyser/web/' + m[2];
  if (/^(engine|config)\//.test(m[2])) return 'workload-modeller/' + m[2];
  return 'workload-modeller/web/' + m[2];
}
http.createServer((q, r) => {
  const rel = file(decodeURIComponent(q.url.split('?')[0])), f = rel && path.join(ROOT, rel);
  if (!f || !f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': (TYPES[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8', 'cache-control': 'no-cache' }); fs.createReadStream(f).pipe(r);
}).listen(PORT, '127.0.0.1', () => console.log('Workload Modeller from ' + ROOT + ' on ' + PORT));
