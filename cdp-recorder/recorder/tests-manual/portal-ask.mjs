// End-to-end test: Start recording on the Recorder page when the CDP Recorder was started BY HAND and the
// browser may not start programs (the perfx-recorder: link does nothing). The page asks to be allowed, the
// toolbar shows Allow / Don't allow, Allow is remembered (allowed-pages.json) and works after a restart.
//
// Runs the real recorder from the sources (double-click mode: recording window + toolbar) on a test port, a
// local test site, and the portal page from the local web server (default http://localhost:3999), whose
// record-live.js is pointed at the test port. The perfx-recorder: link is blocked, as on such computers.
//
// Run from cdp-recorder/recorder/:  node tests-manual/portal-ask.mjs [portal-base]
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";

const PORTAL = process.argv[2] || "http://localhost:3999";
const UI = 8798, CDP = 9333;
const API = `http://127.0.0.1:${UI}`;
const failures = [];
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} - ${msg}`); if (!cond) failures.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, origin, body) => {
  const headers = {};
  if (origin) headers.Origin = origin;
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, json };
};

const fixture = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<!doctype html><html><body><h1>Test application</h1><script>fetch('/api/ping')</script></body></html>");
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${fixture.address().port}/home`;
const dir = mkdtempSync(join(tmpdir(), "cdp-ask-test-"));
const allowedFile = join(dir, "allowed-pages.json");

const start = () => {
  const p = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--ui-port", String(UI), "--cdp-port", String(CDP), "--out", dir],
    { stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, CDP_RECORDER_ALLOWED_FILE: allowedFile } });
  p.log = "";
  p.stdout.on("data", (d) => (p.log += d));
  p.stderr.on("data", (d) => (p.log += d));
  return p;
};
const up = async () => { for (let i = 0; i < 120; i++) { await wait(250); try { const r = await call("GET", "/api/status"); if (r.json && r.json.connected) return true; } catch { /* starting */ } } return false; };
const quit = async (p) => { try { await call("POST", "/api/quit", `http://localhost:${UI}`); } catch { /* gone */ } for (let i = 0; i < 80 && p.exitCode === null; i++) await wait(250); return p.exitCode !== null; };

let app = start();
const browser = await chromium.launch({ channel: "msedge" });
try {
  check(await up(), "the recorder started by hand is running (recording window + toolbar)");
  const origin = new URL(PORTAL).origin;

  // 1. an unknown page: bare status, may ask — nothing else
  const bare = await call("GET", "/api/status", origin);
  check(bare.json.allowed === false && bare.json.canAsk === true && bare.json.ask === null && !("lastHarPath" in bare.json),
    "an unknown page gets the bare status, plus canAsk");
  check((await call("POST", "/api/session", origin, { url: site })).status === 403, "it still cannot start a recording");
  check((await call("POST", "/api/ask", undefined)).status === 400, "a program (no Origin) cannot ask");

  // 2. the toolbar (as served) and the Recorder page
  const bar = await browser.newPage({ viewport: { width: 300, height: 480 } });
  await bar.goto(`http://localhost:${UI}/`);
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const linkTries = [];
  page.on("request", (r) => { if (r.url().startsWith("perfx-recorder:")) linkTries.push(r.url()); });
  await page.route("**/portal/record-live.js*", async (route) => {
    const r = await route.fetch();
    await route.fulfill({ response: r, body: (await r.text()).replace("http://localhost:8787", `http://localhost:${UI}`) });
  });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(PORTAL + "/recorder", { waitUntil: "networkidle" });
  await page.click("#lv-start");
  await page.fill("#lv-url-inp", site);
  await page.click("#lv-go");
  await page.waitForFunction(() => /Allow/.test(document.getElementById("lv-step-rec").textContent), null, { timeout: 8000 });
  check(true, "the page says: click Allow on the CDP Recorder toolbar — " + (await page.textContent("#lv-step-rec")).slice(0, 60));
  check(linkTries.length === 0, "no perfx-recorder: link was opened (the recorder already answers)");
  check((await call("GET", "/api/status", origin)).json.ask === "pending", "the question is pending");
  await page.screenshot({ path: join(process.env.SHOTS || dir, "page-asking.png") });

  await bar.waitForSelector("#askCard:not(.hidden)", { timeout: 5000 });
  check((await bar.textContent("#askSite")) === origin, "the toolbar names the asking page: " + (await bar.textContent("#askSite")));
  check((await bar.textContent("#askOk")) === "Allow" && (await bar.textContent("#askCancel")) === "Don't allow", "Allow / Don't allow");
  const box = await bar.$eval("#askCancel", (b) => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.right <= innerWidth; });
  check(box, "both buttons fit in the 300×480 toolbar");
  await bar.screenshot({ path: join(process.env.SHOTS || dir, "toolbar-ask.png") });
  await bar.click("#askOk");

  await page.waitForSelector("#rl-live:not([hidden])", { timeout: 60000 });
  check(true, "after Allow the page went on by itself: the recording runs, live view open");
  const st = await call("GET", "/api/status", origin);
  check(st.json.allowed === true && st.json.recording === true && st.json.session && st.json.session.url === site, "the page is allowed and recording " + site);
  check(existsSync(allowedFile) && JSON.parse(readFileSync(allowedFile, "utf8")).pages.includes(origin), "the page is remembered in allowed-pages.json");
  await page.click("#lv-stop");
  await page.waitForFunction(() => document.getElementById("rl-live").hidden, null, { timeout: 30000 });
  check(true, "Stop and save: back on the page with the recording");

  // 3. another page: Don't allow → not asked again for a minute; a page cannot answer its own question
  const evil = "https://other.example.com";
  check((await call("POST", "/api/ask", evil)).json.state === "pending", "another page asks");
  check((await call("POST", "/api/ask/answer", evil, { portal: evil, allow: true })).status === 403, "a page cannot answer for itself");
  check((await call("POST", "/api/ask/answer", origin, { portal: evil, allow: true })).status === 403, "an allowed page cannot answer for another one");
  await bar.waitForSelector("#askCard:not(.hidden)", { timeout: 5000 });
  check((await bar.textContent("#askSite")) === evil, "the toolbar names it: " + evil);
  await bar.click("#askCancel");
  await wait(300);
  check((await call("GET", "/api/status", evil)).json.ask === "denied", "Don't allow: its status says denied");
  check((await call("POST", "/api/ask", evil)).json.state === "denied", "it is not asked about again straight away");
  check((await call("GET", "/api/live", evil)).status === 403, "it still cannot read anything");
  check(!JSON.parse(readFileSync(allowedFile, "utf8")).pages.includes(evil), "not remembered");

  // 4. after a restart the remembered page is allowed straight away
  await bar.close();
  check(await quit(app), "Quit closed the recorder");
  app = start();
  check(await up(), "started by hand again");
  const again = await call("GET", "/api/status", origin);
  check(again.json.allowed === true, "the remembered page is allowed at once — no question");
  check(errs.length === 0, "no page errors " + JSON.stringify(errs));
  check(await quit(app), "Quit straight after starting closes it too");
} catch (e) {
  check(false, "test crashed: " + e.message);
  console.log(app.log);
} finally {
  await browser.close();
  await quit(app);
  fixture.close();
  try { rmSync(dir, { recursive: true, force: true }); } catch { /* still in use */ }
}
console.log(failures.length ? `${failures.length} FAILED` : "ALL PASSED");
process.exit(failures.length ? 1 : 0);
