'use strict';

/**
 * Regression test — DevWeb's PRIMARY JWT generation (generateInitialize()
 * and the refresh block inside generateAction()) ALWAYS called getJwtToken(),
 * which has a fixed claim shape (kid/iss/sub/aud/scope + hardcoded typ:"JWT")
 * and no way to carry custom claims. A real client script using typ:"JWS"
 * plus hyphenated custom claims (see jwtJwsLiteralClaimsExtraction.test.js)
 * would silently lose everything getJwtToken() can't express.
 *
 * Fix: _jwtClaimMapNeedsTokenFromMap() routes to getJwtTokenFromMap() instead,
 * whenever the claim map carries extraClaims, literalClaims, or a non-default
 * typ. The per-request JWT path already had partial routing logic (for
 * extraClaims only) — this test also guards the fix to that path's own gap:
 * the dynamic-aud injection used to only happen in the getJwtToken() branch,
 * silently dropping aud whenever a per-request JWT combined extraClaims with
 * a concatenated aud.
 *
 * Every test here must hold simultaneously with the OLD, already-working
 * scenario: a plain claim map (no typ override, no custom claims) must keep
 * calling getJwtToken() with byte-identical code, so existing client scripts
 * are not affected by this change at all.
 */

const AdvancedScriptGenerator = require('../../src/generators/devweb/scriptGenerator.js');

function makeGenerator(jwtClaimMap) {
  const g = new AdvancedScriptGenerator([], { info: { name: 'JwtJwsRoutingTest' } }, {});
  g.hasJwt = true;
  g.jwtClaimMap = jwtClaimMap;
  return g;
}

const NEW_SCENARIO_CM = {
  kid: 'signing_kid',
  iss: 'client_id',
  sub: 'client_id',
  scope: 'scope',
  secret: 'secret',
  output: 'jwt_token',
  typ: 'JWS',
  alg: 'PS256',
  literalClaims: {
    'openbanking-intent-id': 'consentid',
    login_hint_token: 'loginhinttoken',
  },
  _audTemplate: 'https://{iam-host}/as/token.oauth2',
  aud: '_jwt_aud',
};

const OLD_SCENARIO_CM = {
  iss: 'client_id',
  sub: 'client_id',
  aud: 'token_url',
  scope: 'scope',
  kid: 'signing_kid',
  secret: 'secret',
  output: 'client_assertion',
};

describe('DevWeb JWT generation routes to getJwtTokenFromMap() for JWS/custom-claim scripts', () => {
  test('_jwtClaimMapNeedsTokenFromMap() is true for typ override and for literalClaims, false for a plain map', () => {
    const g = makeGenerator(NEW_SCENARIO_CM);
    expect(g._jwtClaimMapNeedsTokenFromMap(NEW_SCENARIO_CM)).toBe(true);
    expect(g._jwtClaimMapNeedsTokenFromMap(OLD_SCENARIO_CM)).toBe(false);
    expect(g._jwtClaimMapNeedsTokenFromMap({ typ: 'JWT' })).toBe(false); // default typ, not an override
    expect(g._jwtClaimMapNeedsTokenFromMap({ extraClaims: { x: 'y' } })).toBe(true);
  });

  test('generateInitialize() calls getJwtTokenFromMap() with the full claim map, including literalClaims/typ, for the new scenario', () => {
    const g = makeGenerator(NEW_SCENARIO_CM);
    const code = g.generateInitialize();

    expect(code).toContain('getJwtTokenFromMap(');
    expect(code).not.toContain('getJwtToken(_jwtParams');
    expect(code).toContain('"typ":"JWS"');
    expect(code).toContain('"login_hint_token":"loginhinttoken"');
    expect(code).toContain('"openbanking-intent-id":"consentid"');
    // Dynamic aud resolution still happens before the call, same mechanism as before.
    expect(code).toContain("_jwtParams['_jwt_aud']");
    expect(() => new Function(code)).not.toThrow();
  });

  test('generateAction() refresh block also routes to getJwtTokenFromMap() for the new scenario', () => {
    const g = makeGenerator(NEW_SCENARIO_CM);
    g.requestTxMap = new Map();
    const code = g.generateAction();

    expect(code).toContain('getJwtTokenFromMap(');
    expect(code).toContain('if (!load.global.jwt_token || Date.now() >= load.global.jwt_expires_at)');
  });

  test('generateHeader() imports getJwtTokenFromMap when the PRIMARY claim map needs it (not just for per-request JWTs)', () => {
    const g = makeGenerator(NEW_SCENARIO_CM);
    const header = g.generateHeader();
    expect(header).toContain("const { getJwtToken, getJwtTokenFromMap } = require('./jwt-helper.js');");
  });

  test('REGRESSION: a plain old-style claim map still generates byte-identical getJwtToken() code', () => {
    const g = makeGenerator(OLD_SCENARIO_CM);
    const code = g.generateInitialize();

    expect(code).toContain('load.global.client_assertion = getJwtToken(_jwtParams,');
    expect(code).not.toContain('getJwtTokenFromMap');
    expect(() => new Function(code)).not.toThrow();
  });

  test('REGRESSION: generateHeader() does NOT import getJwtTokenFromMap for an old-style-only claim map', () => {
    const g = makeGenerator(OLD_SCENARIO_CM);
    const header = g.generateHeader();
    expect(header).toContain("const { getJwtToken } = require('./jwt-helper.js');");
    expect(header).not.toContain('getJwtTokenFromMap');
  });

  test('REGRESSION: generateAction() refresh block for the old scenario is unchanged', () => {
    const g = makeGenerator(OLD_SCENARIO_CM);
    g.requestTxMap = new Map();
    const code = g.generateAction();
    expect(code).toContain('load.global.client_assertion = getJwtToken(_jwtParams,');
    expect(code).not.toContain('getJwtTokenFromMap');
  });
});

describe('DevWeb per-request JWT — dynamic aud now resolved for BOTH getJwtToken and getJwtTokenFromMap branches', () => {
  function makePerRequestGenerator(cm, outputvar) {
    const g = new AdvancedScriptGenerator([], { info: { name: 'PerReqJwtTest' } }, {});
    g.perRequestJwt = new Map([['MyRequest', { claimMap: cm, outputvar }]]);
    return g;
  }

  test('a per-request JWT with BOTH extraClaims AND a templated aud resolves aud correctly (previously silently dropped)', () => {
    const cm = {
      iss: 'client_id',
      extraClaims: { software_statement: 'software_statement_param' },
      secret: 'secret',
      kid: 'signing_kid',
      _audTemplate: 'https://{host}/token',
      aud: '_jwt_aud',
    };
    const g = makePerRequestGenerator(cm, 'reg_jwt');

    // The per-request JWT emission lives inline in generateRequestCode().
    const request = { name: 'MyRequest', headers: [], url: 'https://x', method: 'GET' };
    const block = g.generateRequestCode(request, 1);

    expect(block).toContain("_jwtAud_reg_jwt");
    expect(block).toContain("_jwtParams_reg_jwt['_jwt_aud'] = _jwtAud_reg_jwt");
    expect(block).toContain('getJwtTokenFromMap(');
  });
});
