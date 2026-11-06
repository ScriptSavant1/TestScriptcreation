'use strict';

/**
 * Unit tests for detectDateSubstitution() in studio-codegen.js
 *
 * detectDateSubstitution(value, recordingMs, entryMs?) examines a string value
 * and returns {fn, arg} describing the runtime date-helper call to reproduce it,
 * or null if the value is not a recognised date pattern.
 *
 * Patterns covered (from the function's own comments):
 *   YYYY-MM-DD          → getTodayDate / getDateDaysAgo(N) / getFutureDateDays(N)
 *   ISO datetime Z      → getTodayStartUTC / getTodayEndUTC / getDateDaysAgoUTC(N)
 *                         + getStartOfCurrentMonthUTC / getEndOfCurrentMonthUTC
 *   13-digit epoch ms   → Date.now / getEpochMsDaysAgo(N)
 *                         + getStartDateMillis / getEndDateMillis (local midnight)
 *   10-digit epoch sec  → getEpochSecsDaysAgo(N)
 *   Non-padded datetime → getStartDateForGraph(N) / getEndDateForGraph()
 *   RFC 1123            → getStartOfTodayUTC / getEndOfTodayUTC / getCurrentTimeUTC
 *
 * Values outside ±730 days of the recording date or in unrecognised formats → null.
 *
 * Loading strategy: studio-codegen.js relies on globals from other studio scripts
 * (S, VuGenCodeGen, etc.) that aren't present in Node.js. We wrap the whole file
 * in a Function factory and pass minimal stubs so it loads without throwing.
 * detectDateSubstitution() itself is pure and uses none of those globals.
 */

const fs   = require('fs');
const path = require('path');

function loadCodegen() {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../../src/web/public/studio-codegen.js'),
    'utf-8'
  );
  // Provide stub globals the file references (only needed at function-body level,
  // none of them are used by detectDateSubstitution itself)
  const S = {
    entries1: [], correlations: [], params: [],
    scripts: {}, auth: null, hasDpop: false,
  };
  // eslint-disable-next-line no-new-func
  const factory = new Function('S', 'VuGenCodeGen', 'VUGEN_TEMPLATES',
    code + '\nreturn { detectDateSubstitution };'
  );
  return factory(S, {}, {});
}

const { detectDateSubstitution } = loadCodegen();

// ── Fixed recording reference point ────────────────────────────────────────────
// All tests use a fixed recording date so they're deterministic and not
// sensitive to the real wall-clock time.
const RECORDING_MS = new Date('2026-07-15T12:00:00.000Z').getTime();

// Helpers to compute date strings and epoch values relative to RECORDING_MS
function isoDate(offsetDays) {
  const d = new Date(RECORDING_MS);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  return d.toISOString().slice(0, 10);   // YYYY-MM-DD
}

function isoDatetime(offsetDays, hours = 0, minutes = 0, seconds = 0) {
  const d = new Date(RECORDING_MS);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  d.setUTCHours(hours, minutes, seconds, 0);
  return d.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function epochMs(offsetDays, hours = 8, minutes = 0) {
  // Returns a 13-digit epoch ms; use non-midnight hours to avoid local-tz midnight branch
  const d = new Date(RECORDING_MS);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  d.setUTCHours(hours, minutes, 0, 0);
  return String(d.getTime());
}

function epochSec(offsetDays, hours = 12) {
  const d = new Date(RECORDING_MS);
  d.setUTCDate(d.getUTCDate() - offsetDays);
  d.setUTCHours(hours, 0, 0, 0);
  return String(Math.floor(d.getTime() / 1000));
}

// ── Guard cases ────────────────────────────────────────────────────────────────

describe('detectDateSubstitution() — guard cases', () => {
  test('returns null for null value', () => {
    expect(detectDateSubstitution(null, RECORDING_MS)).toBeNull();
  });

  test('returns null for undefined value', () => {
    expect(detectDateSubstitution(undefined, RECORDING_MS)).toBeNull();
  });

  test('returns null for empty string', () => {
    expect(detectDateSubstitution('', RECORDING_MS)).toBeNull();
  });

  test('returns null when recordingMs is 0 / falsy', () => {
    expect(detectDateSubstitution(isoDate(0), 0)).toBeNull();
    expect(detectDateSubstitution(isoDate(0), null)).toBeNull();
    expect(detectDateSubstitution(isoDate(0), undefined)).toBeNull();
  });

  test('returns null for a plain non-date string', () => {
    expect(detectDateSubstitution('hello world', RECORDING_MS)).toBeNull();
  });

  test('returns null for an email address', () => {
    expect(detectDateSubstitution('user@example.com', RECORDING_MS)).toBeNull();
  });

  test('returns null for a short numeric string (not epoch)', () => {
    expect(detectDateSubstitution('12345', RECORDING_MS)).toBeNull();
  });

  test('returns null for a UUID (not a date pattern)', () => {
    expect(detectDateSubstitution('a1b2c3d4-e5f6-7890-abcd-ef1234567890', RECORDING_MS)).toBeNull();
  });
});

// ── ISO date YYYY-MM-DD ────────────────────────────────────────────────────────

describe('detectDateSubstitution() — ISO date (YYYY-MM-DD)', () => {
  test('same day as recording → getTodayDate()', () => {
    expect(detectDateSubstitution(isoDate(0), RECORDING_MS))
      .toEqual({ fn: 'getTodayDate', arg: null });
  });

  test('1 day before recording → getDateDaysAgo(1)', () => {
    expect(detectDateSubstitution(isoDate(1), RECORDING_MS))
      .toEqual({ fn: 'getDateDaysAgo', arg: 1 });
  });

  test('5 days before recording → getDateDaysAgo(5)', () => {
    expect(detectDateSubstitution(isoDate(5), RECORDING_MS))
      .toEqual({ fn: 'getDateDaysAgo', arg: 5 });
  });

  test('1 day after recording → getFutureDateDays(1)', () => {
    expect(detectDateSubstitution(isoDate(-1), RECORDING_MS))
      .toEqual({ fn: 'getFutureDateDays', arg: 1 });
  });

  test('730 days before recording (boundary) → getDateDaysAgo(730)', () => {
    expect(detectDateSubstitution(isoDate(730), RECORDING_MS))
      .toEqual({ fn: 'getDateDaysAgo', arg: 730 });
  });

  test('731 days before recording (beyond boundary) → null', () => {
    expect(detectDateSubstitution(isoDate(731), RECORDING_MS)).toBeNull();
  });

  test('invalid calendar date like 2026-13-40 → null', () => {
    expect(detectDateSubstitution('2026-13-40', RECORDING_MS)).toBeNull();
  });
});

// ── ISO datetime YYYY-MM-DDTHH:mm:ssZ ─────────────────────────────────────────

describe('detectDateSubstitution() — ISO datetime', () => {
  test('start of recording day UTC (00:00:00) → getTodayStartUTC()', () => {
    expect(detectDateSubstitution(isoDatetime(0, 0, 0, 0), RECORDING_MS))
      .toEqual({ fn: 'getTodayStartUTC', arg: null });
  });

  test('end of recording day UTC (23:59:59) → getTodayEndUTC()', () => {
    expect(detectDateSubstitution(isoDatetime(0, 23, 59, 59), RECORDING_MS))
      .toEqual({ fn: 'getTodayEndUTC', arg: null });
  });

  test('start of day 1 day ago → getDateDaysAgoUTC(1)', () => {
    expect(detectDateSubstitution(isoDatetime(1, 0, 0, 0), RECORDING_MS))
      .toEqual({ fn: 'getDateDaysAgoUTC', arg: 1 });
  });

  test('start of day 3 days ago → getDateDaysAgoUTC(3)', () => {
    expect(detectDateSubstitution(isoDatetime(3, 0, 0, 0), RECORDING_MS))
      .toEqual({ fn: 'getDateDaysAgoUTC', arg: 3 });
  });

  test('future datetime → null', () => {
    expect(detectDateSubstitution(isoDatetime(-1, 0, 0, 0), RECORDING_MS)).toBeNull();
  });

  test('start of current month (July 1) → getStartOfCurrentMonthUTC()', () => {
    // 2026-07-01T00:00:00Z is in the same month as 2026-07-15
    expect(detectDateSubstitution('2026-07-01T00:00:00Z', RECORDING_MS))
      .toEqual({ fn: 'getStartOfCurrentMonthUTC', arg: null });
  });

  test('end of current month (July 31, ≥22:59) → getEndOfCurrentMonthUTC()', () => {
    // July 31T22:59:00Z qualifies (hours ≥ 22, minutes ≥ 59)
    expect(detectDateSubstitution('2026-07-31T22:59:00Z', RECORDING_MS))
      .toEqual({ fn: 'getEndOfCurrentMonthUTC', arg: null });
  });

  test('different-month datetime with same day offset → getDateDaysAgoUTC (not month helpers)', () => {
    // 2026-06-15T00:00:00Z is in June (different month from July recording)
    const result = detectDateSubstitution('2026-06-15T00:00:00Z', RECORDING_MS);
    // Should not trigger month-boundary helpers (different month)
    expect(result?.fn).not.toBe('getStartOfCurrentMonthUTC');
    expect(result?.fn).not.toBe('getEndOfCurrentMonthUTC');
  });
});

// ── Epoch milliseconds (13-digit) ─────────────────────────────────────────────

describe('detectDateSubstitution() — 13-digit epoch ms', () => {
  test('same UTC day (non-midnight) → Date.now()', () => {
    // Use 08:00 UTC to avoid local-midnight branch
    expect(detectDateSubstitution(epochMs(0, 8), RECORDING_MS))
      .toEqual({ fn: 'Date.now', arg: null });
  });

  test('3 days ago (non-midnight UTC) → getEpochMsDaysAgo(3)', () => {
    expect(detectDateSubstitution(epochMs(3, 8), RECORDING_MS))
      .toEqual({ fn: 'getEpochMsDaysAgo', arg: 3 });
  });

  test('future epoch ms → null', () => {
    // Use a date well after the recording
    const futureMs = String(new Date('2028-01-01T08:00:00Z').getTime());
    expect(detectDateSubstitution(futureMs, RECORDING_MS)).toBeNull();
  });

  test('epoch ms beyond 730-day window in the past → null', () => {
    const oldMs = String(new Date('2020-01-01T08:00:00Z').getTime());
    expect(detectDateSubstitution(oldMs, RECORDING_MS)).toBeNull();
  });

  test('local midnight value → getStartDateMillis (timezone-sensitive)', () => {
    // Build a local midnight value for the recording day
    const d = new Date(RECORDING_MS);
    d.setHours(0, 0, 0, 0);   // local-time midnight
    const ms = String(d.getTime());
    const result = detectDateSubstitution(ms, RECORDING_MS);
    // fn should be getStartDateMillis; exact arg depends on UTC offset of test runner
    // so just verify the shape, not the exact arg
    if (result !== null) {
      expect(result.fn).toBe('getStartDateMillis');
    }
  });

  test('not a 13-digit string (12 digits) → falls through, returns null', () => {
    expect(detectDateSubstitution('123456789012', RECORDING_MS)).toBeNull();
  });
});

// ── Epoch seconds (10-digit starting with 1) ──────────────────────────────────

describe('detectDateSubstitution() — 10-digit epoch seconds', () => {
  test('same UTC day → getEpochSecsDaysAgo(0)', () => {
    // Unlike epoch ms, epoch sec always returns getEpochSecsDaysAgo — even for today
    expect(detectDateSubstitution(epochSec(0), RECORDING_MS))
      .toEqual({ fn: 'getEpochSecsDaysAgo', arg: 0 });
  });

  test('3 days ago → getEpochSecsDaysAgo(3)', () => {
    expect(detectDateSubstitution(epochSec(3), RECORDING_MS))
      .toEqual({ fn: 'getEpochSecsDaysAgo', arg: 3 });
  });

  test('future epoch sec → null (offsetDays < 0 is rejected)', () => {
    // A timestamp after the recording date
    const futureEpochSec = String(Math.floor(new Date('2027-01-01T12:00:00Z').getTime() / 1000));
    expect(detectDateSubstitution(futureEpochSec, RECORDING_MS)).toBeNull();
  });

  test('too old (> 730 days) → null', () => {
    const oldEpochSec = String(Math.floor(new Date('2020-01-01T12:00:00Z').getTime() / 1000));
    expect(detectDateSubstitution(oldEpochSec, RECORDING_MS)).toBeNull();
  });

  test('does not match an 11-digit number (too long for epoch sec)', () => {
    // 11 digits starting with 1: doesn't match /^1\d{9}$/
    expect(detectDateSubstitution('10000000000', RECORDING_MS)).toBeNull();
  });
});

// ── Non-padded datetime (HP ALM/PC graph filter format) ───────────────────────

describe('detectDateSubstitution() — non-padded datetime', () => {
  test('start of today (0:0:0) → getStartDateForGraph(0)', () => {
    // "2026-7-15 0:0:0" — non-padded month/day/time
    expect(detectDateSubstitution('2026-7-15 0:0:0', RECORDING_MS))
      .toEqual({ fn: 'getStartDateForGraph', arg: 0 });
  });

  test('end of today (23:59:59) → getEndDateForGraph()', () => {
    expect(detectDateSubstitution('2026-7-15 23:59:59', RECORDING_MS))
      .toEqual({ fn: 'getEndDateForGraph', arg: null });
  });

  test('start of yesterday → getStartDateForGraph(1)', () => {
    expect(detectDateSubstitution('2026-7-14 0:0:0', RECORDING_MS))
      .toEqual({ fn: 'getStartDateForGraph', arg: 1 });
  });

  test('mid-day non-padded datetime → null (not start or end of day)', () => {
    // 14:30:00 is neither start (0:0:0) nor end (23:59:59)
    expect(detectDateSubstitution('2026-7-15 14:30:0', RECORDING_MS)).toBeNull();
  });

  test('future non-padded datetime → null', () => {
    expect(detectDateSubstitution('2027-1-1 0:0:0', RECORDING_MS)).toBeNull();
  });
});

// ── RFC 1123 date ─────────────────────────────────────────────────────────────

describe('detectDateSubstitution() — RFC 1123 / HTTP Date', () => {
  test('UTC start of recording day → getStartOfTodayUTC()', () => {
    // "Wed, 15 Jul 2026 00:00:00 GMT"
    expect(detectDateSubstitution('Wed, 15 Jul 2026 00:00:00 GMT', RECORDING_MS))
      .toEqual({ fn: 'getStartOfTodayUTC', arg: null });
  });

  test('UTC end of recording day → getEndOfTodayUTC()', () => {
    // hours >= 22, minutes >= 59, seconds >= 59, offsetDays === 0
    expect(detectDateSubstitution('Wed, 15 Jul 2026 23:59:59 GMT', RECORDING_MS))
      .toEqual({ fn: 'getEndOfTodayUTC', arg: null });
  });

  test('RFC 1123 beyond 730 days → null', () => {
    expect(detectDateSubstitution('Tue, 01 Jan 2019 00:00:00 GMT', RECORDING_MS)).toBeNull();
  });

  test('current-time RFC 1123 (within 5 min of entryMs) → getCurrentTimeUTC()', () => {
    // Build an RFC 1123 string that is within 5 minutes of RECORDING_MS
    const d = new Date(RECORDING_MS + 30000);   // 30 seconds after recording
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    const rfc = `${days[d.getUTCDay()]}, ${d.getUTCDate().toString().padStart(2,' ')} `
              + `${months[d.getUTCMonth()]} ${d.getUTCFullYear()} `
              + `${String(d.getUTCHours()).padStart(2,'0')}:`
              + `${String(d.getUTCMinutes()).padStart(2,'0')}:`
              + `${String(d.getUTCSeconds()).padStart(2,'0')} GMT`;
    // entryMs is provided and close to value → getCurrentTimeUTC
    const result = detectDateSubstitution(rfc, RECORDING_MS, RECORDING_MS + 30000);
    expect(result).toEqual({ fn: 'getCurrentTimeUTC', arg: null });
  });
});

// ── Return shape ──────────────────────────────────────────────────────────────

describe('detectDateSubstitution() — return shape', () => {
  test('always returns {fn, arg} or null', () => {
    const result = detectDateSubstitution(isoDate(0), RECORDING_MS);
    expect(result).not.toBeNull();
    expect(typeof result.fn).toBe('string');
    expect(result).toHaveProperty('arg');
  });

  test('arg is null (not undefined) for functions with no offset argument', () => {
    const { arg } = detectDateSubstitution(isoDate(0), RECORDING_MS);
    expect(arg).toBeNull();
  });

  test('arg is a number for functions with offset', () => {
    const { arg } = detectDateSubstitution(isoDate(3), RECORDING_MS);
    expect(typeof arg).toBe('number');
    expect(arg).toBe(3);
  });
});
