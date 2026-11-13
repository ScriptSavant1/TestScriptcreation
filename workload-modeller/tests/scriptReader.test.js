/**
 * Fill from scripts — what one iteration holds: transactions in the Action part only (start-up / closing ones listed),
 * think time, requests, transactions inside other transactions, comments vs text in quotes, HAR steps.
 */
const R = require('../engine/script-reader.js');

describe('Web HTTP/HTML (VuGen C)', () => {
  const steps = Array.from({ length: 8 }, (_, i) => `lr_start_transaction("T0${i + 2}_Step");\n web_url("s${i}", "URL=https://example.com/${i}", LAST);\n lr_end_transaction("T0${i + 2}_Step", LR_AUTO);\n lr_think_time(5);`).join('\n');

  test('login in vuser_init, 8 steps in Action, logout in vuser_end: 8 counted, the others listed', () => {
    const v = R.readVugen('Shop', {
      'vuser_init.c': 'vuser_init(){ lr_start_transaction("T01_Login"); web_url("l","URL=https://example.com/login",LAST); lr_end_transaction("T01_Login", LR_AUTO); return 0; }',
      'Action.c': 'Action(){\n' + steps + '\nreturn 0; }',
      'vuser_end.c': 'vuser_end(){ lr_start_transaction("T10_Logout"); web_url("o","URL=https://example.com/out",LAST); lr_end_transaction("T10_Logout", LR_AUTO); return 0; }',
    });
    expect([v.txPerIter, v.thinkPerIter, v.requestsPerIter]).toEqual([8, 40, 8]);
    expect(v.warnings.join('\n')).toMatch(/T01_Login runs once per Vuser at the start \(vuser_init\), not counted/);
    expect(v.warnings.join('\n')).toMatch(/T10_Logout runs once per Vuser at the end \(vuser_end\), not counted/);
    expect(v.nestedTx).toEqual([]);
  });

  test('a transaction around two others is listed; all four are counted', () => {
    const n = R.readVugen('Nest', { 'Action.c': 'Action(){ lr_start_transaction("01_Login"); lr_start_transaction("01a_Submit"); lr_end_transaction("01a_Submit", LR_AUTO); lr_start_transaction("01b_Home"); lr_end_transaction("01b_Home", LR_AUTO); lr_end_transaction("01_Login", LR_AUTO); lr_start_transaction("02_Search"); lr_end_transaction("02_Search", LR_AUTO); return 0; }' });
    expect(n.txPerIter).toBe(4);
    expect(n.nestedTx).toEqual(['01_Login']);
    expect(n.warnings.join('\n')).toMatch(/01_Login contains other transactions/);
  });

  test('comments are ignored; "https://" in quotes is not a comment', () => {
    const u = R.readVugen('Url', { 'Action.c': 'Action(){ lr_start_transaction("A"); web_url("a","URL=https://example.com/a",LAST); lr_end_transaction("A", LR_AUTO); lr_think_time(4); // it\'s "done"\n /* lr_think_time(99); lr_start_transaction("Old"); */ lr_start_transaction("B"); lr_end_transaction("B", LR_AUTO); return 0; }' });
    expect([u.txPerIter, u.thinkPerIter]).toEqual([2, 4]);
    expect(u.nestedTx).toEqual([]);
  });

  test('replay think time from default.cfg', () => {
    const v = R.readVugen('Cfg', { 'Action.c': 'Action(){ lr_start_transaction("A"); lr_end_transaction("A", LR_AUTO); return 0; }', 'default.cfg': '[ThinkTime]\nOptions=NOTHINK\nFactor=1\n[Iterations]\nIterationPace=IterationASAP\n' });
    expect(v.thinkMode).toBe('ignore');
    expect(v.notes.join('\n')).toMatch(/IterationASAP/);
  });

  test('no transaction at all: each request counts as one, and it says so', () => {
    const v = R.readVugen('Plain', { 'Action.c': 'Action(){ web_url("a","URL=https://example.com/a",LAST); web_url("b","URL=https://example.com/b",LAST); return 0; }' });
    expect(v.txPerIter).toBe(2);
    expect(v.warnCodes).toContain('no-tx');
  });

  test('no .c file (malformed ZIP content): one transaction, flagged, no throw', () => {
    const v = R.readVugen('Empty', { 'readme.txt': 'nothing' });
    expect(v.txPerIter).toBe(1);
    expect(v.warnCodes).toContain('no-tx');
  });
});

describe('DevWeb (JavaScript)', () => {
  const js = `const tLogin = new load.Transaction("Login"); const tAll = new load.Transaction("Order"); const tPay = new load.Transaction("Pay"); const tOut = new load.Transaction("Logout");
load.initialize(async function () { tLogin.start(); new load.WebRequest({url:"https://example.com/l"}).sendSync(); tLogin.stop(); });
load.action("Action", async function () { tAll.start(); tPay.start(); new load.WebRequest({url:"https://example.com/p"}).sendSync(); tPay.stop(load.TransactionStatus.Passed); tAll.stop(); load.thinkTime(3); });
load.finalize(async function () { tOut.start(); new load.WebRequest({url:"https://example.com/o"}).sendSync(); tOut.stop(); });`;

  test('initialize / action / finalize: 2 counted; Login at the start, Logout at the end; Order contains Pay', () => {
    const d = R.readDevweb('Dev', { 'main.js': js });
    expect([d.txPerIter, d.requestsPerIter, d.thinkPerIter]).toEqual([2, 1, 3]);
    expect([d.initTx, d.endTx, d.nestedTx]).toEqual([['Login'], ['Logout'], ['Order']]);
    expect(d.warnings.join('\n')).toMatch(/load\.finalize/);
  });

  test('one after the other (start, stop, start, stop) is not nesting', () => {
    const f = R.readDevweb('Flat', { 'main.js': 'const A = new load.Transaction("A"); const B = new load.Transaction("B");\nload.action("Action", async function () {\n A.start();\n A.stop(load.TransactionStatus.Passed);\n B.start();\n B.stop();\n});' });
    expect(f.txPerIter).toBe(2);
    expect(f.nestedTx).toEqual([]);
  });

  test('rts.yml think time type', () => {
    const d = R.readDevweb('Rts', { 'main.js': 'load.action("A", async function () {});', 'rts.yml': 'thinkTime:\n  type: ignore\n' });
    expect(d.thinkMode).toBe('ignore');
  });
});

describe('HAR', () => {
  test('pages are the steps; response time per step and pauses from the timings', () => {
    const t0 = Date.parse('2026-01-01T10:00:00Z');
    const at = (ms) => new Date(t0 + ms).toISOString();
    const har = { log: { pages: [{ id: 'p1', title: 'Home' }, { id: 'p2', title: 'Search' }], entries: [
      { pageref: 'p1', startedDateTime: at(0), time: 800, request: { method: 'GET', url: 'https://example.com/' }, response: { status: 200 } },
      { pageref: 'p2', startedDateTime: at(5800), time: 1200, request: { method: 'GET', url: 'https://example.com/s' }, response: { status: 200 } }] } };
    const s = R.readHar('Browse', har);
    expect(s.txPerIter).toBe(2);
    expect(s.thinkPerIter).toBe(5);                            // 5.8 s start − 0.8 s end of the first step
    expect(s.rtAvg).toBe(1);                                   // (0.8 + 1.2) ÷ 2
  });

  test('not a HAR, or a HAR without web requests: throws (listed as "not read" by the page)', () => {
    expect(() => R.readHar('x', {})).toThrow(/not a HAR file/);
    expect(() => R.readHar('x', null)).toThrow(/not a HAR file/);
    expect(() => R.readHar('x', { log: { entries: [{ request: { url: 'data:abc' }, startedDateTime: 'x' }] } })).toThrow(/no requests/);
  });
});

describe('pages and API calls (for the Vusers-per-machine rule)', () => {
  test('Web HTTP/HTML: pages = HTML-mode calls, form submits, links; API = HTTP-mode custom requests, web_rest', () => {
    const c = `Action() {
      web_url("home", "URL=https://example.com/", "Mode=HTML", EXTRARES, "Url=/site.css", LAST);
      web_url("plain", "URL=https://example.com/about", LAST);
      web_submit_data("login", "Action=https://example.com/login", ITEMDATA, LAST);
      web_custom_request("api", "URL=https://example.com/api", "Method=POST", "Mode=HTTP", "EncType=application/json", "Body={}", LAST);
      web_custom_request("get", "URL=https://example.com/api/2", "Method=GET", "Mode=HTTP", LAST);
      web_url("json", "URL=https://example.com/api/3", "Mode=HTTP", LAST);
      web_rest("rest", "URL=https://example.com/api/4", "Method=GET", LAST);
      web_custom_request("page", "URL=https://example.com/p", "Method=POST", "Mode=HTML", LAST);
      return 0; }`;
    const s = R.readVugen('V', { 'Action.c': c });
    expect([s.pages, s.requestsPerIter, s.pageShare]).toEqual([4, 8, 0.5]);
    expect(s.brief).toMatch(/8 requests \(4 pages, 4 API calls\)/);
  });
  test('DevWeb: a request with a resources list or asking for HTML is a page; the others are API calls', () => {
    const js = `load.action("A", async () => {
      new load.WebRequest({ url: "https://example.com/", headers: { "Accept": "text/html,application/xhtml+xml" } }).sendSync();
      new load.WebRequest({ url: "https://example.com/home", resources: ["https://example.com/a.css"] }).sendSync();
      new load.WebRequest({ url: "https://example.com/api", method: "POST", headers: { "content-type": "application/json" }, body: {} }).sendSync();
      new load.WebRequest({ url: "https://example.com/api/2" }).sendSync();
    });`;
    const s = R.readDevweb('D', { 'main.js': js });
    expect([s.pages, s.requestsPerIter, s.pageShare]).toEqual([2, 4, 0.5]);
  });
  test('HAR: documents and their static files are pages; XHR / fetch and JSON are API calls', () => {
    const e = (url, mimeType, type) => Object.assign({ startedDateTime: '2024-01-01T00:00:00Z', time: 5, request: { url, headers: [] }, response: { content: { mimeType } } }, type ? { _resourceType: type } : {});
    const s = R.readHar('H', { log: { entries: [e('https://example.com/', 'text/html'), e('https://example.com/a.css', 'text/css'), e('https://example.com/api', 'application/json', 'xhr'), e('https://example.com/b', 'application/json')] } });
    expect([s.pages, s.requestsPerIter]).toEqual([2, 4]);
  });
  test('a script with no requests has no share (the card counts it as web pages)', () => {
    expect(R.readVugen('V', { 'Action.c': 'Action() { lr_think_time(5); return 0; }' }).pageShare).toBeNull();
  });
});
