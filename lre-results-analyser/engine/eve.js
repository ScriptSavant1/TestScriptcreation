/**
 * eve.js — streaming decoder for RawData.eve (binary, big-endian, length-prefixed records).
 * Layout: docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md (validated against LRE Analysis, runs 59 and 2144).
 *
 * Envelope: +0 u32 recLen (whole record) · +4 u32 type · (type 3) +24 u32 subType.
 *
 * TRANSACTION records — type 3, subType = 0x00C00FC0 + flags (the low bits are FLAGS, not a
 * record kind, so new combinations decode without code changes). Fields from +28, in order:
 *   flag 0x0001  u32 strLen + latin1 text (padded to 4) — the RawData.map [END_TRANSACTION] id,
 *                as text. Present on the first record of each (VUser, internal id): it REGISTERS
 *                the internal id for that VUser.
 *   flag 0x0008  u32 (unknown)
 *   flag 0x0010  f64 wasted time (s)
 *   flag 0x0020  f64 think time (s)
 *   then         f64 start · f64 end (unix s) · u32 seq · u32 parent seq (0 = top level)
 *                · u32 internal id · u32 vuser · u32 g · u32 status · u32 iteration
 *   flag 0x8000  failed transaction (error text follows; length varies)
 * The internal id is only unique per VUser: names come from the (vuser, internal id) → map id
 * dictionary built from the registration records. Response time (as LRE reports it, "do not
 * include think time") = end − start − wasted − think.
 *
 * DATA-POINT records — 766 registers (vuser, internal id) → RawData.map [DATA_POINT] id and
 * carries a sample; 762 is a sample:
 *   766: +28 f64 ts · +36 u32 strLen · +40 text (map id) padded · then u32 seq · u32 · f64 value · u32 vuser · u32 internal id
 *   762: +28 f64 ts · +36 u32 seq · +40 u32 · +44 f64 value · +52 u32 vuser · +56 u32 internal id
 *   value = count for HTTP_xxx, bytes for mic_recv / mic_sent, ms for tcp_connect.
 *
 * Records whose (vuser, internal id) is not registered yet are held back and released when the
 * registration arrives; any still unregistered at the end are reported, never guessed.
 *
 * Usage: const d = createDecoder(opts); d.push(chunk) ...; const r = d.end();  Chunks may split records anywhere.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).eve = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const TX_BASE = 0x00c00fc0;
  const F_NAME = 0x0001, F_U32 = 0x0008, F_WASTED = 0x0010, F_THINK = 0x0020, F_FAILED = 0x8000;
  const KNOWN_FLAGS = F_NAME | F_U32 | F_WASTED | F_THINK | F_FAILED;
  const DP_SAMPLE = 762, DP_REGISTER = 766, VUSER_DESC = 63;
  const MAX_REC_LEN = 1 << 20;   // a record longer than 1 MB means we lost sync
  const MAX_EXAMPLES = 3;
  const EXAMPLE_BYTES = 112;
  const MAX_DISTINCT = 64;
  const MAX_PAIR_KEYS = 5e6;     // (vuser, iteration) keys tracked per transaction, in total
  const MAX_HELD = 1e6;          // records waiting for their registration

  /** Is this subType a transaction record? */
  const isTxSubType = (sub) => (sub & 0xffff7f00) === 0x00c00f00 && (sub & 0xc0) === 0xc0;

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
  const latin1 = (u8, off, n) => { let s = ""; for (let i = 0; i < n; i++) s += String.fromCharCode(u8[off + i]); return s; };

  /**
   * Parse one transaction record. Returns null when the layout does not fit.
   * @returns {{flags,mapId,start,end,wasted,think,seq,parent,internalId,vuser,status,iter,failed}|null}
   */
  function parseTx(u8, dv, p, len, sub) {
    const flags = sub - TX_BASE;
    if (flags & ~KNOWN_FLAGS) return null;
    let o = p + 28;
    const lim = p + len;
    let mapId = null;
    if (flags & F_NAME) {
      if (o + 4 > lim) return null;
      const n = dv.getUint32(o);
      if (n > 64 || o + 4 + n > lim) return null;
      const txt = latin1(u8, o + 4, n).replace(/\0+$/, "");
      mapId = /^\d+$/.test(txt) ? parseInt(txt, 10) : null;
      if (mapId == null) return null;
      o += 4 + Math.ceil(n / 4) * 4;
    }
    if (flags & F_U32) o += 4;
    let wasted = 0, think = 0;
    if (flags & F_WASTED) { if (o + 8 > lim) return null; wasted = dv.getFloat64(o); o += 8; }
    if (flags & F_THINK) { if (o + 8 > lim) return null; think = dv.getFloat64(o); o += 8; }
    if (o + 44 > lim) return null;
    const start = dv.getFloat64(o), end = dv.getFloat64(o + 8);
    if (!plausibleTs(start) || !plausibleTs(end)) return null;
    return {
      flags, mapId, start, end,
      wasted: Number.isFinite(wasted) ? wasted : 0, think: Number.isFinite(think) ? think : 0,
      seq: dv.getUint32(o + 16), parent: dv.getUint32(o + 20), internalId: dv.getUint32(o + 24),
      vuser: dv.getUint32(o + 28), status: dv.getUint32(o + 36), iter: dv.getUint32(o + 40),
      failed: (flags & F_FAILED) !== 0,
    };
  }

  /** Parse a data-point record (762 sample / 766 registration + sample). */
  function parseDp(u8, dv, p, len, sub) {
    const ts = dv.getFloat64(p + 28);
    if (sub === DP_SAMPLE) {
      if (len < 60) return null;
      return { ts, mapId: null, value: dv.getFloat64(p + 44), vuser: dv.getUint32(p + 52), internalId: dv.getUint32(p + 56) };
    }
    if (len < 44) return null;
    const n = dv.getUint32(p + 36);
    if (n > 64 || 40 + n > len) return null;
    const txt = latin1(u8, p + 40, n).replace(/\0+$/, "");
    if (!/^\d+$/.test(txt)) return null;
    const o = p + 40 + Math.ceil(n / 4) * 4;
    if (o + 24 > p + len) return null;
    return { ts, mapId: parseInt(txt, 10), value: dv.getFloat64(o + 8), vuser: dv.getUint32(o + 16), internalId: dv.getUint32(o + 20) };
  }

  /**
   * VUser descriptor (sub 63): +28 u32 vuser (the id used by every other RawData.eve record —
   * NOT the per-group number in _t_rep.eve), then text fields [u32 len + latin1, padded to 4]:
   * group-local number, group, script, (unknown), load-generator host (short name).
   */
  function parseVuser(u8, dv, p, len) {
    if (len < 36) return null;
    const vuser = dv.getUint32(p + 28);
    const f = [];
    let o = p + 32;
    while (o + 4 <= p + len) {
      const n = dv.getUint32(o);
      if (n > 1024 || o + 4 + n > p + len) break;
      f.push(latin1(u8, o + 4, n).replace(/\0+$/, ""));
      o += 4 + Math.ceil(n / 4) * 4;
    }
    if (f.length < 3) return null;
    return { vuser, local: f[0], group: f[1], script: f[2], host: f[f.length - 1], fields: f };
  }

  /**
   * @param {object} [opts]
   * @param {function} [opts.onVuser]        ({vuser, local, group, script, host, fields}) — VUser descriptor
   * @param {function} [opts.onTransaction]  (endTs, iteration, rtSec, vuser, mapId, failed, startTs, info)
   *        rtSec = end − start − wasted − think (≥ 0); info = { subType, flags, wasted, think, parent, rawSec }
   * @param {function} [opts.onDataPoint]    (ts, mapId, value, vuser)
   */
  function createDecoder(opts) {
    opts = opts || {};
    const onTx = opts.onTransaction || null;
    const onDp = opts.onDataPoint || null;
    const onVu = opts.onVuser || null;
    const vusers = new Map();

    let pending = null;      // leftover bytes of a split record
    let offset = 0;          // absolute file offset of the start of `pending`
    let records = 0;
    let stopped = null;
    const signatures = new Map();
    const subTypes = {};
    const tx = {
      records: 0, failed: 0, registrations: 0, conflicts: 0, bySubType: {}, implausible: {}, negativeRt: 0,
      tsMin: Infinity, tsMax: -Infinity, iterMin: Infinity, iterMax: -Infinity,
      vuserIds: new Set(), pairKeys: 0, pairsTruncated: false, nested: 0,
      thinkSec: 0, wastedSec: 0,
    };
    const dp = { records: 0, registrations: 0, conflicts: 0, implausible: 0 };
    const txDict = new Map();   // "vuser|internal" → map id
    const dpDict = new Map();
    const txHeld = new Map();   // "vuser|internal" → [parsed records waiting for registration]
    const dpHeld = new Map();
    let held = 0, heldDropped = 0;
    const byTx = new Map();
    const dataPoints = new Map();
    const lookalikes = {};

    function txEntry(id) {
      let e = byTx.get(id);
      if (!e) {
        e = { id, count: 0, failed: 0, negative: 0, tsMin: Infinity, tsMax: -Infinity, startMin: Infinity,
              thinkSec: 0, wastedSec: 0, nested: 0, pairs: new Map(), bySubType: {} };
        byTx.set(id, e);
      }
      return e;
    }

    function hold(map, key, item) {
      if (held >= MAX_HELD) { heldDropped++; return; }
      held++;
      const a = map.get(key);
      if (a) a.push(item); else map.set(key, [item]);
    }
    function release(map, key, fn) {
      const a = map.get(key);
      if (!a) return;
      map.delete(key);
      held -= a.length;
      for (const item of a) fn(item);
    }

    function register(dict, key, mapId, counter) {
      const prev = dict.get(key);
      if (prev === undefined) { dict.set(key, mapId); counter.registrations++; return true; }
      if (prev !== mapId) counter.conflicts++;
      return false;
    }

    function emitTx(r, id) {
      let rt = r.end - r.start - r.wasted - r.think;
      tx.records++;
      bump(tx.bySubType, r.flags + TX_BASE, MAX_DISTINCT);
      if (r.failed) tx.failed++;
      if (r.parent) tx.nested++;
      tx.thinkSec += r.think; tx.wastedSec += r.wasted;
      const e = txEntry(id);
      e.count++;
      if (r.failed) e.failed++;
      if (r.parent) e.nested++;
      e.thinkSec += r.think; e.wastedSec += r.wasted;
      bump(e.bySubType, r.flags + TX_BASE, MAX_DISTINCT);
      if (rt < 0) { tx.negativeRt++; e.negative++; rt = 0; } // clock skew — clamp, but count
      if (r.end < tx.tsMin) tx.tsMin = r.end;
      if (r.end > tx.tsMax) tx.tsMax = r.end;
      if (r.iter < tx.iterMin) tx.iterMin = r.iter;
      if (r.iter > tx.iterMax) tx.iterMax = r.iter;
      if (tx.vuserIds.size < 100000) tx.vuserIds.add(r.vuser);
      if (r.end < e.tsMin) e.tsMin = r.end;
      if (r.end > e.tsMax) e.tsMax = r.end;
      if (r.start < e.startMin) e.startMin = r.start;
      if (onTx) onTx(r.end, r.iter, rt, r.vuser, id, r.failed, r.start,
        { subType: r.flags + TX_BASE, flags: r.flags, wasted: r.wasted, think: r.think, parent: r.parent, rawSec: r.end - r.start });

      if (!tx.pairsTruncated && !r.failed) {
        const k = r.vuser * 4294967296 + r.iter;
        const c = e.pairs.get(k);
        if (c === undefined) {
          if (tx.pairKeys >= MAX_PAIR_KEYS) { tx.pairsTruncated = true; return; }
          tx.pairKeys++;
          e.pairs.set(k, 1);
        } else e.pairs.set(k, c + 1);
      }
    }

    function emitDp(r, id) {
      dp.records++;
      let d = dataPoints.get(id);
      if (!d) { d = { id, count: 0, sum: 0 }; dataPoints.set(id, d); }
      d.count++;
      if (Number.isFinite(r.value)) d.sum += r.value;
      if (onDp) onDp(r.ts, id, r.value, r.vuser);
    }

    function decodeTx(u8, dv, p, len, sub) {
      const r = parseTx(u8, dv, p, len, sub);
      if (!r || r.vuser > 1e7 || r.end - r.start < -60 || r.end - r.start > 7 * 86400) { bump(tx.implausible, sub, MAX_DISTINCT); return; }
      const key = r.vuser + "|" + r.internalId;
      if (r.mapId != null && register(txDict, key, r.mapId, tx)) release(txHeld, key, (h) => emitTx(h, r.mapId));
      const id = txDict.get(key);
      if (id === undefined) hold(txHeld, key, r);
      else emitTx(r, id);
    }

    function decodeDp(u8, dv, p, len, sub) {
      const r = parseDp(u8, dv, p, len, sub);
      if (!r) { dp.implausible++; return; }
      const key = r.vuser + "|" + r.internalId;
      if (r.mapId != null && register(dpDict, key, r.mapId, dp)) release(dpHeld, key, (h) => emitDp(h, r.mapId));
      const id = dpDict.get(key);
      if (id === undefined) hold(dpHeld, key, r);
      else emitDp(r, id);
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
          if (isTxSubType(sub)) decodeTx(u8, dv, p, len, sub);
          else if (sub === DP_SAMPLE || sub === DP_REGISTER) decodeDp(u8, dv, p, len, sub);
          else if (sub === VUSER_DESC) {
            const v = parseVuser(u8, dv, p, len);
            if (v && !vusers.has(v.vuser)) { vusers.set(v.vuser, v); if (onVu) onVu(v); }
          }
          else if (len >= 60 && plausibleTs(dv.getFloat64(p + 28)) && plausibleTs(dv.getFloat64(p + 36))) bump(lookalikes, sub, MAX_DISTINCT);
        }
      } else sig = `len=${len} type=${type}`;
      // transaction records vary in length (names, error text): group their signatures by subType only
      if (len >= 28 && type === 3 && isTxSubType(dv.getUint32(p + 24))) sig = `type=3 +24=${dv.getUint32(p + 24)} (transaction, variable length)`;
      let s = signatures.get(sig);
      if (!s) { s = { signature: sig, count: 0, firstOffset: offset + p, examples: [] }; signatures.set(sig, s); }
      s.count++;
      if (s.examples.length < MAX_EXAMPLES) s.examples.push(hex(u8, p, Math.min(len, EXAMPLE_BYTES)));
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
      const unresolvedTx = {}, unresolvedDp = {};
      let unresolvedTxN = 0, unresolvedDpN = 0;
      for (const [k, a] of txHeld) { unresolvedTxN += a.length; if (Object.keys(unresolvedTx).length < MAX_DISTINCT) unresolvedTx[k] = a.length; }
      for (const [k, a] of dpHeld) { unresolvedDpN += a.length; if (Object.keys(unresolvedDp).length < MAX_DISTINCT) unresolvedDp[k] = a.length; }
      txHeld.clear(); dpHeld.clear();
      const union = new Set();
      for (const e of byTx.values()) for (const k of e.pairs.keys()) union.add(k);
      const txs = [...byTx.values()].sort((a, b) => a.id - b.id).map((e) => {
        let maxPer = 0;
        for (const c of e.pairs.values()) if (c > maxPer) maxPer = c;
        return { id: e.id, count: e.count, failed: e.failed, negativeRt: e.negative, nested: e.nested, bySubType: e.bySubType,
                 tsMin: e.tsMin, tsMax: e.tsMax, startMin: e.startMin === Infinity ? null : e.startMin,
                 thinkSec: e.thinkSec, wastedSec: e.wastedSec,
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
        vusers: [...vusers.values()].sort((a, b) => a.vuser - b.vuser).map((v) => ({ vuser: v.vuser, local: v.local, group: v.group, script: v.script, host: v.host })),
        dp: Object.assign({}, dp, { dictionary: dpDict.size, unresolved: unresolvedDpN, unresolvedKeys: unresolvedDp }),
        tx: {
          records: tx.records, failed: tx.failed, nested: tx.nested, bySubType: tx.bySubType, implausible: tx.implausible, negativeRt: tx.negativeRt,
          registrations: tx.registrations, conflicts: tx.conflicts, dictionary: txDict.size,
          unresolved: unresolvedTxN, unresolvedKeys: unresolvedTx, heldDropped,
          thinkSec: tx.thinkSec, wastedSec: tx.wastedSec,
          tsMin: tx.records ? tx.tsMin : null, tsMax: tx.records ? tx.tsMax : null,
          iterMin: tx.records ? tx.iterMin : null, iterMax: tx.records ? tx.iterMax : null,
          vuserIds: [...tx.vuserIds].sort((a, b) => a - b),
          pairsTruncated: tx.pairsTruncated, vuserIterations: union.size,
        },
        transactions: txs,
      };
    }

    return { push, end };
  }

  return { createDecoder, isTxSubType, parseTx, parseVuser, VUSER_DESC, TX_BASE, FLAGS: { NAME: F_NAME, U32: F_U32, WASTED: F_WASTED, THINK: F_THINK, FAILED: F_FAILED }, DP_SAMPLE, DP_REGISTER };
});
