/**
 * Files utilities barrel file for electron
 * Exports all file-related utilities in an organized way
 * 
 * This file serves as the main entry point for file utilities in the electron process.
 * It re-exports utilities from types.js in various groupings to provide flexibility
 * in how they are imported by other modules.
 * 
 * Connected to:
 * - src/electron/converters/UnifiedConverterFactory.js
 * - src/electron/services/ElectronConversionService.js
 * - src/electron/ipc/handlers/conversion/
 */

const types = require('./types');

const names = require('./names');

// Group functions by category for organizational clarity
const fileTypes = {
  getFileHandlingInfo: types.getFileHandlingInfo,
  requiresApiKey: types.requiresApiKey,
  getFileType: types.getFileType,
  getFileContent: types.getFileContent,
  FILE_CATEGORIES: types.FILE_CATEGORIES,
  API_REQUIRED_TYPES: types.API_REQUIRED_TYPES,
  HANDLING_TYPES: types.HANDLING_TYPES,
  CONVERTER_CONFIG: types.CONVERTER_CONFIG
};

// CommonJS exports
module.exports = {
  // Types
  FILE_CATEGORIES: types.FILE_CATEGORIES,
  API_REQUIRED_TYPES: types.API_REQUIRED_TYPES,
  HANDLING_TYPES: types.HANDLING_TYPES,
  CONVERTER_CONFIG: types.CONVERTER_CONFIG,
  getFileHandlingInfo: types.getFileHandlingInfo,
  requiresApiKey: types.requiresApiKey,
  getFileType: types.getFileType,
  getFileContent: types.getFileContent,
  
  // File name utilities
  cleanTemporaryFilename: names.cleanTemporaryFilename,
  getBasename: names.getBasename,
  generateUrlFilename: names.generateUrlFilename,
  sanitizeFilename: names.sanitizeFilename,
  
  // Grouped exports
  fileTypes
};
