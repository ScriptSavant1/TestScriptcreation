// Captures real screenshots of the CDP Recorder UI for the end-user guide
// (Docs/user/CDP-RECORDER-USER-GUIDE.html). Drives the actual recorder,
// toolbar page and recording browser through a normal session.
//
// Usage (from cdp-recorder/recorder/):
//   node --import tsx tests-manual/capture-guide-screenshots.mjs <outDir> [studioUrl]
// studioUrl (optional, e.g. http://localhost:3000/converter/studio) adds a
// Script Studio screenshot — the web app must already be running.
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Recorder } from "../src/recorder.ts";
import { startServer } from "../src/server.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const outDir = process.argv[2];
const studioUrl = process.argv[3];
mkdirSync(outDir, { recursive: true });

const APP_CSS = `body{font-family:Segoe UI,Arial,sans-serif;margin:0;background:#f4f6f9;color:#1f2937}
header{background:#1e3a5f;color:#fff;padding:14px 28px;font-size:18px;font-weight:600}
main{padding:28px;max-width:760px}.card{background:#fff;border:1px solid #dde3ea;border-radius:8px;padding:20px;margin-bottom:16px}
input{padding:8px;border:1px solid #c7d0db;border-radius:6px;width:240px;margin:6px 0}
button{background:#2563eb;color:#fff;border:0;border-radius:6px;padding:9px 18px;font-weight:600}`;

function startFixture() {
  const s = createServer((req, res) => {
    if (req.url === "/" || req.url === "/login") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><head><title>Sample App</title><style>${APP_CSS}</style></head><body>
        <header>Sample Application</header><main><div class="card"><h2 style="margin-top:0">Sign in</h2>
        <div><input placeholder="Username" value="test.user"></div><div><input type="password" value="secret123"></div>
        <button id="signin" onclick="fetch('/api/login',{method:'POST',body:'{}'}).then(()=>location.href='/home')">Sign in</button></div>
        </main><script>fetch('/api/config')</script></body></html>`);
      return;
    }
    if (req.url === "/home") {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<!doctype html><html><head><title>Sample App</title><style>${APP_CSS}</style></head><body>
        <header>Sample Application</header><main><div class="card"><h2 style="margin-top:0">Search records</h2>
        <input id="q" value="order 1042"> <button id="search" onclick="fetch('/api/search?q=1042')">Search</button></div></main>
        <script>fetch('/api/profile')</script></body></html>`);
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end('{"ok":true}');
  });
  return new Promise((r) => s.listen(0, "127.0.0.1", () => r(s)));
}

const fixture = await startFixture();
const base = `http://127.0.0.1:${fixture.address().port}`;
const harDir = mkdtempSync(join(tmpdir(), "cdp-guide-"));

const recorder = new Recorder();
await recorder.connect({ kind: "temp" }, 9446, "auto");
const ui = startServer(recorder, harDir, 8797, readFileSync(join(__dirname, "../src/control-page.html"), "utf8"));

const recBrowser = await chromium.connectOverCDP("http://127.0.0.1:9446");
const recContext = recBrowser.contexts()[0];
const recPage = recContext.pages().find((p) => p.url().startsWith("data:")) || recContext.pages()[0];
await recPage.setViewportSize({ width: 1100, height: 600 });

const tbBrowser = await chromium.launch({ channel: "msedge" });
const tb = await tbBrowser.newPage({ viewport: { width: 300, height: 480 }, deviceScaleFactor: 2 });
await tb.goto("http://127.0.0.1:8797/");
const shot = async (page, name) => {
  if (page !== tb) return page.screenshot({ path: join(outDir, name) });
  // Crop the toolbar to its visible content instead of the full 480px window.
  const bottom = await page.evaluate(() =>
    Math.max(...[...document.body.children].filter((e) => e.offsetParent !== null).map((e) => e.getBoundingClientRect().bottom)),
  );
  return page.screenshot({ path: join(outDir, name), clip: { x: 0, y: 0, width: 300, height: Math.min(480, Math.ceil(bottom) + 10) } });
};

await tb.waitForTimeout(800);
await shot(tb, "01-toolbar-idle.png");
await shot(recPage, "02-recording-window.png");

await tb.click("#btnStart");
await tb.waitForSelector("#btnStartTx:not([disabled]):not(.hidden)", { timeout: 25000 });
await tb.waitForSelector("#settledPill:not(.hidden)");
await tb.fill("#txNameInput", "Login");
await shot(tb, "03-toolbar-ready.png");

await tb.click("#btnStartTx");
await tb.waitForSelector("#btnEndTx:not(.hidden)");
await recPage.goto(`${base}/login`);
await recPage.waitForLoadState("networkidle");
await tb.waitForTimeout(1200);
await shot(tb, "04-toolbar-in-transaction.png");
await shot(recPage, "05-recording-app.png");
await recPage.click("#signin");
await recPage.waitForURL("**/home");
await recPage.waitForLoadState("networkidle");
await tb.click("#btnEndTx");
await tb.waitForSelector("#btnStartTx:not(.hidden)");

await tb.fill("#txNameInput", "Search");
await tb.click("#btnStartTx");
await tb.waitForSelector("#btnEndTx:not(.hidden)");
await recPage.click("#search");
await recPage.waitForTimeout(800);
await tb.click("#btnEndTx");
await tb.waitForSelector("#btnStartTx:not(.hidden)");
await tb.waitForTimeout(1200);
await shot(tb, "06-toolbar-trail.png");

await tb.fill("#txNameInput", "Logout");
await tb.click("#btnStartTx");
await tb.waitForSelector("#btnEndTx:not(.hidden)");
await tb.waitForTimeout(1500); // nothing done in the recording window
await tb.click("#btnEndTx");
await tb.waitForSelector("#warningBanner:not(.hidden)", { timeout: 5000 });
await shot(tb, "07-toolbar-warning.png");

tb.once("dialog", (d) => d.accept("my-recording.har"));
await tb.click("#btnStop");
await tb.waitForSelector("#harReadyCard:not(.hidden)", { timeout: 20000 });
await tb.waitForTimeout(600);
await shot(tb, "08-toolbar-complete.png");
copyFileSync(join(harDir, "my-recording.har"), join(outDir, "my-recording.har"));

if (studioUrl) {
  const st = await tbBrowser.newPage({ viewport: { width: 1400, height: 860 } });
  await st.goto(studioUrl);
  await st.setInputFiles('input[type="file"] >> nth=0', join(outDir, "my-recording.har"));
  await st.waitForSelector("#btn-analyze:not([disabled])");
  await shot(st, "09-studio-upload.png");
  await st.click("#btn-analyze");
  await st.waitForFunction(() => typeof S !== "undefined" && S.scripts && Object.keys(S.scripts).length > 0, null, { timeout: 30000 });
  await st.waitForTimeout(1500);
  await shot(st, "10-studio-result.png");
}

await tbBrowser.close();
await recBrowser.close().catch(() => {});
ui.close();
await recorder.shutdown();
fixture.close();
console.log("Screenshots written to", outDir);
process.exit(0);
