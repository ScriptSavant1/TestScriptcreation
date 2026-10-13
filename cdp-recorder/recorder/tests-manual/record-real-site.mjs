// Record a real site with the REAL CDP recorder (toolbar-driven), for diagnosing
// how page resources end up in generated scripts.
// Run from cdp-recorder/recorder/:  node --import tsx tests-manual/record-real-site.mjs <outDir> <url1> [url2]
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { Recorder } from "../src/recorder.ts";
import { startServer } from "../src/server.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const [outDir, url1, url2] = process.argv.slice(2);
const recorder = new Recorder();
await recorder.connect({ kind: "temp" }, 9445, "auto");
const ui = startServer(recorder, outDir, 8798, readFileSync(join(__dirname, "../src/control-page.html"), "utf8"));
const recBrowser = await chromium.connectOverCDP("http://127.0.0.1:9445");
const recPage = recBrowser.contexts()[0].pages()[0];
const tbBrowser = await chromium.launch({ channel: "msedge" });
const tb = await tbBrowser.newPage();
await tb.goto("http://127.0.0.1:8798/");
await tb.click("#btnStart");
await tb.waitForSelector("#btnStartTx:not([disabled]):not(.hidden)", { timeout: 25000 });
async function tx(name, fn) {
  await tb.fill("#txNameInput", name); await tb.click("#btnStartTx"); await tb.waitForSelector("#btnEndTx:not(.hidden)");
  await fn();
  await tb.click("#btnEndTx"); await tb.waitForSelector("#btnStartTx:not(.hidden)"); await tb.waitForTimeout(1200);
}
await tx("Launch", async () => { await recPage.goto(url1, { waitUntil: "networkidle", timeout: 90000 }); });
if (url2) await tx("Second Page", async () => { await recPage.goto(url2, { waitUntil: "networkidle", timeout: 90000 }); });
tb.once("dialog", (d) => d.accept("real-site.har"));
await tb.click("#btnStop");
await tb.waitForSelector("#harReadyCard:not(.hidden)", { timeout: 60000 });
const har = JSON.parse(readFileSync(join(outDir, "real-site.har"), "utf8"));
console.log("entries:", har.log.entries.length, "pages:", har.log.pages.map((p) => p.title + "=" + har.log.entries.filter((e) => e.pageref === p.id).length).join(", "));
await tbBrowser.close(); await recBrowser.close().catch(() => {}); ui.close(); await recorder.shutdown();
process.exit(0);
