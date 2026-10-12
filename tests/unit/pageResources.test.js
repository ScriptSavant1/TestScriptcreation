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
const page = (path, html, extra = {}) => ({ url: HOST + path, method: 'GET', ct: 'text/html', _resourceType: 'document', respBody: html, ...extra });
const res = (url, type, ct) => ({ url: url.startsWith('http') ? url : HOST + url, method: 'GET', ct, _resourceType: type });
const xhr = (path) => ({ url: HOST + path, method: 'GET', ct: 'application/json', _resourceType: 'xhr' });
const marker = (type, name) => ({ isMarker: true, markerType: type, txnName: name, url: '' });

const HTML = '<html><link href="/css/site.css"><img src="../images/logo.gif"><script src="https://shop.example.com/js/app.js?v=3"></script></html>';

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
    expect(PR.isResourceEntry(xhr('/api/items'))).toBe(false);
    expect(PR.isResourceEntry({ url: HOST + '/upload.png', method: 'POST', ct: 'image/png' })).toBe(false);
  });
});

describe('referencedInHtml', () => {
  test('matches absolute, root-relative and relative references', () => {
    expect(PR.referencedInHtml(HOST + '/js/app.js?v=3', HTML)).toBe(true);
    expect(PR.referencedInHtml(HOST + '/css/site.css', HTML)).toBe(true);
    expect(PR.referencedInHtml(HOST + '/images/logo.gif', HTML)).toBe(true);
  });
  test('does not match a resource the HTML never mentions', () => {
    expect(PR.referencedInHtml(HOST + '/images/sprite.png', HTML)).toBe(false);
    expect(PR.referencedInHtml('https://www.google-analytics.com/g/collect?v=2', HTML)).toBe(false);
  });
  test('decodes &amp; in HTML attributes', () => {
    expect(PR.referencedInHtml(HOST + '/img?a=1&b=2', '<img src="/img?a=1&amp;b=2">')).toBe(true);
  });
  test('no HTML recorded means not referenced', () => {
    expect(PR.referencedInHtml(HOST + '/css/site.css', '')).toBe(false);
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
    expect(byPage.get(0)).toEqual({ inHtml: [1, 2, 3], extra: [5, 6], htmlKnown: true });
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
      { url: HOST + '/login', method: 'POST', ct: 'text/html', _resourceType: 'document', status: 302, respBody: '' }, // 0 emitted
      page('/home', HTML, { status: 200 }),                                // 1 redirect target (auto-follow, not emitted)
      res('/css/site.css', 'stylesheet', 'text/css'),                      // 2
      res('/images/other.png', 'image', 'image/png'),                      // 3
    ];
    const { absorbed, byPage } = PR.groupPageResources(entries, new Set([1]));
    expect([...absorbed]).toEqual([2, 3]);
    expect(byPage.get(0)).toEqual({ inHtml: [2], extra: [3], htmlKnown: true });
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
    expect(byPage.get(0)).toEqual({ inHtml: [], extra: [1, 2], htmlKnown: false });
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
    expect(byPage.get(0)).toEqual({ inHtml: [2], extra: [], htmlKnown: true });
  });

  test('pages with no resources are not annotated', () => {
    const { byPage } = PR.groupPageResources([page('/', HTML), xhr('/api/x')], new Set());
    expect(byPage.size).toBe(0);
  });
});
