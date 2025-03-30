/**
 * PPTX Converter Adapter
 * 
 * Adapts the backend PPTX converter for use in the Electron main process.
 * Uses the BaseModuleAdapter for consistent module loading and error handling.
 * Adds slide number markers to the converted content.
 * 
 * Related files:
 * - backend/src/services/converter/text/pptxConverter.js: Original implementation
 * - src/electron/services/ElectronConversionService.js: Service using this adapter
 * - src/electron/adapters/BaseModuleAdapter.js: Base adapter class
 * - src/electron/services/PageMarkerService.js: Service for adding slide markers
 */
const BaseModuleAdapter = require('./BaseModuleAdapter');
const PageMarkerService = require('../services/PageMarkerService');

// Create the PPTX converter adapter
class PptxConverterAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      'src/services/converter/text/pptxConverter.js',
      'default'
    );
  }
  
  /**
   * Convert PPTX to Markdown with slide markers
   * @param {Buffer} input - PPTX file buffer
   * @param {string} originalName - Original filename
   * @param {string} [apiKey] - Optional API key
   * @returns {Promise<{content: string, images: Array, slideCount: number}>}
   */
  async convertPptxToMarkdown(input, originalName, apiKey) {
    try {
      console.log(`🔄 [PPTXConverter] Starting PPTX conversion for: ${originalName}`);
      
      // Call the backend converter
      const result = await this.executeMethod('convert', [
        input, 
        originalName,
        apiKey
      ]);
      
      console.log(`✅ [PPTXConverter] Conversion successful:`, {
        hasContent: !!result?.content,
        contentLength: result?.content?.length || 0,
        hasImages: Array.isArray(result?.images),
        imageCount: Array.isArray(result?.images) ? result.images.length : 0
      });
      
      // Validate the result
      if (!result || !result.content || result.content.trim() === '') {
        console.error(`❌ [PPTXConverter] Empty conversion result`);
        throw new Error('PPTX conversion produced empty content');
      }
      
      // Extract slide count from the content
      // The backend already formats with "## Slide X" headers
      const slideMatches = result.content.match(/## Slide \d+/g) || [];
      const slideCount = slideMatches.length;
      
      // Add slide count to the result
      result.slideCount = slideCount;
      
      console.log(`📊 [PPTXConverter] Presentation has ${slideCount} slides`);
      
      // Create slide breaks for PageMarkerService
      // We'll extract positions where slide markers should be inserted
      const slideBreaks = [];
      
      // We need to find positions for slide breaks
      // Since the content already has "## Slide X" headers, we'll use those positions
      let content = result.content;
      let slideRegex = /## Slide (\d+)/g;
      let match;
      
      while ((match = slideRegex.exec(content)) !== null) {
        const slideNumber = parseInt(match[1]);
        const position = match.index;
        
        // Add to slideBreaks array
        slideBreaks.push({
          pageNumber: slideNumber, // PageMarkerService uses pageNumber
          position: position
        });
      }
      
      // Keep the original slide headers (## Slide X) from the backend converter
      // We're not replacing them with PageMarkerService markers to avoid duplication
      console.log(`📊 [PPTXConverter] Keeping original ${slideBreaks.length} slide headers`);
      
      return result;
    } catch (error) {
      console.error(`❌ [PPTXConverter] Conversion failed:`, error);
      throw new Error(`PPTX conversion failed: ${error.message}`);
    }
  }
}

// Create and export a singleton instance
const pptxConverterAdapter = new PptxConverterAdapter();

module.exports = {
  convertPptxToMarkdown: (...args) => pptxConverterAdapter.convertPptxToMarkdown(...args),
  pptxConverterAdapter
};
