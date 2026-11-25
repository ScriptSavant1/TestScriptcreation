'use strict';
/**
 * The script settings chosen on the page after a conversion (Postman / Bruno and JMeter — the preview,
 * src/web/convertPreview.js): the script name, the servers' parameter names and values given on the page. Absent → the converter's own choice,
 * and the answer is exactly as before.
 *
 *   settingsOptions(body)            the form fields → { scriptName?, serverNames?, values? } (spread into the converter options)
 *     scriptName   any text; made safe here (letters, numbers, _ - . and spaces, 60 characters)
 *     serverNames  JSON { server: name } — the server as the preview lists it (host, or host:port)
 *     values       JSON { variable: value } — a value given on the page for a variable the requests send
 *   applyValues(collection, environmentVars, values) → environmentVars
 *                                    each given value goes where the script reads it: the collection's / test plan's own
 *                                    variable when it has one (the environment only fills gaps), else the environment;
 *                                    none given → environmentVars unchanged (even null)
 *   applyScriptName(collection, name) the name every generator reads (collection.info.name): .usr, metadata, workbook
 *   applyServerNames(hostVarMap, serverNames, extra)
 *                                    the generators' Map(server → parameter name) after their default names: each chosen
 *                                    name that is valid (shared/host-params.js validName — not reserved, not one of
 *                                    `extra`, not another server's) replaces the default; others are ignored
 *   serverKey(host)                  how a server is compared: lower case, :443 / :80 dropped
 *   noteGenerated(src, generator, analysis)  for the preview: each server's parameter name, the correlations found, the
 *                                    values the script makes itself (a UUID, a nonce: the generators' perRequestVars)
 *   safeZipName(name)                the download's file name for a chosen script name
 *   applyVarNames(o, names)          a variable used as a server's address (base_url) under the name chosen on the page:
 *                                     everywhere it is sent, in the scripts that read it, in the environment / collection /
 *                                     test plan that gives it its value → { old: new } that were applied. Never one a script
 *                                     sets, a data file column, or a name already in use
 */

const HostParams = require('../web/public/shared/host-params');

const MAX_NAME = 60;
const MAX_SERVERS = 200;
const MAX_VALUES = 500;
const MAX_VALUE_LEN = 10000;

function cleanScriptName(text) {
  const s = String(text == null ? '' : text).replace(/[^A-Za-z0-9 _.-]/g, '_').replace(/\s+/g, ' ').trim().slice(0, MAX_NAME);
  return /[A-Za-z0-9]/.test(s) ? s : '';
}

function serverKey(host) {
  return String(host || '').trim().toLowerCase().replace(/:(443|80)$/, '');
}

function readServerNames(text) {
  if (text == null || text === '') return null;
  let o;
  try { o = typeof text === 'object' ? text : JSON.parse(String(text)); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(o)) {
    if (n >= MAX_SERVERS) break;
    const name = String(o[k] == null ? '' : o[k]).trim();
    if (!k || !/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name)) continue;
    out[serverKey(k)] = name; n++;
  }
  return n ? out : null;
}

function readValues(text) {
  if (text == null || text === '') return null;
  let o;
  try { o = typeof text === 'object' ? text : JSON.parse(String(text)); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(o)) {
    if (n >= MAX_VALUES) break;
    if (!/^[A-Za-z_][\w.-]{0,99}$/.test(k) || o[k] == null || typeof o[k] === 'object') continue;
    out[k] = String(o[k]).slice(0, MAX_VALUE_LEN); n++;
  }
  return n ? out : null;
}

function applyValues(collection, environmentVars, values) {
  if (!values || !Object.keys(values).length) return environmentVars;
  const env = Object.assign({}, environmentVars || {});
  const cv = collection && (collection.variable || collection.variables);
  for (const k of Object.keys(values)) {
    let done = false;
    if (Array.isArray(cv)) {
      for (const v of cv) if (v && (v.key || v.name) === k && v.disabled !== true && v.enabled !== false) { v.value = values[k]; done = true; }
    } else if (cv && typeof cv === 'object' && Object.prototype.hasOwnProperty.call(cv, k)) { cv[k] = values[k]; done = true; }
    if (!done || Object.prototype.hasOwnProperty.call(env, k)) env[k] = values[k];
  }
  return env;
}

function settingsOptions(body) {
  const b = body || {};
  const out = {};
  const name = cleanScriptName(b.scriptName);
  if (name) out.scriptName = name;
  const servers = readServerNames(b.serverNames);
  if (servers) out.serverNames = servers;
  const values = readValues(b.values);
  if (values) out.values = values;
  const vars = readVarNames(b.varNames);
  if (vars) out.varNames = vars;
  return out;
}

function readVarNames(text) {
  if (text == null || text === '') return null;
  let o;
  try { o = typeof text === 'object' ? text : JSON.parse(String(text)); } catch (e) { return null; }
  if (!o || typeof o !== 'object' || Array.isArray(o)) return null;
  const out = {};
  let n = 0;
  for (const k of Object.keys(o)) {
    if (n >= MAX_SERVERS) break;
    const name = String(o[k] == null ? '' : o[k]).trim();
    if (!/^[A-Za-z_][\w.-]{0,99}$/.test(k) || !/^[A-Za-z_][A-Za-z0-9_]{0,39}$/.test(name) || name === k) continue;
    out[k] = name; n++;
  }
  return n ? out : null;
}

const SCRIPT_KEYS = /^(script|exec|tests?|events?|preScripts|postScripts|code|runtime|scripts|req|res)$/;
// o = { requests, collection, environmentVars, threadGroupVars (Map), taken (names that cannot be renamed or used) }
function applyVarNames(o, names) {
  const applied = {};
  if (!names) return applied;
  const env = o.environmentVars || {}, cv = o.collection && (o.collection.variable || o.collection.variables);
  const colNames = Array.isArray(cv) ? cv.map((v) => v && (v.key || v.name)).filter(Boolean) : cv && typeof cv === 'object' ? Object.keys(cv) : [];
  const known = new Set([...Object.keys(env), ...colNames]), taken = new Set(o.taken || []);
  for (const old of Object.keys(names)) {
    const want = names[old], lc = want.toLowerCase();
    if (!known.has(old) || taken.has(old)) continue;
    if ([...known, ...taken, ...Object.values(applied)].some((k) => k !== old && String(k).toLowerCase() === lc)) continue;
    if (HostParams.validName(want, old, {}, [])) continue;
    applied[old] = want;
  }
  const olds = Object.keys(applied);
  if (!olds.length) return applied;
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const any = olds.map(esc).join('|');
  const ref = new RegExp('(\\{\\{\\s*|\\$\\{)(' + any + ')(?=\\s*\\})', 'g');
  const call = new RegExp('(\\w*(?:get|set|has|put|Var|Variable)\\w*\\s*\\(\\s*)(["\'])(' + any + ')\\2', 'g');
  const text = (s, inScript) => {
    let t = s.replace(ref, (m, a, k) => a + applied[k]);
    if (inScript) t = t.replace(call, (m, a, q, k) => a + q + applied[k] + q);
    return t;
  };
  const seen = new WeakSet();
  const walk = (x, inScript) => {
    if (!x || typeof x !== 'object' || seen.has(x) || Buffer.isBuffer(x)) return;
    seen.add(x);
    for (const k of Object.keys(x)) {
      const s = inScript || (!Array.isArray(x) && SCRIPT_KEYS.test(k));
      if (typeof x[k] === 'string') { const t = text(x[k], s); if (t !== x[k]) x[k] = t; } else walk(x[k], s);
    }
  };
  walk(o.requests, false); walk(o.collection, false); walk(env, false);
  const keys = (obj) => { for (const k of Object.keys(obj || {})) if (applied[k]) { obj[applied[k]] = obj[k]; delete obj[k]; } };
  keys(env);
  if (Array.isArray(cv)) cv.forEach((v) => { if (v && applied[v.key]) v.key = applied[v.key]; if (v && applied[v.name]) v.name = applied[v.name]; });
  else keys(cv);
  for (const [, vars] of o.threadGroupVars || []) { walk(vars, false); keys(vars); }
  return applied;
}

function applyScriptName(collection, name) {
  if (!collection || !name) return;
  collection.info = Object.assign({}, collection.info || {}, { name });
  if (typeof collection.name === 'string') collection.name = name;
}

function applyServerNames(hostVarMap, serverNames, extra) {
  if (!hostVarMap || !hostVarMap.size || !serverNames) return hostVarMap;
  // every chosen name first (so two servers can swap names), then each checked against the others; one that cannot
  // be used goes back to its default
  const defaults = new Map(hostVarMap), wanted = [];
  for (const host of defaults.keys()) {
    const want = serverNames[serverKey(host)];
    if (want && want !== defaults.get(host)) { hostVarMap.set(host, want); wanted.push(host); }
  }
  for (const host of wanted) {
    const taken = {};
    for (const [h, n] of hostVarMap) if (h !== host) taken[h] = n;
    if (HostParams.validName(hostVarMap.get(host), host, taken, extra || [])) hostVarMap.set(host, defaults.get(host));
  }
  return hostVarMap;
}

// what a generator decided, for the preview (converter.previewSource): each server's parameter name and the
// correlations it found — merged over the scripts of a multi-script conversion
function noteGenerated(previewSource, generator, analysis) {
  if (!previewSource || !generator) return;
  const servers = previewSource.servers || (previewSource.servers = {});
  for (const [host, name] of generator.hostVarMap || []) { const k = serverKey(host); if (!servers[k]) servers[k] = name; }
  const made = previewSource.made || (previewSource.made = []);
  for (const name of (generator.perRequestVars && generator.perRequestVars.keys()) || []) if (!made.includes(name)) made.push(name);
  const list = analysis && analysis.correlations && analysis.correlations.correlations;
  if (Array.isArray(list)) (previewSource.correlations || (previewSource.correlations = [])).push(...list);
}

function safeZipName(name) {
  const s = cleanScriptName(name).replace(/ /g, '_');
  return s ? s + '.zip' : 'loadrunner_script.zip';
}

module.exports = { readVarNames, applyVarNames, settingsOptions, applyScriptName, applyServerNames, noteGenerated, serverKey, safeZipName, cleanScriptName, readServerNames, readValues, applyValues };
