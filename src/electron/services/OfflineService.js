/**
 * OfflineService.js
 * Provides offline capabilities for the Electron application.
 * 
 * This service manages:
 * - Caching system for local operations
 * - Operation queue for pending tasks
 * - State persistence for offline mode
 * - Sync mechanisms for reconnection
 * 
 * Related files:
 * - FileSystemService.js: Native file operations
 * - ElectronConversionService.js: Conversion operations
 * - ipc/handlers/offline/index.js: IPC handlers for offline features
 */

const path = require('path');
const fs = require('fs-extra');
const { app } = require('electron');
const { createStore } = require('../utils/storeFactory');
const FileSystemService = require('./FileSystemService');

class OfflineService {
  constructor() {
    this.fileSystem = FileSystemService;
    this.cacheDir = path.join(app.getPath('userData'), 'cache');
    this.operationQueue = [];
    this.isOnline = true;
    this.listeners = new Set();
    
    // Initialize encrypted store for offline data with error handling
    this.store = createStore('offline-data', {
      encryptionKey: process.env.STORE_ENCRYPTION_KEY
    });
    
    this.setupCacheDirectory();
    this.loadQueuedOperations();
    this.setupNetworkListeners();
  }

  /**
   * Sets up the cache directory for offline operations
   * @private
   */
  async setupCacheDirectory() {
    try {
      await fs.ensureDir(this.cacheDir);
      console.log('📁 Offline cache directory ready:', this.cacheDir);
    } catch (error) {
      console.error('❌ Failed to set up cache directory:', error);
    }
  }

  /**
   * Loads previously queued operations from persistent storage
   * @private
   */
  loadQueuedOperations() {
    try {
      const savedQueue = this.store.get('operationQueue', []);
      this.operationQueue = savedQueue;
      console.log(`📋 Loaded ${savedQueue.length} queued operations`);
    } catch (error) {
      console.error('❌ Failed to load queued operations:', error);
      this.operationQueue = [];
    }
  }

  /**
   * Sets up network status change listeners
   * @private
   */
  setupNetworkListeners() {
    const { net } = require('electron');
    
    // Check initial online status
    this.isOnline = net.isOnline();
    
    // Set up periodic checks for network status
    this.networkCheckInterval = setInterval(() => {
      const online = net.isOnline();
      if (online !== this.isOnline) {
        this.handleOnlineStatusChange(online);
      }
    }, 10000); // Check every 10 seconds
    
    // Periodically check connectivity to APIs
    this.apiCheckInterval = setInterval(() => this.checkApiConnectivity(), 60000);
  }

  /**
   * Handles changes in online status
   * @param {boolean} online Whether the system is online
   * @private
   */
  async handleOnlineStatusChange(online) {
    const previousStatus = this.isOnline;
    this.isOnline = online;
    
    console.log(`🌐 Network status changed: ${online ? 'Online' : 'Offline'}`);
    
    // Notify listeners of status change
    this.notifyListeners({
      type: 'status-change',
      online,
      timestamp: Date.now()
    });
    
    // If coming back online, process queued operations
    if (!previousStatus && online) {
      await this.processQueuedOperations();
    }
  }

  /**
   * Checks connectivity to required APIs
   * @private
   */
  async checkApiConnectivity() {
    if (!this.isOnline) return;
    
    try {
      // Implement API connectivity check
      // This could ping key APIs used by the application
      const apiStatus = {
        openai: await this.pingApi('https://api.openai.com/v1/engines'),
        // Add other APIs as needed
      };
      
      // Update API-specific online status
      this.apiStatus = apiStatus;
      
      // Notify listeners of API status
      this.notifyListeners({
        type: 'api-status',
        status: apiStatus,
        timestamp: Date.now()
      });
      
    } catch (error) {
      console.error('❌ API connectivity check failed:', error);
    }
  }

  /**
   * Pings an API to check connectivity
   * @param {string} url API endpoint to ping
   * @returns {Promise<boolean>} Whether the API is reachable
   * @private
   */
  async pingApi(url) {
    try {
      const { net } = require('electron');
      
      return new Promise((resolve) => {
        const request = net.request({
          method: 'HEAD',
          url,
          timeout: 5000
        });
        
        request.on('response', (response) => {
          resolve(response.statusCode >= 200 && response.statusCode < 300);
        });
        
        request.on('error', () => {
          resolve(false);
        });
        
        request.on('abort', () => {
          resolve(false);
        });
        
        request.end();
      });
    } catch (error) {
      console.error('API ping error:', error);
      return false;
    }
  }

  /**
   * Processes operations that were queued while offline
   * @private
   */
  async processQueuedOperations() {
    if (this.operationQueue.length === 0) return;
    
    console.log(`🔄 Processing ${this.operationQueue.length} queued operations`);
    
    // Process operations in order
    const queue = [...this.operationQueue];
    this.operationQueue = [];
    
    for (const operation of queue) {
      try {
        await this.executeOperation(operation);
        
        // Notify about successful operation
        this.notifyListeners({
          type: 'operation-complete',
          operation,
          timestamp: Date.now()
        });
      } catch (error) {
        console.error(`❌ Failed to process queued operation:`, error);
        
        // Re-queue failed operation
        this.queueOperation(operation);
        
        // Notify about failed operation
        this.notifyListeners({
          type: 'operation-failed',
          operation,
          error: error.message,
          timestamp: Date.now()
        });
      }
    }
    
    // Save updated queue
    this.saveQueuedOperations();
  }

  /**
   * Executes a specific operation
   * @param {Object} operation Operation to execute
   * @private
   */
  async executeOperation(operation) {
    switch (operation.type) {
      case 'conversion':
        // Execute conversion operation
        return this.executeConversionOperation(operation);
      
      case 'api-request':
        // Execute API request operation
        return this.executeApiRequestOperation(operation);
      
      case 'sync':
        // Execute sync operation
        return this.executeSyncOperation(operation);
      
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  /**
   * Executes a conversion operation
   * @param {Object} operation Conversion operation
   * @private
   */
  async executeConversionOperation(operation) {
    // Implementation will depend on the conversion service
    // This is a placeholder
    console.log('Executing conversion operation:', operation);
    return { success: true };
  }

  /**
   * Executes an API request operation
   * @param {Object} operation API request operation
   * @private
   */
  async executeApiRequestOperation(operation) {
    // Implementation will depend on the API client
    // This is a placeholder
    console.log('Executing API request operation:', operation);
    return { success: true };
  }

  /**
   * Executes a sync operation
   * @param {Object} operation Sync operation
   * @private
   */
  async executeSyncOperation(operation) {
    // Implementation will depend on the sync requirements
    // This is a placeholder
    console.log('Executing sync operation:', operation);
    return { success: true };
  }

  /**
   * Queues an operation for later execution when online
   * @param {Object} operation Operation to queue
   * @returns {string} Operation ID
   */
  queueOperation(operation) {
    // Generate operation ID if not provided
    if (!operation.id) {
      operation.id = `op_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
    
    // Add timestamp if not provided
    if (!operation.timestamp) {
      operation.timestamp = Date.now();
    }
    
    // Add to queue
    this.operationQueue.push(operation);
    
    // Save updated queue
    this.saveQueuedOperations();
    
    console.log(`➕ Queued operation: ${operation.type} (${operation.id})`);
    
    return operation.id;
  }

  /**
   * Saves the operation queue to persistent storage
   * @private
   */
  saveQueuedOperations() {
    try {
      this.store.set('operationQueue', this.operationQueue);
    } catch (error) {
      console.error('❌ Failed to save queued operations:', error);
    }
  }

  /**
   * Caches data for offline use
   * @param {string} key Cache key
   * @param {any} data Data to cache
   * @returns {Promise<boolean>} Success status
   */
  async cacheData(key, data) {
    try {
      const cacheFile = path.join(this.cacheDir, `${key}.json`);
      await fs.writeJson(cacheFile, {
        data,
        timestamp: Date.now()
      });
      return true;
    } catch (error) {
      console.error(`❌ Failed to cache data for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Retrieves cached data
   * @param {string} key Cache key
   * @param {number} [maxAge] Maximum age in milliseconds
   * @returns {Promise<any>} Cached data or null if not found or expired
   */
  async getCachedData(key, maxAge = null) {
    try {
      const cacheFile = path.join(this.cacheDir, `${key}.json`);
      
      if (!await fs.pathExists(cacheFile)) {
        return null;
      }
      
      const cached = await fs.readJson(cacheFile);
      
      // Check if cache is expired
      if (maxAge && Date.now() - cached.timestamp > maxAge) {
        return null;
      }
      
      return cached.data;
    } catch (error) {
      console.error(`❌ Failed to get cached data for key ${key}:`, error);
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
      const cacheFile = path.join(this.cacheDir, `${key}.json`);
      
      if (await fs.pathExists(cacheFile)) {
        await fs.remove(cacheFile);
      }
      
      return true;
    } catch (error) {
      console.error(`❌ Failed to invalidate cache for key ${key}:`, error);
      return false;
    }
  }

  /**
   * Clears all cached data
   * @returns {Promise<boolean>} Success status
   */
  async clearCache() {
    try {
      await fs.emptyDir(this.cacheDir);
      return true;
    } catch (error) {
      console.error('❌ Failed to clear cache:', error);
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
   * Gets the current API status
   * @returns {Object} API status object
   */
  getApiStatus() {
    return this.apiStatus || {};
  }

  /**
   * Gets the current operation queue
   * @returns {Array} Queued operations
   */
  getQueuedOperations() {
    return [...this.operationQueue];
  }

  /**
   * Adds a listener for offline events
   * @param {Function} listener Event listener function
   * @returns {boolean} Success status
   */
  addListener(listener) {
    if (typeof listener !== 'function') {
      return false;
    }
    
    this.listeners.add(listener);
    return true;
  }

  /**
   * Removes a listener
   * @param {Function} listener Event listener function
   * @returns {boolean} Success status
   */
  removeListener(listener) {
    return this.listeners.delete(listener);
  }

  /**
   * Notifies all listeners of an event
   * @param {Object} event Event object
   * @private
   */
  notifyListeners(event) {
    this.listeners.forEach(listener => {
      try {
        listener(event);
      } catch (error) {
        console.error('❌ Error in offline event listener:', error);
      }
    });
  }

  /**
   * Cleans up resources
   */
  cleanup() {
    // Clear intervals
    if (this.networkCheckInterval) {
      clearInterval(this.networkCheckInterval);
    }
    
    if (this.apiCheckInterval) {
      clearInterval(this.apiCheckInterval);
    }
    
    // Clear listeners
    this.listeners.clear();
    
    // Save any pending operations
    this.saveQueuedOperations();
    
    console.log('🧹 Offline service cleaned up');
  }
}

module.exports = new OfflineService();
