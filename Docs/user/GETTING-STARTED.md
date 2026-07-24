# LRE Toolkit — Getting Started

**Version:** 2.9.2 | **Date:** May 2026

---

## What is the LRE Toolkit?

The LRE Toolkit is an internal web application that converts API test collections, JMeter scripts, and browser recordings into ready-to-run LoadRunner Enterprise (LRE) performance test scripts.

It handles the most time-consuming parts of VuGen scripting automatically:
- Dynamic value extraction (correlation)
- Test data parameterization  
- Authentication setup (OAuth2, JWT, DPoP, NTLM, Bearer, API Key)
- All required configuration files

**Your script will be ~80% complete when you download the ZIP.** You open it in VuGen, review, add any application-specific logic, and run.

---

## The Three Tools

| Tool | Best for | Input |
|---|---|---|
| **Converter** | You have a Postman/Bruno collection or JMeter script | `.json`, `.yml`, `.bru`, `.jmx` |
| **Recorder** | You need to record a browser session (especially on VCSE/Azure VMs) | Browser HAR export |
| **Script Studio** | You want the most accurate correlation (using 2 recordings) | 1 or 2 `.har` files |

**Not sure which to use?** If you have a Postman collection from the dev team → use Converter. If you need to record a web journey → use Recorder first, then optionally Script Studio.

---

## Quick Start: Converter

1. Navigate to the toolkit in your browser
2. Click **Converter** in the top navigation
3. Choose your output format:
   - **DevWeb (JS)** — recommended for new projects, LRE 2021+
   - **Web HTTP/HTML (C)** — for existing projects or older LRE versions
4. Drag your Postman or Bruno collection onto the upload zone
   - Optionally: drag an environment file to fill in variable values
5. Adjust options:
   - Think time between requests
   - Enable/disable transactions
   - Single script vs Multi-script (one per folder)
6. Click **Convert**
7. Click **Download ZIP** when complete
8. Extract the ZIP, open the `.usr` file in VuGen

Total time for a typical collection: **under 1 minute**

---

## Quick Start: Recorder (VCSE/Azure VMs)

1. Click **Recorder** in the navigation
2. Follow the **Bookmarklet Setup** instructions (one-time setup — installs a bookmark in your browser)
3. Navigate to the application you want to test
4. Open browser DevTools (F12), go to the Network tab, ensure recording is on
5. Complete your user journey (login, navigate, submit)
6. In DevTools: right-click the network panel → Export HAR (or click the download icon)
7. Upload the `.har` file in the Recorder tool
8. Uncheck domains you don't want (analytics, CDNs, etc.)
9. Optionally: group requests into named transactions
10. Choose output format and click **Generate Script**
11. Download the ZIP

---

## Quick Start: Script Studio (Best Correlation)

1. Record the same user journey **twice** using different test credentials
2. Export both as `.har` files
3. Click **Script Studio** in the navigation
4. Upload **Recording 1** and **Recording 2**
5. Choose output format (DevWeb or Web HTTP/HTML)
6. Click **Analyze**
7. Review the correlation results
8. Download the ZIP

---

## Output Formats — Which to Choose?

| Question | Answer |
|---|---|
| What version of LRE is your project on? | 2021+ → DevWeb; older → Web HTTP/HTML |
| Are you creating a new script? | DevWeb recommended |
| Are you extending an existing VuGen C script? | Web HTTP/HTML |
| Are you unsure? | Ask your performance engineering lead, or use DevWeb |

---

## What's in the ZIP?

### DevWeb output

```
MyScript/
├── main.js               ← Your script — open this in VuGen or an editor
├── MyScript.usr          ← VuGen project file — double-click to open in VuGen
├── rts.yml               ← Runtime settings (think time, proxy, SSL)
├── scenario.yml          ← Scenario config
├── parameters.yml        ← Parameter declarations
├── collection_data.csv   ← Test data (usernames, passwords, config values)
└── ScriptUploadMetadata.xml
```

### VuGen C output

```
MyScript/
├── Action.c              ← Your script
├── vuser_init.c          ← Initialization code
├── vuser_end.c           ← Cleanup code
├── globals.h             ← Variable declarations
├── MyScript.usr          ← VuGen project file
├── default.cfg           ← Runtime settings
├── ParameterFile.prm     ← Parameter file (INI format)
└── collection_data.dat   ← Test data
```

---

## Opening in VuGen

1. Extract the ZIP to a folder
2. Double-click `ScriptName.usr`
3. VuGen opens the complete project
4. Review `main.js` (DevWeb) or `Action.c` + `vuser_init.c` (Web HTTP/HTML)
5. Run → Replay the script once to verify
6. Fix any application-specific issues (the toolkit handles ~80%; you handle the rest)

---

## Uploading to LoadRunner Enterprise

1. In LRE, go to **Script Management**
2. Click **Upload** (or **Add from file system**)
3. Upload the `.zip` file (or the `.usr` file if LRE supports direct upload)
4. Configure VU count, duration, pacing in the scenario
5. Run

---

## Common First-Time Questions

**Why does my script fail on replay?**  
The most common reason is missing or incomplete correlation. Open VuGen's Replay log to see which request failed and what the error message says. If it's a 401/403 with "token expired", the correlation for the access token may need review.

**The download link expired — what do I do?**  
Download links are single-use and expire after 5 minutes. Just run the conversion again — it takes seconds.

**My Postman collection has {{variables}} everywhere. Will it work?**  
Yes. Upload your environment file alongside the collection. The toolkit reads variable values from the environment and fills them in. Variables without environment values are generated as parameter file entries for you to fill in.

**Should I use 1 HAR or 2 HARs in Script Studio?**  
Always prefer 2 HARs if possible — it gives dramatically more accurate correlation. Use 1 HAR for quick tests or when you can only record once.

---

*See also: [Converter Guide](CONVERTER-GUIDE.md) | [Studio Guide](STUDIO-GUIDE.md) | [Recorder Guide](RECORDER-GUIDE.md) | [Troubleshooting](TROUBLESHOOTING.md)*
