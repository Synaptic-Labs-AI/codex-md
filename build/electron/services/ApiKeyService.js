"use strict";

/**
 * API Key Service
 * Provides secure storage and management of API keys using machine-specific encryption.
 * 
 * Related files:
 * - main.js: Main process setup with encryption key
 * - ipc/handlers/apikey/index.js: IPC handlers for API key operations
 * - preload.js: API exposure to renderer
 */

const {
  createStore
} = require('../utils/storeFactory');
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
   * @param {string} provider - The API provider (e.g., 'openai', 'mistral')
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async saveApiKey(key, provider = 'openai') {
    try {
      // Store the key without validation
      this.store.set(`${provider}-api-key`, key);
      return {
        success: true
      };
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
   * @param {string} provider - The API provider (e.g., 'openai', 'mistral', 'deepgram')
   * @returns {string|null} The API key or null if not found
   */
  getApiKey(provider = 'openai') {
    // For deepgram, also check the transcription settings store
    if (provider === 'deepgram') {
      const transcriptionStore = createStore('transcription-settings');

      // First check our key store
      const key = this.store.get(`${provider}-api-key`, null);
      if (key) return key;

      // Then try all the possible legacy locations
      try {
        // Legacy format was to store it in settings.transcription.deepgramApiKey
        return transcriptionStore.get('transcription.deepgramApiKey') || transcriptionStore.get('deepgramApiKey') || null;
      } catch (error) {
        console.warn('[ApiKeyService] Error accessing transcription store:', error);
        return null;
      }
    }
    return this.store.get(`${provider}-api-key`, null);
  }

  /**
   * Check if an API key exists
   * @param {string} provider - The API provider (e.g., 'openai', 'mistral')
   * @returns {boolean} True if the API key exists
   */
  hasApiKey(provider = 'openai') {
    return !!this.getApiKey(provider);
  }

  /**
   * Delete an API key
   * @param {string} provider - The API provider (e.g., 'openai', 'mistral')
   * @returns {{success: boolean, error?: string}}
   */
  deleteApiKey(provider = 'openai') {
    try {
      this.store.delete(`${provider}-api-key`);
      return {
        success: true
      };
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
   * @param {string} provider - The API provider (e.g., 'openai', 'mistral')
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async validateApiKey(key, provider = 'openai') {
    try {
      if (!key || typeof key !== 'string' || key.trim() === '') {
        return {
          success: false,
          error: `${provider} API key cannot be empty`
        };
      }

      // Basic format validation based on provider
      if (provider === 'openai') {
        // OpenAI keys typically start with "sk-" and are 51 characters long
        if (!key.startsWith('sk-') || key.length < 20) {
          return {
            success: false,
            error: 'Invalid OpenAI API key format. Keys should start with "sk-"'
          };
        }
      } else if (provider === 'mistral') {
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

      return {
        success: true
      };
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmVhdGVTdG9yZSIsInJlcXVpcmUiLCJBcGlLZXlTZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJzdG9yZSIsImVuY3J5cHRpb25LZXkiLCJwcm9jZXNzIiwiZW52IiwiU1RPUkVfRU5DUllQVElPTl9LRVkiLCJzYXZlQXBpS2V5Iiwia2V5IiwicHJvdmlkZXIiLCJzZXQiLCJzdWNjZXNzIiwiZXJyb3IiLCJjb25zb2xlIiwibWVzc2FnZSIsImdldEFwaUtleSIsInRyYW5zY3JpcHRpb25TdG9yZSIsImdldCIsIndhcm4iLCJoYXNBcGlLZXkiLCJkZWxldGVBcGlLZXkiLCJkZWxldGUiLCJ2YWxpZGF0ZUFwaUtleSIsInRyaW0iLCJzdGFydHNXaXRoIiwibGVuZ3RoIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9BcGlLZXlTZXJ2aWNlLmpzIl0sInNvdXJjZXNDb250ZW50IjpbIi8qKlxyXG4gKiBBUEkgS2V5IFNlcnZpY2VcclxuICogUHJvdmlkZXMgc2VjdXJlIHN0b3JhZ2UgYW5kIG1hbmFnZW1lbnQgb2YgQVBJIGtleXMgdXNpbmcgbWFjaGluZS1zcGVjaWZpYyBlbmNyeXB0aW9uLlxyXG4gKiBcclxuICogUmVsYXRlZCBmaWxlczpcclxuICogLSBtYWluLmpzOiBNYWluIHByb2Nlc3Mgc2V0dXAgd2l0aCBlbmNyeXB0aW9uIGtleVxyXG4gKiAtIGlwYy9oYW5kbGVycy9hcGlrZXkvaW5kZXguanM6IElQQyBoYW5kbGVycyBmb3IgQVBJIGtleSBvcGVyYXRpb25zXHJcbiAqIC0gcHJlbG9hZC5qczogQVBJIGV4cG9zdXJlIHRvIHJlbmRlcmVyXHJcbiAqL1xyXG5cclxuY29uc3QgeyBjcmVhdGVTdG9yZSB9ID0gcmVxdWlyZSgnLi4vdXRpbHMvc3RvcmVGYWN0b3J5Jyk7XHJcblxyXG5jbGFzcyBBcGlLZXlTZXJ2aWNlIHtcclxuICBjb25zdHJ1Y3RvcigpIHtcclxuICAgIC8vIEluaXRpYWxpemUgc3RvcmUgd2l0aCBlbmNyeXB0aW9uIGtleSBmcm9tIGVudmlyb25tZW50IGFuZCBlcnJvciBoYW5kbGluZ1xyXG4gICAgdGhpcy5zdG9yZSA9IGNyZWF0ZVN0b3JlKCdhcGkta2V5cycsIHtcclxuICAgICAgZW5jcnlwdGlvbktleTogcHJvY2Vzcy5lbnYuU1RPUkVfRU5DUllQVElPTl9LRVlcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2F2ZSBhbiBBUEkga2V5IHNlY3VyZWx5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIFRoZSBBUEkga2V5IHRvIHNhdmVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvdmlkZXIgLSBUaGUgQVBJIHByb3ZpZGVyIChlLmcuLCAnb3BlbmFpJywgJ21pc3RyYWwnKVxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPHtzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IHN0cmluZ30+fVxyXG4gICAqL1xyXG4gIGFzeW5jIHNhdmVBcGlLZXkoa2V5LCBwcm92aWRlciA9ICdvcGVuYWknKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBTdG9yZSB0aGUga2V5IHdpdGhvdXQgdmFsaWRhdGlvblxyXG4gICAgICB0aGlzLnN0b3JlLnNldChgJHtwcm92aWRlcn0tYXBpLWtleWAsIGtleSk7XHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHNhdmluZyAke3Byb3ZpZGVyfSBBUEkga2V5OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlIHx8IGBGYWlsZWQgdG8gc2F2ZSAke3Byb3ZpZGVyfSBBUEkga2V5YCBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEdldCBhbiBBUEkga2V5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVyIC0gVGhlIEFQSSBwcm92aWRlciAoZS5nLiwgJ29wZW5haScsICdtaXN0cmFsJywgJ2RlZXBncmFtJylcclxuICAgKiBAcmV0dXJucyB7c3RyaW5nfG51bGx9IFRoZSBBUEkga2V5IG9yIG51bGwgaWYgbm90IGZvdW5kXHJcbiAgICovXHJcbiAgZ2V0QXBpS2V5KHByb3ZpZGVyID0gJ29wZW5haScpIHtcclxuICAgIC8vIEZvciBkZWVwZ3JhbSwgYWxzbyBjaGVjayB0aGUgdHJhbnNjcmlwdGlvbiBzZXR0aW5ncyBzdG9yZVxyXG4gICAgaWYgKHByb3ZpZGVyID09PSAnZGVlcGdyYW0nKSB7XHJcbiAgICAgIGNvbnN0IHRyYW5zY3JpcHRpb25TdG9yZSA9IGNyZWF0ZVN0b3JlKCd0cmFuc2NyaXB0aW9uLXNldHRpbmdzJyk7XHJcblxyXG4gICAgICAvLyBGaXJzdCBjaGVjayBvdXIga2V5IHN0b3JlXHJcbiAgICAgIGNvbnN0IGtleSA9IHRoaXMuc3RvcmUuZ2V0KGAke3Byb3ZpZGVyfS1hcGkta2V5YCwgbnVsbCk7XHJcbiAgICAgIGlmIChrZXkpIHJldHVybiBrZXk7XHJcblxyXG4gICAgICAvLyBUaGVuIHRyeSBhbGwgdGhlIHBvc3NpYmxlIGxlZ2FjeSBsb2NhdGlvbnNcclxuICAgICAgdHJ5IHtcclxuICAgICAgICAvLyBMZWdhY3kgZm9ybWF0IHdhcyB0byBzdG9yZSBpdCBpbiBzZXR0aW5ncy50cmFuc2NyaXB0aW9uLmRlZXBncmFtQXBpS2V5XHJcbiAgICAgICAgcmV0dXJuIHRyYW5zY3JpcHRpb25TdG9yZS5nZXQoJ3RyYW5zY3JpcHRpb24uZGVlcGdyYW1BcGlLZXknKSB8fFxyXG4gICAgICAgICAgICAgICB0cmFuc2NyaXB0aW9uU3RvcmUuZ2V0KCdkZWVwZ3JhbUFwaUtleScpIHx8XHJcbiAgICAgICAgICAgICAgIG51bGw7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdbQXBpS2V5U2VydmljZV0gRXJyb3IgYWNjZXNzaW5nIHRyYW5zY3JpcHRpb24gc3RvcmU6JywgZXJyb3IpO1xyXG4gICAgICAgIHJldHVybiBudWxsO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHRoaXMuc3RvcmUuZ2V0KGAke3Byb3ZpZGVyfS1hcGkta2V5YCwgbnVsbCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDaGVjayBpZiBhbiBBUEkga2V5IGV4aXN0c1xyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcm92aWRlciAtIFRoZSBBUEkgcHJvdmlkZXIgKGUuZy4sICdvcGVuYWknLCAnbWlzdHJhbCcpXHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIEFQSSBrZXkgZXhpc3RzXHJcbiAgICovXHJcbiAgaGFzQXBpS2V5KHByb3ZpZGVyID0gJ29wZW5haScpIHtcclxuICAgIHJldHVybiAhIXRoaXMuZ2V0QXBpS2V5KHByb3ZpZGVyKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIERlbGV0ZSBhbiBBUEkga2V5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVyIC0gVGhlIEFQSSBwcm92aWRlciAoZS5nLiwgJ29wZW5haScsICdtaXN0cmFsJylcclxuICAgKiBAcmV0dXJucyB7e3N1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogc3RyaW5nfX1cclxuICAgKi9cclxuICBkZWxldGVBcGlLZXkocHJvdmlkZXIgPSAnb3BlbmFpJykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgdGhpcy5zdG9yZS5kZWxldGUoYCR7cHJvdmlkZXJ9LWFwaS1rZXlgKTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgJHtwcm92aWRlcn0gQVBJIGtleTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7IFxyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSB8fCBgRmFpbGVkIHRvIGRlbGV0ZSAke3Byb3ZpZGVyfSBBUEkga2V5YCBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFZhbGlkYXRlIGFuIEFQSSBrZXkgZm9ybWF0XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIFRoZSBBUEkga2V5IHRvIHZhbGlkYXRlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVyIC0gVGhlIEFQSSBwcm92aWRlciAoZS5nLiwgJ29wZW5haScsICdtaXN0cmFsJylcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyB2YWxpZGF0ZUFwaUtleShrZXksIHByb3ZpZGVyID0gJ29wZW5haScpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICgha2V5IHx8IHR5cGVvZiBrZXkgIT09ICdzdHJpbmcnIHx8IGtleS50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSwgXHJcbiAgICAgICAgICBlcnJvcjogYCR7cHJvdmlkZXJ9IEFQSSBrZXkgY2Fubm90IGJlIGVtcHR5YCBcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBCYXNpYyBmb3JtYXQgdmFsaWRhdGlvbiBiYXNlZCBvbiBwcm92aWRlclxyXG4gICAgICBpZiAocHJvdmlkZXIgPT09ICdvcGVuYWknKSB7XHJcbiAgICAgICAgLy8gT3BlbkFJIGtleXMgdHlwaWNhbGx5IHN0YXJ0IHdpdGggXCJzay1cIiBhbmQgYXJlIDUxIGNoYXJhY3RlcnMgbG9uZ1xyXG4gICAgICAgIGlmICgha2V5LnN0YXJ0c1dpdGgoJ3NrLScpIHx8IGtleS5sZW5ndGggPCAyMCkge1xyXG4gICAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgICAgZXJyb3I6ICdJbnZhbGlkIE9wZW5BSSBBUEkga2V5IGZvcm1hdC4gS2V5cyBzaG91bGQgc3RhcnQgd2l0aCBcInNrLVwiJyBcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKHByb3ZpZGVyID09PSAnbWlzdHJhbCcpIHtcclxuICAgICAgICAvLyBNaXN0cmFsIGtleXMgYXJlIHR5cGljYWxseSBsb25nIHN0cmluZ3NcclxuICAgICAgICBpZiAoa2V5Lmxlbmd0aCA8IDIwKSB7XHJcbiAgICAgICAgICByZXR1cm4geyBcclxuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgICAgICBlcnJvcjogJ0ludmFsaWQgTWlzdHJhbCBBUEkga2V5IGZvcm1hdC4gS2V5IGFwcGVhcnMgdG9vIHNob3J0JyBcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBOb3RlOiBGb3IgYSBtb3JlIHRob3JvdWdoIHZhbGlkYXRpb24sIHlvdSB3b3VsZCBtYWtlIGEgdGVzdCBBUEkgY2FsbFxyXG4gICAgICAvLyB0byB2ZXJpZnkgdGhlIGtleSB3b3JrcywgYnV0IHRoYXQncyBiZXlvbmQgdGhlIHNjb3BlIG9mIHRoaXMgYmFzaWMgdmFsaWRhdGlvblxyXG5cclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdmFsaWRhdGluZyAke3Byb3ZpZGVyfSBBUEkga2V5OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlIHx8IGBGYWlsZWQgdG8gdmFsaWRhdGUgJHtwcm92aWRlcn0gQVBJIGtleWAgXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBBcGlLZXlTZXJ2aWNlKCk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTTtFQUFFQTtBQUFZLENBQUMsR0FBR0MsT0FBTyxDQUFDLHVCQUF1QixDQUFDO0FBRXhELE1BQU1DLGFBQWEsQ0FBQztFQUNsQkMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1o7SUFDQSxJQUFJLENBQUNDLEtBQUssR0FBR0osV0FBVyxDQUFDLFVBQVUsRUFBRTtNQUNuQ0ssYUFBYSxFQUFFQyxPQUFPLENBQUNDLEdBQUcsQ0FBQ0M7SUFDN0IsQ0FBQyxDQUFDO0VBQ0o7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTUMsVUFBVUEsQ0FBQ0MsR0FBRyxFQUFFQyxRQUFRLEdBQUcsUUFBUSxFQUFFO0lBQ3pDLElBQUk7TUFDRjtNQUNBLElBQUksQ0FBQ1AsS0FBSyxDQUFDUSxHQUFHLENBQUMsR0FBR0QsUUFBUSxVQUFVLEVBQUVELEdBQUcsQ0FBQztNQUMxQyxPQUFPO1FBQUVHLE9BQU8sRUFBRTtNQUFLLENBQUM7SUFDMUIsQ0FBQyxDQUFDLE9BQU9DLEtBQUssRUFBRTtNQUNkQyxPQUFPLENBQUNELEtBQUssQ0FBQyxnQkFBZ0JILFFBQVEsV0FBVyxFQUFFRyxLQUFLLENBQUM7TUFDekQsT0FBTztRQUNMRCxPQUFPLEVBQUUsS0FBSztRQUNkQyxLQUFLLEVBQUVBLEtBQUssQ0FBQ0UsT0FBTyxJQUFJLGtCQUFrQkwsUUFBUTtNQUNwRCxDQUFDO0lBQ0g7RUFDRjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VNLFNBQVNBLENBQUNOLFFBQVEsR0FBRyxRQUFRLEVBQUU7SUFDN0I7SUFDQSxJQUFJQSxRQUFRLEtBQUssVUFBVSxFQUFFO01BQzNCLE1BQU1PLGtCQUFrQixHQUFHbEIsV0FBVyxDQUFD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