#!/usr/bin/env node
/**
 * make-demo-run.js — writes a realistic but entirely SYNTHETIC LRE raw-results folder (and ZIP)
 * for trying the Results Analyser without client data. No real hosts, scripts or applications.
 *
 *   node lre-results-analyser/tools/make-demo-run.js <out-folder> [--hours 3] [--vusers 27] [--zip]
 *
 * Built-in behaviour for the insights to find: a slow upward trend on one transaction, a level
 * shift on another, a spike with errors, one load generator slower than the other, HTTP 500s,
 * LG CPU, a few failed transactions and clock-skew negatives.
 */
"use strict";

const fs = require("fs");
const path = require("path");

function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function lognormal(r, median, sigma) { const u = Math.max(1e-9, r()), v = r(); return median * Math.exp(sigma * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v)); }

const TX = [
  ["DEMO_01_HOME", 0.35], ["DEMO_02_LOGIN", 0.9], ["DEMO_03_DASHBOARD", 1.4], ["DEMO_04_SEARCH", 1.1], ["DEMO_05_OPEN_ITEM", 0.8],
  ["DEMO_06_EDIT_ITEM", 0.6], ["DEMO_07_SAVE_ITEM", 1.6], ["DEMO_08_REPORTS", 2.4], ["DEMO_09_EXPORT", 3.2], ["DEMO_10_SETTINGS", 0.5],
  ["DEMO_11_NOTIFICATIONS", 0.4], ["DEMO_12_LOGOUT", 0.3],
];
const LGS = ["lg-demo-01.example.test", "lg-demo-02.example.test"];

// Record layouts: docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md
// Internal ids are per VUser; the first record of each (VUser, internal id) registers its RawData.map id.
const INTERNAL_ID_BASE = 30;

function envelope(body, sub) {
  const len = 28 + body.length, b = Buffer.alloc(len);
  b.writeUInt32BE(len, 0); b.writeUInt32BE(3, 4); b.writeUInt32BE(len - 12, 12); b.writeUInt32BE(len - 20, 20); b.writeUInt32BE(sub, 24);
  body.copy(b, 28);
  return b;
}
function text(s) { const b = Buffer.alloc(4 + Math.ceil(s.length / 4) * 4); b.writeUInt32BE(s.length, 0); b.write(s, 4, "latin1"); return b; }

/** Transaction record: sub-type 0x00C00FC0 + flags (0x01 registration, 0x20 think time, 0x8000 failed). end = unix s. */
function txRecord(end, iter, rtMs, vuser, internalId, failed, mapId, thinkSec) {
  let flags = failed ? 0x8000 : 0;
  const parts = [];
  if (mapId != null) { flags |= 0x01; parts.push(text(String(mapId))); }
  if (thinkSec) { flags |= 0x20; const t = Buffer.alloc(8); t.writeDoubleBE(thinkSec, 0); parts.push(t); }
  const f = Buffer.alloc(48);
  f.writeDoubleBE(end - rtMs / 1000 - (thinkSec || 0), 0); f.writeDoubleBE(end, 8);
  f.writeUInt32BE(iter + 1, 16); f.writeUInt32BE(internalId, 24); f.writeUInt32BE(vuser, 28);
  f.writeUInt32BE(failed ? 20 : 12, 32); f.writeUInt32BE(failed ? 7 : 1, 36); f.writeUInt32BE(iter, 40);
  parts.push(f);
  if (failed) parts.push(text("Error -26612: HTTP Status-Code=500"));
  return envelope(Buffer.concat(parts), 0x00c00fc0 + flags);
}

/** Data-point record: 766 (registration + sample) or 762 (sample); value 1 = one HTTP response. */
function dataPoint(ts, vuser, internalId, mapId) {
  const t = Buffer.alloc(8); t.writeDoubleBE(ts, 0);
  const tail = Buffer.alloc(28); tail.writeDoubleBE(1, 8); tail.writeUInt32BE(vuser, 16); tail.writeUInt32BE(internalId, 20);
  return mapId != null ? envelope(Buffer.concat([t, text(String(mapId)), tail]), 766) : envelope(Buffer.concat([t, tail]), 762);
}

/** VUser descriptor (sub-type 63): vuser, local number, group, script, ?, LG host. */
function vuserRecord(vuser, group, lg) {
  const v = Buffer.alloc(4); v.writeUInt32BE(vuser, 0);
  return envelope(Buffer.concat([v, text(String(vuser)), text(group), text(group.toLowerCase()), text("1"), text(lg.split(".")[0])]), 63);
}

async function main() {
  const args = process.argv.slice(2);
  const out = args.find((a) => !a.startsWith("--"));
  if (!out) { console.log("Usage: node make-demo-run.js <out-folder> [--hours 3] [--vusers 27] [--zip]"); process.exit(2); }
  const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? Number(args[i + 1]) : d; };
  const hours = opt("--hours", 3), nVu = opt("--vusers", 27), pace = 120;
  const r = rng(42);
  const START = 1790000000;
  const ramp = 5, runSec = Math.round(hours * 3600);
  const dir = path.resolve(out);
  fs.mkdirSync(path.join(dir, "sum_data"), { recursive: true });

  // VUsers: start one every 5 s, alternate LGs; exit one every 5 s after the run
  const vus = [];
  for (let v = 1; v <= nVu; v++) {
    const init = START + 5 + (v - 1) * ramp;
    vus.push({ v, lg: LGS[(v - 1) % 2], init, run: init + 3, exit: START + 5 + (nVu - 1) * ramp + 3 + runSec + (v - 1) * ramp });
  }
  const end = Math.max(...vus.map((x) => x.exit)) + 1;
  // two VUsers stop on error part-way through (as a script with "stop VUser on error" does in a long soak)
  if (nVu >= 10) { vus[nVu - 1].exit = vus[nVu - 1].run + Math.round(runSec * 0.4); vus[nVu - 2].exit = vus[nVu - 2].run + Math.round(runSec * 0.65); }

  // RawData.eve
  const fd = fs.openSync(path.join(dir, "RawData.eve"), "w");
  const hdr = Buffer.alloc(24); hdr.writeUInt32BE(24, 0); hdr.writeUInt32BE(7, 4);
  fs.writeSync(fd, hdr);
  const errors = [];
  const rtGraph = new Map(); // LRE's per-transaction response-time graph (sum_data graph_4): per name × 60 s
  const addGraph = (k, endTs, sec) => {
    const key = k + "|" + Math.floor((endTs - START) / 60);
    const e = rtGraph.get(key) || { k, ts: START + Math.floor((endTs - START) / 60) * 60, n: 0, sum: 0, min: Infinity, max: 0 };
    e.n++; e.sum += sec; e.min = Math.min(e.min, sec); e.max = Math.max(e.max, sec);
    rtGraph.set(key, e);
  };
  const pass = new Map(), fail = new Map();
  let buf = [];
  const flush = () => { if (buf.length) { fs.writeSync(fd, Buffer.concat(buf)); buf = []; } };
  const spikeAt = START + Math.round(runSec * 0.55);
  const shiftAt = START + Math.round(runSec * 0.4);
  for (const u of vus) {
    buf.push(vuserRecord(u.v, "Demo_Script_1", u.lg));
    const registered = new Set();
    // per-VUser internal ids: shuffled per VUser so they never equal the RawData.map ids
    const internal = TX.map((_, k) => INTERNAL_ID_BASE + ((k + u.v) % TX.length));
    for (let it = 0, t0 = u.run; t0 < u.exit - 30; it++, t0 += pace) {
      let t = t0;
      for (let k = 0; k < TX.length; k++) {
        const [name, med] = TX[k];
        let m = med;
        const rel = (t - START) / runSec;
        if (name === "DEMO_08_REPORTS") m *= 1 + 0.6 * rel;            // degrades over the soak
        if (name === "DEMO_04_SEARCH" && t > shiftAt) m *= 1.7;        // level shift
        if (u.lg === LGS[1] && name === "DEMO_03_DASHBOARD") m *= 1.4; // slower LG
        if (Math.abs(t - spikeAt) < 90) m *= 4;                         // spike window
        let rt = lognormal(r, m, 0.35) * 1000;
        if (r() < 0.0005) rt = -5 - r() * 2;                             // clock skew
        const failed = Math.abs(t - spikeAt) < 90 && name === "DEMO_07_SAVE_ITEM" && r() < 0.5;
        if (failed) {
          fail.set(name, (fail.get(name) || 0) + 1);
          errors.push({ t: t + Math.max(0, rt) / 1000, code: -26612, msg: `HTTP Status-Code=500 (Internal Server Error) for "https://app.example.test/api/items/${Math.floor(r() * 9999)}"`, v: u.v, lg: u.lg, it });
        } else pass.set(name, (pass.get(name) || 0) + 1);
        t += Math.max(0, rt) / 1000;
        const first = !registered.has(k); registered.add(k);
        buf.push(txRecord(t, it, rt, u.v, internal[k], failed, first ? k + 1 : null));
        const dp = failed ? 2 : 1, dpFirst = !registered.has("dp" + dp); registered.add("dp" + dp);
        buf.push(dataPoint(t, u.v, dp, dpFirst ? dp : null));
        if (!failed) addGraph(k, t, Math.max(0, rt) / 1000);
        t += 1 + r() * 2; // think time
      }
      if (buf.length > 20000) flush();
    }
  }
  flush();
  fs.closeSync(fd);
  if (errors.length < 3) errors.push({ t: START + 600, code: -27796, msg: "Failed to connect to server \"app.example.test:443\": [10060] Connection timed out", v: 3, lg: LGS[0], it: 2 });

  const w = (name, text) => fs.writeFileSync(path.join(dir, name), text.replace(/\n/g, "\r\n"));
  const wall = new Date((START + 3600 - 40) * 1000);
  const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const h12 = wall.getUTCHours() % 12 || 12;
  w("RunInfo.ini", `[Report]\nCompanyName=DEMO_PROJECT\nSessionName=Demo_Soak_${nVu}VU_${hours}h\nRunDate=${wall.getUTCDate()}-${MON[wall.getUTCMonth()]}-${wall.getUTCFullYear()} ${String(h12).padStart(2, "0")}:${String(wall.getUTCMinutes()).padStart(2, "0")}:${String(wall.getUTCSeconds()).padStart(2, "0")} ${wall.getUTCHours() < 12 ? "AM" : "PM"}\nDuration=${Math.round((end - START) / 60)}\n`);
  w("res1.lrr", `[Scenario]\nProduct=Demo Performance Controller\nVersion=2026.1\nResultName=res1\nTime_Zone=0\nStart_time=${START}\nDaylight_Bias=-60\nStop_time=${end}\n[Running_mode]\nStart_reason=By command\nStop_reason=Scenario ended\n[Scenario_summary]\nScenario Type=Manual Scenario\nMode=Scenario Scheduling\nScenario Duration=Start all Vusers: 1 every 00:00:05 (HH:MM:SS); Run for ${String(Math.floor(runSec / 3600)).padStart(2, "0")}:${String(Math.floor((runSec % 3600) / 60)).padStart(2, "0")}:00 (HH:MM:SS); Stop all Vusers: 1 every 00:00:05 (HH:MM:SS)\nLoad Behavior=Initialize each Vuser just before it runs\nGlobal Schedule=ST${nVu}_1E5;R${runSec};SP${nVu}_1E5;\n[Scripts]\nDemo_Script_1=D:\\scripts\\Demo_Script\\Demo_Script.usr\n[Scripts_types]\nDemo_Script_1=DevWeb\n`);
  w("RawData.map", `[DATA_POINT]\n1="HTTP_200"\n2="HTTP_500"\n[END_TRANSACTION]\n${TX.map(([n], i) => `${i + 1}="${n}"`).join("\n")}\n`);
  w("SLAConfiguration.xml", `<?xml version="1.0" encoding="UTF-8"?><SLA Version="1.0"><TxList>${TX.map(([n]) => `<Tx>${n}</Tx>`).join("")}<Tx>Main_Transaction</Tx></TxList><SLARules><TrackingPeriodType>Default</TrackingPeriodType></SLARules></SLA>`);
  w("collate.txt", `[Collate Recovery]\nCompleted=1\n[Post Run Actions]\nActions=CollateAnalyze\n[Hosts]\n${LGS.map((l, i) => `${l}=D:\\Temp\\${l}_${i + 1}.eve`).join("\n")}\n`);
  w("demo_script_1.usp", `[RunLogicRunRoot]\nRunLogicNumOfIterations=1\nRunLogicPaceType=Const\nRunLogicPaceConstTime=${pace}\n`);
  w("demo_script_1.cfg", `[DevWebYaml]\nyaml="{"thinkTime":{"type":"asRecorded","limit":3}}"\n`);
  w("demo_script_1.usr", `[General]\nType=DevWeb\nScriptLanguage=JavaScript\n[TransactionsOrder]\nOrder="${TX.map(([n]) => n).join("__*delimiter*__")}"\n`);
  const trep = [`28 11 ${START} 2 0 0 0`];
  for (const l of LGS) trep.push(`28 10 ${l} 30 0 0`);
  for (const u of vus) trep.push(`28 4 demo_group ${u.v} ${u.init} 0 Demo_Script_1 ${u.lg} 0 1`, `28 0 demo_group ${u.v} ${u.init + 2} 0 ${u.lg} 0`, `28 8 demo_group ${u.v}  0 0`, `28 2 demo_group ${u.v} ${u.run} 0 p 0 0`);
  for (const u of vus) trep.push(`28 1 demo_group ${u.v} ${u.exit} 0 2`);
  trep.push(`28 12 ${end} 1 ${end} 0 1`);
  w("_t_rep.eve", trep.join("\n") + "\n");

  // sum_data
  const g = (n, lines) => fs.writeFileSync(path.join(dir, "sum_data", `graph_${n}.dat`), lines.join("\n") + "\n");
  const sumIni = [`[General]\nVersion=1\nScenarioStartTime=${START}\nScenarioDuration=${end - START}`];
  const MONITORED = LGS.concat(["ctrl-demo.example.test"]); // the Controller is monitored too, with no VUsers
  sumIni.push("[graph_1]\nGraphType=es_tr_lg_monitoring\n" + MONITORED.flatMap((l, i) => [`Measurement_${i * 2}=${10 + i * 2},${l.split(".")[0]} [192.0.2.${10 + i}] - CPU Usage (%)`, `Measurement_${i * 2 + 1}=${11 + i * 2},${l.split(".")[0]} [192.0.2.${10 + i}] - Memory Usage (%)`]).join("\n"));
  const g1 = [];
  for (let t = START; t < end; t += 15) MONITORED.forEach((l, i) => {
    const base = i === 1 ? 62 : 38;
    const cpu = Math.min(99, base + 10 * Math.sin((t - START) / 900) + r() * 8 + (Math.abs(t - spikeAt) < 120 ? 30 : 0));
    g1.push(`${10 + i * 2} ${t} ${cpu.toFixed(4)} 1 ${cpu.toFixed(4)} ${cpu.toFixed(4)} 0`, `${11 + i * 2} ${t} ${(35 + i * 10 + (t - START) / runSec * 8).toFixed(4)} 1 0 0 0`);
  });
  g(1, g1);
  sumIni.push("[graph_2]\nGraphType=es_tr_tprange_pass\n" + TX.map(([n], i) => `Measurement_${i}=${n},${100 + i}`).join("\n"));
  g(2, TX.map(([n], i) => `${100 + i} ${START + 60} ${pass.get(n) || 0} 1 0 0 0`));
  sumIni.push("[graph_14]\nGraphType=es_tr_tprange_fail\n" + TX.map(([n], i) => `Measurement_${i}=${n},${200 + i}`).join("\n"));
  g(14, TX.filter(([n]) => fail.get(n)).map(([n]) => `${200 + TX.findIndex((x) => x[0] === n)} ${spikeAt} ${fail.get(n)} -1 0 0 0`));
  // per-transaction response-time graph: name,measurementId (LRE 2026 format) — the bridge to the internal ids
  sumIni.push("[graph_4]\nGraphType=es_tr_response_time\n" + TX.map(([n], i) => `Measurement_${i}=${n},${500 + i}`).join("\n"));
  g(4, [...rtGraph.values()].sort((a, b) => a.ts - b.ts || a.k - b.k).map((e) => `${500 + e.k} ${e.ts} ${(e.sum / e.n).toFixed(6)} ${e.n} ${e.min.toFixed(6)} ${e.max.toFixed(6)} 0`));
  sumIni.push("[graph_10]\nGraphType=HTTP_RC\nMeasurement_0=300,HTTP_200\nMeasurement_1=301,HTTP_500");
  const g10 = [];
  for (let t = START + 5; t < end; t += 5) {
    const running = vus.filter((u) => u.run <= t && u.exit > t).length;
    g10.push(`300 ${t} ${(running * 0.6 + r()).toFixed(3)} 5 0 0 0`);
    if (Math.abs(t - spikeAt) < 90) g10.push(`301 ${t} ${(0.2 + r() * 0.3).toFixed(3)} 5 0 0 0`);
  }
  g(10, g10);
  sumIni.push("[graph_7]\nGraphType=mic_recv\nMeasurement_0=400,mic_recv");
  const g7 = [];
  for (let t = START + 5; t < end; t += 5) { const running = vus.filter((u) => u.run <= t && u.exit > t).length; g7.push(`400 ${t} ${(running * 52000 * (0.8 + r() * 0.4)).toFixed(1)} 5 0 0 0`); }
  g(7, g7);
  fs.writeFileSync(path.join(dir, "sum_data", "sum_dat.ini"), sumIni.join("\n").replace(/\n/g, "\r\n") + "\r\n");

  // SqliteDb.db (same schema as LRE 2026) — written with the bundled sql.js (no native module)
  const SQL = await require("../web/vendor/sql-wasm.js")({ locateFile: (f) => path.join(__dirname, "..", "web", "vendor", f) });
  const db = new SQL.Database();
  db.run(`CREATE TABLE Actions (Action_ID INTEGER PRIMARY KEY AUTOINCREMENT, Action_Name TEXT NOT NULL);
    CREATE TABLE ErrorMessages (Message_ID INTEGER PRIMARY KEY AUTOINCREMENT, Message_String TEXT NOT NULL);
    CREATE TABLE Injectors (Injector_ID INTEGER PRIMARY KEY AUTOINCREMENT, Injector_Name TEXT NOT NULL);
    CREATE TABLE Scripts (Script_ID INTEGER PRIMARY KEY AUTOINCREMENT, Script_Name TEXT NOT NULL);
    CREATE TABLE VusersID (Vuser_ID INTEGER PRIMARY KEY AUTOINCREMENT, Vuser_ID_Name TEXT NOT NULL);
    CREATE TABLE Main (Row_ID INTEGER NOT NULL DEFAULT (0) PRIMARY KEY, Error_Code INTEGER NULL, Time DATETIME NOT NULL DEFAULT (CURRENT_TIMESTAMP), Type INTEGER DEFAULT (0), Line INTEGER, Area INTEGER DEFAULT (0), Iteration INTEGER, Action_ID INTEGER DEFAULT (0), Message_ID INTEGER DEFAULT (0), Injector_ID INTEGER DEFAULT (0), Script_ID INTEGER DEFAULT (0), Vuser_ID INTEGER DEFAULT (0));`);
  const id = (table, col, val) => {
    const found = db.exec(`SELECT rowid FROM ${table} WHERE ${col} = ?`, [val]);
    if (found.length) return found[0].values[0][0];
    db.run(`INSERT INTO ${table} (${col}) VALUES (?)`, [val]);
    return db.exec("SELECT last_insert_rowid()")[0].values[0][0];
  };
  errors.forEach((e, i) => {
    const local = new Date((e.t + 3600) * 1000).toISOString().replace("T", " ").slice(0, 19); // run local time = UTC+1
    db.run("INSERT INTO Main (Row_ID, Error_Code, Time, Type, Line, Area, Iteration, Action_ID, Message_ID, Injector_ID, Script_ID, Vuser_ID) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
      [i + 1, e.code, local, 2, 42, 0, e.it, id("Actions", "Action_Name", "Main"), id("ErrorMessages", "Message_String", e.msg), id("Injectors", "Injector_Name", e.lg), id("Scripts", "Script_Name", "Demo_Script_1"), id("VusersID", "Vuser_ID_Name", String(e.v))]);
  });
  fs.writeFileSync(path.join(dir, "SqliteDb.db"), Buffer.from(db.export()));
  db.close();

  console.log(`Demo run written to ${dir} (${(fs.statSync(path.join(dir, "RawData.eve")).size / 1e6).toFixed(1)} MB RawData.eve, ${errors.length} errors)`);

  if (args.includes("--zip")) {
    const archiver = require("archiver");
    const zipPath = dir.replace(/[\\/]$/, "") + ".zip";
    const outS = fs.createWriteStream(zipPath);
    const a = archiver("zip", { zlib: { level: 6 } });
    a.pipe(outS);
    a.directory(dir, path.basename(dir));
    outS.on("close", () => console.log(`ZIP written to ${zipPath}`));
    a.finalize();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
