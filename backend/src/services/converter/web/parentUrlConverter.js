/**
 * Parent URL Converter Module
 * Handles conversion of a parent URL and its child pages to markdown format
 */

import { convertUrlToMarkdown } from './urlConverter.js';
import { AppError } from '../../../utils/errorHandler.js';
import { BrowserManager } from './utils/BrowserManager.js';
import { PageCleaner } from './utils/PageCleaner.js';
import { ContentExtractor } from './utils/ContentExtractor.js';
import { mergeOptions, generateNameFromUrl } from './utils/converterConfig.js';
import pLimit from 'p-limit';

class UrlFinder {
  constructor() {
    this.childUrls = new Set();
    this.normalizedUrlMap = new Map();
    this.browserManager = new BrowserManager();
    this.pageCleaner = new PageCleaner();
  }

  /**
   * Normalize URL by removing fragments and query parameters
   * @param {string} url - URL to normalize
   * @returns {string} Normalized URL
   */
  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      urlObj.hash = '';
      return urlObj.origin + urlObj.pathname;
    } catch (error) {
      console.error('Error normalizing URL:', error);
      return url;
    }
  }

  /**
   * Find child URLs in a parent page
   * @param {string} parentUrl - Parent URL to scan
   * @param {Object} options - Configuration options
   * @returns {Promise<Array<Array<string>>>} Chunks of child URLs
   */
  async findChildUrlsInChunks(parentUrl, options) {
    let page = null;
    let browser = null;
    
    try {
      console.log(`🔍 Finding child pages for: ${parentUrl}`);
      
      // Create browser instance
      try {
        const browserOptions = {
          args: options.browser?.args,
          defaultViewport: options.browser?.defaultViewport,
          browserOptions: options.browser?.browserOptions
        };
        browser = await this.browserManager.getBrowser(browserOptions);
      } catch (error) {
        throw new AppError(`Browser initialization failed: ${error.message}`, 500);
      }
      
      // Create and set up page
      try {
        page = await this.browserManager.createPage(browser, options.page);
      } catch (error) {
        throw new AppError(`Page creation failed: ${error.message}`, 500);
      }
      
      // Navigate to URL with proper error handling
      try {
        await page.goto(parentUrl, options.navigation);
      } catch (error) {
        throw new AppError(`Navigation failed: ${error.message}`, 500);
      }
      
      // Clean up the page
      await this.pageCleaner.removeOverlays(page);
      await this.pageCleaner.cleanupPage(page);
      
      // Check for SPA and wait if needed
      if (await this.pageCleaner.detectSPA(page)) {
        console.log('Detected SPA, waiting for more content to load...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Extract all links from the page
      const parentUrlObj = new URL(parentUrl);
      const urlMetadata = new Map();
      const urlPriorities = new Map();
      
      // Find all links on the page
      const links = await page.evaluate((parentHostname) => {
        return Array.from(document.querySelectorAll('a[href]'))
          .map(a => {
            try {
              const href = a.href;
              if (!href || href === '#' || href === '/' || 
                  href.startsWith('javascript:') || href.startsWith('mailto:') || 
                  href.startsWith('tel:')) {
                return null;
              }
              
              const url = new URL(href);
              if (url.hostname !== parentHostname) return null;
              
              return {
                url: href,
                text: a.textContent.trim(),
                isInNavigation: !!a.closest('nav, .nav, .menu, .navigation, header'),
                isInMain: !!a.closest('main, article, .content, #content'),
                pathDepth: url.pathname.split('/').filter(Boolean).length
              };
            } catch (e) {
              return null;
            }
          })
          .filter(Boolean);
      }, parentUrlObj.hostname);
      
      // Process links
      for (const link of links) {
        const normalizedUrl = this.normalizeUrl(link.url);
        
        // Skip if already processed or matches skip patterns
        if (this.childUrls.has(normalizedUrl)) continue;
        if (this.shouldExcludeUrl(link.url, options)) continue;
        
        this.childUrls.add(normalizedUrl);
        this.normalizedUrlMap.set(normalizedUrl, link.url);
        
        urlMetadata.set(normalizedUrl, {
          ...link,
          normalizedUrl
        });
      }
      
      // Calculate priorities and organize into chunks
      console.log(`🔍 Calculating priorities for ${urlMetadata.size} URLs...`);
      const chunks = this.organizeUrlsIntoChunks(urlMetadata, urlPriorities, options.parentUrl.chunkSize);
      
      console.log(`✅ Found ${this.childUrls.size} pages in ${chunks.length} chunks`);
      return chunks;

    } catch (error) {
      throw new AppError(`Failed to find child pages: ${error.message}`, 500);
    } finally {
      if (page) {
        try {
          await page.close();
          console.log('Page closed successfully');
        } catch (err) {
          console.error('Error closing page:', err);
        }
      }
    }
  }

  /**
   * Organize URLs into prioritized chunks
   * @param {Map} urlMetadata - URL metadata
   * @param {Map} urlPriorities - URL priorities
   * @param {number} chunkSize - Size of each chunk
   * @returns {Array<Array<string>>} Chunks of URLs
   */
  organizeUrlsIntoChunks(urlMetadata, urlPriorities, chunkSize) {
    const chunks = [];
    let currentChunk = [];

    // Calculate priorities for each URL
    for (const [normalizedUrl, metadata] of urlMetadata.entries()) {
      let priority = 50; // Base priority
      
      // Adjust based on location
      if (metadata.isInMain) priority += 30;
      if (metadata.isInNavigation) priority += 20;
      priority -= metadata.pathDepth * 5;
      
      // Adjust for home page and important sections
      const urlObj = new URL(metadata.url);
      if (urlObj.pathname === '/' || urlObj.pathname === '/index.html') {
        priority += 50;
      }
      if (/\/(about|contact|docs)/.test(urlObj.pathname)) {
        priority += 40;
      }
      
      urlPriorities.set(normalizedUrl, priority);
      currentChunk.push(normalizedUrl);
      
      if (currentChunk.length >= chunkSize) {
        currentChunk.sort((a, b) => (urlPriorities.get(b) || 0) - (urlPriorities.get(a) || 0));
        chunks.push([...currentChunk]);
        currentChunk = [];
      }
    }

    if (currentChunk.length > 0) {
      currentChunk.sort((a, b) => (urlPriorities.get(b) || 0) - (urlPriorities.get(a) || 0));
      chunks.push([...currentChunk]);
    }

    return chunks;
  }

  shouldExcludeUrl(url, options) {
    return options.parentUrl.skipUrlPatterns.some(pattern => pattern.test(url));
  }

  getOriginalUrl(normalizedUrl) {
    return this.normalizedUrlMap.get(normalizedUrl) || normalizedUrl;
  }

  async closeBrowser() {
    await this.browserManager.closeBrowser();
  }
}

class UrlProcessor {
  constructor() {
    this.contentExtractor = new ContentExtractor();
  }

  /**
   * Process a list of URLs
   * @param {Array<string>} urls - URLs to process
   * @param {UrlFinder} finder - URL finder instance
   * @param {Object} options - Processing options
   * @returns {Promise<Array<Object>>} Processing results
   */
  async processUrlsInChunks(urls, finder, options = {}) {
    const limit = pLimit(options.parentUrl.concurrentLimit);
    const results = [];
    const processedUrls = new Set();

    for (const normalizedUrl of urls) {
      try {
        const url = finder.getOriginalUrl(normalizedUrl);
        
        if (processedUrls.has(normalizedUrl)) {
          console.log(`⏭️ Skipping duplicate URL: ${url}`);
          continue;
        }
        
        processedUrls.add(normalizedUrl);
        
        const result = await limit(async () => {
          const convertResult = await convertUrlToMarkdown(url, options);
          return {
            ...convertResult,
            normalizedUrl
          };
        });

        console.log(`✅ Converted: ${url}`);
        results.push(result);

      } catch (error) {
        console.log(`❌ Failed to convert: ${finder.getOriginalUrl(normalizedUrl)}`);
        results.push({ 
          success: false, 
          url: finder.getOriginalUrl(normalizedUrl),
          normalizedUrl,
          error: error.message 
        });
      }
    }

    return results;
  }

  /**
   * Generate an index file for the converted pages
   * @param {string} parentUrl - Parent URL
   * @param {Array<Object>} pages - Converted pages
   * @param {string} hostname - Site hostname
   * @returns {Object} Index content and metadata
   */
  generateIndex(parentUrl, pages, hostname) {
    const successfulPages = pages.filter(p => p.success);
    const failedPages = pages.filter(p => !p.success);
    const timestamp = new Date().toISOString();
    
    let cleanHostname = hostname.replace(/^temp_\d+_/, '');

    // Group pages by sections
    const sections = new Map();
    const processedPaths = new Set();
    
    successfulPages.forEach(page => {
      try {
        const url = new URL(page.url);
        const pathParts = url.pathname.split('/').filter(Boolean);
        const section = pathParts[0] || 'main';
        
        if (!sections.has(section)) {
          sections.set(section, []);
        }
        
        const pathKey = url.pathname;
        if (!processedPaths.has(pathKey)) {
          processedPaths.add(pathKey);
          sections.get(section).push(page);
        }
      } catch (error) {
        console.error('Error processing page section:', error);
      }
    });

    // Generate index content
    const content = [
      `# ${cleanHostname} Website Archive`,
      '',
      '## Site Information',
      `- **Source URL:** ${parentUrl}`,
      `- **Archived:** ${timestamp}`,
      `- **Total Pages:** ${pages.length}`,
      `- **Successful:** ${successfulPages.length}`,
      `- **Failed:** ${failedPages.length}`,
      '',
      '## Successfully Converted Pages',
      '',
      ...Array.from(sections.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([section, sectionPages]) => [
          `### ${section.charAt(0).toUpperCase() + section.slice(1)}`,
          '',
          ...sectionPages.map(page => {
            const name = page.name.replace(/\.md$/, '');
            return `- [[pages/${name}|${name}]] - [Original](${page.url})`;
          }),
          ''
        ].join('\n')),
      '',
      failedPages.length ? [
        '## Failed Conversions',
        '',
        ...failedPages.map(page => `- ${page.url}: ${page.error}`),
        ''
      ].join('\n') : ''
    ].join('\n');

    // Generate metadata
    const metadata = {
      title: `${cleanHostname} Archive`,
      description: `Website archive of ${cleanHostname}`,
      date: timestamp,
      source: parentUrl,
      archived_at: timestamp,
      page_count: successfulPages.length,
      tags: [
        'website-archive',
        hostname.replace(/\./g, '-')
      ]
    };

    return { content, metadata };
  }
}

/**
 * Convert a parent URL and its child pages to markdown
 * @param {string} parentUrl - Parent URL to convert
 * @param {Object} userOptions - Conversion options
 * @returns {Promise<Object>} Conversion result
 */
export async function convertParentUrlToMarkdown(parentUrl, userOptions = {}) {
  const finder = new UrlFinder();
  const processor = new UrlProcessor();
  const options = mergeOptions(userOptions, true);

  try {
    // Validate and normalize URL
    let urlObj;
    try {
      urlObj = new URL(parentUrl.startsWith('http') ? parentUrl : `https://${parentUrl}`);
      parentUrl = urlObj.toString();
    } catch (error) {
      throw new AppError(`Invalid URL format: ${error.message}`, 400);
    }
    
    const hostname = urlObj.hostname;
    console.log(`🚀 Starting conversion of ${parentUrl}`);

    // Process parent URL first
    console.log(`📄 Processing parent URL`);
    const normalizedParentUrl = finder.normalizeUrl(parentUrl);
    finder.childUrls.add(normalizedParentUrl);
    finder.normalizedUrlMap.set(normalizedParentUrl, parentUrl);
    
    const parentPageResult = await processor.processUrlsInChunks([normalizedParentUrl], finder, options);

    // Process child URLs in chunks
    let processedPages = [...parentPageResult];
    const urlChunks = await finder.findChildUrlsInChunks(parentUrl, options);
    
    for (const urlChunk of urlChunks) {
      console.log(`🔄 Processing chunk of ${urlChunk.length} URLs`);
      const chunkResults = await processor.processUrlsInChunks(urlChunk, finder, options);
      processedPages.push(...chunkResults);
    }

    // Generate index content and metadata
    const { content: indexContent, metadata } = processor.generateIndex(parentUrl, processedPages, hostname);

    // Create files array with properly named files
    const files = [
      {
        name: `index.md`, // Main index file
        content: indexContent,
        type: 'text'
      }
    ];
    
    // Add page files with consistent naming
    const uniquePages = new Map();
    processedPages.filter(p => p.success).forEach(page => {
      if (!uniquePages.has(page.normalizedUrl)) {
        const pageName = generateNameFromUrl(page.url); // Use centralized naming function
        uniquePages.set(page.normalizedUrl, {
          name: `pages/${pageName}`,
          content: page.content,
          type: 'text'
        });
      }
    });
    
    files.push(...uniquePages.values());

    return {
      url: parentUrl,
      type: 'parenturl',
      name: hostname,
      content: indexContent,
      metadata,
      files,
      success: true,
      stats: {
        totalPages: processedPages.length,
        successfulPages: processedPages.filter(p => p.success).length,
        failedPages: processedPages.filter(p => !p.success).length,
        totalImages: processedPages.reduce((sum, p) => sum + (p.images?.length || 0), 0)
      }
    };

  } catch (error) {
    console.error('Parent URL conversion failed:', error);
    throw new AppError(
      error instanceof AppError ? error.message : `Failed to convert parent URL: ${error.message}`,
      error instanceof AppError ? error.statusCode : 500
    );
  } finally {
    try {
      await finder.closeBrowser();
    } catch (error) {
      console.error('Error closing browser:', error);
    }
  }
}
