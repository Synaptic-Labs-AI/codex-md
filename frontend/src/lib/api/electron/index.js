/**
 * Electron API Entry Point
 * 
 * This module serves as the main entry point for the Electron API implementation.
 * It exports all necessary components in a clean, organized way.
 */

import electronClient, { ConversionError } from './client.js';
import eventHandlerManager from './eventHandlers.js';
import fileSystemOperations from './fileSystem.js';
import * as utils from './utils.js';

// Export the main client instance as default
export default electronClient;

// Export other components for direct access if needed
export {
  ConversionError,
  eventHandlerManager,
  fileSystemOperations,
  utils
};

// Re-export utility functions for convenience
export const {
  generateId,
  normalizeUrl,
  isSupportedFileType,
  isAudioType,
  isVideoType,
  validateAndNormalizeItem
} = utils;

// Explicitly export getFileCategory to fix import issues
export function getFileCategory(fileType) {
  return utils.getFileCategory(fileType);
}

// Re-export converters for direct access
export { convertFile, getResult } from './converters/fileConverter.js';
export { convertUrl, convertParentUrl, convertYoutube } from './converters/urlConverter.js';

// Export file categories constant
export const { fileCategories } = utils;
