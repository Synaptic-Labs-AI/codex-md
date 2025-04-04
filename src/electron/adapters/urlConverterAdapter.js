/**
 * URL Converter Adapter
 */

const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const BrowserService = require('../services/BrowserService');

async function loadUrlConverter() {
  try {
    const urlConverterPath = path.resolve(__dirname, '../../../backend/src/services/converter/web/urlConverter.js');
    
    if (!fs.existsSync(urlConverterPath)) {
      throw new Error(`URL converter module not found at: ${urlConverterPath}`);
    }
    
    const fileUrl = pathToFileURL(urlConverterPath).href;
    console.log('Loading URL converter from:', fileUrl);
    
    // Import the entire module to access all exports
    const urlConverterModule = await import(fileUrl);
    console.log('URL converter module loaded, available exports:', Object.keys(urlConverterModule));
    
    // Try to get the convertUrlToMarkdown function first
    if (typeof urlConverterModule.convertUrlToMarkdown === 'function') {
      console.log('Found convertUrlToMarkdown function');
      return { convertUrlToMarkdown: urlConverterModule.convertUrlToMarkdown };
    }
    
    // If not found, try to get the urlConverter singleton
    if (urlConverterModule.urlConverter && typeof urlConverterModule.urlConverter.convertToMarkdown === 'function') {
      console.log('Found urlConverter.convertToMarkdown method');
      return { 
        convertUrlToMarkdown: (url, options) => urlConverterModule.urlConverter.convertToMarkdown(url, options) 
      };
    }
    
    // If still not found, try to use the UrlConverter class
    if (urlConverterModule.UrlConverter) {
      console.log('Found UrlConverter class');
      return {
        convertUrlToMarkdown: (url, options) => {
          const converter = new urlConverterModule.UrlConverter();
          return converter.convertToMarkdown(url, options);
        }
      };
    }
    
    throw new Error('Could not find any URL converter implementation in the module');
  } catch (error) {
    console.error('Failed to load URL converter module:', error);
    throw error;
  }
}

/**
 * Delay helper that works with Puppeteer page
 */
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Default options with modern browser settings
 */
const defaultOptions = {
  includeImages: true,
  includeMeta: true,
  handleDynamicContent: true,
  waitForContent: true,
  maxWaitTime: 45000,
  got: {
    headers: {
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'accept-language': 'en-US,en;q=0.9',
      'cache-control': 'no-cache',
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
    },
    timeout: 30000,
    retry: {
      limit: 2,
      methods: ['GET'],
      statusCodes: [408, 429, 500, 502, 503, 504]
    }
  }
};

/**
 * Load the URL converter module
 */
const modulePromise = loadUrlConverter();

/**
 * Adapts the backend URL converter for use in Electron
 */
async function convertUrl(url, options = {}) {
  // Normalize URL
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    url = 'https://' + url;
  }

  // Deep merge options
  const mergedOptions = {
    ...defaultOptions,
    ...options,
    got: {
      ...(defaultOptions.got || {}),
      ...(options.got || {}),
      headers: {
        ...(defaultOptions.got?.headers || {}),
        ...(options.got?.headers || {})
      }
    }
  };

  // Get page from shared BrowserService
  let page;
  try {
    page = await BrowserService.createPage();
    console.log('Created page for URL conversion');
    
    // Log navigation start
    console.log(`Navigating to ${url}`);

    // Initial navigation
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Take initial screenshot
    await page.screenshot({ path: 'debug-screenshot-initial.png' });
    console.log('Saved initial screenshot');

    // Wait for network idle
    await page.waitForNetworkIdle({ 
      timeout: 5000,
      idleTime: 1000
    }).catch(() => console.log('Network still active, continuing anyway'));

    // Wait for and find main content
    const result = await findMainContent(page, mergedOptions);
    
    // Take final screenshot with content highlight
    if (result.selector) {
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (element) {
          element.style.outline = '3px solid red';
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, result.selector);
    }
    await page.screenshot({ path: 'debug-screenshot-final.png' });
    console.log('Saved final screenshot');

    // Load the URL converter module and convert
    const { convertUrlToMarkdown } = await modulePromise;
    
    console.log(`🔄 [urlConverterAdapter] Converting URL: ${url}`);
    
    try {
      // Convert the page using existing browser instance
      const converted = await convertUrlToMarkdown(url, {
        ...mergedOptions,
        externalBrowser: page.browser()  // Tell BrowserManager to use our browser
      });
      
      console.log(`✅ [urlConverterAdapter] URL conversion successful`);
      
      if (!converted) {
        throw new Error('URL converter returned null or undefined result');
      }
      
      if (!converted.content) {
        console.warn(`⚠️ [urlConverterAdapter] URL converter returned empty content`);
      }
      
      return {
        content: converted.content || `# Conversion Error\n\nFailed to extract content from ${url}`,
        success: !!converted.content,
        name: converted.name || url.replace(/^https?:\/\//, '').replace(/[^\w\d]/g, '-'),
        metadata: converted.metadata || { source: url },
        images: converted.images || [],
        url: converted.url || url,
        type: 'url'
      };
    } catch (conversionError) {
      console.error(`❌ [urlConverterAdapter] Error during URL conversion:`, conversionError);
      throw conversionError;
    }

  } catch (error) {
    console.error('URL conversion failed in adapter:', error);
    if (page) {
      try {
        await page.screenshot({ path: 'debug-screenshot-error.png' });
      } catch (e) {
        console.error('Failed to save error screenshot:', e);
      }
    }
    return {
      success: false,
      error: error.message || 'URL conversion failed',
      url,
      type: 'url'
    };
  } finally {
    if (page) {
      try {
        await page.close();
        console.log('Closed conversion page');
      } catch (e) {
        console.error('Error closing page:', e);
      }
    }
  }
}

/**
 * Find main content on the page using various selectors and strategies
 */
async function findMainContent(page, options) {
  const selectors = [
    // Semantic elements
    'main',
    'article',
    '[role="main"]',
    // Common content containers
    '.content',
    '#content',
    '.article',
    '.post-content',
    '.main-content',
    // Documentation sites
    '.markdown-body',
    '.documentation',
    '.docs-content',
    // Blog/article specific
    '.article-content',
    '.post-body',
    '.entry-content',
    '.blog-post',
    '.page-content',
    // Generic content wrappers
    'div[class*="content"]',
    'div[class*="article"]',
    'div[class*="post"]',
    // Layout containers
    '.container main',
    '.wrapper main',
    '.layout main',
    // Legacy patterns
    '#main-content',
    '#primary'
  ];

  // Try to find content element
  let mainContentSelector = null;
  for (const selector of selectors) {
    try {
      const element = await page.waitForSelector(selector, { 
        timeout: 3000,
        visible: true 
      });
      if (element) {
        // Verify element has content
        const isValid = await page.evaluate((selector) => {
          const el = document.querySelector(selector);
          if (!el) return false;
          const text = el.textContent || '';
          return text.length > 500; // Minimum content length
        }, selector);
        
        if (isValid) {
          mainContentSelector = selector;
          console.log(`Found content with selector: ${selector}`);
          break;
        }
      }
    } catch (e) {
      // Continue to next selector
    }
  }

  // If no specific selector worked, wait for body content
  if (!mainContentSelector) {
    console.log('No specific content selector found, waiting for body content');
    try {
      await page.waitForFunction(
        () => document.body.textContent.length > 1000,
        { 
          timeout: options.maxWaitTime || 45000,
          polling: 1000
        }
      );
    } catch (e) {
      console.warn('Timeout waiting for body content');
    }
  }

  return { selector: mainContentSelector };
}

module.exports = {
  convertUrl,
  convertParentUrl: async (url, options = {}) => {
    // Import and use the parent URL converter
    const { convertParentUrlToMarkdown } = await import(
      '../../../backend/src/services/converter/web/parentUrlConverter.js'
    );

    // Create website-specific progress handler
    const websiteOptions = {
      ...options,
      onProgress: (data) => {
        const progressData = {
          ...data,
          type: 'website',
          _conversionType: 'website',
          _jobType: 'website-conversion',
          websiteUrl: url,
        };

        // Log each progress update
        console.log('[urlConverterAdapter] Website progress:', {
          status: progressData.status,
          type: progressData.type,
          currentUrl: progressData.currentUrl,
          progress: progressData.progress,
          timestamp: new Date().toISOString()
        });

        // Pass through to original handler
        if (options.onProgress) {
          options.onProgress(progressData);
        }
      }
    };

    // Call parent URL converter with enhanced options
    return await convertParentUrlToMarkdown(url, websiteOptions);
  }
};
