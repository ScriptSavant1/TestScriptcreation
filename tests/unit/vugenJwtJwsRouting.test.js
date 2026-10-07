'use strict';

/**
 * Regression test — VuGen's PRIMARY JWT generation (generateVuserInitC()'s
 * jwtInitBlock and generateActionC()'s jwtSetup refresh block) ALWAYS called
 * the fixed-shape createJWT()/refreshJWT(), which hardcode typ:"JWT" and
 * cannot carry custom claims — the same gap DevWeb had (see
 * devwebJwtJwsRouting.test.js), fixed the same way: route to
 * createJWTFromMap()/refreshJWTFromMap() (new function, added to
 * lre-utils.js alongside refreshJWT) whenever the claim map carries
 * extraClaims, literalClaims, or a non-default typ.
 *
 * Also guards two VuGen-specific bugs found and fixed while verifying this
 * end-to-end against the real reported script (see
 * scratchpad-jwt-test/test-full-pipeline.js during development):
 *
 *   1. A hyphenated/arbitrary claim name used as a BARE (unquoted) JS object
 *      key is invalid syntax — "openbanking-intent-id":value parses fine,
 *      but openbanking-intent-id:value parses as a subtraction expression.
 *      Every claim name written into the generated object literal must be
 *      quoted.
 *   2. The per-request JWT's extraClaims branch never resolved a templated
 *      aud at all (no lr_save_string() pre-step existed in that branch),
 *      silently sending an empty aud whenever a per-request JWT combined
 *      extraClaims with a concatenated aud expression.
 *
 * Every test here must hold simultaneously with the OLD, already-working
 * scenario: a plain claim map must keep generating byte-identical
 * createJWT()/refreshJWT() C code.
 */

const WebHttpScriptGenerator = require('../../src/generators/vugen/scriptGenerator.js');

function makeGenerator(jwtClaimMap) {
  const g = new WebHttpScriptGenerator([], { info: { name: 'VugenJwtJwsRoutingTest' } }, {});
  g.hasJwt = true;
  g.jwtClaimMap = jwtClaimMap;
  g.mtlsCertFiles = [];
  g.hasDpop = false;
  g.parameters = new Map();
  g.jsr223ModuleVars = new Set();
  g.requests = [];
  g.perRequestVars = new Map();
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
  secret: 'private_key',
  output: 'jwt_token',
};

describe('VuGen JWT generation routes to createJWTFromMap()/refreshJWTFromMap() for JWS/custom-claim scripts', () => {
  test('_jwtClaimMapNeedsTokenFromMap() matches the DevWeb-side decision rule', () => {
    const g = makeGenerator(NEW_SCENARIO_CM);
    expect(g._jwtClaimMapNeedsTokenFromMap(NEW_SCENARIO_CM)).toBe(true);
    expect(g._jwtClaimMapNeedsTokenFromMap(OLD_SCENARIO_CM)).toBe(false);
  });

  test('generateVuserInitC() routes to createJWTFromMap() with quoted hyphenated claim keys', () => {
    const g = makeGenerator(NEW_SCENARIO_CM);
    const code = g.generateVuserInitC();

    expect(code).toContain('createJWTFromMap(');
    expect(code).not.toContain('createJWT(LR.getParam');
    expect(code).toContain("'openbanking-intent-id':'consentid'");
    expect(code).toContain("'login_hint_token':'loginhinttoken'");
    expect(code).toContain("_typ:'JWS'");
    // Dynamic aud is resolved via LR.getParam() inside web_js_run's own JS engine,
    // not lr_eval_string()'s native {name} substitution — see
    // _buildJwtAudResolutionStep's doc comment for why (hyphenated param names).
    expect(code).toContain("Code=LR.setParam('_jwt_aud', 'https://'+LR.getParam('iam-host')+'/as/token.oauth2');");
  });

  test('generateActionC() refresh block routes to refreshJWTFromMap() for the new scenario', () => {
    const g = makeGenerator(NEW_SCENARIO_CM);
    const code = g.generateActionC();
    expect(code).toContain('refreshJWTFromMap(');
    expect(code).not.toContain('refreshJWT(LR.getParam');
  });

  test('REGRESSION: a plain old-style claim map still generates byte-identical createJWT()/refreshJWT() C code', () => {
    const g1 = makeGenerator(OLD_SCENARIO_CM);
    const init = g1.generateVuserInitC();
    expect(init).toContain("createJWT(LR.getParam('client_id'), LR.getParam('token_url'), LR.getParam('scope'), LR.getParam('signing_kid'), LR.getParam('private_key'))");
    expect(init).not.toContain('createJWTFromMap');

    const g2 = makeGenerator(OLD_SCENARIO_CM);
    const action = g2.generateActionC();
    expect(action).toContain("refreshJWT(LR.getParam('client_id'), LR.getParam('token_url'), LR.getParam('scope'), LR.getParam('signing_kid'), LR.getParam('private_key'), '_jwt_token')");
    expect(action).not.toContain('refreshJWTFromMap');
  });
});

describe('VuGen per-request JWT — hyphenated keys quoted + dynamic aud resolved in the Map branch', () => {
  function makePerRequestGenerator(cm, outputvar) {
    const g = makeGenerator(null);
    g.hasJwt = false; // per-request JWT is independent of the primary JWT flag
    g.perRequestJwt = new Map([['MyRequest', { claimMap: cm, outputvar }]]);
    return g;
  }

  test('extraClaims + hyphenated literalClaims + templated aud all come through correctly, with keys quoted', () => {
    const cm = {
      iss: 'client_id',
      extraClaims: { software_statement: 'software_statement_param' },
      literalClaims: { 'x-custom-claim': 'literal-value' },
      secret: 'secret',
      kid: 'signing_kid',
      _audTemplate: 'https://{host}/token',
      aud: '_jwt_aud',
    };
    const g = makePerRequestGenerator(cm, 'reg_jwt');
    const block = g.generatePerRequestJwtCode({ name: 'MyRequest' }, '  ');

    expect(block).toContain("Code=LR.setParam('_jwt_aud_reg_jwt', 'https://'+LR.getParam('host')+'/token');");
    expect(block).toContain("aud:LR.getParam('_jwt_aud_reg_jwt')");
    expect(block).toContain("'software_statement':LR.getParam('software_statement_param')");
    expect(block).toContain("'x-custom-claim':'literal-value'");
    expect(block).toContain('createJWTFromMap(');
  });

  test('REGRESSION: a standard-claim-only per-request JWT (no extraClaims) still uses createJWT() unchanged', () => {
    const cm = { iss: 'client_id', aud: 'token_url', scope: 'scope', kid: 'signing_kid', secret: 'private_key' };
    const g = makePerRequestGenerator(cm, 'reg_jwt');
    const block = g.generatePerRequestJwtCode({ name: 'MyRequest' }, '  ');
    expect(block).toContain("createJWT(LR.getParam('client_id'), LR.getParam('token_url'), LR.getParam('scope'), LR.getParam('signing_kid'), LR.getParam('private_key'))");
    expect(block).not.toContain('createJWTFromMap');
  });
});
