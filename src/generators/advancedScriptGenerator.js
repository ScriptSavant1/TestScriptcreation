/**
 * Advanced DevWeb Script Generator
 * Integrates correlation, parameterization, authentication, and transactions
 */

const crypto = require("crypto");
const CorrelationDetector = require("../analyzers/correlationDetector");
const ParameterizationEngine = require("../analyzers/parameterizationEngine");
const AuthenticationHandler = require("../analyzers/authenticationHandler");
const CustomScriptParser = require("../analyzers/customScriptParser");
const MandatoryFilesGenerator = require("./mandatoryFilesGenerator");

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
    this.paramVarNames = new Set(); // Variables to parameterize → load.params
    this.scriptSetVarNames = new Set(); // Variables detected as set by scripts

    // JWT detection — populated by detectJwtUsage() during analyze()
    this.hasJwt = false;
    this.jwtVarNames = []; // token variable names set by JWT pre-request scripts

    // Per-request dynamic variables — generated fresh before each request (e.g. UUID, nonce).
    // Map: varName → { generationType: 'uuid'|'random'|'timestamp'|'nonce', requestNames: string[] }
    // These are NOT static params and NOT response correlations — they are inline-generated.
    this.perRequestVars = new Map();

    // Pre-computed transaction map — populated by generateAction(), used by generateHeader()
    // Maps requestName → { txVar: "T01", txName: "T01_GetAccessToken" }
    this.requestTxMap = new Map();

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
   * Build a map of all variables from collection and environment file
   */
  buildVariableMap() {
    // Extract collection variables
    if (this.collection.variable) {
      this.collection.variable.forEach((variable) => {
        this.variableMap.set(variable.key, variable.value);
      });
    }

    // Extract environment variables from collection (if available)
    if (this.collection.environment) {
      Object.entries(this.collection.environment).forEach(([key, value]) => {
        this.variableMap.set(key, value);
      });
    }

    // Merge environment file variables (overrides collection variables)
    if (this.options.environmentVars) {
      Object.entries(this.options.environmentVars).forEach(([key, value]) => {
        this.variableMap.set(key, value);
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
    // Groups: 1=pm.*/context, 2=bru.set*, 3=env/vars legacy
    // Groups: 1=pm.*/context, 2=bru.set*, 3=env/vars legacy
    const setPattern =
      /(?:context|pm\.environment|pm\.collectionVariables|pm\.globals|pm\.variables)\.set\s*\(\s*["']([^"']+)["']|bru\.(?:setEnv|setEnvVar|setVar|setGlobalVar|setNextEnvVar)\s*\(\s*["']([^"']+)["']|(?:^|[^a-zA-Z0-9_$])(?:env|vars)\.set\s*\(\s*["']([^"']+)["']/gm;

    const scanItem = (item) => {
      // Check events (pre-request, test scripts)
      if (item.event && Array.isArray(item.event)) {
        item.event.forEach((event) => {
          if (event.script && event.script.exec) {
            const scriptText = Array.isArray(event.script.exec)
              ? event.script.exec.join("\n")
              : event.script.exec;
            let match;
            while ((match = setPattern.exec(scriptText)) !== null) {
              // group 1 = pm.*/context, group 2 = bru.set*, group 3 = env/vars legacy
              const varName = match[1] || match[2] || match[3];
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
        while ((m = setPattern.exec(text)) !== null) {
          const varName = m[1] || m[2] || m[3];
          if (varName) this.scriptSetVarNames.add(varName);
        }
      });
    });
  }

  /**
   * Scan all request pre-request scripts for JWT generation patterns (jsrsasign, jsonwebtoken, etc.).
   * Sets this.hasJwt = true and populates this.jwtVarNames when JWT signing is detected.
   * JWT output variables are added to scriptSetVarNames so classifyVariables() marks them dynamic.
   */
  detectJwtUsage() {
    const CustomScriptParser = require("../analyzers/customScriptParser");
    const scanItem = (item) => {
      // Scan the item's own pre-request script
      if (item.event && Array.isArray(item.event)) {
        item.event.forEach((event) => {
          if (event.listen !== "prerequest") return;
          const exec = event.script?.exec;
          const text = Array.isArray(exec) ? exec.join("\n") : exec || "";
          if (!text) return;

          const result = CustomScriptParser.detectJwtUsage(text);
          if (result.isJwt) {
            this.hasJwt = true;
            result.outputVars.forEach((v) => {
              this.jwtVarNames.push(v);
              this.scriptSetVarNames.add(v); // ensure they're Tier 1 dynamic
            });
            console.log(
              `  ✓ JWT detected (library: ${result.library}, algorithm: ${result.algorithm})`,
            );
          }

          // Per-request dynamic var detection (UUID/nonce/random generated per request)
          const perReqVars =
            CustomScriptParser.detectPerRequestDynamicVars(text);
          perReqVars.forEach(({ varName, generationType }) => {
            if (!this.perRequestVars.has(varName)) {
              this.perRequestVars.set(varName, {
                generationType,
                requestNames: [],
              });
              // Per-request vars are Tier 1 dynamic — never parameterize them
              this.scriptSetVarNames.add(varName);
            }
            // Tag which request this var is generated for
            if (item.name) {
              this.perRequestVars.get(varName).requestNames.push(item.name);
            }
          });
        });
      }
      // Recurse
      const items = item.item || item.items;
      if (Array.isArray(items)) items.forEach((child) => scanItem(child));
    };
    scanItem(this.collection);
  }

  /**
   * Classify all variables into dynamic (load.global) vs parameterized (load.params)
   * Must be called AFTER correlation detection and script parsing
   */
  classifyVariables() {
    const credentialPattern =
      /^(username|password|user|email|account|credential|login|pwd|passwd|user_?name|user_?id|user_?email)$/i;

    // RULE 1 — Correlation targets: always Tier 1 (dynamic)
    // These are values extracted from API responses at runtime.
    this.correlations.forEach((corr) => this.dynamicVarNames.add(corr.name));

    // RULE 2 — Script-set variables: always Tier 1 (dynamic)
    // Any variable explicitly set by a script (pm.*.set, bru.setEnv, etc.) is runtime.
    this.scriptSetVarNames.forEach((name) => this.dynamicVarNames.add(name));

    // RULE 3 — _ prefix: always Tier 1 regardless of value
    // Postman/Bruno convention: underscore prefix = correlation placeholder.
    for (const [name] of this.variableMap.entries()) {
      if (name.startsWith("_")) this.dynamicVarNames.add(name);
    }

    // RULE 4 (GENERIC) — Empty value in collection/environment = Tier 1 (dynamic).
    // Static config vars (baseUrl, clientId, apiKey) ALWAYS have real values.
    // Runtime vars (access_token, refresh_token, interaction_id) are intentionally
    // left EMPTY because they are filled at runtime from API responses.
    // Credentials (username/password) are excluded — they go to Tier 3.
    for (const [name, value] of this.variableMap.entries()) {
      if (this.dynamicVarNames.has(name)) continue;
      if (name.startsWith("$")) continue;
      const isEmpty = value === "" || value === null || value === undefined;
      const isCredential = credentialPattern.test(name);
      if (isEmpty && !isCredential) {
        this.dynamicVarNames.add(name);
      }
    }

    // RULE 5 — Everything else with a real value → parameterize via CSV
    let usernameParam = null;
    for (const [name] of this.variableMap.entries()) {
      if (this.dynamicVarNames.has(name)) continue;
      if (name.startsWith("$")) continue;

      this.paramVarNames.add(name);

      // Track username-like param for "same as" linking
      if (/^(username|user|user_?name|email|login|account)$/i.test(name)) {
        usernameParam = name;
      }
    }

    // 5. Build this.parameters map for CSV generation
    for (const name of this.paramVarNames) {
      const value = this.variableMap.get(name);
      const isCredential = credentialPattern.test(name);

      this.parameters.set(name, {
        name,
        type: "csv",
        fileName: "collection_data.csv",
        columnName: name,
        nextValue: isCredential ? "iteration" : "once",
        nextRow: "sequential",
        onEnd: "loop",
        paramValue: value !== undefined && value !== null ? String(value) : "",
      });
    }

    // 6. Link password-like params to username (same as)
    if (usernameParam) {
      for (const [name, config] of this.parameters.entries()) {
        if (/^(password|pwd|passwd)$/i.test(name)) {
          config.nextRow = `same as ${usernameParam}`;
        }
      }
    }

    // 7. Add dynamic variables that need load.global initialization
    //    (those not already tracked by correlations)
    this.dynamicVarNames.forEach((name) => {
      const isCorrelation = this.correlations.some((c) => c.name === name);
      if (!isCorrelation) {
        // These are script-set variables — still need load.global init
        // but won't have extractors
      }
    });

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
          proxy: this.detectProxyConfig(),
        },
      );

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
    }

    return result;
  }

  /**
   * Analyze collection for correlations, parameters, and auth
   */
  async analyze() {
    // Detect correlations (must run before variable classification)
    if (this.options.useCorrelation) {
      this.correlations = this.correlationDetector.analyzeRequests(
        this.requests,
      );
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

    // Scan for large base64 values in request bodies
    this.scanForLargeBase64();
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

      // Dynamic vars (load.global.X) → authGlobal (set after token is fetched)
      if (valueExpr.includes("load.global.") || valueExpr.includes("Bearer")) {
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

    const { staticGlobal, authGlobal } = this.analyzeCommonHeaders();

    // ── Module-level declarations ────────────────────────────────────────────
    // These run ONCE when the script loads — before any lifecycle function.

    const jwtRequire = this.hasJwt
      ? `// JWT Helper — fast token generation using Node.js built-in crypto (no npm install)\nconst { getJWTToken } = require('./jwt-helper.js');\n`
      : "";

    const certSetup = this.hasJwt
      ? `// Transport certificate for mutual TLS authentication\nload.setUserCertificate('./transport.pem', './transport.pem');\n\n`
      : "";

    // Static browser baseline + static collection headers
    const collectionHeaders = this.collection.collectionHeaders || [];
    const collectionHeaderLines = collectionHeaders
      .filter((h) => h.key && h.value && !h.disabled)
      .map((h) => {
        const v = this.replaceParameters(h.value);
        const q = v.includes("${") ? `\`${v}\`` : `"${v}"`;
        return `    "${h.key}": ${q}`;
      });

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
        .map(([k, v]) => `    "${k}": ${v}`),
      ...collectionHeaderLines,
    ].join(",\n");

    // Auth/dynamic global headers — set in action() AFTER token is available
    // NOTE: authGlobal headers (Authorization, etc.) contain load.global.X references
    // that are null at module-load time. They are applied at the START of action()
    // after the token has been fetched — see the Object.assign block in generateAction().
    const authDefaultsBlock = ""; // empty at module level — applied in action() start

    // Store for use in action() (avoid recomputing)
    this._authGlobalHeaders = authGlobal;
    this._staticGlobalHeaders = staticGlobal;
    this._perRequestHeaderKeys = this.analyzeCommonHeaders().perRequestKeys;

    return `/**
 * DevWeb Performance Test Script
 * Auto-generated from: ${collectionName}
 * Generated on: ${timestamp}
 *
 * Features enabled:
 * - Transactions: ${this.options.useTransactions}
 * - Correlation: ${this.options.useCorrelation}
 * - Parameterization: ${this.options.useParameterization}
 * - Authentication: ${this.options.useAuthentication}
 *
 * Statistics:
 * - Total Requests: ${this.requests.length}
 * - Correlations: ${this.correlations.length}
 * - Parameters: ${this.parameters.size}
 * - Think Time: ${this.options.thinkTime}s
 */

${jwtRequire}${certSetup}// ── Default request options (applied to ALL requests) ────────────────────
load.WebRequest.defaults.returnBody = false;
load.WebRequest.defaults.headers = {
${staticHeaderLines}
};
${authDefaultsBlock}
// ── Transaction objects — declared once at module level ──────────────────
// All transactions are pre-declared here (before initialize) so they are
// available in action() without re-allocating on every iteration.
${
  this.requestTxMap && this.requestTxMap.size > 0
    ? Array.from(this.requestTxMap.values())
        .map(
          ({ txVar, txName }) =>
            `const ${txVar} = new load.Transaction("${txName}");`,
        )
        .join("\n")
    : "// (no transactions — useTransactions is disabled)"
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
      ? `
    load.global.jwt_token = getJWTToken(load.params);
    load.global.jwt_expires_at = Date.now() + (9 * 60 * 1000); // refresh at 9 min
    load.log('JWT token generated', load.LogLevel.info);
`
      : "";

    let code = `load.initialize('Initialize', async function() {
    load.log('Initializing Vuser ' + load.config.user.userId, load.LogLevel.${this.options.logLevel});
${jwtBlock}
    // Dynamic variables — populated at runtime from API responses
    ${this.generateGlobalVariablesInit()}
`;

    // Load external data files (large base64 values extracted from request bodies)
    if (this.extractedDataFiles.size > 0) {
      code += `\n    // Load external data files\n`;
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

    code += `\n    load.log("✓ Initialization complete", load.LogLevel.info);
});`;

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
    return String(name).replace(/[^a-zA-Z0-9_$]/g, "_");
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
        vars.push(`load.global.${safe} = null; // Correlated: ${corr.type}`);
      }
    });

    // Add script-set dynamic variables not already covered by correlations.
    // Skip JWT output vars — already set by getJWTToken() in initialize().
    const jwtOutputVars = new Set(this.jwtVarNames || []);
    this.dynamicVarNames.forEach((name) => {
      if (!seen.has(name) && !isLibraryName(name) && !jwtOutputVars.has(name)) {
        seen.add(name);
        const safe = this.sanitizeVarName(name);
        vars.push(`load.global.${safe} = null;`);
      }
    });

    return vars.length > 0 ? vars.join("\n    ") : "// No dynamic variables";
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
        const rawLabel = this.generateTransactionVarName(req.name).replace(
          /^t?[0-9]+/i,
          "",
        );
        const txLabel = rawLabel || `Req${seqNum}`;
        const txVar = `T${seqNum}`;
        const txName = `${txVar}_${txLabel}`;
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
    // JWT auto-refresh — uses getJWTToken from module-level require.
    // Also re-syncs dynamic auth headers in defaults after token refresh.
    const authHeaderUpdate =
      this._authGlobalHeaders && this._authGlobalHeaders.size > 0
        ? `\n        Object.assign(load.WebRequest.defaults.headers, {\n${Array.from(
            this._authGlobalHeaders.entries(),
          )
            .map(([k, v]) => `            "${k}": ${v}`)
            .join(",\n")}\n        });`
        : "";

    const jwtRefreshBlock = this.hasJwt
      ? `
    // Auto-refresh JWT token if expired (for long-running tests)
    if (!load.global.jwt_token || Date.now() >= load.global.jwt_expires_at) {
        load.global.jwt_token = getJWTToken(load.params);
        load.global.jwt_expires_at = Date.now() + (9 * 60 * 1000);
        load.log('JWT token refreshed', load.LogLevel.info);${authHeaderUpdate}
    }
`
      : authHeaderUpdate
        ? `\n    // Refresh dynamic auth headers\n    Object.assign(load.WebRequest.defaults.headers, {\n${Array.from(
            (this._authGlobalHeaders || new Map()).entries(),
          )
            .map(([k, v]) => `        "${k}": ${v}`)
            .join(",\n")}\n    });\n`
        : "";

    let code = `load.action('Action', async function() {
    load.log('Action iteration ' + load.config.runtime.iteration, load.LogLevel.info);
${jwtRefreshBlock}
`;

    if (this.options.groupByFolder && this.options.useTransactions) {
      code += this.generateGroupedActions();
    } else {
      code += this.generateSequentialActions();
    }

    code += `\n    load.log("✓ Action complete", load.LogLevel.info);
});`;

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
      if (folder && this.options.addComments) {
        code += `\n    // ── ${folder} ──────────────────────────────────────────`;
      }
      requests.forEach((request, reqIndex) => {
        const tx = this.requestTxMap.get(request.name);
        const txVar = tx ? tx.txVar : null;

        if (txVar) code += `\n    ${txVar}.start();`;
        code += this.generateRequestCode(request, 1);
        if (txVar)
          code += `\n    ${txVar}.stop(load.TransactionStatus.Passed);`;

        if (reqIndex < requests.length - 1 && this.options.thinkTime > 0) {
          code += `\n    load.sleep(${this.options.thinkTime});`;
        }
        code += "\n";
      });

      if (groupIndex < groupEntries.length - 1 && this.options.thinkTime > 0) {
        code += `\n    load.sleep(${this.options.thinkTime});\n`;
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
          code += `\n        load.log(\`${request.name} failed with status \${${respVar}.status}\`, load.LogLevel.error);`;
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
                code += `\n        load.log("${request.name} validation failed", load.LogLevel.error);`;
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

      if (txVar) code += `\n    ${txVar}.start();`;
      code += this.generateRequestCode(request, 1);
      if (txVar) code += `\n    ${txVar}.stop(load.TransactionStatus.Passed);`;

      if (index < this.requests.length - 1 && this.options.thinkTime > 0) {
        code += `\n    load.sleep(${this.options.thinkTime});`;
      }
      code += `\n`;
    });

    return code;
  }

  /**
   * Generate code for a single request.
   * Returns { code, responseVar } so callers can reference the response variable.
   */
  generateRequestCode(request, indentLevel = 1) {
    let code = "";

    // Add comment
    if (this.options.addComments) {
      code += `\n${this.indent(`// ${request.name}`, indentLevel)}`;
      if (request.description) {
        // Handle multi-line descriptions by commenting each line
        const descriptionLines = request.description.split("\n");
        descriptionLines.forEach((line) => {
          code += `\n${this.indent(`// ${line}`, indentLevel)}`;
        });
      }
    }

    // Check for correlation dependencies
    const dependencies = this.getCorrelationDependencies(request);
    if (dependencies.length > 0 && this.options.addComments) {
      code += `\n${this.indent(`// Depends on: ${dependencies.join(", ")}`, indentLevel)}`;
    }

    // NOTE: Pre-request and test scripts are intentionally NOT emitted here.
    // Scripts are used during analysis only (variable detection, JWT fingerprinting,
    // correlation detection). The generated LR script stays clean and readable.

    // Emit per-request dynamic variable generation (UUID/nonce for headers like x-fapi-interaction-id).
    // These must run BEFORE the request so the fresh value is ready for use in headers.
    this.perRequestVars.forEach((info, varName) => {
      // Only emit for requests that actually use this variable in their headers or body
      const usesVar = this.requestUsesVar(request, varName);
      if (usesVar) {
        const genExpr = this.perRequestGenExpression(info.generationType);
        code += `\n${this.indent(`load.global.${varName} = ${genExpr};`, indentLevel)}`;
      }
    });

    // Generate WebRequest options (increments requestIdCounter)
    const options = this.generateRequestOptions(request);

    // Sequential response variable: webResponse_01, webResponse_02, ...
    const seqNum = String(this.requestIdCounter).padStart(2, "0");
    const responseVar = `webResponse_${seqNum}`;

    code += `\n${this.indent(`const ${responseVar} = new load.WebRequest(${options}).sendSync();`, indentLevel)}`;

    // Add response logging
    code += `\n${this.indent(`load.log(\`${request.name} - Status: \${${responseVar}.status}\`, load.LogLevel.${this.options.logLevel});`, indentLevel)}`;

    // Emit correlation assignments — values extracted from this response
    const produces = this.getProducedCorrelations(request);
    if (produces.length > 0) {
      code += `\n`;
      produces.forEach((corr) => {
        // Sanitize name for use as JS identifier — correlation names can contain hyphens (e.g. "my-token")
        const safeCorrName = this.sanitizeVarName(corr.name);
        // Extractor registered as safeCorrName AND accessed with same name — must be identical
        code += `\n${this.indent(`load.global.${safeCorrName} = ${responseVar}.extractors["${safeCorrName}"];`, indentLevel)}`;
        if (this.options.addComments) {
          code += ` // Extracted ${corr.type}`;
        }
      });
    }

    // Store the response variable name for this request (used by grouped actions)
    this.lastResponseVar = responseVar;

    return code;
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
        return "crypto.randomUUID()";
      case "nonce":
        return "require('crypto').randomBytes(16).toString('hex')";
      case "random":
        return "Math.random().toString(36).substring(2)";
      case "timestamp":
        return "Date.now().toString()";
      default:
        return "crypto.randomUUID()";
    }
  }

  /**
   * Generate WebRequest options object
   */
  generateRequestOptions(request) {
    const options = {
      id: ++this.requestIdCounter,
      url: this.replaceParameters(this.getBaseUrl(request.url)),
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

    // Determine which header keys are already in global defaults — skip those
    const globalKeys = new Set(
      [
        "accept-encoding",
        "accept-language",
        "user-agent",
        ...(this._authGlobalHeaders
          ? Array.from(this._authGlobalHeaders.keys())
          : []),
        ...(this._staticGlobalHeaders
          ? Array.from(this._staticGlobalHeaders.keys())
          : []),
      ].map((k) => k.toLowerCase()),
    );

    // Build headers from explicit headers array — only non-global ones
    if (
      request.headers &&
      Array.isArray(request.headers) &&
      request.headers.length > 0
    ) {
      request.headers
        .filter((h) => !h.disabled && h.key && h.value)
        .forEach((h) => {
          // Skip headers already handled by global defaults (case-insensitive)
          if (globalKeys.has(h.key.toLowerCase())) return;
          headers[h.key] = this.replaceParameters(h.value);
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
            formData[item.key] = this.replaceParameters(item.value);
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

      // Dynamic variable → load.global (set by scripts/correlation at runtime)
      if (this.dynamicVarNames.has(trimmedName)) {
        // Sanitize: hyphens and special chars are invalid JS identifiers
        const safeName = this.sanitizeVarName(trimmedName);
        return `\${load.global.${safeName}}`;
      }

      // Parameterized variable → load.params (from CSV)
      if (this.paramVarNames.has(trimmedName)) {
        const safeName = this.sanitizeVarName(trimmedName);
        const isSimpleIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(safeName);
        if (isSimpleIdentifier) {
          return `\${load.params.${safeName}}`;
        }
        return `\${load.params["${safeName}"]}`;
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
      $guid: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
      $timestamp: "Date.now()",
      $randomInt: "Math.floor(Math.random() * 1000)",
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
      $randomUUID: "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx",
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
   * Format options object as code string
   */
  formatOptionsObject(options) {
    // Convert to formatted JSON, then replace quoted template literals
    let str = JSON.stringify(options, null, 2);

    // Convert any JSON string containing ${...} to a backtick template literal
    // Handles pure expressions like "${load.params.var}" and mixed content like
    // "https://${load.params.host}/api/${load.params.id}"
    str = str.replace(/"((?:[^"\\]|\\.)*)"/g, (match, content) => {
      if (content.includes("${")) {
        return "`" + content.replace(/\\"/g, '"') + "`";
      }
      return match;
    });

    // Replace "{{MULTIPART}}" with actual multipart code
    str = str.replace('"{{MULTIPART}}"', "new load.MultipartBody([...])");

    // Strip quotes from extractor code (new load.XXXExtractor(...))
    // JSON.stringify escapes inner quotes as \", so match those too, then unescape
    str = str.replace(
      /"(new load\.\w+Extractor\((?:[^"\\]|\\.)*\))"/g,
      (match, code) => {
        return code.replace(/\\"/g, '"');
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
    // Check request-specific auth first
    if (request.auth) {
      return this.authHandler.processAuth(request.name, request.auth);
    }

    // Fall back to collection-level auth
    return Array.from(this.authConfigs.values())[0] || null;
  }

  /**
   * Generate finalize section
   */
  generateFinalize() {
    return `load.finalize('Finalize', async function() {
    load.log('Finalizing Vuser ' + load.config.user.userId, load.LogLevel.info);
    
    // Cleanup code here if needed
    
    load.log("✓ Finalization complete", load.LogLevel.info);
});`;
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
      parameters: this.paramEngine.getReport(),
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
