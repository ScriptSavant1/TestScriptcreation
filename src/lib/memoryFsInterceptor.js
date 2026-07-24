/**
 * In-memory filesystem interceptor using AsyncLocalStorage.
 *
 * When code runs inside runWithMemoryFs(), ALL fs writes (sync + async) are
 * redirected to a per-request Map<path, content> instead of touching disk.
 * Reads first check the Map, then fall through to the real filesystem.
 *
 * Safe for concurrent requests — each call to runWithMemoryFs() gets its own
 * isolated Map via AsyncLocalStorage (no global mutable state).
 *
 * Code running OUTSIDE runWithMemoryFs() (e.g. the CLI) is completely unaffected.
 */

const { AsyncLocalStorage } = require('async_hooks');
const realFs = require('fs');
const realFsPromises = require('fs').promises;

const als = new AsyncLocalStorage();
let installed = false;

function getStore() { return als.getStore(); }
function norm(p)    { return String(p).replace(/\\/g, '/'); }

function install() {
  if (installed) return;
  installed = true;

  // ── Async (fs.promises) ──────────────────────────────────────────────────

  const _mkdir     = realFsPromises.mkdir.bind(realFsPromises);
  const _writeFile = realFsPromises.writeFile.bind(realFsPromises);
  const _readFile  = realFsPromises.readFile.bind(realFsPromises);
  const _stat      = realFsPromises.stat.bind(realFsPromises);
  const _access    = realFsPromises.access.bind(realFsPromises);
  const _rm        = realFsPromises.rm.bind(realFsPromises);
  const _unlink    = realFsPromises.unlink.bind(realFsPromises);

  realFsPromises.mkdir = async (p, opts) => {
    if (!getStore()) return _mkdir(p, opts);
    // directories are implicit in the memory map — no-op
  };

  realFsPromises.writeFile = async (p, content) => {
    const store = getStore();
    if (!store) return _writeFile(p, content);
    store.set(norm(p), content);
  };

  realFsPromises.readFile = async (p, enc) => {
    const store = getStore();
    if (store) {
      const hit = store.get(norm(p));
      if (hit !== undefined) return enc ? hit.toString() : Buffer.from(hit);
    }
    return _readFile(p, enc);
  };

  realFsPromises.stat = async (p) => {
    // Always use real fs for stat — brunoParser uses it to detect directories.
    // Input file paths are real (temp file or real path), output paths are never stat'd.
    return _stat(p);
  };

  realFsPromises.access = async (p, mode) => {
    if (!getStore()) return _access(p, mode);
    // In memory context — assume file exists if it's in the store
    const store = getStore();
    if (store && store.has(norm(p))) return;
    return _access(p, mode);
  };

  realFsPromises.rm = async (p, opts) => {
    const store = getStore();
    if (!store) return _rm(p, opts);
    const prefix = norm(p);
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key);
    }
  };

  realFsPromises.unlink = async (p) => {
    const store = getStore();
    if (!store) return _unlink(p);
    store.delete(norm(p));
  };

  // ── Sync (fs) ────────────────────────────────────────────────────────────

  const _mkdirSync     = realFs.mkdirSync.bind(realFs);
  const _writeFileSync = realFs.writeFileSync.bind(realFs);
  const _readFileSync  = realFs.readFileSync.bind(realFs);
  const _copyFileSync  = realFs.copyFileSync.bind(realFs);

  realFs.mkdirSync = (p, opts) => {
    if (!getStore()) return _mkdirSync(p, opts);
    // no-op — directories are implicit
  };

  realFs.writeFileSync = (p, content, opts) => {
    const store = getStore();
    if (!store) return _writeFileSync(p, content, opts);
    store.set(norm(p), content);
  };

  realFs.readFileSync = (p, enc) => {
    const store = getStore();
    if (store) {
      const hit = store.get(norm(p));
      if (hit !== undefined) return enc ? hit.toString() : Buffer.isBuffer(hit) ? hit : Buffer.from(hit);
    }
    return _readFileSync(p, enc);
  };

  realFs.copyFileSync = (src, dst) => {
    const store = getStore();
    if (!store) return _copyFileSync(src, dst);
    // src is a real project-root file (DevWebSdk.d.ts, jwt-helper.js, …)
    // Read it from real disk and store at dst in memory
    const content = _readFileSync(src);
    store.set(norm(dst), content);
  };
}

/**
 * Run an async function with a per-request in-memory filesystem.
 * All fs writes inside fn() are captured in the returned Map.
 *
 * @param {() => Promise<T>} fn
 * @returns {Promise<{ result: T, files: Map<string, Buffer|string> }>}
 */
async function runWithMemoryFs(fn) {
  install();
  const files = new Map();
  const result = await als.run(files, fn);
  return { result, files };
}

module.exports = { runWithMemoryFs };
