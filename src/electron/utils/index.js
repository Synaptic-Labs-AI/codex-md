/**
 * Main utilities barrel file for electron
 * Exports all utilities in an organized way
 * 
 * This file serves as the central hub for all electron utilities.
 * It provides convenient access to commonly used utilities while maintaining
 * a clean and organized export structure.
 * 
 * Connected files:
 * - files/index.js: File-related utilities including type detection
 * - paths/index.js: Path manipulation and resolution utilities
 * - conversion/index.js: Conversion-related utilities
 * 
 * Used by:
 * - src/electron/converters/UnifiedConverterFactory.js
 * - src/electron/services/ElectronConversionService.js
 * - src/electron/ipc/handlers/conversion/
 */

const files = require('./files');

// Utility groups
const utils = {
  files: {
    types: files.fileTypes
  }
};

// CommonJS exports
module.exports = {
  // Re-export all modules
  files,
  
  // Utility groups
  utils,
  
  // Common aliases
  getFileHandlingInfo: files.getFileHandlingInfo,
  getFileType: files.getFileType,
  requiresApiKey: files.requiresApiKey
};
