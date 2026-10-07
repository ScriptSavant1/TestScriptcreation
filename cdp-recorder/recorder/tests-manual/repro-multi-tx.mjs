// End-to-end Playwright test of the REAL recorder (Recorder + cdp-capture +
// har-builder + server.ts + control-page.html), driven exactly the way a
// user would: toolbar buttons for Start Recording / Start Transaction /
// End Transaction / Stop, and browsing inside the CDP-attached recording
// window (including a link that opens a NEW TAB).
//
// Scenarios:
//   A. Correct usage — 3 transactions, each with captured requests, one
//      spanning a new tab. Expect 3 pages, all non-empty, no warning.
//   B. Wrong-window usage (the real-world bug report) — a transaction where
//      nothing happens in the recording window. Expect the toolbar to show
//      the "No network requests were captured" warning banner.
//   C. The recording window's landing page shows the "RECORDING window"
//      instructions and is NOT itself captured in the HAR.
//
// Run from cdp-recorder/recorder/:  node --import tsx tests-manual/repro-multi-tx.mjs
import { createServer } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Recorder } from "../src/recorder.ts";
import { startServer } from "../src/server.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CDP_PORT = 9444;
const UI_PORT = 8799;
const failures = [];
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} - ${msg}`); if (!cond) failures.push(msg); };

function startFixtureServer() {
  const server = createServer((req, res) => {
    if (req.url === "/page-a") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><body><h1>Page A</h1><img src="/img.png">
        <a id="newtab" href="/page-b" target="_blank">Open Page B in new tab</a>
        <script>fetch('/api/ping');</script></body></html>`);
      return;
    }
    if (req.url === "/page-b") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><body><h1>Page B</h1><img src="/img2.png">
        <button id="next" onclick="fetch('/api/next')">Next</button></body></html>`);
      return;
    }
    if (req.url?.endsWith(".png")) { res.writeHead(200, { "Content-Type": "image/png" }); res.end(Buffer.from([0x89, 0x50])); return; }
    if (req.url?.startsWith("/api/")) { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); return; }
    res.writeHead(404); res.end();
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

async function main() {
  const fixture = await startFixtureServer();
  const base = `http://127.0.0.1:${fixture.address().port}`;
  const outDir = mkdtempSync(join(tmpdir(), "cdp-rec-test-"));

  const recorder = new Recorder();
  await recorder.connect({ kind: "temp" }, CDP_PORT, "auto");
  const pageHtml = readFileSync(join(__dirname, "../src/control-page.html"), "utf8");
  const ui = startServer(recorder, outDir, UI_PORT, pageHtml);

  // The recording browser (CDP-attached) and a separate toolbar page.
  const recBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
  const recContext = recBrowser.contexts()[0];
  const recPage = recContext.pages()[0];
  const toolbarBrowser = await chromium.launch({ channel: "msedge" });
  const toolbar = await toolbarBrowser.newPage();
  await toolbar.goto(`http://127.0.0.1:${UI_PORT}/`);

  // ── C. landing page ────────────────────────────────────────────────────
  const landingText = await recPage.textContent("body").catch(() => "");
  check(/This is the RECORDING window/.test(landingText || ""), "recording window shows the 'This is the RECORDING window' landing page");
  check(/RECORDING window/.test(await toolbar.textContent("#notice")), "toolbar notice points the user at the RECORDING window");

  // ── Start recording via the toolbar ────────────────────────────────────
  await toolbar.click("#btnStart");
  await toolbar.waitForSelector("#btnStartTx:not([disabled]):not(.hidden)", { timeout: 25000 });

  async function startTx(name) {
    await toolbar.fill("#txNameInput", name);
    await toolbar.click("#btnStartTx");
    await toolbar.waitForSelector("#btnEndTx:not(.hidden)");
  }
  async function endTx() {
    await toolbar.click("#btnEndTx");
    await toolbar.waitForSelector("#btnStartTx:not(.hidden)");
    await toolbar.waitForTimeout(1200); // one status poll cycle
  }

  // ── A. Correct usage ───────────────────────────────────────────────────
  await startTx("Launch");
  await recPage.goto(`${base}/page-a`);
  await recPage.waitForLoadState("networkidle");
  await endTx();
  check(await toolbar.isHidden("#warningBanner"), "no warning after a transaction that captured requests");

  await startTx("role_group");
  const [newTab] = await Promise.all([recContext.waitForEvent("page"), recPage.click("#newtab")]);
  await newTab.waitForLoadState("networkidle");
  await endTx();

  await startTx("Click Next");
  await newTab.click("#next");
  await newTab.waitForTimeout(800);
  await endTx();

  // ── B. Wrong-window usage: nothing happens in the recording window ─────
  await startTx("Wrong Window");
  await toolbar.waitForTimeout(1500); // user is busy clicking in some OTHER browser
  await endTx();
  const warning = (await toolbar.textContent("#warningBanner")) || "";
  check(await toolbar.isVisible("#warningBanner"), "warning banner visible after a transaction with zero captured requests");
  check(/No network requests were captured during "Wrong Window"/.test(warning), "warning names the empty transaction");

  // ── Stop via the toolbar ───────────────────────────────────────────────
  toolbar.once("dialog", (d) => d.accept("recording-test.har"));
  await toolbar.click("#btnStop");
  await toolbar.waitForSelector("#harReadyCard:not(.hidden)", { timeout: 20000 });

  const har = JSON.parse(readFileSync(join(outDir, "recording-test.har"), "utf8"));
  console.log("\nHAR pages:");
  for (const p of har.log.pages) console.log(`  ${p.id} "${p.title}" -> ${har.log.entries.filter((e) => e.pageref === p.id).length} entries`);

  const countFor = (title) => {
    const p = har.log.pages.find((x) => x.title === title);
    return p ? har.log.entries.filter((e) => e.pageref === p.id).length : -1;
  };
  check(har.log.pages.length === 4, "HAR has all 4 transactions as pages");
  check(countFor("Launch") >= 3, "Launch captured page-a + its sub-requests");
  check(countFor("role_group") >= 1, "role_group captured the new-tab page load");
  check(countFor("Click Next") >= 1, "Click Next captured the button's fetch in the new tab");
  check(countFor("Wrong Window") === 0, "Wrong Window has zero entries (as it genuinely should)");
  check(!har.log.entries.some((e) => e.request.url.startsWith("data:")), "landing page (data: URL) is not in the HAR");
  check(har.log.entries.every((e) => e.pageref), "every captured request is tagged to a transaction");

  await toolbarBrowser.close();
  await recBrowser.close().catch(() => {});
  ui.close();
  await recorder.shutdown();
  fixture.close();

  console.log(failures.length ? `\nRESULT: FAIL (${failures.length})` : "\nRESULT: ALL PASS");
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => { console.error("FATAL:", err); process.exit(1); });
