/**
 * File type detection and categorization utilities
 * Provides centralized file type handling for the electron process
 * 
 * This file is used by electron services and IPC handlers to determine
 * how files should be processed and what converters to use.
 * 
 * Connected to:
 * - src/electron/converters/UnifiedConverterFactory.js
 * - src/electron/services/ElectronConversionService.js
 * - src/electron/ipc/handlers/conversion/
 */

// File Categories - Group similar file types
const FILE_CATEGORIES = {
  documents: ['pdf', 'docx', 'pptx', 'rtf', 'txt', 'md'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  data: ['csv', 'xlsx', 'xls', 'json', 'yaml'],
  web: ['url', 'parenturl']
};

// File handling types - How the file should be processed
const HANDLING_TYPES = {
  BINARY: 'binary',    // Read as buffer
  TEXT: 'text',       // Read as UTF-8
  URL: 'url'         // Process as URL
};

// Converter configuration - Maps file types to their handling requirements
const CONVERTER_CONFIG = {
  // Documents
  docx: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'text',
    requiresOcr: false
  },
  pptx: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'text',
    requiresOcr: false
  },
  pdf: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'pdf',
    requiresOcr: true
  },
  
  // Data files
  xlsx: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'data',
    requiresOcr: false
  },
  csv: {
    handling: HANDLING_TYPES.TEXT,
    converter: 'data',
    requiresOcr: false
  },
  
  // Media files
  mp3: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'audio',
    requiresOcr: false
  },
  wav: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'audio',
    requiresOcr: false
  },
  mp4: {
    handling: HANDLING_TYPES.BINARY,
    converter: 'video',
    requiresOcr: false
  }
};

// List of types that require an API key
const API_REQUIRED_TYPES = [
  'mp3', 'wav', 'ogg', 'm4a', 'mpga',  // Audio
  'mp4', 'webm', 'avi', 'mov', 'mpeg'   // Video
];

/**
 * Get comprehensive file handling information
 * @param {string|Object} file - File to analyze
 * @returns {Object} Complete file handling details including type, category, and handling requirements
 */
function getFileHandlingInfo(file) {
  // Get basic file info
  const fileName = typeof file === 'string' ? file : 
                 file.name || file.originalFileName || 'unknown';
  const fileType = fileName.split('.').pop().toLowerCase();
  
  // Handle web content types
  if (typeof file === 'object' && file.type && ['url', 'parenturl'].includes(file.type)) {
    return {
      fileName,
      fileType: file.type,
      category: 'web',
      handling: HANDLING_TYPES.URL,
      converter: file.type, // Preserve original type (url/parenturl)
      requiresOcr: false,
      isWeb: true,
      isBinary: false
    };
  }
  
  // Get category
  let category = 'unknown';
  for (const [cat, extensions] of Object.entries(FILE_CATEGORIES)) {
    if (extensions.includes(fileType)) {
      category = cat;
      break;
    }
  }
  
  // Get converter config
  const config = CONVERTER_CONFIG[fileType] || {
    handling: HANDLING_TYPES.TEXT,
    converter: 'text',
    requiresOcr: false
  };
  
  return {
    fileName,
    fileType,
    category,
    ...config,
    isWeb: category === 'web',
    isBinary: config.handling === HANDLING_TYPES.BINARY,
    requiresApiKey: API_REQUIRED_TYPES.includes(fileType)
  };
}

/**
 * Convert a File object to buffer or text based on handling type
 * @param {Object} file - File to process
 * @returns {Promise<Buffer|string>} Processed content
 */
function getFileContent(file) {
  const info = getFileHandlingInfo(file);
  
  if (info.isBinary) {
    return file.buffer || Buffer.from(file.arrayBuffer || []);
  }
  
  return file.text || '';
}

/**
 * Get the category of a file
 * @param {string|Object} file - File to analyze
 * @returns {string} File category
 */
function getFileType(file) {
  const info = getFileHandlingInfo(file);
  return info.category;
}

/**
 * Check if a file requires an API key
 * @param {string|Object} file - File to analyze
 * @returns {boolean} Whether the file requires an API key
 */
function requiresApiKey(file) {
  const info = getFileHandlingInfo(file);
  return info.requiresApiKey;
}

// CommonJS exports
module.exports = {
  FILE_CATEGORIES,
  HANDLING_TYPES,
  CONVERTER_CONFIG,
  API_REQUIRED_TYPES,
  getFileHandlingInfo,
  getFileContent,
  getFileType,
  requiresApiKey
};
