#!/usr/bin/env node
/**
 * merge-analytics-db.js — one-time merge of a second server's analytics database into the main one
 * (moving from two IIS servers to one, so the admin reports cover all usage).
 *
 *   node scripts/merge-analytics-db.js <main.db> <other.db> [--dry-run]
 *
 * Before running: stop the IIS app pool on both servers, and copy the other server's analytics.db
 * together with its analytics.db-wal / analytics.db-shm files if present (they can hold the latest
 * records). The main database is backed up next to itself first (analytics.db.bak-<timestamp>).
 *
 * Every column except the id is copied, so rows get new ids and never clash. A row that already
 * exists in the main database (same start time, device, IP, tool, file, result and duration) is
 * skipped, so running the merge twice does not double-count.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

/** Columns that identify one recorded conversion (used to skip rows already merged). */
const IDENTITY = ["started_at", "device_id", "ip_address", "tool", "filename", "result", "duration_ms"];

function columns(db, schema) {
  return db.prepare(`PRAGMA ${schema}.table_info(conversions)`).all().map((c) => c.name);
}

/**
 * @param {string} mainPath   the database that is kept (rows are added to it)
 * @param {string} otherPath  the second server's database (read only)
 * @param {{dryRun?: boolean, backup?: boolean, now?: Date}} [opts]
 * @returns {{before: number, other: number, inserted: number, skipped: number, after: number, backup: string|null}}
 */
function merge(mainPath, otherPath, opts) {
  opts = opts || {};
  if (!fs.existsSync(mainPath)) throw new Error(`Main database not found: ${mainPath}`);
  if (!fs.existsSync(otherPath)) throw new Error(`Other database not found: ${otherPath}`);
  if (path.resolve(mainPath).toLowerCase() === path.resolve(otherPath).toLowerCase()) throw new Error("The two paths are the same database");

  const db = new Database(mainPath);
  try {
    // fold any WAL content into the main file first, so the backup is complete
    db.pragma("wal_checkpoint(TRUNCATE)");
    let backup = null;
    if (!opts.dryRun && opts.backup !== false) {
      const stamp = (opts.now || new Date()).toISOString().replace(/[-:]/g, "").replace(/\..*$/, "");
      backup = `${mainPath}.bak-${stamp}`;
      fs.copyFileSync(mainPath, backup);
    }
    db.prepare("ATTACH DATABASE ? AS other").run(otherPath);
    const mainCols = columns(db, "main"), otherCols = new Set(columns(db, "other"));
    if (!mainCols.length) throw new Error("The main database has no conversions table");
    if (!otherCols.size) throw new Error("The other database has no conversions table");
    // copy every column both databases have, except the id
    const cols = mainCols.filter((c) => c !== "id" && otherCols.has(c));
    const ident = IDENTITY.filter((c) => cols.includes(c));
    const exists = ident.map((c) => `m.${c} IS o.${c}`).join(" AND ");
    const fromOther = `FROM other.conversions o WHERE NOT EXISTS (SELECT 1 FROM main.conversions m WHERE ${exists})`;
    const count = (sql) => db.prepare(sql).get().n;

    const before = count("SELECT COUNT(*) AS n FROM main.conversions");
    const other = count("SELECT COUNT(*) AS n FROM other.conversions");
    const toInsert = count(`SELECT COUNT(*) AS n ${fromOther}`);
    if (!opts.dryRun) {
      db.transaction(() => {
        db.prepare(`INSERT INTO main.conversions (${cols.join(", ")}) SELECT ${cols.map((c) => "o." + c).join(", ")} ${fromOther}`).run();
      })();
    }
    const after = count("SELECT COUNT(*) AS n FROM main.conversions");
    db.prepare("DETACH DATABASE other").run();
    return { before, other, inserted: opts.dryRun ? 0 : after - before, wouldInsert: toInsert, skipped: other - toInsert, after, backup };
  } finally {
    db.close();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const [mainPath, otherPath] = args.filter((a) => !a.startsWith("--"));
  if (!mainPath || !otherPath) {
    console.log("Usage: node scripts/merge-analytics-db.js <main.db> <other.db> [--dry-run]");
    console.log("Stop the IIS app pool on both servers first. The main database is backed up before the merge.");
    process.exit(2);
  }
  try {
    const r = merge(mainPath, otherPath, { dryRun });
    console.log(`Main database before : ${r.before} record(s)`);
    console.log(`Other database       : ${r.other} record(s) — ${r.wouldInsert} new, ${r.skipped} already in the main database`);
    if (dryRun) console.log("Dry run — nothing was changed. Run again without --dry-run to merge.");
    else {
      console.log(`Added                : ${r.inserted} record(s)`);
      console.log(`Main database after  : ${r.after} record(s)`);
      console.log(`Backup of the main database: ${r.backup}`);
    }
  } catch (e) {
    console.error("Merge failed — nothing was changed:", e.message);
    process.exit(1);
  }
}

module.exports = { merge };
