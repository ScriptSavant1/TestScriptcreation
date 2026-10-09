# Packaging prototype — Step 1: prove it works standalone

**Result: it works.** A single `.exe`, no Node.js install, no `npm install`,
no `node_modules` on the target machine, built from this exact codebase.
Full lifecycle (launch browser → connect CDP → serve the control API →
open the floating toolbar → start/stop a recording → clean teardown)
verified working identically to the normal `npm start` (tsx) path.

**Two real caveats found, not glossed over** — see the end of this file
before deciding whether to build Step 2 on top of this.

## How it's built

**One command**, from `cdp-recorder/recorder/`:

```bash
npm run build:exe
```

Produces `dist/cdp-recorder.exe` and `dist/cdp-recorder.zip` (the .exe plus
a README.txt). The ZIP is what `server.js`'s `/downloads/cdp-recorder` route
serves — some corporate proxies block a bare `.exe` download — falling back
to the `.exe` if no ZIP is present. Run this (the web server picks up the new
file on the next request) any time `pkg-prototype/entry.ts` or anything it
imports changes. `npm run build:zip` re-zips an existing `.exe` only.

See `scripts/build-exe.mjs` for what it actually does — the same steps
documented manually below, automated. Two Windows-specific gotchas it
works around, worth knowing about if the script ever needs touching:
`execFileSync` can't launch a `.cmd` shim (like `npx`) without
`shell: true`, but `shell: true` breaks on `cmd.exe`'s own concatenation
when the command path has a space in it (`C:\Program Files\nodejs\...`) —
so `node.exe` itself is invoked directly (no shell needed, it's a real
`.exe`) and `postject` is invoked via its own `dist/cli.js` through `node`
directly too (installed as a devDependency for this, rather than shelled
out to `npx postject`), sidestepping the whole shell question instead of
fighting it.

### Manual steps (what the script above automates)

```bash
cd ..

# 1. Bundle everything (TS source + all node_modules deps) into one CJS file,
#    with the control page's HTML inlined as a string at build time instead
#    of read from a sibling file at runtime (a packaged single-file exe
#    shouldn't depend on finding files next to itself on disk).
npx esbuild pkg-prototype/entry.ts --bundle --platform=node --format=cjs \
  --target=node20 --loader:.html=text --outfile=pkg-prototype/bundle.cjs

cd pkg-prototype

# 2. Generate the SEA (Single Executable Application) preparation blob —
#    Node's own built-in feature for this, no third-party packager needed.
node --experimental-sea-config sea-config.json

# 3. Copy node.exe itself as the base, then inject the blob into the copy.
cp "$(where node)" ./cdp-recorder.exe
npx postject cdp-recorder.exe NODE_SEA_BLOB sea-prep.blob \
  --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

# 4. Run it. That's the whole program — no other files needed alongside it.
./cdp-recorder.exe
```

## Why `pkg-prototype/entry.ts` exists instead of bundling `../src/main.ts` directly

`main.ts` loads `control-page.html` via `readFileSync(join(__dirname, ...))`,
where `__dirname` comes from `import.meta.url` — that doesn't survive
bundling to CJS (`import.meta` is empty in CJS output; Node's SEA format
currently wants a CJS main script). `entry.ts` is functionally identical to
`main.ts`, except the HTML is `import`ed directly so esbuild's `text` loader
inlines its contents as a plain string at build time. If Step 2 goes ahead,
`main.ts` itself should probably switch to this import style instead of
keeping two near-duplicate entry points — this is the *correct* fix, not a
packaging-specific workaround, since a single-file exe genuinely shouldn't
need a sibling file to find.

## Verified, not assumed

Ran the resulting `cdp-recorder.exe` directly (no `node`, no `npx`, no
project folder needed — copied nothing else alongside it): it found Edge,
launched the dedicated recording browser, connected over CDP, started
serving `http://localhost:8787`, and opened the floating toolbar — all
exactly as `npm start` does. Drove a full `start` → `status` → `quit` cycle
against its HTTP API and confirmed zero leftover `msedge.exe` or
`cdp-recorder.exe` processes afterward.

## Two real caveats — read before building Step 2

1. **The resulting `.exe`'s code signature is invalidated.** `postject`
   prints `warning: The signature seems corrupted!` during injection — it's
   modifying a copy of the official, Microsoft/OpenJS-Foundation-signed
   `node.exe`, which invalidates that signature. This is expected and
   documented behavior for SEA on Windows, not something unique to this
   build. **But**: "take a legitimate signed binary and inject a payload
   into it" is also a generic malware pattern, and this is a bank's
   corporate-managed environment that has *already* blocked unrelated
   things (extension installs) on far less suspicious grounds. A
   signature-invalidated executable has a real chance of being flagged or
   blocked by corporate AV/EDR, or by Windows SmartScreen, independent of
   whether the code inside it is doing anything untoward. **This needs a
   real-world test on an actual corporate-managed machine before relying on
   it**, the same way Phase 0's CDP-access question did — a clean result
   here proves the packaging mechanism works, not that it will be let
   through where it needs to run. Signing the final `.exe` with a real
   certificate (if your organization has a code-signing process) would be
   the proper fix, not something to skip.
2. **A deprecation warning prints on every launch**
   (`DEP0169: url.parse() behavior is not standardized...`) — harmless,
   comes from a dependency (not this project's own code), but worth
   suppressing with `--no-deprecation` or similar in the final build so it
   doesn't look like something is wrong on every launch.

## Step 2 progress

- [x] **Tested the actual `.exe` on the real corporate-managed machine** —
  ran clean, no AV/EDR block, no SmartScreen block (2026-10-02). Caveat 1
  above is resolved, at least on that machine/profile.
- [x] **`npm run build:exe`** — one-command build (`scripts/build-exe.mjs`),
  see above.
- [x] **CORS on `server.ts`** — the shared `/converter` page can now call
  this local server's API directly from the browser.
- [x] **`/downloads/cdp-recorder` route** on the main `server.js` — serves
  `dist/cdp-recorder.zip` (falls back to `dist/cdp-recorder.exe`) for direct
  download, same pattern as the existing extension distribution route.
- [ ] Fold `entry.ts`'s approach back into the real `src/main.ts` (one entry
  point, not two) — still outstanding, not blocking anything.
- [ ] The custom URL protocol registration discussed with the user, so a
  real link on the shared `/converter` page hands off to this exe directly
  instead of a plain download link — deferred; needs a registry change,
  which may hit the same kind of corporate lockdown the extension install
  did, so not pursued without confirming it's viable first.
