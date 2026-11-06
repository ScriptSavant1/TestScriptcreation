/**
 * server.ts — local control UI for the recorder.
 *
 * Replaces the CLI REPL (cli.ts) with a tiny HTTP server (plain Node `http`,
 * no framework) serving a single self-contained page with Start/Stop/
 * Transaction buttons, visually modeled on
 * the retired PerfX browser extension's side panel button states and
 * design tokens. The page is opened in the user's NORMAL browser (whatever
 * `start <url>` resolves to on Windows), not inside the dedicated recording
 * browser instance this tool launches — opening it there would add the
 * control page's own traffic to the HAR and confuse target auto-attach.
 *
 * Status is polled (GET /api/status every ~1s from the page), not pushed —
 * no WebSocket dependency, good enough for watching active/background
 * counts during a recording.
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { Recorder } from "./recorder.js";
import { scrubHar } from "./scrub-har.js";
import { onSettled } from "./cdp-capture.js";
import { originAccess, originOf, readSession, harFileName, createAskQueue } from "./portal-mode.js";
import { VERSION } from "./version.js";

/** What a recording started from the Recorder page asked for (POST /api/session). */
export interface PortalSession {
  url: string;
  browser: "edge" | "chrome";
  private: boolean;
  name: string;
  firstTx: string;
}

export interface ServerOptions {
  /** Portal origins allowed to drive the recorder — added by perfx-recorder: links (POST /api/allow). */
  portals?: Set<string>;
  /** "portal": started by a link, waits for the page; "classic": double-clicked, browser already open. */
  mode?: "portal" | "classic";
  /** Browsers installed on this computer, for the page's choice. */
  browsers?: Array<"edge" | "chrome">;
  /** Opens the recording browser (+ toolbar) for a page-started recording; returns where Stop saves. */
  startSession?: (s: PortalSession) => Promise<{ outDir: string }>;
  /** Called after a page-started recording was saved (closes its windows after a countdown). */
  sessionSaved?: () => void;
  /** The windows of a saved page-started recording: seconds until they close (null = kept open / none), keep, close now. */
  windows?: { closingIn: () => number | null; keep: () => void; closeNow: () => void };
  /** A page asks to be allowed (POST /api/ask): show the toolbar if it is not open. */
  asked?: () => void;
  /** A page was allowed on the toolbar: remember it for next time. */
  remember?: (portal: string) => void;
  /** Any request from the page or toolbar — keeps a waiting recorder from closing itself. */
  touched?: () => void;
}

export interface ServerState {
  settled: boolean;
  lastHarPath: string | null;
  lastHarEntryCount: number | null;
  transactions: string[]; // completed transaction names, for the "trail" display
  activeTransaction: string | null;
  error: string | null;
  warning: string | null;
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  res.end(text);
}

export function startServer(
  recorder: Recorder,
  outDir: string,
  uiPort: number,
  pageHtml: string,
  options: ServerOptions = {},
): { close: () => void; saveOpenRecording: () => Promise<string | null>; toolbarOpen: () => boolean } {
  const portals = options.portals ?? new Set<string>();
  let session: (PortalSession & { outDir: string }) | null = null;
  let starting = false;
  let savedFromPortal = false; // the last saved recording was started from PerfX Studio (in Downloads, opened there)
  const asks = createAskQueue(); // pages asking to be allowed on the toolbar (POST /api/ask)
  let toolbarSeen = 0; // last status poll from the floating toolbar (it polls every second)

  // Stop and write the .har. A recording started from the Recorder page is saved to Downloads under its own
  // name, whichever Stop was pressed (page or toolbar) — and also on Quit (saveOpenRecording below).
  const save = async (askedName: string): Promise<{ file: string; entryCount: number }> => {
    const fileName = session ? harFileName(session.name || "Recording") : askedName.trim() || "recording.har";
    const har = (await recorder.stop()) as { log: { entries: unknown[] } };
    scrubHar(har); // redacts password/PIN/CVV-type request-body fields only — see scrub-har.ts header
    const outFile = join(session ? session.outDir : outDir, fileName);
    writeFileSync(outFile, JSON.stringify(har, null, 2));
    state.lastHarPath = outFile;
    state.lastHarEntryCount = har.log.entries.length;
    if (session && state.activeTransaction) state.transactions.push(state.activeTransaction);
    if (session) state.activeTransaction = null;
    savedFromPortal = !!session;
    session = null;
    return { file: outFile, entryCount: har.log.entries.length };
  };
  const state: ServerState = {
    settled: false,
    lastHarPath: null,
    lastHarEntryCount: null,
    transactions: [],
    activeTransaction: null,
    error: null,
    warning: null,
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${uiPort}`);

    // Who may call (CORS): the floating toolbar (same origin), a program on this computer (no Origin
    // header — a second cdp-recorder.exe passing on a link), and PerfX Studio pages whose origin
    // arrived through a perfx-recorder: link (the browser asked the user first). Any other web page
    // gets the bare running / recording counts only, for the portal's sidebar badge — it used to be
    // able to read the last recording, cookies and tokens included.
    const origin = typeof req.headers.origin === "string" ? req.headers.origin : "";
    const access = originAccess(origin, uiPort, portals);
    const trusted = access !== "other";
    // any page may ASK to be allowed (the toolbar shows the question) — nothing else
    const askPath = url.pathname === "/api/ask";
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      if (trusted) {
        res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        // Chromium's Private / Local Network Access check before a web page may call this computer
        if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
      }
    }
    if (req.method === "OPTIONS" && askPath && !trusted) {
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      if (req.headers["access-control-request-private-network"]) res.setHeader("Access-Control-Allow-Private-Network", "true");
      res.writeHead(204);
      res.end();
      return;
    }
    if (req.method === "OPTIONS") {
      res.writeHead(trusted ? 204 : 403);
      res.end();
      return;
    }
    if (url.pathname.startsWith("/api/") && url.pathname !== "/api/status") options.touched?.();
    if (!trusted && url.pathname !== "/api/status" && !askPath) {
      sendJson(res, 403, { error: "This page is not allowed to use the CDP Recorder." });
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pageHtml);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        if (url.searchParams.has("toolbar") && access !== "other") toolbarSeen = Date.now();
        const s = recorder.status();
        if (!trusted) {
          // canAsk: this recorder can be asked (POST /api/ask); ask: where this page's question stands
          const o = originOf(origin);
          sendJson(res, 200, { recording: s.recording, active: s.active, background: s.background, allowed: false, canAsk: true, ask: o ? asks.stateOf(o) : null });
          return;
        }
        sendJson(res, 200, {
          allowed: true,
          version: VERSION,
          mode: options.mode ?? "classic",
          browsers: options.browsers ?? [],
          connected: recorder.isConnected(),
          starting,
          session: session ? { url: session.url, browser: session.browser, private: session.private, name: session.name } : null,
          recording: s.recording,
          active: s.active,
          background: s.background,
          settled: state.settled,
          activeTransaction: state.activeTransaction,
          transactions: state.transactions,
          savedFromPortal: savedFromPortal,
          // the toolbar polls without an Origin header (a same-origin GET) — "local"; portal pages never see it
          askingPortal: access === "self" || access === "local" ? asks.pending() : null,
          closingIn: options.windows ? options.windows.closingIn() : null,
          lastHarPath: state.lastHarPath,
          lastHarEntryCount: state.lastHarEntryCount,
          error: state.error,
          warning: state.warning,
        });
        return;
      }

      // A recording started from the Recorder page: open the browser on the address, record, save to Downloads.
      if (req.method === "POST" && url.pathname === "/api/session") {
        const asked = readSession(await readJsonBody(req));
        if (!asked.ok) return sendJson(res, 400, { error: asked.error });
        if (recorder.isRecording()) return sendJson(res, 409, { error: "A recording is already running — stop it first." });
        if (starting || !options.startSession) return sendJson(res, 409, { error: "The recorder is busy starting a recording." });
        starting = true;
        try {
          Object.assign(state, { settled: false, lastHarPath: null, lastHarEntryCount: null, transactions: [], activeTransaction: null, error: null, warning: null });
          savedFromPortal = false;
          const s0 = asked as PortalSession;
          const { outDir: dir } = await options.startSession(s0);
          session = { url: s0.url, browser: s0.browser, private: s0.private, name: s0.name, firstTx: s0.firstTx, outDir: dir };
          await recorder.start();
          if (s0.firstTx) {
            recorder.startTransaction(s0.firstTx);
            state.activeTransaction = s0.firstTx;
          }
          await recorder.openUrl(s0.url);
          sendJson(res, 200, { ok: true });
        } catch (err) {
          state.error = (err as Error).message;
          sendJson(res, 500, { error: (err as Error).message });
        } finally {
          starting = false;
        }
        return;
      }

      // the toolbar after a page-started recording was saved: keep its windows open, or close them now
      if (req.method === "POST" && url.pathname === "/api/windows") {
        const body = await readJsonBody(req);
        if (body.action === "keep") options.windows?.keep();
        else if (body.action === "close") options.windows?.closeNow();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/live") {
        const since = Math.max(0, Number(url.searchParams.get("since")) || 0);
        sendJson(res, 200, recorder.isRecording() ? recorder.live(since) : { rows: [], last: since });
        return;
      }

      // A second cdp-recorder.exe, started by a perfx-recorder: link, hands over the page's origin.
      // Programs only: a web page always sends an Origin header with a POST.
      if (req.method === "POST" && url.pathname === "/api/allow") {
        if (access !== "local") return sendJson(res, 403, { error: "not allowed" });
        const body = await readJsonBody(req);
        const portal = originOf(body.portal);
        if (portal) portals.add(portal);
        sendJson(res, 200, { ok: true });
        return;
      }

      // A page the recorder does not know asks to be allowed — when it was started by hand, the
      // perfx-recorder: link cannot hand the page over (some computers do not let the browser start programs).
      if (req.method === "POST" && askPath) {
        if (access === "portal") return sendJson(res, 200, { state: "allowed" });
        const o = originOf(origin);
        if (access !== "other" || !o) return sendJson(res, 400, { error: "Only a web page can ask." });
        const answer = asks.ask(o);
        if (answer === "pending") options.asked?.();
        sendJson(res, 200, { state: answer });
        return;
      }

      // the toolbar's answer: Allow (remembered) or Don't allow
      if (req.method === "POST" && url.pathname === "/api/ask/answer") {
        if (access !== "self") return sendJson(res, 403, { error: "not allowed" });
        const body = await readJsonBody(req);
        const o = originOf(body.portal);
        if (o && asks.answer(o, body.allow === true)) {
          portals.add(o);
          options.remember?.(o);
        }
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/start") {
        state.settled = false;
        state.lastHarPath = null;
        state.lastHarEntryCount = null;
        state.transactions = [];
        state.activeTransaction = null;
        state.error = null;
        state.warning = null;
        savedFromPortal = false;
        await recorder.start();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tx/start") {
        const body = await readJsonBody(req);
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Transaction";
        // Synchronous — screenshot capture happens in the background, not
        // on this request's critical path. See recorder.ts's startTransaction().
        recorder.startTransaction(name);
        state.activeTransaction = name;
        state.warning = null;
        sendJson(res, 200, { ok: true, name });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tx/end") {
        const ended = recorder.endTransaction(); // same — background screenshot, not on the critical path
        if (ended && ended.requestCount === 0 && state.activeTransaction) {
          state.warning =
            `No network requests were captured during "${state.activeTransaction}". ` +
            `Make sure you are clicking in the RECORDING browser window (the one showing the orange ` +
            `"This is the RECORDING window" page), not your usual browser.`;
        }
        if (state.activeTransaction) state.transactions.push(state.activeTransaction);
        state.activeTransaction = null;
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/stop") {
        const body = await readJsonBody(req);
        const wasSession = !!session;
        const saved = await save(typeof body.fileName === "string" ? body.fileName : "");
        sendJson(res, 200, { ok: true, file: saved.file, entryCount: saved.entryCount });
        if (wasSession) options.sessionSaved?.();
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/download") {
        if (!state.lastHarPath || !existsSync(state.lastHarPath)) {
          sendJson(res, 404, { error: "no HAR available yet" });
          return;
        }
        const content = readFileSync(state.lastHarPath);
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Disposition": `attachment; filename="${basename(state.lastHarPath)}"`,
          "Content-Length": content.length,
        });
        res.end(content);
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/quit") {
        sendJson(res, 200, { ok: true });
        // Signal SIGTERM rather than tearing down here directly — main.ts's
        // shutdown handler (registered for SIGINT/SIGTERM) also tears down
        // the floating control-window process itself, which this handler
        // has no reference to. Quitting from the page and Ctrl+C in the
        // terminal should do exactly the same full cleanup either way.
        // process.emit, NOT process.kill: on Windows, process.kill(self, "SIGTERM")
        // terminates abruptly WITHOUT running the SIGTERM handler, so the browser
        // teardown and temp-profile deletion never happened — every session leaked
        // two temp Edge profiles on disk. Emitting invokes the registered handler.
        setTimeout(() => process.emit("SIGTERM"), 200);
        return;
      }

      res.writeHead(404);
      res.end();
    } catch (err) {
      state.error = (err as Error).message;
      sendJson(res, 500, { error: (err as Error).message });
    }
  });

  // cdp-capture.ts's onSettled() just appends to a module-level callback
  // list — safe to register another listener here independent of whatever
  // main.ts already passed to recorder.connect().
  onSettled(() => {
    state.settled = true;
  });

  // this computer only: a call without an Origin header is trusted as a local program (/api/allow), and
  // Windows Firewall has nothing to ask about
  server.listen(uiPort, "127.0.0.1");
  return {
    close: () => server.close(),
    // Quit / Ctrl+C / closing after an hour: a recording still running is saved first, never thrown away
    saveOpenRecording: async () => (recorder.isRecording() ? (await save(harFileName("Recording"))).file : null),
    // the toolbar window is open (it polled in the last few seconds)
    toolbarOpen: () => Date.now() - toolbarSeen < 3000,
  };
}
