// src/lib/api/requestHandler.js

import { CONFIG } from '../config';
import { ConversionError, ErrorUtils } from './errors.js';

/**
 * Types of responses the handler can process
 * @enum {string}
 */
const ResponseTypes = {
  JSON: 'json',
  BLOB: 'blob',
  TEXT: 'text'
};

/**
 * Default request configuration
 */
const DEFAULT_CONFIG = {
  mode: 'cors',
  headers: {
    'Accept': 'application/json, application/zip, application/octet-stream'
  },
  keepalive: true
};

/**
 * Handles all API requests with consistent error handling and retries
 */
export class RequestHandler {
  /**
   * Logs request details for debugging
   * @private 
   */
  static _logRequest(endpoint, options) {
    try {
      const requestInfo = {
        endpoint,
        method: options.method,
        headers: options.headers,
      };

      // Safely log FormData contents
      if (options.body instanceof FormData) {
        const formDataEntries = {};
        for (let pair of options.body.entries()) {
          if (pair[0] === 'file') {
            formDataEntries[pair[0]] = {
              name: pair[1].name,
              type: pair[1].type,
              size: pair[1].size
            };
          } else {
            formDataEntries[pair[0]] = pair[1];
          }
        }
        requestInfo.formData = formDataEntries;
      } else if (typeof options.body === 'string') {
        try {
          requestInfo.body = JSON.parse(options.body);
        } catch {
          requestInfo.body = options.body;
        }
      }

      console.log('🚀 Request Details:', requestInfo);
    } catch (error) {
      console.error('Error logging request:', error);
    }
  }

  /**
   * Logs response details for debugging
   * @private
   */
  static _logResponse(response, data) {
    try {
      const responseInfo = {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
        url: response.url
      };

      if (data instanceof Blob) {
        responseInfo.data = {
          type: data.type,
          size: data.size
        };
      } else {
        responseInfo.data = data;
      }

      console.log('📥 Response:', responseInfo);
    } catch (error) {
      console.error('Error logging response:', error);
    }
  }

  /**
   * Determines response type based on content headers
   * @private
   */
  static _getResponseType(contentType) {
    if (!contentType) return ResponseTypes.TEXT;
    if (contentType.includes('application/json')) return ResponseTypes.JSON;
    if (contentType.includes('application/zip') ||
        contentType.includes('application/octet-stream')) return ResponseTypes.BLOB;
    return ResponseTypes.TEXT;
  }

  /**
   * Makes an API request with retry logic
   * @public
   */
  static async makeRequest(endpoint, options) {
    try {
      const requestOptions = {
        method: options.method || 'POST',
        mode: 'cors',
        headers: { ...options.headers },
        body: options.body,
        signal: options.signal,
        keepalive: true
      };

      // Validate request body exists for POST requests
      if (requestOptions.method === 'POST' && !requestOptions.body) {
        throw new ConversionError('Request body is required for POST requests', 'VALIDATION_ERROR');
      }

      // Handle FormData specifically
      if (options.body instanceof FormData) {
        delete requestOptions.headers['Content-Type'];
        
        // Validate FormData contents for file uploads
        const fileEntry = Array.from(options.body.entries())
          .find(entry => entry[0] === 'file' && entry[1] instanceof File);
        
        if (!fileEntry) {
          throw new ConversionError('File data is missing from FormData', 'VALIDATION_ERROR');
        }
      } else if (!(options.body instanceof Blob)) {
        requestOptions.headers['Content-Type'] = 'application/json';
      }

      this._logRequest(endpoint, requestOptions);
      
      console.log('🚀 Making request to:', endpoint);
      const response = await fetch(endpoint, requestOptions);
      console.log('📦 Response received:', {
        status: response.status,
        contentType: response.headers.get('Content-Type'),
        url: response.url
      });
      
      return await RequestHandler._handleResponse(response);
    } catch (error) {
      console.error('🔥 Request failed:', {
        error: error.message,
        stack: error.stack,
        endpoint
      });

      // Convert fetch errors to ConversionError
      if (error.name === 'TypeError' && error.message === 'Failed to fetch') {
        throw new ConversionError(
          'Network error - please check your connection',
          'NETWORK_ERROR'
        );
      }

      throw error;
    }
  }

  /**
   * Handles different types of API responses
   * @private
   */
  static async _handleResponse(response) {
    const responseForError = response.clone();
    const contentType = response.headers.get('Content-Type') || '';
    const responseType = this._getResponseType(contentType);

    if (!response.ok) {
      const errorText = await responseForError.text();
      console.error('❌ Error Response:', {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        body: errorText,
        url: response.url
      });

      const errorData = this._parseErrorResponse(errorText, response.status);
      
      if (errorData.status === 'error' && errorData.error) {
        throw new ConversionError(
          errorData.error.message || 'Unknown server error',
          errorData.error.code || 'API_ERROR',
          errorData.error.details
        );
      }

      throw new ConversionError(
        errorData.message || `Request failed with status ${response.status}`,
        'API_ERROR',
        errorData
      );
    }

    let data;
    console.log('🔍 Processing response of type:', responseType);
    
    const isDownloadable = response.headers.get('Content-Disposition')?.includes('attachment') ||
                          response.headers.get('Content-Type')?.includes('application/zip') ||
                          responseType === ResponseTypes.BLOB;

    try {
      if (isDownloadable) {
        console.log('📦 Processing as downloadable content');
        data = await response.blob();
        console.log('📦 Blob created:', {
          size: data.size,
          type: data.type
        });
      } else {
        switch (responseType) {
          case ResponseTypes.JSON:
            console.log('📋 Processing JSON response...');
            data = await response.json();
            
            // Log the actual response structure for debugging
            console.log('📦 Response data structure:', JSON.stringify(data, null, 2));
            
            // Consider a response successful if it has downloadUrl, jobId, or explicitly has success=true
            const hasSuccessIndicators = data.success === true || 
                                        data.downloadUrl || 
                                        data.jobId ||
                                        (data.status === 'success') ||
                                        (data.status === 'completed');
            
            if (!hasSuccessIndicators && !this._isImplicitlySuccessful(data)) {
              console.log('❌ Response lacks success indicators:', data);
              throw ConversionError.fromResponse(data);
            } else {
              console.log('✅ Response considered successful:', data);
            }
            break;
          default:
            console.log('📝 Processing text response...');
            data = await response.text();
        }
      }

      this._logResponse(response, data);
      return data;
    } catch (error) {
      console.error('Error processing response:', error);
      throw new ConversionError(
        'Failed to process server response',
        'RESPONSE_ERROR',
        { originalError: error.message }
      );
    }
  }

  /**
   * Checks if a response is implicitly successful based on its content
   * @private
   */
  static _isImplicitlySuccessful(data) {
    // Check for common success indicators in the response
    if (!data || typeof data !== 'object') return false;
    
    // Check for job ID as a success indicator
    if (data.jobId) return true;
    
    // Check for job completion indicators
    if (data.jobId && (data.downloadUrl || data.result)) return true;
    
    // Check for conversion completion
    if (data.downloadUrl) return true;
    
    // Check for other positive indicators
    const positiveKeys = ['result', 'data', 'content', 'files', 'converted'];
    return positiveKeys.some(key => data[key] !== undefined);
  }

  /**
   * Parses error responses
   * @private
   */
  static _parseErrorResponse(errorText, status) {
    try {
      return JSON.parse(errorText);
    } catch {
      return {
        message: errorText || `HTTP error ${status}`,
        status
      };
    }
  }
}

// Export utility functions
export const makeRequest = RequestHandler.makeRequest.bind(RequestHandler);
