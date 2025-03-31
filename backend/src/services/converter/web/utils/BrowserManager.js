/**
 * Browser Manager Module
 * Handles browser instance creation and management
 */

import puppeteer from 'puppeteer';
import { AppError } from '../../../../utils/errorHandler.js';

// Browser instance cache to avoid launching multiple browsers
let browserInstance = null;

export class BrowserManager {
  constructor() {
    this.externalBrowser = null;
  }

  /**
   * Get or create a browser instance
   * @param {Object} options - Browser options
   * @returns {Promise<Browser>} Browser instance
   */
  async getBrowser(options = {}) {
    try {
      // If an external browser is provided, always use it
      if (options.externalBrowser) {
        this.externalBrowser = options.externalBrowser;
        return this.externalBrowser;
      }

      // If we already have an external browser, continue using it
      if (this.externalBrowser) {
        return this.externalBrowser;
      }

      // Only create a new browser if absolutely necessary
      if (!browserInstance) {
        console.warn('⚠️ No external browser provided, creating new instance');
        
        // Ensure options are properly structured
        const launchOptions = {
          headless: options.headless || 'new',
          args: Array.isArray(options.args) ? options.args : [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1280,800'
          ],
          defaultViewport: {
            width: 1280,
            height: 800,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: true,
            ...(options.defaultViewport || {})
          }
        };

        // Only spread browserOptions if it exists and is an object
        if (options.browserOptions && typeof options.browserOptions === 'object') {
          Object.assign(launchOptions, options.browserOptions);
        }

        browserInstance = await puppeteer.launch(launchOptions);
        
        // Set up event listeners
        browserInstance.on('disconnected', () => {
          console.log('🌐 Browser disconnected, clearing instance');
          browserInstance = null;
        });
      }

      return browserInstance;
    } catch (error) {
      throw new AppError(`Failed to get browser instance: ${error.message}`, 500);
    }
  }
  
  /**
   * Create a new page in the browser
   * @param {Browser} browser - Browser instance
   * @param {Object} options - Page options
   * @returns {Promise<Page>} Page instance
   */
  async createPage(browser, options = {}) {
    try {
      // Create a new page
      const page = await browser.newPage();
      
      // Set viewport
      await page.setViewport(options.viewport || {
        width: 1280,
        height: 800,
        deviceScaleFactor: 1,
        isMobile: false
      });
      
      // Set user agent
      await page.setUserAgent(options.userAgent || 
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
      );
      
      // Set extra HTTP headers
      if (options.headers) {
        await page.setExtraHTTPHeaders(options.headers);
      }
      
      // Set request interception
      if (options.interceptRequests) {
        await page.setRequestInterception(true);
        page.on('request', (request) => {
          if (options.blockResources && ['image', 'stylesheet', 'font', 'media'].includes(request.resourceType())) {
            request.abort();
          } else {
            request.continue();
          }
        });
      }
      
      // Set JavaScript enabled/disabled
      if (options.javaScriptEnabled === false) {
        await page.setJavaScriptEnabled(false);
      }
      
      return page;
    } catch (error) {
      throw new AppError(`Failed to create page: ${error.message}`, 500);
    }
  }
  
  /**
   * Close the browser instance
   * @returns {Promise<void>}
   */
  async closeBrowser() {
    // Only close browser if we created it (not external)
    if (browserInstance && !this.externalBrowser) {
      try {
        await browserInstance.close();
        browserInstance = null;
        console.log('🌐 Browser closed successfully');
      } catch (error) {
        console.error('Error closing browser:', error);
      }
    }
  }
}
