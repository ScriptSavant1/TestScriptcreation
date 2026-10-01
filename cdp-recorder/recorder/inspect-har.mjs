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
 * Usage: node inspect-har.mjs <path-to.har>
 */
import { readFileSync } from "node:fs";

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

for (const p of pages) {
  const n = counts.get(p.id) || 0;
  console.log(`  [${p.id}] "${p.title}"  —  ${n} request(s)${n === 0 ? "   <-- EMPTY, nothing was captured during this transaction" : ""}`);
}
const untagged = counts.get("(no transaction)") || 0;
console.log(`  (no transaction)  —  ${untagged} request(s)  — happened before the first "tx start" or after the last "tx end"`);

if (untagged > 0) {
  console.log("\nFirst few untagged URLs (sanity-check what these actually are):");
  entries.filter((e) => !e.pageref).slice(0, 8).forEach((e) => console.log(`  ${e.request.method} ${e.request.url}`));
}
