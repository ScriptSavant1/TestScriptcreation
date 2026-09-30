/**
 * cli.ts — interactive CLI entry point.
 *
 * The CDP connection has to stay open for the whole recording session, so
 * this is a REPL, not a one-shot process per command: `npm start` launches
 * the browser once and connects, then accepts `start` / `stop` / transaction
 * commands typed at the prompt until you `quit`.
 *
 * See ../../CDP-RECORDER-IMPLEMENTATION-PLAN.md §5 Phase 1 for scope, and
 * ../README.md for profile-mode safety notes (same conventions as the
 * Phase 0 probe in ../probe/).
 */
import { createInterface } from "node:readline";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { Recorder } from "./recorder.js";
import { DEFAULT_PORT, type ProfileMode } from "./browser-launcher.js";

function parseArgs(argv: string[]): { profileMode: ProfileMode; port: number; outDir: string } {
  let profileMode: ProfileMode = { kind: "temp" };
  let port = DEFAULT_PORT;
  let outDir = process.cwd();

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--real-profile") profileMode = { kind: "real" };
    else if (a === "--profile") profileMode = { kind: "custom", dir: resolve(argv[++i] ?? ".") };
    else if (a === "--port") port = Number(argv[++i]);
    else if (a === "--out") outDir = resolve(argv[++i] ?? ".");
  }
  return { profileMode, port, outDir };
}

async function main(): Promise<void> {
  const { profileMode, port, outDir } = parseArgs(process.argv.slice(2));

  console.log("CDP standalone recorder — see cdp-recorder/README.md before recording anything real.\n");
  if (profileMode.kind === "real") {
    console.log("Real-profile mode: this will use your actual default Edge profile.");
    console.log("Close every open Edge window first, or the launch will fail.\n");
  } else if (profileMode.kind === "custom") {
    console.log(`Persistent profile: ${profileMode.dir} (reused across runs — log in once, stays logged in)\n`);
  } else {
    console.log("Temporary profile — nothing persists once you quit. Pass --profile <dir> to reuse a login,\n" +
      "or --real-profile to use your actual default browser profile.\n");
  }

  const recorder = new Recorder();
  let settledOnce = false;

  console.log("Launching browser and connecting...");
  try {
    await recorder.connect(profileMode, port, {
      onCount: (active, background) => {
        process.stdout.write(`\r  active=${active} background=${background}   `);
      },
      onSettled: () => {
        if (!settledOnce) {
          settledOnce = true;
          console.log("\n  (network settled — safe to start a transaction)");
        }
      },
    });
  } catch (err) {
    console.error(`Could not start: ${(err as Error).message}`);
    process.exit(1);
  }
  console.log("Connected. Type `help` for commands.\n");

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: "recorder> " });
  rl.prompt();

  rl.on("line", async (line) => {
    const [cmd, ...rest] = line.trim().split(/\s+/);
    try {
      switch (cmd) {
        case "help":
          console.log(
            [
              "  start                start capturing (auto-attaches to the current tab and any new tabs/popups)",
              "  stop [file.har]      stop capturing and write the HAR (default: recording.har)",
              "  tx start <name>      begin a transaction — tags every request until `tx end`",
              "  tx end               close the current transaction",
              "  status               show recording state and in-flight request counts",
              "  quit                 stop the browser and exit",
            ].join("\n"),
          );
          break;

        case "start":
          if (recorder.isRecording()) {
            console.log("Already recording.");
          } else {
            settledOnce = false;
            await recorder.start();
            console.log("Recording started.");
          }
          break;

        case "stop": {
          if (!recorder.isRecording()) {
            console.log("Not recording.");
            break;
          }
          const har = await recorder.stop();
          const outFile = resolve(outDir, rest[0] || "recording.har");
          writeFileSync(outFile, JSON.stringify(har, null, 2));
          const entryCount = (har as { log: { entries: unknown[] } }).log.entries.length;
          console.log(`Recording stopped. ${entryCount} entries written to ${outFile}`);
          break;
        }

        case "tx": {
          if (rest[0] === "start") {
            const name = rest.slice(1).join(" ") || "Transaction";
            recorder.startTransaction(name);
            console.log(`Transaction started: ${name}`);
          } else if (rest[0] === "end") {
            recorder.endTransaction();
            console.log("Transaction ended.");
          } else {
            console.log("Usage: tx start <name>  |  tx end");
          }
          break;
        }

        case "status": {
          const s = recorder.status();
          console.log(`recording=${s.recording} active=${s.active} background=${s.background}`);
          break;
        }

        case "quit":
        case "exit":
          rl.close();
          return;

        case "":
          break;

        default:
          console.log(`Unknown command: ${cmd} (type "help")`);
      }
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
    }
    rl.prompt();
  });

  rl.on("close", async () => {
    console.log("\nShutting down...");
    if (recorder.isRecording()) {
      try {
        await recorder.stop();
      } catch {
        /* best-effort */
      }
    }
    await recorder.shutdown();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
