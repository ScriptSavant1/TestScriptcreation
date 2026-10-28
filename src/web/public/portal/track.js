/**
 * PerfX Studio — usage ping for the tools that work in the browser (Recorder, Results Analyser).
 * PerfxTrack.send({ tool, protocol, filename, sizeKb, mode, requestCount, result, errorCode, duration })
 * posts to …/analytics/track (the server records it with the machine, and the user name when the web server
 * identifies users). Only these figures are sent — never the recording or the results themselves.
 * Best effort: a failure is ignored, and it never blocks the page.
 */
(function () {
  "use strict";
  function deviceId() {   // the same id analytics-device.js keeps for Script Studio
    try {
      var id = localStorage.getItem("perfx_device_id");
      if (!id && window.crypto && crypto.randomUUID) { id = crypto.randomUUID(); localStorage.setItem("perfx_device_id", id); }
      return id || null;
    } catch (e) { return null; }
  }
  function fingerprint() {
    return JSON.stringify({
      deviceId: deviceId(),
      screen: window.screen && screen.width ? screen.width + "x" + screen.height : null,
      timezone: window.Intl ? Intl.DateTimeFormat().resolvedOptions().timeZone : null,
      lang: navigator.language || null,
      platform: navigator.platform || null,
    });
  }
  // the page lives at …/recorder or …/results-analyser; the tracking route sits beside it
  var base = location.pathname.replace(/\/[^/]*$/, "");
  window.PerfxTrack = {
    send: function (payload) {
      try {
        fetch(base + "/analytics/track", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-Perfx-Fp": fingerprint() },
          body: JSON.stringify(payload),
          keepalive: true,
        }).catch(function () {});
      } catch (e) { /* never break the page */ }
    },
  };
})();
