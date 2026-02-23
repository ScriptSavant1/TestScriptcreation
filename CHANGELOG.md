# Changelog

All notable changes to the Bruno to DevWeb Converter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [2.1.1] - 2026-02-23

### Fixed
- **`load.thinkTime()` → `load.sleep()`**: The transaction-grouped code path in `advancedScriptGenerator.js` incorrectly emitted `load.thinkTime()` which does not exist as a standalone DevWeb function. Changed to `load.sleep()`. The sequential code path already used `load.sleep()` — both paths are now consistent.
- **Fallback `DevWebSdk.d.ts`**: Removed `export function thinkTime(...)` declaration; replaced with correct `export function sleepAsync(seconds: number): Promise<void>`.

### Added
- **Docker packaging** (`Dockerfile`): Multi-stage Alpine build. Stage 1 installs production deps via `npm ci --omit=dev`. Stage 2 copies only `src/` and uses a direct symlink for the CLI binary. Excludes all examples, prompts, and documentation — image is minimal.
- **`.dockerignore`**: Excludes `devweb-prompts/`, `examples/`, `devweb-examples-code/`, `output/`, `node_modules/`, all markdown and install files from the Docker build context.
- **Rewritten `.gitlab-ci.yml`**: Builds and publishes the Docker image to GitLab Container Registry. Two jobs: `build-release` (triggers on `v*.*.*` tags → publishes `:VERSION` + `:latest`) and `build-snapshot` (triggers on `main`/`Dev` branch → publishes `:snapshot`). Both jobs tagged `linux` to run on Linux runners only.
- **Cross-platform consumer pipeline examples** documented in `.gitlab-ci.yml` comments: Linux runner (Docker image, zero setup) and Windows runner (shell executor + `npm ci`) patterns.

## [2.2.1] - 2026-02-18

### Added
- **Bruno YAML folder-based format support**: Full parsing of distributed Bruno collection directories (contains `opencollection.yml`, `folder.yml`, request `*.yml` files, and `.bru` files mixed)
- **Bruno collection-level headers extraction**: `request.headers[]` from the Bruno YAML root section are merged into `load.WebRequest.defaults.headers` for all requests
- **Bruno before-request script header extraction**: `req.getHeaders().add({ key, value })` patterns in root-level `request.scripts[type=before-request]` are auto-detected and merged into defaults headers
- **Bruno collection-level auth support**: `request.auth` (OAuth2, bearer, basic, apikey) from the YAML root generates a commented-out token-fetch block in `load.initialize()` — ready to uncomment and enable
- **`generateCollectionAuthBlock()` method**: New method in `advancedScriptGenerator.js` that emits properly-resolved OAuth2 token fetch code with variable expressions already in `load.params`/`load.global` form
- **Complete prompt file coverage**: All 10 devweb-prompts files (00–09) and USAGE-GUIDE.txt are now fully up to date with all format support, correct rts.yml (all 10 sections), and Bruno YAML collection-level feature documentation

### Fixed
- **Truncated `rts.yml`**: Prompt file `06-MANDATORY-FILES.txt` now includes the COMPLETE rts.yml with all 10 sections: `httpConnection`, `grpc`, `proxy` (9 properties including proxyDomain, proxyUser, proxyPassword, proxyAuthenticationType, excludedHosts), `ssl`, `replay` (8 properties including enableDynatrace, resourceHttpErrorAsWarning, enableIntegratedAuthentication, multiIP), `vts` (7 properties), `encryption`, `vuserLogger`, `flow`, `thinkTime`

### Changed
- `parseBrunoYamlCollection()` in `brunoParser.js`: Now extracts `collectionHeaders` and `collectionAuth` from the root `request:` section and stores them on the collection object
- `generateAction()` in `advancedScriptGenerator.js`: Merges collection-level headers (browser baseline + collection headers) into the `defaults.headers` block

## [2.2.0] - 2026-02-17

### Added
- **Multi-script generation mode** (`-m multi`): Split large collections by top-level folder into separate self-contained DevWeb scripts for independent LRE scenario design
- **Large base64 extraction**: Automatically detect base64 values >500 chars in request bodies, extract to external `data/*.b64` files with deduplication via MD5 hash
- **3-tier variable classification system**: All `{{variables}}` classified as Dynamic (`load.global`), Parameterized Config (`load.params`, nextValue: once), or Parameterized Test Data (`load.params`, nextValue: iteration)
- **collection_data.csv generation**: Actual parameter values from collection/environment exported to CSV alongside parameters.yml
- **Environment file override** (`-e environment.json`): Environment values override collection variable values in generated CSV
- **Cross-folder dependency detection**: Multi-mode warns when variables produced in one folder are consumed in another (e.g., auth tokens)
- **Sequential response variable naming**: `webResponse_01`, `webResponse_02` pattern instead of long descriptive names

### Changed
- **scenario.yml format**: Now uses proper DevWeb pacing structure (type/mode/min/max, rampUp, duration, tearDown) instead of simple name/description
- **Transaction declarations**: Now correctly placed INSIDE the action function at the top, before any request code
- **URL handling**: Uses template literals with `load.params`/`load.global` instead of string concatenation; manual URL splitting to avoid `new URL()` encoding `{{` to `%7B%7B`
- **parameters.yml**: Always generated when variables exist; uses `collection_data.csv` as single file for all parameters
- **Variable naming safety**: Strip leading digits from variable/file names to avoid JS identifier errors (e.g., `5_Upload_Document` → `Upload_Document`)

### Fixed
- `load.global.*` markers no longer trigger false "variable not found" warnings in `replaceParametersInObject()`
- Request ID counter now correctly incremented before response variable assignment
- Duplicate cross-folder dependency warnings eliminated via Set-based deduplication

### Documentation
- Complete rewrite of all devweb-prompts files (01 through 09) to match current code logic
- Updated CHANGELOG.md, INSTALLATION.md with new CLI options and features

## [2.0.0] - 2026-02-08

### Added
- 🚀 **Complete rewrite** with advanced features
- 🔍 **Automatic Correlation Detection**: Intelligent detection of tokens, IDs, and dynamic values
- 📊 **Advanced Parameterization**: Type detection, data file generation, smart extraction
- 🔐 **Full Authentication Support**: OAuth 2.0, Basic, Bearer, API Key, AWS Signature v4
- 🌐 **Web UI**: User-friendly interface for non-technical users
- 🔄 **GitLab CI/CD Integration**: Ready-to-use pipeline configuration
- 📝 **Code Comments**: Detailed inline documentation in generated scripts
- 📈 **Analysis Reports**: Comprehensive conversion statistics and recommendations
- 🎯 **Transaction Support**: Automatic grouping by folder structure
- 💡 **Think Time**: Configurable delays between requests
- 🛡️ **Error Handling**: Comprehensive try-catch with transaction status
- 📖 **Documentation**: Complete user guide, technical docs, and examples

### Changed
- Improved DevWeb code generation with better formatting
- Enhanced request normalization for both Bruno and Postman formats
- Optimized correlation detection algorithm
- Better parameter type inference

### Features in Detail

#### Correlation Detection
- Automatic detection of:
  - Authentication tokens (Bearer, JWT, OAuth)
  - Session IDs and tracking tokens
  - CSRF tokens
  - Entity IDs (User, Order, Product, etc.)
  - Timestamps and nonces
- Smart extractor generation:
  - JsonPathExtractor for JSON responses
  - BoundaryExtractor for HTML/text
  - RegexpExtractor for complex patterns
  - HtmlExtractor for HTML documents
  - CookieExtractor for cookies

#### Parameterization Engine
- Automatic parameter extraction from:
  - Collection variables
  - Environment variables
  - Request URLs, headers, bodies
  - Dynamic values
- Type detection:
  - email, url, uuid
  - number, boolean, string
  - date, timestamp
- Data file generation:
  - CSV format
  - Sample data based on type
  - Configurable selection strategies

#### Authentication
- OAuth 2.0 support:
  - Client Credentials flow
  - Password flow
  - Authorization Code flow
  - Token refresh handling
- Basic Authentication with base64 encoding
- Bearer Token with automatic injection
- API Key in headers or query parameters
- AWS Signature v4 for AWS services
- Digest Authentication
- Automatic header injection in requests

#### Web UI
- Drag-and-drop file upload
- Real-time conversion progress
- Analysis preview before conversion
- Configurable options
- One-click download of generated scripts
- Mobile-responsive design

#### GitLab CI/CD
- Multi-stage pipeline:
  - Validation
  - Conversion
  - Testing
  - Packaging
  - Deployment
- Automatic artifact generation
- Manual deployment gate
- Scheduled conversion jobs
- Integration with LoadRunner Enterprise

### Fixed
- Collection parsing issues with nested folders
- Authentication header injection
- Parameter replacement in complex objects
- Transaction boundary detection
- Special character handling in variable names

## [1.0.0] - 2025-12-01 (Legacy)

### Added
- Initial release
- Basic Bruno collection parsing
- Simple DevWeb script generation
- CLI interface
- Transaction grouping

### Known Issues
- Limited correlation detection
- No parameterization support
- Basic authentication only
- Manual correlation required

## [Unreleased]

### Planned Features
- [ ] GraphQL support
- [ ] WebSocket conversion
- [ ] gRPC support
- [ ] Advanced think time strategies
- [ ] Data-driven testing
- [ ] Integration with more CI/CD platforms
- [ ] Cloud deployment options
- [ ] Real-time collaboration
- [ ] Version control integration
- [ ] Performance optimization suggestions
- [ ] Test data generation AI
- [ ] Custom extractor templates
- [ ] Plugin system

### Under Consideration
- Desktop application (Electron)
- VS Code extension
- IntelliJ IDEA plugin
- Docker compose support
- Kubernetes deployment
- AWS Lambda deployment
- Azure Functions support

---

## Upgrade Guide

### From 1.x to 2.0

**Breaking Changes:**
- CLI command structure changed
- Output directory structure updated
- Configuration file format changed

**Migration Steps:**

1. Update CLI commands:
   ```bash
   # Old (v1.x)
   bruno-devweb convert collection.json output/

   # New (v2.0)
   bruno-devweb convert -i collection.json -o output/
   ```

2. Update config files:
   ```yaml
   # Old format
   script_name: "My Script"
   
   # New format
   general:
     scriptName: "My Script"
   ```

3. Review generated scripts:
   - New correlation extractors added
   - Authentication setup in initialize section
   - Transaction structure changed

**New Features You Can Use:**
- Enable correlation: `--use-correlation`
- Enable parameterization: `--use-parameterization`
- Use web UI: `bruno-devweb web`
- Analyze before converting: `bruno-devweb analyze -i collection.json`

---

## Support

For issues, questions, or feature requests:
- 📧 Email: support@yourorg.com
- 🐛 Issues: https://gitlab.com/your-org/bruno-devweb-converter/issues
- 📚 Docs: https://gitlab.com/your-org/bruno-devweb-converter/wiki

---

*[2.0.0]: https://gitlab.com/your-org/bruno-devweb-converter/tags/v2.0.0*
*[1.0.0]: https://gitlab.com/your-org/bruno-devweb-converter/tags/v1.0.0*
