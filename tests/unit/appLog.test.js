const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const appLog = require('../../src/lib/appLog');

const MODULE = path.join(__dirname, '../../src/lib/appLog.js');

describe('appLog', () => {
  let dir;
  let log;
  const printed = {};

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'perfx-log-'));
    for (const m of ['log', 'info', 'warn', 'error']) {
      printed[m] = jest.spyOn(console, m).mockImplementation(() => {});
    }
  });

  afterEach(() => {
    if (log) log.stop();
    log = null;
    jest.restoreAllMocks();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test('writes console lines to the daily file straight away and still prints them', () => {
    log = appLog.start({ dir, now: () => new Date('2026-11-06T10:00:00Z') });
    console.error('[convert-error]', 'bad input', 42);
    const text = fs.readFileSync(path.join(dir, 'perfx-2026-11-06.log'), 'utf8');
    expect(text).toContain('INFO process start, pid');
    expect(text).toContain('2026-11-06T10:00:00.000Z ERROR [convert-error] bad input 42');
    expect(printed.error).toHaveBeenCalledWith('[convert-error]', 'bad input', 42);
  });

  test('uses a new file when the date changes', () => {
    let day = '2026-11-06';
    log = appLog.start({ dir, now: () => new Date(`${day}T23:00:00Z`) });
    day = '2026-11-07';
    console.warn('next day');
    expect(fs.readFileSync(path.join(dir, 'perfx-2026-11-07.log'), 'utf8')).toContain('WARN next day');
  });

  test('removes only its own files older than the keep period', () => {
    fs.writeFileSync(path.join(dir, 'perfx-2026-10-01.log'), 'old');
    fs.writeFileSync(path.join(dir, 'perfx-2026-11-05.log'), 'recent');
    fs.writeFileSync(path.join(dir, 'x-1234-stdout-5678.txt'), 'iisnode');
    fs.writeFileSync(path.join(dir, 'perfx-notes.log'), 'other');
    log = appLog.start({ dir, keepDays: 14, now: () => new Date('2026-11-06T10:00:00Z') });
    const names = fs.readdirSync(dir);
    expect(names).not.toContain('perfx-2026-10-01.log');
    expect(names).toEqual(expect.arrayContaining(['perfx-2026-11-05.log', 'x-1234-stdout-5678.txt', 'perfx-notes.log']));
  });

  test('a folder that cannot be used does not stop the application and is reported once', () => {
    const blocked = path.join(dir, 'a-file');
    fs.writeFileSync(blocked, 'x');
    log = appLog.start({ dir: blocked });
    console.log('one');
    console.log('two');
    expect(printed.log).toHaveBeenCalledWith('two');
    const reports = printed.error.mock.calls.filter((c) => String(c[0]).startsWith('[app-log] cannot write'));
    expect(reports).toHaveLength(1);
  });

  test('stop puts the console back', () => {
    const before = console.warn;
    log = appLog.start({ dir });
    expect(console.warn).not.toBe(before);
    log.stop();
    expect(console.warn).toBe(before);
  });

  test.each([
    ['a thrown error', "throw new Error('boom-now')", 'uncaughtException', 'Error: boom-now'],
    ['a rejected promise', "Promise.reject(new Error('boom-later'))", 'unhandledRejection', 'Error: boom-later'],
  ])('%s reaches the file before the process ends', (_name, crash, origin, message) => {
    const code = `require(${JSON.stringify(MODULE)}).start({ dir: ${JSON.stringify(dir)} }); ${crash};`;
    const run = spawnSync(process.execPath, ['-e', code], { encoding: 'utf8' });
    expect(run.status).not.toBe(0);
    const name = fs.readdirSync(dir).find((f) => f.endsWith('.log'));
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    expect(text).toContain(`FATAL ${origin}: `);
    expect(text).toContain(message);
    expect(text).toMatch(/process exit, code [1-9]/);
  });
});
