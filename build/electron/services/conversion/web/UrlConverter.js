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
      const window = event.sender.getOwnerBrowserWindow();

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

      // Notify client that conversion has started
      window.webContents.send('url:conversion-started', {
        conversionId
      });

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
    try {
      const imagesDir = path.join(tempDir, 'images');
      await fs.ensureDir(imagesDir);

      // Download images
      for (const image of content.images) {
        try {
          const page = await browser.newPage();

          // Set up response interception
          await page.setRequestInterception(true);
          page.on('request', request => {
            if (request.url() === image.src) {
              request.continue();
            } else {
              request.abort();
            }
          });
          const response = await page.goto(image.src, {
            timeout: 10000
          });
          if (response.ok()) {
            const buffer = await response.buffer();
            const imagePath = path.join(imagesDir, image.filename);
            await fs.writeFile(imagePath, buffer);

            // Update image with local path
            image.localPath = imagePath;
            image.data = `data:${response.headers()['content-type']};base64,${buffer.toString('base64')}`;
          }
          await page.close();
        } catch (error) {
          console.error(`[UrlConverter] Failed to download image: ${image.src}`, error);
          // Continue with other images
        }
      }
    } catch (error) {
      console.error('[UrlConverter] Failed to process images:', error);
      throw error;
    }
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

    // Create standardized frontmatter
    markdown.push('---');
    markdown.push(`title: ${pageTitle}`);
    markdown.push(`converted: ${convertedDate}`);
    markdown.push('type: url');
    markdown.push('---');
    markdown.push('');

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

    // Customize turndown
    turndownService.addRule('images', {
      filter: 'img',
      replacement: function (content, node) {
        const alt = node.alt || '';
        const src = node.getAttribute('src') || '';

        // Find image in content.images
        const image = content.images?.find(img => img.src === src || img.src.endsWith(src));

        // Use data URL if available
        const imageUrl = image?.data || src;
        return `![${alt}](${imageUrl})`;
      }
    });
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
      description: 'Converts web pages to markdown',
      options: {
        title: 'Optional page title',
        includeScreenshot: 'Whether to include page screenshot (default: false)',
        includeImages: 'Whether to include images (default: true)',
        includeLinks: 'Whether to include links section (default: true)',
        waitTime: 'Additional time to wait for page load in ms'
      }
    };
  }
}
module.exports = UrlConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwicHVwcGV0ZWVyIiwiY2hlZXJpbyIsIlVSTCIsIkJhc2VTZXJ2aWNlIiwiVXJsQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJzdXBwb3J0ZWRQcm90b2NvbHMiLCJhY3RpdmVDb252ZXJzaW9ucyIsIk1hcCIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlU2NyZWVuc2hvdCIsImhhbmRsZUNhbmNlbCIsImV2ZW50IiwidXJsIiwib3B0aW9ucyIsInBhcnNlZFVybCIsImluY2x1ZGVzIiwicHJvdG9jb2wiLCJFcnJvciIsImNvbnZlcnNpb25JZCIsImdlbmVyYXRlQ29udmVyc2lvbklkIiwid2luZG93Iiwic2VuZGVyIiwiZ2V0T3duZXJCcm93c2VyV2luZG93IiwidGVtcERpciIsImNyZWF0ZVRlbXBEaXIiLCJzZXQiLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwid2ViQ29udGVudHMiLCJzZW5kIiwicHJvY2Vzc0NvbnZlcnNpb24iLCJjYXRjaCIsImVycm9yIiwiY29uc29sZSIsInVwZGF0ZUNvbnZlcnNpb25TdGF0dXMiLCJtZXNzYWdlIiwicmVtb3ZlIiwiZXJyIiwibWV0YWRhdGEiLCJmZXRjaE1ldGFkYXRhIiwic2NyZWVuc2hvdFBhdGgiLCJqb2luIiwiY2FwdHVyZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90RGF0YSIsInJlYWRGaWxlIiwiZW5jb2RpbmciLCJkYXRhIiwiY29udmVyc2lvbiIsImdldCIsImJyb3dzZXIiLCJjbG9zZSIsImRlbGV0ZSIsInN1Y2Nlc3MiLCJsYXVuY2giLCJoZWFkbGVzcyIsImFyZ3MiLCJzY3JlZW5zaG90IiwiaW5jbHVkZVNjcmVlbnNob3QiLCJjb250ZW50IiwiZXh0cmFjdENvbnRlbnQiLCJpbmNsdWRlSW1hZ2VzIiwicHJvY2Vzc0ltYWdlcyIsIm1hcmtkb3duIiwiZ2VuZXJhdGVNYXJrZG93biIsInJlc3VsdCIsImV4aXN0aW5nQnJvd3NlciIsInNob3VsZENsb3NlQnJvd3NlciIsInBhZ2UiLCJuZXdQYWdlIiwiZ290byIsIndhaXRVbnRpbCIsInRpbWVvdXQiLCJldmFsdWF0ZSIsImdldE1ldGFDb250ZW50IiwibmFtZSIsImVsZW1lbnQiLCJkb2N1bWVudCIsInF1ZXJ5U2VsZWN0b3IiLCJnZXRBdHRyaWJ1dGUiLCJ0aXRsZSIsImRlc2NyaXB0aW9uIiwia2V5d29yZHMiLCJhdXRob3IiLCJvZ1RpdGxlIiwib2dJbWFnZSIsIm9nVHlwZSIsIm9nVXJsIiwiZmF2aWNvbiIsImhyZWYiLCJkb21haW4iLCJob3N0bmFtZSIsInBhdGhuYW1lIiwib3V0cHV0UGF0aCIsIndpZHRoIiwiaGVpZ2h0Iiwic2V0Vmlld3BvcnQiLCJ3YWl0VGltZSIsIndhaXRGb3JUaW1lb3V0IiwiZnVsbFBhZ2UiLCJ0eXBlIiwiaHRtbCIsIiQiLCJsb2FkIiwibWFpbkNvbnRlbnQiLCJtYWluU2VsZWN0b3JzIiwic2VsZWN0b3IiLCJsZW5ndGgiLCJpbWFnZXMiLCJlYWNoIiwiaSIsImVsIiwic3JjIiwiYXR0ciIsImFsdCIsImFic29sdXRlU3JjIiwicHVzaCIsImZpbGVuYW1lIiwiYmFzZW5hbWUiLCJsaW5rcyIsInRleHQiLCJ0cmltIiwic3RhcnRzV2l0aCIsImFic29sdXRlSHJlZiIsImJhc2VVcmwiLCJpbWFnZXNEaXIiLCJlbnN1cmVEaXIiLCJpbWFnZSIsInNldFJlcXVlc3RJbnRlcmNlcHRpb24iLCJvbiIsInJlcXVlc3QiLCJjb250aW51ZSIsImFib3J0IiwicmVzcG9uc2UiLCJvayIsImJ1ZmZlciIsImltYWdlUGF0aCIsIndyaXRlRmlsZSIsImxvY2FsUGF0aCIsImhlYWRlcnMiLCJ0b1N0cmluZyIsIm5vdyIsIkRhdGUiLCJjb252ZXJ0ZWREYXRlIiwidG9JU09TdHJpbmciLCJzcGxpdCIsInJlcGxhY2UiLCJwYWdlVGl0bGUiLCJUdXJuZG93blNlcnZpY2UiLCJ0dXJuZG93blNlcnZpY2UiLCJoZWFkaW5nU3R5bGUiLCJjb2RlQmxvY2tTdHlsZSIsImVtRGVsaW1pdGVyIiwiYWRkUnVsZSIsImZpbHRlciIsInJlcGxhY2VtZW50Iiwibm9kZSIsImZpbmQiLCJpbWciLCJlbmRzV2l0aCIsImltYWdlVXJsIiwibWFya2Rvd25Db250ZW50IiwidHVybmRvd24iLCJpbmNsdWRlTGlua3MiLCJmb3JFYWNoIiwibGluayIsIk1hdGgiLCJyYW5kb20iLCJzdWJzdHIiLCJkZXRhaWxzIiwiT2JqZWN0IiwiYXNzaWduIiwic3VwcG9ydHNVcmwiLCJnZXRJbmZvIiwicHJvdG9jb2xzIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL3dlYi9VcmxDb252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFVybENvbnZlcnRlci5qc1xyXG4gKiBIYW5kbGVzIGNvbnZlcnNpb24gb2Ygd2ViIHBhZ2VzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBcclxuICogVGhpcyBjb252ZXJ0ZXI6XHJcbiAqIC0gRmV0Y2hlcyB3ZWIgcGFnZXMgdXNpbmcgcHVwcGV0ZWVyXHJcbiAqIC0gRXh0cmFjdHMgY29udGVudCwgbWV0YWRhdGEsIGFuZCBpbWFnZXNcclxuICogLSBIYW5kbGVzIEphdmFTY3JpcHQtcmVuZGVyZWQgY29udGVudFxyXG4gKiAtIEdlbmVyYXRlcyBtYXJrZG93biB3aXRoIHN0cnVjdHVyZWQgY29udGVudFxyXG4gKiBcclxuICogUmVsYXRlZCBGaWxlczpcclxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcclxuICogLSBGaWxlU3RvcmFnZVNlcnZpY2UuanM6IEZvciB0ZW1wb3JhcnkgZmlsZSBtYW5hZ2VtZW50XHJcbiAqIC0gUGFyZW50VXJsQ29udmVydGVyLmpzOiBGb3IgbXVsdGktcGFnZSBzaXRlIGNvbnZlcnNpb25cclxuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBwdXBwZXRlZXIgPSByZXF1aXJlKCdwdXBwZXRlZXInKTtcclxuY29uc3QgY2hlZXJpbyA9IHJlcXVpcmUoJ2NoZWVyaW8nKTtcclxuY29uc3QgeyBVUkwgfSA9IHJlcXVpcmUoJ3VybCcpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XHJcblxyXG5jbGFzcyBVcmxDb252ZXJ0ZXIgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSkge1xyXG4gICAgICAgIHN1cGVyKCk7XHJcbiAgICAgICAgdGhpcy5maWxlUHJvY2Vzc29yID0gZmlsZVByb2Nlc3NvcjtcclxuICAgICAgICB0aGlzLmZpbGVTdG9yYWdlID0gZmlsZVN0b3JhZ2U7XHJcbiAgICAgICAgdGhpcy5zdXBwb3J0ZWRQcm90b2NvbHMgPSBbJ2h0dHA6JywgJ2h0dHBzOiddO1xyXG4gICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMgPSBuZXcgTWFwKCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciBVUkwgY29udmVyc2lvblxyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnVybCcsIHRoaXMuaGFuZGxlQ29udmVydC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDp1cmw6bWV0YWRhdGEnLCB0aGlzLmhhbmRsZUdldE1ldGFkYXRhLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnVybDpzY3JlZW5zaG90JywgdGhpcy5oYW5kbGVTY3JlZW5zaG90LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnVybDpjYW5jZWwnLCB0aGlzLmhhbmRsZUNhbmNlbC5iaW5kKHRoaXMpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBVUkwgY29udmVyc2lvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29udmVyc2lvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyB1cmwsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgVVJMXHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZFVybCA9IG5ldyBVUkwodXJsKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLnN1cHBvcnRlZFByb3RvY29scy5pbmNsdWRlcyhwYXJzZWRVcmwucHJvdG9jb2wpKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHByb3RvY29sOiAke3BhcnNlZFVybC5wcm90b2NvbH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbklkID0gdGhpcy5nZW5lcmF0ZUNvbnZlcnNpb25JZCgpO1xyXG4gICAgICAgICAgICBjb25zdCB3aW5kb3cgPSBldmVudC5zZW5kZXIuZ2V0T3duZXJCcm93c2VyV2luZG93KCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDcmVhdGUgdGVtcCBkaXJlY3RvcnkgZm9yIHRoaXMgY29udmVyc2lvblxyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgdGhpcy5maWxlU3RvcmFnZS5jcmVhdGVUZW1wRGlyKCd1cmxfY29udmVyc2lvbicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zZXQoY29udmVyc2lvbklkLCB7XHJcbiAgICAgICAgICAgICAgICBpZDogY29udmVyc2lvbklkLFxyXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnc3RhcnRpbmcnLFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDAsXHJcbiAgICAgICAgICAgICAgICB1cmwsXHJcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxyXG4gICAgICAgICAgICAgICAgd2luZG93XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gTm90aWZ5IGNsaWVudCB0aGF0IGNvbnZlcnNpb24gaGFzIHN0YXJ0ZWRcclxuICAgICAgICAgICAgd2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ3VybDpjb252ZXJzaW9uLXN0YXJ0ZWQnLCB7IGNvbnZlcnNpb25JZCB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2Vzc1xyXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgdXJsLCBvcHRpb25zKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQ29udmVydGVyXSBDb252ZXJzaW9uIGZhaWxlZCBmb3IgJHtjb252ZXJzaW9uSWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdmYWlsZWQnLCB7IGVycm9yOiBlcnJvci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgZnMucmVtb3ZlKHRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke3RlbXBEaXJ9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnZlcnNpb25JZCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBzdGFydCBjb252ZXJzaW9uOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIFVSTCBtZXRhZGF0YSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gTWV0YWRhdGEgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldE1ldGFkYXRhKGV2ZW50LCB7IHVybCB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmZldGNoTWV0YWRhdGEodXJsKTtcclxuICAgICAgICAgICAgcmV0dXJuIG1ldGFkYXRhO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBnZXQgbWV0YWRhdGE6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgVVJMIHNjcmVlbnNob3QgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFNjcmVlbnNob3QgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVNjcmVlbnNob3QoZXZlbnQsIHsgdXJsLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3VybF9zY3JlZW5zaG90Jyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3RQYXRoID0gcGF0aC5qb2luKHRlbXBEaXIsICdzY3JlZW5zaG90LnBuZycpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlU2NyZWVuc2hvdCh1cmwsIHNjcmVlbnNob3RQYXRoLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFJlYWQgdGhlIHNjcmVlbnNob3QgYXMgYmFzZTY0XHJcbiAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3REYXRhID0gYXdhaXQgZnMucmVhZEZpbGUoc2NyZWVuc2hvdFBhdGgsIHsgZW5jb2Rpbmc6ICdiYXNlNjQnIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGRhdGE6IGBkYXRhOmltYWdlL3BuZztiYXNlNjQsJHtzY3JlZW5zaG90RGF0YX1gLFxyXG4gICAgICAgICAgICAgICAgdXJsXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIGNhcHR1cmUgc2NyZWVuc2hvdDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBjb252ZXJzaW9uIGNhbmNlbGxhdGlvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ2FuY2VsbGF0aW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDYW5jZWwoZXZlbnQsIHsgY29udmVyc2lvbklkIH0pIHtcclxuICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcclxuICAgICAgICBpZiAoY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLnN0YXR1cyA9ICdjYW5jZWxsZWQnO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24uYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgY29udmVyc2lvbi5icm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLndpbmRvdykge1xyXG4gICAgICAgICAgICAgICAgY29udmVyc2lvbi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgndXJsOmNvbnZlcnNpb24tY2FuY2VsbGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLnRlbXBEaXIpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmRlbGV0ZShjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBQcm9jZXNzIFVSTCBjb252ZXJzaW9uXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGNvbnZlcnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgdXJsLCBvcHRpb25zKSB7XHJcbiAgICAgICAgbGV0IGJyb3dzZXIgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBub3QgZm91bmQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGNvbnZlcnNpb24udGVtcERpcjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIExhdW5jaCBicm93c2VyXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdsYXVuY2hpbmdfYnJvd3NlcicsIHsgcHJvZ3Jlc3M6IDUgfSk7XHJcbiAgICAgICAgICAgIGJyb3dzZXIgPSBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgICAgIGhlYWRsZXNzOiAnbmV3JyxcclxuICAgICAgICAgICAgICAgIGFyZ3M6IFsnLS1uby1zYW5kYm94JywgJy0tZGlzYWJsZS1zZXR1aWQtc2FuZGJveCddXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29udmVyc2lvbi5icm93c2VyID0gYnJvd3NlcjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEZldGNoIG1ldGFkYXRhXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdmZXRjaGluZ19tZXRhZGF0YScsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHRoaXMuZmV0Y2hNZXRhZGF0YSh1cmwsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2FwdHVyZSBzY3JlZW5zaG90IGlmIHJlcXVlc3RlZFxyXG4gICAgICAgICAgICBsZXQgc2NyZWVuc2hvdCA9IG51bGw7XHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVTY3JlZW5zaG90KSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnY2FwdHVyaW5nX3NjcmVlbnNob3QnLCB7IHByb2dyZXNzOiAyMCB9KTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3RQYXRoID0gcGF0aC5qb2luKHRlbXBEaXIsICdzY3JlZW5zaG90LnBuZycpO1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlU2NyZWVuc2hvdCh1cmwsIHNjcmVlbnNob3RQYXRoLCBvcHRpb25zLCBicm93c2VyKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gUmVhZCBzY3JlZW5zaG90IGFzIGJhc2U2NFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2NyZWVuc2hvdERhdGEgPSBhd2FpdCBmcy5yZWFkRmlsZShzY3JlZW5zaG90UGF0aCwgeyBlbmNvZGluZzogJ2Jhc2U2NCcgfSk7XHJcbiAgICAgICAgICAgICAgICBzY3JlZW5zaG90ID0gYGRhdGE6aW1hZ2UvcG5nO2Jhc2U2NCwke3NjcmVlbnNob3REYXRhfWA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgY29udGVudFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZXh0cmFjdGluZ19jb250ZW50JywgeyBwcm9ncmVzczogNDAgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmV4dHJhY3RDb250ZW50KHVybCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIGltYWdlcyBpZiByZXF1ZXN0ZWRcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZUltYWdlcykge1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3Byb2Nlc3NpbmdfaW1hZ2VzJywgeyBwcm9ncmVzczogNjAgfSk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnByb2Nlc3NJbWFnZXMoY29udGVudCwgdGVtcERpciwgdXJsLCBicm93c2VyKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgbWFya2Rvd25cclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2dlbmVyYXRpbmdfbWFya2Rvd24nLCB7IHByb2dyZXNzOiA4MCB9KTtcclxuICAgICAgICAgICAgY29uc3QgbWFya2Rvd24gPSB0aGlzLmdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIGNvbnRlbnQsIHNjcmVlbnNob3QsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlclxyXG4gICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uYnJvd3NlciA9IG51bGw7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnY29tcGxldGVkJywgeyBcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAsXHJcbiAgICAgICAgICAgICAgICByZXN1bHQ6IG1hcmtkb3duXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIG1hcmtkb3duO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tVcmxDb252ZXJ0ZXJdIENvbnZlcnNpb24gcHJvY2Vzc2luZyBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlciBpZiBvcGVuXHJcbiAgICAgICAgICAgIGlmIChicm93c2VyKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEZldGNoIG1ldGFkYXRhIGZyb20gVVJMXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGZldGNoXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBbZXhpc3RpbmdCcm93c2VyXSAtIEV4aXN0aW5nIGJyb3dzZXIgaW5zdGFuY2VcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IFVSTCBtZXRhZGF0YVxyXG4gICAgICovXHJcbiAgICBhc3luYyBmZXRjaE1ldGFkYXRhKHVybCwgZXhpc3RpbmdCcm93c2VyID0gbnVsbCkge1xyXG4gICAgICAgIGxldCBicm93c2VyID0gZXhpc3RpbmdCcm93c2VyO1xyXG4gICAgICAgIGxldCBzaG91bGRDbG9zZUJyb3dzZXIgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBpZiAoIWJyb3dzZXIpIHtcclxuICAgICAgICAgICAgICAgIGJyb3dzZXIgPSBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgICAgICAgICAgYXJnczogWyctLW5vLXNhbmRib3gnLCAnLS1kaXNhYmxlLXNldHVpZC1zYW5kYm94J11cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2hvdWxkQ2xvc2VCcm93c2VyID0gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgcGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmdvdG8odXJsLCB7IHdhaXRVbnRpbDogJ25ldHdvcmtpZGxlMicsIHRpbWVvdXQ6IDMwMDAwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBtZXRhZGF0YVxyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZ2V0TWV0YUNvbnRlbnQgPSAobmFtZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsZW1lbnQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKGBtZXRhW25hbWU9XCIke25hbWV9XCJdLCBtZXRhW3Byb3BlcnR5PVwiJHtuYW1lfVwiXWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBlbGVtZW50ID8gZWxlbWVudC5nZXRBdHRyaWJ1dGUoJ2NvbnRlbnQnKSA6IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiBkb2N1bWVudC50aXRsZSxcclxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogZ2V0TWV0YUNvbnRlbnQoJ2Rlc2NyaXB0aW9uJykgfHwgZ2V0TWV0YUNvbnRlbnQoJ29nOmRlc2NyaXB0aW9uJyksXHJcbiAgICAgICAgICAgICAgICAgICAga2V5d29yZHM6IGdldE1ldGFDb250ZW50KCdrZXl3b3JkcycpLFxyXG4gICAgICAgICAgICAgICAgICAgIGF1dGhvcjogZ2V0TWV0YUNvbnRlbnQoJ2F1dGhvcicpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9nVGl0bGU6IGdldE1ldGFDb250ZW50KCdvZzp0aXRsZScpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9nSW1hZ2U6IGdldE1ldGFDb250ZW50KCdvZzppbWFnZScpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9nVHlwZTogZ2V0TWV0YUNvbnRlbnQoJ29nOnR5cGUnKSxcclxuICAgICAgICAgICAgICAgICAgICBvZ1VybDogZ2V0TWV0YUNvbnRlbnQoJ29nOnVybCcpLFxyXG4gICAgICAgICAgICAgICAgICAgIGZhdmljb246IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ2xpbmtbcmVsPVwiaWNvblwiXSwgbGlua1tyZWw9XCJzaG9ydGN1dCBpY29uXCJdJyk/LmhyZWZcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIFVSTCBpbmZvcm1hdGlvblxyXG4gICAgICAgICAgICBjb25zdCBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybCk7XHJcbiAgICAgICAgICAgIG1ldGFkYXRhLnVybCA9IHVybDtcclxuICAgICAgICAgICAgbWV0YWRhdGEuZG9tYWluID0gcGFyc2VkVXJsLmhvc3RuYW1lO1xyXG4gICAgICAgICAgICBtZXRhZGF0YS5wYXRoID0gcGFyc2VkVXJsLnBhdGhuYW1lO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgYXdhaXQgcGFnZS5jbG9zZSgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHNob3VsZENsb3NlQnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gbWV0YWRhdGE7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIGZldGNoIG1ldGFkYXRhOicsIGVycm9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChzaG91bGRDbG9zZUJyb3dzZXIgJiYgYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDYXB0dXJlIHNjcmVlbnNob3Qgb2YgVVJMXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGNhcHR1cmVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBvdXRwdXRQYXRoIC0gT3V0cHV0IHBhdGggZm9yIHNjcmVlbnNob3RcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU2NyZWVuc2hvdCBvcHRpb25zXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBbZXhpc3RpbmdCcm93c2VyXSAtIEV4aXN0aW5nIGJyb3dzZXIgaW5zdGFuY2VcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxyXG4gICAgICovXHJcbiAgICBhc3luYyBjYXB0dXJlU2NyZWVuc2hvdCh1cmwsIG91dHB1dFBhdGgsIG9wdGlvbnMgPSB7fSwgZXhpc3RpbmdCcm93c2VyID0gbnVsbCkge1xyXG4gICAgICAgIGxldCBicm93c2VyID0gZXhpc3RpbmdCcm93c2VyO1xyXG4gICAgICAgIGxldCBzaG91bGRDbG9zZUJyb3dzZXIgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBpZiAoIWJyb3dzZXIpIHtcclxuICAgICAgICAgICAgICAgIGJyb3dzZXIgPSBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgICAgICAgICAgYXJnczogWyctLW5vLXNhbmRib3gnLCAnLS1kaXNhYmxlLXNldHVpZC1zYW5kYm94J11cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2hvdWxkQ2xvc2VCcm93c2VyID0gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgcGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU2V0IHZpZXdwb3J0IHNpemVcclxuICAgICAgICAgICAgY29uc3Qgd2lkdGggPSBvcHRpb25zLndpZHRoIHx8IDEyODA7XHJcbiAgICAgICAgICAgIGNvbnN0IGhlaWdodCA9IG9wdGlvbnMuaGVpZ2h0IHx8IDgwMDtcclxuICAgICAgICAgICAgYXdhaXQgcGFnZS5zZXRWaWV3cG9ydCh7IHdpZHRoLCBoZWlnaHQgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBOYXZpZ2F0ZSB0byBVUkxcclxuICAgICAgICAgICAgYXdhaXQgcGFnZS5nb3RvKHVybCwgeyB3YWl0VW50aWw6ICduZXR3b3JraWRsZTInLCB0aW1lb3V0OiAzMDAwMCB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFdhaXQgZm9yIGFkZGl0aW9uYWwgdGltZSBpZiBzcGVjaWZpZWRcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMud2FpdFRpbWUpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQob3B0aW9ucy53YWl0VGltZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENhcHR1cmUgc2NyZWVuc2hvdFxyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLnNjcmVlbnNob3Qoe1xyXG4gICAgICAgICAgICAgICAgcGF0aDogb3V0cHV0UGF0aCxcclxuICAgICAgICAgICAgICAgIGZ1bGxQYWdlOiBvcHRpb25zLmZ1bGxQYWdlIHx8IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgdHlwZTogJ3BuZydcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoc2hvdWxkQ2xvc2VCcm93c2VyKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVXJsQ29udmVydGVyXSBGYWlsZWQgdG8gY2FwdHVyZSBzY3JlZW5zaG90OicsIGVycm9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChzaG91bGRDbG9zZUJyb3dzZXIgJiYgYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBFeHRyYWN0IGNvbnRlbnQgZnJvbSBVUkxcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gZXh0cmFjdCBjb250ZW50IGZyb21cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gRXh0cmFjdGlvbiBvcHRpb25zXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBicm93c2VyIC0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gRXh0cmFjdGVkIGNvbnRlbnRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZXh0cmFjdENvbnRlbnQodXJsLCBvcHRpb25zLCBicm93c2VyKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgcGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmdvdG8odXJsLCB7IHdhaXRVbnRpbDogJ25ldHdvcmtpZGxlMicsIHRpbWVvdXQ6IDMwMDAwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gV2FpdCBmb3IgYWRkaXRpb25hbCB0aW1lIGlmIHNwZWNpZmllZFxyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy53YWl0VGltZSkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dChvcHRpb25zLndhaXRUaW1lKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHBhZ2UgSFRNTFxyXG4gICAgICAgICAgICBjb25zdCBodG1sID0gYXdhaXQgcGFnZS5jb250ZW50KCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGNvbnRlbnQgdXNpbmcgY2hlZXJpb1xyXG4gICAgICAgICAgICBjb25zdCAkID0gY2hlZXJpby5sb2FkKGh0bWwpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUmVtb3ZlIHVud2FudGVkIGVsZW1lbnRzXHJcbiAgICAgICAgICAgICQoJ3NjcmlwdCwgc3R5bGUsIGlmcmFtZSwgbm9zY3JpcHQnKS5yZW1vdmUoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgbWFpbiBjb250ZW50XHJcbiAgICAgICAgICAgIGxldCBtYWluQ29udGVudCA9ICcnO1xyXG4gICAgICAgICAgICBjb25zdCBtYWluU2VsZWN0b3JzID0gW1xyXG4gICAgICAgICAgICAgICAgJ21haW4nLFxyXG4gICAgICAgICAgICAgICAgJ2FydGljbGUnLFxyXG4gICAgICAgICAgICAgICAgJyNjb250ZW50JyxcclxuICAgICAgICAgICAgICAgICcuY29udGVudCcsXHJcbiAgICAgICAgICAgICAgICAnLm1haW4nLFxyXG4gICAgICAgICAgICAgICAgJy5hcnRpY2xlJyxcclxuICAgICAgICAgICAgICAgICcucG9zdCcsXHJcbiAgICAgICAgICAgICAgICAnLnBvc3QtY29udGVudCdcclxuICAgICAgICAgICAgXTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFRyeSB0byBmaW5kIG1haW4gY29udGVudCB1c2luZyBjb21tb24gc2VsZWN0b3JzXHJcbiAgICAgICAgICAgIGZvciAoY29uc3Qgc2VsZWN0b3Igb2YgbWFpblNlbGVjdG9ycykge1xyXG4gICAgICAgICAgICAgICAgaWYgKCQoc2VsZWN0b3IpLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgICAgICBtYWluQ29udGVudCA9ICQoc2VsZWN0b3IpLmh0bWwoKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gSWYgbm8gbWFpbiBjb250ZW50IGZvdW5kLCB1c2UgYm9keVxyXG4gICAgICAgICAgICBpZiAoIW1haW5Db250ZW50KSB7XHJcbiAgICAgICAgICAgICAgICBtYWluQ29udGVudCA9ICQoJ2JvZHknKS5odG1sKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgaW1hZ2VzXHJcbiAgICAgICAgICAgIGNvbnN0IGltYWdlcyA9IFtdO1xyXG4gICAgICAgICAgICAkKCdpbWcnKS5lYWNoKChpLCBlbCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3JjID0gJChlbCkuYXR0cignc3JjJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhbHQgPSAkKGVsKS5hdHRyKCdhbHQnKSB8fCAnJztcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKHNyYykge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJlc29sdmUgcmVsYXRpdmUgVVJMc1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFic29sdXRlU3JjID0gbmV3IFVSTChzcmMsIHVybCkuaHJlZjtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBpbWFnZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNyYzogYWJzb2x1dGVTcmMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFsdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZW5hbWU6IHBhdGguYmFzZW5hbWUoYWJzb2x1dGVTcmMpXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBsaW5rc1xyXG4gICAgICAgICAgICBjb25zdCBsaW5rcyA9IFtdO1xyXG4gICAgICAgICAgICAkKCdhJykuZWFjaCgoaSwgZWwpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGhyZWYgPSAkKGVsKS5hdHRyKCdocmVmJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0ZXh0ID0gJChlbCkudGV4dCgpLnRyaW0oKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGhyZWYgJiYgIWhyZWYuc3RhcnRzV2l0aCgnIycpICYmICFocmVmLnN0YXJ0c1dpdGgoJ2phdmFzY3JpcHQ6JykpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSZXNvbHZlIHJlbGF0aXZlIFVSTHNcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhYnNvbHV0ZUhyZWYgPSBuZXcgVVJMKGhyZWYsIHVybCkuaHJlZjtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBsaW5rcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaHJlZjogYWJzb2x1dGVIcmVmLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiB0ZXh0IHx8IGFic29sdXRlSHJlZlxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuY2xvc2UoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBodG1sOiBtYWluQ29udGVudCxcclxuICAgICAgICAgICAgICAgIGltYWdlcyxcclxuICAgICAgICAgICAgICAgIGxpbmtzXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIGV4dHJhY3QgY29udGVudDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgaW1hZ2VzIGZyb20gY29udGVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGNvbnRlbnQgLSBFeHRyYWN0ZWQgY29udGVudFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHRlbXBEaXIgLSBUZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYmFzZVVybCAtIEJhc2UgVVJMIGZvciByZXNvbHZpbmcgcmVsYXRpdmUgcGF0aHNcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IGJyb3dzZXIgLSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc0ltYWdlcyhjb250ZW50LCB0ZW1wRGlyLCBiYXNlVXJsLCBicm93c2VyKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgaW1hZ2VzRGlyID0gcGF0aC5qb2luKHRlbXBEaXIsICdpbWFnZXMnKTtcclxuICAgICAgICAgICAgYXdhaXQgZnMuZW5zdXJlRGlyKGltYWdlc0Rpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBEb3dubG9hZCBpbWFnZXNcclxuICAgICAgICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBjb250ZW50LmltYWdlcykge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gU2V0IHVwIHJlc3BvbnNlIGludGVyY2VwdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHBhZ2Uuc2V0UmVxdWVzdEludGVyY2VwdGlvbih0cnVlKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBwYWdlLm9uKCdyZXF1ZXN0JywgcmVxdWVzdCA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXF1ZXN0LnVybCgpID09PSBpbWFnZS5zcmMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVlc3QuY29udGludWUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVlc3QuYWJvcnQoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcGFnZS5nb3RvKGltYWdlLnNyYywgeyB0aW1lb3V0OiAxMDAwMCB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBpZiAocmVzcG9uc2Uub2soKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBidWZmZXIgPSBhd2FpdCByZXNwb25zZS5idWZmZXIoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW1hZ2VQYXRoID0gcGF0aC5qb2luKGltYWdlc0RpciwgaW1hZ2UuZmlsZW5hbWUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUoaW1hZ2VQYXRoLCBidWZmZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXBkYXRlIGltYWdlIHdpdGggbG9jYWwgcGF0aFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpbWFnZS5sb2NhbFBhdGggPSBpbWFnZVBhdGg7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGltYWdlLmRhdGEgPSBgZGF0YToke3Jlc3BvbnNlLmhlYWRlcnMoKVsnY29udGVudC10eXBlJ119O2Jhc2U2NCwke2J1ZmZlci50b1N0cmluZygnYmFzZTY0Jyl9YDtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgcGFnZS5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQ29udmVydGVyXSBGYWlsZWQgdG8gZG93bmxvYWQgaW1hZ2U6ICR7aW1hZ2Uuc3JjfWAsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAvLyBDb250aW51ZSB3aXRoIG90aGVyIGltYWdlc1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIHByb2Nlc3MgaW1hZ2VzOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBVUkwgY29udGVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gVVJMIG1ldGFkYXRhXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gY29udGVudCAtIEV4dHJhY3RlZCBjb250ZW50XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc2NyZWVuc2hvdCAtIFNjcmVlbnNob3QgZGF0YSBVUkxcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIGNvbnRlbnQsIHNjcmVlbnNob3QsIG9wdGlvbnMpIHtcclxuICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEdldCBjdXJyZW50IGRhdGV0aW1lXHJcbiAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgICAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbm93LnRvSVNPU3RyaW5nKCkuc3BsaXQoJy4nKVswXS5yZXBsYWNlKCdUJywgJyAnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBHZXQgdGhlIHRpdGxlIGZyb20gbWV0YWRhdGEgb3Igb3B0aW9uc1xyXG4gICAgICAgIGNvbnN0IHBhZ2VUaXRsZSA9IG9wdGlvbnMudGl0bGUgfHwgbWV0YWRhdGEudGl0bGUgfHwgYFdlYiBQYWdlOiAke21ldGFkYXRhLnVybH1gO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgZnJvbnRtYXR0ZXJcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCctLS0nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB0aXRsZTogJHtwYWdlVGl0bGV9YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgY29udmVydGVkOiAke2NvbnZlcnRlZERhdGV9YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgndHlwZTogdXJsJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnLS0tJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHRpdGxlIGFzIGhlYWRpbmdcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7cGFnZVRpdGxlfWApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBtZXRhZGF0YVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIFBhZ2UgSW5mb3JtYXRpb24nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IFByb3BlcnR5IHwgVmFsdWUgfCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFVSTCB8IFske21ldGFkYXRhLnVybH1dKCR7bWV0YWRhdGEudXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRG9tYWluIHwgJHttZXRhZGF0YS5kb21haW59IHxgKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobWV0YWRhdGEudGl0bGUpIG1hcmtkb3duLnB1c2goYHwgVGl0bGUgfCAke21ldGFkYXRhLnRpdGxlfSB8YCk7XHJcbiAgICAgICAgaWYgKG1ldGFkYXRhLmRlc2NyaXB0aW9uKSBtYXJrZG93bi5wdXNoKGB8IERlc2NyaXB0aW9uIHwgJHttZXRhZGF0YS5kZXNjcmlwdGlvbn0gfGApO1xyXG4gICAgICAgIGlmIChtZXRhZGF0YS5hdXRob3IpIG1hcmtkb3duLnB1c2goYHwgQXV0aG9yIHwgJHttZXRhZGF0YS5hdXRob3J9IHxgKTtcclxuICAgICAgICBpZiAobWV0YWRhdGEua2V5d29yZHMpIG1hcmtkb3duLnB1c2goYHwgS2V5d29yZHMgfCAke21ldGFkYXRhLmtleXdvcmRzfSB8YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHNjcmVlbnNob3QgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgaWYgKHNjcmVlbnNob3QpIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgU2NyZWVuc2hvdCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIVtTY3JlZW5zaG90IG9mICR7bWV0YWRhdGEudGl0bGUgfHwgbWV0YWRhdGEudXJsfV0oJHtzY3JlZW5zaG90fSlgKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBjb250ZW50XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgQ29udGVudCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENvbnZlcnQgSFRNTCB0byBtYXJrZG93blxyXG4gICAgICAgIGNvbnN0IFR1cm5kb3duU2VydmljZSA9IHJlcXVpcmUoJ3R1cm5kb3duJyk7XHJcbiAgICAgICAgY29uc3QgdHVybmRvd25TZXJ2aWNlID0gbmV3IFR1cm5kb3duU2VydmljZSh7XHJcbiAgICAgICAgICAgIGhlYWRpbmdTdHlsZTogJ2F0eCcsXHJcbiAgICAgICAgICAgIGNvZGVCbG9ja1N0eWxlOiAnZmVuY2VkJyxcclxuICAgICAgICAgICAgZW1EZWxpbWl0ZXI6ICcqJ1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEN1c3RvbWl6ZSB0dXJuZG93blxyXG4gICAgICAgIHR1cm5kb3duU2VydmljZS5hZGRSdWxlKCdpbWFnZXMnLCB7XHJcbiAgICAgICAgICAgIGZpbHRlcjogJ2ltZycsXHJcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OiBmdW5jdGlvbihjb250ZW50LCBub2RlKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhbHQgPSBub2RlLmFsdCB8fCAnJztcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNyYyA9IG5vZGUuZ2V0QXR0cmlidXRlKCdzcmMnKSB8fCAnJztcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRmluZCBpbWFnZSBpbiBjb250ZW50LmltYWdlc1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaW1hZ2UgPSBjb250ZW50LmltYWdlcz8uZmluZChpbWcgPT4gaW1nLnNyYyA9PT0gc3JjIHx8IGltZy5zcmMuZW5kc1dpdGgoc3JjKSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFVzZSBkYXRhIFVSTCBpZiBhdmFpbGFibGVcclxuICAgICAgICAgICAgICAgIGNvbnN0IGltYWdlVXJsID0gaW1hZ2U/LmRhdGEgfHwgc3JjO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYCFbJHthbHR9XSgke2ltYWdlVXJsfSlgO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgbWFya2Rvd25Db250ZW50ID0gdHVybmRvd25TZXJ2aWNlLnR1cm5kb3duKGNvbnRlbnQuaHRtbCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChtYXJrZG93bkNvbnRlbnQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBsaW5rcyBzZWN0aW9uIGlmIHJlcXVlc3RlZFxyXG4gICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVMaW5rcyAmJiBjb250ZW50LmxpbmtzICYmIGNvbnRlbnQubGlua3MubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgTGlua3MnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb250ZW50LmxpbmtzLmZvckVhY2gobGluayA9PiB7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAtIFske2xpbmsudGV4dH1dKCR7bGluay5ocmVmfSlgKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtYXJrZG93bi5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIHVuaXF1ZSBjb252ZXJzaW9uIElEXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVbmlxdWUgY29udmVyc2lvbiBJRFxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZUNvbnZlcnNpb25JZCgpIHtcclxuICAgICAgICByZXR1cm4gYHVybF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDkpfWA7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBVcGRhdGUgY29udmVyc2lvbiBzdGF0dXMgYW5kIG5vdGlmeSByZW5kZXJlclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0YXR1cyAtIE5ldyBzdGF0dXNcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBkZXRhaWxzIC0gQWRkaXRpb25hbCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIHVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCBzdGF0dXMsIGRldGFpbHMgPSB7fSkge1xyXG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgIGlmIChjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uc3RhdHVzID0gc3RhdHVzO1xyXG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKGNvbnZlcnNpb24sIGRldGFpbHMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24ud2luZG93KSB7XHJcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCd1cmw6Y29udmVyc2lvbi1wcm9ncmVzcycsIHtcclxuICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLFxyXG4gICAgICAgICAgICAgICAgICAgIC4uLmRldGFpbHNcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIFVSTFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFVSTCB0byBjaGVja1xyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXHJcbiAgICAgKi9cclxuICAgIHN1cHBvcnRzVXJsKHVybCkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZFVybCA9IG5ldyBVUkwodXJsKTtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3VwcG9ydGVkUHJvdG9jb2xzLmluY2x1ZGVzKHBhcnNlZFVybC5wcm90b2NvbCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGdldEluZm8oKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbmFtZTogJ1VSTCBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICBwcm90b2NvbHM6IHRoaXMuc3VwcG9ydGVkUHJvdG9jb2xzLFxyXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnRzIHdlYiBwYWdlcyB0byBtYXJrZG93bicsXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgcGFnZSB0aXRsZScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlU2NyZWVuc2hvdDogJ1doZXRoZXIgdG8gaW5jbHVkZSBwYWdlIHNjcmVlbnNob3QgKGRlZmF1bHQ6IGZhbHNlKScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlSW1hZ2VzOiAnV2hldGhlciB0byBpbmNsdWRlIGltYWdlcyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUxpbmtzOiAnV2hldGhlciB0byBpbmNsdWRlIGxpbmtzIHNlY3Rpb24gKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIHdhaXRUaW1lOiAnQWRkaXRpb25hbCB0aW1lIHRvIHdhaXQgZm9yIHBhZ2UgbG9hZCBpbiBtcydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gVXJsQ29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNRSxTQUFTLEdBQUdGLE9BQU8sQ0FBQyxXQUFXLENBQUM7QUFDdEMsTUFBTUcsT0FBTyxHQUFHSCxPQUFPLENBQUMsU0FBUyxDQUFDO0FBQ2xDLE1BQU07RUFBRUk7QUFBSSxDQUFDLEdBQUdKLE9BQU8sQ0FBQyxLQUFLLENBQUM7QUFDOUIsTUFBTUssV0FBVyxHQUFHTCxPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFFaEQsTUFBTU0sWUFBWSxTQUFTRCxXQUFXLENBQUM7RUFDbkNFLFdBQVdBLENBQUNDLGFBQWEsRUFBRUMsV0FBVyxFQUFFO0lBQ3BDLEtBQUssQ0FBQyxDQUFDO0lBQ1AsSUFBSSxDQUFDRCxhQUFhLEdBQUdBLGFBQWE7SUFDbEMsSUFBSSxDQUFDQyxXQUFXLEdBQUdBLFdBQVc7SUFDOUIsSUFBSSxDQUFDQyxrQkFBa0IsR0FBRyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUM7SUFDN0MsSUFBSSxDQUFDQyxpQkFBaUIsR0FBRyxJQUFJQyxHQUFHLENBQUMsQ0FBQztFQUN0Qzs7RUFFQTtBQUNKO0FBQ0E7RUFDSUMsZ0JBQWdCQSxDQUFBLEVBQUc7SUFDZixJQUFJLENBQUNDLGVBQWUsQ0FBQyxhQUFhLEVBQUUsSUFBSSxDQUFDQyxhQUFhLENBQUND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