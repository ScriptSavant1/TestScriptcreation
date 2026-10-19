/**
 * worker.js — runs the analysis engine off the UI thread. Files are read straight from the
 * user's disk (File objects / ZIP); nothing is uploaded.
 *
 * Messages in:
 *   {type:"analyse", source:{kind:"folder", files:[{path, file}]} | {kind:"zip", file}, settings}
 *   {type:"settings", settings}            → recompute window / SLA figures (no re-read)
 *   {type:"latency", ids:[txId], cols, rows} → latency heatmap for a selection
 * Messages out: {type:"progress", done, total, stage} · {type:"result", model} · {type:"latency", heat}
 *               {type:"error", message}
 */
/* global importScripts, initSqlJs */
"use strict";

importScripts(
  "engine/text.js", "engine/ini.js", "engine/files.js", "engine/scenario.js", "engine/trep.js", "engine/runlogic.js",
  "engine/rawmap.js", "engine/sla.js", "engine/collate.js", "engine/eve.js", "engine/stats.js", "engine/errors.js",
  "engine/hist.js", "engine/collector.js", "engine/dat.js", "engine/insights.js", "engine/analyse.js", "zip.js"
);

const L = self.LreRA;
let model = null;
let sqlPromise = null;

function sqlite() {
  if (!sqlPromise) {
    sqlPromise = new Promise((resolve, reject) => {
      try {
        importScripts("vendor/sql-wasm.js");
        initSqlJs({ locateFile: (f) => "vendor/" + f }).then(resolve, reject);
      } catch (e) { reject(e); }
    });
  }
  return sqlPromise;
}

async function runQuery(bytes, sql) {
  const SQL = await sqlite();
  const db = new SQL.Database(bytes);
  try {
    const res = db.exec(sql);
    if (!res.length) return [];
    const { columns, values } = res[0];
    return values.map((row) => Object.fromEntries(columns.map((c, i) => [c, row[i]])));
  } finally { db.close(); }
}

async function streamBlob(blob, onChunk) {
  const reader = blob.stream().getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    onChunk(value);
  }
}

function folderSource(list) {
  const byPath = new Map(list.map((f) => [f.path, f.file]));
  const get = (p) => { const f = byPath.get(p); if (!f) throw new Error("File not found: " + p); return f; };
  return {
    list: async () => [...byPath.keys()],
    readBytes: async (p) => new Uint8Array(await get(p).arrayBuffer()),
    size: async (p) => get(p).size,
    stream: (p, cb) => streamBlob(get(p), cb),
    sqlite: async (p, sql) => runQuery(new Uint8Array(await get(p).arrayBuffer()), sql),
  };
}

async function zipSource(file) {
  const z = await L.zip.open(file);
  const names = z.entries.map((e) => e.name);
  if (!names.some((n) => /(^|\/)rawdata\.eve$/i.test(n))) {
    const inner = names.filter((n) => /\.zip$/i.test(n));
    if (inner.length) throw new Error(`This ZIP contains other ZIP files (${inner.slice(0, 3).join(", ")}) but no RawData.eve. Extract it and choose the inner ZIP or the folder.`);
  }
  return {
    list: async () => names,
    readBytes: (p) => z.read(p),
    size: async (p) => z.size(p),
    stream: (p, cb) => z.stream(p, cb),
    sqlite: async (p, sql) => runQuery(await z.read(p), sql),
  };
}

function post(m) {
  // the store (non-enumerable) stays here; only the plain model crosses to the page
  self.postMessage({ type: "result", model: m });
}

self.onmessage = async (ev) => {
  const msg = ev.data || {};
  try {
    if (msg.type === "analyse") {
      const src = msg.source.kind === "zip" ? await zipSource(msg.source.file) : folderSource(msg.source.files);
      let last = 0;
      model = await L.analyse.analyse(src, {
        settings: msg.settings || {},
        onProgress: (done, total, stage) => {
          const now = Date.now();
          if (now - last < 150 && done !== total) return;
          last = now;
          self.postMessage({ type: "progress", done, total, stage });
        },
      });
      post(model);
    } else if (msg.type === "settings") {
      if (!model) throw new Error("No analysis loaded");
      L.analyse.applySettings(model, msg.settings || {});
      post(model);
    } else if (msg.type === "redact") {
      if (!model) throw new Error("No analysis loaded");
      self.postMessage({ type: "redacted", model: L.analyse.redact(model) });
    } else if (msg.type === "latency") {
      if (!model) throw new Error("No analysis loaded");
      self.postMessage({ type: "latency", heat: model.store.latencyHeat(msg.ids, msg.cols || 240, msg.rows || 40), ids: msg.ids });
    }
  } catch (e) {
    self.postMessage({ type: "error", message: String((e && e.message) || e) });
  }
};
