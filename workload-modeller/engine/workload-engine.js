/**
 * workload-engine.js — the Workload Modeller's calculations (UMD, browser + Node). The spec: workload-modeller/docs.
 * Every formula lives here; the page and the Excel export only show what model() returns.
 *
 *   const r = WorkloadEngine.model(input);
 *
 * The rule (Little's law, closed model with pacing), per group:
 *   TPS = Vusers x transactions per iteration / pacing
 *   iteration time = response times + think time;   pacing must be >= the iteration time
 * Response time is needed only to CHOOSE a pacing, or when there is no pacing; without it the
 * engine reports the response-time budget (the slowest average that still holds the TPS).
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.WorkloadEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  /* ---------- reference data (all of it editable in the page) ---------- */
  // Starting assumptions for sizing a load generator from its CPU and memory. They are NOT
  // vendor figures: replace them with your own (best: "from a past run" below).
  const PROTOCOLS = {
    web:       { label: "Web - HTTP/HTML", memMb: 5,   perCore: 50 },
    devweb:    { label: "DevWeb",          memMb: 3,   perCore: 80 },
    truclient: { label: "TruClient",       memMb: 350, perCore: 2 },
    other:     { label: "Other protocol",  memMb: 10,  perCore: 30 },
  };
  const TEST_TYPES = {
    load:     { label: "Load",     steadyMin: 60,  workload: "basic-group" },
    soak:     { label: "Soak (endurance)", steadyMin: 480, workload: "basic-group" },
    stress:   { label: "Stress (steps above the target)", steadyMin: 15, workload: "real-world", levels: [50, 75, 100, 125, 150] },
    capacity: { label: "Capacity (find the limit)", steadyMin: 15, workload: "real-world", levels: [100, 120, 140, 160, 180, 200] },
    spike:    { label: "Spike", steadyMin: 15, workload: "real-world", base: 50, peak: 200 },
  };
  const WORKLOADS = {
    "basic-scenario": "Basic schedule, by test",
    "basic-group": "Basic schedule, by group",
    "real-world": "Real-world schedule",
    "goal": "Goal-oriented",
  };
  const NICE = [1, 2, 3, 4, 5, 6, 10, 12, 15, 20, 30, 45, 60, 90, 120, 180, 300];

  /* ---------- small helpers ---------- */
  const EPS = 1e-9;
  const ceilE = (x) => Math.ceil(x - EPS);
  const isNum = (x) => typeof x === "number" && Number.isFinite(x);
  const pos = (x) => isNum(x) && x > 0;
  const nn = (x) => isNum(x) && x >= 0;
  const round = (x, d) => { const f = Math.pow(10, d || 0); return Math.round(x * f) / f; };
  function hms(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return [h, m, s].map((x) => String(x).padStart(2, "0")).join(":");
  }
  function words(sec) {                                   // "3 min 25 s" — for the plain-language summary
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const out = [];
    if (h) out.push(h + (h === 1 ? " hour" : " hours"));
    if (m) out.push(m + " min");
    if (s || !out.length) out.push(s + " s");
    return out.join(" ");
  }
  const sec1 = (x) => (Math.abs(x - Math.round(x)) < 0.05 ? String(Math.round(x)) : x.toFixed(1)) + " s";

  /* ---------- iteration time ---------- */
  // Think time as LRE replays it (Runtime Settings > Think Time).
  function thinkTime(g) {
    const t = nn(g.thinkPerIter) ? g.thinkPerIter : 0;
    const m = g.thinkMode || "recorded";
    if (m === "ignore") return { mean: 0, worst: 0, min: 0 };
    if (m === "multiply") { const f = pos(g.thinkFactor) ? g.thinkFactor : 1; return { mean: t * f, worst: t * f, min: t * f }; }
    if (m === "random") {
      const lo = nn(g.thinkMinPct) ? g.thinkMinPct : 50, hi = nn(g.thinkMaxPct) ? Math.max(g.thinkMaxPct, lo) : 150;
      return { mean: t * (lo + hi) / 200, worst: t * hi / 100, min: t * lo / 100 };
    }
    return { mean: t, worst: t, min: t };                 // as recorded
  }
  // Response time per iteration: average per transaction x transactions (+ 90th percentile for the worst case).
  function iterationTime(g) {
    const T = txCount(g), think = thinkTime(g);
    const known = nn(g.rtAvg);
    const rtMean = known ? g.rtAvg * T : null;
    const rtWorst = known ? (nn(g.rt90) ? Math.max(g.rt90, g.rtAvg) : g.rtAvg) * T : null;
    return {
      think, rtKnown: known, rtMean, rtWorst,
      mean: known ? rtMean + think.mean : null,
      worst: known ? rtWorst + think.worst : null,
    };
  }
  const txCount = (g) => (pos(g.txPerIter) ? g.txPerIter : 1);

  /* ---------- targets ---------- */
  // The group's target TPS, or null when the group is sized by Vusers only.
  function targetTps(g, sc, shareTotal) {
    const growth = pos(sc.growth) ? sc.growth : 1;
    switch (g.method) {
      case "tps": case "vusers_tps": return pos(g.targetTps) ? g.targetTps * growth : null;
      case "volume": return pos(g.volumePerHour) ? g.volumePerHour / 3600 * growth : null;
      case "share": return pos(sc.totalTps) && shareTotal > 0 ? sc.totalTps * growth * (g.sharePct || 0) / 100 : null;
      case "iterations": {
        const steady = steadySeconds(sc);
        return pos(g.iterations) && steady > 0 ? g.iterations * txCount(g) / steady : null;
      }
      default: return null;
    }
  }
  const steadySeconds = (sc) => (pos(sc.steadyMin) ? sc.steadyMin * 60 : 3600);

  /* ---------- one group: Vusers, pacing, TPS ---------- */
  function solveGroup(g, sc, shareTotal) {
    const T = txCount(g), it = iterationTime(g);
    const h = nn(sc.headroomPct) ? sc.headroomPct / 100 : 0.25;
    const rnd = nn(sc.randomPct) ? Math.min(sc.randomPct, 90) / 100 : 0;  // "auto" pacing style: random +/- %
    const style = sc.pacingStyle === "random" ? "random" : "fixed";
    const pm = (g.pacing && g.pacing.mode) || "auto";
    const pc = g.pacing || {};
    const out = { id: g.id, name: g.name || "Script", protocol: g.protocol || "web", pool: g.pool, kind: g.kind, pageShare: g.pageShare, perLg: g.perLg, T, it, method: g.method,
      checks: [], why: [], status: "ok", vusers: null, pacing: null, tps: null, target: null };
    // a missing input: names the script (gid) and the field to fill in, so the page can take the user there
    const FIELD = { target: ({ volume: "volumePerHour", share: "sharePct", iterations: "iterations" })[g.method] || "targetTps", vusers: "vusers", rt: "rtAvg",
      pacing: ((g.pacing && g.pacing.mode) === "random") ? "pacing.min" : "pacing.fixed" };
    const need = (what, text) => { out.status = "needs-input"; out.needs = what; out.checks.push({ level: "bad", code: "needs-" + what, text, gid: g.id, field: FIELD[what] }); return out; };

    const target = targetTps(g, sc, shareTotal);
    out.target = target;
    const sizedByTps = g.method !== "vusers";
    if (sizedByTps && !pos(target)) return need("target", `${out.name}: enter its target (${({ tps: "TPS", vusers_tps: "TPS", volume: "transactions per hour", share: "share of the scenario TPS — and the scenario total", iterations: "number of iterations" })[g.method] || "TPS"}).`);
    if ((g.method === "vusers" || g.method === "vusers_tps") && !pos(g.vusers)) return need("vusers", `${out.name}: enter the number of Vusers.`);

    const lam = sizedByTps ? target / T : null;            // iterations per second the target needs
    const baseAuto = () => {                               // the shortest pacing the tool will choose
      if (it.mean == null) return null;
      let b = it.mean * (1 + h);
      if (style === "random" && rnd > 0) b = Math.max(b, it.worst / (1 - rnd));
      return Math.max(1, Math.ceil(b - EPS));
    };
    let V, P, pMin, pMax, kind;                            // kind: fixed | random | asap | after
    const setRange = (mean) => {
      P = mean;
      if (kind === "random") { pMin = mean * (1 - rnd); pMax = mean * (1 + rnd); } else { pMin = pMax = mean; }
    };
    // the tool's own random pacing in whole seconds: the shortest rounded up (never shorter than worked out), the longest
    // the same distance above the average, so the average — and the TPS — stay as they are
    const wholeRandom = () => { if (kind === "random" && Number.isInteger(P)) { pMin = Math.max(1, ceilE(P * (1 - rnd))); pMax = 2 * P - pMin; } };

    if (g.method === "vusers_tps") {                       // both given: the pacing follows
      V = g.vusers; kind = style === "random" && rnd > 0 ? "random" : "fixed";
      setRange(V / lam);
      out.why.push(`Pacing = Vusers × transactions ÷ TPS = ${V} × ${T} ÷ ${round(target, 3)} = ${sec1(P)}.`);
    } else if (pm === "fixed" || pm === "random") {
      if (pm === "fixed" && !pos(pc.fixed)) return need("pacing", `${out.name}: enter the pacing in seconds.`);
      if (pm === "random" && !(pos(pc.min) && pos(pc.max))) return need("pacing", `${out.name}: enter the shortest and longest pacing.`);
      kind = pm;
      if (pm === "fixed") { P = pMin = pMax = pc.fixed; }
      else { pMin = Math.min(pc.min, pc.max); pMax = Math.max(pc.min, pc.max); P = (pMin + pMax) / 2; }
      if (sizedByTps) {
        V = Math.max(1, ceilE(lam * P));
        out.why.push(`Vusers = TPS × pacing ÷ transactions = ${round(target, 3)} × ${sec1(P)} ÷ ${T}, rounded up = ${V}.`);
      } else V = g.vusers;
    } else if (pm === "asap" || pm === "after") {
      kind = pm;
      const delay = pm === "after" && nn(pc.delay) ? pc.delay : 0;
      if (it.mean == null) {
        if (sizedByTps) return need("rt", `${out.name}: with “${pm === "asap" ? "as soon as possible" : "after the previous iteration"}” pacing the iteration time sets the speed — enter the average response time, or choose a fixed pacing.`);
        V = g.vusers;                                     // Vusers only: what-if table instead of one number
        out.status = "estimate";
        out.whatIf = whatIf(V, T, it.think.mean, delay);
        out.ceilingTps = it.think.mean + delay > 0 ? V * T / (it.think.mean + delay) : null;
        out.checks.push({ level: "warn", code: "tps-depends-on-rt", text: `${out.name}: without pacing the TPS depends on how fast the system answers. See the what-if table${out.ceilingTps ? `; it can never exceed ${round(out.ceilingTps, 2)} TPS (instant responses)` : ""}.` });
        out.vusers = V; out.pacing = { kind, mean: null, min: null, max: null, delay };
        return out;
      }
      setRange(it.mean + delay);
      V = sizedByTps ? Math.max(1, ceilE(lam * P)) : g.vusers;
      out.why.push(`No fixed pacing: an iteration starts ${delay ? `${sec1(delay)} after` : "as soon as"} the previous one ends, so one Vuser takes ≈ ${sec1(P)} per iteration (${T} × ${round(it.rtMean / T, 2)} s response + ${sec1(it.think.mean)} think${delay ? ` + ${sec1(delay)}` : ""}).`);
      out.why.push(sizedByTps ? `Vusers = TPS × ${sec1(P)} ÷ ${T} = ${round(target, 3)} × ${round(P, 2)} ÷ ${T}, rounded up = ${V}.` : `${V} Vusers as entered → about ${round(V * T / P, 2)} TPS.`);
      out.checks.push({ level: "warn", code: "uncontrolled", text: `${out.name}: no fixed pacing — the TPS rises and falls with the response times. Fine for a stress test; use a fixed or random pacing to prove a TPS target.` });
    } else {                                               // auto: the tool chooses the pacing
      const b = baseAuto();
      if (b == null) {
        return need("rt", sizedByTps
          ? `${out.name}: enter a response time so the tool can choose the pacing — your SLA will do (e.g. 2 s). Or set a fixed pacing instead.`
          : `${out.name}: enter a response time (your SLA will do) or set a fixed pacing — either one gives the TPS of ${g.vusers} Vusers.`);
      }
      kind = style === "random" && rnd > 0 ? "random" : "fixed";
      if (sizedByTps) {
        // Smallest Vuser count that reaches the target at pacing >= b; then the pacing that hits the target
        // exactly. Prefer a whole-second pacing when a few more Vusers give one.
        const v0 = Math.max(1, ceilE(lam * b));
        const vMax = v0 + Math.max(2, Math.ceil(v0 * 0.1));
        let pick = null, near = null, best = null;
        for (let v = v0; v <= vMax; v++) {
          const p = Math.floor(v / lam + 1e-6);                   // the longest whole-second pacing that still reaches the target
          if (p < b) continue;                                     // never below the shortest safe pacing (v ≥ λ × b, so it holds)
          const over = v / (lam * p) - 1;                          // how far the TPS lands above the target
          if (over < 1e-6) { pick = { v, p, over: 0 }; break; }    // exact
          if (!near && over <= 0.01 + EPS) near = { v, p, over };
          if (!best || over < best.over - EPS) best = { v, p, over };
        }
        // a short pacing where one second is a big step (4.4 s → 4 s is 10%): keep the TPS, pace to 0.1 s as before
        pick = pick || near || { v: v0, p: Math.floor((v0 / lam) * 10 + EPS) / 10, over: 0, tenths: best ? best.over : null };
        V = pick.v; setRange(pick.p); wholeRandom();
        out.why.push(`Iteration ≈ ${sec1(it.mean)} (${T} × ${it.rtMean / T} s response + ${sec1(it.think.mean)} think). Shortest safe pacing = iteration + ${Math.round(h * 100)}% headroom → ${b} s.`);
        out.why.push(`Vusers = TPS × pacing ÷ transactions → ${V}; pacing ${sec1(P)}${pick.tenths != null ? ` (to 0.1 s: a whole second would put the TPS ${round(pick.tenths * 100, 1)}% above the target)` : pick.over ? ` (whole seconds) — the TPS lands ${round(pick.over * 100, 2)}% above the target` : " (whole seconds) so the TPS is exact"}.`
          + (V > v0 ? ` (${V - v0} more than the ${v0} the shortest pacing needs, for a whole-second pacing.)` : ""));
      } else {
        V = g.vusers; setRange(b); wholeRandom();
        out.why.push(`Iteration ≈ ${sec1(it.mean)}; pacing = iteration + ${Math.round(h * 100)}% headroom = ${b} s.`);
      }
    }

    out.vusers = V;
    out.pacing = { kind, mean: P, min: pMin, max: pMax, delay: kind === "after" && nn(pc.delay) ? pc.delay : 0 };
    out.ips = V / P;                                       // iterations per second
    out.tps = V * T / P;
    out.tpsMin = V * T / pMax;
    out.tpsMax = V * T / pMin;
    if (pos(g.requestsPerIter)) out.hitsPerSec = g.requestsPerIter * out.ips;

    // budget: the slowest average response time per transaction that keeps the pacing
    if (kind === "fixed" || kind === "random") {
      out.rtBudget = (pMin - it.think.worst) / T;
      if (out.rtBudget <= 0) out.checks.push({ level: "bad", code: "think-exceeds-pacing", text: `${out.name}: the think time alone (${sec1(it.think.worst)}) is longer than the ${kind === "random" ? "shortest " : ""}pacing (${sec1(pMin)}). Shorten the think time or lengthen the pacing.` });
    }

    // feasibility against the iteration time
    if (it.mean != null && (kind === "fixed" || kind === "random")) {
      if (pMin < it.mean - EPS) {
        out.status = "infeasible";
        const reach = V * T / Math.max(it.mean, P);
        const fix = sizedByTps ? ` Use at least ${Math.max(1, ceilE(lam * it.mean * (1 + h)))} Vusers` : ` Lengthen the pacing to at least ${Math.ceil(it.mean * (1 + h))} s`;
        out.checks.push({ level: "bad", code: "pacing-too-short", text: `${out.name}: one iteration takes about ${sec1(it.mean)} but the ${kind === "random" ? "shortest " : ""}pacing is ${sec1(pMin)} — iterations overrun and the TPS drops to about ${round(reach, 2)}.${fix}.` });
      } else if (pMin < it.worst - EPS) {
        out.checks.push({ level: "warn", code: "pacing-tight", text: `${out.name}: slow iterations (${sec1(it.worst)} at the 90th percentile${it.think.worst > it.think.mean ? " and the longest think time" : ""}) are longer than the ${kind === "random" ? "shortest " : ""}pacing of ${sec1(pMin)}; some iterations will overrun.` });
      } else if (pMin < it.mean * (1 + h) - EPS) {
        out.checks.push({ level: "warn", code: "low-headroom", text: `${out.name}: pacing ${sec1(pMin)} leaves less than ${Math.round(h * 100)}% headroom over the ${sec1(it.mean)} iteration — little room if responses slow down.` });
      }
    }
    if (out.rtBudget > 0) {
      const planned = it.rtKnown ? ` (planned ${round(g.rtAvg, 2)} s)` : " — no response time entered, so this is the limit to agree with the business";
      out.checks.push({ level: it.rtKnown ? "ok" : "info", code: "rt-budget", text: `${out.name}: the TPS holds while the average response time stays under ${round(out.rtBudget, 2)} s per transaction${planned}.` });
    }
    if (sizedByTps && Math.abs(out.tps - target) / target > 0.01)
      out.checks.push({ level: "info", code: "rounded", text: `${out.name}: Vusers are whole numbers, so the plan gives ${round(out.tps, 2)} TPS for the ${round(target, 2)} asked.` });
    return out;
  }

  function whatIf(V, T, think, delay) {
    return [0.25, 0.5, 1, 2, 3, 5].map((rt) => {
      const iter = rt * T + think + (delay || 0);
      return { rt, iter, tps: iter > 0 ? V * T / iter : null };
    });
  }

  /* ---------- ramp: "Start X Vusers every HH:MM:SS", chosen by the tool ---------- */
  // Spread the starts over at least 3 pacing intervals (iterations then interleave evenly and the
  // start-up burst stays small), at least 1 minute, at most 30 minutes / a quarter of the steady state.
  // Never faster than `rate` new Vusers per second (log-ins are the heaviest step; default 2 per second).
  function rampTarget(V, maxPace, steadyS, fast, rate) {
    if (V <= 1) return 0;
    if (fast) return Math.min(60, Math.max(10, maxPace || 10));          // spike: as fast as one pacing
    const cap = Math.max(60, Math.min(1800, steadyS / 4));               // pacing-based part: at most 30 min / quarter of the steady state
    return Math.max(Math.min(Math.max(60, 3 * (maxPace || 20)), cap), V / (pos(rate) ? rate : 2));   // the start rate always wins
  }
  // Pick (perStep, every) so that (steps - 1) x every ≈ the wanted duration. Few Vusers per step first.
  function stepPlan(V, wanted, rate) {
    if (V <= 0) return { count: 0, perStep: 0, every: 0, duration: 0 };
    if (V === 1 || wanted <= 0) return { count: V, perStep: V, every: 0, duration: 0, all: true };
    let best = null;
    for (let k = 1; k <= V; k++) {
      const steps = Math.ceil(V / k);
      if (steps === 1) {
        // all at once: only without a rate (the spike burst); with a rate, the steps above are always slower
        if (!pos(rate)) { const c = { count: V, perStep: V, every: 0, duration: 0, all: true, err: 1 }; if (!best) best = c; }
        break;
      }
      const exact = wanted / (steps - 1);
      let every = NICE.reduce((a, n) => (Math.abs(n - exact) < Math.abs(a - exact) ? n : a), NICE[0]);
      // never faster than the rate: the nearest interval that is not too fast (one Vuser every 300 s at the slowest)
      if (pos(rate) && k / every > rate + 1e-9) { const slow = NICE.find((n) => k / n <= rate + 1e-9); if (!slow) continue; every = slow; }
      const duration = (steps - 1) * every;
      const err = Math.abs(duration - wanted) / wanted;
      const c = { count: V, perStep: k, every, duration, err };
      if (!best || err < best.err - 1e-9) best = c;
      if (err <= 0.1 && exact >= 1) { best = c; break; }   // good enough with the fewest Vusers per step
    }
    // a rate slower than 1 Vuser every 300 s: the slowest steps there are (said by the rate check in the tests)
    return best || { count: V, perStep: 1, every: NICE[NICE.length - 1], duration: (V - 1) * NICE[NICE.length - 1], err: 1 };
  }
  // Steps that end by `target` (never later), never faster than `rate`: the fewest Vusers per step that end within 10%
  // of it, else the longest that fits. Used to slow a quicker group down to the longest ramp of a by-group schedule, so
  // no group ends its ramp after the slowest one. Any whole second up to 300 s (LRE takes any HH:MM:SS), so one Vuser per
  // step nearly always fits — smoother than a round interval with several Vusers per step. Nothing fits → stepPlan's choice.
  function fitPlan(V, target, rate) {
    if (V <= 1 || target <= 0) return stepPlan(V, target, rate);
    let best = null;
    for (let k = 1; k < V; k++) {
      const steps = Math.ceil(V / k);
      const every = Math.min(300, Math.floor(target / (steps - 1) + 1e-9));   // the longest whole interval that fits
      if (every < 1 || (pos(rate) && k / every > rate + 1e-9)) continue;
      const mine = { count: V, perStep: k, every, duration: (steps - 1) * every };
      if (mine.duration >= target * 0.9 - 1e-9) return mine;
      if (!best || mine.duration > best.duration) best = mine;
    }
    return best || stepPlan(V, target, rate);
  }

  /* ---------- schedule: a list of actions, simulated per Vuser ---------- */
  // actions: { type: 'start', count, perStep, every } | { type: 'hold', dur, label } | { type: 'stop', count|'all', perStep, every }
  function buildProfile(sc, groups, wl) {
    const tt = TEST_TYPES[sc.testType] || TEST_TYPES.load;
    const steadyS = steadySeconds(sc);
    const maxPace = Math.max(0, ...groups.map((g) => g.pacing && g.pacing.mean || 0));
    const total = groups.reduce((a, g) => a + g.vusers, 0);
    const rate = sc.maxStartRate;
    // ramp-down: half the ramp-up, but never shorter than the stop rate allows (Vusers ÷ twice the start rate) — halving
    // the ramp-up also halved that floor, so the steps had to stop many Vusers at once
    const stopPlan = (n) => { const p = stepPlan(n, Math.max(rampTarget(n, maxPace, steadyS, false, rate * 2) / 2, pos(rate) ? n / (rate * 2) : 0), rate * 2); return { type: "stop", count: n, perStep: p.perStep, every: p.every, all: p.all }; };
    const startPlan = (n, fast) => { const p = stepPlan(n, rampTarget(n, maxPace, steadyS, fast, rate), fast ? null : rate); return { type: "start", count: n, perStep: p.perStep, every: p.every, all: p.all }; };

    if (wl === "real-world" && (tt.levels || tt.base)) {
      const acts = [];
      if (tt.levels) {
        const levels = (sc.levels && sc.levels.length ? sc.levels : tt.levels).slice().sort((a, b) => a - b);
        const hold = pos(sc.stepHoldMin) ? sc.stepHoldMin * 60 : Math.max(600, 5 * maxPace);
        let have = 0;
        levels.forEach((pct) => {
          const n = Math.ceil(total * pct / 100 - EPS) - have;
          if (n > 0) { acts.push(startPlan(n)); have += n; }
          acts.push({ type: "hold", dur: hold, label: `${pct}% of the target (${have} Vusers)` });
        });
        acts.push(stopPlan(have));
        return { actions: acts, peak: have, steadyLabel: "each step" };
      }
      const base = Math.max(1, Math.ceil(total * (sc.spikeBase || tt.base) / 100 - EPS));
      const peak = Math.max(base, Math.ceil(total * (sc.spikePeak || tt.peak) / 100 - EPS));
      const hold = pos(sc.stepHoldMin) ? sc.stepHoldMin * 60 : 600;
      return { actions: [
        startPlan(base), { type: "hold", dur: hold, label: `normal load (${base} Vusers)` },
        startPlan(peak - base, true), { type: "hold", dur: Math.min(hold, 600), label: `spike (${peak} Vusers)` },
        { type: "stop", count: peak - base, perStep: peak - base, every: 0, all: true }, { type: "hold", dur: hold, label: `recovery (${base} Vusers)` },
        stopPlan(base),
      ], peak };
    }
    return { actions: [startPlan(total), { type: "hold", dur: steadyS, label: `full load (${total} Vusers)` }, stopPlan(total)], peak: total };
  }

  // Order in which the Vusers of a "by test" schedule belong to groups: spread by share (like LRE's percentage mode).
  function interleave(groups) {
    const total = groups.reduce((a, g) => a + g.vusers, 0), got = groups.map(() => 0), order = [];
    for (let i = 0; i < total; i++) {
      let best = -1, bestDef = -Infinity;
      groups.forEach((g, j) => { const d = g.vusers * (i + 1) / total - got[j]; if (got[j] < g.vusers && d > bestDef) { bestDef = d; best = j; } });
      got[best]++; order.push(best);
    }
    return order;
  }

  // Runs the actions; returns per-Vuser {group, start, stop} and the phase marks.
  function simulate(actions, groupOf, offset) {
    const users = [], running = [];
    let t = offset || 0, next = 0;
    const marks = [];
    for (const a of actions) {
      if (a.type === "start") {
        const steps = a.all ? 1 : Math.ceil(a.count / a.perStep);
        for (let s = 0, left = a.count; s < steps; s++) {
          const n = a.all ? a.count : Math.min(a.perStep, left); left -= n;
          for (let i = 0; i < n; i++) { const u = { group: groupOf(next++), start: t + s * (a.every || 0), stop: null }; users.push(u); running.push(u); }
        }
        const end = t + (a.all ? 0 : (steps - 1) * (a.every || 0));
        marks.push({ type: "start", from: t, to: end }); t = end;
      } else if (a.type === "hold") {
        marks.push({ type: "hold", from: t, to: t + a.dur, label: a.label }); t += a.dur;
      } else {
        const count = a.count === "all" ? running.length : Math.min(a.count, running.length);
        const steps = a.all ? 1 : Math.ceil(count / a.perStep);
        for (let s = 0, left = count; s < steps; s++) {
          const n = a.all ? count : Math.min(a.perStep, left); left -= n;
          for (let i = 0; i < n; i++) { const u = running.pop(); u.stop = t + s * (a.every || 0); }  // last started stops first
        }
        const end = t + (a.all ? 0 : (steps - 1) * (a.every || 0));
        marks.push({ type: "stop", from: t, to: end }); t = end;
      }
    }
    running.forEach((u) => { u.stop = t; });
    return { users, marks, end: t };
  }

  // Iterations started in [a, b) by a Vuser running [s, e) with pacing P (the first one at s).
  function itersIn(s, e, P, a, b) {
    const lo = Math.max(a, s), hi = Math.min(b, e);
    if (hi <= lo || !(P > 0)) return 0;
    return Math.max(0, ceilE((hi - s) / P) - ceilE((lo - s) / P));
  }

  /* ---------- load generators ---------- */
  function lgCapacity(pool, proto, protos) {
    const ov = pool.capacity && pool.capacity[proto];
    if (pos(ov)) return { cap: Math.floor(ov), from: "your figure" };
    const p = protos[proto] || protos.other;
    if (!(pos(pool.cores) && pos(pool.ramGb))) return { cap: null, from: "missing" };
    const limit = nn(pool.limitPct) ? pool.limitPct / 100 : 0.7;
    const usableMb = Math.max(0, pool.ramGb - (nn(pool.reserveGb) ? pool.reserveGb : 2)) * 1024 * limit;
    const byMem = Math.floor(usableMb / p.memMb), byCpu = Math.floor(pool.cores * p.perCore * limit);
    return { cap: Math.max(1, Math.min(byMem, byCpu)), from: byMem <= byCpu ? "memory" : "CPU", byMem, byCpu };
  }
  // The team's rule of thumb: Vusers one machine carries for a script of web pages and for one of API calls (set on the
  // pool). A script that mixes both uses up a machine in proportion: 1 / (p / web + (1 − p) / API), p = its share of
  // page requests. Kind: "web" (p = 1), "api" (p = 0), else the share read from the script — unknown counts as web
  // pages (the cautious side: more machines). Not for TruClient (real browsers: CPU and memory decide).
  function pageShareOf(g) {
    if (g.kind === "web") return 1;
    if (g.kind === "api") return 0;
    return nn(g.pageShare) && g.pageShare <= 1 ? g.pageShare : 1;
  }
  function ruleCapacity(pool, g) {
    if (g.protocol === "truclient") return null;
    const w = pos(pool.webPerLg) ? pool.webPerLg : pos(pool.apiPerLg) ? pool.apiPerLg : null;
    const a = pos(pool.apiPerLg) ? pool.apiPerLg : w;
    if (!w) return null;
    const p = pageShareOf(g);
    return Math.max(1, Math.floor(1 / (p / w + (1 - p) / a) + EPS));
  }
  // From a past run (Results Analyser, LG health): this LG ran `vusers` at these peaks.
  function capacityFromRun(vusers, cpuPeakPct, memPeakPct, limitPct) {
    const peak = Math.max(cpuPeakPct || 0, memPeakPct || 0);
    if (!(pos(vusers) && peak > 0)) return null;
    return Math.max(1, Math.floor(vusers * (limitPct || 70) / peak));
  }

  /* ---------- which script runs on which load generator ----------
     items: [{ id, name, vusers, cpu, mem, browser, hits }] — cpu / mem = one Vuser's share of one machine (1 = the 70% limit),
     hits = requests per second of one Vuser. One class of machines at a time: browser scripts (TruClient) never share a
     machine with the others. A script needing more than one machine gets its own machines, its Vusers split evenly (LRE
     splits a group's Vusers evenly over its load generators); then the others, largest first, go onto the least-busy
     machine with room. Returns { machines: [{ cpu, mem, hits, browser, items: [{ id, name, vusers }] }], lowerBound,
     extra: { id, name, vusers, split: [n1, n2] | null } | null } — extra = a script that did not fit whole anywhere. */
  function packPool(items, limit, more) {
    const L = pos(limit) ? limit : 1;
    const machines = [];
    let lowerBound = 0, extra = null;
    const r = (it) => it.rule || 0;
    const busy = (m) => Math.max(m.cpu, m.mem, m.rule);
    const add = (m, it, v) => { m.cpu += v * it.cpu; m.mem += v * it.mem; m.rule += v * r(it); m.hits += v * (it.hits || 0); m.items.push({ id: it.id, name: it.name, vusers: v }); };
    const room = (m, it) => Math.floor(Math.min((L - m.cpu) / it.cpu, (L - m.mem) / it.mem, r(it) ? (L - m.rule) / r(it) : Infinity) + EPS);
    for (const browser of [false, true]) {
      const mine = items.filter((it) => !!it.browser === browser && it.vusers > 0);
      if (!mine.length) continue;
      const load = (it) => it.vusers * Math.max(it.cpu, it.mem, r(it));
      const sum = (f) => mine.reduce((a, it) => a + it.vusers * f(it), 0);
      const lb = ceilE(Math.max(sum((it) => it.cpu), sum((it) => it.mem), sum(r)) / L);
      lowerBound += lb;
      const ms = [];
      const fresh = () => { const m = { cpu: 0, mem: 0, rule: 0, hits: 0, browser, items: [] }; ms.push(m); return m; };
      const sorted = mine.slice().sort((a, b) => load(b) - load(a));
      // big scripts: their own machines, Vusers split evenly (the first machines take the remainder)
      sorted.filter((it) => load(it) > L + EPS).forEach((it) => {
        const k = Math.min(it.vusers, ceilE(load(it) / L) + ((more && more[it.id]) || 0)), base = Math.floor(it.vusers / k), rest = it.vusers - base * k;
        for (let i = 0; i < k; i++) add(fresh(), it, base + (i < rest ? 1 : 0));
      });
      // as many machines as the plain total needs, so the small scripts can spread over them
      while (ms.length < lb) fresh();
      sorted.filter((it) => load(it) <= L + EPS).forEach((it) => {
        const fits = ms.filter((m) => m.cpu + it.vusers * it.cpu <= L + EPS && m.mem + it.vusers * it.mem <= L + EPS && m.rule + it.vusers * r(it) <= L + EPS);
        if (fits.length) { add(fits.reduce((a, m) => (busy(m) < busy(a) - EPS ? m : a)), it, it.vusers); return; }
        // fits nowhere whole: a new machine — and would it fit as two groups on the machines there are?
        if (!extra) {
          const byRoom = ms.map((m) => [m, room(m, it)]).sort((a, b) => b[1] - a[1]);
          const n1 = byRoom[0] ? byRoom[0][1] : 0, n2 = byRoom[1] ? byRoom[1][1] : 0;
          extra = { id: it.id, name: it.name, vusers: it.vusers, split: n1 > 0 && n1 + n2 >= it.vusers ? [n1, it.vusers - n1] : null };
        }
        add(fresh(), it, it.vusers);
      });
      machines.push(...ms.filter((m) => m.items.length));
    }
    return { machines, lowerBound, extra };
  }

  /* Fill each machine (the default): a machine runs several groups, so each is filled up to the limit and a script that
     does not fit whole continues on the next machine — in LRE that script becomes two (or more) groups. Largest first;
     a script goes whole onto the fullest machine with room for it (spread = n machines: n open from the start, the
     least busy), else fills the fullest
     machine with room for at least 5 of its Vusers (no tiny groups), else a new machine. Same result shape as packPool. */
  function fillPool(items, limit, spread, minGroup) {
    const L = pos(limit) ? limit : 1, MIN = pos(minGroup) ? Math.floor(minGroup) : 5;
    const machines = [];
    let lowerBound = 0;
    const r = (it) => it.rule || 0;
    const busy = (m) => Math.max(m.cpu, m.mem, m.rule);
    const add = (m, it, v) => { m.cpu += v * it.cpu; m.mem += v * it.mem; m.rule += v * r(it); m.hits += v * (it.hits || 0); m.items.push({ id: it.id, name: it.name, vusers: v }); };
    const room = (m, it) => Math.max(0, Math.floor(Math.min(it.cpu ? (L - m.cpu) / it.cpu : Infinity, it.mem ? (L - m.mem) / it.mem : Infinity, r(it) ? (L - m.rule) / r(it) : Infinity) + EPS));
    for (const browser of [false, true]) {
      const mine = items.filter((it) => !!it.browser === browser && it.vusers > 0);
      if (!mine.length) continue;
      const load = (it) => it.vusers * Math.max(it.cpu, it.mem, r(it));
      const sum = (f) => mine.reduce((a, it) => a + it.vusers * f(it), 0);
      lowerBound += ceilE(Math.max(sum((it) => it.cpu), sum((it) => it.mem), sum(r)) / L);
      const ms = [];
      const fresh = () => { const m = { cpu: 0, mem: 0, rule: 0, hits: 0, browser, items: [] }; ms.push(m); return m; };
      const fullest = (need, it) => ms.filter((m) => room(m, it) >= need).sort((a, b) => busy(b) - busy(a))[0];
      // spread = n: start with n machines open (no browser scripts), so whole scripts go onto empty ones first
      if (spread > 0 && !browser && !items.some((x) => x.browser)) while (ms.length < spread) fresh();
      mine.slice().sort((a, b) => load(b) - load(a)).forEach((it) => {
        let left = it.vusers;
        // spread: a whole script goes onto the least busy machine with room (keeps machines even); else the fullest
        const whole = spread ? ms.filter((m) => room(m, it) >= left).sort((a, b) => busy(a) - busy(b))[0] : fullest(left, it);
        if (whole) { add(whole, it, left); return; }
        let none = false;                                         // no open machine has room: the rest goes onto new ones
        while (left > 0) {
          const m = (!none && fullest(Math.min(MIN, left), it)) || (none = true, fresh());
          let put = Math.max(1, Math.min(left, room(m, it)));     // one Vuser bigger than a machine still gets one
          // never leave fewer than 5 behind (a group of 1 or 2 Vusers): keep them for the next machine
          if (left - put > 0 && left - put < MIN && put - (MIN - (left - put)) >= MIN) put -= MIN - (left - put);
          add(m, it, put); left -= put;
        }
      });
      machines.push(...ms);
    }
    return { machines, lowerBound, extra: null };
  }

  /* Spreading over n machines (extra machines carry Vusers). spreadTo: the lowest per-machine limit that still fits into
     n machines (halving search, 14 steps, from total load ÷ n — below that more than n are needed anyway); for whole
     scripts one limit for all cannot always land on n (two scripts of 6 machines each grow to 7 + 7 together), so the
     machines still left go one at a time to the own-machine script whose machines are the busiest. */
  const loadOf = (it) => it.vusers * Math.max(it.cpu, it.mem, it.rule || 0);
  const minLimit = (items, n) => Math.min(1, Math.max(...["cpu", "mem", "rule"].map((d) => items.reduce((a, it) => a + it.vusers * (it[d] || 0), 0))) / n);
  function spreadTo(items, n, packer) {
    let lo = minLimit(items, n), hi = 1, pack = packer(items);
    for (let k = 0; k < 14 && pack.machines.length < n; k++) {
      const mid = (lo + hi) / 2, q = packer(items, mid);
      if (q.machines.length <= n) { hi = mid; pack = q; } else lo = mid;
    }
    if (packer !== packPool) return pack;
    const more = {}, L = hi;
    for (let guard = 0; pack.machines.length < n && guard < 1000; guard++) {
      const own = items.filter((it) => loadOf(it) > L + EPS).map((it) => ({ it, k: Math.min(it.vusers, ceilE(loadOf(it) / L) + (more[it.id] || 0)) }))
        .filter((x) => x.k < x.it.vusers).sort((a, b) => loadOf(b.it) / b.k - loadOf(a.it) / a.k);
      if (!own.length) break;
      more[own[0].it.id] = (more[own[0].it.id] || 0) + 1;
      const q = packPool(items, L, more);
      if (q.machines.length > n || q.machines.length <= pack.machines.length) break;
      pack = q;
    }
    return pack;
  }
  // the best of several layouts: no empty machine and none over the limit; as close to n machines as possible (never
  // more), then the fewest groups (script parts), then the coolest busiest machine
  function bestOf(list, n) {
    const pieces = (q) => q.machines.reduce((a, m) => a + m.items.length, 0);
    const peak = (q) => Math.max(0, ...q.machines.map((m) => Math.max(m.cpu, m.mem, m.rule)));
    const okay = (q) => q && q.machines.length <= n && q.machines.every((m) => m.items.length) && peak(q) <= 1 + 1e-6;
    return list.filter(okay).sort((a, b) => b.machines.length - a.machines.length || pieces(a) - pieces(b) || peak(a) - peak(b))[0] || list.find(Boolean);
  }
  // Filling n machines: the tightest limit splits most scripts; a looser one, or spreading whole scripts over the least
  // busy machines, often splits fewer. Try both at limits from `from` up to 1; keep exactly n machines, the fewest
  // groups (script parts), then the coolest busiest machine.
  function fewestGroups(items, n, from, best, minGroup) {
    const list = best ? [best] : [];
    for (let k = 0; k <= 10; k++) for (const spread of [false, true]) {
      const q = fillPool(items, from + (1 - from) * k / 10, spread ? n : 0, minGroup);
      if (q.machines.length === n && q.machines.every((m) => m.items.length)) list.push(q);
    }
    return list.length ? bestOf(list, n) : null;
  }

  /* ---------- the whole model ---------- */
  function model(input) {
    const sc = Object.assign({ testType: "load", headroomPct: 25, randomPct: 15, pacingStyle: "fixed", growth: 1, maxStartRate: 2 }, input.scenario || {});
    const protos = Object.assign({}, PROTOCOLS, input.protocols || {});
    const pools = (input.pools && input.pools.length ? input.pools : [{ id: "p1", name: "Load generators", spare: 1 }]);
    const tt = TEST_TYPES[sc.testType] || TEST_TYPES.load;
    if (!pos(sc.steadyMin)) sc.steadyMin = tt.steadyMin;
    const wl = sc.workload || tt.workload;
    const checks = [];

    const shareRows = (input.groups || []).filter((g) => g.method === "share");
    const shareTotal = shareRows.reduce((a, g) => a + (g.sharePct || 0), 0);
    if (shareRows.length && Math.abs(shareTotal - 100) > 0.01) checks.push({ level: "bad", code: "share-total", text: `The shares of the scenario TPS add up to ${round(shareTotal, 2)}%, not 100%.` });
    if (shareRows.length && !pos(sc.totalTps)) checks.push({ level: "bad", code: "needs-total", text: "Some scripts take a share of the scenario TPS: enter the scenario's total TPS." });

    const groups = (input.groups || []).map((g, i) => solveGroup(Object.assign({ id: "g" + (i + 1) }, g), sc, shareTotal));
    if (pos(sc.growth) && Math.abs(sc.growth - 1) > EPS) {
      const kept = groups.filter((g) => g.method === "vusers" || g.method === "iterations");
      if (kept.length) checks.push({ level: "info", code: "growth-kept", text: `Growth factor ${round(sc.growth, 2)} raises the TPS targets; ${kept.length === 1 ? kept[0].name + " keeps its" : kept.length + " scripts keep their"} Vusers or iterations as entered.` });
    }
    groups.forEach((g) => checks.push(...g.checks));
    const ready = groups.filter((g) => g.vusers > 0 && g.pacing && g.pacing.mean > 0);
    const allReady = groups.length > 0 && ready.length === groups.length;

    const res = { scenario: sc, workload: wl, workloadLabel: WORKLOADS[wl], testType: tt, groups, checks, ready: allReady };
    if (!groups.length) { checks.push({ level: "bad", code: "no-scripts", text: "Add at least one script." }); return res; }
    if (!allReady) return res;

    /* load generators: each Vuser takes 1/capacity of an LG of its pool. peakShare = the highest step ÷ the planned Vusers.
       Runs before the schedule for a by-group schedule (each LRE group gets its own ramp), after it otherwise. */
    function assignLgs(peakShare) {
    const fill = sc.lgFill !== "whole", minGroup = pos(sc.minGroup) ? sc.minGroup : 5, fastLoop = pos(sc.fastLoopRps) ? sc.fastLoopRps : 2;
    const fillP = (items, L, spread) => fillPool(items, L, spread, minGroup), packer = fill ? fillP : packPool;
    res.lg = pools.map((p) => {
      const mine = groups.filter((g) => (g.pool || pools[0].id) === p.id);
      // each Vuser takes 1/byCpu of a machine's CPU and 1/byMem of its memory; the machines needed = the busier of
      // the two, added up over the pool's scripts (one protocol alone: same as Vusers ÷ capacity). A figure the user
      // gave counts against both.
      // Each script's share of one machine on three limits — CPU, memory and the team rule — the busiest decides.
      // A figure from a past run (the script's own, else the pool's for the protocol) replaces all three.
      let missing = false;
      const items = [];
      const rows = mine.map((g) => {
        const v = Math.ceil(g.vusers * peakShare - EPS);
        const hits = pos(g.hitsPerSec) && pos(g.vusers) ? g.hitsPerSec / g.vusers : 0;   // requests per second of one Vuser
        const own = pos(g.perLg) ? Math.floor(g.perLg) : null;
        const c = own ? { cap: own, from: "script figure" } : lgCapacity(p, g.protocol, protos);
        const fixed = own || c.from === "your figure";
        const rc = fixed ? null : ruleCapacity(p, g);
        if (!c.cap && !rc) { missing = true; return { group: g.name, protocol: g.protocol, cap: null }; }
        const cpu = c.cap ? 1 / (c.byCpu || c.cap) : 0, mem = c.cap ? 1 / (c.byMem || c.cap) : 0, rule = rc ? 1 / rc : 0;
        items.push({ id: g.id, name: g.name, vusers: v, cpu, mem, rule, browser: g.protocol === "truclient", hits });
        const cap = Math.max(1, Math.floor(1 / Math.max(cpu, mem, rule) + EPS));
        const from = fixed ? c.from : rule >= Math.max(cpu, mem) - EPS ? "team rule" : cpu >= mem ? "CPU" : "memory";
        return { group: g.name, protocol: g.protocol, vusers: v, cap, from, ruleCap: rc, pageShare: g.protocol === "truclient" ? null : pageShareOf(g), kind: g.kind || "auto",
          lgs: ceilE(v / cap), fastLoop: hits > fastLoop + EPS && !fixed ? hits : null };
      });
      // extra machines carry Vusers too: the same scripts spread over more machines, each further below the limit
      const want = nn(p.extra) ? Math.floor(p.extra) : nn(p.spare) ? Math.floor(p.spare) : 1;
      const base = missing ? null : packer(items);
      let pack = base, extraUsed = 0;
      if (base && base.machines.length && want > 0) {
        let n = base.machines.length + want;
        if (pos(p.available) && base.machines.length <= p.available && n > p.available) {
          checks.push({ level: "info", code: "lg-extra-cut", text: `${p.name}: ${n - p.available} extra machine${n - p.available === 1 ? "" : "s"} left out — only ${p.available} are available.` });
          n = p.available;
        }
        // fill: whichever layout — filled or whole — uses exactly n machines with the fewest LRE groups;
        // one group per script: the whole layout spread to n
        pack = fill ? bestOf([spreadTo(items, n, fillP), spreadTo(items, n, packPool), fewestGroups(items, n, minLimit(items, n), null, minGroup)], n) : spreadTo(items, n, packPool);
        extraUsed = pack.machines.length - base.machines.length;
      }
      if (fill && base && extraUsed === 0 && base.machines.length) pack = bestOf([base, packPool(items), fewestGroups(items, base.machines.length, 1, null, minGroup)], base.machines.length);
      const needed = base ? base.machines.length : 0, total = pack ? pack.machines.length : null;
      if (!fill && base && needed > base.lowerBound) {
        const x = base.extra;
        checks.push({ level: "warn", code: "lg-packing", text: `${p.name}: ${needed} load generators instead of ${base.lowerBound} — with one group per script, whole scripts do not fit into fewer (LRE splits a group's Vusers evenly over its machines), so some machines are half empty. Choose “Fill each machine” under Load generators to use ${base.lowerBound}.${x && x.split ? ` Or split ${x.name} into two groups (${x.split[0]} + ${x.split[1]} Vusers) to save one.` : ""}` });
      }
      if (missing) checks.push({ level: "bad", code: "lg-size", text: `${p.name}: enter each machine's CPU cores and memory, the team rule (Vusers per machine) or the Vusers one machine can run, to count the load generators.` });
      if (pos(p.available) && needed > p.available)
        checks.push({ level: "bad", code: "lg-short", text: `${p.name}: the test needs ${needed} load generators; ${p.available} are available.` });
      if (base && items.length) {
        // what decided the count: the busiest limit over the pool
        const tot = (f) => items.reduce((a, it) => a + it.vusers * f(it), 0);
        const by = [["the team rule", tot((it) => it.rule || 0)], ["CPU", tot((it) => it.cpu)], ["memory", tot((it) => it.mem)]].sort((a, b) => b[1] - a[1])[0][0];
        const own = rows.some((w) => w.from === "your figure" || w.from === "script figure");
        checks.push({ level: "info", code: "lg-basis", text: `${p.name}: ${needed} load generator${needed === 1 ? "" : "s"} needed, set by ${own ? "your figures and " : ""}${by}${by === "the team rule" ? ` (${pos(p.webPerLg) ? p.webPerLg + " Vusers per machine for web pages" : ""}${pos(p.webPerLg) && pos(p.apiPerLg) ? ", " : ""}${pos(p.apiPerLg) ? p.apiPerLg + " for API calls" : ""})` : ` (the machine size${tot((it) => it.rule || 0) > 0 ? " — more than the team rule asks for" : ""})`}${extraUsed ? `; ${extraUsed} extra = ${total}, the Vusers spread over all of them` : ""}.` });
      }
      rows.filter((w) => w.fastLoop).forEach((w) => checks.push({ level: "warn", code: "lg-fast", text: `${w.group}: each Vuser sends ${round(w.fastLoop, 1)} requests per second — faster than the pace the Vusers-per-machine figures assume. Watch the load generators' CPU in the first run and enter a measured figure.` }));
      return { pool: p, rows, pack, needed: missing ? null : needed, extra: extraUsed, total: missing ? null : total };
    });
    // the machines by name: LG1, LG2 … numbered on from one pool to the next
    res.machines = [];
    res.lg.forEach((x) => {
      if (!x.pack) return;
      x.pack.machines.forEach((m) => res.machines.push(Object.assign({ name: "LG" + (res.machines.length + 1), pool: x.pool.name, poolId: x.pool.id }, m)));
    });
    groups.forEach((g) => { g.lgs = []; });
    res.machines.forEach((m) => m.items.forEach((it) => { const g = groups.find((x) => x.id === it.id); if (g) g.lgs.push({ name: m.name, vusers: it.vusers }); }));
    res.lgTotal = res.lg.every((x) => x.total != null) ? res.lg.reduce((a, x) => a + x.total, 0) : null;
    // LRE groups: one per script and set of machines that LRE can share evenly (sizes within one Vuser) — a script that
    // fills one machine and continues on another is two groups. The planned Vusers follow the peak split.
    res.lreGroups = [];
    const order = new Map(res.machines.map((m, i) => [m.name, i]));
    groups.forEach((g, gi) => {
      const slices = []; res.machines.forEach((m) => m.items.forEach((it) => { if (it.id === g.id) slices.push({ name: m.name, vusers: it.vusers }); }));
      const parts = [];
      slices.slice().sort((a, b) => b.vusers - a.vusers || order.get(a.name) - order.get(b.name)).forEach((s) => {
        const last = parts[parts.length - 1];
        if (last && last[0].vusers - s.vusers <= 1) last.push(s); else parts.push([s]);
      });
      parts.forEach((p) => p.sort((a, b) => order.get(a.name) - order.get(b.name)));
      parts.sort((a, b) => order.get(a[0].name) - order.get(b[0].name));
      const peaks = parts.map((p) => p.reduce((a, s) => a + s.vusers, 0)), all = peaks.reduce((a, x) => a + x, 0);
      // planned Vusers per group: the script's Vusers in proportion to the peak split (largest remainder)
      const raw = peaks.map((x) => (all ? x / all : 0) * g.vusers), plan = raw.map(Math.floor);
      let rest = g.vusers - plan.reduce((a, x) => a + x, 0);
      raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { plan[i]++; rest--; } });
      if (!parts.length) res.lreGroups.push({ id: g.id, scriptId: g.id, gi, name: g.name, part: 1, parts: 1, vusers: g.vusers, lgs: [] });
      parts.forEach((p, k) => res.lreGroups.push({ id: parts.length > 1 ? `${g.id}-${k + 1}` : g.id, scriptId: g.id, gi, name: parts.length > 1 ? `${g.name}_${k + 1}` : g.name,
        part: k + 1, parts: parts.length, vusers: plan[k], lgs: p }));
    });
    const split = groups.filter((g) => res.lreGroups.filter((x) => x.scriptId === g.id).length > 1);
    if (split.length) checks.push({ level: "info", code: "lg-groups", text: `To fill the load generators, ${split.length === 1 ? split[0].name + " runs" : split.length + " scripts run"} as ${split.length === 1 ? res.lreGroups.filter((x) => x.scriptId === split[0].id).length + " groups" : "more than one group each"} in LRE (${split.map((g) => `${split.length === 1 ? "" : g.name + ": "}${res.lreGroups.filter((x) => x.scriptId === g.id).map((x) => x.vusers).join(" + ")} Vusers`).join("; ")}) — add the script to the scenario once per row of LRE setup, each with its own load generators.` });
    }
    if (wl === "basic-group") assignLgs(1);

    /* schedule */
    const steadyS = steadySeconds(sc);
    let users = [], marks = [], end = 0, groupPlans = null, profile = null;
    if (wl === "basic-group") {
      // Every group starts immediately (LRE "Start Group: Immediately") and ramps over the same length — the longest
      // ramp any group needs on its own — so all reach full load together. LRE counts a group's Duration from the end
      // of its own ramp: a group whose steps end a little earlier runs that much longer, so all stop together too.
      // The start rate (and the stop rate, twice it) is shared in proportion to the Vusers: the scripts ramp at the
      // same time, so together they never start more than the rate per second — at least 1 Vuser every 300 s each.
      const all = groups.reduce((a, g) => a + g.vusers, 0), rate = pos(sc.maxStartRate) ? sc.maxStartRate : 2;
      const rampOf = (a) => a.all || !a.perStep ? 0 : (Math.ceil(a.count / a.perStep) - 1) * a.every;
      const plans = res.lreGroups.filter((x) => x.vusers > 0).map((x) => {
        const g = Object.assign({}, groups[x.gi], { id: x.id, name: x.name, vusers: x.vusers, lgs: x.lgs, scriptId: x.scriptId, part: x.part, parts: x.parts });
        const share = Math.max(1 / 300, rate * g.vusers / all);
        return { g, gi: x.gi, share, prof: buildProfile(Object.assign({}, sc, { testType: "load", maxStartRate: share }), [g], "basic") };
      });
      const longest = Math.max(0, ...plans.map((p) => rampOf(p.prof.actions[0])));
      // the same length for all: a slower start for the quicker groups (never faster than their share)
      plans.forEach((p) => {
        const a = p.prof.actions[0];
        if (a.all || rampOf(a) >= longest) return;
        const s = fitPlan(p.g.vusers, longest, p.share);
        p.prof.actions[0] = { type: "start", count: s.count, perStep: s.perStep, every: s.every, all: s.all };
      });
      const full = Math.max(0, ...plans.map((p) => rampOf(p.prof.actions[0])));
      groupPlans = plans.map((p) => {
        const ramp = rampOf(p.prof.actions[0]);
        const actions = p.prof.actions.map((a) => (a.type === "hold" ? Object.assign({}, a, { dur: steadyS + full - ramp }) : a));
        const sim = simulate(actions, () => p.gi, 0);
        users.push(...sim.users);
        end = Math.max(end, sim.end);
        return { group: p.g, delay: 0, actions, ramp, sim };
      });
      marks = [{ type: "start", from: 0, to: full }, { type: "hold", from: full, to: full + steadyS, label: "full load" }, { type: "stop", from: full + steadyS, to: end }];
      profile = { peak: groups.reduce((a, g) => a + g.vusers, 0) };
    } else {
      profile = buildProfile(sc, groups, wl === "real-world" ? "real-world" : "basic");
      const order = interleave(groups);
      const total = order.length;
      // extra Vusers above 100% (stress) follow the same spread
      const sim = simulate(profile.actions, (n) => order[n % total], 0);
      users = sim.users; marks = sim.marks; end = sim.end;
    }
    res.groupPlans = groupPlans;
    res.actions = profile.actions || null;
    res.marks = marks;
    res.peakVusers = profile.peak;
    if ((tt.levels || tt.base) && wl !== "real-world" && wl !== "goal")
      checks.push({ level: "warn", code: "needs-real-world", text: `A ${tt.label.toLowerCase()} test needs steps, which a basic schedule cannot do — choose “Real-world schedule”. The plan below shows only the ramp to 100%.` });

    /* iterations by phase, per group (pacing = its mean) */
    const holdMarks = marks.filter((m) => m.type === "hold");
    const steadyFrom = holdMarks.length ? holdMarks[holdMarks.length - 1].from : 0;
    const steadyTo = holdMarks.length ? holdMarks[holdMarks.length - 1].to : 0;
    const firstFull = wl === "real-world" ? steadyFrom : (marks.find((m) => m.type === "hold") || { from: 0 }).from;
    groups.forEach((g) => { g.iters = { rampUp: 0, steady: 0, rampDown: 0, total: 0 }; });
    users.forEach((u) => {
      const g = groups[u.group], P = g.pacing.mean;
      const all = itersIn(u.start, u.stop, P, -Infinity, Infinity);
      const st = itersIn(u.start, u.stop, P, steadyFrom, steadyTo);
      const up = itersIn(u.start, u.stop, P, -Infinity, steadyFrom);
      g.iters.total += all; g.iters.steady += st; g.iters.rampUp += up; g.iters.rampDown += all - st - up;
    });
    groups.forEach((g) => {
      g.tx = { steady: g.iters.steady * g.T, total: g.iters.total * g.T };
      if (pos(input.groups.find((x, i) => (x.id || "g" + (i + 1)) === g.id).dataRows)) {
        const rows = input.groups.find((x, i) => (x.id || "g" + (i + 1)) === g.id).dataRows;
        g.dataRows = rows;
        if (g.iters.total > rows) checks.push({ level: "warn", code: "data-short", text: `${g.name}: the test runs about ${g.iters.total.toLocaleString("en-GB")} iterations but only ${rows.toLocaleString("en-GB")} data rows are available — reuse rows or prepare more.` });
      }
    });
    res.firstFull = firstFull; res.steadyFrom = steadyFrom; res.steadyTo = steadyTo;
    // running iterations finish (gradual exit): at most the longer of the pacing and a slow (90th percentile) iteration
    res.tail = Math.max(...groups.map((g) => Math.max(g.pacing.mean, (g.it && g.it.worst) || 0)));
    res.duration = end + res.tail;

    /* timeline (Vusers and expected TPS per bucket) */
    const bucket = Math.max(10, Math.ceil(res.duration / 240 / 10) * 10);
    const tl = [];
    for (let t = 0; t <= res.duration; t += bucket) tl.push({ t, vusers: 0, tps: 0 });
    users.forEach((u) => {
      const g = groups[u.group], rate = g.T / g.pacing.mean;
      for (let i = Math.max(0, Math.ceil(u.start / bucket)); i < tl.length && tl[i].t < u.stop; i++) { tl[i].vusers++; tl[i].tps += rate; }
    });
    res.timeline = tl; res.bucket = bucket;

    /* totals */
    const sum = (f) => groups.reduce((a, g) => a + f(g), 0);
    res.totals = {
      vusers: sum((g) => g.vusers), tps: sum((g) => g.tps), tpsMin: sum((g) => g.tpsMin), tpsMax: sum((g) => g.tpsMax),
      target: groups.every((g) => g.target) ? sum((g) => g.target) : null,
      hitsPerSec: groups.some((g) => g.hitsPerSec) ? sum((g) => g.hitsPerSec || 0) : null,
      perHour: sum((g) => g.tps) * 3600,
      iters: { rampUp: sum((g) => g.iters.rampUp), steady: sum((g) => g.iters.steady), rampDown: sum((g) => g.iters.rampDown), total: sum((g) => g.iters.total) },
      tx: { steady: sum((g) => g.tx.steady), total: sum((g) => g.tx.total) },
    };
    if (pos(sc.licenceVusers) && res.peakVusers > sc.licenceVusers)
      checks.push({ level: "bad", code: "licence", text: `The test needs ${res.peakVusers} Vusers at its peak; the licence allows ${sc.licenceVusers}.` });

    if (wl !== "basic-group") assignLgs(res.peakVusers / res.totals.vusers);

    /* ramp checks */
    const start = marks.find((m) => m.type === "start");
    const maxPace = Math.max(...groups.map((g) => g.pacing.mean));
    if (start && start.to - start.from < maxPace && res.totals.vusers > 1 && sc.testType !== "spike")
      checks.push({ level: "warn", code: "ramp-short", text: `All Vusers start within ${words(start.to - start.from)}, shorter than one pacing (${sec1(maxPace)}): their iterations bunch together.` });
    if (groups.some((g) => (g.it.think.mean === 0) && g.it.think.worst === 0 && g.method !== "vusers" && (g.pacing.kind === "fixed" || g.pacing.kind === "random")) && groups.some((g) => (input.groups.find((x, i) => (x.id || "g" + (i + 1)) === g.id).thinkMode) === "ignore"))
      checks.push({ level: "info", code: "think-ignored", text: "Think time is ignored at replay: the pacing alone holds the load (the iteration is all requests, then a wait)." });

    res.lre = lreText(res, sc);
    res.summary = summary(res, sc);
    return res;
  }

  /* ---------- LRE wording ---------- */
  function actionText(a, unit) {
    if (a.type === "hold") return `Duration: Run for ${hms(a.dur)}${a.label ? `  — ${a.label}` : ""}`;
    const verb = a.type === "start" ? "Start" : "Stop";
    if (a.all) return `${verb} Vusers: ${verb} ${a.count} Vusers simultaneously`;
    return `${verb} Vusers: ${verb} ${a.count} Vusers: ${a.perStep} Vuser${a.perStep === 1 ? "" : "s"} every ${hms(a.every)} (HH:MM:SS)`;
  }
  function pacingText(g) {
    const p = g.pacing;
    if (p.kind === "random") return `Start new iteration: at random intervals, every ${round(p.min, 1)} to ${round(p.max, 1)} seconds`;
    if (p.kind === "asap") return "Start new iteration: as soon as the previous iteration ends";
    if (p.kind === "after") return `Start new iteration: after the previous iteration ends, with a fixed delay of ${round(p.delay, 1)} seconds`;
    return `Start new iteration: at fixed intervals, every ${round(p.mean, 1)} seconds`;
  }
  function thinkText(g, src) {
    const m = src.thinkMode || "recorded";
    if (m === "ignore") return "Ignore think time";
    if (m === "multiply") return `Multiply recorded think time by ${src.thinkFactor || 1}`;
    if (m === "random") return `Use random percentage of recorded think time: min ${src.thinkMinPct ?? 50}%, max ${src.thinkMaxPct ?? 150}%`;
    return "Replay think time as recorded";
  }
  // "LG1, LG2 (100 Vusers each)" or "LG3 (67), LG4 (66)" — at the peak (the highest step of a stepped test)
  function lgText(lgs) {
    const same = lgs.every((x) => x.vusers === lgs[0].vusers);
    return same ? `${lgs.map((x) => x.name).join(", ")} (${lgs[0].vusers} Vuser${lgs[0].vusers === 1 ? "" : "s"}${lgs.length > 1 ? " each" : ""})` : lgs.map((x) => `${x.name} (${x.vusers})`).join(", ");
  }
  function lreText(res, sc) {
    const L = [];
    L.push(`Workload type: ${res.workloadLabel}`);
    if (res.workload === "goal") {
      const g = res.totals;
      L.push(`Goal type: Transactions per second`, `Reach goal: ${round(g.tps, 2)} transactions per second`,
        `Number of Vusers: min ${Math.max(1, Math.ceil(g.vusers * 0.5))}, max ${Math.ceil(g.vusers * 1.5)}`,
        `Run for ${hms(steadySeconds(sc))} after the target is achieved`,
        `(LRE adds Vusers until the goal is reached; the plan's ${g.vusers} Vusers is the expected count.)`);
    } else if (res.workload === "basic-group") {
      L.push("", "Every group: Start Group Immediately · Initialize each Vuser just before it runs");
      res.groupPlans.forEach((p) => {
        const script = res.groups.find((g) => g.id === p.group.scriptId).name;
        L.push("", `${script} — ${p.group.vusers} Vusers${p.group.parts > 1 ? ` (added ${p.group.parts} times: this is ${p.group.part} of ${p.group.parts})` : ""}`);
        p.actions.forEach((a) => L.push("  " + actionText(a)));
        if (p.group.lgs && p.group.lgs.length) L.push("  Load generators: " + lgText(p.group.lgs));
      });
    } else {
      L.push("", "Initialize: Initialize each Vuser just before it runs");
      res.actions.forEach((a) => L.push(actionText(a)));
      L.push("", "Vusers per group" + (res.workload === "basic-scenario" ? " (or percentage mode):" : ":"));
      (res.lreGroups || res.groups).forEach((g) => L.push(`  ${g.scriptId ? res.groups.find((x) => x.id === g.scriptId).name : g.name}: ${g.vusers} Vusers (${round(g.vusers / res.totals.vusers * 100, 1)}%)${g.lgs && g.lgs.length ? " — load generators " + lgText(g.lgs) : ""}`));
    }
    L.push("", "Runtime settings per script:");
    res.groups.forEach((g, i) => {
      const src = (res._input || {}).groups ? res._input.groups[i] : {};
      L.push(`  ${g.name}`, `    Pacing: ${pacingText(g)}`, `    Think time: ${thinkText(g, src)}`);
    });
    L.push("", "Stop: Gradually exiting — let each Vuser finish its current iteration.");
    return L.join("\n");
  }

  function summary(res, sc) {
    const t = res.totals, s = [];
    const start = res.workload === "basic-group" ? null : (res.actions || []).find((a) => a.type === "start");
    s.push(`Run ${t.vusers.toLocaleString("en-GB")} virtual users${res.peakVusers > t.vusers ? ` (up to ${res.peakVusers.toLocaleString("en-GB")} at the highest step)` : ""}${res.lgTotal != null ? ` on ${res.lgTotal} load generator${res.lgTotal === 1 ? "" : "s"}` : ""}.`);
    const starts = (res.actions || []).filter((a) => a.type === "start").length;
    if (res.workload !== "basic-group" && starts > 1) s.push(`Users are added in ${starts} steps, a few at a time, with a hold after each step (see the LRE settings).`);
    else if (start && !start.all) s.push(`Start ${start.perStep} user${start.perStep === 1 ? "" : "s"} every ${words(start.every)}; all are running after ${words((Math.ceil(start.count / start.perStep) - 1) * start.every)}.`);
    else if (res.workload === "basic-group") s.push(`Each script starts its users a few at a time; all reach full load after ${words(res.firstFull)}.`);
    s.push(`Expected throughput: ${round(t.tps, 2)} transactions per second (${Math.round(t.perHour).toLocaleString("en-GB")} per hour)${Math.abs(t.tpsMax - t.tpsMin) > 1e-6 ? `, between ${round(t.tpsMin, 2)} and ${round(t.tpsMax, 2)} because the pacing is random` : ""}${res.peakVusers > t.vusers ? ` at 100% of the target, and about ${round(t.tps * res.peakVusers / t.vusers, 2)} at the highest step` : ""}.`);
    s.push(`The whole test takes about ${words(res.duration)} and runs ${t.iters.total.toLocaleString("en-GB")} iterations — that is the number of test-data rows used if each iteration takes a new one.`);
    return s.join(" ");
  }

  function modelWithText(input) {
    const r = model(input);
    r._input = input;
    if (r.ready) r.lre = lreText(r, r.scenario);
    return r;
  }

  return { model: modelWithText, packPool, lgText, solveGroup, iterationTime, thinkTime, stepPlan, fitPlan, rampTarget, lgCapacity, ruleCapacity, pageShareOf, fillPool, capacityFromRun, itersIn,
    hms, words, PROTOCOLS, TEST_TYPES, WORKLOADS };
});
