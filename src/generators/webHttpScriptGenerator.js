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
    // CSV column names from JMX CSVDataSet configs — always Tier 3 (EachIteration params)
    this.csvVarNames = new Map(); // varName → { fileName, colIndex, delimiter, recycle }

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

    // NTLM/Kerberos detection — populated by detectNtlmKerberos() during analyze()
    this.hasNtlm = false;
    this.ntlmAuthType = null; // 'ntlm' | 'kerberos'

    // mTLS cert detection — populated by detectMtlsCert() during analyze()
    this.mtlsCertFile = null; // basename of uploaded cert file (non-JWT)

    // Per-request dynamic variables (UUID/nonce/random generated fresh per request)
    this.perRequestVars = new Map(); // varName → { generationType, requestNames[] }

    // JSR223 script variables declared globally (before Action()) to satisfy C89 scoping rules.
    // varName → cType ('const char *' | 'char[64]')
    this.jsr223GlobalVars = new Map();

    this.hostVarMap = new Map(); // hostname → LR param name (ServerHost, ...)
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

  /**
   * Detect NTLM or Kerberos authentication in any request (typically from JMX AuthManager).
   * Sets this.hasNtlm and this.ntlmAuthType when found.
   */
  detectNtlmKerberos() {
    for (const req of this.requests) {
      const authType = (req.auth?.type || '').toLowerCase();
      if (authType === 'kerberos') {
        this.hasNtlm = true;
        this.ntlmAuthType = 'kerberos';
        console.log('  ✓ Kerberos authentication detected');
        return;
      }
      if (authType === 'ntlm') {
        this.hasNtlm = true;
        this.ntlmAuthType = 'ntlm';
        console.log('  ✓ NTLM authentication detected');
        return;
      }
    }
  }

  /**
   * Detect uploaded mTLS client certificate files (non-JWT).
   * Checks options.csvFilePaths for .pem/.p12/.pfx/.crt files.
   * Sets this.mtlsCertFile to the filename when found.
   */
  detectMtlsCert() {
    const paths = this.options.csvFilePaths || {};
    for (const filename of Object.keys(paths)) {
      const lc = filename.toLowerCase();
      if (lc.endsWith('.pem') || lc.endsWith('.p12') || lc.endsWith('.pfx') || lc.endsWith('.crt')) {
        this.mtlsCertFile = filename;
        console.log(`  ✓ Client certificate detected: ${filename}`);
        return;
      }
    }
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
    // Build csvVarNames from JMX CSVDataSet configs so they are always classified
    // as Tier 3 iteration parameters (never treated as Dynamic via Rule 4).
    const csvDataSets = this.options.csvDataSets || this.collection.csvDataSets || [];
    for (const ds of csvDataSets) {
      const cols = (ds.variableNames || '').split(',').map(s => s.trim()).filter(Boolean);
      cols.forEach((col, idx) => {
        this.csvVarNames.set(col, {
          fileName:  ds.filename || `${col}.csv`,
          colIndex:  idx + 1,
          delimiter: ds.delimiter || ',',
          recycle:   ds.recycle !== false,
        });
        // Ensure the var is in variableMap (may have been injected as '' already)
        if (!this.variableMap.has(col)) this.variableMap.set(col, '');
      });
    }
    this.detectScriptSetVariables();
  }

  detectScriptSetVariables() {
    // Groups: 1=pm.*/context (modern), 2=postman.set* (legacy Postman 2.x), 3=bru.set*, 4=env/vars legacy
    // postman.setEnvironmentVariable / postman.setGlobalVariable are the Postman 2.x API —
    // not the same as pm.environment.set() — must be matched separately.
    const setPattern = /(?:context|pm\.environment|pm\.collectionVariables|pm\.globals|pm\.variables)\.set\s*\(\s*["']([^"']+)["']|postman\.(?:setEnvironmentVariable|setGlobalVariable)\s*\(\s*["']([^"']+)["']|bru\.(?:setEnv|setEnvVar|setVar|setGlobalVar|setNextEnvVar)\s*\(\s*["']([^"']+)["']|(?:^|[^a-zA-Z0-9_$])(?:env|vars)\.set\s*\(\s*["']([^"']+)["']/gm;
    const scan = (item) => {
      // Support both raw collection (item.event) and normalized request (item.tests)
      const events = item.event || item.tests || [];
      if (Array.isArray(events)) {
        events.forEach(ev => {
          if (ev.script && ev.script.exec) {
            const text = Array.isArray(ev.script.exec) ? ev.script.exec.join('\n') : ev.script.exec;
            let m;
            while ((m = setPattern.exec(text)) !== null) {
              // group 1=pm.*/context, 2=postman.set* legacy, 3=bru.set*, 4=env/vars legacy
              const varName = m[1] || m[2] || m[3] || m[4];
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
            // group 1=pm.*/context, 2=postman.set* legacy, 3=bru.set*, 4=env/vars legacy
            const varName = m[1] || m[2] || m[3] || m[4];
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

    // Private key / cryptographic secret — must NEVER appear in ParameterFile.prm or collection_data.dat.
    // PEM-encoded keys are multi-line, contain special chars that break CSV parsing, and must not be
    // stored in plain-text parameter files. Treated as dynamic so they stay as LR params only.
    const privateKeyPattern = /private.?key|signing.?key|secret.?key|rsa.?key|client.?secret|signing.?secret|jwt.?secret|pem.?key|key.?pem|pkcs|p12.?key/i;

    // RULE 0 — JMX CSVDataSet columns → always Tier 3 (EachIteration parameter in ParameterFile.prm)
    // These have empty values from injectCsvVariables() and would fall into Rule 4 (Dynamic) otherwise.
    // They must NOT be Dynamic — they're read from a file by VuGen at runtime via {varName}.
    for (const [col] of this.csvVarNames) {
      this.paramVarNames.add(col);
    }

    // RULE 1 — Correlation targets → dynamic (VuGen: web_reg_save_param_* handles them)
    this.correlations.forEach(corr => this.dynamicVarNames.add(corr.name));

    // RULE 2 — Script-set variables → dynamic
    this.scriptSetVarNames.forEach(name => this.dynamicVarNames.add(name));

    // RULE 2.5 — Private key / cryptographic secret → always dynamic (never in ParameterFile.prm)
    // PEM keys are multi-line, contain special chars that break CSV, must not be in plain-text files.
    for (const [name] of this.variableMap.entries()) {
      if (privateKeyPattern.test(name)) this.dynamicVarNames.add(name);
    }

    // RULE 3 — _ prefix → always dynamic
    for (const [name] of this.variableMap.entries()) {
      if (name.startsWith('_')) this.dynamicVarNames.add(name);
    }

    // RULE 4 (GENERIC) — Empty value in collection/environment → dynamic.
    // Static params always have real values. Runtime vars are left empty intentionally.
    // Skip variables already committed to paramVarNames by Rule 0 (CSV columns).
    for (const [name, value] of this.variableMap.entries()) {
      if (this.dynamicVarNames.has(name)) continue;
      if (this.paramVarNames.has(name)) continue;        // already a param (Rule 0)
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
    // Rule 0 CSV columns get their actual file/column info; all others use collection_data.dat
    for (const name of this.paramVarNames) {
      const value      = this.variableMap.get(name);
      const csvInfo    = this.csvVarNames.get(name);
      const isCredential = credentialPattern.test(name);
      if (csvInfo) {
        // From a JMX CSVDataSet — point to the actual CSV file
        this.parameters.set(name, {
          name,
          type:      'csv',
          fileName:  csvInfo.fileName,
          columnName: name,
          colIndex:  csvInfo.colIndex,
          delimiter: csvInfo.delimiter,
          nextValue: 'iteration',        // CSVDataSet is always per-iteration in JMeter
          nextRow:   'sequential',
          onEnd:     csvInfo.recycle ? 'loop' : 'last',
          paramValue: ''
        });
      } else {
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
    }

    // Link all columns from the same CSV file together (col 2..N → same as col 1)
    const csvFileFirstCol = new Map(); // fileName → first column name
    for (const [col, info] of this.csvVarNames) {
      if (!csvFileFirstCol.has(info.fileName)) {
        csvFileFirstCol.set(info.fileName, col);
      }
    }
    for (const [name, config] of this.parameters.entries()) {
      const csvInfo = this.csvVarNames.get(name);
      if (!csvInfo) continue;
      const firstCol = csvFileFirstCol.get(csvInfo.fileName);
      if (firstCol && firstCol !== name) {
        config.nextRow = `same as ${firstCol}`;
      }
    }

    // Legacy: Link password-like params to username for non-CSV params
    if (usernameParam) {
      for (const [name, config] of this.parameters.entries()) {
        if (/^(password|pwd|passwd)$/i.test(name) && !this.csvVarNames.has(name)) {
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
      this.hasJwt, this.detectProxyConfig(), this.hasNtlm, this.mtlsCertFile
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

    // 9. If mTLS cert detected (non-JWT): copy uploaded cert file to output directory.
    if (this.mtlsCertFile) {
      const srcPath = (this.options.csvFilePaths || {})[this.mtlsCertFile];
      if (srcPath && fs.existsSync(srcPath)) {
        fs.copyFileSync(srcPath, path.join(outputDir, this.mtlsCertFile));
        console.log(`✓ Copied mTLS certificate: ${this.mtlsCertFile}`);
      } else {
        console.warn(`  ⚠  mTLS cert ${this.mtlsCertFile} not found in uploaded files.`);
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
    // Filter out jsrsasign library-loading requests (kjur.github.io/jsrassign).
    // These are script-runner HTTP fetches used by Postman/Bruno pre-request scripts to
    // load the jsrsasign JWT library. In our generated scripts we ship jsrassign.js as a
    // local file, so the library-fetch request must never become a web_custom_request().
    {
      const beforeFilter = this.requests.length;
      this.requests = this.requests.filter(r => !this._isJsrsasignLoadRequest(r));
      if (this.requests.length < beforeFilter) {
        console.log(`  ✓ Skipped ${beforeFilter - this.requests.length} jsrsasign library-loading request(s)`);
      }
    }

    // Correlations
    if (this.options.useCorrelation) {
      this.correlations = this.correlationDetector.analyzeRequests(this.requests);
      // Inject JMX-explicit extractors (RegexExtractor, BoundaryExtractor, etc.)
      this.injectJmxExtractors();
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

          // JWT detection — scan all scripts (pre, test, and JMX JSR223 pre/post).
          // JMX JSR223 scripts (Java/Groovy) may also contain JWT signing logic.
          const allScriptTexts = [preText, testText,
            ...(req.preScripts  || []).map(s => typeof s === 'string' ? s : (s?.code || '')),
            ...(req.postScripts || []).map(s => typeof s === 'string' ? s : (s?.code || '')),
          ];
          for (const txt of allScriptTexts.filter(Boolean)) {
            const jwtInfo = CustomScriptParser.detectJwtUsage(txt);
            if (jwtInfo.isJwt) {
              this.hasJwt = true;
              this.jwtVarNames.push(...jwtInfo.outputVars);
              console.log(`  ✓ JWT detected in "${req.name}" (library: ${jwtInfo.library}, algorithm: ${jwtInfo.algorithm})`);
              break; // one detection per request is enough
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

    // UUID header detection — covers {{$guid}}/{{$randomUUID}} Postman built-ins AND
    // known UUID-generating header keys (x-fapi-interaction-id, x-request-id, etc.).
    // Runs after CSRF scan so we don't duplicate already-classified CSRF vars.
    // Must run BEFORE analyzeCommonHeaders() so new perRequestVars are seen there.
    {
      const UUID_HEADER_RE = /^(x-fapi-interaction-id|x-request-id|x-correlation-id|x-trace-id|x-interaction-id|x-idempotency-key|idempotency-key|x-b3-traceid|request-id|correlation-id)$/i;
      const GUID_BUILTIN   = /^\{\{\s*\$(guid|randomUUID)\s*\}\}$/i;

      const allReqsUuid = [
        ...this.requests,
        ...(this.options.setupRequests    || []),
        ...(this.options.teardownRequests || []),
      ];

      allReqsUuid.forEach(req => {
        (req.headers || []).filter(h => h.key && h.value && !h.disabled).forEach(h => {
          const val = String(h.value).trim();

          // Trigger 1: value is {{$guid}} or {{$randomUUID}} — any header key
          if (GUID_BUILTIN.test(val)) {
            const varName = this._headerKeyToVarName(h.key) || 'requestGuid';
            if (!this.perRequestVars.has(varName) && !this.dynamicVarNames.has(varName)) {
              this.perRequestVars.set(varName, { generationType: 'uuid', requestNames: [] });
              this.scriptSetVarNames.add(varName);
              console.log(`  ✓ UUID header "${h.key}: {{$guid}}" → per-request gen_uuid("_${varName}")`);
            }
            if (this.perRequestVars.has(varName)) {
              this.perRequestVars.get(varName).requestNames.push(req.name);
            }
            // Mutate so replaceParameters() emits {_varName} for this header
            h.value = `{{${varName}}}`;
            return;
          }

          // Trigger 2: UUID-generating header key with {{varName}} value
          if (!UUID_HEADER_RE.test(h.key)) return;
          const m = val.match(/^\{\{([^}$][^}]*)\}\}$/);
          if (!m) return;
          const varName = m[1].trim();
          if (!varName) return;
          if (this.perRequestVars.has(varName)) return;
          if (this.parameters.has(varName)) return;

          this.perRequestVars.set(varName, { generationType: 'uuid', requestNames: [req.name] });
          this.scriptSetVarNames.add(varName);
          console.log(`  ✓ UUID header "${h.key}" → per-request gen_uuid("_${varName}")`);
        });
      });
    }

    // Detect NTLM/Kerberos auth (from JMX AuthManager or collection auth)
    this.detectNtlmKerberos();

    // Detect mTLS client certificate files uploaded alongside the collection
    this.detectMtlsCert();

    // Large base64 extraction — scan after parameterization so replaceParameters() works
    this.scanForLargeBase64();

    // Collect JSR223 variable names/types so they can be declared globally before Action().
    const allReqsForScan = [
      ...this.requests,
      ...(this.options.setupRequests    || []),
      ...(this.options.teardownRequests || []),
    ];
    this.scanJsr223Vars(allReqsForScan);

    // Build hostname → variable name map for server host parameterization
    this.buildHostVarMap();
  }

  /**
   * Scan all JSR223 pre/post scripts across the given requests and populate
   * this.jsr223GlobalVars with the C variable names and types that will be
   * needed at global scope (before Action(), vuser_init(), vuser_end()).
   */
  scanJsr223Vars(requests) {
    const JAVA_ONLY_EXPR = /=~|\bm\b|\bPattern\b|\bMatcher\b|\.group\s*\(|\.matcher\s*\(|\.compile\s*\(|\.matches\s*\(|\.find\s*\(|Pattern\.compile|new\s+Pattern|groovy\.xml|JsonSlurper|XMLSlurper|XmlParser|Base64|MessageDigest|HmacSHA|SecretKey|KeySpec|KeyFactory|Cipher\b|Mac\b|Signature\b|KeyPair|\bRSA\b|\bAES\b|\bDES\b|PKCS|DigestUtils|CryptoJS|getBytes\s*\(|\.sign\s*\(|\.verify\s*\(|JwtBuilder|Jwts\b|Claims\b|signWith\s*\(|\.replace\s*\(|\.substring\s*\(|\.substr\s*\(|\.indexOf\s*\(|\.lastIndexOf\s*\(|\.split\s*\(|\.join\s*\(|\.trim\s*\(\)|\.toLowerCase\s*\(\)|\.toUpperCase\s*\(\)|\.startsWith\s*\(|\.endsWith\s*\(|\.charAt\s*\(|\.slice\s*\(|System\.|Runtime\.|Thread\.|Process\.|ClassLoader\.|File\b|Files\.|Paths?\.|Arrays\.|Collections\.|Properties\b|getProperty\b|getenv\b/;
    const JAVA_RESIDUAL  = /[A-Z][a-zA-Z0-9_]+\s*\.\s*[a-z]/;

    const processScript = (scriptObj) => {
      const { code } = (typeof scriptObj === 'string')
        ? { code: scriptObj, lang: 'groovy' } : (scriptObj || {});
      if (!code?.trim()) return;

      for (const rawLine of code.split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('//') || line.startsWith('import ') || line.startsWith('package ')) continue;

        const m = line.match(/^(?:String|int|long|double|Object|def|var)\s+(\w+)\s*=\s*(.+?);\s*$/);
        if (!m) continue;
        const localVar = m[1];
        const rawVal   = m[2].trim();
        if (JAVA_ONLY_EXPR.test(rawVal)) continue;
        const valExpr = this._convertJavaExprC(rawVal);
        if (JAVA_RESIDUAL.test(valExpr) ||
            /new\s+[A-Z]|(?:prev|ctx|sampler|SampleResult)\s*\.|getResponse|groovy\.|apache\.|java\./.test(valExpr)) continue;

        if (valExpr.includes('time(NULL)')) {
          this.jsr223GlobalVars.set(localVar, 'char[64]');
        } else {
          this.jsr223GlobalVars.set(localVar, 'const char *');
        }
      }
    };

    for (const req of requests) {
      for (const sc of (req.preScripts  || [])) processScript(sc);
      for (const sc of (req.postScripts || [])) processScript(sc);
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

    // JSR223 script variables — declared globally so they are visible across
    // the entire Action() / vuser_init() / vuser_end() scope (C89 requirement).
    const jsr223Decls = this.jsr223GlobalVars.size > 0
      ? Array.from(this.jsr223GlobalVars.entries())
          .map(([name, cType]) =>
            cType === 'char[64]'
              ? `static char          ${name}[64];`
              : `static const char   *${name} = NULL;`)
          .join('\n') + '\n'
      : '';

    return `#ifndef _GLOBALS_H
#define _GLOBALS_H

#include "lrun.h"
#include "web_api.h"
#include "lrw_custom_body.h"

${jsr223Decls}static void gen_uuid(const char *param_name) {
    lr_param_sprintf(param_name,
        "%08x-%04x-4%03x-%04x-%04x%08x",
        rand(),
        rand() & 0xffff,
        rand() & 0x0fff,
        (rand() & 0x3fff) | 0x8000,
        rand() & 0xffff,
        rand());
}

static void gen_csrf_token(const char *param_name) {
    lr_param_sprintf(param_name,
        "%08x%08x%08x%08x",
        rand(), rand(), rand(), rand());
}

static void gen_hex64(const char *param_name) {
    lr_param_sprintf(param_name,
        "%08x%08x%08x%08x%08x%08x%08x%08x",
        rand(), rand(), rand(), rand(), rand(), rand(), rand(), rand());
}

#endif
`;
  }

  generateVuserInitC() {
    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';

    // JWT vars detected — build active validation block for each JWT variable.
    // JWT note: web_js_run() in Action() handles JWT generation via jsrsasign.js.
    // No pre-generation or validation needed in vuser_init.c.
    const jwtNote = '';

    // NTLM / Kerberos authentication block
    const ntlmBlock = this.hasNtlm ? `
    web_set_user("{ntlmUsername}", "{ntlmPassword}", "{ntlmDomain}");
` : '';

    // mTLS client certificate block (when a cert was uploaded but JWT is NOT active)
    const certBlock = (this.mtlsCertFile && !this.hasJwt) ? `
    web_set_certificate_ex(
        "CertFilePath=${this.mtlsCertFile}",
        "CertFormat=${this.mtlsCertFile.toLowerCase().endsWith('.p12') || this.mtlsCertFile.toLowerCase().endsWith('.pfx') ? 'PFX' : 'PEM'}",
        "KeyFilePath=${this.mtlsCertFile}",
        "KeyFormat=${this.mtlsCertFile.toLowerCase().endsWith('.p12') || this.mtlsCertFile.toLowerCase().endsWith('.pfx') ? 'PFX' : 'PEM'}",
        LAST);
` : '';

    // ── SetUp Thread Group content ────────────────────────────────────────────
    // HTTP requests from JMeter setUp TG go here. JSR223 samplers become TODOs.
    const setupRequests = this.options.setupRequests || [];
    const setupScripts  = this.options.setupScripts  || [];
    let setupBlock = '';
    for (const req of setupRequests) {
      setupBlock += this.generateWebFunction(req, '    ');
    }

    const hasSetup = setupRequests.length || setupScripts.length;

    return `vuser_init()
{
${jwtNote}${ntlmBlock}${certBlock}${setupBlock}
    return 0;
}
`;
  }

  generateVuserEndC() {
    const scriptName = this.collection.info?.name || this.collection.name || 'VuGenScript';

    // ── TearDown Thread Group content ─────────────────────────────────────────
    const teardownRequests = this.options.teardownRequests || [];
    const teardownScripts  = this.options.teardownScripts  || [];
    let teardownBlock = '';
    for (const req of teardownRequests) {
      teardownBlock += this.generateWebFunction(req, '    ');
    }

    const hasTeardown = teardownRequests.length || teardownScripts.length;

    return `vuser_end()
{
${teardownBlock}
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
    web_set_certificate_ex(
        "CertFilePath=transport.pem",
        "CertFormat=PEM",
        "KeyFilePath=transport.pem",
        "KeyFormat=PEM",
        LAST);

    web_js_run(
        "Code=createJWT(LR.getParam('client_id'),LR.getParam('token_url'),LR.getParam('scope'),LR.getParam('signing_private_key'));",
        "ResultParam=_jwt_token",
        SOURCES,
        "File=jsrsasign.js",
        ENDITEM,
        LAST);
` : '';

    // Global persistent headers — applied to ALL subsequent requests automatically.
    // web_add_auto_header() persists until explicitly removed, unlike web_add_header().
    const autoHeaderLines = Array.from(globalHeaders.entries())
      .map(([k, v]) => `    web_add_auto_header("${k}", "${this.applyHostVars(v).replace(/"/g, '\\"')}");`)
      .join('\n');
    const autoHeaderBlock = globalHeaders.size > 0
      ? `\n${autoHeaderLines}\n`
      : '';

    const hostSaveStrings = this.hostVarMap && this.hostVarMap.size > 0
      ? Array.from(this.hostVarMap.entries())
          .map(([host, varName]) => `    lr_save_string("${host}", "${varName}");`)
          .join('\n') + '\n'
      : '';

    let code = `Action()
{
    web_set_sockets_option("SSL_VERSION", "AUTO");
${hostSaveStrings}${jwtSetup}${autoHeaderBlock}

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

      requests.forEach((request, idx) => {
        const txName = this.formatTransactionName(request.name, txCounter);
        this.transactionNames.push(txName);
        txCounter++;

        // Per-request transaction wrapper
        code += `    lr_start_transaction("${txName}");\n\n`;
        code += this.generateRequestBlock(request, 1);
        code += `\n\n    lr_end_transaction("${txName}", LR_AUTO);\n`;

        if (this.options.thinkTime > 0) {
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
      const txName = this.formatTransactionName(request.name, txCounter);
      this.transactionNames.push(txName);
      txCounter++;

      code += `    lr_start_transaction("${txName}");\n\n`;
      code += this.generateRequestBlock(request, 1);
      code += `\n    lr_end_transaction("${txName}", LR_AUTO);\n`;

      if (this.options.thinkTime > 0) {
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
   */
  generateRequestBlock(request, indentLevel = 1) {
    const indent = '    '.repeat(indentLevel);
    let code = '';

    // 0. JSR223 Pre-processor (JMX only) — runs before the request.
    // Each script is wrapped in its own { } so C89 declarations inside are block-scoped
    // and don't conflict with declarations from other requests' pre-processors.
    if (request.preScripts && request.preScripts.length) {
      for (const sc of request.preScripts) {
        const block = this.convertJsr223Script(sc, 'Pre', indent + '    ');
        if (block) {
          code += `${indent}{\n`;
          code += block;
          code += `${indent}}\n`;
        }
      }
    }

    // 1. Per-request dynamic variable generation (e.g. x-fapi-interaction-id UUID)
    code += this.generatePerRequestVarCode(request, indent);

    // 2. Correlation registrations (must come BEFORE the producing request)
    code += this.generateCorrelationRegistrations(request, indent);

    // 3. Headers
    code += this.generateAddHeaders(request, indent);

    // 4. Web function
    code += this.generateWebFunction(request, indent);

    // 5. JSR223 Post-processor (JMX only) — runs after the request.
    // Each script is wrapped in its own { } so C89 declarations are block-scoped.
    if (request.postScripts && request.postScripts.length) {
      for (const sc of request.postScripts) {
        const block = this.convertJsr223Script(sc, 'Post', indent + '    ');
        if (block) {
          code += `${indent}{\n`;
          code += block;
          code += `${indent}}\n`;
        }
      }
    }

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

  /**
   * Inject JMX-explicit extractors into this.correlations so VuGen web_reg_save_param_*
   * calls are emitted for them automatically.
   */
  injectJmxExtractors() {
    const seenNames = new Set(this.correlations.map(c => c.name));
    for (const request of this.requests) {
      for (const item of (request.extractors || [])) {
        if (item.listen !== 'extractor' || !item.extractor) continue;
        const extractor = item.extractor;
        const name = extractor.name;
        if (!name || seenNames.has(name)) continue;
        seenNames.add(name);

        const base = {
          name,
          producerRequest:  request.name,
          consumerRequests: [],
          scope:       extractor.scope       || 'body',
          matchNumber: extractor.matchNumber || '1',
        };

        let corr;
        switch ((extractor.type || '').toLowerCase()) {
          case 'regex':
          case 'regexp':
            corr = { ...base, extractorType: 'regex',
                     pattern: extractor.regex || '(.+?)' };
            break;
          case 'jsonpath':
          case 'json':
            corr = { ...base, extractorType: 'json',
                     extractPath: extractor.jsonPath || extractor.expression || `$.${name}` };
            break;
          case 'boundary':
            corr = { ...base, extractorType: 'boundary',
                     leftBound:  extractor.leftBoundary  || extractor.lowerBound || '',
                     rightBound: extractor.rightBoundary || extractor.upperBound || '' };
            break;
          case 'xpath':
          case 'xpath2':
            corr = { ...base, extractorType: 'xpath',
                     xpathQuery: extractor.xpath || `//${name}` };
            break;
          default:
            corr = { ...base, extractorType: 'regex', pattern: '(.+?)' };
        }
        this.correlations.push(corr);
      }
    }
  }

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

      switch (corr.type || corr.extractorType) {
        case 'json':
        case 'jsonpath':
        case 'token':
        case 'id':
        case 'sessionId':
          // web_reg_save_param_json: first arg is "ParamName=xxx"
          code += `${indent}web_reg_save_param_json("ParamName=${corr.name}",\n`;
          code += `${indent}    "QueryString=${jsonPath}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;

        case 'header': {
          // Extract from response header — web_reg_save_param with Search=Headers
          // extractPath holds the header name (e.g. "x-csrf-token")
          const headerName = corr.extractPath || corrBase;
          code += `${indent}web_reg_save_param("ParamName=${corr.name}",\n`;
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
          code += `${indent}web_reg_save_param("ParamName=${corr.name}",\n`;
          code += `${indent}    "LB=${this.escapeCString(cookieName)}=",\n`;
          code += `${indent}    "RB=;",\n`;
          code += `${indent}    "Search=Headers",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;
        }

        case 'boundary':
        case 'csrf': {
          // web_reg_save_param: Search=Body by default (omit for body, explicit for others)
          const bScope = this._vugenSearchFilter(corr.scope || corr.extractorScope);
          code += `${indent}web_reg_save_param("ParamName=${corr.name}",\n`;
          if (corr.leftBoundary)  code += `${indent}    "LB=${this.escapeCString(corr.leftBoundary)}",\n`;
          if (corr.rightBoundary) code += `${indent}    "RB=${this.escapeCString(corr.rightBoundary)}",\n`;
          if (bScope) code += `${indent}    "Search=${bScope}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;
        }

        case 'regex':
        case 'regexp': {
          // web_reg_save_param_regexp: uses "Scope=" (not "Search="), default is Body.
          // Map JMX useHeaders value → VuGen Scope= value.
          // Attribute name is "Ordinal=" (not "Ord=") per VuGen 25.x docs.
          const vScope = this._vugenRegexpScope(corr.scope || corr.extractorScope);
          code += `${indent}web_reg_save_param_regexp("ParamName=${corr.name}",\n`;
          code += `${indent}    "RegExp=${this.escapeCString(corr.pattern || `${corrBase}=([^&"'\\s]+)`)}",\n`;
          code += `${indent}    "Group=1",\n`;
          if (vScope) code += `${indent}    "Scope=${vScope}",\n`;
          // matchNo: 1 = first, -1 = random (use 1 for VuGen)
          const matchNo = Math.max(1, parseInt(corr.matchNumber || '1', 10));
          code += `${indent}    "Ordinal=${matchNo}",\n`;
          code += `${indent}    LAST);\n`;
          break;
        }

        case 'xpath': {
          // web_reg_save_param_xpath: extracts from XML/HTML body using XPath expression
          const xpathQuery = corr.xpathQuery || `//${corrBase}`;
          code += `${indent}web_reg_save_param_xpath("ParamName=${corr.name}",\n`;
          code += `${indent}    "QueryString=${this.escapeCString(xpathQuery)}",\n`;
          code += `${indent}    "Ord=1",\n`;
          code += `${indent}    LAST);\n`;
          break;
        }

        default:
          // Fallback: JSON path using variable name as field
          code += `${indent}web_reg_save_param_json("ParamName=${corr.name}",\n`;
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
      `${indent}web_add_header("${h.key}", "${this.applyHostVars(this.replaceParameters(String(h.value)))}");\n`
    ).join('');
  }

  /**
   * Normalize auth section lookup — handles both formats:
   *   Postman array: auth.bearer = [{ key: 'token', value: '...' }, ...]
   *   Bruno object:  auth.bearer = { token: '...' }
   */
  getAuthValue(authSection, key) {
    if (!authSection) return undefined;
    if (Array.isArray(authSection)) return authSection.find(e => e.key === key)?.value;
    return authSection[key];
  }

  getAuthHeader(request) {
    const auth = request.auth || this.collection.auth;
    if (!auth || !auth.type || auth.type === 'noauth') return null;

    switch (auth.type) {
      case 'bearer': {
        const token = this.getAuthValue(auth.bearer, 'token');
        if (token) return { key: 'Authorization', value: `Bearer ${token}` };
        break;
      }
      case 'apikey': {
        const keyName   = this.getAuthValue(auth.apikey, 'key');
        const keyVal    = this.getAuthValue(auth.apikey, 'value');
        const placement = this.getAuthValue(auth.apikey, 'in');
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
    code += `${indent}    "URL=${this.applyHostVars(url)}",\n`;
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
    code += `${indent}    "URL=${this.applyHostVars(url)}",\n`;
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
    return str
      .replace(/\r/g, '')     // strip carriage returns (CRLF → LF, lone CR → gone)
      .replace(/"/g, '\\"');
  }

  /**
   * Convert a JSR223/BeanShell script (Java/Groovy) to VuGen C equivalents.
   * Emits lr_save_string / lr_eval_string calls for known patterns;
   * all other lines become TODO comments.
   */
  convertJsr223Script(scriptObj, phase, indent) {
    if (!scriptObj) return '';
    const { code, lang } = (typeof scriptObj === 'string')
      ? { code: scriptObj, lang: 'groovy' }
      : scriptObj;
    if (!code || !code.trim()) return '';

    const langLabel = lang === 'javascript' ? 'JavaScript' : lang === 'beanshell' ? 'BeanShell' : 'Groovy';
    // Variables declared globally in globals.h — only emit assignments here.
    const statements        = [];  // lr_save_string, lr_param_sprintf, assignments, etc.
    // Track vars assigned so far — allows safe cross-line reference in vars.put("k", localVar).
    const declaredLocalVars = new Set();
    let skipped = 0;

    // Patterns in raw Java/Groovy value expressions that have NO C equivalent.
    // Any line whose value matches this is skipped entirely (counted in TODO note).
    const JAVA_ONLY_EXPR = /=~|\bm\b|\bPattern\b|\bMatcher\b|\.group\s*\(|\.matcher\s*\(|\.compile\s*\(|\.matches\s*\(|\.find\s*\(|Pattern\.compile|new\s+Pattern|groovy\.xml|JsonSlurper|XMLSlurper|XmlParser|Base64|MessageDigest|HmacSHA|SecretKey|KeySpec|KeyFactory|Cipher\b|Mac\b|Signature\b|KeyPair|\bRSA\b|\bAES\b|\bDES\b|PKCS|DigestUtils|CryptoJS|getBytes\s*\(|\.sign\s*\(|\.verify\s*\(|JwtBuilder|Jwts\b|Claims\b|signWith\s*\(|\.replace\s*\(|\.substring\s*\(|\.substr\s*\(|\.indexOf\s*\(|\.lastIndexOf\s*\(|\.split\s*\(|\.join\s*\(|\.trim\s*\(\)|\.toLowerCase\s*\(\)|\.toUpperCase\s*\(\)|\.startsWith\s*\(|\.endsWith\s*\(|\.charAt\s*\(|\.slice\s*\(|System\.|Runtime\.|Thread\.|Process\.|ClassLoader\.|File\b|Files\.|Paths?\.|Arrays\.|Collections\.|Properties\b|getProperty\b|getenv\b/;

    // After _convertJavaExprC(), check if the result still contains Java constructs.
    // Catches anything the explicit rules above missed (e.g. custom Java classes).
    // Pattern: UpperCaseIdentifier.lowerCaseMethod — typical Java static call style.
    const JAVA_RESIDUAL = /[A-Z][a-zA-Z0-9_]+\s*\.\s*[a-z]/;

    // What makes a safe C r-value after conversion?
    //   • string literal  "..."
    //   • number          123
    //   • lr_eval_string(...) — LR param read
    //   • (long)time(NULL) — timestamp
    //   • a local var previously declared in this same block
    const isSafeCValue = (expr, localVars) =>
      /^"[^"]*"$/.test(expr) ||
      /^\d/.test(expr) ||
      /^lr_eval_string\(/.test(expr) ||
      /^\(long\)time\(NULL\)/.test(expr) ||
      expr === '__VUGEN_UUID__' ||
      localVars.has(expr.trim());

    for (const rawLine of code.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('import ') || line.startsWith('package ')) continue;

      // vars.put / props.put → lr_save_string (pure statements — no declarations needed)
      const putMatch = line.match(/^(?:vars|props)\.put\s*\(\s*["']([^"']+)["']\s*,\s*(.+?)\s*\);\s*$/);
      if (putMatch) {
        const varName = putMatch[1].replace(/[^a-zA-Z0-9_]/g, '_');
        const rawVal  = putMatch[2].trim();
        if (JAVA_ONLY_EXPR.test(rawVal)) { skipped++; continue; }
        const valExpr = this._convertJavaExprC(rawVal);
        if (JAVA_RESIDUAL.test(valExpr)) { skipped++; continue; }
        if (valExpr.includes('__VUGEN_UUID__')) {
          statements.push(`${indent}lr_param_sprintf("_uuid", "%08x-%04x-%04x-%04x-%012x", rand(), rand()&0xFFFF, rand()&0xFFFF, rand()&0xFFFF, rand());`);
          statements.push(`${indent}lr_save_string(lr_eval_string("{_uuid}"), "${varName}");`);
        } else if (isSafeCValue(valExpr, declaredLocalVars)) {
          statements.push(`${indent}lr_save_string(${valExpr}, "${varName}");`);
        } else {
          // Value is an identifier that was never declared as a C variable — skip safely.
          skipped++;
        }
        continue;
      }

      // Type declarations: String x = expr; / def x = expr; / int x = expr;
      // Variables are declared globally in globals.h (by scanJsr223Vars) — emit assignment only.
      const typeAssignMatch = line.match(/^(?:String|int|long|double|Object|def|var)\s+(\w+)\s*=\s*(.+?);\s*$/);
      if (typeAssignMatch) {
        const localVar = typeAssignMatch[1];
        const rawVal   = typeAssignMatch[2].trim();
        if (JAVA_ONLY_EXPR.test(rawVal)) { skipped++; continue; }
        const valExpr  = this._convertJavaExprC(rawVal);
        if (JAVA_RESIDUAL.test(valExpr) ||
            /new\s+[A-Z]|(?:prev|ctx|sampler|SampleResult)\s*\.|getResponse|groovy\.|apache\.|java\./.test(valExpr)) {
          skipped++; continue;
        }
        if (valExpr.includes('__VUGEN_UUID__')) {
          statements.push(`${indent}lr_param_sprintf("_uuid", "%08x-%04x-%04x-%04x-%012x", rand(), rand()&0xFFFF, rand()&0xFFFF, rand()&0xFFFF, rand());`);
          statements.push(`${indent}${localVar} = lr_eval_string("{_uuid}");`);
          declaredLocalVars.add(localVar);
        } else if (valExpr.includes('time(NULL)')) {
          statements.push(`${indent}sprintf(${localVar}, "%ld", ${valExpr});`);
          declaredLocalVars.add(localVar);
        } else if (isSafeCValue(valExpr, declaredLocalVars) || this.jsr223GlobalVars.has(localVar)) {
          statements.push(`${indent}${localVar} = ${valExpr};`);
          declaredLocalVars.add(localVar);
        } else {
          skipped++;
        }
        continue;
      }

      // log.* → silently drop
      if (/^log\.(info|debug|warn|error)\s*\(/.test(line)) continue;

      skipped++;
    }

    if (statements.length === 0) return '';

    return statements.join('\n') + '\n';
  }

  /**
   * Scan all request URLs and header values to extract unique hostnames.
   * Builds this.hostVarMap: hostname → LR param name (ServerHost, ServerHost1, ...).
   */
  buildHostVarMap() {
    const hostFreq = new Map();

    const extractHosts = (str) => {
      if (!str) return;
      const matches = String(str).match(/https?:\/\/([^\/\s"'`?#{}]+)/g) || [];
      for (const m of matches) {
        const host = m.replace(/^https?:\/\//, '');
        if (!host || /[{$]/.test(host)) continue;
        if (/^localhost$|^127\.|^::1$|^\d+\.\d+\.\d+\.\d+$/.test(host)) continue;
        hostFreq.set(host, (hostFreq.get(host) || 0) + 1);
      }
    };

    const allReqs = [
      ...this.requests,
      ...(this.options.setupRequests    || []),
      ...(this.options.teardownRequests || []),
    ];

    for (const req of allReqs) {
      extractHosts(req.url);
      for (const h of (req.headers || [])) {
        if (h.value && !h.disabled) extractHosts(String(h.value));
      }
      if (req.body?.urlencoded) {
        for (const p of req.body.urlencoded) extractHosts(p.value || '');
      }
      if (req.body?.raw) extractHosts(req.body.raw);
    }

    if (this.variableMap) {
      for (const [, val] of this.variableMap) extractHosts(String(val || ''));
    }

    const sorted = [...hostFreq.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

    this.hostVarMap = new Map();
    let counter = 0;
    for (const [host] of sorted) {
      // VuGen LR param names: ServerHost, ServerHost1, ServerHost2, ...
      const varName = counter === 0 ? 'ServerHost' : `ServerHost${counter}`;
      this.hostVarMap.set(host, varName);
      counter++;
    }
  }

  /**
   * Replace known hostnames with {ServerHost} LR parameter references.
   */
  applyHostVars(str) {
    if (!str || !this.hostVarMap || this.hostVarMap.size === 0) return str;
    let result = String(str);
    for (const [host, varName] of this.hostVarMap) {
      result = result.split(host).join(`{${varName}}`);
    }
    return result;
  }

  _convertJavaExprC(expr) {
    // Use a sentinel for UUID so convertJsr223Script() can emit the correct two-line C idiom.
    // lr_param_sprintf() is void — it stores into a LR parameter, not usable as an expression.
    return expr
      .replace(/UUID\.randomUUID\(\)\.toString\(\)/g, '__VUGEN_UUID__')
      .replace(/java\.util\.UUID\.randomUUID\(\)\.toString\(\)/g, '__VUGEN_UUID__')
      .replace(/System\.currentTimeMillis\(\)/g, '(long)time(NULL)*1000')
      .replace(/new\s+Date\(\)\.getTime\(\)/g, '(long)time(NULL)*1000')
      .replace(/String\.valueOf\s*\(([^)]+)\)/g, '$1')
      .replace(/\$\{([^}]+)\}/g, 'lr_eval_string("{$1}")')
      .replace(/(?:vars|props)\.get\s*\(\s*["']([^"']+)["']\s*\)/g, 'lr_eval_string("{$1}")')
      // Strip Java string-concatenation-with-empty-string idiom used for toString():
      // "value" + ""  or  "" + "value"  → just "value"
      .replace(/\s*\+\s*""\s*/g, '')
      .replace(/\s*""\s*\+\s*/g, '');
  }

  /**
   * Convert a header key (kebab-case / snake_case) to a camelCase C-safe identifier.
   * Used to synthesize a stable LR parameter name from a header key.
   *   x-fapi-interaction-id → xFapiInteractionId
   *   x-request-id          → xRequestId
   */
  _headerKeyToVarName(key) {
    const camel = String(key).toLowerCase()
      .replace(/[^a-z0-9]+([a-z0-9])/g, (_, c) => c.toUpperCase());
    return /^[a-zA-Z_]/.test(camel) ? camel : `_${camel}`;
  }

  /**
   * Returns true if the request is a jsrsasign library-fetch that must be skipped.
   * Postman/Bruno pre-request scripts load jsrsasign at runtime via HTTP before signing.
   * Our converted scripts ship jsrassign.js locally, so the fetch must not become a C request.
   * Handles parameterized hostnames (e.g. {{jsrsasignHost}}/jsrassign-latest-all-min.js).
   */
  _isJsrsasignLoadRequest(req) {
    const url  = (typeof req.url === 'string' ? req.url : req.url?.raw || '').toLowerCase();
    const name = (req.name || '').toLowerCase();
    return /jsrs?asign/.test(url) || /kjur\.github/.test(url) || /jsrs?asign/.test(name);
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

  /**
   * Map JMX extractor scope → VuGen Search= filter string (or '' for body default).
   * VuGen web_reg_save_param Search= values (boundary extractor):
   *   Body (default when omitted), Headers, Noresource, ALL
   */
  _vugenSearchFilter(scope) {
    // Used for web_reg_save_param (boundary / cookie / header extractors).
    // Search=Body is the default when the parameter is omitted — only emit for non-body scopes.
    const map = {
      'response_headers': 'Headers',
      'request_headers':  'Headers',
      'url':              'Noresource',  // closest equivalent
      'headers':          'Headers',     // legacy
      // 'response_code' / 'response_message' → no VuGen equivalent; omit (body)
    };
    return map[scope] || '';
  }

  /**
   * Map JMX extractor scope → VuGen Scope= value for web_reg_save_param_regexp.
   * web_reg_save_param_regexp uses "Scope=" (NOT "Search=").
   * Valid Scope values: Body (default), Headers, All, Cookies, NewHeaders.
   * Omit the parameter to use the default (Body).
   */
  _vugenRegexpScope(scope) {
    const map = {
      'response_headers': 'Headers',
      'request_headers':  'Headers',
      'headers':          'Headers',     // legacy
      'url':              'All',         // closest: no URL-only scope in regexp; use All
      // body / blank → omit (default is Body)
    };
    return map[scope] || '';
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

    // Strip DevWeb-format references: ${load.global.varName} / ${load.params.varName} → {{varName}}
    // These appear when JMX files were generated from or alongside DevWeb scripts.
    str = str.replace(/\$\{load\.(?:global|params)\.([^}]+)\}/g, '{{$1}}');

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

  formatTransactionName(rawName, seqNum) {
    const padded = String(seqNum).padStart(2, '0');
    let name = rawName.replace(/-/g, '_');
    name = name.replace(/^[Tt]\d+[-_]/i, '');
    name = name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '');
    name = name ? name.toUpperCase() : `REQ${padded}`;
    return `SC01_${padded}_${name}`;
  }

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
 * Generated by: Bruno to DevWeb Converter v2.7.0
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
