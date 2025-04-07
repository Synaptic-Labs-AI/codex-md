/**
 * URL Converter Configuration Module
 * 
 * This module provides simplified configuration settings for the URL converter.
 * It includes basic constants and settings used by the other utility modules.
 */

/**
 * Default HTTP request options
 */
export const DEFAULT_HTTP_OPTIONS = {
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.5',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache'
  },
  timeout: 30000,
  retry: 2,
  decompress: true,
  responseType: 'text'
};

/**
 * Wait times for content loading (in milliseconds)
 */
export const WAIT_TIMES = [500, 1000, 2000, 3000];

/**
 * Supported image extensions
 */
export const IMAGE_EXTENSIONS = [
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.svg',
  '.bmp',
  '.avif'
];

/**
 * Default URL converter options
 */
export const DEFAULT_URL_CONVERTER_OPTIONS = {
  http: { ...DEFAULT_HTTP_OPTIONS },
  includeImages: true,
  includeMeta: true,
  handleDynamicContent: true,
  maxDepth: 1,
  maxPages: 10,
  followLinks: false,
  linkSelector: 'a[href]',
  sameHostOnly: true,
  includeOriginalUrl: true,
  timeout: 60000, // Overall timeout for the entire conversion process
  retryDelay: 1000,
  maxRetries: 3,
  // Minimum content length to consider valid (characters)
  minContentLength: 100,
  // Image handling options
  images: {
    // Common image query parameters to preserve
    validQueryParams: [
      'width',
      'height',
      'w',
      'h',
      'size',
      'resize',
      'fit',
      'quality',
      'format',
      'auto',
      'name'
    ]
  }
};

/**
 * Default parent URL converter options
 */
export const DEFAULT_PARENT_URL_CONVERTER_OPTIONS = {
  ...DEFAULT_URL_CONVERTER_OPTIONS,
  followLinks: true,
  maxDepth: 2,
  maxPages: 20,
  linkSelector: 'a[href]:not([href^="#"]):not([href^="javascript:"]):not([href$=".pdf"]):not([href$=".zip"])',
  sameHostOnly: true,
  includeOriginalUrl: true,
  skipDuplicateContent: true,
  contentSimilarityThreshold: 0.8, // Skip pages with content similarity above this threshold
  skipUrlPatterns: [
    /\/login\//i,
    /\/signup\//i,
    /\/register\//i,
    /\/account\//i,
    /\/cart\//i,
    /\/checkout\//i,
    /\/privacy\//i,
    /\/terms\//i,
    /\/contact\//i,
    /\/about\//i,
    /\/search\//i,
    /\/tag\//i,
    /\/category\//i,
    /\/author\//i,
    /\/date\//i,
    /\/page\/\d+/i,
    /\?page=\d+/i,
    /\?p=\d+/i
  ]
};

export default {
  DEFAULT_HTTP_OPTIONS,
  WAIT_TIMES,
  IMAGE_EXTENSIONS,
  DEFAULT_URL_CONVERTER_OPTIONS,
  DEFAULT_PARENT_URL_CONVERTER_OPTIONS
};
