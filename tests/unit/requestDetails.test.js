/**
 * One request-details view for the HAR Explorer and Script Studio (portal/request-details.js): the tabs as DevTools
 * shows them, Hide secrets, "Show all" for long bodies, a page preview that cannot reach the network, Copy as cURL.
 */
const RD = require('../../src/web/public/portal/request-details.js');

const raw = {
  request: {
    method: 'POST', url: 'https://shop.example.com/login?next=%2Fhome', httpVersion: 'HTTP/1.1',
    headers: [{ name: 'Content-Type', value: 'application/x-www-form-urlencoded' }, { name: 'Cookie', value: 'sid=abc123; theme=dark' }, { name: 'Authorization', value: 'Bearer eyJ.abc.def' }, { name: ':authority', value: 'shop.example.com' }],
    queryString: [{ name: 'next', value: '%2Fhome' }],
    postData: { mimeType: 'application/x-www-form-urlencoded', params: [{ name: 'user', value: 'jo' }, { name: 'password', value: 's3cret' }], text: "user=jo&password=s3cret&note=it's" },
  },
  response: {
    status: 302, statusText: 'Found', redirectURL: '/home',
    headers: [{ name: 'Set-Cookie', value: 'sid=xyz789; HttpOnly' }, { name: 'Location', value: '/home' }],
    content: { mimeType: 'text/html', size: 0 },
  },
  timings: { blocked: 1, dns: -1, connect: 10, ssl: 5, send: 1, wait: 80, receive: 3 },
};
const base = (o) => Object.assign({ n: 7, e: { method: 'POST', url: raw.request.url, status: 302, size: 0 }, raw, type: 'Doc', dur: 100, start: 250, out: false, why: '', tab: 'headers', mask: false, full: {} }, o);

describe('RequestDetails.html — the tabs', () => {
  test('summary line, Copy buttons and the six tabs with their counts', () => {
    const h = RD.html(base());
    expect(h).toContain('<span>#<b>7</b></span>');
    expect(h).toContain('Status <b class="st s3">302 Found</b>');
    expect(h).toContain('data-copy="url"');
    expect(h).toContain('data-copy="curl"');
    expect([...h.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1])).toEqual(RD.TABS);
    expect(h).toContain('Headers<i>6</i>');   // 4 request + 2 response headers
    expect(h).toContain('Redirects to');
  });
  test('Payload: query string (with the decoded value), form data, raw body folded', () => {
    const h = RD.html(base({ tab: 'payload' }));
    expect(h).toContain('(decoded: /home)');
    expect(h).toContain('Form data <span class="c">2</span>');
    expect(h).toMatch(/<details class="hx-sec"><summary>[\s\S]*Raw body/);   // folded when there are form fields
  });
  test('Response: a redirect explains that it has no body', () => {
    expect(RD.html(base({ tab: 'response' }))).toContain('A redirect has no body');
  });
  test('Cookies from the Cookie and Set-Cookie headers when the HAR has no cookie list', () => {
    const h = RD.html(base({ tab: 'cookies' }));
    expect(h).toContain('Request cookies <span class="c">2</span>');
    expect(h).toContain('<td>sid</td><td>xyz789</td>');
  });
  test('Timing: every phase, a missing one as —, and the start time', () => {
    const h = RD.html(base({ tab: 'timing' }));
    expect(h).toContain('Waiting for the server (TTFB)');
    expect(h).toContain('<span class="v">—</span>');
    expect(h).toContain('+250 ms');
  });
  test('a left-out request says why; an unknown tab shows Headers', () => {
    const h = RD.html(base({ out: true, why: 'analytics / ads', tab: 'nope' }));
    expect(h).toContain('<p class="hx-left"><b>Left out of the script:</b> analytics / ads</p>');
    expect(h).toContain('data-tab="headers" aria-selected="true"');
  });
  test('the text above the address and the value marker are the page\'s', () => {
    const h = RD.html(base({ top: '<p class="x">T01</p>', hl: (s) => s.replace('shop', '<mark>shop</mark>') }));
    expect(h.indexOf('<p class="x">T01</p>')).toBeLessThan(h.indexOf('hx-durl'));
    expect(h).toContain('<mark>shop</mark>');
  });
});

describe('RequestDetails — Hide secrets, long bodies, preview', () => {
  test('Hide secrets masks secret headers, cookies and body fields', () => {
    const h = RD.html(base({ mask: true }));
    expect(h).toContain('<tr class="secret"><td>Authorization</td><td>••••••</td></tr>');
    expect(h).not.toContain('eyJ.abc.def');
    const p = RD.html(base({ mask: true, tab: 'payload' }));
    expect(p).toContain('password=••••••');
  });
  test('a body over 300 000 characters is cut with "Show all"; full shows it all', () => {
    const big = { response: { status: 200, headers: [], content: { mimeType: 'text/plain', text: 'x'.repeat(300010) } }, request: { method: 'GET', url: 'https://a.example.com/' } };
    expect(RD.html(base({ raw: big, tab: 'response' }))).toContain('data-full="res">Show all');
    expect(RD.html(base({ raw: big, tab: 'response', full: { res: true } }))).not.toContain('Show all');
  });
  test('an HTML page previews sandboxed (no scripts) with every outside request blocked', () => {
    const page = { request: { method: 'GET', url: 'https://a.example.com/' }, response: { status: 200, headers: [], content: { mimeType: 'text/html', text: '<h1>Hi</h1><script>x()</script>' } } };
    const h = RD.html(base({ raw: page, tab: 'preview' }));
    expect(h).toContain('sandbox=""');
    expect(h).toContain("default-src &#39;none&#39;");
  });
  test('JSON is pretty-printed and coloured', () => {
    const j = { request: { method: 'GET', url: 'https://a.example.com/' }, response: { status: 200, headers: [], content: { mimeType: 'application/json', text: '{"a":1,"b":true}' } } };
    const h = RD.html(base({ raw: j, tab: 'response' }));
    expect(h).toContain('<span class="k">&quot;a&quot;</span>: <span class="n">1</span>');
  });
});

describe('RequestDetails.copy', () => {
  test('URL, and cURL with the headers (no HTTP/2 pseudo headers) and the body', () => {
    expect(RD.copy(raw, 'url', false, 'x')).toBe(raw.request.url);
    const c = RD.copy(raw, 'curl', false);
    expect(c).toMatch(/^curl -X POST 'https:\/\/shop\.example\.com\/login\?next=%2Fhome'/);
    expect(c).not.toContain(':authority');
    expect(c).toContain("--data-raw 'user=jo&password=s3cret&note=it'\\''s'");
  });
  test('with Hide secrets the copied command hides them too', () => {
    const c = RD.copy(raw, 'curl', true);
    expect(c).toContain("-H 'Authorization: ••••••'");
    expect(c).toContain('password=••••••');
  });
});

// The address in the summary line breaks after / ? & = only — a <wbr> hint, never inside a word; the text is unchanged
describe('RequestDetails.html — where the address may break', () => {
  const urlHtml = (url, hl) => { const h = RD.html(base({ e: { method: 'GET', url, status: 200, size: 0 }, hl })); return h.slice(h.indexOf('<code>') + 6, h.indexOf('</code>')); };
  test('after / ? = (not between the two slashes of https://); the text stays the address', () => {
    const c = urlHtml('https://api.example.com/v2/products?category=tents&page=1');
    expect(c).toBe('https://<wbr>api.example.com/<wbr>v2/<wbr>products?<wbr>category=<wbr>tents&amp;page=<wbr>1');
    expect(c.replace(/<wbr>/g, '').replace(/&amp;/g, '&')).toBe('https://api.example.com/v2/products?category=tents&page=1');
  });
  test('the marks of a looked-up value and HTML entities are left whole', () => {
    const c = urlHtml('https://a.example.com/x?t=abc/def', (h) => h.replace('abc/def', '<mark class="hx-hl">abc/def</mark>'));
    expect(c).toContain('<mark class="hx-hl">abc/<wbr>def</mark>');
    expect(urlHtml('https://a.example.com/p?q="x"')).toContain('&quot;x&quot;');
  });
});
