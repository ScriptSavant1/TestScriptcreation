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
  forceFireSettledRegardless,
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

    // Mirrors service-worker.js's SETTLED fallback: startSettledTimer() in
    // cdp-capture only fires when a request FINISHES, so a page that's
    // already fully loaded with nothing in flight would otherwise never
    // emit SETTLED at all. A single 600ms check used to be enough — but on a
    // slow corporate machine, Network.enable for the very first tab can
    // still be retrying well past 600ms (cold process, AV/EDR scanning a
    // freshly-spawned browser), and the old code declared "Settled — safe to
    // start a transaction" regardless, silently losing exactly the first
    // transaction's traffic since capture wasn't actually confirmed live
    // yet. Now polls forceSettledCheck() — which itself requires every
    // attached session to have CONFIRMED Network.enable, not just "zero
    // requests in flight" — until it actually fires, instead of trusting a
    // flat timer. Bounded at 20s: if it never confirms, fire the signal
    // anyway with a visible warning rather than leave "Start Transaction"
    // disabled forever — same bounded-wait-and-warn posture as the
    // Network.enable retry logic itself.
    void this.pollUntilSettled();
  }

  private async pollUntilSettled(): Promise<void> {
    const POLL_INTERVAL_MS = 500;
    const MAX_ATTEMPTS = 40; // ~20s
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      if (!this.recording) return; // stopped while we were waiting
      if (forceSettledCheck()) return;
    }
    console.warn(
      "[cdp-recorder] Network capture never confirmed within 20s — firing Settled anyway so Start Transaction isn't stuck disabled forever; capture on the current target(s) may still be incomplete.",
    );
    forceFireSettledRegardless();
  }

  /** Screenshots every currently-attached page session (main tab + any open popup). */
  private async captureAllScreenshots(): Promise<string[]> {
    if (!this.client) return [];
    const client = this.client;
    const sessionIds = getAttachedSessionIds();
    const shots = await Promise.all(sessionIds.map((sid) => captureScreenshot(client, sid)));
    return shots.filter((s): s is string => s !== null);
  }

  /**
   * Synchronous on purpose — a user clicking Start/End Transaction
   * repeatedly through a session should never feel it waiting on a CDP
   * round-trip. Screenshots are captured fire-and-forget in the background;
   * by the time stop() reads this.screenshots to build the final HAR, any
   * screenshot kicked off moments earlier during active recording has had
   * plenty of time to land. (stop()'s own end-of-recording screenshot is
   * different — see captureEndScreenshotSync below — it has to be awaited
   * because stopCapture() detaches every CDP session right after, and a
   * screenshot can't be taken once that's happened.)
   */
  startTransaction(name: string): string {
    const id = harBuilder.startTransaction(name) as string;
    this.screenshots.set(id, { start: [], end: [] });
    void this.captureAllScreenshots().then((shots) => {
      const entry = this.screenshots.get(id);
      if (entry) entry.start = shots;
    });
    return id;
  }

  /**
   * Returns how many requests were tagged to the transaction being ended, so
   * the UI can warn immediately on a zero — the classic symptom of browsing
   * in a window that isn't the recording browser.
   */
  endTransaction(): { requestCount: number } | null {
    const active = harBuilder.activeTransaction as { id?: string } | null;
    harBuilder.endTransaction();
    if (!active?.id) return null;
    const txId = active.id;
    const requestCount = this.countRequestsForTransaction(txId);
    void this.captureAllScreenshots().then((shots) => {
      const entry = this.screenshots.get(txId);
      if (entry) entry.end = shots;
    });
    return { requestCount };
  }

  private countRequestsForTransaction(txId: string): number {
    let n = 0;
    for (const e of harBuilder.completedEntries as Array<{ pageref?: string | null }>) if (e.pageref === txId) n++;
    for (const e of (harBuilder.pendingEntries as Map<string, { pageref?: string | null }>).values()) if (e.pageref === txId) n++;
    return n;
  }

  /** stop()-only: awaited, because stopCapture() detaches every CDP session right after this. */
  private async captureEndScreenshotSync(): Promise<void> {
    const active = harBuilder.activeTransaction as { id?: string } | null;
    if (!active?.id) return;
    const shots = await this.captureAllScreenshots();
    const entry = this.screenshots.get(active.id);
    if (entry) entry.end = shots;
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
    await this.captureEndScreenshotSync();

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
