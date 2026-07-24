# LRE Toolkit — Feature Catalog

**Version:** 2.9.2 | **Date:** May 2026  
*Written for non-technical stakeholders. No code knowledge required.*

---

## What the toolkit does — in plain English

The LRE Toolkit takes test scripts from tools your development and QA teams already use — Postman, Bruno, JMeter, or a browser recording — and converts them into the format required by **LoadRunner Enterprise**, the bank's performance testing platform.

Think of it as a translator: your team writes or records their API tests in familiar tools, and the toolkit converts that work into production-ready load test scripts automatically.

---

## Tool 1 — Converter

**What it does:** Takes an existing API collection or JMeter script and converts it to a VuGen load test script.

**Who uses it:** Performance engineers who have a Postman collection from the development team, a Bruno test collection, or a JMeter script they want to migrate to LoadRunner.

### Features

#### Multi-format input support
Accepts Postman v2.1 JSON, Bruno JSON/YAML collections, Bruno `.bru` files, and Apache JMeter `.jmx` files. No pre-processing required — upload the file you already have.

#### Automatic dynamic value handling (Correlation)
Modern web applications generate a unique token or identifier for each user session. A load test script must capture these values from the server's responses and use them in subsequent requests. The toolkit does this automatically for all common patterns: OAuth access tokens, JWT tokens, session IDs, CSRF tokens, correlation IDs, and more.

Without this feature, a load test script would fail on its second run because it would try to use a token from the first run. With this feature, the script captures a fresh token every time.

#### Variable classification (3-Tier Parameterization)
Every variable in a script is automatically sorted into one of three categories:
- **Dynamic variables** — values that change per request (captured from server responses)
- **Config variables** — values that are fixed per environment (server URL, client ID, API key)
- **Test data** — values that change per virtual user (username, password, account number)

Each category is stored correctly and read back at the right time during the test run.

#### Authentication support
The toolkit automatically detects and generates code for all major authentication methods used at the bank:

| Method | Description |
|---|---|
| **OAuth2** | Generates token acquisition requests for client credentials, password, and authorization code flows |
| **JWT (JSON Web Token)** | Detects JWT signing libraries, extracts claim mappings, generates token creation code |
| **DPoP** (RFC 9449) | New: generates cryptographic proof-of-possession tokens per request — prevents token theft |
| **PKCE** (RFC 7636) | New: generates code verifier/challenge pairs for secure authorization code flows |
| **NTLM / Kerberos** | Windows authentication — generates the correct VuGen credentials configuration |
| **Basic Auth** | Username/password encoded in Authorization header |
| **Bearer Token** | Static or dynamically-captured tokens passed in headers |
| **API Key** | Header-based or query-parameter-based key injection |
| **AWS Signature v4** | Signs requests for AWS API endpoints |
| **mTLS** | Client certificate authentication — upload your `.pem` or `.p12` file alongside the collection |

#### Per-request transaction naming
Every request gets a unique, sequential transaction name (`T01_LoginUser`, `T02_GetAccount`, etc.). This means LoadRunner Enterprise reports response time for each individual API call — not just the whole test.

#### JMeter Workload Model
When converting a JMeter script, the toolkit optionally generates a **Workload Model Excel file** — a spreadsheet showing all thread groups, their configurations, and recommended LoadRunner scenario settings. This significantly reduces the time needed to configure a LoadRunner scenario after migration.

#### Multi-script mode
If a Postman collection has multiple folders, or a JMeter script has multiple thread groups, the toolkit can generate a separate VuGen script for each one — matching the LoadRunner Enterprise scripting standard.

#### Proxy detection
Automatically detects proxy configuration from environment variables and injects it into the generated script's runtime settings.

---

## Tool 2 — Recorder

**What it does:** Converts a browser HAR recording (captured via browser Developer Tools) into a VuGen script.

**Who uses it:** Performance engineers working on VCSE or Azure Virtual Machines where VuGen's built-in proxy recording is blocked by security policy.

### Features

#### Browser-based recording (no VuGen proxy required)
Uses a simple browser bookmarklet to control the HAR recording. Works on any machine with Chrome, Firefox, or Edge — no installation, no admin rights required.

#### Domain filtering
After uploading a recording, engineers can uncheck domains they don't want in the script (analytics services, CDNs, font providers, monitoring tools). Only the relevant application traffic is included.

#### Transaction boundary marking
Engineers can visually group requests into named transactions representing logical user steps (e.g. "Login", "Search Products", "Add to Cart"). These become named measurements in the LoadRunner report.

#### Static asset filtering
Images, CSS files, JavaScript bundles, and font files are automatically identified and excluded from the script (they are handled by LoadRunner's resource-level settings, not the action script).

---

## Tool 3 — Script Studio

**What it does:** Takes one or two browser HAR recordings and generates a deeply correlated VuGen script with all dynamic values already handled.

**Who uses it:** Performance engineers who want the most complete correlation possible, especially for applications with complex session management or security tokens.

### Features

#### Two-HAR diff-based correlation (recommended)
The most powerful feature: record the same user journey twice using different test credentials. Script Studio compares the two recordings and identifies every value that changed between the two runs. These values are guaranteed to be dynamic (server-generated) and must be correlated in the load test script. This approach detects correlations that pattern-based analysis can miss.

#### Single-HAR pattern correlation
For a quick result with one recording. Uses pattern recognition (UUID format, JWT format, long alphanumeric strings, timestamps) to identify likely dynamic values.

#### Value-Based Auto-Correlation (VBAC)
An advanced correlation engine that works forward from each request: it identifies values in request headers and bodies that look dynamic, then traces them back to where the server first sent that value in a previous response. This approach generates precise extractors pointing to the exact response and path where the value originates.

#### DPoP and PKCE detection
Automatically detects DPoP (Demonstrating Proof-of-Possession) and PKCE (Proof Key for Code Exchange) authentication patterns from HAR recordings and generates the correct cryptographic code. These are not correlated values (the client generates them, not the server) — the tool correctly identifies this distinction and generates client-side generation code instead of extraction code.

#### All extractor types
Generates the correct extraction method for each dynamic value:
- **JSON path** — for JSON API responses
- **XPath** — for XML/SOAP responses
- **Boundary (left/right)** — for HTML forms and mixed content
- **Regular expression** — for unusual response formats
- **Header** — for values returned in response headers
- **Cookie** — for session cookies

---

## Output Formats

Both output formats are available from all three tools:

### DevWeb (JavaScript)
The modern LoadRunner protocol. Scripts run as `main.js`. Recommended for new projects on LoadRunner Enterprise 2021 or later.

### Web HTTP/HTML (C)
The classic VuGen protocol. Scripts run as `Action.c`. Fully compatible with all versions of LoadRunner Enterprise, including legacy installations.

---

## Privacy and Security Model

| Concern | How the toolkit handles it |
|---|---|
| Uploaded files contain credentials, PEM keys, tokens | Files are processed entirely in RAM. The operating system never writes them to disk. |
| ZIP file contains sensitive generated code | Download link is single-use and expires after 5 minutes. |
| Server stores test data between conversions | Nothing persists. Each request is completely isolated. |
| External services receive data | No external API calls. All processing is self-contained. |
| IIS access logs capture file contents | Logs contain only URL, status code, and timestamp — not file contents. |

---

## Version History Summary

| Version | Key additions |
|---|---|
| v2.9.2 | PKCE (RFC 7636) support — Converter and Script Studio |
| v2.9.0 | DPoP (RFC 9449) support — all three tools; HTML entity decoding fix |
| v2.8.0 | Value-Based Auto-Correlation engine in Script Studio |
| v2.7.0 | Memory-only processing architecture; all log statements removed from generated scripts |
| v2.6.0 | Per-request transaction naming with sequential global counter |
| v2.5.0 | Multi-certificate upload; Bruno YAML folder collections |
| v2.4.0 | Proxy auto-detection; URL variable encoding fix |
| v2.3.0 | JMeter converter; Workload Model Excel generation |

---

*See also: [Executive Summary](EXECUTIVE-SUMMARY.md) | [Business Case](BUSINESS-CASE.md)*
