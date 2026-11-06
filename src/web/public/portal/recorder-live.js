/* portal/recorder-live.js — the Recorder page's side of "Start recording" (portal/record-live.js draws the window and
 * the live view). The live view replaces the start page while recording; the saved recording goes to readFile() —
 * the same path as a dropped file (format question → workspace).
 */
(function () {
  'use strict';
  function init() {
    var btn = document.getElementById('lv-start');
    if (!btn || !window.PerfxRecordLive) return;
    var welcome = document.getElementById('welcome'), main = document.getElementById('main');
    window.PerfxRecordLive.mount({
      host: document.querySelector('.rc-page'),
      chips: document.getElementById('lv-chips'),
      isIdle: function () { return !welcome.hidden; },
      before: function () { welcome.hidden = true; main.hidden = true; },
      after: function () { if (typeof showWelcome === 'function') showWelcome(); else welcome.hidden = false; },
      onSaved: function (file) { if (typeof readFile === 'function') readFile(file); },
      onHow: function () {
        var how = document.getElementById('how'); if (!how) return;
        how.open = true;
        var tab = document.getElementById('tab-cdp'); if (tab) tab.click();
        how.scrollIntoView({ block: 'start', behavior: 'smooth' });
      },
    });
    btn.addEventListener('click', window.PerfxRecordLive.open);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
