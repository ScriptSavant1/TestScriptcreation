/**
 * dat.js — sum_data/sum_dat.ini + graph_N.dat (LRE's online graphs).
 *
 * graph_N.dat lines: <measurementId> <unixTs> <avg> <count> <min> <max> <stddev>
 * sum_dat.ini: [graph_N] GraphType=…, plus measurement entries. The key layout is read tolerantly:
 * any key containing "Measurement" whose value holds a name and/or an id — "SC01_LOGIN,48" (LRE
 * 2026, name first), "48,SC01_LOGIN", "48" or "SC01_LOGIN" — is collected by index. The graph
 * type is taken from a GraphType-like key, or from any value in the section (or a "graph_N=" key
 * elsewhere) that is a known type. IDs seen in the .dat but not named are shown as "id N".
 *
 * Series are resampled onto the run's time buckets: mean of avg, max of max, and Σ avg·count.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory(require("./ini"), require("./text"));
  else (root.LreRA = root.LreRA || {}).dat = factory(root.LreRA.ini, root.LreRA.text);
})(typeof self !== "undefined" ? self : this, function (ini, text) {
  "use strict";

  /** Known graph types → role used by the reports. */
  const ROLES = {
    es_tr_runtime_vusers: "vusers",
    es_tr_lg_monitoring: "lgHealth",
    es_tr_tprange_pass: "txPass",
    es_tr_tprange_fail: "txFail",
    es_tr_total_trpass: "txPassTotal",
    es_tr_response_time: "txResponse",
    http_rc: "httpCodes",
    host_rc: "httpCodesByHost",
    mic_recv: "bytesReceived",
    mic_sent: "bytesSent",
    mic_conn: "connections",
    web_connections: "connections",
    web_connections_per_second: "connectionsPerSec",
    es_tr_errors_distribution: "errors",
    es_tr_vusers_errors_distribution: "vuserErrors",
    hits_per_second: "hits",
    es_tr_hits: "hits",
    throughput: "throughput",
  };

  const isType = (v) => Object.prototype.hasOwnProperty.call(ROLES, String(v || "").trim().toLowerCase());

  function parseIni(input) {
    const p = ini.parse(input || "");
    const graphs = [];
    const listed = new Map(); // "graph_N=<type>" listed in some other section
    for (const sec of Object.values(p.sections)) {
      for (const [k, v] of sec.entries) { const g = /^graph_?(\d+)$/i.exec(k); if (g && isType(v)) listed.set(+g[1], v.trim()); }
    }
    for (const name of Object.keys(p.sections)) {
      const m = /^graph_(\d+)$/i.exec(name);
      if (!m) continue;
      const sec = p.sections[name];
      const typeKey = Object.entries(sec.values).find(([k]) => /graph_?type|^type$/i.test(k));
      const type = String((typeKey && typeKey[1]) || Object.values(sec.values).find(isType) || listed.get(+m[1]) || "").trim();
      const byIdx = new Map();
      for (const [k, v] of sec.entries) {
        if (!/measurement/i.test(k)) continue;
        const idx = (/(\d+)\s*$/.exec(k) || [])[1] || k;
        const e = byIdx.get(idx) || {};
        // Measurement value forms seen in sum_dat.ini:
        //   "Connections,24"                       name, id
        //   "HTTP_200,23"                          name, id
        //   "SC01_04_TESTS_AND_SCRIPTS,26#0#0#0#0" name, id, then '#'-separated extra stats
        //                                          (es_tr_response_time / tprange_pass/fail)
        //   "mic_conn,22" / "24"                   name,id / bare id
        // Strip any '#...'-suffixed extra fields BEFORE parsing so the id is not lost and the raw
        // "#0.000000…" trailer never leaks into the transaction name.
        const vClean = String(v).split("#")[0].trim();
        const nameFirst = /^\s*(.+?)\s*[,;]\s*(\d+)\s*$/.exec(vClean);
        const idFirst = /^\s*(\d+)\s*[,;:=\s]\s*(.+?)\s*$/.exec(vClean);
        if (nameFirst && !/^\d+$/.test(nameFirst[1])) { e.name = nameFirst[1]; e.id = +nameFirst[2]; }
        else if (idFirst) { e.id = +idFirst[1]; e.name = idFirst[2]; }
        else if (/^\s*\d+\s*$/.test(vClean)) { if (/id/i.test(k) || e.id == null) e.id = +vClean; else e.name = vClean; }
        else e.name = vClean;
        byIdx.set(idx, e);
      }
      graphs.push({ n: +m[1], type, role: ROLES[type.toLowerCase()] || null, measurements: [...byIdx.values()].filter((e) => e.id != null || e.name) });
    }
    graphs.sort((a, b) => a.n - b.n);
    return {
      scenarioStart: parseInt(p.get("General", "ScenarioStartTime"), 10) || null,
      scenarioDuration: parseInt(p.get("General", "ScenarioDuration"), 10) || null,
      graphs,
    };
  }

  /**
   * Parse one graph_N.dat and resample onto buckets.
   * @returns {Map<number, {id, rows, total:{avgCount, sumAvg, max, mean}, avg:number[], max:number[], sumAvgCount:number[]}>}
   */
  function parseGraph(input, startUtc, bucketSec, buckets) {
    const out = new Map();
    for (const line of text.lines(text.decode(input))) {
      const f = line.trim().split(/\s+/);
      if (f.length < 7) continue;
      const id = parseInt(f[0], 10), ts = Number(f[1]), avg = Number(f[2]), cnt = Number(f[3]), mx = Number(f[5]);
      if (!Number.isFinite(id) || !Number.isFinite(ts) || !Number.isFinite(avg)) continue;
      let m = out.get(id);
      if (!m) {
        m = { id, rows: 0, cumulativeRows: 0, sumAvg: 0, sumAvgCount: 0, sumCount: 0, maxCol: -Infinity, max: -Infinity, sAvg: new Float64Array(buckets), nAvg: new Uint32Array(buckets),
              bMax: new Float64Array(buckets).fill(NaN), bSum: new Float64Array(buckets), prevTs: null, deltas: [] };
        out.set(id, m);
      }
      m.rows++;
      if (m.prevTs != null && ts > m.prevTs && m.deltas.length < 500) m.deltas.push(ts - m.prevTs);
      m.prevTs = ts;
      if (cnt === -1) m.cumulativeRows++;
      m.sumAvg += avg;
      m.sumAvgCount += cnt > 0 ? avg * cnt : avg;
      if (cnt > 0) m.sumCount += cnt;
      if (Number.isFinite(mx) && mx > m.maxCol) m.maxCol = mx;
      const peak = Number.isFinite(mx) ? Math.max(mx, avg) : avg; // some graphs leave min/max at 0
      if (peak > m.max) m.max = peak;
      const b = Math.floor((ts - startUtc) / bucketSec);
      if (b < 0 || b >= buckets) continue;
      m.sAvg[b] += avg; m.nAvg[b]++;
      if (!(m.bMax[b] >= peak)) m.bMax[b] = peak;
      m.bSum[b] += cnt > 0 ? avg * cnt : avg;
    }
    for (const m of out.values()) {
      m.avg = Array.from(m.sAvg, (s, i) => (m.nAvg[i] ? s / m.nAvg[i] : null));
      m.maxSeries = Array.from(m.bMax, (v) => (Number.isNaN(v) ? null : v));
      m.sumSeries = Array.from(m.bSum);
      m.mean = m.rows ? m.sumAvg / m.rows : null;
      // per-sample totals for response-time graphs (avg and sample count per interval)
      m.weightedMean = m.sumCount ? m.sumAvgCount / m.sumCount : null;
      if (m.maxCol === -Infinity) m.maxCol = null;
      if (m.max === -Infinity) m.max = null;
      const d = m.deltas.sort((a, b) => a - b);
      m.step = d.length ? d[(d.length - 1) >> 1] : null; // typical sampling interval (s)
      delete m.prevTs; delete m.deltas;
      delete m.sAvg; delete m.nAvg; delete m.bMax; delete m.bSum;
    }
    return out;
  }

  /** "host - CPU Usage (%)" → {host, metric}. Host may carry " [ip]". */
  function splitLgName(name) {
    const m = /^(.*?)\s+-\s+(.*)$/.exec(String(name || ""));
    if (!m) return { host: null, ip: null, metric: name };
    const hm = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(m[1]);
    return { host: hm ? hm[1] : m[1], ip: hm ? hm[2] : null, metric: m[2] };
  }

  return { parseIni, parseGraph, splitLgName, ROLES };
});
