'use strict';
/**
 * harParser.js  —  Server-side utility for classified HAR files produced by
 * the PerfX Studio Recorder extension.
 *
 * Used by the /api/upload-har endpoint (Phase 4A direct-POST path).
 * Client-side equivalent logic lives in studio-app.js (_buildPeriodicSummary).
 */

/**
 * Returns true if the HAR contains at least one entry with a _perfx_class field.
 * Used to decide whether to show the background-request review panel.
 */
function hasPerfxData(harJson) {
  const entries = harJson?.log?.entries || [];
  return entries.some(e => e._perfx_class != null);
}

/**
 * Split entries by classification and build a periodic summary.
 * @param {Object} harJson — parsed HAR 1.2 object
 * @returns {{ entries, pages, classified, periodicSummary }}
 */
function parseClassifiedHar(harJson) {
  const entries = harJson?.log?.entries || [];
  const pages   = harJson?.log?.pages   || [];

  const classified = { action: [], periodic: [], once: [], unknown: [] };

  for (const entry of entries) {
    const cls = entry._perfx_class || 'unknown';
    (classified[cls] || classified.unknown).push(entry);
  }

  const periodicSummary = buildPeriodicSummary(classified.periodic);

  return { entries, pages, classified, periodicSummary };
}

/**
 * Group periodic entries by normalised URL and aggregate stats.
 * @param {Array} periodicEntries
 * @returns {Array<{normalizedUrl, exampleUrl, method, occurrences, intervalMs, userDecision}>}
 */
function buildPeriodicSummary(periodicEntries) {
  const groups = new Map();

  for (const entry of periodicEntries) {
    const key = entry._normalizedUrl || entry.request?.url || '';
    if (!groups.has(key)) {
      groups.set(key, {
        normalizedUrl: key,
        exampleUrl:    entry.request?.url || key,
        method:        (entry.request?.method || 'GET').toUpperCase(),
        occurrences:   0,
        intervalMs:    entry._perfx_interval || null,
        userDecision:  'exclude',   // default — user can override in review panel
      });
    }
    groups.get(key).occurrences++;
  }

  return [...groups.values()];
}

module.exports = { hasPerfxData, parseClassifiedHar, buildPeriodicSummary };
