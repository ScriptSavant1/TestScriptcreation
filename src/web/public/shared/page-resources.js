/**
 * page-resources.js — attach static resources (CSS, JS, images, fonts, media,
 * beacons) to the page that loaded them, the way VuGen's HTML mode and DevWeb's
 * resources[] model them, instead of scripting each one as its own request.
 *
 * Used by both the Recorder and Script Studio, for both Web HTTP/HTML and DevWeb.
 * Pure functions; UMD so Jest can require() it (same pattern as vugen-codegen.js).
 *
 * For each page step the resources that followed it are split into:
 *   inHtml — images / stylesheets / frames the page HTML names in real tags:
 *            downloaded automatically on replay (VuGen "Mode=HTML", DevWeb
 *            downloadHtmlStaticResources) — not scripted
 *   extra  — everything else (script files, files requested by CSS or
 *            JavaScript): listed on the page step (VuGen EXTRARES, DevWeb
 *            resources[]) — the same split VuGen's own HTML-mode recording makes
 * Failed/cancelled loads (status 0) and repeats of the same URL on one page are
 * absorbed but not listed. Browser-cache hits ARE listed (VuGen lists them too).
 * When the page's HTML was not recorded, every resource is listed as extra.
 */
(function (exports) {
  "use strict";

  var RESOURCE_TYPES = { stylesheet: 1, script: 1, image: 1, font: 1, media: 1, ping: 1, beacon: 1 };
  var NON_PAGE_TYPES = { fetch: 1, xhr: 1, websocket: 1, eventsource: 1, manifest: 1, preflight: 1 };

  function rt(e) { return String(e._resourceType || "").toLowerCase(); }
  function ct(e) { return String(e.ct || "").toLowerCase(); }
  function path(e) { return String(e.url || "").split("?")[0].split("#")[0].toLowerCase(); }
  function method(e) { return String(e.method || "GET").toUpperCase(); }

  /** A page step: a document navigation or a form submit that returned HTML. */
  function isPageEntry(e) {
    var t = rt(e);
    if (t === "document") return true;
    if (t && t !== "other") return false;
    var m = method(e);
    if (m !== "GET" && m !== "POST") return false;
    var c = ct(e);
    return c.indexOf("text/html") === 0 || c.indexOf("application/xhtml") === 0;
  }

  /** A sub-resource a browser loads for a page (never an API call). */
  function isResourceEntry(e) {
    // EXTRARES items and DevWeb resources[] are always replayed as GET, so a POST
    // beacon (navigator.sendBeacon, analytics "ping") must stay its own request
    if (method(e) !== "GET") return false;
    var t = rt(e);
    if (RESOURCE_TYPES[t]) return true;
    if (t === "document" || NON_PAGE_TYPES[t]) return false;
    var c = ct(e);
    if (c === "text/css" || c.indexOf("javascript") >= 0 || c.indexOf("image/") === 0 ||
        c.indexOf("font/") === 0 || c.indexOf("woff") >= 0 || c.indexOf("audio/") === 0 || c.indexOf("video/") === 0) return true;
    if (c) return false;
    return /\.(css|m?js|png|jpe?g|gif|ico|svg|webp|avif|bmp|woff2?|ttf|eot|otf|mp4|webm|mp3|ogg|wav)$/.test(path(e));
  }

  /** Only http(s) URLs can be replayed — never data:, blob:, chrome-extension:, about: … */
  function isHttpUrl(u) { return /^https?:\/\//i.test(String(u || "")); }

  /**
   * Failed or cancelled in the browser (status 0 — net::ERR_ABORTED, blocked by
   * client, …): there is no response to replay.
   *
   * Files the browser served from its own cache (DevTools HAR "_fromCache") are
   * NOT skipped: VuGen's recording lists them on every page step that uses them,
   * and on replay VuGen's "Simulate browser cache" run-time setting decides
   * whether to fetch them again. Skipping them left every page after the first
   * with no resources at all.
   */
  function notFetched(e) {
    return !e.status;
  }

  /** An iframe / frame document (fetch metadata says so) — part of its parent page. */
  function isFrameEntry(e) {
    var d = String((e.hdrsMap && e.hdrsMap["sec-fetch-dest"]) || "").toLowerCase();
    return (d === "iframe" || d === "frame") && method(e) === "GET" && isPageEntry(e);
  }

  /** Response HTML, base64-decoded when the HAR stored it encoded. */
  function pageHtml(e) {
    var b = e.respBody || "";
    if (!b) return "";
    var enc = String(e.respEncoding || "").toLowerCase();
    var looksB64 = b.indexOf("<") < 0 && b.length > 16 && /^[A-Za-z0-9+/=\s]+$/.test(b);
    if (enc !== "base64" && !looksB64) return b;
    try {
      var clean = b.replace(/\s+/g, "");
      var bin = typeof atob === "function" ? atob(clean) : Buffer.from(clean, "base64").toString("binary");
      var text;
      try { text = decodeURIComponent(escape(bin)); } catch (x) { text = bin; }
      return enc === "base64" || text.indexOf("<") >= 0 ? text : b;
    } catch (err) {
      return enc === "base64" ? "" : b;
    }
  }

  function decodeEntities(s) {
    return String(s)
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCharCode(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d) { return String.fromCharCode(parseInt(d, 10)); })
      .replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&amp;/g, "&");
  }

  function stripFragment(u) { return String(u).split("#")[0]; }

  function resolveUrl(value, base) {
    var v = decodeEntities(value).trim();
    if (!v || /^(data|javascript|about|blob|mailto):/i.test(v)) return null;
    try { return stripFragment(new URL(v, base).href); } catch (e) { return null; }
  }

  function attrsOf(attrText) {
    var a = {};
    var re = /([a-z_:][-a-z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/gi;
    var m;
    while ((m = re.exec(attrText))) {
      var k = m[1].toLowerCase();
      if (!(k in a)) a[k] = m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4] !== undefined ? m[4] : "";
    }
    return a;
  }

  /**
   * URLs that HTML-mode replay downloads on its own from the page HTML: real
   * <img src>, <input type="image" src>, <link rel="stylesheet" href>,
   * <iframe src> / <frame src> and background="…" attributes, resolved against
   * the page URL (and <base href>).
   *
   * Deliberately NOT included (they are listed on the page step instead):
   *  - <script src> files — VuGen's own HTML-mode recording lists them under
   *    EXTRARES (confirmed on a real JSF/PrimeFaces recording), i.e. replay does
   *    not fetch them from the HTML by itself
   *  - anything only mentioned as text (inline JavaScript, JSON, comments)
   *  - files requested by CSS (fonts, background images) or by JavaScript
   *  - <img srcset>/<source srcset> candidates and lazy-load data-src attributes
   */
  function htmlAutoResources(html, pageUrl) {
    var set = new Set();
    if (!html) return set;
    var h = String(html)
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<(script|style|textarea|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    var base = pageUrl || "http://localhost/";
    var bm = /<base\b([^>]*)>/i.exec(h);
    if (bm) {
      var bh = attrsOf(bm[1]).href;
      var b0 = bh && resolveUrl(bh, base);
      if (b0) base = b0;
    }
    var tagRe = /<([a-z][a-z0-9-]*)\b([^>]*)>/gi;
    var m;
    while ((m = tagRe.exec(h))) {
      var tag = m[1].toLowerCase();
      var a = attrsOf(m[2]);
      var u = null;
      if ((tag === "img" || tag === "iframe" || tag === "frame") && a.src) u = a.src;
      else if (tag === "input" && String(a.type).toLowerCase() === "image" && a.src) u = a.src;
      else if (tag === "link" && a.href && /(^|\s)stylesheet(\s|$)/i.test(a.rel || "")) u = a.href;
      if (u) { var r1 = resolveUrl(u, base); if (r1) set.add(r1); }
      if (a.background) { var r2 = resolveUrl(a.background, base); if (r2) set.add(r2); }
    }
    return set;
  }

  /** True when HTML-mode replay downloads this resource from the page HTML by itself. */
  function referencedInHtml(resourceUrl, html, pageUrl) {
    return htmlAutoResources(html, pageUrl).has(stripFragment(resourceUrl));
  }

  /**
   * @param entries        the tool's full entry array (markers and filtered entries included)
   * @param autoFollowSet  Set<idx> of redirect targets the script does not emit
   * @param include        optional (entry) => boolean; false = not scripted (e.g. Studio background decisions)
   * @param keep           optional Set<idx> that must stay standalone requests (correlation sources/usages)
   * @returns {{ absorbed: Set<number>, byPage: Map<number, {inHtml:number[], extra:number[], skipped:number[], htmlKnown:boolean, pageUrl:string}> }}
   *   absorbed — indices that must not be scripted as their own request
   *   byPage   — for each emitted page step: inHtml (auto-downloaded), extra (to list),
   *              skipped (failed / repeated — not listed); pageUrl is the URL
   *              whose HTML was loaded (the redirect target's, when redirected)
   */
  function groupPageResources(entries, autoFollowSet, include, keep) {
    var absorbed = new Set();
    var byPage = new Map();
    var page = null;       // index of the step resources currently attach to
    var pageIsHtml = false;// that step loaded an HTML page (false = an API/XHR step)
    var auto = new Set();  // URLs replay downloads from that page's HTML (and its frames) by itself
    var seen = new Set();  // URLs already accounted for on that step
    var lastEmitted = null;
    var pending = [];      // resources seen before the transaction's first step

    function group(idx, e) {
      var g = byPage.get(idx);
      if (!g) { g = { inHtml: [], extra: [], skipped: [], htmlKnown: false, pageUrl: e.url, isPage: false }; byPage.set(idx, g); }
      return g;
    }

    function startPage(idx, e, keepExisting) {
      page = idx;
      pageIsHtml = true;
      auto = htmlAutoResources(pageHtml(e), e.url);
      seen = new Set();
      if (!keepExisting) byPage.delete(idx);
      var g = group(idx, e);
      g.isPage = true;
      g.htmlKnown = !!pageHtml(e);
      g.pageUrl = e.url;
    }

    /**
     * A transaction with no page load (a single-page app screen that only calls
     * APIs): its resources attach to the step in progress, as VuGen records them
     * within the current step (EXTRARES on web_custom_request, resources[] on any
     * DevWeb request). Nothing is in an HTML page here, so everything is listed.
     */
    function startApiStep(idx, e) {
      page = idx;
      pageIsHtml = false;
      auto = new Set();
      seen = new Set();
      group(idx, e).pageUrl = e.url;
    }

    function attach(i) {
      var e = entries[i];
      var g = byPage.get(page);
      absorbed.add(i);
      var u = stripFragment(e.url);
      if (isFrameEntry(e)) {
        if (seen.has(u) || notFetched(e)) { g.skipped.push(i); return; }
        seen.add(u);
        if (auto.has(u)) {
          g.inHtml.push(i);
          // replay fetches the frame, and the images/stylesheets in the frame's own HTML
          htmlAutoResources(pageHtml(e), e.url).forEach(function (x) { auto.add(x); });
        } else {
          g.extra.push(i);
        }
        return;
      }
      if (!isHttpUrl(u) || notFetched(e) || seen.has(u)) { g.skipped.push(i); return; }
      seen.add(u);
      (auto.has(u) ? g.inHtml : g.extra).push(i);
    }

    function flushPending() {
      var p = pending; pending = [];
      for (var k = 0; k < p.length; k++) attach(p[k]);
    }

    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (e.isMarker) { // never cross a transaction boundary
        page = null; pageIsHtml = false; auto = new Set(); seen = new Set(); lastEmitted = null; pending = [];
        continue;
      }
      if (e.filtered || (include && !include(e))) continue;
      if (autoFollowSet && autoFollowSet.has(i)) {
        // Redirect target: not scripted, but its HTML is what the anchor step ends up loading
        if (isPageEntry(e) && lastEmitted !== null) startPage(lastEmitted, e, true);
        continue;
      }
      var kept = keep && keep.has(i);
      var isRes = !kept && (isResourceEntry(e) || (page !== null && isFrameEntry(e)));
      if (isRes) {
        if (page !== null) attach(i);
        else pending.push(i);
        continue;
      }
      lastEmitted = i;
      if (isPageEntry(e)) startPage(i, e, false);
      else if (!pageIsHtml) startApiStep(i, e); // keep attaching to the page when there is one
      flushPending();
    }
    // Pages that ended up with no resources need no annotation
    byPage.forEach(function (g, k) { if (!g.inHtml.length && !g.extra.length && !g.skipped.length) byPage.delete(k); });
    return { absorbed: absorbed, byPage: byPage };
  }

  exports.isPageEntry = isPageEntry;
  exports.isResourceEntry = isResourceEntry;
  exports.isHttpUrl = isHttpUrl;
  exports.htmlAutoResources = htmlAutoResources;
  exports.referencedInHtml = referencedInHtml;
  exports.groupPageResources = groupPageResources;
})(
  typeof module !== "undefined" && module.exports
    ? module.exports
    : typeof globalThis !== "undefined"
      ? (globalThis.PageResources = {})
      : (this.PageResources = {})
);
