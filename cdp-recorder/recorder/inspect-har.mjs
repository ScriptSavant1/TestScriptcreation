/**
 * inspect-har.mjs — quick diagnostic for a recorded HAR file.
 *
 * Prints the transactions recorded (log.pages[]) and how many entries fall
 * into each one, plus how many fall outside any transaction (pageref: null
 * — e.g. the browser's default homepage loading before `tx start` was ever
 * typed). Use this to tell apart "the recorder captured it correctly but
 * Script Studio isn't showing it" from "the recorder never tagged it in the
 * first place."
 *
 * Also extracts any per-transaction screenshots (_perfx_screenshots_start /
 * _perfx_screenshots_end, embedded as base64 PNG data: URLs by recorder.ts)
 * into actual .png files next to the HAR, so you can just double-click and
 * look at them instead of digging through base64 text in a JSON file.
 *
 * Usage: node inspect-har.mjs <path-to.har>
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, basename, extname } from "node:path";

const path = process.argv[2];
if (!path) {
  console.error("Usage: node inspect-har.mjs <path-to.har>");
  process.exit(1);
}

const har = JSON.parse(readFileSync(path, "utf8"));
const pages = har.log?.pages ?? [];
const entries = har.log?.entries ?? [];

console.log(`${path}`);
console.log(`${entries.length} total entries, ${pages.length} transaction(s) recorded:\n`);

const counts = new Map();
for (const e of entries) {
  const key = e.pageref || "(no transaction)";
  counts.set(key, (counts.get(key) || 0) + 1);
}

const hasAnyScreenshots = pages.some((p) => p._perfx_screenshots_start?.length || p._perfx_screenshots_end?.length);
let screenshotDir;
if (hasAnyScreenshots) {
  screenshotDir = join(dirname(path), `${basename(path, extname(path))}-screenshots`);
  mkdirSync(screenshotDir, { recursive: true });
}

function saveScreenshots(dataUrls, label) {
  const saved = [];
  dataUrls.forEach((dataUrl, i) => {
    const base64 = dataUrl.replace(/^data:image\/png;base64,/, "");
    const fileName = `${label}${dataUrls.length > 1 ? `-${i + 1}` : ""}.png`;
    writeFileSync(join(screenshotDir, fileName), Buffer.from(base64, "base64"));
    saved.push(fileName);
  });
  return saved;
}

for (const p of pages) {
  const n = counts.get(p.id) || 0;
  console.log(`  [${p.id}] "${p.title}"  —  ${n} request(s)${n === 0 ? "   <-- EMPTY, nothing was captured during this transaction" : ""}`);

  if (p._perfx_screenshots_start?.length) {
    const safeName = p.title.replace(/[^\w.-]+/g, "_");
    const files = saveScreenshots(p._perfx_screenshots_start, `${safeName}_start`);
    console.log(`      screenshot(s) at start: ${files.map((f) => join(screenshotDir, f)).join(", ")}`);
  }
  if (p._perfx_screenshots_end?.length) {
    const safeName = p.title.replace(/[^\w.-]+/g, "_");
    const files = saveScreenshots(p._perfx_screenshots_end, `${safeName}_end`);
    console.log(`      screenshot(s) at end:   ${files.map((f) => join(screenshotDir, f)).join(", ")}`);
  }
}
const untagged = counts.get("(no transaction)") || 0;
console.log(`  (no transaction)  —  ${untagged} request(s)  — happened before the first "tx start" or after the last "tx end"`);

if (untagged > 0) {
  console.log("\nFirst few untagged URLs (sanity-check what these actually are):");
  entries.filter((e) => !e.pageref).slice(0, 8).forEach((e) => console.log(`  ${e.request.method} ${e.request.url}`));
}

if (hasAnyScreenshots) {
  console.log(`\nScreenshots saved to: ${screenshotDir}`);
}
