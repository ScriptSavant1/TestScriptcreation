/**
 * insights.js — rule-based, offline data-science checks on the result model (Phase 4).
 *
 * Every finding carries its evidence (numbers) and the chart it comes from, and is written in
 * plain English. Nothing leaves the machine. Methods:
 *   - Mann-Kendall trend test + Sen's slope (degradation over a soak)
 *   - binary segmentation on mean shifts with a robust penalty (when behaviour changed)
 *   - robust z-score, median/MAD (spikes)
 *   - Little's Law / pacing achieved (test validity)
 *   - load-generator comparison (bias / bottleneck), LG CPU/memory thresholds
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).insights = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ── statistics ─────────────────────────────────────────────────────────
  function median(a) {
    const s = a.filter((x) => x != null && Number.isFinite(x)).sort((x, y) => x - y);
    if (!s.length) return null;
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  }
  function mad(a, med) {
    const m = med == null ? median(a) : med;
    return median(a.filter((x) => x != null).map((x) => Math.abs(x - m)));
  }
  function normCdf(z) {
    // Abramowitz-Stegun 26.2.17
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989422804014327 * Math.exp(-z * z / 2);
    const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return z > 0 ? 1 - p : p;
  }

  /** Mann-Kendall trend test (normal approximation, tie correction). x: numbers (nulls dropped). */
  function mannKendall(x) {
    const v = x.filter((a) => a != null && Number.isFinite(a));
    const n = v.length;
    if (n < 8) return null;
    let s = 0;
    for (let i = 0; i < n - 1; i++) for (let j = i + 1; j < n; j++) s += Math.sign(v[j] - v[i]);
    const ties = new Map();
    for (const a of v) ties.set(a, (ties.get(a) || 0) + 1);
    let tc = 0;
    for (const t of ties.values()) if (t > 1) tc += t * (t - 1) * (2 * t + 5);
    const varS = (n * (n - 1) * (2 * n + 5) - tc) / 18;
    const z = s > 0 ? (s - 1) / Math.sqrt(varS) : s < 0 ? (s + 1) / Math.sqrt(varS) : 0;
    return { n, s, z, p: 2 * (1 - normCdf(Math.abs(z))), tau: s / (n * (n - 1) / 2) };
  }

  /** Sen's slope per index step (median of pairwise slopes). */
  function senSlope(x) {
    const pts = [];
    x.forEach((a, i) => { if (a != null && Number.isFinite(a)) pts.push([i, a]); });
    if (pts.length < 2) return null;
    const slopes = [];
    for (let i = 0; i < pts.length - 1; i++) for (let j = i + 1; j < pts.length; j++) slopes.push((pts[j][1] - pts[i][1]) / (pts[j][0] - pts[i][0]));
    return median(slopes);
  }

  /** Merge a series into ≤ maxPoints by averaging neighbours (keeps MK/Sen affordable). */
  function downsample(x, maxPoints) {
    if (x.length <= maxPoints) return { values: x.slice(), factor: 1 };
    const f = Math.ceil(x.length / maxPoints);
    const out = [];
    for (let i = 0; i < x.length; i += f) {
      const seg = x.slice(i, i + f).filter((a) => a != null);
      out.push(seg.length ? seg.reduce((p, c) => p + c, 0) / seg.length : null);
    }
    return { values: out, factor: f };
  }

  /**
   * Change points in the mean (binary segmentation). Penalty = 3·σ²·ln n with σ from the MAD of
   * first differences (robust to the shifts themselves). Returns indices where a new level starts.
   */
  function changePoints(x, opts) {
    opts = opts || {};
    const minSeg = opts.minSeg || 5, maxCp = opts.maxCp || 3;
    const idx = [], v = [];
    x.forEach((a, i) => { if (a != null && Number.isFinite(a)) { idx.push(i); v.push(a); } });
    const n = v.length;
    if (n < 2 * minSeg) return [];
    const diffs = []; for (let i = 1; i < n; i++) diffs.push(v[i] - v[i - 1]);
    const sigma = (1.4826 * mad(diffs)) / Math.SQRT2 || 1e-9;
    const pen = 3 * sigma * sigma * Math.log(n);
    const pre = [0], pre2 = [0];
    for (const a of v) { pre.push(pre[pre.length - 1] + a); pre2.push(pre2[pre2.length - 1] + a * a); }
    const sse = (a, b) => { const k = b - a; if (k <= 0) return 0; const s = pre[b] - pre[a]; return pre2[b] - pre2[a] - s * s / k; };
    const cps = [];
    const segs = [[0, n]];
    while (cps.length < maxCp) {
      let best = null;
      for (const [a, b] of segs) {
        const base = sse(a, b);
        for (let k = a + minSeg; k <= b - minSeg; k++) {
          const gain = base - sse(a, k) - sse(k, b);
          if (gain > pen && (!best || gain > best.gain)) best = { gain, a, b, k };
        }
      }
      if (!best) break;
      cps.push(best.k);
      segs.splice(segs.findIndex((s) => s[0] === best.a && s[1] === best.b), 1, [best.a, best.k], [best.k, best.b]);
    }
    cps.sort((a, b) => a - b);
    const bounds = [0, ...cps, n];
    const means = [];
    for (let i = 0; i < bounds.length - 1; i++) means.push((pre[bounds[i + 1]] - pre[bounds[i]]) / (bounds[i + 1] - bounds[i]));
    return cps.map((k, i) => ({ index: idx[k], before: means[i], after: means[i + 1] }));
  }

  /**
   * Is a straight line at least as good a description as a step at x = k? (residual sums of squares)
   * Used so a gradual drift is reported as a trend, not as a "change of level".
   */
  function linearBeatsStep(x, k) {
    const pts = [];
    x.forEach((a, i) => { if (a != null && Number.isFinite(a)) pts.push([i, a]); });
    if (pts.length < 4) return false;
    const n = pts.length;
    const mx = pts.reduce((a, p) => a + p[0], 0) / n, my = pts.reduce((a, p) => a + p[1], 0) / n;
    let sxy = 0, sxx = 0;
    for (const [i, v] of pts) { sxy += (i - mx) * (v - my); sxx += (i - mx) * (i - mx); }
    const b = sxx ? sxy / sxx : 0, a0 = my - b * mx;
    const lin = pts.reduce((acc, [i, v]) => acc + (v - (a0 + b * i)) ** 2, 0);
    const L = pts.filter((p) => p[0] < k), R = pts.filter((p) => p[0] >= k);
    if (!L.length || !R.length) return true;
    const ml = L.reduce((a, p) => a + p[1], 0) / L.length, mr = R.reduce((a, p) => a + p[1], 0) / R.length;
    const step = L.reduce((acc, p) => acc + (p[1] - ml) ** 2, 0) + R.reduce((acc, p) => acc + (p[1] - mr) ** 2, 0);
    return lin <= step * 1.05;
  }

  /** Robust z-scores (0.6745·(x−median)/MAD). */
  function robustZ(x) {
    const m = median(x), d = mad(x, m);
    return x.map((a) => (a == null || !d ? null : (0.6745 * (a - m)) / d));
  }

  // ── formatting ─────────────────────────────────────────────────────────
  const pct = (r) => `${(r * 100).toFixed(r < 0.1 ? 1 : 0)} %`;
  const sec = (s) => (s == null ? "-" : s < 1 ? `${(s * 1000).toFixed(0)} ms` : `${s.toFixed(s < 10 ? 2 : 1)} s`);
  function clock(rel) {
    if (rel == null) return "-";
    const t = Math.max(0, Math.round(rel));
    return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
  }

  // ── checks ─────────────────────────────────────────────────────────────
  /**
   * @param {object} m  result model (analyse.js) — uses meta, phases, lifecycle, workload,
   *                    transactions, timeline, vusers, errors, lgHealth
   * @returns {{verdict, findings: object[]}}
   */
  function run(m) {
    const F = [];
    const add = (severity, category, title, textS, evidence, chart) => F.push({ severity, category, title, text: textS, evidence: evidence || null, chart: chart || null });
    const tl = m.timeline;
    const bs = tl ? tl.bucketSec : null;
    const steady = m.window || (m.phases && m.phases.steady ? { start: m.phases.steady.startRelSec, end: m.phases.steady.endRelSec } : null);
    const inSteady = (b) => !steady || (b * bs >= steady.start && (b + 1) * bs <= steady.end + bs);
    const txs = (m.transactions || []).filter((t) => t.full.count > 0);
    // wrapper transactions not in RawData.map (e.g. the action / Main_Transaction) repeat what the
    // named transactions show — keep them out of the trend, spike and LG checks
    const focus = txs.some((t) => t.inMap) ? txs.filter((t) => t.inMap !== false) : txs;
    const at = (rel) => `t+${clock(rel)}` + (m.meta && m.meta.startUtc != null ? ` (${localClock(m, rel)})` : "");

    // 1. Test validity
    const sched = (m.meta && m.meta.schedule && m.meta.schedule.steps) || [];
    const planned = sched.filter((s) => s.kind === "start").reduce((a, s) => a + s.vusers, 0);
    const runStep = sched.find((s) => s.kind === "run");
    if (m.lifecycle && planned && m.lifecycle.vusers < planned)
      add("high", "validity", "Fewer VUsers than planned", `The schedule starts ${planned} VUsers but only ${m.lifecycle.vusers} ran.`, { planned, actual: m.lifecycle.vusers }, "vusers");
    if (runStep && m.phases && m.phases.steady) {
      const ratio = m.phases.steady.durationSec / runStep.durationSec;
      if (ratio < 0.95) add("medium", "validity", "Steady state shorter than planned",
        `Planned run ${clock(runStep.durationSec)}, actual steady state ${clock(m.phases.steady.durationSec)} (${pct(ratio)}). Stop reason: ${m.meta.stopReason || "unknown"}.`,
        { plannedSec: runStep.durationSec, steadySec: m.phases.steady.durationSec }, "vusers");
      else add("good", "validity", "Full steady state achieved", `All VUsers ran together for ${clock(m.phases.steady.durationSec)} (planned ${clock(runStep.durationSec)}).`, null, "vusers");
    }

    // 2. Pacing achieved / Little's Law (per script with fixed or random interval pacing)
    for (const s of m.workload || []) {
      const vus = (m.vusers || []).filter((v) => v.script && String(v.script).toLowerCase() === String(s.key).toLowerCase() && v.iterations && v.runRelSec != null);
      if (!vus.length || !s.pacing) continue;
      let runSum = 0, itSum = 0;
      for (const v of vus) { runSum += Math.max(0, (v.exitRelSec != null ? v.exitRelSec : v.lastRelSec) - v.runRelSec); itSum += v.iterations; }
      if (!itSum || !runSum) continue;
      const cycle = runSum / itSum; // seconds per iteration per VUser (Little's Law: N = X·cycle)
      const target = s.pacing.kind === "fixedInterval" ? s.pacing.seconds : s.pacing.kind === "randomInterval" ? (s.pacing.min + s.pacing.max) / 2 : null;
      const ev = { script: s.key, vusers: vus.length, iterations: itSum, avgCycleSec: cycle, iterationsPerHour: (vus.length / cycle) * 3600, targetSec: target };
      if (target) {
        const ratio = cycle / target;
        if (ratio > 1.1) add("high", "validity", `Pacing not achieved — ${s.key}`,
          `Each VUser completed an iteration every ${sec(cycle)} on average, but pacing asks for one every ${sec(target)} (${pct(ratio - 1)} slower). Iterations take longer than the pacing interval, so the planned load (${(vus.length / target * 3600).toFixed(0)} iterations/h) was not reached — actual ${(vus.length / cycle * 3600).toFixed(0)}/h.`, ev, "vusers");
        else add("good", "validity", `Pacing achieved — ${s.key}`,
          `Little's Law check: ${vus.length} VUsers × 1 iteration per ${sec(cycle)} = ${(vus.length / cycle * 3600).toFixed(0)} iterations/h, matching pacing of ${sec(target)} (${pct(Math.abs(ratio - 1))} off).`, ev, "vusers");
      } else add("info", "validity", `Iteration rate — ${s.key}`, `${vus.length} VUsers averaged one iteration every ${sec(cycle)} (${s.pacing.text}).`, ev, "vusers");
    }

    // 3. Degradation (trend) and sustained level changes on per-bucket P90 within steady state.
    //    Change points must hold for ≥ 5 % of the window and are grouped across transactions, so a
    //    short spike (handled by check 4) does not show up here as "up, then down".
    const trendRows = [];
    const levelChanges = [];
    for (const t of focus) {
      const series = tl && tl.tx[t.id];
      if (!series) continue;
      const p90 = series.p90.map((v, b) => (inSteady(b) ? v : null));
      const ds = downsample(p90, 300);
      const mk = mannKendall(ds.values);
      if (!mk) continue;
      const slope = senSlope(ds.values); // seconds per point
      const med = median(ds.values);
      const points = ds.values.filter((v) => v != null).length;
      const change = med ? (slope * points) / med : 0;
      const stepSec = ds.factor * bs;
      const raw = changePoints(ds.values, { minSeg: Math.max(5, Math.round(points * 0.05)) });
      // drop transients: a jump that comes back to the previous level soon after (a spike — check 4)
      const transient = [];
      let cps = raw.filter((cp, i) => {
        const nx = raw[i + 1], pv = raw[i - 1];
        const transientStart = nx && (nx.index - cp.index) <= points * 0.1 && Math.abs(nx.after / cp.before - 1) < 0.2;
        const transientEnd = pv && (cp.index - pv.index) <= points * 0.1 && Math.abs(cp.after / pv.before - 1) < 0.2;
        if (transientStart) transient.push([cp.index, nx.index]);
        return !transientStart && !transientEnd && cp.before && Math.abs(cp.after / cp.before - 1) >= 0.2;
      });
      // a lone change point that a straight line explains as well (spike stretches left out) is a
      // gradual drift, not a step
      if (cps.length === 1) {
        const clean = ds.values.map((v, i) => (transient.some(([a, b]) => i >= a && i < b) ? null : v));
        if (linearBeatsStep(clean, cps[0].index)) cps = [];
      }
      for (const cp of cps) levelChanges.push({ tx: t.label || t.name, rel: cp.index * stepSec, before: cp.before, after: cp.after, r: cp.after / cp.before - 1, stepSec });
      const step = cps.find((cp) => cp.after > cp.before);
      trendRows.push({ name: t.label || t.name, p: mk.p, change });
      const pTxt = mk.p < 0.001 ? "p < 0.001" : `p = ${mk.p.toFixed(3)}`;
      if (mk.p < 0.01 && change >= 0.10) {
        add(change >= 0.25 ? "high" : "medium", "trend", `${t.label || t.name} slows down over time`,
          step
            ? `P90 rose by about ${pct(change)} across the steady state, mostly in a step at ${at(step.index * stepSec)} (${sec(step.before)} → ${sec(step.after)}) rather than gradually (Mann-Kendall ${pTxt}). Look at what changed at that time.`
            : `P90 rose gradually by about ${pct(change)} across the steady state (Mann-Kendall ${pTxt}, Sen slope ${sec(slope / stepSec * 3600)} per hour). Typical of a resource leak or growing data — check memory, connection pools and table growth.`,
          { transaction: t.label || t.name, mkZ: mk.z, p: mk.p, relChange: change, medianP90: med }, "rtOverTime");
      } else if (mk.p < 0.01 && change <= -0.10) {
        add("info", "trend", `${t.label || t.name} gets faster over time`, `P90 fell by about ${pct(-change)} across the steady state (warm-up or caching).`, { transaction: t.label || t.name, p: mk.p, relChange: change }, "rtOverTime");
      }
    }
    // group level changes that happen at about the same time on several transactions
    levelChanges.sort((a, b) => a.rel - b.rel);
    const clusters = [];
    for (const c of levelChanges) {
      const last = clusters[clusters.length - 1];
      if (last && c.rel - last.rel <= Math.max(3 * c.stepSec, 300)) last.items.push(c); else clusters.push({ rel: c.rel, items: [c] });
    }
    for (const cl of clusters) {
      const up = cl.items.filter((c) => c.r > 0);
      const names = [...new Set(cl.items.map((c) => c.tx))];
      const worst = cl.items.reduce((a, c) => (Math.abs(c.r) > Math.abs(a.r) ? c : a));
      add(up.length ? "medium" : "info", "change",
        names.length === 1 ? `${names[0]} changed level at ${at(cl.rel)}` : `${names.length} transactions changed level at ${at(cl.rel)}`,
        (names.length === 1 ? `P90 moved from ${sec(worst.before)} to ${sec(worst.after)} (${worst.r > 0 ? "+" : ""}${pct(worst.r)}) and stayed there.`
          : `${names.slice(0, 6).join(", ")}${names.length > 6 ? "…" : ""} — ${up.length ? `${up.length} got slower` : "all got faster"}; largest: ${worst.tx} ${sec(worst.before)} → ${sec(worst.after)} (${worst.r > 0 ? "+" : ""}${pct(worst.r)}). A shared change points to the system, not one transaction.`) +
        " Check what happened at that time (deployment, batch job, data growth, load-generator issue).",
        { atRelSec: cl.rel, transactions: names, changes: cl.items.map((c) => ({ tx: c.tx, before: c.before, after: c.after })) }, "rtOverTime");
    }
    if (trendRows.length && !F.some((f) => f.category === "trend" && f.severity !== "info"))
      add("good", "trend", "No degradation over time", `None of the ${trendRows.length} transactions shows a significant upward trend in P90 during steady state.`, null, "rtOverTime");

    // 4. Spikes (robust z on per-bucket P90) with error / VUser correlation. Buckets are merged
    //    until a typical bucket holds ≥ 10 samples, so a P90 is never judged on one or two samples.
    const spikes = [];
    let spikeStep = bs;
    for (const t of focus) {
      const series = tl && tl.tx[t.id];
      if (!series) continue;
      const counts = series.count.filter((c) => c > 0);
      const f = Math.max(1, Math.ceil(10 / Math.max(1, median(counts) || 1)));
      spikeStep = Math.max(spikeStep, f * bs);
      const agg = [], cnt = [];
      for (let i = 0; i < series.p90.length; i += f) {
        let n = 0, w = 0;
        for (let j = i; j < Math.min(series.p90.length, i + f); j++) if (series.count[j] && series.p90[j] != null) { n += series.count[j]; w += series.count[j] * series.p90[j]; }
        agg.push(n ? w / n : null); cnt.push(n);
      }
      const z = robustZ(agg);
      const med = median(agg);
      agg.forEach((v, k) => {
        if (z[k] != null && z[k] > 3.5 && v > 1.5 * med && cnt[k] >= 5) spikes.push({ tx: t.label || t.name, b: k * f, bEnd: Math.min(series.p90.length - 1, (k + 1) * f - 1), z: z[k], value: v, median: med });
      });
    }
    if (spikes.length) {
      spikes.sort((a, b) => a.b - b.b);
      const groups = [];
      const gap = Math.max(2, Math.ceil(spikeStep / bs) * 2);
      for (const s of spikes) {
        const g = groups[groups.length - 1];
        if (g && s.b - g.lastB <= gap) { g.items.push(s); g.lastB = Math.max(g.lastB, s.bEnd); } else groups.push({ firstB: s.b, lastB: s.bEnd, items: [s] });
      }
      groups.sort((a, b) => b.items.length - a.items.length || Math.max(...b.items.map((i) => i.z)) - Math.max(...a.items.map((i) => i.z)));
      let shown = 0;
      for (const g of groups) {
        if (shown >= 5) break;
        const errs = tl.errors ? tl.errors.slice(Math.max(0, g.firstB - 1), g.lastB + 2).reduce((a, c) => a + (c || 0), 0) : 0;
        const txNames = [...new Set(g.items.map((i) => i.tx))];
        const worst = g.items.reduce((a, c) => (c.value / c.median > a.value / a.median ? c : a));
        // one transaction alone, no errors and less than 2.5× its usual P90: normal variation
        if (txNames.length === 1 && !errs && worst.value < 2.5 * worst.median) continue;
        shown++;
        const rel = g.firstB * bs;
        const vuChange = tl.vusers ? tl.vusers[Math.min(tl.vusers.length - 1, g.lastB)] - tl.vusers[Math.max(0, g.firstB - 1)] : 0;
        add(txNames.length >= 3 || errs ? "medium" : "low", "spike", `Response-time spike at ${at(rel)}`,
          `${txNames.length} transaction(s) spiked for about ${clock((g.lastB - g.firstB + 1) * bs)} (${txNames.slice(0, 4).join(", ")}${txNames.length > 4 ? "…" : ""}); worst ${worst.tx} P90 ${sec(worst.value)} vs usual ${sec(worst.median)}.` +
          (tl.errors ? (errs ? ` ${errs} error(s) were logged in the same window — likely related.` : " No errors were logged in that window.") : "") +
          (vuChange ? ` Running VUsers changed by ${vuChange} at the same time.` : ""),
          { atRelSec: rel, durationSec: (g.lastB - g.firstB + 1) * bs, transactions: txNames, errors: errs }, "rtOverTime");
      }
    } else if (focus.length) add("good", "spike", "No response-time spikes", "No time window had a P90 more than 3.5 robust standard deviations above normal.", null, "rtOverTime");

    // 5. Load-generator bias
    const lgNames = new Set();
    const slowCount = new Map();
    const perTxBias = [];
    let compared = 0;
    for (const t of focus) {
      const rows = (t.perLg || []).filter((r) => r.steady.count >= 30 || r.full.count >= 30);
      if (rows.length < 2) continue;
      const vals = rows.map((r) => ({ lg: r.lg, v: (r.steady.count >= 30 ? r.steady : r.full).p.p90 }));
      vals.forEach((x) => lgNames.add(x.lg));
      const hi = vals.reduce((a, c) => (c.v > a.v ? c : a)), lo = vals.reduce((a, c) => (c.v < a.v ? c : a));
      compared++;
      if (lo.v && hi.v / lo.v >= 1.25) { slowCount.set(hi.lg, (slowCount.get(hi.lg) || 0) + 1); perTxBias.push({ tx: t.label || t.name, lg: hi.lg, ratio: hi.v / lo.v, slow: hi.v, fast: lo.v }); }
    }
    if (compared) {
      const worst = [...slowCount.entries()].sort((a, b) => b[1] - a[1])[0];
      if (worst && worst[1] >= Math.max(2, compared / 2)) {
        const h = (m.lgHealth || []).find((x) => x.host && worst[0].toLowerCase().startsWith(x.host.toLowerCase()));
        add("high", "lg", `Load generator ${worst[0]} is consistently slower`,
          `On ${worst[1]} of ${compared} transactions its P90 is ≥ 25 % higher than the fastest LG. Results from it may reflect the LG, not the application.` + (h && h.cpu ? ` Its CPU peaked at ${h.cpu.max.toFixed(0)} %.` : ""),
          { lg: worst[0], transactions: worst[1], compared }, "rtPerLg");
      } else {
        if (perTxBias.length) for (const b of perTxBias.sort((x, y) => y.ratio - x.ratio).slice(0, 3))
          add("low", "lg", `${b.tx} is slower on ${b.lg}`, `P90 ${sec(b.slow)} on ${b.lg} vs ${sec(b.fast)} on the fastest load generator (+${pct(b.ratio - 1)}). Only this transaction is affected, so look at what it calls from that LG (network route, DNS, proxy) rather than the LG itself.`, b, "rtPerLg");
        add("good", "lg", "Load generators agree", `Response times are consistent across ${lgNames.size} load generators${perTxBias.length ? ` on ${compared - perTxBias.length} of ${compared} transactions` : ` (${compared} transactions compared)`}.`, null, "rtPerLg");
      }
    }

    // 6. LG health (sum_data)
    for (const h of m.lgHealth || []) {
      if (h.cpu && h.cpu.max != null) {
        if (h.cpu.max >= 85) add("high", "lg", `High CPU on ${h.host}`, `CPU peaked at ${h.cpu.max.toFixed(0)} % (average ${h.cpu.mean.toFixed(0)} %); above ~85 % the LG can distort response times.`, { host: h.host, cpuPeak: h.cpu.max, cpuAvg: h.cpu.mean }, "lgHealth");
        else if (h.cpu.mean >= 70) add("medium", "lg", `Busy CPU on ${h.host}`, `CPU averaged ${h.cpu.mean.toFixed(0)} %.`, { host: h.host, cpuAvg: h.cpu.mean }, "lgHealth");
      }
      if (h.memory && h.memory.max >= 85) add("high", "lg", `High memory on ${h.host}`, `Memory peaked at ${h.memory.max.toFixed(0)} %.`, { host: h.host, memoryPeak: h.memory.max }, "lgHealth");
    }

    // 7. Errors
    if (m.errors && m.errors.total) {
      const top = m.errors.summary[0];
      const iters = (m.vusers || []).reduce((a, v) => a + (v.iterations || 0), 0);
      add(m.errors.total / Math.max(1, iters) > 0.01 ? "high" : "medium", "errors", `${m.errors.total} error(s) logged`,
        `Most frequent: code ${top.code} ×${top.count} — "${top.pattern.slice(0, 120)}"${top.firstUtc != null ? `, first at ${at(top.firstUtc - m.meta.startUtc)}` : ""}.` +
        (iters ? ` That is ${(m.errors.total / iters * 100).toFixed(2)} errors per 100 iterations.` : ""),
        { total: m.errors.total, top: { code: top.code, count: top.count } }, "errors");
    } else if (m.errors) add("good", "errors", "No errors logged", "SqliteDb.db holds no error records for this run.", null, "errors");

    // 8. Failed transactions (sum_data)
    const failing = txs.filter((t) => t.fail != null && t.fail > 0).map((t) => ({ name: t.label || t.name, fail: t.fail, rate: t.fail / Math.max(1, (t.pass || 0) + t.fail) }));
    for (const f of failing.sort((a, b) => b.rate - a.rate).slice(0, 5))
      add(f.rate >= 0.01 ? "high" : "low", "errors", `${f.name}: ${f.fail} failed`, `${(f.rate * 100).toFixed(2)} % of its transactions failed.`, f, "errors");

    // 9. SLA / Apdex
    const slaRows = txs.filter((t) => t.sla && t.sla.threshold != null);
    if (slaRows.length) {
      const failed = slaRows.filter((t) => t.sla.pass === false);
      if (failed.length) add("high", "sla", `${failed.length} of ${slaRows.length} transactions miss their SLA`,
        failed.slice(0, 6).map((t) => `${t.label || t.name}: P${t.sla.percentile} ${sec(t.sla.value)} > ${sec(t.sla.threshold)}`).join("; ") + (failed.length > 6 ? "; …" : "") + ".",
        { failed: failed.map((t) => t.name) }, "slaChart");
      else add("good", "sla", "All SLAs met", `All ${slaRows.length} transactions with a threshold are within it (steady state).`, null, "slaChart");
      const poor = slaRows.filter((t) => t.sla.apdex != null && t.sla.apdex < 0.85);
      if (poor.length) add("medium", "sla", "Low Apdex", poor.slice(0, 6).map((t) => `${t.label || t.name} ${t.sla.apdex.toFixed(2)}`).join(", ") + " (below 0.85 = users would notice).", { transactions: poor.map((t) => t.name) }, "slaChart");
    }

    // 10. Throughput stability (steady)
    if (tl && tl.totalTps) {
      const v = tl.totalTps.filter((x, b) => inSteady(b) && x != null);
      if (v.length >= 10) {
        const mean = v.reduce((a, c) => a + c, 0) / v.length;
        const sd = Math.sqrt(v.reduce((a, c) => a + (c - mean) * (c - mean), 0) / v.length);
        const cov = mean ? sd / mean : 0;
        if (cov > 0.25 && bs >= 30) add("medium", "throughput", "Unstable throughput", `Transactions per second varied by ${pct(cov)} (coefficient of variation) during steady state.`, { mean, sd, cov }, "throughput");
        else add("good", "throughput", "Stable throughput", `Average ${mean.toFixed(2)} TPS during steady state, variation ${pct(cov)}.`, { mean, cov }, "throughput");
      }
    }

    // 11. Clock skew
    const neg = txs.reduce((a, t) => a + (t.negativeRtClamped || 0), 0);
    if (neg) add("low", "data", "Negative response times", `${neg} sample(s) had a slightly negative response time (load-generator clock skew) and were counted as 0.`, { count: neg }, null);

    const order = { high: 0, medium: 1, low: 2, info: 3, good: 4 };
    F.sort((a, b) => order[a.severity] - order[b.severity]);
    const highs = F.filter((f) => f.severity === "high").length;
    const slaFail = F.some((f) => f.category === "sla" && f.severity === "high");
    const verdict = slaFail ? { status: "fail", text: "SLA not met" } : highs ? { status: "warn", text: "Review findings" } : { status: "pass", text: "No significant issues" };
    return { verdict, findings: F };
  }

  function localClock(m, rel) {
    const d = new Date((m.meta.startUtc + rel + (m.meta.localOffsetSec || 0)) * 1000);
    return `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")} local`;
  }

  return { run, mannKendall, senSlope, changePoints, robustZ, median, mad, downsample, normCdf };
});
