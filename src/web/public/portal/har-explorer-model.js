/* HAR Explorer — the model: a HAR file → transactions → requests, with the Recorder's own rules.
 *
 * Runs after the Recorder engine files (loaded unchanged, in this order): VuGen-Recorder-state.js (S, STATIC_CT,
 * NOISY …), VuGen-Recorder-parsers.js (processHAR) and portal/recorder-core.js (detectMarkers, applyFilters,
 * recLeftOut, recTypeKey, _repairOrphanEnds). processHAR() is the Recorder's reading of a file: bookmark START / END markers or CDP
 * Recorder pages become transactions, and every request gets the Recorder's left-out reason — so the Explorer
 * always groups and marks exactly like the Recorder (tests/unit/harExplorerModel.test.js).
 * processHAR() also redraws the Recorder's own screen; on this page those drawing functions do nothing. */

// The Recorder's drawing steps inside processHAR() — nothing to draw on this page
function buildDomainStats() {}
function renderDomainPanel() {}
function buildScripts() {}
function renderTable() {}
function renderStats() {}
function showScript() {}

// Type buttons: the Recorder's keys (recTypeKey) and labels, in its order
var HX_TYPES = [['document', 'Doc'], ['fetch', 'Fetch/XHR'], ['script', 'JS'], ['stylesheet', 'CSS'], ['image', 'Img'], ['font', 'Font'], ['media', 'Media'], ['other', 'Other']];
// Why a request is left out — the Recorder's reason codes (recLeftOut), in its words
var HX_WHY = {
  report: 'Browser security report', websocket: 'WebSocket — cannot be replayed', nonhttp: 'Not a network request',
  domain: 'Domain switched off', options: 'OPTIONS (CORS preflight) — the browser sends it by itself', ads: 'Analytics / ads server',
  prefetch: 'Browser prefetch — the page itself is opened later in the script'
};
var HX_OUT_LABEL = { report: 'browser reports', websocket: 'WebSocket', nonhttp: 'non-network', domain: 'from switched-off domains', options: 'OPTIONS', ads: 'analytics / ads', prefetch: 'prefetch' };

function hxTypeLabel(key) { for (var i = 0; i < HX_TYPES.length; i++) if (HX_TYPES[i][0] === key) return HX_TYPES[i][1]; return 'Other'; }

// The reason a request is left out, in words (null when it is in the script)
function hxWhy(item) {
  if (!item.out) return null;
  if (item.out === 'type') return hxTypeLabel(item.type) + ' — a static file, replayed as a page resource';
  return HX_WHY[item.out] || 'Left out';
}

// "3 analytics / ads, 2 JS" — the summary line of a group's left-out requests (most first)
function hxOutSummary(items) {
  var by = {};
  items.forEach(function (it) { var l = it.out === 'type' ? hxTypeLabel(it.type) : (HX_OUT_LABEL[it.out] || 'other'); by[l] = (by[l] || 0) + 1; });
  return Object.keys(by).sort(function (a, b) { return by[b] - by[a]; }).map(function (l) { return by[l] + ' ' + l; }).join(', ');
}

/**
 * Reads a parsed HAR. Returns
 *   { groups: [{ name, txn, items }], items, source, creator, start, end }
 * group.name: the transaction name (null = "Not in a transaction"); item: { n, e, raw, type, out, start, dur }
 * — e is the Recorder's entry (url, method, status, ct, size, dur …), raw the HAR entry itself (headers, bodies,
 * timings), n the request's number in the file.
 */
function hxBuild(har) {
  processHAR(har);
  _repairOrphanEnds();   // an END bookmark without its START — the Recorder repairs it the same way, right after reading
  var raw = (har && har.log && har.log.entries) || [];
  var groups = [], items = [], cur = null, bookmarks = false, t0 = Infinity, end = 0;
  S.entries.forEach(function (e) { if (!e.isMarker && e.startMs > 0 && e.startMs < t0) t0 = e.startMs; });
  if (t0 === Infinity) t0 = 0;
  S.entries.forEach(function (e) {
    if (e.isMarker) {
      if (e.url) bookmarks = true;            // a START / END bookmark request (CDP pages have none)
      if (e.markerType === 'start') { cur = { name: e.txnName, txn: true, items: [] }; groups.push(cur); } else cur = null;
      return;
    }
    if (!cur || (cur.txn && e.txn !== cur.name)) { cur = { name: null, txn: false, items: [] }; groups.push(cur); }
    var start = e.startMs > 0 ? e.startMs - t0 : 0, dur = Math.max(0, e.dur || 0);
    var it = { n: e.id, e: e, raw: raw[e.id - 1] || {}, type: recTypeKey(e), out: e.leftOut || null, start: start, dur: dur };
    if (start + dur > end) end = start + dur;
    cur.items.push(it); items.push(it);
  });
  var creator = (har && har.log && har.log.creator) || {};
  var source = bookmarks ? 'bookmarks' : S.txns.length ? (/perfx/i.test(creator.name || '') ? 'cdp' : 'pages') : 'none';
  return { groups: groups, items: items, source: source, creator: creator, start: t0, end: Math.max(end, 1) };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { hxBuild: hxBuild, hxWhy: hxWhy, hxOutSummary: hxOutSummary, hxTypeLabel: hxTypeLabel, HX_TYPES: HX_TYPES };
