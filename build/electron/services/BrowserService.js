"use strict";

/**
 * BrowserService.js
 * 
 * Manages a single Puppeteer browser instance for the application.
 * Provides lazy initialization and access to the browser instance.
 * 
 * Related files:
 * - ../adapters/urlConverterAdapter.js: Uses this service for URL conversion
 * - ../adapters/parentUrlConverterAdapter.js: Uses this service for parent URL conversion
 * - src/electron/services/conversion/web/UrlConverter.js: Accepts browser instance
 * - src/electron/services/conversion/web/ParentUrlConverter.js: Accepts browser instance
 */

const path = require('path');
const {
  app
} = require('electron');
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const {
  PuppeteerBlocker
} = require('@cliqz/adblocker-puppeteer');
const fetch = require('cross-fetch');
const autoconsent = require('@duckduckgo/autoconsent/dist/autoconsent.puppet.js');
const extraRules = require('@duckduckgo/autoconsent/rules/rules.json');
class BrowserService {
  constructor() {
    this.browser = null;
    this.browserPromise = null;
    this.isInitializing = false;
    this.initializationError = null;
    this.blocker = null;

    // Set up Puppeteer with Stealth plugin
    puppeteer.use(StealthPlugin());

    // Set up autoconsent rules
    const consentomatic = extraRules.consentomatic;
    this.rules = [...autoconsent.rules, ...Object.keys(consentomatic).map(name => new autoconsent.ConsentOMaticCMP(`com_${name}`, consentomatic[name])), ...extraRules.autoconsent.map(spec => autoconsent.createAutoCMP(spec))];

    // Initialize adblocker
    this.initializeBlocker();

    // Bind methods
    this.initialize = this.initialize.bind(this);
    this.getBrowser = this.getBrowser.bind(this);
    this.createPage = this.createPage.bind(this);
    this.close = this.close.bind(this);
  }

  /**
   * Initialize the adblocker with cookie list
   */
  async initializeBlocker() {
    try {
      console.log('🛡️ Initializing adblocker...');
      this.blocker = await PuppeteerBlocker.fromLists(fetch, ['https://secure.fanboy.co.nz/fanboy-cookiemonster.txt']);
      console.log('🛡️ Adblocker initialized successfully');
    } catch (error) {
      console.error('🛡️ Failed to initialize adblocker:', error);
    }
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
          args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled', '--disable-infobars', '--window-size=1920,1080', '--disable-dev-shm-usage'],
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

    // Set longer timeouts for SPA content
    await page.setDefaultNavigationTimeout(30000);
    await page.setDefaultTimeout(30000);

    // Enable adblocker if initialized
    if (this.blocker) {
      await this.blocker.enableBlockingInPage(page);
    }

    // Set up common user agent
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36');

    // Set viewport to ensure all content is visible
    await page.setViewport({
      width: 1920,
      height: 1080,
      deviceScaleFactor: 1
    });

    // Additional page configurations for React/SPA support
    await page.evaluateOnNewDocument(() => {
      // Add React DevTools global hook
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
        renderers: new Map(),
        supportsFiber: true,
        inject: function () {},
        onCommitFiberRoot: function () {},
        onCommitFiberUnmount: function () {}
      };
      // Add language configuration
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
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
      window.navigator.permissions.query = parameters => parameters.name === 'notifications' ? Promise.resolve({
        state: Notification.permission
      }) : originalQuery(parameters);

      // Override webdriver flag
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined
      });

      // Add dummy scheduler
      window.requestIdleCallback = window.requestIdleCallback || (cb => {
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
    page.waitForTimeout = async ms => {
      if (!ms) ms = 0;
      return new Promise(resolve => setTimeout(resolve, ms));
    };
    const originalWaitForFunction = page.waitForFunction;
    page.waitForFunction = async (pageFunction, options = {}, ...args) => {
      // If options is just a number, treat it as timeout
      if (typeof options === 'number') {
        options = {
          timeout: options
        };
      }
      const defaultOptions = {
        timeout: 30000,
        polling: 100
      };
      return originalWaitForFunction.call(page, pageFunction, {
        ...defaultOptions,
        ...options
      }, ...args);
    };

    // Enhanced autoconsent setup with retry
    page.once('load', async () => {
      try {
        const currentUrl = await page.url();
        // Wait for page to be fully interactive
        await page.waitForFunction(() => {
          return document.readyState === 'complete' && !!document.body && !!document.querySelector('button, a, input');
        }, {
          timeout: 10000
        }).catch(() => console.log('Page interaction wait timed out'));

        // Try autoconsent
        const tab = autoconsent.attachToPage(page, currentUrl, this.rules, 20);
        await tab.checked;
        await tab.doOptIn().catch(() => console.log('Cookie consent handling failed'));

        // Additional wait for any post-consent reflows
        await page.waitForTimeout(1000);
      } catch (e) {
        console.warn('CMP handling error:', e);
        // Continue anyway as this shouldn't block content extraction
      }
    });

    // Add helper method for waiting for network and content to settle
    page.waitForContentToSettle = async (timeout = 10000) => {
      const startTime = Date.now();
      try {
        // Wait for network to be idle
        await page.waitForNetworkIdle({
          idleTime: 1000,
          timeout: 5000
        }).catch(() => console.log('Network idle timeout reached'));

        // Wait for no significant DOM changes
        await page.waitForFunction(() => {
          return new Promise(resolve => {
            let mutations = 0;
            const observer = new MutationObserver(mutationsList => {
              mutations += mutationsList.length;
            });
            observer.observe(document.body, {
              childList: true,
              subtree: true,
              attributes: true,
              characterData: true
            });
            setTimeout(() => {
              observer.disconnect();
              resolve(mutations < 10); // Consider stable if few mutations
            }, 1000);
          });
        }, {
          timeout
        });
      } catch (e) {
        console.warn('Content settlement timeout:', e);
      }

      // Ensure minimum wait time
      const elapsed = Date.now() - startTime;
      if (elapsed < 2000) {
        await page.waitForTimeout(2000 - elapsed);
      }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImFwcCIsInB1cHBldGVlciIsIlN0ZWFsdGhQbHVnaW4iLCJQdXBwZXRlZXJCbG9ja2VyIiwiZmV0Y2giLCJhdXRvY29uc2VudCIsImV4dHJhUnVsZXMiLCJCcm93c2VyU2VydmljZSIsImNvbnN0cnVjdG9yIiwiYnJvd3NlciIsImJyb3dzZXJQcm9taXNlIiwiaXNJbml0aWFsaXppbmciLCJpbml0aWFsaXphdGlvbkVycm9yIiwiYmxvY2tlciIsInVzZSIsImNvbnNlbnRvbWF0aWMiLCJydWxlcyIsIk9iamVjdCIsImtleXMiLCJtYXAiLCJuYW1lIiwiQ29uc2VudE9NYXRpY0NNUCIsInNwZWMiLCJjcmVhdGVBdXRvQ01QIiwiaW5pdGlhbGl6ZUJsb2NrZXIiLCJpbml0aWFsaXplIiwiYmluZCIsImdldEJyb3dzZXIiLCJjcmVhdGVQYWdlIiwiY2xvc2UiLCJjb25zb2xlIiwibG9nIiwiZnJvbUxpc3RzIiwiZXJyb3IiLCJwcm9jZXNzIiwiZW52IiwiUFVQUEVURUVSX1NLSVBfQ0hST01JVU1fRE9XTkxPQUQiLCJQVVBQRVRFRVJfRVhFQ1VUQUJMRV9QQVRIIiwibGF1bmNoIiwiaGVhZGxlc3MiLCJhcmdzIiwiZGVmYXVsdFZpZXdwb3J0Iiwid2lkdGgiLCJoZWlnaHQiLCJkZXZpY2VTY2FsZUZhY3RvciIsImlzTW9iaWxlIiwiaGFzVG91Y2giLCJpc0xhbmRzY2FwZSIsIm9uIiwicGFnZSIsIm5ld1BhZ2UiLCJzZXREZWZhdWx0TmF2aWdhdGlvblRpbWVvdXQiLCJzZXREZWZhdWx0VGltZW91dCIsImVuYWJsZUJsb2NraW5nSW5QYWdlIiwic2V0VXNlckFnZW50Iiwic2V0Vmlld3BvcnQiLCJldmFsdWF0ZU9uTmV3RG9jdW1lbnQiLCJ3aW5kb3ciLCJfX1JFQUNUX0RFVlRPT0xTX0dMT0JBTF9IT09LX18iLCJyZW5kZXJlcnMiLCJNYXAiLCJzdXBwb3J0c0ZpYmVyIiwiaW5qZWN0Iiwib25Db21taXRGaWJlclJvb3QiLCJvbkNvbW1pdEZpYmVyVW5tb3VudCIsImRlZmluZVByb3BlcnR5IiwibmF2aWdhdG9yIiwiZ2V0IiwiQXJyYXkiLCJmaWxsIiwiXyIsImkiLCJkZXNjcmlwdGlvbiIsImZpbGVuYW1lIiwib3JpZ2luYWxRdWVyeSIsInBlcm1pc3Npb25zIiwicXVlcnkiLCJwYXJhbWV0ZXJzIiwiUHJvbWlzZSIsInJlc29sdmUiLCJzdGF0ZSIsIk5vdGlmaWNhdGlvbiIsInBlcm1pc3Npb24iLCJ1bmRlZmluZWQiLCJyZXF1ZXN0SWRsZUNhbGxiYWNrIiwiY2IiLCJzdGFydCIsIkRhdGUiLCJub3ciLCJzZXRUaW1lb3V0IiwiZGlkVGltZW91dCIsInRpbWVSZW1haW5pbmciLCJNYXRoIiwibWF4IiwiY2hyb21lIiwicnVudGltZSIsIndlYnN0b3JlIiwib3JpZ2luYWxXYWl0Rm9yVGltZW91dCIsIndhaXRGb3JUaW1lb3V0IiwibXMiLCJvcmlnaW5hbFdhaXRGb3JGdW5jdGlvbiIsIndhaXRGb3JGdW5jdGlvbiIsInBhZ2VGdW5jdGlvbiIsIm9wdGlvbnMiLCJ0aW1lb3V0IiwiZGVmYXVsdE9wdGlvbnMiLCJwb2xsaW5nIiwiY2FsbCIsIm9uY2UiLCJjdXJyZW50VXJsIiwidXJsIiwiZG9jdW1lbnQiLCJyZWFkeVN0YXRlIiwiYm9keSIsInF1ZXJ5U2VsZWN0b3IiLCJjYXRjaCIsInRhYiIsImF0dGFjaFRvUGFnZSIsImNoZWNrZWQiLCJkb09wdEluIiwiZSIsIndhcm4iLCJ3YWl0Rm9yQ29udGVudFRvU2V0dGxlIiwic3RhcnRUaW1lIiwid2FpdEZvck5ldHdvcmtJZGxlIiwiaWRsZVRpbWUiLCJtdXRhdGlvbnMiLCJvYnNlcnZlciIsIk11dGF0aW9uT2JzZXJ2ZXIiLCJtdXRhdGlvbnNMaXN0IiwibGVuZ3RoIiwib2JzZXJ2ZSIsImNoaWxkTGlzdCIsInN1YnRyZWUiLCJhdHRyaWJ1dGVzIiwiY2hhcmFjdGVyRGF0YSIsImRpc2Nvbm5lY3QiLCJlbGFwc2VkIiwiaXNJbml0aWFsaXplZCIsImdldFN0YXR1cyIsImluaXRpYWxpemVkIiwiaW5pdGlhbGl6aW5nIiwibWVzc2FnZSIsIm1vZHVsZSIsImV4cG9ydHMiXSwic291cmNlcyI6WyIuLi8uLi8uLi9zcmMvZWxlY3Ryb24vc2VydmljZXMvQnJvd3NlclNlcnZpY2UuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIEJyb3dzZXJTZXJ2aWNlLmpzXHJcbiAqIFxyXG4gKiBNYW5hZ2VzIGEgc2luZ2xlIFB1cHBldGVlciBicm93c2VyIGluc3RhbmNlIGZvciB0aGUgYXBwbGljYXRpb24uXHJcbiAqIFByb3ZpZGVzIGxhenkgaW5pdGlhbGl6YXRpb24gYW5kIGFjY2VzcyB0byB0aGUgYnJvd3NlciBpbnN0YW5jZS5cclxuICogXHJcbiAqIFJlbGF0ZWQgZmlsZXM6XHJcbiAqIC0gLi4vYWRhcHRlcnMvdXJsQ29udmVydGVyQWRhcHRlci5qczogVXNlcyB0aGlzIHNlcnZpY2UgZm9yIFVSTCBjb252ZXJzaW9uXHJcbiAqIC0gLi4vYWRhcHRlcnMvcGFyZW50VXJsQ29udmVydGVyQWRhcHRlci5qczogVXNlcyB0aGlzIHNlcnZpY2UgZm9yIHBhcmVudCBVUkwgY29udmVyc2lvblxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL3dlYi9VcmxDb252ZXJ0ZXIuanM6IEFjY2VwdHMgYnJvd3NlciBpbnN0YW5jZVxyXG4gKiAtIHNyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL3dlYi9QYXJlbnRVcmxDb252ZXJ0ZXIuanM6IEFjY2VwdHMgYnJvd3NlciBpbnN0YW5jZVxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IHsgYXBwIH0gPSByZXF1aXJlKCdlbGVjdHJvbicpO1xyXG5jb25zdCBwdXBwZXRlZXIgPSByZXF1aXJlKCdwdXBwZXRlZXItZXh0cmEnKTtcclxuY29uc3QgU3RlYWx0aFBsdWdpbiA9IHJlcXVpcmUoJ3B1cHBldGVlci1leHRyYS1wbHVnaW4tc3RlYWx0aCcpO1xyXG5jb25zdCB7IFB1cHBldGVlckJsb2NrZXIgfSA9IHJlcXVpcmUoJ0BjbGlxei9hZGJsb2NrZXItcHVwcGV0ZWVyJyk7XHJcbmNvbnN0IGZldGNoID0gcmVxdWlyZSgnY3Jvc3MtZmV0Y2gnKTtcclxuY29uc3QgYXV0b2NvbnNlbnQgPSByZXF1aXJlKCdAZHVja2R1Y2tnby9hdXRvY29uc2VudC9kaXN0L2F1dG9jb25zZW50LnB1cHBldC5qcycpO1xyXG5jb25zdCBleHRyYVJ1bGVzID0gcmVxdWlyZSgnQGR1Y2tkdWNrZ28vYXV0b2NvbnNlbnQvcnVsZXMvcnVsZXMuanNvbicpO1xyXG5cclxuY2xhc3MgQnJvd3NlclNlcnZpY2Uge1xyXG4gIGNvbnN0cnVjdG9yKCkge1xyXG4gICAgdGhpcy5icm93c2VyID0gbnVsbDtcclxuICAgIHRoaXMuYnJvd3NlclByb21pc2UgPSBudWxsO1xyXG4gICAgdGhpcy5pc0luaXRpYWxpemluZyA9IGZhbHNlO1xyXG4gICAgdGhpcy5pbml0aWFsaXphdGlvbkVycm9yID0gbnVsbDtcclxuICAgIHRoaXMuYmxvY2tlciA9IG51bGw7XHJcbiAgICBcclxuICAgIC8vIFNldCB1cCBQdXBwZXRlZXIgd2l0aCBTdGVhbHRoIHBsdWdpblxyXG4gICAgcHVwcGV0ZWVyLnVzZShTdGVhbHRoUGx1Z2luKCkpO1xyXG4gICAgXHJcbiAgICAvLyBTZXQgdXAgYXV0b2NvbnNlbnQgcnVsZXNcclxuICAgIGNvbnN0IGNvbnNlbnRvbWF0aWMgPSBleHRyYVJ1bGVzLmNvbnNlbnRvbWF0aWM7XHJcbiAgICB0aGlzLnJ1bGVzID0gW1xyXG4gICAgICAuLi5hdXRvY29uc2VudC5ydWxlcyxcclxuICAgICAgLi4uT2JqZWN0LmtleXMoY29uc2VudG9tYXRpYykubWFwKG5hbWUgPT4gXHJcbiAgICAgICAgbmV3IGF1dG9jb25zZW50LkNvbnNlbnRPTWF0aWNDTVAoYGNvbV8ke25hbWV9YCwgY29uc2VudG9tYXRpY1tuYW1lXSkpLFxyXG4gICAgICAuLi5leHRyYVJ1bGVzLmF1dG9jb25zZW50Lm1hcChzcGVjID0+IGF1dG9jb25zZW50LmNyZWF0ZUF1dG9DTVAoc3BlYykpXHJcbiAgICBdO1xyXG4gICAgXHJcbiAgICAvLyBJbml0aWFsaXplIGFkYmxvY2tlclxyXG4gICAgdGhpcy5pbml0aWFsaXplQmxvY2tlcigpO1xyXG4gICAgXHJcbiAgICAvLyBCaW5kIG1ldGhvZHNcclxuICAgIHRoaXMuaW5pdGlhbGl6ZSA9IHRoaXMuaW5pdGlhbGl6ZS5iaW5kKHRoaXMpO1xyXG4gICAgdGhpcy5nZXRCcm93c2VyID0gdGhpcy5nZXRCcm93c2VyLmJpbmQodGhpcyk7XHJcbiAgICB0aGlzLmNyZWF0ZVBhZ2UgPSB0aGlzLmNyZWF0ZVBhZ2UuYmluZCh0aGlzKTtcclxuICAgIHRoaXMuY2xvc2UgPSB0aGlzLmNsb3NlLmJpbmQodGhpcyk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBJbml0aWFsaXplIHRoZSBhZGJsb2NrZXIgd2l0aCBjb29raWUgbGlzdFxyXG4gICAqL1xyXG4gIGFzeW5jIGluaXRpYWxpemVCbG9ja2VyKCkge1xyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc29sZS5sb2coJ/Cfm6HvuI8gSW5pdGlhbGl6aW5nIGFkYmxvY2tlci4uLicpO1xyXG4gICAgICB0aGlzLmJsb2NrZXIgPSBhd2FpdCBQdXBwZXRlZXJCbG9ja2VyLmZyb21MaXN0cyhmZXRjaCwgW1xyXG4gICAgICAgICdodHRwczovL3NlY3VyZS5mYW5ib3kuY28ubnovZmFuYm95LWNvb2tpZW1vbnN0ZXIudHh0J1xyXG4gICAgICBdKTtcclxuICAgICAgY29uc29sZS5sb2coJ/Cfm6HvuI8gQWRibG9ja2VyIGluaXRpYWxpemVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgY29uc29sZS5lcnJvcign8J+boe+4jyBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBhZGJsb2NrZXI6JywgZXJyb3IpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogSW5pdGlhbGl6ZSB0aGUgUHVwcGV0ZWVyIGJyb3dzZXIgaW5zdGFuY2Ugd2l0aCBzdGVhbHRoIG1lYXN1cmVzXHJcbiAgICogQHJldHVybnMge1Byb21pc2U8QnJvd3Nlcj59IFRoZSBicm93c2VyIGluc3RhbmNlXHJcbiAgICovXHJcbiAgYXN5bmMgaW5pdGlhbGl6ZSgpIHtcclxuICAgIGlmICh0aGlzLmlzSW5pdGlhbGl6aW5nKSByZXR1cm4gdGhpcy5icm93c2VyUHJvbWlzZTtcclxuICAgIGlmICh0aGlzLmJyb3dzZXIpIHJldHVybiB0aGlzLmJyb3dzZXI7XHJcbiAgICBcclxuICAgIHRoaXMuaW5pdGlhbGl6YXRpb25FcnJvciA9IG51bGw7XHJcbiAgICB0aGlzLmlzSW5pdGlhbGl6aW5nID0gdHJ1ZTtcclxuICAgIFxyXG4gICAgdGhpcy5icm93c2VyUHJvbWlzZSA9IChhc3luYyAoKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc29sZS5sb2coJ/CfjJAgSW5pdGlhbGl6aW5nIGVuaGFuY2VkIFB1cHBldGVlciBicm93c2VyLi4uJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQ2xlYXIgYW55IGV4aXN0aW5nIFB1cHBldGVlciBlbnZpcm9ubWVudCB2YXJpYWJsZXNcclxuICAgICAgICBkZWxldGUgcHJvY2Vzcy5lbnYuUFVQUEVURUVSX1NLSVBfQ0hST01JVU1fRE9XTkxPQUQ7XHJcbiAgICAgICAgZGVsZXRlIHByb2Nlc3MuZW52LlBVUFBFVEVFUl9FWEVDVVRBQkxFX1BBVEg7XHJcblxyXG4gICAgICAgIC8vIExhdW5jaCBicm93c2VyIHdpdGggZW5oYW5jZWQgc3RlYWx0aCBjb25maWd1cmF0aW9uXHJcbiAgICAgICAgdGhpcy5icm93c2VyID0gYXdhaXQgcHVwcGV0ZWVyLmxhdW5jaCh7XHJcbiAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICBhcmdzOiBbXHJcbiAgICAgICAgICAgICctLW5vLXNhbmRib3gnLFxyXG4gICAgICAgICAgICAnLS1kaXNhYmxlLXNldHVpZC1zYW5kYm94JyxcclxuICAgICAgICAgICAgJy0tZGlzYWJsZS1ibGluay1mZWF0dXJlcz1BdXRvbWF0aW9uQ29udHJvbGxlZCcsXHJcbiAgICAgICAgICAgICctLWRpc2FibGUtaW5mb2JhcnMnLFxyXG4gICAgICAgICAgICAnLS13aW5kb3ctc2l6ZT0xOTIwLDEwODAnLFxyXG4gICAgICAgICAgICAnLS1kaXNhYmxlLWRldi1zaG0tdXNhZ2UnXHJcbiAgICAgICAgICBdLFxyXG4gICAgICAgICAgZGVmYXVsdFZpZXdwb3J0OiB7XHJcbiAgICAgICAgICAgIHdpZHRoOiAxOTIwLFxyXG4gICAgICAgICAgICBoZWlnaHQ6IDEwODAsXHJcbiAgICAgICAgICAgIGRldmljZVNjYWxlRmFjdG9yOiAxLFxyXG4gICAgICAgICAgICBpc01vYmlsZTogZmFsc2UsXHJcbiAgICAgICAgICAgIGhhc1RvdWNoOiBmYWxzZSxcclxuICAgICAgICAgICAgaXNMYW5kc2NhcGU6IHRydWVcclxuICAgICAgICAgIH1cclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBTZXQgdXAgZXZlbnQgbGlzdGVuZXJzXHJcbiAgICAgICAgdGhpcy5icm93c2VyLm9uKCdkaXNjb25uZWN0ZWQnLCAoKSA9PiB7XHJcbiAgICAgICAgICBjb25zb2xlLmxvZygn8J+MkCBCcm93c2VyIGRpc2Nvbm5lY3RlZCcpO1xyXG4gICAgICAgICAgdGhpcy5icm93c2VyID0gbnVsbDtcclxuICAgICAgICAgIHRoaXMuYnJvd3NlclByb21pc2UgPSBudWxsO1xyXG4gICAgICAgICAgdGhpcy5pc0luaXRpYWxpemluZyA9IGZhbHNlO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn4yQIEVuaGFuY2VkIFB1cHBldGVlciBicm93c2VyIGluaXRpYWxpemVkIHN1Y2Nlc3NmdWxseScpO1xyXG4gICAgICAgIHJldHVybiB0aGlzLmJyb3dzZXI7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign8J+MkCBGYWlsZWQgdG8gaW5pdGlhbGl6ZSBQdXBwZXRlZXIgYnJvd3NlcjonLCBlcnJvcik7XHJcbiAgICAgICAgdGhpcy5pbml0aWFsaXphdGlvbkVycm9yID0gZXJyb3I7XHJcbiAgICAgICAgdGhpcy5icm93c2VyID0gbnVsbDtcclxuICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICB0aGlzLmlzSW5pdGlhbGl6aW5nID0gZmFsc2U7XHJcbiAgICAgIH1cclxuICAgIH0pKCk7XHJcbiAgICBcclxuICAgIHJldHVybiB0aGlzLmJyb3dzZXJQcm9taXNlO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogR2V0IHRoZSBicm93c2VyIGluc3RhbmNlLCBpbml0aWFsaXppbmcgaXQgaWYgbmVjZXNzYXJ5XHJcbiAgICogQHJldHVybnMge1Byb21pc2U8QnJvd3Nlcj59IFRoZSBicm93c2VyIGluc3RhbmNlXHJcbiAgICovXHJcbiAgYXN5bmMgZ2V0QnJvd3NlcigpIHtcclxuICAgIGlmICh0aGlzLmJyb3dzZXIpIHtcclxuICAgICAgcmV0dXJuIHRoaXMuYnJvd3NlcjtcclxuICAgIH1cclxuICAgIFxyXG4gICAgaWYgKHRoaXMuaW5pdGlhbGl6YXRpb25FcnJvcikge1xyXG4gICAgICBjb25zb2xlLmxvZygn8J+MkCBSZXRyeWluZyBicm93c2VyIGluaXRpYWxpemF0aW9uIGFmdGVyIHByZXZpb3VzIGZhaWx1cmUnKTtcclxuICAgIH1cclxuICAgIFxyXG4gICAgcmV0dXJuIHRoaXMuaW5pdGlhbGl6ZSgpO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ3JlYXRlIGEgbmV3IHBhZ2Ugd2l0aCBlbmhhbmNlZCBhbnRpLWRldGVjdGlvbiBtZWFzdXJlc1xyXG4gICAqIEByZXR1cm5zIHtQcm9taXNlPFBhZ2U+fSBBIGNvbmZpZ3VyZWQgcGFnZSBpbnN0YW5jZVxyXG4gICAqL1xyXG4gIGFzeW5jIGNyZWF0ZVBhZ2UoKSB7XHJcbiAgICBjb25zdCBicm93c2VyID0gYXdhaXQgdGhpcy5nZXRCcm93c2VyKCk7XHJcbiAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcblxyXG4gICAgLy8gU2V0IGxvbmdlciB0aW1lb3V0cyBmb3IgU1BBIGNvbnRlbnRcclxuICAgIGF3YWl0IHBhZ2Uuc2V0RGVmYXVsdE5hdmlnYXRpb25UaW1lb3V0KDMwMDAwKTtcclxuICAgIGF3YWl0IHBhZ2Uuc2V0RGVmYXVsdFRpbWVvdXQoMzAwMDApO1xyXG4gICAgXHJcbiAgICAvLyBFbmFibGUgYWRibG9ja2VyIGlmIGluaXRpYWxpemVkXHJcbiAgICBpZiAodGhpcy5ibG9ja2VyKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMuYmxvY2tlci5lbmFibGVCbG9ja2luZ0luUGFnZShwYWdlKTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBTZXQgdXAgY29tbW9uIHVzZXIgYWdlbnRcclxuICAgIGF3YWl0IHBhZ2Uuc2V0VXNlckFnZW50KCdNb3ppbGxhLzUuMCAoV2luZG93cyBOVCAxMC4wOyBXaW42NDsgeDY0KSBBcHBsZVdlYktpdC81MzcuMzYgKEtIVE1MLCBsaWtlIEdlY2tvKSBDaHJvbWUvMTIyLjAuMC4wIFNhZmFyaS81MzcuMzYnKTtcclxuXHJcbiAgICAvLyBTZXQgdmlld3BvcnQgdG8gZW5zdXJlIGFsbCBjb250ZW50IGlzIHZpc2libGVcclxuICAgIGF3YWl0IHBhZ2Uuc2V0Vmlld3BvcnQoe1xyXG4gICAgICB3aWR0aDogMTkyMCxcclxuICAgICAgaGVpZ2h0OiAxMDgwLFxyXG4gICAgICBkZXZpY2VTY2FsZUZhY3RvcjogMVxyXG4gICAgfSk7XHJcblxyXG4gICAgLy8gQWRkaXRpb25hbCBwYWdlIGNvbmZpZ3VyYXRpb25zIGZvciBSZWFjdC9TUEEgc3VwcG9ydFxyXG4gICAgYXdhaXQgcGFnZS5ldmFsdWF0ZU9uTmV3RG9jdW1lbnQoKCkgPT4ge1xyXG4gICAgICAvLyBBZGQgUmVhY3QgRGV2VG9vbHMgZ2xvYmFsIGhvb2tcclxuICAgICAgd2luZG93Ll9fUkVBQ1RfREVWVE9PTFNfR0xPQkFMX0hPT0tfXyA9IHtcclxuICAgICAgICByZW5kZXJlcnM6IG5ldyBNYXAoKSxcclxuICAgICAgICBzdXBwb3J0c0ZpYmVyOiB0cnVlLFxyXG4gICAgICAgIGluamVjdDogZnVuY3Rpb24oKSB7fSxcclxuICAgICAgICBvbkNvbW1pdEZpYmVyUm9vdDogZnVuY3Rpb24oKSB7fSxcclxuICAgICAgICBvbkNvbW1pdEZpYmVyVW5tb3VudDogZnVuY3Rpb24oKSB7fVxyXG4gICAgICB9O1xyXG4gICAgICAvLyBBZGQgbGFuZ3VhZ2UgY29uZmlndXJhdGlvblxyXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobmF2aWdhdG9yLCAnbGFuZ3VhZ2VzJywge1xyXG4gICAgICAgIGdldDogKCkgPT4gWydlbi1VUycsICdlbiddLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIEFkZCBkdW1teSBwbHVnaW5zXHJcbiAgICAgIE9iamVjdC5kZWZpbmVQcm9wZXJ0eShuYXZpZ2F0b3IsICdwbHVnaW5zJywge1xyXG4gICAgICAgIGdldDogKCkgPT4gQXJyYXkoMykuZmlsbCgpLm1hcCgoXywgaSkgPT4gKHtcclxuICAgICAgICAgIG5hbWU6IGBQbHVnaW4gJHtpICsgMX1gLFxyXG4gICAgICAgICAgZGVzY3JpcHRpb246IGBEdW1teSBwbHVnaW4gJHtpICsgMX1gLFxyXG4gICAgICAgICAgZmlsZW5hbWU6IGBwbHVnaW4ke2kgKyAxfS5kbGxgXHJcbiAgICAgICAgfSkpXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gU3Bvb2YgcGVybWlzc2lvbnMgQVBJXHJcbiAgICAgIGNvbnN0IG9yaWdpbmFsUXVlcnkgPSB3aW5kb3cubmF2aWdhdG9yLnBlcm1pc3Npb25zLnF1ZXJ5O1xyXG4gICAgICB3aW5kb3cubmF2aWdhdG9yLnBlcm1pc3Npb25zLnF1ZXJ5ID0gKHBhcmFtZXRlcnMpID0+IChcclxuICAgICAgICBwYXJhbWV0ZXJzLm5hbWUgPT09ICdub3RpZmljYXRpb25zJyA/XHJcbiAgICAgICAgUHJvbWlzZS5yZXNvbHZlKHsgc3RhdGU6IE5vdGlmaWNhdGlvbi5wZXJtaXNzaW9uIH0pIDpcclxuICAgICAgICBvcmlnaW5hbFF1ZXJ5KHBhcmFtZXRlcnMpXHJcbiAgICAgICk7XHJcblxyXG4gICAgICAvLyBPdmVycmlkZSB3ZWJkcml2ZXIgZmxhZ1xyXG4gICAgICBPYmplY3QuZGVmaW5lUHJvcGVydHkobmF2aWdhdG9yLCAnd2ViZHJpdmVyJywge1xyXG4gICAgICAgIGdldDogKCkgPT4gdW5kZWZpbmVkXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gQWRkIGR1bW15IHNjaGVkdWxlclxyXG4gICAgICB3aW5kb3cucmVxdWVzdElkbGVDYWxsYmFjayA9IHdpbmRvdy5yZXF1ZXN0SWRsZUNhbGxiYWNrIHx8ICgoY2IpID0+IHtcclxuICAgICAgICBjb25zdCBzdGFydCA9IERhdGUubm93KCk7XHJcbiAgICAgICAgcmV0dXJuIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgY2Ioe1xyXG4gICAgICAgICAgICBkaWRUaW1lb3V0OiBmYWxzZSxcclxuICAgICAgICAgICAgdGltZVJlbWFpbmluZzogKCkgPT4gTWF0aC5tYXgoMCwgNTAgLSAoRGF0ZS5ub3coKSAtIHN0YXJ0KSlcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgIH0sIDEpO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIEFkZCBjaHJvbWUgb2JqZWN0XHJcbiAgICAgIGlmICghd2luZG93LmNocm9tZSkge1xyXG4gICAgICAgIHdpbmRvdy5jaHJvbWUgPSB7XHJcbiAgICAgICAgICBydW50aW1lOiB7fSxcclxuICAgICAgICAgIHdlYnN0b3JlOiB7fVxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIC8vIEFkZCBoZWxwZXIgbWV0aG9kcyBmb3IgY29uc2lzdGVudCB3YWl0aW5nIGJlaGF2aW9yXHJcbiAgICBjb25zdCBvcmlnaW5hbFdhaXRGb3JUaW1lb3V0ID0gcGFnZS53YWl0Rm9yVGltZW91dDtcclxuICAgIHBhZ2Uud2FpdEZvclRpbWVvdXQgPSBhc3luYyAobXMpID0+IHtcclxuICAgICAgaWYgKCFtcykgbXMgPSAwO1xyXG4gICAgICByZXR1cm4gbmV3IFByb21pc2UocmVzb2x2ZSA9PiBzZXRUaW1lb3V0KHJlc29sdmUsIG1zKSk7XHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IG9yaWdpbmFsV2FpdEZvckZ1bmN0aW9uID0gcGFnZS53YWl0Rm9yRnVuY3Rpb247XHJcbiAgICBwYWdlLndhaXRGb3JGdW5jdGlvbiA9IGFzeW5jIChwYWdlRnVuY3Rpb24sIG9wdGlvbnMgPSB7fSwgLi4uYXJncykgPT4ge1xyXG4gICAgICAvLyBJZiBvcHRpb25zIGlzIGp1c3QgYSBudW1iZXIsIHRyZWF0IGl0IGFzIHRpbWVvdXRcclxuICAgICAgaWYgKHR5cGVvZiBvcHRpb25zID09PSAnbnVtYmVyJykge1xyXG4gICAgICAgIG9wdGlvbnMgPSB7IHRpbWVvdXQ6IG9wdGlvbnMgfTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgY29uc3QgZGVmYXVsdE9wdGlvbnMgPSB7XHJcbiAgICAgICAgdGltZW91dDogMzAwMDAsXHJcbiAgICAgICAgcG9sbGluZzogMTAwXHJcbiAgICAgIH07XHJcblxyXG4gICAgICByZXR1cm4gb3JpZ2luYWxXYWl0Rm9yRnVuY3Rpb24uY2FsbChcclxuICAgICAgICBwYWdlLFxyXG4gICAgICAgIHBhZ2VGdW5jdGlvbixcclxuICAgICAgICB7IC4uLmRlZmF1bHRPcHRpb25zLCAuLi5vcHRpb25zIH0sXHJcbiAgICAgICAgLi4uYXJnc1xyXG4gICAgICApO1xyXG4gICAgfTtcclxuXHJcbiAgICAvLyBFbmhhbmNlZCBhdXRvY29uc2VudCBzZXR1cCB3aXRoIHJldHJ5XHJcbiAgICBwYWdlLm9uY2UoJ2xvYWQnLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgY29uc3QgY3VycmVudFVybCA9IGF3YWl0IHBhZ2UudXJsKCk7XHJcbiAgICAgICAgLy8gV2FpdCBmb3IgcGFnZSB0byBiZSBmdWxseSBpbnRlcmFjdGl2ZVxyXG4gICAgICAgIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKCgpID0+IHtcclxuICAgICAgICAgIHJldHVybiBkb2N1bWVudC5yZWFkeVN0YXRlID09PSAnY29tcGxldGUnICYmIFxyXG4gICAgICAgICAgICAgICAgICEhZG9jdW1lbnQuYm9keSAmJlxyXG4gICAgICAgICAgICAgICAgICEhZG9jdW1lbnQucXVlcnlTZWxlY3RvcignYnV0dG9uLCBhLCBpbnB1dCcpO1xyXG4gICAgICAgIH0sIHsgdGltZW91dDogMTAwMDAgfSkuY2F0Y2goKCkgPT4gY29uc29sZS5sb2coJ1BhZ2UgaW50ZXJhY3Rpb24gd2FpdCB0aW1lZCBvdXQnKSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gVHJ5IGF1dG9jb25zZW50XHJcbiAgICAgICAgY29uc3QgdGFiID0gYXV0b2NvbnNlbnQuYXR0YWNoVG9QYWdlKHBhZ2UsIGN1cnJlbnRVcmwsIHRoaXMucnVsZXMsIDIwKTtcclxuICAgICAgICBhd2FpdCB0YWIuY2hlY2tlZDtcclxuICAgICAgICBhd2FpdCB0YWIuZG9PcHRJbigpLmNhdGNoKCgpID0+IGNvbnNvbGUubG9nKCdDb29raWUgY29uc2VudCBoYW5kbGluZyBmYWlsZWQnKSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkaXRpb25hbCB3YWl0IGZvciBhbnkgcG9zdC1jb25zZW50IHJlZmxvd3NcclxuICAgICAgICBhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDEwMDApO1xyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdDTVAgaGFuZGxpbmcgZXJyb3I6JywgZSk7XHJcbiAgICAgICAgLy8gQ29udGludWUgYW55d2F5IGFzIHRoaXMgc2hvdWxkbid0IGJsb2NrIGNvbnRlbnQgZXh0cmFjdGlvblxyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICAvLyBBZGQgaGVscGVyIG1ldGhvZCBmb3Igd2FpdGluZyBmb3IgbmV0d29yayBhbmQgY29udGVudCB0byBzZXR0bGVcclxuICAgIHBhZ2Uud2FpdEZvckNvbnRlbnRUb1NldHRsZSA9IGFzeW5jICh0aW1lb3V0ID0gMTAwMDApID0+IHtcclxuICAgICAgY29uc3Qgc3RhcnRUaW1lID0gRGF0ZS5ub3coKTtcclxuICAgICAgXHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgLy8gV2FpdCBmb3IgbmV0d29yayB0byBiZSBpZGxlXHJcbiAgICAgICAgYXdhaXQgcGFnZS53YWl0Rm9yTmV0d29ya0lkbGUoeyBpZGxlVGltZTogMTAwMCwgdGltZW91dDogNTAwMCB9KVxyXG4gICAgICAgICAgLmNhdGNoKCgpID0+IGNvbnNvbGUubG9nKCdOZXR3b3JrIGlkbGUgdGltZW91dCByZWFjaGVkJykpO1xyXG5cclxuICAgICAgICAvLyBXYWl0IGZvciBubyBzaWduaWZpY2FudCBET00gY2hhbmdlc1xyXG4gICAgICAgIGF3YWl0IHBhZ2Uud2FpdEZvckZ1bmN0aW9uKCgpID0+IHtcclxuICAgICAgICAgIHJldHVybiBuZXcgUHJvbWlzZShyZXNvbHZlID0+IHtcclxuICAgICAgICAgICAgbGV0IG11dGF0aW9ucyA9IDA7XHJcbiAgICAgICAgICAgIGNvbnN0IG9ic2VydmVyID0gbmV3IE11dGF0aW9uT2JzZXJ2ZXIobXV0YXRpb25zTGlzdCA9PiB7XHJcbiAgICAgICAgICAgICAgbXV0YXRpb25zICs9IG11dGF0aW9uc0xpc3QubGVuZ3RoO1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIG9ic2VydmVyLm9ic2VydmUoZG9jdW1lbnQuYm9keSwge1xyXG4gICAgICAgICAgICAgIGNoaWxkTGlzdDogdHJ1ZSxcclxuICAgICAgICAgICAgICBzdWJ0cmVlOiB0cnVlLFxyXG4gICAgICAgICAgICAgIGF0dHJpYnV0ZXM6IHRydWUsXHJcbiAgICAgICAgICAgICAgY2hhcmFjdGVyRGF0YTogdHJ1ZVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgICAgIG9ic2VydmVyLmRpc2Nvbm5lY3QoKTtcclxuICAgICAgICAgICAgICByZXNvbHZlKG11dGF0aW9ucyA8IDEwKTsgLy8gQ29uc2lkZXIgc3RhYmxlIGlmIGZldyBtdXRhdGlvbnNcclxuICAgICAgICAgICAgfSwgMTAwMCk7XHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICB9LCB7IHRpbWVvdXQgfSk7XHJcblxyXG4gICAgICB9IGNhdGNoIChlKSB7XHJcbiAgICAgICAgY29uc29sZS53YXJuKCdDb250ZW50IHNldHRsZW1lbnQgdGltZW91dDonLCBlKTtcclxuICAgICAgfVxyXG4gICAgICBcclxuICAgICAgLy8gRW5zdXJlIG1pbmltdW0gd2FpdCB0aW1lXHJcbiAgICAgIGNvbnN0IGVsYXBzZWQgPSBEYXRlLm5vdygpIC0gc3RhcnRUaW1lO1xyXG4gICAgICBpZiAoZWxhcHNlZCA8IDIwMDApIHtcclxuICAgICAgICBhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KDIwMDAgLSBlbGFwc2VkKTtcclxuICAgICAgfVxyXG4gICAgfTtcclxuICAgIFxyXG4gICAgcmV0dXJuIHBhZ2U7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBDbG9zZSB0aGUgYnJvd3NlciBpbnN0YW5jZVxyXG4gICAqL1xyXG4gIGFzeW5jIGNsb3NlKCkge1xyXG4gICAgaWYgKHRoaXMuYnJvd3Nlcikge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnNvbGUubG9nKCfwn4yQIENsb3NpbmcgUHVwcGV0ZWVyIGJyb3dzZXIuLi4nKTtcclxuICAgICAgICBhd2FpdCB0aGlzLmJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICBjb25zb2xlLmxvZygn8J+MkCBQdXBwZXRlZXIgYnJvd3NlciBjbG9zZWQgc3VjY2Vzc2Z1bGx5Jyk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc29sZS5lcnJvcign8J+MkCBFcnJvciBjbG9zaW5nIFB1cHBldGVlciBicm93c2VyOicsIGVycm9yKTtcclxuICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICB0aGlzLmJyb3dzZXIgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuYnJvd3NlclByb21pc2UgPSBudWxsO1xyXG4gICAgICAgIHRoaXMuaXNJbml0aWFsaXppbmcgPSBmYWxzZTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ2hlY2sgaWYgdGhlIGJyb3dzZXIgaXMgaW5pdGlhbGl6ZWRcclxuICAgKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgYnJvd3NlciBpcyBpbml0aWFsaXplZFxyXG4gICAqL1xyXG4gIGlzSW5pdGlhbGl6ZWQoKSB7XHJcbiAgICByZXR1cm4gISF0aGlzLmJyb3dzZXI7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBHZXQgdGhlIGluaXRpYWxpemF0aW9uIHN0YXR1c1xyXG4gICAqIEByZXR1cm5zIHtPYmplY3R9IFRoZSBpbml0aWFsaXphdGlvbiBzdGF0dXNcclxuICAgKi9cclxuICBnZXRTdGF0dXMoKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBpbml0aWFsaXplZDogISF0aGlzLmJyb3dzZXIsXHJcbiAgICAgIGluaXRpYWxpemluZzogdGhpcy5pc0luaXRpYWxpemluZyxcclxuICAgICAgZXJyb3I6IHRoaXMuaW5pdGlhbGl6YXRpb25FcnJvciA/IHRoaXMuaW5pdGlhbGl6YXRpb25FcnJvci5tZXNzYWdlIDogbnVsbFxyXG4gICAgfTtcclxuICB9XHJcbn1cclxuXHJcbi8vIEV4cG9ydCBhIHNpbmdsZXRvbiBpbnN0YW5jZVxyXG5tb2R1bGUuZXhw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