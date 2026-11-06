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

  test('end-to-end: each DPoP request makes its own proof right before it is sent, and sends that proof', () => {
    // One fresh proof per request (RFC 9449): generateRequestBlock() runs generateDpopProof() into
    // _dpop_proof immediately before the request, and generateAddHeaders() sends {_dpop_proof}.
    // The proof URL is the request's own URL, and "ath" is only added when the request presents a token.
    const requests = [
      { name: 'GetToken', method: 'POST', url: 'https://auth.example.com/token', headers: [{ key: 'DPoP', value: '{{dpop_proof}}' }] },
      { name: 'GetResource', method: 'GET', url: 'https://api.example.com/resource',
        headers: [{ key: 'DPoP', value: '{{dpop_proof}}' }, { key: 'Authorization', value: 'DPoP {{access_token}}' }] },
    ];
    const g = makeGenerator(requests);
    g.hasDpop = true;

    const b1 = g.generateRequestBlock(requests[0], 1);
    const b2 = g.generateRequestBlock(requests[1], 1);

    for (const [b, path] of [[b1, '/token'], [b2, '/resource']]) {
      const proofAt = b.indexOf('generateDpopProof(');
      const headerAt = b.indexOf('web_add_header("DPoP", "{_dpop_proof}")');
      expect(proofAt).toBeGreaterThan(-1);
      expect(headerAt).toBeGreaterThan(proofAt);
      expect(b).toContain('"ResultParam=_dpop_proof"');
      expect(b.slice(proofAt, headerAt)).toContain(path);
    }
    // the token request presents no token → no ath argument; the resource request hashes its own token
    expect(b1).not.toMatch(/generateDpopProof\([^)]*'POST', /);
    expect(b2).toMatch(/generateDpopProof\([^;]*'GET', [^;]*access_token/);
  });
});
