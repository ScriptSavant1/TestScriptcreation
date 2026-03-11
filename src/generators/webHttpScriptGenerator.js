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

    // Large base64 data extraction (mirrors advancedScriptGenerator pattern for VuGen)
    // VuGen C uses BodyFilePath= instead of Body= for large data files.
    // BodyFilePath= reads the file at runtime and performs {param} substitution within it.
    this.extractedDataFiles = new Map(); // hash → { varName, fileName, content, size, usedBy[] }
    this.largeValueIndex = new Map();    // "requestName::__raw__|__json__" → hash
    this.BASE64_THRESHOLD = 500;

    // Transaction names collected during generateGroupedRequests() — passed to .usr file
    this.transactionNames = [];

    // Snapshot counter — increments for every web_url/web_custom_request in Action.c.
    // VuGen uses "Snapshot=tN.inf" to record/display the response for each request.
    // The counter is sequential across the entire script: t1, t2, t3, ...
    this.snapshotCounter = 0;

    // JWT detection — set in detectJwtUsage() after script scanning
    this.hasJwt = false;
    this.jwtVarNames = [];    // variable names the pre-request script stores the token into

    // Per-request dynamic variables (UUID/nonce/random generated fresh per request)
    this.perRequestVars = new Map(); // varName → { generationType, requestNames[] }

    this.buildVariableMap();
  }

  /**
   * Detect proxy configuration from collection variables or environment.
   * Identical logic to advancedScriptGenerator.detectProxyConfig().
   * @returns {{ enabled:true, host:string, port:number, username:string, password:string }|null}
   */
  detectProxyConfig() {
    const urlVarNames  = ['proxy','proxyUrl','proxy_url','proxyURI','proxy_uri',
                          'http_proxy','HTTP_PROXY','https_proxy','HTTPS_PROXY',
                          'proxyServer','proxy_server','httpProxy','httpsProxy'];
    const hostVarNames = ['proxyHost','proxy_host','proxyHostname'];
    const portVarNames = ['proxyPort','proxy_port'];
    const userVarNames = ['proxyUser','proxy_user','proxyUsername','proxy_username','proxyUserName'];
    const passVarNames = ['proxyPassword','proxy_password','proxyPass','proxy_pass'];

    const get = (names) => {
      for (const n of names) {
        const v = this.variableMap.get(n);
        if (v && String(v).trim()) return String(v).trim();
      }
      return '';
    };

    for (const name of urlVarNames) {
      const raw = this.variableMap.get(name);
      if (!raw || !String(raw).trim()) continue;
      const val = String(raw).trim();
      try {
        const urlStr = val.startsWith('http') ? val : `http://${val}`;
        const u = new URL(urlStr);
        const host     = u.hostname;
        const port     = u.port ? parseInt(u.port) : 8080;
        const username = decodeURIComponent(u.username || '') || get(userVarNames);
        const password = decodeURIComponent(u.password || '') || get(passVarNames);
        if (host) {
          console.log(`  ✓ Proxy detected: ${host}:${port}${username ? ' (authenticated)' : ''}`);
          return { enabled: true, host, port, username, password };
        }
      } catch {
        if (val.includes(':')) {
          const [host, rawPort] = val.split(':');
          const port = parseInt(rawPort) || 8080;
          if (host && host.includes('.')) {
            console.log(`  ✓ Proxy detected: ${host}:${port}`);
            return { enabled: true, host, port, username: get(userVarNames), password: get(passVarNames) };
          }
        }
      }
    }

    const host = get(hostVarNames);
    if (host) {
      const port = parseInt(get(portVarNames)) || 8080;
      console.log(`  ✓ Proxy detected: ${host}:${port}`);
      return { enabled: true, host, port, username: get(userVarNames), password: get(passVarNames) };
    }

    return null;
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
    // All Postman + Bruno runtime variable setter APIs — groups: 1=pm.*/context, 2=bru.set*, 3=env/vars legacy
    // Groups: 1=pm.*/context, 2=bru.set*, 3=env/vars legacy
    const setPattern = /(?:context|pm\.environment|pm\.collectionVariables|pm\.globals|pm\.variables)\.set\s*\(\s*["']([^"']+)["']|bru\.(?:setEnv|setEnvVar|setVar|setGlobalVar|setNextEnvVar)\s*\(\s*["']([^"']+)["']|(?:^|[^a-zA-Z0-9_$])(?:env|vars)\.set\s*\(\s*["']([^"']+)["']/gm;
    const scan = (item) => {
      // Support both raw collection (item.event) and normalized request (item.tests)
      const events = item.event || item.tests || [];
      if (Array.isArray(events)) {
        events.forEach(ev => {
          if (ev.script && ev.script.exec) {
            const text = Array.isArray(ev.script.exec) ? ev.script.exec.join('\n') : ev.script.exec;
            let m;
            while ((m = setPattern.exec(text)) !== null) {
              const varName = m[1] || m[2] || m[3];
              if (varName) this.scriptSetVarNames.add(varName);
            }
          }
        });
      }
      const items = item.item || item.items;
      if (Array.isArray(items)) items.forEach(scan);
    };
    scan(this.collection);
    // Also scan normalized requests (req.tests = brunoParser normalized events)
    this.requests.forEach(req => {
      const events = req.tests || req.event || [];
      events.forEach(ev => {
        if (ev.script && ev.script.exec) {
          const text = Array.isArray(ev.script.exec) ? ev.script.exec.join('\n') : ev.script.exec;
          let m;
          while ((m = setPattern.exec(text)) !== null) {
            const varName = m[1] || m[2] || m[3];
            if (varName) this.scriptSetVarNames.add(varName);
          }
        }
      });
    });
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

    // RULE 1 — Correlation targets → dynamic (VuGen: web_reg_save_param_* handles them)
    this.correlations.forEach(corr => this.dynamicVarNames.add(corr.name));

    // RULE 2 — Script-set variables → dynamic
    this.scriptSetVarNames.forEach(name => this.dynamicVarNames.add(name));

    // RULE 3 — _ prefix → always dynamic
    for (const [name] of this.variableMap.entries()) {
      if (name.startsWith('_')) this.dynamicVarNames.add(name);
    }

    // RULE 4 (GENERIC) — Empty value in collection/environment → dynamic.
    // Static params always have real values. Runtime vars are left empty intentionally.
    for (const [name, value] of this.variableMap.entries()) {
      if (this.dynamicVarNames.has(name)) continue;
      if (name.startsWith('$')) continue;
      const isEmpty = value === '' || value === null || value === undefined;
      if (isEmpty && !credentialPattern.test(name)) {
        this.dynamicVarNames.add(name);
      }
    }

    // RULE 5 — Everything with a real value → static param (ParameterFile.prm / collection_data.dat)
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

    // JWT output vars remain in dynamicVarNames (Tier 1).
    // web_js_run("ResultParam=jwt_token") in Action.c sets {jwt_token} dynamically at runtime
    // via VuGen's built-in JavaScript engine — no CSV entry needed.
    // Note: {jwt_token} uses NO underscore (web_js_run ResultParam convention differs from
    // web_reg_save_param_* which uses the _ prefix correlation convention).

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

    // 6. Write extracted base64/body data files to data/ subfolder
    if (this.extractedDataFiles.size > 0) {
      const dataDir = path.join(outputDir, 'data');
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      for (const [, fileInfo] of this.extractedDataFiles.entries()) {
        fs.writeFileSync(path.join(dataDir, fileInfo.fileName), fileInfo.content, 'utf8');
        console.log(`✓ Extracted: data/${fileInfo.fileName} (${(fileInfo.size / 1024).toFixed(1)} KB, used by ${fileInfo.usedBy.length} request(s))`);
      }
    }

    // 7. Generate config/metadata files — pass data file names so they appear in .usr and ScriptUploadMetadata.xml
    const dataFileNames = Array.from(this.extractedDataFiles.values()).map(f => f.fileName);
    await this.mandatoryFilesGen.generateAll(
      outputDir, this.parameters, this.transactionNames, dataFileNames,
      this.hasJwt, this.detectProxyConfig()
    );

    // 8. If JWT detected: copy jsrsasign.js + transport.pem from project root.
    //    jsrsasign.js is the JWT signing library for VuGen (listed in [ManuallyExtraFiles]).
    //    transport.pem is the private key file used for signing.
    if (this.hasJwt) {
      const PROJECT_ROOT = path.join(__dirname, '..', '..');
      const jsrsasignSrc = path.join(PROJECT_ROOT, 'jsrsasign.js');
      if (fs.existsSync(jsrsasignSrc)) {
        fs.copyFileSync(jsrsasignSrc, path.join(outputDir, 'jsrsasign.js'));
        console.log('✓ Copied jsrsasign.js');
      } else {
        console.warn('  ⚠  jsrsasign.js not found in project root. Add it there and re-run.');
      }

      // Copy transport.pem from project root
      const pemSrc = path.join(PROJECT_ROOT, 'transport.pem');
      if (fs.existsSync(pemSrc)) {
        fs.copyFileSync(pemSrc, path.join(outputDir, 'transport.pem'));
        console.log('✓ Copied transport.pem');
      }
    }

    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';
    console.log(`✓ Generated Web HTTP/HTML script "${scriptName}": ${outputDir}`);

    return {
      script: actionC,
      analysis: {
        requests: { total: this.requests.length },
        correlations: { totalCorrelations: this.correlations.length },
        parameters: { totalParameters: this.parameters.size },
        authentication: { totalConfigs: 0 }
      },
      mandatoryFiles: true,
      extractedDataFiles: dataFileNames
    };
  }

  async analyze() {
    // Correlations
    if (this.options.useCorrelation) {
      this.correlations = this.correlationDetector.analyzeRequests(this.requests);
      console.log(`✓ Detected ${this.correlations.length} correlations`);
    }

    // Custom scripts — parsed for variable detection and JWT fingerprinting.
    // brunoParser normalizes Postman/Bruno events into req.tests[] (listen + script).
    // Some code paths store them as req.event[]. Support both to be generic.
    if (this.options.useCustomScripts) {
      this.requests.forEach(req => {
        const events = req.tests || req.event || [];
        const preScript = events.find(e => e.listen === 'prerequest')?.script?.exec;
        const testScript = events.find(e => e.listen === 'test')?.script?.exec;
        const preText = Array.isArray(preScript) ? preScript.join('\n') : (preScript || '');
        const testText = Array.isArray(testScript) ? testScript.join('\n') : (testScript || '');

        if (preText || testText) {
          this.customScripts.set(req.id || req.name, {
            preRequest: preText ? this.scriptParser.parsePreRequestScript(preText, req.name) : null,
            test: testText ? this.scriptParser.parseTestScript(testText, req.name) : null
          });

          // JWT detection — scan PRE-REQUEST scripts ONLY for jsrsasign / JWT signing patterns.
          // The test script handles response extraction (access_token, refresh_token) — those
          // are correlations, not JWT output vars, and must NOT be added to jwtVarNames.
          if (preText) {
            const jwtInfo = CustomScriptParser.detectJwtUsage(preText);
            if (jwtInfo.isJwt) {
              this.hasJwt = true;
              this.jwtVarNames.push(...jwtInfo.outputVars);
              // JWT output vars are reclassified as static params in classifyVariables()
              // so they appear in ParameterFile.prm for the user to pre-populate.
              console.log(`  ✓ JWT detected in "${req.name}" (library: ${jwtInfo.library}, algorithm: ${jwtInfo.algorithm})`);
            }
          }

          // Per-request dynamic vars (UUID/nonce/random generated per request — not from responses)
          const perReqVars = CustomScriptParser.detectPerRequestDynamicVars(preText);
          perReqVars.forEach(({ varName, generationType }) => {
            if (!this.perRequestVars.has(varName)) {
              this.perRequestVars.set(varName, { generationType, requestNames: [] });
              this.scriptSetVarNames.add(varName); // ensure Tier 1 dynamic, never parameterized
            }
            this.perRequestVars.get(varName).requestNames.push(req.name);
          });
        }
      });
    }

    // Variable classification
    if (this.options.useParameterization) {
      this.classifyVariables();
    }

    // CSRF/XSRF header detection — scan all request headers for known CSRF pattern names.
    // If a header key matches the CSRF pattern AND its value is a template variable,
    // mark the variable as per-request generated using gen_csrf_token() in C.
    this.requests.forEach(req => {
      (req.headers || []).filter(h => h.key && h.value && !h.disabled).forEach(h => {
        if (!CustomScriptParser.isCsrfHeaderName(h.key)) return;

        // Extract the variable name from the header value {{varName}}
        const m = String(h.value).match(/\{\{([^}]+)\}\}/);
        if (!m) return;
        const varName = m[1].trim();

        // Only mark as per-request if it's not already classified and not a static param
        if (this.perRequestVars.has(varName)) return;
        if (this.parameters.has(varName)) return;

        this.perRequestVars.set(varName, { generationType: 'csrf', requestNames: [req.name] });
        this.scriptSetVarNames.add(varName);  // ensure Tier 1 dynamic, never in ParameterFile.prm
        console.log(`  ✓ CSRF header "${h.key}" → per-request gen_csrf_token("_${varName}")`);
      });
    });

    // Large base64 extraction — scan after parameterization so replaceParameters() works
    this.scanForLargeBase64();
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
// Utility Macros
//--------------------------------------------------------------------

/*
 * ─── Per-Request Dynamic Value Generators ───────────────────────────────────
 *
 * These functions are called BEFORE each web_add_header() for headers that
 * require a fresh value on every request (interaction IDs, CSRF tokens, nonces).
 *
 * All functions store the generated value as an LR parameter so it can be
 * referenced in headers and request bodies using the {_paramName} syntax.
 *
 * Pattern is taken from VuGen Script Studio correlation engine.
 *
 * ─────────────────────────────────────────────────────────────────────────── */

/*
 * gen_uuid(param_name)
 *
 * Generates a UUID v4 formatted string and stores it as an LR parameter.
 * Format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx (RFC 4122 v4 pattern)
 *
 * Use for: x-fapi-interaction-id, x-request-id, x-correlation-id, jti, etc.
 *
 * Example:
 *     gen_uuid("_interaction_id");
 *     web_add_header("x-fapi-interaction-id", "{_interaction_id}");
 */
static void gen_uuid(const char *param_name) {
    lr_param_sprintf(param_name,
        "%08x-%04x-4%03x-%04x-%04x%08x",
        rand(),
        rand() & 0xffff,
        rand() & 0x0fff,
        (rand() & 0x3fff) | 0x8000,
        rand() & 0xffff,
        rand());
}

/*
 * gen_csrf_token(param_name)
 *
 * Generates a 32-character random hex token for CSRF / XSRF / anti-forgery headers.
 * Equivalent to 16 random bytes encoded as lowercase hex.
 *
 * Use for: x-xsrf-token, x-csrf-token, x-xsrf-header, __RequestVerificationToken, etc.
 *
 * Example:
 *     gen_csrf_token("_xsrfToken");
 *     web_add_header("x-xsrf-token", "{_xsrfToken}");
 */
static void gen_csrf_token(const char *param_name) {
    lr_param_sprintf(param_name,
        "%08x%08x%08x%08x",
        rand(), rand(), rand(), rand());
}

/*
 * gen_hex64(param_name)
 *
 * Generates a 64-character random hex string (32 bytes / 256-bit entropy).
 * Use for long tokens, nonces, or state parameters that require high entropy.
 *
 * Example:
 *     gen_hex64("_nonce");
 *     web_add_header("x-nonce", "{_nonce}");
 */
static void gen_hex64(const char *param_name) {
    lr_param_sprintf(param_name,
        "%08x%08x%08x%08x%08x%08x%08x%08x",
        rand(), rand(), rand(), rand(), rand(), rand(), rand(), rand());
}

//--------------------------------------------------------------------
// Global Variables
//--------------------------------------------------------------------
//
// Declare C-level global variables here to share data across
// vuser_init(), Action(), and vuser_end().
//
// Example:
//   char g_accessToken[2048] = "";

#endif // _GLOBALS_H
`;
  }

  generateVuserInitC() {
    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';

    // Pick the first URL-like parameter to log at startup (helps confirm config loaded)
    let urlParamLog = '';
    for (const [name] of this.parameters.entries()) {
      if (/^(url|baseUrl|base_url|host|endpoint|server)$/i.test(name)) {
        urlParamLog = `\n    lr_output_message("  Base URL : %s", lr_eval_string("{${name}}"));`;
        break;
      }
    }

    const paramCount  = this.parameters.size;
    const corrCount   = this.dynamicVarNames.size;

    // JWT vars detected — build active validation block for each JWT variable.
    // JWT note: web_js_run() in Action() handles JWT generation via jsrsasign.js.
    // No pre-generation or validation needed in vuser_init.c.
    const jwtNote = this.hasJwt ? `
    /* JWT client assertion is generated automatically at the start of each Action()
     * iteration via web_js_run() + jsrsasign.js. No setup needed here. */
` : '';

    return `/* -------------------------------------------------------------------------------
 *  Script Title  : ${scriptName}
 *  Protocol      : Web - HTTP/HTML
 *  Generated by  : Bruno to DevWeb Converter v2.4.0
 *
 *  vuser_init() — runs ONCE per Vuser before any iteration.
 *
 *  WHAT TO ADD HERE (per VuGen best practices):
 *    1. Validate that mandatory parameters are populated.
 *    2. Perform one-time authentication (OAuth token fetch, session login).
 *       web_reg_save_param_json() MUST come BEFORE the token request.
 *    3. Load any per-Vuser configuration that must happen before Action().
 * ------------------------------------------------------------------------------- */

vuser_init()
{
    int vusr_id, scid;
    char *vusr_group;
    lr_whoami(&vusr_id, &vusr_group, &scid);
    lr_output_message("[init] Vuser %d starting — ${scriptName}", vusr_id);
    lr_output_message("  Parameters loaded : ${paramCount} static, ${corrCount} correlation target(s)");${urlParamLog}
${jwtNote}
    /* ------------------------------------------------------------------
     * One-time authentication example (OAuth2 client_credentials).
     * NOTE: web_reg_save_param_json MUST come BEFORE web_custom_request.
     * Uncomment, adapt the URL/body, and ensure {clientId}/{clientSecret}
     * are set in collection_data.dat before running.
     * ------------------------------------------------------------------ */
    /*
    web_reg_save_param_json("_accessToken",
        "QueryString=$.access_token",
        "Ord=1",
        LAST);
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
    if (strcmp(lr_eval_string("{_accessToken}"), "") == 0) {
        lr_error_message("[init] FATAL: OAuth2 token is empty — check credentials in collection_data.dat");
        return -1;
    }
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
    int vusr_id, scid;
    char *vusr_group;
    lr_whoami(&vusr_id, &vusr_group, &scid);
    lr_output_message("[end] Vuser %d finished — ${scriptName}", vusr_id);

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

  /**
   * Analyse headers across all requests and classify them for VuGen C.
   *
   * Returns { globalHeaders, perRequestKeys }:
   *   globalHeaders  — headers present in ≥70% of requests with the same value template.
   *                    These are set via web_add_auto_header() once at the start of Action().
   *   perRequestKeys — keys that vary per request or use per-request UUID vars (web_add_header each time).
   */
  analyzeCommonHeaders() {
    if (this._cachedCommonHeaders) return this._cachedCommonHeaders;

    const headerFreq    = new Map();
    const totalRequests = this.requests.length || 1;

    this.requests.forEach(req => {
      (req.headers || []).filter(h => h.key && h.value && !h.disabled).forEach(h => {
        if (!headerFreq.has(h.key)) headerFreq.set(h.key, { count: 0, values: new Map() });
        const entry = headerFreq.get(h.key);
        entry.count++;
        const raw = String(h.value);
        entry.values.set(raw, (entry.values.get(raw) || 0) + 1);
      });
    });

    const globalHeaders  = new Map();  // key → replaceParameters(value) for web_add_auto_header
    const perRequestKeys = new Set();
    const THRESHOLD      = 0.7;

    headerFreq.forEach((entry, key) => {
      // Content-Type varies by body type — always per-request
      if (key.toLowerCase() === 'content-type') { perRequestKeys.add(key); return; }

      const freq = entry.count / totalRequests;
      if (freq < THRESHOLD) { perRequestKeys.add(key); return; }

      // Find dominant value
      let dominantRaw = '';
      let best = 0;
      entry.values.forEach((cnt, val) => { if (cnt > best) { dominantRaw = val; best = cnt; } });

      // If value uses a per-request UUID var → per-request
      const isPerReq = this.perRequestVars &&
        Array.from(this.perRequestVars.keys()).some(v => dominantRaw.includes(`{{${v}}}`));
      if (isPerReq) { perRequestKeys.add(key); return; }

      globalHeaders.set(key, this.replaceParameters(dominantRaw));
    });

    this._cachedCommonHeaders = { globalHeaders, perRequestKeys };
    return this._cachedCommonHeaders;
  }

  generateActionC() {
    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';
    const timestamp = new Date().toISOString();

    // Analyse common headers for this collection
    const { globalHeaders } = this.analyzeCommonHeaders();

    // JWT setup block — certificate + token generation via jsrsasign.js
    // web_js_run() executes JavaScript using VuGen's built-in JS engine.
    // createJWT() is a function expected inside jsrsasign.js.
    const jwtSetup = this.hasJwt ? `
    /* mTLS Certificate — required for private_key_jwt client authentication */
    web_set_certificate_ex(
        "CertFilePath=transport.pem",
        "CertFormat=PEM",
        "KeyFilePath=transport.pem",
        "KeyFormat=PEM",
        LAST);

    /* Generate JWT client assertion using jsrsasign.js (VuGen built-in JS engine).
     * ResultParam=_jwt_token stores the result as LR parameter {_jwt_token} so that
     * it is used consistently in request bodies as: client_assertion={_jwt_token} */
    web_js_run(
        "Code=createJWT(LR.getParam('client_id'),LR.getParam('token_url'),LR.getParam('scope'),LR.getParam('signing_private_key'));",
        "ResultParam=_jwt_token",
        SOURCES,
        "File=jsrsasign.js",
        ENDITEM,
        LAST);
    lr_output_message("[init] JWT token generated (%d chars)", (int)strlen(lr_eval_string("{_jwt_token}")));

` : '';

    // Global persistent headers — applied to ALL subsequent requests automatically.
    // web_add_auto_header() persists until explicitly removed, unlike web_add_header().
    const autoHeaderLines = Array.from(globalHeaders.entries())
      .map(([k, v]) => `    web_add_auto_header("${k}", "${v.replace(/"/g, '\\"')}");`)
      .join('\n');
    const autoHeaderBlock = globalHeaders.size > 0
      ? `\n    /* Global headers — applied to ALL requests automatically */\n${autoHeaderLines}\n`
      : '';

    let code = `/* -------------------------------------------------------------------------------
    Script Title       : ${scriptName}
    Generated by       : Bruno to DevWeb Converter v2.4.4
    Protocol           : Web - HTTP/HTML
    Generated on       : ${timestamp}
    Total Requests     : ${this.requests.length}
    Correlations       : ${this.correlations.length}
    Parameters         : ${this.parameters.size}
   ------------------------------------------------------------------------------- */

Action()
{
    web_set_sockets_option("SSL_VERSION", "AUTO");
${jwtSetup}${autoHeaderBlock}

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

  /**
   * Generate per-request transactions.
   *
   * Each API request = one LR transaction: T{nn}_{RequestName}
   * Counter is global across ALL folder groups (T01, T02 ... Tn).
   * Folders remain as C comments for code readability — no outer transactions.
   *
   * Examples:
   *   Folder Auth:      T01_Get_Access_Token,  T02_Refresh_Token
   *   Folder Products:  T03_Get_Products,       T04_Create_Product
   *   Sub-folder A/B:   T05_Get_Items  (uses sanitized request name)
   *
   * All transaction names collected in this.transactionNames for .usr file.
   */
  generateGroupedRequests() {
    const groups = this.groupRequestsByFolder();
    let code = '';
    let txCounter = 1;
    this.transactionNames = [];  // Reset — will hold ALL per-request tx names

    const groupEntries = Array.from(groups.entries());
    groupEntries.forEach(([folder, requests], groupIndex) => {

      // Folder comment (no outer transaction wrapper)
      if (this.options.addComments && folder) {
        code += `    /* ---- ${folder} ---- */\n`;
      }

      requests.forEach((request, idx) => {
        const seqNum  = String(txCounter).padStart(2, '0');
        // Strip leading underscores/digits so "01_Get_Token" → "Get_Token" not "_01_Get_Token"
        const rawLabel = this.sanitizeCName(request.name).replace(/^[_0-9]+/, '');
        const txLabel  = rawLabel || `Req${seqNum}`;
        const txName   = `T${seqNum}_${txLabel}`;
        this.transactionNames.push(txName);
        txCounter++;

        // Per-request transaction wrapper
        code += `    lr_start_transaction("${txName}");\n\n`;
        code += this.generateRequestBlock(request, 1);
        code += `\n    lr_end_transaction("${txName}", LR_AUTO);\n`;

        // Think time between requests in same folder (not after last)
        if (idx < requests.length - 1 && this.options.thinkTime > 0) {
          code += `\n    lr_think_time(${this.options.thinkTime});\n`;
        }
        code += '\n';
      });

      // Think time between folder groups (not after last group)
      if (groupIndex < groupEntries.length - 1 && this.options.thinkTime > 0) {
        code += `    lr_think_time(${this.options.thinkTime});\n\n`;
      }
    });

    return code;
  }

  generateSequentialRequests() {
    let code = '';
    let txCounter = 1;
    this.transactionNames = [];
    this.requests.forEach((request, idx) => {
      const seqNum  = String(txCounter).padStart(2, '0');
      const rawLabel = this.sanitizeCName(request.name).replace(/^[_0-9]+/, '');
      const txName   = `T${seqNum}_${rawLabel || `Req${seqNum}`}`;
      this.transactionNames.push(txName);
      txCounter++;

      code += `    lr_start_transaction("${txName}");\n\n`;
      code += this.generateRequestBlock(request, 1);
      code += `\n    lr_end_transaction("${txName}", LR_AUTO);\n`;

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
   *   1. Per-request dynamic var generation (UUID/nonce — before correlation and headers)
   *   2. web_reg_save_param_* calls (correlation registrations) — BEFORE the request
   *   3. web_add_header() calls — immediately before the request
   *   4. web_url() or web_custom_request()
   *   5. lr_output_message() log
   */
  generateRequestBlock(request, indentLevel = 1) {
    const indent = '    '.repeat(indentLevel);
    let code = '';

    if (this.options.addComments) {
      code += `${indent}/* ${request.name} */\n`;
    }

    // 1. Per-request dynamic variable generation (e.g. x-fapi-interaction-id UUID)
    code += this.generatePerRequestVarCode(request, indent);

    // 2. Correlation registrations (must come BEFORE the producing request)
    code += this.generateCorrelationRegistrations(request, indent);

    // 3. Headers
    code += this.generateAddHeaders(request, indent);

    // 4. Web function
    code += this.generateWebFunction(request, indent);

    // 5. Log
    code += `${indent}lr_output_message("${this.sanitizeCName(request.name)} - completed");\n`;

    return code;
  }

  /**
   * Generate C code to create per-request dynamic values (UUID, nonce, timestamp).
   * Emits a C block that saves a unique value into an LR parameter BEFORE the request headers.
   *
   * Example output for interaction_id (uuid):
   *   { char _interaction_id[64]; int _v, _sc; char *_g;
   *     lr_whoami(&_v, &_g, &_sc);
   *     sprintf(_interaction_id, "id-%d-%ld-%d", _v, (long)time(NULL), rand() % 9999);
   *     lr_save_string(_interaction_id, "_interaction_id"); }
   */
  generatePerRequestVarCode(request, indent) {
    if (!this.perRequestVars || this.perRequestVars.size === 0) return '';

    let code = '';
    this.perRequestVars.forEach((info, varName) => {
      if (!this.requestUsesVar(request, varName)) return;

      const paramName = `_${varName}`;  // _ prefix = VuGen convention for dynamic LR params
      const genType   = info.generationType;

      // Call the appropriate generator function defined in globals.h.
      // These are proper C functions (not macros) — one call per request that needs a fresh value.
      if (genType === 'uuid') {
        // gen_uuid() — UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
        code += `${indent}gen_uuid("${paramName}");\n`;
      } else if (genType === 'csrf' || genType === 'hex32') {
        // gen_csrf_token() — 32-char hex (16 bytes): for CSRF/XSRF tokens
        code += `${indent}gen_csrf_token("${paramName}");\n`;
      } else if (genType === 'hex64' || genType === 'nonce') {
        // gen_hex64() — 64-char hex (32 bytes): for high-entropy nonces
        code += `${indent}gen_hex64("${paramName}");\n`;
      } else if (genType === 'random' || genType === 'alphanumeric') {
        // Default: use UUID format (widely compatible)
        code += `${indent}gen_uuid("${paramName}");\n`;
      } else if (genType === 'timestamp') {
        // Timestamp as decimal string
        code += `${indent}{ char _ts[32]; sprintf(_ts, "%ld", (long)time(NULL)); lr_save_string(_ts, "${paramName}"); }\n`;
      }
    });
    return code;
  }

  /**
   * Check if a request uses a given variable name ({{varName}}) in URL, headers, or body.
   */
  requestUsesVar(request, varName) {
    const pattern = new RegExp(`\\{\\{\\s*${varName}\\s*\\}\\}`);
    const url = typeof request.url === 'string' ? request.url : (request.url?.raw || '');
    if (pattern.test(url)) return true;
    if (request.headers?.some(h => pattern.test(h.value || ''))) return true;
    if (request.body?.raw && pattern.test(request.body.raw)) return true;
    return false;
  }

  // ─── Correlation ─────────────────────────────────────────────────────────────

  generateCorrelationRegistrations(request, indent) {
    const produced = this.correlations.filter(c =>
      c.producerRequest === request.name || c.producerRequest === request.id
    );
    if (produced.length === 0) return '';

    // Deduplicate: keep only the FIRST (best-quality) correlation per variable name.
    // The correlation detector may assign the same variable to the same request multiple
    // times (e.g. _endpoint from heuristic + script detection). VuGen only needs one.
    const seen = new Set();
    const unique = produced.filter(corr => {
      if (seen.has(corr.name)) return false;
      seen.add(corr.name);
      return true;
    });

    let code = '';
    unique.forEach(corr => {
      // Determine the best JSON path for the extraction.
      // corr.extractPath may be: '$.access_token' (good), '$' (root only — bad), or empty.
      // When the path is missing or just '$', derive it from the variable name.
      const rawPath  = corr.extractPath || '';
      const corrBase = corr.name.replace(/^_/, '');  // strip leading _ for path guess

      // A valid specific path has at least one dot after $ (e.g. $.access_token, $[0].id)
      const hasValidPath = rawPath.startsWith('$') && rawPath.length > 1 && rawPath !== '$';
      const jsonPath = hasValidPath ? rawPath : `$.${corrBase}`;

      switch (corr.type) {
        case 'json':
        case 'token':
        case 'id':
        case 'sessionId':
          code += `${indent}web_reg_save_param_json("${corr.name}",\n`;
          code += `${indent}    "QueryString=${jsonPath}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;

        case 'header': {
          // Extract from response header — web_reg_save_param with Search=Headers
          // extractPath holds the header name (e.g. "x-csrf-token")
          const headerName = corr.extractPath || corrBase;
          code += `${indent}web_reg_save_param("${corr.name}",\n`;
          code += `${indent}    "LB=${this.escapeCString(headerName)}: ",\n`;
          code += `${indent}    "RB=\\r\\n",\n`;
          code += `${indent}    "Search=Headers",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;
        }

        case 'cookie': {
          // Extract from response cookie
          const cookieName = corr.extractPath || corrBase;
          code += `${indent}web_reg_save_param("${corr.name}",\n`;
          code += `${indent}    "LB=${this.escapeCString(cookieName)}=",\n`;
          code += `${indent}    "RB=;",\n`;
          code += `${indent}    "Search=Headers",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;
        }

        case 'boundary':
        case 'csrf':
          code += `${indent}web_reg_save_param("${corr.name}",\n`;
          if (corr.leftBoundary)  code += `${indent}    "LB=${this.escapeCString(corr.leftBoundary)}",\n`;
          if (corr.rightBoundary) code += `${indent}    "RB=${this.escapeCString(corr.rightBoundary)}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;

        case 'regex':
        case 'regexp':
          code += `${indent}web_reg_save_param_regexp("${corr.name}",\n`;
          code += `${indent}    "RegExp=${this.escapeCString(corr.pattern || `${corrBase}=([^&"'\\s]+)`)}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;

        default:
          // Fallback: JSON path using variable name as field
          code += `${indent}web_reg_save_param_json("${corr.name}",\n`;
          code += `${indent}    "QueryString=${jsonPath}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
      }
    });
    return code;
  }

  // ─── Headers ─────────────────────────────────────────────────────────────────

  generateAddHeaders(request, indent) {
    // Global headers are already set via web_add_auto_header() at the start of Action().
    // Only emit web_add_header() for headers that are:
    //   - Specific to this request (not in globalHeaders), OR
    //   - Per-request dynamic (UUID etc.)
    const { globalHeaders } = this.analyzeCommonHeaders();
    const globalKeys = new Set(Array.from(globalHeaders.keys()).map(k => k.toLowerCase()));

    const headers = [];

    // Collection-level headers (skip those already handled as global auto-headers)
    if (this.collection.collectionHeaders) {
      this.collection.collectionHeaders.forEach(h => {
        if (h.key && h.value && !h.disabled && !globalKeys.has(h.key.toLowerCase()))
          headers.push(h);
      });
    }

    // Request-level headers (skip global ones — they're already persistent via auto-header)
    if (request.headers && Array.isArray(request.headers)) {
      request.headers.forEach(h => {
        if (h.key && h.value && !h.disabled && !globalKeys.has(h.key.toLowerCase()))
          headers.push(h);
      });
    }

    // Auth header injection — only if not already in global auto-headers
    const hasExplicitAuth = headers.some(h => h.key?.toLowerCase() === 'authorization');
    const authInGlobal    = globalKeys.has('authorization');
    if (!hasExplicitAuth && !authInGlobal) {
      const authHeader = this.getAuthHeader(request);
      if (authHeader) headers.push(authHeader);
    }

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

    // Each request gets the next snapshot file: t1.inf, t2.inf, t3.inf, ...
    // VuGen records the response body in this file during replay for viewing in the UI.
    const snapshot = `t${++this.snapshotCounter}.inf`;

    if (method === 'GET' || method === 'HEAD') {
      return this.generateWebUrl(request, url, snapshot, indent);
    } else {
      return this.generateWebCustomRequest(request, url, method, contentType, snapshot, indent);
    }
  }

  generateWebUrl(request, url, snapshot, indent) {
    let code = `${indent}web_url("${this.sanitizeCName(request.name)}",\n`;
    code += `${indent}    "URL=${url}",\n`;
    code += `${indent}    "Resource=0",\n`;
    code += `${indent}    "RecContentType=application/json",\n`;
    code += `${indent}    "Referer=",\n`;
    code += `${indent}    "Snapshot=${snapshot}",\n`;
    code += `${indent}    "Mode=HTML",\n`;
    code += `${indent}    LAST);\n`;
    return code;
  }

  generateWebCustomRequest(request, url, method, contentType, snapshot, indent) {
    const bodyResult = this.generateBodyForC(request);

    let code = `${indent}web_custom_request("${this.sanitizeCName(request.name)}",\n`;
    code += `${indent}    "URL=${url}",\n`;
    code += `${indent}    "Method=${method}",\n`;
    code += `${indent}    "Resource=0",\n`;
    code += `${indent}    "RecContentType=application/json",\n`;
    code += `${indent}    "Referer=",\n`;
    code += `${indent}    "Snapshot=${snapshot}",\n`;
    code += `${indent}    "Mode=HTML",\n`;

    if (contentType) {
      code += `${indent}    "EncType=${contentType}",\n`;
    }
    if (bodyResult?.bodyFile) {
      // Large base64 body — VuGen reads file at runtime, substitutes {params} within it
      code += `${indent}    "BodyFilePath=${bodyResult.bodyFile}",\n`;
    } else if (bodyResult?.body) {
      code += `${indent}    "Body=${bodyResult.body}",\n`;
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

  /**
   * Generate body for a C web_custom_request call.
   * Returns:
   *   { body: string }     — inline "Body=..." attribute value
   *   { bodyFile: string } — "BodyFilePath=..." for large base64 or large JSON bodies
   *   null                 — no body (formdata / empty)
   *
   * VuGen's BodyFilePath= reads the file at runtime and performs {param} substitution
   * within it, so {varName} LR parameter references work inside body files.
   */
  generateBodyForC(request) {
    if (!request.body) return null;

    const { mode, raw, urlencoded, formdata } = request.body;

    if (mode === 'raw' && raw) {
      // Case 1: Entire raw body was detected as large base64 — use BodyFilePath
      const rawKey = `${request.name}::__raw__`;
      if (this.largeValueIndex.has(rawKey)) {
        const fileInfo = this.extractedDataFiles.get(this.largeValueIndex.get(rawKey));
        return { bodyFile: `data/${fileInfo.fileName}` };
      }

      // Case 2: JSON body with embedded large base64 field(s) — use BodyFilePath
      const jsonKey = `${request.name}::__json__`;
      if (this.largeValueIndex.has(jsonKey)) {
        const fileInfo = this.extractedDataFiles.get(this.largeValueIndex.get(jsonKey));
        return { bodyFile: `data/${fileInfo.fileName}` };
      }

      // Normal case: inline body
      try {
        const parsed = JSON.parse(raw);
        return { body: this.jsonToCString(parsed) };
      } catch {
        return { body: this.escapeCBodyString(this.replaceParameters(raw)) };
      }
    }

    if (mode === 'urlencoded' && urlencoded) {
      const parts = urlencoded
        .filter(p => !p.disabled && p.key)
        .map(p => `${encodeURIComponent(p.key)}=${this.vuGenEncodeValue(p.value || '')}`);
      return { body: parts.join('&') };
    }

    if (mode === 'formdata' && formdata) {
      // Multipart/form-data cannot be represented in web_custom_request Body=.
      // VuGen Web HTTP/HTML does not support multipart uploads via the C API body string.
      // The request is generated without a body — adapt manually in Action.c if needed.
      console.warn(`  ⚠  "${request.name}": multipart/form-data body cannot be represented in web_custom_request Body= — request generated without body. Convert to raw JSON or urlencoded manually in Action.c.`);
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

      // Skip already-classified variables and dynamic/per-request vars
      if (this.parameters.has(varName))             continue;
      if (this.dynamicVarNames.has(varName))        continue;
      // Per-request vars use _ prefix in generated code — _varName won't be a parameter
      if (varName.startsWith('_'))                  continue;
      // Skip per-request vars that were renamed with _ prefix
      const baseVarName = varName.replace(/^_/, '');
      if (this.perRequestVars && this.perRequestVars.has(baseVarName)) continue;

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
      // Skip Postman built-in dynamic variables ($guid, $timestamp, etc.)
      if (trimmed.startsWith('$')) return match;
      // Per-request dynamic vars use _ prefix in VuGen (generated inline before the request)
      if (this.perRequestVars && this.perRequestVars.has(trimmed)) return `{_${trimmed}}`;
      // Dynamic/correlated vars also use _ prefix by convention
      if (this.dynamicVarNames && this.dynamicVarNames.has(trimmed)) return `{_${trimmed}}`;
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

  // ─── Large Base64 Extraction ─────────────────────────────────────────────────

  /**
   * Check if a string is a large base64-encoded value.
   * Must be >= BASE64_THRESHOLD chars and contain only base64 characters.
   */
  isBase64(str) {
    if (!str || typeof str !== 'string') return false;
    const stripped = str.replace(/\s/g, '');
    if (stripped.length < this.BASE64_THRESHOLD) return false;
    return /^[A-Za-z0-9+/=]+$/.test(stripped);
  }

  /**
   * Generate a short MD5 hash prefix for deduplication (12 hex chars).
   */
  hashContent(content) {
    return crypto.createHash('md5').update(content).digest('hex').substring(0, 12);
  }

  /**
   * Generate a safe file name for an extracted data file.
   */
  safeDataFileName(requestName, suffix) {
    return this.sanitizeCName(requestName) + '_' + suffix;
  }

  /**
   * Scan all POST/PUT/PATCH requests for large base64 values in raw bodies.
   *
   * Two cases handled:
   *   1. Entire raw body is base64 → extracted to data/requestName_body.b64
   *      Action.c uses: "BodyFilePath=data/requestName_body.b64"
   *
   *   2. JSON body contains embedded base64 field(s) → entire processed JSON written
   *      to data/requestName_body.dat with {varName} LR param syntax preserved.
   *      Action.c uses: "BodyFilePath=data/requestName_body.dat"
   *      VuGen substitutes {param} references within BodyFilePath files at runtime.
   *
   * Identical content across requests is deduplicated via MD5 hash.
   */
  scanForLargeBase64() {
    let totalFound = 0;
    let deduplicated = 0;

    this.requests.forEach(request => {
      if (!request.body) return;
      const method = (request.method || 'GET').toUpperCase();
      if (!['POST', 'PUT', 'PATCH'].includes(method)) return;

      const { mode, raw } = request.body;
      if (mode !== 'raw' || !raw) return;

      // Case 1: Entire raw body is large base64
      if (this.isBase64(raw)) {
        const hash = this.hashContent(raw);
        const indexKey = `${request.name}::__raw__`;
        if (this.extractedDataFiles.has(hash)) {
          this.extractedDataFiles.get(hash).usedBy.push(request.name);
          this.largeValueIndex.set(indexKey, hash);
          deduplicated++;
        } else {
          const varName = this.safeDataFileName(request.name, 'body');
          const fileName = `${varName}.b64`;
          this.extractedDataFiles.set(hash, {
            varName, fileName, content: raw, size: raw.length, usedBy: [request.name]
          });
          this.largeValueIndex.set(indexKey, hash);
          totalFound++;
        }
        return; // Don't also check as JSON
      }

      // Case 2: JSON body with embedded large base64 field(s)
      try {
        const parsed = JSON.parse(raw);
        let hasLargeBase64 = false;
        this._scanObjectForBase64(parsed, request.name, '', () => { hasLargeBase64 = true; });

        if (hasLargeBase64) {
          // Write entire processed JSON (with {varName} LR params for non-base64 fields)
          const processedContent = this.replaceParameters(raw);
          const hash = this.hashContent(raw); // hash original for deduplication
          const indexKey = `${request.name}::__json__`;
          if (this.extractedDataFiles.has(hash)) {
            this.extractedDataFiles.get(hash).usedBy.push(request.name);
            this.largeValueIndex.set(indexKey, hash);
            deduplicated++;
          } else {
            const varName = this.safeDataFileName(request.name, 'body');
            const fileName = `${varName}.dat`;
            this.extractedDataFiles.set(hash, {
              varName, fileName, content: processedContent, size: processedContent.length, usedBy: [request.name]
            });
            this.largeValueIndex.set(indexKey, hash);
            totalFound++;
          }
        }
      } catch {
        // Not JSON — already handled by isBase64 check above
      }
    });

    if (totalFound > 0 || deduplicated > 0) {
      console.log(`✓ Extracted ${totalFound + deduplicated} large body/base64 value(s) to data/ folder (${totalFound} unique, ${deduplicated} deduplicated)`);
    }
  }

  /**
   * Recursively scan a parsed JSON object for large base64 string values.
   * Calls onFound(fieldPath, value) for each match found.
   */
  _scanObjectForBase64(obj, requestName, currentPath, onFound) {
    if (typeof obj === 'string') {
      if (this.isBase64(obj)) onFound(currentPath, obj);
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, i) =>
        this._scanObjectForBase64(item, requestName, `${currentPath}[${i}]`, onFound)
      );
      return;
    }
    if (typeof obj === 'object' && obj !== null) {
      Object.entries(obj).forEach(([key, value]) => {
        const p = currentPath ? `${currentPath}.${key}` : key;
        this._scanObjectForBase64(value, requestName, p, onFound);
      });
    }
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

  // ─── JWT Pre-generation Helper ────────────────────────────────────────────────

  /**
   * Generate generate_jwt.js — a standalone Node.js script that creates a JWT
   * token and prints it to stdout.  Users run this BEFORE the VuGen test and
   * paste the token into collection_data.dat (jwtToken column).
   *
   * Uses jwt-helper.js (the same library as DevWeb scripts).
   * Placed in the output folder alongside jsrsasign.js + transport.pem.
   *
   * Usage:
   *   node generate_jwt.js
   *   → prints signed JWT to stdout
   *
   * For long tests (token lifetime < test duration):
   *   node generate_jwt.js >> tokens.dat  (repeat for each user row)
   */
  generateJwtHelperScript() {
    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';
    return `#!/usr/bin/env node
/**
 * generate_jwt.js — Pre-generate JWT token for VuGen Web HTTP/HTML scripts.
 *
 * Generated by: Bruno to DevWeb Converter v2.4.0
 * Script:       ${scriptName}
 *
 * USAGE:
 *   node generate_jwt.js
 *   Prints the signed JWT token to stdout.
 *
 * HOW TO USE IN VUGEN:
 *   1. Run this script: node generate_jwt.js
 *   2. Copy the output token to collection_data.dat → jwtToken column.
 *   3. Set GenerateNewVal="Once" for jwtToken in ParameterFile.prm.
 *   4. For long tests: regenerate before each test run or before token expires.
 *
 * DEPENDENCIES:
 *   - jwt-helper.js (in same folder — uses only Node.js built-in crypto, no npm)
 *   - transport.pem (private key — replace placeholder with your actual key)
 */

'use strict';

const jwtLib = require('./jwt-helper');
const path   = require('path');

// ── TODO: Update these values to match your API's JWT requirements ──────────
const options = {
  algorithm: 'RS256',          // PS256, RS256, HS256, ES256 — check your API spec
  keyPath:   path.join(__dirname, 'transport.pem'),  // private key PEM file
  payload: {
    // TODO: Replace placeholder values with your actual claims
    sub: 'YOUR_CLIENT_ID',     // subject — typically the client/application ID
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + 600,   // 10 minutes — adjust as needed
    // Add any additional claims required by your API:
    // iss: 'your-issuer',
    // aud: 'your-audience',
    // jti: require('crypto').randomUUID()
  }
};
// ─────────────────────────────────────────────────────────────────────────────

try {
  const token = jwtLib.generate(options);
  process.stdout.write(token + '\\n');
} catch (err) {
  process.stderr.write('[generate_jwt] ERROR: ' + err.message + '\\n');
  process.stderr.write('  Check: transport.pem exists and contains a valid private key.\\n');
  process.exit(1);
}
`;
  }
}

module.exports = WebHttpScriptGenerator;
