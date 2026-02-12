/**
 * Advanced DevWeb Script Generator
 * Integrates correlation, parameterization, authentication, and transactions
 */

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

    // Build variable map from collection for hardcoding values
    this.variableMap = new Map();
    this.buildVariableMap();
  }

  /**
   * Build a map of variables from collection and environment
   */
  buildVariableMap() {
    // Extract collection variables
    if (this.collection.variable) {
      this.collection.variable.forEach(variable => {
        this.variableMap.set(variable.key, variable.value);
      });
    }

    // Extract environment variables (if available)
    if (this.collection.environment) {
      Object.entries(this.collection.environment).forEach(([key, value]) => {
        this.variableMap.set(key, value);
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

    // Combine sections
    const fullScript = `${this.generateHeader()}

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
    }

    return result;
  }

  /**
   * Analyze collection for correlations, parameters, and auth
   */
  async analyze() {
    // Detect correlations
    if (this.options.useCorrelation) {
      this.correlations = this.correlationDetector.analyzeRequests(this.requests);
      console.log(`✓ Found ${this.correlations.length} correlation(s)`);
    }

    // Extract parameters (disabled by default - only for CSV-based test data)
    // For most API scripts, variables are hardcoded from collection/environment
    // Only enable parameterization if you need CSV-based data-driven testing
    if (this.options.useParameterization && this.options.generateCSVParameters) {
      this.parameters = await this.paramEngine.extractParameters(this.collection);
      console.log(`✓ Extracted ${this.parameters.size} parameter(s) for CSV generation`);
    } else {
      console.log('ℹ️  Parameterization disabled - using hardcoded values from collection variables');
    }

    // Extract authentication
    if (this.options.useAuthentication) {
      this.authConfigs = this.authHandler.extractAuthentication(this.collection);
      console.log(`✓ Configured ${this.authConfigs.size} authentication(s)`);
    }

    // Parse custom scripts
    if (this.options.useCustomScripts) {
      this.parseCustomScripts();
      console.log(`✓ Parsed ${this.customScripts.size} custom script(s)`);
    }
  }

  /**
   * Parse custom scripts from Bruno/Postman requests
   */
  parseCustomScripts() {
    this.requests.forEach(request => {
      const scripts = {};

      // Parse pre-request script
      if (request.preRequestScript || request.event?.find(e => e.listen === 'prerequest')) {
        const script = request.preRequestScript ||
                      request.event.find(e => e.listen === 'prerequest')?.script?.exec?.join('\n');
        if (script) {
          scripts.preRequest = this.scriptParser.parsePreRequestScript(script, request.name);
        }
      }

      // Parse test/post-response script
      if (request.testScript || request.tests || request.event?.find(e => e.listen === 'test')) {
        const script = request.testScript ||
                      request.tests ||
                      request.event.find(e => e.listen === 'test')?.script?.exec?.join('\n');
        if (script) {
          scripts.test = this.scriptParser.parseTestScript(script, request.name);
        }
      }

      if (scripts.preRequest || scripts.test) {
        this.customScripts.set(request.name, scripts);
      }
    });
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
    
    // Add correlation variables
    this.correlations.forEach(corr => {
      vars.push(`load.global.${corr.name} = null; // For ${corr.type}`);
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
    const safeName = this.sanitizeName(request.name);
    let code = '';

    // Add comment
    if (this.options.addComments) {
      code += `\n${this.indent(`// ${request.name}`, indentLevel)}`;
      if (request.description) {
        // Handle multi-line descriptions by commenting each line
        const descriptionLines = request.description.split('\n');
        console.log(`DEBUG: Description has ${descriptionLines.length} lines for request: ${request.name}`);
        descriptionLines.forEach((line, idx) => {
          console.log(`  Line ${idx}: "${line.substring(0, 50)}${line.length > 50 ? '...' : ''}"`);
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
      method: request.method,
      returnBody: true
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
      const body = this.generateBody(request.body);
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
   */
  getBaseUrl(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.origin + urlObj.pathname;
    } catch (e) {
      // If URL parsing fails, try simple split
      return url.split('?')[0];
    }
  }

  /**
   * Extract query string parameters from URL
   */
  extractQueryString(url) {
    try {
      const urlObj = new URL(url);
      const params = {};
      urlObj.searchParams.forEach((value, key) => {
        params[key] = this.replaceParameters(value);
      });
      return Object.keys(params).length > 0 ? params : null;
    } catch (e) {
      // If URL parsing fails, try manual extraction
      const queryStart = url.indexOf('?');
      if (queryStart === -1) return null;

      const queryString = url.substring(queryStart + 1);
      const params = {};
      queryString.split('&').forEach(pair => {
        const [key, value] = pair.split('=');
        if (key) {
          params[decodeURIComponent(key)] = this.replaceParameters(decodeURIComponent(value || ''));
        }
      });
      return Object.keys(params).length > 0 ? params : null;
    }
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
   * Generate request body
   */
  generateBody(body) {
    if (!body) return null;

    switch (body.mode) {
      case 'raw':
        try {
          const jsonBody = JSON.parse(body.raw);
          return this.replaceParametersInObject(jsonBody);
        } catch (e) {
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
   * Generate extractors for this request
   */
  generateExtractors(request) {
    const extractors = [];

    // Find correlations this request produces
    this.correlations.forEach(corr => {
      if (corr.producerRequest === request.name) {
        const extractorCode = this.correlationDetector.generateExtractor(corr);
        extractors.push(extractorCode);
      }
    });

    // Add extractors from custom test scripts
    const customScripts = this.customScripts.get(request.name);
    if (customScripts?.test?.extractors) {
      customScripts.test.extractors.forEach(extractor => {
        const extractorCode = this.correlationDetector.generateExtractor(extractor);
        extractors.push(extractorCode);
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
   * Replace parameters in string with hardcoded values or extracted values
   */
  replaceParameters(str) {
    if (!str || typeof str !== 'string') return str;

    // Replace {{variable}} with actual hardcoded values from collection/environment
    return str.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
      const trimmedName = varName.trim();

      // Check if we have this variable in our collection/environment
      if (this.variableMap.has(trimmedName)) {
        const value = this.variableMap.get(trimmedName);
        // Return the actual value (properly escaped for string interpolation)
        if (typeof value === 'string') {
          return value;
        }
        return String(value);
      }

      // Check if this is a correlated value (extracted from previous response)
      const correlation = this.correlations.find(c => c.name === trimmedName);
      if (correlation) {
        // Use extracted value from previous response
        return `\${load.global.${trimmedName}}`;
      }

      // If not found, keep original or use empty string as fallback
      // This allows manual editing if needed
      console.warn(`Variable "${trimmedName}" not found in collection/environment variables`);
      return match; // Keep original {{variable}} syntax for manual review
    });
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
        result[key] = this.replaceParameters(value);
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

    // Replace "${xxx}" with `${xxx}` (template literal in backticks)
    str = str.replace(/"(\$\{[^}]+\})"/g, '`$1`');

    // Replace "{{MULTIPART}}" with actual multipart code
    str = str.replace('"{{MULTIPART}}"', 'new load.MultipartBody([...])');

    // Replace {{code}} patterns with actual code
    str = str.replace(/"{{([^}]+)}}"/g, '$1');

    return str;
  }

  /**
   * Group requests by folder
   */
  groupRequestsByFolder() {
    const grouped = {};
    
    this.requests.forEach(request => {
      const folder = request.folder || 'default';
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
    return this.correlations.filter(corr => corr.producerRequest === request.name);
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
