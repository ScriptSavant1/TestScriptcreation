/**
 * Advanced Parameterization Engine
 * Converts collection variables to DevWeb parameters with smart type detection
 */

const fs = require('fs').promises;
const path = require('path');
const yaml = require('js-yaml');

class ParameterizationEngine {
  constructor() {
    this.parameters = new Map();
    this.environmentVariables = new Map();
    this.dataFiles = new Map();
  }

  /**
   * Extract parameters from collection
   */
  async extractParameters(collection, collectionVariables = {}) {
    // Extract collection-level variables
    if (collection.variable) {
      collection.variable.forEach(variable => {
        this.addParameter(variable.key, variable.value, 'collection', {
          type: this.detectParameterType(variable.value),
          description: variable.description || `Collection variable: ${variable.key}`
        });
      });
    }

    // Extract environment variables
    Object.entries(collectionVariables).forEach(([key, value]) => {
      this.environmentVariables.set(key, {
        key,
        value,
        type: this.detectParameterType(value)
      });
    });

    // Analyze requests for parameterizable values
    if (collection.item || collection.items) {
      const items = collection.item || collection.items;
      this.analyzeItemsForParameters(items);
    }

    return this.parameters;
  }

  /**
   * Analyze items recursively for parameterizable values
   */
  analyzeItemsForParameters(items, folder = '') {
    items.forEach(item => {
      if (item.request) {
        this.analyzeRequest(item.request, item.name);
      }
      
      if (item.item || item.items) {
        this.analyzeItemsForParameters(item.item || item.items, item.name);
      }
    });
  }

  /**
   * Analyze a single request for parameterizable values
   */
  analyzeRequest(request, requestName) {
    try {
      // Check URL for parameterizable parts
      if (request.url) {
        this.analyzeUrl(request.url, requestName);
      }
      
      // Check headers
      if (request.header || request.headers) {
        this.analyzeHeaders(request.header || request.headers, requestName);
      }
      
      // Check body
      if (request.body) {
        this.analyzeBody(request.body, requestName);
      }
    } catch (error) {
      console.warn(`Warning: Failed to analyze request "${requestName}":`, error.message);
      // Continue processing other requests
    }
  }

  /**
   * Analyze URL for parameters
   */
  analyzeUrl(url, requestName) {
    if (!url) return;
    
    let urlString = typeof url === 'string' ? url : (url.raw || '');
    
    // Extract domain/host (could be parameterized)
    try {
      const hostMatch = urlString.match(/https?:\/\/([^\/]+)/);
      if (hostMatch) {
        const host = hostMatch[1];
        if (!host.includes('{{') && this.shouldParameterize(host, 'host')) {
          this.addParameter('baseUrl', `https://${host}`, 'url', {
            type: 'string',
            description: 'Base URL for API requests',
            usedIn: [requestName]
          });
        }
      }
    } catch (error) {
      console.warn(`Warning: Failed to parse URL in "${requestName}":`, error.message);
    }

    // Extract query parameters
    if (typeof url === 'object' && url.query && Array.isArray(url.query)) {
      url.query.forEach(param => {
        if (param && param.key && this.shouldParameterize(param.value, 'query')) {
          this.addParameter(
            `query_${param.key}`,
            param.value,
            'queryParam',
            {
              type: this.detectParameterType(param.value),
              description: `Query parameter: ${param.key}`,
              usedIn: [requestName]
            }
          );
        }
      });
    }
  }

  /**
   * Analyze headers for parameters
   */
  analyzeHeaders(headers, requestName) {
    // Skip if no headers at all
    if (!headers || (Array.isArray(headers) && headers.length === 0)) {
      return;
    }
    
    try {
      const headerArray = Array.isArray(headers) 
        ? headers 
        : Object.entries(headers).map(([key, value]) => ({ key, value }));
      
      headerArray.forEach(header => {
        // Skip if header is invalid or empty
        if (!header || !header.key || header.key === undefined || header.key === null) {
          return;
        }
        
        // Skip disabled headers
        if (header.disabled === true) {
          return;
        }
        
        // Skip common headers that shouldn't be parameterized
        const skipHeaders = ['content-type', 'accept', 'user-agent', 'connection', 'cache-control'];
        try {
          if (skipHeaders.includes(header.key.toLowerCase())) {
            return;
          }
        } catch (e) {
          // If toLowerCase fails, skip this header
          return;
        }

        // Only parameterize if value exists and should be parameterized
        if (header.value && this.shouldParameterize(header.value, 'header')) {
          this.addParameter(
            `header_${header.key}`,
            header.value,
            'header',
            {
              type: this.detectParameterType(header.value),
              description: `Header: ${header.key}`,
              usedIn: [requestName]
            }
          );
        }
      });
    } catch (error) {
      console.warn(`Warning: Error analyzing headers for "${requestName}":`, error.message);
      // Continue without headers
    }
  }

  /**
   * Analyze body for parameters
   */
  analyzeBody(body, requestName) {
    if (body.mode === 'raw') {
      try {
        const jsonBody = JSON.parse(body.raw);
        this.analyzeJsonBody(jsonBody, requestName);
      } catch (e) {
        // Not JSON, check for variables
        const variables = this.extractVariablesFromString(body.raw);
        variables.forEach(varName => {
          this.addParameter(varName, '', 'body', {
            type: 'string',
            description: `Body variable: ${varName}`,
            usedIn: [requestName]
          });
        });
      }
    } else if (body.mode === 'urlencoded') {
      body.urlencoded.forEach(param => {
        if (this.shouldParameterize(param.value, 'formData')) {
          this.addParameter(
            `form_${param.key}`,
            param.value,
            'formData',
            {
              type: this.detectParameterType(param.value),
              description: `Form data: ${param.key}`,
              usedIn: [requestName]
            }
          );
        }
      });
    }
  }

  /**
   * Analyze JSON body recursively
   */
  analyzeJsonBody(obj, requestName, prefix = '') {
    Object.entries(obj).forEach(([key, value]) => {
      const fullKey = prefix ? `${prefix}_${key}` : key;
      
      if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
        this.analyzeJsonBody(value, requestName, fullKey);
      } else if (this.shouldParameterize(value, 'jsonBody')) {
        this.addParameter(
          fullKey,
          value,
          'jsonBody',
          {
            type: this.detectParameterType(value),
            description: `JSON body field: ${fullKey}`,
            usedIn: [requestName]
          }
        );
      }
    });
  }

  /**
   * Add or update parameter
   */
  addParameter(key, value, source, metadata = {}) {
    if (this.parameters.has(key)) {
      const existing = this.parameters.get(key);
      if (metadata.usedIn) {
        existing.usedIn = [...new Set([...existing.usedIn, ...metadata.usedIn])];
      }
      this.parameters.set(key, { ...existing, ...metadata });
    } else {
      this.parameters.set(key, {
        key,
        value,
        source,
        usedIn: [],
        ...metadata
      });
    }
  }

  /**
   * Detect parameter type
   */
  detectParameterType(value) {
    if (value === null || value === undefined) return 'string';
    
    // Check if it's a number
    if (!isNaN(value) && !isNaN(parseFloat(value))) {
      return 'number';
    }
    
    // Check if it's a boolean
    if (value === 'true' || value === 'false' || typeof value === 'boolean') {
      return 'boolean';
    }
    
    // Check if it's an email
    if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
      return 'email';
    }
    
    // Check if it's a URL
    if (/^https?:\/\/.+/.test(value)) {
      return 'url';
    }
    
    // Check if it's a date
    if (!isNaN(Date.parse(value)) && /\d{4}-\d{2}-\d{2}/.test(value)) {
      return 'date';
    }
    
    // Check if it's a UUID
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
      return 'uuid';
    }
    
    return 'string';
  }

  /**
   * Determine if value should be parameterized
   */
  shouldParameterize(value, context) {
    if (!value || typeof value !== 'string') return false;
    
    // Already a variable
    if (/\{\{.*?\}\}|\$\{.*?\}/.test(value)) return true;
    
    // Skip very common static values
    const staticValues = ['true', 'false', 'null', '0', '1'];
    if (staticValues.includes(value.toLowerCase())) return false;
    
    // Context-specific rules
    switch (context) {
      case 'host':
        return true; // Always parameterize hosts
      
      case 'header':
        return value.length > 20; // Only parameterize long header values
      
      case 'query':
        return true; // Parameterize query params
      
      case 'formData':
      case 'jsonBody':
        return value.length > 5 && !staticValues.includes(value); // Skip short/static values
      
      default:
        return false;
    }
  }

  /**
   * Extract variable names from string
   */
  extractVariablesFromString(str) {
    const variables = [];
    const regex = /\{\{(.*?)\}\}|\$\{(.*?)\}/g;
    let match;
    
    while ((match = regex.exec(str)) !== null) {
      variables.push((match[1] || match[2]).trim());
    }
    
    return variables;
  }

  /**
   * Generate DevWeb parameter file (YAML)
   */
  async generateParameterFile(outputPath) {
    const paramConfig = {
      parameters: {}
    };

    this.parameters.forEach((param, key) => {
      paramConfig.parameters[key] = {
        type: param.type,
        value: param.value,
        description: param.description,
        source: param.source
      };
    });

    const yamlContent = yaml.dump(paramConfig, {
      indent: 2,
      lineWidth: -1
    });

    await fs.writeFile(outputPath, yamlContent, 'utf8');
    return outputPath;
  }

  /**
   * Generate parameter data file (CSV)
   */
  async generateDataFile(outputPath, parameterName, values) {
    const csvContent = `${parameterName}\n${values.join('\n')}`;
    await fs.writeFile(outputPath, csvContent, 'utf8');
    
    this.dataFiles.set(parameterName, {
      path: outputPath,
      values: values.length
    });
    
    return outputPath;
  }

  /**
   * Generate sample data for parameters
   */
  generateSampleData(parameter, count = 10) {
    const samples = [];
    
    for (let i = 0; i < count; i++) {
      samples.push(this.generateSampleValue(parameter, i));
    }
    
    return samples;
  }

  /**
   * Generate a sample value based on type
   */
  generateSampleValue(parameter, index) {
    switch (parameter.type) {
      case 'email':
        return `user${index + 1}@example.com`;
      
      case 'number':
        return (index + 1) * 100;
      
      case 'boolean':
        return index % 2 === 0;
      
      case 'uuid':
        return this.generateUUID();
      
      case 'date':
        const date = new Date();
        date.setDate(date.getDate() + index);
        return date.toISOString().split('T')[0];
      
      case 'url':
        return `https://example.com/resource/${index + 1}`;
      
      default:
        return `${parameter.key}_value_${index + 1}`;
    }
  }

  /**
   * Generate UUID v4
   */
  generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Get parameterization report
   */
  getReport() {
    const bySource = {};
    const byType = {};
    
    this.parameters.forEach(param => {
      bySource[param.source] = (bySource[param.source] || 0) + 1;
      byType[param.type] = (byType[param.type] || 0) + 1;
    });

    return {
      totalParameters: this.parameters.size,
      bySource,
      byType,
      parameters: Array.from(this.parameters.values()),
      dataFiles: Array.from(this.dataFiles.entries())
    };
  }

  /**
   * Generate DevWeb code for parameter usage
   */
  generateParameterUsage(parameterName) {
    return `load.params.${parameterName}`;
  }

  /**
   * Replace variables in string with parameter references
   */
  replaceWithParameters(str) {
    return str.replace(/\{\{(.*?)\}\}|\$\{(.*?)\}/g, (match, p1, p2) => {
      const varName = (p1 || p2).trim();
      return `\${${this.generateParameterUsage(varName)}}`;
    });
  }
}

module.exports = ParameterizationEngine;
