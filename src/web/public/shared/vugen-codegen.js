/**
 * VuGen Web HTTP/HTML Correlation Code Emitters
 *
 * SINGLE SOURCE OF TRUTH for all web_reg_save_param* syntax rules.
 *
 * Why this module exists:
 *   The web_reg_save_param bug (June 2026) existed in webHttpScriptGenerator.js
 *   AND VuGen-Script-Studio-app.js simultaneously. The same fix had to be applied
 *   in two places. This module ensures that VuGen syntax rules live in ONE file —
 *   any change propagates to every tool automatically.
 *
 * VuGen 26.1 syntax rules encoded here:
 *   web_reg_save_param        → plain name as 1st arg (NOT "ParamName=")
 *                               Attributes: LB=, RB=, Search=, Ord=
 *   web_reg_save_param_json   → "ParamName=xxx" as 1st arg
 *                               Attributes: QueryString=
 *   web_reg_save_param_regexp → "ParamName=xxx" as 1st arg
 *                               Attributes: RegExp=, Group=, Scope= (NOT Search=),
 *                                           Ordinal= (NOT Ord=)
 *   web_reg_save_param_xpath  → "ParamName=xxx" as 1st arg
 *                               Attributes: QueryString= (NOT XPath=), no Ord=
 *
 * UMD pattern: loads in Node.js (require) AND browser (<script> tag).
 *   Node.js: const _vugen = require('../core/vugenCodegen');
 *   Browser: loads shared/vugen-codegen.js → window.VugenCodegen
 *
 * Consumers:
 *   generators/webHttpScriptGenerator.js  → _vugen.*
 *   web/public/VuGen-Script-Studio-app.js → VugenCodegen.*
 *
 * @see Docs/REARCHITECTURE-PLAN.md — Phase 3
 * @see https://admhelp.microfocus.com/vugen/en/26.1/help/function_reference/
 */

/* eslint-disable no-var */
(function (exports) {
  'use strict';

  // ── Internal helper ─────────────────────────────────────────────────────────
  // Escape a value for use inside a VuGen C double-quoted string.
  // Identical to core/utils.js escapeCString — inlined here so this module is
  // self-contained when loaded as a browser <script> without needing utils.js.
  function esc(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  // ── Scope mapping helpers ───────────────────────────────────────────────────

  /**
   * Map a JMX extractor scope string → VuGen Search= attribute value.
   * Used with web_reg_save_param (boundary extractor).
   * Search=Body is the VuGen default — omit the attribute for body scope.
   *
   * @param  {string} scope  JMX scope: 'response_headers', 'url', 'body', etc.
   * @returns {string}       VuGen Search= value, or '' to omit the attribute.
   */
  function vugenSearchFilter(scope) {
    var map = {
      response_headers: 'Headers',
      request_headers:  'Headers',
      headers:          'Headers',   // legacy alias
      url:              'Noresource' // closest VuGen equivalent
      // body / blank → '' → attribute omitted (VuGen default is Body)
    };
    return map[(scope || '').toLowerCase()] || '';
  }

  /**
   * Map a JMX extractor scope string → VuGen Scope= attribute value.
   * Used with web_reg_save_param_regexp.
   * Note: regexp uses "Scope=" NOT "Search=", and the valid values differ.
   *
   * @param  {string} scope  JMX scope string
   * @returns {string}       VuGen Scope= value, or '' to omit the attribute.
   */
  function vugenRegexpScope(scope) {
    var map = {
      response_headers: 'Headers',
      request_headers:  'Headers',
      headers:          'Headers',
      url:              'All'        // no URL-only scope in regexp; use All
      // body / blank → '' → attribute omitted (default is Body)
    };
    return map[(scope || '').toLowerCase()] || '';
  }

  // ── Emission primitives ─────────────────────────────────────────────────────

  /**
   * Emit a web_reg_save_param() call (boundary / header / cookie extractor).
   *
   * FIRST ARG: plain parameter name — NOT "ParamName=xxx".
   * ATTRIBUTES: LB=, RB=, Search=, Ord=
   *
   * @param {string} name     VuGen parameter name (the value saved at runtime)
   * @param {object} options
   *   @param {string}  [options.lb]       Left boundary string (optional)
   *   @param {string}  [options.rb]       Right boundary string (optional)
   *   @param {string}  [options.search]   Search= value: 'Headers', 'Noresource', etc.
   *                                       Omit or pass '' for default (Body).
   *   @param {number}  [options.ord=1]    Ord= value (which occurrence, 1-based)
   * @param {string} indent   Base indentation string for the opening line
   * @returns {string}        C code fragment to insert before the request
   */
  function emitBoundary(name, options, indent) {
    var t  = indent || '  ';
    var ti = t + '    ';
    var o  = options || {};
    var lb = o.lb;
    var rb = o.rb;
    var search = o.search;
    var ord = o.ord !== undefined ? o.ord : 1;

    var s = t + 'web_reg_save_param("' + name + '",\n';
    if (lb) s += ti + '"LB=' + esc(lb) + '",\n';
    if (rb) s += ti + '"RB=' + esc(rb) + '",\n';
    if (search) s += ti + '"Search=' + search + '",\n';
    s += ti + '"Ord=' + ord + '",\n';
    s += ti + 'LAST);\n';
    return s;
  }

  /**
   * Emit a web_reg_save_param_json() call.
   *
   * FIRST ARG: "ParamName=xxx" format (required by this function variant).
   * ATTRIBUTES: QueryString=
   *
   * @param {string} name      VuGen parameter name
   * @param {string} jsonPath  JSONPath expression (e.g. '$.access_token')
   * @param {string} indent    Base indentation string
   * @returns {string}         C code fragment
   */
  function emitJson(name, jsonPath, indent) {
    var t  = indent || '  ';
    var ti = t + '    ';
    return t  + 'web_reg_save_param_json("ParamName=' + name + '",\n' +
           ti + '"QueryString=' + jsonPath + '",\n' +
           ti + 'LAST);\n';
  }

  /**
   * Emit a web_reg_save_param_json() call with SelectAll=Yes.
   * All matching array values are saved as name_1, name_2, … and name_count holds the total.
   * Use when the JSON path targets an array and every element should be captured.
   *
   * @param {string} name      VuGen parameter name
   * @param {string} jsonPath  JSONPath expression targeting an array (e.g. '$.items[*].id')
   * @param {string} indent    Base indentation string
   * @returns {string}         C code fragment
   */
  function emitJsonAll(name, jsonPath, indent) {
    var t  = indent || '  ';
    var ti = t + '    ';
    return t  + 'web_reg_save_param_json("ParamName=' + name + '",\n' +
           ti + '"QueryString=' + jsonPath + '",\n' +
           ti + '"SelectAll=Yes",\n' +
           ti + 'LAST);\n';
  }

  /**
   * Emit a web_reg_save_param_regexp() call.
   *
   * FIRST ARG: "ParamName=xxx" format.
   * ATTRIBUTES: RegExp=, Group=, Scope= (NOT Search=), Ordinal= (NOT Ord=).
   *
   * @param {string} name     VuGen parameter name
   * @param {object} options
   *   @param {string}  options.pattern     Regular expression string
   *   @param {number}  [options.group=1]   Capture group index (0-10)
   *   @param {string}  [options.scope]     Scope= value: 'Headers', 'All', etc.
   *   @param {number}  [options.ordinal=1] Ordinal= value (which match, 1-based)
   * @param {string} indent   Base indentation string
   * @returns {string}        C code fragment
   */
  function emitRegexp(name, options, indent) {
    var t  = indent || '  ';
    var ti = t + '    ';
    var o  = options || {};
    var group   = o.group   !== undefined ? o.group   : 1;
    var ordinal = o.ordinal !== undefined ? o.ordinal : 1;

    var s = t  + 'web_reg_save_param_regexp("ParamName=' + name + '",\n' +
            ti + '"RegExp=' + esc(o.pattern || '') + '",\n' +
            ti + '"Group=' + group + '",\n';
    if (o.scope) s += ti + '"Scope=' + o.scope + '",\n';
    s += ti + '"Ordinal=' + ordinal + '",\n' +
         ti + 'LAST);\n';
    return s;
  }

  /**
   * Emit a web_reg_save_param_xpath() call.
   *
   * FIRST ARG: "ParamName=xxx" format.
   * ATTRIBUTES: QueryString= (NOT XPath=). No Ord= — use SelectAll=Yes for multiple.
   *
   * @param {string} name        VuGen parameter name
   * @param {string} xpathQuery  XPath expression (e.g. '//token')
   * @param {string} indent      Base indentation string
   * @returns {string}           C code fragment
   */
  function emitXpath(name, xpathQuery, indent) {
    var t  = indent || '  ';
    var ti = t + '    ';
    return t  + 'web_reg_save_param_xpath("ParamName=' + name + '",\n' +
           ti + '"QueryString=' + esc(xpathQuery) + '",\n' +
           ti + 'LAST);\n';
  }

  // ── Exports ─────────────────────────────────────────────────────────────────
  exports.emitBoundary      = emitBoundary;
  exports.emitJson          = emitJson;
  exports.emitJsonAll       = emitJsonAll;
  exports.emitRegexp        = emitRegexp;
  exports.emitXpath         = emitXpath;
  exports.vugenSearchFilter = vugenSearchFilter;
  exports.vugenRegexpScope  = vugenRegexpScope;
  exports.escapeCString     = esc; // exposed so callers don't need core/utils too

})(
  // UMD: works in Node.js (module.exports) and browser (window.VugenCodegen)
  typeof module !== 'undefined'
    ? module.exports
    : (typeof globalThis !== 'undefined'
        ? (globalThis.VugenCodegen = {})
        : (this.VugenCodegen = {}))  // IE11 / old environments fallback
);
