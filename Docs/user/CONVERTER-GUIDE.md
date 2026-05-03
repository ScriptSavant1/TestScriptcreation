# LRE Toolkit — Converter Guide

**Version:** 2.9.2 | **Date:** May 2026

---

## Overview

The Converter transforms Postman or Bruno API collections, and Apache JMeter test plans, into complete VuGen script packages. One upload, one click, one ZIP — ready to open in VuGen.

---

## Postman / Bruno Collections

### Supported Input Formats

| Format | How to get it |
|---|---|
| **Postman v2.1 JSON** | Postman → File → Export → Collection v2.1 |
| **Bruno JSON** | Bruno → File → Export Collection |
| **Bruno YAML** | Single `.yml` or `.yaml` file |
| **Bruno folder** | Zip a folder containing `.bru` files |
| **Single `.bru` file** | A single Bruno request file |

### Environment File (Optional but Recommended)

An environment file provides variable values for `{{varName}}` placeholders. Without it, the toolkit generates parameter file entries with empty values for you to fill in.

- **Postman:** Export Environment → `environment.json`
- **Bruno:** Export Environment → YAML file

### Step-by-step

1. Navigate to the Converter → **Postman / Bruno** tab
2. Select output format: **DevWeb (JS)** or **Web HTTP/HTML (C)**
3. Drag your collection file into **Drop collection here**
4. Drag your environment file into **Environment file** (optional)
5. Configure options:
   - **Think Time:** pause between requests (1s, 2s, 3s, or 5s)
   - **Transactions:** per-request transaction naming on/off
   - **Correlation:** auto-correlation on/off
   - **Parameterization:** variable classification on/off
   - **Script Generation Mode:** Single script vs Multi-script
6. Click **Convert to DevWeb Script** (or VuGen)
7. Click **Download ZIP** when complete

### Multi-Script Mode

With multi-script mode ON, the converter creates one script per top-level folder (Postman) or collection item group (Bruno). Each script is placed in a subfolder inside the ZIP.

Use multi-script when:
- Each collection folder represents a distinct user journey
- Your LRE project requires separate scripts per business function
- You want to run folder-level load tests independently

---

## JMeter (.jmx) Conversion

### Supported JMeter Features

| JMeter Element | Converted to |
|---|---|
| HTTP Request sampler | `web_url()` / `web_custom_request()` / DevWeb request |
| Thread Group | Script (single mode) or separate script (multi-thread-group mode) |
| setUp Thread Group | Pre-test setup script |
| tearDown Thread Group | Post-test teardown script |
| CSV Data Set Config | Parameter file + `collection_data.csv/dat` |
| Regular Expression Extractor | `web_reg_save_param_regexp` / regex extraction |
| JSON Extractor | `web_reg_save_param_json` / JSONPath extraction |
| XPath Extractor | `web_reg_save_param_xpath` |
| Boundary Extractor | `web_reg_save_param` (left/right boundary) |
| Header Manager | Request headers |
| Cookie Manager | Cookie handling |
| HTTP Authorization Manager | Auth configuration |
| JSR223 Sampler (JWT/DPoP) | JWT/DPoP code generation |
| BeanShell Sampler (JWT) | JWT code generation |
| If Controller | Conditional logic (translated to if-statements) |
| Loop Controller | Loop structure |
| ForEach Controller | Iteration structure |
| Transaction Controller | `lr_start_transaction` / `lr_end_transaction` |
| Think Time | `lr_think_time()` |

### JMX Conversion Step-by-step

1. Navigate to the Converter → **JMeter (.jmx)** tab
2. Select output format: **DevWeb (JS)** or **Web HTTP/HTML (C)**
3. Drag your `.jmx` file into the drop zone
4. (Optional) Add CSV files referenced by your JMeter CSVDataSet elements
5. (Optional) Add certificate files (`.jks`, `.p12`, `.pem`, etc.)
6. Configure options:
   - **Script Generation Mode:** Single script or Per Thread Group
   - **Think Time:** fallback think time if not in JMX
   - **Workload Model Excel:** generates a workload model spreadsheet
7. Click **Convert JMeter to DevWeb Script**
8. Click **Download ZIP**

### Workload Model Excel

When enabled, the ZIP contains a `Workload_Model.xlsx` spreadsheet with:
- All Thread Groups and their configurations (VU count, ramp-up, duration)
- Recommended LoadRunner scenario settings
- Thread Group dependency summary

This spreadsheet significantly reduces the time to configure the LRE scenario after migration.

### CSV Files

If your JMeter script has CSVDataSet elements, upload the referenced CSV files alongside the JMX. The converter:
1. Validates that all referenced CSV files are present
2. Includes them in the output ZIP
3. Generates the correct parameter file entries pointing to them

If a referenced CSV is not uploaded, the converter reports it in a **dependency report** shown after conversion.

---

## What the Converter Handles Automatically

### Correlation

The converter uses a 2-pass approach:
1. Scans collection for variable references (`{{varName}}`) and script-set variables
2. Cross-references them with known variable values to classify as dynamic or static

Correlation extractors are generated for all identified dynamic values. The extractor type (JSON path, XPath, boundary, regex) is chosen based on the response content type and value context.

### 3-Tier Variable Classification

Every variable in the collection is classified:

| Tier | Type | In script | In parameter file |
|---|---|---|---|
| Tier 1 Dynamic | Correlated/generated values | `load.global.varName` / `{varName}` | Empty column (filled at runtime) |
| Tier 2 Config | URLs, client IDs, API keys | `load.params.varName` / `{varName}` | `nextValue: Once` — same for all VUsers |
| Tier 3 TestData | Usernames, passwords, account numbers | `load.params.varName` / `{varName}` | `nextValue: EachIteration` — different per VUser |

### Authentication

Detected and generated for all supported types: OAuth2 (client credentials, password, auth code), JWT, DPoP, PKCE, NTLM/Kerberos, Basic, Bearer, API Key, AWS Sig v4, mTLS.

See [Auth Guide](../technical/AUTH-GUIDE.md) for details.

### Transactions

Every request gets a unique transaction name (`T01_LoginUser`, `T02_GetAccount`, etc.). Numbers are sequential, global across the entire script.

### Think Time

A configurable think time is inserted between requests (default: 1 second).

### Proxy

If the collection's environment has a proxy variable (`proxy`, `proxyUrl`, `http_proxy`, etc.), the proxy is automatically configured in the runtime settings file.

---

## Output Options

| Option | Values | Effect |
|---|---|---|
| Output format | DevWeb / Web HTTP/HTML | Which protocol to generate |
| Think time | 1s / 2s / 3s / 5s | Pause between requests |
| Transactions | On / Off | Per-request `lr_start/end_transaction` |
| Correlation | On / Off | Auto-correlation of dynamic values |
| Parameterization | On / Off | 3-tier variable classification |
| Script mode | Single / Multi | One script or one per folder |
| Workload Model (JMX) | Include / Skip | Whether to generate the Excel file |

---

*See also: [Getting Started](GETTING-STARTED.md) | [Studio Guide](STUDIO-GUIDE.md) | [Troubleshooting](TROUBLESHOOTING.md)*
