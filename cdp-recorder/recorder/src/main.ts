/**
 * main.ts — entry point. Replaces the old CLI REPL (cli.ts, removed) with a
 * local web UI: connects the recorder, starts server.ts's HTTP server, and
 * opens the control page as a floating, chrome-less "app window" — the
 * closest equivalent to VuGen's own recording toolbar. Deliberately a
 * SEPARATE browser process from the dedicated recording browser (own
 * profile, no CDP debug port) — it must never be a target the recording
 * browser's Target.setAutoAttach could pick up, or its own traffic (status
 * polling) would pollute the HAR.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import { exec, type ChildProcess } from "node:child_process";
import { Recorder } from "./recorder.js";
import { startServer } from "./server.js";
import {
  DEFAULT_PORT,
  findBrowser,
  resolveProfile,
  launchAppWindow,
  teardown,
  type ProfileMode,
  type ResolvedProfile,
} from "./browser-launcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

function parseArgs(argv: string[]): { profileMode: ProfileMode; cdpPort: number; uiPort: number; outDir: string } {
  let profileMode: ProfileMode = { kind: "temp" };
  let cdpPort = DEFAULT_PORT;
  let uiPort = 8787;
  let outDir = process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--real-profile") profileMode = { kind: "real" };
    else if (a === "--profile") profileMode = { kind: "custom", dir: resolve(argv[++i] ?? ".") };
    else if (a === "--cdp-port") cdpPort = Number(argv[++i]);
    else if (a === "--ui-port") uiPort = Number(argv[++i]);
    else if (a === "--out") outDir = resolve(argv[++i] ?? ".");
  }
  return { profileMode, cdpPort, uiPort, outDir };
}

function openAsNormalTab(url: string): void {
  // Last-resort fallback if the floating app-window launch fails for any
  // reason (browser not found, spawn error) — opens a normal tab in the
  // user's default browser instead of leaving them with no UI at all.
  if (process.platform === "win32") exec(`start "" "${url}"`);
  else if (process.platform === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

async function main(): Promise<void> {
  const { profileMode, cdpPort, uiPort, outDir } = parseArgs(process.argv.slice(2));

  console.log("CDP standalone recorder — see cdp-recorder/README.md before recording anything real.\n");
  if (profileMode.kind === "real") {
    console.log("Real-profile mode: this will use your actual default Edge profile.");
    console.log("Close every open Edge window first, or the launch will fail.\n");
  } else if (profileMode.kind === "custom") {
    console.log(`Persistent profile: ${profileMode.dir} (reused across runs — log in once, stays logged in)\n`);
  } else {
    console.log(
      "Temporary profile — nothing persists once you quit. Pass --profile <dir> to reuse a login,\n" +
        "or --real-profile to use your actual default browser profile.\n",
    );
  }

  const recorder = new Recorder();
  console.log("Launching browser and connecting...");
  try {
    await recorder.connect(profileMode, cdpPort);
  } catch (err) {
    console.error(`Could not start: ${(err as Error).message}`);
    process.exit(1);
  }
  console.log("Connected.\n");

  const pageHtml = readFileSync(join(__dirname, "control-page.html"), "utf8");
  startServer(recorder, outDir, uiPort, pageHtml);

  const controlUrl = `http://localhost:${uiPort}`;
  console.log(`Control page: ${controlUrl}`);
  console.log("Opening it as a floating toolbar window (a separate browser process from the");
  console.log("dedicated recording window above — it is never part of the recording).\n");
  console.log("Press Ctrl+C here, or click Quit on the toolbar, to stop and clean up.\n");

  let controlChild: ChildProcess | undefined;
  let controlProfile: ResolvedProfile | undefined;
  const browserPath = findBrowser();
  if (browserPath) {
    try {
      controlProfile = await resolveProfile({ kind: "temp" });
      controlChild = await launchAppWindow(browserPath, controlUrl, controlProfile.userDataDir);
    } catch (err) {
      console.warn(`Could not open the floating toolbar (${(err as Error).message}) — opening a normal browser tab instead.`);
      openAsNormalTab(controlUrl);
    }
  } else {
    openAsNormalTab(controlUrl);
  }

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
