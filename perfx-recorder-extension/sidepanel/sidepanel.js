/**
 * sidepanel.js  —  PerfX Studio Recorder side panel UI controller (Phase 2)
 *
 * States:
 *   IDLE              — Start Recording button; no count; no timers
 *   RECORDING_LOADING — Recording started; requests active; Stop shown
 *   RECORDING_READY   — All settled; Start Transaction enabled; Stop shown
 *   NAMING            — User typing transaction name; Begin/Cancel shown
 *   TX_LOADING        — Inside transaction; requests active; End Tx shown
 *   TX_READY          — Inside transaction; all settled; End Tx shown
 *   STOPPED           — Recording ended; HAR ready card shown
 */

// ── State constants ────────────────────────────────────────────────────────────
const S = {
  IDLE:              'idle',
  RECORDING_LOADING: 'recording-loading',
  RECORDING_READY:   'recording-ready',
  NAMING:            'naming',
  TX_LOADING:        'tx-loading',
  TX_READY:          'tx-ready',
  STOPPED:           'stopped',
};

// ── DOM refs ───────────────────────────────────────────────────────────────────
const statusBadge     = document.getElementById('statusBadge');
const statusText      = document.getElementById('statusText');
const timerRow        = document.getElementById('timerRow');
const recTimerEl      = document.getElementById('recTimer');
const txTimerItem     = document.getElementById('txTimerItem');
const txTimerEl       = document.getElementById('txTimer');
const errorBanner     = document.getElementById('errorBanner');
const countCard       = document.getElementById('countCard');
const countValue      = document.getElementById('countValue');
const settledPill     = document.getElementById('settledPill');
const namingArea      = document.getElementById('namingArea');
const txNameInput     = document.getElementById('txNameInput');
const trailArea       = document.getElementById('trailArea');
const trailChips      = document.getElementById('trailChips');
const harReady        = document.getElementById('harReady');
const harSummary      = document.getElementById('harSummary');
const enterpriseNote  = document.getElementById('enterpriseNote');
const actionArea      = document.getElementById('actionArea');
const btnStart        = document.getElementById('btnStart');
const btnStop         = document.getElementById('btnStop');
const btnStartTx      = document.getElementById('btnStartTx');
const btnBeginTx      = document.getElementById('btnBeginTx');
const btnCancelNaming = document.getElementById('btnCancelNaming');
const btnEndTx        = document.getElementById('btnEndTx');
const btnDownloadHar  = document.getElementById('btnDownloadHar');
const btnOpenStudio   = document.getElementById('btnOpenStudio');
const btnNewRecording = document.getElementById('btnNewRecording');
const bgNote          = document.getElementById('bgNote');
const waitingHint     = document.getElementById('waitingHint');

// ── Runtime state ──────────────────────────────────────────────────────────────
let state           = S.IDLE;
let currentHar      = null;
let activeCount     = 0;
let backgroundCount = 0;
let isSettled       = false;
let recStartTime  = null;   // Date.now() when recording started
let txStartTime   = null;   // Date.now() when current transaction started
let recTimerTick  = null;   // setInterval handle
let txTimerTick   = null;
let completedTxs  = [];     // [{txId, name, startTime, endTime}]

// ── Port connection ────────────────────────────────────────────────────────────
// Use a mutable ref so reconnect can replace the port while all postMessage
// callers transparently use the latest connection.
let port = connectToSW();

function connectToSW() {
  const p = chrome.runtime.connect({ name: 'perfx-sidepanel' });
  p.onMessage.addListener(handleMessage);
  p.onDisconnect.addListener(() => {
    // Service worker went to sleep — reconnect and re-sync state
    setTimeout(() => {
      port = connectToSW();
      port.postMessage({ type: 'GET_STATE' });
    }, 500);
  });
  return p;
}

function handleMessage(msg) {
  switch (msg.type) {

    case 'STATE_UPDATE':
      // Restore state after SW restart or panel re-open
      if (msg.state.recording) {
        if (msg.state.inTransaction) {
          transition(isSettled ? S.TX_READY : S.TX_LOADING);
        } else {
          transition(isSettled ? S.RECORDING_READY : S.RECORDING_LOADING);
        }
        updateCount(msg.count || 0, msg.background || 0);
      } else {
        transition(S.IDLE);
      }
      break;

    case 'RECORDING_STARTED':
      recStartTime = Date.now();
      startRecTimer();
      transition(S.RECORDING_LOADING);
      break;

    case 'COUNT_UPDATE':
      activeCount     = msg.count;
      backgroundCount = msg.background || 0;
      updateCount(msg.count, msg.background || 0);
      // New request while settled → un-settle
      if (msg.count > 0 && isSettled) {
        isSettled = false;
        if (state === S.RECORDING_READY) transition(S.RECORDING_LOADING);
        if (state === S.TX_READY)        transition(S.TX_LOADING);
      }
      break;

    case 'SETTLED':
      isSettled = true;
      if (state === S.RECORDING_LOADING) transition(S.RECORDING_READY);
      if (state === S.TX_LOADING)        transition(S.TX_READY);
      break;

    case 'TRANSACTION_STARTED':
      txStartTime = Date.now();
      startTxTimer();
      transition(S.TX_LOADING);
      break;

    case 'TRANSACTION_ENDED': {
      stopTxTimer();
      txStartTime = null;
      const durationMs = msg.endTime - msg.startTime;
      completedTxs.push({ txId: msg.txId, name: msg.name, durationMs });
      renderTrail();
      transition(isSettled ? S.RECORDING_READY : S.RECORDING_LOADING);
      break;
    }

    case 'RECORDING_STOPPED':
      stopRecTimer();
      stopTxTimer();
      currentHar = msg.har;
      transition(S.STOPPED);
      renderHarReady(msg.har);
      break;

    case 'ERROR':
      showError(msg.message);
      break;
  }
}

// ── Button handlers ────────────────────────────────────────────────────────────

btnStart.addEventListener('click', () => {
  clearError();
  completedTxs = [];
  trailChips.innerHTML = '';
  port.postMessage({ type: 'START_RECORDING' });
});

btnStop.addEventListener('click', () => {
  port.postMessage({ type: 'STOP_RECORDING' });
});

btnStartTx.addEventListener('click', () => {
  transition(S.NAMING);
  txNameInput.value = '';
  txNameInput.focus();
});

btnBeginTx.addEventListener('click', () => {
  commitNaming();
});

btnCancelNaming.addEventListener('click', () => {
  transition(isSettled ? S.RECORDING_READY : S.RECORDING_LOADING);
});

btnEndTx.addEventListener('click', () => {
  port.postMessage({ type: 'END_TRANSACTION' });
});

txNameInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter')  { e.preventDefault(); commitNaming(); }
  if (e.key === 'Escape') { transition(isSettled ? S.RECORDING_READY : S.RECORDING_LOADING); }
});

btnDownloadHar.addEventListener('click', () => {
  if (!currentHar) return;
  const blob = new Blob([JSON.stringify(currentHar, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `perfx-recording-${fmtTimestamp()}.har`;
  a.click();
  URL.revokeObjectURL(url);
});

btnOpenStudio.addEventListener('click', () => {
  if (!currentHar) return;
  // Auto-download the HAR first, then open Studio so user can upload it
  const blob = new Blob([JSON.stringify(currentHar, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `perfx-recording-${fmtTimestamp()}.har`;
  a.click();
  URL.revokeObjectURL(url);
  // Open Studio after a brief delay so the download dialog appears first
  setTimeout(() => {
    chrome.tabs.create({ url: 'http://localhost:3000/converter/studio' });
  }, 400);
});

btnNewRecording.addEventListener('click', () => {
  currentHar   = null;
  isSettled    = false;
  activeCount  = 0;
  completedTxs = [];
  trailChips.innerHTML = '';
  transition(S.IDLE);
});

function commitNaming() {
  const name = txNameInput.value.trim() || `Transaction ${completedTxs.length + 1}`;
  port.postMessage({ type: 'START_TRANSACTION', name });
  // UI will update on TRANSACTION_STARTED message
}

// ── State machine renderer ─────────────────────────────────────────────────────

function transition(newState) {
  state = newState;
  render();
}

function render() {
  // Reset all conditional visibility
  hide(btnStart, btnStop, btnStartTx, btnBeginTx, btnCancelNaming, btnEndTx,
       namingArea, countCard, timerRow, txTimerItem, harReady, enterpriseNote, waitingHint);
  btnStartTx.title = '';

  settledPill.classList.add('hidden');
  countValue.className = 'count-value';

  switch (state) {

    case S.IDLE:
      setStatus('idle', 'Idle');
      show(btnStart, enterpriseNote);
      if (completedTxs.length) show(trailArea); else hide(trailArea);
      actionArea.style.display = '';
      break;

    case S.RECORDING_LOADING:
      setStatus('recording', 'Recording');
      show(countCard, timerRow, btnStop, btnStartTx, waitingHint);
      btnStartTx.disabled = true;
      btnStartTx.title = 'Waiting for requests to settle';
      countValue.classList.add('active');
      actionArea.style.display = '';
      updateTrailVisibility();
      break;

    case S.RECORDING_READY:
      setStatus('settled', 'Settled');
      show(countCard, timerRow, btnStop, btnStartTx);
      btnStartTx.disabled = false;
      countValue.classList.add('settled');
      settledPill.classList.remove('hidden');
      actionArea.style.display = '';
      updateTrailVisibility();
      break;

    case S.NAMING:
      setStatus('recording', 'Recording');
      show(countCard, timerRow, namingArea, btnBeginTx, btnCancelNaming);
      actionArea.style.display = '';
      updateTrailVisibility();
      break;

    case S.TX_LOADING:
      setStatus('transaction', 'Transaction');
      show(countCard, timerRow, txTimerItem, btnStop, btnEndTx);
      countValue.classList.add('tx', 'active');
      actionArea.style.display = '';
      updateTrailVisibility();
      break;

    case S.TX_READY:
      setStatus('transaction', 'Settled');
      show(countCard, timerRow, txTimerItem, btnStop, btnEndTx);
      countValue.classList.add('tx', 'settled');
      settledPill.classList.remove('hidden');
      actionArea.style.display = '';
      updateTrailVisibility();
      break;

    case S.STOPPED:
      setStatus('idle', 'Done');
      show(harReady);
      actionArea.style.display = 'none';
      updateTrailVisibility();
      break;
  }
}

function updateTrailVisibility() {
  if (completedTxs.length) show(trailArea); else hide(trailArea);
}

// ── Count display ──────────────────────────────────────────────────────────────

function updateCount(count, background = 0) {
  countValue.textContent = count;

  if (state === S.TX_LOADING || state === S.TX_READY) {
    countValue.classList.toggle('active',  count > 0);
    countValue.classList.toggle('settled', count === 0);
  } else {
    countValue.classList.toggle('active',  count > 0);
    countValue.classList.toggle('settled', count === 0 && isSettled);
  }

  // Show background note when periodic polls are in flight
  if (background > 0) {
    bgNote.textContent = `+ ${background} background (excluded)`;
    bgNote.classList.remove('hidden');
  } else {
    bgNote.classList.add('hidden');
  }
}

// ── Trail chips ────────────────────────────────────────────────────────────────

function renderTrail() {
  trailChips.innerHTML = '';
  for (const tx of completedTxs) {
    const chip = document.createElement('div');
    chip.className = 'trail-chip';
    const dur = tx.durationMs ? fmtDuration(tx.durationMs) : '?';
    chip.innerHTML =
      `<span class="trail-chip-name">${esc(tx.name)}</span>` +
      `<span class="trail-chip-time">${dur}</span>`;
    trailChips.appendChild(chip);
  }
}

// ── HAR ready ─────────────────────────────────────────────────────────────────

function renderHarReady(har) {
  const entries  = har?.log?.entries?.length ?? 0;
  const txCount  = har?.log?.pages?.length ?? 0;
  const parts    = [`${entries} request${entries !== 1 ? 's' : ''}`];
  if (txCount)   parts.push(`${txCount} transaction${txCount !== 1 ? 's' : ''}`);
  harSummary.textContent = parts.join(' · ');
  show(harReady);
}

// ── Timer management ───────────────────────────────────────────────────────────

function startRecTimer() {
  stopRecTimer();
  recStartTime = recStartTime || Date.now();
  recTimerTick = setInterval(() => {
    recTimerEl.textContent = fmtElapsed(Date.now() - recStartTime);
  }, 1000);
  recTimerEl.textContent = '00:00';
}

function stopRecTimer() {
  if (recTimerTick) { clearInterval(recTimerTick); recTimerTick = null; }
}

function startTxTimer() {
  stopTxTimer();
  txStartTime = txStartTime || Date.now();
  txTimerTick = setInterval(() => {
    txTimerEl.textContent = fmtElapsed(Date.now() - txStartTime);
  }, 1000);
  txTimerEl.textContent = '00:00';
}

function stopTxTimer() {
  if (txTimerTick) { clearInterval(txTimerTick); txTimerTick = null; }
}

// ── Status ─────────────────────────────────────────────────────────────────────

function setStatus(cls, label) {
  statusBadge.className = `status-badge ${cls}`;
  statusText.textContent = label;
}

function showError(msg) {
  errorBanner.textContent = msg;
  errorBanner.classList.remove('hidden');
}

function clearError() {
  errorBanner.textContent = '';
  errorBanner.classList.add('hidden');
}

// ── DOM helpers ────────────────────────────────────────────────────────────────

function show(...els) { for (const el of els) el.classList.remove('hidden'); }
function hide(...els) { for (const el of els) el.classList.add('hidden'); }

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtElapsed(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function fmtDuration(ms) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtTimestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
}

// ── Boot ───────────────────────────────────────────────────────────────────────
port.postMessage({ type: 'GET_STATE' });
