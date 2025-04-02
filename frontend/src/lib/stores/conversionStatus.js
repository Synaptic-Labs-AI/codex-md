// src/lib/stores/conversionStatus.js

import { writable, derived } from 'svelte/store';
import { files } from './files.js';

// Initial state with more granular progress tracking
const initialState = {
  status: 'ready',         // 'idle' | 'initializing' | 'initializing_workers' | 'selecting_output' | 'preparing' | 'converting' | 'cleaning_up' | 'completed' | 'error' | 'stopped' | 'cancelled'
  progress: 0,            // Overall progress percentage
  currentFile: null,      // Name of the current file being converted
  error: null,            // Error message, if any
  completedCount: 0,      // Number of successfully converted files
  errorCount: 0,          // Number of files that failed to convert
  processedCount: 0,      // Total files processed so far
  totalCount: 0,         // Total number of files to process
  chunkProgress: 0,      // Progress of current file chunking (0-100)
  completionTimestamp: null, // Timestamp when conversion completed
};

/**
 * Creates a conversionStatus store with enhanced capabilities
 * @returns {Object} The conversionStatus store instance
 */
function createConversionStore() {
  const { subscribe, set, update } = writable(initialState);
  let completionCallbacks = [];

  return {
    subscribe,
    setStatus: (status) =>
      update((state) => ({ ...state, status })),
    setProgress: (progress) =>
      update((state) => ({ ...state, progress })),
    setCurrentFile: (currentFile) =>
      update((state) => ({ ...state, currentFile })),
    setError: (error) =>
      update((state) => ({ ...state, error, status: error ? 'error' : state.status })),
    reset: () => set(initialState),
    startConversion: (totalFiles) =>
      set({ 
        ...initialState, 
        status: 'converting',
        totalCount: totalFiles
      }),
    completeConversion: () => {
      set({ 
        ...initialState, 
        status: 'completed', 
        progress: 100,
        completionTimestamp: Date.now()
      });
      // Trigger completion callbacks
      completionCallbacks.forEach(callback => callback());
    },
    /**
     * Adds a completion callback
     * @param {Function} callback - The callback function to execute upon completion
     */
    onComplete: (callback) => {
      completionCallbacks.push(callback);
    },
    /**
     * Adds a progress update
     * @param {number} value - The new progress value
     */
    updateProgress: (value) => {
      update(state => ({ ...state, progress: value }));
    },
    /**
     * Increments the completedCount
     */
    incrementCompleted: () => {
      update(state => ({ 
        ...state, 
        completedCount: state.completedCount + 1,
        processedCount: state.processedCount + 1
      }));
    },
    /**
     * Increments the errorCount
     */
    incrementError: () => {
      update(state => ({ 
        ...state, 
        errorCount: state.errorCount + 1,
        processedCount: state.processedCount + 1
      }));
    },
    /**
     * Resets the conversion counts
     */
    resetCounts: () => {
      update(state => ({ 
        ...state, 
        completedCount: 0, 
        errorCount: 0,
        processedCount: 0,
        totalCount: 0,
        chunkProgress: 0
      }));
    },

    // Update chunking progress for the current file
    setChunkProgress: (progress) => {
      update(state => ({ ...state, chunkProgress: Math.min(progress, 100) }));
    },

    /**
     * Batch updates multiple state properties atomically
     * @param {Object} updates State updates to apply
     * @param {string} [status] Optional status update
     */
    batchUpdate: (updates, status = null) => {
      update(state => {
        const newState = { ...state, ...updates };
        if (status) {
          newState.status = status;
        }
        console.log('[ConversionStatus] Batch update:', {
          updates,
          status,
          timestamp: new Date().toISOString()
        });
        return newState;
      });
    },

    // Legacy method for backward compatibility - simplified
    startWebsiteConversion: (url, pathFilter = null) => {
      console.log('[ConversionStatus] Starting website conversion (legacy method):', {
        url,
        pathFilter,
        timestamp: new Date().toISOString()
      });
      
      // This method is kept for backward compatibility but doesn't do anything
      // Website conversions are now handled by the websiteProgress store
    },

    // Legacy method for backward compatibility - simplified
    setWebsiteStatus: (status, details = {}, skipTransitionCheck = false) => {
      console.log('[ConversionStatus] Setting website status (legacy method):', {
        status,
        details,
        timestamp: new Date().toISOString()
      });
      
      // This method is kept for backward compatibility but doesn't do anything
      // Website conversions are now handled by the websiteProgress store
    }
  };
}

export const conversionStatus = createConversionStore();

// Derived stores for easy access to specific properties
export const conversionProgress = derived(conversionStatus, $status => $status.progress);
export const currentFile = derived(conversionStatus, $status => $status.currentFile);
export const conversionError = derived(conversionStatus, $status => $status.error);
export const completedCount = derived(conversionStatus, $status => $status.completedCount);
export const errorCount = derived(conversionStatus, $status => $status.errorCount);

// Derived store to check if all files are processed
export const isConversionComplete = derived(
  [conversionStatus, files],
  ([$conversionStatus, $files]) => {
    return $files.length > 0 && 
           ($files.filter(f => f.status === 'completed').length + $files.filter(f => f.status === 'error').length) === $files.length;
  }
);
