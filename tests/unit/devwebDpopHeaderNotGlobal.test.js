'use strict';

/**
 * BUG-123: a DPoP header on every request also landed in load.WebRequest.defaults.headers as the literal
 * {{dpop_proof}}. A proof belongs to one request, so it is never global (VuGen: BUG-050).
 */

const AdvancedScriptGenerator = require('../../src/generators/devweb/scriptGenerator.js');

function analyse(headers) {
  const g = new AdvancedScriptGenerator([], { info: { name: 'DpopGlobalTest' } }, {});
  const toHeaders = () => Object.entries(headers).map(([key, value]) => ({ key, value }));
  g.requests = [{ headers: toHeaders() }, { headers: toHeaders() }];
  return g.analyzeCommonHeaders();
}

describe('DevWeb analyzeCommonHeaders() — DPoP headers', () => {
  test.each(['DPoP', 'dpop', 'DPoP-PF'])('%s on every request is per request, not global', (name) => {
    const { staticGlobal, authGlobal, perRequestKeys } = analyse({ [name]: '{{dpop_proof}}' });
    expect(staticGlobal.has(name)).toBe(false);
    expect(authGlobal.has(name)).toBe(false);
    expect(perRequestKeys.has(name)).toBe(true);
  });

  test('other headers on every request stay global', () => {
    const { staticGlobal } = analyse({ DPoP: '{{dpop_proof}}', 'X-App': 'portal' });
    expect(staticGlobal.get('X-App')).toBe('"portal"');
  });

  test('a header that only starts with dpop is not caught by the rule', () => {
    const { staticGlobal } = analyse({ 'DPoP-Version': '1' });
    expect(staticGlobal.get('DPoP-Version')).toBe('"1"');
  });
});
