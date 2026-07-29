'use strict';

/**
 * Unit tests for _advCsrfScan() in studio-advisor.js
 *
 * _advCsrfScan(entries, highConfValues) is Phase 2.5 of the Correlation Advisor.
 * It scans request bodies for CSRF-named fields and backward-scans preceding
 * response bodies for the token value. If found, it emits a high-confidence
 * correlation candidate.
 *
 * Independence: studio-advisor.js has zero module dependencies (rule §5 in
 * CLAUDE.md). It uses only its parameters and the S global for the outer
 * advisorScan() — but _advCsrfScan() itself only uses its parameters.
 *
 * Loading strategy: wrap the entire file in a new Function() factory with a
 * minimal S mock so top-level code does not throw.
 */

const fs   = require('fs');
const path = require('path');

function loadAdvisor() {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../../src/web/public/studio-advisor.js'),
    'utf-8'
  );
  // The file uses S.* only inside function bodies (advisorScan, etc), not at top level.
  // Provide a minimal S so nothing throws at parse time.
  const S = { entries1: [], correlations: [], advisorCandidates: [] };
  // eslint-disable-next-line no-new-func
  const factory = new Function('S', code + '\nreturn { _advCsrfScan };');
  return factory(S);
}

const { _advCsrfScan } = loadAdvisor();

// ── Helpers ───────────────────────────────────────────────────────────────────

const ADV_MIN_LEN = 10;   // mirror of the constant defined in studio-advisor.js

/** Build a minimal HAR entry object usable as an S.entries1 element */
function makeEntry(opts = {}) {
  return {
    filtered:  opts.filtered  || false,
    isMarker:  opts.isMarker  || false,
    method:    opts.method    || 'POST',
    url:       opts.url       || 'https://example.com/form-submit',
    body:      opts.body      || null,    // {params?, text?, mimeType?}
    respBody:  opts.respBody  || '',      // response body text
  };
}

/**
 * A CSRF token value long enough to exceed ADV_MIN_LEN (≥10 chars).
 * Using a realistic-looking value.
 */
const CSRF_TOKEN = 'abc123xyz456defgh';   // 18 chars

// ── Empty / guard cases ────────────────────────────────────────────────────────

describe('_advCsrfScan() — guard cases', () => {
  test('returns [] for empty entries array', () => {
    expect(_advCsrfScan([], new Set())).toEqual([]);
  });

  test('skips filtered entries', () => {
    const reqEntry = makeEntry({
      filtered: true,
      body: { params: [{ name: 'authenticity_token', value: CSRF_TOKEN }] },
    });
    const srcEntry = makeEntry({ respBody: CSRF_TOKEN });
    expect(_advCsrfScan([srcEntry, reqEntry], new Set())).toEqual([]);
  });

  test('skips isMarker entries', () => {
    const reqEntry = makeEntry({
      isMarker: true,
      body: { params: [{ name: 'authenticity_token', value: CSRF_TOKEN }] },
    });
    const srcEntry = makeEntry({ respBody: CSRF_TOKEN });
    expect(_advCsrfScan([srcEntry, reqEntry], new Set())).toEqual([]);
  });

  test('returns [] when no CSRF fields present in any request body', () => {
    const entries = [
      makeEntry({ respBody: CSRF_TOKEN }),
      makeEntry({ body: { params: [{ name: 'username', value: 'alice' }] } }),
    ];
    expect(_advCsrfScan(entries, new Set())).toEqual([]);
  });

  test('skips value already captured by Phase 2 (highConfValues)', () => {
    const srcEntry = makeEntry({ respBody: CSRF_TOKEN });
    const reqEntry = makeEntry({
      body: { params: [{ name: 'csrf_token', value: CSRF_TOKEN }] },
    });
    expect(_advCsrfScan([srcEntry, reqEntry], new Set([CSRF_TOKEN]))).toEqual([]);
  });
});

// ── CSRF field name recognition ───────────────────────────────────────────────

describe('_advCsrfScan() — CSRF field name recognition', () => {
  /** Helper: build [srcEntry, reqEntry] and verify one candidate is found */
  function expectOneCandidate(fieldName) {
    const srcEntry = makeEntry({ respBody: CSRF_TOKEN });
    const reqEntry = makeEntry({
      body: { params: [{ name: fieldName, value: CSRF_TOKEN }] },
    });
    const candidates = _advCsrfScan([srcEntry, reqEntry], new Set());
    expect(candidates).toHaveLength(1);
    return candidates[0];
  }

  test('recognises authenticity_token', () => {
    expect(expectOneCandidate('authenticity_token').value).toBe(CSRF_TOKEN);
  });

  test('recognises csrf_token', () => {
    expect(expectOneCandidate('csrf_token').value).toBe(CSRF_TOKEN);
  });

  test('recognises csrfToken (camelCase)', () => {
    expect(expectOneCandidate('csrfToken').value).toBe(CSRF_TOKEN);
  });

  test('recognises _csrf_token (underscore prefix)', () => {
    expect(expectOneCandidate('_csrf_token').value).toBe(CSRF_TOKEN);
  });

  test('recognises __RequestVerificationToken (ASP.NET)', () => {
    expect(expectOneCandidate('__RequestVerificationToken').value).toBe(CSRF_TOKEN);
  });

  test('recognises csrfmiddlewaretoken (Django)', () => {
    expect(expectOneCandidate('csrfmiddlewaretoken').value).toBe(CSRF_TOKEN);
  });

  test('recognises __VIEWSTATE (ASP.NET WebForms)', () => {
    expect(expectOneCandidate('__VIEWSTATE').value).toBe(CSRF_TOKEN);
  });

  test('recognises xsrf_token', () => {
    expect(expectOneCandidate('xsrf_token').value).toBe(CSRF_TOKEN);
  });

  test('is case-insensitive (CSRF_TOKEN uppercase)', () => {
    const srcEntry = makeEntry({ respBody: CSRF_TOKEN });
    const reqEntry = makeEntry({
      body: { params: [{ name: 'CSRF_TOKEN', value: CSRF_TOKEN }] },
    });
    expect(_advCsrfScan([srcEntry, reqEntry], new Set())).toHaveLength(1);
  });

  test('does NOT recognise arbitrary field names like "token_id"', () => {
    const srcEntry = makeEntry({ respBody: CSRF_TOKEN });
    const reqEntry = makeEntry({
      body: { params: [{ name: 'token_id', value: CSRF_TOKEN }] },
    });
    expect(_advCsrfScan([srcEntry, reqEntry], new Set())).toHaveLength(0);
  });
});

// ── Value length gate ─────────────────────────────────────────────────────────

describe('_advCsrfScan() — minimum value length (ADV_MIN_LEN = 10)', () => {
  test('skips CSRF value shorter than ADV_MIN_LEN', () => {
    const shortVal = 'abc12345';   // 8 chars, below minimum
    const srcEntry = makeEntry({ respBody: shortVal });
    const reqEntry = makeEntry({
      body: { params: [{ name: 'csrf_token', value: shortVal }] },
    });
    expect(_advCsrfScan([srcEntry, reqEntry], new Set())).toHaveLength(0);
  });

  test('accepts value of exactly ADV_MIN_LEN chars', () => {
    const exactVal = 'a'.repeat(ADV_MIN_LEN);  // 10 chars
    const srcEntry = makeEntry({ respBody: exactVal });
    const reqEntry = makeEntry({
      body: { params: [{ name: 'csrf_token', value: exactVal }] },
    });
    expect(_advCsrfScan([srcEntry, reqEntry], new Set())).toHaveLength(1);
  });
});

// ── Source lookup (backward scan) ─────────────────────────────────────────────

describe('_advCsrfScan() — backward source scan', () => {
  test('finds nothing when no preceding response contains the token', () => {
    const reqEntry = makeEntry({
      body: { params: [{ name: 'csrf_token', value: CSRF_TOKEN }] },
    });
    // No preceding entries at all
    expect(_advCsrfScan([reqEntry], new Set())).toHaveLength(0);
  });

  test('finds nothing when preceding response does NOT contain the token', () => {
    const srcEntry = makeEntry({ respBody: 'something unrelated' });
    const reqEntry = makeEntry({
      body: { params: [{ name: 'csrf_token', value: CSRF_TOKEN }] },
    });
    expect(_advCsrfScan([srcEntry, reqEntry], new Set())).toHaveLength(0);
  });

  test('uses the nearest (most recent) preceding response as source', () => {
    const olderSrc = makeEntry({ url: 'https://example.com/page1', respBody: CSRF_TOKEN });
    const newerSrc = makeEntry({ url: 'https://example.com/page2', respBody: CSRF_TOKEN });
    const reqEntry = makeEntry({
      body: { params: [{ name: 'csrf_token', value: CSRF_TOKEN }] },
    });
    const candidates = _advCsrfScan([olderSrc, newerSrc, reqEntry], new Set());
    expect(candidates).toHaveLength(1);
    // sourceIdx should point to newerSrc (index 1), not olderSrc (index 0)
    expect(candidates[0].source.entryIdx).toBe(1);
  });

  test('correctly resolves source from non-adjacent preceding entry', () => {
    const srcEntry  = makeEntry({ respBody: CSRF_TOKEN });
    const midEntry  = makeEntry({ respBody: 'no token here' });
    const reqEntry  = makeEntry({
      body: { params: [{ name: 'csrf_token', value: CSRF_TOKEN }] },
    });
    const candidates = _advCsrfScan([srcEntry, midEntry, reqEntry], new Set());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].source.entryIdx).toBe(0);
  });
});

// ── Candidate structure ───────────────────────────────────────────────────────

describe('_advCsrfScan() — returned candidate structure', () => {
  let candidate;
  beforeEach(() => {
    const srcEntry = makeEntry({ respBody: CSRF_TOKEN });
    const reqEntry = makeEntry({
      body: { params: [{ name: 'csrf_token', value: CSRF_TOKEN }] },
    });
    [candidate] = _advCsrfScan([srcEntry, reqEntry], new Set());
  });

  test('has id, value, confidence, status, source, usages', () => {
    expect(candidate).toHaveProperty('id');
    expect(candidate).toHaveProperty('value', CSRF_TOKEN);
    expect(candidate).toHaveProperty('confidence', 'high');
    expect(candidate).toHaveProperty('status', 'pending');
    expect(candidate).toHaveProperty('source');
    expect(candidate).toHaveProperty('usages');
  });

  test('source.entryIdx points to the response entry (index 0)', () => {
    expect(candidate.source.entryIdx).toBe(0);
  });

  test('usages[0].entryIdx points to the request entry (index 1)', () => {
    expect(candidate.usages[0].entryIdx).toBe(1);
  });

  test('usages[0].location is "body_form"', () => {
    expect(candidate.usages[0].location).toBe('body_form');
  });
});

// ── Raw text body (Path B: form-encoded) ──────────────────────────────────────

describe('_advCsrfScan() — raw form-encoded body text (Path B)', () => {
  test('finds CSRF token from body.text with mimeType application/x-www-form-urlencoded', () => {
    const srcEntry = makeEntry({ respBody: CSRF_TOKEN });
    const reqEntry = makeEntry({
      body: {
        params: [],
        text: `csrf_token=${CSRF_TOKEN}&other=value`,
        mimeType: 'application/x-www-form-urlencoded',
      },
    });
    const candidates = _advCsrfScan([srcEntry, reqEntry], new Set());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toBe(CSRF_TOKEN);
  });

  test('URL-decodes percent-encoded token value in text body', () => {
    const token = 'hello+world+xyz12345';    // 20 chars; + is decoded as space
    const srcEntry = makeEntry({ respBody: 'hello world xyz12345' });
    const reqEntry = makeEntry({
      body: {
        params: [],
        text: `authenticity_token=${token}`,
        mimeType: 'application/x-www-form-urlencoded',
      },
    });
    const candidates = _advCsrfScan([srcEntry, reqEntry], new Set());
    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toBe('hello world xyz12345');
  });

  test('ignores text body with non-form mimeType (e.g. application/json)', () => {
    const srcEntry = makeEntry({ respBody: CSRF_TOKEN });
    const reqEntry = makeEntry({
      body: {
        params: [],
        text: `{"csrf_token":"${CSRF_TOKEN}"}`,
        mimeType: 'application/json',
      },
    });
    // JSON body should not be processed by CSRF scan (Path B is form only)
    expect(_advCsrfScan([srcEntry, reqEntry], new Set())).toHaveLength(0);
  });

  test('prefers body.params over body.text when both are present', () => {
    const altToken = 'different_token_xyz99';  // 21 chars
    const srcEntry = makeEntry({ respBody: `${CSRF_TOKEN} ${altToken}` });
    const reqEntry = makeEntry({
      body: {
        params: [{ name: 'csrf_token', value: CSRF_TOKEN }],  // Path A
        text:  `csrf_token=${altToken}`,                        // Path B
        mimeType: 'application/x-www-form-urlencoded',
      },
    });
    // Path A (params) is tried first; when csrfFields is non-empty, Path B is skipped
    const candidates = _advCsrfScan([srcEntry, reqEntry], new Set());
    // Should only have the Path A value (CSRF_TOKEN), not altToken
    expect(candidates.some(c => c.value === CSRF_TOKEN)).toBe(true);
    expect(candidates.some(c => c.value === altToken)).toBe(false);
  });
});

// ── Deduplication ─────────────────────────────────────────────────────────────

describe('_advCsrfScan() — deduplication across requests', () => {
  test('same token value in multiple requests → single candidate (value-level dedup)', () => {
    // _advCsrfScan uses `if (found.has(cf.value)) continue` — the SECOND request
    // that contains the same token value is skipped entirely at the value level.
    // So the result has exactly one candidate, with only the FIRST request's usage.
    const srcEntry  = makeEntry({ respBody: CSRF_TOKEN });
    const reqEntry1 = makeEntry({
      body: { params: [{ name: 'csrf_token', value: CSRF_TOKEN }] },
    });
    const reqEntry2 = makeEntry({
      body: { params: [{ name: 'authenticity_token', value: CSRF_TOKEN }] },
    });
    const candidates = _advCsrfScan([srcEntry, reqEntry1, reqEntry2], new Set());
    // Only one candidate for the token, from the first request that triggered it
    expect(candidates).toHaveLength(1);
    expect(candidates[0].value).toBe(CSRF_TOKEN);
    // Only the first usage (reqEntry1 at index 1) is recorded
    expect(candidates[0].usages).toHaveLength(1);
    expect(candidates[0].usages[0].entryIdx).toBe(1);
  });

  test('two different CSRF tokens → two separate candidates', () => {
    const TOKEN_A = 'aaaaa_token_aaaaa';   // 17 chars
    const TOKEN_B = 'bbbbb_token_bbbbb';   // 17 chars
    const srcEntry = makeEntry({ respBody: `${TOKEN_A} ${TOKEN_B}` });
    const reqEntryA = makeEntry({
      body: { params: [{ name: 'csrf_token', value: TOKEN_A }] },
    });
    const reqEntryB = makeEntry({
      body: { params: [{ name: 'authenticity_token', value: TOKEN_B }] },
    });
    const candidates = _advCsrfScan([srcEntry, reqEntryA, reqEntryB], new Set());
    expect(candidates).toHaveLength(2);
    const values = candidates.map(c => c.value);
    expect(values).toContain(TOKEN_A);
    expect(values).toContain(TOKEN_B);
  });
});
