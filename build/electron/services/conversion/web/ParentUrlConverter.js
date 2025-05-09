"use strict";

/**
 * ParentUrlConverter.js
 * Handles conversion of multi-page websites to markdown format in the Electron main process.
 * 
 * This converter:
 * - Extends UrlConverter with site crawling capabilities
 * - Discovers and processes linked pages
 * - Creates a structured site map
 * - Generates comprehensive markdown with multiple pages
 * 
 * Related Files:
 * - UrlConverter.js: Parent class for single page conversion
 * - FileStorageService.js: For temporary file management
 * - ConversionService.js: Registers and uses this converter
 */

const path = require('path');
const fs = require('fs-extra');
const {
  URL
} = require('url');
const UrlConverter = require('./UrlConverter');
class ParentUrlConverter extends UrlConverter {
  constructor(fileProcessor, fileStorage) {
    super(fileProcessor, fileStorage);
    this.name = 'Parent URL Converter';
    this.description = 'Converts multi-page websites to markdown';
  }

  /**
   * Set up IPC handlers for parent URL conversion
   */
  setupIpcHandlers() {
    this.registerHandler('convert:parent-url', this.handleConvert.bind(this));
    this.registerHandler('convert:parent-url:sitemap', this.handleGetSitemap.bind(this));
    this.registerHandler('convert:parent-url:cancel', this.handleCancel.bind(this));
  }

  /**
   * Handle parent URL conversion request
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
      const tempDir = await this.fileStorage.createTempDir('parent_url_conversion');
      this.activeConversions.set(conversionId, {
        id: conversionId,
        status: 'starting',
        progress: 0,
        url,
        tempDir,
        window,
        processedUrls: new Set(),
        pages: []
      });

      // Notify client that conversion has started
      window.webContents.send('parent-url:conversion-started', {
        conversionId
      });

      // Start conversion process
      this.processConversion(conversionId, url, options).catch(error => {
        console.error(`[ParentUrlConverter] Conversion failed for ${conversionId}:`, error);
        this.updateConversionStatus(conversionId, 'failed', {
          error: error.message
        });

        // Clean up temp directory
        fs.remove(tempDir).catch(err => {
          console.error(`[ParentUrlConverter] Failed to clean up temp directory: ${tempDir}`, err);
        });
      });
      return {
        conversionId
      };
    } catch (error) {
      console.error('[ParentUrlConverter] Failed to start conversion:', error);
      throw error;
    }
  }

  /**
   * Handle sitemap request
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Sitemap request details
   */
  async handleGetSitemap(event, {
    url,
    options = {}
  }) {
    try {
      const browser = await this.launchBrowser();
      const sitemap = await this.discoverSitemap(url, options, browser);
      await browser.close();
      return sitemap;
    } catch (error) {
      console.error('[ParentUrlConverter] Failed to get sitemap:', error);
      throw error;
    }
  }

  /**
   * Process parent URL conversion
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
      browser = await this.launchBrowser();
      conversion.browser = browser;

      // Discover sitemap
      this.updateConversionStatus(conversionId, 'discovering_sitemap', {
        progress: 10
      });
      const sitemap = await this.discoverSitemap(url, options, browser);

      // Process each page
      const maxPages = options.maxPages || sitemap.pages.length;
      const pagesToProcess = sitemap.pages.slice(0, maxPages);
      this.updateConversionStatus(conversionId, 'processing_pages', {
        progress: 20,
        total: pagesToProcess.length,
        processed: 0
      });
      for (let i = 0; i < pagesToProcess.length; i++) {
        const page = pagesToProcess[i];

        // Skip if already processed
        if (conversion.processedUrls.has(page.url)) {
          continue;
        }

        // Process page
        this.updateConversionStatus(conversionId, 'processing_page', {
          progress: 20 + Math.floor(i / pagesToProcess.length * 60),
          currentPage: page.url,
          processed: i,
          total: pagesToProcess.length
        });

        // Convert page using parent UrlConverter's methods
        const pageContent = await this.processPage(page.url, options, browser, tempDir);

        // Add to processed pages
        conversion.processedUrls.add(page.url);
        conversion.pages.push({
          url: page.url,
          title: page.title,
          content: pageContent
        });
      }

      // Generate combined markdown
      this.updateConversionStatus(conversionId, 'generating_markdown', {
        progress: 90
      });
      const markdown = this.generateCombinedMarkdown(sitemap, conversion.pages, options);

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
      console.error('[ParentUrlConverter] Conversion processing failed:', error);

      // Close browser if open
      if (browser) {
        await browser.close();
      }
      throw error;
    }
  }

  /**
   * Launch browser instance
   * @returns {Promise<puppeteer.Browser>} Browser instance
   */
  async launchBrowser() {
    const puppeteer = require('puppeteer');
    return await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
  }

  /**
   * Discover sitemap for URL
   * @param {string} url - URL to discover
   * @param {Object} options - Discovery options
   * @param {puppeteer.Browser} browser - Browser instance
   * @returns {Promise<Object>} Sitemap
   */
  async discoverSitemap(url, options, browser) {
    try {
      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: 'networkidle2',
        timeout: 30000
      });

      // Get base URL and domain
      const baseUrl = await page.evaluate(() => document.baseURI);
      const parsedUrl = new URL(baseUrl);
      const domain = parsedUrl.hostname;

      // Get site metadata
      const metadata = await this.fetchMetadata(url, browser);

      // Find links
      const maxDepth = options.maxDepth || 1;
      const maxPages = options.maxPages || 10;
      const discoveredPages = new Map();
      discoveredPages.set(url, {
        url,
        title: metadata.title,
        depth: 0,
        links: []
      });

      // Breadth-first search for links
      const queue = [{
        url,
        depth: 0
      }];
      while (queue.length > 0 && discoveredPages.size < maxPages) {
        const {
          url: currentUrl,
          depth
        } = queue.shift();

        // Skip if already at max depth
        if (depth >= maxDepth) {
          continue;
        }

        // Get links from page
        const links = await this.getPageLinks(currentUrl, domain, browser);

        // Update current page links
        const currentPage = discoveredPages.get(currentUrl);
        if (currentPage) {
          currentPage.links = links;
        }

        // Add new links to queue
        for (const link of links) {
          if (!discoveredPages.has(link.url) && discoveredPages.size < maxPages) {
            // Get page title
            let title = link.text;
            try {
              const linkPage = await browser.newPage();
              await linkPage.goto(link.url, {
                waitUntil: 'domcontentloaded',
                timeout: 10000
              });
              title = await linkPage.title();
              await linkPage.close();
            } catch (error) {
              console.error(`[ParentUrlConverter] Failed to get title for ${link.url}:`, error);
            }

            // Add to discovered pages
            discoveredPages.set(link.url, {
              url: link.url,
              title: title || link.text,
              depth: depth + 1,
              links: []
            });

            // Add to queue
            queue.push({
              url: link.url,
              depth: depth + 1
            });
          }
        }
      }

      // Build sitemap
      const sitemap = {
        rootUrl: url,
        domain,
        title: metadata.title,
        pages: Array.from(discoveredPages.values())
      };
      return sitemap;
    } catch (error) {
      console.error('[ParentUrlConverter] Failed to discover sitemap:', error);
      throw error;
    }
  }

  /**
   * Get links from page
   * @param {string} url - URL to get links from
   * @param {string} domain - Domain to filter links
   * @param {puppeteer.Browser} browser - Browser instance
   * @returns {Promise<Array>} Array of links
   */
  async getPageLinks(url, domain, browser) {
    try {
      const page = await browser.newPage();
      await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

      // Extract links
      const links = await page.evaluate(domain => {
        const links = [];
        const anchors = document.querySelectorAll('a[href]');
        for (const anchor of anchors) {
          const href = anchor.href;
          const text = anchor.textContent.trim();

          // Skip empty, hash, and javascript links
          if (!href || href.startsWith('#') || href.startsWith('javascript:')) {
            continue;
          }
          try {
            const url = new URL(href);

            // Only include links from same domain
            if (url.hostname === domain) {
              links.push({
                url: href,
                text: text || href
              });
            }
          } catch (error) {
            // Skip invalid URLs
          }
        }
        return links;
      }, domain);
      await page.close();

      // Remove duplicates
      const uniqueLinks = [];
      const seenUrls = new Set();
      for (const link of links) {
        // Normalize URL by removing trailing slash and hash
        const normalizedUrl = link.url.replace(/#.*$/, '').replace(/\/$/, '');
        if (!seenUrls.has(normalizedUrl)) {
          seenUrls.add(normalizedUrl);
          uniqueLinks.push(link);
        }
      }
      return uniqueLinks;
    } catch (error) {
      console.error(`[ParentUrlConverter] Failed to get links from ${url}:`, error);
      return [];
    }
  }

  /**
   * Process a single page
   * @param {string} url - URL to process
   * @param {Object} options - Processing options
   * @param {puppeteer.Browser} browser - Browser instance
   * @param {string} tempDir - Temporary directory
   * @returns {Promise<string>} Markdown content
   */
  async processPage(url, options, browser, tempDir) {
    try {
      // Extract content
      const content = await this.extractContent(url, options, browser);

      // Process images if requested
      if (options.includeImages) {
        await this.processImages(content, tempDir, url, browser);
      }

      // Capture screenshot if requested
      let screenshot = null;
      if (options.includeScreenshot) {
        const screenshotPath = path.join(tempDir, `screenshot_${Date.now()}.png`);
        await this.captureScreenshot(url, screenshotPath, options, browser);

        // Read screenshot as base64
        const screenshotData = await fs.readFile(screenshotPath, {
          encoding: 'base64'
        });
        screenshot = `data:image/png;base64,${screenshotData}`;
      }

      // Get metadata
      const metadata = await this.fetchMetadata(url, browser);

      // Generate markdown
      return this.generateMarkdown(metadata, content, screenshot, options);
    } catch (error) {
      console.error(`[ParentUrlConverter] Failed to process page ${url}:`, error);
      return `# Error Processing Page: ${url}\n\nFailed to process this page: ${error.message}`;
    }
  }

  /**
   * Generate combined markdown from multiple pages
   * @param {Object} sitemap - Sitemap
   * @param {Array} pages - Processed pages
   * @param {Object} options - Conversion options
   * @returns {string} Combined markdown
   */
  generateCombinedMarkdown(sitemap, pages, options) {
    const markdown = [];

    // Add title
    if (options.title) {
      markdown.push(`# ${options.title}`);
    } else {
      markdown.push(`# ${sitemap.title || 'Website Conversion'}`);
    }
    markdown.push('');

    // Add site information
    markdown.push('## Site Information');
    markdown.push('');
    markdown.push('| Property | Value |');
    markdown.push('| --- | --- |');
    markdown.push(`| Root URL | [${sitemap.rootUrl}](${sitemap.rootUrl}) |`);
    markdown.push(`| Domain | ${sitemap.domain} |`);
    markdown.push(`| Pages Processed | ${pages.length} |`);
    markdown.push('');

    // Add table of contents
    markdown.push('## Table of Contents');
    markdown.push('');
    pages.forEach((page, index) => {
      markdown.push(`${index + 1}. [${page.title || page.url}](#page-${index + 1})`);
    });
    markdown.push('');

    // Add each page
    pages.forEach((page, index) => {
      markdown.push(`<a id="page-${index + 1}"></a>`);
      markdown.push(`## Page ${index + 1}: ${page.title || page.url}`);
      markdown.push('');
      markdown.push(`URL: [${page.url}](${page.url})`);
      markdown.push('');
      markdown.push('---');
      markdown.push('');
      markdown.push(page.content);
      markdown.push('');
      markdown.push('---');
      markdown.push('');
    });

    // Add sitemap visualization if requested
    if (options.includeSitemap) {
      markdown.push('## Site Structure');
      markdown.push('');
      markdown.push('```mermaid');
      markdown.push('graph TD');

      // Add root node
      markdown.push(`  root["${sitemap.title || sitemap.rootUrl}"]`);

      // Add page nodes and links
      sitemap.pages.forEach((page, index) => {
        if (page.url !== sitemap.rootUrl) {
          markdown.push(`  page${index}["${page.title || page.url}"]`);

          // Find parent page
          let parentFound = false;
          for (const potentialParent of sitemap.pages) {
            if (potentialParent.links.some(link => link.url === page.url)) {
              const parentIndex = sitemap.pages.findIndex(p => p.url === potentialParent.url);
              if (potentialParent.url === sitemap.rootUrl) {
                markdown.push(`  root --> page${index}`);
              } else {
                markdown.push(`  page${parentIndex} --> page${index}`);
              }
              parentFound = true;
              break;
            }
          }

          // If no parent found, connect to root
          if (!parentFound) {
            markdown.push(`  root --> page${index}`);
          }
        }
      });
      markdown.push('```');
      markdown.push('');
    }
    return markdown.join('\n');
  }

  /**
   * Get converter information
   * @returns {Object} Converter details
   */
  getInfo() {
    return {
      name: this.name,
      protocols: this.supportedProtocols,
      description: this.description,
      options: {
        title: 'Optional site title',
        maxDepth: 'Maximum crawl depth (default: 1)',
        maxPages: 'Maximum pages to process (default: 10)',
        includeScreenshot: 'Whether to include page screenshots (default: false)',
        includeImages: 'Whether to include images (default: true)',
        includeLinks: 'Whether to include links section (default: true)',
        includeSitemap: 'Whether to include site structure visualization (default: true)',
        waitTime: 'Additional time to wait for page load in ms'
      }
    };
  }
}
module.exports = ParentUrlConverter;
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiVVJMIiwiVXJsQ29udmVydGVyIiwiUGFyZW50VXJsQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJuYW1lIiwiZGVzY3JpcHRpb24iLCJzZXR1cElwY0hhbmRsZXJzIiwicmVnaXN0ZXJIYW5kbGVyIiwiaGFuZGxlQ29udmVydCIsImJpbmQiLCJoYW5kbGVHZXRTaXRlbWFwIiwiaGFuZGxlQ2FuY2VsIiwiZXZlbnQiLCJ1cmwiLCJvcHRpb25zIiwicGFyc2VkVXJsIiwic3VwcG9ydGVkUHJvdG9jb2xzIiwiaW5jbHVkZXMiLCJwcm90b2NvbCIsIkVycm9yIiwiY29udmVyc2lvbklkIiwiZ2VuZXJhdGVDb252ZXJzaW9uSWQiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsImFjdGl2ZUNvbnZlcnNpb25zIiwic2V0IiwiaWQiLCJzdGF0dXMiLCJwcm9ncmVzcyIsInByb2Nlc3NlZFVybHMiLCJTZXQiLCJwYWdlcyIsIndlYkNvbnRlbnRzIiwic2VuZCIsInByb2Nlc3NDb252ZXJzaW9uIiwiY2F0Y2giLCJlcnJvciIsImNvbnNvbGUiLCJ1cGRhdGVDb252ZXJzaW9uU3RhdHVzIiwibWVzc2FnZSIsInJlbW92ZSIsImVyciIsImJyb3dzZXIiLCJsYXVuY2hCcm93c2VyIiwic2l0ZW1hcCIsImRpc2NvdmVyU2l0ZW1hcCIsImNsb3NlIiwiY29udmVyc2lvbiIsImdldCIsIm1heFBhZ2VzIiwibGVuZ3RoIiwicGFnZXNUb1Byb2Nlc3MiLCJzbGljZSIsInRvdGFsIiwicHJvY2Vzc2VkIiwiaSIsInBhZ2UiLCJoYXMiLCJNYXRoIiwiZmxvb3IiLCJjdXJyZW50UGFnZSIsInBhZ2VDb250ZW50IiwicHJvY2Vzc1BhZ2UiLCJhZGQiLCJwdXNoIiwidGl0bGUiLCJjb250ZW50IiwibWFya2Rvd24iLCJnZW5lcmF0ZUNvbWJpbmVkTWFya2Rvd24iLCJyZXN1bHQiLCJwdXBwZXRlZXIiLCJsYXVuY2giLCJoZWFkbGVzcyIsImFyZ3MiLCJuZXdQYWdlIiwiZ290byIsIndhaXRVbnRpbCIsInRpbWVvdXQiLCJiYXNlVXJsIiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImJhc2VVUkkiLCJkb21haW4iLCJob3N0bmFtZSIsIm1ldGFkYXRhIiwiZmV0Y2hNZXRhZGF0YSIsIm1heERlcHRoIiwiZGlzY292ZXJlZFBhZ2VzIiwiTWFwIiwiZGVwdGgiLCJsaW5rcyIsInF1ZXVlIiwic2l6ZSIsImN1cnJlbnRVcmwiLCJzaGlmdCIsImdldFBhZ2VMaW5rcyIsImxpbmsiLCJ0ZXh0IiwibGlua1BhZ2UiLCJyb290VXJsIiwiQXJyYXkiLCJmcm9tIiwidmFsdWVzIiwiYW5jaG9ycyIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJhbmNob3IiLCJocmVmIiwidGV4dENvbnRlbnQiLCJ0cmltIiwic3RhcnRzV2l0aCIsInVuaXF1ZUxpbmtzIiwic2VlblVybHMiLCJub3JtYWxpemVkVXJsIiwicmVwbGFjZSIsImV4dHJhY3RDb250ZW50IiwiaW5jbHVkZUltYWdlcyIsInByb2Nlc3NJbWFnZXMiLCJzY3JlZW5zaG90IiwiaW5jbHVkZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90UGF0aCIsImpvaW4iLCJEYXRlIiwibm93IiwiY2FwdHVyZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90RGF0YSIsInJlYWRGaWxlIiwiZW5jb2RpbmciLCJnZW5lcmF0ZU1hcmtkb3duIiwiZm9yRWFjaCIsImluZGV4IiwiaW5jbHVkZVNpdGVtYXAiLCJwYXJlbnRGb3VuZCIsInBvdGVudGlhbFBhcmVudCIsInNvbWUiLCJwYXJlbnRJbmRleCIsImZpbmRJbmRleCIsInAiLCJnZXRJbmZvIiwicHJvdG9jb2xzIiwiaW5jbHVkZUxpbmtzIiwid2FpdFRpbWUiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vd2ViL1BhcmVudFVybENvbnZlcnRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogUGFyZW50VXJsQ29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBtdWx0aS1wYWdlIHdlYnNpdGVzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBcclxuICogVGhpcyBjb252ZXJ0ZXI6XHJcbiAqIC0gRXh0ZW5kcyBVcmxDb252ZXJ0ZXIgd2l0aCBzaXRlIGNyYXdsaW5nIGNhcGFiaWxpdGllc1xyXG4gKiAtIERpc2NvdmVycyBhbmQgcHJvY2Vzc2VzIGxpbmtlZCBwYWdlc1xyXG4gKiAtIENyZWF0ZXMgYSBzdHJ1Y3R1cmVkIHNpdGUgbWFwXHJcbiAqIC0gR2VuZXJhdGVzIGNvbXByZWhlbnNpdmUgbWFya2Rvd24gd2l0aCBtdWx0aXBsZSBwYWdlc1xyXG4gKiBcclxuICogUmVsYXRlZCBGaWxlczpcclxuICogLSBVcmxDb252ZXJ0ZXIuanM6IFBhcmVudCBjbGFzcyBmb3Igc2luZ2xlIHBhZ2UgY29udmVyc2lvblxyXG4gKiAtIEZpbGVTdG9yYWdlU2VydmljZS5qczogRm9yIHRlbXBvcmFyeSBmaWxlIG1hbmFnZW1lbnRcclxuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCB7IFVSTCB9ID0gcmVxdWlyZSgndXJsJyk7XHJcbmNvbnN0IFVybENvbnZlcnRlciA9IHJlcXVpcmUoJy4vVXJsQ29udmVydGVyJyk7XHJcblxyXG5jbGFzcyBQYXJlbnRVcmxDb252ZXJ0ZXIgZXh0ZW5kcyBVcmxDb252ZXJ0ZXIge1xyXG4gICAgY29uc3RydWN0b3IoZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpIHtcclxuICAgICAgICBzdXBlcihmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSk7XHJcbiAgICAgICAgdGhpcy5uYW1lID0gJ1BhcmVudCBVUkwgQ29udmVydGVyJztcclxuICAgICAgICB0aGlzLmRlc2NyaXB0aW9uID0gJ0NvbnZlcnRzIG11bHRpLXBhZ2Ugd2Vic2l0ZXMgdG8gbWFya2Rvd24nO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgcGFyZW50IFVSTCBjb252ZXJzaW9uXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cGFyZW50LXVybCcsIHRoaXMuaGFuZGxlQ29udmVydC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwYXJlbnQtdXJsOnNpdGVtYXAnLCB0aGlzLmhhbmRsZUdldFNpdGVtYXAuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cGFyZW50LXVybDpjYW5jZWwnLCB0aGlzLmhhbmRsZUNhbmNlbC5iaW5kKHRoaXMpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBwYXJlbnQgVVJMIGNvbnZlcnNpb24gcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENvbnZlcnNpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNvbnZlcnQoZXZlbnQsIHsgdXJsLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIFVSTFxyXG4gICAgICAgICAgICBjb25zdCBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybCk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5zdXBwb3J0ZWRQcm90b2NvbHMuaW5jbHVkZXMocGFyc2VkVXJsLnByb3RvY29sKSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBwcm90b2NvbDogJHtwYXJzZWRVcmwucHJvdG9jb2x9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcclxuICAgICAgICAgICAgY29uc3Qgd2luZG93ID0gZXZlbnQuc2VuZGVyLmdldE93bmVyQnJvd3NlcldpbmRvdygpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciB0aGlzIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcigncGFyZW50X3VybF9jb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcclxuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdzdGFydGluZycsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcclxuICAgICAgICAgICAgICAgIHVybCxcclxuICAgICAgICAgICAgICAgIHRlbXBEaXIsXHJcbiAgICAgICAgICAgICAgICB3aW5kb3csXHJcbiAgICAgICAgICAgICAgICBwcm9jZXNzZWRVcmxzOiBuZXcgU2V0KCksXHJcbiAgICAgICAgICAgICAgICBwYWdlczogW11cclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBOb3RpZnkgY2xpZW50IHRoYXQgY29udmVyc2lvbiBoYXMgc3RhcnRlZFxyXG4gICAgICAgICAgICB3aW5kb3cud2ViQ29udGVudHMuc2VuZCgncGFyZW50LXVybDpjb252ZXJzaW9uLXN0YXJ0ZWQnLCB7IGNvbnZlcnNpb25JZCB9KTtcclxuXHJcbiAgICAgICAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2Vzc1xyXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgdXJsLCBvcHRpb25zKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUGFyZW50VXJsQ29udmVydGVyXSBDb252ZXJzaW9uIGZhaWxlZCBmb3IgJHtjb252ZXJzaW9uSWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdmYWlsZWQnLCB7IGVycm9yOiBlcnJvci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgZnMucmVtb3ZlKHRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke3RlbXBEaXJ9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnZlcnNpb25JZCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBzdGFydCBjb252ZXJzaW9uOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHNpdGVtYXAgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFNpdGVtYXAgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldFNpdGVtYXAoZXZlbnQsIHsgdXJsLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGJyb3dzZXIgPSBhd2FpdCB0aGlzLmxhdW5jaEJyb3dzZXIoKTtcclxuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcCA9IGF3YWl0IHRoaXMuZGlzY292ZXJTaXRlbWFwKHVybCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgcmV0dXJuIHNpdGVtYXA7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBzaXRlbWFwOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyBwYXJlbnQgVVJMIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gY29udmVydFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB1cmwsIG9wdGlvbnMpIHtcclxuICAgICAgICBsZXQgYnJvd3NlciA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb252ZXJzaW9uIG5vdCBmb3VuZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gY29udmVyc2lvbi50ZW1wRGlyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTGF1bmNoIGJyb3dzZXJcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2xhdW5jaGluZ19icm93c2VyJywgeyBwcm9ncmVzczogNSB9KTtcclxuICAgICAgICAgICAgYnJvd3NlciA9IGF3YWl0IHRoaXMubGF1bmNoQnJvd3NlcigpO1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLmJyb3dzZXIgPSBicm93c2VyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRGlzY292ZXIgc2l0ZW1hcFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZGlzY292ZXJpbmdfc2l0ZW1hcCcsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBzaXRlbWFwID0gYXdhaXQgdGhpcy5kaXNjb3ZlclNpdGVtYXAodXJsLCBvcHRpb25zLCBicm93c2VyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFByb2Nlc3MgZWFjaCBwYWdlXHJcbiAgICAgICAgICAgIGNvbnN0IG1heFBhZ2VzID0gb3B0aW9ucy5tYXhQYWdlcyB8fCBzaXRlbWFwLnBhZ2VzLmxlbmd0aDtcclxuICAgICAgICAgICAgY29uc3QgcGFnZXNUb1Byb2Nlc3MgPSBzaXRlbWFwLnBhZ2VzLnNsaWNlKDAsIG1heFBhZ2VzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdwcm9jZXNzaW5nX3BhZ2VzJywge1xyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDIwLFxyXG4gICAgICAgICAgICAgICAgdG90YWw6IHBhZ2VzVG9Qcm9jZXNzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgIHByb2Nlc3NlZDogMFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGFnZXNUb1Byb2Nlc3MubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2UgPSBwYWdlc1RvUHJvY2Vzc1tpXTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gU2tpcCBpZiBhbHJlYWR5IHByb2Nlc3NlZFxyXG4gICAgICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24ucHJvY2Vzc2VkVXJscy5oYXMocGFnZS51cmwpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgcGFnZVxyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3Byb2Nlc3NpbmdfcGFnZScsIHtcclxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzczogMjAgKyBNYXRoLmZsb29yKChpIC8gcGFnZXNUb1Byb2Nlc3MubGVuZ3RoKSAqIDYwKSxcclxuICAgICAgICAgICAgICAgICAgICBjdXJyZW50UGFnZTogcGFnZS51cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2VkOiBpLFxyXG4gICAgICAgICAgICAgICAgICAgIHRvdGFsOiBwYWdlc1RvUHJvY2Vzcy5sZW5ndGhcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDb252ZXJ0IHBhZ2UgdXNpbmcgcGFyZW50IFVybENvbnZlcnRlcidzIG1ldGhvZHNcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VDb250ZW50ID0gYXdhaXQgdGhpcy5wcm9jZXNzUGFnZShwYWdlLnVybCwgb3B0aW9ucywgYnJvd3NlciwgdGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEFkZCB0byBwcm9jZXNzZWQgcGFnZXNcclxuICAgICAgICAgICAgICAgIGNvbnZlcnNpb24ucHJvY2Vzc2VkVXJscy5hZGQocGFnZS51cmwpO1xyXG4gICAgICAgICAgICAgICAgY29udmVyc2lvbi5wYWdlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB1cmw6IHBhZ2UudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiBwYWdlLnRpdGxlLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHBhZ2VDb250ZW50XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgY29tYmluZWQgbWFya2Rvd25cclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2dlbmVyYXRpbmdfbWFya2Rvd24nLCB7IHByb2dyZXNzOiA5MCB9KTtcclxuICAgICAgICAgICAgY29uc3QgbWFya2Rvd24gPSB0aGlzLmdlbmVyYXRlQ29tYmluZWRNYXJrZG93bihzaXRlbWFwLCBjb252ZXJzaW9uLnBhZ2VzLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXJcclxuICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLmJyb3dzZXIgPSBudWxsO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLFxyXG4gICAgICAgICAgICAgICAgcmVzdWx0OiBtYXJrZG93blxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBtYXJrZG93bjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUGFyZW50VXJsQ29udmVydGVyXSBDb252ZXJzaW9uIHByb2Nlc3NpbmcgZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXIgaWYgb3BlblxyXG4gICAgICAgICAgICBpZiAoYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBMYXVuY2ggYnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8cHVwcGV0ZWVyLkJyb3dzZXI+fSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGxhdW5jaEJyb3dzZXIoKSB7XHJcbiAgICAgICAgY29uc3QgcHVwcGV0ZWVyID0gcmVxdWlyZSgncHVwcGV0ZWVyJyk7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IHB1cHBldGVlci5sYXVuY2goe1xyXG4gICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgIGFyZ3M6IFsnLS1uby1zYW5kYm94JywgJy0tZGlzYWJsZS1zZXR1aWQtc2FuZGJveCddXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBEaXNjb3ZlciBzaXRlbWFwIGZvciBVUkxcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gZGlzY292ZXJcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gRGlzY292ZXJ5IG9wdGlvbnNcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IGJyb3dzZXIgLSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBTaXRlbWFwXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGRpc2NvdmVyU2l0ZW1hcCh1cmwsIG9wdGlvbnMsIGJyb3dzZXIpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuZ290byh1cmwsIHsgd2FpdFVudGlsOiAnbmV0d29ya2lkbGUyJywgdGltZW91dDogMzAwMDAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgYmFzZSBVUkwgYW5kIGRvbWFpblxyXG4gICAgICAgICAgICBjb25zdCBiYXNlVXJsID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBkb2N1bWVudC5iYXNlVVJJKTtcclxuICAgICAgICAgICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTChiYXNlVXJsKTtcclxuICAgICAgICAgICAgY29uc3QgZG9tYWluID0gcGFyc2VkVXJsLmhvc3RuYW1lO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHNpdGUgbWV0YWRhdGFcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmZldGNoTWV0YWRhdGEodXJsLCBicm93c2VyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEZpbmQgbGlua3NcclxuICAgICAgICAgICAgY29uc3QgbWF4RGVwdGggPSBvcHRpb25zLm1heERlcHRoIHx8IDE7XHJcbiAgICAgICAgICAgIGNvbnN0IG1heFBhZ2VzID0gb3B0aW9ucy5tYXhQYWdlcyB8fCAxMDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGRpc2NvdmVyZWRQYWdlcyA9IG5ldyBNYXAoKTtcclxuICAgICAgICAgICAgZGlzY292ZXJlZFBhZ2VzLnNldCh1cmwsIHtcclxuICAgICAgICAgICAgICAgIHVybCxcclxuICAgICAgICAgICAgICAgIHRpdGxlOiBtZXRhZGF0YS50aXRsZSxcclxuICAgICAgICAgICAgICAgIGRlcHRoOiAwLFxyXG4gICAgICAgICAgICAgICAgbGlua3M6IFtdXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQnJlYWR0aC1maXJzdCBzZWFyY2ggZm9yIGxpbmtzXHJcbiAgICAgICAgICAgIGNvbnN0IHF1ZXVlID0gW3sgdXJsLCBkZXB0aDogMCB9XTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwICYmIGRpc2NvdmVyZWRQYWdlcy5zaXplIDwgbWF4UGFnZXMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHsgdXJsOiBjdXJyZW50VXJsLCBkZXB0aCB9ID0gcXVldWUuc2hpZnQoKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gU2tpcCBpZiBhbHJlYWR5IGF0IG1heCBkZXB0aFxyXG4gICAgICAgICAgICAgICAgaWYgKGRlcHRoID49IG1heERlcHRoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEdldCBsaW5rcyBmcm9tIHBhZ2VcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtzID0gYXdhaXQgdGhpcy5nZXRQYWdlTGlua3MoY3VycmVudFVybCwgZG9tYWluLCBicm93c2VyKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gVXBkYXRlIGN1cnJlbnQgcGFnZSBsaW5rc1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFBhZ2UgPSBkaXNjb3ZlcmVkUGFnZXMuZ2V0KGN1cnJlbnRVcmwpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQYWdlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFBhZ2UubGlua3MgPSBsaW5rcztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIG5ldyBsaW5rcyB0byBxdWV1ZVxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBsaW5rIG9mIGxpbmtzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFkaXNjb3ZlcmVkUGFnZXMuaGFzKGxpbmsudXJsKSAmJiBkaXNjb3ZlcmVkUGFnZXMuc2l6ZSA8IG1heFBhZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEdldCBwYWdlIHRpdGxlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxldCB0aXRsZSA9IGxpbmsudGV4dDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtQYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsaW5rUGFnZS5nb3RvKGxpbmsudXJsLCB7IHdhaXRVbnRpbDogJ2RvbWNvbnRlbnRsb2FkZWQnLCB0aW1lb3V0OiAxMDAwMCB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlID0gYXdhaXQgbGlua1BhZ2UudGl0bGUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxpbmtQYWdlLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUGFyZW50VXJsQ29udmVydGVyXSBGYWlsZWQgdG8gZ2V0IHRpdGxlIGZvciAke2xpbmsudXJsfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCB0byBkaXNjb3ZlcmVkIHBhZ2VzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc2NvdmVyZWRQYWdlcy5zZXQobGluay51cmwsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogbGluay51cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogdGl0bGUgfHwgbGluay50ZXh0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVwdGg6IGRlcHRoICsgMSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmtzOiBbXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCB0byBxdWV1ZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBxdWV1ZS5wdXNoKHsgdXJsOiBsaW5rLnVybCwgZGVwdGg6IGRlcHRoICsgMSB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEJ1aWxkIHNpdGVtYXBcclxuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcCA9IHtcclxuICAgICAgICAgICAgICAgIHJvb3RVcmw6IHVybCxcclxuICAgICAgICAgICAgICAgIGRvbWFpbixcclxuICAgICAgICAgICAgICAgIHRpdGxlOiBtZXRhZGF0YS50aXRsZSxcclxuICAgICAgICAgICAgICAgIHBhZ2VzOiBBcnJheS5mcm9tKGRpc2NvdmVyZWRQYWdlcy52YWx1ZXMoKSlcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBzaXRlbWFwO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBkaXNjb3ZlciBzaXRlbWFwOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGxpbmtzIGZyb20gcGFnZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFVSTCB0byBnZXQgbGlua3MgZnJvbVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGRvbWFpbiAtIERvbWFpbiB0byBmaWx0ZXIgbGlua3NcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IGJyb3dzZXIgLSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheT59IEFycmF5IG9mIGxpbmtzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdldFBhZ2VMaW5rcyh1cmwsIGRvbWFpbiwgYnJvd3Nlcikge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhZ2UgPSBhd2FpdCBicm93c2VyLm5ld1BhZ2UoKTtcclxuICAgICAgICAgICAgYXdhaXQgcGFnZS5nb3RvKHVybCwgeyB3YWl0VW50aWw6ICdkb21jb250ZW50bG9hZGVkJywgdGltZW91dDogMzAwMDAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGxpbmtzXHJcbiAgICAgICAgICAgIGNvbnN0IGxpbmtzID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoZG9tYWluKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5rcyA9IFtdO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYW5jaG9ycyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ2FbaHJlZl0nKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGhyZWYgPSBhbmNob3IuaHJlZjtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZXh0ID0gYW5jaG9yLnRleHRDb250ZW50LnRyaW0oKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBTa2lwIGVtcHR5LCBoYXNoLCBhbmQgamF2YXNjcmlwdCBsaW5rc1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghaHJlZiB8fCBocmVmLnN0YXJ0c1dpdGgoJyMnKSB8fCBocmVmLnN0YXJ0c1dpdGgoJ2phdmFzY3JpcHQ6JykpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoaHJlZik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBPbmx5IGluY2x1ZGUgbGlua3MgZnJvbSBzYW1lIGRvbWFpblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodXJsLmhvc3RuYW1lID09PSBkb21haW4pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmtzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogaHJlZixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiB0ZXh0IHx8IGhyZWZcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2tpcCBpbnZhbGlkIFVSTHNcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHJldHVybiBsaW5rcztcclxuICAgICAgICAgICAgfSwgZG9tYWluKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuY2xvc2UoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFJlbW92ZSBkdXBsaWNhdGVzXHJcbiAgICAgICAgICAgIGNvbnN0IHVuaXF1ZUxpbmtzID0gW107XHJcbiAgICAgICAgICAgIGNvbnN0IHNlZW5VcmxzID0gbmV3IFNldCgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yIChjb25zdCBsaW5rIG9mIGxpbmtzKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBOb3JtYWxpemUgVVJMIGJ5IHJlbW92aW5nIHRyYWlsaW5nIHNsYXNoIGFuZCBoYXNoXHJcbiAgICAgICAgICAgICAgICBjb25zdCBub3JtYWxpemVkVXJsID0gbGluay51cmwucmVwbGFjZSgvIy4qJC8sICcnKS5yZXBsYWNlKC9cXC8kLywgJycpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoIXNlZW5VcmxzLmhhcyhub3JtYWxpemVkVXJsKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHNlZW5VcmxzLmFkZChub3JtYWxpemVkVXJsKTtcclxuICAgICAgICAgICAgICAgICAgICB1bmlxdWVMaW5rcy5wdXNoKGxpbmspO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gdW5pcXVlTGlua3M7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBsaW5rcyBmcm9tICR7dXJsfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHJldHVybiBbXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBQcm9jZXNzIGEgc2luZ2xlIHBhZ2VcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gcHJvY2Vzc1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBQcm9jZXNzaW5nIG9wdGlvbnNcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IGJyb3dzZXIgLSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdGVtcERpciAtIFRlbXBvcmFyeSBkaXJlY3RvcnlcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IE1hcmtkb3duIGNvbnRlbnRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc1BhZ2UodXJsLCBvcHRpb25zLCBicm93c2VyLCB0ZW1wRGlyKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBjb250ZW50XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmV4dHJhY3RDb250ZW50KHVybCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIGltYWdlcyBpZiByZXF1ZXN0ZWRcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZUltYWdlcykge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzSW1hZ2VzKGNvbnRlbnQsIHRlbXBEaXIsIHVybCwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENhcHR1cmUgc2NyZWVuc2hvdCBpZiByZXF1ZXN0ZWRcclxuICAgICAgICAgICAgbGV0IHNjcmVlbnNob3QgPSBudWxsO1xyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5pbmNsdWRlU2NyZWVuc2hvdCkge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2NyZWVuc2hvdFBhdGggPSBwYXRoLmpvaW4odGVtcERpciwgYHNjcmVlbnNob3RfJHtEYXRlLm5vdygpfS5wbmdgKTtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZVNjcmVlbnNob3QodXJsLCBzY3JlZW5zaG90UGF0aCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFJlYWQgc2NyZWVuc2hvdCBhcyBiYXNlNjRcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3REYXRhID0gYXdhaXQgZnMucmVhZEZpbGUoc2NyZWVuc2hvdFBhdGgsIHsgZW5jb2Rpbmc6ICdiYXNlNjQnIH0pO1xyXG4gICAgICAgICAgICAgICAgc2NyZWVuc2hvdCA9IGBkYXRhOmltYWdlL3BuZztiYXNlNjQsJHtzY3JlZW5zaG90RGF0YX1gO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgbWV0YWRhdGFcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmZldGNoTWV0YWRhdGEodXJsLCBicm93c2VyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIGNvbnRlbnQsIHNjcmVlbnNob3QsIG9wdGlvbnMpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBwcm9jZXNzIHBhZ2UgJHt1cmx9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgcmV0dXJuIGAjIEVycm9yIFByb2Nlc3NpbmcgUGFnZTogJHt1cmx9XFxuXFxuRmFpbGVkIHRvIHByb2Nlc3MgdGhpcyBwYWdlOiAke2Vycm9yLm1lc3NhZ2V9YDtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBjb21iaW5lZCBtYXJrZG93biBmcm9tIG11bHRpcGxlIHBhZ2VzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gc2l0ZW1hcCAtIFNpdGVtYXBcclxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHBhZ2VzIC0gUHJvY2Vzc2VkIHBhZ2VzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gQ29tYmluZWQgbWFya2Rvd25cclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVDb21iaW5lZE1hcmtkb3duKHNpdGVtYXAsIHBhZ2VzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdGl0bGVcclxuICAgICAgICBpZiAob3B0aW9ucy50aXRsZSkge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7b3B0aW9ucy50aXRsZX1gKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7c2l0ZW1hcC50aXRsZSB8fCAnV2Vic2l0ZSBDb252ZXJzaW9uJ31gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHNpdGUgaW5mb3JtYXRpb25cclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBTaXRlIEluZm9ybWF0aW9uJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBSb290IFVSTCB8IFske3NpdGVtYXAucm9vdFVybH1dKCR7c2l0ZW1hcC5yb290VXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRG9tYWluIHwgJHtzaXRlbWFwLmRvbWFpbn0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUGFnZXMgUHJvY2Vzc2VkIHwgJHtwYWdlcy5sZW5ndGh9IHxgKTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdGFibGUgb2YgY29udGVudHNcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBUYWJsZSBvZiBDb250ZW50cycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCR7aW5kZXggKyAxfS4gWyR7cGFnZS50aXRsZSB8fCBwYWdlLnVybH1dKCNwYWdlLSR7aW5kZXggKyAxfSlgKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgZWFjaCBwYWdlXHJcbiAgICAgICAgcGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgPGEgaWQ9XCJwYWdlLSR7aW5kZXggKyAxfVwiPjwvYT5gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyMgUGFnZSAke2luZGV4ICsgMX06ICR7cGFnZS50aXRsZSB8fCBwYWdlLnVybH1gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYFVSTDogWyR7cGFnZS51cmx9XSgke3BhZ2UudXJsfSlgKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJy0tLScpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChwYWdlLmNvbnRlbnQpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnLS0tJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBzaXRlbWFwIHZpc3VhbGl6YXRpb24gaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZVNpdGVtYXApIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgU2l0ZSBTdHJ1Y3R1cmUnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ2BgYG1lcm1haWQnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnZ3JhcGggVEQnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCByb290IG5vZGVcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290W1wiJHtzaXRlbWFwLnRpdGxlIHx8IHNpdGVtYXAucm9vdFVybH1cIl1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCBwYWdlIG5vZGVzIGFuZCBsaW5rc1xyXG4gICAgICAgICAgICBzaXRlbWFwLnBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocGFnZS51cmwgIT09IHNpdGVtYXAucm9vdFVybCkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgcGFnZSR7aW5kZXh9W1wiJHtwYWdlLnRpdGxlIHx8IHBhZ2UudXJsfVwiXWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgcGFyZW50IHBhZ2VcclxuICAgICAgICAgICAgICAgICAgICBsZXQgcGFyZW50Rm91bmQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBvdGVudGlhbFBhcmVudCBvZiBzaXRlbWFwLnBhZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwb3RlbnRpYWxQYXJlbnQubGlua3Muc29tZShsaW5rID0+IGxpbmsudXJsID09PSBwYWdlLnVybCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmVudEluZGV4ID0gc2l0ZW1hcC5wYWdlcy5maW5kSW5kZXgocCA9PiBwLnVybCA9PT0gcG90ZW50aWFsUGFyZW50LnVybCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocG90ZW50aWFsUGFyZW50LnVybCA9PT0gc2l0ZW1hcC5yb290VXJsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290IC0tPiBwYWdlJHtpbmRleH1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICBwYWdlJHtwYXJlbnRJbmRleH0gLS0+IHBhZ2Uke2luZGV4fWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50Rm91bmQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgbm8gcGFyZW50IGZvdW5kLCBjb25uZWN0IHRvIHJvb3RcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXBhcmVudEZvdW5kKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgcm9vdCAtLT4gcGFnZSR7aW5kZXh9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ2BgYCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGNvbnZlcnRlciBpbmZvcm1hdGlvblxyXG4gICAgICogQHJldHVybnMge09iamVjdH0gQ29udmVydGVyIGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgZ2V0SW5mbygpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBuYW1lOiB0aGlzLm5hbWUsXHJcbiAgICAgICAgICAgIHByb3RvY29sczogdGhpcy5zdXBwb3J0ZWRQcm90b2NvbHMsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIHNpdGUgdGl0bGUnLFxyXG4gICAgICAgICAgICAgICAgbWF4RGVwdGg6ICdNYXhpbXVtIGNyYXdsIGRlcHRoIChkZWZhdWx0OiAxKScsXHJcbiAgICAgICAgICAgICAgICBtYXhQYWdlczogJ01heGltdW0gcGFnZXMgdG8gcHJvY2VzcyAoZGVmYXVsdDogMTApJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVTY3JlZW5zaG90OiAnV2hldGhlciB0byBpbmNsdWRlIHBhZ2Ugc2NyZWVuc2hvdHMgKGRlZmF1bHQ6IGZhbHNlKScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlSW1hZ2VzOiAnV2hldGhlciB0byBpbmNsdWRlIGltYWdlcyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUxpbmtzOiAnV2hldGhlciB0byBpbmNsdWRlIGxpbmtzIHNlY3Rpb24gKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVTaXRlbWFwOiAnV2hldGhlciB0byBpbmNsdWRlIHNpdGUgc3RydWN0dXJlIHZpc3VhbGl6YXRpb24gKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIHdhaXRUaW1lOiAnQWRkaXRpb25hbCB0aW1lIHRvIHdhaXQgZm9yIHBhZ2UgbG9hZCBpbiBtcydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gUGFyZW50VXJsQ29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTTtFQUFFRTtBQUFJLENBQUMsR0FBR0YsT0FBTyxDQUFDLEtBQUssQ0FBQztBQUM5QixNQUFNRyxZQUFZLEdBQUdILE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQztBQUU5QyxNQUFNSSxrQkFBa0IsU0FBU0QsWUFBWSxDQUFDO0VBQzFDRSxXQUFXQSxDQUFDQyxhQUFhLEVBQUVDLFdBQVcsRUFBRTtJQUNwQyxLQUFLLENBQUNELGFBQWEsRUFBRUMsV0FBVyxDQUFDO0lBQ2pDLElBQUksQ0FBQ0MsSUFBSSxHQUFHLHNCQUFzQjtJQUNsQyxJQUFJLENBQUNDLFdBQVcsR0FBRywwQ0FBMEM7RUFDakU7O0VBRUE7QUFDSjtBQUNBO0VBQ0lDLGdCQUFnQkEsQ0FBQSxFQUFHO0lBQ2YsSUFBSSxDQUFDQyxlQUFlLENBQUMsb0JBQW9CLEVBQUUsSUFBSSxDQUFDQyxhQUFhLENBQUNDLElBQUksQ0FBQyxJQUFJLENBQUMsQ0FBQztJQUN6RSxJ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