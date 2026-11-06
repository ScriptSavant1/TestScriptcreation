// Replay a generated VuGen Web HTTP/HTML script with the real engine (mdrv.exe) through the local test proxy.
//   node runvugen.js <scriptDir> <outDir> [--har=<file>] [--iters=2] [--port=18xxx]
// Writes <outDir>/wire.jsonl (every request), <outDir>/output.txt (engine log), <outDir>/summary.json
'use strict';
const fs = require('fs'), path = require('path'), { spawn, execFileSync } = require('child_process');
const args = process.argv.slice(2);
const [SRC, OUT] = args.filter((a) => !a.startsWith('--'));
const opt = Object.fromEntries(args.filter((a) => a.startsWith('--')).map((a) => { const [k, v] = a.slice(2).split('='); return [k, v]; }));
const ITERS = +(opt.iters || 2), PORT = +(opt.port || 18000 + Math.floor(Math.random() * 1000));
const MDRV = 'C:\\Program Files (x86)\\OpenText\\Virtual User Generator\\bin\\mdrv.exe';

fs.rmSync(OUT, { recursive: true, force: true });
const W = path.join(OUT, 'script');
fs.mkdirSync(W, { recursive: true });
for (const f of fs.readdirSync(SRC)) if (fs.statSync(path.join(SRC, f)).isFile()) fs.copyFileSync(path.join(SRC, f), path.join(W, f));
if (fs.existsSync(path.join(W, 'lre-utils.dat'))) fs.copyFileSync(path.join(W, 'lre-utils.dat'), path.join(W, 'lre-utils.js'));
const cfgP = path.join(W, 'default.cfg');
let cfg = fs.readFileSync(cfgP, 'utf8');
const set = (k, v) => { const re = new RegExp('^' + k + '=.*$', 'm'); cfg = re.test(cfg) ? cfg.replace(re, k + '=' + v) : cfg; };
set('ProxyUseProxy', '1'); set('ProxyUseProxyServer', '1'); set('ProxyUseSame', '1');
set('ProxyUseBrowser', '0'); set('ProxyUseAutoConfigScript', '0'); set('ProxyBypass', '');   // never the system / browser proxy
set('ProxyHTTPHost', '127.0.0.1'); set('ProxyHTTPPort', String(PORT)); set('ProxyHTTPSHost', '127.0.0.1'); set('ProxyHTTPSPort', String(PORT));
set('NumOfIterations', String(ITERS)); set('ContinueOnError', '1'); set('ProxyNoLocal', '0');
fs.writeFileSync(cfgP, cfg);
const uspP = path.join(W, 'default.usp');
if (fs.existsSync(uspP)) fs.writeFileSync(uspP, fs.readFileSync(uspP, 'utf8').replace(/^RunLogicNumOfIterations="\d+"/gm, 'RunLogicNumOfIterations="' + ITERS + '"'));

const wire = path.join(OUT, 'wire.jsonl');
const mock = spawn(process.execPath, [path.join(__dirname, 'mockproxy.js'), String(PORT), wire].concat(opt.har ? opt.har.split(',') : []), { stdio: ['ignore', 'pipe', 'inherit'] });
mock.stdout.once('data', () => {
  const usr = fs.readdirSync(W).find((f) => f.endsWith('.usr'));
  let code = 0;
  try { execFileSync(MDRV, ['-usr', path.join(W, usr), '-out', path.join(OUT, 'engine')], { stdio: 'ignore', timeout: 600000 }); }
  catch (e) { code = e.status || -1; }
  setTimeout(() => {
    mock.kill();
    const log = fs.existsSync(path.join(OUT, 'engine', 'output.txt')) ? fs.readFileSync(path.join(OUT, 'engine', 'output.txt'), 'utf8') : '';
    fs.writeFileSync(path.join(OUT, 'output.txt'), log);
    const reqs = fs.existsSync(wire) ? fs.readFileSync(wire, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
    const txns = {};
    for (const m of log.matchAll(/Transaction "([^"]+)" ended with an? "(\w+)" status/g)) { txns[m[1]] = txns[m[1]] || []; txns[m[1]].push(m[2]); }
    const errors = [...log.matchAll(/(Error -?\d+:[^\n]*)/g)].map((m) => m[1].replace(/\s+\[MsgId.*$/, ''));
    const compile = /Compilation error|error C\d+|syntax error/i.test(log) ? log.match(/.*(Compilation error|error C\d+|syntax error).*/i)[0] : null;
    const dpop = reqs.filter((r) => r.dpop).map((r) => ({ seq: r.seq, url: r.url, ...r.dpop }));
    // guard: the engine must only ever talk to the local proxy
    if (/Could not resolve address|Failed to connect to server "(?!127\.0\.0\.1)/.test(log)) errors.unshift('BYPASSED THE TEST PROXY');
    const summary = { mdrvExit: code, iterationsDone: (log.match(/Ending iteration \d+/g) || []).length, requests: reqs.length, errors, compile, txns,
      dpopBad: dpop.filter((d) => d.error || !d.sig || !d.htm || !d.htu || !d.athOk) };
    fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ out: OUT, exit: code, iters: summary.iterationsDone, requests: reqs.length, errors: errors.length, compile, dpopBad: summary.dpopBad.length }));
  }, 300);
});
