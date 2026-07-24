/**
 * service-worker.js  —  PerfX Studio Recorder background service worker (MV3)
 *
 * Responsibilities:
 *   1. Respond to toolbar icon click → open side panel
 *   2. Manage recording session lifecycle (start / stop)
 *   3. Attach/detach CDP debugger to the relevant tabs
 *   4. Keep service worker alive while recording via long-lived port from side panel
 *   5. Broadcast COUNT_UPDATE and SETTLED messages to all connected panel ports
 *   6. Persist recording state in chrome.storage.session (survives SW restart)
 */

import {
  attachDebugger,
  detachDebugger,
  isAttached,
  getActiveCount,
  getBackgroundCount,
  resetCapture,
  onCountChange,
  onSettled,
} from './cdp-capture.js';

import { harBuilder }  from './har-builder.js';
import { bgDetector }  from './bg-detector.js';

// ── Port registry — all open side panel connections ─────────────────────────
const panelPorts = new Set();

// ── Session state helpers ────────────────────────────────────────────────────
const SESSION_KEY = 'perfxRecorderSession';

async function getSession() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return result[SESSION_KEY] || { recording: false, attachedTabs: [] };
}

async function setSession(patch) {
  const current = await getSession();
  await chrome.storage.session.set({ [SESSION_KEY]: { ...current, ...patch } });
}

// ── Broadcast helpers ────────────────────────────────────────────────────────

function broadcast(msg) {
  for (const port of panelPorts) {
    try { port.postMessage(msg); } catch (_) { panelPorts.delete(port); }
  }
}

// ── CDP callbacks (wired once at module load) ────────────────────────────────

onCountChange((count, background) => {
  broadcast({ type: 'COUNT_UPDATE', count, background });
});

onSettled(() => {
  broadcast({ type: 'SETTLED' });
});

// ── One-way messages from content scripts ────────────────────────────────────

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'USER_GESTURE') {
    bgDetector.onUserGesture(msg.timestamp);
  }
  // Return false — no async response needed
  return false;
});

// ── Toolbar icon click — open side panel ────────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.open({ windowId: tab.windowId });
});

// ── Side panel port connection ───────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'perfx-sidepanel') return;

  panelPorts.add(port);

  port.onDisconnect.addListener(() => {
    panelPorts.delete(port);
  });

  port.onMessage.addListener((msg) => handlePanelMessage(msg, port));

  // Immediately send current state so panel can restore its UI
  getSession().then((session) => {
    port.postMessage({
      type:  'STATE_UPDATE',
      state: session,
      count: getActiveCount(),
    });
  });
});

// ── Message handler ──────────────────────────────────────────────────────────

async function handlePanelMessage(msg, port) {
  switch (msg.type) {

    case 'START_RECORDING': {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab) {
        port.postMessage({ type: 'ERROR', message: 'No active tab found.' });
        return;
      }

      harBuilder.reset();
      resetCapture();

      // Attach to the active tab
      await safeAttach(tab.id);

      // Also listen for new tabs opening during the session (e.g., bank popups)
      await setSession({ recording: true, attachedTabs: [tab.id], inTransaction: false });

      broadcast({ type: 'RECORDING_STARTED' });
      broadcast({ type: 'COUNT_UPDATE', count: 0, background: 0 });
      // startSettledTimer() in cdp-capture only fires when a request finishes.
      // If the page is already fully loaded (no in-flight requests), no requests
      // will finish and SETTLED would never broadcast, leaving "Start Transaction"
      // disabled forever. Check after 600 ms (> the 500 ms settle delay) and fire
      // SETTLED directly if the count is still zero.
      setTimeout(() => {
        if (getActiveCount() === 0) broadcast({ type: 'SETTLED' });
      }, 600);
      break;
    }

    case 'STOP_RECORDING': {
      const session = await getSession();

      // Wait up to 2 s for any body fetches that were in-flight at Stop time.
      // This ensures response bodies aren't lost when Stop is pressed mid-request.
      const _pending = [...harBuilder.pendingBodyFetches];
      if (_pending.length > 0) {
        await Promise.race([
          Promise.all(_pending),
          new Promise(r => setTimeout(r, 2000)),
        ]);
      }

      // Flush any entries still pending after the wait (truly incomplete requests)
      harBuilder.flush();

      // Detach all tabs
      for (const tabId of session.attachedTabs) {
        await detachDebugger(tabId);
      }

      await setSession({ recording: false, attachedTabs: [] });
      resetCapture();

      // Auto-close any open transaction
      harBuilder.endTransaction();

      // Stamp final classification on all entries from the detector
      harBuilder.enrichFromDetector(bgDetector);

      const har = harBuilder.build();
      broadcast({ type: 'RECORDING_STOPPED', har });
      break;
    }

    case 'START_TRANSACTION': {
      const txId = harBuilder.startTransaction(msg.name || 'Transaction');
      await setSession({ inTransaction: true });
      broadcast({ type: 'TRANSACTION_STARTED', txId, name: msg.name || 'Transaction' });
      break;
    }

    case 'END_TRANSACTION': {
      const txs = harBuilder.getTransactions();
      const last = txs[txs.length - 1];
      harBuilder.endTransaction();
      await setSession({ inTransaction: false });
      broadcast({
        type:     'TRANSACTION_ENDED',
        txId:     last?.id,
        name:     last?.name,
        startTime: last?.startTime,
        endTime:  Date.now(),
      });
      break;
    }

    case 'GET_STATE': {
      const session = await getSession();
      port.postMessage({
        type:       'STATE_UPDATE',
        state:      session,
        count:      getActiveCount(),
        background: getBackgroundCount(),
      });
      break;
    }

    default:
      break;
  }
}

// ── Auto-attach to new tabs opened during recording ─────────────────────────

chrome.tabs.onCreated.addListener(async (tab) => {
  const session = await getSession();
  if (!session.recording) return;

  // Attach once the tab has a real URL (it starts as about:blank)
  chrome.tabs.onUpdated.addListener(async function attachOnLoad(tabId, info) {
    if (tabId !== tab.id) return;
    if (info.status !== 'loading') return;

    chrome.tabs.onUpdated.removeListener(attachOnLoad);

    const updatedTab = await chrome.tabs.get(tabId).catch(() => null);
    if (!updatedTab) return;

    const url = updatedTab.url || '';
    if (!url || url.startsWith('chrome') || url.startsWith('about:')) return;

    await safeAttach(tabId);

    const current = await getSession();
    if (current.recording && !current.attachedTabs.includes(tabId)) {
      await setSession({ attachedTabs: [...current.attachedTabs, tabId] });
    }
  });
});

// ── Tab closed during recording — clean up ───────────────────────────────────

chrome.tabs.onRemoved.addListener(async (tabId) => {
  const session = await getSession();
  if (!session.recording) return;
  if (!isAttached(tabId)) return;
  await detachDebugger(tabId);
  const remaining = session.attachedTabs.filter(id => id !== tabId);
  await setSession({ attachedTabs: remaining });
});

// ── Helper — attach with error guard ─────────────────────────────────────────

async function safeAttach(tabId) {
  try {
    await attachDebugger(tabId);
  } catch (err) {
    // Tab may not be attachable (e.g., chrome:// page, already debugged by DevTools)
    console.warn(`[PerfX] Could not attach to tab ${tabId}:`, err.message);
  }
}
