'use strict';

/**
 * End-to-end replay of a generated VuGen vuser_init JWT flow, reproducing a
 * real user report (Web HTTP/HTML only — DevWeb worked):
 *
 *   vuser_init.c(73): Warning -26311: Problem with // line comment for the
 *     "Code=LR.setParam('_jwt_aud', 'https://'+LR.getParam('iam-host')+...)" argument
 *   vuser_init.c(77): Error -26000: ... lre-utils.js:2517: Error: RSA parse:
 *     expected outer SEQUENCE
 *
 * Two independent causes:
 *   1. default.cfg's [CommandArguments] stores a multi-line PEM on one line
 *      with each newline written as the two characters "\n";
 *      lr_get_attrib_string() returns that unchanged, and lre-utils.js's key
 *      parser didn't strip them (DevWeb's normalisePem() always did).
 *   2. 'https://' appeared literally inside a web_js_run Code= string; VuGen
 *      scans Code= for "//" line comments and warns.
 *
 * This test chains the REAL pieces: the VuGen files generator writes
 * default.cfg, the secret is read back exactly as lr_get_attrib_string()
 * would, both generated web_js_run Code= strings are decoded from C and
 * executed against the real lre-utils.js, and the resulting JWT's signature
 * is verified independently with Node's crypto.
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const WebHttpScriptGenerator = require('../../src/generators/vugen/scriptGenerator.js');
const WebHttpMandatoryFilesGenerator = require('../../src/generators/vugen/filesGenerator.js');

const b64uJson = (s) => JSON.parse(Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));

function codeArgs(cSource) {
  return [...cSource.matchAll(/"Code=((?:[^"\\]|\\.)*)"/g)].map((m) => JSON.parse('"' + m[1] + '"'));
}

function verifyPs256(token, publicKey) {
  const [h, p, s] = token.split('.');
  const v = crypto.createVerify('RSA-SHA256');
  v.update(h + '.' + p);
  v.end();
  return v.verify(
    { key: publicKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING, saltLength: crypto.constants.RSA_PSS_SALTLEN_DIGEST },
    s.replace(/-/g, '+').replace(/_/g, '/'),
    'base64',
  );
}

describe('VuGen vuser_init JWT — full chain from default.cfg to a verified token', () => {
  const keys = crypto.generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });

  // The user's real claim map (Postman script: typ JWS, two literal custom
  // claims, aud built from "https://" + iam-host + "/as/token.oauth2").
  const cm = {
    kid: 'signing_kid', iss: 'client_id', sub: 'client_id', scope: 'scope', secret: 'secret',
    output: 'jwt_token', typ: 'JWS', alg: 'PS256',
    literalClaims: { 'openbanking-intent-id': 'consentid', login_hint_token: 'loginhinttoken' },
    _audTemplate: 'https://{iam-host}/as/token.oauth2', aud: '_jwt_aud',
  };

  function readCommandArgs(defaultCfg) {
    // Mirrors lr_get_attrib_string(): the raw text after "name=" on that line.
    const section = defaultCfg.split('[CommandArguments]')[1] || '';
    const out = {};
    for (const line of section.split('\n')) {
      const i = line.indexOf('=');
      if (i > 0) out[line.slice(0, i)] = line.slice(i + 1).replace(/\r$/, '');
    }
    return out;
  }

  test('secret survives default.cfg, both web_js_run steps run, and the JWT verifies with every claim correct', () => {
    // 1. default.cfg as the converter writes it.
    const globals = new Map([
      ['client_id', { paramValue: 'my-client' }],
      ['scope', { paramValue: 'accounts' }],
      ['signing_kid', { paramValue: 'kid-123' }],
      ['secret', { paramValue: keys.privateKey }],
      ['iam-host', { paramValue: 'auth.example.com' }],
    ]);
    const cfg = new WebHttpMandatoryFilesGenerator({}).generateDefaultCfg(null, false, true, false, globals);
    const lrParams = readCommandArgs(cfg);
    expect(lrParams.secret).toContain('\\n'); // stored with escaped newlines, exactly the real-world shape
    expect(lrParams.secret).not.toContain('\n');

    // 2. vuser_init.c as the converter generates it.
    const g = new WebHttpScriptGenerator([], { info: { name: 'E2E' } }, {});
    Object.assign(g, { hasJwt: true, jwtClaimMap: cm, mtlsCertFiles: [], hasDpop: false, parameters: new Map(), jsr223ModuleVars: new Set() });
    const steps = codeArgs(g.generateVuserInitC());
    const audStep = steps.find((js) => js.startsWith("LR.setParam('_jwt_aud'"));
    const jwtStep = steps.find((js) => js.startsWith('createJWTFromMap('));
    expect(audStep).toBeDefined();
    expect(jwtStep).toBeDefined();
    for (const js of steps) expect(js).not.toContain('//'); // MWAR-26311

    // 3. Run them in order inside one JS context holding the real lre-utils.js.
    const sandbox = {
      Math, Date, JSON, String, parseInt,
      LR: { getParam: (k) => (lrParams[k] !== undefined ? lrParams[k] : ''), setParam: (k, v) => { lrParams[k] = v; } },
    };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../lre-utils.js'), 'utf8'), sandbox);
    vm.runInContext(audStep, sandbox);
    const token = vm.runInContext(jwtStep, sandbox); // threw "RSA parse: expected outer SEQUENCE" before the fix

    // 4. Verify independently.
    expect(verifyPs256(token, keys.publicKey)).toBe(true);
    const [h, p] = token.split('.');
    expect(b64uJson(h)).toMatchObject({ alg: 'PS256', typ: 'JWS', kid: 'kid-123' });
    expect(b64uJson(p)).toMatchObject({
      aud: 'https://auth.example.com/as/token.oauth2',
      iss: 'my-client', sub: 'my-client', scope: 'accounts',
      'openbanking-intent-id': 'consentid', login_hint_token: 'loginhinttoken',
    });
  });

  test('lre-utils.js parses the key in every encoding it can arrive in', () => {
    const sandbox = { Math, Date, JSON, LR: { getParam: () => '', setParam: () => {} } };
    vm.createContext(sandbox);
    vm.runInContext(fs.readFileSync(path.resolve(__dirname, '../../lre-utils.js'), 'utf8'), sandbox);
    const BS = String.fromCharCode(92);
    const variants = {
      realNewlines: keys.privateKey,
      escapedLF: keys.privateKey.split('\n').join(BS + 'n'),
      escapedCRLF: keys.privateKey.split('\n').join(BS + 'r' + BS + 'n'),
      htmlEntity: keys.privateKey.split('\n').join('&#10;'),
    };
    for (const [name, secret] of Object.entries(variants)) {
      const token = sandbox.createJWTFromMap('{"iss":"x"}', 'kid', secret);
      expect([name, verifyPs256(token, keys.publicKey)]).toEqual([name, true]);
    }
  });
});
