const fs = require("fs");
const os = require("os");
const path = require("path");
const { resolveCdpRecorderDownload } = require("../../src/web/cdpRecorderDownload");

describe("resolveCdpRecorderDownload", () => {
  let dist;
  beforeEach(() => { dist = fs.mkdtempSync(path.join(os.tmpdir(), "cdp-dist-")); });
  afterEach(() => { fs.rmSync(dist, { recursive: true, force: true }); });
  const touch = (name) => fs.writeFileSync(path.join(dist, name), "x");

  test("serves the zip when only the zip is present (new deployments)", () => {
    touch("cdp-recorder.zip");
    expect(resolveCdpRecorderDownload(dist)).toEqual({ filePath: path.join(dist, "cdp-recorder.zip"), fileName: "cdp-recorder.zip" });
  });

  test("prefers the zip when both are present", () => {
    touch("cdp-recorder.exe");
    touch("cdp-recorder.zip");
    expect(resolveCdpRecorderDownload(dist).fileName).toBe("cdp-recorder.zip");
  });

  test("falls back to the exe on servers deployed before the zip existed", () => {
    touch("cdp-recorder.exe");
    expect(resolveCdpRecorderDownload(dist)).toEqual({ filePath: path.join(dist, "cdp-recorder.exe"), fileName: "cdp-recorder.exe" });
  });

  test("returns null when nothing has been built or copied", () => {
    expect(resolveCdpRecorderDownload(dist)).toBeNull();
  });

  test("returns null when the dist folder itself is missing", () => {
    expect(resolveCdpRecorderDownload(path.join(dist, "does-not-exist"))).toBeNull();
  });
});
