'use strict';

/**
 * Unit tests for lre-utils.js — RSA key parse caching (performance fix).
 *
 * Context: createJWT() / createJWTFromMap() used to re-run the full PEM
 * parse pipeline (HTML-entity decode, strip PEM markers, base64 -> DER,
 * DER TLV walk, BigInteger construction for n/d) on every single call, even
 * though the secret never changes between calls for a given Vuser.
 * _getRsaKey() now memoizes the parsed {n, d, modLen} object by the exact
 * raw secret string.
 *
 * lre-utils.js is VuGen's JS-engine library — ES3-only (no const/let/Map/
 * arrow functions), loaded by VuGen as a flat script, not a Node module.
 * It's loaded here via vm.createContext so its top-level `function`
 * declarations become callable properties of the sandbox, the same way
 * VuGen's engine exposes them as globals to each web_js_run Code= snippet.
 *
 * Correctness is checked by cross-verifying the RSA-PSS signature this
 * pure-JS implementation produces against Node's own crypto.verify() with
 * the matching public key — a completely independent verification path
 * from the code under test, so a broken _rsaPssSign or a caching bug that
 * corrupts key state would show up as a verification failure, not a
 * silently-accepted change to the signer's own math.
 */

const fs     = require('fs');
const path   = require('path');
const vm     = require('vm');
const crypto = require('crypto');

const LRE_UTILS_PATH = path.resolve(__dirname, '../../lre-utils.js');

function loadLreUtils() {
  const code = fs.readFileSync(LRE_UTILS_PATH, 'utf-8');
  const sandbox = {
    console,
    Math,
    Date,
    JSON,
    // Minimal LR stub — unused by the RSA/JWT functions under test here,
    // but present in case any top-level path touches it.
    LR: { getParam: () => '', setParam: () => {} },
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'lre-utils.js' });
  return sandbox;
}

function verifyPssSignature(signingInput, sigB64Url, publicKeyPem) {
  const sigB64 = sigB64Url.replace(/-/g, '+').replace(/_/g, '/');
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

describe('lre-utils.js RSA key cache (createJWT / createJWTFromMap)', () => {
  let sandbox;
  let keyA; // { publicKey, privateKey } PKCS#8

  beforeAll(() => {
    sandbox = loadLreUtils();
    keyA = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });
  });

  test('createJWT produces a token whose signature verifies against the public key', () => {
    const token = sandbox.createJWT('client-1', 'https://aud.example.com', 'scope1', 'kid-1', keyA.privateKey);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(verifyPssSignature(parts[0] + '.' + parts[1], parts[2], keyA.publicKey)).toBe(true);
  });

  test('createJWTFromMap produces a token whose signature verifies against the public key', () => {
    const claimsJson = JSON.stringify({ iss: 'client-1', aud: 'aud1', _expOffset: 120 });
    const token = sandbox.createJWTFromMap(claimsJson, 'kid-1', keyA.privateKey);
    const parts = token.split('.');
    expect(parts).toHaveLength(3);
    expect(verifyPssSignature(parts[0] + '.' + parts[1], parts[2], keyA.publicKey)).toBe(true);
  });

  test('HTML-entity-corrupted secret (as delivered via JMX/XML export) still verifies correctly', () => {
    const corrupted = keyA.privateKey.replace(/\n/g, '&#10;');
    expect(corrupted).not.toContain('\n');
    const token = sandbox.createJWT('client-1', 'aud1', '', 'kid-1', corrupted);
    const parts = token.split('.');
    expect(verifyPssSignature(parts[0] + '.' + parts[1], parts[2], keyA.publicKey)).toBe(true);
  });

  test('repeated calls with the identical raw secret reuse the cached parsed key', () => {
    // Fresh key, untouched by earlier tests, so the cache is guaranteed cold
    // for this exact raw secret string going in.
    const fresh = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    });

    const spy = jest.spyOn(sandbox, '_parseRsaKey');

    sandbox.createJWT('client-1', 'aud1', '', 'kid-1', fresh.privateKey);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // createJWTFromMap shares the same _getRsaKey cache as createJWT — same
    // raw secret string must not trigger another parse.
    sandbox.createJWTFromMap(JSON.stringify({ iss: 'x' }), 'kid-1', fresh.privateKey);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);

    sandbox.createJWT('client-1', 'aud1', '', 'kid-1', fresh.privateKey);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);

    spy.mockRestore();
  });

  test('a different raw secret gets its own cache entry, not a stale hit', () => {
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

    // Prime the cache with key X.
    sandbox.createJWT('client-1', 'aud1', '', 'kid-1', kx.privateKey);

    const spy = jest.spyOn(sandbox, '_parseRsaKey');
    spy.mockClear();

    const tokenY = sandbox.createJWT('client-2', 'aud2', '', 'kid-2', ky.privateKey);
    expect(spy.mock.calls.length).toBeGreaterThan(0); // genuinely new secret must re-parse

    const parts = tokenY.split('.');
    expect(verifyPssSignature(parts[0] + '.' + parts[1], parts[2], ky.publicKey)).toBe(true);
    expect(verifyPssSignature(parts[0] + '.' + parts[1], parts[2], kx.publicKey)).toBe(false);

    spy.mockRestore();
  });
});
