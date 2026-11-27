'use strict';

/**
 * The sign-in of one request, the same for both generators (BUG-175).
 * Postman: request.auth / collection.auth = { type, [type]: [{ key, value }] }; Bruno is turned into that shape by its
 * parser; a JMeter Authorization Manager gives { type, username, password, url, hostport }.
 * Headers (Basic, Bearer, API key) are written by the generators; Digest, NTLM and Kerberos need the engine's own
 * sign-in, which answers the server's question.
 */

const HostParams = require('../web/public/shared/host-params');

const str = (v) => (v === undefined || v === null ? '' : String(v));

/** The request's own sign-in, else the collection's; null when there is none or it is switched off. */
function authOf(request, collection) {
  const own = request && request.auth && request.auth.type && String(request.auth.type).toLowerCase() !== 'inherit' ? request.auth : null;
  const a = own || (collection && collection.auth) || null;
  return a && a.type && String(a.type).toLowerCase() !== 'noauth' ? a : null;
}

/** Its settings as one object: from a list, an object, or the fields beside the type. */
function authValues(auth) {
  const o = {}, part = auth && auth[auth.type];
  if (Array.isArray(part)) part.forEach((x) => { if (x && x.key) o[x.key] = x.value; });
  else if (part && typeof part === 'object') Object.assign(o, part);
  else Object.keys(auth || {}).forEach((k) => { if (k !== 'type' && typeof auth[k] !== 'object') o[k] = auth[k]; });
  return o;
}

const hostOf = (u) => { const m = /^[a-z]+:\/\/([^/?#]+)/i.exec(str(u)); return m ? m[1].toLowerCase() : ''; };

/** A JMeter sign-in is for the addresses that begin with its URL (none given: all). */
function forAddress(auth, url) {
  const want = str(auth.url).trim();
  if (!want) return true;
  if (str(url).startsWith(want)) return true;
  const a = hostOf(want), b = hostOf(url);
  return /\{\{|\$\{/.test(want + str(url).split(/[?#]/)[0]) || !a || a === b;   // a variable in the address: cannot be told here
}

/**
 * What the generators write for a request: null, or
 *   { kind: 'basic', username, password } · { kind: 'apikey', in: 'header' | 'query', key, value } ·
 *   { kind: 'digest', username, password } · { kind: 'other', type } (no header of its own here)
 */
function requestAuth(request, collection) {
  const auth = authOf(request, collection);
  if (!auth || !forAddress(auth, request && request.url)) return null;
  const type = String(auth.type).toLowerCase(), v = authValues(auth);
  if (type === 'basic') return v.username === undefined && v.password === undefined ? null : { kind: 'basic', username: str(v.username), password: str(v.password) };
  if (type === 'digest') return v.username === undefined ? null : { kind: 'digest', username: str(v.username), password: str(v.password) };
  if (type === 'apikey') return str(v.key) ? { kind: 'apikey', in: /^query/i.test(str(v.in || v.placement)) ? 'query' : 'header', key: str(v.key), value: str(v.value) } : null;
  return { kind: 'other', type };
}

/** An API key sent in the address: put into the address of each request (once), so every reader of it sees it. */
function applyQueryKeys(requests, collection) {
  (requests || []).forEach((r) => {
    if (!r || typeof r.url !== 'string' || !r.url) return;
    const a = requestAuth(r, collection);
    if (!a || a.kind !== 'apikey' || a.in !== 'query') return;
    const enc = (s) => s.split(/(\{\{[^{}]*\}\})/).map((p, i) => (i % 2 ? p : encodeURIComponent(p))).join('');
    const hash = r.url.indexOf('#'), base = hash < 0 ? r.url : r.url.slice(0, hash), tail = hash < 0 ? '' : r.url.slice(hash);
    const q = base.indexOf('?'), key = enc(a.key);
    if (q >= 0 && base.slice(q + 1).split('&').some((p) => p.split('=')[0] === key)) return;
    r.url = base + (q < 0 ? '?' : /[?&]$/.test(base) ? '' : '&') + key + '=' + enc(a.value) + tail;
  });
  return requests;
}

/** The server a user is set for (host:port on a port other than 80 / 443 — BUG-130); the variables of the address resolved. */
function signInHost(request, variables) {
  if (request && request.auth && request.auth.hostport) return String(request.auth.hostport);
  let url = str(request && request.url);
  for (let n = 0; n < 5 && /\{\{/.test(url); n++) {
    const next = url.replace(/\{\{\s*([^{}]+?)\s*\}\}/g, (m, k) => { const v = variables && variables.get ? variables.get(k) : undefined; return v === undefined || v === null ? m : String(v); });
    if (next === url) break;
    url = next;
  }
  if (!/^[a-z]+:\/\//i.test(url)) url = 'https://' + url;
  const m = /^[a-z]+:\/\/[^/?#]+/i.exec(url);
  return m && !/\{\{/.test(m[0]) ? HostParams.hostKey(m[0]) : '';
}

module.exports = { signInHost, authOf, authValues, requestAuth, applyQueryKeys };
