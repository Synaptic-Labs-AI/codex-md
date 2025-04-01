// src/lib/stores/apiKey.js
import { writable, get } from 'svelte/store';

// Create a store for API keys
const apiKeys = writable({
  openai: '',
  mistral: ''
});

// Helper functions
export const getApiKey = (provider = 'openai') => get(apiKeys)[provider] || '';

export const setApiKey = (key, provider = 'openai') => {
  apiKeys.update(keys => {
    keys[provider] = key;
    return keys;
  });
};

// For backward compatibility
export const apiKey = {
  subscribe: callback => {
    return apiKeys.subscribe(keys => callback(keys.openai || ''));
  },
  set: value => setApiKey(value, 'openai')
};
