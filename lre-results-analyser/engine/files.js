/**
 * files.js — locate the results root and the files we use, from a plain list of relative paths.
 *
 * Works for a selected folder or ZIP entries alike: the caller supplies paths like
 * "RawResults_59/RawData.eve" or "RawData.eve". Look-ups are case-insensitive
 * (LRE folders have been seen as both "SqliteDb.db" and "sqliteDB.db").
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else (root.LreRA = root.LreRA || {}).files = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // Fixed names (relative to the results root). required = Phase 0 cannot run without it.
  const FIXED = [
    { key: "rawDataEve", name: "RawData.eve", required: true },
    { key: "rawDataMap", name: "RawData.map", required: true },
    { key: "runInfo", name: "RunInfo.ini", required: true },
    { key: "trep", name: "_t_rep.eve", required: true },
    { key: "sla", name: "SLAConfiguration.xml", required: false },
    { key: "sqlite", name: "SqliteDb.db", required: false },
    { key: "collate", name: "collate.txt", required: false },
    { key: "remoteResults", name: "remote_results.txt", required: false },
    { key: "sumDatIni", name: "sum_data/sum_dat.ini", required: false },
  ];

  const norm = (p) => String(p).replace(/\\/g, "/").replace(/^\.\//, "");
  const base = (p) => norm(p).split("/").pop();
  const dir = (p) => { const n = norm(p); const i = n.lastIndexOf("/"); return i < 0 ? "" : n.slice(0, i + 1); };

  /**
   * @param {string[]} paths  every file path in the folder / ZIP (relative, any separator)
   * @returns {{root, files, cfgs, usps, usrs, lrr, graphs, missing, extra}}
   */
  function discover(paths) {
    const all = paths.map(norm).filter((p) => !p.endsWith("/"));
    // The results root is where RawData.eve lives (top folder in the ZIP or not); fall back to the .lrr.
    const anchor = all.find((p) => base(p).toLowerCase() === "rawdata.eve") ||
                   all.find((p) => /\.lrr$/i.test(p));
    const root = anchor ? dir(anchor) : "";
    const rel = all.filter((p) => p.startsWith(root)).map((p) => p.slice(root.length));
    const byLower = new Map(rel.map((p) => [p.toLowerCase(), p]));
    const at = (name) => { const r = byLower.get(name.toLowerCase()); return r === undefined ? null : root + r; };
    const top = rel.filter((p) => !p.includes("/"));

    const files = {};
    const missing = [];
    for (const f of FIXED) {
      files[f.key] = at(f.name);
      if (!files[f.key]) missing.push({ name: f.name, required: f.required });
    }

    // Dynamic names: res<N>.lrr (one per run), per-script *.cfg / *.usp / *.usr (.bak only as fallback)
    const lrrs = top.filter((p) => /\.lrr$/i.test(p));
    const lrr = lrrs.length ? root + lrrs[0] : null;
    if (!lrr) missing.push({ name: "res*.lrr", required: true });

    const cfgs = top.filter((p) => /\.cfg$/i.test(p)).map((p) => root + p);
    const usps = top.filter((p) => /\.usp$/i.test(p)).map((p) => root + p);
    const usrNames = new Map();
    for (const p of top) {
      const m = /^(.*)\.usr(\.bak)?$/i.exec(p);
      if (!m) continue;
      const key = m[1].toLowerCase();
      if (!usrNames.has(key) || !m[2]) usrNames.set(key, root + p); // prefer .usr over .usr.bak
    }
    const graphs = rel.filter((p) => /^sum_data\/graph_\d+\.dat$/i.test(p)).map((p) => root + p);

    return {
      root,
      files: Object.assign(files, { lrr }),
      lrrCandidates: lrrs.map((p) => root + p),
      cfgs, usps, usrs: [...usrNames.values()], graphs,
      missing,
      requiredMissing: missing.filter((m) => m.required).map((m) => m.name),
    };
  }

  /** Lower-case file stem without extension(s) — used to match per-script files to scripts. */
  function stem(p) {
    return base(p).replace(/\.(usr\.bak|cfg|usp|usr)$/i, "").toLowerCase();
  }

  return { discover, stem, base, norm };
});
