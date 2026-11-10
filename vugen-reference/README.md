# VuGen reference files

The project files a new VuGen script starts from, one folder per VuGen version, copied unchanged from the VuGen install. `tests/unit/vugenReference.test.js` checks that every tool (both converters, Recorder, Script Studio) still writes what this version needs, for both protocols.

| Folder | Protocol | Copied from |
|---|---|---|
| `<version>/DevWeb/` | DevWeb | `<VuGen install>\template\DevWeb\` |
| `<version>/qtweb/` | Web HTTP/HTML | `<VuGen install>\template\qtweb\` |

`version.json` names the version the tools generate (`current`) and the version written into each `.usr` file (`usrVersion`). The template `.usr` files hold placeholders, because VuGen writes the real version when it saves a script.

## When a new VuGen version arrives

1. Copy the two template folders of the new install into a new folder, for example `27.1/DevWeb/` and `27.1/qtweb/`. Never copy recorded scripts here: they hold real data from the browser.
2. List what changed: `node vugen-reference/compare.js 26.3 27.1`.
3. Set `current` and `usrVersion` in `version.json`, then run `npx jest tests/unit/vugenReference.test.js`. Each failure names the tool and the setting to update.
4. Decide every change, update the generators, and prove the scripts on the real engines (`regression-tests/tools/engines/`).
5. Keep the previous version folder until the new one is in use everywhere, then delete it.

A setting VuGen writes only when a script is recorded or its Runtime Settings are saved is not in these templates, and a setting missing from a template is not removed from the engine. Check the engine before removing anything.
