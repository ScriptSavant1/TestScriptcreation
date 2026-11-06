/**
 * app.ts — start-up for both entry points: src/main.ts (npm start, reads the toolbar page from disk)
 * and pkg-prototype/entry.ts (the packaged .exe, toolbar page inlined at build time). They used to be
 * two near-copies of this code.
 *
 * Two ways to start:
 *  - classic — double-clicked: opens the recording window and the floating toolbar straight away
 *    (unchanged behaviour).
 *  - portal  — started by a perfx-recorder: link from the PerfX Studio Recorder page
 *    (`--portal "<link>"`): no window yet, waits for the page to ask for a recording
 *    (POST /api/session), saves it to Downloads, then waits for the next one. Closes itself after
 *    an hour without use. If a recorder is already running, the link's page is handed to it instead.
 *
 * Every start of the packaged .exe registers the perfx-recorder: link for the current Windows user.
 * Where the browser may not start programs, the user starts the .exe by hand and the page ASKS to be allowed:
 * the toolbar shows Allow / Don't allow, and an allowed page is remembered (allowed-pages.json).
 */
import { exec, type ChildProcess } from "node:child_process";
import { dirname, resolve } from "node:path";
import { Recorder } from "./recorder.js";
import { startServer, type PortalSession } from "./server.js";
import {
  DEFAULT_PORT,
  findBrowser,
  findBrowsers,
  splitEqualsArgs,
  resolveProfile,
  launchAppWindow,
  portalLandingUrl,
  teardown,
  type ProfileMode,
  type ResolvedProfile,
  type BrowserChoice,
} from "./browser-launcher.js";
import { parsePortalLink } from "./portal-mode.js";
import { isPackagedExe, registerLink, downloadsFolder, loadAllowedPages, saveAllowedPages } from "./portal-link.js";
import { VERSION } from "./version.js";

const IDLE_EXIT_MS = 60 * 60 * 1000; // portal mode: close after an hour without a request or a recording
const CLOSE_AFTER_SAVE_MS = 10_000; // a page-started recording's windows close this long after saving — the toolbar counts down

interface Args {
  profileMode: ProfileMode;
  cdpPort: number;
  uiPort: number;
  outDir: string;
  browserChoice: BrowserChoice;
  portalLink: string | null;
  /** --out given: page-started recordings are saved there too, instead of Downloads */
  outGiven: boolean;
}

function parseArgs(argv: string[]): Args {
  let profileMode: ProfileMode = { kind: "temp" };
  let cdpPort = DEFAULT_PORT;
  let uiPort = 8787;
  let outDir = process.cwd();
  let browserChoice: BrowserChoice = "auto";
  let portalLink: string | null = null;
  let outGiven = false;
  // a link is passed as one argument; it must not be split at its own "=" signs
  const linkAt = argv.indexOf("--portal");
  if (linkAt >= 0) {
    portalLink = argv[linkAt + 1] ?? "";
    argv = [...argv.slice(0, linkAt), ...argv.slice(linkAt + 2)];
  }
  argv = splitEqualsArgs(argv); // --browser=chrome as well as --browser chrome

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--real-profile") profileMode = { kind: "real" };
    else if (a === "--profile") profileMode = { kind: "custom", dir: resolve(argv[++i] ?? ".") };
    else if (a === "--cdp-port") cdpPort = Number(argv[++i]);
    else if (a === "--ui-port") uiPort = Number(argv[++i]);
    else if (a === "--out") {
      outDir = resolve(argv[++i] ?? ".");
      outGiven = true;
    }
    else if (a === "--browser") {
      const v = (argv[++i] ?? "").toLowerCase();
      if (v === "edge" || v === "chrome") browserChoice = v;
      else console.warn(`Unrecognized --browser value "${v}" — expected "edge" or "chrome". Falling back to auto-detect.`);
    }
  }
  return { profileMode, cdpPort, uiPort, outDir, browserChoice, portalLink, outGiven };
}

function openAsNormalTab(url: string): void {
  // Last-resort fallback if the floating app-window launch fails for any
  // reason (browser not found, spawn error) — opens a normal tab in the
  // user's default browser instead of leaving them with no UI at all.
  if (process.platform === "win32") exec(`start "" "${url}"`);
  else if (process.platform === "darwin") exec(`open "${url}"`);
  else exec(`xdg-open "${url}"`);
}

/** A CDP Recorder already answering on the control port (null when none). No Origin header — a program, not a page. */
async function runningRecorder(uiPort: number): Promise<{ version?: string } | null> {
  try {
    const r = await fetch(`http://127.0.0.1:${uiPort}/api/status`, { signal: AbortSignal.timeout(1500) });
    return r.ok ? ((await r.json()) as { version?: string }) : null;
  } catch {
    return null;
  }
}

export async function run(pageHtml: string): Promise<void> {
  // chrome-remote-interface still calls url.parse(): Node prints a DEP0169 warning that only confuses users
  process.noDeprecation = true;
  const args = parseArgs(process.argv.slice(2));
  const { profileMode, cdpPort, uiPort, outDir, browserChoice } = args;
  const portalMode = args.portalLink !== null;
  const link = portalMode ? parsePortalLink(args.portalLink) : null;

  console.log(`PerfX CDP Recorder ${VERSION}\n`);

  // A recorder is already running: a link only hands it the page that asked; a double-click says so.
  const running = await runningRecorder(uiPort);
  if (running) {
    if (link?.portal) {
      await fetch(`http://127.0.0.1:${uiPort}/api/allow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portal: link.portal }),
      }).catch(() => undefined);
      console.log("The CDP Recorder is already running — the PerfX Studio page can use it now.");
    } else {
      console.log(`The CDP Recorder is already running (toolbar: http://localhost:${uiPort}). Close it first to start another one.`);
      await new Promise((r) => setTimeout(r, 4000));
    }
    process.exit(0);
  }

  if (isPackagedExe()) {
    const reg = await registerLink();
    if (reg === "registered") console.log("Set up: the PerfX Studio Recorder page can now start recordings on this computer.\n");
    else if (reg === "failed") console.warn("Could not register the perfx-recorder link — start recordings from this program instead.\n");
  }

  const recorder = new Recorder();
  const controlUrl = `http://localhost:${uiPort}`;
  let controlChild: ChildProcess | undefined;
  let controlProfile: ResolvedProfile | undefined;

  const openToolbar = async () => {
    if (controlChild && control?.toolbarOpen()) return; // ours, and still answering (a page asked while it was open)
    if (controlChild || controlProfile) {
      // one that no longer answers (closed by hand): end it before opening another — never two
      const child = controlChild, profile = controlProfile;
      controlChild = controlProfile = undefined;
      await teardown(undefined, child, profile);
    }
    const browserPath = recorder.browserPath ?? findBrowser(browserChoice); // the browser that is recording
    if (!browserPath) return openAsNormalTab(controlUrl);
    try {
      controlProfile = await resolveProfile({ kind: "temp" });
      controlChild = await launchAppWindow(browserPath, controlUrl, controlProfile.userDataDir);
      if (shuttingDown) await closeWindows(); // Quit arrived while it was opening
    } catch (err) {
      console.warn(`Could not open the floating toolbar (${(err as Error).message}) — opening a normal browser tab instead.`);
      openAsNormalTab(controlUrl);
    }
  };
  // one closing at a time: a new recording waits for the previous windows to be gone
  let closing: Promise<void> | null = null;
  let closeTimer: ReturnType<typeof setTimeout> | undefined;
  let closeAt: number | null = null;
  const closeWindows = (): Promise<void> => {
    if (closeTimer) clearTimeout(closeTimer);
    closeTimer = undefined;
    closeAt = null;
    if (!closing) {
      const child = controlChild, profile = controlProfile;
      controlChild = controlProfile = undefined;
      closing = (async () => {
        await Promise.all([recorder.shutdown(), teardown(undefined, child, profile)]); // both at once
      })().finally(() => {
        closing = null;
      });
    }
    return closing;
  };

  // portal mode: close after an hour without use (never while recording)
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const touched = () => {
    if (!portalMode) return;
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (recorder.isRecording()) return touched();
      console.log("\nNot used for an hour — closing. The Recorder page starts it again when needed.");
      process.emit("SIGTERM");
    }, IDLE_EXIT_MS);
  };

  // a recording asked for by the Recorder page (also when this one was double-clicked)
  const startSession = async (s: PortalSession) => {
    if (closing || closeTimer || recorder.isConnected()) await closeWindows(); // a fresh window for the chosen browser / private mode
    console.log(`Recording ${s.url} in ${s.browser === "chrome" ? "Chrome" : "Edge"}${s.private ? " (private window)" : ""}...`);
    await recorder.connect({ kind: "temp" }, cdpPort, s.browser, { privateWindow: s.private, landingUrl: portalLandingUrl(s.url) });
    await openToolbar();
    if (args.outGiven) return { outDir };
    const dl = await downloadsFolder();
    return { outDir: dl ?? (portalMode ? dirname(process.execPath) : outDir) };
  };
  const sessionSaved = () => {
    console.log("Saved. Waiting for the next recording from the Recorder page.\n");
    // the page and the toolbar show "saved" first
    closeAt = Date.now() + CLOSE_AFTER_SAVE_MS;
    closeTimer = setTimeout(() => void closeWindows(), CLOSE_AFTER_SAVE_MS);
  };

  const browsers = (["edge", "chrome"] as const).filter((b) => findBrowsers(b).length > 0);
  // the toolbar after a page-started recording was saved: countdown, Keep open, Close now
  const windows = {
    closingIn: () => (closeAt ? Math.max(0, Math.ceil((closeAt - Date.now()) / 1000)) : null),
    keep: () => {
      if (closeTimer) clearTimeout(closeTimer);
      closeTimer = undefined;
      closeAt = null;
    },
    closeNow: () => void closeWindows(),
  };

  // pages allowed on the toolbar before (Allow) — remembered for this Windows user
  const remembered = loadAllowedPages();
  const remember = (portal: string) => {
    if (remembered.indexOf(portal) < 0) remembered.push(portal);
    if (!saveAllowedPages(remembered)) console.warn("Could not remember the allowed page — it stays allowed until the recorder closes.");
    console.log(`Allowed: ${portal} can start recordings now.`);
  };
  // a page asks to be allowed: the question is on the toolbar — open it if it is not (between recordings)
  const asked = () => {
    console.log("A PerfX Studio page asks to start recordings — answer on the CDP Recorder toolbar.");
    if (!closing) void openToolbar();
  };

  const serverOptions = {
    windows,
    portals: new Set<string>([...remembered, ...(link?.portal ? [link.portal] : [])]),
    remember,
    asked,
    mode: portalMode ? ("portal" as const) : ("classic" as const),
    browsers,
    startSession,
    sessionSaved,
    touched,
  };

  let control: ReturnType<typeof startServer> | undefined;
  // Quit / Ctrl+C work from the start — they used to be wired only after the toolbar had opened, so a Quit
  // sent before that was ignored and the recorder kept running
  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log("\nShutting down...");
    try {
      // never throw a recording away: save it first (Downloads for a page-started one, else the output folder)
      const saved = await control?.saveOpenRecording();
      if (saved) console.log(`Saved the recording: ${saved}`);
    } catch (err) {
      console.warn(`Could not save the recording: ${(err as Error).message}`);
    }
    await closeWindows();
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("SIGHUP", shutdown); // the console window closed (Windows gives a few seconds)

  if (portalMode) {
    control = startServer(recorder, outDir, uiPort, pageHtml, serverOptions);
    console.log("Waiting for the PerfX Studio Recorder page to start a recording.");
    console.log("Keep this window open. Close it (or press Ctrl+C) to stop the CDP Recorder.\n");
    touched();
  } else {
    if (profileMode.kind === "real") {
      console.log("Real-profile mode: this will use your actual default Edge profile.");
      console.log("Close every open Edge window first, or the launch will fail.\n");
    } else if (profileMode.kind === "custom") {
      console.log(`Persistent profile: ${profileMode.dir} (reused across runs — log in once, stays logged in)\n`);
    }
    console.log(`Launching browser (${browserChoice === "auto" ? "Edge, falling back to Chrome" : browserChoice}) and connecting...`);
    try {
      await recorder.connect(profileMode, cdpPort, browserChoice);
    } catch (err) {
      console.error(`Could not start: ${(err as Error).message}`);
      process.exit(1);
    }
    console.log("Connected.\n");
    control = startServer(recorder, outDir, uiPort, pageHtml, serverOptions);
    console.log(`Control page: ${controlUrl}`);
    await openToolbar();
    console.log("Press Ctrl+C here, or click Quit on the toolbar, to stop and clean up.\n");
  }
}
