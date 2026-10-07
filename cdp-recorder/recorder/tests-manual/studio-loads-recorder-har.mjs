// Loads a HAR produced by the real recorder (see repro-multi-tx.mjs) into the
// real Script Studio page in a browser and checks what the user would see:
// every non-empty transaction present, with its requests assigned to it.
//
// Usage (web server must be running on :3000):
//   node tests-manual/studio-loads-recorder-har.mjs <path-to.har>
import { chromium } from "playwright";

const harPath = process.argv[2];
const failures = [];
const check = (c, m) => { console.log(`${c ? "PASS" : "FAIL"} - ${m}`); if (!c) failures.push(m); };

const browser = await chromium.launch({ channel: "msedge" });
const page = await browser.newPage();
page.on("pageerror", (e) => failures.push("page error: " + e.message));
await page.goto("http://localhost:3000/converter/studio");
await page.setInputFiles('input[type="file"] >> nth=0', harPath);
await page.waitForSelector("#btn-analyze:not([disabled])", { timeout: 10000 });
await page.click("#btn-analyze");
// S is a top-level `const` in a classic script — reachable by name, not via window.S.
await page.waitForFunction(() => typeof S !== "undefined" && S.scripts && Object.keys(S.scripts).length > 0, null, { timeout: 30000 });

const result = await page.evaluate(() => {
  const per = {};
  for (const e of S.entries1) if (!e.isMarker && !e.filtered && e.txn) per[e.txn] = (per[e.txn] || 0) + 1;
  const allScripts = Object.values(S.scripts).map((s) => (typeof s === "string" ? s : (s && s.content) || "")).join("\n");
  return { txns: S.txns.map((t) => t.name), per, allScripts };
});

console.log("Studio transactions:", result.txns);
console.log("Visible requests per transaction:", result.per);
check(JSON.stringify(result.txns) === JSON.stringify(["Launch", "role_group", "Click Next"]), "Studio shows Launch, role_group, Click Next (empty 'Wrong Window' correctly absent)");
for (const t of ["Launch", "role_group", "Click Next"]) {
  check((result.per[t] || 0) >= 1, `"${t}" has visible requests in Studio`);
  // Studio formats names as SC01_NN_<UPPERCASED NAME>.
  const re = new RegExp(`new load\\.Transaction\\("SC01_\\d+_${t.toUpperCase()}"\\)`);
  check(re.test(result.allScripts), `generated main.js declares a transaction for "${t}"`);
}

await browser.close();
console.log(failures.length ? `\nRESULT: FAIL (${failures.length})\n${failures.join("\n")}` : "\nRESULT: ALL PASS");
process.exit(failures.length ? 1 : 0);
