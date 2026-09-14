'use strict';

/**
 * Unit tests for dpop-helper.js — DPoP EC key caching (performance fix).
 *
 * Context: getDpopProof() is called once per HTTP request that needs a DPoP
 * header (see scriptGenerator.js) — far more often than a JWT refresh. The
 * generated script creates the EC key once (first call) then passes the
 * same JWK JSON string (load.global.dpop_jwk) into every subsequent call.
 * Previously every single call re-ran JSON.parse + validation +
 * crypto.createPrivateKey() on that unchanging key. getDpopProof() now
 * caches the resolved {privateKey, publicJwk} by the raw jwk string.
 *
 * As with the JWT key-cache tests, correctness and cache-engagement are
 * verified together: every produced proof's ES256 signature is checked
 * against the public key embedded in its own header using Node's
 * independent crypto.verify() (ieee-p1363 = raw R||S, matching RFC 7515),
 * and crypto.createPrivateKey is spied on to prove the cache is actually
 * hit/bypassed as expected.
 */

const crypto = require('crypto');
const { getDpopProof, generateEcP256KeyPair } = require('../../dpop-helper.js');

function verifyProof(proof) {
  const parts = proof.split('.');
  expect(parts).toHaveLength(3);
  const header = JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  const sig = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');

  expect(header.alg).toBe('ES256');
  expect(header.typ).toBe('dpop+jwt');
  expect(header.jwk.kty).toBe('EC');
  expect(header.jwk.crv).toBe('P-256');
  expect(header.jwk.d).toBeUndefined(); // public JWK in header must never carry the private 'd'

  const publicKey = crypto.createPublicKey({
    key: { kty: 'EC', crv: 'P-256', x: header.jwk.x, y: header.jwk.y },
    format: 'jwk',
  });

  const signingInput = parts[0] + '.' + parts[1];
  const valid = crypto.verify(
    'sha256',
    Buffer.from(signingInput),
    { key: publicKey, dsaEncoding: 'ieee-p1363' },
    sig
  );

  return { valid, header, payload };
}

describe('dpop-helper.js DPoP key cache', () => {
  test('no jwk provided generates a fresh key and produces a valid proof', () => {
    const proof = getDpopProof('https://api.example.com/x', 'POST', null);
    const { valid, payload } = verifyProof(proof);
    expect(valid).toBe(true);
    expect(payload.htu).toBe('https://api.example.com/x');
    expect(payload.htm).toBe('POST');
    expect(payload.jti).toBeTruthy();
  });

  test('htm is upper-cased in the payload', () => {
    const proof = getDpopProof('https://api.example.com/x', 'post', null);
    const { payload } = verifyProof(proof);
    expect(payload.htm).toBe('POST');
  });

  test('ath claim is the base64url SHA-256 hash of the access token', () => {
    const accessToken = 'my-access-token-abc123';
    const proof = getDpopProof('https://api.example.com/x', 'GET', null, accessToken);
    const { payload } = verifyProof(proof);
    const expected = crypto.createHash('sha256').update(accessToken).digest('base64url');
    expect(payload.ath).toBe(expected);
  });

  test('passing the same raw jwk string twice reuses the cached key and still verifies both times', () => {
    const kp = generateEcP256KeyPair();
    const jwkStr = JSON.stringify(kp);

    const spy = jest.spyOn(crypto, 'createPrivateKey');
    spy.mockClear();

    const proof1 = getDpopProof('https://api.example.com/a', 'GET', jwkStr);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    const proof2 = getDpopProof('https://api.example.com/b', 'POST', jwkStr);
    expect(spy.mock.calls.length).toBe(callsAfterFirst); // cache hit — no new resolve

    expect(verifyProof(proof1).valid).toBe(true);
    expect(verifyProof(proof2).valid).toBe(true);

    // Same underlying key -> same public jwk embedded in both headers
    expect(verifyProof(proof1).header.jwk.x).toBe(verifyProof(proof2).header.jwk.x);
    expect(verifyProof(proof1).header.jwk.y).toBe(verifyProof(proof2).header.jwk.y);

    spy.mockRestore();
  });

  test('a different raw jwk string gets its own cache entry, not a stale hit', () => {
    const kpX = generateEcP256KeyPair();
    const kpY = generateEcP256KeyPair();

    getDpopProof('https://api.example.com/warm', 'GET', JSON.stringify(kpX));

    const spy = jest.spyOn(crypto, 'createPrivateKey');
    spy.mockClear();

    const proofY = getDpopProof('https://api.example.com/y', 'GET', JSON.stringify(kpY));
    expect(spy.mock.calls.length).toBeGreaterThan(0); // genuinely new key must re-resolve

    const { valid, header } = verifyProof(proofY);
    expect(valid).toBe(true);
    expect(header.jwk.x).toBe(kpY.x); // embeds key Y, not key X

    spy.mockRestore();
  });

  test('an invalid JWK string falls back to generating a new key and still produces a valid proof', () => {
    const proof = getDpopProof('https://api.example.com/x', 'GET', 'not-valid-json{{{');
    expect(verifyProof(proof).valid).toBe(true);
  });

  test('an invalid/incomplete JWK object falls back to generating a new key', () => {
    const proof = getDpopProof('https://api.example.com/x', 'GET', { kty: 'EC' }); // missing crv/d
    expect(verifyProof(proof).valid).toBe(true);
  });

  test('a valid JWK passed as an object (not a JSON string) still works', () => {
    const kp = generateEcP256KeyPair();
    const proof = getDpopProof('https://api.example.com/x', 'GET', kp);
    const { valid, header } = verifyProof(proof);
    expect(valid).toBe(true);
    expect(header.jwk.x).toBe(kp.x);
  });
});
