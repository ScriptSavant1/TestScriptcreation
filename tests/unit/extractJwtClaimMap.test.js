'use strict';

/**
 * Regression test — CustomScriptParser.extractJwtClaimMap() used to take the
 * LAST `pm.environment.set(...)` / `postman.setEnvironmentVariable(...)` /
 * `bru.setVar(...)` call in a pre-request script as the JWT's output variable
 * (`map.output`), instead of the FIRST one.
 *
 * Real pre-request scripts commonly sign a JWT and store it FIRST, then go on
 * to do other unrelated .set() calls afterward — a DPoP proof placeholder, a
 * nonce, a correlation seed, etc. "Last wins" picked up whichever of those
 * happened to be the final statement in the script, not the actual JWT.
 *
 * Downstream impact (see tests/unit/devwebJwtOutputVar.test.js for the
 * DevWeb-side consequence, and the VuGen generator's `outputParam = cm.output
 * || "jwt"` at src/generators/vugen/scriptGenerator.js:1228): the JWT gets
 * correctly SIGNED but stored under the WRONG variable name, while the
 * request body/header still references the REAL name (e.g. `client_assertion`,
 * from `{{client_assertion}}`) — which is then never assigned anywhere,
 * silently sending `undefined` (DevWeb) or an unresolved `{param}` (VuGen).
 *
 * Fix: take the FIRST `.set()` match, matching the "first non-library match
 * wins" convention `detectJwtUsage()`'s outputVars already uses elsewhere
 * (see scriptGenerator.js's `_primaryOut`).
 */

const CustomScriptParser = require('../../src/analyzers/customScriptParser.js');

describe('CustomScriptParser.extractJwtClaimMap() — output variable detection', () => {
  test('picks the FIRST .set() call as output, not the last, when a script sets multiple variables', () => {
    const script = `
      const KJUR = require('jsrsasign');
      const header = { alg: 'RS256', typ: 'JWT' };
      const payload = {
        iss: pm.variables.get('client_id'),
        sub: pm.variables.get('client_id'),
        aud: pm.variables.get('token_url'),
      };
      const sJWT = KJUR.jws.JWS.sign('RS256', JSON.stringify(header), JSON.stringify(payload), pm.variables.get('private_key'));
      pm.environment.set('client_assertion', sJWT);

      // Unrelated DPoP proof placeholder set AFTER the real JWT output —
      // this is the exact pattern that used to hijack map.output.
      const jwk = pm.environment.get('dpop_jwk');
      pm.environment.set('dpop_proof', 'placeholder');
    `;

    const map = CustomScriptParser.extractJwtClaimMap(script);
    expect(map).not.toBeNull();
    expect(map.output).toBe('client_assertion');
    expect(map.output).not.toBe('dpop_proof');
  });

  test('single .set() call still works (no regression for the common case)', () => {
    const script = `
      const sJWT = KJUR.jws.JWS.sign('RS256', h, p, key);
      pm.environment.set('jwt_token', sJWT);
    `;
    const map = CustomScriptParser.extractJwtClaimMap(script);
    expect(map.output).toBe('jwt_token');
  });

  test('works across the other setter APIs (postman.setEnvironmentVariable, bru.setVar), first one wins', () => {
    const scriptPostman = `
      pm.environment.set('primary_token', sJWT);
      postman.setEnvironmentVariable('secondary_thing', other);
    `;
    expect(CustomScriptParser.extractJwtClaimMap(scriptPostman).output).toBe('primary_token');

    const scriptBru = `
      bru.setVar('id_token', sJWT);
      bru.setEnvVar('unrelated_var', other);
    `;
    expect(CustomScriptParser.extractJwtClaimMap(scriptBru).output).toBe('id_token');
  });

  test('BUG-081: a library-loading .set() before the JWT is skipped (first NON-library set wins)', () => {
    // the pattern in collection-examples/jwt_ps256_20api_collection.json: download jsrsasign, keep it in a
    // global, eval it, sign, then store the JWT
    const script = `
      if (!pm.globals.get('jsrsasign')) {
        pm.sendRequest('https://cdn.example.com/jsrsasign-all-min.js', (err, res) => {
          pm.globals.set('jsrsasign', res.text());
        });
      }
      eval(pm.globals.get('jsrsasign'));
      const header = { alg: 'PS256', typ: 'JWT' };
      const payload = { iss: pm.environment.get('client_id'), aud: pm.environment.get('token_url') };
      const sJWT = KJUR.jws.JWS.sign('PS256', JSON.stringify(header), JSON.stringify(payload), pm.environment.get('private_key'));
      pm.environment.set('jwt_token', sJWT);
    `;
    const map = CustomScriptParser.extractJwtClaimMap(script);
    expect(map).not.toBeNull();
    expect(map.output).toBe('jwt_token');
  });

  test('the bundled PS256 example collection stores its JWT as jwt_token (BUG-081)', () => {
    const col = require('../../collection-examples/jwt_ps256_20api_collection.json');
    const scripts = [];
    (function walk(items) {
      for (const it of items || []) {
        if (it.item) walk(it.item);
        for (const ev of it.event || []) if (ev.listen === 'prerequest') scripts.push([].concat(ev.script.exec).join('\n'));
      }
    })(col.item);
    const jwtScript = scripts.find((s) => CustomScriptParser.detectJwtUsage(s).isJwt);
    expect(jwtScript).toBeDefined();
    expect(CustomScriptParser.extractJwtClaimMap(jwtScript).output).toBe('jwt_token');
  });

  test('no .set() call at all -> map.output is undefined (caller falls back to a default)', () => {
    const script = `const x = 1;`;
    const map = CustomScriptParser.extractJwtClaimMap(script);
    // extractJwtClaimMap returns null when the map ends up empty; a script with
    // recognizable claim getters but no .set() call leaves .output unset.
    if (map) {
      expect(map.output).toBeUndefined();
    } else {
      expect(map).toBeNull();
    }
  });
});
