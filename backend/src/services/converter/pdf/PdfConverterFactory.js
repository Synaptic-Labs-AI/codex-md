// services/converter/pdf/PdfConverterFactory.js

import StandardPdfConverter from './StandardPdfConverter.js';
import MistralPdfConverter from './MistralPdfConverter.js';

/**
 * Factory class for creating appropriate PDF converter instances
 * Handles choosing between standard and OCR-based conversion
 * 
 * Related files:
 * - BasePdfConverter.js: Abstract base class
 * - StandardPdfConverter.js: Default JavaScript implementation using pdf-parse
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

    // If OCR is enabled, check for Mistral API key
    if (useOcr) {
      if (mistralApiKey) {
        console.log('🔄 Using Mistral OCR converter');
        console.log('🔑 Mistral API key is present and OCR is enabled');
        return new MistralPdfConverter();
      } else {
        console.warn('⚠️ OCR is enabled but no Mistral API key provided. Falling back to standard converter.');
        console.warn('⚠️ To use OCR, please add a Mistral API key in Settings.');
      }
    }

    // Default to standard converter
    console.log('🔄 Using standard PDF converter');
    if (useOcr) {
      console.log('ℹ️ OCR setting: enabled=' + useOcr + ', mistralApiKey=' + (mistralApiKey ? 'present' : 'missing'));
    }
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
    const converter = PdfConverterFactory.getConverter(options);
    
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
      
      // Check for API key related errors
      const errorMessage = error.message || '';
      const isAuthError = 
        errorMessage.includes('Unauthorized') || 
        errorMessage.includes('401') || 
        errorMessage.includes('API key');
      
      // If it's an auth error, provide a more helpful message
      if (isAuthError && options.useOcr && converter instanceof MistralPdfConverter) {
        console.warn('⚠️ OCR failed due to API key issue. Please check your Mistral API key in Settings.');
      }
      
      // If OCR fails, try falling back to standard conversion
      if (options.useOcr && converter instanceof MistralPdfConverter) {
        console.log('⚠️ OCR failed, falling back to standard conversion');
        // Use the static method to get a standard converter for consistency
        const standardConverter = new StandardPdfConverter();
        console.log('🔄 Using standard PDF converter as fallback');
        
        try {
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
            ocrFallback: true,
            ocrError: errorMessage
          };
        } catch (fallbackError) {
          console.error('Standard conversion also failed:', fallbackError);
          throw new Error(`PDF conversion failed: ${fallbackError.message}. Original OCR error: ${errorMessage}`);
        }
      }
      
      throw error;
    }
  }
}

export default PdfConverterFactory;
