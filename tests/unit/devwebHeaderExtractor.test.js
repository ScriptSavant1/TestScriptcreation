'use strict';

/**
 * BUG-125: a DevWeb extractor reading a response header came back empty. The real engine checks each header on its
 * own as `Name: value`, with no line ending, so a right boundary of \r\n never matches. It also sorts the query of a
 * Location it follows, so "read to the end" or "up to the next &" cannot find a query value. Both checked with the
 * real DevWeb engine. VuGen reads \r\n correctly, so the stored correlation keeps it.
 */

const fs = require('fs');
const path = require('path');
const CorrelationDetector = require('../../src/analyzers/correlationDetector.js');

const PUB = path.resolve(__dirname, '../../src/web/public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
const studio = new Function(
  ['shared/vugen-codegen.js', 'VuGen-Script-Studio-constants.js', 'VuGen-Script-Studio-correlation.js', 'studio-advisor.js', 'studio-codegen.js'].map(read).join('\n') +
  '\nreturn { devwebExtractorDecl, webHttpCorrCode };',
)();

const decl = (cfg, extractorType = 'boundary_header') => studio.devwebExtractorDecl({ name: 'v', extractorType, extractorConfig: cfg });
const SCOPE = 'scope: load.ExtractorScope.Headers';

describe('Studio / HAR Explorer devwebExtractorDecl() — boundary_header', () => {
  test.each([
    ['whole header', 'X-Trace: ', '\r\n'],
    ['lower-case name', 'x-trace: ', '\r\n'],
    ['end of a Location path', '/as/', '\r\n'],
    ['the HAR Explorer form with a full address', 'Location: https://h.test/order/', '\r\n'],
    ['a bare line feed', 'X-Trace: ', '\n'],
    ['no right boundary at all', 'X-Trace: ', ''],
  ])('%s reads to the end of the header', (_, lb, rb) => {
    expect(decl({ lb, rb })).toBe(`new load.BoundaryExtractor("v", {leftBoundary: ${JSON.stringify(lb)}, rightBoundary: "", ${SCOPE}})`);
  });

  test('a relative Location is matched by its path: the engine reads it as a full address', () => {
    expect(decl({ lb: 'Location: /order/', rb: '\r\n' })).toBe(`new load.BoundaryExtractor("v", {leftBoundary: "/order/", rightBoundary: "", ${SCOPE}})`);
  });

  test('a config with no rb reads to the end of the header', () => {
    expect(decl({ lb: 'X-Trace: ' })).toContain('rightBoundary: ""');
  });

  test.each([
    ['ends the query', 'state=', '\r\n'],
    ['before the next parameter', 'state=', '&'],
  ])('a query value that %s is found wherever the sorted query puts it', (_, lb, rb) => {
    expect(decl({ lb, rb })).toBe(`new load.RegexpExtractor("v", {expression: "[?&]state=([^&]*)", flags: "", ${SCOPE}})`);
  });

  test('the HAR Explorer form of a query value uses the parameter, not the whole address', () => {
    expect(decl({ lb: 'Location: https://h.test/next?a=1&state=', rb: '\r\n' })).toContain('expression: "[?&]state=([^&]*)"');
  });

  test('regular expression characters in a parameter name are escaped', () => {
    expect(decl({ lb: 'a.b=', rb: '&' })).toContain('expression: "[?&]a\\\\.b=([^&]*)"');
  });

  test.each([
    ['a path segment', '/as/', '/'],
    ['a segment before the query', '/as/', '?'],
    ['a value inside a header', 'X-Mid: pre=', ';'],
    ['text after the value', 'X-Mid: pre=', 'END'],
    ['a named header with & after the value', 'X-Mid: pre=', '&'],
  ])('%s keeps its boundaries', (_, lb, rb) => {
    expect(decl({ lb, rb })).toBe(`new load.BoundaryExtractor("v", {leftBoundary: ${JSON.stringify(lb)}, rightBoundary: ${JSON.stringify(rb)}, ${SCOPE}})`);
  });

  test('a left boundary cut from a long header value (30 characters) is not taken for a query parameter', () => {
    const lb = 'a'.repeat(29) + '=';
    expect(decl({ lb, rb: '&' })).toContain('new load.BoundaryExtractor(');
  });
});

describe('what must not change', () => {
  test('a body boundary keeps its \\r\\n', () => {
    expect(decl({ lb: 'id=', rb: '\r\n' }, 'boundary')).toBe('new load.BoundaryExtractor("v", {leftBoundary: "id=", rightBoundary: "\\r\\n", scope: load.ExtractorScope.Body})');
  });

});

/**
 * BUG-126: Studio's VuGen writer ignored the stored right boundary, so a value inside a header came with the text
 * after it. BUG-127: VuGen compares the left boundary's case, and Studio stores header names in lower case.
 * Scope= needs SEARCH_FILTERS before it (Error -26396). All checked with the real VuGen engine.
 */
describe('Studio / HAR Explorer webHttpCorrCode() — boundary_header', () => {
  const vugen = (lb, rb) => studio.webHttpCorrCode({ name: 'v', extractorType: 'boundary_header', extractorConfig: { lb, rb } }, '\t');

  test('a whole header reads to the line ending, in any case of the name', () => {
    const code = vugen('x-trace: ', '\r\n');
    expect(code).toContain('"LB/IC=x-trace: "');
    expect(code).toContain('"RB=\\r\\n"');
    expect(code).toContain('"Search=Headers"');
  });

  test('a value inside a named header stops at its right boundary', () => {
    const code = vugen('X-Mid: pre=', ';');
    expect(code).toContain('"LB/IC=X-Mid: pre="');
    expect(code).toContain('"RB=;"');
  });

  test.each([['/as/', '/'], ['/as/', '?']])('an address segment %s keeps its case and right boundary %s', (lb, rb) => {
    const code = vugen(lb, rb);
    expect(code).toContain(`"LB=${lb}"`);
    expect(code).toContain(`"RB=${rb}"`);
  });

  test('no stored right boundary reads to the line ending', () => {
    expect(vugen('X-Trace: ', '')).toContain('"RB=\\r\\n"');
  });

  test.each([
    ['before the next parameter', 'code=', '&'],
    ['at the end of the query', 'code=', '\r\n'],
    ['the HAR Explorer form', 'Location: https://h.test/next?a=1&code=', '\r\n'],
  ])('a query value %s is read by regular expression, so auth_code= is not taken for code=', (_, lb, rb) => {
    expect(vugen(lb, rb)).toBe(
      '\tweb_reg_save_param_regexp("ParamName=v",\n\t    "RegExp=[?&]code=([^&\\\\r\\\\n]*)",\n\t    "Group=1",\n\t    "Ordinal=1",\n\t    SEARCH_FILTERS,\n\t    "Scope=Headers",\n\t    LAST);\n',
    );
  });

  test('the server-side copy of the shared writer gives the same regexp and ignore-case output', () => {
    const core = require('../../src/core/vugenCodegen.js');
    expect(core.emitRegexp('v', { pattern: 'a(b)', scope: 'Headers' }, '\t')).toContain('SEARCH_FILTERS,\n\t    "Scope=Headers",\n\t    LAST);');
    expect(core.emitRegexp('v', { pattern: 'a(b)' }, '\t')).not.toContain('SEARCH_FILTERS');
    expect(core.emitBoundary('v', { lb: 'X: ', rb: ';', ignoreCase: true }, '\t')).toContain('"LB/IC=X: "');
    expect(core.emitBoundary('v', { lb: 'id=', rb: ';' }, '\t')).toContain('"LB=id="');
  });

  test('a cookie stays case-sensitive: cookie names are', () => {
    expect(studio.webHttpCorrCode({ name: 'v', extractorType: 'cookie', extractorConfig: { cookieName: 'sid' } }, '')).toContain('"LB=sid="');
  });
});

describe('Converter generateExtractor()', () => {
  const gen = (c) => new CorrelationDetector().generateExtractor(c);

  test('a header read reads to the end of the header', () => {
    expect(gen({ name: 'tok', extractorType: 'header', extractPath: 'X-Token' }))
      .toBe(`new load.BoundaryExtractor("tok", { leftBoundary: "X-Token: ", rightBoundary: "", ${SCOPE} })`);
  });

  test.each(['\r\n', '\n', '\r'])('a JMX boundary in the headers with only a line ending as right boundary (%j)', (rightBound) => {
    expect(gen({ name: 'tok', extractorType: 'boundary', leftBound: 'X-Token: ', rightBound, scope: 'response_headers' }))
      .toBe(`new load.BoundaryExtractor("tok", { leftBoundary: "X-Token: ", rightBoundary: "", ${SCOPE} })`);
  });

  test('a JMX boundary in the headers with a real right boundary is unchanged', () => {
    expect(gen({ name: 'tok', extractorType: 'boundary', leftBound: 'sid=', rightBound: ';', scope: 'response_headers' }))
      .toBe(`new load.BoundaryExtractor("tok", { leftBoundary: "sid=", rightBoundary: ";", ${SCOPE} })`);
  });

  test('a JMX boundary in the body keeps its line ending', () => {
    expect(gen({ name: 'tok', extractorType: 'boundary', leftBound: 'id=', rightBound: '\r\n' }))
      .toBe('new load.BoundaryExtractor("tok", "id=", "\\r\\n")');
  });

  test('a JMX boundary on the address keeps its right boundary', () => {
    expect(gen({ name: 'tok', extractorType: 'boundary', leftBound: 'id=', rightBound: '\n', scope: 'url' }))
      .toBe('new load.BoundaryExtractor("tok", { leftBoundary: "id=", rightBoundary: "\\n", scope: load.ExtractorScope.Url })');
  });
});
