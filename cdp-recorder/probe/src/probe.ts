/**
 * Phase 0 CDP feasibility probe — see ../../../CDP-RECORDER-IMPLEMENTATION-PLAN.md §2.
 *
 * Answers one question, in five independent, separately-reportable steps,
 * because extension-install blocks and raw-CDP blocks are different
 * enterprise controls that can fail independently:
 *
 *   2.1  Can the browser launch with a custom command-line flag at all?
 *   2.2  Does --remote-debugging-port actually open a listening HTTP endpoint?
 *   2.3  Can an external process open a CDP WebSocket session to it?
 *   2.4  (real-profile mode only, manual) Does corporate SSO survive a relaunch?
 *   2.5  Does Target.setAutoAttach actually pause+attach a new target before
 *        it runs anything — the real fix for the popup-race bug this whole
 *        project exists to solve?
 *
 * Never attempts to bypass a failure — if a check fails, it is reported and
 * the probe stops. No credential, cookie, or token material is ever read,
 * logged, or stored; this only ever checks whether a *connection* is
 * possible.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import CDP from "chrome-remote-interface";

const execFileAsync = promisify(execFile);

const PORT = 9333; // deliberately not the well-known 9222, to avoid colliding with anything else already using it
const LAUNCH_TIMEOUT_MS = 15_000;
const POPUP_TIMEOUT_MS = 8_000;

type CheckResult = "PASS" | "FAIL" | "BLOCKED" | "SKIPPED";

const results: { id: string; name: string; result: CheckResult; detail?: string }[] = [];

function report(id: string, name: string, result: CheckResult, detail?: string): void {
  results.push({ id, name, result, detail });
  const pad = name.padEnd(42, " ");
  console.log(`[${id}] ${pad} ${result}${detail ? `  — ${detail}` : ""}`);
}

// ── 0. locate the browser ─────────────────────────────────────────────────

const CANDIDATE_PATHS = [
  process.env.EDGE_PATH,
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].filter((p): p is string => !!p);

function findBrowser(): string | null {
  for (const p of CANDIDATE_PATHS) {
    if (existsSync(p)) return p;
  }
  return null;
}

async function killProcessTree(pid: number): Promise<void> {
  if (process.platform === "win32") {
    try {
      await execFileAsync("taskkill", ["/F", "/T", "/PID", String(pid)]);
      return;
    } catch {
      /* process may have already exited on its own — fall through */
    }
    return;
  }
  try {
    process.kill(-pid, "SIGKILL"); // negative pid = the whole process group on POSIX
  } catch {
    try {
      process.kill(pid, "SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

async function isBrowserAlreadyRunning(): Promise<boolean> {
  try {
    const { stdout } = await execFileAsync("tasklist", ["/FI", "IMAGENAME eq msedge.exe", "/FO", "CSV"]);
    return stdout.toLowerCase().includes("msedge.exe");
  } catch {
    return false; // if we can't even check, don't block on it — real-profile mode will fail loudly enough on its own if this was wrong
  }
}

// ── 2.1 + 2.2 — launch + port opens ───────────────────────────────────────

async function launchAndWaitForPort(
  browserPath: string,
  userDataDir: string,
  port: number,
): Promise<ChildProcess> {
  const args = [
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-extensions", // this probe is specifically testing the no-extension path
    // The 2.5 check's window.open() runs from an auto-executing <script>,
    // not a real user click — the browser's popup blocker would otherwise
    // silently swallow it, which looks identical to "auto-attach didn't
    // work" from the outside. Standard automation flag (Puppeteer/Playwright
    // use the same one) — affects only this throwaway probe instance, not
    // any corporate policy or the browser's normal configuration.
    "--disable-popup-blocking",
    "about:blank",
  ];

  let child: ChildProcess;
  try {
    child = spawn(browserPath, args, { stdio: "ignore", windowsHide: false });
  } catch (err) {
    report("2.1", "Launch with custom flag", "FAIL", `spawn threw: ${(err as Error).message}`);
    throw err;
  }

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

  if (spawnError) {
    report("2.1", "Launch with custom flag", "FAIL", spawnError.message);
    throw spawnError;
  }
  report("2.1", "Launch with custom flag", "PASS", `pid ${child.pid}`);

  const deadline = Date.now() + LAUNCH_TIMEOUT_MS;
  let lastErr = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${port}/json/version`, { signal: AbortSignal.timeout(1000) });
      if (res.ok) {
        const info = (await res.json()) as { Browser?: string };
        report("2.2", "Remote debugging port opens", "PASS", info.Browser ?? "");
        return child;
      }
      lastErr = `HTTP ${res.status}`;
    } catch (err) {
      lastErr = (err as Error).message;
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  report("2.2", "Remote debugging port opens", "BLOCKED", `never responded (${lastErr}) — the flag may be disabled by policy`);
  throw new Error("port never opened");
}

// ── 2.3 — external WebSocket connects ─────────────────────────────────────

async function connectBrowserLevel(port: number): Promise<CDP.Client> {
  try {
    const version = await CDP.Version({ port });
    const client = await CDP({ target: version.webSocketDebuggerUrl });
    report("2.3", "External WebSocket connects", "PASS");
    return client;
  } catch (err) {
    const msg = (err as Error).message;
    // A connection that opens and is then immediately reset (rather than
    // simply refused) is the shape an EDR/security-product intervention
    // usually takes — worth calling out explicitly rather than lumping it
    // in with an ordinary connection failure.
    const looksIntervened = /reset|refused|forcibly closed/i.test(msg);
    report("2.3", "External WebSocket connects", "BLOCKED", looksIntervened
      ? `${msg} — check whether EDR/security software intervened before assuming this is a plain network issue`
      : msg);
    throw err;
  }
}

// ── 2.5 — Target.setAutoAttach actually pauses a new target before it runs ─

async function checkAutoAttachAndPopupRace(client: CDP.Client): Promise<void> {
  const { Target } = client;

  await Target.setDiscoverTargets({ discover: true });
  await Target.setAutoAttach({ autoAttach: true, waitForDebuggerOnStart: true, flatten: true });

  const outcome = await new Promise<{ ok: boolean; detail: string }>((resolve) => {
    const timer = setTimeout(
      () => resolve({ ok: false, detail: `no popup target observed within ${POPUP_TIMEOUT_MS}ms` }),
      POPUP_TIMEOUT_MS,
    );

    // Two attach events are expected here, both delivered through the
    // generic client.on(...) listener with (params, sessionId) — CRI's
    // per-domain convenience wrappers (client.Page.navigate(...) etc.) are
    // tied to the default (browser-level) session only, which has no page
    // context of its own, so everything page-related must go through
    // explicit session-scoped client.send(method, params, sessionId) calls:
    //
    //   1. The page WE create below to drive the test (no opener) — just
    //      resume it and have it open the popup itself.
    //   2. The popup IT opens (has an opener) — the actual thing being
    //      tested: was it paused before it could run anything?
    let driverTargetId: string | undefined;

    client.on("Target.attachedToTarget", async (params) => {
      const { sessionId, targetInfo, waitingForDebugger } = params as {
        sessionId: string;
        targetInfo: { type: string; openerId?: string; targetId: string };
        waitingForDebugger: boolean;
      };
      if (targetInfo.type !== "page") return;

      if (targetInfo.openerId === undefined) {
        if (targetInfo.targetId === driverTargetId) return; // already handled
        driverTargetId = targetInfo.targetId;
        try {
          if (waitingForDebugger) {
            await client.send("Runtime.runIfWaitingForDebugger", undefined, sessionId);
          }
          // The popup itself opens to about:blank, not another data: URL —
          // Chromium blocks a *script-triggered* top-level navigation to a
          // data: URL (anti-phishing measure) even though CDP's own
          // Page.navigate is exempt, which is exactly why the driver page's
          // own navigation (below) works while a window.open(dataUrl) popup
          // silently never finished loading (found by tracing: attach fired
          // correctly, Page.enable + Runtime.runIfWaitingForDebugger both
          // completed, but Page.loadEventFired never came). about:blank has
          // no such restriction and is sufficient to prove the mechanism.
          await client.send("Page.navigate", {
            url: `data:text/html,<script>window.open('about:blank')</script>`,
          }, sessionId);
        } catch (err) {
          clearTimeout(timer);
          resolve({ ok: false, detail: `driver page setup failed: ${(err as Error).message}` });
        }
        return;
      }

      // This is the popup — the actual thing being tested.
      if (!waitingForDebugger) {
        clearTimeout(timer);
        resolve({ ok: false, detail: "popup attached but was NOT paused — setAutoAttach's waitForDebuggerOnStart did not hold it" });
        return;
      }
      try {
        // Register the load listener BEFORE resuming the target, not after
        // — a page can finish loading within microseconds of being resumed,
        // and registering the listener afterward leaves exactly the kind of
        // gap this whole probe exists to prove is closed. Filtered by
        // sessionId (as a second callback argument) since multiple targets'
        // events multiplex over this one flattened connection.
        const loadedPromise = new Promise<boolean>((res) => {
          let handled = false;
          const t2 = setTimeout(() => res(false), POPUP_TIMEOUT_MS);
          client.on("Page.loadEventFired", (_params: unknown, sid?: string) => {
            if (handled || sid !== sessionId) return;
            handled = true;
            clearTimeout(t2);
            res(true);
          });
        });

        await client.send("Page.enable", undefined, sessionId);
        await client.send("Runtime.runIfWaitingForDebugger", undefined, sessionId);

        const loaded = await loadedPromise;

        clearTimeout(timer);
        resolve(loaded
          ? { ok: true, detail: `popup target ${targetInfo.targetId} paused, attached, resumed, and observed to load — race window closed` }
          : { ok: false, detail: "resumed the target but never observed it load" });
      } catch (err) {
        clearTimeout(timer);
        resolve({ ok: false, detail: (err as Error).message });
      }
    });

    void Target.createTarget({ url: "about:blank" });
  });

  report("2.5", "Target.setAutoAttach + popup race", outcome.ok ? "PASS" : "FAIL", outcome.detail);
}

// ── main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const realProfile = process.argv.includes("--real-profile");

  console.log("CDP feasibility probe — see cdp-recorder/README.md before running this against a real profile.\n");

  const browserPath = findBrowser();
  if (!browserPath) {
    report("2.1", "Launch with custom flag", "FAIL", "no Edge/Chrome install found in the usual locations — set EDGE_PATH");
    printSummary();
    process.exit(1);
  }
  console.log(`Using browser: ${browserPath}`);

  let userDataDir: string;
  let tempDirCreated = false;
  if (realProfile) {
    if (await isBrowserAlreadyRunning()) {
      report("2.4", "SSO carries over on relaunch", "SKIPPED",
        "msedge.exe is already running — close every Edge window first, then re-run with --real-profile");
      printSummary();
      process.exit(1);
    }
    userDataDir = join(process.env.LOCALAPPDATA ?? "", "Microsoft", "Edge", "User Data");
    console.log("Real-profile mode: attaching to your actual default Edge profile.");
    console.log("After the browser launches, sign in / check whether you're already signed in via SSO, then answer the prompt below.\n");
  } else {
    userDataDir = mkdtempSync(join(tmpdir(), "cdp-recorder-probe-"));
    tempDirCreated = true;
    console.log(`Safe mode: using a temporary, throwaway profile at ${userDataDir}\n`);
  }

  let child: ChildProcess | undefined;
  let client: CDP.Client | undefined;
  try {
    child = await launchAndWaitForPort(browserPath, userDataDir, PORT);
    client = await connectBrowserLevel(PORT);

    if (realProfile) {
      // Manual check — SSO state can't be verified from here without reading
      // cookies/session data, which this probe deliberately never does.
      console.log("\n>>> Look at the browser window now. Are you already signed in to your");
      console.log(">>> normal corporate apps (SSO/Kerberos), or were you prompted to log in again?");
      console.log(">>> Record that answer yourself in CDP-RECORDER-IMPLEMENTATION-PLAN.md §2.4 —");
      console.log(">>> this probe cannot determine it automatically without reading session data,");
      console.log(">>> which it deliberately never does.\n");
      report("2.4", "SSO carries over on relaunch", "SKIPPED", "manual check — see console instructions above");
    }

    await checkAutoAttachAndPopupRace(client);
  } catch {
    // Individual check functions already reported their own failure —
    // nothing further to do here except fall through to cleanup + summary.
  } finally {
    try {
      await client?.close();
    } catch {
      /* already closing */
    }
    if (child?.pid) {
      // A real bug found the first time this ran end-to-end: child.kill()
      // only signals the ONE process Node spawned directly. Chromium is
      // multi-process (renderer/GPU/utility children spawned BY that
      // process, not by us) — plain kill() left 6 orphaned msedge.exe
      // processes running per invocation, and their open file handles then
      // made the temp-profile cleanup below fail silently every time. On
      // Windows, only `taskkill /T` (tree-kill) actually terminates the
      // whole browser, not just its top-level launcher process.
      await killProcessTree(child.pid);
    }
    if (tempDirCreated) {
      // Give the OS a moment to release file handles after the tree-kill
      // above completes — an immediate rmSync right after killing a
      // multi-process browser can still hit an EBUSY on Windows.
      await new Promise((r) => setTimeout(r, 500));
      try {
        rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 300 });
      } catch (err) {
        console.warn(`Could not remove temporary profile ${userDataDir}: ${(err as Error).message}`);
      }
    }
  }

  printSummary();
}

function printSummary(): void {
  console.log("\n" + "─".repeat(60));
  const failed = results.filter((r) => r.result === "FAIL" || r.result === "BLOCKED");
  if (failed.length === 0) {
    console.log("All automated checks passed. See CDP-RECORDER-IMPLEMENTATION-PLAN.md §2 for next steps.");
  } else {
    console.log(`${failed.length} check(s) did not pass — see CDP-RECORDER-IMPLEMENTATION-PLAN.md §2`);
    console.log(`for what each failure means and what to do next.`);
  }
}

main().catch((err) => {
  console.error("\nProbe crashed unexpectedly:", err);
  process.exit(1);
});
