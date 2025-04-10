/**
 * File type detection and categorization utilities
 * Provides centralized file type handling for the frontend
 * 
 * This file is used by components like FileUploader.svelte and stores/files.js
 * to determine how files should be processed and what converters to use.
 */

// File Categories - Group similar file types
export const FILE_CATEGORIES = {
  documents: ['pdf', 'docx', 'pptx', 'rtf', 'txt', 'md'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  data: ['csv', 'xlsx', 'xls', 'json', 'yaml'],
  web: ['url', 'parenturl']
};

// File handling types - How the file should be processed
export const HANDLING_TYPES = {
  BINARY: 'binary',    // Read as buffer
  TEXT: 'text',       // Read as UTF-8
  URL: 'url'         // Process as URL
};

// Converter configuration - Maps file types to their handling requirements
export const CONVERTER_CONFIG = {
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
export const API_REQUIRED_TYPES = [
  'mp3', 'wav', 'ogg', 'm4a', 'mpga',  // Audio
  'mp4', 'webm', 'avi', 'mov', 'mpeg'   // Video
];

/**
 * Get comprehensive file handling information
 * @param {string|File|Object} file - File to analyze
 * @returns {Object} Complete file handling details including type, category, and handling requirements
 */
export function getFileHandlingInfo(file) {
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
 * @param {File} file - File to process
 * @returns {Promise<Buffer|string>} Processed content
 */
export async function getFileContent(file) {
  const info = getFileHandlingInfo(file);
  
  if (info.isBinary) {
    return await file.arrayBuffer();
  }
  
  return await file.text();
}

/**
 * Get the category of a file
 * @param {string|File|Object} file - File to analyze
 * @returns {string} File category
 */
export function getFileType(file) {
  const info = getFileHandlingInfo(file);
  return info.category;
}

/**
 * Check if a file requires an API key
 * @param {string|File|Object} file - File to analyze
 * @returns {boolean} Whether the file requires an API key
 */
export function requiresApiKey(file) {
  const info = getFileHandlingInfo(file);
  return info.requiresApiKey;
}

// Default export for compatibility
export default {
  FILE_CATEGORIES,
  HANDLING_TYPES,
  CONVERTER_CONFIG,
  API_REQUIRED_TYPES,
  getFileHandlingInfo,
  getFileContent,
  getFileType,
  requiresApiKey
};
