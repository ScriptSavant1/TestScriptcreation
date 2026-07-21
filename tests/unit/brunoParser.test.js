/**
 * Unit tests for BrunoParser.parseBruContent()
 *
 * parseBruContent() is a pure synchronous function — takes .bru file text,
 * returns a normalised request object. No filesystem access, easy to test.
 *
 * IMPORTANT: This parser uses section names WITHOUT curly braces.
 * Correct format:  "headers\n  Key: Value"
 * NOT:             "headers {\n  Key: Value\n}"
 *
 * Headers are stored as { key, value } (not { name, value }).
 * Test section entries are stored as { type, script } objects in req.tests[].
 */

'use strict';

const BrunoParser = require('../../src/parsers/brunoParser');

function parse(content) {
  const parser = new BrunoParser('/fake/path.bru');
  return parser.parseBruContent(content);
}

describe('BrunoParser.parseBruContent()', () => {

  // ── basic structure ──────────────────────────────────────────────────────

  test('returns default structure for empty input', () => {
    const req = parse('');
    expect(req.method).toBe('GET');
    expect(req.url).toBe('');
    expect(req.headers).toEqual([]);
    expect(req.body).toBeNull();
    expect(req.tests).toEqual([]);
  });

  test('parses GET request with URL', () => {
    const req = parse('get https://api.example.com/users\n');
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.example.com/users');
  });

  test('parses POST request', () => {
    const req = parse('post https://api.example.com/login\n');
    expect(req.method).toBe('POST');
  });

  test('parses PUT request', () => {
    const req = parse('put https://api.example.com/resource/1\n');
    expect(req.method).toBe('PUT');
  });

  test('parses DELETE request', () => {
    const req = parse('delete https://api.example.com/resource/1\n');
    expect(req.method).toBe('DELETE');
  });

  test('normalises method to uppercase regardless of input case', () => {
    expect(parse('GET https://x.com\n').method).toBe('GET');
    expect(parse('get https://x.com\n').method).toBe('GET');
    expect(parse('Post https://x.com\n').method).toBe('POST');
  });

  // ── meta section ─────────────────────────────────────────────────────────

  test('parses meta section name', () => {
    const bru = 'meta\nname: Login Request\n\nget https://api.example.com/login\n';
    const req = parse(bru);
    expect(req.name).toBe('Login Request');
  });

  // ── headers section ──────────────────────────────────────────────────────

  test('parses headers section — stored as { key, value }', () => {
    // Note: section name is bare "headers" (no curly braces)
    const bru = [
      'get https://api.example.com/users',
      '',
      'headers',
      'Content-Type: application/json',
      'Accept: application/json',
    ].join('\n');
    const req = parse(bru);
    expect(req.headers.length).toBeGreaterThanOrEqual(1);
    const ct = req.headers.find(h => h.key === 'Content-Type');
    expect(ct).toBeDefined();
    expect(ct.value).toBe('application/json');
  });

  test('parses Authorization header with {{variable}} value', () => {
    const bru = [
      'get https://api.example.com/me',
      '',
      'headers',
      'Authorization: Bearer {{access_token}}',
    ].join('\n');
    const req = parse(bru);
    const auth = req.headers.find(h => h.key === 'Authorization');
    expect(auth).toBeDefined();
    expect(auth.value).toContain('{{access_token}}');
  });

  // ── URL with template variables (URL Rule) ────────────────────────────────

  test('preserves {{variable}} in URL without percent-encoding', () => {
    // CRITICAL: URLs with {{variables}} must NOT be passed through new URL()
    // This test verifies the parser stores them raw so callers can use url.split('?')
    const req = parse('get https://{{baseUrl}}/api/users\n');
    expect(req.url).toBe('https://{{baseUrl}}/api/users');
    expect(req.url).not.toContain('%7B%7B');
  });

  // ── body sections ─────────────────────────────────────────────────────────

  test('parses body:json section', () => {
    const bru = [
      'post https://api.example.com/login',
      '',
      'body:json',
      '{"username": "admin", "password": "secret"}',
    ].join('\n');
    const req = parse(bru);
    expect(req.body).toBeTruthy();
    expect(req.body.raw).toContain('username');
  });

  test('parses plain body section', () => {
    const bru = [
      'post https://api.example.com/data',
      '',
      'body',
      'raw text payload',
    ].join('\n');
    const req = parse(bru);
    expect(req.body).toBeTruthy();
    expect(req.body.raw).toContain('raw text payload');
  });

  // ── tests / script section (Event Storage Rule) ───────────────────────────

  test('parses tests section — stored in req.tests[] as { type, script }', () => {
    // CRITICAL EVENT STORAGE RULE:
    // Bruno YAML parser normalises scripts into req.tests[].
    // CorrelationDetector.extractTestScript() reads req.tests[] first.
    // This test verifies the raw parseBruContent() format so we know
    // what normalizeRequest() (called later) must convert.
    const bru = [
      'post https://api.example.com/login',
      '',
      'tests',
      'bru.setEnv("access_token", res.body.token);',
    ].join('\n');
    const req = parse(bru);
    expect(Array.isArray(req.tests)).toBe(true);
    expect(req.tests.length).toBeGreaterThan(0);
    // Each entry is { type: 'tests', script: '...' }
    const testEntry = req.tests[0];
    expect(testEntry.script).toContain('bru.setEnv');
  });

  test('parses script section (alternative to tests)', () => {
    const bru = [
      'post https://api.example.com/login',
      '',
      'script',
      'pm.environment.set("token", pm.response.json().token);',
    ].join('\n');
    const req = parse(bru);
    expect(req.tests.length).toBeGreaterThan(0);
    expect(req.tests[0].script).toContain('pm.environment.set');
  });

  // ── auth sections ─────────────────────────────────────────────────────────

  test('parses auth:bearer section', () => {
    const bru = [
      'get https://api.example.com/me',
      '',
      'auth:bearer',
      'token: {{access_token}}',
    ].join('\n');
    const req = parse(bru);
    expect(req.auth).toBeTruthy();
    expect(req.auth.type).toBe('bearer');
    expect(req.auth.bearer[0].value).toContain('access_token');
  });

  test('parses auth:basic section', () => {
    const bru = [
      'get https://api.example.com/resource',
      '',
      'auth:basic',
      'username: admin',
      'password: secret',
    ].join('\n');
    const req = parse(bru);
    expect(req.auth).toBeTruthy();
    expect(req.auth.type).toBe('basic');
    const usr = req.auth.basic.find(f => f.key === 'username');
    expect(usr.value).toBe('admin');
  });

  // ── comment handling ──────────────────────────────────────────────────────

  test('ignores // comment lines', () => {
    const bru = [
      '// This is a comment',
      'get https://api.example.com/users',
      '// Another comment',
    ].join('\n');
    const req = parse(bru);
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.example.com/users');
  });

  // ── vars section ──────────────────────────────────────────────────────────

  test('parses vars section into req.vars map', () => {
    const bru = [
      'get https://api.example.com/users',
      '',
      'vars',
      'userId: 12345',
      'region: eu-west',
    ].join('\n');
    const req = parse(bru);
    expect(req.vars).toBeDefined();
    expect(req.vars.userId).toBe('12345');
    expect(req.vars.region).toBe('eu-west');
  });
});
