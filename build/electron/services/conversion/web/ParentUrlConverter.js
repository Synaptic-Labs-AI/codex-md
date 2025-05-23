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

      // Generate markdown files based on save mode
      this.updateConversionStatus(conversionId, 'generating_markdown', {
        progress: 90
      });
      const saveMode = options.websiteScraping?.saveMode || 'combined';
      console.log(`[ParentUrlConverter] Using save mode: ${saveMode}`);
      let result;
      if (saveMode === 'separate') {
        // Generate separate files
        result = await this.generateSeparateFiles(sitemap, conversion.pages, options, tempDir);
      } else {
        // Generate combined markdown (default behavior)
        result = this.generateCombinedMarkdown(sitemap, conversion.pages, options);
      }

      // Close browser
      await browser.close();
      conversion.browser = null;

      // Clean up temp directory
      await fs.remove(tempDir);
      this.updateConversionStatus(conversionId, 'completed', {
        progress: 100,
        result: result
      });
      return result;
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
   * Generate separate markdown files for each page
   * @param {Object} sitemap - Sitemap
   * @param {Array} pages - Processed pages
   * @param {Object} options - Conversion options
   * @param {string} tempDir - Temporary directory for file operations
   * @returns {Promise<Object>} Result with multiple files information
   */
  async generateSeparateFiles(sitemap, pages, options, tempDir) {
    try {
      console.log(`[ParentUrlConverter] Generating ${pages.length} separate files`);
      const outputDir = options.outputDir;
      const siteDomain = new URL(sitemap.rootUrl).hostname;
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const baseName = `${siteDomain}_${timestamp}`;

      // Create a subdirectory for the website files
      const websiteDir = path.join(outputDir, baseName);
      await fs.ensureDir(websiteDir);
      const generatedFiles = [];

      // Generate individual page files
      for (let i = 0; i < pages.length; i++) {
        const page = pages[i];

        // Create a safe filename from the page title or URL
        let filename = page.title || new URL(page.url).pathname;
        filename = filename.replace(/[^a-zA-Z0-9\-_]/g, '_');
        filename = filename.replace(/_+/g, '_').replace(/^_|_$/g, '');
        filename = filename || `page_${i + 1}`;

        // Ensure filename is not too long
        if (filename.length > 50) {
          filename = filename.substring(0, 50);
        }
        const filepath = path.join(websiteDir, `${filename}.md`);

        // Generate markdown for this page
        const pageMarkdown = this.generateSinglePageMarkdown(page, sitemap, options);

        // Write file
        await fs.writeFile(filepath, pageMarkdown, 'utf8');
        generatedFiles.push({
          title: page.title,
          url: page.url,
          filename: `${filename}.md`,
          filepath: filepath
        });
        console.log(`[ParentUrlConverter] Generated file: ${filename}.md`);
      }

      // Generate an index file with links to all pages
      const indexMarkdown = this.generateIndexMarkdown(sitemap, generatedFiles, options);
      const indexPath = path.join(websiteDir, 'index.md');
      await fs.writeFile(indexPath, indexMarkdown, 'utf8');
      console.log(`[ParentUrlConverter] Generated index file: index.md`);

      // Return information about the generated files
      return {
        type: 'multiple_files',
        outputDirectory: websiteDir,
        indexFile: indexPath,
        files: generatedFiles,
        totalFiles: generatedFiles.length + 1,
        // +1 for index
        summary: `Generated ${generatedFiles.length} page files + 1 index file in ${baseName}/`
      };
    } catch (error) {
      console.error('[ParentUrlConverter] Error generating separate files:', error);
      throw error;
    }
  }

  /**
   * Generate markdown for a single page
   * @param {Object} page - Page data
   * @param {Object} sitemap - Sitemap information
   * @param {Object} options - Conversion options
   * @returns {string} Single page markdown
   */
  generateSinglePageMarkdown(page, sitemap, options) {
    const markdown = [];

    // Add page title
    markdown.push(`# ${page.title || page.url}`);
    markdown.push('');

    // Add page metadata
    markdown.push('## Page Information');
    markdown.push('');
    markdown.push('| Property | Value |');
    markdown.push('| --- | --- |');
    markdown.push(`| URL | [${page.url}](${page.url}) |`);
    markdown.push(`| Title | ${page.title || 'N/A'} |`);
    markdown.push(`| Site | [${sitemap.domain}](${sitemap.rootUrl}) |`);
    markdown.push(`| Generated | ${new Date().toISOString()} |`);
    markdown.push('');

    // Add content
    markdown.push('## Content');
    markdown.push('');
    markdown.push(page.content);
    return markdown.join('\n');
  }

  /**
   * Generate index markdown with links to all pages
   * @param {Object} sitemap - Sitemap information
   * @param {Array} files - Generated files information
   * @param {Object} options - Conversion options
   * @returns {string} Index markdown
   */
  generateIndexMarkdown(sitemap, files, options) {
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
    markdown.push(`| Pages Processed | ${files.length} |`);
    markdown.push(`| Generated | ${new Date().toISOString()} |`);
    markdown.push('');

    // Add list of generated files
    markdown.push('## Generated Files');
    markdown.push('');
    files.forEach((file, index) => {
      markdown.push(`${index + 1}. [${file.title || file.url}](./${file.filename})`);
      markdown.push(`   - URL: ${file.url}`);
      markdown.push(`   - File: ${file.filename}`);
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiVVJMIiwiVXJsQ29udmVydGVyIiwiUGFyZW50VXJsQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJuYW1lIiwiZGVzY3JpcHRpb24iLCJzZXR1cElwY0hhbmRsZXJzIiwicmVnaXN0ZXJIYW5kbGVyIiwiaGFuZGxlQ29udmVydCIsImJpbmQiLCJoYW5kbGVHZXRTaXRlbWFwIiwiaGFuZGxlQ2FuY2VsIiwiZXZlbnQiLCJ1cmwiLCJvcHRpb25zIiwicGFyc2VkVXJsIiwic3VwcG9ydGVkUHJvdG9jb2xzIiwiaW5jbHVkZXMiLCJwcm90b2NvbCIsIkVycm9yIiwiY29udmVyc2lvbklkIiwiZ2VuZXJhdGVDb252ZXJzaW9uSWQiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsImFjdGl2ZUNvbnZlcnNpb25zIiwic2V0IiwiaWQiLCJzdGF0dXMiLCJwcm9ncmVzcyIsInByb2Nlc3NlZFVybHMiLCJTZXQiLCJwYWdlcyIsIndlYkNvbnRlbnRzIiwic2VuZCIsInByb2Nlc3NDb252ZXJzaW9uIiwiY2F0Y2giLCJlcnJvciIsImNvbnNvbGUiLCJ1cGRhdGVDb252ZXJzaW9uU3RhdHVzIiwibWVzc2FnZSIsInJlbW92ZSIsImVyciIsImJyb3dzZXIiLCJsYXVuY2hCcm93c2VyIiwic2l0ZW1hcCIsImRpc2NvdmVyU2l0ZW1hcCIsImNsb3NlIiwiY29udmVyc2lvbiIsImdldCIsIm1heFBhZ2VzIiwibGVuZ3RoIiwicGFnZXNUb1Byb2Nlc3MiLCJzbGljZSIsInRvdGFsIiwicHJvY2Vzc2VkIiwiaSIsInBhZ2UiLCJoYXMiLCJNYXRoIiwiZmxvb3IiLCJjdXJyZW50UGFnZSIsInBhZ2VDb250ZW50IiwicHJvY2Vzc1BhZ2UiLCJhZGQiLCJwdXNoIiwidGl0bGUiLCJjb250ZW50Iiwic2F2ZU1vZGUiLCJ3ZWJzaXRlU2NyYXBpbmciLCJsb2ciLCJyZXN1bHQiLCJnZW5lcmF0ZVNlcGFyYXRlRmlsZXMiLCJnZW5lcmF0ZUNvbWJpbmVkTWFya2Rvd24iLCJwdXBwZXRlZXIiLCJsYXVuY2giLCJoZWFkbGVzcyIsImFyZ3MiLCJuZXdQYWdlIiwiZ290byIsIndhaXRVbnRpbCIsInRpbWVvdXQiLCJiYXNlVXJsIiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImJhc2VVUkkiLCJkb21haW4iLCJob3N0bmFtZSIsIm1ldGFkYXRhIiwiZmV0Y2hNZXRhZGF0YSIsIm1heERlcHRoIiwiZGlzY292ZXJlZFBhZ2VzIiwiTWFwIiwiZGVwdGgiLCJsaW5rcyIsInF1ZXVlIiwic2l6ZSIsImN1cnJlbnRVcmwiLCJzaGlmdCIsImdldFBhZ2VMaW5rcyIsImxpbmsiLCJ0ZXh0IiwibGlua1BhZ2UiLCJyb290VXJsIiwiQXJyYXkiLCJmcm9tIiwidmFsdWVzIiwiYW5jaG9ycyIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJhbmNob3IiLCJocmVmIiwidGV4dENvbnRlbnQiLCJ0cmltIiwic3RhcnRzV2l0aCIsInVuaXF1ZUxpbmtzIiwic2VlblVybHMiLCJub3JtYWxpemVkVXJsIiwicmVwbGFjZSIsImV4dHJhY3RDb250ZW50IiwiaW5jbHVkZUltYWdlcyIsInByb2Nlc3NJbWFnZXMiLCJzY3JlZW5zaG90IiwiaW5jbHVkZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90UGF0aCIsImpvaW4iLCJEYXRlIiwibm93IiwiY2FwdHVyZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90RGF0YSIsInJlYWRGaWxlIiwiZW5jb2RpbmciLCJnZW5lcmF0ZU1hcmtkb3duIiwib3V0cHV0RGlyIiwic2l0ZURvbWFpbiIsInRpbWVzdGFtcCIsInRvSVNPU3RyaW5nIiwiYmFzZU5hbWUiLCJ3ZWJzaXRlRGlyIiwiZW5zdXJlRGlyIiwiZ2VuZXJhdGVkRmlsZXMiLCJmaWxlbmFtZSIsInBhdGhuYW1lIiwic3Vic3RyaW5nIiwiZmlsZXBhdGgiLCJwYWdlTWFya2Rvd24iLCJnZW5lcmF0ZVNpbmdsZVBhZ2VNYXJrZG93biIsIndyaXRlRmlsZSIsImluZGV4TWFya2Rvd24iLCJnZW5lcmF0ZUluZGV4TWFya2Rvd24iLCJpbmRleFBhdGgiLCJ0eXBlIiwib3V0cHV0RGlyZWN0b3J5IiwiaW5kZXhGaWxlIiwiZmlsZXMiLCJ0b3RhbEZpbGVzIiwic3VtbWFyeSIsIm1hcmtkb3duIiwiZm9yRWFjaCIsImZpbGUiLCJpbmRleCIsImluY2x1ZGVTaXRlbWFwIiwicGFyZW50Rm91bmQiLCJwb3RlbnRpYWxQYXJlbnQiLCJzb21lIiwicGFyZW50SW5kZXgiLCJmaW5kSW5kZXgiLCJwIiwiZ2V0SW5mbyIsInByb3RvY29scyIsImluY2x1ZGVMaW5rcyIsIndhaXRUaW1lIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL3dlYi9QYXJlbnRVcmxDb252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFBhcmVudFVybENvbnZlcnRlci5qc1xyXG4gKiBIYW5kbGVzIGNvbnZlcnNpb24gb2YgbXVsdGktcGFnZSB3ZWJzaXRlcyB0byBtYXJrZG93biBmb3JtYXQgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogXHJcbiAqIFRoaXMgY29udmVydGVyOlxyXG4gKiAtIEV4dGVuZHMgVXJsQ29udmVydGVyIHdpdGggc2l0ZSBjcmF3bGluZyBjYXBhYmlsaXRpZXNcclxuICogLSBEaXNjb3ZlcnMgYW5kIHByb2Nlc3NlcyBsaW5rZWQgcGFnZXNcclxuICogLSBDcmVhdGVzIGEgc3RydWN0dXJlZCBzaXRlIG1hcFxyXG4gKiAtIEdlbmVyYXRlcyBjb21wcmVoZW5zaXZlIG1hcmtkb3duIHdpdGggbXVsdGlwbGUgcGFnZXNcclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gVXJsQ29udmVydGVyLmpzOiBQYXJlbnQgY2xhc3MgZm9yIHNpbmdsZSBwYWdlIGNvbnZlcnNpb25cclxuICogLSBGaWxlU3RvcmFnZVNlcnZpY2UuanM6IEZvciB0ZW1wb3JhcnkgZmlsZSBtYW5hZ2VtZW50XHJcbiAqIC0gQ29udmVyc2lvblNlcnZpY2UuanM6IFJlZ2lzdGVycyBhbmQgdXNlcyB0aGlzIGNvbnZlcnRlclxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxuY29uc3QgeyBVUkwgfSA9IHJlcXVpcmUoJ3VybCcpO1xyXG5jb25zdCBVcmxDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL1VybENvbnZlcnRlcicpO1xyXG5cclxuY2xhc3MgUGFyZW50VXJsQ29udmVydGVyIGV4dGVuZHMgVXJsQ29udmVydGVyIHtcclxuICAgIGNvbnN0cnVjdG9yKGZpbGVQcm9jZXNzb3IsIGZpbGVTdG9yYWdlKSB7XHJcbiAgICAgICAgc3VwZXIoZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpO1xyXG4gICAgICAgIHRoaXMubmFtZSA9ICdQYXJlbnQgVVJMIENvbnZlcnRlcic7XHJcbiAgICAgICAgdGhpcy5kZXNjcmlwdGlvbiA9ICdDb252ZXJ0cyBtdWx0aS1wYWdlIHdlYnNpdGVzIHRvIG1hcmtkb3duJztcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIHBhcmVudCBVUkwgY29udmVyc2lvblxyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnBhcmVudC11cmwnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cGFyZW50LXVybDpzaXRlbWFwJywgdGhpcy5oYW5kbGVHZXRTaXRlbWFwLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnBhcmVudC11cmw6Y2FuY2VsJywgdGhpcy5oYW5kbGVDYW5jZWwuYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgcGFyZW50IFVSTCBjb252ZXJzaW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IHVybCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBVUkxcclxuICAgICAgICAgICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTCh1cmwpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuc3VwcG9ydGVkUHJvdG9jb2xzLmluY2x1ZGVzKHBhcnNlZFVybC5wcm90b2NvbCkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcHJvdG9jb2w6ICR7cGFyc2VkVXJsLnByb3RvY29sfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uSWQgPSB0aGlzLmdlbmVyYXRlQ29udmVyc2lvbklkKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50Py5zZW5kZXI/LmdldE93bmVyQnJvd3NlcldpbmRvdz8uKCkgfHwgbnVsbDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSB0ZW1wIGRpcmVjdG9yeSBmb3IgdGhpcyBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3BhcmVudF91cmxfY29udmVyc2lvbicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5zZXQoY29udmVyc2lvbklkLCB7XHJcbiAgICAgICAgICAgICAgICBpZDogY29udmVyc2lvbklkLFxyXG4gICAgICAgICAgICAgICAgc3RhdHVzOiAnc3RhcnRpbmcnLFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDAsXHJcbiAgICAgICAgICAgICAgICB1cmwsXHJcbiAgICAgICAgICAgICAgICB0ZW1wRGlyLFxyXG4gICAgICAgICAgICAgICAgd2luZG93LFxyXG4gICAgICAgICAgICAgICAgcHJvY2Vzc2VkVXJsczogbmV3IFNldCgpLFxyXG4gICAgICAgICAgICAgICAgcGFnZXM6IFtdXHJcbiAgICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICAgICAgLy8gTm90aWZ5IGNsaWVudCB0aGF0IGNvbnZlcnNpb24gaGFzIHN0YXJ0ZWQgKG9ubHkgaWYgd2UgaGF2ZSBhIHZhbGlkIHdpbmRvdylcclxuICAgICAgICAgICAgaWYgKHdpbmRvdyAmJiB3aW5kb3cud2ViQ29udGVudHMpIHtcclxuICAgICAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwYXJlbnQtdXJsOmNvbnZlcnNpb24tc3RhcnRlZCcsIHsgY29udmVyc2lvbklkIH0pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBTdGFydCBjb252ZXJzaW9uIHByb2Nlc3NcclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHVybCwgb3B0aW9ucykuY2F0Y2goZXJyb3IgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybENvbnZlcnRlcl0gQ29udmVyc2lvbiBmYWlsZWQgZm9yICR7Y29udmVyc2lvbklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZmFpbGVkJywgeyBlcnJvcjogZXJyb3IubWVzc2FnZSB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgIGZzLnJlbW92ZSh0ZW1wRGlyKS5jYXRjaChlcnIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeTogJHt0ZW1wRGlyfWAsIGVycik7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4geyBjb252ZXJzaW9uSWQgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUGFyZW50VXJsQ29udmVydGVyXSBGYWlsZWQgdG8gc3RhcnQgY29udmVyc2lvbjonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEhhbmRsZSBzaXRlbWFwIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBTaXRlbWFwIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVHZXRTaXRlbWFwKGV2ZW50LCB7IHVybCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBicm93c2VyID0gYXdhaXQgdGhpcy5sYXVuY2hCcm93c2VyKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXAgPSBhd2FpdCB0aGlzLmRpc2NvdmVyU2l0ZW1hcCh1cmwsIG9wdGlvbnMsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIHJldHVybiBzaXRlbWFwO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBnZXQgc2l0ZW1hcDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgcGFyZW50IFVSTCBjb252ZXJzaW9uXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGNvbnZlcnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgdXJsLCBvcHRpb25zKSB7XHJcbiAgICAgICAgbGV0IGJyb3dzZXIgPSBudWxsO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgICAgICBpZiAoIWNvbnZlcnNpb24pIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcignQ29udmVyc2lvbiBub3QgZm91bmQnKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgdGVtcERpciA9IGNvbnZlcnNpb24udGVtcERpcjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIExhdW5jaCBicm93c2VyXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdsYXVuY2hpbmdfYnJvd3NlcicsIHsgcHJvZ3Jlc3M6IDUgfSk7XHJcbiAgICAgICAgICAgIGJyb3dzZXIgPSBhd2FpdCB0aGlzLmxhdW5jaEJyb3dzZXIoKTtcclxuICAgICAgICAgICAgY29udmVyc2lvbi5icm93c2VyID0gYnJvd3NlcjtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIERpc2NvdmVyIHNpdGVtYXBcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2Rpc2NvdmVyaW5nX3NpdGVtYXAnLCB7IHByb2dyZXNzOiAxMCB9KTtcclxuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcCA9IGF3YWl0IHRoaXMuZGlzY292ZXJTaXRlbWFwKHVybCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBQcm9jZXNzIGVhY2ggcGFnZVxyXG4gICAgICAgICAgICBjb25zdCBtYXhQYWdlcyA9IG9wdGlvbnMubWF4UGFnZXMgfHwgc2l0ZW1hcC5wYWdlcy5sZW5ndGg7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhZ2VzVG9Qcm9jZXNzID0gc2l0ZW1hcC5wYWdlcy5zbGljZSgwLCBtYXhQYWdlcyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAncHJvY2Vzc2luZ19wYWdlcycsIHtcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAyMCxcclxuICAgICAgICAgICAgICAgIHRvdGFsOiBwYWdlc1RvUHJvY2Vzcy5sZW5ndGgsXHJcbiAgICAgICAgICAgICAgICBwcm9jZXNzZWQ6IDBcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBhZ2VzVG9Qcm9jZXNzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBwYWdlID0gcGFnZXNUb1Byb2Nlc3NbaV07XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBwcm9jZXNzZWRcclxuICAgICAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLnByb2Nlc3NlZFVybHMuaGFzKHBhZ2UudXJsKSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBQcm9jZXNzIHBhZ2VcclxuICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdwcm9jZXNzaW5nX3BhZ2UnLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDIwICsgTWF0aC5mbG9vcigoaSAvIHBhZ2VzVG9Qcm9jZXNzLmxlbmd0aCkgKiA2MCksXHJcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFBhZ2U6IHBhZ2UudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NlZDogaSxcclxuICAgICAgICAgICAgICAgICAgICB0b3RhbDogcGFnZXNUb1Byb2Nlc3MubGVuZ3RoXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQ29udmVydCBwYWdlIHVzaW5nIHBhcmVudCBVcmxDb252ZXJ0ZXIncyBtZXRob2RzXHJcbiAgICAgICAgICAgICAgICBjb25zdCBwYWdlQ29udGVudCA9IGF3YWl0IHRoaXMucHJvY2Vzc1BhZ2UocGFnZS51cmwsIG9wdGlvbnMsIGJyb3dzZXIsIHRlbXBEaXIpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBBZGQgdG8gcHJvY2Vzc2VkIHBhZ2VzXHJcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLnByb2Nlc3NlZFVybHMuYWRkKHBhZ2UudXJsKTtcclxuICAgICAgICAgICAgICAgIGNvbnZlcnNpb24ucGFnZXMucHVzaCh7XHJcbiAgICAgICAgICAgICAgICAgICAgdXJsOiBwYWdlLnVybCxcclxuICAgICAgICAgICAgICAgICAgICB0aXRsZTogcGFnZS50aXRsZSxcclxuICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBwYWdlQ29udGVudFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duIGZpbGVzIGJhc2VkIG9uIHNhdmUgbW9kZVxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZ2VuZXJhdGluZ19tYXJrZG93bicsIHsgcHJvZ3Jlc3M6IDkwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3Qgc2F2ZU1vZGUgPSBvcHRpb25zLndlYnNpdGVTY3JhcGluZz8uc2F2ZU1vZGUgfHwgJ2NvbWJpbmVkJztcclxuICAgICAgICAgICAgY29uc29sZS5sb2coYFtQYXJlbnRVcmxDb252ZXJ0ZXJdIFVzaW5nIHNhdmUgbW9kZTogJHtzYXZlTW9kZX1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGxldCByZXN1bHQ7XHJcbiAgICAgICAgICAgIGlmIChzYXZlTW9kZSA9PT0gJ3NlcGFyYXRlJykge1xyXG4gICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgc2VwYXJhdGUgZmlsZXNcclxuICAgICAgICAgICAgICAgIHJlc3VsdCA9IGF3YWl0IHRoaXMuZ2VuZXJhdGVTZXBhcmF0ZUZpbGVzKHNpdGVtYXAsIGNvbnZlcnNpb24ucGFnZXMsIG9wdGlvbnMsIHRlbXBEaXIpO1xyXG4gICAgICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICAgICAgLy8gR2VuZXJhdGUgY29tYmluZWQgbWFya2Rvd24gKGRlZmF1bHQgYmVoYXZpb3IpXHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB0aGlzLmdlbmVyYXRlQ29tYmluZWRNYXJrZG93bihzaXRlbWFwLCBjb252ZXJzaW9uLnBhZ2VzLCBvcHRpb25zKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQ2xvc2UgYnJvd3NlclxyXG4gICAgICAgICAgICBhd2FpdCBicm93c2VyLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uYnJvd3NlciA9IG51bGw7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeVxyXG4gICAgICAgICAgICBhd2FpdCBmcy5yZW1vdmUodGVtcERpcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnY29tcGxldGVkJywgeyBcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAxMDAsXHJcbiAgICAgICAgICAgICAgICByZXN1bHQ6IHJlc3VsdFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BhcmVudFVybENvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyIGlmIG9wZW5cclxuICAgICAgICAgICAgaWYgKGJyb3dzZXIpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogTGF1bmNoIGJyb3dzZXIgaW5zdGFuY2VcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHB1cHBldGVlci5Ccm93c2VyPn0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICovXHJcbiAgICBhc3luYyBsYXVuY2hCcm93c2VyKCkge1xyXG4gICAgICAgIGNvbnN0IHB1cHBldGVlciA9IHJlcXVpcmUoJ3B1cHBldGVlcicpO1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgaGVhZGxlc3M6ICduZXcnLFxyXG4gICAgICAgICAgICBhcmdzOiBbJy0tbm8tc2FuZGJveCcsICctLWRpc2FibGUtc2V0dWlkLXNhbmRib3gnXVxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRGlzY292ZXIgc2l0ZW1hcCBmb3IgVVJMXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGRpc2NvdmVyXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIERpc2NvdmVyeSBvcHRpb25zXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBicm93c2VyIC0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gU2l0ZW1hcFxyXG4gICAgICovXHJcbiAgICBhc3luYyBkaXNjb3ZlclNpdGVtYXAodXJsLCBvcHRpb25zLCBicm93c2VyKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgcGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmdvdG8odXJsLCB7IHdhaXRVbnRpbDogJ25ldHdvcmtpZGxlMicsIHRpbWVvdXQ6IDMwMDAwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IGJhc2UgVVJMIGFuZCBkb21haW5cclxuICAgICAgICAgICAgY29uc3QgYmFzZVVybCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gZG9jdW1lbnQuYmFzZVVSSSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZFVybCA9IG5ldyBVUkwoYmFzZVVybCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGRvbWFpbiA9IHBhcnNlZFVybC5ob3N0bmFtZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdldCBzaXRlIG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdGhpcy5mZXRjaE1ldGFkYXRhKHVybCwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBGaW5kIGxpbmtzXHJcbiAgICAgICAgICAgIGNvbnN0IG1heERlcHRoID0gb3B0aW9ucy5tYXhEZXB0aCB8fCAxO1xyXG4gICAgICAgICAgICBjb25zdCBtYXhQYWdlcyA9IG9wdGlvbnMubWF4UGFnZXMgfHwgMTA7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBkaXNjb3ZlcmVkUGFnZXMgPSBuZXcgTWFwKCk7XHJcbiAgICAgICAgICAgIGRpc2NvdmVyZWRQYWdlcy5zZXQodXJsLCB7XHJcbiAgICAgICAgICAgICAgICB1cmwsXHJcbiAgICAgICAgICAgICAgICB0aXRsZTogbWV0YWRhdGEudGl0bGUsXHJcbiAgICAgICAgICAgICAgICBkZXB0aDogMCxcclxuICAgICAgICAgICAgICAgIGxpbmtzOiBbXVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEJyZWFkdGgtZmlyc3Qgc2VhcmNoIGZvciBsaW5rc1xyXG4gICAgICAgICAgICBjb25zdCBxdWV1ZSA9IFt7IHVybCwgZGVwdGg6IDAgfV07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB3aGlsZSAocXVldWUubGVuZ3RoID4gMCAmJiBkaXNjb3ZlcmVkUGFnZXMuc2l6ZSA8IG1heFBhZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB7IHVybDogY3VycmVudFVybCwgZGVwdGggfSA9IHF1ZXVlLnNoaWZ0KCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBhdCBtYXggZGVwdGhcclxuICAgICAgICAgICAgICAgIGlmIChkZXB0aCA+PSBtYXhEZXB0aCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBHZXQgbGlua3MgZnJvbSBwYWdlXHJcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5rcyA9IGF3YWl0IHRoaXMuZ2V0UGFnZUxpbmtzKGN1cnJlbnRVcmwsIGRvbWFpbiwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBjdXJyZW50IHBhZ2UgbGlua3NcclxuICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRQYWdlID0gZGlzY292ZXJlZFBhZ2VzLmdldChjdXJyZW50VXJsKTtcclxuICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGFnZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRQYWdlLmxpbmtzID0gbGlua3M7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEFkZCBuZXcgbGlua3MgdG8gcXVldWVcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgbGluayBvZiBsaW5rcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghZGlzY292ZXJlZFBhZ2VzLmhhcyhsaW5rLnVybCkgJiYgZGlzY292ZXJlZFBhZ2VzLnNpemUgPCBtYXhQYWdlcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBHZXQgcGFnZSB0aXRsZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgdGl0bGUgPSBsaW5rLnRleHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsaW5rUGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbGlua1BhZ2UuZ290byhsaW5rLnVybCwgeyB3YWl0VW50aWw6ICdkb21jb250ZW50bG9hZGVkJywgdGltZW91dDogMTAwMDAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZSA9IGF3YWl0IGxpbmtQYWdlLnRpdGxlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsaW5rUGFnZS5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCB0aXRsZSBmb3IgJHtsaW5rLnVybH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBBZGQgdG8gZGlzY292ZXJlZCBwYWdlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXNjb3ZlcmVkUGFnZXMuc2V0KGxpbmsudXJsLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGxpbmsudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU6IHRpdGxlIHx8IGxpbmsudGV4dCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcHRoOiBkZXB0aCArIDEsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rczogW11cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBBZGQgdG8gcXVldWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgcXVldWUucHVzaCh7IHVybDogbGluay51cmwsIGRlcHRoOiBkZXB0aCArIDEgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBCdWlsZCBzaXRlbWFwXHJcbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXAgPSB7XHJcbiAgICAgICAgICAgICAgICByb290VXJsOiB1cmwsXHJcbiAgICAgICAgICAgICAgICBkb21haW4sXHJcbiAgICAgICAgICAgICAgICB0aXRsZTogbWV0YWRhdGEudGl0bGUsXHJcbiAgICAgICAgICAgICAgICBwYWdlczogQXJyYXkuZnJvbShkaXNjb3ZlcmVkUGFnZXMudmFsdWVzKCkpXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gc2l0ZW1hcDtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUGFyZW50VXJsQ29udmVydGVyXSBGYWlsZWQgdG8gZGlzY292ZXIgc2l0ZW1hcDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBsaW5rcyBmcm9tIHBhZ2VcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gZ2V0IGxpbmtzIGZyb21cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBkb21haW4gLSBEb21haW4gdG8gZmlsdGVyIGxpbmtzXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBicm93c2VyIC0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk+fSBBcnJheSBvZiBsaW5rc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBnZXRQYWdlTGlua3ModXJsLCBkb21haW4sIGJyb3dzZXIpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuZ290byh1cmwsIHsgd2FpdFVudGlsOiAnZG9tY29udGVudGxvYWRlZCcsIHRpbWVvdXQ6IDMwMDAwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBsaW5rc1xyXG4gICAgICAgICAgICBjb25zdCBsaW5rcyA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKGRvbWFpbikgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGlua3MgPSBbXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFuY2hvcnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdhW2hyZWZdJyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBocmVmID0gYW5jaG9yLmhyZWY7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGV4dCA9IGFuY2hvci50ZXh0Q29udGVudC50cmltKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gU2tpcCBlbXB0eSwgaGFzaCwgYW5kIGphdmFzY3JpcHQgbGlua3NcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWhyZWYgfHwgaHJlZi5zdGFydHNXaXRoKCcjJykgfHwgaHJlZi5zdGFydHNXaXRoKCdqYXZhc2NyaXB0OicpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKGhyZWYpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gT25seSBpbmNsdWRlIGxpbmtzIGZyb20gc2FtZSBkb21haW5cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVybC5ob3N0bmFtZSA9PT0gZG9tYWluKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGhyZWYsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogdGV4dCB8fCBocmVmXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFNraXAgaW52YWxpZCBVUkxzXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbGlua3M7XHJcbiAgICAgICAgICAgIH0sIGRvbWFpbik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZW1vdmUgZHVwbGljYXRlc1xyXG4gICAgICAgICAgICBjb25zdCB1bmlxdWVMaW5rcyA9IFtdO1xyXG4gICAgICAgICAgICBjb25zdCBzZWVuVXJscyA9IG5ldyBTZXQoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGluayBvZiBsaW5rcykge1xyXG4gICAgICAgICAgICAgICAgLy8gTm9ybWFsaXplIFVSTCBieSByZW1vdmluZyB0cmFpbGluZyBzbGFzaCBhbmQgaGFzaFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFVybCA9IGxpbmsudXJsLnJlcGxhY2UoLyMuKiQvLCAnJykucmVwbGFjZSgvXFwvJC8sICcnKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCFzZWVuVXJscy5oYXMobm9ybWFsaXplZFVybCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBzZWVuVXJscy5hZGQobm9ybWFsaXplZFVybCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdW5pcXVlTGlua3MucHVzaChsaW5rKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHVuaXF1ZUxpbmtzO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBnZXQgbGlua3MgZnJvbSAke3VybH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyBhIHNpbmdsZSBwYWdlXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIHByb2Nlc3NcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gUHJvY2Vzc2luZyBvcHRpb25zXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBicm93c2VyIC0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHRlbXBEaXIgLSBUZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NQYWdlKHVybCwgb3B0aW9ucywgYnJvd3NlciwgdGVtcERpcikge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgY29udGVudFxyXG4gICAgICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5leHRyYWN0Q29udGVudCh1cmwsIG9wdGlvbnMsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUHJvY2VzcyBpbWFnZXMgaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVJbWFnZXMpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucHJvY2Vzc0ltYWdlcyhjb250ZW50LCB0ZW1wRGlyLCB1cmwsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDYXB0dXJlIHNjcmVlbnNob3QgaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgIGxldCBzY3JlZW5zaG90ID0gbnVsbDtcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZVNjcmVlbnNob3QpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3RQYXRoID0gcGF0aC5qb2luKHRlbXBEaXIsIGBzY3JlZW5zaG90XyR7RGF0ZS5ub3coKX0ucG5nYCk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVTY3JlZW5zaG90KHVybCwgc2NyZWVuc2hvdFBhdGgsIG9wdGlvbnMsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBSZWFkIHNjcmVlbnNob3QgYXMgYmFzZTY0XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzY3JlZW5zaG90RGF0YSA9IGF3YWl0IGZzLnJlYWRGaWxlKHNjcmVlbnNob3RQYXRoLCB7IGVuY29kaW5nOiAnYmFzZTY0JyB9KTtcclxuICAgICAgICAgICAgICAgIHNjcmVlbnNob3QgPSBgZGF0YTppbWFnZS9wbmc7YmFzZTY0LCR7c2NyZWVuc2hvdERhdGF9YDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdGhpcy5mZXRjaE1ldGFkYXRhKHVybCwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93blxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCBjb250ZW50LCBzY3JlZW5zaG90LCBvcHRpb25zKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUGFyZW50VXJsQ29udmVydGVyXSBGYWlsZWQgdG8gcHJvY2VzcyBwYWdlICR7dXJsfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHJldHVybiBgIyBFcnJvciBQcm9jZXNzaW5nIFBhZ2U6ICR7dXJsfVxcblxcbkZhaWxlZCB0byBwcm9jZXNzIHRoaXMgcGFnZTogJHtlcnJvci5tZXNzYWdlfWA7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgc2VwYXJhdGUgbWFya2Rvd24gZmlsZXMgZm9yIGVhY2ggcGFnZVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHNpdGVtYXAgLSBTaXRlbWFwXHJcbiAgICAgKiBAcGFyYW0ge0FycmF5fSBwYWdlcyAtIFByb2Nlc3NlZCBwYWdlc1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB0ZW1wRGlyIC0gVGVtcG9yYXJ5IGRpcmVjdG9yeSBmb3IgZmlsZSBvcGVyYXRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBSZXN1bHQgd2l0aCBtdWx0aXBsZSBmaWxlcyBpbmZvcm1hdGlvblxyXG4gICAgICovXHJcbiAgICBhc3luYyBnZW5lcmF0ZVNlcGFyYXRlRmlsZXMoc2l0ZW1hcCwgcGFnZXMsIG9wdGlvbnMsIHRlbXBEaXIpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1BhcmVudFVybENvbnZlcnRlcl0gR2VuZXJhdGluZyAke3BhZ2VzLmxlbmd0aH0gc2VwYXJhdGUgZmlsZXNgKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IG91dHB1dERpciA9IG9wdGlvbnMub3V0cHV0RGlyO1xyXG4gICAgICAgICAgICBjb25zdCBzaXRlRG9tYWluID0gbmV3IFVSTChzaXRlbWFwLnJvb3RVcmwpLmhvc3RuYW1lO1xyXG4gICAgICAgICAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgvWzouXS9nLCAnLScpO1xyXG4gICAgICAgICAgICBjb25zdCBiYXNlTmFtZSA9IGAke3NpdGVEb21haW59XyR7dGltZXN0YW1wfWA7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDcmVhdGUgYSBzdWJkaXJlY3RvcnkgZm9yIHRoZSB3ZWJzaXRlIGZpbGVzXHJcbiAgICAgICAgICAgIGNvbnN0IHdlYnNpdGVEaXIgPSBwYXRoLmpvaW4ob3V0cHV0RGlyLCBiYXNlTmFtZSk7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLmVuc3VyZURpcih3ZWJzaXRlRGlyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZEZpbGVzID0gW107XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBpbmRpdmlkdWFsIHBhZ2UgZmlsZXNcclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYWdlcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFnZSA9IHBhZ2VzW2ldO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDcmVhdGUgYSBzYWZlIGZpbGVuYW1lIGZyb20gdGhlIHBhZ2UgdGl0bGUgb3IgVVJMXHJcbiAgICAgICAgICAgICAgICBsZXQgZmlsZW5hbWUgPSBwYWdlLnRpdGxlIHx8IG5ldyBVUkwocGFnZS51cmwpLnBhdGhuYW1lO1xyXG4gICAgICAgICAgICAgICAgZmlsZW5hbWUgPSBmaWxlbmFtZS5yZXBsYWNlKC9bXmEtekEtWjAtOVxcLV9dL2csICdfJyk7XHJcbiAgICAgICAgICAgICAgICBmaWxlbmFtZSA9IGZpbGVuYW1lLnJlcGxhY2UoL18rL2csICdfJykucmVwbGFjZSgvXl98XyQvZywgJycpO1xyXG4gICAgICAgICAgICAgICAgZmlsZW5hbWUgPSBmaWxlbmFtZSB8fCBgcGFnZV8ke2kgKyAxfWA7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBmaWxlbmFtZSBpcyBub3QgdG9vIGxvbmdcclxuICAgICAgICAgICAgICAgIGlmIChmaWxlbmFtZS5sZW5ndGggPiA1MCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVuYW1lID0gZmlsZW5hbWUuc3Vic3RyaW5nKDAsIDUwKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZXBhdGggPSBwYXRoLmpvaW4od2Vic2l0ZURpciwgYCR7ZmlsZW5hbWV9Lm1kYCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duIGZvciB0aGlzIHBhZ2VcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VNYXJrZG93biA9IHRoaXMuZ2VuZXJhdGVTaW5nbGVQYWdlTWFya2Rvd24ocGFnZSwgc2l0ZW1hcCwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFdyaXRlIGZpbGVcclxuICAgICAgICAgICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlcGF0aCwgcGFnZU1hcmtkb3duLCAndXRmOCcpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRGaWxlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB0aXRsZTogcGFnZS50aXRsZSxcclxuICAgICAgICAgICAgICAgICAgICB1cmw6IHBhZ2UudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVuYW1lOiBgJHtmaWxlbmFtZX0ubWRgLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVwYXRoOiBmaWxlcGF0aFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbUGFyZW50VXJsQ29udmVydGVyXSBHZW5lcmF0ZWQgZmlsZTogJHtmaWxlbmFtZX0ubWRgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgYW4gaW5kZXggZmlsZSB3aXRoIGxpbmtzIHRvIGFsbCBwYWdlc1xyXG4gICAgICAgICAgICBjb25zdCBpbmRleE1hcmtkb3duID0gdGhpcy5nZW5lcmF0ZUluZGV4TWFya2Rvd24oc2l0ZW1hcCwgZ2VuZXJhdGVkRmlsZXMsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBjb25zdCBpbmRleFBhdGggPSBwYXRoLmpvaW4od2Vic2l0ZURpciwgJ2luZGV4Lm1kJyk7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShpbmRleFBhdGgsIGluZGV4TWFya2Rvd24sICd1dGY4Jyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1BhcmVudFVybENvbnZlcnRlcl0gR2VuZXJhdGVkIGluZGV4IGZpbGU6IGluZGV4Lm1kYCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZXR1cm4gaW5mb3JtYXRpb24gYWJvdXQgdGhlIGdlbmVyYXRlZCBmaWxlc1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgdHlwZTogJ211bHRpcGxlX2ZpbGVzJyxcclxuICAgICAgICAgICAgICAgIG91dHB1dERpcmVjdG9yeTogd2Vic2l0ZURpcixcclxuICAgICAgICAgICAgICAgIGluZGV4RmlsZTogaW5kZXhQYXRoLFxyXG4gICAgICAgICAgICAgICAgZmlsZXM6IGdlbmVyYXRlZEZpbGVzLFxyXG4gICAgICAgICAgICAgICAgdG90YWxGaWxlczogZ2VuZXJhdGVkRmlsZXMubGVuZ3RoICsgMSwgLy8gKzEgZm9yIGluZGV4XHJcbiAgICAgICAgICAgICAgICBzdW1tYXJ5OiBgR2VuZXJhdGVkICR7Z2VuZXJhdGVkRmlsZXMubGVuZ3RofSBwYWdlIGZpbGVzICsgMSBpbmRleCBmaWxlIGluICR7YmFzZU5hbWV9L2BcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUGFyZW50VXJsQ29udmVydGVyXSBFcnJvciBnZW5lcmF0aW5nIHNlcGFyYXRlIGZpbGVzOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZm9yIGEgc2luZ2xlIHBhZ2VcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwYWdlIC0gUGFnZSBkYXRhXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gc2l0ZW1hcCAtIFNpdGVtYXAgaW5mb3JtYXRpb25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBTaW5nbGUgcGFnZSBtYXJrZG93blxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZVNpbmdsZVBhZ2VNYXJrZG93bihwYWdlLCBzaXRlbWFwLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgcGFnZSB0aXRsZVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHtwYWdlLnRpdGxlIHx8IHBhZ2UudXJsfWApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBwYWdlIG1ldGFkYXRhXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgUGFnZSBJbmZvcm1hdGlvbicpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ3wgUHJvcGVydHkgfCBWYWx1ZSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCAtLS0gfCAtLS0gfCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgVVJMIHwgWyR7cGFnZS51cmx9XSgke3BhZ2UudXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgVGl0bGUgfCAke3BhZ2UudGl0bGUgfHwgJ04vQSd9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFNpdGUgfCBbJHtzaXRlbWFwLmRvbWFpbn1dKCR7c2l0ZW1hcC5yb290VXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgR2VuZXJhdGVkIHwgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgY29udGVudFxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIENvbnRlbnQnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKHBhZ2UuY29udGVudCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgaW5kZXggbWFya2Rvd24gd2l0aCBsaW5rcyB0byBhbGwgcGFnZXNcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBzaXRlbWFwIC0gU2l0ZW1hcCBpbmZvcm1hdGlvblxyXG4gICAgICogQHBhcmFtIHtBcnJheX0gZmlsZXMgLSBHZW5lcmF0ZWQgZmlsZXMgaW5mb3JtYXRpb25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBJbmRleCBtYXJrZG93blxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZUluZGV4TWFya2Rvd24oc2l0ZW1hcCwgZmlsZXMsIG9wdGlvbnMpIHtcclxuICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCB0aXRsZVxyXG4gICAgICAgIGlmIChvcHRpb25zLnRpdGxlKSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHtvcHRpb25zLnRpdGxlfWApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHtzaXRlbWFwLnRpdGxlIHx8ICdXZWJzaXRlIENvbnZlcnNpb24nfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgc2l0ZSBpbmZvcm1hdGlvblxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIFNpdGUgSW5mb3JtYXRpb24nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IFByb3BlcnR5IHwgVmFsdWUgfCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFJvb3QgVVJMIHwgWyR7c2l0ZW1hcC5yb290VXJsfV0oJHtzaXRlbWFwLnJvb3RVcmx9KSB8YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBEb21haW4gfCAke3NpdGVtYXAuZG9tYWlufSB8YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBQYWdlcyBQcm9jZXNzZWQgfCAke2ZpbGVzLmxlbmd0aH0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgR2VuZXJhdGVkIHwgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9IHxgKTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgbGlzdCBvZiBnZW5lcmF0ZWQgZmlsZXNcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBHZW5lcmF0ZWQgRmlsZXMnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICBmaWxlcy5mb3JFYWNoKChmaWxlLCBpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAke2luZGV4ICsgMX0uIFske2ZpbGUudGl0bGUgfHwgZmlsZS51cmx9XSguLyR7ZmlsZS5maWxlbmFtZX0pYCk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgIC0gVVJMOiAke2ZpbGUudXJsfWApO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAgICAtIEZpbGU6ICR7ZmlsZS5maWxlbmFtZX1gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHNpdGVtYXAgdmlzdWFsaXphdGlvbiBpZiByZXF1ZXN0ZWRcclxuICAgICAgICBpZiAob3B0aW9ucy5pbmNsdWRlU2l0ZW1hcCkge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBTaXRlIFN0cnVjdHVyZScpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnYGBgbWVybWFpZCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCdncmFwaCBURCcpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIHJvb3Qgbm9kZVxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAgIHJvb3RbXCIke3NpdGVtYXAudGl0bGUgfHwgc2l0ZW1hcC5yb290VXJsfVwiXWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIHBhZ2Ugbm9kZXMgYW5kIGxpbmtzXHJcbiAgICAgICAgICAgIHNpdGVtYXAucGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChwYWdlLnVybCAhPT0gc2l0ZW1hcC5yb290VXJsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICBwYWdlJHtpbmRleH1bXCIke3BhZ2UudGl0bGUgfHwgcGFnZS51cmx9XCJdYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCBwYXJlbnQgcGFnZVxyXG4gICAgICAgICAgICAgICAgICAgIGxldCBwYXJlbnRGb3VuZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcG90ZW50aWFsUGFyZW50IG9mIHNpdGVtYXAucGFnZXMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBvdGVudGlhbFBhcmVudC5saW5rcy5zb21lKGxpbmsgPT4gbGluay51cmwgPT09IHBhZ2UudXJsKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFyZW50SW5kZXggPSBzaXRlbWFwLnBhZ2VzLmZpbmRJbmRleChwID0+IHAudXJsID09PSBwb3RlbnRpYWxQYXJlbnQudXJsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwb3RlbnRpYWxQYXJlbnQudXJsID09PSBzaXRlbWFwLnJvb3RVcmwpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAgIHJvb3QgLS0+IHBhZ2Uke2luZGV4fWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAgIHBhZ2Uke3BhcmVudEluZGV4fSAtLT4gcGFnZSR7aW5kZXh9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnRGb3VuZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBJZiBubyBwYXJlbnQgZm91bmQsIGNvbm5lY3QgdG8gcm9vdFxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcGFyZW50Rm91bmQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290IC0tPiBwYWdlJHtpbmRleH1gKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnYGBgJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbWFya2Rvd24uam9pbignXFxuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBjb21iaW5lZCBtYXJrZG93biBmcm9tIG11bHRpcGxlIHBhZ2VzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gc2l0ZW1hcCAtIFNpdGVtYXBcclxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHBhZ2VzIC0gUHJvY2Vzc2VkIHBhZ2VzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gQ29tYmluZWQgbWFya2Rvd25cclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVDb21iaW5lZE1hcmtkb3duKHNpdGVtYXAsIHBhZ2VzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdGl0bGVcclxuICAgICAgICBpZiAob3B0aW9ucy50aXRsZSkge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7b3B0aW9ucy50aXRsZX1gKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7c2l0ZW1hcC50aXRsZSB8fCAnV2Vic2l0ZSBDb252ZXJzaW9uJ31gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHNpdGUgaW5mb3JtYXRpb25cclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBTaXRlIEluZm9ybWF0aW9uJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBSb290IFVSTCB8IFske3NpdGVtYXAucm9vdFVybH1dKCR7c2l0ZW1hcC5yb290VXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRG9tYWluIHwgJHtzaXRlbWFwLmRvbWFpbn0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUGFnZXMgUHJvY2Vzc2VkIHwgJHtwYWdlcy5sZW5ndGh9IHxgKTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdGFibGUgb2YgY29udGVudHNcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBUYWJsZSBvZiBDb250ZW50cycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCR7aW5kZXggKyAxfS4gWyR7cGFnZS50aXRsZSB8fCBwYWdlLnVybH1dKCNwYWdlLSR7aW5kZXggKyAxfSlgKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgZWFjaCBwYWdlXHJcbiAgICAgICAgcGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgPGEgaWQ9XCJwYWdlLSR7aW5kZXggKyAxfVwiPjwvYT5gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyMgUGFnZSAke2luZGV4ICsgMX06ICR7cGFnZS50aXRsZSB8fCBwYWdlLnVybH1gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYFVSTDogWyR7cGFnZS51cmx9XSgke3BhZ2UudXJsfSlgKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJy0tLScpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChwYWdlLmNvbnRlbnQpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnLS0tJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBzaXRlbWFwIHZpc3VhbGl6YXRpb24gaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZVNpdGVtYXApIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgU2l0ZSBTdHJ1Y3R1cmUnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ2BgYG1lcm1haWQnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnZ3JhcGggVEQnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCByb290IG5vZGVcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290W1wiJHtzaXRlbWFwLnRpdGxlIHx8IHNpdGVtYXAucm9vdFVybH1cIl1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCBwYWdlIG5vZGVzIGFuZCBsaW5rc1xyXG4gICAgICAgICAgICBzaXRlbWFwLnBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocGFnZS51cmwgIT09IHNpdGVtYXAucm9vdFVybCkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgcGFnZSR7aW5kZXh9W1wiJHtwYWdlLnRpdGxlIHx8IHBhZ2UudXJsfVwiXWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgcGFyZW50IHBhZ2VcclxuICAgICAgICAgICAgICAgICAgICBsZXQgcGFyZW50Rm91bmQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBvdGVudGlhbFBhcmVudCBvZiBzaXRlbWFwLnBhZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwb3RlbnRpYWxQYXJlbnQubGlua3Muc29tZShsaW5rID0+IGxpbmsudXJsID09PSBwYWdlLnVybCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmVudEluZGV4ID0gc2l0ZW1hcC5wYWdlcy5maW5kSW5kZXgocCA9PiBwLnVybCA9PT0gcG90ZW50aWFsUGFyZW50LnVybCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocG90ZW50aWFsUGFyZW50LnVybCA9PT0gc2l0ZW1hcC5yb290VXJsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290IC0tPiBwYWdlJHtpbmRleH1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICBwYWdlJHtwYXJlbnRJbmRleH0gLS0+IHBhZ2Uke2luZGV4fWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50Rm91bmQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgbm8gcGFyZW50IGZvdW5kLCBjb25uZWN0IHRvIHJvb3RcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXBhcmVudEZvdW5kKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgcm9vdCAtLT4gcGFnZSR7aW5kZXh9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ2BgYCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2V0IGNvbnZlcnRlciBpbmZvcm1hdGlvblxyXG4gICAgICogQHJldHVybnMge09iamVjdH0gQ29udmVydGVyIGRldGFpbHNcclxuICAgICAqL1xyXG4gICAgZ2V0SW5mbygpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBuYW1lOiB0aGlzLm5hbWUsXHJcbiAgICAgICAgICAgIHByb3RvY29sczogdGhpcy5zdXBwb3J0ZWRQcm90b2NvbHMsXHJcbiAgICAgICAgICAgIGRlc2NyaXB0aW9uOiB0aGlzLmRlc2NyaXB0aW9uLFxyXG4gICAgICAgICAgICBvcHRpb25zOiB7XHJcbiAgICAgICAgICAgICAgICB0aXRsZTogJ09wdGlvbmFsIHNpdGUgdGl0bGUnLFxyXG4gICAgICAgICAgICAgICAgbWF4RGVwdGg6ICdNYXhpbXVtIGNyYXdsIGRlcHRoIChkZWZhdWx0OiAxKScsXHJcbiAgICAgICAgICAgICAgICBtYXhQYWdlczogJ01heGltdW0gcGFnZXMgdG8gcHJvY2VzcyAoZGVmYXVsdDogMTApJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVTY3JlZW5zaG90OiAnV2hldGhlciB0byBpbmNsdWRlIHBhZ2Ugc2NyZWVuc2hvdHMgKGRlZmF1bHQ6IGZhbHNlKScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlSW1hZ2VzOiAnV2hldGhlciB0byBpbmNsdWRlIGltYWdlcyAoZGVmYXVsdDogdHJ1ZSknLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUxpbmtzOiAnV2hldGhlciB0byBpbmNsdWRlIGxpbmtzIHNlY3Rpb24gKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVTaXRlbWFwOiAnV2hldGhlciB0byBpbmNsdWRlIHNpdGUgc3RydWN0dXJlIHZpc3VhbGl6YXRpb24gKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIHdhaXRUaW1lOiAnQWRkaXRpb25hbCB0aW1lIHRvIHdhaXQgZm9yIHBhZ2UgbG9hZCBpbiBtcydcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH07XHJcbiAgICB9XHJcbn1cclxuXHJcbm1vZHVsZS5leHBvcnRzID0gUGFyZW50VXJsQ29udmVydGVyO1xyXG4iXSwibWFwcGluZ3MiOiI7O0FBQUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNB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QUFDcUUsSUFBSSxDQUFDL0QsSUFBSSxJQUFJQSxJQUFJLENBQUN6RixHQUFHLEtBQUs4QyxJQUFJLENBQUM5QyxHQUFHLENBQUMsRUFBRTtjQUMzRCxNQUFNeUosV0FBVyxHQUFHdkgsT0FBTyxDQUFDYixLQUFLLENBQUNxSSxTQUFTLENBQUNDLENBQUMsSUFBSUEsQ0FBQyxDQUFDM0osR0FBRyxLQUFLdUosZUFBZSxDQUFDdkosR0FBRyxDQUFDO2NBQy9FLElBQUl1SixlQUFlLENBQUN2SixHQUFHLEtBQUtrQyxPQUFPLENBQUMwRCxPQUFPLEVBQUU7Z0JBQ3pDcUQsUUFBUSxDQUFDM0YsSUFBSSxDQUFDLGtCQUFrQjhGLEtBQUssRUFBRSxDQUFDO2NBQzVDLENBQUMsTUFBTTtnQkFDSEgsUUFBUSxDQUFDM0YsSUFBSSxDQUFDLFNBQVNtRyxXQUFXLFlBQVlMLEtBQUssRUFBRSxDQUFDO2NBQzFEO2NBQ0FFLFdBQVcsR0FBRyxJQUFJO2NBQ2xCO1lBQ0o7VUFDSjs7VUFFQTtVQUNBLElBQUksQ0FBQ0EsV0FBVyxFQUFFO1lBQ2RMLFFBQVEsQ0FBQzNGLElBQUksQ0FBQyxrQkFBa0I4RixLQUFLLEVBQUUsQ0FBQztVQUM1QztRQUNKO01BQ0osQ0FBQyxDQUFDO01BRUZILFFBQVEsQ0FBQzNGLElBQUksQ0FBQyxLQUFLLENBQUM7TUFDcEIyRixRQUFRLENBQUMzRixJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ3JCO0lBRUEsT0FBTzJGLFFBQVEsQ0FBQ2hDLElBQUksQ0FBQyxJQUFJLENBQUM7RUFDOUI7O0VBRUE7QUFDSjtBQUNBO0FBQ0E7RUFDSTJDLE9BQU9BLENBQUEsRUFBRztJQUNOLE9BQU87TUFDSHJLLElBQUksRUFBRSxJQUFJLENBQUNBLElBQUk7TUFDZnNLLFNBQVMsRUFBRSxJQUFJLENBQUMxSixrQkFBa0I7TUFDbENYLFdBQVcsRUFBRSxJQUFJLENBQUNBLFdBQVc7TUFDN0JTLE9BQU8sRUFBRTtRQUNMc0QsS0FBSyxFQUFFLHFCQUFxQjtRQUM1QndCLFFBQVEsRUFBRSxrQ0FBa0M7UUFDNUN4QyxRQUFRLEVBQUUsd0NBQXdDO1FBQ2xEd0UsaUJBQWlCLEVBQUUsc0RBQXNEO1FBQ3pFSCxhQUFhLEVBQUUsMkNBQTJDO1FBQzFEa0QsWUFBWSxFQUFFLGtEQUFrRDtRQUNoRVQsY0FBYyxFQUFFLGlFQUFpRTtRQUNqRlUsUUFBUSxFQUFFO01BQ2Q7SUFDSixDQUFDO0VBQ0w7QUFDSjtBQUVBQyxNQUFNLENBQUNDLE9BQU8sR0FBRzlLLGtCQUFrQiIsImlnbm9yZUxpc3QiOltdfQ==