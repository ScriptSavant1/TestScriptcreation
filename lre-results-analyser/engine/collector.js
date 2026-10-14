/**
 * collector.js — statistics collected in ONE pass over RawData.eve (Phase 1).
 *
 * Per transaction:
 *   - exact samples (RT ms + time) while the run is small enough (default ≤ 20 M samples in total,
 *     ~12 bytes each) → exact percentiles for any time window;
 *     above the limit the samples are dropped and every figure comes from histograms (≤ 0.5 %
 *     relative error) — the method used is reported
 *   - full-run log histogram (1 %), Welford count/mean/M2/min/max
 *   - time buckets: n, mean, M2, min, max + histogram (2 %) → time series, any window
 *   - per load generator (full run and detected steady window)
 * Per VUser: samples, iterations, first/last time, RT per time bucket (VUser heatmap).
 *
 * All times inside the store are seconds relative to the scenario start.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./hist"), require("./stats"));
  else (root.LreRA = root.LreRA || {}).collector = factory(root.LreRA.hist, root.LreRA.stats);
})(typeof self !== "undefined" ? self : this, function (hist, stats) {
  "use strict";

  const BUCKET_CHOICES = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
  const PCTS = stats.PERCENTILES;
  const MAX_HEAT_VUSERS = 2000;

  function chooseBucketSec(durationSec, maxBuckets) {
    const d = Math.max(1, durationSec || 3600);
    const m = maxBuckets || 1500;
    return BUCKET_CHOICES.find((c) => d / c <= m) || 3600;
  }

  /** Growable typed array. */
  function grow(Ctor, init) {
    let a = new Ctor(init || 1024), n = 0;
    return {
      push(v) { if (n === a.length) { const b = new Ctor(a.length * 2); b.set(a); a = b; } a[n++] = v; },
      get length() { return n; },
      values: () => a.subarray(0, n),
      free() { a = new Ctor(0); n = 0; },
    };
  }

  function welford() { return { n: 0, mean: 0, m2: 0, min: Infinity, max: -Infinity }; }
  function wAdd(w, x) { w.n++; const d = x - w.mean; w.mean += d / w.n; w.m2 += d * (x - w.mean); if (x < w.min) w.min = x; if (x > w.max) w.max = x; }
  function wMerge(a, b) {
    if (!b.n) return a;
    if (!a.n) return Object.assign(a, b);
    const n = a.n + b.n, d = b.mean - a.mean;
    a.m2 += b.m2 + d * d * a.n * b.n / n; a.mean += d * b.n / n; a.n = n;
    if (b.min < a.min) a.min = b.min; if (b.max > a.max) a.max = b.max;
    return a;
  }

  /** stats block (seconds) from a Welford + a quantile function over ms */
  function block(w, qs, method) {
    if (!w.n) return { count: 0, min: null, avg: null, max: null, stdDev: null, p: {}, method };
    const p = {};
    PCTS.forEach((q, i) => { p["p" + q] = qs[i] / 1000; });
    return { count: w.n, min: w.min / 1000, avg: w.mean / 1000, max: w.max / 1000, stdDev: Math.sqrt(w.m2 / w.n) / 1000, p, method };
  }

  /**
   * @param {object} o
   * @param {number} o.startUtc      scenario start (unix s)
   * @param {number} [o.durationSec] run length (sizes the bucket array; grows if exceeded)
   * @param {number} [o.bucketSec]   default: chosen from durationSec
   * @param {Map<number,{lg:string}>} [o.vuserInfo]   VUser id → load generator
   * @param {{start:number,end:number}} [o.steady]    detected steady window (relative s) for per-LG figures
   * @param {number} [o.exactLimit=2e7]
   */
  function createCollector(o) {
    const startUtc = o.startUtc || 0;
    const bucketSec = o.bucketSec || chooseBucketSec(o.durationSec);
    const exactLimit = o.exactLimit == null ? 2e7 : o.exactLimit;
    const vuserInfo = o.vuserInfo || new Map();
    const steady = o.steady || null;
    let exact = exactLimit > 0;
    let total = 0;
    let nb = Math.max(1, Math.ceil(((o.durationSec || 3600) + 60) / bucketSec));
    let minRel = Infinity, maxRel = -Infinity;
    const txs = new Map();
    const vusers = new Map();

    function tx(id) {
      let t = txs.get(id);
      if (!t) {
        t = {
          id, w: welford(), h: hist.create(0.01),
          rt: exact ? grow(Float64Array) : null, t: exact ? grow(Float32Array) : null,
          b: { n: new Uint32Array(nb), mean: new Float64Array(nb), m2: new Float64Array(nb),
               min: new Float64Array(nb).fill(Infinity), max: new Float64Array(nb).fill(-Infinity), h: new Array(nb) },
          lg: new Map(),
        };
        txs.set(id, t);
      }
      return t;
    }

    function ensureBuckets(bi) {
      if (bi < nb) return;
      const nn = Math.max(bi + 1, Math.ceil(nb * 1.5));
      const ext = (a, Ctor, fill) => { const b = new Ctor(nn); if (fill !== undefined) b.fill(fill); b.set(a); return b; };
      for (const t of txs.values()) {
        t.b.n = ext(t.b.n, Uint32Array); t.b.mean = ext(t.b.mean, Float64Array); t.b.m2 = ext(t.b.m2, Float64Array);
        t.b.min = ext(t.b.min, Float64Array, Infinity); t.b.max = ext(t.b.max, Float64Array, -Infinity);
        t.b.h.length = nn;
      }
      for (const v of vusers.values()) if (v.hn) { v.hn = ext(v.hn, Uint32Array); v.hs = ext(v.hs, Float64Array); }
      nb = nn;
    }

    function dropExact() {
      exact = false;
      for (const t of txs.values()) { t.rt = null; t.t = null; }
    }

    function add(ts, iter, rt, vuser, id) {
      const rel = ts - startUtc;
      const bi = Math.max(0, Math.floor(rel / bucketSec));
      ensureBuckets(bi);
      const t = tx(id);
      if (rel < minRel) minRel = rel;
      if (rel > maxRel) maxRel = rel;

      wAdd(t.w, rt);
      t.h.add(rt);
      if (exact) {
        if (++total > exactLimit) dropExact();
        else { t.rt.push(rt); t.t.push(rel); }
      }
      // time bucket
      const B = t.b;
      const n = ++B.n[bi];
      const d = rt - B.mean[bi];
      B.mean[bi] += d / n;
      B.m2[bi] += d * (rt - B.mean[bi]);
      if (rt < B.min[bi]) B.min[bi] = rt;
      if (rt > B.max[bi]) B.max[bi] = rt;
      (B.h[bi] || (B.h[bi] = hist.create(0.02))).add(rt);

      // load generator
      const info = vuserInfo.get(vuser);
      const lgName = (info && info.lg) || "(unknown)";
      let L = t.lg.get(lgName);
      if (!L) { L = { full: welford(), fh: hist.create(0.01), steady: welford(), sh: hist.create(0.01) }; t.lg.set(lgName, L); }
      wAdd(L.full, rt); L.fh.add(rt);
      if (steady && rel >= steady.start && rel <= steady.end) { wAdd(L.steady, rt); L.sh.add(rt); }

      // VUser
      let v = vusers.get(vuser);
      if (!v) {
        v = { vuser, n: 0, sum: 0, iterMin: Infinity, iterMax: -Infinity, iters: new Set(), first: Infinity, last: -Infinity,
              hn: vusers.size < MAX_HEAT_VUSERS ? new Uint32Array(nb) : null, hs: vusers.size < MAX_HEAT_VUSERS ? new Float64Array(nb) : null };
        vusers.set(vuser, v);
      }
      v.n++; v.sum += rt;
      if (iter < v.iterMin) v.iterMin = iter;
      if (iter > v.iterMax) v.iterMax = iter;
      if (v.iters.size < 1e6) v.iters.add(iter);
      if (rel < v.first) v.first = rel;
      if (rel > v.last) v.last = rel;
      if (v.hn) { v.hn[bi]++; v.hs[bi] += rt; }
    }

    function finish() {
      const nUsed = Number.isFinite(maxRel) ? Math.floor(Math.max(0, maxRel) / bucketSec) + 1 : 0;
      return createStore({ txs, vusers, bucketSec, nb: Math.min(nb, Math.max(nUsed, Math.ceil(((o.durationSec || 0) + 1) / bucketSec))),
                           exact, exactLimit, total: [...txs.values()].reduce((a, t) => a + t.w.n, 0), minRel, maxRel, steady });
    }

    return { add, finish, bucketSec };
  }

  function createStore(s) {
    const { txs, vusers, bucketSec, nb } = s;
    const method = s.exact ? "exact" : "histogram";
    const bOf = (rel) => Math.max(0, Math.floor(rel / bucketSec));

    /** Figures for one transaction in a window (relative seconds, inclusive); null = whole run. */
    function summary(id, win) {
      const t = txs.get(id);
      if (!t) return block(welford(), [], method);
      if (!win) return block(t.w, s.exact ? exactQuantiles(t.rt.values()) : t.h.quantiles(PCTS), method);
      if (s.exact) {
        const rt = t.rt.values(), ts = t.t.values();
        const sel = [];
        const w = welford();
        for (let i = 0; i < rt.length; i++) if (ts[i] >= win.start && ts[i] <= win.end) { sel.push(rt[i]); wAdd(w, rt[i]); }
        return block(w, exactQuantiles(sel), "exact");
      }
      // histogram mode: whole buckets inside the window
      const w = welford(), h = hist.create(0.02);
      for (let b = bOf(win.start); b <= Math.min(nb - 1, bOf(win.end)); b++) {
        if (!t.b.n[b]) continue;
        wMerge(w, { n: t.b.n[b], mean: t.b.mean[b], m2: t.b.m2[b], min: t.b.min[b], max: t.b.max[b] });
        h.merge(t.b.h[b]);
      }
      return block(w, h.quantiles(PCTS), "histogram (time-bucket resolution)");
    }

    function exactQuantiles(values) {
      if (!values.length) return PCTS.map(() => null);
      const sorted = Float64Array.from(values).sort();
      return PCTS.map((q) => stats.percentile(sorted, q));
    }

    /** Samples ≤ thresholdMs and ≤ 4·threshold (Apdex), in a window. */
    function apdexCounts(id, thresholdMs, win) {
      const t = txs.get(id);
      if (!t) return { n: 0, satisfied: 0, tolerating: 0 };
      const T = thresholdMs, F = 4 * thresholdMs;
      if (s.exact) {
        const rt = t.rt.values(), ts = t.t.values();
        let n = 0, sat = 0, tol = 0;
        for (let i = 0; i < rt.length; i++) {
          if (win && (ts[i] < win.start || ts[i] > win.end)) continue;
          n++; if (rt[i] <= T) sat++; else if (rt[i] <= F) tol++;
        }
        return { n, satisfied: sat, tolerating: tol };
      }
      let h = t.h;
      if (win) { h = hist.create(0.02); for (let b = bOf(win.start); b <= Math.min(nb - 1, bOf(win.end)); b++) if (t.b.h[b]) h.merge(t.b.h[b]); }
      const sat = h.countAtMost(T);
      return { n: h.count, satisfied: sat, tolerating: h.countAtMost(F) - sat };
    }

    /** Per-bucket series per transaction (seconds). */
    function timeline() {
      const out = {};
      for (const [id, t] of txs) {
        const count = [], avg = [], min = [], max = [], p50 = [], p90 = [], p95 = [], p99 = [];
        for (let b = 0; b < nb; b++) {
          const n = t.b.n[b];
          count.push(n);
          if (!n) { avg.push(null); min.push(null); max.push(null); p50.push(null); p90.push(null); p95.push(null); p99.push(null); continue; }
          avg.push(t.b.mean[b] / 1000); min.push(t.b.min[b] / 1000); max.push(t.b.max[b] / 1000);
          const q = t.b.h[b].quantiles([50, 90, 95, 99]);
          p50.push(q[0] / 1000); p90.push(q[1] / 1000); p95.push(q[2] / 1000); p99.push(q[3] / 1000);
        }
        out[id] = { count, avg, min, max, p50, p90, p95, p99 };
      }
      return { bucketSec, buckets: nb, tx: out };
    }

    function perLg(id) {
      const t = txs.get(id);
      if (!t) return [];
      return [...t.lg.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([lg, L]) => ({
        lg, full: block(L.full, L.fh.quantiles(PCTS), "histogram"), steady: block(L.steady, L.sh.quantiles(PCTS), "histogram"),
      }));
    }

    function vuserList() {
      return [...vusers.values()].sort((a, b) => a.vuser - b.vuser).map((v) => ({
        vuser: v.vuser, samples: v.n, avgRt: v.n ? v.sum / v.n / 1000 : null,
        iterations: v.iters.size, iterMin: v.iterMin, iterMax: v.iterMax, firstRelSec: v.first, lastRelSec: v.last,
      }));
    }

    /** Average RT (s) per VUser per column; columns merge buckets so there are ≤ maxCols. */
    function vuserHeat(maxCols) {
      const f = Math.max(1, Math.ceil(nb / (maxCols || 240)));
      const cols = Math.ceil(nb / f);
      const list = [...vusers.values()].filter((v) => v.hn).sort((a, b) => a.vuser - b.vuser);
      const values = list.map((v) => {
        const row = [];
        for (let c = 0; c < cols; c++) {
          let n = 0, sum = 0;
          for (let b = c * f; b < Math.min(nb, (c + 1) * f); b++) { n += v.hn[b]; sum += v.hs[b]; }
          row.push(n ? sum / n / 1000 : null);
        }
        return row;
      });
      return { colSec: f * bucketSec, cols, vusers: list.map((v) => v.vuser), values, truncated: vusers.size > list.length };
    }

    /** Latency heatmap: counts per (time column × log RT row) for the given transactions. */
    function latencyHeat(ids, maxCols, rows) {
      const f = Math.max(1, Math.ceil(nb / (maxCols || 240)));
      const cols = Math.ceil(nb / f);
      rows = rows || 40;
      let lo = Infinity, hi = -Infinity;
      for (const id of ids) { const t = txs.get(id); if (t && t.w.n) { lo = Math.min(lo, t.w.min); hi = Math.max(hi, t.w.max); } }
      if (!Number.isFinite(lo)) return { colSec: f * bucketSec, cols, edgesSec: [], cells: [] };
      lo = Math.max(lo, 1); hi = Math.max(hi, lo * 1.01);
      const step = Math.log(hi / lo) / rows;
      const edges = []; for (let r = 0; r <= rows; r++) edges.push(lo * Math.exp(step * r) / 1000);
      const cells = new Map();
      for (const id of ids) {
        const t = txs.get(id);
        if (!t) continue;
        for (let b = 0; b < nb; b++) {
          const h = t.b.h[b];
          if (!h) continue;
          const c = Math.floor(b / f);
          for (const [bin, cnt] of h.bins()) {
            const v = Math.max(lo, h.valueOf(bin));
            const r = Math.min(rows - 1, Math.max(0, Math.floor(Math.log(v / lo) / step)));
            const k = c * rows + r;
            cells.set(k, (cells.get(k) || 0) + cnt);
          }
        }
      }
      return { colSec: f * bucketSec, cols, edgesSec: edges, cells: [...cells.entries()].map(([k, n]) => [Math.floor(k / rows), k % rows, n]) };
    }

    /** RT distribution: [lowerSec, upperSec, count] on ~maxBins log bins. */
    function distribution(id, maxBins) {
      const t = txs.get(id);
      if (!t || !t.w.n) return [];
      const bins = t.h.bins();
      const first = bins[0][0], last = bins[bins.length - 1][0];
      const f = Math.max(1, Math.ceil((last - first + 1) / (maxBins || 60)));
      const out = new Map();
      for (const [b, c] of bins) { const k = first + Math.floor((b - first) / f) * f; out.set(k, (out.get(k) || 0) + c); }
      return [...out.entries()].map(([k, c]) => [t.h.lowerEdge(k) / 1000, t.h.lowerEdge(k + f) / 1000, c]);
    }

    function countIn(win) {
      let n = 0;
      for (const t of txs.values()) {
        if (!win) { n += t.w.n; continue; }
        if (s.exact) { const ts = t.t.values(); for (let i = 0; i < ts.length; i++) if (ts[i] >= win.start && ts[i] <= win.end) n++; }
        else for (let b = bOf(win.start); b <= Math.min(nb - 1, bOf(win.end)); b++) n += t.b.n[b];
      }
      return n;
    }

    return {
      method, exactLimit: s.exactLimit, totalSamples: s.total, bucketSec, buckets: nb,
      firstRelSec: Number.isFinite(s.minRel) ? s.minRel : null, lastRelSec: Number.isFinite(s.maxRel) ? s.maxRel : null,
      txIds: () => [...txs.keys()].sort((a, b) => a - b),
      count: (id) => (txs.get(id) ? txs.get(id).w.n : 0),
      summary, apdexCounts, timeline, perLg, vuserList, vuserHeat, latencyHeat, distribution, countIn,
    };
  }

  return { createCollector, chooseBucketSec };
});
