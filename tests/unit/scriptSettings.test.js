'use strict';

/**
 * Script settings chosen on the page after a conversion (src/core/scriptSettings.js): the script name and the
 * servers' parameter names. Absent → no option, so the conversion and its answer are exactly as before.
 *  - the form fields are read safely (a name is made safe, server names must be valid parameter names)
 *  - the generators take a chosen server name only when it can be used (not reserved, not a value's name, not
 *    another server's — two servers may swap), else keep their default
 *  - the script name is the collection's / test plan's name every generator reads
 *  - the page's own copy of the name rule (portal/convert-preview.js cleanName) matches the server's
 */

const S = require('../../src/core/scriptSettings');
const Page = require('../../src/web/public/portal/convert-preview.js');
const WebHttpScriptGenerator = require('../../src/generators/vugen/scriptGenerator.js');
const DevWebScriptGenerator = require('../../src/generators/devweb/scriptGenerator.js');

describe('settingsOptions — the form fields', () => {
  test('absent or empty → no option (the answer as before)', () => {
    expect(S.settingsOptions({})).toEqual({});
    expect(S.settingsOptions({ scriptName: '  ', serverNames: '' })).toEqual({});
    expect(S.settingsOptions({ serverNames: 'not json' })).toEqual({});
    expect(S.settingsOptions(undefined)).toEqual({});
  });
  test('a script name is made safe and cut to 60 characters', () => {
    expect(S.settingsOptions({ scriptName: 'Shop flow <v2>' })).toEqual({ scriptName: 'Shop flow _v2_' });
    expect(S.cleanScriptName('a'.repeat(80)).length).toBe(60);
    expect(S.cleanScriptName('../..')).toBe('');   // no letter or digit: not a name
    expect(S.cleanScriptName('***')).toBe('');
  });
  test('server names: keys compared without case or a default port; invalid names dropped', () => {
    expect(S.settingsOptions({ serverNames: JSON.stringify({ 'API.Example.com:443': 'Shop_Api', 'b.example.com': '9bad', 'c.example.com': 'x y' }) }))
      .toEqual({ serverNames: { 'api.example.com': 'Shop_Api' } });
    expect(S.readServerNames('[1,2]')).toBeNull();
  });
  test('the page cleans a name the same way as the server', () => {
    ['Shop flow <v2>', '  a   b  ', 'Bank journey v2', '***', 'x'.repeat(70), 'ä-ö_ü.1'].forEach((s) => expect(Page.cleanName(s)).toBe(S.cleanScriptName(s)));
    expect(Page.serverKey('API.example.com:80')).toBe(S.serverKey('API.example.com:80'));
  });
  test('the download is named after a chosen script name, else as before', () => {
    expect(S.safeZipName('Shop flow')).toBe('Shop_flow.zip');
    expect(S.safeZipName(undefined)).toBe('loadrunner_script.zip');
  });
});

describe('applyServerNames / applyScriptName', () => {
  const map = () => new Map([['api.example.com', 'Api_Server'], ['auth.example.com', 'Auth_Server']]);
  test('a valid name replaces the default; none chosen → unchanged', () => {
    expect([...S.applyServerNames(map(), { 'api.example.com': 'Shop_Api' }).values()]).toEqual(['Shop_Api', 'Auth_Server']);
    expect([...S.applyServerNames(map(), null).values()]).toEqual(['Api_Server', 'Auth_Server']);
  });
  test('a name a value or another server uses is refused (the default stays); two servers may swap', () => {
    expect([...S.applyServerNames(map(), { 'api.example.com': 'access_token' }, ['access_token']).values()]).toEqual(['Api_Server', 'Auth_Server']);
    expect([...S.applyServerNames(map(), { 'api.example.com': 'Auth_Server' }).values()]).toEqual(['Api_Server', 'Auth_Server']);
    expect([...S.applyServerNames(map(), { 'api.example.com': 'Auth_Server', 'auth.example.com': 'Api_Server' }).values()]).toEqual(['Auth_Server', 'Api_Server']);
  });
  test('the script name is the name every generator reads', () => {
    const c = { info: { name: 'Old', schema: 's' } };
    S.applyScriptName(c, 'New');
    expect(c.info).toEqual({ name: 'New', schema: 's' });
    const b = {};
    S.applyScriptName(b, '');
    expect(b).toEqual({});
  });
  test('noteGenerated: server names and correlations over several scripts', () => {
    const src = {};
    S.noteGenerated(src, { hostVarMap: new Map([['API.example.com', 'Api_Server']]) }, { correlations: { correlations: [{ name: 'a' }] } });
    S.noteGenerated(src, { hostVarMap: new Map([['api.example.com', 'Other']]) }, { correlations: { correlations: [{ name: 'b' }] } });
    expect(src).toEqual({ servers: { 'api.example.com': 'Api_Server' }, correlations: [{ name: 'a' }, { name: 'b' }] });
  });
});

describe('the generators take the chosen server names', () => {
  const H = (key, value) => ({ key, value });
  const reqs = () => [
    { name: 'Token', method: 'POST', url: 'https://auth.shop.com/oauth/token', headers: [H('Accept', 'application/json')] },
    { name: 'Orders', method: 'GET', url: 'https://api.shop.com/orders', headers: [H('Accept', 'application/json')] },
  ];
  const C = { info: { name: 'Names' } };
  test('VuGen: set_server and every address use the chosen name', async () => {
    const g = new WebHttpScriptGenerator(reqs(), C, { thinkTime: 0, serverNames: { 'api.shop.com': 'Shop_Api' } });
    g.log = () => {};
    await g.analyze();
    const action = g.generateActionC(), init = g.generateVuserInitC();
    expect(init).toContain('set_server("Shop_Api", "api.shop.com");');
    expect(init).toContain('set_server("Auth_Server", "auth.shop.com");');
    expect(action).toContain('"URL=https://{Shop_Api}/orders"');
    expect(action + init).not.toContain('Api_Server');
  });
  test('DevWeb: the const and every address use the chosen name; none chosen → as before', async () => {
    const js = (await new DevWebScriptGenerator(reqs(), C, { thinkTime: 0, serverNames: { 'api.shop.com': 'Shop_Api' } }).generate(null)).script;
    expect(js).toContain("const Shop_Api = load.config.user.args[\"Shop_Api\"] || 'api.shop.com';");
    expect(js).toContain('${Shop_Api}/orders');
    expect(js).not.toContain('Api_Server');
    const plain = (await new DevWebScriptGenerator(reqs(), C, { thinkTime: 0 }).generate(null)).script;
    expect(plain).toContain("const Api_Server = load.config.user.args[\"Api_Server\"] || 'api.shop.com';");
  });
});
