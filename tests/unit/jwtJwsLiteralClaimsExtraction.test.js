'use strict';

/**
 * Regression test — a real banking client's Postman pre-request script used
 * KJUR.jws.JWS.sign("PS256", ...) with header { kid, typ: "JWS", alg: "PS256" }
 * and payload containing two LITERAL custom claims ("openbanking-intent-id",
 * "login_hint_token") plus a concatenated "aud" built from a literal + a
 * getter call. None of this was extracted before: extractJwtClaimMap() only
 * ever matched `claim: getter("param")` — a literal value, a hyphenated claim
 * name, and a concatenation expression all fell through silently.
 *
 * Three independent gaps, fixed together:
 *   1. Literal claim values ("claim": "value") were never matched at all.
 *   2. Hyphenated claim names ("openbanking-intent-id") weren't matched even
 *      by the getter-based regex (\w+ doesn't include "-").
 *   3. A concatenated "aud" ("https://" + getter(...) + "/path") wasn't
 *      recognized — only the pre-existing Java/JMX `_audTemplate` mechanism
 *      handled this pattern, and only for the JMeter extraction path.
 *
 * Also guards against a bug these fixes could have reintroduced: the
 * literal-value regex must not truncate a multi-line concatenated value at
 * its first newline (see customScriptParser.js's lookahead-based terminator
 * comment), and the claim regex must not treat a `var prvKey = getter(...)`
 * KEY-VARIABLE declaration as if "prvKey" were itself a claim name (which
 * would leak the raw private key into extraClaims, and from there into the
 * signed JWT's payload once consumed by getJwtTokenFromMap/createJWTFromMap).
 */

const CustomScriptParser = require('../../src/analyzers/customScriptParser.js');

const REAL_SCRIPT = `
var uuid = require('uuid');
eval(postman.getGlobalVariable("jsrsasign-js"));

var header = { "kid": postman.getEnvironmentVariable("signing_kid"),"typ": "JWS","alg": "PS256"};
var date = Math.round(Date.now()/1000);
var data = {
    "iss": postman.getEnvironmentVariable("client_id"),
    "sub": postman.getEnvironmentVariable("client_id"),
  "aud": "https://"
            + postman.getEnvironmentVariable("iam-host")
            + "/as/token.oauth2",
  "jti": uuid.v4(),
  "exp": date + 600,
  "iat": date,
  "openbanking-intent-id": "consentid",
  "login_hint_token": "loginhinttoken",
  "scope": postman.getEnvironmentVariable("scope")
};

var prvKey = postman.getEnvironmentVariable("secret");
var sHeader = JSON.stringify(header);
var sPayload = JSON.stringify(data);
var sJWT = KJUR.jws.JWS.sign("PS256", sHeader, sPayload, prvKey);
postman.setEnvironmentVariable("jwt_token", sJWT);
`;

describe('CustomScriptParser.extractJwtClaimMap() — JWS/literal-claim scenario', () => {
  let map;
  beforeAll(() => {
    map = CustomScriptParser.extractJwtClaimMap(REAL_SCRIPT);
  });

  test('getter-sourced standard claims still extracted (no regression)', () => {
    expect(map.kid).toBe('signing_kid');
    expect(map.iss).toBe('client_id');
    expect(map.sub).toBe('client_id');
    expect(map.scope).toBe('scope');
    expect(map.secret).toBe('secret');
    expect(map.output).toBe('jwt_token');
  });

  test('literal typ/alg are merged directly into the top-level fields', () => {
    expect(map.typ).toBe('JWS');
    expect(map.alg).toBe('PS256');
  });

  test('hyphenated + plain literal custom claims land in literalClaims', () => {
    expect(map.literalClaims).toEqual({
      'openbanking-intent-id': 'consentid',
      login_hint_token: 'loginhinttoken',
    });
  });

  test('concatenated aud produces the SAME _audTemplate mechanism the JMeter/Java path uses', () => {
    expect(map._audTemplate).toBe('https://{iam-host}/as/token.oauth2');
    expect(map.aud).toBe('_jwt_aud');
  });

  test('the key-variable declaration (var prvKey = getter("secret")) is NOT captured as a claim', () => {
    // Regression guard: this used to leak into extraClaims.prvKey, and from
    // there getJwtTokenFromMap()/createJWTFromMap() would inject the raw
    // private key value into the JWT's PAYLOAD as a visible "prvKey" claim.
    expect(map.extraClaims).toBeUndefined();
    expect(map.literalClaims.prvKey).toBeUndefined();
  });

  test('detectJwtUsage() still reports PS256/jsrsasign correctly for this script', () => {
    const detection = CustomScriptParser.detectJwtUsage(REAL_SCRIPT);
    expect(detection.isJwt).toBe(true);
    expect(detection.library).toBe('jsrsasign');
    expect(detection.algorithm).toBe('PS256');
  });

  test('property-assignment claims (data.iss = getter(...), not a declaration) still match', () => {
    const script = `
      var data = {};
      data.iss = postman.getEnvironmentVariable('client_id');
      var sJWT = KJUR.jws.JWS.sign('PS256', h, JSON.stringify(data), key);
      postman.setEnvironmentVariable('jwt_token', sJWT);
    `;
    const m = CustomScriptParser.extractJwtClaimMap(script);
    expect(m.iss).toBe('client_id');
  });

  test('a literal value split across a multi-line concatenation is not truncated at the first newline', () => {
    const script = `
      var data = {
        "aud": "https://"
          + postman.getEnvironmentVariable("host")
          + "/token",
        "scope": "accounts"
      };
    `;
    const m = CustomScriptParser.extractJwtClaimMap(script);
    expect(m._audTemplate).toBe('https://{host}/token');
    // "scope" is a getter-pattern miss here (literal, not getter) but must
    // still be captured by the literal pass, not swallowed by the aud regex.
    expect(m.literalClaims).toBeUndefined(); // "scope" is a standard claim name, not a custom one
  });
});
