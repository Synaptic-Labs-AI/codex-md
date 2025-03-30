/**
 * URL Converter Adapter
 */

const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const PageMarkerService = require('../services/PageMarkerService');
const BrowserService = require('../services/BrowserService');

async function loadUrlConverter() {
  try {
    const urlConverterPath = path.resolve(__dirname, '../../../backend/src/services/converter/web/urlConverter.js');
    
    if (!fs.existsSync(urlConverterPath)) {
      throw new Error(`URL converter module not found at: ${urlConverterPath}`);
    }
    
    const fileUrl = pathToFileURL(urlConverterPath).href;
    console.log('Loading URL converter from:', fileUrl);
    
    const { convertUrlToMarkdown } = await import(fileUrl);
    return { convertUrlToMarkdown };
  } catch (error) {
    console.error('Failed to load URL converter module:', error);
    throw error;
  }
}

/**
 * Common selectors for cookie consent buttons and dialogs
 */
const COOKIE_SELECTORS = {
  buttons: [
    // Cookie accept buttons
    '#onetrust-accept-btn-handler',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#gdpr-cookie-accept',
    '.cc-accept',
    '.js-accept-cookies',
    // Common button patterns
    'button[id*="accept" i], button[class*="accept" i]',
    'button[id*="agree" i], button[class*="agree" i]',
    'button[id*="consent" i], button[class*="consent" i]',
    '[id*="accept"][role="button"]',
    '[class*="accept"][role="button"]',
    // Text-based buttons (more specific first)
    'button:has-text("Accept All")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Accept")',
    'button:has-text("Agree")',
    'button:has-text("Allow")',
    'button:has-text("Close")',
    // Link-based accepts
    'a:has-text("Accept All")',
    'a:has-text("Accept")',
    'a:has-text("Agree")'
  ],
  dialogs: [
    // Cookie dialog containers
    '#onetrust-banner-sdk',
    '#cookiebanner',
    '#CybotCookiebotDialog',
    '.cookie-consent',
    '.cookie-notice',
    // Common patterns
    '[id*="cookie" i][class*="banner" i]',
    '[id*="cookie" i][class*="notice" i]',
    '[id*="cookie" i][class*="popup" i]',
    '[class*="cookie" i][class*="banner" i]',
    '[id*="gdpr"]',
    '[class*="gdpr"]',
    '[id*="consent"][role="dialog"]',
    '[class*="consent"][role="dialog"]',
    // Common overlay patterns
    '.modal[aria-label*="cookie" i]',
    '.dialog[aria-label*="cookie" i]',
    '[role="dialog"][aria-label*="cookie" i]'
  ]
};

/**
 * Delay helper that works with Puppeteer page
 */
async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Handles cookie consent dialogs by finding and clicking accept buttons
 */
async function handleCookieDialog(page) {
  console.log('🍪 Checking for cookie consent dialog...');
  
  try {
    const dialogSelectors = COOKIE_SELECTORS.dialogs.join(', ');
    const buttonSelectors = COOKIE_SELECTORS.buttons.join(', ');
    
    // First check if there's a visible cookie dialog
    const dialogFound = await page.waitForSelector(dialogSelectors, { 
      timeout: 5000,
      visible: true 
    }).catch(() => null);

    if (dialogFound) {
      console.log('Found cookie dialog');
      
      // Try clicking accept buttons with retries
      for (let attempt = 0; attempt < 3; attempt++) {
        // Use page.evaluate for more reliable clicking
        const clicked = await page.evaluate((selectors) => {
          const buttons = [...document.querySelectorAll(selectors)];
          for (const button of buttons) {
            const style = window.getComputedStyle(button);
            const isVisible = style.display !== 'none' && 
                            style.visibility !== 'hidden' && 
                            style.opacity !== '0' &&
                            button.offsetWidth > 0 &&
                            button.offsetHeight > 0;
            
            if (isVisible) {
              button.click();
              return true;
            }
          }
          return false;
        }, buttonSelectors);
        
        if (clicked) {
          console.log('🍪 Clicked cookie accept button');
          // Wait for dialog to disappear and animations to complete
          await delay(1500);
          
          // Verify dialog is gone
          const dialogStillVisible = await page.evaluate((selector) => {
            const dialog = document.querySelector(selector);
            if (dialog) {
              const style = window.getComputedStyle(dialog);
              return style.display !== 'none' && style.visibility !== 'hidden';
            }
            return false;
          }, dialogSelectors);
          
          if (!dialogStillVisible) {
            console.log('🍪 Cookie dialog handled successfully');
            return true;
          }
        }
        
        // Wait before next attempt
        if (attempt < 2) {
          await delay(1000);
        }
      }
      
      console.log('🍪 Could not handle cookie dialog after retries');
    } else {
      console.log('No visible cookie dialog found');
    }
  } catch (error) {
    console.error('🍪 Error handling cookie dialog:', error);
  }
  
  return false;
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

    // Handle cookie dialog with retries
    await delay(1000); // Wait for dialogs to appear
    let cookieHandled = await handleCookieDialog(page);
    
    if (!cookieHandled) {
      // Try one more time if first attempt failed
      await delay(1000);
      cookieHandled = await handleCookieDialog(page);
    }

    // Let page settle after cookie handling
    await page.waitForNetworkIdle({ 
      timeout: 5000,
      idleTime: 1000
    }).catch(() => console.log('Network still active, continuing anyway'));

    // Take post-cookie screenshot
    await page.screenshot({ path: 'debug-screenshot-post-cookie.png' });
    console.log('Saved screenshot after cookie handling');

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
    
    // Add necessary properties to options
    mergedOptions.browser = page.browser();
    
    // Convert the page
    const converted = await convertUrlToMarkdown(url, mergedOptions);
    
    if (!converted || !converted.content) {
      throw new Error('Converter returned empty content');
    }
    
    return {
      content: converted.content,
      success: true,
      name: converted.name,
      metadata: converted.metadata,
      images: converted.images,
      url: converted.url,
      type: 'url'
    };

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
  convertUrl
};
