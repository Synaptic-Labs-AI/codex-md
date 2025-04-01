/**
 * Text Converter Factory Adapter
 * 
 * Provides a unified adapter for all text converters.
 * Delegates to ConversionServiceAdapter for most conversions while maintaining
 * backward compatibility with the existing API.
 * 
 * Related files:
 * - backend/src/services/converter/textConverterFactory.js: Original implementation
 * - src/electron/adapters/conversionServiceAdapter.js: Main conversion adapter
 * - src/electron/adapters/BaseModuleAdapter.js: Base adapter class
 */
const BaseModuleAdapter = require('./BaseModuleAdapter');
const conversionServiceAdapter = require('./conversionServiceAdapter');

// Create the text converter factory adapter
class TextConverterFactoryAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      'src/services/converter/textConverterFactory.js',
      'textConverterFactory'
    );
    
    // Run diagnostics
    BaseModuleAdapter.diagnoseEnvironment().catch(error => {
      console.error(`❌ [DIAGNOSTICS] Failed to run diagnostics:`, error);
    });
    
    console.log(`📋 [TextConverterFactory] Initialized with ConversionServiceAdapter`);
  }
  
  /**
   * Convert content to Markdown
   * @param {string} type - Content type (pdf, docx, etc.)
   * @param {Buffer|string} content - Content to convert
   * @param {Object} options - Conversion options
   * @returns {Promise<{content: string, images: Array}>}
   */
  async convertToMarkdown(type, content, options = {}) {
    console.log(`🔄 [TextConverterFactory] Converting ${type} to Markdown`);
    console.log(`📊 [TextConverterFactory] Content stats:`, {
      type,
      contentType: typeof content,
      isBuffer: Buffer.isBuffer(content),
      contentLength: content ? (Buffer.isBuffer(content) ? content.length : (typeof content === 'string' ? content.length : 'unknown')) : 'null',
      options: Object.keys(options)
    });
    
    try {
      // Prepare data for ConversionServiceAdapter
      const conversionData = {
        type,
        content,
        name: options.name || `file.${type}`,
        apiKey: options.apiKey,
        options
      };
      
      // Special handling for video files that need a file path
      if (type === 'video' || ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(type.toLowerCase())) {
        conversionData.filePath = options.filePath;
      }
      
      // Delegate to ConversionServiceAdapter
      console.log(`🔄 [TextConverterFactory] Delegating to ConversionServiceAdapter`);
      return await conversionServiceAdapter.convert(conversionData);
    } catch (error) {
      console.error(`❌ [TextConverterFactory] Conversion error for ${type}:`, error);
      console.error(`🔍 [TextConverterFactory] Error details:`, {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      // Throw the error instead of returning an error object
      throw new Error(`Failed to convert ${type} to Markdown: ${error.message}`);
    }
  }
  
  /**
   * Validate input for conversion
   * @param {string} type - Content type
   * @param {Buffer|string} input - Content to validate
   * @returns {Promise<boolean>}
   */
  async validateInput(type, input) {
    try {
      return await this.executeMethod('validateInput', [type, input]);
    } catch (error) {
      console.error(`❌ Validation error for ${type}:`, error);
      return false;
    }
  }
  
  /**
   * Validate file signature
   * @param {string} type - File type
   * @param {Buffer} buffer - File buffer
   * @returns {Promise<boolean>}
   */
  async validateFileSignature(type, buffer) {
    try {
      return await this.executeMethod('validateFileSignature', [type, buffer]);
    } catch (error) {
      console.error(`❌ Signature validation error for ${type}:`, error);
      return false;
    }
  }
}

// Create and export a singleton instance
const textConverterFactoryAdapter = new TextConverterFactoryAdapter();

module.exports = {
  textConverterFactory: {
    convertToMarkdown: (...args) => textConverterFactoryAdapter.convertToMarkdown(...args),
    validateInput: (...args) => textConverterFactoryAdapter.validateInput(...args),
    validateFileSignature: (...args) => textConverterFactoryAdapter.validateFileSignature(...args)
  }
};
