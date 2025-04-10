/**
 * Main utilities barrel file for frontend
 * Exports all utilities in an organized way
 * 
 * This file serves as the central hub for all frontend utilities.
 * It provides convenient access to commonly used utilities while maintaining
 * a clean and organized export structure.
 * 
 * Connected files:
 * - files/index.js: File-related utilities including type detection
 * - Used by components like FileUploader.svelte and stores/files.js
 */

import * as files from './files/index.js';

// Re-export major utility groups
export const utils = {
  files: {
    types: files.fileTypes
  }
};

// Common aliases for frequently used utilities
export const { getFileHandlingInfo, getFileType, requiresApiKey } = files;

// Re-export all modules
export { files };

// Default export for compatibility
export default {
  ...files,
  
  // Utility groups
  utils,
  
  // Common aliases
  getFileHandlingInfo,
  getFileType,
  requiresApiKey
};
