/**
 * DOCX Converter Adapter
 * 
 * Adapts the backend DOCX converter for use in the Electron main process.
 * Uses the BaseModuleAdapter for consistent module loading and error handling.
 * Adds page number markers to the converted content.
 * 
 * Related files:
 * - backend/src/services/converter/text/docxConverter.js: Original implementation
 * - src/electron/services/ElectronConversionService.js: Service using this adapter
 * - src/electron/adapters/BaseModuleAdapter.js: Base adapter class
 * - src/electron/services/PageMarkerService.js: Service for adding page markers
 */
const BaseModuleAdapter = require('./BaseModuleAdapter');
const PageMarkerService = require('../services/PageMarkerService');

// Create the DOCX converter adapter
class DocxConverterAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      'src/services/converter/text/docxConverter.js',
      'default'
    );
  }
  
  /**
   * Convert DOCX to Markdown with page markers
   * @param {Buffer} input - DOCX file buffer
   * @param {string} originalName - Original filename
   * @returns {Promise<{content: string, images: Array, pageCount: number}>}
   */
  async convertDocxToMarkdown(input, originalName) {
    try {
      console.log(`📝 [DOCXConverter] Starting DOCX conversion for: ${originalName}`);
      
      // Validate input
      if (!input) {
        console.error(`❌ [DOCXConverter] Invalid input: input is ${input === null ? 'null' : 'undefined'}`);
        throw new Error('Invalid input: DOCX data is missing');
      }
      
      if (!Buffer.isBuffer(input)) {
        console.error(`❌ [DOCXConverter] Invalid input type: ${typeof input}, isBuffer: ${Buffer.isBuffer(input)}`);
        throw new Error(`Invalid input: Expected buffer or Uint8Array, got ${typeof input}`);
      }
      
      console.log(`📊 [DOCXConverter] Input validation passed: Buffer of ${input.length} bytes`);
      
      // Call the backend converter with a flag to preserve page information
      const result = await this.executeMethod('convert', [
        input, 
        originalName || 'document.docx',
        { preservePageInfo: true } // New option to preserve page info
      ]);
      
      // Enhanced result validation and logging
      if (!result) {
        console.error(`❌ [DOCXConverter] Conversion returned null or undefined result`);
        throw new Error('DOCX conversion failed: Converter returned no result');
      }
      
      console.log(`✅ [DOCXConverter] Conversion returned result:`, {
        resultType: typeof result,
        hasContent: !!result.content,
        contentType: typeof result.content,
        contentLength: result.content ? result.content.length : 0,
        hasImages: Array.isArray(result.images),
        imageCount: Array.isArray(result.images) ? result.images.length : 0,
        hasPageBreaks: Array.isArray(result.pageBreaks),
        pageBreakCount: Array.isArray(result.pageBreaks) ? result.pageBreaks.length : 0,
        success: !!result.success
      });
      
      // Validate the result content
      if (!result.content || typeof result.content !== 'string' || result.content.trim() === '') {
        console.error(`❌ [DOCXConverter] Empty or invalid content in conversion result`);
        throw new Error('DOCX conversion produced empty or invalid content');
      }
      
      // Ensure images array exists
      if (!result.images) {
        console.log(`ℹ️ [DOCXConverter] No images in result, initializing empty array`);
        result.images = [];
      }
      
      // Process the result to add page markers with enhanced error handling
      try {
        if (Array.isArray(result.pageBreaks) && result.pageBreaks.length > 0) {
          console.log(`📄 [DOCXConverter] Using ${result.pageBreaks.length} detected page breaks`);
          
          // Insert page markers into content
          result.content = PageMarkerService.insertPageMarkers(
            result.content, 
            result.pageBreaks
          );
          
          // Add page count to metadata
          result.pageCount = result.pageBreaks.length + 1;
          
          console.log(`📄 [DOCXConverter] Added ${result.pageCount} page markers from DOCX structure`);
        } else {
          console.log(`ℹ️ [DOCXConverter] No page breaks detected, using word-based pagination`);
          
          // Fall back to word-based pagination if no page breaks were detected
          try {
            const pageBreaks = PageMarkerService.calculateWordBasedPageBreaks(result.content);
            
            if (Array.isArray(pageBreaks) && pageBreaks.length > 0) {
              result.content = PageMarkerService.insertPageMarkers(result.content, pageBreaks);
              result.pageCount = pageBreaks.length + 1;
              console.log(`📄 [DOCXConverter] Added ${result.pageCount} word-based page markers`);
            } else {
              // Single page document
              result.pageCount = 1;
              console.log(`📄 [DOCXConverter] Document appears to be a single page`);
            }
          } catch (pageBreakError) {
            // If word-based pagination fails, just set page count to 1
            console.warn(`⚠️ [DOCXConverter] Word-based pagination failed: ${pageBreakError.message}`);
            result.pageCount = 1;
          }
        }
      } catch (pageMarkerError) {
        // If page marker insertion fails, log but continue with the conversion
        console.warn(`⚠️ [DOCXConverter] Page marker insertion failed: ${pageMarkerError.message}`);
        result.pageCount = 1;
      }
      
      return result;
    } catch (error) {
      console.error(`❌ [DOCXConverter] Conversion failed:`, error);
      throw new Error(`DOCX conversion failed: ${error.message}`);
    }
  }
}

// Create and export a singleton instance
const docxConverterAdapter = new DocxConverterAdapter();

module.exports = {
  convertDocxToMarkdown: (...args) => docxConverterAdapter.convertDocxToMarkdown(...args),
  docxConverterAdapter
};
