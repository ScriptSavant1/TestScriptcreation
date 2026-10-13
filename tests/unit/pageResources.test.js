'use strict';

/**
 * shared/page-resources.js — static resources attach to the page that loaded
 * them (HTML mode) instead of being scripted as separate requests.
 *
 * User report: with "Static assets" / "Analytics / ads" included in the Recorder,
 * every CSS/image/JS file became its own DevWeb WebRequest (and VuGen web_url),
 * repeated for every page — on top of downloadHtmlStaticResources already
 * fetching them, so each resource was requested twice per page.
 */

const PR = require('../../src/web/public/shared/page-resources.js');

const HOST = 'https://shop.example.com';
const page = (path, html, extra = {}) => ({ url: HOST + path, method: 'GET', status: 200, ct: 'text/html', _resourceType: 'document', respBody: html, hdrsMap: {}, ...extra });
const res = (url, type, ct, extra = {}) => ({ url: /^[a-z]+:/.test(url) ? url : HOST + url, method: 'GET', status: 200, ct, _resourceType: type, ...extra });
const xhr = (path) => ({ url: HOST + path, method: 'GET', status: 200, ct: 'application/json', _resourceType: 'xhr' });
const marker = (type, name) => ({ isMarker: true, markerType: type, txnName: name, url: '' });

// Real tags: a stylesheet and an image (auto-downloaded by HTML-mode replay) and a
// <script src> (NOT auto-downloaded — VuGen's own recording lists scripts under EXTRARES).
const HTML = '<html><head><link rel="stylesheet" href="/css/site.css"><script src="https://shop.example.com/js/app.js?v=3"></script></head>' +
  '<body><img src="../images/logo.gif"></body></html>';

describe('isPageEntry / isResourceEntry', () => {
  test('document, and HTML responses without a resource type, are pages', () => {
    expect(PR.isPageEntry(page('/', ''))).toBe(true);
    expect(PR.isPageEntry({ url: HOST + '/login', method: 'POST', ct: 'text/html' })).toBe(true);
    expect(PR.isPageEntry(xhr('/api/x'))).toBe(false);
    expect(PR.isPageEntry({ url: HOST + '/x', method: 'PUT', ct: 'text/html' })).toBe(false);
  });

  test('CSS, JS, images, fonts, media and beacons are resources; API calls are not', () => {
    expect(PR.isResourceEntry(res('/a.css', 'stylesheet', 'text/css'))).toBe(true);
    expect(PR.isResourceEntry(res('/a.js', 'script', 'application/javascript'))).toBe(true);
    expect(PR.isResourceEntry(res('/a.woff2', 'font', 'font/woff2'))).toBe(true);
    expect(PR.isResourceEntry(res('/collect', 'ping', ''))).toBe(true);
    expect(PR.isResourceEntry({ url: HOST + '/favicon.ico', method: 'GET', ct: '', _resourceType: 'other' })).toBe(true);
    expect(PR.isResourceEntry({ url: HOST + '/collect', method: 'POST', ct: '', _resourceType: 'ping' })).toBe(false);
    expect(PR.isResourceEntry(xhr('/api/items'))).toBe(false);
    expect(PR.isResourceEntry({ url: HOST + '/upload.png', method: 'POST', ct: 'image/png' })).toBe(false);
  });
});

describe('htmlAutoResources / referencedInHtml — what HTML-mode replay downloads by itself', () => {
  const PAGE = HOST + '/shop/index.html';

  test('<img src> and <link rel="stylesheet"> count, resolved against the page URL', () => {
    expect(PR.referencedInHtml(HOST + '/css/site.css', HTML, PAGE)).toBe(true);
    expect(PR.referencedInHtml(HOST + '/images/logo.gif', HTML, PAGE)).toBe(true);
  });

  test('<script src> does NOT count — scripts are listed (as VuGen records them under EXTRARES)', () => {
    expect(PR.referencedInHtml(HOST + '/js/app.js?v=3', HTML, PAGE)).toBe(false);
  });

  test('a file only mentioned inside inline JavaScript or a comment does not count', () => {
    const html = '<html><script>var s = "/images/spinner.gif"; load("/js/lazy.js");</script><!-- <img src="/old.gif"> --></html>';
    expect(PR.referencedInHtml(HOST + '/images/spinner.gif', html, PAGE)).toBe(false);
    expect(PR.referencedInHtml(HOST + '/old.gif', html, PAGE)).toBe(false);
  });

  test('a bare file name elsewhere in the HTML text does not count', () => {
    expect(PR.referencedInHtml(HOST + '/images/sprite.png', '<p>see sprite.png</p>', PAGE)).toBe(false);
  });

  test('JSF-style &amp; in attribute values is decoded before comparing', () => {
    const html = '<img src="/rmp-web/faces/jakarta.faces.resource/logo.gif?ln=rbsg&amp;v=2">';
    expect(PR.referencedInHtml(HOST + '/rmp-web/faces/jakarta.faces.resource/logo.gif?ln=rbsg&v=2', html, PAGE)).toBe(true);
  });

  test('<base href>, background= and <input type="image"> are honoured', () => {
    const html = '<base href="https://cdn.example.com/static/"><table background="bg.png"><input type="image" src="go.gif">';
    const set = PR.htmlAutoResources(html, PAGE);
    expect(set.has('https://cdn.example.com/static/bg.png')).toBe(true);
    expect(set.has('https://cdn.example.com/static/go.gif')).toBe(true);
  });

  test('link rel="icon" / "preload" do not count', () => {
    const html = '<link rel="icon" href="/favicon.ico"><link rel="preload" href="/f.woff2">';
    expect(PR.htmlAutoResources(html, PAGE).size).toBe(0);
  });

  test('no HTML recorded means nothing is auto-downloaded', () => {
    expect(PR.referencedInHtml(HOST + '/css/site.css', '', PAGE)).toBe(false);
  });
});

describe('groupPageResources', () => {
  test('resources attach to their page; HTML-referenced vs script-loaded are split; API calls stay', () => {
    const entries = [
      page('/', HTML),                                                     // 0
      res('/css/site.css', 'stylesheet', 'text/css'),                      // 1 in HTML
      res('/images/logo.gif', 'image', 'image/gif'),                       // 2 in HTML
      res('/js/app.js?v=3', 'script', 'application/javascript'),           // 3 in HTML
      xhr('/api/cart'),                                                    // 4 stays a request
      res('/images/sprite.png', 'image', 'image/png'),                     // 5 CSS/JS-loaded → extra
      res('https://www.google-analytics.com/g/collect?v=2', 'image', 'image/gif'), // 6 extra
    ];
    const { absorbed, byPage } = PR.groupPageResources(entries, new Set());
    expect([...absorbed].sort()).toEqual([1, 2, 3, 5, 6]);
    expect(byPage.get(0)).toEqual({ inHtml: [1, 2], extra: [3, 5, 6], skipped: [], htmlKnown: true, pageUrl: HOST + '/' });
    expect(absorbed.has(4)).toBe(false);
  });

  test('each page gets its own resources, even when the same files repeat', () => {
    const entries = [
      page('/p1', HTML), res('/css/site.css', 'stylesheet', 'text/css'),
      page('/p2', HTML), res('/css/site.css', 'stylesheet', 'text/css'), res('/images/logo.gif', 'image', 'image/gif'),
    ];
    const { byPage } = PR.groupPageResources(entries, new Set());
    expect(byPage.get(0).inHtml).toEqual([1]);
    expect(byPage.get(2).inHtml).toEqual([3, 4]);
  });

  test('form POST redirected to a page: resources attach to the POST step, matched against the target page HTML', () => {
    const entries = [
      { url: HOST + '/login', method: 'POST', ct: 'text/html', _resourceType: 'document', status: 302, respBody: '', hdrsMap: {} }, // 0 emitted
      page('/home', HTML, { status: 200 }),                                // 1 redirect target (auto-follow, not emitted)
      res('/css/site.css', 'stylesheet', 'text/css'),                      // 2
      res('/images/other.png', 'image', 'image/png'),                      // 3
    ];
    const { absorbed, byPage } = PR.groupPageResources(entries, new Set([1]));
    expect([...absorbed]).toEqual([2, 3]);
    expect(byPage.get(0)).toEqual({ inHtml: [2], extra: [3], skipped: [], htmlKnown: true, pageUrl: HOST + '/home' });
    expect(byPage.has(1)).toBe(false);
  });

  test('never attaches across a transaction boundary', () => {
    const entries = [
      marker('start', 'T01'), page('/', HTML), marker('end', 'T01'),
      marker('start', 'T02'), res('/css/site.css', 'stylesheet', 'text/css'), marker('end', 'T02'),
    ];
    const { absorbed } = PR.groupPageResources(entries, new Set());
    expect(absorbed.size).toBe(0);
  });

  test('a resource before any page stays a standalone request', () => {
    const { absorbed } = PR.groupPageResources([res('/css/site.css', 'stylesheet', 'text/css'), page('/', HTML)], new Set());
    expect(absorbed.size).toBe(0);
  });

  test('page HTML not recorded: every resource is listed explicitly', () => {
    const entries = [page('/', ''), res('/css/site.css', 'stylesheet', 'text/css'), res('/images/logo.gif', 'image', 'image/gif')];
    const { byPage } = PR.groupPageResources(entries, new Set());
    expect(byPage.get(0)).toEqual({ inHtml: [], extra: [1, 2], skipped: [], htmlKnown: false, pageUrl: HOST + '/' });
  });

  test('filtered entries, and entries the include() check rejects, are ignored', () => {
    const entries = [
      page('/', HTML),
      { ...res('/css/site.css', 'stylesheet', 'text/css'), filtered: true },
      { ...res('/images/bg.png', 'image', 'image/png'), _bg: true },
      res('/images/logo.gif', 'image', 'image/gif'),
    ];
    const { absorbed, byPage } = PR.groupPageResources(entries, new Set(), (e) => !e._bg);
    expect([...absorbed]).toEqual([3]);
    expect(byPage.get(0).inHtml).toEqual([3]);
  });

  test('a resource in the keep set (correlation source/usage) stays a standalone request', () => {
    const entries = [page('/', HTML), res('/js/config.js', 'script', 'application/javascript'), res('/css/site.css', 'stylesheet', 'text/css')];
    const { absorbed, byPage } = PR.groupPageResources(entries, new Set(), null, new Set([1]));
    expect([...absorbed]).toEqual([2]);
    expect(byPage.get(0)).toEqual({ inHtml: [2], extra: [], skipped: [], htmlKnown: true, pageUrl: HOST + '/' });
  });

  test('browser-cache hits, failed loads and repeats are absorbed but not listed', () => {
    const entries = [
      page('/', HTML),                                                             // 0
      res('/js/app.js?v=3', 'script', 'application/javascript'),                   // 1 listed
      res('/js/app.js?v=3', 'script', 'application/javascript'),                   // 2 repeat
      res('/js/cached.js', 'script', 'application/javascript', { _fromCache: 'memory' }), // 3 cache (DevTools field)
      res('/js/cached2.js', 'script', 'application/javascript', { fromCache: 'disk' }),   // 4 cache (parser field)
      res('/images/broken.gif', 'image', 'image/gif', { status: 0 }),              // 5 failed / cancelled
      res('data:image/png;base64,AAAA', 'image', 'image/png'),                    // 6 not http(s)
    ];
    const { absorbed, byPage } = PR.groupPageResources(entries, new Set());
    expect([...absorbed].sort()).toEqual([1, 2, 3, 4, 5, 6]);
    expect(byPage.get(0).extra).toEqual([1]);
    expect(byPage.get(0).skipped).toEqual([2, 3, 4, 5, 6]);
  });

  test('a POST beacon stays its own request (EXTRARES / resources[] replay as GET)', () => {
    const entries = [page('/', HTML), { url: 'https://analytics.example.com/collect', method: 'POST', status: 204, ct: '', _resourceType: 'ping' }];
    const { absorbed } = PR.groupPageResources(entries, new Set());
    expect(absorbed.size).toBe(0);
  });

  test('an iframe the page HTML names is auto-downloaded, and so are the images in its own HTML', () => {
    const parent = '<html><iframe src="/frames/news.html"></iframe></html>';
    const frameHtml = '<html><img src="/frames/news.png"></html>';
    const entries = [
      page('/', parent),                                                                          // 0
      page('/frames/news.html', frameHtml, { hdrsMap: { 'sec-fetch-dest': 'iframe' } }),          // 1 frame
      res('/frames/news.png', 'image', 'image/png'),                                              // 2 in the frame's HTML
      res('/frames/ticker.js', 'script', 'application/javascript'),                               // 3 listed
    ];
    const { absorbed, byPage } = PR.groupPageResources(entries, new Set());
    expect([...absorbed].sort()).toEqual([1, 2, 3]);
    expect(byPage.get(0)).toEqual({ inHtml: [1, 2], extra: [3], skipped: [], htmlKnown: true, pageUrl: HOST + '/' });
  });

  test('an iframe the HTML does not name (added by JavaScript) is listed, not a new page step', () => {
    const entries = [page('/', '<html></html>'), page('/ad/frame.html', '<img src="/ad.gif">', { hdrsMap: { 'sec-fetch-dest': 'iframe' } })];
    const { absorbed, byPage } = PR.groupPageResources(entries, new Set());
    expect([...absorbed]).toEqual([1]);
    expect(byPage.get(0).extra).toEqual([1]);
  });

  test('page HTML stored base64-encoded in the HAR is decoded before checking', () => {
    const b64 = Buffer.from('<html><img src="/images/logo.gif"></html>').toString('base64');
    const entries = [page('/', b64, { respEncoding: 'base64' }), res('/images/logo.gif', 'image', 'image/gif')];
    const { byPage } = PR.groupPageResources(entries, new Set());
    expect(byPage.get(0).inHtml).toEqual([1]);
  });

  test('pages with no resources are not annotated', () => {
    const { byPage } = PR.groupPageResources([page('/', HTML), xhr('/api/x')], new Set());
    expect(byPage.size).toBe(0);
  });
});
