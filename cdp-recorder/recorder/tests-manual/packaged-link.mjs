// Packaged .exe + the perfx-recorder: link, the way the Recorder page uses them:
//  1. dist/cdp-recorder.exe started by a link registers the link for this Windows user and waits;
//     the page named in the link may use it, other pages may not.
//  2. A second link, opened through Windows (as the browser does), hands its page to the running one.
// Writes HKCU\Software\Classes\perfx-recorder (what every packaged start does).
//
// Run from cdp-recorder/recorder/ after `npm run build:exe`:  node tests-manual/packaged-link.mjs
import { spawn, exec } from "node:child_process";
import { join } from "node:path";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const exe = join(process.cwd(), "dist", "cdp-recorder.exe");
const failures = [];
const check = (cond, msg) => { console.log(`${cond ? "PASS" : "FAIL"} - ${msg}`); if (!cond) failures.push(msg); };
const st = async (origin) => {
  try { return await (await fetch("http://127.0.0.1:8787/api/status", { headers: origin ? { Origin: origin } : {} })).json(); } catch { return null; }
};

if (await st()) { console.log("A CDP Recorder is already running on port 8787 — close it first."); process.exit(1); }
const app = spawn(exe, ["--portal", "perfx-recorder://start?portal=http%3A%2F%2Flocalhost%3A3999%2Fconverter%2F"], { stdio: ["ignore", "pipe", "pipe"] });
let log = "";
app.stdout.on("data", (d) => (log += d));
app.stderr.on("data", (d) => (log += d));
try {
  for (let i = 0; i < 60 && !(await st()); i++) await wait(250);
  check(/Set up|PerfX CDP Recorder/.test(log), "the .exe started:\n    " + log.trim().split("\n").join("\n    "));
  const reg = await new Promise((r) => exec('reg query "HKCU\\Software\\Classes\\perfx-recorder\\shell\\open\\command" /ve', (e, out) => r(out || "")));
  check(reg.includes(exe) && reg.includes("--portal"), "link registered for this user → " + (/REG_SZ\s+(.*)/.exec(reg) || [])[1]);
  check((await st("http://localhost:3999")).allowed === true, "the page from the link may use it");
  check((await st("https://second.example.com")).allowed === false, "another page may not");
  exec('start "" "perfx-recorder://start?portal=https%3A%2F%2Fsecond.example.com"');
  let ok = false;
  for (let i = 0; i < 60 && !ok; i++) { await wait(250); ok = (await st("https://second.example.com")).allowed === true; }
  check(ok, "a link opened through Windows hands its page to the running recorder");
} finally {
  app.kill();
  await wait(500);
}
console.log(failures.length ? `\n${failures.length} FAILED` : "\nALL PASSED");
process.exit(failures.length ? 1 : 0);
