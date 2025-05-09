/**
 * API Key Store
 * Manages API keys and initialization state
 * 
 * This store handles:
 * - API key management for multiple providers
 * - Electron IPC integration
 * - Initialization state tracking
 * - Error handling
 * - Backward compatibility
 * 
 * Related files:
 * - components/ApiKeyInput.svelte: UI for API key management
 * - services/api.js: API client that uses the stored keys
 */

import { writable, get, derived } from 'svelte/store';

// Platform check
const isBrowser = typeof window !== 'undefined';

// Initial state
const initialState = {
  keys: {
    deepgram: '',
    mistral: ''
  },
  isInitialized: false,
  error: null
};

// Create store with initialization tracking
const apiKeyStore = writable(initialState);

// Initialize store from electron
async function initializeStore() {
  if (!isBrowser) return;

  try {
    if (!window?.electron) {
      apiKeyStore.update(state => ({
        ...state,
        isInitialized: true,
        error: 'Electron API not available'
      }));
      return;
    }

    window.electron.onReady(async () => {
      try {
        // Check existing keys
        const [deepgramExists, mistralExists] = await Promise.all([
          window.electron.checkApiKeyExists('deepgram'),
          window.electron.checkApiKeyExists('mistral')
        ]);

        // Get keys if they exist
        const keys = {
          deepgram: deepgramExists.exists ? (await window.electron.getApiKey('deepgram')).key || '' : '',
          mistral: mistralExists.exists ? (await window.electron.getApiKey('mistral')).key || '' : ''
        };

        apiKeyStore.update(state => ({
          ...state,
          keys,
          isInitialized: true,
          error: null
        }));
      } catch (error) {
        console.error('Failed to load API keys:', error);
        apiKeyStore.update(state => ({
          ...state,
          isInitialized: true,
          error: error.message
        }));
      }
    });
  } catch (error) {
    console.error('Failed to initialize API key store:', error);
    apiKeyStore.update(state => ({
      ...state,
      isInitialized: true,
      error: error.message
    }));
  }
}

// Initialize the store in browser environment
if (isBrowser) {
  initializeStore();
}

// Helper functions with electron integration
export async function getApiKey(provider = 'deepgram') {
  const state = get(apiKeyStore);
  return state.keys[provider] || '';
}

export async function setApiKey(key, provider = 'deepgram') {
  if (!isBrowser || !window?.electron) return;

  try {
    await window.electron.saveApiKey(key, provider);
    
    apiKeyStore.update(state => ({
      ...state,
      keys: {
        ...state.keys,
        [provider]: key
      },
      error: null
    }));
  } catch (error) {
    console.error('Failed to save API key:', error);
    apiKeyStore.update(state => ({
      ...state,
      error: error.message
    }));
  }
}

// Derived store for initialization status
export const isInitialized = derived(
  apiKeyStore,
  $store => $store.isInitialized
);

// Derived store for error state
export const apiKeyError = derived(
  apiKeyStore,
  $store => $store.error
);

// For backward compatibility with older components that expect 'apiKey'
export const apiKey = {
  subscribe: callback => {
    return apiKeyStore.subscribe(state => callback(state.keys.deepgram || ''));
  },
  set: value => setApiKey(value, 'deepgram')
};

// Export store for direct subscription
export default apiKeyStore;