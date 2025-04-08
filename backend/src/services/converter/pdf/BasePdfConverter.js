// services/converter/pdf/BasePdfConverter.js

import crypto from 'crypto';

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
   * Validates and formats the image extension
   * @protected
   * @param {string} ext - File extension to validate
   * @returns {string} Cleaned extension
   */
  validateImageExtension(ext) {
    if (!ext) return '';
    // Remove leading dots and convert to lowercase
    ext = ext.toLowerCase().replace(/^\.+/, '');
    // Return valid image extensions only
    return ['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext) ? ext : '';
  }

  /**
   * Generates unique image name using UUID
   * @protected
   * @param {string} baseName - Base name of the document
   * @param {number} pageIndex - Page number where image appears
   * @param {string} ext - Image file extension
   * @returns {string} Generated unique image path
   */
  generateUniqueImageName(baseName, pageIndex, ext) {
    const uuid = crypto.randomBytes(4).toString('hex');
    return this.generateImagePath(baseName, pageIndex, uuid, ext);
  }

  /**
   * Generates standardized image path for Obsidian
   * @protected
   * @param {string} baseName - Base name of the document
   * @param {number} pageIndex - Page number where image appears
   * @param {string} uuid - Unique identifier for the image
   * @param {string} ext - Image file extension
   * @returns {string} Standardized image path
   */
  generateImagePath(baseName, pageIndex, uuid, ext) {
    // Remove any temp_ prefix from basename
    baseName = baseName.replace(/^temp_\d+_/, '');
    
    // Clean the extension
    const cleanExt = this.validateImageExtension(ext);
    if (!cleanExt) {
      throw new Error('Invalid image extension');
    }

    // Generate standard image name with UUID
    const imageName = `${baseName}-p${pageIndex + 1}-${uuid}.${cleanExt}`;
    
    // Use document-specific images folder for better organization
    // Format: "filename - images/filename-p1-uuid.ext"
    return `${baseName} - images/${imageName}`;
  }

  /**
   * Generates Obsidian-style image markdown
   * @protected
   * @param {string} imagePath - Path to the image
   * @returns {string} Obsidian markdown for image
   */
  generateImageMarkdown(imagePath) {
    return `![[${imagePath}]]`;
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
           typeof img.type === 'string';
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

      // Note: We previously checked for a binary marker here, but removed it
      // as it was causing false positives with valid PDFs and affecting OCR selection

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
   * Creates metadata object for the PDF
   * @protected
   * @param {string} baseName - Base filename
   * @param {number} imageCount - Number of extracted images
   * @param {number} pageCount - Number of pages
   * @returns {Object} Metadata object
   */
  createMetadata(baseName, imageCount, pageCount) {
    // Remove temp_ prefix from title if present
    let cleanTitle = baseName;
    if (cleanTitle.startsWith('temp_')) {
      // Extract original filename by removing 'temp_timestamp_' prefix
      cleanTitle = cleanTitle.replace(/^temp_\d+_/, '');
    }
    
    return {
      title: cleanTitle,
      created: new Date().toISOString(),
      source: baseName,
      type: 'pdf',
      image_count: imageCount,
      page_count: pageCount
    };
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
