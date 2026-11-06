// Feasibility probe: does the recorder still capture new tabs and pop-ups when the
// recording browser runs in a private window (Edge --inprivate / Chrome --incognito)?
// Uses the real capture code (cdp-capture + har-builder through Recorder); only the
// browser launch is done here, with the private-window switch added.
//
// Run from cdp-recorder/recorder/:  node --import tsx tests-manual/private-window-probe.mjs [edge|chrome] [private|normal]
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Recorder } from "../src/recorder.ts";
import { findBrowsers, connectBrowserLevel, killProcessTree } from "../src/browser-launcher.ts";

const which = process.argv[2] || "edge";
const mode = process.argv[3] || "private";

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
const base = `http://127.0.0.1:${fixture.address().port}`;

const browserPath = findBrowsers(which)[0];
const dir = mkdtempSync(join(tmpdir(), "cdp-private-probe-"));
// a landing page that goes to page A after 3 s — recording is started by then
const landing = "data:text/html," + encodeURIComponent(`<script>setTimeout(function(){location.href='${base}/page-a'},3000)</script>landing`);
const flag = which === "chrome" ? "--incognito" : "--inprivate";
const args = ["--remote-debugging-port=0", `--user-data-dir=${dir}`, "--no-first-run", "--no-default-browser-check", "--disable-popup-blocking"];
if (mode === "private") args.push(flag);
args.push(landing);
const child = spawn(browserPath, args, { stdio: "ignore" });

let port = 0;
for (let i = 0; i < 60 && !port; i++) {
  await new Promise((r) => setTimeout(r, 250));
  try { port = Number(readFileSync(join(dir, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]); } catch { /* not yet */ }
}
const rec = new Recorder();
rec["client"] = await connectBrowserLevel(port);
await rec.start();
await new Promise((r) => setTimeout(r, 9000));
const har = await rec.stop();
const urls = har.log.entries.map((e) => e.request.url.replace(base, ""));
const want = ["/page-a", "/api/ping", "/page-b", "/api/from-popup", "/page-c", "/api/from-newtab"];
console.log(`${which} ${mode}: ${har.log.entries.length} entries`);
for (const w of want) console.log(`  ${urls.includes(w) ? "PASS" : "FAIL"} ${w}`);
await rec["client"].close();
await killProcessTree(child.pid);
fixture.close();
await new Promise((r) => setTimeout(r, 800));
try { rmSync(dir, { recursive: true, force: true }); } catch { /* busy */ }
process.exit(want.every((w) => urls.includes(w)) ? 0 : 1);
