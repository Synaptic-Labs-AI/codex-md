// services/converter/pdf/BasePdfConverter.js

/**
 * Abstract base class for PDF converters
 * Defines common functionality and interface for PDF conversion implementations
 * 
 * Related files:
 * - StandardPdfConverter.js: Default implementation using poppler
 * - MistralPdfConverter.js: Advanced OCR implementation using Mistral API
 */
export class BasePdfConverter {
  constructor() {
    if (this.constructor === BasePdfConverter) {
      throw new Error('BasePdfConverter is abstract and cannot be instantiated directly');
    }
  }

  /**
   * Validates image object structure
   * @protected
   * @param {Object} img - Image object to validate
   * @returns {boolean} True if valid
   */
  validateImageObject(img) {
    return img && 
           typeof img.name === 'string' &&
           (typeof img.data === 'string' || Buffer.isBuffer(img.data)) &&
           typeof img.type === 'string' &&
           typeof img.path === 'string';
  }

  /**
   * Safely truncates base64 strings for logging
   * @protected
   * @param {string} base64str - Base64 string to truncate
   * @param {number} maxLength - Maximum length before truncation
   * @returns {string} Truncated string
   */
  truncateBase64(base64str, maxLength = 50) {
    if (typeof base64str !== 'string') return 'NOT_BASE64';
    return base64str.length > maxLength 
      ? `${base64str.substring(0, maxLength)}... [${base64str.length} chars total]`
      : base64str;
  }

  /**
   * Validates PDF input buffer
   * @param {Buffer} input - PDF file buffer to validate
   * @returns {boolean} True if valid
   * @throws {Error} If validation fails
   */
  validatePdfInput(input) {
    try {
      if (!input || !Buffer.isBuffer(input)) {
        throw new Error('Invalid input: Expected a buffer');
      }

      // Check minimum size
      if (input.length < 1024) {
        throw new Error('Invalid PDF: File too small');
      }

      // Check PDF signature at start (%PDF-)
      const header = input.slice(0, 5).toString('ascii');
      if (header !== '%PDF-') {
        throw new Error('Invalid PDF format: Missing PDF header');
      }

      // Check for binary content marker after header
      const binaryMarker = input.slice(5, 8);
      if (!binaryMarker.includes(0x80)) {
        console.warn('PDF may be corrupted: Missing binary marker');
      }

      // Look for EOF marker
      const trailer = input.slice(-1024).toString('ascii');
      if (!trailer.includes('%%EOF')) {
        throw new Error('Invalid PDF format: Missing EOF marker');
      }

      return true;
    } catch (error) {
      console.error('PDF validation failed:', error);
      throw error;
    }
  }

  /**
   * Creates frontmatter for markdown output
   * @protected
   * @param {string} baseName - Base filename
   * @param {number} imageCount - Number of extracted images
   * @param {number} pageCount - Number of pages
   * @returns {string} Formatted frontmatter
   */
  createFrontmatter(baseName, imageCount, pageCount) {
    // Remove temp_ prefix from title if present
    let cleanTitle = baseName;
    if (cleanTitle.startsWith('temp_')) {
      // Extract original filename by removing 'temp_timestamp_' prefix
      cleanTitle = cleanTitle.replace(/^temp_\d+_/, '');
    }
    
    return [
      '---',
      `title: ${cleanTitle}`,
      `created: ${new Date().toISOString()}`,
      `source: ${baseName}`,
      `type: pdf`,
      `image_count: ${imageCount}`,
      `page_count: ${pageCount}`,
      '---',
      ''
    ].join('\n');
  }

  /**
   * Main conversion method - must be implemented by subclasses
   * @abstract
   * @param {Buffer} input - PDF file buffer
   * @param {string} originalName - Original filename
   * @param {string} [apiKey] - Optional API key for services that require it
   * @param {Object} [options] - Conversion options
   * @returns {Promise<{content: string, images: Array, pageBreaks: Array}>}
   */
  async convertPdfToMarkdown(input, originalName, apiKey, options = {}) {
    throw new Error('Method convertPdfToMarkdown() must be implemented by subclass');
  }

  /**
   * Extract images from PDF - must be implemented by subclasses
   * @abstract
   * @protected
   */
  async extractImages(pdfPath, originalName) {
    throw new Error('Method extractImages() must be implemented by subclass');
  }

  /**
   * Extract text from PDF - must be implemented by subclasses
   * @abstract
   * @protected
   */
  async extractText(pdfPath, preservePageInfo = false) {
    throw new Error('Method extractText() must be implemented by subclass');
  }
}

export default BasePdfConverter;
