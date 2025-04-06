/**
 * Timer store for tracking conversion duration
 * 
 * This store manages the timer functionality for conversion processes.
 * It provides methods to start, stop, capture final time, and reset the timer.
 * The timer displays in HH:MM:SS format and tracks elapsed seconds.
 * 
 * Related files:
 * - frontend/src/lib/components/ConversionProgress.svelte: Primary consumer
 * - frontend/src/lib/components/common/Timer.svelte: Display component
 */

import { writable } from 'svelte/store';

function createTimer() {
  const { subscribe, set, update } = writable({
    startTime: null,
    elapsedTime: '00:00:00',
    isRunning: false,
    secondsCount: 0,
    finalTime: null
  });

  let intervalId = null;

  function formatTime(ms) {
    if (!ms) return '00:00:00';
    const seconds = Math.floor(ms / 1000);
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return [h, m, s].map(n => n.toString().padStart(2, '0')).join(':');
  }

  // Helper function to get current store value synchronously
  let currentState = {
    startTime: null,
    elapsedTime: '00:00:00',
    isRunning: false,
    secondsCount: 0,
    finalTime: null
  };
  
  // Subscribe to keep currentState in sync
  const unsubscribe = subscribe(state => {
    currentState = state;
  });

  return {
    subscribe,
    getFinalTimeSync: () => {
      const elapsedMs = currentState.startTime ? (Date.now() - currentState.startTime) : 0;
      return formatTime(elapsedMs);
    },
    start: () => {
      // Clear any existing interval first to prevent duplicates
      if (intervalId) clearInterval(intervalId);
      
      update(state => ({ 
        ...state, 
        startTime: Date.now(), 
        isRunning: true,
        finalTime: null // Clear any previous final time
      }));
      
      intervalId = setInterval(() => {
        update(state => {
          if (!state.isRunning) return state;
          
          const elapsedMs = Date.now() - state.startTime;
          const seconds = Math.floor(elapsedMs / 1000);
          return {
            ...state,
            elapsedTime: formatTime(elapsedMs),
            secondsCount: seconds
          };
        });
      }, 1000);
    },
    
    // Capture final time and stop the timer
    captureAndStop: () => {
      if (intervalId) clearInterval(intervalId);
      
      update(state => {
        // Calculate one final time
        const elapsedMs = state.startTime ? (Date.now() - state.startTime) : 0;
        const formattedTime = formatTime(elapsedMs);
        
        return { 
          ...state, 
          isRunning: false,
          elapsedTime: formattedTime,
          finalTime: formattedTime
        };
      });
    },
    
    // Just stop the timer without capturing final time
    stop: () => {
      if (intervalId) clearInterval(intervalId);
      update(state => ({ ...state, isRunning: false }));
    },
    
    // Complete reset of timer state
    reset: () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      
      // Reset the store state
      set({ 
        startTime: null, 
        elapsedTime: '00:00:00', 
        isRunning: false, 
        secondsCount: 0,
        finalTime: null
      });
      
      // Also reset the internal currentState tracking
      currentState = {
        startTime: null,
        elapsedTime: '00:00:00',
        isRunning: false,
        secondsCount: 0,
        finalTime: null
      };
    },
    
    // Cleanup subscription
    cleanup: () => {
      if (unsubscribe) {
        unsubscribe();
      }
    }
  };
}

export const conversionTimer = createTimer();
