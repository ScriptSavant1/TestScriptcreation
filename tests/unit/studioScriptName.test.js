/**
 * Script Studio: the script's name when none is typed is the recording's file name, made safe for VuGen
 * (studio-app.js scriptNameFromFile / studioScriptName).
 */
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../../src/web/public/studio-app.js'), 'utf8');
const part = src.slice(src.indexOf('function scriptNameFromFile('), src.indexOf('async function dlZip('));
const make = (S) => new Function('S', part + '; return { scriptNameFromFile, studioScriptName };')(S);
const name = make({}).scriptNameFromFile;

describe('the script name from the recording', () => {
  test.each([
    ['checkout.har', 'checkout'],
    ['My shop run.har', 'My_shop_run'],
    ['www.example.com_Archive [26-11-25 10-30-12].har', 'www_example_com_Archive_26_11_25_10_30_12'],
    ['recording (1).har', 'recording_1'],
    ['order.har.json', 'order'],
    ['capture.HAR', 'capture'],
    ['2026-11-25 login.har', 'Script_2026_11_25_login'],
    ['__a__b__.har', 'a_b'],
    ['Caf\u00e9 M\u00fcnchen.har', 'Cafe_Munchen'],
    ['C:\\fakepath\\shop.har', 'shop'],
    ['a/b/shop.har', 'shop'],
    ['\u65e5\u672c.har', ''],
    ['.har', ''],
    ['', ''],
  ])('%s', (file, want) => expect(name(file)).toBe(want));
  test('nothing given', () => { expect(name(null)).toBe(''); expect(name(undefined)).toBe(''); });
  test('never longer than 60, never ending in _', () => {
    expect(name('a'.repeat(90) + '.har')).toBe('a'.repeat(60));
    expect(name('a'.repeat(59) + ' b.har')).toBe('a'.repeat(59));
    expect(name('9'.repeat(90)).length).toBe(60);
  });
  test('always a name the page itself accepts', () => {
    ['x.har', '1.har', '-_-9.har', 'a b-c.d'].forEach((f) => expect(name(f)).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,59}$/));
  });
  test('the same in both formats; the name per format when the file name gives none, or for both at once', () => {
    const a = make({ har1Name: 'shop.har' }).studioScriptName, b = make({ har1Name: '\u65e5.har' }).studioScriptName;
    expect([a('devweb'), a('webhttp')]).toEqual(['shop', 'shop']);
    expect([b('devweb'), b('webhttp'), a('both')]).toEqual(['DevWebScript_Correlated', 'WebHttpScript_Correlated', 'DevWebScript_Correlated']);
  });
  test('a typed name still wins, and the ZIP and the .usr use the one name', () => {
    expect((src.match(/const nm = S\.scriptName \|\| \(fmt === "both" \? "(?:WebHttp|DevWeb)Script_Correlated" : studioScriptName\("(?:webhttp|devweb)"\)\);/g) || []).length).toBe(2);
    expect((src.match(/zip\.file\(nm \+ "\.usr"/g) || []).length).toBe(2);
    expect((src.match(/deliver\(blob, nm \+ "\.zip"\)/g) || []).length).toBe(2);
  });
});
