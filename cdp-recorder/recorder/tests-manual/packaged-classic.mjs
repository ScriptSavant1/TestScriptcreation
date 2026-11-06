// The packaged .exe started by hand (double-click — no link): the classic way must work as it always did.
// Toolbar Start Recording → transaction → Stop asks for a file name inside the toolbar → saved in the output folder
// → the classic "Recording complete — Download HAR / New Recording" card (not the PerfX Studio one) → Quit closes.
// The recording window shows its landing page, so a test page is opened in it through its DevTools port.
//
// Run from cdp-recorder/recorder/ after `npm run build:exe`:  node tests-manual/packaged-classic.mjs
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";

const UI = 8795;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const check = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} - ${m}`); if (!c) failures.push(m); };

const site = createServer((req, res) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<h1>Test</h1><script>fetch('/api/hello')</script>"); });
await new Promise((r) => site.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${site.address().port}`;
const out = mkdtempSync(join(tmpdir(), "cdp-classic-"));
const exe = join(process.cwd(), "dist", "cdp-recorder.exe");
const app = spawn(exe, ["--ui-port", String(UI), "--out", out], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
app.stdout.on("data", (d) => (log += d));
app.stderr.on("data", (d) => (log += d));

const b = await chromium.launch({ channel: "msedge" });
try {
  let st = null;
  for (let i = 0; i < 120 && !(st && st.connected); i++) { await wait(250); try { st = await (await fetch(`http://127.0.0.1:${UI}/api/status`)).json(); } catch { /* starting */ } }
  check(st && st.mode === "classic" && st.connected, "double-click start: classic mode, recording window open");
  const tb = await b.newPage({ viewport: { width: 300, height: 480 } });
  await tb.goto(`http://localhost:${UI}/`);
  await tb.click("#btnStart");
  await tb.waitForSelector("#settledPill:not(.hidden)", { timeout: 25000 });
  await tb.fill("#txNameInput", "T01_Open");
  await tb.click("#btnStartTx");
  await tb.waitForSelector("#btnEndTx:not(.hidden)");
  // browse in the recording window: open the test page through the recording browser's own DevTools endpoint
  const prof = readdirSync(tmpdir()).filter((d) => d.startsWith("cdp-recorder-")).map((d) => join(tmpdir(), d));
  let port = 0;
  for (const p of prof) { try { const n = Number(readFileSync(join(p, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]); if (n) { const r = await fetch(`http://127.0.0.1:${n}/json/version`).catch(() => null); if (r && r.ok && (await fetch(`http://127.0.0.1:${n}/json/list`).then((x) => x.text())).includes("RECORDING")) { port = n; break; } } } catch { /* not this one */ } }
  check(port > 0, "found the recording window");
  if (port) await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(base + "/")}`, { method: "PUT" });
  await wait(2500);
  await tb.click("#btnEndTx");
  await wait(500);
  await tb.click("#btnStop");
  await tb.waitForSelector("#askCard:not(.hidden)");
  check(true, "Stop asks for the file name inside the toolbar");
  await tb.fill("#askInput", "classic-test.har");
  await tb.click("#askOk");
  await tb.waitForSelector("#harReadyCard:not(.hidden)", { timeout: 20000 });
  check(await tb.isVisible("#btnDownload") && await tb.isVisible("#btnNewRecording") && await tb.isHidden("#savedCard"),
    "classic card: Recording complete — Download HAR / New Recording (not the PerfX Studio card)");
  check(await tb.isVisible("#btnStart"), "Start Recording offered again for the next recording");
  const har = JSON.parse(readFileSync(join(out, "classic-test.har"), "utf8"));
  check(har.log.entries.some((e) => e.request.url === base + "/api/hello") && (har.log.pages || []).some((p) => p.title === "T01_Open"),
    `saved next to the program / --out folder with the request and transaction T01_Open (${har.log.entries.length} entries)`);
  const stillOpen = (await (await fetch(`http://127.0.0.1:${UI}/api/status`)).json()).connected;
  await wait(3000);
  check(stillOpen && (await (await fetch(`http://127.0.0.1:${UI}/api/status`)).json()).connected, "windows stay open after Stop (no countdown in the classic way)");
  await tb.click("#btnQuit");
  await tb.waitForSelector("#askCard:not(.hidden)");
  await tb.click("#askOk");
  const exited = await Promise.race([new Promise((r) => app.on("exit", () => r(true))), wait(20000).then(() => false)]);
  check(exited, "Quit closes the recorder");
} catch (err) {
  check(false, "test crashed: " + err.stack);
} finally {
  if (app.exitCode === null) app.kill();
  await b.close(); site.close();
  await wait(800);
  rmSync(out, { recursive: true, force: true });
}
if (failures.length) console.log("\n--- recorder output ---\n" + log);
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
