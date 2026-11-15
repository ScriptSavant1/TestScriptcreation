/**
 * One rule set for which recorded requests go into the script — the Recorder's rules, shared by the Recorder engine
 * (portal/recorder-core.js), Script Studio (VuGen-Script-Studio-correlation.js) and through the Recorder engine the
 * HAR Explorer. Before, Script Studio had its own rules, so the same recording gave a different script (BUG-142).
 *
 * UMD, no DOM, no globals of its own: global `RequestFilter` in a page, `require()` in Node (tests).
 * The four lists (static content types, static file extensions, analytics / ad servers, ad addresses) stay with the
 * engines that already hold them (identical in both) and are passed in as `rules`.
 *
 *   classify(e)                 the browser's type (DevTools category), with the content type / extension as fallback
 *   typeKey(e, rules)           the type a request is counted under: Doc, Fetch/XHR, JS, CSS, Img, Font, Media, Other —
 *                               a static file by its CONTENT (a favicon is Img whatever the browser called it)
 *   prefetchDuplicates(entries) pages the browser fetched in advance and then opened (the real navigation is scripted)
 *   leftOut(e, ctx)             why a request is left out of the script, or null when it is in the script
 *                               ctx = { rules, noise, options, typeOff:Set, domainOff:{host:false}, prefetchDup:Set }
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.RequestFilter = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var TYPES = ['document', 'fetch', 'script', 'stylesheet', 'image', 'font', 'media', 'other'];

  function classify(e) {
    var rt = (e._resourceType || '').toLowerCase();
    if (rt === 'fetch' || rt === 'xhr') return 'fetch';
    if (rt === 'document') return 'document';
    if (rt === 'stylesheet') return 'stylesheet';
    if (rt === 'script') return 'script';
    if (rt === 'font') return 'font';
    if (rt === 'image') return 'image';
    if (rt === 'media') return 'media';
    if (rt === 'manifest') return 'manifest';
    if (rt === 'websocket') return 'websocket';
    if (rt && rt !== 'other' && rt !== '') return rt;
    var ct = (e.ct || '').toLowerCase();
    if (/json|graphql|form-urlencoded|form-data|xml|text\/plain/.test(ct) || e.method === 'POST' || e.method === 'PUT' || e.method === 'PATCH') return 'fetch';
    if (ct.indexOf('text/html') === 0 || ct.indexOf('application/xhtml') === 0) return 'document';
    if (ct.indexOf('text/css') === 0) return 'stylesheet';
    if (/javascript/.test(ct)) return 'script';
    if (ct.indexOf('font/') === 0) return 'font';
    if (ct.indexOf('image/') === 0) return 'image';
    if (ct.indexOf('audio/') === 0 || ct.indexOf('video/') === 0) return 'media';
    var path = (e.url || '').split('?')[0].toLowerCase();
    if (/\.(css)$/.test(path)) return 'stylesheet';
    if (/\.(js)$/.test(path)) return 'script';
    if (/\.(woff2?|ttf|eot|otf)$/.test(path)) return 'font';
    if (/\.(png|jpe?g|gif|ico|svg|webp)$/.test(path)) return 'image';
    if (/\.(mp4|webm|mp3|ogg|wav)$/.test(path)) return 'media';
    return 'other';
  }

  // A static file (STATIC_CT / STATIC_EXT) is JS, CSS, Img or Font by its content. A request the browser called a
  // script / image … that is NOT a static file (JSONP, a pixel answering HTML) goes under Fetch/XHR or Other.
  function typeKey(e, rules) {
    var ct = (e.ct || '').toLowerCase();
    var path = (e.url || '').split('?')[0];
    if (rules.STATIC_CT.has(e.ct)) {
      if (ct === 'text/css') return 'stylesheet';
      if (/javascript/.test(ct)) return 'script';
      if (ct.indexOf('image/') === 0) return 'image';
      return 'font';
    }
    if (rules.STATIC_EXT.test(path)) {
      if (/\.css$/i.test(path)) return 'stylesheet';
      if (/\.(js\.map|map)$/i.test(path)) return 'script';
      if (/\.(woff2?|ttf|eot|otf)$/i.test(path)) return 'font';
      return 'image';
    }
    var c = classify(e);
    if (c === 'stylesheet' || c === 'script' || c === 'image' || c === 'font')
      return /json|xml|text\/plain|graphql|form-urlencoded/.test(ct) ? 'fetch' : 'other';
    return TYPES.indexOf(c) >= 0 ? c : 'other';
  }

  function prefetchDuplicates(entries) {
    var dup = new Set(), later = new Set();
    var isPf = function (e) { return /prefetch|prerender/i.test(((e.hdrsMap || {})['sec-purpose'] || (e.hdrsMap || {}).purpose || '')); };
    for (var i = entries.length - 1; i >= 0; i--) {
      var e = entries[i];
      if (e.isMarker || (e.method || 'GET') !== 'GET') continue;
      if (isPf(e)) { if (later.has(e.url)) dup.add(e); }
      else later.add(e.url);
    }
    return dup;
  }

  function leftOut(e, ctx) {
    // CSP violation reports — the browser sends these when the bookmarklets' .invalid marker URLs are blocked
    var reqCt = ((e.hdrsMap || {})['content-type'] || '').split(';')[0].trim().toLowerCase();
    if (reqCt === 'application/csp-report' || reqCt === 'application/reports+json') return 'report';
    if (e.body && e.body.text && e.body.text.indexOf('"blocked-uri"') >= 0) return 'report';
    // WebSocket upgrades (ws://, wss://) cannot be replayed by VuGen Web HTTP/HTML: 400 Bad Request
    if (/^wss?:\/\//i.test(e.url)) return 'websocket';
    // data:, blob:, chrome-extension:, about: … — never a network request
    if (!/^https?:\/\//i.test(e.url)) return 'nonhttp';
    // a page fetched in advance and then opened: the real navigation is in the script
    if (ctx.prefetchDup && ctx.prefetchDup.has(e)) return 'prefetch';
    var host = '';
    try { host = new URL(e.url).hostname; } catch (x) { /* not a URL */ }
    if (host && ctx.domainOff && ctx.domainOff[host] === false) return 'domain';
    if (ctx.options && e.method === 'OPTIONS') return 'options';
    if (ctx.noise && host && (ctx.rules.NOISY.test(host) || (ctx.rules.NOISY_URL && ctx.rules.NOISY_URL.test(e.url)))) return 'ads';
    if (ctx.typeOff && ctx.typeOff.has(typeKey(e, ctx.rules))) return 'type';
    return null;
  }

  return { TYPES: TYPES, classify: classify, typeKey: typeKey, prefetchDuplicates: prefetchDuplicates, leftOut: leftOut };
});
