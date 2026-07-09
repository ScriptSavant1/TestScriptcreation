"use strict";

const dns  = require("dns").promises;
const path = require("path");
const { UAParser } = require("ua-parser-js");
const db   = require("./db");

/**
 * Build the base event object from the incoming request.
 * Call this at the very start of a convert handler.
 * Returns a mutable event object you enrich and pass to finishEvent().
 */
function startEvent(req, tool) {
  const ip  = req.ip || req.socket?.remoteAddress || null;
  const fwd = req.headers["x-forwarded-for"] || null;

  // Parse User-Agent
  const ua      = new UAParser(req.headers["user-agent"] || "");
  const browser = [ua.getBrowser().name, ua.getBrowser().version].filter(Boolean).join(" ") || null;
  const os      = [ua.getOS().name,      ua.getOS().version     ].filter(Boolean).join(" ") || null;

  // Client-side fingerprint sent as JSON in the X-Perfx-Fp header
  let fp = {};
  try { fp = JSON.parse(req.headers["x-perfx-fp"] || "{}"); } catch (_) {}

  return {
    started_at:    new Date().toISOString(),
    _startMs:      Date.now(),               // internal — removed before DB insert
    ip_address:    ip,
    ip_forwarded:  fwd,
    hostname:      null,                     // filled async after insert
    device_id:     fp.deviceId || null,
    browser,
    os,
    screen_res:    fp.screen   || null,
    timezone:      fp.timezone || null,
    lang:          fp.lang     || null,
    platform:      fp.platform || null,
    tool,
    protocol:      null,
    script_mode:   null,
    filename:      null,
    file_ext:      null,
    file_size_kb:  null,
    request_count: null,
    result:        "failed",
    error_code:    null,
    correlations_found:    null,
    correlations_accepted: null,
    ended_at:      null,
    duration_ms:   null,
  };
}

/**
 * Enrich the event with file upload metadata.
 * Call this after multer has processed the upload.
 */
function enrichWithFile(event, file, protocol, scriptMode) {
  if (file) {
    const name = file.originalname || "";
    event.filename     = name;
    event.file_ext     = path.extname(name).toLowerCase() || null;
    event.file_size_kb = file.size ? Math.round(file.size / 1024) : null;
  }
  if (protocol)   event.protocol    = protocol;
  if (scriptMode) event.script_mode = scriptMode;
}

/**
 * Finalise and persist the event.
 * Call this inside the finally block so it always runs.
 *
 * @param {object} event      - object from startEvent()
 * @param {object} outcome    - { result, errorCode, requestCount, correlationsFound, correlationsAccepted }
 */
function finishEvent(event, outcome = {}) {
  event.ended_at    = new Date().toISOString();
  event.duration_ms = Date.now() - event._startMs;
  delete event._startMs;

  if (outcome.result)               event.result               = outcome.result;
  if (outcome.errorCode)            event.error_code           = outcome.errorCode;
  if (outcome.requestCount != null) event.request_count        = outcome.requestCount;
  if (outcome.correlationsFound != null)    event.correlations_found    = outcome.correlationsFound;
  if (outcome.correlationsAccepted != null) event.correlations_accepted = outcome.correlationsAccepted;

  let rowId;
  try {
    rowId = db.insertEvent(event);
  } catch (err) {
    // Analytics failure must NEVER crash the server
    console.warn("[analytics] DB insert failed:", err.message);
    return;
  }

  // Async reverse DNS — runs after response is sent, updates hostname field
  if (event.ip_address && rowId) {
    dns.reverse(event.ip_address)
      .then((hosts) => {
        if (hosts && hosts[0]) db.updateHostname(rowId, hosts[0]);
      })
      .catch(() => {}); // silently ignore — many IPs have no PTR record
  }
}

module.exports = { startEvent, enrichWithFile, finishEvent };
