"use strict";

const HEADERS = [
  "ID","Started At","Ended At","Duration (ms)","IP Address","X-Forwarded-For",
  "Hostname","Device ID","Browser","OS","Screen","Timezone","Language","Platform",
  "Tool","Protocol","Script Mode","Filename","File Extension","File Size (KB)",
  "Request Count","Result","Error Code","Correlations Found","Correlations Accepted",
];

function escapeCell(v) {
  if (v === null || v === undefined) return "";
  const s = String(v);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function rowToArray(r) {
  return [
    r.id, r.started_at, r.ended_at, r.duration_ms,
    r.ip_address, r.ip_forwarded, r.hostname,
    r.device_id, r.browser, r.os, r.screen_res,
    r.timezone, r.lang, r.platform,
    r.tool, r.protocol, r.script_mode,
    r.filename, r.file_ext, r.file_size_kb, r.request_count,
    r.result, r.error_code,
    r.correlations_found, r.correlations_accepted,
  ];
}

/**
 * Stream a CSV to the response object.
 * @param {object} res      - Express response
 * @param {Array}  rows     - DB rows from queryAllForExport()
 * @param {string} filename - download filename
 */
function streamCsv(res, rows, filename = "perfx-analytics.csv") {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);

  // UTF-8 BOM so Excel opens with correct encoding
  res.write("﻿");
  res.write(HEADERS.map(escapeCell).join(",") + "\r\n");

  for (const row of rows) {
    res.write(rowToArray(row).map(escapeCell).join(",") + "\r\n");
  }

  res.end();
}

module.exports = { streamCsv };
