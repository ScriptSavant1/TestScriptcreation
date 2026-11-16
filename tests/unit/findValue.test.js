/**
 * Find a value — the answer shared by the HAR Explorer and Script Studio (portal/find-value.js): the verdict, the
 * trail, the "also" lines; each page names requests its own way (num / link) and adds its own Correlate this.
 */
const FV = require('../../src/web/public/portal/find-value.js');

const inv = (o) => Object.assign({ value: 'abc123', kind: 'correlate', src: { n: 7, side: 'res', kind: 'json', where: 'JSON field $.token' },
  later: [{ n: 9, side: 'req', kind: 'header', where: 'header Authorization' }], uses: [], also: [], missing: 0, referer: 0, outside: [], outsideCount: 0 }, o);
const explorer = { num: (h) => h.n, link: (h) => '<a href="#" data-go="' + h.n + '">#' + h.n + ' GET /x</a>' };
const studio = { num: (h) => h.n - 2, link: (h) => '<a href="#" data-go="' + (h.n - 2) + '">#' + (h.n - 2) + ' GET /x</a>' };

describe('FindValue.html', () => {
  test('correlate: the verdict names the source by the page\'s own number; the trail lists it, then the uses', () => {
    const e = FV.html(inv(), explorer), s = FV.html(inv(), studio);
    expect(e).toContain('The server sends it in <b>#7</b>');
    expect(s).toContain('The server sends it in <b>#5</b>');
    expect(s).toContain('<span class="hx-badge src">Comes from</span><span><a href="#" data-go="5">#5 GET /x</a>');
    expect(s).toContain('<span class="hx-badge use">Sent in</span><span><a href="#" data-go="7">#7 GET /x</a><span class="wh">header Authorization</span>');
  });
  test('the page\'s line about Script Studio and its Correlate this are added', () => {
    const h = FV.html(inv(), Object.assign({ studio: () => '<p class="hx-studio">S</p>', corr: '<div class="hx-corr">C</div>' }, studio));
    expect(h).toContain('<p class="hx-studio">S</p>');
    expect(h.endsWith('<div class="hx-corr">C</div>')).toBe(true);
  });
  test('every verdict kind has a title and text', () => {
    Object.keys(FV.VERDICT).forEach((k) => {
      const h = FV.html(inv({ kind: k, src: k === 'input' || k === 'none' || k === 'generated' || k === 'missing' ? null : inv().src, uses: [], missing: 2 }), explorer);
      expect(h).toContain('<h3>' + FV.VERDICT[k][1] + '</h3>');
    });
  });
  test('left-out requests and later copies are named by number only', () => {
    const h = FV.html(inv({ outside: [{ n: 12 }], outsideCount: 1, also: [{ n: 15, where: 'response body' }] }), studio);
    expect(h).toContain('left out of the script (<a href="#" data-go="10">#10</a>)');
    expect(h).toContain('Also returned later by <a href="#" data-go="13">#13</a> (response body)');
  });
  test('tabFor: the details tab that shows each place', () => {
    expect(FV.tabFor({ side: 'res', header: 'Location' })).toBe('headers');
    expect(FV.tabFor({ side: 'res' })).toBe('response');
    expect(FV.tabFor({ side: 'req', kind: 'body', where: 'form field a' })).toBe('payload');
    expect(FV.tabFor({ side: 'req', kind: 'url', where: 'query parameter q' })).toBe('payload');
    expect(FV.tabFor({ side: 'req', kind: 'cookie', where: 'cookie sid' })).toBe('cookies');
  });
});
