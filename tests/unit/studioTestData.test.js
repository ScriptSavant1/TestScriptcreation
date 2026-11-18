/**
 * Script Studio — Test data (portal/studio-testdata.js + the parameter writers in studio-codegen.js): the user's
 * renamed, removed and added parameters, how each takes its value (next / random / unique row, each iteration / once),
 * a shared data file or an own one, and the rows read from Excel.
 */
const fs = require('fs');
const path = require('path');
const TestData = require('../../src/web/public/portal/studio-testdata.js');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf-8').replace(/^﻿/, '');
global.RequestFilter = require('../../src/web/public/shared/request-filter.js');
global.VugenCodegen = require('../../src/web/public/shared/vugen-codegen.js');
global.PageResources = require('../../src/web/public/shared/page-resources.js');
global.HostParams = require('../../src/web/public/shared/host-params.js');

function engine() {
  const doc = { getElementById: () => null, querySelectorAll: () => [], querySelector: () => null };
  // eslint-disable-next-line no-new-func
  return new Function('document', 'window', read('VuGen-Script-Studio-constants.js') + '\n' + read('VuGen-Script-Studio-correlation.js') + '\n' + read('studio-codegen.js') +
    '\nreturn { S, genParamFilePrm, genParamsYml, genCollectionDataCsv, genParamDataFiles, genScriptUploadMetadata };')(doc, { location: { pathname: '/converter/studio' } });
}

const entries = [
  { id: 1, url: 'https://shop.example.com/search?q=running+shoes&page=2', method: 'GET', isMarker: false, filtered: false },
  { id: 2, url: 'https://shop.example.com/login', method: 'POST', isMarker: false, filtered: false, body: { mimeType: 'application/x-www-form-urlencoded', text: 'user=jo&pass=secret1' } },
  { id: 3, url: 'https://api.example.com/cart', method: 'POST', isMarker: false, filtered: false, body: { mimeType: 'application/json', text: '{"item":{"sku":"SKU-77","qty":2},"note":"running shoes"}' } },
  { id: 4, url: 'https://cdn.example.com/x.js?q=running+shoes', method: 'GET', isMarker: false, filtered: true },
];
const detected = [
  { name: 'Username', csvKey: 'username', value: 'jo', usages: [{ reqIdx: 1, key: 'user', location: 'body_form' }] },
  { name: 'Password', csvKey: 'password', value: 'secret1', usages: [{ reqIdx: 1, key: 'pass', location: 'body_form' }] },
];

describe('TestData.usagesOf — where the script sends a value', () => {
  test('query (decoded), form field and JSON body; left-out requests are not uses', () => {
    expect(TestData.usagesOf(entries, 'running shoes')).toEqual([
      { reqIdx: 0, key: 'q', location: 'query' },
      { reqIdx: 2, key: 'note', location: 'body_json' },
    ]);
    expect(TestData.usagesOf(entries, 'SKU-77')).toEqual([{ reqIdx: 2, key: 'sku', location: 'body_json' }]);
    expect(TestData.usagesOf(entries, 'jo')).toEqual([{ reqIdx: 1, key: 'user', location: 'body_form' }]);
    expect(TestData.usagesOf(entries, 'not-sent')).toEqual([]);
  });
});

describe('TestData.apply — the user\'s choices on the detected parameters', () => {
  test('no choices: the same parameters (each marked with its first name)', () => {
    const out = TestData.apply(detected, {}, entries);
    expect(out.map((p) => [p.csvKey, p._orig, p.value])).toEqual([['username', 'username', 'jo'], ['password', 'password', 'secret1']]);
    expect(detected[0]._orig).toBeUndefined();   // the detected list is not changed
  });
  test('rename, remove, settings, rows and an added parameter', () => {
    const ed = { by: { username: { name: 'UserName', take: 'unique', file: 'username_data', rows: ['jo', 'ann', 'li'] }, password: { removed: true } },
      added: [{ name: 'SearchTerm', value: 'running shoes', take: 'random', update: 'once' }] };
    const out = TestData.apply(detected, ed, entries);
    expect(out.map((p) => p.csvKey)).toEqual(['UserName', 'SearchTerm']);
    expect([out[0].take, out[0].file, out[0].rows, out[0]._orig]).toEqual(['unique', 'username_data', ['jo', 'ann', 'li'], 'username']);
    expect([out[1]._added, out[1].take, out[1].update, out[1].usages.length]).toEqual([true, 'random', 'once', 2]);
  });
  test('an added name that is already a parameter is not added twice', () => {
    expect(TestData.apply(detected, { added: [{ name: 'username', value: 'jo' }] }, entries).length).toBe(2);
  });
  test('nameError', () => {
    expect(TestData.nameError('', [])).toMatch(/Enter/);
    expect(TestData.nameError('9a', [])).toMatch(/starts with a letter/);
    expect(TestData.nameError('Username', ['username'])).toMatch(/already used/);
    expect(TestData.nameError('username', ['username'], 'username')).toBe('');
  });
});

describe('the parameter files the script gets', () => {
  test('without choices the files are exactly as before', () => {
    const E = engine();
    E.S.params = detected.map((p) => Object.assign({}, p));
    expect(E.genParamFilePrm()).toContain('GenerateNewVal="EachIteration"');
    expect(E.genParamFilePrm()).toContain('SelectNextRow="Sequential"');
    expect(E.genParamFilePrm()).toContain('Table="collection_data.dat"');
    expect(E.genCollectionDataCsv()).toBe('username,password\njo,secret1\n');
    expect(E.genParamsYml()).toBe('parameters:\n' +
      '  - name: username\n    type: csv\n    fileName: collection_data.csv\n    columnName: username\n    nextValue: iteration\n    nextRow: sequential\n    onEnd: loop\n' +
      '  - name: password\n    type: csv\n    fileName: collection_data.csv\n    columnName: password\n    nextValue: iteration\n    nextRow: sequential\n    onEnd: loop\n');
    expect(Object.keys(E.genParamDataFiles())).toEqual(['collection_data']);
  });
  test('take, update, own file and rows go into .prm, parameters.yml and the data files', () => {
    const E = engine();
    E.S.params = TestData.apply(detected, { by: { username: { take: 'unique', update: 'once', file: 'username_data', rows: ['jo', 'ann', 'li'] }, password: { take: 'random', rows: ['p1', 'p2'] } } }, entries);
    const prm = E.genParamFilePrm();
    expect(prm).toMatch(/\[parameter:username\][\s\S]*GenerateNewVal="Once"[\s\S]*SelectNextRow="Unique"[\s\S]*Table="username_data\.dat"/);
    expect(prm).toMatch(/\[parameter:password\][\s\S]*SelectNextRow="Random"[\s\S]*Table="collection_data\.dat"/);
    const yml = E.genParamsYml();
    expect(yml).toContain('  - name: username\n    type: csv\n    fileName: username_data.csv\n    columnName: username\n    nextValue: once\n    nextRow: unique\n');
    expect(yml).toContain('nextRow: random');
    expect(E.genParamDataFiles()).toEqual({ collection_data: 'password\np1\np2\n', username_data: 'username\njo\nann\nli\n' });
    expect(E.genCollectionDataCsv()).toBe('password\np1\np2\n');
    expect(E.genScriptUploadMetadata('X')).toContain('<FileEntry Name="username_data.dat" Filter="4" />');
  });
  test('in one file, a parameter with fewer rows repeats its last value; commas and quotes are quoted', () => {
    const E = engine();
    E.S.params = [{ csvKey: 'a', value: '1', usages: [], rows: ['1', '2', '3'] }, { csvKey: 'b', value: 'x,y', usages: [{ reqIdx: 1, key: 'b', location: 'body_form' }], rows: ['x,y', 'say "hi"'] }];
    expect(E.genCollectionDataCsv()).toBe('a,b\n1,"x,y"\n2,"say ""hi"""\n3,"say ""hi"""\n');
  });
});
