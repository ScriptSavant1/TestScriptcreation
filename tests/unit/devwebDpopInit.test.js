'use strict';

/**
 * Regression test for a DevWeb generator bug: generateInitialize() emitted a
 * stray `"` right after the interpolated DPoP key variable name —
 *
 *   load.global.${this.dpopKeyVar || "dpop_jwk"}" = load.global....
 *
 * — which rendered as `load.global.dpop_jwk" = load.global.dpop_jwk || null;`
 * in every generated DevWeb script that uses DPoP. That's a JavaScript
 * syntax error, so the generated script's initialize() block — and
 * everything after it in the same template literal (jwtBlock/dpopBlock/
 * ntlmBlock are concatenated together) — would fail to load at runtime.
 *
 * This test parses the ACTUAL string generateInitialize() returns (not a
 * hand-copied fragment) with `new Function()`, so any future reintroduction
 * of a stray quote/paren/brace in the DPoP block fails loudly here instead
 * of only showing up when a real DevWeb script is loaded in LoadRunner.
 */

const AdvancedScriptGenerator = require('../../src/generators/devweb/scriptGenerator.js');

function makeGenerator() {
  return new AdvancedScriptGenerator([], { info: { name: 'DpopInitTest' } }, {});
}

describe('DevWeb generateInitialize() — DPoP block', () => {
  test('DPoP-enabled output (default key var) is syntactically valid JS', () => {
    const g = makeGenerator();
    g.hasDpop = true;
    g.dpopKeyVar = null; // falls back to "dpop_jwk"

    const code = g.generateInitialize();

    expect(code).toContain('load.global.dpop_jwk = load.global.dpop_jwk || null;');
    expect(code).not.toContain('dpop_jwk" =');

    // Must not throw a SyntaxError — this is what actually catches the bug.
    expect(() => new Function(code)).not.toThrow();
  });

  test('DPoP-enabled output (custom key var extracted from the source script) is syntactically valid JS', () => {
    const g = makeGenerator();
    g.hasDpop = true;
    g.dpopKeyVar = 'myCustomJwk';

    const code = g.generateInitialize();

    expect(code).toContain('load.global.myCustomJwk = load.global.myCustomJwk || null;');
    expect(code).not.toContain('myCustomJwk" =');
    expect(() => new Function(code)).not.toThrow();
  });

  test('DPoP-disabled output has no DPoP block and is still valid JS', () => {
    const g = makeGenerator();
    g.hasDpop = false;

    const code = g.generateInitialize();

    expect(code).not.toContain('dpop');
    expect(() => new Function(code)).not.toThrow();
  });
});
