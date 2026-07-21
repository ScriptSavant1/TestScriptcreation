/**
 * Enhanced Bruno Collection Parser
 * Supports .bru, JSON, and Bruno YAML folder-based formats
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

class BrunoParser {
  constructor(collectionPath) {
    this.collectionPath = collectionPath;
    this.collection = null;
    this.metadata = {
      version: null,
      name: null,
      type: null
    };
  }

  /**
   * Parse Bruno collection
   * Supports: .json (Postman/Bruno JSON), .bru (Bruno text), directory or .yml (Bruno YAML folder)
   */
  async parse() {
    // Check if path is a directory → Bruno YAML folder format
    try {
      const stat = await fs.stat(this.collectionPath);
      if (stat.isDirectory()) {
        return await this.parseBrunoYamlCollection();
      }
    } catch (e) {
      // Not a stat-able path, fall through to file parsing
    }

    const ext = path.extname(this.collectionPath).toLowerCase();

    if (ext === '.json') {
      return await this.parseJSON();
    } else if (ext === '.bru') {
      return await this.parseBru();
    } else if (ext === '.yml' || ext === '.yaml') {
      return await this.parseBrunoYamlCollection();
    } else {
      // Try to auto-detect
      const content = await fs.readFile(this.collectionPath, 'utf8');
      try {
        JSON.parse(content);
        return await this.parseJSON();
      } catch (e) {
        return await this.parseBru();
      }
    }
  }

  /**
   * Parse JSON format (Postman-compatible or Bruno JSON export)
   */
  async parseJSON() {
    const content = await fs.readFile(this.collectionPath, 'utf8');
    this.collection = JSON.parse(content);
    
    // Detect if it's Postman or Bruno format
    if (this.collection.info && this.collection.info.schema) {
      this.metadata.type = 'postman';
      this.metadata.version = this.collection.info.schema;
      this.metadata.name = this.collection.info.name;
    } else {
      this.metadata.type = 'bruno';
      this.metadata.name = this.collection.name || 'Bruno Collection';
    }

    return this.extractRequests();
  }

  /**
   * Parse .bru format (Bruno's native format)
   * Can be a request file or environment file
   */
  async parseBru() {
    const content = await fs.readFile(this.collectionPath, 'utf8');
    this.metadata.type = 'bruno-bru';

    // Check if its an environmnet file (contains only vars section)
    if (content.trim().startsWith('vars {') || content.includes('\nvars {')) {
      // It's an environment file — return empty requests, vars will be extracted seperately
      return [];
    }

    // Parse .bru file as request
    const request = this.parseBruContent(content);
    return [request];
  }

   /**
   * Parse Bruno .bru environment file and extract variables
   * Returns Object with variables
   */
  async parseBruEnvironment() {
    const content = await fs.readFile(this.collectionPath, 'utf8');
    const vars = {};

    //Match vars { ... } block
    const varsMatch = content.match(/vars\s*\{([^}]+)\}/s);
    if (varsMatch) {
      const varsContent = varsMatch[1];
      const lines = varsContent.split('\n');

      for (const line of lines){
        const trimmed = line.trim();
        if(!trimmed || trimmed.startsWith('//'))  {
          continue; // Skip empty lines and comments
        }

        const colonIndex = trimmed.indexOf(':');
        if (colonIndex > 0) {
          const key = trimmed.substring(0, colonIndex).trim();
          const value = trimmed.substring(colonIndex + 1).trim();
          vars[key] = value;
        }          
      }
    }
    return vars;
  }


  /**
   * Parse a single .bru file content
   */
  parseBruContent(content) {
    const lines = content.split('\n');
    const request = {
      name: '',
      method: 'GET',
      url: '',
      headers: [],
      body: null,
      auth: null,
      tests: [],
      vars: {}
    };

    let currentSection = null;
    let currentContent = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Section headers in .bru format
      if (line.startsWith('meta')) {
        this.flushSection(request, currentSection, currentContent);
        currentSection = 'meta';
        currentContent = [];
      } else if (line.match(/^(get|post|put|patch|delete|head|options)\s+/i)) {
        this.flushSection(request, currentSection, currentContent);
        const parts = line.split(/\s+/);
        request.method = parts[0].toUpperCase();
        request.url = parts.slice(1).join(' ');
        currentSection = null;
      } else if (line === 'headers') {
        this.flushSection(request, currentSection, currentContent);
        currentSection = 'headers';
        currentContent = [];
      } else if (line === 'body' || line === 'body:json' || line === 'body:text') {
        this.flushSection(request, currentSection, currentContent);
        currentSection = line.includes('json') ? 'body:json' : 'body';
        currentContent = [];
      } else if (line === 'auth' || line === 'auth:basic' || line === 'auth:bearer') {
        this.flushSection(request, currentSection, currentContent);
        currentSection = line;
        currentContent = [];
      } else if (line === 'vars') {
        this.flushSection(request, currentSection, currentContent);
        currentSection = 'vars';
        currentContent = [];
      } else if (line === 'tests' || line === 'script' || line === 'script:pre-request') {
        this.flushSection(request, currentSection, currentContent);
        currentSection = line;
        currentContent = [];
      } else if (line && !line.startsWith('//')) {
        currentContent.push(line);
      }
    }

    // Flush last section
    this.flushSection(request, currentSection, currentContent);

    return request;
  }

  /**
   * Flush accumulated section content
   */
  flushSection(request, section, content) {
    if (!section || content.length === 0) return;

    const text = content.join('\n').trim();

    switch (section) {
      case 'meta':
        const metaMatch = text.match(/name:\s*(.+)/);
        if (metaMatch) {
          request.name = metaMatch[1].trim();
        }
        break;

      case 'headers':
        content.forEach(line => {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            request.headers.push({ key, value, disabled: false });
          }
        });
        break;

      case 'body':
      case 'body:json':
        request.body = {
          mode: section.includes('json') ? 'raw' : 'raw',
          raw: text
        };
        break;

      case 'auth:basic':
        const username = text.match(/username:\s*(.+)/)?.[1];
        const password = text.match(/password:\s*(.+)/)?.[1];
        if (username && password) {
          request.auth = {
            type: 'basic',
            basic: [
              { key: 'username', value: username.trim() },
              { key: 'password', value: password.trim() }
            ]
          };
        }
        break;

      case 'auth:bearer':
        const token = text.match(/token:\s*(.+)/)?.[1];
        if (token) {
          request.auth = {
            type: 'bearer',
            bearer: [
              { key: 'token', value: token.trim() }
            ]
          };
        }
        break;

      case 'vars':
        content.forEach(line => {
          const colonIndex = line.indexOf(':');
          if (colonIndex > 0) {
            const key = line.substring(0, colonIndex).trim();
            const value = line.substring(colonIndex + 1).trim();
            request.vars[key] = value;
          }
        });
        break;

      case 'tests':
      case 'script':
      case 'script:pre-request':
        request.tests.push({
          type: section,
          script: text
        });
        break;
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Bruno YAML folder-based format support
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Parse a Bruno YAML folder-based collection.
   * Input can be:
   *   - A directory containing opencollection.yml
   *   - The path to opencollection.yml itself
   *   - Any .yml file inside the collection (will walk up to find root)
   */
  async parseBrunoYamlCollection() {
    let collectionDir;
    let collectionFile = null;

    const stat = await fs.stat(this.collectionPath);
    if (stat.isDirectory()) {
      collectionDir = this.collectionPath;
      const candidate = path.join(collectionDir, 'opencollection.yml');
      try { await fs.access(candidate); collectionFile = candidate; } catch (e) { /* no root file */ }
    } else {
      collectionFile = this.collectionPath;
      collectionDir = path.dirname(this.collectionPath);

      // If not the root file, look for opencollection.yml in the same directory
      if (path.basename(this.collectionPath) !== 'opencollection.yml') {
        const sibling = path.join(collectionDir, 'opencollection.yml');
        try { await fs.access(sibling); collectionFile = sibling; } catch (e) { /* use given file */ }
      }
    }

    // Parse root collection metadata
    let rootData = {};
    if (collectionFile) {
      const rootContent = await fs.readFile(collectionFile, 'utf8');
      rootData = yaml.load(rootContent) || {};
    }

    this.metadata.type = 'bruno-yaml';
    this.metadata.name = rootData.info?.name || path.basename(collectionDir);
    this.metadata.version = rootData.opencollection || '1.0.0';

    // Build Postman-compatible variable array (key/value) from Bruno variables array (name/value)
    const collectionVariables = (rootData.request?.variables || []).map(v => ({
      key: v.name,
      value: v.value || ''
    }));

    // Build Postman-compatible events from root collection scripts
    const collectionEvents = (rootData.request?.scripts || []).map(s => ({
      listen: s.type === 'after-response' ? 'test' : 'prerequest',
      script: { exec: (s.code || '').split(/\r?\n/) }
    }));

    // Extract collection-level headers (apply to every request, e.g. PRIVATE-TOKEN)
    // Bruno YAML: request.headers[].name / .value
    const collectionHeaders = (rootData.request?.headers || [])
      .filter(h => !h.disabled && h.name && h.value !== undefined)
      .map(h => ({ key: h.name, value: String(h.value) }));

    // Also extract headers added via before-request scripts:
    //   req.getHeaders().add({key: 'X-Foo', value: 'bar'})
    const addHeaderPattern = /req\.getHeaders\(\)\.add\(\s*\{[^}]*key\s*:\s*['"]([^'"]+)['"][^}]*value\s*:\s*['"]([^'"]+)['"][^}]*\}\s*\)/g;
    for (const script of (rootData.request?.scripts || [])) {
      if (script.type === 'before-request') {
        let m;
        while ((m = addHeaderPattern.exec(script.code || '')) !== null) {
          // Only add if not already in collectionHeaders
          if (!collectionHeaders.find(h => h.key === m[1])) {
            collectionHeaders.push({ key: m[1], value: m[2] });
          }
        }
      }
    }

    // Extract collection-level auth (OAuth2 / API Key / Bearer / etc.)
    const collectionAuth = rootData.request?.auth || null;

    //Extract proxy configuration
    const proxyConfig = rootData.config?.proxy || null;

    // Initialize collection object — item[] populated after walk/traverse
    this.collection = {
      info: { name: this.metadata.name },
      variable: collectionVariables,
      event: collectionEvents,
      collectionHeaders,   // <-- headers that apply to every request
      collectionAuth,      // <-- OAuth2/auth config at collection level
      
      item: []
    };

    // Detect format:
    //   Bundled single-file  → root YAML has an `items` array (all requests embedded inline)
    //   Distributed folder   → no `items` in root file; each request is a separate .yml file
    const requests = [];
    if (rootData.items && Array.isArray(rootData.items)) {
      // Bundled format: traverse the inline items tree
      this.metadata.type = 'bruno-yaml-bundled';
      this.traverseBrunoYamlItems(rootData.items, requests, '');
    } else {
      // Distributed format: walk the directory
      await this.walkBrunoYamlDir(collectionDir, requests, '');
    }

    // Populate collection.item so generator's detectScriptSetVariables() can find scripts
    this.collection.item = requests.map(req => ({
      name: req.name,
      event: req.tests,
      request: { method: req.method, url: req.url }
    }));

    return requests;
  }

  /**
   * Traverse a bundled Bruno YAML items array (single-file format).
   *
   * The actual Bruno single-YAML export uses info.type to identify item kind:
   *   Folder:  { info: { name, type: 'folder', seq }, items: [...], ... }
   *   Request: { info: { name, type: 'http',   seq }, http: {...}, runtime?, settings? }
   *
   * Some spec variants use a top-level `type` field instead of `info.type` —
   * both are handled.
   */
  traverseBrunoYamlItems(items, requests, parentFolder) {
    if (!Array.isArray(items)) return;

    // Sort by sequence number — prefer info.seq, fall back to top-level seq
    const sorted = [...items].sort((a, b) => {
      const aSeq = a.info?.seq ?? a.seq ?? 999;
      const bSeq = b.info?.seq ?? b.seq ?? 999;
      return aSeq - bSeq;
    });

    for (const item of sorted) {
      // Determine item type — check info.type first, then top-level type
      const itemType = item.info?.type || item.type;
      const itemName = item.info?.name || item.name || '';

      if (itemType === 'folder') {
        const folderName = parentFolder ? `${parentFolder}/${itemName}` : itemName;
        if (item.items) {
          this.traverseBrunoYamlItems(item.items, requests, folderName);
        }
      } else if (itemType === 'http' || item.http) {
        // Request item — structure mirrors individual .yml files
        // Pass the whole item; normalizeBrunoYamlRequest handles info.name/info.seq fallbacks
        requests.push(this.normalizeBrunoYamlRequest(item, parentFolder));
      }
    }
  }

  /**
   * Recursively walk a Bruno YAML directory.
   * Reads request .yml files (info.type: http) and recurses into subdirectories.
   * Requests within a directory are ordered by info.seq; subdirectories by their folder.yml seq.
   */
  async walkBrunoYamlDir(dirPath, requests, parentFolder) {
    let entries;
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch (e) {
      return; // Unreadable directory — skip
    }

    const ignoredDirs = new Set(['node_modules', '.git', '.bruno']);

    const requestFiles = entries.filter(e =>
      e.isFile() &&
      e.name.endsWith('.yml') &&
      e.name !== 'folder.yml' &&
      e.name !== 'opencollection.yml'
    );

    const subdirs = entries.filter(e =>
      e.isDirectory() && !ignoredDirs.has(e.name)
    );

    // ── Read and sort request files in this directory ───────────────────────
    const reqEntries = [];
    for (const file of requestFiles) {
      const filePath = path.join(dirPath, file.name);
      try {
        const content = await fs.readFile(filePath, 'utf8');
        const data = yaml.load(content);
        if (data && data.info && data.info.type === 'http') {
          reqEntries.push({ data });
        }
      } catch (e) {
        // Skip unparseable files
      }
    }
    reqEntries.sort((a, b) => (a.data.info?.seq || 999) - (b.data.info?.seq || 999));

    for (const { data } of reqEntries) {
      requests.push(this.normalizeBrunoYamlRequest(data, parentFolder));
    }

    // ── Read folder metadata for subdirectories ──────────────────────────────
    const subfolderMeta = new Map();
    for (const subdir of subdirs) {
      const folderYmlPath = path.join(dirPath, subdir.name, 'folder.yml');
      let meta = { name: subdir.name, seq: 999 };
      try {
        const folderContent = await fs.readFile(folderYmlPath, 'utf8');
        const folderData = yaml.load(folderContent) || {};
        meta = {
          name: folderData.info?.name || subdir.name,
          seq: folderData.info?.seq ?? 999
        };
      } catch (e) { /* no folder.yml — use directory name */ }
      subfolderMeta.set(subdir.name, meta);
    }

    // Sort subdirectories by sequence number, then recurse
    const sortedSubdirs = [...subdirs].sort((a, b) => {
      const aSeq = subfolderMeta.get(a.name)?.seq ?? 999;
      const bSeq = subfolderMeta.get(b.name)?.seq ?? 999;
      return aSeq - bSeq;
    });

    for (const subdir of sortedSubdirs) {
      const meta = subfolderMeta.get(subdir.name);
      const folderName = parentFolder ? `${parentFolder}/${meta.name}` : meta.name;
      await this.walkBrunoYamlDir(path.join(dirPath, subdir.name), requests, folderName);
    }
  }

  /**
   * Normalize a Bruno YAML request object to the standard format expected by the generator.
   */
  normalizeBrunoYamlRequest(data, folderName) {
    const http = data.http || {};
    const info = data.info || {};

    // `info` may be absent in bundled format — fall back to item-level name/seq
    const name = info.name || data.name || 'Unnamed Request';
    const seq  = info.seq  ?? data.seq  ?? 0;

    // Headers: Bruno YAML uses `name` field; generator expects `key`
    const headers = (http.headers || []).map(h => ({
      key: h.name,
      value: h.value || '',
      disabled: h.disabled || false,
      description: h.description || ''
    }));

    return {
      name,
      folder: folderName,
      depth: folderName ? folderName.split('/').length : 0,
      method: (http.method || 'GET').toUpperCase(),
      url: http.url || '',
      headers,
      body: this.normalizeBrunoYamlBody(http.body),
      auth: null, // Bruno YAML auth is at collection/folder level — handled via variables
      description: data.docs || '',
      tests: this.normalizeBrunoYamlScripts(data.runtime?.scripts),
      variables: {},
      id: this.generateId(),
      seq
    };
  }

  /**
   * Normalize Bruno YAML body to Postman-compatible format.
   */
  normalizeBrunoYamlBody(body) {
    if (!body) return null;

    switch (body.type) {
      case 'json':
        return {
          mode: 'raw',
          raw: typeof body.data === 'string' ? body.data : JSON.stringify(body.data, null, 2),
          urlencoded: [],
          formdata: [],
          options: { raw: { language: 'json' } }
        };

      case 'form-urlencoded':
        return {
          mode: 'urlencoded',
          raw: '',
          urlencoded: (body.data || []).map(item => ({
            key: item.name,
            value: item.value || '',
            disabled: item.disabled || false
          })),
          formdata: []
        };

      case 'multipart-form':
      case 'formdata':
        return {
          mode: 'formdata',
          raw: '',
          urlencoded: [],
          formdata: (body.data || []).map(item => ({
            key: item.name,
            value: item.value || '',
            disabled: item.disabled || false,
            type: item.type || 'text'
          }))
        };

      case 'text':
      case 'xml':
      case 'graphql':
        return {
          mode: 'raw',
          raw: typeof body.data === 'string' ? body.data : '',
          urlencoded: [],
          formdata: []
        };

      default:
        return null;
    }
  }

  /**
   * Normalize Bruno YAML runtime scripts to Postman-compatible event format.
   * Bruno: [{type: 'after-response', code: '...'}]
   * Postman: [{listen: 'test', script: {exec: [...]}}]
   */
  normalizeBrunoYamlScripts(scripts) {
    if (!Array.isArray(scripts)) return [];

    return scripts.map(s => ({
      listen: s.type === 'after-response' ? 'test' : 'prerequest',
      script: {
        exec: (s.code || '').split(/\r?\n/)
      }
    }));
  }

  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Extract all requests from collection
   */
  extractRequests() {
    const requests = [];
    
    if (this.collection.item || this.collection.items) {
      const items = this.collection.item || this.collection.items;
      this.traverseItems(items, requests);
    } else if (this.collection.request) {
      // Single request
      requests.push(this.normalizeRequest(this.collection, ''));
    }
    
    return requests;
  }

  /**
   * Traverse items recursively
   */
  traverseItems(items, requests, folderName = '', depth = 0) {
    if (!Array.isArray(items)) return;

    items.forEach(item => {
      if (item.request) {
        // It's a request
        requests.push(this.normalizeRequest(item, folderName, depth));
      } else if (item.item || item.items) {
        // It's a folder, recurse
        const currentFolder = folderName ? `${folderName}/${item.name}` : item.name;
        this.traverseItems(item.item || item.items, requests, currentFolder, depth + 1);
      }
    });
  }

  /**
   * Normalize request to standard format
   */
  normalizeRequest(item, folderName, depth = 0) {
    const request = item.request || item;

    // Normalize scripts — handle THREE formats:
    //   1. Postman v2.1:  item.event[] with {listen, script}
    //   2. Bruno JSON:    item.script.req (pre-request) + item.script.res (post-response)
    //   3. Bruno YAML:    handled separately via normalizeBrunoYamlScripts()
    let tests = this.normalizeTests(item.event);

    if (tests.length === 0 && item.script) {
      // Bruno JSON export format — scripts live in item.script.{req,res}
      const brunoScript = item.script;
      if (brunoScript.req) {
        const text = typeof brunoScript.req === 'string' ? brunoScript.req : '';
        if (text.trim()) {
          tests.push({ listen: 'prerequest', script: { exec: text.split(/\r?\n/) } });
        }
      }
      if (brunoScript.res) {
        const text = typeof brunoScript.res === 'string' ? brunoScript.res : '';
        if (text.trim()) {
          tests.push({ listen: 'test', script: { exec: text.split(/\r?\n/) } });
        }
      }
    }

    return {
      name: item.name || 'Unnamed Request',
      folder: folderName,
      depth: depth,
      method: this.normalizeMethod(request.method),
      url: this.normalizeUrl(request.url),
      headers: this.normalizeHeaders(request.header || request.headers),
      body: this.normalizeBody(request.body),
      auth: request.auth || item.auth || null,
      description: request.description || item.description || '',
      tests: tests,
      variables: item.vars || {},
      id: item.id || this.generateId()
    };
  }

  /**
   * Normalize HTTP method
   */
  normalizeMethod(method) {
    if (typeof method === 'string') {
      return method.toUpperCase();
    }
    return 'GET';
  }

  /**
   * Normalize URL
   */
  normalizeUrl(url) {
    if (typeof url === 'string') {
      return url;
    }

    if (typeof url === 'object' && url !== null) {
      // Prefer the raw URL — it preserves {{variable}} templates correctly
      // and avoids double-protocol issues (e.g. https://{{url}} where {{url}} = https://example.com)
      if (url.raw) {
        return url.raw;
      }

      // Fallback: construct from parts
      const protocol = url.protocol || 'https';
      const host = Array.isArray(url.host) ? url.host.join('.') : (url.host || '');
      const path = Array.isArray(url.path) ? url.path.join('/') : (url.path || '');
      const query = url.query ? this.buildQueryString(url.query) : '';

      return `${protocol}://${host}/${path}${query}`;
    }

    return '';
  }

  /**
   * Build query string from array
   */
  buildQueryString(query) {
    if (!Array.isArray(query) || query.length === 0) return '';

    const params = query
      .filter(q => !q.disabled)
      .map(q => {
        // Don't encode template variables {{...}}
        const key = /\{\{.*?\}\}/.test(q.key) ? q.key : encodeURIComponent(q.key);
        const value = /\{\{.*?\}\}/.test(q.value || '') ? (q.value || '') : encodeURIComponent(q.value || '');
        return `${key}=${value}`;
      })
      .join('&');

    return params ? `?${params}` : '';
  }

  /**
   * Normalize headers
   */
  normalizeHeaders(headers) {
    if (!headers) return [];
    
    if (Array.isArray(headers)) {
      return headers.map(h => ({
        key: h.key,
        value: h.value,
        disabled: h.disabled || false,
        description: h.description || ''
      }));
    }
    
    if (typeof headers === 'object') {
      return Object.entries(headers).map(([key, value]) => ({
        key,
        value,
        disabled: false
      }));
    }
    
    return [];
  }

  /**
   * Normalize request body
   */
  normalizeBody(body) {
    if (!body) return null;
    
    return {
      mode: body.mode || 'raw',
      raw: body.raw || '',
      urlencoded: body.urlencoded || [],
      formdata: body.formdata || [],
      file: body.file || null,
      graphql: body.graphql || null,
      options: body.options || {}
    };
  }

  /**
   * Normalize tests/scripts
   */
  normalizeTests(events) {
    if (!Array.isArray(events)) return [];
    
    return events.map(event => ({
      listen: event.listen,
      script: event.script
    }));
  }

  /**
   * Generate unique ID
   */
  generateId() {
    return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get collection metadata
   */
  getMetadata() {
    return {
      ...this.metadata,
      totalRequests: this.collection ? this.countRequests() : 0
    };
  }

  /**
   * Count total requests in collection
   */
  countRequests(items = null) {
    if (!items) {
      items = this.collection.item || this.collection.items || [];
    }
    
    let count = 0;
    items.forEach(item => {
      if (item.request) {
        count++;
      } else if (item.item || item.items) {
        count += this.countRequests(item.item || item.items);
      }
    });
    
    return count;
  }
}

module.exports = BrunoParser;
