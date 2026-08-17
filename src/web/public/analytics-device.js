/* PerfX Studio — Device fingerprint collector (silent, no user interaction) */
(function () {
  "use strict";

  var STORAGE_KEY = "perfx_device_id";

  // Generate or retrieve a persistent device UUID stored in localStorage.
  // Uses the Web Crypto API available in all modern browsers.
  function getDeviceId() {
    try {
      var id = localStorage.getItem(STORAGE_KEY);
      if (!id) {
        // Generate a RFC-4122 v4 UUID
        if (typeof crypto !== "undefined" && crypto.randomUUID) {
          id = crypto.randomUUID();
        } else {
          // Fallback for older browsers
          id = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(
            /[xy]/g,
            function (c) {
              var r = (Math.random() * 16) | 0;
              var v = c === "x" ? r : (r & 0x3) | 0x8;
              return v.toString(16);
            },
          );
        }
        localStorage.setItem(STORAGE_KEY, id);
      }
      return id;
    } catch (_) {
      return null; // localStorage may be blocked in some corporate environments
    }
  }

  function getFingerprint() {
    return JSON.stringify({
      deviceId: getDeviceId(),
      screen:
        screen && screen.width && screen.height
          ? screen.width + "x" + screen.height
          : null,
      timezone:
        typeof Intl !== "undefined"
          ? Intl.DateTimeFormat().resolvedOptions().timeZone
          : null,
      lang: navigator.language || null,
      platform: navigator.platform || null,
    });
  }

  // Make fingerprint available globally so the fetch interceptor can read it
  window._perfxFp = getFingerprint();

  // Intercept fetch calls to /converter/convert* and inject the fingerprint header.
  // This is completely transparent — existing code does not need to change.
  var _origFetch = window.fetch;
  window.fetch = function (url, options) {
    var urlStr = typeof url === "string" ? url : (url && url.url) || "";
    if (
      urlStr.indexOf("/converter/convert") !== -1 ||
      urlStr.indexOf("/tools/") !== -1 ||
      urlStr.indexOf("/analytics/track") !== -1 ||
      urlStr.indexOf("/converter/analytics/track") !== -1
    ) {
      options = options || {};
      options.headers = options.headers || {};
      // Don't overwrite if already set
      if (!options.headers["X-Perfx-Fp"] && !options.headers["x-perfx-fp"]) {
        options.headers["X-Perfx-Fp"] = window._perfxFp || "{}";
      }
    }
    return _origFetch.apply(this, arguments);
  };
})();
