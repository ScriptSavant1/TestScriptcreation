/* Plan the load in Workload Modeller — shared by the converters (portal/convert-preview.js) and Script Studio
 * (portal/studio-page.js): the script ZIPs are handed to the Workload Modeller page in the portal, through its own
 * window.WorkloadModeller.addScripts (workload-modeller/web/page.js) — the same as choosing the files there.
 *   PerfxPlanLoad.available(win)    true when the portal is there (this window, or the one around this tool's frame)
 *   PerfxPlanLoad.send(files, win)  opens the Workload Modeller and hands the files over → Promise<boolean>
 */
(function (root) {
  "use strict";
  function portal(win) {
    try {
      var w = win || window;
      if (w.PerfxShell) return w;
      if (w.parent && w.parent !== w && w.parent.PerfxShell) return w.parent;
    } catch (e) { /* another origin: no portal */ }
    return null;
  }
  function available(win) { return !!portal(win); }
  function send(files, win) {
    var top = portal(win);
    if (!top || !files || !files.length) return Promise.resolve(false);
    top.PerfxShell.go("workload");
    return new Promise(function (done) {
      var tries = 0;
      (function poll() {
        var w = null, ready = false;
        try {
          var fr = top.document.getElementById("iframe-workload");
          w = fr && fr.contentWindow;
          ready = !!(w && w.document.readyState === "complete" && w.WorkloadModeller && w.WorkloadModeller.addScripts);
        } catch (e) { ready = false; }
        if (ready) { w.WorkloadModeller.addScripts(files); done(true); return; }
        if (++tries < 200) setTimeout(poll, 100); else done(false);
      })();
    });
  }
  root.PerfxPlanLoad = { available: available, send: send };
})(typeof self !== "undefined" ? self : this);
