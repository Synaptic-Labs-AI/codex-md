"use strict";

/**
 * MistralApiClient.js
 * Handles API communication with Mistral AI services
 */

const FormData = require('form-data');

// Use node-fetch-commonjs which is CommonJS compatible
let fetchModule = null;

// Initialize fetch immediately
const initializeFetch = () => {
  try {
    // First try the CommonJS version
    try {
      // Try the CommonJS version first
      fetchModule = require('node-fetch-commonjs');
      console.log('[MistralApiClient] node-fetch-commonjs loaded successfully');
      return Promise.resolve();
    } catch (commonjsError) {
      console.log('[MistralApiClient] node-fetch-commonjs not available, trying cross-fetch');

      // Try cross-fetch as fallback (which is also CommonJS compatible)
      try {
        fetchModule = require('cross-fetch');
        console.log('[MistralApiClient] cross-fetch loaded successfully');
        return Promise.resolve();
      } catch (crossFetchError) {
        console.log('[MistralApiClient] cross-fetch not available, falling back to regular require');

        // Last resort: try regular require and hope it works
        fetchModule = require('node-fetch');
        console.log('[MistralApiClient] node-fetch loaded successfully via require');
        return Promise.resolve();
      }
    }
  } catch (error) {
    console.error('[MistralApiClient] All fetch loading methods failed:', error);
    return Promise.reject(error);
  }
};

// Start loading immediately
const fetchPromise = initializeFetch();
class MistralApiClient {
  constructor(config = {}) {
    this.apiEndpoint = config.apiEndpoint || process.env.MISTRAL_API_ENDPOINT || 'https://api.mistral.ai/v1/ocr';
    this.apiKey = config.apiKey || process.env.MISTRAL_API_KEY;
    this.baseUrl = 'https://api.mistral.ai/v1';
    this.fileUploadUrl = `${this.baseUrl}/files`;
  }

  /**
   * Set API key
   * @param {string} apiKey - Mistral API key
   */
  setApiKey(apiKey) {
    this.apiKey = apiKey;
  }

  /**
   * Check if API client is configured with valid API key
   * @returns {boolean} True if API key is set
   */
  isConfigured() {
    return !!this.apiKey;
  }

  /**
   * Ensure fetch is available and make request
   * @param {string} url - Request URL
   * @param {Object} options - Request options
   * @returns {Promise<Response>} Fetch response
   */
  async fetch(url, options) {
    // Wait for fetch to be loaded if it's not ready yet
    if (!fetchModule) {
      await fetchPromise;
    }

    // Handle both CommonJS and ESM style modules
    if (fetchModule.default) {
      // ESM style module
      return fetchModule.default(url, options);
    } else {
      // CommonJS style module
      return fetchModule(url, options);
    }
  }

  /**
   * Check if the API key is valid
   * @returns {Promise<Object>} Validation result
   */
  async validateApiKey() {
    try {
      if (!this.apiKey) {
        return {
          valid: false,
          error: 'API key not configured'
        };
      }

      // Use the models endpoint to check if the API key is valid
      const response = await this.fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      });
      if (response.ok) {
        return {
          valid: true
        };
      } else {
        // Read response as text first to avoid JSON parsing errors with non-JSON error responses
        const responseText = await response.text();
        console.error(`[MistralApiClient] API key check error (${response.status}): ${responseText.substring(0, 500)}`);

        // Try to parse as JSON if it looks like JSON
        let errorMessage = 'Invalid API key';
        try {
          if (responseText.trim().startsWith('{')) {
            const errorJson = JSON.parse(responseText);
            if (errorJson.error && errorJson.error.message) {
              errorMessage = errorJson.error.message;
            }
          }
        } catch (parseError) {
          console.error('[MistralApiClient] Could not parse error response as JSON:', parseError.message);
        }
        return {
          valid: false,
          error: errorMessage
        };
      }
    } catch (error) {
      console.error('[MistralApiClient] API key check failed:', error);
      return {
        valid: false,
        error: error.message
      };
    }
  }

  /**
   * Upload a file to Mistral API
   * @param {Buffer} fileBuffer - File content as buffer
   * @param {string} fileName - File name
   * @returns {Promise<Object>} Upload result with file ID
   */
  async uploadFile(fileBuffer, fileName) {
    try {
      console.log(`[MistralApiClient] Uploading file: ${fileName}`);
      const formData = new FormData();
      formData.append('purpose', 'ocr');
      formData.append('file', fileBuffer, fileName);
      const uploadResponse = await this.fetch(this.fileUploadUrl, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          ...formData.getHeaders() // Let FormData set the Content-Type
        },
        body: formData
      });
      if (!uploadResponse.ok) {
        const responseText = await uploadResponse.text();
        console.error(`[MistralApiClient] File upload failed (${uploadResponse.status}): ${responseText.substring(0, 500)}`);
        throw new Error(`Mistral file upload failed (${uploadResponse.status}): ${responseText}`);
      }
      const uploadedFileData = await uploadResponse.json();
      console.log(`[MistralApiClient] File uploaded successfully. File ID: ${uploadedFileData.id}`);
      return uploadedFileData;
    } catch (error) {
      console.error('[MistralApiClient] File upload failed:', error);
      throw error;
    }
  }

  /**
   * Get signed URL for a previously uploaded file
   * @param {string} fileId - File ID from upload response
   * @returns {Promise<Object>} Signed URL response
   */
  async getSignedUrl(fileId) {
    try {
      console.log(`[MistralApiClient] Getting signed URL for file ID: ${fileId}`);
      const signedUrlResponse = await this.fetch(`${this.fileUploadUrl}/${fileId}/url`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Accept': 'application/json'
        }
      });
      if (!signedUrlResponse.ok) {
        const responseText = await signedUrlResponse.text();
        console.error(`[MistralApiClient] Get signed URL failed (${signedUrlResponse.status}): ${responseText.substring(0, 500)}`);
        throw new Error(`Mistral get signed URL failed (${signedUrlResponse.status}): ${responseText}`);
      }
      const signedUrlData = await signedUrlResponse.json();
      console.log(`[MistralApiClient] Signed URL obtained`);
      return signedUrlData;
    } catch (error) {
      console.error('[MistralApiClient] Get signed URL failed:', error);
      throw error;
    }
  }

  /**
   * Process document with OCR using the provided signed URL
   * @param {string} documentUrl - Signed URL for the document
   * @param {Object} options - OCR options
   * @returns {Promise<Object>} OCR result
   */
  async processOcr(documentUrl, options = {}) {
    try {
      console.log('[MistralApiClient] Calling OCR API with signed URL');
      const requestBody = {
        model: options.model || "mistral-ocr-latest",
        document: {
          type: "document_url",
          document_url: documentUrl
        },
        include_image_base64: false
      };
      if (options.language) {
        requestBody.language = options.language;
      }
      const ocrResponse = await this.fetch(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      });
      if (!ocrResponse.ok) {
        // Read response as text first to avoid JSON parsing errors with non-JSON error responses
        const responseText = await ocrResponse.text();
        console.error(`[MistralApiClient] OCR API error (${ocrResponse.status}): ${responseText.substring(0, 500)}`);

        // Try to parse as JSON if it looks like JSON
        let errorMessage = `OCR request failed with status ${ocrResponse.status}`;
        let errorDetails = responseText;
        try {
          if (responseText.trim().startsWith('{')) {
            const errorJson = JSON.parse(responseText);
            if (errorJson.error && errorJson.error.message) {
              errorMessage = errorJson.error.message;
            }

            // Log the full error object for debugging
            console.error('[MistralApiClient] Parsed error response:', JSON.stringify(errorJson, null, 2));
            errorDetails = JSON.stringify(errorJson, null, 2);
          }
        } catch (parseError) {
          console.error('[MistralApiClient] Could not parse error response as JSON:', parseError.message);
        }

        // For 500 errors, provide more specific guidance
        if (ocrResponse.status === 500) {
          errorMessage = `Mistral API Internal Server Error (500): ${errorMessage}. This may be due to file size limits (max 50MB), API service issues, or rate limiting.`;
        }
        throw new Error(`Mistral OCR API error (${ocrResponse.status}): ${errorMessage}`);
      }
      const result = await ocrResponse.json();
      console.log('[MistralApiClient] OCR processing completed successfully');
      return result;
    } catch (error) {
      console.error('[MistralApiClient] OCR processing failed:', error);
      throw error;
    }
  }

  /**
   * Complete OCR workflow: Upload file, get signed URL, and process with OCR
   * @param {Buffer} fileBuffer - File content as buffer
   * @param {string} fileName - File name
   * @param {Object} options - OCR options
   * @returns {Promise<Object>} OCR result
   */
  async processDocument(fileBuffer, fileName, options = {}) {
    try {
      // Upload file
      const uploadResult = await this.uploadFile(fileBuffer, fileName);

      // Get signed URL
      const signedUrlResult = await this.getSignedUrl(uploadResult.id);

      // Process OCR
      const ocrResult = await this.processOcr(signedUrlResult.url, options);
      return ocrResult;
    } catch (error) {
      console.error('[MistralApiClient] Document processing workflow failed:', error);
      throw error;
    }
  }
}
module.exports = MistralApiClient;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJGb3JtRGF0YSIsInJlcXVpcmUiLCJmZXRjaE1vZHVsZSIsImluaXRpYWxpemVGZXRjaCIsImNvbnNvbGUiLCJsb2ciLCJQcm9taXNlIiwicmVzb2x2ZSIsImNvbW1vbmpzRXJyb3IiLCJjcm9zc0ZldGNoRXJyb3IiLCJlcnJvciIsInJlamVjdCIsImZldGNoUHJvbWlzZSIsIk1pc3RyYWxBcGlDbGllbnQiLCJjb25zdHJ1Y3RvciIsImNvbmZpZyIsImFwaUVuZHBvaW50IiwicHJvY2VzcyIsImVudiIsIk1JU1RSQUxfQVBJX0VORFBPSU5UIiwiYXBpS2V5IiwiTUlTVFJBTF9BUElfS0VZIiwiYmFzZVVybCIsImZpbGVVcGxvYWRVcmwiLCJzZXRBcGlLZXkiLCJpc0NvbmZpZ3VyZWQiLCJmZXRjaCIsInVybCIsIm9wdGlvbnMiLCJkZWZhdWx0IiwidmFsaWRhdGVBcGlLZXkiLCJ2YWxpZCIsInJlc3BvbnNlIiwibWV0aG9kIiwiaGVhZGVycyIsIm9rIiwicmVzcG9uc2VUZXh0IiwidGV4dCIsInN0YXR1cyIsInN1YnN0cmluZyIsImVycm9yTWVzc2FnZSIsInRyaW0iLCJzdGFydHNXaXRoIiwiZXJyb3JKc29uIiwiSlNPTiIsInBhcnNlIiwibWVzc2FnZSIsInBhcnNlRXJyb3IiLCJ1cGxvYWRGaWxlIiwiZmlsZUJ1ZmZlciIsImZpbGVOYW1lIiwiZm9ybURhdGEiLCJhcHBlbmQiLCJ1cGxvYWRSZXNwb25zZSIsImdldEhlYWRlcnMiLCJib2R5IiwiRXJyb3IiLCJ1cGxvYWRlZEZpbGVEYXRhIiwianNvbiIsImlkIiwiZ2V0U2lnbmVkVXJsIiwiZmlsZUlkIiwic2lnbmVkVXJsUmVzcG9uc2UiLCJzaWduZWRVcmxEYXRhIiwicHJvY2Vzc09jciIsImRvY3VtZW50VXJsIiwicmVxdWVzdEJvZHkiLCJtb2RlbCIsImRvY3VtZW50IiwidHlwZSIsImRvY3VtZW50X3VybCIsImluY2x1ZGVfaW1hZ2VfYmFzZTY0IiwibGFuZ3VhZ2UiLCJvY3JSZXNwb25zZSIsInN0cmluZ2lmeSIsImVycm9yRGV0YWlscyIsInJlc3VsdCIsInByb2Nlc3NEb2N1bWVudCIsInVwbG9hZFJlc3VsdCIsInNpZ25lZFVybFJlc3VsdCIsIm9jclJlc3VsdCIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi8uLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvY29udmVyc2lvbi9kb2N1bWVudC9taXN0cmFsL01pc3RyYWxBcGlDbGllbnQuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIE1pc3RyYWxBcGlDbGllbnQuanNcclxuICogSGFuZGxlcyBBUEkgY29tbXVuaWNhdGlvbiB3aXRoIE1pc3RyYWwgQUkgc2VydmljZXNcclxuICovXHJcblxyXG5jb25zdCBGb3JtRGF0YSA9IHJlcXVpcmUoJ2Zvcm0tZGF0YScpO1xyXG5cclxuLy8gVXNlIG5vZGUtZmV0Y2gtY29tbW9uanMgd2hpY2ggaXMgQ29tbW9uSlMgY29tcGF0aWJsZVxyXG5sZXQgZmV0Y2hNb2R1bGUgPSBudWxsO1xyXG5cclxuLy8gSW5pdGlhbGl6ZSBmZXRjaCBpbW1lZGlhdGVseVxyXG5jb25zdCBpbml0aWFsaXplRmV0Y2ggPSAoKSA9PiB7XHJcbiAgdHJ5IHtcclxuICAgIC8vIEZpcnN0IHRyeSB0aGUgQ29tbW9uSlMgdmVyc2lvblxyXG4gICAgdHJ5IHtcclxuICAgICAgLy8gVHJ5IHRoZSBDb21tb25KUyB2ZXJzaW9uIGZpcnN0XHJcbiAgICAgIGZldGNoTW9kdWxlID0gcmVxdWlyZSgnbm9kZS1mZXRjaC1jb21tb25qcycpO1xyXG4gICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxBcGlDbGllbnRdIG5vZGUtZmV0Y2gtY29tbW9uanMgbG9hZGVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgICB9IGNhdGNoIChjb21tb25qc0Vycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUubG9nKCdbTWlzdHJhbEFwaUNsaWVudF0gbm9kZS1mZXRjaC1jb21tb25qcyBub3QgYXZhaWxhYmxlLCB0cnlpbmcgY3Jvc3MtZmV0Y2gnKTtcclxuXHJcbiAgICAgIC8vIFRyeSBjcm9zcy1mZXRjaCBhcyBmYWxsYmFjayAod2hpY2ggaXMgYWxzbyBDb21tb25KUyBjb21wYXRpYmxlKVxyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGZldGNoTW9kdWxlID0gcmVxdWlyZSgnY3Jvc3MtZmV0Y2gnKTtcclxuICAgICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxBcGlDbGllbnRdIGNyb3NzLWZldGNoIGxvYWRlZCBzdWNjZXNzZnVsbHknKTtcclxuICAgICAgICByZXR1cm4gUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgICAgIH0gY2F0Y2ggKGNyb3NzRmV0Y2hFcnJvcikge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbTWlzdHJhbEFwaUNsaWVudF0gY3Jvc3MtZmV0Y2ggbm90IGF2YWlsYWJsZSwgZmFsbGluZyBiYWNrIHRvIHJlZ3VsYXIgcmVxdWlyZScpO1xyXG5cclxuICAgICAgICAvLyBMYXN0IHJlc29ydDogdHJ5IHJlZ3VsYXIgcmVxdWlyZSBhbmQgaG9wZSBpdCB3b3Jrc1xyXG4gICAgICAgIGZldGNoTW9kdWxlID0gcmVxdWlyZSgnbm9kZS1mZXRjaCcpO1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCdbTWlzdHJhbEFwaUNsaWVudF0gbm9kZS1mZXRjaCBsb2FkZWQgc3VjY2Vzc2Z1bGx5IHZpYSByZXF1aXJlJyk7XHJcbiAgICAgICAgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgIGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsQXBpQ2xpZW50XSBBbGwgZmV0Y2ggbG9hZGluZyBtZXRob2RzIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICByZXR1cm4gUHJvbWlzZS5yZWplY3QoZXJyb3IpO1xyXG4gIH1cclxufTtcclxuXHJcbi8vIFN0YXJ0IGxvYWRpbmcgaW1tZWRpYXRlbHlcclxuY29uc3QgZmV0Y2hQcm9taXNlID0gaW5pdGlhbGl6ZUZldGNoKCk7XHJcblxyXG5jbGFzcyBNaXN0cmFsQXBpQ2xpZW50IHtcclxuICBjb25zdHJ1Y3Rvcihjb25maWcgPSB7fSkge1xyXG4gICAgdGhpcy5hcGlFbmRwb2ludCA9IGNvbmZpZy5hcGlFbmRwb2ludCB8fCBwcm9jZXNzLmVudi5NSVNUUkFMX0FQSV9FTkRQT0lOVCB8fCAnaHR0cHM6Ly9hcGkubWlzdHJhbC5haS92MS9vY3InO1xyXG4gICAgdGhpcy5hcGlLZXkgPSBjb25maWcuYXBpS2V5IHx8IHByb2Nlc3MuZW52Lk1JU1RSQUxfQVBJX0tFWTtcclxuICAgIHRoaXMuYmFzZVVybCA9ICdodHRwczovL2FwaS5taXN0cmFsLmFpL3YxJztcclxuICAgIHRoaXMuZmlsZVVwbG9hZFVybCA9IGAke3RoaXMuYmFzZVVybH0vZmlsZXNgO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2V0IEFQSSBrZXlcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gYXBpS2V5IC0gTWlzdHJhbCBBUEkga2V5XHJcbiAgICovXHJcbiAgc2V0QXBpS2V5KGFwaUtleSkge1xyXG4gICAgdGhpcy5hcGlLZXkgPSBhcGlLZXk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDaGVjayBpZiBBUEkgY2xpZW50IGlzIGNvbmZpZ3VyZWQgd2l0aCB2YWxpZCBBUEkga2V5XHJcbiAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgQVBJIGtleSBpcyBzZXRcclxuICAgKi9cclxuICBpc0NvbmZpZ3VyZWQoKSB7XHJcbiAgICByZXR1cm4gISF0aGlzLmFwaUtleTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEVuc3VyZSBmZXRjaCBpcyBhdmFpbGFibGUgYW5kIG1ha2UgcmVxdWVzdFxyXG4gICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBSZXF1ZXN0IFVSTFxyXG4gICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gUmVxdWVzdCBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8UmVzcG9uc2U+fSBGZXRjaCByZXNwb25zZVxyXG4gICAqL1xyXG4gIGFzeW5jIGZldGNoKHVybCwgb3B0aW9ucykge1xyXG4gICAgLy8gV2FpdCBmb3IgZmV0Y2ggdG8gYmUgbG9hZGVkIGlmIGl0J3Mgbm90IHJlYWR5IHlldFxyXG4gICAgaWYgKCFmZXRjaE1vZHVsZSkge1xyXG4gICAgICBhd2FpdCBmZXRjaFByb21pc2U7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gSGFuZGxlIGJvdGggQ29tbW9uSlMgYW5kIEVTTSBzdHlsZSBtb2R1bGVzXHJcbiAgICBpZiAoZmV0Y2hNb2R1bGUuZGVmYXVsdCkge1xyXG4gICAgICAvLyBFU00gc3R5bGUgbW9kdWxlXHJcbiAgICAgIHJldHVybiBmZXRjaE1vZHVsZS5kZWZhdWx0KHVybCwgb3B0aW9ucyk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBDb21tb25KUyBzdHlsZSBtb2R1bGVcclxuICAgICAgcmV0dXJuIGZldGNoTW9kdWxlKHVybCwgb3B0aW9ucyk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDaGVjayBpZiB0aGUgQVBJIGtleSBpcyB2YWxpZFxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IFZhbGlkYXRpb24gcmVzdWx0XHJcbiAgICovXHJcbiAgYXN5bmMgdmFsaWRhdGVBcGlLZXkoKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBpZiAoIXRoaXMuYXBpS2V5KSB7XHJcbiAgICAgICAgcmV0dXJuIHsgdmFsaWQ6IGZhbHNlLCBlcnJvcjogJ0FQSSBrZXkgbm90IGNvbmZpZ3VyZWQnIH07XHJcbiAgICAgIH1cclxuICAgICAgXHJcbiAgICAgIC8vIFVzZSB0aGUgbW9kZWxzIGVuZHBvaW50IHRvIGNoZWNrIGlmIHRoZSBBUEkga2V5IGlzIHZhbGlkXHJcbiAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5mZXRjaChgJHt0aGlzLmJhc2VVcmx9L21vZGVsc2AsIHtcclxuICAgICAgICBtZXRob2Q6ICdHRVQnLFxyXG4gICAgICAgIGhlYWRlcnM6IHtcclxuICAgICAgICAgICdBdXRob3JpemF0aW9uJzogYEJlYXJlciAke3RoaXMuYXBpS2V5fWAsXHJcbiAgICAgICAgICAnQ29udGVudC1UeXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nXHJcbiAgICAgICAgfVxyXG4gICAgICB9KTtcclxuICAgICAgXHJcbiAgICAgIGlmIChyZXNwb25zZS5vaykge1xyXG4gICAgICAgIHJldHVybiB7IHZhbGlkOiB0cnVlIH07XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgLy8gUmVhZCByZXNwb25zZSBhcyB0ZXh0IGZpcnN0IHRvIGF2b2lkIEpTT04gcGFyc2luZyBlcnJvcnMgd2l0aCBub24tSlNPTiBlcnJvciByZXNwb25zZXNcclxuICAgICAgICBjb25zdCByZXNwb25zZVRleHQgPSBhd2FpdCByZXNwb25zZS50ZXh0KCk7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcihgW01pc3RyYWxBcGlDbGllbnRdIEFQSSBrZXkgY2hlY2sgZXJyb3IgKCR7cmVzcG9uc2Uuc3RhdHVzfSk6ICR7cmVzcG9uc2VUZXh0LnN1YnN0cmluZygwLCA1MDApfWApO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIFRyeSB0byBwYXJzZSBhcyBKU09OIGlmIGl0IGxvb2tzIGxpa2UgSlNPTlxyXG4gICAgICAgIGxldCBlcnJvck1lc3NhZ2UgPSAnSW52YWxpZCBBUEkga2V5JztcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgaWYgKHJlc3BvbnNlVGV4dC50cmltKCkuc3RhcnRzV2l0aCgneycpKSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGVycm9ySnNvbiA9IEpTT04ucGFyc2UocmVzcG9uc2VUZXh0KTtcclxuICAgICAgICAgICAgaWYgKGVycm9ySnNvbi5lcnJvciAmJiBlcnJvckpzb24uZXJyb3IubWVzc2FnZSkge1xyXG4gICAgICAgICAgICAgIGVycm9yTWVzc2FnZSA9IGVycm9ySnNvbi5lcnJvci5tZXNzYWdlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAocGFyc2VFcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcignW01pc3RyYWxBcGlDbGllbnRdIENvdWxkIG5vdCBwYXJzZSBlcnJvciByZXNwb25zZSBhcyBKU09OOicsIHBhcnNlRXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiB7IHZhbGlkOiBmYWxzZSwgZXJyb3I6IGVycm9yTWVzc2FnZSB9O1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbTWlzdHJhbEFwaUNsaWVudF0gQVBJIGtleSBjaGVjayBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICByZXR1cm4geyB2YWxpZDogZmFsc2UsIGVycm9yOiBlcnJvci5tZXNzYWdlIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBVcGxvYWQgYSBmaWxlIHRvIE1pc3RyYWwgQVBJXHJcbiAgICogQHBhcmFtIHtCdWZmZXJ9IGZpbGVCdWZmZXIgLSBGaWxlIGNvbnRlbnQgYXMgYnVmZmVyXHJcbiAgICogQHBhcmFtIHtzdHJpbmd9IGZpbGVOYW1lIC0gRmlsZSBuYW1lXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gVXBsb2FkIHJlc3VsdCB3aXRoIGZpbGUgSURcclxuICAgKi9cclxuICBhc3luYyB1cGxvYWRGaWxlKGZpbGVCdWZmZXIsIGZpbGVOYW1lKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgW01pc3RyYWxBcGlDbGllbnRdIFVwbG9hZGluZyBmaWxlOiAke2ZpbGVOYW1lfWApO1xyXG4gICAgICBcclxuICAgICAgY29uc3QgZm9ybURhdGEgPSBuZXcgRm9ybURhdGEoKTtcclxuICAgICAgZm9ybURhdGEuYXBwZW5kKCdwdXJwb3NlJywgJ29jcicpO1xyXG4gICAgICBmb3JtRGF0YS5hcHBlbmQoJ2ZpbGUnLCBmaWxlQnVmZmVyLCBmaWxlTmFtZSk7XHJcblxyXG4gICAgICBjb25zdCB1cGxvYWRSZXNwb25zZSA9IGF3YWl0IHRoaXMuZmV0Y2godGhpcy5maWxlVXBsb2FkVXJsLCB7XHJcbiAgICAgICAgbWV0aG9kOiAnUE9TVCcsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7dGhpcy5hcGlLZXl9YCxcclxuICAgICAgICAgIC4uLmZvcm1EYXRhLmdldEhlYWRlcnMoKSAvLyBMZXQgRm9ybURhdGEgc2V0IHRoZSBDb250ZW50LVR5cGVcclxuICAgICAgICB9LFxyXG4gICAgICAgIGJvZHk6IGZvcm1EYXRhXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCF1cGxvYWRSZXNwb25zZS5vaykge1xyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlVGV4dCA9IGF3YWl0IHVwbG9hZFJlc3BvbnNlLnRleHQoKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBbTWlzdHJhbEFwaUNsaWVudF0gRmlsZSB1cGxvYWQgZmFpbGVkICgke3VwbG9hZFJlc3BvbnNlLnN0YXR1c30pOiAke3Jlc3BvbnNlVGV4dC5zdWJzdHJpbmcoMCwgNTAwKX1gKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3RyYWwgZmlsZSB1cGxvYWQgZmFpbGVkICgke3VwbG9hZFJlc3BvbnNlLnN0YXR1c30pOiAke3Jlc3BvbnNlVGV4dH1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgdXBsb2FkZWRGaWxlRGF0YSA9IGF3YWl0IHVwbG9hZFJlc3BvbnNlLmpzb24oKTtcclxuICAgICAgY29uc29sZS5sb2coYFtNaXN0cmFsQXBpQ2xpZW50XSBGaWxlIHVwbG9hZGVkIHN1Y2Nlc3NmdWxseS4gRmlsZSBJRDogJHt1cGxvYWRlZEZpbGVEYXRhLmlkfWApO1xyXG4gICAgICBcclxuICAgICAgcmV0dXJuIHVwbG9hZGVkRmlsZURhdGE7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbTWlzdHJhbEFwaUNsaWVudF0gRmlsZSB1cGxvYWQgZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZXQgc2lnbmVkIFVSTCBmb3IgYSBwcmV2aW91c2x5IHVwbG9hZGVkIGZpbGVcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZUlkIC0gRmlsZSBJRCBmcm9tIHVwbG9hZCByZXNwb25zZVxyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IFNpZ25lZCBVUkwgcmVzcG9uc2VcclxuICAgKi9cclxuICBhc3luYyBnZXRTaWduZWRVcmwoZmlsZUlkKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zb2xlLmxvZyhgW01pc3RyYWxBcGlDbGllbnRdIEdldHRpbmcgc2lnbmVkIFVSTCBmb3IgZmlsZSBJRDogJHtmaWxlSWR9YCk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCBzaWduZWRVcmxSZXNwb25zZSA9IGF3YWl0IHRoaXMuZmV0Y2goYCR7dGhpcy5maWxlVXBsb2FkVXJsfS8ke2ZpbGVJZH0vdXJsYCwge1xyXG4gICAgICAgIG1ldGhvZDogJ0dFVCcsXHJcbiAgICAgICAgaGVhZGVyczoge1xyXG4gICAgICAgICAgJ0F1dGhvcml6YXRpb24nOiBgQmVhcmVyICR7dGhpcy5hcGlLZXl9YCxcclxuICAgICAgICAgICdBY2NlcHQnOiAnYXBwbGljYXRpb24vanNvbidcclxuICAgICAgICB9XHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKCFzaWduZWRVcmxSZXNwb25zZS5vaykge1xyXG4gICAgICAgIGNvbnN0IHJlc3BvbnNlVGV4dCA9IGF3YWl0IHNpZ25lZFVybFJlc3BvbnNlLnRleHQoKTtcclxuICAgICAgICBjb25zb2xlLmVycm9yKGBbTWlzdHJhbEFwaUNsaWVudF0gR2V0IHNpZ25lZCBVUkwgZmFpbGVkICgke3NpZ25lZFVybFJlc3BvbnNlLnN0YXR1c30pOiAke3Jlc3BvbnNlVGV4dC5zdWJzdHJpbmcoMCwgNTAwKX1gKTtcclxuICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYE1pc3RyYWwgZ2V0IHNpZ25lZCBVUkwgZmFpbGVkICgke3NpZ25lZFVybFJlc3BvbnNlLnN0YXR1c30pOiAke3Jlc3BvbnNlVGV4dH1gKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3Qgc2lnbmVkVXJsRGF0YSA9IGF3YWl0IHNpZ25lZFVybFJlc3BvbnNlLmpzb24oKTtcclxuICAgICAgY29uc29sZS5sb2coYFtNaXN0cmFsQXBpQ2xpZW50XSBTaWduZWQgVVJMIG9idGFpbmVkYCk7XHJcbiAgICAgIFxyXG4gICAgICByZXR1cm4gc2lnbmVkVXJsRGF0YTtcclxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsQXBpQ2xpZW50XSBHZXQgc2lnbmVkIFVSTCBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFByb2Nlc3MgZG9jdW1lbnQgd2l0aCBPQ1IgdXNpbmcgdGhlIHByb3ZpZGVkIHNpZ25lZCBVUkxcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZG9jdW1lbnRVcmwgLSBTaWduZWQgVVJMIGZvciB0aGUgZG9jdW1lbnRcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIE9DUiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gT0NSIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIHByb2Nlc3NPY3IoZG9jdW1lbnRVcmwsIG9wdGlvbnMgPSB7fSkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coJ1tNaXN0cmFsQXBpQ2xpZW50XSBDYWxsaW5nIE9DUiBBUEkgd2l0aCBzaWduZWQgVVJMJyk7XHJcbiAgICAgIFxyXG4gICAgICBjb25zdCByZXF1ZXN0Qm9keSA9IHtcclxuICAgICAgICBtb2RlbDogb3B0aW9ucy5tb2RlbCB8fCBcIm1pc3RyYWwtb2NyLWxhdGVzdFwiLFxyXG4gICAgICAgIGRvY3VtZW50OiB7XHJcbiAgICAgICAgICB0eXBlOiBcImRvY3VtZW50X3VybFwiLFxyXG4gICAgICAgICAgZG9jdW1lbnRfdXJsOiBkb2N1bWVudFVybFxyXG4gICAgICAgIH0sXHJcbiAgICAgICAgaW5jbHVkZV9pbWFnZV9iYXNlNjQ6IGZhbHNlXHJcbiAgICAgIH07XHJcblxyXG4gICAgICBpZiAob3B0aW9ucy5sYW5ndWFnZSkge1xyXG4gICAgICAgIHJlcXVlc3RCb2R5Lmxhbmd1YWdlID0gb3B0aW9ucy5sYW5ndWFnZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3Qgb2NyUmVzcG9uc2UgPSBhd2FpdCB0aGlzLmZldGNoKHRoaXMuYXBpRW5kcG9pbnQsIHtcclxuICAgICAgICBtZXRob2Q6ICdQT1NUJyxcclxuICAgICAgICBoZWFkZXJzOiB7XHJcbiAgICAgICAgICAnQXV0aG9yaXphdGlvbic6IGBCZWFyZXIgJHt0aGlzLmFwaUtleX1gLFxyXG4gICAgICAgICAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJ1xyXG4gICAgICAgIH0sXHJcbiAgICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkocmVxdWVzdEJvZHkpXHJcbiAgICAgIH0pO1xyXG4gICAgICBcclxuICAgICAgaWYgKCFvY3JSZXNwb25zZS5vaykge1xyXG4gICAgICAgIC8vIFJlYWQgcmVzcG9uc2UgYXMgdGV4dCBmaXJzdCB0byBhdm9pZCBKU09OIHBhcnNpbmcgZXJyb3JzIHdpdGggbm9uLUpTT04gZXJyb3IgcmVzcG9uc2VzXHJcbiAgICAgICAgY29uc3QgcmVzcG9uc2VUZXh0ID0gYXdhaXQgb2NyUmVzcG9uc2UudGV4dCgpO1xyXG4gICAgICAgIGNvbnNvbGUuZXJyb3IoYFtNaXN0cmFsQXBpQ2xpZW50XSBPQ1IgQVBJIGVycm9yICgke29jclJlc3BvbnNlLnN0YXR1c30pOiAke3Jlc3BvbnNlVGV4dC5zdWJzdHJpbmcoMCwgNTAwKX1gKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBUcnkgdG8gcGFyc2UgYXMgSlNPTiBpZiBpdCBsb29rcyBsaWtlIEpTT05cclxuICAgICAgICBsZXQgZXJyb3JNZXNzYWdlID0gYE9DUiByZXF1ZXN0IGZhaWxlZCB3aXRoIHN0YXR1cyAke29jclJlc3BvbnNlLnN0YXR1c31gO1xyXG4gICAgICAgIGxldCBlcnJvckRldGFpbHMgPSByZXNwb25zZVRleHQ7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGlmIChyZXNwb25zZVRleHQudHJpbSgpLnN0YXJ0c1dpdGgoJ3snKSkge1xyXG4gICAgICAgICAgICBjb25zdCBlcnJvckpzb24gPSBKU09OLnBhcnNlKHJlc3BvbnNlVGV4dCk7XHJcbiAgICAgICAgICAgIGlmIChlcnJvckpzb24uZXJyb3IgJiYgZXJyb3JKc29uLmVycm9yLm1lc3NhZ2UpIHtcclxuICAgICAgICAgICAgICBlcnJvck1lc3NhZ2UgPSBlcnJvckpzb24uZXJyb3IubWVzc2FnZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTG9nIHRoZSBmdWxsIGVycm9yIG9iamVjdCBmb3IgZGVidWdnaW5nXHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tNaXN0cmFsQXBpQ2xpZW50XSBQYXJzZWQgZXJyb3IgcmVzcG9uc2U6JywgSlNPTi5zdHJpbmdpZnkoZXJyb3JKc29uLCBudWxsLCAyKSk7XHJcbiAgICAgICAgICAgIGVycm9yRGV0YWlscyA9IEpTT04uc3RyaW5naWZ5KGVycm9ySnNvbiwgbnVsbCwgMik7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAocGFyc2VFcnJvcikge1xyXG4gICAgICAgICAgY29uc29sZS5lcnJvcignW01pc3RyYWxBcGlDbGllbnRdIENvdWxkIG5vdCBwYXJzZSBlcnJvciByZXNwb25zZSBhcyBKU09OOicsIHBhcnNlRXJyb3IubWVzc2FnZSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEZvciA1MDAgZXJyb3JzLCBwcm92aWRlIG1vcmUgc3BlY2lmaWMgZ3VpZGFuY2VcclxuICAgICAgICBpZiAob2NyUmVzcG9uc2Uuc3RhdHVzID09PSA1MDApIHtcclxuICAgICAgICAgIGVycm9yTWVzc2FnZSA9IGBNaXN0cmFsIEFQSSBJbnRlcm5hbCBTZXJ2ZXIgRXJyb3IgKDUwMCk6ICR7ZXJyb3JNZXNzYWdlfS4gVGhpcyBtYXkgYmUgZHVlIHRvIGZpbGUgc2l6ZSBsaW1pdHMgKG1heCA1ME1CKSwgQVBJIHNlcnZpY2UgaXNzdWVzLCBvciByYXRlIGxpbWl0aW5nLmA7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHRocm93IG5ldyBFcnJvcihgTWlzdHJhbCBPQ1IgQVBJIGVycm9yICgke29jclJlc3BvbnNlLnN0YXR1c30pOiAke2Vycm9yTWVzc2FnZX1gKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgb2NyUmVzcG9uc2UuanNvbigpO1xyXG4gICAgICBjb25zb2xlLmxvZygnW01pc3RyYWxBcGlDbGllbnRdIE9DUiBwcm9jZXNzaW5nIGNvbXBsZXRlZCBzdWNjZXNzZnVsbHknKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbTWlzdHJhbEFwaUNsaWVudF0gT0NSIHByb2Nlc3NpbmcgZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDb21wbGV0ZSBPQ1Igd29ya2Zsb3c6IFVwbG9hZCBmaWxlLCBnZXQgc2lnbmVkIFVSTCwgYW5kIHByb2Nlc3Mgd2l0aCBPQ1JcclxuICAgKiBAcGFyYW0ge0J1ZmZlcn0gZmlsZUJ1ZmZlciAtIEZpbGUgY29udGVudCBhcyBidWZmZXJcclxuICAgKiBAcGFyYW0ge3N0cmluZ30gZmlsZU5hbWUgLSBGaWxlIG5hbWVcclxuICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIE9DUiBvcHRpb25zXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gT0NSIHJlc3VsdFxyXG4gICAqL1xyXG4gIGFzeW5jIHByb2Nlc3NEb2N1bWVudChmaWxlQnVmZmVyLCBmaWxlTmFtZSwgb3B0aW9ucyA9IHt9KSB7XHJcbiAgICB0cnkge1xyXG4gICAgICAvLyBVcGxvYWQgZmlsZVxyXG4gICAgICBjb25zdCB1cGxvYWRSZXN1bHQgPSBhd2FpdCB0aGlzLnVwbG9hZEZpbGUoZmlsZUJ1ZmZlciwgZmlsZU5hbWUpO1xyXG4gICAgICBcclxuICAgICAgLy8gR2V0IHNpZ25lZCBVUkxcclxuICAgICAgY29uc3Qgc2lnbmVkVXJsUmVzdWx0ID0gYXdhaXQgdGhpcy5nZXRTaWduZWRVcmwodXBsb2FkUmVzdWx0LmlkKTtcclxuICAgICAgXHJcbiAgICAgIC8vIFByb2Nlc3MgT0NSXHJcbiAgICAgIGNvbnN0IG9jclJlc3VsdCA9IGF3YWl0IHRoaXMucHJvY2Vzc09jcihzaWduZWRVcmxSZXN1bHQudXJsLCBvcHRpb25zKTtcclxuICAgICAgXHJcbiAgICAgIHJldHVybiBvY3JSZXN1bHQ7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zb2xlLmVycm9yKCdbTWlzdHJhbEFwaUNsaWVudF0gRG9jdW1lbnQgcHJvY2Vzc2luZyB3b3JrZmxvdyBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICB0aHJvdyBlcnJvcjtcclxuICAgIH1cclxuICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gTWlz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