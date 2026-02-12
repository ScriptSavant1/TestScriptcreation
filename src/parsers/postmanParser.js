/**
 * Postman Collection Parser
 * Handles Postman-specific collection format
 */

const BrunoParser = require('./brunoParser');

class PostmanParser extends BrunoParser {
  constructor(collectionPath) {
    super(collectionPath);
    this.isPostmanFormat = true;
  }

  /**
   * Parse Postman collection
   * Currently uses BrunoParser since they share similar JSON structure
   */
  async parse() {
    return super.parseJSON();
  }

  /**
   * Postman-specific normalization
   */
  normalizeRequest(item, folderName, depth = 0) {
    const normalized = super.normalizeRequest(item, folderName, depth);
    
    // Handle Postman-specific features
    if (item.protocolProfileBehavior) {
      normalized.protocolBehavior = item.protocolProfileBehavior;
    }
    
    // Handle Postman pre-request scripts
    if (item.request && item.request.preRequestScript) {
      normalized.preRequestScript = item.request.preRequestScript;
    }
    
    return normalized;
  }
}

module.exports = PostmanParser;
