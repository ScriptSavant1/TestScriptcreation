/**
 * cdp-capture.ts
 *
 * Standalone rewrite of perfx-recorder-extension/background/cdp-capture.js
 * against `chrome-remote-interface` instead of the `chrome.debugger` MV3
 * API. This is the actual fix for Problem 2 in
 * ../../CDP-RECORDER-IMPLEMENTATION-PLAN.md §1: the extension attaches to
 * new tabs/popups *reactively* (`chrome.tabs.onCreated` → wait for
 * "loading" → `chrome.debugger.attach()`), which a fast SSO/redirect popup
 * can beat. Here, `Target.setAutoAttach({waitForDebuggerOnStart: true})`
 * pauses every new target — including the very first tab — before it can
 * run anything, and Network capture is turned on before it's ever resumed.
 * Verified end-to-end by the Phase 0 probe (§2.5), including on the real
 * corporate-managed machine.
 *
 * Business logic (active/background counting, settled detection, stale
 * watchdog, body-capture filtering) is unchanged from the extension — only
 * the attach/event-dispatch mechanism differs. Keyed by CDP `sessionId`
 * instead of `tabId`.
 *
 * Exports:
 *   startCapture(client)  — begin auto-attaching + capturing on this browser-level client
 *   stopCapture(client)   — stop auto-attaching, detach all sessions
 *   resetCapture()        — clear in-flight state + reset detector
 *   onCountChange(cb)     — callback: (activeCount, backgroundCount)
 *   onSettled(cb)         — callback: () — fired when active count = 0 for 500ms
 */
import type CDP from "chrome-remote-interface";
// Ported plain-JS modules (see their own file headers). Imported as `any`:
// their JSDoc types describe the extension's `tabId: number` parameter,
// which is now actually a CDP `sessionId: string` — same opaque-key
// behavior, different type annotation, not worth fighting call-site by
// call-site.
import { harBuilder as _harBuilder } from "./har-builder.js";
import { bgDetector as _bgDetector } from "./bg-detector.js";
import { normalize as _normalize } from "./url-normalizer.js";
const harBuilder = _harBuilder as any;
const bgDetector = _bgDetector as any;
const normalize = _normalize as (url: string) => string;

type Client = CDP.Client;

// ── Attached session registry ────────────────────────────────────────────
const ATTACHED_SESSIONS = new Set<string>();

// ── Active request tracking ──────────────────────────────────────────────
// Key: `${sessionId}:${requestId}`
interface ActiveRequest {
  sessionId: string;
  requestId: string;
  type: string;
  isPeriodic: boolean;
}
const ACTIVE_REQUESTS = new Map<string, ActiveRequest>();

let activeCount = 0; // non-periodic in-flight requests
let backgroundCount = 0; // periodic in-flight requests

// ── Settled signal ────────────────────────────────────────────────────────
const SETTLED_DELAY_MS = 500;
let settledTimer: ReturnType<typeof setTimeout> | null = null;

// ── Callbacks ─────────────────────────────────────────────────────────────
type CountChangeCb = (activeCount: number, backgroundCount: number) => void;
type SettledCb = () => void;
const countChangeCallbacks: CountChangeCb[] = [];
const settledCallbacks: SettledCb[] = [];

export function onCountChange(cb: CountChangeCb): void {
  countChangeCallbacks.push(cb);
}
export function onSettled(cb: SettledCb): void {
  settledCallbacks.push(cb);
}
function fireCountChange(): void {
  for (const cb of countChangeCallbacks) cb(activeCount, backgroundCount);
}
function fireSettled(): void {
  for (const cb of settledCallbacks) cb();
}

// ── URL filter ────────────────────────────────────────────────────────────
const SKIP_PREFIXES = ["chrome:", "chrome-extension:", "devtools:", "data:", "about:", "blob:"];
function shouldCapture(url: string): boolean {
  if (!url) return false;
  return !SKIP_PREFIXES.some((p) => url.startsWith(p));
}

const CAPTURE_BODY_TYPES = new Set(["XHR", "Fetch", "Document"]);
const PERSISTENT_TYPES = new Set(["WebSocket", "EventSource"]);
const STREAMING_CONTENT_TYPES = ["text/event-stream", "application/x-ndjson"];

const STALE_TIMEOUT_MS = 8000;
const staleTimers = new Map<string, ReturnType<typeof setTimeout>>();

export function getActiveCount(): number {
  return activeCount;
}
export function getBackgroundCount(): number {
  return backgroundCount;
}

export function resetCapture(): void {
  for (const t of staleTimers.values()) clearTimeout(t);
  staleTimers.clear();
  ACTIVE_REQUESTS.clear();
  activeCount = 0;
  backgroundCount = 0;
  clearSettledTimer();
  bgDetector.reset();
}

function evictRequest(key: string): void {
  const req = ACTIVE_REQUESTS.get(key);
  if (!req) return;
  ACTIVE_REQUESTS.delete(key);
  cancelStaleTimer(key);
  if (req.isPeriodic) backgroundCount = Math.max(0, backgroundCount - 1);
  else activeCount = Math.max(0, activeCount - 1);
  fireCountChange();
  if (activeCount === 0) startSettledTimer();
}

function scheduleStaleTimer(key: string): void {
  cancelStaleTimer(key);
  staleTimers.set(
    key,
    setTimeout(() => {
      staleTimers.delete(key);
      evictRequest(key);
    }, STALE_TIMEOUT_MS),
  );
}
function cancelStaleTimer(key: string): void {
  const t = staleTimers.get(key);
  if (t !== undefined) {
    clearTimeout(t);
    staleTimers.delete(key);
  }
}

// ── Target lifecycle: the actual Problem-2 fix ───────────────────────────

let wiredClient: Client | null = null;

/**
 * Begin auto-attaching to every current and future page target on this
 * browser connection, with each one paused (`waitForDebuggerOnStart`) until
 * we've turned Network capture on for it. Call once per recording session.
 */
export async function startCapture(client: Client): Promise<void> {
  if (wiredClient !== client) {
    wireEventListeners(client);
    wiredClient = client;
  }
  const { Target } = client;
  await Target.setDiscoverTargets({ discover: true });
  await Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true });
}

export async function stopCapture(client: Client): Promise<void> {
  const { Target } = client;
  try {
    await Target.setAutoAttach({ autoAttach: false, waitForDebuggerOnStart: false, flatten: true });
  } catch {
    /* connection may already be closing */
  }
  for (const sessionId of [...ATTACHED_SESSIONS]) {
    try {
      await Target.detachFromTarget({ sessionId });
    } catch {
      /* target may already be gone */
    }
    ATTACHED_SESSIONS.delete(sessionId);
  }
}

function wireEventListeners(client: Client): void {
  client.on("Target.attachedToTarget", (params: unknown) => {
    void handleAttached(client, params as {
      sessionId: string;
      targetInfo: { type: string; targetId: string };
      waitingForDebugger: boolean;
    });
  });

  client.on("Target.detachedFromTarget", (params: unknown) => {
    const { sessionId } = params as { sessionId: string };
    handleDetached(sessionId);
  });

  client.on("Network.requestWillBeSent", (params: unknown, sessionId?: string) => {
    if (sessionId) handleRequestStarted(sessionId, params as CdpRequestWillBeSent);
  });
  client.on("Network.responseReceived", (params: unknown, sessionId?: string) => {
    if (!sessionId) return;
    harBuilder.onResponseReceived(sessionId, params);
    handleResponseReceived(sessionId, params as CdpResponseReceived);
  });
  client.on("Network.loadingFinished", (params: unknown, sessionId?: string) => {
    if (sessionId) handleRequestFinished(client, sessionId, params as CdpLoadingFinished, false);
  });
  client.on("Network.loadingFailed", (params: unknown, sessionId?: string) => {
    if (sessionId) handleRequestFinished(client, sessionId, params as CdpLoadingFinished, true);
  });
}

async function resumeIfWaiting(client: Client, sessionId: string, targetId: string): Promise<void> {
  try {
    await client.send("Runtime.runIfWaitingForDebugger", undefined, sessionId);
  } catch (err) {
    // If this fails, the target stays paused (blank/frozen) forever — no
    // silent catch here, this needs to be visible.
    console.warn(`[cdp-recorder] FAILED to resume target ${targetId} — it may stay blank: ${(err as Error).message}`);
  }
}

async function handleAttached(
  client: Client,
  params: { sessionId: string; targetInfo: { type: string; targetId: string }; waitingForDebugger: boolean },
): Promise<void> {
  const { sessionId, targetInfo, waitingForDebugger } = params;

  if (targetInfo.type !== "page") {
    // Not a page (e.g. a service worker or extension target) — resume it if
    // paused so it doesn't hang, but don't capture Network on it.
    if (waitingForDebugger) await resumeIfWaiting(client, sessionId, targetInfo.targetId);
    return;
  }

  console.log(`\n[cdp-recorder] new page target attached: ${targetInfo.targetId}`);
  ATTACHED_SESSIONS.add(sessionId);
  try {
    // Turn Network capture on BEFORE resuming — this ordering is the whole
    // fix. Anything the page does after resume is already being observed.
    await client.send(
      "Network.enable",
      { maxResourceBufferSize: 10 * 1024 * 1024, maxTotalBufferSize: 50 * 1024 * 1024 },
      sessionId,
    );
  } catch (err) {
    // A real bug found on the corporate machine: this used to be a single
    // try/catch around BOTH Network.enable and the resume below. When
    // Network.enable threw, the catch swallowed it and the resume call was
    // never reached — the target stayed paused (waitForDebuggerOnStart)
    // forever, which looks exactly like "the new tab opened but the page
    // never loads at all." Losing Network capture on one target is
    // recoverable; leaving a page permanently frozen is not — so the resume
    // below must run unconditionally, in `finally`, regardless of whether
    // Network.enable succeeded.
    console.warn(`[cdp-recorder] Network.enable failed for target ${targetInfo.targetId} (capturing without it): ${(err as Error).message}`);
  } finally {
    if (waitingForDebugger) await resumeIfWaiting(client, sessionId, targetInfo.targetId);
  }
}

function handleDetached(sessionId: string): void {
  if (!ATTACHED_SESSIONS.has(sessionId)) return;
  ATTACHED_SESSIONS.delete(sessionId);

  for (const [key, info] of ACTIVE_REQUESTS) {
    if (key.startsWith(`${sessionId}:`)) {
      ACTIVE_REQUESTS.delete(key);
      if (info.isPeriodic) backgroundCount = Math.max(0, backgroundCount - 1);
      else activeCount = Math.max(0, activeCount - 1);
    }
  }
  fireCountChange();
  if (activeCount === 0) startSettledTimer();
}

// ── Request lifecycle (unchanged logic from the extension, sessionId-keyed) ─

interface CdpRequestWillBeSent {
  requestId: string;
  request: { url: string; headers: Record<string, string> };
  timestamp: number;
  wallTime?: number;
  type?: string;
  redirectResponse?: unknown;
}
interface CdpResponseReceived {
  requestId: string;
  response?: { headers?: Record<string, string> };
}
interface CdpLoadingFinished {
  requestId: string;
  timestamp: number;
  encodedDataLength?: number;
}

function handleRequestStarted(sessionId: string, params: CdpRequestWillBeSent): void {
  const { requestId, request, timestamp } = params;
  if (!shouldCapture(request.url)) return;

  const key = `${sessionId}:${requestId}`;
  const normalizedUrl = normalize(request.url);

  bgDetector.onRequest(requestId, normalizedUrl, timestamp);
  const isPeriodic = bgDetector.isRequestPeriodic(requestId);
  const burstId = bgDetector.getBurstId(requestId);

  if (ACTIVE_REQUESTS.has(key) && params.redirectResponse) {
    harBuilder.onRedirect(sessionId, params);
  } else {
    const isPersistent = PERSISTENT_TYPES.has(params.type ?? "");
    if (!isPersistent) {
      ACTIVE_REQUESTS.set(key, { sessionId, requestId, type: params.type ?? "Other", isPeriodic });
      scheduleStaleTimer(key);
      if (isPeriodic) backgroundCount++;
      else {
        activeCount++;
        clearSettledTimer();
      }
      fireCountChange();
    }
  }

  harBuilder.onRequestStarted(sessionId, params, { normalizedUrl, burstId });
}

function handleResponseReceived(sessionId: string, params: CdpResponseReceived): void {
  const ct = (
    params.response?.headers?.["content-type"] ||
    params.response?.headers?.["Content-Type"] ||
    ""
  ).toLowerCase();
  if (STREAMING_CONTENT_TYPES.some((s) => ct.includes(s))) {
    evictRequest(`${sessionId}:${params.requestId}`);
  }
}

function handleRequestFinished(client: Client, sessionId: string, params: CdpLoadingFinished, failed: boolean): void {
  const key = `${sessionId}:${params.requestId}`;
  const req = ACTIVE_REQUESTS.get(key);
  if (!req) return;

  cancelStaleTimer(key);
  ACTIVE_REQUESTS.delete(key);
  if (req.isPeriodic) backgroundCount = Math.max(0, backgroundCount - 1);
  else activeCount = Math.max(0, activeCount - 1);
  fireCountChange();

  if (failed) {
    harBuilder.onLoadingFailed(sessionId, params);
  } else {
    fetchBodyAndFinish(client, sessionId, params, req.type, params.requestId);
  }
  if (activeCount === 0) startSettledTimer();
}

function fetchBodyAndFinish(
  client: Client,
  sessionId: string,
  params: CdpLoadingFinished,
  resourceType: string,
  requestId: string,
): void {
  const promise = doFetchBody(client, sessionId, params, resourceType, requestId);
  harBuilder.pendingBodyFetches.add(promise);
  promise.finally(() => harBuilder.pendingBodyFetches.delete(promise));
}

async function doFetchBody(
  client: Client,
  sessionId: string,
  params: CdpLoadingFinished,
  resourceType: string,
  requestId: string,
): Promise<void> {
  let bodyResult: { body?: string; base64Encoded?: boolean } | null = null;
  if (CAPTURE_BODY_TYPES.has(resourceType) && ATTACHED_SESSIONS.has(sessionId)) {
    try {
      bodyResult = await client.send("Network.getResponseBody", { requestId }, sessionId);
      if (bodyResult?.body) {
        bgDetector.onResponseBody(requestId, bodyResult.body);
      }
    } catch {
      /* body unavailable — binary, too large, or target already gone */
    }
  }
  harBuilder.onLoadingFinished(sessionId, params, bodyResult);
}

// ── Settled timer ─────────────────────────────────────────────────────────

function startSettledTimer(): void {
  clearSettledTimer();
  settledTimer = setTimeout(() => {
    settledTimer = null;
    if (activeCount === 0) fireSettled();
  }, SETTLED_DELAY_MS);
}
function clearSettledTimer(): void {
  if (settledTimer !== null) {
    clearTimeout(settledTimer);
    settledTimer = null;
  }
}
