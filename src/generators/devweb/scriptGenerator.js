/**
 * Advanced DevWeb Script Generator
 * Integrates correlation, parameterization, authentication, and transactions
 */

const crypto = require("crypto");
const CorrelationDetector = require("../../analyzers/correlationDetector");
const ParameterizationEngine = require("../../analyzers/parameterizationEngine");
const AuthenticationHandler = require("../../analyzers/authenticationHandler");
const CustomScriptParser = require("../../analyzers/customScriptParser");
const MandatoryFilesGenerator = require("./filesGenerator");
const _u  = require("../../core/utils");
const _vc = require("../../core/variableClassifier");

class AdvancedScriptGenerator {
  constructor(requests, collection, options = {}) {
    this.requests = requests;
    this.collection = collection;
    this.options = {
      useTransactions: options.useTransactions !== false,
      useCorrelation: options.useCorrelation !== false,
      useParameterization: options.useParameterization !== false,
      useAuthentication: options.useAuthentication !== false,
      useCustomScripts: options.useCustomScripts !== false,
      generateCSVParameters: options.generateCSVParameters === true, // Disabled by default - only for CSV test data
      thinkTime: options.thinkTime || 1,
      groupByFolder: options.groupByFolder !== false,
      addComments: options.addComments !== false,
      logLevel: options.logLevel || "info",
      examplesPath: options.examplesPath || null,
      ...options,
    };

    // Initialize analyzers
    this.correlationDetector = new CorrelationDetector();
    this.paramEngine = new ParameterizationEngine();
    this.authHandler = new AuthenticationHandler();
    this.scriptParser = new CustomScriptParser();
    this.mandatoryFilesGen = new MandatoryFilesGenerator({
      scriptName:
        this.collection.info?.name || this.collection.name || "DevWebScript",
    });

    // Analysis results
    this.correlations = [];
    this.parameters = new Map();
    this.authConfigs = new Map();
    this.customScripts = new Map();
    this.requestIdCounter = 0;
    this.lastResponseVar = null; // Track current response variable for cross-method access

    // Large base64 data extraction
    // Map: hash → { varName, fileName, content, size, usedBy[] }
    this.extractedDataFiles = new Map();
    // Map: "requestName::fieldPath" → hash (for lookup during body generation)
    this.largeValueIndex = new Map();
    this.BASE64_THRESHOLD = 500; // Min chars to consider for extraction

    // Variable classification
    this.variableMap = new Map(); // All variables: name → value
    this.dynamicVarNames = new Set(); // Variables set by scripts/correlation → load.global
    this.paramVarNames = new Set(); // Variables to parameterize → load.params / load.config.user.args
    this.envVarKeys = new Set(); // Keys that came from environment files (environments.json)
    this.scriptSetVarNames = new Set(); // Variables detected as set by scripts
    // CSV column names from JMX CSVDataSet configs — always Tier 3 (nextValue: iteration)
    this.csvVarNames = new Map(); // varName → { fileName, colIndex, delimiter, recycle }

    // JWT detection — populated by detectJwtUsage() during analyze()
    this.hasJwt = false;
    this.jwtVarNames = []; // token variable names set by JWT pre-request scripts
    this.jwtClaimMap = null; // { kid:'signing_kid', iss:'client_id', ... } extracted from pre-request script

    // DPoP detection -- populated by detectDpopUsage() during analyze()
    this.hasDpop = false;
    this.dpopVarNames = []; // dpop_proof variable names set by DPoP pre-request scripts
    this.dpopKeyVar = null; // dpop_jwk variable name
    this.dpopPfUsed = false; // track if dpop-pf has been used (should only be used once)

    // NTLM/Kerberos detection — populated by detectNtlmKerberos() during analyze()
    this.hasNtlm = false;
    this.ntlmAuthType = null; // 'ntlm' | 'kerberos'
    this.ntlmHost = ''; // hostname without port for load.setUserCredentials()

    // mTLS cert detection — populated by detectMtlsCert() during analyze()
    // Each entry: { certFile, keyFile, format: 'PEM'|'PFX' }
    this.mtlsCertFiles = [];

    // Per-request dynamic variables — generated fresh before each request (e.g. UUID, nonce).
    // Map: varName → { generationType: 'uuid'|'random'|'timestamp'|'nonce', requestNames: string[] }
    // These are NOT static params and NOT response correlations — they are inline-generated.
    this.perRequestVars = new Map();

    // Pre-computed transaction map — populated by generateAction(), used by generateHeader()
    // Maps requestName → { txVar: "T01", txName: "T01_GetAccessToken" }
    this.requestTxMap = new Map();

    // Pre-computed common header analysis — populated by analyze() so both
    // generateHeader() and generateAction() see the same values.
    this._staticGlobalHeaders = new Map();  // safe to emit at module level
    this._authGlobalHeaders = new Map();  // must be set inside action() after runtime init
    this._perRequestHeaderKeys = new Set();

    // Module-level JSR223 local variable names — collected during analyze(), declared as
    // `let` before initialize() so they are never re-declared across multiple requests.
    this.jsr223ModuleVars = new Set();

    this.hostVarMap = new Map(); // hostname → JS variable name (SERVER_HOST, ...)
    this.buildVariableMap();
  }

  /**
   * Detect proxy configuration from collection variables or environment.
   *
   * Looks for variables named:
   *   proxy, proxyUrl, proxy_url, http_proxy, HTTP_PROXY, https_proxy, HTTPS_PROXY,
   *   proxyServer, proxy_server, proxyHost + proxyPort (separate)
   *
   * Supported formats:
   *   Full URL:   http://user:pass@host:8080   or   http://host:8080
   *   host:port:  userproxy.corp.net:8080
   *   Separate:   proxyHost = host, proxyPort = 8080
   *
   * @returns {{ enabled:true, host:string, port:number, username:string, password:string }|null}
   */
  detectProxyConfig() {
    const urlVarNames = [
      "proxy",
      "proxyUrl",
      "proxy_url",
      "proxyURI",
      "proxy_uri",
      "http_proxy",
      "HTTP_PROXY",
      "https_proxy",
      "HTTPS_PROXY",
      "proxyServer",
      "proxy_server",
      "httpProxy",
      "httpsProxy",
    ];
    const hostVarNames = ["proxyHost", "proxy_host", "proxyHostname"];
    const portVarNames = ["proxyPort", "proxy_port"];
    const userVarNames = [
      "proxyUser",
      "proxy_user",
      "proxyUsername",
      "proxy_username",
      "proxyUserName",
    ];
    const passVarNames = [
      "proxyPassword",
      "proxy_password",
      "proxyPass",
      "proxy_pass",
    ];

    const get = (names) => {
      for (const n of names) {
        const v = this.variableMap.get(n);
        if (v && String(v).trim()) return String(v).trim();
      }
      return "";
    };

    // Try full URL first
    for (const name of urlVarNames) {
      const raw = this.variableMap.get(name);
      if (!raw || !String(raw).trim()) continue;
      const val = String(raw).trim();
      try {
        const urlStr = val.startsWith("http") ? val : `http://${val}`;
        const u = new URL(urlStr);
        const host = u.hostname;
        const port = u.port ? parseInt(u.port) : 8080;
        const username =
          decodeURIComponent(u.username || "") || get(userVarNames);
        const password =
          decodeURIComponent(u.password || "") || get(passVarNames);
        if (host) {
          console.log(
            `  ✓ Proxy detected: ${host}:${port}${username ? " (authenticated)" : ""}`,
          );
          return { enabled: true, host, port, username, password };
        }
      } catch {
        // Might be bare host:port
        if (val.includes(":")) {
          const [host, rawPort] = val.split(":");
          const port = parseInt(rawPort) || 8080;
          if (host && host.includes(".")) {
            console.log(`  ✓ Proxy detected: ${host}:${port}`);
            return {
              enabled: true,
              host,
              port,
              username: get(userVarNames),
              password: get(passVarNames),
            };
          }
        }
      }
    }

    // Try separate host + port variables
    const host = get(hostVarNames);
    if (host) {
      const port = parseInt(get(portVarNames)) || 8080;
      console.log(`  ✓ Proxy detected: ${host}:${port}`);
      return {
        enabled: true,
        host,
        port,
        username: get(userVarNames),
        password: get(passVarNames),
      };
    }

    return null; // no proxy found
  }

  /**
   * Detect NTLM or Kerberos authentication in any request (typically from JMX AuthManager).
   * Sets this.hasNtlm and this.ntlmAuthType when found.
   */
  detectNtlmKerberos() {
    // Resolve a credential value:
    // - If '{{AuthUsername}}', look up 'AuthUsername' in variableMap → return its value
    // - If a literal string (JMX), return it as-is
    const resolve = (val) => {
      if (!val) return '';
      const m = String(val).match(/^\{\{([^}]+)\}\}$/);
      return m ? (this.variableMap.get(m[1]) || '') : String(val);
    };

    for (const req of this.requests) {
      const authType = (req.auth?.type || '').toLowerCase();
      if (authType === 'kerberos' || authType === 'ntlm') {
        this.hasNtlm = true;
        this.ntlmAuthType = authType;

        // --- Host extraction ---
        // JMX AuthManager provides req.auth.hostport (hostname only, no port after parser fix)
        let host = req.auth?.hostport || '';
        if (!host) {
          // Postman/Bruno: extract hostname from the request URL
          const urlStr = typeof req.url === 'string' ? req.url : (req.url?.raw || '');
          try {
            const u = new URL(urlStr.replace(/\{\{[^}]+\}\}/g, 'placeholder'));
            host = u.hostname;
          } catch {
            const m = urlStr.match(/^https?:\/\/([^/:?#]+)/i);
            host = m ? m[1] : '';
          }
        }
        this.ntlmHost = host;

        // --- Credential extraction ---
        // JMX format: req.auth.username/password/domain are direct literal values
        // Postman format: req.auth[authType] is [{key, value}] where value = '{{AuthUsername}}'
        let rawUsername = req.auth?.username || null;
        let rawPassword = req.auth?.password || null;
        let rawDomain = req.auth?.domain || null;
        const authArr = req.auth?.[authType];
        if (Array.isArray(authArr)) {
          authArr.forEach((item) => {
            if (item.key === 'username') rawUsername = item.value;
            if (item.key === 'password') rawPassword = item.value;
            if (item.key === 'domain') rawDomain = item.value;
          });
        }

        // Always store under standard keys username/password/domain.
        // Resolves {{AuthUsername}} → looks up actual value in variableMap.
        // This ensures parameters.yml always uses 'username'/'password'/'domain'
        // regardless of what variable names the collection used.
        const usernameVal = resolve(rawUsername);
        const passwordVal = resolve(rawPassword);
        const domainVal = resolve(rawDomain);
        if (usernameVal) this.variableMap.set('username', usernameVal);
        if (passwordVal) this.variableMap.set('password', passwordVal);
        if (domainVal) this.variableMap.set('domain', domainVal);

        console.log(
          `  ✓ ${authType.toUpperCase()} authentication detected — host: ${host || '(unknown)'}`,
        );
        return;
      }
    }
  }

  /**
   * Detect uploaded mTLS client certificate files (non-JWT).
   * Supports .p12 (self-contained), .pem (cert or cert+key), .key (private key).
   * Pairs .pem + .key by matching basenames; unpaired .pem uses itself as key.
   * Populates this.mtlsCertFiles array of { certFile, keyFile, format }.
   */
  detectMtlsCert() {
    const paths = this.options.csvFilePaths || {};
    const allFiles = Object.keys(paths);

    const pemFiles = allFiles.filter(f => f.toLowerCase().endsWith('.pem') || f.toLowerCase().endsWith('.crt') || f.toLowerCase().endsWith('.cer'));
    const keyFiles = allFiles.filter(f => f.toLowerCase().endsWith('.key'));
    const p12Files = allFiles.filter(f => f.toLowerCase().endsWith('.p12') || f.toLowerCase().endsWith('.pfx'));

    const usedKeys = new Set();

    for (const pem of pemFiles) {
      const base = pem.replace(/\.[^.]+$/, '').toLowerCase();
      const matchedKey = keyFiles.find(k => k.replace(/\.[^.]+$/, '').toLowerCase() === base);
      if (matchedKey) {
        usedKeys.add(matchedKey);
        this.mtlsCertFiles.push({ certFile: pem, keyFile: matchedKey, format: 'PEM' });
        console.log(`  ✓ Client cert pair detected: ${pem} + ${matchedKey}`);
      } else {
        this.mtlsCertFiles.push({ certFile: pem, keyFile: pem, format: 'PEM' });
        console.log(`  ✓ Client certificate detected: ${pem}`);
      }
    }

    for (const p12 of p12Files) {
      this.mtlsCertFiles.push({ certFile: p12, keyFile: p12, format: 'PFX' });
      console.log(`  ✓ Client certificate detected: ${p12}`);
    }

    // Standalone .key files with no matching .pem are skipped
    const skipped = keyFiles.filter(k => !usedKeys.has(k));
    if (skipped.length) {
      console.warn(`  ⚠  Skipped standalone key file(s) with no matching .pem: ${skipped.join(', ')}`);
    }
  }

  /**
   * Scan all JSR223 pre/post scripts and collect local variable names that will be
   * converted to JavaScript. These are declared as `let` at module level (before
   * initialize()) so they are never re-declared inside action() across requests.
   */
  collectJsr223ModuleVars() {
    this.jsr223ModuleVars.clear();
    const JAVA_ONLY = /=~|\bPattern\b|\bMatcher\b|\.group\s*\(|\.matcher\s*\(|\.matches\s*\(|\.find\s*\(|Pattern\.compile|groovy\.xml|JsonSlurper|XMLSlurper|XmlParser|Base64|MessageDigest|HmacSHA|SecretKey|KeySpec|KeyFactory|Cipher\b|Mac\b|Signature\b|KeyPair|\bRSA\b|\bAES\b|\bDES\b|PKCS|DigestUtils|System\.|Runtime\.|Thread\.|Process\.|ClassLoader\.|Files?\b|Paths?\.|Arrays\.|Collections\.|Properties\b|getProperty\b|getenv\b/;
    const JAVA_RESIDUAL = /[A-Z][a-zA-Z0-9_]+\s*\.\s*[a-z]/;

    const allScripts = [];
    for (const req of this.requests) {
      for (const sc of (req.preScripts || [])) allScripts.push(sc);
      for (const sc of (req.postScripts || [])) allScripts.push(sc);
    }

    for (const scriptObj of allScripts) {
      if (!scriptObj) continue;
      const code =
        typeof scriptObj === 'string' ? scriptObj : (scriptObj.code || '');
      if (!code.trim()) continue;
      for (const rawLine of code.split('\n')) {
        const line = rawLine.trim();
        const m = line.match(/^(?:String|int|long|double|Object|def|var)\s+(\w+)\s*=\s*(.+?);\s*$/);
        if (!m) continue;
        const rawVal = m[2].trim();
        if (JAVA_ONLY.test(rawVal)) continue;
        // Quick expression conversion (mirrors _convertJavaExpr)
        const converted = /["']/.test(rawVal) && /(?:vars|props)\.get\s*\(/.test(rawVal) && /\+/.test(rawVal)
          ? this._convertConcatToTemplate(rawVal)
          : rawVal
              .replace(/UUID\.randomUUID\(\)\.toString\(\)/g, 'load.utils.uuid()')
              .replace(/System\.currentTimeMillis\(\)/g, 'Date.now()')
              .replace(/(?:vars|props)\.get\s*\(\s*["']([^"']+)["']\s*\)/g, (_, n) => `load.global.${n}`)
              .replace(/\s*\+\s*""\s*/g, '').replace(/\s*""\s*\+\s*/g, '');
        if (!converted.startsWith('`') && JAVA_RESIDUAL.test(converted)) continue;
        this.jsr223ModuleVars.add(m[1]);
      }
    }
  }

  /**
   * Build a map of all variables from collection and environment file
   */
  buildVariableMap() {
    this.envVarKeys = new Set();

    // JMX collections are identified by info.type === 'jmeter'.
    // For JMX, User Defined Variables with empty values are intentional placeholders
    // that must be kept. For Postman/Bruno, empty-value variables are noise (the
    // collection defines them but they have no usable value) and should be skipped
    // so they don't pollute the generated script with `load.global.name = null;`
    // declarations or empty CSV/userArguments entries.
    const isJmx = this.collection?.info?.type === 'jmeter';

    // Extract collection variables
    if (this.collection.variable) {
      this.collection.variable.forEach((variable) => {
        const v = variable.value;
        if (!isJmx && (v === undefined || v === null || v === '')) return;
        this.variableMap.set(variable.key, v);
      });
    }

    // Extract environment variables from collection (if available)
    if (this.collection.environment) {
      Object.entries(this.collection.environment).forEach(([key, value]) => {
        if (!isJmx && (value === undefined || value === null || value === '')) return;
        this.variableMap.set(key, value);
        this.envVarKeys.add(key);
      });
    }

    // Merge environment file variables — supplement only, never overwrite a real value
    // from collection.variable (JMX UDVs) with an empty placeholder injected by
    // injectRequestVariables() when it sees {{varName}} in request bodies.
    if (this.options.environmentVars) {
      Object.entries(this.options.environmentVars).forEach(([key, value]) => {
        if (!isJmx && (value === undefined || value === null || value === '')) {
          this.envVarKeys.add(key); // still track as env-var key even though value is empty
          return;
        }
        const existing = this.variableMap.get(key);
        if (existing === undefined || existing === null || existing === '') {
          this.variableMap.set(key, value);
        }
        this.envVarKeys.add(key); // track as env var even if value was already present
      });
    }

    // Build csvVarNames from JMX CSVDataSet configs so they are always classified
    // as Tier 3 iteration parameters (never treated as Dynamic via Rule 4).
    const csvDataSets = this.options.csvDataSets || this.collection.csvDataSets || [];
    for (const ds of csvDataSets) {
      const cols = (ds.variableNames || '').split(',').map(s => s.trim()).filter(Boolean);
      cols.forEach((col, idx) => {
        this.csvVarNames.set(col, {
          fileName: ds.filename || `${col}.csv`,
          colIndex: idx + 1,
          delimiter: ds.delimiter || ",",
          recycle: ds.recycle !== false,
        });
        if (!this.variableMap.has(col)) this.variableMap.set(col, '');
      });
    }

    // Scan all scripts in the collection to detect variables set at runtime
    this.detectScriptSetVariables();
  }

  /**
   * Scan collection scripts for variables set at runtime.
   * Covers ALL Postman and Bruno runtime variable setter APIs.
   *
   * Postman: pm.environment.set(), pm.globals.set(), pm.collectionVariables.set(),
   *          pm.variables.set(), context.set()
   * Bruno:   bru.setEnv() — PRIMARY, bru.setEnvVar(), bru.setVar()
   *          env.set() — Bruno 1.x legacy, vars.set() — Bruno legacy
   */
  detectScriptSetVariables() {
    // Groups: 1=pm.*/context (modern), 2=postman.set* (legacy Postman 2.x), 3=bru.set*, 4=env/vars legacy
    // postman.setEnvironmentVariable / postman.setGlobalVariable are the Postman 2.x API —
    // not the same as pm.environment.set() — must be matched separately.
    const setPattern =
      /(?:context|pm\.environment|pm\.collectionVariables|pm\.globals|pm\.variables)\.set\s*\(\s*["']([^"']+)["']|postman\.(?:setEnvironmentVariable|setGlobalVariable)\s*\(\s*["']([^"']+)["']|bru\.(?:setEnv|setEnvVar|setVar|setGlobalVar|setNextEnvVar)\s*\(\s*["']([^"']+)["']|(?:^|[^a-zA-Z0-9_$])(?:env|vars)\.set\s*\(\s*["']([^"']+)["']/gm;

    const scanItem = (item) => {
      // Check events (pre-request, test scripts)
      if (item.event && Array.isArray(item.event)) {
        item.event.forEach((event) => {
          if (event.script && event.script.exec) {
            const scriptText = Array.isArray(event.script.exec)
              ? event.script.exec.join("\n")
              : event.script.exec;
            let match;
            setPattern.lastIndex = 0; // reset /gm regex before each new string — Node 18+ strict lastIndex
            while ((match = setPattern.exec(scriptText)) !== null) {
              // group 1=pm.*/context, 2=postman.set* legacy, 3=bru.set*, 4=env/vars legacy
              const varName = match[1] || match[2] || match[3] || match[4];
              if (varName) this.scriptSetVarNames.add(varName);
            }
          }
        });
      }
      // Recurse into folders
      const items = item.item || item.items;
      if (Array.isArray(items)) {
        items.forEach((child) => scanItem(child));
      }
    };

    scanItem(this.collection);

    // ALSO scan normalized requests (req.tests = brunoParser normalized events).
    // brunoParser stores events in req.tests[], NOT item.event[], for Bruno YAML collections.
    // Without this pass, script-set vars (access_token, refresh_token, etc.) from Bruno
    // collections are missed → incorrectly classified as static params instead of Tier 1 dynamic.
    this.requests.forEach((req) => {
      const events = req.tests || req.event || [];
      events.forEach((ev) => {
        const exec = ev.script?.exec;
        const text = Array.isArray(exec)
          ? exec.join("\n")
          : typeof exec === "string"
            ? exec
            : "";
        if (!text) return;
        let m;
        setPattern.lastIndex = 0; // reset /gm regex before each new string — Node 18+ strict lastIndex
        while ((m = setPattern.exec(text)) !== null) {
          const varName = m[1] || m[2] || m[3] || m[4];
          if (varName) this.scriptSetVarNames.add(varName);
        }
      });
    });
  }

  /**
   * Scan all request pre-request scripts for JWT  and DPoP generation patterns (jsrsasign, jsonwebtoken, etc.).
   * Sets this.hasJwt/ this.hasDpop = true and populates output variables when detected.
   * Output variables are added to scriptSetVarNames so classifyVariables() marks them dynamic.
   */
  detectJwtUsage() {
    const CustomScriptParser = require("../../analyzers/customScriptParser");

    const scanScriptText = (text, itemName) => {
      if (!text) return;

      // Check for JWT Patterns
      const jwtResult = CustomScriptParser.detectJwtUsage(text);
      if (jwtResult.isJwt) {
        this.hasJwt = true;
        jwtResult.outputVars.forEach((v) => {
          this.jwtVarNames.push(v);
          this.scriptSetVarNames.add(v); // ensure they're Tier 1 dynamic
        });
        // Extract claim-to-parameter mappings from the JWT-detected script.
        const map = CustomScriptParser.extractJwtClaimMap(text);
        if (
          map &&
          Object.keys(map).length >
            (this.jwtClaimMap ? Object.keys(this.jwtClaimMap).length : 0)
        ) {
          this.jwtClaimMap = map;
          console.log(`  ✓ JWT claim map extracted: ${JSON.stringify(this.jwtClaimMap)}`);
        }
        console.log(
          `  ✓ JWT detected (library: ${jwtResult.library}, algorithm: ${jwtResult.algorithm})`,
        );
      }

      // Check for DPoP patterns
      const dpopResult = CustomScriptParser.detectDpopUsage(text);
      if (dpopResult.isDpop) {
        this.hasDpop = true;
        dpopResult.outputVars.forEach((v) => {
          this.dpopVarNames.push(v);
          this.scriptSetVarNames.add(v); // ensure they're Tier 1 dynamic
        });
        if (dpopResult.keyVar) {
          this.dpopKeyVar = dpopResult.keyVar;
          this.scriptSetVarNames.add(dpopResult.keyVar); // JWK is also dynamic
        }
        console.log(`  ✓ DPoP detected (key variable: ${dpopResult.keyVar})`);
      }

      // Per-request dynamic var detection (UUID/nonce/random generated per request)
      const perReqVars = CustomScriptParser.detectPerRequestDynamicVars(text);
      perReqVars.forEach(({ varName, generationType }) => {
        if (!this.perRequestVars.has(varName)) {
          this.perRequestVars.set(varName, { generationType, requestNames: [] });
          this.scriptSetVarNames.add(varName);
        }
        if (itemName) this.perRequestVars.get(varName).requestNames.push(itemName);
      });
    };

    const scanItem = (item) => {
      // Scan both item.event[] (Bruno/Postman) AND item.tests[] (JMX) — pre-request scripts
      const events = [...(item.event || []), ...(item.tests || [])];
      events.forEach((event) => {
        // For JWT: scan pre-request scripts + all scripts (JSR223 post-processors can generate JWT too)
        const exec = event.script?.exec;
        const text = Array.isArray(exec) ? exec.join('\n') : exec || '';
        scanScriptText(text, item.name);
      });

      // Recurse into sub-items
      const items = item.item || item.items;
      if (Array.isArray(items)) items.forEach((child) => scanItem(child));
    };

    scanItem(this.collection);

    // Also directly scan JMX preScripts / postScripts stored as { code, lang } objects
    // These are identical scripts but easier to access on the request object directly.
    for (const req of this.requests) {
      for (const sc of [...(req.preScripts || []), ...(req.postScripts || [])]) {
        const text = typeof sc === 'string' ? sc : sc?.code || '';
        scanScriptText(text, req.name);
      }
    }
  }

  /**
   * Classify all variables into dynamic (load.global) vs parameterized (load.params).
   * Must be called AFTER correlation detection and script parsing.
   * Classification rules (0-5) live in core/variableClassifier.js — single source of truth.
   */
  classifyVariables() {
    // ── Step 1: Shared classification (Rules 0-5) ──────────────────────────
    const { dynamicVarNames, paramVarNames, usernameParam } = _vc.classifyVariables({
      variableMap:       this.variableMap,
      correlations:      this.correlations,
      scriptSetVarNames: this.scriptSetVarNames,
      csvVarNames:       this.csvVarNames,
      envVarKeys:        this.envVarKeys || new Set(),
    });
    this.dynamicVarNames = dynamicVarNames;
    this.paramVarNames   = paramVarNames;

    // ── Step 2: Build DevWeb-specific parameters map ───────────────────────
    // Uses collection_data.csv (DevWeb format). CSV columns get their actual file info.
    for (const name of this.paramVarNames) {
      const value      = this.variableMap.get(name);
      const csvInfo    = this.csvVarNames.get(name);
      const isCredential = _vc.CREDENTIAL_PATTERN.test(name);

      if (csvInfo) {
        this.parameters.set(name, {
          name,
          type:      "csv",
          fileName:  csvInfo.fileName,
          columnName: name,
          nextValue: "iteration",
          nextRow:   "sequential",
          onEnd:     csvInfo.recycle ? "loop" : "last",
          paramValue: "",
        });
      } else {
        this.parameters.set(name, {
          name,
          type:      "csv",
          fileName:  "collection_data.csv",
          columnName: name,
          nextValue: isCredential ? "iteration" : "once",
          nextRow:   "sequential",
          onEnd:     "loop",
          paramValue: value !== undefined && value !== null ? String(value) : "",
        });
      }
    }

    // Link all columns from the same CSV file (col 2..N → same as col 1)
    const csvFileFirstCol = new Map();
    for (const [col, info] of this.csvVarNames) {
      if (!csvFileFirstCol.has(info.fileName)) csvFileFirstCol.set(info.fileName, col);
    }
    for (const [name, config] of this.parameters.entries()) {
      const csvInfo = this.csvVarNames.get(name);
      if (!csvInfo) continue;
      const firstCol = csvFileFirstCol.get(csvInfo.fileName);
      if (firstCol && firstCol !== name) config.nextRow = `same as ${firstCol}`;
    }

    // Link password-like params to username for non-CSV params
    if (usernameParam) {
      for (const [name, config] of this.parameters.entries()) {
        if (/^(password|pwd|passwd)$/i.test(name) && !this.csvVarNames.has(name)) {
          config.nextRow = `same as ${usernameParam}`;
        }
      }
    }

    console.log(
      `✓ Classified variables: ${this.paramVarNames.size} parameterized, ${this.dynamicVarNames.size} dynamic`,
    );
  }

  /**
   * Check if a string is base64 encoded (allowing whitespace/newlines)
   */
  isBase64(str) {
    if (!str || typeof str !== "string") return false;
    const stripped = str.replace(/\s/g, "");
    if (stripped.length < this.BASE64_THRESHOLD) return false;
    // Base64 charset: A-Z, a-z, 0-9, +, /, = (padding)
    return /^[A-Za-z0-9+/=]+$/.test(stripped);
  }

  /**
   * Generate a short hash for deduplication
   */
  hashContent(content) {
    return crypto
      .createHash("md5")
      .update(content)
      .digest("hex")
      .substring(0, 12);
  }

  /**
   * Sanitize a string into a safe file/variable name
   */
  safeFileName(requestName, fieldPath) {
    const name = `${requestName}_${fieldPath}`
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "")
      .replace(/^[0-9]+_?/, "") // Strip leading digits — JS identifiers cannot start with a number
      .substring(0, 60);
    return name || "data_file";
  }

  /**
   * Scan all requests for large base64 values in bodies.
   * Registers them in extractedDataFiles (deduplicated by content hash)
   * and largeValueIndex (for lookup during body generation).
   */
  scanForLargeBase64() {
    let totalFound = 0;
    let deduplicated = 0;

    this.requests.forEach((request) => {
      if (!request.body || !["POST", "PUT", "PATCH"].includes(request.method))
        return;

      if (request.body.mode === "raw" && request.body.raw) {
        try {
          const jsonBody = JSON.parse(request.body.raw);
          this._scanObjectForBase64(
            jsonBody,
            request.name,
            "",
            (fieldPath, value) => {
              const hash = this.hashContent(value);
              const indexKey = `${request.name}::${fieldPath}`;

              if (this.extractedDataFiles.has(hash)) {
                // Deduplicate: same content already extracted
                this.extractedDataFiles.get(hash).usedBy.push(request.name);
                this.largeValueIndex.set(indexKey, hash);
                deduplicated++;
              } else {
                const varName = this.safeFileName(request.name, fieldPath);
                const fileName = `${varName}.b64`;
                this.extractedDataFiles.set(hash, {
                  varName,
                  fileName,
                  content: value,
                  size: value.length,
                  usedBy: [request.name],
                });
                this.largeValueIndex.set(indexKey, hash);
                totalFound++;
              }
            },
          );
        } catch (e) {
          // Not JSON — check if the entire raw body is base64
          if (this.isBase64(request.body.raw)) {
            const hash = this.hashContent(request.body.raw);
            const indexKey = `${request.name}::__raw__`;

            if (this.extractedDataFiles.has(hash)) {
              this.extractedDataFiles.get(hash).usedBy.push(request.name);
              this.largeValueIndex.set(indexKey, hash);
              deduplicated++;
            } else {
              const varName = this.safeFileName(request.name, "body");
              const fileName = `${varName}.b64`;
              this.extractedDataFiles.set(hash, {
                varName,
                fileName,
                content: request.body.raw,
                size: request.body.raw.length,
                usedBy: [request.name],
              });
              this.largeValueIndex.set(indexKey, hash);
              totalFound++;
            }
          }
        }
      }
    });

    if (totalFound > 0 || deduplicated > 0) {
      console.log(
        `✓ Extracted ${totalFound + deduplicated} large values to data/ folder (${totalFound} unique, ${deduplicated} deduplicated)`,
      );
    }
  }

  /**
   * Recursively scan a JSON object for large base64 string values.
   * Calls onFound(fieldPath, value) for each match.
   */
  _scanObjectForBase64(obj, requestName, currentPath, onFound) {
    if (typeof obj === "string") {
      if (this.isBase64(obj)) {
        onFound(currentPath, obj);
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        this._scanObjectForBase64(
          item,
          requestName,
          `${currentPath}[${index}]`,
          onFound,
        );
      });
      return;
    }
    if (typeof obj === "object" && obj !== null) {
      Object.entries(obj).forEach(([key, value]) => {
        const path = currentPath ? `${currentPath}.${key}` : key;
        this._scanObjectForBase64(value, requestName, path, onFound);
      });
    }
  }

  /**
   * Generate complete DevWeb script with all advanced features
   */
  async generate(outputDir = null) {
    console.log("🔍 Analyzing collection...");

    // Run analysis
    await this.analyze();

    console.log("📝 Generating script...");

    // Generate script sections
    const initSection = this.generateInitialize();
    const actionSection = this.generateAction();
    const finalizeSection = this.generateFinalize();

    // Generate comment listing parameterized variables that need values in CSV
    let configComment = "";
    const emptyParams = [];
    for (const [name, config] of this.parameters.entries()) {
      if (!config.paramValue || config.paramValue === "") {
        emptyParams.push(name);
      }
    }
    if (emptyParams.length > 0) {
      configComment = `\n/**\n * CONFIGURATION REQUIRED:\n * The following parameters have empty values in collection_data.csv:\n${emptyParams
        .sort()
        .map((v) => ` *   - ${v}`)
        .join(
          "\n",
        )}\n * \n * Please update collection_data.csv with the correct values before running.\n */\n`;
    }

    // Combine sections
    const fullScript = `${this.generateHeader()}${configComment}

${initSection}

${actionSection}

${finalizeSection}
`;

    const result = {
      script: fullScript,
      analysis: this.getAnalysisReport(),
    };

    // Generate mandatory files if output directory specified
    if (outputDir) {
      console.log("📦 Generating mandatory files...");
      result.mandatoryFiles = await this.mandatoryFilesGen.generateAll(
        outputDir,
        this.parameters,
        {
          transactionNames: this.transactionNames || [],
          hasJwt: this.hasJwt || false,
          hasDpop: this.hasDpop || false,
          jwtClaimMap: this.jwtClaimMap || null,
          proxy: this.detectProxyConfig(),
          mtlsCertFiles: this.mtlsCertFiles,
        },
      );

      // Copy all uploaded mTLS cert/key files to output directory
      if (this.mtlsCertFiles.length > 0) {
        const fs = require("fs");
        const path = require("path");
        const csvPaths = this.options.csvFilePaths || {};
        const copied = new Set();
        for (const { certFile, keyFile } of this.mtlsCertFiles) {
          for (const fname of [certFile, keyFile]) {
            if (copied.has(fname)) continue;
            copied.add(fname);
            const srcPath = csvPaths[fname];
            if (srcPath && fs.existsSync(srcPath)) {
              fs.copyFileSync(srcPath, path.join(outputDir, fname));
              console.log(`✓ Copied mTLS certificate: ${fname}`);
            } else {
              console.warn(`  ⚠  mTLS cert ${fname} not found in uploaded files.`);
            }
          }
        }
      }

      // Write extracted base64 data files to data/ subfolder
      if (this.extractedDataFiles.size > 0) {
        const fs = require("fs");
        const path = require("path");
        const dataDir = path.join(outputDir, "data");
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        for (const [hash, fileInfo] of this.extractedDataFiles.entries()) {
          const filePath = path.join(dataDir, fileInfo.fileName);
          fs.writeFileSync(filePath, fileInfo.content, "utf8");
          console.log(
            `✓ Extracted: data/${fileInfo.fileName} (${(fileInfo.size / 1024).toFixed(1)} KB, used by ${fileInfo.usedBy.length} request(s))`,
          );
        }
        result.extractedDataFiles = Array.from(
          this.extractedDataFiles.values(),
        ).map((f) => f.fileName);
      }

      // Copy DPoP helper file if DPoP is detected
      if (this.hasDpop) {
        const fs = require("fs");
        const path = require("path");
        const PROJECT_ROOT = path.join(__dirname, '..', '..', '..');
        const dpopHelperSrc = path.join(PROJECT_ROOT, 'dpop-helper.js');
        if (!fs.existsSync(dpopHelperSrc)) {
          fs.copyFileSync(dpopHelperSrc, path.join(outputDir, 'dpop-helper.js'));
          console.log(`✓ Copied dpop-helper.js`);
        } else {
          console.warn(`  ⚠  dpop-helper.js not found in project root. Add it there and re-run`);
        }
      }
    }

    return result;
  }

  /**
   * Return true if a request is a jsrsasign library-loading request that should be skipped.
   *
   * In Postman/Bruno collections, users sometimes add a request to load the jsrsasign
   * library from kjur.github.io before their JWT-signing pre-request script runs.
   * We replace this with our own jwt-helper.js / jsrsasign.js, so the request itself
   * must be dropped — it would otherwise generate a meaningless HTTP call in the script.
   *
   * Detection is intentionally broad to handle parameterized hostnames, e.g.:
   *   http://kjur.github.io/jsrassign/jsrassign-latest-all-min.js   (direct)
   *   {{jsrsasignHost}}/jsrassign-latest-all-min.js                 (parameterized host)
   *   https://cdnjs.cloudflare.com/ajax/libs/jsrsasign/...          (CDN)
   */
  _isJsrsasignLoadRequest(req) {
    const url = (typeof req.url === 'string' ? req.url : req.url?.raw || '').toLowerCase();
    const name = (req.name || '').toLowerCase();
    // Match the jsrsasign filename pattern in path OR the kjur.github.io hostname
    return (/jsrs?asign/.test(url) || /kjur\.github/.test(url) || /jsrs?asign/.test(name));
  }

  /**
   * Analyze collection for correlations, parameters, and auth
   */
  async analyze() {
    // Remove jsrsasign library-loading requests — these are Postman/Bruno pre-flight requests
    // that load the JWT library at runtime. We provide jwt-helper.js instead, so these
    // requests must be dropped before any further processing.
    const beforeFilter = this.requests.length;
    this.requests = this.requests.filter(r => !this._isJsrsasignLoadRequest(r));
    if (this.requests.length < beforeFilter) {
      console.log(`  ✓ Skipped ${beforeFilter - this.requests.length} jsrsasign library-loading request(s)`);
    }

    // Detect correlations (must run before variable classification)
    if (this.options.useCorrelation) {
      this.correlations = this.correlationDetector.analyzeRequests(
        this.requests,
        this.collection,
      );
      // Inject JMX-explicit extractors (RegexExtractor, BoundaryExtractor, etc.)
      // stored on req.extractors[] by jmxParser — not detectable from script content.
      this.injectJmxExtractors();
      // Inject script-detected variables that analyzeRequests() missed due to
      // producer-after-consumer ordering (token endpoint placed after consumers in collection).
      this.injectScriptExtractors();
      console.log(`✓ Found ${this.correlations.length} correlation(s)`);
    }

    // Extract authentication
    if (this.options.useAuthentication) {
      this.authConfigs = this.authHandler.extractAuthentication(
        this.collection,
      );
      console.log(`✓ Configured ${this.authConfigs.size} authentication(s)`);
    }

    // Parse custom scripts (must run before variable classification)
    if (this.options.useCustomScripts) {
      this.parseCustomScripts();
      console.log(`✓ Parsed ${this.customScripts.size} custom script(s)`);
    }

    // Detect NTLM/Kerberos auth BEFORE classifyVariables() so that credential values
    // injected into variableMap (from JMX AuthManager) are picked up for parameterization.
    this.detectNtlmKerberos();

    // Classify all variables into dynamic vs parameterized
    // Must run AFTER correlations and scripts are detected
    if (this.options.useParameterization) {
      this.classifyVariables();
    }

    // Share dynamic var knowledge with auth handler so it emits load.global.X
    // for correlated/script-set tokens instead of incorrectly using load.params.X
    this.authHandler.setDynamicVarNames(this.dynamicVarNames);

    // Detect JWT usage in pre-request scripts (sets this.hasJwt and this.jwtVarNames)
    this.detectJwtUsage();

    // Detect DPoP from request headers - covers collections/HARs where DPoP proofs
    // are hardcoded in headers with no pre-request script (browser-generated DPoP).
    // Must run AFTER detectJwtUsage() which also sets this.hasDpop from scripts.
    if (!this.hasDpop) {
      for (const req of this.requests) {
        if (this.requestUsesDpop(req)) {
          this.hasDpop = true;
          if (!this.dpopKeyVar) this.dpopKeyVar = 'dpop_jwk'; // default key variable if not set by script
          console.log(`✓ DPOP usage detected from request headers (${req.name})`);
          break;
        }
      }
    }

    // Detect mTLS client certificate files uploaded alongside the collection
    this.detectMtlsCert();

    // Collect JSR223 local variable names so they can be declared at module level
    this.collectJsr223ModuleVars();

    // Detect UUID-generating headers ({{$guid}}, x-fapi-interaction-id, x-request-id, etc.)
    // Must run BEFORE analyzeCommonHeaders() so the registered perRequestVars are visible.
    this.detectUuidHeaders();

    // Pre-compute common header analysis once so generateHeader() and generateAction()
    // both see the same maps without re-running the analysis.
    const { staticGlobal, authGlobal, perRequestKeys } = this.analyzeCommonHeaders();
    this._staticGlobalHeaders = staticGlobal;
    this._authGlobalHeaders = authGlobal;
    this._perRequestHeaderKeys = perRequestKeys;

    // Route sensitive collection-level headers to authGlobal (applied in action())
    // instead of letting them land in static module-level defaults.
    const SENSITIVE_HDR_RE = /^(authorization|private-token|x-api-key|api-key|apikey|x-auth-token|x-access-token|cookie|set-cookie|proxy-authorization|www-authenticate|x-csrf-token|x-xsrf-token)$/i;
    const SENSITIVE_NAME_RE = /token|secret|key|auth|credential|password|session/i;
    for (const h of (this.collection.collectionHeaders || [])) {
      if (!h.key || !h.value || h.disabled) continue;
      if (SENSITIVE_HDR_RE.test(h.key) || SENSITIVE_NAME_RE.test(h.key)) {
        const v = this.replaceParameters(h.value);
        const q = v.includes('${') ? `\`${v}\`` : `"${v}"`;
        this._authGlobalHeaders.set(h.key, q);
      }
    }

    // Scan for large base64 values in request bodies
    this.scanForLargeBase64();

    // Build hostname → variable name map for server host parameterization
    this.buildHostVarMap();
  }

  /**
   * Parse custom scripts from Bruno/Postman requests
   */
  parseCustomScripts() {
    this.requests.forEach((request) => {
      const scripts = {};

      const preScript = this.extractScriptFromRequest(request, "prerequest");
      if (preScript) {
        scripts.preRequest = this.scriptParser.parsePreRequestScript(
          preScript,
          request.name,
        );
      }

      const testScript = this.extractScriptFromRequest(request, "test");
      if (testScript) {
        scripts.test = this.scriptParser.parseTestScript(
          testScript,
          request.name,
        );
      }

      if (scripts.preRequest || scripts.test) {
        this.customScripts.set(request.name, scripts);
      }
    });
  }

  /**
   * Extract script string from request in any format (normalized or original Postman)
   */
  extractScriptFromRequest(request, listenType) {
    // Direct string properties
    if (listenType === "prerequest" && request.preRequestScript) {
      return request.preRequestScript;
    }
    if (listenType === "test" && request.testScript) {
      return request.testScript;
    }

    // Normalized format: request.tests is array of {listen, script} objects
    if (request.tests && Array.isArray(request.tests)) {
      const event = request.tests.find((e) => e.listen === listenType);
      if (event && event.script) {
        if (event.script.exec && Array.isArray(event.script.exec)) {
          return event.script.exec.join("\n");
        }
        if (typeof event.script === "string") return event.script;
      }
    }

    // Original Postman format: request.event
    if (request.event && Array.isArray(request.event)) {
      const event = request.event.find((e) => e.listen === listenType);
      if (event && event.script && event.script.exec) {
        return event.script.exec.join("\n");
      }
    }

    return null;
  }

  /**
   * Generate script header
   */
  /**
   * Analyse headers across all requests and classify them.
   *
   * Returns { staticGlobal, authGlobal, perRequestKeys }:
   *   staticGlobal  — static-value headers present in ≥70% of requests (put in module-level defaults)
   *   authGlobal    — dynamic-token headers present in ≥70% of requests (put at start of action())
   *   perRequestKeys — headers that vary per request or contain per-request UUID vars
   *
   * Rules:
   *   - Browser baseline headers (accept-*) are always staticGlobal.
   *   - Headers containing a perRequestVar (UUID/nonce) are always perRequest.
   *   - Correlation target vars (load.global.X) → authGlobal if common, perRequest if rare.
   *   - Pure static params → staticGlobal if common.
   */
  analyzeCommonHeaders() {
    const headerFreq = new Map(); // key → { staticCount, values: Map<value, count> }
    const totalRequests = this.requests.length || 1;

    this.requests.forEach((req) => {
      (req.headers || [])
        .filter((h) => h.key && h.value && !h.disabled)
        .forEach((h) => {
          if (!headerFreq.has(h.key))
            headerFreq.set(h.key, { count: 0, values: new Map() });
          const entry = headerFreq.get(h.key);
          entry.count++;
          const raw = String(h.value);
          entry.values.set(raw, (entry.values.get(raw) || 0) + 1);
        });
    });

    const staticGlobal = new Map(); // key → replaceParameters(value) expression
    const authGlobal = new Map(); // key → replaceParameters(value) expression
    const perRequestKeys = new Set(); // keys that are per-request

    const THRESHOLD = 0.7;

    headerFreq.forEach((entry, key) => {
      const freq = entry.count / totalRequests;
      if (freq < THRESHOLD) return; // not common enough — per-request

      // Find the dominant value (most-used)
      let dominantRaw = "";
      let dominantCount = 0;
      entry.values.forEach((cnt, val) => {
        if (cnt > dominantCount) {
          dominantRaw = val;
          dominantCount = cnt;
        }
      });

      // Only promote to global if the dominant value itself convers >= 70% of requests.
      // A header key that appears in 100% of requests but with 5 different values
      // should NOT be global - each request needs its own value.
      const dominantFreq = dominantCount / totalRequests;
      if (dominantFreq < THRESHOLD) return;

      // Check if this header uses a per-request dynamic var (UUID/nonce)
      const isPerRequestVar =
        this.perRequestVars &&
        Array.from(this.perRequestVars.keys()).some((v) =>
          dominantRaw.includes(`{{${v}}}`),
        );
      if (isPerRequestVar) {
        perRequestKeys.add(key);
        return;
      }

      const valueExpr = this.replaceParameters(dominantRaw);
      const needsTpl = valueExpr.includes("${");
      const quoted = needsTpl ? `\`${valueExpr}\`` : `"${valueExpr}"`;

      // Sensitive / auth-related header names must NEVER be in static module-level
      // defaults - they conatin credentials, tokens, or API keys that should be
      // parameterized or set dynamically at runtime.
      const keyLower = key.toLowerCase();
      const isSensitiveKey = /^(authorization|private-token|x-api-key|api-key|apikey|x-auth-token|x-access-token|cookie|set-cookie|proxy-authorization|www-authenticate|x-csrf-token|x-xsrf-token)$/.test(keyLower) ||
        /token|secret|key|auth|credential|password|session/i.test(keyLower);

      // Dynamic vars (load.global.X) and per-iteration params (load.params.X) must
      // NOT be emitted at module level — DevWeb only populates these during lifecycle
      // execution (initialize/action), so they go into authGlobal (applied in action()).
      // Sensitive headers also go to authGlobal regardless of value type.
      // Static literals with no variable refs are safe at module level → staticGlobal.
      if (isSensitiveKey || valueExpr.includes("load.global.") || valueExpr.includes("Bearer") ||
        valueExpr.includes("load.params.")) {
        authGlobal.set(key, quoted);
      } else {
        staticGlobal.set(key, quoted);
      }
    });

    return { staticGlobal, authGlobal, perRequestKeys };
  }

  generateHeader() {
    const timestamp = new Date().toISOString();
    const collectionName =
      this.collection.info?.name || this.collection.name || "Unknown";

    // Use pre-computed maps from analyze() — avoids re-running the analysis and
    // ensures generateAction() (called before generateHeader()) sees identical values.
    const staticGlobal = this._staticGlobalHeaders;
    const authGlobal = this._authGlobalHeaders;

    // ── Module-level declarations ────────────────────────────────────────────
    // These run ONCE when the script loads — before any lifecycle function.

    const jwtRequire = this.hasJwt
      ? `// JWT Helper — fast token generation using Node.js built-in crypto (no npm install)\nconst { getJwtToken } = require('./jwt-helper.js');\n`
      : "";

    const dpopRequire = this.hasDpop
      ? `// DPoP Helper — EC P-256 key generation and DPoP proof signing\nconst { getDpopProof } = require('./dpop-helper.js');\n`
      : "";

    // Uploaded certs take precedence; JWT falls back to transport.pem when no certs uploaded.
    let certSetup = '';
    if (this.mtlsCertFiles.length > 0 && !this.hasJwt) {
      certSetup = this.mtlsCertFiles
        .map(c => `load.setUserCertificate('./${c.certFile}', './${c.keyFile}');`)
        .join('\n') + '\n\n';
    } else if (this.hasJwt) {
      certSetup = `load.setUserCertificate('./transport.pem', './transport.pem');\n\n`;
    }

    // Static browser baseline + static collection headers.
    // Sensitive collection headers were already routed to authGlobal during analyze().
    const collectionHeaders = this.collection.collectionHeaders || [];
    const collectionHeaderLines = collectionHeaders
      .filter((h) => h.key && h.value && !h.disabled)
      .filter((h) => !this._authGlobalHeaders.has(h.key)) // skip those already in authGlobal
      .map((h) => {
        const v = this.applyHostVars(this.replaceParameters(h.value));
        const q = v.includes("${") ? `\`${v}\`` : `"${v}"`;
        return `    "${h.key}": ${q}`;
      });

    // Helper: apply host vars to an already-quoted value string
    const reHostQuoted = (quoted) => {
      if (!this.hostVarMap || this.hostVarMap.size === 0) return quoted;
      const isBacktick = quoted.startsWith('`') && quoted.endsWith('`');
      const isDouble = quoted.startsWith('"') && quoted.endsWith('"');
      if (!isBacktick && !isDouble) return quoted;
      const inner = quoted.slice(1, -1);
      const processed = this.applyHostVars(inner);
      if (processed === inner) return quoted;
      return processed.includes('${') ? '`' + processed + '`' : '"' + processed + '"';
    };

    // Merge browser defaults + detected static globals + collection headers
    const staticHeaderLines = [
      `    "accept-encoding": "gzip, deflate, br"`,
      `    "accept-language": "en-US,en;q=0.9"`,
      `    "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"`,
      ...Array.from(staticGlobal.entries())
        .filter(
          ([k]) =>
            !["accept-encoding", "accept-language", "user-agent"].includes(
              k.toLowerCase(),
            ),
        )
        .map(([k, v]) => `    "${k}": ${reHostQuoted(v)}`),
      ...collectionHeaderLines,
    ].join(",\n");

    // Auth/dynamic global headers — set in action() AFTER token is available
    // NOTE: authGlobal headers (Authorization, etc.) contain load.global.X references
    // that are null at module-load time. They are applied at the START of action()
    // after the token has been fetched — see the Object.assign block in generateAction().
    const authDefaultsBlock = ""; // empty at module level — applied in action() start

    // Pre-computed in analyze() — nothing to reassign here.

    // Server host variable declarations — update these to target different environments
    const hostVarDecls = this.hostVarMap && this.hostVarMap.size > 0
        ? Array.from(this.hostVarMap.entries())
            .map(([host, varName]) => `let ${varName} = '${host}';`)
            .join("\n") + "\n\n"
        : "";

    return `${jwtRequire}${dpopRequire}${certSetup}${hostVarDecls}load.WebRequest.defaults.returnBody = false;
load.WebRequest.defaults.headers = {
${staticHeaderLines}
};
${authDefaultsBlock}
${
  this.requestTxMap && this.requestTxMap.size > 0
    ? Array.from(this.requestTxMap.values())
        .map(
          ({ txVar, txName }) =>
            `const ${txVar} = new load.Transaction("${txName}");`,
        )
        .join("\n")
    : ""
}
${
  this.jsr223ModuleVars && this.jsr223ModuleVars.size > 0
    ? Array.from(this.jsr223ModuleVars).map((v) => `let ${v};`).join('\n') + '\n'
    : ''
}
`;
  }

  /**
   * Generate initialize section
   */
  generateInitialize() {
    // JWT initialization — only when JWT signing detected.
    // cert + require declared at module level; only token fetch here.
    const jwtBlock = this.hasJwt
      ? (() => {
          const cm = this.jwtClaimMap || {};
          const cmJson = this.jwtClaimMap ? JSON.stringify(this.jwtClaimMap) : 'null';
          // Dynamic audience: resolve {paramName} placeholders from the merged params object
          const audLine = cm._audTemplate
            ? `    const _jwtAud = ${JSON.stringify(cm._audTemplate)}.replace(/\\{(\\w+)\\}/g, (_, k) => _jwtParams[k] || '');\n    _jwtParams['_jwt_aud'] = _jwtAud;\n`
            : '';
          return `
    // Merge parameters.yml and rts.yml userArguments — covers both Postman/Bruno (load.params)
    // and JMX UDVs (load.config.user.args) without requiring one specific source.
    const _jwtParams = Object.assign({}, load.params, (load.config && load.config.user && load.config.user.args) || {});
${audLine}    load.global.jwt_token = getJwtToken(_jwtParams, ${cmJson});
    load.global.jwt_expires_at = Date.now() + (9 * 60 * 1000);
`;
        })()
      : "";

    // DPoP initialization - only when DPoP signing detected.
    const dpopBlock = this.hasDpop
      ? `
    // Initialize DPoP key pair and proof generation
    load.global.${this.dpopKeyVar || 'dpop_jwk'}" = load.global.${this.dpopKeyVar || 'dpop_jwk'} || null;
    `
      : "";

    // NTLM / Kerberos — set integrated credentials once in initialize()
    const ntlmBlock = this.hasNtlm ? `
    load.setUserCredentials({
        username: load.params['username'],
        password: load.params['password'],
        domain:   load.params['domain'],
        host:     '${this.ntlmHost}'
    });
` : '';

    let code = `load.initialize('Initialize', async function() {
${jwtBlock}${dpopBlock}${ntlmBlock}
    ${this.generateGlobalVariablesInit()}
`;

    // Load external data files (large base64 values extracted from request bodies)
    if (this.extractedDataFiles.size > 0) {
      code += `\n`;
      code += `    const fs = require("fs");\n`;
      const seen = new Set();
      for (const [hash, fileInfo] of this.extractedDataFiles.entries()) {
        if (!seen.has(fileInfo.varName)) {
          seen.add(fileInfo.varName);
          code += `    load.global.${fileInfo.varName} = fs.readFileSync(load.config.script.directory + "/data/${fileInfo.fileName}", "utf8").trim();\n`;
        }
      }
    }

    // Add authentication initialization
    if (this.options.useAuthentication && this.authConfigs.size > 0) {
      code += `\n    // Authentication Setup\n`;
      code += this.indent(this.authHandler.generateInitializationCode(), 1);
    }

    // Add collection-level OAuth2 / auth config from Bruno YAML request.auth
    const collAuth = this.collection.collectionAuth;
    if (collAuth && collAuth.type) {
      code += this.generateCollectionAuthBlock(collAuth);
    }

    // ── SetUp Thread Group requests / scripts ─────────────────────────────
    // HTTP requests from a JMeter SetUp Thread Group go here (run once before
    // any iteration, equivalent to vuser_init).
    // JSR223/BeanShell samplers cannot be auto-converted; emit a TODO comment.
    const setupRequests = this.options.setupRequests || [];
    const setupScripts = this.options.setupScripts || [];

    for (const req of setupRequests) {
      code += this.generateRequestCode(req, 1);
    }

    code += `\n});`;

    return code;
  }

  /**
   * Generate a commented auth block for collection-level OAuth2/auth config.
   * Emits real token-fetch code (commented out) so developers can activate it.
   */
  generateCollectionAuthBlock(auth) {
    const type = (auth.type || "").toLowerCase();
    const flow = (auth.flow || "").toLowerCase();
    let block = `\n    // ── Collection-level Auth (from Bruno request.auth) ──────────────────\n`;

    if (type === "oauth2") {
      const tokenUrl = this.replaceParameters(
        auth.accessTokenUrl || auth.tokenUrl || "{{url}}/oauth2/token",
      );
      const clientId = this.replaceParameters(
        auth.credentials?.clientId || auth.clientId || "{{clientId}}",
      );
      const clientSecret = this.replaceParameters(
        auth.credentials?.clientSecret ||
          auth.clientSecret ||
          "{{clientSecret}}",
      );
      const placement = auth.credentials?.placement || "body";

      if (flow === "client_credentials") {
        block += `    // OAuth2 Client Credentials flow detected.
    // Uncomment and adapt the block below to fetch a bearer token during initialization.
    //
    // const tokenResp = await new load.WebRequest({
    //   method: "POST",
    //   url: \`${tokenUrl}\`,
    //   body: {
    //     type: "form",
    //     formData: {
    //       grant_type: "client_credentials",
    //       client_id: \`${clientId}\`,
    //       client_secret: \`${clientSecret}\`
    //     }
    //   }${
      placement === "header"
        ? `,
    //   // Alternatively pass credentials via Basic Auth header:
    //   // headers: { Authorization: "Basic " + Buffer.from(\`${clientId}:\${${clientSecret}}\`).toString("base64") }`
        : ""
    }
    // }).send();
    // const tokenJson = JSON.parse(tokenResp.body);
    // load.global._accessToken = tokenJson.access_token;
    // load.WebRequest.defaults.headers["Authorization"] = \`Bearer \${load.global._accessToken}\`;\n`;
      } else if (flow === "password") {
        const username = this.replaceParameters(
          auth.credentials?.username || "{{username}}",
        );
        const password = this.replaceParameters(
          auth.credentials?.password || "{{password}}",
        );
        block += `    // OAuth2 Password flow detected.
    // Uncomment and adapt the block below to fetch a bearer token during initialization.
    //
    // const tokenResp = await new load.WebRequest({
    //   method: "POST",
    //   url: \`${tokenUrl}\`,
    //   body: {
    //     type: "form",
    //     formData: {
    //       grant_type: "password",
    //       client_id: \`${clientId}\`,
    //       client_secret: \`${clientSecret}\`,
    //       username: \`${username}\`,
    //       password: \`${password}\`
    //     }
    //   }
    // }).send();
    // const tokenJson = JSON.parse(tokenResp.body);
    // load.global._accessToken = tokenJson.access_token;
    // load.WebRequest.defaults.headers["Authorization"] = \`Bearer \${load.global._accessToken}\`;\n`;
      } else {
        block += `    // OAuth2 flow: "${auth.flow}" — configure token retrieval manually.\n`;
        if (auth.accessTokenUrl || auth.tokenUrl) {
          block += `    // Token URL: ${auth.accessTokenUrl || auth.tokenUrl}\n`;
        }
      }
    } else if (type === "apikey") {
      const key = auth.key || "X-API-Key";
      const value = this.replaceParameters(auth.value || "{{apiKey}}");
      const addTo = (auth.addTo || "header").toLowerCase();
      if (addTo === "header") {
        block += `    // API Key auth — already applied via collection default headers if listed there.\n`;
        block += `    // load.WebRequest.defaults.headers["${key}"] = \`${value}\`;\n`;
      } else {
        block += `    // API Key in query param "${key}" — add to each request URL as needed.\n`;
      }
    } else if (type === "bearer") {
      const token = this.replaceParameters(auth.token || "{{_accessToken}}");
      block += `    // Bearer token auth.\n`;
      block += `    // load.WebRequest.defaults.headers["Authorization"] = \`Bearer ${token}\`;\n`;
    } else {
      block += `    // Auth type "${auth.type}" — configure manually.\n`;
    }

    block += `    // ─────────────────────────────────────────────────────────────────────\n`;
    return block;
  }

  /**
   * Generate global variables initialization
   */
  /**
   * Sanitize a variable name for use as a JavaScript identifier.
   * Hyphens and other invalid chars → underscore.
   * Examples: "jsrsasign-js" → "jsrsasign_js", "access-token" → "access_token"
   */
  sanitizeVarName(name) {
    return _u.sanitizeVarName(name);
  }

  /**
   * Convert a JSR223 / BeanShell script (Java/Groovy) into DevWeb JavaScript equivalents.
   * Returns a block of code lines (indented) suitable for insertion before/after a request.
   *
   * Conversion strategy:
   *  1. Well-known single-line patterns are auto-converted (vars.put, UUID, timestamp, etc.)
   *  2. JWT-detected code → delegate to jwt-helper.js
   *  3. Remaining lines are emitted as TODO comments for manual review
   */
  convertJsr223Script(scriptObj, phase, indent) {
    if (!scriptObj) return '';
    const { code, lang } =
      typeof scriptObj === 'string'
        ? { code: scriptObj, lang: 'groovy' }
        : scriptObj;
    if (!code || !code.trim()) return '';

    const langLabel = lang === 'javascript' ? 'JavaScript' : lang === 'beanshell' ? 'BeanShell' : 'Groovy';
    const converted = [];
    // Track which local variable names were successfully converted to JS constants.
    // Used to allow safe cross-line references in vars.put("k", localVar).
    const declaredLocalVars = new Set();
    let skipped = 0;

    // Java/Groovy patterns with no JavaScript equivalent — skip the whole line.
    const JAVA_ONLY = /=~|\bPattern\b|\bMatcher\b|\.group\s*\(|\.matcher\s*\(|\.matches\s*\(|\.find\s*\(|Pattern\.compile|groovy\.xml|JsonSlurper|XMLSlurper|XmlParser|Base64|MessageDigest|HmacSHA|SecretKey|KeySpec|KeyFactory|Cipher\b|Mac\b|Signature\b|KeyPair|\bRSA\b|\bAES\b|\bDES\b|PKCS|DigestUtils|System\.|Runtime\.|Thread\.|Process\.|ClassLoader\.|Files?\b|Paths?\.|Arrays\.|Collections\.|Properties\b|getProperty\b|getenv\b/;

    // After conversion, if the expression still has Java class-style calls → skip.
    const JAVA_RESIDUAL = /[A-Z][a-zA-Z0-9_]+\s*\.\s*[a-z]/;

    // Safe JS r-values after conversion: string, number, DevWeb API, or a declared local var.
    const isSafeJsValue = (expr, localVars) =>
      /^["'`]/.test(expr) ||
      /^\d/.test(expr) ||
      /^load\./.test(expr) ||
      /^Date\.now\(\)/.test(expr) ||
      /^load\.utils\.uuid\(\)/.test(expr) ||
      localVars.has(expr.trim());

    for (const rawLine of code.split('\n')) {
      const line = rawLine.trim();
      if (!line || line.startsWith('//') || line.startsWith('import ') || line.startsWith('package ')) continue;

      // vars.put / props.put → load.global.*
      const putMatch = line.match(/^(?:vars|props)\.put\s*\(\s*["']([^"']+)["']\s*,\s*(.+?)\s*\);\s*$/);
      if (putMatch) {
        const rawVal = putMatch[2].trim();
        if (JAVA_ONLY.test(rawVal)) { skipped++; continue; }
        const valExpr = this._convertJavaExpr(rawVal);
        // isSafeJsValue already accepts backtick strings via /^["'`]/ — skip JAVA_RESIDUAL for them
        if (!valExpr.startsWith('`') && JAVA_RESIDUAL.test(valExpr)) { skipped++; continue; }
        if (isSafeJsValue(valExpr, declaredLocalVars)) {
          converted.push(`${indent}load.global.${this.sanitizeVarName(putMatch[1])} = ${valExpr};`);
        } else {
          skipped++;
        }
        continue;
      }

      // Java typed variable declaration: String x = <expr>; / def x = <expr>;
      const typeAssignMatch = line.match(/^(?:String|int|long|double|Object|def|var)\s+(\w+)\s*=\s*(.+?);\s*$/);
      if (typeAssignMatch) {
        const localVar = typeAssignMatch[1];
        const rawVal = typeAssignMatch[2].trim();
        if (JAVA_ONLY.test(rawVal)) { skipped++; continue;}
        const valExpr = this._convertJavaExpr(rawVal);
        if (!valExpr.startsWith('`') && (
          JAVA_RESIDUAL.test(valExpr) ||
          /new\s+[A-Z]|(?:prev|ctx|sampler|SampleResult)\s*\.|getResponse|groovy\.|apache\.|java\./.test(valExpr)
        )) {
          skipped++; continue;
        }
        if (isSafeJsValue(valExpr, declaredLocalVars)) {
          // If declared at module level → plain assignment; otherwise const (local scope)
          const decl = (this.jsr223ModuleVars && this.jsr223ModuleVars.has(localVar))
              ? '' : 'const ';
          converted.push(`${indent}${decl}${localVar} = ${valExpr};`);
          declaredLocalVars.add(localVar);
        } else {
          skipped++;
        }
        continue;
      }

      // log.* → silently drop (no noise in output)
      if (/^log\.(info|debug|warn|error)\s*\(/.test(line)) continue;

      // Anything else — drop and count
      skipped++;
    }

    if (converted.length === 0) return '';
    return converted.join("\n") + '\n';
  }

  /**
   * Convert a Java/Groovy expression fragment to its DevWeb JavaScript equivalent.
   */
  _convertJavaExpr(expr) {
    // Java string concatenation with vars.get()/props.get() → backtick template literal.
    // Detect: expression has a quoted string literal + concatenation + a get() call.
    if (/["']/.test(expr) && /(?:vars|props)\.get\s*\(/.test(expr) && /\+/.test(expr)) {
      return this._convertConcatToTemplate(expr);
    }
    return expr
        .replace(/UUID\.randomUUID\(\)\.toString\(\)/g, 'load.utils.uuid()')
        .replace(/java\.util\.UUID\.randomUUID\(\)\.toString\(\)/g,'load.utils.uuid()')
        .replace(/System\.currentTimeMillis\(\)/g,  'Date.now()')
        .replace(/new\s+Date\(\)\.getTime\(\)/g, 'Date.now()')
        .replace(/new\s+Date\(\)\.toInstant\(\)\.toEpochMilli\(\)/g, 'Date.now()')
        .replace(/String\.valueOf\s*\(([^)]+)\)/g, 'String($1)')
        .replace(/Integer\.toString\s*\(([^)]+)\)/g, 'String($1)')
        .replace(/Long\.toString\s*\(([^)]+)\)/g, 'String($1)')
        .replace(/\$\{([^}]+)\}/g, '${load.global.$1}')
        // vars.get("x") inline → load.global.x
        .replace(/(?:vars|props)\.get\s*\(\s*["']([^"']+)["']\s*\)/g,
          (_, n) => `load.global.${this.sanitizeVarName(n)}`)
        // Strip Java string-concatenation-with-empty-string idiom: value + ""  or  "" + value
        .replace(/\s*\+\s*""\s*/g, '')
        .replace(/\s*""\s*\+\s*/g, '');
  }

  /**
   * Convert a Java/Groovy string-concatenation expression to a JS template literal.
   * Handles: "text" + vars.get("x") + "more" → `text${load.global.x}more`
   * The char-by-char parser correctly handles \" inside Java string literals.
   */
  _convertConcatToTemplate(expr) {
    const parts = [];
    let i = 0;
    const len = expr.length;

    while (i < len) {
      // Skip whitespace
      while (i < len && /\s/.test(expr[i])) i++;
      if (i >= len) break;

      if (expr[i] === '"') {
        // Java string literal — read until closing unescaped "
        i++; // skip opening "
        let str = '';
        while (i < len) {
          if (expr[i] === '\\' && i + 1 < len) {
            const next = expr[i + 1];
            if      (next === '"')  { str += '"';  i += 2; }
            else if (next === 'n')  { str += '\n'; i += 2; }
            else if (next === 'r')  { str += '\r'; i += 2; }
            else if (next === 't')  { str += '\t'; i += 2; }
            else if (next === '\\') { str += '\\'; i += 2; }
            else                    { str += expr[i]; i++; }
          } else if (expr[i] === '"') {
            i++; break; // closing "
          } else {
            str += expr[i++];
          }
        }
        parts.push({ type: 'literal', value: str });
      } else if (expr[i] === '+') {
        i++; // skip + operator
      } else {
        // Expression segment — collect until next unparenthesised + or string literal
        let depth = 0;
        let seg = '';
        while (i < len) {
          const ch = expr[i];
          if      (ch === '(')                        { depth++; seg += ch; i++; }
          else if (ch === ')' && depth > 0)           { depth--; seg += ch; i++; }
          else if ((ch === '+' || ch === '"') && depth === 0) break;
          else                                        { seg += ch; i++; }
        }
        seg = seg.trim();
        if (seg) {
          const converted = seg.replace(
            /(?:vars|props)\.get\s*\(\s*["']([^"']+)["']\s*\)/g,
            (_, n) => `load.global.${this.sanitizeVarName(n)}`
          );
          parts.push({ type: 'expr', value: converted });
        }
      }
    }

    // Merge adjacent literals and build the template literal
    let result = '`';
    for (const part of parts) {
      if (part.type === 'literal') {
        // Escape backticks and bare $ signs in literal text
        result += part.value.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$(?=\{)/g, '\\$');
      } else {
        result += `\${${part.value}}`;
      }
    }
    result += '`';
    return result;
  }

  generateGlobalVariablesInit() {
    const vars = [];
    const seen = new Set();

    // Known JavaScript library keywords — variables holding library source code (e.g. eval(pm.globals.get('jsrsasign')))
    // are NOT LR runtime vars. Any variable whose name starts with or contains these keywords is excluded.
    const LIBRARY_KEYWORDS = [
      "jsrsasign",
      "kjur",
      "cryptojs",
      "jsonwebtoken",
      "jose",
      "forge",
      "jsbn",
    ];

    const isLibraryName = (name) => {
      const lower = name.toLowerCase().replace(/[-_.]/g, "");
      return LIBRARY_KEYWORDS.some(
        (kw) => lower === kw || lower.startsWith(kw) || lower.endsWith(kw),
      );
    };

    // Add correlation variables (deduplicated, sanitized)
    this.correlations.forEach((corr) => {
      if (!seen.has(corr.name) && !isLibraryName(corr.name)) {
        seen.add(corr.name);
        const safe = this.sanitizeVarName(corr.name);
        vars.push(`load.global.${safe} = null;`);
      }
    });

    // Add script-set dynamic variables not already covered by correlations.
    // Skip JWT output vars — already set by getJwtToken() in initialize().
    // Skip variables that come exclusively from JSR223/Groovy vars.put() calls —
    // the converted custom-script block already emits load.global.X = ... for
    // those, so a separate null-initialisation is duplicate clutter.
    const jwtOutputVars = new Set(this.jwtVarNames || []);
    const corrNames = new Set((this.correlations || []).map(c => c.name));
    this.dynamicVarNames.forEach((name) => {
      const scriptOnly = this.scriptSetVarNames.has(name) && !corrNames.has(name);
      if (scriptOnly) return; // set by converted script code — no null init needed
      if (!seen.has(name) && !isLibraryName(name) && !jwtOutputVars.has(name)) {
        seen.add(name);
        const safe = this.sanitizeVarName(name);
        vars.push(`load.global.${safe} = null;`);
      }
    });

    return vars.join("\n    ");
  }

  /**
   * Pre-compute the transaction map for ALL requests in order.
   * Maps request.name → { txVar: "T01", txName: "T01_GetAccessToken" }
   * Called once at the start of generateAction() so generateHeader() can
   * emit all declarations at module level (before initialize()).
   */
  buildTransactionMap() {
    this.requestTxMap = new Map();
    let counter = 1;

    const assign = (requests) => {
      requests.forEach((req) => {
        const seqNum = String(counter).padStart(2, "0");
        const txName = this.formatTransactionName(req.name, counter);
        const txVar = `TS${seqNum}`;
        this.requestTxMap.set(req.name, { txVar, txName });
        counter++;
      });
    };

    if (this.options.groupByFolder && this.options.useTransactions) {
      const grouped = this.groupRequestsByFolder();
      Object.values(grouped).forEach((requests) => assign(requests));
    } else {
      assign(this.requests);
    }
  }

  /**
   * Generate action section
   */
  generateAction() {
    // Pre-compute transaction names so generateHeader() can emit module-level declarations
    this.buildTransactionMap();
    // Split authGlobal headers into two buckets:
    //  - paramsEntries: load.params.xxx — must re-apply EVERY iteration (CSV advances each row)
    //  - globalEntries: load.global.xxx / Bearer — only needed when token changes
    const allAuthEntries = Array.from((this._authGlobalHeaders || new Map()).entries());
    const paramsEntries = allAuthEntries.filter(([, v]) => v.includes("load.params."));
    const globalEntries = allAuthEntries.filter(([, v]) => !v.includes("load.params."));

    // Separate globalEntries into "early" (safe to set at action start, e.g. tokens set in
    // initialize) vs "deferred" (reference correlation-extracted variables that are null until
    // a response is received, e.g. x-csrf-token extracted from the logon response).
    // Deferred entries are emitted via load.WebRequest.defaults.headers[key] = val immediately
    // after each correlation assignment in generateRequestCode(), not at action start.
    const corrVarNames = new Set((this.correlations || []).map(c => this.sanitizeVarName(c.name)));
    const isDeferredEntry = ([, v]) =>
      [...v.matchAll(/load\.global\.(\w+)/g)].some(m => corrVarNames.has(m[1]));
    const earlyGlobalEntries = globalEntries.filter(e => !isDeferredEntry(e));
    this._deferredAuthHeaders = new Map(globalEntries.filter(isDeferredEntry));

    // Block to apply per-iteration CSV param headers — runs unconditionally every action() call
    const paramsHeaderBlock =
      paramsEntries.length > 0
        ? `\n    Object.assign(load.WebRequest.defaults.headers, {\n${
          paramsEntries.map(([k, v]) => `        "${k}": ${v}`).join(',\n')
        }\n    });\n`
        : '';

    // Block to apply dynamic auth headers — runs on token refresh (JWT case only)
    const globalHeaderUpdate =
      earlyGlobalEntries.length > 0
        ? `\n        Object.assign(load.WebRequest.defaults.headers, {\n${
          earlyGlobalEntries.map(([k, v]) => `            "${k}": ${v}`)
            .join(',\n')}\n        });`
        : '';

    const jwtRefreshBlock = this.hasJwt
      ? (() => {
          const cm = this.jwtClaimMap || {};
          const cmJson = this.jwtClaimMap ? JSON.stringify(this.jwtClaimMap) : 'null';
          const audLine = cm._audTemplate
            ? `        const _jwtAud = ${JSON.stringify(cm._audTemplate)}.replace(/\\{(\\w+)\\}/g, (_, k) => _jwtParams[k] || '');\n        _jwtParams['_jwt_aud'] = _jwtAud;\n`
            : '';
          return `
    if (!load.global.jwt_token || Date.now() >= load.global.jwt_expires_at) {
        const _jwtParams = Object.assign({}, load.params, (load.config && load.config.user && load.config.user.args) || {});
${audLine}        load.global.jwt_token = getJwtToken(_jwtParams, ${cmJson});
        load.global.jwt_expires_at = Date.now() + (9 * 60 * 1000);${globalHeaderUpdate}
    }
`;
        })()
      : earlyGlobalEntries.length > 0
        ? `\n    Object.assign(load.WebRequest.defaults.headers, {\n${
          earlyGlobalEntries.map(([k, v]) => `        "${k}": ${v}`)
            .join(',\n')}\n    });\n`
        : '';

    //DPoP proof generation - generate fresh proof for each request that needs it
    const dpopProofBlock = this.hasDpop && !this.hasJwt
        ? `
    // Generate DPoP proof for requests that need it
    // This will be called per-request based on header detection
    `
        : '';

    let code = `load.action('Action', async function() {
${jwtRefreshBlock}${dpopProofBlock}${paramsHeaderBlock}
`;

    if (this.options.groupByFolder && this.options.useTransactions) {
      code += this.generateGroupedActions();
    } else {
      code += this.generateSequentialActions();
    }

    code += `\n});`;

    return code;
  }

  /**
   * Generate grouped actions by folder (as transactions)
   */
  /**
   * Generate per-request transactions.
   *
   * Each API request = one transaction: T{nn}_{RequestName}
   * Counter is global across ALL folders (T01, T02 ... Tn).
   * Folders remain as code comments for readability but have no outer transaction.
   *
   * Examples across folders:
   *   Folder Auth:      T01_Get_Access_Token, T02_Refresh_Token
   *   Folder Products:  T03_Get_Products,     T04_Create_Product
   *   Sub-folder A/B:   T05_Get_Items
   */
  generateGroupedActions() {
    const grouped = this.groupRequestsByFolder();
    let code = "";

    // Transactions are already declared at module level (in generateHeader via requestTxMap).
    // Here we only emit .start() and .stop() — no inline "let T01 = new load.Transaction()" declarations.
    const groupEntries = Object.entries(grouped);
    groupEntries.forEach(([folder, requests], groupIndex) => {
      requests.forEach((request, reqIndex) => {
        const tx = this.requestTxMap.get(request.name);
        const txVar = tx ? tx.txVar : null;

        if (txVar) code += `\n    ${txVar}.start();\n`;
        code += this.generateRequestCode(request, 1);
        if (txVar)
          code += `\n    ${txVar}.stop(load.TransactionStatus.Passed);`;

        if (this.options.thinkTime > 0) {
          code += `\n    load.sleep(${this.options.thinkTime});`;
        }
        code += "\n\n";
      });

      if (groupIndex < groupEntries.length - 1 && this.options.thinkTime > 0) {
        code += `    load.sleep(${this.options.thinkTime});\n\n`;
      }
    });

    return code;
  }

  // ── LEGACY (folder-level transactions — kept for reference, not used) ──────
  generateGroupedActionsFolderLevel() {
    const grouped = this.groupRequestsByFolder();
    let code = "";
    const transactionDeclarations = [];
    const transactionMapping = new Map();

    // Build short transaction names from the last segment of folder path
    // e.g. "Connect/Industries/Fundraising/Gifts" -> "Gifts"
    const nameCount = new Map(); // Track duplicates

    Object.entries(grouped).forEach(([folder, requests], index) => {
      const seqNum = String(index + 1).padStart(2, "0");
      const varName = `TS${seqNum}`;
      const originalName = folder || `Transaction_${index + 1}`;

      // Extract last segment of the folder path as the short transaction name
      const segments = originalName.split("/");
      let shortName = segments[segments.length - 1].trim();

      // Handle duplicates by appending _1, _2, etc.
      const count = nameCount.get(shortName) || 0;
      nameCount.set(shortName, count + 1);
      if (count > 0) {
        shortName = `${shortName}_${count}`;
      }

      transactionMapping.set(folder, {
        varName: varName,
        shortName: shortName,
        originalName: originalName,
      });
      transactionDeclarations.push(
        `let ${varName} = new load.Transaction("${shortName}");`,
      );
    });

    // Add transaction declarations
    if (transactionDeclarations.length > 0) {
      code += `\n    ${this.generateComment("Transaction declarations")}`;
      transactionDeclarations.forEach((decl) => {
        code += `\n    ${decl}`;
      });
      code += "\n";
    }

    // Now generate the actual requests with transaction start/stop
    Object.entries(grouped).forEach(([folder, requests], index) => {
      const trans = transactionMapping.get(folder);
      const safeName = trans.varName;

      code += `\n    ${this.generateComment(`${safeName} - ${trans.originalName}`)}`;
      code += `\n    ${safeName}.start();`;
      code += `\n`;

      // Track if transaction should pass/fail based on critical requests
      let hasCriticalValidation = false;

      requests.forEach((request, reqIndex) => {
        code += this.generateRequestCode(request, 1);

        // Check if this request has validation extractors
        const customScripts = this.customScripts.get(request.name);
        const hasValidation = customScripts?.test?.extractors?.some(
          (e) =>
            e.extractorType === "textcheck" || e.extractorType === "validation",
        );

        // Add conditional transaction status check for critical requests (login, auth, etc.)
        const isCritical = this.isCriticalRequest(request);
        if (isCritical || hasValidation) {
          hasCriticalValidation = true;
          const respVar = this.lastResponseVar;
          code += `\n`;
          code += `\n    // Check validation for critical request`;
          code += `\n    if (${respVar}.status !== 200 && ${respVar}.status !== 201) {`;
          code += `\n        ${safeName}.stop(load.TransactionStatus.Failed);`;
          code += `\n        return false; // Abort script execution`;
          code += `\n    }`;

          // Check for validation extractors
          if (hasValidation) {
            customScripts.test.extractors.forEach((extractor) => {
              if (
                extractor.extractorType === "textcheck" ||
                extractor.extractorType === "validation"
              ) {
                code += `\n    if (!${respVar}.extractors.${extractor.name}) {`;
                code += `\n        ${safeName}.stop(load.TransactionStatus.Failed);`;
                code += `\n        return false;`;
                code += `\n    }`;
              }
            });
          }
        }

        // Add think time between requests (except after last one)
        if (reqIndex < requests.length - 1 && this.options.thinkTime > 0) {
          code += `\n    load.sleep(${this.options.thinkTime});`;
        }
        code += `\n`;
      });

      // Stop transaction with success if no critical validation or all passed
      if (!hasCriticalValidation) {
        code += `\n    ${safeName}.stop(load.TransactionStatus.Passed);`;
      } else {
        code += `\n    // All validations passed`;
        code += `\n    ${safeName}.stop(load.TransactionStatus.Passed);`;
      }
      code += `\n`;
    });

    return code;
  }

  /**
   * Check if request is critical (login, auth, etc.)
   */
  isCriticalRequest(request) {
    const urlLower = request.url.toLowerCase();
    const nameLower = request.name.toLowerCase();

    return (
      urlLower.includes("/login") ||
      urlLower.includes("/auth") ||
      urlLower.includes("/token") ||
      urlLower.includes("/session") ||
      nameLower.includes("login") ||
      nameLower.includes("auth") ||
      nameLower.includes("token")
    );
  }

  /**
   * Generate sequential actions without grouping
   */
  generateSequentialActions() {
    let code = "";

    // Transactions already declared at module level via requestTxMap — only start/stop here
    this.requests.forEach((request, index) => {
      const tx = this.requestTxMap.get(request.name);
      const txVar = tx ? tx.txVar : null;

      if (txVar) code += `\n    ${txVar}.start();\n`;
      code += this.generateRequestCode(request, 1);
      if (txVar) code += `\n    ${txVar}.stop(load.TransactionStatus.Passed);`;

      if (this.options.thinkTime > 0) {
        code += `\n    load.sleep(${this.options.thinkTime});`;
      }
      code += `\n\n`;
    });

    return code;
  }

  /**
   * Generate code for a single request.
   * Returns { code, responseVar } so callers can reference the response variable.
   */
  generateRequestCode(request, indentLevel = 1) {
    let code = "";

    // Emit converted JSR223 pre-processor scripts (JMX only).
    // Variables are declared as `let` at module level (see generateHeader) so no
    // block-scope wrapper is needed here — plain assignment is used in action().
    if (request.preScripts && request.preScripts.length) {
      const ind = this.indent('', indentLevel);
      for (const sc of request.preScripts) {
        const block = this.convertJsr223Script(sc, 'Pre', ind);
        if (block) code += `\n${block}`;
      }
    }

    // Emit pre-request generation for CSRF/nonce/random vars (NOT uuid).
    // UUID vars are now inlined directly as load.utils.uuid() inside the header value
    // via replaceParameters(), so no pre-request global assignment is needed.
    // CSRF/nonce types must still use load.global so the same value can appear in
    // both the request header and the body within the same request.
    this.perRequestVars.forEach((info, varName) => {
      if (info.generationType === 'uuid') return; // inlined via replaceParameters — skip
      const usesVar = this.requestUsesVar(request, varName);
      if (usesVar) {
        const genExpr = this.perRequestGenExpression(info.generationType);
        code += `\n${this.indent(`load.global.${varName} = ${genExpr};`, indentLevel)}`;
      }
    });

    // Generate DPoP proof(s) if this request uses DPoP headers
    if (this.hasDpop && this.requestUsesDpop(request)) {
      const htu = this.extractDpopHtu(request);
      const htm = request.method || 'POST';
      const dpopKeys = this.getDpopHeaderKeys(request);
      for (const dk of dpopKeys) {
        // dpop-pf should only be used once per script execution
        if (dk === 'dpop-pf' && this.dpopPfUsed) {
          continue; // skip dpop-pf if already used
        }

        const varName = dk === 'dpop-pf' ? 'dpop_pf_proof' : 'dpop_proof';
        const athExpr = dk === 'dpop' ? `, load.global.${this.findBearerTokenVar()}` : '';
        code += `\n${this.indent(`load.global.${varName} = getDpopProof('${htu}', '${htm}', load.global.${this.dpopKeyVar || 'dpop_jwk'}${athExpr});`, indentLevel)}`;
        // Mark dpop-pf as used
        if (dk === 'dpop-pf') {
          this.dpopPfUsed = true; // mark dpop-pf as used to avoid regenerating it for subsequent requests
        }
      }
    }

    // Generate WebRequest options (increments requestIdCounter)
    const options = this.generateRequestOptions(request);

    // Sequential response variable: webResponse_01, webResponse_02, ...
    const seqNum = String(this.requestIdCounter).padStart(2, "0");
    const responseVar = `webResponse_${seqNum}`;

    code += `\n${this.indent(`const ${responseVar} = new load.WebRequest(${options}).sendSync();`, indentLevel)}`;

    // Emit correlation assignments — values extracted from this response
    const produces = this.getProducedCorrelations(request);
    if (produces.length > 0) {
      code += `\n`;
      produces.forEach((corr) => {
        // Sanitize name for use as JS identifier — correlation names can contain hyphens (e.g. "my-token")
        const safeCorrName = this.sanitizeVarName(corr.name);
        // Extractor registered as safeCorrName AND accessed with same name — must be identical
        code += `\n${this.indent(`load.global.${safeCorrName} = ${responseVar}.extractors["${safeCorrName}"];`, indentLevel)}`;
        // Update any auth-global default headers that reference this just-extracted variable
        // (e.g. x-csrf-token extracted from logon response → apply as default for all subsequent requests)
        if (this._deferredAuthHeaders && this._deferredAuthHeaders.size > 0) {
          const ref = `load.global.${safeCorrName}`;
          for (const [hdrKey, hdrVal] of this._deferredAuthHeaders) {
            if (hdrVal.includes(ref)) {
              code += `\n${this.indent(`load.WebRequest.defaults.headers["${hdrKey}"] = load.global.${safeCorrName};`, indentLevel)}`;
            }
          }
        }
      });
    }

    // Emit converted JSR223 post-processor scripts (JMX only).
    if (request.postScripts && request.postScripts.length) {
      const ind = this.indent('', indentLevel);
      for (const sc of request.postScripts) {
        const block = this.convertJsr223Script(sc, 'Post', ind);
        if (block) code += `\n${block}`;
      }
    }

    // Store the response variable name for this request (used by grouped actions)
    this.lastResponseVar = responseVar;

    return code;
  }

  /**
   * Check if a request uses DPoP headers (DPoP or dpop header present)
   */
  requestUsesDpop(request) {
    if (!request.headers) return false;
    return request.headers.some(h => 
      h.key && !h.disabled && /^dpop(-pf)?$/i.test(h.key.trim())
    );
  }

  /**
   * Get all DPoP header keys on a request (e.g. ['dpop'], ['dpop-pf'], or ['dpop-pf','dpop']).
   */
  getDpopHeaderKeys(request) {
    if (!request.headers) return [];
    return request.headers
      .filter(h => h.key && !h.disabled && /^dpop(-pf)?$/i.test(h.key.trim()))
      .map(h => h.key.trim().toLowerCase());
  }

  /**
   * Extract HTU (HTTP Target URI) for DPoP proof from request URL
   */
  extractDpopHtu(request) {
    const url = typeof request.url === 'string' ? request.url : request.url?.raw || '';
    // Remove query parameters for HTU
    const baseUrl = url.split('?')[0];
    return this.replaceParameters(baseUrl);
  }

  /**
   * Find the correlation variable name used as the Bearer token in Authorization headers.
   * Scans all requests for Authorization: Bearer {{varName}} and returns the first match.
   * Falls back to common names: access_token, accessToken, token, _accessToken.
   */
  findBearerTokenVar() {
    if (this._bearerTokenVar) return this._bearerTokenVar;
    // Check request headers for Authorization: Bearer {{varName}}
    for (const req of this.requests) {
      for (const h of (req.headers || [])) {
        if (!h.key || h.disabled) continue;
        if (h.key.toLowerCase() !== 'authorization') continue;
        const m = String(h.value).match(/Bearer\s+\{\{([^}]+)\}\}/i);
        if (m) {
          this._bearerTokenVar = this.sanitizeVarName(m[1].trim());
          return this._bearerTokenVar;
        }
      }
      // Also check auth config
      if (req.auth?.type === 'bearer') {
        const token = req.auth.bearer?.token || (Array.isArray(req.auth.bearer) ? req.auth.bearer.find((e) => e.key === 'token')?.value : null);
        if (token) {
          const m = String(token).match(/\{\{([^}]+)\}\}/);
          if (m) { this._bearerTokenVar = this.sanitizeVarName(m[1].trim()); return this._bearerTokenVar;}
        }
      }
    }

    // Fallback: check dynamic var names for common token patterns
    for (const name of this.dynamicVarNames) {
      if (/^_?access.?token$|^_?token$|^_?bearer.?token$/i.test(name)) {
        this._bearerTokenVar = this.sanitizeVarName(name);
        return this._bearerTokenVar;
      }
    }

    this._bearerTokenVar = "AccessToken";
    return this._bearerTokenVar;
  }

  /**
   * Check if a request uses a given variable name in its URL, headers, or body.
   * Used to decide whether to emit a per-request var generation line before this request.
   */
  requestUsesVar(request, varName) {
    const pattern = new RegExp(
      `\\{\\{\\s*${varName}\\s*\\}\\}|\\$\\{[^}]*${varName}[^}]*\\}`,
    );
    const url =
      typeof request.url === "string" ? request.url : request.url?.raw || "";
    if (pattern.test(url)) return true;
    if (request.headers?.some((h) => pattern.test(h.value || ""))) return true;
    if (request.body?.raw && pattern.test(request.body.raw)) return true;
    return false;
  }

  /**
   * Return the DevWeb JS expression for generating a per-request dynamic value.
   * Used when a pre-request script sets a variable via crypto.randomUUID() etc.
   */
  perRequestGenExpression(generationType) {
    switch (generationType) {
      case "uuid":
        return "load.utils.uuid()";
      case "nonce":
        return "require('crypto').randomBytes(16).toString('hex')";
      case "random":
        return "Math.random().toString(36).substring(2)";
      case "timestamp":
        return "Date.now().toString()";
      default:
        return "load.utils.uuid()";
    }
  }

  /**
   * Scan all request headers for UUID-generating patterns and register them as
   * per-request dynamic variables so load.utils.uuid() is called before each request.
   *
   * Three triggers handled here:
   *   1. Header value is {{$guid}} or {{$randomUUID}} (Postman built-in) —
   *      a stable var name is synthesized from the header key and the header value
   *      is mutated to {{varName}} so the existing per-request machinery takes over.
   *   2. Header key matches a known UUID-generating pattern (x-fapi-interaction-id,
   *      x-request-id, x-correlation-id, etc.) and value is a {{varName}} template —
   *      that var is registered as generationType:'uuid' if not already a correlation.
   *
   * Must be called BEFORE analyzeCommonHeaders() so the new perRequestVars are
   * visible when headers are classified as per-request vs. global.
   */
  detectUuidHeaders() {
    const UUID_HEADER_RE = /^(x-fapi-interaction-id|x-request-id|x-correlation-id|x-trace-id|x-interaction-id|x-idempotency-key|idempotency-key|x-b3-traceid|request-id|correlation-id)$/i;
    const GUID_BUILTIN = /^\{\{\s*\$(guid|randomUUID)\s*\}\}$/i;

    const allRequests = [
      ...this.requests,
      ...(this.options.setupRequests || []),
      ...(this.options.teardownRequests || []),
    ];

    allRequests.forEach(req => {
      (req.headers || [])
        .filter((h) => h.key && h.value && !h.disabled)
        .forEach((h) => {
          const val = String(h.value).trim();

          // ── Trigger 1: value is {{$guid}} or {{$randomUUID}} ───────────────────
          if (GUID_BUILTIN.test(val)) {
            const varName = this._headerKeyToVarName(h.key) || 'requestGuid';
            if (!this.perRequestVars.has(varName) && !this.dynamicVarNames.has(varName)) {
              this.perRequestVars.set(varName, { generationType: 'uuid', requestNames: []});
              this.scriptSetVarNames.add(varName);
              console.log(`  ✓ UUID header "${h.key}: {{$guid}}" → per-request load.utils.uuid() as "${varName}"`);
            }
            if (this.perRequestVars.has(varName)) {
              this.perRequestVars.get(varName).requestNames.push(req.name);
            }
            // Mutate the header value so replaceParameters() treats it as a normal dynamic var
            h.value = `{{${varName}}}`;
            return;
          }

          // ── Trigger 2: UUID-generating header key with {{varName}} value ───────
          if (!UUID_HEADER_RE.test(h.key)) return;
          const m = val.match(/^\{\{([^}$][^}]*)\}\}$/);
          if (!m) return;
          const varName = m[1].trim();
          if (!varName) return;

          // Skip if already handled as correlation target, per-request var, or static param
          if (this.perRequestVars.has(varName)) return;
          if (
            this.correlations &&
            this.correlations.some((c) => c.name === varName)
          )
            return;
          if (this.parameters && this.parameters.has(varName)) return;

          this.perRequestVars.set(varName, {
            generationType: "uuid",
            requestNames: [req.name],
          });
          this.scriptSetVarNames.add(varName);
          console.log(
            `  ✓ UUID header "${h.key}" → per-request load.utils.uuid() as "${varName}"`,
          );
        });
    });
  }

  /**
   * Convert a header key (kebab-case / snake_case) to a camelCase JS identifier.
   * Used to synthesize a stable variable name from a header key.
   *   x-fapi-interaction-id → xFapiInteractionId
   *   x-request-id          → xRequestId
   */
  _headerKeyToVarName(key) {
    const camel = String(key)
      .toLowerCase()
      .replace(/[^a-z0-9]+([a-z0-9])/g, (_, c) => c.toUpperCase());
    // Ensure it starts with a valid JS identifier character
    return /^[a-zA-Z_$]/.test(camel) ? camel : `_${camel}`;
  }

  /**
   * Generate WebRequest options object
   */
  generateRequestOptions(request) {
    const options = {
      id: ++this.requestIdCounter,
      url: this.applyHostVars(
        this.replaceParameters(this.getBaseUrl(request.url)),
      ),
      method: request.method,
    };

    // Add headers only if there are any
    const headers = this.generateHeaders(request);
    if (headers && Object.keys(headers).length > 0) {
      options.headers = headers;
    }

    // Add queryString if URL has query parameters
    const queryString = this.extractQueryString(request.url);
    if (queryString && Object.keys(queryString).length > 0) {
      options.queryString = queryString;
    }

    // Add body if applicable
    if (["POST", "PUT", "PATCH"].includes(request.method) && request.body) {
      const body = this.generateBody(request.body, request.name);
      if (body) {
        options.body = body;
      }
    }

    // Add extractors for correlation and validation
    const extractors = this.generateExtractors(request);
    if (extractors.length > 0) {
      options.extractors = extractors;
    }

    // Add AWS signing if needed
    const authConfig = this.findAuthConfig(request);
    if (authConfig && this.authHandler.needsAWSSigning(authConfig)) {
      const awsOptions = this.authHandler.generateAWSSigningOptions(authConfig);
      if (awsOptions) {
        options.awsSigning = awsOptions;
      }
    }

    // Format as code string
    return this.formatOptionsObject(options);
  }

  /**
   * Get base URL without query string
   * Uses manual string splitting to preserve {{variables}} and special characters
   */
  getBaseUrl(url) {
    // Don't use new URL() — it encodes {{var}} to %7B%7Bvar%7D%7D
    const queryStart = url.indexOf("?");
    return queryStart === -1 ? url : url.substring(0, queryStart);
  }

  /**
   * Extract query string parameters from URL
   * Uses manual parsing to preserve {{variables}} and special characters
   */
  extractQueryString(url) {
    const queryStart = url.indexOf("?");
    if (queryStart === -1) return null;

    const queryString = url.substring(queryStart + 1);
    const params = {};
    queryString.split("&").forEach((pair) => {
      const eqIndex = pair.indexOf("=");
      if (eqIndex === -1) {
        // Key with no value
        if (pair) {
          params[pair] = this.replaceParameters("");
        }
      } else {
        const key = pair.substring(0, eqIndex);
        const value = pair.substring(eqIndex + 1);
        if (key) {
          params[key] = this.replaceParameters(value);
        }
      }
    });
    return Object.keys(params).length > 0 ? params : null;
  }

  /**
   * Generate per-request headers, skipping anything already in global defaults.
   *
   * Global defaults (set in module-level load.WebRequest.defaults.headers):
   *   - staticGlobal: static headers common to most requests (accept-*, user-agent, x-client-id, etc.)
   *   - authGlobal:   dynamic auth headers (Authorization) updated at start of action()
   *
   * Only headers UNIQUE to this request or DIFFERENT from defaults are emitted here.
   * This keeps individual requests clean and avoids duplication.
   */
  generateHeaders(request) {
    const headers = {};

    // Build a map of global default key → resolved value for comparison.
    // Browser baseline headers are always global with fixed values.
    // A per-request header is only skipped when BOTH key AND value match
    // the global default — if the value differs, it must be emitted as
    // a per-request override (e.g. Content-Type: application/jwt vs
    // the global Content-Type: application/json).
    const globalDefaults = new Map(); // lowercase key → resolved value string
    const BROWSER_DEFAULTS = {
      "accept-encoding": "gzip, deflate, br",
      "accept-language": "en-US,en;q=0.9",
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    };
    for (const [k, v] of Object.entries(BROWSER_DEFAULTS)) {
      globalDefaults.set(k, v);
    }
    if (this._staticGlobalHeaders) {
      for (const [k, v] of this._staticGlobalHeaders) {
        // Stored values are quoted ("val" or 'val') — strip quotes for comparison
        globalDefaults.set(k.toLowerCase(), v.replace(/^["']|["']$/g, ''));
      }
    }
    if (this._authGlobalHeaders) {
      for (const [k, v] of this._authGlobalHeaders) {
        globalDefaults.set(k.toLowerCase(), v.replace(/^["']|["']$/g, ''));
      }
    }

    // Build headers from explicit headers array
    if (
      request.headers &&
      Array.isArray(request.headers) &&
      request.headers.length > 0
    ) {
      request.headers
        .filter((h) => !h.disabled && h.key && h.value)
        .forEach((h) => {
          const keyLower = h.key.toLowerCase();

          // DPoP header: replace hardcoded proof token with dynamic reference
          if (this.hasDpop && /^dpop(-pf)?$/i.test(keyLower)) {
            const varName =
              keyLower === "dpop-pf" ? "dpop_pf_proof" : "dpop_proof";
            headers[h.key] = `\${load.global.${varName}}`;
            return;
          }

          const resolvedValue = this.applyHostVars(
            this.replaceParameters(h.value),
          );

          // Skip only if key exists in global defaults AND value matches exactly
          if (globalDefaults.has(keyLower)) {
            const globalVal = globalDefaults.get(keyLower);
            if (resolvedValue === globalVal) return; // identical — skip
          }
          headers[h.key] = resolvedValue;
        });
    }

    // Inject auth header from auth section ONLY if Authorization is NOT already explicit.
    // This prevents duplication when auth section and headers both define Authorization.
    const hasExplicitAuthHeader = Object.keys(headers).some(
      (k) => k.toLowerCase() === "authorization",
    );

    if (!hasExplicitAuthHeader) {
      const authConfig = this.findAuthConfig(request);
      if (authConfig) {
        const authHeader =
          this.authHandler.generateAuthHeaderInjection(authConfig);
        if (authHeader) {
          // authHeader format: '"Authorization": `Bearer ${load.global.token}`'
          // Strip outer backticks if present — formatOptionsObject re-wraps with backticks
          // when it detects ${...} in the string, avoiding double-backtick output.
          const match = authHeader.match(/"([^"]+)":\s*(.+)/);
          if (match) {
            let val = match[2].trim();
            if (val.startsWith("`") && val.endsWith("`"))
              val = val.slice(1, -1);
            headers[match[1]] = val;
          }
        }
      }
    }

    return Object.keys(headers).length > 0 ? headers : null;
  }

  /**
   * Generate request body, extracting large base64 values to external files
   */
  generateBody(body, requestName) {
    if (!body) return null;

    switch (body.mode) {
      case "raw":
        try {
          const jsonBody = JSON.parse(body.raw);
          // Replace large base64 values with load.global references before parameter replacement
          const processedBody = this._replaceLargeBase64InObject(
            jsonBody,
            requestName,
            "",
          );
          return this.replaceParametersInObject(processedBody);
        } catch (e) {
          // Not JSON — check if the entire raw body is a large base64 value
          const rawKey = `${requestName}::__raw__`;
          if (this.largeValueIndex.has(rawKey)) {
            const hash = this.largeValueIndex.get(rawKey);
            const fileInfo = this.extractedDataFiles.get(hash);
            return `{{load.global.${fileInfo.varName}}}`;
          }
          return this.replaceParameters(body.raw);
        }

      case "urlencoded":
        const formData = {};
        body.urlencoded
          .filter((item) => !item.disabled)
          .forEach((item) => {
            formData[item.key] = this.applyHostVars(
              this.replaceParameters(item.value),
            );
          });
        return formData;

      case "formdata":
        // For multipart, return special indicator
        return "{{MULTIPART}}";

      default:
        return body.raw || null;
    }
  }

  /**
   * Recursively replace large base64 values in a parsed JSON object
   * with load.global.varName references (as special marker strings)
   */
  _replaceLargeBase64InObject(obj, requestName, currentPath) {
    if (typeof obj === "string") {
      const indexKey = `${requestName}::${currentPath}`;
      if (this.largeValueIndex.has(indexKey)) {
        const hash = this.largeValueIndex.get(indexKey);
        const fileInfo = this.extractedDataFiles.get(hash);
        // Return a marker that formatOptionsObject will convert to a raw variable reference
        return `{{load.global.${fileInfo.varName}}}`;
      }
      return obj;
    }
    if (Array.isArray(obj)) {
      return obj.map((item, index) => {
        return this._replaceLargeBase64InObject(
          item,
          requestName,
          `${currentPath}[${index}]`,
        );
      });
    }
    if (typeof obj === "object" && obj !== null) {
      const result = {};
      Object.entries(obj).forEach(([key, value]) => {
        const path = currentPath ? `${currentPath}.${key}` : key;
        result[key] = this._replaceLargeBase64InObject(
          value,
          requestName,
          path,
        );
      });
      return result;
    }
    return obj;
  }

  /**
   * Inject JMX-explicit extractors into this.correlations so the standard
   * extractor/global-var machinery handles them automatically.
   * Skips names already detected by correlationDetector.analyzeRequests().
   */
  injectJmxExtractors() {
    const seenNames = new Set(this.correlations.map((c) => c.name));
    for (const request of this.requests) {
      // request.extractors[] is in format: [{ listen:'extractor', extractor:{ type, name, regex, scope, matchNumber } }]
      // as wrapped by jmxParser.parseSampler()
      for (const item of request.extractors || []) {
        if (item.listen !== "extractor" || !item.extractor) continue;
        const extractor = item.extractor;
        const name = extractor.name;
        if (!name || seenNames.has(name)) continue;
        seenNames.add(name);

        const base = {
          name,
          producerRequest: request.name,
          consumerRequests: [],
          // Preserve scope & matchNumber for correct extractor code generation
          scope: extractor.scope || "body",
          matchNumber: extractor.matchNumber || "1",
        };

        let corr;
        switch ((extractor.type || "").toLowerCase()) {
          case "regex":
          case "regexp":
            corr = {
              ...base,
              extractorType: "regex",
              pattern: extractor.regex || "(.+?)",
            };
            break;
          case "jsonpath":
          case "json":
            corr = {
              ...base,
              extractorType: "json",
              extractPath:
                extractor.jsonPath || extractor.expression || `$.${name}`,
            };
            break;
          case "boundary":
            corr = {
              ...base,
              extractorType: "boundary",
              leftBound: extractor.leftBoundary || extractor.lowerBound || "",
              rightBound: extractor.rightBoundary || extractor.upperBound || "",
            };
            break;
          case "xpath":
          case "xpath2":
            corr = {
              ...base,
              extractorType: "xpath",
              xpathQuery: extractor.xpath || `//${name}`,
            };
            break;
          default:
            corr = { ...base, extractorType: "regex", pattern: "(.+?)" };
        }
        this.correlations.push(corr);
      }
    }
  }

  /**
   * Inject correlations for variables set by post-response test scripts.
   *
   * analyzeRequests() has a producer-before-consumer ordering constraint — it only
   * creates a correlation when the producer request index is lower than the consumer
   * request index. In many real-world Postman collections the token endpoint is placed
   * AFTER the requests that use the token (e.g. producer at index 6, consumers at 0-5),
   * so analyzeRequests() finds 0 correlations even when the script is parsed correctly.
   *
   * This method bypasses that constraint by directly injecting a correlation for every
   * variable set by a post-response script that doesn't already have one. It runs after
   * both analyzeRequests() and injectJmxExtractors() so it never creates duplicates.
   */
  injectScriptExtractors() {
    const seenNames = new Set(this.correlations.map((c) => c.name));
    for (let i = 0; i < this.requests.length; i++) {
      const request = this.requests[i];
      const testScript = this.correlationDetector.extractTestScript(request);
      if (!testScript) continue;
      const setVars = this.correlationDetector.extractSetVariables(testScript);
      for (const varInfo of setVars) {
        const name = varInfo.name;
        if (!name || seenNames.has(name)) continue;
        // Skip library-loading or crypto identifiers — not real correlation targets
        if (/jsrsasign|kjur|cryptojs|jsonwebtoken|jose|forge|jsbn/i.test(name)) continue;
        seenNames.add(name);
        this.correlations.push({
          name,
          producerRequest:  request.name,
          consumerRequests: [],
          extractorType:    varInfo.extractorType || 'json',
          extractPath:      varInfo.extractPath   || `$.${name}`,
          leftBound:        varInfo.leftBound,
          rightBound:       varInfo.rightBound,
          pattern:          varInfo.pattern,
          xpathQuery:       varInfo.xpathQuery,
          _fromScript:      true,
        });
        this.scriptSetVarNames.add(name);
      }
    }
  }

  /**
   * Generate extractors for this request
   */
  generateExtractors(request) {
    const extractors = [];
    const seenNames = new Set();

    // Find correlations this request produces (deduplicate by name).
    // Use sanitized name so the extractor key and the load.global assignment are consistent.
    this.correlations.forEach((corr) => {
      if (corr.producerRequest === request.name && !seenNames.has(corr.name)) {
        seenNames.add(corr.name);
        // Build a sanitized copy — the extractor name in DevWeb must be a valid JS key
        const sanitized = { ...corr, name: this.sanitizeVarName(corr.name) };
        const extractorCode =
          this.correlationDetector.generateExtractor(sanitized);
        extractors.push(extractorCode);
      }
    });

    // Add extractors from custom test scripts (deduplicate by name)
    const customScripts = this.customScripts.get(request.name);
    if (customScripts?.test?.extractors) {
      customScripts.test.extractors.forEach((extractor) => {
        if (!seenNames.has(extractor.name)) {
          seenNames.add(extractor.name);
          const extractorCode =
            this.correlationDetector.generateExtractor(extractor);
          extractors.push(extractorCode);
        }
      });
    }

    // Add status code validation extractor if test script has assertions
    //Disabled: Status validation extractors are not needed
    // if (customScripts?.test?.assertions && customScripts.test.assertions.length > 0) {
    //   // Check for status code assertions
    //   const statusAssertion = customScripts.test.assertions.find(a =>
    //     a.toLowerCase().includes('status') || a.toLowerCase().includes('code')
    //   );
    //   if (statusAssertion) {
    //     // Add TextCheckExtractor for success validation
    //     const textCheck = this.correlationDetector.createTextCheckExtractor(
    //       'validationCheck',
    //       'success',
    //       { scope: 'load.ExtractorScope.Body', failOn: false }
    //     );
    //     extractors.push(this.correlationDetector.generateExtractor(textCheck));
    //   }
    // }

    return extractors;
  }

  /**
   * Replace {{variable}} references with the appropriate DevWeb code:
   * - Parameterized variables → ${load.params.varName}
   * - Dynamic/correlated variables → ${load.global.varName}
   * - Postman built-in dynamic vars → static replacement
   * - Unknown variables → kept as {{varName}} for manual review
   */
  replaceParameters(str) {
    if (!str || typeof str !== "string") return str;

    return str.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const trimmedName = varName.trim();

      // Postman built-in dynamic variables ($randomXxx, $guid, $timestamp)
      if (trimmedName.startsWith("$")) {
        return this.resolvePostmanDynamicVar(trimmedName);
      }

      // Per-request dynamic vars (UUID, CSRF, nonce) — detected by detectUuidHeaders()
      // which runs AFTER classifyVariables(), so these may NOT be in dynamicVarNames.
      // UUID type → inlined as load.utils.uuid() directly in the header value (no global var).
      // Other types (csrf, nonce) → still use load.global so the same value can be
      // referenced in both header and body within the same request.
      if (this.perRequestVars && this.perRequestVars.has(trimmedName)) {
        const { generationType } = this.perRequestVars.get(trimmedName);
        const safeName = this.sanitizeVarName(trimmedName);
        return generationType === "uuid"
          ? "${load.utils.uuid()}"
          : `\${load.global.${safeName}}`;
      }

      // Dynamic variable → load.global (set by scripts/correlation at runtime)
      if (this.dynamicVarNames.has(trimmedName)) {
        // Sanitize: hyphens and special chars are invalid JS identifiers
        const safeName = this.sanitizeVarName(trimmedName);
        return `\${load.global.${safeName}}`;
      }

      // Parameterized variable — route by tier:
      //   iteration (credentials / CSV) → load.params.name
      //   once (config / env vars / userArguments) → load.config.user.args["name"]
      if (this.paramVarNames.has(trimmedName)) {
        const safeName = this.sanitizeVarName(trimmedName);
        const cfg = this.parameters && this.parameters.get(trimmedName);
        if (cfg && cfg.nextValue === 'iteration') {
          // Per-iteration CSV parameter (credentials, test data)
          const isSimple = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(safeName);
          return isSimple ? `\${load.params.${safeName}}` : `\${load.params["${safeName}"]}`;
        }
        // Config / env var → rts.yml userArguments → load.config.user.args
        return `\${load.config.user.args["${safeName}"]}`;
      }

      // Variable exists in map but wasn't classified (parameterization disabled)
      if (this.variableMap.has(trimmedName)) {
        const value = this.variableMap.get(trimmedName);
        if (value !== "" && value !== null && value !== undefined) {
          return String(value);
        }
        return match; // Keep as-is for manual review
      }

      // Not found — keep original for manual review
      console.warn(
        `Variable "${trimmedName}" not found in collection/environment variables`,
      );
      return match;
    });
  }

  /**
   * Resolve Postman built-in dynamic variables to static values
   */
  resolvePostmanDynamicVar(varName) {
    const dynamicVars = {
      $guid: "${load.utils.uuid()}",
      $randomUUID: "${load.utils.uuid()}",
      $timestamp: "${Date.now()}",
      $randomInt: "${Math.floor(Math.random() * 1000)}",
      $randomCompanyName: "TestCompany",
      $randomFirstName: "John",
      $randomLastName: "Doe",
      $randomEmail: "test@example.com",
      $randomUserName: "testuser",
      $randomPhoneNumber: "555-0100",
      $randomCity: "TestCity",
      $randomStreetAddress: "123 Test St",
      $randomCountry: "US",
      $randomColor: "blue",
      $randomBoolean: "true",
    };
    return dynamicVars[varName] || `TODO_${varName.replace("$", "")}`;
  }

  /**
   * Replace parameters in object
   */
  replaceParametersInObject(obj) {
    if (typeof obj !== "object" || obj === null) return obj;

    if (Array.isArray(obj)) {
      return obj.map((item) => this.replaceParametersInObject(item));
    }

    const result = {};
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === "string") {
        // Skip strings that are already load.global markers (from base64 extraction)
        if (/^\{\{load\.global\..+\}\}$/.test(value)) {
          result[key] = value;
        } else {
          result[key] = this.replaceParameters(value);
        }
      } else if (typeof value === "object") {
        result[key] = this.replaceParametersInObject(value);
      } else {
        result[key] = value;
      }
    });
    return result;
  }

  /**
   * Scan all request URLs and header values to extract unique hostnames,
   * then build this.hostVarMap: hostname → JS variable name (SERVER_HOST, SERVER_HOST1, ...).
   * Called during analyze(). Results used in generateHeader() and URL/header generation.
   */
  buildHostVarMap() {
    const hostFreq = new Map();
    const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    const extractHosts = (str) => {
      if (!str) return;
      const matches = String(str).match(/https?:\/\/([^\/\s"'`?#{}]+)/g) || [];
      for (const m of matches) {
        const host = m.replace(/^https?:\/\//, "");
        if (!host || /[{$]/.test(host)) continue; // skip variable refs
        if (/^localhost$|^127\.|^::1$|^\d+\.\d+\.\d+\.\d+$/.test(host))
          continue;
        hostFreq.set(host, (hostFreq.get(host) || 0) + 1);
      }
    };

    const allReqs = [
      ...this.requests,
      ...(this.options.setupRequests || []),
      ...(this.options.teardownRequests || []),
    ];

    for (const req of allReqs) {
      extractHosts(req.url);
      for (const h of req.headers || []) {
        if (h.value && !h.disabled) extractHosts(String(h.value));
      }
      if (req.body?.urlencoded) {
        for (const p of req.body.urlencoded) extractHosts(p.value || "");
      }
      if (req.body?.raw) extractHosts(req.body.raw);
    }

    // Also scan collection-level variables for URL-valued vars
    if (this.variableMap) {
      for (const [, val] of this.variableMap) extractHosts(String(val || ""));
    }

    // Sort by frequency desc, then alpha
    const sorted = [...hostFreq.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );

    this.hostVarMap = new Map();
    let counter = 0;
    for (const [host] of sorted) {
      const varName = counter === 0 ? "SERVER_HOST" : `SERVER_HOST${counter}`;
      this.hostVarMap.set(host, varName);
      counter++;
    }
  }

  /**
   * Replace known hostnames in a string with ${SERVER_HOST} JS template variable references.
   * formatOptionsObject() will automatically convert strings containing ${...} to backtick literals.
   */
  applyHostVars(str) {
    if (!str || !this.hostVarMap || this.hostVarMap.size === 0) return str;
    let result = String(str);
    for (const [host, varName] of this.hostVarMap) {
      result = result.split(host).join(`\${${varName}}`);
    }
    return result;
  }

  /**
   * Format options object as code string
   */
  formatOptionsObject(options) {
    // Convert to formatted JSON, then replace quoted template literals
    let str = JSON.stringify(options, null, 2);

    // Convert any JSON string containing ${...}, newline escapes, or embedded quotes to a backtick template literal.
    // This covers:
    //   • "${load.params.var}" and mixed "https://${host}/path"
    //   • Multi-line request bodies with \r\n or \n sequences (from JMX raw bodies)
    //   • Nested JSON strings like "{\"condition\":\"or\", \"rules\":[]}" → `{"condition":"or", "rules":[]}`
    str = str.replace(/"((?:[^"\\]|\\.)*)"/g, (match, content) => {
      // '\\"' is the two-char sequence backslash+quote that JSON.stringify inserts for embedded quotes
      const hasEscapedQuotes = content.includes('\\"');
      if (content.includes("${") || content.includes("\\n") || content.includes("\\r") || hasEscapedQuotes) {
        const unescaped = content
          .replace(/\\"/g, '"')
          .replace(/\\r\\n/g, '\r\n')
          .replace(/\\n/g, '\n')
          .replace(/\\r/g, '\r')
          .replace(/\\t/g, '\t');
        // Skip extractor/code strings (handled by later regex) and values containing backticks
        if (unescaped.startsWith('new load.') || unescaped.includes('`')) return match;
        return "`" + unescaped + "`";
      }
      return match;
    });

    // Unwrap pure single-expression template literals: `${expr}` → expr
    // When a header value is ONLY an expression (e.g. load.utils.uuid() or load.global.token),
    // the backtick wrapper is redundant — the bare expression is cleaner and avoids
    // unnecessary string coercion. Mixed strings like `Bearer ${token}` or
    // `${base}/path/${id}` are unaffected.
    // [^`}]* (not [^`]+) prevents crossing } boundaries so `${A}/path/${B}` is never misread
    // as a pure expression by consuming from the first ${ to the last } before the backtick.
    str = str.replace(/`\$\{([^`}]*)\}`/g, "$1");

    // Replace "{{MULTIPART}}" with actual multipart code
    str = str.replace('"{{MULTIPART}}"', "new load.MultipartBody([...])");

    // Strip quotes from extractor code (new load.XXXExtractor(...))
    // JSON.stringify double-escapes inner backslashes (\" → \\\" in JSON text).
    // Use JSON.parse to fully unescape the captured content rather than a
    // partial replace(/\\"/g, '"') that would leave leading \\ in \\\" sequences.
    str = str.replace(
      /"(new load\.\w+Extractor\((?:[^"\\]|\\.)*\))"/g,
      (match, code) => {
        try {
          return JSON.parse('"' + code + '"');
        } catch (e) {
          return code.replace(/\\"/g, '"');
        }
      },
    );

    // Only strip quotes for known code patterns (load.*, new load.*)
    // Leave all other "{{...}}" as quoted strings (unresolvable variable references)
    str = str.replace(/"{{((?:load\.|new load\.)[^}]+)}}"/g, "$1");

    return str;
  }

  /**
   * Group requests by folder
   */
  groupRequestsByFolder() {
    const grouped = {};

    this.requests.forEach((request) => {
      const folder = request.folder || "API Requests";
      if (!grouped[folder]) {
        grouped[folder] = [];
      }
      grouped[folder].push(request);
    });

    return grouped;
  }

  /**
   * Get correlation dependencies for a request
   */
  getCorrelationDependencies(request) {
    return this.correlations
      .filter((corr) => corr.consumerRequest === request.name)
      .map((corr) => corr.producerRequest);
  }

  /**
   * Get correlations this request produces
   */
  getProducedCorrelations(request) {
    const seen = new Set();
    return this.correlations.filter((corr) => {
      if (corr.producerRequest === request.name && !seen.has(corr.name)) {
        seen.add(corr.name);
        return true;
      }
      return false;
    });
  }

  /**
   * Find auth config for request
   */
  findAuthConfig(request) {
    if (request.auth && request.auth.type) {
      const authType = request.auth.type.toLowerCase();

      // 'noauth' explicitly overrides collection-level auth — return null, apply nothing
      if (authType === 'noauth') return null;

      // Any other request-level auth — look up by request name (registered by extractAuthentication)
      const reqAuth = this.authConfigs.get(request.name);
      if (reqAuth) return reqAuth;
      // Edge case: extractAuthentication may have missed it — register now
      this.authHandler.processAuth(request.name, request.auth);
      return this.authConfigs.get(request.name) || null;
    }

    // No request-level auth — inherit collection-level auth only (never spill a per-request auth)
    return this.authConfigs.get('collection') || null;
  }

  /**
   * Generate finalize section
   */
  generateFinalize() {
    const teardownRequests = this.options.teardownRequests || [];
    const teardownScripts = this.options.teardownScripts || [];

    let code = `load.finalize('Finalize', async function() {\n`;

    for (const req of teardownRequests) {
      code += this.generateRequestCode(req, 1);
    }

    code += `});`;
    return code;
  }

  /**
   * Generate analysis report
   */
  getAnalysisReport() {
    return {
      requests: {
        total: this.requests.length,
        byMethod: this.getRequestsByMethod(),
        byFolder: Object.keys(this.groupRequestsByFolder()).length,
        withCustomScripts: this.customScripts.size,
      },
      correlations: this.correlationDetector.getCorrelationReport(),
      // Use this.parameters.size as authoritative count — it reflects the actual
      // classified parameters from classifyVariables() including JMX CSV columns.
      // paramEngine is a raw scanner that doesn't see CSV-injected vars, so its
      // totalParameters is always 0 for JMX files.
      parameters: {
        ...this.paramEngine.getReport(),
        totalParameters: this.parameters.size,
      },
      authentication: this.authHandler.getAuthSummary(),
      customScripts: {
        total: this.customScripts.size,
        preRequest: Array.from(this.customScripts.values()).filter(
          (s) => s.preRequest,
        ).length,
        test: Array.from(this.customScripts.values()).filter((s) => s.test)
          .length,
        warnings: this.scriptParser.getAllWarnings(),
      },
      options: this.options,
    };
  }

  /**
   * Get requests grouped by HTTP method
   */
  getRequestsByMethod() {
    const byMethod = {};
    this.requests.forEach((req) => {
      byMethod[req.method] = (byMethod[req.method] || 0) + 1;
    });
    return byMethod;
  }

  formatTransactionName(rawName, seqNum) {
    const padded = String(seqNum).padStart(2, "0");
    let name = rawName.replace(/-/g, "_");
    name = name.replace(/^[Tt]\d+[-_]/i, "");
    name = name
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "");
    name = name ? name.toUpperCase() : `REQ${padded}`;
    return `SC01_${padded}_${name}`;
  }

  /**
   * Sanitize name for use as JavaScript variable
   */
  sanitizeName(name) {
    return name
      .replace(/[^a-zA-Z0-9_]/g, "_")
      .replace(/^[0-9]/, "_$&")
      .replace(/_+/g, "_");
  }

  /**
   * Generate a clean transaction variable name (camelCase without prefixes/suffixes)
   */
  generateTransactionVarName(transactionName) {
    // Remove common prefixes/suffixes
    let name = transactionName
      .replace(/^(Transaction|Trans|T)[-_\s]*/i, "")
      .replace(/[-_\s]*(Transaction|Trans)$/i, "");

    // Convert to camelCase
    name = name
      .split(/[\s\-_\/]+/)
      .map((word, index) => {
        // Remove special characters
        word = word.replace(/[^a-zA-Z0-9]/g, "");
        if (word.length === 0) return "";

        // First word lowercase, rest capitalize first letter
        if (index === 0) {
          return word.charAt(0).toLowerCase() + word.slice(1);
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join("");

    // Ensure it's a valid JS identifier
    if (!name || /^[0-9]/.test(name)) {
      name = "t" + name;
    }

    return name || "transaction";
  }

  /**
   * Generate comment
   */
  generateComment(text) {
    return `// ${text}`;
  }

  /**
   * Indent text
   */
  indent(text, level = 1) {
    const spaces = "    ".repeat(level);
    return text
      .split("\n")
      .map((line) => spaces + line)
      .join("\n");
  }
}

module.exports = AdvancedScriptGenerator;
