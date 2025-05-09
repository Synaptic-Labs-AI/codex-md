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
   * @param {string} provider - The API provider (e.g., 'openai', 'mistral')
   * @returns {string|null} The API key or null if not found
   */
  getApiKey(provider = 'openai') {
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJjcmVhdGVTdG9yZSIsInJlcXVpcmUiLCJBcGlLZXlTZXJ2aWNlIiwiY29uc3RydWN0b3IiLCJzdG9yZSIsImVuY3J5cHRpb25LZXkiLCJwcm9jZXNzIiwiZW52IiwiU1RPUkVfRU5DUllQVElPTl9LRVkiLCJzYXZlQXBpS2V5Iiwia2V5IiwicHJvdmlkZXIiLCJzZXQiLCJzdWNjZXNzIiwiZXJyb3IiLCJjb25zb2xlIiwibWVzc2FnZSIsImdldEFwaUtleSIsImdldCIsImhhc0FwaUtleSIsImRlbGV0ZUFwaUtleSIsImRlbGV0ZSIsInZhbGlkYXRlQXBpS2V5IiwidHJpbSIsInN0YXJ0c1dpdGgiLCJsZW5ndGgiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL0FwaUtleVNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIEFQSSBLZXkgU2VydmljZVxyXG4gKiBQcm92aWRlcyBzZWN1cmUgc3RvcmFnZSBhbmQgbWFuYWdlbWVudCBvZiBBUEkga2V5cyB1c2luZyBtYWNoaW5lLXNwZWNpZmljIGVuY3J5cHRpb24uXHJcbiAqIFxyXG4gKiBSZWxhdGVkIGZpbGVzOlxyXG4gKiAtIG1haW4uanM6IE1haW4gcHJvY2VzcyBzZXR1cCB3aXRoIGVuY3J5cHRpb24ga2V5XHJcbiAqIC0gaXBjL2hhbmRsZXJzL2FwaWtleS9pbmRleC5qczogSVBDIGhhbmRsZXJzIGZvciBBUEkga2V5IG9wZXJhdGlvbnNcclxuICogLSBwcmVsb2FkLmpzOiBBUEkgZXhwb3N1cmUgdG8gcmVuZGVyZXJcclxuICovXHJcblxyXG5jb25zdCB7IGNyZWF0ZVN0b3JlIH0gPSByZXF1aXJlKCcuLi91dGlscy9zdG9yZUZhY3RvcnknKTtcclxuXHJcbmNsYXNzIEFwaUtleVNlcnZpY2Uge1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgLy8gSW5pdGlhbGl6ZSBzdG9yZSB3aXRoIGVuY3J5cHRpb24ga2V5IGZyb20gZW52aXJvbm1lbnQgYW5kIGVycm9yIGhhbmRsaW5nXHJcbiAgICB0aGlzLnN0b3JlID0gY3JlYXRlU3RvcmUoJ2FwaS1rZXlzJywge1xyXG4gICAgICBlbmNyeXB0aW9uS2V5OiBwcm9jZXNzLmVudi5TVE9SRV9FTkNSWVBUSU9OX0tFWVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTYXZlIGFuIEFQSSBrZXkgc2VjdXJlbHlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30ga2V5IC0gVGhlIEFQSSBrZXkgdG8gc2F2ZVxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcm92aWRlciAtIFRoZSBBUEkgcHJvdmlkZXIgKGUuZy4sICdvcGVuYWknLCAnbWlzdHJhbCcpXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8e3N1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogc3RyaW5nfT59XHJcbiAgICovXHJcbiAgYXN5bmMgc2F2ZUFwaUtleShrZXksIHByb3ZpZGVyID0gJ29wZW5haScpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIC8vIFN0b3JlIHRoZSBrZXkgd2l0aG91dCB2YWxpZGF0aW9uXHJcbiAgICAgIHRoaXMuc3RvcmUuc2V0KGAke3Byb3ZpZGVyfS1hcGkta2V5YCwga2V5KTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3Igc2F2aW5nICR7cHJvdmlkZXJ9IEFQSSBrZXk6YCwgZXJyb3IpO1xyXG4gICAgICByZXR1cm4geyBcclxuICAgICAgICBzdWNjZXNzOiBmYWxzZSwgXHJcbiAgICAgICAgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfHwgYEZhaWxlZCB0byBzYXZlICR7cHJvdmlkZXJ9IEFQSSBrZXlgIFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0IGFuIEFQSSBrZXlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gcHJvdmlkZXIgLSBUaGUgQVBJIHByb3ZpZGVyIChlLmcuLCAnb3BlbmFpJywgJ21pc3RyYWwnKVxyXG4gICAqIEByZXR1cm5zIHtzdHJpbmd8bnVsbH0gVGhlIEFQSSBrZXkgb3IgbnVsbCBpZiBub3QgZm91bmRcclxuICAgKi9cclxuICBnZXRBcGlLZXkocHJvdmlkZXIgPSAnb3BlbmFpJykge1xyXG4gICAgcmV0dXJuIHRoaXMuc3RvcmUuZ2V0KGAke3Byb3ZpZGVyfS1hcGkta2V5YCwgbnVsbCk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDaGVjayBpZiBhbiBBUEkga2V5IGV4aXN0c1xyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSBwcm92aWRlciAtIFRoZSBBUEkgcHJvdmlkZXIgKGUuZy4sICdvcGVuYWknLCAnbWlzdHJhbCcpXHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdGhlIEFQSSBrZXkgZXhpc3RzXHJcbiAgICovXHJcbiAgaGFzQXBpS2V5KHByb3ZpZGVyID0gJ29wZW5haScpIHtcclxuICAgIHJldHVybiAhIXRoaXMuZ2V0QXBpS2V5KHByb3ZpZGVyKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIERlbGV0ZSBhbiBBUEkga2V5XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVyIC0gVGhlIEFQSSBwcm92aWRlciAoZS5nLiwgJ29wZW5haScsICdtaXN0cmFsJylcclxuICAgKiBAcmV0dXJucyB7e3N1Y2Nlc3M6IGJvb2xlYW4sIGVycm9yPzogc3RyaW5nfX1cclxuICAgKi9cclxuICBkZWxldGVBcGlLZXkocHJvdmlkZXIgPSAnb3BlbmFpJykge1xyXG4gICAgdHJ5IHtcclxuICAgICAgdGhpcy5zdG9yZS5kZWxldGUoYCR7cHJvdmlkZXJ9LWFwaS1rZXlgKTtcclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgZGVsZXRpbmcgJHtwcm92aWRlcn0gQVBJIGtleTpgLCBlcnJvcik7XHJcbiAgICAgIHJldHVybiB7IFxyXG4gICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICBlcnJvcjogZXJyb3IubWVzc2FnZSB8fCBgRmFpbGVkIHRvIGRlbGV0ZSAke3Byb3ZpZGVyfSBBUEkga2V5YCBcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFZhbGlkYXRlIGFuIEFQSSBrZXkgZm9ybWF0XHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGtleSAtIFRoZSBBUEkga2V5IHRvIHZhbGlkYXRlXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IHByb3ZpZGVyIC0gVGhlIEFQSSBwcm92aWRlciAoZS5nLiwgJ29wZW5haScsICdtaXN0cmFsJylcclxuICAgKiBAcmV0dXJucyB7UHJvbWlzZTx7c3VjY2VzczogYm9vbGVhbiwgZXJyb3I/OiBzdHJpbmd9Pn1cclxuICAgKi9cclxuICBhc3luYyB2YWxpZGF0ZUFwaUtleShrZXksIHByb3ZpZGVyID0gJ29wZW5haScpIHtcclxuICAgIHRyeSB7XHJcbiAgICAgIGlmICgha2V5IHx8IHR5cGVvZiBrZXkgIT09ICdzdHJpbmcnIHx8IGtleS50cmltKCkgPT09ICcnKSB7XHJcbiAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICBzdWNjZXNzOiBmYWxzZSwgXHJcbiAgICAgICAgICBlcnJvcjogYCR7cHJvdmlkZXJ9IEFQSSBrZXkgY2Fubm90IGJlIGVtcHR5YCBcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBCYXNpYyBmb3JtYXQgdmFsaWRhdGlvbiBiYXNlZCBvbiBwcm92aWRlclxyXG4gICAgICBpZiAocHJvdmlkZXIgPT09ICdvcGVuYWknKSB7XHJcbiAgICAgICAgLy8gT3BlbkFJIGtleXMgdHlwaWNhbGx5IHN0YXJ0IHdpdGggXCJzay1cIiBhbmQgYXJlIDUxIGNoYXJhY3RlcnMgbG9uZ1xyXG4gICAgICAgIGlmICgha2V5LnN0YXJ0c1dpdGgoJ3NrLScpIHx8IGtleS5sZW5ndGggPCAyMCkge1xyXG4gICAgICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgICAgIHN1Y2Nlc3M6IGZhbHNlLCBcclxuICAgICAgICAgICAgZXJyb3I6ICdJbnZhbGlkIE9wZW5BSSBBUEkga2V5IGZvcm1hdC4gS2V5cyBzaG91bGQgc3RhcnQgd2l0aCBcInNrLVwiJyBcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgICB9IGVsc2UgaWYgKHByb3ZpZGVyID09PSAnbWlzdHJhbCcpIHtcclxuICAgICAgICAvLyBNaXN0cmFsIGtleXMgYXJlIHR5cGljYWxseSBsb25nIHN0cmluZ3NcclxuICAgICAgICBpZiAoa2V5Lmxlbmd0aCA8IDIwKSB7XHJcbiAgICAgICAgICByZXR1cm4geyBcclxuICAgICAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgICAgICBlcnJvcjogJ0ludmFsaWQgTWlzdHJhbCBBUEkga2V5IGZvcm1hdC4gS2V5IGFwcGVhcnMgdG9vIHNob3J0JyBcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBOb3RlOiBGb3IgYSBtb3JlIHRob3JvdWdoIHZhbGlkYXRpb24sIHlvdSB3b3VsZCBtYWtlIGEgdGVzdCBBUEkgY2FsbFxyXG4gICAgICAvLyB0byB2ZXJpZnkgdGhlIGtleSB3b3JrcywgYnV0IHRoYXQncyBiZXlvbmQgdGhlIHNjb3BlIG9mIHRoaXMgYmFzaWMgdmFsaWRhdGlvblxyXG5cclxuICAgICAgcmV0dXJuIHsgc3VjY2VzczogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcihgRXJyb3IgdmFsaWRhdGluZyAke3Byb3ZpZGVyfSBBUEkga2V5OmAsIGVycm9yKTtcclxuICAgICAgcmV0dXJuIHsgXHJcbiAgICAgICAgc3VjY2VzczogZmFsc2UsIFxyXG4gICAgICAgIGVycm9yOiBlcnJvci5tZXNzYWdlIHx8IGBGYWlsZWQgdG8gdmFsaWRhdGUgJHtwcm92aWRlcn0gQVBJIGtleWAgXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IG5ldyBBcGlLZXlTZXJ2aWNlKCk7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTTtFQUFFQTtBQUFZLENBQUMsR0FBR0MsT0FBTyxDQUFDLHVCQUF1QixDQUFDO0FBRXhELE1BQU1DLGFBQWEsQ0FBQztFQUNsQkMsV0FBV0EsQ0FBQSxFQUFHO0lBQ1o7SUFDQSxJQUFJLENBQUNDLEtBQUssR0FBR0osV0FBVyxDQUFDLFVBQVUsRUFBRTtNQUNuQ0ssYUFBYSxFQUFFQyxPQUFPLENBQUNDLEdBQUcsQ0FBQ0M7SUFDN0IsQ0FBQyxDQUFDO0VBQ0o7O0VBRUE7QUFDRjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0UsTUFBTUMsVUFBVUEsQ0FBQ0MsR0FBRyxFQUFFQyxRQUFRLEdBQUcsUUFBUSxFQUFFO0lBQ3pDLElBQUk7TUFDRjtNQUNBLElBQUksQ0FBQ1AsS0FBSyxDQUFDUSxHQUFHLENBQUMsR0FBR0QsUUFBUSxVQUFVLEVBQUVELEdBQUcsQ0FBQztNQUMxQyxPQUFPO1FBQUVHLE9BQU8sRUFBRTtNQUFLLENBQUM7SUFDMUIsQ0FBQyxDQUFDLE9BQU9DLEtBQUssRUFBRTtNQUNkQyxPQUFPLENBQUNELEtBQUssQ0FBQyxnQkFBZ0JILFFBQVEsV0FBVyxFQUFFRyxLQUFLLENBQUM7TUFDekQsT0FBTztRQUNMRCxPQUFPLEVBQUUsS0FBSztRQUNkQyxLQUFLLEVBQUVBLEtBQUssQ0FBQ0UsT0FBTyxJQUFJLGtCQUFrQkwsUUFBUTtNQUNwRCxDQUFDO0lBQ0g7RUFDRjs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VNLFNBQVNBLENBQUNOLFFBQVEsR0FBRyxRQUFRLEVBQUU7SUFDN0IsT0FBTyxJQUFJLENBQUNQLEtBQUssQ0FBQ2MsR0FBRyxDQUFDLEdBQUdQLFFBQVEsVUFBVSxFQUFFLElBQUksQ0FBQztFQUNwRDs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VRLFNBQVNBLENBQUNSLFFBQVEsR0FBRyxRQUFRLEVBQUU7SUFDN0IsT0FBTyxDQUFDLENBQUMsSUFBSSxDQUFDTSxTQUFTLENBQUNOLFFBQVEsQ0FBQztFQUNuQzs7RUFFQTtBQUNGO0FBQ0E7QUFDQTtBQUNBO0VBQ0VTLFlBQVlBLENBQUNULFFBQVEsR0FBRyxRQUFRLEVBQUU7SUFDaEMsSUFBSTtNQUNGLElBQUksQ0FBQ1AsS0FBSyxDQUFDaUIsTUFBTSxDQUFDLEdBQUdWLFFBQVEsVUFBVSxDQUFDO01BQ3hDLE9BQU87UUFBRUUsT0FBTyxFQUFFO01BQUssQ0FBQztJQUMxQixDQUFDLENBQUMsT0FBT0MsS0FBSyxFQUFFO01BQ2RDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLGtCQUFrQkgsUUFBUSxXQUFXLEVBQUVHLEtBQUssQ0FBQztNQUMzRCxPQUFPO1FBQ0xELE9BQU8sRUFBRSxLQUFLO1FBQ2RDLEtBQUssRUFBRUEsS0FBSyxDQUFDRSxPQUFPLElBQUksb0JBQW9CTCxRQUFRO01BQ3RELENBQUM7SUFDSDtFQUNGOztFQUVBO0FBQ0Y7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNFLE1BQU1XLGNBQWNBLENBQUNaLEdBQUcsRUFBRUMsUUFBUSxHQUFHLFFBQVEsRUFBRTtJQUM3QyxJQUFJO01BQ0YsSUFBSSxDQUFDRCxHQUFHLElBQUksT0FBT0EsR0FBRyxLQUFLLFFBQVEsSUFBSUEsR0FBRyxDQUFDYSxJQUFJLENBQUMsQ0FBQyxLQUFLLEVBQUUsRUFBRTtRQUN4RCxPQUFPO1VBQ0xWLE9BQU8sRUFBRSxLQUFLO1VBQ2RDLEtBQUssRUFBRSxHQUFHSCxRQUFRO1FBQ3BCLENBQUM7TUFDSDs7TUFFQTtNQUNBLElBQUlBLFFBQVEsS0FBSyxRQUFRLEVBQUU7UUFDekI7UUFDQSxJQUFJLENBQUNELEdBQUcsQ0FBQ2MsVUFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJZCxHQUFHLENBQUNlLE1BQU0sR0FBRyxFQUFFLEVBQUU7VUFDN0MsT0FBTztZQUNMWixPQUFPLEVBQUUsS0FBSztZQUNkQyxLQUFLLEVBQUU7VUFDVCxDQUFDO1FBQ0g7TUFDRixDQUFDLE1BQU0sSUFBSUgsUUFBUSxLQUFLLFNBQVMsRUFBRTtRQUNqQztRQUNBLElBQUlELEdBQUcsQ0FBQ2UsTUFBTSxHQUFHLEVBQUUsRUFBRTtVQUNuQixPQUFPO1lBQ0xaLE9BQU8sRUFBRSxLQUFLO1lBQ2RDLEtBQUssRUFBRTtVQUNULENBQUM7UUFDSDtNQUNGOztNQUVBO01BQ0E7O01BRUEsT0FBTztRQUFFRCxPQUFPLEVBQUU7TUFBSyxDQUFDO0lBQzFCLENBQUMsQ0FBQyxPQUFPQyxLQUFLLEVBQUU7TUFDZEMsT0FBTyxDQUFDRCxLQUFLLENBQUMsb0JBQW9CSCxRQUFRLFdBQVcsRUFBRUcsS0FBSyxDQUFDO01BQzdELE9BQU87UUFDTEQsT0FBTyxFQUFFLEtBQUs7UUFDZEMsS0FBSyxFQUFFQSxLQUFLLENBQUNFLE9BQU8sSUFBSSxzQkFBc0JMLFFBQVE7TUFDeEQsQ0FBQztJQUNIO0VBQ0Y7QUFDRjtBQUVBZSxNQUFNLENBQUNDLE9BQU8sR0FBRyxJQUFJekIsYUFBYSxDQUFDLENBQUMiLCJpZ25vcmVMaXN0IjpbXX0=