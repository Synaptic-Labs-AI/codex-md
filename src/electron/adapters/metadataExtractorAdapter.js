/**
 * metadataExtractorAdapter.js
 * 
 * This adapter provides a CommonJS wrapper around the ES module metadataExtractor.
 * It allows the Electron code (which uses CommonJS) to import the backend code
 * (which uses ES modules) without compatibility issues.
 * 
 * Related files:
 * - backend/src/utils/metadataExtractor.js: The original ES module
 * - src/electron/services/ElectronConversionService.js: The consumer of this adapter
 */

// Initialize variables to hold the module functions once loaded
let extractMetadata = null;
let formatMetadata = null;

// Use dynamic import to load the ES module
(async function loadModule() {
  try {
    // Import the ES module
    const module = await import('../../../backend/src/utils/metadataExtractor.js');
    
    // Store the exported functions
    extractMetadata = module.extractMetadata;
    formatMetadata = module.formatMetadata;
    
    console.log('✅ Successfully loaded metadataExtractor module');
  } catch (error) {
    console.error('❌ Failed to load metadataExtractor module:', error);
    
    // Provide fallback implementations to prevent crashes
    extractMetadata = async (url) => {
      console.error('Using fallback extractMetadata function');
      return {
        title: new URL(url).hostname,
        source: url,
        captured: new Date().toISOString()
      };
    };
    
    formatMetadata = (metadata) => {
      console.error('Using fallback formatMetadata function');
      return `---\ntitle: "${metadata.title || 'Unknown'}"\nsource: "${metadata.source || ''}"\n---\n\n`;
    };
  }
})();

// Export a proxy object that forwards calls to the actual module functions
module.exports = {
  // Getters ensure we return the loaded functions or wait until they're loaded
  get extractMetadata() {
    if (!extractMetadata) {
      console.warn('⚠️ Accessing extractMetadata before it has loaded');
    }
    return extractMetadata;
  },
  
  get formatMetadata() {
    if (!formatMetadata) {
      console.warn('⚠️ Accessing formatMetadata before it has loaded');
    }
    return formatMetadata;
  }
};
