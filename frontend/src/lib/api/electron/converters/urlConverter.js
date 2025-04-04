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
import { conversionStatus } from '../../../stores/conversionStatus.js';
import { websiteProgress } from '../../../stores/websiteProgressStore.js';
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
    conversionStatus.setStatus('initializing');
    conversionStatus.setProgress(0);
    conversionStatus.setCurrentFile(normalizedUrl);
    conversionStatus.setError(null);

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
    const result = await window.electronAPI.convertUrl(normalizedUrl, requestData.options);
    
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
    conversionStatus.setStatus('error');
    conversionStatus.setError(error.message || 'Unknown error occurred');
    conversionStatus.setProgress(0);

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
    // Normalize URL
    const normalizedUrl = normalizeUrl(url);

    // Set initial website status with our new simplified store
    websiteProgress.start(normalizedUrl);
    
    // Log the initial status
    console.log('[urlConverter] Website conversion initialized:', {
      url: normalizedUrl,
      pathFilter: options.pathFilter,
      timestamp: new Date().toISOString()
    });

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
        // Default crawling parameters
        concurrentLimit: 30, // Limit concurrent requests to avoid overwhelming the server
        waitBetweenRequests: 500, // Add a small delay between requests to be more respectful
        maxDepth: options.depth || 2, // Default to depth 2 for better content coverage
        maxPages: options.maxPages || 50, // Default to 50 pages for better content coverage
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
    console.log('Parent URL conversion options:', {
      url: normalizedUrl,
      outputDir: options.outputDir,
      createSubdirectory: options.createSubdirectory
    });

    // Call the IPC method
    const result = await window.electronAPI.convertParentUrl(normalizedUrl, requestData.options);
    
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
    // Update status with our new simplified store
    websiteProgress.setError(error.message || 'Unknown error occurred');

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
    conversionStatus.setStatus('initializing');
    conversionStatus.setProgress(0);
    conversionStatus.setCurrentFile(`YouTube: ${normalizedUrl}`);
    conversionStatus.setError(null);

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
    const result = await window.electronAPI.convertYoutube(normalizedUrl, requestData.options);

    // Check for errors
    if (!result.success) {
      throw new ConversionError(result.error || 'YouTube conversion failed');
    }

    return result;
  } catch (error) {
    // Update status
    conversionStatus.setStatus('error');
    conversionStatus.setError(error.message || 'Unknown error occurred');
    conversionStatus.setProgress(0);

    throw error instanceof ConversionError ? 
      error : 
      new ConversionError(error.message || 'YouTube conversion failed');
  }
}
