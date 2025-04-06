/**
 * File Watcher IPC Handlers
 * Implements handlers for file watching operations.
 * 
 * These handlers expose the FileWatcherService functionality to the
 * renderer process through secure IPC channels. They manage file watching,
 * lock management, and event notifications.
 * 
 * Related files:
 * - services/FileWatcherService.js: Core file watching functionality
 * - ipc/types.js: TypeScript definitions
 */

const { ipcMain, BrowserWindow } = require('electron');
const { IPCChannels } = require('../../types');
const FileWatcherService = require('../../../services/FileWatcherService');

// Store event listeners by window ID
const windowListeners = new Map();

/**
 * Registers all file watcher IPC handlers
 */
function registerFileWatcherHandlers() {
  // Start watching files/directories
  ipcMain.handle(IPCChannels.WATCH_START, async (event, request) => {
    if (!request?.paths) {
      return { 
        success: false, 
        error: 'Invalid request: paths is required' 
      };
    }

    const result = await FileWatcherService.watch(
      request.paths, 
      request.options || {}
    );

    // Set up event forwarding for this window if successful
    if (result.success) {
      setupEventForwarding(event.sender, result.watchId);
    }

    return result;
  });

  // Stop watching files/directories
  ipcMain.handle(IPCChannels.WATCH_STOP, async (event, request) => {
    if (!request?.watchId) {
      return { 
        success: false, 
        error: 'Invalid request: watchId is required' 
      };
    }

    const result = await FileWatcherService.unwatch(request.watchId);
    
    // Remove event forwarding for this window if successful
    if (result.success) {
      removeEventForwarding(event.sender, request.watchId);
    }

    return result;
  });

  // Acquire a file lock
  ipcMain.handle('codex:watch:lock', async (event, request) => {
    if (!request?.path) {
      return { 
        success: false, 
        error: 'Invalid request: path is required' 
      };
    }

    return await FileWatcherService.acquireLock(
      request.path, 
      request.options || {}
    );
  });

  // Release a file lock
  ipcMain.handle('codex:watch:unlock', async (event, request) => {
    if (!request?.path) {
      return { 
        success: false, 
        error: 'Invalid request: path is required' 
      };
    }

    return await FileWatcherService.releaseLock(request.path);
  });

  // Check if a file is locked
  ipcMain.handle('codex:watch:is-locked', async (event, request) => {
    if (!request?.path) {
      return { 
        success: false, 
        error: 'Invalid request: path is required' 
      };
    }

    return await FileWatcherService.isLocked(request.path);
  });
}

/**
 * Set up event forwarding from FileWatcherService to a renderer window
 * @private
 * @param {Electron.WebContents} sender - Renderer web contents
 * @param {string} watchId - Watch ID
 */
function setupEventForwarding(sender, watchId) {
  const windowId = getWindowIdFromSender(sender);
  if (!windowId) return;

  // Create a listener for this window if it doesn't exist
  if (!windowListeners.has(windowId)) {
    windowListeners.set(windowId, new Map());
  }

  // Don't add duplicate listeners
  const windowWatchers = windowListeners.get(windowId);
  if (windowWatchers.has(watchId)) return;

  // Create event listener
  const listener = (eventData) => {
    if (sender.isDestroyed()) {
      // Clean up if window is destroyed
      removeEventForwarding(sender, watchId);
      return;
    }

    // Forward event to renderer
    sender.send(IPCChannels.WATCH_EVENT, eventData);
  };

  // Store listener reference
  windowWatchers.set(watchId, listener);

  // Add listener to service
  FileWatcherService.addListener(listener);
}

/**
 * Remove event forwarding for a renderer window
 * @private
 * @param {Electron.WebContents} sender - Renderer web contents
 * @param {string} watchId - Watch ID
 */
function removeEventForwarding(sender, watchId) {
  const windowId = getWindowIdFromSender(sender);
  if (!windowId) return;

  // Check if we have listeners for this window
  if (!windowListeners.has(windowId)) return;

  const windowWatchers = windowListeners.get(windowId);
  
  // Check if we have a listener for this watch ID
  if (!windowWatchers.has(watchId)) return;

  // Get listener
  const listener = windowWatchers.get(watchId);

  // Remove listener from service
  FileWatcherService.removeListener(listener);

  // Remove listener reference
  windowWatchers.delete(watchId);

  // Clean up window entry if no more watchers
  if (windowWatchers.size === 0) {
    windowListeners.delete(windowId);
  }
}

/**
 * Get window ID from sender
 * @private
 * @param {Electron.WebContents} sender - Renderer web contents
 * @returns {number|null} Window ID or null if not found
 */
function getWindowIdFromSender(sender) {
  const allWindows = BrowserWindow.getAllWindows();
  for (const window of allWindows) {
    if (window.webContents === sender) {
      return window.id;
    }
  }
  return null;
}

/**
 * Clean up all watchers when app is quitting
 */
function cleanupFileWatchers() {
  return FileWatcherService.cleanup();
}

module.exports = {
  registerFileWatcherHandlers,
  cleanupFileWatchers
};
