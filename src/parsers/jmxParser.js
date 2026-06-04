/**
 * JMeter JMX Parser — v3.0
 *
 * CRITICAL FIX (v3): Uses fast-xml-parser with preserveOrder:true so
 * element/hashTree pairs always correspond to the correct document positions.
 *
 * ROOT CAUSE OF EXTRACTOR OFFSET BUG (v2):
 *   fast-xml-parser (preserveOrder:false) groups all same-name siblings into
 *   a single array, destroying document order. flattenHashTree() then tried to
 *   reconstruct order from a static ORDERED_TAGS list — this worked only when
 *   each element type appeared exactly once per level. The moment two
 *   ConstantTimers (or two HeaderManagers, etc.) were interleaved with requests,
 *   the hashTree pool counter advanced for BOTH timers first, assigning
 *   Request1's extractor-hashTree to Timer2, and leaving Request1 with an empty
 *   hashTree (no extractors). Result: extractors shifted off by one request.
 *
 * FIX: preserveOrder:true returns an ordered array where every element is
 *   immediately followed by its own <hashTree> — pairing is trivial.
 *
 * ADDITIONAL IMPROVEMENTS:
 *   - Global headers scoped per thread-group (no cross-bleed)
 *   - HTTP Request Defaults proxy extracted (proxyHost/Port/User/Pass)
 *   - User Defined Variables (Arguments) at ThreadGroup level parsed
 *   - JMeter built-in functions (${__UUID()}, ${__time()}, etc.) mapped to
 *     {{_jmfn_*}} variable references (Tier 1 Dynamic via Rule 3 _ prefix)
 *   - vars.put() / props.put() in JSR223/BeanShell scripts extracted as
 *     empty dynamic variables
 *   - XPath2Extractor, CSS Selector (HtmlExtractor), JMESPath supported
 *   - Per-request proxy from HTTPSampler Advanced tab
 *   - Scoped defaults: thread-group config doesn't bleed to sibling groups
 */

'use strict';

const fs   = require('fs').promises;
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const { buildBaseUrl } = require('../core/utils');

// ─── JMeter built-in function conversion ─────────────────────────────────────
// Map ${__func(...)} → {{_jmfn_name}} so the _ prefix forces Tier 1 Dynamic
// classification (Rule 3) in both generators. The user gets a clear TODO in
// the generated script to replace each _jmfn_* with the equivalent DevWeb /
// VuGen API call.
const JMETER_FN_MAP = [
  // Property / variable indirection — treat as plain variable reference
  [/\$\{__P\(\s*([^,)]+)(?:,[^)]*)?\)\}/g,           '${$1}'],
  [/\$\{__property\(\s*([^,)]+)(?:,[^)]*)?\)\}/gi,    '${$1}'],
  [/\$\{__V\(\s*([^,)]+)(?:,[^)]*)?\)\}/g,            '${$1}'],
  // Well-known functions → descriptive _jmfn_ variable
  [/\$\{__UUID\(\)\}/gi,                              '${_jmfn_uuid}'],
  [/\$\{__time\([^)]*\)\}/gi,                         '${_jmfn_timestamp}'],
  [/\$\{__timeShift\([^)]*\)\}/gi,                    '${_jmfn_timestamp}'],
  [/\$\{__Random\([^)]*\)\}/gi,                       '${_jmfn_random}'],
  [/\$\{__RandomString\([^)]*\)\}/gi,                 '${_jmfn_randomstring}'],
  [/\$\{__RandomDate\([^)]*\)\}/gi,                   '${_jmfn_randomdate}'],
  [/\$\{__threadNum\}/gi,                             '${_jmfn_threadnum}'],
  [/\$\{__threadGroupName\}/gi,                       '${_jmfn_tgname}'],
  [/\$\{__counter\([^)]*\)\}/gi,                      '${_jmfn_counter}'],
  [/\$\{__samplerName\(\)\}/gi,                       '${_jmfn_samplername}'],
  [/\$\{__base64Encode\([^)]*\)\}/gi,                 '${_jmfn_b64encode}'],
  [/\$\{__base64Decode\([^)]*\)\}/gi,                 '${_jmfn_b64decode}'],
  [/\$\{__urlencode\([^)]*\)\}/gi,                    '${_jmfn_urlencode}'],
  [/\$\{__urldecode\([^)]*\)\}/gi,                    '${_jmfn_urldecode}'],
  [/\$\{__digest\([^)]*\)\}/gi,                       '${_jmfn_digest}'],
  [/\$\{__MD5\([^)]*\)\}/gi,                          '${_jmfn_md5}'],
  [/\$\{__char\([^)]*\)\}/gi,                         '${_jmfn_char}'],
  [/\$\{__dateTimeConvert\([^)]*\)\}/gi,              '${_jmfn_datetimeconvert}'],
  [/\$\{__groovy\([^)]*\)\}/gi,                       '${_jmfn_groovy}'],
  [/\$\{__eval\([^)]*\)\}/gi,                         '${_jmfn_eval}'],
  [/\$\{__evalVar\([^)]*\)\}/gi,                      '${_jmfn_evalvar}'],
  [/\$\{__intSum\([^)]*\)\}/gi,                       '${_jmfn_intsum}'],
  [/\$\{__longSum\([^)]*\)\}/gi,                      '${_jmfn_longsum}'],
  [/\$\{__StringFromFile\([^)]*\)\}/gi,               '${_jmfn_stringfromfile}'],
  [/\$\{__FileToString\([^)]*\)\}/gi,                 '${_jmfn_filetostring}'],
  [/\$\{__BeanShell\([^)]*\)\}/gi,                    '${_jmfn_beanshell}'],
  // Side-effect-only functions → remove entirely
  [/\$\{__setProperty\([^)]*\)\}/gi,                  ''],
  [/\$\{__log\([^)]*\)\}/gi,                          ''],
  // Generic catch-all: ${__fnname(...)} → ${_jmfn_fnname}
  [/\$\{__([\w]+)\([^)]*\)\}/g,  (_, fn) => `\${_jmfn_${fn.toLowerCase()}}`],
  // Generic catch-all: ${__fnname} (no parens) → ${_jmfn_fnname}
  [/\$\{__([\w]+)\}/g,           (_, fn) => `\${_jmfn_${fn.toLowerCase()}}`],
];

function convertJmeterFunctions(str) {
  if (!str || typeof str !== 'string') return str;
  for (const [re, repl] of JMETER_FN_MAP) {
    str = str.replace(re, repl);
  }
  return str;
}

// Convert ${varName} → {{varName}} (runs after function conversion)
function convertVars(str) {
  if (!str || typeof str !== 'string') return str;
  str = convertJmeterFunctions(str);
  str = str.replace(/\$\{([^}]+)\}/g, '{{$1}}');
  return str;
}

// ─── XML parser ───────────────────────────────────────────────────────────────
function makeXmlParser() {
  return new XMLParser({
    ignoreAttributes:       false,
    attributeNamePrefix:    '@_',
    allowBooleanAttributes: true,
    parseAttributeValue:    false,
    trimValues:             true,
    preserveOrder:          true,   // ← THE KEY FIX: keeps document element order
    parseNodeValue:         true,
  });
}

// ─── preserveOrder format helpers ─────────────────────────────────────────────
// With preserveOrder:true every node is: { tagName: [children…], ':@': {attrs} }
// Text content appears as a child: { '#text': 'value' }

function getTag(item) {
  if (!item || typeof item !== 'object') return null;
  for (const k of Object.keys(item)) if (k !== ':@') return k;
  return null;
}

function getAttrs(item)    { return (item && item[':@']) || {}; }

function getChildren(item) {
  const tag = getTag(item);
  if (!tag) return [];
  const v = item[tag];
  return Array.isArray(v) ? v : (v != null ? [v] : []);
}

function decodeXmlText(str) {
  if (!str) return str;
  return str
    .replace(/&#xd;/gi, '\r')
    .replace(/&#x0d;/gi, '\r')
    .replace(/&#13;/g, '\r')
    .replace(/&#xa;/gi, '\n')
    .replace(/&#x0a;/gi, '\n')
    .replace(/&#10;/g, '\n')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function getText(item) {
  const ch = getChildren(item);
  const t  = ch.find(c => c && '#text' in c);
  return t ? decodeXmlText(String(t['#text'] ?? '').trim()) : '';
}

// Read a named string/bool/long/int property from a node's children array
function getProp(nodeChildren, name) {
  if (!Array.isArray(nodeChildren)) return '';
  for (const child of nodeChildren) {
    const tag = getTag(child);
    if (!tag) continue;
    if (!['stringProp', 'boolProp', 'longProp', 'intProp'].includes(tag)) continue;
    if (getAttrs(child)['@_name'] === name) return getText(child);
  }
  return '';
}

function findChild(nodeChildren, tag) {
  if (!Array.isArray(nodeChildren)) return null;
  return nodeChildren.find(c => getTag(c) === tag) || null;
}

function findChildren(nodeChildren, tag) {
  if (!Array.isArray(nodeChildren)) return [];
  return nodeChildren.filter(c => getTag(c) === tag);
}

function findChildByAttr(nodeChildren, tag, attrKey, attrVal) {
  if (!Array.isArray(nodeChildren)) return null;
  return nodeChildren.find(c =>
    getTag(c) === tag && getAttrs(c)[attrKey] === attrVal
  ) || null;
}

// ─── Flatten hashTree children into ordered [{tag,node,attrs,childHashTree}] ──
// With preserveOrder:true this is trivially correct:
//   each element appears at index i and its paired hashTree at index i+1.
// No ORDERED_TAGS heuristics, no counter drift, no off-by-one possible.
function flattenHashTree(nodeChildren) {
  const result = [];
  if (!Array.isArray(nodeChildren)) return result;

  let i = 0;
  while (i < nodeChildren.length) {
    const item = nodeChildren[i];
    const tag  = getTag(item);

    // Skip text nodes and standalone hashTrees (consumed as pairs below)
    if (!tag || tag === '#text' || tag === 'hashTree') { i++; continue; }

    // Peek at the next sibling for the paired hashTree
    const next    = nodeChildren[i + 1];
    const nextTag = next ? getTag(next) : null;
    const childHashTree = (nextTag === 'hashTree') ? getChildren(next) : [];

    result.push({
      tag,
      node:         getChildren(item),  // this element's own children
      attrs:        getAttrs(item),      // this element's attributes
      childHashTree                      // paired hashTree's children
    });

    i += (nextTag === 'hashTree') ? 2 : 1;
  }

  return result;
}

// ─── Parse HTTP Request Defaults (ConfigTestElement) ─────────────────────────
function parseHttpDefaults(nodeChildren) {
  return {
    domain:          getProp(nodeChildren, 'HTTPSampler.domain'),
    port:            getProp(nodeChildren, 'HTTPSampler.port'),
    protocol:        getProp(nodeChildren, 'HTTPSampler.protocol'),
    proxyHost:       getProp(nodeChildren, 'HTTPSampler.proxyHost'),
    proxyPort:       getProp(nodeChildren, 'HTTPSampler.proxyPort'),
    proxyUser:       getProp(nodeChildren, 'HTTPSampler.proxyUser'),
    proxyPass:       getProp(nodeChildren, 'HTTPSampler.proxyPass'),
    contentEncoding: getProp(nodeChildren, 'HTTPSampler.contentEncoding'),
    followRedirects: getProp(nodeChildren, 'HTTPSampler.follow_redirects'),
  };
}

// ─── Parse HeaderManager ──────────────────────────────────────────────────────
function parseHeaderManager(nodeChildren) {
  const headers  = [];
  const collItem = findChild(nodeChildren, 'collectionProp');
  if (!collItem) return headers;
  for (const elemItem of findChildren(getChildren(collItem), 'elementProp')) {
    const ec = getChildren(elemItem);
    const k  = getProp(ec, 'Header.name');
    const v  = getProp(ec, 'Header.value');
    if (k) headers.push({ key: k, value: v });
  }
  return headers;
}

// ─── Parse AuthManager ────────────────────────────────────────────────────────
function parseAuthManager(nodeChildren) {
  const collItem = findChild(nodeChildren, 'collectionProp');
  if (!collItem) return null;
  const items = findChildren(getChildren(collItem), 'elementProp');
  if (!items.length) return null;

  const fc        = getChildren(items[0]);
  const username  = getProp(fc, 'Authorization.username');
  const password  = getProp(fc, 'Authorization.password');
  const domain    = getProp(fc, 'Authorization.domain');
  const realm     = getProp(fc, 'Authorization.realm');
  const url       = getProp(fc, 'Authorization.url');
  const mechanism = getProp(fc, 'Authorization.mechanism') || '';

  let type = 'basic';
  if (/kerberos/i.test(mechanism))            type = 'kerberos';
  else if (/ntlm/i.test(mechanism) || domain) type = 'ntlm';
  else if (/digest/i.test(mechanism))         type = 'digest';

  return { type, username, password, domain, realm, url, hostport: extractHostPort(url) };
}

function extractHostPort(urlStr) {
  try { const u = new URL(urlStr || ''); return u.hostname || urlStr; }
  catch { return urlStr || ''; }
}

// ─── Map JMeter "useHeaders" / "Apply to" field → normalised scope string ────
// JMeter values: 'false'|''→body · 'true'→response headers · 'request_headers' ·
//   'URL' · 'code' → HTTP status · 'message' → status message ·
//   'body_unescaped'→body · 'body_as_document'→body (Office/PDF extraction)
function jmxScopeFromUseHeaders(raw) {
  switch ((raw || '').trim()) {
    case 'true':             return 'response_headers';
    case 'request_headers':  return 'request_headers';
    case 'URL':              return 'url';
    case 'code':             return 'response_code';
    case 'message':          return 'response_message';
    default:                 return 'body';  // 'false', '', 'body_unescaped', 'body_as_document'
  }
}

// ─── Parse extractors ────────────────────────────────────────────────────────
// taggedItems: array of {tag, node} from flattenHashTree output
function parseExtractors(taggedItems) {
  const extractors = [];
  for (const { tag, node } of taggedItems) {

    if (tag === 'RegexExtractor') {
      const name = getProp(node, 'RegexExtractor.refname');
      if (!name) continue;
      extractors.push({
        type:        'regex',
        name,
        regex:       getProp(node, 'RegexExtractor.regex'),
        template:    getProp(node, 'RegexExtractor.template') || '$1$',
        matchNumber: getProp(node, 'RegexExtractor.match_no')     ||
                     getProp(node, 'RegexExtractor.match_number') || '1',
        scope:       jmxScopeFromUseHeaders(getProp(node, 'RegexExtractor.useHeaders')),
      });
    }

    else if (tag === 'BoundaryExtractor') {
      const name = getProp(node, 'BoundaryExtractor.refname');
      if (!name) continue;
      extractors.push({
        type:          'boundary',
        name,
        leftBoundary:  getProp(node, 'BoundaryExtractor.lboundary'),
        rightBoundary: getProp(node, 'BoundaryExtractor.rboundary'),
        scope:         jmxScopeFromUseHeaders(getProp(node, 'BoundaryExtractor.useHeaders')),
      });
    }

    // JSONPath Extractor (standard + atlantbh plugin)
    else if (tag === 'JSONPathExtractor' ||
             tag === 'com.atlantbh.jmeter.plugins.jsonutils.jsonpathextractor.JSONPathExtractor') {
      // JMeter 5.x uses 'referenceName'; older/plugins use 'refname', 'REFNAME', 'var'
      const name = getProp(node, 'JSONPathExtractor.referenceName') ||
                   getProp(node, 'JSONPathExtractor.refname')        ||
                   getProp(node, 'JSON_PATH_EXTRACTOR.REFNAME')      ||
                   getProp(node, 'JSON_PATH_EXTRACTOR.VAR');
      if (!name) continue;
      extractors.push({
        type:        'jsonpath',
        name,
        jsonPath:    getProp(node, 'JSONPathExtractor.jsonPathExpr')   ||
                     getProp(node, 'JSONPathExtractor.jsonpath')        ||
                     getProp(node, 'JSON_PATH_EXTRACTOR.JSONPATH')      || `$.${name}`,
        matchNumber: getProp(node, 'JSONPathExtractor.match_no')        ||
                     getProp(node, 'JSONPathExtractor.match_number')    || '1',
      });
    }

    // XPath 1.0
    else if (tag === 'XPathExtractor') {
      const name = getProp(node, 'XPathExtractor.refname');
      if (!name) continue;
      extractors.push({
        type:  'xpath',
        name,
        xpath: getProp(node, 'XPathExtractor.xpathQuery'),
      });
    }

    // XPath 2.0
    else if (tag === 'XPath2Extractor') {
      const name = getProp(node, 'XPath2Extractor.refname');
      if (!name) continue;
      extractors.push({
        type:  'xpath',
        name,
        xpath: getProp(node, 'XPath2Extractor.xpathQuery'),
      });
    }

    // CSS Selector Extractor (HtmlExtractor)
    else if (tag === 'HtmlExtractor') {
      const name = getProp(node, 'HtmlExtractor.refname');
      if (!name) continue;
      const cssExpr = getProp(node, 'HtmlExtractor.expr');
      const attr    = getProp(node, 'HtmlExtractor.attribute');
      // Map to boundary as closest VuGen equivalent; annotate for post-conversion
      extractors.push({
        type:          'boundary',
        name,
        leftBoundary:  cssExpr ? `${cssExpr}>` : '',
        rightBoundary: '</',
        scope:         'body',
        // Extra metadata for future CSS-aware code generation
        originalType:  'css',
        cssExpression: cssExpr,
        attribute:     attr,
      });
    }

    // JSON JMESPath Extractor
    else if (tag === 'JMESPathExtractor') {
      const name = getProp(node, 'JMESPathExtractor.refname');
      if (!name) continue;
      extractors.push({
        type:     'jsonpath',
        name,
        jsonPath: getProp(node, 'JMESPathExtractor.jmesPathExpr') || `$.${name}`,
      });
    }
  }
  return extractors;
}

// ─── Extract variable names set inside JSR223/BeanShell scripts ──────────────
// Detects: vars.put("name", ...), props.put("name", ...), vars.putObject(...)
// These variables are added to the collection as empty → Rule 4 → Tier 1 Dynamic
function extractScriptSetVars(scriptText) {
  const vars = new Set();
  if (!scriptText) return vars;
  const patterns = [
    /vars\.put(?:Object)?\s*\(\s*["']([^"']+)["']/g,
    /vars\.putObject\s*\(\s*["']([^"']+)["']/g,
    /props\.put\s*\(\s*["']([^"']+)["']/g,
    /JMeterVariables\.put\s*\(\s*["']([^"']+)["']/g,
    // ctx.setVariables / SampleResult.setResponseData variants (less common)
    /ctx\.getVariables\(\)\.put\s*\(\s*["']([^"']+)["']/g,
  ];
  for (const re of patterns) {
    for (const m of scriptText.matchAll(re)) {
      if (m[1]) vars.add(m[1]);
    }
  }
  return vars;
}

// ─── Parse script text from JSR223 / BeanShell node ──────────────────────────
// Returns { code, lang } so callers can emit language-specific conversions.
// lang: 'groovy' | 'java' | 'javascript' | 'beanshell'
function parseScriptNode(nodeChildren, attrs) {
  const code = (getProp(nodeChildren, 'script') ||
                getProp(nodeChildren, 'BeanShell.query') || '').trim();
  if (!code) return null;
  // Determine script language from attribute or explicit property
  const rawLang = (attrs && (attrs['@_scriptLanguage'] || '')) ||
                   getProp(nodeChildren, 'scriptLanguage') || 'groovy';
  let lang = rawLang.toLowerCase();
  if (lang.includes('beanshell'))  lang = 'beanshell';
  else if (lang.includes('java'))  lang = 'java';
  else if (lang.includes('js') || lang.includes('ecma') || lang.includes('nashorn')) lang = 'javascript';
  else                              lang = 'groovy'; // default
  return { code, lang };
}

// ─── Parse timer delay (ms → seconds) ────────────────────────────────────────
function parseTimerMs(nodeChildren) {
  const delay = getProp(nodeChildren, 'ConstantTimer.delay') ||
                getProp(nodeChildren, 'GaussianRandomTimer.delay') ||
                getProp(nodeChildren, 'RandomTimer.delay')   ||
                getProp(nodeChildren, 'UniformRandomTimer.Maximum_Timer.delay') || '0';
  return parseFloat(delay) / 1000 || 0;
}

// ─── Parse CSVDataSet ─────────────────────────────────────────────────────────
function parseCsvDataSet(nodeChildren) {
  return {
    filename:      convertVars(getProp(nodeChildren, 'filename')),
    variableNames: getProp(nodeChildren, 'variableNames'),
    delimiter:     getProp(nodeChildren, 'delimiter') || ',',
    recycle:       getProp(nodeChildren, 'recycle')   !== 'false',
    shareMode:     getProp(nodeChildren, 'shareMode') || 'All threads',
  };
}

// ─── Parse thread group parameters for WLM Excel ─────────────────────────────
function parseThreadGroup(nodeChildren, attrs, xmlTag) {
  if (attrs['@_enabled'] === 'false') return null;

  const name = attrs['@_testname'] || 'Thread Group';
  let type   = 'Standard';
  if (xmlTag === 'SetupThreadGroup')              type = 'SetUp';
  else if (xmlTag === 'PostThreadGroup')          type = 'TearDown';
  else if (/SteppingThreadGroup/i.test(xmlTag))   type = 'Stepping';
  else if (/UltimateThreadGroup/i.test(xmlTag))   type = 'Ultimate';
  else if (/ConcurrencyThreadGroup/i.test(xmlTag)) type = 'Concurrency';
  else if (/ArrivalsThreadGroup/i.test(xmlTag))    type = 'Arrivals';

  const numThreads = parseInt(getProp(nodeChildren, 'ThreadGroup.num_threads') || getProp(nodeChildren, 'TargetLevel') || '1');
  const rampTime   = parseInt(getProp(nodeChildren, 'ThreadGroup.ramp_time')   || getProp(nodeChildren, 'RampUp')       || '0');
  const loops      = getProp(nodeChildren, 'LoopController.loops') || '-1';
  const scheduler  = getProp(nodeChildren, 'ThreadGroup.scheduler') === 'true';
  const duration   = parseInt(getProp(nodeChildren, 'ThreadGroup.duration')    || getProp(nodeChildren, 'Hold')         || '0');
  const delay      = parseInt(getProp(nodeChildren, 'ThreadGroup.delay')       || '0');
  const startCount = parseInt(getProp(nodeChildren, 'Start users count')       || '0');
  const startPeriod= parseInt(getProp(nodeChildren, 'Start users period')      || '0');
  const stopCount  = parseInt(getProp(nodeChildren, 'Stop users count')        || '0');

  return {
    name,
    type,
    virtualUsers:  numThreads,
    rampUpSec:     rampTime,
    holdSec:       scheduler || duration > 0 ? duration : (loops === '-1' ? 300 : 0),
    rampDownSec:   type === 'Stepping' ? (stopCount > 0 ? startPeriod : 0) : 0,
    iterations:    loops === '-1' || loops === '' ? 'Infinite' : loops,
    startDelaySec: delay,
    stepSize:      type === 'Stepping' ? startCount : undefined,
    stepDuration:  type === 'Stepping' ? startPeriod : undefined,
    enabled:       attrs['@_enabled'] !== 'false',
  };
}

// ─── Parse a single HTTPSamplerProxy → normalized request object ──────────────
function parseSampler(nodeChildren, attrs, defaults, reqHeaders, auth,
                      extractors, preScripts, postScripts, folder, thinkTimeSec) {
  if (attrs['@_enabled'] === 'false') return null;

  const name       = attrs['@_testname'] || 'Request';
  const method     = getProp(nodeChildren, 'HTTPSampler.method')          || 'GET';
  const domain     = getProp(nodeChildren, 'HTTPSampler.domain')          || defaults.domain;
  const port       = getProp(nodeChildren, 'HTTPSampler.port')            || defaults.port;
  const protocol   = getProp(nodeChildren, 'HTTPSampler.protocol')        || defaults.protocol || 'http';
  const rawPath    = getProp(nodeChildren, 'HTTPSampler.path')            || '/';
  const postBodyRaw= getProp(nodeChildren, 'HTTPSampler.postBodyRaw');
  const encoding   = getProp(nodeChildren, 'HTTPSampler.contentEncoding') || defaults.contentEncoding || '';
  const follow     = getProp(nodeChildren, 'HTTPSampler.follow_redirects')|| defaults.followRedirects || 'true';

  // Per-request proxy (Advanced tab) — falls back to global defaults from
  // HTTP Request Defaults ConfigTestElement
  const proxyHost  = getProp(nodeChildren, 'HTTPSampler.proxyHost') || defaults.proxyHost || '';
  const proxyPort  = getProp(nodeChildren, 'HTTPSampler.proxyPort') || defaults.proxyPort || '';
  const proxyUser  = getProp(nodeChildren, 'HTTPSampler.proxyUser') || defaults.proxyUser || '';
  const proxyPass  = getProp(nodeChildren, 'HTTPSampler.proxyPass') || defaults.proxyPass || '';

  const portStr = port && port !== '80' && port !== '443' ? `:${port}` : '';
  const base    = domain ? `${protocol}://${domain}${portStr}` : (defaults.baseUrl || '');
  const path    = rawPath.startsWith('/') ? rawPath : '/' + rawPath;
  const url     = convertVars(base + path);

  // ── Body ─────────────────────────────────────────────────────────────────
  let body = null;
  const argsEl = findChildByAttr(nodeChildren, 'elementProp', '@_name', 'HTTPsampler.Arguments');
  if (argsEl) {
    const collItem = findChild(getChildren(argsEl), 'collectionProp');
    const argItems = collItem ? findChildren(getChildren(collItem), 'elementProp') : [];

    if (postBodyRaw === 'true') {
      const rawVal = argItems[0] ? getProp(getChildren(argItems[0]), 'Argument.value') : '';
      // JMX sometimes stores literal backslash-r-backslash-n sequences (4 chars)
      // instead of actual CRLF. Normalise so generated scripts send real newlines.
      const normVal = rawVal.replace(/\\r\\n/g, '\r\n').replace(/\\n/g, '\n').replace(/\\t/g, '\t');
      body = { mode: 'raw', raw: convertVars(normVal), options: { raw: { language: 'json' } } };
    } else if (argItems.length > 0) {
      body = {
        mode: 'urlencoded',
        urlencoded: argItems
          .filter(a => getAttrs(a)['@_enabled'] !== 'false')
          .map(a => {
            const ac = getChildren(a);
            return {
              key:      convertVars(getProp(ac, 'Argument.name')),
              value:    convertVars(getProp(ac, 'Argument.value')),
              disabled: false,
            };
          }),
      };
    }
  }

  // ── Pre/post scripts ──────────────────────────────────────────────────────
  // Stored in two ways:
  //   req.tests[] — standard Postman/Bruno format for script scanning / JWT detection
  //   req.preScripts[] / req.postScripts[] — { code, lang } for code generation
  const tests = [];
  for (const sc of preScripts) {
    // sc = { code, lang }
    tests.push({ listen: 'prerequest', script: { exec: sc.code }, lang: sc.lang });
  }
  for (const sc of postScripts) {
    tests.push({ listen: 'test', script: { exec: sc.code }, lang: sc.lang });
  }

  return {
    name,
    method:    method.toUpperCase(),
    url,
    folder,
    depth:     folder ? folder.split('/').length : 0,
    headers:   reqHeaders.map(h => ({ key: h.key, value: convertVars(h.value), disabled: false })),
    body,
    auth,
    tests,
    preScripts:  preScripts,   // [{ code, lang }] — available for code generation
    postScripts: postScripts,  // [{ code, lang }]
    extractors: extractors.map(ext => ({ listen: 'extractor', extractor: ext })),
    thinkTime:  thinkTimeSec,
    proxyConfig: proxyHost ? { host: proxyHost, port: proxyPort, username: proxyUser, password: proxyPass } : null,
    encoding,
    followRedirects: follow !== 'false',
    variables:  {},
    vars:       {},
  };
}

// ─── Tag classification sets ──────────────────────────────────────────────────
const THREAD_GROUP_TAGS = new Set([
  'ThreadGroup', 'SetupThreadGroup', 'PostThreadGroup',
]);

// Logic/container controllers that are transparent (flatten their children)
const CONTROLLER_TAGS = new Set([
  'SimpleController', 'GenericSampler', 'InterleaveController',
  'RandomOrderController', 'ThroughputController',
  'IfController', 'LoopController', 'ForEachController',
  'WhileController', 'RuntimeController', 'OnceOnlyController',
  'SwitchController', 'CriticalSectionController',
  'IncludeController',
  // ModuleController references a named test fragment elsewhere in the plan.
  // Full resolution (finding the target fragment by name) is not supported —
  // we flatten its inline children as a best-effort conversion.
  'ModuleController',
  // TestFragmentController defines reusable fragments (always enabled="false" in JMX).
  // Must be in this set so walkHashTree recurses into its children and collects requests.
  'TestFragmentController',
]);

// Extractor tags that belong inside a request's hashTree
const EXTRACTOR_TAGS = new Set([
  'RegexExtractor', 'BoundaryExtractor', 'JSONPathExtractor',
  'XPathExtractor', 'XPath2Extractor', 'HtmlExtractor', 'JMESPathExtractor',
  'com.atlantbh.jmeter.plugins.jsonutils.jsonpathextractor.JSONPathExtractor',
]);

// Timer tags (all delay flavours)
const TIMER_TAGS = new Set([
  'ConstantTimer', 'GaussianRandomTimer', 'UniformRandomTimer',
  'ConstantThroughputTimer', 'PoissonRandomTimer', 'SynchronizingTimer',
  'BeanShellTimer', 'JSR223Timer',
]);

// ─── Walk a hashTree children array ──────────────────────────────────────────
// context = {
//   defaults, globalHeaders, auth, folder,
//   csvDataSets, threadGroups, thinkTimeSec, variables
// }
function walkHashTree(nodeChildren, context, results) {
  const children       = flattenHashTree(nodeChildren);
  let pendingThinkTime = context.thinkTimeSec || 0;

  for (const { tag, node, attrs, childHashTree } of children) {

    // Skip any element the user explicitly disabled in JMeter.
    // Exception: TestFragmentController is *always* stored with enabled="false" by
    // design — it's a library fragment meant to be called via ModuleController.
    // Skipping it would drop all requests inside, causing "No HTTP requests found".
    if (attrs['@_enabled'] === 'false' && tag !== 'TestFragmentController') continue;

    // ── HTTP Request Defaults (ConfigTestElement) ─────────────────────────
    if (tag === 'ConfigTestElement') {
      const d = parseHttpDefaults(node);
      if (d.domain) {
        // Update context defaults in-place so nested elements see the change
        Object.assign(context.defaults, {
          domain:          d.domain,
          port:            d.port,
          protocol:        d.protocol || context.defaults.protocol || 'http',
          baseUrl:         buildBaseUrl(d.domain, d.port, d.protocol || context.defaults.protocol),
          contentEncoding: d.contentEncoding || context.defaults.contentEncoding,
          followRedirects: d.followRedirects  || context.defaults.followRedirects,
        });
      }
      if (d.proxyHost) {
        Object.assign(context.defaults, {
          proxyHost: d.proxyHost,
          proxyPort: d.proxyPort,
          proxyUser: d.proxyUser,
          proxyPass: d.proxyPass,
        });
        // Also add to variables so generators' detectProxyConfig() can find it
        context.variables['proxyHost'] = d.proxyHost;
        if (d.proxyPort) context.variables['proxyPort'] = d.proxyPort;
        if (d.proxyUser) context.variables['proxyUser'] = d.proxyUser;
      }
      continue;
    }

    // ── User Defined Variables at ThreadGroup or TestPlan level ──────────
    // JMeter stores these as <Arguments testname="User Defined Variables">
    if (tag === 'Arguments') {
      const collItem = findChild(node, 'collectionProp');
      if (collItem) {
        for (const elem of findChildren(getChildren(collItem), 'elementProp')) {
          const ec = getChildren(elem);
          const k  = getProp(ec, 'Argument.name');
          const v  = convertVars(getProp(ec, 'Argument.value'));
          if (k) {
            context.variables[k] = v;  // last write wins (JMeter-compatible)
            // Track TG-local vars separately for multi-script scoping.
            // Variables defined at TestPlan level (threadGroupIndex = -1) are
            // global; those inside a TG walk are TG-local.
            if (context.threadGroupIndex >= 0 && context.tgVars) {
              if (!context.tgVars.has(context.threadGroupIndex)) {
                context.tgVars.set(context.threadGroupIndex, {});
              }
              context.tgVars.get(context.threadGroupIndex)[k] = v;
            }
          }
        }
      }
      continue;
    }

    // ── Thread Groups ─────────────────────────────────────────────────────
    // Recurse with SCOPED copies of defaults and headers so that config
    // inside one thread group does not bleed to sibling thread groups.
    if (THREAD_GROUP_TAGS.has(tag) ||
        tag.includes('ThreadGroup') ||
        /ThreadGroup/i.test(tag)) {
      const tg = parseThreadGroup(node, attrs, tag);
      if (tg) context.threadGroups.push(tg);
      const tgIndex = context.threadGroups.length - 1;
      const tgName  = tg ? tg.name : (attrs['@_testname'] || tag);
      const tgType  = tg ? tg.type : 'Standard';
      if (childHashTree.length) {
        walkHashTree(childHashTree, {
          ...context,
          defaults:         { ...context.defaults },     // shallow copy — prevents back-leak
          globalHeaders:    [...context.globalHeaders],  // copy — per-TG scope
          folder:           '',
          threadGroupIndex: tgIndex,
          threadGroupName:  tgName,
          threadGroupType:  tgType,
        }, results);
      }
      continue;
    }

    // ── LoopController — preserve loop metadata for request tagging ────────
    if (tag === 'LoopController') {
      const loops    = parseInt(getProp(node, 'LoopController.loops') || '-1');
      const loopName = attrs['@_testname'] || 'Loop';
      if (childHashTree.length) {
        walkHashTree(childHashTree, {
          ...context,
          loopCount: loops === -1 ? 'Infinite' : loops,
          loopName,
          folder: context.folder ? `${context.folder}/${loopName}` : loopName,
        }, results);
      }
      continue;
    }

    // ── IfController — preserve condition for request tagging ─────────────
    if (tag === 'IfController') {
      const cond   = convertVars(getProp(node, 'IfController.condition') || '');
      const ifName = attrs['@_testname'] || 'If';
      if (childHashTree.length) {
        walkHashTree(childHashTree, {
          ...context,
          ifCondition: cond,
          folder: context.folder ? `${context.folder}/${ifName}` : ifName,
        }, results);
      }
      continue;
    }

    // ── ForEachController — tag with iteration variable ───────────────────
    if (tag === 'ForEachController') {
      const inputVal = convertVars(getProp(node, 'ForeachController.inputVal') || '');
      const retVal   = getProp(node, 'ForeachController.returnVal') || 'item';
      const feName   = attrs['@_testname'] || 'ForEach';
      if (childHashTree.length) {
        walkHashTree(childHashTree, {
          ...context,
          forEachInput: inputVal,
          forEachVar:   retVal,
          folder: context.folder ? `${context.folder}/${feName}` : feName,
        }, results);
      }
      continue;
    }

    // ── WhileController ───────────────────────────────────────────────────
    if (tag === 'WhileController') {
      const cond      = convertVars(getProp(node, 'WhileController.condition') || '');
      const whileName = attrs['@_testname'] || 'While';
      if (childHashTree.length) {
        walkHashTree(childHashTree, {
          ...context,
          whileCondition: cond,
          folder: context.folder ? `${context.folder}/${whileName}` : whileName,
        }, results);
      }
      continue;
    }

    // ── AuthManager ───────────────────────────────────────────────────────
    if (tag === 'AuthManager') {
      context.auth = parseAuthManager(node);
      continue;
    }

    // ── HeaderManager at non-request scope (test-plan or thread-group) ────
    // Per-request HeaderManagers are handled inside the HTTPSamplerProxy block.
    if (tag === 'HeaderManager') {
      const hdrs = parseHeaderManager(node);
      for (const h of hdrs) {
        const existing = context.globalHeaders.find(g => g.key === h.key);
        if (existing) existing.value = h.value;  // later definition overrides
        else context.globalHeaders.push(h);
      }
      continue;
    }

    // ── CSVDataSet ────────────────────────────────────────────────────────
    if (tag === 'CSVDataSet') {
      const csv = parseCsvDataSet(node);
      // -1 = TestPlan-level (global, applies to ALL thread groups)
      // >=0 = scoped to that specific thread group
      csv.threadGroupIndex = context.threadGroupIndex ?? -1;
      context.csvDataSets.push(csv);
      continue;
    }

    // ── Timers ────────────────────────────────────────────────────────────
    if (TIMER_TAGS.has(tag)) {
      pendingThinkTime = parseTimerMs(node);
      continue;
    }

    // ── TransactionController → becomes a folder/group prefix ─────────────
    if (tag === 'TransactionController') {
      const txName   = attrs['@_testname'] || 'Transaction';
      const txFolder = context.folder ? `${context.folder}/${txName}` : txName;
      if (childHashTree.length) {
        walkHashTree(childHashTree, { ...context, folder: txFolder }, results);
      }
      continue;
    }

    // ── Logic / container controllers — transparent pass-through ──────────
    if (CONTROLLER_TAGS.has(tag)) {
      if (childHashTree.length) {
        walkHashTree(childHashTree, { ...context }, results);
      }
      continue;
    }

    // ── HTTPSamplerProxy — the main request ───────────────────────────────
    if (tag === 'HTTPSamplerProxy') {
      // Start with a copy of the thread-group-level global headers
      const reqHeaders    = [...context.globalHeaders];
      const reqExtractors = [];
      const preScripts    = [];
      const postScripts   = [];

      // Process the request's OWN hashTree children in document order.
      // With preserveOrder:true these are guaranteed correct.
      for (const rc of flattenHashTree(childHashTree)) {

        // Skip disabled child elements (extractors, pre/post-processors, headers)
        if (rc.attrs['@_enabled'] === 'false') continue;

        // Per-request HeaderManager — local headers override global headers
        if (rc.tag === 'HeaderManager') {
          const hdrs = parseHeaderManager(rc.node);
          for (const h of hdrs) {
            const existing = reqHeaders.find(g => g.key === h.key);
            if (existing) existing.value = h.value;   // override
            else reqHeaders.push(h);                   // add new
          }
        }

        // All extractor types
        else if (EXTRACTOR_TAGS.has(rc.tag)) {
          reqExtractors.push(...parseExtractors([rc]));
        }

        // Pre-processors (run before the request)
        else if (rc.tag === 'JSR223PreProcessor' || rc.tag === 'BeanShellPreProcessor') {
          const sc = parseScriptNode(rc.node, rc.attrs);
          if (sc) {
            preScripts.push(sc);  // sc = { code, lang }
            for (const v of extractScriptSetVars(sc.code)) {
              if (!(v in context.variables)) context.variables[v] = '';
            }
          }
        }

        // Post-processors (run after the request, parse response, set vars)
        else if (rc.tag === 'JSR223PostProcessor' || rc.tag === 'BeanShellPostProcessor') {
          const sc = parseScriptNode(rc.node, rc.attrs);
          if (sc) {
            postScripts.push(sc);  // sc = { code, lang }
            for (const v of extractScriptSetVars(sc.code)) {
              if (!(v in context.variables)) context.variables[v] = '';
            }
          }
        }

        // Timers inside a request's hashTree (wait after response before next)
        else if (TIMER_TAGS.has(rc.tag)) {
          pendingThinkTime = Math.max(pendingThinkTime, parseTimerMs(rc.node));
        }

        // ResponseAssertion, ResultCollector, DebugSampler — no conversion needed
      }

      const req = parseSampler(
        node, attrs,
        context.defaults,
        reqHeaders,
        context.auth,
        reqExtractors,
        preScripts, postScripts,
        context.folder,
        pendingThinkTime
      );
      if (req) {
        // Stamp thread group membership (for multi-script generation)
        req.threadGroupIndex = context.threadGroupIndex ?? -1;
        req.threadGroupName  = context.threadGroupName  ?? '';
        req.threadGroupType  = context.threadGroupType  ?? 'Standard';
        // Stamp loop / condition context (for comment generation in scripts)
        if (context.loopCount   !== undefined) req.loopCount    = context.loopCount;
        if (context.loopName    !== undefined) req.loopName     = context.loopName;
        if (context.ifCondition !== undefined) req.ifCondition  = context.ifCondition;
        if (context.forEachInput !== undefined) {
          req.forEachInput = context.forEachInput;
          req.forEachVar   = context.forEachVar;
        }
        if (context.whileCondition !== undefined) req.whileCondition = context.whileCondition;
        results.requests.push(req);
      }
      pendingThinkTime = 0;
      continue;
    }

    // ── Standalone script samplers ────────────────────────────────────────
    if (tag === 'JSR223Sampler' || tag === 'BeanShellSampler') {
      // enabled="false" already caught by the top-of-loop guard above
      const sc = parseScriptNode(node, attrs);
      if (sc) {
        results.standaloneScripts.push({
          name:             attrs['@_testname'] || tag,
          folder:           context.folder,
          script:           sc.code,
          lang:             sc.lang,
          threadGroupIndex: context.threadGroupIndex ?? -1,
          threadGroupName:  context.threadGroupName  ?? '',
          threadGroupType:  context.threadGroupType  ?? 'Standard',
        });
        // Capture variables set in standalone script samplers
        for (const v of extractScriptSetVars(sc.code)) {
          if (!(v in context.variables)) context.variables[v] = '';
        }
      }
      continue;
    }

    // Everything else (ResultCollector, DebugSampler, DNSCacheManager, etc.) — skip
  }
}

// ─── Build normalized collection ──────────────────────────────────────────────
function buildCollection(name, requests, csvDataSets, variables, defaults) {
  // All collected variables → collection.variable array
  const variable = Object.entries(variables || {})
    .filter(([k]) => k && k.trim())
    .map(([k, v]) => ({ key: k, value: v, disabled: false }));

  // Proxy from HTTP Request Defaults (if found)
  const proxy = (defaults && defaults.proxyHost) ? {
    host:     defaults.proxyHost,
    port:     defaults.proxyPort  || '',
    username: defaults.proxyUser  || '',
    password: defaults.proxyPass  || '',
  } : null;

  return {
    info:              { name, schema: '', type: 'jmeter' },
    item:              requests,
    variable,
    csvDataSets,
    event:             [],
    collectionHeaders: [],
    collectionAuth:    null,
    config:            { proxy },
  };
}

// ─── Main parser class ────────────────────────────────────────────────────────
class JmxParser {
  constructor(inputFile, options = {}) {
    this.inputFile         = inputFile;
    this.options           = options;
    this.collection        = null;
    this.metadata          = null;
    this.threadGroups      = [];
    this.csvDataSets       = [];
    this.standaloneScripts = [];
    // Map<tgIndex, {varName: value}> — tracks variables defined INSIDE each
    // thread group (as opposed to TestPlan-level globals).  Used by
    // jmxConverter._convertMulti() to pass only relevant vars to each TG's
    // generator, preventing TG2 variables appearing in TG1's script.
    this.threadGroupVars   = new Map();
  }

  async parse() {
    const xml    = await fs.readFile(this.inputFile, 'utf8');
    const parser = makeXmlParser();
    const docArr = parser.parse(xml);

    // docArr is an ordered array; find the root jmeterTestPlan element
    const jmxPlanItem = docArr.find(item => getTag(item) === 'jmeterTestPlan');
    if (!jmxPlanItem) throw new Error('Not a valid JMeter .jmx file (missing <jmeterTestPlan>)');

    const jmxVersion     = getAttrs(jmxPlanItem)['@_version'] || '1.2';
    const jmxPlanChildren = getChildren(jmxPlanItem);

    // jmeterTestPlan has exactly one child: <hashTree>
    const rootHtItem = jmxPlanChildren.find(c => getTag(c) === 'hashTree');
    if (!rootHtItem) throw new Error('JMX file appears to be empty (no root hashTree)');

    const rootHtChildren = getChildren(rootHtItem);

    // Flatten root to get TestPlan element + its paired hashTree (the main level)
    const flatRoot      = flattenHashTree(rootHtChildren);
    const testPlanEntry = flatRoot.find(e => e.tag === 'TestPlan');
    const testPlanAttrs = testPlanEntry?.attrs || {};
    const testPlanNode  = testPlanEntry?.node  || [];
    // testPlanEntry.childHashTree = the "main" level containing ThreadGroups etc.
    const mainHashTree  = testPlanEntry?.childHashTree || rootHtChildren;

    const planName = testPlanAttrs['@_testname'] ||
                     this.options.name           ||
                     path.basename(this.inputFile, '.jmx');

    // ── TestPlan-level User Defined Variables ──────────────────────────────
    // Stored as <elementProp name="TestPlan.user_defined_variables">
    const planVars = {};
    const udtEl = findChildByAttr(
      testPlanNode, 'elementProp', '@_name', 'TestPlan.user_defined_variables'
    );
    if (udtEl) {
      const collItem = findChild(getChildren(udtEl), 'collectionProp');
      if (collItem) {
        for (const elem of findChildren(getChildren(collItem), 'elementProp')) {
          const ec = getChildren(elem);
          const k  = getProp(ec, 'Argument.name');
          const v  = convertVars(getProp(ec, 'Argument.value'));
          if (k) planVars[k] = v;
        }
      }
    }

    // Merge plan vars with any caller-supplied variables (caller wins)
    const allVars = { ...planVars, ...(this.options.variables || {}) };

    const results = { requests: [], standaloneScripts: [] };

    const context = {
      defaults: {
        domain: '', port: '', protocol: 'http', baseUrl: '',
        proxyHost: '', proxyPort: '', proxyUser: '', proxyPass: '',
        contentEncoding: '', followRedirects: 'true',
      },
      globalHeaders: [],
      auth:          null,
      folder:        '',
      csvDataSets:   this.csvDataSets,
      threadGroups:  this.threadGroups,
      thinkTimeSec:  0,
      variables:     allVars,  // shared mutable map — accumulates across all scopes
      tgVars:        this.threadGroupVars, // Map<tgIndex,{k:v}> — per-TG UDV tracking
    };

    walkHashTree(mainHashTree, context, results);

    // Collect diagnostic tag names for a better error message if 0 requests found
    if (!results.requests.length) {
      const seenTags = new Set();
      const scanTags = (nodes) => {
        for (const { tag, childHashTree } of flattenHashTree(nodes)) {
          if (tag && tag !== 'hashTree') seenTags.add(tag);
          if (childHashTree && childHashTree.length) scanTags(childHashTree);
        }
      };
      scanTags(mainHashTree);
      this._diagnosticTags = [...seenTags].sort();
    }

    this.standaloneScripts = results.standaloneScripts;

    this.collection = buildCollection(
      planName,
      results.requests,
      this.csvDataSets,
      context.variables,
      context.defaults
    );

    this.metadata = {
      version:       jmxVersion,
      name:          planName,
      type:          'jmeter',
      totalRequests: results.requests.length,
      threadGroups:  this.threadGroups.length,
      csvDataSets:   this.csvDataSets.length,
    };

    return results.requests;
  }

  getMetadata()          { return this.metadata; }
  getCollection()        { return this.collection; }
  getThreadGroups()      { return this.threadGroups; }
  getCsvDataSets()       { return this.csvDataSets; }
  getStandaloneScripts() { return this.standaloneScripts; }
  getDiagnosticTags()    { return this._diagnosticTags || []; }
  /**
   * Returns variables defined INSIDE thread group tgIndex (not TestPlan-level globals).
   * Used by jmxConverter._convertMulti() to build per-TG environment variable maps.
   */
  getThreadGroupVars(tgIndex) { return this.threadGroupVars.get(tgIndex) || {}; }

  /**
   * Returns a Map<threadGroupName, Request[]> for multi-script generation.
   * Requests with no thread group affinity are grouped under '__default__'.
   */
  getThreadGroupRequests() {
    const map      = new Map();
    const requests = this.collection?.item || [];
    for (const req of requests) {
      const key = (req.threadGroupName && req.threadGroupName !== '')
        ? req.threadGroupName : '__default__';
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(req);
    }
    return map;
  }
}

module.exports = JmxParser;
