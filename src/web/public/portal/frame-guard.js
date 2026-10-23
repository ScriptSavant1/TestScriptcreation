/* One address for the whole app: a tool page (Recorder, Script Studio, Results Analyser) opened
 * directly in a browser tab is sent to the portal (…/converter/), which then opens that tool.
 * Inside the portal (in its frame) this does nothing. Automated test browsers (navigator.webdriver)
 * may still load the page on its own, so the regression harnesses keep working.
 * The tool is named by <html data-portal-tool="record|studio|results">. */
(function () {
  if (window.top !== window || navigator.webdriver) return;
  var tool = document.documentElement.getAttribute("data-portal-tool");
  try { if (tool) sessionStorage.setItem("perfx-open", tool); } catch (e) { /* storage blocked: Home opens */ }
  location.replace(location.pathname.indexOf("/converter") === 0 ? "/converter/" : "/");
})();
