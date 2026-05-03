# LRE Toolkit — HAR Recorder Guide

**Version:** 2.9.2 | **Date:** May 2026

---

## Why the Recorder?

VuGen's built-in proxy recording is frequently blocked on VCSE (Virtual Client Service Environment) and Azure Virtual Machines due to corporate security policies. The Recorder works around this by capturing network traffic using your browser's built-in Developer Tools — no installation, no admin rights, no proxy configuration required.

---

## How HAR Recording Works

When you open browser Developer Tools (F12), the Network tab captures every HTTP request your browser makes. You can export these as a **HAR (HTTP Archive)** file — a JSON file containing all requests, responses, headers, and bodies.

The Recorder reads this HAR file and generates a VuGen script from it.

---

## One-Time Setup: Bookmarklet

The Recorder includes a bookmarklet that makes HAR recording easier by providing visual feedback and cleaner exports.

### Installing the Bookmarklet

1. Open the **Recorder** tool
2. Click the **Bookmarklet Setup** instructions
3. Drag the **Start Recording** bookmark link to your browser bookmarks bar
4. Repeat for the **Stop Recording** bookmark

### Using the Bookmarklet

1. Navigate to the application home page
2. Click the **Start Recording** bookmark — the page title changes to indicate recording
3. Complete your user journey
4. Click the **Stop Recording** bookmark — it automatically exports the HAR

If you prefer to use DevTools directly (without the bookmarklet), follow the standard export steps below.

---

## Recording Without the Bookmarklet (Manual Method)

### Chrome

1. Navigate to the application
2. Press **F12** or right-click → **Inspect**
3. Click the **Network** tab
4. Ensure the **Record** button (red circle) is active — if not, click it
5. Clear the network log by clicking the **Clear** button (circle with line)
6. Perform your user journey
7. After completing the journey, click the **Export HAR** button (download arrow icon in the Network toolbar)
8. Save the `.har` file

### Firefox

1. Press **F12**
2. Click the **Network** tab
3. Click the **cog icon** (settings) → ensure "Persist logs" is on
4. Perform your journey
5. Right-click any request → **Save All As HAR**

### Edge

Same as Chrome — Edge uses the same Chromium DevTools.

### Chrome NetLog (for capturing hidden browser requests)

For applications that use Chrome internals, popups, or service workers that don't appear in normal DevTools:

1. Open a new Chrome tab and go to `chrome://net-export/`
2. Click **Start Logging to Disk**, choose a save location
3. Open your application in another tab and perform the journey
4. Return to `chrome://net-export/` and click **Stop Logging**
5. Upload the resulting `.json` file (select Chrome NetLog format in the Recorder)

---

## Using the Recorder Tool

### Step 1: Upload your HAR

1. Open the **Recorder** from the navigation
2. Drag your `.har` file into the drop zone, or click to browse

### Step 2: Filter domains

After upload, a list of all domains captured in the recording appears. Uncheck:
- Analytics services (Google Analytics, Adobe Analytics, Dynatrace, etc.)
- CDN domains (fonts.googleapis.com, cdnjs.cloudflare.com, etc.)
- Error monitoring (Sentry, Datadog, etc.)
- Any domain not part of the application being tested

Keep only:
- Your application's own domain(s)
- Backend API domains
- Authorization server domains

### Step 3: Group into transactions (optional)

Transactions define logical steps in the performance test. They let LoadRunner report response time for each step separately (e.g. "Login took 1.2s", "Search took 0.8s").

1. In the request list, drag the first request of a logical step to the **transaction start** zone
2. Name the transaction (e.g. "T01_Login")
3. Repeat for each logical step

If you skip this step, the toolkit auto-generates transaction names based on request names (`T01_GetPage`, `T02_PostLogin`, etc.).

### Step 4: Choose output format and generate

1. Select **DevWeb (JS)** or **Web HTTP/HTML (C)**
2. Set think time (pause between requests): 1s, 2s, 3s, or 5s
3. Click **Generate Script**
4. Click **Download ZIP**

---

## What the Recorder Filters Out Automatically

| Filtered | Reason |
|---|---|
| 3xx redirects | VuGen follows them automatically |
| Static assets (images, CSS, JS bundles, fonts) | Handled by resource-level settings, not script |
| Browser pre-fetch requests | Not relevant to the user journey |
| OPTIONS preflight requests | Not part of the actual API flow |
| WebSocket frames | Not supported by Web HTTP/HTML protocol |

---

## Recorder vs Script Studio — Which to Use?

| Scenario | Recommendation |
|---|---|
| Quick one-off conversion | Recorder only |
| Application with complex auth/tokens | Recorder → then Script Studio for better correlation |
| Production-quality script | Script Studio with 2 HARs |
| No time for two recordings | Script Studio with 1 HAR |

**Tip:** Use the Recorder when you just need a starting point. Use Script Studio when you need the most reliable correlation. You can use the HAR from the Recorder as input to Script Studio.

---

## Tips

**Record from the start**  
Always start recording before navigating to the application's home page. This ensures the toolkit captures the authentication flow from the very beginning.

**Complete the full journey**  
Include login, all the pages/actions you want to test, and logout (if applicable). Partial recordings produce incomplete scripts.

**Use realistic data**  
Log in with a test account that has realistic data in its profile (not an empty account). This ensures the script handles all the response structures your users will see.

**Avoid recording on slow connections**  
A very slow network can produce long think times in the recorded requests. Use your normal corporate network when recording.

---

*See also: [Getting Started](GETTING-STARTED.md) | [Studio Guide](STUDIO-GUIDE.md) | [Troubleshooting](TROUBLESHOOTING.md)*
