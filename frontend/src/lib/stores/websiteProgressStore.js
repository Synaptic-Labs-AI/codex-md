/**
 * Website Progress Store
 * 
 * Manages the state of website conversion progress with a simplified
 * three-phase system: Prepare, Converting, and Complete.
 * Tracks progress and provides clear status updates for the UI.
 */

import { writable } from 'svelte/store';

// Simplified phase enum
export const Phase = {
  PREPARE: 'prepare',
  CONVERTING: 'converting',
  COMPLETE: 'complete'
};

// Initial state
const initialState = {
  phase: Phase.PREPARE,
  selectedDirectory: null,
  currentUrl: null,
  totalUrls: 0,
  processedUrls: 0,
  percentComplete: 0,
  success: true,
  error: null
};

function createWebsiteProgressStore() {
  const { subscribe, set, update } = writable(initialState);
  
  return {
    subscribe,
    
    // Phase transition methods
    setPhase(phase, message = '') {
      update(state => ({
        ...state,
        phase,
        currentActivity: message
      }));
    },

    start(url) {
      update(state => ({
        ...initialState,
        phase: Phase.PREPARE,
        websiteUrl: url,
        startTime: Date.now()
      }));
    },

    selectDirectory(path) {
      update(state => ({
        ...state,
        selectedDirectory: path,
        phase: Phase.PREPARE
      }));
    },

    startConverting() {
      update(state => ({
        ...state,
        phase: Phase.CONVERTING,
        processedUrls: 0,
        percentComplete: 0,
        success: true,
        error: null
      }));
    },

    finishConverting(success = true, error = null) {
      update(state => ({
        ...state,
        phase: Phase.COMPLETE,
        percentComplete: 100,
        success,
        error
      }));
    },

    // Progress update methods
    updateProgress(data) {
      update(state => {
        const percentComplete = data.totalUrls > 0 
          ? Math.min(Math.round((data.processedUrls / data.totalUrls) * 100), 99)
          : 0;

        return {
          ...state,
          currentUrl: data.currentUrl,
          totalUrls: data.totalUrls,
          processedUrls: data.processedUrls,
          percentComplete
        };
      });
    },

    // Error handling
    setError(error) {
      update(state => ({
        ...state,
        error,
        success: false
      }));
    },
    
    // Reset store
    reset() {
      set(initialState);
    }
  };
}

export const websiteProgress = createWebsiteProgressStore();
