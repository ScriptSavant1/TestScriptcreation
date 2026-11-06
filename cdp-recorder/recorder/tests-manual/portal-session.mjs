// End-to-end test of a recording started from the PerfX Studio Recorder page ("portal mode"),
// driven over the control API exactly as the page does. Runs the real recorder from the sources
// (src/main.ts --portal ...) as a separate process, against a local test site whose first page
// opens a pop-up and a new tab.
//
// Checks: only the portal origin from the link may drive it (any other page: bare status only,
// everything else refused); Start recording opens the address in a private window and records it,
// pop-up and new tab included; the live list; transactions from the page; Stop saves
// <name>_<date>_<time>.har; a second link hands its page to the running recorder.
//
// Run from cdp-recorder/recorder/:  node tests-manual/portal-session.mjs [edge|chrome] [private|normal]
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browser = process.argv[2] || "edge";
const priv = (process.argv[3] || "private") === "private";
const UI = 8798;
const API = `http://127.0.0.1:${UI}`;
const PORTAL = "http://portal.test:3999";
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
  return { status: r.status, json, cors: r.headers.get("access-control-allow-origin") };
};

const fixture = createServer((req, res) => {
  const html = (b) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end("<!doctype html><html><body>" + b + "</body></html>"); };
  if (req.url === "/page-a") return html(`<h1>A</h1><a id="nt" href="/page-c" target="_blank">new tab</a>
    <script>fetch('/api/ping').then(function(){ window.open('/page-b','pop','width=500,height=400'); setTimeout(function(){ document.getElementById('nt').click(); }, 800); });</script>`);
  if (req.url === "/page-b") return html(`<h1>B (pop-up)</h1><script>fetch('/api/from-popup')</script>`);
  if (req.url === "/page-c") return html(`<h1>C (new tab)</h1><script>fetch('/api/from-newtab')</script>`);
  if (req.url.startsWith("/api/")) { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${fixture.address().port}`;
const out = mkdtempSync(join(tmpdir(), "cdp-portal-test-"));

const start = (link) => spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--ui-port", String(UI), "--out", out, "--portal", link],
  { stdio: ["ignore", "pipe", "pipe"] });
const app = start(`perfx-recorder://start?portal=${encodeURIComponent(PORTAL + "/converter/")}`);
let log = "";
app.stdout.on("data", (d) => (log += d));
app.stderr.on("data", (d) => (log += d));

try {
  for (let i = 0; i < 40; i++) { await wait(250); try { await fetch(API + "/api/status"); break; } catch { /* starting */ } }

  // 1. who may call
  const other = await call("GET", "/api/status", "https://evil.example.com");
  check(other.status === 200 && other.json.allowed === false && !("lastHarPath" in other.json) && other.json.recording === false,
    "another web page gets the bare status only (sidebar badge)");
  check((await call("GET", "/api/live", "https://evil.example.com")).status === 403, "another web page cannot read the live list");
  check((await call("GET", "/api/download", "https://evil.example.com")).status === 403, "another web page cannot download a recording");
  check((await call("OPTIONS", "/api/session", "https://evil.example.com")).status === 403, "another web page cannot start a recording (pre-flight refused)");
  check((await call("POST", "/api/allow", "https://evil.example.com", { portal: "https://evil.example.com" })).status === 403, "a web page cannot add itself");
  const st = await call("GET", "/api/status", PORTAL);
  check(st.json.allowed === true && st.json.mode === "portal" && st.json.connected === false && /^\d+\.\d+\.\d+$/.test(st.json.version),
    `the portal from the link is allowed; waiting, no browser yet (version ${st.json.version}, browsers ${st.json.browsers})`);
  check(st.cors === PORTAL, "CORS answer names the portal");
  check((await call("POST", "/api/session", PORTAL, { url: "file:///C:/Windows/win.ini" })).status === 400, "only http(s) addresses are opened");

  // 2. start recording
  const t0 = Date.now();
  const s = await call("POST", "/api/session", PORTAL, { url: site + "/page-a", browser, private: priv, name: "SC01 Portal", firstTx: "01_Launch" });
  check(s.status === 200, `Start recording (${browser}, ${priv ? "private" : "normal"} window) — ${s.status} ${JSON.stringify(s.json)} in ${Date.now() - t0} ms`);
  const busy = await call("POST", "/api/session", PORTAL, { url: site + "/page-a" });
  check(busy.status === 409, "a second Start while recording is refused");

  // 3. live list
  let rows = [], last = 0;
  for (let i = 0; i < 16; i++) {
    await wait(500);
    const l = await call("GET", `/api/live?since=${last}`, PORTAL);
    for (const r of l.json.rows) { const k = rows.findIndex((x) => x.n === r.n); if (k >= 0) rows[k] = r; else rows.push(r); }
    last = l.json.last;
  }
  const seen = (p) => rows.some((r) => r.url === site + p);
  for (const p of ["/page-a", "/api/ping", "/page-b", "/api/from-popup", "/page-c", "/api/from-newtab"]) check(seen(p), `live list shows ${p}`);
  check(rows.every((r) => r.tx === "01_Launch"), "live rows carry the first transaction");
  check(rows.filter((r) => r.done).length === rows.length, "every row reported finished");
  check(new Set(rows.map((r) => r.tab)).size >= 3, "three tabs / windows (page, pop-up, new tab)");
  const st2 = await call("GET", "/api/status", PORTAL);
  check(st2.json.recording && st2.json.session && st2.json.session.name === "SC01 Portal" && st2.json.activeTransaction === "01_Launch", "status shows the recording and its transaction");

  // 4. transactions from the page, then stop
  await call("POST", "/api/tx/end", PORTAL);
  await call("POST", "/api/tx/start", PORTAL, { name: "02_Second" });
  await wait(300);
  const stop = await call("POST", "/api/stop", PORTAL, {});
  check(stop.status === 200 && /SC01_Portal_\d{4}-\d{2}-\d{2}_\d{6}\.har$/.test(stop.json.file || ""), `Stop saves ${stop.json && stop.json.file}`);
  const files = readdirSync(out).filter((f) => f.endsWith(".har"));
  check(files.length === 1, "one .har in the output folder");
  const har = JSON.parse(readFileSync(join(out, files[0]), "utf8"));
  check((har.log.pages || []).map((p) => p.title).join(",") === "01_Launch,02_Second", "HAR transactions 01_Launch, 02_Second");
  check(har.log.entries.some((e) => e.request.url === site + "/api/from-popup") && har.log.entries.some((e) => e.request.url === site + "/api/from-newtab"),
    "HAR has the pop-up and new-tab requests");
  const dl = await fetch(API + "/api/download", { headers: { Origin: PORTAL } });
  check(dl.status === 200 && (await dl.text()).length > 100, "the page can fetch the saved recording");
  // after saving: the toolbar counts down 10 s before the windows close; Keep open stops it, Close windows closes now
  const sc = await call("GET", "/api/status", PORTAL);
  check(sc.json.savedFromPortal === true && sc.json.closingIn >= 8 && sc.json.closingIn <= 10 && sc.json.connected, "after saving: windows still open, closing in " + sc.json.closingIn + " s");
  await call("POST", "/api/windows", PORTAL, { action: "keep" });
  await wait(11000);
  const sk = await call("GET", "/api/status", PORTAL);
  check(sk.json.connected === true && sk.json.closingIn === null, "Keep open: still open after the countdown would have ended");
  await call("POST", "/api/windows", PORTAL, { action: "close" });
  let st3; const tClose = Date.now();
  for (let i = 0; i < 120; i++) { await wait(250); st3 = await call("GET", "/api/status", PORTAL); if (!st3.json.connected) break; }
  console.log("      (windows closed after " + (Date.now() - tClose) + " ms)");
  check(st3.json.connected === false && st3.json.recording === false && st3.json.lastHarEntryCount === har.log.entries.length,
    "after saving: windows closed, waiting for the next recording");

  // 5. a second link hands its page to the running recorder
  const second = start(`perfx-recorder://start?portal=${encodeURIComponent("https://second.example.com")}`);
  const code = await new Promise((r) => second.on("exit", r));
  check(code === 0, "a second start exits by itself");
  check((await call("GET", "/api/status", "https://second.example.com")).json.allowed === true, "…and the second page may use the running recorder");

  // 6. Quit while recording: the recording is saved first, never lost
  const s2 = await call("POST", "/api/session", PORTAL, { url: site + "/page-a", browser, private: priv, name: "SC02 Quit" });
  check(s2.status === 200, "second recording started");
  await wait(3000);
  await call("POST", "/api/quit", PORTAL); const tQuit = Date.now();
  const exited = await Promise.race([new Promise((r) => app.on("exit", () => r(true))), wait(60000).then(() => false)]);
  console.log("      (closed after " + (Date.now() - tQuit) + " ms)");
  check(exited, "Quit closes the recorder");
  const quitFile = readdirSync(out).find((f) => /^SC02_Quit_.*.har$/.test(f));
  check(!!quitFile && JSON.parse(readFileSync(join(out, quitFile), "utf8")).log.entries.some((e) => e.request.url === site + "/api/ping"),
    "Quit during a recording saved it first: " + quitFile);
} catch (err) {
  check(false, "test crashed: " + err.stack);
} finally {
  // quit politely so the recorder closes its browser windows; a hard kill would leave them open
  if (app.exitCode === null) {
    await call("POST", "/api/quit", PORTAL).catch(() => {});
    await Promise.race([new Promise((r) => app.on("exit", r)), wait(15000)]);
  }
  app.kill();
  fixture.close();
  await wait(1500);
  rmSync(out, { recursive: true, force: true });
}
if (failures.length) console.log("\n--- recorder output ---\n" + log);
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
