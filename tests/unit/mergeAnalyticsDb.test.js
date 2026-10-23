"use strict";

/**
 * scripts/merge-analytics-db.js — merging the second IIS server's analytics database into the main
 * one. Both databases are created by the real src/analytics/db.js, so the schema is the production one.
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
// better-sqlite3 is a native module built for the server's Node version; where it cannot load (e.g. a
// newer local Node), skip rather than fail — run with the server's Node to exercise these tests.
let Database = null;
try { Database = require("better-sqlite3"); new Database(":memory:").close(); } catch (_) { Database = null; }
const describeDb = Database ? describe : describe.skip;
const { merge } = Database ? require("../../scripts/merge-analytics-db") : { merge: null };

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "perfx-merge-"));

/** Create an analytics database at `file` through db.js and insert `events`. */
function makeDb(file, events) {
  jest.isolateModules(() => {
    process.env.ANALYTICS_DB_PATH = file;
    const db = require("../../src/analytics/db");
    for (const e of events) db.insertEvent(e);
  });
  delete process.env.ANALYTICS_DB_PATH;
}
const ev = (over) => Object.assign({
  started_at: "2026-10-20T09:00:00.000Z", ended_at: "2026-10-20T09:00:02.000Z", duration_ms: 2000,
  ip_address: "10.0.0.1", ip_forwarded: null, hostname: "pc1", device_id: "dev-1", browser: "Edge", os: "Windows",
  screen_res: "1920x1080", timezone: "Europe/London", lang: "en-GB", platform: "Win32", tool: "converter", protocol: "devweb",
  script_mode: "single", filename: "a.json", file_ext: ".json", file_size_kb: 10, request_count: 5, result: "success",
  error_code: null, correlations_found: null, correlations_accepted: null,
}, over);
const rows = (file) => { const d = new Database(file, { readonly: true }); try { return d.prepare("SELECT * FROM conversions ORDER BY id").all(); } finally { d.close(); } };

// db.js keeps its connection open for the life of the process; Windows cannot delete an open file
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) { /* left in the OS temp folder */ } });

describeDb("merge-analytics-db", () => {
  test("adds the other server's rows with new ids, keeps every column, and backs up first", () => {
    const main = path.join(dir, "main1.db"), other = path.join(dir, "other1.db");
    makeDb(main, [ev(), ev({ started_at: "2026-10-20T10:00:00.000Z", device_id: "dev-2" })]);
    makeDb(other, [ev({ started_at: "2026-10-21T08:00:00.000Z", tool: "jmx", filename: "plan.jmx", ip_address: "10.0.0.9", result: "error", error_code: "E_PARSE" })]);
    const r = merge(main, other, { now: new Date("2026-10-23T10:00:00Z") });
    expect(r).toMatchObject({ before: 2, other: 1, inserted: 1, skipped: 0, after: 3 });
    expect(fs.existsSync(r.backup)).toBe(true);
    expect(rows(r.backup)).toHaveLength(2); // the backup is the main database before the merge
    const all = rows(main);
    expect(all.map((x) => x.id)).toEqual([1, 2, 3]);
    expect(all[2]).toMatchObject({ tool: "jmx", filename: "plan.jmx", ip_address: "10.0.0.9", result: "error", error_code: "E_PARSE", hostname: "pc1" });
  });

  test("running it twice does not double-count", () => {
    const main = path.join(dir, "main2.db"), other = path.join(dir, "other2.db");
    makeDb(main, [ev()]);
    makeDb(other, [ev({ device_id: "dev-9" }), ev({ device_id: "dev-9", started_at: "2026-10-22T09:00:00.000Z" })]);
    expect(merge(main, other, { backup: false })).toMatchObject({ inserted: 2, after: 3 });
    expect(merge(main, other, { backup: false })).toMatchObject({ inserted: 0, skipped: 2, after: 3 });
  });

  test("an identical record already in the main database is skipped (null columns compare equal)", () => {
    const main = path.join(dir, "main3.db"), other = path.join(dir, "other3.db");
    makeDb(main, [ev({ filename: null })]);
    makeDb(other, [ev({ filename: null }), ev({ filename: null, duration_ms: 999 })]);
    expect(merge(main, other, { backup: false })).toMatchObject({ inserted: 1, skipped: 1, after: 2 });
  });

  test("dry run changes nothing and makes no backup", () => {
    const main = path.join(dir, "main4.db"), other = path.join(dir, "other4.db");
    makeDb(main, [ev()]);
    makeDb(other, [ev({ device_id: "x" })]);
    expect(merge(main, other, { dryRun: true })).toMatchObject({ before: 1, wouldInsert: 1, inserted: 0, after: 1, backup: null });
    expect(rows(main)).toHaveLength(1);
  });

  test("refuses a missing file or the same file twice", () => {
    const main = path.join(dir, "main5.db");
    makeDb(main, [ev()]);
    expect(() => merge(main, path.join(dir, "nope.db"))).toThrow(/not found/);
    expect(() => merge(main, main)).toThrow(/same database/);
  });
});
