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
  ipcMain.handle('codex:apikey:save', async (event, { key, provider = 'openai' }) => {
    return await apiKeyService.saveApiKey(key, provider);
  });

  // Check if API key exists
  ipcMain.handle('codex:apikey:exists', async (event, { provider = 'openai' }) => {
    return { exists: apiKeyService.hasApiKey(provider) };
  });

  // Delete API key
  ipcMain.handle('codex:apikey:delete', async (event, { provider = 'openai' }) => {
    return await apiKeyService.deleteApiKey(provider);
  });

  // Validate API key
  ipcMain.handle('codex:apikey:validate', async (event, { key, provider = 'openai' }) => {
    return await apiKeyService.validateApiKey(key, provider);
  });

  // Get API key
  ipcMain.handle('codex:apikey:get', async (event, { provider = 'openai' }) => {
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
  ipcMain.removeHandler('codex:apikey:save');
  ipcMain.removeHandler('codex:apikey:exists');
  ipcMain.removeHandler('codex:apikey:delete');
  ipcMain.removeHandler('codex:apikey:validate');
  ipcMain.removeHandler('codex:apikey:get');
}

module.exports = {
  registerApiKeyHandlers,
  cleanupApiKeyHandlers
};
