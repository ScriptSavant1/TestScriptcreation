'use strict';

/**
 * The converter page (portal/converter-app.js): its wiring into the portal, the fields both converters read, and the
 * texts that must not get lost. The golden harness (regression-tests/tools/converter) proves the requests sent, the
 * answers and the ZIPs; its walk.js clicks through the page.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '../..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf-8').replace(/\r\n/g, '\n');
const index = read('src/web/views/index.ejs');
const partial = require('ejs').render(read('src/web/views/partials/converter.ejs'), {});
const app = read('src/web/public/portal/converter-app.js');
const css = read('src/web/public/portal/converter.css');
const server = read('src/web/server.js');

describe('wiring', () => {
  test('the partial once; the scripts it needs, in order; the old ones gone', () => {
    expect(index.match(/include\('partials\/converter'\)/g)).toHaveLength(1);
    const at = (s) => index.indexOf(s);
    ['portal/drop-anywhere.js', 'shared/host-params.js', 'portal/plan-load.js'].forEach((s) => { expect(at(s)).toBeGreaterThan(-1); expect(at(s)).toBeLessThan(at('portal/converter-app.js')); });
    ['convert-preview.js', 'portal/converter.js', 'doConvert', 'hideResults'].forEach((s) => expect(index).not.toContain(s));
  });
  test.each(['panel-bruno', 'panel-jmx', 'cx-dlg', 'fi-col', 'fi-env', 'fi-bru-cert', 'fi-jmx', 'fi-csv', 'fi-cert'])('#%s is on the page and the app uses it', (id) => {
    expect(partial).toContain('id="' + id + '"'); expect(app + index).toContain(id);
  });
  test('file kinds as the server accepts them', () => {
    expect(partial).toContain('id="fi-col" accept=".json,.yml,.yaml,.bru,.zip"'); expect(partial).toContain('id="fi-env" accept=".json,.bru"');
    expect(partial.match(/accept="\.p12,\.pfx,\.pem,\.crt,\.cer,\.key" multiple/g)).toHaveLength(2); expect(partial).toContain('id="fi-csv" accept=".csv" multiple');
  });
  test('switching tools keeps both; Clear is for the open one only', () => {
    const sw = index.slice(index.indexOf('function switchTab(tab)'), index.indexOf('</script>', index.indexOf('function switchTab(tab)')));
    expect(sw).not.toContain('clear'); expect(index).toContain('if (window.ConverterApp) ConverterApp.clear(ConverterApp.current());');
  });
  test('Plan the load: the Workload Modeller\'s own entry point', () => {
    expect(app).toContain('window.PerfxPlanLoad.send([f])');
    expect(read('src/web/public/portal/plan-load.js')).toContain('w.WorkloadModeller.addScripts(files)');
    expect(read('workload-modeller/web/page.js')).toContain('window.WorkloadModeller = Object.assign(window.WorkloadModeller || {}, { addScripts: (files) => fill(files) });');
  });
});

describe('the server and the converters read what the page sends', () => {
  test('an update: not counted as a use, its ZIP replaces the last one, the same answer', () => {
    expect(server.split('req.body.update !== "1"').length - 1).toBe(2);
    expect(server.split('this.pendingDownloads.delete(req.body.replaces)').length - 1).toBe(2);
    expect(server).toMatch(/max: 600,/);
    expect(server).toContain('preview:     safePreview({ kind: "pm", ...(converter.previewSource || {}), files, outputDir }),');
    expect(server).toContain('preview:     safePreview({ kind: "jmx", ...(converter.previewSource || {}), files, outputDir }),');
    expect(server.split('publicAnalysis(results.analysis)').length - 1).toBe(2);
  });
  test('left-out requests, settings, values and names', () => {
    const cc = read('src/tools/collection-converter/index.js'), jc = read('src/tools/jmx-converter/index.js');
    expect(server.split('...leaveOutOption(req.body.leaveOut),').length - 1).toBe(2); expect(server.split('...settingsOptions(req.body),').length - 1).toBe(2);
    expect(server.split('err.code === "nothing_selected"').length - 1).toBe(2); expect(server.split('zipName: safeZipName(options.scriptName)').length - 1).toBe(2);
    expect(cc.split('keepSelected(parsed, this.options.leaveOut)').length - 1).toBe(2); expect(jc).toContain('keepSelected(parsed, this.options.leaveOut)'); expect(jc).toContain('const tgReqs = tgAll.filter(r => kept.has(r));');
    expect(cc.split('applyScriptName(parser.collection, this.options.scriptName);').length - 1).toBe(2); expect(jc).toContain('applyScriptName(collection, this.options.scriptName);');
    expect(cc.split('applyValues(parser.collection, await this.loadEnvironmentFile(), this.options.values)').length - 1).toBe(2); expect(jc).toContain('Object.assign(environmentVars, applyValues(collection, environmentVars, this.options.values));');
    expect(cc.split('this.options.varNames)').length - 1).toBe(2); expect(jc.split('this.options.varNames)').length - 1).toBe(1);
    expect(cc.split('noteGenerated(this.previewSource, generator, analysis);').length - 1).toBe(2); expect(jc.split('noteGenerated(this.previewSource, generator, analysis);').length - 1).toBe(2);
    ['vugen', 'devweb'].forEach((g) => expect(read('src/generators/' + g + '/scriptGenerator.js')).toContain('ScriptSettings.applyServerNames(this.hostVarMap, this.options.serverNames, ['));
  });
  test('values are applied before names: both are kept under the names in the file', () => {
    const cc = read('src/tools/collection-converter/index.js'); expect(cc.indexOf('applyValues(parser.collection')).toBeLessThan(cc.indexOf('applyVarNames({'));
  });
});

describe('words that must stay', () => {
  test.each([
    'Extract dynamic values from API responses — access_token, userId, sessionId, CSRF tokens', 'Convert static variables into CSV parameters — baseUrl, clientId, API keys',
    'OAuth2, Bearer (dynamic-aware), Basic, API Key, JWT (PS256 / RS256 / HS256), AWS Sig v4', 'Inline explanatory comments in the generated script to guide manual review',
    'Provides variable values', 'Convert a Java keystore (.jks) to .p12 first (keytool -importkeystore)', 'Regex / JSON / Boundary / XPath / CSS extractors', 'Loop / If / ForEach controller context preserved',
    'Detects correlations, JWT, auth, proxy, headers and classifies all variables into 3 tiers.', 'Get a .zip. Open the .usr in VuGen or upload directly to LoadRunner Enterprise.',
    'Uploaded files are deleted when the conversion ends — nothing kept on the server', 'Untick what the script should leave out',
  ])('%s', (t) => expect(app).toContain(t));
  test('no browser alert', () => expect(app).not.toMatch(/\balert\(/));
});

describe('styles', () => {
  test('widths are the page\'s own (container), weights 400 / 600 / 700 only, no bar that lies over text', () => {
    expect(css).toContain('container: cx / inline-size');
    expect([...css.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]).filter((w) => !['400', '600', '700'].includes(w))).toEqual([]);
    expect(css).not.toMatch(/position: sticky; bottom/);
  });
});
