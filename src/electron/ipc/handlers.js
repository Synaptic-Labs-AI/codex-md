/**
 * IPC Main Process Handlers
 * Implements handlers for all IPC channels exposed through preload.js
 * 
 * Related files:
 * - main.js: Main process setup
 * - preload.js: API exposure to renderer
 * - types.js: TypeScript definitions
 */

const { shell, ipcMain, app } = require('electron');
const { createStore } = require('../utils/storeFactory');
const { registerFileSystemHandlers, cleanupFileSystemHandlers } = require('./handlers/filesystem');
const { registerConversionHandlers } = require('./handlers/conversion');
const { registerFileWatcherHandlers, cleanupFileWatchers } = require('./handlers/filewatcher');
const { registerOfflineHandlers, cleanupOfflineHandlers } = require('./handlers/offline');
const { registerApiKeyHandlers, cleanupApiKeyHandlers } = require('./handlers/apikey');
const { registerTranscriptionHandlers, cleanupTranscriptionHandlers } = require('./handlers/transcription');
const { registerHandlers: registerSettingsHandlers } = require('./handlers/settings');

// Initialize encrypted store with error handling
const store = createStore('ipc-handlers', {
  encryptionKey: process.env.STORE_ENCRYPTION_KEY
});

/**
 * Setup basic IPC handlers that don't require window access
 * @param {Electron.App} app The Electron app instance
 */
function setupBasicHandlers(app) {
  // Register handlers
  registerFileSystemHandlers();
  registerApiKeyHandlers();
  registerSettingsHandlers();
  registerOfflineHandlers();
  registerTranscriptionHandlers();
  
  // Clean up resources on app quit
  app.on('will-quit', async () => {
    await cleanupFileWatchers();
    await cleanupOfflineHandlers();
    await cleanupApiKeyHandlers();
    await cleanupTranscriptionHandlers();
    await cleanupFileSystemHandlers();
  });

  // Application
  ipcMain.handle('codex:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('codex:check-updates', async () => {
    // Will be implemented in phase 4 with auto-updater
    throw new Error('Not implemented yet');
  });

  // System Integration
  ipcMain.handle('codex:show-item-in-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('codex:open-external', (event, url) => {
    return shell.openExternal(url);
  });
}

// Store references to cleanup functions for window-specific handlers
let currentWindowHandlers = new Map();

/**
 * Setup handlers that require window access
 * @param {Electron.BrowserWindow} mainWindow The main application window
 */
function setupWindowHandlers(mainWindow) {
  if (!mainWindow?.webContents) {
    throw new Error('Window not initialized for handler setup');
  }

  // Clean up any existing window handlers
  cleanupWindowHandlers();

  // Register conversion handlers that need window access
  const conversionCleanup = registerConversionHandlers();
  const watcherCleanup = registerFileWatcherHandlers();
  
  // Store cleanup functions
  if (conversionCleanup) currentWindowHandlers.set('conversion', conversionCleanup);
  if (watcherCleanup) currentWindowHandlers.set('watcher', watcherCleanup);

  // File Drop Event Handling
  const navigateHandler = (event, url) => {
    event.preventDefault();
  };
  
  const dropHandler = (event, files) => {
    event.preventDefault();
    mainWindow.webContents.send('codex:file-dropped', files);
  };

  mainWindow.webContents.on('will-navigate', navigateHandler);
  mainWindow.webContents.on('drop', dropHandler);

  // Store cleanup functions for event listeners
  currentWindowHandlers.set('events', () => {
    mainWindow.webContents.removeListener('will-navigate', navigateHandler);
    mainWindow.webContents.removeListener('drop', dropHandler);
  });

  // Add window-closed cleanup
  mainWindow.once('closed', () => {
    cleanupWindowHandlers();
  });
}

/**
 * Clean up window-specific handlers
 */
function cleanupWindowHandlers() {
  for (const cleanup of currentWindowHandlers.values()) {
    if (typeof cleanup === 'function') {
      try {
        cleanup();
      } catch (error) {
        console.error('Error during window handler cleanup:', error);
      }
    }
  }
  currentWindowHandlers.clear();
}

module.exports = {
  setupBasicHandlers,
  setupWindowHandlers,
  cleanupWindowHandlers
};
