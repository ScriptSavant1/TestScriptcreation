"use strict";

const text = require("../engine/text");
const ini = require("../engine/ini");
const files = require("../engine/files");
const scenario = require("../engine/scenario");
const trep = require("../engine/trep");
const runlogic = require("../engine/runlogic");
const rawmap = require("../engine/rawmap");
const sla = require("../engine/sla");
const collate = require("../engine/collate");
const { sampleRun, START } = require("./helpers");

describe("text.decode", () => {
  test("UTF-8 with and without BOM, UTF-16LE, strings", () => {
    expect(text.decode(Buffer.from([0xef, 0xbb, 0xbf, 0x41]))).toBe("A");
    expect(text.decode(Buffer.from("héllo", "utf8"))).toBe("héllo");
    expect(text.decode(Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("ab", "utf16le")]))).toBe("ab");
    expect(text.decode("\ufeffx")).toBe("x");
    expect(text.decode(null)).toBe("");
  });
});

describe("ini.parse", () => {
  const p = ini.parse('top=1\r\n; comment\r\n[Sec A]\r\nKey="quoted"\r\nSched=ST1_1E5;R60;\r\nEq=a=b\r\n[Sec A]\r\nMore=2\r\n');
  test("sections, quotes, '=' and ';' in values, case-insensitive look-up", () => {
    expect(p.get("", "top")).toBe("1");
    expect(p.get("sec a", "key")).toBe("quoted");
    expect(p.get("Sec A", "Sched")).toBe("ST1_1E5;R60;");
    expect(p.get("Sec A", "Eq")).toBe("a=b");
    expect(p.get("Sec A", "More")).toBe("2"); // repeated section merges
    expect(p.get("Nope", "x")).toBeUndefined();
  });
  test("entries keep file order", () => {
    expect(p.section("sec a").entries.map((e) => e[0])).toEqual(["Key", "Sched", "Eq", "More"]);
  });
});

describe("files.discover", () => {
  test("root under a top folder, .bak only as fallback, case-insensitive fixed names", () => {
    const d = files.discover(["Res9/rawdata.EVE", "Res9/res9.lrr", "Res9/a.cfg", "Res9/a.cfg.bak", "Res9/a.usr.bak", "Res9/b.usr", "Res9/b.usr.bak",
      "Res9/a.usp", "Res9/sqliteDB.db", "Res9/sum_data/graph_3.dat", "other/readme.txt"]);
    expect(d.root).toBe("Res9/");
    expect(d.files.rawDataEve).toBe("Res9/rawdata.EVE");
    expect(d.files.sqlite).toBe("Res9/sqliteDB.db");
    expect(d.files.lrr).toBe("Res9/res9.lrr");
    expect(d.cfgs).toEqual(["Res9/a.cfg"]);
    expect(d.usrs.sort()).toEqual(["Res9/a.usr.bak", "Res9/b.usr"]);
    expect(d.graphs).toEqual(["Res9/sum_data/graph_3.dat"]);
    expect(d.requiredMissing).toEqual(["RawData.map", "RunInfo.ini", "_t_rep.eve"]);
  });
  test("no top folder; backslash paths", () => {
    const d = files.discover(["RawData.eve", "sub\\x.txt", "res1.lrr"]);
    expect(d.root).toBe("");
    expect(d.files.lrr).toBe("res1.lrr");
  });
  test("stem strips script-file extensions", () => {
    expect(files.stem("x/Script_A_1.usr.bak")).toBe("script_a_1");
  });
});

describe("scenario", () => {
  test("parseRunDate handles 12 AM / 12 PM", () => {
    expect(scenario.parseRunDate("1-January-2024 12:00:00 AM")).toBe(Date.UTC(2024, 0, 1, 0) / 1000);
    expect(scenario.parseRunDate("1-January-2024 12:30:00 PM")).toBe(Date.UTC(2024, 0, 1, 12, 30) / 1000);
    expect(scenario.parseRunDate("garbage")).toBeNull();
  });
  test("parseSchedule: known tokens + unknown kept raw", () => {
    const s = scenario.parseSchedule("ST27_1E5;R28800;SP27_1E5;XYZ9;");
    expect(s.steps.map((x) => x.kind)).toEqual(["start", "run", "stop"]);
    expect(s.steps[0]).toMatchObject({ vusers: 27, batch: 1, everySec: 5 });
    expect(s.unparsed).toEqual(["XYZ9"]);
  });
  test("local offset: UK summer time (Time_Zone=0, Daylight_Bias=-60) confirmed by RunDate", () => {
    const run = sampleRun();
    const m = scenario.parse(run["Res9/RunInfo.ini"], run["Res9/res9.lrr"]);
    // START = 2023-11-14 22:13:20 UTC; RunDate 23:13:00 local → +1 h
    expect(m.localOffsetSec).toBe(3600);
    expect(m.localOffsetConfirmed).toBe(true);
    expect(m.durationSec).toBe(410);
    expect(m.groups).toEqual([{ group: "Script_A_1", scriptPath: "D:\\scripts\\Script_A\\Script_A.usr", scriptName: "Script_A", protocol: "DevWeb" }]);
  });
  test("local offset falls back (unconfirmed) when RunDate does not fit", () => {
    const o = scenario.localOffset("-330", "0", 0, START);
    expect(o).toEqual(expect.objectContaining({ seconds: 19800, confirmed: false }));
  });
  test("local offset for a non-DST zone in minutes (India, Bias -330)", () => {
    const wall = START + 19800 - 30;
    expect(scenario.localOffset("-330", "0", wall, START)).toEqual(expect.objectContaining({ seconds: 19800, confirmed: true }));
  });
});

describe("trep.parse", () => {
  const t = trep.parse(sampleRun()["Res9/_t_rep.eve"]);
  test("lifecycle, LGs and phases", () => {
    expect(t.vusers).toHaveLength(2);
    expect(t.vusers[0]).toMatchObject({ group: "grp_a", vuser: 1, script: "Script_A_1", lg: "lg1.example.test", runTs: START + 10, exitTs: START + 400 });
    expect(t.loadGenerators).toEqual([{ name: "lg1.example.test", connected: 1, vusers: 1 }, { name: "lg2.example.test", connected: 1, vusers: 1 }]);
    expect(t.phases.rampUpEnd).toBe(START + 15);
    expect(t.phases.steady).toEqual({ start: START + 15, end: START + 400, durationSec: 385 });
    expect(t.maxRunning).toBe(2);
    expect(t.unknown).toEqual({ "event 8 (no time, ignored)": 1 });
    expect(t.vuserIdScope).toMatch(/single group/);
  });
  test("VUser numbers reused across groups are detected", () => {
    const x = trep.parse(["28 2 g1 1 100 0 p 0 0", "28 2 g2 1 101 0 p 0 0", "28 1 g1 1 200 0 2", "28 99 x"].join("\n"));
    expect(x.vuserIdScope).toMatch(/per group/);
    expect(x.sharedVuserIds).toEqual([1]);
    expect(x.neverExited).toEqual(["g2#1"]);
    expect(x.unknown["event 99"]).toBe(1);
  });
});

describe("runlogic", () => {
  const usp = (type, extra = "") => `[RunLogicRunRoot]\nRunLogicPaceType=${type}\nRunLogicPaceConstTime=260\nRunLogicRandomPaceMin=60\nRunLogicRandomPaceMax=90\nRunLogicPaceConstAfterTime=30\nRunLogicAfterPaceMin=5\nRunLogicAfterPaceMax=9\n${extra}`;
  test.each([
    ["Const", "fixedInterval", "Start every 260 s"],
    ["Random", "randomInterval", "Start every 60–90 s (random)"],
    ["ConstAfter", "fixedDelay", "30 s after the previous iteration ends"],
    ["RandomAfter", "randomDelay", "5–9 s (random) after the previous iteration ends"],
    ["ASAP", "asap", "As soon as the previous iteration ends"],
    ["Weird", "unknown", 'Unrecognised pace type "Weird"'],
  ])("pacing %s", (type, kind, txt) => {
    expect(runlogic.pacing(usp(type))).toMatchObject({ rawType: type, kind, text: txt });
  });
  test("think time from DevWeb yaml JSON and classic [ThinkTime]", () => {
    expect(runlogic.thinkTime('[DevWebYaml]\nyaml="{"thinkTime":{"type":"asRecorded","limit":3}}"')).toMatchObject({ type: "asRecorded", limit: 3, text: "As recorded (limit 3 s)" });
    expect(runlogic.thinkTime('[DevWebYaml]\nyaml="{"thinkTime":{"type":"ignore"}}"').text).toBe("Ignored");
    expect(runlogic.thinkTime("[ThinkTime]\nOptions=MULTIPLY\nFactor=2\nLimit=10\nLimitFlag=1").text).toBe("Recorded × 2 (limit 10 s)");
    expect(runlogic.thinkTime("[General]\nx=1")).toBeNull();
  });
  test("transactions from TransactionsOrder, else [Transactions]", () => {
    expect(runlogic.transactions('[TransactionsOrder]\nOrder="A__*delimiter*__B"')).toEqual(["A", "B"]);
    expect(runlogic.transactions("[Transactions]\nX=\nY=")).toEqual(["X", "Y"]);
  });
});

describe("rawmap / sla / collate", () => {
  const run = sampleRun();
  test("rawmap keeps sections apart and tolerates order", () => {
    const m = rawmap.parse(run["Res9/RawData.map"]);
    expect(m.txName(1)).toBe("T01_LOGIN");
    expect(m.txName(2)).toBe("T02_SUBMIT");
    expect(m.txName(21)).toBe("TX_21");
    expect(m.dataPoints.get(2)).toBe("HTTP_200");
  });
  test("sla transaction list (BOM-prefixed XML)", () => {
    const s = sla.parse(run["Res9/SLAConfiguration.xml"]);
    expect(s.transactions).toEqual(["T01_LOGIN", "Main_Transaction"]);
    expect(s.trackingPeriodType).toBe("Default");
    expect(s.hasOtherRules).toBe(false);
  });
  test("collate hosts + status", () => {
    const c = collate.parse(run["Res9/collate.txt"], "[Hosts]\nlg3.example.test=x\n[Collate Results]\nVusersResultsZipStatus=Succeeded");
    expect(c.hosts).toEqual(["lg1.example.test", "lg2.example.test", "lg3.example.test"]);
    expect(c.completed).toBe(true);
    expect(c.vusersResultsZipStatus).toBe("Succeeded");
  });
});
