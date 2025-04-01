/**
 * Store to manage the welcome message state
 * 
 * This store tracks whether the user has seen the welcome messages across sessions.
 * It uses localStorage to persist the state and supports version-specific welcome messages.
 * This allows for showing initial welcome messages only once, while still enabling
 * update messages for new features or announcements.
 * 
 * Related files:
 * - CodexMdConverter.svelte: Uses this store to determine whether to show welcome messages
 * - WelcomeChat.svelte: Displays welcome messages and marks them as seen
 */

import { writable, derived } from 'svelte/store';

// Current app version - update this when you want to show update messages
const CURRENT_VERSION = '1.0.0';

// Message types
export const MESSAGE_TYPES = {
  WELCOME: 'welcome',
  UPDATE: 'update',
  ANNOUNCEMENT: 'announcement'
};

// Initialize from localStorage or with defaults
const initializeStore = () => {
  try {
    const storedData = localStorage.getItem('welcomeState');
    if (storedData) {
      return JSON.parse(storedData);
    }
  } catch (e) {
    console.error('Error reading welcome state from localStorage:', e);
  }
  
  // Default state if nothing in localStorage
  return {
    hasSeenWelcome: false,
    lastSeenVersion: null,
    seenMessageTypes: {}
  };
};

// Create the writable store with initial value
const welcomeStateStore = writable(initializeStore());

// Derived store for current session tracking
const hasSeenWelcomeThisSession = writable(false);

// Helper to update localStorage when store changes
const updateLocalStorage = (state) => {
  try {
    localStorage.setItem('welcomeState', JSON.stringify(state));
  } catch (e) {
    console.error('Error saving welcome state to localStorage:', e);
  }
};

// Public API
const welcomeState = {
  // Subscribe to the store
  subscribe: welcomeStateStore.subscribe,
  
  // Check if welcome messages should be shown (first time or new version)
  shouldShowWelcome: () => {
    let result = false;
    welcomeStateStore.update(state => {
      // Show welcome if user has never seen it or if there's a new version
      result = !state.hasSeenWelcome || state.lastSeenVersion !== CURRENT_VERSION;
      return state;
    });
    return result && !hasSeenWelcomeThisSession;
  },
  
  // Check if a specific message type should be shown
  shouldShowMessageType: (type) => {
    let result = false;
    welcomeStateStore.update(state => {
      result = !state.seenMessageTypes[type];
      return state;
    });
    return result && !hasSeenWelcomeThisSession;
  },
  
  // Mark welcome messages as seen
  markAsSeen: () => {
    hasSeenWelcomeThisSession.set(true);
    welcomeStateStore.update(state => {
      const newState = {
        ...state,
        hasSeenWelcome: true,
        lastSeenVersion: CURRENT_VERSION
      };
      updateLocalStorage(newState);
      return newState;
    });
  },
  
  // Mark a specific message type as seen
  markMessageTypeSeen: (type) => {
    welcomeStateStore.update(state => {
      const newState = {
        ...state,
        seenMessageTypes: {
          ...state.seenMessageTypes,
          [type]: true
        }
      };
      updateLocalStorage(newState);
      return newState;
    });
  },
  
  // Reset the store (for testing or when forced updates are needed)
  reset: () => {
    hasSeenWelcomeThisSession.set(false);
    welcomeStateStore.update(state => {
      const newState = {
        hasSeenWelcome: false,
        lastSeenVersion: null,
        seenMessageTypes: {}
      };
      updateLocalStorage(newState);
      return newState;
    });
  },
  
  // Reset only for the current session (for testing)
  resetSession: () => {
    hasSeenWelcomeThisSession.set(false);
  },
  
  // Get the current version
  getCurrentVersion: () => CURRENT_VERSION
};

export default welcomeState;
