/**
 * errors.js — SqliteDb.db error log → rows and an error summary.
 *
 * The SQL runner is injected (better-sqlite3 in the CLI, sql.js in the browser), so this module
 * only holds the query and the grouping. Schema (run 59): Main(Row_ID, Error_Code, Time, Type,
 * Line, Area, Iteration, Action_ID, Message_ID, Injector_ID, Script_ID, Vuser_ID) with lookup
 * tables Actions, ErrorMessages, Injectors, Scripts, VusersID. LEFT JOINs: the *_ID columns
 * default to 0, which has no lookup row. Main.Time is LOCAL controller time.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).errors = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const ERROR_TYPE = 2;

  const QUERY = `
    SELECT m.Row_ID AS rowId, m.Error_Code AS code, m.Time AS time, m.Type AS type, m.Line AS line,
           m.Area AS area, m.Iteration AS iteration,
           a.Action_Name AS action, e.Message_String AS message, i.Injector_Name AS injector,
           s.Script_Name AS script, v.Vuser_ID_Name AS vuser
    FROM Main m
    LEFT JOIN Actions a       ON a.Action_ID = m.Action_ID
    LEFT JOIN ErrorMessages e ON e.Message_ID = m.Message_ID
    LEFT JOIN Injectors i     ON i.Injector_ID = m.Injector_ID
    LEFT JOIN Scripts s       ON s.Script_ID = m.Script_ID
    LEFT JOIN VusersID v      ON v.Vuser_ID = m.Vuser_ID
    ORDER BY m.Time, m.Row_ID`;

  /** "2026-09-29 14:35:22" (local) → wall seconds as if UTC, or null. */
  function parseLocal(t) {
    if (t == null) return null;
    if (typeof t === "number") return t;
    const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(\.\d+)?/.exec(String(t));
    if (!m) return null;
    return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) / 1000 + (m[7] ? parseFloat(m[7]) : 0);
  }

  /**
   * Message pattern for grouping: GUIDs, hex ids and numbers replaced so the same problem groups
   * together — except the script location ("Action.c(230)") and the error code ("Error -26377"),
   * which say where and what failed and are kept.
   */
  function pattern(msg) {
    const keep = [];
    // placeholder: NUL + a private-use character for the index (no digits, so "<n>" leaves it alone)
    const hold = (m) => { keep.push(m); return "\u0000" + String.fromCharCode(0xe000 + keep.length - 1); };
    return String(msg || "")
      .replace(/[\w.-]+\.(c|h|js|ts|java|cs)\(\d+\)/gi, hold)
      .replace(/\b(Error|Warning)\s+-?\d+/gi, hold)
      .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<guid>")
      .replace(/\b0x[0-9a-f]+\b/gi, "<hex>")
      .replace(/\b\d+(\.\d+)?\b/g, "<n>")
      .replace(/\s+/g, " ")
      .replace(/\u0000([-])/g, (_, c) => keep[c.charCodeAt(0) - 0xe000])
      .trim();
  }

  /**
   * @param {object[]} rows  result of QUERY
   * @param {number} localOffsetSec  seconds to add to UTC to get local time
   * @param {number|null} startUtc   scenario start (unix s) for relative times
   */
  function summarise(rows, localOffsetSec, startUtc) {
    // Main.Type 2 = error (other types are warnings / notifications), as in the LRE .mdb queries.
    // Only when no row carries Type 2 are all rows kept (older files without a usable Type).
    const otherByType = {};
    const hasErrorType = rows.some((r) => Number(r.type) === ERROR_TYPE);
    if (hasErrorType) {
      for (const r of rows) if (Number(r.type) !== ERROR_TYPE) otherByType[r.type] = (otherByType[r.type] || 0) + 1;
      rows = rows.filter((r) => Number(r.type) === ERROR_TYPE);
    }
    const groups = new Map();
    const out = rows.map((r) => {
      const wall = parseLocal(r.time);
      const utc = wall == null ? null : wall - (localOffsetSec || 0);
      return Object.assign({}, r, { utc, relSec: utc != null && startUtc ? utc - startUtc : null });
    });
    for (const r of out) {
      const key = (r.code == null ? "" : r.code) + "|" + pattern(r.message) + "|" + (r.script || "");
      let g = groups.get(key);
      if (!g) {
        g = { code: r.code, pattern: pattern(r.message), example: r.message, script: r.script || null,
              count: 0, firstUtc: null, lastUtc: null, vusers: new Set(), injectors: new Set(), actions: new Set() };
        groups.set(key, g);
      }
      g.count++;
      if (r.utc != null) {
        if (g.firstUtc == null || r.utc < g.firstUtc) g.firstUtc = r.utc;
        if (g.lastUtc == null || r.utc > g.lastUtc) g.lastUtc = r.utc;
      }
      if (r.vuser) g.vusers.add(r.vuser);
      if (r.injector) g.injectors.add(r.injector);
      if (r.action) g.actions.add(r.action);
    }
    const summary = [...groups.values()].sort((a, b) => b.count - a.count).map((g) => Object.assign(g, {
      vusers: [...g.vusers].sort(), injectors: [...g.injectors].sort(), actions: [...g.actions].sort(),
    }));
    return { total: out.length, rows: out, summary, typeFilter: hasErrorType ? "Main.Type = 2 (errors)" : "all rows (no Type 2 rows found)", otherByType };
  }

  return { QUERY, summarise, pattern, parseLocal, ERROR_TYPE };
});
