# 🎯 Project Summary

## Bruno to DevWeb Converter v2.2

**Complete, production-ready framework for converting Bruno/Postman collections to LoadRunner Enterprise DevWeb scripts with 3-tier variable classification, multi-script mode, intelligent correlation, and authentication support.**

---

## 📦 What's Included

This package contains everything you need to convert API collections to DevWeb performance test scripts.

### Core Components

1. **Collection Parsers** (`src/parsers/`)
   - BrunoParser: Handles `.bru`, Bruno JSON, Bruno Single YAML (`.yml`), Bruno YAML Folder (directory)
   - PostmanParser: Handles Postman Collection v2.1 JSON
   - ParserFactory: Auto-detects format from file extension and content

2. **Analysis Engine** (`src/analyzers/`)
   - CorrelationDetector: Automatic correlation detection
   - ParameterizationEngine: Smart parameter extraction
   - AuthenticationHandler: Multi-auth support

3. **Script Generator** (`src/generators/`)
   - AdvancedScriptGenerator: Complete DevWeb script generation

4. **User Interfaces**
   - CLI (`src/cli.js`): Command-line interface
   - Web UI (`src/web/`): Browser-based interface

5. **Integration**
   - GitLab CI/CD (`.gitlab-ci.yml`): Complete pipeline
   - Docker support (coming soon)

### Documentation

- **README.md**: Overview, features, quick start
- **USER_GUIDE.md**: Complete usage guide with examples
- **TECHNICAL.md**: Architecture and implementation details
- **CHANGELOG.md**: Version history and upgrade guide
- **LICENSE**: MIT License

### Examples

- **examples/sample-ecommerce-api.json**: Example collection
- Generated output examples in documentation

---

## 🗂️ Project Structure

```
bruno-devweb-converter/
├── 📄 README.md                    # Main documentation
├── 📄 USER_GUIDE.md                # Complete user guide
├── 📄 TECHNICAL.md                 # Technical documentation
├── 📄 CHANGELOG.md                 # Version history
├── 📄 LICENSE                      # MIT License
├── 📄 package.json                 # Node.js package definition
├── 🔧 .gitlab-ci.yml               # GitLab CI/CD pipeline
├── 🔧 install.sh                   # Quick installation script
│
├── 📁 src/                         # Source code
│   ├── 📄 index.js                 # Main converter class
│   ├── 📄 cli.js                   # Command-line interface
│   │
│   ├── 📁 parsers/                 # Collection parsers
│   │   ├── brunoParser.js          # Bruno collection parser
│   │   └── postmanParser.js        # Postman collection parser
│   │
│   ├── 📁 analyzers/               # Analysis engines
│   │   ├── correlationDetector.js  # Correlation detection
│   │   ├── parameterizationEngine.js # Parameter extraction
│   │   └── authenticationHandler.js  # Auth configuration
│   │
│   ├── 📁 generators/              # Code generators
│   │   └── advancedScriptGenerator.js # DevWeb script generator
│   │
│   └── 📁 web/                     # Web UI
│       ├── server.js               # Express server
│       └── views/
│           └── index.ejs           # Web UI template
│
├── 📁 examples/                    # Example collections
│   └── sample-ecommerce-api.json   # Sample collection
│
├── 📁 uploads/                     # Web UI uploads (auto-created)
├── 📁 output/                      # Generated scripts (auto-created)
└── 📁 node_modules/                # Dependencies (after npm install)
```

---

## ✨ Key Features

### 1. Automatic Correlation Detection
```javascript
// Detects:
- Authentication tokens  → JsonPathExtractor("authToken", "$.token")
- Session IDs           → JsonPathExtractor("sessionId", "$.sessionId")  
- CSRF tokens           → BoundaryExtractor("csrf", '<input name="csrf" value="', '">')
- User/Order/Entity IDs → JsonPathExtractor("userId", "$.user.id")
```

### 2. 3-Tier Variable Classification
```yaml
# parameters.yml - auto-generated with correct nextValue:
parameters:
  - name: baseUrl
    type: csv
    fileName: collection_data.csv
    columnName: baseUrl
    nextValue: once        # Config: same for all iterations
  - name: username
    type: csv
    fileName: collection_data.csv
    columnName: username
    nextValue: iteration   # Test data: different per vuser
```

### 3. Multi-Auth Support
- ✅ OAuth 2.0 (Client Credentials, Password, Authorization Code)
- ✅ Basic Authentication
- ✅ Bearer Token
- ✅ API Key (Header/Query)
- ✅ AWS Signature v4
- ✅ Digest Authentication

### 4. Transaction Management
```javascript
// Automatic grouping by folder:
Collection
├── Auth → Transaction("Auth")
├── Users → Transaction("Users")
└── Orders → Transaction("Orders")
```

---

## 🚀 Quick Start

### Installation
```bash
./install.sh
```

### Convert a Collection
```bash
# Postman JSON (single or multi mode)
node src/cli.js convert -i collection.json -o ./output
node src/cli.js convert -i collection.json -m multi -o ./scripts

# Bruno Single YAML file
node src/cli.js convert -i MyCollection.yml -o ./output
node src/cli.js convert -i MyCollection.yml -m multi -o ./scripts

# Bruno YAML folder (distributed format)
node src/cli.js convert -i "MyCollection/" -o ./output
node src/cli.js convert -i "MyCollection/" -m multi -o ./scripts

# Bruno JSON export
node src/cli.js convert -i BrunoCollection.json -o ./output

# Single .bru file
node src/cli.js convert -i Login.bru -o ./output

# With environment file (overrides collection variable values)
node src/cli.js convert -i MyCollection.yml -e environment.json -o ./output
```

After global install (`npm link` or `npm install -g`):
```bash
bruno-devweb convert -i collection.json -o output/
bruno-devweb convert -i "MyCollection/" -m multi -o scripts/
```

### Start Web UI
```bash
bruno-devweb web --port 3000
```

### Analyze Collection
```bash
bruno-devweb analyze -i collection.json
```

---

## 📊 Generated Output

### File Structure (Single Mode)
```
my-script/
├── main.js              # DevWeb script
├── scenario.yml         # Scenario config (vusers, pacing, duration)
├── rts.yml              # Runtime settings
├── tsconfig.json        # TypeScript config
├── DevWebSdk.d.ts       # Type definitions
├── parameters.yml       # Parameter definitions (when variables exist)
├── collection_data.csv  # Actual parameter values
└── data/                # Large base64 data files (if any)
    └── Upload_Document_content.b64
```

### DevWeb Script Structure
```javascript
load.initialize("Initialize", async function () {
    load.global.token = null;  // Dynamic variables initialized as null
});

load.action("Action", async function () {
    // Transaction declarations INSIDE action, at the top
    let TS01 = new load.Transaction("Authentication");

    TS01.start();
    const webResponse_01 = new load.WebRequest({
        id: 1,
        url: `${load.params.baseUrl}/login`,      // Tier 2 config
        method: "POST",
        body: {
            "username": load.params.username,       // Tier 3 test data
            "password": load.params.password
        },
        returnBody: true,
        extractors: [
            new load.JsonPathExtractor("token", "$.access_token")
        ]
    }).sendSync();

    load.global.token = webResponse_01.extractors.token;  // Tier 1 dynamic
    TS01.stop(load.TransactionStatus.Passed);
});

load.finalize("Finalize", async function () {
    load.log("Done", load.LogLevel.info);
});
```

---

## 🔄 GitLab CI/CD Integration

### Pipeline Stages
1. **Validate** - Check collection syntax
2. **Convert** - Generate DevWeb scripts
3. **Test** - Validate generated scripts
4. **Package** - Create ZIP archives
5. **Deploy** - Upload to LRE (manual)

### Setup
```bash
# Add to GitLab repository
cp .gitlab-ci.yml /path/to/your/repo/
git add .gitlab-ci.yml
git commit -m "Add DevWeb conversion pipeline"
git push
```

### CI/CD Variables
- `LRE_URL`: LoadRunner Enterprise URL
- `LRE_API_KEY`: API authentication key
- `THINK_TIME`: Default think time (optional)
- `LOG_LEVEL`: Logging level (optional)

---

## 🎯 Use Cases

### 1. API Performance Testing
Convert API collections to load test scripts for performance validation.

### 2. Regression Testing
Automate performance test creation from functional API tests.

### 3. CI/CD Integration
Generate and deploy performance tests automatically on code changes.

### 4. Test Migration
Migrate existing Postman/Bruno tests to LoadRunner Enterprise.

### 5. Team Collaboration
Enable developers to create performance tests without DevWeb expertise.

---

## 📈 Statistics

### Code Metrics
- **Total Files**: 20+
- **Lines of Code**: 5,000+
- **Documentation**: 3,000+ lines
- **Test Coverage**: Coming soon

### Supported Features
- ✅ Collection formats: 5 (Postman JSON, Bruno JSON, Bruno Single YAML, Bruno YAML Folder, Single .bru)
- ✅ Auth types: 7 (OAuth2 client_credentials/auth_code/password, Basic, Bearer, API Key, AWS v4, Digest, NTLM)
- ✅ Extractor types: 4 (JsonPath, Boundary, Regexp, TextCheck)
- ✅ Variable tiers: 3 (Dynamic load.global, Config load.params once, Test Data load.params iteration)
- ✅ Parameter types: 7 (string, number, email, url, uuid, date, boolean)

---

## 🛣️ Roadmap

### Version 2.1 (Q2 2026)
- [ ] GraphQL support
- [ ] WebSocket conversion
- [ ] Enhanced data-driven testing
- [ ] Performance optimization suggestions

### Version 3.0 (Q3 2026)
- [ ] gRPC support
- [ ] AI-powered test data generation
- [ ] Real-time collaboration
- [ ] Plugin system

### Future
- [ ] Desktop application (Electron)
- [ ] VS Code extension
- [ ] Cloud deployment
- [ ] Advanced reporting

---

## 🤝 Contributing

Contributions welcome! Please see the contribution guidelines in the repository.

### Areas for Contribution
- New authentication types
- Additional correlation patterns
- Performance optimizations
- Documentation improvements
- Bug fixes
- Feature requests

---

## 📞 Support

### Community Support
- **Issues**: https://gitlab.com/your-org/bruno-devweb-converter/issues
- **Discussions**: https://gitlab.com/your-org/bruno-devweb-converter/discussions
- **Wiki**: https://gitlab.com/your-org/bruno-devweb-converter/wiki

### Professional Support
- **Email**: support@yourorg.com
- **Slack**: #bruno-devweb-converter
- **Training**: Available on request

---

## 🏆 Credits

### Built With
- **Node.js** - Runtime
- **Express** - Web framework
- **Commander** - CLI framework
- **Chalk** - Terminal colors
- **js-yaml** - YAML processing
- **EJS** - Template engine

### Thanks To
- Bruno API Client team
- Postman team
- OpenText LoadRunner Enterprise team
- All contributors and users

---

## 📝 License

MIT License - see LICENSE file for details

Copyright (c) 2026 Your Organization

---

## 🎉 Getting Started

Ready to convert your first collection?

```bash
# 1. Install
./install.sh

# 2. Convert
bruno-devweb convert -i examples/sample-ecommerce-api.json -o test-script

# 3. Run
cd test-script
devweb run main.js
```

**That's it! You're ready to create performance tests from API collections!** 🚀

---

*Made with ❤️ for Performance Engineers*

*Version 2.2.0 - February 2026*
