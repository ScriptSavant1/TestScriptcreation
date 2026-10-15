/**
 * eve.js — streaming decoder for RawData.eve (binary, big-endian, length-prefixed records).
 * Layout: docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md (validated against LRE Analysis, run 59).
 *
 * Envelope: +0 u32 recLen (whole record) · +4 u32 type · (type 3) +24 u32 subType.
 *
 * TRANSACTION records — the family {12586944, 12586945, 12619721}; one record per completed
 * transaction instance (12619721 = failed). The variants are longer but share the first 76 bytes:
 *   +28 f64 startTs · +36 f64 endTs (unix s) · +44 u32 (not a reliable RT — cross-checked only)
 *   +52 u32 txId (INTERNAL id — not the RawData.map id; names are resolved in txnames.js)
 *   +56 u32 vuser · +68 u32 iteration
 *   response time = endTs − startTs, in SECONDS.
 *
 * DATA-POINT records — subType 762 (per-request samples such as HTTP_200, tcp_connect):
 *   +28 f64 ts · +44 f64 value (normally 1.0) · +52 u32 vuser · +56 u32 dataPointId
 *   (RawData.map [DATA_POINT]). Counted per id; never treated as transactions.
 *
 * Every transaction record is checked for plausibility (timestamps, duration, VUser); records
 * that fail are counted per subType instead of being used, so a layout difference in another
 * LRE version shows up in the self-checks rather than as wrong numbers.
 *
 * Usage: const d = createDecoder(opts); d.push(chunk) ...; const r = d.end();  Chunks may split records anywhere.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).eve = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TX_FAMILY = [12586944, 12586945, 12619721];
  const FAILED_SUBTYPES = [12619721];
  const DATA_POINT_SUBTYPE = 762;
  const TX_MIN_LEN = 76;
  const MAX_REC_LEN = 1 << 20;   // a record longer than 1 MB means we lost sync
  const MAX_EXAMPLES = 3;
  const EXAMPLE_BYTES = 112;
  const MAX_DISTINCT = 64;
  const MAX_PAIR_KEYS = 5e6;     // (vuser, iteration) keys tracked per transaction, in total

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
  const plausibleTs = (t) => Number.isFinite(t) && t > 1e8 && t < 1e10;

  /**
   * @param {object} [opts]
   * @param {function} [opts.onTransaction] (endTs, iteration, rtSec, vuser, txId, failed, startTs, subType)
   * @param {function} [opts.onDataPoint]   (ts, dataPointId, value, vuser)
   * @param {number[]} [opts.txFamily]      override the transaction subTypes (other LRE versions)
   * @param {number[]} [opts.failedSubTypes]
   */
  function createDecoder(opts) {
    opts = opts || {};
    const family = new Set(opts.txFamily || TX_FAMILY);
    const failedSet = new Set(opts.failedSubTypes || FAILED_SUBTYPES);
    const onTx = opts.onTransaction || null;
    const onDp = opts.onDataPoint || null;

    let pending = null;      // leftover bytes of a split record
    let offset = 0;          // absolute file offset of the start of `pending`
    let records = 0;
    let stopped = null;
    const signatures = new Map();
    const subTypes = {};
    const tx = {
      records: 0, failed: 0, bySubType: {}, implausible: {}, negativeRt: 0,
      tsMin: Infinity, tsMax: -Infinity, iterMin: Infinity, iterMax: -Infinity,
      vuserIds: new Set(), pairKeys: 0, pairsTruncated: false,
      f44Checked: 0, f44Agrees: 0,                       // does +44 equal round(rt·1000)?
    };
    const byTx = new Map();
    const dataPoints = new Map();
    const lookalikes = {};   // other subTypes that also carry two timestamps at +28/+36 (not counted)

    function txEntry(id) {
      let e = byTx.get(id);
      if (!e) { e = { id, count: 0, failed: 0, negative: 0, tsMin: Infinity, tsMax: -Infinity, pairs: new Map(), bySubType: {} }; byTx.set(id, e); }
      return e;
    }

    function record(u8, dv, p, len) {
      records++;
      const type = dv.getUint32(p + 4);
      let sig;
      if (len >= 28) {
        const sub = dv.getUint32(p + 24);
        sig = `len=${len} type=${type} +8=${dv.getUint32(p + 8)} +16=${dv.getUint32(p + 16)} +24=${sub}`;
        if (type === 3) {
          bump(subTypes, sub, 1000);
          if (family.has(sub)) decodeTx(dv, p, len, sub);
          else if (sub === DATA_POINT_SUBTYPE && len >= 60) decodeDataPoint(dv, p);
          else if (len >= 60 && plausibleTs(dv.getFloat64(p + 28)) && plausibleTs(dv.getFloat64(p + 36))) bump(lookalikes, sub, MAX_DISTINCT);
        }
      } else sig = `len=${len} type=${type}`;
      let s = signatures.get(sig);
      if (!s) { s = { signature: sig, count: 0, firstOffset: offset + p, examples: [] }; signatures.set(sig, s); }
      s.count++;
      if (s.examples.length < MAX_EXAMPLES) s.examples.push(hex(u8, p, Math.min(len, EXAMPLE_BYTES)));
    }

    function decodeTx(dv, p, len, sub) {
      if (len < TX_MIN_LEN) { bump(tx.implausible, sub + " (too short)", MAX_DISTINCT); return; }
      const start = dv.getFloat64(p + 28), end = dv.getFloat64(p + 36);
      const id = dv.getUint32(p + 52), vuser = dv.getUint32(p + 56), iter = dv.getUint32(p + 68);
      let rt = end - start;
      if (!plausibleTs(start) || !plausibleTs(end) || rt < -60 || rt > 7 * 86400 || vuser > 1e7) { bump(tx.implausible, sub, MAX_DISTINCT); return; }
      const failed = failedSet.has(sub);
      tx.records++;
      bump(tx.bySubType, sub, MAX_DISTINCT);
      if (failed) tx.failed++;
      if (rt < 0) { tx.negativeRt++; rt = 0; } // clock skew — clamp, but count
      if (tx.f44Checked < 100000) { tx.f44Checked++; if (dv.getUint32(p + 44) === Math.round(rt * 1000)) tx.f44Agrees++; }
      if (end < tx.tsMin) tx.tsMin = end;
      if (end > tx.tsMax) tx.tsMax = end;
      if (iter < tx.iterMin) tx.iterMin = iter;
      if (iter > tx.iterMax) tx.iterMax = iter;
      if (tx.vuserIds.size < 100000) tx.vuserIds.add(vuser);

      const e = txEntry(id);
      e.count++;
      if (failed) e.failed++;
      if (end - start < 0) e.negative++;
      bump(e.bySubType, sub, MAX_DISTINCT);
      if (end < e.tsMin) e.tsMin = end;
      if (end > e.tsMax) e.tsMax = end;
      if (onTx) onTx(end, iter, rt, vuser, id, failed, start, sub);

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

    function decodeDataPoint(dv, p) {
      const ts = dv.getFloat64(p + 28), value = dv.getFloat64(p + 44), vuser = dv.getUint32(p + 52), id = dv.getUint32(p + 56);
      let d = dataPoints.get(id);
      if (!d) { d = { id, count: 0, sum: 0 }; dataPoints.set(id, d); }
      d.count++;
      if (Number.isFinite(value)) d.sum += value;
      if (onDp) onDp(ts, id, value, vuser);
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
        return { id: e.id, count: e.count, failed: e.failed, negativeRt: e.negative, bySubType: e.bySubType, tsMin: e.tsMin, tsMax: e.tsMax,
                 vuserIterations: e.pairs.size, maxPerVuserIteration: maxPer };
      });
      return {
        bytesRead: offset + trailing,
        records,
        trailingBytes: trailing,
        stopped,
        signatures: [...signatures.values()].sort((a, b) => b.count - a.count),
        subTypes,
        lookalikes,
        dataPoints: [...dataPoints.values()].sort((a, b) => a.id - b.id),
        tx: {
          records: tx.records, failed: tx.failed, bySubType: tx.bySubType, implausible: tx.implausible, negativeRt: tx.negativeRt,
          tsMin: tx.records ? tx.tsMin : null, tsMax: tx.records ? tx.tsMax : null,
          iterMin: tx.records ? tx.iterMin : null, iterMax: tx.records ? tx.iterMax : null,
          vuserIds: [...tx.vuserIds].sort((a, b) => a - b),
          pairsTruncated: tx.pairsTruncated, vuserIterations: union.size,
          f44Checked: tx.f44Checked, f44Agrees: tx.f44Agrees,
        },
        transactions: txs,
      };
    }

    return { push, end };
  }

  return { createDecoder, TX_FAMILY, FAILED_SUBTYPES, DATA_POINT_SUBTYPE };
});
