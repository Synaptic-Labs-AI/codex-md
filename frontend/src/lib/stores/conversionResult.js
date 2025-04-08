/**
 * Conversion Result Store
 * 
 * Manages the results of file conversions, supporting both web and Electron environments.
 * In web mode, it stores blobs for download.
 * In Electron mode, it stores file paths for native file system access.
 * 
 * Related files:
 * - frontend/src/lib/utils/conversionManager.js: Manages the conversion process
 * - frontend/src/lib/components/ResultDisplay.svelte: Displays conversion results
 * - frontend/src/lib/api/electron: Modular Electron client implementation
 */

import { writable } from 'svelte/store';
import electronClient from '@lib/api/electron';

function createConversionResultStore() {
  // Default state with null values
  const initialState = {
    success: false,
    outputPath: null,     // For Electron file system
    items: [],            // Converted items
    isNative: true,       // Always true in Electron-only mode
    message: null,        // Success or error message
    error: null           // Error details if any
  };
  
  const { subscribe, set, update } = writable(null);

  return {
    subscribe,
    
    /**
     * Sets the conversion result
     * @param {Object} result The conversion result
     */
    setResult: (result) => {
      // Handle Electron result (path-based)
      if (result.outputPath) {
        set({
          success: true,
          outputPath: result.outputPath,
          items: result.items || [],
          isNative: true,
          message: result.message || 'Conversion completed successfully',
          error: null
        });
      }
      // Handle error result
      else if (result.error) {
        set({
          success: false,
          error: result.error,
          message: result.message || 'Conversion failed',
          isNative: true
        });
      }
      // Handle other result formats
      else {
        set({
          ...initialState,
          ...result,
          success: result.success !== false,
          isNative: true
        });
      }
    },
    
    /**
     * Sets a native file path result (for Electron)
     * @param {string} outputPath The output file path
     * @param {Array} items The converted items
     * @param {Object} options Additional options
     * @param {string} options.message Optional success message
     * @param {boolean} options.isBatch Whether this is a batch conversion
     * @param {number} options.totalCount Total number of files in the batch
     */
    setNativeResult: (outputPath, items = [], options = {}) => {
      const { message = null, isBatch = false, totalCount = items.length } = options;
      
      set({
        success: true,
        outputPath,
        items,
        isNative: true,
        isBatch,
        totalCount,
        message: message || 'Conversion completed successfully',
        error: null
      });
    },
    
    /**
     * Sets an error result
     * @param {string} error The error message
     * @param {string} message Optional user-friendly message
     */
    setError: (error, message = null) => {
      set({
        success: false,
        error,
        message: message || error,
        isNative: true
      });
    },
    
    /**
     * Clears the result
     */
    clearResult: () => set(null),
    
    /**
     * Checks if there's a valid result
     * @returns {boolean} Whether there's a valid result
     */
    hasResult: () => {
      let currentValue = null;
      subscribe(value => { currentValue = value; })();
      return currentValue !== null && currentValue.success === true;
    },
    
    /**
     * Checks if there's an error
     * @returns {boolean} Whether there's an error
     */
    hasError: () => {
      let currentValue = null;
      subscribe(value => { currentValue = value; })();
      return currentValue !== null && currentValue.success === false;
    }
  };
}

export const conversionResult = createConversionResultStore();
