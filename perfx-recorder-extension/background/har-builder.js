/**
 * har-builder.js
 *
 * Assembles a valid HAR 1.2 object from raw CDP Network events.
 * Called by cdp-capture.js as events arrive.
 *
 * Design:
 *   - pendingEntries  Map  — in-flight entries keyed by `${tabId}:${requestId}`
 *   - completedEntries []  — finalized entries (pushed when loadingFinished fires)
 *   - pendingBodyFetches   — tracked promises so stop can await them
 *
 * Exports the singleton `harBuilder`.
 */

class HarBuilder {
  constructor() {
    this.reset();
  }

  reset() {
    this.pendingEntries       = new Map();   // `tabId:requestId` → entry object
    this.completedEntries     = [];           // finalized, ordered by push time
    this.pendingBodyFetches   = new Set();   // Promise set — awaited on stop
    this.activeTransaction    = null;         // {id, name, startTime (epochMs)}
    this.completedTransactions = [];          // [{id, name, startTime, endTime}]
    this._txCounter           = 0;
  }

  // ── Transaction management ─────────────────────────────────────────────────

  startTransaction(name) {
    const id = `tx_${++this._txCounter}`;
    this.activeTransaction = { id, name, startTime: Date.now(), endTime: null };
    this.completedTransactions.push(this.activeTransaction);
    return id;
  }

  endTransaction() {
    if (this.activeTransaction) {
      this.activeTransaction.endTime = Date.now();
      this.activeTransaction = null;
    }
  }

  getTransactions() {
    return this.completedTransactions;
  }

  // ── CDP event handlers ─────────────────────────────────────────────────────

  /**
   * @param {number} tabId
   * @param {object} params  — CDP Network.requestWillBeSent params
   * @param {object} [extra] — { normalizedUrl, burstId } from cdp-capture (Phase 3)
   */
  onRequestStarted(tabId, params, extra = {}) {
    const { requestId, request, timestamp, wallTime, type } = params;
    const key = `${tabId}:${requestId}`;

    // wallTime is Unix epoch seconds; timestamp is CDP monotonic (less reliable for display)
    const startEpochMs = (wallTime || timestamp) * 1000;

    const entry = {
      // Internal tracking — stripped at build time
      _tabId:               tabId,
      _requestId:           requestId,
      _requestTimestamp:    timestamp,
      _responseTimestamp:   null,
      _finishedTimestamp:   null,
      _startEpochMs:        startEpochMs,
      _cdpTiming:           null,
      _resourceType:        type || 'Other',
      _burstId:             extra.burstId || null,

      // HAR 1.2 custom fields (kept in output)
      _perfx_class:         'unknown',
      _perfx_interval:      null,
      _perfx_occurrences:   1,
      _perfx_burst_id:      extra.burstId || null,
      _normalizedUrl:       extra.normalizedUrl || request.url,

      startedDateTime:      new Date(startEpochMs).toISOString(),
      time:                 -1,
      pageref:              this.activeTransaction?.id || null,

      request: {
        method:      request.method.toUpperCase(),
        url:         request.url,
        httpVersion: 'HTTP/1.1',
        headers:     this._objToHarHeaders(request.headers),
        queryString: this._parseQueryString(request.url),
        cookies:     this._parseCookiesFromHeaders(request.headers),
        headersSize: -1,
        bodySize:    -1,
      },

      response:   null,
      cache:      {},
      timings:    { send: 0, wait: -1, receive: -1 },
    };

    if (request.postData) {
      entry.request.bodySize = request.postData.length;
      entry.request.postData = {
        mimeType: request.headers['Content-Type']
                  || request.headers['content-type']
                  || 'application/octet-stream',
        text: request.postData,
      };
    }

    this.pendingEntries.set(key, entry);
  }

  onResponseReceived(tabId, params) {
    const { requestId, response, timestamp } = params;
    const key = `${tabId}:${requestId}`;
    const entry = this.pendingEntries.get(key);
    if (!entry) return;

    entry._responseTimestamp = timestamp;
    entry._cdpTiming = response.timing || null;

    const httpVersion = this._resolveHttpVersion(response.protocol);

    entry.response = {
      status:      response.status,
      statusText:  response.statusText || '',
      httpVersion,
      headers:     this._objToHarHeaders(response.headers),
      cookies:     [],   // Set-Cookie parsing is complex; omitted for Phase 1
      content: {
        size:     response.encodedDataLength >= 0 ? response.encodedDataLength : -1,
        mimeType: response.mimeType || 'application/octet-stream',
        text:     '',    // filled by onLoadingFinished after body fetch
      },
      redirectURL: response.headers?.location || response.headers?.Location || '',
      headersSize: -1,
      bodySize:    -1,
    };
  }

  onRedirect(tabId, params) {
    // A redirect fires requestWillBeSent again with the same requestId and a
    // redirectResponse. Treat the previous request as complete with the redirect response.
    const { requestId, redirectResponse, timestamp } = params;
    const key = `${tabId}:${requestId}`;
    const entry = this.pendingEntries.get(key);
    if (!entry || !redirectResponse) return;

    entry._finishedTimestamp = timestamp;
    entry.time = Math.max(0, (timestamp - entry._requestTimestamp) * 1000);

    // Use the redirect response as the response object
    if (!entry.response) {
      entry.response = {
        status:      redirectResponse.status,
        statusText:  redirectResponse.statusText || '',
        httpVersion: this._resolveHttpVersion(redirectResponse.protocol),
        headers:     this._objToHarHeaders(redirectResponse.headers),
        cookies:     [],
        content:     { size: -1, mimeType: '', text: '' },
        redirectURL: redirectResponse.headers?.location || '',
        headersSize: -1,
        bodySize:    0,
      };
    }

    entry.timings = this._computeTimings(entry);
    this.pendingEntries.delete(key);
    this.completedEntries.push(entry);

    // The new request (same requestId) will be added by onRequestStarted
  }

  onLoadingFinished(tabId, params, bodyResult) {
    const { requestId, timestamp, encodedDataLength } = params;
    const key = `${tabId}:${requestId}`;
    const entry = this.pendingEntries.get(key);
    if (!entry) return;

    entry._finishedTimestamp = timestamp;
    entry.time = Math.max(0, (timestamp - entry._requestTimestamp) * 1000);

    if (entry.response) {
      if (encodedDataLength >= 0) {
        entry.response.bodySize    = encodedDataLength;
        entry.response.content.size = encodedDataLength;
      }

      if (bodyResult) {
        entry.response.content.text = bodyResult.body || '';
        if (bodyResult.base64Encoded) {
          entry.response.content.encoding = 'base64';
        }
      }
    }

    entry.timings = this._computeTimings(entry);
    this.pendingEntries.delete(key);
    this.completedEntries.push(entry);
  }

  onLoadingFailed(tabId, params) {
    const { requestId, timestamp } = params;
    const key = `${tabId}:${requestId}`;
    const entry = this.pendingEntries.get(key);
    if (!entry) return;

    entry._finishedTimestamp = timestamp;
    entry.time = Math.max(0, (timestamp - entry._requestTimestamp) * 1000);

    if (!entry.response) {
      entry.response = {
        status:      0,
        statusText:  'Failed',
        httpVersion: 'HTTP/1.1',
        headers:     [],
        cookies:     [],
        content:     { size: 0, mimeType: '', text: '' },
        redirectURL: '',
        headersSize: -1,
        bodySize:    -1,
      };
    }

    entry.timings = { send: 0, wait: -1, receive: -1 };
    this.pendingEntries.delete(key);
    this.completedEntries.push(entry);
  }

  // ── Stop helpers ───────────────────────────────────────────────────────────

  /**
   * Flush remaining pending entries (requests still in-flight when Stop was pressed).
   * Called after waitForPendingBodies(), before detaching the debugger.
   */
  flush() {
    for (const entry of this.pendingEntries.values()) {
      if (!entry.response) {
        entry.response = {
          status:      0,
          statusText:  'Incomplete',
          httpVersion: 'HTTP/1.1',
          headers:     [],
          cookies:     [],
          content:     { size: 0, mimeType: '', text: '' },
          redirectURL: '',
          headersSize: -1,
          bodySize:    -1,
        };
      }
      entry.timings = this._computeTimings(entry);
      this.completedEntries.push(entry);
    }
    this.pendingEntries.clear();
  }

  // ── Build final HAR ────────────────────────────────────────────────────────

  /**
   * Walk all completed entries and stamp final `_perfx_*` classification from
   * the detector. Call this before build() at stop time.
   * @param {import('./bg-detector.js').BackgroundDetector} detector
   */
  enrichFromDetector(detector) {
    for (const entry of this.completedEntries) {
      const normUrl = entry._normalizedUrl;
      if (!normUrl) continue;
      entry._perfx_class       = detector.getClass(normUrl);
      entry._perfx_interval    = detector.getInterval(normUrl);
      entry._perfx_occurrences = detector.getOccurrences(normUrl);
    }
  }

  /**
   * @returns {Object} HAR 1.2 object (includes _perfx_* and _normalizedUrl)
   */
  build() {
    // Sort by wall-clock start time
    const sorted = [...this.completedEntries].sort(
      (a, b) => a._startEpochMs - b._startEpochMs
    );

    // Internal tracking fields to strip — NOT the _perfx_* public custom fields
    const STRIP = new Set([
      '_tabId', '_requestId', '_requestTimestamp', '_responseTimestamp',
      '_finishedTimestamp', '_startEpochMs', '_cdpTiming', '_resourceType', '_burstId',
    ]);

    const entries = sorted.map(e => {
      const harEntry = {};
      for (const [k, v] of Object.entries(e)) {
        if (!STRIP.has(k)) harEntry[k] = v;
      }
      return harEntry;
    });

    const transactions = this.completedTransactions;
    const pages = transactions.map(tx => ({
      startedDateTime: new Date(tx.startTime).toISOString(),
      id:              tx.id,
      title:           tx.name,
      pageTimings: {
        onContentLoad: -1,
        onLoad:        tx.endTime ? tx.endTime - tx.startTime : -1,
      },
    }));

    return {
      log: {
        version: '1.2',
        creator: { name: 'PerfX Studio Recorder', version: '1.0.0', comment: '' },
        browser: { name: 'Chrome', version: '', comment: '' },
        pages,
        entries,
      },
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _objToHarHeaders(headersObj) {
    if (!headersObj) return [];
    return Object.entries(headersObj).map(([name, value]) => ({
      name,
      value: String(value),
    }));
  }

  _parseQueryString(url) {
    try {
      const u = new URL(url);
      const qs = [];
      u.searchParams.forEach((value, name) => qs.push({ name, value }));
      return qs;
    } catch (_) {
      return [];
    }
  }

  _parseCookiesFromHeaders(headers) {
    const raw = headers?.cookie || headers?.Cookie;
    if (!raw) return [];
    return raw.split(';').map(c => {
      const eq = c.indexOf('=');
      return eq < 0
        ? { name: c.trim(), value: '' }
        : { name: c.slice(0, eq).trim(), value: c.slice(eq + 1).trim() };
    });
  }

  _resolveHttpVersion(protocol) {
    if (!protocol) return 'HTTP/1.1';
    if (protocol === 'h2')  return 'HTTP/2';
    if (protocol === 'h3')  return 'HTTP/3';
    if (protocol.startsWith('http/')) return `HTTP/${protocol.slice(5)}`;
    return 'HTTP/1.1';
  }

  _computeTimings(entry) {
    const cdp = entry._cdpTiming;
    if (!cdp) {
      const total = entry.time >= 0 ? entry.time : -1;
      return { send: 0, wait: total >= 0 ? total : -1, receive: 0 };
    }

    // CDP timing values are in milliseconds relative to the request's requestTime.
    // -1 means the phase did not occur.
    const dns      = cdp.dnsEnd    > 0 ? Math.max(0, cdp.dnsEnd    - cdp.dnsStart)    : -1;
    const connect  = cdp.connectEnd > 0 ? Math.max(0, cdp.connectEnd - cdp.connectStart) : -1;
    const ssl      = cdp.sslEnd    > 0 ? Math.max(0, cdp.sslEnd    - cdp.sslStart)    : -1;
    const send     = Math.max(0, cdp.sendEnd - cdp.sendStart);
    const wait     = Math.max(0, cdp.receiveHeadersEnd - cdp.sendEnd);
    const receive  = Math.max(0, (entry._finishedTimestamp - entry._requestTimestamp) * 1000
                                  - cdp.receiveHeadersEnd);

    // blocked = time before DNS/connect started (or before send if no connect)
    const firstPhaseStart = cdp.dnsStart >= 0 ? cdp.dnsStart
                          : cdp.connectStart >= 0 ? cdp.connectStart
                          : cdp.sendStart;
    const blocked = Math.max(0, firstPhaseStart);

    return { blocked, dns, connect, ssl, send, wait, receive };
  }
}

export const harBuilder = new HarBuilder();
