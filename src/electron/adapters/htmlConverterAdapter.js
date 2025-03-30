/**
 * HTML Converter Adapter
 * 
 * Adapts the backend HTML converter for use in the Electron main process.
 * Uses the BaseModuleAdapter for consistent module loading and error handling.
 * 
 * Related files:
 * - backend/src/services/converter/text/htmlConverter.js: Original implementation
 * - src/electron/services/ElectronConversionService.js: Service using this adapter
 * - src/electron/adapters/BaseModuleAdapter.js: Base adapter class
 */
const BaseModuleAdapter = require('./BaseModuleAdapter');

// Create the HTML converter adapter
class HtmlConverterAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      'src/services/converter/text/htmlConverter.js',
      'default'
    );
  }
  
  /**
   * Convert HTML to Markdown
   * @param {Buffer} input - HTML file buffer
   * @param {string} originalName - Original filename
   * @returns {Promise<{content: string, images: Array}>}
   */
  async convertHtmlToMarkdown(input, originalName) {
    try {
      console.log(`🌐 [HTMLConverter] Starting HTML conversion for: ${originalName}`);
      
      // Validate input
      if (!input) {
        console.error(`❌ [HTMLConverter] Invalid input: input is ${input === null ? 'null' : 'undefined'}`);
        throw new Error('Invalid input: HTML data is missing');
      }
      
      // Check if input is a Buffer or string
      if (!Buffer.isBuffer(input) && typeof input !== 'string') {
        console.error(`❌ [HTMLConverter] Invalid input type: ${typeof input}`);
        throw new Error(`Invalid input: Expected buffer or string, got ${typeof input}`);
      }
      
      // Convert string to Buffer if needed
      if (typeof input === 'string') {
        console.log('📝 [HTMLConverter] Converting string to Buffer');
        input = Buffer.from(input, 'utf-8');
      }
      
      console.log(`📊 [HTMLConverter] Input validation passed: ${Buffer.isBuffer(input) ? 'Buffer' : 'String'} of ${input.length} bytes/characters`);
      
      // Call the backend converter
      const result = await this.executeMethod('convert', [
        input, 
        originalName || 'document.html',
        { includeImages: true }
      ]);
      
      // Validate the result
      if (!result || !result.content || result.content.trim() === '') {
        console.error(`❌ [HTMLConverter] Empty conversion result`);
        throw new Error('HTML conversion produced empty content');
      }
      
      console.log(`✅ [HTMLConverter] Conversion successful:`, {
        contentLength: result.content.length,
        hasImages: Array.isArray(result.images),
        imageCount: Array.isArray(result.images) ? result.images.length : 0
      });
      
      return result;
    } catch (error) {
      console.error(`❌ [HTMLConverter] Conversion failed:`, error);
      throw new Error(`HTML conversion failed: ${error.message}`);
    }
  }
}

// Create and export a singleton instance
const htmlConverterAdapter = new HtmlConverterAdapter();

module.exports = {
  convertHtmlToMarkdown: (...args) => htmlConverterAdapter.convertHtmlToMarkdown(...args),
  htmlConverterAdapter
};
