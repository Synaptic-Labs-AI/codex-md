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
   * @param {string} provider - The API provider (e.g., 'mistral', 'deepgram')
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  async saveApiKey(key, provider = 'mistral') {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmVhdGVTdG9yZSIsInJlcXVpcmUiLCJBcGlLZXlTZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJzdG9yZSIsImVuY3J5cHRpb25LZXkiLCJwcm9jZXNzIiwiZW52IiwiU1RPUkVfRU5DUllQVElPTl9LRVkiLCJzYXZlQXBpS2V5Iiwia2V5IiwicHJvdmlkZXIiLCJzZXQiLCJzdWNjZXNzIiwiZXJyb3IiLCJjb25zb2xlIiwibWVzc2FnZSIsImdldEFwaUtleSIsInRyYW5zY3JpcHRpb25TdG9yZSIsImdldCIsIndhcm4iLCJoYXNBcGlLZXkiLCJkZWxldGVBcGlLZXkiLCJkZWxldGUiLCJ2YWxpZGF0ZUFwaUtleSIsInRyaW0iLCJsZW5ndGgiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0FwaUtleVNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIEFQSSBLZXkgU2VydmljZVxyXG4gKiBQcm92aWRlcyBzZWN1cmUgc3RvcmFnZSBhbmQgbWFuYWdlbWVudCBvZiBBUEkga2V5cyB1c2luZyBtYWNoaW5lLXNwZWNpZmljIGVuY3J5cHRpb24uXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIG1haW4uanM6IE1haW4gcHJvY2VzcyBzZXR1cCB3aXRoIGVuY3J5cHRpb24ga2V5XHJcbiAqIC0gaXBjL2hhbmRsZXJzL2FwaWtleS9pbmRleC5qczogSVBDIGhhbmRsZXJzIGZvciBBUEkga2V5IG9wZXJhdGlvbnNcclxuICogLSBwcmVsb2FkLmpzOiBBUEkgZXhwb3N1cmUgdG8gcmVuZGVyZXJcclxuICovXHJcblxyXG5jb25zdCB7IGNyZWF0ZVN0b3JlIH0gPSByZXF1aXJlKCcuLi91dGlscy9zdG9yZUZhY3RvcnknKTtcclxuXHJcbmNsYXNzIEFwaUtleVNlcnZpY2Uge1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgLy8gSW5pdGlhbGl6ZSBzdG9yZSB3aXRoIGVuY3J5cHRpb24ga2V5IGZyb20gZW52aXJvbm1lbnQgYW5kIGVycm9yIGhhbmRsaW5nXHJcbiAgICB0aGlzLnN0b3JlID0gY3JlYXRlU3RvcmUoJ2FwaS1rZXlzJywge1xyXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9jZXNzLmVudi5TVE9SRV9FTkNSWVBUSU9OX0tFWVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTYXZlIGFuIEFQSSBrZXkgc2VjdXJlbHlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gVGhlIEFQSSBrZXkgdG8gc2F2ZVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcm92aWRlciAtIFRoZSBBUEkgcHJvdmlkZXIgKGUuZy4sICdtaXN0cmFsJywgJ2RlZXBncmFtJylcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyBzYXZlQXBpS2V5KGtleSwgcHJvdmlkZXIgPSAnbWlzdHJhbCcpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFN0b3JlIHRoZSBrZXkgd2l0aG91dCB2YWxpZGF0aW9uXHJcbiAgICAgIHRoaXMuc3RvcmUuc2V0KGAke3Byb3ZpZGVyfS1hcGkta2V5YCwga2V5KTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3Igc2F2aW5nICR7cHJvdmlkZXJ9IEFQSSBrZXk6YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4geyBcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSwgXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfHwgYEZhaWxlZCB0byBzYXZlICR7cHJvdmlkZXJ9IEFQSSBrZXlgIFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0IGFuIEFQSSBrZXlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvdmlkZXIgLSBUaGUgQVBJIHByb3ZpZGVyIChlLmcuLCAnbWlzdHJhbCcsICdkZWVwZ3JhbScpXHJcbiAgICogQHJldHVybnMge3N0cmluZ3xudWxsfSBUaGUgQVBJIGtleSBvciBudWxsIGlmIG5vdCBmb3VuZFxyXG4gICAqL1xyXG4gIGdldEFwaUtleShwcm92aWRlciA9ICdtaXN0cmFsJykge1xyXG4gICAgLy8gRm9yIGRlZXBncmFtLCBhbHNvIGNoZWNrIHRoZSB0cmFuc2NyaXB0aW9uIHNldHRpbmdzIHN0b3JlXHJcbiAgICBpZiAocHJvdmlkZXIgPT09ICdkZWVwZ3JhbScpIHtcclxuICAgICAgY29uc3QgdHJhbnNjcmlwdGlvblN0b3JlID0gY3JlYXRlU3RvcmUoJ3RyYW5zY3JpcHRpb24tc2V0dGluZ3MnKTtcclxuXHJcbiAgICAgIC8vIEZpcnN0IGNoZWNrIG91ciBrZXkgc3RvcmVcclxuICAgICAgY29uc3Qga2V5ID0gdGhpcy5zdG9yZS5nZXQoYCR7cHJvdmlkZXJ9LWFwaS1rZXlgLCBudWxsKTtcclxuICAgICAgaWYgKGtleSkgcmV0dXJuIGtleTtcclxuXHJcbiAgICAgIC8vIFRoZW4gdHJ5IGFsbCB0aGUgcG9zc2libGUgbGVnYWN5IGxvY2F0aW9uc1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIC8vIExlZ2FjeSBmb3JtYXQgd2FzIHRvIHN0b3JlIGl0IGluIHNldHRpbmdzLnRyYW5zY3JpcHRpb24uZGVlcGdyYW1BcGlLZXlcclxuICAgICAgICByZXR1cm4gdHJhbnNjcmlwdGlvblN0b3JlLmdldCgndHJhbnNjcmlwdGlvbi5kZWVwZ3JhbUFwaUtleScpIHx8XHJcbiAgICAgICAgICAgICAgIHRyYW5zY3JpcHRpb25TdG9yZS5nZXQoJ2RlZXBncmFtQXBpS2V5JykgfHxcclxuICAgICAgICAgICAgICAgbnVsbDtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zb2xlLndhcm4oJ1tBcGlLZXlTZXJ2aWNlXSBFcnJvciBhY2Nlc3NpbmcgdHJhbnNjcmlwdGlvbiBzdG9yZTonLCBlcnJvcik7XHJcbiAgICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gdGhpcy5zdG9yZS5nZXQoYCR7cHJvdmlkZXJ9LWFwaS1rZXlgLCBudWxsKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENoZWNrIGlmIGFuIEFQSSBrZXkgZXhpc3RzXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVyIC0gVGhlIEFQSSBwcm92aWRlciAoZS5nLiwgJ21pc3RyYWwnLCAnZGVlcGdyYW0nKVxyXG4gICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHRoZSBBUEkga2V5IGV4aXN0c1xyXG4gICAqL1xyXG4gIGhhc0FwaUtleShwcm92aWRlciA9ICdtaXN0cmFsJykge1xyXG4gICAgcmV0dXJuICEhdGhpcy5nZXRBcGlLZXkocHJvdmlkZXIpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRGVsZXRlIGFuIEFQSSBrZXlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvdmlkZXIgLSBUaGUgQVBJIHByb3ZpZGVyIChlLmcuLCAnbWlzdHJhbCcsICdkZWVwZ3JhbScpXHJcbiAgICogQHJldHVybnMge3tzdWNjZXNzOiBib29sZWFuLCBlcnJvcj86IHN0cmluZ319XHJcbiAgICovXHJcbiAgZGVsZXRlQXBpS2V5KHByb3ZpZGVyID0gJ21pc3RyYWwnKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICB0aGlzLnN0b3JlLmRlbGV0ZShgJHtwcm92aWRlcn0tYXBpLWtleWApO1xyXG4gICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKGBFcnJvciBkZWxldGluZyAke3Byb3ZpZGVyfSBBUEkga2V5OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlIHx8IGBGYWlsZWQgdG8gZGVsZXRlICR7cHJvdmlkZXJ9IEFQSSBrZXlgIFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogVmFsaWRhdGUgYW4gQVBJIGtleSBmb3JtYXRcclxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gVGhlIEFQSSBrZXkgdG8gdmFsaWRhdGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvdmlkZXIgLSBUaGUgQVBJIHByb3ZpZGVyIChlLmcuLCAnbWlzdHJhbCcsICdkZWVwZ3JhbScpXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8e3N1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogc3RyaW5nfT59XHJcbiAgICovXHJcbiAgYXN5bmMgdmFsaWRhdGVBcGlLZXkoa2V5LCBwcm92aWRlciA9ICdtaXN0cmFsJykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgaWYgKCFrZXkgfHwgdHlwZW9mIGtleSAhPT0gJ3N0cmluZycgfHwga2V5LnRyaW0oKSA9PT0gJycpIHtcclxuICAgICAgICByZXR1cm4geyBcclxuICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgIGVycm9yOiBgJHtwcm92aWRlcn0gQVBJIGtleSBjYW5ub3QgYmUgZW1wdHlgIFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIEJhc2ljIGZvcm1hdCB2YWxpZGF0aW9uIGJhc2VkIG9uIHByb3ZpZGVyXHJcbiAgICAgIGlmIChwcm92aWRlciA9PT0gJ21pc3RyYWwnKSB7XHJcbiAgICAgICAgLy8gTWlzdHJhbCBrZXlzIGFyZSB0eXBpY2FsbHkgbG9uZyBzdHJpbmdzXHJcbiAgICAgICAgaWYgKGtleS5sZW5ndGggPCAyMCkge1xyXG4gICAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgICAgZXJyb3I6ICdJbnZhbGlkIE1pc3RyYWwgQVBJIGtleSBmb3JtYXQuIEtleSBhcHBlYXJzIHRvbyBzaG9ydCcgXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG5cclxuICAgICAgLy8gTm90ZTogRm9yIGEgbW9yZSB0aG9yb3VnaCB2YWxpZGF0aW9uLCB5b3Ugd291bGQgbWFrZSBhIHRlc3QgQVBJIGNhbGxcclxuICAgICAgLy8gdG8gdmVyaWZ5IHRoZSBrZXkgd29ya3MsIGJ1dCB0aGF0J3MgYmV5b25kIHRoZSBzY29wZSBvZiB0aGlzIGJhc2ljIHZhbGlkYXRpb25cclxuXHJcbiAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoYEVycm9yIHZhbGlkYXRpbmcgJHtwcm92aWRlcn0gQVBJIGtleTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7IFxyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSB8fCBgRmFpbGVkIHRvIHZhbGlkYXRlICR7cHJvdmlkZXJ9IEFQSSBrZXlgIFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBuZXcgQXBpS2V5U2VydmljZSgpO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU07RUFBRUE7QUFBWSxDQUFDLEdBQUdDLE9BQU8sQ0FBQyx1QkFBdUIsQ0FBQztBQUV4RCxNQUFNQyxhQUFhLENBQUM7RUFDbEJDLFdBQVdBLENBQUEsRUFBRztJQUNaO0lBQ0EsSUFBSSxDQUFDQyxLQUFLLEdBQUdKLFdBQVcsQ0FBQyxVQUFVLEVBQUU7TUFDbkNLLGFBQWEsRUFBRUMsT0FBTyxDQUFDQyxHQUFHLENBQUNDO0lBQzdCLENBQUMsQ0FBQztFQUNKOztFQUVBO0FB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