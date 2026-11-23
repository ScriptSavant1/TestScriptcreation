'use strict';

/**
 * The VuGen converter's random values (globals.h: gen_uuid, gen_csrf_token, gen_hex64; JMeter UUID.randomUUID()):
 * built from perfx_r16 / perfx_r32 — rand() gives 15 bits, so a bare "%08x" of it always began with 0000, and an
 * unseeded rand() can give two Vusers the same values. Seeded once per Vuser (time and Vuser id). The same rule as
 * Script Studio's PERFX_RAND_C (tests/unit/studioUuidGen.test.js).
 */

const WebHttpScriptGenerator = require('../../src/generators/vugen/scriptGenerator.js');

const gen = () => new WebHttpScriptGenerator([], { info: { name: 'Sample' } }, {});
const bareRand = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/static int perfx_r16\(void\) \{[\s\S]*?\n\}/, '').match(/(^|[^_\w])rand\(\)/g) || [];

describe('globals.h — the random helpers', () => {
  const g = gen().generateGlobalsH();
  test('seeded once per Vuser; every helper built from perfx_r16 / perfx_r32', () => {
    expect(g).toContain('static int perfx_r16(void)');
    expect(g).toContain('srand((unsigned int)time(0) ^ (unsigned int)(id * 7919));');
    expect(g).toContain('static unsigned int perfx_r32(void)');
    expect(bareRand(g)).toEqual([]);
  });
  test('gen_uuid: a version 4 UUID from eight 16-bit groups', () => {
    expect(g).toContain('"%04x%04x-%04x-4%03x-%04x-%04x%04x%04x"');
    expect(g).toContain('(perfx_r16() & 0x3fff) | 0x8000');
  });
  test('the helpers come before their use, inside the include guard', () => {
    expect(g.indexOf('perfx_r16(void)')).toBeLessThan(g.indexOf('static void gen_uuid('));
    expect(g.indexOf('static void gen_uuid(')).toBeLessThan(g.indexOf('#endif'));
  });
});

describe('JMeter: UUID.randomUUID() in a JSR223 script', () => {
  test('becomes gen_uuid("_uuid") — no bare rand(), a real version 4 UUID', () => {
    const c = gen().convertJsr223Script({ code: 'vars.put("requestId", UUID.randomUUID().toString());', lang: 'groovy' }, 'pre', '    ');
    expect(c).toContain('gen_uuid("_uuid");');
    expect(c).toContain('lr_save_string(lr_eval_string("{_uuid}"), "requestId");');
    expect(bareRand(c)).toEqual([]);
  });
});
