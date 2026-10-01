/**
 * pkg-prototype/entry.ts — packaging-only entry point.
 *
 * Identical to ../src/main.ts except the control page's HTML is imported
 * directly (esbuild's `text` loader inlines the file's contents as a JS
 * string at BUILD time) instead of read from disk via `readFileSync` next
 * to `import.meta.url` at runtime. A single packaged .exe shouldn't depend
 * on a sibling file being present on disk — this is the correct fix, not a
 * packaging workaround, and the same approach the real src/main.ts should
 * adopt if this prototype proves out.
 */
import { resolve } from "node:path";
import { exec, type ChildProcess } from "node:child_process";
// @ts-expect-error — esbuild's text loader turns this into a plain string import; no .d.ts for it
import pageHtml from "../src/control-page.html";
import { Recorder } from "../src/recorder.js";
import { startServer } from "../src/server.js";
import {
  DEFAULT_PORT,
  findBrowser,
  resolveProfile,
  launchAppWindow,
  teardown,
  type ProfileMode,
  type ResolvedProfile,
  type BrowserChoice,
} from "../src/browser-launcher.js";

function parseArgs(argv: string[]): {
  profileMode: ProfileMode;
  cdpPort: number;
  uiPort: number;
  outDir: string;
  browserChoice: BrowserChoice;
} {
  let profileMode: ProfileMode = { kind: "temp" };
  let cdpPort = DEFAULT_PORT;
  let uiPort = 8787;
  let outDir = process.cwd();
  let browserChoice: BrowserChoice = "auto";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--real-profile") profileMode = { kind: "real" };
    else if (a === "--profile") profileMode = { kind: "custom", dir: resolve(argv[++i] ?? ".") };
    else if (a === "--cdp-port") cdpPort = Number(argv[++i]);
    else if (a === "--ui-port") uiPort = Number(argv[++i]);
    else if (a === "--out") outDir = resolve(argv[++i] ?? ".");
    else if (a === "--browser") {
      const v = (argv[++i] ?? "").toLowerCase();
      if (v === "edge" || v === "chrome") browserChoice = v;
    }
  }
  return { profileMode, cdpPort, uiPort, outDir, browserChoice };
}

function openAsNormalTab(url: string): void {
  if (process.platform === "win32") exec(`start "" "${url}"`);
  else if (process.platform === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

async function main(): Promise<void> {
  console.log("CDP Recorder (packaged prototype build)\n");
  const { profileMode, cdpPort, uiPort, outDir, browserChoice } = parseArgs(process.argv.slice(2));

  const recorder = new Recorder();
  console.log("Launching browser and connecting...");
  try {
    await recorder.connect(profileMode, cdpPort, browserChoice);
  } catch (err) {
    console.error(`Could not start: ${(err as Error).message}`);
    process.exit(1);
  }
  console.log("Connected.\n");

  startServer(recorder, outDir, uiPort, pageHtml as string);
  const controlUrl = `http://localhost:${uiPort}`;
  console.log(`Control page: ${controlUrl}`);

  let controlChild: ChildProcess | undefined;
  let controlProfile: ResolvedProfile | undefined;
  const browserPath = findBrowser(browserChoice);
  if (browserPath) {
    try {
      controlProfile = await resolveProfile({ kind: "temp" });
      controlChild = await launchAppWindow(browserPath, controlUrl, controlProfile.userDataDir);
      console.log("Floating toolbar opened.\n");
    } catch (err) {
      console.warn(`Could not open the floating toolbar (${(err as Error).message}).`);
      openAsNormalTab(controlUrl);
    }
  } else {
    openAsNormalTab(controlUrl);
  }

  console.log("Press Ctrl+C to stop and clean up.\n");
  const shutdown = async () => {
    console.log("\nShutting down...");
    try {
      if (recorder.isRecording()) await recorder.stop();
    } catch {
      /* best-effort */
    }
    await recorder.shutdown();
    await teardown(undefined, controlChild, controlProfile);
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
