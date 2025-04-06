/**
 * Welcome State Store
 * Manages welcome message display state and tracks initialization state
 * 
 * This store handles both persistent welcome message state and ensures proper
 * initialization with the electron IPC system. It supports version-specific
 * welcome messages and tracks initialization errors.
 * 
 * Related files:
 * - CodexMdConverter.svelte: Uses this store to determine whether to show welcome messages
 * - WelcomeChat.svelte: Displays welcome messages and marks them as seen
 */

import { writable } from 'svelte/store';
import { browser } from '$app/environment';
import { onMount } from 'svelte';

// Current app version - update this when you want to show update messages
const CURRENT_VERSION = '1.0.0';

// Message types
export const MESSAGE_TYPES = {
  WELCOME: 'welcome',
  UPDATE: 'update',
  ANNOUNCEMENT: 'announcement'
};

// Default state with initialization tracking
const defaultState = {
  hasSeenWelcome: false,
  lastSeenVersion: null,
  seenMessageTypes: {},
  isInitialized: false,
  error: null
};

// Create the writable store with initial value
const welcomeStateStore = writable(defaultState);

// Initialize store from electron settings
async function initializeStore() {
  // Skip initialization if not in browser environment
  if (!browser) return;
  
  // Only try to access electron API in browser environment
  if (!window?.electron) {
    console.warn('Electron API not available, using default welcome state');
    welcomeStateStore.update(state => ({
      ...state,
      isInitialized: true,
      error: 'Electron API not available'
    }));
    return;
  }

  try {
    window.electron.onReady(async () => {
      try {
        // Get stored state
        const storedState = await window.electron.getSetting('welcomeState');
        welcomeStateStore.update(state => ({
          ...(storedState || state),
          isInitialized: true,
          error: null
        }));
      } catch (e) {
        console.error('Error reading welcome state from settings:', e);
        welcomeStateStore.update(state => ({
          ...state,
          isInitialized: true,
          error: e.message
        }));
      }
    });
  } catch (e) {
    // This catch block handles errors with the onReady setup itself
    console.error('Error reading welcome state from settings:', e);
    welcomeStateStore.update(state => ({
      ...state,
      isInitialized: true,
      error: e.message
    }));
  }
}

// Derived store for current session tracking
const hasSeenWelcomeThisSession = writable(false);

// Helper to update electron settings when store changes
async function updateSettings(state) {
  // Skip if not in browser environment or not initialized
  if (!browser || !window?.electron) return;
  
  try {
    // Omit internal tracking state when saving
    const { isInitialized, error, ...stateToSave } = state;
    await window.electron.setSetting('welcomeState', stateToSave);
  } catch (e) {
    console.error('Error saving welcome state to settings:', e);
    welcomeStateStore.update(currentState => ({
      ...currentState,
      error: e.message
    }));
  }
}

// Initialize the store only in browser environment
if (browser) {
  initializeStore();
}

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
      updateSettings(newState);
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
      updateSettings(newState);
      return newState;
    });
  },
  
  // Reset the store (for testing or when forced updates are needed)
  reset: () => {
    hasSeenWelcomeThisSession.set(false);
    welcomeStateStore.update(() => {
      const newState = {
        hasSeenWelcome: false,
        lastSeenVersion: null,
        seenMessageTypes: {}
      };
      updateSettings(newState);
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
