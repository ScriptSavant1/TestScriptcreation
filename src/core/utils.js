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
 *   public/recorder/recorder-ui.js
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

module.exports = { sanitizeVarName, escapeCString, decodeHtmlEntities, buildBaseUrl };
