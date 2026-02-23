# 📘 Technical Documentation

## Architecture Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Bruno/Postman Collection                  │
│                         (.json / .bru)                       │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                    Collection Parser                         │
│  ┌──────────────┐           ┌──────────────┐               │
│  │ Bruno Parser │           │Postman Parser│               │
│  └──────────────┘           └──────────────┘               │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                   Analysis Engine                            │
│  ┌──────────────┐  ┌─────────────┐  ┌──────────────┐      │
│  │ Correlation  │  │Parameteriza-│  │    Auth      │      │
│  │  Detector    │  │    tion      │  │   Handler    │      │
│  └──────────────┘  └─────────────┘  └──────────────┘      │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│               DevWeb Script Generator                        │
│  - Initialize Section                                        │
│  - Action Section (with Transactions)                        │
│  - Finalize Section                                          │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│                  Output Generation                           │
│  - main.js           (DevWeb script)                         │
│  - scenario.yml      (vusers, pacing, duration)              │
│  - rts.yml           (runtime settings)                      │
│  - tsconfig.json     (TypeScript config)                     │
│  - parameters.yml    (when variables exist)                  │
│  - collection_data.csv (actual parameter values)             │
│  - data/*.b64        (extracted large base64 values)         │
└─────────────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Collection Parsers

#### BrunoParser (`src/parsers/brunoParser.js`)

**Responsibility**: Parse Bruno collections (.bru and .json formats)

**Key Methods**:
- `parse()`: Main parsing entry point
- `parseJSON()`: Handle JSON format collections
- `parseBru()`: Handle .bru format files
- `extractRequests()`: Extract normalized request objects

**Normalization**:
All collections are normalized to a common format:
```javascript
{
  name: string,
  folder: string,
  method: string,
  url: string,
  headers: Array<{key, value, disabled}>,
  body: {mode, raw, urlencoded, formdata},
  auth: object,
  description: string,
  tests: Array,
  variables: object,
  id: string
}
```

#### PostmanParser (Future)
Similar structure to BrunoParser but handles Postman-specific features.

---

### 2. Analysis Engine

#### CorrelationDetector (`src/analyzers/correlationDetector.js`)

**Responsibility**: Detect dynamic values that need correlation between requests

**Algorithm**:
1. **Value Production Analysis**:
   - Scans response patterns (URLs, headers, body)
   - Identifies potential dynamic values (tokens, IDs, etc.)
   - Maps values to their source requests

2. **Value Consumption Analysis**:
   - Scans request patterns (headers, body, URL params)
   - Identifies variable references ({{var}}, ${var})
   - Maps consumed values to requests

3. **Correlation Matching**:
   - Links producers with consumers
   - Generates extractor configurations
   - Creates correlation rules

**Pattern Detection**:
```javascript
correlationPatterns = [
  { pattern: /token/i, type: 'token', extractorType: 'json' },
  { pattern: /sessionid/i, type: 'sessionId', extractorType: 'json' },
  { pattern: /csrf/i, type: 'csrf', extractorType: 'boundary' },
  { pattern: /\bid\b/i, type: 'id', extractorType: 'json' }
]
```

**Extractor Generation**:
```javascript
// JSON Path Extractor
new load.JsonPathExtractor("authToken", "$.token")

// Boundary Extractor
new load.BoundaryExtractor("csrf", '<input name="csrf" value="', '">')

// Regex Extractor
new load.RegexpExtractor("sessionId", "session=([^;]+)", "i")
```

#### ParameterizationEngine (`src/analyzers/parameterizationEngine.js`)

**Responsibility**: Extract and manage test data parameters

**Detection Strategy**:
1. **Collection-Level Variables**: Extracted from collection metadata
2. **Environment Variables**: From environment configurations
3. **Request Analysis**:
   - URL patterns (base URL, endpoints)
   - Header values (API keys, custom headers)
   - Body values (form data, JSON fields)
   - Query parameters

**Type Detection**:
```javascript
detectParameterType(value) {
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) return 'email';
  if (/^https?:\/\/.+/.test(value)) return 'url';
  if (/^[0-9a-f-]{36}$/i.test(value)) return 'uuid';
  if (!isNaN(value)) return 'number';
  if (/true|false/i.test(value)) return 'boolean';
  return 'string';
}
```

**3-Tier Variable Classification** (in `classifyVariables()`):
```
Priority order:
1. Scripts set variable (context.set/pm.*.set) → DYNAMIC (load.global)
2. Correlation target → DYNAMIC (load.global)
3. _ prefix + empty value → DYNAMIC (load.global)
4. $ prefix → SKIP (Postman built-in)
5. Credential name pattern → PARAM TEST DATA (load.params, nextValue: iteration)
6. Everything else → PARAM CONFIG (load.params, nextValue: once)
```

**Data File Generation**:
All parameterized values stored in single `collection_data.csv`:
```csv
baseUrl,clientId,username,password
https://api.example.com,abc123,testuser1,Pass@123
```

#### AuthenticationHandler (`src/analyzers/authenticationHandler.js`)

**Responsibility**: Handle authentication configurations

**Supported Types**:
- OAuth 2.0 (Client Credentials, Password, Authorization Code)
- Basic Authentication
- Bearer Token
- API Key (Header/Query)
- AWS Signature v4
- Digest Authentication

**Code Generation**:
Each auth type generates appropriate DevWeb code:

**OAuth 2.0 Example**:
```javascript
const oauth2Token_request = new load.WebRequest({
    url: "https://api.example.com/oauth/token",
    method: "POST",
    body: {
        grant_type: "client_credentials",
        client_id: load.params.clientId,
        client_secret: load.params.clientSecret
    },
    extractors: [
        new load.JsonPathExtractor("accessToken", "$.access_token")
    ]
});
```

---

### 3. Script Generator

#### AdvancedScriptGenerator (`src/generators/advancedScriptGenerator.js`)

**Responsibility**: Generate complete DevWeb scripts

**Generation Process**:

1. **Analysis Phase**:
   ```javascript
   await this.analyze() {
     // Run correlation detection
     // Extract parameters
     // Configure authentication
   }
   ```

2. **Initialize Section**:
   ```javascript
   generateInitialize() {
     // Global variable initialization
     // Authentication setup
     // Configuration loading
   }
   ```

3. **Action Section**:
   ```javascript
   generateAction() {
     if (groupByFolder && useTransactions) {
       return generateGroupedActions();
     } else {
       return generateSequentialActions();
     }
   }
   ```

4. **Request Code Generation**:
   ```javascript
   generateRequestCode(request) {
     // Build WebRequest options
     // Add extractors for correlation
     // Inject authentication headers
     // Handle response
     // Store correlated values
   }
   ```

5. **Finalize Section**:
   ```javascript
   generateFinalize() {
     // Cleanup code
     // Final logging
   }
   ```

**Code Structure**:
```javascript
load.initialize("Initialize", async function () {
    load.global.token = null;  // Dynamic variables
});
load.action("Action", async function () {
    // Transactions declared INSIDE action, at top
    let TS01 = new load.Transaction("Authentication");

    TS01.start();
    const webResponse_01 = new load.WebRequest({
        id: 1,
        url: `${load.params.baseUrl}/login`,
        method: "POST",
        body: { "username": load.params.username },
        returnBody: true,
        extractors: [new load.JsonPathExtractor("token", "$.access_token")]
    }).sendSync();
    load.global.token = webResponse_01.extractors.token;
    TS01.stop(load.TransactionStatus.Passed);
});
load.finalize("Finalize", async function () {...});
```

---

## Data Flow

### Request Processing Pipeline

```
Collection File
      │
      ▼
Parse Collection
      │
      ├─► Extract Metadata
      ├─► Extract Variables
      ├─► Extract Auth Config
      └─► Extract Requests
            │
            ▼
      Normalize Requests
            │
            ▼
      Analyze for Correlation
            │
            ├─► Detect Producers
            ├─► Detect Consumers
            └─► Create Mappings
            │
            ▼
      Analyze for Parameters
            │
            ├─► Extract from URLs
            ├─► Extract from Headers
            ├─► Extract from Body
            └─► Type Detection
            │
            ▼
      Generate DevWeb Code
            │
            ├─► Initialize Section
            ├─► Action Section
            │     ├─► Transaction Wrapper
            │     ├─► WebRequest Creation
            │     ├─► Extractor Configuration
            │     ├─► Parameter Injection
            │     └─► Error Handling
            └─► Finalize Section
            │
            ▼
      Write Output Files
            │
            ├─► main.js
            ├─► scenario.yml (pacing, vusers, duration)
            ├─► rts.yml
            ├─► tsconfig.json
            ├─► parameters.yml (when variables exist)
            ├─► collection_data.csv
            └─► data/*.b64 (extracted large base64)
```

---

## Algorithm Details

### Correlation Detection Algorithm

**Step 1: Build Value Registry**
```javascript
valueRegistry = Map<valueName, Array<{
  producedAt: number,
  requestName: string,
  extractorType: string,
  extractPath: string
}>>
```

**Step 2: Detect Producers**
```javascript
for each request {
  analyze response patterns
  if (matches known pattern) {
    valueRegistry.add(pattern → request mapping)
  }
}
```

**Step 3: Detect Consumers**
```javascript
for each request {
  analyze request (headers, body, URL)
  if (contains variable reference) {
    find producer in valueRegistry
    create correlation rule
  }
}
```

**Step 4: Generate Extractors**
```javascript
for each correlation {
  switch (extractorType) {
    case 'json':
      return new load.JsonPathExtractor(...)
    case 'boundary':
      return new load.BoundaryExtractor(...)
    case 'regex':
      return new load.RegexpExtractor(...)
  }
}
```

### Parameter Extraction Algorithm

**Step 1: Collection-Level Scan**
```javascript
extract collection.variable[]
extract collection.auth
extract environment variables
```

**Step 2: Request-Level Analysis**
```javascript
for each request {
  analyzeUrl(request.url)
  analyzeHeaders(request.headers)
  analyzeBody(request.body)
}
```

**Step 3: Type Inference**
```javascript
function inferType(value) {
  if (isEmail(value)) return 'email'
  if (isURL(value)) return 'url'
  if (isUUID(value)) return 'uuid'
  if (isNumber(value)) return 'number'
  return 'string'
}
```

**Step 4: Data Generation**
```javascript
for each parameter {
  generateSampleData(parameter.type, count=10)
  writeToCSV(parameter.name, sampleData)
}
```

---

## Performance Considerations

### Memory Management
- **Streaming**: Large collections processed in chunks
- **Lazy Loading**: Files loaded on-demand
- **Cleanup**: Temporary files deleted after processing

### Optimization Strategies
- **Caching**: Parsed collections cached during analysis
- **Parallel Processing**: Multiple collections processed concurrently
- **Incremental Generation**: Script sections generated independently

---

## Error Handling

### Error Categories

1. **Parse Errors**:
   - Invalid JSON/BRU format
   - Missing required fields
   - Unsupported collection version

2. **Analysis Errors**:
   - Circular correlation dependencies
   - Invalid parameter types
   - Unsupported auth methods

3. **Generation Errors**:
   - File write failures
   - Invalid DevWeb syntax
   - Resource constraints

### Error Recovery

```javascript
try {
  await converter.convert();
} catch (error) {
  if (error instanceof ParseError) {
    // Retry with fallback parser
  } else if (error instanceof AnalysisError) {
    // Continue with partial analysis
  } else {
    // Log and fail gracefully
  }
}
```

---

## Testing Strategy

### Unit Tests
```javascript
// Parser tests
describe('BrunoParser', () => {
  it('should parse JSON collection', async () => {});
  it('should parse .bru file', async () => {});
  it('should normalize requests', () => {});
});

// Analyzer tests
describe('CorrelationDetector', () => {
  it('should detect token correlation', () => {});
  it('should generate extractors', () => {});
});
```

### Integration Tests
```javascript
describe('End-to-End Conversion', () => {
  it('should convert Postman collection', async () => {
    const result = await converter.convert();
    expect(result.success).toBe(true);
    expect(fs.existsSync(result.scriptPath)).toBe(true);
  });
});
```

### Test Fixtures
```
tests/
├── fixtures/
│   ├── simple-collection.json
│   ├── oauth-collection.json
│   ├── complex-collection.json
│   └── bruno-collection.bru
└── expected/
    ├── simple-output/
    ├── oauth-output/
    └── complex-output/
```

---

## Extending the Converter

### Adding New Auth Type

1. **Update AuthenticationHandler**:
```javascript
generateCustomAuthCode(authConfig) {
  return `
    // Custom Auth Setup
    load.setUserCredentials({...});
  `;
}
```

2. **Add to switch statement**:
```javascript
case 'custom':
  return this.generateCustomAuthCode(authConfig);
```

### Adding New Extractor Type

1. **Update CorrelationDetector**:
```javascript
correlationPatterns.push({
  pattern: /customValue/i,
  type: 'custom',
  extractorType: 'custom'
});
```

2. **Add extractor generation**:
```javascript
case 'custom':
  return `new load.CustomExtractor("${name}", options)`;
```

### Adding New Parser

1. **Create parser class**:
```javascript
class CustomParser {
  async parse() {
    // Parse custom format
    return normalizedRequests;
  }
}
```

2. **Register in factory**:
```javascript
createParser(type) {
  switch(type) {
    case 'custom': return new CustomParser();
  }
}
```

---

## Configuration Reference

### scenario.yml Schema

```yaml
# All times are defined in seconds
vusers: 1            # Number of Vusers
pacing:
  type: delay        # delay or interval
  mode: random       # fixed or random
  min: 3
  max: 6
rampUp: 2            # Seconds to start all Vusers
duration: 20         # Seconds to run after ramp-up
tearDown: 0          # Not used
```

### parameters.yml Schema

```yaml
parameters:
  - name: varName            # Variable name (load.params.varName)
    type: csv                # Always csv
    fileName: collection_data.csv  # Single file for all params
    columnName: varName      # CSV column header
    nextValue: once|iteration  # once=config, iteration=test data
    nextRow: sequential|same as <param>
    onEnd: loop
```

---

## Troubleshooting

### Common Issues

**Issue**: Correlation not detected
```
Solution: Check if variable names match between producer and consumer
Debug: Enable debug logging and check correlation report
```

**Issue**: Authentication failing
```
Solution: Verify auth credentials in parameters.yml
Debug: Check generated auth code in initialize section
```

**Issue**: Parameters not replaced
```
Solution: Ensure parameter names match in collection
Debug: Check parameters.yml for extracted parameters
```

---

## API Reference

### BrunoDevWebConverter

```javascript
const converter = new BrunoDevWebConverter(options);

// Methods
await converter.convert()         // Main conversion
converter.getResults()            // Get conversion results

// Options
{
  inputFile: string,
  outputDir: string,
  useTransactions: boolean,
  useCorrelation: boolean,
  useParameterization: boolean,
  useAuthentication: boolean,
  thinkTime: number,
  logLevel: string
}
```

### CLI API

```bash
bruno-devweb convert [options]
bruno-devweb analyze [options]
bruno-devweb web [options]
```

---

**Last Updated**: February 2026
**Version**: 2.1.1
