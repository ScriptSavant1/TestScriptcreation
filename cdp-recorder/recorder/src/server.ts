/**
 * server.ts — local control UI for the recorder.
 *
 * Replaces the CLI REPL (cli.ts) with a tiny HTTP server (plain Node `http`,
 * no framework) serving a single self-contained page with Start/Stop/
 * Transaction buttons, visually modeled on
 * perfx-recorder-extension/sidepanel/sidepanel.html's button states and
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

export function startServer(recorder: Recorder, outDir: string, uiPort: number, pageHtml: string): { close: () => void } {
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

    // CORS: lets the shared /converter page (a different origin —
    // https://loadrunner.webdev.banksvcs.net, or localhost during dev) call
    // this local server directly from the browser, so "Start Recording" on
    // that page can detect and drive an already-running recorder without a
    // server-side round trip (which is impossible here anyway — see
    // CDP-RECORDER-IMPLEMENTATION-PLAN.md's Converter-menu integration
    // notes on why this has to be a local-to-browser call). Reflecting the
    // request's own Origin rather than a fixed one keeps this working from
    // both the real shared site and localhost during development — this
    // server only ever answers status/control requests for a recording on
    // THIS machine, there's no cross-origin data to protect here the way
    // there would be on a server serving shared/sensitive resources.
    const origin = req.headers.origin;
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    }
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (req.method === "GET" && url.pathname === "/") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(pageHtml);
        return;
      }

      if (req.method === "GET" && url.pathname === "/api/status") {
        const s = recorder.status();
        sendJson(res, 200, {
          recording: s.recording,
          active: s.active,
          background: s.background,
          settled: state.settled,
          activeTransaction: state.activeTransaction,
          transactions: state.transactions,
          lastHarPath: state.lastHarPath,
          lastHarEntryCount: state.lastHarEntryCount,
          error: state.error,
          warning: state.warning,
        });
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
        const fileName = typeof body.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : "recording.har";
        const har = (await recorder.stop()) as { log: { entries: unknown[] } };
        scrubHar(har); // redacts password/PIN/CVV-type request-body fields only — see scrub-har.ts header
        const outFile = join(outDir, fileName);
        writeFileSync(outFile, JSON.stringify(har, null, 2));
        state.lastHarPath = outFile;
        state.lastHarEntryCount = har.log.entries.length;
        sendJson(res, 200, { ok: true, file: outFile, entryCount: har.log.entries.length });
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

  server.listen(uiPort);
  return { close: () => server.close() };
}
