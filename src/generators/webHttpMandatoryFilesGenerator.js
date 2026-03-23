/**
 * Mandatory Files Generator for VuGen Web HTTP/HTML Scripts
 *
 * Generates the required VuGen configuration files:
 *   [ScriptName].usr  — VuGen metadata (INI)
 *   default.cfg       — Runtime settings (INI)
 *   default.usp       — Run logic profile (INI)
 *   ParameterFile.prm — Parameter definitions (VuGen INI format)
 *   collection_data.dat — Parameter values (CSV)
 *   ScriptUploadMetadata.xml — LRE upload manifest (XML)
 */

const fs = require('fs');
const path = require('path');

class WebHttpMandatoryFilesGenerator {
  constructor(options = {}) {
    this.scriptName = options.scriptName || 'VuGenScript';
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
   * @param {boolean}  hasJwt    - If true, add jsrsasign.js to [ManuallyExtraFiles]
   * @param {Object}   proxy     - Proxy config { enabled, host, port, username, password } or null
   */
  async generateAll(outputDir, parameters, transactionNames = [], dataFiles = [], hasJwt = false, proxy = null) {
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const safeScriptName = this.sanitizeName(this.scriptName);

    this.writeFile(outputDir, `${safeScriptName}.usr`,
      this.generateUsrFile(safeScriptName, transactionNames, dataFiles, hasJwt));
    this.writeFile(outputDir, 'default.cfg',
      this.generateDefaultCfg(proxy));
    if (proxy && proxy.enabled) console.log(`  ✓ Proxy configured in default.cfg: ${proxy.host}:${proxy.port}`);
    this.writeFile(outputDir, 'default.usp',
      this.generateDefaultUsp());
    this.writeFile(outputDir, 'ParameterFile.prm',
      this.generateParameterFilePrm(parameters));
    this.writeFile(outputDir, 'collection_data.dat',
      this.generateCollectionDataDat(parameters));
    this.writeFile(outputDir, 'ScriptUploadMetadata.xml',
      this.generateScriptUploadMetadata(safeScriptName, dataFiles, hasJwt));

    console.log(`✓ Generated VuGen config files (${safeScriptName}.usr, default.cfg, default.usp, ParameterFile.prm, collection_data.dat, ScriptUploadMetadata.xml)`);
  }

  writeFile(dir, filename, content) {
    fs.writeFileSync(path.join(dir, filename), content, 'utf8');
  }

  sanitizeName(name) {
    return String(name)
      .replace(/[<>:"/\\|?* ]/g, '_')
      .replace(/_+/g, '_')
      .replace(/^_|_$/g, '')
      || 'VuGenScript';
  }

  // ─── [ScriptName].usr (INI) ──────────────────────────────────────────────────

  generateUsrFile(scriptName, transactionNames = [], dataFiles = [], hasJwt = false) {
    const txOrder = transactionNames.length > 0
      ? `\n[TransactionsOrder]\nOrder="${transactionNames.join('__*delimiter*__')}"\n`
      : '';

    const txSection = transactionNames.length > 0
      ? `\n[Transactions]\n${transactionNames.map(n => `${n}=`).join('\n')}\n`
      : '';

    // Data files use Windows backslash paths (VuGen INI convention)
    const extraDataFiles = dataFiles.length > 0
      ? dataFiles.map(f => `data\\${f}=`).join('\n') + '\n'
      : '';

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
${txOrder}${txSection}${hasJwt ? '\n[ManuallyExtraFiles]\njsrsasign.js=\ntransport.pem=\n' : ''}`;
  }

  // ─── default.cfg (INI) ───────────────────────────────────────────────────────

  generateDefaultCfg(proxy = null) {
    // Complete canonical VuGen Web HTTP/HTML runtime config.
    // Proxy settings are injected into [WEB] when a proxy is detected in the collection.
    const proxyLines = proxy && proxy.enabled
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
ProxyUserName=${proxy.username || ''}
ProxyPassword=${proxy.password || ''}
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
UseNativeNTLM=0
OverrideNTLMCreds=0
IntegratedAuthentication=0
HeavyKDCLoad=0
SPNCNameLookup=0
SPNAddNoneDefPort=0
LoadChilEngine=0
PrintBufLineLen=99
PrintBufEscape0=0
LogEnableResponseLimit=0
LogMaxResponseSize=100
EnableJsForTransport=0
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

`;
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
      return '; VuGen Parameter File\n; No parameters defined\n';
    }

    let ini = '; ParameterFile.prm — VuGen Web HTTP/HTML Parameter Definitions\n';
    ini += '; Generated by Bruno to DevWeb Converter\n';
    ini += ';\n';
    ini += '; HOW TO UPDATE VALUES:\n';
    ini += ';   Edit collection_data.dat (same folder) — one row per iteration.\n';
    ini += ';   Column names must match the ColumnName entries below.\n';
    ini += ';\n';
    ini += '; PARAMETER TYPES:\n';
    ini += ';   GenerateNewVal="Once"          → config (base URL, client IDs, API keys)\n';
    ini += ';   GenerateNewVal="EachIteration" → test data (username, password)\n';
    ini += '\n';

    for (const [name, config] of parameters.entries()) {
      const generateNewVal = config.nextValue === 'iteration' ? 'EachIteration' : 'Once';
      const originalValue  = (config.paramValue !== undefined && config.paramValue !== null)
        ? String(config.paramValue) : '';
      // CSV vars from JMX CSVDataSet point to their actual file; others use collection_data.dat
      const tableFile  = config.fileName && config.fileName !== 'collection_data.dat'
        ? config.fileName : 'collection_data.dat';
      const delimiter  = config.delimiter || ',';
      const colIndex   = config.colIndex  || 1;

      ini += `[parameter:${name}]\n`;
      ini += `ColumnName="${name}"\n`;
      ini += `Column="${colIndex}"\n`;
      ini += `Delimiter="${delimiter}"\n`;
      ini += `GenerateNewVal="${generateNewVal}"\n`;
      ini += `OriginalValue="${originalValue}"\n`;
      ini += `OutOfRangePolicy="${config.onEnd === 'last' ? 'AbortVuser' : 'ContinueWithLast'}"\n`;
      ini += `ParamName="${name}"\n`;
      ini += `SelectNextRow="Sequential"\n`;
      ini += `StartRow="1"\n`;
      ini += `Table="${tableFile}"\n`;
      ini += `TableLocation="Local"\n`;
      ini += `Type="Table"\n`;
      ini += `auto_allocate_block_size="1"\n`;
      ini += `value_for_each_vuser=""\n`;
      ini += '\n';
    }

    return ini;
  }

  // ─── collection_data.dat (CSV) ───────────────────────────────────────────────

  generateCollectionDataDat(parameters) {
    if (!parameters || parameters.size === 0) {
      return '';
    }

    // Only include params that belong in collection_data.dat (not external CSV files)
    const names = Array.from(parameters.keys()).filter(name => {
      const cfg = parameters.get(name);
      return !cfg.fileName || cfg.fileName === 'collection_data.dat';
    });

    if (!names.length) return '';

    const header = names.map(n => this.csvEscape(n)).join(',');
    const values = names.map(name => {
      const config = parameters.get(name);
      return this.csvEscape(
        config.paramValue !== undefined && config.paramValue !== null
          ? String(config.paramValue)
          : ''
      );
    }).join(',');

    return `${header}\n${values}\n`;
  }

  // ─── ScriptUploadMetadata.xml ────────────────────────────────────────────────

  generateScriptUploadMetadata(scriptName, dataFiles = [], hasJwt = false) {
    // Data files use forward-slash paths in XML (cross-platform)
    const dataFileEntries = dataFiles.length > 0
      ? dataFiles.map(f => `    <FileEntry Name="data/${this.xmlEscape(f)}" Filter="4" />`).join('\n') + '\n'
      : '';

    // JWT helper files bundled with the script for LRE upload
    const jwtEntries = hasJwt
      ? `    <FileEntry Name="jsrsasign.js" Filter="2" />\n    <FileEntry Name="transport.pem" Filter="2" />\n`
      : '';

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
    <FileEntry Name="ParameterFile.prm" Filter="4" />
    <FileEntry Name="collection_data.dat" Filter="4" />
${jwtEntries}${dataFileEntries}  </GeneralFiles>
</VugenScriptMetadata>
`;
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────────

  xmlEscape(str) {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  }

  csvEscape(str) {
    const s = String(str);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }
}

module.exports = WebHttpMandatoryFilesGenerator;
