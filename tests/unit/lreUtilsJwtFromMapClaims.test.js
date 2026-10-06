'use strict';

/**
 * Unit tests for lre-utils.js's createJWTFromMap() typ/alg support and the
 * new refreshJWTFromMap() function, added so VuGen's PRIMARY JWT path (not
 * just per-request JWTs) can carry a non-default typ (e.g. "JWS") or custom
 * claims — mirroring jwt-helper.js's getJwtTokenFromMap() fix on the DevWeb
 * side (see jwtHelperTokenFromMap.test.js).
 *
 * createJWTFromMap() previously hardcoded header = {alg:"PS256", typ:"JWT", ...}
 * regardless of what the claims object carried. It now reads claims._typ /
 * claims._alg (leading underscore so they can never collide with a real
 * claim named "typ"/"alg" that a script's extraClaims/literalClaims might
 * legitimately include), defaulting to the same "JWT"/"PS256" as before when
 * absent — so every existing caller (e.g. the pre-existing per-request JWT
 * path) is unaffected.
 *
 * lre-utils.js is VuGen's JS-engine library — ES3-only — loaded via
 * vm.createContext the same way tests/unit/lreUtilsRsaKeyCache.test.js does.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const LRE_UTILS_PATH = path.resolve(__dirname, '../../lre-utils.js');

function loadLreUtils(lrParams) {
  const params = lrParams || {};
  const code = fs.readFileSync(LRE_UTILS_PATH, 'utf-8');
  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    LR: {
      getParam: (k) => (params[k] !== undefined ? params[k] : ''),
      setParam: (k, v) => {
        params[k] = v;
      },
    },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'lre-utils.js' });
  return { sandbox, params };
}

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

describe('lre-utils.js createJWTFromMap() — typ/alg header overrides', () => {
  let keyPair;
  beforeAll(() => {
    keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  });

  test('REGRESSION: defaults to typ:"JWT", alg:"PS256" when _typ/_alg are absent', () => {
    const { sandbox } = loadLreUtils();
    const claimsJson = JSON.stringify({ iss: 'client-1' });
    const token = sandbox.createJWTFromMap(claimsJson, 'kid-1', keyPair.privateKey);
    const header = b64uDecode(token.split('.')[0]);
    expect(header.typ).toBe('JWT');
    expect(header.alg).toBe('PS256');
  });

  test('_typ overrides the header typ (the actual reported JWS scenario)', () => {
    const { sandbox } = loadLreUtils();
    const claimsJson = JSON.stringify({ iss: 'client-1', _typ: 'JWS' });
    const token = sandbox.createJWTFromMap(claimsJson, 'kid-1', keyPair.privateKey);
    const header = b64uDecode(token.split('.')[0]);
    expect(header.typ).toBe('JWS');
  });

  test('_typ/_alg are excluded from the payload (not copied as real claims)', () => {
    const { sandbox } = loadLreUtils();
    const claimsJson = JSON.stringify({ iss: 'client-1', _typ: 'JWS', _alg: 'PS256', _expOffset: 120 });
    const token = sandbox.createJWTFromMap(claimsJson, 'kid-1', keyPair.privateKey);
    const payload = b64uDecode(token.split('.')[1]);
    expect(payload._typ).toBeUndefined();
    expect(payload._alg).toBeUndefined();
    expect(payload._expOffset).toBeUndefined();
    expect(payload.iss).toBe('client-1');
  });

  test('hyphenated custom claim keys round-trip correctly through JSON', () => {
    const { sandbox } = loadLreUtils();
    const claimsJson = JSON.stringify({ 'openbanking-intent-id': 'consentid', login_hint_token: 'loginhinttoken' });
    const token = sandbox.createJWTFromMap(claimsJson, 'kid-1', keyPair.privateKey);
    const payload = b64uDecode(token.split('.')[1]);
    expect(payload['openbanking-intent-id']).toBe('consentid');
    expect(payload.login_hint_token).toBe('loginhinttoken');
  });

  test('signature still verifies correctly with typ/alg overrides present', () => {
    const { sandbox } = loadLreUtils();
    const claimsJson = JSON.stringify({ iss: 'client-1', _typ: 'JWS' });
    const token = sandbox.createJWTFromMap(claimsJson, 'kid-1', keyPair.privateKey);
    const [h, p, s] = token.split('.');
    expect(verifyPssSignature(h + '.' + p, s, keyPair.publicKey)).toBe(true);
  });
});

describe('lre-utils.js refreshJWTFromMap() — caching contract mirrors refreshJWT()', () => {
  let keyPair;
  beforeAll(() => {
    keyPair = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  });

  test('generates a fresh token and sets _jwt_expires_at when none exists yet', () => {
    const { sandbox, params } = loadLreUtils();
    const claimsJson = JSON.stringify({ iss: 'client-1', _typ: 'JWS' });
    const token = sandbox.refreshJWTFromMap(claimsJson, 'kid-1', keyPair.privateKey, '_jwt_token');
    expect(token.split('.')).toHaveLength(3);
    expect(parseInt(params._jwt_expires_at, 10)).toBeGreaterThan(Date.now());
  });

  test('returns the cached token unchanged when not yet expired, without re-signing', () => {
    const { sandbox, params } = loadLreUtils();
    const claimsJson = JSON.stringify({ iss: 'client-1' });
    const first = sandbox.refreshJWTFromMap(claimsJson, 'kid-1', keyPair.privateKey, '_jwt_token');
    params._jwt_token = first;

    const spy = jest.spyOn(sandbox, 'createJWTFromMap');
    const second = sandbox.refreshJWTFromMap(claimsJson, 'kid-1', keyPair.privateKey, '_jwt_token');
    expect(second).toBe(first);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  test('regenerates once _jwt_expires_at has passed', () => {
    const { sandbox, params } = loadLreUtils();
    params._jwt_expires_at = String(Date.now() - 1000); // already expired
    const claimsJson = JSON.stringify({ iss: 'client-1' });
    const token = sandbox.refreshJWTFromMap(claimsJson, 'kid-1', keyPair.privateKey, '_jwt_token');
    expect(token.split('.')).toHaveLength(3);
    expect(parseInt(params._jwt_expires_at, 10)).toBeGreaterThan(Date.now());
  });

  test('refreshJWT() (fixed-shape path) is completely unaffected by the new refreshJWTFromMap()', () => {
    const { sandbox } = loadLreUtils();
    const token = sandbox.refreshJWT('client-1', 'aud1', 'scope1', 'kid-1', keyPair.privateKey, '_jwt_token');
    const header = b64uDecode(token.split('.')[0]);
    expect(header.typ).toBe('JWT');
    expect(header.alg).toBe('PS256');
  });
});
