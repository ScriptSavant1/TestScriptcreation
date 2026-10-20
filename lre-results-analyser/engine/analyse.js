/**
 * analyse.js — orchestration: one pass over an LRE results folder → a single result model.
 *
 * The file source is injected so the same code runs in Node (CLI) and in the browser (worker):
 *   source.list()                → Promise<string[]>    every file path (relative)
 *   source.readBytes(path)       → Promise<Uint8Array>  small text files
 *   source.stream(path, onChunk) → Promise<void>        RawData.eve in chunks
 *   source.size?(path)           → Promise<number>      optional, for progress
 *   source.sqlite?(path, sql)    → Promise<object[]>    optional; errors skipped when absent
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
      require("./collector"), require("./dat"), require("./insights"));
  } else {
    const L = root.LreRA;
    L.analyse = factory(L.files, L.scenario, L.trep, L.runlogic, L.rawmap, L.sla, L.collate, L.eve, L.stats, L.errors,
      L.collector, L.dat, L.insights);
  }
})(typeof self !== "undefined" ? self : this, function (files, scenario, trep, runlogic, rawmap, sla, collate, eve, stats, errors,
  collector, dat, insights) {
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
    if (found.lrrCandidates.length > 1) check("warn", "lrr-multiple", `More than one .lrr file: used ${files.base(found.files.lrr)}`, found.lrrCandidates.map(files.base));

    // ── text files ──────────────────────────────────────────────────────────
    progress(0, null, "Reading scenario files");
    const meta = scenario.parse(await readOpt(source, f.runInfo), await readOpt(source, f.lrr));
    const life = f.trep ? trep.parse(await source.readBytes(f.trep)) : null;
    const map = rawmap.parse(await readOpt(source, f.rawDataMap));
    const slaInfo = f.sla ? sla.parse(await source.readBytes(f.sla)) : null;
    const lgInfo = collate.parse(await readOpt(source, f.collate), await readOpt(source, f.remoteResults));
    const startUtc = meta.startUtc || (life && life.scenarioStart) || null;
    const durationSec = meta.durationSec || (life && life.scenarioEnd && startUtc ? life.scenarioEnd - startUtc : null);

    const scripts = await readScripts(source, found, meta, life, check);

    // ── RawData.eve ─────────────────────────────────────────────────────────
    const steadyAbs = life && life.phases.steady ? life.phases.steady : null;
    const steadyRel = steadyAbs && startUtc ? { start: steadyAbs.start - startUtc, end: steadyAbs.end - startUtc } : null;
    // ── script of every VUser → statistics per script × transaction ─────────
    // A transaction used by several scripts (e.g. Login/Logout) gets one row per script, as LRE's
    // per-group figures do (Event_meter grouped by Group Name + Event Name). Rows are keyed by a
    // sequential row id; row → {txId (RawData.map id), script}.
    const scriptKeyOf = scriptResolver(scripts);
    const trepScript = new Map();
    if (life) for (const v of life.vusers) trepScript.set(`${String(v.group).toLowerCase()}|${v.vuser}`, v.script);
    const vuserInfo = new Map();
    if (life) for (const v of life.vusers) if (!vuserInfo.has(v.vuser)) vuserInfo.set(v.vuser, { lg: v.lg, group: v.group, script: v.script, scriptKey: scriptKeyOf(v.script) });
    const rows = new Map(), rowOf = new Map();
    const rowId = (vuser, txId) => {
      const info = vuserInfo.get(vuser);
      const script = (info && info.scriptKey) || scriptKeyOf(null);
      const k = script + "\u0000" + txId;
      let r = rowOf.get(k);
      if (r === undefined) { r = rows.size + 1; rowOf.set(k, r); rows.set(r, { txId, script }); }
      return r;
    };
    const col = collector.createCollector({
      startUtc: startUtc || 0, durationSec, bucketSec: opts.bucketSec, vuserInfo, steady: steadyRel,
      exactLimit: opts.exactLimit, aggregationSec: opts.aggregationSec,
    });
    let decoded = null;
    const web = webCollector(map, startUtc || 0, col.bucketSec);
    if (f.rawDataEve) {
      const lgNames = life ? life.loadGenerators.map((l) => l.name) : [];
      const fullLg = (host) => lgNames.find((n) => n.toLowerCase() === String(host).toLowerCase() || n.toLowerCase().startsWith(String(host).toLowerCase() + ".")) || host;
      const dec = eve.createDecoder({
        // VUser descriptors carry the id space every RawData.eve record uses (the numbers in
        // _t_rep.eve can be per group): they decide the load generator / group of each instance
        // the group-local number + group name find the VUser's script in _t_rep.eve
        onVuser: (v) => {
          const script = trepScript.get(`${String(v.group).toLowerCase()}|${parseInt(v.local, 10)}`) || v.script;
          vuserInfo.set(v.vuser, { lg: fullLg(v.host), group: v.group, script, local: v.local, scriptKey: scriptKeyOf(script) });
        },
        // transaction records: id = RawData.map [END_TRANSACTION] id; response time = end - start -
        // wasted - think (seconds, as LRE reports it); the collector works in ms, keyed by row
        onTransaction: (endTs, iter, rtSec, vuser, id, failed) => col.add(endTs, iter, rtSec * 1000, vuser, rowId(vuser, id), failed),
        onDataPoint: web.add,
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

    // ── errors (SqliteDb.db) ────────────────────────────────────────────────
    progress(0, null, "Reading errors");
    let errs = null;
    if (f.sqlite && source.sqlite) {
      try {
        errs = errors.summarise(await source.sqlite(f.sqlite, errors.QUERY), meta.localOffsetSec, startUtc);
        const other = Object.values(errs.otherByType).reduce((a, c) => a + c, 0);
        check("info", "errors", `${errs.total} error(s) counted — ${errs.typeFilter}` + (other ? `; ${other} other message(s) by Type ${JSON.stringify(errs.otherByType)} not counted` : ""));
      }
      catch (e) { check("warn", "errors", `Could not read SqliteDb.db: ${e.message || e}`); }
    } else if (f.sqlite) check("info", "errors", "SqliteDb.db present but no SQLite reader available — errors skipped");

    // ── sum_data graphs ─────────────────────────────────────────────────────
    progress(0, null, "Reading sum_data graphs");
    const sum = await readSumData(source, found, startUtc, bs, nb, check);

    // ── model ───────────────────────────────────────────────────────────────
    const evTx = new Map(((decoded && decoded.transactions) || []).map((t) => [t.id, t]));
    // ids are already RawData.map [END_TRANSACTION] ids: the decoder resolves each record's
    // per-VUser internal id through the registration records in RawData.eve itself.
    const txIds = [...new Set([...rows.values()].map((r) => r.txId))].sort((a, b) => a - b);
    const resolution = resolveNames(txIds, map, decoded);
    const txNames = new Map(txIds.map((id) => [id, resolution.names.get(id) || `TX_${id}`]));
    const rowsOfTx = new Map(txIds.map((id) => [id, store.txIds().filter((r) => rows.get(r).txId === id)]));
    const passFail = crossCheckSumData(sum, txNames, rowsOfTx, store, resolution, check);
    const webStats = web.finish(durationSec, store.buckets);

    // one row per script × transaction (store ids are row ids)
    const transactions = store.txIds().map((id) => {
      const row = rows.get(id);
      const name = txNames.get(row.txId);
      const e = evTx.get(row.txId) || {};
      const pass = store.count(id), fail = store.failCount(id);
      return {
        id, txId: row.txId, name, script: row.script,
        // a transaction run by several scripts is labelled with its script in charts and findings
        label: rowsOfTx.get(row.txId).length > 1 ? `${name} (${row.script})` : name,
        inMap: resolution.names.has(row.txId), scripts: [row.script],
        inSla: slaInfo ? slaInfo.transactions.includes(name) : null,
        // exact figures over every instance; `full` is this or the aggregated view (applySettings)
        fullExact: Object.assign(store.summary(id, null), { tps: durationSec ? store.count(id) / durationSec : null }),
        full: null,
        steady: null, // filled by applySettings
        // count = pass + fail (all completed instances, as LRE's Transaction_Count); timing uses passed only
        count: pass + fail, pass, fail, failPct: pass + fail ? (fail / (pass + fail)) * 100 : null,
        sumDataPass: (passFail.get(row.txId) || {}).pass != null ? passFail.get(row.txId).pass : null,
        perLg: store.perLg(id),
        distribution: store.distribution(id, 60),
        negativeRtClamped: e.negativeRt || 0,
        thinkSec: e.thinkSec || 0, wastedSec: e.wastedSec || 0, nested: e.nested || 0,
        vuserIterations: e.vuserIterations || 0, maxPerVuserIteration: e.maxPerVuserIteration || 0,
        firstRelSec: e.tsMin != null && startUtc ? e.tsMin - startUtc : null, lastRelSec: e.tsMax != null && startUtc ? e.tsMax - startUtc : null,
        recordTypes: e.bySubType || {},
      };
    });

    for (const t of transactions) t.full = t.fullExact; // exact until applySettings chooses the view
    const tl = store.timeline();
    const timeline = {
      bucketSec: bs, buckets: nb, startUtc,
      tx: tl.tx,
      vusers: life && startUtc ? runningPerBucket(life.vusers, startUtc, bs, nb) : null,
      totalTps: new Array(nb).fill(0).map((_, b) => { let n = 0; for (const id in tl.tx) n += tl.tx[id].count[b]; return n / bs; }),
      errors: errs ? errorsPerBucket(errs.rows, bs, nb) : null,
      hitsPerSec: webStats.hitsPerSec, throughputBytesPerSec: webStats.throughputPerSec,
      httpCodesPerSec: webStats.httpPerSec,
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
        responseTimeUnit: "seconds — end − start − wasted time − think time of each transaction record (LRE: \"do not include think time\")",
        transactionSource: "RawData.eve transaction records (sub-type 0x00C00FC0 + flags; flag 0x8000 = failed); response-time statistics use passed transactions, as LRE does",
        summaryBasis: null, // set by applySettings (exact or aggregated)
        transactionNames: resolution.method,
        steadyState: "last VUser running → first VUser exit (from _t_rep.eve); can be adjusted",
        sampleTime: "transaction end time (unix s)",
        negativeResponseTimes: "clamped to 0 and counted",
        tps: "count ÷ window length in seconds",
        bucketSec: bs,
        chartGranularity: `charts and Time Series only: auto ${bs} s (≤ 1,500 points over the run); can be set coarser — never used for the transaction summary`,
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
      latencyHeat: store.latencyHeat(transactions.filter((t) => !isWrapper(t.name, transactions)).map((t) => t.id), 240, 40),
      errors: errs && { total: errs.total, summary: errs.summary, rows: errs.rows.slice(0, 20000), rowsTruncated: errs.rows.length > 20000, typeFilter: errs.typeFilter, otherByType: errs.otherByType },
      sumData: sum ? { graphs: sum.graphs } : null,
      txNameResolution: { method: resolution.method, assumed: !!resolution.assumed, unresolved: resolution.unresolved, matches: resolution.matches },
      dataPoints: decoded ? decoded.dataPoints.map((d) => ({ id: d.id, name: map.dataPoints.get(d.id) || `id ${d.id}`, count: d.count, sum: d.sum })) : [],
      web: decoded ? webStats.summary : null,
      eve: decoded && {
        bytesRead: decoded.bytesRead, records: decoded.records, trailingBytes: decoded.trailingBytes, stopped: decoded.stopped,
        subTypes: decoded.subTypes, signatures: decoded.signatures, tx: decoded.tx, dp: decoded.dp, lookalikes: decoded.lookalikes,
      },
      selfCheck: checks,
      settings: null, window: null, insights: null,
    };
    Object.defineProperty(model, "store", { value: store, enumerable: false, writable: true });
    // base-granularity timeline and LG-health series: charts can be re-bucketed coarser from these
    // (applySettings → granularitySec) without re-reading the files; insights always use the base
    Object.defineProperty(model, "_base", {
      value: { timeline, lgSeries: (model.lgHealth || []).map((h) => Object.fromEntries(["cpu", "memory", "disk"].map((k) => [k, h[k] ? h[k].series : null]))) },
      enumerable: false, writable: true,
    });

    selfChecks(check, { meta, life, map, slaInfo, decoded, transactions, scripts, steadyRel, store, resolution });
    applySettings(model, opts.settings || {});
    return model;
  }

  /**
   * Script name (from _t_rep.eve or a VUser descriptor) → the workload script key (res*.lrr
   * [Scripts]), case-insensitively; with one script, everything belongs to it.
   */
  function scriptResolver(scripts) {
    const keys = new Map();
    for (const s of scripts) { keys.set(String(s.key).toLowerCase(), s.key); if (s.scriptName) keys.set(String(s.scriptName).toLowerCase(), s.key); }
    const only = scripts.length === 1 ? scripts[0].key : null;
    return (name) => {
      if (name != null && keys.has(String(name).toLowerCase())) return keys.get(String(name).toLowerCase());
      return only || (name != null && name !== "" ? String(name) : "(unknown script)");
    };
  }

  /** A transaction that wraps all others (e.g. Main_Transaction / the action) — excluded from the latency heatmap. */
  function isWrapper(name, transactions) {
    return /^(main_transaction|action_transaction|vuser_(init|end)_transaction)$/i.test(name || "") ||
      (transactions && transactions.find((t) => t.name === name && !t.inMap && /main/i.test(name || ""))) != null;
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
    // granularity: null = exact (every instance); N s = LRE-style aggregated figures (see collector.aggSummary)
    const agg = normaliseAggregation(settings.aggregation);
    let aggMissing = 0;
    for (const t of model.transactions) {
      const fullAgg = agg.sec && store ? store.aggSummary(t.id, null, agg.sec, agg.byVuser) : null;
      if (agg.sec && !fullAgg) aggMissing++;
      t.full = fullAgg ? Object.assign(fullAgg, { tps: t.fullExact.tps }) : t.fullExact;
      const steadyAgg = agg.sec && store && win ? store.aggSummary(t.id, win, agg.sec, agg.byVuser) : null;
      if (agg.sec && win && !steadyAgg) aggMissing++;
      t.steady = steadyAgg || (store && win ? store.summary(t.id, win) : { count: 0, min: null, avg: null, max: null, stdDev: null, p: {} });
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
      hitsPerSec: model.web ? model.web.hitsPerSec : graphStat(model, "hits"),
      throughputBytesPerSec: model.web ? model.web.throughputBytesPerSec : graphStat(model, "bytesReceived"),
      hits: model.web ? model.web.hits : null, throughputBytes: model.web ? model.web.throughputBytes : null,
    };
    model.window = win ? { start: win.start, end: win.end, durationSec: winSec, detected: !settings.window || !(settings.window.end > settings.window.start) } : null;
    // the charts use the same time slots as the aggregation (rounded up to an available chart granularity)
    const gSec = applyGranularity(model, agg.sec || settings.granularitySec);
    model.aggregation = describeAggregation(model, agg, aggMissing);
    model.method.summaryBasis = model.aggregation.basis;
    if (agg.sec && model.granularity) {
      model.method.chartGranularity = `charts and Time Series: ${model.granularity.sec} s — follows the ${agg.sec} s granularity` +
        (model.granularity.sec !== agg.sec ? " (nearest chart size available for this run)" : "");
    }
    model.settings = { window: settings.window || null, sla: slaS, granularitySec: agg.sec ? null : gSec, aggregation: agg };
    // insights always run on the base (finest) timeline, so findings do not change with the chart view
    model.insights = insights.run(model._base ? Object.assign({}, model, { timeline: model._base.timeline }) : model);
    return model;
  }

  /** Granularities offered for the LRE-style view (seconds). */
  const AGGREGATION_OPTIONS = [5, 10, 15, 20, 30, 60, 100, 200, 300, 500, 600, 900, 1800, 3600];

  function normaliseAggregation(a) {
    const sec = a && Number(a.sec) > 0 ? Number(a.sec) : null;
    // default: all VUsers together per slot — LoadRunner Analysis with "VuserID" ticked under
    // "graph properties to aggregate" (that tick merges the VUsers; unticked keeps them apart)
    return { sec, byVuser: !!(a && a.byVuser === true) };
  }

  /** Plain-English description of the figures being shown — used by the page, Excel, Word and PDF. */
  function describeAggregation(model, agg, missing) {
    const store = model.store;
    const exact = !store || store.method === "exact";
    const n = store ? store.totalSamples.toLocaleString("en-GB") : "?";
    const options = AGGREGATION_OPTIONS.map((sec) => ({ sec, available: !store || store.aggAvailable(sec) }));
    if (!agg.sec) {
      return {
        active: false, sec: null, byVuser: agg.byVuser, options, builtSec: store ? store.aggSec : null, exactStore: exact,
        title: "Exact — every transaction",
        basis: exact
          ? `Exact: every transaction instance on its own, no granularity (${n} passed instances)`
          : `Every transaction instance, no granularity (${n} passed instances — more than can be kept one by one, so percentiles come from histograms, within 0.5 %; Count, Min, Avg, Max and Std Dev are exact)`,
        note: "Every transaction your users made is counted on its own. Max is the slowest real response; percentiles are of real responses. Recommended for SLAs.",
      };
    }
    const who = agg.byVuser ? "per VUser" : "across all VUsers";
    return {
      active: true, sec: agg.sec, byVuser: agg.byVuser, options, builtSec: store ? store.aggSec : null, exactStore: exact,
      partial: missing > 0,
      title: `Aggregated — ${agg.sec} s ${who} (LRE-compatible)`,
      basis: `Aggregated (LRE Analysis "Data Aggregation" style): response times averaged in ${agg.sec}-second slots ${who}; Min, Max, Std Dev and percentiles are of those averages, weighted by count; Count, Pass, Fail and Average are exact` +
        (exact ? "" : `; very large run: averages were built while reading (percentiles within 0.5 %) and the steady-state figures use whole ${agg.sec}-second slots`) +
        (missing ? " — not available for some figures (very large run or user-set window): those show exact values" : ""),
      note: `First, the response times of each ${agg.byVuser ? "VUser" : "transaction"} inside every ${agg.sec}-second slot are averaged into one value. Min, Max, Std Dev and percentiles are then taken over those averages. Count and Average do not change. This is what LoadRunner Analysis shows when Data Aggregation is switched on with the same granularity. Averaging hides individual slow responses: one 40 s response averaged with ten 1 s responses in the same slot shows as about 4.5 s.`,
    };
  }

  /**
   * Chart granularity choices: the automatic (base) bucket and coarser multiples of it. Finer than
   * the base would need the file to be read again, so it is not offered.
   */
  function granularityOptions(baseSec, durationSec) {
    const mult = [1, 2, 3, 4, 5, 6, 10, 15, 20, 30, 60];
    const nice = [5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200];
    const set = new Set(mult.map((k) => baseSec * k));
    for (const c of nice) if (c >= baseSec && c % baseSec === 0) set.add(c);
    const maxSec = Math.max(baseSec, (durationSec || 0) / 10); // keep at least ~10 points on a chart
    return [...set].filter((s) => s === baseSec || s <= maxSec).sort((a, b) => a - b);
  }

  /**
   * Set model.timeline (charts, Time Series sheet, LG-health series) to the requested granularity.
   * requested: null / "auto" → base. Returns the applied value (null = auto).
   */
  function applyGranularity(model, requested) {
    const base = model._base;
    if (!base) return null;
    const bt = base.timeline;
    const options = granularityOptions(bt.bucketSec, model.meta && model.meta.durationSec);
    let sec = requested == null || requested === "auto" || requested === "" ? bt.bucketSec : Number(requested);
    if (!Number.isFinite(sec) || sec <= bt.bucketSec) sec = bt.bucketSec;
    if (!options.includes(sec)) sec = options.find((o) => o >= sec) || options[options.length - 1];
    const k = Math.round(sec / bt.bucketSec);
    model.granularity = { sec, baseSec: bt.bucketSec, auto: k === 1, options, buckets: Math.ceil(bt.buckets / k) };
    model.method.chartGranularity = `charts and Time Series only: ${sec} s${k === 1 ? " (auto: ≤ 1,500 points over the run)" : ` (user-selected; auto is ${bt.bucketSec} s)`} — never used for the transaction summary`;
    (model.lgHealth || []).forEach((h, i) => {
      for (const key of ["cpu", "memory", "disk"]) if (h[key] && base.lgSeries[i] && base.lgSeries[i][key]) h[key].series = k === 1 ? base.lgSeries[i][key] : mergeSeries(base.lgSeries[i][key], k, "mean");
    });
    if (k === 1) { model.timeline = bt; return requested == null || requested === "auto" || requested === "" ? null : sec; }
    const tl = model.store.timeline(k);
    const nb = tl.buckets;
    model.timeline = {
      bucketSec: sec, buckets: nb, startUtc: bt.startUtc,
      tx: tl.tx,
      vusers: bt.vusers ? mergeSeries(bt.vusers, k, "max") : null,
      totalTps: new Array(nb).fill(0).map((_, b) => { let n = 0; for (const id in tl.tx) n += tl.tx[id].count[b]; return n / sec; }),
      errors: bt.errors ? mergeSeries(bt.errors, k, "sum") : null,
      hitsPerSec: bt.hitsPerSec ? mergeSeries(bt.hitsPerSec, k, "mean") : null,
      throughputBytesPerSec: bt.throughputBytesPerSec ? mergeSeries(bt.throughputBytesPerSec, k, "mean") : null,
      httpCodesPerSec: bt.httpCodesPerSec ? Object.fromEntries(Object.entries(bt.httpCodesPerSec).map(([n, a]) => [n, mergeSeries(a, k, "mean")])) : null,
      graphs: (bt.graphs || []).map((g) => Object.assign({}, g, {
        measurements: g.measurements.map((ms) => {
          const o = Object.assign({}, ms);
          for (const key of Object.keys(ms)) if (Array.isArray(ms[key]) && ms[key].length === bt.buckets) o[key] = mergeSeries(ms[key], k, /max/i.test(key) ? "max" : "mean");
          return o;
        }),
      })),
    };
    return sec;
  }

  /** Merge every k values of a per-bucket series: "sum" (counts), "mean" (rates, %), "max" (peaks). Nulls are skipped. */
  function mergeSeries(arr, k, how) {
    const out = [];
    for (let i = 0; i < arr.length; i += k) {
      let acc = null, n = 0;
      for (let j = i; j < Math.min(arr.length, i + k); j++) {
        const v = arr[j];
        if (v == null || !Number.isFinite(v)) continue;
        n++;
        acc = acc == null ? v : how === "max" ? Math.max(acc, v) : acc + v;
      }
      out.push(acc == null ? null : how === "mean" ? acc / n : acc);
    }
    return out;
  }

  function graphStat(model, role) {
    const g = ((model._base ? model._base.timeline : model.timeline).graphs || []).find((x) => x.role === role);
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

  /**
   * Transaction ids → names. The decoder already emits RawData.map [END_TRANSACTION] ids (resolved
   * through the per-VUser registration records in RawData.eve), so this is a direct lookup.
   */
  function resolveNames(txIds, map, decoded) {
    const names = new Map();
    const unresolved = [];
    for (const id of txIds) {
      if (map.transactions.has(id)) names.set(id, map.transactions.get(id));
      else unresolved.push(id);
    }
    const t = decoded && decoded.tx;
    return {
      names, unresolved, assumed: false, matches: null,
      unregisteredRecords: t ? t.unresolved : 0, conflicts: t ? t.conflicts : 0, dictionary: t ? t.dictionary : 0,
      method: "RawData.eve registration records: (VUser, internal id) → RawData.map [END_TRANSACTION] id",
    };
  }

  /**
   * Web figures from RawData.eve data points (762/766): HTTP status codes (value = count), hits
   * (= Σ HTTP_xxx), throughput (mic_recv bytes), bytes sent (mic_sent), per time bucket.
   */
  function webCollector(map, startUtc, bucketSec) {
    const kind = new Map();
    for (const [id, name] of map.dataPoints) {
      const n = String(name);
      kind.set(id, /^HTTP_\d+$/i.test(n) ? "http" : n === "mic_recv" ? "recv" : n === "mic_sent" ? "sent" : "other");
    }
    const per = { http: new Map(), recv: [], sent: [], hits: [] };
    let hits = 0, recv = 0, sent = 0;
    const inc = (arr, b, v) => { while (arr.length <= b) arr.push(0); arr[b] += v; };
    function add(ts, id, value, vuser) { // eslint-disable-line no-unused-vars
      const k = kind.get(id);
      if (!k || k === "other" || !Number.isFinite(value)) return;
      const b = Math.max(0, Math.floor((ts - startUtc) / bucketSec));
      if (k === "http") {
        hits += value; inc(per.hits, b, value);
        if (!per.http.has(id)) per.http.set(id, []);
        inc(per.http.get(id), b, value);
      } else if (k === "recv") { recv += value; inc(per.recv, b, value); }
      else { sent += value; inc(per.sent, b, value); }
    }
    function finish(runSec, nb) {
      // LRE divides totals by (stop − start + 1) s — verified on runs 59 and 2144 (HTTP codes per second, average throughput)
      const durationSec = runSec ? runSec + 1 : null;
      const rate = (arr) => { const out = new Array(nb).fill(0); for (let b = 0; b < Math.min(nb, arr.length); b++) out[b] = arr[b] / bucketSec; return out; };
      const peak = (arr) => (arr.length ? Math.max(...arr) / bucketSec : null);
      const httpCodes = [...per.http.entries()].map(([id, arr]) => { const count = arr.reduce((a, c) => a + c, 0); return { id, name: map.dataPoints.get(id), count, perSec: durationSec ? count / durationSec : null }; })
        .sort((a, b) => (a.name < b.name ? -1 : 1));
      const any = hits || recv || sent;
      return {
        hitsPerSec: any ? rate(per.hits) : null,
        throughputPerSec: any ? rate(per.recv) : null,
        httpPerSec: any ? Object.fromEntries([...per.http.entries()].map(([id, arr]) => [map.dataPoints.get(id), rate(arr)])) : null,
        summary: any ? {
          hits, throughputBytes: recv, sentBytes: sent, httpCodes,
          hitsPerSec: { avg: durationSec ? hits / durationSec : null, peak: peak(per.hits) },
          throughputBytesPerSec: { avg: durationSec ? recv / durationSec : null, peak: peak(per.recv) },
          source: "RawData.eve data points (HTTP_xxx, mic_recv, mic_sent)",
        } : null,
      };
    }
    return { add, finish };
  }

  /**
   * Cross-check against LRE's own sum_data counts: pass graph (tprange_pass) totals per name and
   * failed transactions (tprange_fail). Counts are reported as-is; the graph values are rates, so
   * the conversion that reproduces the RawData.eve pass counts best is used and its error shown.
   */
  function crossCheckSumData(sum, txNames, rowsOfTx, store, resolution, check) {
    // per transaction name, summed over its script rows (LRE's graphs are per name)
    const passOf = (txId) => (rowsOfTx.get(txId) || []).reduce((a, r) => a + store.count(r), 0);
    const failOf = (txId) => (rowsOfTx.get(txId) || []).reduce((a, r) => a + store.failCount(r), 0);
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
        for (const m of passG.measurements) { const id = idOf(m.name); if (id == null) continue; const c = passOf(id); err += Math.abs(fn(m) - c); tot += c; n++; }
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
      for (const [id, n] of txNames) { const f = failOf(id); if (f) ours[n] = f; }
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
      `Local time = UTC ${meta.localOffsetSec >= 0 ? "+" : "−"}${Math.abs(meta.localOffsetSec / 3600)} h (${meta.localOffsetSource})`);
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
    if (store.method !== "exact" && store.aggLate) check("info", "aggregation", `${store.aggLate} instance(s) arrived out of time order for the ${store.aggSec} s aggregation and were kept as separate points`);
    if (store.method === "exact") check("info", "method", `Transaction summary: exact over every instance (${store.totalSamples} passed instances, no granularity); chart granularity ${store.bucketSec} s (auto)`);
    else check("warn", "method", `Large run: ${store.totalSamples} passed instances — more than the ${store.exactLimit} kept exactly, so percentiles come from 1 % histograms (within 0.5 %). Count, Min, Avg, Max and Std Dev stay exact; analysis-window figures use whole ${store.bucketSec} s buckets at the window edges. For exact percentiles run the CLI with a higher --exact-limit on a machine with more memory (≈ 12 bytes per instance)`);

    if (!decoded) return;
    if (decoded.stopped) check("fail", "eve-sync", `Decoding stopped at byte ${decoded.stopped.offset}: ${decoded.stopped.reason} (recLen=${decoded.stopped.recLen})`);
    else check(decoded.trailingBytes ? "warn" : "ok", "eve-sync",
      `${decoded.records} records read, ${decoded.bytesRead} bytes` + (decoded.trailingBytes ? `; ${decoded.trailingBytes} bytes of an incomplete last record` : "; file ends on a record boundary"));

    const t = decoded.tx;
    check(t.records ? "ok" : "fail", "eve-tx", t.records
      ? `${t.records} transaction records (${t.records - t.failed} passed, ${t.failed} failed) — by sub-type ${JSON.stringify(t.bySubType)}`
      : "No transaction records (sub-type 0x00C00FC0 + flags) found — the layout may differ in this LRE version; see the record types in the Validation tab");
    if (Object.keys(t.implausible).length) check("warn", "eve-tx-layout", "Transaction records skipped: unknown flags, or timestamps, duration or VUser out of range — layout may differ for these sub-types", t.implausible);
    else if (t.records) check("ok", "eve-tx-layout", "Every transaction record decoded (flag-based layout) with plausible start/end times and VUser");
    check(t.unresolved || t.conflicts ? "warn" : "ok", "eve-tx-identity", t.unresolved || t.conflicts
      ? `${t.unresolved} transaction record(s) without a registration record and ${t.conflicts} conflicting registration(s) — not counted`
      : `Every transaction record resolved through ${t.dictionary} (VUser, internal id) registrations`, t.unresolved ? t.unresolvedKeys : undefined);
    if (t.nested) check("info", "eve-nested", `${t.nested} transaction instances are nested inside another transaction`);
    if (Object.keys(decoded.lookalikes).length) check("info", "eve-lookalikes", "Other sub-types that also carry two timestamps at +28/+36 (not counted as transactions)", decoded.lookalikes);
    if (decoded.dataPoints.length) check(decoded.dp.unresolved ? "warn" : "info", "eve-datapoints", `${decoded.dataPoints.reduce((a, d) => a + d.count, 0)} data-point records (sub-types 762/766)` +
      (decoded.dp.unresolved ? `; ${decoded.dp.unresolved} without a registration (not counted)` : " — all resolved") + "; values summed per data point",
      Object.fromEntries(decoded.dataPoints.map((d) => [map.dataPoints.get(d.id) || "id " + d.id, d.sum])));
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

    if (decoded.vusers && decoded.vusers.length) {
      const ids = new Set(decoded.vusers.map((v) => v.vuser));
      const extra = t.vuserIds.filter((id) => !ids.has(id));
      check(extra.length ? "warn" : "ok", "eve-vusers", extra.length
        ? `${extra.length} VUser ID(s) with transactions but no VUser descriptor (sub-type 63) — their load generator is taken from _t_rep.eve`
        : `All ${t.vuserIds.length} VUser IDs have a descriptor in RawData.eve (${decoded.vusers.length} descriptors; group and load generator taken from them)`, extra.length ? extra.slice(0, 50) : undefined);
    } else if (life) {
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
      // each row's script comes from the VUser that ran it; flag rows the script's .usr does not list
      const byKey = new Map(scripts.map((s) => [s.key, s]));
      const unknown = transactions.filter((x) => !byKey.has(x.script)).map((x) => x.label);
      if (unknown.length) check("warn", "tx-script", "Transactions whose VUser could not be tied to a script", unknown.slice(0, 50));
      const unlisted = transactions.filter((x) => byKey.has(x.script) && byKey.get(x.script).transactions.length && !byKey.get(x.script).transactions.includes(x.name)).map((x) => x.label);
      if (unlisted.length) check("info", "tx-script", "Transactions not listed in their script's .usr", unlisted.slice(0, 50));
      const shared = new Set(transactions.filter((x) => x.label !== x.name).map((x) => x.name));
      if (shared.size) check("info", "tx-script", `${shared.size} transaction name(s) used by several scripts — reported per script`, [...shared].slice(0, 50));
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

  return { analyse, applySettings, redact, ENGINE_VERSION, AGGREGATION_OPTIONS };
});
