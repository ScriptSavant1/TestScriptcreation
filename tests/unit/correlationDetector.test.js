/**
 * Unit tests for CorrelationDetector
 *
 * Focused on the pure string-parsing methods that have historically caused bugs:
 *  - extractSetVariables  (BUG-033/034: setPattern.lastIndex not reset)
 *  - extractTestScript    (Event Storage Rule: req.tests vs req.event)
 *  - determineExtractorType (type detection accuracy)
 *  - extractHeaderName    (header name extraction)
 */

'use strict';

const CorrelationDetector = require('../../src/analyzers/correlationDetector');

describe('CorrelationDetector', () => {
  let detector;

  beforeEach(() => {
    detector = new CorrelationDetector();
  });

  // ── extractSetVariables ──────────────────────────────────────────────────

  describe('extractSetVariables() — value read inline from the response (BUG-122)', () => {
    const one = (script) => detector.extractSetVariables(script)[0];

    test.each([
      [`pm.environment.set('v', pm.response.json().token);`, '$.token'],
      [`pm.environment.set('v', pm.response.json().data.items[0].id);`, '$.data.items[0].id'],
      [`pm.environment.set('v', pm.response.json().token.trim());`, '$.token'],
      [`pm.environment.set('v', pm.response.json()['access_token']);`, '$.access_token'],
      [`pm.environment.set('v', pm.response.json()[0].id);`, '$[0].id'],
      [`pm.environment.set('v', pm.response.json());`, '$'],
      [`pm.environment.set('v', String(pm.response.json().id));`, '$.id'],
      [`pm.collectionVariables.set('v', JSON.parse(responseBody).token);`, '$.token'],
      [`postman.setEnvironmentVariable('v', JSON.parse(pm.response.text()).id);`, '$.id'],
      [`bru.setVar('v', res.getBody().token);`, '$.token'],
      [`bru.setEnvVar('v', res.getBody().data.token);`, '$.data.token'],
      [`bru.setVar('v', res.body.token);`, '$.token'],
      [`bru.setVar('v', res.body.token.trim());`, '$.token'],
      [`const list = JSON.parse(responseBody); pm.environment.set('v', list[list.length-1].version);`, '$[-1:].version'],
    ])('%s → JSON path %s', (script, path) => {
      const v = one(script);
      expect(v.extractorType).toBe('json');
      expect(v.extractPath).toBe(path);
    });

    test.each([
      [`pm.globals.set('v', pm.response.headers.get('X-Token'));`, 'X-Token'],
      [`bru.setVar('v', res.getHeader('x-csrf'));`, 'x-csrf'],
    ])('%s → header %s', (script, name) => {
      const v = one(script);
      expect(v.extractorType).toBe('header');
      expect(v.extractPath).toBe(name);
    });

    test.each([
      [`pm.variables.set('v', pm.cookies.get('sid'));`, 'sid'],
      [`bru.setVar('v', bru.cookies.get('sid'));`, 'sid'],
    ])('%s → cookie %s', (script, name) => {
      const v = one(script);
      expect(v.extractorType).toBe('cookie');
      expect(v.extractPath).toBe(name);
    });

    test('a regex literal with brackets and quotes stays whole', () => {
      const v = one(`pm.environment.set('v', pm.response.text().match(/"tok":"(.+?)"/)[1]);`);
      expect(v.extractorType).toBe('regex');
      expect(v.pattern).toBe('"tok":"(.+?)"');
    });

    test('xml2Json inline is XPath, not JSON', () => {
      const v = one(`pm.environment.set('v', xml2Json(pm.response.text()).batchInfo.id);`);
      expect(v.extractorType).toBe('xpath');
      expect(v.extractPath).toBe('/batchInfo/id');
    });

    test('a text body read directly has no invented path', () => {
      expect(one(`pm.environment.set('v', pm.response.text());`).extractPath).toBe('$');
    });

    test('a third argument, a ")" in a string and a later setter do not disturb the value', () => {
      expect(one(`bru.setEnvVar('v', res.body.a, { persist: true });`).source).toBe('res.body.a');
      expect(one(`pm.environment.set('v', "a)b");`).source).toBe('"a)b"');
      const two = detector.extractSetVariables(`bru.setVar('a', res.getBody().x); bru.setVar('b', res.getBody().y);`);
      expect(two.map((v) => [v.name, v.extractPath])).toEqual([['a', '$.x'], ['b', '$.y']]);
    });

    test('a setter call that is never closed is ignored', () => {
      expect(detector.extractSetVariables(`pm.environment.set('v', pm.response.json(`)).toEqual([]);
    });
  });

  describe('extractSetVariables()', () => {
    test('returns empty array for null/undefined/empty input', () => {
      expect(detector.extractSetVariables(null)).toEqual([]);
      expect(detector.extractSetVariables(undefined)).toEqual([]);
      expect(detector.extractSetVariables('')).toEqual([]);
      expect(detector.extractSetVariables(123)).toEqual([]);
    });

    test('parses Postman pm.environment.set()', () => {
      const script = `pm.environment.set("access_token", pm.response.json().data.token);`;
      const vars = detector.extractSetVariables(script);
      expect(vars).toHaveLength(1);
      expect(vars[0].name).toBe('access_token');
    });

    test('parses Postman pm.globals.set()', () => {
      const script = `pm.globals.set("session_id", pm.response.json().session);`;
      const vars = detector.extractSetVariables(script);
      expect(vars[0].name).toBe('session_id');
    });

    test('parses Postman pm.collectionVariables.set()', () => {
      const script = `pm.collectionVariables.set("csrf_token", responseData.token);`;
      const vars = detector.extractSetVariables(script);
      expect(vars[0].name).toBe('csrf_token');
    });

    test('parses Bruno bru.setEnv()', () => {
      const script = `bru.setEnv("access_token", res.body.token);`;
      const vars = detector.extractSetVariables(script);
      expect(vars).toHaveLength(1);
      expect(vars[0].name).toBe('access_token');
    });

    test('parses Bruno bru.setEnvVar()', () => {
      const script = `bru.setEnvVar("refresh_token", res.body.refresh_token);`;
      const vars = detector.extractSetVariables(script);
      expect(vars[0].name).toBe('refresh_token');
    });

    test('parses Bruno bru.setVar()', () => {
      const script = `bru.setVar("user_id", res.body.id);`;
      const vars = detector.extractSetVariables(script);
      expect(vars[0].name).toBe('user_id');
    });

    test('parses Bruno bru.setGlobalVar()', () => {
      const script = `bru.setGlobalVar("tenant_id", res.body.tenant);`;
      const vars = detector.extractSetVariables(script);
      expect(vars[0].name).toBe('tenant_id');
    });

    test('parses Bruno legacy env.set()', () => {
      const script = `env.set("token", res.body.data.access_token);`;
      const vars = detector.extractSetVariables(script);
      expect(vars[0].name).toBe('token');
    });

    test('parses Postman legacy postman.setEnvironmentVariable()', () => {
      const script = `postman.setEnvironmentVariable("access_token", responseBody.token);`;
      const vars = detector.extractSetVariables(script);
      expect(vars[0].name).toBe('access_token');
    });

    test('resolves indirect assignment (let id = body.token; bru.setEnv("x", id))', () => {
      const script = [
        'const json = res.getBody();',
        'let token = json.access_token;',
        'bru.setEnv("access_token", token);',
      ].join('\n');
      const vars = detector.extractSetVariables(script);
      expect(vars).toHaveLength(1);
      expect(vars[0].name).toBe('access_token');
    });

    test('handles multiple variable assignments in one script', () => {
      const script = [
        'pm.environment.set("access_token", pm.response.json().access_token);',
        'pm.environment.set("refresh_token", pm.response.json().refresh_token);',
        'pm.environment.set("user_id", pm.response.json().user.id);',
      ].join('\n');
      const vars = detector.extractSetVariables(script);
      expect(vars).toHaveLength(3);
      const names = vars.map(v => v.name);
      expect(names).toContain('access_token');
      expect(names).toContain('refresh_token');
      expect(names).toContain('user_id');
    });

    test('does not duplicate if same variable set twice', () => {
      const script = [
        'pm.environment.set("access_token", pm.response.json().token);',
        'pm.environment.set("access_token", pm.response.json().alt_token);',
      ].join('\n');
      const vars = detector.extractSetVariables(script);
      // first assignment wins
      expect(vars.filter(v => v.name === 'access_token')).toHaveLength(1);
    });

    test('is safe to call multiple times on different strings (BUG-034 regression)', () => {
      // BUG-034: /g regex lastIndex state caused missed matches on second call
      const script1 = `pm.environment.set("token1", res.body.t1);`;
      const script2 = `pm.environment.set("token2", res.body.t2);`;
      const vars1 = detector.extractSetVariables(script1);
      const vars2 = detector.extractSetVariables(script2);
      expect(vars1[0].name).toBe('token1');
      expect(vars2[0].name).toBe('token2');
    });

    test('called 10 times in a row on different strings (BUG-034 stress)', () => {
      for (let i = 0; i < 10; i++) {
        const script = `bru.setEnv("var${i}", res.body.field${i});`;
        const vars = detector.extractSetVariables(script);
        expect(vars).toHaveLength(1);
        expect(vars[0].name).toBe(`var${i}`);
      }
    });
  });

  // ── extractTestScript ────────────────────────────────────────────────────

  describe('extractTestScript()', () => {
    test('returns null for empty request', () => {
      expect(detector.extractTestScript({})).toBeNull();
    });

    test('returns testScript shortcut if present', () => {
      expect(detector.extractTestScript({ testScript: 'my script' })).toBe('my script');
    });

    test('reads Postman req.event[] (listen: "test")', () => {
      const req = {
        event: [
          { listen: 'prerequest', script: { exec: ['// pre'] } },
          { listen: 'test', script: { exec: ['pm.environment.set("x", "y");'] } },
        ],
      };
      const script = detector.extractTestScript(req);
      expect(script).toContain('pm.environment.set');
    });

    test('reads Bruno req.tests[] (listen: "post-response") — Event Storage Rule', () => {
      // CRITICAL: Bruno YAML normalizer stores events in req.tests[], NOT req.event[]
      const req = {
        tests: [
          { listen: 'post-response', script: { exec: ['bru.setEnv("tok", res.body.token);'] } },
        ],
      };
      const script = detector.extractTestScript(req);
      expect(script).toContain('bru.setEnv');
    });

    test('prefers req.tests[] over req.event[] (Event Storage Rule priority)', () => {
      const req = {
        tests: [{ listen: 'test', script: { exec: ['// from tests'] } }],
        event: [{ listen: 'test', script: { exec: ['// from event'] } }],
      };
      const script = detector.extractTestScript(req);
      expect(script).toContain('// from tests');
    });

    test('reads Bruno JSON format req.script.res', () => {
      const req = { script: { res: 'bru.setEnv("id", res.body.id);' } };
      const script = detector.extractTestScript(req);
      expect(script).toContain('bru.setEnv');
    });

    test('reads exec array and joins with newlines', () => {
      const req = {
        event: [{ listen: 'test', script: { exec: ['line1;', 'line2;'] } }],
      };
      const script = detector.extractTestScript(req);
      expect(script).toBe('line1;\nline2;');
    });

    test('reads string tests (plain string format)', () => {
      const req = { tests: 'pm.environment.set("x", "1");' };
      const script = detector.extractTestScript(req);
      expect(script).toContain('pm.environment.set');
    });
  });

  // ── determineExtractorType ───────────────────────────────────────────────

  describe('determineExtractorType()', () => {
    test('returns "json" for null/empty', () => {
      expect(detector.determineExtractorType(null)).toBe('json');
      expect(detector.determineExtractorType('')).toBe('json');
    });

    test('detects header from res.headers reference', () => {
      expect(detector.determineExtractorType('res.headers["x-csrf-token"]')).toBe('header');
      expect(detector.determineExtractorType('pm.response.headers.get("Authorization")')).toBe('header');
    });

    test('detects header from res.getHeader()', () => {
      expect(detector.determineExtractorType('res.getHeader("x-token")')).toBe('header');
    });

    test('detects cookie from res.cookies reference', () => {
      expect(detector.determineExtractorType('res.cookies["session_id"]')).toBe('cookie');
      expect(detector.determineExtractorType('pm.cookies.get("csrf")')).toBe('cookie');
      expect(detector.determineExtractorType('bru.cookies.get("sid")')).toBe('cookie');
    });

    test('detects regex from .match() call', () => {
      expect(detector.determineExtractorType('text.match(/Bearer ([^\\s]+)/)[1]')).toBe('regex');
    });

    test('detects json from res.body reference', () => {
      expect(detector.determineExtractorType('res.body.access_token')).toBe('json');
      expect(detector.determineExtractorType('pm.response.json().data.token')).toBe('json');
      expect(detector.determineExtractorType('body?.token')).toBe('json');
    });

    test('detects json from JSON.parse()', () => {
      expect(detector.determineExtractorType('JSON.parse(responseBody).token')).toBe('json');
    });

    test('defaults to json for unrecognised patterns', () => {
      expect(detector.determineExtractorType('someRandomExpression')).toBe('json');
    });

    test('header check takes priority over body (no false positive on "headers" in body path)', () => {
      // "res.headers" should be header, not accidentally json
      expect(detector.determineExtractorType('res.headers.authorization')).toBe('header');
    });
  });

  // ── extractHeaderName ────────────────────────────────────────────────────

  describe('extractHeaderName()', () => {
    test('returns null for null/empty input', () => {
      expect(detector.extractHeaderName(null)).toBeNull();
      expect(detector.extractHeaderName('')).toBeNull();
    });

    test('extracts from bracket notation: res.headers["x-csrf-token"]', () => {
      expect(detector.extractHeaderName('res.headers["x-csrf-token"]')).toBe('x-csrf-token');
    });

    test('extracts from dot notation: res.headers.authorization', () => {
      expect(detector.extractHeaderName('res.headers.authorization')).toBe('authorization');
    });

    test('extracts from pm.response.headers.get("Name")', () => {
      expect(detector.extractHeaderName('pm.response.headers.get("X-Token")')).toBe('X-Token');
    });

    test('extracts from res.getHeader("name")', () => {
      expect(detector.extractHeaderName('res.getHeader("x-request-id")')).toBe('x-request-id');
    });

    test('extracts from optional chaining: res.headers?.authorization', () => {
      const result = detector.extractHeaderName('res.headers?.authorization');
      expect(result).toBe('authorization');
    });
  });
});
