/**
 * cdp-capture.js
 *
 * Attaches Chrome DevTools Protocol debugger to browser tabs, listens for
 * Network events, tracks active request count, and feeds raw event data to
 * har-builder.js. Phase 3: integrates bg-detector.js to separate periodic
 * background polls from real user-action requests.
 *
 * Exports:
 *   attachDebugger(tabId)     — attach CDP to a tab
 *   detachDebugger(tabId)     — detach CDP from a tab
 *   isAttached(tabId)         — check if tab is currently attached
 *   getActiveCount()          — non-periodic in-flight count
 *   getBackgroundCount()      — periodic in-flight count
 *   resetCapture()            — clear in-flight state + reset detector
 *   onCountChange(cb)         — callback: (activeCount, backgroundCount)
 *   onSettled(cb)             — callback: () — fired when active count = 0 for 500ms
 */

import { harBuilder } from './har-builder.js';
import { bgDetector }  from './bg-detector.js';
import { normalize }   from './url-normalizer.js';

// ── Attached tab registry ────────────────────────────────────────────────────
const ATTACHED_TABS = new Set();

// ── Active request tracking ──────────────────────────────────────────────────
// Key: `${tabId}:${requestId}`
// Value: { tabId, requestId, type, isPeriodic }
const ACTIVE_REQUESTS = new Map();

let activeCount     = 0;   // non-periodic in-flight requests
let backgroundCount = 0;   // periodic in-flight requests

// ── Settled signal ───────────────────────────────────────────────────────────
const SETTLED_DELAY_MS = 500;
let settledTimer = null;

// ── Callbacks ────────────────────────────────────────────────────────────────
const countChangeCallbacks = [];
const settledCallbacks     = [];

export function onCountChange(cb) { countChangeCallbacks.push(cb); }
export function onSettled(cb)     { settledCallbacks.push(cb); }

function fireCountChange() {
  for (const cb of countChangeCallbacks) cb(activeCount, backgroundCount);
}
function fireSettled() {
  for (const cb of settledCallbacks) cb();
}

// ── URL filter ───────────────────────────────────────────────────────────────
const SKIP_PREFIXES = ['chrome:', 'chrome-extension:', 'devtools:', 'data:', 'about:', 'blob:'];
function shouldCapture(url) {
  if (!url) return false;
  return !SKIP_PREFIXES.some(p => url.startsWith(p));
}

// ── Body capture types ───────────────────────────────────────────────────────
const CAPTURE_BODY_TYPES = new Set(['XHR', 'Fetch', 'Document']);

// ── Persistent connection types (known at request time) ──────────────────────
// WebSocket and EventSource (SSE via EventSource API) never fire loadingFinished.
const PERSISTENT_TYPES = new Set(['WebSocket', 'EventSource']);

// ── Streaming content-types (detected at response time) ──────────────────────
// SSE via fetch() has type='Fetch' but responds with text/event-stream and
// keeps the connection open indefinitely. Detect and evict from tracking.
const STREAMING_CONTENT_TYPES = ['text/event-stream', 'application/x-ndjson'];

// ── Stale-request watchdog ───────────────────────────────────────────────────
// Safety net: if a request stays in ACTIVE_REQUESTS for more than this long,
// it's treated as a persistent/stuck connection and evicted.
const STALE_TIMEOUT_MS = 8000;
const staleTimers = new Map(); // key → timeout id

// ── Public API ───────────────────────────────────────────────────────────────

export async function attachDebugger(tabId) {
  if (ATTACHED_TABS.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, '1.3');
  await chrome.debugger.sendCommand({ tabId }, 'Network.enable', {
    maxResourceBufferSize: 10 * 1024 * 1024,
    maxTotalBufferSize:    50 * 1024 * 1024,
  });
  ATTACHED_TABS.add(tabId);
}

export async function detachDebugger(tabId) {
  if (!ATTACHED_TABS.has(tabId)) return;
  ATTACHED_TABS.delete(tabId);
  try {
    await chrome.debugger.detach({ tabId });
  } catch (_) {
    // Tab already closed or detached — ignore
  }
}

export function isAttached(tabId)      { return ATTACHED_TABS.has(tabId); }
export function getActiveCount()       { return activeCount; }
export function getBackgroundCount()   { return backgroundCount; }

export function resetCapture() {
  for (const t of staleTimers.values()) clearTimeout(t);
  staleTimers.clear();
  ACTIVE_REQUESTS.clear();
  activeCount     = 0;
  backgroundCount = 0;
  clearSettledTimer();
  bgDetector.reset();
}

// Evict one request from active tracking (used by stale watchdog + content-type filter)
function evictRequest(key) {
  if (!ACTIVE_REQUESTS.has(key)) return;
  const { isPeriodic } = ACTIVE_REQUESTS.get(key);
  ACTIVE_REQUESTS.delete(key);
  cancelStaleTimer(key);
  if (isPeriodic) {
    backgroundCount = Math.max(0, backgroundCount - 1);
  } else {
    activeCount = Math.max(0, activeCount - 1);
  }
  fireCountChange();
  if (activeCount === 0) startSettledTimer();
}

function scheduleStaleTimer(key) {
  cancelStaleTimer(key);
  staleTimers.set(key, setTimeout(() => {
    staleTimers.delete(key);
    evictRequest(key);
  }, STALE_TIMEOUT_MS));
}

function cancelStaleTimer(key) {
  const t = staleTimers.get(key);
  if (t !== undefined) { clearTimeout(t); staleTimers.delete(key); }
}

// ── CDP event dispatcher ─────────────────────────────────────────────────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  const tabId = source.tabId;
  if (!ATTACHED_TABS.has(tabId)) return;

  switch (method) {
    case 'Network.requestWillBeSent':
      handleRequestStarted(tabId, params);
      break;
    case 'Network.responseReceived':
      harBuilder.onResponseReceived(tabId, params);
      handleResponseReceived(tabId, params);
      break;
    case 'Network.loadingFinished':
      handleRequestFinished(tabId, params, false);
      break;
    case 'Network.loadingFailed':
      handleRequestFinished(tabId, params, true);
      break;
  }
});

// External detach (user opens DevTools on the tab)
chrome.debugger.onDetach.addListener((source) => {
  const tabId = source.tabId;
  if (!ATTACHED_TABS.has(tabId)) return;
  ATTACHED_TABS.delete(tabId);

  for (const [key, info] of ACTIVE_REQUESTS) {
    if (key.startsWith(`${tabId}:`)) {
      ACTIVE_REQUESTS.delete(key);
      if (info.isPeriodic) {
        backgroundCount = Math.max(0, backgroundCount - 1);
      } else {
        activeCount = Math.max(0, activeCount - 1);
      }
    }
  }
  fireCountChange();
  if (activeCount === 0) startSettledTimer();
});

// ── Request lifecycle ────────────────────────────────────────────────────────

function handleRequestStarted(tabId, params) {
  const { requestId, request, timestamp } = params;
  if (!shouldCapture(request.url)) return;

  const key           = `${tabId}:${requestId}`;
  const normalizedUrl = normalize(request.url);

  // Register with bg-detector first so classification is up-to-date
  bgDetector.onRequest(requestId, normalizedUrl, timestamp);
  const isPeriodic = bgDetector.isRequestPeriodic(requestId);
  const burstId    = bgDetector.getBurstId(requestId);

  if (ACTIVE_REQUESTS.has(key) && params.redirectResponse) {
    // Redirect: same requestId fires again — finish old entry, keep slot
    harBuilder.onRedirect(tabId, params);
  } else {
    // Persistent connections (WebSocket, SSE) never fire loadingFinished.
    // Record in HAR for completeness but don't count them toward settled tracking.
    const isPersistent = PERSISTENT_TYPES.has(params.type);

    if (!isPersistent) {
      ACTIVE_REQUESTS.set(key, { tabId, requestId, type: params.type, isPeriodic });
      scheduleStaleTimer(key);

      if (isPeriodic) {
        backgroundCount++;
      } else {
        activeCount++;
        clearSettledTimer();
      }
      fireCountChange();
    }
  }

  harBuilder.onRequestStarted(tabId, params, { normalizedUrl, burstId });
}

function handleResponseReceived(tabId, params) {
  const ct = (params.response?.headers?.['content-type'] ||
              params.response?.headers?.['Content-Type'] || '').toLowerCase();
  if (STREAMING_CONTENT_TYPES.some(s => ct.includes(s))) {
    evictRequest(`${tabId}:${params.requestId}`);
  }
}

function handleRequestFinished(tabId, params, failed) {
  const key = `${tabId}:${params.requestId}`;
  if (!ACTIVE_REQUESTS.has(key)) return;

  cancelStaleTimer(key);
  const { type, isPeriodic } = ACTIVE_REQUESTS.get(key);
  ACTIVE_REQUESTS.delete(key);

  if (isPeriodic) {
    backgroundCount = Math.max(0, backgroundCount - 1);
  } else {
    activeCount = Math.max(0, activeCount - 1);
  }
  fireCountChange();

  if (failed) {
    harBuilder.onLoadingFailed(tabId, params);
  } else {
    fetchBodyAndFinish(tabId, params, type, params.requestId);
  }

  if (activeCount === 0) startSettledTimer();
}

function fetchBodyAndFinish(tabId, params, resourceType, requestId) {
  const promise = _doFetchBody(tabId, params, resourceType, requestId);
  harBuilder.pendingBodyFetches.add(promise);
  promise.finally(() => harBuilder.pendingBodyFetches.delete(promise));
}

async function _doFetchBody(tabId, params, resourceType, requestId) {
  let bodyResult = null;
  if (CAPTURE_BODY_TYPES.has(resourceType) && ATTACHED_TABS.has(tabId)) {
    try {
      bodyResult = await chrome.debugger.sendCommand(
        { tabId },
        'Network.getResponseBody',
        { requestId }
      );
      // Feed body text to detector for response stability analysis
      if (bodyResult?.body) {
        bgDetector.onResponseBody(requestId, bodyResult.body);
      }
    } catch (_) {
      // Body unavailable — binary, too large, tab closed
    }
  }
  harBuilder.onLoadingFinished(tabId, params, bodyResult);
}

// ── Settled timer ────────────────────────────────────────────────────────────

function startSettledTimer() {
  clearSettledTimer();
  settledTimer = setTimeout(() => {
    settledTimer = null;
    if (activeCount === 0) fireSettled();
  }, SETTLED_DELAY_MS);
}

function clearSettledTimer() {
  if (settledTimer !== null) {
    clearTimeout(settledTimer);
    settledTimer = null;
  }
}
