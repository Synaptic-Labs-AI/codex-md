// src/lib/api/converters.js

// Update import to use root config
import { CONFIG } from '../config';
import { ConversionError, ErrorUtils } from './errors.js';
import { RequestHandler } from './requestHandler.js';
import { ENDPOINTS } from './endpoints.js';

/**
 * Default conversion options
 */
const DEFAULT_OPTIONS = {
  includeImages: true,
  includeMeta: true,
  convertLinks: true
};

/**
 * Handles different types of content conversion
 */
export class Converters {
  /**
   * Creates headers for API requests with standard options
   * @private
   */
  static _createHeaders(apiKey) {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'Accept': 'application/json'
    };
  }

  /**
   * Validates and normalizes URL input
   * @private
   */
  static _normalizeUrl(url) {
    if (!url || typeof url !== 'string') {
      throw ConversionError.validation('URL is required');
    }

    const trimmed = url.trim().replace(/\s+/g, '');
    if (!trimmed) {
      throw ConversionError.validation('URL is required');
    }

    try {
      const normalizedUrl = !/^https?:\/\//i.test(trimmed) ?
        `https://${trimmed}` : trimmed;
      new URL(normalizedUrl); // Validate URL format
      return normalizedUrl;
    } catch (error) {
      throw ConversionError.validation('Invalid URL format');
    }
  }

  /**
   * Prepares conversion request with standard options
   * @private
   */
  static _prepareRequest(input, type, apiKey) {
    if (!input?.url) {
      throw ConversionError.validation(`${type} URL is required`);
    }

    const normalizedUrl = this._normalizeUrl(input.url);
    const requestBody = {
      url: normalizedUrl,
      type: type.toLowerCase(),
      name: input.name?.trim() || 'Untitled',
      options: {
        ...DEFAULT_OPTIONS,
        ...input.options
      }
    };

    console.log(`🔄 Converting ${type}:`, { input, requestBody });

    return {
      method: 'POST',
      headers: this._createHeaders(apiKey),
      body: JSON.stringify(requestBody)
    };
  }

  /**
   * Makes conversion request with error handling
   * @private
   */
  static async _makeConversionRequest(endpoint, options, type) {
    if (!endpoint) {
      throw new ConversionError(`No endpoint defined for ${type} conversion`, 'VALIDATION_ERROR');
    }
    
    try {
      console.log(`🔄 Making ${type} conversion request to ${endpoint}`);
      return await RequestHandler.makeRequest(endpoint, options);
    } catch (error) {
      console.error(`❌ ${type} conversion error:`, error);
      throw ErrorUtils.wrap(error);
    }
  }

  /**
   * Converts a URL to markdown
   * @public
   */
  static async convertUrl(input, apiKey) {
    const options = this._prepareRequest(input, 'url', apiKey);
    return this._makeConversionRequest(ENDPOINTS.CONVERT_URL, options, 'URL');
  }

  /**
   * Converts URLs in batch
   * @public
   */
  static async convertBatch(items, apiKey) {
    if (!Array.isArray(items) || items.length === 0) {
      throw ConversionError.validation('Items must be an array');
    }

    const batchItems = items.map(item => ({
      type: item.type.toLowerCase(),
      url: item.url ? this._normalizeUrl(item.url) : null,
      name: item.name?.trim() || 'Untitled',
      options: {
        ...DEFAULT_OPTIONS,
        ...item.options
      }
    }));

    console.log('🔄 Converting batch:', { items: batchItems });

    const options = {
      method: 'POST',
      headers: this._createHeaders(apiKey),
      body: JSON.stringify({ items: batchItems })
    };

    return this._makeConversionRequest(ENDPOINTS.CONVERT_BATCH, options, 'Batch');
  }

  /**
   * Converts a parent URL and its linked pages
   * @public
   */
  static async convertParentUrl(input, apiKey) {
    if (!input?.url) {
      throw ConversionError.validation('Parent URL is required');
    }

    const normalizedUrl = this._normalizeUrl(input.url);
    
    // Structure specifically for parent URL endpoint
    const requestBody = {
      parenturl: normalizedUrl,
      options: {
        maxDepth: input.options?.depth || input.options?.maxDepth || 3,
        maxPages: input.options?.maxPages || 100,
        includeImages: input.options?.includeImages ?? true,
        includeMeta: input.options?.includeMeta ?? true,
        convertLinks: input.options?.convertLinks ?? true
      }
    };

    const options = {
      method: 'POST',
      headers: this._createHeaders(apiKey),
      body: JSON.stringify(requestBody)
    };

    console.log('🔄 Converting Parent URL:', { requestBody });
    return this._makeConversionRequest(ENDPOINTS.CONVERT_PARENT_URL, options, 'Parent URL');
  }

  /**
   * Converts a file
   * @public
   */
  static async convertFile(input, apiKey) {
    if (!input.content) {
        throw new ConversionError('File content is required for conversion', 'VALIDATION_ERROR');
    }

    // Create FormData for file upload
    const formData = new FormData();
    
    // Convert base64 to blob
    const byteCharacters = atob(input.content);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
        byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    const blob = new Blob([byteArray], { type: 'application/pdf' }); // Adjust MIME type as needed

    // Append file and metadata
    formData.append('file', blob, input.name); // Ensure 'file' field is used
    formData.append('options', JSON.stringify({
        ...DEFAULT_OPTIONS,
        ...input.options
    }));

    const options = {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            // Don't set Content-Type, let browser set it with boundary
        },
        body: formData
    };

    try {
        const result = await this._makeConversionRequest(ENDPOINTS.CONVERT_FILE, options, 'File');
        if (!(result instanceof Blob)) {
            throw new ConversionError('Invalid response format received from server');
        }
        return result;
    } catch (error) {
        console.error('File conversion failed:', error);
        throw error;
    }
  }
}

// Export conversion methods
export const {
  convertUrl,
  convertBatch,
  convertParentUrl
} = Converters;
