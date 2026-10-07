/**
 * browser-launcher.ts
 *
 * Launch/attach/teardown logic for the browser process this recorder drives.
 * Adapted from cdp-recorder/probe/src/probe.ts's 2.1/2.2 launch helpers and
 * its process-tree-kill fix (see ../../CDP-RECORDER-IMPLEMENTATION-PLAN.md §2
 * Change Log — child.kill() alone leaks Chromium's child processes on
 * Windows; only `taskkill /F /T` actually tears down the whole tree).
 *
 * Three profile modes, matching the probe's convention:
 *   - temp (default)   — fresh throwaway profile, deleted on exit
 *   - --profile <dir>  — persistent custom profile dir, reused across runs
 *                        (log in once, stays logged in next time)
 *   - --real-profile   — your actual default Edge profile; requires closing
 *                        every open Edge window first (§2.4 in the plan)
 */
import { spawn, execFile, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import CDP from "chrome-remote-interface";

const execFileAsync = promisify(execFile);

export const DEFAULT_PORT = 9333;
const LAUNCH_TIMEOUT_MS = 15_000;

const EDGE_PATHS = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
].filter((p): p is string => !!p);

const CHROME_PATHS = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((p): p is string => !!p);

export type BrowserChoice = "auto" | "edge" | "chrome";

/**
 * `auto` (default) tries Edge first, then Chrome — matches this project's
 * usual corporate-managed-Edge environment. Pass `edge` or `chrome`
 * explicitly (CLI: `--browser edge` / `--browser chrome`) to force one, e.g.
 * if both are installed and the default pick isn't the one you want.
 */
export function findBrowser(choice: BrowserChoice = "auto"): string | null {
  const paths = choice === "edge" ? EDGE_PATHS : choice === "chrome" ? CHROME_PATHS : [...EDGE_PATHS, ...CHROME_PATHS];
  for (const p of paths) {
    if (existsSync(p)) return p;
  }
  return null;
}

export async function isBrowserAlreadyRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq msedge.exe", "/FO", "CSV"]);
    return stdout.toLowerCase().includes("msedge.exe");
  } catch {
    return false; // can't check → don't block; real-profile launch will fail loudly on its own if this was wrong
  }
}

export async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/F", "/T", "/PID", String(pid)]);
    } catch {
      /* process may have already exited on its own */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export type ProfileMode =
  | { kind: "temp" }
  | { kind: "custom"; dir: string }
  | { kind: "real" };

export interface ResolvedProfile {
  userDataDir: string;
  cleanupOnExit: boolean; // true only for "temp" — never delete a persistent or real profile
}

export async function resolveProfile(mode: ProfileMode): Promise<ResolvedProfile> {
  if (mode.kind === "real") {
    if (await isBrowserAlreadyRunning()) {
      throw new Error(
        "msedge.exe is already running — close every Edge window first, then re-run with --real-profile " +
          "(Edge won't let a second instance attach to a profile that's already in use).",
      );
    }
    return {
      userDataDir: join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Edge", "User Data"),
      cleanupOnExit: false,
    };
  }
  if (mode.kind === "custom") {
    mkdirSync(mode.dir, { recursive: true });
    return { userDataDir: mode.dir, cleanupOnExit: false };
  }
  return {
    userDataDir: mkdtempSync(join(tmpdir(), "cdp-recorder-")),
    cleanupOnExit: true,
  };
}

// Landing page for the recording window. A bare about:blank gave no clue
// that THIS is the window being recorded — a real user browsed in their
// normal (favourites/logged-in) browser instead, and every transaction came
// out empty. A data: URL is skipped by cdp-capture's shouldCapture(), so this
// page never appears in the HAR.
const RECORDING_WINDOW_LANDING_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>PerfX Recording Window</title>
<style>body{font-family:Segoe UI,Arial,sans-serif;background:#fff7ed;color:#1f2937;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}
.box{max-width:620px;border:3px solid #ea580c;border-radius:12px;padding:28px 32px;background:#fff}
h1{color:#c2410c;margin:0 0 12px;font-size:24px}li{margin:6px 0}</style></head><body><div class="box">
<h1>&#9679; This is the RECORDING window</h1>
<p>Only activity in <b>this</b> browser window (and tabs/popups it opens) is recorded.</p>
<ol><li>Click <b>Start Recording</b> on the floating toolbar.</li>
<li>Type your application URL in <b>this window's address bar</b> and log in here.</li>
<li>Do NOT use your usual browser window &mdash; it is not being recorded.</li></ol>
<p style="color:#6b7280;font-size:13px">This window uses its own temporary profile, separate from your usual browser. You may need to log in again here.</p>
</div></body></html>`;
const RECORDING_WINDOW_LANDING_URL = "data:text/html;charset=utf-8," + encodeURIComponent(RECORDING_WINDOW_LANDING_HTML);

export async function launchAndWaitForPort(
  browserPath: string,
  userDataDir: string,
  port: number,
): Promise<ChildProcess> {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-popup-blocking", // same rationale as the Phase 0 probe — see its src/probe.ts
    RECORDING_WINDOW_LANDING_URL,
  ];

  const child = spawn(browserPath, args, { stdio: "ignore", windowsHide: false });

  const spawnError = await new Promise<Error | null>((resolve) => {
    const t = setTimeout(() => resolve(null), 1500);
    child.once("error", (e) => {
      clearTimeout(t);
      resolve(e);
    });
    child.once("spawn", () => {
      clearTimeout(t);
      resolve(null);
    });
  });
  if (spawnError) throw spawnError;

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) return child;
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = (err as Error).message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  await killProcessTree(child.pid!).catch(() => {});
  throw new Error(`remote debugging port never opened (${lastErr}) — may be disabled by policy`);
}

const APP_WINDOW_SIZE = { width: 300, height: 480 };
const APP_WINDOW_MARGIN = 20; // px from the screen edge

/**
 * Best-effort: positions the toolbar in the screen's top-right corner,
 * matching where most utility/recording toolbars conventionally sit (not
 * dead center, which is where Chromium puts an --app= window by default
 * with no --window-position — fine for one window, but gets in the way
 * sitting on top of whatever the recording browser is showing). Returns
 * null on any failure (no PowerShell, no primary screen info, etc.) — the
 * caller falls back to letting the OS choose, same as before this existed;
 * positioning is a nice-to-have, never worth failing the whole launch over.
 */
async function getTopRightPosition(windowWidth: number): Promise<{ x: number; y: number } | null> {
  try {
    const { stdout } = await execFileAsync("powershell", [
      "-NoProfile",
      "-Command",
      "Add-Type -AssemblyName System.Windows.Forms; " +
        "$s = [System.Windows.Forms.Screen]::PrimaryScreen.WorkingArea; " +
        "Write-Output \"$($s.Width),$($s.Height)\"",
    ]);
    const [screenWidth] = stdout.trim().split(",").map(Number);
    if (!Number.isFinite(screenWidth) || screenWidth <= 0) return null;
    return { x: Math.max(0, screenWidth - windowWidth - APP_WINDOW_MARGIN), y: APP_WINDOW_MARGIN };
  } catch {
    return null;
  }
}

/**
 * Launches the control page as a minimal, chrome-less "app window" — Edge/
 * Chrome's `--app=` mode strips the address bar, tabs, and toolbar, so it
 * renders like a floating panel rather than a normal browser tab. This is
 * the closest equivalent to VuGen's own recording toolbar: a separate
 * floating window, not something living inside the browser being recorded.
 *
 * Deliberately a SEPARATE process from the dedicated recording browser (own
 * --user-data-dir, no --remote-debugging-port at all) — it must never be a
 * target the recording browser's Target.setAutoAttach could pick up, or its
 * own traffic (the page's status polling) would pollute the HAR.
 */
export async function launchAppWindow(browserPath: string, url: string, userDataDir: string): Promise<ChildProcess> {
  const args = [
    `--app=${url}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${APP_WINDOW_SIZE.width},${APP_WINDOW_SIZE.height}`,
  ];

  const position = await getTopRightPosition(APP_WINDOW_SIZE.width);
  if (position) args.push(`--window-position=${position.x},${position.y}`);

  const child = spawn(browserPath, args, { stdio: "ignore", windowsHide: false });

  const spawnError = await new Promise<Error | null>((resolve) => {
    const t = setTimeout(() => resolve(null), 1500);
    child.once("error", (e) => {
      clearTimeout(t);
      resolve(e);
    });
    child.once("spawn", () => {
      clearTimeout(t);
      resolve(null);
    });
  });
  if (spawnError) throw spawnError;
  return child;
}

export async function connectBrowserLevel(port: number): Promise<CDP.Client> {
  const version = await CDP.Version({ port });
  return CDP({ target: version.webSocketDebuggerUrl });
}

export async function teardown(
  client: CDP.Client | undefined,
  child: ChildProcess | undefined,
  profile: ResolvedProfile | undefined,
): Promise<void> {
  try {
    await client?.close();
  } catch {
    /* already closing */
  }
  if (child?.pid) {
    await killProcessTree(child.pid);
  }
  if (profile?.cleanupOnExit) {
    // Let the OS release file handles after the tree-kill before deleting —
    // an immediate rmSync can hit EBUSY on Windows (see probe's Change Log).
    await new Promise((r) => setTimeout(r, 500));
    try {
      rmSync(profile.userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
    } catch (err) {
      console.warn(`Could not remove temporary profile ${profile.userDataDir}: ${(err as Error).message}`);
    }
  }
}
