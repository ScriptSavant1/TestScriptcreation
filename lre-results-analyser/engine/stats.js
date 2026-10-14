/**
 * stats.js — exact descriptive statistics over a set of samples (Phase 0).
 *
 * Percentiles: nearest-rank — P = sorted[ceil(p/100 · n) − 1]. Every reported value is a real
 * sample. Standard deviation: population (÷ n). Both are stated in the output so a difference
 * with LRE Analysis can be explained.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).stats = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const PERCENTILES = [50, 80, 85, 90, 95, 99];
  const METHOD = { percentile: "nearest-rank", stdDev: "population" };

  function percentile(sorted, p) {
    const n = sorted.length;
    if (!n) return null;
    const rank = Math.max(1, Math.ceil((p / 100) * n));
    return sorted[Math.min(rank, n) - 1];
  }

  /** @param {ArrayLike<number>} values  @param {number} [scale=1] multiply results (e.g. 0.001 ms→s) */
  function summarise(values, scale) {
    const k = scale == null ? 1 : scale;
    const n = values.length;
    if (!n) return { count: 0, min: null, max: null, avg: null, stdDev: null, p: {} };
    const sorted = Float64Array.from(values).sort();
    let sum = 0;
    for (let i = 0; i < n; i++) sum += sorted[i];
    const mean = sum / n;
    let sq = 0;
    for (let i = 0; i < n; i++) { const d = sorted[i] - mean; sq += d * d; }
    const p = {};
    for (const q of PERCENTILES) p["p" + q] = percentile(sorted, q) * k;
    return { count: n, min: sorted[0] * k, max: sorted[n - 1] * k, avg: mean * k, stdDev: Math.sqrt(sq / n) * k, p };
  }

  return { summarise, percentile, PERCENTILES, METHOD };
});
