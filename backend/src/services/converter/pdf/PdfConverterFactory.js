// services/converter/pdf/PdfConverterFactory.js

import StandardPdfConverter from './StandardPdfConverter.js';
import MistralPdfConverter from './MistralPdfConverter.js';

/**
 * Factory class for creating appropriate PDF converter instances
 * Handles choosing between standard and OCR-based conversion
 * 
 * Related files:
 * - BasePdfConverter.js: Abstract base class
 * - StandardPdfConverter.js: Default poppler implementation
 * - MistralPdfConverter.js: OCR implementation
 */
export class PdfConverterFactory {
  /**
   * Get appropriate PDF converter based on settings and context
   * @param {Object} options Configuration options
   * @param {boolean} options.useOcr Whether to use OCR processing
   * @param {string} [options.mistralApiKey] Mistral API key for OCR
   * @returns {BasePdfConverter} Appropriate converter instance
   */
  static getConverter(options = {}) {
    const { useOcr, mistralApiKey } = options;

    // If OCR is enabled and API key is provided, use Mistral converter
    if (useOcr && mistralApiKey) {
      console.log('🔄 Using Mistral OCR converter');
      return new MistralPdfConverter();
    }

    // Default to standard converter
    console.log('🔄 Using standard PDF converter');
    return new StandardPdfConverter();
  }

  /**
   * Create a converter instance and process PDF
   * @param {Buffer} input PDF file buffer
   * @param {string} originalName Original filename 
   * @param {Object} options Conversion options
   * @param {boolean} [options.useOcr=false] Whether to use OCR
   * @param {string} [options.mistralApiKey] Mistral API key
   * @param {boolean} [options.preservePageInfo=false] Whether to preserve page information
   * @returns {Promise<Object>} Conversion result
   */
  static async convertPdfToMarkdown(input, originalName, options = {}) {
    const converter = this.getConverter(options);
    
    try {
      // Pass apiKey and conversion options to converter
      const result = await converter.convertPdfToMarkdown(
        input, 
        originalName,
        options.mistralApiKey,
        {
          preservePageInfo: options.preservePageInfo
        }
      );

      return {
        ...result,
        converter: converter.config.name
      };
    } catch (error) {
      console.error(`PDF conversion failed with ${converter.config.name}:`, error);
      
      // If OCR fails, try falling back to standard conversion
      if (options.useOcr && converter instanceof MistralPdfConverter) {
        console.log('⚠️ OCR failed, falling back to standard conversion');
        const standardConverter = new StandardPdfConverter();
        
        const fallbackResult = await standardConverter.convertPdfToMarkdown(
          input,
          originalName,
          null,
          {
            preservePageInfo: options.preservePageInfo
          }
        );

        return {
          ...fallbackResult,
          converter: standardConverter.config.name,
          ocrFallback: true
        };
      }
      
      throw error;
    }
  }
}

export default PdfConverterFactory;
