const WEB_DEFAULT_CFG =
`[General]
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
WebRecorderVersion=10
MaxConnections=0
HttpVer=1.1
ResetContext=1
KeepAlive=1
EnableChecks=0
ProxyUseBrowser=0
ProxyUseProxy=0
SaveSnapshotResources=1
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
ClearCacheForSimulateNewUser=1
SimulatePrefetchPrerender=0
DisableAED=0
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
ProxyPasswordIsEncrypted=false
GraphHitsPerSecondHttpStatusCodes=1
GraphPagesPerSecond=0
GraphBytesPerSecond=1
WinInetReplay=0
AutoTransFileLine=1
FailNonCriticalItem=0
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

const WEB_DEFAULT_USP =
`[Profile Actions]
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

const LRW_CUSTOM_BODY_H =
`/*********************************************************
// This file contains the body sections
// recorded for web_custom_request function.
**********************************************************/
`;

const CUSTOM_BODY_VARIABLES_TXT =
`/*************************************************************
// This file contains the variable name assigned to
// the body sections recorded for web_custom_request function.
**************************************************************/
`;

const DEVWEB_RTS_YML =
`httpConnection:
  maxPersistentConnectionsPerHost: 6
  maxConnectedHosts: 30
  maxRedirectDepth: 10
  keepAliveTimeout: 60
  connectTimeout: 120
  abruptClose: false
  requestTimeout: 120
  canonicalHeaderEntries: true

network:
  ipVersion: any

dns:
  bypassSystem: false
  ttl: 600

grpc:
  connectTimeout: 120
  keepAliveTime: 0
  maxRecvMsgSize: 0
  maxSendMsgSize: 0

proxy:
  usePAC: false
  pacAddress: ""
  useProxy: false
  proxyServer: ""
  proxyDomain: ""
  proxyUser: ""
  proxyPassword: ""
  proxyAuthenticationType: ""
  excludedHosts: []

ssl:
  disableHTTP2: false
  ignoreBadCertificate: false
  tlsMaxVersion: tls12
  enableHTTP3: false

replay:
  simulateNewUser: true
  saveSnapshots: "always"
  snapshotBodySizeLimit: 100
  useCache: false
  enableDynatrace: false
  resourceHttpErrorAsWarning: true
  enableIntegratedAuthentication: false
  multiIP: "none"

vts:
  useProxy: false
  proxyServer: ""
  proxyUser: ""
  proxyPassword: ""
  portInQueryString: false
  httpPort: 80
  httpsPort: 443
  ignoreBadCertificate: false

encryption:
  keyLocation: ""

vuserLogger:
  errorBufferSize: 4096
  logMode: full
  logLevel: trace
  traceRequestFlowDetails: [headers,body]
  showInConsole: true

flow:
  enabled: false

thinkTime:
  type: "asRecorded"
  limit: -1

openTelemetry:
  enabled: false
  collector: ""
  enableTLS: false
  tlsCertificate: ""
  authenticationHeader: ""
  vusersRate: 100
`;

const DEVWEB_SCENARIO_YML =
`# All times are defined in seconds
vusers: 1
pacing:
  type: delay
  mode: fixed
  value: 5
rampUp: 0
duration: 10
tearDown: 0
`;

const DEVWEB_TSCONFIG_JSON =
`{
  "compilerOptions": {
    "noEmit": true,
    "jsx": "preserve",
    "allowJs": true,
    "lib": ["es2020"],
    "module": "commonjs",
    "moduleResolution": "node",
    "target": "es2020"
  },
  "include": ["./*.js"],
  "exclude": ["*.d.ts"]
}
`;

const DEVWEB_DEFAULT_CFG =
`[General]
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
LogDetail=0
LogOptions=LogBrief
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

const DEVWEB_DEFAULT_USP =
`[Profile Actions]
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
RunLogicNumOfIterations="1"
RunLogicObjectKind="Group"
RunLogicRunMode="Sequential"
[RunLogicRunRoot:Main]
MercIniTreeFather="RunLogicRunRoot"
MercIniTreeSectionName="Main"
Name="Main"
RunLogicActionType="VuserRun"
RunLogicObjectKind="Action"
`;
