/**
 * Direct conversion implementations for various file types
 * 
 * This module provides a unified approach to file conversion without adapter layers.
 * It directly implements or re-exports conversion functions for different file types.
 * 
 * Related files:
 * - shared/src/utils/conversion/index.js: Exports conversion utilities
 * - shared/src/utils/files/types.js: File type detection
 * - shared/src/utils/markdown/generator.js: Markdown generation utilities
 */

// Import shared utilities
import { ERROR_TYPES, ConversionError } from './errors.js';

/**
 * Configuration for supported file types
 */
export const FILE_CONVERTERS = {
  // Document types
  pdf: {
    name: 'PDF Document',
    extensions: ['.pdf'],
    mimeTypes: ['application/pdf'],
    maxSize: 100 * 1024 * 1024, // 100MB
  },
  docx: {
    name: 'Word Document',
    extensions: ['.docx', '.doc'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/msword'
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
  },
  pptx: {
    name: 'PowerPoint Presentation',
    extensions: ['.pptx', '.ppt'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.ms-powerpoint'
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
  },
  
  // Data types
  xlsx: {
    name: 'Excel Spreadsheet',
    extensions: ['.xlsx', '.xls'],
    mimeTypes: [
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-excel'
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
  },
  csv: {
    name: 'CSV Spreadsheet',
    extensions: ['.csv'],
    mimeTypes: [
      'text/csv',
      'application/csv',
      'text/comma-separated-values',
      'application/vnd.ms-excel'
    ],
    maxSize: 50 * 1024 * 1024, // 50MB
  },
  
  // Web content
  url: {
    name: 'Web Page',
    extensions: ['.url', '.html', '.htm'],
    mimeTypes: ['text/html', 'application/x-url'],
    maxSize: 10 * 1024 * 1024, // 10MB
  },
  parenturl: {
    name: 'Website',
    extensions: ['.url', '.html', '.htm'],
    mimeTypes: ['text/html', 'application/x-url'],
    maxSize: 10 * 1024 * 1024, // 10MB
  },
  
  // Media types
  mp3: {
    name: 'MP3 Audio',
    extensions: ['.mp3'],
    mimeTypes: ['audio/mpeg'],
    maxSize: 500 * 1024 * 1024, // 500MB
  },
  wav: {
    name: 'WAV Audio',
    extensions: ['.wav'],
    mimeTypes: ['audio/wav', 'audio/x-wav'],
    maxSize: 500 * 1024 * 1024, // 500MB
  },
  mp4: {
    name: 'MP4 Video',
    extensions: ['.mp4'],
    mimeTypes: ['video/mp4'],
    maxSize: 1024 * 1024 * 1024, // 1GB
  },
  webm: {
    name: 'WebM Video',
    extensions: ['.webm'],
    mimeTypes: ['video/webm'],
    maxSize: 1024 * 1024 * 1024, // 1GB
  }
};

/**
 * Get converter configuration for a specific file extension
 * @param {string} extension File extension (with or without dot)
 * @returns {Object|null} Converter configuration or null if not found
 */
export function getConverterByExtension(extension) {
  try {
    // Handle URL and parent URL types directly
    if (['url', 'parenturl'].includes(extension.toLowerCase())) {
      return {
        type: extension.toLowerCase(),
        config: FILE_CONVERTERS[extension.toLowerCase()]
      };
    }

    // Normalize extension (ensure it has a dot)
    const ext = extension.startsWith('.') ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
    
    // Find first converter that supports this extension
    const [type, config] = Object.entries(FILE_CONVERTERS).find(
      ([_, c]) => c?.extensions?.includes(ext)
    ) || [];
    
    if (config) {
      return {
        type,
        config
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
 * Get converter configuration for a specific mime type
 * @param {string} mimeType MIME type to match
 * @returns {Object|null} Converter configuration or null if not found
 */
export function getConverterByMimeType(mimeType) {
  try {
    const normalizedMimeType = mimeType.toLowerCase();
    
    // Find first converter that supports this mime type
    const [type, config] = Object.entries(FILE_CONVERTERS).find(
      ([_, c]) => c.mimeTypes.includes(normalizedMimeType)
    ) || [];
    
    if (config) {
      return {
        type,
        config
      };
    }
    
    console.warn(`No converter found for MIME type: ${mimeType}`);
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
export function getSupportedExtensions() {
  return Object.values(FILE_CONVERTERS).flatMap(c => c.extensions);
}

/**
 * Get all supported mime types
 * @returns {string[]} Array of supported mime types
 */
export function getSupportedMimeTypes() {
  return Object.values(FILE_CONVERTERS).flatMap(c => c.mimeTypes);
}

/**
 * Validate file content for conversion
 * @param {string} type File type
 * @param {Buffer|string} content File content
 * @returns {boolean} Whether the content is valid for conversion
 */
export function validateContent(type, content) {
  // Basic validation - ensure content exists
  if (!content || (Buffer.isBuffer(content) && content.length === 0) || 
      (typeof content === 'string' && content.trim() === '')) {
    return false;
  }
  
  // Type-specific validation
  switch (type.toLowerCase()) {
    case 'url':
    case 'parenturl':
      return typeof content === 'string' && content.length > 0;
      
    case 'pdf':
      // Basic PDF validation - check for PDF signature
      if (Buffer.isBuffer(content)) {
        return content.length > 4 && content.toString('ascii', 0, 4) === '%PDF';
      }
      return false;
      
    case 'docx':
    case 'xlsx':
    case 'pptx':
      // Office files are zip-based, should be buffers
      return Buffer.isBuffer(content) && content.length > 0;
      
    case 'csv':
      // CSV can be string or buffer
      return (Buffer.isBuffer(content) || typeof content === 'string') && content.length > 0;
      
    case 'mp3':
    case 'wav':
    case 'mp4':
    case 'webm':
      // Media files should be buffers
      return Buffer.isBuffer(content) && content.length > 0;
      
    default:
      // Default validation - just check if content exists
      return true;
  }
}

/**
 * Interface for backend converters
 * This defines what converters should implement
 */
export const ConverterInterface = {
  /**
   * Convert content to Markdown
   * @param {Buffer|string} content - Content to convert
   * @param {string} name - Original filename
   * @param {string} apiKey - API key for services that require it
   * @param {Object} options - Additional options
   * @returns {Promise<Object>} - Conversion result
   */
  convert: async (content, name, apiKey, options = {}) => {
    throw new ConversionError(
      'Convert method not implemented',
      ERROR_TYPES.CONVERSION_ERROR
    );
  },
  
  /**
   * Validate content for conversion
   * @param {Buffer|string} content - Content to validate
   * @returns {boolean} - Whether content is valid
   */
  validate: (content) => false,
  
  /**
   * Configuration for the converter
   */
  config: {
    name: 'Base Converter',
    extensions: [],
    mimeTypes: [],
    maxSize: 0
  }
};

/**
 * Registry for backend converters
 * This will be populated by the application at runtime
 */
export const backendConverters = {
  // Will be populated at runtime
};

/**
 * Register a converter in the registry
 * @param {string} type - Converter type (e.g., 'pdf', 'docx')
 * @param {Object|Function} converter - Converter implementation (can be an object or a class/function)
 */
export function registerConverter(type, converter) {
  if (!type || typeof type !== 'string') {
    throw new Error('Converter type must be a string');
  }
  
  if (!converter) {
    throw new Error('Converter cannot be null or undefined');
  }
  
  // Store the converter
  backendConverters[type] = converter;
  console.log(`✅ Registered converter for ${type}`);
  
  return true;
}

/**
 * Register a converter factory
 * @param {string} name - Factory name
 * @param {Object|Function} factory - Converter factory (can be an object or a class/function)
 */
export function registerConverterFactory(name, factory) {
  if (!name || typeof name !== 'string') {
    throw new Error('Factory name must be a string');
  }
  
  if (!factory) {
    throw new Error('Factory cannot be null or undefined');
  }
  
  // Store the factory
  backendConverters[name] = factory;
  console.log(`✅ Registered converter factory: ${name}`);
  
  // If the factory has converters, register them individually
  if (factory.converters) {
    Object.entries(factory.converters).forEach(([type, converter]) => {
      backendConverters[type] = converter;
      console.log(`✅ Registered converter from factory: ${type}`);
    });
  }
  
  return true;
}

/**
 * Convert content to Markdown based on type
 * This function delegates to the appropriate backend converter
 * 
 * @param {string} type - The type of content (file extension without dot, or special type like 'url')
 * @param {Buffer|string} content - The content to convert
 * @param {Object} options - Conversion options including name, apiKey, etc.
 * @returns {Promise<Object>} - Converted content with images if any
 */
export async function convertToMarkdown(type, content, options = {}) {
  // Normalize the type (remove dot if present, lowercase)
  const normalizedType = type.toLowerCase().replace(/^\./, '');
  
  // Validate the content
  if (!validateContent(normalizedType, content)) {
    throw new ConversionError(
      `Invalid content for ${normalizedType} conversion`,
      ERROR_TYPES.INVALID_FILE_TYPE,
      { type: normalizedType }
    );
  }
  
  // Check if we have a converter for this type
  const converter = backendConverters[normalizedType];
  if (!converter) {
    throw new ConversionError(
      `No converter registered for type: ${normalizedType}`,
      ERROR_TYPES.CONVERSION_ERROR,
      { type: normalizedType }
    );
  }
  
  try {
    // Handle special cases for audio and video
    if (['mp3', 'wav', 'ogg', 'flac'].includes(normalizedType)) {
      // Audio converters typically need to be instantiated
      if (typeof converter === 'function') {
        const instance = new converter();
        return await instance.convertToMarkdown(content, {
          name: options.name,
          apiKey: options.apiKey,
          onProgress: options.onProgress
        });
      }
    }
    
    if (['mp4', 'webm', 'avi', 'mov'].includes(normalizedType)) {
      // Video converters typically need to be instantiated
      if (typeof converter === 'function') {
        const instance = new converter();
        return await instance.convertToMarkdown(content, {
          name: options.name,
          apiKey: options.apiKey,
          onProgress: options.onProgress
        });
      }
    }
    
    // Handle URL and parent URL
    if (normalizedType === 'url' || normalizedType === 'parenturl') {
      // URL converters typically have a convertToMarkdown method
      if (converter.convertToMarkdown) {
        return await converter.convertToMarkdown(content, options);
      }
      
      // Some converters use a different method name
      if (converter.convert) {
        return await converter.convert(content, options);
      }
    }
    
    // Special handling for PDF files
    if (normalizedType === 'pdf') {
      console.log('🔄 [convertToMarkdown] Converting PDF with options:', {
        useOcr: options.useOcr,
        hasMistralApiKey: !!options.mistralApiKey
      });
      
      // Check if it's a PdfConverterFactory with convertPdfToMarkdown method
      if (converter.convertPdfToMarkdown) {
        // Ensure we're passing the OCR settings correctly
        const pdfOptions = {
          useOcr: options.useOcr === true,
          mistralApiKey: options.mistralApiKey,
          preservePageInfo: true
        };
        
        console.log(`PDF conversion using OCR: ${pdfOptions.useOcr}, API key available: ${!!pdfOptions.mistralApiKey}`);
        
        return await converter.convertPdfToMarkdown(content, options.name, pdfOptions);
      }
    }
    
    // Handle data file types (CSV, XLSX)
    if (['csv', 'xlsx'].includes(normalizedType)) {
      console.log(`🔄 [convertToMarkdown] Converting data file (${normalizedType}) with options:`, {
        name: options.name,
        contentType: typeof content === 'string' ? 'string' : (Buffer.isBuffer(content) ? 'buffer' : typeof content)
      });
      
      // Check for convertToMarkdown method first (our preferred method)
      if (converter.convertToMarkdown) {
        return await converter.convertToMarkdown(content, options.name, options.apiKey);
      }
      
      // Fall back to convert method if available
      if (converter.convert) {
        return await converter.convert(content, options.name, options.apiKey, options);
      }
    }
    
    // For all other types, try to use the converter directly
    if (converter.convert) {
      return await converter.convert(content, options.name, options.apiKey, options);
    }
    
    // Also check for convertToMarkdown method
    if (converter.convertToMarkdown) {
      return await converter.convertToMarkdown(content, options);
    }
    
    // If we have a text converter factory, try to use it
    const textFactory = backendConverters.textFactory;
    if (textFactory && textFactory.convertToMarkdown) {
      return await textFactory.convertToMarkdown(normalizedType, content, {
        name: options.name,
        apiKey: options.apiKey,
        mimeType: options.mimeType,
        ...options
      });
    }
    
    throw new ConversionError(
      `Converter for ${normalizedType} does not implement required methods`,
      ERROR_TYPES.CONVERSION_ERROR,
      { type: normalizedType }
    );
  } catch (error) {
    // Wrap any errors in ConversionError
    if (error instanceof ConversionError) {
      throw error;
    }
    
    throw new ConversionError(
      `Conversion failed: ${error.message}`,
      ERROR_TYPES.CONVERSION_ERROR,
      { originalError: error.message, type: normalizedType }
    );
  }
}

// Default export for compatibility
export default {
  FILE_CONVERTERS,
  getConverterByExtension,
  getConverterByMimeType,
  getSupportedExtensions,
  getSupportedMimeTypes,
  validateContent,
  convertToMarkdown
};
