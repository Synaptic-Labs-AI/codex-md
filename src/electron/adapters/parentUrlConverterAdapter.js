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
    
    // Import the entire module to access all exports
    const parentUrlConverterModule = await import(fileUrl);
    console.log('Parent URL converter module loaded, available exports:', Object.keys(parentUrlConverterModule));
    
    // Try to get the convertParentUrlToMarkdown function first
    if (typeof parentUrlConverterModule.convertParentUrlToMarkdown === 'function') {
      console.log('Found convertParentUrlToMarkdown function');
      return { convertParentUrlToMarkdown: parentUrlConverterModule.convertParentUrlToMarkdown };
    }
    
    // If not found, try to get other exports
    if (parentUrlConverterModule.parentUrlConverter && typeof parentUrlConverterModule.parentUrlConverter.convertToMarkdown === 'function') {
      console.log('Found parentUrlConverter.convertToMarkdown method');
      return { 
        convertParentUrlToMarkdown: (url, options) => parentUrlConverterModule.parentUrlConverter.convertToMarkdown(url, options) 
      };
    }
    
    // If still not found, try to use a class if available
    if (parentUrlConverterModule.ParentUrlConverter) {
      console.log('Found ParentUrlConverter class');
      return {
        convertParentUrlToMarkdown: (url, options) => {
          const converter = new parentUrlConverterModule.ParentUrlConverter();
          return converter.convertToMarkdown(url, options);
        }
      };
    }
    
    throw new Error('Could not find any Parent URL converter implementation in the module');
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
      useSitemap: true, // Enable sitemap parsing by default
      sitemapUrl: null, // Optional explicit sitemap URL
      pathFilter: null, // Optional path filter to restrict crawling to specific paths
      sitemap: {
        maxEntries: 1000, // Maximum number of URLs to process from sitemap
        timeout: 30000, // Timeout for sitemap requests
        maxDepth: 3 // Maximum depth for nested sitemaps
      },
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
    
    // Add enhanced progress tracking for website conversion
    if (options.onProgress) {
      const originalOnProgress = options.onProgress;
      
      // Create a wrapper for the onProgress callback that adds website-specific status information
      mergedOptions.onProgress = (progressData) => {
        // If progressData is a simple number, just pass it through
        if (typeof progressData === 'number') {
          console.log('[ParentUrlAdapter] Received numeric progress:', progressData);
          originalOnProgress(progressData);
          return;
        }
        
      // For object-based progress updates, enhance with website-specific status
        if (typeof progressData === 'object') {
          console.log('[ParentUrlAdapter] Received progress update:', {
            type: 'incoming',
            status: progressData.status,
            data: progressData,
            timestamp: new Date().toISOString()
          });
          
          // Create base progress object
          const progressUpdate = {
            websiteUrl: progressData.websiteUrl || url,
            progress: progressData.progress || 0
          };

          // Handle different status types
          switch (progressData.status) {
            case 'initializing':
              const initUpdate = {
                ...progressUpdate,
                status: 'initializing',
                startTime: progressData.startTime
              };
              console.log('[ParentUrlAdapter] Sending initializing status:', initUpdate);
              originalOnProgress(initUpdate);
              break;

            case 'finding_sitemap':
              const sitemapUpdate = {
                ...progressUpdate,
                status: 'finding_sitemap',
                pathFilter: progressData.pathFilter || options.pathFilter
              };
              console.log('[ParentUrlAdapter] Sending finding_sitemap status:', sitemapUpdate);
              originalOnProgress(sitemapUpdate);
              break;

            case 'parsing_sitemap':
              const parsingUpdate = {
                ...progressUpdate,
                status: 'parsing_sitemap',
                urlCount: progressData.urlCount || 0
              };
              console.log('[ParentUrlAdapter] Sending parsing_sitemap status:', parsingUpdate);
              originalOnProgress(parsingUpdate);
              break;

            case 'sitemap_found':
              const foundUpdate = {
                ...progressUpdate,
                status: 'parsing_sitemap',
                pathFilter: progressData.pathFilter || options.pathFilter,
                sitemapUrls: progressData.urlCount || 0
              };
              console.log('[ParentUrlAdapter] Sending sitemap_found status:', foundUpdate);
              originalOnProgress(foundUpdate);
              break;

            case 'crawling':
              const crawlingUpdate = {
                ...progressUpdate,
                status: 'crawling_pages',
                crawledUrls: progressData.urlCount || 0
              };
              console.log('[ParentUrlAdapter] Sending crawling status:', crawlingUpdate);
              originalOnProgress(crawlingUpdate);
              break;

            case 'processing':
              const processingUpdate = {
                ...progressUpdate,
                status: 'processing_pages',
                currentFile: progressData.currentUrl,
                processedCount: progressData.processedCount || 0,
                totalCount: progressData.totalCount || 0
              };
              console.log('[ParentUrlAdapter] Sending processing status:', processingUpdate);
              originalOnProgress(processingUpdate);
              break;

            case 'section':
              // Keep existing status but update section info
              const sectionUpdate = {
                ...progressUpdate,
                currentSection: progressData.section,
                sectionCounts: { [progressData.section]: progressData.count || 1 },
                status: 'processing_pages' // Keep processing status while updating sections
              };
              console.log('[ParentUrlAdapter] Sending section update:', sectionUpdate);
              originalOnProgress(sectionUpdate);
              break;

            case 'generating_index':
              const indexUpdate = {
                ...progressUpdate,
                status: 'generating_index',
                processedCount: progressData.processedCount || 0,
                totalCount: progressData.totalCount || 0
              };
              console.log('[ParentUrlAdapter] Sending generating_index status:', indexUpdate);
              originalOnProgress(indexUpdate);
              break;

            default:
              console.log('Adapter: Passing through status:', progressData.status);
              originalOnProgress(progressData);
          }
        }
        else {
          // For any other type of progress data, just pass it through
          originalOnProgress(progressData);
        }
      };
    }
    
    const { convertParentUrlToMarkdown } = await modulePromise;
    
    console.log(`🔄 [parentUrlConverterAdapter] Converting parent URL: ${url}`);
    console.log(`📊 [parentUrlConverterAdapter] Using concurrent limit: ${mergedOptions.concurrentLimit}`);
    console.log(`⏱️ [parentUrlConverterAdapter] Using wait between requests: ${mergedOptions.waitBetweenRequests}ms`);
    
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
    
    try {
      const result = await convertParentUrlToMarkdown(url, mergedOptions);
      
      console.log(`✅ [parentUrlConverterAdapter] Parent URL conversion successful`);
      
      if (!result) {
        throw new Error('Parent URL converter returned null or undefined result');
      }
      
      if (!result.content) {
        console.warn(`⚠️ [parentUrlConverterAdapter] Parent URL converter returned empty content`);
      }
      
      // Return the result with metadata properly structured
      return {
        content: result.content || `# Conversion Error\n\nFailed to extract content from ${url}`,
        success: !!result.content,
        name: result.name || url.replace(/^https?:\/\//, '').replace(/[^\w\d]/g, '-'),
        files: result.files || [],
        stats: result.stats || {
          totalPages: 0,
          successfulPages: 0,
          failedPages: 0,
          totalImages: 0
        },
        url: result.url || url,
        type: 'parenturl',
        metadata: result.metadata || { source: url }
      };
    } catch (conversionError) {
      console.error(`❌ [parentUrlConverterAdapter] Error during parent URL conversion:`, conversionError);
      throw conversionError;
    }
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
