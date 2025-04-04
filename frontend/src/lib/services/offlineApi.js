/**
 * Offline-Aware API Client
 * Provides API functionality with offline support.
 * 
 * This service wraps the Electron IPC API and adds:
 * - Offline operation queueing
 * - Caching for offline access
 * - Automatic retry when back online
 * 
 * Related files:
 * - stores/offlineStore.js: Offline state management
 * - components/OfflineStatusBar.svelte: UI for offline status
 */

import { offlineStore, canPerformOnlineOperations } from '$lib/stores/offlineStore';
import { get } from 'svelte/store';

// Cache TTL defaults (in milliseconds)
const DEFAULT_CACHE_TTL = {
  SHORT: 5 * 60 * 1000, // 5 minutes
  MEDIUM: 30 * 60 * 1000, // 30 minutes
  LONG: 24 * 60 * 60 * 1000, // 1 day
  PERMANENT: null // No expiration
};

/**
 * Offline-aware API client
 */
class OfflineApi {
  constructor() {
    // We're now always in Electron environment
    
    // Subscribe to offline status changes
    this.unsubscribe = offlineStore.subscribe(state => {
      this.isOnline = state.online;
      
      // Process queued operations when coming back online
      if (this.isOnline && this.previousOnlineState === false) {
        this.processQueuedOperations();
      }
      
      this.previousOnlineState = this.isOnline;
    });
  }
  
  /**
   * Performs an API operation with offline support
   * @param {string} operationType Type of operation
   * @param {Function} onlineOperation Function to execute when online
   * @param {Object} options Operation options
   * @param {boolean} [options.queueIfOffline=true] Whether to queue the operation if offline
   * @param {string} [options.cacheKey] Key to use for caching results
   * @param {number} [options.cacheTTL] Cache time-to-live in milliseconds
   * @param {Array<string>} [options.requiredApis=[]] APIs required for this operation
   * @returns {Promise<any>} Operation result
   */
  async performOperation(operationType, onlineOperation, options = {}) {
    const {
      queueIfOffline = true,
      cacheKey = null,
      cacheTTL = null,
      requiredApis = []
    } = options;
    
    // Check if we can perform online operations
    const canPerformOnline = get(canPerformOnlineOperations(requiredApis));
    
    // If we're online and have required API access, perform the operation
    if (canPerformOnline) {
      try {
        const result = await onlineOperation();
        
        // Cache the result if caching is enabled
        if (cacheKey) {
          await window.electronAPI.cacheData(cacheKey, {
            data: result,
            timestamp: Date.now()
          });
        }
        
        return result;
      } catch (error) {
        // If the operation fails and we should queue it, add to queue
        if (queueIfOffline) {
          this.queueOperation(operationType, options);
        }
        
        // Try to get cached data
        if (cacheKey) {
          const cached = await this.getCachedData(cacheKey, cacheTTL);
          if (cached) {
            return cached;
          }
        }
        
        throw error;
      }
    } else {
      // We're offline or missing required API access
      
      // Queue the operation if enabled
      if (queueIfOffline) {
        this.queueOperation(operationType, options);
      }
      
      // Try to get cached data
      if (cacheKey) {
        const cached = await this.getCachedData(cacheKey, cacheTTL);
        if (cached) {
          return cached;
        }
      }
      
      // No cached data available
      throw new Error(`Cannot perform operation ${operationType} while offline`);
    }
  }
  
  /**
   * Queues an operation for later execution
   * @param {string} type Operation type
   * @param {Object} data Operation data
   * @returns {Promise<string>} Operation ID
   */
  async queueOperation(type, data) {
    try {
      const operation = {
        type,
        data,
        timestamp: Date.now()
      };
      
      // Add to store for UI
      offlineStore.addPendingOperation(operation);
      
      // Add to queue in main process
      const result = await window.electronAPI.queueOperation(operation);
      
      return result.operationId;
    } catch (error) {
      console.error('Failed to queue operation:', error);
      return null;
    }
  }
  
  /**
   * Processes queued operations
   * @private
   */
  async processQueuedOperations() {
    // The main process will automatically process queued operations
    // when coming back online, so we just need to update our store
    try {
      const operations = await window.electronAPI.getQueuedOperations();
      offlineStore.setPendingOperations(operations);
    } catch (error) {
      console.error('Failed to get queued operations:', error);
    }
  }
  
  /**
   * Gets cached data
   * @param {string} key Cache key
   * @param {number} [maxAge] Maximum age in milliseconds
   * @returns {Promise<any>} Cached data or null if not found or expired
   */
  async getCachedData(key, maxAge = null) {
    try {
      const result = await window.electronAPI.getCachedData(key, maxAge);
      return result.success ? result.data : null;
    } catch (error) {
      console.error('Failed to get cached data:', error);
      return null;
    }
  }
  
  /**
   * Invalidates cached data
   * @param {string} key Cache key
   * @returns {Promise<boolean>} Success status
   */
  async invalidateCache(key) {
    try {
      const result = await window.electronAPI.invalidateCache(key);
      return result.success;
    } catch (error) {
      console.error('Failed to invalidate cache:', error);
      return false;
    }
  }
  
  /**
   * Clears all cached data
   * @returns {Promise<boolean>} Success status
   */
  async clearCache() {
    try {
      const result = await window.electronAPI.clearCache();
      return result.success;
    } catch (error) {
      console.error('Failed to clear cache:', error);
      return false;
    }
  }
  
  /**
   * Gets the current online status
   * @returns {boolean} Whether the system is online
   */
  getOnlineStatus() {
    return this.isOnline;
  }
  
  /**
   * Cleans up resources
   */
  cleanup() {
    if (this.unsubscribe) {
      this.unsubscribe();
    }
  }
}

// Create singleton instance
const offlineApi = new OfflineApi();

// Example usage functions

/**
 * Converts a file with offline support
 * @param {string} filePath Path to file
 * @param {Object} options Conversion options
 * @returns {Promise<Object>} Conversion result
 */
export async function convertFile(filePath, options = {}) {
  return offlineApi.performOperation(
    'conversion',
    () => window.electronAPI.convertFile(filePath, options),
    {
      queueIfOffline: true,
      cacheKey: `conversion:${filePath}`,
      cacheTTL: DEFAULT_CACHE_TTL.MEDIUM,
      data: { filePath, options }
    }
  );
}

/**
 * Gets application settings with offline support
 * @param {string} key Setting key
 * @returns {Promise<any>} Setting value
 */
export async function getSetting(key) {
  return offlineApi.performOperation(
    'get-setting',
    () => window.electronAPI.getSetting(key),
    {
      queueIfOffline: false,
      cacheKey: `setting:${key}`,
      cacheTTL: DEFAULT_CACHE_TTL.LONG
    }
  );
}

/**
 * Sets application settings with offline support
 * @param {string} key Setting key
 * @param {any} value Setting value
 * @returns {Promise<void>}
 */
export async function setSetting(key, value) {
  return offlineApi.performOperation(
    'set-setting',
    () => {
      window.electronAPI.setSetting(key, value);
      return { success: true };
    },
    {
      queueIfOffline: true,
      data: { key, value }
    }
  );
}

export { offlineApi, DEFAULT_CACHE_TTL };
