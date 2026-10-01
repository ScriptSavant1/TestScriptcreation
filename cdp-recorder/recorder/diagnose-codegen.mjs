/**
 * diagnose-codegen.mjs — run Script Studio's REAL production parsing + code
 * generation against a real HAR file, outside the browser, to see exactly
 * what it does with it.
 *
 * This loads the actual src/web/public/*.js files the browser runs (not a
 * reimplementation) in a Node VM sandbox, feeds them your HAR, and prints
 * how many transactions were detected plus the transaction-related lines of
 * both the VuGen C and DevWeb JS output. If this shows 2 transactions but
 * the browser UI shows 1, the bug is in the browser-side UI/display layer,
 * not in parsing or codegen — tells us exactly where to keep looking.
 *
 * Usage: node diagnose-codegen.mjs <path-to.har>
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const harPath = process.argv[2];
if (!harPath) {
  console.error("Usage: node diagnose-codegen.mjs <path-to.har>");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..", "..");

// IMPORTANT: VuGen-Script-Studio-constants.js declares its own top-level
// `const S = {...}` — that's the app's real state object. Don't pre-define S
// in the sandbox ourselves: a `const` loaded via vm.runInContext creates a
// fresh lexical binding that would shadow anything we set beforehand, and
// every later file (including the one with parseHar/genActionC) would end
// up reading/writing THAT object, not one we hold a reference to from the
// outside. Let constants.js create the real S, then read it back afterward.
const sandbox = { console, window: {}, document: { getElementById: () => null } };
vm.createContext(sandbox);

for (const rel of [
  "src/web/public/shared/vugen-codegen.js",
  "src/web/public/VuGen-Script-Studio-constants.js",
  "src/web/public/VuGen-Script-Studio-correlation.js",
  "src/web/public/studio-codegen.js",
]) {
  const full = join(repoRoot, rel);
  try {
    vm.runInContext(readFileSync(full, "utf8"), sandbox, { filename: full });
  } catch (err) {
    console.error(`Could not load ${rel}: ${err.message}`);
    process.exit(1);
  }
}
const S = vm.runInContext("S", sandbox);
vm.runInContext("S.bgDecisions = new Map();", sandbox);

const har = JSON.parse(readFileSync(harPath, "utf8"));

const entries = sandbox.parseHar(har);
console.log(`Parsed ${entries.length} entries. S.harPages: ${[...S.harPages.entries()].map(([k, v]) => `${k}="${v}"`).join(", ") || "(empty)"}\n`);

sandbox.detectMarkers(entries);
console.log(`S.txns after detectMarkers: ${JSON.stringify(S.txns)}`);
const markerCount = entries.filter((e) => e.isMarker).length;
console.log(`${markerCount} marker entries injected into the entry stream (should be 2x the transaction count: one start + one end each)\n`);

sandbox.applyFilters(entries);
const nonFilteredByTxn = new Map();
for (const e of entries) {
  if (e.isMarker || e.filtered) continue;
  const key = e.txn || "(no transaction)";
  nonFilteredByTxn.set(key, (nonFilteredByTxn.get(key) || 0) + 1);
}
console.log("Non-filtered request count per transaction (after applyFilters — this is what actually reaches codegen):");
for (const [k, v] of nonFilteredByTxn) console.log(`  ${k}: ${v}`);
console.log();

try {
  const vugenCode = sandbox.genActionC(entries, []);
  const vugenTxnLines = vugenCode.split("\n").filter((l) => /lr_start_transaction|lr_end_transaction/.test(l));
  console.log(`--- VuGen C: ${vugenTxnLines.length / 2} transaction pair(s) found in generated code ---`);
  vugenTxnLines.forEach((l) => console.log(l.trim()));
} catch (err) {
  console.log(`genActionC threw: ${err.message}`);
}

console.log();

try {
  const devwebCode = sandbox.genMainJS(entries, []);
  const devwebTxnLines = devwebCode.split("\n").filter((l) => /new load\.Transaction|\.start\(\)|\.stop\(\)/.test(l));
  console.log(`--- DevWeb JS: transaction-related lines in generated code ---`);
  devwebTxnLines.forEach((l) => console.log(l.trim()));
} catch (err) {
  console.log(`genMainJS threw: ${err.message}`);
}
