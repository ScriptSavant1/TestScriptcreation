# LR Script Converter — User Guide

**Version 2.8.0 | March 2026**

Converts Postman, Bruno, and JMeter test collections into production-ready LoadRunner Enterprise scripts — either DevWeb (JavaScript) or VuGen Web HTTP/HTML (C).

---

## Table of Contents

1. [Introduction](#1-introduction)
2. [Supported Input Formats](#2-supported-input-formats)
3. [CLI Reference](#3-cli-reference)
4. [Web UI Guide](#4-web-ui-guide)
5. [Output Files Reference](#5-output-files-reference)
6. [JMeter Conversion Guide](#6-jmeter-conversion-guide)
7. [Variable Management — 3-Tier System](#7-variable-management--3-tier-system)
8. [Correlation and Parameterization](#8-correlation-and-parameterization)
9. [Authentication Reference](#9-authentication-reference)
10. [Transactions](#10-transactions)
11. [Post-Conversion Steps](#11-post-conversion-steps)
12. [IIS Deployment](#12-iis-deployment)
13. [Best Practices](#13-best-practices)
14. [Troubleshooting](#14-troubleshooting)
15. [FAQ](#15-faq)

---

## 1. Introduction

LR Script Converter automates the translation of functional API test collections into LoadRunner performance test scripts. It handles the structural differences between API testing tools and LoadRunner — parameterization, correlation, authentication flows, transactions, and think time — so you can focus on reviewing and tuning the output rather than writing boilerplate.

### What It Produces

| Input | DevWeb Output | VuGen Output |
|-------|---------------|--------------|
| Postman v2.1 JSON | `main.js` + config files | `Action.c` + config files |
| Bruno JSON / YAML / `.bru` | `main.js` + config files | `Action.c` + config files |
| JMeter `.jmx` | `main.js` + config files + WLM Excel | `Action.c` + config files + WLM Excel |

### Choosing a Protocol

| Protocol | Flag | Use When |
|----------|------|----------|
| DevWeb (JavaScript) | `--protocol devweb` (default) | Modern LRE scripts; preferred for new projects |
| VuGen Web HTTP/HTML (C) | `--protocol web-http` | Classic VuGen scripts; required when LRE license covers Web HTTP/HTML only |

### Installation

**From source (standard):**
```bash
git clone https://your-org/lr-script-converter.git
cd lr-script-converter
npm install
npm link          # makes 'bruno-devweb' available globally
```

**Without npm link (always works):**
```bash
node src/cli.js convert -i collection.json
```

> **Note:** On servers without internet access, copy the `node_modules` folder from your development machine rather than running `npm install` on the server.

---

## 2. Supported Input Formats

### 2.1 Postman v2.1 JSON

Exported directly from Postman: **File → Export → Collection v2.1**.

**Detection:** The file contains an `info.schema` field with a Postman schema URL.

```json
{
  "info": {
    "name": "My API",
    "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json"
  },
  "item": [...]
}
```

**Usage:**
```bash
node src/cli.js convert -i MyCollection.postman_collection.json
```

With an environment file (recommended — provides variable values):
```bash
node src/cli.js convert -i MyCollection.json -e MyEnvironment.postman_environment.json
```

### 2.2 Bruno JSON Export

Exported from Bruno: **Export Collection → Bruno JSON**.

**Detection:** The file contains an `items[]` array with no `info.schema` field.

```json
{
  "name": "My API",
  "items": [
    {
      "name": "Get Users",
      "request": { "method": "GET", "url": "{{baseUrl}}/users" }
    }
  ]
}
```

**Usage:**
```bash
node src/cli.js convert -i my-collection.json
```

### 2.3 Bruno Single YAML File

A single `.yml` or `.yaml` file exported from Bruno containing the full collection structure.

```yaml
name: My API Collection
meta:
  name: My API Collection
items:
  - name: Authentication
    items:
      - name: Login
        request:
          method: POST
          url: "{{baseUrl}}/auth/login"
```

**Usage:**
```bash
node src/cli.js convert -i MyCollection.yml
node src/cli.js convert -i MyCollection.yaml -e environment.json
```

### 2.4 Bruno YAML Folder (Directory)

A directory containing `.bru` files organised in sub-folders — the native on-disk format that Bruno uses when you save a collection locally.

```
my-api/
├── auth/
│   ├── login.bru
│   └── logout.bru
├── users/
│   ├── get-user.bru
│   └── update-user.bru
└── orders/
    └── create-order.bru
```

**Usage:**
```bash
node src/cli.js convert -i ./my-api/
node src/cli.js convert -i ./my-api/ -e env.json
```

The converter walks the directory recursively and processes every `.bru` file.

### 2.5 Single .bru File

A single request file in Bruno's native text format.

```bru
meta {
  name: Login
  type: http
}

post {
  url: {{baseUrl}}/auth/login
  body: json
  auth: none
}

body:json {
  {
    "username": "{{username}}",
    "password": "{{password}}"
  }
}
```

**Usage:**
```bash
node src/cli.js convert -i login.bru
```

### 2.6 JMeter .jmx (New in v2.8.0)

A JMeter test plan file. Use the dedicated `convert-jmx` command.

```bash
node src/cli.js convert-jmx -i MyTestPlan.jmx
node src/cli.js convert-jmx -i MyTestPlan.jmx --protocol web-http
```

See [Section 6 — JMeter Conversion Guide](#6-jmeter-conversion-guide) for full details.

---

## 3. CLI Reference

The CLI is available as `node src/cli.js` (always) or `bruno-devweb` (after `npm link`). All examples below use `node src/cli.js` for portability.

### 3.1 `convert` — Postman / Bruno Collections

```
node src/cli.js convert -i <file> [options]
```

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--input <file>` | `-i` | required | Input file: `.json`, `.bru`, `.yml`, `.yaml`, or a directory path |
| `--environment <file>` | `-e` | — | Postman/Bruno environment JSON file. Provides variable values. |
| `--output <dir>` | `-o` | `./devweb-script` | Output directory |
| `--protocol <proto>` | — | `devweb` | `devweb` (JavaScript) or `web-http` (VuGen C) |
| `--mode <mode>` | `-m` | `single` | `single` — one script; `multi` — one script per top-level folder |
| `--think-time <sec>` | `-t` | `1` | Think time in seconds between requests |
| `--no-transactions` | — | — | Disable per-request transaction wrapping |
| `--no-correlation` | — | — | Disable automatic correlation detection |
| `--no-parameterization` | — | — | Disable variable parameterization |
| `--no-authentication` | — | — | Disable authentication code generation |
| `--no-comments` | — | — | Omit code comments from generated script |
| `--log-level <level>` | — | `info` | `error`, `warning`, `info`, or `debug` |
| `--fail-on-error` | — | — | Exit with code 1 on first conversion error |

**Examples:**

Minimal DevWeb conversion:
```bash
node src/cli.js convert -i collection.json
```

VuGen Web HTTP/HTML with environment file:
```bash
node src/cli.js convert -i collection.json -e staging.json --protocol web-http -o vugen-script/
```

Multi-script mode (large collections — one script per top-level folder):
```bash
node src/cli.js convert -i collection.json -m multi -o scripts/
```

Full options:
```bash
node src/cli.js convert \
  --input collections/my-api.json \
  --environment environment.json \
  --output devweb-scripts/my-api \
  --protocol devweb \
  --mode single \
  --think-time 2 \
  --no-transactions \
  --no-comments \
  --log-level debug \
  --fail-on-error
```

Bruno YAML directory:
```bash
node src/cli.js convert -i ./my-api-collection/ -e env.json -o my-devweb-script/
```

### 3.2 `analyze` — Inspect Without Generating

Parses the collection and reports what the converter will produce, without writing any files.

```
node src/cli.js analyze -i <file>
```

**Example:**
```bash
node src/cli.js analyze -i collection.json
```

**Sample output:**
```
Collection Analysis

Collection Info:
  Name: My API Collection
  Type: postman
  Requests: 25

Correlations:
  Total: 5
  1. authToken (token): Login → GetProfile
  2. userId (id): Login → UpdateUser
  3. orderId (id): CreateOrder → GetOrder

Parameters:
  Total: 12
  email: 3  string: 6  number: 2  url: 1

Authentication:
  Total: 2
  OAUTH2: 1  BEARER: 1
```

Use `analyze` before converting to verify the parser understood the collection correctly and to check which correlations were detected.

### 3.3 `convert-jmx` — JMeter Test Plans

```
node src/cli.js convert-jmx -i <file.jmx> [options]
```

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--input <file>` | `-i` | required | JMeter `.jmx` test plan |
| `--output <dir>` | `-o` | `./jmx-converted` | Output directory |
| `--protocol <proto>` | — | `devweb` | `devweb` or `web-http` |
| `--think-time <sec>` | `-t` | `1` | Default think time (overridden by timers in .jmx) |
| `--no-excel` | — | — | Skip Workload Model Excel generation |
| `--no-transactions` | — | — | Disable transaction wrapping |
| `--no-correlation` | — | — | Disable correlation detection |
| `--no-parameterization` | — | — | Disable parameterization |
| `--no-authentication` | — | — | Disable authentication handling |
| `--no-comments` | — | — | Omit code comments |

**Examples:**

DevWeb with WLM Excel (default):
```bash
node src/cli.js convert-jmx -i TestPlan.jmx -o my-devweb/
```

VuGen, no Excel:
```bash
node src/cli.js convert-jmx -i TestPlan.jmx --protocol web-http --no-excel -o my-vugen/
```

Skip transactions and comments:
```bash
node src/cli.js convert-jmx -i TestPlan.jmx --no-transactions --no-comments -o output/
```

### 3.4 `web` — Start the Web UI Server

```
node src/cli.js web [-p <port>]
```

| Option | Short | Default | Description |
|--------|-------|---------|-------------|
| `--port <port>` | `-p` | `3000` | HTTP port to listen on |

**Examples:**
```bash
node src/cli.js web                 # http://localhost:3000
node src/cli.js web --port 8080     # http://localhost:8080
```

---

## 4. Web UI Guide

The Web UI provides a browser-based interface for users who prefer not to use the command line.

### 4.1 Starting the Server

```bash
node src/cli.js web --port 3000
```

Open a browser and navigate to `http://localhost:3000` (or the configured host/port if deployed to IIS).

### 4.2 Tab 1 — Postman / Bruno Conversion

**Step 1: Select Protocol**

At the top of the form, choose your output protocol:
- **DevWeb (JavaScript)** — for modern LRE DevWeb scripts
- **VuGen Web HTTP/HTML (C)** — for classic VuGen scripts

**Step 2: Upload Collection File**

Click the upload area or drag and drop your file:
- Postman: `.json` (v2.1 format)
- Bruno: `.json`, `.yml`, `.yaml`, or `.bru`

**Step 3: Upload Environment File (optional)**

Upload your Postman or Bruno environment JSON file. This provides real values for `{{variables}}` in the collection.

**Step 4: Set Options**

| Option | Default | Purpose |
|--------|---------|---------|
| Enable Transactions | On | Wrap each request in a named transaction |
| Auto Correlation | On | Detect and wire up dynamic values |
| Parameterization | On | Extract variables to CSV/parameters file |
| Authentication | On | Generate auth code (OAuth2, Basic, etc.) |
| Add Comments | On | Include descriptive comments in generated code |
| Think Time (sec) | 1 | Pause between requests |
| Script Mode | Single | Single script, or one script per folder (Multi) |

**Step 5: Analyze (optional)**

Click **Analyze** to see a summary of what the converter detected — request count, correlations, parameters, auth configs — before committing to a full conversion. Useful for verifying the collection was parsed correctly.

**Step 6: Convert**

Click **Convert**. The server processes the collection in memory and streams the result back as a ZIP file download. A single-use download token (5-minute TTL) protects the link.

**Step 7: Extract and Use**

```bash
unzip devweb-script.zip -d my-script/
cd my-script/
```
For DevWeb: open `main.js` in your editor or run `devweb run main.js`.
For VuGen: open the `.usr` file in VuGen.

### 4.3 Tab 2 — JMeter Conversion

**Step 1: Select Protocol** — same as Tab 1.

**Step 2: Upload .jmx File** — drag and drop or click to select your JMeter test plan.

**Step 3: Toggle WLM Excel** — leave enabled (default) to receive the Workload Model Excel file alongside the script. Disable with the toggle if not needed.

**Step 4: Convert** — click Convert. The ZIP download includes the script files and, if enabled, the `*_WLM.xlsx` workload model spreadsheet.

### 4.4 Privacy and Security

- Uploaded files are held in server RAM only (`multer.memoryStorage()`). Nothing is written to disk.
- All generated files are also in-memory during processing and streamed directly to the browser via chunked transfer encoding.
- No ZIP file is written to disk on the server at any point.
- No `Content-Length` header is sent — chunked transfer bypasses corporate proxy size restrictions.
- `Content-Type: application/octet-stream` is used (not `application/zip`) to avoid zip-specific content filters.

---

## 5. Output Files Reference

### 5.1 DevWeb Output Files

| File | Purpose |
|------|---------|
| `main.js` | The LoadRunner DevWeb script. Contains `initialize()`, `action()`, and `finalize()` sections. |
| `rts.yml` | Runtime settings: pacing, think time multiplier, proxy configuration (if detected). |
| `scenario.yml` | Scenario config: VU count, ramp-up, hold time, iteration mode. |
| `parameters.yml` | Parameter definitions referencing `collection_data.csv`. One entry per parameterized variable. |
| `collection_data.csv` | CSV data file with one column per parameter and one row of seed values. |
| `tsconfig.json` | TypeScript config for IDE IntelliSense with the DevWeb SDK. |
| `DevWebSdk.d.ts` | DevWeb SDK type definitions. Required for IntelliSense and type checking. |
| `<ScriptName>.usr` | VuGen/LRE script manifest (also used by DevWeb upload). Open this in LoadRunner to load the script. |
| `default.cfg` | Runtime configuration in INI format: iteration count, proxy settings, think time. |
| `default.usp` | Run logic profile: init/action/end section behaviour. |
| `ScriptUploadMetadata.xml` | LRE upload manifest. Required when uploading to LoadRunner Enterprise via the REST API or UI. |

**If JWT is detected:**

| File | Purpose |
|------|---------|
| `jwt-helper.js` | JWT signing helper module (PS256, RS256, HS256). Referenced from `main.js`. |
| `transport.pem` | PEM key placeholder. Replace with your actual signing key. |

**Example `main.js` structure:**
```javascript
"use strict";

// ─── Transaction declarations (module scope) ──────────────────────────────────
const T01 = new load.Transaction("T01_Login");
const T02 = new load.Transaction("T02_GetProfile");
const T03 = new load.Transaction("T03_CreateOrder");

load.initialize("initialize", async function () {
    // OAuth2 token acquisition or other one-time setup
    const tokenResponse = new load.WebRequest({
        url: `${load.params.tokenUrl}`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_id=${load.params.clientId}&client_secret=${load.params.clientSecret}`
    }).sendSync();
    load.global.accessToken = tokenResponse.extractors["accessToken"];
});

load.action("Action", async function () {
    // T01 - Login
    T01.start();
    const response_01 = new load.WebRequest({
        id: 1,
        url: `${load.params.baseUrl}/auth/login`,
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: load.params.username, password: load.params.password }),
        extractors: [ new load.JsonPathExtractor("userId", "$.user.id") ]
    }).sendSync();
    load.global.userId = response_01.extractors["userId"];
    T01.stop(load.TransactionStatus.Passed);

    load.sleep(1);
});

load.finalize("finalize", async function () {
    // Cleanup
});
```

### 5.2 VuGen Web HTTP/HTML Output Files

| File | Purpose |
|------|---------|
| `Action.c` | Main test logic. Contains all HTTP requests using `web_url()` and `web_custom_request()`. |
| `vuser_init.c` | Initialization section. Authentication (web_set_user, OAuth token fetch) runs here. |
| `vuser_end.c` | Cleanup section. Logout requests go here if present. |
| `globals.h` | Standard includes (`lrun.h`, `web_api.h`, `lrw_custom_body.h`). |
| `<ScriptName>.usr` | VuGen script manifest. **Open this file in VuGen to load the script.** |
| `default.cfg` | Runtime configuration INI: iteration count, think time, proxy settings, NTLM/Kerberos flags. |
| `default.usp` | Run logic profile INI: vuser init/action/end section configuration. |
| `ParameterFile.prm` | Parameter definitions in VuGen INI format. One `[parameter:name]` section per variable. |
| `collection_data.dat` | CSV data file — parameter values (same data as `.csv`, `.dat` extension for VuGen). |
| `ScriptUploadMetadata.xml` | LRE upload manifest. |

**If JWT is detected:**

| File | Purpose |
|------|---------|
| `jsrsasign.js` | JavaScript JWT signing library for VuGen's `web_js_run()` approach. |
| `transport.pem` | PEM key placeholder. |

**Example `Action.c` structure:**
```c
#include "globals.h"

Action()
{
    // Variable declarations must be at top (C89)
    int    statusCode;
    char  *userId;

    // T01 - Login
    web_reg_save_param_json(
        "ParamName=userId",
        "QueryString=$.user.id",
        LAST);

    lr_start_transaction("T01_Login");
    web_custom_request("Login",
        "URL={baseUrl}/auth/login",
        "Method=POST",
        "Snapshot=t1.inf",
        "Mode=HTML",
        "EncType=application/json",
        "Body={\"username\":\"{username}\",\"password\":\"{password}\"}",
        LAST);
    lr_end_transaction("T01_Login", LR_AUTO);

    lr_think_time(1);

    return 0;
}
```

**Example `ParameterFile.prm`:**
```ini
[parameter:baseUrl]
Value1=https://api.example.com
GenerateNewVal=Once
ParamName=baseUrl
TableLocation=collection_data.dat
ColumnName=baseUrl
Delimiter=,

[parameter:username]
Value1=testuser1
GenerateNewVal=EachIteration
ParamName=username
TableLocation=collection_data.dat
ColumnName=username
Delimiter=,
```

---

## 6. JMeter Conversion Guide

The `convert-jmx` command (new in v2.8.0) parses JMeter `.jmx` test plans and produces the same output as the Postman/Bruno converter, plus a Workload Model Excel file.

### 6.1 Supported JMeter Elements

#### Thread Group Types

All standard and plugin thread groups are parsed and their load model values are captured in the WLM Excel:

| JMeter Type | Detection |
|-------------|-----------|
| Standard Thread Group | `ThreadGroup` |
| setUp Thread Group | `SetupThreadGroup` |
| tearDown Thread Group | `PostThreadGroup` |
| Stepping Thread Group (jp@gc) | `kg.apc.jmeter.threads.SteppingThreadGroup` |
| Ultimate Thread Group (jp@gc) | `kg.apc.jmeter.threads.UltimateThreadGroup` |
| Concurrency Thread Group (bzm) | `com.blazemeter.jmeter.threads.concurrency.ConcurrencyThreadGroup` |
| Arrivals Thread Group (bzm) | `com.blazemeter.jmeter.threads.arrivals.ArrivalsThreadGroup` |

#### HTTP Samplers

`HTTPSamplerProxy` elements are converted to `web_url()` (GET) or `web_custom_request()` (POST/PUT/DELETE/PATCH). The converter reads:
- Method, URL, path, port, protocol (http/https)
- Request headers from `HeaderManager`
- Request body: raw body, form parameters, multipart
- Redirects and keep-alive settings

#### Extractors (Correlations)

All four JMeter extractor types are converted:

| JMeter Extractor | DevWeb | VuGen |
|-----------------|--------|-------|
| `RegexExtractor` | `new load.RegexpExtractor(name, pattern)` | `web_reg_save_param_regexp(...)` |
| `BoundaryExtractor` | `new load.BoundaryExtractor(name, left, right)` | `web_reg_save_param(...)` (boundary) |
| `JSONPathExtractor` | `new load.JsonPathExtractor(name, path)` | `web_reg_save_param_json(...)` |
| `XPathExtractor` | `new load.XpathExtractor(name, query)` | `web_reg_save_param_xpath(...)` |

#### CSVDataSet

`CSVDataSet` elements become parameterized variables:
- The CSV filename is preserved in `ParameterFile.prm` / `parameters.yml`.
- Column names become parameter names.
- `recycle` and `stopThread` settings are mapped to `onEnd: loop` or `onEnd: stop`.

**Example:** A `CSVDataSet` referencing `users.csv` with columns `username,password` produces:

```yaml
# parameters.yml (DevWeb)
parameters:
  - name: username
    type: csv
    fileName: users.csv
    columnName: username
    nextValue: iteration
    nextRow: sequential
    onEnd: loop

  - name: password
    type: csv
    fileName: users.csv
    columnName: password
    nextValue: iteration
    nextRow: same as username
    onEnd: loop
```

#### TransactionController

`TransactionController` elements map directly to per-request transactions:

```
TransactionController "T01_Login"
  └── HTTPSamplerProxy "POST /auth/login"

→ Generated as:
  T01.start() / lr_start_transaction("T01_Login")
  ... request ...
  T01.stop() / lr_end_transaction("T01_Login", LR_AUTO)
```

#### Logic Controllers

Logic controllers (IfController, LoopController, WhileController, ForeachController, etc.) are **flattened** — all contained requests are included sequentially. A `// TODO:` comment is emitted in the generated code indicating where the logic controller was to allow manual recreation of conditional or loop logic.

```javascript
// TODO: IfController — "statusCode == 200" — requests inside were included unconditionally
```

#### Pre/Post Processors (JSR223 / BeanShell)

`JSR223Sampler`, `JSR223PreProcessor`, `JSR223PostProcessor`, `BeanShellPreProcessor`, and `BeanShellPostProcessor` elements have their script content captured and emitted as comments in the generated output. If the script contains JWT signing patterns (`KJUR.jws.JWS.sign`, `jsrsasign`, `crypto.sign` + `base64url`), JWT support is automatically activated.

```javascript
// JSR223 Pre-Processor script (Groovy):
// def accessToken = vars.get("access_token");
// request.headers["Authorization"] = "Bearer " + accessToken;
```

#### Timers

| JMeter Timer | Generated Code |
|-------------|----------------|
| `ConstantTimer` | `load.sleep(N)` / `lr_think_time(N)` |
| `GaussianRandomTimer` | `load.sleep(N)` / `lr_think_time(N)` (mean value used) |
| `UniformRandomTimer` | `load.sleep(N)` / `lr_think_time(N)` (mean value used) |

#### Authentication (HTTP Authorization Manager)

`AuthManager` entries are mapped to auth handlers:

| AuthManager Type | Generated Auth |
|-----------------|----------------|
| Basic | `web_set_user()` in `vuser_init.c` / `load.connection.defaults.credentials` |
| NTLM | `web_set_user()` + `UseNativeNTLM=1` in `default.cfg` |
| Kerberos / Negotiate | `web_set_user()` + `SPNCNameLookup=1` in `default.cfg` |
| Digest | `web_set_user()` with Digest scheme |

### 6.2 Workload Model Excel (WLM)

The `*_WLM.xlsx` file is generated automatically unless `--no-excel` is specified. Open it in Excel to extract the load model values you need when configuring your LRE test.

**Sheet 1 — Thread Groups**

One row per JMeter thread group. Columns include:

| Column | Description |
|--------|-------------|
| Group Name | Thread group name as defined in JMeter |
| Type | Standard / SetUp / TearDown / Stepping / Ultimate / Concurrency / Arrivals |
| Virtual Users | Peak VU count |
| Ramp-up (sec) | Time to reach peak VUs |
| Hold / Duration (sec) | Time to sustain peak load |
| Ramp-down (sec) | Ramp-down time (if specified) |
| Iterations | Loop count (-1 = infinite) |
| Scheduler | Start/end time if scheduled |

Rows are colour-coded by thread group type for quick visual identification.

**Sheet 2 — Transactions**

Lists every transaction name in the order it appears in the script, grouped by thread group. Use this to map LRE transactions to their expected load.

**Sheet 3 — LRE Setup Guide**

Static step-by-step instructions for recreating the JMeter workload model in LoadRunner Enterprise: creating a test, adding scripts, configuring VU counts, ramp-up, scheduler, and pacing.

> **Tip:** Copy the VU, ramp-up, and hold values from Sheet 1 directly into your LRE test configuration. The thread group names serve as script group names in LRE.

### 6.3 JMeter Conversion Limitations

- Only `HTTPSamplerProxy` elements are converted. JDBC, JMS, FTP, and other non-HTTP samplers are skipped with a warning comment.
- Logic controller conditions are not converted — flattened with TODO comments.
- Assertions (ResponseAssertion, JSONPathAssertion, etc.) are emitted as comments but not converted to active LoadRunner checks.
- `DebugSampler` and `TestAction` elements are skipped.

---

## 7. Variable Management — 3-Tier System

Every `{{variable}}` reference in a collection is classified into one of three tiers. The tier determines how the variable is accessed in the generated script and whether it is read once per test or once per iteration.

### 7.1 Tier Definitions

| Tier | Name | Access (DevWeb) | Access (VuGen) | `nextValue` | Used For |
|------|------|-----------------|----------------|-------------|----------|
| 1 | Dynamic | `load.global.varName` | `{varName}` (LR param) | N/A — set at runtime | Correlated values, script-set variables |
| 2 | Config | `load.params.varName` | `{varName}` (LR param) | `once` | Base URLs, client IDs, API keys |
| 3 | Test Data | `load.params.varName` | `{varName}` (LR param) | `iteration` | Usernames, passwords, email addresses |

### 7.2 Classification Rules (Priority Order)

The classifier applies these five rules in order — the first match wins:

1. **Script-set variable**: The variable is assigned via `bru.setEnv()`, `pm.environment.set()`, `pm.globals.set()`, `context.set()`, `vars.set()`, etc. → **Tier 1 Dynamic**

2. **Correlation target**: The variable is the output of a detected correlation (extractor result) → **Tier 1 Dynamic**

3. **Underscore prefix**: Variable name starts with `_` (e.g., `_accessToken`) → **Tier 1 Dynamic**

4. **Empty / null value in collection**: The variable exists in the collection/environment but has no value → **Tier 1 Dynamic**
   This catches runtime-only values like `access_token`, `refresh_token`, `interaction_id` that are populated during test execution and must never be written to the parameters CSV.

5. **Credential pattern + real value**: The variable has a non-empty value and matches a credential pattern (username, password, email, token, key) → **Tier 3 Test Data** (iteration)
   Any other variable with a non-empty value → **Tier 2 Config** (once)

### 7.3 Generated Parameter Files

**`parameters.yml` (DevWeb):**
```yaml
parameters:
  # Tier 2 Config — read once, same value for all VUs
  - name: baseUrl
    type: csv
    fileName: collection_data.csv
    columnName: baseUrl
    nextValue: once
    nextRow: sequential
    onEnd: loop

  - name: clientId
    type: csv
    fileName: collection_data.csv
    columnName: clientId
    nextValue: once
    nextRow: sequential
    onEnd: loop

  # Tier 3 Test Data — new value each iteration
  - name: username
    type: csv
    fileName: collection_data.csv
    columnName: username
    nextValue: iteration
    nextRow: sequential
    onEnd: loop

  - name: password
    type: csv
    fileName: collection_data.csv
    columnName: password
    nextValue: iteration
    nextRow: same as username
    onEnd: loop
```

**`collection_data.csv`:**
```csv
baseUrl,clientId,username,password
https://api.example.com,my-client-id,testuser1,Pass@123
```

**`ParameterFile.prm` (VuGen):**
```ini
[parameter:baseUrl]
Value1=https://api.example.com
GenerateNewVal=Once
ParamName=baseUrl
TableLocation=collection_data.dat
ColumnName=baseUrl
Delimiter=,

[parameter:username]
Value1=testuser1
GenerateNewVal=EachIteration
ParamName=username
TableLocation=collection_data.dat
ColumnName=username
Delimiter=,
```

### 7.4 Variable Syntax Differences

| Context | Syntax |
|---------|--------|
| DevWeb dynamic (Tier 1) | `load.global.varName` or `${load.global.varName}` in template literals |
| DevWeb config/test data (Tiers 2 & 3) | `load.params.varName` |
| VuGen all tiers | `{varName}` (LR parameter syntax — single braces) |

> **Warning:** In DevWeb, do NOT confuse `load.global` (dynamic runtime values) with `load.params` (file-based parameters). Dynamic values are never in CSV files — they are set and read in memory during script execution.

### 7.5 Adding Variables After Conversion

To add a new parameter after conversion:

**DevWeb — add to `collection_data.csv`:**
```csv
baseUrl,clientId,username,password,newParam
https://api.example.com,my-client-id,testuser1,Pass@123,myValue
```

**DevWeb — add to `parameters.yml`:**
```yaml
  - name: newParam
    type: csv
    fileName: collection_data.csv
    columnName: newParam
    nextValue: once
    nextRow: sequential
    onEnd: loop
```

**VuGen — add to `ParameterFile.prm`:**
```ini
[parameter:newParam]
Value1=myValue
GenerateNewVal=Once
ParamName=newParam
TableLocation=collection_data.dat
ColumnName=newParam
Delimiter=,
```

**VuGen — add to `collection_data.dat`:** append a new column header and value.

---

## 8. Correlation and Parameterization

### 8.1 How Correlation Detection Works

The converter performs a two-pass analysis:

**Pass 1 — Producer detection:** Scans every request's post-response scripts and extractors for variables being set:
- `pm.environment.set("token", ...)` / `pm.globals.set(...)` / `pm.collectionVariables.set(...)`
- `bru.setEnv("token", ...)` / `vars.set(...)`
- JMeter extractors: `RegexExtractor`, `BoundaryExtractor`, `JSONPathExtractor`, `XPathExtractor`
- Response body paths via `pm.response.json().someField`

**Pass 2 — Consumer detection:** For every detected producer variable, scans all requests to find where the value is consumed. A correlation chain is established (Producer Request → Consumer Request).

Any variable appearing in an `Authorization: Bearer {{token}}` header, OAuth2 flow, or JWT claim is also treated as a correlation target.

### 8.2 Correlation in Generated DevWeb Code

For each detected correlation, the generator emits an extractor on the producing request and a reference on the consuming request:

```javascript
// Producing request — extracts token
const response_01 = new load.WebRequest({
    url: `${load.params.baseUrl}/auth/login`,
    method: "POST",
    body: JSON.stringify({ username: load.params.username, password: load.params.password }),
    extractors: [
        new load.JsonPathExtractor("accessToken", "$.access_token"),
        new load.JsonPathExtractor("userId", "$.user.id")
    ]
}).sendSync();

load.global.accessToken = response_01.extractors["accessToken"];
load.global.userId      = response_01.extractors["userId"];

// Consuming request — uses extracted value
const response_02 = new load.WebRequest({
    url: `${load.params.baseUrl}/users/${load.global.userId}`,
    method: "GET",
    headers: {
        "Authorization": `Bearer ${load.global.accessToken}`
    }
}).sendSync();
```

### 8.3 Correlation in Generated VuGen Code

In VuGen, `web_reg_save_param_*()` calls must appear BEFORE the request that produces the value:

```c
// Register extraction BEFORE the producing request
web_reg_save_param_json(
    "ParamName=accessToken",
    "QueryString=$.access_token",
    LAST);

web_reg_save_param_json(
    "ParamName=userId",
    "QueryString=$.user.id",
    LAST);

// Producing request
web_custom_request("Login",
    "URL={baseUrl}/auth/login",
    "Method=POST",
    "Snapshot=t1.inf",
    "Mode=HTML",
    "EncType=application/json",
    "Body={\"username\":\"{username}\",\"password\":\"{password}\"}",
    LAST);

// Consuming request — LR substitutes {accessToken} and {userId} automatically
web_url("GetUserProfile",
    "URL={baseUrl}/users/{userId}",
    "Snapshot=t2.inf",
    "Mode=HTML",
    LAST);
```

### 8.4 Extractor Types

| Extractor | DevWeb | VuGen | When to Use |
|-----------|--------|-------|-------------|
| JSON Path | `new load.JsonPathExtractor(name, "$.path")` | `web_reg_save_param_json(...)` | JSON response bodies |
| Regex | `new load.RegexpExtractor(name, "pattern(capture)")` | `web_reg_save_param_regexp(...)` | Any text response |
| Boundary | `new load.BoundaryExtractor(name, left, right)` | `web_reg_save_param(...)` | HTML, XML, custom delimiters |
| XPath | `new load.XpathExtractor(name, "//xpath")` | `web_reg_save_param_xpath(...)` | XML / SOAP responses |

### 8.5 Adding Manual Correlations

If a dynamic value was not auto-detected, add an extractor manually.

**DevWeb:**
```javascript
extractors: [
    new load.JsonPathExtractor("sessionId", "$.session.id"),
    new load.RegexpExtractor("csrfToken", 'name="csrf_token" value="([^"]+)"')
]
```

Then assign and use:
```javascript
load.global.sessionId = response.extractors["sessionId"];
load.global.csrfToken = response.extractors["csrfToken"];
```

**VuGen:**
```c
// Before the producing request:
web_reg_save_param_json(
    "ParamName=sessionId",
    "QueryString=$.session.id",
    LAST);

web_reg_save_param_regexp(
    "ParamName=csrfToken",
    "RegExp=name=\"csrf_token\" value=\"([^\"]+)\"",
    "Ordinal=1",
    LAST);
```

### 8.6 Disabling Correlation or Parameterization

```bash
# Disable correlation (all variables treated as static)
node src/cli.js convert -i collection.json --no-correlation

# Disable parameterization (variables inlined as literals)
node src/cli.js convert -i collection.json --no-parameterization

# Disable both
node src/cli.js convert -i collection.json --no-correlation --no-parameterization
```

---

## 9. Authentication Reference

Authentication is applied in the `initialize()` function (DevWeb) or `vuser_init.c` (VuGen) so it runs once per VU before the action loop begins.

### 9.1 OAuth2 Client Credentials

The converter detects OAuth2 Client Credentials grant type and generates a token acquisition call in `initialize`.

**DevWeb `initialize()`:**
```javascript
load.initialize("initialize", async function () {
    const tokenResponse = new load.WebRequest({
        url: `${load.params.tokenUrl}`,
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=client_credentials&client_id=${load.params.clientId}&client_secret=${load.params.clientSecret}&scope=${load.params.scope}`,
        extractors: [ new load.JsonPathExtractor("oauth2AccessToken", "$.access_token") ]
    }).sendSync();
    load.global.oauth2AccessToken = tokenResponse.extractors["oauth2AccessToken"];
});
```

**Usage in requests:**
```javascript
headers: {
    "Authorization": `Bearer ${load.global.oauth2AccessToken}`
}
```

**VuGen `vuser_init.c`:**
```c
vuser_init()
{
    web_reg_save_param_json(
        "ParamName=oauth2AccessToken",
        "QueryString=$.access_token",
        LAST);

    web_custom_request("GetOAuth2Token",
        "URL={tokenUrl}",
        "Method=POST",
        "Snapshot=t1.inf",
        "Mode=HTML",
        "EncType=application/x-www-form-urlencoded",
        "Body=grant_type=client_credentials&client_id={clientId}&client_secret={clientSecret}",
        LAST);

    return 0;
}
```

### 9.2 OAuth2 Password Grant

```javascript
// DevWeb initialize()
body: `grant_type=password&username=${load.params.username}&password=${load.params.password}&client_id=${load.params.clientId}`
```

### 9.3 Bearer Token (Dynamic)

When a `{{variable}}` is used in an `Authorization: Bearer {{var}}` header and that variable is populated by a script or extractor, the variable is automatically classified as Tier 1 Dynamic and the appropriate `load.global.var` reference is generated.

```javascript
headers: {
    "Authorization": `Bearer ${load.global.accessToken}`
}
```

### 9.4 Basic Authentication

**DevWeb — `load.connection.defaults.credentials`:**
```javascript
load.initialize("initialize", async function () {
    load.connection.defaults.credentials = new load.Credentials(
        load.params.username,
        load.params.password,
        load.CredentialsType.BasicAuth
    );
});
```

**VuGen — `web_set_user()` in `vuser_init.c`:**
```c
vuser_init()
{
    web_set_user("{username}", "{password}", "api.example.com:443");
    return 0;
}
```

### 9.5 NTLM Authentication

**VuGen `vuser_init.c`:**
```c
vuser_init()
{
    web_set_user("{domain}\\{username}", "{password}", "api.example.com:443");
    return 0;
}
```

**`default.cfg`:**
```ini
[WebHttpOptions]
UseNativeNTLM=1
```

### 9.6 Kerberos / Negotiate

**VuGen `vuser_init.c`:**
```c
vuser_init()
{
    web_set_user("{username}", "{password}", "api.example.com:443");
    return 0;
}
```

**`default.cfg`:**
```ini
[WebHttpOptions]
SPNCNameLookup=1
```

### 9.7 API Key

**Header-based:**
```javascript
// DevWeb — added to every request header or as default
headers: {
    "X-API-Key": load.params.apiKey
}
```

```c
/* VuGen — web_add_header() before each request */
web_add_header("X-API-Key", "{apiKey}");
web_url("GetResource", "URL={baseUrl}/resource", "Snapshot=t1.inf", "Mode=HTML", LAST);
```

> **Note (VuGen):** `web_add_header()` applies to the **next single request only**. Place it immediately before each request that needs the header.

**Query parameter:**
```javascript
// DevWeb — appended to URL
url: `${load.params.baseUrl}/resource?api_key=${load.params.apiKey}`
```

### 9.8 AWS Signature v4

When AWS Sig v4 auth is detected, the generator produces the signing code in `initialize`:

```javascript
// DevWeb
load.initialize("initialize", async function () {
    // AWS credentials loaded from parameters
    load.connection.defaults.credentials = new load.Credentials(
        load.params.awsAccessKey,
        load.params.awsSecretKey,
        load.CredentialsType.AwsV4
    );
});
```

### 9.9 JWT (PS256 / RS256 / HS256)

JWT support is activated when the converter detects JWT signing patterns in pre-request scripts (`jsrsasign`, `KJUR.jws.JWS.sign`, `require('jsonwebtoken')`, `require('jose')`, or `crypto.sign` + `base64url`).

**Generated files added to output:** `jwt-helper.js` and `transport.pem`.

**DevWeb `initialize()`:**
```javascript
const jwtHelper = require('./jwt-helper');

load.initialize("initialize", async function () {
    const claims = {
        iss: load.params.clientId,
        sub: load.params.clientId,
        aud: load.params.tokenUrl,
        exp: Math.floor(Date.now() / 1000) + 300,
        iat: Math.floor(Date.now() / 1000)
    };
    load.global.jwtAssertion = jwtHelper.sign(claims, 'RS256');
});
```

> **Action required:** Replace `transport.pem` with your actual signing key before running the script.

### 9.10 Digest Authentication

**VuGen `vuser_init.c`:**
```c
vuser_init()
{
    web_set_user("{username}", "{password}", "api.example.com:443");
    // Digest negotiated automatically by VuGen when server returns 401 + WWW-Authenticate: Digest
    return 0;
}
```

---

## 10. Transactions

### 10.1 Naming Convention

Transactions use a global sequential counter across all folders in the collection:

```
T01_Login
T02_GetUserProfile
T03_CreateOrder
T04_GetOrderStatus
T05_Logout
```

- The prefix is `T` followed by a zero-padded two-digit counter.
- Numbers already in the request name are stripped from the label portion.
  - `"01 - Get Token"` → `T01_Get_Token`
- Special characters are replaced with underscores.

### 10.2 DevWeb — Module-Scope Declarations

Transaction objects are declared at module scope (before `initialize()`). This ensures they are accessible throughout the script. Only `.start()` and `.stop()` calls appear inside `action()`:

```javascript
// Module scope — all declarations here
const T01 = new load.Transaction("T01_Login");
const T02 = new load.Transaction("T02_GetUserProfile");
const T03 = new load.Transaction("T03_CreateOrder");

load.action("Action", async function () {

    // T01 - Login
    T01.start();
    const response_01 = new load.WebRequest({
        url: `${load.params.baseUrl}/auth/login`,
        method: "POST",
        // ...
    }).sendSync();
    T01.stop(load.TransactionStatus.Passed);

    load.sleep(1);

    // T02 - Get User Profile
    T02.start();
    const response_02 = new load.WebRequest({
        url: `${load.params.baseUrl}/users/${load.global.userId}`,
        method: "GET",
        // ...
    }).sendSync();
    T02.stop(load.TransactionStatus.Passed);

});
```

### 10.3 VuGen — Per-Request Wrapping

```c
Action()
{
    lr_start_transaction("T01_Login");
    web_custom_request("Login", /* ... */ LAST);
    lr_end_transaction("T01_Login", LR_AUTO);

    lr_think_time(1);

    lr_start_transaction("T02_GetUserProfile");
    web_url("GetUserProfile", /* ... */ LAST);
    lr_end_transaction("T02_GetUserProfile", LR_AUTO);

    return 0;
}
```

The `.usr` file's `[TransactionsOrder]` and `[Transactions]` sections are auto-populated from the transaction list.

### 10.4 Disabling Transactions

```bash
node src/cli.js convert -i collection.json --no-transactions
```

Without transactions, the `load.TransactionStatus` enum and `lr_start/end_transaction` calls are omitted from the generated script.

---

## 11. Post-Conversion Steps

The converter produces a working skeleton. Review the following items before running a full load test.

### 11.1 DevWeb Post-Conversion Checklist

1. **Review `main.js`** — confirm all requests are present and in the correct order.

2. **Check parameter values in `collection_data.csv`** — seed values come from the collection/environment. Replace placeholder values with real test data before uploading.
   ```csv
   baseUrl,clientId,clientSecret,username,password
   https://api.example.com,real-client-id,real-secret,testuser1,RealPass@1
   ```

3. **Verify `parameters.yml` tiers** — confirm Tier 2 / Tier 3 assignments match your test intent. If a variable that should iterate is marked `once`, change `nextValue: once` to `nextValue: iteration`.

4. **Confirm correlations** — run the script with one VU and `--log-level debug` to verify extracted values are non-null.

5. **Review `rts.yml` proxy section** — if the converter detected a proxy variable, confirm the proxy host and port are correct for the load test environment.

6. **Replace `transport.pem`** (JWT only) — paste in the actual PEM-encoded signing key.

7. **Configure `scenario.yml`** — set the final VU count, ramp-up duration, and hold time for your load model.

8. **Upload to LRE** — use the `ScriptUploadMetadata.xml` file when uploading via the LRE REST API, or drag the folder into the LRE script library.

### 11.2 VuGen Post-Conversion Checklist

1. **Open `.usr` in VuGen** — File → Open → select `<ScriptName>.usr`. Confirm the script compiles.

2. **Check `collection_data.dat`** — replace seed values with real test data.

3. **Verify `ParameterFile.prm`** — confirm `GenerateNewVal=Once` vs `EachIteration` assignments.

4. **Confirm correlation registrations** — run with one VU in VuGen's replay mode and check the Output window for successful parameter saves. If a `web_reg_save_param_*()` fails, VuGen logs a warning.

5. **Check `default.cfg`** for proxy and authentication flags:
   ```ini
   [WebHttpOptions]
   UseNativeNTLM=1         ; NTLM only
   SPNCNameLookup=1        ; Kerberos only
   ```

6. **Review `vuser_init.c`** — confirm auth credentials reference the correct parameter names (`{username}`, `{password}`).

7. **Replace `transport.pem`** (JWT only).

8. **Test replay** — run at 1 VU in VuGen before uploading to LRE.

9. **Upload to LRE** — use VuGen's Upload option or the LRE script library. `ScriptUploadMetadata.xml` controls the upload manifest.

### 11.3 Common Post-Conversion Fixes

**Fix: wrong `Content-Type` header**
The converter uses the content type from the collection. If the API changed, update the header in `main.js` or `Action.c`.

**Fix: multipart body**
If the collection contains a multipart/form-data body, VuGen's `web_custom_request` does not support `Body=` for multipart. The converter emits a `console.warn` / `/* TODO */` comment. Implement the body using `web_submit_data()` or `web_custom_request` with `ITEMDATA` / `BodyFilePath`.

**Fix: body too long (VuGen)**
For request bodies longer than approximately 500 characters, move the body to a separate file and reference it with `BodyFilePath=bodyfile.dat`. VuGen supports `{paramName}` substitution inside `BodyFilePath` files at runtime.

**Fix: missing extractor**
If a dynamic value is NULL at runtime, add a manual extractor (see [Section 8.5](#85-adding-manual-correlations)).

---

## 12. IIS Deployment

The web server can be deployed to IIS using the `iisnode` module, allowing the tool to be hosted on a corporate web server without users needing Node.js installed locally.

For full deployment instructions, see [DEPLOYMENT-IIS-GUIDE.md](./DEPLOYMENT-IIS-GUIDE.md).

**Key points:**
- `iisnode` runs the Node.js process inside IIS — you do not start `node` manually.
- The server has no internet access on most corporate networks. Copy `node_modules` from your development machine rather than running `npm install` on the server.
- Set the IIS Application Pool to **No Managed Code**.
- The web.config file must include a URL Rewrite rule to route all requests to `src/web/server.js`.
- Per-request memory isolation (RAM-only file system) means no temp files are left on disk between conversions — safe for a shared server.

---

## 13. Best Practices

### Collection Organisation

Structure your collection with meaningful folder names — these become transaction names and influence the readability of the generated script.

**Recommended structure:**
```
My API
├── 01_Authentication
│   ├── Login
│   └── Refresh Token
├── 02_User Management
│   ├── Get User Profile
│   ├── Update User
│   └── Delete User
├── 03_Orders
│   ├── Create Order
│   ├── Get Order
│   └── Cancel Order
└── 04_Cleanup
    └── Logout
```

**Avoid:**
```
My API
├── Test 1
├── New Request
├── Copy of Request
└── temp
```

### Variable Naming

Consistent, descriptive variable names make the generated script easier to review:

| Good | Avoid |
|------|-------|
| `{{baseUrl}}` | `{{url}}` |
| `{{clientId}}` | `{{id}}` |
| `{{accessToken}}` | `{{token}}` |
| `{{username}}` | `{{user}}` |

### Environment Files

Always provide an environment file (`-e`) when converting. Without it, collection variables may have empty values, causing all of them to fall into Tier 1 Dynamic (Rule 4), which generates `load.global.*` references for values that should be in the CSV.

```bash
# Correct — environment file provides actual values
node src/cli.js convert -i collection.json -e staging.json

# Acceptable — but variable values may be missing
node src/cli.js convert -i collection.json
```

### Multi-Script Mode for Large Collections

For collections with more than 8–10 top-level folders, use `-m multi` to produce one independent script per folder. This improves maintainability and allows each script to be independently uploaded and scheduled in LRE.

```bash
node src/cli.js convert -i large-collection.json -m multi -o scripts/
```

### Think Time

Set a realistic think time that reflects end-user behaviour:
- Browser-based applications: `--think-time 3` to `--think-time 5`
- API-only flows (no human interaction): `--think-time 1` or `--think-time 0`
- Mixed: use the default `--think-time 1` and adjust per-request in the script

### Sensitive Data

- The generated CSV/DAT files will contain whatever values were in your collection/environment. Do not commit files containing real passwords or API keys to version control.
- After conversion, replace placeholder values in `collection_data.csv` / `collection_data.dat` with test-environment-specific credentials stored in a secrets manager.

---

## 14. Troubleshooting

### "No file uploaded" / upload fails in Web UI

- Verify the file extension: `.json`, `.bru`, `.yml`, `.yaml`, or `.jmx`.
- For a Bruno YAML folder, use the CLI (`-i ./folder/`) — the web UI does not accept directory uploads.
- Check that the file is not corrupted or empty.

### Conversion fails: "No HTTP requests found"

The parser did not find any requests in the file.

- **Postman:** Confirm the file is v2.1 format (check `info.schema` in the JSON).
- **Bruno JSON:** Confirm the file has an `items[]` array.
- **JMX:** Confirm the file contains `HTTPSamplerProxy` elements. JDBC-only or JMS-only plans contain no HTTP requests.
- Run `analyze` first to confirm the file is parseable.

### Variables are `undefined` at runtime (DevWeb)

Symptom: `load.params.myVar` is `undefined` when the script runs.

Causes and fixes:
1. The variable is not in `parameters.yml` — check the file and add the missing entry.
2. The column name in `parameters.yml` does not match a column in `collection_data.csv` — align the names.
3. The variable was classified as Tier 1 Dynamic but you expected Tier 2 Config — add a non-empty value to the environment file before converting, or edit `parameters.yml` manually after conversion.

### `{paramName}` not substituted at runtime (VuGen)

Symptom: literal `{username}` appears in traffic instead of the actual value.

Causes and fixes:
1. The parameter is not defined in `ParameterFile.prm` — add the `[parameter:username]` section.
2. The column `username` is missing from `collection_data.dat` — add it.
3. The parameter name in `ParameterFile.prm` does not exactly match the `{name}` used in `Action.c` — case-sensitive.

### Correlation not working (extracted value is always NULL)

**DevWeb:**
Check the extractor path. For JSON responses, verify the JSONPath expression against the actual response body. Use `json.stringify(response.json(), null, 2)` in a debug run to inspect the response.

**VuGen:**
The `web_reg_save_param_*()` call must appear before the request that produces the value, not after. Check the ordering in `Action.c`. Enable "Extended log" in VuGen run-time settings and look for `Saving Param` messages in the Output window.

### Authentication token is empty

- Verify the token endpoint URL is correct in `collection_data.csv` / `parameters.yml`.
- Confirm that `clientId`, `clientSecret`, and other auth parameters have real values in the CSV.
- Check the JSONPath extractor for the token: confirm it matches the actual JSON field name (`$.access_token` vs `$.token` vs `$.accessToken`).

### Generated script has no transactions

The `--no-transactions` flag was used, or the collection has no named requests. Transactions require request names to generate `T01_RequestName` labels. Requests with empty or generic names (e.g., "New Request") still get transactions using the auto-counter.

### JMX: thread group VU count shows 0 in WLM Excel

The thread group uses a plugin type (Stepping, Ultimate, Concurrency, Arrivals) where the VU count is stored in a different property. Open the original `.jmx` in JMeter to find the VU value, and enter it manually in the WLM Excel Sheet 1.

### Proxy section appears in `rts.yml` when not expected

The converter detected a variable whose name matches a proxy pattern (`proxy`, `proxyUrl`, `http_proxy`, etc.) in the collection/environment. If proxy is not needed, remove the `proxy:` section from `rts.yml` or remove the matching variable from `collection_data.csv`.

---

## 15. FAQ

**Q: Which output protocol should I use?**

DevWeb (JavaScript) is recommended for new projects — it is the modern LoadRunner scripting approach with better IDE support and a cleaner API. Use VuGen Web HTTP/HTML (C) if your LRE license covers Web HTTP/HTML only, or if you need to integrate with an existing VuGen script library.

**Q: Can I convert a collection with 100+ requests?**

Yes. Use `-m multi` (multi-script mode) for large collections. Each top-level folder becomes a separate, independent script. For single-script mode, there is no hard limit, but scripts above ~50 requests become difficult to maintain manually.

**Q: Why does the converter produce `load.global.accessToken` instead of `load.params.accessToken`?**

`accessToken` has an empty value in the collection (it is populated at runtime by the login response). Empty-value variables are classified as Tier 1 Dynamic by Rule 4 of the classification algorithm. Dynamic values are accessed via `load.global`, not `load.params`. This is correct behaviour — `access_token` should never be in the parameters CSV.

**Q: I have a `.bru` folder but also a separate environment `.bru` file — how do I use both?**

Pass the environment file with `-e`. Bruno environment files use the same JSON format as Postman environments when exported. If the file is in Bruno's native YAML format, convert it to JSON first or add the variable values directly to the collection's `vars` section.

**Q: Can I re-run conversion to update a script after the collection changes?**

Yes. Re-run the same `convert` command with the updated collection. The output directory is overwritten. Any manual edits to `main.js` or `Action.c` will be lost — keep your customisations in a separate branch or file.

**Q: The WLM Excel is missing the VU count for my Concurrency Thread Group — why?**

bzm Concurrency Thread Group uses `TargetLevel` instead of `numThreads`. The parser reads `TargetLevel` and maps it to the Virtual Users column. If the value is still zero, open the `.jmx` in a text editor and search for `TargetLevel` to confirm the value is set.

**Q: Can I convert a collection that uses GraphQL?**

GraphQL requests are HTTP POST requests with a JSON body. They convert correctly — the URL, method, and body are preserved. GraphQL-specific features (query variables, fragments, introspection) are not interpreted; the raw body is passed through as-is.

**Q: Can I use this in a CI/CD pipeline (Jenkins, GitHub Actions, GitLab CI)?**

Yes. The CLI (`node src/cli.js`) runs in any environment with Node.js 14+. Install dependencies with `npm ci --omit=dev` and run the converter as a pipeline step. Example for GitHub Actions:

```yaml
- name: Convert to DevWeb
  run: |
    npm ci --omit=dev
    node src/cli.js convert -i collections/my-api.json -e env/staging.json -o devweb-scripts/
- name: Upload artifact
  uses: actions/upload-artifact@v3
  with:
    name: devweb-script
    path: devweb-scripts/
```

**Q: How do I handle a collection with mixed auth (some requests use OAuth2, others use API Key)?**

Mixed auth is supported. The converter generates auth code for the collection-level auth in `initialize()`. Request-level auth overrides are applied per-request. If a request has `auth: none` in Bruno, no auth header is added to that specific request.

**Q: The generated script has `// TODO:` comments — what do they mean?**

TODO comments flag areas that require manual attention:
- Logic controller conditions (JMX) that were flattened
- JSR223/BeanShell scripts that could not be automatically translated
- Multipart body forms in VuGen (not supported in `Body=` parameter)
- JWT PEM key placeholder replacement

Search for `TODO` in the generated files after conversion and address each one before running a load test.

**Q: Is the web server safe to deploy on a shared internal server?**

Yes. The web server uses `multer.memoryStorage()` for uploads (never writes files to disk), an in-memory file system interceptor for all generated files, and chunked streaming to send the ZIP directly to the browser. No user data persists after the download completes. Multiple concurrent users are handled safely via Node.js async/await and per-request memory isolation.

**Q: What Node.js version is required?**

Node.js 14 or later. Node.js 18 LTS or 20 LTS is recommended.

---

*LR Script Converter v2.8.0 — March 2026*
