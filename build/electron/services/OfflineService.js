"use strict";

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
const {
  app
} = require('electron');
const {
  createStore
} = require('../utils/storeFactory');
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
    const {
      net
    } = require('electron');

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
        openai: await this.pingApi('https://api.openai.com/v1/engines')
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
      const {
        net
      } = require('electron');
      return new Promise(resolve => {
        const request = net.request({
          method: 'HEAD',
          url,
          timeout: 5000
        });
        request.on('response', response => {
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
    return {
      success: true
    };
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
    return {
      success: true
    };
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
    return {
      success: true
    };
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
      if (!(await fs.pathExists(cacheFile))) {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiYXBwIiwiY3JlYXRlU3RvcmUiLCJGaWxlU3lzdGVtU2VydmljZSIsIk9mZmxpbmVTZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJmaWxlU3lzdGVtIiwiY2FjaGVEaXIiLCJqb2luIiwiZ2V0UGF0aCIsIm9wZXJhdGlvblF1ZXVlIiwiaXNPbmxpbmUiLCJsaXN0ZW5lcnMiLCJTZXQiLCJzdG9yZSIsImVuY3J5cHRpb25LZXkiLCJwcm9jZXNzIiwiZW52IiwiU1RPUkVfRU5DUllQVElPTl9LRVkiLCJzZXR1cENhY2hlRGlyZWN0b3J5IiwibG9hZFF1ZXVlZE9wZXJhdGlvbnMiLCJzZXR1cE5ldHdvcmtMaXN0ZW5lcnMiLCJlbnN1cmVEaXIiLCJjb25zb2xlIiwibG9nIiwiZXJyb3IiLCJzYXZlZFF1ZXVlIiwiZ2V0IiwibGVuZ3RoIiwibmV0IiwibmV0d29ya0NoZWNrSW50ZXJ2YWwiLCJzZXRJbnRlcnZhbCIsIm9ubGluZSIsImhhbmRsZU9ubGluZVN0YXR1c0NoYW5nZSIsImFwaUNoZWNrSW50ZXJ2YWwiLCJjaGVja0FwaUNvbm5lY3Rpdml0eSIsInByZXZpb3VzU3RhdHVzIiwibm90aWZ5TGlzdGVuZXJzIiwidHlwZSIsInRpbWVzdGFtcCIsIkRhdGUiLCJub3ciLCJwcm9jZXNzUXVldWVkT3BlcmF0aW9ucyIsImFwaVN0YXR1cyIsIm9wZW5haSIsInBpbmdBcGkiLCJzdGF0dXMiLCJ1cmwiLCJQcm9taXNlIiwicmVzb2x2ZSIsInJlcXVlc3QiLCJtZXRob2QiLCJ0aW1lb3V0Iiwib24iLCJyZXNwb25zZSIsInN0YXR1c0NvZGUiLCJlbmQiLCJxdWV1ZSIsIm9wZXJhdGlvbiIsImV4ZWN1dGVPcGVyYXRpb24iLCJxdWV1ZU9wZXJhdGlvbiIsIm1lc3NhZ2UiLCJzYXZlUXVldWVkT3BlcmF0aW9ucyIsImV4ZWN1dGVDb252ZXJzaW9uT3BlcmF0aW9uIiwiZXhlY3V0ZUFwaVJlcXVlc3RPcGVyYXRpb24iLCJleGVjdXRlU3luY09wZXJhdGlvbiIsIkVycm9yIiwic3VjY2VzcyIsImlkIiwiTWF0aCIsInJhbmRvbSIsInRvU3RyaW5nIiwic3Vic3RyIiwicHVzaCIsInNldCIsImNhY2hlRGF0YSIsImtleSIsImRhdGEiLCJjYWNoZUZpbGUiLCJ3cml0ZUpzb24iLCJnZXRDYWNoZWREYXRhIiwibWF4QWdlIiwicGF0aEV4aXN0cyIsImNhY2hlZCIsInJlYWRKc29uIiwiaW52YWxpZGF0ZUNhY2hlIiwicmVtb3ZlIiwiY2xlYXJDYWNoZSIsImVtcHR5RGlyIiwiZ2V0T25saW5lU3RhdHVzIiwiZ2V0QXBpU3RhdHVzIiwiZ2V0UXVldWVkT3BlcmF0aW9ucyIsImFkZExpc3RlbmVyIiwibGlzdGVuZXIiLCJhZGQiLCJyZW1vdmVMaXN0ZW5lciIsImRlbGV0ZSIsImV2ZW50IiwiZm9yRWFjaCIsImNsZWFudXAiLCJjbGVhckludGVydmFsIiwiY2xlYXIiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL09mZmxpbmVTZXJ2aWNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBPZmZsaW5lU2VydmljZS5qc1xyXG4gKiBQcm92aWRlcyBvZmZsaW5lIGNhcGFiaWxpdGllcyBmb3IgdGhlIEVsZWN0cm9uIGFwcGxpY2F0aW9uLlxyXG4gKiBcclxuICogVGhpcyBzZXJ2aWNlIG1hbmFnZXM6XHJcbiAqIC0gQ2FjaGluZyBzeXN0ZW0gZm9yIGxvY2FsIG9wZXJhdGlvbnNcclxuICogLSBPcGVyYXRpb24gcXVldWUgZm9yIHBlbmRpbmcgdGFza3NcclxuICogLSBTdGF0ZSBwZXJzaXN0ZW5jZSBmb3Igb2ZmbGluZSBtb2RlXHJcbiAqIC0gU3luYyBtZWNoYW5pc21zIGZvciByZWNvbm5lY3Rpb25cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gRmlsZVN5c3RlbVNlcnZpY2UuanM6IE5hdGl2ZSBmaWxlIG9wZXJhdGlvbnNcclxuICogLSBFbGVjdHJvbkNvbnZlcnNpb25TZXJ2aWNlLmpzOiBDb252ZXJzaW9uIG9wZXJhdGlvbnNcclxuICogLSBpcGMvaGFuZGxlcnMvb2ZmbGluZS9pbmRleC5qczogSVBDIGhhbmRsZXJzIGZvciBvZmZsaW5lIGZlYXR1cmVzXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCB7IGFwcCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuY29uc3QgeyBjcmVhdGVTdG9yZSB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvc3RvcmVGYWN0b3J5Jyk7XHJcbmNvbnN0IEZpbGVTeXN0ZW1TZXJ2aWNlID0gcmVxdWlyZSgnLi9GaWxlU3lzdGVtU2VydmljZScpO1xyXG5cclxuY2xhc3MgT2ZmbGluZVNlcnZpY2Uge1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5maWxlU3lzdGVtID0gRmlsZVN5c3RlbVNlcnZpY2U7XHJcbiAgICB0aGlzLmNhY2hlRGlyID0gcGF0aC5qb2luKGFwcC5nZXRQYXRoKCd1c2VyRGF0YScpLCAnY2FjaGUnKTtcclxuICAgIHRoaXMub3BlcmF0aW9uUXVldWUgPSBbXTtcclxuICAgIHRoaXMuaXNPbmxpbmUgPSB0cnVlO1xyXG4gICAgdGhpcy5saXN0ZW5lcnMgPSBuZXcgU2V0KCk7XHJcbiAgICBcclxuICAgIC8vIEluaXRpYWxpemUgZW5jcnlwdGVkIHN0b3JlIGZvciBvZmZsaW5lIGRhdGEgd2l0aCBlcnJvciBoYW5kbGluZ1xyXG4gICAgdGhpcy5zdG9yZSA9IGNyZWF0ZVN0b3JlKCdvZmZsaW5lLWRhdGEnLCB7XHJcbiAgICAgIGVuY3J5cHRpb25LZXk6IHByb2Nlc3MuZW52LlNUT1JFX0VOQ1JZUFRJT05fS0VZXHJcbiAgICB9KTtcclxuICAgIFxyXG4gICAgdGhpcy5zZXR1cENhY2hlRGlyZWN0b3J5KCk7XHJcbiAgICB0aGlzLmxvYWRRdWV1ZWRPcGVyYXRpb25zKCk7XHJcbiAgICB0aGlzLnNldHVwTmV0d29ya0xpc3RlbmVycygpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0cyB1cCB0aGUgY2FjaGUgZGlyZWN0b3J5IGZvciBvZmZsaW5lIG9wZXJhdGlvbnNcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIGFzeW5jIHNldHVwQ2FjaGVEaXJlY3RvcnkoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBmcy5lbnN1cmVEaXIodGhpcy5jYWNoZURpcik7XHJcbiAgICAgIGNvbnNvbGUubG9nKCfwn5OBIE9mZmxpbmUgY2FjaGUgZGlyZWN0b3J5IHJlYWR5OicsIHRoaXMuY2FjaGVEaXIpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBzZXQgdXAgY2FjaGUgZGlyZWN0b3J5OicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIExvYWRzIHByZXZpb3VzbHkgcXVldWVkIG9wZXJhdGlvbnMgZnJvbSBwZXJzaXN0ZW50IHN0b3JhZ2VcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIGxvYWRRdWV1ZWRPcGVyYXRpb25zKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3Qgc2F2ZWRRdWV1ZSA9IHRoaXMuc3RvcmUuZ2V0KCdvcGVyYXRpb25RdWV1ZScsIFtdKTtcclxuICAgICAgdGhpcy5vcGVyYXRpb25RdWV1ZSA9IHNhdmVkUXVldWU7XHJcbiAgICAgIGNvbnNvbGUubG9nKGDwn5OLIExvYWRlZCAke3NhdmVkUXVldWUubGVuZ3RofSBxdWV1ZWQgb3BlcmF0aW9uc2ApO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBsb2FkIHF1ZXVlZCBvcGVyYXRpb25zOicsIGVycm9yKTtcclxuICAgICAgdGhpcy5vcGVyYXRpb25RdWV1ZSA9IFtdO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0cyB1cCBuZXR3b3JrIHN0YXR1cyBjaGFuZ2UgbGlzdGVuZXJzXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBzZXR1cE5ldHdvcmtMaXN0ZW5lcnMoKSB7XHJcbiAgICBjb25zdCB7IG5ldCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuICAgIFxyXG4gICAgLy8gQ2hlY2sgaW5pdGlhbCBvbmxpbmUgc3RhdHVzXHJcbiAgICB0aGlzLmlzT25saW5lID0gbmV0LmlzT25saW5lKCk7XHJcbiAgICBcclxuICAgIC8vIFNldCB1cCBwZXJpb2RpYyBjaGVja3MgZm9yIG5ldHdvcmsgc3RhdHVzXHJcbiAgICB0aGlzLm5ldHdvcmtDaGVja0ludGVydmFsID0gc2V0SW50ZXJ2YWwoKCkgPT4ge1xyXG4gICAgICBjb25zdCBvbmxpbmUgPSBuZXQuaXNPbmxpbmUoKTtcclxuICAgICAgaWYgKG9ubGluZSAhPT0gdGhpcy5pc09ubGluZSkge1xyXG4gICAgICAgIHRoaXMuaGFuZGxlT25saW5lU3RhdHVzQ2hhbmdlKG9ubGluZSk7XHJcbiAgICAgIH1cclxuICAgIH0sIDEwMDAwKTsgLy8gQ2hlY2sgZXZlcnkgMTAgc2Vjb25kc1xyXG4gICAgXHJcbiAgICAvLyBQZXJpb2RpY2FsbHkgY2hlY2sgY29ubmVjdGl2aXR5IHRvIEFQSXNcclxuICAgIHRoaXMuYXBpQ2hlY2tJbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHRoaXMuY2hlY2tBcGlDb25uZWN0aXZpdHkoKSwgNjAwMDApO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogSGFuZGxlcyBjaGFuZ2VzIGluIG9ubGluZSBzdGF0dXNcclxuICAgKiBAcGFyYW0ge2Jvb2xlYW59IG9ubGluZSBXaGV0aGVyIHRoZSBzeXN0ZW0gaXMgb25saW5lXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBoYW5kbGVPbmxpbmVTdGF0dXNDaGFuZ2Uob25saW5lKSB7XHJcbiAgICBjb25zdCBwcmV2aW91c1N0YXR1cyA9IHRoaXMuaXNPbmxpbmU7XHJcbiAgICB0aGlzLmlzT25saW5lID0gb25saW5lO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhg8J+MkCBOZXR3b3JrIHN0YXR1cyBjaGFuZ2VkOiAke29ubGluZSA/ICdPbmxpbmUnIDogJ09mZmxpbmUnfWApO1xyXG4gICAgXHJcbiAgICAvLyBOb3RpZnkgbGlzdGVuZXJzIG9mIHN0YXR1cyBjaGFuZ2VcclxuICAgIHRoaXMubm90aWZ5TGlzdGVuZXJzKHtcclxuICAgICAgdHlwZTogJ3N0YXR1cy1jaGFuZ2UnLFxyXG4gICAgICBvbmxpbmUsXHJcbiAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIC8vIElmIGNvbWluZyBiYWNrIG9ubGluZSwgcHJvY2VzcyBxdWV1ZWQgb3BlcmF0aW9uc1xyXG4gICAgaWYgKCFwcmV2aW91c1N0YXR1cyAmJiBvbmxpbmUpIHtcclxuICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzUXVldWVkT3BlcmF0aW9ucygpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2hlY2tzIGNvbm5lY3Rpdml0eSB0byByZXF1aXJlZCBBUElzXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBjaGVja0FwaUNvbm5lY3Rpdml0eSgpIHtcclxuICAgIGlmICghdGhpcy5pc09ubGluZSkgcmV0dXJuO1xyXG4gICAgXHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBJbXBsZW1lbnQgQVBJIGNvbm5lY3Rpdml0eSBjaGVja1xyXG4gICAgICAvLyBUaGlzIGNvdWxkIHBpbmcga2V5IEFQSXMgdXNlZCBieSB0aGUgYXBwbGljYXRpb25cclxuICAgICAgY29uc3QgYXBpU3RhdHVzID0ge1xyXG4gICAgICAgIG9wZW5haTogYXdhaXQgdGhpcy5waW5nQXBpKCdodHRwczovL2FwaS5vcGVuYWkuY29tL3YxL2VuZ2luZXMnKSxcclxuICAgICAgICAvLyBBZGQgb3RoZXIgQVBJcyBhcyBuZWVkZWRcclxuICAgICAgfTtcclxuICAgICAgXHJcbiAgICAgIC8vIFVwZGF0ZSBBUEktc3BlY2lmaWMgb25saW5lIHN0YXR1c1xyXG4gICAgICB0aGlzLmFwaVN0YXR1cyA9IGFwaVN0YXR1cztcclxuICAgICAgXHJcbiAgICAgIC8vIE5vdGlmeSBsaXN0ZW5lcnMgb2YgQVBJIHN0YXR1c1xyXG4gICAgICB0aGlzLm5vdGlmeUxpc3RlbmVycyh7XHJcbiAgICAgICAgdHlwZTogJ2FwaS1zdGF0dXMnLFxyXG4gICAgICAgIHN0YXR1czogYXBpU3RhdHVzLFxyXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgQVBJIGNvbm5lY3Rpdml0eSBjaGVjayBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUGluZ3MgYW4gQVBJIHRvIGNoZWNrIGNvbm5lY3Rpdml0eVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgQVBJIGVuZHBvaW50IHRvIHBpbmdcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gV2hldGhlciB0aGUgQVBJIGlzIHJlYWNoYWJsZVxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgcGluZ0FwaSh1cmwpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHsgbmV0IH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgY29uc3QgcmVxdWVzdCA9IG5ldC5yZXF1ZXN0KHtcclxuICAgICAgICAgIG1ldGhvZDogJ0hFQUQnLFxyXG4gICAgICAgICAgdXJsLFxyXG4gICAgICAgICAgdGltZW91dDogNTAwMFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJlcXVlc3Qub24oJ3Jlc3BvbnNlJywgKHJlc3BvbnNlKSA9PiB7XHJcbiAgICAgICAgICByZXNvbHZlKHJlc3BvbnNlLnN0YXR1c0NvZGUgPj0gMjAwICYmIHJlc3BvbnNlLnN0YXR1c0NvZGUgPCAzMDApO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJlcXVlc3Qub24oJ2Vycm9yJywgKCkgPT4ge1xyXG4gICAgICAgICAgcmVzb2x2ZShmYWxzZSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmVxdWVzdC5vbignYWJvcnQnLCAoKSA9PiB7XHJcbiAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICByZXF1ZXN0LmVuZCgpO1xyXG4gICAgICB9KTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ0FQSSBwaW5nIGVycm9yOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUHJvY2Vzc2VzIG9wZXJhdGlvbnMgdGhhdCB3ZXJlIHF1ZXVlZCB3aGlsZSBvZmZsaW5lXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBwcm9jZXNzUXVldWVkT3BlcmF0aW9ucygpIHtcclxuICAgIGlmICh0aGlzLm9wZXJhdGlvblF1ZXVlLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhg8J+UhCBQcm9jZXNzaW5nICR7dGhpcy5vcGVyYXRpb25RdWV1ZS5sZW5ndGh9IHF1ZXVlZCBvcGVyYXRpb25zYCk7XHJcbiAgICBcclxuICAgIC8vIFByb2Nlc3Mgb3BlcmF0aW9ucyBpbiBvcmRlclxyXG4gICAgY29uc3QgcXVldWUgPSBbLi4udGhpcy5vcGVyYXRpb25RdWV1ZV07XHJcbiAgICB0aGlzLm9wZXJhdGlvblF1ZXVlID0gW107XHJcbiAgICBcclxuICAgIGZvciAoY29uc3Qgb3BlcmF0aW9uIG9mIHF1ZXVlKSB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5leGVjdXRlT3BlcmF0aW9uKG9wZXJhdGlvbik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gTm90aWZ5IGFib3V0IHN1Y2Nlc3NmdWwgb3BlcmF0aW9uXHJcbiAgICAgICAgdGhpcy5ub3RpZnlMaXN0ZW5lcnMoe1xyXG4gICAgICAgICAgdHlwZTogJ29wZXJhdGlvbi1jb21wbGV0ZScsXHJcbiAgICAgICAgICBvcGVyYXRpb24sXHJcbiAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KClcclxuICAgICAgICB9KTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIHByb2Nlc3MgcXVldWVkIG9wZXJhdGlvbjpgLCBlcnJvcik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gUmUtcXVldWUgZmFpbGVkIG9wZXJhdGlvblxyXG4gICAgICAgIHRoaXMucXVldWVPcGVyYXRpb24ob3BlcmF0aW9uKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBOb3RpZnkgYWJvdXQgZmFpbGVkIG9wZXJhdGlvblxyXG4gICAgICAgIHRoaXMubm90aWZ5TGlzdGVuZXJzKHtcclxuICAgICAgICAgIHR5cGU6ICdvcGVyYXRpb24tZmFpbGVkJyxcclxuICAgICAgICAgIG9wZXJhdGlvbixcclxuICAgICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gU2F2ZSB1cGRhdGVkIHF1ZXVlXHJcbiAgICB0aGlzLnNhdmVRdWV1ZWRPcGVyYXRpb25zKCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFeGVjdXRlcyBhIHNwZWNpZmljIG9wZXJhdGlvblxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcGVyYXRpb24gT3BlcmF0aW9uIHRvIGV4ZWN1dGVcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIGFzeW5jIGV4ZWN1dGVPcGVyYXRpb24ob3BlcmF0aW9uKSB7XHJcbiAgICBzd2l0Y2ggKG9wZXJhdGlvbi50eXBlKSB7XHJcbiAgICAgIGNhc2UgJ2NvbnZlcnNpb24nOlxyXG4gICAgICAgIC8vIEV4ZWN1dGUgY29udmVyc2lvbiBvcGVyYXRpb25cclxuICAgICAgICByZXR1cm4gdGhpcy5leGVjdXRlQ29udmVyc2lvbk9wZXJhdGlvbihvcGVyYXRpb24pO1xyXG4gICAgICBcclxuICAgICAgY2FzZSAnYXBpLXJlcXVlc3QnOlxyXG4gICAgICAgIC8vIEV4ZWN1dGUgQVBJIHJlcXVlc3Qgb3BlcmF0aW9uXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0ZUFwaVJlcXVlc3RPcGVyYXRpb24ob3BlcmF0aW9uKTtcclxuICAgICAgXHJcbiAgICAgIGNhc2UgJ3N5bmMnOlxyXG4gICAgICAgIC8vIEV4ZWN1dGUgc3luYyBvcGVyYXRpb25cclxuICAgICAgICByZXR1cm4gdGhpcy5leGVjdXRlU3luY09wZXJhdGlvbihvcGVyYXRpb24pO1xyXG4gICAgICBcclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVua25vd24gb3BlcmF0aW9uIHR5cGU6ICR7b3BlcmF0aW9uLnR5cGV9YCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFeGVjdXRlcyBhIGNvbnZlcnNpb24gb3BlcmF0aW9uXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wZXJhdGlvbiBDb252ZXJzaW9uIG9wZXJhdGlvblxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgZXhlY3V0ZUNvbnZlcnNpb25PcGVyYXRpb24ob3BlcmF0aW9uKSB7XHJcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiB3aWxsIGRlcGVuZCBvbiB0aGUgY29udmVyc2lvbiBzZXJ2aWNlXHJcbiAgICAvLyBUaGlzIGlzIGEgcGxhY2Vob2xkZXJcclxuICAgIGNvbnNvbGUubG9nKCdFeGVjdXRpbmcgY29udmVyc2lvbiBvcGVyYXRpb246Jywgb3BlcmF0aW9uKTtcclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEV4ZWN1dGVzIGFuIEFQSSByZXF1ZXN0IG9wZXJhdGlvblxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcGVyYXRpb24gQVBJIHJlcXVlc3Qgb3BlcmF0aW9uXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBleGVjdXRlQXBpUmVxdWVzdE9wZXJhdGlvbihvcGVyYXRpb24pIHtcclxuICAgIC8vIEltcGxlbWVudGF0aW9uIHdpbGwgZGVwZW5kIG9uIHRoZSBBUEkgY2xpZW50XHJcbiAgICAvLyBUaGlzIGlzIGEgcGxhY2Vob2xkZXJcclxuICAgIGNvbnNvbGUubG9nKCdFeGVjdXRpbmcgQVBJIHJlcXVlc3Qgb3BlcmF0aW9uOicsIG9wZXJhdGlvbik7XHJcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFeGVjdXRlcyBhIHN5bmMgb3BlcmF0aW9uXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wZXJhdGlvbiBTeW5jIG9wZXJhdGlvblxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgZXhlY3V0ZVN5bmNPcGVyYXRpb24ob3BlcmF0aW9uKSB7XHJcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiB3aWxsIGRlcGVuZCBvbiB0aGUgc3luYyByZXF1aXJlbWVudHNcclxuICAgIC8vIFRoaXMgaXMgYSBwbGFjZWhvbGRlclxyXG4gICAgY29uc29sZS5sb2coJ0V4ZWN1dGluZyBzeW5jIG9wZXJhdGlvbjonLCBvcGVyYXRpb24pO1xyXG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUXVldWVzIGFuIG9wZXJhdGlvbiBmb3IgbGF0ZXIgZXhlY3V0aW9uIHdoZW4gb25saW5lXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wZXJhdGlvbiBPcGVyYXRpb24gdG8gcXVldWVcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfSBPcGVyYXRpb24gSURcclxuICAgKi9cclxuICBxdWV1ZU9wZXJhdGlvbihvcGVyYXRpb24pIHtcclxuICAgIC8vIEdlbmVyYXRlIG9wZXJhdGlvbiBJRCBpZiBub3QgcHJvdmlkZWRcclxuICAgIGlmICghb3BlcmF0aW9uLmlkKSB7XHJcbiAgICAgIG9wZXJhdGlvbi5pZCA9IGBvcF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDkpfWA7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEFkZCB0aW1lc3RhbXAgaWYgbm90IHByb3ZpZGVkXHJcbiAgICBpZiAoIW9wZXJhdGlvbi50aW1lc3RhbXApIHtcclxuICAgICAgb3BlcmF0aW9uLnRpbWVzdGFtcCA9IERhdGUubm93KCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIEFkZCB0byBxdWV1ZVxyXG4gICAgdGhpcy5vcGVyYXRpb25RdWV1ZS5wdXNoKG9wZXJhdGlvbik7XHJcbiAgICBcclxuICAgIC8vIFNhdmUgdXBkYXRlZCBxdWV1ZVxyXG4gICAgdGhpcy5zYXZlUXVldWVkT3BlcmF0aW9ucygpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZyhg4p6VIFF1ZXVlZCBvcGVyYXRpb246ICR7b3BlcmF0aW9uLnR5cGV9ICgke29wZXJhdGlvbi5pZH0pYCk7XHJcbiAgICBcclxuICAgIHJldHVybiBvcGVyYXRpb24uaWQ7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTYXZlcyB0aGUgb3BlcmF0aW9uIHF1ZXVlIHRvIHBlcnNpc3RlbnQgc3RvcmFnZVxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgc2F2ZVF1ZXVlZE9wZXJhdGlvbnMoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICB0aGlzLnN0b3JlLnNldCgnb3BlcmF0aW9uUXVldWUnLCB0aGlzLm9wZXJhdGlvblF1ZXVlKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2F2ZSBxdWV1ZWQgb3BlcmF0aW9uczonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDYWNoZXMgZGF0YSBmb3Igb2ZmbGluZSB1c2VcclxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IENhY2hlIGtleVxyXG4gICAqIEBwYXJhbSB7YW55fSBkYXRhIERhdGEgdG8gY2FjaGVcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gU3VjY2VzcyBzdGF0dXNcclxuICAgKi9cclxuICBhc3luYyBjYWNoZURhdGEoa2V5LCBkYXRhKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBjYWNoZUZpbGUgPSBwYXRoLmpvaW4odGhpcy5jYWNoZURpciwgYCR7a2V5fS5qc29uYCk7XHJcbiAgICAgIGF3YWl0IGZzLndyaXRlSnNvbihjYWNoZUZpbGUsIHtcclxuICAgICAgICBkYXRhLFxyXG4gICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKVxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIGNhY2hlIGRhdGEgZm9yIGtleSAke2tleX06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZXRyaWV2ZXMgY2FjaGVkIGRhdGFcclxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IENhY2hlIGtleVxyXG4gICAqIEBwYXJhbSB7bnVtYmVyfSBbbWF4QWdlXSBNYXhpbXVtIGFnZSBpbiBtaWxsaXNlY29uZHNcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxhbnk+fSBDYWNoZWQgZGF0YSBvciBudWxsIGlmIG5vdCBmb3VuZCBvciBleHBpcmVkXHJcbiAgICovXHJcbiAgYXN5bmMgZ2V0Q2FjaGVkRGF0YShrZXksIG1heEFnZSA9IG51bGwpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNhY2hlRmlsZSA9IHBhdGguam9pbih0aGlzLmNhY2hlRGlyLCBgJHtrZXl9Lmpzb25gKTtcclxuICAgICAgXHJcbiAgICAgIGlmICghYXdhaXQgZnMucGF0aEV4aXN0cyhjYWNoZUZpbGUpKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIGNvbnN0IGNhY2hlZCA9IGF3YWl0IGZzLnJlYWRKc29uKGNhY2hlRmlsZSk7XHJcbiAgICAgIFxyXG4gICAgICAvLyBDaGVjayBpZiBjYWNoZSBpcyBleHBpcmVkXHJcbiAgICAgIGlmIChtYXhBZ2UgJiYgRGF0ZS5ub3coKSAtIGNhY2hlZC50aW1lc3RhbXAgPiBtYXhBZ2UpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIGNhY2hlZC5kYXRhO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZhaWxlZCB0byBnZXQgY2FjaGVkIGRhdGEgZm9yIGtleSAke2tleX06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEludmFsaWRhdGVzIGNhY2hlZCBkYXRhXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSBDYWNoZSBrZXlcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gU3VjY2VzcyBzdGF0dXNcclxuICAgKi9cclxuICBhc3luYyBpbnZhbGlkYXRlQ2FjaGUoa2V5KSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBjYWNoZUZpbGUgPSBwYXRoLmpvaW4odGhpcy5jYWNoZURpciwgYCR7a2V5fS5qc29uYCk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoYXdhaXQgZnMucGF0aEV4aXN0cyhjYWNoZUZpbGUpKSB7XHJcbiAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNhY2hlRmlsZSk7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZhaWxlZCB0byBpbnZhbGlkYXRlIGNhY2hlIGZvciBrZXkgJHtrZXl9OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2xlYXJzIGFsbCBjYWNoZWQgZGF0YVxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBTdWNjZXNzIHN0YXR1c1xyXG4gICAqL1xyXG4gIGFzeW5jIGNsZWFyQ2FjaGUoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBmcy5lbXB0eURpcih0aGlzLmNhY2hlRGlyKTtcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIGNsZWFyIGNhY2hlOicsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0cyB0aGUgY3VycmVudCBvbmxpbmUgc3RhdHVzXHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IFdoZXRoZXIgdGhlIHN5c3RlbSBpcyBvbmxpbmVcclxuICAgKi9cclxuICBnZXRPbmxpbmVTdGF0dXMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5pc09ubGluZTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldHMgdGhlIGN1cnJlbnQgQVBJIHN0YXR1c1xyXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IEFQSSBzdGF0dXMgb2JqZWN0XHJcbiAgICovXHJcbiAgZ2V0QXBpU3RhdHVzKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuYXBpU3RhdHVzIHx8IHt9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0cyB0aGUgY3VycmVudCBvcGVyYXRpb24gcXVldWVcclxuICAgKiBAcmV0dXJucyB7QXJyYXl9IFF1ZXVlZCBvcGVyYXRpb25zXHJcbiAgICovXHJcbiAgZ2V0UXVldWVkT3BlcmF0aW9ucygpIHtcclxuICAgIHJldHVybiBbLi4udGhpcy5vcGVyYXRpb25RdWV1ZV07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBBZGRzIGEgbGlzdGVuZXIgZm9yIG9mZmxpbmUgZXZlbnRzXHJcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgRXZlbnQgbGlzdGVuZXIgZnVuY3Rpb25cclxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gU3VjY2VzcyBzdGF0dXNcclxuICAgKi9cclxuICBhZGRMaXN0ZW5lcihsaXN0ZW5lcikge1xyXG4gICAgaWYgKHR5cGVvZiBsaXN0ZW5lciAhPT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIHRoaXMubGlzdGVuZXJzLmFkZChsaXN0ZW5lcik7XHJcbiAgICByZXR1cm4gdHJ1ZTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJlbW92ZXMgYSBsaXN0ZW5lclxyXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIEV2ZW50IGxpc3RlbmVyIGZ1bmN0aW9uXHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IFN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICovXHJcbiAgcmVtb3ZlTGlzdGVuZXIobGlzdGVuZXIpIHtcclxuICAgIHJldHVybiB0aGlzLmxpc3RlbmVycy5kZWxldGUobGlzdGVuZXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogTm90aWZpZXMgYWxsIGxpc3RlbmVycyBvZiBhbiBldmVudFxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBldmVudCBFdmVudCBvYmplY3RcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIG5vdGlmeUxpc3RlbmVycyhldmVudCkge1xyXG4gICAgdGhpcy5saXN0ZW5lcnMuZm9yRWFjaChsaXN0ZW5lciA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgbGlzdGVuZXIoZXZlbnQpO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBFcnJvciBpbiBvZmZsaW5lIGV2ZW50IGxpc3RlbmVyOicsIGVycm9yKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDbGVhbnMgdXAgcmVzb3VyY2VzXHJcbiAgICovXHJcbiAgY2xlYW51cCgpIHtcclxuICAgIC8vIENsZWFyIGludGVydmFsc1xyXG4gICAgaWYgKHRoaXMubmV0d29ya0NoZWNrSW50ZXJ2YWwpIHtcclxuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLm5ldHdvcmtDaGVja0ludGVydmFsKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuYXBpQ2hlY2tJbnRlcnZhbCkge1xyXG4gICAgICBjbGVhckludGVydmFsKHRoaXMuYXBpQ2hlY2tJbnRlcnZhbCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIENsZWFyIGxpc3RlbmVyc1xyXG4gICAgdGhpcy5saXN0ZW5lcnMuY2xlYXIoKTtcclxuICAgIFxyXG4gICAgLy8gU2F2ZSBhbnkgcGVuZGluZyBvcGVyYXRpb25zXHJcbiAgICB0aGlzLnNhdmVRdWV1ZWRPcGVyYXRpb25zKCk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKCfwn6e5IE9mZmxpbmUgc2VydmljZSBjbGVhbmVkIHVwJyk7XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBPZmZsaW5lU2VydmljZSgpO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTTtFQUFFRTtBQUFJLENBQUMsR0FBR0YsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUNuQyxNQUFNO0VBQUVHO0FBQVksQ0FBQyxHQUFHSCxPQUFPLENBQUMsdUJBQXVCLENBQUM7QUFDeEQsTUFBTUksaUJBQWlCLEdBQUdKLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQztBQUV4RCxNQUFNSyxjQUFjLENBQUM7RUFDbkJDLFdBQVdBLENBQUEsRUFBRztJQUNaLElBQUksQ0FBQ0MsVUFBVSxHQUFHSCxpQkFBaUI7SUFDbkMsSUFBSSxDQUFDSSxRQUFRLEdBQUdULElBQUksQ0FBQ1UsSUFBSSxDQUFDUCxHQUFHLENBQUNRLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRSxPQUFPLENBQUM7SUFDM0QsSUFBSSxDQUFDQyxjQUFjLEdBQUcsRUFBRTtJQUN4QixJQUFJLENBQUNDLFFBQVEsR0FBRyxJQUFJO0lBQ3BCLElBQUksQ0FBQ0MsU0FBUyxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDOztJQUUxQjtJQUNBLElBQUksQ0FBQ0MsS0FBSyxHQUFHWixXQUFXLENBQUMsY0FBYyxFQUFFO01BQ3ZDYSxhQUFhLEVBQUVDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDQztJQUM3QixDQUFDLENBQUM7SUFFRixJQUFJLENBQUNDLG1CQUFtQixDQUFDLENBQUM7SUFDMUIsSUFBSSxDQUFDQyxvQkFBb0IsQ0FBQyxDQUFDO0lBQzNCLElBQUksQ0FBQ0MscUJB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