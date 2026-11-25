// Serves an older src/web/public (extracted with git archive) so behave.js can compare it with the present one.
//   node serve-old.js <folder that holds src/web/public> <port>
'use strict';
const http = require('http'), fs = require('fs'), path = require('path');
const ROOT = path.join(path.resolve(process.argv[2]), 'src/web/public'), PORT = +process.argv[3] || 3998;
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.ts': 'text/plain' };
http.createServer((q, r) => {
  let p = decodeURIComponent(q.url.split('?')[0]).replace(/^\/converter/, '');
  if (p === '/studio') p = '/Studio.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { r.writeHead(404); r.end(); return; }
  r.writeHead(200, { 'content-type': (TYPES[path.extname(f)] || 'application/octet-stream') + '; charset=utf-8' }); fs.createReadStream(f).pipe(r);
}).listen(PORT, '127.0.0.1', () => console.log('old page on ' + PORT));
