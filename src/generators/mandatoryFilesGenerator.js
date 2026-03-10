/**
 * Mandatory Files Generator for DevWeb Scripts
 * Generates all required configuration files (tsconfig.json, rts.yml, scenario.yml, parameters.yml)
 */

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.join(__dirname, '..', '..');

class MandatoryFilesGenerator {
  constructor(options = {}) {
    this.options = options;
    this.scriptName = options.scriptName || 'DevWebScript';
  }

  sanitizeName(name) {
    return String(name)
      .replace(/[<>:"/\\|?* ]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      || 'DevWebScript';
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
   * Generate rts.yml (Runtime Settings) — canonical version matching DevWeb2 reference
   */
  generateRtsYml(proxy = null) {
    // Build proxy section — defaults disabled; populated when proxy detected in collection
    const proxySection = proxy && proxy.enabled
      ? `proxy:
  usePAC: false
  pacAddress: ''
  useProxy: true
  proxyServer: '${proxy.host}:${proxy.port}'
  proxyDomain: ''
  proxyUser: '${proxy.username || ''}'
  proxyPassword: '${proxy.password || ''}'
  proxyAuthenticationType: '${proxy.username ? 'basic' : ''}'
  excludedHosts: []`
      : `proxy:
  usePAC: false
  pacAddress: ''
  useProxy: false
  proxyServer: ''
  proxyDomain: ''
  proxyUser: ''
  proxyPassword: ''
  proxyAuthenticationType: ''
  excludedHosts: []`;

    return `httpConnection:
  maxPersistentConnectionsPerHost: 6
  maxConnectedHosts: 30
  maxRedirectDepth: 10
  keepAliveTimeout: 60
  connectTimeout: 120
  abruptClose: false
  requestTimeout: 120
  canonicalHeaderEntries: true
dns:
  bypassSystem: false
  ttl: 600
grpc:
  connectTimeout: 120
  keepAliveTime: 0
  maxRecvMsgSize: 0
  maxSendMsgSize: 0
${proxySection}
ssl:
  disableHTTP2: false
  ignoreBadCertificate: false
  tlsMaxVersion: tls12
  enableHTTP3: false
replay:
  simulateNewUser: true
  saveSnapshots: always
  snapshotBodySizeLimit: 100
  useCache: false
  enableDynatrace: false
  resourceHttpErrorAsWarning: true
  enableIntegratedAuthentication: true
  multiIP: none
vts:
  useProxy: false
  proxyServer: ''
  proxyUser: ''
  proxyPassword: ''
  portInQueryString: false
  httpPort: 80
  httpsPort: 443
  ignoreBadCertificate: false
encryption:
  keyLocation: ''
vuserLogger:
  errorBufferSize: 4096
  logMode: full
  logLevel: trace
  traceRequestFlowDetails:
    - headers
    - body
  showInConsole: true
flow:
  enabled: false
  initialize: {}
  run: {}
  finalize: {}
thinkTime:
  type: asRecorded
  limit: -1
  arguments: {}
openTelemetry:
  enabled: false
  collector: ''
  enableTLS: false
  tlsCertificate: ''
  authenticationHeader: ''
  vusersRate: 100
userArguments: {}
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

  // ─── DevWeb Mandatory Files ───────────────────────────────────────────────────

  /**
   * Copy a file from the project root to the output directory.
   * jwt-helper.js, jsrsasign.js, DevWebSdk.d.ts, and transport.pem all live
   * in the project root — place them there before running the converter.
   * Returns true on success, false if source not found (logs warning, does NOT generate a stub).
   */
  copyFromProjectRoot(outputDir, filename) {
    const src  = path.join(PROJECT_ROOT, filename);
    const dest = path.join(outputDir, filename);
    try {
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        return true;
      }
      console.warn(`  ⚠  ${filename} not found in project root (${PROJECT_ROOT}). Place it there and re-run.`);
      return false;
    } catch (err) {
      console.error(`  ✗  Failed to copy ${filename}: ${err.message}`);
      return false;
    }
  }

  /**
   * Generate [ScriptName].usr for DevWeb protocol.
   * Based on the canonical DevWeb2.usr reference project.
   * @param {string}   scriptName        - Sanitized script name (no spaces/special chars)
   * @param {string[]} transactionNames  - Transaction names for [TransactionsOrder]
   * @param {boolean}  hasJwt            - Add jwt-helper.js + transport.pem to [ManuallyExtraFiles]
   */
  generateDevWebUsrFile(scriptName, transactionNames = [], hasJwt = false) {
    const txOrder = transactionNames.length > 0
      ? transactionNames.join('__*delimiter*__')
      : '';

    const manualExtras = hasJwt
      ? `jwt-helper.js=\ntransport.pem=\n`
      : '';

    return `[General]
Type=DevWeb
DefaultCfg=default.cfg
MajorVersion=25
MinorVersion=3
ParameterFile=
GlobalParameterFile=
RunType=DevWeb
NewFunctionHeader=1
ActionLogicExt=action_logic
LastActiveAction=Main
ScriptLanguage=JavaScript
Encoding=UTF8
DevelopTool=Vugen
LastModifyVer=25.3.0.0
ActiveTypes=DevWeb
AdditionalTypes=DevWeb
GenerateTypes=DevWeb
ParamLeftBrace={
ParamRightBrace=}
LastCodeGenerationVer=
DisableRegenerate=0
Description=
ScriptLocale=en-GB

[ExtraFiles]
parameters.yml=
rts.yml=

[Actions]
Main=main.js

[Recorded Actions]
Main=0

[Interpreters]
Main=DevWeb

[RunLogicFiles]
Default Profile=default.usp

[Modified Actions]
Main=0

[Replayed Actions]
Main=0

[TransactionsOrder]
Order=${txOrder}

[StateManagement]
LastReplayStatus=0

[ActiveReplay]
LastReplayedRunName=
ActiveRunName=
${manualExtras ? `\n[ManuallyExtraFiles]\n${manualExtras}` : ''}`;
  }

  /**
   * Generate default.cfg for DevWeb protocol.
   * DevWeb config differs from VuGen: UTF8 encoding, no [WEB] section, LogExtended.
   */
  generateDevWebDefaultCfg() {
    return `[General]
AutomaticTransactions=0
AutomaticTransactionsPerFunc=0
ContinueOnError=0
XlBridgeTimeout=120
DefaultRunLogic=default.usp
Encoding=UTF8

[Iterations]
NumOfIterations=1
IterationPace=IterationASAP
StartEvery=60
RandomMin=60
RandomMax=90

[Log]
AutoLog=0
AutoLogBufferSize=1
IncludeEnvInfo=0
LogDetail=1
LogOptions=LogExtended
MsgClassData=0
MsgClassFull=0
MsgClassParameters=0
PrintTimeStamp=0

[ThinkTime]
Factor=1
Limit=1
LimitFlag=0
Options=NOTHINK
`;
  }

  /**
   * Generate default.usp (run logic profile) for DevWeb.
   * DevWeb only has a "Main" action — no vuser_init/vuser_end children.
   * Includes the ErrorHandler sections required by VuGen DevWeb.
   */
  generateDevWebDefaultUsp() {
    return `[Profile Actions]
MercIniTreeFather=""
MercIniTreeSectionName="Profile Actions"
Profile Actions name=Main

[RunLogicEndRoot]
MercIniTreeFather=""
MercIniTreeSectionName="RunLogicEndRoot"
MercIniTreeSons=""
Name="End"
RunLogicActionOrder=""
RunLogicActionType="VuserEnd"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"

[RunLogicErrorHandlerRoot]
MercIniTreeFather=""
MercIniTreeSectionName="RunLogicErrorHandlerRoot"
MercIniTreeSons="vuser_errorhandler"
Name="ErrorHandler"
RunLogicActionOrder="vuser_errorhandler"
RunLogicActionType="VuserErrorHandler"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"

[RunLogicErrorHandlerRoot:vuser_errorhandler]
MercIniTreeFather="RunLogicErrorHandlerRoot"
MercIniTreeSectionName="vuser_errorhandler"
Name="vuser_errorhandler"
RunLogicActionType="VuserErrorHandler"
RunLogicObjectKind="Action"

[RunLogicInitRoot]
MercIniTreeFather=""
MercIniTreeSectionName="RunLogicInitRoot"
MercIniTreeSons=""
Name="Init"
RunLogicActionOrder=""
RunLogicActionType="VuserInit"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"

[RunLogicRunRoot]
MercIniTreeFather=""
MercIniTreeSectionName="RunLogicRunRoot"
MercIniTreeSons="Main"
Name="Run"
RunLogicActionOrder="Main"
RunLogicActionType="VuserRun"
RunLogicAfterPaceMax="90"
RunLogicAfterPaceMin="60"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicPaceConstAfterTime="60"
RunLogicPaceConstTime="60"
RunLogicPaceType="Asap"
RunLogicRandomPaceMax="90"
RunLogicRandomPaceMin="60"
RunLogicRunMode="Sequential"

[RunLogicRunRoot:Main]
MercIniTreeFather="RunLogicRunRoot"
MercIniTreeSectionName="Main"
Name="Main"
RunLogicActionType="VuserRun"
RunLogicObjectKind="Action"
`;
  }

  /**
   * Generate ScriptUploadMetadata.xml for DevWeb protocol.
   * Lists all files for LRE upload.
   * @param {string}  scriptName - Sanitized script name
   * @param {boolean} hasJwt     - Include jwt-helper.js + transport.pem entries
   */
  generateDevWebScriptUploadMetadata(scriptName, hasJwt = false) {
    const jwtEntries = hasJwt
      ? `    <FileEntry Name="jwt-helper.js" Filter="2" />\n    <FileEntry Name="transport.pem" Filter="2" />\n`
      : '';

    return `<?xml version="1.0" encoding="utf-8"?>
<VugenScriptMetadata>
  <ScriptName>${scriptName}</ScriptName>
  <Protocol>DevWeb</Protocol>
  <ActionFiles>
    <FileEntry Name="main.js" Filter="2" />
  </ActionFiles>
  <GeneralFiles>
    <FileEntry Name="${scriptName}.usr" Filter="4" />
    <FileEntry Name="default.cfg" Filter="4" />
    <FileEntry Name="default.usp" Filter="4" />
    <FileEntry Name="parameters.yml" Filter="2" />
    <FileEntry Name="rts.yml" Filter="2" />
${jwtEntries}    <FileEntry Name="Action.c" Filter="1" />
    <FileEntry Name="Bookmarks.xml" Filter="1" />
    <FileEntry Name="Breakpoints.xml" Filter="1" />
    <FileEntry Name="DevWebSdk.d.ts" Filter="1" />
    <FileEntry Name="ScriptUploadMetadata.xml" Filter="1" />
    <FileEntry Name="tsconfig.json" Filter="1" />
    <FileEntry Name="UserTasks.xml" Filter="1" />
    <FileEntry Name="vuser_end.c" Filter="1" />
    <FileEntry Name="vuser_init.c" Filter="1" />
  </GeneralFiles>
</VugenScriptMetadata>
`;
  }

  /**
   * Generate all mandatory DevWeb files.
   *
   * @param {string} outputDir   - Script output folder path
   * @param {Map}    parameters  - Parameter map from classifyVariables()
   * @param {Object} [options]   - Optional settings:
   *   @param {string}   options.examplesPath    - (legacy, ignored — DevWebSdk copied from project root)
   *   @param {string[]} options.transactionNames - Transaction names for [TransactionsOrder]
   *   @param {boolean}  options.hasJwt           - Copy jwt-helper.js + transport.pem, add to ExtraFiles
   * @returns {Object} map of generated file paths
   */
  async generateAll(outputDir, parameters = null, options = null) {
    // Back-compat: if 3rd arg is a string it's the legacy examplesPath — ignore it
    if (typeof options === 'string') options = {};
    options = options || {};
    const { transactionNames = [], hasJwt = false, proxy = null } = options;

    const files = {};
    const safeScriptName = this.sanitizeName(this.scriptName);

    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

    // 1. tsconfig.json
    fs.writeFileSync(path.join(outputDir, 'tsconfig.json'),
      JSON.stringify(this.generateTsConfig(), null, 2), 'utf8');
    console.log('✓ Generated tsconfig.json');

    // 2. rts.yml (canonical 11-section version matching DevWeb2 reference)
    fs.writeFileSync(path.join(outputDir, 'rts.yml'), this.generateRtsYml(proxy), 'utf8');
    if (proxy && proxy.enabled) console.log(`  ✓ Proxy configured in rts.yml: ${proxy.host}:${proxy.port}`);
    console.log('✓ Generated rts.yml');

    // 3. scenario.yml
    fs.writeFileSync(path.join(outputDir, 'scenario.yml'), this.generateScenarioYml(), 'utf8');
    console.log('✓ Generated scenario.yml');

    // 4. parameters.yml + collection_data.csv
    if (parameters && parameters.size > 0) {
      fs.writeFileSync(path.join(outputDir, 'parameters.yml'),
        this.generateParametersYml(parameters), 'utf8');
      console.log('✓ Generated parameters.yml');

      const csv = this.generateCollectionDataCSV(parameters);
      if (csv) {
        fs.writeFileSync(path.join(outputDir, 'collection_data.csv'), csv, 'utf8');
        console.log('✓ Generated collection_data.csv');
      }
    }

    // 5. [ScriptName].usr (DevWeb format)
    fs.writeFileSync(path.join(outputDir, `${safeScriptName}.usr`),
      this.generateDevWebUsrFile(safeScriptName, transactionNames, hasJwt), 'utf8');
    console.log(`✓ Generated ${safeScriptName}.usr`);

    // 6. default.cfg (DevWeb format — differs from VuGen)
    fs.writeFileSync(path.join(outputDir, 'default.cfg'),
      this.generateDevWebDefaultCfg(), 'utf8');
    console.log('✓ Generated default.cfg');

    // 7. default.usp (DevWeb run logic — Main only, no vuser_init/end children)
    fs.writeFileSync(path.join(outputDir, 'default.usp'),
      this.generateDevWebDefaultUsp(), 'utf8');
    console.log('✓ Generated default.usp');

    // 8. ScriptUploadMetadata.xml (DevWeb format)
    fs.writeFileSync(path.join(outputDir, 'ScriptUploadMetadata.xml'),
      this.generateDevWebScriptUploadMetadata(safeScriptName, hasJwt), 'utf8');
    console.log('✓ Generated ScriptUploadMetadata.xml');

    // 9. Copy DevWebSdk.d.ts from project root (canonical source — do NOT generate a stub)
    this.copyFromProjectRoot(outputDir, 'DevWebSdk.d.ts');
    console.log('✓ Copied DevWebSdk.d.ts');

    // 10. Copy jwt-helper.js + transport.pem from project root when JWT is used.
    //     These files MUST be placed in the project root by the user.
    //     jwt-helper.js is the DevWeb-specific JWT helper (uses Node.js built-in crypto).
    if (hasJwt) {
      this.copyFromProjectRoot(outputDir, 'jwt-helper.js');
      console.log('✓ Copied jwt-helper.js  (place jwt-helper.js in project root if missing)');
      this.copyFromProjectRoot(outputDir, 'transport.pem');
      console.log('✓ Copied transport.pem  (replace with your actual private key)');
    }

    return files;
  }
}

module.exports = MandatoryFilesGenerator;
