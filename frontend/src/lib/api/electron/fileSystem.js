/**
 * File System Operations for Electron Client
 * 
 * Manages all file system related operations through the Electron IPC bridge.
 * Provides a clean interface for file selection, reading, writing, and directory operations.
 * 
 * Related files:
 * - client.js: Core client functionality
 * - converters/*.js: Converter implementations that use file operations
 */

import { ConversionError } from '../errors.js';

/**
 * Handles file and directory selection operations
 */
class FileSystemOperations {
  /**
   * Opens a file selection dialog
   * @param {Object} options Dialog options
   * @returns {Promise<{success: boolean, paths?: string[]}>}
   */
  async selectFiles(options = {}) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot select files: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.selectFiles(options);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'File selection failed');
    }
  }

  /**
   * Opens an input directory selection dialog
   * @param {Object} options Dialog options
   * @returns {Promise<{success: boolean, path?: string}>}
   */
  async selectInputDirectory(options = {}) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot select input directory: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.selectInputDirectory(options);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Directory selection failed');
    }
  }

  /**
   * Opens an output directory selection dialog
   * @param {Object} options Dialog options
   * @returns {Promise<{success: boolean, path?: string}>}
   */
  async selectOutputDirectory(options = {}) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot select output directory: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.selectOutput(options);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Directory selection failed');
    }
  }

  /**
   * Lists directory contents with detailed information
   * @param {string} dirPath Directory path to list
   * @param {Object} options Listing options
   * @returns {Promise<{success: boolean, items?: Array<Object>}>}
   */
  async listDirectory(dirPath, options = {}) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot list directory: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.listDirectoryDetailed(dirPath, options);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Directory listing failed');
    }
  }

  /**
   * Shows an item in the system file explorer
   * @param {string} path Path to show
   * @returns {Promise<void>}
   */
  async showItemInFolder(path) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot show item: Not running in Electron environment');
    }

    try {
      await window.electronAPI.showItemInFolder(path);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Failed to show item in folder');
    }
  }

  /**
   * Gets file or directory stats
   * @param {string} path Path to check
   * @returns {Promise<{success: boolean, stats?: Object}>}
   */
  async getStats(path) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot get stats: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.getStats(path);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Failed to get file stats');
    }
  }

  /**
   * Reads a file's contents
   * @param {string} path Path to read
   * @returns {Promise<{success: boolean, data?: string|Buffer}>}
   */
  async readFile(path) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot read file: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.readFile(path);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Failed to read file');
    }
  }

  /**
   * Writes content to a file
   * @param {string} path Path to write to
   * @param {string|Buffer} content Content to write
   * @returns {Promise<{success: boolean}>}
   */
  async writeFile(path, content) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot write file: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.writeFile(path, content);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Failed to write file');
    }
  }

  /**
   * Creates a directory
   * @param {string} path Path to create
   * @returns {Promise<{success: boolean}>}
   */
  async createDirectory(path) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot create directory: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.createDirectory(path);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Failed to create directory');
    }
  }

  /**
   * Moves a file or directory
   * @param {string} sourcePath Source path
   * @param {string} destPath Destination path
   * @returns {Promise<{success: boolean}>}
   */
  async moveItem(sourcePath, destPath) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot move item: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.moveItem(sourcePath, destPath);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Failed to move item');
    }
  }

  /**
   * Deletes a file or directory
   * @param {string} path Path to delete
   * @param {boolean} recursive Whether to delete recursively
   * @returns {Promise<{success: boolean}>}
   */
  async deleteItem(path, recursive = false) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot delete item: Not running in Electron environment');
    }

    try {
      return await window.electronAPI.deleteItem(path, recursive);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Failed to delete item');
    }
  }

  /**
   * Opens a file with the default application
   * @param {string} path Path to open
   * @returns {Promise<void>}
   */
  async openFile(path) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot open file: Not running in Electron environment');
    }

    try {
      await window.electronAPI.openExternal(`file://${path}`);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Failed to open file');
    }
  }

  /**
   * Opens a folder with the default file explorer
   * @param {string} path Path to open
   * @returns {Promise<void>}
   */
  async openFolder(path) {
    if (!window.electronAPI) {
      throw new ConversionError('Cannot open folder: Not running in Electron environment');
    }

    try {
      await window.electronAPI.openExternal(`file://${path}`);
    } catch (error) {
      throw error instanceof ConversionError ? 
        error : 
        new ConversionError(error.message || 'Failed to open folder');
    }
  }
}

// Create and export singleton instance
const fileSystemOperations = new FileSystemOperations();
export default fileSystemOperations;
