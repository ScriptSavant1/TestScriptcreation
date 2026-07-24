# LRE Toolkit — Business Case

**Classification:** Internal  
**Version:** 2.9.2 | **Date:** May 2026

---

## 1. Problem Statement

### Current State

Performance test script development in VuGen is a specialist, time-intensive task. The current process requires:

1. Recording user journeys in VuGen (often blocked on VCSE/Azure VMs due to security policies)
2. Manually identifying all dynamic values that change between script runs (tokens, session IDs, CSRF tokens, correlation IDs)
3. Writing extraction code for each dynamic value using the correct VuGen API
4. Parameterizing test data (usernames, passwords, API keys) into parameter files
5. Implementing authentication flows from scratch (OAuth2 token acquisition, JWT generation, DPoP proofs)
6. Creating 15–20 mandatory configuration files per script
7. Testing and iterating until the script replays without errors

**Time cost:** A competent VuGen engineer spends 3–5 days on a 30-request API scenario. Complex authentication scenarios (JWT signing, DPoP) add 2–3 additional specialist days.

**Skill bottleneck:** Very few engineers have the depth of VuGen knowledge to implement modern auth patterns correctly. This creates a dependency on a small number of individuals.

**JMeter migration cost:** Many teams have existing JMeter scripts that cannot be used directly on LoadRunner Enterprise. Migration has historically been done manually, request by request.

---

## 2. Solution

The LRE Toolkit provides three browser-based tools that automate the heavy lifting of VuGen script creation:

### Tool 1 — Converter
Takes a Postman or Bruno API collection (or a JMeter .jmx file) and generates a complete, VuGen-ready script package. Handles all correlation, parameterization, and authentication automatically.

### Tool 2 — Recorder  
Converts a browser HAR recording into a VuGen script. Solves the VuGen proxy recording problem on VCSE/Azure VMs where recording is blocked by security policy.

### Tool 3 — Script Studio
An advanced HAR correlation engine. Upload 1 or 2 browser recordings to get a deeply correlated VuGen script. Two-recording mode (comparing two runs of the same journey) produces correlation coverage that approaches manual expert quality.

---

## 3. Capabilities Matrix

| Capability | Converter | Recorder | Script Studio |
|---|:---:|:---:|:---:|
| Postman/Bruno collection input | ✅ | — | — |
| JMeter .jmx input | ✅ | — | — |
| HAR file input | — | ✅ | ✅ |
| Auto-correlation (regex, JSON, XPath, boundary) | ✅ | ✅ | ✅ |
| Value-based diff correlation (2-HAR) | — | — | ✅ |
| OAuth2 (CC, password, auth code) | ✅ | — | — |
| JWT signing (jsrsasign, jose, JJWT, nimbus) | ✅ | — | — |
| DPoP (RFC 9449) EC P-256 proofs | ✅ | ✅ | ✅ |
| PKCE (RFC 7636) | ✅ | — | ✅ |
| NTLM / Kerberos | ✅ | — | — |
| mTLS (client certificates) | ✅ | — | — |
| AWS Signature v4 | ✅ | — | — |
| 3-tier parameterization | ✅ | ✅ | ✅ |
| Per-request transactions | ✅ | ✅ | ✅ |
| DevWeb JS output | ✅ | ✅ | ✅ |
| Web HTTP/HTML C output | ✅ | ✅ | ✅ |
| JMeter Workload Model Excel | ✅ | — | — |
| Multi-script (per folder/thread group) | ✅ | — | — |

---

## 4. ROI Analysis

### Assumptions

| Variable | Value |
|---|---|
| Average performance engineer day rate | £600/day (internal cost) |
| Average time to script a 30-request API — manual | 4 days |
| Average time to script a 30-request API — with toolkit | 3 hours |
| Number of scripts created per year (estimate) | 40 |
| Scripts with complex auth (JWT/DPoP) requiring specialist | 15 of 40 |
| Specialist premium for complex auth | +2 days each |

### Annual Saving Estimate

| Item | Manual | With Toolkit | Saving |
|---|---|---|---|
| Standard scripts (25 × 4 days) | 100 days | ~19 days | 81 days |
| Complex auth scripts (15 × 6 days) | 90 days | ~23 days | 67 days |
| JMeter migration (10 scripts × 5 days) | 50 days | ~2 days | 48 days |
| **Total** | **240 days** | **~44 days** | **~196 days** |

**Estimated annual saving at £600/day: ~£117,600**

### Qualitative Benefits

- **Reduced delivery risk**: Script bottleneck eliminated — any QA engineer with Postman knowledge can now produce a VuGen-ready script
- **Consistent quality**: Generated scripts follow best practices (3-tier parameters, correct transaction naming, proper VuGen API usage) by default
- **Faster project onboarding**: New teams can produce their first load test script on day one of engagement, not week two
- **Knowledge preservation**: Authentication patterns (DPoP, JWT) that exist only in a few engineers' heads are now codified in the tool

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Generated script requires manual adjustment for unusual app behaviour | High | Low | Generated scripts are reviewed in VuGen before upload to LRE — this is expected and normal |
| Tool generates incorrect correlation for complex app | Medium | Medium | Two-HAR mode in Script Studio significantly reduces this risk; engineering team can report issues |
| Node.js / iisnode version compatibility on future Windows Server upgrades | Low | Medium | Standard Node.js LTS versions used; upgrade path well-documented |
| Sensitive data (PEM keys, tokens) in uploaded collections | Medium | Low | Memory-only processing — nothing persists after download; covered by bank's network perimeter |
| Tool becomes unsupported | Low | Medium | Code is fully owned internally; no vendor lock-in; codebase is well-documented |

---

## 6. Technical Risk: Privacy and Data Handling

The toolkit's design was specifically engineered to meet internal data handling requirements:

- **`multer.memoryStorage()`** — files never touch disk during upload
- **`AsyncLocalStorage` fs interceptor** — any file write attempted during conversion is redirected to an in-memory map; nothing reaches the OS file system
- **Archiver streaming** — the output ZIP is streamed directly from the in-memory map to the browser; no temporary ZIP file is created
- **Token expiry** — download tokens expire after 5 minutes and are single-use
- **IIS access logs** — contain only timestamp, HTTP method, path, and status code; no file contents are logged

---

## 7. Operating Model

| Aspect | Detail |
|---|---|
| Hosting | Internal Windows Server (IIS + iisnode) |
| Maintenance | Performance Engineering team |
| Update process | Standard git-based deployment; zero downtime for configuration changes |
| Concurrent users | Handled natively by Node.js event loop; no per-request worker overhead |
| External dependencies | None at runtime — all processing is self-contained |
| Monitoring | Standard IIS logging; Node.js process health via Windows Service Manager |

---

## 8. Recommendation

The LRE Toolkit has been operational and continuously improved for over 12 months. It has proven its value in multiple performance testing engagements. The Performance Engineering team recommends:

1. **Formal approval** as a standard, approved internal tool
2. **Rollout** to all performance testing teams as the default method for VuGen script creation
3. **Continued development** under Performance Engineering team ownership, with quarterly feature reviews

---

*See also: [Executive Summary](EXECUTIVE-SUMMARY.md) | [Feature Catalog](FEATURE-CATALOG.md) | [Architecture](../technical/ARCHITECTURE.md)*
