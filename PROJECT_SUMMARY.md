# 🎯 Project Summary

## Bruno to DevWeb Converter v2.0

**Complete, production-ready framework for converting Bruno/Postman collections to LoadRunner Enterprise DevWeb scripts with advanced correlation, parameterization, and authentication support.**

---

## 📦 What's Included

This package contains everything you need to convert API collections to DevWeb performance test scripts.

### Core Components

1. **Collection Parsers** (`src/parsers/`)
   - BrunoParser: Handles .bru and JSON formats
   - PostmanParser: Handles Postman collections

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

### 2. Smart Parameterization
```yaml
# Automatically generates:
parameters:
  baseUrl:
    type: url
    value: https://api.example.com
  userEmail:
    type: email
    value: user@example.com
  apiKey:
    type: string
    value: YOUR_API_KEY
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
bruno-devweb convert -i collection.json -o my-script
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

### File Structure
```
my-script/
├── main.js          # DevWeb script
├── config.yml       # Configuration
├── parameters.yml   # Parameters
├── README.md        # Script documentation
├── ANALYSIS.md      # Analysis report
├── package.json     # Node.js package
└── data/            # Parameter data files
    ├── username.csv
    └── userId.csv
```

### DevWeb Script Structure
```javascript
// Initialize
load.initialize("init", async function() {
    // Setup global variables
    // Configure authentication
});

// Action with Transactions
load.action("Action", async function() {
    const T1 = new load.Transaction("Transaction1");
    T1.start();
    
    try {
        // Requests with correlation
        const request1 = new load.WebRequest({...});
        const response1 = request1.sendSync();
        load.global.token = response1.extractors.token;
        
        T1.stop(load.TransactionStatus.Passed);
    } catch (error) {
        T1.stop(load.TransactionStatus.Failed);
    }
});

// Finalize
load.finalize("finalize", async function() {
    // Cleanup
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
- ✅ Collection formats: 2 (Bruno, Postman)
- ✅ Auth types: 6 (OAuth2, Basic, Bearer, API Key, AWS, Digest)
- ✅ Extractor types: 5 (JSON, Boundary, Regex, HTML, Cookie)
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

*Version 2.0.0 - February 2026*
