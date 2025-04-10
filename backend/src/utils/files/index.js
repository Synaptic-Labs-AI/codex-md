/**
 * Files utilities barrel file for backend
 * Exports all file-related utilities in an organized way
 * 
 * This file serves as the main entry point for file utilities in the backend.
 * It re-exports utilities from types.js for easy importing by other modules.
 * 
 * Used by:
 * - backend/src/utils/fileTypeUtils.js
 * - backend/src/services/converter/
 */

import * as types from './types.js';

// Re-export all utilities
export const {
  FILE_CATEGORIES,
  API_REQUIRED_TYPES,
  getFileType,
  requiresApiKey
} = types;

// Default export for compatibility
export default {
  FILE_CATEGORIES,
  API_REQUIRED_TYPES,
  getFileType,
  requiresApiKey
};
