# Workload Modeller

Designs a LoadRunner Enterprise scenario from what each script must reach. Part of PerfX Studio (sidebar → **Plan** →
**Workload Modeller**); it runs in the user's browser like the Results Analyser — scripts, HAR files and Excel sheets are
read on the user's PC and never sent to the server.

## What it does

- Each script gets a **target**: TPS, transactions per hour, a number of Vusers, a share of the total TPS, or a number
  of iterations. A response time (an SLA will do) lets the tool choose the pacing.
- The modeller works out the **Vusers**, **pacing**, **ramp-up and ramp-down**, the **load generators** and the
  iterations, checks what cannot work, and shows how every number is worked out.
- Output: the LRE settings to type in (Copy LRE settings) and a one-sheet Excel file for the LRE scenario.
- Team settings: `config/workload-settings.json` (machine types and their Vusers per machine, load-generator limits,
  schedule defaults, protocol assumptions) — edit on the server, read by every page when it opens.
- **Fill from scripts**: script ZIPs (Web HTTP/HTML, DevWeb; several scripts per ZIP) and HAR files give each script's
  transactions, think time and requests. Transactions in `vuser_init` / `vuser_end` (`load.initialize` /
  `load.finalize`) run once per Vuser and are not counted.
- Many scripts: Cards or Table view, Find and filter, Overwrite all scripts, Defaults for every script, Paste from Excel,
  and an Excel sheet to fill in and drop back.

The rule behind every number: TPS = Vusers × transactions per iteration ÷ pacing, and the pacing must be at least one
iteration (response times + think time). Every formula, in plain words with a worked example: [docs/USER-GUIDE.md](docs/USER-GUIDE.md)
§6 (the same list is on the page: How it is worked out → All the formulas). The developer spec: [docs/SPEC.md](docs/SPEC.md).

Load generators are chosen by machine type: the on-premise Windows servers (8 cores, 32 GB), AWS c6a.4xlarge Linux or
Windows (16 vCPU, 32 GB), or another machine. The list is `LG_TYPES` in `web/app.js`.

## Layout

| Folder | What |
|---|---|
| `engine/` | `workload-engine.js` (every formula) and `script-reader.js` (script ZIPs and HAR) — UMD, browser and Node |
| `web/` | The page: `index.html`, `app.css`, `app.js` (model and screen), `excel.js` (Excel files), `page.js` (page behaviour) |
| `tests/` | Jest tests (engine, review fixes, script reader) |
| `docs/` | [User guide](docs/USER-GUIDE.md) (also every formula, with a worked example), [spec](docs/SPEC.md), [implementation plan](docs/IMPLEMENTATION-PLAN.md), [table and Excel plan](docs/TABLE-AND-EXCEL-PLAN.md) |

Shared with the rest of PerfX Studio, never copied: `portal/ds.css` (design system), `portal/frame-guard.js`,
`portal/track.js`, and the Results Analyser's `web/zip.js` and `web/vendor/exceljs.min.js` (the Excel library is loaded
only the first time Excel is used).

Served by `src/web/server.js`: the page at `/workload-modeller`, static files at `/wm` and `/wm/engine` (each also under
`/converter`).

## Tests

```bash
npx jest workload-modeller
```

Usage statistics record the feature used (Excel, scripts sheet, Copy LRE settings, Fill from scripts) and the number of
scripts — never names, files or values.
