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
import electronClient from '$lib/api/electron';

function createConversionResultStore() {
  // Default state with null values
  const initialState = {
    success: false,
    blob: null,           // For web downloads
    contentType: null,    // For web downloads
    outputPath: null,     // For Electron file system
    items: [],            // Converted items
    isNative: false,      // Whether this is a native file path
    message: null,        // Success or error message
    error: null           // Error details if any
  };
  
  const { subscribe, set, update } = writable(null);
  
  // Check if we're running in Electron
  const isElectron = typeof window !== 'undefined' && 
    window.electronAPI !== undefined;

  return {
    subscribe,
    
    /**
     * Sets the conversion result
     * @param {Object} result The conversion result
     */
    setResult: (result) => {
      // Handle web result (blob-based)
      if (result.blob) {
        set({
          success: true,
          blob: result.blob,
          contentType: result.contentType,
          items: result.items || [],
          isNative: false,
          message: 'Conversion completed successfully',
          error: null
        });
      } 
      // Handle Electron result (path-based)
      else if (result.outputPath) {
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
          isNative: isElectron
        });
      }
      // Handle other result formats
      else {
        set({
          ...initialState,
          ...result,
          success: result.success !== false,
          isNative: isElectron
        });
      }
    },
    
    /**
     * Sets a native file path result (for Electron)
     * @param {string} outputPath The output file path
     * @param {Array} items The converted items
     * @param {string} message Optional success message
     */
    setNativeResult: (outputPath, items = [], message = null) => {
      set({
        success: true,
        outputPath,
        items,
        isNative: true,
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
        isNative: isElectron
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
