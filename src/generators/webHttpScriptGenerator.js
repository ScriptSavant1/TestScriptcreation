/**
 * VuGen Web HTTP/HTML Script Generator
 * Generates classic LoadRunner C-based scripts from Bruno/Postman collections.
 *
 * Output files: Action.c, vuser_init.c, vuser_end.c, globals.h
 * Config files delegated to: WebHttpMandatoryFilesGenerator
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const CorrelationDetector = require('../analyzers/correlationDetector');
const ParameterizationEngine = require('../analyzers/parameterizationEngine');
const AuthenticationHandler = require('../analyzers/authenticationHandler');
const CustomScriptParser = require('../analyzers/customScriptParser');
const WebHttpMandatoryFilesGenerator = require('./webHttpMandatoryFilesGenerator');

class WebHttpScriptGenerator {
  constructor(requests, collection, options = {}) {
    this.requests = requests;
    this.collection = collection;
    this.options = {
      useTransactions: options.useTransactions !== false,
      useCorrelation: options.useCorrelation !== false,
      useParameterization: options.useParameterization !== false,
      useAuthentication: options.useAuthentication !== false,
      useCustomScripts: options.useCustomScripts !== false,
      thinkTime: options.thinkTime || 1,
      groupByFolder: options.groupByFolder !== false,
      addComments: options.addComments !== false,
      logLevel: options.logLevel || 'info',
      ...options
    };

    // Analyzers — same as AdvancedScriptGenerator, reused unchanged
    this.correlationDetector = new CorrelationDetector();
    this.paramEngine = new ParameterizationEngine();
    this.authHandler = new AuthenticationHandler();
    this.scriptParser = new CustomScriptParser();
    this.mandatoryFilesGen = new WebHttpMandatoryFilesGenerator({
      scriptName: this.collection.info?.name || this.collection.name || 'VuGenScript'
    });

    // Analysis results
    this.correlations = [];
    this.parameters = new Map();
    this.customScripts = new Map();
    this.requestIdCounter = 0;

    // Variable classification
    this.variableMap = new Map();
    this.dynamicVarNames = new Set();  // Correlation targets — stored as LR params via reg functions
    this.paramVarNames = new Set();    // Static params from collection → {varName}
    this.scriptSetVarNames = new Set();

    // Transaction names collected during generateGroupedRequests() — passed to .usr file
    this.transactionNames = [];

    this.buildVariableMap();
  }

  // ─── Variable Map ────────────────────────────────────────────────────────────

  buildVariableMap() {
    if (this.collection.variable) {
      this.collection.variable.forEach(v => this.variableMap.set(v.key, v.value));
    }
    if (this.collection.environment) {
      Object.entries(this.collection.environment).forEach(([k, v]) => this.variableMap.set(k, v));
    }
    if (this.options.environmentVars) {
      Object.entries(this.options.environmentVars).forEach(([k, v]) => this.variableMap.set(k, v));
    }
    this.detectScriptSetVariables();
  }

  detectScriptSetVariables() {
    const setPattern = /(?:context|pm\.environment|pm\.collectionVariables|pm\.globals|pm\.variables)\.set\(\s*["']([^"']+)["']/g;
    const scan = (item) => {
      if (item.event && Array.isArray(item.event)) {
        item.event.forEach(ev => {
          if (ev.script && ev.script.exec) {
            const text = Array.isArray(ev.script.exec) ? ev.script.exec.join('\n') : ev.script.exec;
            let m;
            while ((m = setPattern.exec(text)) !== null) this.scriptSetVarNames.add(m[1]);
          }
        });
      }
      const items = item.item || item.items;
      if (Array.isArray(items)) items.forEach(scan);
    };
    scan(this.collection);
  }

  /**
   * Classify variables.
   * NOTE: In Web HTTP/HTML, ALL variables (both correlation targets and static params)
   * use the same {varName} syntax. There is no load.global vs load.params distinction.
   * - Correlation targets → registered via web_reg_save_param_* functions
   * - Static params → defined in ParameterFile.prm, read from collection_data.dat
   */
  classifyVariables() {
    const credentialPattern = /^(username|password|user|email|account|credential|login|pwd|passwd|user_?name|user_?id|user_?email)$/i;

    // Correlation targets are dynamic (set by web_reg_save_param_* at runtime)
    this.correlations.forEach(corr => this.dynamicVarNames.add(corr.name));
    this.scriptSetVarNames.forEach(name => this.dynamicVarNames.add(name));

    for (const [name, value] of this.variableMap.entries()) {
      if (name.startsWith('_') && (value === '' || value === null || value === undefined)) {
        this.dynamicVarNames.add(name);
      }
    }

    // Static params — everything not dynamic
    let usernameParam = null;
    for (const [name] of this.variableMap.entries()) {
      if (this.dynamicVarNames.has(name)) continue;
      if (name.startsWith('$')) continue;
      this.paramVarNames.add(name);
      if (/^(username|user|user_?name|email|login|account)$/i.test(name)) usernameParam = name;
    }

    // Build parameters map for ParameterFile.prm
    for (const name of this.paramVarNames) {
      const value = this.variableMap.get(name);
      const isCredential = credentialPattern.test(name);
      this.parameters.set(name, {
        name,
        type: 'csv',
        fileName: 'collection_data.dat',
        columnName: name,
        nextValue: isCredential ? 'iteration' : 'once',
        nextRow: 'sequential',
        onEnd: 'loop',
        paramValue: value !== undefined && value !== null ? String(value) : ''
      });
    }

    // Link password to username
    if (usernameParam) {
      for (const [name, config] of this.parameters.entries()) {
        if (/^(password|pwd|passwd)$/i.test(name)) {
          config.nextRow = `same as ${usernameParam}`;
        }
      }
    }

    console.log(`✓ Classified variables: ${this.paramVarNames.size} parameterized, ${this.dynamicVarNames.size} dynamic (correlations)`);
  }

  // ─── Main Entry ─────────────────────────────────────────────────────────────

  async generate(outputDir) {
    // 1. Run analysis (same as DevWeb)
    await this.analyze();

    // 2. Generate Action.c first so we can scan it for undeclared parameters
    const actionC = this.generateActionC();

    // 3. Scan generated C code for {varName} references not yet in parameters map.
    //    This catches variables like {version} that appear in request URLs but were
    //    not explicitly declared in the collection's variables section.
    this.scanForUndeclaredParams(actionC);

    // 4. Generate remaining C source files (vuser_init uses this.parameters for logging)
    const vuserInitC = this.generateVuserInitC();
    const vuserEndC  = this.generateVuserEndC();
    const globalsH   = this.generateGlobalsH();

    // 5. Write C files
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    fs.writeFileSync(path.join(outputDir, 'Action.c'), actionC, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'vuser_init.c'), vuserInitC, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'vuser_end.c'), vuserEndC, 'utf8');
    fs.writeFileSync(path.join(outputDir, 'globals.h'), globalsH, 'utf8');

    // 6. Generate config/metadata files (ParameterFile.prm now includes all params)
    await this.mandatoryFilesGen.generateAll(outputDir, this.parameters, this.transactionNames);

    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';
    console.log(`✓ Generated Web HTTP/HTML script: ${outputDir}`);

    return {
      script: actionC,
      analysis: {
        requests: { total: this.requests.length },
        correlations: { totalCorrelations: this.correlations.length },
        parameters: { totalParameters: this.parameters.size },
        authentication: { totalConfigs: 0 }
      },
      mandatoryFiles: true
    };
  }

  async analyze() {
    // Correlations
    if (this.options.useCorrelation) {
      this.correlations = this.correlationDetector.analyzeRequests(this.requests);
      console.log(`✓ Detected ${this.correlations.length} correlations`);
    }

    // Custom scripts (parsed but not emitted in C — stored for potential future use)
    if (this.options.useCustomScripts) {
      this.requests.forEach(req => {
        const preScript = req.event?.find(e => e.listen === 'prerequest')?.script?.exec;
        const testScript = req.event?.find(e => e.listen === 'test')?.script?.exec;
        const preText = Array.isArray(preScript) ? preScript.join('\n') : (preScript || '');
        const testText = Array.isArray(testScript) ? testScript.join('\n') : (testScript || '');
        if (preText || testText) {
          this.customScripts.set(req.id || req.name, {
            preRequest: preText ? this.scriptParser.parsePreRequestScript(preText, req.name) : null,
            test: testText ? this.scriptParser.parseTestScript(testText, req.name) : null
          });
        }
      });
    }

    // Variable classification
    if (this.options.useParameterization) {
      this.classifyVariables();
    }
  }

  // ─── C Source File Generation ────────────────────────────────────────────────

  generateGlobalsH() {
    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';

    // Build a comment listing all static parameters so the engineer knows what's available
    const paramList = this.parameters.size > 0
      ? Array.from(this.parameters.entries())
          .map(([n, c]) => ` *     {${n}}  [${c.nextValue === 'iteration' ? 'per-iteration' : 'once'}]  ${c.paramValue ? `default="${c.paramValue}"` : '(fill in collection_data.dat)'}`)
          .join('\n')
      : ' *     (no static parameters defined)';

    const corrList = this.dynamicVarNames.size > 0
      ? Array.from(this.dynamicVarNames).map(n => ` *     {${n}}  (extracted at runtime by web_reg_save_param_*)`).join('\n')
      : ' *     (no correlation parameters)';

    return `#ifndef _GLOBALS_H
#define _GLOBALS_H

/* -------------------------------------------------------------------------------
 *  Script Title  : ${scriptName}
 *  Protocol      : Web - HTTP/HTML
 *  Generated by  : Bruno to DevWeb Converter v2.3.0
 *
 *  STATIC PARAMETERS  (defined in ParameterFile.prm / collection_data.dat)
${paramList}
 *
 *  CORRELATION PARAMETERS  (captured at runtime via web_reg_save_param_*)
${corrList}
 *
 *  HOW TO UPDATE PARAMETER VALUES
 *    1. Open collection_data.dat in a text editor or Excel.
 *    2. Edit values in the data row(s).  Add more rows for additional data sets.
 *    3. Save and re-run.  No recompile needed.
 *
 *  HOW TO ADD A NEW PARAMETER
 *    1. Add a column header + value to collection_data.dat.
 *    2. Add a [parameter:name] section to ParameterFile.prm.
 *    3. Reference it in Action.c as {name}.
 *
 *  BEST PRACTICES
 *    - Put one-time authentication (OAuth token fetch) in vuser_init().
 *    - Store the token in a global char array declared below, or as an
 *      LR parameter using lr_save_string("{myToken}", "tokenParamName").
 *    - Validate critical parameters in vuser_init() and return -1 on failure.
 *    - Use web_reg_save_param_json() BEFORE the request that produces the value.
 *    - Group logically related requests under lr_start/end_transaction().
 * ------------------------------------------------------------------------------- */

//--------------------------------------------------------------------
// Standard LoadRunner Includes
#include "lrun.h"
#include "web_api.h"
#include "lrw_custom_body.h"

//--------------------------------------------------------------------
// Global Variables
//
// Declare C-level global variables here if you need to share data between
// vuser_init(), Action(), and vuser_end() that cannot be stored as LR params.
//
// Example — store a token fetched in vuser_init() for use in Action():
//   char g_accessToken[2048] = "";
//
// Then in vuser_init():
//   strcpy(g_accessToken, lr_eval_string("{_accessToken}"));
//
// And in Action():
//   web_add_header("Authorization", g_accessToken);

#endif // _GLOBALS_H
`;
  }

  generateVuserInitC() {
    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';

    // Pick the first URL-like parameter to log at startup (helps confirm config loaded)
    let urlParamLog = '';
    for (const [name, config] of this.parameters.entries()) {
      if (/^(url|baseUrl|base_url|host|endpoint|server)$/i.test(name)) {
        urlParamLog = `\n    lr_log_message("  Base URL : %s", lr_eval_string("{${name}}"));`;
        break;
      }
    }

    const paramCount  = this.parameters.size;
    const corrCount   = this.dynamicVarNames.size;

    return `/* -------------------------------------------------------------------------------
 *  Script Title  : ${scriptName}
 *  Protocol      : Web - HTTP/HTML
 *  Generated by  : Bruno to DevWeb Converter v2.3.0
 *
 *  vuser_init() — runs ONCE per Vuser before any iteration.
 *
 *  WHAT TO ADD HERE (per VuGen best practices):
 *    1. Validate that mandatory parameters are populated.
 *    2. Perform one-time authentication (OAuth token fetch, session login).
 *       Store the result via lr_save_string() or a global char array.
 *    3. Load any per-Vuser configuration that must happen before Action().
 * ------------------------------------------------------------------------------- */

vuser_init()
{
    lr_log_message("[init] Vuser %d starting — ${scriptName}", lr_get_vuser_id());
    lr_log_message("  Parameters loaded : ${paramCount} static, ${corrCount} correlation target(s)");${urlParamLog}

    /* ------------------------------------------------------------------
     * Validate critical parameters.
     * Uncomment and adapt as needed — returning -1 aborts this Vuser.
     * ------------------------------------------------------------------ */
    /*
    if (strcmp(lr_eval_string("{url}"), "") == 0) {
        lr_error_message("[init] FATAL: parameter 'url' is empty — check collection_data.dat");
        return -1;
    }
    */

    /* ------------------------------------------------------------------
     * One-time authentication example (OAuth2 client_credentials).
     * Uncomment, adapt the URL/body, and ensure {clientId}/{clientSecret}
     * are set in collection_data.dat before running.
     * ------------------------------------------------------------------ */
    /*
    web_custom_request("OAuth2_Token_Fetch",
        "URL={url}/services/oauth2/token",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Referer=",
        "Mode=HTML",
        "EncType=application/x-www-form-urlencoded",
        "Body=grant_type=client_credentials&client_id={clientId}&client_secret={clientSecret}",
        LAST);

    web_reg_save_param_json("_accessToken",
        "QueryString=$.access_token",
        "Ord=1",
        LAST);
    */

    return 0;
}
`;
  }

  generateVuserEndC() {
    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';
    return `/* -------------------------------------------------------------------------------
 *  Script Title  : ${scriptName}
 *  Protocol      : Web - HTTP/HTML
 *  Generated by  : Bruno to DevWeb Converter v2.3.0
 *
 *  vuser_end() — runs ONCE per Vuser after all iterations complete.
 *
 *  WHAT TO ADD HERE:
 *    1. Logout / session invalidation requests.
 *    2. Release any resources held during the test.
 *    3. Summary logging (total requests, error counts, etc.).
 * ------------------------------------------------------------------------------- */

vuser_end()
{
    lr_log_message("[end] Vuser %d finished — ${scriptName}", lr_get_vuser_id());

    /* ------------------------------------------------------------------
     * Logout example — uncomment and adapt the URL as needed.
     * ------------------------------------------------------------------ */
    /*
    web_custom_request("Logout",
        "URL={url}/services/auth/logout",
        "Method=POST",
        "Resource=0",
        "RecContentType=application/json",
        "Referer=",
        "Mode=HTML",
        "EncType=application/json",
        "Body={}",
        LAST);
    */

    return 0;
}
`;
  }

  generateActionC() {
    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';
    const timestamp = new Date().toISOString();

    let code = `/* -------------------------------------------------------------------------------
    Script Title       : ${scriptName}
    Generated by       : Bruno to DevWeb Converter v2.3.0
    Protocol           : Web - HTTP/HTML
    Generated on       : ${timestamp}
    Total Requests     : ${this.requests.length}
    Correlations       : ${this.correlations.length}
    Parameters         : ${this.parameters.size}
   ------------------------------------------------------------------------------- */

Action()
{
    web_set_sockets_option("SSL_VERSION", "AUTO");

`;

    if (this.options.useTransactions && this.options.groupByFolder) {
      code += this.generateGroupedRequests();
    } else {
      code += this.generateSequentialRequests();
    }

    code += `
    return 0;
}
`;
    return code;
  }

  // ─── Request Grouping ────────────────────────────────────────────────────────

  groupRequestsByFolder() {
    const groups = new Map();
    this.requests.forEach(req => {
      const folder = req.folder || 'Default';
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(req);
    });
    return groups;
  }

  generateGroupedRequests() {
    const groups = this.groupRequestsByFolder();
    let code = '';
    let txIndex = 1;
    this.transactionNames = [];  // Reset on each call

    groups.forEach((requests, folder) => {
      const txName = `T${String(txIndex).padStart(2, '0')}_${this.sanitizeCName(folder)}`;
      this.transactionNames.push(txName);
      txIndex++;

      if (this.options.addComments) {
        code += `    /* ---- ${folder} ---- */\n`;
      }
      code += `    lr_start_transaction("${txName}");\n\n`;

      requests.forEach((request, idx) => {
        code += this.generateRequestBlock(request, 1);

        // Think time between requests (not after the last one in a group)
        if (idx < requests.length - 1 && this.options.thinkTime > 0) {
          code += `\n    lr_think_time(${this.options.thinkTime});\n`;
        }
        code += '\n';
      });

      code += `    lr_end_transaction("${txName}", LR_AUTO);\n`;

      // Think time between transaction groups
      if (this.options.thinkTime > 0) {
        code += `    lr_think_time(${this.options.thinkTime});\n`;
      }
      code += '\n';
    });

    return code;
  }

  generateSequentialRequests() {
    let code = '';
    this.requests.forEach((request, idx) => {
      code += this.generateRequestBlock(request, 1);

      if (idx < this.requests.length - 1 && this.options.thinkTime > 0) {
        code += `\n    lr_think_time(${this.options.thinkTime});\n`;
      }
      code += '\n';
    });
    return code;
  }

  // ─── Single Request Block ────────────────────────────────────────────────────

  /**
   * Generate C code for one request:
   *   1. web_reg_save_param_* calls (correlation registrations) — BEFORE the request
   *   2. web_add_header() calls — immediately before the request
   *   3. web_url() or web_custom_request()
   *   4. lr_output_message() log
   */
  generateRequestBlock(request, indentLevel = 1) {
    const indent = '    '.repeat(indentLevel);
    let code = '';

    if (this.options.addComments) {
      code += `${indent}/* ${request.name} */\n`;
    }

    // 1. Correlation registrations (must come BEFORE the producing request)
    code += this.generateCorrelationRegistrations(request, indent);

    // 2. Headers
    code += this.generateAddHeaders(request, indent);

    // 3. Web function
    code += this.generateWebFunction(request, indent);

    // 4. Log
    code += `${indent}lr_output_message("${this.sanitizeCName(request.name)} - completed");\n`;

    return code;
  }

  // ─── Correlation ─────────────────────────────────────────────────────────────

  generateCorrelationRegistrations(request, indent) {
    const produced = this.correlations.filter(c =>
      c.producerRequest === request.name || c.producerRequest === request.id
    );
    if (produced.length === 0) return '';

    let code = '';
    produced.forEach(corr => {
      switch (corr.type) {
        case 'json':
        case 'token':
        case 'id':
        case 'sessionId':
          code += `${indent}web_reg_save_param_json("${corr.name}",\n`;
          code += `${indent}    "QueryString=${corr.extractPath || '$.value'}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;

        case 'boundary':
        case 'csrf':
          code += `${indent}web_reg_save_param("${corr.name}",\n`;
          if (corr.leftBoundary) code += `${indent}    "LB=${this.escapeCString(corr.leftBoundary)}",\n`;
          if (corr.rightBoundary) code += `${indent}    "RB=${this.escapeCString(corr.rightBoundary)}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;

        case 'regex':
        case 'regexp':
          code += `${indent}web_reg_save_param_regexp("${corr.name}",\n`;
          code += `${indent}    "RegExp=${this.escapeCString(corr.pattern || '([^&]+)')}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;

        default:
          // Fallback: use JSON path extraction
          code += `${indent}web_reg_save_param_json("${corr.name}",\n`;
          code += `${indent}    "QueryString=$.${corr.name}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
      }
    });
    return code;
  }

  // ─── Headers ─────────────────────────────────────────────────────────────────

  generateAddHeaders(request, indent) {
    const headers = [];

    // Collection-level headers
    if (this.collection.collectionHeaders) {
      this.collection.collectionHeaders.forEach(h => {
        if (h.key && h.value && !h.disabled) headers.push(h);
      });
    }

    // Request-level headers
    if (request.headers && Array.isArray(request.headers)) {
      request.headers.forEach(h => {
        if (h.key && h.value && !h.disabled) headers.push(h);
      });
    }

    // Auth header injection
    const authHeader = this.getAuthHeader(request);
    if (authHeader) headers.push(authHeader);

    if (headers.length === 0) return '';

    return headers.map(h =>
      `${indent}web_add_header("${h.key}", "${this.replaceParameters(String(h.value))}");\n`
    ).join('');
  }

  getAuthHeader(request) {
    const auth = request.auth || this.collection.auth;
    if (!auth || !auth.type || auth.type === 'noauth') return null;

    switch (auth.type) {
      case 'bearer': {
        const tokenEntry = (auth.bearer || []).find(e => e.key === 'token');
        if (tokenEntry) {
          return { key: 'Authorization', value: `Bearer ${tokenEntry.value}` };
        }
        break;
      }
      case 'apikey': {
        const keyName = (auth.apikey || []).find(e => e.key === 'key')?.value;
        const keyVal = (auth.apikey || []).find(e => e.key === 'value')?.value;
        const placement = (auth.apikey || []).find(e => e.key === 'in')?.value;
        if (keyName && keyVal && placement !== 'query') {
          return { key: keyName, value: keyVal };
        }
        break;
      }
    }
    return null;
  }

  // ─── Web Functions ────────────────────────────────────────────────────────────

  generateWebFunction(request, indent) {
    const method = (request.method || 'GET').toUpperCase();
    const url = this.buildUrl(request);
    const contentType = this.getContentType(request);

    if (method === 'GET' || method === 'HEAD') {
      return this.generateWebUrl(request, url, indent);
    } else {
      return this.generateWebCustomRequest(request, url, method, contentType, indent);
    }
  }

  generateWebUrl(request, url, indent) {
    let code = `${indent}web_url("${this.sanitizeCName(request.name)}",\n`;
    code += `${indent}    "URL=${url}",\n`;
    code += `${indent}    "Resource=0",\n`;
    code += `${indent}    "RecContentType=application/json",\n`;
    code += `${indent}    "Referer=",\n`;
    code += `${indent}    "Mode=HTML",\n`;
    code += `${indent}    LAST);\n`;
    return code;
  }

  generateWebCustomRequest(request, url, method, contentType, indent) {
    const body = this.generateBodyForC(request);

    let code = `${indent}web_custom_request("${this.sanitizeCName(request.name)}",\n`;
    code += `${indent}    "URL=${url}",\n`;
    code += `${indent}    "Method=${method}",\n`;
    code += `${indent}    "Resource=0",\n`;
    code += `${indent}    "RecContentType=application/json",\n`;
    code += `${indent}    "Referer=",\n`;
    code += `${indent}    "Mode=HTML",\n`;

    if (contentType) {
      code += `${indent}    "EncType=${contentType}",\n`;
    }
    if (body) {
      code += `${indent}    "Body=${body}",\n`;
    }

    code += `${indent}    LAST);\n`;
    return code;
  }

  // ─── URL & Body ──────────────────────────────────────────────────────────────

  buildUrl(request) {
    let url = request.url || '';

    // Split off query string manually (never use new URL() — breaks {{variables}})
    const qIdx = url.indexOf('?');
    let base = qIdx >= 0 ? url.substring(0, qIdx) : url;
    let query = qIdx >= 0 ? url.substring(qIdx + 1) : '';

    // Merge explicit query params from request.query
    if (request.query && Array.isArray(request.query)) {
      const enabled = request.query.filter(q => !q.disabled && q.key);
      if (enabled.length > 0) {
        const qStr = enabled.map(q =>
          `${encodeURIComponent(q.key)}=${this.vuGenEncodeValue(q.value || '')}`
        ).join('&');
        query = query ? `${query}&${qStr}` : qStr;
      }
    }

    const fullUrl = query ? `${base}?${query}` : base;
    return this.replaceParameters(fullUrl);
  }

  generateBodyForC(request) {
    if (!request.body) return null;

    const { mode, raw, urlencoded, formdata } = request.body;

    if (mode === 'raw' && raw) {
      // Try to parse as JSON object, then re-serialize with escaped quotes
      try {
        const parsed = JSON.parse(raw);
        return this.jsonToCString(parsed);
      } catch {
        // Not JSON — treat as raw string
        return this.escapeCBodyString(this.replaceParameters(raw));
      }
    }

    if (mode === 'urlencoded' && urlencoded) {
      const parts = urlencoded
        .filter(p => !p.disabled && p.key)
        .map(p => `${encodeURIComponent(p.key)}=${this.vuGenEncodeValue(p.value || '')}`);
      return parts.join('&');
    }

    if (mode === 'formdata' && formdata) {
      // Multipart not directly representable in web_custom_request Body=
      // Return comment placeholder
      return null;
    }

    return null;
  }

  /**
   * Convert a parsed JSON object to a C string literal with escaped double quotes.
   * All {{variable}} references are converted to {variable} (LR param syntax).
   * Example: { "user": "{{username}}" } → {\"user\":\"{username}\"}
   */
  jsonToCString(obj) {
    const jsonStr = JSON.stringify(obj);
    const withParams = this.replaceParameters(jsonStr);
    return this.escapeCBodyString(withParams);
  }

  /**
   * Escape a string for use as a C "Body=..." parameter value.
   * Replaces " with \" so the C compiler accepts it.
   */
  escapeCBodyString(str) {
    return str.replace(/"/g, '\\"');
  }

  /**
   * Escape a string for use in other C string literals.
   */
  escapeCString(str) {
    return String(str)
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
  }

  getContentType(request) {
    if (!request.headers) return null;
    const ct = request.headers.find(h =>
      h.key && h.key.toLowerCase() === 'content-type' && !h.disabled
    );
    if (ct) return ct.value;

    // Infer from body mode
    if (request.body?.mode === 'raw') return 'application/json';
    if (request.body?.mode === 'urlencoded') return 'application/x-www-form-urlencoded';
    return null;
  }

  // ─── Undeclared Parameter Scanner ───────────────────────────────────────────

  /**
   * Scan generated C code for {varName} references that are NOT already in the
   * parameters map or dynamic-vars set.
   *
   * Why: A collection may use {{version}} in a URL but not define it as a collection
   * variable. replaceParameters() converts it to {version} in the C code, but
   * classifyVariables() never saw it (it wasn't in the variable map). Without this
   * scan, {version} would appear in Action.c but have no entry in ParameterFile.prm
   * or collection_data.dat — causing VuGen to leave {version} as literal text.
   *
   * Pattern: LR parameter references are {word} — a word starting with a letter or
   * underscore, containing only alphanumeric chars and underscores.
   * Underscore-prefixed vars ({_accessToken}) are correlation targets — skip them.
   * Single-letter format specifiers (%d → "d") are guarded against by the alpha-only
   * check (they never appear as {d} in properly generated code anyway).
   */
  scanForUndeclaredParams(cCode) {
    const varPattern = /\{([a-zA-Z][a-zA-Z0-9_]*)\}/g;
    const credentialPattern = /^(username|password|user|email|account|credential|login|pwd|passwd|user_?name|user_?id|user_?email)$/i;
    let match;
    let added = 0;

    while ((match = varPattern.exec(cCode)) !== null) {
      const varName = match[1];

      // Skip already-classified variables
      if (this.parameters.has(varName))      continue;
      if (this.dynamicVarNames.has(varName)) continue;

      // Add to parameters map so it appears in ParameterFile.prm and collection_data.dat
      const isCredential = credentialPattern.test(varName);
      this.parameters.set(varName, {
        name:       varName,
        type:       'csv',
        fileName:   'collection_data.dat',
        columnName: varName,
        nextValue:  isCredential ? 'iteration' : 'once',
        nextRow:    'sequential',
        onEnd:      'loop',
        paramValue: ''  // empty — user must fill in collection_data.dat
      });
      added++;
    }

    if (added > 0) {
      console.log(`  ⚠  Auto-detected ${added} undeclared parameter(s) in Action.c — added to ParameterFile.prm with empty values. Fill them in collection_data.dat.`);
    }
  }

  // ─── Parameter Replacement ───────────────────────────────────────────────────

  /**
   * Replace {{variableName}} with {variableName} (VuGen LR parameter syntax).
   * Both correlation targets and static params use the same {varName} syntax in C.
   */
  replaceParameters(str) {
    if (!str || typeof str !== 'string') return str;

    return str.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const trimmed = varName.trim();
      // Skip Postman built-in dynamic variables
      if (trimmed.startsWith('$')) return match;
      return `{${trimmed}}`;
    });
  }

  /**
   * URL-encode a value for use in VuGen Web HTTP/HTML context.
   * Encodes special characters but preserves {varName} LR parameter placeholders —
   * these must stay unencoded so VuGen can substitute parameter values at runtime.
   *
   * Example: "{{clientId}}" → replaceParameters → "{clientId}"
   *          → encodeURIComponent → "%7BclientId%7D"   ← WRONG
   *          → restore braces    → "{clientId}"        ← CORRECT
   */
  vuGenEncodeValue(str) {
    if (str === null || str === undefined) return str;
    const withParams = this.replaceParameters(String(str));
    return encodeURIComponent(withParams)
      .replace(/%7B/gi, '{')
      .replace(/%7D/gi, '}');
  }

  // ─── Utilities ────────────────────────────────────────────────────────────────

  /**
   * Create a safe C identifier: spaces and non-alphanumeric chars → underscores.
   */
  sanitizeCName(name) {
    return String(name)
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .replace(/^[0-9]+/, '')  // C identifiers cannot start with a digit
      || 'request';
  }
}

module.exports = WebHttpScriptGenerator;
