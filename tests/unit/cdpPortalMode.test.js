'use strict';

/**
 * CDP Recorder — recording started from the Recorder page (portal-mode.js).
 *
 * The page starts the recorder through a perfx-recorder: link and drives it over the local control
 * server. These are the pure parts: reading the link, who may call the server, the session request,
 * file names, the Downloads path and the live list rows; a page asking to be allowed on the toolbar
 * (the recorder started by hand) and the remembered allowed pages.
 *
 * Loading: portal-mode.js is an ES module with `export` in front of each declaration — stripped and
 * wrapped in new Function(), as harBuilder.test.js does for har-builder.js.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../cdp-recorder/recorder/src/portal-mode.js');
const P = new Function(fs.readFileSync(SRC, 'utf-8').replace(/^export /gm, '') +
  '\nreturn { LINK_SCHEME, originOf, parsePortalLink, linkCommand, originAccess, harFileName, expandEnv, readSession, liveRow, createAskQueue, readAllowedPages };')();

describe('parsePortalLink — only the portal origin travels in the link', () => {
  test('a start link gives the portal origin, path dropped', () => {
    expect(P.parsePortalLink('perfx-recorder://start?portal=https%3A%2F%2Fperf.example.com%2Fconverter%2F'))
      .toEqual({ action: 'start', portal: 'https://perf.example.com' });
    expect(P.parsePortalLink('perfx-recorder://start/?portal=http://localhost:3999')).toEqual({ action: 'start', portal: 'http://localhost:3999' });
  });
  test('anything else is not ours, or has no usable origin', () => {
    expect(P.parsePortalLink('https://evil.example.com')).toBeNull();
    expect(P.parsePortalLink('')).toBeNull();
    expect(P.parsePortalLink('perfx-recorder://start?portal=javascript:alert(1)').portal).toBeNull();
    expect(P.parsePortalLink('perfx-recorder://start?portal=file:///C:/x').portal).toBeNull();
    expect(P.parsePortalLink('perfx-recorder://start?portal=%E0%A4%A').portal).toBeNull();
  });
  test('origins: lower case, no credentials, no path', () => {
    expect(P.originOf('HTTPS://User:pw@Host.Example.com:8443/a?b')).toBe('https://host.example.com:8443');
    expect(P.originOf('ftp://x')).toBeNull();
  });
  test('the Windows command passes the link as one argument', () => {
    expect(P.linkCommand('C:\\PerfX\\cdp-recorder.exe')).toBe('"C:\\PerfX\\cdp-recorder.exe" --portal "%1"');
    expect(P.LINK_SCHEME).toBe('perfx-recorder');
  });
});

describe('originAccess — who may drive the recorder', () => {
  const portals = new Set(['https://perf.example.com']);
  test('toolbar, local program, allowed portal', () => {
    expect(P.originAccess('http://localhost:8787', 8787, portals)).toBe('self');
    expect(P.originAccess('http://127.0.0.1:8787', 8787, portals)).toBe('self');
    expect(P.originAccess('', 8787, portals)).toBe('local');
    expect(P.originAccess(undefined, 8787, portals)).toBe('local');
    expect(P.originAccess('https://perf.example.com', 8787, portals)).toBe('portal');
  });
  test('any other page is refused — also look-alikes and other ports', () => {
    expect(P.originAccess('https://evil.example.com', 8787, portals)).toBe('other');
    expect(P.originAccess('https://perf.example.com.evil.com', 8787, portals)).toBe('other');
    expect(P.originAccess('http://perf.example.com', 8787, portals)).toBe('other');
    expect(P.originAccess('http://localhost:3000', 8787, portals)).toBe('other');
    expect(P.originAccess('null', 8787, portals)).toBe('other');
  });
});

describe('readSession — the Start recording request', () => {
  test('defaults: Edge, private window', () => {
    expect(P.readSession({ url: 'https://app.example.com/login' }))
      .toEqual({ ok: true, url: 'https://app.example.com/login', browser: 'edge', private: true, name: '', firstTx: '' });
  });
  test('Chrome, normal window, name and first transaction kept', () => {
    expect(P.readSession({ url: ' http://app/x ', browser: 'Chrome', private: false, name: ' SC01 ', firstTx: '01_Launch' }))
      .toMatchObject({ ok: true, url: 'http://app/x', browser: 'chrome', private: false, name: 'SC01', firstTx: '01_Launch' });
  });
  test('refused: no address, other schemes, unknown browser', () => {
    expect(P.readSession({}).ok).toBe(false);
    expect(P.readSession({ url: 'file:///C:/secret' }).ok).toBe(false);
    expect(P.readSession({ url: 'javascript:alert(1)' }).ok).toBe(false);
    expect(P.readSession({ url: 'https://a', browser: 'firefox' }).ok).toBe(false);
  });
});

describe('harFileName and expandEnv — saved to Downloads', () => {
  const d = new Date(2026, 9, 30, 14, 2, 5);
  test('safe name with date and time', () => {
    expect(P.harFileName('SC01 Booking', d)).toBe('SC01_Booking_2026-10-30_140205.har');
    expect(P.harFileName('..\\..\\evil:name', d)).toBe('evil_name_2026-10-30_140205.har');
    expect(P.harFileName('', d)).toBe('Recording_2026-10-30_140205.har');
  });
  test('a redirected Downloads folder is expanded', () => {
    expect(P.expandEnv('%USERPROFILE%\\Downloads', { UserProfile: 'C:\\Users\\a' })).toBe('C:\\Users\\a\\Downloads');
    expect(P.expandEnv('%NOPE%\\x', {})).toBe('%NOPE%\\x');
  });
});

describe('liveRow — the live list on the Recorder page', () => {
  test('a finished request in a transaction', () => {
    const e = { request: { method: 'POST', url: 'https://a/api' }, response: { status: 201, content: { mimeType: 'application/json; charset=utf-8' } },
      _resourceType: 'Fetch', pageref: 'tx_1', _tabId: 's1', _finishedTimestamp: 5 };
    expect(P.liveRow(e, 3, { tx_1: '01_Login' }, false)).toEqual({ n: 3, method: 'POST', url: 'https://a/api', status: 201, type: 'Fetch',
      mime: 'application/json', tx: '01_Login', background: false, tab: 's1', done: true });
  });
  test('still waiting for its response, outside a transaction, background', () => {
    const r = P.liveRow({ request: { method: 'GET', url: 'https://a/poll' }, response: null, pageref: null }, 1, {}, true);
    expect(r).toMatchObject({ status: 0, tx: null, background: true, done: false });
  });
});

describe("createAskQueue — a page asks to be allowed on the toolbar", () => {
  const clock = () => { let t = 1000; return { now: () => t, add: (ms) => { t += ms; } }; };
  test("one question at a time; the same page asking again keeps it", () => {
    const c = clock(), q = P.createAskQueue({ now: c.now });
    expect(q.ask("https://a.example")).toBe("pending");
    expect(q.ask("https://a.example")).toBe("pending");
    expect(q.ask("https://b.example")).toBe("busy");
    expect(q.pending()).toBe("https://a.example");
    expect(q.stateOf("https://a.example")).toBe("pending");
    expect(q.stateOf("https://b.example")).toBe(null);
  });
  test("Allow ends the question; an answer about another page changes nothing", () => {
    const q = P.createAskQueue();
    q.ask("https://a.example");
    expect(q.answer("https://b.example", true)).toBe(false);
    expect(q.pending()).toBe("https://a.example");
    expect(q.answer("https://a.example", true)).toBe(true);
    expect(q.pending()).toBe(null);
    expect(q.stateOf("https://a.example")).toBe(null);
  });
  test("Don't allow: the page is not asked about again for a minute", () => {
    const c = clock(), q = P.createAskQueue({ now: c.now });
    q.ask("https://a.example");
    expect(q.answer("https://a.example", false)).toBe(false);
    expect(q.ask("https://a.example")).toBe("denied");
    expect(q.stateOf("https://a.example")).toBe("denied");
    c.add(61000);
    expect(q.ask("https://a.example")).toBe("pending");
  });
  test("an unanswered question lapses after two minutes, then another page may ask", () => {
    const c = clock(), q = P.createAskQueue({ now: c.now });
    q.ask("https://a.example");
    c.add(121000);
    expect(q.pending()).toBe(null);
    expect(q.answer("https://a.example", true)).toBe(false);
    expect(q.ask("https://b.example")).toBe("pending");
  });
});

describe("readAllowedPages — the remembered pages file", () => {
  test("origins only, paths dropped, duplicates and junk ignored", () => {
    expect(P.readAllowedPages(JSON.stringify({ pages: ["https://perf.example.com/converter/", "https://perf.example.com", "javascript:alert(1)", 5, "http://localhost:3999"] })))
      .toEqual(["https://perf.example.com", "http://localhost:3999"]);
  });
  test("a missing, empty or broken file gives no pages", () => {
    expect(P.readAllowedPages("")).toEqual([]);
    expect(P.readAllowedPages("{not json")).toEqual([]);
    expect(P.readAllowedPages(JSON.stringify({ pages: "https://x" }))).toEqual([]);
  });
});
