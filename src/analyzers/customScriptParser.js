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
    if (typeof script !== "string") {
      if (Array.isArray(script)) {
        script = script.join("\n");
      } else if (typeof script === "object") {
        // Try to extract script from object structure
        script = script.exec?.join("\n") || JSON.stringify(script);
      } else {
        script = String(script);
      }
    }

    if (script.trim() === "") {
      return null;
    }

    const result = {
      originalScript: script,
      convertedCode: [],
      variables: [],
      warnings: [],
      hasUnsupportedCode: false,
    };

    try {
      const lines = script.split("\n");

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith("//")) continue;

        const converted = this.convertScriptLine(line, "pre-request");
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
      result.warnings.push(
        `Failed to parse pre-request script: ${error.message}`,
      );
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
    if (typeof script !== "string") {
      if (Array.isArray(script)) {
        script = script.join("\n");
      } else if (typeof script === "object") {
        // Try to extract script from object structure
        script = script.exec?.join("\n") || JSON.stringify(script);
      } else {
        script = String(script);
      }
    }

    if (script.trim() === "") {
      return null;
    }

    const result = {
      originalScript: script,
      convertedCode: [],
      extractors: [],
      assertions: [],
      variables: [],
      warnings: [],
      hasUnsupportedCode: false,
    };

    try {
      const lines = script.split("\n");

      for (let line of lines) {
        line = line.trim();
        if (!line || line.startsWith("//")) continue;

        const converted = this.convertScriptLine(line, "test");
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
    if (line.includes("bru.setVar") || line.includes("bru.setEnvVar")) {
      return this.convertBrunoSetVar(line);
    }

    // Bruno variable getting: bru.getVar(), bru.getEnvVar()
    if (line.includes("bru.getVar") || line.includes("bru.getEnvVar")) {
      return this.convertBrunoGetVar(line);
    }

    // Postman variable setting: pm.environment.set(), pm.collectionVariables.set(), pm.globals.set()
    if (
      line.includes("pm.environment.set") ||
      line.includes("pm.collectionVariables.set") ||
      line.includes("pm.globals.set") ||
      line.includes("pm.variables.set")
    ) {
      return this.convertPostmanSetVar(line);
    }

    // Postman variable getting
    if (
      line.includes("pm.environment.get") ||
      line.includes("pm.collectionVariables.get") ||
      line.includes("pm.globals.get") ||
      line.includes("pm.variables.get")
    ) {
      return this.convertPostmanGetVar(line);
    }

    // Response body access: res.body, pm.response.json()
    if (
      scriptType === "test" &&
      (line.includes("res.body") || line.includes("pm.response.json()"))
    ) {
      return this.convertResponseAccess(line);
    }

    // Assertions: pm.test(), expect(), pm.expect()
    if (
      scriptType === "test" &&
      (line.includes("pm.test") ||
        line.includes("expect(") ||
        line.includes("pm.expect"))
    ) {
      return this.convertAssertion(line);
    }

    // Date/Time functions
    if (line.includes("Date.now()") || line.includes("new Date()")) {
      return this.convertDateFunction(line);
    }

    // Math.random()
    if (line.includes("Math.random()")) {
      return { code: line.replace(/const|let|var/, "const") };
    }

    // Crypto operations
    if (line.includes("crypto") || line.includes("CryptoJS")) {
      return this.convertCryptoOperation(line);
    }

    // Console.log -> load.log
    if (line.includes("console.log")) {
      return {
        code: line.replace(/console\.log\((.*)\)/g, "load.log($1)"),
      };
    }

    // JSON operations
    if (line.includes("JSON.parse") || line.includes("JSON.stringify")) {
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
      unsupported: true,
    };
  }

  /**
   * Convert Bruno setVar
   */
  convertBrunoSetVar(line) {
    // bru.setVar("name", value) -> load.global.name = value
    // bru.setEnvVar("name", value) -> load.global.name = value
    const match = line.match(
      /bru\.(?:setVar|setEnvVar)\s*\(\s*["']([^"']+)["']\s*,\s*(.+)\s*\)/,
    );
    if (match) {
      const [, varName, value] = match;
      return {
        code: `load.global.${varName} = ${value.replace(/;$/, "")};`,
        variables: [varName],
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
      "load.global.$1",
    );
    return { code: converted };
  }

  /**
   * Convert Postman setVar
   */
  convertPostmanSetVar(line) {
    // pm.environment.set("name", value) -> load.global.name = value
    const match = line.match(
      /pm\.(?:environment|collectionVariables|globals|variables)\.set\s*\(\s*["']([^"']+)["']\s*,\s*(.+)\s*\)/,
    );
    if (match) {
      const [, varName, value] = match;
      return {
        code: `load.global.${varName} = ${value.replace(/;$/, "")};`,
        variables: [varName],
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
      "load.global.$1",
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
      warning:
        "Response body access requires manual conversion with proper response variable",
      unsupported: true,
    };
  }

  /**
   * Convert assertions to extractors and validation
   */
  convertAssertion(line) {
    // pm.test("name", function() { ... })
    if (line.includes("pm.test(")) {
      const match = line.match(/pm\.test\s*\(\s*["']([^"']+)["']/);
      if (match) {
        return {
          code: `// Assertion: ${match[1]}`,
          assertion: match[1],
          warning:
            "pm.test assertions need manual conversion to extractors and conditionals",
        };
      }
    }

    // pm.expect(pm.response.code).to.equal(200)
    if (line.includes("pm.response.code") && line.includes(".to.equal")) {
      const match = line.match(/\.to\.equal\s*\(\s*(\d+)\s*\)/);
      if (match) {
        const statusCode = match[1];
        return {
          code: `// TODO: Add status code check\nif (response.status !== ${statusCode}) {\n    load.log("Expected status ${statusCode}, got " + response.status, load.LogLevel.error);\n}`,
          assertion: `status equals ${statusCode}`,
        };
      }
    }

    // expect(response).to.have.status(200)
    if (line.includes("expect(") && line.includes(".to.have.status")) {
      const match = line.match(/\.to\.have\.status\s*\(\s*(\d+)\s*\)/);
      if (match) {
        const statusCode = match[1];
        return {
          code: `// TODO: Add status code check\nif (response.status !== ${statusCode}) {\n    load.log("Expected status ${statusCode}, got " + response.status, load.LogLevel.error);\n}`,
          assertion: `status equals ${statusCode}`,
        };
      }
    }

    return {
      code: `// TODO: Convert assertion - ${line}`,
      warning: `Complex assertion needs manual conversion: ${line.substring(0, 50)}`,
      unsupported: true,
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
    if (line.includes("require(") && line.includes("crypto")) {
      return { code: line }; // Node crypto is available
    }

    // CryptoJS needs to be converted or flagged
    if (line.includes("CryptoJS")) {
      return {
        code: `// TODO: CryptoJS not available in DevWeb - use Node.js crypto module\n// ${line}`,
        warning: "CryptoJS not supported - convert to Node.js crypto module",
        unsupported: true,
      };
    }

    return { code: line };
  }

  /**
   * Generate code from parsed pre-request script
   */
  generatePreRequestCode(parsedScript, indent = 2) {
    if (!parsedScript || parsedScript.convertedCode.length === 0) {
      return "";
    }

    const spaces = "    ".repeat(indent);
    let code = `\n${spaces}// Pre-request Script\n`;

    if (parsedScript.hasUnsupportedCode) {
      code += `${spaces}// ⚠️  WARNING: Some code requires manual conversion\n`;
    }

    parsedScript.convertedCode.forEach((line) => {
      code += `${spaces}${line}\n`;
    });

    return code;
  }

  /**
   * Generate code from parsed test script
   */
  generateTestCode(parsedScript, responseVarName, indent = 2) {
    if (!parsedScript || parsedScript.convertedCode.length === 0) {
      return "";
    }

    const spaces = "    ".repeat(indent);
    let code = `\n${spaces}// Post-response Script\n`;

    if (parsedScript.hasUnsupportedCode) {
      code += `${spaces}// ⚠️  WARNING: Some code requires manual conversion\n`;
    }

    parsedScript.convertedCode.forEach((line) => {
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

  /**
   * Detect DPoP (Demonstrating Proof-of-Possession) token generation patterns.
   * DPoP uses EC P-256 keys and jose library for JWT signing with specific claims.
   *
   * @param {string} script - Raw script text
   * @returns {{ isDpop: boolean, outputVars: string[], keyVar: string }}
   */
  static detectDpopUsage(script) {
    if (!script || typeof script !== "string") {
      return { isDpop: false, outputVars: [], keyVar: null };
    }

    // DPoP detection patterns
    const isDpop =
      /dpop|DPoP/i.test(script) &&
      (/jose|ES256|generateKeyPair|SignJWT/i.test(script) ||
        /typ\s*:\s*['"]dpop\+jwt['"]/i.test(script));

    if (!isDpop) return { isDpop: false, outputVars: [], keyVar: null };

    // Extract output variables (dpop_proof, dpop_result, etc.)
    const setPattern =
      /(?:pm\.(?:environment|globals|collectionVariables|variables)\.set|postman\.(?:setEnvironmentVariable|setGlobalVariable)|bru\.(?:setVar|setEnvVar))\s*\(\s*['"]([^'"]+)['"]/g;
    const outputVars = [];
    let m;
    while ((m = setPattern.exec(script)) !== null) {
      outputVars.push(m[1]);
    }

    // Extract JWK variable (dpop_jwk)
    const jwkPattern =
      /(?:pm\.(?:environment|globals|collectionVariables|variables)\.get|postman\.(?:getEnvironmentVariable|getGlobalVariable)|bru\.(?:getVar|getEnvVar))\s*\(\s*['"]([^'"]*jwk[^'"]*)['"]\s*\)/gi;
    let keyVar = null;
    while ((m = jwkPattern.exec(script)) !== null) {
      keyVar = m[1];
      break; // Use first match
    }

    return { isDpop: true, outputVars, keyVar: keyVar || "dpop_jwk" };
  }

  /**
   * Scan a script string (pre-request or test) for JWT generation patterns.
   * Used by generators to decide whether to add jwt-helper.js (DevWeb) or
   * lre-utils.dat (VuGen) to the script's extra files and emit the
   * appropriate boilerplate.
   *
   * @param  {string} script - Raw script text
   * @returns {{ isJwt: boolean, library: string, outputVars: string[], algorithm: string }}
   *
   * Detected libraries:
   *   jsrsasign  — KJUR.jws.JWS.sign() / require('jsrsasign') / eval(jsrsasign)
   *   jsonwebtoken — require('jsonwebtoken') + sign()
   *   jose       — require('jose')
   *   crypto     — Node.js built-in sign via crypto (manual JWT)
   */
  static detectJwtUsage(script) {
    if (!script || typeof script !== "string") {
      return {
        isJwt: false,
        library: null,
        outputVars: [],
        algorithm: "RS256",
      };
    }

    // ── Library fingerprints ────────────────────────────────────────────────
    const isJsrsasign = /jsrsasign|KJUR\.jws\.JWS\.sign\s*\(|kjur/i.test(
      script,
    );
    const isJsonwebtoken =
      /require\s*\(\s*['"]jsonwebtoken['"]\s*\)/.test(script) &&
      /\.sign\s*\(/.test(script);
    const isJose = /require\s*\(\s*['"]jose['"]\s*\)/.test(script);
    const isManualCrypto =
      /crypto\.sign\s*\(|createSign\s*\(/.test(script) &&
      /base64url|header\.payload/.test(script);

    // ── Java / Groovy JWT patterns (JSR223 / BeanShell in JMeter) ────────────

    // JJWT (io.jsonwebtoken) — Jwts.builder()...signWith(...).compact()
    const isJjwt =
      /import\s+io\.jsonwebtoken/.test(script) ||
      /Jwts\.builder\s*\(/.test(script) ||
      (/\.signWith\s*\(/.test(script) && /\.compact\s*\(/.test(script));

    // nimbus-jose-jwt (com.nimbusds) — most popular Java JWT lib
    const isNimbus =
      /import\s+com\.nimbusds\.(?:jose|jwt)/.test(script) ||
      /new\s+JWTClaimsSet\.Builder\s*\(/.test(script) ||
      /new\s+SignedJWT\s*\(/.test(script) ||
      /RSASSASigner|ECDSASigner|MACSigner/.test(script) ||
      /JWSHeader(?:\.Builder)?\s*\(/.test(script) ||
      /signedJWT\.(?:serialize|sign)\s*\(/.test(script);

    // Auth0 java-jwt — JWT.create().sign(Algorithm.*)
    const isAuth0 =
      /import\s+com\.auth0\.jwt/.test(script) ||
      /JWT\.create\s*\(/.test(script) ||
      /Algorithm\.(?:RSA|HMAC|ECDSA)\d+/.test(script);

    // BouncyCastle — org.bouncycastle (often combined with nimbus or manual)
    const isBouncyCastle =
      /import\s+org\.bouncycastle/.test(script) ||
      /PEMParser|JcaPEMKeyConverter/.test(script);

    // Manual Java RSA signing via JCA (Signature.getInstance + SHA256withRSA/PS256)
    const isJavaRsa =
      /Signature\.getInstance\s*\(\s*["'](?:SHA256withRSA|SHA256withRSAandMGF1|SHA384withRSA|SHA512withRSA|SHA256withECDSA)["']/.test(
        script,
      );

    // Manual Java HMAC-SHA signing
    const isJavaHmac =
      /Mac\.getInstance\s*\(\s*["']Hmac(?:SHA256|SHA384|SHA512)["']/.test(
        script,
      );

    // PEM key loading — strong corroborating signal that JWT signing is happening
    const hasPemInScript =
      /-----BEGIN\s+(?:RSA\s+)?(?:EC\s+)?PRIVATE\s+KEY-----/.test(script) ||
      /PKCS8EncodedKeySpec/.test(script) ||
      /KeyFactory\.getInstance\s*\(\s*["'](?:RSA|EC)["']/.test(script);

    // JWT claim keywords — weak signal, only used as corroboration
    const jwtClaimCount = [
      /"iss"/,
      /"sub"/,
      /"aud"/,
      /"exp"/,
      /"iat"/,
      /"jti"/,
    ].filter((p) => p.test(script)).length;
    const hasJwtClaims = jwtClaimCount >= 3;

    // Manual Java JWT assembly: Base64 URL-encode header.payload then sign
    const isJavaManual =
      (/Base64\.getUrlEncoder/.test(script) && /\.sign\s*\(/.test(script)) ||
      (hasPemInScript && hasJwtClaims) ||
      (hasPemInScript && /\.sign\s*\(/.test(script));

    const isJavaJwt =
      isJjwt ||
      isNimbus ||
      isAuth0 ||
      isBouncyCastle ||
      isJavaRsa ||
      isJavaHmac ||
      isJavaManual;

    const isJwt =
      isJsrsasign || isJsonwebtoken || isJose || isManualCrypto || isJavaJwt;
    if (!isJwt)
      return {
        isJwt: false,
        library: null,
        outputVars: [],
        algorithm: "RS256",
      };

    // ── Determine library ───────────────────────────────────────────────────
    let library = "unknown";
    if (isJsrsasign) library = "jsrsasign";
    else if (isJsonwebtoken) library = "jsonwebtoken";
    else if (isJose) library = "jose";
    else if (isManualCrypto) library = "crypto";
    else if (isNimbus) library = "nimbus-jose-jwt";
    else if (isAuth0) library = "auth0-java-jwt";
    else if (isJjwt) library = "jjwt";
    else if (isBouncyCastle) library = "bouncycastle";
    else if (isJavaRsa || isJavaHmac || isJavaManual) library = "java-manual";

    // ── Extract algorithm — JS and Java/Groovy patterns ─────────────────────
    const algMatch =
      // JS: alg: "PS256" or algorithm: "RS256"
      script.match(/['"]alg['"]\s*:\s*['"]([A-Z0-9]+)['"]/i) ||
      script.match(/algorithm\s*[:=]\s*['"]([A-Z0-9]+)['"]/i) ||
      // JJWT: SignatureAlgorithm.RS256 / .PS256 / .HS256 / Algorithms.RS256
      script.match(/(?:SignatureAlgorithm|Algorithms)\.([A-Z][A-Z0-9]+)/) ||
      // nimbus JWSAlgorithm.RS256
      script.match(/JWSAlgorithm\.([A-Z][A-Z0-9]+)/) ||
      // Auth0: Algorithm.RSA256(...) / Algorithm.HMAC256(...)
      script.match(/Algorithm\.([A-Z]+\d+)\s*\(/) ||
      // Java getInstance: "SHA256withRSAandMGF1" → PS256, "SHA256withRSA" → RS256, etc.
      script.match(
        /getInstance\s*\(\s*["'](SHA\d+with(?:RSAandMGF1|RSA|ECDSA)|Hmac(?:SHA\d+))["']/i,
      );

    let algorithm = "RS256";
    if (algMatch) {
      const raw = algMatch[1].toUpperCase();
      // Map Java/Auth0 algorithm names to JWT alg identifiers
      const javaAlgMap = {
        SHA256WITHRSA: "RS256",
        SHA384WITHRSA: "RS384",
        SHA512WITHRSA: "RS512",
        SHA256WITHRSAANDMGF1: "PS256",
        SHA384WITHRSAANDMGF1: "PS384",
        SHA512WITHRSAANDMGF1: "PS512",
        SHA256WITHECDSA: "ES256",
        SHA384WITHECDSA: "ES384",
        SHA512WITHECDSA: "ES512",
        HMACSHA256: "HS256",
        HMACSHA384: "HS384",
        HMACSHA512: "HS512",
        // Auth0 naming
        RSA256: "RS256",
        RSA384: "RS384",
        RSA512: "RS512",
        HMAC256: "HS256",
        HMAC384: "HS384",
        HMAC512: "HS512",
        ECDSA256: "ES256",
        ECDSA384: "ES384",
        ECDSA512: "ES512",
      };
      algorithm = javaAlgMap[raw] || raw;
    }

    // ── Extract output variable names (variables set after JWT is generated) ─
    const setPattern =
      /(?:pm\.environment|pm\.globals|pm\.collectionVariables|pm\.variables)\.set\s*\(\s*['"]([^'"]+)['"]/g;
    const bruPattern =
      /bru\.(?:setVar|setEnvVar|setEnv|setGlobalVar)\s*\(\s*['"]([^'"]+)['"]/g;
    const postmanPattern =
      /postman\.(?:setEnvironmentVariable|setGlobalVariable)\s*\(\s*['"]([^'"]+)['"]/g;
    // JMeter Groovy/BeanShell: vars.put / vars.putObject / vars.putEncoded / props.put
    const varsPattern =
      /(?:vars|props)\.put(?:Object|Encoded)?\s*\(\s*["']([^"']+)["']/g;
    // JMeter context.set() (some Groovy scripts use SampleContext)
    const ctxPattern = /context\.set\s*\(\s*["']([^"']+)["']/g;
    const outputVars = [];
    let m;
    while ((m = setPattern.exec(script)) !== null) outputVars.push(m[1]);
    while ((m = bruPattern.exec(script)) !== null) outputVars.push(m[1]);
    while ((m = postmanPattern.exec(script)) !== null) outputVars.push(m[1]);
    while ((m = varsPattern.exec(script)) !== null) outputVars.push(m[1]);
    while ((m = ctxPattern.exec(script)) !== null) outputVars.push(m[1]);

    return { isJwt: true, library, outputVars, algorithm };
  }

  /**
   * Extract JWT claim-to-parameter mappings from a pre-request script.
   * Scans object literals (header / payload) for getter calls and maps each
   * JWT claim name to the environment parameter name the user chose.
   *
   * Supported getter patterns:
   *   pm.environment.get('param')   /  pm.globals.get('param')
   *   pm.collectionVariables.get('param')  /  pm.variables.get('param')
   *   postman.getEnvironmentVariable('param')  /  postman.getGlobalVariable('param')
   *   bru.getVar('param')  /  bru.getEnvVar('param')
   *
   * Also detects the private-key variable (assigned to a var later passed to .sign())
   * and the output variable (pm.environment.set / postman.setEnvironmentVariable).
   *
   * @param {string} script - Raw pre-request script text
   * @returns {Object|null} Map like { kid:'signing_kid', iss:'client_id', aud:'aud', secret:'secret', output:'jwt_token' } or null
   */
  static extractJwtClaimMap(script) {
    if (!script || typeof script !== "string") return null;

    // Regex that captures: "claim" : getter("paramName")  or  claim : getter('paramName')
    // Covers all Postman / Bruno / old-Postman getter APIs
    const GETTER =
      "(?:" +
      [
        "pm\\.(?:environment|globals|collectionVariables|variables)\\.get",
        "postman\\.(?:getEnvironmentVariable|getGlobalVariable)",
        "bru\\.(?:getVar|getEnvVar)",
      ].join("|") +
      ")\\s*\\(\\s*['\"]([^'\"]+)['\"]\\s*\\)";

    // Pattern: "claimName" : getter("paramName")  — with optional quotes on claim key.
    // [\w-]+ (not just \w+) so hyphenated custom claims like "openbanking-intent-id"
    // are recognized here too, not just in the literal-value pass below.
    //
    // Two negative lookbehinds guard the match start:
    //  - (?<![\w-]) forbids starting mid-identifier. Without it, a plain
    //    negative lookbehind for "var/let/const " can be defeated by the regex
    //    engine simply trying the next start position one character later
    //    (e.g. "var prvKey = x" failing to match at "prvKey" but still
    //    matching at "rvKey", since "ar p" doesn't end in "var ").
    //  - (?<!(?:var|let|const)\s+) excludes `var prvKey = getter("secret")`
    //    style KEY-VARIABLE declarations, which keyAssignRe below already
    //    handles as the signing secret. Without this, a declaration like
    //    `var prvKey = postman.getEnvironmentVariable("secret")` was ALSO
    //    matching here as if "prvKey" were a JWT claim, landing in
    //    extraClaims.prvKey — which getJwtTokenFromMap() would then inject
    //    into the JWT PAYLOAD as a visible claim holding the raw private key
    //    value. Property-assignment claims like `data.iss = getter(...)`
    //    still match fine, since "." isn't a word/hyphen character.
    const claimRe = new RegExp(
      "(?<![\\w-])(?<!(?:var|let|const)\\s+)[\"']?([\\w-]+)[\"']?\\s*[:=]\\s*" +
        GETTER,
      "g",
    );

    const map = {};
    let m;
    while ((m = claimRe.exec(script)) !== null) {
      const claim = m[1]; // e.g. kid, iss, sub, aud, scope
      const param = m[2]; // e.g. signing_kid, client_id, aud
      // Map standard JWT claims to their param names
      if (
        /^(kid|typ|alg|iss|sub|aud|scope|iat|exp|jti|nbf|nonce)$/i.test(claim)
      ) {
        map[claim.toLowerCase()] = param;
      } else {
        // Non-standard claim (e.g, software_statement, token_endpoint_auth_method)
        // Store in extraClaims map: clasimName → paramName
        if (!map.extraClaims) map.extraClaims = {};
        map.extraClaims[claim] = param;
      }
    }

    // Detect private key: var/let/const <name> = getter("paramName")
    // where <name> is later used in .sign() or createSign()
    const keyAssignRe = new RegExp(
      "(?:var|let|const)\\s+(\\w+)\\s*=\\s*" + GETTER,
      "g",
    );
    while ((m = keyAssignRe.exec(script)) !== null) {
      const varName = m[1]; // e.g. prvKey, privateKey, secret
      const paramName = m[2]; // e.g. secret, private_key
      // Heuristic: variable suggests a key, or it's used in .sign()
      if (
        /key|secret|prv|private|pem|cert|signing/i.test(varName) ||
        new RegExp(varName + "\\s*\\)").test(script)
      ) {
        map.secret = paramName;
      }
    }

    // Detect exp offset: Math.round(N + Date.now()/1000) or Math.round(Date.now()/1000) + N
    const expOffsetMatch =
      script.match(/Math\.round\s*\(\s*(\d+)\s*\+\s*Date\.now()/) ||
      script.match(
        /Math\.round\s*\(\s*Date\.now\(\s*\)\s*[^)]*\)\s*\+\s*(\d+)/,
      ) ||
      script.match(/Date\.now\s*\(\s*\)\s*\/\s*1000\s*\+\s*(\d+)/) ||
      script.match(/\+\s*(\d+)\s*[,;]\s*\/\/.*exp/);
    if (expOffsetMatch) {
      const offset = parseInt(expOffsetMatch[1], 10);
      if (offset > 0 && offset < 86400) map.expOffset = offset; // sanity: 1s-24h
    }

    // Detect output variable: pm.environment.set('jwt_token', ...) / postman.setEnvironmentVariable('jwt_token', ...)
    // Take the FIRST match, not the last. A pre-request script commonly signs the
    // JWT first and stores it, then goes on to set OTHER, unrelated variables
    // afterward (e.g. a DPoP proof placeholder, a nonce, a correlation seed) — the
    // LAST .set() call in the script is not reliably "the JWT output". Taking the
    // last one previously caused the JWT to be stored under a completely wrong
    // variable name whenever a script combined JWT signing with any other .set()
    // call later on (observed: a JWT+DPoP script stored the JWT as "dpop_proof"
    // instead of "client_assertion", leaving the real "client_assertion" reference
    // in the request body permanently undefined). First-wins also matches
    // detectJwtUsage()'s outputVars, which scriptGenerator.js's `_primaryOut`
    // already treats as "first non-library match wins".
    const setRe =
      /(?:pm\.(?:environment|globals|collectionVariables|variables)\.set|postman\.(?:setEnvironmentVariable|setGlobalVariable)|bru\.(?:setVar|setEnvVar))\s*\(\s*['"]([^'"]+)['"]/g;
    const setMatch = setRe.exec(script);
    if (setMatch) {
      map.output = setMatch[1];
    }

    // ── Literal-valued + templated claims (Postman/Bruno JS) ────────────────────
    // The getter-based pass above only ever matches `claim: getter("param")` —
    // a claim whose value is a plain literal (e.g. "login_hint_token": "loginhinttoken")
    // or a concatenation ("aud": "https://" + getter("host") + "/path") never matches
    // that pattern at all, so it was silently dropped entirely, not just miscategorized.
    // Scoped to the actual header/payload object literal(s), not the whole script —
    // a literal-value regex run unscoped would risk matching unrelated key/value pairs
    // anywhere else in the script.
    for (const [, body] of findJwtPayloadObjectLiterals(script)) {
      // Literal values: "claim": "value" | 'claim': 'value' | claim: 123 | claim: true
      // The trailing part is a LOOKAHEAD (doesn't consume), requiring a comma,
      // closing brace, or end-of-string after any whitespace — critically, NOT
      // just "the next character is a newline". A naive `\s*(?:,|\n|\})` would
      // still match a value that's actually one piece of a multi-line
      // concatenation (e.g. "aud": "https://"\n + getter("host") + "/path"),
      // because `\s*` backtracks down to consuming zero characters and matches
      // on the newline itself, right before the real `+` continuation. The
      // lookahead can't take that shortcut — it has to find [,}]/end-of-string
      // genuinely after ALL the whitespace, so a "+" anywhere in that gap
      // correctly fails the match instead of silently truncating the value.
      const literalRe =
        /["']?([\w-]+)["']?\s*:\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|(-?\d+(?:\.\d+)?)|(true|false))(?=\s*[,}]|\s*$)/g;
      let lm;
      while ((lm = literalRe.exec(body)) !== null) {
        const claim = lm[1];
        const claimLower = claim.toLowerCase();
        const value = lm[2] !== undefined ? lm[2] : lm[3] !== undefined ? lm[3] : lm[4] !== undefined ? lm[4] : lm[5];
        // typ/alg are special: unlike iss/sub/aud/scope/kid/secret (which
        // getJwtToken()/getJwtTokenFromMap() always treat as a PARAM NAME to
        // resolve via resolve()), the runtime already consumes cm.alg as the
        // literal algorithm string directly (see jwt-helper.js's
        // `const alg = cm.alg || "PS256"` — never passed through resolve()).
        // So a literal "alg"/"typ" in the script merges straight into the
        // same top-level field the getter-sourced path would have used.
        // Other standard claims found as literals here are intentionally
        // NOT captured — treating a literal iss/sub/aud/scope value as if it
        // were a param NAME via resolve() would silently resolve to "",
        // which is worse than not extracting it at all. Not part of any
        // reported scenario, so left as a known gap rather than risking that.
        if (claimLower === "typ" || claimLower === "alg") {
          if (map[claimLower] !== undefined) continue; // getter-sourced value already won
          map[claimLower] = value;
        } else if (!/^(kid|iss|sub|aud|scope|iat|exp|jti|nbf|nonce)$/i.test(claim)) {
          if (map.extraClaims && map.extraClaims[claim] !== undefined) continue; // getter-sourced value already won
          if (!map.literalClaims) map.literalClaims = {};
          map.literalClaims[claim] = value;
        }
      }

      // Templated "aud" specifically: literal + ONE getter call + literal, e.g.
      // "aud": "https://" + postman.getEnvironmentVariable("iam-host") + "/as/token.oauth2".
      // Reuses the EXISTING _audTemplate mechanism already built (and already tested) for
      // the JMeter/Java extraction path below — both generators already know how to turn
      // `map._audTemplate` + `map.aud = "_jwt_aud"` into working code, so this only needs
      // to populate the same two fields, not add any new downstream codegen.
      if (map.aud === undefined && !map._audTemplate) {
        // Same lookahead-terminator fix as the literal-value regex above — a
        // multi-line concatenation must not be truncated at its first newline.
        const audConcatRe = new RegExp("[\"']?aud[\"']?\\s*:\\s*([\\s\\S]+?)(?=\\s*[,}]|\\s*$)", "i");
        const audMatch = body.match(audConcatRe);
        if (audMatch && audMatch[1].includes("+")) {
          const template = buildConcatTemplate(audMatch[1], GETTER);
          if (template && template.includes("{")) {
            map._audTemplate = template;
            map.aud = "_jwt_aud";
          }
        }
      }
    }

    // ── Java / Groovy JMX patterns (JSR223 / BeanShell) ─────────────────────────
    // Step 1: Build Java local-var → LR-param-name map from vars.get() / context.getVariable()
    const javaVarToParam = {};
    const javaVarsGetRe =
      /\b(?:String|int|long|Object|def|var)\s+(\w+)\s*=\s*(?:vars|context)\.(?:get|getVariable)\s*\(\s*["']([^"']+)["']\s*\)/g;
    let jvg;
    while ((jvg = javaVarsGetRe.exec(script)) !== null) {
      javaVarToParam[jvg[1]] = jvg[2]; // e.g. clientID → 'client_id'
    }

    if (Object.keys(javaVarToParam).length > 0) {
      // Step 2: Build intermediate string-var map (string-concatenation assignments)
      const stringVarMap = {}; // varName → resolved LR template string  e.g. url → 'host-{iam_env}.com'

      function buildLRTemplate(expr) {
        const pieces = expr.split(/\s*\+\s*/);
        let result = "";
        for (const piece of pieces) {
          const p = piece.trim();
          if (/^["'].*["']$/.test(p)) {
            result += p.slice(1, -1); // string literal — strip quotes
          } else if (stringVarMap[p] !== undefined) {
            result += stringVarMap[p]; // already-resolved intermediate var
          } else if (javaVarToParam[p]) {
            result += "{" + javaVarToParam[p] + "}"; // LR param placeholder
          }
          // else: unresolvable expression piece — omit
        }
        return result;
      }

      const strVarRe = /\b(?:String|var)\s+(\w+)\s*=\s*([^;{}]+?)\s*;/g;
      let svm;
      while ((svm = strVarRe.exec(script)) !== null) {
        const varName = svm[1];
        if (javaVarToParam[varName]) continue; // already a vars.get() param
        const expr = svm[2].trim();
        if (expr.includes("+") || /^["']/.test(expr)) {
          const resolved = buildLRTemplate(expr);
          if (resolved) stringVarMap[varName] = resolved;
        }
      }

      // Step 3: Extract claims from attributes.put("claim", expr)
      const attribRe =
        /attributes\.put\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+?)\s*\)/g;
      let apr;
      while ((apr = attribRe.exec(script)) !== null) {
        const claim = apr[1].toLowerCase();
        const expr = apr[2].trim();
        if (!/^(iss|sub|aud|scope|jti)$/i.test(claim)) continue;
        if (claim === "aud") {
          // Audience may be dynamically built — resolve to LR template
          const template = buildLRTemplate(expr);
          if (template && template.includes("{")) {
            // Dynamic — store template; _jwt_aud param will be pre-built before createJWT()
            map._audTemplate = template;
            map.aud = "_jwt_aud";
          } else if (javaVarToParam[expr]) {
            map.aud = javaVarToParam[expr];
          }
        } else if (javaVarToParam[expr]) {
          map[claim] = javaVarToParam[expr];
        }
      }

      // Step 4: kid from .keyID(javaVar) or .withKeyId(javaVar)
      const kidMatch = script.match(/\.(?:keyID|withKeyId)\s*\(\s*(\w+)\s*\)/);
      if (kidMatch && javaVarToParam[kidMatch[1]]) {
        map.kid = javaVarToParam[kidMatch[1]];
      }

      // Step 5: Output var from vars.put("varName", ...) — only token-like names
      const varsPutRe = /vars\.put\s*\(\s*["']([^"']+)["']\s*,/g;
      let vpo;
      while ((vpo = varsPutRe.exec(script)) !== null) {
        const vName = vpo[1];
        if (/[Tt]oken|jwt|JWT|[Cc]red/.test(vName)) {
          map.output = vName;
          break;
        }
      }
    }
    // ── End Java / Groovy patterns ───────────────────────────────────────────────

    return Object.keys(map).length > 0 ? map : null;
  }

  /**
   * Detect per-request dynamically generated variables in a pre-request script.
   * These are variables created fresh on EVERY request — NOT from response correlation
   * and NOT static parameters. They need inline generation before each request.
   *
   * Common patterns:
   *   pm.variables.set('interaction_id', crypto.randomUUID())
   *   pm.variables.set('xsrfToken', crypto.randomUUID())
   *   pm.variables.set('nonce', Math.random().toString(36).substring(2))
   *   pm.variables.set('requestId', Date.now().toString())
   *
   * @param  {string} script - Pre-request script text
   * @returns {Array<{varName: string, generationType: 'uuid'|'random'|'timestamp'|'nonce'}>}
   *
   * generationType values:
   *   'uuid'      → crypto.randomUUID()  — emit crypto.randomUUID() in DevWeb, lr_param_sprintf in VuGen
   *   'random'    → Math.random()        — emit Math.random().toString(36) in DevWeb
   *   'timestamp' → Date.now()           — emit Date.now().toString() in DevWeb
   *   'nonce'     → CryptoJS/custom      — emit crypto.randomBytes(16).toString('hex') in DevWeb
   */
  /**
   * Header names that indicate a CSRF / anti-forgery token.
   * Matches the CSRF_HEADER_NAMES set from VuGen Script Studio.
   */
  static isCsrfHeaderName(headerKey) {
    if (!headerKey) return false;
    const k = headerKey.toLowerCase();
    const KNOWN = new Set([
      "x-csrf-token",
      "x-xsrf-token",
      "x-csrftoken",
      "csrf-token",
      "x-xsrf-header",
      "x-csrf-header",
      "x-anti-forgery-token",
      "x-request-verification-token",
      "__requestverificationtoken",
      "x-antiforgery",
      "requestverificationtoken",
    ]);
    if (KNOWN.has(k)) return true;
    return /csrf|xsrf|antiforg|request.?verif/i.test(k);
  }

  static detectPerRequestDynamicVars(script) {
    if (!script || typeof script !== "string") return [];

    const results = [];

    // Pattern: pm.variables.set('varName', <generationExpression>)
    // Also: pm.environment.set / pm.globals.set / bru.setVar with dynamic RHS
    const setPattern =
      /pm\.(?:variables|environment|globals|collectionVariables)\.set\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g;
    const bruPattern =
      /bru\.(?:setVar|setEnvVar)\s*\(\s*['"]([^'"]+)['"]\s*,\s*([^)]+)\)/g;

    const classify = (varName, rhs) => {
      const r = rhs.trim();

      // UUID generation patterns — gen_uuid() in VuGen, crypto.randomUUID() in DevWeb
      if (
        /crypto\.randomUUID\s*\(|uuidv4\s*\(|uuid\s*\(|generateUUID\s*\(/i.test(
          r,
        )
      ) {
        return { varName, generationType: "uuid" };
      }

      // CSRF / hex token patterns — gen_csrf_token() in VuGen, randomBytes in DevWeb
      if (/crypto\.randomBytes\s*\(|randomBytes\s*\(/.test(r)) {
        return { varName, generationType: "hex32" };
      }
      if (/CryptoJS\.lib\.WordArray\.random|CryptoJS\.enc\./i.test(r)) {
        return { varName, generationType: "csrf" }; // CryptoJS random → CSRF token
      }

      // High-entropy hex (64+ chars) — gen_hex64() in VuGen
      if (
        /\.toString\s*\(\s*16\s*\)|\.toString\s*\(\s*'hex'\s*\)|hex.*random|random.*hex/i.test(
          r,
        )
      ) {
        return { varName, generationType: "hex64" };
      }

      // Math.random() based — gen_uuid() in VuGen (best match), crypto.randomUUID in DevWeb
      if (
        /Math\.random\s*\(/.test(r) &&
        !r.includes("pm.") &&
        !r.includes("load.")
      ) {
        return { varName, generationType: "random" };
      }

      // Timestamp based
      if (
        /Date\.now\s*\(|new Date\s*\(/.test(r) &&
        !r.includes("pm.") &&
        !r.includes("load.")
      ) {
        return { varName, generationType: "timestamp" };
      }

      return null;
    };

    let m;
    while ((m = setPattern.exec(script)) !== null) {
      const result = classify(m[1], m[2]);
      if (result) results.push(result);
    }
    while ((m = bruPattern.exec(script)) !== null) {
      const result = classify(m[1], m[2]);
      if (result) results.push(result);
    }

    return results;
  }
}

// ── Private helpers for extractJwtClaimMap's literal/templated-claim support ──
// (module-level, not static class methods — internal only, not part of the
// public API other generators call)

/**
 * Finds `var/let/const <name> = { ... };` object-literal blocks in a script
 * via balanced-brace scanning (string-aware, so a `{`/`}` inside a quoted
 * value doesn't throw off the depth count), and returns the ones that look
 * like they hold a JWT header or payload — either because the script itself
 * passes that variable to JSON.stringify(), or because the variable name
 * matches a common convention (header/payload/data/claims/...). Deliberately
 * NOT a full JS parser — good enough for the hand-written pre-request scripts
 * these come from, and scoping to just these blocks (rather than the whole
 * script) is what makes the new literal-value regex below safe to add without
 * risking a false match somewhere unrelated in the script.
 *
 * @returns {Array<[string, string]>} [varName, blockTextIncludingBraces][]
 */
function findJwtPayloadObjectLiterals(script) {
  const blocks = []; // [varName, startIndex, endIndex]
  const declRe = /\b(?:var|let|const)\s+(\w+)\s*=\s*\{/g;
  let dm;
  while ((dm = declRe.exec(script)) !== null) {
    const varName = dm[1];
    const braceStart = script.indexOf("{", dm.index);
    if (braceStart === -1) continue;
    let depth = 0;
    let inString = null; // null | '"' | "'"
    let end = -1;
    for (let i = braceStart; i < script.length; i++) {
      const ch = script[i];
      if (inString) {
        if (ch === "\\") i++; // skip escaped char
        else if (ch === inString) inString = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inString = ch;
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
        if (depth === 0) {
          end = i + 1;
          break;
        }
      }
    }
    if (end !== -1) blocks.push([varName, braceStart, end]);
  }

  const likelyNameRe = /^(header|payload|data|claims|claimspayload|jwtpayload|jwtheader|jwtclaims|jwtbody)$/i;
  const result = [];
  for (const [varName, start, end] of blocks) {
    const stringified = new RegExp("JSON\\.stringify\\s*\\(\\s*" + varName + "\\s*\\)").test(script);
    if (stringified || likelyNameRe.test(varName)) {
      result.push([varName, script.slice(start, end)]);
    }
  }
  return result;
}

/**
 * Turns a string-concatenation expression (e.g. `"https://" + postman.getEnvironmentVariable("host") + "/path"`)
 * into an LR-style template string (`"https://{host}/path"`), reusing the exact
 * template syntax the JMeter/Java extraction path already produces via its own
 * buildLRTemplate() — both generators already know how to turn this shape into
 * working DevWeb/VuGen code for `_audTemplate`, so producing the same shape
 * here means zero new downstream codegen is needed.
 *
 * Unlike the Java-path version, this deliberately returns null (bail out
 * entirely) if ANY piece of the expression can't be resolved — silently
 * dropping a piece of e.g. an audience URL would produce a subtly wrong but
 * plausible-looking value, which is worse than not extracting it at all.
 *
 * @param {string} expr - the full `"lit" + getter("x") + "lit"` expression text
 * @param {string} getterPattern - the GETTER regex fragment from extractJwtClaimMap
 * @returns {string|null}
 */
function buildConcatTemplate(expr, getterPattern) {
  const getterRe = new RegExp("^" + getterPattern + "$");
  const pieces = expr.split(/\s*\+\s*/);
  let result = "";
  for (const raw of pieces) {
    const piece = raw.trim();
    const strLit = piece.match(/^["'](.*)["']$/);
    if (strLit) {
      result += strLit[1];
      continue;
    }
    const getterMatch = piece.match(getterRe);
    if (getterMatch) {
      result += "{" + getterMatch[1] + "}";
      continue;
    }
    return null; // unresolvable piece — bail rather than silently drop it
  }
  return result;
}

module.exports = CustomScriptParser;
