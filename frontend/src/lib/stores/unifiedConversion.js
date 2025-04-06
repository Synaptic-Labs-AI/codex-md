/**
 * Unified Conversion Store
 * 
 * A simplified store for managing conversion state.
 * Provides basic status tracking and essential methods.
 * 
 * Related files:
 * - frontend/src/lib/components/ConversionProgress.svelte
 * - frontend/src/lib/utils/conversion/manager/storeManager.js
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

// Legacy status mapping for backward compatibility
const legacyStatusMap = {
  'initializing': ConversionState.STATUS.INITIALIZING,
  'preparing': ConversionState.STATUS.PREPARING,
  'finding_sitemap': ConversionState.STATUS.PREPARING,
  'parsing_sitemap': ConversionState.STATUS.PREPARING,
  'crawling_pages': ConversionState.STATUS.PREPARING,
  'processing': ConversionState.STATUS.CONVERTING,
  'section': ConversionState.STATUS.CONVERTING,
  'converting': ConversionState.STATUS.CONVERTING,
  'generating_index': ConversionState.STATUS.CONVERTING,
  'completed': ConversionState.STATUS.COMPLETED,
  'complete': ConversionState.STATUS.COMPLETED,
  'error': ConversionState.STATUS.ERROR,
  'failed': ConversionState.STATUS.ERROR
};

// Initial state with essential properties
const initialState = {
  // Common properties
  status: ConversionState.STATUS.IDLE,
  progress: 0,
  error: null,
  startTime: null,
  completionTime: null,
  
  // File-specific properties
  currentFile: null,
  totalCount: 0,
  
  // Conversion type
  type: null
};

/**
 * Creates a simplified conversion store
 * @returns {Object} The conversion store
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
    startFileConversion: async (file) => {
      // Reset timer before starting a new conversion
      const { conversionTimer } = await import('./conversionTimer');
      conversionTimer.reset();
      
      set({
        ...initialState,
        status: ConversionState.STATUS.CONVERTING,
        type: ConversionState.TYPE.FILE,
        currentFile: file,
        startTime: Date.now()
      });
    },
    
    startBatchConversion: async (files) => {
      // Reset timer before starting a new conversion
      const { conversionTimer } = await import('./conversionTimer');
      conversionTimer.reset();
      
      set({
        ...initialState,
        status: ConversionState.STATUS.CONVERTING,
        type: ConversionState.TYPE.BATCH,
        totalCount: files.length,
        startTime: Date.now()
      });
    },
    
    startWebsiteConversion: async (url) => {
      // Reset timer before starting a new conversion
      const { conversionTimer } = await import('./conversionTimer');
      conversionTimer.reset();
      
      set({
        ...initialState,
        status: ConversionState.STATUS.CONVERTING, // Start directly in converting state
        type: ConversionState.TYPE.WEBSITE,
        currentFile: url,
        startTime: Date.now()
      });
    },
    
    // File-specific methods
    setCurrentFile: (currentFile) => 
      update(state => ({ ...state, currentFile })),
    
    // Complete conversion
    completeConversion: () => {
      update(state => ({
        ...state,
        status: ConversionState.STATUS.COMPLETED,
        progress: 100, // Explicitly set to 100%
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
     */
    batchUpdate: (updates) => {
      update(state => {
        // Create new state with updates
        const newState = {
          ...state,
          ...updates
        };

        // Map legacy status to normalized values if present
        if (updates.status) {
          const normalizedStatus = legacyStatusMap[updates.status] || updates.status;
          newState.status = normalizedStatus;
        }

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
export const conversionType = derived(unifiedConversion, $state => $state.type);
export const conversionStatus = derived(unifiedConversion, $state => $state.status);

// Derived store to check if conversion is complete
export const isConversionComplete = derived(
  unifiedConversion,
  $state => $state.status === ConversionState.STATUS.COMPLETED
);
