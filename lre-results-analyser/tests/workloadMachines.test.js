"use strict";
// Workload tab: machines that run no VUsers read N/A, the per-machine detail (side panel), and no per-VUser list in Excel.
const ExcelJS = require("exceljs");
const fmt = require("../report/format");
const charts = require("../report/charts");
const { analyse } = require("../engine/analyse");
const { buildWorkbook } = require("../report/xlsx");
const { sampleRun, memorySource } = require("./helpers");

describe("isLoadGenerator — only machines that ran VUsers", () => {
  test("the Controller and monitored-only hosts are not load generators", () => {
    expect(fmt.isLoadGenerator({ role: "load generator", vusers: 12 })).toBe(true);
    expect(fmt.isLoadGenerator({ role: "controller", vusers: 0 })).toBe(false);
    expect(fmt.isLoadGenerator({ role: "controller", vusers: 3 })).toBe(false);
    expect(fmt.isLoadGenerator({ role: "monitored host (no VUsers)", vusers: 0 })).toBe(false);
  });
});

describe("machineDetail — one load generator's scripts", () => {
  const m = {
    vusers: [
      { group: "g1", vuser: 1, script: "S_Search", lg: "LG1.example.test", iterations: 10, samples: 40, avgRt: 1.0 },
      { group: "g1", vuser: 2, script: "S_Search", lg: "lg1.example.test", iterations: 8, samples: 10, avgRt: 2.0 },
      { group: "g2", vuser: 3, script: "S_Login", lg: "lg1.example.test", iterations: 5, samples: 0, avgRt: null },
      { group: "g1", vuser: 4, script: "S_Search", lg: "lg2.example.test", iterations: 99, samples: 99, avgRt: 9 },
    ],
    lifecycle: { earlyExits: [
      { group: "g1", vuser: 2, script: "S_Search", lg: "lg1.example.test", exitRelSec: 500, duringRampUp: false },
      { group: "g1", vuser: 4, script: "S_Search", lg: "lg2.example.test", exitRelSec: 100, duringRampUp: true },
    ] },
  };
  test("per script on that machine only: VUsers, iterations, stopped early, response time weighted by transactions", () => {
    const d = fmt.machineDetail(m, "lg1.example.test");
    expect(d.scripts).toEqual([
      { script: "S_Search", vusers: 2, iterations: 18, early: 1, avgRt: (1.0 * 40 + 2.0 * 10) / 50 },
      { script: "S_Login", vusers: 1, iterations: 5, early: 0, avgRt: null },
    ]);
    expect(d.early).toEqual([{ vuser: 2, group: "g1", script: "S_Search", exitRelSec: 500, duringRampUp: false }]);
  });
  test("an unknown machine or a run without per-VUser figures gives nothing", () => {
    expect(fmt.machineDetail(m, "nope")).toEqual({ scripts: [], early: [] });
    expect(fmt.machineDetail({}, "lg1")).toEqual({ scripts: [], early: [] });
  });
});

describe("lgHealth — one machine's CPU and memory", () => {
  const m = { timeline: { bucketSec: 5, buckets: 2 }, lgHealth: [
    { host: "lg1", cpu: { series: [10, 20] }, memory: { series: [30, 31] } },
    { host: "lg2", cpu: { series: [50, 60] } },
  ] };
  test("only that machine, matched by its full or short name", () => {
    const one = charts.lgHealth(m, { static: true }, "lg1.example.test");
    expect(one.series.map((s) => s.name)).toEqual(["lg1 CPU", "lg1 memory"]);
    expect(charts.lgHealth(m, { static: true }).series).toHaveLength(3);
    expect(charts.lgHealth(m, { static: true }, "other.example.test")).toBeNull();
  });
});

describe("Excel Workload Model sheet", () => {
  test("no per-VUser list; the Controller reads N/A for VUsers and Scripts", async () => {
    const m = await analyse(memorySource(sampleRun()));
    m.lgs.push({ name: "ctrl.example.test", ip: null, vusers: 0, scripts: [], role: "controller", cpuPeak: 20, memPeak: 30 });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await buildWorkbook(m, ExcelJS).xlsx.writeBuffer());
    const ws = wb.getWorksheet("Workload Model");
    const rows = [];
    ws.eachRow((r) => rows.push(r.values.slice(1)));
    expect(rows.some((r) => r[0] === "VUsers")).toBe(false); // the per-VUser block is gone
    expect(rows.some((r) => r[0] === "Group" && r[1] === "VUser")).toBe(false);
    const ctrl = rows.find((r) => r[0] === "ctrl.example.test");
    expect(ctrl.slice(2, 5)).toEqual(["Controller", "N/A", "N/A"]);
    expect(ctrl[7]).toBe("N/A");
    const lg = rows.find((r) => r[0] === "lg1.example.test");
    expect(lg.slice(2, 5)).toEqual(["Load generator", 1, 1]);
  });
});
