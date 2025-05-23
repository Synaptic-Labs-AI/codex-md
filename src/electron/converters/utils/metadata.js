/**
 * metadata.js
 * 
 * Utility functions for handling metadata formatting and extraction.
 * Provides standardized metadata structure across all converters.
 * 
 * Related files:
 * - src/electron/converters/UnifiedConverterFactory.js: Uses these utilities
 * - src/electron/services/ConversionResultManager.js: Uses metadata formatting
 */

/**
 * Create standardized metadata object for conversions
 * @param {object} options - Metadata options
 * @param {string} options.title - Document title
 * @param {string} options.fileType - File type (pdf, docx, url, video, audio, etc.)
 * @param {Date} [options.convertedDate] - Conversion date (defaults to now)
 * @returns {object} - Standardized metadata object
 */
function createStandardMetadata(options) {
  // Extract only the allowed fields, ignoring any extra properties
  const { title, fileType, convertedDate } = options || {};
  
  const metadata = {
    title: title || 'Untitled',
    converted: (convertedDate || new Date()).toISOString(),
    fileType: fileType
  };

  return metadata;
}

/**
 * Format metadata as YAML frontmatter
 * @param {object} metadata - Metadata object to format
 * @returns {string} - Formatted YAML frontmatter
 */
function formatMetadata(metadata) {
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
 * Create and format standardized metadata as YAML frontmatter
 * @param {object} options - Metadata options (same as createStandardMetadata)
 * @returns {string} - Formatted YAML frontmatter with standardized metadata
 */
function createStandardFrontmatter(options) {
  const metadata = createStandardMetadata(options);
  return formatMetadata(metadata);
}

/**
 * Extract metadata from a URL
 * @param {string} url - URL to extract metadata from
 * @returns {Promise<object>} - Extracted metadata
 */
async function extractMetadata(url) {
  try {
    const urlObj = new URL(url);
    return {
      title: urlObj.hostname,
      source: url,
      captured: new Date().toISOString()
    };
  } catch (error) {
    console.error('Failed to extract metadata:', error);
    return {
      source: url,
      captured: new Date().toISOString()
    };
  }
}

/**
 * Clean any metadata fields that might contain temporary filenames
 * @param {object} metadata - Metadata object to clean
 * @returns {object} - Cleaned metadata object
 */
function cleanMetadata(metadata) {
  const cleanedMetadata = { ...metadata };
  
  if (cleanedMetadata.originalFile && typeof cleanedMetadata.originalFile === 'string') {
    cleanedMetadata.originalFile = cleanTemporaryFilename(cleanedMetadata.originalFile);
  }
  
  return cleanedMetadata;
}

/**
 * Helper function to clean temporary filenames
 * @param {string} filename - The filename to clean
 * @returns {string} - The cleaned filename
 */
function cleanTemporaryFilename(filename) {
  if (!filename || typeof filename !== 'string') {
    console.warn(`⚠️ Invalid input to cleanTemporaryFilename: ${filename}`);
    return filename || '';
  }
  
  try {
    // Extract the base name without extension
    const extension = filename.includes('.') ? filename.substring(filename.lastIndexOf('.')) : '';
    const baseName = filename.includes('.') ? filename.substring(0, filename.lastIndexOf('.')) : filename;
    
    // Clean the base name - remove temp_ prefix and any numeric identifiers
    let cleanedName = baseName;
    if (baseName.startsWith('temp_')) {
      cleanedName = baseName.replace(/^temp_\d*_?/, '');
    }
    
    // Return the cleaned name with extension if it had one
    return cleanedName + extension;
  } catch (error) {
    console.error(`❌ Error in cleanTemporaryFilename:`, error);
    return filename;
  }
}

module.exports = {
  createStandardMetadata,
  formatMetadata,
  createStandardFrontmatter,
  extractMetadata,
  cleanMetadata,
  cleanTemporaryFilename
};
