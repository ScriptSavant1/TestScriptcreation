'use strict';

/**
 * Regression guard for lre-utils.js / lre-utils.dat — VuGen's JS engine (used
 * by web_js_run) does NOT accept modern JavaScript. It is ES3-restricted:
 * no trailing commas in object/array literals or function calls (illegal
 * until ES5/ES2017 respectively), no let/const/arrow functions/Map/etc.
 *
 * This exact bug class has broken production code TWICE:
 *   - BUG-040: 21 trailing commas (18 in function calls, 3 in array
 *     literals) caused "SyntaxError" at line 1589 when VuGen loaded the file.
 *   - This test's own reason for existing: 3 MORE trailing commas — this
 *     time in OBJECT literals, a category BUG-040's cleanup didn't cover —
 *     survived undetected in _generateDpopKeyPair(), generateDpopProof(),
 *     and createJWT(). A real user hit "SyntaxError: invalid label" running
 *     a DPoP script in actual VuGen; `node --check` (used throughout this
 *     project's session-end checklist) never catches this class of bug
 *     because Node's parser has supported trailing commas in object/array
 *     literals since ES5/ES2015 and simply accepts them silently.
 *
 * `node --check` therefore CANNOT be trusted as the compatibility gate for
 * this specific file — only a parser configured for the actual target
 * grammar can catch it. This test uses acorn with `ecmaVersion: 3`, which
 * rejects every construct above, as an automated substitute for manually
 * re-running the file through a real VuGen `web_js_run` on every change.
 */

const fs = require('fs');
const path = require('path');
const acorn = require('acorn');

const FILES = ['lre-utils.js', 'lre-utils.dat'];

describe('lre-utils.js / lre-utils.dat — ES3 compatibility (VuGen JS engine)', () => {
  test.each(FILES)('%s parses cleanly under strict ES3 grammar', (filename) => {
    const filePath = path.resolve(__dirname, '../../', filename);
    const code = fs.readFileSync(filePath, 'utf8');

    let parseError = null;
    try {
      acorn.parse(code, { ecmaVersion: 3, sourceType: 'script' });
    } catch (e) {
      parseError = e;
    }

    if (parseError) {
      const near = code.slice(Math.max(0, parseError.pos - 60), parseError.pos + 20);
      throw new Error(
        `${filename} is not ES3-compatible (VuGen's JS engine will reject it): ` +
        `${parseError.message} at line ${parseError.loc.line}, col ${parseError.loc.column}.\n` +
        `Context: ...${near}...\n` +
        `Common causes: trailing comma in an object/array literal or function call, ` +
        `let/const, arrow functions, template literals, Map/Set, for...of, destructuring.`
      );
    }
  });

  test('lre-utils.js and lre-utils.dat are byte-identical', () => {
    const jsPath = path.resolve(__dirname, '../../lre-utils.js');
    const datPath = path.resolve(__dirname, '../../lre-utils.dat');
    const jsContent = fs.readFileSync(jsPath, 'utf8');
    const datContent = fs.readFileSync(datPath, 'utf8');
    expect(datContent).toBe(jsContent);
  });

  test('no trailing comma immediately precedes a closing brace or bracket', () => {
    // Independent, non-parser cross-check for the exact BUG-040 / this-bug
    // pattern. Deliberately simpler than the acorn check above so a bug in
    // one method doesn't hide a bug from the other.
    const filePath = path.resolve(__dirname, '../../lre-utils.js');
    const code = fs.readFileSync(filePath, 'utf8');
    const matches = code.match(/,\s*[}\]]/g) || [];
    expect(matches).toEqual([]);
  });
});
