'use strict';

/**
 * Script Studio: pageref-based transactions from CDP-Recorder / extension HARs.
 *
 * Real-world report: a user's recording showed a "Launch" transaction in
 * Studio with start/end markers but no requests inside it. Root cause of the
 * EMPTY recording was browsing in the wrong window (fixed in the recorder),
 * but Studio also had its own display bug: detectMarkers() injects markers
 * around ANY entry with a matching pageref — including one later hidden by
 * applyFilters() (e.g. a lone favicon/image) — so a transaction whose only
 * traffic was static noise rendered as a confusing empty start/end pair, and
 * generators would emit an empty lr_start/end_transaction for it.
 *
 * pruneEmptyPagerefTransactions() (run after applyFilters()) removes such
 * synthetic pairs. Explicit bookmarklet markers are never touched.
 *
 * Loads the real constants + correlation files into one Function scope with
 * a minimal S, the same pattern as advisorCsrfScan.test.js.
 */

const fs = require('fs');
const path = require('path');

function loadStudio() {
  const pub = path.resolve(__dirname, '../../src/web/public');
  const constants = fs.readFileSync(path.join(pub, 'VuGen-Script-Studio-constants.js'), 'utf-8');
  const correlation = fs.readFileSync(path.join(pub, 'VuGen-Script-Studio-correlation.js'), 'utf-8');
  // constants.js declares the shared `S` itself — use that one.
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    constants + '\n' + correlation +
      '\nS.filterDomains = {}; S.filterResourceTypes = new Set();' +
      '\nreturn { S, detectMarkers, applyFilters, pruneEmptyPagerefTransactions };',
  );
  return factory();
}

function entry(url, pageref, ct, method = 'GET') {
  return { url, pageref, ct, method, hdrsMap: {}, body: null, isMarker: false };
}

function runPipeline(studio, entries, pages) {
  studio.S.harPages = new Map(Object.entries(pages));
  studio.S.txns = [];
  studio.detectMarkers(entries);
  studio.applyFilters(entries);
  studio.pruneEmptyPagerefTransactions(entries);
  return entries;
}

const markerSummary = (entries) =>
  entries.filter((e) => e.isMarker).map((e) => `${e.markerType}:${e.txnName}`);

describe('Studio pageref transactions (CDP Recorder HARs)', () => {
  test('three transactions with real requests all survive, in order, with correct membership', () => {
    const studio = loadStudio();
    const entries = runPipeline(
      studio,
      [
        entry('https://app.example.com/home', 'tx_1', 'text/html'),
        entry('https://app.example.com/api/ping', 'tx_1', 'application/json'),
        entry('https://app.example.com/roles', 'tx_2', 'text/html'),
        entry('https://app.example.com/api/next', 'tx_3', 'application/json', 'POST'),
      ],
      { tx_1: 'Launch', tx_2: 'role_group', tx_3: 'Click Next' },
    );
    expect(markerSummary(entries)).toEqual([
      'start:Launch', 'end:Launch', 'start:role_group', 'end:role_group', 'start:Click Next', 'end:Click Next',
    ]);
    expect(studio.S.txns.map((t) => t.name)).toEqual(['Launch', 'role_group', 'Click Next']);
    const real = entries.filter((e) => !e.isMarker);
    expect(real.map((e) => e.txn)).toEqual(['Launch', 'Launch', 'role_group', 'Click Next']);
  });

  test('a transaction whose only traffic is filtered static noise is pruned (the empty "Launch" symptom)', () => {
    const studio = loadStudio();
    const entries = runPipeline(
      studio,
      [
        entry('https://app.example.com/favicon.ico', 'tx_1', 'image/x-icon'),
        entry('https://app.example.com/roles', 'tx_2', 'text/html'),
      ],
      { tx_1: 'Launch', tx_2: 'role_group' },
    );
    expect(markerSummary(entries)).toEqual(['start:role_group', 'end:role_group']);
    expect(studio.S.txns.map((t) => t.name)).toEqual(['role_group']);
    // The filtered entry itself stays in the array (Index Rule: never remove entries).
    expect(entries.some((e) => e.url.endsWith('favicon.ico') && e.filtered)).toBe(true);
  });

  test('a transaction with static assets PLUS one real request is kept', () => {
    const studio = loadStudio();
    const entries = runPipeline(
      studio,
      [
        entry('https://app.example.com/logo.png', 'tx_1', 'image/png'),
        entry('https://app.example.com/home', 'tx_1', 'text/html'),
      ],
      { tx_1: 'Launch' },
    );
    expect(markerSummary(entries)).toEqual(['start:Launch', 'end:Launch']);
  });

  test('explicit bookmarklet markers are never pruned, even when empty', () => {
    const studio = loadStudio();
    const entries = runPipeline(
      studio,
      [
        entry('https://START-Login.invalid/', null, ''),
        entry('https://app.example.com/logo.png', null, 'image/png'),
        entry('https://END-Login.invalid/', null, ''),
      ],
      { tx_1: 'Unused' },
    );
    expect(markerSummary(entries)).toEqual(['start:Login', 'end:Login']);
  });
});
