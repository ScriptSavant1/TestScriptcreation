# LRE Toolkit — Executive Summary

**Classification:** Internal  
**Version:** 2.9.2 | **Date:** May 2026  
**Prepared by:** Performance Engineering Team

---

## The Problem

Performance test script development is the single most time-consuming phase of a load testing engagement at the bank. A performance engineer creating a VuGen script for a modern API must manually:

- Identify every dynamic value (tokens, session IDs, CSRF tokens, OAuth codes) and write extraction code
- Parameterize usernames, passwords, URLs, and API keys across potentially hundreds of requests
- Implement complex authentication flows — OAuth2, JWT signing, DPoP, NTLM/Kerberos
- Create all required configuration files (20+ files per script for DevWeb protocol)
- Re-work existing JMeter or Postman scripts line by line into VuGen syntax

For a 30-request API journey, this manual process takes an experienced engineer **3–5 days**. For complex authentication flows (JWT, DPoP), add another 2–3 days.

---

## The Solution

The **LRE Toolkit** is an internally-hosted, browser-based platform that generates production-ready VuGen performance test scripts automatically — from files the development and testing teams already have.

**Input:** Postman collections, Bruno collections, Apache JMeter scripts, or browser HAR recordings  
**Output:** A complete, VuGen-ready ZIP package — open in VuGen and run

The toolkit eliminates approximately **80% of manual scripting effort**, reducing a 5-day task to under 30 minutes.

---

## Key Capabilities

| Capability | What it means for the bank |
|---|---|
| **Automatic correlation** | Tokens, session IDs, and CSRF values are extracted and reused automatically — no manual code writing |
| **Authentication automation** | OAuth2, JWT, DPoP, NTLM/Kerberos, mTLS — all detected and generated automatically |
| **3-tier parameterization** | Variables classified as dynamic / config / test data — generates correct parameter files |
| **DPoP / PKCE support** | Handles the bank's modern security protocols (RFC 9449, RFC 7636) natively |
| **JMeter migration** | Existing JMeter scripts converted to LoadRunner in minutes — protecting investment in existing test assets |
| **Privacy by design** | Zero file storage — all processing in-memory; no test data or credentials persist on server |
| **No VuGen required for recording** | HAR-based recording works on VCSE/Azure VMs where VuGen proxy recording is blocked |

---

## Tools Included

```
LRE Toolkit
├── Converter    — Postman / Bruno / JMeter → VuGen script
├── Recorder     — Browser HAR → VuGen script (works on locked-down VMs)
└── Script Studio — HAR correlation engine (1 or 2 recordings → correlated script)
```

---

## Value Proposition

| Metric | Before | After |
|---|---|---|
| Script development time (30-request API) | 3–5 days | 2–4 hours |
| Authentication implementation (JWT/DPoP) | 2–3 days specialist effort | Automatic |
| JMeter → LoadRunner migration | 1–2 weeks | Minutes |
| Engineer skill requirement | Senior VuGen scripting expertise | Any QA with Postman/Bruno knowledge |
| Rework for new environments | Manual search/replace | Change 1 parameter value |

---

## Security & Compliance

- **All file processing is in-memory** — uploaded files (which may contain credentials, PEM keys, API tokens) are never written to disk and are garbage-collected immediately after the download link is consumed
- **Hosted internally** — no data leaves the bank's network; no external services are called
- **Audit-ready** — no logging of file contents; only request metadata (timestamp, conversion type, file size) is available in IIS logs
- **IIS + iisnode deployment** — standard bank-approved Windows Server stack

---

## Deployment Model

The toolkit runs as a Node.js application hosted on IIS on an internal Windows Server. It requires no database, no external network access, and no special infrastructure beyond Node.js and iisnode. A single server instance handles the full team concurrently.

**Recommended:** Windows Server 2019/2022 · IIS 10 · Node.js 18 LTS · iisnode 0.2.26

---

## Approval Request

The Performance Engineering team requests formal approval to:

1. **Continue operating** the LRE Toolkit as an approved internal tool for performance test script generation
2. **Onboard** additional project teams to use the toolkit as the standard approach for VuGen script creation
3. **Maintain and enhance** the tool under the existing team's ownership, following the feature roadmap

For questions, contact the Performance Engineering team.

---

*See also: [Business Case](BUSINESS-CASE.md) for full ROI analysis | [Feature Catalog](FEATURE-CATALOG.md) for complete capability listing | [HLSD](../technical/HLSD.md) for architecture board review*
