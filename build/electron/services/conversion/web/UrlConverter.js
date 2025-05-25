"use strict";

/**
 * UrlConverter.js
 * Handles conversion of web pages to markdown format in the Electron main process.
 * 
 * This converter:
 * - Fetches web pages using puppeteer
 * - Extracts content, metadata, and images
 * - Handles JavaScript-rendered content
 * - Generates markdown with structured content
 * 
 * Related Files:
 * - BaseService.js: Parent class providing IPC handling
 * - FileStorageService.js: For temporary file management
 * - ParentUrlConverter.js: For multi-page site conversion
 * - ConversionService.js: Registers and uses this converter
 */

const path = require('path');
const fs = require('fs-extra');
const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const {
  URL
} = require('url');
const BaseService = require('../../BaseService');
class UrlConverter extends BaseService {
  constructor(fileProcessor, fileStorage) {
    super();
    this.fileProcessor = fileProcessor;
    this.fileStorage = fileStorage;
    this.supportedProtocols = ['http:', 'https:'];
    this.activeConversions = new Map();
  }

  /**
   * Set up IPC handlers for URL conversion
   */
  setupIpcHandlers() {
    this.registerHandler('convert:url', this.handleConvert.bind(this));
    this.registerHandler('convert:url:metadata', this.handleGetMetadata.bind(this));
    this.registerHandler('convert:url:screenshot', this.handleScreenshot.bind(this));
    this.registerHandler('convert:url:cancel', this.handleCancel.bind(this));
  }

  /**
   * Handle URL conversion request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Conversion request details
   */
  async handleConvert(event, {
    url,
    options = {}
  }) {
    try {
      // Validate URL
      const parsedUrl = new URL(url);
      if (!this.supportedProtocols.includes(parsedUrl.protocol)) {
        throw new Error(`Unsupported protocol: ${parsedUrl.protocol}`);
      }
      const conversionId = this.generateConversionId();
      const window = event?.sender?.getOwnerBrowserWindow?.() || null;

      // Create temp directory for this conversion
      const tempDir = await this.fileStorage.createTempDir('url_conversion');
      this.activeConversions.set(conversionId, {
        id: conversionId,
        status: 'starting',
        progress: 0,
        url,
        tempDir,
        window
      });

      // Notify client that conversion has started (only if we have a valid window)
      if (window && window.webContents) {
        window.webContents.send('url:conversion-started', {
          conversionId
        });
      }

      // Start conversion process
      this.processConversion(conversionId, url, options).catch(error => {
        console.error(`[UrlConverter] Conversion failed for ${conversionId}:`, error);
        this.updateConversionStatus(conversionId, 'failed', {
          error: error.message
        });

        // Clean up temp directory
        fs.remove(tempDir).catch(err => {
          console.error(`[UrlConverter] Failed to clean up temp directory: ${tempDir}`, err);
        });
      });
      return {
        conversionId
      };
    } catch (error) {
      console.error('[UrlConverter] Failed to start conversion:', error);
      throw error;
    }
  }

  /**
   * Handle URL metadata request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Metadata request details
   */
  async handleGetMetadata(event, {
    url
  }) {
    try {
      const metadata = await this.fetchMetadata(url);
      return metadata;
    } catch (error) {
      console.error('[UrlConverter] Failed to get metadata:', error);
      throw error;
    }
  }

  /**
   * Handle URL screenshot request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Screenshot request details
   */
  async handleScreenshot(event, {
    url,
    options = {}
  }) {
    try {
      const tempDir = await this.fileStorage.createTempDir('url_screenshot');
      const screenshotPath = path.join(tempDir, 'screenshot.png');
      await this.captureScreenshot(url, screenshotPath, options);

      // Read the screenshot as base64
      const screenshotData = await fs.readFile(screenshotPath, {
        encoding: 'base64'
      });

      // Clean up temp directory
      await fs.remove(tempDir);
      return {
        data: `data:image/png;base64,${screenshotData}`,
        url
      };
    } catch (error) {
      console.error('[UrlConverter] Failed to capture screenshot:', error);
      throw error;
    }
  }

  /**
   * Handle conversion cancellation request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Cancellation request details
   */
  async handleCancel(event, {
    conversionId
  }) {
    const conversion = this.activeConversions.get(conversionId);
    if (conversion) {
      conversion.status = 'cancelled';
      if (conversion.browser) {
        await conversion.browser.close();
      }
      if (conversion.window) {
        conversion.window.webContents.send('url:conversion-cancelled', {
          conversionId
        });
      }

      // Clean up temp directory
      if (conversion.tempDir) {
        await fs.remove(conversion.tempDir);
      }
      this.activeConversions.delete(conversionId);
    }
    return {
      success: true
    };
  }

  /**
   * Process URL conversion
   * @param {string} conversionId - Conversion identifier
   * @param {string} url - URL to convert
   * @param {Object} options - Conversion options
   */
  async processConversion(conversionId, url, options) {
    let browser = null;
    try {
      const conversion = this.activeConversions.get(conversionId);
      if (!conversion) {
        throw new Error('Conversion not found');
      }
      const tempDir = conversion.tempDir;

      // Launch browser
      this.updateConversionStatus(conversionId, 'launching_browser', {
        progress: 5
      });
      browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      conversion.browser = browser;

      // Fetch metadata
      this.updateConversionStatus(conversionId, 'fetching_metadata', {
        progress: 10
      });
      const metadata = await this.fetchMetadata(url, browser);

      // Capture screenshot if requested
      let screenshot = null;
      if (options.includeScreenshot) {
        this.updateConversionStatus(conversionId, 'capturing_screenshot', {
          progress: 20
        });
        const screenshotPath = path.join(tempDir, 'screenshot.png');
        await this.captureScreenshot(url, screenshotPath, options, browser);

        // Read screenshot as base64
        const screenshotData = await fs.readFile(screenshotPath, {
          encoding: 'base64'
        });
        screenshot = `data:image/png;base64,${screenshotData}`;
      }

      // Extract content
      this.updateConversionStatus(conversionId, 'extracting_content', {
        progress: 40
      });
      const content = await this.extractContent(url, options, browser);

      // Process images if requested
      if (options.includeImages) {
        this.updateConversionStatus(conversionId, 'processing_images', {
          progress: 60
        });
        await this.processImages(content, tempDir, url, browser);
      }

      // Generate markdown
      this.updateConversionStatus(conversionId, 'generating_markdown', {
        progress: 80
      });
      const markdown = this.generateMarkdown(metadata, content, screenshot, options);

      // Close browser
      await browser.close();
      conversion.browser = null;

      // Clean up temp directory
      await fs.remove(tempDir);
      this.updateConversionStatus(conversionId, 'completed', {
        progress: 100,
        result: markdown
      });
      return markdown;
    } catch (error) {
      console.error('[UrlConverter] Conversion processing failed:', error);

      // Close browser if open
      if (browser) {
        await browser.close();
      }
      throw error;
    }
  }

  /**
   * Fetch metadata from URL
   * @param {string} url - URL to fetch
   * @param {puppeteer.Browser} [existingBrowser] - Existing browser instance
   * @returns {Promise<Object>} URL metadata
   */
  async fetchMetadata(url, existingBrowser = null) {
    let browser = existingBrowser;
    let shouldCloseBrowser = false;
    try {
      if (!browser) {
        browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        shouldCloseBrowser = true;
      }
      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Extract metadata
      const metadata = await page.evaluate(() => {
        const getMetaContent = name => {
          const element = document.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
          return element ? element.getAttribute('content') : null;
        };
        return {
          title: document.title,
          description: getMetaContent('description') || getMetaContent('og:description'),
          keywords: getMetaContent('keywords'),
          author: getMetaContent('author'),
          ogTitle: getMetaContent('og:title'),
          ogImage: getMetaContent('og:image'),
          ogType: getMetaContent('og:type'),
          ogUrl: getMetaContent('og:url'),
          favicon: document.querySelector('link[rel="icon"], link[rel="shortcut icon"]')?.href
        };
      });

      // Add URL information
      const parsedUrl = new URL(url);
      metadata.url = url;
      metadata.domain = parsedUrl.hostname;
      metadata.path = parsedUrl.pathname;
      await page.close();
      if (shouldCloseBrowser) {
        await browser.close();
      }
      return metadata;
    } catch (error) {
      console.error('[UrlConverter] Failed to fetch metadata:', error);
      if (shouldCloseBrowser && browser) {
        await browser.close();
      }
      throw error;
    }
  }

  /**
   * Capture screenshot of URL
   * @param {string} url - URL to capture
   * @param {string} outputPath - Output path for screenshot
   * @param {Object} options - Screenshot options
   * @param {puppeteer.Browser} [existingBrowser] - Existing browser instance
   * @returns {Promise<void>}
   */
  async captureScreenshot(url, outputPath, options = {}, existingBrowser = null) {
    let browser = existingBrowser;
    let shouldCloseBrowser = false;
    try {
      if (!browser) {
        browser = await puppeteer.launch({
          headless: 'new',
          args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        shouldCloseBrowser = true;
      }
      const page = await browser.newPage();

      // Set viewport size
      const width = options.width || 1280;
      const height = options.height || 800;
      await page.setViewport({
        width,
        height
      });

      // Navigate to URL
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait for additional time if specified
      if (options.waitTime) {
        await page.waitForTimeout(options.waitTime);
      }

      // Capture screenshot
      await page.screenshot({
        path: outputPath,
        fullPage: options.fullPage || false,
        type: 'png'
      });
      await page.close();
      if (shouldCloseBrowser) {
        await browser.close();
      }
    } catch (error) {
      console.error('[UrlConverter] Failed to capture screenshot:', error);
      if (shouldCloseBrowser && browser) {
        await browser.close();
      }
      throw error;
    }
  }

  /**
   * Extract content from URL
   * @param {string} url - URL to extract content from
   * @param {Object} options - Extraction options
   * @param {puppeteer.Browser} browser - Browser instance
   * @returns {Promise<Object>} Extracted content
   */
  async extractContent(url, options, browser) {
    try {
      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Wait for additional time if specified
      if (options.waitTime) {
        await page.waitForTimeout(options.waitTime);
      }

      // Get page HTML
      const html = await page.content();

      // Extract content using cheerio
      const $ = cheerio.load(html);

      // Remove unwanted elements
      $('script, style, iframe, noscript').remove();

      // Extract main content
      let mainContent = '';
      const mainSelectors = ['main', 'article', '#content', '.content', '.main', '.article', '.post', '.post-content'];

      // Try to find main content using common selectors
      for (const selector of mainSelectors) {
        if ($(selector).length > 0) {
          mainContent = $(selector).html();
          break;
        }
      }

      // If no main content found, use body
      if (!mainContent) {
        mainContent = $('body').html();
      }

      // Extract images
      const images = [];
      $('img').each((i, el) => {
        const src = $(el).attr('src');
        const alt = $(el).attr('alt') || '';
        if (src) {
          // Resolve relative URLs
          const absoluteSrc = new URL(src, url).href;
          images.push({
            src: absoluteSrc,
            alt,
            filename: path.basename(absoluteSrc)
          });
        }
      });

      // Extract links
      const links = [];
      $('a').each((i, el) => {
        const href = $(el).attr('href');
        const text = $(el).text().trim();
        if (href && !href.startsWith('#') && !href.startsWith('javascript:')) {
          // Resolve relative URLs
          const absoluteHref = new URL(href, url).href;
          links.push({
            href: absoluteHref,
            text: text || absoluteHref
          });
        }
      });
      await page.close();
      return {
        html: mainContent,
        images,
        links
      };
    } catch (error) {
      console.error('[UrlConverter] Failed to extract content:', error);
      throw error;
    }
  }

  /**
   * Process images from content
   * @param {Object} content - Extracted content
   * @param {string} tempDir - Temporary directory
   * @param {string} baseUrl - Base URL for resolving relative paths
   * @param {puppeteer.Browser} browser - Browser instance
   * @returns {Promise<void>}
   */
  async processImages(content, tempDir, baseUrl, browser) {
    // For Obsidian compatibility, we just keep the image URLs as-is
    // No need to download images - Obsidian will handle them as external links
    console.log(`[UrlConverter] Processing ${content.images.length} images as external links for Obsidian`);
  }

  /**
   * Generate markdown from URL content
   * @param {Object} metadata - URL metadata
   * @param {Object} content - Extracted content
   * @param {string} screenshot - Screenshot data URL
   * @param {Object} options - Conversion options
   * @returns {string} Markdown content
   */
  generateMarkdown(metadata, content, screenshot, options) {
    const markdown = [];

    // Get current datetime
    const now = new Date();
    const convertedDate = now.toISOString().split('.')[0].replace('T', ' ');

    // Get the title from metadata or options
    const pageTitle = options.title || metadata.title || `Web Page: ${metadata.url}`;

    // Create standardized frontmatter using metadata utility
    const {
      createStandardFrontmatter
    } = require('../../../converters/utils/metadata');
    const frontmatter = createStandardFrontmatter({
      title: pageTitle,
      fileType: 'url'
    });
    markdown.push(frontmatter.trim());

    // Add title as heading
    markdown.push(`# ${pageTitle}`);
    markdown.push('');

    // Add metadata
    markdown.push('## Page Information');
    markdown.push('');
    markdown.push('| Property | Value |');
    markdown.push('| --- | --- |');
    markdown.push(`| URL | [${metadata.url}](${metadata.url}) |`);
    markdown.push(`| Domain | ${metadata.domain} |`);
    if (metadata.title) markdown.push(`| Title | ${metadata.title} |`);
    if (metadata.description) markdown.push(`| Description | ${metadata.description} |`);
    if (metadata.author) markdown.push(`| Author | ${metadata.author} |`);
    if (metadata.keywords) markdown.push(`| Keywords | ${metadata.keywords} |`);
    markdown.push('');

    // Add screenshot if available
    if (screenshot) {
      markdown.push('## Screenshot');
      markdown.push('');
      markdown.push(`![Screenshot of ${metadata.title || metadata.url}](${screenshot})`);
      markdown.push('');
    }

    // Add content
    markdown.push('## Content');
    markdown.push('');

    // Convert HTML to markdown
    const TurndownService = require('turndown');
    const turndownService = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
      emDelimiter: '*'
    });

    // Customize turndown - no special handling needed for images
    // Just use the original URLs for Obsidian compatibility

    const markdownContent = turndownService.turndown(content.html);
    markdown.push(markdownContent);

    // Add links section if requested
    if (options.includeLinks && content.links && content.links.length > 0) {
      markdown.push('');
      markdown.push('## Links');
      markdown.push('');
      content.links.forEach(link => {
        markdown.push(`- [${link.text}](${link.href})`);
      });
    }
    return markdown.join('\n');
  }

  /**
   * Generate unique conversion ID
   * @returns {string} Unique conversion ID
   */
  generateConversionId() {
    return `url_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update conversion status and notify renderer
   * @param {string} conversionId - Conversion identifier
   * @param {string} status - New status
   * @param {Object} details - Additional details
   */
  updateConversionStatus(conversionId, status, details = {}) {
    const conversion = this.activeConversions.get(conversionId);
    if (conversion) {
      conversion.status = status;
      Object.assign(conversion, details);
      if (conversion.window) {
        conversion.window.webContents.send('url:conversion-progress', {
          conversionId,
          status,
          ...details
        });
      }
    }
  }

  /**
   * Check if this converter supports the given URL
   * @param {string} url - URL to check
   * @returns {boolean} True if supported
   */
  supportsUrl(url) {
    try {
      const parsedUrl = new URL(url);
      return this.supportedProtocols.includes(parsedUrl.protocol);
    } catch (error) {
      return false;
    }
  }

  /**
   * Get converter information
   * @returns {Object} Converter details
   */
  getInfo() {
    return {
      name: 'URL Converter',
      protocols: this.supportedProtocols,
      description: 'Converts web pages to markdown with Obsidian-compatible image links',
      options: {
        title: 'Optional page title',
        includeScreenshot: 'Whether to include page screenshot (default: false)',
        includeImages: 'Whether to include images as external links (default: true)',
        includeLinks: 'Whether to include links section (default: true)',
        waitTime: 'Additional time to wait for page load in ms'
      }
    };
  }
}
module.exports = UrlConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwicHVwcGV0ZWVyIiwiY2hlZXJpbyIsIlVSTCIsIkJhc2VTZXJ2aWNlIiwiVXJsQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJzdXBwb3J0ZWRQcm90b2NvbHMiLCJhY3RpdmVDb252ZXJzaW9ucyIsIk1hcCIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlU2NyZWVuc2hvdCIsImhhbmRsZUNhbmNlbCIsImV2ZW50IiwidXJsIiwib3B0aW9ucyIsInBhcnNlZFVybCIsImluY2x1ZGVzIiwicHJvdG9jb2wiLCJFcnJvciIsImNvbnZlcnNpb25JZCIsImdlbmVyYXRlQ29udmVyc2lvbklkIiwid2luZG93Iiwic2VuZGVyIiwiZ2V0T3duZXJCcm93c2VyV2luZG93IiwidGVtcERpciIsImNyZWF0ZVRlbXBEaXIiLCJzZXQiLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwid2ViQ29udGVudHMiLCJzZW5kIiwicHJvY2Vzc0NvbnZlcnNpb24iLCJjYXRjaCIsImVycm9yIiwiY29uc29sZSIsInVwZGF0ZUNvbnZlcnNpb25TdGF0dXMiLCJtZXNzYWdlIiwicmVtb3ZlIiwiZXJyIiwibWV0YWRhdGEiLCJmZXRjaE1ldGFkYXRhIiwic2NyZWVuc2hvdFBhdGgiLCJqb2luIiwiY2FwdHVyZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90RGF0YSIsInJlYWRGaWxlIiwiZW5jb2RpbmciLCJkYXRhIiwiY29udmVyc2lvbiIsImdldCIsImJyb3dzZXIiLCJjbG9zZSIsImRlbGV0ZSIsInN1Y2Nlc3MiLCJsYXVuY2giLCJoZWFkbGVzcyIsImFyZ3MiLCJzY3JlZW5zaG90IiwiaW5jbHVkZVNjcmVlbnNob3QiLCJjb250ZW50IiwiZXh0cmFjdENvbnRlbnQiLCJpbmNsdWRlSW1hZ2VzIiwicHJvY2Vzc0ltYWdlcyIsIm1hcmtkb3duIiwiZ2VuZXJhdGVNYXJrZG93biIsInJlc3VsdCIsImV4aXN0aW5nQnJvd3NlciIsInNob3VsZENsb3NlQnJvd3NlciIsInBhZ2UiLCJuZXdQYWdlIiwiZ290byIsIndhaXRVbnRpbCIsInRpbWVvdXQiLCJldmFsdWF0ZSIsImdldE1ldGFDb250ZW50IiwibmFtZSIsImVsZW1lbnQiLCJkb2N1bWVudCIsInF1ZXJ5U2VsZWN0b3IiLCJnZXRBdHRyaWJ1dGUiLCJ0aXRsZSIsImRlc2NyaXB0aW9uIiwia2V5d29yZHMiLCJhdXRob3IiLCJvZ1RpdGxlIiwib2dJbWFnZSIsIm9nVHlwZSIsIm9nVXJsIiwiZmF2aWNvbiIsImhyZWYiLCJkb21haW4iLCJob3N0bmFtZSIsInBhdGhuYW1lIiwib3V0cHV0UGF0aCIsIndpZHRoIiwiaGVpZ2h0Iiwic2V0Vmlld3BvcnQiLCJ3YWl0VGltZSIsIndhaXRGb3JUaW1lb3V0IiwiZnVsbFBhZ2UiLCJ0eXBlIiwiaHRtbCIsIiQiLCJsb2FkIiwibWFpbkNvbnRlbnQiLCJtYWluU2VsZWN0b3JzIiwic2VsZWN0b3IiLCJsZW5ndGgiLCJpbWFnZXMiLCJlYWNoIiwiaSIsImVsIiwic3JjIiwiYXR0ciIsImFsdCIsImFic29sdXRlU3JjIiwicHVzaCIsImZpbGVuYW1lIiwiYmFzZW5hbWUiLCJsaW5rcyIsInRleHQiLCJ0cmltIiwic3RhcnRzV2l0aCIsImFic29sdXRlSHJlZiIsImJhc2VVcmwiLCJsb2ciLCJub3ciLCJEYXRlIiwiY29udmVydGVkRGF0ZSIsInRvSVNPU3RyaW5nIiwic3BsaXQiLCJyZXBsYWNlIiwicGFnZVRpdGxlIiwiY3JlYXRlU3RhbmRhcmRGcm9udG1hdHRlciIsImZyb250bWF0dGVyIiwiZmlsZVR5cGUiLCJUdXJuZG93blNlcnZpY2UiLCJ0dXJuZG93blNlcnZpY2UiLCJoZWFkaW5nU3R5bGUiLCJjb2RlQmxvY2tTdHlsZSIsImVtRGVsaW1pdGVyIiwibWFya2Rvd25Db250ZW50IiwidHVybmRvd24iLCJpbmNsdWRlTGlua3MiLCJmb3JFYWNoIiwibGluayIsIk1hdGgiLCJyYW5kb20iLCJ0b1N0cmluZyIsInN1YnN0ciIsImRldGFpbHMiLCJPYmplY3QiLCJhc3NpZ24iLCJzdXBwb3J0c1VybCIsImdldEluZm8iLCJwcm90b2NvbHMiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vd2ViL1VybENvbnZlcnRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogVXJsQ29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiB3ZWIgcGFnZXMgdG8gbWFya2Rvd24gZm9ybWF0IGluIHRoZSBFbGVjdHJvbiBtYWluIHByb2Nlc3MuXHJcbiAqIFxyXG4gKiBUaGlzIGNvbnZlcnRlcjpcclxuICogLSBGZXRjaGVzIHdlYiBwYWdlcyB1c2luZyBwdXBwZXRlZXJcclxuICogLSBFeHRyYWN0cyBjb250ZW50LCBtZXRhZGF0YSwgYW5kIGltYWdlc1xyXG4gKiAtIEhhbmRsZXMgSmF2YVNjcmlwdC1yZW5kZXJlZCBjb250ZW50XHJcbiAqIC0gR2VuZXJhdGVzIG1hcmtkb3duIHdpdGggc3RydWN0dXJlZCBjb250ZW50XHJcbiAqIFxyXG4gKiBSZWxhdGVkIEZpbGVzOlxyXG4gKiAtIEJhc2VTZXJ2aWNlLmpzOiBQYXJlbnQgY2xhc3MgcHJvdmlkaW5nIElQQyBoYW5kbGluZ1xyXG4gKiAtIEZpbGVTdG9yYWdlU2VydmljZS5qczogRm9yIHRlbXBvcmFyeSBmaWxlIG1hbmFnZW1lbnRcclxuICogLSBQYXJlbnRVcmxDb252ZXJ0ZXIuanM6IEZvciBtdWx0aS1wYWdlIHNpdGUgY29udmVyc2lvblxyXG4gKiAtIENvbnZlcnNpb25TZXJ2aWNlLmpzOiBSZWdpc3RlcnMgYW5kIHVzZXMgdGhpcyBjb252ZXJ0ZXJcclxuICovXHJcblxyXG5jb25zdCBwYXRoID0gcmVxdWlyZSgncGF0aCcpO1xyXG5jb25zdCBmcyA9IHJlcXVpcmUoJ2ZzLWV4dHJhJyk7XHJcbmNvbnN0IHB1cHBldGVlciA9IHJlcXVpcmUoJ3B1cHBldGVlcicpO1xyXG5jb25zdCBjaGVlcmlvID0gcmVxdWlyZSgnY2hlZXJpbycpO1xyXG5jb25zdCB7IFVSTCB9ID0gcmVxdWlyZSgndXJsJyk7XHJcbmNvbnN0IEJhc2VTZXJ2aWNlID0gcmVxdWlyZSgnLi4vLi4vQmFzZVNlcnZpY2UnKTtcclxuXHJcbmNsYXNzIFVybENvbnZlcnRlciBleHRlbmRzIEJhc2VTZXJ2aWNlIHtcclxuICAgIGNvbnN0cnVjdG9yKGZpbGVQcm9jZXNzb3IsIGZpbGVTdG9yYWdlKSB7XHJcbiAgICAgICAgc3VwZXIoKTtcclxuICAgICAgICB0aGlzLmZpbGVQcm9jZXNzb3IgPSBmaWxlUHJvY2Vzc29yO1xyXG4gICAgICAgIHRoaXMuZmlsZVN0b3JhZ2UgPSBmaWxlU3RvcmFnZTtcclxuICAgICAgICB0aGlzLnN1cHBvcnRlZFByb3RvY29scyA9IFsnaHR0cDonLCAnaHR0cHM6J107XHJcbiAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucyA9IG5ldyBNYXAoKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIFVSTCBjb252ZXJzaW9uXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6dXJsJywgdGhpcy5oYW5kbGVDb252ZXJ0LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnVybDptZXRhZGF0YScsIHRoaXMuaGFuZGxlR2V0TWV0YWRhdGEuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6dXJsOnNjcmVlbnNob3QnLCB0aGlzLmhhbmRsZVNjcmVlbnNob3QuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6dXJsOmNhbmNlbCcsIHRoaXMuaGFuZGxlQ2FuY2VsLmJpbmQodGhpcykpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIFVSTCBjb252ZXJzaW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IHVybCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBVUkxcclxuICAgICAgICAgICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTCh1cmwpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuc3VwcG9ydGVkUHJvdG9jb2xzLmluY2x1ZGVzKHBhcnNlZFVybC5wcm90b2NvbCkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcHJvdG9jb2w6ICR7cGFyc2VkVXJsLnByb3RvY29sfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uSWQgPSB0aGlzLmdlbmVyYXRlQ29udmVyc2lvbklkKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50Py5zZW5kZXI/LmdldE93bmVyQnJvd3NlcldpbmRvdz8uKCkgfHwgbnVsbDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSB0ZW1wIGRpcmVjdG9yeSBmb3IgdGhpcyBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3VybF9jb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcclxuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdzdGFydGluZycsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcclxuICAgICAgICAgICAgICAgIHVybCxcclxuICAgICAgICAgICAgICAgIHRlbXBEaXIsXHJcbiAgICAgICAgICAgICAgICB3aW5kb3dcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBOb3RpZnkgY2xpZW50IHRoYXQgY29udmVyc2lvbiBoYXMgc3RhcnRlZCAob25seSBpZiB3ZSBoYXZlIGEgdmFsaWQgd2luZG93KVxyXG4gICAgICAgICAgICBpZiAod2luZG93ICYmIHdpbmRvdy53ZWJDb250ZW50cykge1xyXG4gICAgICAgICAgICAgICAgd2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ3VybDpjb252ZXJzaW9uLXN0YXJ0ZWQnLCB7IGNvbnZlcnNpb25JZCB9KTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gU3RhcnQgY29udmVyc2lvbiBwcm9jZXNzXHJcbiAgICAgICAgICAgIHRoaXMucHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB1cmwsIG9wdGlvbnMpLmNhdGNoKGVycm9yID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtVcmxDb252ZXJ0ZXJdIENvbnZlcnNpb24gZmFpbGVkIGZvciAke2NvbnZlcnNpb25JZH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2ZhaWxlZCcsIHsgZXJyb3I6IGVycm9yLm1lc3NhZ2UgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgICAgICBmcy5yZW1vdmUodGVtcERpcikuY2F0Y2goZXJyID0+IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQ29udmVydGVyXSBGYWlsZWQgdG8gY2xlYW4gdXAgdGVtcCBkaXJlY3Rvcnk6ICR7dGVtcERpcn1gLCBlcnIpO1xyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHsgY29udmVyc2lvbklkIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIHN0YXJ0IGNvbnZlcnNpb246JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgVVJMIG1ldGFkYXRhIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBNZXRhZGF0YSByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlR2V0TWV0YWRhdGEoZXZlbnQsIHsgdXJsIH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHRoaXMuZmV0Y2hNZXRhZGF0YSh1cmwpO1xyXG4gICAgICAgICAgICByZXR1cm4gbWV0YWRhdGE7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBtZXRhZGF0YTonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBVUkwgc2NyZWVuc2hvdCByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gU2NyZWVuc2hvdCByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlU2NyZWVuc2hvdChldmVudCwgeyB1cmwsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcigndXJsX3NjcmVlbnNob3QnKTtcclxuICAgICAgICAgICAgY29uc3Qgc2NyZWVuc2hvdFBhdGggPSBwYXRoLmpvaW4odGVtcERpciwgJ3NjcmVlbnNob3QucG5nJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVTY3JlZW5zaG90KHVybCwgc2NyZWVuc2hvdFBhdGgsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUmVhZCB0aGUgc2NyZWVuc2hvdCBhcyBiYXNlNjRcclxuICAgICAgICAgICAgY29uc3Qgc2NyZWVuc2hvdERhdGEgPSBhd2FpdCBmcy5yZWFkRmlsZShzY3JlZW5zaG90UGF0aCwgeyBlbmNvZGluZzogJ2Jhc2U2NCcgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgZGF0YTogYGRhdGE6aW1hZ2UvcG5nO2Jhc2U2NCwke3NjcmVlbnNob3REYXRhfWAsXHJcbiAgICAgICAgICAgICAgICB1cmxcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVXJsQ29udmVydGVyXSBGYWlsZWQgdG8gY2FwdHVyZSBzY3JlZW5zaG90OicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIGNvbnZlcnNpb24gY2FuY2VsbGF0aW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNhbmNlbChldmVudCwgeyBjb252ZXJzaW9uSWQgfSkge1xyXG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgIGlmIChjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uc3RhdHVzID0gJ2NhbmNlbGxlZCc7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoY29udmVyc2lvbi5icm93c2VyKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBjb252ZXJzaW9uLmJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24ud2luZG93KSB7XHJcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCd1cmw6Y29udmVyc2lvbi1jYW5jZWxsZWQnLCB7IGNvbnZlcnNpb25JZCB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24udGVtcERpcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKGNvbnZlcnNpb24udGVtcERpcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZGVsZXRlKGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgVVJMIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gY29udmVydFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB1cmwsIG9wdGlvbnMpIHtcclxuICAgICAgICBsZXQgYnJvd3NlciA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb252ZXJzaW9uIG5vdCBmb3VuZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gY29udmVyc2lvbi50ZW1wRGlyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTGF1bmNoIGJyb3dzZXJcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2xhdW5jaGluZ19icm93c2VyJywgeyBwcm9ncmVzczogNSB9KTtcclxuICAgICAgICAgICAgYnJvd3NlciA9IGF3YWl0IHB1cHBldGVlci5sYXVuY2goe1xyXG4gICAgICAgICAgICAgICAgaGVhZGxlc3M6ICduZXcnLFxyXG4gICAgICAgICAgICAgICAgYXJnczogWyctLW5vLXNhbmRib3gnLCAnLS1kaXNhYmxlLXNldHVpZC1zYW5kYm94J11cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb252ZXJzaW9uLmJyb3dzZXIgPSBicm93c2VyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRmV0Y2ggbWV0YWRhdGFcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2ZldGNoaW5nX21ldGFkYXRhJywgeyBwcm9ncmVzczogMTAgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdGhpcy5mZXRjaE1ldGFkYXRhKHVybCwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDYXB0dXJlIHNjcmVlbnNob3QgaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgIGxldCBzY3JlZW5zaG90ID0gbnVsbDtcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZVNjcmVlbnNob3QpIHtcclxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdjYXB0dXJpbmdfc2NyZWVuc2hvdCcsIHsgcHJvZ3Jlc3M6IDIwIH0pO1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2NyZWVuc2hvdFBhdGggPSBwYXRoLmpvaW4odGVtcERpciwgJ3NjcmVlbnNob3QucG5nJyk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVTY3JlZW5zaG90KHVybCwgc2NyZWVuc2hvdFBhdGgsIG9wdGlvbnMsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBSZWFkIHNjcmVlbnNob3QgYXMgYmFzZTY0XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzY3JlZW5zaG90RGF0YSA9IGF3YWl0IGZzLnJlYWRGaWxlKHNjcmVlbnNob3RQYXRoLCB7IGVuY29kaW5nOiAnYmFzZTY0JyB9KTtcclxuICAgICAgICAgICAgICAgIHNjcmVlbnNob3QgPSBgZGF0YTppbWFnZS9wbmc7YmFzZTY0LCR7c2NyZWVuc2hvdERhdGF9YDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBjb250ZW50XHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdleHRyYWN0aW5nX2NvbnRlbnQnLCB7IHByb2dyZXNzOiA0MCB9KTtcclxuICAgICAgICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuZXh0cmFjdENvbnRlbnQodXJsLCBvcHRpb25zLCBicm93c2VyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFByb2Nlc3MgaW1hZ2VzIGlmIHJlcXVlc3RlZFxyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5pbmNsdWRlSW1hZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAncHJvY2Vzc2luZ19pbWFnZXMnLCB7IHByb2dyZXNzOiA2MCB9KTtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucHJvY2Vzc0ltYWdlcyhjb250ZW50LCB0ZW1wRGlyLCB1cmwsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93blxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZ2VuZXJhdGluZ19tYXJrZG93bicsIHsgcHJvZ3Jlc3M6IDgwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBtYXJrZG93biA9IHRoaXMuZ2VuZXJhdGVNYXJrZG93bihtZXRhZGF0YSwgY29udGVudCwgc2NyZWVuc2hvdCwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyXHJcbiAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgY29udmVyc2lvbi5icm93c2VyID0gbnVsbDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdjb21wbGV0ZWQnLCB7IFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDEwMCxcclxuICAgICAgICAgICAgICAgIHJlc3VsdDogbWFya2Rvd25cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gbWFya2Rvd247XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyIGlmIG9wZW5cclxuICAgICAgICAgICAgaWYgKGJyb3dzZXIpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRmV0Y2ggbWV0YWRhdGEgZnJvbSBVUkxcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gZmV0Y2hcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IFtleGlzdGluZ0Jyb3dzZXJdIC0gRXhpc3RpbmcgYnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gVVJMIG1ldGFkYXRhXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGZldGNoTWV0YWRhdGEodXJsLCBleGlzdGluZ0Jyb3dzZXIgPSBudWxsKSB7XHJcbiAgICAgICAgbGV0IGJyb3dzZXIgPSBleGlzdGluZ0Jyb3dzZXI7XHJcbiAgICAgICAgbGV0IHNob3VsZENsb3NlQnJvd3NlciA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmICghYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYnJvd3NlciA9IGF3YWl0IHB1cHBldGVlci5sYXVuY2goe1xyXG4gICAgICAgICAgICAgICAgICAgIGhlYWRsZXNzOiAnbmV3JyxcclxuICAgICAgICAgICAgICAgICAgICBhcmdzOiBbJy0tbm8tc2FuZGJveCcsICctLWRpc2FibGUtc2V0dWlkLXNhbmRib3gnXVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBzaG91bGRDbG9zZUJyb3dzZXIgPSB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuZ290byh1cmwsIHsgd2FpdFVudGlsOiAnbmV0d29ya2lkbGUyJywgdGltZW91dDogMzAwMDAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBnZXRNZXRhQ29udGVudCA9IChuYW1lKSA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgZWxlbWVudCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoYG1ldGFbbmFtZT1cIiR7bmFtZX1cIl0sIG1ldGFbcHJvcGVydHk9XCIke25hbWV9XCJdYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGVsZW1lbnQgPyBlbGVtZW50LmdldEF0dHJpYnV0ZSgnY29udGVudCcpIDogbnVsbDtcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdGl0bGU6IGRvY3VtZW50LnRpdGxlLFxyXG4gICAgICAgICAgICAgICAgICAgIGRlc2NyaXB0aW9uOiBnZXRNZXRhQ29udGVudCgnZGVzY3JpcHRpb24nKSB8fCBnZXRNZXRhQ29udGVudCgnb2c6ZGVzY3JpcHRpb24nKSxcclxuICAgICAgICAgICAgICAgICAgICBrZXl3b3JkczogZ2V0TWV0YUNvbnRlbnQoJ2tleXdvcmRzJyksXHJcbiAgICAgICAgICAgICAgICAgICAgYXV0aG9yOiBnZXRNZXRhQ29udGVudCgnYXV0aG9yJyksXHJcbiAgICAgICAgICAgICAgICAgICAgb2dUaXRsZTogZ2V0TWV0YUNvbnRlbnQoJ29nOnRpdGxlJyksXHJcbiAgICAgICAgICAgICAgICAgICAgb2dJbWFnZTogZ2V0TWV0YUNvbnRlbnQoJ29nOmltYWdlJyksXHJcbiAgICAgICAgICAgICAgICAgICAgb2dUeXBlOiBnZXRNZXRhQ29udGVudCgnb2c6dHlwZScpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9nVXJsOiBnZXRNZXRhQ29udGVudCgnb2c6dXJsJyksXHJcbiAgICAgICAgICAgICAgICAgICAgZmF2aWNvbjogZG9jdW1lbnQucXVlcnlTZWxlY3RvcignbGlua1tyZWw9XCJpY29uXCJdLCBsaW5rW3JlbD1cInNob3J0Y3V0IGljb25cIl0nKT8uaHJlZlxyXG4gICAgICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBBZGQgVVJMIGluZm9ybWF0aW9uXHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZFVybCA9IG5ldyBVUkwodXJsKTtcclxuICAgICAgICAgICAgbWV0YWRhdGEudXJsID0gdXJsO1xyXG4gICAgICAgICAgICBtZXRhZGF0YS5kb21haW4gPSBwYXJzZWRVcmwuaG9zdG5hbWU7XHJcbiAgICAgICAgICAgIG1ldGFkYXRhLnBhdGggPSBwYXJzZWRVcmwucGF0aG5hbWU7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoc2hvdWxkQ2xvc2VCcm93c2VyKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBtZXRhZGF0YTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVXJsQ29udmVydGVyXSBGYWlsZWQgdG8gZmV0Y2ggbWV0YWRhdGE6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHNob3VsZENsb3NlQnJvd3NlciAmJiBicm93c2VyKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENhcHR1cmUgc2NyZWVuc2hvdCBvZiBVUkxcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gY2FwdHVyZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IG91dHB1dFBhdGggLSBPdXRwdXQgcGF0aCBmb3Igc2NyZWVuc2hvdFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBTY3JlZW5zaG90IG9wdGlvbnNcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IFtleGlzdGluZ0Jyb3dzZXJdIC0gRXhpc3RpbmcgYnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8dm9pZD59XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGNhcHR1cmVTY3JlZW5zaG90KHVybCwgb3V0cHV0UGF0aCwgb3B0aW9ucyA9IHt9LCBleGlzdGluZ0Jyb3dzZXIgPSBudWxsKSB7XHJcbiAgICAgICAgbGV0IGJyb3dzZXIgPSBleGlzdGluZ0Jyb3dzZXI7XHJcbiAgICAgICAgbGV0IHNob3VsZENsb3NlQnJvd3NlciA9IGZhbHNlO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGlmICghYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYnJvd3NlciA9IGF3YWl0IHB1cHBldGVlci5sYXVuY2goe1xyXG4gICAgICAgICAgICAgICAgICAgIGhlYWRsZXNzOiAnbmV3JyxcclxuICAgICAgICAgICAgICAgICAgICBhcmdzOiBbJy0tbm8tc2FuZGJveCcsICctLWRpc2FibGUtc2V0dWlkLXNhbmRib3gnXVxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBzaG91bGRDbG9zZUJyb3dzZXIgPSB0cnVlO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBTZXQgdmlld3BvcnQgc2l6ZVxyXG4gICAgICAgICAgICBjb25zdCB3aWR0aCA9IG9wdGlvbnMud2lkdGggfHwgMTI4MDtcclxuICAgICAgICAgICAgY29uc3QgaGVpZ2h0ID0gb3B0aW9ucy5oZWlnaHQgfHwgODAwO1xyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLnNldFZpZXdwb3J0KHsgd2lkdGgsIGhlaWdodCB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIE5hdmlnYXRlIHRvIFVSTFxyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmdvdG8odXJsLCB7IHdhaXRVbnRpbDogJ25ldHdvcmtpZGxlMicsIHRpbWVvdXQ6IDMwMDAwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gV2FpdCBmb3IgYWRkaXRpb25hbCB0aW1lIGlmIHNwZWNpZmllZFxyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy53YWl0VGltZSkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dChvcHRpb25zLndhaXRUaW1lKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2FwdHVyZSBzY3JlZW5zaG90XHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2Uuc2NyZWVuc2hvdCh7XHJcbiAgICAgICAgICAgICAgICBwYXRoOiBvdXRwdXRQYXRoLFxyXG4gICAgICAgICAgICAgICAgZnVsbFBhZ2U6IG9wdGlvbnMuZnVsbFBhZ2UgfHwgZmFsc2UsXHJcbiAgICAgICAgICAgICAgICB0eXBlOiAncG5nJ1xyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuY2xvc2UoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChzaG91bGRDbG9zZUJyb3dzZXIpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBjYXB0dXJlIHNjcmVlbnNob3Q6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHNob3VsZENsb3NlQnJvd3NlciAmJiBicm93c2VyKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEV4dHJhY3QgY29udGVudCBmcm9tIFVSTFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFVSTCB0byBleHRyYWN0IGNvbnRlbnQgZnJvbVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBFeHRyYWN0aW9uIG9wdGlvbnNcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IGJyb3dzZXIgLSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBFeHRyYWN0ZWQgY29udGVudFxyXG4gICAgICovXHJcbiAgICBhc3luYyBleHRyYWN0Q29udGVudCh1cmwsIG9wdGlvbnMsIGJyb3dzZXIpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuZ290byh1cmwsIHsgd2FpdFVudGlsOiAnbmV0d29ya2lkbGUyJywgdGltZW91dDogMzAwMDAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBXYWl0IGZvciBhZGRpdGlvbmFsIHRpbWUgaWYgc3BlY2lmaWVkXHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLndhaXRUaW1lKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBwYWdlLndhaXRGb3JUaW1lb3V0KG9wdGlvbnMud2FpdFRpbWUpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgcGFnZSBIVE1MXHJcbiAgICAgICAgICAgIGNvbnN0IGh0bWwgPSBhd2FpdCBwYWdlLmNvbnRlbnQoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgY29udGVudCB1c2luZyBjaGVlcmlvXHJcbiAgICAgICAgICAgIGNvbnN0ICQgPSBjaGVlcmlvLmxvYWQoaHRtbCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZW1vdmUgdW53YW50ZWQgZWxlbWVudHNcclxuICAgICAgICAgICAgJCgnc2NyaXB0LCBzdHlsZSwgaWZyYW1lLCBub3NjcmlwdCcpLnJlbW92ZSgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBtYWluIGNvbnRlbnRcclxuICAgICAgICAgICAgbGV0IG1haW5Db250ZW50ID0gJyc7XHJcbiAgICAgICAgICAgIGNvbnN0IG1haW5TZWxlY3RvcnMgPSBbXHJcbiAgICAgICAgICAgICAgICAnbWFpbicsXHJcbiAgICAgICAgICAgICAgICAnYXJ0aWNsZScsXHJcbiAgICAgICAgICAgICAgICAnI2NvbnRlbnQnLFxyXG4gICAgICAgICAgICAgICAgJy5jb250ZW50JyxcclxuICAgICAgICAgICAgICAgICcubWFpbicsXHJcbiAgICAgICAgICAgICAgICAnLmFydGljbGUnLFxyXG4gICAgICAgICAgICAgICAgJy5wb3N0JyxcclxuICAgICAgICAgICAgICAgICcucG9zdC1jb250ZW50J1xyXG4gICAgICAgICAgICBdO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gVHJ5IHRvIGZpbmQgbWFpbiBjb250ZW50IHVzaW5nIGNvbW1vbiBzZWxlY3RvcnNcclxuICAgICAgICAgICAgZm9yIChjb25zdCBzZWxlY3RvciBvZiBtYWluU2VsZWN0b3JzKSB7XHJcbiAgICAgICAgICAgICAgICBpZiAoJChzZWxlY3RvcikubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1haW5Db250ZW50ID0gJChzZWxlY3RvcikuaHRtbCgpO1xyXG4gICAgICAgICAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBJZiBubyBtYWluIGNvbnRlbnQgZm91bmQsIHVzZSBib2R5XHJcbiAgICAgICAgICAgIGlmICghbWFpbkNvbnRlbnQpIHtcclxuICAgICAgICAgICAgICAgIG1haW5Db250ZW50ID0gJCgnYm9keScpLmh0bWwoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBpbWFnZXNcclxuICAgICAgICAgICAgY29uc3QgaW1hZ2VzID0gW107XHJcbiAgICAgICAgICAgICQoJ2ltZycpLmVhY2goKGksIGVsKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzcmMgPSAkKGVsKS5hdHRyKCdzcmMnKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFsdCA9ICQoZWwpLmF0dHIoJ2FsdCcpIHx8ICcnO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoc3JjKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgLy8gUmVzb2x2ZSByZWxhdGl2ZSBVUkxzXHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgYWJzb2x1dGVTcmMgPSBuZXcgVVJMKHNyYywgdXJsKS5ocmVmO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIGltYWdlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgc3JjOiBhYnNvbHV0ZVNyYyxcclxuICAgICAgICAgICAgICAgICAgICAgICAgYWx0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBmaWxlbmFtZTogcGF0aC5iYXNlbmFtZShhYnNvbHV0ZVNyYylcclxuICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGxpbmtzXHJcbiAgICAgICAgICAgIGNvbnN0IGxpbmtzID0gW107XHJcbiAgICAgICAgICAgICQoJ2EnKS5lYWNoKChpLCBlbCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaHJlZiA9ICQoZWwpLmF0dHIoJ2hyZWYnKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHRleHQgPSAkKGVsKS50ZXh0KCkudHJpbSgpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoaHJlZiAmJiAhaHJlZi5zdGFydHNXaXRoKCcjJykgJiYgIWhyZWYuc3RhcnRzV2l0aCgnamF2YXNjcmlwdDonKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJlc29sdmUgcmVsYXRpdmUgVVJMc1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFic29sdXRlSHJlZiA9IG5ldyBVUkwoaHJlZiwgdXJsKS5ocmVmO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIGxpbmtzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBocmVmOiBhYnNvbHV0ZUhyZWYsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRleHQ6IHRleHQgfHwgYWJzb2x1dGVIcmVmXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgYXdhaXQgcGFnZS5jbG9zZSgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGh0bWw6IG1haW5Db250ZW50LFxyXG4gICAgICAgICAgICAgICAgaW1hZ2VzLFxyXG4gICAgICAgICAgICAgICAgbGlua3NcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVXJsQ29udmVydGVyXSBGYWlsZWQgdG8gZXh0cmFjdCBjb250ZW50OicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyBpbWFnZXMgZnJvbSBjb250ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gY29udGVudCAtIEV4dHJhY3RlZCBjb250ZW50XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdGVtcERpciAtIFRlbXBvcmFyeSBkaXJlY3RvcnlcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBiYXNlVXJsIC0gQmFzZSBVUkwgZm9yIHJlc29sdmluZyByZWxhdGl2ZSBwYXRoc1xyXG4gICAgICogQHBhcmFtIHtwdXBwZXRlZXIuQnJvd3Nlcn0gYnJvd3NlciAtIEJyb3dzZXIgaW5zdGFuY2VcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxyXG4gICAgICovXHJcbiAgICBhc3luYyBwcm9jZXNzSW1hZ2VzKGNvbnRlbnQsIHRlbXBEaXIsIGJhc2VVcmwsIGJyb3dzZXIpIHtcclxuICAgICAgICAvLyBGb3IgT2JzaWRpYW4gY29tcGF0aWJpbGl0eSwgd2UganVzdCBrZWVwIHRoZSBpbWFnZSBVUkxzIGFzLWlzXHJcbiAgICAgICAgLy8gTm8gbmVlZCB0byBkb3dubG9hZCBpbWFnZXMgLSBPYnNpZGlhbiB3aWxsIGhhbmRsZSB0aGVtIGFzIGV4dGVybmFsIGxpbmtzXHJcbiAgICAgICAgY29uc29sZS5sb2coYFtVcmxDb252ZXJ0ZXJdIFByb2Nlc3NpbmcgJHtjb250ZW50LmltYWdlcy5sZW5ndGh9IGltYWdlcyBhcyBleHRlcm5hbCBsaW5rcyBmb3IgT2JzaWRpYW5gKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIG1hcmtkb3duIGZyb20gVVJMIGNvbnRlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBtZXRhZGF0YSAtIFVSTCBtZXRhZGF0YVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGNvbnRlbnQgLSBFeHRyYWN0ZWQgY29udGVudFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHNjcmVlbnNob3QgLSBTY3JlZW5zaG90IGRhdGEgVVJMXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gTWFya2Rvd24gY29udGVudFxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCBjb250ZW50LCBzY3JlZW5zaG90LCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBHZXQgY3VycmVudCBkYXRldGltZVxyXG4gICAgICAgIGNvbnN0IG5vdyA9IG5ldyBEYXRlKCk7XHJcbiAgICAgICAgY29uc3QgY29udmVydGVkRGF0ZSA9IG5vdy50b0lTT1N0cmluZygpLnNwbGl0KCcuJylbMF0ucmVwbGFjZSgnVCcsICcgJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gR2V0IHRoZSB0aXRsZSBmcm9tIG1ldGFkYXRhIG9yIG9wdGlvbnNcclxuICAgICAgICBjb25zdCBwYWdlVGl0bGUgPSBvcHRpb25zLnRpdGxlIHx8IG1ldGFkYXRhLnRpdGxlIHx8IGBXZWIgUGFnZTogJHttZXRhZGF0YS51cmx9YDtcclxuICAgICAgICBcclxuICAgICAgICAvLyBDcmVhdGUgc3RhbmRhcmRpemVkIGZyb250bWF0dGVyIHVzaW5nIG1ldGFkYXRhIHV0aWxpdHlcclxuICAgICAgICBjb25zdCB7IGNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIgfSA9IHJlcXVpcmUoJy4uLy4uLy4uL2NvbnZlcnRlcnMvdXRpbHMvbWV0YWRhdGEnKTtcclxuICAgICAgICBjb25zdCBmcm9udG1hdHRlciA9IGNyZWF0ZVN0YW5kYXJkRnJvbnRtYXR0ZXIoe1xyXG4gICAgICAgICAgICB0aXRsZTogcGFnZVRpdGxlLFxyXG4gICAgICAgICAgICBmaWxlVHlwZTogJ3VybCdcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGZyb250bWF0dGVyLnRyaW0oKSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHRpdGxlIGFzIGhlYWRpbmdcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7cGFnZVRpdGxlfWApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBtZXRhZGF0YVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIFBhZ2UgSW5mb3JtYXRpb24nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IFByb3BlcnR5IHwgVmFsdWUgfCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFVSTCB8IFske21ldGFkYXRhLnVybH1dKCR7bWV0YWRhdGEudXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRG9tYWluIHwgJHttZXRhZGF0YS5kb21haW59IHxgKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobWV0YWRhdGEudGl0bGUpIG1hcmtkb3duLnB1c2goYHwgVGl0bGUgfCAke21ldGFkYXRhLnRpdGxlfSB8YCk7XHJcbiAgICAgICAgaWYgKG1ldGFkYXRhLmRlc2NyaXB0aW9uKSBtYXJrZG93bi5wdXNoKGB8IERlc2NyaXB0aW9uIHwgJHttZXRhZGF0YS5kZXNjcmlwdGlvbn0gfGApO1xyXG4gICAgICAgIGlmIChtZXRhZGF0YS5hdXRob3IpIG1hcmtkb3duLnB1c2goYHwgQXV0aG9yIHwgJHttZXRhZGF0YS5hdXRob3J9IHxgKTtcclxuICAgICAgICBpZiAobWV0YWRhdGEua2V5d29yZHMpIG1hcmtkb3duLnB1c2goYHwgS2V5d29yZHMgfCAke21ldGFkYXRhLmtleXdvcmRzfSB8YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHNjcmVlbnNob3QgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgaWYgKHNjcmVlbnNob3QpIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgU2NyZWVuc2hvdCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIVtTY3JlZW5zaG90IG9mICR7bWV0YWRhdGEudGl0bGUgfHwgbWV0YWRhdGEudXJsfV0oJHtzY3JlZW5zaG90fSlgKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBjb250ZW50XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgQ29udGVudCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENvbnZlcnQgSFRNTCB0byBtYXJrZG93blxyXG4gICAgICAgIGNvbnN0IFR1cm5kb3duU2VydmljZSA9IHJlcXVpcmUoJ3R1cm5kb3duJyk7XHJcbiAgICAgICAgY29uc3QgdHVybmRvd25TZXJ2aWNlID0gbmV3IFR1cm5kb3duU2VydmljZSh7XHJcbiAgICAgICAgICAgIGhlYWRpbmdTdHlsZTogJ2F0eCcsXHJcbiAgICAgICAgICAgIGNvZGVCbG9ja1N0eWxlOiAnZmVuY2VkJyxcclxuICAgICAgICAgICAgZW1EZWxpbWl0ZXI6ICcqJ1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEN1c3RvbWl6ZSB0dXJuZG93biAtIG5vIHNwZWNpYWwgaGFuZGxpbmcgbmVlZGVkIGZvciBpbWFnZXNcclxuICAgICAgICAvLyBKdXN0IHVzZSB0aGUgb3JpZ2luYWwgVVJMcyBmb3IgT2JzaWRpYW4gY29tcGF0aWJpbGl0eVxyXG4gICAgICAgIFxyXG4gICAgICAgIGNvbnN0IG1hcmtkb3duQ29udGVudCA9IHR1cm5kb3duU2VydmljZS50dXJuZG93bihjb250ZW50Lmh0bWwpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2gobWFya2Rvd25Db250ZW50KTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgbGlua3Mgc2VjdGlvbiBpZiByZXF1ZXN0ZWRcclxuICAgICAgICBpZiAob3B0aW9ucy5pbmNsdWRlTGlua3MgJiYgY29udGVudC5saW5rcyAmJiBjb250ZW50LmxpbmtzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJyMjIExpbmtzJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29udGVudC5saW5rcy5mb3JFYWNoKGxpbmsgPT4ge1xyXG4gICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgLSBbJHtsaW5rLnRleHR9XSgke2xpbmsuaHJlZn0pYCk7XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbWFya2Rvd24uam9pbignXFxuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSB1bmlxdWUgY29udmVyc2lvbiBJRFxyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gVW5pcXVlIGNvbnZlcnNpb24gSURcclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVDb252ZXJzaW9uSWQoKSB7XHJcbiAgICAgICAgcmV0dXJuIGB1cmxfJHtEYXRlLm5vdygpfV8ke01hdGgucmFuZG9tKCkudG9TdHJpbmcoMzYpLnN1YnN0cigyLCA5KX1gO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogVXBkYXRlIGNvbnZlcnNpb24gc3RhdHVzIGFuZCBub3RpZnkgcmVuZGVyZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0dXMgLSBOZXcgc3RhdHVzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gZGV0YWlscyAtIEFkZGl0aW9uYWwgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICB1cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgc3RhdHVzLCBkZXRhaWxzID0ge30pIHtcclxuICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcclxuICAgICAgICBpZiAoY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLnN0YXR1cyA9IHN0YXR1cztcclxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihjb252ZXJzaW9uLCBkZXRhaWxzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLndpbmRvdykge1xyXG4gICAgICAgICAgICAgICAgY29udmVyc2lvbi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgndXJsOmNvbnZlcnNpb24tcHJvZ3Jlc3MnLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvbklkLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cyxcclxuICAgICAgICAgICAgICAgICAgICAuLi5kZXRhaWxzXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIENoZWNrIGlmIHRoaXMgY29udmVydGVyIHN1cHBvcnRzIHRoZSBnaXZlbiBVUkxcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gY2hlY2tcclxuICAgICAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHN1cHBvcnRlZFxyXG4gICAgICovXHJcbiAgICBzdXBwb3J0c1VybCh1cmwpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybCk7XHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLnN1cHBvcnRlZFByb3RvY29scy5pbmNsdWRlcyhwYXJzZWRVcmwucHJvdG9jb2wpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZXQgY29udmVydGVyIGluZm9ybWF0aW9uXHJcbiAgICAgKiBAcmV0dXJucyB7T2JqZWN0fSBDb252ZXJ0ZXIgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBnZXRJbmZvKCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG5hbWU6ICdVUkwgQ29udmVydGVyJyxcclxuICAgICAgICAgICAgcHJvdG9jb2xzOiB0aGlzLnN1cHBvcnRlZFByb3RvY29scyxcclxuICAgICAgICAgICAgZGVzY3JpcHRpb246ICdDb252ZXJ0cyB3ZWIgcGFnZXMgdG8gbWFya2Rvd24gd2l0aCBPYnNpZGlhbi1jb21wYXRpYmxlIGltYWdlIGxpbmtzJyxcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdPcHRpb25hbCBwYWdlIHRpdGxlJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVTY3JlZW5zaG90OiAnV2hldGhlciB0byBpbmNsdWRlIHBhZ2Ugc2NyZWVuc2hvdCAoZGVmYXVsdDogZmFsc2UpJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVJbWFnZXM6ICdXaGV0aGVyIHRvIGluY2x1ZGUgaW1hZ2VzIGFzIGV4dGVybmFsIGxpbmtzIChkZWZhdWx0OiB0cnVlKScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlTGlua3M6ICdXaGV0aGVyIHRvIGluY2x1ZGUgbGlua3Mgc2VjdGlvbiAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgd2FpdFRpbWU6ICdBZGRpdGlvbmFsIHRpbWUgdG8gd2FpdCBmb3IgcGFnZSBsb2FkIGluIG1zJ1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfTtcclxuICAgIH1cclxufVxyXG5cclxubW9kdWxlLmV4cG9ydHMgPSBVcmxDb252ZXJ0ZXI7XHJcbiJdLCJtYXBwaW5ncyI6Ijs7QUFBQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUMsRUFBRSxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU1FLFNBQVMsR0FBR0YsT0FBTyxDQUFDLFdBQVcsQ0FBQztBQUN0QyxNQUFNRyxPQUFPLEdBQUdILE9BQU8sQ0FBQyxTQUFTLENBQUM7QUFDbEMsTUFBTTtFQUFFSTtBQUFJLENBQUMsR0FBR0osT0FBTyxDQUFDLEtBQUssQ0FBQztBQUM5QixNQUFNSyxXQUFXLEdBQUdMLE9BQU8sQ0FBQyxtQkFBbUIsQ0FBQztBQUVoRCxNQUFNTSxZQUFZLFNBQVNELFdBQVcsQ0FBQztFQUNuQ0UsV0FBV0EsQ0FBQ0MsYUFBYSxFQUFFQyxXQUFXLEVBQUU7SUFDcEMsS0FBSyxDQUFDLENBQUM7SUFDUCxJQUFJLENBQUNELGFBQWEsR0FBR0EsYUFBYTtJQUNsQyxJQUFJLENBQUNDLFdBQVcsR0FBR0EsV0FBVztJQUM5QixJQUFJLENBQUNDLGtCQUFrQixHQUFHLENBQUMsT0FBTyxFQUFFLFFBQVEsQ0FBQztJQUM3QyxJQUFJLENBQUNDLGlCQUFpQixHQUFHLElBQUlDLEdBQUcsQ0FBQyxDQUFDO0VBQ3RDOztFQUVBO0FBQ0o7QUFDQTtFQUNJQyxnQkFBZ0JBLENBQUEsRUFBRztJQUNmLElBQUksQ0FBQ0MsZUFBZSxDQUFDLGFBQWEsRUFBRSxJQUFJLENBQUNDLGFBQWEsQ0FBQ0MsSUFBSSxDQUFDLElBQUksQ0FBQyxDQUFDO0lBQ2xFLElBQUksQ0FBQ0YsZUFBZSxDQUFDLHNCQUFzQixFQUFFLElBQUksQ0FBQ0csaUJBQWlCLENBQUNELElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUMvRSxJQUFJLENBQUNGLGVBQWUsQ0FBQyx3QkFBd0IsRUFBRSxJQUFJLENBQUNJLGdCQUFnQixDQUFDRixJQUFJLENBQUMsSUFBSSxDQUFDLENBQUM7SUFDaEYsSUFBSSxDQUFDRixlQUFlLENBQUMsb0JBQW9CLEVBQUUsSUFBSSxDQUFDSyxZQUFZLENBQUNILElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztFQUM1RTs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTUQsYUFBYUEsQ0FBQ0ssS0FBSyxFQUFFO0lBQUVDLEdBQUc7SUFBRUMsT0FBTyxHQUFHLENBQUM7RUFBRSxDQUFDLEVBQUU7SUFDOUMsSUFBSTtNQUNBO01BQ0EsTUFBTUMsU0FBUyxHQUFHLElBQUluQixHQUFHLENBQUNpQixHQUFHLENBQUM7TUFDOUIsSUFBSSxDQUFDLElBQUksQ0FBQ1gsa0JBQWtCLENBQUNjLFFBQVEsQ0FBQ0QsU0FBUyxDQUFDRSxRQUFRLENBQUMsRUFBRTtRQUN2RCxNQUFNLElBQUlDLEtBQUssQ0FBQyx5QkFBeUJILFNBQVMsQ0FBQ0UsUUFBUSxFQUFFLENBQUM7TUFDbEU7TUFFQSxNQUFNRSxZQUFZLEdBQUcsSUFBSSxDQUFDQyxvQkFBb0IsQ0FBQyxDQUFDO01BQ2hELE1BQU1DLE1BQU0sR0FBR1QsS0FBSyxFQUFFVSxNQUFNLEVBQUVDLHFCQUFxQixHQUFHLENBQUMsSUFBSSxJQUFJOztNQUUvRDtNQUNBLE1BQU1DLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQ3ZCLFdBQVcsQ0FBQ3dCLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQztNQUV0RSxJQUFJLENBQUN0QixpQkFBaUIsQ0FBQ3VCLEdBQUcsQ0FBQ1AsWUFBWSxFQUFFO1FBQ3JDUSxFQUFFLEVBQUVSLFlBQVk7UUFDaEJTLE1BQU0sRUFBRSxVQUFVO1FBQ2xCQyxRQUFRLEVBQUUsQ0FBQztRQUNYaEIsR0FBRztRQUNIVyxPQUFPO1FBQ1BIO01BQ0osQ0FBQyxDQUFDOztNQUVGO01BQ0EsSUFBSUEsTUFBTSxJQUFJQSxNQUFNLENBQUNTLFdBQVcsRUFBRTtRQUM5QlQsTUFBTSxDQUFDUyxXQUFXLENBQUNDLElBQUksQ0FBQyx3QkFBd0IsRUFBRTtVQUFFWjtRQUFhLENBQUMsQ0FBQztNQUN2RTs7TUFFQTtNQUNBLElBQUksQ0FBQ2EsaUJBQWlCLENBQUNiLFlBQVksRUFBRU4sR0FBRyxFQUFFQyxPQUFPLENBQUMsQ0FBQ21CLEtBQUssQ0FBQ0MsS0FBSyxJQUFJO1FBQzlEQyxPQUFPLENBQUNELEtBQUssQ0FBQyx3Q0FBd0NmLFlBQVksR0FBRyxFQUFFZSxLQUFLLENBQUM7UUFDN0UsSUFBSSxDQUFDRSxzQkFBc0IsQ0FBQ2pCLFlBQVksRUFBRSxRQUFRLEVBQUU7VUFBRWUsS0FBSyxFQUFFQSxLQUFLLENBQUNHO1FBQVEsQ0FBQyxDQUFDOztRQUU3RTtRQUNBNUMsRUFBRSxDQUFDNkMsTUFBTSxDQUFDZCxPQUFPLENBQUMsQ0FBQ1MsS0FBSyxDQUFDTSxHQUFHLElBQUk7VUFDNUJKLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLHFEQUFxRFYsT0FBTyxFQUFFLEVBQUVlLEdBQUcsQ0FBQztRQUN0RixDQUFDLENBQUM7TUFDTixDQUFDLENBQUM7TUFFRixPQUFPO1FBQUVwQjtNQUFhLENBQUM7SUFDM0IsQ0FBQyxDQUFDLE9BQU9lLEtBQUssRUFBRTtNQUNaQyxPQUFPLENBQUNELEtBQUssQ0FBQyw0Q0FBNEMsRUFBRUEsS0FBSyxDQUFDO01BQ2xFLE1BQU1BLEtBQUs7SUFDZjtFQUNKOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7RUFDSSxNQUFNekIsaUJBQWlCQSxDQUFDRyxLQUFLLEVBQUU7SUFBRUM7RUFBSSxDQUFDLEVBQUU7SUFDcEMsSUFBSTtNQUNBLE1BQU0yQixRQUFRLEdBQUcsTUFBTSxJQUFJLENBQUNDLGFBQWEsQ0FBQzVCLEdBQUcsQ0FBQztNQUM5QyxPQUFPMkIsUUFBUTtJQUNuQixDQUFDLENBQUMsT0FBT04sS0FBSyxFQUFFO01BQ1pDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLHdDQUF3QyxFQUFFQSxLQUFLLENBQUM7TUFDOUQsTUFBTUEsS0FBSztJQUNmO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU14QixnQkFBZ0JBLENBQUNFLEtBQUssRUFBRTtJQUFFQyxHQUFHO0lBQUVDLE9BQU8sR0FBRyxDQUFDO0VBQUUsQ0FBQyxFQUFFO0lBQ2pELElBQUk7TUFDQSxNQUFNVSxPQUFPLEdBQUcsTUFBTSxJQUFJLENBQUN2QixXQUFXLENBQUN3QixhQUFhLENBQUMsZ0JBQWdCLENBQUM7TUFDdEUsTUFBTWlCLGNBQWMsR0FBR25ELElBQUksQ0FBQ29ELElBQUksQ0FBQ25CLE9BQU8sRUFBRSxnQkFBZ0IsQ0FBQztNQUUzRCxNQUFNLElBQUksQ0FBQ29CLGlCQUFpQixDQUFDL0IsR0FBRyxFQUFFNkIsY0FBYyxFQUFFNUIsT0FBTyxDQUFDOztNQUUxRDtNQUNBLE1BQU0rQixjQUFjLEdBQUcsTUFBTXBELEVBQUUsQ0FBQ3FELFFBQVEsQ0FBQ0osY0FBYyxFQUFFO1FBQUVLLFFBQVEsRUFBRTtNQUFTLENBQUMsQ0FBQzs7TUFFaEY7TUFDQSxNQUFNdEQsRUFBRSxDQUFDNkMsTUFBTSxDQUFDZCxPQUFPLENBQUM7TUFFeEIsT0FBTztRQUNId0IsSUFBSSxFQUFFLHlCQUF5QkgsY0FBYyxFQUFFO1FBQy9DaEM7TUFDSixDQUFDO0lBQ0wsQ0FBQyxDQUFDLE9BQU9xQixLQUFLLEVBQUU7TUFDWkMsT0FBTyxDQUFDRCxLQUFLLENBQUMsOENBQThDLEVBQUVBLEtBQUssQ0FBQztNQUNwRSxNQUFNQSxLQUFLO0lBQ2Y7RUFDSjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTXZCLFlBQVlBLENBQUNDLEtBQUssRUFBRTtJQUFFTztFQUFhLENBQUMsRUFBRTtJQUN4QyxNQUFNOEIsVUFBVSxHQUFHLElBQUksQ0FBQzlDLGlCQUFpQixDQUFDK0MsR0FBRyxDQUFDL0IsWUFBWSxDQUFDO0lBQzNELElBQUk4QixVQUFVLEVBQUU7TUFDWkEsVUFBVSxDQUFDckIsTUFBTSxHQUFHLFdBQVc7TUFFL0IsSUFBSXFCLFVBQVUsQ0FBQ0UsT0FBTyxFQUFFO1FBQ3BCLE1BQU1GLFVBQVUsQ0FBQ0UsT0FBTyxDQUFDQyxLQUFLLENBQUMsQ0FBQztNQUNwQztNQUVBLElBQUlILFVBQVUsQ0FBQzVCLE1BQU0sRUFBRTtRQUNuQjRCLFVBQVUsQ0FBQzVCLE1BQU0sQ0FBQ1MsV0FBVyxDQUFDQyxJQUFJLENBQUMsMEJBQTBCLEVBQUU7VUFBRVo7UUFBYSxDQUFDLENBQUM7TUFDcEY7O01BRUE7TUFDQSxJQUFJOEIsVUFBVSxDQUFDekIsT0FBTyxFQUFFO1FBQ3BCLE1BQU0vQixFQUFFLENBQUM2QyxNQUFNLENBQUNXLFVBQVUsQ0FBQ3pCLE9BQU8sQ0FBQztNQUN2QztNQUVBLElBQUksQ0FBQ3JCLGlCQUFpQixDQUFDa0QsTUFBTSxDQUFDbEMsWUFBWSxDQUFDO0lBQy9DO0lBQ0EsT0FBTztNQUFFbUMsT0FBTyxFQUFFO0lBQUssQ0FBQztFQUM1Qjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDSSxNQUFNdEIsaUJBQWlCQSxDQUFDYixZQUFZLEVBQUVOLEdBQUcsRUFBRUMsT0FBTyxFQUFFO0lBQ2hELElBQUlxQyxPQUFPLEdBQUcsSUFBSTtJQUVsQixJQUFJO01BQ0EsTUFBTUYsVUFBVSxHQUFHLElBQUksQ0FBQzlDLGlCQUFpQixDQUFDK0MsR0FBRyxDQUFDL0IsWUFBWSxDQUFDO01BQzNELElBQUksQ0FBQzhCLFVBQVUsRUFBRTtRQUNiLE1BQU0sSUFBSS9CLEtBQUssQ0FBQyxzQkFBc0IsQ0FBQztNQUMzQztNQUVBLE1BQU1NLE9BQU8sR0FBR3lCLFVBQVUsQ0FBQ3pCLE9BQU87O01BRWxDO01BQ0EsSUFBSSxDQUFDWSxzQkFBc0IsQ0FBQ2pCLFlBQVksRUFBRSxtQkFBbUIsRUFBRTtRQUFFVSxRQUFRLEVBQUU7TUFBRSxDQUFDLENBQUM7TUFDL0VzQixPQUFPLEdBQUcsTUFBTXpELFNBQVMsQ0FBQzZELE1BQU0sQ0FBQztRQUM3QkMsUUFBUSxFQUFFLEtBQUs7UUFDZkMsSUFBSSxFQUFFLENBQUMsY0FBYyxFQUFFLDBCQUEwQjtNQUNyRCxDQUFDLENBQUM7TUFFRlIsVUFBVSxDQUFDRSxPQUFPLEdBQUdBLE9BQU87O01BRTVCO01BQ0EsSUFBSSxDQUFDZixzQkFBc0IsQ0FBQ2pCLFlBQVksRUFBRSxtQkFBbUIsRUFBRTtRQUFFVSxRQUFRLEVBQUU7TUFBRyxDQUFDLENBQUM7TUFDaEYsTUFBTVcsUUFBUSxHQUFHLE1BQU0sSUFBSSxDQUFDQyxhQUFhLENBQUM1QixHQUFHLEVBQUVzQyxPQUFPLENBQUM7O01BRXZEO01BQ0EsSUFBSU8sVUFBVSxHQUFHLElBQUk7TUFDckIsSUFBSTVDLE9BQU8sQ0FBQzZDLGlCQUFpQixFQUFFO1FBQzNCLElBQUksQ0FBQ3ZCLHNCQUFzQixDQUFDakIsWUFBWSxFQUFFLHNCQUFzQixFQUFFO1VBQUVVLFFBQVEsRUFBRTtRQUFHLENBQUMsQ0FBQztRQUNuRixNQUFNYSxjQUFjLEdBQUduRCxJQUFJLENBQUNvRCxJQUFJLENBQUNuQixPQUFPLEVBQUUsZ0JBQWdCLENBQUM7UUFDM0QsTUFBTSxJQUFJLENBQUNvQixpQkFBaUIsQ0FBQy9CLEdBQUcsRUFBRTZCLGNBQWMsRUFBRTVCLE9BQU8sRUFBRXFDLE9BQU8sQ0FBQzs7UUFFbkU7UUFDQSxNQUFNTixjQUFjLEdBQUcsTUFBTXBELEVBQUUsQ0FBQ3FELFFBQVEsQ0FBQ0osY0FBYyxFQUFFO1VBQUVLLFFBQVEsRUFBRTtRQUFTLENBQUMsQ0FBQztRQUNoRlcsVUFBVSxHQUFHLHlCQUF5QmIsY0FBYyxFQUFFO01BQzFEOztNQUVBO01BQ0EsSUFBSSxDQUFDVCxzQkFBc0IsQ0FBQ2pCLFlBQVksRUFBRSxvQkFBb0IsRUFBRTtRQUFFVSxRQUFRLEVBQUU7TUFBRyxDQUFDLENBQUM7TUFDakYsTUFBTStCLE9BQU8sR0FBRyxNQUFNLElBQUksQ0FBQ0MsY0FBYyxDQUFDaEQsR0FBRyxFQUFFQyxPQUFPLEVBQUVxQyxPQUFPLENBQUM7O01BRWhFO01BQ0EsSUFBSXJDLE9BQU8sQ0FBQ2dELGFBQWEsRUFBRTtRQUN2QixJQUFJLENBQUMxQixzQkFBc0IsQ0FBQ2pCLFlBQVksRUFBRSxtQkFBbUIsRUFBRTtVQUFFVSxRQUFRLEVBQUU7UUFBRyxDQUFDLENBQUM7UUFDaEYsTUFBTSxJQUFJLENBQUNrQyxhQUFhLENBQUNILE9BQU8sRUFBRXBDLE9BQU8sRUFBRVgsR0FBRyxFQUFFc0MsT0FBTyxDQUFDO01BQzVEOztNQUVBO01BQ0EsSUFBSSxDQUFDZixzQkFBc0IsQ0FBQ2pCLFlBQVksRUFBRSxxQkFBcUIsRUFBRTtRQUFFVSxRQUFRLEVBQUU7TUFBRyxDQUFDLENBQUM7TUFDbEYsTUFBTW1DLFFBQVEsR0FBRyxJQUFJLENBQUNDLGdCQUFnQixDQUFDekIsUUFBUSxFQUFFb0IsT0FBTyxFQUFFRixVQUFVLEVBQUU1QyxPQUFPLENBQUM7O01BRTlFO01BQ0EsTUFBTXFDLE9BQU8sQ0FBQ0MsS0FBSyxDQUFDLENBQUM7TUFDckJILFVBQVUsQ0FBQ0UsT0FBTyxHQUFHLElBQUk7O01BRXpCO01BQ0EsTUFBTTFELEVBQUUsQ0FBQzZDLE1BQU0sQ0FBQ2QsT0FBTyxDQUFDO01BRXhCLElBQUksQ0FBQ1ksc0JBQXNCLENBQUNqQixZQUFZLEVBQUUsV0FBVyxFQUFFO1FBQ25EVSxRQUFRLEVBQUUsR0FBRztRQUNicUMsTUFBTSxFQUFFRjtNQUNaLENBQUMsQ0FBQztNQUVGLE9BQU9BLFFBQVE7SUFDbkIsQ0FBQyxDQUFDLE9BQU85QixLQUFLLEVBQUU7TUFDWkMsT0FBTyxDQUFDRCxLQUFLLENBQUMsOENBQThDLEVBQUVBLEtBQUssQ0FBQzs7TUFFcEU7TUFDQSxJQUFJaUIsT0FBTyxFQUFFO1FBQ1QsTUFBTUEsT0FBTyxDQUFDQyxLQUFLLENBQUMsQ0FBQztNQUN6QjtNQUVBLE1BQU1sQixLQUFLO0lBQ2Y7RUFDSjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7RUFDSSxNQUFNTyxhQUFhQSxDQUFDNUIsR0FBRyxFQUFFc0QsZUFBZSxHQUFHLElBQUksRUFBRTtJQUM3QyxJQUFJaEIsT0FBTyxHQUFHZ0IsZUFBZTtJQUM3QixJQUFJQyxrQkFBa0IsR0FBRyxLQUFLO0lBRTlCLElBQUk7TUFDQSxJQUFJLENBQUNqQixPQUFPLEVBQUU7UUFDVkEsT0FBTyxHQUFHLE1BQU16RCxTQUFTLENBQUM2RCxNQUFNLENBQUM7VUFDN0JDLFFBQVEsRUFBRSxLQUFLO1VBQ2ZDLElBQUksRUFBRSxDQUFDLGNBQWMsRUFBRSwwQkFBMEI7UUFDckQsQ0FBQyxDQUFDO1FBQ0ZXLGtCQUFrQixHQUFHLElBQUk7TUFDN0I7TUFFQSxNQUFNQyxJQUFJLEdBQUcsTUFBTWxCLE9BQU8sQ0FBQ21CLE9BQU8sQ0FBQyxDQUFDO01BQ3BDLE1BQU1ELElBQUksQ0FBQ0UsSUFBSSxDQUFDMUQsR0FBRyxFQUFFO1FBQUUyRCxTQUFTLEVBQUUsY0FBYztRQUFFQyxPQUFPLEVBQUU7TUFBTSxDQUFDLENBQUM7O01BRW5FO01BQ0EsTUFBTWpDLFFBQVEsR0FBRyxNQUFNNkIsSUFBSSxDQUFDSyxRQUFRLENBQUMsTUFBTTtRQUN2QyxNQUFNQyxjQUFjLEdBQUlDLElBQUksSUFBSztVQUM3QixNQUFNQyxPQUFPLEdBQUdDLFFBQVEsQ0FBQ0MsYUFBYSxDQUFDLGNBQWNILElBQUksc0JBQXNCQSxJQUFJLElBQUksQ0FBQztVQUN4RixPQUFPQyxPQUFPLEdBQUdBLE9BQU8sQ0FBQ0csWUFBWSxDQUFDLFNBQVMsQ0FBQyxHQUFHLElBQUk7UUFDM0QsQ0FBQztRQUVELE9BQU87VUFDSEMsS0FBSyxFQUFFSCxRQUFRLENBQUNHLEtBQUs7VUFDckJDLFdBQVcsRUFBRVAsY0FBYyxDQUFDLGFBQWEsQ0FBQyxJQUFJQSxjQUFjLENBQUMsZ0JBQWdCLENBQUM7VUFDOUVRLFFBQVEsRUFBRVIsY0FBYyxDQUFDLFVBQVUsQ0FBQztVQUNwQ1MsTUFBTSxFQUFFVCxjQUFjLENBQUMsUUFBUSxDQUFDO1VBQ2hDVSxPQUFPLEVBQUVWLGNBQWMsQ0FBQyxVQUFVLENBQUM7VUFDbkNXLE9BQU8sRUFBRVgsY0FBYyxDQUFDLFVBQVUsQ0FBQztVQUNuQ1ksTUFBTSxFQUFFWixjQUFjLENBQUMsU0FBUyxDQUFDO1VBQ2pDYSxLQUFLLEVBQUViLGNBQWMsQ0FBQyxRQUFRLENBQUM7VUFDL0JjLE9BQU8sRUFBRVgsUUFBUSxDQUFDQyxhQUFhLENBQUMsNkNBQTZDLENBQUMsRUFBRVc7UUFDcEYsQ0FBQztNQUNMLENBQUMsQ0FBQzs7TUFFRjtNQUNBLE1BQU0zRSxTQUFTLEdBQUcsSUFBSW5CLEdBQUcsQ0FBQ2lCLEdBQUcsQ0FBQztNQUM5QjJCLFFBQVEsQ0FBQzNCLEdBQUcsR0FBR0EsR0FBRztNQUNsQjJCLFFBQVEsQ0FBQ21ELE1BQU0sR0FBRzVFLFNBQVMsQ0FBQzZFLFFBQVE7TUFDcENwRCxRQUFRLENBQUNqRCxJQUFJLEdBQUd3QixTQUFTLENBQUM4RSxRQUFRO01BRWxDLE1BQU14QixJQUFJLENBQUNqQixLQUFLLENBQUMsQ0FBQztNQUVsQixJQUFJZ0Isa0JBQWtCLEVBQUU7UUFDcEIsTUFBTWpCLE9BQU8sQ0FBQ0MsS0FBSyxDQUFDLENBQUM7TUFDekI7TUFFQSxPQUFPWixRQUFRO0lBQ25CLENBQUMsQ0FBQyxPQUFPTixLQUFLLEVBQUU7TUFDWkMsT0FBTyxDQUFDRCxLQUFLLENBQUMsMENBQTBDLEVBQUVBLEtBQUssQ0FBQztNQUVoRSxJQUFJa0Msa0JBQWtCLElBQUlqQixPQUFPLEVBQUU7UUFDL0IsTUFBTUEsT0FBTyxDQUFDQyxLQUFLLENBQUMsQ0FBQztNQUN6QjtNQUVBLE1BQU1sQixLQUFLO0lBQ2Y7RUFDSjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTVUsaUJBQWlCQSxDQUFDL0IsR0FBRyxFQUFFaUYsVUFBVSxFQUFFaEYsT0FBTyxHQUFHLENBQUMsQ0FBQyxFQUFFcUQsZUFBZSxHQUFHLElBQUksRUFBRTtJQUMzRSxJQUFJaEIsT0FBTyxHQUFHZ0IsZUFBZTtJQUM3QixJQUFJQyxrQkFBa0IsR0FBRyxLQUFLO0lBRTlCLElBQUk7TUFDQSxJQUFJLENBQUNqQixPQUFPLEVBQUU7UUFDVkEsT0FBTyxHQUFHLE1BQU16RCxTQUFTLENBQUM2RCxNQUFNLENBQUM7VUFDN0JDLFFBQVEsRUFBRSxLQUFLO1VBQ2ZDLElBQUksRUFBRSxDQUFDLGNBQWMsRUFBRSwwQkFBMEI7UUFDckQsQ0FBQyxDQUFDO1FBQ0ZXLGtCQUFrQixHQUFHLElBQUk7TUFDN0I7TUFFQSxNQUFNQyxJQUFJLEdBQUcsTUFBTWxCLE9BQU8sQ0FBQ21CLE9BQU8sQ0FBQyxDQUFDOztNQUVwQztNQUNBLE1BQU15QixLQUFLLEdBQUdqRixPQUFPLENBQUNpRixLQUFLLElBQUksSUFBSTtNQUNuQyxNQUFNQyxNQUFNLEdBQUdsRixPQUFPLENBQUNrRixNQUFNLElBQUksR0FBRztNQUNwQyxNQUFNM0IsSUFBSSxDQUFDNEIsV0FBVyxDQUFDO1FBQUVGLEtBQUs7UUFBRUM7TUFBTyxDQUFDLENBQUM7O01BRXpDO01BQ0EsTUFBTTNCLElBQUksQ0FBQ0UsSUFBSSxDQUFDMUQsR0FBRyxFQUFFO1FBQUUyRCxTQUFTLEVBQUUsY0FBYztRQUFFQyxPQUFPLEVBQUU7TUFBTSxDQUFDLENBQUM7O01BRW5FO01BQ0EsSUFBSTNELE9BQU8sQ0FBQ29GLFFBQVEsRUFBRTtRQUNsQixNQUFNN0IsSUFBSSxDQUFDOEIsY0FBYyxDQUFDckYsT0FBTyxDQUFDb0YsUUFBUSxDQUFDO01BQy9DOztNQUVBO01BQ0EsTUFBTTdCLElBQUksQ0FBQ1gsVUFBVSxDQUFDO1FBQ2xCbkUsSUFBSSxFQUFFdUcsVUFBVTtRQUNoQk0sUUFBUSxFQUFFdEYsT0FBTyxDQUFDc0YsUUFBUSxJQUFJLEtBQUs7UUFDbkNDLElBQUksRUFBRTtNQUNWLENBQUMsQ0FBQztNQUVGLE1BQU1oQyxJQUFJLENBQUNqQixLQUFLLENBQUMsQ0FBQztNQUVsQixJQUFJZ0Isa0JBQWtCLEVBQUU7UUFDcEIsTUFBTWpCLE9BQU8sQ0FBQ0MsS0FBSyxDQUFDLENBQUM7TUFDekI7SUFDSixDQUFDLENBQUMsT0FBT2xCLEtBQUssRUFBRTtNQUNaQyxPQUFPLENBQUNELEtBQUssQ0FBQyw4Q0FBOEMsRUFBRUEsS0FBSyxDQUFDO01BRXBFLElBQUlrQyxrQkFBa0IsSUFBSWpCLE9BQU8sRUFBRTtRQUMvQixNQUFNQSxPQUFPLENBQUNDLEtBQUssQ0FBQyxDQUFDO01BQ3pCO01BRUEsTUFBTWxCLEtBQUs7SUFDZjtFQUNKOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0ksTUFBTTJCLGNBQWNBLENBQUNoRCxHQUFHLEVBQUVDLE9BQU8sRUFBRXFDLE9BQU8sRUFBRTtJQUN4QyxJQUFJO01BQ0EsTUFBTWtCLElBQUksR0FBRyxNQUFNbEIsT0FBTyxDQUFDbUIsT0FBTyxDQUFDLENBQUM7TUFDcEMsTUFBTUQsSUFBSSxDQUFDRSxJQUFJLENBQUMxRCxHQUFHLEVBQUU7UUFBRTJELFNBQVMsRUFBRSxjQUFjO1FBQUVDLE9BQU8sRUFBRTtNQUFNLENBQUMsQ0FBQzs7TUFFbkU7TUFDQSxJQUFJM0QsT0FBTyxDQUFDb0YsUUFBUSxFQUFFO1FBQ2xCLE1BQU03QixJQUFJLENBQUM4QixjQUFjLENBQUNyRixPQUFPLENBQUNvRixRQUFRLENBQUM7TUFDL0M7O01BRUE7TUFDQSxNQUFNSSxJQUFJLEdBQUcsTUFBTWpDLElBQUksQ0FBQ1QsT0FBTyxDQUFDLENBQUM7O01BRWpDO01BQ0EsTUFBTTJDLENBQUMsR0FBRzVHLE9BQU8sQ0FBQzZHLElBQUksQ0FBQ0YsSUFBSSxDQUFDOztNQUU1QjtNQUNBQyxDQUFDLENBQUMsaUNBQWlDLENBQUMsQ0FBQ2pFLE1BQU0sQ0FBQyxDQUFDOztNQUU3QztNQUNBLElBQUltRSxXQUFXLEdBQUcsRUFBRTtNQUNwQixNQUFNQyxhQUFhLEdBQUcsQ0FDbEIsTUFBTSxFQUNOLFNBQVMsRUFDVCxVQUFVLEVBQ1YsVUFBVSxFQUNWLE9BQU8sRUFDUCxVQUFVLEVBQ1YsT0FBTyxFQUNQLGVBQWUsQ0FDbEI7O01BRUQ7TUFDQSxLQUFLLE1BQU1DLFFBQVEsSUFBSUQsYUFBYSxFQUFFO1FBQ2xDLElBQUlILENBQUMsQ0FBQ0ksUUFBUSxDQUFDLENBQUNDLE1BQU0sR0FBRyxDQUFDLEVBQUU7VUFDeEJILFdBQVcsR0FBR0YsQ0FBQyxDQUFDSSxRQUFRLENBQUMsQ0FBQ0wsSUFBSSxDQUFDLENBQUM7VUFDaEM7UUFDSjtNQUNKOztNQUVBO01BQ0EsSUFBSSxDQUFDRyxXQUFXLEVBQUU7UUFDZEEsV0FBVyxHQUFHRixDQUFDLENBQUMsTUFBTSxDQUFDLENBQUNELElBQUksQ0FBQyxDQUFDO01BQ2xDOztNQUVBO01BQ0EsTUFBTU8sTUFBTSxHQUFHLEVBQUU7TUFDakJOLENBQUMsQ0FBQyxLQUFLLENBQUMsQ0FBQ08sSUFBSSxDQUFDLENBQUNDLENBQUMsRUFBRUMsRUFBRSxLQUFLO1FBQ3JCLE1BQU1DLEdBQUcsR0FBR1YsQ0FBQyxDQUFDUyxFQUFFLENBQUMsQ0FBQ0UsSUFBSSxDQUFDLEtBQUssQ0FBQztRQUM3QixNQUFNQyxHQUFHLEdBQUdaLENBQUMsQ0FBQ1MsRUFBRSxDQUFDLENBQUNFLElBQUksQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFO1FBRW5DLElBQUlELEdBQUcsRUFBRTtVQUNMO1VBQ0EsTUFBTUcsV0FBVyxHQUFHLElBQUl4SCxHQUFHLENBQUNxSCxHQUFHLEVBQUVwRyxHQUFHLENBQUMsQ0FBQzZFLElBQUk7VUFFMUNtQixNQUFNLENBQUNRLElBQUksQ0FBQztZQUNSSixHQUFHLEVBQUVHLFdBQVc7WUFDaEJELEdBQUc7WUFDSEcsUUFBUSxFQUFFL0gsSUFBSSxDQUFDZ0ksUUFBUSxDQUFDSCxXQUFXO1VBQ3ZDLENBQUMsQ0FBQztRQUNOO01BQ0osQ0FBQyxDQUFDOztNQUVGO01BQ0EsTUFBTUksS0FBSyxHQUFHLEVBQUU7TUFDaEJqQixDQUFDLENBQUMsR0FBRyxDQUFDLENBQUNPLElBQUksQ0FBQyxDQUFDQyxDQUFDLEVBQUVDLEVBQUUsS0FBSztRQUNuQixNQUFNdEIsSUFBSSxHQUFHYSxDQUFDLENBQUNTLEVBQUUsQ0FBQyxDQUFDRSxJQUFJLENBQUMsTUFBTSxDQUFDO1FBQy9CLE1BQU1PLElBQUksR0FBR2xCLENBQUMsQ0FBQ1MsRUFBRSxDQUFDLENBQUNTLElBQUksQ0FBQyxDQUFDLENBQUNDLElBQUksQ0FBQyxDQUFDO1FBRWhDLElBQUloQyxJQUFJLElBQUksQ0FBQ0EsSUFBSSxDQUFDaUMsVUFBVSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUNqQyxJQUFJLENBQUNpQyxVQUFVLENBQUMsYUFBYSxDQUFDLEVBQUU7VUFDbEU7VUFDQSxNQUFNQyxZQUFZLEdBQUcsSUFBSWhJLEdBQUcsQ0FBQzhGLElBQUksRUFBRTdFLEdBQUcsQ0FBQyxDQUFDNkUsSUFBSTtVQUU1QzhCLEtBQUssQ0FBQ0gsSUFBSSxDQUFDO1lBQ1AzQixJQUFJLEVBQUVrQyxZQUFZO1lBQ2xCSCxJQUFJLEVBQUVBLElBQUksSUFBSUc7VUFDbEIsQ0FBQyxDQUFDO1FBQ047TUFDSixDQUFDLENBQUM7TUFFRixNQUFNdkQsSUFBSSxDQUFDakIsS0FBSyxDQUFDLENBQUM7TUFFbEIsT0FBTztRQUNIa0QsSUFBSSxFQUFFRyxXQUFXO1FBQ2pCSSxNQUFNO1FBQ05XO01BQ0osQ0FBQztJQUNMLENBQUMsQ0FBQyxPQUFPdEYsS0FBSyxFQUFFO01BQ1pDLE9BQU8sQ0FBQ0QsS0FBSyxDQUFDLDJDQUEyQyxFQUFFQSxLQUFLLENBQUM7TUFDakUsTUFBTUEsS0FBSztJQUNmO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJLE1BQU02QixhQUFhQSxDQUFDSCxPQUFPLEVBQUVwQyxPQUFPLEVBQUVxRyxPQUFPLEVBQUUxRSxPQUFPLEVBQUU7SUFDcEQ7SUFDQTtJQUNBaEIsT0FBTyxDQUFDMkYsR0FBRyxDQUFDLDZCQUE2QmxFLE9BQU8sQ0FBQ2lELE1BQU0sQ0FBQ0QsTUFBTSx3Q0FBd0MsQ0FBQztFQUMzRzs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0kzQyxnQkFBZ0JBLENBQUN6QixRQUFRLEVBQUVvQixPQUFPLEVBQUVGLFVBQVUsRUFBRTVDLE9BQU8sRUFBRTtJQUNyRCxNQUFNa0QsUUFBUSxHQUFHLEVBQUU7O0lBRW5CO0lBQ0EsTUFBTStELEdBQUcsR0FBRyxJQUFJQyxJQUFJLENBQUMsQ0FBQztJQUN0QixNQUFNQyxhQUFhLEdBQUdGLEdBQUcsQ0FBQ0csV0FBVyxDQUFDLENBQUMsQ0FBQ0MsS0FBSyxDQUFDLEdBQUcsQ0FBQyxDQUFDLENBQUMsQ0FBQyxDQUFDQyxPQUFPLENBQUMsR0FBRyxFQUFFLEdBQUcsQ0FBQzs7SUFFdkU7SUFDQSxNQUFNQyxTQUFTLEdBQUd2SCxPQUFPLENBQUNtRSxLQUFLLElBQUl6QyxRQUFRLENBQUN5QyxLQUFLLElBQUksYUFBYXpDLFFBQVEsQ0FBQzNCLEdBQUcsRUFBRTs7SUFFaEY7SUFDQSxNQUFNO01BQUV5SDtJQUEwQixDQUFDLEdBQUc5SSxPQUFPLENBQUMsb0NBQW9DLENBQUM7SUFDbkYsTUFBTStJLFdBQVcsR0FBR0QseUJBQXlCLENBQUM7TUFDMUNyRCxLQUFLLEVBQUVvRCxTQUFTO01BQ2hCRyxRQUFRLEVBQUU7SUFDZCxDQUFDLENBQUM7SUFFRnhFLFFBQVEsQ0FBQ3FELElBQUksQ0FBQ2tCLFdBQVcsQ0FBQ2IsSUFBSSxDQUFDLENBQUMsQ0FBQzs7SUFFakM7SUFDQTFELFFBQVEsQ0FBQ3FELElBQUksQ0FBQyxLQUFLZ0IsU0FBUyxFQUFFLENBQUM7SUFDL0JyRSxRQUFRLENBQUNxRCxJQUFJLENBQUMsRUFBRSxDQUFDOztJQUVqQjtJQUNBckQsUUFBUSxDQUFDcUQsSUFBSSxDQUFDLHFCQUFxQixDQUFDO0lBQ3BDckQsUUFBUSxDQUFDcUQsSUFBSSxDQUFDLEVBQUUsQ0FBQztJQUNqQnJELFFBQVEsQ0FBQ3FELElBQUksQ0FBQyxzQkFBc0IsQ0FBQztJQUNyQ3JELFFBQVEsQ0FBQ3FELElBQUksQ0FBQyxlQUFlLENBQUM7SUFDOUJyRCxRQUFRLENBQUNxRCxJQUFJLENBQUMsWUFBWTdFLFFBQVEsQ0FBQzNCLEdBQUcsS0FBSzJCLFFBQVEsQ0FBQzNCLEdBQUcsS0FBSyxDQUFDO0lBQzdEbUQsUUFBUSxDQUFDcUQsSUFBSSxDQUFDLGNBQWM3RSxRQUFRLENBQUNtRCxNQUFNLElBQUksQ0FBQztJQUVoRCxJQUFJbkQsUUFBUSxDQUFDeUMsS0FBSyxFQUFFakIsUUFBUSxDQUFDcUQsSUFBSSxDQUFDLGFBQWE3RSxRQUFRLENBQUN5QyxLQUFLLElBQUksQ0FBQztJQUNsRSxJQUFJekMsUUFBUSxDQUFDMEMsV0FBVyxFQUFFbEIsUUFBUSxDQUFDcUQsSUFBSSxDQUFDLG1CQUFtQjdFLFFBQVEsQ0FBQzBDLFdBQVcsSUFBSSxDQUFDO0lBQ3BGLElBQUkxQyxRQUFRLENBQUM0QyxNQUFNLEVBQUVwQixRQUFRLENBQUNxRCxJQUFJLENBQUMsY0FBYzdFLFFBQVEsQ0FBQzRDLE1BQU0sSUFBSSxDQUFDO0lBQ3JFLElBQUk1QyxRQUFRLENBQUMyQyxRQUFRLEVBQUVuQixRQUFRLENBQUNxRCxJQUFJLENBQUMsZ0JBQWdCN0UsUUFBUSxDQUFDMkMsUUFBUSxJQUFJLENBQUM7SUFFM0VuQixRQUFRLENBQUNxRCxJQUFJLENBQUMsRUFBRSxDQUFDOztJQUVqQjtJQUNBLElBQUkzRCxVQUFVLEVBQUU7TUFDWk0sUUFBUSxDQUFDcUQsSUFBSSxDQUFDLGVBQWUsQ0FBQztNQUM5QnJELFFBQVEsQ0FBQ3FELElBQUksQ0FBQyxFQUFFLENBQUM7TUFDakJyRCxRQUFRLENBQUNxRCxJQUFJLENBQUMsbUJBQW1CN0UsUUFBUSxDQUFDeUMsS0FBSyxJQUFJekMsUUFBUSxDQUFDM0IsR0FBRyxLQUFLNkMsVUFBVSxHQUFHLENBQUM7TUFDbEZNLFFBQVEsQ0FBQ3FELElBQUksQ0FBQyxFQUFFLENBQUM7SUFDckI7O0lBRUE7SUFDQXJELFFBQVEsQ0FBQ3FELElBQUksQ0FBQyxZQUFZLENBQUM7SUFDM0JyRCxRQUFRLENBQUNxRCxJQUFJLENBQUMsRUFBRSxDQUFDOztJQUVqQjtJQUNBLE1BQU1vQixlQUFlLEdBQUdqSixPQUFPLENBQUMsVUFBVSxDQUFDO0lBQzNDLE1BQU1rSixlQUFlLEdBQUcsSUFBSUQsZUFBZSxDQUFDO01BQ3hDRSxZQUFZLEVBQUUsS0FBSztNQUNuQkMsY0FBYyxFQUFFLFFBQVE7TUFDeEJDLFdBQVcsRUFBRTtJQUNqQixDQUFDLENBQUM7O0lBRUY7SUFDQTs7SUFFQSxNQUFNQyxlQUFlLEdBQUdKLGVBQWUsQ0FBQ0ssUUFBUSxDQUFDbkYsT0FBTyxDQUFDMEMsSUFBSSxDQUFDO0lBQzlEdEMsUUFBUSxDQUFDcUQsSUFBSSxDQUFDeUIsZUFBZSxDQUFDOztJQUU5QjtJQUNBLElBQUloSSxPQUFPLENBQUNrSSxZQUFZLElBQUlwRixPQUFPLENBQUM0RCxLQUFLLElBQUk1RCxPQUFPLENBQUM0RCxLQUFLLENBQUNaLE1BQU0sR0FBRyxDQUFDLEVBQUU7TUFDbkU1QyxRQUFRLENBQUNxRCxJQUFJLENBQUMsRUFBRSxDQUFDO01BQ2pCckQsUUFBUSxDQUFDcUQsSUFBSSxDQUFDLFVBQVUsQ0FBQztNQUN6QnJELFFBQVEsQ0FBQ3FELElBQUksQ0FBQyxFQUFFLENBQUM7TUFFakJ6RCxPQUFPLENBQUM0RCxLQUFLLENBQUN5QixPQUFPLENBQUNDLElBQUksSUFBSTtRQUMxQmxGLFFBQVEsQ0FBQ3FELElBQUksQ0FBQyxNQUFNNkIsSUFBSSxDQUFDekIsSUFBSSxLQUFLeUIsSUFBSSxDQUFDeEQsSUFBSSxHQUFHLENBQUM7TUFDbkQsQ0FBQyxDQUFDO0lBQ047SUFFQSxPQUFPMUIsUUFBUSxDQUFDckIsSUFBSSxDQUFDLElBQUksQ0FBQztFQUM5Qjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtFQUNJdkIsb0JBQW9CQSxDQUFBLEVBQUc7SUFDbkIsT0FBTyxPQUFPNEcsSUFBSSxDQUFDRCxHQUFHLENBQUMsQ0FBQyxJQUFJb0IsSUFBSSxDQUFDQyxNQUFNLENBQUMsQ0FBQyxDQUFDQyxRQUFRLENBQUMsRUFBRSxDQUFDLENBQUNDLE1BQU0sQ0FBQyxDQUFDLEVBQUUsQ0FBQyxDQUFDLEVBQUU7RUFDekU7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtBQUNBO0VBQ0lsSCxzQkFBc0JBLENBQUNqQixZQUFZLEVBQUVTLE1BQU0sRUFBRTJILE9BQU8sR0FBRyxDQUFDLENBQUMsRUFBRTtJQUN2RCxNQUFNdEcsVUFBVSxHQUFHLElBQUksQ0FBQzlDLGlCQUFpQixDQUFDK0MsR0FBRyxDQUFDL0IsWUFBWSxDQUFDO0lBQzNELElBQUk4QixVQUFVLEVBQUU7TUFDWkEsVUFBVSxDQUFDckIsTUFBTSxHQUFHQSxNQUFNO01BQzFCNEgsTUFBTSxDQUFDQyxNQUFNLENBQUN4RyxVQUFVLEVBQUVzRyxPQUFPLENBQUM7TUFFbEMsSUFBSXRHLFVBQVUsQ0FBQzVCLE1BQU0sRUFBRTtRQUNuQjRCLFVBQVUsQ0FBQzVCLE1BQU0sQ0FBQ1MsV0FBVyxDQUFDQyxJQUFJLENBQUMseUJBQXlCLEVBQUU7VUFDMURaLFlBQVk7VUFDWlMsTUFBTTtVQUNOLEdBQUcySDtRQUNQLENBQUMsQ0FBQztNQUNOO0lBQ0o7RUFDSjs7RUFFQTtBQUNKO0FBQ0E7QUFDQTtBQUNBO0VBQ0lHLFdBQVdBLENBQUM3SSxHQUFHLEVBQUU7SUFDYixJQUFJO01BQ0EsTUFBTUUsU0FBUyxHQUFHLElBQUluQixHQUFHLENBQUNpQixHQUFHLENBQUM7TUFDOUIsT0FBTyxJQUFJLENBQUNYLGtCQUFrQixDQUFDYyxRQUFRLENBQUNELFNBQVMsQ0FBQ0UsUUFBUSxDQUFDO0lBQy9ELENBQUMsQ0FBQyxPQUFPaUIsS0FBSyxFQUFFO01BQ1osT0FBTyxLQUFLO0lBQ2hCO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7RUFDSXlILE9BQU9BLENBQUEsRUFBRztJQUNOLE9BQU87TUFDSC9FLElBQUksRUFBRSxlQUFlO01BQ3JCZ0YsU0FBUyxFQUFFLElBQUksQ0FBQzFKLGtCQUFrQjtNQUNsQ2dGLFdBQVcsRUFBRSxxRUFBcUU7TUFDbEZwRSxPQUFPLEVBQUU7UUFDTG1FLEtBQUssRUFBRSxxQkFBcUI7UUFDNUJ0QixpQkFBaUIsRUFBRSxxREFBcUQ7UUFDeEVHLGFBQWEsRUFBRSw2REFBNkQ7UUFDNUVrRixZQUFZLEVBQUUsa0RBQWtEO1FBQ2hFOUMsUUFBUSxFQUFFO01BQ2Q7SUFDSixDQUFDO0VBQ0w7QUFDSjtBQUVBMkQsTUFBTSxDQUFDQyxPQUFPLEdBQUdoSyxZQUFZIiwiaWdub3JlTGlzdCI6W119