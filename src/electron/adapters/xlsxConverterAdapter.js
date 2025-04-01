/**
 * XLSX Converter Adapter
 *
 * Adapter for the XLSX to Markdown converter that bridges between Electron and backend.
 * Handles conversion of Excel spreadsheets to Markdown format.
 *
 * Related files:
 * - backend/src/services/converter/data/xlsxConverter.js: Original implementation
 * - src/electron/services/ElectronConversionService.js: Service using this adapter
 * - src/electron/adapters/conversionServiceAdapter.js: Main conversion adapter
 */

const BaseModuleAdapter = require('./BaseModuleAdapter');
const PageMarkerService = require('../services/PageMarkerService');

// Create the XLSX converter adapter
class XlsxConverterAdapter extends BaseModuleAdapter {
  constructor() {
    super(
      'src/services/converter/data/xlsxConverter.js',
      null, // No default export
      {
        convertXlsxToMarkdown: true // Named export
      },
      false // Don't validate default export
    );
  }

  /**
   * Convert XLSX to Markdown
   * @param {Buffer} input - The XLSX file content as a buffer
   * @param {string} originalName - Original filename
   * @param {string} [apiKey] - API key (not used for XLSX conversion)
   * @returns {Promise<Object>} Conversion result
   */
  async convertXlsxToMarkdown(input, originalName, apiKey) {
    try {
      console.log(`📊 [XLSXConverter] Starting XLSX conversion for: ${originalName}`);

      // Validate input
      if (!input) {
        console.error(`❌ [XLSXConverter] Invalid input: input is ${input === null ? 'null' : 'undefined'}`);
        throw new Error('Invalid input: XLSX data is missing');
      }

      // Ensure input is a buffer
      if (!Buffer.isBuffer(input)) {
        console.error(`❌ [XLSXConverter] Invalid input type: ${typeof input}, isBuffer: ${Buffer.isBuffer(input)}`);
        throw new Error(`Invalid input: Expected buffer, got ${typeof input}`);
      }

      console.log(`📊 [XLSXConverter] Input validation passed: Buffer of ${input.length} bytes`);

      // Execute the backend conversion method
      const result = await this.executeMethodFromExport('convertXlsxToMarkdown', [input, originalName, apiKey]);

      if (!result) {
        console.error(`❌ [XLSXConverter] Conversion returned null or undefined result`);
        throw new Error('XLSX conversion failed: Converter returned no result');
      }

      console.log(`✅ [XLSXConverter] Conversion returned result:`, {
        resultType: typeof result,
        hasContent: !!result.content,
        contentLength: result.content?.length || 0,
        hasImages: !!result.images,
        imageCount: result.images?.length || 0
      });

      if (!result.content || typeof result.content !== 'string' || result.content.trim() === '') {
        console.error(`❌ [XLSXConverter] Empty or invalid content in conversion result`);
        throw new Error('XLSX conversion produced empty or invalid content');
      }

      // Initialize images array if not present
      if (!result.images) {
        console.log(`ℹ️ [XLSXConverter] No images in result, initializing empty array`);
        result.images = [];
      }

      // Add page count to result
      result.pageCount = 1;

      return result;
    } catch (error) {
      console.error(`❌ [XLSXConverter] Conversion failed:`, error);
      throw new Error(`XLSX conversion failed: ${error.message}`);
    }
  }
}

// Create and export a singleton instance
const xlsxConverterAdapter = new XlsxConverterAdapter();

module.exports = {
  convertXlsxToMarkdown: (...args) => xlsxConverterAdapter.convertXlsxToMarkdown(...args),
  xlsxConverterAdapter
};