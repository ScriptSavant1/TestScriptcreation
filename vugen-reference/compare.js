#!/usr/bin/env node
// Compares two VuGen versions' template folders, file by file and setting by setting.
//   node vugen-reference/compare.js <old version> <new version>      e.g. 26.3 27.1
// The same helpers are used by tests/unit/vugenReference.test.js to check what the generators write.
'use strict';
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const ROOT = __dirname;

const text = (t) => {
  if (typeof t !== 'string') throw new TypeError('expected text');
  return t.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
};

// INI file (.usr, .cfg, .usp) -> { "Section/Key": value }; a section header alone is "Section/"
function parseIni(t) {
  const out = {};
  let section = '';
  for (const line of text(t).split('\n')) {
    if (!line.trim() || /^\s*;/.test(line)) continue;
    const h = /^\s*\[(.*)\]\s*$/.exec(line);
    if (h) { section = h[1]; out[section + '/'] = ''; continue; }
    const i = line.indexOf('=');
    if (i < 0) throw new Error(`not an INI line: ${line.slice(0, 60)}`);
    out[section + '/' + line.slice(0, i).trim()] = line.slice(i + 1);
  }
  return out;
}

// YAML file -> { "a.b.c": JSON value }; an empty map is kept as one entry
function flattenYaml(t) {
  const doc = yaml.load(text(t));
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) throw new Error('YAML file is not a map of settings');
  const out = {};
  (function walk(o, prefix) {
    for (const [k, v] of Object.entries(o)) {
      const key = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) walk(v, key);
      else out[key] = JSON.stringify(v === undefined ? null : v);
    }
  })(doc, '');
  return out;
}

// DevWebSdk.d.ts -> declaration lines only (comments and blank lines removed), so wording changes do not count
function sdkDeclarations(t) {
  return text(t).replace(/\/\*[\s\S]*?\*\//g, '').split('\n')
    .map((l) => l.replace(/^\s*\/\/.*$/, '').trim()).filter(Boolean);
}

function diffKeys(a, b) {
  const added = [], removed = [], changed = [];
  for (const k of Object.keys(b)) if (!(k in a)) added.push(k);
  for (const k of Object.keys(a)) {
    if (!(k in b)) removed.push(k);
    else if (a[k] !== b[k]) changed.push(k);
  }
  return { added, removed, changed };
}

function diffLines(a, b) {
  const count = (arr) => arr.reduce((m, x) => m.set(x, (m.get(x) || 0) + 1), new Map());
  const ca = count(a), cb = count(b);
  const added = [...cb.keys()].filter((k) => (ca.get(k) || 0) < cb.get(k));
  const removed = [...ca.keys()].filter((k) => (cb.get(k) || 0) < ca.get(k));
  return { added, removed, changed: [] };
}

function kindOf(name) {
  if (/\.(usr|cfg|usp)$/i.test(name)) return 'ini';
  if (/\.ya?ml$/i.test(name)) return 'yaml';
  if (/\.d\.ts$/i.test(name)) return 'sdk';
  if (/\.json$/i.test(name)) return 'json';
  return 'lines';
}

function compareFile(name, oldText, newText) {
  switch (kindOf(name)) {
    case 'ini': return diffKeys(parseIni(oldText), parseIni(newText));
    case 'yaml': return diffKeys(flattenYaml(oldText), flattenYaml(newText));
    case 'sdk': return diffLines(sdkDeclarations(oldText), sdkDeclarations(newText));
    case 'json': {
      const flat = (t) => flattenYaml(JSON.stringify(JSON.parse(text(t))));
      return diffKeys(flat(oldText), flat(newText));
    }
    default: return diffLines(text(oldText).split('\n'), text(newText).split('\n'));
  }
}

// Every file of every protocol folder of two version folders
function compareFolders(oldDir, newDir) {
  for (const d of [oldDir, newDir]) if (!fs.existsSync(d) || !fs.statSync(d).isDirectory()) throw new Error(`no such folder: ${d}`);
  const files = (dir) => fs.readdirSync(dir).flatMap((p) => fs.statSync(path.join(dir, p)).isDirectory()
    ? fs.readdirSync(path.join(dir, p)).map((f) => p + '/' + f) : []);
  const a = new Set(files(oldDir)), b = new Set(files(newDir));
  const report = { filesAdded: [...b].filter((f) => !a.has(f)), filesRemoved: [...a].filter((f) => !b.has(f)), files: {} };
  for (const f of [...a].filter((x) => b.has(x)).sort()) {
    const d = compareFile(f, fs.readFileSync(path.join(oldDir, f), 'utf8'), fs.readFileSync(path.join(newDir, f), 'utf8'));
    if (d.added.length || d.removed.length || d.changed.length) report.files[f] = d;
  }
  return report;
}

// vugen-reference/version.json -> { version, usrVersion, dir }
function currentVersion(root = ROOT) {
  const v = JSON.parse(fs.readFileSync(path.join(root, 'version.json'), 'utf8'));
  if (!/^\d+\.\d+$/.test(v.current || '') || !/^\d+\.\d+\.\d+\.\d+$/.test(v.usrVersion || '') || !v.usrVersion.startsWith(v.current + '.'))
    throw new Error('version.json: "current" must look like 26.3 and "usrVersion" like 26.3.0.0');
  const dir = path.join(root, v.current);
  if (!fs.existsSync(dir)) throw new Error(`version.json names ${v.current}, but there is no folder ${dir}`);
  return { version: v.current, usrVersion: v.usrVersion, dir };
}

module.exports = { parseIni, flattenYaml, sdkDeclarations, diffKeys, compareFile, compareFolders, currentVersion };

if (require.main === module) {
  const [oldV, newV] = process.argv.slice(2);
  if (!oldV || !newV) { console.error('usage: node vugen-reference/compare.js <old version> <new version>'); process.exit(2); }
  const r = compareFolders(path.resolve(ROOT, oldV), path.resolve(ROOT, newV));
  console.log(`VuGen templates ${oldV} -> ${newV}`);
  console.log('Files added:   ' + (r.filesAdded.join(', ') || 'none'));
  console.log('Files removed: ' + (r.filesRemoved.join(', ') || 'none'));
  const names = Object.keys(r.files);
  if (!names.length) console.log('No setting changes in the files both versions have.');
  for (const f of names) {
    console.log(`\n${f}`);
    for (const k of ['added', 'removed', 'changed']) if (r.files[f][k].length) console.log(`  ${k}: ${r.files[f][k].join(' | ')}`);
  }
}
