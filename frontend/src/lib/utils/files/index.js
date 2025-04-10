/**
 * Files utilities barrel file for frontend
 * Exports all file-related utilities in an organized way
 * 
 * This file serves as the main entry point for file utilities in the frontend.
 * It re-exports utilities from types.js in various groupings to provide flexibility
 * in how they are imported by other modules.
 */

import * as types from './types.js';

// Re-export all utilities
export const {
  FILE_CATEGORIES,
  API_REQUIRED_TYPES,
  HANDLING_TYPES,
  CONVERTER_CONFIG,
  getFileHandlingInfo,
  requiresApiKey,
  getFileType,
  getFileContent
} = types;

// Group functions by category for organizational clarity
export const fileTypes = {
  getFileHandlingInfo,
  requiresApiKey,
  getFileType,
  getFileContent,
  FILE_CATEGORIES,
  API_REQUIRED_TYPES,
  HANDLING_TYPES,
  CONVERTER_CONFIG
};

// Default export for compatibility
export default {
  // Types
  FILE_CATEGORIES,
  API_REQUIRED_TYPES,
  HANDLING_TYPES,
  CONVERTER_CONFIG,
  getFileHandlingInfo,
  requiresApiKey,
  getFileType,
  getFileContent,
  
  // Grouped exports
  fileTypes
};
