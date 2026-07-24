/**
 * gesture-detector.js  —  Content script
 *
 * Sends user gesture timestamps (click, submit, Enter key) to the service worker
 * so the background detector can correlate requests to user actions.
 *
 * IMPORTANT: Content scripts cannot use ES module import/export.
 * This file must be entirely self-contained.
 */
(function () {
  'use strict';

  function sendGesture() {
    chrome.runtime.sendMessage({
      type:      'USER_GESTURE',
      timestamp: Date.now(),
    }).catch(() => {
      // Ignore: SW may not be ready, or extension was reloaded
    });
  }

  document.addEventListener('click',   sendGesture, { capture: true, passive: true });
  document.addEventListener('submit',  sendGesture, { capture: true, passive: true });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') sendGesture();
  }, { capture: true, passive: true });
}());
