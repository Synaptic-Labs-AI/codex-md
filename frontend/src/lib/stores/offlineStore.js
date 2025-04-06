/**
 * Offline Store
 * Manages offline state and initialization state for the application.
 * 
 * This store handles:
 * - Online/offline status
 * - API connectivity status
 * - Offline operation tracking
 * - Store initialization state
 * - Periodic status checks
 * 
 * Related files:
 * - components/OfflineStatusBar.svelte: UI for offline status
 * - services/api.js: API client with offline support
 */

import { writable, derived } from 'svelte/store';
import { browser } from '$app/environment';

// Create the base store
function createOfflineStore() {
  // Initial state with initialization tracking
  const initialState = {
    online: true,
    apiStatus: {},
    lastSync: null,
    pendingOperations: [],
    isInitialized: false,
    error: null
  };
  
  // Create the writable store
  const { subscribe, set, update } = writable(initialState);
  
  // Status check interval reference
  let statusCheckInterval;
  
  // Check status with electron
  async function checkStatus() {
    if (!browser || !window?.electron) return;
    
    try {
      const status = await window.electron.getOfflineStatus();
      update(state => ({
        ...state,
        online: status.online,
        apiStatus: status.apiStatus,
        error: null
      }));
    } catch (error) {
      console.error('Failed to get offline status:', error);
      update(state => ({
        ...state,
        error: error.message
      }));
    }
  }

  // Initialize store
  async function initialize() {
    if (!browser) return;

    try {
      if (!window?.electron) {
        update(state => ({
          ...state,
          isInitialized: true,
          error: 'Electron API not available'
        }));
        return;
      }

      window.electron.onReady(async () => {
        try {
          // Get initial status
          await checkStatus();
          
          // Start periodic checks
          statusCheckInterval = setInterval(checkStatus, 30000); // Check every 30s
          
          update(state => ({
            ...state,
            isInitialized: true,
            error: null
          }));
        } catch (error) {
          console.error('Failed to initialize offline store:', error);
          update(state => ({
            ...state,
            isInitialized: true,
            error: error.message
          }));
        }
      });
    } catch (error) {
      console.error('Failed to initialize offline store:', error);
      update(state => ({
        ...state,
        isInitialized: true,
        error: error.message
      }));
    }
  }

  // Clean up on window unload
  if (browser) {
    window.addEventListener('beforeunload', () => {
      if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
      }
    });
    
    // Initialize when in browser
    initialize();
  }
  
  return {
    subscribe,
    
    // Set online status
    setOnlineStatus: (online) => update(state => ({
      ...state,
      online,
      error: null
    })),
    
    // Set API status
    setApiStatus: (apiStatus) => update(state => ({
      ...state,
      apiStatus,
      error: null
    })),
    
    // Update last sync time
    updateLastSync: () => update(state => ({
      ...state,
      lastSync: new Date(),
      error: null
    })),
    
    // Add pending operation
    addPendingOperation: (operation) => update(state => ({
      ...state,
      pendingOperations: [...state.pendingOperations, {
        ...operation,
        timestamp: Date.now()
      }],
      error: null
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
    reset: () => {
      if (statusCheckInterval) {
        clearInterval(statusCheckInterval);
      }
      set({
        ...initialState,
        isInitialized: false,
        error: null
      });
      initialize();
    }
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
