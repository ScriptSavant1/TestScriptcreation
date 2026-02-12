/**
 * Advanced Authentication Handler
 * Supports OAuth 2.0, API Keys, Basic Auth, Bearer Tokens, AWS Signature, and more
 */

class AuthenticationHandler {
  constructor() {
    this.authConfigs = new Map();
    this.authTypes = {
      OAUTH2: 'oauth2',
      BASIC: 'basic',
      BEARER: 'bearer',
      API_KEY: 'apikey',
      AWS_SIGNATURE: 'awsv4',
      DIGEST: 'digest',
      HAWK: 'hawk',
      NTLM: 'ntlm'
    };
  }

  /**
   * Extract authentication from collection
   */
  extractAuthentication(collection) {
    // Collection-level auth
    if (collection.auth) {
      this.processAuth('collection', collection.auth);
    }

    // Extract from requests
    if (collection.item || collection.items) {
      this.extractFromItems(collection.item || collection.items);
    }

    return this.authConfigs;
  }

  /**
   * Extract auth from items recursively
   */
  extractFromItems(items, folder = '') {
    items.forEach(item => {
      if (item.request && item.request.auth) {
        this.processAuth(item.name, item.request.auth, folder);
      }
      
      if (item.item || item.items) {
        this.extractFromItems(item.item || item.items, item.name);
      }
    });
  }

  /**
   * Process authentication configuration
   */
  processAuth(name, auth, folder = '') {
    if (!auth || !auth.type) return;

    const authType = auth.type.toLowerCase();
    const config = {
      name,
      folder,
      type: authType,
      config: this.extractAuthConfig(auth)
    };

    this.authConfigs.set(name, config);
  }

  /**
   * Extract auth configuration based on type
   */
  extractAuthConfig(auth) {
    const authData = {};

    if (Array.isArray(auth[auth.type])) {
      auth[auth.type].forEach(item => {
        authData[item.key] = item.value;
      });
    } else if (typeof auth[auth.type] === 'object') {
      Object.assign(authData, auth[auth.type]);
    }

    return authData;
  }

  /**
   * Generate DevWeb authentication code
   */
  generateAuthCode(authConfig) {
    switch (authConfig.type) {
      case this.authTypes.OAUTH2:
        return this.generateOAuth2Code(authConfig);
      
      case this.authTypes.BASIC:
        return this.generateBasicAuthCode(authConfig);
      
      case this.authTypes.BEARER:
        return this.generateBearerAuthCode(authConfig);
      
      case this.authTypes.API_KEY:
        return this.generateApiKeyCode(authConfig);
      
      case this.authTypes.AWS_SIGNATURE:
        return this.generateAWSSignatureCode(authConfig);
      
      case this.authTypes.DIGEST:
        return this.generateDigestAuthCode(authConfig);
      
      default:
        return this.generateGenericAuthCode(authConfig);
    }
  }

  /**
   * Generate OAuth 2.0 authentication code
   */
  generateOAuth2Code(authConfig) {
    const { config } = authConfig;
    const grantType = config.grant_type || config.grantType || 'authorization_code';

    if (grantType === 'client_credentials') {
      return `
// OAuth 2.0 - Client Credentials Flow
const oauth2Token_request = new load.WebRequest({
    url: "${config.accessTokenUrl || config.tokenUrl}",
    method: "POST",
    headers: {
        "Content-Type": "application/x-www-form-urlencoded"
    },
    body: {
        "grant_type": "client_credentials",
        "client_id": ${this.parameterize(config.clientId || config.client_id)},
        "client_secret": ${this.parameterize(config.clientSecret || config.client_secret)},
        ${config.scope ? `"scope": "${config.scope}",` : ''}
    },
    extractors: [
        new load.JsonPathExtractor("accessToken", "$.access_token"),
        new load.JsonPathExtractor("tokenType", "$.token_type"),
        new load.JsonPathExtractor("expiresIn", "$.expires_in")
    ],
    returnBody: true
});

const oauth2Token_response = oauth2Token_request.sendSync();
load.global.oauth2AccessToken = oauth2Token_response.extractors.accessToken;
load.global.oauth2TokenType = oauth2Token_response.extractors.tokenType || "Bearer";

load.log(\`OAuth2 Token acquired: \${load.global.oauth2AccessToken.substring(0, 20)}...\`, load.LogLevel.info);
`;
    } else if (grantType === 'password') {
      return `
// OAuth 2.0 - Password Grant Flow
const oauth2Token_request = new load.WebRequest({
    url: "${config.accessTokenUrl || config.tokenUrl}",
    method: "POST",
    headers: {
        "Content-Type": "application/x-www-form-urlencoded"
    },
    body: {
        "grant_type": "password",
        "username": ${this.parameterize(config.username)},
        "password": ${this.parameterize(config.password)},
        "client_id": ${this.parameterize(config.clientId || config.client_id)},
        "client_secret": ${this.parameterize(config.clientSecret || config.client_secret)},
        ${config.scope ? `"scope": "${config.scope}",` : ''}
    },
    extractors: [
        new load.JsonPathExtractor("accessToken", "$.access_token"),
        new load.JsonPathExtractor("refreshToken", "$.refresh_token"),
        new load.JsonPathExtractor("tokenType", "$.token_type")
    ],
    returnBody: true
});

const oauth2Token_response = oauth2Token_request.sendSync();
load.global.oauth2AccessToken = oauth2Token_response.extractors.accessToken;
load.global.oauth2RefreshToken = oauth2Token_response.extractors.refreshToken;
load.global.oauth2TokenType = oauth2Token_response.extractors.tokenType || "Bearer";

load.log(\`OAuth2 Token acquired for user\`, load.LogLevel.info);
`;
    } else {
      return `
// OAuth 2.0 - Authorization Code Flow
// Note: This requires manual authorization step or pre-configured token
load.global.oauth2AccessToken = ${this.parameterize(config.accessToken || 'YOUR_ACCESS_TOKEN')};
load.global.oauth2TokenType = "Bearer";
`;
    }
  }

  /**
   * Generate Basic Authentication code
   */
  generateBasicAuthCode(authConfig) {
    const { config } = authConfig;
    
    return `
// Basic Authentication
const username = ${this.parameterize(config.username)};
const password = ${this.parameterize(config.password)};
const basicAuthCredentials = load.utils.base64Encode(\`\${username}:\${password}\`);
load.global.basicAuthHeader = \`Basic \${basicAuthCredentials}\`;

load.log("Basic Auth configured", load.LogLevel.info);
`;
  }

  /**
   * Generate Bearer Token authentication code
   */
  generateBearerAuthCode(authConfig) {
    const { config } = authConfig;
    
    return `
// Bearer Token Authentication
load.global.bearerToken = ${this.parameterize(config.token)};
load.global.authorizationHeader = \`Bearer \${load.global.bearerToken}\`;

load.log("Bearer Token configured", load.LogLevel.info);
`;
  }

  /**
   * Generate API Key authentication code
   */
  generateApiKeyCode(authConfig) {
    const { config } = authConfig;
    const addTo = config.in || 'header';
    const key = config.key || 'X-API-Key';
    const value = config.value;

    if (addTo === 'header') {
      return `
// API Key Authentication (Header)
load.global.apiKey = ${this.parameterize(value)};
load.global.apiKeyHeader = "${key}";

load.log("API Key configured in header", load.LogLevel.info);
`;
    } else if (addTo === 'query') {
      return `
// API Key Authentication (Query Parameter)
load.global.apiKey = ${this.parameterize(value)};
load.global.apiKeyParam = "${key}";

load.log("API Key configured in query parameters", load.LogLevel.info);
`;
    }
  }

  /**
   * Generate AWS Signature v4 authentication code
   */
  generateAWSSignatureCode(authConfig) {
    const { config } = authConfig;
    
    return `
// AWS Signature Version 4 Authentication
load.setUserCredentials(new load.AWSAuthentication(load.AWSProviderType.Static, {
    accessKeyID: ${this.parameterize(config.accessKey || config.accessKeyId)},
    secretAccessKey: ${this.parameterize(config.secretKey || config.secretAccessKey)},
    ${config.sessionToken ? `sessionToken: ${this.parameterize(config.sessionToken)},` : ''}
}));

// AWS signing will be applied automatically with awsSigning option in WebRequest
load.global.awsRegion = "${config.region || 'us-east-1'}";
load.global.awsService = "${config.service || 's3'}";

load.log("AWS Signature v4 configured", load.LogLevel.info);
`;
  }

  /**
   * Generate Digest Authentication code
   */
  generateDigestAuthCode(authConfig) {
    const { config } = authConfig;
    
    return `
// Digest Authentication
// Note: DevWeb handles digest auth automatically with setUserCredentials
load.setUserCredentials({
    username: ${this.parameterize(config.username)},
    password: ${this.parameterize(config.password)},
    ${config.realm ? `realm: "${config.realm}",` : ''}
    host: "*"
});

load.log("Digest Auth configured", load.LogLevel.info);
`;
  }

  /**
   * Generate generic authentication code
   */
  generateGenericAuthCode(authConfig) {
    return `
// ${authConfig.type.toUpperCase()} Authentication
// Custom authentication - configure as needed
${JSON.stringify(authConfig.config, null, 2)
    .split('\n')
    .map(line => '// ' + line)
    .join('\n')}
`;
  }

  /**
   * Generate header injection code for authenticated requests
   */
  generateAuthHeaderInjection(authConfig) {
    switch (authConfig.type) {
      case this.authTypes.OAUTH2:
      case this.authTypes.BEARER:
        return `"Authorization": \`\${load.global.oauth2TokenType || "Bearer"} \${load.global.oauth2AccessToken || load.global.bearerToken}\``;
      
      case this.authTypes.BASIC:
        return `"Authorization": load.global.basicAuthHeader`;
      
      case this.authTypes.API_KEY:
        return `[load.global.apiKeyHeader]: load.global.apiKey`;
      
      default:
        return null;
    }
  }

  /**
   * Generate query parameter injection for authenticated requests
   */
  generateAuthQueryInjection(authConfig) {
    if (authConfig.type === this.authTypes.API_KEY && authConfig.config.in === 'query') {
      return `[load.global.apiKeyParam]: load.global.apiKey`;
    }
    return null;
  }

  /**
   * Check if request needs special AWS signing
   */
  needsAWSSigning(authConfig) {
    return authConfig && authConfig.type === this.authTypes.AWS_SIGNATURE;
  }

  /**
   * Generate AWS signing options for WebRequest
   */
  generateAWSSigningOptions(authConfig) {
    if (!this.needsAWSSigning(authConfig)) return null;

    return `awsSigning: {
        region: load.global.awsRegion,
        service: load.global.awsService
    }`;
  }

  /**
   * Parameterize value for code generation
   */
  parameterize(value) {
    if (!value) return '""';
    
    // Check if it's already a variable reference
    if (typeof value === 'string' && /\{\{.*?\}\}|\$\{.*?\}/.test(value)) {
      const varName = value.replace(/\{\{|\}\}|\$\{|\}/g, '').trim();
      return `load.params.${varName}`;
    }
    
    return `"${value}"`;
  }

  /**
   * Get authentication summary
   */
  getAuthSummary() {
    const summary = {
      totalConfigs: this.authConfigs.size,
      byType: {},
      configs: []
    };

    this.authConfigs.forEach(config => {
      summary.byType[config.type] = (summary.byType[config.type] || 0) + 1;
      summary.configs.push({
        name: config.name,
        type: config.type,
        folder: config.folder
      });
    });

    return summary;
  }

  /**
   * Generate complete authentication initialization code
   */
  generateInitializationCode() {
    const authArray = Array.from(this.authConfigs.values());
    
    if (authArray.length === 0) {
      return '// No authentication configured\n';
    }

    // Generate code for the first/primary auth config
    const primaryAuth = authArray[0];
    return this.generateAuthCode(primaryAuth);
  }
}

module.exports = AuthenticationHandler;
