/**
 * Parent URL Converter Adapter
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const PageMarkerService = require('../services/PageMarkerService');
const BrowserService = require('../services/BrowserService');

async function loadParentUrlConverter() {
  try {
    const parentUrlConverterPath = path.resolve(__dirname, '../../../backend/src/services/converter/web/parentUrlConverter.js');
    
    if (!fs.existsSync(parentUrlConverterPath)) {
      throw new Error(`Parent URL converter module not found at: ${parentUrlConverterPath}`);
    }
    
    const fileUrl = pathToFileURL(parentUrlConverterPath).href;
    console.log('Loading parent URL converter from:', fileUrl);
    
    const { convertParentUrlToMarkdown } = await import(fileUrl);
    return { convertParentUrlToMarkdown };
  } catch (error) {
    console.error('Failed to load parent URL converter module:', error);
    throw error;
  }
}

const modulePromise = loadParentUrlConverter();

/**
 * Adapts the backend parent URL converter for use in Electron
 */
async function convertParentUrl(url, options = {}) {
  try {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      url = 'https://' + url;
    }
    
    // Define common encodings and formats
    const acceptEncodings = 'gzip, deflate, br';
    const acceptFormats = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8';
    const acceptLanguage = 'en-US,en;q=0.9';
    
    // Standard browser-like headers
    const defaultHeaders = {
      'accept': acceptFormats,
      'accept-encoding': acceptEncodings,
      'accept-language': acceptLanguage,
      'cache-control': 'no-cache',
      'dnt': '1',
      'pragma': 'no-cache',
      'sec-ch-ua': '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'document',
      'sec-fetch-mode': 'navigate',
      'sec-fetch-site': 'none',
      'sec-fetch-user': '?1',
      'upgrade-insecure-requests': '1',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
    };
    
    const defaultOptions = {
      concurrentLimit: 30,
      waitBetweenRequests: 500,
      maxDepth: 3,
      maxPages: 100,
      includeImages: true,
      includeMeta: true,
      handleDynamicContent: true,
      got: {
        headers: defaultHeaders,
        timeout: {
          lookup: 3000,    // DNS lookup timeout
          connect: 5000,   // TCP connection timeout
          secureConnect: 5000, // TLS handshake timeout
          socket: 30000,   // Socket inactivity timeout
          send: 30000,     // Time to send request
          response: 30000  // Time to receive response headers
        },
        retry: {
          limit: 3,
          methods: ['GET', 'HEAD'],
          statusCodes: [408, 413, 429, 500, 502, 503, 504, 520, 521, 522, 523, 524],
          errorCodes: [
            'ETIMEDOUT',
            'ECONNRESET',
            'EADDRINUSE',
            'ECONNREFUSED',
            'EPIPE',
            'ENOTFOUND',
            'ENETUNREACH',
            'EAI_AGAIN'
          ]
        },
        hooks: {
          beforeRequest: [
            // Add random delay between requests
            async options => {
              const delay = Math.floor(Math.random() * 1000) + 500; // 500-1500ms
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          ]
        },
        decompress: true,
        responseType: 'text',
        followRedirect: true,
        throwHttpErrors: false,
        searchParams: new URLSearchParams({
          '_': Date.now().toString()
        })
      }
    };
    
    // Deep merge options
    const mergedOptions = {
      ...defaultOptions,
      ...options,
      got: {
        ...(defaultOptions.got || {}),
        ...(options.got || {}),
        headers: {
          ...(defaultOptions.got?.headers || {}),
          ...(options.got?.headers || {}),
        },
        retry: {
          ...(defaultOptions.got?.retry || {}),
          ...(options.got?.retry || {})
        },
        timeout: {
          ...(defaultOptions.got?.timeout || {}),
          ...(options.got?.timeout || {})
        },
        hooks: {
          beforeRequest: [
            ...(defaultOptions.got?.hooks?.beforeRequest || []),
            ...(options.got?.hooks?.beforeRequest || [])
          ]
        }
      }
    };
    
    const { convertParentUrlToMarkdown } = await modulePromise;
    
    console.log(`🔄 Converting parent URL with enhanced options: ${url}`);
    console.log(`📊 Using concurrent limit: ${mergedOptions.concurrentLimit}`);
    console.log(`⏱️ Using wait between requests: ${mergedOptions.waitBetweenRequests}ms`);
    
    // Get the browser instance from BrowserService
    try {
      const browser = await BrowserService.getBrowser();
      
      // Add the browser instance to the options
      mergedOptions.browser = browser;
      
      console.log('Using shared browser instance for parent URL conversion');
    } catch (error) {
      console.warn('Failed to get shared browser instance, will create a new one:', error.message);
      // Continue without shared browser - the converter will create its own
    }
    
    const result = await convertParentUrlToMarkdown(url, mergedOptions);
    
    // Return the result with metadata properly structured
    return {
      content: result.content,
      success: true,
      name: result.name,
      files: result.files,
      stats: result.stats,
      url: result.url,
      type: 'parenturl',
      metadata: result.metadata || {}
    };
  } catch (error) {
    console.error('Parent URL conversion failed in adapter:', error);
    return {
      success: false,
      error: error.message || 'Parent URL conversion failed',
      url,
      type: 'parenturl',
      stats: {
        totalPages: 0,
        successfulPages: 0,
        failedPages: 1,
        totalImages: 0
      }
    };
  }
}

module.exports = {
  convertParentUrl
};
