// ===========================================================================
// SHARED STATE — loaded first; all other modules reference these globals
// ===========================================================================
const S = {
  entries: [],        // all parsed HAR entries
  txns: [],           // [{name, color}]
  colorMap: {},       // txnName -> color object
  selMode: false,
  selIds: new Set(),
  tab: 'ac',
  scripts: {},
  format: 'webhttp',  // 'webhttp' | 'devweb' | 'both'
  pendingHar: null,   // parsed HAR JSON waiting for format confirmation
  pendingNetLog: null,// parsed NetLog JSON waiting for format confirmation
  isNetLogSource: false, // true when loaded from chrome://net-export/ NetLog
  domainFilter: {},   // hostname -> true (include) | false (exclude)
  domainStats: {},    // hostname -> {count, size}
  collapsed: {},      // txnName -> true (collapsed) | false (expanded)
  auth: null,         // detected auth {type, host, port, hostport, realm?, username?}
  serverHost: null,   // detected primary server {host, proto, prefix, count}
  resourceTypeFilter: null  // null = all; Set<string> = whitelist of Chrome DevTools resource types
};

const COLORS = [
  {bg:'#dbeafe',bd:'#3b82f6',tx:'#1e40af'},
  {bg:'#dcfce7',bd:'#22c55e',tx:'#166534'},
  {bg:'#fef9c3',bd:'#eab308',tx:'#854d0e'},
  {bg:'#fce7f3',bd:'#ec4899',tx:'#9d174d'},
  {bg:'#ede9fe',bd:'#8b5cf6',tx:'#5b21b6'},
  {bg:'#ffedd5',bd:'#f97316',tx:'#9a3412'},
  {bg:'#ccfbf1',bd:'#14b8a6',tx:'#134e4a'},
  {bg:'#e0f2fe',bd:'#0ea5e9',tx:'#075985'},
];

const FILE_NAMES = {ac:'Action.c',mj:'main.js',vi:'vuser_init.c',ve:'vuser_end.c',gh:'globals.h'};

// ===========================================================================
// FILTER CONSTANTS — used by classifyHarEntry (inline HTML script)
// ===========================================================================
const STATIC_CT=new Set([
  'image/png','image/jpeg','image/jpg','image/gif','image/svg+xml','image/webp',
  'image/x-icon','image/vnd.microsoft.icon','image/bmp',
  'font/woff','font/woff2','font/ttf','font/eot','font/otf',
  'application/font-woff','application/font-woff2','application/x-font-woff',
  'text/css','application/javascript','text/javascript','application/x-javascript'
]);
const STATIC_EXT=/\.(png|jpe?g|gif|ico|svg|webp|woff2?|ttf|eot|otf|css|js\.map|map)(\?|$)/i;
const NOISY=/google-analytics|googletagmanager|doubleclick|googlesyndication|facebook\.net|hotjar|segment\.io|mixpanel|amplitude|clarity\.ms|adnxs|scorecardresearch|outbrain|taboola|adsrvr|pubmatic/i;

// ===========================================================================
// GENERATOR CONSTANTS — used by genActionC and genMainJS
// ===========================================================================
// Headers never included anywhere (browser-internal / connection-level)
const SKIP_HDRS=new Set([
  // Connection-level — managed by the DevWeb HTTP engine
  'host','content-length','connection','keep-alive','transfer-encoding','te','trailer',
  'expect',          // 100-continue — connection-level
  'via',             // proxy-inserted, irrelevant to load test
  // Encoding/compression — DevWeb SDK handles automatically
  'accept-encoding',
  // Cookie jar — DevWeb SDK manages Set-Cookie→Cookie automatically
  'cookie','cookie2',
  // Browser client hints / fetch metadata — meaningless in headless load test
  'sec-ch-ua','sec-ch-ua-mobile','sec-ch-ua-platform',
  'sec-fetch-dest','sec-fetch-mode','sec-fetch-site','sec-fetch-user',
  // Browser-only privacy/security hints
  'upgrade-insecure-requests','dnt',
  // HTTP/2 priority hint — not applicable to load test protocol layer
  'priority',
  // Conditional cache headers — not needed in scripted replay
  'if-none-match','if-modified-since','if-unmodified-since','if-match',
  'cache-control','pragma',
  // Proxy / forwarding headers
  'x-forwarded-for',
  // DPoP headers - replaced dynamically per-request by getDpopProof()
  'dpop','dpop-pf'
]);
