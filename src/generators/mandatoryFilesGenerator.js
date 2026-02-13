/**
 * Mandatory Files Generator for DevWeb Scripts
 * Generates all required configuration files (tsconfig.json, rts.yml, scenario.yml, parameters.yml)
 */

const fs = require('fs');
const path = require('path');

class MandatoryFilesGenerator {
  constructor(options = {}) {
    this.options = options;
    this.scriptName = options.scriptName || 'DevWebScript';
  }

  /**
   * Generate tsconfig.json
   */
  generateTsConfig() {
    return {
      compilerOptions: {
        noEmit: true,
        jsx: "preserve",
        allowJs: true,
        lib: ["es2020"],
        module: "commonjs",
        moduleResolution: "node",
        target: "es2020"
      },
      files: ["DevWebSdk.d.ts"],
      include: ["./*.js"],
      exclude: ["*.d.ts"]
    };
  }

  /**
   * Generate rts.yml (Runtime Settings)
   */
  generateRtsYml() {
    return `# Runtime Settings Configuration for DevWeb
httpConnection:                         # Configuration for the Net Loader component
  maxPersistentConnectionsPerHost: 6    # The maximum number of connections per host a Vuser can open simultaneously (browser emulation).
  maxConnectedHosts: 30                 # The maximum number of connected hosts per Vuser at any time.
  maxRedirectDepth: 10                  # The maximum number of redirects when sending a request.
  keepAliveTimeout: 60                  # Specifies the keep-alive period (in seconds) for an active network connection.
  connectTimeout: 120                   # Specifies the maximum amount of time (in seconds) a dial will wait for a "connect" to complete.
  abruptClose: false                    # If true, SO_LINGER is set to 0. The socket will not enter TIME_WAIT state, and can be used immediately.
  requestTimeout: 120                   # Specifies the timeout (in seconds) to wait for an HTTP request to complete.
  canonicalHeaderEntries: true          # use canonical keys for http request header entries

grpc:                                   # Configuration for gRPC protocol
  connectTimeout: 120                   # Specifies the maximum amount of time (in seconds) to wait for connection to be established.
  keepAliveTime: 0                      # If specified, the maximum idle time in seconds, after which a keepalive probe is sent.
  maxRecvMsgSize: 0                     # Specifies the maximum message size in bytes the gRPC client can receive. Set 0 for using default value of 4MB.
  maxSendMsgSize: 0                     # Specifies the maximum message size in bytes the gRPC client can send. Set 0 for using default value.

proxy:                                  # Configuration for Proxy server
  usePAC: false                         # Indicates whether to use proxy automatic configuration script during send requests.
  pacAddress: ""                        # Automatic configuration script address. Format: "http://pacaddress".
  useProxy: false                       # Indicates whether to use proxy during send requests.
  proxyServer: ""                       # Proxy server to use. Format: "server:port".
  proxyDomain: ""                       # Proxy server authentication domain.
  proxyUser: ""                         # Proxy server authentication user name.
  proxyPassword: ""                     # Proxy server authentication password.
  proxyAuthenticationType: ""           # Proxy server authentication type. Possible values are ["basic", "ntlm"].
  excludedHosts: []                     # Proxy hosts exception list. Use regular expressions, for example ['prefix.*', '.*.domain'].

ssl:
  disableHTTP2: false                   # If true, HTTP/2 will be disabled
  ignoreBadCertificate: false           # If true, SSL accepts any certificate presented by the server and any hostname in that certificate.
  tlsMaxVersion: tls12                  # Maximum SSL/TLS version that is acceptable. Possible values are [tls10, tls11, tls12, tls13]. Default maximum version is tls12.

replay:
  simulateNewUser: true                 # If true, simulates a new Vuser in each iteration (relevant for closing connections).
  saveSnapshots: "always"               # Specify when to save a snapshot file for WebRequest. Possible values are ["always", "error", "never"].
  snapshotBodySizeLimit: 100            # Limits the snapshot body size (in KB). Set -1 for no limit.
  useCache: false                       # If true, resources response is cached, based on response headers.
  enableDynatrace: false                # Enable Dynatrace AppMon monitoring.
  resourceHttpErrorAsWarning: true      # If true, the log level WARNING is logged, if an issue occurs when obtaining the resource. If false, log level ERROR is logged if an issue occurs.
  enableIntegratedAuthentication: false # Enable Kerberos-based authentication. When the server proposes authentication schemes, use Negotiate preference to other schemes.
  multiIP: "none"                       # Select the way IPs are allocated to Vusers. none - disable the automatic IPs distribution. roundrobin - the IPs are
                                        # allocated in a cyclic manner, random - the IPs are allocated randomly.

vts:                                    # Configuration for VTS proxy server
  useProxy: false                       # If true, uses proxy for VTS requests.
  proxyServer: ""                       # Proxy server to use. Format: "server:port".
  proxyUser: ""                         # Proxy server authentication user name.
  proxyPassword: ""                     # Proxy server authentication password.
  portInQueryString: false              # If true, the port number will be added to the query string and the requests will be sent on httpPort or httpsPort respectively.
  httpPort: 80                          # if "portInQueryString" is set to true this is the port all the http requests will be sent on.
  httpsPort: 443                        # if "portInQueryString" is set to true this is the port all the https requests will be sent on.
  ignoreBadCertificate: false           # If true, SSL accepts any certificate presented by the vts server and any hostname in that certificate.

encryption:
  keyLocation: ""                       # Location of the file containing the key used for data decryption. Format: "folder/keyFile.txt".

vuserLogger:                            # Configuration for Vuser logger
  errorBufferSize: 4096                 # The maximum buffer size for each Vuser logger.
  logMode: full                         # Specify when to create the log file. Possible values are [full, error, none].
  logLevel: trace                       # The log level for Vuser logger. Possible values are [error, warning, info, debug, trace].
  showInConsole: true                   # If true, all the Vuser logging is printed to the console.

flow:                                   # Flow Control definition, please refer to documentation for more details.
  enabled: false

thinkTime:                              # Configuration for think time, to control how the Vuser uses think time during script execution.
  type: "asRecorded"                    # Specifies the think time type to control how the Vuser uses think time during script execution. Possible values are: [ignore, asRecorded, multiply, randomPercentage].
  limit: -1                             # Limits the recorded think time (in seconds) during execution. Set -1 for disabling think time limit.
`;
  }

  /**
   * Generate scenario.yml
   */
  generateScenarioYml() {
    return `# All times are defined in seconds
vusers: 1        #The number of Vusers that will be run during the test
pacing:          #The period of time to wait between iteration of each Vuser
  type: delay    #The Pacing type, valid values: delay or interval
  mode: random   #The Pacing mode, valid values: fixed or random
  min: 3         #The min and max are valid on mode: random.
  max: 6         #The min and max determine the range of values
rampUp: 2        #The number of seconds it will take to start all the Vusers
duration: 20     #The number of seconds to run Vuser iterations after all the Vusers have started running
tearDown: 0      #Not used
`;
  }

  /**
   * Generate parameters.yml with smart nextValue settings
   */
  generateParametersYml(parameters) {
    if (!parameters || parameters.size === 0) {
      return `# No parameters defined\nparameters: []\n`;
    }

    let yaml = `# Parameters Configuration\n`;
    yaml += `# Auto-generated from collection/environment variables\n`;
    yaml += `# nextValue: once = read once per test run (config), iteration = read per iteration (test data)\n`;
    yaml += `parameters:\n`;

    for (const [name, config] of parameters.entries()) {
      yaml += `  - name: ${name}\n`;
      yaml += `    type: ${config.type || 'csv'}\n`;
      yaml += `    fileName: ${config.fileName || 'collection_data.csv'}\n`;
      yaml += `    columnName: ${config.columnName || name}\n`;
      yaml += `    nextValue: ${config.nextValue || 'once'}\n`;
      yaml += `    nextRow: ${config.nextRow || 'sequential'}\n`;
      yaml += `    onEnd: ${config.onEnd || 'loop'}\n`;
      yaml += '\n';
    }

    return yaml;
  }

  /**
   * Generate collection_data.csv with actual values from collection/environment
   * Uses paramValue from each parameter config (set by classifyVariables)
   */
  generateCollectionDataCSV(parameters) {
    if (!parameters || parameters.size === 0) {
      return null;
    }

    const headers = Array.from(parameters.keys());
    let csv = headers.join(',') + '\n';

    // Single row with actual values from collection/environment
    const row = headers.map(header => {
      const param = parameters.get(header);
      const value = String(param.paramValue || '');
      // CSV quoting: if value contains comma, double-quote, or newline, wrap in quotes
      if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
      }
      return value;
    });
    csv += row.join(',') + '\n';

    return csv;
  }

  /**
   * Generate sample value based on parameter type
   */
  generateSampleValue(param, index) {
    if (!param) return `value${index}`;

    const type = param.detectedType || 'string';

    switch (type) {
      case 'email':
        return `user${index}@example.com`;
      case 'url':
        return `https://example.com/resource${index}`;
      case 'uuid':
        return `${index}00000-0000-0000-0000-000000000${String(index).padStart(3, '0')}`;
      case 'number':
        return String(index * 10);
      case 'boolean':
        return index % 2 === 0 ? 'true' : 'false';
      case 'token':
        return `token_${this.generateRandomString(32)}`;
      case 'username':
        return `user${index}`;
      case 'password':
        return `Pass${index}@123`;
      default:
        return `${param.name || 'value'}_${index}`;
    }
  }

  /**
   * Generate random string for tokens
   */
  generateRandomString(length) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return result;
  }

  /**
   * Copy DevWebSdk.d.ts from examples
   */
  copyDevWebSdkDefinitions(outputDir, examplesPath) {
    const sourcePath = path.join(examplesPath, 'examples', 'EmptyScript', 'DevWebSdk.d.ts');
    const destPath = path.join(outputDir, 'DevWebSdk.d.ts');

    try {
      if (fs.existsSync(sourcePath)) {
        fs.copyFileSync(sourcePath, destPath);
        return true;
      } else {
        console.warn('⚠️  DevWebSdk.d.ts not found in examples, using fallback');
        return this.generateFallbackDevWebSdk(destPath);
      }
    } catch (error) {
      console.error('Error copying DevWebSdk.d.ts:', error.message);
      return this.generateFallbackDevWebSdk(destPath);
    }
  }

  /**
   * Generate fallback DevWebSdk.d.ts if original not available
   */
  generateFallbackDevWebSdk(destPath) {
    const fallbackContent = `// DevWeb SDK Type Definitions (Fallback)
// For full definitions, copy from LoadRunner Enterprise DevWeb SDK

declare namespace load {
  // Configuration
  export const config: {
    user: { userId: number };
    runtime: { iteration: number };
  };

  // Global variables
  export const global: any;

  // Parameters
  export const params: any;

  // Logging
  export enum LogLevel { error, warning, info, debug }
  export function log(message: string, level?: LogLevel): void;

  // Timing
  export function sleep(seconds: number): void;
  export function thinkTime(seconds: number): void;

  // Transactions
  export enum TransactionStatus { Passed, Failed, Stopped }
  export class Transaction {
    constructor(name: string);
    start(): void;
    stop(status: TransactionStatus): void;
  }

  // Web Requests
  export class WebRequest {
    static defaults: any;
    constructor(options: any);
    send(): Promise<any>;
    sendSync(): any;
  }

  // Extractors
  export enum ExtractorScope { Body, Headers, All }
  export class BoundaryExtractor {
    constructor(name: string, leftBoundary: string, rightBoundary: string);
  }
  export class JsonPathExtractor {
    constructor(name: string, jsonPath: string);
  }
  export class RegexpExtractor {
    constructor(name: string, pattern: string);
  }
  export class TextCheckExtractor {
    constructor(name: string, options: any);
  }

  // Functions
  export function initialize(name: string, func: () => Promise<void>): void;
  export function action(name: string, func: () => Promise<void>): void;
  export function finalize(name: string, func: () => Promise<void>): void;
}
`;

    try {
      fs.writeFileSync(destPath, fallbackContent, 'utf8');
      return true;
    } catch (error) {
      console.error('Failed to generate fallback DevWebSdk.d.ts:', error.message);
      return false;
    }
  }

  /**
   * Generate all mandatory files
   */
  async generateAll(outputDir, parameters = null, examplesPath = null) {
    const files = {};

    try {
      // 1. Generate tsconfig.json
      const tsconfig = this.generateTsConfig();
      const tsconfigPath = path.join(outputDir, 'tsconfig.json');
      fs.writeFileSync(tsconfigPath, JSON.stringify(tsconfig, null, 2), 'utf8');
      files.tsconfig = tsconfigPath;
      console.log('✓ Generated tsconfig.json');

      // 2. Generate rts.yml
      const rts = this.generateRtsYml();
      const rtsPath = path.join(outputDir, 'rts.yml');
      fs.writeFileSync(rtsPath, rts, 'utf8');
      files.rts = rtsPath;
      console.log('✓ Generated rts.yml');

      // 3. Generate scenario.yml
      const scenario = this.generateScenarioYml();
      const scenarioPath = path.join(outputDir, 'scenario.yml');
      fs.writeFileSync(scenarioPath, scenario, 'utf8');
      files.scenario = scenarioPath;
      console.log('✓ Generated scenario.yml');

      // 4. Generate parameters.yml and collection_data.csv
      if (parameters && parameters.size > 0) {
        const parametersYml = this.generateParametersYml(parameters);
        const parametersPath = path.join(outputDir, 'parameters.yml');
        fs.writeFileSync(parametersPath, parametersYml, 'utf8');
        files.parameters = parametersPath;
        console.log('✓ Generated parameters.yml');

        // 5. Generate collection_data.csv with actual values
        const csv = this.generateCollectionDataCSV(parameters);
        if (csv) {
          const csvPath = path.join(outputDir, 'collection_data.csv');
          fs.writeFileSync(csvPath, csv, 'utf8');
          files.dataCSV = csvPath;
          console.log('✓ Generated collection_data.csv');
        }
      } else {
        console.log('ℹ️  Skipped parameters.yml (no variables to parameterize)');
      }

      // 6. Copy DevWebSdk.d.ts
      if (examplesPath) {
        this.copyDevWebSdkDefinitions(outputDir, examplesPath);
        files.devwebSdk = path.join(outputDir, 'DevWebSdk.d.ts');
        console.log('✓ Copied DevWebSdk.d.ts');
      }

      return files;
    } catch (error) {
      console.error('Error generating mandatory files:', error);
      throw error;
    }
  }
}

module.exports = MandatoryFilesGenerator;
