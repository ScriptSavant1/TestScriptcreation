/**
 * zip.js — random-access ZIP reader for very large archives (ZIP64), streaming one entry at a time.
 *
 * Only the central directory is read up front; each entry is then streamed with
 * Blob.slice().stream() → DecompressionStream("deflate-raw"). Memory stays flat whatever the
 * archive size, and nothing is extracted to disk. Works on a browser File/Blob and on Node ≥ 18
 * Blob (used by the tests).
 *
 *   const z = await LreRA.zip.open(file);  z.entries → [{name, size, compressedSize, method}]
 *   await z.stream(name, (u8) => …);       const bytes = await z.read(name);
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).zip = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const SIG_EOCD = 0x06054b50, SIG_Z64_LOC = 0x07064b50, SIG_Z64_EOCD = 0x06064b50, SIG_CEN = 0x02014b50, SIG_LOC = 0x04034b50;
  const METHODS = { 0: "stored", 8: "deflate", 9: "Deflate64", 12: "bzip2", 14: "LZMA", 93: "Zstandard", 99: "AES-encrypted" };

  async function bytesAt(blob, start, len) {
    return new Uint8Array(await blob.slice(start, start + len).arrayBuffer());
  }
  const u64 = (dv, o) => dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 4294967296;

  function decodeName(u8, utf8) {
    if (utf8) return new TextDecoder("utf-8").decode(u8);
    let s = "";
    for (const b of u8) s += String.fromCharCode(b); // CP437 ≈ latin1 for the ASCII names LRE uses
    return s;
  }

  async function open(blob) {
    const size = blob.size;
    if (size < 22) throw new Error("Not a ZIP file (too small)");
    const tailLen = Math.min(size, 65557);
    const tail = await bytesAt(blob, size - tailLen, tailLen);
    const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
    let e = -1;
    for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === SIG_EOCD) { e = i; break; }
    if (e < 0) throw new Error("Not a ZIP file (end of central directory not found)");
    let count = tv.getUint16(e + 10, true), cdSize = tv.getUint32(e + 12, true), cdOff = tv.getUint32(e + 16, true);
    if (count === 0xffff || cdSize === 0xffffffff || cdOff === 0xffffffff) {
      const locAbs = size - tailLen + e - 20;
      const loc = await bytesAt(blob, locAbs, 20);
      const lv = new DataView(loc.buffer);
      if (lv.getUint32(0, true) !== SIG_Z64_LOC) throw new Error("ZIP64 locator missing");
      const z64 = await bytesAt(blob, u64(lv, 8), 56);
      const zv = new DataView(z64.buffer);
      if (zv.getUint32(0, true) !== SIG_Z64_EOCD) throw new Error("ZIP64 end record missing");
      count = u64(zv, 32); cdSize = u64(zv, 40); cdOff = u64(zv, 48);
    }
    const cd = await bytesAt(blob, cdOff, cdSize);
    const cv = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
    const entries = [];
    let p = 0;
    for (let i = 0; i < count && p + 46 <= cd.length; i++) {
      if (cv.getUint32(p, true) !== SIG_CEN) throw new Error("Corrupt ZIP central directory");
      const flags = cv.getUint16(p + 8, true), method = cv.getUint16(p + 10, true);
      let comp = cv.getUint32(p + 20, true), unc = cv.getUint32(p + 24, true);
      const nl = cv.getUint16(p + 28, true), xl = cv.getUint16(p + 30, true), cl = cv.getUint16(p + 32, true);
      let off = cv.getUint32(p + 42, true);
      const name = decodeName(cd.subarray(p + 46, p + 46 + nl), (flags & 0x800) !== 0);
      // ZIP64 extra field: values present only for the fields set to 0xFFFFFFFF, in this order
      let x = p + 46 + nl;
      const xEnd = x + xl;
      while (x + 4 <= xEnd) {
        const id = cv.getUint16(x, true), len = cv.getUint16(x + 2, true);
        if (id === 0x0001) {
          let q = x + 4;
          if (unc === 0xffffffff) { unc = u64(cv, q); q += 8; }
          if (comp === 0xffffffff) { comp = u64(cv, q); q += 8; }
          if (off === 0xffffffff) { off = u64(cv, q); q += 8; }
        }
        x += 4 + len;
      }
      if (!name.endsWith("/")) entries.push({ name, size: unc, compressedSize: comp, method, encrypted: (flags & 1) !== 0, headerOffset: off });
      p += 46 + nl + xl + cl;
    }
    const byName = new Map(entries.map((en) => [en.name, en]));

    async function dataRange(en) {
      const h = await bytesAt(blob, en.headerOffset, 30);
      const hv = new DataView(h.buffer);
      if (hv.getUint32(0, true) !== SIG_LOC) throw new Error(`Corrupt ZIP entry header: ${en.name}`);
      const start = en.headerOffset + 30 + hv.getUint16(26, true) + hv.getUint16(28, true);
      return [start, start + en.compressedSize];
    }

    function check(en) {
      if (!en) throw new Error("Entry not found in ZIP");
      if (en.encrypted) throw new Error(`${en.name} is password-protected — extract the ZIP and choose the folder instead`);
      if (en.method !== 0 && en.method !== 8) throw new Error(`${en.name} uses ${METHODS[en.method] || "method " + en.method} compression, which browsers cannot read — extract the ZIP (e.g. with 7-Zip) and choose the folder instead`);
    }

    /** Stream an entry's uncompressed bytes in chunks. */
    async function stream(name, onChunk) {
      const en = byName.get(name);
      check(en);
      const [a, b] = await dataRange(en);
      let s = blob.slice(a, b).stream();
      if (en.method === 8) s = s.pipeThrough(new DecompressionStream("deflate-raw"));
      const reader = s.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        onChunk(value);
      }
    }

    async function read(name) {
      const en = byName.get(name);
      check(en);
      if (en.size > 1.5e9) throw new Error(`${name} is too large to load into memory (${en.size} bytes)`);
      const out = new Uint8Array(en.size);
      let o = 0;
      await stream(name, (c) => {
        if (o + c.length > out.length) throw new Error(`${name}: more data than the ZIP directory says`);
        out.set(c, o); o += c.length;
      });
      return o === out.length ? out : out.subarray(0, o);
    }

    return { entries, stream, read, size: (name) => (byName.get(name) || {}).size };
  }

  return { open };
});
