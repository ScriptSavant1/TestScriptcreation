/**
 * Custom Script Parser
 * Parses and converts Bruno/Postman pre-request and test scripts to DevWeb code
 */

class CustomScriptParser {
  constructor() {
    this.unsupportedFeatures = new Set();
    this.warnings = [];
  }

  /**
   * Parse pre-request script
   */
  parsePreRequestScript(script, requestName) {
    // Handle non-string scripts
    if (!script) {
      return null;
    }

    // Convert to string if necessary
    if (typeof script !== 'string') {
      if (Array.isArray(script)) {
        script = script.join('\n');
      } else if (typeof script === 'object') {
        // Try to extract script from object structure
        script = script.exec?.join('\n') || JSON.stringify(script);
      } else {
        script = String(script);
      }
    }

    if (script.trim() === '') {
      return null;
    }

    const result = {
      originalScript: script,
      convertedCode: [],
      variables: [],
      warnings: [],
      hasUnsupportedCode: false
    };

    try {
      const lines = script.split('\n');

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('//')) continue;

        const converted = this.convertScriptLine(line, 'pre-request');
        if (converted) {
          result.convertedCode.push(converted.code);
          if (converted.variables) {
            result.variables.push(...converted.variables);
          }
          if (converted.warning) {
            result.warnings.push(converted.warning);
          }
          if (converted.unsupported) {
            result.hasUnsupportedCode = true;
          }
        }
      }

      return result;
    } catch (error) {
      result.warnings.push(`Failed to parse pre-request script: ${error.message}`);
      result.hasUnsupportedCode = true;
      return result;
    }
  }

  /**
   * Parse test/post-response script
   */
  parseTestScript(script, requestName) {
    // Handle non-string scripts
    if (!script) {
      return null;
    }

    // Convert to string if necessary
    if (typeof script !== 'string') {
      if (Array.isArray(script)) {
        script = script.join('\n');
      } else if (typeof script === 'object') {
        // Try to extract script from object structure
        script = script.exec?.join('\n') || JSON.stringify(script);
      } else {
        script = String(script);
      }
    }

    if (script.trim() === '') {
      return null;
    }

    const result = {
      originalScript: script,
      convertedCode: [],
      extractors: [],
      assertions: [],
      variables: [],
      warnings: [],
      hasUnsupportedCode: false
    };

    try {
      const lines = script.split('\n');

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith('//')) continue;

        const converted = this.convertScriptLine(line, 'test');
        if (converted) {
          if (converted.code) {
            result.convertedCode.push(converted.code);
          }
          if (converted.extractor) {
            result.extractors.push(converted.extractor);
          }
          if (converted.assertion) {
            result.assertions.push(converted.assertion);
          }
          if (converted.variables) {
            result.variables.push(...converted.variables);
          }
          if (converted.warning) {
            result.warnings.push(converted.warning);
          }
          if (converted.unsupported) {
            result.hasUnsupportedCode = true;
          }
        }
      }

      return result;
    } catch (error) {
      result.warnings.push(`Failed to parse test script: ${error.message}`);
      result.hasUnsupportedCode = true;
      return result;
    }
  }

  /**
   * Convert a single script line
   */
  convertScriptLine(line, scriptType) {
    // Bruno variable setting: bru.setVar(), bru.setEnvVar()
    if (line.includes('bru.setVar') || line.includes('bru.setEnvVar')) {
      return this.convertBrunoSetVar(line);
    }

    // Bruno variable getting: bru.getVar(), bru.getEnvVar()
    if (line.includes('bru.getVar') || line.includes('bru.getEnvVar')) {
      return this.convertBrunoGetVar(line);
    }

    // Postman variable setting: pm.environment.set(), pm.collectionVariables.set(), pm.globals.set()
    if (line.includes('pm.environment.set') || line.includes('pm.collectionVariables.set') || line.includes('pm.globals.set') || line.includes('pm.variables.set')) {
      return this.convertPostmanSetVar(line);
    }

    // Postman variable getting
    if (line.includes('pm.environment.get') || line.includes('pm.collectionVariables.get') || line.includes('pm.globals.get') || line.includes('pm.variables.get')) {
      return this.convertPostmanGetVar(line);
    }

    // Response body access: res.body, pm.response.json()
    if (scriptType === 'test' && (line.includes('res.body') || line.includes('pm.response.json()'))) {
      return this.convertResponseAccess(line);
    }

    // Assertions: pm.test(), expect(), pm.expect()
    if (scriptType === 'test' && (line.includes('pm.test') || line.includes('expect(') || line.includes('pm.expect'))) {
      return this.convertAssertion(line);
    }

    // Date/Time functions
    if (line.includes('Date.now()') || line.includes('new Date()')) {
      return this.convertDateFunction(line);
    }

    // Math.random()
    if (line.includes('Math.random()')) {
      return { code: line.replace(/const|let|var/, 'const') };
    }

    // Crypto operations
    if (line.includes('crypto') || line.includes('CryptoJS')) {
      return this.convertCryptoOperation(line);
    }

    // Console.log -> load.log
    if (line.includes('console.log')) {
      return {
        code: line.replace(/console\.log\((.*)\)/g, 'load.log($1)')
      };
    }

    // JSON operations
    if (line.includes('JSON.parse') || line.includes('JSON.stringify')) {
      return { code: line };
    }

    // Variable declarations
    if (line.match(/^(const|let|var)\s+\w+\s*=/)) {
      return { code: line };
    }

    // Unsupported or complex code
    return {
      code: `// TODO: Manual conversion needed - ${line}`,
      warning: `Unsupported code pattern: ${line.substring(0, 50)}...`,
      unsupported: true
    };
  }

  /**
   * Convert Bruno setVar
   */
  convertBrunoSetVar(line) {
    // bru.setVar("name", value) -> load.global.name = value
    // bru.setEnvVar("name", value) -> load.global.name = value
    const match = line.match(/bru\.(?:setVar|setEnvVar)\s*\(\s*["']([^"']+)["']\s*,\s*(.+)\s*\)/);
    if (match) {
      const [, varName, value] = match;
      return {
        code: `load.global.${varName} = ${value.replace(/;$/, '')};`,
        variables: [varName]
      };
    }
    return null;
  }

  /**
   * Convert Bruno getVar
   */
  convertBrunoGetVar(line) {
    // bru.getVar("name") -> load.global.name
    // bru.getEnvVar("name") -> load.global.name
    const converted = line.replace(
      /bru\.(?:getVar|getEnvVar)\s*\(\s*["']([^"']+)["']\s*\)/g,
      'load.global.$1'
    );
    return { code: converted };
  }

  /**
   * Convert Postman setVar
   */
  convertPostmanSetVar(line) {
    // pm.environment.set("name", value) -> load.global.name = value
    const match = line.match(/pm\.(?:environment|collectionVariables|globals|variables)\.set\s*\(\s*["']([^"']+)["']\s*,\s*(.+)\s*\)/);
    if (match) {
      const [, varName, value] = match;
      return {
        code: `load.global.${varName} = ${value.replace(/;$/, '')};`,
        variables: [varName]
      };
    }
    return null;
  }

  /**
   * Convert Postman getVar
   */
  convertPostmanGetVar(line) {
    // pm.environment.get("name") -> load.global.name
    const converted = line.replace(
      /pm\.(?:environment|collectionVariables|globals|variables)\.get\s*\(\s*["']([^"']+)["']\s*\)/g,
      'load.global.$1'
    );
    return { code: converted };
  }

  /**
   * Convert response body access
   */
  convertResponseAccess(line) {
    // This needs context of the response variable name
    // For now, add as a comment
    return {
      code: `// TODO: Convert response access - ${line}`,
      warning: 'Response body access requires manual conversion with proper response variable',
      unsupported: true
    };
  }

  /**
   * Convert assertions to extractors and validation
   */
  convertAssertion(line) {
    // pm.test("name", function() { ... })
    if (line.includes('pm.test(')) {
      const match = line.match(/pm\.test\s*\(\s*["']([^"']+)["']/);
      if (match) {
        return {
          code: `// Assertion: ${match[1]}`,
          assertion: match[1],
          warning: 'pm.test assertions need manual conversion to extractors and conditionals'
        };
      }
    }

    // pm.expect(pm.response.code).to.equal(200)
    if (line.includes('pm.response.code') && line.includes('.to.equal')) {
      const match = line.match(/\.to\.equal\s*\(\s*(\d+)\s*\)/);
      if (match) {
        const statusCode = match[1];
        return {
          code: `// TODO: Add status code check\nif (response.status !== ${statusCode}) {\n    load.log("Expected status ${statusCode}, got " + response.status, load.LogLevel.error);\n}`,
          assertion: `status equals ${statusCode}`
        };
      }
    }

    // expect(response).to.have.status(200)
    if (line.includes('expect(') && line.includes('.to.have.status')) {
      const match = line.match(/\.to\.have\.status\s*\(\s*(\d+)\s*\)/);
      if (match) {
        const statusCode = match[1];
        return {
          code: `// TODO: Add status code check\nif (response.status !== ${statusCode}) {\n    load.log("Expected status ${statusCode}, got " + response.status, load.LogLevel.error);\n}`,
          assertion: `status equals ${statusCode}`
        };
      }
    }

    return {
      code: `// TODO: Convert assertion - ${line}`,
      warning: `Complex assertion needs manual conversion: ${line.substring(0, 50)}`,
      unsupported: true
    };
  }

  /**
   * Convert date functions
   */
  convertDateFunction(line) {
    // Date.now() and new Date() are supported in JavaScript
    return { code: line };
  }

  /**
   * Convert crypto operations
   */
  convertCryptoOperation(line) {
    // DevWeb supports Node.js crypto module
    if (line.includes('require(') && line.includes('crypto')) {
      return { code: line }; // Node crypto is available
    }

    // CryptoJS needs to be converted or flagged
    if (line.includes('CryptoJS')) {
      return {
        code: `// TODO: CryptoJS not available in DevWeb - use Node.js crypto module\n// ${line}`,
        warning: 'CryptoJS not supported - convert to Node.js crypto module',
        unsupported: true
      };
    }

    return { code: line };
  }

  /**
   * Generate code from parsed pre-request script
   */
  generatePreRequestCode(parsedScript, indent = 2) {
    if (!parsedScript || parsedScript.convertedCode.length === 0) {
      return '';
    }

    const spaces = '    '.repeat(indent);
    let code = `\n${spaces}// Pre-request Script\n`;

    if (parsedScript.hasUnsupportedCode) {
      code += `${spaces}// ⚠️  WARNING: Some code requires manual conversion\n`;
    }

    parsedScript.convertedCode.forEach(line => {
      code += `${spaces}${line}\n`;
    });

    return code;
  }

  /**
   * Generate code from parsed test script
   */
  generateTestCode(parsedScript, responseVarName, indent = 2) {
    if (!parsedScript || parsedScript.convertedCode.length === 0) {
      return '';
    }

    const spaces = '    '.repeat(indent);
    let code = `\n${spaces}// Post-response Script\n`;

    if (parsedScript.hasUnsupportedCode) {
      code += `${spaces}// ⚠️  WARNING: Some code requires manual conversion\n`;
    }

    parsedScript.convertedCode.forEach(line => {
      // Replace generic "response" with actual variable name
      const replacedLine = line.replace(/\bresponse\b/g, responseVarName);
      code += `${spaces}${replacedLine}\n`;
    });

    return code;
  }

  /**
   * Get all warnings
   */
  getAllWarnings() {
    return this.warnings;
  }

  /**
   * Get report of unsupported features
   */
  getUnsupportedReport() {
    return Array.from(this.unsupportedFeatures);
  }

  /**
   * Clear warnings
   */
  clearWarnings() {
    this.warnings = [];
    this.unsupportedFeatures.clear();
  }
}

module.exports = CustomScriptParser;
