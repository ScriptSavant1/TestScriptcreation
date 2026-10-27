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

  test.each(['detectMarkers', '_recInjectPagerefMarkers', '_makeRecMarker', 'classifyHarEntry', 'applyFilters', 'refresh'])(
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
    expect(mine.slice(engine.length)).toEqual(['portal/recorder-core.js', 'portal/recorder-ui.js']);
  });

  test.each(['f-static', 'f-noise', 'f-opts', 'txn-inp', 'tbody', 'code-body', 'dp-list', 'dp-title', 'stats', 'hf', 'dz', 'welcome', 'main',
    'netlog-banner', 'auth-badge', 'sel-cnt', 'btn-sel', 'rec-rt-bar', 'cdp-dl', 'fc-webhttp', 'fc-devweb', 'fc-both', 'fmt-cancel-btn', 'toast-container'])(
    'Recorder.html has #%s', (id) => {
      expect(page).toContain('id="' + id + '"');
    });

  test('the static-asset, analytics and OPTIONS filters start ticked, as on the classic page', () => {
    ['f-static', 'f-noise', 'f-opts'].forEach((id) => expect(page).toMatch(new RegExp('id="' + id + '"[^>]*checked')));
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
  const ui = read('portal/recorder-ui.js');
  const logic = ui.slice(0, ui.indexOf('// WIRING'));        // everything except the DOM wiring
  const checks = Object.assign({ 'f-static': true, 'f-noise': true, 'f-opts': true }, opts.checks);
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
    state +
    '\nfunction esc(s){ return(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;"); }' +
    '\nfunction classifyHarEntry(e){ return e._rt || "fetch"; }' +
    '\nfunction buildScripts(){ calls.regen++; } function renderTable(){} function renderStats(){} function showScript(){} function refresh(){ calls.refresh++; }' +
    '\n' + logic.replace(/function _regen\(\) \{[^}]*\}/, 'function _regen(){ calls.regen++; }') +
    '\nreturn { S, COLORS, _createTxn, _renameTxn, _ungroupTxn, _txnSnapshot, _txnRestore, _replayTxnLog, setRecorderRt, _whyLeftOut, _splitUrl, _highlight,' +
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

describe('Recorder redesign — filters and preview', () => {
  test('type chips: first click turns only that type off; the last type cannot be turned off; All resets', () => {
    const r = loadUi();
    r.setRecorderRt('fetch');
    expect([...r.S.resourceTypeFilter].sort()).toEqual(['document', 'font', 'image', 'media', 'other', 'script', 'stylesheet']);
    ['document', 'font', 'image', 'media', 'other', 'script', 'stylesheet'].forEach((k) => r.setRecorderRt(k));
    expect([...r.S.resourceTypeFilter]).toEqual(['stylesheet']);   // classic rule: never an empty set
    r.setRecorderRt('__all__');
    expect(r.S.resourceTypeFilter).toBeNull();
    expect(r.calls.refresh).toBe(9);
  });

  test('why a request is left out follows the applyFilters order', () => {
    const r = loadUi();
    expect(r._whyLeftOut(req(1, { url: 'wss://app.example.com/ws' }))).toMatch(/WebSocket/);
    expect(r._whyLeftOut(req(1, { url: 'data:image/png;base64,AA' }))).toBe('not a network request');
    r.S.domainFilter = { 'app.example.com': false };
    expect(r._whyLeftOut(req(1))).toBe('domain switched off');
    r.S.domainFilter = {};
    expect(r._whyLeftOut(req(1, { method: 'OPTIONS' }))).toBe('OPTIONS left out');
    expect(r._whyLeftOut(req(1, { url: 'https://app.example.com/a.css', ct: 'text/css' }))).toBe('static asset left out');
    expect(r._whyLeftOut(req(1, { url: 'https://www.google-analytics.com/g/collect' }))).toBe('analytics / ads left out');
    expect(r._whyLeftOut(req(1, { hdrsMap: { 'content-type': 'application/csp-report' } }))).toBe('browser security report');
  });

  test('why: OPTIONS is not blamed when that filter is off', () => {
    const r = loadUi({ checks: { 'f-opts': false } });
    r.S.resourceTypeFilter = new Set(['document']);
    expect(r._whyLeftOut(req(1, { method: 'OPTIONS' }))).toBe('type Fetch/XHR switched off');
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
