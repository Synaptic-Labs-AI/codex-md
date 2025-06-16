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
        mistral: await this.pingApi('https://api.mistral.ai/v1/models'),
        deepgram: await this.pingApi('https://api.deepgram.com/v1/')
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiYXBwIiwiY3JlYXRlU3RvcmUiLCJpbnN0YW5jZSIsIkZpbGVTeXN0ZW1TZXJ2aWNlIiwiT2ZmbGluZVNlcnZpY2UiLCJjb25zdHJ1Y3RvciIsImZpbGVTeXN0ZW0iLCJjYWNoZURpciIsImpvaW4iLCJnZXRQYXRoIiwib3BlcmF0aW9uUXVldWUiLCJpc09ubGluZSIsImxpc3RlbmVycyIsIlNldCIsInN0b3JlIiwiZW5jcnlwdGlvbktleSIsInByb2Nlc3MiLCJlbnYiLCJTVE9SRV9FTkNSWVBUSU9OX0tFWSIsInNldHVwQ2FjaGVEaXJlY3RvcnkiLCJsb2FkUXVldWVkT3BlcmF0aW9ucyIsInNldHVwTmV0d29ya0xpc3RlbmVycyIsImVuc3VyZURpciIsImNvbnNvbGUiLCJsb2ciLCJlcnJvciIsInNhdmVkUXVldWUiLCJnZXQiLCJsZW5ndGgiLCJuZXQiLCJuZXR3b3JrQ2hlY2tJbnRlcnZhbCIsInNldEludGVydmFsIiwib25saW5lIiwiaGFuZGxlT25saW5lU3RhdHVzQ2hhbmdlIiwiYXBpQ2hlY2tJbnRlcnZhbCIsImNoZWNrQXBpQ29ubmVjdGl2aXR5IiwicHJldmlvdXNTdGF0dXMiLCJub3RpZnlMaXN0ZW5lcnMiLCJ0eXBlIiwidGltZXN0YW1wIiwiRGF0ZSIsIm5vdyIsInByb2Nlc3NRdWV1ZWRPcGVyYXRpb25zIiwiYXBpU3RhdHVzIiwibWlzdHJhbCIsInBpbmdBcGkiLCJkZWVwZ3JhbSIsInN0YXR1cyIsInVybCIsIlByb21pc2UiLCJyZXNvbHZlIiwicmVxdWVzdCIsIm1ldGhvZCIsInRpbWVvdXQiLCJvbiIsInJlc3BvbnNlIiwic3RhdHVzQ29kZSIsImVuZCIsInF1ZXVlIiwib3BlcmF0aW9uIiwiZXhlY3V0ZU9wZXJhdGlvbiIsInF1ZXVlT3BlcmF0aW9uIiwibWVzc2FnZSIsInNhdmVRdWV1ZWRPcGVyYXRpb25zIiwiZXhlY3V0ZUNvbnZlcnNpb25PcGVyYXRpb24iLCJleGVjdXRlQXBpUmVxdWVzdE9wZXJhdGlvbiIsImV4ZWN1dGVTeW5jT3BlcmF0aW9uIiwiRXJyb3IiLCJzdWNjZXNzIiwiaWQiLCJNYXRoIiwicmFuZG9tIiwidG9TdHJpbmciLCJzdWJzdHIiLCJwdXNoIiwic2V0IiwiY2FjaGVEYXRhIiwia2V5IiwiZGF0YSIsImNhY2hlRmlsZSIsIndyaXRlSnNvbiIsImdldENhY2hlZERhdGEiLCJtYXhBZ2UiLCJwYXRoRXhpc3RzIiwiY2FjaGVkIiwicmVhZEpzb24iLCJpbnZhbGlkYXRlQ2FjaGUiLCJyZW1vdmUiLCJjbGVhckNhY2hlIiwiZW1wdHlEaXIiLCJnZXRPbmxpbmVTdGF0dXMiLCJnZXRBcGlTdGF0dXMiLCJnZXRRdWV1ZWRPcGVyYXRpb25zIiwiYWRkTGlzdGVuZXIiLCJsaXN0ZW5lciIsImFkZCIsInJlbW92ZUxpc3RlbmVyIiwiZGVsZXRlIiwiZXZlbnQiLCJmb3JFYWNoIiwiY2xlYW51cCIsImNsZWFySW50ZXJ2YWwiLCJjbGVhciIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvT2ZmbGluZVNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIE9mZmxpbmVTZXJ2aWNlLmpzXHJcbiAqIFByb3ZpZGVzIG9mZmxpbmUgY2FwYWJpbGl0aWVzIGZvciB0aGUgRWxlY3Ryb24gYXBwbGljYXRpb24uXHJcbiAqIFxyXG4gKiBUaGlzIHNlcnZpY2UgbWFuYWdlczpcclxuICogLSBDYWNoaW5nIHN5c3RlbSBmb3IgbG9jYWwgb3BlcmF0aW9uc1xyXG4gKiAtIE9wZXJhdGlvbiBxdWV1ZSBmb3IgcGVuZGluZyB0YXNrc1xyXG4gKiAtIFN0YXRlIHBlcnNpc3RlbmNlIGZvciBvZmZsaW5lIG1vZGVcclxuICogLSBTeW5jIG1lY2hhbmlzbXMgZm9yIHJlY29ubmVjdGlvblxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBGaWxlU3lzdGVtU2VydmljZS5qczogTmF0aXZlIGZpbGUgb3BlcmF0aW9uc1xyXG4gKiAtIEVsZWN0cm9uQ29udmVyc2lvblNlcnZpY2UuanM6IENvbnZlcnNpb24gb3BlcmF0aW9uc1xyXG4gKiAtIGlwYy9oYW5kbGVycy9vZmZsaW5lL2luZGV4LmpzOiBJUEMgaGFuZGxlcnMgZm9yIG9mZmxpbmUgZmVhdHVyZXNcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCB7IGNyZWF0ZVN0b3JlIH0gPSByZXF1aXJlKCcuLi91dGlscy9zdG9yZUZhY3RvcnknKTtcclxuY29uc3QgeyBpbnN0YW5jZTogRmlsZVN5c3RlbVNlcnZpY2UgfSA9IHJlcXVpcmUoJy4vRmlsZVN5c3RlbVNlcnZpY2UnKTsgLy8gSW1wb3J0IGluc3RhbmNlXHJcblxyXG5jbGFzcyBPZmZsaW5lU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IoKSB7XHJcbiAgICB0aGlzLmZpbGVTeXN0ZW0gPSBGaWxlU3lzdGVtU2VydmljZTsgLy8gVXNlIHRoZSBpbXBvcnRlZCBpbnN0YW5jZVxyXG4gICAgdGhpcy5jYWNoZURpciA9IHBhdGguam9pbihhcHAuZ2V0UGF0aCgndXNlckRhdGEnKSwgJ2NhY2hlJyk7XHJcbiAgICB0aGlzLm9wZXJhdGlvblF1ZXVlID0gW107XHJcbiAgICB0aGlzLmlzT25saW5lID0gdHJ1ZTtcclxuICAgIHRoaXMubGlzdGVuZXJzID0gbmV3IFNldCgpO1xyXG4gICAgXHJcbiAgICAvLyBJbml0aWFsaXplIGVuY3J5cHRlZCBzdG9yZSBmb3Igb2ZmbGluZSBkYXRhIHdpdGggZXJyb3IgaGFuZGxpbmdcclxuICAgIHRoaXMuc3RvcmUgPSBjcmVhdGVTdG9yZSgnb2ZmbGluZS1kYXRhJywge1xyXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9jZXNzLmVudi5TVE9SRV9FTkNSWVBUSU9OX0tFWVxyXG4gICAgfSk7XHJcbiAgICBcclxuICAgIHRoaXMuc2V0dXBDYWNoZURpcmVjdG9yeSgpO1xyXG4gICAgdGhpcy5sb2FkUXVldWVkT3BlcmF0aW9ucygpO1xyXG4gICAgdGhpcy5zZXR1cE5ldHdvcmtMaXN0ZW5lcnMoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNldHMgdXAgdGhlIGNhY2hlIGRpcmVjdG9yeSBmb3Igb2ZmbGluZSBvcGVyYXRpb25zXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBzZXR1cENhY2hlRGlyZWN0b3J5KCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgZnMuZW5zdXJlRGlyKHRoaXMuY2FjaGVEaXIpO1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+TgSBPZmZsaW5lIGNhY2hlIGRpcmVjdG9yeSByZWFkeTonLCB0aGlzLmNhY2hlRGlyKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gc2V0IHVwIGNhY2hlIGRpcmVjdG9yeTonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBMb2FkcyBwcmV2aW91c2x5IHF1ZXVlZCBvcGVyYXRpb25zIGZyb20gcGVyc2lzdGVudCBzdG9yYWdlXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBsb2FkUXVldWVkT3BlcmF0aW9ucygpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IHNhdmVkUXVldWUgPSB0aGlzLnN0b3JlLmdldCgnb3BlcmF0aW9uUXVldWUnLCBbXSk7XHJcbiAgICAgIHRoaXMub3BlcmF0aW9uUXVldWUgPSBzYXZlZFF1ZXVlO1xyXG4gICAgICBjb25zb2xlLmxvZyhg8J+TiyBMb2FkZWQgJHtzYXZlZFF1ZXVlLmxlbmd0aH0gcXVldWVkIG9wZXJhdGlvbnNgKTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gbG9hZCBxdWV1ZWQgb3BlcmF0aW9uczonLCBlcnJvcik7XHJcbiAgICAgIHRoaXMub3BlcmF0aW9uUXVldWUgPSBbXTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNldHMgdXAgbmV0d29yayBzdGF0dXMgY2hhbmdlIGxpc3RlbmVyc1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgc2V0dXBOZXR3b3JrTGlzdGVuZXJzKCkge1xyXG4gICAgY29uc3QgeyBuZXQgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbiAgICBcclxuICAgIC8vIENoZWNrIGluaXRpYWwgb25saW5lIHN0YXR1c1xyXG4gICAgdGhpcy5pc09ubGluZSA9IG5ldC5pc09ubGluZSgpO1xyXG4gICAgXHJcbiAgICAvLyBTZXQgdXAgcGVyaW9kaWMgY2hlY2tzIGZvciBuZXR3b3JrIHN0YXR1c1xyXG4gICAgdGhpcy5uZXR3b3JrQ2hlY2tJbnRlcnZhbCA9IHNldEludGVydmFsKCgpID0+IHtcclxuICAgICAgY29uc3Qgb25saW5lID0gbmV0LmlzT25saW5lKCk7XHJcbiAgICAgIGlmIChvbmxpbmUgIT09IHRoaXMuaXNPbmxpbmUpIHtcclxuICAgICAgICB0aGlzLmhhbmRsZU9ubGluZVN0YXR1c0NoYW5nZShvbmxpbmUpO1xyXG4gICAgICB9XHJcbiAgICB9LCAxMDAwMCk7IC8vIENoZWNrIGV2ZXJ5IDEwIHNlY29uZHNcclxuICAgIFxyXG4gICAgLy8gUGVyaW9kaWNhbGx5IGNoZWNrIGNvbm5lY3Rpdml0eSB0byBBUElzXHJcbiAgICB0aGlzLmFwaUNoZWNrSW50ZXJ2YWwgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLmNoZWNrQXBpQ29ubmVjdGl2aXR5KCksIDYwMDAwKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEhhbmRsZXMgY2hhbmdlcyBpbiBvbmxpbmUgc3RhdHVzXHJcbiAgICogQHBhcmFtIHtib29sZWFufSBvbmxpbmUgV2hldGhlciB0aGUgc3lzdGVtIGlzIG9ubGluZVxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgaGFuZGxlT25saW5lU3RhdHVzQ2hhbmdlKG9ubGluZSkge1xyXG4gICAgY29uc3QgcHJldmlvdXNTdGF0dXMgPSB0aGlzLmlzT25saW5lO1xyXG4gICAgdGhpcy5pc09ubGluZSA9IG9ubGluZTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coYPCfjJAgTmV0d29yayBzdGF0dXMgY2hhbmdlZDogJHtvbmxpbmUgPyAnT25saW5lJyA6ICdPZmZsaW5lJ31gKTtcclxuICAgIFxyXG4gICAgLy8gTm90aWZ5IGxpc3RlbmVycyBvZiBzdGF0dXMgY2hhbmdlXHJcbiAgICB0aGlzLm5vdGlmeUxpc3RlbmVycyh7XHJcbiAgICAgIHR5cGU6ICdzdGF0dXMtY2hhbmdlJyxcclxuICAgICAgb25saW5lLFxyXG4gICAgICB0aW1lc3RhbXA6IERhdGUubm93KClcclxuICAgIH0pO1xyXG4gICAgXHJcbiAgICAvLyBJZiBjb21pbmcgYmFjayBvbmxpbmUsIHByb2Nlc3MgcXVldWVkIG9wZXJhdGlvbnNcclxuICAgIGlmICghcHJldmlvdXNTdGF0dXMgJiYgb25saW5lKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMucHJvY2Vzc1F1ZXVlZE9wZXJhdGlvbnMoKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENoZWNrcyBjb25uZWN0aXZpdHkgdG8gcmVxdWlyZWQgQVBJc1xyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgY2hlY2tBcGlDb25uZWN0aXZpdHkoKSB7XHJcbiAgICBpZiAoIXRoaXMuaXNPbmxpbmUpIHJldHVybjtcclxuICAgIFxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gSW1wbGVtZW50IEFQSSBjb25uZWN0aXZpdHkgY2hlY2tcclxuICAgICAgLy8gVGhpcyBjb3VsZCBwaW5nIGtleSBBUElzIHVzZWQgYnkgdGhlIGFwcGxpY2F0aW9uXHJcbiAgICAgIGNvbnN0IGFwaVN0YXR1cyA9IHtcclxuICAgICAgICBtaXN0cmFsOiBhd2FpdCB0aGlzLnBpbmdBcGkoJ2h0dHBzOi8vYXBpLm1pc3RyYWwuYWkvdjEvbW9kZWxzJyksXHJcbiAgICAgICAgZGVlcGdyYW06IGF3YWl0IHRoaXMucGluZ0FwaSgnaHR0cHM6Ly9hcGkuZGVlcGdyYW0uY29tL3YxLycpLFxyXG4gICAgICAgIC8vIEFkZCBvdGhlciBBUElzIGFzIG5lZWRlZFxyXG4gICAgICB9O1xyXG4gICAgICBcclxuICAgICAgLy8gVXBkYXRlIEFQSS1zcGVjaWZpYyBvbmxpbmUgc3RhdHVzXHJcbiAgICAgIHRoaXMuYXBpU3RhdHVzID0gYXBpU3RhdHVzO1xyXG4gICAgICBcclxuICAgICAgLy8gTm90aWZ5IGxpc3RlbmVycyBvZiBBUEkgc3RhdHVzXHJcbiAgICAgIHRoaXMubm90aWZ5TGlzdGVuZXJzKHtcclxuICAgICAgICB0eXBlOiAnYXBpLXN0YXR1cycsXHJcbiAgICAgICAgc3RhdHVzOiBhcGlTdGF0dXMsXHJcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBBUEkgY29ubmVjdGl2aXR5IGNoZWNrIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQaW5ncyBhbiBBUEkgdG8gY2hlY2sgY29ubmVjdGl2aXR5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHVybCBBUEkgZW5kcG9pbnQgdG8gcGluZ1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBXaGV0aGVyIHRoZSBBUEkgaXMgcmVhY2hhYmxlXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBwaW5nQXBpKHVybCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgeyBuZXQgfSA9IHJlcXVpcmUoJ2VsZWN0cm9uJyk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHtcclxuICAgICAgICBjb25zdCByZXF1ZXN0ID0gbmV0LnJlcXVlc3Qoe1xyXG4gICAgICAgICAgbWV0aG9kOiAnSEVBRCcsXHJcbiAgICAgICAgICB1cmwsXHJcbiAgICAgICAgICB0aW1lb3V0OiA1MDAwXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmVxdWVzdC5vbigncmVzcG9uc2UnLCAocmVzcG9uc2UpID0+IHtcclxuICAgICAgICAgIHJlc29sdmUocmVzcG9uc2Uuc3RhdHVzQ29kZSA+PSAyMDAgJiYgcmVzcG9uc2Uuc3RhdHVzQ29kZSA8IDMwMCk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmVxdWVzdC5vbignZXJyb3InLCAoKSA9PiB7XHJcbiAgICAgICAgICByZXNvbHZlKGZhbHNlKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICByZXF1ZXN0Lm9uKCdhYm9ydCcsICgpID0+IHtcclxuICAgICAgICAgIHJlc29sdmUoZmFsc2UpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHJlcXVlc3QuZW5kKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcignQVBJIHBpbmcgZXJyb3I6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQcm9jZXNzZXMgb3BlcmF0aW9ucyB0aGF0IHdlcmUgcXVldWVkIHdoaWxlIG9mZmxpbmVcclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIGFzeW5jIHByb2Nlc3NRdWV1ZWRPcGVyYXRpb25zKCkge1xyXG4gICAgaWYgKHRoaXMub3BlcmF0aW9uUXVldWUubGVuZ3RoID09PSAwKSByZXR1cm47XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGDwn5SEIFByb2Nlc3NpbmcgJHt0aGlzLm9wZXJhdGlvblF1ZXVlLmxlbmd0aH0gcXVldWVkIG9wZXJhdGlvbnNgKTtcclxuICAgIFxyXG4gICAgLy8gUHJvY2VzcyBvcGVyYXRpb25zIGluIG9yZGVyXHJcbiAgICBjb25zdCBxdWV1ZSA9IFsuLi50aGlzLm9wZXJhdGlvblF1ZXVlXTtcclxuICAgIHRoaXMub3BlcmF0aW9uUXVldWUgPSBbXTtcclxuICAgIFxyXG4gICAgZm9yIChjb25zdCBvcGVyYXRpb24gb2YgcXVldWUpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBhd2FpdCB0aGlzLmV4ZWN1dGVPcGVyYXRpb24ob3BlcmF0aW9uKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBOb3RpZnkgYWJvdXQgc3VjY2Vzc2Z1bCBvcGVyYXRpb25cclxuICAgICAgICB0aGlzLm5vdGlmeUxpc3RlbmVycyh7XHJcbiAgICAgICAgICB0eXBlOiAnb3BlcmF0aW9uLWNvbXBsZXRlJyxcclxuICAgICAgICAgIG9wZXJhdGlvbixcclxuICAgICAgICAgIHRpbWVzdGFtcDogRGF0ZS5ub3coKVxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBGYWlsZWQgdG8gcHJvY2VzcyBxdWV1ZWQgb3BlcmF0aW9uOmAsIGVycm9yKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBSZS1xdWV1ZSBmYWlsZWQgb3BlcmF0aW9uXHJcbiAgICAgICAgdGhpcy5xdWV1ZU9wZXJhdGlvbihvcGVyYXRpb24pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIE5vdGlmeSBhYm91dCBmYWlsZWQgb3BlcmF0aW9uXHJcbiAgICAgICAgdGhpcy5ub3RpZnlMaXN0ZW5lcnMoe1xyXG4gICAgICAgICAgdHlwZTogJ29wZXJhdGlvbi1mYWlsZWQnLFxyXG4gICAgICAgICAgb3BlcmF0aW9uLFxyXG4gICAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UsXHJcbiAgICAgICAgICB0aW1lc3RhbXA6IERhdGUubm93KClcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgXHJcbiAgICAvLyBTYXZlIHVwZGF0ZWQgcXVldWVcclxuICAgIHRoaXMuc2F2ZVF1ZXVlZE9wZXJhdGlvbnMoKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEV4ZWN1dGVzIGEgc3BlY2lmaWMgb3BlcmF0aW9uXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wZXJhdGlvbiBPcGVyYXRpb24gdG8gZXhlY3V0ZVxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgYXN5bmMgZXhlY3V0ZU9wZXJhdGlvbihvcGVyYXRpb24pIHtcclxuICAgIHN3aXRjaCAob3BlcmF0aW9uLnR5cGUpIHtcclxuICAgICAgY2FzZSAnY29udmVyc2lvbic6XHJcbiAgICAgICAgLy8gRXhlY3V0ZSBjb252ZXJzaW9uIG9wZXJhdGlvblxyXG4gICAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGVDb252ZXJzaW9uT3BlcmF0aW9uKG9wZXJhdGlvbik7XHJcbiAgICAgIFxyXG4gICAgICBjYXNlICdhcGktcmVxdWVzdCc6XHJcbiAgICAgICAgLy8gRXhlY3V0ZSBBUEkgcmVxdWVzdCBvcGVyYXRpb25cclxuICAgICAgICByZXR1cm4gdGhpcy5leGVjdXRlQXBpUmVxdWVzdE9wZXJhdGlvbihvcGVyYXRpb24pO1xyXG4gICAgICBcclxuICAgICAgY2FzZSAnc3luYyc6XHJcbiAgICAgICAgLy8gRXhlY3V0ZSBzeW5jIG9wZXJhdGlvblxyXG4gICAgICAgIHJldHVybiB0aGlzLmV4ZWN1dGVTeW5jT3BlcmF0aW9uKG9wZXJhdGlvbik7XHJcbiAgICAgIFxyXG4gICAgICBkZWZhdWx0OlxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5rbm93biBvcGVyYXRpb24gdHlwZTogJHtvcGVyYXRpb24udHlwZX1gKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEV4ZWN1dGVzIGEgY29udmVyc2lvbiBvcGVyYXRpb25cclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3BlcmF0aW9uIENvbnZlcnNpb24gb3BlcmF0aW9uXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBleGVjdXRlQ29udmVyc2lvbk9wZXJhdGlvbihvcGVyYXRpb24pIHtcclxuICAgIC8vIEltcGxlbWVudGF0aW9uIHdpbGwgZGVwZW5kIG9uIHRoZSBjb252ZXJzaW9uIHNlcnZpY2VcclxuICAgIC8vIFRoaXMgaXMgYSBwbGFjZWhvbGRlclxyXG4gICAgY29uc29sZS5sb2coJ0V4ZWN1dGluZyBjb252ZXJzaW9uIG9wZXJhdGlvbjonLCBvcGVyYXRpb24pO1xyXG4gICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRXhlY3V0ZXMgYW4gQVBJIHJlcXVlc3Qgb3BlcmF0aW9uXHJcbiAgICogQHBhcmFtIHtPYmplY3R9IG9wZXJhdGlvbiBBUEkgcmVxdWVzdCBvcGVyYXRpb25cclxuICAgKiBAcHJpdmF0ZVxyXG4gICAqL1xyXG4gIGFzeW5jIGV4ZWN1dGVBcGlSZXF1ZXN0T3BlcmF0aW9uKG9wZXJhdGlvbikge1xyXG4gICAgLy8gSW1wbGVtZW50YXRpb24gd2lsbCBkZXBlbmQgb24gdGhlIEFQSSBjbGllbnRcclxuICAgIC8vIFRoaXMgaXMgYSBwbGFjZWhvbGRlclxyXG4gICAgY29uc29sZS5sb2coJ0V4ZWN1dGluZyBBUEkgcmVxdWVzdCBvcGVyYXRpb246Jywgb3BlcmF0aW9uKTtcclxuICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEV4ZWN1dGVzIGEgc3luYyBvcGVyYXRpb25cclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3BlcmF0aW9uIFN5bmMgb3BlcmF0aW9uXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBhc3luYyBleGVjdXRlU3luY09wZXJhdGlvbihvcGVyYXRpb24pIHtcclxuICAgIC8vIEltcGxlbWVudGF0aW9uIHdpbGwgZGVwZW5kIG9uIHRoZSBzeW5jIHJlcXVpcmVtZW50c1xyXG4gICAgLy8gVGhpcyBpcyBhIHBsYWNlaG9sZGVyXHJcbiAgICBjb25zb2xlLmxvZygnRXhlY3V0aW5nIHN5bmMgb3BlcmF0aW9uOicsIG9wZXJhdGlvbik7XHJcbiAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBRdWV1ZXMgYW4gb3BlcmF0aW9uIGZvciBsYXRlciBleGVjdXRpb24gd2hlbiBvbmxpbmVcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3BlcmF0aW9uIE9wZXJhdGlvbiB0byBxdWV1ZVxyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd9IE9wZXJhdGlvbiBJRFxyXG4gICAqL1xyXG4gIHF1ZXVlT3BlcmF0aW9uKG9wZXJhdGlvbikge1xyXG4gICAgLy8gR2VuZXJhdGUgb3BlcmF0aW9uIElEIGlmIG5vdCBwcm92aWRlZFxyXG4gICAgaWYgKCFvcGVyYXRpb24uaWQpIHtcclxuICAgICAgb3BlcmF0aW9uLmlkID0gYG9wXyR7RGF0ZS5ub3coKX1fJHtNYXRoLnJhbmRvbSgpLnRvU3RyaW5nKDM2KS5zdWJzdHIoMiwgOSl9YDtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gQWRkIHRpbWVzdGFtcCBpZiBub3QgcHJvdmlkZWRcclxuICAgIGlmICghb3BlcmF0aW9uLnRpbWVzdGFtcCkge1xyXG4gICAgICBvcGVyYXRpb24udGltZXN0YW1wID0gRGF0ZS5ub3coKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gQWRkIHRvIHF1ZXVlXHJcbiAgICB0aGlzLm9wZXJhdGlvblF1ZXVlLnB1c2gob3BlcmF0aW9uKTtcclxuICAgIFxyXG4gICAgLy8gU2F2ZSB1cGRhdGVkIHF1ZXVlXHJcbiAgICB0aGlzLnNhdmVRdWV1ZWRPcGVyYXRpb25zKCk7XHJcbiAgICBcclxuICAgIGNvbnNvbGUubG9nKGDinpUgUXVldWVkIG9wZXJhdGlvbjogJHtvcGVyYXRpb24udHlwZX0gKCR7b3BlcmF0aW9uLmlkfSlgKTtcclxuICAgIFxyXG4gICAgcmV0dXJuIG9wZXJhdGlvbi5pZDtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFNhdmVzIHRoZSBvcGVyYXRpb24gcXVldWUgdG8gcGVyc2lzdGVudCBzdG9yYWdlXHJcbiAgICogQHByaXZhdGVcclxuICAgKi9cclxuICBzYXZlUXVldWVkT3BlcmF0aW9ucygpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHRoaXMuc3RvcmUuc2V0KCdvcGVyYXRpb25RdWV1ZScsIHRoaXMub3BlcmF0aW9uUXVldWUpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign4p2MIEZhaWxlZCB0byBzYXZlIHF1ZXVlZCBvcGVyYXRpb25zOicsIGVycm9yKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENhY2hlcyBkYXRhIGZvciBvZmZsaW5lIHVzZVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgQ2FjaGUga2V5XHJcbiAgICogQHBhcmFtIHthbnl9IGRhdGEgRGF0YSB0byBjYWNoZVxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBTdWNjZXNzIHN0YXR1c1xyXG4gICAqL1xyXG4gIGFzeW5jIGNhY2hlRGF0YShrZXksIGRhdGEpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNhY2hlRmlsZSA9IHBhdGguam9pbih0aGlzLmNhY2hlRGlyLCBgJHtrZXl9Lmpzb25gKTtcclxuICAgICAgYXdhaXQgZnMud3JpdGVKc29uKGNhY2hlRmlsZSwge1xyXG4gICAgICAgIGRhdGEsXHJcbiAgICAgICAgdGltZXN0YW1wOiBEYXRlLm5vdygpXHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYOKdjCBGYWlsZWQgdG8gY2FjaGUgZGF0YSBmb3Iga2V5ICR7a2V5fTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJldHJpZXZlcyBjYWNoZWQgZGF0YVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBrZXkgQ2FjaGUga2V5XHJcbiAgICogQHBhcmFtIHtudW1iZXJ9IFttYXhBZ2VdIE1heGltdW0gYWdlIGluIG1pbGxpc2Vjb25kc1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGFueT59IENhY2hlZCBkYXRhIG9yIG51bGwgaWYgbm90IGZvdW5kIG9yIGV4cGlyZWRcclxuICAgKi9cclxuICBhc3luYyBnZXRDYWNoZWREYXRhKGtleSwgbWF4QWdlID0gbnVsbCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgY2FjaGVGaWxlID0gcGF0aC5qb2luKHRoaXMuY2FjaGVEaXIsIGAke2tleX0uanNvbmApO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFhd2FpdCBmcy5wYXRoRXhpc3RzKGNhY2hlRmlsZSkpIHtcclxuICAgICAgICByZXR1cm4gbnVsbDtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc3QgY2FjaGVkID0gYXdhaXQgZnMucmVhZEpzb24oY2FjaGVGaWxlKTtcclxuICAgICAgXHJcbiAgICAgIC8vIENoZWNrIGlmIGNhY2hlIGlzIGV4cGlyZWRcclxuICAgICAgaWYgKG1heEFnZSAmJiBEYXRlLm5vdygpIC0gY2FjaGVkLnRpbWVzdGFtcCA+IG1heEFnZSkge1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gY2FjaGVkLmRhdGE7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIGdldCBjYWNoZWQgZGF0YSBmb3Iga2V5ICR7a2V5fTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogSW52YWxpZGF0ZXMgY2FjaGVkIGRhdGFcclxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IENhY2hlIGtleVxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPGJvb2xlYW4+fSBTdWNjZXNzIHN0YXR1c1xyXG4gICAqL1xyXG4gIGFzeW5jIGludmFsaWRhdGVDYWNoZShrZXkpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGNhY2hlRmlsZSA9IHBhdGguam9pbih0aGlzLmNhY2hlRGlyLCBgJHtrZXl9Lmpzb25gKTtcclxuICAgICAgXHJcbiAgICAgIGlmIChhd2FpdCBmcy5wYXRoRXhpc3RzKGNhY2hlRmlsZSkpIHtcclxuICAgICAgICBhd2FpdCBmcy5yZW1vdmUoY2FjaGVGaWxlKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGDinYwgRmFpbGVkIHRvIGludmFsaWRhdGUgY2FjaGUgZm9yIGtleSAke2tleX06YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDbGVhcnMgYWxsIGNhY2hlZCBkYXRhXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8Ym9vbGVhbj59IFN1Y2Nlc3Mgc3RhdHVzXHJcbiAgICovXHJcbiAgYXN5bmMgY2xlYXJDYWNoZSgpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGF3YWl0IGZzLmVtcHR5RGlyKHRoaXMuY2FjaGVEaXIpO1xyXG4gICAgICByZXR1cm4gdHJ1ZTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ+KdjCBGYWlsZWQgdG8gY2xlYXIgY2FjaGU6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZXRzIHRoZSBjdXJyZW50IG9ubGluZSBzdGF0dXNcclxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gV2hldGhlciB0aGUgc3lzdGVtIGlzIG9ubGluZVxyXG4gICAqL1xyXG4gIGdldE9ubGluZVN0YXR1cygpIHtcclxuICAgIHJldHVybiB0aGlzLmlzT25saW5lO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0cyB0aGUgY3VycmVudCBBUEkgc3RhdHVzXHJcbiAgICogQHJldHVybnMge09iamVjdH0gQVBJIHN0YXR1cyBvYmplY3RcclxuICAgKi9cclxuICBnZXRBcGlTdGF0dXMoKSB7XHJcbiAgICByZXR1cm4gdGhpcy5hcGlTdGF0dXMgfHwge307XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZXRzIHRoZSBjdXJyZW50IG9wZXJhdGlvbiBxdWV1ZVxyXG4gICAqIEByZXR1cm5zIHtBcnJheX0gUXVldWVkIG9wZXJhdGlvbnNcclxuICAgKi9cclxuICBnZXRRdWV1ZWRPcGVyYXRpb25zKCkge1xyXG4gICAgcmV0dXJuIFsuLi50aGlzLm9wZXJhdGlvblF1ZXVlXTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEFkZHMgYSBsaXN0ZW5lciBmb3Igb2ZmbGluZSBldmVudHNcclxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBsaXN0ZW5lciBFdmVudCBsaXN0ZW5lciBmdW5jdGlvblxyXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBTdWNjZXNzIHN0YXR1c1xyXG4gICAqL1xyXG4gIGFkZExpc3RlbmVyKGxpc3RlbmVyKSB7XHJcbiAgICBpZiAodHlwZW9mIGxpc3RlbmVyICE9PSAnZnVuY3Rpb24nKSB7XHJcbiAgICAgIHJldHVybiBmYWxzZTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgdGhpcy5saXN0ZW5lcnMuYWRkKGxpc3RlbmVyKTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUmVtb3ZlcyBhIGxpc3RlbmVyXHJcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gbGlzdGVuZXIgRXZlbnQgbGlzdGVuZXIgZnVuY3Rpb25cclxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gU3VjY2VzcyBzdGF0dXNcclxuICAgKi9cclxuICByZW1vdmVMaXN0ZW5lcihsaXN0ZW5lcikge1xyXG4gICAgcmV0dXJuIHRoaXMubGlzdGVuZXJzLmRlbGV0ZShsaXN0ZW5lcik7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBOb3RpZmllcyBhbGwgbGlzdGVuZXJzIG9mIGFuIGV2ZW50XHJcbiAgICogQHBhcmFtIHtPYmplY3R9IGV2ZW50IEV2ZW50IG9iamVjdFxyXG4gICAqIEBwcml2YXRlXHJcbiAgICovXHJcbiAgbm90aWZ5TGlzdGVuZXJzKGV2ZW50KSB7XHJcbiAgICB0aGlzLmxpc3RlbmVycy5mb3JFYWNoKGxpc3RlbmVyID0+IHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBsaXN0ZW5lcihldmVudCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign4p2MIEVycm9yIGluIG9mZmxpbmUgZXZlbnQgbGlzdGVuZXI6JywgZXJyb3IpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENsZWFucyB1cCByZXNvdXJjZXNcclxuICAgKi9cclxuICBjbGVhbnVwKCkge1xyXG4gICAgLy8gQ2xlYXIgaW50ZXJ2YWxzXHJcbiAgICBpZiAodGhpcy5uZXR3b3JrQ2hlY2tJbnRlcnZhbCkge1xyXG4gICAgICBjbGVhckludGVydmFsKHRoaXMubmV0d29ya0NoZWNrSW50ZXJ2YWwpO1xyXG4gICAgfVxyXG4gICAgXHJcbiAgICBpZiAodGhpcy5hcGlDaGVja0ludGVydmFsKSB7XHJcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5hcGlDaGVja0ludGVydmFsKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgLy8gQ2xlYXIgbGlzdGVuZXJzXHJcbiAgICB0aGlzLmxpc3RlbmVycy5jbGVhcigpO1xyXG4gICAgXHJcbiAgICAvLyBTYXZlIGFueSBwZW5kaW5nIG9wZXJhdGlvbnNcclxuICAgIHRoaXMuc2F2ZVF1ZXVlZE9wZXJhdGlvbnMoKTtcclxuICAgIFxyXG4gICAgY29uc29sZS5sb2coJ/Cfp7kgT2ZmbGluZSBzZXJ2aWNlIGNsZWFuZWQgdXAnKTtcclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gbmV3IE9mZmxpbmVTZXJ2aWNlKCk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNO0VBQUVFO0FBQUksQ0FBQyxHQUFHRixPQUFPLENBQUMsVUFBVSxDQUFDO0FBQ25DLE1BQU07RUFBRUc7QUFBWSxDQUFDLEdBQUdILE9BQU8sQ0FBQyx1QkFBdUIsQ0FBQztBQUN4RCxNQUFNO0VBQUVJLFFBQVEsRUFBRUM7QUFBa0IsQ0FBQyxHQUFHTCxPQUFPLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDOztBQUV4RSxNQUFNTSxjQUFjLENBQUM7RUFDbkJDLFdBQVdBLENBQUEsRUFBRztJQUNaLElBQUksQ0FBQ0MsVUFBVSxHQUFHSCxpQkFBaUIsQ0FBQyxDQUFDO0lBQ3JDLElBQUksQ0FBQ0ksUUFBUSxHQUFHVixJQUFJLENBQUNXLElBQUksQ0FBQ1IsR0FBRyxDQUFDUyxPQUFPLENBQUMsVUFBVSxDQUFDLEVBQUUsT0FBTyxDQUFDO0lBQzNELElBQUksQ0FBQ0MsY0FBYyxHQUFHLEVBQUU7SUFDeEIsSUFBSSxDQUFDQyxRQUFRLEdBQUcsSUFBSTtJQUNwQixJQUFJLENBQUNDLFNBQVMsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FB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