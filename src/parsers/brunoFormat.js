'use strict';

/**
 * Bruno's own formats, turned into the shape the generators read (the Postman one) — BUG-172, BUG-173:
 *   - .bru text (requests, collection.bru, folder.bru, environments/*.bru) → Bruno's JSON shape (bruToItem …)
 *   - Bruno's JSON shape (the JSON export) → requests and a collection (collectionFromJson)
 *   - a folder of .bru files, as a map of path → text (collectionFromFiles)
 * No file system here: brunoParser.js reads the files.
 */

const { fillPathVariables } = require('../core/utils');

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'options', 'head', 'trace', 'connect'];
const on = (x) => x && x.enabled !== false && !x.disabled;
const str = (v) => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// ─── .bru text ────────────────────────────────────────────────────────────────

/** true: real .bru (blocks in braces); the older text without braces is read by brunoParser.parseBruContent. */
function isBru(text) {
  return new RegExp('^(meta|vars|headers|auth|' + METHODS.join('|') + '|http)(:[\\w-]+)*\\s*\\{\\s*$', 'm').test(String(text || ''));
}

/** Blocks of a .bru file: { name: text between the braces } (a [list] block: its text too). A block ends at a brace in the first column. */
function bruBlocks(text) {
  const blocks = {}, lines = String(text || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^([a-zA-Z][\w-]*(?::[\w-]+)*)\s*([{[])(.*)$/.exec(lines[i]);
    if (!m) continue;
    const close = m[2] === '{' ? '}' : ']', rest = m[3].trim();
    if (rest === close) { blocks[m[1]] = ''; continue; }
    if (rest) continue; // not a block head
    const body = [];
    for (i++; i < lines.length && lines[i].replace(/\s+$/, '') !== close; i++) body.push(lines[i]);
    blocks[m[1]] = body.join('\n');
  }
  return blocks;
}

/** A text block without Bruno's own two spaces of indentation. */
const bruText = (t) => (t === undefined ? undefined : t.split('\n').map((l) => l.replace(/^ {1,2}/, '')).join('\n').replace(/\s+$/, ''));

/** "key: value" lines → [{ name, value, enabled }]; "~key" is switched off; ''' … ''' is a value of several lines; "key" or 'key' may be quoted. */
function bruPairs(t) {
  const out = [], lines = String(t || '').split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('//') || line.startsWith('@description')) continue;
    const q = /^(~?)"((?:[^"\\]|\\.)*)"\s*:\s?(.*)$/.exec(line);
    const at = line.indexOf(':');
    if (!q && at < 1) continue;
    let name = q ? q[2].replace(/\\(["\\])/g, '$1') : line.slice(0, at).trim(), value = (q ? q[3] : line.slice(at + 1)).trim(), enabled = true;
    if (q ? q[1] : name.startsWith('~')) { enabled = false; if (!q) name = name.slice(1); }
    if (value.startsWith("'''")) {
      let v = value.slice(3);
      if (v.includes("'''")) v = v.slice(0, v.indexOf("'''"));
      else {
        const more = v.trim() ? [v] : [];
        for (i++; i < lines.length; i++) { const e = lines[i].indexOf("'''"); if (e >= 0) { if (lines[i].slice(0, e).trim()) more.push(lines[i].slice(0, e)); break; } more.push(lines[i].replace(/^ {1,4}/, '')); }
        v = more.join('\n');
      }
      value = v;
    }
    out.push({ name, value, enabled });
  }
  return out;
}
const bruObject = (t) => { const o = {}; bruPairs(t).forEach((p) => { if (p.enabled) o[p.name] = p.value; }); return o; };

const AUTH_BLOCKS = { basic: 'basic', bearer: 'bearer', digest: 'digest', ntlm: 'ntlm', wsse: 'wsse', apikey: 'apikey', awsv4: 'awsv4', oauth2: 'oauth2' };

/** The parts a request, folder and collection .bru share, in Bruno's JSON shape. */
function bruCommon(b) {
  const auth = { mode: b.auth !== undefined ? bruObject(b.auth).mode || 'none' : undefined };
  Object.keys(AUTH_BLOCKS).forEach((k) => {
    if (b['auth:' + k] === undefined) return;
    const o = bruObject(b['auth:' + k]);
    auth[k] = k === 'oauth2' ? { grantType: o.grant_type, accessTokenUrl: o.access_token_url, clientId: o.client_id, clientSecret: o.client_secret, scope: o.scope, username: o.username, password: o.password } : o;
    if (!auth.mode) auth.mode = k;
  });
  const vars = (k) => bruPairs(b[k]).map((v) => ({ ...v, name: v.name.replace(/^@/, '') }));
  return {
    headers: bruPairs(b.headers),
    auth: auth.mode ? auth : undefined,
    script: { req: bruText(b['script:pre-request'] !== undefined ? b['script:pre-request'] : b.script), res: bruText(b['script:post-response']) },
    vars: { req: vars('vars:pre-request').concat(vars('vars')), res: vars('vars:post-response') },
    tests: bruText(b.tests),
  };
}

/** A request .bru → an item in Bruno's JSON shape; null when the file holds no request. */
function bruToItem(text, fallbackName) {
  const b = bruBlocks(text), meta = bruObject(b.meta);
  const method = METHODS.find((m) => b[m] !== undefined) || (b.http !== undefined ? 'http' : '');
  if (!method) return null;
  const head = bruObject(b[method]), common = bruCommon(b);
  const body = { mode: head.body && head.body !== 'none' ? head.body : '' };
  const form = (k) => bruPairs(b[k]);
  body.json = bruText(b['body:json'] !== undefined ? b['body:json'] : b.body);
  body.text = bruText(b['body:text']); body.xml = bruText(b['body:xml']); body.sparql = bruText(b['body:sparql']);
  body.graphql = { query: bruText(b['body:graphql']), variables: bruText(b['body:graphql:vars']) };
  body.formUrlEncoded = form('body:form-urlencoded');
  body.multipartForm = form('body:multipart-form').map((p) => {
    const f = /^@file\((.*)\)/.exec(p.value), ct = /@contentType\(([^)]*)\)\s*$/.exec(p.value);
    return { ...p, type: f ? 'file' : 'text', value: f ? f[1].split('|').filter(Boolean) : ct ? p.value.slice(0, ct.index).trim() : p.value, contentType: ct ? ct[1] : undefined };
  });
  if (!body.mode) body.mode = ({ 'body:json': 'json', body: 'json', 'body:text': 'text', 'body:xml': 'xml', 'body:sparql': 'sparql', 'body:graphql': 'graphql', 'body:form-urlencoded': 'formUrlEncoded', 'body:multipart-form': 'multipartForm' })[Object.keys(b).find((k) => /^body/.test(k))] || 'none';
  if (head.body === 'none') body.mode = 'none';
  body.mode = { 'form-urlencoded': 'formUrlEncoded', 'multipart-form': 'multipartForm' }[body.mode] || body.mode;
  // the method block names the sign-in: "inherit" and "none" have no block of their own
  const auth = { ...(common.auth || {}) };
  if (head.auth) auth.mode = head.auth;
  return {
    type: 'http', name: meta.name || fallbackName || 'Request', seq: Number(meta.seq) || 0,
    request: {
      url: head.url || '', method: method === 'http' ? (head.method || 'GET') : method.toUpperCase(), headers: common.headers,
      params: bruPairs(b['params:path']).map((p) => ({ ...p, type: 'path' })), body, auth: auth.mode ? auth : undefined,
      script: common.script, vars: common.vars, tests: common.tests, docs: bruText(b.docs),
    },
  };
}

/** Variables of a Bruno environment file: { name: value }, the switched-off ones left out. */
function bruEnvironment(text) {
  const o = {};
  bruPairs(bruBlocks(text).vars).forEach((p) => { if (p.enabled) o[p.name] = p.value.replace(/,$/, '').trim(); });
  return o;
}

// ─── Bruno's JSON shape → what the generators read ────────────────────────────

const list = (o) => Object.keys(o).filter((k) => o[k] !== undefined && o[k] !== null).map((k) => ({ key: k, value: o[k] }));

/** Sign-in → Postman's { type, [type]: [{ key, value }] }; { type: 'noauth' } when it is switched off; null when it is inherited. */
function brunoAuth(a) {
  if (!a || a === 'inherit') return null;
  if (a === 'none') return { type: 'noauth' };
  const mode = String(a.mode || a.type || '').toLowerCase();
  if (!mode || mode === 'inherit') return null;
  if (mode === 'none') return { type: 'noauth' };
  const c = a[mode] && typeof a[mode] === 'object' ? a[mode] : a; // the YAML format keeps the fields beside the type
  if (mode === 'basic' || mode === 'digest') return { type: mode, [mode]: list({ username: str(c.username), password: str(c.password) }) };
  if (mode === 'bearer') return { type: mode, bearer: list({ token: str(c.token) }) };
  if (mode === 'ntlm') return { type: mode, ntlm: list({ username: str(c.username), password: str(c.password), domain: str(c.domain) }) };
  if (mode === 'apikey') return { type: mode, apikey: list({ key: str(c.key), value: str(c.value), in: /^query/i.test(str(c.placement)) ? 'query' : 'header' }) };
  if (mode === 'awsv4') return { type: mode, awsv4: list({ accessKey: c.accessKeyId, secretKey: c.secretAccessKey, sessionToken: c.sessionToken, service: c.service, region: c.region }) };
  if (mode === 'oauth2') return { type: mode, oauth2: list({ grant_type: c.grantType, accessTokenUrl: c.accessTokenUrl, clientId: c.clientId, clientSecret: c.clientSecret, scope: c.scope, username: c.username, password: c.password }) };
  return { type: mode, [mode]: list(typeof c === 'object' ? Object.fromEntries(Object.entries(c).filter(([k, v]) => typeof v !== 'object' && k !== 'mode' && k !== 'type')) : {}) };
}

/** GraphQL as it is sent: JSON with the query and its variables (an object when they are JSON). */
function graphqlText(g) {
  if (!g || !str(g.query).trim()) return '';
  const o = { query: str(g.query) };
  const v = typeof g.variables === 'string' ? g.variables.trim() : g.variables;
  if (v && typeof v === 'object') o.variables = v;
  else if (v) { try { o.variables = JSON.parse(v); } catch (e) { return '{"query":' + JSON.stringify(o.query) + ',"variables":' + v + '}'; } } // {{variables}} not in quotes
  if (g.operationName) o.operationName = g.operationName;
  return JSON.stringify(o);
}

const raw = (text, language) => ({ mode: 'raw', raw: str(text), urlencoded: [], formdata: [], file: null, graphql: null, options: { raw: { language } } });

function brunoBody(b) {
  if (!b) return null;
  const pair = (p) => ({ key: str(p.name), value: str(p.value), disabled: !on(p), description: p.description || '' });
  switch (b.mode) {
    case 'json': return raw(b.json, 'json');
    case 'text': return raw(b.text, 'text');
    case 'xml': return raw(b.xml, 'xml');
    case 'sparql': return raw(b.sparql, 'text');
    case 'graphql': return raw(graphqlText(b.graphql), 'json');
    case 'formUrlEncoded': return { ...raw('', undefined), mode: 'urlencoded', options: {}, urlencoded: (b.formUrlEncoded || []).map(pair) };
    case 'multipartForm': return { ...raw('', undefined), mode: 'formdata', options: {}, formdata: (b.multipartForm || []).map((p) => (p.type === 'file' ? { key: str(p.name), type: 'file', src: [].concat(p.value || []), disabled: !on(p), contentType: p.contentType || undefined } : { ...pair(p), type: 'text', contentType: p.contentType || undefined })) };
    default: return null;
  }
}

const brunoHeaders = (l) => (l || []).filter((h) => h && h.name).map((h) => ({ key: str(h.name), value: str(h.value), disabled: !on(h), description: h.description || '' }));

/** Scripts (and values read after the response: "token: res.body.token") → Postman events, in the order Bruno runs them. */
function brunoEvents(r) {
  const ev = (listen, text) => ({ listen, script: { exec: String(text).split(/\r?\n/) } }), out = [];
  const s = (r && r.script) || {}, res = ((r && r.vars && r.vars.res) || []).filter((v) => on(v) && v.name && str(v.value).trim());
  if (str(s.req).trim()) out.push(ev('prerequest', s.req));
  if (res.length) out.push(ev('test', res.map((v) => 'bru.setVar("' + v.name.replace(/"/g, '') + '", ' + str(v.value) + ');').join('\n')));
  if (str(s.res).trim()) out.push(ev('test', s.res));
  if (str(r && r.tests).trim()) out.push(ev('test', r.tests));
  return out;
}

const isFolder = (x) => !!x && (x.type === 'folder' || (!x.request && Array.isArray(x.items)));

/** Bruno's JSON export (or the same shape made from .bru files) → { name, requests, collection }. */
function collectionFromJson(data, id) {
  const root = ((data.root && data.root.request) || {}), vars = [], requests = [];
  const addVar = (v) => { if (on(v) && v.name && !vars.some((x) => x.key === v.name)) vars.push({ key: String(v.name), value: str(v.value) }); };
  ((root.vars && root.vars.req) || []).forEach(addVar);
  // one environment in the file: its values (a file given on the page wins; several: the page asks for one)
  const envs = (data.environments || []).filter((e) => e && Array.isArray(e.variables));
  if (envs.length === 1) envs[0].variables.filter((v) => !v.secret || str(v.value)).forEach(addVar);
  const rootAuth = brunoAuth(root.auth);

  const walk = (items, folder, depth, up) => (items || []).forEach((item) => {
    if (isFolder(item)) {
      const r = ((item.root && item.root.request) || {}), own = brunoAuth(r.auth);
      walk(item.items, folder ? folder + '/' + item.name : String(item.name || ''), depth + 1, {
        auth: own || up.auth,
        headers: up.headers.filter((h) => !brunoHeaders(r.headers).some((x) => x.key.toLowerCase() === h.key.toLowerCase())).concat(brunoHeaders(r.headers).filter((h) => !h.disabled)),
        vars: up.vars.concat((r.vars && r.vars.req) || []), events: up.events.concat(brunoEvents(r)),
      });
      return;
    }
    const r = item && item.request;
    if (!r || typeof r !== 'object') return;
    const headers = brunoHeaders(r.headers), own = brunoAuth(r.auth);
    // a request without a sign-in setting inherits; { mode: 'none' } has none
    const auth = own || up.auth || null;
    up.vars.concat((r.vars && r.vars.req) || []).forEach(addVar);
    requests.push({
      name: item.name || 'Unnamed Request', folder, depth, method: String(r.method || 'GET').toUpperCase(),
      url: fillPathVariables(str(r.url && typeof r.url === 'object' ? r.url.raw : r.url).trim(), (r.params || []).filter((p) => p && p.type === 'path').map((p) => ({ ...p, disabled: !on(p) }))),
      headers: up.headers.filter((h) => !headers.some((x) => x.key.toLowerCase() === h.key.toLowerCase())).concat(headers),
      body: brunoBody(r.body), auth, description: r.docs || '', tests: up.events.concat(brunoEvents(r)), variables: {}, id: id(),
    });
  });
  walk(data.items, '', 0, { auth: rootAuth, headers: [], vars: [], events: [] });

  return {
    name: data.name || 'Bruno Collection', requests, environments: envs.map((e) => str(e.name)),
    collection: {
      info: { name: data.name || 'Bruno Collection' }, variable: vars, event: brunoEvents(root), collectionHeaders: brunoHeaders(root.headers).filter((h) => !h.disabled).map((h) => ({ key: h.key, value: h.value })),
      item: requests.map((q) => ({ name: q.name, event: q.tests, request: { method: q.method, url: q.url, auth: q.auth || undefined } })),
    },
  };
}

/** Bruno's JSON shape: no Postman schema, items with their own "type" or with Bruno's header / body / auth names. */
function isBrunoJson(d) {
  if (!d || (d.info && d.info.schema) || !Array.isArray(d.items)) return false;
  const has = (l) => l.some((x) => x && (isFolder(x) ? has(x.items || []) : /^(http|graphql|http-request|graphql-request)$/.test(x.type || '') || !!(x.request && ((x.request.auth && x.request.auth.mode) || (x.request.headers || []).some((h) => h && h.name !== undefined && h.key === undefined)))));
  return has(d.items);
}

/** A Bruno folder ({ 'path/file.bru': text }) → Bruno's JSON shape. Order as Bruno runs it: the folders, then the requests, each by seq. */
function collectionFromFiles(files) {
  const norm = {}; Object.keys(files).forEach((k) => { norm[k.replace(/\\/g, '/').replace(/^\.?\//, '')] = files[k]; });
  const depth = (p) => p.split('/').length, names = Object.keys(norm).filter((p) => !/(^|\/)(node_modules|\.git|__MACOSX)\//.test(p));
  const root = names.filter((p) => /(^|\/)(bruno\.json|collection\.bru)$/.test(p)).sort((a, b) => depth(a) - depth(b))[0];
  const base = root ? root.slice(0, root.lastIndexOf('/') + 1) : '';
  const rel = {}; names.filter((p) => p.startsWith(base) && /\.(bru|json)$/i.test(p)).forEach((p) => { rel[p.slice(base.length)] = norm[p]; });
  let info = {}; try { info = JSON.parse(rel['bruno.json'] || '{}'); } catch (e) { /* the folder's name then */ }
  const out = { name: info.name || (base ? base.replace(/\/$/, '').split('/').pop() : 'Bruno Collection'), items: [], environments: [] };
  if (rel['collection.bru'] !== undefined) out.root = { request: bruCommon(bruBlocks(rel['collection.bru'])) };
  const build = (dir) => {
    const here = Object.keys(rel).filter((p) => p.startsWith(dir) && /\.bru$/i.test(p)), folders = new Set(), reqs = [];
    here.forEach((p) => {
      const r = p.slice(dir.length), at = r.indexOf('/');
      if (at > 0) { folders.add(r.slice(0, at)); return; }
      if (/^(folder|collection)\.bru$/i.test(r)) return;
      const item = bruToItem(rel[p], r.replace(/\.bru$/i, '')); if (item) reqs.push(item);
    });
    const subs = [...folders].filter((f) => !(dir === '' && f === 'environments')).map((f) => {
      const b = bruBlocks(rel[dir + f + '/folder.bru'] || ''), meta = bruObject(b.meta);
      return { type: 'folder', name: meta.name || f, seq: Number(meta.seq) || 9999, root: { request: bruCommon(b) }, items: build(dir + f + '/') };
    }).sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name));
    return subs.concat(reqs.sort((a, b) => a.seq - b.seq || a.name.localeCompare(b.name)));
  };
  out.items = build('');
  Object.keys(rel).filter((p) => /^environments\/[^/]+\.bru$/i.test(p)).forEach((p) => out.environments.push({ name: p.slice(13).replace(/\.bru$/i, ''), variables: Object.entries(bruEnvironment(rel[p])).map(([name, value]) => ({ name, value, enabled: true })) }));
  return out;
}

module.exports = { isBru, bruBlocks, bruPairs, bruToItem, bruEnvironment, brunoAuth, brunoBody, brunoHeaders, brunoEvents, graphqlText, collectionFromJson, isBrunoJson, collectionFromFiles };
