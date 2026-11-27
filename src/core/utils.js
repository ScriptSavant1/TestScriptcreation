'use strict';

/**
 * Core utility functions — shared across ALL generators, parsers, and tools.
 *
 * Rules for this file:
 *   - Pure functions only: no I/O, no side effects, no require() of project modules
 *   - Every function here must be used by at least 2 different modules
 *   - When a rule changes (e.g. HTML entity handling), edit ONLY this file
 *
 * Consumers (server-side, via require):
 *   generators/devweb/scriptGenerator.js   (was advancedScriptGenerator)
 *   generators/vugen/scriptGenerator.js    (was webHttpScriptGenerator)
 *   generators/devweb/filesGenerator.js    (was mandatoryFilesGenerator)
 *   generators/vugen/filesGenerator.js     (was webHttpMandatoryFilesGenerator)
 *   parsers/jmxParser.js
 *
 * Consumers (browser-side, via <script src="/shared/utils.js">):
 *   public/script-studio/studio-codegen.js
 */

// ─── Variable name sanitisation ───────────────────────────────────────────────
/**
 * Convert an arbitrary string into a safe JavaScript identifier.
 * Replaces any character that is not a letter, digit, underscore, or $ with _.
 *
 * Used by DevWeb generator when emitting load.global.<varName> declarations.
 */
function sanitizeVarName(name) {
  return String(name).replace(/[^a-zA-Z0-9_$]/g, '_');
}

// ─── Request bodies ───────────────────────────────────────────────────────────
/** True when a raw body is JSON by its look ({ or [ first) — also one with unquoted {{variables}} that JSON.parse refuses. */
function looksLikeJson(raw) {
  return /^\s*(\{(?!\{)|\[)/.test(String(raw == null ? '' : raw));
}

/**
 * The Content-Type Postman / Bruno add by themselves to a body sent with no such header (null: none).
 * Both generators use it when the request and the common headers have none.
 */
function impliedContentType(body) {
  if (!body) return null;
  if (body.mode === 'urlencoded') return 'application/x-www-form-urlencoded';
  if (body.mode !== 'raw' || !String(body.raw || '').trim()) return null;
  if (looksLikeJson(body.raw)) return 'application/json';
  const language = String((body.options && body.options.raw && body.options.raw.language) || '').toLowerCase();
  if (language === 'html') return 'text/html';
  if (language === 'javascript') return 'application/javascript';
  if (language === 'xml' || /^\s*</.test(body.raw)) return 'application/xml';
  return 'text/plain';
}

// ─── C-string escaping ────────────────────────────────────────────────────────
/**
 * Escape a value for use inside a VuGen C-string literal (double-quoted).
 * Handles the four characters that would break the string or produce wrong bytes:
 *   \  → \\   (prevent accidental escape sequences)
 *   "  → \"   (prevent closing the string prematurely)
 *   \n → \n   (literal newline → two-char escape sequence)
 *   \r → \r   (carriage return → two-char escape sequence)
 *
 * Used by VuGen generator when emitting LB=/RB=/RegExp= attribute values in
 * web_reg_save_param* calls.
 */
function escapeCString(str) {
  return String(str)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
}

// ─── HTML entity decoding ─────────────────────────────────────────────────────
/**
 * Decode HTML entities in a string value.
 *
 * Why this exists: Postman/Bruno web UI HTML-encodes special characters when
 * saving collections (& → &amp;, etc.). JMX files store PEM key newlines as
 * XML character references (&#10; / &#xA;). Without decoding:
 *   - VuGen Parameters panel fails to open (corrupted PRM values)
 *   - JWT crypto throws "DECODER routines:: unsupported" (corrupted PEM key)
 *   - CSV files contain literal &amp; instead of &
 *
 * Applied in three places:
 *   1. DevWeb collection_data.csv generation
 *   2. VuGen ParameterFile.prm + collection_data.dat generation
 *   3. jwt-helper.js before crypto operations
 */
function decodeHtmlEntities(value) {
  if (typeof value !== 'string') return value;
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x0*A;/gi, '\n')   // &#xA; or &#x000A; — newlines in PEM keys
    .replace(/&#0*10;/g, '\n')    // &#10;
    .replace(/&#x0*D;/gi, '\r')   // &#xD;
    .replace(/&#0*13;/g, '\r');   // &#13;
}

// ─── URL assembly ─────────────────────────────────────────────────────────────
/**
 * Build a base URL string from components.
 * Omits the port for standard HTTP (80) and HTTPS (443) ports.
 *
 * Used by jmxParser when assembling request URLs from HTTPSampler.domain,
 * HTTPSampler.port, and HTTPSampler.protocol properties.
 */
function buildBaseUrl(domain, port, protocol) {
  if (!domain) return '';
  const proto   = protocol || 'http';
  const portStr = port && port !== '80' && port !== '443' ? `:${port}` : '';
  return `${proto}://${domain}${portStr}`;
}

/**
 * Fill the path variables of an address: /orders/:id with { key: 'id', value: '42' } → /orders/42.
 * As Postman sends it: only a whole path segment, never the host or the query; a value is written into the path, with the
 * characters that would end the path (space, ? # …) percent-encoded and {{variables}} kept.
 * A path variable without a value becomes {{id}}: it is then listed on the page as a value to give, instead of being sent as ":id".
 * A segment that is not in the list is left as it is. Never new URL(): it would encode {{variables}}.
 * @param {string} url
 * @param {Array<{key?, id?, name?, value?, disabled?}>} list  Postman url.variable, or Bruno's params of type path
 */
function fillPathVariables(url, list) {
  if (!Array.isArray(list) || !list.length || typeof url !== 'string') return url;
  const values = new Map(); // the last one with a name counts, as in Postman
  list.forEach((v) => { const k = v && (v.key || v.name || v.id); if (k && !v.disabled) values.set(String(k).trim(), v.value === undefined || v.value === null ? '' : String(v.value).trim()); });
  const end = url.search(/[?#]/), path = end < 0 ? url : url.slice(0, end);
  return path.split('/').map((seg) => {
    const name = seg.charAt(0) === ':' ? seg.slice(1) : '';
    if (!name || !values.has(name)) return seg;
    const value = values.get(name);
    if (value === '') return /^[\w.-]+$/.test(name) ? '{{' + name + '}}' : seg;
    return value.split(/(\{\{[^{}]*\}\})/).map((part, i) => i % 2 ? part : part.replace(/[\u0000-\u0020"<>`#?]/g, (c) => encodeURIComponent(c))).join('');
  }).join('/') + (end < 0 ? '' : url.slice(end));
}

module.exports = {
  fillPathVariables,
  looksLikeJson,
  impliedContentType, sanitizeVarName, escapeCString, decodeHtmlEntities, buildBaseUrl };
