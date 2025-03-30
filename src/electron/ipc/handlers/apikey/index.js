/**
 * API Key IPC Handlers
 * Implements handlers for API key management operations.
 * 
 * Related files:
 * - services/ApiKeyService.js: API key storage and validation
 * - ipc/handlers.js: Handler registration
 * - preload.js: API exposure to renderer
 */

const { ipcMain } = require('electron');
const apiKeyService = require('../../../services/ApiKeyService');
const { IPCChannels } = require('../../types');

/**
 * Register all API key related IPC handlers
 */
function registerApiKeyHandlers() {
  // Save API key
  ipcMain.handle('mdcode:apikey:save', async (event, { key, provider = 'openai' }) => {
    return await apiKeyService.saveApiKey(key, provider);
  });

  // Check if API key exists
  ipcMain.handle('mdcode:apikey:exists', async (event, { provider = 'openai' }) => {
    return { exists: apiKeyService.hasApiKey(provider) };
  });

  // Delete API key
  ipcMain.handle('mdcode:apikey:delete', async (event, { provider = 'openai' }) => {
    return apiKeyService.deleteApiKey(provider);
  });

  // Validate API key
  ipcMain.handle('mdcode:apikey:validate', async (event, { key, provider = 'openai' }) => {
    return await apiKeyService.validateApiKey(key, provider);
  });

  // Get API key for internal use (only available to main process)
  ipcMain.handle('mdcode:apikey:get-for-service', async (event, { provider = 'openai' }) => {
    // Security check: only allow main process to access this
    const webContents = event.sender;
    if (webContents.getType() !== 'browserWindow') {
      return { success: false, error: 'Unauthorized access' };
    }

    const key = apiKeyService.getApiKey(provider);
    return { success: !!key, key };
  });

  console.log('API Key IPC handlers registered');
}

/**
 * Clean up any resources when the app is shutting down
 */
async function cleanupApiKeyHandlers() {
  // No cleanup needed for API key handlers
}

module.exports = {
  registerApiKeyHandlers,
  cleanupApiKeyHandlers
};
