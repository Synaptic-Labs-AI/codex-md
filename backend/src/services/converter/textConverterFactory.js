// services/converter/textConverterFactory.js

/**
 * Factory for creating text-based document converters (PDF, DOCX, etc.)
 * Handles selection and creation of appropriate converter based on file type
 * 
 * Related files:
 * - pdf/PdfConverterFactory.js: PDF converter implementation
 * - text/docxConverter.js: DOCX converter implementation
 */

import pdfConverter from './pdf/PdfConverterFactory.js';
import docxConverter from './text/docxConverter.js';

const converters = {
  // PDF Converter
  pdf: {
    convert: pdfConverter.convertPdfToMarkdown,
    validate: (input) => {
      const converter = pdfConverter.getConverter({});
      return converter.validatePdfInput(input);
    },
    config: {
      name: 'PDF',
      extensions: ['.pdf'],
      mimeTypes: ['application/pdf'],
      maxSize: 100 * 1024 * 1024, // 100MB
    }
  },

  // Word Documents
  docx: {
    convert: docxConverter.convert,
    validate: docxConverter.validate,
    config: docxConverter.config
  },

};

/**
 * Get converter for a specific file extension
 * @param {string} extension File extension (with or without dot)
 * @returns {Object|null} Converter object or null if not found
 */
function getConverterByExtension(extension) {
  // Normalize extension (ensure it has a dot)
  const ext = extension.startsWith('.') ? extension : `.${extension}`;
  
  // Find first converter that supports this extension
  const [type, converter] = Object.entries(converters).find(
    ([_, c]) => c.config.extensions.includes(ext.toLowerCase())
  ) || [];
  
  if (converter) {
    return {
      type,
      ...converter
    };
  }
  
  return null;
}

/**
 * Get converter for a specific mime type
 * @param {string} mimeType MIME type to match
 * @returns {Object|null} Converter object or null if not found
 */
function getConverterByMimeType(mimeType) {
  // Find first converter that supports this mime type
  const [type, converter] = Object.entries(converters).find(
    ([_, c]) => c.config.mimeTypes.includes(mimeType.toLowerCase())
  ) || [];
  
  if (converter) {
    return {
      type,
      ...converter
    };
  }
  
  return null;
}

/**
 * Get all supported file extensions
 * @returns {string[]} Array of supported extensions
 */
function getSupportedExtensions() {
  return Object.values(converters).flatMap(c => c.config.extensions);
}

/**
 * Get all supported mime types
 * @returns {string[]} Array of supported mime types
 */
function getSupportedMimeTypes() {
  return Object.values(converters).flatMap(c => c.config.mimeTypes);
}

export default {
  getConverterByExtension,
  getConverterByMimeType,
  getSupportedExtensions,
  getSupportedMimeTypes,
  converters
};
