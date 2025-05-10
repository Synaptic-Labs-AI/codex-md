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
 * Update environment variables with latest API keys
 * This ensures converters have access to the latest API keys
 */
function updateApiKeyEnvironment(provider, key) {
  try {
    // Map provider to environment variable name
    const envMap = {
      'mistral': 'MISTRAL_API_KEY',
      'deepgram': 'DEEPGRAM_API_KEY',
      'openai': 'OPENAI_API_KEY'
    };

    const envVar = envMap[provider];
    if (!envVar) return;

    // Update environment variable
    if (key) {
      process.env[envVar] = key;
      console.log(`✅ Updated ${envVar} environment variable`);
    } else {
      delete process.env[envVar];
      console.log(`❌ Removed ${envVar} environment variable`);
    }
  } catch (error) {
    console.error(`Error updating API key environment for ${provider}:`, error);
  }
}

/**
 * Register all API key related IPC handlers
 */
function registerApiKeyHandlers() {
  // Save API key
  ipcMain.handle('codex:apikey:save', async (event, { key, provider = 'openai' }) => {
    const result = await apiKeyService.saveApiKey(key, provider);

    // Update environment variable with the new key
    if (result.success) {
      updateApiKeyEnvironment(provider, key);
    }

    return result;
  });

  // Check if API key exists
  ipcMain.handle('codex:apikey:exists', async (event, { provider = 'openai' }) => {
    return { exists: apiKeyService.hasApiKey(provider) };
  });

  // Delete API key
  ipcMain.handle('codex:apikey:delete', async (event, { provider = 'openai' }) => {
    const result = apiKeyService.deleteApiKey(provider);

    // Remove environment variable when key is deleted
    if (result.success) {
      updateApiKeyEnvironment(provider, null);
    }

    return result;
  });

  // Validate API key
  ipcMain.handle('codex:apikey:validate', async (event, { key, provider = 'openai' }) => {
    return await apiKeyService.validateApiKey(key, provider);
  });

  // Get API key for internal use (only available to main process)
  ipcMain.handle('codex:apikey:get-for-service', async (event, { provider = 'openai' }) => {
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
