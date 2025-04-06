/**
 * Offline IPC Handlers
 * Implements handlers for offline functionality in the Electron application.
 * 
 * These handlers provide the renderer process with access to offline capabilities
 * such as caching, operation queueing, and network status monitoring.
 * 
 * Related files:
 * - services/OfflineService.js: Core offline functionality
 * - ipc/handlers.js: IPC handler registration
 * - preload.js: API exposure to renderer
 */

const { ipcMain } = require('electron');
const OfflineService = require('../../../services/OfflineService');

/**
 * Registers all offline-related IPC handlers
 */
function registerOfflineHandlers() {
  // Get offline status
  ipcMain.handle('codex:offline:status', async () => {
    return {
      online: OfflineService.getOnlineStatus(),
      apiStatus: OfflineService.getApiStatus()
    };
  });

  // Get queued operations
  ipcMain.handle('codex:offline:queued-operations', async () => {
    return OfflineService.getQueuedOperations();
  });

  // Queue an operation
  ipcMain.handle('codex:offline:queue-operation', async (event, operation) => {
    try {
      const operationId = OfflineService.queueOperation(operation);
      return {
        success: true,
        operationId
      };
    } catch (error) {
      console.error('Failed to queue operation:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Cache data
  ipcMain.handle('codex:offline:cache-data', async (event, { key, data }) => {
    try {
      const success = await OfflineService.cacheData(key, data);
      return { success };
    } catch (error) {
      console.error('Failed to cache data:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Get cached data
  ipcMain.handle('codex:offline:get-cached-data', async (event, { key, maxAge }) => {
    try {
      const data = await OfflineService.getCachedData(key, maxAge);
      return {
        success: true,
        data
      };
    } catch (error) {
      console.error('Failed to get cached data:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Invalidate cache
  ipcMain.handle('codex:offline:invalidate-cache', async (event, { key }) => {
    try {
      const success = await OfflineService.invalidateCache(key);
      return { success };
    } catch (error) {
      console.error('Failed to invalidate cache:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Clear cache
  ipcMain.handle('codex:offline:clear-cache', async () => {
    try {
      const success = await OfflineService.clearCache();
      return { success };
    } catch (error) {
      console.error('Failed to clear cache:', error);
      return {
        success: false,
        error: error.message
      };
    }
  });

  // Set up event forwarding from OfflineService to renderer
  OfflineService.addListener((event) => {
    // Forward events to any renderer that might be listening
    const windows = require('electron').BrowserWindow.getAllWindows();
    for (const window of windows) {
      if (!window.isDestroyed()) {
        window.webContents.send('codex:offline:event', event);
      }
    }
  });

  console.log('📡 Registered offline IPC handlers');
}

/**
 * Cleans up offline handlers and resources
 */
function cleanupOfflineHandlers() {
  // Clean up the OfflineService
  OfflineService.cleanup();
}

module.exports = {
  registerOfflineHandlers,
  cleanupOfflineHandlers
};
