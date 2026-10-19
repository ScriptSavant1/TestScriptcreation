"use strict";

/**
 * Transactions shared by several scripts (e.g. Login) are reported per script — as LRE's
 * per-group figures (Event_meter grouped by Group Name + Event Name) — not as the all-scripts
 * total repeated under every script. Also: Count = pass + fail, P98, error rows = Main.Type 2.
 */
const { analyse } = require("../engine/analyse");
const errors = require("../engine/errors");
const format = require("../report/format");
const { txRecord, header, memorySource, START } = require("./helpers");

function textField(s) {
  const n = Buffer.byteLength(s, "latin1");
  const b = Buffer.alloc(4 + Math.ceil(n / 4) * 4);
  b.writeUInt32BE(n, 0); b.write(s, 4, "latin1");
  return b;
}
/** VUser descriptor (sub-type 63): +28 u32 RawData.eve VUser id, then text fields local, group, script, ?, host. */
function vuserDesc(vuser, local, group, script, host) {
  const body = Buffer.concat([Buffer.alloc(4), textField(local), textField(group), textField(script), textField("x"), textField(host)]);
  body.writeUInt32BE(vuser, 0);
  const len = 28 + body.length;
  const b = Buffer.alloc(len);
  b.writeUInt32BE(len, 0); b.writeUInt32BE(3, 4); b.writeUInt32BE(len - 12, 12); b.writeUInt32BE(len - 20, 20); b.writeUInt32BE(63, 24);
  body.copy(b, 28);
  return b;
}

/**
 * Two scripts, one VUser each. Both groups number their VUser "1" (per-group numbering in
 * _t_rep.eve); RawData.eve uses ids 101 / 102 and the descriptors tie them together.
 * Script A: T01_LOGIN 1.0 s ×3, T03_A 3.0 s ×3.  Script B: T01_LOGIN 2.0 s ×3 (+1 failed), T04_B 4.0 s ×3.
 */
function twoScriptRun() {
  const recs = [header(), vuserDesc(101, "1", "grp_a", "script_a", "lg1"), vuserDesc(102, "1", "grp_b", "script_b", "lg2")];
  for (let it = 0; it < 3; it++) {
    const t = START + 30 + it * 60;
    recs.push(txRecord({ ts: t, iter: it, rtMs: 1000, vuser: 101, internalId: 1, mapId: it === 0 ? 1 : null }));
    recs.push(txRecord({ ts: t + 5, iter: it, rtMs: 3000, vuser: 101, internalId: 2, mapId: it === 0 ? 3 : null }));
    recs.push(txRecord({ ts: t + 1, iter: it, rtMs: 2000, vuser: 102, internalId: 1, mapId: it === 0 ? 1 : null }));
    recs.push(txRecord({ ts: t + 6, iter: it, rtMs: 4000, vuser: 102, internalId: 2, mapId: it === 0 ? 4 : null }));
  }
  recs.push(txRecord({ ts: START + 250, iter: 3, rtMs: 500, vuser: 102, internalId: 1, failed: true }));
  const trep = [
    `28 11 ${START} 2 1 1 1`,
    `28 4 grp_a 1 ${START + 5} 0 Script_A_1 lg1.example.test 0 1`, `28 2 grp_a 1 ${START + 10} 0 p 0 0`,
    `28 4 grp_b 1 ${START + 6} 0 Script_B_1 lg2.example.test 0 1`, `28 2 grp_b 1 ${START + 15} 0 p 0 0`,
    `28 1 grp_a 1 ${START + 300} 0 2`, `28 1 grp_b 1 ${START + 305} 0 2`, `28 12 ${START + 310} 1 ${START + 310} 0 9`,
  ].join("\r\n");
  const usr = (tx) => `[General]\r\nType=DevWeb\r\n[TransactionsOrder]\r\nOrder="${tx.join("__*delimiter*__")}"\r\n`;
  return {
    "R/RawData.eve": Buffer.concat(recs),
    "R/_t_rep.eve": trep,
    "R/RunInfo.ini": "[Report]\r\nSessionName=Two_Scripts\r\n",
    "R/res1.lrr": ["[Scenario]", `Start_time=${START}`, `Stop_time=${START + 310}`, "Time_Zone=0", "Daylight_Bias=0",
      "[Scenario_summary]", "Global Schedule=ST2_1E5;R200;SP2_1E5;",
      "[Scripts]", "Script_A_1=D:\\s\\Script_A\\Script_A.usr", "Script_B_1=D:\\s\\Script_B\\Script_B.usr",
      "[Scripts_types]", "Script_A_1=DevWeb", "Script_B_1=DevWeb"].join("\r\n"),
    "R/RawData.map": '[END_TRANSACTION]\r\n1="T01_LOGIN"\r\n3="T03_A"\r\n4="T04_B"\r\n',
    "R/script_a_1.usr": usr(["T01_LOGIN", "T03_A"]),
    "R/script_b_1.usr": usr(["T01_LOGIN", "T04_B"]),
  };
}

describe("per-script statistics for shared transactions", () => {
  let m;
  beforeAll(async () => { m = await analyse(memorySource(twoScriptRun())); });

  test("Login gets one row per script with that script's own figures", () => {
    const logins = m.transactions.filter((t) => t.name === "T01_LOGIN");
    expect(logins.map((t) => [t.script, t.pass, t.fail, t.count, +t.full.avg.toFixed(6)])).toEqual([
      ["Script_A_1", 3, 0, 3, 1],
      ["Script_B_1", 3, 1, 4, 2],
    ]);
    expect(logins.map((t) => t.label)).toEqual(["T01_LOGIN (Script_A_1)", "T01_LOGIN (Script_B_1)"]);
    expect(m.transactions.find((t) => t.name === "T03_A").label).toBe("T03_A"); // used by one script → plain name
  });

  test("script groups hold only their own rows, so subtotals add up", () => {
    const groups = format.groupByScript(m);
    expect(groups.map((g) => [g.script, g.rows.map((t) => t.name).sort()])).toEqual([
      ["Script_A_1", ["T01_LOGIN", "T03_A"]],
      ["Script_B_1", ["T01_LOGIN", "T04_B"]],
    ]);
    const sub = (s) => groups.find((g) => g.script === s).rows.reduce((a, t) => a + t.count, 0);
    expect(sub("Script_A_1") + sub("Script_B_1")).toBe(m.totals.samples + 1); // 12 passed + 1 failed
    expect(m.workload.map((s) => [s.key, s.samples])).toEqual([["Script_A_1", 6], ["Script_B_1", 6]]);
    expect(m.selfCheck.find((c) => c.id === "tx-script" && /several scripts/.test(c.text)).data).toEqual(["T01_LOGIN"]);
  });

  test("P98 is reported", () => {
    expect(Object.keys(m.transactions[0].full.p)).toEqual(["p50", "p80", "p85", "p90", "p95", "p98", "p99"]);
  });
});

describe("errors: Main.Type 2 rows are errors", () => {
  test("other message types are excluded and counted separately", () => {
    const rows = [
      { code: -26612, type: 2, time: "2023-11-14 23:15:00", message: "HTTP 500" },
      { code: -26612, type: 2, time: "2023-11-14 23:16:00", message: "HTTP 500" },
      { code: -17999, type: 1, time: "2023-11-14 23:17:00", message: "Warning: slow" },
    ];
    const s = errors.summarise(rows, 0, START);
    expect(s.total).toBe(2);
    expect(s.otherByType).toEqual({ 1: 1 });
    expect(s.typeFilter).toMatch(/Type = 2/);
  });
  test("files without Type 2 rows keep every row", () => {
    const s = errors.summarise([{ code: 1, type: 0, message: "x" }, { code: 2, type: null, message: "y" }], 0, START);
    expect(s.total).toBe(2);
    expect(s.typeFilter).toMatch(/all rows/);
  });
});
