// Builds the self-contained end-user guide (screenshots embedded as data URIs)
// from scripts/user-guide.template.html.
//
// 1. Capture fresh screenshots (web app running on :3000 for the Studio shots):
//      node --import tsx tests-manual/capture-guide-screenshots.mjs <shotsDir> http://localhost:3000/converter/studio
// 2. Build:
//      node scripts/build-user-guide.mjs <shotsDir>
// Output: Docs/user/CDP-RECORDER-USER-GUIDE.html
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const shotsDir = process.argv[2];
if (!shotsDir) {
  console.error("Usage: node scripts/build-user-guide.mjs <shotsDir>");
  process.exit(1);
}
const out = resolve(here, "../../../Docs/user/CDP-RECORDER-USER-GUIDE.html");
const date = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });

const html = readFileSync(join(here, "user-guide.template.html"), "utf8")
  .replace(/\{\{date\}\}/g, date)
  .replace(/\{\{img:([\w.-]+)\}\}/g, (_, name) => "data:image/png;base64," + readFileSync(join(shotsDir, name)).toString("base64"));

const missing = html.match(/\{\{[^}]+\}\}/g);
if (missing) {
  console.error("Unresolved placeholders:", missing);
  process.exit(1);
}
writeFileSync(out, html);
console.log(`Wrote ${out} (${Math.round(html.length / 1024)} KB)`);
