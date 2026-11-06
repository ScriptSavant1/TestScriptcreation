/**
 * appLog.js — the application's own log file, one per day: logs/perfx-YYYY-MM-DD.log
 *
 * iisnode already saves what the process prints, but through a pipe and into a new
 * file per process, so the last lines before a crash can be lost and it is hard to
 * see which file is current. This copies every console line to one daily file with
 * a synchronous write, and records start, exit and crashes.
 *
 * A folder that cannot be written never stops the application: the problem is
 * reported once on the console and logging to the file stops.
 */

const fs = require('fs');
const path = require('path');
const util = require('util');

const LEVELS = { log: 'INFO', info: 'INFO', warn: 'WARN', error: 'ERROR' };
const FILE_RE = /^perfx-(\d{4}-\d{2}-\d{2})\.log$/;

/** Removes daily log files older than keepDays; other files in the folder are left alone. */
function removeOldLogs(dir, keepDays, today) {
  const cutoff = today.getTime() - keepDays * 86400000;
  for (const name of fs.readdirSync(dir)) {
    const m = FILE_RE.exec(name);
    if (m && new Date(m[1] + 'T00:00:00Z').getTime() < cutoff) fs.unlinkSync(path.join(dir, name));
  }
}

/**
 * Starts the log. Options are for tests; the folder can also be set with PERFX_LOG_DIR.
 * @returns {{file: function(): string, stop: function(): void}}
 */
function start(options = {}) {
  const dir = options.dir || process.env.PERFX_LOG_DIR || path.join(__dirname, '..', '..', 'logs');
  const keepDays = options.keepDays || 14;
  const now = options.now || (() => new Date());
  const original = {};
  let working = true;

  const file = () => path.join(dir, `perfx-${now().toISOString().slice(0, 10)}.log`);
  const write = (level, text) => {
    if (!working) return;
    try {
      fs.appendFileSync(file(), `${now().toISOString()} ${level} ${text}\n`);
    } catch (err) {
      working = false;
      (original.error || console.error)(`[app-log] cannot write to ${dir}: ${err.message}`);
    }
  };

  try {
    fs.mkdirSync(dir, { recursive: true });
    removeOldLogs(dir, keepDays, now());
  } catch (err) {
    console.error(`[app-log] log folder problem in ${dir}: ${err.message}`);
  }

  for (const method of Object.keys(LEVELS)) {
    original[method] = console[method];
    console[method] = (...args) => {
      write(LEVELS[method], util.format(...args));
      original[method].apply(console, args);
    };
  }

  // The Monitor event only observes: Node still prints the error and ends the process as usual.
  const onCrash = (err, origin) => write('FATAL', `${origin}: ${(err && err.stack) || err}`);
  const onExit = (code) => write('INFO', `process exit, code ${code}`);
  process.on('uncaughtExceptionMonitor', onCrash);
  process.on('exit', onExit);

  write('INFO', `process start, pid ${process.pid}, node ${process.version}`);

  return {
    file,
    stop() {
      Object.assign(console, original);
      process.removeListener('uncaughtExceptionMonitor', onCrash);
      process.removeListener('exit', onExit);
    },
  };
}

module.exports = { start };
