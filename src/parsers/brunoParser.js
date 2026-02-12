/**
 * Enhanced Bruno Collection Parser
 * Supports both .bru and JSON formats
 */

const fs = require('fs').promises;
const path = require('path');

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
   */
  async parse() {
    const ext = path.extname(this.collectionPath);
    
    if (ext === '.json') {
      return await this.parseJSON();
    } else if (ext === '.bru') {
      return await this.parseBru();
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
   */
  async parseBru() {
    const content = await fs.readFile(this.collectionPath, 'utf8');
    this.metadata.type = 'bruno-bru';
    
    // Parse .bru file
    const request = this.parseBruContent(content);
    return [request];
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
      } else if (line.match(/^(get|post|put|patch|delete|head|options)/i)) {
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
      tests: this.normalizeTests(item.event),
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
