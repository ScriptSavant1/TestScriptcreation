# PerfX Studio — Security Documentation

**Audience:** Security teams, application leads, compliance reviewers, auditors.
**Last reviewed:** 2026-07-09
**Classification:** Internal

---

## 1. What is PerfX Studio?

PerfX Studio is an internal performance engineering tool used by the LoadRunner Enterprise (LRE) performance testing team. It converts Postman/Bruno collections, JMeter test plans, and browser HAR recordings into VuGen-ready scripts. It is deployed on an internal development server and is not accessible from the public internet.

---

## 2. Deployment Context

| Property | Value |
|----------|-------|
| Deployment type | Internal only — behind corporate network perimeter |
| Accessible from | Intranet (performance testing team) |
| Public internet exposure | None |
| User authentication | None — see Section 3 |
| Data classification of inputs | Potentially sensitive (see Section 5) |

---

## 3. Authentication & Authorization

**Decision:** No application-level authentication is implemented. This is an intentional, accepted design choice.

**Rationale:**
- The tool is deployed on an internal development server accessible only within the corporate network.
- It is used exclusively by the performance testing team.
- Adding authentication was determined to create unnecessary friction for an internal utility tool.
- Network-level access control (corporate VPN / internal network restriction) provides the perimeter security.

**Accepted risk:** Any user who can reach the server on the internal network can use the tool. There is no per-user audit trail at the application layer.

**Recommended controls (if stricter posture required):**
- Restrict access via IIS/reverse proxy to specific Active Directory groups.
- Enable Windows Authentication at the IIS level (no code changes needed).
- Add IP allowlist to the reverse proxy layer.

---

## 4. Data Handling & Privacy Model

### 4.1 What happens to uploaded files

| Stage | Behaviour |
|-------|-----------|
| Upload receipt | File bytes are held in server RAM (multer memoryStorage). No disk write at this stage. |
| Parser preparation | Collection, environment, and certificate files are written to `os.tmpdir()` so that file-path-based parsers can read them. |
| Conversion | Converter reads the temp files and generates scripts in-memory (AsyncLocalStorage interceptor captures all `fs.write` calls and redirects them to RAM). |
| Temp file cleanup | All temp input files are deleted immediately after conversion using `try/finally` — cleanup is guaranteed even if conversion fails. Cleanup failures are logged to the server console (never silently suppressed). |
| Output | Generated scripts exist only in RAM as an in-memory file Map. They are never written to disk. |
| Download | The in-memory file Map is streamed directly as a ZIP to the browser. No ZIP file is created on disk. |
| Post-download | The download token and in-memory file Map are deleted. Nothing persists beyond the request. |
| Download expiry | Download tokens are single-use and expire after 5 minutes. Unused tokens are automatically purged. |

### 4.2 What is never done

- No files are stored in a database.
- No uploaded content is logged.
- No data is sent to any external service (no telemetry, no analytics, no CDN calls).
- No generated scripts or user data are retained between requests.

### 4.3 Residual disk risk

Temp input files exist on disk for the duration of the conversion (typically 1–30 seconds). In the event of a server crash, these files may remain in `os.tmpdir()` until the OS clears the temp directory. Files in `os.tmpdir()` are accessible to any process running under the same OS user account.

**Mitigation:** Conversion temp files are prefixed with `lr-col-`, `lr-env-`, `lr-cert-`, `lr-jmx-`, `lr-jmx-support-` and timestamped. They can be identified and manually removed if a crash occurs. A scheduled task to clean `%TEMP%\lr-*` files older than 1 hour is recommended.

---

## 5. Input File Sensitivity

Users are responsible for treating their input files as sensitive documents:

| File type | Potentially contains |
|-----------|----------------------|
| HAR file | Session tokens, cookies, API keys, bearer tokens, request bodies with PII |
| Postman environment | API keys, usernames, passwords, base URLs, bearer tokens |
| Bruno collection | Same as Postman |
| JMeter .jmx | Usernames, passwords, API endpoints, data patterns |
| Certificate files (.pem, .p12) | Private keys |

**Best practices for users:**
1. Record against test environments — never production.
2. Use test credentials, not personal or admin accounts.
3. Delete HAR files from your local machine after conversion is complete.
4. Do not share HAR or environment files via email or chat.

---

## 6. Security Controls Implemented

### 6.1 HTTP Security Headers

Helmet.js is applied as the first Express middleware, providing:

| Header | Value set |
|--------|-----------|
| `X-Frame-Options` | `SAMEORIGIN` |
| `X-Content-Type-Options` | `nosniff` |
| `X-DNS-Prefetch-Control` | `off` |
| `Referrer-Policy` | `no-referrer` |
| `Strict-Transport-Security` | max-age=15552000 (if HTTPS) |
| `X-Powered-By` | Removed |
| `Content-Security-Policy` | Disabled (inline `<script>` blocks in UI require this) |

### 6.2 Download Token Security

Download tokens are generated using `crypto.randomBytes(32).toString('hex')` — 256 bits of entropy from the operating system's cryptographically secure random number generator. They cannot be predicted or brute-forced within their 5-minute validity window.

### 6.3 File Upload Validation

| Control | Value |
|---------|-------|
| Maximum file size | 2 GB per file |
| Maximum files per request | 42 (JMX endpoint) / 12 (collection endpoint) |
| Allowed extensions — collection | `.json`, `.yml`, `.yaml`, `.bru`, `.zip` |
| Allowed extensions — environment | `.json` |
| Allowed extensions — certificates | `.pem`, `.p12`, `.pfx`, `.crt`, `.cer` |
| Allowed extensions — JMX | `.jmx` |
| Allowed extensions — CSV/data files | `.csv`, `.tsv`, `.txt` |

Files with disallowed extensions are rejected with HTTP 415 before any processing occurs.

### 6.4 Path Traversal Prevention

All uploaded filenames are sanitized before being used in any file system path:

```javascript
function sanitizeFilename(name) {
  return path.basename(String(name)).replace(/[^\w.\-]/g, '_') || 'upload';
}
```

This strips directory components (`../../`) and removes any character that is not a word character, dot, or hyphen. A crafted filename cannot escape the temp directory.

### 6.5 Rate Limiting

Conversion endpoints (`/converter/convert`, `/converter/convert-jmx`) are rate-limited to **60 requests per 5 minutes per IP address**. This limit is deliberately generous for an internal performance testing team (sufficient for concurrent users) while preventing runaway automation or accidental DoS from a misconfigured script.

### 6.6 Error Response Sanitization

Server errors never return `err.message` or stack traces to the HTTP client. All error responses return a short, opaque error code (e.g., `conversion_failed`, `file_too_large`, `rate_limit_exceeded`). Full error details are logged to the server console only.

### 6.7 Input Validation

- `logLevel` parameter is validated against an allowlist `["debug","info","warn","error"]` before use.
- All numeric parameters (`thinkTime`) are parsed with `parseFloat()` with a safe default fallback.
- Boolean option parameters use strict string comparison (`!== "false"`).

### 6.8 XSS Prevention

Server-supplied strings inserted into the DOM via `innerHTML` are HTML-escaped through an `escHtml()` function before insertion. File names supplied by the user are set via `textContent` (not `innerHTML`).

### 6.9 Conversion Timeout

All conversion operations are wrapped in a 120-second timeout using `Promise.race`. A pathological or malformed input file cannot hold the server indefinitely. Timed-out requests return HTTP 408.

### 6.10 No External Service Calls

The application makes no outbound network calls. All processing is fully local. Google Fonts CDN links have been removed from the UI; all fonts are now served from the system font stack.

---

## 7. Known Accepted Risks

| Risk | Reason accepted | Mitigation |
|------|----------------|------------|
| No application authentication | Internal tool, network-controlled access, team-only users | Corporate network perimeter; consider IIS Windows Auth if posture needs to tighten |
| Temp files exist on disk during conversion | Required by file-path-based parsers | Cleanup guaranteed via try/finally; recommend scheduled temp cleanup task |
| No structured logging / SIEM integration | Internal tool scope | Add `pino` / `winston` structured logging if SIEM integration is required |
| `Content-Security-Policy` not set | Inline `<script>` blocks in UI | Migrate inline scripts to external files and enable CSP as a future hardening step |
| JSZip vendored as static file | Easier deployment; no npm install required at serve time | Track JSZip CVEs manually; pin to a known-safe version |
| Single-instance in-memory download store | Out of scope for current deployment | Acceptable — single-server deployment; would need Redis/cache layer for multi-instance |

---

## 8. What Was NOT Found (Confirmed Clean)

These common vulnerability classes were specifically checked and not found:

- **Hardcoded credentials / API keys** — None found in any source file.
- **XML External Entity (XXE) injection** — `fast-xml-parser` does not resolve external entities by default.
- **Server-side `eval()` or `exec()` of user content** — Not present.
- **YAML code execution** — `js-yaml` v4 `yaml.load()` excludes JS-specific types; safe to use.
- **SQL injection** — No database or SQL query construction present.

---

## 9. Dependencies

| Package | Version | Purpose | Notes |
|---------|---------|---------|-------|
| express | ^4.18.2 | Web framework | Track for 5.x migration |
| helmet | ^8.2.0 | Security headers | Keep current |
| express-rate-limit | ^8.5.2 | Rate limiting | Keep current |
| multer | ^1.4.5-lts.1 | File upload | LTS branch; migrate to v2 when released |
| fast-xml-parser | ^4.5.4 | JMX parsing | No external entity resolution |
| js-yaml | ^4.1.0 | Bruno/collection parsing | Safe load mode |
| archiver | ^6.0.1 | ZIP creation | Output only — no user input parsed |
| exceljs | ^4.4.0 | Workload Excel generation | Output only |

**Dependency scanning:** Run `npm audit` before each deployment. Address `high` and `critical` findings before going live.

**Recommended:** Configure Dependabot or Renovate to open automated PRs when dependencies publish CVEs.

---

## 10. Infrastructure Recommendations

These are recommendations for the team that deploys and operates the server:

1. **Run Node.js ≥ 20 LTS** — Node 14, 16, 18 are all end-of-life (no security patches). The `engines` field in `package.json` now enforces `>=20.0.0`.
2. **Enable HTTPS** — If the tool is accessed over HTTPS, the `Strict-Transport-Security` header from helmet is automatically activated.
3. **Schedule temp directory cleanup** — Create a Windows scheduled task: `del /f /q %TEMP%\lr-col-* %TEMP%\lr-env-* %TEMP%\lr-jmx-*` running hourly, to clean up any files left by server crashes.
4. **Restrict server firewall** — Limit inbound connections to the server to the performance testing team's network range or VLAN.
5. **Run as a non-administrator service account** — The Node.js process does not need elevated privileges. Run it as a dedicated low-privilege service account.

---

## 11. Security Contact

For security questions or findings, contact the performance engineering team lead.

*This document should be reviewed and updated whenever significant code changes are made to `src/web/server.js` or when new input processing features are added.*
