# LRE Toolkit — High Level Solution Design (HLSD)

**Document Type:** Architecture Review  
**Classification:** Internal  
**Version:** 2.9.2 | **Date:** May 2026  
**Status:** Approved for Review

---

## 1. Document Purpose

This High Level Solution Design document describes the architecture, security model, data flows, and operational characteristics of the LRE Toolkit for review by the Architecture Board, Security Review, and IT Management.

---

## 2. Solution Overview

### 2.1 Purpose

The LRE Toolkit is an internal, browser-based platform that automates the generation of LoadRunner Enterprise (LRE) performance test scripts. It accepts API collections (Postman, Bruno), JMeter test plans (.jmx), and browser HAR recordings as inputs, and produces VuGen-ready script packages as output.

### 2.2 Scope

| In Scope | Out of Scope |
|---|---|
| Script generation from uploaded files | Execution of performance tests |
| Authentication pattern detection | LRE configuration or scenario management |
| Correlation and parameterization logic | Integration with source control systems |
| ZIP packaging and delivery to browser | Persistent test asset storage |

### 2.3 Users

| User Group | How They Use It | Technical Level |
|---|---|---|
| Performance Engineers | Daily use for script creation | Intermediate-Advanced |
| QA Engineers | Occasional use for simple conversions | Basic |
| IT Administrators | Installation and maintenance | Advanced |

---

## 3. Architectural Principles

| Principle | Implementation |
|---|---|
| **Stateless processing** | Each HTTP request is fully isolated; no shared state between requests |
| **Zero persistence** | No uploaded data, generated scripts, or credentials are ever written to disk |
| **No external dependencies** | No calls to external APIs, services, or the internet during processing |
| **Fail safely** | Conversion errors return a descriptive message; the in-memory map is released regardless |
| **Browser-native tools** | Recorder and Script Studio run client-side; sensitive HAR data never reaches the server |

---

## 4. System Context Diagram

```
                    ┌─────────────────────────────────────┐
                    │         BANK INTERNAL NETWORK        │
                    │                                     │
  ┌──────────────┐  │  ┌───────────────────────────────┐  │
  │ Performance  │  │  │      LRE Toolkit Server        │  │
  │  Engineer    │──┼──│  Windows Server 2019+          │  │
  │  (browser)   │  │  │  IIS 10 + iisnode 0.2.26       │  │
  └──────────────┘  │  │  Node.js 18 LTS                │  │
                    │  └───────────────────────────────┘  │
  ┌──────────────┐  │                │                    │
  │  Postman /   │  │                ▼                    │
  │  Bruno /     │  │  ┌───────────────────────────────┐  │
  │  JMeter      │  │  │  LoadRunner Enterprise (LRE)   │  │
  │  (source)    │  │  │  (upload .zip → open in VuGen)│  │
  └──────────────┘  │  └───────────────────────────────┘  │
                    │                                     │
                    │  NO INTERNET ACCESS REQUIRED        │
                    └─────────────────────────────────────┘
```

---

## 5. Security Architecture

### 5.1 Data at Rest

**Assessment: No data at rest.**

The application uses `multer.memoryStorage()` for file uploads. Files are held in process RAM for the duration of a single HTTP request. A custom `AsyncLocalStorage`-based filesystem interceptor ([src/lib/memoryFsInterceptor.js](../../src/lib/memoryFsInterceptor.js)) redirects all Node.js `fs` write operations to a per-request in-memory `Map<string, Buffer>`. This Map is released to the Node.js garbage collector immediately after the HTTP response is completed.

| Data type | Storage location | Lifetime |
|---|---|---|
| Uploaded collection file | RAM (multer buffer) | Single request |
| Uploaded environment/cert files | RAM (multer buffer) | Single request |
| Generated script files | RAM (Map<path,content>) | Until response complete |
| Output ZIP bytes | RAM (archiver stream) | During streaming only |
| Download token (UUID) | RAM (Map in server.js) | 5 minutes max, single-use |

### 5.2 Data in Transit

All data in transit uses HTTPS via the IIS SSL termination. The Node.js application binds to `localhost`; IIS proxies external HTTPS to it. TLS certificate management is handled by IIS (standard bank certificate process).

### 5.3 Authentication and Authorization

The LRE Toolkit relies on the network perimeter for access control — it is hosted on an internal server accessible only from the bank's internal network (or VPN). There is no application-level authentication. If role-based access control is required, it should be implemented at the IIS/network layer.

### 5.4 Credentials in Uploaded Files

Postman collections and JMeter scripts frequently contain API keys, OAuth client secrets, JWT private keys, and passwords. These are handled as follows:

- They pass through RAM only (never disk)
- They are consumed by the generator to populate parameter file templates
- The generated output may contain these values in CSV/PRM parameter files — these are included in the ZIP that the engineer downloads
- The engineer is responsible for the security of their downloaded ZIP

**Recommendation:** Engineers should treat downloaded ZIPs as sensitive and follow normal credential handling procedures (e.g. do not commit to shared repositories without sanitizing).

### 5.5 What the Server Logs

IIS standard access logs contain:
- Timestamp
- Client IP address
- HTTP method and URL path (`POST /convert-devweb`)
- HTTP status code
- Response size in bytes

No file contents, variable values, or credentials are logged.

---

## 6. Component Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                     LRE Toolkit Application                         │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Express HTTP Layer                        │   │
│  │  POST /convert-devweb                                       │   │
│  │  POST /convert-vugen                                        │   │
│  │  POST /jmx-convert                                          │   │
│  │  GET  /download/:token                                      │   │
│  │  GET  /converter, /recorder, /studio                        │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                           │                                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │             Memory FS Interceptor                            │   │
│  │  AsyncLocalStorage — redirects all fs writes per-request    │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                           │                                         │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────────┐   │
│  │    Parsers     │  │   Analyzers    │  │    Generators      │   │
│  │                │  │                │  │                    │   │
│  │ brunoParser    │  │ correlation    │  │ advancedScript     │   │
│  │ jmxParser      │  │ Detector       │  │ Generator (DevWeb) │   │
│  │                │  │ parameteriz-   │  │ webHttpScript      │   │
│  │                │  │ ationEngine    │  │ Generator (VuGen)  │   │
│  │                │  │ authentication │  │ mandatory Files    │   │
│  │                │  │ Handler        │  │ Generator (both)   │   │
│  │                │  │ customScript   │  │ jmxConverter       │   │
│  │                │  │ Parser         │  │                    │   │
│  └────────────────┘  └────────────────┘  └────────────────────┘   │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │              Root Helpers (Project Files)                    │   │
│  │  lre-utils.js/dat — DPoP + PKCE + JWT crypto (VuGen JS)    │   │
│  │  jwt-helper.js    — DevWeb JWT generation                   │   │
│  │  jsrsasign.js     — Crypto library (VuGen JWT)              │   │
│  │  DevWebSdk.d.ts   — TypeScript definitions                  │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 7. Integration Points

| Integration | Type | Direction | Protocol |
|---|---|---|---|
| Engineer's browser | HTTP/HTTPS | In/Out | HTTPS (TLS 1.2+) |
| File upload | Multipart form data | In | HTTPS |
| ZIP download | HTTP streaming | Out | HTTPS chunked |
| LoadRunner Enterprise | Manual (engineer uploads ZIP via LRE UI) | Out | N/A |
| VuGen | Manual (engineer opens .usr file) | Out | N/A |

**No other integration points exist.** The application makes no outbound network calls at runtime.

---

## 8. Deployment Architecture

```
Windows Server 2019+
┌─────────────────────────────────────────────────────────────────────┐
│                                                                     │
│  IIS 10                                                             │
│  ├── Site: lre-toolkit (port 443, HTTPS)                           │
│  │   ├── web.config (URL rewrite rules, iisnode handler)           │
│  │   ├── SSL certificate (from bank CA)                            │
│  │   └── Application Pool: lre-toolkit-pool                        │
│  │                                                                 │
│  │   iisnode handler → node.exe app.js                             │
│  │                                                                 │
│  Node.js 18 LTS                                                     │
│  └── Process: node.exe C:\inetpub\lre-toolkit\app.js               │
│      ├── Listens on iisnode named pipe                              │
│      ├── No external ports bound                                    │
│      └── Working directory: C:\inetpub\lre-toolkit\                │
│                                                                     │
│  File system:                                                       │
│  C:\inetpub\lre-toolkit\     — application code (read-only)        │
│  C:\inetpub\lre-toolkit\iisnode\  — iisnode logs (write)           │
└─────────────────────────────────────────────────────────────────────┘
```

The application code directory should be read-only for the IIS application pool identity. The only write permission required is to the `iisnode/` log subdirectory.

---

## 9. Resilience and Recovery

| Scenario | Behaviour |
|---|---|
| Node.js process crashes | iisnode restarts it automatically on next request |
| Request timeout | IIS returns 504; in-memory Map released |
| Large file upload (>100MB) | multer size limit enforced; 413 returned |
| Malformed input file | Parser throws; 400 returned with message; Map released |
| Concurrent requests | Each request has isolated AsyncLocalStorage context |
| Server restart | No state to recover; engineers re-upload and convert |

---

## 10. Non-Functional Requirements

| NFR | Target | Implementation |
|---|---|---|
| Response time (conversion) | < 5 seconds for typical inputs | Synchronous Node.js processing, no I/O blocking |
| Availability | 99% (standard business hours) | iisnode auto-restart; IIS health monitoring |
| Concurrent users | 20+ simultaneous | Node.js event loop; stateless per-request |
| Data confidentiality | No persistence of sensitive data | Memory-only processing architecture |
| Audit | IIS access logs | Standard IIS W3C logging |
| Browser compatibility | Chrome 90+, Firefox 88+, Edge 90+ | Vanilla JS ES2020; no browser-specific APIs |

---

## 11. Risk Register

| Ref | Risk | Likelihood | Impact | Treatment |
|---|---|---|---|---|
| R01 | Engineer uploads collection containing production credentials | Medium | Medium | Accepted — data in RAM only; engineer controls their own download |
| R02 | Node.js vulnerability requiring patching | Low | Medium | Node.js 18 LTS has 3-year support lifecycle; standard patch process |
| R03 | Large JMX file causes timeout/OOM | Low | Low | 100MB multer limit; Node.js V8 heap typically sufficient |
| R04 | iisnode version incompatibility on OS upgrade | Low | Medium | Mitigated by documenting exact version; tested upgrade procedure |
| R05 | Browser-side tools process malicious HAR | Low | Low | HAR processed client-side; no server execution of HAR content |

---

## 12. Decisions and Rationale

| Decision | Rationale |
|---|---|
| Memory-only processing | Avoids temp file accumulation under concurrent load; eliminates risk of leftover sensitive data on disk |
| No application-level auth | Relied on network perimeter; adding auth would require identity infrastructure outside project scope |
| Client-side Recorder/Studio | HAR files may contain authentication tokens; keeping processing in-browser is the most privacy-preserving architecture |
| chunked transfer (no Content-Length) | Bypasses corporate proxy size limits that would block large ZIP downloads |
| Content-Type: application/octet-stream | Avoids ZIP-specific proxy filters that may block .zip downloads |
| iisnode (not PM2/Docker) | Matches bank's approved Windows Server/IIS deployment standard |

---

## 13. Change History

| Version | Date | Change |
|---|---|---|
| 2.9.2 | 2026-05 | PKCE (RFC 7636) support added |
| 2.9.0 | 2026-04 | DPoP (RFC 9449) support; HTML entity decoding |
| 2.8.0 | 2026-03 | Value-Based Auto-Correlation (VBAC) engine |
| 2.7.0 | 2026-02 | Memory-only processing architecture (this document's current baseline) |
| 2.6.0 | 2026-01 | Per-request transactions |
| 2.5.0 | 2025-12 | Multi-certificate upload; Bruno YAML folder |
| 2.4.0 | 2025-11 | Proxy auto-detection; URL encoding fix |
| 2.3.0 | 2025-10 | JMeter converter; Workload Model Excel |

---

*See also: [Architecture Diagram](ARCHITECTURE.md) | [Deployment Guide](../deployment/DEPLOYMENT-IIS.md) | [Executive Summary](../business/EXECUTIVE-SUMMARY.md)*
