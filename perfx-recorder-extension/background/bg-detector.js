/**
 * bg-detector.js
 *
 * Real-time background request classifier.
 *
 * Classifies each normalized URL as:
 *   'unknown'   — not enough data yet (< 3 occurrences)
 *   'periodic'  — fires at regular intervals (CoV < 0.30, ≥ 3 calls, ≤ 30s mean)
 *   'once'      — seen only once across the whole recording (set at build time)
 *
 * The active request count in cdp-capture.js uses isRequestPeriodic() to decide
 * whether a new request increments the "real" count or the background counter.
 *
 * Exports the singleton `bgDetector`.
 */

class BackgroundDetector {
  // ── Configuration ──────────────────────────────────────────────────────────
  static BURST_WINDOW_MS   = 200;     // requests within 200ms share a burst group
  static MIN_CALLS_PERIODIC = 3;     // minimum occurrences before declaring periodic
  static MAX_PERIOD_MS     = 30_000; // mean interval > 30s → not a background poll
  static COV_THRESHOLD     = 0.30;   // coefficient of variation < 30% → regular cadence

  // Known background-endpoint path fragments (URL pattern pre-classification)
  static BACKGROUND_PATHS  = [
    '/ping', '/heartbeat', '/keepalive', '/keep-alive', '/health',
    '/poll', '/long-poll', '/longpoll', '/comet',
    '/socket.io', '/sockjs', '/push', '/sse', '/events/stream',
    '/notifications/count', '/notifications/unread', '/notifications/badge',
    '/badge', '/presence', '/subscribe', '/live', '/realtime',
    '/beacon', '/analytics/event', '/telemetry', '/metrics',
  ];

  constructor() {
    this.reset();
  }

  reset() {
    // normalizedUrl → {
    //   timestamps: number[],          call timestamps in ms
    //   requestIds: string[],
    //   responseHashes: Set<string>,   simple hash of body to detect stable responses
    //   class: 'unknown'|'periodic',
    //   interval: number|null,         mean interval in ms
    // }
    this.urlData        = new Map();

    // requestId → normalizedUrl  (O(1) lookup on response / finish)
    this.requestIdMap   = new Map();

    // Burst grouping
    this.pendingBurst   = null;       // { id, windowStart, requestIds[] }
    this.burstCounter   = 0;
    this.requestBurstMap = new Map(); // requestId → burstId

    // User gesture timestamps (sent by content script)
    this.gestureTimestamps = [];
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Call when a new network request starts.
   * @param {string} requestId
   * @param {string} normalizedUrl  — already normalized by url-normalizer.js
   * @param {number} timestampSeconds  — CDP monotonic timestamp
   */
  onRequest(requestId, normalizedUrl, timestampSeconds) {
    const tsMs = timestampSeconds * 1000;

    if (!this.urlData.has(normalizedUrl)) {
      this.urlData.set(normalizedUrl, {
        timestamps:    [],
        requestIds:    [],
        responseHashes: new Set(),
        class:          'unknown',
        interval:       null,
      });
    }
    const data = this.urlData.get(normalizedUrl);
    data.timestamps.push(tsMs);
    data.requestIds.push(requestId);

    this.requestIdMap.set(requestId, normalizedUrl);

    // Burst grouping — must happen before frequency check
    this._assignBurst(requestId, tsMs);

    // Fast-path: known background endpoint pattern → mark as candidate immediately
    if (data.class === 'unknown' && this._matchesBackgroundPattern(normalizedUrl)) {
      data.class = 'periodic-candidate';
    }

    // Frequency analysis — runs when we have enough data
    if (data.timestamps.length >= BackgroundDetector.MIN_CALLS_PERIODIC) {
      this._checkFrequency(data);
    }
  }

  /**
   * Call when a response body is available.
   * Stable body across multiple calls supports periodic classification.
   */
  onResponseBody(requestId, bodyText) {
    const normalizedUrl = this.requestIdMap.get(requestId);
    if (!normalizedUrl) return;
    const data = this.urlData.get(normalizedUrl);
    if (!data) return;
    // Hash = length + first 100 chars of body
    const hash = `${bodyText.length}:${bodyText.slice(0, 100)}`;
    data.responseHashes.add(hash);
  }

  /**
   * Call when a user gesture (click / submit / Enter) is detected by the content script.
   */
  onUserGesture(timestampMs) {
    this.gestureTimestamps.push(timestampMs);
    if (this.gestureTimestamps.length > 20) this.gestureTimestamps.shift();
  }

  /** True if this normalizedUrl has been confirmed as a periodic background poll. */
  isConfirmedPeriodic(normalizedUrl) {
    const data = this.urlData.get(normalizedUrl);
    return data ? data.class === 'periodic' : false;
  }

  /** True if the request with this requestId is for a confirmed-periodic URL. */
  isRequestPeriodic(requestId) {
    const normalizedUrl = this.requestIdMap.get(requestId);
    return normalizedUrl ? this.isConfirmedPeriodic(normalizedUrl) : false;
  }

  getClass(normalizedUrl) {
    const data = this.urlData.get(normalizedUrl);
    if (!data) return 'unknown';
    // Seen only once and not periodic → 'once'
    if (data.timestamps.length === 1 && data.class === 'unknown') return 'once';
    return data.class === 'periodic-candidate' ? 'periodic' : data.class;
  }

  getInterval(normalizedUrl) {
    return this.urlData.get(normalizedUrl)?.interval ?? null;
  }

  getOccurrences(normalizedUrl) {
    return this.urlData.get(normalizedUrl)?.timestamps.length ?? 0;
  }

  getBurstId(requestId) {
    return this.requestBurstMap.get(requestId) ?? null;
  }

  /** Summary of all periodic/candidate URLs — used for HAR _perfx metadata. */
  getSummary() {
    const result = [];
    for (const [normalizedUrl, data] of this.urlData) {
      if (data.class === 'periodic' || data.class === 'periodic-candidate') {
        result.push({
          normalizedUrl,
          class:           data.class,
          occurrences:     data.timestamps.length,
          intervalMs:      data.interval,
          responseVariance: data.responseHashes.size,
        });
      }
    }
    return result;
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  _checkFrequency(data) {
    const { timestamps } = data;
    const intervals = [];
    for (let i = 1; i < timestamps.length; i++) {
      intervals.push(timestamps[i] - timestamps[i - 1]);
    }

    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;
    if (mean <= 0 || mean > BackgroundDetector.MAX_PERIOD_MS) return;

    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    const stdDev   = Math.sqrt(variance);
    const CoV      = stdDev / mean;

    if (CoV < BackgroundDetector.COV_THRESHOLD) {
      data.class    = 'periodic';
      data.interval = mean;
    }
  }

  _assignBurst(requestId, tsMs) {
    const BW = BackgroundDetector.BURST_WINDOW_MS;
    if (this.pendingBurst && (tsMs - this.pendingBurst.windowStart) <= BW) {
      this.pendingBurst.requestIds.push(requestId);
      this.requestBurstMap.set(requestId, this.pendingBurst.id);
    } else {
      const burstId = `burst_${++this.burstCounter}`;
      this.pendingBurst = { id: burstId, windowStart: tsMs, requestIds: [requestId] };
      this.requestBurstMap.set(requestId, burstId);
    }
  }

  _matchesBackgroundPattern(normalizedUrl) {
    const lower = normalizedUrl.toLowerCase();
    return BackgroundDetector.BACKGROUND_PATHS.some(p => lower.includes(p));
  }
}

export const bgDetector = new BackgroundDetector();
