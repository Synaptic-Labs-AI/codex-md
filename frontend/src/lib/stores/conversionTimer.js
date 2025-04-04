/**
 * Timer store for tracking conversion duration
 * Related files:
 * - frontend/src/lib/components/ConversionProgress.svelte: Primary consumer
 */

import { writable } from 'svelte/store';

function createTimer() {
  const { subscribe, set, update } = writable({
    startTime: null,
    elapsedTime: '00:00:00',
    isRunning: false,
    secondsCount: 0
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

  return {
    subscribe,
    start: () => {
      update(state => ({ ...state, startTime: Date.now(), isRunning: true }));
      intervalId = setInterval(() => {
        update(state => {
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
    stop: () => {
      if (intervalId) clearInterval(intervalId);
      update(state => ({ ...state, isRunning: false }));
    },
    reset: () => {
      if (intervalId) clearInterval(intervalId);
      set({ startTime: null, elapsedTime: '00:00:00', isRunning: false, secondsCount: 0 });
    }
  };
}

export const conversionTimer = createTimer();
