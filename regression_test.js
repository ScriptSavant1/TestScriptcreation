'use strict';
/**
 * Regression smoke tests for v2.8.x changes.
 * Tests BOTH the JMX converter path AND the Bruno/Postman converter path.
 * Run: node regression_test.js
 */

const path = require('path');
const os   = require('os');
const fs   = require('fs');

let passed = 0;
let failed = 0;

function assert(label, cond, detail) {
  if (cond) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ FAIL: ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

// ─── MODULE LOAD ──────────────────────────────────────────────────────────────
console.log('\n[1] Module loads');
let AdvancedScriptGenerator, WebHttpScriptGenerator, JmxConverter, JmxParser, WorkloadExcelGenerator;
try {
  AdvancedScriptGenerator = require('./src/generators/advancedScriptGenerator');
  WebHttpScriptGenerator  = require('./src/generators/webHttpScriptGenerator');
  JmxConverter            = require('./src/converters/jmxConverter');
  JmxParser               = require('./src/parsers/jmxParser');
  WorkloadExcelGenerator  = require('./src/generators/workloadExcelGenerator');
  assert('advancedScriptGenerator loads', true);
  assert('webHttpScriptGenerator loads', true);
  assert('jmxConverter loads', true);
  assert('jmxParser loads', true);
  assert('workloadExcelGenerator loads', true);
} catch (e) {
  console.error('FATAL module load:', e.message);
  process.exit(1);
}

// ─── SHARED FIXTURES ──────────────────────────────────────────────────────────
const minimalCollection = {
  info: { name: 'TestCollection', schema: '' },
  item: [],
  variable: [
    { key: 'baseUrl',  value: 'https://api.example.com' },
    { key: 'username', value: 'testuser' },
    { key: 'password', value: 'testpass' }
  ],
  event: [],
  collectionHeaders: [],
  collectionAuth: null,
  config: {}
};

const sampleRequests = [
  {
    name: 'GET Users',
    method: 'GET',
    url: 'https://api.example.com/users',
    headers: [],
    body: null,
    auth: null,
    tests: [],
    folder: 'Users'
  },
  {
    name: 'POST Create User',
    method: 'POST',
    url: 'https://api.example.com/users',
    headers: [{ key: 'Content-Type', value: 'application/json' }],
    body: { mode: 'raw', raw: '{"name":"{{username}}"}' },
    auth: null,
    tests: [],
    folder: 'Users'
  }
];

async function runAll() {

  // ─── [2] DevWeb: Bruno/Postman path — no setUp/tearDown options ─────────────
  console.log('\n[2] DevWeb generator — Bruno/Postman path (no setUp/tearDown options)');
  try {
    const gen = new AdvancedScriptGenerator(sampleRequests, minimalCollection, {
      useTransactions: true,
      useCorrelation: false,
      useParameterization: true,
      useAuthentication: false,
      useCustomScripts: false,
      thinkTime: 1
      // intentionally no setupRequests / teardownRequests
    });
    const { script } = await gen.generate();
    assert('generate() returns script', typeof script === 'string' && script.length > 0);
    assert('initialize() present',       script.includes('load.initialize'));
    assert('action() present',           script.includes('load.action'));
    assert('finalize() present',         script.includes('load.finalize'));
    assert('no spurious setUp heading',  !script.includes('SetUp Thread Group'));
    assert('no spurious tearDown heading', !script.includes('TearDown Thread Group'));
    assert('finalize has fallback comment', script.includes('Cleanup code here if needed'));
    assert('main request in action()',   script.includes('GET Users') || script.includes('GETUsers') || script.includes('get_users') || script.includes('GET_Users'));
  } catch (e) {
    assert('DevWeb Bruno/Postman path no exception', false, e.message);
    console.error('   ', e.stack);
  }

  // ─── [3] DevWeb: with setUp/tearDown options ─────────────────────────────────
  console.log('\n[3] DevWeb generator — with setUp/tearDown options (JMX path)');
  try {
    const setupReq     = { ...sampleRequests[0], name: 'SetupLogin',   threadGroupType: 'SetUp'    };
    const teardownReq  = { ...sampleRequests[0], name: 'TeardownLogout', threadGroupType: 'TearDown' };
    const setupScript  = { name: 'BuildToken', lang: 'groovy', script: 'vars.put("x","y")', threadGroupType: 'SetUp'    };
    const tdScript     = { name: 'Cleanup',    lang: 'groovy', script: 'vars.put("z","w")', threadGroupType: 'TearDown' };

    const gen = new AdvancedScriptGenerator(sampleRequests, minimalCollection, {
      useTransactions: true,
      useCorrelation: false,
      useParameterization: true,
      useAuthentication: false,
      useCustomScripts: false,
      thinkTime: 1,
      setupRequests:    [setupReq],
      teardownRequests: [teardownReq],
      setupScripts:     [setupScript],
      teardownScripts:  [tdScript]
    });
    const { script } = await gen.generate();
    assert('generate() returns script',                   typeof script === 'string' && script.length > 0);
    assert('initialize() has SetUp heading',              script.includes('SetUp Thread Group'));
    assert('initialize() has setUp JSR223 TODO',          script.includes('JSR223 setUp-sampler "BuildToken"'));
    assert('initialize() has setUp HTTP request',         script.includes('SetupLogin'));
    assert('finalize() has TearDown heading',             script.includes('TearDown Thread Group'));
    assert('finalize() has tearDown JSR223 TODO',         script.includes('JSR223 tearDown-sampler "Cleanup"'));
    assert('finalize() has tearDown HTTP request',        script.includes('TeardownLogout'));
    assert('action() still has main requests',            script.includes('GET Users') || script.includes('GETUsers') || script.includes('GET_Users'));
    assert('no fallback comment when tearDown provided',  !script.includes('Cleanup code here if needed'));
  } catch (e) {
    assert('DevWeb setUp/tearDown path no exception', false, e.message);
    console.error('   ', e.stack);
  }

  // ─── [4] VuGen: Bruno/Postman path — no setUp/tearDown options ──────────────
  console.log('\n[4] VuGen generator — Bruno/Postman path (no setUp/tearDown options)');
  const tmpDir4 = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-vugen4-'));
  try {
    const gen = new WebHttpScriptGenerator(sampleRequests, minimalCollection, {
      useTransactions: true,
      useCorrelation: false,
      useParameterization: true,
      useAuthentication: false,
      useCustomScripts: false,
      thinkTime: 1
    });
    await gen.generate(tmpDir4);
    const initC = fs.readFileSync(path.join(tmpDir4, 'vuser_init.c'), 'utf8');
    const endC  = fs.readFileSync(path.join(tmpDir4, 'vuser_end.c'),  'utf8');
    assert('Action.c exists',               fs.existsSync(path.join(tmpDir4, 'Action.c')));
    assert('vuser_init.c exists',           fs.existsSync(path.join(tmpDir4, 'vuser_init.c')));
    assert('vuser_end.c exists',            fs.existsSync(path.join(tmpDir4, 'vuser_end.c')));
    assert('vuser_init.c has OAuth2 example (fallback)', initC.includes('OAuth2'));
    assert('vuser_end.c has Logout example (fallback)',  endC.includes('Logout'));
    assert('no spurious SetUp in vuser_init.c',          !initC.includes('SetUp Thread Group'));
    assert('no spurious TearDown in vuser_end.c',        !endC.includes('TearDown Thread Group'));
  } catch (e) {
    assert('VuGen Bruno/Postman path no exception', false, e.message);
    console.error('   ', e.stack);
  } finally {
    fs.rmSync(tmpDir4, { recursive: true, force: true });
  }

  // ─── [5] VuGen: with setUp/tearDown options ──────────────────────────────────
  console.log('\n[5] VuGen generator — with setUp/tearDown options (JMX path)');
  const tmpDir5 = fs.mkdtempSync(path.join(os.tmpdir(), 'lr-vugen5-'));
  try {
    const setupReq    = { ...sampleRequests[0], name: 'SetupLogin',    threadGroupType: 'SetUp'    };
    const teardownReq = { ...sampleRequests[0], name: 'TeardownLogout', threadGroupType: 'TearDown' };
    const setupScript = { name: 'BuildToken', lang: 'groovy', script: 'vars.put("x","y")', threadGroupType: 'SetUp' };

    const gen = new WebHttpScriptGenerator(sampleRequests, minimalCollection, {
      useTransactions: false,
      useCorrelation: false,
      useParameterization: false,
      useAuthentication: false,
      useCustomScripts: false,
      thinkTime: 1,
      setupRequests:    [setupReq],
      teardownRequests: [teardownReq],
      setupScripts:     [setupScript]
    });
    await gen.generate(tmpDir5);
    const initC = fs.readFileSync(path.join(tmpDir5, 'vuser_init.c'), 'utf8');
    const endC  = fs.readFileSync(path.join(tmpDir5, 'vuser_end.c'),  'utf8');
    assert('vuser_init.c has SetUp heading',              initC.includes('SetUp Thread Group'));
    assert('vuser_init.c has setUp JSR223 TODO',          initC.includes('JSR223 setUp-sampler "BuildToken"'));
    assert('vuser_init.c has setUp HTTP request',         initC.includes('SetupLogin'));
    assert('OAuth2 example hidden when setUp provided',   !initC.includes('OAuth2'));
    assert('vuser_end.c has TearDown heading',            endC.includes('TearDown Thread Group'));
    assert('vuser_end.c has tearDown HTTP request',       endC.includes('TeardownLogout'));
    assert('Logout example hidden when tearDown provided',!endC.includes('/services/auth/logout'));
  } catch (e) {
    assert('VuGen setUp/tearDown path no exception', false, e.message);
    console.error('   ', e.stack);
  } finally {
    fs.rmSync(tmpDir5, { recursive: true, force: true });
  }

  // ─── [6] filterJmxCollectionVars ─────────────────────────────────────────────
  console.log('\n[6] jmxConverter.filterJmxCollectionVars()');
  try {
    const conv = new JmxConverter({ inputFile: 'fake.jmx', outputDir: '/tmp/fake' });
    const collection = {
      variable: [
        { key: 'nrThreads',  value: '50'    },   // B — execution prop → REMOVE
        { key: 'rampUp',     value: '30'    },   // B — execution prop → REMOVE
        { key: 'duration',   value: '300'   },   // B — execution prop → REMOVE
        { key: 'csvFile1',   value: 'users.csv' }, // A — csv path → REMOVE
        { key: 'lines1',     value: '100'   },   // C — count pattern → REMOVE
        { key: 'rowCount',   value: '200'   },   // C — count pattern → REMOVE
        { key: 'baseUrl',    value: 'https://api.example.com' }, // KEEP
        { key: 'clientId',   value: 'abc123' },  // KEEP
        { key: 'username',   value: ''       },  // KEEP (credential, even if empty)
      ]
    };
    conv.filterJmxCollectionVars(collection);
    const keys = collection.variable.map(v => v.key);
    assert('nrThreads removed',            !keys.includes('nrThreads'));
    assert('rampUp removed',               !keys.includes('rampUp'));
    assert('duration removed',             !keys.includes('duration'));
    assert('csvFile1 (csv path) removed',  !keys.includes('csvFile1'));
    assert('lines1 (count) removed',       !keys.includes('lines1'));
    assert('rowCount removed',             !keys.includes('rowCount'));
    assert('baseUrl kept',                 keys.includes('baseUrl'));
    assert('clientId kept',                keys.includes('clientId'));
    assert('username kept',                keys.includes('username'));
  } catch (e) {
    assert('filterJmxCollectionVars no exception', false, e.message);
  }

  // ─── [7] resolveCsvFilenames ──────────────────────────────────────────────────
  console.log('\n[7] jmxConverter.resolveCsvFilenames()');
  try {
    const conv = new JmxConverter({ inputFile: 'fake.jmx', outputDir: '/tmp/fake' });
    const csvDataSets = [
      { filename: '{{csvFile1}}', variableNames: 'username,password' },
      { filename: '{{csvFile2}}', variableNames: 'token' },
      { filename: 'static.csv',  variableNames: 'id'    },  // already resolved
      { filename: '{{missing}}', variableNames: 'x'     },  // unresolvable
    ];
    const collectionVars = [
      { key: 'csvFile1', value: 'users.csv' },
      { key: 'csvFile2', value: '/some/path/tokens.csv' },  // path stripped → tokens.csv
    ];
    conv.resolveCsvFilenames(csvDataSets, collectionVars);
    assert('{{csvFile1}} resolved to users.csv',        csvDataSets[0].filename === 'users.csv');
    assert('{{csvFile2}} path stripped to tokens.csv',  csvDataSets[1].filename === 'tokens.csv');
    assert('static.csv unchanged',                      csvDataSets[2].filename === 'static.csv');
    assert('{{missing}} left as-is',                    csvDataSets[3].filename === '{{missing}}');
  } catch (e) {
    assert('resolveCsvFilenames no exception', false, e.message);
  }

  // ─── [8] WLM Excel: no corruption ────────────────────────────────────────────
  console.log('\n[8] WorkloadExcelGenerator — xlsx valid (no repair dialog)');
  try {
    const tgs = [
      { name: 'Login_TG', type: 'Standard', virtualUsers: 10, rampUpSec: 30,  holdSec: 120, iterations: 'Infinite', enabled: true },
      { name: 'SetUp_TG', type: 'SetUp',    virtualUsers: 1,  rampUpSec: 0,   holdSec: 0,   iterations: '1',        enabled: true },
      { name: 'Tear_TG',  type: 'TearDown', virtualUsers: 1,  rampUpSec: 0,   holdSec: 0,   iterations: '1',        enabled: true },
    ];
    const eg  = new WorkloadExcelGenerator(tgs, sampleRequests, 'TestScript', {});
    const buf = await eg.generateBuffer();
    assert('generateBuffer() returns Buffer',     Buffer.isBuffer(buf));
    assert('buffer size > 4KB',                   buf.length > 4096);
    assert('valid xlsx zip header (0x50 0x4B)',   buf[0] === 0x50 && buf[1] === 0x4B);
    assert('xlsx contains [Content_Types]',       buf.toString('latin1').includes('[Content_Types]'));
  } catch (e) {
    assert('Excel generation no exception', false, e.message);
    console.error('   ', e.stack);
  }

  // ─── [9] jmxParser — getStandaloneScripts API exists ─────────────────────────
  console.log('\n[9] jmxParser — standaloneScripts API and threadGroupType stamping');
  try {
    const parser = new JmxParser('fake.jmx', {});
    assert('getStandaloneScripts() method exists', typeof parser.getStandaloneScripts === 'function');
    // The internal array is always initialized
    const scripts = parser.getStandaloneScripts();
    assert('getStandaloneScripts() returns array', Array.isArray(scripts));
  } catch (e) {
    assert('jmxParser API no exception', false, e.message);
  }

  // ─── [10] Existing Bruno/Postman converter modules unaffected ─────────────────
  console.log('\n[10] Core Bruno/Postman converter modules still load');
  try {
    const brunoParser  = require('./src/parsers/brunoParser');
    const corrDetector = require('./src/analyzers/correlationDetector');
    const paramEngine  = require('./src/analyzers/parameterizationEngine');
    const authHandler  = require('./src/analyzers/authenticationHandler');
    assert('brunoParser loads',          !!brunoParser);
    assert('correlationDetector loads',  !!corrDetector);
    assert('parameterizationEngine loads', !!paramEngine);
    assert('authenticationHandler loads', !!authHandler);
  } catch (e) {
    assert('Core modules load', false, e.message);
  }

  // ─── SUMMARY ──────────────────────────────────────────────────────────────────
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`Results: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error('\n⚠  REGRESSION DETECTED — see failures above');
    process.exit(1);
  } else {
    console.log('\n✓  All regression checks passed — no regressions detected');
  }
}

runAll().catch(e => {
  console.error('Unhandled error in test runner:', e);
  process.exit(1);
});
