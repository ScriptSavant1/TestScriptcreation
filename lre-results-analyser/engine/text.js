/**
 * text.js — bytes → text for LRE result files.
 *
 * LRE writes a mix of UTF-8 (with and without BOM) and occasionally UTF-16.
 * Works on Uint8Array (browser) and Buffer (Node). UMD: Node require() / browser LreRA.text.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).text = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Decode file bytes to a string, honouring a UTF-8 / UTF-16 BOM. Strings pass through (BOM stripped). */
  function decode(bytes) {
    if (bytes == null) return "";
    if (typeof bytes === "string") return bytes.charCodeAt(0) === 0xfeff ? bytes.slice(1) : bytes;
    const b = bytes;
    if (b.length >= 3 && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) return new TextDecoder("utf-8").decode(b.subarray(3));
    if (b.length >= 2 && b[0] === 0xff && b[1] === 0xfe) return new TextDecoder("utf-16le").decode(b.subarray(2));
    if (b.length >= 2 && b[0] === 0xfe && b[1] === 0xff) return new TextDecoder("utf-16be").decode(b.subarray(2));
    return new TextDecoder("utf-8").decode(b);
  }

  /** Split into lines (CRLF or LF). */
  function lines(s) {
    return String(s).split(/\r?\n/);
  }

  return { decode, lines };
});
