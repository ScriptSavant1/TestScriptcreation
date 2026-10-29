'use strict';

/**
 * Recorder redesign (src/web/public/Recorder.html) — guards that the new page
 * runs the SAME engine as the classic page (VuGen-Recorder.html):
 *
 *  1. portal/recorder-core.js holds verbatim copies of the engine functions the
 *     classic page keeps in its inline script (marker detection, classification,
 *     filters). If one copy is edited without the other, this test fails.
 *  2. Recorder.html loads the classic engine files unchanged, in the same order.
 *  3. The ids that the engine functions and the golden-output harness read
 *     (f-static, f-noise, f-opts, txn-inp, …) exist on the new page.
 *  4. The new page's own logic (portal/recorder-ui.js): manual-transaction
 *     create / rename / ungroup / replay after a format change, the resource-type
 *     chips, "why is this request left out", and the preview colouring that must
 *     never change the script text.
 */

const fs = require('fs');
const path = require('path');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/\r\n/g, '\n');

/** Source of `function name(...) { ... }` by brace matching (strings/regex in these bodies are brace-balanced). */
function fnSource(src, name) {
  const start = src.indexOf('function ' + name + '(');
  if (start < 0) return null;
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return null;
}

describe('Recorder redesign — engine parity with the classic page', () => {
  const classic = read('VuGen-Recorder.html');
  const core = read('portal/recorder-core.js');
  const page = read('Recorder.html');

  // applyFilters is this page's own since the type buttons replaced the "Static assets" tick box —
  // its default result is checked against the classic rule further down
  test.each(['detectMarkers', '_recInjectPagerefMarkers', '_makeRecMarker', 'classifyHarEntry', 'refresh'])(
    '%s is identical in recorder-core.js and VuGen-Recorder.html', (name) => {
      const a = fnSource(classic, name), b = fnSource(core, name);
      expect(a).not.toBeNull();
      expect(b).toBe(a);
    });

  test('Recorder.html loads the classic engine files unchanged, in the same order', () => {
    const scripts = (html) => [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1]).filter((src) => src !== 'portal/frame-guard.js');
    const engine = scripts(classic);
    const mine = scripts(page);
    expect(mine.slice(0, engine.length)).toEqual(engine);
    expect(mine.slice(engine.length)).toEqual(['portal/recorder-core.js', 'portal/drop-anywhere.js', 'portal/track.js', 'portal/recorder-ui.js']);
  });

  test.each(['f-noise', 'f-opts', 'txn-inp', 'tbody', 'code-body', 'dp-list', 'dp-title', 'stats', 'hf', 'dz', 'welcome', 'main',
    'netlog-banner', 'auth-badge', 'sel-cnt', 'btn-sel', 'rec-rt-bar', 'cdp-dl', 'fc-webhttp', 'fc-devweb', 'fc-both', 'fmt-cancel-btn', 'toast-container',
    'req-note', 'btn-show-out', 'host-dlg', 'host-inp', 'host-err', 'host-ok', 'host-default', 'confirm-list'])(
    'Recorder.html has #%s', (id) => {
      expect(page).toContain('id="' + id + '"');
    });

  test('analytics and OPTIONS start ticked; JS, CSS, Img and Font start off (what "Static assets" left out)', () => {
    ['f-noise', 'f-opts'].forEach((id) => expect(page).toMatch(new RegExp('id="' + id + '"[^>]*checked')));
    expect(page).not.toContain('id="f-static"');
    const pressed = Object.fromEntries([...page.matchAll(/data-key="(\w+)"[^>]*aria-pressed="(true|false)"/g)].map((m) => [m[1], m[2] === 'true']));
    expect(pressed).toEqual({ document: true, fetch: true, script: false, stylesheet: false, image: false, font: false, media: true, other: true });
    const S = new Function(read('VuGen-Recorder-state.js') + '\nreturn S;')();
    expect([...S.typeOff].sort()).toEqual(['font', 'image', 'script', 'stylesheet']);
  });

  test('both Recorder pages load the server-parameter module after page-resources', () => {
    [classic, page].forEach((html) => expect(html).toContain('<script src="shared/page-resources.js"></script>\n<script src="shared/host-params.js"></script>'));
  });

  test('bookmarklets are byte-identical to the classic page', () => {
    const bm = (html) => [...html.matchAll(/href="(javascript:[^"]+)"/g)].map((m) => m[1]).filter((src) => src !== 'portal/frame-guard.js');
    expect(bm(page)).toEqual(bm(classic));
    expect(bm(page)).toHaveLength(2);
  });
});

// ── the new page's own logic ────────────────────────────────────────────────
function loadUi(opts = {}) {
  const state = read('VuGen-Recorder-state.js');
  const hostParams = read('shared/host-params.js');
  const core = read('portal/recorder-core.js');
  const ui = read('portal/recorder-ui.js');
  const logic = ui.slice(0, ui.indexOf('// WIRING'));        // everything except the DOM wiring
  const checks = Object.assign({ 'f-noise': true, 'f-opts': true }, opts.checks);
  const document = {
    getElementById: (id) => (id in checks ? { checked: checks[id] } : null),
    querySelector: () => null,
    querySelectorAll: () => [],
    documentElement: { setAttribute() {}, getAttribute: () => 'dark', classList: { add() {} } },
    // just enough DOM for the preview colouring (_highlight builds text nodes and spans)
    createDocumentFragment: () => ({ parts: [], appendChild(n) { this.parts.push(n); return n; } }),
    createTextNode: (text) => ({ text }),
    createElement: () => ({ className: '', textContent: '' }),
  };
  const localStorage = { getItem: () => null, setItem() {} };
  const calls = { regen: 0, refresh: 0 };
  // eslint-disable-next-line no-new-func
  const window = {};
  const factory = new Function('document', 'localStorage', 'calls', 'window',
    state + '\n' + hostParams + '\nvar HostParams = window.HostParams;\n' + core +
    '\nfunction esc(s){ return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }' +
    '\nfunction buildScripts(){ calls.regen++; } function renderTable(){} function renderStats(){} function showScript(){} function refresh(){ calls.refresh++; }' +
    '\nfunction _recReservedNames(){ return ["AccessToken"]; }' +
    '\n' + logic.replace(/function _regen\(\) \{[^}]*\}/, 'function _regen(){ calls.regen++; }') +
    '\nreturn { S, COLORS, _createTxn, _renameTxn, _ungroupTxn, _txnSnapshot, _txnRestore, _replayTxnLog, setRecorderRt, _whyLeftOut, _splitUrl, _highlight,' +
    ' applyFilters, recTypeKey, recLeftOut, _outSummary, _domainNeeds, _typeCounts, _repairOrphanEnds, STATIC_CT, STATIC_EXT,' +
    ' get log(){ return _txnLog; }, set log(v){ _txnLog = v; } };');
  return Object.assign(factory(document, localStorage, calls, window), { calls });
}

function req(id, extra) {
  return Object.assign({ id, url: 'https://app.example.com/p' + id, method: 'GET', status: 200, ct: 'application/json',
    hdrsMap: {}, body: null, isMarker: false, txn: null, filtered: false }, extra);
}
function marker(type, name) { return { id: -1, url: '', isMarker: true, markerType: type, txnName: name, txn: null }; }
const shape = (S) => S.entries.map((e) => (e.isMarker ? (e.markerType === 'start' ? '[' : ']') + e.txnName : e.id + (e.txn ? ':' + e.txn : '')));

describe('Recorder redesign — manual transactions', () => {
  test('create: START before the first selected request, END after the last; only selected requests are tagged (classic behaviour)', () => {
    const r = loadUi();
    r.S.entries = [req(1), req(2), req(3), req(4)];
    expect(r._createTxn('T01_A', [2, 4])).toBe(true);
    expect(shape(r.S)).toEqual(['1', '[T01_A', '2:T01_A', '3', '4:T01_A', ']T01_A']);
    expect(r.S.txns.map((t) => t.name)).toEqual(['T01_A']);
    expect(r.S.colorMap.T01_A).toBe(r.COLORS[0]);
  });

  test('rename updates markers, requests, the transaction list, colours and collapse state', () => {
    const r = loadUi();
    r.S.entries = [marker('start', 'T01_A'), req(1, { txn: 'T01_A' }), marker('end', 'T01_A')];
    r.S.txns = [{ name: 'T01_A', color: r.COLORS[0] }]; r.S.colorMap = { T01_A: r.COLORS[0] }; r.S.collapsed = { T01_A: true };
    r._renameTxn('T01_A', 'T01_B');
    expect(shape(r.S)).toEqual(['[T01_B', '1:T01_B', ']T01_B']);
    expect(r.S.txns[0].name).toBe('T01_B');
    expect(r.S.colorMap).toEqual({ T01_B: r.COLORS[0] });
    expect(r.S.collapsed).toEqual({ T01_B: true });
  });

  test('ungroup removes the markers; requests move to the surrounding transaction', () => {
    const r = loadUi();
    r.S.entries = [marker('start', 'OUT'), req(1, { txn: 'OUT' }), marker('start', 'IN'), req(2, { txn: 'IN' }), marker('end', 'IN'), marker('end', 'OUT'), req(3)];
    r.S.txns = [{ name: 'OUT' }, { name: 'IN' }]; r.S.colorMap = { OUT: 1, IN: 2 };
    r._ungroupTxn('IN');
    expect(shape(r.S)).toEqual(['[OUT', '1:OUT', '2:OUT', ']OUT', '3']);
    expect(r.S.txns.map((t) => t.name)).toEqual(['OUT']);
    expect(r.S.colorMap).toEqual({ OUT: 1 });
  });

  test('undo restores entries, names and the edit log exactly', () => {
    const r = loadUi();
    r.S.entries = [req(1), req(2)];
    const snap = r._txnSnapshot();
    r._createTxn('T01_A', [1, 2]); r.log.push({ op: 'create' });
    r._renameTxn('T01_A', 'T01_B');
    r._txnRestore(snap);
    expect(shape(r.S)).toEqual(['1', '2']);
    expect(r.S.txns).toEqual([]);
    expect(r.log).toHaveLength(0);
  });

  test('replay after a format change re-applies create, rename and ungroup, and skips edits that no longer fit', () => {
    const r = loadUi();
    r.S.entries = [marker('start', 'REC'), req(1, { txn: 'REC' }), marker('end', 'REC'), req(2), req(3), req(4)];
    r.S.txns = [{ name: 'REC' }]; r.S.colorMap = { REC: 1 };
    r.log = [];
    const kept = r._replayTxnLog([
      { op: 'create', name: 'T09_Manual', ids: [2, 3] },
      { op: 'rename', from: 'T09_Manual', to: 'T09_Basket' },
      { op: 'ungroup', name: 'REC' },
      { op: 'create', name: 'GONE', ids: [99] },              // request no longer exists
    ]);
    expect(kept).toBe(1);
    expect(shape(r.S)).toEqual(['1', '[T09_Basket', '2:T09_Basket', '3:T09_Basket', ']T09_Basket', '4']);
    expect(r.log.map((o) => o.op)).toEqual(['create', 'rename', 'ungroup']);
  });
});

describe('Recorder — transaction whose START is missing', () => {
  test('an END without a START starts where the previous transaction ended; numbering follows the start order', () => {
    const r = loadUi();
    r.S.entries = [req(1), req(2), marker('end', 't01_login'), marker('start', 't02_home'), req(3, { txn: 't02_home' }), marker('end', 't02_home'),
      req(4), marker('end', 't03_out')];
    r.S.txns = [{ name: 't02_home', color: r.COLORS[0] }]; r.S.colorMap = { t02_home: r.COLORS[0] };
    expect(r._repairOrphanEnds()).toBe(2);
    expect(shape(r.S)).toEqual(['[t01_login', '1:t01_login', '2:t01_login', ']t01_login', '[t02_home', '3:t02_home', ']t02_home', '[t03_out', '4:t03_out', ']t03_out']);
    expect(r.S.txns.map((t) => t.name)).toEqual(['t01_login', 't02_home', 't03_out']);
    expect(r.S.colorMap.t02_home).toBe(r.COLORS[0]);
    expect(r._repairOrphanEnds()).toBe(0);                            // nothing left to repair
  });
});

describe('Recorder redesign — filters and preview', () => {
  test('type buttons: a click turns that type on or off; every type off at once is refused', () => {
    const r = loadUi();
    r.setRecorderRt('stylesheet');                                   // CSS starts off -> on
    expect([...r.S.typeOff].sort()).toEqual(['font', 'image', 'script']);
    r.setRecorderRt('fetch');                                        // Fetch/XHR on -> off
    expect(r.S.typeOff.has('fetch')).toBe(true);
    ['document', 'stylesheet', 'media'].forEach((k) => r.setRecorderRt(k));
    expect(r.S.typeOff.size).toBe(7);                                // only Other is still on
    r.setRecorderRt('other');                                        // the last one: refused
    expect(r.S.typeOff.has('other')).toBe(false);
    r.setRecorderRt('nonsense');
    expect(r.calls.refresh).toBe(5);
  });

  // The classic "Static assets" rule, applied before analytics and the old type chips (all on by default)
  const classicStatic = (r, e) => r.STATIC_CT.has(e.ct) || r.STATIC_EXT.test(e.url.split('?')[0]);
  const SAMPLES = [
    ['/a.css', 'text/css', 'stylesheet'], ['/a.js', 'application/javascript', 'script'], ['/a.js', 'text/javascript', ''],
    ['/a.png', 'image/png', 'image'], ['/x', 'image/svg+xml', 'image'], ['/f.woff2', 'font/woff2', 'font'], ['/f.ttf', 'application/octet-stream', ''],
    ['/a.js.map', 'application/json', ''], ['/logo.png', 'text/html', 'image'], ['/pixel', 'text/html', 'image'], ['/jsonp', 'application/json', 'script'],
    ['/cfg.js', 'text/plain', 'script'], ['/', 'text/html', 'document'], ['/api', 'application/json', 'fetch'], ['/api', 'application/json', ''],
    ['/v.mp4', 'video/mp4', 'media'], ['/manifest.webmanifest', 'application/manifest+json', 'manifest'], ['/beacon', 'text/plain', 'ping'],
    ['/x.ico', 'image/x-icon', 'other'], ['/sw', 'text/javascript', 'other'], ['/e', '', 'eventsource'], ['/d', 'application/pdf', ''],
  ];

  test('by default exactly the requests "Static assets" left out are left out (JS, CSS, Img, Font off)', () => {
    const r = loadUi();
    SAMPLES.forEach(([p, ct, rt]) => {
      const e = req(1, { url: 'https://app.example.com' + p, ct, _resourceType: rt });
      expect([p, ct, rt, !!r.recLeftOut(e, { noise: true, opts: true })]).toEqual([p, ct, rt, classicStatic(r, e)]);
      // a static file is always JS, CSS, Img or Font; anything else never is
      expect(['script', 'stylesheet', 'image', 'font'].includes(r.recTypeKey(e))).toBe(classicStatic(r, e));
    });
  });

  test('type keys: static files by their content; JSONP and pixels stay in the script; unknown browser types are Other', () => {
    const r = loadUi();
    const k = (p, ct, rt) => r.recTypeKey(req(1, { url: 'https://app.example.com' + p, ct, _resourceType: rt }));
    expect(k('/a.css', 'text/css', 'stylesheet')).toBe('stylesheet');
    expect(k('/x', 'application/javascript', 'fetch')).toBe('script');        // the content decides, not the browser
    expect(k('/logo.png', 'text/html', 'document')).toBe('image');
    expect(k('/jsonp', 'application/json', 'script')).toBe('fetch');
    expect(k('/pixel', 'text/html', 'image')).toBe('other');
    expect(k('/manifest.webmanifest', 'application/manifest+json', 'manifest')).toBe('other');
    expect(k('/e', '', 'eventsource')).toBe('other');
  });

  test('applyFilters records the reason on each request (one rule set for the script and the list)', () => {
    const r = loadUi();
    r.S.entries = [marker('start', 'T'), req(1, { url: 'https://app.example.com/a.css', ct: 'text/css' }), req(2), req(3, { method: 'OPTIONS' }), marker('end', 'T')];
    r.applyFilters();
    expect(r.S.entries.map((e) => [e.filtered, e.leftOut])).toEqual([[false, null], [true, 'type'], [false, null], [true, 'options'], [false, null]]);
  });

  test('why a request is left out follows the filter order', () => {
    const r = loadUi();
    expect(r._whyLeftOut(req(1, { url: 'wss://app.example.com/ws' }))).toMatch(/WebSocket/);
    expect(r._whyLeftOut(req(1, { url: 'data:image/png;base64,AA' }))).toBe('not a network request');
    r.S.domainFilter = { 'app.example.com': false };
    expect(r._whyLeftOut(req(1))).toBe('domain switched off');
    r.S.domainFilter = {};
    expect(r._whyLeftOut(req(1, { method: 'OPTIONS' }))).toBe('OPTIONS left out');
    expect(r._whyLeftOut(req(1, { url: 'https://app.example.com/a.css', ct: 'text/css' }))).toBe('CSS switched off');
    expect(r._whyLeftOut(req(1, { url: 'https://www.google-analytics.com/g/collect' }))).toBe('analytics / ads left out');
    expect(r._whyLeftOut(req(1, { url: 'https://www.google-analytics.com/a.js', ct: 'application/javascript' }))).toBe('analytics / ads left out');
    expect(r._whyLeftOut(req(1, { url: 'https://fundingchoicesmessages.google.com/i/x' }))).toBe('analytics / ads left out');
    expect(r._whyLeftOut(req(1, { hdrsMap: { 'content-type': 'application/csp-report' } }))).toBe('browser security report');
  });

  test('why: OPTIONS is not blamed when that filter is off', () => {
    const r = loadUi({ checks: { 'f-opts': false } });
    r.S.typeOff = new Set(['fetch']);
    expect(r._whyLeftOut(req(1, { method: 'OPTIONS' }))).toBe('Fetch/XHR switched off');
  });

  test('one line per transaction for the hidden requests: counts by reason, biggest first', () => {
    const r = loadUi();
    const list = [req(1, { leftOut: 'ads' }), req(2, { leftOut: 'type', url: 'https://a.example.com/x.png', ct: 'image/png' }),
      req(3, { leftOut: 'type', url: 'https://a.example.com/y.png', ct: 'image/png' }), req(4, { leftOut: 'options' })];
    expect(r._outSummary(list)).toEqual({ text: '2 Img, 1 analytics / ads, 1 OPTIONS', res: true });
    expect(r._outSummary([req(1, { leftOut: 'type', url: 'https://a.example.com/a.js', ct: 'text/javascript' })]).res).toBe(false);
  });

  test('ad pixels on www.google.com (/ads/, /pagead/) are analytics / ads; reCAPTCHA on the same server is not', () => {
    const r = loadUi();
    r.S.entries = [req(1, { url: 'https://www.google.com/ads/measurement/l?ebcid=x', ct: 'image/gif' }),
      req(2, { url: 'https://www.google.com/pagead/1p-conversion/1/' }), req(3, { url: 'https://www.google.com/recaptcha/api2/aframe', ct: 'text/html' }),
      req(4, { url: 'https://sync-tm.everesttech.net/upi/pid/x' })];
    r.applyFilters();
    expect(r.S.entries.map((e) => e.leftOut)).toEqual(['ads', 'ads', null, 'ads']);
  });

  test('a page the browser prefetched and then opened is scripted once — the prefetch is left out', () => {
    const r = loadUi();
    const pf = { 'sec-purpose': 'prefetch' };
    r.S.entries = [req(1, { url: 'https://app.example.com/', ct: 'text/html' }),
      req(2, { url: 'https://app.example.com/next/', ct: 'text/html', hdrsMap: pf }),
      req(3, { url: 'https://app.example.com/next/', ct: 'text/html' }),
      req(4, { url: 'https://app.example.com/never-opened/', ct: 'text/html', hdrsMap: { 'sec-purpose': 'prefetch;prerender' } })];
    r.applyFilters();
    expect(r.S.entries.map((e) => e.leftOut)).toEqual([null, 'prefetch', null, null]);   // one never opened stays in
    expect(r._whyLeftOut(r.S.entries[1])).toMatch(/^browser prefetch/);
    expect(r._outSummary([r.S.entries[1]]).text).toBe('1 prefetch');
  });

  test('type counts: requests per type, and how many each would put in the script', () => {
    const r = loadUi();
    r.S.entries = [req(1, { url: 'https://a.example.com/a.css', ct: 'text/css' }), req(2, { url: 'https://www.google-analytics.com/a.css', ct: 'text/css' }), req(3)];
    r.applyFilters();
    expect(r._typeCounts()).toEqual({ all: { stylesheet: 2, fetch: 1 }, n: { stylesheet: 1, fetch: 1 } });
  });

  test('leaving out a domain warns when the script needs it: page load, redirect to it, sign-in, cookies', () => {
    const r = loadUi();
    r.S.entries = [
      req(1, { url: 'https://app.example.com/', _resourceType: 'document', ct: 'text/html', status: 302, respHdrsMap: { location: 'https://login.example.com/oauth2/authorize?x=1' } }),
      req(2, { url: 'https://login.example.com/oauth2/authorize?x=1', _resourceType: 'document', ct: 'text/html', respHdrsMap: { 'set-cookie': 'a=1' } }),
      req(3, { url: 'https://cdn.example.com/lib.json' }),
    ];
    const why = r._domainNeeds('login.example.com');
    expect(why).toEqual(['It loads a page of your journey: /oauth2/authorize?x=1', 'app.example.com redirects to it',
      'It looks like sign-in: /oauth2/authorize?x=1', 'It sets cookies that later requests send back']);
    expect(r._domainNeeds('cdn.example.com')).toEqual([]);
    r.S.entries[1].filtered = true;                                   // already left out: nothing in the script needs it
    expect(r._domainNeeds('login.example.com')).toEqual(['app.example.com redirects to it']);
  });

  test('URL split never uses new URL() — {{variables}} and odd schemes stay as they are', () => {
    const r = loadUi();
    expect(r._splitUrl('https://h.example.com:8443/a/{{id}}?q=1')).toEqual({ host: 'h.example.com:8443', path: '/a/{{id}}?q=1' });
    expect(r._splitUrl('https://h.example.com')).toEqual({ host: 'h.example.com', path: '/' });
    expect(r._splitUrl('data:text/plain,hi')).toEqual({ host: '', path: 'data:text/plain,hi' });
  });

  test('preview colouring keeps the script text exactly (Copy reads textContent)', () => {
    const r = loadUi();
    const scripts = [
      'Action()\n{\n\tweb_url("a",\n\t\t"URL=https://x/?a=1&b=<2>",\n\t\tLAST);\n\t// it\'s "quoted"\n\treturn 0;\n}\n',
      'load.action("Action", async () => {\n  const t = `${load.global.x}` /* c */;\n  await new load.WebRequest({ url: \'u\' }).send();\n});\n',
      '#include "lrun.h"\nchar *s = "\\"esc\\" \\\\";\n',
    ];
    scripts.push('Action()\r\n{\r\n\treturn 0;\r\n}\r\n');   // Windows line endings must survive too
    const text = (frag) => frag.parts.map((n) => ('text' in n ? n.text : n.textContent)).join('');
    scripts.forEach((s) => expect(text(r._highlight(s))).toBe(s));
    expect(r._highlight('web_url("a");').parts).toContainEqual({ className: 'f', textContent: 'web_url' });
  });
});
