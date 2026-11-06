/**
 * pkg-prototype/entry.ts — packaging-only entry point.
 *
 * Same start-up as ../src/main.ts (both call app.ts's run()) except the control page's HTML is
 * imported directly (esbuild's `text` loader inlines the file's contents as a JS string at BUILD
 * time) instead of read from disk at runtime — a single packaged .exe shouldn't depend on a
 * sibling file being present on disk.
 */
// @ts-expect-error — esbuild's text loader turns this into a plain string import; no .d.ts for it
import pageHtml from "../src/control-page.html";
import { run } from "../src/app.js";

run(pageHtml as string).catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
