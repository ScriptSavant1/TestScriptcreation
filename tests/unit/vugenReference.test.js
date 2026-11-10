'use strict';

/**
 * Every tool's VuGen project files, for both protocols, against the VuGen version in vugen-reference/.
 *
 * DevWeb 26.3 refuses an rts.yml without network.ipVersion when DevWeb.exe runs the script directly
 * ("network ip version setting is not valid") — BUG-129. These checks fail when a tool falls behind the reference:
 * a setting of the template missing from what a tool writes, an old .usr version, or an SDK copy that differs.
 * Values are not compared: a tool may choose its own value. Keys a tool deliberately leaves out are listed in
 * DECIDED with the reason.
 */

const fs = require('fs');
const path = require('path');
const ref = require('../../vugen-reference/compare.js');

const ROOT = path.resolve(__dirname, '../..');
const PUB = path.join(ROOT, 'src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8');
const { version, usrVersion, dir: REF } = ref.currentVersion();
const refFile = (p) => fs.readFileSync(path.join(REF, p), 'utf-8');
const [MAJOR, MINOR] = version.split('.');

// ---- the four tools, loaded the way the pages and the server load them -----------------------------------------
const DevWebFiles = require('../../src/generators/devweb/filesGenerator.js');
const VugenFiles = require('../../src/generators/vugen/filesGenerator.js');
const devwebConv = new DevWebFiles({ scriptName: 'T' });
const vugenConv = new VugenFiles({ scriptName: 'T' });

function loadRecorder() {
  const S = { txns: [{ name: 't01' }], hasDpop: false };
  // eslint-disable-next-line no-new-func
  return new Function('S', read('VuGen-Recorder-templates.js') + '\n' + read('VuGen-Recorder-usr-gen.js')
    + '\nreturn { WEB_DEFAULT_CFG, WEB_DEFAULT_USP, DEVWEB_RTS_YML, DEVWEB_TSCONFIG_JSON, DEVWEB_DEFAULT_CFG,'
    + ' DEVWEB_DEFAULT_USP, genUsrFile, genDevWebUsrFile };')(S);
}
function loadStudio() {
  const PageResources = require('../../src/web/public/shared/page-resources.js');
  const HostParams = require('../../src/web/public/shared/host-params.js');
  const VugenCodegen = require('../../src/web/public/shared/vugen-codegen.js');
  // eslint-disable-next-line no-new-func
  const r = new Function('PageResources', 'HostParams', 'VugenCodegen', 'VUGEN_TEMPLATES',
    read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') + '\n' + read('studio-codegen.js')
    + '\nreturn { S, WEB_DEFAULT_USP, DEVWEB_RTS_YML, DEVWEB_TSCONFIG_JSON, DEVWEB_DEFAULT_CFG, DEVWEB_DEFAULT_USP,'
    + ' genDefaultCfg, genRtsYml, genUsrFile, genDevWebUsrFile };')(PageResources, HostParams, VugenCodegen, {});
  r.S.txns = [{ name: 't01' }];
  return r;
}
const rec = loadRecorder();
const stu = loadStudio();

const TOOLS = {
  DevWeb: {
    rts: {
      Converter: devwebConv.generateRtsYml(),
      'Converter (proxy + user arguments)': devwebConv.generateRtsYml(
        { enabled: true, host: 'proxy.example.com', port: 8080, username: 'your-user', password: 'your-password' }, { base_url: 'https://app.example.com' }),
      Recorder: rec.DEVWEB_RTS_YML,
      'Script Studio': stu.genRtsYml(null),
      'Script Studio (Kerberos)': stu.genRtsYml({ type: 'kerberos' }),
    },
    cfg: { Converter: devwebConv.generateDevWebDefaultCfg(), Recorder: rec.DEVWEB_DEFAULT_CFG, 'Script Studio': stu.DEVWEB_DEFAULT_CFG },
    usp: { Converter: devwebConv.generateDevWebDefaultUsp(), Recorder: rec.DEVWEB_DEFAULT_USP, 'Script Studio': stu.DEVWEB_DEFAULT_USP },
    usr: { Converter: devwebConv.generateDevWebUsrFile('T', ['t01']), Recorder: rec.genDevWebUsrFile('T'), 'Script Studio': stu.genDevWebUsrFile('T') },
  },
  qtweb: {
    cfg: { Converter: vugenConv.generateDefaultCfg(), Recorder: rec.WEB_DEFAULT_CFG, 'Script Studio': stu.genDefaultCfg(null) },
    usp: { Converter: vugenConv.generateDefaultUsp(), Recorder: rec.WEB_DEFAULT_USP, 'Script Studio': stu.WEB_DEFAULT_USP },
    usr: { Converter: vugenConv.generateUsrFile('T', ['t01']), Recorder: rec.genUsrFile('T'), 'Script Studio': stu.genUsrFile('T') },
  },
};

// Keys of the template a tool leaves out on purpose — "<tool>|<file>|<key>": reason. Empty: leaving out
// WebRecorderVersion looked harmless, but without it VuGen answers an NTLM challenge with Basic (BUG-132).
const DECIDED = {};

function missing(refKeys, got, tool, file) {
  return Object.keys(refKeys).filter((k) => !(k in got) && !DECIDED[`${tool}|${file}|${k}`]);
}

// ---- the helpers ---------------------------------------------------------------------------------------------------
describe('vugen-reference/compare.js helpers', () => {
  test('parseIni reads sections and keys, ignores comments and blank lines', () => {
    expect(ref.parseIni('[General]\r\nA=1\n; note\n\nB=x=y\n[Empty]\n')).toEqual({ 'General/': '', 'General/A': '1', 'General/B': 'x=y', 'Empty/': '' });
    expect(ref.parseIni('')).toEqual({});
    expect(() => ref.parseIni('[General]\nnot a setting')).toThrow(/not an INI line/);
    expect(() => ref.parseIni(null)).toThrow(TypeError);
  });

  test('flattenYaml gives dotted keys; empty maps and lists stay one entry', () => {
    expect(ref.flattenYaml('a:\n  b: 1\n  c: []\nflow: {}\n')).toEqual({ 'a.b': '1', 'a.c': '[]', flow: '{}' });
    expect(() => ref.flattenYaml('')).toThrow(/not a map/);
    expect(() => ref.flattenYaml('- a\n- b\n')).toThrow(/not a map/);
    expect(() => ref.flattenYaml('a: [1,\n')).toThrow();
  });

  test('sdkDeclarations ignores comments, so a reworded comment is no change', () => {
    const a = '// v1\n/** old words */\nexport function f(): void;\n';
    const b = '// v2\n/**\n * new words\n */\nexport function f(): void;\n';
    expect(ref.sdkDeclarations(a)).toEqual(ref.sdkDeclarations(b));
    expect(ref.sdkDeclarations('')).toEqual([]);
  });

  test('compareFile reports added, removed and changed settings', () => {
    expect(ref.compareFile('rts.yml', 'a:\n  b: 1\n  c: 2\n', 'a:\n  b: 3\n  d: 4\n')).toEqual({ added: ['a.d'], removed: ['a.c'], changed: ['a.b'] });
    expect(ref.compareFile('x.d.ts', 'f(): void;', 'f(): void;\ng(): void;')).toEqual({ added: ['g(): void;'], removed: [], changed: [] });
    expect(ref.compareFile('default.cfg', '[A]\nk=1\n', '[A]\nk=1\n')).toEqual({ added: [], removed: [], changed: [] });
  });

  test('compareFolders lists new and removed files, and fails on a missing folder', () => {
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vugenref-'));
    try {
      for (const [v, files] of [['1.0', { 'p/a.cfg': '[A]\nk=1\n', 'p/old.txt': 'x' }], ['1.1', { 'p/a.cfg': '[A]\nk=2\n', 'p/new.txt': 'y' }]]) {
        for (const [f, t] of Object.entries(files)) {
          fs.mkdirSync(path.dirname(path.join(tmp, v, f)), { recursive: true });
          fs.writeFileSync(path.join(tmp, v, f), t);
        }
      }
      const r = ref.compareFolders(path.join(tmp, '1.0'), path.join(tmp, '1.1'));
      expect(r.filesAdded).toEqual(['p/new.txt']);
      expect(r.filesRemoved).toEqual(['p/old.txt']);
      expect(r.files['p/a.cfg']).toEqual({ added: [], removed: [], changed: ['A/k'] });
      expect(() => ref.compareFolders(path.join(tmp, 'none'), path.join(tmp, '1.1'))).toThrow(/no such folder/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test('currentVersion reads version.json and refuses a malformed one', () => {
    expect(version).toMatch(/^\d+\.\d+$/);
    expect(usrVersion.startsWith(version + '.')).toBe(true);
    const os = require('os');
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vugenref-'));
    try {
      fs.writeFileSync(path.join(tmp, 'version.json'), '{"current":"26","usrVersion":"26.3.0.0"}');
      expect(() => ref.currentVersion(tmp)).toThrow(/version.json/);
      fs.writeFileSync(path.join(tmp, 'version.json'), '{"current":"9.9","usrVersion":"9.9.0.0"}');
      expect(() => ref.currentVersion(tmp)).toThrow(/no folder/);
    } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  });
});

// ---- the tools against the reference -------------------------------------------------------------------------------
describe(`DevWeb project files against VuGen ${version}`, () => {
  const rts = ref.flattenYaml(refFile('DevWeb/rts.yml'));

  test.each(Object.entries(TOOLS.DevWeb.rts))('%s rts.yml has every setting of the template (BUG-129)', (tool, text) => {
    const got = ref.flattenYaml(text);
    expect(missing(rts, got, tool, 'DevWeb/rts.yml')).toEqual([]);
    expect(['any', 'ipv4', 'ipv6']).toContain(JSON.parse(got['network.ipVersion']));
  });

  test.each(['cfg', 'usp'])('default.%s of every tool has every setting of the template', (kind) => {
    const want = ref.parseIni(refFile('DevWeb/default.' + kind));
    for (const [tool, text] of Object.entries(TOOLS.DevWeb[kind])) {
      expect({ tool, missing: missing(want, ref.parseIni(text), tool, 'DevWeb/default.' + kind) }).toEqual({ tool, missing: [] });
    }
  });

  test.each(Object.entries(TOOLS.DevWeb.usr))('%s .usr is the version in version.json', (tool, text) => {
    const u = ref.parseIni(text);
    expect([u['General/MajorVersion'], u['General/MinorVersion'], u['General/LastModifyVer']]).toEqual([MAJOR, MINOR, usrVersion]);
    expect(missing(ref.parseIni(refFile('DevWeb/DevWeb.usr')), u, tool, 'DevWeb/DevWeb.usr')).toEqual([]);
  });

  test('tsconfig.json compiler options match the template in every tool', () => {
    const want = JSON.parse(refFile('DevWeb/tsconfig.json')).compilerOptions;
    expect(devwebConv.generateTsConfig().compilerOptions).toEqual(want);
    expect(JSON.parse(rec.DEVWEB_TSCONFIG_JSON).compilerOptions).toEqual(want);
    expect(JSON.parse(stu.DEVWEB_TSCONFIG_JSON).compilerOptions).toEqual(want);
  });

  test('the one DevWebSdk.d.ts (src/web/public) is the one of this version', () => {
    const want = refFile('DevWeb/DevWebSdk.d.ts').replace(/\r\n/g, '\n');
    expect(read('DevWebSdk.d.ts').replace(/\r\n/g, '\n') === want).toBe(true);
    expect(read('VuGen-Recorder-templates.js')).not.toMatch(/DEVWEB_SDK_DTS|Type definitions for \[DevWeb SDK\]/);
  });
});

// ---- DevWebSdk.d.ts: one file, used by every tool -------------------------------------------------------------------
describe('DevWebSdk.d.ts comes from src/web/public in every tool', () => {
  const os = require('os');
  const SDK = read('DevWebSdk.d.ts');

  test('the converter copies src/web/public/DevWebSdk.d.ts into the script', async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vugenref-'));
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      await new DevWebFiles({ scriptName: 'T' }).generateAll(tmp, null, {});
      expect(fs.readFileSync(path.join(tmp, 'DevWebSdk.d.ts'), 'utf-8')).toBe(SDK);
    } finally { log.mockRestore(); fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  test('a missing source file is reported, not replaced by a stub', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vugenref-'));
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(devwebConv._copyInto(path.join(tmp, 'none.d.ts'), tmp, 'DevWebSdk.d.ts', '(test)')).toBe(false);
      expect(fs.existsSync(path.join(tmp, 'DevWebSdk.d.ts'))).toBe(false);
      expect(warn.mock.calls[0][0]).toMatch(/DevWebSdk\.d\.ts not found/);
    } finally { warn.mockRestore(); fs.rmSync(tmp, { recursive: true, force: true }); }
  });

  // Runs a page's dlZip('devweb') with stand-ins for the browser: JSZip, fetch, toasts, the download link
  async function devwebZip(files, fetchImpl, pagePath) {
    const zips = [], toasts = [], urls = [];
    class JSZip { constructor() { this.files = {}; zips.push(this.files); } file(n, t) { this.files[n] = t; } async generateAsync() { return {}; } }
    const real = { S: { scripts: { mj: '// main', ac: '' }, txns: [], params: [], hasDpop: false, auth: null }, JSZip,
      fetch: async (u) => { urls.push(u); return fetchImpl(u); },
      showToast: (m, k) => toasts.push([k, m]),
      window: { location: { pathname: pagePath } },
      document: { createElement: () => ({ click() {} }) }, URL: { createObjectURL: () => 'blob:' } };
    const env = new Proxy(real, {
      has: () => true,
      get: (t, k) => (k === Symbol.unscopables ? undefined : k in t ? t[k] : k in globalThis ? globalThis[k] : (() => '')),
    });
    // eslint-disable-next-line no-new-func
    const dlZip = new Function('env', `with (env) { ${files.map(read).join('\n')}\n return dlZip; }`)(env);
    await dlZip('devweb');
    return { zip: zips[0], toasts, urls };
  }
  const ok = async () => ({ ok: true, text: async () => SDK });
  const down = async () => ({ ok: false, text: async () => '' });

  test.each([
    ['Recorder', ['VuGen-Recorder-templates.js', 'VuGen-Recorder-usr-gen.js'], '/converter/recorder'],
    ['Script Studio', ['studio-app.js'], '/converter/studio'],
  ])('%s fetches the server file next to the page; when it cannot, it warns', async (tool, files, page) => {
    const good = await devwebZip(files, ok, page);
    expect(good.zip['DevWebSdk.d.ts']).toBe(SDK);
    expect(good.urls[0]).toBe('/converter/DevWebSdk.d.ts');
    expect(good.toasts.filter(([k]) => k === 'warning')).toEqual([]);

    const bad = await devwebZip(files, down, page);
    expect(bad.zip['DevWebSdk.d.ts']).toBeUndefined();
    expect(bad.urls).toEqual(['/converter/DevWebSdk.d.ts', '/DevWebSdk.d.ts']);
    expect(bad.toasts).toEqual([['warning', expect.stringMatching(/DevWebSdk\.d\.ts could not be loaded/)]]);
    expect(bad.zip['main.js']).toBe('// main'); // the rest of the ZIP is still written
  });
});

describe(`Web HTTP/HTML project files against VuGen ${version}`, () => {
  test.each(['cfg', 'usp'])('default.%s of every tool has every setting of the template', (kind) => {
    const file = kind === 'cfg' ? 'qtweb/default.cfg' : 'qtweb/test.usp';
    const want = ref.parseIni(refFile(file));
    for (const [tool, text] of Object.entries(TOOLS.qtweb[kind])) {
      expect({ tool, missing: missing(want, ref.parseIni(text), tool, file) }).toEqual({ tool, missing: [] });
    }
  });

  test.each(Object.entries(TOOLS.qtweb.usr))('%s .usr is the version in version.json', (tool, text) => {
    const u = ref.parseIni(text);
    expect([u['General/MajorVersion'], u['General/MinorVersion'], u['General/LastModifyVer']]).toEqual([MAJOR, MINOR, usrVersion]);
    if (u['General/LastCodeGenerationVer']) expect(u['General/LastCodeGenerationVer']).toBe(usrVersion);
    expect(missing(ref.parseIni(refFile('qtweb/qtweb.usr')), u, tool, 'qtweb/qtweb.usr')).toEqual([]);
  });

  test('the files globals.h includes are shipped or come with VuGen', () => {
    // generated globals.h includes lrw_custom_body.h; the Recorder and Script Studio ship it, VuGen's include folder has it too
    expect(rec.DEVWEB_RTS_YML).toBeDefined();
    expect(fs.existsSync(path.join(REF, 'qtweb/lrw_custom_body.h'))).toBe(true);
  });
});
