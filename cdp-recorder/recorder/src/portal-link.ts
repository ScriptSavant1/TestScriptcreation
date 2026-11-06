/**
 * portal-link.ts — the Windows side of recording started from the PerfX Studio Recorder page.
 *
 *  - registerLink(): makes perfx-recorder: links start this .exe, for the current Windows user only
 *    (HKCU\Software\Classes — no administrator rights). Run on every start of the packaged .exe, so
 *    a moved folder fixes itself the next time the user double-clicks it.
 *  - downloadsFolder(): the user's Downloads folder, also when IT has redirected it.
 *  - loadAllowedPages() / saveAllowedPages(): the pages allowed on the toolbar (Allow), remembered for this
 *    Windows user — a data file, so it works where programs may only be started by hand.
 *
 * The pure parts (link parsing, the command line, file names) are in portal-mode.js.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { homedir } from "node:os";
import { LINK_SCHEME, linkCommand, expandEnv, readAllowedPages } from "./portal-mode.js";

const execFileAsync = promisify(execFile);

/** True for the packaged cdp-recorder.exe, false under `npm start` (node.exe runs the sources). */
export function isPackagedExe(): boolean {
  return process.platform === "win32" && !/^node(\.exe)?$/i.test(basename(process.execPath));
}

async function regQuery(key: string, value: string | null): Promise<string | null> {
  try {
    const args = ["query", key, value === null ? "/ve" : "/v", ...(value === null ? [] : [value])];
    const { stdout } = await execFileAsync("reg", args);
    const m = /REG_(?:EXPAND_)?SZ\s+(.*)$/m.exec(stdout);
    return m ? m[1].trim() : null;
  } catch {
    return null;
  }
}

/**
 * Registers perfx-recorder: for this .exe. Skips the registry writes when it already points here.
 * Returns what happened, for the console; never throws (recording works without it, by double-click).
 */
export async function registerLink(exePath = process.execPath): Promise<"registered" | "unchanged" | "failed"> {
  const root = `HKCU\\Software\\Classes\\${LINK_SCHEME}`;
  const command = linkCommand(exePath);
  if ((await regQuery(`${root}\\shell\\open\\command`, null)) === command) return "unchanged";
  try {
    await execFileAsync("reg", ["add", root, "/ve", "/d", "URL:PerfX CDP Recorder", "/f"]);
    await execFileAsync("reg", ["add", root, "/v", "URL Protocol", "/d", "", "/f"]);
    await execFileAsync("reg", ["add", `${root}\\DefaultIcon`, "/ve", "/d", `"${exePath}",0`, "/f"]);
    await execFileAsync("reg", ["add", `${root}\\shell\\open\\command`, "/ve", "/d", command, "/f"]);
    return "registered";
  } catch {
    return "failed";
  }
}

/** The Downloads folder: the redirected one when IT moved it, else <profile>\Downloads, else null. */
export async function downloadsFolder(): Promise<string | null> {
  if (process.platform === "win32") {
    const raw = await regQuery(
      "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\User Shell Folders",
      "{374DE290-123F-4565-9164-39C4925E467B}",
    );
    const dir = raw ? expandEnv(raw, process.env as Record<string, string>) : null;
    if (dir && existsSync(dir)) return dir;
  }
  const fallback = join(homedir(), "Downloads");
  return existsSync(fallback) ? fallback : null;
}

/** Where the allowed pages are remembered (CDP_RECORDER_ALLOWED_FILE overrides it — the manual tests use their own). */
export function allowedPagesFile(): string {
  return process.env.CDP_RECORDER_ALLOWED_FILE || join(process.env.LOCALAPPDATA || homedir(), "PerfX", "cdp-recorder", "allowed-pages.json");
}

/** The pages allowed on the toolbar before; none when the file is missing or unreadable. */
export function loadAllowedPages(file = allowedPagesFile()): string[] {
  try {
    return readAllowedPages(readFileSync(file, "utf8"));
  } catch {
    return [];
  }
}

/** Remembers the allowed pages; never throws (the page stays allowed until the recorder closes either way). */
export function saveAllowedPages(pages: string[], file = allowedPagesFile()): boolean {
  try {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ pages }, null, 2));
    return true;
  } catch {
    return false;
  }
}
