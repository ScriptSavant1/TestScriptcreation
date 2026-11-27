// End-to-end test of the 0.2.3 recording extras, driven over the control API as the PerfX Studio page does: the
// title of the page on screen (a suggested transaction name), renaming a transaction, Undo last mark (a Start, and an
// End), and the script ID (file name and log._perfx_scriptId). Runs the real recorder from the sources against a
// local test site, on a spare port (8794 — never the 8787 a user's own recorder uses).
//
// Run from cdp-recorder/recorder/:  node tests-manual/portal-extras.mjs [edge|chrome]
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const browser = process.argv[2] || "edge";
const UI = 8794;
const API = `http://127.0.0.1:${UI}`;
const PORTAL = "http://portal.test:3999";
const failures = [];
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} - ${msg}`); if (!cond) failures.push(msg); };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const call = async (method, path, body) => {
  const headers = { Origin: PORTAL };
  if (body) headers["Content-Type"] = "application/json";
  const r = await fetch(API + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let json = null;
  try { json = await r.json(); } catch { /* no body */ }
  return { status: r.status, json };
};

const fixture = createServer((req, res) => {
  const html = (title, b) => { res.writeHead(200, { "Content-Type": "text/html" }); res.end(`<!doctype html><html><head><title>${title}</title></head><body>${b}</body></html>`); };
  if (req.url === "/select") return html("Product selection | Example Shop", `<h1>Select</h1><script>fetch('/api/one')</script>`);
  if (req.url.startsWith("/api/")) { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); return; }
  res.writeHead(404); res.end();
});
await new Promise((r) => fixture.listen(0, "127.0.0.1", r));
const site = `http://127.0.0.1:${fixture.address().port}`;
const out = mkdtempSync(join(tmpdir(), "cdp-extras-test-"));
const app = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--ui-port", String(UI), "--out", out, "--portal", `perfx-recorder://start?portal=${encodeURIComponent(PORTAL + "/converter/")}`],
  { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
app.stdout.on("data", (d) => (log += d));
app.stderr.on("data", (d) => (log += d));
const status = async () => (await call("GET", "/api/status")).json;

try {
  for (let i = 0; i < 40; i++) { await wait(250); try { await fetch(API + "/api/status"); break; } catch { /* starting */ } }
  const v = await status();
  const VERSION = /VERSION = "([^"]+)"/.exec(readFileSync("src/version.ts", "utf8"))[1];   // the sources' own version
  check(v.version === VERSION, "version " + VERSION + ": " + v.version);
  check((await call("POST", "/api/session", { url: site + "/select", scriptId: "bad id" })).status === 400, "a script ID that is not letters and digits is refused");

  const s = await call("POST", "/api/session", { url: site + "/select", browser, private: true, name: "Booking", firstTx: "T01_Launch", scriptId: "sc07" });
  check(s.status === 200, "Start recording with script ID sc07 — " + s.status + " " + JSON.stringify(s.json));
  let st;
  for (let i = 0; i < 40; i++) { await wait(250); st = await status(); if (st.pageTitle) break; }
  check(st.pageTitle === "Product selection | Example Shop", "status.pageTitle is the page on screen: " + JSON.stringify(st.pageTitle));
  check(st.session && st.session.scriptId === "SC07", "status.session.scriptId SC07");

  // rename the running transaction, then a finished one
  check((await call("POST", "/api/tx/rename", { from: "T01_Launch", to: "Home" })).json.name === "T01_Home", "rename the running T01_Launch → T01_Home (number kept)");
  await call("POST", "/api/tx/start", { name: "T02_Login" }); await wait(300);
  check((await call("POST", "/api/tx/rename", { from: "T02_Login", to: "T01_Home" })).status === 400, "a name used already is refused");
  st = await status();
  check(st.transactions.join() === "T01_Home" && st.activeTransaction === "T02_Login", "after Start: T01_Home done, T02_Login running");

  // Undo last mark (a Start): T02_Login goes, T01_Home runs again
  const u1 = await call("POST", "/api/tx/undo");
  st = await status();
  check(u1.json.undone === "T02_Login" && u1.json.active === "T01_Home" && st.transactions.length === 0 && st.activeTransaction === "T01_Home",
    "Undo a Start: T02_Login taken back, T01_Home runs again — " + JSON.stringify(u1.json));

  // End, then Undo (an End): T01_Home runs again
  await call("POST", "/api/tx/end");
  const u2 = await call("POST", "/api/tx/undo");
  st = await status();
  check(u2.json.undone === null && u2.json.active === "T01_Home" && st.activeTransaction === "T01_Home", "Undo an End: T01_Home runs again");
  await call("POST", "/api/tx/start", { name: "T02_Pay" }); await wait(300);
  await call("POST", "/api/tx/rename", { from: "T01_Home", to: "Select" });

  const stop = await call("POST", "/api/stop", {});
  check(stop.status === 200 && /SC07_Booking_\d{4}-\d{2}-\d{2}_\d{6}\.har$/.test(stop.json.file || ""), "the file starts with the script ID: " + (stop.json && stop.json.file));
  const files = readdirSync(out).filter((f) => f.endsWith(".har"));
  const har = JSON.parse(readFileSync(join(out, files[0]), "utf8"));
  check(har.log._perfx_scriptId === "SC07", "HAR log._perfx_scriptId SC07");
  const titles = (har.log.pages || []).map((p) => p.title).join(",");
  check(titles === "T01_Select,T02_Pay", "HAR transactions T01_Select, T02_Pay: " + titles);
  const pageOf = Object.fromEntries((har.log.pages || []).map((p) => [p.id, p.title]));
  const one = har.log.entries.find((e) => e.request.url === site + "/api/one");
  check(!!one && pageOf[one.pageref] === "T01_Select", "the page's request is in T01_Select (renamed, after both undos)");
} catch (err) {
  check(false, "test crashed: " + err.stack);
} finally {
  if (app.exitCode === null) {
    await call("POST", "/api/quit").catch(() => {});
    await Promise.race([new Promise((r) => app.on("exit", r)), wait(15000)]);
  }
  app.kill();
  fixture.close();
  await wait(1500);
  rmSync(out, { recursive: true, force: true });
}
if (failures.length) console.log("\n--- recorder output ---\n" + log.slice(-3000));
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
