/**
 * Utility functions for file type handling
 * Imports local utilities and adds backend-specific functions
 */

import { FILE_CATEGORIES, API_REQUIRED_TYPES, requiresApiKey } from './files';

// Re-export local utilities
export { FILE_CATEGORIES, API_REQUIRED_TYPES, requiresApiKey };

/**
 * Determines the converter category for a file type
 * @param {string} type - The file type
 * @param {string} fileType - The file extension
 * @returns {string} - The converter category
 */
export function determineCategory(type, fileType) {
  // Normalize input
  const normalizedType = type?.toLowerCase();
  const normalizedFileType = fileType?.toLowerCase();

  // Handle presentation files
  if (normalizedFileType === 'pptx' || normalizedFileType === 'ppt') {
    return 'text';
  }
  
  // Audio types
  if (['mp3', 'wav', 'ogg', 'm4a'].includes(fileType)) {
    return 'multimedia';
  }
  
  // Video types
  if (['mp4', 'webm', 'avi'].includes(fileType)) {
    return 'multimedia';
  }
  
  // Document types - add pptx explicitly
  if (['pdf', 'docx', 'pptx', 'ppt'].includes(fileType)) {
    return 'text';
  }
  
  // Data files
  if (['csv', 'xlsx', 'xls'].includes(fileType)) {
    return 'data';
  }
  
  // Web content
  if (['url', 'parenturl'].includes(type)) {
    return 'web';
  }
  
  // Default to text for unknown types
  return 'text';
}
