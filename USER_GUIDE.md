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

**Option 3: Using Docker**
```bash
docker pull your-org/bruno-devweb-converter:latest
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
   # main.js  config.yml  parameters.yml  README.md  ANALYSIS.md
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

**All Options**:
```bash
bruno-devweb convert \
  --input collections/my-api.json \
  --output devweb-scripts/my-api \
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

### 2. Parameterization

#### Using Parameters

**Generated parameters.yml**:
```yaml
parameters:
  baseUrl:
    type: url
    value: https://api.example.com
    description: Base URL for API requests
    source: url
  
  username:
    type: email
    value: user@example.com
    description: User email for login
    source: body
  
  password:
    type: string
    value: secret123
    description: User password
    source: body
```

**In Generated Script**:
```javascript
const Login_request = new load.WebRequest({
  url: `${load.params.baseUrl}/auth/login`,
  body: {
    username: load.params.username,
    password: load.params.password
  }
});
```

#### Adding Custom Parameters

1. **Edit parameters.yml**:
   ```yaml
   parameters:
     customParam:
       type: string
       value: myCustomValue
       description: My custom parameter
       source: custom
   ```

2. **Use in script**:
   ```javascript
   headers: {
     "X-Custom": load.params.customParam
   }
   ```

#### Parameter Data Files

Generated data files in `data/` directory:

**data/username.csv**:
```csv
username
user1@example.com
user2@example.com
user3@example.com
```

**data/userId.csv**:
```csv
userId
1001
1002
1003
```

**Using Data Files**:
Update `config.yml`:
```yaml
parameters:
  username:
    file: data/username.csv
    selection: sequential
    update: iteration
```

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

**Generated Transactions**:
```javascript
// Transaction: Authentication
const Authentication_transaction = new load.Transaction("Authentication");
Authentication_transaction.start();
try {
    // Login request
    // Logout request
    Authentication_transaction.stop(load.TransactionStatus.Passed);
} catch (error) {
    Authentication_transaction.stop(load.TransactionStatus.Failed);
}

// Transaction: Users
const Users_transaction = new load.Transaction("Users");
// ...
```

#### Custom Transaction Boundaries

To modify transaction boundaries, edit the generated script:

```javascript
// Combine multiple folders into one transaction
const MainFlow_transaction = new load.Transaction("MainFlow");
MainFlow_transaction.start();

// Login
// Get User
// Create Order

MainFlow_transaction.stop(load.TransactionStatus.Passed);
```

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

### Setup Repository

```bash
# Initialize repository
git init
git remote add origin https://gitlab.com/your-org/api-tests.git

# Add collections
mkdir collections
cp my-api.json collections/

# Add .gitlab-ci.yml
cp .gitlab-ci.yml ./

# Commit and push
git add .
git commit -m "Initial commit"
git push -u origin main
```

### Configure CI/CD Variables

In GitLab: **Settings → CI/CD → Variables**

Required variables:
- `LRE_URL`: https://lre.yourcompany.com
- `LRE_API_KEY`: your-api-key-here

Optional variables:
- `THINK_TIME`: 2
- `LOG_LEVEL`: info

### Pipeline Execution

**Manual Trigger**:
```bash
git add collections/updated-api.json
git commit -m "Update API collection"
git push origin main
```

**Pipeline Stages**:
1. ✅ **Validate**: Check collection syntax
2. ✅ **Convert**: Generate DevWeb scripts
3. ✅ **Test**: Validate generated scripts
4. ✅ **Package**: Create ZIP archives
5. 🔵 **Deploy**: Upload to LRE (manual)

**View Results**:
- Go to CI/CD → Pipelines
- Click on pipeline
- Download artifacts

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

*Version 2.0.0 - Last Updated: February 2026*
