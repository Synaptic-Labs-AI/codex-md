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
    this.shouldCloseBrowser = false;
  }

  /**
   * Get or create a browser instance
   * @param {Object} options - Browser options
   * @returns {Promise<Browser>} Browser instance
   */
  async getBrowser(options = {}) {
    // If an external browser is provided, use it
    if (options.externalBrowser) {
      this.externalBrowser = options.externalBrowser;
      return options.externalBrowser;
    }
    
    // If we already have an external browser, use it
    if (this.externalBrowser) {
      return this.externalBrowser;
    }
    
    // Otherwise, use or create the cached browser instance
    if (!browserInstance) {
      console.log('🌐 Launching new Puppeteer browser instance...');
      
      try {
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
        
        this.shouldCloseBrowser = true;
      } catch (error) {
        throw new AppError(`Failed to launch browser: ${error.message}`, 500);
      }
    }
    
    return browserInstance;
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
          const resourceType = request.resourceType();
          
          // Block unnecessary resources
          if (['image', 'stylesheet', 'font', 'media'].includes(resourceType) && options.blockResources) {
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
   * Navigate to a URL
   * @param {Page} page - Page instance
   * @param {string} url - URL to navigate to
   * @param {Object} options - Navigation options
   * @returns {Promise<Response>} Navigation response
   */
  async navigateToUrl(page, url, options = {}) {
    try {
      // Set default navigation options
      const navigationOptions = {
        waitUntil: options.waitUntil || 'networkidle2',
        timeout: options.timeout || 30000
      };
      
      // Navigate to URL
      const response = await page.goto(url, navigationOptions);
      
      // Check for navigation errors
      if (!response) {
        throw new AppError(`Failed to navigate to ${url}: No response received`, 500);
      }
      
      const status = response.status();
      if (status >= 400) {
        throw new AppError(`Failed to navigate to ${url}: HTTP status ${status}`, status);
      }
      
      return response;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      throw new AppError(`Navigation error: ${error.message}`, 500);
    }
  }
  
  /**
   * Close the browser instance
   * @returns {Promise<void>}
   */
  async closeBrowser() {
    // Only close the browser if it's not an external one and we should close it
    if (browserInstance && !this.externalBrowser && this.shouldCloseBrowser) {
      try {
        await browserInstance.close();
        browserInstance = null;
        console.log('🌐 Browser closed successfully');
      } catch (error) {
        console.error('Error closing browser:', error);
      }
    }
  }
  
  /**
   * Static method to close the browser instance
   * @returns {Promise<void>}
   */
  static async closeBrowser() {
    if (browserInstance) {
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
