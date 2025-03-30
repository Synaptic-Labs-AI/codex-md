/**
 * Electron Client Entry Point
 * 
 * Main entry point for the Electron client implementation. This module ties together
 * all the individual components and provides a clean interface for the application
 * to interact with Electron functionality.
 * 
 * Related files:
 * - ../errors.js: Custom error definitions
 * - eventHandlers.js: Event registration and handling
 * - utils.js: Utility functions
 * - fileSystem.js: File system operations
 * - converters/*.js: Individual converter implementations
 */

import { ConversionError } from '../errors.js';
import fileSystemOperations from './fileSystem.js';
import eventHandlerManager from './eventHandlers.js';
import { validateAndNormalizeItem } from './utils.js';
import { convertUrl, convertParentUrl, convertYoutube } from './converters/urlConverter.js';
import { convertFile, convertBatch, getResult } from './converters/fileConverter.js';

class ElectronClient {
  constructor() {
    // Check if we're in a browser environment first
    const isBrowser = typeof window !== 'undefined';
    
    // Then check if we're in an Electron environment
    this.isElectron = isBrowser && window.electronAPI !== undefined;
    
    if (isBrowser && !this.isElectron) {
      console.warn('ElectronClient: Not running in Electron environment');
    }
    
    this.supportedTypes = ['file', 'url', 'parent', 'youtube', 'audio', 'video'];
  }

  /**
   * Checks if the client is running in Electron
   * @returns {boolean} Whether the client is running in Electron
   */
  isRunningInElectron() {
    return this.isElectron;
  }

  /**
   * Converts a single file to Markdown
   * @param {string} filePath Path to the file to convert
   * @param {Object} options Conversion options
   * @param {Function} onProgress Progress callback
   * @returns {Promise<Object>} Conversion result
   */
  async convertFile(filePath, options = {}, onProgress = null) {
    return convertFile(filePath, options, onProgress);
  }

  /**
   * Converts multiple files to Markdown
   * @param {Array<string>} filePaths Array of file paths to convert
   * @param {Object} options Conversion options
   * @param {Function} onProgress Progress callback
   * @param {Function} onItemComplete Callback for individual file completion
   * @returns {Promise<Object>} Conversion result
   */
  async convertBatch(filePaths, options = {}, onProgress = null, onItemComplete = null) {
    return convertBatch(filePaths, options, onProgress, onItemComplete);
  }

  /**
   * Converts a URL to Markdown
   * @param {string} url The URL to convert
   * @param {Object} options Conversion options
   * @param {Function} onProgress Progress callback
   * @returns {Promise<Object>} Conversion result
   */
  async convertUrl(url, options = {}, onProgress = null) {
    return convertUrl(url, options, onProgress);
  }

  /**
   * Converts a parent URL (website) to Markdown
   * @param {string} url The parent URL to convert
   * @param {Object} options Conversion options
   * @param {Function} onProgress Progress callback
   * @returns {Promise<Object>} Conversion result
   */
  async convertParentUrl(url, options = {}, onProgress = null) {
    return convertParentUrl(url, options, onProgress);
  }

  /**
   * Converts a YouTube URL to Markdown
   * @param {string} url The YouTube URL to convert
   * @param {Object} options Conversion options
   * @param {Function} onProgress Progress callback
   * @returns {Promise<Object>} Conversion result
   */
  async convertYoutube(url, options = {}, onProgress = null) {
    return convertYoutube(url, options, onProgress);
  }

  /**
   * Gets the result of a conversion
   * @param {string} path Path to the converted file or directory
   * @returns {Promise<Object>} Conversion result
   */
  async getResult(path) {
    return getResult(path);
  }

  /**
   * Opens a file selection dialog
   * @param {Object} options Dialog options
   * @returns {Promise<Array<string>>} Selected file paths
   */
  async selectFiles(options = {}) {
    return fileSystemOperations.selectFiles(options);
  }

  /**
   * Opens an output directory selection dialog
   * @param {Object} options Dialog options
   * @returns {Promise<string>} Selected directory path
   */
  async selectOutputDirectory(options = {}) {
    return fileSystemOperations.selectOutputDirectory(options);
  }
  
  /**
   * Opens an input directory selection dialog
   * @param {Object} options Dialog options
   * @returns {Promise<string>} Selected directory path
   */
  async selectInputDirectory(options = {}) {
    return fileSystemOperations.selectInputDirectory(options);
  }
  
  /**
   * Lists directory contents with detailed information
   * @param {string} dirPath Directory path to list
   * @param {Object} options Listing options
   * @returns {Promise<{success: boolean, items?: Array<Object>, error?: string}>}
   */
  async listDirectory(dirPath, options = {}) {
    return fileSystemOperations.listDirectory(dirPath, options);
  }

  /**
   * Shows an item in the system file explorer
   * @param {string} path Path to show
   * @returns {Promise<void>}
   */
  async showItemInFolder(path) {
    return fileSystemOperations.showItemInFolder(path);
  }

  /**
   * Validates and normalizes an item for conversion
   * @param {Object} item The item to validate and normalize
   * @returns {Object} The normalized item
   */
  validateItem(item) {
    return validateAndNormalizeItem(item, this.supportedTypes);
  }

  /**
   * Cancels all active conversion requests
   */
  cancelRequests() {
    if (!this.isElectron) {
      return;
    }

    // Cancel all active requests
    if (window.electronAPI) {
      const activeJobs = eventHandlerManager.getActiveJobs();
      for (const jobId of activeJobs) {
        window.electronAPI.cancelConversion(jobId);
      }
    }

    // Remove all event handlers
    eventHandlerManager.removeAllHandlers();
  }
}

// Create and export singleton instance
const electronClient = new ElectronClient();
export default electronClient;
export { ConversionError };
