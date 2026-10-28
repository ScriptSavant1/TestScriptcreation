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
import { existsSync, mkdtempSync, rmSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import CDP from "chrome-remote-interface";

const execFileAsync = promisify(execFile);

// Browser debug port. 0 = the browser picks a free port itself and writes it to
// <user-data-dir>/DevToolsActivePort, which we read back. A fixed port (it used
// to be 9333) fails silently on machines where that port is already in use or
// inside a Windows reserved range (Hyper-V / WSL / Docker reserve ranges per
// machine — `netsh int ipv4 show excludedportrange protocol=tcp`): the browser
// window opens, its debug port never does.
export const DEFAULT_PORT = 0;
// Corporate machines: antivirus scans a fresh profile on first start — 15 s was
// not always enough.
const LAUNCH_TIMEOUT_MS = 30_000;
// Chromium's DevTools server listens on the IPv4 loopback only; "localhost" can
// resolve to ::1 first on some machines.
const CDP_HOST = "127.0.0.1";

/**
 * Accept `--key=value` as well as `--key value` (`--browser=chrome` used to be
 * ignored silently, so the browser never changed). Used by both entry points.
 */
export function splitEqualsArgs(argv: string[]): string[] {
  return argv.flatMap((a) => {
    const i = a.indexOf("=");
    return a.startsWith("--") && i > 2 ? [a.slice(0, i), a.slice(i + 1)] : [a];
  });
}

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
  return findBrowsers(choice)[0] ?? null;
}

/**
 * Every installed browser for this choice, in the order to try them: `auto`
 * gives Edge then Chrome (one of each), so the recorder can fall back to
 * Chrome when Edge's debug port is blocked on a machine.
 */
export function findBrowsers(choice: BrowserChoice = "auto"): string[] {
  const first = (paths: string[]) => paths.filter((p) => existsSync(p)).slice(0, 1);
  if (choice === "edge") return first(EDGE_PATHS);
  if (choice === "chrome") return first(CHROME_PATHS);
  return [...first(EDGE_PATHS), ...first(CHROME_PATHS)];
}

export const browserName = (path: string): string => (/chrome\.exe$/i.test(path) ? "Chrome" : "Edge");

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

/** The port the browser wrote to <user-data-dir>/DevToolsActivePort, or null while it hasn't yet. */
function readDevToolsActivePort(userDataDir: string): number | null {
  try {
    const port = Number(readFileSync(join(userDataDir, "DevToolsActivePort"), "utf8").split(/\r?\n/)[0]);
    return Number.isInteger(port) && port > 0 && port < 65536 ? port : null;
  } catch {
    return null;
  }
}

/**
 * Windows browser policies that switch remote debugging off (Group Policy or
 * Intune write them to the registry). Returns readable findings, e.g.
 * "HKLM Microsoft\Edge RemoteDebuggingAllowed = 0"; empty when none is set.
 */
async function findBlockingPolicies(browserPath: string, names = ["RemoteDebuggingAllowed", "DeveloperToolsAvailability"]): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const vendor = /chrome\.exe$/i.test(browserPath) ? "Google\\Chrome" : "Microsoft\\Edge";
  const blocks: Record<string, number> = { RemoteDebuggingAllowed: 0, DeveloperToolsAvailability: 2 };
  const found: string[] = [];
  for (const hive of ["HKLM", "HKCU"]) {
    for (const [name, blockedValue] of Object.entries(blocks).filter(([n]) => names.includes(n))) {
      try {
        const { stdout } = await execFileAsync("reg", ["query", `${hive}\\SOFTWARE\\Policies\\${vendor}`, "/v", name]);
        const m = /REG_DWORD\s+0x([0-9a-f]+)/i.exec(stdout);
        if (m && parseInt(m[1], 16) === blockedValue) found.push(`${hive} ${vendor} ${name} = ${blockedValue}`);
      } catch {
        /* value not set */
      }
    }
  }
  return found;
}

export interface LaunchedBrowser {
  child: ChildProcess;
  port: number;
}

/**
 * Starts the recording browser and waits until its DevTools endpoint answers.
 * `requestedPort` 0 (the default) lets the browser choose a free port.
 */
export async function launchAndWaitForPort(
  browserPath: string,
  userDataDir: string,
  requestedPort: number,
): Promise<LaunchedBrowser> {
  // RemoteDebuggingAllowed = 0 always wins over the command line: the window
  // would open and the port never would. Say so at once instead of after the
  // 30-second wait.
  const hardBlock = await findBlockingPolicies(browserPath, ["RemoteDebuggingAllowed"]);
  if (hardBlock.length) {
    throw new Error(
      `${browserName(browserPath)} does not allow remote debugging on this machine (policy ${hardBlock.join("; ")}) — ` +
        `ask IT to allow it, or use the other browser (--browser chrome / --browser edge)`,
    );
  }
  // A persistent or real profile can hold a DevToolsActivePort file from an
  // earlier run, pointing at a port that is long gone.
  if (requestedPort === 0) {
    try {
      unlinkSync(join(userDataDir, "DevToolsActivePort"));
    } catch {
      /* not there */
    }
  }
  const args = [
    `--remote-debugging-port=${requestedPort}`,
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

  let exited = "";
  let exitedAt = 0;
  child.once("exit", (code, signal) => {
    exited = `the browser process ended early (code ${code ?? "none"}${signal ? `, ${signal}` : ""})`;
    exitedAt = Date.now();
  });

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let lastErr = requestedPort === 0 ? "the browser never reported its debug port" : "";
  // stop waiting shortly after the browser process has gone — its port will not open any more
  while (Date.now() < deadline && !(exitedAt && Date.now() - exitedAt > 3000)) {
    const port = requestedPort || readDevToolsActivePort(userDataDir);
    if (port) {
      try {
        const res = await fetch(`http://${CDP_HOST}:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
        if (res.ok) return { child, port };
        lastErr = `HTTP ${res.status} from ${CDP_HOST}:${port}`;
      } catch (err) {
        const e = err as Error & { cause?: { code?: string } };
        lastErr = `${e.name === "TimeoutError" ? "no answer" : e.cause?.code ?? e.message} on ${CDP_HOST}:${port}`;
      }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  const exitInfo = exited; // before the kill below, which ends the process itself
  await killProcessTree(child.pid!).catch(() => {});

  const policies = await findBlockingPolicies(browserPath);
  const hint = policies.length
    ? `blocked by browser policy (${policies.join("; ")}) — ask IT to allow remote debugging for ${browserName(browserPath)}, or try --browser chrome / --browser edge`
    : requestedPort
      ? `port ${requestedPort} may be in use or reserved (netsh int ipv4 show excludedportrange protocol=tcp) — leave out --cdp-port to let the browser pick a free one`
      : "no blocking browser policy found in the registry — security software may be blocking the browser's local debug port";
  throw new Error(
    `${browserName(browserPath)}'s remote debugging port never opened (${[lastErr, exitInfo].filter(Boolean).join("; ")}): ${hint}`,
  );
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
  const version = await CDP.Version({ host: CDP_HOST, port });
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
