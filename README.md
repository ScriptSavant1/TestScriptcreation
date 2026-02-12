# 🚀 Bruno to DevWeb Converter

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://gitlab.com/your-org/bruno-devweb-converter)
[![Node](https://img.shields.io/badge/node-%3E%3D14.0.0-brightgreen.svg)](https://nodejs.org)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)

**Advanced converter for Bruno/Postman collections to LoadRunner Enterprise DevWeb scripts with intelligent correlation, parameterization, and authentication support.**

---

## ✨ Features

### 🎯 Core Features
- ✅ **Multi-Format Support**: Bruno (.bru, .json) and Postman (.json) collections
- ✅ **Smart Transactions**: Automatic grouping by folders
- ✅ **Auto-Correlation**: Intelligent detection of dynamic values
- ✅ **Parameterization**: Automatic extraction and management
- ✅ **Authentication**: OAuth 2.0, Basic, Bearer, API Key, AWS Signature v4
- ✅ **Think Time**: Configurable delays between requests
- ✅ **Error Handling**: Comprehensive try-catch with transaction status

### 🔧 Advanced Features
- 🔍 **Correlation Detection**: Automatically identifies tokens, IDs, session values
- 📊 **Parameter Analysis**: Type detection (email, URL, UUID, etc.)
- 🔐 **Auth Handlers**: Support for all major authentication methods
- 📝 **Code Comments**: Detailed inline documentation
- 📈 **Analysis Reports**: Comprehensive conversion statistics
- 🌐 **Web UI**: User-friendly interface for non-technical users
- 🔄 **GitLab CI/CD**: Ready-to-use pipeline configuration

---

## 📦 Installation

### Prerequisites
- Node.js >= 14.0.0
- npm >= 6.0.0

### 🚀 Quick Install (Automated)

#### **Windows Users**

**Option 1: PowerShell (Recommended for Windows 10/11)**
```powershell
cd bruno-devweb-converter
.\install.ps1
```

**Option 2: Batch Script (All Windows versions)**
```cmd
cd bruno-devweb-converter
install.bat
```

#### **Linux / macOS Users**

```bash
cd bruno-devweb-converter
chmod +x install.sh
./install.sh
```

> 📖 **Detailed Instructions**: See [INSTALLATION.md](INSTALLATION.md) for complete installation guide

### 📋 Manual Installation

```bash
# Clone the repository
git clone https://gitlab.com/your-org/bruno-devweb-converter.git
cd bruno-devweb-converter

# Install dependencies
npm install

# Make CLI globally available
npm link
```

### 🐳 Docker Installation

```bash
docker build -t bruno-devweb-converter .
docker run -v $(pwd)/collections:/app/collections bruno-devweb-converter
```

### 📚 Installation Resources

- **[INSTALLATION.md](INSTALLATION.md)** - Complete installation guide with troubleshooting
- **[INSTALL_COMPARISON.md](INSTALL_COMPARISON.md)** - Compare installation methods

---

## 🚀 Quick Start

### Command Line Interface

```bash
# Convert a collection
bruno-devweb convert -i collections/my-api.json -o output/my-script

# With custom options
bruno-devweb convert \
  -i collections/my-api.json \
  -o output/my-script \
  --think-time 2 \
  --no-correlation \
  --log-level debug

# Analyze without converting
bruno-devweb analyze -i collections/my-api.json

# Start web UI
bruno-devweb web --port 3000
```

### Programmatic Usage

```javascript
const BrunoDevWebConverter = require('bruno-devweb-converter');

const converter = new BrunoDevWebConverter({
  inputFile: './collections/my-api.json',
  outputDir: './devweb-script',
  useTransactions: true,
  useCorrelation: true,
  useParameterization: true,
  useAuthentication: true,
  thinkTime: 1
});

const results = await converter.convert();
console.log('Conversion complete!', results);
```

### Web UI

```bash
# Start the web server
npm run web

# Or with custom port
bruno-devweb web --port 8080
```

Then open `http://localhost:3000` in your browser.

---

## 📖 Usage Guide

### CLI Commands

#### `convert` - Convert collection to DevWeb script

```bash
bruno-devweb convert [options]

Options:
  -i, --input <file>           Input collection file (.json or .bru)
  -o, --output <dir>           Output directory (default: ./devweb-script)
  --no-transactions            Disable transaction grouping
  --no-correlation             Disable auto-correlation
  --no-parameterization        Disable parameterization
  --no-authentication          Disable authentication handling
  -t, --think-time <seconds>   Think time between requests (default: 1)
  --no-comments                Disable code comments
  --log-level <level>          Log level: error|warning|info|debug (default: info)
  --fail-on-error              Stop execution on first error
  -h, --help                   Display help
```

#### `analyze` - Analyze collection without converting

```bash
bruno-devweb analyze -i collections/my-api.json
```

Output:
```
📊 Collection Analysis

Collection Info:
  Name: My API Collection
  Type: postman
  Requests: 15

Correlations:
  Total: 3
  1. authToken (token): Login → GetProfile
  2. userId (id): Login → UpdateUser
  3. sessionId (sessionId): CreateSession → ValidateSession

Parameters:
  Total: 8
  email: 2
  string: 4
  number: 1
  url: 1

Authentication:
  Total: 1
  BEARER: 1
```

#### `web` - Start web UI server

```bash
bruno-devweb web [options]

Options:
  -p, --port <port>   Server port (default: 3000)
```

### Advanced Options

#### Transaction Grouping

By default, requests are grouped into transactions by folder:

```
Collection
├── Authentication
│   ├── Login          → Transaction: "Authentication"
│   └── Logout
├── Users
│   ├── GetUser        → Transaction: "Users"
│   ├── UpdateUser
│   └── DeleteUser
```

Disable with `--no-transactions` for sequential execution.

#### Correlation

Automatically detects:
- Authentication tokens
- Session IDs
- CSRF tokens
- User/Order/Transaction IDs
- Timestamps and nonces

Extractors are generated for:
- JSON responses (`JsonPathExtractor`)
- Headers (`BoundaryExtractor`)
- HTML content (`HtmlExtractor`)

#### Parameterization

Automatically extracts:
- Collection variables
- Environment variables
- Request variables
- Dynamic values in URLs, headers, body

Supports types:
- `string`, `number`, `boolean`
- `email`, `url`, `uuid`
- `date`, `timestamp`

---

## 🔐 Authentication Support

### OAuth 2.0

**Client Credentials Flow:**
```json
{
  "type": "oauth2",
  "oauth2": [
    { "key": "grant_type", "value": "client_credentials" },
    { "key": "accessTokenUrl", "value": "https://api.example.com/oauth/token" },
    { "key": "clientId", "value": "{{CLIENT_ID}}" },
    { "key": "clientSecret", "value": "{{CLIENT_SECRET}}" }
  ]
}
```

**Password Flow:**
```json
{
  "type": "oauth2",
  "oauth2": [
    { "key": "grant_type", "value": "password" },
    { "key": "username", "value": "{{USERNAME}}" },
    { "key": "password", "value": "{{PASSWORD}}" }
  ]
}
```

### Basic Authentication

```json
{
  "type": "basic",
  "basic": [
    { "key": "username", "value": "admin" },
    { "key": "password", "value": "secret" }
  ]
}
```

### Bearer Token

```json
{
  "type": "bearer",
  "bearer": [
    { "key": "token", "value": "{{ACCESS_TOKEN}}" }
  ]
}
```

### API Key

**In Header:**
```json
{
  "type": "apikey",
  "apikey": [
    { "key": "key", "value": "X-API-Key" },
    { "key": "value", "value": "{{API_KEY}}" },
    { "key": "in", "value": "header" }
  ]
}
```

**In Query:**
```json
{
  "type": "apikey",
  "apikey": [
    { "key": "key", "value": "api_key" },
    { "key": "value", "value": "{{API_KEY}}" },
    { "key": "in", "value": "query" }
  ]
}
```

### AWS Signature v4

```json
{
  "type": "awsv4",
  "awsv4": [
    { "key": "accessKey", "value": "{{AWS_ACCESS_KEY}}" },
    { "key": "secretKey", "value": "{{AWS_SECRET_KEY}}" },
    { "key": "region", "value": "us-east-1" },
    { "key": "service", "value": "s3" }
  ]
}
```

---

## 🏗️ Output Structure

```
devweb-script/
├── main.js              # DevWeb script (JavaScript)
├── config.yml           # Runtime configuration
├── parameters.yml       # Parameter definitions
├── package.json         # Node.js package definition
├── README.md            # Script documentation
├── ANALYSIS.md          # Detailed analysis report
└── data/                # Parameter data files
    ├── username.csv
    ├── email.csv
    └── userId.csv
```

### Generated DevWeb Script Structure

```javascript
/**
 * DevWeb Performance Test Script
 * Auto-generated from collection
 */

// Initialize section
load.initialize("init", async function() {
    // Setup global variables
    // Configure authentication
});

// Action section  
load.action("Action", async function() {
    // Transaction 1
    const Transaction1 = new load.Transaction("Transaction1");
    Transaction1.start();
    
    // Requests with correlation
    const request1 = new load.WebRequest({...});
    const response1 = request1.sendSync();
    load.global.token = response1.extractors.token;
    
    Transaction1.stop(load.TransactionStatus.Passed);
    
    // Think time
    load.sleep(1);
});

// Finalize section
load.finalize("finalize", async function() {
    // Cleanup
});
```

---

## 🔄 GitLab CI/CD Integration

### Setup

1. **Add Collections to Repository:**
   ```bash
   mkdir collections
   cp your-collection.json collections/
   git add collections/
   git commit -m "Add API collection"
   git push
   ```

2. **Configure CI/CD Variables:**
   - `LRE_URL`: LoadRunner Enterprise URL
   - `LRE_API_KEY`: API key for authentication
   - `THINK_TIME`: Default think time (optional)
   - `LOG_LEVEL`: Logging level (optional)

3. **Pipeline Stages:**
   ```
   validate → convert → test → package → deploy
   ```

### Pipeline Configuration

The `.gitlab-ci.yml` includes:
- ✅ Collection validation
- ✅ Automatic conversion
- ✅ Script validation
- ✅ Packaging as ZIP
- ✅ Manual deployment to LRE
- ✅ Documentation generation

### Triggering Conversion

```bash
# Manual trigger
git push origin main

# Or trigger via GitLab UI
# CI/CD > Pipelines > Run Pipeline
```

---

## 📊 Example Output

### Input: Postman Collection

```json
{
  "info": { "name": "E-commerce API" },
  "item": [
    {
      "name": "Authentication",
      "item": [
        {
          "name": "Login",
          "request": {
            "method": "POST",
            "url": "https://api.shop.com/auth/login",
            "body": {
              "mode": "raw",
              "raw": "{\"email\":\"user@example.com\",\"password\":\"secret\"}"
            }
          }
        }
      ]
    }
  ]
}
```

### Output: DevWeb Script

```javascript
load.action("Action", async function() {
    // Transaction: Authentication
    const Authentication_transaction = new load.Transaction("Authentication");
    Authentication_transaction.start();
    
    try {
        // Login
        const Login_request = new load.WebRequest({
          url: "https://api.shop.com/auth/login",
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          returnBody: true,
          body: {
            email: load.params.email,
            password: load.params.password
          },
          extractors: [
            new load.JsonPathExtractor("authToken", "$.token"),
            new load.JsonPathExtractor("userId", "$.user.id")
          ]
        });
        const Login_response = Login_request.sendSync();
        
        load.log(`Login - Status: ${Login_response.status}`, load.LogLevel.info);
        
        load.global.authToken = Login_response.extractors.authToken;
        load.global.userId = Login_response.extractors.userId;
        
        Authentication_transaction.stop(load.TransactionStatus.Passed);
    } catch (error) {
        load.log(`Transaction Authentication failed: ${error.message}`, load.LogLevel.error);
        Authentication_transaction.stop(load.TransactionStatus.Failed);
    }
});
```

---

## 🧪 Testing

```bash
# Run unit tests
npm test

# Run linting
npm run lint

# Test conversion locally
node src/cli.js convert -i test/fixtures/sample.json -o test/output
```

---

## 🤝 Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Merge Request

---

## 📝 License

This project is licensed under the MIT License - see [LICENSE](LICENSE) file for details.

---

## 🆘 Support

- **Issues**: [GitLab Issues](https://gitlab.com/your-org/bruno-devweb-converter/issues)
- **Documentation**: [Wiki](https://gitlab.com/your-org/bruno-devweb-converter/wiki)
- **Email**: support@yourorg.com

---

## 🙏 Acknowledgments

- Bruno API Client Team
- Postman Team
- OpenText LoadRunner Enterprise Team
- All contributors and users

---

## 📚 Additional Resources

- [DevWeb JavaScript SDK Documentation](https://admhelp.microfocus.com/lrd/en/26.1/help/Content/DevWeb/DW-JS-SDK.htm)
- [LoadRunner Enterprise Documentation](https://admhelp.microfocus.com/lre/)
- [Bruno Documentation](https://docs.usebruno.com/)
- [Postman Documentation](https://learning.postman.com/)

---

**Made with ❤️ for Performance Engineers**

*Version 2.0.0 - Last Updated: February 2026*
