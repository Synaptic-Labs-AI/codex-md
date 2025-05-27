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
      const conversion = {
        id: conversionId,
        status: 'starting',
        progress: 0,
        url,
        tempDir,
        window,
        processedUrls: new Set(),
        pages: []
      };
      this.activeConversions.set(conversionId, conversion);

      // Register with global converter registry if available
      if (global.converterRegistry && typeof global.converterRegistry.registerConversion === 'function') {
        global.converterRegistry.registerConversion(conversionId, conversion);
      }

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
        conversionId,
        async: true,
        success: true
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
   * Handle conversion cancellation request with partial results
   * @param {Electron.IpcMainInvokeEvent} event - IPC event
   * @param {Object} request - Cancellation request details
   */
  async handleCancel(event, {
    conversionId
  }) {
    const conversion = this.activeConversions.get(conversionId);
    if (conversion) {
      // Mark as cancelled - the processConversion loop will check this
      conversion.status = 'cancelled';
      if (conversion.window) {
        conversion.window.webContents.send('parent-url:conversion-cancelling', {
          conversionId,
          message: 'Cancelling conversion, preparing partial results...'
        });
      }

      // Don't immediately close browser or clean up - let processConversion handle it
      // This allows partial results to be saved

      return {
        success: true,
        conversionId
      };
    }
    return {
      success: false,
      error: 'Conversion not found'
    };
  }

  /**
   * Process parent URL conversion
   * @param {string} conversionId - Conversion identifier
   * @param {string} url - URL to convert
   * @param {Object} options - Conversion options
   */
  async processConversion(conversionId, url, options) {
    let browser = null;
    const startTime = Date.now();
    try {
      const conversion = this.activeConversions.get(conversionId);
      if (!conversion) {
        throw new Error('Conversion not found');
      }
      const tempDir = conversion.tempDir;

      // Launch browser
      this.updateConversionStatus(conversionId, 'launching_browser', {
        progress: 5,
        websiteData: {
          totalDiscovered: 0,
          processing: 0,
          completed: 0,
          currentPage: null,
          estimatedTimeRemaining: null,
          processingRate: 0
        }
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

      // Send initial page discovery event
      this.updateConversionStatus(conversionId, 'pages_discovered', {
        progress: 20,
        websiteData: {
          totalDiscovered: pagesToProcess.length,
          processing: 0,
          completed: 0,
          currentPage: null,
          estimatedTimeRemaining: null,
          processingRate: 0
        }
      });
      const processedPages = [];
      let lastUpdateTime = Date.now();
      for (let i = 0; i < pagesToProcess.length; i++) {
        // Check if conversion was cancelled
        if (conversion.status === 'cancelled') {
          console.log('[ParentUrlConverter] Conversion cancelled, returning partial results');
          break;
        }
        const page = pagesToProcess[i];

        // Skip if already processed
        if (conversion.processedUrls.has(page.url)) {
          continue;
        }

        // Calculate progress and processing rate
        const currentTime = Date.now();
        const elapsedSeconds = (currentTime - startTime) / 1000;
        const processingRate = processedPages.length / elapsedSeconds;
        const remainingPages = pagesToProcess.length - processedPages.length;
        const estimatedTimeRemaining = processingRate > 0 ? remainingPages / processingRate : null;

        // Update status with detailed progress
        this.updateConversionStatus(conversionId, 'processing_page', {
          progress: 20 + Math.floor(processedPages.length / pagesToProcess.length * 60),
          websiteData: {
            totalDiscovered: pagesToProcess.length,
            processing: 1,
            completed: processedPages.length,
            currentPage: {
              url: page.url,
              title: page.title || 'Processing...',
              index: i + 1
            },
            estimatedTimeRemaining: Math.round(estimatedTimeRemaining),
            processingRate: Math.round(processingRate * 10) / 10
          }
        });
        try {
          // Convert page using parent UrlConverter's methods
          const pageContent = await this.processPage(page.url, options, browser, tempDir);

          // Add to processed pages
          conversion.processedUrls.add(page.url);
          const processedPage = {
            url: page.url,
            title: page.title,
            content: pageContent
          };
          conversion.pages.push(processedPage);
          processedPages.push(processedPage);

          // Update completed count
          this.updateConversionStatus(conversionId, 'page_completed', {
            progress: 20 + Math.floor((i + 1) / pagesToProcess.length * 60),
            websiteData: {
              totalDiscovered: pagesToProcess.length,
              processing: 0,
              completed: processedPages.length,
              currentPage: null,
              estimatedTimeRemaining: Math.round(estimatedTimeRemaining),
              processingRate: Math.round(processingRate * 10) / 10
            }
          });
        } catch (pageError) {
          console.error(`[ParentUrlConverter] Failed to process page ${page.url}:`, pageError);
          // Continue with next page even if one fails
        }
      }

      // Generate markdown files based on save mode
      this.updateConversionStatus(conversionId, 'generating_markdown', {
        progress: 90,
        websiteData: {
          totalDiscovered: pagesToProcess.length,
          processing: 0,
          completed: processedPages.length,
          currentPage: null,
          estimatedTimeRemaining: 0,
          processingRate: 0
        }
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

      // Add metadata about partial conversion if cancelled
      if (conversion.status === 'cancelled' && processedPages.length < pagesToProcess.length) {
        result = typeof result === 'string' ? `> ⚠️ **Note**: This conversion was cancelled. Only ${processedPages.length} of ${pagesToProcess.length} pages were processed.\n\n${result}` : {
          ...result,
          partialConversion: true,
          pagesProcessed: processedPages.length,
          totalPages: pagesToProcess.length
        };
      }

      // Close browser
      await browser.close();
      conversion.browser = null;

      // Clean up temp directory
      await fs.remove(tempDir);
      this.updateConversionStatus(conversionId, 'completed', {
        progress: 100,
        result: result,
        websiteData: {
          totalDiscovered: pagesToProcess.length,
          processing: 0,
          completed: processedPages.length,
          currentPage: null,
          estimatedTimeRemaining: 0,
          processingRate: 0
        }
      });

      // Clean up the active conversion
      this.activeConversions.delete(conversionId);
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

      // Update in global registry if available
      if (global.converterRegistry && typeof global.converterRegistry.pingConversion === 'function') {
        global.converterRegistry.pingConversion(conversionId, {
          status,
          ...details
        });
      }
      if (conversion.window && conversion.window.webContents) {
        conversion.window.webContents.send('parent-url:conversion-progress', {
          conversionId,
          status,
          ...details
        });
      }
    }
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJuYW1lcyI6WyJwYXRoIiwicmVxdWlyZSIsImZzIiwiVVJMIiwiVXJsQ29udmVydGVyIiwiUGFyZW50VXJsQ29udmVydGVyIiwiY29uc3RydWN0b3IiLCJmaWxlUHJvY2Vzc29yIiwiZmlsZVN0b3JhZ2UiLCJuYW1lIiwiZGVzY3JpcHRpb24iLCJzZXR1cElwY0hhbmRsZXJzIiwicmVnaXN0ZXJIYW5kbGVyIiwiaGFuZGxlQ29udmVydCIsImJpbmQiLCJoYW5kbGVHZXRTaXRlbWFwIiwiaGFuZGxlQ2FuY2VsIiwiZXZlbnQiLCJ1cmwiLCJvcHRpb25zIiwicGFyc2VkVXJsIiwic3VwcG9ydGVkUHJvdG9jb2xzIiwiaW5jbHVkZXMiLCJwcm90b2NvbCIsIkVycm9yIiwiY29udmVyc2lvbklkIiwiZ2VuZXJhdGVDb252ZXJzaW9uSWQiLCJ3aW5kb3ciLCJzZW5kZXIiLCJnZXRPd25lckJyb3dzZXJXaW5kb3ciLCJ0ZW1wRGlyIiwiY3JlYXRlVGVtcERpciIsImNvbnZlcnNpb24iLCJpZCIsInN0YXR1cyIsInByb2dyZXNzIiwicHJvY2Vzc2VkVXJscyIsIlNldCIsInBhZ2VzIiwiYWN0aXZlQ29udmVyc2lvbnMiLCJzZXQiLCJnbG9iYWwiLCJjb252ZXJ0ZXJSZWdpc3RyeSIsInJlZ2lzdGVyQ29udmVyc2lvbiIsIndlYkNvbnRlbnRzIiwic2VuZCIsInByb2Nlc3NDb252ZXJzaW9uIiwiY2F0Y2giLCJlcnJvciIsImNvbnNvbGUiLCJ1cGRhdGVDb252ZXJzaW9uU3RhdHVzIiwibWVzc2FnZSIsInJlbW92ZSIsImVyciIsImFzeW5jIiwic3VjY2VzcyIsImJyb3dzZXIiLCJsYXVuY2hCcm93c2VyIiwic2l0ZW1hcCIsImRpc2NvdmVyU2l0ZW1hcCIsImNsb3NlIiwiZ2V0Iiwic3RhcnRUaW1lIiwiRGF0ZSIsIm5vdyIsIndlYnNpdGVEYXRhIiwidG90YWxEaXNjb3ZlcmVkIiwicHJvY2Vzc2luZyIsImNvbXBsZXRlZCIsImN1cnJlbnRQYWdlIiwiZXN0aW1hdGVkVGltZVJlbWFpbmluZyIsInByb2Nlc3NpbmdSYXRlIiwibWF4UGFnZXMiLCJsZW5ndGgiLCJwYWdlc1RvUHJvY2VzcyIsInNsaWNlIiwicHJvY2Vzc2VkUGFnZXMiLCJsYXN0VXBkYXRlVGltZSIsImkiLCJsb2ciLCJwYWdlIiwiaGFzIiwiY3VycmVudFRpbWUiLCJlbGFwc2VkU2Vjb25kcyIsInJlbWFpbmluZ1BhZ2VzIiwiTWF0aCIsImZsb29yIiwidGl0bGUiLCJpbmRleCIsInJvdW5kIiwicGFnZUNvbnRlbnQiLCJwcm9jZXNzUGFnZSIsImFkZCIsInByb2Nlc3NlZFBhZ2UiLCJjb250ZW50IiwicHVzaCIsInBhZ2VFcnJvciIsInNhdmVNb2RlIiwid2Vic2l0ZVNjcmFwaW5nIiwicmVzdWx0IiwiZ2VuZXJhdGVTZXBhcmF0ZUZpbGVzIiwiZ2VuZXJhdGVDb21iaW5lZE1hcmtkb3duIiwicGFydGlhbENvbnZlcnNpb24iLCJwYWdlc1Byb2Nlc3NlZCIsInRvdGFsUGFnZXMiLCJkZWxldGUiLCJwdXBwZXRlZXIiLCJsYXVuY2giLCJoZWFkbGVzcyIsImFyZ3MiLCJuZXdQYWdlIiwiZ290byIsIndhaXRVbnRpbCIsInRpbWVvdXQiLCJiYXNlVXJsIiwiZXZhbHVhdGUiLCJkb2N1bWVudCIsImJhc2VVUkkiLCJkb21haW4iLCJob3N0bmFtZSIsIm1ldGFkYXRhIiwiZmV0Y2hNZXRhZGF0YSIsIm1heERlcHRoIiwiZGlzY292ZXJlZFBhZ2VzIiwiTWFwIiwiZGVwdGgiLCJsaW5rcyIsInF1ZXVlIiwic2l6ZSIsImN1cnJlbnRVcmwiLCJzaGlmdCIsImdldFBhZ2VMaW5rcyIsImxpbmsiLCJ0ZXh0IiwibGlua1BhZ2UiLCJyb290VXJsIiwiQXJyYXkiLCJmcm9tIiwidmFsdWVzIiwiYW5jaG9ycyIsInF1ZXJ5U2VsZWN0b3JBbGwiLCJhbmNob3IiLCJocmVmIiwidGV4dENvbnRlbnQiLCJ0cmltIiwic3RhcnRzV2l0aCIsInVuaXF1ZUxpbmtzIiwic2VlblVybHMiLCJub3JtYWxpemVkVXJsIiwicmVwbGFjZSIsImV4dHJhY3RDb250ZW50IiwiaW5jbHVkZUltYWdlcyIsInByb2Nlc3NJbWFnZXMiLCJzY3JlZW5zaG90IiwiaW5jbHVkZVNjcmVlbnNob3QiLCJzY3JlZW5zaG90UGF0aCIsImpvaW4iLCJjYXB0dXJlU2NyZWVuc2hvdCIsInNjcmVlbnNob3REYXRhIiwicmVhZEZpbGUiLCJlbmNvZGluZyIsImdlbmVyYXRlTWFya2Rvd24iLCJvdXRwdXREaXIiLCJzaXRlRG9tYWluIiwidGltZXN0YW1wIiwidG9JU09TdHJpbmciLCJiYXNlTmFtZSIsIndlYnNpdGVEaXIiLCJlbnN1cmVEaXIiLCJnZW5lcmF0ZWRGaWxlcyIsImZpbGVuYW1lIiwicGF0aG5hbWUiLCJzdWJzdHJpbmciLCJmaWxlcGF0aCIsInBhZ2VNYXJrZG93biIsImdlbmVyYXRlU2luZ2xlUGFnZU1hcmtkb3duIiwid3JpdGVGaWxlIiwiaW5kZXhNYXJrZG93biIsImdlbmVyYXRlSW5kZXhNYXJrZG93biIsImluZGV4UGF0aCIsInR5cGUiLCJvdXRwdXREaXJlY3RvcnkiLCJpbmRleEZpbGUiLCJmaWxlcyIsInRvdGFsRmlsZXMiLCJzdW1tYXJ5IiwibWFya2Rvd24iLCJmb3JFYWNoIiwiZmlsZSIsImluY2x1ZGVTaXRlbWFwIiwicGFyZW50Rm91bmQiLCJwb3RlbnRpYWxQYXJlbnQiLCJzb21lIiwicGFyZW50SW5kZXgiLCJmaW5kSW5kZXgiLCJwIiwiZGV0YWlscyIsIk9iamVjdCIsImFzc2lnbiIsInBpbmdDb252ZXJzaW9uIiwiZ2V0SW5mbyIsInByb3RvY29scyIsImluY2x1ZGVMaW5rcyIsIndhaXRUaW1lIiwibW9kdWxlIiwiZXhwb3J0cyJdLCJzb3VyY2VzIjpbIi4uLy4uLy4uLy4uLy4uL3NyYy9lbGVjdHJvbi9zZXJ2aWNlcy9jb252ZXJzaW9uL3dlYi9QYXJlbnRVcmxDb252ZXJ0ZXIuanMiXSwic291cmNlc0NvbnRlbnQiOlsiLyoqXHJcbiAqIFBhcmVudFVybENvbnZlcnRlci5qc1xyXG4gKiBIYW5kbGVzIGNvbnZlcnNpb24gb2YgbXVsdGktcGFnZSB3ZWJzaXRlcyB0byBtYXJrZG93biBmb3JtYXQgaW4gdGhlIEVsZWN0cm9uIG1haW4gcHJvY2Vzcy5cclxuICogXHJcbiAqIFRoaXMgY29udmVydGVyOlxyXG4gKiAtIEV4dGVuZHMgVXJsQ29udmVydGVyIHdpdGggc2l0ZSBjcmF3bGluZyBjYXBhYmlsaXRpZXNcclxuICogLSBEaXNjb3ZlcnMgYW5kIHByb2Nlc3NlcyBsaW5rZWQgcGFnZXNcclxuICogLSBDcmVhdGVzIGEgc3RydWN0dXJlZCBzaXRlIG1hcFxyXG4gKiAtIEdlbmVyYXRlcyBjb21wcmVoZW5zaXZlIG1hcmtkb3duIHdpdGggbXVsdGlwbGUgcGFnZXNcclxuICogXHJcbiAqIFJlbGF0ZWQgRmlsZXM6XHJcbiAqIC0gVXJsQ29udmVydGVyLmpzOiBQYXJlbnQgY2xhc3MgZm9yIHNpbmdsZSBwYWdlIGNvbnZlcnNpb25cclxuICogLSBGaWxlU3RvcmFnZVNlcnZpY2UuanM6IEZvciB0ZW1wb3JhcnkgZmlsZSBtYW5hZ2VtZW50XHJcbiAqIC0gQ29udmVyc2lvblNlcnZpY2UuanM6IFJlZ2lzdGVycyBhbmQgdXNlcyB0aGlzIGNvbnZlcnRlclxyXG4gKi9cclxuXHJcbmNvbnN0IHBhdGggPSByZXF1aXJlKCdwYXRoJyk7XHJcbmNvbnN0IGZzID0gcmVxdWlyZSgnZnMtZXh0cmEnKTtcclxuY29uc3QgeyBVUkwgfSA9IHJlcXVpcmUoJ3VybCcpO1xyXG5jb25zdCBVcmxDb252ZXJ0ZXIgPSByZXF1aXJlKCcuL1VybENvbnZlcnRlcicpO1xyXG5cclxuY2xhc3MgUGFyZW50VXJsQ29udmVydGVyIGV4dGVuZHMgVXJsQ29udmVydGVyIHtcclxuICAgIGNvbnN0cnVjdG9yKGZpbGVQcm9jZXNzb3IsIGZpbGVTdG9yYWdlKSB7XHJcbiAgICAgICAgc3VwZXIoZmlsZVByb2Nlc3NvciwgZmlsZVN0b3JhZ2UpO1xyXG4gICAgICAgIHRoaXMubmFtZSA9ICdQYXJlbnQgVVJMIENvbnZlcnRlcic7XHJcbiAgICAgICAgdGhpcy5kZXNjcmlwdGlvbiA9ICdDb252ZXJ0cyBtdWx0aS1wYWdlIHdlYnNpdGVzIHRvIG1hcmtkb3duJztcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFNldCB1cCBJUEMgaGFuZGxlcnMgZm9yIHBhcmVudCBVUkwgY29udmVyc2lvblxyXG4gICAgICovXHJcbiAgICBzZXR1cElwY0hhbmRsZXJzKCkge1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnBhcmVudC11cmwnLCB0aGlzLmhhbmRsZUNvbnZlcnQuYmluZCh0aGlzKSk7XHJcbiAgICAgICAgdGhpcy5yZWdpc3RlckhhbmRsZXIoJ2NvbnZlcnQ6cGFyZW50LXVybDpzaXRlbWFwJywgdGhpcy5oYW5kbGVHZXRTaXRlbWFwLmJpbmQodGhpcykpO1xyXG4gICAgICAgIHRoaXMucmVnaXN0ZXJIYW5kbGVyKCdjb252ZXJ0OnBhcmVudC11cmw6Y2FuY2VsJywgdGhpcy5oYW5kbGVDYW5jZWwuYmluZCh0aGlzKSk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBIYW5kbGUgcGFyZW50IFVSTCBjb252ZXJzaW9uIHJlcXVlc3RcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDb252ZXJzaW9uIHJlcXVlc3QgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBoYW5kbGVDb252ZXJ0KGV2ZW50LCB7IHVybCwgb3B0aW9ucyA9IHt9IH0pIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAvLyBWYWxpZGF0ZSBVUkxcclxuICAgICAgICAgICAgY29uc3QgcGFyc2VkVXJsID0gbmV3IFVSTCh1cmwpO1xyXG4gICAgICAgICAgICBpZiAoIXRoaXMuc3VwcG9ydGVkUHJvdG9jb2xzLmluY2x1ZGVzKHBhcnNlZFVybC5wcm90b2NvbCkpIHtcclxuICAgICAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihgVW5zdXBwb3J0ZWQgcHJvdG9jb2w6ICR7cGFyc2VkVXJsLnByb3RvY29sfWApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBjb252ZXJzaW9uSWQgPSB0aGlzLmdlbmVyYXRlQ29udmVyc2lvbklkKCk7XHJcbiAgICAgICAgICAgIGNvbnN0IHdpbmRvdyA9IGV2ZW50Py5zZW5kZXI/LmdldE93bmVyQnJvd3NlcldpbmRvdz8uKCkgfHwgbnVsbDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENyZWF0ZSB0ZW1wIGRpcmVjdG9yeSBmb3IgdGhpcyBjb252ZXJzaW9uXHJcbiAgICAgICAgICAgIGNvbnN0IHRlbXBEaXIgPSBhd2FpdCB0aGlzLmZpbGVTdG9yYWdlLmNyZWF0ZVRlbXBEaXIoJ3BhcmVudF91cmxfY29udmVyc2lvbicpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHtcclxuICAgICAgICAgICAgICAgIGlkOiBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICBzdGF0dXM6ICdzdGFydGluZycsXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogMCxcclxuICAgICAgICAgICAgICAgIHVybCxcclxuICAgICAgICAgICAgICAgIHRlbXBEaXIsXHJcbiAgICAgICAgICAgICAgICB3aW5kb3csXHJcbiAgICAgICAgICAgICAgICBwcm9jZXNzZWRVcmxzOiBuZXcgU2V0KCksXHJcbiAgICAgICAgICAgICAgICBwYWdlczogW11cclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuc2V0KGNvbnZlcnNpb25JZCwgY29udmVyc2lvbik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZWdpc3RlciB3aXRoIGdsb2JhbCBjb252ZXJ0ZXIgcmVnaXN0cnkgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgIGlmIChnbG9iYWwuY29udmVydGVyUmVnaXN0cnkgJiYgdHlwZW9mIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5yZWdpc3RlckNvbnZlcnNpb24gPT09ICdmdW5jdGlvbicpIHtcclxuICAgICAgICAgICAgICAgIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5yZWdpc3RlckNvbnZlcnNpb24oY29udmVyc2lvbklkLCBjb252ZXJzaW9uKTtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgLy8gTm90aWZ5IGNsaWVudCB0aGF0IGNvbnZlcnNpb24gaGFzIHN0YXJ0ZWQgKG9ubHkgaWYgd2UgaGF2ZSBhIHZhbGlkIHdpbmRvdylcclxuICAgICAgICAgICAgaWYgKHdpbmRvdyAmJiB3aW5kb3cud2ViQ29udGVudHMpIHtcclxuICAgICAgICAgICAgICAgIHdpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwYXJlbnQtdXJsOmNvbnZlcnNpb24tc3RhcnRlZCcsIHsgY29udmVyc2lvbklkIH0pO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICAvLyBTdGFydCBjb252ZXJzaW9uIHByb2Nlc3NcclxuICAgICAgICAgICAgdGhpcy5wcm9jZXNzQ29udmVyc2lvbihjb252ZXJzaW9uSWQsIHVybCwgb3B0aW9ucykuY2F0Y2goZXJyb3IgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybENvbnZlcnRlcl0gQ29udmVyc2lvbiBmYWlsZWQgZm9yICR7Y29udmVyc2lvbklkfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZmFpbGVkJywgeyBlcnJvcjogZXJyb3IubWVzc2FnZSB9KTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQ2xlYW4gdXAgdGVtcCBkaXJlY3RvcnlcclxuICAgICAgICAgICAgICAgIGZzLnJlbW92ZSh0ZW1wRGlyKS5jYXRjaChlcnIgPT4ge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBjbGVhbiB1cCB0ZW1wIGRpcmVjdG9yeTogJHt0ZW1wRGlyfWAsIGVycik7XHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfSk7XHJcblxyXG4gICAgICAgICAgICByZXR1cm4geyBcclxuICAgICAgICAgICAgICAgIGNvbnZlcnNpb25JZCxcclxuICAgICAgICAgICAgICAgIGFzeW5jOiB0cnVlLFxyXG4gICAgICAgICAgICAgICAgc3VjY2VzczogdHJ1ZVxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoJ1tQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBzdGFydCBjb252ZXJzaW9uOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIHNpdGVtYXAgcmVxdWVzdFxyXG4gICAgICogQHBhcmFtIHtFbGVjdHJvbi5JcGNNYWluSW52b2tlRXZlbnR9IGV2ZW50IC0gSVBDIGV2ZW50XHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gcmVxdWVzdCAtIFNpdGVtYXAgcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUdldFNpdGVtYXAoZXZlbnQsIHsgdXJsLCBvcHRpb25zID0ge30gfSkge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIGNvbnN0IGJyb3dzZXIgPSBhd2FpdCB0aGlzLmxhdW5jaEJyb3dzZXIoKTtcclxuICAgICAgICAgICAgY29uc3Qgc2l0ZW1hcCA9IGF3YWl0IHRoaXMuZGlzY292ZXJTaXRlbWFwKHVybCwgb3B0aW9ucywgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgcmV0dXJuIHNpdGVtYXA7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCBzaXRlbWFwOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogSGFuZGxlIGNvbnZlcnNpb24gY2FuY2VsbGF0aW9uIHJlcXVlc3Qgd2l0aCBwYXJ0aWFsIHJlc3VsdHNcclxuICAgICAqIEBwYXJhbSB7RWxlY3Ryb24uSXBjTWFpbkludm9rZUV2ZW50fSBldmVudCAtIElQQyBldmVudFxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHJlcXVlc3QgLSBDYW5jZWxsYXRpb24gcmVxdWVzdCBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIGhhbmRsZUNhbmNlbChldmVudCwgeyBjb252ZXJzaW9uSWQgfSkge1xyXG4gICAgICAgIGNvbnN0IGNvbnZlcnNpb24gPSB0aGlzLmFjdGl2ZUNvbnZlcnNpb25zLmdldChjb252ZXJzaW9uSWQpO1xyXG4gICAgICAgIGlmIChjb252ZXJzaW9uKSB7XHJcbiAgICAgICAgICAgIC8vIE1hcmsgYXMgY2FuY2VsbGVkIC0gdGhlIHByb2Nlc3NDb252ZXJzaW9uIGxvb3Agd2lsbCBjaGVjayB0aGlzXHJcbiAgICAgICAgICAgIGNvbnZlcnNpb24uc3RhdHVzID0gJ2NhbmNlbGxlZCc7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBpZiAoY29udmVyc2lvbi53aW5kb3cpIHtcclxuICAgICAgICAgICAgICAgIGNvbnZlcnNpb24ud2luZG93LndlYkNvbnRlbnRzLnNlbmQoJ3BhcmVudC11cmw6Y29udmVyc2lvbi1jYW5jZWxsaW5nJywgeyBcclxuICAgICAgICAgICAgICAgICAgICBjb252ZXJzaW9uSWQsXHJcbiAgICAgICAgICAgICAgICAgICAgbWVzc2FnZTogJ0NhbmNlbGxpbmcgY29udmVyc2lvbiwgcHJlcGFyaW5nIHBhcnRpYWwgcmVzdWx0cy4uLidcclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBEb24ndCBpbW1lZGlhdGVseSBjbG9zZSBicm93c2VyIG9yIGNsZWFuIHVwIC0gbGV0IHByb2Nlc3NDb252ZXJzaW9uIGhhbmRsZSBpdFxyXG4gICAgICAgICAgICAvLyBUaGlzIGFsbG93cyBwYXJ0aWFsIHJlc3VsdHMgdG8gYmUgc2F2ZWRcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiB7IHN1Y2Nlc3M6IHRydWUsIGNvbnZlcnNpb25JZCB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICByZXR1cm4geyBzdWNjZXNzOiBmYWxzZSwgZXJyb3I6ICdDb252ZXJzaW9uIG5vdCBmb3VuZCcgfTtcclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIFByb2Nlc3MgcGFyZW50IFVSTCBjb252ZXJzaW9uXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gY29udmVyc2lvbklkIC0gQ29udmVyc2lvbiBpZGVudGlmaWVyXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGNvbnZlcnRcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwgdXJsLCBvcHRpb25zKSB7XHJcbiAgICAgICAgbGV0IGJyb3dzZXIgPSBudWxsO1xyXG4gICAgICAgIGNvbnN0IHN0YXJ0VGltZSA9IERhdGUubm93KCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgY29udmVyc2lvbiA9IHRoaXMuYWN0aXZlQ29udmVyc2lvbnMuZ2V0KGNvbnZlcnNpb25JZCk7XHJcbiAgICAgICAgICAgIGlmICghY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICAgICAgdGhyb3cgbmV3IEVycm9yKCdDb252ZXJzaW9uIG5vdCBmb3VuZCcpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCB0ZW1wRGlyID0gY29udmVyc2lvbi50ZW1wRGlyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gTGF1bmNoIGJyb3dzZXJcclxuICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ2xhdW5jaGluZ19icm93c2VyJywgeyBcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiA1LFxyXG4gICAgICAgICAgICAgICAgd2Vic2l0ZURhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0b3RhbERpc2NvdmVyZWQ6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2luZzogMCxcclxuICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWQ6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFBhZ2U6IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgZXN0aW1hdGVkVGltZVJlbWFpbmluZzogbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzaW5nUmF0ZTogMFxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgYnJvd3NlciA9IGF3YWl0IHRoaXMubGF1bmNoQnJvd3NlcigpO1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLmJyb3dzZXIgPSBicm93c2VyO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRGlzY292ZXIgc2l0ZW1hcFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZGlzY292ZXJpbmdfc2l0ZW1hcCcsIHsgcHJvZ3Jlc3M6IDEwIH0pO1xyXG4gICAgICAgICAgICBjb25zdCBzaXRlbWFwID0gYXdhaXQgdGhpcy5kaXNjb3ZlclNpdGVtYXAodXJsLCBvcHRpb25zLCBicm93c2VyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFByb2Nlc3MgZWFjaCBwYWdlXHJcbiAgICAgICAgICAgIGNvbnN0IG1heFBhZ2VzID0gb3B0aW9ucy5tYXhQYWdlcyB8fCBzaXRlbWFwLnBhZ2VzLmxlbmd0aDtcclxuICAgICAgICAgICAgY29uc3QgcGFnZXNUb1Byb2Nlc3MgPSBzaXRlbWFwLnBhZ2VzLnNsaWNlKDAsIG1heFBhZ2VzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFNlbmQgaW5pdGlhbCBwYWdlIGRpc2NvdmVyeSBldmVudFxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAncGFnZXNfZGlzY292ZXJlZCcsIHtcclxuICAgICAgICAgICAgICAgIHByb2dyZXNzOiAyMCxcclxuICAgICAgICAgICAgICAgIHdlYnNpdGVEYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgdG90YWxEaXNjb3ZlcmVkOiBwYWdlc1RvUHJvY2Vzcy5sZW5ndGgsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2luZzogMCxcclxuICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWQ6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFBhZ2U6IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgZXN0aW1hdGVkVGltZVJlbWFpbmluZzogbnVsbCxcclxuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzaW5nUmF0ZTogMFxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NlZFBhZ2VzID0gW107XHJcbiAgICAgICAgICAgIGxldCBsYXN0VXBkYXRlVGltZSA9IERhdGUubm93KCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBmb3IgKGxldCBpID0gMDsgaSA8IHBhZ2VzVG9Qcm9jZXNzLmxlbmd0aDsgaSsrKSB7XHJcbiAgICAgICAgICAgICAgICAvLyBDaGVjayBpZiBjb252ZXJzaW9uIHdhcyBjYW5jZWxsZWRcclxuICAgICAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zb2xlLmxvZygnW1BhcmVudFVybENvbnZlcnRlcl0gQ29udmVyc2lvbiBjYW5jZWxsZWQsIHJldHVybmluZyBwYXJ0aWFsIHJlc3VsdHMnKTtcclxuICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFnZSA9IHBhZ2VzVG9Qcm9jZXNzW2ldO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBTa2lwIGlmIGFscmVhZHkgcHJvY2Vzc2VkXHJcbiAgICAgICAgICAgICAgICBpZiAoY29udmVyc2lvbi5wcm9jZXNzZWRVcmxzLmhhcyhwYWdlLnVybCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgLy8gQ2FsY3VsYXRlIHByb2dyZXNzIGFuZCBwcm9jZXNzaW5nIHJhdGVcclxuICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRUaW1lID0gRGF0ZS5ub3coKTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGVsYXBzZWRTZWNvbmRzID0gKGN1cnJlbnRUaW1lIC0gc3RhcnRUaW1lKSAvIDEwMDA7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBwcm9jZXNzaW5nUmF0ZSA9IHByb2Nlc3NlZFBhZ2VzLmxlbmd0aCAvIGVsYXBzZWRTZWNvbmRzO1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcmVtYWluaW5nUGFnZXMgPSBwYWdlc1RvUHJvY2Vzcy5sZW5ndGggLSBwcm9jZXNzZWRQYWdlcy5sZW5ndGg7XHJcbiAgICAgICAgICAgICAgICBjb25zdCBlc3RpbWF0ZWRUaW1lUmVtYWluaW5nID0gcHJvY2Vzc2luZ1JhdGUgPiAwID8gcmVtYWluaW5nUGFnZXMgLyBwcm9jZXNzaW5nUmF0ZSA6IG51bGw7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBzdGF0dXMgd2l0aCBkZXRhaWxlZCBwcm9ncmVzc1xyXG4gICAgICAgICAgICAgICAgdGhpcy51cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgJ3Byb2Nlc3NpbmdfcGFnZScsIHtcclxuICAgICAgICAgICAgICAgICAgICBwcm9ncmVzczogMjAgKyBNYXRoLmZsb29yKChwcm9jZXNzZWRQYWdlcy5sZW5ndGggLyBwYWdlc1RvUHJvY2Vzcy5sZW5ndGgpICogNjApLFxyXG4gICAgICAgICAgICAgICAgICAgIHdlYnNpdGVEYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRvdGFsRGlzY292ZXJlZDogcGFnZXNUb1Byb2Nlc3MubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBwcm9jZXNzaW5nOiAxLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWQ6IHByb2Nlc3NlZFBhZ2VzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgY3VycmVudFBhZ2U6IHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHVybDogcGFnZS51cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZTogcGFnZS50aXRsZSB8fCAnUHJvY2Vzc2luZy4uLicsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpbmRleDogaSArIDFcclxuICAgICAgICAgICAgICAgICAgICAgICAgfSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgZXN0aW1hdGVkVGltZVJlbWFpbmluZzogTWF0aC5yb3VuZChlc3RpbWF0ZWRUaW1lUmVtYWluaW5nKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2luZ1JhdGU6IE1hdGgucm91bmQocHJvY2Vzc2luZ1JhdGUgKiAxMCkgLyAxMFxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENvbnZlcnQgcGFnZSB1c2luZyBwYXJlbnQgVXJsQ29udmVydGVyJ3MgbWV0aG9kc1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VDb250ZW50ID0gYXdhaXQgdGhpcy5wcm9jZXNzUGFnZShwYWdlLnVybCwgb3B0aW9ucywgYnJvd3NlciwgdGVtcERpcik7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gQWRkIHRvIHByb2Nlc3NlZCBwYWdlc1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnZlcnNpb24ucHJvY2Vzc2VkVXJscy5hZGQocGFnZS51cmwpO1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnN0IHByb2Nlc3NlZFBhZ2UgPSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHVybDogcGFnZS51cmwsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRpdGxlOiBwYWdlLnRpdGxlLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb250ZW50OiBwYWdlQ29udGVudFxyXG4gICAgICAgICAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvbi5wYWdlcy5wdXNoKHByb2Nlc3NlZFBhZ2UpO1xyXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3NlZFBhZ2VzLnB1c2gocHJvY2Vzc2VkUGFnZSk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gVXBkYXRlIGNvbXBsZXRlZCBjb3VudFxyXG4gICAgICAgICAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdwYWdlX2NvbXBsZXRlZCcsIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDIwICsgTWF0aC5mbG9vcigoKGkgKyAxKSAvIHBhZ2VzVG9Qcm9jZXNzLmxlbmd0aCkgKiA2MCksXHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHdlYnNpdGVEYXRhOiB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0b3RhbERpc2NvdmVyZWQ6IHBhZ2VzVG9Qcm9jZXNzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3Npbmc6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb21wbGV0ZWQ6IHByb2Nlc3NlZFBhZ2VzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGN1cnJlbnRQYWdlOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgZXN0aW1hdGVkVGltZVJlbWFpbmluZzogTWF0aC5yb3VuZChlc3RpbWF0ZWRUaW1lUmVtYWluaW5nKSxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIHByb2Nlc3NpbmdSYXRlOiBNYXRoLnJvdW5kKHByb2Nlc3NpbmdSYXRlICogMTApIC8gMTBcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICAgICAgfSBjYXRjaCAocGFnZUVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIHByb2Nlc3MgcGFnZSAke3BhZ2UudXJsfTpgLCBwYWdlRXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgIC8vIENvbnRpbnVlIHdpdGggbmV4dCBwYWdlIGV2ZW4gaWYgb25lIGZhaWxzXHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duIGZpbGVzIGJhc2VkIG9uIHNhdmUgbW9kZVxyXG4gICAgICAgICAgICB0aGlzLnVwZGF0ZUNvbnZlcnNpb25TdGF0dXMoY29udmVyc2lvbklkLCAnZ2VuZXJhdGluZ19tYXJrZG93bicsIHsgXHJcbiAgICAgICAgICAgICAgICBwcm9ncmVzczogOTAsXHJcbiAgICAgICAgICAgICAgICB3ZWJzaXRlRGF0YToge1xyXG4gICAgICAgICAgICAgICAgICAgIHRvdGFsRGlzY292ZXJlZDogcGFnZXNUb1Byb2Nlc3MubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICAgICAgIHByb2Nlc3Npbmc6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgY29tcGxldGVkOiBwcm9jZXNzZWRQYWdlcy5sZW5ndGgsXHJcbiAgICAgICAgICAgICAgICAgICAgY3VycmVudFBhZ2U6IG51bGwsXHJcbiAgICAgICAgICAgICAgICAgICAgZXN0aW1hdGVkVGltZVJlbWFpbmluZzogMCxcclxuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzaW5nUmF0ZTogMFxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IHNhdmVNb2RlID0gb3B0aW9ucy53ZWJzaXRlU2NyYXBpbmc/LnNhdmVNb2RlIHx8ICdjb21iaW5lZCc7XHJcbiAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbUGFyZW50VXJsQ29udmVydGVyXSBVc2luZyBzYXZlIG1vZGU6ICR7c2F2ZU1vZGV9YCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBsZXQgcmVzdWx0O1xyXG4gICAgICAgICAgICBpZiAoc2F2ZU1vZGUgPT09ICdzZXBhcmF0ZScpIHtcclxuICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIHNlcGFyYXRlIGZpbGVzXHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSBhd2FpdCB0aGlzLmdlbmVyYXRlU2VwYXJhdGVGaWxlcyhzaXRlbWFwLCBjb252ZXJzaW9uLnBhZ2VzLCBvcHRpb25zLCB0ZW1wRGlyKTtcclxuICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIGNvbWJpbmVkIG1hcmtkb3duIChkZWZhdWx0IGJlaGF2aW9yKVxyXG4gICAgICAgICAgICAgICAgcmVzdWx0ID0gdGhpcy5nZW5lcmF0ZUNvbWJpbmVkTWFya2Rvd24oc2l0ZW1hcCwgY29udmVyc2lvbi5wYWdlcywgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCBtZXRhZGF0YSBhYm91dCBwYXJ0aWFsIGNvbnZlcnNpb24gaWYgY2FuY2VsbGVkXHJcbiAgICAgICAgICAgIGlmIChjb252ZXJzaW9uLnN0YXR1cyA9PT0gJ2NhbmNlbGxlZCcgJiYgcHJvY2Vzc2VkUGFnZXMubGVuZ3RoIDwgcGFnZXNUb1Byb2Nlc3MubGVuZ3RoKSB7XHJcbiAgICAgICAgICAgICAgICByZXN1bHQgPSB0eXBlb2YgcmVzdWx0ID09PSAnc3RyaW5nJyBcclxuICAgICAgICAgICAgICAgICAgICA/IGA+IOKaoO+4jyAqKk5vdGUqKjogVGhpcyBjb252ZXJzaW9uIHdhcyBjYW5jZWxsZWQuIE9ubHkgJHtwcm9jZXNzZWRQYWdlcy5sZW5ndGh9IG9mICR7cGFnZXNUb1Byb2Nlc3MubGVuZ3RofSBwYWdlcyB3ZXJlIHByb2Nlc3NlZC5cXG5cXG4ke3Jlc3VsdH1gXHJcbiAgICAgICAgICAgICAgICAgICAgOiB7IC4uLnJlc3VsdCwgcGFydGlhbENvbnZlcnNpb246IHRydWUsIHBhZ2VzUHJvY2Vzc2VkOiBwcm9jZXNzZWRQYWdlcy5sZW5ndGgsIHRvdGFsUGFnZXM6IHBhZ2VzVG9Qcm9jZXNzLmxlbmd0aCB9O1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyXHJcbiAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgY29udmVyc2lvbi5icm93c2VyID0gbnVsbDtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIENsZWFuIHVwIHRlbXAgZGlyZWN0b3J5XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLnJlbW92ZSh0ZW1wRGlyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHRoaXMudXBkYXRlQ29udmVyc2lvblN0YXR1cyhjb252ZXJzaW9uSWQsICdjb21wbGV0ZWQnLCB7IFxyXG4gICAgICAgICAgICAgICAgcHJvZ3Jlc3M6IDEwMCxcclxuICAgICAgICAgICAgICAgIHJlc3VsdDogcmVzdWx0LFxyXG4gICAgICAgICAgICAgICAgd2Vic2l0ZURhdGE6IHtcclxuICAgICAgICAgICAgICAgICAgICB0b3RhbERpc2NvdmVyZWQ6IHBhZ2VzVG9Qcm9jZXNzLmxlbmd0aCxcclxuICAgICAgICAgICAgICAgICAgICBwcm9jZXNzaW5nOiAwLFxyXG4gICAgICAgICAgICAgICAgICAgIGNvbXBsZXRlZDogcHJvY2Vzc2VkUGFnZXMubGVuZ3RoLFxyXG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRQYWdlOiBudWxsLFxyXG4gICAgICAgICAgICAgICAgICAgIGVzdGltYXRlZFRpbWVSZW1haW5pbmc6IDAsXHJcbiAgICAgICAgICAgICAgICAgICAgcHJvY2Vzc2luZ1JhdGU6IDBcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbGVhbiB1cCB0aGUgYWN0aXZlIGNvbnZlcnNpb25cclxuICAgICAgICAgICAgdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5kZWxldGUoY29udmVyc2lvbklkKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIHJldHVybiByZXN1bHQ7XHJcbiAgICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICAgICAgY29uc29sZS5lcnJvcignW1BhcmVudFVybENvbnZlcnRlcl0gQ29udmVyc2lvbiBwcm9jZXNzaW5nIGZhaWxlZDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDbG9zZSBicm93c2VyIGlmIG9wZW5cclxuICAgICAgICAgICAgaWYgKGJyb3dzZXIpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IGJyb3dzZXIuY2xvc2UoKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogTGF1bmNoIGJyb3dzZXIgaW5zdGFuY2VcclxuICAgICAqIEByZXR1cm5zIHtQcm9taXNlPHB1cHBldGVlci5Ccm93c2VyPn0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICovXHJcbiAgICBhc3luYyBsYXVuY2hCcm93c2VyKCkge1xyXG4gICAgICAgIGNvbnN0IHB1cHBldGVlciA9IHJlcXVpcmUoJ3B1cHBldGVlcicpO1xyXG4gICAgICAgIHJldHVybiBhd2FpdCBwdXBwZXRlZXIubGF1bmNoKHtcclxuICAgICAgICAgICAgaGVhZGxlc3M6ICduZXcnLFxyXG4gICAgICAgICAgICBhcmdzOiBbJy0tbm8tc2FuZGJveCcsICctLWRpc2FibGUtc2V0dWlkLXNhbmRib3gnXVxyXG4gICAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogRGlzY292ZXIgc2l0ZW1hcCBmb3IgVVJMXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIGRpc2NvdmVyXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIERpc2NvdmVyeSBvcHRpb25zXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBicm93c2VyIC0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8T2JqZWN0Pn0gU2l0ZW1hcFxyXG4gICAgICovXHJcbiAgICBhc3luYyBkaXNjb3ZlclNpdGVtYXAodXJsLCBvcHRpb25zLCBicm93c2VyKSB7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgICAgY29uc3QgcGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmdvdG8odXJsLCB7IHdhaXRVbnRpbDogJ25ldHdvcmtpZGxlMicsIHRpbWVvdXQ6IDMwMDAwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IGJhc2UgVVJMIGFuZCBkb21haW5cclxuICAgICAgICAgICAgY29uc3QgYmFzZVVybCA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKCkgPT4gZG9jdW1lbnQuYmFzZVVSSSk7XHJcbiAgICAgICAgICAgIGNvbnN0IHBhcnNlZFVybCA9IG5ldyBVUkwoYmFzZVVybCk7XHJcbiAgICAgICAgICAgIGNvbnN0IGRvbWFpbiA9IHBhcnNlZFVybC5ob3N0bmFtZTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEdldCBzaXRlIG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdGhpcy5mZXRjaE1ldGFkYXRhKHVybCwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBGaW5kIGxpbmtzXHJcbiAgICAgICAgICAgIGNvbnN0IG1heERlcHRoID0gb3B0aW9ucy5tYXhEZXB0aCB8fCAxO1xyXG4gICAgICAgICAgICBjb25zdCBtYXhQYWdlcyA9IG9wdGlvbnMubWF4UGFnZXMgfHwgMTA7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zdCBkaXNjb3ZlcmVkUGFnZXMgPSBuZXcgTWFwKCk7XHJcbiAgICAgICAgICAgIGRpc2NvdmVyZWRQYWdlcy5zZXQodXJsLCB7XHJcbiAgICAgICAgICAgICAgICB1cmwsXHJcbiAgICAgICAgICAgICAgICB0aXRsZTogbWV0YWRhdGEudGl0bGUsXHJcbiAgICAgICAgICAgICAgICBkZXB0aDogMCxcclxuICAgICAgICAgICAgICAgIGxpbmtzOiBbXVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEJyZWFkdGgtZmlyc3Qgc2VhcmNoIGZvciBsaW5rc1xyXG4gICAgICAgICAgICBjb25zdCBxdWV1ZSA9IFt7IHVybCwgZGVwdGg6IDAgfV07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICB3aGlsZSAocXVldWUubGVuZ3RoID4gMCAmJiBkaXNjb3ZlcmVkUGFnZXMuc2l6ZSA8IG1heFBhZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICBjb25zdCB7IHVybDogY3VycmVudFVybCwgZGVwdGggfSA9IHF1ZXVlLnNoaWZ0KCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFNraXAgaWYgYWxyZWFkeSBhdCBtYXggZGVwdGhcclxuICAgICAgICAgICAgICAgIGlmIChkZXB0aCA+PSBtYXhEZXB0aCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBHZXQgbGlua3MgZnJvbSBwYWdlXHJcbiAgICAgICAgICAgICAgICBjb25zdCBsaW5rcyA9IGF3YWl0IHRoaXMuZ2V0UGFnZUxpbmtzKGN1cnJlbnRVcmwsIGRvbWFpbiwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFVwZGF0ZSBjdXJyZW50IHBhZ2UgbGlua3NcclxuICAgICAgICAgICAgICAgIGNvbnN0IGN1cnJlbnRQYWdlID0gZGlzY292ZXJlZFBhZ2VzLmdldChjdXJyZW50VXJsKTtcclxuICAgICAgICAgICAgICAgIGlmIChjdXJyZW50UGFnZSkge1xyXG4gICAgICAgICAgICAgICAgICAgIGN1cnJlbnRQYWdlLmxpbmtzID0gbGlua3M7XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEFkZCBuZXcgbGlua3MgdG8gcXVldWVcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgbGluayBvZiBsaW5rcykge1xyXG4gICAgICAgICAgICAgICAgICAgIGlmICghZGlzY292ZXJlZFBhZ2VzLmhhcyhsaW5rLnVybCkgJiYgZGlzY292ZXJlZFBhZ2VzLnNpemUgPCBtYXhQYWdlcykge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBHZXQgcGFnZSB0aXRsZVxyXG4gICAgICAgICAgICAgICAgICAgICAgICBsZXQgdGl0bGUgPSBsaW5rLnRleHQ7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBjb25zdCBsaW5rUGFnZSA9IGF3YWl0IGJyb3dzZXIubmV3UGFnZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYXdhaXQgbGlua1BhZ2UuZ290byhsaW5rLnVybCwgeyB3YWl0VW50aWw6ICdkb21jb250ZW50bG9hZGVkJywgdGltZW91dDogMTAwMDAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB0aXRsZSA9IGF3YWl0IGxpbmtQYWdlLnRpdGxlKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBhd2FpdCBsaW5rUGFnZS5jbG9zZSgpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc29sZS5lcnJvcihgW1BhcmVudFVybENvbnZlcnRlcl0gRmFpbGVkIHRvIGdldCB0aXRsZSBmb3IgJHtsaW5rLnVybH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBBZGQgdG8gZGlzY292ZXJlZCBwYWdlc1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBkaXNjb3ZlcmVkUGFnZXMuc2V0KGxpbmsudXJsLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGxpbmsudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgdGl0bGU6IHRpdGxlIHx8IGxpbmsudGV4dCxcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGRlcHRoOiBkZXB0aCArIDEsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rczogW11cclxuICAgICAgICAgICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgICAgICAvLyBBZGQgdG8gcXVldWVcclxuICAgICAgICAgICAgICAgICAgICAgICAgcXVldWUucHVzaCh7IHVybDogbGluay51cmwsIGRlcHRoOiBkZXB0aCArIDEgfSk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBCdWlsZCBzaXRlbWFwXHJcbiAgICAgICAgICAgIGNvbnN0IHNpdGVtYXAgPSB7XHJcbiAgICAgICAgICAgICAgICByb290VXJsOiB1cmwsXHJcbiAgICAgICAgICAgICAgICBkb21haW4sXHJcbiAgICAgICAgICAgICAgICB0aXRsZTogbWV0YWRhdGEudGl0bGUsXHJcbiAgICAgICAgICAgICAgICBwYWdlczogQXJyYXkuZnJvbShkaXNjb3ZlcmVkUGFnZXMudmFsdWVzKCkpXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICByZXR1cm4gc2l0ZW1hcDtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUGFyZW50VXJsQ29udmVydGVyXSBGYWlsZWQgdG8gZGlzY292ZXIgc2l0ZW1hcDonLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBsaW5rcyBmcm9tIHBhZ2VcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB1cmwgLSBVUkwgdG8gZ2V0IGxpbmtzIGZyb21cclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBkb21haW4gLSBEb21haW4gdG8gZmlsdGVyIGxpbmtzXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBicm93c2VyIC0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHJldHVybnMge1Byb21pc2U8QXJyYXk+fSBBcnJheSBvZiBsaW5rc1xyXG4gICAgICovXHJcbiAgICBhc3luYyBnZXRQYWdlTGlua3ModXJsLCBkb21haW4sIGJyb3dzZXIpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zdCBwYWdlID0gYXdhaXQgYnJvd3Nlci5uZXdQYWdlKCk7XHJcbiAgICAgICAgICAgIGF3YWl0IHBhZ2UuZ290byh1cmwsIHsgd2FpdFVudGlsOiAnZG9tY29udGVudGxvYWRlZCcsIHRpbWVvdXQ6IDMwMDAwIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gRXh0cmFjdCBsaW5rc1xyXG4gICAgICAgICAgICBjb25zdCBsaW5rcyA9IGF3YWl0IHBhZ2UuZXZhbHVhdGUoKGRvbWFpbikgPT4ge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgbGlua3MgPSBbXTtcclxuICAgICAgICAgICAgICAgIGNvbnN0IGFuY2hvcnMgPSBkb2N1bWVudC5xdWVyeVNlbGVjdG9yQWxsKCdhW2hyZWZdJyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGZvciAoY29uc3QgYW5jaG9yIG9mIGFuY2hvcnMpIHtcclxuICAgICAgICAgICAgICAgICAgICBjb25zdCBocmVmID0gYW5jaG9yLmhyZWY7XHJcbiAgICAgICAgICAgICAgICAgICAgY29uc3QgdGV4dCA9IGFuY2hvci50ZXh0Q29udGVudC50cmltKCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gU2tpcCBlbXB0eSwgaGFzaCwgYW5kIGphdmFzY3JpcHQgbGlua3NcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIWhyZWYgfHwgaHJlZi5zdGFydHNXaXRoKCcjJykgfHwgaHJlZi5zdGFydHNXaXRoKCdqYXZhc2NyaXB0OicpKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBjb25zdCB1cmwgPSBuZXcgVVJMKGhyZWYpO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAgICAgLy8gT25seSBpbmNsdWRlIGxpbmtzIGZyb20gc2FtZSBkb21haW5cclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHVybC5ob3N0bmFtZSA9PT0gZG9tYWluKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBsaW5rcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICB1cmw6IGhyZWYsXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgdGV4dDogdGV4dCB8fCBocmVmXHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIC8vIFNraXAgaW52YWxpZCBVUkxzXHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICByZXR1cm4gbGlua3M7XHJcbiAgICAgICAgICAgIH0sIGRvbWFpbik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBhd2FpdCBwYWdlLmNsb3NlKCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZW1vdmUgZHVwbGljYXRlc1xyXG4gICAgICAgICAgICBjb25zdCB1bmlxdWVMaW5rcyA9IFtdO1xyXG4gICAgICAgICAgICBjb25zdCBzZWVuVXJscyA9IG5ldyBTZXQoKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGZvciAoY29uc3QgbGluayBvZiBsaW5rcykge1xyXG4gICAgICAgICAgICAgICAgLy8gTm9ybWFsaXplIFVSTCBieSByZW1vdmluZyB0cmFpbGluZyBzbGFzaCBhbmQgaGFzaFxyXG4gICAgICAgICAgICAgICAgY29uc3Qgbm9ybWFsaXplZFVybCA9IGxpbmsudXJsLnJlcGxhY2UoLyMuKiQvLCAnJykucmVwbGFjZSgvXFwvJC8sICcnKTtcclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgaWYgKCFzZWVuVXJscy5oYXMobm9ybWFsaXplZFVybCkpIHtcclxuICAgICAgICAgICAgICAgICAgICBzZWVuVXJscy5hZGQobm9ybWFsaXplZFVybCk7XHJcbiAgICAgICAgICAgICAgICAgICAgdW5pcXVlTGlua3MucHVzaChsaW5rKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgcmV0dXJuIHVuaXF1ZUxpbmtzO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICAgIGNvbnNvbGUuZXJyb3IoYFtQYXJlbnRVcmxDb252ZXJ0ZXJdIEZhaWxlZCB0byBnZXQgbGlua3MgZnJvbSAke3VybH06YCwgZXJyb3IpO1xyXG4gICAgICAgICAgICByZXR1cm4gW107XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogUHJvY2VzcyBhIHNpbmdsZSBwYWdlXHJcbiAgICAgKiBAcGFyYW0ge3N0cmluZ30gdXJsIC0gVVJMIHRvIHByb2Nlc3NcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gUHJvY2Vzc2luZyBvcHRpb25zXHJcbiAgICAgKiBAcGFyYW0ge3B1cHBldGVlci5Ccm93c2VyfSBicm93c2VyIC0gQnJvd3NlciBpbnN0YW5jZVxyXG4gICAgICogQHBhcmFtIHtzdHJpbmd9IHRlbXBEaXIgLSBUZW1wb3JhcnkgZGlyZWN0b3J5XHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxzdHJpbmc+fSBNYXJrZG93biBjb250ZW50XHJcbiAgICAgKi9cclxuICAgIGFzeW5jIHByb2Nlc3NQYWdlKHVybCwgb3B0aW9ucywgYnJvd3NlciwgdGVtcERpcikge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICAgIC8vIEV4dHJhY3QgY29udGVudFxyXG4gICAgICAgICAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5leHRyYWN0Q29udGVudCh1cmwsIG9wdGlvbnMsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gUHJvY2VzcyBpbWFnZXMgaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgIGlmIChvcHRpb25zLmluY2x1ZGVJbWFnZXMpIHtcclxuICAgICAgICAgICAgICAgIGF3YWl0IHRoaXMucHJvY2Vzc0ltYWdlcyhjb250ZW50LCB0ZW1wRGlyLCB1cmwsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDYXB0dXJlIHNjcmVlbnNob3QgaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgICAgIGxldCBzY3JlZW5zaG90ID0gbnVsbDtcclxuICAgICAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZVNjcmVlbnNob3QpIHtcclxuICAgICAgICAgICAgICAgIGNvbnN0IHNjcmVlbnNob3RQYXRoID0gcGF0aC5qb2luKHRlbXBEaXIsIGBzY3JlZW5zaG90XyR7RGF0ZS5ub3coKX0ucG5nYCk7XHJcbiAgICAgICAgICAgICAgICBhd2FpdCB0aGlzLmNhcHR1cmVTY3JlZW5zaG90KHVybCwgc2NyZWVuc2hvdFBhdGgsIG9wdGlvbnMsIGJyb3dzZXIpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBSZWFkIHNjcmVlbnNob3QgYXMgYmFzZTY0XHJcbiAgICAgICAgICAgICAgICBjb25zdCBzY3JlZW5zaG90RGF0YSA9IGF3YWl0IGZzLnJlYWRGaWxlKHNjcmVlbnNob3RQYXRoLCB7IGVuY29kaW5nOiAnYmFzZTY0JyB9KTtcclxuICAgICAgICAgICAgICAgIHNjcmVlbnNob3QgPSBgZGF0YTppbWFnZS9wbmc7YmFzZTY0LCR7c2NyZWVuc2hvdERhdGF9YDtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2V0IG1ldGFkYXRhXHJcbiAgICAgICAgICAgIGNvbnN0IG1ldGFkYXRhID0gYXdhaXQgdGhpcy5mZXRjaE1ldGFkYXRhKHVybCwgYnJvd3Nlcik7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBtYXJrZG93blxyXG4gICAgICAgICAgICByZXR1cm4gdGhpcy5nZW5lcmF0ZU1hcmtkb3duKG1ldGFkYXRhLCBjb250ZW50LCBzY3JlZW5zaG90LCBvcHRpb25zKTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKGBbUGFyZW50VXJsQ29udmVydGVyXSBGYWlsZWQgdG8gcHJvY2VzcyBwYWdlICR7dXJsfTpgLCBlcnJvcik7XHJcbiAgICAgICAgICAgIHJldHVybiBgIyBFcnJvciBQcm9jZXNzaW5nIFBhZ2U6ICR7dXJsfVxcblxcbkZhaWxlZCB0byBwcm9jZXNzIHRoaXMgcGFnZTogJHtlcnJvci5tZXNzYWdlfWA7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgc2VwYXJhdGUgbWFya2Rvd24gZmlsZXMgZm9yIGVhY2ggcGFnZVxyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IHNpdGVtYXAgLSBTaXRlbWFwXHJcbiAgICAgKiBAcGFyYW0ge0FycmF5fSBwYWdlcyAtIFByb2Nlc3NlZCBwYWdlc1xyXG4gICAgICogQHBhcmFtIHtPYmplY3R9IG9wdGlvbnMgLSBDb252ZXJzaW9uIG9wdGlvbnNcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSB0ZW1wRGlyIC0gVGVtcG9yYXJ5IGRpcmVjdG9yeSBmb3IgZmlsZSBvcGVyYXRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7UHJvbWlzZTxPYmplY3Q+fSBSZXN1bHQgd2l0aCBtdWx0aXBsZSBmaWxlcyBpbmZvcm1hdGlvblxyXG4gICAgICovXHJcbiAgICBhc3luYyBnZW5lcmF0ZVNlcGFyYXRlRmlsZXMoc2l0ZW1hcCwgcGFnZXMsIG9wdGlvbnMsIHRlbXBEaXIpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1BhcmVudFVybENvbnZlcnRlcl0gR2VuZXJhdGluZyAke3BhZ2VzLmxlbmd0aH0gc2VwYXJhdGUgZmlsZXNgKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IG91dHB1dERpciA9IG9wdGlvbnMub3V0cHV0RGlyO1xyXG4gICAgICAgICAgICBjb25zdCBzaXRlRG9tYWluID0gbmV3IFVSTChzaXRlbWFwLnJvb3RVcmwpLmhvc3RuYW1lO1xyXG4gICAgICAgICAgICBjb25zdCB0aW1lc3RhbXAgPSBuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCkucmVwbGFjZSgvWzouXS9nLCAnLScpO1xyXG4gICAgICAgICAgICBjb25zdCBiYXNlTmFtZSA9IGAke3NpdGVEb21haW59XyR7dGltZXN0YW1wfWA7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBDcmVhdGUgYSBzdWJkaXJlY3RvcnkgZm9yIHRoZSB3ZWJzaXRlIGZpbGVzXHJcbiAgICAgICAgICAgIGNvbnN0IHdlYnNpdGVEaXIgPSBwYXRoLmpvaW4ob3V0cHV0RGlyLCBiYXNlTmFtZSk7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLmVuc3VyZURpcih3ZWJzaXRlRGlyKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIGNvbnN0IGdlbmVyYXRlZEZpbGVzID0gW107XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBHZW5lcmF0ZSBpbmRpdmlkdWFsIHBhZ2UgZmlsZXNcclxuICAgICAgICAgICAgZm9yIChsZXQgaSA9IDA7IGkgPCBwYWdlcy5sZW5ndGg7IGkrKykge1xyXG4gICAgICAgICAgICAgICAgY29uc3QgcGFnZSA9IHBhZ2VzW2ldO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAvLyBDcmVhdGUgYSBzYWZlIGZpbGVuYW1lIGZyb20gdGhlIHBhZ2UgdGl0bGUgb3IgVVJMXHJcbiAgICAgICAgICAgICAgICBsZXQgZmlsZW5hbWUgPSBwYWdlLnRpdGxlIHx8IG5ldyBVUkwocGFnZS51cmwpLnBhdGhuYW1lO1xyXG4gICAgICAgICAgICAgICAgZmlsZW5hbWUgPSBmaWxlbmFtZS5yZXBsYWNlKC9bXmEtekEtWjAtOVxcLV9dL2csICdfJyk7XHJcbiAgICAgICAgICAgICAgICBmaWxlbmFtZSA9IGZpbGVuYW1lLnJlcGxhY2UoL18rL2csICdfJykucmVwbGFjZSgvXl98XyQvZywgJycpO1xyXG4gICAgICAgICAgICAgICAgZmlsZW5hbWUgPSBmaWxlbmFtZSB8fCBgcGFnZV8ke2kgKyAxfWA7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEVuc3VyZSBmaWxlbmFtZSBpcyBub3QgdG9vIGxvbmdcclxuICAgICAgICAgICAgICAgIGlmIChmaWxlbmFtZS5sZW5ndGggPiA1MCkge1xyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVuYW1lID0gZmlsZW5hbWUuc3Vic3RyaW5nKDAsIDUwKTtcclxuICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgY29uc3QgZmlsZXBhdGggPSBwYXRoLmpvaW4od2Vic2l0ZURpciwgYCR7ZmlsZW5hbWV9Lm1kYCk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIEdlbmVyYXRlIG1hcmtkb3duIGZvciB0aGlzIHBhZ2VcclxuICAgICAgICAgICAgICAgIGNvbnN0IHBhZ2VNYXJrZG93biA9IHRoaXMuZ2VuZXJhdGVTaW5nbGVQYWdlTWFya2Rvd24ocGFnZSwgc2l0ZW1hcCwgb3B0aW9ucyk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIC8vIFdyaXRlIGZpbGVcclxuICAgICAgICAgICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShmaWxlcGF0aCwgcGFnZU1hcmtkb3duLCAndXRmOCcpO1xyXG4gICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICBnZW5lcmF0ZWRGaWxlcy5wdXNoKHtcclxuICAgICAgICAgICAgICAgICAgICB0aXRsZTogcGFnZS50aXRsZSxcclxuICAgICAgICAgICAgICAgICAgICB1cmw6IHBhZ2UudXJsLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVuYW1lOiBgJHtmaWxlbmFtZX0ubWRgLFxyXG4gICAgICAgICAgICAgICAgICAgIGZpbGVwYXRoOiBmaWxlcGF0aFxyXG4gICAgICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgIGNvbnNvbGUubG9nKGBbUGFyZW50VXJsQ29udmVydGVyXSBHZW5lcmF0ZWQgZmlsZTogJHtmaWxlbmFtZX0ubWRgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gR2VuZXJhdGUgYW4gaW5kZXggZmlsZSB3aXRoIGxpbmtzIHRvIGFsbCBwYWdlc1xyXG4gICAgICAgICAgICBjb25zdCBpbmRleE1hcmtkb3duID0gdGhpcy5nZW5lcmF0ZUluZGV4TWFya2Rvd24oc2l0ZW1hcCwgZ2VuZXJhdGVkRmlsZXMsIG9wdGlvbnMpO1xyXG4gICAgICAgICAgICBjb25zdCBpbmRleFBhdGggPSBwYXRoLmpvaW4od2Vic2l0ZURpciwgJ2luZGV4Lm1kJyk7XHJcbiAgICAgICAgICAgIGF3YWl0IGZzLndyaXRlRmlsZShpbmRleFBhdGgsIGluZGV4TWFya2Rvd24sICd1dGY4Jyk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICBjb25zb2xlLmxvZyhgW1BhcmVudFVybENvbnZlcnRlcl0gR2VuZXJhdGVkIGluZGV4IGZpbGU6IGluZGV4Lm1kYCk7XHJcbiAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAvLyBSZXR1cm4gaW5mb3JtYXRpb24gYWJvdXQgdGhlIGdlbmVyYXRlZCBmaWxlc1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgICAgdHlwZTogJ211bHRpcGxlX2ZpbGVzJyxcclxuICAgICAgICAgICAgICAgIG91dHB1dERpcmVjdG9yeTogd2Vic2l0ZURpcixcclxuICAgICAgICAgICAgICAgIGluZGV4RmlsZTogaW5kZXhQYXRoLFxyXG4gICAgICAgICAgICAgICAgZmlsZXM6IGdlbmVyYXRlZEZpbGVzLFxyXG4gICAgICAgICAgICAgICAgdG90YWxGaWxlczogZ2VuZXJhdGVkRmlsZXMubGVuZ3RoICsgMSwgLy8gKzEgZm9yIGluZGV4XHJcbiAgICAgICAgICAgICAgICBzdW1tYXJ5OiBgR2VuZXJhdGVkICR7Z2VuZXJhdGVkRmlsZXMubGVuZ3RofSBwYWdlIGZpbGVzICsgMSBpbmRleCBmaWxlIGluICR7YmFzZU5hbWV9L2BcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgICBjb25zb2xlLmVycm9yKCdbUGFyZW50VXJsQ29udmVydGVyXSBFcnJvciBnZW5lcmF0aW5nIHNlcGFyYXRlIGZpbGVzOicsIGVycm9yKTtcclxuICAgICAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgbWFya2Rvd24gZm9yIGEgc2luZ2xlIHBhZ2VcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBwYWdlIC0gUGFnZSBkYXRhXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gc2l0ZW1hcCAtIFNpdGVtYXAgaW5mb3JtYXRpb25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBTaW5nbGUgcGFnZSBtYXJrZG93blxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZVNpbmdsZVBhZ2VNYXJrZG93bihwYWdlLCBzaXRlbWFwLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgcGFnZSB0aXRsZVxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHtwYWdlLnRpdGxlIHx8IHBhZ2UudXJsfWApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBwYWdlIG1ldGFkYXRhXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgUGFnZSBJbmZvcm1hdGlvbicpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ3wgUHJvcGVydHkgfCBWYWx1ZSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCAtLS0gfCAtLS0gfCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgVVJMIHwgWyR7cGFnZS51cmx9XSgke3BhZ2UudXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgVGl0bGUgfCAke3BhZ2UudGl0bGUgfHwgJ04vQSd9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFNpdGUgfCBbJHtzaXRlbWFwLmRvbWFpbn1dKCR7c2l0ZW1hcC5yb290VXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgR2VuZXJhdGVkIHwgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9IHxgKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgY29udGVudFxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIENvbnRlbnQnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKHBhZ2UuY29udGVudCk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogR2VuZXJhdGUgaW5kZXggbWFya2Rvd24gd2l0aCBsaW5rcyB0byBhbGwgcGFnZXNcclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBzaXRlbWFwIC0gU2l0ZW1hcCBpbmZvcm1hdGlvblxyXG4gICAgICogQHBhcmFtIHtBcnJheX0gZmlsZXMgLSBHZW5lcmF0ZWQgZmlsZXMgaW5mb3JtYXRpb25cclxuICAgICAqIEBwYXJhbSB7T2JqZWN0fSBvcHRpb25zIC0gQ29udmVyc2lvbiBvcHRpb25zXHJcbiAgICAgKiBAcmV0dXJucyB7c3RyaW5nfSBJbmRleCBtYXJrZG93blxyXG4gICAgICovXHJcbiAgICBnZW5lcmF0ZUluZGV4TWFya2Rvd24oc2l0ZW1hcCwgZmlsZXMsIG9wdGlvbnMpIHtcclxuICAgICAgICBjb25zdCBtYXJrZG93biA9IFtdO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCB0aXRsZVxyXG4gICAgICAgIGlmIChvcHRpb25zLnRpdGxlKSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHtvcHRpb25zLnRpdGxlfWApO1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCMgJHtzaXRlbWFwLnRpdGxlIHx8ICdXZWJzaXRlIENvbnZlcnNpb24nfWApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgc2l0ZSBpbmZvcm1hdGlvblxyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJyMjIFNpdGUgSW5mb3JtYXRpb24nKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IFByb3BlcnR5IHwgVmFsdWUgfCcpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJ3wgLS0tIHwgLS0tIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKGB8IFJvb3QgVVJMIHwgWyR7c2l0ZW1hcC5yb290VXJsfV0oJHtzaXRlbWFwLnJvb3RVcmx9KSB8YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBEb21haW4gfCAke3NpdGVtYXAuZG9tYWlufSB8YCk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBQYWdlcyBQcm9jZXNzZWQgfCAke2ZpbGVzLmxlbmd0aH0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgR2VuZXJhdGVkIHwgJHtuZXcgRGF0ZSgpLnRvSVNPU3RyaW5nKCl9IHxgKTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgbGlzdCBvZiBnZW5lcmF0ZWQgZmlsZXNcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBHZW5lcmF0ZWQgRmlsZXMnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICBmaWxlcy5mb3JFYWNoKChmaWxlLCBpbmRleCkgPT4ge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAke2luZGV4ICsgMX0uIFske2ZpbGUudGl0bGUgfHwgZmlsZS51cmx9XSguLyR7ZmlsZS5maWxlbmFtZX0pYCk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgIC0gVVJMOiAke2ZpbGUudXJsfWApO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAgICAtIEZpbGU6ICR7ZmlsZS5maWxlbmFtZX1gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHNpdGVtYXAgdmlzdWFsaXphdGlvbiBpZiByZXF1ZXN0ZWRcclxuICAgICAgICBpZiAob3B0aW9ucy5pbmNsdWRlU2l0ZW1hcCkge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBTaXRlIFN0cnVjdHVyZScpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnYGBgbWVybWFpZCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCdncmFwaCBURCcpO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIHJvb3Qgbm9kZVxyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAgIHJvb3RbXCIke3NpdGVtYXAudGl0bGUgfHwgc2l0ZW1hcC5yb290VXJsfVwiXWApO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgLy8gQWRkIHBhZ2Ugbm9kZXMgYW5kIGxpbmtzXHJcbiAgICAgICAgICAgIHNpdGVtYXAucGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgICAgIGlmIChwYWdlLnVybCAhPT0gc2l0ZW1hcC5yb290VXJsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICBwYWdlJHtpbmRleH1bXCIke3BhZ2UudGl0bGUgfHwgcGFnZS51cmx9XCJdYCk7XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gRmluZCBwYXJlbnQgcGFnZVxyXG4gICAgICAgICAgICAgICAgICAgIGxldCBwYXJlbnRGb3VuZCA9IGZhbHNlO1xyXG4gICAgICAgICAgICAgICAgICAgIGZvciAoY29uc3QgcG90ZW50aWFsUGFyZW50IG9mIHNpdGVtYXAucGFnZXMpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgaWYgKHBvdGVudGlhbFBhcmVudC5saW5rcy5zb21lKGxpbmsgPT4gbGluay51cmwgPT09IHBhZ2UudXJsKSkge1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgY29uc3QgcGFyZW50SW5kZXggPSBzaXRlbWFwLnBhZ2VzLmZpbmRJbmRleChwID0+IHAudXJsID09PSBwb3RlbnRpYWxQYXJlbnQudXJsKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwb3RlbnRpYWxQYXJlbnQudXJsID09PSBzaXRlbWFwLnJvb3RVcmwpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAgIHJvb3QgLS0+IHBhZ2Uke2luZGV4fWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfSBlbHNlIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAgIHBhZ2Uke3BhcmVudEluZGV4fSAtLT4gcGFnZSR7aW5kZXh9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBwYXJlbnRGb3VuZCA9IHRydWU7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBicmVhaztcclxuICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICBcclxuICAgICAgICAgICAgICAgICAgICAvLyBJZiBubyBwYXJlbnQgZm91bmQsIGNvbm5lY3QgdG8gcm9vdFxyXG4gICAgICAgICAgICAgICAgICAgIGlmICghcGFyZW50Rm91bmQpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290IC0tPiBwYWdlJHtpbmRleH1gKTtcclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnYGBgJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBcclxuICAgICAgICByZXR1cm4gbWFya2Rvd24uam9pbignXFxuJyk7XHJcbiAgICB9XHJcblxyXG4gICAgLyoqXHJcbiAgICAgKiBHZW5lcmF0ZSBjb21iaW5lZCBtYXJrZG93biBmcm9tIG11bHRpcGxlIHBhZ2VzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gc2l0ZW1hcCAtIFNpdGVtYXBcclxuICAgICAqIEBwYXJhbSB7QXJyYXl9IHBhZ2VzIC0gUHJvY2Vzc2VkIHBhZ2VzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gb3B0aW9ucyAtIENvbnZlcnNpb24gb3B0aW9uc1xyXG4gICAgICogQHJldHVybnMge3N0cmluZ30gQ29tYmluZWQgbWFya2Rvd25cclxuICAgICAqL1xyXG4gICAgZ2VuZXJhdGVDb21iaW5lZE1hcmtkb3duKHNpdGVtYXAsIHBhZ2VzLCBvcHRpb25zKSB7XHJcbiAgICAgICAgY29uc3QgbWFya2Rvd24gPSBbXTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdGl0bGVcclxuICAgICAgICBpZiAob3B0aW9ucy50aXRsZSkge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7b3B0aW9ucy50aXRsZX1gKTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKGAjICR7c2l0ZW1hcC50aXRsZSB8fCAnV2Vic2l0ZSBDb252ZXJzaW9uJ31gKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgXHJcbiAgICAgICAgLy8gQWRkIHNpdGUgaW5mb3JtYXRpb25cclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBTaXRlIEluZm9ybWF0aW9uJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaCgnfCBQcm9wZXJ0eSB8IFZhbHVlIHwnKTtcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCd8IC0tLSB8IC0tLSB8Jyk7XHJcbiAgICAgICAgbWFya2Rvd24ucHVzaChgfCBSb290IFVSTCB8IFske3NpdGVtYXAucm9vdFVybH1dKCR7c2l0ZW1hcC5yb290VXJsfSkgfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgRG9tYWluIHwgJHtzaXRlbWFwLmRvbWFpbn0gfGApO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goYHwgUGFnZXMgUHJvY2Vzc2VkIHwgJHtwYWdlcy5sZW5ndGh9IHxgKTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgdGFibGUgb2YgY29udGVudHNcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcjIyBUYWJsZSBvZiBDb250ZW50cycpO1xyXG4gICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIFxyXG4gICAgICAgIHBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCR7aW5kZXggKyAxfS4gWyR7cGFnZS50aXRsZSB8fCBwYWdlLnVybH1dKCNwYWdlLSR7aW5kZXggKyAxfSlgKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICBcclxuICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICBcclxuICAgICAgICAvLyBBZGQgZWFjaCBwYWdlXHJcbiAgICAgICAgcGFnZXMuZm9yRWFjaCgocGFnZSwgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgPGEgaWQ9XCJwYWdlLSR7aW5kZXggKyAxfVwiPjwvYT5gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgIyMgUGFnZSAke2luZGV4ICsgMX06ICR7cGFnZS50aXRsZSB8fCBwYWdlLnVybH1gKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYFVSTDogWyR7cGFnZS51cmx9XSgke3BhZ2UudXJsfSlgKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJy0tLScpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChwYWdlLmNvbnRlbnQpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnLS0tJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJycpO1xyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIFxyXG4gICAgICAgIC8vIEFkZCBzaXRlbWFwIHZpc3VhbGl6YXRpb24gaWYgcmVxdWVzdGVkXHJcbiAgICAgICAgaWYgKG9wdGlvbnMuaW5jbHVkZVNpdGVtYXApIHtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnIyMgU2l0ZSBTdHJ1Y3R1cmUnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnJyk7XHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ2BgYG1lcm1haWQnKTtcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaCgnZ3JhcGggVEQnKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCByb290IG5vZGVcclxuICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290W1wiJHtzaXRlbWFwLnRpdGxlIHx8IHNpdGVtYXAucm9vdFVybH1cIl1gKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIEFkZCBwYWdlIG5vZGVzIGFuZCBsaW5rc1xyXG4gICAgICAgICAgICBzaXRlbWFwLnBhZ2VzLmZvckVhY2goKHBhZ2UsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICAgICAgICBpZiAocGFnZS51cmwgIT09IHNpdGVtYXAucm9vdFVybCkge1xyXG4gICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgcGFnZSR7aW5kZXh9W1wiJHtwYWdlLnRpdGxlIHx8IHBhZ2UudXJsfVwiXWApO1xyXG4gICAgICAgICAgICAgICAgICAgIFxyXG4gICAgICAgICAgICAgICAgICAgIC8vIEZpbmQgcGFyZW50IHBhZ2VcclxuICAgICAgICAgICAgICAgICAgICBsZXQgcGFyZW50Rm91bmQgPSBmYWxzZTtcclxuICAgICAgICAgICAgICAgICAgICBmb3IgKGNvbnN0IHBvdGVudGlhbFBhcmVudCBvZiBzaXRlbWFwLnBhZ2VzKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIGlmIChwb3RlbnRpYWxQYXJlbnQubGlua3Muc29tZShsaW5rID0+IGxpbmsudXJsID09PSBwYWdlLnVybCkpIHtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIGNvbnN0IHBhcmVudEluZGV4ID0gc2l0ZW1hcC5wYWdlcy5maW5kSW5kZXgocCA9PiBwLnVybCA9PT0gcG90ZW50aWFsUGFyZW50LnVybCk7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICBpZiAocG90ZW50aWFsUGFyZW50LnVybCA9PT0gc2l0ZW1hcC5yb290VXJsKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICByb290IC0tPiBwYWdlJHtpbmRleH1gKTtcclxuICAgICAgICAgICAgICAgICAgICAgICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgbWFya2Rvd24ucHVzaChgICBwYWdlJHtwYXJlbnRJbmRleH0gLS0+IHBhZ2Uke2luZGV4fWApO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgcGFyZW50Rm91bmQgPSB0cnVlO1xyXG4gICAgICAgICAgICAgICAgICAgICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIH1cclxuICAgICAgICAgICAgICAgICAgICB9XHJcbiAgICAgICAgICAgICAgICAgICAgXHJcbiAgICAgICAgICAgICAgICAgICAgLy8gSWYgbm8gcGFyZW50IGZvdW5kLCBjb25uZWN0IHRvIHJvb3RcclxuICAgICAgICAgICAgICAgICAgICBpZiAoIXBhcmVudEZvdW5kKSB7XHJcbiAgICAgICAgICAgICAgICAgICAgICAgIG1hcmtkb3duLnB1c2goYCAgcm9vdCAtLT4gcGFnZSR7aW5kZXh9YCk7XHJcbiAgICAgICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIG1hcmtkb3duLnB1c2goJ2BgYCcpO1xyXG4gICAgICAgICAgICBtYXJrZG93bi5wdXNoKCcnKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgXHJcbiAgICAgICAgcmV0dXJuIG1hcmtkb3duLmpvaW4oJ1xcbicpO1xyXG4gICAgfVxyXG5cclxuICAgIC8qKlxyXG4gICAgICogVXBkYXRlIGNvbnZlcnNpb24gc3RhdHVzIGFuZCBub3RpZnkgcmVuZGVyZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBjb252ZXJzaW9uSWQgLSBDb252ZXJzaW9uIGlkZW50aWZpZXJcclxuICAgICAqIEBwYXJhbSB7c3RyaW5nfSBzdGF0dXMgLSBOZXcgc3RhdHVzXHJcbiAgICAgKiBAcGFyYW0ge09iamVjdH0gZGV0YWlscyAtIEFkZGl0aW9uYWwgZGV0YWlsc1xyXG4gICAgICovXHJcbiAgICB1cGRhdGVDb252ZXJzaW9uU3RhdHVzKGNvbnZlcnNpb25JZCwgc3RhdHVzLCBkZXRhaWxzID0ge30pIHtcclxuICAgICAgICBjb25zdCBjb252ZXJzaW9uID0gdGhpcy5hY3RpdmVDb252ZXJzaW9ucy5nZXQoY29udmVyc2lvbklkKTtcclxuICAgICAgICBpZiAoY29udmVyc2lvbikge1xyXG4gICAgICAgICAgICBjb252ZXJzaW9uLnN0YXR1cyA9IHN0YXR1cztcclxuICAgICAgICAgICAgT2JqZWN0LmFzc2lnbihjb252ZXJzaW9uLCBkZXRhaWxzKTtcclxuICAgICAgICAgICAgXHJcbiAgICAgICAgICAgIC8vIFVwZGF0ZSBpbiBnbG9iYWwgcmVnaXN0cnkgaWYgYXZhaWxhYmxlXHJcbiAgICAgICAgICAgIGlmIChnbG9iYWwuY29udmVydGVyUmVnaXN0cnkgJiYgdHlwZW9mIGdsb2JhbC5jb252ZXJ0ZXJSZWdpc3RyeS5waW5nQ29udmVyc2lvbiA9PT0gJ2Z1bmN0aW9uJykge1xyXG4gICAgICAgICAgICAgICAgZ2xvYmFsLmNvbnZlcnRlclJlZ2lzdHJ5LnBpbmdDb252ZXJzaW9uKGNvbnZlcnNpb25JZCwge1xyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cyxcclxuICAgICAgICAgICAgICAgICAgICAuLi5kZXRhaWxzXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICBcclxuICAgICAgICAgICAgaWYgKGNvbnZlcnNpb24ud2luZG93ICYmIGNvbnZlcnNpb24ud2luZG93LndlYkNvbnRlbnRzKSB7XHJcbiAgICAgICAgICAgICAgICBjb252ZXJzaW9uLndpbmRvdy53ZWJDb250ZW50cy5zZW5kKCdwYXJlbnQtdXJsOmNvbnZlcnNpb24tcHJvZ3Jlc3MnLCB7XHJcbiAgICAgICAgICAgICAgICAgICAgY29udmVyc2lvbklkLFxyXG4gICAgICAgICAgICAgICAgICAgIHN0YXR1cyxcclxuICAgICAgICAgICAgICAgICAgICAuLi5kZXRhaWxzXHJcbiAgICAgICAgICAgICAgICB9KTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICAvKipcclxuICAgICAqIEdldCBjb252ZXJ0ZXIgaW5mb3JtYXRpb25cclxuICAgICAqIEByZXR1cm5zIHtPYmplY3R9IENvbnZlcnRlciBkZXRhaWxzXHJcbiAgICAgKi9cclxuICAgIGdldEluZm8oKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgbmFtZTogdGhpcy5uYW1lLFxyXG4gICAgICAgICAgICBwcm90b2NvbHM6IHRoaXMuc3VwcG9ydGVkUHJvdG9jb2xzLFxyXG4gICAgICAgICAgICBkZXNjcmlwdGlvbjogdGhpcy5kZXNjcmlwdGlvbixcclxuICAgICAgICAgICAgb3B0aW9uczoge1xyXG4gICAgICAgICAgICAgICAgdGl0bGU6ICdPcHRpb25hbCBzaXRlIHRpdGxlJyxcclxuICAgICAgICAgICAgICAgIG1heERlcHRoOiAnTWF4aW11bSBjcmF3bCBkZXB0aCAoZGVmYXVsdDogMSknLFxyXG4gICAgICAgICAgICAgICAgbWF4UGFnZXM6ICdNYXhpbXVtIHBhZ2VzIHRvIHByb2Nlc3MgKGRlZmF1bHQ6IDEwKScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlU2NyZWVuc2hvdDogJ1doZXRoZXIgdG8gaW5jbHVkZSBwYWdlIHNjcmVlbnNob3RzIChkZWZhdWx0OiBmYWxzZSknLFxyXG4gICAgICAgICAgICAgICAgaW5jbHVkZUltYWdlczogJ1doZXRoZXIgdG8gaW5jbHVkZSBpbWFnZXMgKGRlZmF1bHQ6IHRydWUpJyxcclxuICAgICAgICAgICAgICAgIGluY2x1ZGVMaW5rczogJ1doZXRoZXIgdG8gaW5jbHVkZSBsaW5rcyBzZWN0aW9uIChkZWZhdWx0OiB0cnVlKScsXHJcbiAgICAgICAgICAgICAgICBpbmNsdWRlU2l0ZW1hcDogJ1doZXRoZXIgdG8gaW5jbHVkZSBzaXRlIHN0cnVjdHVyZSB2aXN1YWxpemF0aW9uIChkZWZhdWx0OiB0cnVlKScsXHJcbiAgICAgICAgICAgICAgICB3YWl0VGltZTogJ0FkZGl0aW9uYWwgdGltZSB0byB3YWl0IGZvciBwYWdlIGxvYWQgaW4gbXMnXHJcbiAgICAgICAgICAgIH1cclxuICAgICAgICB9O1xyXG4gICAgfVxyXG59XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IFBhcmVudFVybENvbnZlcnRlcjtcclxuIl0sIm1hcHBpbmdzIjoiOztBQUFBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUFFQSxNQUFNQSxJQUFJLEdBQUdDLE9BQU8sQ0FBQyxNQUFNLENBQUM7QUFDNUIsTUFBTUMsRUFBRSxHQUFHRCxPQUFPLENBQUMsVUFBVSxDQUFDO0FBQzlCLE1BQU07RUFBRUU7QUFB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