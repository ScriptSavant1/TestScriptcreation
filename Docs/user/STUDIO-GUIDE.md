# LRE Toolkit — Script Studio Guide

**Version:** 2.9.2 | **Date:** May 2026

---

## What is Script Studio?

Script Studio is a browser-based correlation engine. It takes one or two browser HAR recordings and generates a VuGen script where all dynamic values (tokens, session IDs, CSRF values, correlation IDs) are already extracted and reused correctly.

**Why use it?** Correlation is the hardest part of VuGen scripting. Without it, your script fails on the second run because it tries to use a session token from the recording session, which is no longer valid. Script Studio does this work for you.

---

## 1 HAR vs 2 HARs

### 2 HARs (Recommended)

Record the same user journey **twice** using different credentials or test data. Script Studio compares both recordings: any value that changed between the two runs is guaranteed to be dynamic (server-generated, not static).

**Result:** The most accurate correlation possible. Generates extractors only for values that actually change at runtime.

**When to use:** Any application with login, tokens, session management, or CSRF protection. This is the standard approach.

### 1 HAR

Uses pattern-based analysis to identify values that *look* dynamic (UUIDs, JWTs, long alphanumeric strings, timestamps). Faster but less complete than 2-HAR mode.

**Result:** Good for simple applications. May miss some correlations or over-correlate static values.

**When to use:** Quick analysis, simple applications with minimal session management, or when you can only record once.

---

## Step-by-Step: 2-HAR Mode

### 1. Record your first HAR

1. Open your application in Chrome/Firefox
2. Press **F12** to open Developer Tools
3. Go to the **Network** tab — ensure recording is on (red circle)
4. Log in and complete the full user journey you want to test
5. In the Network tab, click the **Export HAR** button (download icon) or right-click → Save all as HAR
6. Save the file as `recording1.har`

### 2. Record your second HAR

Important: Use **different credentials or different test data** for the second recording.

1. Close and reopen the browser (or use a private/incognito window) to clear session state
2. Repeat the exact same user journey with a different user account
3. Save as `recording2.har`

### 3. Generate the script

1. Open **Script Studio** in the LRE Toolkit navigation
2. Drag `recording1.har` into the **Recording 1** drop zone
3. Drag `recording2.har` into the **Recording 2** drop zone
4. Choose output format: **DevWeb (JS)** or **Web HTTP/HTML (C)**
5. Optionally: adjust the think time
6. Click **Analyze**
7. Review the results panel:
   - Number of correlations found
   - Number of parameters extracted
   - Authentication types detected
8. Click **Download ZIP**

---

## Step-by-Step: 1-HAR Mode

1. Record a single HAR (following steps 1 above)
2. Open **Script Studio**
3. Drag your HAR into **Recording 1** only (leave Recording 2 empty)
4. Choose format and click **Analyze**
5. Review results — note any **TODO** placeholders in the generated script (values that couldn't be traced to a source)
6. Download ZIP

---

## Understanding the Analysis Results

After clicking Analyze, the results panel shows:

| Metric | What it means |
|---|---|
| **Requests analyzed** | Total requests processed from your HAR |
| **Correlations found** | Dynamic values detected and extracted |
| **Parameters generated** | Variables added to the parameter file |
| **Auth type detected** | Authentication method found (e.g. OAuth2 + DPoP) |
| **Unresolved candidates** | Bearer tokens whose source couldn't be traced — shows as TODO in script |

---

## DPoP Detection

If your application uses DPoP (Demonstrating Proof-of-Possession), Script Studio detects the `dpop` header automatically and generates:
- EC P-256 key pair creation code (once per VUser)
- Per-request DPoP proof JWT generation
- The `lre-utils.dat` crypto utility file included in the ZIP

See [DPoP Guide](../technical/DPOP-GUIDE.md) for technical details.

---

## PKCE Detection

If your application uses PKCE (Proof Key for Code Exchange) in the OAuth2 flow, Script Studio detects:
- `code_challenge=` in authorization request URL
- `code_verifier=` in token exchange body

PKCE values are **not correlated** (they're client-generated, not server-issued). Instead, Script Studio generates runtime code to create fresh PKCE pairs per iteration. See [PKCE Guide](../technical/PKCE-GUIDE.md).

---

## TODO Placeholders

Some Bearer tokens cannot be traced to a source response — they may have been acquired before the recording started, or they came through a redirect chain not captured in the HAR. These appear as comments in the generated script:

```javascript
// TODO: Correlate Bearer token — could not find source in HAR.
// The value 'eyJ0eXAiOiJKV1QiL...' was used in request 5 (Authorization header)
// Add manual extraction code here or check for a prior login request.
```

For VuGen C:

```c
/* TODO: Add web_reg_save_param for 'Authorization' header value
   Source not found in HAR. Check if there's a preceding auth request. */
```

---

## Tips for Better Results

**Record a complete journey**  
Start from the very first request (the login or token acquisition). If your recording starts mid-session, the toolkit won't be able to trace tokens back to their source.

**Use the full flow**  
Include the entire user journey — from initial page load through all the steps. This ensures all tokens and session IDs appear in the right order.

**Two-HAR: use genuinely different credentials**  
If your two recordings use the same username/password, most values won't differ and correlation will be minimal. Use two distinct test accounts.

**Clear cookies before recording**  
If the browser reuses an existing session, the recording may not capture the authentication flow. Always start from a logged-out state.

**Check filter settings**  
Script Studio automatically filters out static assets (images, CSS, fonts). If you notice a request missing, check the domain filter.

---

## Downloading and Using the Output

1. After analysis completes, click **Download ZIP**
2. Extract to a local folder
3. Open the `.usr` file in VuGen
4. Review the generated script
5. Check the TODO comments and complete them if needed
6. Run a single-VUser replay to verify the script works
7. Upload to LoadRunner Enterprise for load testing

---

*See also: [Getting Started](GETTING-STARTED.md) | [Recorder Guide](RECORDER-GUIDE.md) | [Troubleshooting](TROUBLESHOOTING.md)*
