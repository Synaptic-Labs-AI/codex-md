/**
 * metadataExtractorAdapter.js
 * 
 * This adapter provides a CommonJS wrapper around the ES module metadataExtractor.
 * It allows the Electron code (which uses CommonJS) to import the backend code
 * (which uses ES modules) without compatibility issues.
 * 
 * This implementation uses the BaseModuleAdapter pattern for consistent module loading
 * and error handling, with robust fallbacks for when the module hasn't loaded yet.
 * 
 * Related files:
 * - backend/src/utils/metadataExtractor.js: The original ES module
 * - src/electron/services/ElectronConversionService.js: The consumer of this adapter
 * - src/electron/adapters/BaseModuleAdapter.js: Base adapter class
 * - src/electron/services/ConversionResultManager.js: Uses formatMetadata
 */

const BaseModuleAdapter = require('./BaseModuleAdapter');

/**
 * Fallback implementation of formatMetadata that matches the real function's behavior
 * @param {object} metadata - Metadata object to format
 * @returns {string} - Formatted YAML frontmatter
 */
function formatMetadataFallback(metadata) {
  console.warn('⚠️ Using fallback formatMetadata function');
  const lines = ['---'];
  
  Object.entries(metadata || {}).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      if (value.length > 0) {
        lines.push(`${key}:`);
        value.forEach(item => lines.push(`  - ${item}`));
      }
    } else if (value !== null && value !== undefined && value !== '') {
      // Escape special characters and wrap in quotes if needed
      const needsQuotes = /[:#\[\]{}",\n]/g.test(String(value));
      const escapedValue = String(value).replace(/"/g, '\\"');
      lines.push(`${key}: ${needsQuotes ? `"${escapedValue}"` : value}`);
    }
  });
  
  lines.push('---', '');
  return lines.join('\n');
}

/**
 * Fallback implementation of extractMetadata
 * @param {string} url - URL to extract metadata from
 * @returns {Promise<object>} - Extracted metadata
 */
async function extractMetadataFallback(url) {
  console.warn('⚠️ Using fallback extractMetadata function');
  return {
    title: new URL(url).hostname,
    source: url,
    captured: new Date().toISOString()
  };
}

class MetadataExtractorAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      'src/utils/metadataExtractor.js',
      null, // No default export
      {
        // Named exports configuration
        extractMetadata: true,
        formatMetadata: true
      },
      false // Don't validate default export
    );
    
    // Initialize with fallbacks
    this.extractMetadata = extractMetadataFallback;
    this.formatMetadata = formatMetadataFallback;
    
    // Start loading the module
    this.initialize();
  }
  
  /**
   * Override the module loading to handle named exports
   */
  async loadModule() {
    console.log(`🔍 [MetadataExtractorAdapter] Attempting to load module: ${this.modulePath}`);
    try {
      // Use the parent class to load the module
      const module = await super.loadModule();
      
      // Store the exported functions
      if (module.extractMetadata) {
        this.extractMetadata = module.extractMetadata;
        console.log('✅ [MetadataExtractorAdapter] Successfully loaded extractMetadata function');
      } else {
        console.warn('⚠️ [MetadataExtractorAdapter] extractMetadata not found in module, using fallback');
      }
      
      if (module.formatMetadata) {
        this.formatMetadata = module.formatMetadata;
        console.log('✅ [MetadataExtractorAdapter] Successfully loaded formatMetadata function');
      } else {
        console.warn('⚠️ [MetadataExtractorAdapter] formatMetadata not found in module, using fallback');
      }
      
      return module;
    } catch (error) {
      console.error('❌ [MetadataExtractorAdapter] Failed to load module:', error);
      // Keep using the fallbacks
      return null;
    }
  }
  
  /**
   * Format metadata as YAML frontmatter
   * @param {object} metadata - Metadata object
   * @returns {string} - Formatted YAML frontmatter
   */
  formatMetadataSync(metadata) {
    try {
      // Use the loaded function if available, otherwise use fallback
      if (typeof this.formatMetadata === 'function') {
        return this.formatMetadata(metadata);
      } else {
        console.warn('⚠️ [MetadataExtractorAdapter] formatMetadata is not a function, using fallback');
        return formatMetadataFallback(metadata);
      }
    } catch (error) {
      console.error('❌ [MetadataExtractorAdapter] Error in formatMetadata:', error);
      // Use fallback on error
      return formatMetadataFallback(metadata);
    }
  }
  
  /**
   * Extract metadata from a URL
   * @param {string} url - URL to extract metadata from
   * @returns {Promise<object>} - Extracted metadata
   */
  async extractMetadataAsync(url) {
    try {
      // Use the loaded function if available, otherwise use fallback
      if (typeof this.extractMetadata === 'function') {
        return await this.extractMetadata(url);
      } else {
        console.warn('⚠️ [MetadataExtractorAdapter] extractMetadata is not a function, using fallback');
        return await extractMetadataFallback(url);
      }
    } catch (error) {
      console.error('❌ [MetadataExtractorAdapter] Error in extractMetadata:', error);
      // Use fallback on error
      return await extractMetadataFallback(url);
    }
  }
}

// Create and export singleton instance
const metadataExtractorAdapter = new MetadataExtractorAdapter();

// Export functions directly for backward compatibility
module.exports = {
  formatMetadata: (metadata) => metadataExtractorAdapter.formatMetadataSync(metadata),
  extractMetadata: (url) => metadataExtractorAdapter.extractMetadataAsync(url),
  // Also export the adapter instance for advanced usage
  metadataExtractorAdapter
};
