'use strict';
/**
 * The script settings chosen on the page after a conversion (Postman / Bruno and JMeter — the preview,
 * src/web/convertPreview.js): the script name and the servers' parameter names. Absent → the converter's own choice,
 * and the answer is exactly as before.
 *
 *   settingsOptions(body)            the form fields → { scriptName?, serverNames? } (spread into the converter options)
 *     scriptName   any text; made safe here (letters, numbers, _ - . and spaces, 60 characters)
 *     serverNames  JSON { server: name } — the server as the preview lists it (host, or host:port)
 *   applyScriptName(collection, name) the name every generator reads (collection.info.name): .usr, metadata, workbook
 *   applyServerNames(hostVarMap, serverNames, extra)
 *                                    the generators' Map(server → parameter name) after their default names: each chosen
 *                                    name that is valid (shared/host-params.js validName — not reserved, not one of
 *                                    `extra`, not another server's) replaces the default; others are ignored
 *   serverKey(host)                  how a server is compared: lower case, :443 / :80 dropped
 *   noteGenerated(src, generator, analysis)  for the preview: each server's parameter name, the correlations found
 *   safeZipName(name)                the download's file name for a chosen script name
 */

const HostParams = require('../web/public/shared/host-params');

const MAX_NAME = 60;
const MAX_SERVERS = 200;

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

function settingsOptions(body) {
  const b = body || {};
  const out = {};
  const name = cleanScriptName(b.scriptName);
  if (name) out.scriptName = name;
  const servers = readServerNames(b.serverNames);
  if (servers) out.serverNames = servers;
  return out;
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
  const list = analysis && analysis.correlations && analysis.correlations.correlations;
  if (Array.isArray(list)) (previewSource.correlations || (previewSource.correlations = [])).push(...list);
}

function safeZipName(name) {
  const s = cleanScriptName(name).replace(/ /g, '_');
  return s ? s + '.zip' : 'loadrunner_script.zip';
}

module.exports = { settingsOptions, applyScriptName, applyServerNames, noteGenerated, serverKey, safeZipName, cleanScriptName, readServerNames };
