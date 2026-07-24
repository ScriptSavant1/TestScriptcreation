# LRE Toolkit — Troubleshooting

**Version:** 2.9.2 | **Date:** May 2026

---

## Conversion Errors

### "Conversion failed — Invalid JSON"

**Cause:** The uploaded collection file is not valid JSON, or it's a different format than expected.

**Fix:**
- Re-export from Postman: File → Export → Collection v2.1 → Save
- Re-export from Bruno: use the official Bruno export function
- Open the file in a text editor — check the first few characters match `{` for JSON or the correct YAML format

### "Conversion failed — Unsupported collection format"

**Cause:** The collection doesn't match any recognized format.

**Fix:**
- Postman: ensure you exported as Collection v2.1 (not v1.0)
- Bruno: try exporting as JSON instead of YAML, or vice versa
- JMX: ensure the file is a valid JMeter Test Plan saved from JMeter

### "Conversion failed — TypeError: Invalid URL"

**Cause:** A URL in the collection contains `{{variable}}` placeholders and the toolkit attempted to parse it as a URL.

**Fix:** This is a toolkit bug — please report it with the collection file (with credentials removed). Workaround: upload an environment file with values for all `{{variable}}` placeholders.

---

## Download Problems

### "Download link expired or invalid"

**Cause:** Download links are single-use and expire after 5 minutes.

**Fix:** Run the conversion again — it only takes seconds.

### "ZIP file is empty" or "ZIP file is corrupt"

**Cause:** The conversion may have completed with an error that was silently caught.

**Fix:**
1. Try the conversion again
2. If it consistently fails, open your browser's Developer Tools (F12), go to the Network tab, and check what the server responds with for the conversion request
3. Report the error to the performance engineering team

### "The download didn't start"

**Cause:** Corporate proxy or firewall blocking the download. The toolkit uses chunked transfer encoding and `Content-Type: application/octet-stream` specifically to bypass common proxy filters.

**Fix:**
- Try a different browser
- Check if your browser has a download blocking extension
- If on a corporate VPN, try without VPN (if permitted) or contact network support

---

## VuGen Errors

### "Script replay fails — 401 Unauthorized"

**Cause:** An access token or session ID is hard-coded (not correlated) and is now expired.

**Fix:**
1. Open VuGen's Extended Log (Replay → Log → Enable extended log)
2. Run the script
3. Find the first 401 response in the log
4. Identify which request sent the expired value
5. Look backwards in the script for where that value should have been extracted from a previous response
6. Add or fix the `web_reg_save_param_json` / `web_reg_save_param` extractor

For Script Studio users: re-run with 2 HARs for better correlation coverage.

### "VuGen Parameters panel crashes when opening ParameterFile.prm"

**Cause:** A PEM key or multiline value was written to the parameter file. PEM keys cannot be stored in VuGen parameter files.

**Fix:** This is a known-fixed issue in v2.9.0+. If you encounter it:
1. Open `ParameterFile.prm` in a text editor
2. Find the parameter with a multiline value (PEM key starts with `-----BEGIN`)
3. Delete that parameter section from the `.prm` file
4. Store the PEM key in a separate `.pem` file and reference it in the script

### "VuGen compile error — variable declaration after statement"

**Cause:** C89 requires all variable declarations at the top of the function. If a declaration appears after any non-declaration statement, it fails to compile.

**Fix:** This is a bug in the generator — please report it. As a workaround, move the offending declaration to the top of the function.

### "lre-utils.dat not found"

**Cause:** VuGen can't find the `lre-utils.dat` file.

**Fix:**
1. Ensure `lre-utils.dat` is in the same folder as your script (check the ZIP extraction)
2. Verify the `.usr` file has `lre-utils.dat=` in the `[ManuallyExtraFiles]` section
3. In VuGen, go to Script → Manage Extra Files and add `lre-utils.dat` manually

### "Invalid PKCE challenge" (server error during replay)

**Cause:** The PKCE challenge is being re-used across iterations (the script is not regenerating it per iteration).

**Fix:** The `generatePkce()` call in `Action.c` (or the PKCE block in `action()` for DevWeb) must run at the very start of each iteration, before the authorization request. Verify the code placement in the generated script.

---

## Script Studio Issues

### "Analyze completes but no correlations found"

**Cause (1-HAR mode):** All values in the recording are static — the application doesn't use dynamic session management.

**Cause (2-HAR mode):** Both HAR files are from the same session or use the same credentials.

**Fix for 2-HAR:** Ensure the two recordings use genuinely different user accounts. Clear browser session between recordings.

### "Many TODO placeholders in the generated script"

**Cause:** Bearer tokens were found in request headers but their source couldn't be traced to a response in the recording.

**Fix:**
1. Record more completely — start the recording before the application's home page
2. The TODO tokens were probably acquired before the recording started
3. Use 2-HAR mode — it's better at tracing these

### "Script generates but DPoP proofs are rejected by the server"

**Cause:** DPoP nonce required but not captured in the HAR.

**Fix:**
1. Re-record the journey specifically to capture the DPoP-Nonce response header
2. In the generated script, find the correlation for `dpop_nonce` and verify it's extracting from the correct response

---

## IIS / Deployment Issues

### "Application returns 502 Bad Gateway"

**Cause:** The Node.js process has crashed or failed to start.

**Fix:**
1. Check iisnode error logs: `C:\inetpub\lre-toolkit\iisnode\` (or wherever configured)
2. Check the application event log in Windows Event Viewer
3. Try running `node app.js` manually in the project directory — error will appear in console
4. Ensure Node.js 18 LTS is installed: `node --version`
5. Ensure npm packages are installed: `npm install`

### "Application returns 404 for all routes"

**Cause:** IIS URL rewrite rules not configured correctly.

**Fix:** Review `web.config` — ensure the rewrite rule for `iisnode` is present and the `app.js` entry point matches.

See [IIS Deployment Guide](../deployment/DEPLOYMENT-IIS.md) for the correct `web.config` content.

### "Upload fails — 413 Request Entity Too Large"

**Cause:** IIS or iisnode request size limit exceeded.

**Fix:** In `web.config`, increase the `maxAllowedContentLength` and `maxRequestLength` settings. See [Deployment Guide](../deployment/DEPLOYMENT-IIS.md).

### "Upload fails intermittently on large files"

**Cause:** Corporate proxy timeout.

**Fix:** The toolkit uses chunked transfer for downloads specifically to bypass proxy size limits. For uploads, ensure the IIS request timeout is sufficient (`requestTimeout` in iisnode config).

---

## Feature Questions

### "My collection has Bearer tokens — why aren't they correlated?"

Bearer tokens are correlated if their value can be traced back to a server response in the collection. If the token is:
- A static test token: it will be classified as a Tier 2 Config parameter (correct — it won't change)
- An OAuth2 token not obtained within the collection: you need to include the `/token` endpoint request in your collection

### "Why is my private key appearing in collection_data.csv?"

If a PEM key or other crypto material ends up in the CSV, it means the variable name pattern didn't match the private-key classifier. Please report the variable name so the classifier can be updated. As a workaround, manually move the value from CSV to a separate `.pem` file.

### "The script uses the same username for all VUsers"

The variable is classified as Tier 2 Config (same value for all VUsers) rather than Tier 3 TestData (different per VUser). This happens when the variable name doesn't match credential patterns.

**Fix:** Ensure the variable is named something recognizable as credentials: `username`, `user`, `login`, `email`, `password`, `pass`, `credential`, etc. If the name is unusual, the classification might miss it — contact the performance engineering team.

---

## Getting Help

If you encounter an issue not covered here:

1. Check the error message carefully — most issues include a description
2. Try a different browser (Chrome or Edge recommended)
3. Contact the Performance Engineering team
4. Provide: the error message, the tool and format used, and the toolkit version (shown in the top navigation bar)

Do NOT share collections or HAR files containing production credentials. Sanitize test data before sharing.

---

*See also: [Getting Started](GETTING-STARTED.md) | [Converter Guide](CONVERTER-GUIDE.md) | [Studio Guide](STUDIO-GUIDE.md)*
