/**
 * Synthetic LRE results for tests — sanitised (no real hosts, scripts or clients).
 * Not a test file itself (Jest matches *.test.js only).
 */
"use strict";

const TX_BASE = 0x00c00fc0;

function envelope(body, sub) {
  const len = 28 + body.length;
  const b = Buffer.alloc(len);
  b.writeUInt32BE(len, 0); b.writeUInt32BE(3, 4); b.writeUInt32BE(0, 8); b.writeUInt32BE(len - 12, 12);
  b.writeUInt32BE(0, 16); b.writeUInt32BE(len - 20, 20); b.writeUInt32BE(sub, 24);
  body.copy(b, 28);
  return b;
}
function textField(s) {
  const n = Buffer.byteLength(s, "latin1");
  const b = Buffer.alloc(4 + Math.ceil(n / 4) * 4);
  b.writeUInt32BE(n, 0); b.write(s, 4, "latin1");
  return b;
}

/**
 * One transaction record (docs/SPEC-RawData-eve-REVERSE-ENGINEERED.md): subType = 0x00C00FC0 + flags.
 * ts = end time (unix s); start = ts − rt − wasted − think, so the LRE response time is rtMs.
 * `register` (flag 0x01) carries the RawData.map id as text and registers (vuser, internalId).
 * failed → flag 0x8000 plus some error text.
 */
function txRecord({ ts, iter, rtMs, vuser, internalId, mapId = null, failed = false, wasted = 0, think = 0, parent = 0, seq = 1 }) {
  let flags = 0;
  const parts = [];
  if (mapId != null) { flags |= 0x01; parts.push(textField(String(mapId))); }
  if (wasted) { flags |= 0x10; const w = Buffer.alloc(8); w.writeDoubleBE(wasted, 0); parts.push(w); }
  if (think) { flags |= 0x20; const t = Buffer.alloc(8); t.writeDoubleBE(think, 0); parts.push(t); }
  if (failed) flags |= 0x8000;
  const f = Buffer.alloc(48);
  f.writeDoubleBE(ts - rtMs / 1000 - wasted - think, 0);
  f.writeDoubleBE(ts, 8);
  f.writeUInt32BE(seq, 16); f.writeUInt32BE(parent, 20); f.writeUInt32BE(internalId, 24); f.writeUInt32BE(vuser, 28);
  f.writeUInt32BE(failed ? 20 : 12, 32); f.writeUInt32BE(failed ? 7 : 1, 36); f.writeUInt32BE(iter, 40);
  parts.push(f);
  if (failed) parts.push(textField("Error -26612: HTTP 500"));
  return envelope(Buffer.concat(parts), TX_BASE + flags);
}

/**
 * Data-point record. With mapId → sub-type 766 (registration + sample), otherwise 762 (sample):
 *   762: +28 ts · +36 seq · +40 0 · +44 f64 value · +52 vuser · +56 internal id · +60 0
 */
function dataPoint({ ts, vuser, internalId, mapId = null, value = 1, seq = 0 }) {
  const tail = Buffer.alloc(28);
  tail.writeUInt32BE(seq, 0); tail.writeDoubleBE(value, 8); tail.writeUInt32BE(vuser, 16); tail.writeUInt32BE(internalId, 20);
  const t = Buffer.alloc(8); t.writeDoubleBE(ts, 0);
  if (mapId != null) return envelope(Buffer.concat([t, textField(String(mapId)), tail]), 766);
  return envelope(Buffer.concat([t, tail]), 762);
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
  // Internal ids are per VUser: VUser 1 registers 1 → T01_LOGIN (map 1), 2 → T02_SUBMIT (map 2);
  // VUser 2 registers them the other way round (1 → map 2, 2 → map 1), as happens in real runs.
  // VUser 1 runs at t+10, VUser 2 at t+15 → steady t+15 … first exit t+400
  const internalOf = { 1: { 1: 1, 2: 2 }, 2: { 1: 2, 2: 1 } }; // vuser → map id → internal id
  for (let it = 0; it < 3; it++) {
    for (const v of [1, 2]) {
      const base = START + 20 + it * 100 + v;
      const first = it === 0;
      recs.push(txRecord({ ts: base, iter: it, rtMs: 1000 + it * 100 + v, vuser: v, internalId: internalOf[v][1], mapId: first ? 1 : null, think: v === 1 && it === 1 ? 0.5 : 0 }));
      recs.push(txRecord({ ts: base + 5, iter: it, rtMs: 2000 + it * 10, vuser: v, internalId: internalOf[v][2], mapId: first ? 2 : null, wasted: it === 2 ? 0.25 : 0 }));
      recs.push(dataPoint({ ts: base + 1, vuser: v, internalId: 7, mapId: first ? 2 : null, seq: it, value: 3 }));
    }
    recs.push(otherRecord(72, 63, 0x41)); // record with ASCII payload ("AAAA…")
  }
  recs.push(txRecord({ ts: START + 30, iter: 3, rtMs: -5, vuser: 1, internalId: 1, failed: true })); // failed, negative RT
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
