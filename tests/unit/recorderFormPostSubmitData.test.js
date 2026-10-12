'use strict';

/**
 * Recorder tool (VuGen-Recorder-generators.js) — HTML form POSTs must be
 * generated as web_submit_data + ITEMDATA, the way VuGen records them in HTML
 * mode, not as web_custom_request + BodyBinary (URL-mode style).
 *
 * User report: the same HAR produced HTML-mode code in Script Studio but
 * URL-mode style code in the Recorder. Studio's genActionC already used
 * web_submit_data for application/x-www-form-urlencoded POSTs; the Recorder
 * emitted every POST as web_custom_request. JSON/XML/other bodies must stay
 * web_custom_request in both tools.
 *
 * Loads the real generators file into a Function scope, with stubs for the
 * helpers it takes from the Recorder's other scripts (ui/parsers).
 */

const fs = require('fs');
const path = require('path');

function loadRecorderGenerators(S) {
  const code = fs.readFileSync(
    path.resolve(__dirname, '../../src/web/public/VuGen-Recorder-generators.js'),
    'utf-8'
  );
  const stubs =
    "function escJs(s){ return(s||'').replace(/\\\\/g,'\\\\\\\\').replace(/\"/g,'\\\\\"'); }\n" +
    'function escBodyBinary(s){ return s; }\n' +
    'function buildHdrHostMap(){ return {}; }\n' +
    'function subHdrValC(v){ return v; }\n';
  const PageResources = require('../../src/web/public/shared/page-resources.js');
  // eslint-disable-next-line no-new-func
  const factory = new Function('S', 'PageResources', stubs + code + '\nreturn { genActionC, parseFormUrlEncoded };');
  return factory(S, PageResources);
}

function post(url, mimeType, text) {
  return {
    method: 'POST', url, status: 200, ct: 'text/html', referer: '',
    reqHdrs: [{ name: 'Content-Type', value: mimeType }],
    hdrsMap: { 'content-type': mimeType },
    body: { mimeType, text },
    filtered: false, isMarker: false,
  };
}

function baseState(entries) {
  return { entries, txns: [], auth: null, serverHost: null, hasDpop: false };
}

describe('Recorder genActionC — form POSTs use web_submit_data (HTML mode)', () => {
  test('urlencoded form POST becomes web_submit_data with decoded ITEMDATA fields', () => {
    const S = baseState([
      post('https://app.example.com/session', 'application/x-www-form-urlencoded',
        'authenticity_token=abc%2B1&username=test.user&message=hello+world%21'),
    ]);
    const out = loadRecorderGenerators(S).genActionC();

    expect(out).toContain('web_submit_data("session",');
    expect(out).toContain('"Action=https://app.example.com/session",');
    expect(out).toContain('"Method=POST",');
    expect(out).toContain('"Mode=HTML",');
    expect(out).toContain('ITEMDATA,');
    expect(out).toContain('"Name=authenticity_token","Value=abc+1",ENDITEM,');
    expect(out).toContain('"Name=username","Value=test.user",ENDITEM,');
    expect(out).toContain('"Name=message","Value=hello world!",ENDITEM,');
    expect(out).not.toContain('web_custom_request');
    expect(out).not.toContain('BodyBinary=');
  });

  test('JSON POST stays web_custom_request with BodyBinary', () => {
    const S = baseState([
      post('https://app.example.com/api/orders', 'application/json', '{"itemId":"itm-1","quantity":2}'),
    ]);
    const out = loadRecorderGenerators(S).genActionC();

    expect(out).toContain('web_custom_request("orders",');
    expect(out).toContain('"EncType=application/json",');
    expect(out).toContain('BodyBinary={"itemId":"itm-1","quantity":2}');
    expect(out).not.toContain('web_submit_data');
  });

  test('urlencoded body without any name=value pair stays web_custom_request', () => {
    const S = baseState([
      post('https://app.example.com/ping', 'application/x-www-form-urlencoded', 'keepalive'),
    ]);
    const out = loadRecorderGenerators(S).genActionC();
    expect(out).toContain('web_custom_request("ping",');
    expect(out).not.toContain('web_submit_data');
  });

  test('a form value containing a double quote is escaped for the C string', () => {
    const S = baseState([
      post('https://app.example.com/comment', 'application/x-www-form-urlencoded', 'text=say+%22hi%22'),
    ]);
    const out = loadRecorderGenerators(S).genActionC();
    expect(out).toContain('"Name=text","Value=say \\"hi\\"",ENDITEM,');
  });
});

describe('Recorder genActionC — included static resources belong to their page step', () => {
  test('HTML-referenced resources are not scripted; script-loaded ones go under EXTRARES', () => {
    const get = (url, ct, rt, extra = {}) => ({
      method: 'GET', url, status: 200, ct, _resourceType: rt, referer: 'https://shop.example.com/',
      reqHdrs: [], hdrsMap: {}, body: null, filtered: false, isMarker: false, ...extra,
    });
    const S = baseState([
      get('https://shop.example.com/', 'text/html', 'document', { referer: '', respBody: '<img src="/img/logo.gif">' }),
      get('https://shop.example.com/img/logo.gif', 'image/gif', 'image'),
      get('https://www.google-analytics.com/collect?v=1', 'image/gif', 'image'),
    ]);
    const out = loadRecorderGenerators(S).genActionC();

    expect((out.match(/web_url\(/g) || []).length).toBe(1);
    expect(out).not.toContain('logo.gif');
    expect(out).toContain('// Page resources: 1 in the page HTML download automatically (Mode=HTML); 1 loaded by script/CSS is listed under EXTRARES');
    expect(out).toContain('"Mode=HTML",\n\t\tEXTRARES,\n\t\t"Url=https://www.google-analytics.com/collect?v=1", "Referer=https://shop.example.com/", ENDITEM,\n\t\tLAST);');
  });
});

describe('parseFormUrlEncoded', () => {
  const { parseFormUrlEncoded } = loadRecorderGenerators(baseState([]));

  test('decodes names and values, + as space, keeps empty values', () => {
    expect(parseFormUrlEncoded('a=1&b%5B%5D=x+y&c=&d')).toEqual([
      { k: 'a', v: '1' },
      { k: 'b[]', v: 'x y' },
      { k: 'c', v: '' },
      { k: 'd', v: '' },
    ]);
  });

  test('keeps malformed percent-encoding as-is instead of throwing', () => {
    expect(parseFormUrlEncoded('x=100%')).toEqual([{ k: 'x', v: '100%' }]);
  });
});
