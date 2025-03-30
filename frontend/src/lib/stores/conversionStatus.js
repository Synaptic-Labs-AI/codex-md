// src/lib/stores/conversionStatus.js

import { writable, derived } from 'svelte/store';
import { files } from './files.js';

// Initial state with more granular progress tracking
const initialState = {
  status: 'ready',         // 'idle' | 'converting' | 'completed' | 'error' | 'stopped'
  progress: 0,            // Overall progress percentage
  currentFile: null,      // ID of the current file being converted
  error: null,            // Error message, if any
  completedCount: 0,      // Number of successfully converted files
  errorCount: 0,          // Number of files that failed to convert
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
    startConversion: () =>
      set({ 
        ...initialState, 
        status: 'converting' 
      }),
    completeConversion: () => {
      set({ 
        ...initialState, 
        status: 'completed', 
        progress: 100 
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
      update(state => ({ ...state, completedCount: state.completedCount + 1 }));
    },
    /**
     * Increments the errorCount
     */
    incrementError: () => {
      update(state => ({ ...state, errorCount: state.errorCount + 1 }));
    },
    /**
     * Resets the conversion counts
     */
    resetCounts: () => {
      update(state => ({ ...state, completedCount: 0, errorCount: 0 }));
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
