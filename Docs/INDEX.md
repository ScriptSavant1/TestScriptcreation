# LRE Toolkit — Documentation Index

**Version:** 2.9.2 | **Last Updated:** 2026-05-03

This is the master index for all LRE Toolkit documentation. Documentation is organized into four audiences: **Business**, **Technical (Developers)**, **User**, and **Deployment & Operations**.

---

## Quick Navigation

| I want to... | Go to |
|---|---|
| Understand the business value | [Executive Summary](business/EXECUTIVE-SUMMARY.md) |
| Get approval from architecture/security board | [HLSD](technical/HLSD.md) |
| Get started quickly | [Getting Started](user/GETTING-STARTED.md) |
| Deploy to IIS | [IIS Deployment Guide](deployment/DEPLOYMENT-IIS.md) |
| Understand the system architecture | [Architecture](technical/ARCHITECTURE.md) |
| Enhance or extend the codebase | [Developer Guide](technical/DEVELOPER-GUIDE.md) |
| Use the Converter tool | [Converter Guide](user/CONVERTER-GUIDE.md) |
| Use Script Studio | [Script Studio Guide](user/STUDIO-GUIDE.md) |
| Use the HAR Recorder | [Recorder Guide](user/RECORDER-GUIDE.md) |
| Understand JWT / DPoP / PKCE | [Auth Guide](technical/AUTH-GUIDE.md), [JWT Guide](technical/JWT-GUIDE.md), [DPoP Guide](technical/DPOP-GUIDE.md), [PKCE Guide](technical/PKCE-GUIDE.md) |
| Fix a problem | [Troubleshooting](user/TROUBLESHOOTING.md) |

---

## Business Documentation

Designed for stakeholders, management, and approval committees.

| Document | Purpose | Audience |
|---|---|---|
| [Executive Summary](business/EXECUTIVE-SUMMARY.md) | One-page business case: problem, solution, value | CTO, Head of Testing, Business Sponsors |
| [Business Case](business/BUSINESS-CASE.md) | Full ROI analysis, risk reduction, capability map | IT Management, Programme Managers |
| [Feature Catalog](business/FEATURE-CATALOG.md) | All features in business language, no code | Business Stakeholders, Non-technical reviewers |

---

## Technical Documentation

For developers, architects, and security reviewers.

| Document | Purpose | Audience |
|---|---|---|
| [Architecture](technical/ARCHITECTURE.md) | System architecture, data flow, component diagram | Architects, Senior Developers |
| [HLSD — High Level Solution Design](technical/HLSD.md) | Formal solution design for architecture board | Architecture Board, Security Review |
| [Code Structure](technical/CODE-STRUCTURE.md) | Directory layout, module responsibilities, extension points | Developers |
| [DevWeb Protocol Guide](technical/DEVWEB-PROTOCOL.md) | Generated DevWeb files, main.js patterns, SDK reference | DevWeb Scripting Team |
| [VuGen Web HTTP/HTML Guide](technical/VUGEN-PROTOCOL.md) | Generated C files, VuGen API reference, patterns | VuGen Scripting Team |
| [Authentication Guide](technical/AUTH-GUIDE.md) | All 9 auth methods, detection logic, generated code | Security Team, Developers |
| [JWT Guide](technical/JWT-GUIDE.md) | JWT detection (8 library signatures), generation, both protocols | Security Team |
| [DPoP Guide](technical/DPOP-GUIDE.md) | RFC 9449 implementation, EC P-256, lre-utils.dat | Security Architects |
| [PKCE Guide](technical/PKCE-GUIDE.md) | RFC 7636 implementation, client-generated params | Security Architects |
| [Correlation Engine](technical/CORRELATION-ENGINE.md) | Two-HAR diff, VBAC, extractor types, detection rules | Senior Developers |
| [Developer Guide](technical/DEVELOPER-GUIDE.md) | How to add features, extend generators, add auth types | Enhancement Developers |

---

## User Documentation

For performance engineers and QA teams who use the tool daily.

| Document | Purpose | Audience |
|---|---|---|
| [Getting Started](user/GETTING-STARTED.md) | First-time setup, 5-minute quick start | All new users |
| [Converter Guide](user/CONVERTER-GUIDE.md) | Convert Postman/Bruno/JMX → VuGen step-by-step | Performance Engineers |
| [Script Studio Guide](user/STUDIO-GUIDE.md) | HAR correlation engine, 1-HAR and 2-HAR workflows | Performance Engineers |
| [Recorder Guide](user/RECORDER-GUIDE.md) | HAR recording on VCSE/Azure VMs, bookmarklet setup | Performance Engineers |
| [Troubleshooting](user/TROUBLESHOOTING.md) | Common errors, FAQ, known limitations | All users |

---

## Deployment & Operations

For system administrators and DevOps.

| Document | Purpose | Audience |
|---|---|---|
| [IIS Deployment Guide](deployment/DEPLOYMENT-IIS.md) | Step-by-step IIS + iisnode, permissions, SSL | System Administrators |
| [Docker Deployment Guide](deployment/DEPLOYMENT-DOCKER.md) | Container-based deployment alternative | DevOps / Cloud Team |
| [Configuration Reference](deployment/CONFIGURATION.md) | All environment variables, feature flags, tunables | Administrators |

---

## Existing Reference Documents (Pre-restructuring)

The following documents exist from earlier development phases. They contain valid technical detail and remain as supplementary reference while the new structured docs above are adopted.

| Document | Notes |
|---|---|
| [IMPLEMENTATION-REFERENCE.md](IMPLEMENTATION-REFERENCE.md) | 944-line comprehensive implementation reference, v2.9.2 |
| [TECHNICAL-REFERENCE.md](TECHNICAL-REFERENCE.md) | Earlier technical reference |
| [FUNCTIONAL-SPEC.md](FUNCTIONAL-SPEC.md) | Functional specification |
| [USER-GUIDE.md](USER-GUIDE.md) | Earlier user guide |
| [DEPLOYMENT-GUIDE.md](DEPLOYMENT-GUIDE.md) | Earlier deployment guide |
| [DYNAMIC-PARAMS-STRATEGY.md](DYNAMIC-PARAMS-STRATEGY.md) | VBAC + client-generated param strategy |
| [STUDIO-SPLIT-PLAN.md](STUDIO-SPLIT-PLAN.md) | Studio modularization plan |

---

## Document Creation Status

| Document | Status |
|---|---|
| Docs/INDEX.md | ✅ Created |
| business/EXECUTIVE-SUMMARY.md | ✅ Created |
| business/BUSINESS-CASE.md | ✅ Created |
| business/FEATURE-CATALOG.md | ✅ Created |
| technical/ARCHITECTURE.md | ✅ Created |
| technical/HLSD.md | ✅ Created |
| technical/CODE-STRUCTURE.md | ✅ Created |
| technical/DEVWEB-PROTOCOL.md | ✅ Created |
| technical/VUGEN-PROTOCOL.md | ✅ Created |
| technical/AUTH-GUIDE.md | ✅ Created |
| technical/JWT-GUIDE.md | ✅ Created |
| technical/DPOP-GUIDE.md | ✅ Created |
| technical/PKCE-GUIDE.md | ✅ Created |
| technical/CORRELATION-ENGINE.md | ✅ Created |
| technical/DEVELOPER-GUIDE.md | ✅ Created |
| user/GETTING-STARTED.md | ✅ Created |
| user/CONVERTER-GUIDE.md | ✅ Created |
| user/STUDIO-GUIDE.md | ✅ Created |
| user/RECORDER-GUIDE.md | ✅ Created |
| user/TROUBLESHOOTING.md | ✅ Created |
| deployment/DEPLOYMENT-IIS.md | ✅ Created |
| deployment/DEPLOYMENT-DOCKER.md | ✅ Created |
| deployment/CONFIGURATION.md | ✅ Created |
| README.md (root) | ✅ Updated |
