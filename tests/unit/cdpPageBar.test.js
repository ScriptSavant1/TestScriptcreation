'use strict';

/**
 * CDP Recorder 0.3.0 — the floating bar inside the recorded pages (page-bar.js): its plain helpers, and that the
 * source injected into a page is valid JavaScript built without innerHTML or inline style attributes (so a strict
 * Content-Security-Policy or Trusted Types on the application's page cannot block it). The bar in a real browser is
 * checked by cdp-recorder/recorder/tests-manual/floating-bar.mjs.
 *
 * Loading: page-bar.js is an ES module — `export` stripped and wrapped in new Function(), as for portal-mode.js.
 */

const fs = require('fs');
const path = require('path');

const SRC = path.resolve(__dirname, '../../cdp-recorder/recorder/src/page-bar.js');
const B = new Function(fs.readFileSync(SRC, 'utf-8').replace(/^export /gm, '') +
  '\nreturn { BAR_WORLD, barScript, planChips, barPrefsOf, saveAsText, barClient };')();

describe('planChips — the planned steps in the details', () => {
  test('done by name (number and case ignored), the first one not done is next', () => {
    expect(B.planChips(['Launch', 'Add to basket', 'Checkout'], ['T01_Launch', 'T02_add_to_basket']))
      .toEqual([{ step: 'Launch', done: true, next: false }, { step: 'Add to basket', done: true, next: false }, { step: 'Checkout', done: false, next: true }]);
  });
  test('nothing started: the first is next; every step done: none is next', () => {
    expect(B.planChips(['A', 'B'], []).map((c) => c.next)).toEqual([true, false]);
    expect(B.planChips(['A'], ['T01_A']).some((c) => c.next)).toBe(false);
  });
  test('no plan', () => {
    expect(B.planChips(undefined, ['T01_A'])).toEqual([]);
  });
});

describe('barPrefsOf — the remembered place of the bar', () => {
  test('valid values kept', () => {
    expect(B.barPrefsOf({ dock: 'bottom', pos: 'right' })).toEqual({ dock: 'bottom', pos: 'right' });
    expect(B.barPrefsOf({ dock: 'top', pos: 'left' })).toEqual({ dock: 'top', pos: 'left' });
  });
  test('anything else: top, middle', () => {
    expect(B.barPrefsOf(null)).toEqual({ dock: 'top', pos: 'center' });
    expect(B.barPrefsOf({ dock: 'side', pos: 'x', extra: 1 })).toEqual({ dock: 'top', pos: 'center' });
    expect(B.barPrefsOf('bottom')).toEqual({ dock: 'top', pos: 'center' });
  });
});

describe('saveAsText — where Stop saves', () => {
  test('a recording started from Script Studio: script ID and name, opens in Script Studio', () => {
    expect(B.saveAsText({ scriptId: 'SC01', name: 'Booking' })).toBe('Saved to Downloads as SC01_Booking_<date>.har — opens in Script Studio');
    expect(B.saveAsText({ name: '' })).toBe('Saved to Downloads as Recording_<date>.har — opens in Script Studio');
    expect(B.saveAsText({ name: 'My trip/2' })).toMatch(/as My_trip_2_<date>\.har/);
  });
  test('started from the toolbar: next to the program', () => {
    expect(B.saveAsText(null)).toMatch(/next to cdp-recorder\.exe/);
  });
});

describe('barScript — the source put into each page', () => {
  const src = B.barScript('__perfxBar_abc');
  test('valid JavaScript, a call of the bar with its binding name; the shadow root closed unless asked', () => {
    expect(() => new Function(src)).not.toThrow();
    expect(src).toContain('"binding":"__perfxBar_abc"');
    expect(src).toContain('"open":false');
    expect(B.barScript('x', { open: true })).toContain('"open":true');
  });
  test('built without innerHTML, outerHTML, insertAdjacentHTML or document.write (Trusted Types)', () => {
    expect(src).not.toMatch(/\.innerHTML\s*=|outerHTML\s*=|insertAdjacentHTML|document\.write/);
  });
  test('never fetches or opens a connection: nothing of the bar in the recording', () => {
    expect(src).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|new Image/);
  });
  test('no End button: Enter / Mark ends the running transaction and starts the next', () => {
    expect(src).not.toMatch(/act: "end"|>End<|"End"\)/);
    expect(src).toMatch(/act: "mark"/);
  });
  test('the top page only, once per document; Alt+Shift+H; styles in a constructed sheet', () => {
    expect(src).toContain('window.top !== window');
    expect(src).toContain('__perfxBarUp');
    expect(src).toMatch(/e\.altKey && e\.shiftKey/);
    expect(src).toContain('adoptedStyleSheets');
  });
  test('the world name', () => {
    expect(B.BAR_WORLD).toBe('perfx-recorder-bar');
  });
});
