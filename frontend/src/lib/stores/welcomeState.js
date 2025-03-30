/**
 * Store to manage the welcome message state
 * 
 * This store tracks whether the user has seen the welcome messages during the current session.
 * It ensures that welcome messages only appear when the user first opens the app,
 * not when they navigate between pages.
 * 
 * Related files:
 * - CodexMdConverter.svelte: Uses this store to determine whether to show welcome messages
 */

import { writable } from 'svelte/store';

// Create a writable store with initial value of false (messages not shown yet)
const hasSeenWelcomeMessages = writable(false);

export default {
  // Subscribe to the store
  subscribe: hasSeenWelcomeMessages.subscribe,
  
  // Mark welcome messages as seen
  markAsSeen: () => {
    hasSeenWelcomeMessages.set(true);
  },
  
  // Reset the store (for testing or when app is restarted)
  reset: () => {
    hasSeenWelcomeMessages.set(false);
  }
};
