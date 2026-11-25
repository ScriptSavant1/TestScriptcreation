'use strict';

/**
 * Reads the files of a ZIP from memory (no dependency; stored and deflated entries). Limits keep a hostile ZIP small:
 * number of files and the total size after unpacking. Folder names are kept; entries that point outside are left out.
 * @param {Buffer} buf
 * @returns {Object<string, Buffer>} path → content
 */
const zlib = require('zlib');

function readZip(buf, { maxFiles = 5000, maxBytes = 60 * 1024 * 1024 } = {}) {
  const bad = (m) => new Error('The ZIP file cannot be read: ' + m);
  let end = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) if (buf.readUInt32LE(i) === 0x06054b50) { end = i; break; }
  if (end < 0) throw bad('it is not a ZIP file');
  const count = buf.readUInt16LE(end + 10), out = {};
  let at = buf.readUInt32LE(end + 16), total = 0;
  if (count === 0xffff || at === 0xffffffff) throw bad('it is too large');
  if (count > maxFiles) throw bad('it holds more than ' + maxFiles + ' files');
  for (let n = 0; n < count; n++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) throw bad('it is damaged');
    const flags = buf.readUInt16LE(at + 8), method = buf.readUInt16LE(at + 10), size = buf.readUInt32LE(at + 20), full = buf.readUInt32LE(at + 24);
    const nameLen = buf.readUInt16LE(at + 28), name = buf.toString(flags & 0x800 ? 'utf8' : 'latin1', at + 46, at + 46 + nameLen).replace(/\\/g, '/');
    const local = buf.readUInt32LE(at + 42);
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
    if (name.endsWith('/') || name.startsWith('/') || /(^|\/)\.\.(\/|$)|^[a-zA-Z]:/.test(name)) continue;
    if (flags & 1) throw bad('it has a password');
    if ((total += full) > maxBytes) throw bad('its files are larger than ' + Math.round(maxBytes / 1048576) + ' MB together');
    if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw bad('it is damaged');
    const from = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28), data = buf.subarray(from, from + size);
    if (method !== 0 && method !== 8) throw bad('"' + name + '" is packed in a way that is not supported');
    try { out[name] = method === 0 ? Buffer.from(data) : zlib.inflateRawSync(data, { maxOutputLength: Math.max(1, Math.min(full, maxBytes)) }); } catch (e) { throw bad('"' + name + '" is damaged'); }
  }
  return out;
}

module.exports = { readZip };
