#!/usr/bin/env node
// node compare-hosts.js <baselineDir> <candidateDir>
// Compares the Recorder output before / after the server-parameter + type-button change.
// Server parameters are normalised on both sides to {H:host}; the old server block (Action.c / main.js) and the new
// one (vuser_init.c / main.js consts, Action.c pointer comment) are removed. Whatever differs after that is printed.
'use strict';
const fs = require('fs'), path = require('path');
const [A, B] = process.argv.slice(2);
function walk(d, base = d, out = []) {
  if (!fs.existsSync(d)) return out;
  for (const n of fs.readdirSync(d)) { const p = path.join(d, n); if (fs.statSync(p).isDirectory()) walk(p, base, out); else out.push(path.relative(base, p)); }
  return out;
}
const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// host -> name maps
function oldMap(ac, mj) {
  const m = {};
  for (const x of (ac || '').matchAll(/lr_save_string\("([^"]+)", "(ServerHost\d*)"\);/g)) m[x[2]] = x[1];
  for (const x of (mj || '').matchAll(/^let (SERVER_HOST\d*) = '([^']*)';$/gm)) m[x[1]] = x[2];
  return m;
}
function newMap(vi, mj) {
  const m = {};
  for (const x of (vi || '').matchAll(/lr_save_string\("([^"]+)", "([A-Za-z_]\w*)"\);/g)) m[x[2]] = x[1];
  for (const x of (mj || '').matchAll(/^const ([A-Za-z_]\w*) = '([^']*)';/gm)) m[x[1]] = x[2];
  return m;
}
function normalise(text, map) {
  let t = text;
  for (const [n, h] of Object.entries(map).sort((a, b) => b[0].length - a[0].length)) {
    t = t.replace(new RegExp('\\{' + esc(n) + '\\}', 'g'), '{H:' + h + '}').replace(new RegExp('\\$\\{' + esc(n) + '\\}', 'g'), '{H:' + h + '}');
  }
  return t;
}
function stripOld(t) {
  return t.replace(/\t\/\/ Server configuration[^\n]*\n\t\/\/ e\.g\.[^\n]*\n(\tlr_save_string\([^\n]*\n)+\n/, '')
          .replace(/^let SERVER_HOST\d* = '[^']*';\n/gm, '').replace(/^\nlet think_time/m, 'let think_time');
}
function stripNew(t) {
  return t.replace(/\t\/\/ Servers \([^\n]*are set in vuser_init[^\n]*\n\n/, '')
          .replace(/\t\/\/ Servers — change[^\n]*\n(\tlr_save_string\([^\n]*\n)+\n/, '')
          .replace(/^\/\/ Servers — change[^\n]*\n(const [^\n]*\n)+\n/m, '');
}
function lineDiff(a, b) {
  const x = a.split('\n'), y = b.split('\n'), out = [];
  // simple LCS-free diff: report lines present in one and not the other (multiset), enough to read
  const cnt = new Map();
  x.forEach(l => cnt.set(l, (cnt.get(l) || 0) + 1));
  y.forEach(l => cnt.set(l, (cnt.get(l) || 0) - 1));
  for (const [l, c] of cnt) { if (c > 0) out.push('  - ' + l.slice(0, 220) + (c > 1 ? '  (x' + c + ')' : '')); if (c < 0) out.push('  + ' + l.slice(0, 220) + (c < -1 ? '  (x' + -c + ')' : '')); }
  return out;
}
const dirs = new Set(walk(A).filter(f => /state\.json$/.test(f)).map(f => path.dirname(f)));
let same = 0, diffs = 0;
for (const d of [...dirs].sort()) {
  const read = (root, f) => { const p = path.join(root, d, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
  const sa = JSON.parse(read(A, 'state.json')), sb = read(B, 'state.json') ? JSON.parse(read(B, 'state.json')) : null;
  const report = [];
  if (!sb) { console.log('MISSING ' + d); diffs++; continue; }
  for (const k of ['counts', 'entries', 'entriesDigest', 'txns', 'toasts', 'auth', 'hasDpop', 'domainFilter', 'stepThrew', 'confirmThrew', 'scriptKeys']) {
    if (JSON.stringify(sa[k]) !== JSON.stringify(sb[k])) report.push('state.' + k + ' differs' + (k === 'counts' ? ' ' + JSON.stringify(sa[k]) + ' -> ' + JSON.stringify(sb[k]) : ''));
  }
  const sc = (root) => ({ ac: read(root, 'scripts/ac.txt'), mj: read(root, 'scripts/mj.txt'), vi: read(root, 'scripts/vi.txt'), ve: read(root, 'scripts/ve.txt'), gh: read(root, 'scripts/gh.txt') });
  const oa = sc(A), nb = sc(B);
  const om = oldMap(oa.ac, oa.mj), nm = newMap(nb.vi, nb.mj);
  for (const k of ['ac', 'mj', 'vi', 've', 'gh']) {
    if (oa[k] === null && nb[k] === null) continue;
    const x = normalise(stripOld(oa[k] || ''), om), y = normalise(stripNew(nb[k] || ''), nm);
    if (x !== y) { report.push(k + ':'); report.push(...lineDiff(x, y).slice(0, 25)); }
  }
  const oh = Object.values(om).sort(), nh = Object.values(nm).sort();
  const extra = nh.filter(h => !oh.includes(h)), gone = oh.filter(h => !nh.includes(h));
  if (extra.length || gone.length) report.push('servers: +' + JSON.stringify(extra) + ' -' + JSON.stringify(gone));
  if (report.length) { diffs++; console.log('\n### ' + d + '\n' + report.join('\n')); } else same++;
}
console.log(`\n${same} identical after normalising, ${diffs} with differences`);
