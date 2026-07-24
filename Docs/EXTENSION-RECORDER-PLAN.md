# PerfX Studio Recorder — Browser Extension Implementation Plan

**Status:** Phase 5 Complete — All phases done  
**Date:** 2026-07-23  
**Scope:** Chrome/Edge browser extension for multi-window HAR recording with background request detection  
**Target browsers:** Chrome 114+, Edge (Chromium, any recent version)  
**Integration:** Output feeds existing PerfX Studio HAR pipeline unchanged

---

## Problem Statement

Current recording method (browser favourites/bookmarklets) has two hard blockers:

1. **Multi-window blind spot.** Each browser window has its own DevTools network log. Popup windows (OTP dialogs, payment iframes, document previews) are silently missed — the tester doesn't know until script replay fails.

2. **No "settled" signal.** Modern SPAs fire background requests every 1–3 seconds (session keepalive, notification polling, analytics heartbeats). The tester cannot tell when the actual user-triggered requests have completed, so transaction boundaries are consistently wrong.

The extension solves both by capturing all windows via Chrome DevTools Protocol and running a real-time background request classifier that keeps the active count honest.

---

## Goals

| Goal | Success criterion |
|------|-------------------|
| Capture all windows | Popup windows appear in the HAR without tester doing anything |
| Accurate "settled" signal | Count drops to 0 after every user action, regardless of background polls |
| Clean script output | Periodic background requests excluded from main loop by default |
| No admin rights required | Installs from Chrome Web Store into user profile |
| No server-side changes for capture | HAR format unchanged; classification is additive (custom `_perfx_*` fields) |
| Bank-compatible | No external network calls; all data stays local; auditable source |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│  Chrome / Edge browser                                               │
│                                                                      │
│  ┌──────────────────────────────┐   ┌──────────────────────────┐   │
│  │  Background Service Worker   │   │  Side Panel              │   │
│  │  (persistent, MV3)           │◄──┤  sidepanel.html/js/css   │   │
│  │                              │   │                          │   │
│  │  cdp-capture.js  ────────────┼───┤  Panel State 1–7         │   │
│  │  har-builder.js              │   │  Live count display      │   │
│  │  bg-detector.js  ────────────┼───┤  Start/End Transaction   │   │
│  │  url-normalizer.js           │   │  Export controls         │   │
│  └──────────┬───────────────────┘   └──────────────────────────┘   │
│             │  chrome.debugger API (CDP)                            │
│             ▼                                                        │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │  All browser tabs + popups (attached automatically)          │   │
│  │  Tab 1: netbank.internal/login                               │   │
│  │  Tab 2: popup — OTP dialog (auto-attached on open)           │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                                                                      │
│  ┌──────────────────────────────┐                                   │
│  │  Content Script              │                                   │
│  │  gesture-detector.js         │  Detects clicks/submits on page  │
│  └──────────────────────────────┘  Timestamps sent to service worker│
└─────────────────────────────────────────────────────────────────────┘
         │  POST HAR / Open tab
         ▼
┌─────────────────────────────────────┐
│  PerfX Studio (existing server)     │
│  /converter/studio                  │
│  Reads _perfx_class from HAR        │
│  Shows background review panel      │
│  Generates script (filtered)        │
└─────────────────────────────────────┘
```

---

## Folder Structure

```
perfx-recorder-extension/
├── manifest.json
├── background/
│   ├── service-worker.js       # Orchestrator — recording state, tab management
│   ├── cdp-capture.js          # CDP event handlers, active count tracking
│   ├── har-builder.js          # Assembles final HAR from CDP events
│   ├── bg-detector.js          # Background request classifier (core algorithm)
│   └── url-normalizer.js       # Strip timestamps, UUIDs, cache-busters from URLs
├── sidepanel/
│   ├── sidepanel.html          # Panel HTML (all 7 states)
│   ├── sidepanel.js            # State machine, messaging, count display
│   └── sidepanel.css           # Dark-themed panel styles
├── content/
│   └── gesture-detector.js     # Intercepts click/submit events, sends to SW
└── icons/
    ├── px-16.png
    ├── px-32.png
    └── px-48.png
```

**PerfX Studio changes** (existing repo, `src/` tree):

```
src/
├── parsers/
│   └── harParser.js            # NEW — reads _perfx_class, builds classified entry list
├── web/public/
│   ├── VuGen-Script-Studio.html        # MODIFIED — add background review panel HTML
│   ├── studio-app.js                   # MODIFIED — handle classified HAR on upload
│   └── studio-ui.js                    # MODIFIED — renderBackgroundReview()
└── generators/
    ├── advancedScriptGenerator.js      # MODIFIED — skip periodic entries in main loop
    └── webHttpScriptGenerator.js       # MODIFIED — same
```

---

## Phase 1 — Extension Foundation ✅ COMPLETE

**Goal:** Working extension that captures all windows and exports a valid HAR.  
**Deliverables:** Install from unpacked, click record, navigate, stop, download `.har`.

### 1.1 `manifest.json`

```json
{
  "manifest_version": 3,
  "name": "PerfX Studio Recorder",
  "version": "1.0.0",
  "description": "Record browser traffic across all tabs and popups for PerfX Studio.",
  "permissions": ["debugger", "tabs", "storage", "sidePanel", "notifications"],
  "host_permissions": ["<all_urls>"],
  "background": { "service_worker": "background/service-worker.js" },
  "side_panel": { "default_path": "sidepanel/sidepanel.html" },
  "action": { "default_title": "Open PerfX Recorder", "default_icon": { "32": "icons/px-32.png" } },
  "content_scripts": [{ "matches": ["<all_urls>"], "js": ["content/gesture-detector.js"] }],
  "minimum_chrome_version": "114"
}
```

Note: `"debugger"` permission causes Chrome to show a yellow info bar ("Chrome is being controlled by…") on all attached tabs during recording. This is unavoidable and expected — it disappears when recording stops.

### 1.2 `background/service-worker.js`

Responsibilities: recording state, tab attachment, routing messages from panel and content scripts.

```javascript
// State object (stored in chrome.storage.session for persistence across SW restarts)
const state = {
  recording: false,
  transactions: [],          // [{id, name, startTime, endTime}]
  activeTransactionId: null,
  startTime: null,
};

// On extension icon click → open side panel
chrome.action.onClicked.addListener(tab => {
  chrome.sidePanel.open({ tabId: tab.id });
});

// When a new tab opens during recording → attach debugger automatically
chrome.tabs.onCreated.addListener(tab => {
  if (state.recording) attachDebugger(tab.id);
});

// When a tab is removed → detach (avoids orphaned debugger)
chrome.tabs.onRemoved.addListener(tabId => {
  detachDebugger(tabId);
});

// Message routing from sidepanel.js and gesture-detector.js
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  switch (msg.type) {
    case 'START_RECORDING':   return handleStartRecording(reply);
    case 'STOP_RECORDING':    return handleStopRecording(reply);
    case 'START_TRANSACTION': return handleStartTransaction(msg.name, reply);
    case 'END_TRANSACTION':   return handleEndTransaction(reply);
    case 'GET_STATE':         return reply(state);
    case 'USER_GESTURE':      return bgDetector.onUserGesture(msg.timestamp);
  }
});
```

### 1.3 `background/cdp-capture.js`

Attaches Chrome DevTools Protocol to a tab and captures Network events.

```javascript
const ACTIVE_TABS = new Map();  // tabId → { requests: Map<requestId, RequestEntry> }

async function attachDebugger(tabId) {
  if (ACTIVE_TABS.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
    maxResourceBufferSize: 10 * 1024 * 1024,  // 10 MB response body buffer
    maxTotalBufferSize: 50 * 1024 * 1024,
  });
  ACTIVE_TABS.set(tabId, { requests: new Map() });
}

async function detachDebugger(tabId) {
  if (!ACTIVE_TABS.has(tabId)) return;
  try { await chrome.debugger.detach({ tabId }); } catch (_) {}
  ACTIVE_TABS.delete(tabId);
}

// CDP event dispatcher
chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabData = ACTIVE_TABS.get(source.tabId);
  if (!tabData) return;

  switch (method) {
    case 'Network.requestWillBeSent':
      onRequestStarted(source.tabId, params);
      break;
    case 'Network.responseReceived':
      onResponseReceived(source.tabId, params);
      break;
    case 'Network.loadingFinished':
      onRequestFinished(source.tabId, params.requestId);
      break;
    case 'Network.loadingFailed':
      onRequestFinished(source.tabId, params.requestId);
      break;
  }
});
```

**Active count logic (inside cdp-capture.js):**

```javascript
let activeCount = 0;
let settledTimer = null;
const SETTLED_DELAY_MS = 500;  // configurable

function onRequestStarted(tabId, params) {
  const { requestId, request, timestamp } = params;
  const normalized = urlNormalizer.normalize(request.url);
  const isPeriodic = bgDetector.isConfirmedPeriodic(normalized);

  // Store for HAR assembly
  harBuilder.onRequestStarted(tabId, requestId, request, timestamp, normalized);

  // Tell background detector (always — needed for detection)
  bgDetector.onRequest(requestId, normalized, timestamp);

  // Only count non-periodic requests toward the "settled" signal
  if (!isPeriodic) {
    activeCount++;
    clearTimeout(settledTimer);
    settledTimer = null;
    broadcastCount();
  }
}

function onRequestFinished(tabId, requestId) {
  const isPeriodic = bgDetector.isRequestPeriodic(requestId);
  harBuilder.onRequestFinished(tabId, requestId);

  if (!isPeriodic) {
    activeCount = Math.max(0, activeCount - 1);
    broadcastCount();
    if (activeCount === 0) {
      settledTimer = setTimeout(() => {
        broadcastSettled();
      }, SETTLED_DELAY_MS);
    }
  }
}

function broadcastCount() {
  chrome.runtime.sendMessage({
    type: 'COUNT_UPDATE',
    active: activeCount,
    background: bgDetector.getPeriodicActiveCount(),
  }).catch(() => {});  // panel may not be open
}

function broadcastSettled() {
  chrome.runtime.sendMessage({ type: 'SETTLED' }).catch(() => {});
}
```

### 1.4 `background/har-builder.js`

Accumulates CDP data into a standard HAR object. Adds `_perfx_*` fields per entry.

```javascript
class HarBuilder {
  constructor() {
    this.entries = [];     // Ordered by startTime
    this.entryMap = new Map();  // requestId → entry (mutable during capture)
    this.pages = [];       // Populated from transactions
  }

  onRequestStarted(tabId, requestId, request, timestamp, normalizedUrl) {
    const entry = {
      _requestId: requestId,
      _tabId: tabId,
      _normalizedUrl: normalizedUrl,
      _perfx_class: 'unknown',     // filled by bgDetector at export time
      _perfx_interval: null,
      _perfx_occurrences: 0,
      _perfx_burst_id: null,
      startedDateTime: new Date(timestamp * 1000).toISOString(),
      time: 0,
      pageref: null,              // filled when inside a transaction
      request: {
        method: request.method,
        url: request.url,
        httpVersion: 'HTTP/1.1',
        headers: objectToHarHeaders(request.headers),
        queryString: parseQueryString(request.url),
        cookies: [],
        headersSize: -1,
        bodySize: request.postData ? request.postData.length : 0,
        postData: request.postData ? { mimeType: request.headers['Content-Type'] || '', text: request.postData } : undefined,
      },
      response: null,             // filled on responseReceived + loadingFinished
      cache: {},
      timings: { send: 0, wait: 0, receive: 0 },
    };
    this.entryMap.set(requestId, entry);
  }

  onResponseReceived(tabId, requestId, response) { /* fill response headers */ }
  onResponseBody(requestId, body) { /* fill response body, compute hash for bgDetector */ }
  onRequestFinished(tabId, requestId) { /* compute timings, push to this.entries */ }

  // Called at export time after bgDetector has classified everything
  applyClassifications() {
    for (const entry of this.entries) {
      const norm = entry._normalizedUrl;
      entry._perfx_class = bgDetector.getClass(norm);
      entry._perfx_interval = bgDetector.getInterval(norm);
      entry._perfx_occurrences = bgDetector.getOccurrences(norm);
      entry._perfx_burst_id = bgDetector.getBurstId(entry._requestId);
    }
  }

  build(transactions) {
    this.applyClassifications();
    return {
      log: {
        version: '1.2',
        creator: { name: 'PerfX Studio Recorder', version: '1.0.0' },
        pages: transactions.map(tx => ({
          id: tx.id,
          title: tx.name,
          startedDateTime: new Date(tx.startTime * 1000).toISOString(),
          pageTimings: { onLoad: tx.endTime ? (tx.endTime - tx.startTime) * 1000 : -1 },
        })),
        entries: this.entries,
      },
    };
  }
}
```

---

## Phase 2 — Transaction Support ✅ COMPLETE

**Goal:** Start/End transaction with name, timer, trail chips, settled signal.  
**UI states covered:** 1 (idle), 2 (recording loading), 3 (recording ready), 3b (naming), 4 (in-tx loading), 5 (in-tx ready), 6 (trail), 7 (stopped).

### 2.1 `sidepanel/sidepanel.js` — State Machine

```javascript
const STATES = {
  IDLE: 'idle',
  RECORDING_LOADING: 'recording-loading',
  RECORDING_READY: 'recording-ready',
  NAMING: 'naming',
  TX_LOADING: 'tx-loading',
  TX_READY: 'tx-ready',
  STOPPED: 'stopped',
};

let currentState = STATES.IDLE;
let recTimer = null;
let txTimer = null;
let completedTransactions = [];

function transition(newState) {
  currentState = newState;
  render();
}

// Listen to messages from service worker
chrome.runtime.onMessage.addListener(msg => {
  if (msg.type === 'COUNT_UPDATE') {
    updateCountDisplay(msg.active, msg.background);
    if (msg.active > 0) {
      if (currentState === STATES.RECORDING_READY) transition(STATES.RECORDING_LOADING);
      if (currentState === STATES.TX_READY) transition(STATES.TX_LOADING);
    }
  }
  if (msg.type === 'SETTLED') {
    if (currentState === STATES.RECORDING_LOADING) transition(STATES.RECORDING_READY);
    if (currentState === STATES.TX_LOADING) transition(STATES.TX_READY);
  }
});
```

### 2.2 Count display in panel

The count number is the primary visual element. In the panel HTML:

```html
<div class="count-block" id="countBlock">
  <div class="count-row">
    <span class="count-num" id="countNum">0</span>
    <span class="count-unit">active</span>
  </div>
  <div class="count-status" id="countStatus">✓ All settled</div>
  <div class="count-detail" id="countDetail">Safe to start a transaction</div>
</div>
```

Update function:
```javascript
function updateCountDisplay(active, background) {
  document.getElementById('countNum').textContent = active;
  const block = document.getElementById('countBlock');
  block.className = `count-block ${active === 0 ? 'ready' : 'loading'}`;
  document.getElementById('countStatus').textContent =
    active === 0 ? '✓ All settled' : '⟳ Requests running';
  // Optionally show background count as footnote if > 0
  if (background > 0) {
    document.getElementById('countDetail').textContent =
      `+ ${background} background (excluded)`;
  }
}
```

### 2.3 Transaction markers in HAR

When `START_TRANSACTION` is called, set `state.activeTransactionId`. All subsequent entries in `har-builder.js` have their `pageref` set to this ID. When `END_TRANSACTION` is called, clear `activeTransactionId`. Entries between transactions have `pageref = null`.

---

## Phase 3 — Background Detection Engine ✅ COMPLETE

**Goal:** Classify every request as `action | once | periodic | unknown` in real-time. Exclude `periodic` from the active count.

### 3.1 `background/url-normalizer.js`

Strip the parts of URLs that vary per-call but don't change the semantic endpoint identity.

```javascript
const CACHE_BUSTER_PARAMS = [
  '_t', '_ts', 'timestamp', 'nocache', '_bust', 'rand', 'random',
  'nonce', 'cb', '_cb', 'v', '_v', 'bust', '_nocache', 't'
];

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
const NUMERIC_ID_PATTERN = /\/\d{4,}\//g;  // long numeric IDs in paths

function normalize(rawUrl) {
  let url;
  try { url = new URL(rawUrl); }
  catch (_) { return rawUrl; }

  // Remove cache-buster query params
  for (const param of CACHE_BUSTER_PARAMS) {
    url.searchParams.delete(param);
  }

  // Replace UUIDs and long numeric IDs in pathname with placeholder
  url.pathname = url.pathname
    .replace(UUID_PATTERN, '{id}')
    .replace(NUMERIC_ID_PATTERN, '/{id}/');

  // Drop fragment
  url.hash = '';

  return url.origin + url.pathname + (url.search || '');
}

module.exports = { normalize };
```

### 3.2 `background/bg-detector.js`

This is the core algorithm.

```javascript
class BackgroundDetector {
  constructor() {
    // Per normalized-URL tracking
    this.urlData = new Map();
    // normalizedUrl → {
    //   timestamps: number[],         raw timestamps of each call
    //   requestIds: string[],         parallel list
    //   responseHashes: Set<string>,  hashed response bodies
    //   class: 'unknown'|'periodic'|'once'|'action',
    //   interval: number|null,        mean interval in ms
    // }

    // Per requestId → normalizedUrl (for O(1) lookup on finish)
    this.requestIdMap = new Map();

    // Burst groups: [{windowStart, requestIds[]}]
    // A burst = multiple requests starting within BURST_WINDOW_MS of each other
    this.pendingBurst = null;
    this.burstCounter = 0;
    this.requestBurstMap = new Map();  // requestId → burstId

    // User gesture timestamps from content script
    this.gestureTimestamps = [];
  }

  // ── Configuration ────────────────────────────────────────────
  static BURST_WINDOW_MS = 200;      // requests within 200ms = same burst
  static SETTLED_DELAY_MS = 500;     // 500ms quiet = settled
  static MIN_CALLS_PERIODIC = 3;     // need at least 3 occurrences
  static MAX_PERIOD_MS = 30_000;     // intervals > 30s are not "polling"
  static COV_THRESHOLD = 0.30;       // coefficient of variation < 30% = regular

  // ── Public API ───────────────────────────────────────────────

  onRequest(requestId, normalizedUrl, timestampSeconds) {
    const tsMs = timestampSeconds * 1000;

    // Track per-URL
    if (!this.urlData.has(normalizedUrl)) {
      this.urlData.set(normalizedUrl, {
        timestamps: [], requestIds: [], responseHashes: new Set(),
        class: 'unknown', interval: null,
      });
    }
    const data = this.urlData.get(normalizedUrl);
    data.timestamps.push(tsMs);
    data.requestIds.push(requestId);

    // Map requestId for later lookup
    this.requestIdMap.set(requestId, normalizedUrl);

    // Burst grouping
    this._assignBurst(requestId, tsMs);

    // URL pattern pre-classification
    if (data.class === 'unknown' && this._matchesBackgroundPattern(normalizedUrl)) {
      data.class = 'periodic-candidate';
    }

    // Run frequency check if we have enough data
    if (data.timestamps.length >= BackgroundDetector.MIN_CALLS_PERIODIC) {
      this._checkFrequency(normalizedUrl, data);
    }
  }

  onResponseBody(requestId, bodyText) {
    const normalizedUrl = this.requestIdMap.get(requestId);
    if (!normalizedUrl) return;
    const data = this.urlData.get(normalizedUrl);
    if (!data) return;
    // Simple hash: length + first 100 chars
    const hash = `${bodyText.length}:${bodyText.slice(0, 100)}`;
    data.responseHashes.add(hash);
    // If only 1 unique hash across 3+ responses → very stable → supports periodic
  }

  onUserGesture(timestampMs) {
    this.gestureTimestamps.push(timestampMs);
    // Keep only last 20 gestures (old ones irrelevant)
    if (this.gestureTimestamps.length > 20) this.gestureTimestamps.shift();
  }

  isConfirmedPeriodic(normalizedUrl) {
    const data = this.urlData.get(normalizedUrl);
    return data ? data.class === 'periodic' : false;
  }

  isRequestPeriodic(requestId) {
    const normalizedUrl = this.requestIdMap.get(requestId);
    return normalizedUrl ? this.isConfirmedPeriodic(normalizedUrl) : false;
  }

  getClass(normalizedUrl) {
    const data = this.urlData.get(normalizedUrl);
    return data ? data.class : 'unknown';
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

  getPeriodicActiveCount() {
    // How many in-flight requests are for confirmed-periodic URLs
    let count = 0;
    for (const [reqId, normUrl] of this.requestIdMap) {
      if (this.isConfirmedPeriodic(normUrl) && harBuilder.isRequestInFlight(reqId)) {
        count++;
      }
    }
    return count;
  }

  // Returns summary for HAR export / review UI
  getSummary() {
    const summary = [];
    for (const [normalizedUrl, data] of this.urlData) {
      if (['periodic', 'periodic-candidate'].includes(data.class)) {
        summary.push({
          normalizedUrl,
          class: data.class,
          occurrences: data.timestamps.length,
          intervalMs: data.interval,
          responseVariance: data.responseHashes.size,  // 1 = always same response
        });
      }
    }
    return summary;
  }

  // ── Private helpers ──────────────────────────────────────────

  _checkFrequency(normalizedUrl, data) {
    const intervals = [];
    for (let i = 1; i < data.timestamps.length; i++) {
      intervals.push(data.timestamps[i] - data.timestamps[i - 1]);
    }

    const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length;

    // Too slow to be considered polling
    if (mean > BackgroundDetector.MAX_PERIOD_MS) return;

    const variance = intervals.reduce((a, b) => a + (b - mean) ** 2, 0) / intervals.length;
    const stdDev = Math.sqrt(variance);
    const CoV = stdDev / mean;

    if (CoV < BackgroundDetector.COV_THRESHOLD) {
      data.class = 'periodic';
      data.interval = mean;
    }
  }

  _assignBurst(requestId, tsMs) {
    const BW = BackgroundDetector.BURST_WINDOW_MS;
    if (this.pendingBurst && tsMs - this.pendingBurst.windowStart <= BW) {
      // Add to existing burst
      this.pendingBurst.requestIds.push(requestId);
      this.requestBurstMap.set(requestId, this.pendingBurst.id);
    } else {
      // Start a new burst
      const burstId = `burst_${++this.burstCounter}`;
      this.pendingBurst = { id: burstId, windowStart: tsMs, requestIds: [requestId] };
      this.requestBurstMap.set(requestId, burstId);
    }
  }

  _matchesBackgroundPattern(normalizedUrl) {
    const BACKGROUND_PATHS = [
      '/ping', '/heartbeat', '/keepalive', '/health',
      '/poll', '/socket.io', '/push', '/sse',
      '/notifications/count', '/notifications/unread',
      '/badge', '/presence', '/subscribe', '/live',
    ];
    const lower = normalizedUrl.toLowerCase();
    return BACKGROUND_PATHS.some(p => lower.includes(p));
  }
}

const bgDetector = new BackgroundDetector();
module.exports = bgDetector;
```

### 3.3 Request classification: edge cases

| Scenario | What happens | Classification |
|----------|-------------|----------------|
| User clicks Search → 12 parallel calls fire within 40ms | All assigned to `burst_N`. No frequency pattern yet → `unknown` | `action` (by exclusion — not periodic) |
| Session keepalive fires every 2s, 6 times | Intervals: [2001, 1998, 2003, 2000, 1999] → CoV = 0.001 → PERIODIC | `periodic` |
| Notification badge fires every 5s | Same as above | `periodic` |
| Same URL called twice by user within session | Insufficient data (< 3) | `unknown` → included |
| Long polling (re-fires immediately on response) | Intervals highly variable (server holds conn for 0–10s randomly) → CoV > 0.3 → NOT periodic | `unknown` → included |
| First 2 occurrences of what becomes periodic | Not yet confirmed, counted in active | Active (normal). 3rd occurrence confirms; future calls excluded. |

**Important edge case — 3rd call reclassification:**  
When the 3rd call confirms a URL as periodic, only *future* calls are excluded from the active count. The first 2 are already in flight or done. This is acceptable — the reclassification window is small (< 6s for a 2s heartbeat).

### 3.4 Content script — gesture detection

`content/gesture-detector.js` runs on every page and sends click/submit timestamps to the service worker. This allows the future enhancement of "action correlation window" (classify requests that occur within 3s of a user gesture as `action`), which improves accuracy further.

```javascript
// Runs in page context — CANNOT import modules — must be self-contained
['click', 'submit', 'keydown'].forEach(eventType => {
  document.addEventListener(eventType, evt => {
    if (eventType === 'keydown' && evt.key !== 'Enter') return;
    chrome.runtime.sendMessage({
      type: 'USER_GESTURE',
      timestamp: Date.now(),
    }).catch(() => {});  // safe to ignore if SW not ready
  }, { capture: true, passive: true });
});
```

---

## Phase 4 — PerfX Studio Review UI ✅ COMPLETE

**Goal:** After the HAR is received by PerfX Studio, show the tester a classified request summary and let them override before script generation.

### 4.1 HAR delivery

Two options (implement both):

**A. Direct POST:**  
Extension sends `POST /api/upload-har` with the HAR as JSON body. Server stores in session memory (existing `memoryFsInterceptor` pattern). Studio tab auto-opens.

**B. Download + manual upload:**  
"Download .har file" button in panel. Tester uploads via existing Studio drag-drop. Existing pipeline unchanged — just reads the extra `_perfx_*` fields.

### 4.2 `src/parsers/harParser.js` (new file)

```javascript
function parseClassifiedHar(harJson) {
  const entries = harJson.log.entries || [];
  const pages = harJson.log.pages || [];

  const classified = {
    action: [],
    periodic: [],
    once: [],
    unknown: [],
  };

  for (const entry of entries) {
    const cls = entry._perfx_class || 'unknown';
    classified[cls].push(entry);
  }

  // Build periodic summary for review UI
  const periodicSummary = buildPeriodicSummary(classified.periodic);

  return { entries, pages, classified, periodicSummary };
}

function buildPeriodicSummary(periodicEntries) {
  // Group by normalizedUrl, aggregate stats
  const groups = new Map();
  for (const entry of periodicEntries) {
    const key = entry._normalizedUrl || entry.request.url;
    if (!groups.has(key)) {
      groups.set(key, {
        normalizedUrl: key,
        exampleUrl: entry.request.url,
        method: entry.request.method,
        occurrences: 0,
        intervalMs: entry._perfx_interval,
        userDecision: 'exclude',  // default
      });
    }
    groups.get(key).occurrences++;
  }
  return [...groups.values()];
}
```

### 4.3 Review panel HTML (added to `VuGen-Script-Studio.html`)

A collapsible section that appears after HAR upload when periodic entries are detected:

```html
<div id="bgReviewPanel" class="bg-review-panel" style="display:none">
  <div class="bg-review-header">
    <span class="bg-review-title">Background Requests Detected</span>
    <span class="bg-review-subtitle" id="bgReviewSubtitle"></span>
  </div>
  <table class="bg-review-table" id="bgReviewTable">
    <thead>
      <tr>
        <th>Endpoint</th>
        <th>Method</th>
        <th>Interval</th>
        <th>Count</th>
        <th>Decision</th>
      </tr>
    </thead>
    <tbody id="bgReviewBody"></tbody>
  </table>
  <div class="bg-review-footer">
    <span id="bgReviewStats"></span>
    <button onclick="applyBgDecisions()">Apply &amp; Generate Script</button>
  </div>
</div>
```

Each row has a three-way toggle: `[Exclude] [Include once] [Include all]`.

### 4.4 `studio-ui.js` — `renderBackgroundReview(periodicSummary)`

```javascript
function renderBackgroundReview(periodicSummary) {
  if (!periodicSummary.length) return;

  const tbody = document.getElementById('bgReviewBody');
  tbody.innerHTML = '';

  for (const item of periodicSummary) {
    const intervalLabel = item.intervalMs
      ? `${(item.intervalMs / 1000).toFixed(1)}s`
      : '—';
    const shortUrl = item.normalizedUrl.replace(/^https?:\/\/[^/]+/, '');
    const row = document.createElement('tr');
    row.innerHTML = `
      <td title="${escHtml(item.normalizedUrl)}">${escHtml(shortUrl)}</td>
      <td>${escHtml(item.method)}</td>
      <td>${intervalLabel}</td>
      <td>${item.occurrences}</td>
      <td>
        <div class="bg-decision-toggle" data-url="${escHtml(item.normalizedUrl)}">
          <button class="bg-dec active" data-val="exclude">Exclude</button>
          <button class="bg-dec" data-val="once">Once</button>
          <button class="bg-dec" data-val="all">Include all</button>
        </div>
      </td>
    `;
    tbody.appendChild(row);
  }

  document.getElementById('bgReviewPanel').style.display = '';
  document.getElementById('bgReviewSubtitle').textContent =
    `${periodicSummary.length} periodic endpoint${periodicSummary.length > 1 ? 's' : ''} detected`;
}
```

### 4.5 `studio-app.js` — integrate review before codegen

```javascript
// After HAR is loaded into S.entries1:
function onHarLoaded(harJson) {
  const parsed = harParser.parseClassifiedHar(harJson);
  S.entries1 = parsed.entries;
  S.bgDecisions = new Map(parsed.periodicSummary.map(p => [p.normalizedUrl, 'exclude']));

  if (parsed.periodicSummary.length > 0) {
    renderBackgroundReview(parsed.periodicSummary);
    // Don't auto-generate script yet — wait for user to confirm decisions
  } else {
    generateScript();  // No background entries, proceed normally
  }
}

function applyBgDecisions() {
  // Read toggle states from review panel, update S.bgDecisions
  document.querySelectorAll('.bg-decision-toggle').forEach(el => {
    const url = el.dataset.url;
    const active = el.querySelector('.bg-dec.active');
    S.bgDecisions.set(url, active.dataset.val);
  });
  document.getElementById('bgReviewPanel').style.display = 'none';
  generateScript();
}
```

---

## Phase 5 — Script Generation Updates

**Goal:** Filter periodic requests from generated scripts based on user decisions.

### 5.1 Entry filtering (shared helper)

Add to `studio-codegen.js`:

```javascript
/**
 * Returns true if this HAR entry should be included in the main transaction loop.
 * Respects user decisions from the background review panel.
 */
function shouldIncludeEntry(entry, bgDecisions) {
  const cls = entry._perfx_class;
  if (!cls || cls === 'action' || cls === 'unknown') return true;

  if (cls === 'once') {
    // 'once' entries are handled in the setup block, not per-iteration
    return false;
  }

  if (cls === 'periodic') {
    const decision = bgDecisions?.get(entry._normalizedUrl) ?? 'exclude';
    return decision === 'all';
  }

  return true;
}

/**
 * Returns entries to emit once in the setup block (before first transaction).
 */
function getSetupEntries(entries, bgDecisions) {
  return entries.filter(e => {
    if (e._perfx_class === 'once') return true;
    if (e._perfx_class === 'periodic') {
      return (bgDecisions?.get(e._normalizedUrl) ?? 'exclude') === 'once';
    }
    return false;
  });
}
```

### 5.2 `advancedScriptGenerator.js` — DevWeb

In `genMainJS()`, before building request calls for each entry:

```javascript
const mainEntries = S.entries1.filter(e =>
  !e.filtered && !e.isMarker && shouldIncludeEntry(e, S.bgDecisions)
);

const setupEntries = getSetupEntries(S.entries1, S.bgDecisions);
```

Emit setup block before `Transaction` blocks if `setupEntries.length > 0`:

```javascript
// At top of generated script, before load.run():
if (setupEntries.length > 0) {
  lines.push(`// ── Setup: background requests included once ──`);
  for (const entry of setupEntries) {
    lines.push(genRequestCall(entry));
  }
}
```

### 5.3 `webHttpScriptGenerator.js` — VuGen C

Same filtering logic, adapted for C output format. `getSetupEntries` entries go into `vuser_init()` block; `shouldIncludeEntry` false entries are skipped in `Action()`.

---

## File Change Matrix

| File | Status | Phase | Notes |
|------|--------|-------|-------|
| `perfx-recorder-extension/manifest.json` | NEW | 1 | |
| `perfx-recorder-extension/background/service-worker.js` | NEW | 1 | |
| `perfx-recorder-extension/background/cdp-capture.js` | NEW | 1 | |
| `perfx-recorder-extension/background/har-builder.js` | NEW | 1 | |
| `perfx-recorder-extension/background/url-normalizer.js` | NEW | 3 | |
| `perfx-recorder-extension/background/bg-detector.js` | NEW | 3 | |
| `perfx-recorder-extension/sidepanel/sidepanel.html` | NEW | 1–2 | All 7 states |
| `perfx-recorder-extension/sidepanel/sidepanel.js` | NEW | 1–2 | State machine |
| `perfx-recorder-extension/sidepanel/sidepanel.css` | NEW | 1–2 | |
| `perfx-recorder-extension/content/gesture-detector.js` | NEW | 2 | |
| `src/parsers/harParser.js` | NEW | 4 | Reads `_perfx_*` fields |
| `src/web/public/VuGen-Script-Studio.html` | MODIFIED | 4 | Add `bgReviewPanel` section |
| `src/web/public/studio-app.js` | MODIFIED | 4–5 | `onHarLoaded`, `applyBgDecisions`, `S.bgDecisions` |
| `src/web/public/studio-ui.js` | MODIFIED | 4 | `renderBackgroundReview()` |
| `src/web/public/studio-codegen.js` | MODIFIED | 5 | `shouldIncludeEntry()`, `getSetupEntries()` |
| `src/generators/advancedScriptGenerator.js` | MODIFIED | 5 | Filter in `genMainJS()` |
| `src/generators/webHttpScriptGenerator.js` | MODIFIED | 5 | Filter in action/init blocks |

---

## Test Plan

### Unit tests (Jest, in `tests/unit/`)

| Test file | What it covers |
|-----------|---------------|
| `bgDetector.test.js` | `_checkFrequency` with CoV edge cases; `_assignBurst`; `_matchesBackgroundPattern`; reclassification at 3rd call |
| `urlNormalizer.test.js` | UUID stripping; timestamp param removal; numeric ID replacement; URL with `{{variables}}` untouched |
| `harParser.test.js` | Parse `_perfx_class` fields; build periodic summary; missing fields default gracefully |
| `shouldIncludeEntry.test.js` | Each classification + decision combination; undefined `bgDecisions` (backward compat) |

### Integration tests

1. **Heartbeat scenario:** Record a test page that calls `/api/ping` every 2s. Verify: classified as `periodic`, excluded from active count after 3rd call, absent from generated script.
2. **Promise.all scenario:** Record a page that fires 8 parallel fetches on button click. Verify: all 8 in same burst, all classified `action`, all in generated script.
3. **Mixed scenario:** Heartbeat running + user action. Verify: heartbeat not in active count; user action count rises and falls cleanly; both appear correctly in HAR.
4. **Popup window:** Record a flow that opens a popup. Verify: popup requests appear in HAR with correct `pageref`.
5. **Backward compat:** Upload a HAR with no `_perfx_*` fields. Verify: `shouldIncludeEntry` returns `true` for everything (no filtering applied).

---

## Constraints and Risks

| Item | Detail | Mitigation |
|------|--------|-----------|
| Chrome 114+ for Side Panel | `chrome.sidePanel` API minimum version | Extension `minimum_chrome_version: "114"`. Edge supports it too. Document requirement. |
| "Chrome is being controlled" bar | `chrome.debugger` forces a yellow info bar during recording | Expected and documented. Bar disappears on Stop. No workaround. |
| Memory for large recordings | Long sessions may accumulate large HAR objects in service worker memory | HarBuilder caps response body capture at 1 MB per entry (configurable). Session > 15 min: warn user. |
| Periodic detection lag | URL confirmed periodic only after 3rd call (~4–6s for 2s interval) | First 2 occurrences are counted in active (conservative: they're in the script). Acceptable trade-off. |
| Long polling misclassification | High CoV keeps long-polling out of `periodic` | Tested; CoV check handles it correctly. Long polling belongs in script. |
| Bank HSTS / cert pinning | Some bank endpoints may use strict cert pinning | CDP captures at browser level (after TLS termination in browser) — no MITM proxy, no cert issues. |
| Extension policy blocked | IT policy blocks all extensions | Tester checks `chrome://policy`, submits IT request with extension ID. One-time per org. |
| Service worker lifecycle | MV3 service workers can be killed by Chrome after 30s idle | Recording state stored in `chrome.storage.session` (survives SW restart). CDP attachment survives SW restart if `chrome.debugger` was not manually detached. |

---

## Phasing Summary

| Phase | Scope | Estimated effort | Prerequisite |
|-------|-------|-----------------|-------------|
| 1 — Foundation | CDP capture, basic HAR export, panel idle/recording states | ~3–4 days | None |
| 2 — Transactions | Start/End tx, count display, settled signal, trail | ~2–3 days | Phase 1 |
| 3 — BG Detector | `bg-detector.js`, `url-normalizer.js`, smart count | ~3–4 days | Phase 2 |
| 4 — Studio Review | `harParser.js`, review panel UI, decision overrides | ~2–3 days | Phase 3 |
| 5 — Codegen | Filter periodic in DevWeb + VuGen generators | ~1–2 days | Phase 4 |

Total: ~11–16 days across 5 phases. Each phase is independently testable and independently deployable.

---

## Session-End Checklist (when coding begins)

- [ ] Impact analysis before each phase (see `ai-assisted-development-playbook.md`)
- [ ] `node --check` on all new `.js` extension files
- [ ] Jest tests written for `bg-detector.js` and `url-normalizer.js` before implementing Phase 3
- [ ] `Docs/BUGS.md` updated with any issues found during implementation
- [ ] `memory/state.md` updated after each phase completes
- [ ] Committed with descriptive message referencing phase number
