/**
 * Text Converter Factory Adapter
 * 
 * Provides a unified adapter for all text converters.
 * Uses individual adapters for each converter type.
 * 
 * Related files:
 * - backend/src/services/converter/textConverterFactory.js: Original implementation
 * - src/electron/adapters/pdfConverterAdapter.js: PDF converter adapter
 * - src/electron/adapters/docxConverterAdapter.js: DOCX converter adapter
 * - src/electron/adapters/pptxConverterAdapter.js: PPTX converter adapter
 * - src/electron/adapters/audioConverterAdapter.js: Audio converter adapter
 * - src/electron/adapters/videoConverterAdapter.js: Video converter adapter
 * - src/electron/adapters/BaseModuleAdapter.js: Base adapter class
 */
const BaseModuleAdapter = require('./BaseModuleAdapter');
const { convertPdfToMarkdown } = require('./pdfConverterAdapter');
const { convertDocxToMarkdown } = require('./docxConverterAdapter');
const { convertPptxToMarkdown } = require('./pptxConverterAdapter');
const { convertHtmlToMarkdown } = require('./htmlConverterAdapter');
const { convertUrl } = require('./urlConverterAdapter');
const { convertAudioToMarkdown } = require('./audioConverterAdapter');
const { convertVideoToMarkdown } = require('./videoConverterAdapter');

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
    
    // Initialize specialized converters
    this.converters = {
      pdf: convertPdfToMarkdown,
      docx: convertDocxToMarkdown,
      pptx: convertPptxToMarkdown,
      html: convertHtmlToMarkdown,
      htm: convertHtmlToMarkdown, // Also support .htm extension
      url: convertUrl,
      audio: convertAudioToMarkdown,
      video: convertVideoToMarkdown
      // Add other converters as needed
    };
    
    console.log(`📋 [TextConverterFactory] Initialized with converters:`, Object.keys(this.converters));
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
      // Normalize type to lowercase
      const normalizedType = type.toLowerCase();
      
      // Check if we have a specialized converter for this type
      if (this.converters[normalizedType]) {
        console.log(`📦 [TextConverterFactory] Using specialized converter for ${normalizedType}`);
        
        // For PDF files
        if (normalizedType === 'pdf') {
          console.log(`🔄 [TextConverterFactory] Delegating to PDF converter`);
          const result = await this.converters.pdf(content, options.name);
          
          // Validate result
          if (!result || !result.content || result.content.trim() === '') {
            console.error(`❌ [TextConverterFactory] PDF converter returned empty content`);
            throw new Error('PDF conversion produced empty content');
          }
          
          return result;
        }
        
        // For DOCX files
        if (normalizedType === 'docx') {
          console.log(`🔄 [TextConverterFactory] Delegating to DOCX converter`);
          return await this.converters.docx(content, options.name);
        }
        
        // For PPTX files
        if (normalizedType === 'pptx') {
          console.log(`🔄 [TextConverterFactory] Delegating to PPTX converter`);
          return await this.converters.pptx(content, options.name);
        }
        
        // For HTML files
        if (normalizedType === 'html' || normalizedType === 'htm') {
          console.log(`🔄 [TextConverterFactory] Delegating to HTML converter`);
          return await this.converters.html(content, options.name);
        }
        
        // For URLs
        if (normalizedType === 'url') {
          console.log(`🔄 [TextConverterFactory] Delegating to URL converter`);
          return await this.converters.url(content, options);
        }
        
        // For audio files
        if (normalizedType === 'audio' || 
            ['mp3', 'wav', 'ogg', 'm4a', 'flac', 'mpeg', 'mpga', 'webm'].includes(normalizedType)) {
          console.log(`🔄 [TextConverterFactory] Delegating to Audio converter`);
          return await this.converters.audio(content, options.name);
        }
        
        // For video files
        if (normalizedType === 'video' || 
            ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(normalizedType)) {
          console.log(`🔄 [TextConverterFactory] Delegating to Video converter`);
          return await this.converters.video(content, options.name);
        }
      }
      
      // For other types, use the factory from the backend
      console.log(`📦 [TextConverterFactory] Using backend factory for ${normalizedType}`);
      return await this.executeMethod('convertToMarkdown', [normalizedType, content, options]);
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
