/**
 * build-exe.mjs — one-command packaging of the recorder into a single,
 * self-contained Windows .exe (no Node.js install needed on the machine
 * that runs it). Automates the steps documented by hand in
 * ../pkg-prototype/README.md.
 *
 * Output: dist/cdp-recorder.exe, plus dist/cdp-recorder.zip (the .exe and a
 * README.txt) — the ZIP is what server.js's /downloads/cdp-recorder route
 * serves, because some corporate proxies block downloading a bare .exe.
 * Copy the ZIP to the server's dist folder; the download route picks it up
 * without a restart.
 *
 * Usage: node scripts/build-exe.mjs             (build the .exe, then zip it)
 *        node scripts/build-exe.mjs --zip-only  (re-zip an existing .exe)
 */
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const distDir = join(root, "dist");
const bundlePath = join(root, "pkg-prototype", "bundle.cjs");
const blobPath = join(root, "pkg-prototype", "sea-prep.blob");
const seaConfigPath = join(root, "pkg-prototype", "sea-config.json");
const outputExe = join(distDir, "cdp-recorder.exe");
const outputZip = join(distDir, "cdp-recorder.zip");
const zipOnly = process.argv.includes("--zip-only");

// Node's fixed, documented sentinel for marking a binary as a packaged SEA
// app — see https://nodejs.org/api/single-executable-applications.html.
// Not a secret, identical for every Node SEA build, not specific to this project.
const SEA_FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";

function run(label, cmd, args, { shell = false, cwd = root } = {}) {
  console.log(`\n→ ${label}`);
  // shell:true is ONLY for npx — on Windows it resolves to a .cmd shim that
  // execFileSync can't launch directly without a shell (spawnSync fails
  // with EINVAL otherwise). Do NOT use it for node.exe itself: shell:true
  // joins cmd+args into one string without quoting, which breaks the very
  // common case of a space in the path (e.g. "C:\Program Files\nodejs\...").
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell });
}

// Windows PowerShell's built-in Compress-Archive — no extra npm dependency,
// and the .exe it packages is Windows-only anyway.
function zipExe() {
  if (!existsSync(outputExe)) {
    throw new Error(`${outputExe} not found — run "npm run build:exe" first`);
  }
  const readme = join(distDir, "README.txt");
  copyFileSync(join(__dirname, "zip-readme.txt"), readme);
  if (existsSync(outputZip)) rmSync(outputZip);
  const psQuote = (s) => `'${s.replace(/'/g, "''")}'`;
  try {
    run("Zipping (cdp-recorder.exe + README.txt)", "powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Compress-Archive -LiteralPath ${psQuote(outputExe)},${psQuote(readme)} -DestinationPath ${psQuote(outputZip)} -CompressionLevel Optimal`,
    ]);
  } finally {
    rmSync(readme, { force: true });
  }
  console.log(`\nDone: ${outputZip}  <- copy this file to the server's dist folder`);
}

if (zipOnly) {
  zipExe();
  process.exit(0);
}

mkdirSync(distDir, { recursive: true });

console.log("\n→ Bundling (esbuild)");
await esbuild.build({
  entryPoints: [join(root, "pkg-prototype", "entry.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  loader: { ".html": "text" },
  outfile: bundlePath,
});

run("Generating SEA blob", process.execPath, ["--experimental-sea-config", seaConfigPath], {
  cwd: join(root, "pkg-prototype"), // sea-config.json's "main"/"output" are relative paths, resolved against CWD
});

console.log(`\n→ Copying ${process.execPath}`);
if (existsSync(outputExe)) rmSync(outputExe);
copyFileSync(process.execPath, outputExe);

run(
  "Injecting app into the executable (postject)",
  process.execPath,
  [join(root, "node_modules", "postject", "dist", "cli.js"), outputExe, "NODE_SEA_BLOB", blobPath, "--sentinel-fuse", SEA_FUSE],
);

console.log(`\nBuilt: ${outputExe}`);
zipExe();
console.log(
  "Reminder: postject's injection invalidates this file's code signature (expected, not a bug in this " +
    "script) — test it on a real corporate-managed machine before relying on it; see pkg-prototype/README.md's " +
    "caveats section.",
);
