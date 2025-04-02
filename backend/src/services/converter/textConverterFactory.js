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
import * as xlsxConverter from './data/xlsxConverter.js';
import * as csvConverter from './data/csvConverter.js';
import * as urlConverter from './web/urlConverter.js';
import * as parentUrlConverter from './web/parentUrlConverter.js';

const converters = {
  // Web Content
  url: {
    convert: urlConverter.convertToMarkdown,
    validate: (input) => typeof input === 'string' && input.length > 0,
    config: {
      name: 'Web Page',
      extensions: ['.url', '.html', '.htm'],
      mimeTypes: ['text/html', 'application/x-url']
    }
  },

  parenturl: {
    convert: parentUrlConverter.convertToMarkdown,
    validate: (input) => typeof input === 'string' && input.length > 0,
    config: {
      name: 'Website',
      extensions: ['.url', '.html', '.htm'],
      mimeTypes: ['text/html', 'application/x-url']
    }
  },

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

  // Excel Spreadsheets
  xlsx: {
    convert: xlsxConverter.convertXlsxToMarkdown,
    validate: (input) => {
      return Buffer.isBuffer(input) && input.length > 0;
    },
    config: {
      name: 'Excel Spreadsheet',
      extensions: ['.xlsx', '.xls'],
      mimeTypes: [
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'application/vnd.ms-excel'
      ],
      maxSize: 50 * 1024 * 1024, // 50MB
    }
  },

  // CSV Spreadsheets
  csv: {
    convert: csvConverter.convertCsvToMarkdown,
    validate: (input) => {
      return (Buffer.isBuffer(input) || typeof input === 'string') && input.length > 0;
    },
    config: {
      name: 'CSV Spreadsheet',
      extensions: ['.csv'],
      mimeTypes: [
        'text/csv',
        'application/csv',
        'text/comma-separated-values',
        'application/vnd.ms-excel'
      ],
      maxSize: 50 * 1024 * 1024, // 50MB
    }
  },
};

/**
 * Get converter for a specific file extension
 * @param {string} extension File extension (with or without dot)
 * @returns {Object|null} Converter object or null if not found
 */
function getConverterByExtension(extension) {
  try {
    // Handle URL and parent URL types directly
    if (['url', 'parenturl'].includes(extension.toLowerCase())) {
      const converter = converters[extension.toLowerCase()];
      if (converter) {
        return {
          type: extension.toLowerCase(),
          ...converter
        };
      }
    }

    // Normalize extension (ensure it has a dot)
    const ext = extension.startsWith('.') ? extension : `.${extension}`;
    
    // Find first converter that supports this extension
    const [type, converter] = Object.entries(converters).find(
      ([_, c]) => c?.config?.extensions?.includes(ext.toLowerCase())
    ) || [];
    
    if (converter) {
      return {
        type,
        ...converter
      };
    }

    console.warn(`No converter found for extension: ${extension}`);
    return null;
  } catch (error) {
    console.error(`Error in getConverterByExtension for ${extension}:`, error);
    return null;
  }
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

/**
 * Convert content to Markdown based on type
 * @param {string} type - The type of content (file extension without dot, or special type like 'url')
 * @param {Buffer|string} content - The content to convert
 * @param {Object} options - Conversion options including name, apiKey, etc.
 * @returns {Promise<Object>} - Converted content with images if any
 */
async function convertToMarkdown(type, content, options = {}) {
  // Normalize the type (remove dot if present, lowercase)
  const normalizedType = type.toLowerCase().replace(/^\./, '');
  
  // Get the appropriate converter
  let converter;
  
  // First check if we have a direct converter for this type
  if (converters[normalizedType]) {
    converter = converters[normalizedType];
  } else {
    // Try to find by extension
    converter = getConverterByExtension(normalizedType);
    
    // If still not found, try by mime type if provided
    if (!converter && options.mimeType) {
      converter = getConverterByMimeType(options.mimeType);
    }
  }
  
  if (!converter) {
    throw new Error(`No converter available for type: ${type}`);
  }
  
  // Validate the input
  if (converter.validate && !converter.validate(content)) {
    throw new Error(`Invalid content for ${type} conversion`);
  }
  
  // Convert the content
  const result = await converter.convert(content, options.name, options.apiKey);
  
  return result;
}

export const textConverterFactory = {
  getConverterByExtension,
  getConverterByMimeType,
  getSupportedExtensions,
  getSupportedMimeTypes,
  convertToMarkdown,
  converters
};
