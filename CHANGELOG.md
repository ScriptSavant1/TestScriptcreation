# Changelog

All notable changes to the Bruno to DevWeb Converter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
