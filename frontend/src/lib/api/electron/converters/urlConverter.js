/**
 * URL Conversion Module
 * 
 * Handles conversion of URLs to Markdown format, including both single pages
 * and parent URLs (entire websites). Uses the Electron IPC bridge for communication
 * with the main process.
 * 
 * Related files:
 * - ../eventHandlers.js: Event registration and handling
 * - ../utils.js: Utility functions
 * - ../client.js: Core client functionality
 */

import { ConversionError } from '../../errors.js';
import { normalizeUrl } from '../utils.js';
import { unifiedConversion, ConversionState } from '../../../stores/unifiedConversion.js';
import eventHandlerManager from '../eventHandlers.js';
import { generateId } from '../utils.js';

/**
 * Converts a single URL to Markdown
 * @param {string} url The URL to convert
 * @param {Object} options Conversion options
 * @param {Function} onProgress Progress callback
 * @returns {Promise<Object>} Conversion result
 */
export async function convertUrl(url, options = {}, onProgress = null) {
  try {
    // Normalize URL
    const normalizedUrl = normalizeUrl(url);

    // Set initial status
    unifiedConversion.setStatus(ConversionState.STATUS.INITIALIZING);
    unifiedConversion.setProgress(0);
    unifiedConversion.setCurrentFile(normalizedUrl);
    unifiedConversion.setError(null);
    unifiedConversion.batchUpdate({ type: ConversionState.TYPE.URL });

    // Generate a job ID
    const jobId = generateId();

    // Register event handlers
    eventHandlerManager.registerHandlers(jobId, normalizedUrl, onProgress);

    // Prepare request data with enhanced options for better content extraction
    const requestData = {
      url: normalizedUrl,
      options: {
        includeImages: true,
        includeMeta: true,
        handleDynamicContent: true, // Enable dynamic content handling for SPAs
        // Enhanced options for better content extraction
        got: {
          timeout: {
            request: 45000,
            response: 45000
          },
          retry: {
            limit: 5,
            statusCodes: [408, 413, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524]
          }
        },
        ...options
      }
    };
    
    // Log options for debugging
    console.log('URL conversion options:', {
      url: normalizedUrl,
      outputDir: options.outputDir,
      createSubdirectory: options.createSubdirectory
    });

    // Call the IPC method
    const result = await window.electron.convertUrl(normalizedUrl, requestData.options);
    
    // Log result for debugging
    console.log('URL conversion result:', {
      success: result.success,
      outputPath: result.outputPath
    });

    // Check for errors
    if (!result.success) {
      throw new ConversionError(result.error || 'URL conversion failed');
    }

    return result;
  } catch (error) {
    // Update status
    unifiedConversion.setError(error.message || 'Unknown error occurred');
    unifiedConversion.setProgress(0);

    throw error instanceof ConversionError ? 
      error : 
      new ConversionError(error.message || 'URL conversion failed');
  }
}

/**
 * Converts a parent URL (website) to Markdown
 * @param {string} url The parent URL to convert
 * @param {Object} options Conversion options
 * @param {Function} onProgress Progress callback
 * @returns {Promise<Object>} Conversion result
 */
export async function convertParentUrl(url, options = {}, onProgress = null) {
  try {
    // Reset any existing state first
    unifiedConversion.reset();

    // Normalize URL
    const normalizedUrl = normalizeUrl(url);

    // Initialize website conversion with simplified state
    console.log(`[urlConverter] Starting website conversion for: ${normalizedUrl}`);
    
    // Start website conversion
    unifiedConversion.startWebsiteConversion(normalizedUrl);

    // Generate a unique job ID for tracking
    const jobId = generateId('website');

    // Register event handlers
    eventHandlerManager.registerHandlers(jobId, normalizedUrl, onProgress);

    // Prepare request data with essential options
    const requestData = {
      url: normalizedUrl,
      options: {
        includeImages: true,
        includeMeta: true,
        // Default crawling parameters
        maxDepth: options.depth || 2,
        maxPages: options.maxPages || 50,
        ...options
      }
    };
    
    // Log options for debugging
    console.log('Parent URL conversion options:', {
      url: normalizedUrl,
      outputDir: options.outputDir
    });

    // Call the IPC method
    const result = await window.electron.convertParentUrl(normalizedUrl, requestData.options);
    
    // Log result for debugging
    console.log('Parent URL conversion result:', {
      success: result.success,
      outputPath: result.outputPath
    });

    // Check for errors
    if (!result.success) {
      throw new ConversionError(result.error || 'Parent URL conversion failed');
    }

    return result;
  } catch (error) {
    // Update status
    unifiedConversion.setError(error.message || 'Unknown error occurred');

    throw error instanceof ConversionError ? 
      error : 
      new ConversionError(error.message || 'Parent URL conversion failed');
  }
}

/**
 * Converts a YouTube URL to Markdown
 * @param {string} url The YouTube URL to convert
 * @param {Object} options Conversion options
 * @param {Function} onProgress Progress callback
 * @returns {Promise<Object>} Conversion result
 */
export async function convertYoutube(url, options = {}, onProgress = null) {
  try {
    // Normalize URL
    const normalizedUrl = normalizeUrl(url);

    // Set initial status
    unifiedConversion.setStatus(ConversionState.STATUS.INITIALIZING);
    unifiedConversion.setProgress(0);
    unifiedConversion.setCurrentFile(`YouTube: ${normalizedUrl}`);
    unifiedConversion.setError(null);
    unifiedConversion.batchUpdate({ type: ConversionState.TYPE.URL });

    // Generate a job ID
    const jobId = generateId();

    // Register event handlers
    eventHandlerManager.registerHandlers(jobId, normalizedUrl, onProgress);

    // Prepare request data
    const requestData = {
      url: normalizedUrl,
      options: {
        includeImages: true,
        includeMeta: true,
        handleDynamicContent: true, // Enable dynamic content handling for SPAs
        ...options
      }
    };

    // Call the IPC method
    const result = await window.electron.convertYoutube(normalizedUrl, requestData.options);

    // Check for errors
    if (!result.success) {
      throw new ConversionError(result.error || 'YouTube conversion failed');
    }

    return result;
  } catch (error) {
    // Update status
    unifiedConversion.setError(error.message || 'Unknown error occurred');
    unifiedConversion.setProgress(0);

    throw error instanceof ConversionError ? 
      error : 
      new ConversionError(error.message || 'YouTube conversion failed');
  }
}
