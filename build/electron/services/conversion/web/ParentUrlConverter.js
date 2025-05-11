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
      const window = event?.sender?.getOwnerBrowserWindow?.() || null;

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

      // Notify client that conversion has started (only if we have a valid window)
      if (window && window.webContents) {
        window.webContents.send('parent-url:conversion-started', {
          conversionId
        });
      }

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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiVVJMIiwiVXJsQ29udmVydGVyIiwiUGFyZW50VXJsQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJuYW1lIiwiZGVzY3JpcHRpb24iLCJzZXR1cElwY0hhbmRsZXJzIiwicmVnaXN0ZXJIYW5kbGVyIiwiaGFuZGxlQ29udmVydCIsImJpbmQiLCJoYW5kbGVHZXRTaXRlbWFwIiwiaGFuZGxlQ2FuY2VsIiwiZXZlbnQiLCJ1cmwiLCJvcHRpb25zIiwicGFyc2VkVXJsIiwic3VwcG9ydGVkUHJvdG9jb2xzIiwiaW5jbHVkZXMiLCJwcm90b2NvbCIsIkVycm9yIiwiY29udmVyc2lvbklkIiwiZ2VuZXJhdGVDb252ZXJzaW9uSWQiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsImFjdGl2ZUNvbnZlcnNpb25zIiwic2V0IiwiaWQiLCJzdGF0dXMiLCJwcm9ncmVzcyIsInByb2Nlc3NlZFVybHMiLCJTZXQiLCJwYWdlcyIsIndlYkNvbnRlbnRzIiwic2VuZCIsInByb2Nlc3NDb252ZXJzaW9uIiwiY2F0Y2giLCJlcnJvciIsImNvbnNvbGUiLCJ1cGRhdGVDb252ZXJzaW9uU3RhdHVzIiwibWVzc2FnZSIsInJlbW92ZSIsImVyciIsImJyb3dzZXIiLCJsYXVuY2hCcm93c2VyIiwic2l0ZW1hcCIsImRpc2NvdmVyU2l0ZW1hcCIsImNsb3NlIiwiY29udmVyc2lvbiIsImdldCIsIm1heFBhZ2VzIiwibGVuZ3RoIiwicGFnZXNUb1Byb2Nlc3MiLCJzbGljZSIsInRvdGFsIiwicHJvY2Vzc2VkIiwiaSIsInBhZ2UiLCJoYXMiLCJNYXRoIiwiZmxvb3IiLCJjdXJyZW50UGFnZSIsInBhZ2VDb250ZW50IiwicHJvY2Vzc1BhZ2UiLCJhZGQiLCJwdXNoIiwidGl0bGUiLCJjb250ZW50IiwibWFya2Rvd24iLCJnZW5lcmF0ZUNvbWJpbmVkTWFya2Rvd24iLCJyZXN1bHQiLCJwdXBwZXRlZXIiLCJsYXVuY2giLCJoZWFkbGVzcyIsImFyZ3MiLCJuZXdQYWdlIiwiZ290byIsIndhaXRVbnRpbCIsInRpbWVvdXQiLCJiYXNlVXJsIiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImJhc2VVUkkiLCJkb21haW4iLCJob3N0bmFtZSIsIm1ldGFkYXRhIiwiZmV0Y2hNZXRhZGF0YSIsIm1heERlcHRoIiwiZGlzY292ZXJlZFBhZ2VzIiwiTWFwIiwiZGVwdGgiLCJsaW5rcyIsInF1ZXVlIiwic2l6ZSIsImN1cnJlbnRVcmwiLCJzaGlmdCIsImdldFBhZ2VMaW5rcyIsImxpbmsiLCJ0ZXh0IiwibGlua1BhZ2UiLCJyb290VXJsIiwiQXJyYXkiLCJmcm9tIiwidmFsdWVzIiwiYW5jaG9ycyIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJhbmNob3IiLCJocmVmIiwidGV4dENvbnRlbnQiLCJ0cmltIiwic3RhcnRzV2l0aCIsInVuaXF1ZUxpbmtzIiwic2VlblVybHMiLCJub3JtYWxpemVkVXJsIiwicmVwbGFjZSIsImV4dHJhY3RDb250ZW50IiwiaW5jbHVkZUltYWdlcyIsInByb2Nlc3NJbWFnZXMiLCJzY3JlZW5zaG90IiwiaW5jbHVkZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90UGF0aCIsImpvaW4iLCJEYXRlIiwibm93IiwiY2FwdHVyZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90RGF0YSIsInJlYWRGaWxlIiwiZW5jb2RpbmciLCJnZW5lcmF0ZU1hcmtkb3duIiwiZm9yRWFjaCIsImluZGV4IiwiaW5jbHVkZVNpdGVtYXAiLCJwYXJlbnRGb3VuZCIsInBvdGVudGlhbFBhcmVudCIsInNvbWUiLCJwYXJlbnRJbmRleCIsImZpbmRJbmRleCIsInAiLCJnZXRJbmZvIiwicHJvdG9jb2xzIiwiaW5jbHVkZUxpbmtzIiwid2FpdFRpbWUiLCJtb2R1bGUiLCJleHBvcnRzIl0sInNvdXJjZXMiOlsiLi4vLi4vLi4vLi4vLi4vc3JjL2VsZWN0cm9uL3NlcnZpY2VzL2NvbnZlcnNpb24vd2ViL1BhcmVudFVybENvbnZlcnRlci5qcyJdLCJzb3VyY2VzQ29udGVudCI6WyIvKipcclxuICogUGFyZW50VXJsQ29udmVydGVyLmpzXHJcbiAqIEhhbmRsZXMgY29udmVyc2lvbiBvZiBtdWx0aS1wYWdlIHdlYnNpdGVzIHRvIG1hcmtkb3duIGZvcm1hdCBpbiB0aGUgRWxlY3Ryb24gbWFpbiBwcm9jZXNzLlxyXG4gKiBcclxuICogVGhpcyBjb252ZXJ0ZXI6XHJcbiAqIC0gRXh0ZW5kcyBVcmxDb252ZXJ0ZXIgd2l0aCBzaXRlIGNyYXdsaW5nIGNhcGFiaWxpdGllc1xyXG4gKiAtIERpc2NvdmVycyBhbmQgcHJvY2Vzc2VzIGxpbmtlZCBwYWdlc1xyXG4gKiAtIENyZWF0ZXMgYSBzdHJ1Y3R1cmVkIHNpdGUgbWFwXHJcbiAqIC0gR2VuZXJhdGVzIGNvbXByZWhlbnNpdmUgbWFya2Rvd24gd2l0aCBtdWx0aXBsZSBwYWdlc1xyXG4gKiBcclxuICogUmVsYXRlZCBGaWxlczpcclxuICogLSBVcmxDb252ZXJ0ZXIuanM6IFBhcmVudCBjbGFzcyBmb3Igc2luZ2xlIHBhZ2UgY29udmVyc2lvblxyXG4gKiAtIEZpbGVTdG9yYWdlU2VydmljZS5qczogRm9yIHRlbXBvcmFyeSBmaWxlIG1hbmFnZW1lbnRcclxuICogLSBDb252ZXJzaW9uU2VydmljZS5qczogUmVnaXN0ZXJzIGFuZCB1c2VzIHRoaXMgY29udmVydGVyXHJcbiAqL1xyXG5cclxuY29uc3QgcGF0aCA9IHJlcXVpcmUoJ3BhdGgnKTtcclxuY29uc3QgZnMgPSByZXF1aXJlKCdmcy1leHRyYScpO1xyXG5jb25zdCB7IFVSTCB9ID0gcmVxdWlyZSgndXJsJyk7XHJcbmNvbnN0IFVybENvbnZlcnRlciA9IHJlcXVpcmUoJy4vVXJsQ29udmVydGVyJyk7XHJcblxyXG5jbGFzcyBQYXJlbnRVcmxDb252ZXJ0ZXIgZXh0ZW5kcyBVcmxDb252ZXJ0ZXIge1xyXG4gICAgY29uc3RydWN0b3IoZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpIHtcclxuICAgICAgICBzdXBlcihmaWxlUHJvY2Vzc29yLCBmaWxlU3RvcmFnZSk7XHJcbiAgICAgICAgdGhpcy5uYW1lID0gJ1BhcmVudCBVUkwgQ29udmVydGVyJztcclxuICAgICAgICB0aGlzLmRlc2NyaXB0aW9uID0gJ0NvbnZlcnRzIG11bHRpLXBhZ2Ugd2Vic2l0ZXMgdG8gbWFya2Rvd24nO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogU2V0IHVwIElQQyBoYW5kbGVycyBmb3IgcGFyZW50IFVSTCBjb252ZXJzaW9uXHJcbiAgICAgKi9cclxuICAgIHNldHVwSXBjSGFuZGxlcnMoKSB7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cGFyZW50LXVybCcsIHRoaXMuaGFuZGxlQ29udmVydC5iaW5kKHRoaXMpKTtcclxuICAgICAgICB0aGlzLnJlZ2lzdGVySGFuZGxlcignY29udmVydDpwYXJlbnQtdXJsOnNpdGVtYXAnLCB0aGlzLmhhbmRsZUdldFNpdGVtYXAuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cGFyZW50LXVybDpjYW5jZWwnLCB0aGlzLmhhbmRsZUNhbmNlbC5iaW5kKHRoaXMpKTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBwYXJlbnQgVVJMIGNvbnZlcnNpb24gcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIENvbnZlcnNpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNvbnZlcnQoZXZlbnQsIHsgdXJsLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIFZhbGlkYXRlIFVSTFxyXG4gICAgICAgICAgICBjb25zdCBwYXJzZWRVcmwgPSBuZXcgVVJMKHVybCk7XHJcbiAgICAgICAgICAgIGlmICghdGhpcy5zdXBwb3J0ZWRQcm90b2NvbHMuaW5jbHVkZXMocGFyc2VkVXJsLnByb3RvY29sKSkge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKGBVbnN1cHBvcnRlZCBwcm90b2NvbDogJHtwYXJzZWRVcmwucHJvdG9jb2x9YCk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb25JZCA9IHRoaXMuZ2VuZXJhdGVDb252ZXJzaW9uSWQoKTtcclxuICAgICAgICAgICAgY29uc3Qgd2luZG93ID0gZXZlbnQ/LnNlbmRlcj8uZ2V0T3duZXJCcm93c2VyV2luZG93Py4oKSB8fCBudWxsO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ3JlYXRlIHRlbXAgZGlyZWN0b3J5IGZvciB0aGlzIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGF3YWl0IHRoaXMuZmlsZVN0b3JhZ2UuY3JlYXRlVGVtcERpcigncGFyZW50X3VybF9jb252ZXJzaW9uJyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLnNldChjb252ZXJzaW9uSWQsIHtcclxuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdzdGFydGluZycsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcclxuICAgICAgICAgICAgICAgIHVybCxcclxuICAgICAgICAgICAgICAgIHRlbXBEaXIsXHJcbiAgICAgICAgICAgICAgICB3aW5kb3csXHJcbiAgICAgICAgICAgICAgICBwcm9jZXNzZWRVcmxzOiBuZXcgU2V0KCksXHJcbiAgICAgICAgICAgICAgICBwYWdlczogW11cclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICAvLyBOb3RpZnkgY2xpZW50IHRoYXQgY29udmVyc2lvbiBoYXMgc3RhcnRlZCAob25seSBpZiB3ZSBoYXZlIGEgdmFsaWQgd2luZG93KVxyXG4gICAgICAgICAgICBpZiAod2luZG93ICYmIHdpbmRvdy53ZWJDb250ZW50cykge1xyXG4gICAgICAgICAgICAgICAgd2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ3BhcmVudC11cmw6Y29udmVyc2lvbi1zdGFydGVkJywgeyBjb252ZXJzaW9uSWQgfSk7XHJcbiAgICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICAgIC8vIFN0YXJ0IGNvbnZlcnNpb24gcHJvY2Vzc1xyXG4gICAgICAgICAgICB0aGlzLnByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgdXJsLCBvcHRpb25zKS5jYXRjaChlcnJvciA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUGFyZW50VXJsQ29udmVydGVyXSBDb252ZXJzaW9uIGZhaWxlZCBmb3IgJHtjb252ZXJzaW9uSWR9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdmYWlsZWQnLCB7IGVycm9yOiBlcnJvci5tZXNzYWdlIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICAgICAgZnMucmVtb3ZlKHRlbXBEaXIpLmNhdGNoKGVyciA9PiB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIGNsZWFuIHVwIHRlbXAgZGlyZWN0b3J5OiAke3RlbXBEaXJ9YCwgZXJyKTtcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgICAgIHJldHVybiB7IGNvbnZlcnNpb25JZCB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBzdGFydCBjb252ZXJzaW9uOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHNpdGVtYXAgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFNpdGVtYXAgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldFNpdGVtYXAoZXZlbnQsIHsgdXJsLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGJyb3dzZXIgPSBhd2FpdCB0aGlzLmxhdW5jaEJyb3dzZXIoKTtcclxuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcCA9IGF3YWl0IHRoaXMuZGlzY292ZXJTaXRlbWFwKHVybCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgcmV0dXJuIHNpdGVtYXA7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBzaXRlbWFwOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyBwYXJlbnQgVVJMIGNvbnZlcnNpb25cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gY29udmVydFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc0NvbnZlcnNpb24oY29udmVyc2lvbklkLCB1cmwsIG9wdGlvbnMpIHtcclxuICAgICAgICBsZXQgYnJvd3NlciA9IG51bGw7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb252ZXJzaW9uIG5vdCBmb3VuZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gY29udmVyc2lvbi50ZW1wRGlyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTGF1bmNoIGJyb3dzZXJcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2xhdW5jaGluZ19icm93c2VyJywgeyBwcm9ncmVzczogNSB9KTtcclxuICAgICAgICAgICAgYnJvd3NlciA9IGF3YWl0IHRoaXMubGF1bmNoQnJvd3NlcigpO1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLmJyb3dzZXIgPSBicm93c2VyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRGlzY292ZXIgc2l0ZW1hcFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZGlzY292ZXJpbmdfc2l0ZW1hcCcsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBzaXRlbWFwID0gYXdhaXQgdGhpcy5kaXNjb3ZlclNpdGVtYXAodXJsLCBvcHRpb25zLCBicm93c2VyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFByb2Nlc3MgZWFjaCBwYWdlXHJcbiAgICAgICAgICAgIGNvbnN0IG1heFBhZ2VzID0gb3B0aW9ucy5tYXhQYWdlcyB8fCBzaXRlbWFwLnBhZ2VzLmxlbmd0aDtcclxuICAgICAgICAgICAgY29uc3QgcGFnZXNUb1Byb2Nlc3MgPSBzaXRlbWFwLnBhZ2VzLnNsaWNlKDAsIG1heFBhZ2VzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdwcm9jZXNzaW5nX3BhZ2VzJywge1xyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDIwLFxyXG4gICAgICAgICAgICAgICAgdG90YWw6IHBhZ2VzVG9Qcm9jZXNzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgIHByb2Nlc3NlZDogMFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAobGV0IGkgPSAwOyBpIDwgcGFnZXNUb1Byb2Nlc3MubGVuZ3RoOyBpKyspIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2UgPSBwYWdlc1RvUHJvY2Vzc1tpXTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gU2tpcCBpZiBhbHJlYWR5IHByb2Nlc3NlZFxyXG4gICAgICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24ucHJvY2Vzc2VkVXJscy5oYXMocGFnZS51cmwpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFByb2Nlc3MgcGFnZVxyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3Byb2Nlc3NpbmdfcGFnZScsIHtcclxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzczogMjAgKyBNYXRoLmZsb29yKChpIC8gcGFnZXNUb1Byb2Nlc3MubGVuZ3RoKSAqIDYwKSxcclxuICAgICAgICAgICAgICAgICAgICBjdXJyZW50UGFnZTogcGFnZS51cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2VkOiBpLFxyXG4gICAgICAgICAgICAgICAgICAgIHRvdGFsOiBwYWdlc1RvUHJvY2Vzcy5sZW5ndGhcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDb252ZXJ0IHBhZ2UgdXNpbmcgcGFyZW50IFVybENvbnZlcnRlcidzIG1ldGhvZHNcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VDb250ZW50ID0gYXdhaXQgdGhpcy5wcm9jZXNzUGFnZShwYWdlLnVybCwgb3B0aW9ucywgYnJvd3NlciwgdGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEFkZCB0byBwcm9jZXNzZWQgcGFnZXNcclxuICAgICAgICAgICAgICAgIGNvbnZlcnNpb24ucHJvY2Vzc2VkVXJscy5hZGQocGFnZS51cmwpO1xyXG4gICAgICAgICAgICAgICAgY29udmVyc2lvbi5wYWdlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB1cmw6IHBhZ2UudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgIHRpdGxlOiBwYWdlLnRpdGxlLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRlbnQ6IHBhZ2VDb250ZW50XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgY29tYmluZWQgbWFya2Rvd25cclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2dlbmVyYXRpbmdfbWFya2Rvd24nLCB7IHByb2dyZXNzOiA5MCB9KTtcclxuICAgICAgICAgICAgY29uc3QgbWFya2Rvd24gPSB0aGlzLmdlbmVyYXRlQ29tYmluZWRNYXJrZG93bihzaXRlbWFwLCBjb252ZXJzaW9uLnBhZ2VzLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXJcclxuICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLmJyb3dzZXIgPSBudWxsO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgYXdhaXQgZnMucmVtb3ZlKHRlbXBEaXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2NvbXBsZXRlZCcsIHsgXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMTAwLFxyXG4gICAgICAgICAgICAgICAgcmVzdWx0OiBtYXJrZG93blxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBtYXJrZG93bjtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUGFyZW50VXJsQ29udmVydGVyXSBDb252ZXJzaW9uIHByb2Nlc3NpbmcgZmFpbGVkOicsIGVycm9yKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsb3NlIGJyb3dzZXIgaWYgb3BlblxyXG4gICAgICAgICAgICBpZiAoYnJvd3Nlcikge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgYnJvd3Nlci5jbG9zZSgpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aHJvdyBlcnJvcjtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBMYXVuY2ggYnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8cHVwcGV0ZWVyLkJyb3dzZXI+fSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGxhdW5jaEJyb3dzZXIoKSB7XHJcbiAgICAgICAgY29uc3QgcHVwcGV0ZWVyID0gcmVxdWlyZSgncHVwcGV0ZWVyJyk7XHJcbiAgICAgICAgcmV0dXJuIGF3YWl0IHB1cHBldGVlci5sYXVuY2goe1xyXG4gICAgICAgICAgICBoZWFkbGVzczogJ25ldycsXHJcbiAgICAgICAgICAgIGFyZ3M6IFsnLS1uby1zYW5kYm94JywgJy0tZGlzYWJsZS1zZXR1aWQtc2FuZGJveCddXHJcbiAgICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBEaXNjb3ZlciBzaXRlbWFwIGZvciBVUkxcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gZGlzY292ZXJcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gRGlzY292ZXJ5IG9wdGlvbnNcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IGJyb3dzZXIgLSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBTaXRlbWFwXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGRpc2NvdmVyU2l0ZW1hcCh1cmwsIG9wdGlvbnMsIGJyb3dzZXIpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuZ290byh1cmwsIHsgd2FpdFVudGlsOiAnbmV0d29ya2lkbGUyJywgdGltZW91dDogMzAwMDAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgYmFzZSBVUkwgYW5kIGRvbWFpblxyXG4gICAgICAgICAgICBjb25zdCBiYXNlVXJsID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoKSA9PiBkb2N1bWVudC5iYXNlVVJJKTtcclxuICAgICAgICAgICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTChiYXNlVXJsKTtcclxuICAgICAgICAgICAgY29uc3QgZG9tYWluID0gcGFyc2VkVXJsLmhvc3RuYW1lO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IHNpdGUgbWV0YWRhdGFcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmZldGNoTWV0YWRhdGEodXJsLCBicm93c2VyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEZpbmQgbGlua3NcclxuICAgICAgICAgICAgY29uc3QgbWF4RGVwdGggPSBvcHRpb25zLm1heERlcHRoIHx8IDE7XHJcbiAgICAgICAgICAgIGNvbnN0IG1heFBhZ2VzID0gb3B0aW9ucy5tYXhQYWdlcyB8fCAxMDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGRpc2NvdmVyZWRQYWdlcyA9IG5ldyBNYXAoKTtcclxuICAgICAgICAgICAgZGlzY292ZXJlZFBhZ2VzLnNldCh1cmwsIHtcclxuICAgICAgICAgICAgICAgIHVybCxcclxuICAgICAgICAgICAgICAgIHRpdGxlOiBtZXRhZGF0YS50aXRsZSxcclxuICAgICAgICAgICAgICAgIGRlcHRoOiAwLFxyXG4gICAgICAgICAgICAgICAgbGlua3M6IFtdXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQnJlYWR0aC1maXJzdCBzZWFyY2ggZm9yIGxpbmtzXHJcbiAgICAgICAgICAgIGNvbnN0IHF1ZXVlID0gW3sgdXJsLCBkZXB0aDogMCB9XTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHdoaWxlIChxdWV1ZS5sZW5ndGggPiAwICYmIGRpc2NvdmVyZWRQYWdlcy5zaXplIDwgbWF4UGFnZXMpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHsgdXJsOiBjdXJyZW50VXJsLCBkZXB0aCB9ID0gcXVldWUuc2hpZnQoKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gU2tpcCBpZiBhbHJlYWR5IGF0IG1heCBkZXB0aFxyXG4gICAgICAgICAgICAgICAgaWYgKGRlcHRoID49IG1heERlcHRoKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEdldCBsaW5rcyBmcm9tIHBhZ2VcclxuICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtzID0gYXdhaXQgdGhpcy5nZXRQYWdlTGlua3MoY3VycmVudFVybCwgZG9tYWluLCBicm93c2VyKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gVXBkYXRlIGN1cnJlbnQgcGFnZSBsaW5rc1xyXG4gICAgICAgICAgICAgICAgY29uc3QgY3VycmVudFBhZ2UgPSBkaXNjb3ZlcmVkUGFnZXMuZ2V0KGN1cnJlbnRVcmwpO1xyXG4gICAgICAgICAgICAgICAgaWYgKGN1cnJlbnRQYWdlKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFBhZ2UubGlua3MgPSBsaW5rcztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQWRkIG5ldyBsaW5rcyB0byBxdWV1ZVxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBsaW5rIG9mIGxpbmtzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgaWYgKCFkaXNjb3ZlcmVkUGFnZXMuaGFzKGxpbmsudXJsKSAmJiBkaXNjb3ZlcmVkUGFnZXMuc2l6ZSA8IG1heFBhZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEdldCBwYWdlIHRpdGxlXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGxldCB0aXRsZSA9IGxpbmsudGV4dDtcclxuICAgICAgICAgICAgICAgICAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IGxpbmtQYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsaW5rUGFnZS5nb3RvKGxpbmsudXJsLCB7IHdhaXRVbnRpbDogJ2RvbWNvbnRlbnRsb2FkZWQnLCB0aW1lb3V0OiAxMDAwMCB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlID0gYXdhaXQgbGlua1BhZ2UudGl0bGUoKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGF3YWl0IGxpbmtQYWdlLmNsb3NlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUGFyZW50VXJsQ29udmVydGVyXSBGYWlsZWQgdG8gZ2V0IHRpdGxlIGZvciAke2xpbmsudXJsfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCB0byBkaXNjb3ZlcmVkIHBhZ2VzXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGRpc2NvdmVyZWRQYWdlcy5zZXQobGluay51cmwsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogbGluay51cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogdGl0bGUgfHwgbGluay50ZXh0LFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZGVwdGg6IGRlcHRoICsgMSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmtzOiBbXVxyXG4gICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIEFkZCB0byBxdWV1ZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBxdWV1ZS5wdXNoKHsgdXJsOiBsaW5rLnVybCwgZGVwdGg6IGRlcHRoICsgMSB9KTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEJ1aWxkIHNpdGVtYXBcclxuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcCA9IHtcclxuICAgICAgICAgICAgICAgIHJvb3RVcmw6IHVybCxcclxuICAgICAgICAgICAgICAgIGRvbWFpbixcclxuICAgICAgICAgICAgICAgIHRpdGxlOiBtZXRhZGF0YS50aXRsZSxcclxuICAgICAgICAgICAgICAgIHBhZ2VzOiBBcnJheS5mcm9tKGRpc2NvdmVyZWRQYWdlcy52YWx1ZXMoKSlcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiBzaXRlbWFwO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBkaXNjb3ZlciBzaXRlbWFwOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGxpbmtzIGZyb20gcGFnZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHVybCAtIFVSTCB0byBnZXQgbGlua3MgZnJvbVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IGRvbWFpbiAtIERvbWFpbiB0byBmaWx0ZXIgbGlua3NcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IGJyb3dzZXIgLSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxBcnJheT59IEFycmF5IG9mIGxpbmtzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGdldFBhZ2VMaW5rcyh1cmwsIGRvbWFpbiwgYnJvd3Nlcikge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhZ2UgPSBhd2FpdCBicm93c2VyLm5ld1BhZ2UoKTtcclxuICAgICAgICAgICAgYXdhaXQgcGFnZS5nb3RvKHVybCwgeyB3YWl0VW50aWw6ICdkb21jb250ZW50bG9hZGVkJywgdGltZW91dDogMzAwMDAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBFeHRyYWN0IGxpbmtzXHJcbiAgICAgICAgICAgIGNvbnN0IGxpbmtzID0gYXdhaXQgcGFnZS5ldmFsdWF0ZSgoZG9tYWluKSA9PiB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5rcyA9IFtdO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgYW5jaG9ycyA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3JBbGwoJ2FbaHJlZl0nKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgZm9yIChjb25zdCBhbmNob3Igb2YgYW5jaG9ycykge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IGhyZWYgPSBhbmNob3IuaHJlZjtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCB0ZXh0ID0gYW5jaG9yLnRleHRDb250ZW50LnRyaW0oKTtcclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBTa2lwIGVtcHR5LCBoYXNoLCBhbmQgamF2YXNjcmlwdCBsaW5rc1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghaHJlZiB8fCBocmVmLnN0YXJ0c1dpdGgoJyMnKSB8fCBocmVmLnN0YXJ0c1dpdGgoJ2phdmFzY3JpcHQ6JykpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHVybCA9IG5ldyBVUkwoaHJlZik7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBPbmx5IGluY2x1ZGUgbGlua3MgZnJvbSBzYW1lIGRvbWFpblxyXG4gICAgICAgICAgICAgICAgICAgICAgICBpZiAodXJsLmhvc3RuYW1lID09PSBkb21haW4pIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGxpbmtzLnB1c2goe1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogaHJlZixcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB0ZXh0OiB0ZXh0IHx8IGhyZWZcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gU2tpcCBpbnZhbGlkIFVSTHNcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIHJldHVybiBsaW5rcztcclxuICAgICAgICAgICAgfSwgZG9tYWluKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuY2xvc2UoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFJlbW92ZSBkdXBsaWNhdGVzXHJcbiAgICAgICAgICAgIGNvbnN0IHVuaXF1ZUxpbmtzID0gW107XHJcbiAgICAgICAgICAgIGNvbnN0IHNlZW5VcmxzID0gbmV3IFNldCgpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgZm9yIChjb25zdCBsaW5rIG9mIGxpbmtzKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBOb3JtYWxpemUgVVJMIGJ5IHJlbW92aW5nIHRyYWlsaW5nIHNsYXNoIGFuZCBoYXNoXHJcbiAgICAgICAgICAgICAgICBjb25zdCBub3JtYWxpemVkVXJsID0gbGluay51cmwucmVwbGFjZSgvIy4qJC8sICcnKS5yZXBsYWNlKC9cXC8kLywgJycpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBpZiAoIXNlZW5VcmxzLmhhcyhub3JtYWxpemVkVXJsKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIHNlZW5VcmxzLmFkZChub3JtYWxpemVkVXJsKTtcclxuICAgICAgICAgICAgICAgICAgICB1bmlxdWVMaW5rcy5wdXNoKGxpbmspO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gdW5pcXVlTGlua3M7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBsaW5rcyBmcm9tICR7dXJsfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHJldHVybiBbXTtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBQcm9jZXNzIGEgc2luZ2xlIHBhZ2VcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gcHJvY2Vzc1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBQcm9jZXNzaW5nIG9wdGlvbnNcclxuICAgICAqIEBwYXJhbSB7cHVwcGV0ZWVyLkJyb3dzZXJ9IGJyb3dzZXIgLSBCcm93c2VyIGluc3RhbmNlXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdGVtcERpciAtIFRlbXBvcmFyeSBkaXJlY3RvcnlcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHN0cmluZz59IE1hcmtkb3duIGNvbnRlbnRcclxuICAgICAqL1xyXG4gICAgYXN5bmMgcHJvY2Vzc1BhZ2UodXJsLCBvcHRpb25zLCBicm93c2VyLCB0ZW1wRGlyKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBjb250ZW50XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmV4dHJhY3RDb250ZW50KHVybCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIGltYWdlcyBpZiByZXF1ZXN0ZWRcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZUltYWdlcykge1xyXG4gICAgICAgICAgICAgICAgYXdhaXQgdGhpcy5wcm9jZXNzSW1hZ2VzKGNvbnRlbnQsIHRlbXBEaXIsIHVybCwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENhcHR1cmUgc2NyZWVuc2hvdCBpZiByZXF1ZXN0ZWRcclxuICAgICAgICAgICAgbGV0IHNjcmVlbnNob3QgPSBudWxsO1xyXG4gICAgICAgICAgICBpZiAob3B0aW9ucy5pbmNsdWRlU2NyZWVuc2hvdCkge1xyXG4gICAgICAgICAgICAgICAgY29uc3Qgc2NyZWVuc2hvdFBhdGggPSBwYXRoLmpvaW4odGVtcERpciwgYHNjcmVlbnNob3RfJHtEYXRlLm5vdygpfS5wbmdgKTtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMuY2FwdHVyZVNjcmVlbnNob3QodXJsLCBzY3JlZW5zaG90UGF0aCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFJlYWQgc2NyZWVuc2hvdCBhcyBiYXNlNjRcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3REYXRhID0gYXdhaXQgZnMucmVhZEZpbGUoc2NyZWVuc2hvdFBhdGgsIHsgZW5jb2Rpbmc6ICdiYXNlNjQnIH0pO1xyXG4gICAgICAgICAgICAgICAgc2NyZWVuc2hvdCA9IGBkYXRhOmltYWdlL3BuZztiYXNlNjQsJHtzY3JlZW5zaG90RGF0YX1gO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZXQgbWV0YWRhdGFcclxuICAgICAgICAgICAgY29uc3QgbWV0YWRhdGEgPSBhd2FpdCB0aGlzLmZldGNoTWV0YWRhdGEodXJsLCBicm93c2VyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duXHJcbiAgICAgICAgICAgIHJldHVybiB0aGlzLmdlbmVyYXRlTWFya2Rvd24obWV0YWRhdGEsIGNvbnRlbnQsIHNjcmVlbnNob3QsIG9wdGlvbnMpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBwcm9jZXNzIHBhZ2UgJHt1cmx9OmAsIGVycm9yKTtcclxuICAgICAgICAgICAgcmV0dXJuIGAjIEVycm9yIFByb2Nlc3NpbmcgUGFnZTogJHt1cmx9XFxuXFxuRmFpbGVkIHRvIHByb2Nlc3MgdGhpcyBwYWdlOiAke2Vycm9yLm1lc3NhZ2V9YDtcclxuICAgICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBjb21iaW5lZCBtYXJrZG93biBmcm9tIG11bHRpcGxlIHBhZ2VzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gc2l0ZW1hcCAtIFNpdGVtYXBcclxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHBhZ2VzIC0gUHJvY2Vzc2VkIHBhZ2VzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gQ29tYmluZWQgbWFya2Rvd25cclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVDb21iaW5lZE1hcmtkb3duKHNpdGVtYXAsIHBhZ2VzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdGl0bGVcclxuICAgICAgICBpZiAob3B0aW9ucy50aXRsZSkge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7b3B0aW9ucy50aXRsZX1gKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7c2l0ZW1hcC50aXRsZSB8fCAnV2Vic2l0ZSBDb252ZXJzaW9uJ31gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHNpdGUgaW5mb3JtYXRpb25cclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBTaXRlIEluZm9ybWF0aW9uJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBSb290IFVSTCB8IFske3NpdGVtYXAucm9vdFVybH1dKCR7c2l0ZW1hcC5yb290VXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRG9tYWluIHwgJHtzaXRlbWFwLmRvbWFpbn0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUGFnZXMgUHJvY2Vzc2VkIHwgJHtwYWdlcy5sZW5ndGh9IHxgKTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdGFibGUgb2YgY29udGVudHNcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBUYWJsZSBvZiBDb250ZW50cycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCR7aW5kZXggKyAxfS4gWyR7cGFnZS50aXRsZSB8fCBwYWdlLnVybH1dKCNwYWdlLSR7aW5kZXggKyAxfSlgKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgZWFjaCBwYWdlXHJcbiAgICAgICAgcGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgPGEgaWQ9XCJwYWdlLSR7aW5kZXggKyAxfVwiPjwvYT5gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyMgUGFnZSAke2luZGV4ICsgMX06ICR7cGFnZS50aXRsZSB8fCBwYWdlLnVybH1gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYFVSTDogWyR7cGFnZS51cmx9XSgke3BhZ2UudXJsfSlgKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJy0tLScpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChwYWdlLmNvbnRlbnQpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnLS0tJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBzaXRlbWFwIHZpc3VhbGl6YXRpb24gaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZVNpdGVtYXApIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgU2l0ZSBTdHJ1Y3R1cmUnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ2BgYG1lcm1haWQnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnZ3JhcGggVEQnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCByb290IG5vZGVcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290W1wiJHtzaXRlbWFwLnRpdGxlIHx8IHNpdGVtYXAucm9vdFVybH1cIl1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCBwYWdlIG5vZGVzIGFuZCBsaW5rc1xyXG4gICAgICAgICAgICBzaXRlbWFwLnBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocGFnZS51cmwgIT09IHNpdGVtYXAucm9vdFVybCkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgcGFnZSR7aW5kZXh9W1wiJHtwYWdlLnRpdGxlIHx8IHBhZ2UudXJsfVwiXWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgcGFyZW50IHBhZ2VcclxuICAgICAgICAgICAgICAgICAgICBsZXQgcGFyZW50Rm91bmQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBvdGVudGlhbFBhcmVudCBvZiBzaXRlbWFwLnBhZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwb3RlbnRpYWxQYXJlbnQubGlua3Muc29tZShsaW5rID0+IGxpbmsudXJsID09PSBwYWdlLnVybCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmVudEluZGV4ID0gc2l0ZW1hcC5wYWdlcy5maW5kSW5kZXgocCA9PiBwLnVybCA9PT0gcG90ZW50aWFsUGFyZW50LnVybCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocG90ZW50aWFsUGFyZW50LnVybCA9PT0gc2l0ZW1hcC5yb290VXJsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290IC0tPiBwYWdlJHtpbmRleH1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICBwYWdlJHtwYXJlbnRJbmRleH0gLS0+IHBhZ2Uke2luZGV4fWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50Rm91bmQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgbm8gcGFyZW50IGZvdW5kLCBjb25uZWN0IHRvIHJvb3RcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXBhcmVudEZvdW5kKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgcm9vdCAtLT4gcGFnZSR7aW5kZXh9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ2BgYCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGNvbnZlcnRlciBpbmZvcm1hdGlvblxyXG4gICAgICogQHJldHVybnMge09iamVjdH0gQ29udmVydGVyIGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgZ2V0SW5mbygpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBuYW1lOiB0aGlzLm5hbWUsXHJcbiAgICAgICAgICAgIHByb3RvY29sczogdGhpcy5zdXBwb3J0ZWRQcm90b2NvbHMsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIHNpdGUgdGl0bGUnLFxyXG4gICAgICAgICAgICAgICAgbWF4RGVwdGg6ICdNYXhpbXVtIGNyYXdsIGRlcHRoIChkZWZhdWx0OiAxKScsXHJcbiAgICAgICAgICAgICAgICBtYXhQYWdlczogJ01heGltdW0gcGFnZXMgdG8gcHJvY2VzcyAoZGVmYXVsdDogMTApJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVTY3JlZW5zaG90OiAnV2hldGhlciB0byBpbmNsdWRlIHBhZ2Ugc2NyZWVuc2hvdHMgKGRlZmF1bHQ6IGZhbHNlKScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlSW1hZ2VzOiAnV2hldGhlciB0byBpbmNsdWRlIGltYWdlcyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUxpbmtzOiAnV2hldGhlciB0byBpbmNsdWRlIGxpbmtzIHNlY3Rpb24gKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVTaXRlbWFwOiAnV2hldGhlciB0byBpbmNsdWRlIHNpdGUgc3RydWN0dXJlIHZpc3VhbGl6YXRpb24gKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIHdhaXRUaW1lOiAnQWRkaXRpb25hbCB0aW1lIHRvIHdhaXQgZm9yIHBhZ2UgbG9hZCBpbiBtcydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gUGFyZW50VXJsQ29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQUVBLE1BQU1BLElBQUksR0FBR0MsT0FBTyxDQUFDLE1BQU0sQ0FBQztBQUM1QixNQUFNQyxFQUFFLEdBQUdELE9BQU8sQ0FBQyxVQUFVLENBQUM7QUFDOUIsTUFBTTtFQUFFRTtBQUFJLENBQUMsR0FBR0YsT0FBTyxDQUFDLEtBQUssQ0FBQztBQUM5QixNQUFNRyxZQUFZLEdBQUdILE9BQU8sQ0FBQyxnQkFBZ0IsQ0FBQztBQUU5QyxNQUFNSSxrQkFBa0IsU0FBU0QsWUFBWSxDQUFDO0VBQzFDRSxXQUFXQSxDQUFDQyxhQUFhLEVBQUVDLFdBQVcsRUFBRTtJQUNwQyxLQUFLLENBQUNELGFBQWEsRUFBRUMsV0FBVyxDQUFDO0lBQ2pDLElBQUksQ0FBQ0MsSUFBSSxHQUFHLHNCQUFzQjtJQUNsQyxJQUFJLENBQUNDLFdBQVcsR0FBRywwQ0FBMEM7RUFDakU7O0VBRUE7QUFDSjtBQUNB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