/**
 * main.ts — entry point for `npm start` (the sources run by tsx). Reads the toolbar page from disk
 * and hands over to app.ts, which the packaged .exe (pkg-prototype/entry.ts) shares.
 *
 * The floating toolbar is deliberately a SEPARATE browser process from the dedicated recording
 * browser (own profile, no CDP debug port) — it must never be a target the recording browser's
 * Target.setAutoAttach could pick up, or its own traffic (status polling) would pollute the HAR.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { run } from "./app.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

run(readFileSync(join(__dirname, "control-page.html"), "utf8")).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
