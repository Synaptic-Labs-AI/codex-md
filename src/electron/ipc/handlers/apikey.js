/**
 * API Key IPC Handlers
 * Implements handlers for API key management operations.
 * 
 * Related files:
 * - services/ApiKeyService.js: Core API key management functionality
 * - preload.js: API exposure to renderer
 */

const { ipcMain } = require('electron');
const apiKeyService = require('../../services/ApiKeyService');

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
    return await apiKeyService.deleteApiKey(provider);
  });

  // Validate API key
  ipcMain.handle('mdcode:apikey:validate', async (event, { key, provider = 'openai' }) => {
    return await apiKeyService.validateApiKey(key, provider);
  });

  // Get API key
  ipcMain.handle('mdcode:apikey:get', async (event, { provider = 'openai' }) => {
    const key = apiKeyService.getApiKey(provider);
    if (!key) {
      return { success: false, error: 'API key not found' };
    }
    return { success: true, key };
  });
}

/**
 * Clean up API key handlers and resources
 */
async function cleanupApiKeyHandlers() {
  // Remove all handlers
  ipcMain.removeHandler('mdcode:apikey:save');
  ipcMain.removeHandler('mdcode:apikey:exists');
  ipcMain.removeHandler('mdcode:apikey:delete');
  ipcMain.removeHandler('mdcode:apikey:validate');
  ipcMain.removeHandler('mdcode:apikey:get');
}

module.exports = {
  registerApiKeyHandlers,
  cleanupApiKeyHandlers
};
