#!/usr/bin/env node
// node compare.js <baselineDir> <candidateDir> [--max=N]
// Byte-compares every captured file. diagnostics.json (page / console / network
// errors) is reported separately as non-functional; summary.json is ignored.
'use strict';
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
const [A, B] = args.filter(a => !a.startsWith('--'));
const MAX = parseInt((args.find(a => a.startsWith('--max=')) || '--max=200').slice(6), 10);
if (!A || !B) { console.error('usage: node compare.js <baselineDir> <candidateDir> [--max=N]'); process.exit(2); }
function walk(d, base = d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p, base, out); else out.push(path.relative(base, p).split(path.sep).join('/')); }
  return out;
}
function jsonKeyDiff(a, b, prefix = '', out = []) {
  if (out.length > 8) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a) && a.length !== b.length) { out.push(prefix + ' (length ' + a.length + ' vs ' + b.length + ')'); return out; }
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) jsonKeyDiff(a[k], b[k], prefix + (Array.isArray(a) ? '[' + k + ']' : '.' + k), out);
    return out;
  }
  const s = v => { const t = JSON.stringify(v); return t === undefined ? 'undefined' : t.length > 120 ? t.slice(0, 120) + '…' : t; };
  out.push(prefix + ': ' + s(a) + ' -> ' + s(b));
  return out;
}
function firstLineDiff(x, y) {
  const la = x.split('\n'), lb = y.split('\n');
  for (let i = 0; i < Math.max(la.length, lb.length); i++) if (la[i] !== lb[i]) return 'line ' + (i + 1) + ': ' + JSON.stringify((la[i] || '').slice(0, 140)) + ' -> ' + JSON.stringify((lb[i] || '').slice(0, 140));
  return '';
}
const fa = new Set(walk(A)), fb = new Set(walk(B));
const diffs = [], diag = [];
for (const f of [...new Set([...fa, ...fb])].sort()) {
  if (f === 'summary.json') continue;
  const isDiag = path.basename(f) === 'diagnostics.json';
  if (!fa.has(f) || !fb.has(f)) { (isDiag ? diag : diffs).push((fa.has(f) ? 'only in baseline: ' : 'only in candidate: ') + f); continue; }
  const x = fs.readFileSync(path.join(A, f)), y = fs.readFileSync(path.join(B, f));
  if (x.equals(y)) continue;
  if (isDiag) {
    const ea = JSON.parse(x).errors, eb = JSON.parse(y).errors;
    const added = eb.filter(e => !ea.includes(e)), removed = ea.filter(e => !eb.includes(e));
    diag.push(f + (added.length ? '\n    + ' + added.map(e => e.split('\n')[0]).join('\n    + ') : '') + (removed.length ? '\n    - ' + removed.map(e => e.split('\n')[0]).join('\n    - ') : ''));
    continue;
  }
  let detail = '';
  if (f.endsWith('.json')) { try { detail = '\n    ' + jsonKeyDiff(JSON.parse(x), JSON.parse(y)).join('\n    '); } catch (e) { detail = ' (unparseable json)'; } }
  else detail = '\n    ' + firstLineDiff(x.toString(), y.toString());
  diffs.push('DIFFERENT: ' + f + detail);
}
console.log(`compared ${fa.size} baseline files with ${fb.size} candidate files`);
if (diffs.length) { console.log(diffs.length + ' functional difference(s):'); console.log(diffs.slice(0, MAX).join('\n')); if (diffs.length > MAX) console.log(`... ${diffs.length - MAX} more`); }
else console.log('FUNCTIONAL OUTPUT IDENTICAL');
if (diag.length) console.log('\ndiagnostics (non-functional):\n' + diag.join('\n'));
process.exit(diffs.length ? 1 : 0);
