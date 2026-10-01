/**
 * recorder.ts
 *
 * Session orchestrator — owns the browser process + CDP connection and
 * drives start/stop/transaction lifecycle. This is the standalone
 * replacement for perfx-recorder-extension/background/service-worker.js's
 * message handler (START_RECORDING / STOP_RECORDING / START_TRANSACTION /
 * END_TRANSACTION), minus the chrome.storage.session / side-panel-port
 * plumbing a CLI doesn't need.
 *
 * Notably absent from here: the extension's `chrome.tabs.onCreated` +
 * `chrome.tabs.onUpdated` "wait for the tab to start loading, then attach"
 * dance (service-worker.js §"Auto-attach to new tabs"). That entire
 * mechanism existed only to work around not having `Target.setAutoAttach`
 * available at the browser-session level from inside an extension — here we
 * do have it, so cdp-capture.ts's startCapture() replaces all of it with a
 * single call, and closes the race by construction rather than by racing
 * faster.
 */
import type CDP from "chrome-remote-interface";
import {
  findBrowser,
  resolveProfile,
  launchAndWaitForPort,
  connectBrowserLevel,
  teardown,
  DEFAULT_PORT,
  type ProfileMode,
  type ResolvedProfile,
  type BrowserChoice,
} from "./browser-launcher.js";
import {
  startCapture,
  stopCapture,
  resetCapture,
  getActiveCount,
  getBackgroundCount,
  forceSettledCheck,
  getAttachedSessionIds,
  captureScreenshot,
} from "./cdp-capture.js";
// Ported plain-JS modules, imported as `any` — see cdp-capture.ts's header
// comment on its own imports for why.
import { harBuilder as _harBuilder } from "./har-builder.js";
import { bgDetector as _bgDetector } from "./bg-detector.js";
const harBuilder = _harBuilder as any;
const bgDetector = _bgDetector as any;

export class Recorder {
  private client: CDP.Client | undefined;
  private child: import("node:child_process").ChildProcess | undefined;
  private profile: ResolvedProfile | undefined;
  private recording = false;
  // transaction id (har-builder.js's `tx_N`) -> screenshots taken at its
  // start/end. Attached onto the HAR's log.pages[] entries in stop(), after
  // build() has assigned each transaction its final `id`.
  private screenshots = new Map<string, { start: string[]; end: string[] }>();

  async connect(profileMode: ProfileMode, port = DEFAULT_PORT, browserChoice: BrowserChoice = "auto"): Promise<void> {
    const browserPath = findBrowser(browserChoice);
    if (!browserPath) {
      const which = browserChoice === "auto" ? "Edge/Chrome" : browserChoice === "edge" ? "Edge" : "Chrome";
      throw new Error(`No ${which} install found in the usual locations — set EDGE_PATH/CHROME_PATH, or pass --browser to pick the other one.`);
    }
    this.profile = await resolveProfile(profileMode);
    this.child = await launchAndWaitForPort(browserPath, this.profile.userDataDir, port);
    this.client = await connectBrowserLevel(port);
  }

  isRecording(): boolean {
    return this.recording;
  }

  status(): { recording: boolean; active: number; background: number } {
    return { recording: this.recording, active: getActiveCount(), background: getBackgroundCount() };
  }

  /**
   * Begin capturing. Returns once auto-attach is armed — does NOT wait for
   * the "settled" signal (matching the extension's behavior: the caller can
   * start a transaction as soon as SETTLED fires, propagated via onSettled).
   */
  async start(): Promise<void> {
    if (!this.client) throw new Error("not connected");
    if (this.recording) return;

    harBuilder.reset();
    resetCapture();
    await startCapture(this.client);
    this.recording = true;

    // Mirrors service-worker.js's 600ms SETTLED fallback: startSettledTimer()
    // in cdp-capture only fires when a request FINISHES, so a page that's
    // already fully loaded with nothing in flight would otherwise never
    // emit SETTLED at all.
    setTimeout(forceSettledCheck, 600);
  }

  /** Screenshots every currently-attached page session (main tab + any open popup). */
  private async captureAllScreenshots(): Promise<string[]> {
    if (!this.client) return [];
    const client = this.client;
    const sessionIds = getAttachedSessionIds();
    const shots = await Promise.all(sessionIds.map((sid) => captureScreenshot(client, sid)));
    return shots.filter((s): s is string => s !== null);
  }

  async startTransaction(name: string): Promise<string> {
    const id = harBuilder.startTransaction(name) as string;
    const shots = await this.captureAllScreenshots();
    this.screenshots.set(id, { start: shots, end: [] });
    return id;
  }

  /** Shared by the public endTransaction() and stop()'s auto-close of a still-open transaction. */
  private async captureEndScreenshot(): Promise<void> {
    const active = harBuilder.activeTransaction as { id?: string } | null;
    if (!active?.id) return;
    const shots = await this.captureAllScreenshots();
    const entry = this.screenshots.get(active.id);
    if (entry) entry.end = shots;
  }

  async endTransaction(): Promise<void> {
    await this.captureEndScreenshot();
    harBuilder.endTransaction();
  }

  /**
   * Stop capturing and return the finished HAR object. Waits up to 2s for
   * any response-body fetches still in flight (same grace period as the
   * extension's STOP_RECORDING handler) before flushing whatever's left as
   * "Incomplete".
   */
  async stop(): Promise<{ log: { pages?: Array<{ id: string; [k: string]: unknown }> } }> {
    if (!this.client) throw new Error("not connected");
    if (!this.recording) throw new Error("not recording");

    const pending = [...(harBuilder.pendingBodyFetches as Set<Promise<void>>)];
    if (pending.length > 0) {
      await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 2000))]);
    }
    harBuilder.flush();

    // Capture a final screenshot for any still-open transaction BEFORE
    // detaching sessions below — stopCapture() detaches every CDP session,
    // after which no screenshot can be taken at all.
    await this.captureEndScreenshot();

    await stopCapture(this.client);
    resetCapture();
    this.recording = false;

    harBuilder.endTransaction();
    harBuilder.enrichFromDetector(bgDetector);
    const har = harBuilder.build() as { log: { pages?: Array<{ id: string; [k: string]: unknown }> } };

    for (const page of har.log.pages ?? []) {
      const shots = this.screenshots.get(page.id);
      if (!shots) continue;
      if (shots.start.length) page._perfx_screenshots_start = shots.start;
      if (shots.end.length) page._perfx_screenshots_end = shots.end;
    }
    this.screenshots.clear();

    return har;
  }

  async shutdown(): Promise<void> {
    await teardown(this.client, this.child, this.profile);
    this.client = undefined;
    this.child = undefined;
  }
}
