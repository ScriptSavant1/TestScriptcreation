/**
 * Synthetic LRE results for tests — sanitised (no real hosts, scripts or clients).
 * Not a test file itself (Jest matches *.test.js only).
 */
"use strict";

const TX_LEN = { 12586944: 76, 12586945: 84, 12619721: 108 };

/**
 * One transaction record (docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md §4): ts = end time (unix s),
 * start = ts − rt. sub 12586944 = completed, 12586945 = variant, 12619721 = failed.
 */
function txRecord({ ts, iter, rtMs, vuser, txId, sub = 12586944 }) {
  const len = TX_LEN[sub] || 76;
  const b = Buffer.alloc(len);
  b.writeUInt32BE(len, 0); b.writeUInt32BE(3, 4); b.writeUInt32BE(0, 8); b.writeUInt32BE(len - 12, 12);
  b.writeUInt32BE(0, 16); b.writeUInt32BE(len - 20, 20); b.writeUInt32BE(sub, 24);
  b.writeDoubleBE(ts - rtMs / 1000, 28);
  b.writeDoubleBE(ts, 36);
  b.writeUInt32BE(Math.max(0, Math.round(rtMs)), 44);
  b.writeUInt32BE(txId, 52); b.writeUInt32BE(vuser, 56); b.writeUInt32BE(12, 60); b.writeUInt32BE(1, 64); b.writeUInt32BE(iter, 68);
  if (sub === 12619721) b.writeUInt32BE(0xffffffff, 76);
  return b;
}

/** One data-point record (sub-type 762, 64 bytes): +28 ts · +36 seq · +44 value · +52 vuser · +56 data-point id. */
function dataPoint({ ts, vuser, dpId, value = 1, seq = 0 }) {
  const b = Buffer.alloc(64);
  b.writeUInt32BE(64, 0); b.writeUInt32BE(3, 4); b.writeUInt32BE(1, 8); b.writeUInt32BE(52, 12); b.writeUInt32BE(1, 16); b.writeUInt32BE(44, 20);
  b.writeUInt32BE(762, 24); b.writeDoubleBE(ts, 28); b.writeUInt32BE(seq, 36); b.writeDoubleBE(value, 44);
  b.writeUInt32BE(vuser, 52); b.writeUInt32BE(dpId, 56);
  return b;
}

/** A non-transaction record of any length / sub-type (e.g. 766 monitoring, 72 bytes). */
function otherRecord(len, subType, fill = 0) {
  const b = Buffer.alloc(len, fill);
  b.writeUInt32BE(len, 0);
  b.writeUInt32BE(3, 4);
  b.writeUInt32BE(16, 8);
  b.writeUInt32BE(len - 12, 12);
  b.writeUInt32BE(1, 16);
  b.writeUInt32BE(len - 20, 20);
  b.writeUInt32BE(subType, 24);
  return b;
}

function header() {
  const b = Buffer.alloc(24);
  b.writeUInt32BE(24, 0);
  b.writeUInt32BE(7, 4);
  return b;
}

/** Feed a buffer to a decoder in random-size chunks (deterministic PRNG). */
function feedRandom(decoder, buf, seed = 7) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  let p = 0;
  while (p < buf.length) {
    const n = 1 + Math.floor(rnd() * 150);
    decoder.push(new Uint8Array(buf.subarray(p, p + n)));
    p += n;
  }
}

const START = 1700000000;

/** LRE's per-transaction response-time graph (name, measurement id) — the bridge to the internal ids. */
const SUM_DAT_INI_BASE = ["[General]", `ScenarioStartTime=${START}`, "[graph_4]", "GraphType=es_tr_response_time", "Measurement_0=T01_LOGIN,51", "Measurement_1=T02_SUBMIT,52"].join("\r\n");
const GRAPH_4_DAT = `51 ${START + 120} 1.1015 6 1.001 1.202 0.07\n52 ${START + 125} 2.01 6 2.0 2.02 0.008\n`;

/** A small, complete results folder as {path: Buffer|string}. 2 VUsers, 2 LGs, 3 iterations, 2 transactions. */
function sampleRun() {
  const recs = [header()];
  // internal ids 10 / 11 (≠ RawData.map ids 1 / 2 — names come from sum_data graph_4, as in real runs)
  // VUser 1 runs at t+10, VUser 2 at t+15 → steady t+15 … first exit t+400
  for (let it = 0; it < 3; it++) {
    for (const v of [1, 2]) {
      const base = START + 20 + it * 100 + v;
      recs.push(txRecord({ ts: base, iter: it, rtMs: 1000 + it * 100 + v, vuser: v, txId: 10 }));
      recs.push(txRecord({ ts: base + 5, iter: it, rtMs: 2000 + it * 10, vuser: v, txId: 11, sub: it === 0 && v === 1 ? 12586945 : 12586944 }));
      recs.push(dataPoint({ ts: base + 1, vuser: v, dpId: 2, seq: it }));
    }
    recs.push(otherRecord(72, 766, 0x41)); // record with ASCII payload ("AAAA…")
  }
  recs.push(txRecord({ ts: START + 30, iter: 3, rtMs: -5, vuser: 1, txId: 10, sub: 12619721 })); // failed, negative RT
  const eve = Buffer.concat(recs);

  const trep = [
    `28 11 ${START} 2 1 1 1`,
    `28 4 grp_a 1 ${START + 5} 0 Script_A_1 lg1.example.test 0 1`,
    `28 10 lg1.example.test 30 0 0`,
    `28 0 grp_a 1 ${START + 8} 0 lg1.example.test 0`,
    `28 8 grp_a 1  0 0`,
    `28 2 grp_a 1 ${START + 10} 0 p 0 0`,
    `28 4 grp_a 2 ${START + 6} 0 Script_A_1 lg2.example.test 0 1`,
    `28 10 lg2.example.test 30 0 0`,
    `28 2 grp_a 2 ${START + 15} 0 p 0 0`,
    `28 1 grp_a 1 ${START + 400} 0 2`,
    `28 1 grp_a 2 ${START + 405} 0 2`,
    `28 12 ${START + 410} 1 ${START + 410} 0 9`,
  ].join("\r\n");

  return {
    "Res9/RawData.eve": eve,
    "Res9/_t_rep.eve": trep,
    "Res9/RunInfo.ini": "[Report]\r\nCompanyName=TEST\r\nSessionName=Unit_Run\r\nRunDate=14-November-2023 11:13:00 PM\r\nDuration=7\r\n",
    "Res9/res9.lrr": [
      "[Scenario]", "Product=Test Controller", "Version=1.0", "Time_Zone=0", `Start_time=${START}`, "Daylight_Bias=-60", `Stop_time=${START + 410}`,
      "[Running_mode]", "Stop_reason=By a user",
      "[Scenario_summary]", "Global Schedule=ST2_1E5;R300;SP2_1E5;",
      "[Scripts]", "Script_A_1=D:\\scripts\\Script_A\\Script_A.usr",
      "[Scripts_types]", "Script_A_1=DevWeb",
    ].join("\r\n"),
    "Res9/RawData.map": '[DATA_POINT]\r\n1="tcp_connect"\r\n2="HTTP_200"\r\n[END_TRANSACTION]\r\n2="T02_SUBMIT"\r\n1="T01_LOGIN"\r\n',
    "Res9/SLAConfiguration.xml": '\ufeff<?xml version="1.0"?><SLA Version="1.0"><TxList><Tx>T01_LOGIN</Tx><Tx>Main_Transaction</Tx></TxList><SLARules><TrackingPeriodType>Default</TrackingPeriodType><TrackingPeriodValue></TrackingPeriodValue></SLARules></SLA>',
    "Res9/collate.txt": "[Collate Recovery]\r\nCompleted=1\r\n[Hosts]\r\nlg1.example.test=D:\\x\\lg1.eve\r\nlg2.example.test=D:\\x\\lg2.eve\r\n",
    "Res9/sum_data/sum_dat.ini": SUM_DAT_INI_BASE,
    "Res9/sum_data/graph_4.dat": GRAPH_4_DAT,
    "Res9/script_a_1.usp": "[RunLogicRunRoot]\r\nRunLogicPaceType=Const\r\nRunLogicPaceConstTime=100\r\nRunLogicNumOfIterations=1\r\n",
    "Res9/script_a_1.cfg": '[DevWebYaml]\r\nyaml="{"thinkTime":{"type":"asRecorded","limit":3}}"\r\n',
    "Res9/script_a_1.cfg.bak": "[ThinkTime]\r\nOptions=NOTHINK\r\n",
    "Res9/script_a_1.usr.bak": '[General]\r\nType=DevWeb\r\nScriptLanguage=JavaScript\r\n[TransactionsOrder]\r\nOrder="T01_LOGIN__*delimiter*__T02_SUBMIT"\r\n',
  };
}

/** In-memory source for engine/analyse.js. */
function memorySource(filesMap, { chunk = 50, sqliteRows = null } = {}) {
  const bytes = (v) => (typeof v === "string" ? Buffer.from(v, "utf8") : v);
  return {
    list: async () => Object.keys(filesMap),
    readBytes: async (p) => new Uint8Array(bytes(filesMap[p])),
    size: async (p) => bytes(filesMap[p]).length,
    stream: async (p, onChunk) => {
      const b = bytes(filesMap[p]);
      for (let i = 0; i < b.length; i += chunk) onChunk(new Uint8Array(b.subarray(i, i + chunk)));
    },
    sqlite: sqliteRows ? async () => sqliteRows : undefined,
  };
}

module.exports = { txRecord, dataPoint, SUM_DAT_INI_BASE, otherRecord, header, feedRandom, sampleRun, memorySource, START };
