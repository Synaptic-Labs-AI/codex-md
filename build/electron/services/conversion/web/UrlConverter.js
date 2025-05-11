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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwicHVwcGV0ZWVyIiwiY2hlZXJpbyIsIlVSTCIsIkJhc2VTZXJ2aWNlIiwiVXJsQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJzdXBwb3J0ZWRQcm90b2NvbHMiLCJhY3RpdmVDb252ZXJzaW9ucyIsIk1hcCIsInNldHVwSXBjSGFuZGxlcnMiLCJyZWdpc3RlckhhbmRsZXIiLCJoYW5kbGVDb252ZXJ0IiwiYmluZCIsImhhbmRsZUdldE1ldGFkYXRhIiwiaGFuZGxlU2NyZWVuc2hvdCIsImhhbmRsZUNhbmNlbCIsImV2ZW50IiwidXJsIiwib3B0aW9ucyIsInBhcnNlZFVybCIsImluY2x1ZGVzIiwicHJvdG9jb2wiLCJFcnJvciIsImNvbnZlcnNpb25JZCIsImdlbmVyYXRlQ29udmVyc2lvbklkIiwid2luZG93Iiwic2VuZGVyIiwiZ2V0T3duZXJCcm93c2VyV2luZG93IiwidGVtcERpciIsImNyZWF0ZVRlbXBEaXIiLCJzZXQiLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwid2ViQ29udGVudHMiLCJzZW5kIiwicHJvY2Vzc0NvbnZlcnNpb24iLCJjYXRjaCIsImVycm9yIiwiY29uc29sZSIsInVwZGF0ZUNvbnZlcnNpb25TdGF0dXMiLCJtZXNzYWdlIiwicmVtb3ZlIiwiZXJyIiwibWV0YWRhdGEiLCJmZXRjaE1ldGFkYXRhIiwic2NyZWVuc2hvdFBhdGgiLCJqb2luIiwiY2FwdHVyZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90RGF0YSIsInJlYWRGaWxlIiwiZW5jb2RpbmciLCJkYXRhIiwiY29udmVyc2lvbiIsImdldCIsImJyb3dzZXIiLCJjbG9zZSIsImRlbGV0ZSIsInN1Y2Nlc3MiLCJsYXVuY2giLCJoZWFkbGVzcyIsImFyZ3MiLCJzY3JlZW5zaG90IiwiaW5jbHVkZVNjcmVlbnNob3QiLCJjb250ZW50IiwiZXh0cmFjdENvbnRlbnQiLCJpbmNsdWRlSW1hZ2VzIiwicHJvY2Vzc0ltYWdlcyIsIm1hcmtkb3duIiwiZ2VuZXJhdGVNYXJrZG93biIsInJlc3VsdCIsImV4aXN0aW5nQnJvd3NlciIsInNob3VsZENsb3NlQnJvd3NlciIsInBhZ2UiLCJuZXdQYWdlIiwiZ290byIsIndhaXRVbnRpbCIsInRpbWVvdXQiLCJldmFsdWF0ZSIsImdldE1ldGFDb250ZW50IiwibmFtZSIsImVsZW1lbnQiLCJkb2N1bWVudCIsInF1ZXJ5U2VsZWN0b3IiLCJnZXRBdHRyaWJ1dGUiLCJ0aXRsZSIsImRlc2NyaXB0aW9uIiwia2V5d29yZHMiLCJhdXRob3IiLCJvZ1RpdGxlIiwib2dJbWFnZSIsIm9nVHlwZSIsIm9nVXJsIiwiZmF2aWNvbiIsImhyZWYiLCJkb21haW4iLCJob3N0bmFtZSIsInBhdGhuYW1lIiwib3V0cHV0UGF0aCIsIndpZHRoIiwiaGVpZ2h0Iiwic2V0Vmlld3BvcnQiLCJ3YWl0VGltZSIsIndhaXRGb3JUaW1lb3V0IiwiZnVsbFBhZ2UiLCJ0eXBlIiwiaHRtbCIsIiQiLCJsb2FkIiwibWFpbkNvbnRlbnQiLCJtYWluU2VsZWN0b3JzIiwic2VsZWN0b3IiLCJsZW5ndGgiLCJpbWFnZXMiLCJlYWNoIiwiaSIsImVsIiwic3JjIiwiYXR0ciIsImFsdCIsImFic29sdXRlU3JjIiwicHVzaCIsImZpbGVuYW1lIiwiYmFzZW5hbWUiLCJsaW5rcyIsInRleHQiLCJ0cmltIiwic3RhcnRzV2l0aCIsImFic29sdXRlSHJlZiIsImJhc2VVcmwiLCJpbWFnZXNEaXIiLCJlbnN1cmVEaXIiLCJpbWFnZSIsInNldFJlcXVlc3RJbnRlcmNlcHRpb24iLCJvbiIsInJlcXVlc3QiLCJjb250aW51ZSIsImFib3J0IiwicmVzcG9uc2UiLCJvayIsImJ1ZmZlciIsImltYWdlUGF0aCIsIndyaXRlRmlsZSIsImxvY2FsUGF0aCIsImhlYWRlcnMiLCJ0b1N0cmluZyIsIm5vdyIsIkRhdGUiLCJjb252ZXJ0ZWREYXRlIiwidG9JU09TdHJpbmciLCJzcGxpdCIsInJlcGxhY2UiLCJwYWdlVGl0bGUiLCJUdXJuZG93blNlcnZpY2UiLCJ0dXJuZG93blNlcnZpY2UiLCJoZWFkaW5nU3R5bGUiLCJjb2RlQmxvY2tTdHlsZSIsImVtRGVsaW1pdGVyIiwiYWRkUnVsZSIsImZpbHRlciIsInJlcGxhY2VtZW50Iiwibm9kZSIsImZpbmQiLCJpbWciLCJlbmRzV2l0aCIsImltYWdlVXJsIiwibWFya2Rvd25Db250ZW50IiwidHVybmRvd24iLCJpbmNsdWRlTGlua3MiLCJmb3JFYWNoIiwibGluayIsIk1hdGgiLCJyYW5kb20iLCJzdWJzdHIiLCJkZXRhaWxzIiwiT2JqZWN0IiwiYXNzaWduIiwic3VwcG9ydHNVcmwiLCJnZXRJbmZvIiwicHJvdG9jb2xzIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL3dlYi9VcmxDb252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFVybENvbnZlcnRlci5qc1xyXG4gKiBIYW5kbGVzIGNvbnZlcnNpb24gb2Ygd2ViIHBhZ2VzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBcclxuICogVGhpcyBjb252ZXJ0ZXI6XHJcbiAqIC0gRmV0Y2hlcyB3ZWIgcGFnZXMgdXNpbmcgcHVwcGV0ZWVyXHJcbiAqIC0gRXh0cmFjdHMgY29udGVudCwgbWV0YWRhdGEsIGFuZCBpbWFnZXNcclxuICogLSBIYW5kbGVzIEphdmFTY3JpcHQtcmVuZGVyZWQgY29udGVudFxyXG4gKiAtIEdlbmVyYXRlcyBtYXJrZG93biB3aXRoIHN0cnVjdHVyZWQgY29udGVudFxyXG4gKiBcclxuICogUmVsYXRlZCBGaWxlczpcclxuICogLSBCYXNlU2VydmljZS5qczogUGFyZW50IGNsYXNzIHByb3ZpZGluZyBJUEMgaGFuZGxpbmdcclxuICogLSBGaWxlU3RvcmFnZVNlcnZpY2UuanM6IEZvciB0ZW1wb3JhcnkgZmlsZSBtYW5hZ2VtZW50XHJcbiAqIC0gUGFyZW50VXJsQ29udmVydGVyLmpzOiBGb3IgbXVsdGktcGFnZSBzaXRlIGNvbnZlcnNpb25cclxuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCBwdXBwZXRlZXIgPSByZXF1aXJlKCdwdXBwZXRlZXInKTtcclxuY29uc3QgY2hlZXJpbyA9IHJlcXVpcmUoJ2NoZWVyaW8nKTtcclxuY29uc3QgeyBVUkwgfSA9IHJlcXVpcmUoJ3VybCcpO1xyXG5jb25zdCBCYXNlU2VydmljZSA9IHJlcXVpcmUoJy4uLy4uL0Jhc2VTZXJ2aWNlJyk7XHJcblxyXG5jbGFzcyBVcmxDb252ZXJ0ZXIgZXh0ZW5kcyBCYXNlU2VydmljZSB7XHJcbiAgICBjb25zdHJ1Y3RvcihmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSkge1xyXG4gICAgICAgIHN1cGVyKCk7XHJcbiAgICAgICAgdGhpcy5maWxlUHJvY2Vzc29yID0gZmlsZVByb2Nlc3NvcjtcclxuICAgICAgICB0aGlzLmZpbGVTdG9yYWdlID0gZmlsZVN0b3JhZ2U7XHJcbiAgICAgICAgdGhpcy5zdXBwb3J0ZWRQcm90b2NvbHMgPSBbJ2h0dHA6JywgJ2h0dHBzOiddO1xyXG4gICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMgPSBuZXcgTWFwKCk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBTZXQgdXAgSVBDIGhhbmRsZXJzIGZvciBVUkwgY29udmVyc2lvblxyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnVybCcsIHRoaXMuaGFuZGxlQ29udmVydC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDp1cmw6bWV0YWRhdGEnLCB0aGlzLmhhbmRsZUdldE1ldGFkYXRhLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnVybDpzY3JlZW5zaG90JywgdGhpcy5oYW5kbGVTY3JlZW5zaG90LmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnVybDpjYW5jZWwnLCB0aGlzLmhhbmRsZUNhbmNlbC5iaW5kKHRoaXMpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBVUkwgY29udmVyc2lvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ29udmVyc2lvbiByZXF1ZXN0IGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgaGFuZGxlQ29udmVydChldmVudCwgeyB1cmwsIG9wdGlvbnMgPSB7fSB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gVmFsaWRhdGUgVVJMXHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZFVybCA9IG5ldyBVUkwodXJsKTtcclxuICAgICAgICAgICAgaWYgKCF0aGlzLnN1cHBvcnRlZFByb3RvY29scy5pbmNsdWRlcyhwYXJzZWRVcmwucHJvdG9jb2wpKSB7XHJcbiAgICAgICAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoYFVuc3VwcG9ydGVkIHByb3RvY29sOiAke3BhcnNlZFVybC5wcm90b2NvbH1gKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbklkID0gdGhpcy5nZW5lcmF0ZUNvbnZlcnNpb25JZCgpO1xyXG4gICAgICAgICAgICBjb25zdCB3aW5kb3cgPSBldmVudD8uc2VuZGVyPy5nZXRPd25lckJyb3dzZXJXaW5kb3c/LigpIHx8IG51bGw7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDcmVhdGUgdGVtcCBkaXJlY3RvcnkgZm9yIHRoaXMgY29udmVyc2lvblxyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gYXdhaXQgdGhpcy5maWxlU3RvcmFnZS5jcmVhdGVUZW1wRGlyKCd1cmxfY29udmVyc2lvbicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zZXQoY29udmVyc2lvbklkLCB7XHJcbiAgICAgICAgICAgICAgICBpZDogY29udmVyc2lvbklkLFxyXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnc3RhcnRpbmcnLFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDAsXHJcbiAgICAgICAgICAgICAgICB1cmwsXHJcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxyXG4gICAgICAgICAgICAgICAgd2luZG93XHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gTm90aWZ5IGNsaWVudCB0aGF0IGNvbnZlcnNpb24gaGFzIHN0YXJ0ZWQgKG9ubHkgaWYgd2UgaGF2ZSBhIHZhbGlkIHdpbmRvdylcclxuICAgICAgICAgICAgaWYgKHdpbmRvdyAmJiB3aW5kb3cud2ViQ29udGVudHMpIHtcclxuICAgICAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCd1cmw6Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2Vzc1xyXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgdXJsLCBvcHRpb25zKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQ29udmVydGVyXSBDb252ZXJzaW9uIGZhaWxlZCBmb3IgJHtjb252ZXJzaW9uSWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdmYWlsZWQnLCB7IGVycm9yOiBlcnJvci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgZnMucmVtb3ZlKHRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke3RlbXBEaXJ9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnZlcnNpb25JZCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBzdGFydCBjb252ZXJzaW9uOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIFVSTCBtZXRhZGF0YSByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gTWV0YWRhdGEgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldE1ldGFkYXRhKGV2ZW50LCB7IHVybCB9KSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmZldGNoTWV0YWRhdGEodXJsKTtcclxuICAgICAgICAgICAgcmV0dXJuIG1ldGFkYXRhO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBnZXQgbWV0YWRhdGE6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgVVJMIHNjcmVlbnNob3QgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFNjcmVlbnNob3QgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZVNjcmVlbnNob3QoZXZlbnQsIHsgdXJsLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3VybF9zY3JlZW5zaG90Jyk7XHJcbiAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3RQYXRoID0gcGF0aC5qb2luKHRlbXBEaXIsICdzY3JlZW5zaG90LnBuZycpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlU2NyZWVuc2hvdCh1cmwsIHNjcmVlbnNob3RQYXRoLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFJlYWQgdGhlIHNjcmVlbnNob3QgYXMgYmFzZTY0XHJcbiAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3REYXRhID0gYXdhaXQgZnMucmVhZEZpbGUoc2NyZWVuc2hvdFBhdGgsIHsgZW5jb2Rpbmc6ICdiYXNlNjQnIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICAgIGRhdGE6IGBkYXRhOmltYWdlL3BuZztiYXNlNjQsJHtzY3JlZW5zaG90RGF0YX1gLFxyXG4gICAgICAgICAgICAgICAgdXJsXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIGNhcHR1cmUgc2NyZWVuc2hvdDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBjb252ZXJzaW9uIGNhbmNlbGxhdGlvbiByZXF1ZXN0XHJcbiAgICAgKiBAcGFyYW0ge0VsZWN0cm9uLklwY01haW5JbnZva2VFdmVudH0gZXZlbnQgLSBJUEMgZXZlbnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSByZXF1ZXN0IC0gQ2FuY2VsbGF0aW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDYW5jZWwoZXZlbnQsIHsgY29udmVyc2lvbklkIH0pIHtcclxuICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcclxuICAgICAgICBpZiAoY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLnN0YXR1cyA9ICdjYW5jZWxsZWQnO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24uYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgY29udmVyc2lvbi5icm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLndpbmRvdykge1xyXG4gICAgICAgICAgICAgICAgY29udmVyc2lvbi53aW5kb3cud2ViQ29udGVudHMuc2VuZCgndXJsOmNvbnZlcnNpb24tY2FuY2VsbGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLnRlbXBEaXIpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZShjb252ZXJzaW9uLnRlbXBEaXIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmRlbGV0ZShjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiB0cnVlIH07XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBQcm9jZXNzIFVSTCBjb252ZXJzaW9uXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGNvbnZlcnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgdXJsLCBvcHRpb25zKSB7XHJcbiAgICAgICAgbGV0IGJyb3dzZXIgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBub3QgZm91bmQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGNvbnZlcnNpb24udGVtcERpcjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIExhdW5jaCBicm93c2VyXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdsYXVuY2hpbmdfYnJvd3NlcicsIHsgcHJvZ3Jlc3M6IDUgfSk7XHJcbiAgICAgICAgICAgIGJyb3dzZXIgPSBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgICAgIGhlYWRsZXNzOiAnbmV3JyxcclxuICAgICAgICAgICAgICAgIGFyZ3M6IFsnLS1uby1zYW5kYm94JywgJy0tZGlzYWJsZS1zZXR1aWQtc2FuZGJveCddXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29udmVyc2lvbi5icm93c2VyID0gYnJvd3NlcjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEZldGNoIG1ldGFkYXRhXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdmZXRjaGluZ19tZXRhZGF0YScsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHRoaXMuZmV0Y2hNZXRhZGF0YSh1cmwsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2FwdHVyZSBzY3JlZW5zaG90IGlmIHJlcXVlc3RlZFxyXG4gICAgICAgICAgICBsZXQgc2NyZWVuc2hvdCA9IG51bGw7XHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVTY3JlZW5zaG90KSB7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnY2FwdHVyaW5nX3NjcmVlbnNob3QnLCB7IHByb2dyZXNzOiAyMCB9KTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3RQYXRoID0gcGF0aC5qb2luKHRlbXBEaXIsICdzY3JlZW5zaG90LnBuZycpO1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5jYXB0dXJlU2NyZWVuc2hvdCh1cmwsIHNjcmVlbnNob3RQYXRoLCBvcHRpb25zLCBicm93c2VyKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gUmVhZCBzY3JlZW5zaG90IGFzIGJhc2U2NFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2NyZWVuc2hvdERhdGEgPSBhd2FpdCBmcy5yZWFkRmlsZShzY3JlZW5zaG90UGF0aCwgeyBlbmNvZGluZzogJ2Jhc2U2NCcgfSk7XHJcbiAgICAgICAgICAgICAgICBzY3JlZW5zaG90ID0gYGRhdGE6aW1hZ2UvcG5nO2Jhc2U2NCwke3NjcmVlbnNob3REYXRhfWA7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgY29udGVudFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZXh0cmFjdGluZ19jb250ZW50JywgeyBwcm9ncmVzczogNDAgfSk7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmV4dHJhY3RDb250ZW50KHVybCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIGltYWdlcyBpZiByZXF1ZXN0ZWRcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZUltYWdlcykge1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3Byb2Nlc3NpbmdfaW1hZ2VzJywgeyBwcm9ncmVzczogNjAgfSk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLnByb2Nlc3NJbWFnZXMoY29udGVudCwgdGVtcERpciwgdXJsLCBicm93c2VyKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgbWFya2Rvd25cclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2dlbmVyYXRpbmdfbWFya2Rvd24nLCB7IHByb2dyZXNzOiA4MCB9KTtcclxuICAgICAgICAgICAgY29uc3QgbWFya2Rvd24gPSB0aGlzLmdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIGNvbnRlbnQsIHNjcmVlbnNob3QsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlclxyXG4gICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uYnJvd3NlciA9IG51bGw7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnY29tcGxldGVkJywgeyBcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAsXHJcbiAgICAgICAgICAgICAgICByZXN1bHQ6IG1hcmtkb3duXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIG1hcmtkb3duO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tVcmxDb252ZXJ0ZXJdIENvbnZlcnNpb24gcHJvY2Vzc2luZyBmYWlsZWQ6JywgZXJyb3IpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlciBpZiBvcGVuXHJcbiAgICAgICAgICAgIGlmIChicm93c2VyKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEZldGNoIG1ldGFkYXRhIGZyb20gVVJMXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGZldGNoXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBbZXhpc3RpbmdCcm93c2VyXSAtIEV4aXN0aW5nIGJyb3dzZXIgaW5zdGFuY2VcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPE9iamVjdD59IFVSTCBtZXRhZGF0YVxyXG4gICAgICovXHJcbiAgICBhc3luYyBmZXRjaE1ldGFkYXRhKHVybCwgZXhpc3RpbmdCcm93c2VyID0gbnVsbCkge1xyXG4gICAgICAgIGxldCBicm93c2VyID0gZXhpc3RpbmdCcm93c2VyO1xyXG4gICAgICAgIGxldCBzaG91bGRDbG9zZUJyb3dzZXIgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBpZiAoIWJyb3dzZXIpIHtcclxuICAgICAgICAgICAgICAgIGJyb3dzZXIgPSBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgICAgICAgICAgYXJnczogWyctLW5vLXNhbmRib3gnLCAnLS1kaXNhYmxlLXNldHVpZC1zYW5kYm94J11cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2hvdWxkQ2xvc2VCcm93c2VyID0gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgcGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmdvdG8odXJsLCB7IHdhaXRVbnRpbDogJ25ldHdvcmtpZGxlMicsIHRpbWVvdXQ6IDMwMDAwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBtZXRhZGF0YVxyXG4gICAgICAgICAgICBjb25zdCBtZXRhZGF0YSA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgZ2V0TWV0YUNvbnRlbnQgPSAobmFtZSkgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGVsZW1lbnQgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yKGBtZXRhW25hbWU9XCIke25hbWV9XCJdLCBtZXRhW3Byb3BlcnR5PVwiJHtuYW1lfVwiXWApO1xyXG4gICAgICAgICAgICAgICAgICAgIHJldHVybiBlbGVtZW50ID8gZWxlbWVudC5nZXRBdHRyaWJ1dGUoJ2NvbnRlbnQnKSA6IG51bGw7XHJcbiAgICAgICAgICAgICAgICB9O1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiBkb2N1bWVudC50aXRsZSxcclxuICAgICAgICAgICAgICAgICAgICBkZXNjcmlwdGlvbjogZ2V0TWV0YUNvbnRlbnQoJ2Rlc2NyaXB0aW9uJykgfHwgZ2V0TWV0YUNvbnRlbnQoJ29nOmRlc2NyaXB0aW9uJyksXHJcbiAgICAgICAgICAgICAgICAgICAga2V5d29yZHM6IGdldE1ldGFDb250ZW50KCdrZXl3b3JkcycpLFxyXG4gICAgICAgICAgICAgICAgICAgIGF1dGhvcjogZ2V0TWV0YUNvbnRlbnQoJ2F1dGhvcicpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9nVGl0bGU6IGdldE1ldGFDb250ZW50KCdvZzp0aXRsZScpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9nSW1hZ2U6IGdldE1ldGFDb250ZW50KCdvZzppbWFnZScpLFxyXG4gICAgICAgICAgICAgICAgICAgIG9nVHlwZTogZ2V0TWV0YUNvbnRlbnQoJ29nOnR5cGUnKSxcclxuICAgICAgICAgICAgICAgICAgICBvZ1VybDogZ2V0TWV0YUNvbnRlbnQoJ29nOnVybCcpLFxyXG4gICAgICAgICAgICAgICAgICAgIGZhdmljb246IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ2xpbmtbcmVsPVwiaWNvblwiXSwgbGlua1tyZWw9XCJzaG9ydGN1dCBpY29uXCJdJyk/LmhyZWZcclxuICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIFVSTCBpbmZvcm1hdGlvblxyXG4gICAgICAgICAgICBjb25zdCBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybCk7XHJcbiAgICAgICAgICAgIG1ldGFkYXRhLnVybCA9IHVybDtcclxuICAgICAgICAgICAgbWV0YWRhdGEuZG9tYWluID0gcGFyc2VkVXJsLmhvc3RuYW1lO1xyXG4gICAgICAgICAgICBtZXRhZGF0YS5wYXRoID0gcGFyc2VkVXJsLnBhdGhuYW1lO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgYXdhaXQgcGFnZS5jbG9zZSgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKHNob3VsZENsb3NlQnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gbWV0YWRhdGE7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIGZldGNoIG1ldGFkYXRhOicsIGVycm9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChzaG91bGRDbG9zZUJyb3dzZXIgJiYgYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBDYXB0dXJlIHNjcmVlbnNob3Qgb2YgVVJMXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGNhcHR1cmVcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBvdXRwdXRQYXRoIC0gT3V0cHV0IHBhdGggZm9yIHNjcmVlbnNob3RcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gU2NyZWVuc2hvdCBvcHRpb25zXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBbZXhpc3RpbmdCcm93c2VyXSAtIEV4aXN0aW5nIGJyb3dzZXIgaW5zdGFuY2VcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHZvaWQ+fVxyXG4gICAgICovXHJcbiAgICBhc3luYyBjYXB0dXJlU2NyZWVuc2hvdCh1cmwsIG91dHB1dFBhdGgsIG9wdGlvbnMgPSB7fSwgZXhpc3RpbmdCcm93c2VyID0gbnVsbCkge1xyXG4gICAgICAgIGxldCBicm93c2VyID0gZXhpc3RpbmdCcm93c2VyO1xyXG4gICAgICAgIGxldCBzaG91bGRDbG9zZUJyb3dzZXIgPSBmYWxzZTtcclxuICAgICAgICBcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBpZiAoIWJyb3dzZXIpIHtcclxuICAgICAgICAgICAgICAgIGJyb3dzZXIgPSBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgICAgICAgICAgYXJnczogWyctLW5vLXNhbmRib3gnLCAnLS1kaXNhYmxlLXNldHVpZC1zYW5kYm94J11cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgc2hvdWxkQ2xvc2VCcm93c2VyID0gdHJ1ZTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgcGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gU2V0IHZpZXdwb3J0IHNpemVcclxuICAgICAgICAgICAgY29uc3Qgd2lkdGggPSBvcHRpb25zLndpZHRoIHx8IDEyODA7XHJcbiAgICAgICAgICAgIGNvbnN0IGhlaWdodCA9IG9wdGlvbnMuaGVpZ2h0IHx8IDgwMDtcclxuICAgICAgICAgICAgYXdhaXQgcGFnZS5zZXRWaWV3cG9ydCh7IHdpZHRoLCBoZWlnaHQgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBOYXZpZ2F0ZSB0byBVUkxcclxuICAgICAgICAgICAgYXdhaXQgcGFnZS5nb3RvKHVybCwgeyB3YWl0VW50aWw6ICduZXR3b3JraWRsZTInLCB0aW1lb3V0OiAzMDAwMCB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFdhaXQgZm9yIGFkZGl0aW9uYWwgdGltZSBpZiBzcGVjaWZpZWRcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMud2FpdFRpbWUpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHBhZ2Uud2FpdEZvclRpbWVvdXQob3B0aW9ucy53YWl0VGltZSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENhcHR1cmUgc2NyZWVuc2hvdFxyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLnNjcmVlbnNob3Qoe1xyXG4gICAgICAgICAgICAgICAgcGF0aDogb3V0cHV0UGF0aCxcclxuICAgICAgICAgICAgICAgIGZ1bGxQYWdlOiBvcHRpb25zLmZ1bGxQYWdlIHx8IGZhbHNlLFxyXG4gICAgICAgICAgICAgICAgdHlwZTogJ3BuZydcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoc2hvdWxkQ2xvc2VCcm93c2VyKSB7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbVXJsQ29udmVydGVyXSBGYWlsZWQgdG8gY2FwdHVyZSBzY3JlZW5zaG90OicsIGVycm9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGlmIChzaG91bGRDbG9zZUJyb3dzZXIgJiYgYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBFeHRyYWN0IGNvbnRlbnQgZnJvbSBVUkxcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gZXh0cmFjdCBjb250ZW50IGZyb21cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gRXh0cmFjdGlvbiBvcHRpb25zXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBicm93c2VyIC0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gRXh0cmFjdGVkIGNvbnRlbnRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgZXh0cmFjdENvbnRlbnQodXJsLCBvcHRpb25zLCBicm93c2VyKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgcGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmdvdG8odXJsLCB7IHdhaXRVbnRpbDogJ25ldHdvcmtpZGxlMicsIHRpbWVvdXQ6IDMwMDAwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gV2FpdCBmb3IgYWRkaXRpb25hbCB0aW1lIGlmIHNwZWNpZmllZFxyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy53YWl0VGltZSkge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgcGFnZS53YWl0Rm9yVGltZW91dChvcHRpb25zLndhaXRUaW1lKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHBhZ2UgSFRNTFxyXG4gICAgICAgICAgICBjb25zdCBodG1sID0gYXdhaXQgcGFnZS5jb250ZW50KCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGNvbnRlbnQgdXNpbmcgY2hlZXJpb1xyXG4gICAgICAgICAgICBjb25zdCAkID0gY2hlZXJpby5sb2FkKGh0bWwpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUmVtb3ZlIHVud2FudGVkIGVsZW1lbnRzXHJcbiAgICAgICAgICAgICQoJ3NjcmlwdCwgc3R5bGUsIGlmcmFtZSwgbm9zY3JpcHQnKS5yZW1vdmUoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgbWFpbiBjb250ZW50XHJcbiAgICAgICAgICAgIGxldCBtYWluQ29udGVudCA9ICcnO1xyXG4gICAgICAgICAgICBjb25zdCBtYWluU2VsZWN0b3JzID0gW1xyXG4gICAgICAgICAgICAgICAgJ21haW4nLFxyXG4gICAgICAgICAgICAgICAgJ2FydGljbGUnLFxyXG4gICAgICAgICAgICAgICAgJyNjb250ZW50JyxcclxuICAgICAgICAgICAgICAgICcuY29udGVudCcsXHJcbiAgICAgICAgICAgICAgICAnLm1haW4nLFxyXG4gICAgICAgICAgICAgICAgJy5hcnRpY2xlJyxcclxuICAgICAgICAgICAgICAgICcucG9zdCcsXHJcbiAgICAgICAgICAgICAgICAnLnBvc3QtY29udGVudCdcclxuICAgICAgICAgICAgXTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFRyeSB0byBmaW5kIG1haW4gY29udGVudCB1c2luZyBjb21tb24gc2VsZWN0b3JzXHJcbiAgICAgICAgICAgIGZvciAoY29uc3Qgc2VsZWN0b3Igb2YgbWFpblNlbGVjdG9ycykge1xyXG4gICAgICAgICAgICAgICAgaWYgKCQoc2VsZWN0b3IpLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgICAgICAgICAgICBtYWluQ29udGVudCA9ICQoc2VsZWN0b3IpLmh0bWwoKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gSWYgbm8gbWFpbiBjb250ZW50IGZvdW5kLCB1c2UgYm9keVxyXG4gICAgICAgICAgICBpZiAoIW1haW5Db250ZW50KSB7XHJcbiAgICAgICAgICAgICAgICBtYWluQ29udGVudCA9ICQoJ2JvZHknKS5odG1sKCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgaW1hZ2VzXHJcbiAgICAgICAgICAgIGNvbnN0IGltYWdlcyA9IFtdO1xyXG4gICAgICAgICAgICAkKCdpbWcnKS5lYWNoKChpLCBlbCkgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc3JjID0gJChlbCkuYXR0cignc3JjJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhbHQgPSAkKGVsKS5hdHRyKCdhbHQnKSB8fCAnJztcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKHNyYykge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIFJlc29sdmUgcmVsYXRpdmUgVVJMc1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGFic29sdXRlU3JjID0gbmV3IFVSTChzcmMsIHVybCkuaHJlZjtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBpbWFnZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHNyYzogYWJzb2x1dGVTcmMsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGFsdCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZmlsZW5hbWU6IHBhdGguYmFzZW5hbWUoYWJzb2x1dGVTcmMpXHJcbiAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBsaW5rc1xyXG4gICAgICAgICAgICBjb25zdCBsaW5rcyA9IFtdO1xyXG4gICAgICAgICAgICAkKCdhJykuZWFjaCgoaSwgZWwpID0+IHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGhyZWYgPSAkKGVsKS5hdHRyKCdocmVmJyk7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB0ZXh0ID0gJChlbCkudGV4dCgpLnRyaW0oKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKGhyZWYgJiYgIWhyZWYuc3RhcnRzV2l0aCgnIycpICYmICFocmVmLnN0YXJ0c1dpdGgoJ2phdmFzY3JpcHQ6JykpIHtcclxuICAgICAgICAgICAgICAgICAgICAvLyBSZXNvbHZlIHJlbGF0aXZlIFVSTHNcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBhYnNvbHV0ZUhyZWYgPSBuZXcgVVJMKGhyZWYsIHVybCkuaHJlZjtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBsaW5rcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaHJlZjogYWJzb2x1dGVIcmVmLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiB0ZXh0IHx8IGFic29sdXRlSHJlZlxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuY2xvc2UoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgICBodG1sOiBtYWluQ29udGVudCxcclxuICAgICAgICAgICAgICAgIGltYWdlcyxcclxuICAgICAgICAgICAgICAgIGxpbmtzXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIGV4dHJhY3QgY29udGVudDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgaW1hZ2VzIGZyb20gY29udGVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IGNvbnRlbnQgLSBFeHRyYWN0ZWQgY29udGVudFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHRlbXBEaXIgLSBUZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gYmFzZVVybCAtIEJhc2UgVVJMIGZvciByZXNvbHZpbmcgcmVsYXRpdmUgcGF0aHNcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IGJyb3dzZXIgLSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTx2b2lkPn1cclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc0ltYWdlcyhjb250ZW50LCB0ZW1wRGlyLCBiYXNlVXJsLCBicm93c2VyKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgaW1hZ2VzRGlyID0gcGF0aC5qb2luKHRlbXBEaXIsICdpbWFnZXMnKTtcclxuICAgICAgICAgICAgYXdhaXQgZnMuZW5zdXJlRGlyKGltYWdlc0Rpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBEb3dubG9hZCBpbWFnZXNcclxuICAgICAgICAgICAgZm9yIChjb25zdCBpbWFnZSBvZiBjb250ZW50LmltYWdlcykge1xyXG4gICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gU2V0IHVwIHJlc3BvbnNlIGludGVyY2VwdGlvblxyXG4gICAgICAgICAgICAgICAgICAgIGF3YWl0IHBhZ2Uuc2V0UmVxdWVzdEludGVyY2VwdGlvbih0cnVlKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBwYWdlLm9uKCdyZXF1ZXN0JywgcmVxdWVzdCA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChyZXF1ZXN0LnVybCgpID09PSBpbWFnZS5zcmMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVlc3QuY29udGludWUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHJlcXVlc3QuYWJvcnQoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgcGFnZS5nb3RvKGltYWdlLnNyYywgeyB0aW1lb3V0OiAxMDAwMCB9KTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICBpZiAocmVzcG9uc2Uub2soKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBidWZmZXIgPSBhd2FpdCByZXNwb25zZS5idWZmZXIoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgaW1hZ2VQYXRoID0gcGF0aC5qb2luKGltYWdlc0RpciwgaW1hZ2UuZmlsZW5hbWUpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBmcy53cml0ZUZpbGUoaW1hZ2VQYXRoLCBidWZmZXIpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gVXBkYXRlIGltYWdlIHdpdGggbG9jYWwgcGF0aFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpbWFnZS5sb2NhbFBhdGggPSBpbWFnZVBhdGg7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGltYWdlLmRhdGEgPSBgZGF0YToke3Jlc3BvbnNlLmhlYWRlcnMoKVsnY29udGVudC10eXBlJ119O2Jhc2U2NCwke2J1ZmZlci50b1N0cmluZygnYmFzZTY0Jyl9YDtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgYXdhaXQgcGFnZS5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbVXJsQ29udmVydGVyXSBGYWlsZWQgdG8gZG93bmxvYWQgaW1hZ2U6ICR7aW1hZ2Uuc3JjfWAsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgICAgICAvLyBDb250aW51ZSB3aXRoIG90aGVyIGltYWdlc1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1VybENvbnZlcnRlcl0gRmFpbGVkIHRvIHByb2Nlc3MgaW1hZ2VzOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZnJvbSBVUkwgY29udGVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG1ldGFkYXRhIC0gVVJMIG1ldGFkYXRhXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gY29udGVudCAtIEV4dHJhY3RlZCBjb250ZW50XHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gc2NyZWVuc2hvdCAtIFNjcmVlbnNob3QgZGF0YSBVUkxcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIGNvbnRlbnQsIHNjcmVlbnNob3QsIG9wdGlvbnMpIHtcclxuICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEdldCBjdXJyZW50IGRhdGV0aW1lXHJcbiAgICAgICAgY29uc3Qgbm93ID0gbmV3IERhdGUoKTtcclxuICAgICAgICBjb25zdCBjb252ZXJ0ZWREYXRlID0gbm93LnRvSVNPU3RyaW5nKCkuc3BsaXQoJy4nKVswXS5yZXBsYWNlKCdUJywgJyAnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBHZXQgdGhlIHRpdGxlIGZyb20gbWV0YWRhdGEgb3Igb3B0aW9uc1xyXG4gICAgICAgIGNvbnN0IHBhZ2VUaXRsZSA9IG9wdGlvbnMudGl0bGUgfHwgbWV0YWRhdGEudGl0bGUgfHwgYFdlYiBQYWdlOiAke21ldGFkYXRhLnVybH1gO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENyZWF0ZSBzdGFuZGFyZGl6ZWQgZnJvbnRtYXR0ZXJcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCctLS0nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB0aXRsZTogJHtwYWdlVGl0bGV9YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgY29udmVydGVkOiAke2NvbnZlcnRlZERhdGV9YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgndHlwZTogdXJsJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnLS0tJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHRpdGxlIGFzIGhlYWRpbmdcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7cGFnZVRpdGxlfWApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBtZXRhZGF0YVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIFBhZ2UgSW5mb3JtYXRpb24nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IFByb3BlcnR5IHwgVmFsdWUgfCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFVSTCB8IFske21ldGFkYXRhLnVybH1dKCR7bWV0YWRhdGEudXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRG9tYWluIHwgJHttZXRhZGF0YS5kb21haW59IHxgKTtcclxuICAgICAgICBcclxuICAgICAgICBpZiAobWV0YWRhdGEudGl0bGUpIG1hcmtkb3duLnB1c2goYHwgVGl0bGUgfCAke21ldGFkYXRhLnRpdGxlfSB8YCk7XHJcbiAgICAgICAgaWYgKG1ldGFkYXRhLmRlc2NyaXB0aW9uKSBtYXJrZG93bi5wdXNoKGB8IERlc2NyaXB0aW9uIHwgJHttZXRhZGF0YS5kZXNjcmlwdGlvbn0gfGApO1xyXG4gICAgICAgIGlmIChtZXRhZGF0YS5hdXRob3IpIG1hcmtkb3duLnB1c2goYHwgQXV0aG9yIHwgJHttZXRhZGF0YS5hdXRob3J9IHxgKTtcclxuICAgICAgICBpZiAobWV0YWRhdGEua2V5d29yZHMpIG1hcmtkb3duLnB1c2goYHwgS2V5d29yZHMgfCAke21ldGFkYXRhLmtleXdvcmRzfSB8YCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHNjcmVlbnNob3QgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgaWYgKHNjcmVlbnNob3QpIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgU2NyZWVuc2hvdCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIVtTY3JlZW5zaG90IG9mICR7bWV0YWRhdGEudGl0bGUgfHwgbWV0YWRhdGEudXJsfV0oJHtzY3JlZW5zaG90fSlgKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBjb250ZW50XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgQ29udGVudCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIENvbnZlcnQgSFRNTCB0byBtYXJrZG93blxyXG4gICAgICAgIGNvbnN0IFR1cm5kb3duU2VydmljZSA9IHJlcXVpcmUoJ3R1cm5kb3duJyk7XHJcbiAgICAgICAgY29uc3QgdHVybmRvd25TZXJ2aWNlID0gbmV3IFR1cm5kb3duU2VydmljZSh7XHJcbiAgICAgICAgICAgIGhlYWRpbmdTdHlsZTogJ2F0eCcsXHJcbiAgICAgICAgICAgIGNvZGVCbG9ja1N0eWxlOiAnZmVuY2VkJyxcclxuICAgICAgICAgICAgZW1EZWxpbWl0ZXI6ICcqJ1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEN1c3RvbWl6ZSB0dXJuZG93blxyXG4gICAgICAgIHR1cm5kb3duU2VydmljZS5hZGRSdWxlKCdpbWFnZXMnLCB7XHJcbiAgICAgICAgICAgIGZpbHRlcjogJ2ltZycsXHJcbiAgICAgICAgICAgIHJlcGxhY2VtZW50OiBmdW5jdGlvbihjb250ZW50LCBub2RlKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBhbHQgPSBub2RlLmFsdCB8fCAnJztcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNyYyA9IG5vZGUuZ2V0QXR0cmlidXRlKCdzcmMnKSB8fCAnJztcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gRmluZCBpbWFnZSBpbiBjb250ZW50LmltYWdlc1xyXG4gICAgICAgICAgICAgICAgY29uc3QgaW1hZ2UgPSBjb250ZW50LmltYWdlcz8uZmluZChpbWcgPT4gaW1nLnNyYyA9PT0gc3JjIHx8IGltZy5zcmMuZW5kc1dpdGgoc3JjKSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFVzZSBkYXRhIFVSTCBpZiBhdmFpbGFibGVcclxuICAgICAgICAgICAgICAgIGNvbnN0IGltYWdlVXJsID0gaW1hZ2U/LmRhdGEgfHwgc3JjO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gYCFbJHthbHR9XSgke2ltYWdlVXJsfSlgO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgY29uc3QgbWFya2Rvd25Db250ZW50ID0gdHVybmRvd25TZXJ2aWNlLnR1cm5kb3duKGNvbnRlbnQuaHRtbCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChtYXJrZG93bkNvbnRlbnQpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBsaW5rcyBzZWN0aW9uIGlmIHJlcXVlc3RlZFxyXG4gICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVMaW5rcyAmJiBjb250ZW50LmxpbmtzICYmIGNvbnRlbnQubGlua3MubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgTGlua3MnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb250ZW50LmxpbmtzLmZvckVhY2gobGluayA9PiB7XHJcbiAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAtIFske2xpbmsudGV4dH1dKCR7bGluay5ocmVmfSlgKTtcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIFxyXG4gICAgICAgIHJldHVybiBtYXJrZG93bi5qb2luKCdcXG4nKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdlbmVyYXRlIHVuaXF1ZSBjb252ZXJzaW9uIElEXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBVbmlxdWUgY29udmVyc2lvbiBJRFxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZUNvbnZlcnNpb25JZCgpIHtcclxuICAgICAgICByZXR1cm4gYHVybF8ke0RhdGUubm93KCl9XyR7TWF0aC5yYW5kb20oKS50b1N0cmluZygzNikuc3Vic3RyKDIsIDkpfWA7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBVcGRhdGUgY29udmVyc2lvbiBzdGF0dXMgYW5kIG5vdGlmeSByZW5kZXJlclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGNvbnZlcnNpb25JZCAtIENvbnZlcnNpb24gaWRlbnRpZmllclxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHN0YXR1cyAtIE5ldyBzdGF0dXNcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBkZXRhaWxzIC0gQWRkaXRpb25hbCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIHVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCBzdGF0dXMsIGRldGFpbHMgPSB7fSkge1xyXG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgIGlmIChjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uc3RhdHVzID0gc3RhdHVzO1xyXG4gICAgICAgICAgICBPYmplY3QuYXNzaWduKGNvbnZlcnNpb24sIGRldGFpbHMpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24ud2luZG93KSB7XHJcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCd1cmw6Y29udmVyc2lvbi1wcm9ncmVzcycsIHtcclxuICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgc3RhdHVzLFxyXG4gICAgICAgICAgICAgICAgICAgIC4uLmRldGFpbHNcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogQ2hlY2sgaWYgdGhpcyBjb252ZXJ0ZXIgc3VwcG9ydHMgdGhlIGdpdmVuIFVSTFxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFVSTCB0byBjaGVja1xyXG4gICAgICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgc3VwcG9ydGVkXHJcbiAgICAgKi9cclxuICAgIHN1cHBvcnRzVXJsKHVybCkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZFVybCA9IG5ldyBVUkwodXJsKTtcclxuICAgICAgICAgICAgcmV0dXJuIHRoaXMuc3VwcG9ydGVkUHJvdG9jb2xzLmluY2x1ZGVzKHBhcnNlZFVybC5wcm90b2NvbCk7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGdldEluZm8oKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbmFtZTogJ1VSTCBDb252ZXJ0ZXInLFxyXG4gICAgICAgICAgICBwcm90b2NvbHM6IHRoaXMuc3VwcG9ydGVkUHJvdG9jb2xzLFxyXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogJ0NvbnZlcnRzIHdlYiBwYWdlcyB0byBtYXJrZG93bicsXHJcbiAgICAgICAgICAgIG9wdGlvbnM6IHtcclxuICAgICAgICAgICAgICAgIHRpdGxlOiAnT3B0aW9uYWwgcGFnZSB0aXRsZScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlU2NyZWVuc2hvdDogJ1doZXRoZXIgdG8gaW5jbHVkZSBwYWdlIHNjcmVlbnNob3QgKGRlZmF1bHQ6IGZhbHNlKScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlSW1hZ2VzOiAnV2hldGhlciB0byBpbmNsdWRlIGltYWdlcyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUxpbmtzOiAnV2hldGhlciB0byBpbmNsdWRlIGxpbmtzIHNlY3Rpb24gKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIHdhaXRUaW1lOiAnQWRkaXRpb25hbCB0aW1lIHRvIHdhaXQgZm9yIHBhZ2UgbG9hZCBpbiBtcydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gVXJsQ29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FBRUEsTUFBTUEsSUFBSSxHQUFHQyxPQUFPLENBQUMsTUFBTSxDQUFDO0FBQzVCLE1BQU1DLEVBQUUsR0FBR0QsT0FBTyxDQUFDLFVBQVUsQ0FBQztBQUM5QixNQUFNRSxTQUFTLEdBQUdGLE9BQU8sQ0FBQyxXQUFXLENBQUM7QUFDdEMsTUFBTUcsT0FBTyxHQUFHSCxPQUFPLENBQUMsU0FBUyxDQUFDO0FBQ2xDLE1BQU07RUFBRUk7QUFBSSxDQUFDLEdBQUdKLE9BQU8sQ0FBQyxLQUFLLENBQUM7QUFDOUIsTUFBTUssV0FBVyxHQUFHTCxPQUFPLENBQUMsbUJBQW1CLENBQUM7QUFFaEQsTUFBTU0sWUFBWSxTQUFTRCxXQUFXLENBQUM7RUFDbkNFLFdBQVdBLENBQUNDLGFBQWEsRUFBRUMsV0FBVyxFQUFFO0lBQ3BDLEtBQUssQ0FBQyxDQUFDO0lBQ1AsSUFBSSxDQUFDRCxhQUFhLEdBQUdBLGFBQWE7SUFDbEMsSUFBSSxDQUFDQyxXQUFXLEdBQUdBLFdBQVc7SUFDOUIsSUFBSSxDQUFDQyxrQkFBa0IsR0FBRyxDQUFDLE9BQU8sRUFBRSxRQUFRLENBQUM7SUFDN0MsSUFBSSxDQUFDQyxpQkFBaUIsR0FBRyxJQUFJQyxH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LENBQUMzQixRQUFRLENBQUMsRUFBRSxDQUFDLENBQUM0QixNQUFNLENBQUMsQ0FBQyxFQUFFLENBQUMsQ0FBQyxFQUFFO0VBQ3pFOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0FBQ0E7QUFDQTtFQUNJckksc0JBQXNCQSxDQUFDakIsWUFBWSxFQUFFUyxNQUFNLEVBQUU4SSxPQUFPLEdBQUcsQ0FBQyxDQUFDLEVBQUU7SUFDdkQsTUFBTXpILFVBQVUsR0FBRyxJQUFJLENBQUM5QyxpQkFBaUIsQ0FBQytDLEdBQUcsQ0FBQy9CLFlBQVksQ0FBQztJQUMzRCxJQUFJOEIsVUFBVSxFQUFFO01BQ1pBLFVBQVUsQ0FBQ3JCLE1BQU0sR0FBR0EsTUFBTTtNQUMxQitJLE1BQU0sQ0FBQ0MsTUFBTSxDQUFDM0gsVUFBVSxFQUFFeUgsT0FBTyxDQUFDO01BRWxDLElBQUl6SCxVQUFVLENBQUM1QixNQUFNLEVBQUU7UUFDbkI0QixVQUFVLENBQUM1QixNQUFNLENBQUNTLFdBQVcsQ0FBQ0MsSUFBSSxDQUFDLHlCQUF5QixFQUFFO1VBQzFEWixZQUFZO1VBQ1pTLE1BQU07VUFDTixHQUFHOEk7UUFDUCxDQUFDLENBQUM7TUFDTjtJQUNKO0VBQ0o7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7QUFDQTtFQUNJRyxXQUFXQSxDQUFDaEssR0FBRyxFQUFFO0lBQ2IsSUFBSTtNQUNBLE1BQU1FLFNBQVMsR0FBRyxJQUFJbkIsR0FBRyxDQUFDaUIsR0FBRyxDQUFDO01BQzlCLE9BQU8sSUFBSSxDQUFDWCxrQkFBa0IsQ0FBQ2MsUUFBUSxDQUFDRCxTQUFTLENBQUNFLFFBQVEsQ0FBQztJQUMvRCxDQUFDLENBQUMsT0FBT2lCLEtBQUssRUFBRTtNQUNaLE9BQU8sS0FBSztJQUNoQjtFQUNKOztFQUVBO0FBQ0o7QUFDQTtBQUNBO0VBQ0k0SSxPQUFPQSxDQUFBLEVBQUc7SUFDTixPQUFPO01BQ0hsRyxJQUFJLEVBQUUsZUFBZTtNQUNyQm1HLFNBQVMsRUFBRSxJQUFJLENBQUM3SyxrQkFBa0I7TUFDbENnRixXQUFXLEVBQUUsZ0NBQWdDO01BQzdDcEUsT0FBTyxFQUFFO1FBQ0xtRSxLQUFLLEVBQUUscUJBQXFCO1FBQzVCdEIsaUJBQWlCLEVBQUUscURBQXFEO1FBQ3hFRyxhQUFhLEVBQUUsMkNBQTJDO1FBQzFEc0csWUFBWSxFQUFFLGtEQUFrRDtRQUNoRWxFLFFBQVEsRUFBRTtNQUNkO0lBQ0osQ0FBQztFQUNMO0FBQ0o7QUFFQThFLE1BQU0sQ0FBQ0MsT0FBTyxHQUFHbkwsWUFBWSIsImlnbm9yZUxpc3QiOltdfQ==