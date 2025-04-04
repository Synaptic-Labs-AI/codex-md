/**
 * Unified Conversion Store
 * 
 * A centralized store for managing all conversion-related state including:
 * - File conversions
 * - Batch conversions
 * - Website conversions
 * 
 * This store replaces the separate conversionStatus and websiteProgressStore
 * with a unified API and state model.
 * 
 * Related files:
 * - frontend/src/lib/utils/conversion/manager/storeManager.js
 * - frontend/src/lib/components/ConversionStatus.svelte
 * - frontend/src/lib/components/WebsiteProgressDisplay.svelte
 */

import { writable, derived } from 'svelte/store';

// Unified conversion state constants
export const ConversionState = {
  // Shared status enum for all conversion types
  STATUS: {
    IDLE: 'idle',
    INITIALIZING: 'initializing',
    PREPARING: 'preparing',
    CONVERTING: 'converting',
    COMPLETED: 'completed',
    ERROR: 'error',
    CANCELLED: 'cancelled',
    CLEANING_UP: 'cleaning_up'
  },
  
  // Conversion types
  TYPE: {
    FILE: 'file',
    BATCH: 'batch',
    WEBSITE: 'website'
  }
};

// Initial state with all possible properties
const initialState = {
  // Common properties
  status: ConversionState.STATUS.IDLE,
  progress: 0,
  error: null,
  startTime: null,
  completionTime: null,
  
  // File-specific properties
  currentFile: null,
  completedCount: 0,
  errorCount: 0,
  processedCount: 0,
  totalCount: 0,
  chunkProgress: 0,
  
  // Website-specific properties
  websiteUrl: null,
  currentUrl: null,
  totalUrls: 0,
  processedUrls: 0,
  selectedDirectory: null,
  
  // Conversion type
  type: null
};

/**
 * Creates a unified conversion store
 * @returns {Object} The unified conversion store
 */
function createUnifiedConversionStore() {
  const { subscribe, set, update } = writable(initialState);
  let completionCallbacks = [];
  
  return {
    subscribe,
    
    // Common methods
    setStatus: (status) => 
      update(state => ({ ...state, status })),
    
    setProgress: (progress) => 
      update(state => ({ ...state, progress: Math.min(progress, 100) })),
    
    setError: (error) => 
      update(state => ({ 
        ...state, 
        error, 
        status: error ? ConversionState.STATUS.ERROR : state.status 
      })),
    
    reset: () => set(initialState),
    
    // Start different conversion types
    startFileConversion: (file) => {
      set({
        ...initialState,
        status: ConversionState.STATUS.CONVERTING,
        type: ConversionState.TYPE.FILE,
        currentFile: file,
        startTime: Date.now()
      });
    },
    
    startBatchConversion: (files) => {
      set({
        ...initialState,
        status: ConversionState.STATUS.CONVERTING,
        type: ConversionState.TYPE.BATCH,
        totalCount: files.length,
        startTime: Date.now()
      });
    },
    
    startWebsiteConversion: (url) => {
      set({
        ...initialState,
        status: ConversionState.STATUS.PREPARING,
        type: ConversionState.TYPE.WEBSITE,
        websiteUrl: url,
        startTime: Date.now()
      });
    },
    
    // File-specific methods
    setCurrentFile: (currentFile) => 
      update(state => ({ ...state, currentFile })),
    
    incrementCompleted: () => {
      update(state => {
        const completedCount = state.completedCount + 1;
        const processedCount = state.processedCount + 1;
        const progress = state.totalCount > 0 
          ? Math.min(Math.round((processedCount / state.totalCount) * 100), 99)
          : 0;
          
        return { 
          ...state, 
          completedCount,
          processedCount,
          progress
        };
      });
    },
    
    incrementError: () => {
      update(state => {
        const errorCount = state.errorCount + 1;
        const processedCount = state.processedCount + 1;
        
        return { 
          ...state, 
          errorCount,
          processedCount
        };
      });
    },
    
    setChunkProgress: (progress) => {
      update(state => ({ ...state, chunkProgress: Math.min(progress, 100) }));
    },
    
    // Website-specific methods
    updateWebsiteProgress: (data) => {
      update(state => {
        if (state.type !== ConversionState.TYPE.WEBSITE) return state;
        
        const percentComplete = data.totalUrls > 0 
          ? Math.min(Math.round((data.processedUrls / data.totalUrls) * 100), 99)
          : 0;
          
        return {
          ...state,
          currentUrl: data.currentUrl,
          totalUrls: data.totalUrls,
          processedUrls: data.processedUrls,
          progress: percentComplete
        };
      });
    },
    
    selectDirectory: (path) => {
      update(state => ({
        ...state,
        selectedDirectory: path
      }));
    },
    
    // Complete conversion
    completeConversion: () => {
      update(state => ({
        ...state,
        status: ConversionState.STATUS.COMPLETED,
        progress: 100,
        completionTime: Date.now()
      }));
      
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
        console.log('[UnifiedConversion] Batch update:', {
          updates,
          status,
          timestamp: new Date().toISOString()
        });
        return newState;
      });
    }
  };
}

// Create and export the store
export const unifiedConversion = createUnifiedConversionStore();

// Derived stores for easy access to specific properties
export const conversionProgress = derived(unifiedConversion, $state => $state.progress);
export const currentFile = derived(unifiedConversion, $state => $state.currentFile);
export const conversionError = derived(unifiedConversion, $state => $state.error);
export const completedCount = derived(unifiedConversion, $state => $state.completedCount);
export const errorCount = derived(unifiedConversion, $state => $state.errorCount);
export const conversionType = derived(unifiedConversion, $state => $state.type);
export const conversionStatus = derived(unifiedConversion, $state => $state.status);

// Derived store to check if conversion is complete
export const isConversionComplete = derived(
  unifiedConversion,
  $state => $state.status === ConversionState.STATUS.COMPLETED
);

// Derived store for website-specific properties
export const websiteProgress = derived(
  unifiedConversion,
  $state => ({
    phase: $state.status,
    websiteUrl: $state.websiteUrl,
    currentUrl: $state.currentUrl,
    totalUrls: $state.totalUrls,
    processedUrls: $state.processedUrls,
    percentComplete: $state.progress,
    selectedDirectory: $state.selectedDirectory,
    error: $state.error
  })
);
