/**
 * Welcome State Store
 * Manages welcome message display state using localStorage for reliable persistence
 * 
 * This store uses browser localStorage instead of Electron IPC for simplicity and reliability.
 * localStorage is perfect for UI state like welcome messages since it's:
 * - Synchronous (no race conditions)
 * - Reliable (browser handles persistence)
 * - Simple (no complex async initialization)
 * - Isolated (won't be affected by other settings corruption)
 * 
 * Related files:
 * - CodexMdConverter.svelte: Uses this store to determine whether to show welcome messages
 * - WelcomeChat.svelte: Displays welcome messages and marks them as seen
 */

import { writable } from 'svelte/store';

// Platform check
const isBrowser = typeof window !== 'undefined' && typeof localStorage !== 'undefined';

// Current app version - update this when you want to show update messages
const CURRENT_VERSION = '1.0.0';

// Message types
export const MESSAGE_TYPES = {
  WELCOME: 'welcome',
  UPDATE: 'update',
  ANNOUNCEMENT: 'announcement'
};

// LocalStorage keys
const STORAGE_KEYS = {
  WELCOME_SEEN: 'codex-welcome-seen',
  LAST_VERSION: 'codex-last-seen-version',
  SEEN_MESSAGE_TYPES: 'codex-seen-message-types'
};

// Helper functions for localStorage operations
function getFromStorage(key, fallback = null) {
  if (!isBrowser) return fallback;
  
  try {
    if (typeof localStorage === 'undefined') {
      console.warn(`[WelcomeState] localStorage is not available`);
      return fallback;
    }
    
    const value = localStorage.getItem(key);
    if (value === null) return fallback;
    
    // Try to parse as JSON, fall back to string value
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  } catch (error) {
    console.error(`[WelcomeState] Error reading localStorage key "${key}":`, error);
    return fallback;
  }
}

function setInStorage(key, value) {
  if (!isBrowser) return false;
  
  try {
    if (typeof localStorage === 'undefined') {
      console.warn(`[WelcomeState] localStorage is not available`);
      return false;
    }
    
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    localStorage.setItem(key, serialized);
    console.log(`[WelcomeState] Saved to localStorage: ${key} = ${value}`);
    return true;
  } catch (error) {
    console.error(`[WelcomeState] Error saving to localStorage key "${key}":`, error);
    return false;
  }
}

function removeFromStorage(key) {
  if (!isBrowser) return false;
  
  try {
    localStorage.removeItem(key);
    console.log(`[WelcomeState] Removed from localStorage: ${key}`);
    return true;
  } catch (error) {
    console.error(`[WelcomeState] Error removing from localStorage key "${key}":`, error);
    return false;
  }
}

// Initialize state from localStorage
function getInitialState() {
  const hasSeenWelcome = getFromStorage(STORAGE_KEYS.WELCOME_SEEN) === true;
  const lastSeenVersion = getFromStorage(STORAGE_KEYS.LAST_VERSION);
  const seenMessageTypes = getFromStorage(STORAGE_KEYS.SEEN_MESSAGE_TYPES, {});
  
  const state = {
    hasSeenWelcome,
    lastSeenVersion,
    seenMessageTypes,
    isInitialized: true,
    error: null
  };
  
  console.log('[WelcomeState] Initialized state from localStorage:', state);
  return state;
}

// Create the store with initial state from localStorage
const welcomeStateStore = writable(getInitialState());

// Public API
const welcomeState = {
  // Subscribe to the store
  subscribe: welcomeStateStore.subscribe,
  
  // Check if welcome messages should be shown (first time only)
  shouldShowWelcome: () => {
    const hasSeenWelcome = getFromStorage(STORAGE_KEYS.WELCOME_SEEN) === true;
    const result = !hasSeenWelcome;
    
    console.log('[WelcomeState] shouldShowWelcome check:', {
      hasSeenWelcome,
      result
    });
    
    return result;
  },
  
  // Check if a specific message type should be shown
  shouldShowMessageType: (type) => {
    const seenMessageTypes = getFromStorage(STORAGE_KEYS.SEEN_MESSAGE_TYPES, {});
    const result = !seenMessageTypes[type];
    
    console.log(`[WelcomeState] shouldShowMessageType(${type}):`, {
      seenMessageTypes,
      result
    });
    
    return result;
  },
  
  // Mark welcome messages as seen
  markAsSeen: () => {
    console.log('[WelcomeState] markAsSeen called');
    
    // Update localStorage
    setInStorage(STORAGE_KEYS.WELCOME_SEEN, true);
    setInStorage(STORAGE_KEYS.LAST_VERSION, CURRENT_VERSION);
    
    // Update store
    welcomeStateStore.update(state => ({
      ...state,
      hasSeenWelcome: true,
      lastSeenVersion: CURRENT_VERSION
    }));
  },
  
  // Mark a specific message type as seen
  markMessageTypeSeen: (type) => {
    console.log(`[WelcomeState] markMessageTypeSeen(${type}) called`);
    
    const seenMessageTypes = getFromStorage(STORAGE_KEYS.SEEN_MESSAGE_TYPES, {});
    seenMessageTypes[type] = true;
    setInStorage(STORAGE_KEYS.SEEN_MESSAGE_TYPES, seenMessageTypes);
    
    // Update store
    welcomeStateStore.update(state => ({
      ...state,
      seenMessageTypes
    }));
  },
  
  // Reset the store (for testing or when forced updates are needed)
  reset: () => {
    console.log('[WelcomeState] reset called');
    
    // Clear localStorage
    removeFromStorage(STORAGE_KEYS.WELCOME_SEEN);
    removeFromStorage(STORAGE_KEYS.LAST_VERSION);
    removeFromStorage(STORAGE_KEYS.SEEN_MESSAGE_TYPES);
    
    // Reset store
    welcomeStateStore.update(() => ({
      hasSeenWelcome: false,
      lastSeenVersion: null,
      seenMessageTypes: {},
      isInitialized: true,
      error: null
    }));
  },
  
  // Get the current version
  getCurrentVersion: () => CURRENT_VERSION,
  
  // Force show welcome (for testing)
  forceShow: () => {
    console.log('[WelcomeState] forceShow called');
    
    // Clear welcome state from localStorage
    removeFromStorage(STORAGE_KEYS.WELCOME_SEEN);
    removeFromStorage(STORAGE_KEYS.LAST_VERSION);
    
    // Update store
    welcomeStateStore.update(state => ({
      ...state,
      hasSeenWelcome: false,
      lastSeenVersion: null
    }));
  }
};

export default welcomeState;
