// services/converter/ConverterRegistry.js

/**
 * Central registry for all file type converters
 * Provides a standardized interface and validation for all converters
 * Handles converter selection and validation
 * 
 * This registry consolidates all converter management in one place:
 * - Document converters (PDF, DOCX, PPTX)
 * - Web content converters (URL, parent URL)
 * - Data converters (CSV, XLSX)
 * - Media converters (Audio, Video)
 *
 * All converters must implement the standard interface:
 * {
 *   convert: async (content, name, apiKey, options) => Result,
 *   validate: (content) => boolean,
 *   config: {
 *     name: string,
 *     extensions: string[],
 *     mimeTypes: string[],
 *     maxSize: number
 *   }
 * }
 * 
 * Related files:
 * - pdf/PdfConverterFactory.js: PDF converter implementation
 * - text/docxConverter.js: DOCX converter implementation
 * - text/pptxConverter.js: PPTX converter implementation 
 * - web/urlConverter.js: URL converter implementation
 * - web/parentUrlConverter.js: Parent URL converter implementation
 * - data/{csv,xlsx}Converter.js: Data converters implementation
 */

import pdfConverter from './pdf/PdfConverterFactory.js';
import docxConverter from './text/docxConverter.js';
import pptxConverter from './text/pptxConverter.js';
import * as xlsxConverter from './data/xlsxConverter.js';
import * as csvConverter from './data/csvConverter.js';
import * as urlConverter from './web/urlConverter.js';
import * as parentUrlConverter from './web/parentUrlConverter.js';

const converters = {
  // Web Content
  url: {
    convert: urlConverter.urlConverter.convert,
    validate: (input) => typeof input === 'string' && input.length > 0,
    config: {
      name: 'Web Page',
      extensions: ['.url', '.html', '.htm'],
      mimeTypes: ['text/html', 'application/x-url'],
      maxSize: 10 * 1024 * 1024 // 10MB
    }
  },

  parenturl: {
    convert: parentUrlConverter.convertToMarkdown,
    validate: (input) => typeof input === 'string' && input.length > 0,
    config: {
      name: 'Website',
      extensions: ['.url', '.html', '.htm'],
      mimeTypes: ['text/html', 'application/x-url'],
      maxSize: 10 * 1024 * 1024 // 10MB
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

  // PowerPoint Presentations
  pptx: {
    convert: pptxConverter.convert,
    validate: (input) => Buffer.isBuffer(input) && input.length > 0,
    config: {
      name: 'PowerPoint Presentation',
      extensions: ['.pptx', '.ppt'],
      mimeTypes: [
        'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        'application/vnd.ms-powerpoint'
      ],
      maxSize: 50 * 1024 * 1024, // 50MB
    }
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
 * Validate that a converter implements the required interface
 * @param {string} type Converter type
 * @param {Object} converter Converter to validate
 * @returns {boolean} Whether the converter is valid
 */
function validateConverter(type, converter) {
  try {
    // Check for required methods
    if (typeof converter.convert !== 'function') {
      console.error(`Converter ${type} missing required 'convert' method`);
      return false;
    }

    if (typeof converter.validate !== 'function') {
      console.error(`Converter ${type} missing required 'validate' method`);
      return false;
    }

    // Check for required config properties
    const config = converter.config;
    if (!config) {
      console.error(`Converter ${type} missing required 'config' object`);
      return false;
    }

    const requiredConfig = ['name', 'extensions', 'mimeTypes', 'maxSize'];
    for (const prop of requiredConfig) {
      if (!config[prop]) {
        console.error(`Converter ${type} missing required config property: ${prop}`);
        return false;
      }
    }

    // Validate specific config properties
    if (!Array.isArray(config.extensions)) {
      console.error(`Converter ${type} 'extensions' must be an array`);
      return false;
    }

    if (!Array.isArray(config.mimeTypes)) {
      console.error(`Converter ${type} 'mimeTypes' must be an array`);
      return false;
    }

    if (typeof config.maxSize !== 'number' || config.maxSize <= 0) {
      console.error(`Converter ${type} 'maxSize' must be a positive number`);
      return false;
    }

    return true;
  } catch (error) {
    console.error(`Error validating converter ${type}:`, error);
    return false;
  }
}

/**
 * Get converter for a specific file extension
 * @param {string} extension File extension (with or without dot)
 * @returns {Object|null} Converter object or null if not found
 */
function getConverterByExtension(extension) {
  try {
    if (!extension) {
      console.warn('No extension provided to getConverterByExtension');
      return null;
    }

    // Normalize extension (remove dot and lowercase)
    const normalizedExt = extension.toLowerCase().replace(/^\./, '');
    
    // Handle URL and parent URL types directly
    if (['url', 'parenturl'].includes(normalizedExt)) {
      const converter = converters[normalizedExt];
      if (converter) {
        if (!validateConverter(normalizedExt, converter)) {
          console.warn(`URL converter ${normalizedExt} failed validation, may not work correctly`);
        }
        return {
          type: normalizedExt,
          ...converter
        };
      }
    }

    // For other types, ensure we have a dot for extension matching
    const ext = `.${normalizedExt}`;
    
    // Find first converter that supports this extension
    const [type, converter] = Object.entries(converters).find(
      ([_, c]) => c?.config?.extensions?.includes(ext)
    ) || [];
    
    if (converter) {
      if (!validateConverter(type, converter)) {
        console.warn(`Converter ${type} failed validation, may not work correctly`);
      }
      return {
        type,
        ...converter,
        // Add fallback for convert method to ensure consistent error handling
        convert: async (...args) => {
          try {
            const result = await converter.convert(...args);
            return {
              success: true,
              ...result
            };
          } catch (error) {
            console.error(`Converter ${type} failed:`, error);
            return {
              success: false,
              error: error.message,
              type,
              content: `# Conversion Error\n\nFailed to convert file: ${error.message}`
            };
          }
        }
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
  try {
    if (!mimeType) {
      console.warn('No mime type provided to getConverterByMimeType');
      return null;
    }

    // Normalize mime type
    const normalizedMimeType = mimeType.toLowerCase();
    
    // Find first converter that supports this mime type
    const [type, converter] = Object.entries(converters).find(
      ([_, c]) => c.config.mimeTypes.includes(normalizedMimeType)
    ) || [];
    
    if (converter) {
      if (!validateConverter(type, converter)) {
        console.warn(`Converter ${type} failed validation, may not work correctly`);
      }
      return {
        type,
        ...converter,
        // Add fallback for convert method to ensure consistent error handling
        convert: async (...args) => {
          try {
            const result = await converter.convert(...args);
            return {
              success: true,
              ...result
            };
          } catch (error) {
            console.error(`Converter ${type} failed:`, error);
            return {
              success: false,
              error: error.message,
              type,
              content: `# Conversion Error\n\nFailed to convert file: ${error.message}`
            };
          }
        }
      };
    }
    
    console.warn(`No converter found for mime type: ${mimeType}`);
    return null;
  } catch (error) {
    console.error(`Error in getConverterByMimeType for ${mimeType}:`, error);
    return null;
  }
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
  try {
    // Start conversion time tracking
    const startTime = Date.now();
    
    // Input validation
    if (!type) {
      throw new Error('No type provided for conversion');
    }
    
    if (!content) {
      throw new Error('No content provided for conversion');
    }

    // Normalize the type (remove dot if present, lowercase)
    const normalizedType = type.toLowerCase().replace(/^\./, '');
    
    // Get the appropriate converter
    let converter;
    
    console.log(`🔄 Starting conversion for type: ${normalizedType}`);
    
    // First check if we have a direct converter for this type
    if (converters[normalizedType]) {
      converter = converters[normalizedType];
      if (!validateConverter(normalizedType, converter)) {
        console.warn(`Direct converter ${normalizedType} failed validation, attempting fallback`);
      }
    }
    
    // If no direct converter or validation failed, try by extension
    if (!converter) {
      converter = getConverterByExtension(normalizedType);
    }
    
    // If still not found, try by mime type if provided
    if (!converter && options.mimeType) {
      console.log(`Attempting to find converter by mime type: ${options.mimeType}`);
      converter = getConverterByMimeType(options.mimeType);
    }
    
    if (!converter) {
      throw new Error(`No converter available for type: ${type}`);
    }
    
    // Validate the input
    if (converter.validate && !converter.validate(content)) {
      throw new Error(`Invalid content for ${type} conversion`);
    }
    
    // Convert the content with timeout and error handling
    console.log(`Converting content using ${converter.config.name}`);
    
    const conversionPromise = converter.convert(content, options.name, options.apiKey, options);
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Conversion timed out')), 30000); // 30 second timeout
    });
    
    const result = await Promise.race([conversionPromise, timeoutPromise]);
    
    // Ensure result has all required properties
    const standardizedResult = {
      success: true,
      content: result.content || '',
      type: normalizedType,
      name: options.name || 'Untitled',
      metadata: {
        ...result.metadata,
        conversionTime: Date.now() - startTime,
        converter: converter.config.name
      },
      images: result.images || [],
      ...result
    };
    
    console.log(`✅ Conversion completed in ${standardizedResult.metadata.conversionTime}ms`);
    
    return standardizedResult;
    
  } catch (error) {
    // Log the error for debugging
    console.error(`❌ Conversion failed for type ${type}:`, error);
    
    // Return a standardized error response
    return {
      success: false,
      error: error.message,
      type: type,
      content: `# Conversion Error\n\nFailed to convert file: ${error.message}`,
      metadata: {
        error: true,
        errorType: error.name,
        errorMessage: error.message
      }
    };
  }
}

// Export the registry as a default export and as named exports
export const ConverterRegistry = {
  getConverterByExtension,
  getConverterByMimeType,
  getSupportedExtensions,
  getSupportedMimeTypes,
  convertToMarkdown,
  converters,
  validateConverter
};

// Add legacy export for backward compatibility
export const textConverterFactory = ConverterRegistry;

export default ConverterRegistry;
