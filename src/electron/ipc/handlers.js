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
 * Setup all IPC handlers for the main process
 * @param {Electron.App} app The Electron app instance 
 * @param {Electron.BrowserWindow} mainWindow The main application window
 */
function setupIPCHandlers(app, mainWindow) {
  // Register handlers
  registerFileSystemHandlers();
  registerConversionHandlers();
  registerFileWatcherHandlers();
  registerOfflineHandlers();
  registerApiKeyHandlers();
  registerTranscriptionHandlers();
  registerSettingsHandlers();
  
  // Clean up resources on app quit
  app.on('will-quit', async () => {
    await cleanupFileWatchers();
    await cleanupOfflineHandlers();
    await cleanupApiKeyHandlers();
    await cleanupTranscriptionHandlers();
    await cleanupFileSystemHandlers();
  });

  // Settings Management is now handled in handlers/settings.js

  // Application
  ipcMain.handle('mdcode:get-version', () => {
    return app.getVersion();
  });

  ipcMain.handle('mdcode:check-updates', async () => {
    // Will be implemented in phase 4 with auto-updater
    throw new Error('Not implemented yet');
  });

  // System Integration
  ipcMain.handle('mdcode:show-item-in-folder', (event, filePath) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('mdcode:open-external', (event, url) => {
    return shell.openExternal(url);
  });

  // File Drop Event Handling
  mainWindow.webContents.on('will-navigate', (event, url) => {
    // Prevent navigation events, handle dropped files instead
    event.preventDefault();
  });

  mainWindow.webContents.on('drop', (event, files) => {
    event.preventDefault();
    mainWindow.webContents.send('mdcode:file-dropped', files);
  });
}

module.exports = { setupIPCHandlers };
