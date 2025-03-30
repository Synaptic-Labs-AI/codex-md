/**
 * Offline Store
 * Manages offline state for the application.
 * 
 * This store handles:
 * - Online/offline status
 * - API connectivity status
 * - Offline operation tracking
 * 
 * Related files:
 * - components/OfflineStatusBar.svelte: UI for offline status
 * - services/api.js: API client with offline support
 */

import { writable, derived } from 'svelte/store';

// Create the base store
function createOfflineStore() {
  // Initial state
  const initialState = {
    online: true,
    apiStatus: {},
    lastSync: null,
    pendingOperations: []
  };
  
  // Create the writable store
  const { subscribe, set, update } = writable(initialState);
  
  return {
    subscribe,
    
    // Set online status
    setOnlineStatus: (online) => update(state => ({
      ...state,
      online
    })),
    
    // Set API status
    setApiStatus: (apiStatus) => update(state => ({
      ...state,
      apiStatus
    })),
    
    // Update last sync time
    updateLastSync: () => update(state => ({
      ...state,
      lastSync: new Date()
    })),
    
    // Add pending operation
    addPendingOperation: (operation) => update(state => ({
      ...state,
      pendingOperations: [...state.pendingOperations, {
        ...operation,
        timestamp: Date.now()
      }]
    })),
    
    // Remove pending operation
    removePendingOperation: (operationId) => update(state => ({
      ...state,
      pendingOperations: state.pendingOperations.filter(op => op.id !== operationId)
    })),
    
    // Set pending operations
    setPendingOperations: (operations) => update(state => ({
      ...state,
      pendingOperations: operations
    })),
    
    // Reset store to initial state
    reset: () => set(initialState)
  };
}

// Create derived stores for specific aspects
export const offlineStore = createOfflineStore();

// Derived store for checking if any API is available
export const anyApiAvailable = derived(
  offlineStore,
  $offlineStore => Object.values($offlineStore.apiStatus).some(status => status === true)
);

// Derived store for checking if specific API is available
export function apiAvailable(apiName) {
  return derived(
    offlineStore,
    $offlineStore => $offlineStore.apiStatus[apiName] === true
  );
}

// Derived store for pending operations count
export const pendingOperationsCount = derived(
  offlineStore,
  $offlineStore => $offlineStore.pendingOperations.length
);

// Helper function to check if we can perform online operations
export function canPerformOnlineOperations(requiredApis = []) {
  return derived(
    offlineStore,
    $offlineStore => {
      // Must be online
      if (!$offlineStore.online) return false;
      
      // If no specific APIs required, just check online status
      if (requiredApis.length === 0) return true;
      
      // Check if all required APIs are available
      return requiredApis.every(api => $offlineStore.apiStatus[api] === true);
    }
  );
}
