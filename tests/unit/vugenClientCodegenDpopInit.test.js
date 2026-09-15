'use strict';

/**
 * Regression test — a stray ':' instead of ';' at the end of the DPoP init
 * Code= string in TWO independent client-side VuGen generators:
 *   - src/web/public/studio-codegen.js       (Script Studio, HAR-based)
 *   - src/web/public/VuGen-Recorder-generators.js (Recorder tool, HAR-based)
 *
 * Both emit:
 *   "Code=initDpopKey(LR.getParam('dpop_jwk')); 'DPoP engine initialized successfully';"
 *
 * With the colon typo this rendered as `...successfully':` — a JavaScript
 * syntax error inside VuGen's web_js_run Code= string, which failed with
 * "Error from JS Engine: SyntaxError: invalid label" when the generated
 * vuser_init.c actually ran in real VuGen (reported directly by a user, who
 * found and fixed the character themselves in their own generated file, then
 * asked for a cross-check — this typo turned out to also exist, independently,
 * in both these client-side generators, which the earlier session's fix to
 * the server-side src/generators/vugen/scriptGenerator.js never touched,
 * since that generator's own copy of this string never had the typo — these
 * are three structurally separate implementations, not one shared function).
 *
 * These tests parse the ACTUAL Code= string value out of each generator's
 * real output (not a hand-copied fragment) to confirm it's valid JS on its
 * own — the exact thing VuGen's JS engine has to parse.
 *
 * Note: a prior pass at this cross-check also (incorrectly) assumed both
 * files shared the DPoP-header "always classified as global" bug fixed
 * server-side as BUG-050. Direct end-to-end testing showed both files
 * already exclude "dpop"/"dpop-pf" from that classification via their own
 * pre-existing SKIP_HDR_AC set — no such bug existed here. Only the
 * colon/semicolon typo was real; nothing else was changed in either file.
 */

const fs = require('fs');
const path = require('path');

function extractCodeString(vuserInitOutput) {
  const m = /"Code=([^"]*)"/.exec(vuserInitOutput);
  if (!m) throw new Error('Could not find a Code= string in vuser_init() output');
  return m[1];
}

describe('studio-codegen.js genVuserInit() — DPoP init Code= string', () => {
  function loadStudioCodegen() {
    const code = fs.readFileSync(
      path.resolve(__dirname, '../../src/web/public/studio-codegen.js'),
      'utf-8'
    );
    const S = { entries1: [], bgDecisions: new Map(), hasDpop: true, dpopKeyVar: null };
    // eslint-disable-next-line no-new-func
    const factory = new Function('S', 'VuGenCodeGen', 'VUGEN_TEMPLATES',
      code + '\nreturn { genVuserInit };'
    );
    return { fns: factory(S, {}, {}), S };
  }

  test('DPoP init Code= string is valid JavaScript (no stray colon)', () => {
    const { fns } = loadStudioCodegen();
    const output = fns.genVuserInit();
    expect(output).toContain(
      "Code=initDpopKey(LR.getParam('dpop_jwk')); 'DPoP engine initialized successfully';"
    );
    expect(output).not.toContain("successfully':");

    const codeStr = extractCodeString(output);
    expect(() => new Function(codeStr)).not.toThrow();
  });
});

describe('VuGen-Recorder-generators.js genVuserInit() — DPoP init Code= string', () => {
  function loadRecorderGenerators() {
    const code = fs.readFileSync(
      path.resolve(__dirname, '../../src/web/public/VuGen-Recorder-generators.js'),
      'utf-8'
    );
    const S = { hasDpop: true };
    // eslint-disable-next-line no-new-func
    const factory = new Function('S', code + '\nreturn { genVuserInit };');
    return factory(S);
  }

  test('DPoP init Code= string is valid JavaScript (no stray colon)', () => {
    const { genVuserInit } = loadRecorderGenerators();
    const output = genVuserInit();
    expect(output).toContain(
      "Code=initDpopKey(LR.getParam('dpop_jwk')); 'DPoP engine initialized successfully';"
    );
    expect(output).not.toContain("successfully':");

    const codeStr = extractCodeString(output);
    expect(() => new Function(codeStr)).not.toThrow();
  });

  test('vuser_init() without DPoP is unaffected', () => {
    const code = fs.readFileSync(
      path.resolve(__dirname, '../../src/web/public/VuGen-Recorder-generators.js'),
      'utf-8'
    );
    const S = { hasDpop: false };
    // eslint-disable-next-line no-new-func
    const factory = new Function('S', code + '\nreturn { genVuserInit };');
    const { genVuserInit } = factory(S);
    const output = genVuserInit();
    expect(output).toBe('vuser_init()\n{\n\treturn 0;\n}\n');
  });
});
