# Comparison tools

Scripts that prove a change did not alter behaviour by comparing old and new. Everything they produce stays out of git (see `.gitignore` here): baselines, runs, fixtures, inputs and test keys.

Browser tools use Microsoft Edge through the CDP Recorder's `playwright-core`, so run `npm install` in `cdp-recorder/recorder/` once. Start the portal first with `npm run web`. Never point these tools at a CDP Recorder someone is using on port 8787.

| Folder | Compares | Run |
|---|---|---|
| `studio/` | Script Studio output | `node make-fixtures.js` once, then `node harness.js <page URL> <out folder>` and `node compare.js <old> <new>`; `node walk.js [studio URL]` clicks through the page as a user would (every Undo must give the script before, exactly); `node behave.js <old URL> <new URL>` does the same user actions on an older version (`serve-old.js`) and on the present one and lists every difference — run it for every change of the page, each difference is agreed with the owner or is a fault |
| `converter/` | Postman / Bruno and JMeter panels | `node make-inputs.js` once, then `node harness.js <portal URL> <out folder>` and `node compare.js <old> <new>`; `node walk.js [portal URL]` clicks through the page as a user would |
| `portal/` | Home and Help, old portal against new | `git archive <commit> | tar -x -C <folder>`, in it `NODE_PATH=<repo>/node_modules PORT=3989 node src/web/server.js`; `node behave.js <old portal URL> <new portal URL>` (every Home link's destination, every Help section's words, sidebar list, Previous / Next, search, FAQ, the look); `node walk.js [portal URL]` |
| `explorer/` | HAR Explorer, old page against new | `git archive <commit> | tar -x -C <folder>`, in it `NODE_PATH=<repo>/node_modules PORT=3989 node src/web/server.js`; `node behave.js <old page URL> <new page URL> [--dump=<dir>]` (two recordings: every request × every tab, Copy URL / cURL, Hide secrets, filters, domains, Find a value for each suggestion, folding, the look); `node walk.js [page URL]` (the newer parts, four widths, both themes) |
| `analyser/` | Results Analyser, old page against new | `git archive <commit> lre-results-analyser src/web/public | tar -x -C <folder>`, then `node serve.js <folder> 3990` and `node serve.js "" 3991`; `node behave.js <old URL> <new URL> [--zip=<run.zip>]` (default: `qa/demo-run.zip`, made by `lre-results-analyser/tools/make-demo-run.js`) — every tab, the drawer, settings, charts, every export file and the look of every kind of element |
| `workload/` | Workload Modeller, old page against new | `git archive <commit> workload-modeller src/web/public lre-results-analyser/web | tar -x -C <folder>`, then `node serve.js <folder> 3993` and `node serve.js "" 3994`; `node behave.js <old URL> <new URL>` (plan, results, LRE settings, every Excel sheet, filled scripts — every difference listed); `node walk.js [URL]` (the test types and the layout, as a user) |
| `help/` | Help text, word by word | `node capture.js <portal URL> baseline.json`, again to `next.json` after the change, then `node diff.js` |
| `audit/` | Fonts, weights, contrast and shapes on every section (`audit.js`); every screen control by control — overlap, clipped text, unnamed controls, keyboard focus, sideways scroll (the page, or a control reachable only by scrolling a panel sideways), a button with words that looks like plain text, a pop-up a click outside does not close (it opens each pop-up and lists the ones it tested) — at the widths and themes asked, with a JPEG per screen (`review.js [out] [--sizes=…] [--themes=…] [--only=…]`; `--selftest` proves each check on planted problems); HAR Explorer against Script Studio (`hx-parity.js <files>`: every request's transaction and left-out reason); screen walk-through (`hx-ui.js`) | `node audit.js [out folder]`; a mockup with the same checks, and main button in view, nothing touching, cut off or covered by a floating bar, every inventory item on a screen: `node mock.js <mockup.html> [--inventory=<file.md>]` |
| `engines/` | What generated scripts really send, on the real VuGen and DevWeb engines through a local test proxy | `node runvugen.js <script folder> <out folder> [--har=<file>]`, `node rundevweb.js ...`, `node wirediff.js ...`; `node studioextract.js <studio url> <out folder>` (Script Studio's Regex and XPath extractors, lists — every value as recorded, one at random, the next each iteration, always the Nth, a `<select>` among others, the Correlation Advisor's own select list — on both engines against a copy of the recording with new values; `--only=<name>`) |

Take the baseline from the code before the change, for example from a second working copy.

The server allows 60 conversions per 5 minutes per address; the converter harness sends a different `X-Forwarded-For` per run.

The runners take an unpacked script folder (unzip a downloaded ZIP first). To prove a change to generated random values (UUIDs, tokens), read them from `wire.jsonl`: a version 4 UUID never starts with `0000`.

`engines/` needs VuGen installed in its default folder, and a throwaway certificate for the proxy in `engines/mock.key` and `engines/mock.crt`:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" -keyout mock.key -out mock.crt
```

`withkeys.js` adds throwaway keys to the sample collections. Some tools can also use local samples in `collection-examples/`, which is not in git. Never add real recordings or client data here.
