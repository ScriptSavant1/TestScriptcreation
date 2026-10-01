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
  };

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${uiPort}`);

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
        await recorder.start();
        sendJson(res, 200, { ok: true });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tx/start") {
        const body = await readJsonBody(req);
        const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Transaction";
        await recorder.startTransaction(name); // awaits the start screenshot
        state.activeTransaction = name;
        sendJson(res, 200, { ok: true, name });
        return;
      }

      if (req.method === "POST" && url.pathname === "/api/tx/end") {
        await recorder.endTransaction(); // awaits the end screenshot
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
        setTimeout(() => process.kill(process.pid, "SIGTERM"), 200);
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
