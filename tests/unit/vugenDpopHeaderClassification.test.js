'use strict';

/**
 * Regression test — VuGen generator's analyzeCommonHeaders() used to classify
 * a DPoP header as "global" (web_add_auto_header, set once) whenever it
 * appeared in >=70% of requests with the identical "{{dpop_proof}}" template
 * string — which is ALWAYS true for a DPoP header, since every request uses
 * the same {{dpop_proof}} placeholder in the source collection even though
 * each one needs a genuinely DIFFERENT signed value (bound to that request's
 * own htu/htm).
 *
 * That misclassification broke DPoP end-to-end in every VuGen script that
 * used it, in two compounding ways:
 *   1. generateAddHeaders() skips any header already in `globalHeaders`
 *      (see the `!globalKeys.has(...)` filter), so the per-request DPoP
 *      wiring that already existed (request._dpopParamMap, populated by
 *      generateDpopBatchBlock() with the correct sequence-numbered param —
 *      e.g. "_dpop_proof_1", "_dpop_proof_2") never ran at all.
 *   2. The ONLY thing actually emitted was
 *      `web_add_auto_header("DPoP", "{_dpop_proof}")` — referencing a plain
 *      "_dpop_proof" parameter that is NEVER populated anywhere (the real
 *      proofs are always sequence-suffixed), so VuGen would send an
 *      unresolved/empty DPoP header on every request.
 *
 * Fix: DPoP / DPoP-PF headers are now always forced into `perRequestKeys`,
 * matching the existing special-case for Content-Type. This lets the
 * already-correct per-request logic in generateAddHeaders() actually run.
 *
 * Found while cross-checking JWT/DPoP for both protocols after a user asked
 * to verify DPoP worked correctly following an unrelated fix.
 */

const WebHttpScriptGenerator = require('../../src/generators/vugen/scriptGenerator.js');

function makeGenerator(requests) {
  return new WebHttpScriptGenerator(requests, { info: { name: 'DpopHeaderTest' } }, {});
}

describe('VuGen analyzeCommonHeaders() — DPoP header classification', () => {
  test('DPoP header is always classified as per-request, even when every request uses the identical {{dpop_proof}} template', () => {
    const requests = [
      { name: 'Req1', method: 'POST', url: 'https://a.example.com/1', headers: [{ key: 'DPoP', value: '{{dpop_proof}}' }] },
      { name: 'Req2', method: 'GET', url: 'https://a.example.com/2', headers: [{ key: 'DPoP', value: '{{dpop_proof}}' }] },
      { name: 'Req3', method: 'GET', url: 'https://a.example.com/3', headers: [{ key: 'DPoP', value: '{{dpop_proof}}' }] },
    ];
    const g = makeGenerator(requests);
    const { globalHeaders, perRequestKeys } = g.analyzeCommonHeaders();

    expect(perRequestKeys.has('DPoP')).toBe(true);
    expect(globalHeaders.has('DPoP')).toBe(false);
  });

  test('DPoP-PF header is also always per-request', () => {
    const requests = [
      { name: 'Req1', method: 'POST', url: 'https://a.example.com/1', headers: [{ key: 'DPoP-PF', value: '{{dpop_pf_proof}}' }] },
      { name: 'Req2', method: 'GET', url: 'https://a.example.com/2', headers: [{ key: 'DPoP-PF', value: '{{dpop_pf_proof}}' }] },
    ];
    const g = makeGenerator(requests);
    const { globalHeaders, perRequestKeys } = g.analyzeCommonHeaders();

    expect(perRequestKeys.has('DPoP-PF')).toBe(true);
    expect(globalHeaders.has('DPoP-PF')).toBe(false);
  });

  test('a genuinely global header (same value across all requests) is unaffected by the DPoP exclusion', () => {
    const requests = [
      { name: 'Req1', method: 'POST', url: 'https://a.example.com/1', headers: [{ key: 'DPoP', value: '{{dpop_proof}}' }, { key: 'Accept', value: 'application/json' }] },
      { name: 'Req2', method: 'GET', url: 'https://a.example.com/2', headers: [{ key: 'DPoP', value: '{{dpop_proof}}' }, { key: 'Accept', value: 'application/json' }] },
    ];
    const g = makeGenerator(requests);
    const { globalHeaders, perRequestKeys } = g.analyzeCommonHeaders();

    expect(globalHeaders.has('Accept')).toBe(true);
    expect(perRequestKeys.has('DPoP')).toBe(true);
  });

  test('end-to-end: generateAddHeaders() emits the correct per-request DPoP param, not a stale shared one', () => {
    const requests = [
      { name: 'GetToken', method: 'POST', url: 'https://auth.example.com/token', headers: [{ key: 'DPoP', value: '{{dpop_proof}}' }] },
      { name: 'GetResource', method: 'GET', url: 'https://api.example.com/resource', headers: [{ key: 'DPoP', value: '{{dpop_proof}}' }] },
    ];
    const g = makeGenerator(requests);
    g.hasDpop = true;

    // Simulate what generateDpopBatchBlock() does: tag each request with its
    // own sequence-numbered param name.
    requests[0]._dpopParamMap = { dpop: '_dpop_proof_1' };
    requests[1]._dpopParamMap = { dpop: '_dpop_proof_2' };

    const out1 = g.generateAddHeaders(requests[0], '    ');
    const out2 = g.generateAddHeaders(requests[1], '    ');

    expect(out1).toContain('web_add_header("DPoP", "{_dpop_proof_1}")');
    expect(out2).toContain('web_add_header("DPoP", "{_dpop_proof_2}")');
    // Must NOT collapse to the old shared/never-set generic param.
    expect(out1).not.toContain('{_dpop_proof}"');
    expect(out2).not.toContain('{_dpop_proof}"');
  });
});
