/**
 * JMeter JMX Parser
 * Parses .jmx XML files and outputs the same normalized request format
 * as brunoParser.js — ready for AdvancedScriptGenerator / WebHttpScriptGenerator.
 *
 * JMX XML structure uses alternating element / hashTree pairs:
 *   <HTTPSamplerProxy testname="Login">...</HTTPSamplerProxy>
 *   <hashTree>
 *     <HeaderManager>...</HeaderManager>  ← belongs to Login
 *     <RegexExtractor>...</RegexExtractor> ← belongs to Login
 *   </hashTree>
 */

'use strict';

const fs   = require('fs').promises;
const path = require('path');
const { XMLParser } = require('fast-xml-parser');

// ─── Variable conversion ──────────────────────────────────────────────────────
// JMeter: ${varName}  →  our internal: {{varName}}
// JMeter functions like ${__RandomString(...)} are stubbed
function convertVars(str) {
  if (!str || typeof str !== 'string') return str;
  // JMeter built-in functions → leave as-is but wrapped in comment hint
  str = str.replace(/\$\{__[^}]+\}/g, match => `{{/* ${match} */}}`);
  // Regular vars
  str = str.replace(/\$\{([^}]+)\}/g, '{{$1}}');
  return str;
}

function convertVarsInObj(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(convertVarsInObj);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    out[k] = typeof v === 'string' ? convertVars(v) : convertVarsInObj(v);
  }
  return out;
}

// ─── XML parser setup ─────────────────────────────────────────────────────────
function makeXmlParser() {
  return new XMLParser({
    ignoreAttributes:          false,
    attributeNamePrefix:       '@_',
    allowBooleanAttributes:    true,
    parseAttributeValue:       false,
    trimValues:                true,
    isArray: (name) => [
      'hashTree', 'stringProp', 'boolProp', 'longProp', 'intProp',
      'elementProp', 'collectionProp', 'HTTPSamplerProxy',
      'HeaderManager', 'RegexExtractor', 'BoundaryExtractor',
      'JSONPathExtractor', 'XPathExtractor', 'ResponseAssertion',
      'JSR223PreProcessor', 'JSR223PostProcessor',
      'BeanShellPreProcessor', 'BeanShellPostProcessor',
      'BeanShellSampler', 'JSR223Sampler',
      'CSVDataSet', 'ConstantTimer', 'GaussianRandomTimer',
      'UniformRandomTimer', 'TransactionController',
      'SetupThreadGroup', 'PostThreadGroup', 'ThreadGroup',
      'AuthManager', 'CookieManager',
    ].includes(name)
  });
}

// ─── Property helpers ─────────────────────────────────────────────────────────
function getProp(node, name) {
  for (const key of ['stringProp', 'boolProp', 'longProp', 'intProp']) {
    const arr = node[key];
    if (!Array.isArray(arr)) continue;
    const found = arr.find(p => p['@_name'] === name);
    if (found !== undefined) {
      const val = found['#text'] ?? found;
      return typeof val === 'object' ? '' : String(val);
    }
  }
  return '';
}

function getChildByTag(node, tag) {
  return node[tag]?.[0] ?? node[tag] ?? null;
}

function getChildrenByTag(node, tag) {
  const v = node[tag];
  if (!v) return [];
  return Array.isArray(v) ? v : [v];
}

// ─── Build base URL from HTTP defaults ────────────────────────────────────────
function buildBaseUrl(defaultDomain, defaultPort, defaultProtocol) {
  if (!defaultDomain) return '';
  const proto  = defaultProtocol || 'http';
  const portStr = defaultPort && defaultPort !== '80' && defaultPort !== '443' ? `:${defaultPort}` : '';
  return `${proto}://${defaultDomain}${portStr}`;
}

// ─── Parse a single HTTPSamplerProxy node ─────────────────────────────────────
function parseSampler(sampler, defaults, globalHeaders, auth, extractors, preScripts, postScripts, folder, thinkTimeSec) {
  const enabled = sampler['@_enabled'];
  if (enabled === 'false' || enabled === false) return null;

  const name     = sampler['@_testname'] || 'Request';
  const method   = getProp(sampler, 'HTTPSampler.method') || 'GET';
  const domain   = getProp(sampler, 'HTTPSampler.domain')   || defaults.domain;
  const port     = getProp(sampler, 'HTTPSampler.port')     || defaults.port;
  const protocol = getProp(sampler, 'HTTPSampler.protocol') || defaults.protocol || 'http';
  const rawPath  = getProp(sampler, 'HTTPSampler.path')     || '/';
  const postBodyRaw = getProp(sampler, 'HTTPSampler.postBodyRaw');

  // Build URL
  const portStr = port && port !== '80' && port !== '443' ? `:${port}` : '';
  const base    = domain ? `${protocol}://${domain}${portStr}` : (defaults.baseUrl || '');
  const url     = convertVars(base + rawPath);

  // ── Body ─────────────────────────────────────────────────────────────────
  let body = null;
  const argsEl = sampler['elementProp']
    ? (Array.isArray(sampler['elementProp']) ? sampler['elementProp'] : [sampler['elementProp']])
        .find(e => e['@_name'] === 'HTTPsampler.Arguments')
    : null;

  if (argsEl) {
    const collProp = argsEl['collectionProp'];
    const coll     = Array.isArray(collProp) ? collProp[0] : collProp;
    const argItems = coll ? (Array.isArray(coll['elementProp']) ? coll['elementProp'] : (coll['elementProp'] ? [coll['elementProp']] : [])) : [];

    if (postBodyRaw === 'true' || postBodyRaw === true) {
      // Raw body (JSON, XML, etc.)
      const rawVal = argItems[0] ? getProp(argItems[0], 'Argument.value') : '';
      body = { mode: 'raw', raw: convertVars(rawVal), options: { raw: { language: 'json' } } };
    } else if (argItems.length > 0) {
      // URL-encoded form
      body = {
        mode: 'urlencoded',
        urlencoded: argItems
          .filter(a => a['@_enabled'] !== 'false')
          .map(a => ({
            key:   convertVars(getProp(a, 'Argument.name')),
            value: convertVars(getProp(a, 'Argument.value')),
            disabled: false
          }))
      };
    }
  }

  // ── Correlations/extractors → stored as tests for later processing ────────
  const corrTests = extractors.map(ext => ({
    listen: 'extractor',
    extractor: ext
  }));

  // ── Pre/Post scripts ──────────────────────────────────────────────────────
  const tests = [];
  for (const sc of preScripts) {
    tests.push({ listen: 'prerequest', script: { exec: sc } });
  }
  for (const sc of postScripts) {
    tests.push({ listen: 'test', script: { exec: sc } });
  }

  return {
    name,
    method: method.toUpperCase(),
    url,
    folder,
    depth:   folder ? folder.split('/').length : 0,
    headers: globalHeaders.map(h => ({ key: h.key, value: convertVars(h.value), disabled: false })),
    body,
    auth,
    tests,
    extractors: corrTests,    // JMX-explicit correlations
    thinkTime:  thinkTimeSec, // from ConstantTimer before this request
    variables:  {},
    vars:       {}
  };
}

// ─── Parse extractors in a request's hashTree ─────────────────────────────────
function parseExtractors(hashTreeChildren) {
  const extractors = [];

  for (const child of hashTreeChildren) {
    const tag = child['@_tag'] || child['__tag'];
    // RegexExtractor
    if (child['RegexExtractor'] || (child['@_testclass'] === 'RegexExtractor')) {
      const n = child['RegexExtractor']?.[0] || child;
      extractors.push({
        type:        'regex',
        name:        getProp(n, 'RegexExtractor.refname'),
        regex:       getProp(n, 'RegexExtractor.regex'),
        template:    getProp(n, 'RegexExtractor.template') || '$1$',
        matchNumber: getProp(n, 'RegexExtractor.match_number') || '1',
        scope:       getProp(n, 'RegexExtractor.useHeaders') === 'true' ? 'headers' : 'body'
      });
    }
    // BoundaryExtractor
    if (child['BoundaryExtractor'] || (child['@_testclass'] === 'BoundaryExtractor')) {
      const n = child['BoundaryExtractor']?.[0] || child;
      extractors.push({
        type:         'boundary',
        name:         getProp(n, 'BoundaryExtractor.refname'),
        leftBoundary: getProp(n, 'BoundaryExtractor.lboundary'),
        rightBoundary:getProp(n, 'BoundaryExtractor.rboundary'),
        scope:        getProp(n, 'BoundaryExtractor.useHeaders') === 'true' ? 'headers' : 'body'
      });
    }
    // JSONPathExtractor
    if (child['JSONPathExtractor'] || (child['@_testclass'] === 'JSONPathExtractor')) {
      const n = child['JSONPathExtractor']?.[0] || child;
      extractors.push({
        type:      'jsonpath',
        name:      getProp(n, 'JSONPathExtractor.refname'),
        jsonPath:  getProp(n, 'JSONPathExtractor.jsonPathExpr')
      });
    }
    // XPathExtractor
    if (child['XPathExtractor'] || (child['@_testclass'] === 'XPathExtractor')) {
      const n = child['XPathExtractor']?.[0] || child;
      extractors.push({
        type:   'xpath',
        name:   getProp(n, 'XPathExtractor.refname'),
        xpath:  getProp(n, 'XPathExtractor.xpathQuery')
      });
    }
  }

  return extractors;
}

// ─── Parse headers from HeaderManager node ────────────────────────────────────
function parseHeaderManager(node) {
  const headers = [];
  const collProp = node['collectionProp'];
  const coll = Array.isArray(collProp) ? collProp[0] : collProp;
  if (!coll) return headers;
  const items = Array.isArray(coll['elementProp']) ? coll['elementProp'] : (coll['elementProp'] ? [coll['elementProp']] : []);
  for (const item of items) {
    const k = getProp(item, 'Header.name');
    const v = getProp(item, 'Header.value');
    if (k) headers.push({ key: k, value: v });
  }
  return headers;
}

// ─── Parse AuthManager ────────────────────────────────────────────────────────
function parseAuthManager(node) {
  const collProp = node['collectionProp'];
  const coll = Array.isArray(collProp) ? collProp[0] : collProp;
  if (!coll) return null;
  const items = Array.isArray(coll['elementProp']) ? coll['elementProp'] : (coll['elementProp'] ? [coll['elementProp']] : []);
  if (!items.length) return null;

  const first     = items[0];
  const username  = getProp(first, 'Authorization.username');
  const password  = getProp(first, 'Authorization.password');
  const domain    = getProp(first, 'Authorization.domain');
  const realm     = getProp(first, 'Authorization.realm');
  const url       = getProp(first, 'Authorization.url');
  const mechanism = getProp(first, 'Authorization.mechanism') || '';

  // Determine auth type
  let type = 'basic';
  if (/kerberos/i.test(mechanism)) type = 'kerberos';
  else if (/ntlm/i.test(mechanism) || domain) type = 'ntlm';
  else if (/digest/i.test(mechanism)) type = 'digest';

  return { type, username, password, domain, realm, url, hostport: extractHostPort(url) };
}

function extractHostPort(urlStr) {
  try {
    const u = new URL(urlStr || '');
    return u.host || urlStr;
  } catch { return urlStr || ''; }
}

// ─── Parse script content from JSR223 / BeanShell nodes ──────────────────────
function parseScriptNode(node) {
  const script = getProp(node, 'script') || getProp(node, 'BeanShell.query') || '';
  return script.trim() || null;
}

// ─── Parse timer delay (ms → seconds) ────────────────────────────────────────
function parseTimerMs(node) {
  const delay = getProp(node, 'ConstantTimer.delay') ||
                getProp(node, 'GaussianRandomTimer.delay') ||
                getProp(node, 'UniformRandomTimer.Maximum_Timer.delay') || '0';
  return parseFloat(delay) / 1000 || 0;
}

// ─── Parse CSVDataSet node ────────────────────────────────────────────────────
function parseCsvDataSet(node) {
  return {
    filename:      getProp(node, 'filename'),
    variableNames: getProp(node, 'variableNames'),
    delimiter:     getProp(node, 'delimiter') || ',',
    recycle:       getProp(node, 'recycle') !== 'false',
    shareMode:     getProp(node, 'shareMode') || 'All threads'
  };
}

// ─── Parse thread group parameters for WLM Excel ─────────────────────────────
function parseThreadGroup(node, xmlTag) {
  const name      = node['@_testname'] || 'Thread Group';
  const enabled   = node['@_enabled'];
  if (enabled === 'false') return null;

  // Determine type from XML element name
  let type = 'Standard';
  if (xmlTag === 'SetupThreadGroup')   type = 'SetUp';
  else if (xmlTag === 'PostThreadGroup') type = 'TearDown';
  else if (xmlTag && xmlTag.includes('SteppingThreadGroup'))   type = 'Stepping';
  else if (xmlTag && xmlTag.includes('UltimateThreadGroup'))   type = 'Ultimate';
  else if (xmlTag && xmlTag.includes('ConcurrencyThreadGroup')) type = 'Concurrency';
  else if (xmlTag && xmlTag.includes('ArrivalsThreadGroup'))    type = 'Arrivals';

  const numThreads = parseInt(getProp(node, 'ThreadGroup.num_threads') || getProp(node, 'TargetLevel') || '1');
  const rampTime   = parseInt(getProp(node, 'ThreadGroup.ramp_time')   || getProp(node, 'RampUp') || '0');
  const loops      = getProp(node, 'LoopController.loops') || '-1';
  const scheduler  = getProp(node, 'ThreadGroup.scheduler') === 'true';
  const duration   = parseInt(getProp(node, 'ThreadGroup.duration') || getProp(node, 'Hold') || '0');
  const delay      = parseInt(getProp(node, 'ThreadGroup.delay') || '0');

  // Stepping thread group extras
  const startCount = parseInt(getProp(node, 'Start users count') || '0');
  const startPeriod= parseInt(getProp(node, 'Start users period') || '0');
  const stopCount  = parseInt(getProp(node, 'Stop users count')  || '0');
  const flightTime = parseInt(getProp(node, 'flighttime') || '0');

  return {
    name,
    type,
    virtualUsers: numThreads,
    rampUpSec:    rampTime,
    holdSec:      scheduler || duration > 0 ? duration : (loops === '-1' ? 300 : 0),
    rampDownSec:  type === 'Stepping' ? (stopCount > 0 ? startPeriod : 0) : 0,
    iterations:   loops === '-1' || loops === '' ? 'Infinite' : loops,
    startDelaySec:delay,
    // Stepping extras
    stepSize:     type === 'Stepping' ? startCount : undefined,
    stepDuration: type === 'Stepping' ? startPeriod : undefined,
    enabled:      enabled !== 'false'
  };
}

// ─── Walk hashTree pairs recursively ─────────────────────────────────────────
// JMX structure: <Element .../> followed by <hashTree>children</hashTree>
// We process the parsed XML object's children as key/array pairs.
function walkHashTree(treeNode, context, results) {
  const {
    defaults,         // { domain, port, protocol, baseUrl }
    globalHeaders,    // accumulated HeaderManager entries
    auth,             // AuthManager result or null
    folder,           // current transaction/folder name
    csvDataSets,      // accumulated CSVDataSet entries
    threadGroups,     // accumulated thread group WLM info
    thinkTimeSec      // from ConstantTimer seen before a request
  } = context;

  // treeNode is the parsed hashTree content object.
  // We need to process element-hashTree pairs. Since fast-xml-parser
  // groups same-name siblings into arrays, we flatten all child nodes
  // in order by iterating known element types.

  // Collect children in document order using a flat pass
  const children = flattenHashTree(treeNode);

  let pendingThinkTime = thinkTimeSec || 0;

  for (let i = 0; i < children.length; i++) {
    const { tag, node } = children[i];
    const childHashTree = children[i + 1]?.tag === 'hashTree' ? children[i + 1].node : {};

    // ── HTTP Request Defaults ───────────────────────────────────────────────
    if (tag === 'ConfigTestElement') {
      const d = getProp(node, 'HTTPSampler.domain');
      const p = getProp(node, 'HTTPSampler.port');
      const proto = getProp(node, 'HTTPSampler.protocol');
      if (d) {
        context.defaults.domain   = d;
        context.defaults.port     = p;
        context.defaults.protocol = proto || 'http';
        context.defaults.baseUrl  = buildBaseUrl(d, p, proto);
      }
      continue;
    }

    // ── Thread Groups ───────────────────────────────────────────────────────
    if (['ThreadGroup','SetupThreadGroup','PostThreadGroup',
         'kg.apc.jmeter.threads.SteppingThreadGroup',
         'kg.apc.jmeter.threads.UltimateThreadGroup',
         'com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroup',
         'com.blazemeter.jmeter.threads.arrivals.ArrivalsThreadGroup',
         'com.blazemeter.jmeter.threads.arrivals.FreeFormArrivalsThreadGroup'
        ].includes(tag) || tag.includes('ThreadGroup')) {
      const tg = parseThreadGroup(node, tag);
      if (tg) threadGroups.push(tg);
      // Recurse into thread group's hashTree with same context
      if (childHashTree && Object.keys(childHashTree).length) {
        walkHashTree(childHashTree, { ...context, folder: '' }, results);
      }
      i++; // skip hashTree
      continue;
    }

    // ── AuthManager ─────────────────────────────────────────────────────────
    if (tag === 'AuthManager') {
      context.auth = parseAuthManager(node);
      continue;
    }

    // ── Global HeaderManager (at thread-group level, not inside a request) ──
    if (tag === 'HeaderManager' && children[i - 1]?.tag !== 'HTTPSamplerProxy') {
      const hdrs = parseHeaderManager(node);
      for (const h of hdrs) {
        if (!context.globalHeaders.find(g => g.key === h.key)) {
          context.globalHeaders.push(h);
        }
      }
      continue;
    }

    // ── CSVDataSet ──────────────────────────────────────────────────────────
    if (tag === 'CSVDataSet') {
      csvDataSets.push(parseCsvDataSet(node));
      continue;
    }

    // ── Timer ───────────────────────────────────────────────────────────────
    if (tag === 'ConstantTimer' || tag === 'GaussianRandomTimer' || tag === 'UniformRandomTimer') {
      pendingThinkTime = parseTimerMs(node);
      continue;
    }

    // ── TransactionController ───────────────────────────────────────────────
    if (tag === 'TransactionController') {
      const txName = node['@_testname'] || 'Transaction';
      if (childHashTree && Object.keys(childHashTree).length) {
        const txFolder = folder ? `${folder}/${txName}` : txName;
        walkHashTree(childHashTree, { ...context, folder: txFolder }, results);
      }
      i++;
      continue;
    }

    // ── Simple/Generic/Interleave controllers — transparent ─────────────────
    if (['SimpleController','GenericSampler','InterleaveController',
         'RandomOrderController','ThroughputController'].includes(tag)) {
      if (childHashTree && Object.keys(childHashTree).length) {
        walkHashTree(childHashTree, { ...context }, results);
      }
      i++;
      continue;
    }

    // ── IfController / LoopController / ForEachController — flatten ─────────
    if (['IfController','LoopController','ForEachController',
         'WhileController','RuntimeController','OnceOnlyController'].includes(tag)) {
      const condStr = getProp(node, 'IfController.condition') ||
                      getProp(node, 'LoopController.loops')   || '';
      const comment = `/* JMeter ${tag}${condStr ? ': ' + condStr : ''} — flattened into sequential */`;
      if (childHashTree && Object.keys(childHashTree).length) {
        walkHashTree(childHashTree, { ...context }, results);
        // Add the comment as a pre-script on the first request from this group
      }
      i++;
      continue;
    }

    // ── HTTPSamplerProxy (the main request) ─────────────────────────────────
    if (tag === 'HTTPSamplerProxy') {
      // Collect per-request headers, extractors, pre/post scripts from its hashTree
      const reqHeaders   = [...context.globalHeaders];
      const reqExtractors= [];
      const preScripts   = [];
      const postScripts  = [];

      if (childHashTree) {
        const reqChildren = flattenHashTree(childHashTree);
        for (const rc of reqChildren) {
          if (rc.tag === 'HeaderManager') {
            const hdrs = parseHeaderManager(rc.node);
            for (const h of hdrs) {
              const existing = reqHeaders.find(g => g.key === h.key);
              if (existing) existing.value = h.value;
              else reqHeaders.push(h);
            }
          }
          if (['RegexExtractor','BoundaryExtractor','JSONPathExtractor','XPathExtractor'].includes(rc.tag)) {
            const exts = parseExtractors([{ [rc.tag]: [rc.node] }]);
            reqExtractors.push(...exts);
          }
          if (['JSR223PreProcessor','BeanShellPreProcessor'].includes(rc.tag)) {
            const sc = parseScriptNode(rc.node);
            if (sc) preScripts.push(sc);
          }
          if (['JSR223PostProcessor','BeanShellPostProcessor'].includes(rc.tag)) {
            const sc = parseScriptNode(rc.node);
            if (sc) postScripts.push(sc);
          }
        }
      }

      // Merge auth: use request-level if set, else global
      const effectiveAuth = context.auth;

      const req = parseSampler(
        node,
        context.defaults,
        reqHeaders,
        effectiveAuth,
        reqExtractors,
        preScripts,
        postScripts,
        context.folder,
        pendingThinkTime
      );
      if (req) results.requests.push(req);
      pendingThinkTime = 0;

      i++; // skip the hashTree we already consumed
      continue;
    }

    // ── JSR223Sampler / BeanShellSampler — standalone script steps ──────────
    if (['JSR223Sampler','BeanShellSampler'].includes(tag)) {
      const sc = parseScriptNode(node);
      if (sc) {
        // Add as a synthetic "script" request with no URL
        results.standaloneScripts.push({
          name:   node['@_testname'] || tag,
          folder: context.folder,
          script: sc
        });
      }
      i++;
      continue;
    }

    // ── hashTree itself — skip (already consumed as pair) ───────────────────
    if (tag === 'hashTree') continue;
  }
}

// ─── Flatten a hashTree node into ordered [{tag, node}] entries ───────────────
// fast-xml-parser groups same-name siblings into arrays and loses ordering.
// We reconstruct order from the known element list (best effort).
// NOTE: For production quality, a SAX-style parser preserving order would be ideal.
// This approach handles the most common JMX structures correctly.
function flattenHashTree(treeNode) {
  if (!treeNode || typeof treeNode !== 'object') return [];

  const ORDERED_TAGS = [
    'ConfigTestElement',
    'ThreadGroup', 'SetupThreadGroup', 'PostThreadGroup',
    'kg.apc.jmeter.threads.SteppingThreadGroup',
    'kg.apc.jmeter.threads.UltimateThreadGroup',
    'com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroup',
    'com.blazemeter.jmeter.threads.arrivals.ArrivalsThreadGroup',
    'com.blazemeter.jmeter.threads.arrivals.FreeFormArrivalsThreadGroup',
    'AuthManager',
    'CookieManager',
    'HeaderManager',
    'CSVDataSet',
    'ConstantTimer', 'GaussianRandomTimer', 'UniformRandomTimer',
    'TransactionController',
    'SimpleController', 'GenericSampler',
    'InterleaveController', 'RandomOrderController', 'ThroughputController',
    'IfController', 'LoopController', 'ForEachController',
    'WhileController', 'RuntimeController', 'OnceOnlyController',
    'HTTPSamplerProxy',
    'JSR223Sampler', 'BeanShellSampler',
    'JSR223PreProcessor', 'BeanShellPreProcessor',
    'JSR223PostProcessor', 'BeanShellPostProcessor',
    'RegexExtractor', 'BoundaryExtractor',
    'JSONPathExtractor', 'XPathExtractor',
    'ResponseAssertion',
    'ResultCollector', 'DebugSampler',
    'hashTree'
  ];

  // Build a flat list. For each tag found in the node, interleave with hashTree.
  const result = [];
  const hashTrees = Array.isArray(treeNode['hashTree']) ? [...treeNode['hashTree']] : [];
  let htIdx = 0;

  for (const tag of ORDERED_TAGS) {
    const nodes = treeNode[tag];
    if (!nodes) continue;
    const arr = Array.isArray(nodes) ? nodes : [nodes];
    for (const n of arr) {
      result.push({ tag, node: n });
      // Pair with next hashTree
      if (hashTrees.length > htIdx) {
        result.push({ tag: 'hashTree', node: hashTrees[htIdx++] });
      } else {
        result.push({ tag: 'hashTree', node: {} });
      }
    }
  }

  return result;
}

// ─── Build normalized collection from JMX ────────────────────────────────────
function buildCollection(testPlanNode, requests, csvDataSets, variables) {
  const name = testPlanNode?.['@_testname'] || 'JMeter Test Plan';

  // Collect global user-defined variables
  const udtEl = testPlanNode?.['elementProp'];
  const udtArr = Array.isArray(udtEl) ? udtEl : (udtEl ? [udtEl] : []);
  const udtNode = udtArr.find(e => e['@_name'] === 'TestPlan.user_defined_variables');
  const collProp = udtNode?.['collectionProp'];
  const coll = Array.isArray(collProp) ? collProp[0] : collProp;
  const argItems = coll
    ? (Array.isArray(coll['elementProp']) ? coll['elementProp'] : (coll['elementProp'] ? [coll['elementProp']] : []))
    : [];

  const variable = argItems.map(a => ({
    key:   getProp(a, 'Argument.name'),
    value: convertVars(getProp(a, 'Argument.value')),
    disabled: false
  })).filter(v => v.key);

  // Merge with passed-in variables
  for (const [k, v] of Object.entries(variables || {})) {
    if (!variable.find(x => x.key === k)) variable.push({ key: k, value: v, disabled: false });
  }

  return {
    info: { name, schema: '', type: 'jmeter' },
    item: requests,
    variable,
    csvDataSets,
    event: [],
    collectionHeaders: [],
    collectionAuth: null,
    config: { proxy: null }
  };
}

// ─── Main parser class ────────────────────────────────────────────────────────
class JmxParser {
  constructor(inputFile, options = {}) {
    this.inputFile = inputFile;
    this.options   = options;
    this.collection = null;
    this.metadata   = null;
    this.threadGroups = [];
    this.csvDataSets  = [];
    this.standaloneScripts = [];
  }

  async parse() {
    const xml    = await fs.readFile(this.inputFile, 'utf8');
    const parser = makeXmlParser();
    const doc    = parser.parse(xml);

    const jmxPlan = doc['jmeterTestPlan'];
    if (!jmxPlan) throw new Error('Not a valid JMeter .jmx file (missing <jmeterTestPlan>)');

    const rootHashTree = Array.isArray(jmxPlan['hashTree'])
      ? jmxPlan['hashTree'][0]
      : jmxPlan['hashTree'];
    if (!rootHashTree) throw new Error('JMX file appears to be empty');

    // Find TestPlan node
    const testPlanNode = rootHashTree['TestPlan']?.[0] || rootHashTree['TestPlan'] || {};

    // Walk the second-level hashTree (contains ThreadGroups, etc.)
    const testHashTrees = Array.isArray(rootHashTree['hashTree'])
      ? rootHashTree['hashTree']
      : (rootHashTree['hashTree'] ? [rootHashTree['hashTree']] : []);

    const results = {
      requests:         [],
      standaloneScripts: []
    };

    const context = {
      defaults:       { domain: '', port: '', protocol: 'http', baseUrl: '' },
      globalHeaders:  [],
      auth:           null,
      folder:         '',
      csvDataSets:    this.csvDataSets,
      threadGroups:   this.threadGroups,
      thinkTimeSec:   0
    };

    // Process root-level config (HTTP Defaults, Auth at TestPlan level)
    for (const ht of testHashTrees) {
      walkHashTree(ht, context, results);
    }

    this.standaloneScripts = results.standaloneScripts;

    this.collection = buildCollection(
      testPlanNode,
      results.requests,
      this.csvDataSets,
      this.options.variables || {}
    );

    this.metadata = {
      version:       jmxPlan['@_version'] || '1.2',
      name:          testPlanNode['@_testname'] || path.basename(this.inputFile, '.jmx'),
      type:          'jmeter',
      totalRequests: results.requests.length,
      threadGroups:  this.threadGroups.length,
      csvDataSets:   this.csvDataSets.length
    };

    return results.requests;
  }

  getMetadata()     { return this.metadata; }
  getCollection()   { return this.collection; }
  getThreadGroups() { return this.threadGroups; }
  getCsvDataSets()  { return this.csvDataSets; }
  getStandaloneScripts() { return this.standaloneScripts; }
}

module.exports = JmxParser;
