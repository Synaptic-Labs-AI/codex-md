/**
 * API Key Service
 * Provides secure storage and management of API keys using machine-specific encryption.
 * 
 * Related files:
 * - main.js: Main process setup with encryption key
 * - ipc/handlers/apikey/index.js: IPC handlers for API key operations
 * - preload.js: API exposure to renderer
 */

const { createStore } = require('../utils/storeFactory');

class ApiKeyService {
  constructor() {
    // Initialize store with encryption key from environment and error handling
    this.store = createStore('api-keys', {
      encryptionKey: process.env.STORE_ENCRYPTION_KEY
    });
  }

  /**
   * Save an API key securely
   * @param {string} key - The API key to save
   * @param {string} provider - The API provider (e.g., 'mistral', 'deepgram')
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async saveApiKey(key, provider = 'mistral') {
    try {
      // Store the key without validation
      this.store.set(`${provider}-api-key`, key);
      return { success: true };
    } catch (error) {
      console.error(`Error saving ${provider} API key:`, error);
      return { 
        success: false, 
        error: error.message || `Failed to save ${provider} API key` 
      };
    }
  }

  /**
   * Get an API key
   * @param {string} provider - The API provider (e.g., 'mistral', 'deepgram')
   * @returns {string|null} The API key or null if not found
   */
  getApiKey(provider = 'mistral') {
    // For deepgram, also check the transcription settings store
    if (provider === 'deepgram') {
      const transcriptionStore = createStore('transcription-settings');

      // First check our key store
      const key = this.store.get(`${provider}-api-key`, null);
      if (key) return key;

      // Then try all the possible legacy locations
      try {
        // Legacy format was to store it in settings.transcription.deepgramApiKey
        return transcriptionStore.get('transcription.deepgramApiKey') ||
               transcriptionStore.get('deepgramApiKey') ||
               null;
      } catch (error) {
        console.warn('[ApiKeyService] Error accessing transcription store:', error);
        return null;
      }
    }

    return this.store.get(`${provider}-api-key`, null);
  }

  /**
   * Check if an API key exists
   * @param {string} provider - The API provider (e.g., 'mistral', 'deepgram')
   * @returns {boolean} True if the API key exists
   */
  hasApiKey(provider = 'mistral') {
    return !!this.getApiKey(provider);
  }

  /**
   * Delete an API key
   * @param {string} provider - The API provider (e.g., 'mistral', 'deepgram')
   * @returns {{success: boolean, error?: string}}
   */
  deleteApiKey(provider = 'mistral') {
    try {
      this.store.delete(`${provider}-api-key`);
      return { success: true };
    } catch (error) {
      console.error(`Error deleting ${provider} API key:`, error);
      return { 
        success: false, 
        error: error.message || `Failed to delete ${provider} API key` 
      };
    }
  }

  /**
   * Validate an API key format
   * @param {string} key - The API key to validate
   * @param {string} provider - The API provider (e.g., 'mistral', 'deepgram')
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async validateApiKey(key, provider = 'mistral') {
    try {
      if (!key || typeof key !== 'string' || key.trim() === '') {
        return { 
          success: false, 
          error: `${provider} API key cannot be empty` 
        };
      }

      // Basic format validation based on provider
      if (provider === 'mistral') {
        // Mistral keys are typically long strings
        if (key.length < 20) {
          return { 
            success: false, 
            error: 'Invalid Mistral API key format. Key appears too short' 
          };
        }
      }

      // Note: For a more thorough validation, you would make a test API call
      // to verify the key works, but that's beyond the scope of this basic validation

      return { success: true };
    } catch (error) {
      console.error(`Error validating ${provider} API key:`, error);
      return { 
        success: false, 
        error: error.message || `Failed to validate ${provider} API key` 
      };
    }
  }
}

module.exports = new ApiKeyService();
