# Comparison tools

Scripts that prove a change did not alter behaviour by comparing old and new. Everything they produce stays out of git (see `.gitignore` here): baselines, runs, fixtures, inputs and test keys.

Browser tools use Microsoft Edge through the CDP Recorder's `playwright-core`, so run `npm install` in `cdp-recorder/recorder/` once. Start the portal first with `npm run web`. Never point these tools at a CDP Recorder someone is using on port 8787.

| Folder | Compares | Run |
|---|---|---|
| `studio/` | Script Studio output | `node make-fixtures.js` once, then `node harness.js <page URL> <out folder>` and `node compare.js <old> <new>` |
| `converter/` | Postman / Bruno and JMeter panels | `node make-inputs.js` once, then `node harness.js <portal URL> <out folder>` and `node compare.js <old> <new>` |
| `help/` | Help text, word by word | `node capture.js <portal URL> baseline.json`, again to `next.json` after the change, then `node diff.js` |
| `audit/` | Fonts, weights, contrast and shapes on every section (`audit.js`); HAR Explorer against Script Studio (`hx-parity.js <files>`: every request's transaction and left-out reason); screen walk-through (`hx-ui.js`) | `node audit.js [out folder]` |
| `engines/` | What generated scripts really send, on the real VuGen and DevWeb engines through a local test proxy | `node runvugen.js <script folder> <out folder> [--har=<file>]`, `node rundevweb.js ...`, `node wirediff.js ...`; `node studioextract.js <studio url> <out folder>` (Script Studio's Regex and XPath extractors, lists — every value as recorded, one at random, the next each iteration, always the Nth, a `<select>` among others — on both engines against a copy of the recording with new values; `--only=<name>`) |

Take the baseline from the code before the change, for example from a second working copy.

The server allows 60 conversions per 5 minutes per address; the converter harness sends a different `X-Forwarded-For` per run.

`engines/` needs VuGen installed in its default folder, and a throwaway certificate for the proxy in `engines/mock.key` and `engines/mock.crt`:

```bash
openssl req -x509 -newkey rsa:2048 -nodes -days 365 -subj "/CN=localhost" -keyout mock.key -out mock.crt
```

`withkeys.js` adds throwaway keys to the sample collections. Some tools can also use local samples in `collection-examples/`, which is not in git. Never add real recordings or client data here.
