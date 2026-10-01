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
} from "./browser-launcher.js";
import {
  startCapture,
  stopCapture,
  resetCapture,
  getActiveCount,
  getBackgroundCount,
  forceSettledCheck,
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

  async connect(profileMode: ProfileMode, port = DEFAULT_PORT): Promise<void> {
    const browserPath = findBrowser();
    if (!browserPath) {
      throw new Error("No Edge/Chrome install found in the usual locations — set EDGE_PATH.");
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

  startTransaction(name: string): string {
    return harBuilder.startTransaction(name);
  }

  endTransaction(): void {
    harBuilder.endTransaction();
  }

  /**
   * Stop capturing and return the finished HAR object. Waits up to 2s for
   * any response-body fetches still in flight (same grace period as the
   * extension's STOP_RECORDING handler) before flushing whatever's left as
   * "Incomplete".
   */
  async stop(): Promise<object> {
    if (!this.client) throw new Error("not connected");
    if (!this.recording) throw new Error("not recording");

    const pending = [...(harBuilder.pendingBodyFetches as Set<Promise<void>>)];
    if (pending.length > 0) {
      await Promise.race([Promise.all(pending), new Promise((r) => setTimeout(r, 2000))]);
    }
    harBuilder.flush();

    await stopCapture(this.client);
    resetCapture();
    this.recording = false;

    harBuilder.endTransaction();
    harBuilder.enrichFromDetector(bgDetector);
    return harBuilder.build();
  }

  async shutdown(): Promise<void> {
    await teardown(this.client, this.child, this.profile);
    this.client = undefined;
    this.child = undefined;
  }
}
