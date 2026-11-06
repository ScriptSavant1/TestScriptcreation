'use strict';

/**
 * Regression test — DevWeb generator hardcoded the JWT token's storage
 * variable as `load.global.jwt_token` in BOTH generateInitialize() and the
 * refresh block inside generateAction(), instead of using the REAL output
 * variable name the original Postman/Bruno pre-request script used (e.g.
 * `pm.environment.set('client_assertion', signedJwt)` -> extracted into
 * `this.jwtClaimMap.output` by CustomScriptParser.extractJwtClaimMap()).
 *
 * Meanwhile, replaceParameters() substitutes {{client_assertion}} in request
 * bodies/headers as `load.global.client_assertion` (see the `dynamicVarNames`
 * branch). Since `client_assertion` was never assigned anywhere (the JWT
 * result went into the unrelated `jwt_token` variable instead), every
 * generated request that used the JWT sent `undefined` for it — completely
 * silent, since `node --check` sees perfectly valid JavaScript.
 *
 * This bug is only invisible when a collection's JWT output variable happens
 * to be literally named "jwt_token" — a name jsrsasign/jose example code
 * rarely uses in practice (real APIs call it `client_assertion`, `id_token`,
 * `signed_jwt`, etc.), which is why it went undetected.
 *
 * VuGen's generator (src/generators/vugen/scriptGenerator.js) was checked
 * and does NOT have this bug — it already uses the real output var name for
 * ResultParam= (e.g. `ResultParam=_client_assertion`).
 */

const AdvancedScriptGenerator = require('../../src/generators/devweb/scriptGenerator.js');

function makeGenerator(jwtClaimMap) {
  const g = new AdvancedScriptGenerator([], { info: { name: 'JwtOutputVarTest' } }, {});
  g.hasJwt = true;
  g.jwtClaimMap = jwtClaimMap;
  return g;
}

describe('DevWeb JWT generation uses the real output variable name', () => {
  test('generateInitialize() stores the token under claimMap.output, not a hardcoded "jwt_token"', () => {
    const g = makeGenerator({ iss: 'client_id', sub: 'client_id', aud: 'token_url', output: 'client_assertion' });
    const code = g.generateInitialize();

    expect(code).toContain('load.global.client_assertion = getJwtToken(');
    expect(code).not.toContain('load.global.jwt_token');
    expect(() => new Function(code)).not.toThrow();
  });

  test('generateAction() refresh check/assignment uses the same output variable, consistently', () => {
    const g = makeGenerator({ iss: 'client_id', sub: 'client_id', aud: 'token_url', output: 'client_assertion' });
    const code = g.generateAction();

    // Both the guard condition and the reassignment must reference the SAME
    // variable that request bodies actually read — a mismatch here would
    // mean the refresh gate and the "real" variable go out of sync.
    expect(code).toContain('if (!load.global.client_assertion || Date.now() >= load.global.jwt_expires_at)');
    expect(code).toContain('load.global.client_assertion = getJwtToken(');
    expect(code).not.toContain('load.global.jwt_token');
    expect(() => new Function(code)).not.toThrow();
  });

  test('output variable name is sanitized for use as a JS identifier', () => {
    // Real-world variable names can contain hyphens (e.g. from a Postman
    // env var called "client-assertion") which are invalid in load.global.X
    // dot-notation — sanitizeVarName() must be applied, matching every other
    // dynamic-variable code path in this file (see corr.name usage).
    const g = makeGenerator({ output: 'client-assertion-jwt' });
    const code = g.generateInitialize();
    expect(code).not.toMatch(/load\.global\.client-assertion-jwt/);
    expect(() => new Function(code)).not.toThrow();
  });

  test('falls back to "jwt_token" when no claim map / output var was detected', () => {
    const g = makeGenerator(null);
    const code = g.generateInitialize();
    expect(code).toContain('load.global.jwt_token = getJwtToken(');
    expect(() => new Function(code)).not.toThrow();
  });

  test('a claim map without an "output" key also falls back to "jwt_token"', () => {
    const g = makeGenerator({ iss: 'client_id' }); // no .output
    const code = g.generateInitialize();
    expect(code).toContain('load.global.jwt_token = getJwtToken(');
  });
});
