/**
 * url-normalizer.js
 *
 * Strips the parts of a URL that change between calls but don't alter the
 * semantic identity of the endpoint. Used by bg-detector.js to group repeated
 * requests to the "same" URL regardless of cache-busters or per-call IDs.
 *
 * Rules applied in order:
 *   1. Remove known cache-buster query params
 *   2. Replace UUIDs in pathname with {id}
 *   3. Replace long numeric segments (4+ digits) in pathname with {id}
 *   4. Drop the URL fragment
 */

const CACHE_BUSTER_PARAMS = new Set([
  '_t', '_ts', 'timestamp', 'nocache', '_bust', 'rand', 'random',
  'nonce', 'cb', '_cb', 'v', '_v', 'bust', '_nocache', 't',
  '_', '__', 'cachebuster', 'cache_buster', 'cache-buster',
]);

const UUID_RE      = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_SEG  = /\/\d{4,}(?=\/|$)/g;    // /12345 or /12345/ in path

export function normalize(rawUrl) {
  // Use manual split to handle {{template}} variables safely,
  // but URLs from CDP are real, fully-resolved URLs — new URL() is fine here.
  let u;
  try { u = new URL(rawUrl); }
  catch (_) { return rawUrl; }

  // 1. Strip cache-buster params
  for (const key of [...u.searchParams.keys()]) {
    if (CACHE_BUSTER_PARAMS.has(key)) u.searchParams.delete(key);
  }

  // 2 & 3. Normalize pathname: UUIDs → {id}, long numeric segments → {id}
  u.pathname = u.pathname
    .replace(UUID_RE, '{id}')
    .replace(NUMERIC_SEG, '/{id}');

  // 4. Drop fragment
  u.hash = '';

  return u.origin + u.pathname + (u.search !== '?' ? u.search : '');
}
