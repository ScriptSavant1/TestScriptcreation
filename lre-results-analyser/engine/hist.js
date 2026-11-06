/**
 * hist.js — mergeable log-bucket histogram for response times (ms).
 *
 * Bin b ≥ 1 covers [MIN·g^(b-1), MIN·g^b) with g = 1 + precision; bin 0 holds values < MIN.
 * A quantile is reported as the bin's geometric midpoint, clamped to the exact min/max, so the
 * relative error is ≤ precision/2 (0.5 % at the default 1 %). Histograms with the same precision
 * merge by adding counts — used for time buckets, per-LG figures and runs too large to keep
 * every sample.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).hist = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MIN = 0.01; // ms

  function create(precision) {
    const g = 1 + (precision || 0.01);
    const lg = Math.log(g);
    const counts = new Map();
    let n = 0, min = Infinity, max = -Infinity;

    const binOf = (v) => (v < MIN ? 0 : 1 + Math.floor(Math.log(v / MIN) / lg));
    const valueOf = (b) => (b === 0 ? MIN / 2 : MIN * Math.pow(g, b - 0.5));

    const h = {
      precision: g - 1,
      add(v, k) {
        k = k || 1;
        const b = binOf(v);
        counts.set(b, (counts.get(b) || 0) + k);
        n += k;
        if (v < min) min = v;
        if (v > max) max = v;
      },
      merge(o) {
        if (!o || !o.count) return h;
        if (Math.abs(o.precision - h.precision) > 1e-12) throw new Error("hist: precision mismatch");
        for (const [b, c] of o.bins()) counts.set(b, (counts.get(b) || 0) + c);
        n += o.count;
        if (o.min < min) min = o.min;
        if (o.max > max) max = o.max;
        return h;
      },
      get count() { return n; },
      get min() { return n ? min : null; },
      get max() { return n ? max : null; },
      /** sorted [bin, count] pairs */
      bins() { return [...counts.entries()].sort((a, b) => a[0] - b[0]); },
      /** nearest-rank quantile (p in 0..100) */
      quantile(p) {
        if (!n) return null;
        const rank = Math.max(1, Math.ceil((p / 100) * n));
        let acc = 0;
        for (const [b, c] of h.bins()) {
          acc += c;
          if (acc >= rank) return Math.min(max, Math.max(min, valueOf(b)));
        }
        return max;
      },
      quantiles(ps) {
        if (!n) return ps.map(() => null);
        const sorted = h.bins();
        const out = [];
        let i = 0, acc = 0;
        for (const p of ps) {
          const rank = Math.max(1, Math.ceil((p / 100) * n));
          while (i < sorted.length && acc + sorted[i][1] < rank) { acc += sorted[i][1]; i++; }
          out.push(i < sorted.length ? Math.min(max, Math.max(min, valueOf(sorted[i][0]))) : max);
        }
        return out;
      },
      /** samples ≤ v (approximate at the bin containing v: counted when its midpoint ≤ v) */
      countAtMost(v) {
        let acc = 0;
        for (const [b, c] of counts) if (valueOf(b) <= v) acc += c;
        return acc;
      },
      lowerEdge: (b) => (b === 0 ? 0 : MIN * Math.pow(g, b - 1)),
      valueOf,
      toJSON() { return { precision: g - 1, n, min: h.min, max: h.max, bins: h.bins() }; },
    };
    return h;
  }

  return { create, MIN };
});
