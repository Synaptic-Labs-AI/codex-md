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
// Import the singleton instance by destructuring the exported object
const { instance: openAIProxyServiceInstance } = require('../../services/ai/OpenAIProxyService'); 

/**
 * Register all API key related IPC handlers
 */
function registerApiKeyHandlers() {
  // Save API key
  ipcMain.handle('codex:apikey:save', async (event, { key, provider = 'openai' }) => {
    const saveResult = await apiKeyService.saveApiKey(key, provider);

    // If saving was successful and it's the OpenAI key, configure the proxy service
    if (saveResult.success && provider === 'openai') {
      console.log('[ApiKeyHandler] OpenAI key saved, attempting to configure OpenAIProxyService...');
      try {
        // Use the instance to call handleConfigure
        const configureResult = await openAIProxyServiceInstance.handleConfigure(null, { apiKey: key });
        if (configureResult.success) {
          console.log('[ApiKeyHandler] OpenAIProxyService configured successfully.');
        } else {
          console.warn('[ApiKeyHandler] OpenAIProxyService configuration failed after saving key.');
          // Optionally return a modified result indicating configuration failure
          // return { ...saveResult, configured: false, configError: 'Configuration failed' };
        }
      } catch (configError) {
        console.error('[ApiKeyHandler] Error configuring OpenAIProxyService:', configError);
        // Optionally return a modified result indicating configuration error
        // return { ...saveResult, configured: false, configError: configError.message };
      }
    }

    return saveResult;
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
