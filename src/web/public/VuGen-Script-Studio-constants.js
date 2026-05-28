// VuGen Script Studio — Constants, State, and Static Templates
// Extracted from VuGen-Script-Studio.html — Phase 3a

// ═══════════════════════════════════════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════════════════════════════════════
const S = {
  har1: null,
  har2: null,
  isNetLog1: false,
  isNetLog2: false, // true when slot was loaded from chrome://net-export/
  entries1: [],
  entries2: [],
  txns: [], // [{name}] — from START marker detection
  correlations: [],
  candidates: [], // changed values whose source response wasn't found (e.g. truncated HAR)
  params: [], // detected parameterization candidates (user-entered values)
  harWarning: "", // HAR quality warning message
  scripts: {}, // {ac, vi, ve, gh, mj}
  format: "devweb",
  mode: "single",
  tab: "ac",
  auth: null, // detected auth {type, host, port, hostport, realm?, username?}
  serverHost: null, // detected primary server {host, proto, prefix, count}
  filterResourceTypes: null, // null = all; Set<string> = whitelist of Chrome DevTools resource types
  filterDomains: {}, // hostname → true (show) | false (hide)
  domainStats: {},   // hostname → { count: number }
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════
const STATIC_CT = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/svg+xml",
  "image/webp",
  "image/x-icon",
  "image/vnd.microsoft.icon",
  "image/bmp",
  "font/woff",
  "font/woff2",
  "font/ttf",
  "font/eot",
  "font/otf",
  "application/font-woff",
  "application/font-woff2",
  "application/x-font-woff",
  "text/css",
  "application/javascript",
  "text/javascript",
  "application/x-javascript",
]);
const STATIC_EXT =
  /\.(png|jpe?g|gif|ico|svg|webp|woff2?|ttf|eot|otf|css|js\.map|map)(\?|$)/i;
const NOISY =
  /google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.net|hotjar|segment\.io|mixpanel|amplitude|clarity\.ms|adnxs|scorecardresearch|outbrain|taboola|adsrvr|pubmatic/i;
const SKIP_HDRS = new Set([
  // Connection-level — managed by DevWeb HTTP engine
  "host",
  "content-length",
  "connection",
  "keep-alive",
  "transfer-encoding",
  "te",
  "trailer",
  "expect", // 100-continue — connection-level
  "via", // proxy-inserted, irrelevant to load test
  // Encoding/compression — DevWeb SDK handles automatically
  "accept-encoding",
  // Content-Encoding: gzip on requests means the body is compressed.
  // HAR postData.text is always the DECODED (decompressed) content, so including
  // Content-Encoding: gzip causes the server to try to decompress plain text → fails.
  "content-encoding",
  // Cookie jar — managed automatically; correlation engine handles per-name diffing via parseCookieHdr()
  "cookie",
  "cookie2",
  // Browser client hints / fetch metadata — meaningless in headless load test
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "sec-fetch-user",
  // Browser-only privacy/security hints
  "upgrade-insecure-requests",
  "dnt",
  // HTTP/2 priority hint — not applicable to load test protocol layer
  "priority",
  // Conditional cache headers — not needed in scripted replay
  "if-none-match",
  "if-modified-since",
  "if-unmodified-since",
  "if-match",
  "cache-control",
  "pragma",
  // Proxy / forwarding headers
  "x-forwarded-for",
  // DPoP headers - replaced dynamically per-request by getDpopProof()
  "dpop",
  "dpop-pf",
]);

const DYNAMIC_PATTERNS = {
  jwt: /^eyJ[A-Za-z0-9+/=_-]{10,}\.[A-Za-z0-9+/=_-]+\.[A-Za-z0-9+/=_-]+$/,
  uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  hex64: /^[0-9a-f]{64}$/i,
  hex32: /^[0-9a-f]{32}$/i,
  hex16: /^[0-9a-f]{16}$/i, // short hex IDs (e.g. 8-byte token, partial hash)
  longToken: /^[A-Za-z0-9+/=_.\-]{32,}$/, // Base64/opaque tokens ≥32 chars
  // Mid-length tokens 12–35 chars: AWS/GCP instance IDs, request/trace IDs, short keys
  // e.g. "i-0a1b2c3d4e5f67890", "req-abc123-def456", "inst_xyz789abc123", ULIDs
  midToken: /^[A-Za-z0-9][A-Za-z0-9_\-]{11,34}$/,
  // Long numeric IDs: Snowflake IDs, Twitter IDs, GCP instance IDs (15+ digits)
  numericId: /^\d{15,}$/,
  // Server-generated compound keys: e.g. "201;437;02/27/2026", "abc|def|123", "tok:v1:xyz"
  compound: /^[A-Za-z0-9\/.:\-]+([;|][A-Za-z0-9\/.:\-]+){1,}$/,
};
const SESSION_COOKIE_NAMES = new Set([
  "jsessionid",
  "phpsessid",
  "asp.net_sessionid",
  "aspsessionid",
  "session",
  "sessionid",
  "sid",
  "auth_token",
  "access_token",
  "xsrf-token",
  "csrf-token",
  "csrftoken",
  "__requestverificationtoken",
  "rememberme",
  "connect.sid",
  "_session",
]);
const CSRF_HEADER_NAMES = new Set([
  "x-csrf-token",
  "x-xsrf-token",
  "x-csrftoken",
  "csrf-token",
  "__requestverificationtoken",
  "x-request-token",
]);
// Broad pattern for any CSRF-like header name — covers custom app headers such as
// x-xsrf-header, x-csrf-header, x-anti-forgery-token, x-request-verification, etc.
const CSRF_HEADER_PATTERN = /csrf|xsrf|antiforg|request.?verif/i;
const AUTH_HEADER_NAMES = new Set([
  "authorization",
  "x-auth-token",
  "x-api-key",
  "x-access-token",
  "x-token",
]);


// ═══════════════════════════════════════════════════════════════════════════
// PARAMETERIZATION ENGINE
// ═══════════════════════════════════════════════════════════════════════════
const PARAM_KEYS_MAP = [
  // Login credentials
  {
    pattern:
      /^(_?user(name)?|login|email|usr|_username|username_|user_name)$/i,
    name: "Username",
    csvKey: "Username",
  },
  {
    pattern: /^(_?pass(word)?|pwd|passwd|secret|_password)$/i,
    name: "Password",
    csvKey: "Password",
  },
  // Search
  {
    pattern:
      /^(q|query|search(term)?|keyword|term|search_text|searchquery)$/i,
    name: "SearchQuery",
    csvKey: "SearchQuery",
  },
  // Travel — origin/destination
  {
    pattern:
      /^(from_?port|from_?city|depart(ure)?|origin|from_?airport|fromcity)$/i,
    name: "FromCity",
    csvKey: "FromCity",
  },
  {
    pattern:
      /^(to_?port|to_?city|arriv(e|al)?|dest(ination)?|to_?airport|tocity)$/i,
    name: "ToCity",
    csvKey: "ToCity",
  },
  // Dates
  {
    pattern:
      /^(depart_?date|departure_?date|travel_?date|from_?date|out_?date|outbound_?date)$/i,
    name: "DepartDate",
    csvKey: "DepartDate",
  },
  {
    pattern:
      /^(return_?date|arr_?date|to_?date|in_?date|arrive_?date|inbound_?date)$/i,
    name: "ReturnDate",
    csvKey: "ReturnDate",
  },
  // Personal name — also matches "billToFirstName", "billToLastName" after dot-prefix strip
  {
    pattern: /^(bill_?to_?first_?name|first_?name|fname|firstname)$/i,
    name: "FirstName",
    csvKey: "FirstName",
  },
  {
    pattern:
      /^(bill_?to_?last_?name|last_?name|lname|lastname|surname)$/i,
    name: "LastName",
    csvKey: "LastName",
  },
  // Contact
  {
    pattern: /^(phone|mobile|tel|telephone|cell)$/i,
    name: "Phone",
    csvKey: "Phone",
  },
  // Payment card
  {
    pattern: /^(card_?num(ber)?|cc_?num(ber)?|credit_?card|cardno)$/i,
    name: "CardNumber",
    csvKey: "CardNumber",
  },
  {
    pattern:
      /^(expiry_?date?|expire_?date?|card_?expiry|exp_?date?|expirydate|expdate)$/i,
    name: "ExpiryDate",
    csvKey: "ExpiryDate",
  },
  {
    pattern: /^(card_?type|cardtype|card_?brand)$/i,
    name: "CardType",
    csvKey: "CardType",
  },
  // Billing / shipping address — separate entries for line 1 and line 2
  {
    pattern:
      /^(bill_?address1|bill_?to_?address1|ship_?address1|shipping_?address1|address1|addr1)$/i,
    name: "BillingAddress1",
    csvKey: "BillingAddress1",
  },
  {
    pattern:
      /^(bill_?address2|bill_?to_?address2|ship_?address2|shipping_?address2|address2|addr2)$/i,
    name: "BillingAddress2",
    csvKey: "BillingAddress2",
  },
  {
    pattern:
      /^(bill_?address|bill_?to_?address|ship_?address|shipping_?address|address|addr)$/i,
    name: "BillingAddress",
    csvKey: "BillingAddress",
  },
  {
    pattern: /^(bill_?city|billing_?city|ship_?city|city|town)$/i,
    name: "City",
    csvKey: "City",
  },
  {
    pattern:
      /^(bill_?state|billing_?state|ship_?state|state|province|region)$/i,
    name: "State",
    csvKey: "State",
  },
  {
    pattern:
      /^(bill_?zip|billing_?zip|ship_?zip|zip|zip_?code|postal_?code|postcode)$/i,
    name: "ZipCode",
    csvKey: "ZipCode",
  },
  {
    pattern:
      /^(bill_?country|billing_?country|ship_?country|country|nation)$/i,
    name: "Country",
    csvKey: "Country",
  },
  // Quantity / amount
  {
    pattern: /^(amount|price|qty|quantity|total|num_?passengers?)$/i,
    name: "Quantity",
    csvKey: "Quantity",
  },
];


// ═══════════════════════════════════════════════════════════════════════════
// STATIC FILE TEMPLATES (same as VuGen-Recorder)
// ═══════════════════════════════════════════════════════════════════════════
const WEB_DEFAULT_CFG = `[General]
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

const WEB_DEFAULT_USP = `[Profile Actions]
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

const LRW_CUSTOM_BODY_H = `/*********************************************************\n// This file contains the body sections\n// recorded for web_custom_request function.\n**********************************************************/\n`;
const CUSTOM_BODY_VARIABLES_TXT = `/*************************************************************\n// This file contains the variable name assigned to\n// the body sections recorded for web_custom_request function.\n**************************************************************/\n`;

const DEVWEB_RTS_YML = `httpConnection:
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

const DEVWEB_SCENARIO_YML = `# All times are defined in seconds
vusers: 1
pacing:
  type: delay
  mode: fixed
  value: 5
rampUp: 0
duration: 10
tearDown: 0
`;

const DEVWEB_TSCONFIG_JSON = `{
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


const DEVWEB_DEFAULT_CFG = `[General]
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

const DEVWEB_DEFAULT_USP = `[Profile Actions]
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

