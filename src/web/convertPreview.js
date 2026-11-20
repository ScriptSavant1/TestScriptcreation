'use strict';
/**
 * The converters' preview (Postman / Bruno and JMeter panels): what the ZIP holds, shown before it is downloaded —
 * every request (grouped by top-level folder, or by thread group for JMeter), the servers they call and the files.
 * Read-only: built from what the converter already parsed and generated; nothing is generated again here.
 *
 *   buildPreview({ kind, requests, collection, environmentVars, files, outputDir })
 *     kind            "pm" (Postman / Bruno) | "jmx"
 *     requests        the parser's requests: { name, folder, method, url, threadGroupName? }
 *     collection      the parser's collection (its variables help resolve {{baseUrl}} / ${host})
 *     environmentVars { key: value } — the environment file (it wins over the collection's variables)
 *     files           the converter's in-memory files: Map(path → string | Buffer)
 *     outputDir       the folder the files are under (the ZIP's paths are relative to it, as the download names them)
 *     leftOut         the numbers of the requests left out on the page (src/core/requestSelection.js): listed, marked out
 *   → { requests: [{ n, name, folder, group, method, url, address, host, resolved, state, out, sets?, uses? }],
 *       sets / uses: the names a request sets while the script runs / the ones it sends that a request sets (only when any)
 *       hosts: [{ host, count, resolved, state }], groups: [{ name, count }],
 *     state: "resolved" (a real server), "runtime" (a variable the script sets while it runs — by a script or a JMeter
 *     extractor, or declared with no value yet), "missing" (a variable nothing gives a value: the script calls it as written)
 *       files: [{ path, size, text }]   — text null when not shown (binary, a key or certificate, too large)
 *       truncated }                     — true when some files were left out of the preview to keep it small
 *
 * Addresses are split by hand, never with new URL(): {{variables}} must stay as written (CLAUDE.md rule 3).
 */

const path = require('path');

const MAX_FILE = 400 * 1024;        // one file shown up to this size
const MAX_TOTAL = 3 * 1024 * 1024;  // all files together
const TEXT_EXT = /\.(c|h|js|mjs|ts|json|ya?ml|usr|cfg|usp|prm|dat|csv|md|txt|xml|ini|env|bru)$/i;
const SECRET_EXT = /\.(pem|key|crt|cer|p12|pfx|jks|der)$/i;

// the variables known for this collection / test plan: collection variables, then the environment (wins) — only those
// with a value; a name declared with no value (the JMeter converter declares the variables a script fills) is in declared
function variablesOf(collection, environmentVars, declared) {
  const vars = {};
  const put = (k, v) => { if (!k) return; if (v != null && v !== '') vars[k] = v; else if (declared) declared.add(k); };
  const cv = collection && (collection.variable || collection.variables);
  if (Array.isArray(cv)) cv.forEach((v) => { if (v && (v.key || v.name) && v.disabled !== true && v.enabled !== false) put(v.key || v.name, v.value); });
  else if (cv && typeof cv === 'object') Object.keys(cv).forEach((k) => put(k, cv[k]));
  Object.keys(environmentVars || {}).forEach((k) => put(k, environmentVars[k]));
  return vars;
}

// the names given a value while the script runs: set by a script (pm.environment.set("x"), bru.setVar("x"),
// postman.setEnvironmentVariable("x"), vars.put("x") …) or by a JMeter extractor
const SETTER = /(?:\.|\b)(?:set|setVar|setEnvVar|setGlobalVar|setNextEnvVar|setEnvironmentVariable|setGlobalVariable|put)\s*\(\s*\\*["']([\w.-]+)\\*["']/g;
function runtimeNames(requests, declared) {
  const names = new Set(declared || []);
  for (const r of requests || []) {
    const s = JSON.stringify(r) || '';
    let m;
    SETTER.lastIndex = 0;
    while ((m = SETTER.exec(s))) names.add(m[1]);
    (r.extractors || []).forEach((x) => { const n = x && ((x.extractor && x.extractor.name) || x.name || x.refName); if (n) names.add(n); });
  }
  return names;
}
// what one request needs from another: the names it sets (its scripts, its extractors) and the variables it sends (address,
// headers, body, auth) that some request sets — so the page can warn before a request is left out that others need
function setsOf(r) { return [...runtimeNames([r])]; }
function usesOf(r, setSomewhere) {
  const sent = JSON.stringify({ url: r.url, headers: r.headers, body: r.body, auth: r.auth }) || '';
  return [...new Set(varNames(sent))].filter((k) => setSomewhere.has(k));
}
const varNames = (s) => { const out = []; String(s).replace(/\{\{\s*([^{}\s]+)\s*\}\}|\$\{([^{}]+)\}/g, (m, a, b) => { out.push(a || b); return m; }); return out; };

// {{name}} (Postman / Bruno) and ${name} (JMeter) replaced by their value when known — a few rounds, for a variable
// whose value uses another one; unknown ones stay as written
function resolve(text, vars) {
  let s = String(text == null ? '' : text);
  for (let round = 0; round < 4; round++) {
    const next = s.replace(/\{\{\s*([^{}\s]+)\s*\}\}|\$\{([^{}]+)\}/g, (m, a, b) => {
      const k = a || b;
      return Object.prototype.hasOwnProperty.call(vars, k) && vars[k] != null && vars[k] !== '' ? String(vars[k]) : m;
    });
    if (next === s) break;
    s = next;
  }
  return s;
}

// the server of an address, by hand: "https://api.example.com:8443/v1?x" → "api.example.com:8443";
// "{{baseUrl}}/v1" (still a variable) → "{{baseUrl}}"
function hostOf(address) {
  const a = String(address || '').trim();
  const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#]*)/i.exec(a);
  if (m) { const h = m[1].replace(/^[^@]*@/, ''); return /\{\{|\$\{/.test(h) ? h : h.toLowerCase(); }
  const v = /^(\{\{[^{}]+\}\}|\$\{[^{}]+\})/.exec(a);
  if (v) return v[1];
  const first = a.split(/[/?#]/)[0];
  return first || '(no server)';
}

const isVariable = (h) => /\{\{|\$\{/.test(h);

function buildPreview({ kind, requests, leftOut, collection, environmentVars, files, outputDir }) {
  const out = leftOut instanceof Set ? leftOut : new Set(leftOut || []);
  const declared = new Set();
  const vars = variablesOf(collection, environmentVars, declared);
  const runtime = runtimeNames(requests, declared);
  const setByScript = runtimeNames(requests);
  const stateOf = (h) => !isVariable(h) ? 'resolved' : varNames(h).every((k) => runtime.has(k)) ? 'runtime' : 'missing';
  const list = (requests || []).map((r, i) => {
    const url = typeof r.url === 'string' ? r.url : (r.url && (r.url.raw || r.url.url)) || '';
    const address = resolve(url, vars);
    const host = hostOf(address);
    const folder = String(r.folder || '');
    const group = kind === 'jmx' ? (r.threadGroupName || 'Test plan') : (folder.split('/')[0] || '(no folder)');
    const row = { n: i + 1, name: String(r.name || ''), folder, group, method: String(r.method || 'GET').toUpperCase(), url, address, host, resolved: !isVariable(host), state: stateOf(host), out: out.has(i + 1) };
    const sets = setsOf(r), uses = usesOf(r, setByScript);
    if (sets.length) row.sets = sets;
    if (uses.length) row.uses = uses;
    return row;
  });

  const hostMap = new Map(), groupMap = new Map();
  for (const r of list) {
    const h = hostMap.get(r.host) || { host: r.host, count: 0, resolved: r.resolved, state: r.state };
    h.count++; hostMap.set(r.host, h);
    groupMap.set(r.group, (groupMap.get(r.group) || 0) + 1);
  }

  // the files, named as the ZIP names them (relative to the output folder)
  const prefix = String(outputDir || '').replace(/\\/g, '/').replace(/\/$/, '');
  const fileList = [];
  let total = 0, truncated = false;
  for (const [filePath, content] of files || []) {
    const p = String(filePath).replace(/\\/g, '/');
    const rel = prefix && p.startsWith(prefix + '/') ? p.slice(prefix.length + 1) : path.basename(p);
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(String(content == null ? '' : content));
    let text = null;
    if (TEXT_EXT.test(rel) && !SECRET_EXT.test(rel) && !buf.includes(0)) {
      if (buf.length <= MAX_FILE && total + buf.length <= MAX_TOTAL) { text = buf.toString('utf8'); total += buf.length; }
      else truncated = true;
    }
    fileList.push({ path: rel, size: buf.length, text });
  }
  fileList.sort((a, b) => a.path.localeCompare(b.path));

  return {
    requests: list,
    hosts: [...hostMap.values()].sort((a, b) => b.count - a.count || a.host.localeCompare(b.host)),
    groups: [...groupMap.entries()].map(([name, count]) => ({ name, count })),
    files: fileList,
    truncated,
  };
}

// never let the preview break a conversion: on any error the answer simply has no preview
function safePreview(input) {
  try { return buildPreview(input); } catch (e) { console.warn('[convert-preview]', e.message); return null; }
}

module.exports = { buildPreview, safePreview, resolve, hostOf, variablesOf, runtimeNames, setsOf, usesOf };
