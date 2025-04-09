/**
 * Upload Store
 * Manages the state for file uploads and URL inputs.
 * Handles drag-and-drop states, error messages, and feedback.
 */

import { writable } from 'svelte/store';

// Platform check
const isBrowser = typeof window !== 'undefined';

function createUploadStore() {
  // Clear store on page load
  if (isBrowser) {
    console.log('🧹 Clearing upload store on page load');
  }

  const { subscribe, update, set } = writable({
    activeTab: 'single',
    dragOver: false,
    urlInput: '',
    errorMessage: '',
    message: '',
    messageType: '',
    feedbackTimeout: null
  });

  return {
    subscribe,
    setActiveTab: (tab) => update(state => ({ ...state, activeTab: tab })),
    setDragOver: (value) => update(state => ({ ...state, dragOver: value })),
    setUrlInput: (value) => update(state => ({ ...state, urlInput: value })),
    setError: (message) => update(state => ({ ...state, errorMessage: message })),
    clearError: () => update(state => ({ ...state, errorMessage: '' })),
    setMessage: (message, type = 'info') => update(state => ({ 
      ...state, 
      message,
      messageType: type 
    })),
    clearMessage: () => update(state => ({ 
      ...state, 
      message: '',
      messageType: '' 
    })),
    reset: () => set({
      activeTab: 'single',
      dragOver: false,
      urlInput: '',
      errorMessage: '',
      message: '',
      messageType: '',
      feedbackTimeout: null
    })
  };
}

export const uploadStore = createUploadStore();
