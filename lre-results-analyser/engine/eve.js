/**
 * eve.js — streaming decoder for RawData.eve (binary, big-endian, length-prefixed records).
 *
 * Envelope (SPEC §3.2): +0 uint32BE recLen (whole record), +4 uint32BE type.
 * Transaction sample (SPEC §3.4, sub-type 762 at +24, recLen 64):
 *   +28 double ts (unix s) · +36 u32 iteration · +40 u32 f40 · +44 double rt (ms)
 *   +52 u32 vuser · +56 u32 txId · +60 u32 f60
 *
 * Phase 0 is about PROVING this layout, so besides decoding the decoder reports:
 *   - a tally of every record signature (recLen/type/+8/+16/+24) with hex examples
 *   - the values seen in the "padding" fields f40/f60 (candidates for status / record kind)
 *   - samples per (vuser, iteration) per transaction (does one iteration = one sample?)
 *   - negative response times, unknown transaction IDs, the VUser IDs seen
 *
 * Usage: const d = createDecoder(opts); d.push(chunk) ...; const r = d.end();
 * Chunks may split records anywhere.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).eve = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TX_SUBTYPE = 762;
  const MAX_REC_LEN = 1 << 20;   // a record longer than 1 MB means we lost sync
  const MAX_EXAMPLES = 3;
  const EXAMPLE_BYTES = 96;
  const MAX_DISTINCT = 64;       // distinct values kept per tallied field
  const MAX_PAIR_KEYS = 5e6;     // (vuser, iteration) keys tracked across all transactions

  const hex = (u8, off, len) => {
    const out = [];
    for (let i = 0; i < len && off + i < u8.length; i++) {
      out.push(u8[off + i].toString(16).padStart(2, "0"));
      if (i % 4 === 3) out.push(" ");
    }
    return out.join("").trim();
  };

  function bump(obj, key, cap) {
    if (key in obj) obj[key]++;
    else if (Object.keys(obj).length < cap) obj[key] = 1;
    else obj["(other)"] = (obj["(other)"] || 0) + 1;
  }

  /**
   * @param {object} [opts]
   * @param {Set<number>|null} [opts.knownTxIds]  IDs from RawData.map [END_TRANSACTION]
   * @param {function} [opts.onSample]  (ts, iteration, rtMs, vuser, txId, f40, f60) for every
   *        transaction sample with a finite RT (negative RT already clamped to 0) — the statistics
   *        collector (collector.js) hangs here
   */
  function createDecoder(opts) {
    opts = opts || {};
    const known = opts.knownTxIds || null;
    const onSample = opts.onSample || null;

    let pending = null;      // leftover bytes of a split record
    let offset = 0;          // absolute file offset of the next unread byte (start of pending)
    let records = 0;
    let stopped = null;      // {offset, recLen, reason} once sync is lost
    const signatures = new Map();
    const subTypes = {};
    const tx = {
      records: 0, recLenVariants: {}, f40: {}, f60: {}, negativeRt: 0, nonFiniteRt: 0,
      tsMin: Infinity, tsMax: -Infinity, iterMin: Infinity, iterMax: -Infinity,
      vuserIds: new Set(), unknownTxIds: {}, pairKeys: 0, pairsTruncated: false,
    };
    const byTx = new Map();

    function txEntry(id) {
      let e = byTx.get(id);
      if (!e) {
        e = { id, count: 0, negative: 0, f40f60: {}, tsMin: Infinity, tsMax: -Infinity, pairs: new Map() };
        byTx.set(id, e);
      }
      return e;
    }

    function record(u8, dv, p, len) {
      records++;
      const type = dv.getUint32(p + 4);
      let sig;
      if (len >= 28) {
        const sub = dv.getUint32(p + 24);
        sig = `len=${len} type=${type} +8=${dv.getUint32(p + 8)} +16=${dv.getUint32(p + 16)} +24=${sub}`;
        if (type === 3) bump(subTypes, sub, 1000);
        if (type === 3 && sub === TX_SUBTYPE && len >= 64) decodeTx(dv, p, len);
      } else {
        sig = `len=${len} type=${type}`;
      }
      let s = signatures.get(sig);
      if (!s) { s = { signature: sig, count: 0, firstOffset: offset + p, examples: [] }; signatures.set(sig, s); }
      s.count++;
      if (s.examples.length < MAX_EXAMPLES) s.examples.push(hex(u8, p, Math.min(len, EXAMPLE_BYTES)));
    }

    function decodeTx(dv, p, len) {
      const ts = dv.getFloat64(p + 28);
      const iter = dv.getUint32(p + 36);
      const f40 = dv.getUint32(p + 40);
      let rt = dv.getFloat64(p + 44);
      const vuser = dv.getUint32(p + 52);
      const id = dv.getUint32(p + 56);
      const f60 = dv.getUint32(p + 60);

      tx.records++;
      bump(tx.recLenVariants, len, MAX_DISTINCT);
      bump(tx.f40, f40, MAX_DISTINCT);
      bump(tx.f60, f60, MAX_DISTINCT);
      if (ts < tx.tsMin) tx.tsMin = ts;
      if (ts > tx.tsMax) tx.tsMax = ts;
      if (iter < tx.iterMin) tx.iterMin = iter;
      if (iter > tx.iterMax) tx.iterMax = iter;
      if (tx.vuserIds.size < 100000) tx.vuserIds.add(vuser);
      if (known && !known.has(id)) bump(tx.unknownTxIds, id, MAX_DISTINCT);

      const e = txEntry(id);
      e.count++;
      bump(e.f40f60, f40 + "/" + f60, MAX_DISTINCT);
      if (ts < e.tsMin) e.tsMin = ts;
      if (ts > e.tsMax) e.tsMax = ts;
      if (!Number.isFinite(rt)) { tx.nonFiniteRt++; return; }
      if (rt < 0) { tx.negativeRt++; e.negative++; rt = 0; } // clock skew — clamp, but count
      if (onSample) onSample(ts, iter, rt, vuser, id, f40, f60);

      // samples per (vuser, iteration): tells whether a transaction runs once per iteration
      if (!tx.pairsTruncated) {
        const k = vuser * 4294967296 + iter;
        const c = e.pairs.get(k);
        if (c === undefined) {
          if (tx.pairKeys >= MAX_PAIR_KEYS) { tx.pairsTruncated = true; return; }
          tx.pairKeys++;
          e.pairs.set(k, 1);
        } else e.pairs.set(k, c + 1);
      }
    }

    function push(chunk) {
      if (stopped || !chunk || !chunk.length) return;
      let u8 = chunk instanceof Uint8Array ? chunk : new Uint8Array(chunk);
      if (pending) { const b = new Uint8Array(pending.length + u8.length); b.set(pending); b.set(u8, pending.length); u8 = b; pending = null; }
      const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
      let p = 0;
      while (p + 8 <= u8.length) {
        const len = dv.getUint32(p);
        if (len < 8 || len > MAX_REC_LEN) { stopped = { offset: offset + p, recLen: len, reason: "record length out of range — file corrupt or layout differs" }; break; }
        if (p + len > u8.length) break;
        record(u8, dv, p, len);
        p += len;
      }
      if (!stopped && p < u8.length) pending = u8.slice(p);
      offset += p;
    }

    function end() {
      const trailing = pending ? pending.length : 0;
      pending = null;
      const union = new Set();
      for (const e of byTx.values()) for (const k of e.pairs.keys()) union.add(k);
      const txs = [...byTx.values()].sort((a, b) => a.id - b.id).map((e) => {
        let maxPer = 0;
        for (const c of e.pairs.values()) if (c > maxPer) maxPer = c;
        return {
          id: e.id, count: e.count, negativeRt: e.negative,
          f40f60: e.f40f60, tsMin: e.tsMin, tsMax: e.tsMax,
          vuserIterations: e.pairs.size, maxPerVuserIteration: maxPer,
        };
      });
      return {
        bytesRead: offset + trailing,
        records,
        trailingBytes: trailing,
        stopped,
        signatures: [...signatures.values()].sort((a, b) => b.count - a.count),
        subTypes,
        tx: {
          records: tx.records, recLenVariants: tx.recLenVariants, f40: tx.f40, f60: tx.f60,
          negativeRt: tx.negativeRt, nonFiniteRt: tx.nonFiniteRt,
          tsMin: tx.records ? tx.tsMin : null, tsMax: tx.records ? tx.tsMax : null,
          iterMin: tx.records ? tx.iterMin : null, iterMax: tx.records ? tx.iterMax : null,
          vuserIds: [...tx.vuserIds].sort((a, b) => a - b),
          unknownTxIds: tx.unknownTxIds, pairsTruncated: tx.pairsTruncated,
          vuserIterations: union.size,
        },
        transactions: txs,
      };
    }

    return { push, end };
  }

  return { createDecoder, TX_SUBTYPE };
});
