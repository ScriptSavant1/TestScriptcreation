'use strict';

/**
 * Regression test — reported by the user running a real DevWeb-generated
 * script: the JWT token endpoint returned "invalid_client — Invalid JWT
 * token" because the `aud` claim came out as "https:///as/token.oauth2"
 * (empty host). Root cause: `_audTemplate` placeholders are built from
 * whatever literal string the ORIGINAL script passed to its getter call
 * (e.g. postman.getEnvironmentVariable("iam-host")) — unrestricted, can
 * contain hyphens, dots, anything. The DevWeb generator's placeholder
 * resolution used `/\{(\w+)\}/g`, and `\w` does NOT match a hyphen, so
 * "{iam-host}" was never replaced at all and silently resolved to ''
 * via the `|| ''` fallback.
 *
 * VuGen had the analogous risk via a different mechanism: it built
 * `lr_save_string(lr_eval_string("https://{iam-host}/as/token.oauth2"),
 * "_jwt_aud")`, relying on LoadRunner's OWN native `{name}` parameter
 * substitution rather than JS. Rather than depend on lr_eval_string's
 * exact character-set behavior for parameter names (unverifiable without
 * a real VuGen install), the fix routes this through the SAME JS-based
 * mechanism every other claim already uses: LR.getParam() inside a
 * web_js_run Code= expression, which takes a plain string with no
 * character restriction at all.
 *
 * Covers three name shapes per the reported scenario's exact failure
 * mode: a hyphen (iam-host — the actual reported case), a dot
 * (api.host), and a plain name (token_url, the case that already worked)
 * to guard against a regression in the common case while fixing the rare one.
 */

const AdvancedScriptGenerator = require('../../src/generators/devweb/scriptGenerator.js');
const WebHttpScriptGenerator = require('../../src/generators/vugen/scriptGenerator.js');

describe('DevWeb — aud placeholder resolution handles any variable-name shape', () => {
  function makeGenerator(jwtClaimMap) {
    const g = new AdvancedScriptGenerator([], { info: { name: 'AudNamingTest' } }, {});
    g.hasJwt = true;
    g.jwtClaimMap = jwtClaimMap;
    return g;
  }

  test.each([
    ['hyphenated name (the actual reported bug)', 'iam-host', 'https://{iam-host}/as/token.oauth2'],
    ['dotted name', 'api.host', 'https://{api.host}/as/token.oauth2'],
    ['plain underscore name (already worked — must not regress)', 'token_url', 'https://{token_url}/as/token.oauth2'],
  ])('%s: generated code actually substitutes the param value, not left as a literal placeholder', (_label, paramName, template) => {
    const cm = { iss: 'client_id', output: 'jwt_token', _audTemplate: template, aud: '_jwt_aud' };
    const g = makeGenerator(cm);
    const code = g.generateInitialize();

    // Execute the generated code for real against a fake `load` global —
    // the strongest proof the placeholder actually resolves at runtime,
    // not just a string-match on the source.
    const fakeParams = { [paramName]: 'auth.example.com' };
    const fakeLoad = {
      params: fakeParams,
      config: { user: { args: {} } },
      global: {},
      initialize: (_name, fn) => fn(),
    };
    let capturedClaimMapJson = null;
    let capturedParams = null;
    const fakeGetJwtTokenFromMap = (claimMapJson, params) => {
      capturedClaimMapJson = claimMapJson;
      capturedParams = params;
      return 'fake.jwt.token';
    };
    const fakeGetJwtToken = (params, claimMapJson) => {
      capturedParams = params;
      capturedClaimMapJson = claimMapJson;
      return 'fake.jwt.token';
    };

    const fn = new Function(
      'load',
      'getJwtTokenFromMap',
      'getJwtToken',
      `return (async () => { ${code} })();`,
    );
    return fn(fakeLoad, fakeGetJwtTokenFromMap, fakeGetJwtToken).then(() => {
      expect(capturedParams['_jwt_aud']).toBe('https://auth.example.com/as/token.oauth2');
      expect(capturedParams['_jwt_aud']).not.toContain('{');
      expect(capturedParams['_jwt_aud']).not.toBe('https:///as/token.oauth2');
    });
  });
});

describe('VuGen — aud placeholder resolution handles any variable-name shape', () => {
  function makeGenerator(jwtClaimMap) {
    const g = new WebHttpScriptGenerator([], { info: { name: 'AudNamingTest' } }, {});
    g.hasJwt = true;
    g.jwtClaimMap = jwtClaimMap;
    g.mtlsCertFiles = [];
    g.hasDpop = false;
    g.parameters = new Map();
    g.jsr223ModuleVars = new Set();
    return g;
  }

  test.each([
    ['hyphenated name (the actual reported bug)', 'iam-host', 'https://{iam-host}/as/token.oauth2'],
    ['dotted name', 'api.host', 'https://{api.host}/as/token.oauth2'],
    ['plain underscore name (already worked — must not regress)', 'token_url', 'https://{token_url}/as/token.oauth2'],
  ])('%s: generated Code= resolves via LR.getParam(), not lr_eval_string {name} substitution', (_label, paramName, template) => {
    const cm = { iss: 'client_id', output: 'jwt_token', _audTemplate: template, aud: '_jwt_aud' };
    const g = makeGenerator(cm);
    const code = g.generateVuserInitC();

    // The aud pre-step must call LR.getParam() with the exact raw param name
    // (whatever characters it contains), never lr_eval_string's {name} syntax.
    const expectedExpr = `LR.getParam('${paramName}')`;
    expect(code).toContain(expectedExpr);
    expect(code).not.toContain(`lr_eval_string("${template}")`);

    // Execute the extracted Code= expression for real against a fake LR object.
    const audStepMatch = code.match(/"Code=(LR\.setParam\([\s\S]*?)\);"/);
    expect(audStepMatch).not.toBeNull();
    // Decode the C string literal the way the C compiler / VuGen does (\\ → \, \" → "),
    // so what runs below is exactly the JavaScript VuGen's engine receives.
    const jsCode = JSON.parse('"' + audStepMatch[1] + '"');
    // VuGen scans Code= for "//" line comments and warns (MWAR-26311) — the
    // 'https://' in the aud template must reach it escaped, not literal.
    expect(jsCode).not.toContain('//');
    const fakeParams = { [paramName]: 'auth.example.com' };
    const sandboxParams = {};
    const LR = {
      getParam: (k) => (fakeParams[k] !== undefined ? fakeParams[k] : (sandboxParams[k] || '')),
      setParam: (k, v) => { sandboxParams[k] = v; },
    };
    const fn = new Function('LR', `${jsCode});`);
    fn(LR);
    expect(sandboxParams['_jwt_aud']).toBe('https://auth.example.com/as/token.oauth2');
    expect(sandboxParams['_jwt_aud']).not.toContain('{');
  });
});
