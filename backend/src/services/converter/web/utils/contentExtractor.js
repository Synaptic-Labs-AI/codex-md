/**
 * Content Extractor Module
 * Handles extracting content from web pages
 * 
 * This module provides methods to extract the main content from web pages,
 * using a simplified approach that focuses on finding meaningful content
 * without complex pattern matching.
 */

import { IMAGE_EXTENSIONS } from './config.js';

export class ContentExtractor {
  /**
   * Extract main content from a page
   * @param {Page} page - Puppeteer page object
   * @returns {Promise<Object>} Object containing content and selector used
   */
  async findMainContent(page) {
    try {
      return await page.evaluate(() => {
        console.log('Starting content extraction...');
        
        // Priority ordered selectors for content
        const selectors = [
          // Common semantic elements
          'main',
          'article',
          'main[role="main"]',
          'div[role="main"]',
          
          // Content-specific classes
          '.main-content',
          '.article-content',
          '.post-content',
          '.entry-content',
          '.content-main',
          '.content',
          '#content',
          
          // Modern framework root elements
          '#root',
          '#app',
          '#__next',
          '#gatsby-focus-wrapper',
          
          // Generic content containers
          '.container',
          '.wrapper',
          '.page-content'
        ];

        // Try each selector to find main content
        for (const selector of selectors) {
          try {
            const element = document.querySelector(selector);
            if (element && element.textContent.trim().length > 100) {
              console.log(`Found content using selector: ${selector}`);
              return {
                content: element.outerHTML,
                selector: selector
              };
            }
          } catch (err) {
            console.error(`Error checking selector ${selector}:`, err);
          }
        }
        
        // If no content found with selectors, look for content blocks
        console.log('No content found with selectors, looking for content blocks...');
        
        // Find all potential content blocks
        const contentBlocks = [];
        const blocks = document.querySelectorAll('div, section');
        
        blocks.forEach(block => {
          // Skip tiny blocks
          if (block.textContent.trim().length < 100) return;
          
          // Check if block has paragraphs or headings
          const hasParagraphs = block.querySelectorAll('p').length > 0;
          const hasHeadings = block.querySelectorAll('h1, h2, h3, h4, h5, h6').length > 0;
          
          if (hasParagraphs || hasHeadings) {
            contentBlocks.push({
              element: block,
              textLength: block.textContent.trim().length
            });
          }
        });
        
        if (contentBlocks.length > 0) {
          // Sort by text length to find the largest content block
          contentBlocks.sort((a, b) => b.textLength - a.textLength);
          const largestBlock = contentBlocks[0].element;
          
          console.log(`Using largest content block (${contentBlocks[0].textLength} chars)`);
          return {
            content: largestBlock.outerHTML,
            selector: 'largest-block'
          };
        }
        
        // Last resort: use body
        console.log('No content blocks found, using body as fallback');
        return {
          content: document.body.outerHTML,
          selector: 'body-fallback'
        };
      });
    } catch (error) {
      console.error('Error finding main content:', error);
      // Return full HTML as ultimate fallback
      return {
        content: await page.content(),
        selector: 'full-page'
      };
    }
  }

  /**
   * Extract content from a page
   * @param {Page} page - Puppeteer page object
   * @param {string} baseUrl - Base URL of the page
   * @param {Object} options - Extraction options
   * @returns {Promise<Object>} Object containing content and images
   */
  async extractContent(page, baseUrl, options = {}) {
    console.log(`📄 Extracting content from: ${baseUrl}`);
    
    try {
      let content = '';
      let images = [];
      let metadata = {};
      
      // Extract metadata
      try {
        metadata = await this.extractMetadataFromPage(page, baseUrl);
        console.log('Extracted metadata:', metadata);
      } catch (metadataError) {
        console.error('Error extracting metadata:', metadataError);
        // Create fallback metadata
        metadata = {
          title: this.extractTitleFromUrl(baseUrl),
          source: baseUrl,
          captured: new Date().toISOString()
        };
      }

      // Get content
      const result = await this.findMainContent(page);
      content = result.content;
      console.log(`Found content using selector: ${result.selector}`);
      
      // Extract images if requested
      if (options.includeImages) {
        images = await this.extractImages(page, baseUrl);
      }
      
      return { content, images, metadata };
    } catch (error) {
      console.error('Error extracting content:', error);
      return {
        content: `<html><body><p>Failed to extract content: ${error.message}</p></body></html>`,
        images: [],
        metadata: {
          title: this.extractTitleFromUrl(baseUrl) || 'Error Page',
          source: baseUrl,
          captured: new Date().toISOString()
        }
      };
    }
  }

  /**
   * Extract images from a page
   * @param {Page} page - Puppeteer page object
   * @param {string} baseUrl - Base URL of the page
   * @returns {Promise<Array>} Array of image objects
   */
  async extractImages(page, baseUrl) {
    try {
      return await page.evaluate((baseUrl, imageExtensions) => {
        if (!document || !document.querySelectorAll) return [];

        // Simple function to check if URL is an image
        const isImageUrl = (url) => {
          try {
            // Check if URL is absolute, if not make it absolute using baseUrl
            const fullUrl = url.startsWith('http') ? url : new URL(url, baseUrl).href;
            const urlObj = new URL(fullUrl);
            
            // Check file extension
            const pathWithoutQuery = urlObj.pathname.toLowerCase();
            return imageExtensions.some(ext => 
              pathWithoutQuery.endsWith(ext) || 
              pathWithoutQuery.includes(ext + '?')
            );
          } catch (e) {
            console.warn('Invalid image URL:', e.message);
            return false;
          }
        };

        // Get image metadata
        const getImageMetadata = (img) => {
          try {
            // Get source URL
            const src = img.src || img.getAttribute('src') || img.getAttribute('data-src');
            if (!src) return null;
            
            const fullSrc = src.startsWith('http') ? src : new URL(src, baseUrl).href;
            if (!isImageUrl(fullSrc)) return null;

            return {
              src: fullSrc,
              alt: img.alt || img.getAttribute('alt') || '',
              title: img.title || img.getAttribute('title') || '',
              width: img.width ? img.width.toString() : '',
              height: img.height ? img.height.toString() : ''
            };
          } catch (e) {
            console.warn('Error extracting image metadata:', e.message);
            return null;
          }
        };

        // Process all img elements
        return Array.from(document.querySelectorAll('img'))
          .map(img => getImageMetadata(img))
          .filter(metadata => metadata !== null);

      }, baseUrl, IMAGE_EXTENSIONS);
    } catch (error) {
      console.error('Error extracting images:', error);
      return [];
    }
  }

  /**
   * Extract metadata from a page
   * @param {Page} page - Puppeteer page object
   * @param {string} url - URL of the page
   * @returns {Promise<Object>} Metadata object
   */
  async extractMetadataFromPage(page, url) {
    try {
      // Extract metadata directly from the page using Puppeteer
      const metadata = await page.evaluate(() => {
        // Base metadata object
        const meta = {
          title: '',
          description: '',
          author: '',
          date: '',
          site: '',
          captured: new Date().toISOString()
        };

        // Extract title (try multiple sources)
        meta.title = 
          document.querySelector('meta[property="og:title"]')?.getAttribute('content') ||
          document.querySelector('meta[name="twitter:title"]')?.getAttribute('content') ||
          document.querySelector('title')?.textContent ||
          document.querySelector('h1')?.textContent ||
          'Untitled Page';

        // Extract description
        meta.description = 
          document.querySelector('meta[property="og:description"]')?.getAttribute('content') ||
          document.querySelector('meta[name="description"]')?.getAttribute('content') ||
          document.querySelector('meta[name="twitter:description"]')?.getAttribute('content') ||
          '';

        // Extract author
        meta.author = 
          document.querySelector('meta[name="author"]')?.getAttribute('content') ||
          document.querySelector('meta[property="article:author"]')?.getAttribute('content') ||
          '';

        // Extract publication date
        meta.date = 
          document.querySelector('meta[property="article:published_time"]')?.getAttribute('content') ||
          document.querySelector('meta[name="publication_date"]')?.getAttribute('content') ||
          '';

        // Extract site name
        meta.site = 
          document.querySelector('meta[property="og:site_name"]')?.getAttribute('content') ||
          '';

        // Clean up the data
        Object.keys(meta).forEach(key => {
          if (typeof meta[key] === 'string') {
            meta[key] = meta[key]
              .trim()
              .replace(/[\r\n\t]+/g, ' ')
              .replace(/\s+/g, ' ');
          }
        });

        // Remove empty fields
        Object.keys(meta).forEach(key => {
          if (meta[key] === '' || meta[key] === null || meta[key] === undefined) {
            delete meta[key];
          }
        });

        return meta;
      });

      // Add URL-based metadata
      metadata.source = url;
      if (!metadata.site) {
        try {
          metadata.site = new URL(url).hostname;
        } catch (e) {
          metadata.site = url;
        }
      }

      return metadata;
    } catch (error) {
      console.error('Metadata extraction error:', error);
      // Return basic metadata even if extraction fails
      return {
        title: 'Untitled Page',
        source: url,
        captured: new Date().toISOString()
      };
    }
  }

  /**
   * Extract a title from a URL
   * @param {string} url - URL to extract title from
   * @returns {string} Extracted title
   */
  extractTitleFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const pathname = urlObj.pathname;
      
      // If pathname is empty or just '/', use the hostname
      if (!pathname || pathname === '/') {
        return hostname;
      }
      
      // Get the last part of the pathname
      const parts = pathname.split('/').filter(Boolean);
      let title = parts.pop() || hostname;
      
      // Remove file extension if present
      title = title.replace(/\.[^.]+$/, '');
      
      // Replace hyphens and underscores with spaces
      title = title.replace(/[-_]/g, ' ');
      
      // Capitalize words
      title = title.split(' ')
        .map(word => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
      
      return title;
    } catch (error) {
      console.error('Error extracting title from URL:', error);
      return 'Untitled Page';
    }
  }

  /**
   * Wait for dynamic content to load in SPAs
   * @param {Page} page - Puppeteer page object
   * @returns {Promise<boolean>} Whether content was detected as dynamic
   */
  async waitForDynamicContent(page) {
    try {
      console.log('Checking for dynamic content loading...');
      
      // Simple approach to wait for content to stabilize
      return await page.evaluate(async () => {
        // Function to get content state
        const getContentState = () => {
          return {
            length: document.body.textContent.length,
            elements: document.body.getElementsByTagName('*').length
          };
        };

        // Initial state
        const initialState = getContentState();
        
        // Wait a bit for any dynamic content to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        // Check if content has changed
        const finalState = getContentState();
        const hasChanged = 
          Math.abs(finalState.length - initialState.length) > 50 ||
          Math.abs(finalState.elements - initialState.elements) > 5;
        
        console.log(`Content change detected: ${hasChanged}`);
        console.log(`Initial length: ${initialState.length}, Final length: ${finalState.length}`);
        
        return hasChanged;
      });
    } catch (error) {
      console.error('Error waiting for dynamic content:', error);
      return false;
    }
  }
}

// Export utility function for backward compatibility
export const extractTitleFromUrl = (url) => {
  const extractor = new ContentExtractor();
  return extractor.extractTitleFromUrl(url);
};
