"use strict";

const Database = require("better-sqlite3");
const path     = require("path");
const fs       = require("fs");

const DB_PATH = process.env.ANALYTICS_DB_PATH
  || path.join(process.cwd(), "data", "analytics.db");

// Ensure data/ directory exists before opening the DB
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);

// WAL mode: better concurrent read performance, no journal file bloat
db.pragma("journal_mode = WAL");
db.pragma("synchronous = NORMAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversions (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,

    -- Timing
    started_at            TEXT NOT NULL,
    ended_at              TEXT,
    duration_ms           INTEGER,

    -- Machine identity (server-side)
    ip_address            TEXT,
    ip_forwarded          TEXT,
    hostname              TEXT,

    -- Browser / device identity (client-side fingerprint)
    device_id             TEXT,
    browser               TEXT,
    os                    TEXT,
    screen_res            TEXT,
    timezone              TEXT,
    lang                  TEXT,
    platform              TEXT,

    -- What they did
    tool                  TEXT NOT NULL,
    protocol              TEXT,
    script_mode           TEXT,

    -- Input file
    filename              TEXT,
    file_ext              TEXT,
    file_size_kb          INTEGER,
    request_count         INTEGER,

    -- Output
    result                TEXT NOT NULL,
    error_code            TEXT,

    -- Studio-specific
    correlations_found    INTEGER,
    correlations_accepted INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_started_at ON conversions (started_at);
  CREATE INDEX IF NOT EXISTS idx_device_id  ON conversions (device_id);
  CREATE INDEX IF NOT EXISTS idx_ip         ON conversions (ip_address);
  CREATE INDEX IF NOT EXISTS idx_hostname   ON conversions (hostname);
  CREATE INDEX IF NOT EXISTS idx_tool       ON conversions (tool);
  CREATE INDEX IF NOT EXISTS idx_result     ON conversions (result);
`);

// ── Prepared statements ───────────────────────────────────────────────────────

const stmtInsert = db.prepare(`
  INSERT INTO conversions (
    started_at, ended_at, duration_ms,
    ip_address, ip_forwarded, hostname,
    device_id, browser, os, screen_res, timezone, lang, platform,
    tool, protocol, script_mode,
    filename, file_ext, file_size_kb, request_count,
    result, error_code,
    correlations_found, correlations_accepted
  ) VALUES (
    @started_at, @ended_at, @duration_ms,
    @ip_address, @ip_forwarded, @hostname,
    @device_id, @browser, @os, @screen_res, @timezone, @lang, @platform,
    @tool, @protocol, @script_mode,
    @filename, @file_ext, @file_size_kb, @request_count,
    @result, @error_code,
    @correlations_found, @correlations_accepted
  )
`);

const stmtUpdateHostname = db.prepare(
  `UPDATE conversions SET hostname = @hostname WHERE id = @id`
);

// ── Public API ────────────────────────────────────────────────────────────────

function insertEvent(event) {
  const info = stmtInsert.run(event);
  return info.lastInsertRowid;
}

function updateHostname(id, hostname) {
  stmtUpdateHostname.run({ id, hostname });
}

/**
 * Query conversions with optional filters.
 * @param {object} opts
 * @param {string}  [opts.from]    ISO date string start (inclusive)
 * @param {string}  [opts.to]      ISO date string end (inclusive)
 * @param {string}  [opts.tool]    filter by tool
 * @param {string}  [opts.result]  filter by result
 * @param {string}  [opts.search]  hostname/IP substring search
 * @param {number}  [opts.limit]   max rows (default 500)
 * @param {number}  [opts.offset]  pagination offset (default 0)
 */
function queryEvents(opts = {}) {
  const { from, to, tool, result, search, limit = 500, offset = 0 } = opts;
  const where = ["1=1"];
  const params = {};

  if (from)   { where.push("started_at >= @from");   params.from   = from; }
  if (to)     { where.push("started_at <= @to");     params.to     = to + "T23:59:59Z"; }
  if (tool)   { where.push("tool = @tool");           params.tool   = tool; }
  if (result) { where.push("result = @result");       params.result = result; }
  if (search) {
    where.push("(hostname LIKE @search OR ip_address LIKE @search OR device_id LIKE @search)");
    params.search = `%${search}%`;
  }

  params.limit  = limit;
  params.offset = offset;

  const rows = db.prepare(
    `SELECT * FROM conversions WHERE ${where.join(" AND ")}
     ORDER BY started_at DESC LIMIT @limit OFFSET @offset`
  ).all(params);

  const total = db.prepare(
    `SELECT COUNT(*) AS n FROM conversions WHERE ${where.join(" AND ")}`
  ).get(params).n;

  return { rows, total };
}

/** Returns all rows matching the filter (no pagination) — used for exports. */
function queryAllForExport(opts = {}) {
  const { from, to, tool, result } = opts;
  const where = ["1=1"];
  const params = {};

  if (from)   { where.push("started_at >= @from");   params.from   = from; }
  if (to)     { where.push("started_at <= @to");     params.to     = to + "T23:59:59Z"; }
  if (tool)   { where.push("tool = @tool");           params.tool   = tool; }
  if (result) { where.push("result = @result");       params.result = result; }

  return db.prepare(
    `SELECT * FROM conversions WHERE ${where.join(" AND ")} ORDER BY started_at DESC`
  ).all(params);
}

/** Aggregate stats for the summary dashboard. */
function queryStats(opts = {}) {
  const { from, to } = opts;
  const where = ["1=1"];
  const params = {};

  if (from) { where.push("started_at >= @from"); params.from = from; }
  if (to)   { where.push("started_at <= @to");   params.to   = to + "T23:59:59Z"; }

  const w = where.join(" AND ");

  const totals = db.prepare(
    `SELECT
       COUNT(*)                                          AS total,
       SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) AS success_count,
       SUM(CASE WHEN result='failed'  THEN 1 ELSE 0 END) AS fail_count,
       SUM(CASE WHEN result='timeout' THEN 1 ELSE 0 END) AS timeout_count,
       ROUND(AVG(CASE WHEN duration_ms IS NOT NULL THEN duration_ms END), 0) AS avg_duration_ms,
       COUNT(DISTINCT device_id)  AS unique_devices,
       COUNT(DISTINCT ip_address) AS unique_ips,
       COUNT(DISTINCT hostname)   AS unique_hosts
     FROM conversions WHERE ${w}`
  ).get(params);

  const toolBreakdown = db.prepare(
    `SELECT tool, COUNT(*) AS n FROM conversions WHERE ${w}
     GROUP BY tool ORDER BY n DESC`
  ).all(params);

  const protocolBreakdown = db.prepare(
    `SELECT protocol, COUNT(*) AS n FROM conversions WHERE ${w}
     GROUP BY protocol ORDER BY n DESC`
  ).all(params);

  const topMachines = db.prepare(
    `SELECT
       COALESCE(hostname, ip_address, 'Unknown') AS machine,
       ip_address,
       device_id,
       COUNT(*) AS n,
       SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) AS success_count,
       MAX(started_at) AS last_seen
     FROM conversions WHERE ${w}
     GROUP BY COALESCE(hostname, ip_address, 'Unknown')
     ORDER BY n DESC LIMIT 20`
  ).all(params);

  const topFiles = db.prepare(
    `SELECT
       filename,
       file_ext,
       COUNT(*) AS n,
       ROUND(AVG(file_size_kb), 0) AS avg_size_kb,
       ROUND(AVG(duration_ms), 0) AS avg_duration_ms
     FROM conversions WHERE ${w} AND filename IS NOT NULL
     GROUP BY filename ORDER BY n DESC LIMIT 20`
  ).all(params);

  // Conversions per day (last 90 days max)
  const dailyTrend = db.prepare(
    `SELECT
       SUBSTR(started_at, 1, 10) AS day,
       COUNT(*) AS n,
       SUM(CASE WHEN result='success' THEN 1 ELSE 0 END) AS success_count
     FROM conversions WHERE ${w}
     GROUP BY day ORDER BY day ASC LIMIT 90`
  ).all(params);

  // Peak hours heatmap (hour 0-23 × weekday 0=Mon … 6=Sun)
  const hourlyHeatmap = db.prepare(
    `SELECT
       CAST(STRFTIME('%H', started_at) AS INTEGER) AS hour,
       CAST(STRFTIME('%w', started_at) AS INTEGER) AS dow,
       COUNT(*) AS n
     FROM conversions WHERE ${w}
     GROUP BY hour, dow`
  ).all(params);

  return { totals, toolBreakdown, protocolBreakdown, topMachines, topFiles, dailyTrend, hourlyHeatmap };
}

/** Delete records older than retentionDays (0 = keep forever). */
function pruneOldRecords(retentionDays) {
  if (!retentionDays || retentionDays <= 0) return 0;
  const cutoff = new Date(Date.now() - retentionDays * 86400 * 1000).toISOString();
  const info = db.prepare("DELETE FROM conversions WHERE started_at < @cutoff").run({ cutoff });
  return info.changes;
}

module.exports = { insertEvent, updateHostname, queryEvents, queryAllForExport, queryStats, pruneOldRecords };
