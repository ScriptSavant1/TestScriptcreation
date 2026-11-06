// Replay a generated DevWeb script with the real DevWeb engine through the local test proxy.
//   node rundevweb.js <scriptDir> <outDir> [--har=<file>] [--iters=2] [--args={json}]
'use strict';
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
const args = process.argv.slice(2);
const [SRC, OUT] = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const i = a.indexOf('='); return [a.slice(2, i < 0 ? undefined : i), i < 0 ? '' : a.slice(i + 1)]; }));
const ITERS = +(opt.iters || 2), PORT = +(opt.port || 19000 + Math.floor(Math.random() * 900));
const DEVWEB = 'C:\\Program Files (x86)\\OpenText\\Virtual User Generator\\bin\\DevWeb\\DevWeb.exe';

fs.rmSync(OUT, { recursive: true, force: true });
const W = path.join(OUT, 'script');
fs.mkdirSync(W, { recursive: true });
for (const f of fs.readdirSync(SRC)) if (fs.statSync(path.join(SRC, f)).isFile()) fs.copyFileSync(path.join(SRC, f), path.join(W, f));
const rtsP = path.join(W, 'rts.yml');
let rts = fs.readFileSync(rtsP, 'utf8');
rts = rts.replace(/useProxy: false/, 'useProxy: true').replace(/proxyServer: (""|'')/, 'proxyServer: "127.0.0.1:' + PORT + '"')
  .replace(/thinkTime:\s*\n\s*type: ["']asRecorded["']/, 'thinkTime:\n  type: "ignore"')
  .replace(/ignoreBadCertificate: false/g, 'ignoreBadCertificate: true');   // the test proxy's own certificate
if (!/useProxy: true/.test(rts) || !new RegExp('proxyServer: "127\\.0\\.0\\.1:' + PORT).test(rts)) { console.log(JSON.stringify({ out: OUT, error: 'could not point rts.yml at the test proxy' })); process.exit(2); }
fs.writeFileSync(rtsP, rts);

const wire = path.join(OUT, 'wire.jsonl');
const mock = spawn(process.execPath, [path.join(__dirname, 'mockproxy.js'), String(PORT), wire].concat(opt.har ? opt.har.split(',') : []), { stdio: ['ignore', 'pipe', 'inherit'] });
mock.stdout.once('data', () => {
  let code = 0, log = '';
  const a = ['-mode=single', '-iterations=' + ITERS].concat(opt.args ? ['-userArgs=' + opt.args] : []).concat([W]);
  try { log = execFileSync(DEVWEB, a, { encoding: 'utf8', timeout: 600000, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { code = e.status || -1; log = (e.stdout || '') + (e.stderr || ''); }
  setTimeout(() => {
    mock.kill();
    fs.writeFileSync(path.join(OUT, 'output.txt'), log);
    const reqs = fs.existsSync(wire) ? fs.readFileSync(wire, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const errors = log.split('\n').filter((l) => /\b(error|exception|failed)\b/i.test(l) && !/Error: 0|errors: 0|Total Failed=0/i.test(l)).slice(0, 20);
    const dpop = reqs.filter((r) => r.dpop).map((r) => ({ seq: r.seq, url: r.url, ...r.dpop }));
    const summary = { exit: code, requests: reqs.length, errors, dpopBad: dpop.filter((d) => d.error || !d.sig || !d.htm || !d.htu || !d.athOk) };
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ out: OUT, exit: code, requests: reqs.length, errors: errors.length, dpopBad: summary.dpopBad.length }));
  }, 300);
});
