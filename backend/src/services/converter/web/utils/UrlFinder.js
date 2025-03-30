/**
 * URL Finder Module
 * Handles finding and prioritizing URLs on web pages
 */

import { AppError } from '../../../../utils/errorHandler.js';
import { DEFAULT_PARENT_URL_CONVERTER_OPTIONS } from './config.js';
import { BrowserManager } from './BrowserManager.js';
import { PageCleaner } from './PageCleaner.js';

/**
 * Normalize a URL by standardizing format and removing unnecessary components
 * @param {string} url - URL to normalize
 * @param {string} [baseUrl] - Optional base URL for resolving relative paths
 * @returns {string} Normalized URL
 */
export function normalizeUrl(url, baseUrl = '') {
  try {
    if (!url) return '';

    // Handle special URLs
    if (url.startsWith('mailto:') || url.startsWith('tel:') || url.startsWith('javascript:')) {
      return url;
    }

    // Try to resolve relative URLs if base URL is provided
    let resolvedUrl = url;
    if (baseUrl && !url.startsWith('http')) {
      try {
        resolvedUrl = new URL(url, baseUrl).toString();
      } catch (error) {
        console.warn(`Failed to resolve relative URL: ${error.message}`);
        return url;
      }
    }

    // Parse and clean the URL
    const urlObj = new URL(resolvedUrl);
    
    // Remove tracking parameters (common analytics and UTM params)
    const trackingParams = [
      'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
      'fbclid', 'gclid', '_ga', 'ref', 'source', 'campaign'
    ];
    
    const cleanParams = new URLSearchParams();
    for (const [key, value] of urlObj.searchParams.entries()) {
      if (!trackingParams.includes(key.toLowerCase())) {
        cleanParams.append(key, value);
      }
    }

    // Rebuild the URL without tracking params and fragments
    urlObj.search = cleanParams.toString();
    urlObj.hash = '';
    
    // Ensure consistent trailing slash handling
    let normalizedPath = urlObj.pathname;
    if (normalizedPath.endsWith('/index.html')) {
      normalizedPath = normalizedPath.replace('/index.html', '/');
    }
    
    return `${urlObj.origin}${normalizedPath}${urlObj.search}`;
  } catch (error) {
    console.error('Error normalizing URL:', error);
    return url;
  }
}

export class UrlFinder {
  constructor() {
    this.childUrls = new Set();
    this.normalizedUrlMap = new Map(); // Maps normalized URLs to original URLs
    this.browserManager = new BrowserManager();
    this.pageCleaner = new PageCleaner();
  }

  /**
   * Get browser instance
   * @param {Object} externalBrowser - External browser instance
   * @returns {Promise<Browser>} Browser instance
   */
  async getBrowser(externalBrowser = null) {
    return this.browserManager.getBrowser({ externalBrowser });
  }

  /**
   * Find child URLs on a page
   * @param {string} parentUrl - Parent URL
   * @param {number} chunkSize - Chunk size
   * @returns {Promise<Array>} Array of URL chunks
   */
  async findChildUrlsInChunks(parentUrl, chunkSize = 50) {
    let page = null;
    
    try {
      console.log(`🔍 Finding child pages for: ${parentUrl}`);
      
      // Get browser instance
      const browser = await this.getBrowser();
      
      // Create a new page
      page = await browser.newPage();
      
      // Set viewport
      await page.setViewport({ width: 1280, height: 800 });
      
      // Set user agent
      await page.setUserAgent(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      );
      
      // Navigate to URL with timeout and wait for content to load
      await page.goto(parentUrl, { 
        waitUntil: 'networkidle2',
        timeout: 30000
      });
      
      // Check if the page is an SPA and might need more time to load
      const isSPA = await this.pageCleaner.detectSPA(page);
      
      // For SPAs, try waiting longer for content to load
      if (isSPA) {
        console.log('Detected SPA, waiting for more content to load...');
        await new Promise(resolve => setTimeout(resolve, 5000));
      }
      
      // Clean up the page before extracting links
      await this.pageCleaner.cleanupPage(page);
      
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
        try {
          // Normalize URL to avoid duplicates
          const normalizedUrl = normalizeUrl(link.url);
          
          if (this.childUrls.has(normalizedUrl)) continue;
          if (this.shouldExcludeUrl(link.url)) continue;
          
          this.childUrls.add(normalizedUrl);
          this.normalizedUrlMap.set(normalizedUrl, link.url); // Store original URL
          
          // Store metadata for priority calculation
          urlMetadata.set(normalizedUrl, {
            ...link,
            normalizedUrl
          });
        } catch (error) {
          console.log(`⚠️ Skipping invalid URL: ${error.message}`);
        }
      }
      
      console.log(`🔍 Calculating priorities for ${urlMetadata.size} URLs...`);
      
      // Calculate priorities and organize into chunks
      const chunks = [];
      let currentChunk = [];
      
      for (const [normalizedUrl, metadata] of urlMetadata.entries()) {
        try {
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
        } catch (error) {
          console.log(`⚠️ Error processing URL ${normalizedUrl}: ${error.message}`);
        }
      }

      if (currentChunk.length > 0) {
        currentChunk.sort((a, b) => (urlPriorities.get(b) || 0) - (urlPriorities.get(a) || 0));
        chunks.push([...currentChunk]);
      }

      // Log top URLs
      console.log(`🔝 Top 10 URLs by priority:`);
      Array.from(urlPriorities.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .forEach(([normalizedUrl, priority]) => {
          console.log(`   ${priority}: ${this.normalizedUrlMap.get(normalizedUrl)}`);
        });

      console.log(`✅ Found ${this.childUrls.size} pages in ${chunks.length} chunks`);
      return chunks;

    } catch (error) {
      throw new AppError(`Failed to find child pages: ${error.message}`, 500);
    } finally {
      // Close the page but keep the browser instance
      if (page) {
        await page.close().catch(err => console.error('Error closing page:', err));
      }
    }
  }
  
  /**
   * Check if a URL should be excluded
   * @param {string} url - URL to check
   * @returns {boolean} True if the URL should be excluded
   */
  shouldExcludeUrl(url) {
    return DEFAULT_PARENT_URL_CONVERTER_OPTIONS.skipUrlPatterns.some(pattern => 
      pattern.test(url)
    );
  }
  
  /**
   * Get the original URL for a normalized URL
   * @param {string} normalizedUrl - Normalized URL
   * @returns {string} Original URL
   */
  getOriginalUrl(normalizedUrl) {
    return this.normalizedUrlMap.get(normalizedUrl) || normalizedUrl;
  }
  
  /**
   * Close the browser instance
   * @returns {Promise<void>}
   */
  async closeBrowser() {
    await this.browserManager.closeBrowser();
  }
}
