#!/usr/bin/env node
// node compare.js <baselineDir> <candidateDir>  — byte-compare every captured file.
// diagnostics.json (page/console errors) is reported separately, not as a functional diff.
'use strict';
const fs = require('fs'), path = require('path');
const [A, B] = process.argv.slice(2);
function walk(d, base = d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p, base, out); else out.push(path.relative(base, p)); }
  return out;
}
const fa = new Set(walk(A)), fb = new Set(walk(B));
const diffs = [], diag = [];
for (const f of new Set([...fa, ...fb])) {
  if (f === 'summary.json') continue;
  const isDiag = path.basename(f) === 'diagnostics.json';
  if (!fa.has(f) || !fb.has(f)) { (isDiag ? diag : diffs).push((fa.has(f) ? 'only in baseline: ' : 'only in candidate: ') + f); continue; }
  const x = fs.readFileSync(path.join(A, f)), y = fs.readFileSync(path.join(B, f));
  if (!x.equals(y)) {
    if (isDiag) { diag.push(f + ': ' + y.toString()); continue; }
    let detail = '';
    if (f.endsWith('.json')) {
      const ja = JSON.parse(x), jb = JSON.parse(y);
      detail = ' keys: ' + Object.keys({ ...ja, ...jb }).filter(k => JSON.stringify(ja[k]) !== JSON.stringify(jb[k])).join(',');
      if (ja.toasts && JSON.stringify(ja.toasts) !== JSON.stringify(jb.toasts)) detail += ' toasts ' + JSON.stringify(ja.toasts) + ' vs ' + JSON.stringify(jb.toasts);
    }
    diffs.push('DIFFERENT: ' + f + detail);
  }
}
console.log(`compared ${fa.size} baseline files with ${fb.size} candidate files`);
console.log(diffs.length ? diffs.join('\n') : 'FUNCTIONAL OUTPUT IDENTICAL');
if (diag.length) console.log('\ndiagnostics (non-functional):\n' + diag.join('\n'));
process.exit(diffs.length ? 1 : 0);
