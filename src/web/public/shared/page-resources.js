/**
 * page-resources.js — attach static resources (CSS, JS, images, fonts, media,
 * beacons) to the page that loaded them, the way VuGen's HTML mode and DevWeb's
 * resources[] model them, instead of scripting each one as its own request.
 *
 * Used by both the Recorder and Script Studio, for both Web HTTP/HTML and DevWeb.
 * Pure functions; UMD so Jest can require() it (same pattern as vugen-codegen.js).
 *
 * For each page step the resources that followed it are split into:
 *   inHtml — referenced in the page's HTML: downloaded automatically on replay
 *            (VuGen "Mode=HTML", DevWeb downloadHtmlStaticResources) — not scripted
 *   extra  — not in the HTML (loaded by JavaScript or CSS): listed on the page
 *            step (VuGen EXTRARES, DevWeb resources[])
 * When the page's HTML was not recorded, every resource is listed as extra.
 */
(function (exports) {
  "use strict";

  var RESOURCE_TYPES = { stylesheet: 1, script: 1, image: 1, font: 1, media: 1, ping: 1, beacon: 1 };
  var NON_PAGE_TYPES = { fetch: 1, xhr: 1, websocket: 1, eventsource: 1, manifest: 1, preflight: 1 };

  function rt(e) { return String(e._resourceType || "").toLowerCase(); }
  function ct(e) { return String(e.ct || "").toLowerCase(); }
  function path(e) { return String(e.url || "").split("?")[0].split("#")[0].toLowerCase(); }

  /** A page step: a document navigation or a form submit that returned HTML. */
  function isPageEntry(e) {
    var t = rt(e);
    if (t === "document") return true;
    if (t && t !== "other") return false;
    var m = String(e.method || "GET").toUpperCase();
    if (m !== "GET" && m !== "POST") return false;
    var c = ct(e);
    return c.indexOf("text/html") === 0 || c.indexOf("application/xhtml") === 0;
  }

  /** A sub-resource a browser loads for a page (never an API call). */
  function isResourceEntry(e) {
    var t = rt(e);
    if (RESOURCE_TYPES[t]) return true;
    if (t === "document" || NON_PAGE_TYPES[t]) return false;
    if (String(e.method || "GET").toUpperCase() !== "GET") return false;
    var c = ct(e);
    if (c === "text/css" || c.indexOf("javascript") >= 0 || c.indexOf("image/") === 0 ||
        c.indexOf("font/") === 0 || c.indexOf("woff") >= 0 || c.indexOf("audio/") === 0 || c.indexOf("video/") === 0) return true;
    if (c) return false;
    return /\.(css|m?js|png|jpe?g|gif|ico|svg|webp|avif|bmp|woff2?|ttf|eot|otf|mp4|webm|mp3|ogg|wav)$/.test(path(e));
  }

  function decodeEntities(s) {
    return s.replace(/&amp;/g, "&").replace(/&#x2f;|&#47;/gi, "/").replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  }

  /**
   * True when the page HTML references the resource URL — absolute, root-relative,
   * or by file name (relative paths like "../images/cart.gif").
   */
  function referencedInHtml(resourceUrl, html) {
    if (!html) return false;
    var h = decodeEntities(html);
    var noFrag = String(resourceUrl).split("#")[0];
    if (h.indexOf(noFrag) >= 0) return true;
    var m = /^[a-z]+:\/\/[^/]+(\/[^#]*)?$/i.exec(noFrag);
    var pathQuery = m ? m[1] || "/" : noFrag;
    if (pathQuery.length > 1 && h.indexOf(pathQuery) >= 0) return true;
    var p = pathQuery.split("?")[0];
    if (p.length > 1 && h.indexOf(p) >= 0) return true;
    var file = p.substring(p.lastIndexOf("/") + 1);
    if (file.length >= 4 && file.indexOf(".") > 0) {
      var re = new RegExp("[\"'/(=]" + file.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "([\"'?#)\\s>]|$)");
      if (re.test(h)) return true;
    }
    return false;
  }

  /**
   * @param entries        the tool's full entry array (markers and filtered entries included)
   * @param autoFollowSet  Set<idx> of redirect targets the script does not emit
   * @param include        optional (entry) => boolean; false = not scripted (e.g. Studio background decisions)
   * @param keep           optional Set<idx> that must stay standalone requests (correlation sources/usages)
   * @returns {{ absorbed: Set<number>, byPage: Map<number, {inHtml:number[], extra:number[], htmlKnown:boolean}> }}
   *   absorbed — resource indices that must not be scripted as their own request
   *   byPage   — for each emitted page step, the resources that belong to it
   */
  function groupPageResources(entries, autoFollowSet, include, keep) {
    var absorbed = new Set();
    var byPage = new Map();
    var page = null;       // index of the page step resources currently attach to
    var html = "";         // HTML of that page (the redirect target's, when redirected)
    var lastEmitted = null;

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.isMarker) { page = null; html = ""; lastEmitted = null; continue; } // never cross a transaction boundary
      if (e.filtered || (include && !include(e))) continue;
      if (autoFollowSet && autoFollowSet.has(i)) {
        // Redirect target: not scripted, but its HTML is what the anchor step ends up loading
        if (isPageEntry(e) && lastEmitted !== null) {
          page = lastEmitted;
          html = e.respBody || "";
          if (!byPage.has(page)) byPage.set(page, { inHtml: [], extra: [], htmlKnown: false });
          byPage.get(page).htmlKnown = !!html;
        }
        continue;
      }
      if (isResourceEntry(e) && page !== null && !(keep && keep.has(i))) {
        absorbed.add(i);
        var g = byPage.get(page);
        (referencedInHtml(e.url, html) ? g.inHtml : g.extra).push(i);
        continue;
      }
      lastEmitted = i;
      if (isPageEntry(e)) {
        page = i;
        html = e.respBody || "";
        byPage.set(i, { inHtml: [], extra: [], htmlKnown: !!html });
      }
    }
    // Pages that ended up with no resources need no annotation
    byPage.forEach(function (g, k) { if (!g.inHtml.length && !g.extra.length) byPage.delete(k); });
    return { absorbed: absorbed, byPage: byPage };
  }

  exports.isPageEntry = isPageEntry;
  exports.isResourceEntry = isResourceEntry;
  exports.referencedInHtml = referencedInHtml;
  exports.groupPageResources = groupPageResources;
})(
  typeof module !== "undefined" && module.exports
    ? module.exports
    : typeof globalThis !== "undefined"
      ? (globalThis.PageResources = {})
      : (this.PageResources = {})
);
