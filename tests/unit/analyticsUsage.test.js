'use strict';

/**
 * Usage analytics: Results Analyser / Recorder events, and the report sections built from them (tools, machines, problems, uses per day).
 * Uses a throwaway SQLite database; skipped when better-sqlite3 cannot load on this Node version.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

let Database = null;
try { Database = require('better-sqlite3'); new Database(':memory:').close(); } catch (_) { Database = null; }
const describeDb = Database ? describe : describe.skip;

const DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'perfx-usage-'));
process.env.ANALYTICS_DB_PATH = path.join(DIR, 'usage.db');

describeDb('reports.getStats() — tools, people, problems, uses per day', () => {
  const db = require('../../src/analytics/db');
  const reports = require('../../src/analytics/reports');
  const ev = (o) => Object.assign({
    started_at: '2026-10-05T10:00:00.000Z', ended_at: null, duration_ms: 1000, ip_address: '192.0.2.10', ip_forwarded: null,
    hostname: 'ws-perf-01', device_id: null, browser: null, os: null, screen_res: null, timezone: null, lang: null,
    platform: null, tool: 'studio', protocol: 'devweb', script_mode: null, filename: 'a.har', file_ext: '.har', file_size_kb: 10,
    request_count: 5, result: 'success', error_code: null, correlations_found: null, correlations_accepted: null,
  }, o);

  beforeAll(() => {
    db.insertEvent(ev({ tool: 'analyser', protocol: null, filename: 'Run_1.zip', request_count: 12, duration_ms: 90000 }));
    db.insertEvent(ev({ tool: 'recorder', protocol: 'vugen', started_at: '2026-10-07T09:00:00.000Z' }));
    db.insertEvent(ev({ hostname: 'ws-perf-02', ip_address: '192.0.2.11', tool: 'analyser', protocol: null, result: 'failed', error_code: 'rawdata_missing' }));
    db.insertEvent(ev({ hostname: 'ws-perf-03', ip_address: '192.0.2.12', tool: 'converter', result: 'failed', error_code: 'parse_error' }));
  });

  test('the Results Analyser is a tool in the report, with its own figures', () => {
    const s = reports.getStats({ from: '2026-10-01', to: '2026-10-10' });
    const a = s.toolSummaryRows.find((t) => t.tool === 'analyser');
    expect(a.label).toBe('Results Analyser');
    expect(a.count).toBe(2);
    expect(a.successRate).toBe(50);
    expect(s.toolSummaryRows.map((t) => t.tool)).toEqual(['recorder', 'converter', 'analyser']);   // sidebar order
  });

  test('who uses it: one row per machine (host name, else IP address), with its tools', () => {
    const s = reports.getStats({ from: '2026-10-01', to: '2026-10-10' });
    expect(s.uniquePeople).toBe(3);            // ws-perf-01, ws-perf-02, ws-perf-03
    const one = s.peopleRows.find((p) => p.machine === 'ws-perf-01');
    expect(one.count).toBe(2);
    expect(one.ip_address).toBe('192.0.2.10');
    expect(one.tools).toEqual(['Recorder', 'Results Analyser']);
    expect(s.peopleRows.map((p) => p.machine).sort()).toEqual(['ws-perf-01', 'ws-perf-02', 'ws-perf-03']);
  });

  test('problems are grouped by cause, with a readable label', () => {
    const s = reports.getStats({ from: '2026-10-01', to: '2026-10-10' });
    const codes = s.problemRows.map((p) => p.code).sort();
    expect(codes).toEqual(['parse_error', 'rawdata_missing']);
    expect(s.problemRows.find((p) => p.code === 'rawdata_missing').label).toBe('RawData.eve not in the folder');
  });

  test('uses per day cover every day of the period, zero days included', () => {
    const s = reports.getStats({ from: '2026-10-01', to: '2026-10-10' });
    expect(s.dailyTools.days.length).toBe(10);
    s.dailyTools.series.forEach((x) => expect(x.counts.length).toBe(10));
    const total = s.dailyTools.series.reduce((a, x) => a + x.counts.reduce((b, n) => b + n, 0), 0);
    expect(total).toBe(s.total);
  });

  test('event search finds a machine and a file', () => {
    expect(db.queryEvents({ search: 'ws-perf-02' }).total).toBe(1);
    expect(db.queryEvents({ search: 'Run_1' }).total).toBe(1);
  });
});
