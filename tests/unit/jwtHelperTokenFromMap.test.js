'use strict';

/**
 * Unit tests for jwt-helper.js's getJwtTokenFromMap() — verifies the fix
 * that made `typ` dynamic (previously hardcoded to "JWT" unconditionally,
 * even though `alg` was already read from cm.alg) and added support for
 * cm.literalClaims (values applied as-is, no param resolution — unlike
 * cm.extraClaims, which resolves each value as a PARAM NAME via `resolve()`).
 *
 * getJwtTokenFromMap() references the DevWeb SDK's global `load` object
 * (load.config.user.args, load.utils.uuid()) without importing it — DevWeb
 * provides this as a real global at runtime. Mocked here the same way.
 */

const { getJwtTokenFromMap } = require('../../jwt-helper.js');
const crypto = require('crypto');

function b64uDecode(s) {
  return JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
}

function verifyPssSignature(signingInput, sigB64Url, publicKeyPem) {
  const sigB64 = sigB64Url.replace(/-/g, '+').replace(/_/g, '/');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(
    { key: publicKeyPem, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
    sigB64,
    'base64'
  );
}

describe('jwt-helper.js getJwtTokenFromMap()', () => {
  let keyPair;

  beforeAll(() => {
    keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  });

  beforeEach(() => {
    global.load = { config: { user: { args: {} } }, utils: { uuid: () => 'fixed-uuid' } };
  });

  afterEach(() => {
    delete global.load;
  });

  test('typ defaults to "JWT" when not specified (no regression for the existing behavior)', () => {
    const params = { secret: keyPair.privateKey };
    const token = getJwtTokenFromMap({ secret: 'secret' }, params);
    const header = b64uDecode(token.split('.')[0]);
    expect(header.typ).toBe('JWT');
    expect(header.alg).toBe('PS256');
  });

  test('typ is overridden by cm.typ when present (the actual reported bug)', () => {
    const params = { secret: keyPair.privateKey };
    const token = getJwtTokenFromMap({ secret: 'secret', typ: 'JWS' }, params);
    const header = b64uDecode(token.split('.')[0]);
    expect(header.typ).toBe('JWS');
  });

  test('literalClaims are applied as-is into the payload, not resolved as param names', () => {
    const params = { secret: keyPair.privateKey };
    const cm = {
      secret: 'secret',
      literalClaims: { 'openbanking-intent-id': 'consentid', login_hint_token: 'loginhinttoken' },
    };
    const token = getJwtTokenFromMap(cm, params);
    const payload = b64uDecode(token.split('.')[1]);
    expect(payload['openbanking-intent-id']).toBe('consentid');
    expect(payload.login_hint_token).toBe('loginhinttoken');
  });

  test('extraClaims still resolve as PARAM NAMES (no regression) and coexist with literalClaims', () => {
    const params = { secret: keyPair.privateKey, software_statement_param: 'resolved-value' };
    const cm = {
      secret: 'secret',
      extraClaims: { software_statement: 'software_statement_param' },
      literalClaims: { fixed_claim: 'fixed-value' },
    };
    const token = getJwtTokenFromMap(cm, params);
    const payload = b64uDecode(token.split('.')[1]);
    expect(payload.software_statement).toBe('resolved-value');
    expect(payload.fixed_claim).toBe('fixed-value');
  });

  test('the resulting token is a validly-signed PS256 JWT end to end', () => {
    // cm.kid/cm.iss are PARAM NAMES to resolve (same convention as cm.aud/cm.sub/cm.scope),
    // unlike cm.typ/cm.alg (used directly as literal header values) and cm.literalClaims
    // (used directly as literal payload values) — resolve()'d via load.config.user.args/params.
    const params = { secret: keyPair.privateKey };
    const cm = {
      secret: 'secret',
      kid: 'signing_kid',
      typ: 'JWS',
      iss: 'client_id',
      literalClaims: { custom: 'value' },
    };
    global.load.config.user.args = { client_id: 'my-client', signing_kid: 'kid-1' };
    const token = getJwtTokenFromMap(cm, params);
    const [h, p, s] = token.split('.');
    expect(verifyPssSignature(h + '.' + p, s, keyPair.publicKey)).toBe(true);
    const header = b64uDecode(h);
    const payload = b64uDecode(p);
    expect(header.typ).toBe('JWS');
    expect(header.kid).toBe('kid-1');
    expect(payload.iss).toBe('my-client');
    expect(payload.custom).toBe('value');
  });
});
