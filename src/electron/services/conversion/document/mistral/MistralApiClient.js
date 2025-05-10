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
        return { valid: false, error: 'API key not configured' };
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
        return { valid: true };
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
        
        return { valid: false, error: errorMessage };
      }
    } catch (error) {
      console.error('[MistralApiClient] API key check failed:', error);
      return { valid: false, error: error.message };
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