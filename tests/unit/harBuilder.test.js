'use strict';

/**
 * Unit tests for HarBuilder
 *
 * Covers the build() pipeline and key lifecycle methods:
 *   - build()             — produces valid HAR 1.2 structure, strips internal fields,
 *                           preserves _perfx_* fields, sorts by wall-clock start time
 *   - onRequestStarted()  — creates entry with correct HAR fields
 *   - onResponseReceived()— attaches response to pending entry
 *   - onLoadingFinished() — finalises entry, populates body text
 *   - onLoadingFailed()   — stubs Failed response
 *   - flush()             — stubs Incomplete responses for in-flight entries
 *   - startTransaction()  — records transaction, sets pageref on entries
 *   - endTransaction()    — closes active transaction, maps to pages[] in build()
 *
 * Loading strategy: har-builder.js uses ES module export syntax. We strip that
 * single line and wrap the rest in a new Function() scope so Jest (CommonJS)
 * can load it without a Babel/ESM transform.
 */

const fs   = require('fs');
const path = require('path');

const EXT_DIR = path.resolve(__dirname, '../../perfx-recorder-extension/background');

function loadHarBuilder() {
  let code = fs.readFileSync(path.join(EXT_DIR, 'har-builder.js'), 'utf-8');
  // Strip the ES module export statement — HarBuilder class itself is Node-safe
  code = code.replace(/^export const harBuilder = new HarBuilder\(\);$/m, '');
  // Wrap in a factory function so we can get the class back
  // eslint-disable-next-line no-new-func
  return new Function('URL', 'URLSearchParams', code + '\nreturn HarBuilder;')(URL, URLSearchParams);
}

const HarBuilder = loadHarBuilder();

// ── Helpers ────────────────────────────────────────────────────────────────────

function makeRequestParams(overrides = {}) {
  return {
    requestId: overrides.requestId || 'req-1',
    request: {
      method:   overrides.method || 'GET',
      url:      overrides.url    || 'https://api.example.com/v1/data',
      headers:  overrides.headers || {},
      postData: overrides.postData || null,
    },
    timestamp: overrides.timestamp || 1000,
    wallTime:  overrides.wallTime  || 1752580800,   // 2026-07-15T12:00:00Z epoch secs
    type:      overrides.type      || 'Fetch',
  };
}

function makeResponseParams(requestId, overrides = {}) {
  return {
    requestId,
    timestamp: overrides.timestamp || 1001,
    response: {
      status:              overrides.status      || 200,
      statusText:          overrides.statusText  || 'OK',
      mimeType:            overrides.mimeType    || 'application/json',
      headers:             overrides.headers     || {},
      // Use 'in' check so callers can explicitly pass null to test null protocol
      protocol:            'protocol' in overrides ? overrides.protocol : 'h2',
      encodedDataLength:   overrides.encodedDataLength !== undefined ? overrides.encodedDataLength : 512,
    },
  };
}

function makeFinishedParams(requestId, overrides = {}) {
  return {
    requestId,
    timestamp:         overrides.timestamp         || 1002,
    encodedDataLength: overrides.encodedDataLength || 512,
  };
}

// ── build() — empty state ─────────────────────────────────────────────────────

describe('HarBuilder.build() — empty state', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  test('returns a valid HAR 1.2 structure', () => {
    const har = hb.build();
    expect(har).toHaveProperty('log');
    expect(har.log.version).toBe('1.2');
    expect(har.log.creator.name).toBe('PerfX Studio Recorder');
    expect(har.log.browser.name).toBe('Chrome');
  });

  test('has empty entries and pages when nothing recorded', () => {
    const { log } = hb.build();
    expect(log.entries).toEqual([]);
    expect(log.pages).toEqual([]);
  });
});

// ── build() — field stripping ──────────────────────────────────────────────────

describe('HarBuilder.build() — internal field stripping', () => {
  const INTERNAL_FIELDS = [
    '_tabId', '_requestId', '_requestTimestamp', '_responseTimestamp',
    '_finishedTimestamp', '_startEpochMs', '_cdpTiming', '_resourceType', '_burstId',
  ];
  const KEPT_FIELDS = ['_perfx_class', '_perfx_interval', '_perfx_occurrences', '_normalizedUrl'];

  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  function recordOneEntry(builder, extra = {}) {
    const tabId = 1;
    builder.onRequestStarted(tabId, makeRequestParams(), extra);
    builder.onResponseReceived(tabId, makeResponseParams('req-1'));
    builder.onLoadingFinished(tabId, makeFinishedParams('req-1'), { body: '{}', base64Encoded: false });
  }

  test('strips all internal tracking fields from build() output', () => {
    recordOneEntry(hb);
    const [entry] = hb.build().log.entries;
    for (const field of INTERNAL_FIELDS) {
      expect(entry).not.toHaveProperty(field);
    }
  });

  test('preserves _perfx_* custom fields and _normalizedUrl', () => {
    recordOneEntry(hb, { normalizedUrl: 'https://api.example.com/v1/{id}' });
    const [entry] = hb.build().log.entries;
    for (const field of KEPT_FIELDS) {
      expect(entry).toHaveProperty(field);
    }
    expect(entry._normalizedUrl).toBe('https://api.example.com/v1/{id}');
    expect(entry._perfx_class).toBe('unknown');
    expect(entry._perfx_occurrences).toBe(1);
  });
});

// ── build() — entry ordering ───────────────────────────────────────────────────

describe('HarBuilder.build() — entry sort order', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  test('sorts entries by wall-clock start time (ascending)', () => {
    const tabId = 1;
    // Deliberately record req-B first (larger wallTime) then req-A (smaller wallTime)
    hb.onRequestStarted(tabId, makeRequestParams({ requestId: 'req-B', wallTime: 1752580900, timestamp: 2000 }));
    hb.onRequestStarted(tabId, makeRequestParams({ requestId: 'req-A', wallTime: 1752580800, timestamp: 1000 }));

    hb.onResponseReceived(tabId, makeResponseParams('req-B', { timestamp: 2001 }));
    hb.onResponseReceived(tabId, makeResponseParams('req-A', { timestamp: 1001 }));

    hb.onLoadingFinished(tabId, makeFinishedParams('req-B', { timestamp: 2002 }), null);
    hb.onLoadingFinished(tabId, makeFinishedParams('req-A', { timestamp: 1002 }), null);

    const entries = hb.build().log.entries;
    expect(entries).toHaveLength(2);
    // req-A (wallTime 1752580800) should come before req-B (wallTime 1752580900)
    expect(entries[0].request.url).toBe('https://api.example.com/v1/data');
    expect(entries[1].request.url).toBe('https://api.example.com/v1/data');
    // Verify by startedDateTime ordering
    expect(entries[0].startedDateTime < entries[1].startedDateTime).toBe(true);
  });
});

// ── onRequestStarted() ─────────────────────────────────────────────────────────

describe('HarBuilder.onRequestStarted()', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  test('creates a pending entry with correct HAR request fields', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams({
      method: 'POST',
      url: 'https://api.example.com/login',
      wallTime: 1752580800,
    }));

    // Before loadingFinished, entry is pending — not yet in completedEntries
    expect(hb.pendingEntries.size).toBe(1);
    expect(hb.completedEntries).toHaveLength(0);

    const entry = hb.pendingEntries.get('1:req-1');
    expect(entry.request.method).toBe('POST');
    expect(entry.request.url).toBe('https://api.example.com/login');
    expect(entry.startedDateTime).toBe(new Date(1752580800 * 1000).toISOString());
    expect(entry._perfx_class).toBe('unknown');
    expect(entry._perfx_occurrences).toBe(1);
    expect(entry.response).toBeNull();
  });

  test('attaches postData when request has a body', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams({
      method: 'POST',
      postData: '{"user":"alice"}',
      headers: { 'Content-Type': 'application/json' },
    }));
    const entry = hb.pendingEntries.get('1:req-1');
    expect(entry.request.postData.text).toBe('{"user":"alice"}');
    expect(entry.request.postData.mimeType).toBe('application/json');
  });

  test('parses query string into queryString array', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams({ url: 'https://api.example.com/search?q=test&page=1' }));
    const entry = hb.pendingEntries.get('1:req-1');
    expect(entry.request.queryString).toContainEqual({ name: 'q', value: 'test' });
    expect(entry.request.queryString).toContainEqual({ name: 'page', value: '1' });
  });

  test('parses cookies from Cookie header', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams({
      headers: { cookie: 'session=abc123; pref=dark' },
    }));
    const entry = hb.pendingEntries.get('1:req-1');
    expect(entry.request.cookies).toContainEqual({ name: 'session', value: 'abc123' });
    expect(entry.request.cookies).toContainEqual({ name: 'pref', value: 'dark' });
  });

  test('normalizedUrl from extra is stored in _normalizedUrl', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams({ url: 'https://api.example.com/users/12345' }),
      { normalizedUrl: 'https://api.example.com/users/{id}' });
    const entry = hb.pendingEntries.get('1:req-1');
    expect(entry._normalizedUrl).toBe('https://api.example.com/users/{id}');
  });

  test('uses request.url as _normalizedUrl when extra is empty', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams({ url: 'https://api.example.com/data' }));
    const entry = hb.pendingEntries.get('1:req-1');
    expect(entry._normalizedUrl).toBe('https://api.example.com/data');
  });
});

// ── onResponseReceived() ───────────────────────────────────────────────────────

describe('HarBuilder.onResponseReceived()', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  test('attaches response object to pending entry', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onResponseReceived(tabId, makeResponseParams('req-1', {
      status: 201,
      statusText: 'Created',
      mimeType: 'application/json',
      protocol: 'h2',
    }));
    const entry = hb.pendingEntries.get('1:req-1');
    expect(entry.response.status).toBe(201);
    expect(entry.response.statusText).toBe('Created');
    expect(entry.response.httpVersion).toBe('HTTP/2');
    expect(entry.response.content.mimeType).toBe('application/json');
    expect(entry.response.content.text).toBe('');   // filled by loadingFinished
  });

  test('silently ignores unknown requestId', () => {
    hb.onResponseReceived(1, makeResponseParams('no-such-req'));
    expect(hb.pendingEntries.size).toBe(0);
  });
});

// ── onLoadingFinished() ────────────────────────────────────────────────────────

describe('HarBuilder.onLoadingFinished()', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  test('moves entry from pending to completed', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onResponseReceived(tabId, makeResponseParams('req-1'));
    hb.onLoadingFinished(tabId, makeFinishedParams('req-1'), null);
    expect(hb.pendingEntries.size).toBe(0);
    expect(hb.completedEntries).toHaveLength(1);
  });

  test('fills response body text from bodyResult', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onResponseReceived(tabId, makeResponseParams('req-1'));
    hb.onLoadingFinished(tabId, makeFinishedParams('req-1'), { body: '{"ok":true}', base64Encoded: false });
    const entry = hb.completedEntries[0];
    expect(entry.response.content.text).toBe('{"ok":true}');
    expect(entry.response.content.encoding).toBeUndefined();
  });

  test('marks base64-encoded body with encoding field', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onResponseReceived(tabId, makeResponseParams('req-1'));
    hb.onLoadingFinished(tabId, makeFinishedParams('req-1'), { body: 'aGVsbG8=', base64Encoded: true });
    const entry = hb.completedEntries[0];
    expect(entry.response.content.encoding).toBe('base64');
  });

  test('computes non-negative time from CDP timestamps', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams({ timestamp: 1000 }));
    hb.onResponseReceived(tabId, makeResponseParams('req-1', { timestamp: 1001 }));
    hb.onLoadingFinished(tabId, makeFinishedParams('req-1', { timestamp: 1002 }), null);
    const entry = hb.completedEntries[0];
    expect(entry.time).toBeGreaterThanOrEqual(0);
  });
});

// ── onLoadingFailed() ──────────────────────────────────────────────────────────

describe('HarBuilder.onLoadingFailed()', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  test('stubs a Failed response when no response was received', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onLoadingFailed(tabId, { requestId: 'req-1', timestamp: 1002 });
    expect(hb.completedEntries).toHaveLength(1);
    const entry = hb.completedEntries[0];
    expect(entry.response.status).toBe(0);
    expect(entry.response.statusText).toBe('Failed');
  });

  test('moves entry from pending to completed', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onLoadingFailed(tabId, { requestId: 'req-1', timestamp: 1002 });
    expect(hb.pendingEntries.size).toBe(0);
  });
});

// ── flush() ────────────────────────────────────────────────────────────────────

describe('HarBuilder.flush()', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  test('stubs Incomplete response for in-flight entries', () => {
    const tabId = 1;
    // Start a request but never finish it
    hb.onRequestStarted(tabId, makeRequestParams());
    expect(hb.pendingEntries.size).toBe(1);
    hb.flush();
    expect(hb.pendingEntries.size).toBe(0);
    expect(hb.completedEntries).toHaveLength(1);
    const entry = hb.completedEntries[0];
    expect(entry.response.status).toBe(0);
    expect(entry.response.statusText).toBe('Incomplete');
  });

  test('does nothing when no pending entries', () => {
    hb.flush();
    expect(hb.completedEntries).toHaveLength(0);
  });
});

// ── Transaction → pages ────────────────────────────────────────────────────────

describe('HarBuilder — transactions and pages', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  test('startTransaction returns an id string', () => {
    const id = hb.startTransaction('Login Flow');
    expect(typeof id).toBe('string');
    expect(id).toMatch(/^tx_/);
  });

  test('transactions map to pages[] in build()', () => {
    hb.startTransaction('Login');
    hb.endTransaction();
    hb.startTransaction('Checkout');
    const { pages } = hb.build().log;
    expect(pages).toHaveLength(2);
    expect(pages[0].title).toBe('Login');
    expect(pages[1].title).toBe('Checkout');
    expect(pages[0].id).toMatch(/^tx_/);
  });

  test('entries recorded during a transaction carry its pageref', () => {
    const tabId = 1;
    hb.startTransaction('MyFlow');
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onResponseReceived(tabId, makeResponseParams('req-1'));
    hb.onLoadingFinished(tabId, makeFinishedParams('req-1'), null);
    hb.endTransaction();

    const { entries, pages } = hb.build().log;
    expect(entries[0].pageref).toBe(pages[0].id);
  });

  test('entries outside any transaction have null pageref', () => {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onResponseReceived(tabId, makeResponseParams('req-1'));
    hb.onLoadingFinished(tabId, makeFinishedParams('req-1'), null);

    const { entries } = hb.build().log;
    expect(entries[0].pageref).toBeNull();
  });

  test('page onLoad timing is set when transaction ends before build', () => {
    hb.startTransaction('Flow');
    hb.endTransaction();
    const { pages } = hb.build().log;
    expect(pages[0].pageTimings.onLoad).toBeGreaterThanOrEqual(0);
  });

  test('page onLoad is -1 when transaction is still open at build time', () => {
    hb.startTransaction('Flow');
    // Not calling endTransaction — still open
    const { pages } = hb.build().log;
    expect(pages[0].pageTimings.onLoad).toBe(-1);
  });
});

// ── reset() ────────────────────────────────────────────────────────────────────

describe('HarBuilder.reset()', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  test('clears all state after recording', () => {
    const tabId = 1;
    hb.startTransaction('T1');
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onResponseReceived(tabId, makeResponseParams('req-1'));
    hb.onLoadingFinished(tabId, makeFinishedParams('req-1'), null);
    expect(hb.completedEntries).toHaveLength(1);

    hb.reset();
    expect(hb.pendingEntries.size).toBe(0);
    expect(hb.completedEntries).toHaveLength(0);
    expect(hb.completedTransactions).toHaveLength(0);
    expect(hb.activeTransaction).toBeNull();
    expect(hb.build().log.entries).toHaveLength(0);
  });
});

// ── HTTP version resolution ────────────────────────────────────────────────────

describe('HarBuilder — HTTP version resolution', () => {
  let hb;
  beforeEach(() => { hb = new HarBuilder(); });

  function recordWithProtocol(proto) {
    const tabId = 1;
    hb.onRequestStarted(tabId, makeRequestParams());
    hb.onResponseReceived(tabId, makeResponseParams('req-1', { protocol: proto }));
    hb.onLoadingFinished(tabId, makeFinishedParams('req-1'), null);
    return hb.build().log.entries[0].response.httpVersion;
  }

  test('h2 → HTTP/2', ()      => { expect(recordWithProtocol('h2')).toBe('HTTP/2'); });
  test('h3 → HTTP/3', ()      => { expect(recordWithProtocol('h3')).toBe('HTTP/3'); });
  test('http/1.1 → HTTP/1.1', () => { expect(recordWithProtocol('http/1.1')).toBe('HTTP/1.1'); });
  test('null → HTTP/1.1',     () => { expect(recordWithProtocol(null)).toBe('HTTP/1.1'); });
});
