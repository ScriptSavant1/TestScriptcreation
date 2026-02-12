/**
 * Advanced Correlation Detector
 * Automatically detects dynamic values that need correlation in API responses
 */

class CorrelationDetector {
  constructor() {
    // Common patterns that typically need correlation
    this.correlationPatterns = [
      // Tokens and IDs
      { pattern: /token/i, type: 'token', extractorType: 'json' },
      { pattern: /sessionid/i, type: 'sessionId', extractorType: 'json' },
      { pattern: /csrf/i, type: 'csrf', extractorType: 'boundary' },
      { pattern: /\bid\b/i, type: 'id', extractorType: 'json' },
      { pattern: /auth/i, type: 'auth', extractorType: 'json' },
      { pattern: /bearer/i, type: 'bearer', extractorType: 'json' },
      
      // Cookie-based authentication (common in enterprise apps)
      { pattern: /lwsso_cookie_key/i, type: 'cookieAuth', extractorType: 'cookie' },
      { pattern: /jsessionid/i, type: 'sessionCookie', extractorType: 'cookie' },
      { pattern: /phpsessid/i, type: 'sessionCookie', extractorType: 'cookie' },
      { pattern: /asp\.net_sessionid/i, type: 'sessionCookie', extractorType: 'cookie' },
      
      // ViewState and form values
      { pattern: /viewstate/i, type: 'viewstate', extractorType: 'boundary' },
      { pattern: /eventvalidation/i, type: 'eventvalidation', extractorType: 'boundary' },
      
      // Timestamps
      { pattern: /timestamp/i, type: 'timestamp', extractorType: 'json' },
      { pattern: /nonce/i, type: 'nonce', extractorType: 'json' },
      
      // Order/Transaction IDs
      { pattern: /orderid/i, type: 'orderId', extractorType: 'json' },
      { pattern: /transactionid/i, type: 'transactionId', extractorType: 'json' },
      { pattern: /requestid/i, type: 'requestId', extractorType: 'json' }
    ];

    this.correlationRules = [];
  }

  /**
   * Analyze requests to detect potential correlations
   */
  analyzeRequests(requests) {
    const correlations = [];
    const valueRegistry = new Map(); // Track values across requests

    // First pass: collect all produced values from each request
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];

      // Check if this request might produce values for correlation
      const produces = this.detectProducedValues(request, i);
      produces.forEach(p => {
        if (!valueRegistry.has(p.name)) {
          valueRegistry.set(p.name, []);
        }
        valueRegistry.get(p.name).push({
          producedAt: i,
          requestName: request.name,
          ...p
        });
      });
    }

    // Second pass: check which values are consumed
    for (let i = 0; i < requests.length; i++) {
      const request = requests[i];

      // Check if this request consumes values
      const consumes = this.detectConsumedValues(request, i, valueRegistry);

      // Create correlation rules
      consumes.forEach(consume => {
        const producers = valueRegistry.get(consume.name) || [];
        // Find the most recent producer before this consumer
        const producer = [...producers]
          .filter(p => p.producedAt < i)
          .sort((a, b) => b.producedAt - a.producedAt)[0];

        if (producer) {
          // Check if this correlation already exists
          const exists = correlations.some(c =>
            c.name === consume.name &&
            c.consumerRequest === request.name
          );

          if (!exists) {
            correlations.push({
              name: consume.name,
              type: producer.type || consume.type,
              producerRequest: producer.requestName,
              producerIndex: producer.producedAt,
              consumerRequest: request.name,
              consumerIndex: i,
              extractorType: producer.extractorType,
              extractPath: producer.extractPath,
              usageLocation: consume.location,
              usagePath: consume.path
            });
          }
        }
      });
    }

    this.correlationRules = correlations;
    return correlations;
  }

  /**
   * Detect values that this request produces (in response)
   */
  detectProducedValues(request, index) {
    const produced = [];

    // 1. Check test scripts for variable assignments (pm.environment.set, pm.globals.set, etc.)
    const testScript = this.extractTestScript(request);
    if (testScript) {
      const setVariables = this.extractSetVariables(testScript);
      setVariables.forEach(varInfo => {
        produced.push({
          name: varInfo.name,
          type: this.inferType(varInfo.name, varInfo.source),
          extractorType: varInfo.extractorType || 'json',
          extractPath: varInfo.extractPath || `$.${varInfo.name}`
        });
      });
    }

    // 2. Check URL patterns for common endpoints that produce values
    const urlLower = request.url.toLowerCase();
    const nameLower = request.name.toLowerCase();

    // Authentication/Login endpoints
    if (urlLower.includes('/login') || urlLower.includes('/auth') || urlLower.includes('/token') ||
        nameLower.includes('login') || nameLower.includes('auth')) {
      if (!produced.find(p => p.type === 'token')) {
        produced.push({
          name: 'authToken',
          type: 'token',
          extractorType: 'json',
          extractPath: '$.access_token'
        });
      }
      if (!produced.find(p => p.name === 'userId')) {
        produced.push({
          name: 'userId',
          type: 'id',
          extractorType: 'json',
          extractPath: '$.userId'
        });
      }
    }

    // Session endpoints
    if (urlLower.includes('/session') || nameLower.includes('session')) {
      produced.push({
        name: 'sessionId',
        type: 'sessionId',
        extractorType: 'json',
        extractPath: '$.sessionId'
      });
    }

    // OAuth endpoints
    if (urlLower.includes('/oauth') || urlLower.includes('/authorize')) {
      produced.push({
        name: 'authCode',
        type: 'token',
        extractorType: 'boundary',
        extractPath: 'code=',
        leftBound: 'code=',
        rightBound: '&'
      });
    }

    // Create/POST endpoints that return IDs
    if (request.method === 'POST' && (urlLower.includes('/create') || urlLower.includes('/add') ||
        nameLower.includes('create') || nameLower.includes('add'))) {
      produced.push({
        name: 'createdId',
        type: 'id',
        extractorType: 'json',
        extractPath: '$.id'
      });
    }

    // 3. Check response headers that might be used later
    // (This would be from example responses in Postman/Bruno)
    if (request.response && request.response.header) {
      request.response.header.forEach(h => {
        const key = h.key.toLowerCase();
        if (key.includes('token') || key.includes('authorization') || key.includes('cookie')) {
          produced.push({
            name: h.key,
            type: 'header',
            extractorType: 'header',
            extractPath: h.key
          });
        }
      });
    }

    return produced;
  }

  /**
   * Extract test script from request
   */
  extractTestScript(request) {
    if (request.testScript) return request.testScript;
    if (request.tests) return request.tests;
    if (request.event) {
      const testEvent = request.event.find(e => e.listen === 'test');
      if (testEvent && testEvent.script && testEvent.script.exec) {
        return testEvent.script.exec.join('\n');
      }
    }
    return null;
  }

  /**
   * Extract variable assignments from test script
   */
  extractSetVariables(script) {
    const variables = [];
    if (!script) return variables;

    // Pattern: pm.environment.set("varName", jsonData.field)
    const pmSetPattern = /pm\.(environment|globals|collectionVariables)\.set\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    let match;
    while ((match = pmSetPattern.exec(script)) !== null) {
      const varName = match[2];
      const source = match[3];
      variables.push({
        name: varName,
        source: source,
        extractorType: this.determineExtractorType(source),
        extractPath: this.extractJsonPath(source)
      });
    }

    // Pattern: bru.setVar("varName", response.body.field)
    const bruSetPattern = /bru\.setVar\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = bruSetPattern.exec(script)) !== null) {
      const varName = match[1];
      const source = match[2];
      variables.push({
        name: varName,
        source: source,
        extractorType: this.determineExtractorType(source),
        extractPath: this.extractJsonPath(source)
      });
    }

    return variables;
  }

  /**
   * Determine extractor type from source expression
   */
  determineExtractorType(source) {
    if (source.includes('jsonData') || source.includes('response.body') || source.includes('JSON.parse')) {
      return 'json';
    } else if (source.includes('header') || source.includes('getResponseHeader')) {
      return 'header';
    } else if (source.includes('cookie')) {
      return 'cookie';
    }
    return 'json'; // default
  }

  /**
   * Extract JSON path from source expression
   */
  extractJsonPath(source) {
    // Try to extract path from jsonData.field1.field2
    const match = source.match(/(?:jsonData|responseBody)\.(.+)/);
    if (match) {
      const path = match[1].replace(/\[["']([^"']+)["']\]/g, '.$1');
      return `$.${path}`;
    }
    return '$';
  }

  /**
   * Infer type from variable name
   */
  inferType(name, source) {
    const nameLower = name.toLowerCase();
    const sourceLower = (source || '').toLowerCase();

    if (nameLower.includes('token') || sourceLower.includes('token')) return 'token';
    if (nameLower.includes('session')) return 'sessionId';
    if (nameLower.includes('auth')) return 'auth';
    if (nameLower.includes('id')) return 'id';
    if (nameLower.includes('csrf')) return 'csrf';
    if (nameLower.includes('nonce')) return 'nonce';
    if (nameLower.includes('timestamp')) return 'timestamp';

    return 'dynamic';
  }

  /**
   * Detect values that this request consumes (needs from previous requests)
   */
  detectConsumedValues(request, index, valueRegistry) {
    const consumed = [];

    // 1. Check pre-request scripts for variable usage
    const preScript = this.extractPreRequestScript(request);
    if (preScript) {
      const usedVars = this.extractUsedVariables(preScript);
      usedVars.forEach(varName => {
        if (valueRegistry.has(varName)) {
          consumed.push({
            name: varName,
            type: 'variable',
            location: 'preRequest',
            path: varName
          });
        }
      });
    }

    // 2. Check headers for variables
    if (request.headers) {
      // Handle both array and object formats
      const headers = Array.isArray(request.headers) ? request.headers : Object.entries(request.headers).map(([k, v]) => ({ key: k, value: v }));

      headers.forEach(header => {
        if (header.disabled) return;

        const key = header.key;
        const value = header.value;

        // Skip headers without a key
        if (!key) return;

        // Check if header value looks like a variable/placeholder
        if (this.isVariablePattern(value)) {
          const varName = this.extractVariableName(value);
          if (valueRegistry.has(varName)) {
            consumed.push({
              name: varName,
              type: 'header',
              location: 'headers',
              path: key
            });
          }
        }

        // Check for common auth patterns
        if (key.toLowerCase() === 'authorization' && this.isVariablePattern(value)) {
          const varName = this.extractVariableName(value);
          if (!consumed.find(c => c.name === varName)) {
            consumed.push({
              name: varName || 'authToken',
              type: 'token',
              location: 'headers',
              path: 'Authorization'
            });
          }
        }

        // Check for bearer token patterns
        if (value && value.toLowerCase().includes('bearer') && this.isVariablePattern(value)) {
          const varName = this.extractVariableName(value);
          if (varName && !consumed.find(c => c.name === varName)) {
            consumed.push({
              name: varName,
              type: 'token',
              location: 'headers',
              path: key
            });
          }
        }
      });
    }

    // 3. Check URL for variables (in path and query params)
    try {
      const url = new URL(request.url, 'http://dummy.com');

      // Check path for variables
      const pathVars = this.findVariablesInString(url.pathname);
      pathVars.forEach(varName => {
        if (valueRegistry.has(varName) && !consumed.find(c => c.name === varName)) {
          consumed.push({
            name: varName,
            type: 'path',
            location: 'url',
            path: 'path'
          });
        }
      });

      // Check query parameters
      url.searchParams.forEach((value, key) => {
        if (this.isVariablePattern(value)) {
          const varName = this.extractVariableName(value);
          if (valueRegistry.has(varName) && !consumed.find(c => c.name === varName)) {
            consumed.push({
              name: varName,
              type: 'query',
              location: 'queryString',
              path: key
            });
          }
        }
      });
    } catch (e) {
      // URL parsing failed, try simple pattern matching
      const urlVars = this.findVariablesInString(request.url);
      urlVars.forEach(varName => {
        if (valueRegistry.has(varName) && !consumed.find(c => c.name === varName)) {
          consumed.push({
            name: varName,
            type: 'url',
            location: 'url',
            path: 'url'
          });
        }
      });
    }

    // 4. Check request body for variables
    if (request.body) {
      const bodyVars = this.findVariablesInBody(request.body);
      bodyVars.forEach(varInfo => {
        if (valueRegistry.has(varInfo.name) && !consumed.find(c => c.name === varInfo.name)) {
          consumed.push({
            name: varInfo.name,
            type: 'body',
            location: 'body',
            path: varInfo.path
          });
        }
      });
    }

    return consumed;
  }

  /**
   * Extract pre-request script from request
   */
  extractPreRequestScript(request) {
    if (request.preRequestScript) return request.preRequestScript;
    if (request.event) {
      const preEvent = request.event.find(e => e.listen === 'prerequest');
      if (preEvent && preEvent.script && preEvent.script.exec) {
        return preEvent.script.exec.join('\n');
      }
    }
    return null;
  }

  /**
   * Extract used variables from pre-request script
   */
  extractUsedVariables(script) {
    const variables = new Set();
    if (!script) return Array.from(variables);

    // Pattern: pm.environment.get("varName")
    const pmGetPattern = /pm\.(environment|globals|collectionVariables|variables)\.get\s*\(\s*["']([^"']+)["']\s*\)/g;
    let match;
    while ((match = pmGetPattern.exec(script)) !== null) {
      variables.add(match[2]);
    }

    // Pattern: bru.getVar("varName")
    const bruGetPattern = /bru\.getVar\s*\(\s*["']([^"']+)["']\s*\)/g;
    while ((match = bruGetPattern.exec(script)) !== null) {
      variables.add(match[1]);
    }

    return Array.from(variables);
  }

  /**
   * Find variables in a string
   */
  findVariablesInString(str) {
    const variables = [];
    if (!str || typeof str !== 'string') return variables;

    const matches = str.matchAll(/\{\{([^}]+)\}\}|\$\{([^}]+)\}/g);
    for (const match of matches) {
      const varName = (match[1] || match[2]).trim();
      variables.push(varName);
    }

    return variables;
  }

  /**
   * Check if a value looks like a variable pattern
   */
  isVariablePattern(value) {
    if (!value || typeof value !== 'string') return false;
    
    // Common variable patterns: {{var}}, ${var}, {var}, <var>
    return /\{\{.*?\}\}|\$\{.*?\}|\{.*?\}|<.*?>/.test(value);
  }

  /**
   * Extract variable name from pattern
   */
  extractVariableName(value) {
    const match = value.match(/\{\{(.*?)\}\}|\$\{(.*?)\}|\{(.*?)\}|<(.*?)>/);
    if (match) {
      const extracted = match[1] || match[2] || match[3] || match[4];
      return extracted ? extracted.trim() : value;
    }
    return value;
  }

  /**
   * Find variables in request body
   */
  findVariablesInBody(body, path = '$') {
    const variables = [];

    if (typeof body === 'string') {
      // Parse if JSON string
      try {
        body = JSON.parse(body);
      } catch (e) {
        // Check for variable patterns in string
        const matches = body.matchAll(/\{\{(.*?)\}\}|\$\{(.*?)\}/g);
        for (const match of matches) {
          variables.push({
            name: (match[1] || match[2]).trim(),
            path: path
          });
        }
        return variables;
      }
    }

    if (typeof body === 'object' && body !== null) {
      Object.entries(body).forEach(([key, value]) => {
        const currentPath = `${path}.${key}`;
        
        if (typeof value === 'string' && this.isVariablePattern(value)) {
          variables.push({
            name: this.extractVariableName(value),
            path: currentPath
          });
        } else if (typeof value === 'object') {
          variables.push(...this.findVariablesInBody(value, currentPath));
        }
      });
    }

    return variables;
  }

  /**
   * Generate extractor code for DevWeb
   */
  generateExtractor(correlation) {
    switch (correlation.extractorType) {
      case 'json':
        return `new load.JsonPathExtractor("${correlation.name}", "${correlation.extractPath}")`;

      case 'boundary':
        return `new load.BoundaryExtractor("${correlation.name}", "${correlation.leftBound || '<'}", "${correlation.rightBound || '>'}")`;

      case 'regex':
      case 'regexp':
        return `new load.RegexpExtractor("${correlation.name}", "${correlation.pattern || '(.+)'}")`;

      case 'textcheck':
      case 'validation':
        // TextCheckExtractor for validating presence of text
        const options = correlation.extractorOptions || {};
        const text = correlation.expectedText || correlation.text || correlation.value;
        const scope = options.scope || 'load.ExtractorScope.Body';
        const failOn = options.failOn !== undefined ? options.failOn : false;
        return `new load.TextCheckExtractor("${correlation.name}", { text: "${text}", scope: ${scope}, failOn: ${failOn} })`;

      case 'header':
        return `new load.BoundaryExtractor("${correlation.name}", "${correlation.extractPath}: ", "\\r\\n")`;

      case 'cookie':
        // For cookies like LWSSO_COOKIE_KEY
        const cookieName = correlation.extractPath || correlation.name;
        return `new load.CookieExtractor("${correlation.name}", "${cookieName}")`;

      default:
        return `new load.JsonPathExtractor("${correlation.name}", "$.${correlation.name}")`;
    }
  }

  /**
   * Create a TextCheckExtractor configuration
   */
  createTextCheckExtractor(name, text, options = {}) {
    return {
      name,
      extractorType: 'textcheck',
      expectedText: text,
      extractorOptions: {
        scope: options.scope || 'load.ExtractorScope.Body',
        failOn: options.failOn !== undefined ? options.failOn : false
      }
    };
  }

  /**
   * Create a RegexpExtractor configuration
   */
  createRegexpExtractor(name, pattern, flags = '') {
    return {
      name,
      extractorType: 'regexp',
      pattern,
      flags
    };
  }

  /**
   * Generate usage code for DevWeb
   */
  generateUsage(correlation, requestVarName) {
    const varName = `load.global.${correlation.name}`;
    
    switch (correlation.usageLocation) {
      case 'header':
        return `"${correlation.usagePath}": ${varName}`;
      
      case 'queryString':
        return `"${correlation.usagePath}": ${varName}`;
      
      case 'body':
        return `// Use ${varName} for ${correlation.usagePath}`;
      
      default:
        return varName;
    }
  }

  /**
   * Get correlation report
   */
  getCorrelationReport() {
    return {
      totalCorrelations: this.correlationRules.length,
      correlations: this.correlationRules,
      summary: this.generateSummary()
    };
  }

  generateSummary() {
    const byType = {};
    this.correlationRules.forEach(corr => {
      byType[corr.type] = (byType[corr.type] || 0) + 1;
    });
    
    return {
      byType,
      recommendations: this.generateRecommendations()
    };
  }

  generateRecommendations() {
    const recommendations = [];
    
    if (this.correlationRules.some(c => c.type === 'token')) {
      recommendations.push('Authentication tokens detected. Ensure proper token extraction and usage.');
    }
    
    if (this.correlationRules.some(c => c.type === 'csrf')) {
      recommendations.push('CSRF tokens detected. Verify CSRF handling in your application.');
    }
    
    if (this.correlationRules.length === 0) {
      recommendations.push('No automatic correlations detected. Manual review recommended.');
    }
    
    return recommendations;
  }
}

module.exports = CorrelationDetector;
