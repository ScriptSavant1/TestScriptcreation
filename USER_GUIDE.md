# 📖 User Guide

Complete guide for using the Bruno to DevWeb Converter.

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Basic Usage](#basic-usage)
3. [Advanced Features](#advanced-features)
4. [Web UI Guide](#web-ui-guide)
5. [GitLab Integration](#gitlab-integration)
6. [Best Practices](#best-practices)
7. [Examples](#examples)
8. [FAQ](#faq)

---

## Getting Started

### Installation

**Option 1: From npm (Coming Soon)**
```bash
npm install -g bruno-devweb-converter
```

**Option 2: From Source**
```bash
git clone https://gitlab.com/your-org/bruno-devweb-converter.git
cd bruno-devweb-converter
npm install
npm link
```

**Option 3: Using Docker (Recommended for CI/CD)**
```bash
# Linux — run directly from registry, no Node.js needed:
docker run --rm -v $(pwd):/workspace \
  registry.gitlab.com/your-org/bruno-devweb-converter:latest \
  convert -i my-collection.json -o output/
```

### First Conversion

1. **Prepare your collection**:
   - Export from Bruno or Postman
   - Save as .json or .bru file

2. **Run conversion**:
   ```bash
   bruno-devweb convert -i my-collection.json -o my-script
   ```

3. **Review output**:
   ```bash
   cd my-script
   ls -la
   # main.js  scenario.yml  rts.yml  tsconfig.json  parameters.yml  collection_data.csv
   ```

4. **Test the script**:
   ```bash
   devweb run main.js
   ```

---

## Basic Usage

### Command Line Interface

#### Convert Command

**Minimal Example**:
```bash
bruno-devweb convert -i collection.json
```

**With Options**:
```bash
bruno-devweb convert \
  -i my-api.json \
  -o custom-output \
  --think-time 2.5 \
  --log-level debug
```

**With Environment File**:
```bash
bruno-devweb convert -i my-api.json -e environment.json -o my-script
```

**Multi-Script Mode** (one script per top-level folder):
```bash
bruno-devweb convert -i my-api.json -o output/ -m multi
```

**All Options**:
```bash
bruno-devweb convert \
  --input collections/my-api.json \
  --environment environment.json \
  --output devweb-scripts/my-api \
  --mode single \
  --no-transactions \
  --no-correlation \
  --no-parameterization \
  --no-authentication \
  --think-time 3 \
  --no-comments \
  --log-level info \
  --fail-on-error
```

#### Analyze Command

**Quick Analysis**:
```bash
bruno-devweb analyze -i collection.json
```

**Sample Output**:
```
📊 Collection Analysis

Collection Info:
  Name: My API Collection
  Type: postman
  Requests: 25

Correlations:
  Total: 5
  1. authToken (token): Login → GetProfile
  2. userId (id): Login → UpdateUser
  3. orderId (id): CreateOrder → GetOrder
  4. sessionId (sessionId): StartSession → ValidateSession
  5. csrf (csrf): GetForm → SubmitForm

Parameters:
  Total: 12
  email: 3
  string: 6
  number: 2
  url: 1

Authentication:
  Total: 2
  OAUTH2: 1
  BEARER: 1
```

#### Web UI Command

**Start Server**:
```bash
bruno-devweb web --port 3000
```

**With Custom Port**:
```bash
bruno-devweb web --port 8080
```

---

## Advanced Features

### 1. Correlation Management

#### Automatic Detection

The converter automatically detects:
- **Authentication Tokens**: Bearer tokens, JWT, OAuth tokens
- **Session IDs**: Session identifiers, tracking IDs
- **CSRF Tokens**: Cross-site request forgery tokens
- **Entity IDs**: User IDs, Order IDs, Product IDs
- **Timestamps**: Nonces, timestamps

#### Manual Correlation

If automatic detection misses a correlation:

1. **Check ANALYSIS.md**:
   ```markdown
   ## Correlation Analysis
   **Total Correlations Detected**: 3
   ```

2. **Review generated extractors** in `main.js`:
   ```javascript
   extractors: [
     new load.JsonPathExtractor("authToken", "$.token")
   ]
   ```

3. **Add missing extractors manually**:
   ```javascript
   extractors: [
     new load.JsonPathExtractor("authToken", "$.token"),
     new load.JsonPathExtractor("customValue", "$.data.custom")  // Add this
   ]
   ```

4. **Use the value**:
   ```javascript
   headers: {
     "X-Custom-Header": load.global.customValue
   }
   ```

### 2. 3-Tier Variable Classification

All `{{variables}}` in collections are classified into 3 tiers:

| Tier | Access | nextValue | When to use |
|------|--------|-----------|-------------|
| **Dynamic** | `load.global.var` | N/A | Correlations, script-set values |
| **Config** | `load.params.var` | `once` | URLs, API keys, client IDs |
| **Test Data** | `load.params.var` | `iteration` | Usernames, passwords, emails |

#### Generated parameters.yml:
```yaml
parameters:
  - name: baseUrl
    type: csv
    fileName: collection_data.csv
    columnName: baseUrl
    nextValue: once           # Config: same for all iterations
    nextRow: sequential
    onEnd: loop

  - name: username
    type: csv
    fileName: collection_data.csv
    columnName: username
    nextValue: iteration      # Test data: different per vuser
    nextRow: sequential
    onEnd: loop

  - name: password
    type: csv
    fileName: collection_data.csv
    columnName: password
    nextValue: iteration
    nextRow: same as username  # Keep credential pairs linked
    onEnd: loop
```

#### Generated collection_data.csv:
```csv
baseUrl,username,password
https://api.example.com,testuser1,Pass@123
```

#### In Generated Script:
```javascript
const webResponse_01 = new load.WebRequest({
    id: 1,
    url: `${load.params.baseUrl}/auth/login`,   // Tier 2: config
    method: "POST",
    body: {
        "username": load.params.username,         // Tier 3: test data
        "password": load.params.password          // Tier 3: test data
    },
    extractors: [
        new load.JsonPathExtractor("token", "$.access_token")
    ]
}).sendSync();

load.global.token = webResponse_01.extractors.token;  // Tier 1: dynamic
```

#### Environment File Override:
Use `-e environment.json` to override collection variable values:
```bash
bruno-devweb convert -i collection.json -e production.json -o prod-script
```
Environment values replace collection variable values in the generated CSV.

### 3. Authentication

#### OAuth 2.0 Setup

**Client Credentials**:
```bash
# In collection, set:
{
  "auth": {
    "type": "oauth2",
    "oauth2": [
      {"key": "grant_type", "value": "client_credentials"},
      {"key": "accessTokenUrl", "value": "https://api.example.com/oauth/token"},
      {"key": "clientId", "value": "{{CLIENT_ID}}"},
      {"key": "clientSecret", "value": "{{CLIENT_SECRET}}"}
    ]
  }
}
```

**Generated Code**:
```javascript
// In initialize section
const oauth2Token_request = new load.WebRequest({
    url: "https://api.example.com/oauth/token",
    method: "POST",
    body: {
        grant_type: "client_credentials",
        client_id: load.params.CLIENT_ID,
        client_secret: load.params.CLIENT_SECRET
    },
    extractors: [
        new load.JsonPathExtractor("accessToken", "$.access_token")
    ]
});

load.global.oauth2AccessToken = oauth2Token_response.extractors.accessToken;
```

**Usage in Requests**:
```javascript
headers: {
    "Authorization": `Bearer ${load.global.oauth2AccessToken}`
}
```

#### Basic Authentication

**Collection Setup**:
```json
{
  "auth": {
    "type": "basic",
    "basic": [
      {"key": "username", "value": "admin"},
      {"key": "password", "value": "password123"}
    ]
  }
}
```

**Generated Code**:
```javascript
const basicAuthCredentials = load.utils.base64Encode(
  `${load.params.username}:${load.params.password}`
);
load.global.basicAuthHeader = `Basic ${basicAuthCredentials}`;
```

#### API Key Authentication

**Header-based**:
```json
{
  "auth": {
    "type": "apikey",
    "apikey": [
      {"key": "key", "value": "X-API-Key"},
      {"key": "value", "value": "{{API_KEY}}"},
      {"key": "in", "value": "header"}
    ]
  }
}
```

**Query Parameter**:
```json
{
  "auth": {
    "type": "apikey",
    "apikey": [
      {"key": "key", "value": "api_key"},
      {"key": "value", "value": "{{API_KEY}}"},
      {"key": "in", "value": "query"}
    ]
  }
}
```

### 4. Transactions

#### Folder-Based Grouping

**Collection Structure**:
```
My API
├── Authentication
│   ├── Login
│   └── Logout
├── Users
│   ├── Get User
│   ├── Update User
│   └── Delete User
└── Orders
    ├── Create Order
    └── Get Order
```

**Generated Transactions** (declared INSIDE action, at the top):
```javascript
load.action("Action", async function () {
    // All transaction declarations at the top of action
    let TS01 = new load.Transaction("Authentication");
    let TS02 = new load.Transaction("Users");
    let TS03 = new load.Transaction("Orders");

    // TS01 - Authentication
    TS01.start();
    const webResponse_01 = new load.WebRequest({...}).sendSync();
    TS01.stop(load.TransactionStatus.Passed);

    load.sleep(1);

    // TS02 - Users
    TS02.start();
    const webResponse_02 = new load.WebRequest({...}).sendSync();
    const webResponse_03 = new load.WebRequest({...}).sendSync();
    TS02.stop(load.TransactionStatus.Passed);
});
```

#### Multi-Script Mode

For large collections with many top-level folders, use `-m multi`:
```bash
bruno-devweb convert -i collection.json -o output/ -m multi
```

Each top-level folder becomes a separate, self-contained DevWeb script folder
that can be independently uploaded to LoadRunner Enterprise.

---

## Web UI Guide

### Starting the Web UI

```bash
bruno-devweb web --port 3000
```

Open browser: `http://localhost:3000`

### Using the Web UI

1. **Upload Collection**:
   - Drag and drop .json or .bru file
   - Or click to browse

2. **Configure Options**:
   - ✅ Enable Transactions
   - ✅ Auto Correlation
   - ✅ Parameterization
   - ✅ Authentication
   - ✅ Add Comments
   - Set Think Time (seconds)

3. **Analyze First** (Optional):
   - Click "📊 Analyze Collection"
   - Review statistics
   - Check correlations, parameters, auth

4. **Convert**:
   - Click "🔄 Convert to DevWeb"
   - Wait for processing
   - Download ZIP file

5. **Extract and Use**:
   ```bash
   unzip devweb-script.zip
   cd devweb-script
   devweb run main.js
   ```

---

## GitLab Integration

### Using the Docker Image in Your Team's Pipeline

The converter is published as a Docker image. Include it in your team's pipeline — no installation required.

**Linux runner (zero setup, recommended):**
```yaml
# In your team's .gitlab-ci.yml
convert:
  image: registry.gitlab.com/your-org/bruno-devweb-converter:latest
  tags: [linux]
  script:
    - bruno-devweb convert -i my-collection.json -o output/
    - bruno-devweb convert -i MyCollection.yml -m multi -o scripts/
  artifacts:
    paths: [output/]
    expire_in: 1 week
```

**Windows runner (shell executor):**
```yaml
convert:
  tags: [windows]
  before_script:
    - git clone https://gitlab.com/your-org/bruno-devweb-converter.git $env:TEMP\bdw
    - npm ci --prefix $env:TEMP\bdw --omit=dev
  script:
    - node $env:TEMP\bdw\src\cli.js convert -i my-collection.json -o output/
  artifacts:
    paths: [output/]
```

### CLI Options in Pipeline Scripts

```yaml
script:
  # Basic conversion
  - bruno-devweb convert -i collection.json -o output/

  # With environment override and multi-mode
  - bruno-devweb convert -i collection.json -e prod.json -m multi -o scripts/

  # With custom think time and log level
  - bruno-devweb convert -i collection.json -t 2 --log-level debug -o output/
```

### Pipeline Runner Requirements

| Runner OS | Approach | Requirement |
|-----------|----------|-------------|
| Linux | Use `image:` with Docker | Runner must support Docker |
| Windows | Clone repo + `npm ci` | Node.js >= 14 on runner |

---

## Best Practices

### Collection Organization

**✅ Good Structure**:
```
API Tests
├── 01_Authentication
│   ├── Login
│   └── Logout
├── 02_User_Management
│   ├── Create_User
│   ├── Get_User
│   └── Update_User
└── 03_Cleanup
    └── Delete_User
```

**❌ Avoid**:
```
API Tests
├── Test 1
├── Test 2
├── My Request
└── New Request
```

### Naming Conventions

**Request Names**:
- ✅ Descriptive: "Get User Profile"
- ✅ Action-based: "Create Order"
- ❌ Generic: "Request 1", "Test"

**Variable Names**:
- ✅ Clear: `{{authToken}}`, `{{userId}}`
- ✅ Consistent: `{{base_url}}`, `{{api_key}}`
- ❌ Unclear: `{{var1}}`, `{{temp}}`

### Parameter Management

**Use Environment Variables**:
```json
{
  "variable": [
    {"key": "baseUrl", "value": "https://api.example.com"},
    {"key": "apiKey", "value": "{{API_KEY}}"}
  ]
}
```

**Separate Sensitive Data**:
- Store credentials in GitLab CI/CD variables
- Use parameters.yml for non-sensitive defaults
- Override with environment-specific values

### Error Handling

**Check Status Codes**:
```javascript
if (response.status !== 200) {
    load.log(`Unexpected status: ${response.status}`, load.LogLevel.error);
    throw new Error(`Request failed with status ${response.status}`);
}
```

**Validate Responses**:
```javascript
if (!response.extractors.authToken) {
    load.log("Failed to extract auth token", load.LogLevel.error);
    throw new Error("Authentication failed");
}
```

---

## Examples

### Example 1: Simple REST API

**Collection**:
```json
{
  "name": "Simple API",
  "item": [
    {
      "name": "Get Users",
      "request": {
        "method": "GET",
        "url": "https://api.example.com/users"
      }
    }
  ]
}
```

**Command**:
```bash
bruno-devweb convert -i simple-api.json
```

**Result**: `devweb-script/main.js`

### Example 2: Authenticated API

**Collection** (with OAuth):
```json
{
  "name": "Authenticated API",
  "auth": {
    "type": "oauth2",
    "oauth2": [
      {"key": "grant_type", "value": "client_credentials"},
      {"key": "accessTokenUrl", "value": "https://api.example.com/oauth/token"}
    ]
  },
  "item": [...]
}
```

**Command**:
```bash
bruno-devweb convert \
  -i auth-api.json \
  --think-time 2
```

### Example 3: E-commerce Flow

**Collection Structure**:
```
E-commerce
├── Auth
│   └── Login
├── Products
│   ├── List Products
│   └── Get Product
├── Cart
│   ├── Add to Cart
│   └── Checkout
└── Cleanup
    └── Clear Cart
```

**Command**:
```bash
bruno-devweb convert \
  -i ecommerce.json \
  -o ecommerce-test \
  --think-time 1.5
```

---

## FAQ

### Q: What collection formats are supported?
**A**: Bruno (.bru and .json) and Postman (.json) formats.

### Q: Can I convert multiple collections at once?
**A**: Yes, using a shell script:
```bash
for file in collections/*.json; do
  bruno-devweb convert -i "$file" -o "scripts/$(basename $file .json)"
done
```

### Q: How do I handle dynamic data?
**A**: The converter automatically detects correlations. Check ANALYSIS.md for details.

### Q: Can I customize the generated script?
**A**: Yes! The generated scripts are fully editable JavaScript files.

### Q: What if correlation detection fails?
**A**: Add manual extractors:
```javascript
extractors: [
  new load.JsonPathExtractor("missingValue", "$.path.to.value")
]
```

### Q: How do I test locally before deploying?
**A**: Use DevWeb locally:
```bash
cd devweb-script
devweb run main.js
```

### Q: Can I use this in Jenkins/GitHub Actions?
**A**: Yes! The CLI can be integrated into any CI/CD system.

### Q: How do I handle file uploads?
**A**: Use MultipartBody in the collection or modify the generated script:
```javascript
body: new load.MultipartBody([
  new load.MultipartBody.FileEntry("file", "./upload.pdf")
])
```

### Q: Can I disable certain features?
**A**: Yes, use `--no-transactions`, `--no-correlation`, etc.

### Q: How do I update credentials?
**A**: Edit `parameters.yml` or use environment variables.

---

## Troubleshooting

### Issue: "No file uploaded" in Web UI
**Solution**: Ensure file is .json or .bru format

### Issue: Conversion fails with syntax error
**Solution**: Validate collection format:
```bash
bruno-devweb analyze -i collection.json
```

### Issue: Correlation not working
**Solution**: 
1. Check if variable names match
2. Review ANALYSIS.md
3. Add manual extractors if needed

### Issue: Authentication not applied
**Solution**:
1. Verify auth config in collection
2. Check generated initialize section
3. Ensure credentials in parameters.yml

---

**Need More Help?**
- 📧 Email: support@yourorg.com
- 🐛 Issues: [GitLab Issues](https://gitlab.com/your-org/bruno-devweb-converter/issues)
- 📚 Docs: [Wiki](https://gitlab.com/your-org/bruno-devweb-converter/wiki)

---

*Version 2.1.1 - Last Updated: February 2026*
