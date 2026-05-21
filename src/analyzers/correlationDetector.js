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
  /**
   * Extract the post-response (test) script from a request.
   * Handles all storage formats across Postman, Bruno JSON, and Bruno YAML:
   *   - request.testScript           (pre-normalized string)
   *   - request.tests[]              (brunoParser normalized — listen:'test')
   *   - request.event[]              (Postman raw — listen:'test')
   *   - script.exec as Array         (standard Postman)
   *   - script.exec as string        (some Bruno exports)
   *   - script as plain string       (legacy)
   */
  extractTestScript(request) {
    if (request.testScript) return request.testScript;

    // Helper: extract script text from an events array
    const fromEvents = (events) => {
      if (!Array.isArray(events)) return null;
      const ev = events.find(e => e.listen === 'test' || e.listen === 'post-response');
      if (!ev) return null;
      const s = ev.script;
      if (!s) return null;
      if (s.exec) return Array.isArray(s.exec) ? s.exec.join('\n') : String(s.exec);
      if (typeof s === 'string') return s;
      return null;
    };

    // 1. brunoParser normalized requests store events in req.tests[]
    const t = fromEvents(request.tests);
    if (t) return t;

    // 2. Postman raw format stores events in req.event[]
    const e = fromEvents(request.event);
    if (e) return e;

    // 3. Bruno JSON export format: post-response script in request.script.res
    if (request.script?.res) {
      const s = request.script.res;
      return typeof s === 'string' ? s : (Array.isArray(s) ? s.join('\n') : null);
    }

    if (typeof request.tests === 'string') return request.tests;
    return null;
  }

  /**
   * Extract variable assignments from test/post-response script.
   *
   * Supports both Postman and Bruno runtime APIs:
   *
   *  Postman:  pm.environment.set(), pm.globals.set(), pm.collectionVariables.set(),
   *            pm.variables.set(), context.set()
   *
   *  Bruno:    bru.setEnv()     ← PRIMARY env setter in Bruno
   *            bru.setEnvVar()  ← alias
   *            bru.setVar()     ← collection-scoped variable
   *            env.set()        ← Bruno 1.x legacy API
   *            vars.set()       ← Bruno legacy API
   *
   * Also handles INDIRECT assignment pattern common in Bruno scripts:
   *   let id = body?.access_token;
   *   bru.setEnv("access_token", id);   ← traces `id` back to `body?.access_token`
   */
  extractSetVariables(script) {
    const variables = [];
    if (!script || typeof script !== 'string') return variables;

    // ── Step 0: Build a local variable map for indirect-assignment resolution ──
    // Handles: let id = body?.access_token;  →  id → "body?.access_token"
    // Also:    const token = json.data.token;  →  token → "json.data.token"
    const localVarMap = new Map();
    const assignPattern = /(?:let|const|var)\s+(\w+)\s*=\s*([^;{\n]+)/g;
    let am;
    while ((am = assignPattern.exec(script)) !== null) {
      localVarMap.set(am[1].trim(), am[2].trim());
    }

    // Resolve a source expression using the local variable map.
    // Handles three cases:
    //   1. Simple variable:  bru.setEnv("x", id)          — resolves `id` to `body?.access_token`
    //   2. Property chain:   env.set("x", body2.field)     — resolves `body2` prefix to its source
    //                        (e.g. body2 = pm.response.json()) → pm.response.json().field
    //   3. Array access:     env.set("x", match[1])        — resolves `match` prefix to its source
    //                        (e.g. match = body.match(/re/)) → body.match(/re/)[1]
    const resolveSource = (src) => {
      const trimmed = src.trim().replace(/;$/, '');

      // Case 1: bare variable name → look up in localVarMap
      if (/^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(trimmed) && localVarMap.has(trimmed)) {
        return localVarMap.get(trimmed);
      }

      // Case 2: varName.field or varName?.field — resolve the prefix
      const dotIdx = trimmed.search(/\??\./);
      if (dotIdx > 0) {
        const prefix = trimmed.substring(0, dotIdx).replace(/\?$/, '');
        const rest   = trimmed.substring(dotIdx).replace(/^\./, '');
        if (localVarMap.has(prefix)) {
          return `${localVarMap.get(prefix)}.${rest}`;
        }
      }

      // Case 3: varName[index] — bracket array access (e.g. match[1])
      const bracketIdx = trimmed.search(/\[/);
      if (bracketIdx > 0) {
        const prefix = trimmed.substring(0, bracketIdx);
        const rest   = trimmed.substring(bracketIdx);
        if (localVarMap.has(prefix)) {
          return `${localVarMap.get(prefix)}${rest}`;
        }
      }

      return trimmed;
    };

    const addVar = (varName, rawSource) => {
      if (!varName) return;
      const source = resolveSource(rawSource);
      const extractorType = this.determineExtractorType(source);

      // Choose the right path extractor based on source type
      let extractPath;
      let extraFields = {};
      if (extractorType === 'header') {
        extractPath = this.extractHeaderName(source);
      } else if (extractorType === 'cookie') {
        extractPath = this.extractCookieName(source);
      } else if (extractorType === 'regex') {
        extractPath = '$';
        const pat = this.extractRegexPattern(source);
        if (pat) extraFields.pattern = pat;
      } else if (extractorType === 'xpath') {
        extractPath = this.extractXPathQuery(source);
        if (extractPath) extraFields.xpathQuery = extractPath;
      } else {
        extractPath = this.extractJsonPath(source);
      }

      if (!variables.find(v => v.name === varName)) {
        variables.push({ name: varName, source, extractorType, extractPath, ...extraFields });
      }
    };

    let match;

    // ── Postman: pm.*.set("varName", source) ──────────────────────────────────
    const pmSetPattern = /pm\.(environment|globals|collectionVariables|variables)\.set\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = pmSetPattern.exec(script)) !== null) addVar(match[2], match[3]);

    // ── Postman: context.set("varName", value) ────────────────────────────────
    const contextSetPattern = /context\.set\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = contextSetPattern.exec(script)) !== null) addVar(match[1], match[2]);

    // ── Bruno: bru.setEnv() — OLD ALIAS (still widely used) ──────────────────
    const bruSetEnvPattern = /bru\.setEnv\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = bruSetEnvPattern.exec(script)) !== null) addVar(match[1], match[2]);

    // ── Bruno: bru.setEnvVar() — PRIMARY modern env setter ───────────────────
    const bruSetEnvVarPattern = /bru\.setEnvVar\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = bruSetEnvVarPattern.exec(script)) !== null) addVar(match[1], match[2]);

    // ── Bruno: bru.setVar() — collection / request-scoped ────────────────────
    const bruSetVarPattern = /bru\.setVar\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = bruSetVarPattern.exec(script)) !== null) addVar(match[1], match[2]);

    // ── Bruno: bru.setGlobalVar() — global scope ─────────────────────────────
    const bruSetGlobalPattern = /bru\.setGlobalVar\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = bruSetGlobalPattern.exec(script)) !== null) addVar(match[1], match[2]);

    // ── Bruno: bru.setNextEnvVar() — set in next environment ─────────────────
    const bruSetNextPattern = /bru\.setNextEnvVar\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = bruSetNextPattern.exec(script)) !== null) addVar(match[1], match[2]);

    // ── Bruno 1.x legacy: env.set() and vars.set() ───────────────────────────
    const envSetPattern = /(?:^|[^a-zA-Z0-9_])env\.set\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = envSetPattern.exec(script)) !== null) addVar(match[1], match[2]);
    const varsSetPattern = /(?:^|[^a-zA-Z0-9_])vars\.set\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = varsSetPattern.exec(script)) !== null) addVar(match[1], match[2]);

    // ── Postman legacy: postman.setEnvironmentVariable() / postman.setGlobalVariable() ──
    const postmanSetEnvPattern = /postman\.setEnvironmentVariable\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = postmanSetEnvPattern.exec(script)) !== null) addVar(match[1], match[2]);
    const postmanSetGlobalPattern = /postman\.setGlobalVariable\s*\(\s*["']([^"']+)["']\s*,\s*([^)]+)\)/g;
    while ((match = postmanSetGlobalPattern.exec(script)) !== null) addVar(match[1], match[2]);

    return variables;
  }

  /**
   * Determine extractor type from source expression.
   *
   * Priority order (specific → general):
   *   1. res.headers.* / pm.response.headers.*  → 'header'
   *   2. res.cookies.* / pm.cookies.*           → 'cookie'
   *   3. res.body.* / body?.* / jsonData.*      → 'json'
   *   4. default                                 → 'json'
   */
  determineExtractorType(source) {
    if (!source) return 'json';

    // ── Regex extraction: .match(/pattern/) or .match("pattern") ─────────────
    if (/\.match\s*\(/.test(source)) return 'regex';

    // ── XML extraction: xml2js / cheerio / DOMParser ──────────────────────────
    if (/xml2js|parseString|cheerio|DOMParser|getElementsByTagName|xpath\.|XPath/.test(source)) return 'xpath';

    // ── Header detection (must check BEFORE body to avoid false match on "headers") ──
    if (/(?:res|response|pm\.response)\.headers|getResponseHeader|pm\.response\.headers/.test(source)) return 'header';

    // ── Bruno: res.getHeader("name") ──────────────────────────────────────────
    if (/res\.getHeader\s*\(/.test(source)) return 'header';

    // ── Cookie detection ──────────────────────────────────────────────────────
    if (/(?:res|response)\.cookies|pm\.cookies/.test(source)) return 'cookie';

    // ── Bruno: bru.cookies.get("name") ────────────────────────────────────────
    if (/bru\.cookies\.get\s*\(/.test(source)) return 'cookie';

    // ── Bruno: res.getBody() — JSON body ──────────────────────────────────────
    if (/res\.getBody\s*\(/.test(source)) return 'json';

    // ── JSON body detection (Bruno and Postman patterns) ──────────────────────
    if (/res\.body|body\??\.|jsonData|responseBody|JSON\.parse|json\.|pm\.response\.json|res\.json/.test(source)) return 'json';
    if (source.includes('response.body') || source.includes('pm.response')) return 'json';

    // ── Legacy keyword detection ──────────────────────────────────────────────
    if (/\bheader\b/.test(source)) return 'header';
    if (/\bcookie\b/.test(source)) return 'cookie';

    return 'json';
  }

  /**
   * Extract HTTP header name from a source expression.
   * e.g. res.headers["x-csrf-token"]  → "x-csrf-token"
   *      res.headers.authorization     → "authorization"
   *      pm.response.headers.get("X-Token") → "X-Token"
   */
  extractHeaderName(source) {
    if (!source) return null;
    // Bruno: res.getHeader("name")
    const getHeaderMatch = source.match(/res\.getHeader\s*\(["']([^"']+)["']\)/);
    if (getHeaderMatch) return getHeaderMatch[1];
    // bracket notation: res.headers["name"] or response.headers["name"]
    const bracketMatch = source.match(/headers\s*\[["']([^"']+)["']\]/);
    if (bracketMatch) return bracketMatch[1];
    // .get() notation: pm.response.headers.get("Name")
    const getMatch = source.match(/headers\.get\s*\(["']([^"']+)["']\)/);
    if (getMatch) return getMatch[1];
    // dot notation: res.headers.authorization
    const dotMatch = source.match(/headers\??\.([\w-]+)/);
    if (dotMatch) return dotMatch[1];
    return null;
  }

  /**
   * Extract cookie name from a source expression.
   * e.g. res.cookies["session_id"]  → "session_id"
   *      pm.cookies.get("csrf")     → "csrf"
   */
  extractCookieName(source) {
    if (!source) return null;
    // Bruno: bru.cookies.get("name") or pm.cookies.jar().get(url, "name")
    const bruCookieMatch = source.match(/bru\.cookies\.get\s*\(["']([^"']+)["']\)/);
    if (bruCookieMatch) return bruCookieMatch[1];
    const pmJarMatch = source.match(/pm\.cookies\.jar\(\)\.get\s*\([^,]+,\s*["']([^"']+)["']\)/);
    if (pmJarMatch) return pmJarMatch[1];
    // bracket notation: cookies["name"]
    const bracketMatch = source.match(/cookies\s*\[["']([^"']+)["']\]/);
    if (bracketMatch) return bracketMatch[1];
    // .get() notation: pm.cookies.get("name") or cookies.get("name")
    const getMatch = source.match(/cookies\.get\s*\(["']([^"']+)["']\)/);
    if (getMatch) return getMatch[1];
    // dot notation: cookies.session_id
    const dotMatch = source.match(/cookies\??\.([\w_-]+)/);
    if (dotMatch) return dotMatch[1];
    return null;
  }

  /**
   * Extract JSON path from source expression.
   *
   * Handles all variants:
   *   Bruno direct:    res.body.access_token      → $.access_token
   *   Bruno optional:  body?.access_token         → $.access_token
   *   Bruno nested:    res.body?.data?.token      → $.data.token
   *   Bruno bracket:   res.body["field"]          → $.field
   *   Postman:         jsonData.field, json.data.token
   *   Modern:          pm.response.json().field
   */
  extractJsonPath(source) {
    if (!source) return null;

    const cleanPath = (p) => p
      .replace(/\?\./g, '.')                      // optional chaining
      .replace(/\[["']([^"']+)["']\]/g, '.$1')   // bracket to dot
      .replace(/\.split\(.*/g, '')
      .replace(/\.(pop|shift|trim|toString|toLowerCase|toUpperCase)\(\)/g, '')
      .replace(/\.$/, '')
      .trim();

    // ── Bruno: res.getBody().field ────────────────────────────────────────────
    const getBodyMatch = source.match(/res\.getBody\s*\(\s*\)\s*\??\.([\w$[\]?.]+[^;,)\s]*)/);
    if (getBodyMatch) {
      const path = cleanPath(getBodyMatch[1]);
      if (path) return `$.${path}`;
    }

    // ── Bruno: res.body.field or res.body?.field or response.body.field ───────
    const resBodyMatch = source.match(/(?:res|response)\.body\??\.?([\w$[\]?.]+[^;,)\s]*)/);
    if (resBodyMatch) {
      const path = cleanPath(resBodyMatch[1]);
      if (path && path !== 'body') return `$.${path}`;
      // Just res.body with no field → fallback to root (caller provides hint)
    }

    // ── Bruno: body?.field or body.field (local variable) ────────────────────
    const bodyVarMatch = source.match(/^body\??\.?([\w$[\]?.]+[^;,)\s]*)/);
    if (bodyVarMatch) {
      const path = cleanPath(bodyVarMatch[1]);
      return path ? `$.${path}` : null;
    }

    // ── Postman: pm.response.json().field ────────────────────────────────────
    const pmJsonMatch = source.match(/pm\.response\.json\s*\(\s*\)\s*\??\.([\w$[\]?.]+)/);
    if (pmJsonMatch) {
      const path = cleanPath(pmJsonMatch[1]);
      return path ? `$.${path}` : null;
    }
    // Bare pm.response.json() with no field accessor → root of JSON body
    if (/pm\.response\.json\s*\(\s*\)/.test(source)) return '$';

    // ── JSON.parse(expr).field ────────────────────────────────────────────────
    const jsonParseMatch = source.match(/JSON\.parse\s*\([^)]+\)\s*\??\.([\w$[\]?.]+[^;,)\s]*)/);
    if (jsonParseMatch) {
      const path = cleanPath(jsonParseMatch[1]);
      if (path) return `$.${path}`;
    }

    // ── Postman/Generic: jsonData.field, json.field, response.field, data.field
    const genericMatch = source.match(/(?:jsonData|responseBody|json|response|data)\??\.(.+)/);
    if (genericMatch) {
      const path = cleanPath(genericMatch[1]);
      if (path) return `$.${path}`;
    }

    // ── Fallback: infer from variable name ────────────────────────────────────
    return this.inferPathFromVarName(null, source);
  }

  /**
   * Extract the regex pattern string from a .match() call.
   * e.g. body.match(/access_token":"([^"]+)"/)[1]  → access_token":"([^"]+)"
   *      text.match(/"token":"(.+?)"/)              → "token":"(.+?)"
   */
  extractRegexPattern(source) {
    if (!source) return null;
    // /regex/ literal
    const regexLiteral = source.match(/\.match\s*\(\s*\/((?:[^/\\]|\\.)*)\/[gimsuy]*\s*\)/);
    if (regexLiteral) return regexLiteral[1];
    // "string" or 'string' pattern passed to match()
    const stringPattern = source.match(/\.match\s*\(\s*["']([^"']+)["']\s*\)/);
    if (stringPattern) return stringPattern[1];
    return null;
  }

  /**
   * Derive an XPath query from xml2js / cheerio / DOM access expressions.
   * Returns a best-effort path string (e.g. //root/element/text()).
   * e.g. result.root.token[0]._  → //root/token
   *      $("div.token").text()   → //div[@class="token"]
   */
  extractXPathQuery(source) {
    if (!source) return null;
    // Cheerio: $("selector") — convert to rough xpath comment
    const cheerioMatch = source.match(/\$\s*\(\s*["']([^"']+)["']\s*\)/);
    if (cheerioMatch) return `//${cheerioMatch[1].replace(/\s+/g, '/')}`;
    // xml2js result path: result.RootEl.ChildEl[0]._ or result.root.el[0]
    const xml2jsMatch = source.match(/\w+\.(\w+)\.(\w+)/);
    if (xml2jsMatch) return `//${xml2jsMatch[1]}/${xml2jsMatch[2]}`;
    // DOM: getElementsByTagName("name") / querySelector("name")
    const domTagMatch = source.match(/getElementsByTagName\s*\(\s*["']([^"']+)["']\s*\)/);
    if (domTagMatch) return `//${domTagMatch[1]}`;
    const querySelectorMatch = source.match(/querySelector\s*\(\s*["']([^"']+)["']\s*\)/);
    if (querySelectorMatch) return `//${querySelectorMatch[1]}`;
    return '$';
  }

  /**
   * Infer a reasonable JSON path from variable name and source expression
   */
  inferPathFromVarName(varName, source) {
    if (varName) {
      const name = varName.replace(/^_/, '');
      // Common API response field mappings
      if (/accessToken/i.test(name)) return '$.access_token';
      if (/refreshToken/i.test(name)) return '$.refresh_token';
      if (/endpoint|instanceUrl/i.test(name)) return '$.instance_url';
      if (/deviceCode/i.test(name)) return '$.device_code';
      if (/jobId/i.test(name)) return '$.id';
      if (/userId/i.test(name)) return '$.id';
      if (/orgId/i.test(name)) return '$.id';
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
        const key   = header.key;
        const value = header.value;
        if (!key || !value) return;

        // Extract ALL {{varName}} references from this header value.
        // Using findVariablesInString() handles both:
        //   Pure variable:   {{access_token}}         → varName = "access_token"
        //   Embedded:        Bearer {{access_token}}   → varName = "access_token"
        //   Multiple:        {{scheme}} {{token}}      → both extracted
        const varsInValue = this.findVariablesInString(String(value));
        varsInValue.forEach(varName => {
          if (!valueRegistry.has(varName)) return;
          if (consumed.find(c => c.name === varName)) return;

          const isAuth = key.toLowerCase() === 'authorization' ||
                         String(value).toLowerCase().includes('bearer');
          consumed.push({
            name: varName,
            type: isAuth ? 'token' : 'header',
            location: 'headers',
            path: key
          });
        });
      });
    }

    // 3. Check URL for variables (path + query).
    //    NEVER use new URL() here — it encodes {{variable}} → %7B%7Bvariable%7D%7D,
    //    which breaks all template-variable matching. Always split manually.
    {
      const rawUrl = request.url || '';
      const qIdx   = rawUrl.indexOf('?');
      const rawPath  = qIdx >= 0 ? rawUrl.substring(0, qIdx) : rawUrl;
      const rawQuery = qIdx >= 0 ? rawUrl.substring(qIdx + 1) : '';

      // Check path segment for {{varName}} / ${varName} references
      const pathVars = this.findVariablesInString(rawPath);
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

      // Check query string for variables — split on & then on = to get values
      if (rawQuery) {
        rawQuery.split('&').forEach(pair => {
          const eqIdx = pair.indexOf('=');
          const value = eqIdx >= 0 ? pair.substring(eqIdx + 1) : pair;
          if (this.isVariablePattern(value)) {
            const varName = this.extractVariableName(value);
            if (valueRegistry.has(varName) && !consumed.find(c => c.name === varName)) {
              const key = eqIdx >= 0 ? pair.substring(0, eqIdx) : '';
              consumed.push({
                name: varName,
                type: 'query',
                location: 'queryString',
                path: key
              });
            }
          }
        });

        // Also scan the full query string for any template variables embedded inline
        const queryVars = this.findVariablesInString(rawQuery);
        queryVars.forEach(varName => {
          if (valueRegistry.has(varName) && !consumed.find(c => c.name === varName)) {
            consumed.push({ name: varName, type: 'url', location: 'url', path: 'url' });
          }
        });
      }
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

    // 5. Check auth section for variables (Postman v2.1: request.auth.bearer[0].value = "{{access_token_1}}")
    // The auth section is separate from request.headers — must be scanned independently.
    if (request.auth) {
      const authVars = this._findVariablesInAuth(request.auth);
      authVars.forEach(varName => {
        if (valueRegistry.has(varName) && !consumed.find(c => c.name === varName)) {
          consumed.push({
            name: varName,
            type: 'token',
            location: 'auth',
            path: 'auth'
          });
        }
      });
    }

    return consumed;
  }

  /**
   * Recursively scan an auth object for {{varName}} / ${varName} template variable references.
   * Handles Postman v2.1 format: { type: "bearer", bearer: [{ key: "token", value: "{{access_token_1}}" }] }
   */
  _findVariablesInAuth(auth) {
    const vars = [];
    if (!auth || typeof auth !== 'object') return vars;

    const scan = (obj) => {
      if (typeof obj === 'string') {
        this.findVariablesInString(obj).forEach(v => vars.push(v));
      } else if (Array.isArray(obj)) {
        obj.forEach(item => scan(item));
      } else if (obj && typeof obj === 'object') {
        Object.values(obj).forEach(v => scan(v));
      }
    };

    scan(auth);
    return [...new Set(vars)];
  }

  /**
   * Extract pre-request script from request
   */
  extractPreRequestScript(request) {
    if (request.preRequestScript) return request.preRequestScript;

    const fromEvents = (events) => {
      if (!Array.isArray(events)) return null;
      const ev = events.find(e => e.listen === 'prerequest' || e.listen === 'pre-request');
      if (!ev) return null;
      const s = ev.script;
      if (!s) return null;
      if (s.exec) return Array.isArray(s.exec) ? s.exec.join('\n') : String(s.exec);
      if (typeof s === 'string') return s;
      return null;
    };

    // Check both req.tests[] (brunoParser), req.event[] (Postman raw), and Bruno JSON script.req
    return fromEvents(request.tests)
        || fromEvents(request.event)
        || (request.script?.req ? (typeof request.script.req === 'string' ? request.script.req : null) : null)
        || null;
  }

  /**
   * Extract used variables from pre-request script
   */
  extractUsedVariables(script) {
    const variables = new Set();
    if (!script) return Array.from(variables);

    let match;

    // Postman: pm.*.get("varName")
    const pmGetPattern = /pm\.(environment|globals|collectionVariables|variables)\.get\s*\(\s*["']([^"']+)["']\s*\)/g;
    while ((match = pmGetPattern.exec(script)) !== null) variables.add(match[2]);

    // Bruno: bru.getEnv/getEnvVar/getVar/getGlobalVar/getCollectionVar("varName")
    const bruGetPattern = /bru\.(?:getEnv|getEnvVar|getVar|getGlobalVar|getCollectionVar)\s*\(\s*["']([^"']+)["']\s*\)/g;
    while ((match = bruGetPattern.exec(script)) !== null) variables.add(match[1]);

    // Bruno legacy: env.get("varName"), vars.get("varName")
    const legacyGetPattern = /(?:^|[^a-zA-Z0-9_])(?:env|vars)\.get\s*\(\s*["']([^"']+)["']\s*\)/gm;
    while ((match = legacyGetPattern.exec(script)) !== null) variables.add(match[1]);

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
        
        if (typeof value === 'string') {
          // Use findVariablesInString to catch both pure {{var}} and embedded "prefix {{var}}"
          this.findVariablesInString(value).forEach(varName => {
            variables.push({ name: varName, path: currentPath });
          });
        } else if (typeof value === 'object') {
          variables.push(...this.findVariablesInBody(value, currentPath));
        }
      });
    }

    return variables;
  }

  /**
   * Generate extractor code for DevWeb.
   * Uses JSON.stringify() for all user-supplied strings to ensure proper escaping
   * of double quotes, backslashes, and other special characters in patterns.
   */
  generateExtractor(correlation) {
    // JSON.stringify correctly escapes ", \, control chars etc.
    const n = JSON.stringify(correlation.name || '');

    // Map JMX scope → DevWeb ExtractorScope constant (null = use default Body)
    const scopeConst = this._dvScopeConst(correlation.scope || correlation.extractorScope);

    switch (correlation.extractorType) {
      case 'json':
        return `new load.JsonPathExtractor(${n}, ${JSON.stringify(correlation.extractPath || `$.${correlation.name}`)})`;

      case 'boundary': {
        const lb = JSON.stringify(correlation.leftBound  || '<');
        const rb = JSON.stringify(correlation.rightBound || '>');
        if (scopeConst) {
          return `new load.BoundaryExtractor(${n}, { leftBoundary: ${lb}, rightBoundary: ${rb}, scope: ${scopeConst} })`;
        }
        return `new load.BoundaryExtractor(${n}, ${lb}, ${rb})`;
      }

      case 'regex':
      case 'regexp': {
        const pat     = JSON.stringify(correlation.pattern || '(.+)');
        // JMeter matchNumber: 1 = first, -1 = random, 0 = all occurrences
        const matchNo = this._parseMatchNo(correlation.matchNumber);
        if (scopeConst || matchNo !== 1) {
          // Use options form — positional form 3rd arg is regex flags string, not occurrence
          const opts = [`expression: ${pat}`];
          if (matchNo !== 1) opts.push(`occurrence: ${matchNo}`);
          if (scopeConst) opts.push(`scope: ${scopeConst}`);
          return `new load.RegexpExtractor(${n}, { ${opts.join(', ')} })`;
        }
        return `new load.RegexpExtractor(${n}, ${pat})`;
      }

      case 'textcheck':
      case 'validation': {
        const options = correlation.extractorOptions || {};
        const text    = correlation.expectedText || correlation.text || correlation.value || '';
        const tscope  = options.scope || 'load.ExtractorScope.Body';
        const failOn  = options.failOn !== undefined ? options.failOn : false;
        return `new load.TextCheckExtractor(${n}, { text: ${JSON.stringify(text)}, scope: ${tscope}, failOn: ${failOn} })`;
      }

      case 'xpath': {
        // XpathExtractor (lowercase 'p') — SDK does not support scope for XPath
        const xpathQuery = JSON.stringify(correlation.xpathQuery || `//${correlation.name}`);
        return `new load.XpathExtractor(${n}, ${xpathQuery})`;
      }

      case 'header': {
        // Use options form — positional BoundaryExtractor has no scope arg
        const headerName = correlation.extractPath || correlation.name.replace(/^_/, '');
        return `new load.BoundaryExtractor(${n}, { leftBoundary: ${JSON.stringify(headerName + ': ')}, rightBoundary: "\\r\\n", scope: load.ExtractorScope.Headers })`;
      }

      case 'cookie': {
        // Use dedicated CookieExtractor — extracts from response cookie jar by name
        const cookieName = correlation.extractPath || correlation.name.replace(/^_/, '');
        return `new load.CookieExtractor(${n}, { cookieName: ${JSON.stringify(cookieName)} })`;
      }

      default:
        return `new load.JsonPathExtractor(${n}, ${JSON.stringify(`$.${correlation.name}`)})`;
    }
  }

  /**
   * Map JMX scope field → DevWeb ExtractorScope constant string (or null for body default).
   */
  _dvScopeConst(scope) {
    const map = {
      'response_headers': 'load.ExtractorScope.Headers',
      'request_headers':  'load.ExtractorScope.Headers',
      'url':              'load.ExtractorScope.Url',
      'response_code':    'load.ExtractorScope.Status',
      'response_message': 'load.ExtractorScope.Status',
      'headers':          'load.ExtractorScope.Headers',  // legacy
    };
    return map[scope] || null;
  }

  /**
   * Parse JMeter match_number to integer (1 = first, -1 = random, 0 = all).
   */
  _parseMatchNo(matchNumber) {
    const n = parseInt(matchNumber, 10);
    return isNaN(n) ? 1 : n;
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
  generateUsage(correlation, _requestVarName) {
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
