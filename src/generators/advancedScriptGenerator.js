/**
 * Advanced DevWeb Script Generator
 * Integrates correlation, parameterization, authentication, and transactions
 */

const crypto = require('crypto');
const CorrelationDetector = require('../analyzers/correlationDetector');
const ParameterizationEngine = require('../analyzers/parameterizationEngine');
const AuthenticationHandler = require('../analyzers/authenticationHandler');
const CustomScriptParser = require('../analyzers/customScriptParser');
const MandatoryFilesGenerator = require('./mandatoryFilesGenerator');

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
      logLevel: options.logLevel || 'info',
      examplesPath: options.examplesPath || null,
      ...options
    };

    // Initialize analyzers
    this.correlationDetector = new CorrelationDetector();
    this.paramEngine = new ParameterizationEngine();
    this.authHandler = new AuthenticationHandler();
    this.scriptParser = new CustomScriptParser();
    this.mandatoryFilesGen = new MandatoryFilesGenerator({
      scriptName: this.collection.info?.name || this.collection.name || 'DevWebScript'
    });

    // Analysis results
    this.correlations = [];
    this.parameters = new Map();
    this.authConfigs = new Map();
    this.customScripts = new Map();
    this.requestIdCounter = 0;
    this.usedResponseNames = new Map(); // Track used response variable names for uniqueness

    // Large base64 data extraction
    // Map: hash → { varName, fileName, content, size, usedBy[] }
    this.extractedDataFiles = new Map();
    // Map: "requestName::fieldPath" → hash (for lookup during body generation)
    this.largeValueIndex = new Map();
    this.BASE64_THRESHOLD = 500; // Min chars to consider for extraction

    // Variable classification
    this.variableMap = new Map();        // All variables: name → value
    this.dynamicVarNames = new Set();    // Variables set by scripts/correlation → load.global
    this.paramVarNames = new Set();      // Variables to parameterize → load.params
    this.scriptSetVarNames = new Set();  // Variables detected as set by scripts
    this.buildVariableMap();
  }

  /**
   * Build a map of all variables from collection and environment file
   */
  buildVariableMap() {
    // Extract collection variables
    if (this.collection.variable) {
      this.collection.variable.forEach(variable => {
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
   * Scan collection scripts for variables set at runtime
   * Detects: context.set("varName"), pm.environment.set("varName"),
   *          pm.collectionVariables.set("varName"), pm.globals.set("varName"),
   *          pm.variables.set("varName")
   */
  detectScriptSetVariables() {
    const setPattern = /(?:context|pm\.environment|pm\.collectionVariables|pm\.globals|pm\.variables)\.set\(\s*["']([^"']+)["']/g;

    const scanItem = (item) => {
      // Check events (pre-request, test scripts)
      if (item.event && Array.isArray(item.event)) {
        item.event.forEach(event => {
          if (event.script && event.script.exec) {
            const scriptText = Array.isArray(event.script.exec)
              ? event.script.exec.join('\n')
              : event.script.exec;
            let match;
            while ((match = setPattern.exec(scriptText)) !== null) {
              this.scriptSetVarNames.add(match[1]);
            }
          }
        });
      }
      // Recurse into folders
      const items = item.item || item.items;
      if (Array.isArray(items)) {
        items.forEach(child => scanItem(child));
      }
    };

    scanItem(this.collection);
  }

  /**
   * Classify all variables into dynamic (load.global) vs parameterized (load.params)
   * Must be called AFTER correlation detection and script parsing
   */
  classifyVariables() {
    const credentialPattern = /^(username|password|user|email|account|credential|login|pwd|passwd|user_?name|user_?id|user_?email)$/i;

    // 1. Mark correlation targets as dynamic
    this.correlations.forEach(corr => {
      this.dynamicVarNames.add(corr.name);
    });

    // 2. Mark script-set variables as dynamic
    this.scriptSetVarNames.forEach(name => {
      this.dynamicVarNames.add(name);
    });

    // 3. Mark _ prefix + empty value as dynamic (Postman convention for runtime vars)
    for (const [name, value] of this.variableMap.entries()) {
      if (name.startsWith('_') && (value === '' || value === null || value === undefined)) {
        this.dynamicVarNames.add(name);
      }
    }

    // 4. Everything else → parameterize via CSV
    let usernameParam = null;
    for (const [name] of this.variableMap.entries()) {
      // Skip dynamic variables
      if (this.dynamicVarNames.has(name)) continue;
      // Skip Postman built-in dynamic variables ($randomXxx, $guid, $timestamp)
      if (name.startsWith('$')) continue;

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
        type: 'csv',
        fileName: 'collection_data.csv',
        columnName: name,
        nextValue: isCredential ? 'iteration' : 'once',
        nextRow: 'sequential',
        onEnd: 'loop',
        paramValue: value !== undefined && value !== null ? String(value) : ''
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
    this.dynamicVarNames.forEach(name => {
      const isCorrelation = this.correlations.some(c => c.name === name);
      if (!isCorrelation) {
        // These are script-set variables — still need load.global init
        // but won't have extractors
      }
    });

    console.log(`✓ Classified variables: ${this.paramVarNames.size} parameterized, ${this.dynamicVarNames.size} dynamic`);
  }

  /**
   * Check if a string is base64 encoded (allowing whitespace/newlines)
   */
  isBase64(str) {
    if (!str || typeof str !== 'string') return false;
    const stripped = str.replace(/\s/g, '');
    if (stripped.length < this.BASE64_THRESHOLD) return false;
    // Base64 charset: A-Z, a-z, 0-9, +, /, = (padding)
    return /^[A-Za-z0-9+/=]+$/.test(stripped);
  }

  /**
   * Generate a short hash for deduplication
   */
  hashContent(content) {
    return crypto.createHash('md5').update(content).digest('hex').substring(0, 12);
  }

  /**
   * Sanitize a string into a safe file/variable name
   */
  safeFileName(requestName, fieldPath) {
    const name = `${requestName}_${fieldPath}`
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      .substring(0, 60);
    return name;
  }

  /**
   * Scan all requests for large base64 values in bodies.
   * Registers them in extractedDataFiles (deduplicated by content hash)
   * and largeValueIndex (for lookup during body generation).
   */
  scanForLargeBase64() {
    let totalFound = 0;
    let deduplicated = 0;

    this.requests.forEach(request => {
      if (!request.body || !['POST', 'PUT', 'PATCH'].includes(request.method)) return;

      if (request.body.mode === 'raw' && request.body.raw) {
        try {
          const jsonBody = JSON.parse(request.body.raw);
          this._scanObjectForBase64(jsonBody, request.name, '', (fieldPath, value) => {
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
                usedBy: [request.name]
              });
              this.largeValueIndex.set(indexKey, hash);
              totalFound++;
            }
          });
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
              const varName = this.safeFileName(request.name, 'body');
              const fileName = `${varName}.b64`;
              this.extractedDataFiles.set(hash, {
                varName,
                fileName,
                content: request.body.raw,
                size: request.body.raw.length,
                usedBy: [request.name]
              });
              this.largeValueIndex.set(indexKey, hash);
              totalFound++;
            }
          }
        }
      }
    });

    if (totalFound > 0 || deduplicated > 0) {
      console.log(`✓ Extracted ${totalFound + deduplicated} large values to data/ folder (${totalFound} unique, ${deduplicated} deduplicated)`);
    }
  }

  /**
   * Recursively scan a JSON object for large base64 string values.
   * Calls onFound(fieldPath, value) for each match.
   */
  _scanObjectForBase64(obj, requestName, currentPath, onFound) {
    if (typeof obj === 'string') {
      if (this.isBase64(obj)) {
        onFound(currentPath, obj);
      }
      return;
    }
    if (Array.isArray(obj)) {
      obj.forEach((item, index) => {
        this._scanObjectForBase64(item, requestName, `${currentPath}[${index}]`, onFound);
      });
      return;
    }
    if (typeof obj === 'object' && obj !== null) {
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
    console.log('🔍 Analyzing collection...');

    // Run analysis
    await this.analyze();

    console.log('📝 Generating script...');

    // Generate script sections
    const initSection = this.generateInitialize();
    const actionSection = this.generateAction();
    const finalizeSection = this.generateFinalize();

    // Generate comment listing parameterized variables that need values in CSV
    let configComment = '';
    const emptyParams = [];
    for (const [name, config] of this.parameters.entries()) {
      if (!config.paramValue || config.paramValue === '') {
        emptyParams.push(name);
      }
    }
    if (emptyParams.length > 0) {
      configComment = `\n/**\n * CONFIGURATION REQUIRED:\n * The following parameters have empty values in collection_data.csv:\n${emptyParams.sort().map(v => ` *   - ${v}`).join('\n')}\n * \n * Please update collection_data.csv with the correct values before running.\n */\n`;
    }

    // Combine sections
    const fullScript = `${this.generateHeader()}${configComment}

${initSection}

${actionSection}

${finalizeSection}
`;

    const result = {
      script: fullScript,
      analysis: this.getAnalysisReport()
    };

    // Generate mandatory files if output directory specified
    if (outputDir) {
      console.log('📦 Generating mandatory files...');
      result.mandatoryFiles = await this.mandatoryFilesGen.generateAll(
        outputDir,
        this.parameters,
        this.options.examplesPath
      );

      // Write extracted base64 data files to data/ subfolder
      if (this.extractedDataFiles.size > 0) {
        const fs = require('fs');
        const path = require('path');
        const dataDir = path.join(outputDir, 'data');
        if (!fs.existsSync(dataDir)) {
          fs.mkdirSync(dataDir, { recursive: true });
        }
        for (const [hash, fileInfo] of this.extractedDataFiles.entries()) {
          const filePath = path.join(dataDir, fileInfo.fileName);
          fs.writeFileSync(filePath, fileInfo.content, 'utf8');
          console.log(`✓ Extracted: data/${fileInfo.fileName} (${(fileInfo.size / 1024).toFixed(1)} KB, used by ${fileInfo.usedBy.length} request(s))`);
        }
        result.extractedDataFiles = Array.from(this.extractedDataFiles.values()).map(f => f.fileName);
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
      this.correlations = this.correlationDetector.analyzeRequests(this.requests);
      console.log(`✓ Found ${this.correlations.length} correlation(s)`);
    }

    // Extract authentication
    if (this.options.useAuthentication) {
      this.authConfigs = this.authHandler.extractAuthentication(this.collection);
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

    // Scan for large base64 values in request bodies
    this.scanForLargeBase64();
  }

  /**
   * Parse custom scripts from Bruno/Postman requests
   */
  parseCustomScripts() {
    this.requests.forEach(request => {
      const scripts = {};

      const preScript = this.extractScriptFromRequest(request, 'prerequest');
      if (preScript) {
        scripts.preRequest = this.scriptParser.parsePreRequestScript(preScript, request.name);
      }

      const testScript = this.extractScriptFromRequest(request, 'test');
      if (testScript) {
        scripts.test = this.scriptParser.parseTestScript(testScript, request.name);
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
    if (listenType === 'prerequest' && request.preRequestScript) {
      return request.preRequestScript;
    }
    if (listenType === 'test' && request.testScript) {
      return request.testScript;
    }

    // Normalized format: request.tests is array of {listen, script} objects
    if (request.tests && Array.isArray(request.tests)) {
      const event = request.tests.find(e => e.listen === listenType);
      if (event && event.script) {
        if (event.script.exec && Array.isArray(event.script.exec)) {
          return event.script.exec.join('\n');
        }
        if (typeof event.script === 'string') return event.script;
      }
    }

    // Original Postman format: request.event
    if (request.event && Array.isArray(request.event)) {
      const event = request.event.find(e => e.listen === listenType);
      if (event && event.script && event.script.exec) {
        return event.script.exec.join('\n');
      }
    }

    return null;
  }

  /**
   * Generate script header
   */
  generateHeader() {
    const timestamp = new Date().toISOString();
    const collectionName = this.collection.info?.name || this.collection.name || 'Unknown';
    
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
`;
  }

  /**
   * Generate initialize section
   */
  generateInitialize() {
    let code = `load.initialize("init", async function() {
    load.log("🚀 Initializing Vuser " + load.config.user.userId, load.LogLevel.${this.options.logLevel});
    
    // Initialize global variables for correlation
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

    code += `\n    load.log("✓ Initialization complete", load.LogLevel.info);
});`;

    return code;
  }

  /**
   * Generate global variables initialization
   */
  generateGlobalVariablesInit() {
    const vars = [];
    const seen = new Set();

    // Add correlation variables (deduplicated)
    this.correlations.forEach(corr => {
      if (!seen.has(corr.name)) {
        seen.add(corr.name);
        vars.push(`load.global.${corr.name} = null; // Correlated: ${corr.type}`);
      }
    });

    // Add script-set dynamic variables not already covered by correlations
    this.dynamicVarNames.forEach(name => {
      if (!seen.has(name)) {
        seen.add(name);
        vars.push(`load.global.${name} = null; // Set by script at runtime`);
      }
    });

    // Add auth variables if not already in auth init
    if (this.authConfigs.size > 0) {
      vars.push('// Auth tokens will be set during authentication');
    }

    return vars.length > 0 ? vars.join('\n    ') : '// No global variables needed';
  }

  /**
   * Generate action section
   */
  generateAction() {
    let code = `load.action("Action", async function() {
    load.log("▶️  Starting action - Iteration " + load.config.runtime.iteration, load.LogLevel.info);

    // Set default request options
    load.WebRequest.defaults.returnBody = false;
    load.WebRequest.defaults.headers = {
        "accept-encoding": "gzip, deflate, br",
        "accept-language": "en-US,en;q=0.9",
        "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    };
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
  generateGroupedActions() {
    const grouped = this.groupRequestsByFolder();
    let code = '';

    // First, declare all transactions with short variable names (TS01, TS02, ...)
    const transactionDeclarations = [];
    const transactionMapping = new Map();

    // Build short transaction names from the last segment of folder path
    // e.g. "Connect/Industries/Fundraising/Gifts" -> "Gifts"
    const nameCount = new Map(); // Track duplicates

    Object.entries(grouped).forEach(([folder, requests], index) => {
      const seqNum = String(index + 1).padStart(2, '0');
      const varName = `TS${seqNum}`;
      const originalName = folder || `Transaction_${index + 1}`;

      // Extract last segment of the folder path as the short transaction name
      const segments = originalName.split('/');
      let shortName = segments[segments.length - 1].trim();

      // Handle duplicates by appending _1, _2, etc.
      const count = nameCount.get(shortName) || 0;
      nameCount.set(shortName, count + 1);
      if (count > 0) {
        shortName = `${shortName}_${count}`;
      }

      transactionMapping.set(folder, { varName: varName, shortName: shortName, originalName: originalName });
      transactionDeclarations.push(`let ${varName} = new load.Transaction("${shortName}");`);
    });

    // Add transaction declarations
    if (transactionDeclarations.length > 0) {
      code += `\n    ${this.generateComment('Transaction declarations')}`;
      transactionDeclarations.forEach(decl => {
        code += `\n    ${decl}`;
      });
      code += '\n';
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
        const hasValidation = customScripts?.test?.extractors?.some(e =>
          e.extractorType === 'textcheck' || e.extractorType === 'validation'
        );

        // Add conditional transaction status check for critical requests (login, auth, etc.)
        const isCritical = this.isCriticalRequest(request);
        if (isCritical || hasValidation) {
          hasCriticalValidation = true;
          const reqSafeName = this.sanitizeName(request.name);
          code += `\n`;
          code += `\n    // Check validation for critical request`;
          code += `\n    if (${reqSafeName}_response.status !== 200 && ${reqSafeName}_response.status !== 201) {`;
          code += `\n        load.log(\`${request.name} failed with status \${${reqSafeName}_response.status}\`, load.LogLevel.error);`;
          code += `\n        ${safeName}.stop(load.TransactionStatus.Failed);`;
          code += `\n        return false; // Abort script execution`;
          code += `\n    }`;

          // Check for validation extractors
          if (hasValidation) {
            customScripts.test.extractors.forEach(extractor => {
              if (extractor.extractorType === 'textcheck' || extractor.extractorType === 'validation') {
                code += `\n    if (!${reqSafeName}_response.extractors.${extractor.name}) {`;
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
          code += `\n    load.thinkTime(${this.options.thinkTime});`;
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
      urlLower.includes('/login') ||
      urlLower.includes('/auth') ||
      urlLower.includes('/token') ||
      urlLower.includes('/session') ||
      nameLower.includes('login') ||
      nameLower.includes('auth') ||
      nameLower.includes('token')
    );
  }

  /**
   * Generate sequential actions without grouping
   */
  generateSequentialActions() {
    let code = '';

    this.requests.forEach((request, index) => {
      code += this.generateRequestCode(request, 1);
      
      if (index < this.requests.length - 1 && this.options.thinkTime > 0) {
        code += `\n    load.sleep(${this.options.thinkTime});`;
      }
      code += `\n`;
    });

    return code;
  }

  /**
   * Generate code for a single request
   */
  generateRequestCode(request, indentLevel = 1) {
    let safeName = this.sanitizeName(request.name);

    // Ensure unique response variable names across the script
    const count = this.usedResponseNames.get(safeName) || 0;
    this.usedResponseNames.set(safeName, count + 1);
    if (count > 0) {
      safeName = `${safeName}_${count}`;
    }

    let code = '';

    // Add comment
    if (this.options.addComments) {
      code += `\n${this.indent(`// ${request.name}`, indentLevel)}`;
      if (request.description) {
        // Handle multi-line descriptions by commenting each line
        const descriptionLines = request.description.split('\n');
        descriptionLines.forEach((line) => {
          code += `\n${this.indent(`// ${line}`, indentLevel)}`;
        });
      }
    }

    // Check for correlation dependencies
    const dependencies = this.getCorrelationDependencies(request);
    if (dependencies.length > 0 && this.options.addComments) {
      code += `\n${this.indent(`// Depends on: ${dependencies.join(', ')}`, indentLevel)}`;
    }

    // Add pre-request script if exists
    const customScripts = this.customScripts.get(request.name);
    if (customScripts?.preRequest) {
      code += this.scriptParser.generatePreRequestCode(customScripts.preRequest, indentLevel);
    }

    // Generate WebRequest options
    const options = this.generateRequestOptions(request);

    code += `\n${this.indent(`const ${safeName}_response = new load.WebRequest(${options}).sendSync();`, indentLevel)}`;

    // Add response logging
    code += `\n${this.indent(`load.log(\`${request.name} - Status: \${${safeName}_response.status}\`, load.LogLevel.${this.options.logLevel});`, indentLevel)}`;

    // Handle correlation - store extracted values
    const produces = this.getProducedCorrelations(request);
    if (produces.length > 0) {
      code += `\n`;
      produces.forEach(corr => {
        code += `\n${this.indent(`load.global.${corr.name} = ${safeName}_response.extractors.${corr.name};`, indentLevel)}`;
        if (this.options.addComments) {
          code += ` // Extracted ${corr.type}`;
        }
      });
    }

    // Add post-response/test script if exists
    if (customScripts?.test) {
      code += this.scriptParser.generateTestCode(customScripts.test, `${safeName}_response`, indentLevel);

      // Add validation logic from test script
      if (customScripts.test.extractors && customScripts.test.extractors.length > 0) {
        code += `\n${this.indent(`// Validation checks from test script`, indentLevel)}`;
        customScripts.test.extractors.forEach(extractor => {
          code += `\n${this.indent(`if (${safeName}_response.extractors.${extractor.name}) {`, indentLevel)}`;
          code += `\n${this.indent(`    load.log("Validation passed: ${extractor.name}", load.LogLevel.info);`, indentLevel)}`;
          code += `\n${this.indent(`}`, indentLevel)}`;
        });
      }
    }

    return code;
  }

  /**
   * Generate WebRequest options object
   */
  generateRequestOptions(request) {
    const options = {
      id: ++this.requestIdCounter,
      url: this.replaceParameters(this.getBaseUrl(request.url)),
      method: request.method
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
    if (['POST', 'PUT', 'PATCH'].includes(request.method) && request.body) {
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
    const queryStart = url.indexOf('?');
    return queryStart === -1 ? url : url.substring(0, queryStart);
  }

  /**
   * Extract query string parameters from URL
   * Uses manual parsing to preserve {{variables}} and special characters
   */
  extractQueryString(url) {
    const queryStart = url.indexOf('?');
    if (queryStart === -1) return null;

    const queryString = url.substring(queryStart + 1);
    const params = {};
    queryString.split('&').forEach(pair => {
      const eqIndex = pair.indexOf('=');
      if (eqIndex === -1) {
        // Key with no value
        if (pair) {
          params[pair] = this.replaceParameters('');
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
   * Generate headers with auth injection
   */
  generateHeaders(request) {
    const headers = {};

    // Only add headers if they exist and are not empty
    if (request.headers && Array.isArray(request.headers) && request.headers.length > 0) {
      request.headers
        .filter(h => !h.disabled && h.key && h.value) // Only include enabled headers with both key and value
        .forEach(h => {
          headers[h.key] = this.replaceParameters(h.value);
        });
    }

    // Inject authentication headers only if auth is configured
    const authConfig = this.findAuthConfig(request);
    if (authConfig) {
      const authHeader = this.authHandler.generateAuthHeaderInjection(authConfig);
      if (authHeader) {
        // Parse the auth header code and add to headers
        const match = authHeader.match(/"([^"]+)":\s*(.+)/);
        if (match) {
          headers[match[1]] = `{{${match[2]}}}`;  // Will be replaced in final code
        }
      }
    }

    // Return headers only if there are any
    return Object.keys(headers).length > 0 ? headers : null;
  }

  /**
   * Generate request body, extracting large base64 values to external files
   */
  generateBody(body, requestName) {
    if (!body) return null;

    switch (body.mode) {
      case 'raw':
        try {
          const jsonBody = JSON.parse(body.raw);
          // Replace large base64 values with load.global references before parameter replacement
          const processedBody = this._replaceLargeBase64InObject(jsonBody, requestName, '');
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

      case 'urlencoded':
        const formData = {};
        body.urlencoded
          .filter(item => !item.disabled)
          .forEach(item => {
            formData[item.key] = this.replaceParameters(item.value);
          });
        return formData;

      case 'formdata':
        // For multipart, return special indicator
        return '{{MULTIPART}}';

      default:
        return body.raw || null;
    }
  }

  /**
   * Recursively replace large base64 values in a parsed JSON object
   * with load.global.varName references (as special marker strings)
   */
  _replaceLargeBase64InObject(obj, requestName, currentPath) {
    if (typeof obj === 'string') {
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
        return this._replaceLargeBase64InObject(item, requestName, `${currentPath}[${index}]`);
      });
    }
    if (typeof obj === 'object' && obj !== null) {
      const result = {};
      Object.entries(obj).forEach(([key, value]) => {
        const path = currentPath ? `${currentPath}.${key}` : key;
        result[key] = this._replaceLargeBase64InObject(value, requestName, path);
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

    // Find correlations this request produces (deduplicate by name)
    this.correlations.forEach(corr => {
      if (corr.producerRequest === request.name && !seenNames.has(corr.name)) {
        seenNames.add(corr.name);
        const extractorCode = this.correlationDetector.generateExtractor(corr);
        extractors.push(extractorCode);
      }
    });

    // Add extractors from custom test scripts (deduplicate by name)
    const customScripts = this.customScripts.get(request.name);
    if (customScripts?.test?.extractors) {
      customScripts.test.extractors.forEach(extractor => {
        if (!seenNames.has(extractor.name)) {
          seenNames.add(extractor.name);
          const extractorCode = this.correlationDetector.generateExtractor(extractor);
          extractors.push(extractorCode);
        }
      });
    }

    // Add status code validation extractor if test script has assertions
    if (customScripts?.test?.assertions && customScripts.test.assertions.length > 0) {
      // Check for status code assertions
      const statusAssertion = customScripts.test.assertions.find(a =>
        a.toLowerCase().includes('status') || a.toLowerCase().includes('code')
      );
      if (statusAssertion) {
        // Add TextCheckExtractor for success validation
        const textCheck = this.correlationDetector.createTextCheckExtractor(
          'validationCheck',
          'success',
          { scope: 'load.ExtractorScope.Body', failOn: false }
        );
        extractors.push(this.correlationDetector.generateExtractor(textCheck));
      }
    }

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
    if (!str || typeof str !== 'string') return str;

    return str.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const trimmedName = varName.trim();

      // Postman built-in dynamic variables ($randomXxx, $guid, $timestamp)
      if (trimmedName.startsWith('$')) {
        return this.resolvePostmanDynamicVar(trimmedName);
      }

      // Dynamic variable → load.global (set by scripts/correlation at runtime)
      if (this.dynamicVarNames.has(trimmedName)) {
        return `\${load.global.${trimmedName}}`;
      }

      // Parameterized variable → load.params (from CSV)
      if (this.paramVarNames.has(trimmedName)) {
        const isSimpleIdentifier = /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmedName);
        if (isSimpleIdentifier) {
          return `\${load.params.${trimmedName}}`;
        }
        return `\${load.params["${trimmedName}"]}`;
      }

      // Variable exists in map but wasn't classified (parameterization disabled)
      if (this.variableMap.has(trimmedName)) {
        const value = this.variableMap.get(trimmedName);
        if (value !== '' && value !== null && value !== undefined) {
          return String(value);
        }
        return match; // Keep as-is for manual review
      }

      // Not found — keep original for manual review
      console.warn(`Variable "${trimmedName}" not found in collection/environment variables`);
      return match;
    });
  }

  /**
   * Resolve Postman built-in dynamic variables to static values
   */
  resolvePostmanDynamicVar(varName) {
    const dynamicVars = {
      '$guid': 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx',
      '$timestamp': 'Date.now()',
      '$randomInt': 'Math.floor(Math.random() * 1000)',
      '$randomCompanyName': 'TestCompany',
      '$randomFirstName': 'John',
      '$randomLastName': 'Doe',
      '$randomEmail': 'test@example.com',
      '$randomUserName': 'testuser',
      '$randomPhoneNumber': '555-0100',
      '$randomCity': 'TestCity',
      '$randomStreetAddress': '123 Test St',
      '$randomCountry': 'US',
      '$randomColor': 'blue',
      '$randomBoolean': 'true',
      '$randomUUID': 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    };
    return dynamicVars[varName] || `TODO_${varName.replace('$', '')}`;
  }

  /**
   * Replace parameters in object
   */
  replaceParametersInObject(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;

    if (Array.isArray(obj)) {
      return obj.map(item => this.replaceParametersInObject(item));
    }

    const result = {};
    Object.entries(obj).forEach(([key, value]) => {
      if (typeof value === 'string') {
        // Skip strings that are already load.global markers (from base64 extraction)
        if (/^\{\{load\.global\..+\}\}$/.test(value)) {
          result[key] = value;
        } else {
          result[key] = this.replaceParameters(value);
        }
      } else if (typeof value === 'object') {
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
      if (content.includes('${')) {
        return '`' + content.replace(/\\"/g, '"') + '`';
      }
      return match;
    });

    // Replace "{{MULTIPART}}" with actual multipart code
    str = str.replace('"{{MULTIPART}}"', 'new load.MultipartBody([...])');

    // Strip quotes from extractor code (new load.XXXExtractor(...))
    // JSON.stringify escapes inner quotes as \", so match those too, then unescape
    str = str.replace(/"(new load\.\w+Extractor\((?:[^"\\]|\\.)*\))"/g, (match, code) => {
      return code.replace(/\\"/g, '"');
    });

    // Only strip quotes for known code patterns (load.*, new load.*)
    // Leave all other "{{...}}" as quoted strings (unresolvable variable references)
    str = str.replace(/"{{((?:load\.|new load\.)[^}]+)}}"/g, '$1');

    return str;
  }

  /**
   * Group requests by folder
   */
  groupRequestsByFolder() {
    const grouped = {};
    
    this.requests.forEach(request => {
      const folder = request.folder || 'API Requests';
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
      .filter(corr => corr.consumerRequest === request.name)
      .map(corr => corr.producerRequest);
  }

  /**
   * Get correlations this request produces
   */
  getProducedCorrelations(request) {
    const seen = new Set();
    return this.correlations.filter(corr => {
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
    return `load.finalize("finalize", async function() {
    load.log("🏁 Finalizing Vuser " + load.config.user.userId, load.LogLevel.info);
    
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
        withCustomScripts: this.customScripts.size
      },
      correlations: this.correlationDetector.getCorrelationReport(),
      parameters: this.paramEngine.getReport(),
      authentication: this.authHandler.getAuthSummary(),
      customScripts: {
        total: this.customScripts.size,
        preRequest: Array.from(this.customScripts.values()).filter(s => s.preRequest).length,
        test: Array.from(this.customScripts.values()).filter(s => s.test).length,
        warnings: this.scriptParser.getAllWarnings()
      },
      options: this.options
    };
  }

  /**
   * Get requests grouped by HTTP method
   */
  getRequestsByMethod() {
    const byMethod = {};
    this.requests.forEach(req => {
      byMethod[req.method] = (byMethod[req.method] || 0) + 1;
    });
    return byMethod;
  }

  /**
   * Sanitize name for use as JavaScript variable
   */
  sanitizeName(name) {
    return name
      .replace(/[^a-zA-Z0-9_]/g, '_')
      .replace(/^[0-9]/, '_$&')
      .replace(/_+/g, '_');
  }

  /**
   * Generate a clean transaction variable name (camelCase without prefixes/suffixes)
   */
  generateTransactionVarName(transactionName) {
    // Remove common prefixes/suffixes
    let name = transactionName
      .replace(/^(Transaction|Trans|T)[-_\s]*/i, '')
      .replace(/[-_\s]*(Transaction|Trans)$/i, '');

    // Convert to camelCase
    name = name
      .split(/[\s\-_\/]+/)
      .map((word, index) => {
        // Remove special characters
        word = word.replace(/[^a-zA-Z0-9]/g, '');
        if (word.length === 0) return '';

        // First word lowercase, rest capitalize first letter
        if (index === 0) {
          return word.charAt(0).toLowerCase() + word.slice(1);
        }
        return word.charAt(0).toUpperCase() + word.slice(1);
      })
      .join('');

    // Ensure it's a valid JS identifier
    if (!name || /^[0-9]/.test(name)) {
      name = 't' + name;
    }

    return name || 'transaction';
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
    const spaces = '    '.repeat(level);
    return text.split('\n').map(line => spaces + line).join('\n');
  }
}

module.exports = AdvancedScriptGenerator;
