# 🎯 Project Summary

## Bruno to DevWeb Converter v2.3.1

**Complete, production-ready framework for converting Bruno/Postman collections to LoadRunner Enterprise performance test scripts — supports both DevWeb (JavaScript) and VuGen Web HTTP/HTML (C) output protocols, with 3-tier variable classification, multi-script mode, intelligent correlation, and authentication support.**

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

3. **Script Generators** (`src/generators/`)
   - AdvancedScriptGenerator: DevWeb JavaScript script generation
   - WebHttpScriptGenerator: VuGen Web HTTP/HTML C script generation
   - MandatoryFilesGenerator: DevWeb support files (scenario.yml, parameters.yml, etc.)
   - WebHttpMandatoryFilesGenerator: VuGen config files (*.usr, default.cfg, ParameterFile.prm, etc.)

4. **User Interfaces**
   - CLI (`src/cli.js`): Command-line interface
   - Web UI (`src/web/`): Browser-based interface

5. **Integration & Packaging**
   - Docker image (`Dockerfile`): Pre-built Linux image published to GitLab Container Registry
   - GitLab CI/CD (`.gitlab-ci.yml`): Auto-builds and pushes Docker image on version tags

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
├── 🐳 Dockerfile                   # Docker image definition
├── 🐳 .dockerignore                # Docker build exclusions
├── 🔧 .gitlab-ci.yml               # GitLab CI/CD — builds and pushes Docker image
├── 🔧 install.sh                   # Quick installation script (local use)
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
│   │   ├── advancedScriptGenerator.js      # DevWeb (JS) script generator
│   │   ├── webHttpScriptGenerator.js       # VuGen Web HTTP/HTML (C) generator
│   │   ├── mandatoryFilesGenerator.js      # DevWeb support files
│   │   └── webHttpMandatoryFilesGenerator.js # VuGen config files
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

### 5. Dual Output Protocol
```
--protocol devweb    → DevWeb JavaScript script (main.js, scenario.yml, ...)
--protocol web-http  → VuGen Web HTTP/HTML C script (Action.c, *.usr, ...)
```
Both protocols share the same parsers and analysis engines. Same input → same correlation/parameterization logic → different output language.

---

## 🚀 Quick Start

### Installation
```bash
./install.sh
```

### Convert a Collection

**DevWeb (JavaScript) — default:**
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

**VuGen Web HTTP/HTML (C) — add `--protocol web-http`:**
```bash
node src/cli.js convert -i collection.json --protocol web-http -o ./output
node src/cli.js convert -i collection.json --protocol web-http -m multi -o ./scripts
node src/cli.js convert -i MyCollection.yml --protocol web-http -e environment.json -o ./output
```

After global install (`npm link` or `npm install -g`):
```bash
bruno-devweb convert -i collection.json -o output/
bruno-devweb convert -i "MyCollection/" -m multi -o scripts/
bruno-devweb convert -i collection.json --protocol web-http -o output/
bruno-devweb convert -i "MyCollection/" --protocol web-http -m multi -o scripts/
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

### DevWeb Output (Single Mode) — default
```
my-script/
├── main.js              # DevWeb script (JavaScript)
├── scenario.yml         # Scenario config (vusers, pacing, duration)
├── rts.yml              # Runtime settings
├── tsconfig.json        # TypeScript config
├── DevWebSdk.d.ts       # Type definitions
├── parameters.yml       # Parameter definitions (when variables exist)
├── collection_data.csv  # Actual parameter values
└── data/                # Large base64 data files (if any)
    └── Upload_Document_content.b64
```

### VuGen Web HTTP/HTML Output (Single Mode) — `--protocol web-http`
```
my-vugen-script/
├── Action.c             # Main test logic (C)
├── vuser_init.c         # Init lifecycle (C)
├── vuser_end.c          # End lifecycle (C)
├── globals.h            # Standard #include block
├── MyScript.usr         # VuGen metadata (INI) — open this in VuGen
├── default.cfg          # Runtime settings (INI)
├── default.usp          # Run logic profile (INI)
├── ParameterFile.prm    # Parameter definitions (VuGen INI format)
├── collection_data.dat  # Parameter values (CSV)
└── ScriptUploadMetadata.xml  # LRE upload manifest
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

## 🐳 Docker & GitLab CI/CD

### Using the Pre-Built Docker Image

The converter is packaged as a Docker image. Teams include it in their pipelines — no installation needed.

**Linux runner:**
```yaml
convert:
  image: registry.gitlab.com/your-org/bruno-devweb-converter:latest
  tags: [linux]
  script:
    - bruno-devweb convert -i my-collection.json -o output/
  artifacts:
    paths: [output/]
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
```

### Publishing a New Release
```bash
git tag v2.3.0
git push origin v2.3.0
# CI auto-builds :2.3.0 and :latest
```

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
- **Total Files**: 25+
- **Lines of Code**: 6,000+
- **Documentation**: 3,500+ lines
- **Test Coverage**: Coming soon

### Supported Features
- ✅ Collection formats: 5 (Postman JSON, Bruno JSON, Bruno Single YAML, Bruno YAML Folder, Single .bru)
- ✅ Output protocols: 2 (DevWeb JavaScript, VuGen Web HTTP/HTML C)
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

# 2. Convert — DevWeb (JavaScript)
bruno-devweb convert -i examples/sample-ecommerce-api.json -o test-script

# 3. Run DevWeb script
cd test-script
devweb run main.js

# --- OR ---

# 2. Convert — VuGen Web HTTP/HTML (C)
bruno-devweb convert -i examples/sample-ecommerce-api.json --protocol web-http -o test-vugen

# 3. Open in VuGen
# Open test-vugen/sample-ecommerce-api.usr in VuGen
```

**That's it! You're ready to create performance tests from API collections!** 🚀

---

*Made with ❤️ for Performance Engineers*

*Version 2.3.1 - February 2026*
