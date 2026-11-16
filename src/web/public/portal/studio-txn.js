/* Script Studio — the user's own transaction edits (create from ticked requests, rename, ungroup), kept as a list of
 * operations by request id and applied again after every analysis (Studio re-reads the recording when a filter,
 * a domain or the second recording changes). Request ids are parseHar's ids: they never shift.
 *
 * Same rules as the Recorder had: a new transaction's START goes before the first ticked request and its END after
 * the last; ungroup removes the markers and the requests stay in the script. Markers look exactly like the ones the
 * engine makes itself (_makeStudioMarker), so the generators treat them the same way. S.txns is rebuilt in the order
 * the transactions start, which is the order the script numbers them (SC01_01_…).
 *
 * UMD: window.StudioTxn in the page, require() in the unit tests (tests/unit/studioTxn.test.js). */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.StudioTxn = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  var NAME_RE = /^[A-Za-z][A-Za-z0-9_]*$/;

  function marker(type, name) {
    return {
      id: -1, url: "", method: "GET", status: 0, ct: "", dur: 0, startMs: 0,
      reqHdrs: [], hdrsMap: {}, body: null, respCt: "", respBody: "",
      respHdrsMap: {}, respCookies: [], _resourceType: "", pageref: null,
      _perfx_class: null, _perfx_interval: null, _perfx_occurrences: null,
      _perfx_burst_id: null, _normalizedUrl: null,
      filtered: false, isMarker: true, markerType: type, txnName: name, txn: null,
      _pagerefSynthetic: false, _userTxn: true,
    };
  }

  /** Transaction names in the order they start in the journey (one entry per name). */
  function names(entries) {
    var seen = {}, out = [];
    entries.forEach(function (e) {
      if (e.isMarker && e.markerType === "start" && !seen[e.txnName]) { seen[e.txnName] = true; out.push(e.txnName); }
    });
    return out;
  }

  /** Which transaction each request belongs to (the innermost open one), as the engine does. */
  function assign(entries) {
    var open = [];
    entries.forEach(function (e) {
      if (e.isMarker) {
        if (e.markerType === "start") open.push(e.txnName);
        else { var k = open.lastIndexOf(e.txnName); if (k >= 0) open.splice(k); }
      } else e.txn = open.length ? open[open.length - 1] : null;
    });
  }

  /** Why a name cannot be used, or "" when it can. */
  function nameError(name, taken, from) {
    if (!name) return "Enter a transaction name.";
    if (!NAME_RE.test(name)) return "Name must start with a letter and contain only letters, numbers, underscores.";
    if (name !== from && taken.indexOf(name) !== -1) return "A transaction called " + name + " already exists — choose another name.";
    return "";
  }

  function create(entries, op) {
    var ids = op.ids || [];
    var first = -1, last = -1;
    entries.forEach(function (e, i) {
      if (!e.isMarker && ids.indexOf(e.id) !== -1) { if (first < 0) first = i; last = i; }
    });
    if (first < 0 || names(entries).indexOf(op.name) !== -1) return false;
    entries.splice(last + 1, 0, marker("end", op.name));
    entries.splice(first, 0, marker("start", op.name));
    return true;
  }
  function rename(entries, op) {
    if (names(entries).indexOf(op.from) === -1 || names(entries).indexOf(op.to) !== -1) return false;
    entries.forEach(function (e) { if (e.isMarker && e.txnName === op.from) e.txnName = op.to; });
    return true;
  }
  function ungroup(entries, op) {
    var n = entries.length;
    for (var i = entries.length - 1; i >= 0; i--) if (entries[i].isMarker && entries[i].txnName === op.name) entries.splice(i, 1);
    return entries.length !== n;
  }
  var OPS = { create: create, rename: rename, ungroup: ungroup };

  /** Apply one operation to the entry list (in place). Returns true when it changed something. */
  function applyOne(entries, op) {
    var f = OPS[op && op.op];
    var done = !!f && f(entries, op);
    if (done) assign(entries);
    return done;
  }

  /** Apply the whole log (after the engine read the recording again). Returns the operations that still apply —
   *  one whose requests are gone (a filter left them out of the file) is dropped. */
  function replay(entries, log) {
    var kept = [];
    (log || []).forEach(function (op) { if (applyOne(entries, op)) kept.push(op); });
    return kept;
  }

  return { NAME_RE: NAME_RE, marker: marker, names: names, assign: assign, nameError: nameError, applyOne: applyOne, replay: replay };
});
