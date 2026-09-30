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

const CANDIDATE_PATHS = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((p): p is string => !!p);

export function findBrowser(): string | null {
  for (const p of CANDIDATE_PATHS) {
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
    "about:blank",
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
