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
const {
  instance: FileSystemService
} = require('./FileSystemService'); // Import instance

class OfflineService {
  constructor() {
    this.fileSystem = FileSystemService; // Use the imported instance
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiYXBwIiwiY3JlYXRlU3RvcmUiLCJpbnN0YW5jZSIsIkZpbGVTeXN0ZW1TZXJ2aWNlIiwiT2ZmbGluZVNlcnZpY2UiLCJjb25zdHJ1Y3RvciIsImZpbGVTeXN0ZW0iLCJjYWNoZURpciIsImpvaW4iLCJnZXRQYXRoIiwib3BlcmF0aW9uUXVldWUiLCJpc09ubGluZSIsImxpc3RlbmVycyIsIlNldCIsInN0b3JlIiwiZW5jcnlwdGlvbktleSIsInByb2Nlc3MiLCJlbnYiLCJTVE9SRV9FTkNSWVBUSU9OX0tFWSIsInNldHVwQ2FjaGVEaXJlY3RvcnkiLCJsb2FkUXVldWVkT3BlcmF0aW9ucyIsInNldHVwTmV0d29ya0xpc3RlbmVycyIsImVuc3VyZURpciIsImNvbnNvbGUiLCJsb2ciLCJlcnJvciIsInNhdmVkUXVldWUiLCJnZXQiLCJsZW5ndGgiLCJuZXQiLCJuZXR3b3JrQ2hlY2tJbnRlcnZhbCIsInNldEludGVydmFsIiwib25saW5lIiwiaGFuZGxlT25saW5lU3RhdHVzQ2hhbmdlIiwiYXBpQ2hlY2tJbnRlcnZhbCIsImNoZWNrQXBpQ29ubmVjdGl2aXR5IiwicHJldmlvdXNTdGF0dXMiLCJub3RpZnlMaXN0ZW5lcnMiLCJ0eXBlIiwidGltZXN0YW1wIiwiRGF0ZSIsIm5vdyIsInByb2Nlc3NRdWV1ZWRPcGVyYXRpb25zIiwiYXBpU3RhdHVzIiwib3BlbmFpIiwicGluZ0FwaSIsInN0YXR1cyIsInVybCIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVxdWVzdCIsIm1ldGhvZCIsInRpbWVvdXQiLCJvbiIsInJlc3BvbnNlIiwic3RhdHVzQ29kZSIsImVuZCIsInF1ZXVlIiwib3BlcmF0aW9uIiwiZXhlY3V0ZU9wZXJhdGlvbiIsInF1ZXVlT3BlcmF0aW9uIiwibWVzc2FnZSIsInNhdmVRdWV1ZWRPcGVyYXRpb25zIiwiZXhlY3V0ZUNvbnZlcnNpb25PcGVyYXRpb24iLCJleGVjdXRlQXBpUmVxdWVzdE9wZXJhdGlvbiIsImV4ZWN1dGVTeW5jT3BlcmF0aW9uIiwiRXJyb3IiLCJzdWNjZXNzIiwiaWQiLCJNYXRoIiwicmFuZG9tIiwidG9TdHJpbmciLCJzdWJzdHIiLCJwdXNoIiwic2V0IiwiY2FjaGVEYXRhIiwia2V5IiwiZGF0YSIsImNhY2hlRmlsZSIsIndyaXRlSnNvbiIsImdldENhY2hlZERhdGEiLCJtYXhBZ2UiLCJwYXRoRXhpc3RzIiwiY2FjaGVkIiwicmVhZEpzb24iLCJpbnZhbGlkYXRlQ2FjaGUiLCJyZW1vdmUiLCJjbGVhckNhY2hlIiwiZW1wdHlEaXIiLCJnZXRPbmxpbmVTdGF0dXMiLCJnZXRBcGlTdGF0dXMiLCJnZXRRdWV1ZWRPcGVyYXRpb25zIiwiYWRkTGlzdGVuZXIiLCJsaXN0ZW5lciIsImFkZCIsInJlbW92ZUxpc3RlbmVyIiwiZGVsZXRlIiwiZXZlbnQiLCJmb3JFYWNoIiwiY2xlYW51cCIsImNsZWFySW50ZXJ2YWwiLCJjbGVhciIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvT2ZmbGluZVNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIE9mZmxpbmVTZXJ2aWNlLmpzXHJcbiAqIFByb3ZpZGVzIG9mZmxpbmUgY2FwYWJpbGl0aWVzIGZvciB0aGUgRWxlY3Ryb24gYXBwbGljYXRpb24uXHJcbiAqIFxyXG4gKiBUaGlzIHNlcnZpY2UgbWFuYWdlczpcclxuICogLSBDYWNoaW5nIHN5c3RlbSBmb3IgbG9jYWwgb3BlcmF0aW9uc1xyXG4gKiAtIE9wZXJhdGlvbiBxdWV1ZSBmb3IgcGVuZGluZyB0YXNrc1xyXG4gKiAtIFN0YXRlIHBlcnNpc3RlbmNlIGZvciBvZmZsaW5lIG1vZGVcclxuICogLSBTeW5jIG1lY2hhbmlzbXMgZm9yIHJlY29ubmVjdGlvblxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBGaWxlU3lzdGVtU2VydmljZS5qczogTmF0aXZlIGZpbGUgb3BlcmF0aW9uc1xyXG4gKiAtIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanM6IENvbnZlcnNpb24gb3BlcmF0aW9uc1xyXG4gKiAtIGlwYy9oYW5kbGVycy9vZmZsaW5lL2luZGV4LmpzOiBJUEMgaGFuZGxlcnMgZm9yIG9mZmxpbmUgZmVhdHVyZXNcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCB7IGNyZWF0ZVN0b3JlIH0gPSByZXF1aXJlKCcuLi91dGlscy9zdG9yZUZhY3RvcnknKTtcclxuY29uc3QgeyBpbnN0YW5jZTogRmlsZVN5c3RlbVNlcnZpY2UgfSA9IHJlcXVpcmUoJy4vRmlsZVN5c3RlbVNlcnZpY2UnKTsgLy8gSW1wb3J0IGluc3RhbmNlXHJcblxyXG5jbGFzcyBPZmZsaW5lU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmZpbGVTeXN0ZW0gPSBGaWxlU3lzdGVtU2VydmljZTsgLy8gVXNlIHRoZSBpbXBvcnRlZCBpbnN0YW5jZVxyXG4gICAgdGhpcy5jYWNoZURpciA9IHBhdGguam9pbihhcHAuZ2V0UGF0aCgndXNlckRhdGEnKSwgJ2NhY2hlJyk7XHJcbiAgICB0aGlzLm9wZXJhdGlvblF1ZXVlID0gW107XHJcbiAgICB0aGlzLmlzT25saW5lID0gdHJ1ZTtcclxuICAgIHRoaXMubGlzdGVuZXJzID0gbmV3IFNldCgpO1xyXG4gICAgXHJcbiAgICAvLyBJbml0aWFsaXplIGVuY3J5cHRlZCBzdG9yZSBmb3Igb2ZmbGluZSBkYXRhIHdpdGggZXJyb3IgaGFuZGxpbmdcclxuICAgIHRoaXMuc3RvcmUgPSBjcmVhdGVTdG9yZSgnb2ZmbGluZS1kYXRhJywge1xyXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9jZXNzLmVudi5TVE9SRV9FTkNSWVBUSU9OX0tFWVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHRoaXMuc2V0dXBDYWNoZURpcmVjdG9yeSgpO1xyXG4gICAgdGhpcy5sb2FkUXVldWVkT3BlcmF0aW9ucygpO1xyXG4gICAgdGhpcy5zZXR1cE5ldHdvcmtMaXN0ZW5lcnMoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNldHMgdXAgdGhlIGNhY2hlIGRpcmVjdG9yeSBmb3Igb2ZmbGluZSBvcGVyYXRpb25zXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBzZXR1cENhY2hlRGlyZWN0b3J5KCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgZnMuZW5zdXJlRGlyKHRoaXMuY2FjaGVEaXIpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TgSBPZmZsaW5lIGNhY2hlIGRpcmVjdG9yeSByZWFkeTonLCB0aGlzLmNhY2hlRGlyKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2V0IHVwIGNhY2hlIGRpcmVjdG9yeTonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBMb2FkcyBwcmV2aW91c2x5IHF1ZXVlZCBvcGVyYXRpb25zIGZyb20gcGVyc2lzdGVudCBzdG9yYWdlXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBsb2FkUXVldWVkT3BlcmF0aW9ucygpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHNhdmVkUXVldWUgPSB0aGlzLnN0b3JlLmdldCgnb3BlcmF0aW9uUXVldWUnLCBbXSk7XHJcbiAgICAgIHRoaXMub3BlcmF0aW9uUXVldWUgPSBzYXZlZFF1ZXVlO1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiyBMb2FkZWQgJHtzYXZlZFF1ZXVlLmxlbmd0aH0gcXVldWVkIG9wZXJhdGlvbnNgKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gbG9hZCBxdWV1ZWQgb3BlcmF0aW9uczonLCBlcnJvcik7XHJcbiAgICAgIHRoaXMub3BlcmF0aW9uUXVldWUgPSBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNldHMgdXAgbmV0d29yayBzdGF0dXMgY2hhbmdlIGxpc3RlbmVyc1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgc2V0dXBOZXR3b3JrTGlzdGVuZXJzKCkge1xyXG4gICAgY29uc3QgeyBuZXQgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbiAgICBcclxuICAgIC8vIENoZWNrIGluaXRpYWwgb25saW5lIHN0YXR1c1xyXG4gICAgdGhpcy5pc09ubGluZSA9IG5ldC5pc09ubGluZSgpO1xyXG4gICAgXHJcbiAgICAvLyBTZXQgdXAgcGVyaW9kaWMgY2hlY2tzIGZvciBuZXR3b3JrIHN0YXR1c1xyXG4gICAgdGhpcy5uZXR3b3JrQ2hlY2tJbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcclxuICAgICAgY29uc3Qgb25saW5lID0gbmV0LmlzT25saW5lKCk7XHJcbiAgICAgIGlmIChvbmxpbmUgIT09IHRoaXMuaXNPbmxpbmUpIHtcclxuICAgICAgICB0aGlzLmhhbmRsZU9ubGluZVN0YXR1c0NoYW5nZShvbmxpbmUpO1xyXG4gICAgICB9XHJcbiAgICB9LCAxMDAwMCk7IC8vIENoZWNrIGV2ZXJ5IDEwIHNlY29uZHNcclxuICAgIFxyXG4gICAgLy8gUGVyaW9kaWNhbGx5IGNoZWNrIGNvbm5lY3Rpdml0eSB0byBBUElzXHJcbiAgICB0aGlzLmFwaUNoZWNrSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLmNoZWNrQXBpQ29ubmVjdGl2aXR5KCksIDYwMDAwKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEhhbmRsZXMgY2hhbmdlcyBpbiBvbmxpbmUgc3RhdHVzXHJcbiAgICogQHBhcmFtIHtib29sZWFufSBvbmxpbmUgV2hldGhlciB0aGUgc3lzdGVtIGlzIG9ubGluZVxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgaGFuZGxlT25saW5lU3RhdHVzQ2hhbmdlKG9ubGluZSkge1xyXG4gICAgY29uc3QgcHJldmlvdXNTdGF0dXMgPSB0aGlzLmlzT25saW5lO1xyXG4gICAgdGhpcy5pc09ubGluZSA9IG9ubGluZTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYPCfjJAgTmV0d29yayBzdGF0dXMgY2hhbmdlZDogJHtvbmxpbmUgPyAnT25saW5lJyA6ICdPZmZsaW5lJ31gKTtcclxuICAgIFxyXG4gICAgLy8gTm90aWZ5IGxpc3RlbmVycyBvZiBzdGF0dXMgY2hhbmdlXHJcbiAgICB0aGlzLm5vdGlmeUxpc3RlbmVycyh7XHJcbiAgICAgIHR5cGU6ICdzdGF0dXMtY2hhbmdlJyxcclxuICAgICAgb25saW5lLFxyXG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KClcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBJZiBjb21pbmcgYmFjayBvbmxpbmUsIHByb2Nlc3MgcXVldWVkIG9wZXJhdGlvbnNcclxuICAgIGlmICghcHJldmlvdXNTdGF0dXMgJiYgb25saW5lKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMucHJvY2Vzc1F1ZXVlZE9wZXJhdGlvbnMoKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENoZWNrcyBjb25uZWN0aXZpdHkgdG8gcmVxdWlyZWQgQVBJc1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgY2hlY2tBcGlDb25uZWN0aXZpdHkoKSB7XHJcbiAgICBpZiAoIXRoaXMuaXNPbmxpbmUpIHJldHVybjtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gSW1wbGVtZW50IEFQSSBjb25uZWN0aXZpdHkgY2hlY2tcclxuICAgICAgLy8gVGhpcyBjb3VsZCBwaW5nIGtleSBBUElzIHVzZWQgYnkgdGhlIGFwcGxpY2F0aW9uXHJcbiAgICAgIGNvbnN0IGFwaVN0YXR1cyA9IHtcclxuICAgICAgICBvcGVuYWk6IGF3YWl0IHRoaXMucGluZ0FwaSgnaHR0cHM6Ly9hcGkub3BlbmFpLmNvbS92MS9lbmdpbmVzJyksXHJcbiAgICAgICAgLy8gQWRkIG90aGVyIEFQSXMgYXMgbmVlZGVkXHJcbiAgICAgIH07XHJcbiAgICAgIFxyXG4gICAgICAvLyBVcGRhdGUgQVBJLXNwZWNpZmljIG9ubGluZSBzdGF0dXNcclxuICAgICAgdGhpcy5hcGlTdGF0dXMgPSBhcGlTdGF0dXM7XHJcbiAgICAgIFxyXG4gICAgICAvLyBOb3RpZnkgbGlzdGVuZXJzIG9mIEFQSSBzdGF0dXNcclxuICAgICAgdGhpcy5ub3RpZnlMaXN0ZW5lcnMoe1xyXG4gICAgICAgIHR5cGU6ICdhcGktc3RhdHVzJyxcclxuICAgICAgICBzdGF0dXM6IGFwaVN0YXR1cyxcclxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KClcclxuICAgICAgfSk7XHJcbiAgICAgIFxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEFQSSBjb25uZWN0aXZpdHkgY2hlY2sgZmFpbGVkOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFBpbmdzIGFuIEFQSSB0byBjaGVjayBjb25uZWN0aXZpdHlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIEFQSSBlbmRwb2ludCB0byBwaW5nXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFdoZXRoZXIgdGhlIEFQSSBpcyByZWFjaGFibGVcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIGFzeW5jIHBpbmdBcGkodXJsKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCB7IG5ldCB9ID0gcmVxdWlyZSgnZWxlY3Ryb24nKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHJlcXVlc3QgPSBuZXQucmVxdWVzdCh7XHJcbiAgICAgICAgICBtZXRob2Q6ICdIRUFEJyxcclxuICAgICAgICAgIHVybCxcclxuICAgICAgICAgIHRpbWVvdXQ6IDUwMDBcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICByZXF1ZXN0Lm9uKCdyZXNwb25zZScsIChyZXNwb25zZSkgPT4ge1xyXG4gICAgICAgICAgcmVzb2x2ZShyZXNwb25zZS5zdGF0dXNDb2RlID49IDIwMCAmJiByZXNwb25zZS5zdGF0dXNDb2RlIDwgMzAwKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICByZXF1ZXN0Lm9uKCdlcnJvcicsICgpID0+IHtcclxuICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJlcXVlc3Qub24oJ2Fib3J0JywgKCkgPT4ge1xyXG4gICAgICAgICAgcmVzb2x2ZShmYWxzZSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmVxdWVzdC5lbmQoKTtcclxuICAgICAgfSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdBUEkgcGluZyBlcnJvcjonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3NlcyBvcGVyYXRpb25zIHRoYXQgd2VyZSBxdWV1ZWQgd2hpbGUgb2ZmbGluZVxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgcHJvY2Vzc1F1ZXVlZE9wZXJhdGlvbnMoKSB7XHJcbiAgICBpZiAodGhpcy5vcGVyYXRpb25RdWV1ZS5sZW5ndGggPT09IDApIHJldHVybjtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYPCflIQgUHJvY2Vzc2luZyAke3RoaXMub3BlcmF0aW9uUXVldWUubGVuZ3RofSBxdWV1ZWQgb3BlcmF0aW9uc2ApO1xyXG4gICAgXHJcbiAgICAvLyBQcm9jZXNzIG9wZXJhdGlvbnMgaW4gb3JkZXJcclxuICAgIGNvbnN0IHF1ZXVlID0gWy4uLnRoaXMub3BlcmF0aW9uUXVldWVdO1xyXG4gICAgdGhpcy5vcGVyYXRpb25RdWV1ZSA9IFtdO1xyXG4gICAgXHJcbiAgICBmb3IgKGNvbnN0IG9wZXJhdGlvbiBvZiBxdWV1ZSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IHRoaXMuZXhlY3V0ZU9wZXJhdGlvbihvcGVyYXRpb24pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIE5vdGlmeSBhYm91dCBzdWNjZXNzZnVsIG9wZXJhdGlvblxyXG4gICAgICAgIHRoaXMubm90aWZ5TGlzdGVuZXJzKHtcclxuICAgICAgICAgIHR5cGU6ICdvcGVyYXRpb24tY29tcGxldGUnLFxyXG4gICAgICAgICAgb3BlcmF0aW9uLFxyXG4gICAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZhaWxlZCB0byBwcm9jZXNzIHF1ZXVlZCBvcGVyYXRpb246YCwgZXJyb3IpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFJlLXF1ZXVlIGZhaWxlZCBvcGVyYXRpb25cclxuICAgICAgICB0aGlzLnF1ZXVlT3BlcmF0aW9uKG9wZXJhdGlvbik7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gTm90aWZ5IGFib3V0IGZhaWxlZCBvcGVyYXRpb25cclxuICAgICAgICB0aGlzLm5vdGlmeUxpc3RlbmVycyh7XHJcbiAgICAgICAgICB0eXBlOiAnb3BlcmF0aW9uLWZhaWxlZCcsXHJcbiAgICAgICAgICBvcGVyYXRpb24sXHJcbiAgICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSxcclxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBcclxuICAgIC8vIFNhdmUgdXBkYXRlZCBxdWV1ZVxyXG4gICAgdGhpcy5zYXZlUXVldWVkT3BlcmF0aW9ucygpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRXhlY3V0ZXMgYSBzcGVjaWZpYyBvcGVyYXRpb25cclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3BlcmF0aW9uIE9wZXJhdGlvbiB0byBleGVjdXRlXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBleGVjdXRlT3BlcmF0aW9uKG9wZXJhdGlvbikge1xyXG4gICAgc3dpdGNoIChvcGVyYXRpb24udHlwZSkge1xyXG4gICAgICBjYXNlICdjb252ZXJzaW9uJzpcclxuICAgICAgICAvLyBFeGVjdXRlIGNvbnZlcnNpb24gb3BlcmF0aW9uXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0ZUNvbnZlcnNpb25PcGVyYXRpb24ob3BlcmF0aW9uKTtcclxuICAgICAgXHJcbiAgICAgIGNhc2UgJ2FwaS1yZXF1ZXN0JzpcclxuICAgICAgICAvLyBFeGVjdXRlIEFQSSByZXF1ZXN0IG9wZXJhdGlvblxyXG4gICAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGVBcGlSZXF1ZXN0T3BlcmF0aW9uKG9wZXJhdGlvbik7XHJcbiAgICAgIFxyXG4gICAgICBjYXNlICdzeW5jJzpcclxuICAgICAgICAvLyBFeGVjdXRlIHN5bmMgb3BlcmF0aW9uXHJcbiAgICAgICAgcmV0dXJuIHRoaXMuZXhlY3V0ZVN5bmNPcGVyYXRpb24ob3BlcmF0aW9uKTtcclxuICAgICAgXHJcbiAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbmtub3duIG9wZXJhdGlvbiB0eXBlOiAke29wZXJhdGlvbi50eXBlfWApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRXhlY3V0ZXMgYSBjb252ZXJzaW9uIG9wZXJhdGlvblxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcGVyYXRpb24gQ29udmVyc2lvbiBvcGVyYXRpb25cclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIGFzeW5jIGV4ZWN1dGVDb252ZXJzaW9uT3BlcmF0aW9uKG9wZXJhdGlvbikge1xyXG4gICAgLy8gSW1wbGVtZW50YXRpb24gd2lsbCBkZXBlbmQgb24gdGhlIGNvbnZlcnNpb24gc2VydmljZVxyXG4gICAgLy8gVGhpcyBpcyBhIHBsYWNlaG9sZGVyXHJcbiAgICBjb25zb2xlLmxvZygnRXhlY3V0aW5nIGNvbnZlcnNpb24gb3BlcmF0aW9uOicsIG9wZXJhdGlvbik7XHJcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFeGVjdXRlcyBhbiBBUEkgcmVxdWVzdCBvcGVyYXRpb25cclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3BlcmF0aW9uIEFQSSByZXF1ZXN0IG9wZXJhdGlvblxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgZXhlY3V0ZUFwaVJlcXVlc3RPcGVyYXRpb24ob3BlcmF0aW9uKSB7XHJcbiAgICAvLyBJbXBsZW1lbnRhdGlvbiB3aWxsIGRlcGVuZCBvbiB0aGUgQVBJIGNsaWVudFxyXG4gICAgLy8gVGhpcyBpcyBhIHBsYWNlaG9sZGVyXHJcbiAgICBjb25zb2xlLmxvZygnRXhlY3V0aW5nIEFQSSByZXF1ZXN0IG9wZXJhdGlvbjonLCBvcGVyYXRpb24pO1xyXG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRXhlY3V0ZXMgYSBzeW5jIG9wZXJhdGlvblxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcGVyYXRpb24gU3luYyBvcGVyYXRpb25cclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIGFzeW5jIGV4ZWN1dGVTeW5jT3BlcmF0aW9uKG9wZXJhdGlvbikge1xyXG4gICAgLy8gSW1wbGVtZW50YXRpb24gd2lsbCBkZXBlbmQgb24gdGhlIHN5bmMgcmVxdWlyZW1lbnRzXHJcbiAgICAvLyBUaGlzIGlzIGEgcGxhY2Vob2xkZXJcclxuICAgIGNvbnNvbGUubG9nKCdFeGVjdXRpbmcgc3luYyBvcGVyYXRpb246Jywgb3BlcmF0aW9uKTtcclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFF1ZXVlcyBhbiBvcGVyYXRpb24gZm9yIGxhdGVyIGV4ZWN1dGlvbiB3aGVuIG9ubGluZVxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcGVyYXRpb24gT3BlcmF0aW9uIHRvIHF1ZXVlXHJcbiAgICogQHJldHVybnMge3N0cmluZ30gT3BlcmF0aW9uIElEXHJcbiAgICovXHJcbiAgcXVldWVPcGVyYXRpb24ob3BlcmF0aW9uKSB7XHJcbiAgICAvLyBHZW5lcmF0ZSBvcGVyYXRpb24gSUQgaWYgbm90IHByb3ZpZGVkXHJcbiAgICBpZiAoIW9wZXJhdGlvbi5pZCkge1xyXG4gICAgICBvcGVyYXRpb24uaWQgPSBgb3BfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCA5KX1gO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBBZGQgdGltZXN0YW1wIGlmIG5vdCBwcm92aWRlZFxyXG4gICAgaWYgKCFvcGVyYXRpb24udGltZXN0YW1wKSB7XHJcbiAgICAgIG9wZXJhdGlvbi50aW1lc3RhbXAgPSBEYXRlLm5vdygpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBBZGQgdG8gcXVldWVcclxuICAgIHRoaXMub3BlcmF0aW9uUXVldWUucHVzaChvcGVyYXRpb24pO1xyXG4gICAgXHJcbiAgICAvLyBTYXZlIHVwZGF0ZWQgcXVldWVcclxuICAgIHRoaXMuc2F2ZVF1ZXVlZE9wZXJhdGlvbnMoKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYOKelSBRdWV1ZWQgb3BlcmF0aW9uOiAke29wZXJhdGlvbi50eXBlfSAoJHtvcGVyYXRpb24uaWR9KWApO1xyXG4gICAgXHJcbiAgICByZXR1cm4gb3BlcmF0aW9uLmlkO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2F2ZXMgdGhlIG9wZXJhdGlvbiBxdWV1ZSB0byBwZXJzaXN0ZW50IHN0b3JhZ2VcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIHNhdmVRdWV1ZWRPcGVyYXRpb25zKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgdGhpcy5zdG9yZS5zZXQoJ29wZXJhdGlvblF1ZXVlJywgdGhpcy5vcGVyYXRpb25RdWV1ZSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCfinYwgRmFpbGVkIHRvIHNhdmUgcXVldWVkIG9wZXJhdGlvbnM6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2FjaGVzIGRhdGEgZm9yIG9mZmxpbmUgdXNlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSBDYWNoZSBrZXlcclxuICAgKiBAcGFyYW0ge2FueX0gZGF0YSBEYXRhIHRvIGNhY2hlXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICovXHJcbiAgYXN5bmMgY2FjaGVEYXRhKGtleSwgZGF0YSkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY2FjaGVGaWxlID0gcGF0aC5qb2luKHRoaXMuY2FjaGVEaXIsIGAke2tleX0uanNvbmApO1xyXG4gICAgICBhd2FpdCBmcy53cml0ZUpzb24oY2FjaGVGaWxlLCB7XHJcbiAgICAgICAgZGF0YSxcclxuICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KClcclxuICAgICAgfSk7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihg4p2MIEZhaWxlZCB0byBjYWNoZSBkYXRhIGZvciBrZXkgJHtrZXl9OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUmV0cmlldmVzIGNhY2hlZCBkYXRhXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSBDYWNoZSBrZXlcclxuICAgKiBAcGFyYW0ge251bWJlcn0gW21heEFnZV0gTWF4aW11bSBhZ2UgaW4gbWlsbGlzZWNvbmRzXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8YW55Pn0gQ2FjaGVkIGRhdGEgb3IgbnVsbCBpZiBub3QgZm91bmQgb3IgZXhwaXJlZFxyXG4gICAqL1xyXG4gIGFzeW5jIGdldENhY2hlZERhdGEoa2V5LCBtYXhBZ2UgPSBudWxsKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBjYWNoZUZpbGUgPSBwYXRoLmpvaW4odGhpcy5jYWNoZURpciwgYCR7a2V5fS5qc29uYCk7XHJcbiAgICAgIFxyXG4gICAgICBpZiAoIWF3YWl0IGZzLnBhdGhFeGlzdHMoY2FjaGVGaWxlKSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBjYWNoZWQgPSBhd2FpdCBmcy5yZWFkSnNvbihjYWNoZUZpbGUpO1xyXG4gICAgICBcclxuICAgICAgLy8gQ2hlY2sgaWYgY2FjaGUgaXMgZXhwaXJlZFxyXG4gICAgICBpZiAobWF4QWdlICYmIERhdGUubm93KCkgLSBjYWNoZWQudGltZXN0YW1wID4gbWF4QWdlKSB7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIHJldHVybiBjYWNoZWQuZGF0YTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBGYWlsZWQgdG8gZ2V0IGNhY2hlZCBkYXRhIGZvciBrZXkgJHtrZXl9OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBJbnZhbGlkYXRlcyBjYWNoZWQgZGF0YVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgQ2FjaGUga2V5XHJcbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICovXHJcbiAgYXN5bmMgaW52YWxpZGF0ZUNhY2hlKGtleSkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY2FjaGVGaWxlID0gcGF0aC5qb2luKHRoaXMuY2FjaGVEaXIsIGAke2tleX0uanNvbmApO1xyXG4gICAgICBcclxuICAgICAgaWYgKGF3YWl0IGZzLnBhdGhFeGlzdHMoY2FjaGVGaWxlKSkge1xyXG4gICAgICAgIGF3YWl0IGZzLnJlbW92ZShjYWNoZUZpbGUpO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBGYWlsZWQgdG8gaW52YWxpZGF0ZSBjYWNoZSBmb3Iga2V5ICR7a2V5fTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENsZWFycyBhbGwgY2FjaGVkIGRhdGFcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTxib29sZWFuPn0gU3VjY2VzcyBzdGF0dXNcclxuICAgKi9cclxuICBhc3luYyBjbGVhckNhY2hlKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgZnMuZW1wdHlEaXIodGhpcy5jYWNoZURpcik7XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBjbGVhciBjYWNoZTonLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldHMgdGhlIGN1cnJlbnQgb25saW5lIHN0YXR1c1xyXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBXaGV0aGVyIHRoZSBzeXN0ZW0gaXMgb25saW5lXHJcbiAgICovXHJcbiAgZ2V0T25saW5lU3RhdHVzKCkge1xyXG4gICAgcmV0dXJuIHRoaXMuaXNPbmxpbmU7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZXRzIHRoZSBjdXJyZW50IEFQSSBzdGF0dXNcclxuICAgKiBAcmV0dXJucyB7T2JqZWN0fSBBUEkgc3RhdHVzIG9iamVjdFxyXG4gICAqL1xyXG4gIGdldEFwaVN0YXR1cygpIHtcclxuICAgIHJldHVybiB0aGlzLmFwaVN0YXR1cyB8fCB7fTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldHMgdGhlIGN1cnJlbnQgb3BlcmF0aW9uIHF1ZXVlXHJcbiAgICogQHJldHVybnMge0FycmF5fSBRdWV1ZWQgb3BlcmF0aW9uc1xyXG4gICAqL1xyXG4gIGdldFF1ZXVlZE9wZXJhdGlvbnMoKSB7XHJcbiAgICByZXR1cm4gWy4uLnRoaXMub3BlcmF0aW9uUXVldWVdO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQWRkcyBhIGxpc3RlbmVyIGZvciBvZmZsaW5lIGV2ZW50c1xyXG4gICAqIEBwYXJhbSB7RnVuY3Rpb259IGxpc3RlbmVyIEV2ZW50IGxpc3RlbmVyIGZ1bmN0aW9uXHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IFN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICovXHJcbiAgYWRkTGlzdGVuZXIobGlzdGVuZXIpIHtcclxuICAgIGlmICh0eXBlb2YgbGlzdGVuZXIgIT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICB0aGlzLmxpc3RlbmVycy5hZGQobGlzdGVuZXIpO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZW1vdmVzIGEgbGlzdGVuZXJcclxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciBFdmVudCBsaXN0ZW5lciBmdW5jdGlvblxyXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBTdWNjZXNzIHN0YXR1c1xyXG4gICAqL1xyXG4gIHJlbW92ZUxpc3RlbmVyKGxpc3RlbmVyKSB7XHJcbiAgICByZXR1cm4gdGhpcy5saXN0ZW5lcnMuZGVsZXRlKGxpc3RlbmVyKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIE5vdGlmaWVzIGFsbCBsaXN0ZW5lcnMgb2YgYW4gZXZlbnRcclxuICAgKiBAcGFyYW0ge09iamVjdH0gZXZlbnQgRXZlbnQgb2JqZWN0XHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBub3RpZnlMaXN0ZW5lcnMoZXZlbnQpIHtcclxuICAgIHRoaXMubGlzdGVuZXJzLmZvckVhY2gobGlzdGVuZXIgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGxpc3RlbmVyKGV2ZW50KTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLmVycm9yKCfinYwgRXJyb3IgaW4gb2ZmbGluZSBldmVudCBsaXN0ZW5lcjonLCBlcnJvcik7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2xlYW5zIHVwIHJlc291cmNlc1xyXG4gICAqL1xyXG4gIGNsZWFudXAoKSB7XHJcbiAgICAvLyBDbGVhciBpbnRlcnZhbHNcclxuICAgIGlmICh0aGlzLm5ldHdvcmtDaGVja0ludGVydmFsKSB7XHJcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5uZXR3b3JrQ2hlY2tJbnRlcnZhbCk7XHJcbiAgICB9XHJcbiAgICBcclxuICAgIGlmICh0aGlzLmFwaUNoZWNrSW50ZXJ2YWwpIHtcclxuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLmFwaUNoZWNrSW50ZXJ2YWwpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBDbGVhciBsaXN0ZW5lcnNcclxuICAgIHRoaXMubGlzdGVuZXJzLmNsZWFyKCk7XHJcbiAgICBcclxuICAgIC8vIFNhdmUgYW55IHBlbmRpbmcgb3BlcmF0aW9uc1xyXG4gICAgdGhpcy5zYXZlUXVldWVkT3BlcmF0aW9ucygpO1xyXG4gICAgXHJcbiAgICBjb25zb2xlLmxvZygn8J+nuSBPZmZsaW5lIHNlcnZpY2UgY2xlYW5lZCB1cCcpO1xyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgT2ZmbGluZVNlcnZpY2UoKTtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUMsRUFBRSxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU07RUFBRUU7QUFBSSxDQUFDLEdBQUdGLE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDbkMsTUFBTTtFQUFFRztBQUFZLENBQUMsR0FBR0gsT0FBTyxDQUFDLHVCQUF1QixDQUFDO0FBQ3hELE1BQU07RUFBRUksUUFBUSxFQUFFQztBQUFrQixDQUFDLEdBQUdMLE9BQU8sQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7O0FBRXhFLE1BQU1NLGNBQWMsQ0FBQztFQUNuQkMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1osSUFBSSxDQUFDQyxVQUFVLEdBQUdILGlCQUFpQixDQUFDLENBQUM7SUFDckMsSUFBSSxDQUFDSSxRQUFRLEdBQUdWLElBQUksQ0FBQ1csSUFBSSxDQUFDUixHQUFHLENBQUNTLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRSxPQUFPLENBQUM7SUFDM0QsSUFBSSxDQUFDQyxjQUFjLEdBQUcsRUFBRTtJQUN4QixJQUFJLENBQUNDLFFBQVEsR0FBRyxJQUFJO0lBQ3BCLElBQUksQ0FBQ0MsU0FBUyxHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDOztJQUUxQjtJQUNBLElBQUksQ0FBQ0MsS0FBSyxHQUFHYixXQUFXLENBQUMsY0FBYyxFQUFFO01BQ3ZDYyxhQUFhLEVBQUVDLE9BQU8sQ0FBQ0Ms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QVMsSUFBSSxDQUFDLENBQUM7RUFDN0I7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7RUFDRWdELG1CQUFtQkEsQ0FBQSxFQUFHO0lBQ3BCLE9BQU8sQ0FBQyxHQUFHLElBQUksQ0FBQ2pGLGNBQWMsQ0FBQztFQUNqQzs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VrRixXQUFXQSxDQUFDQyxRQUFRLEVBQUU7SUFDcEIsSUFBSSxPQUFPQSxRQUFRLEtBQUssVUFBVSxFQUFFO01BQ2xDLE9BQU8sS0FBSztJQUNkO0lBRUEsSUFBSSxDQUFDakYsU0FBUyxDQUFDa0YsR0FBRyxDQUFDRCxRQUFRLENBQUM7SUFDNUIsT0FBTyxJQUFJO0VBQ2I7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtFQUNFRSxjQUFjQSxDQUFDRixRQUFRLEVBQUU7SUFDdkIsT0FBTyxJQUFJLENBQUNqRixTQUFTLENBQUNvRixNQUFNLENBQUNILFFBQVEsQ0FBQztFQUN4Qzs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0V4RCxlQUFlQSxDQUFDNEQsS0FBSyxFQUFFO0lBQ3JCLElBQUksQ0FBQ3JGLFNBQVMsQ0FBQ3NGLE9BQU8sQ0FBQ0wsUUFBUSxJQUFJO01BQ2pDLElBQUk7UUFDRkEsUUFBUSxDQUFDSSxLQUFLLENBQUM7TUFDakIsQ0FBQyxDQUFDLE9BQU94RSxLQUFLLEVBQUU7UUFDZEYsT0FBTyxDQUFDRSxLQUFLLENBQUMsb0NBQW9DLEVBQUVBLEtBQUssQ0FBQztNQUM1RDtJQUNGLENBQUMsQ0FBQztFQUNKOztFQUVBO0FBQ0Y7QUFDQTtFQUNFMEUsT0FBT0EsQ0FBQSxFQUFHO0lBQ1I7SUFDQSxJQUFJLElBQUksQ0FBQ3JFLG9CQUFvQixFQUFFO01BQzdCc0UsYUFBYSxDQUFDLElBQUksQ0FBQ3RFLG9CQUFvQixDQUFDO0lBQzFDO0lBRUEsSUFBSSxJQUFJLENBQUNJLGdCQUFnQixFQUFFO01BQ3pCa0UsYUFBYSxDQUFDLElBQUksQ0FBQ2xFLGdCQUFnQixDQUFDO0lBQ3RDOztJQUVBO0lBQ0EsSUFBSSxDQUFDdEIsU0FBUyxDQUFDeUYsS0FBSyxDQUFDLENBQUM7O0lBRXRCO0lBQ0EsSUFBSSxDQUFDdkMsb0JBQW9CLENBQUMsQ0FBQztJQUUzQnZDLE9BQU8sQ0FBQ0MsR0FBRyxDQUFDLCtCQUErQixDQUFDO0VBQzlDO0FBQ0Y7QUFFQThFLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHLElBQUluRyxjQUFjLENBQUMsQ0FBQyIsImlnbm9yZUxpc3QiOltdfQ==