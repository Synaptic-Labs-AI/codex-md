/**
 * BrowserService.js
 * 
 * Manages a single Puppeteer browser instance for the application.
 * Provides lazy initialization and access to the browser instance.
 * 
 * Related files:
 * - ../adapters/urlConverterAdapter.js: Uses this service for URL conversion
 * - ../adapters/parentUrlConverterAdapter.js: Uses this service for parent URL conversion
 * - ../../backend/src/services/converter/web/urlConverter.js: Accepts browser instance
 * - ../../backend/src/services/converter/web/parentUrlConverter.js: Accepts browser instance
 */

const path = require('path');
const { app } = require('electron');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

class BrowserService {
  constructor() {
    this.browser = null;
    this.browserPromise = null;
    this.isInitializing = false;
    this.initializationError = null;
    
    // Set up Puppeteer with Stealth plugin
    puppeteer.use(StealthPlugin());
    
    // Bind methods
    this.initialize = this.initialize.bind(this);
    this.getBrowser = this.getBrowser.bind(this);
    this.createPage = this.createPage.bind(this);
    this.close = this.close.bind(this);
  }

  /**
   * Initialize the Puppeteer browser instance with stealth measures
   * @returns {Promise<Browser>} The browser instance
   */
  async initialize() {
    if (this.isInitializing) return this.browserPromise;
    if (this.browser) return this.browser;
    
    this.initializationError = null;
    this.isInitializing = true;
    
    this.browserPromise = (async () => {
      try {
        console.log('🌐 Initializing enhanced Puppeteer browser...');
        
        // Clear any existing Puppeteer environment variables
        delete process.env.PUPPETEER_SKIP_CHROMIUM_DOWNLOAD;
        delete process.env.PUPPETEER_EXECUTABLE_PATH;

        // Launch browser with enhanced stealth configuration
        this.browser = await puppeteer.launch({
          headless: 'new',
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--disable-infobars',
            '--window-size=1920,1080',
            '--disable-dev-shm-usage'
          ],
          defaultViewport: {
            width: 1920,
            height: 1080,
            deviceScaleFactor: 1,
            isMobile: false,
            hasTouch: false,
            isLandscape: true
          }
        });
        
        // Set up event listeners
        this.browser.on('disconnected', () => {
          console.log('🌐 Browser disconnected');
          this.browser = null;
          this.browserPromise = null;
          this.isInitializing = false;
        });
        
        console.log('🌐 Enhanced Puppeteer browser initialized successfully');
        return this.browser;
      } catch (error) {
        console.error('🌐 Failed to initialize Puppeteer browser:', error);
        this.initializationError = error;
        this.browser = null;
        throw error;
      } finally {
        this.isInitializing = false;
      }
    })();
    
    return this.browserPromise;
  }

  /**
   * Get the browser instance, initializing it if necessary
   * @returns {Promise<Browser>} The browser instance
   */
  async getBrowser() {
    if (this.browser) {
      return this.browser;
    }
    
    if (this.initializationError) {
      console.log('🌐 Retrying browser initialization after previous failure');
    }
    
    return this.initialize();
  }

  /**
   * Create a new page with enhanced anti-detection measures
   * @returns {Promise<Page>} A configured page instance
   */
  async createPage() {
    const browser = await this.getBrowser();
    const page = await browser.newPage();

    // Set up common user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Additional page configurations
    await page.evaluateOnNewDocument(() => {
      // Add language configuration
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en'],
      });

      // Add dummy plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => Array(3).fill().map((_, i) => ({
          name: `Plugin ${i + 1}`,
          description: `Dummy plugin ${i + 1}`,
          filename: `plugin${i + 1}.dll`
        }))
      });

      // Spoof permissions API
      const originalQuery = window.navigator.permissions.query;
      window.navigator.permissions.query = (parameters) => (
        parameters.name === 'notifications' ?
        Promise.resolve({ state: Notification.permission }) :
        originalQuery(parameters)
      );

      // Override webdriver flag
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // Add dummy scheduler
      window.requestIdleCallback = window.requestIdleCallback || ((cb) => {
        const start = Date.now();
        return setTimeout(() => {
          cb({
            didTimeout: false,
            timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
          });
        }, 1);
      });

      // Add chrome object
      if (!window.chrome) {
        window.chrome = {
          runtime: {},
          webstore: {}
        };
      }
    });

    // Add helper methods for consistent waiting behavior
    const originalWaitForTimeout = page.waitForTimeout;
    page.waitForTimeout = async (ms) => {
      if (!ms) ms = 0;
      return new Promise(resolve => setTimeout(resolve, ms));
    };

    const originalWaitForFunction = page.waitForFunction;
    page.waitForFunction = async (pageFunction, options = {}, ...args) => {
      // If options is just a number, treat it as timeout
      if (typeof options === 'number') {
        options = { timeout: options };
      }
      
      const defaultOptions = {
        timeout: 30000,
        polling: 100
      };

      return originalWaitForFunction.call(
        page,
        pageFunction,
        { ...defaultOptions, ...options },
        ...args
      );
    };

    return page;
  }

  /**
   * Close the browser instance
   */
  async close() {
    if (this.browser) {
      try {
        console.log('🌐 Closing Puppeteer browser...');
        await this.browser.close();
        console.log('🌐 Puppeteer browser closed successfully');
      } catch (error) {
        console.error('🌐 Error closing Puppeteer browser:', error);
      } finally {
        this.browser = null;
        this.browserPromise = null;
        this.isInitializing = false;
      }
    }
  }

  /**
   * Check if the browser is initialized
   * @returns {boolean} True if the browser is initialized
   */
  isInitialized() {
    return !!this.browser;
  }

  /**
   * Get the initialization status
   * @returns {Object} The initialization status
   */
  getStatus() {
    return {
      initialized: !!this.browser,
      initializing: this.isInitializing,
      error: this.initializationError ? this.initializationError.message : null
    };
  }
}

// Export a singleton instance
module.exports = new BrowserService();
