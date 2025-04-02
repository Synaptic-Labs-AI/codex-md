/**
 * Website Progress Store
 * 
 * A simplified store for tracking website conversion progress.
 * Replaces the complex state machine approach with a more direct
 * and user-focused progress tracking system.
 */

import { writable } from 'svelte/store';

// Simple phase enum
export const Phase = {
  INITIALIZING: 'initializing',
  DISCOVERING: 'discovering',
  PROCESSING: 'processing',
  FINALIZING: 'finalizing',
  COMPLETED: 'completed',
  ERROR: 'error'
};

// Initial state
const initialState = {
  phase: Phase.INITIALIZING,
  pagesFound: 0,
  pagesProcessed: 0,
  overallProgress: 0,
  currentActivity: 'Initializing...',
  error: null,
  startTime: null,
  websiteUrl: null
};

function createWebsiteProgressStore() {
  const { subscribe, set, update } = writable(initialState);
  
  return {
    subscribe,
    
    // Simple update method - no validation, just update
    updateProgress(data) {
      update(state => ({
        ...state,
        ...data,
        // Always calculate overall progress based on pages
        overallProgress: data.pagesFound > 0 
          ? Math.min(Math.round((data.pagesProcessed / data.pagesFound) * 100), 99)
          : data.overallProgress || state.overallProgress
      }));
    },
    
    // Set phase with activity
    setPhase(phase, activity) {
      update(state => ({
        ...state,
        phase,
        currentActivity: activity || state.currentActivity,
        // Auto-set progress to 100% when completed
        overallProgress: phase === Phase.COMPLETED ? 100 : state.overallProgress
      }));
    },
    
    // Start conversion
    start(url) {
      set({
        ...initialState,
        phase: Phase.INITIALIZING,
        startTime: Date.now(),
        websiteUrl: url,
        currentActivity: `Starting conversion of ${url}...`
      });
    },
    
    // Set error
    setError(message) {
      update(state => ({
        ...state,
        phase: Phase.ERROR,
        error: message,
        currentActivity: `Error: ${message}`
      }));
    },
    
    // Reset store
    reset() {
      set(initialState);
    }
  };
}

export const websiteProgress = createWebsiteProgressStore();
