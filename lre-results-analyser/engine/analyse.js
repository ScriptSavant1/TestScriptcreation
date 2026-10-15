/**
 * analyse.js — orchestration: one pass over an LRE results folder → a single result model.
 *
 * The file source is injected so the same code runs in Node (CLI) and in the browser (worker):
 *   source.list()                 → Promise<string[]>   every file path (relative)
 *   source.readBytes(path)        → Promise<Uint8Array>  small text files
 *   source.stream(path, onChunk)  → Promise<void>        RawData.eve in chunks
 *   source.size?(path)            → Promise<number>      optional, for progress
 *   source.sqlite?(path, sql)     → Promise<object[]>    optional; errors skipped when absent
 *
 * analyse() returns the MODEL (plain, JSON-serialisable). The heavy statistics store (samples,
 * histograms) is attached as a non-enumerable `store` property: applySettings(model, settings)
 * uses it to recompute everything that depends on the steady-state window or the SLAs without
 * re-reading the files. Nothing is guessed silently — unknowns are listed in selfCheck.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) {
    module.exports = factory(require("./files"), require("./scenario"), require("./trep"), require("./runlogic"),
      require("./rawmap"), require("./sla"), require("./collate"), require("./eve"), require("./stats"), require("./errors"),
      require("./collector"), require("./dat"), require("./insights"), require("./txnames"));
  } else {
    const L = root.LreRA;
    L.analyse = factory(L.files, L.scenario, L.trep, L.runlogic, L.rawmap, L.sla, L.collate, L.eve, L.stats, L.errors,
      L.collector, L.dat, L.insights, L.txnames);
  }
})(typeof self !== "undefined" ? self : this, function (files, scenario, trep, runlogic, rawmap, sla, collate, eve, stats, errors,
  collector, dat, insights, txnames) {
  "use strict";

  const ENGINE_VERSION = "1.1.0";

  async function readOpt(source, path) {
    return path ? source.readBytes(path) : null;
  }

  /**
   * @param {object} source  see header
   * @param {object} [opts]  { onProgress(bytes,total,stage), exactLimit, bucketSec, settings }
   */
  async function analyse(source, opts) {
    opts = opts || {};
    const progress = (done, total, stage) => { if (opts.onProgress) opts.onProgress(done, total, stage); };
    const found = files.discover(await source.list());
    const f = found.files;
    const checks = [];
    const check = (status, id, text, data) => checks.push(data === undefined ? { status, id, text } : { status, id, text, data });

    for (const name of found.requiredMissing) check("fail", "file-missing", `Required file not found: ${name}`);
    for (const m of found.missing.filter((x) => !x.required)) check("info", "file-missing", `Optional file not found: ${m.name}`);
    if (found.lrrCandidates.length > 1) check("warn", "lrr-multiple", `More than one .lrr file; used ${files.base(found.files.lrr)}`, found.lrrCandidates.map(files.base));

    // ── text files ────────────────────────────────────────────────────────
    progress(0, null, "Reading scenario files");
    const meta = scenario.parse(await readOpt(source, f.runInfo), await readOpt(source, f.lrr));
    const life = f.trep ? trep.parse(await source.readBytes(f.trep)) : null;
    const map = rawmap.parse(await readOpt(source, f.rawDataMap));
    const slaInfo = f.sla ? sla.parse(await source.readBytes(f.sla)) : null;
    const lgInfo = collate.parse(await readOpt(source, f.collate), await readOpt(source, f.remoteResults));
    const startUtc = meta.startUtc || (life && life.scenarioStart) || null;
    const durationSec = meta.durationSec || (life && life.scenarioEnd && startUtc ? life.scenarioEnd - startUtc : null);

    const scripts = await readScripts(source, found, meta, life, check);

    // ── RawData.eve ───────────────────────────────────────────────────────
    const steadyAbs = life && life.phases.steady ? life.phases.steady : null;
    const steadyRel = steadyAbs && startUtc ? { start: steadyAbs.start - startUtc, end: steadyAbs.end - startUtc } : null;
    const vuserInfo = new Map();
    if (life) for (const v of life.vusers) if (!vuserInfo.has(v.vuser)) vuserInfo.set(v.vuser, { lg: v.lg, group: v.group, script: v.script });
    const col = collector.createCollector({
      startUtc: startUtc || 0, durationSec, bucketSec: opts.bucketSec, vuserInfo, steady: steadyRel,
      exactLimit: opts.exactLimit,
    });
    let decoded = null;
    if (f.rawDataEve) {
      const dec = eve.createDecoder({
        // transaction records: response time = end − start (seconds); the collector works in ms
        onTransaction: (endTs, iter, rtSec, vuser, id, failed) => col.add(endTs, iter, rtSec * 1000, vuser, id, failed),
      });
      const total = source.size ? await source.size(f.rawDataEve) : null;
      let done = 0;
      await source.stream(f.rawDataEve, (chunk) => {
        dec.push(chunk);
        done += chunk.length;
        progress(done, total, "Decoding RawData.eve");
      });
      decoded = dec.end();
    }
    const store = col.finish();
    const bs = store.bucketSec, nb = store.buckets;

    // ── errors (SqliteDb.db) ────────────────────────────────────────────
    progress(0, null, "Reading errors");
    let errs = null;
    if (f.sqlite && source.sqlite) {
      try { errs = errors.summarise(await source.sqlite(f.sqlite, errors.QUERY), meta.localOffsetSec, startUtc); }
      catch (e) { check("warn", "errors", `Could not read SqliteDb.db: ${e.message || e}`); }
    } else if (f.sqlite) check("info", "errors", "SqliteDb.db present but no SQLite reader available — errors skipped");

    // ── sum_data graphs ──────────────────────────────────────────────────
    progress(0, null, "Reading sum_data graphs");
    const sum = await readSumData(source, found, startUtc, bs, nb, check);

    // ── model ────────────────────────────────────────────────────────────
    const scriptOfTx = new Map();
    for (const s of scripts) for (const t of s.transactions) {
      if (!scriptOfTx.has(t)) scriptOfTx.set(t, []);
      scriptOfTx.get(t).push(s.key);
    }
    const evTx = new Map(((decoded && decoded.transactions) || []).map((t) => [t.id, t]));
    // internal ids (+52) → names: matched against LRE's per-transaction graph, never looked up blindly
    const resolution = resolveNames(store, map, sum);
    const txNames = new Map(store.txIds().map((id) => [id, resolution.names.get(id) || `TX_${id}`]));
    const passFail = crossCheckSumData(sum, txNames, store, resolution, check);

    const transactions = store.txIds().map((id) => {
      const name = txNames.get(id);
      const e = evTx.get(id) || {};
      const pass = store.count(id), fail = store.failCount(id);
      return {
        id, name, inMap: resolution.names.has(id), scripts: scriptOfTx.get(name) || [],
        inSla: slaInfo ? slaInfo.transactions.includes(name) : null,
        full: Object.assign(store.summary(id, null), { tps: durationSec ? store.count(id) / durationSec : null }),
        steady: null, // filled by applySettings
        pass, fail, failPct: pass + fail ? (fail / (pass + fail)) * 100 : null,
        sumDataPass: (passFail.get(id) || {}).pass != null ? passFail.get(id).pass : null,
        perLg: store.perLg(id),
        distribution: store.distribution(id, 60),
        negativeRtClamped: e.negativeRt || 0,
        vuserIterations: e.vuserIterations || 0, maxPerVuserIteration: e.maxPerVuserIteration || 0,
        firstRelSec: e.tsMin != null && startUtc ? e.tsMin - startUtc : null, lastRelSec: e.tsMax != null && startUtc ? e.tsMax - startUtc : null,
        recordTypes: e.bySubType || {},
      };
    });

    const tl = store.timeline();
    const timeline = {
      bucketSec: bs, buckets: nb, startUtc,
      tx: tl.tx,
      vusers: life && startUtc ? runningPerBucket(life.vusers, startUtc, bs, nb) : null,
      totalTps: new Array(nb).fill(0).map((_, b) => { let n = 0; for (const id in tl.tx) n += tl.tx[id].count[b]; return n / bs; }),
      errors: errs ? errorsPerBucket(errs.rows, bs, nb) : null,
      graphs: sum ? sum.series : [],
    };

    const vuserStats = new Map(store.vuserList().map((v) => [v.vuser, v]));
    const vusers = life ? life.vusers.map((v) => {
      const st = vuserStats.get(v.vuser) || {};
      return {
        group: v.group, vuser: v.vuser, script: v.script, lg: v.lg,
        runRelSec: v.runTs != null && startUtc ? v.runTs - startUtc : null, exitRelSec: v.exitTs != null && startUtc ? v.exitTs - startUtc : null,
        samples: st.samples || 0, iterations: st.iterations || 0, avgRt: st.avgRt != null ? st.avgRt : null,
        firstRelSec: st.firstRelSec != null ? st.firstRelSec : null, lastRelSec: st.lastRelSec != null ? st.lastRelSec : null,
      };
    }) : store.vuserList();

    // iterations planned vs achieved per script
    for (const s of scripts) {
      const vs = vusers.filter((v) => v.script && String(v.script).toLowerCase() === String(s.key).toLowerCase());
      s.iterationsAchieved = vs.reduce((a, v) => a + (v.iterations || 0), 0);
      const pace = s.pacing && (s.pacing.kind === "fixedInterval" ? s.pacing.seconds : s.pacing.kind === "randomInterval" ? (s.pacing.min + s.pacing.max) / 2 : null);
      s.iterationsExpected = pace ? vs.reduce((a, v) => a + (v.runRelSec != null && v.exitRelSec != null ? Math.floor((v.exitRelSec - v.runRelSec) / pace) + 1 : 0), 0) : null;
      s.samples = transactions.filter((t) => t.scripts.includes(s.key)).reduce((a, t) => a + t.full.count, 0);
    }

    const lgs = buildLgs(life, lgInfo, sum, scripts);

    const model = {
      engineVersion: ENGINE_VERSION,
      generatedAt: new Date().toISOString(),
      method: {
        percentile: store.method === "exact" ? "nearest-rank on every sample (exact)" : "nearest-rank on log histograms (≤ 0.5 % relative error)",
        percentileMethod: store.method,
        stdDev: "population (÷ n)",
        responseTimeUnit: "seconds — end minus start timestamp of each transaction record",
        transactionSource: `RawData.eve transaction records (sub-types ${eve.TX_FAMILY.join(", ")}); failed = ${eve.FAILED_SUBTYPES.join(", ")}; response-time statistics use passed transactions, as LRE does`,
        transactionNames: resolution.method,
        steadyState: "last VUser running → first VUser exit (from _t_rep.eve); can be adjusted",
        sampleTime: "transaction end time (unix s)",
        negativeResponseTimes: "clamped to 0 and counted",
        tps: "count ÷ window length in seconds",
        bucketSec: bs,
        exactLimit: store.exactLimit,
        totalSamples: store.totalSamples,
        passFail: "RawData.eve (failed-transaction records)" + (passFail.source ? "; " + passFail.source : ""),
      },
      files: { root: found.root, used: f, cfgs: found.cfgs, usps: found.usps, usrs: found.usrs, sumDataGraphs: found.graphs.length },
      meta,
      lifecycle: life && {
        vusers: life.vusers.length, maxRunning: life.maxRunning, groups: life.groups,
        loadGenerators: life.loadGenerators, vuserIdScope: life.vuserIdScope,
        neverRan: life.neverRan, neverExited: life.neverExited, unknownEvents: life.unknown,
      },
      phases: life && relPhases(life.phases, startUtc),
      loadGenerators: lgInfo,
      lgs,
      lgHealth: sum ? sum.lgHealth : [],
      sla: slaInfo,
      workload: scripts,
      transactions,
      totals: null,
      timeline,
      vusers,
      vuserHeat: store.vuserHeat(240),
      latencyHeat: store.latencyHeat(store.txIds().filter((id) => !isWrapper(txNames.get(id), transactions)), 240, 40),
      errors: errs && { total: errs.total, summary: errs.summary, rows: errs.rows.slice(0, 20000), rowsTruncated: errs.rows.length > 20000 },
      sumData: sum ? { graphs: sum.graphs } : null,
      txNameResolution: { method: resolution.method, assumed: !!resolution.assumed, unresolved: resolution.unresolved, matches: resolution.matches },
      dataPoints: decoded ? decoded.dataPoints.map((d) => ({ id: d.id, name: map.dataPoints.get(d.id) || `id ${d.id}`, count: d.count, sum: d.sum })) : [],
      eve: decoded && {
        bytesRead: decoded.bytesRead, records: decoded.records, trailingBytes: decoded.trailingBytes, stopped: decoded.stopped,
        subTypes: decoded.subTypes, signatures: decoded.signatures, tx: decoded.tx, lookalikes: decoded.lookalikes,
      },
      selfCheck: checks,
      settings: null, window: null, insights: null,
    };
    Object.defineProperty(model, "store", { value: store, enumerable: false, writable: true });

    selfChecks(check, { meta, life, map, slaInfo, decoded, transactions, scripts, steadyRel, store, resolution });
    applySettings(model, opts.settings || {});
    return model;
  }

  /** A transaction that wraps all others (e.g. Main_Transaction / the action) — excluded from the latency heatmap. */
  function isWrapper(name, transactions) {
    return /^(main_transaction|action_transaction|vuser_(init|end)_transaction)$/i.test(name || "") ||
      (transactions && transactions.find((t) => t.name === name && !t.inMap && /main/i.test(name || "")) != null);
  }

  /**
   * Recompute window- and SLA-dependent parts of the model in place.
   * settings: { window: {start, end} (relative s) | null → detected steady state,
   *             sla: { percentile: 90, defaultSec: null, perTx: { name: seconds } } }
   */
  function applySettings(model, settings) {
    const store = model.store;
    settings = Object.assign({}, model.settings || {}, settings || {});
    const detected = model.phases && model.phases.steady ? { start: model.phases.steady.startRelSec, end: model.phases.steady.endRelSec } : null;
    const win = settings.window && settings.window.end > settings.window.start ? settings.window : detected;
    const winSec = win ? win.end - win.start : null;
    const slaS = Object.assign({ percentile: 90, defaultSec: null, perTx: {} }, settings.sla || {});
    // the default threshold applies to named transactions only (not to wrappers missing from RawData.map)
    const anyNamed = model.transactions.some((t) => t.inMap);
    for (const t of model.transactions) {
      t.steady = store && win ? store.summary(t.id, win) : { count: 0, min: null, avg: null, max: null, stdDev: null, p: {} };
      t.steady.tps = winSec ? t.steady.count / winSec : null;
      t.steady.fail = store && win ? store.failCount(t.id, win) : null;
      const useDefault = slaS.defaultSec != null && slaS.defaultSec !== "" && (t.inMap || !anyNamed);
      const thr = slaS.perTx[t.name] != null && slaS.perTx[t.name] !== "" ? Number(slaS.perTx[t.name]) : useDefault ? Number(slaS.defaultSec) : null;
      if (thr != null && Number.isFinite(thr) && t.steady.count) {
        const value = t.steady.p["p" + slaS.percentile];
        const a = store ? store.apdexCounts(t.id, thr * 1000, win) : null;
        t.sla = { threshold: thr, percentile: slaS.percentile, value, pass: value != null ? value <= thr : null,
                  apdex: a && a.n ? (a.satisfied + a.tolerating / 2) / a.n : null };
      } else t.sla = null;
    }
    const full = model.transactions.reduce((a, t) => a + t.full.count, 0);
    const steadyCount = model.transactions.reduce((a, t) => a + t.steady.count, 0);
    const dur = model.meta.durationSec;
    model.totals = {
      samples: full, samplesSteady: steadyCount,
      tpsFull: dur ? full / dur : null, tpsSteady: winSec ? steadyCount / winSec : null,
      transactionsDefined: model.transactions.length,
      errors: model.errors ? model.errors.total : null,
      pass: model.transactions.some((t) => t.pass != null) ? model.transactions.reduce((a, t) => a + (t.pass || 0), 0) : null,
      fail: model.transactions.some((t) => t.fail != null) ? model.transactions.reduce((a, t) => a + (t.fail || 0), 0) : null,
      peakVusers: model.lifecycle ? model.lifecycle.maxRunning : null,
      hitsPerSec: graphStat(model, "hits"), throughputBytesPerSec: graphStat(model, "bytesReceived"),
    };
    model.window = win ? { start: win.start, end: win.end, durationSec: winSec, detected: !settings.window || !(settings.window.end > settings.window.start) } : null;
    model.settings = { window: settings.window || null, sla: slaS };
    model.insights = insights.run(model);
    return model;
  }

  function graphStat(model, role) {
    const g = (model.timeline.graphs || []).find((x) => x.role === role);
    if (!g) return null;
    const vals = [];
    for (const m of g.measurements) m.avg.forEach((v, i) => { if (v != null) vals[i] = (vals[i] || 0) + v; });
    const v = vals.filter((x) => x != null);
    return v.length ? { avg: v.reduce((a, c) => a + c, 0) / v.length, peak: Math.max(...v) } : null;
  }

  async function readScripts(source, found, meta, life, check) {
    const byStem = (list) => new Map(list.map((p) => [files.stem(p), p]));
    const cfgs = byStem(found.cfgs), usps = byStem(found.usps), usrs = byStem(found.usrs);
    const scripts = [];
    const groups = meta.groups.length ? meta.groups : [...usrs.keys()].map((k) => ({ group: k, scriptName: k, protocol: "" }));
    for (const g of groups) {
      const k = String(g.group).toLowerCase(), k2 = String(g.scriptName).toLowerCase();
      const usp = usps.get(k) || usps.get(k2), cfg = cfgs.get(k) || cfgs.get(k2), usr = usrs.get(k) || usrs.get(k2);
      const info = usr ? runlogic.scriptInfo(await source.readBytes(usr)) : { type: null, language: null, transactions: [] };
      const vusers = life ? life.vusers.filter((v) => String(v.script).toLowerCase() === k) : [];
      const perLg = {};
      for (const v of vusers) perLg[v.lg || "(unknown)"] = (perLg[v.lg || "(unknown)"] || 0) + 1;
      scripts.push({
        key: g.group, scriptName: g.scriptName, protocol: g.protocol || info.type, language: info.language,
        pacing: usp ? runlogic.pacing(await source.readBytes(usp)) : null,
        thinkTime: cfg ? runlogic.thinkTime(await source.readBytes(cfg)) : null,
        transactions: info.transactions,
        vusers: vusers.length,
        groups: [...new Set(vusers.map((v) => v.group))],
        loadGenerators: Object.entries(perLg).map(([name, n]) => ({ name, vusers: n })),
        files: { usp: usp && files.base(usp), cfg: cfg && files.base(cfg), usr: usr && files.base(usr) },
      });
      if (!usp) check("warn", "script-files", `No .usp (pacing) found for script ${g.group}`);
      if (!cfg) check("warn", "script-files", `No .cfg (run-time settings) found for script ${g.group}`);
      if (!usr) check("info", "script-files", `No .usr found for script ${g.group} — transactions cannot be grouped by script`);
    }
    return scripts;
  }

  async function readSumData(source, found, startUtc, bs, nb, check) {
    if (!found.files.sumDatIni || !startUtc) return null;
    let info;
    try { info = dat.parseIni(await source.readBytes(found.files.sumDatIni)); }
    catch (e) { check("warn", "sum-data", `Could not read sum_dat.ini: ${e.message || e}`); return null; }
    const wanted = new Set(["lgHealth", "txPass", "txFail", "txResponse", "httpCodes", "bytesReceived", "bytesSent", "connections", "connectionsPerSec", "hits", "throughput", "errors", "vuserErrors"]);
    const byN = new Map(found.graphs.map((p) => [parseInt(/graph_(\d+)\.dat$/i.exec(p)[1], 10), p]));
    const series = [];
    for (const g of info.graphs) {
      if (!g.role || !wanted.has(g.role) || !byN.has(g.n)) continue;
      let parsed;
      try { parsed = dat.parseGraph(await source.readBytes(byN.get(g.n)), startUtc, bs, nb); }
      catch (e) { check("warn", "sum-data", `Could not read graph_${g.n}.dat: ${e.message || e}`); continue; }
      const names = new Map(g.measurements.filter((m) => m.id != null).map((m) => [m.id, m.name || `id ${m.id}`]));
      const byIdx = g.measurements.filter((m) => m.id == null).map((m) => m.name);
      let k = 0;
      const ms = [...parsed.values()].sort((a, b) => a.id - b.id).map((m) => ({
        id: m.id, name: names.get(m.id) || byIdx[k++] || `id ${m.id}`, rows: m.rows, cumulativeRows: m.cumulativeRows, step: m.step,
        sumAvg: m.sumAvg, sumAvgCount: m.sumAvgCount, sumCount: m.sumCount, weightedMean: m.weightedMean, maxCol: m.maxCol,
        mean: m.mean, max: m.max, avg: m.avg, maxSeries: m.maxSeries,
      }));
      series.push({ n: g.n, type: g.type, role: g.role, measurements: ms });
    }
    // LG health
    const hosts = new Map();
    for (const s of series.filter((x) => x.role === "lgHealth")) for (const m of s.measurements) {
      const { host, ip, metric } = dat.splitLgName(m.name);
      if (!host) continue;
      const h = hosts.get(host) || { host, ip, cpu: null, memory: null, disk: null };
      const key = /cpu/i.test(metric) ? "cpu" : /mem/i.test(metric) ? "memory" : /disk/i.test(metric) ? "disk" : null;
      if (key) h[key] = { mean: m.mean, max: m.max, series: m.avg, metric };
      if (ip && !h.ip) h.ip = ip;
      hosts.set(host, h);
    }
    if (!series.length) check("info", "sum-data", "sum_data present but no graphs of a known type were found", info.graphs.map((g) => `${g.n}:${g.type}`));
    return { graphs: info.graphs.map((g) => ({ n: g.n, type: g.type, role: g.role, measurements: g.measurements.length })), series, lgHealth: [...hosts.values()] };
  }

  /** Internal transaction ids → names (txnames.js), using LRE's per-transaction response-time graph. */
  function resolveNames(store, map, sum) {
    const ids = store.txIds().map((id) => {
      const s = store.summary(id, null);
      return { id, count: s.count, mean: s.avg, max: s.max };
    });
    let graph = [];
    const g = sum && sum.series.find((x) => x.role === "txResponse");
    if (g) graph = g.measurements.filter((m) => m.sumCount > 0 && m.name && !/^id \d+$/.test(m.name))
      .map((m) => ({ name: m.name.replace(/^.*:/, ""), count: m.sumCount, mean: m.weightedMean, max: m.maxCol }));
    return txnames.resolve({ ids, graph, mapNames: map.transactions });
  }

  /**
   * Cross-check against LRE's own sum_data counts: pass graph (tprange_pass) totals per name and
   * failed transactions (tprange_fail). Counts are reported as-is; the graph values are rates, so
   * the conversion that reproduces the RawData.eve pass counts best is used and its error shown.
   */
  function crossCheckSumData(sum, txNames, store, resolution, check) {
    const out = new Map();
    out.source = null;
    if (!sum) return out;
    const passG = sum.series.find((s) => s.role === "txPass");
    const failG = sum.series.find((s) => s.role === "txFail");
    const byName = new Map([...txNames.entries()].filter(([id]) => resolution.names.has(id)).map(([id, n]) => [n.toLowerCase(), id]));
    const idOf = (mName) => {
      const n = String(mName || "").toLowerCase();
      return byName.get(n) != null ? byName.get(n) : byName.get(n.replace(/^.*:/, ""));
    };
    if (passG && byName.size) {
      const formulas = { "Σ avg×count": (m) => m.sumAvgCount, "Σ avg": (m) => m.sumAvg, "Σ avg×interval": (m) => m.sumAvg * (m.step || 1) };
      let best = null;
      for (const [fname, fn] of Object.entries(formulas)) {
        let err = 0, tot = 0, n = 0;
        for (const m of passG.measurements) { const id = idOf(m.name); if (id == null) continue; const c = store.count(id); err += Math.abs(fn(m) - c); tot += c; n++; }
        if (n && tot && (!best || err / tot < best.err)) best = { fname, fn, err: err / tot, n };
      }
      if (best) {
        for (const m of passG.measurements) { const id = idOf(m.name); if (id != null) out.set(id, { pass: Math.round(best.fn(m)) }); }
        out.source = `sum_data pass graph agrees within ${(best.err * 100).toFixed(2)} % ("${best.fname}")`;
        check(best.err <= 0.02 ? "ok" : "warn", "sumdata-pass", `Pass counts vs LRE's pass graph: ${(best.err * 100).toFixed(2)} % apart (${best.n} transactions)`);
      }
    }
    if (failG) {
      const lreFails = {};
      for (const m of failG.measurements) lreFails[m.name] = Math.round(m.sumAvgCount);
      const ours = {};
      for (const [id, n] of txNames) { const f = store.failCount(id); if (f) ours[n] = f; }
      const same = Object.keys(lreFails).every((k) => (ours[k.replace(/^.*:/, "")] || 0) === lreFails[k]) && Object.keys(ours).every((k) => Object.keys(lreFails).some((l) => l.replace(/^.*:/, "") === k));
      check(same ? "ok" : "warn", "sumdata-fail", `Failed transactions — RawData.eve ${JSON.stringify(ours)} vs LRE's fail graph ${JSON.stringify(lreFails)}`);
    }
    return out;
  }

  /** Max running VUsers within each bucket. */
  function runningPerBucket(list, startUtc, bs, nb) {
    const ev = [];
    for (const v of list) {
      if (v.runTs == null) continue;
      ev.push([v.runTs - startUtc, 1]);
      ev.push([v.exitTs != null ? v.exitTs - startUtc : Infinity, -1]);
    }
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const out = new Array(nb).fill(0);
    let cur = 0, i = 0;
    for (let b = 0; b < nb; b++) {
      const end = (b + 1) * bs;
      let mx = cur;
      while (i < ev.length && ev[i][0] < end) { cur += ev[i][1]; if (cur > mx) mx = cur; i++; }
      out[b] = mx;
    }
    return out;
  }

  function errorsPerBucket(rows, bs, nb) {
    const out = new Array(nb).fill(0);
    for (const r of rows) if (r.relSec != null) { const b = Math.floor(r.relSec / bs); if (b >= 0 && b < nb) out[b]++; }
    return out;
  }

  function buildLgs(life, lgInfo, sum, scripts) {
    const m = new Map();
    const get = (name) => { if (!m.has(name)) m.set(name, { name, ip: null, vusers: 0, scripts: [], role: "load generator", cpuPeak: null, memPeak: null }); return m.get(name); };
    if (life) for (const l of life.loadGenerators) get(l.name).vusers = l.vusers;
    for (const h of lgInfo.hosts) get(h);
    for (const s of scripts) for (const l of s.loadGenerators) if (m.has(l.name)) m.get(l.name).scripts.push(`${s.key} (${l.vusers})`);
    if (sum) for (const h of sum.lgHealth) {
      const key = [...m.keys()].find((k) => k.toLowerCase() === h.host.toLowerCase() || k.toLowerCase().startsWith(h.host.toLowerCase() + ".")) || h.host;
      const e = get(key);
      e.ip = h.ip; e.cpuPeak = h.cpu ? h.cpu.max : null; e.memPeak = h.memory ? h.memory.max : null;
    }
    for (const e of m.values()) if (!e.vusers && life) e.role = "monitored host with no VUsers (probably the Controller)";
    return [...m.values()];
  }

  function relPhases(p, start) {
    const rel = (t) => (t != null && start ? t - start : null);
    return {
      scenarioStartUtc: p.scenarioStart, scenarioEndUtc: p.scenarioEnd,
      rampUpEndRelSec: rel(p.rampUpEnd),
      steady: p.steady && { startRelSec: rel(p.steady.start), endRelSec: rel(p.steady.end), durationSec: p.steady.durationSec,
                            startUtc: p.steady.start, endUtc: p.steady.end },
      rampDownStartRelSec: rel(p.rampDownStart), lastExitRelSec: rel(p.lastExit), scenarioEndRelSec: rel(p.scenarioEnd),
    };
  }

  function selfChecks(check, c) {
    const { meta, life, map, slaInfo, decoded, transactions, scripts, steadyRel, store } = c;

    check(meta.localOffsetConfirmed ? "ok" : "warn", "timezone",
      `Local time = UTC ${meta.localOffsetSec >= 0 ? "+" : "-"}${Math.abs(meta.localOffsetSec / 3600)} h (${meta.localOffsetSource})`);
    if (meta.schedule.unparsed.length) check("warn", "schedule", "Schedule tokens not understood (shown raw)", meta.schedule.unparsed);

    if (life) {
      const planned = meta.schedule.steps.filter((s) => s.kind === "start").reduce((a, s) => a + s.vusers, 0);
      if (planned) check(planned === life.vusers.length ? "ok" : "warn", "vusers",
        `Schedule starts ${planned} VUsers; _t_rep.eve shows ${life.vusers.length} (max running together: ${life.maxRunning})`);
      check(steadyRel ? "ok" : "warn", "steady-state", steadyRel
        ? `Steady state ${life.phases.steady.durationSec} s (last VUser running → first VUser exit)`
        : "No steady-state window (VUsers never all running together)");
      if (Object.keys(life.unknown).length) check("info", "trep-events", "_t_rep.eve events not used", life.unknown);
      check("info", "vuser-id-scope", `VUser numbers in _t_rep.eve: ${life.vuserIdScope}`);
      if (life.neverExited.length) check("info", "vusers", `${life.neverExited.length} VUser(s) have no exit event`);
    }
    check("info", "method", `Percentiles: ${store.method === "exact" ? "exact (every sample kept)" : `histogram (more than ${store.exactLimit} samples)`}; time bucket ${store.bucketSec} s`);

    if (!decoded) return;
    if (decoded.stopped) check("fail", "eve-sync", `Decoding stopped at byte ${decoded.stopped.offset}: ${decoded.stopped.reason} (recLen=${decoded.stopped.recLen})`);
    else check(decoded.trailingBytes ? "warn" : "ok", "eve-sync",
      `${decoded.records} records read, ${decoded.bytesRead} bytes` + (decoded.trailingBytes ? `; ${decoded.trailingBytes} bytes of an incomplete last record` : "; file ends on a record boundary"));

    const t = decoded.tx;
    check(t.records ? "ok" : "fail", "eve-tx", t.records
      ? `${t.records} transaction records (${t.records - t.failed} passed, ${t.failed} failed) — by sub-type ${JSON.stringify(t.bySubType)}`
      : `No transaction records (sub-types ${eve.TX_FAMILY.join(", ")}) found — the layout may differ in this LRE version; see the record types in the Validation tab`);
    if (Object.keys(t.implausible).length) check("warn", "eve-tx-layout", "Transaction records skipped: timestamps, duration or VUser out of range — layout may differ for these sub-types", t.implausible);
    else if (t.records) check("ok", "eve-tx-layout", "Every transaction record has plausible start/end times and VUser");
    if (Object.keys(decoded.lookalikes).length) check("info", "eve-lookalikes", "Other sub-types that also carry two timestamps at +28/+36 (not counted as transactions)", decoded.lookalikes);
    if (t.f44Checked) check("info", "eve-f44", `Field +44 equals round(response time in ms) in ${((t.f44Agrees / t.f44Checked) * 100).toFixed(1)} % of records (not used for response time)`);
    if (decoded.dataPoints.length) check("info", "eve-datapoints", `${decoded.dataPoints.reduce((a, d) => a + d.count, 0)} data-point records (sub-type ${eve.DATA_POINT_SUBTYPE}) — counted per data point, not as transactions`,
      Object.fromEntries(decoded.dataPoints.map((d) => [map.dataPoints.get(d.id) || "id " + d.id, d.count])));
    if (!t.records) return;

    // transaction names
    const res = c.resolution;
    if (res.unresolved.length) check(res.names.size ? "warn" : "fail", "tx-names",
      `${res.unresolved.length} transaction id(s) could not be named (${res.method}) — shown as TX_<id>`, res.unresolved.slice(0, 50));
    else check(res.assumed ? "warn" : "ok", "tx-names", `All ${res.names.size} transaction ids named — ${res.method}`);
    const mapNames = [...map.transactions.values()];
    const named = new Set(transactions.filter((x) => x.inMap).map((x) => x.name));
    const missing = mapNames.filter((n) => !named.has(n));
    if (res.names.size && missing.length) check("warn", "tx-names", "Transactions in RawData.map with no records", missing);

    const multi = transactions.filter((x) => x.maxPerVuserIteration > 1).map((x) => `${x.name} (max ${x.maxPerVuserIteration})`);
    check(multi.length ? "info" : "ok", "tx-per-iteration", multi.length
      ? "Some transactions occur more than once in the same VUser iteration" : `Every transaction occurs at most once per VUser iteration (${t.vuserIterations} VUser-iterations seen)`, multi.length ? multi : undefined);
    if (t.pairsTruncated) check("info", "tx-per-iteration", "Too many VUser-iterations to track — check partial");

    if (life) {
      const trepIds = new Set(life.vusers.map((v) => v.vuser));
      const extra = t.vuserIds.filter((id) => !trepIds.has(id));
      check(extra.length ? "warn" : "ok", "eve-vusers", extra.length
        ? `${extra.length} VUser ID(s) in RawData.eve not in _t_rep.eve` : `All ${t.vuserIds.length} VUser IDs in RawData.eve match _t_rep.eve`, extra.length ? extra.slice(0, 50) : undefined);
    }
    if (t.negativeRt) check("info", "negative-rt", `${t.negativeRt} negative response times clamped to 0 (clock skew)`);
    if (meta.startUtc && meta.stopUtc) {
      const inside = t.tsMin >= meta.startUtc - 60 && t.tsMax <= meta.stopUtc + 60;
      check(inside ? "ok" : "warn", "eve-time", `Transaction end times t+${(t.tsMin - meta.startUtc).toFixed(1)} s … t+${(t.tsMax - meta.startUtc).toFixed(1)} s` + (inside ? " (inside the run)" : " — outside the run start/stop"));
    }
    if (scripts.length > 1) {
      const unassigned = transactions.filter((x) => !x.scripts.length).map((x) => x.name);
      if (unassigned.length) check("info", "tx-script", "Transactions not listed in any .usr", unassigned);
    }
  }

  /** Mask printable-ASCII runs (≥ 4 chars, e.g. host names in monitoring records) in a hex example. */
  function maskHex(h) {
    const bytes = h.split(/\s+/).join("").match(/../g) || [];
    let i = 0;
    while (i < bytes.length) {
      let j = i;
      while (j < bytes.length && parseInt(bytes[j], 16) >= 0x20 && parseInt(bytes[j], 16) <= 0x7e) j++;
      if (j - i >= 4) for (let k = i; k < j; k++) bytes[k] = "2a";
      i = j === i ? i + 1 : j;
    }
    return bytes.join("").replace(/(.{8})/g, "$1 ").trim();
  }

  /**
   * Output safe to share outside the client: host names → LG1, LG2…; script paths, error message
   * text and text inside binary examples removed. Numbers are kept.
   */
  function redact(result) {
    result = JSON.parse(JSON.stringify(result));
    for (const g of (result.meta && result.meta.groups) || []) g.scriptPath = "(redacted)";
    if (result.errors) {
      for (const g of result.errors.summary) {
        g.example = "(redacted — see pattern)";
        g.pattern = g.pattern.replace(/\b[a-z0-9-]+(\.[a-z0-9-]+){2,}\b/gi, "<host>").replace(/https?:\/\/\S+/gi, "<url>");
      }
      result.errors.rows = [];
    }
    if (result.eve) for (const s of result.eve.signatures) s.examples = s.examples.map(maskHex);
    const hosts = new Set();
    for (const h of (result.loadGenerators && result.loadGenerators.hosts) || []) hosts.add(h);
    for (const l of (result.lifecycle && result.lifecycle.loadGenerators) || []) hosts.add(l.name);
    for (const l of result.lgs || []) hosts.add(l.name);
    for (const l of result.lgHealth || []) hosts.add(l.host);
    for (const g of (result.errors && result.errors.summary) || []) for (const i of g.injectors) hosts.add(i);
    let json = JSON.stringify(result);
    const sorted = [...hosts].filter(Boolean).sort((a, b) => b.length - a.length);
    const alias = new Map();
    sorted.forEach((h) => { const s = h.split(".")[0].toLowerCase(); if (!alias.has(s)) alias.set(s, "LG" + (alias.size + 1)); });
    sorted.forEach((h) => { json = json.split(h).join(alias.get(h.split(".")[0].toLowerCase())); });
    for (const [s, a] of alias) if (s.length > 3) json = json.replace(new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), a);
    json = json.replace(/\b\d{1,3}(\.\d{1,3}){3}\b/g, "x.x.x.x"); // IP addresses
    return JSON.parse(json);
  }

  return { analyse, applySettings, redact, ENGINE_VERSION };
});
