/**
 * File Converter Module
 *
 * Handles conversion of local files to Markdown format. Uses the Electron IPC bridge
 * for communication with the main process. Supports single file conversion.
 *
 *
 * Related files:
 * - ../eventHandlers.js: Event registration and handling
 * - ../utils.js: Utility functions
 * - ../client.js: Core client functionality
 */

import { ConversionError } from '../../errors.js';
import { isSupportedFileType, generateId } from '../utils.js';
import { unifiedConversion, ConversionState } from '../../../stores/unifiedConversion.js';
import eventHandlerManager from '../eventHandlers.js';

/**
 * Converts a single file to Markdown
 * @param {string} filePath Path to the file to convert
 * @param {Object} options Conversion options
 * @param {Function} onProgress Progress callback
 * @returns {Promise<Object>} Conversion result
 */
export async function convertFile(filePath, options = {}, onProgress = null) {

  try {
    // Get file extension
    const fileExt = filePath.split('.').pop().toLowerCase();
    if (!isSupportedFileType(fileExt)) {
      throw new ConversionError(`Unsupported file type: ${fileExt}`);
    }

    // Set initial status
    unifiedConversion.setStatus(ConversionState.STATUS.INITIALIZING);
    unifiedConversion.setProgress(0);
    unifiedConversion.setCurrentFile(filePath.split('/').pop());
    unifiedConversion.setError(null);
    unifiedConversion.batchUpdate({ type: ConversionState.TYPE.FILE });

    // Generate a job ID
    const jobId = generateId();

    // Register event handlers
    eventHandlerManager.registerHandlers(jobId, filePath, onProgress);

    // Log options for debugging
    console.log('File conversion options:', {
      filePath,
      outputDir: options.outputDir,
      createSubdirectory: options.createSubdirectory
    });
    
    // Call the IPC method
    const result = await window.electron.convertFile(filePath, options);
    
    // Log result for debugging
    console.log('File conversion result:', {
      success: result.success,
      outputPath: result.outputPath
    });

    // Check for errors
    if (!result.success) {
      throw new ConversionError(result.error || 'File conversion failed');
    }

    return result;
  } catch (error) {
    // Update status
    unifiedConversion.setError(error.message || 'Unknown error occurred');
    unifiedConversion.setProgress(0);

    throw error instanceof ConversionError ? 
      error : 
      new ConversionError(error.message || 'File conversion failed');
  }
}


/**
 * Gets the result of a conversion
 * @param {string} path Path to the converted file or directory
 * @returns {Promise<Object>} Conversion result
 */
export async function getResult(path) {

  try {
    const result = await window.electron.getResult(path);

    // Check for errors
    if (!result.success) {
      throw new ConversionError(result.error || 'Failed to get conversion result');
    }

    return result;
  } catch (error) {
    throw error instanceof ConversionError ? 
      error : 
      new ConversionError(error.message || 'Failed to get conversion result');
  }
}
