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
    WEBSITE: 'website'
  }
};


// Initial state with essential properties
const initialState = {
  // Common properties
  status: ConversionState.STATUS.IDLE,
  progress: 0,
  error: null,
  startTime: null,
  completionTime: null,
  elapsedSeconds: 0, // Track elapsed time directly in seconds
  
  // File-specific properties
  currentFile: null,
  totalCount: 0,
  
  // Conversion type
  type: null,
  
  // Error flags
  isTranscriptionError: false, // Flag to indicate if the error is a transcription error
  
  // Website-specific properties
  websiteData: {
    totalDiscovered: 0,
    processing: 0,
    completed: 0,
    currentPage: null,
    estimatedTimeRemaining: null,
    processingRate: 0
  },
  
  // Cancellation state
  isCancelling: false,
  partialResults: null
};

/**
 * Creates a simplified conversion store
 * @returns {Object} The conversion store
 */
function createUnifiedConversionStore() {
  const { subscribe, set, update } = writable(initialState);
  let completionCallbacks = [];
  let timerInterval = null;
  
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
        status: error ? ConversionState.STATUS.ERROR : state.status,
        isTranscriptionError: false // Reset transcription error flag for regular errors
      })),
    
    reset: () => set(initialState),
    
    // Timer methods
    startTimer: () => {
      // Clear any existing timer first
      if (timerInterval) {
        clearInterval(timerInterval);
      }
      
      // Start a new timer that updates elapsedSeconds every second
      const startTime = Date.now();
      update(state => ({ ...state, startTime, elapsedSeconds: 0 }));
      
      timerInterval = setInterval(() => {
        update(state => {
          const elapsedMs = Date.now() - state.startTime;
          const seconds = Math.floor(elapsedMs / 1000);
          return { ...state, elapsedSeconds: seconds };
        });
      }, 1000);
    },
    
    stopTimer: () => {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
      }
    },
    
    // Format the elapsed seconds into HH:MM:SS
    formatElapsedTime: (seconds) => {
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const s = seconds % 60;
      return [h, m, s].map(n => n.toString().padStart(2, '0')).join(':');
    },
    
    // Start different conversion types
    startFileConversion: async (file) => {
      // Set initial state
      set({
        ...initialState,
        status: ConversionState.STATUS.CONVERTING,
        type: ConversionState.TYPE.FILE,
        currentFile: file,
        startTime: Date.now()
      });
      
      // Start our timer
      unifiedConversion.startTimer();
    },
    
      
    startWebsiteConversion: async (url) => {
      // Set initial state
      set({
        ...initialState,
        status: ConversionState.STATUS.CONVERTING, // Start directly in converting state
        type: ConversionState.TYPE.WEBSITE,
        currentFile: url,
        startTime: Date.now()
      });
      
      // Start our timer
      unifiedConversion.startTimer();
    },
    
    // File-specific methods
    setCurrentFile: (currentFile) => 
      update(state => ({ ...state, currentFile })),
    
    // Complete conversion
    completeConversion: () => {
      // Stop the timer
      unifiedConversion.stopTimer();
      
      // Update state with completion info
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


        return newState;
      });
    },
    
    // Website-specific methods
    updateWebsiteProgress: (websiteData) => {
      update(state => ({
        ...state,
        websiteData: {
          ...state.websiteData,
          ...websiteData
        }
      }));
    },
    
    setCurrentPage: (pageInfo) => {
      update(state => ({
        ...state,
        websiteData: {
          ...state.websiteData,
          currentPage: pageInfo
        }
      }));
    },
    
    // Cancellation methods
    startCancellation: () => {
      update(state => ({
        ...state,
        isCancelling: true,
        status: ConversionState.STATUS.CLEANING_UP
      }));
    },
    
    cancelWithPartialResults: (partialResults) => {
      // Stop the timer
      unifiedConversion.stopTimer();
      
      update(state => ({
        ...state,
        status: ConversionState.STATUS.CANCELLED,
        isCancelling: false,
        partialResults,
        completionTime: Date.now()
      }));
    },
    
    // Smooth progress updates for liquid effect
    setProgress: (progress) => {
      update(state => {
        // Only allow progress to increase or stay same (no backwards movement)
        const newProgress = Math.min(Math.max(progress, state.progress), 100);
        return { ...state, progress: newProgress };
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
export const isTranscriptionError = derived(unifiedConversion, $state => $state.isTranscriptionError);

// Website-specific derived stores
export const websiteData = derived(unifiedConversion, $state => $state.websiteData);
export const isWebsiteConversion = derived(unifiedConversion, $state => $state.type === ConversionState.TYPE.WEBSITE);
export const isCancelling = derived(unifiedConversion, $state => $state.isCancelling);

// Derived store to check if conversion is complete
export const isConversionComplete = derived(
  unifiedConversion,
  $state => $state.status === ConversionState.STATUS.COMPLETED
);
