// Compare what two replays sent on the wire, request by request.
//   node wirediff.js <runA> <runB>     (run dirs from runvugen.js / rundevweb.js)
// Ignored: connection-level headers, header order, header-name case, values that are random by design
// (DPoP proofs, UUIDs, timestamps, JWTs). Prints every difference; exit 1 if any.
'use strict';
const fs = require('fs'), path = require('path');
const [A, B] = process.argv.slice(2);
const load = (d) => fs.readFileSync(path.join(d, 'wire.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const DROP = new Set(['proxy-connection', 'connection', 'content-length', 'host', 'cache-control', 'pragma']);
const norm = (s) => String(s)
  .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
  .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '<JWT>')
  .replace(/\b1[6-9]\d{8}(\d{3})?\b/g, '<TS>');
function shape(r) {
  const h = r.headers.filter(([k]) => !DROP.has(k.toLowerCase())).map(([k, v]) => k.toLowerCase() + ': ' + (k.toLowerCase() === 'dpop' ? '<PROOF>' : norm(v))).sort();
  return { line: r.method + ' ' + norm(r.url), headers: h, body: norm(r.body) };
}
// Page resources download in parallel, so order is not stable: compare as multisets. A request that differs only in
// some headers / body is paired with its counterpart (same method + URL) and the differences are listed.
const a = load(A).map(shape), b = load(B).map(shape);
const key = (r) => r.line + '\n' + r.headers.join('\n') + '\n' + r.body;
const count = new Map();
a.forEach((r) => count.set(key(r), (count.get(key(r)) || 0) + 1));
const onlyB = [];
b.forEach((r) => { const k = key(r); if (count.get(k) > 0) count.set(k, count.get(k) - 1); else onlyB.push(r); });
const onlyA = [];
a.forEach((r) => { const k = key(r); if (count.get(k) > 0) { count.set(k, count.get(k) - 1); onlyA.push(r); } });
const out = [];
for (const x of onlyA) {
  const j = onlyB.findIndex((y) => y.line === x.line);
  if (j < 0) { out.push('only in A: ' + x.line); continue; }
  const y = onlyB.splice(j, 1)[0], d = [];
  const hx = new Set(x.headers), hy = new Set(y.headers);
  x.headers.filter((h) => !hy.has(h)).forEach((h) => d.push('  - ' + h.slice(0, 200)));
  y.headers.filter((h) => !hx.has(h)).forEach((h) => d.push('  + ' + h.slice(0, 200)));
  if (x.body !== y.body) d.push(`  body: ${x.body.slice(0, 160)}  ->  ${y.body.slice(0, 160)}`);
  out.push(x.line + '\n' + d.join('\n'));
}
onlyB.forEach((y) => out.push('only in B: ' + y.line));
console.log(`${a.length} vs ${b.length} requests`);
console.log(out.length ? out.join('\n') : 'SAME ON THE WIRE');
process.exit(out.length ? 1 : 0);
