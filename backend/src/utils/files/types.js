/**
 * File type detection and categorization utilities for backend
 * 
 * This module provides utilities for determining file types, categories,
 * and handling requirements for the backend services.
 * 
 * Used by:
 * - backend/src/utils/fileTypeUtils.js
 * - backend/src/services/converter/
 */

// File Categories - Group similar file types
export const FILE_CATEGORIES = {
  documents: ['pdf', 'docx', 'pptx', 'rtf', 'txt', 'md'],
  audio: ['mp3', 'wav', 'ogg', 'm4a', 'aac', 'wma'],
  video: ['mp4', 'mov', 'avi', 'mkv', 'webm'],
  data: ['csv', 'xlsx', 'xls', 'json', 'yaml'],
  web: ['url', 'parenturl']
};

// List of types that require an API key
export const API_REQUIRED_TYPES = [
  'mp3', 'wav', 'ogg', 'm4a', 'mpga',  // Audio
  'mp4', 'webm', 'avi', 'mov', 'mpeg'   // Video
];

/**
 * Check if a file requires an API key
 * @param {string|Object} file - File to analyze
 * @returns {boolean} Whether the file requires an API key
 */
export function requiresApiKey(file) {
  const fileType = typeof file === 'string' 
    ? file.split('.').pop().toLowerCase() 
    : (file.type || file.fileType || (file.name ? file.name.split('.').pop().toLowerCase() : ''));
  
  return API_REQUIRED_TYPES.includes(fileType);
}

/**
 * Get the category of a file
 * @param {string|Object} file - File to analyze
 * @returns {string} File category
 */
export function getFileType(file) {
  const fileType = typeof file === 'string' 
    ? file.split('.').pop().toLowerCase() 
    : (file.type || file.fileType || (file.name ? file.name.split('.').pop().toLowerCase() : ''));
  
  for (const [category, extensions] of Object.entries(FILE_CATEGORIES)) {
    if (extensions.includes(fileType)) {
      return category;
    }
  }
  
  return 'unknown';
}

export default {
  FILE_CATEGORIES,
  API_REQUIRED_TYPES,
  requiresApiKey,
  getFileType
};
