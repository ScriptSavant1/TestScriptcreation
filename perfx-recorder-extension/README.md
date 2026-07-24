# PerfX Studio Recorder — Chrome Extension

Browser extension that records network traffic across all tabs (including bank popup windows) and exports a HAR file to PerfX Studio for script generation.

## Folder layout

```
perfx-recorder-extension/
├── manifest.json               MV3 manifest
├── background/
│   ├── service-worker.js       SW entry — session lifecycle, port management
│   ├── cdp-capture.js          Chrome DevTools Protocol network capture
│   └── har-builder.js          HAR 1.2 assembler from raw CDP events
└── sidepanel/
    ├── sidepanel.html          Side panel markup
    ├── sidepanel.js            Side panel UI controller
    └── sidepanel.css           Styles (light + dark theme)
```

## Development install (unpacked)

1. In Chrome/Edge, open `chrome://extensions` (or `edge://extensions`)
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked** → select this `perfx-recorder-extension/` folder
4. Pin the extension icon to the toolbar
5. Click the icon to open the side panel, then click **Start Recording**

## Enterprise install (managed Chrome/Edge without admin rights)

See `Docs/EXTENSION-RECORDER-PLAN.md §Installation` for Group Policy + forcelist options.
The 2-step workaround using an Edge dev profile is also documented there.

## Phase completion status

| Phase | Title                     | Status        |
|-------|---------------------------|---------------|
| 1     | Extension Foundation      | ✅ Complete    |
| 2     | Transaction Support       | ✅ Complete    |
| 3     | Background Detection      | ✅ Complete    |
| 4     | PerfX Studio Review UI    | ✅ Complete    |
| 5     | Script Generation Updates | ✅ Complete    |

## Architecture notes

- **CDP via `chrome.debugger`** — captures all tabs; auto-attaches to new popup tabs opened during recording
- **Side panel** (Chrome 114+) — stays open while user navigates; no popup auto-close problem
- **Long-lived port** (`chrome.runtime.connect`) — keeps service worker alive during recording, enables real-time COUNT_UPDATE/SETTLED messages
- **Settled signal** — 500 ms of zero active requests triggers green "settled" indicator; signals user it's safe to start the next action
- **HAR 1.2** output — compatible with existing PerfX Studio HAR upload pipeline
- **`_perfx_*` custom fields** in HAR entries — Phase 3 populates `_perfx_class`, `_perfx_interval`, etc. Old HAR uploads without these fields are unaffected
