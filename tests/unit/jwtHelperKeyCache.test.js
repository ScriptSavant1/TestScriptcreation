'use strict';

/**
 * Unit tests for jwt-helper.js — signing-key caching (performance fix).
 *
 * Context: generateJWT() used to call normalisePem() + resolveSignKey()
 * (which internally calls crypto.createPrivateKey()) on every single
 * invocation, even though the private key value never changes between
 * token refreshes for a given Vuser. getCachedSignKey() now memoizes the
 * resolved KeyObject by the exact raw PEM string passed in.
 *
 * These tests verify two things together, because a caching change to
 * crypto code is only safe if BOTH hold:
 *   1. Correctness is unchanged — every produced JWT still verifies against
 *      the matching public key, for PKCS#8 keys, PKCS#1 keys, and PEM text
 *      that needs normalisePem() corruption-repair (HTML entities).
 *   2. The cache actually engages — crypto.createPrivateKey() is called
 *      once per distinct raw key string, not once per generateJWT() call.
 */

const crypto = require('crypto');
const { generateJWT } = require('../../jwt-helper.js');

function verifyToken(token, publicKeyPem) {
  const parts = token.split('.');
  expect(parts).toHaveLength(3);
  const signingInput = parts[0] + '.' + parts[1];
  const sigB64 = parts[2].replace(/-/g, '+').replace(/_/g, '/');
  const verifier = crypto.createVerify('RSA-SHA256');
  verifier.update(signingInput);
  verifier.end();
  return verifier.verify(
    {
      key: publicKeyPem,
      padding: crypto.constants.RSA_PKCS1_PSS_PADDING,
      saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST,
    },
    sigB64,
    'base64'
  );
}

describe('jwt-helper.js signing key cache', () => {
  let keyA; // { privatePkcs8, privatePkcs1, publicKey }

  beforeAll(() => {
    const { publicKey, privateKey: privatePkcs8 } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    // Re-export the SAME key pair's private half as PKCS#1 for the
    // 'BEGIN RSA PRIVATE KEY' code path (resolveSignKey's isPkcs1 branch).
    const keyObj = crypto.createPrivateKey(privatePkcs8);
    const privatePkcs1 = keyObj.export({ type: 'pkcs1', format: 'pem' });
    keyA = { publicKey, privatePkcs8, privatePkcs1 };
  });

  test('PKCS#8 key produces a JWT that verifies against the matching public key', () => {
    const token = generateJWT({ alg: 'PS256', typ: 'JWT' }, { iss: 'x' }, keyA.privatePkcs8);
    expect(verifyToken(token, keyA.publicKey)).toBe(true);
  });

  test('PKCS#1 ("BEGIN RSA PRIVATE KEY") key still produces a valid JWT', () => {
    const token = generateJWT({ alg: 'PS256', typ: 'JWT' }, { iss: 'x' }, keyA.privatePkcs1);
    expect(verifyToken(token, keyA.publicKey)).toBe(true);
  });

  test('HTML-entity-corrupted PEM (normalisePem repair path) still verifies correctly', () => {
    // Simulate the corruption normalisePem() exists to fix: newlines exported
    // as HTML entities, as seen coming from a web-exported Postman/JMX file.
    const corrupted = keyA.privatePkcs8.replace(/\n/g, '&#10;');
    expect(corrupted).not.toContain('\n');
    const token = generateJWT({ alg: 'PS256', typ: 'JWT' }, { iss: 'x' }, corrupted);
    expect(verifyToken(token, keyA.publicKey)).toBe(true);
  });

  test('calling generateJWT twice with the identical raw key resolves the key only once', () => {
    // Fresh key pair, untouched by earlier tests, so the cache is guaranteed
    // cold for this exact raw string going in.
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const spy = jest.spyOn(crypto, 'createPrivateKey');
    spy.mockClear();

    const t1 = generateJWT({ alg: 'PS256', typ: 'JWT' }, { iss: 'cache-1' }, privateKey);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0); // first call must resolve for real

    const t2 = generateJWT({ alg: 'PS256', typ: 'JWT' }, { iss: 'cache-2' }, privateKey);
    expect(spy.mock.calls.length).toBe(callsAfterFirst); // second call: cache hit, no new resolve

    // Both tokens must still be independently valid — caching the KeyObject
    // must not corrupt or invalidate subsequent signing.
    expect(verifyToken(t1, publicKey)).toBe(true);
    expect(verifyToken(t2, publicKey)).toBe(true);

    spy.mockRestore();
  });

  test('a different raw key value gets its own cache entry, not a stale hit', () => {
    // Two fresh key pairs, untouched by earlier tests.
    const kx = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
    const ky = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    // Prime the cache with key X first.
    generateJWT({ alg: 'PS256', typ: 'JWT' }, { iss: 'warm' }, kx.privateKey);

    const spy = jest.spyOn(crypto, 'createPrivateKey');
    spy.mockClear();

    const tokenY = generateJWT({ alg: 'PS256', typ: 'JWT' }, { iss: 'x' }, ky.privateKey);

    // A genuinely new raw key string must trigger a real resolve, not reuse key X's cache entry.
    expect(spy.mock.calls.length).toBeGreaterThan(0);

    // Must verify against Y's public key, and must NOT verify against X's
    // (guards against any accidental key-cache collision/aliasing).
    expect(verifyToken(tokenY, ky.publicKey)).toBe(true);
    expect(verifyToken(tokenY, kx.publicKey)).toBe(false);

    spy.mockRestore();
  });
});
