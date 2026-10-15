/**
 * txnames.js — map RawData.eve INTERNAL transaction ids (+52) to transaction names.
 *
 * The internal ids are not the RawData.map [END_TRANSACTION] ids (run 59: 10–22 vs 1–14 — and the
 * ranges overlap, so a direct lookup would silently give wrong names). Resolution, in order:
 *
 *   1. Statistics match against LRE's own per-transaction graph (sum_data, es_tr_response_time):
 *      each id's count, mean and max response time are compared with each named measurement and
 *      the best one-to-one assignment is taken (Hungarian algorithm). A match is accepted only
 *      when count is within 2 % (or ±3) and mean within 5 %.
 *   2. If no graph is available and the id set equals the RawData.map id set exactly, the map is
 *      used (flagged as an assumption).
 *   3. Otherwise the id stays unresolved (shown as TX_<id>) and the self-checks report it.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).txnames = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /** Minimum-cost assignment for an n×m cost matrix (n ≤ m padded square). Returns row → column. */
  function hungarian(cost) {
    const n = cost.length, m = Math.max(n, ...cost.map((r) => r.length));
    const BIG = 1e9;
    const a = Array.from({ length: m }, (_, i) => Array.from({ length: m }, (_, j) => (i < n && j < cost[i].length ? cost[i][j] : BIG / 10)));
    const u = new Array(m + 1).fill(0), v = new Array(m + 1).fill(0), p = new Array(m + 1).fill(0), way = new Array(m + 1).fill(0);
    for (let i = 1; i <= m; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(m + 1).fill(Infinity), used = new Array(m + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = Infinity, j1 = 0;
        for (let j = 1; j <= m; j++) {
          if (used[j]) continue;
          const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= m; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const res = new Array(n).fill(-1);
    for (let j = 1; j <= m; j++) if (p[j] && p[j] <= n && j <= (cost[p[j] - 1] || []).length) res[p[j] - 1] = j - 1;
    return res;
  }

  const lr = (a, b) => Math.abs(Math.log((a + 1e-9) / (b + 1e-9)));

  /**
   * @param {object} o
   * @param {{id:number,count:number,mean:number,max:number}[]} o.ids   per internal id (seconds)
   * @param {{name:string,count:number,mean:number,max:number}[]} [o.graph]  named per-transaction totals
   * @param {Map<number,string>} [o.mapNames]  RawData.map [END_TRANSACTION]
   * @returns {{names: Map<number,string>, method: string, matches: object[], unresolved: number[]}}
   */
  function resolve(o) {
    const ids = o.ids.filter((x) => x.count > 0);
    const graph = (o.graph || []).filter((g) => g.count > 0 && g.name);
    const names = new Map(), matches = [];
    if (graph.length && ids.length) {
      const cost = ids.map((x) => graph.map((g) => 2 * lr(x.count + 1, g.count + 1) + lr(x.mean, g.mean) + (x.max && g.max ? 0.3 * lr(x.max, g.max) : 0)));
      const assign = hungarian(cost);
      ids.forEach((x, i) => {
        const g = graph[assign[i]];
        if (!g) return;
        const countOk = Math.abs(x.count - g.count) <= Math.max(3, 0.02 * g.count);
        const meanOk = Math.abs(x.mean / g.mean - 1) <= 0.05 || Math.abs(x.mean - g.mean) < 0.002;
        matches.push({ id: x.id, name: g.name, count: x.count, graphCount: g.count, mean: x.mean, graphMean: g.mean, accepted: countOk && meanOk });
        if (countOk && meanOk) names.set(x.id, g.name);
      });
      if (names.size) return { names, method: `matched to LRE's per-transaction graph (sum_data) on count, mean and max — ${names.size} of ${ids.length} ids`, matches, unresolved: ids.filter((x) => !names.has(x.id)).map((x) => x.id) };
    }
    const mapNames = o.mapNames || new Map();
    if (mapNames.size && ids.length === mapNames.size && ids.every((x) => mapNames.has(x.id))) {
      for (const x of ids) names.set(x.id, mapNames.get(x.id));
      return { names, method: "RawData.map ids (assumed: the internal ids equal the map ids — no sum_data graph to confirm)", matches, unresolved: [], assumed: true };
    }
    return { names, method: graph.length ? "not resolved — no id matched LRE's per-transaction graph" : "not resolved — sum_data/sum_dat.ini with the response-time graph is needed", matches, unresolved: ids.map((x) => x.id) };
  }

  return { resolve, hungarian };
});
