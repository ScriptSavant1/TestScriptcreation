// Manual check (BUG-111): does the recorder start, and how long does it take, with and without a
// RemoteDebuggingAllowed = 0 policy in the registry?  The recorder must TRY the browser even when the
// registry value is there — only a browser that really refuses may stop it.
//   node --import tsx tests-manual/policy-start.mjs [edge|chrome|auto]
import { Recorder } from "../src/recorder.ts";

const choice = process.argv[2] || "edge";
const rec = new Recorder();
const t0 = Date.now();
try {
  await rec.connect({ kind: "temp" }, 0, choice);
  console.log(`STARTED with ${rec.browserPath} after ${((Date.now() - t0) / 1000).toFixed(1)} s`);
} catch (err) {
  console.log(`FAILED after ${((Date.now() - t0) / 1000).toFixed(1)} s:\n${err.message}`);
} finally {
  await rec.shutdown().catch(() => {});
}
process.exit(0);
