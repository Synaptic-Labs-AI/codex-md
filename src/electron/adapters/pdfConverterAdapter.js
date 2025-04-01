/**
 * PDF Converter Adapter
 * 
 * Adapts the PDF converter implementations for use in the Electron main process.
 * Uses the BaseModuleAdapter for consistent module loading and error handling.
 * Supports both standard Poppler-based conversion and advanced OCR processing.
 * 
 * Related files:
 * - backend/src/services/converter/pdf/PdfConverterFactory.js: Main implementation
 * - backend/src/services/converter/pdf/BasePdfConverter.js: Base converter
 * - backend/src/services/converter/pdf/StandardPdfConverter.js: Default converter
 * - backend/src/services/converter/pdf/MistralPdfConverter.js: OCR converter
 * - src/electron/services/PageMarkerService.js: Service for adding page markers
 * - src/electron/services/ApiKeyService.js: Service for managing API keys
 */

const BaseModuleAdapter = require('./BaseModuleAdapter');
const PageMarkerService = require('../services/PageMarkerService');
const ApiKeyService = require('../services/ApiKeyService');
const { createStore } = require('../utils/storeFactory');

// Initialize settings store as singleton
const settingsStore = createStore('settings', {
  encryptionKey: process.env.STORE_ENCRYPTION_KEY
});

// Create the PDF converter adapter
class PdfConverterAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      'src/services/converter/pdf/PdfConverterFactory.js',
      'default'
    );
  }

  /**
   * Check if OCR is enabled in settings
   * @returns {Promise<boolean>}
   */
  async isOcrEnabled() {
    try {
      const DEFAULT_SETTINGS = {
        ocr: {
          enabled: false
        }
      };
      
      const ocr = settingsStore.get('ocr', DEFAULT_SETTINGS.ocr);
      console.log('🔧 Store loaded successfully, checking OCR setting');
      const ocrEnabled = ocr?.enabled === true;

      console.log(`🔍 Checking OCR status:`, {
        enabled: ocrEnabled,
        type: typeof ocrEnabled,
        ocrConfig: ocr
      });
      
      return ocrEnabled;
    } catch (error) {
      console.error(`❌ Error checking OCR setting:`, {
        error: error.message,
        stack: error.stack,
        errorType: error.constructor.name
      });
      return false;
    }
  }

  /**
   * Get Mistral API key from ApiKeyService
   * @returns {Promise<string|null>}
   */
  async getMistralApiKey() {
    try {
      console.log('🔑 Attempting to get Mistral API key');
      const apiKey = ApiKeyService.getApiKey('mistral');
      
      console.log('🔑 Mistral API key status:', {
        exists: !!apiKey,
        length: apiKey ? apiKey.length : 0
      });
      
      return apiKey || null;
    } catch (error) {
      console.error(`❌ Error getting Mistral API key:`, {
        error: error.message,
        stack: error.stack
      });
      return null;
    }
  }
  
  /**
   * Validate PDF input
   * @param {Buffer} input - PDF file buffer
   * @returns {Promise<boolean>}
   */
  async validatePdfInput(input) {
    console.log(`🔍 Validating PDF input`);
    try {
      // Get any converter to validate input (they all inherit from base)
      const { useOcr } = await this.isOcrEnabled();
      const result = await this.executeMethod('convertPdfToMarkdown', [
        input,
        'validation-check.pdf',
        { useOcr }
      ]);
      console.log(`✅ Validation result: ${result}`);
      return true;
    } catch (error) {
      console.error(`❌ Validation failed:`, error);
      throw new Error(`PDF validation failed: ${error.message}`);
    }
  }

  /**
   * Convert PDF to Markdown with appropriate converter
   * @param {Buffer} input - PDF file buffer
   * @param {string} originalName - Original filename
   * @param {string} [apiKey] - Optional API key (used if provided, otherwise fetched from ApiKeyService)
   * @returns {Promise<{content: string, images: Array, pageCount: number}>}
   */
  async convertPdfToMarkdown(input, originalName, apiKey) {
    console.log(`🔍 Starting PDF conversion for: ${originalName}`);
    console.log(`📊 Input buffer stats:`, {
      isBuffer: Buffer.isBuffer(input),
      length: input ? input.length : 'null',
      firstBytes: input && Buffer.isBuffer(input) ? input.slice(0, 20).toString('hex') : 'null'
    });
    
    // Validate that input is a buffer
    if (!Buffer.isBuffer(input)) {
      console.error(`❌ Input is not a buffer:`, {
        type: typeof input,
        isString: typeof input === 'string',
        length: input ? input.length : 'null'
      });
      throw new Error('Invalid input: PDF conversion requires a buffer');
    }
    
    // Check for PDF signature
    if (input.length >= 5) {
      const signature = input.slice(0, 5).toString();
      console.log(`🔍 File signature: ${signature}`);
      if (signature !== '%PDF-') {
        console.warn(`⚠️ File does not have PDF signature: ${signature}`);
      }
    } else {
      console.error(`❌ Input buffer too small: ${input.length} bytes`);
      throw new Error('Invalid PDF: File too small');
    }

    try {
      // Check if OCR is enabled
      console.log('🔄 Checking OCR settings...');
      const useOcr = await this.isOcrEnabled();
      
      // Get Mistral API key if OCR is enabled
      let mistralApiKey = null;
      if (useOcr) {
        mistralApiKey = apiKey || await this.getMistralApiKey();
      }
      
      console.log('📋 Conversion settings:', {
        useOcr,
        hasApiKey: !!mistralApiKey
      });

      // Convert using factory
      const result = await this.executeMethod('convertPdfToMarkdown', [
        input,
        originalName,
        {
          useOcr,
          mistralApiKey,
          preservePageInfo: true
        }
      ]);
      
      console.log(`✅ Conversion successful:`, {
        hasContent: !!result?.content,
        contentLength: result?.content?.length || 0,
        hasImages: Array.isArray(result?.images),
        imageCount: Array.isArray(result?.images) ? result.images.length : 0,
        hasPageBreaks: Array.isArray(result?.pageBreaks),
        pageBreakCount: Array.isArray(result?.pageBreaks) ? result.pageBreaks.length : 0,
        converter: result?.converter
      });
      
      // Validate the result
      if (!result || !result.content || result.content.trim() === '') {
        console.error(`❌ Empty conversion result`);
        throw new Error('PDF conversion produced empty content');
      }
      
      // Add page markers using PageMarkerService if we have page breaks
      if (result.pageBreaks && result.pageBreaks.length > 0) {
        console.log(`📄 Adding page markers for ${result.pageBreaks.length} page breaks`);
        
        // Use PageMarkerService to add page markers
        result.content = PageMarkerService.insertPageMarkers(
          result.content,
          result.pageBreaks,
          'Page'
        );
      }
      
      return {
        ...result,
        pageCount: result.stats.pageCount || (result.pageBreaks?.length + 1) || 1
      };

    } catch (error) {
      console.error(`❌ Conversion failed:`, error);
      console.error(`🔍 Error details:`, {
        name: error.name,
        message: error.message,
        stack: error.stack
      });
      
      // Rethrow with clear message
      throw new Error(`PDF conversion failed: ${error.message}`);
    }
  }
}

// Create and export singleton instance
const pdfConverterAdapter = new PdfConverterAdapter();

module.exports = {
  convertPdfToMarkdown: (...args) => pdfConverterAdapter.convertPdfToMarkdown(...args),
  validatePdfInput: (...args) => pdfConverterAdapter.validatePdfInput(...args),
  pdfConverterAdapter
};
