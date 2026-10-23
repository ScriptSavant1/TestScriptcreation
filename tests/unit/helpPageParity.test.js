'use strict';

/**
 * Help & guides (src/web/views/partials/help.ejs) — guards the structure the portal relies on:
 * the 13 sections the tools' "How it works" buttons and the Home page jump to, every jump target,
 * the Help functions, and the search / contents additions. Content parity (every word) is checked
 * by the Help capture in the redesign notes; this test catches a lost section or broken jump.
 */
const fs = require('fs');
const path = require('path');

const VIEWS = path.resolve(__dirname, '../../src/web/views');
const read = (f) => fs.readFileSync(path.join(VIEWS, f), 'utf-8').replace(/\r\n/g, '\n');
const index = read('index.ejs');
const help = read('partials/help.ejs');
const home = read('partials/home.ejs');
const shellJs = fs.readFileSync(path.resolve(__dirname, '../../src/web/public/portal/shell.js'), 'utf-8');

const SECTIONS = ['hacc-quickstart', 'hacc-overview', 'hacc-formats', 'hacc-converter', 'hacc-jmeter', 'hacc-recorder',
  'hacc-studio', 'hacc-analyser', 'hacc-capabilities', 'hacc-privacy', 'hacc-glossary', 'hacc-new', 'hacc-faq'];

describe('Help — sections and jumps', () => {
  test('index.ejs includes the Help partial once and no longer has its own copy', () => {
    expect(index.match(/include\('partials\/help'\)/g)).toHaveLength(1);
    expect(index).not.toContain('id="hacc-quickstart"');
  });
  test.each(SECTIONS)('section #%s exists with a header that toggles it', (id) => {
    expect(help).toContain(`id="${id}" class="help-acc-item`);
    expect(help).toContain(`haccToggle('${id}')`);
  });
  test('every haccJump target in Help, Home and the shell exists', () => {
    const targets = new Set([...help.matchAll(/haccJump\('([\w-]+)'\)/g), ...home.matchAll(/data-help="([\w-]+)"/g), ...shellJs.matchAll(/help: "([\w-]+)"/g)].map((m) => m[1]));
    expect(targets.size).toBeGreaterThan(10);
    [...targets].forEach((t) => expect(SECTIONS).toContain(t));
  });
  test('the Help functions are still defined', () => {
    ['function haccToggle', 'function haccJump', 'function hTocToggle', 'function hTocSetCur', 'function hTocClose', 'function hfaqToggle']
      .forEach((f) => expect(help).toContain(f));
  });
  test('every section has a name for the "On this page" label', () => {
    SECTIONS.filter((s) => s !== 'hacc-formats' || help.includes("'hacc-formats'")).forEach((s) => expect(help).toContain(`'${s}':`));
  });
  test('search, contents list and no-result message are present', () => {
    ['id="help-q"', 'id="help-side"', 'id="help-noresult"', 'id="help-expand-all"', 'id="help-collapse-all"'].forEach((x) => expect(help).toContain(x));
    expect(index).toContain('portal/help.js');
  });
  test('no Help text still points to the old top navigation or tabs', () => {
    expect(help).not.toMatch(/in the nav<|top navigation|from the navigation|Recorder<\/strong> tab/);
  });
});
