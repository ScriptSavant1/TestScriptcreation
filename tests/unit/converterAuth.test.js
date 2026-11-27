/**
 * Sign-in in the converters (BUG-175) and DevWeb query strings (BUG-177). Both were proved on the real engines against a
 * server that checks them (regression-tests/tools/engines/mockproxy.js /auth/…).
 */
'use strict';
const fs = require('fs'), os = require('os'), path = require('path');
const A = require('../../src/core/requestAuth');
const Converter = require('../../src/tools/collection-converter/index.js');
const { applyVarNames } = require('../../src/core/scriptSettings');
const kv = (o) => Object.entries(o).map(([key, value]) => ({ key, value }));

describe('the sign-in of a request', () => {
  const basic = { type: 'basic', basic: kv({ username: 'u', password: 'p' }) };
  test('its own, else the collection\'s; none switches it off; inherit is the collection\'s', () => {
    expect(A.requestAuth({ auth: basic }, {})).toEqual({ kind: 'basic', username: 'u', password: 'p' });
    expect(A.requestAuth({ auth: null }, { auth: basic }).kind).toBe('basic');
    expect(A.requestAuth({ auth: { type: 'inherit' } }, { auth: basic }).kind).toBe('basic');
    expect(A.requestAuth({ auth: { type: 'noauth' } }, { auth: basic })).toBe(null);
    expect(A.requestAuth({}, {})).toBe(null); expect(A.requestAuth(null, null)).toBe(null);
  });
  test('as a list, an object, or beside the type (JMeter)', () => {
    expect(A.requestAuth({ auth: { type: 'basic', basic: { username: 'a', password: 'b' } } }, {})).toEqual({ kind: 'basic', username: 'a', password: 'b' });
    expect(A.requestAuth({ auth: { type: 'digest', username: 'a', password: 'b', url: '' } }, {})).toEqual({ kind: 'digest', username: 'a', password: 'b' });
  });
  test('API key in the header or the address; other kinds are named', () => {
    expect(A.requestAuth({ auth: { type: 'apikey', apikey: kv({ key: 'X', value: 'v', in: 'header' }) } }, {})).toEqual({ kind: 'apikey', in: 'header', key: 'X', value: 'v' });
    expect(A.requestAuth({ auth: { type: 'apikey', apikey: kv({ key: 'X', value: 'v', in: 'query' }) } }, {}).in).toBe('query');
    expect(A.requestAuth({ auth: { type: 'apikey', apikey: [] } }, {})).toBe(null);
    expect(A.requestAuth({ auth: { type: 'awsv4', awsv4: [] } }, {})).toEqual({ kind: 'other', type: 'awsv4' });
  });
  test('a JMeter sign-in is for its own addresses', () => {
    const a = { type: 'basic', username: 'u', password: 'p', url: 'https://a.example.com/' };
    expect(A.requestAuth({ url: 'https://a.example.com/x', auth: a }, {}).kind).toBe('basic'); expect(A.requestAuth({ url: 'https://b.example.com/x', auth: a }, {})).toBe(null);
    expect(A.requestAuth({ url: '{{base}}/x', auth: a }, {}).kind).toBe('basic');
  });
  test('the server a user is set for', () => {
    const v = new Map([['base', 'https://{{h}}:8443'], ['h', 'a.example.com']]);
    expect(A.signInHost({ url: '{{base}}/x' }, v)).toBe('a.example.com:8443'); expect(A.signInHost({ url: 'https://a.example.com:443/x' }, v)).toBe('a.example.com'); expect(A.signInHost({ url: '{{unknown}}/x' }, v)).toBe(''); expect(A.signInHost({ url: 'x', auth: { hostport: 'b.example.com:81' } }, v)).toBe('b.example.com:81');
  });
  test('an API key in the address: once, encoded, before the fragment, variables kept', () => {
    const r = (url) => { const q = { url, auth: { type: 'apikey', apikey: kv({ key: 'a k', value: 'v&{{x}}', in: 'query' }) } }; A.applyQueryKeys([q], {}); A.applyQueryKeys([q], {}); return q.url; };
    expect(r('https://h.example.com/p')).toBe('https://h.example.com/p?a%20k=v%26{{x}}'); expect(r('{{b}}/p?z=1#f')).toBe('{{b}}/p?z=1&a%20k=v%26{{x}}#f'); expect(r('{{b}}/p?')).toBe('{{b}}/p?a%20k=v%26{{x}}');
    const bearer = { url: 'https://h.example.com/', auth: { type: 'bearer', bearer: [] } }; A.applyQueryKeys([bearer, null, {}], {}); expect(bearer.url).toBe('https://h.example.com/');
  });
});

describe('in the scripts', () => {
  let dir; const keep = [console.log, console.warn];
  const r = (name, url, auth, header) => ({ name, request: { method: 'GET', header: header || [], url: { raw: url }, ...(auth ? { auth } : {}) } });
  const col = (item, more) => ({ info: { name: 'A', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json' }, variable: kv({ base: 'https://api.example.com', who: 'me', pw: 'x', k: 'K' }), item, ...more });
  beforeAll(() => { console.log = console.warn = () => {}; dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cauth-')); });
  afterAll(() => { [console.log, console.warn] = keep; fs.rmSync(dir, { recursive: true, force: true }); });
  let n = 0;
  const made = async (c, protocol, opt) => {
    const f = path.join(dir, ++n + '.json'), out = path.join(dir, 'o' + n); fs.writeFileSync(f, JSON.stringify(c));
    await new Converter({ inputFile: f, outputDir: out, protocol, scriptMode: 'single', ...opt }).convertSingle();
    return (protocol === 'devweb' ? ['main.js', 'rts.yml', 'parameters.yml'] : ['Action.c', 'vuser_init.c', 'globals.h', 'default.cfg', 'ParameterFile.prm']).filter((x) => fs.existsSync(path.join(out, x))).map((x) => fs.readFileSync(path.join(out, x), 'utf8')).join('\n');
  };
  const B = (u, p) => ({ type: 'basic', basic: kv({ username: u, password: p }) });

  test('Basic, DevWeb: made when the request is sent, never the text of the code', async () => {
    const t = await made(col([r('a', '{{base}}/a'), r('b', '{{base}}/b', B('{{who}}', 'p"\\`$'))], { auth: B('u', 'p') }), 'devweb');
    expect(t).toContain('`Basic ${load.utils.base64Encode("u:p")}`'); expect(t).not.toContain('load.global.basicAuthHeader');
    expect(t).toContain(' + ":p\\"\\\\`$")}`'); expect(t).toMatch(/base64Encode\(load\.[^ ]+ \+ /); expect(() => new Function('load', 'return async () => {' + t.split('load.finalize')[0].replace(/^const .*require.*$/gm, '') + '}')).not.toThrow();
  });
  test('Basic, VuGen: the helper in globals.h, the header, the parameters declared', async () => {
    const t = await made(col([r('a', '{{base}}/a', B('{{who}}', 'p"\\'))]), 'web-http');
    expect(t).toContain('static void perfx_basic('); expect(t).toContain('perfx_basic("_basic_auth", "{who}:p\\"\\\\");'); expect(t).toContain('web_add_header("Authorization", "Basic {_basic_auth}");'); expect(t).toMatch(/\bwho\b/);
    expect(await made(col([r('a', '{{base}}/a')]), 'web-http')).not.toContain('perfx_basic');
  });
  test.each(['devweb', 'web-http'])('an Authorization header of the request wins, switched off writes nothing: %s', async (p) => {
    const own = await made(col([r('a', '{{base}}/a', B('u', 'p'), [{ key: 'Authorization', value: 'Own x' }])]), p); expect(own).toContain('Own x'); expect(own).not.toMatch(/base64Encode\(|perfx_basic\("/);
    expect(await made(col([r('a', '{{base}}/a', { type: 'noauth' })], { auth: B('u', 'p') }), p)).not.toMatch(/base64Encode\(|perfx_basic\("/);
    expect(await made(col([r('a', '{{base}}/a', B('u', 'p'))]), p, { useAuthentication: false })).not.toMatch(/base64Encode\(|perfx_basic\("/);
  });
  test.each(['devweb', 'web-http'])('two requests with one name keep their own sign-in: %s', async (p) => {
    const bearer = (t) => ({ type: 'bearer', bearer: kv({ token: t }) });
    const t = await made(col([r('same', '{{base}}/a', bearer('t-one')), r('same', '{{base}}/b', bearer('t-two'))]), p); expect(t).toContain('t-one'); expect(t).toContain('t-two');
  });
  test.each(['devweb', 'web-http'])('API key: header (not twice) and address: %s', async (p) => {
    const key = (o) => ({ type: 'apikey', apikey: kv(o) });
    const t = await made(col([r('a', '{{base}}/a', key({ key: 'X-Key', value: 'v-{{k}}', in: 'header' })), r('b', '{{base}}/b', key({ key: 'X-Key', value: 'no', in: 'header' }), [{ key: 'x-key', value: 'own' }]), r('c', '{{base}}/c', key({ key: 'qk', value: 'v1', in: 'query' }))]), p);
    expect(t).toMatch(/X-Key"(: |, )["`]v-/); expect(t).toContain('own'); expect(t).not.toMatch(/"no"/); expect(t).toMatch(/qk(=|": ")v1/);
  });
  test('Digest: the engine signs in, one user per server', async () => {
    const D = { type: 'digest', digest: kv({ username: '{{who}}', password: 's' }) }, c = col([r('a', '{{base}}/a', D), r('b', '{{base}}/b', D), r('c', 'https://other.example.com:8443/c', D)]);
    const d = await made(c, 'devweb'), v = await made(c, 'web-http');
    expect(d.match(/load\.setUserCredentials\(/g)).toHaveLength(2); expect(d).toContain('password: "s"'); expect(d.indexOf('setUserCredentials')).toBeGreaterThan(d.indexOf("load.action('Action'"));
    expect(v.match(/web_set_user\("\{who\}", "s", /g)).toHaveLength(2); expect(v).toMatch(/web_set_user\([^)]*8443|web_set_user\([^)]*\{/);
  });
  test('a kind that is not written is said, once', async () => {
    const aws = { type: 'awsv4', awsv4: kv({ accessKey: 'a' }) }, v = await made(col([r('a', '{{base}}/a', aws), r('b', '{{base}}/b', aws)]), 'web-http');
    expect(v.match(/2 requests sign in with awsv4/g)).toHaveLength(1);
    expect(await made(col([r('a', '{{base}}/a', { type: 'oauth2', oauth2: kv({ accessToken: '{{k}}' }) })]), 'web-http')).toContain('web_add_header("Authorization", "Bearer {k}");');
  });
  test('a variable renamed on the page is renamed in the sign-in too', () => {
    const requests = [{ name: 'a', url: '{{base}}/a', headers: [], auth: { type: 'basic', basic: kv({ username: '{{who}}', password: 'p' }) }, tests: [] }], collection = { variable: kv({ who: 'me', base: 'x' }) };
    applyVarNames({ requests, collection, environmentVars: {}, taken: new Set() }, { who: 'Login' });
    expect(JSON.stringify(requests[0].auth)).toContain('{{Login}}');
  });
  test('DevWeb query strings: decoded for the engine, which encodes them; a key given twice is a list (BUG-177)', async () => {
    const t = await made(col([r('a', '{{base}}/a?q=SELECT%20a+b&n=1&n=2&e=&x&t={{k}}%26z&bad=100%#f')]), 'devweb');
    const m = /"queryString": (\{[\s\S]*?\n {6}\})/.exec(t)[1];
    expect(m).toContain('"q": "SELECT a b"'); expect(m.replace(/\s+/g, '')).toContain('"n":["1","2"]'); expect(m).toContain('"e": ""'); expect(m).toContain('"x": ""'); expect(m).toMatch(/&z/); expect(m).toContain('"bad": "100%"'); expect(m).not.toContain('#f');
  });
});
