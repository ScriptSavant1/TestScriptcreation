/**
 * Mandatory Files Generator for VuGen Web HTTP/HTML Scripts
 *
 * Generates the required VuGen configuration files:
 *   [ScriptName].usr    — VuGen metadata (INI)
 *   default.cfg         — Runtime settings (INI)
 *   default.usp         — Run logic profile (INI)
 *   GlobalVars.prm      — Global/config parameter definitions (once per run) — JMX UDVs / collection vars
 *   collection_data.dat — Global parameter values (CSV, 1 data row)
 *   ParameterFile.prm   — CSVDataSet test-data parameter definitions (per iteration)
 *   ScriptUploadMetadata.xml — LRE upload manifest (XML)
 *
 * Parameter file split rationale:
 *   GlobalVars.prm  → parameters with no external file (JMX UDVs, Postman collection vars)
 *                     Points to collection_data.dat — single row, read once, config values
 *   ParameterFile.prm → CSVDataSet-linked parameters only
 *                       Points to user-supplied CSV files — millions of rows, read per iteration
 */

const fs = require("fs");
const path = require("path");

class WebHttpMandatoryFilesGenerator {
  constructor(options = {}) {
    this.scriptName = options.scriptName || "VuGenScript";
  }

  /**
   * Generate all required VuGen configuration files.
   * @param {string} outputDir      - Output directory path
   * @param {Map}    parameters     - Map of name → {name, nextValue, paramValue, ...}
   * @param {string[]} [transactionNames] - Optional list of LR transaction names
   */
  /**
   * @param {string}   outputDir        - Output directory path
   * @param {Map}      parameters       - Map of name → {name, nextValue, paramValue, ...}
   * @param {string[]} transactionNames - LR transaction names (for .usr [TransactionsOrder])
   * @param {string[]} dataFiles        - Extracted data file names (e.g. ['Upload_body.b64'])
   *                                      Written into [ExtraFiles] and ScriptUploadMetadata.xml
   */
  /**
   * @param {string}   outputDir
   * @param {Map}      parameters
   * @param {string[]} transactionNames
   * @param {string[]} dataFiles  - Large body data files extracted to data/ subfolder
   * @param {boolean}  hasJwt    - If true, add lre-utils.js + transport.pem to [ManuallyExtraFiles]
   * @param {Object}   proxy     - Proxy config { enabled, host, port, username, password } or null
   * @param {boolean}  hasDpop   - If true, also add lre-crypto.js (DPoP-only scripts)
   */
  async generateAll(
    outputDir,
    parameters,
    transactionNames = [],
    dataFiles = [],
    hasJwt = false,
    proxy = null,
    hasNtlm = false,
    mtlsCertFiles = [],
    hasDpop = false,
  ) {
    // Back-compat: normalise legacy single-string form
    const _mtlsCertFiles = Array.isArray(mtlsCertFiles) ? mtlsCertFiles : (mtlsCertFiles ? [{ certFile: mtlsCertFiles, keyFile: mtlsCertFiles, format: 'PEM' }] : []);

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeScriptName = this.sanitizeName(this.scriptName);

    // Split parameters first — globalParams needed by generateDefaultCfg ([CommandArguments])
    //   globalParams → collection-level vars (JMX UDVs, Postman collection vars) — read once
    //   csvParams    → CSVDataSet-linked vars (external test-data files) — read per iteration
    const globalParams = this.filterGlobalParams(parameters);
    const csvParams    = this.filterCsvParams(parameters);

    this.writeFile(
      outputDir,
      `${safeScriptName}.usr`,
      this.generateUsrFile(
        safeScriptName,
        transactionNames,
        dataFiles,
        hasJwt,
        _mtlsCertFiles,
        hasDpop,
      ),
    );
    this.writeFile(
      outputDir,
      "default.cfg",
      this.generateDefaultCfg(proxy, hasNtlm, hasJwt, hasDpop, globalParams),
    );
    if (proxy && proxy.enabled)
      console.log(
        `  ✓ Proxy configured in default.cfg: ${proxy.host}:${proxy.port}`,
      );
    this.writeFile(outputDir, "default.usp", this.generateDefaultUsp());

    // GlobalVars.prm: params are now in [CommandArguments] in default.cfg.
    // Keep file for VuGen compatibility but as empty (VuGen won't load it since GlobalParameterFile= is cleared).
    this.writeFile(
      outputDir,
      "GlobalVars.prm",
      this.generateGlobalVarsPrm(new Map()),
    );
    this.writeFile(
      outputDir,
      "collection_data.dat",
      this.generateCollectionDataDat(new Map()),
    );
    this.writeFile(
      outputDir,
      "ParameterFile.prm",
      this.generateParameterFilePrm(csvParams),
    );
    this.writeFile(
      outputDir,
      "ScriptUploadMetadata.xml",
      this.generateScriptUploadMetadata(
        safeScriptName,
        dataFiles,
        hasJwt,
        hasDpop,
      ),
    );

    console.log(
      `✓ Generated VuGen config files (${safeScriptName}.usr, default.cfg, default.usp, GlobalVars.prm, collection_data.dat, ParameterFile.prm, ScriptUploadMetadata.xml)`,
    );
  }

  writeFile(dir, filename, content) {
    fs.writeFileSync(path.join(dir, filename), content, "utf8");
  }

  sanitizeName(name) {
    return (
      String(name)
        .replace(/[<>:"/\\|?* ]/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "") || "VuGenScript"
    );
  }

  // ─── [ScriptName].usr (INI) ──────────────────────────────────────────────────

  generateUsrFile(
    scriptName,
    transactionNames = [],
    dataFiles = [],
    hasJwt = false,
    mtlsCertFiles = [],
    hasDpop = false,
  ) {
    const txOrder =
      transactionNames.length > 0
        ? `\n[TransactionsOrder]\nOrder="${transactionNames.join("__*delimiter*__")}"\n`
        : "";

    const txSection =
      transactionNames.length > 0
        ? `\n[Transactions]\n${transactionNames.map((n) => `${n}=`).join("\n")}\n`
        : "";

    // Data files use Windows backslash paths (VuGen INI convention)
    const extraDataFiles =
      dataFiles.length > 0
        ? dataFiles.map((f) => `data\\${f}=`).join("\n") + "\n"
        : "";

    let manualExtras = "";
    // Both JWT and DPoP use lre-utils.dat - only list it once
    if (hasJwt || hasDpop) {
      manualExtras += "lre-utils.dat=\n";
    }
    if (hasJwt) {
      manualExtras += "transport.pem=\n";
    }
    if (mtlsCertFiles.length > 0 && !hasJwt) {
      const certFilenames = new Set();
      for (const { certFile, keyFile } of mtlsCertFiles) {
        certFilenames.add(certFile);
        certFilenames.add(keyFile);
      }
      for (const fname of certFilenames) manualExtras += `${fname}=\n`;
    }

    const manualExtraSection = manualExtras
      ? `\n[ManuallyExtraFiles]\n${manualExtras}`
      : "";

    return `[General]
Type=Multi
DefaultCfg=default.cfg
ParameterFile=ParameterFile.prm
GlobalParameterFile=
NewFunctionHeader=1
RunType=cci
ActionLogicExt=action_logic
LastActiveAction=Action
MajorVersion=26
MinorVersion=1
ActiveTypes=QTWeb
GenerateTypes=QTWeb
AdditionalTypes=QTWeb
DevelopTool=Vugen
LastModifyVer=26.1.0.0
DFERebrandFlag=Done
LastCodeGenerationVer=26.1.0.0
DisableRegenerate=0
ParamLeftBrace={
ParamRightBrace=}
ScriptLanguage=C
Encoding=ANSI
Description=

[Actions]
vuser_init=vuser_init.c
Action=Action.c
vuser_end=vuser_end.c

[RunLogicFiles]
Default Profile=default.usp

[VuserProfiles]
Profiles=Default Profile

[CfgFiles]
Default Profile=default.cfg

[ExtraFiles]
globals.h=
${extraDataFiles}
[Modified Actions]
vuser_init=0
Action=1
vuser_end=0

[Recorded Actions]
vuser_init=0
Action=1
vuser_end=0

[Replayed Actions]
vuser_init=0
Action=0
vuser_end=0

[Interpreters]
vuser_init=cci
Action=cci
vuser_end=cci

[StateManagement]
LastReplayStatus=0

[ActiveReplay]
LastReplayedRunName=
ActiveRunName=
${txOrder}${txSection}${manualExtraSection}`;
  }

  // ─── default.cfg (INI) ───────────────────────────────────────────────────────

  generateDefaultCfg(proxy = null, hasNtlm = false, hasJwt = false, hasDpop = false, globalParams = null) {
    // Complete canonical VuGen Web HTTP/HTML runtime config.
    // [CommandArguments] section holds all global params read at startup via lr_get_attrib_string().
    // Proxy settings are injected into [WEB] when a proxy is detected in the collection.
    const proxyLines =
      proxy && proxy.enabled
        ? `ProxyUseProxy=1
ProxyUseBrowser=0
ProxyUseAutoConfigScript=0
ProxyAutoConfigScriptURL=
ProxyUseProxyServer=1
ProxyHTTPHost=${proxy.host}
ProxyHTTPPort=${proxy.port}
ProxyHTTPSHost=${proxy.host}
ProxyHTTPSPort=${proxy.port}
ProxyUseSame=1
ProxyBypass=
ProxyNoLocal=0
ProxyUserName=${proxy.username || ""}
ProxyPassword=${proxy.password || ""}
ProxyPasswordIsEncrypted=false`
        : `ProxyUseProxy=1
ProxyUseBrowser=1
ProxyUseAutoConfigScript=0
ProxyAutoConfigScriptURL=
ProxyUseProxyServer=0
ProxyHTTPHost=
ProxyHTTPPort=
ProxyHTTPSHost=
ProxyHTTPSPort=
ProxyUseSame=0
ProxyBypass=
ProxyNoLocal=0
ProxyUserName=
ProxyPasswordIsEncrypted=false`;

    // Build [CommandArguments] from scalar global params.
    // PEM keys are stored on one line with newlines escaped as \n — same escaping
    // used in collection_data.dat — so lr_get_attrib_string() can read them intact.
    let commandArgsSection = '';
    if (globalParams && globalParams.size > 0) {
      const lines = [];
      for (const [name, cfg] of globalParams.entries()) {
        const rawVal = cfg.paramValue !== undefined && cfg.paramValue !== null
          ? String(cfg.paramValue) : '';
        const val = this.decodeHtmlEntities(rawVal);
        // Escape real newlines so the value fits on one INI line
        const singleLine = val.replace(/\r\n/g, '\\n').replace(/\r/g, '\\n').replace(/\n/g, '\\n');
        lines.push(`${name}=${singleLine}`);
      }
      if (lines.length > 0) {
        commandArgsSection = `\n[CommandArguments]\n${lines.join('\n')}\n`;
      }
    }

    return `[General]
XlBridgeTimeout=120
DefaultRunLogic=default.usp
automatic_nested_transactions=1
AutomaticTransactions=1
Encoding=ANSI
ContinueOnError=0
FailTransOnErrorMsg=0
AutomaticTransactionsPerFunc=0
UseThreads=1
Replay64bit=0
AccessVTSPortByQueryString=0
VTSHTTPAccessPort=80
VTSHTTPSAccessPort=443

[ThinkTime]
Options=NOTHINK
Factor=1
LimitFlag=0
Limit=1
ThinkTimeRandomLow=50
ThinkTimeRandomHigh=150

[Iterations]
NumOfIterations=1
IterationPace=IterationASAP
StartEvery=60
RandomMin=60
RandomMax=90

[Log]
LogOptions=LogBrief
MsgClassData=0
MsgClassParameters=0
MsgClassFull=0
AutoLog=0
AutoLogBufferSize=1
LogDetail=0
IncludeEnvInfo=1
PrintTimeStamp=0

[WEB]
SearchForImages=1
HttpVer=1.1
KeepAlive=1
EnableChecks=0
AnalogMode=0
MaxConnections=0
SnapshotOnErrorActive=0
UseBrowserAgent=0
UseCustomAgent=1
Browser_Type=Microsoft Internet Explorer
BrowserVer=10.0
BrowserPlatform=Windows
BrowserLanguageCode=
BrowserUserAgent=Mozilla/5.0 (compatible; MSIE 10.0; Windows; Trident/6.0)
CustomUserAgent=Mozilla/5.0 (compatible; MSIE 10.0; Windows NT 6.1; Trident/6.0)
SimulateCache=1
CacheHtmlPages=1
IgnoreContentCachingTypes=1
KeepNonTextMimeType=text/xml;text/plain
CacheAlwaysCheckForNewerPages=0
ResetContext=1
ClearCacheForSimulateNewUser=1
SimulatePrefetchPrerender=0
DisableAED=0
${proxyLines}
GraphHitsPerSecondHttpStatusCodes=1
GraphPagesPerSecond=0
GraphBytesPerSecond=1
WinInetReplay=0
AutoTransFileLine=1
FailNonCriticalItem=0
SaveSnapshotResources=0
EnableDynatrace=0
HTTPVer=1.1
EnableHTTP2=1
BrowserAcceptLanguage=None
HttpErrorsAsWarnings=0
ConnectTimeout=120
ReceiveTimeout=120
KeepAliveTimeout=60
ZlibHeadersInCompressedRequestBody=0
BrowserAcceptEncoding=gzip, deflate, br
DeleteCacheUnreferencedIterations=1
EnableSnapshotsInReplay=1
EnableIPCache=0
UTF8InputOutput=0
SupportCharset=None
ResourcePageTimeoutIsWarning=0
ParseHtmlContentType=TEXT
PageDownloadTimeout=120
NetBufSize=12288
PrintNTLMLog=0
PrintSSLLog=0
SSLVersionKey=0
OpensslEngineType=0
OpenSSL3CompatibleConnection=0
MaxErrorMatchesAsERRORS=10
MaxRedirectionDepth=10
MaxSelfMetaRefreshCount=2
AedUtf8Values=0
TreeViewRequestBodyLimit=2047
IPVersionPolicy=2
WebSyncRetryIntervalMs=1000
WebSyncRetryTimeoutMs=3000
WebSocketCallBackTimerIntervalMS=500
PrefetchPrerenderCallBackTimerIntervalMS=500
Retry401ThinkTime=0
DisableNTLM2SS=0
UseNativeNTLM=${hasNtlm ? 1 : 0}
OverrideNTLMCreds=${hasNtlm ? 1 : 0}
IntegratedAuthentication=${hasNtlm ? 1 : 0}
HeavyKDCLoad=0
SPNCNameLookup=0
SPNAddNoneDefPort=0
LoadChilEngine=0
PrintBufLineLen=99
PrintBufEscape0=0
LogEnableResponseLimit=0
LogMaxResponseSize=100
EnableJsForTransport=${(hasJwt || hasDpop) ? 1 : 0}
JsForTransportRuntimeSize=51200
JsForTransportStackSize=32
LogFileWrite=0
LogFileWriteTraceToFile=0
UseDataFormatExtensions=0

[ModemSpeed]
EnableCustomModemSpeed=0
EnableModemSpeed=0
ModemSpeed=128000
CustomModemSpeed=1000

[Streaming]
SaveStreamSnapshot=0
StreamLog=1
StreamRetryTime=10
StreamSeekMethod=ByVideoSize
StreamTimeout=30

[FILTERS]
FilterType=1
ExcludeFiltersInList=
IncludeFiltersInList=

[Java]
UseExternalJVM=0
ExternalJREPath=
${commandArgsSection}`;
  }

  // ─── default.usp (INI) ───────────────────────────────────────────────────────

  generateDefaultUsp() {
    // This is the exact MercIniTree format VuGen expects.
    // Missing MercIniTreeSectionName, MercIniTreeSons, RunLogicActionType,
    // and child subsections causes VuGen to fail parsing the run logic,
    // which prevents transactions from being executed during replay.
    return `[Profile Actions]
MercIniTreeFather=""
MercIniTreeSectionName="Profile Actions"
Profile Actions name=vuser_init,Action,vuser_end

[RunLogicEndRoot]
MercIniTreeFather=""
MercIniTreeSectionName="RunLogicEndRoot"
MercIniTreeSons="vuser_end"
Name="End"
RunLogicActionOrder="vuser_end"
RunLogicActionType="VuserEnd"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"

[RunLogicEndRoot:vuser_end]
MercIniTreeFather="RunLogicEndRoot"
MercIniTreeSectionName="vuser_end"
Name="vuser_end"
RunLogicActionType="VuserEnd"
RunLogicObjectKind="Action"

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
MercIniTreeSons="vuser_init"
Name="Init"
RunLogicActionOrder="vuser_init"
RunLogicActionType="VuserInit"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"

[RunLogicInitRoot:vuser_init]
MercIniTreeFather="RunLogicInitRoot"
MercIniTreeSectionName="vuser_init"
Name="vuser_init"
RunLogicActionType="VuserInit"
RunLogicObjectKind="Action"

[RunLogicRunRoot]
MercIniTreeFather=""
MercIniTreeSectionName="RunLogicRunRoot"
MercIniTreeSons="Action"
Name="Run"
RunLogicActionOrder="Action"
RunLogicActionType="VuserRun"
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"

[RunLogicRunRoot:Action]
MercIniTreeFather="RunLogicRunRoot"
MercIniTreeSectionName="Action"
Name="Action"
RunLogicActionType="VuserRun"
RunLogicObjectKind="Action"
`;
  }

  // ─── Parameter file split helpers ───────────────────────────────────────────

  /**
   * Return only parameters that belong to collection_data.dat:
   *   - JMX UDVs, Postman/Bruno collection variables, any var without an external fileName
   * These are global config values read once per test run.
   */
  filterGlobalParams(parameters) {
    if (!parameters || parameters.size === 0) return new Map();
    const result = new Map();
    try {
      for (const [name, cfg] of parameters.entries()) {
        if (!cfg.fileName || cfg.fileName === 'collection_data.dat') {
          result.set(name, cfg);
        }
      }
    } catch (err) {
      console.warn('[WebHttpMandatoryFilesGenerator] filterGlobalParams error:', err.message);
    }
    return result;
  }

  /**
   * Return only parameters linked to external CSVDataSet files.
   * These are test-data values read per iteration (millions of rows).
   */
  filterCsvParams(parameters) {
    if (!parameters || parameters.size === 0) return new Map();
    const result = new Map();
    try {
      for (const [name, cfg] of parameters.entries()) {
        if (cfg.fileName && cfg.fileName !== 'collection_data.dat') {
          result.set(name, cfg);
        }
      }
    } catch (err) {
      console.warn('[WebHttpMandatoryFilesGenerator] filterCsvParams error:', err.message);
    }
    return result;
  }

  /**
   * Generate GlobalVars.prm — global/config parameter definitions.
   * Contains JMX UDVs and Postman/Bruno collection-level variables.
   * All entries point to collection_data.dat (1 data row, read once per run).
   * Referenced by [General] GlobalParameterFile= in the .usr file.
   */
  generateGlobalVarsPrm(parameters) {
    let ini = '; GlobalVars.prm — VuGen Global Parameter Definitions\n';
    ini += '; Generated by Bruno to DevWeb Converter\n';
    ini += ';\n';
    ini += '; Contains: JMX User Defined Variables, Postman/Bruno collection-level variables\n';
    ini += '; These are configuration values read ONCE per test run (base URLs, client IDs, API keys).\n';
    ini += '; Values are stored in collection_data.dat (single row — edit that file to change values).\n';
    ini += ';\n';
    ini += '; JWT parameters: include client_id, token_url, scope, signing_key_id,\n';
    ini += ';   signing_private_key here — accessed as {param_name} inside web_js_run.\n';
    ini += ';\n';

    if (!parameters || parameters.size === 0) {
      ini += '; No global parameters defined.\n';
      return ini;
    }

    try {
      for (const [name, config] of parameters.entries()) {
        const generateNewVal = config.nextValue === 'iteration' ? 'EachIteration' : 'Once';
        const originalValue = this.decodeHtmlEntities(
          config.paramValue !== undefined && config.paramValue !== null
            ? String(config.paramValue) : '',
        )
          .replace(/\r\n/g, '\\r\\n')
          .replace(/\r/g, '\\r')
          .replace(/\n/g, '\\n');

        ini += `[parameter:${name}]\n`;
        ini += `ColumnName="${name}"\n`;
        ini += `Column="${config.colIndex || 1}"\n`;
        ini += `Delimiter="${config.delimiter || ','}"\n`;
        ini += `GenerateNewVal="${generateNewVal}"\n`;
        ini += `OriginalValue="${originalValue}"\n`;
        ini += `OutOfRangePolicy="ContinueWithLast"\n`;
        ini += `ParamName="${name}"\n`;
        ini += `SelectNextRow="Sequential"\n`;
        ini += `StartRow="1"\n`;
        ini += `Table="collection_data.dat"\n`;
        ini += `TableLocation="Local"\n`;
        ini += `Type="Table"\n`;
        ini += `auto_allocate_block_size="1"\n`;
        ini += `value_for_each_vuser=""\n`;
        ini += '\n';
      }
    } catch (err) {
      console.warn('[WebHttpMandatoryFilesGenerator] generateGlobalVarsPrm error:', err.message);
      ini += `; Error generating entries: ${err.message}\n`;
    }

    return ini;
  }

  // ─── ParameterFile.prm (VuGen INI format) ───────────────────────────────────
  //
  // This is the format that VuGen's GUI produces via "Replace with Parameter".
  // Each [parameter:name] section maps one LR parameter to a named column in
  // collection_data.dat.  The CSV has a header row; VuGen resolves the column
  // by matching ColumnName against that header, then reads data from StartRow=1
  // (first data row after the header).
  //
  //   GenerateNewVal="Once"           → same value for all iterations (config)
  //   GenerateNewVal="EachIteration"  → new value per iteration (test data)
  //   OutOfRangePolicy="ContinueWithLast" → repeat last row when data runs out
  //   SelectNextRow="Sequential"      → iterate rows in order
  //   StartRow="1"                    → first data row (header is auto-skipped)

  generateParameterFilePrm(parameters) {
    if (!parameters || parameters.size === 0) {
      return "; ParameterFile.prm — VuGen Web HTTP/HTML Test-Data Parameter Definitions\n" +
             "; Generated by Bruno to DevWeb Converter\n;\n" +
             "; No CSVDataSet test-data parameters defined.\n" +
             "; Global config parameters are in GlobalVars.prm.\n";
    }

    let ini =
      "; ParameterFile.prm — VuGen Web HTTP/HTML Test-Data Parameter Definitions\n";
    ini += "; Generated by Bruno to DevWeb Converter\n";
    ini += ";\n";
    ini += "; Contains: CSVDataSet-linked test-data parameters (usernames, passwords, etc.)\n";
    ini += "; These point to user-supplied CSV files and are read per iteration.\n";
    ini += "; Global config parameters (JMX UDVs, base URLs) are in GlobalVars.prm.\n";
    ini += ";\n";
    ini += "; HOW TO UPDATE VALUES:\n";
    ini +=
      ";   Edit collection_data.dat (same folder) — one row per iteration.\n";
    ini += ";   Column names must match the ColumnName entries below.\n";
    ini += ";\n";
    ini += "; PARAMETER TYPES:\n";
    ini +=
      ';   GenerateNewVal="Once"          → config (base URL, client IDs, API keys)\n';
    ini +=
      ';   GenerateNewVal="EachIteration" → test data (username, password)\n';
    ini += "\n";

    for (const [name, config] of parameters.entries()) {
      const generateNewVal =
        config.nextValue === "iteration" ? "EachIteration" : "Once";
      // Decode HTML entities then escape actual newlines — PEM keys must stay on one line in the
      // INI file. VuGen's parameter parser treats each line as a separate field; a multi-line
      // OriginalValue corrupts the section and prevents the Parameters panel from opening.
      const originalValue = this.decodeHtmlEntities(
        config.paramValue !== undefined && config.paramValue !== null
          ? String(config.paramValue)
          : "",
      )
        .replace(/\r\n/g, "\\r\\n")
        .replace(/\r/g, "\\r")
        .replace(/\n/g, "\\n");
      // CSV vars from JMX CSVDataSet point to their actual file; others use collection_data.dat
      const tableFile =
        config.fileName && config.fileName !== "collection_data.dat"
          ? config.fileName
          : "collection_data.dat";
      const delimiter = config.delimiter || ",";
      const colIndex = config.colIndex || 1;

      ini += `[parameter:${name}]\n`;
      ini += `ColumnName="${name}"\n`;
      ini += `Column="${colIndex}"\n`;
      ini += `Delimiter="${delimiter}"\n`;
      ini += `GenerateNewVal="${generateNewVal}"\n`;
      ini += `OriginalValue="${originalValue}"\n`;
      ini += `OutOfRangePolicy="${config.onEnd === "last" ? "AbortVuser" : "ContinueWithLast"}"\n`;
      ini += `ParamName="${name}"\n`;
      ini += `SelectNextRow="Sequential"\n`;
      ini += `StartRow="1"\n`;
      ini += `Table="${tableFile}"\n`;
      ini += `TableLocation="Local"\n`;
      ini += `Type="Table"\n`;
      ini += `auto_allocate_block_size="1"\n`;
      ini += `value_for_each_vuser=""\n`;
      ini += "\n";
    }

    return ini;
  }

  // ─── collection_data.dat (CSV) ───────────────────────────────────────────────

  generateCollectionDataDat(parameters) {
    if (!parameters || parameters.size === 0) {
      return "";
    }

    // Only include params that belong in collection_data.dat (not external CSV files)
    const names = Array.from(parameters.keys()).filter((name) => {
      const cfg = parameters.get(name);
      return !cfg.fileName || cfg.fileName === "collection_data.dat";
    });

    if (!names.length) return "";

    const header = names.map((n) => this.csvEscape(n)).join(",");
    const values = names
      .map((name) => {
        const config = parameters.get(name);
        // Decode HTML entities then escape actual newlines — PEM keys must stay on one CSV row.
        // VuGen reads collection_data.dat line by line; an un-escaped newline inside a PEM key
        // creates phantom extra rows that break the parameter table.
        const raw =
          config.paramValue !== undefined && config.paramValue !== null
            ? String(config.paramValue)
            : "";
        const clean = this.decodeHtmlEntities(raw)
          .replace(/\r\n/g, "\\r\\n")
          .replace(/\r/g, "\\r")
          .replace(/\n/g, "\\n");
        return this.csvEscape(clean);
      })
      .join(",");

    return `${header}\n${values}\n`;
  }

  // ─── ScriptUploadMetadata.xml ────────────────────────────────────────────────

  generateScriptUploadMetadata(
    scriptName,
    dataFiles = [],
    hasJwt = false,
    hasDpop = false,
  ) {
    // Data files use forward-slash paths in XML (cross-platform)
    const dataFileEntries =
      dataFiles.length > 0
        ? dataFiles
            .map(
              (f) =>
                `    <FileEntry Name="data/${this.xmlEscape(f)}" Filter="4" />`,
            )
            .join("\n") + "\n"
        : "";

    // JWT and DPoP both use lre-utils.dat - only list once
    let extraEntries = "";
    if (hasJwt || hasDpop) {
      extraEntries += `    <FileEntry Name="lre-utils.dat" Filter="2" />\n`;
    }
    if (hasJwt) {
      extraEntries += `    <FileEntry Name="transport.pem" Filter="2" />\n`;
    }

    return `<?xml version="1.0" encoding="utf-8"?>
<VugenScriptMetadata>
  <ScriptName>${this.xmlEscape(scriptName)}</ScriptName>
  <Protocol>Web - HTTP/HTML</Protocol>
  <ActionFiles>
    <FileEntry Name="vuser_init.c" Filter="2" />
    <FileEntry Name="Action.c" Filter="2" />
    <FileEntry Name="vuser_end.c" Filter="2" />
    <FileEntry Name="globals.h" Filter="2" />
  </ActionFiles>
  <GeneralFiles>
    <FileEntry Name="${this.xmlEscape(scriptName)}.usr" Filter="4" />
    <FileEntry Name="default.cfg" Filter="4" />
    <FileEntry Name="default.usp" Filter="4" />
    <FileEntry Name="GlobalVars.prm" Filter="4" />
    <FileEntry Name="collection_data.dat" Filter="4" />
    <FileEntry Name="ParameterFile.prm" Filter="4" />
${extraEntries}${dataFileEntries}  </GeneralFiles>
</VugenScriptMetadata>
`;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  xmlEscape(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }

  csvEscape(str) {
    const s = String(str);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  /**
   * Decode HTML entities in a parameter value before writing to ParameterFile.prm or .dat.
   * Parameter values can arrive with entities when:
   *   - The collection was exported from a web UI that HTML-encoded special chars
   *   - A JMX file stored PEM keys in XML attributes (&#10; for newlines, &amp; for &)
   *   - Double-encoded values from browser copy-paste into Postman/Bruno web interface
   * Handles numeric character references (&#10; &#xA;) for newlines in PEM keys.
   * Without this, VuGen fails to open the Parameters panel and JWT crypto throws
   * "DECODER routines:: unsupported" because the PEM key is corrupted.
   */
  decodeHtmlEntities(value) {
    if (typeof value !== "string") return value;
    return value
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&apos;/g, "'")
      .replace(/&#x0*A;/gi, "\n") // &#xA; or &#x000A; — newlines in PEM keys
      .replace(/&#0*10;/g, "\n") // &#10;
      .replace(/&#x0*D;/gi, "\r") // &#xD;
      .replace(/&#0*13;/g, "\r"); // &#13;
  }
}

module.exports = WebHttpMandatoryFilesGenerator;
