/**
 * Content Extractor Module
 * Handles extracting content from web pages
 */

import { IMAGE_EXTENSIONS } from './config.js';
import path from 'path';

export class ContentExtractor {
  /**
   * Extract main content from a page
   * @param {Page} page - Puppeteer page object
   * @returns {Promise<Object>} Object containing content and score
   */
  async findMainContent(page) {
    try {
      return await page.evaluate(() => {
      // Priority ordered selectors for content
      const selectors = [
        // React and SPA specific
        '#root',
        '#___gatsby',
        '#__next',
        'div[data-reactroot]',
        '[data-testid*="content"]',
        '[data-testid*="main"]',
        
        // Common semantic elements
        'main[role="main"]',
        'div[role="main"]',
        'article',
        'main',
        
        // Content-specific classes
        '.main-content',
        '.article-content',
        '.post-content',
        '.entry-content',
        '.content-main',
        '[class*="MainContent"]',
        '[class*="main-content"]',
        '[class*="content-container"]',
        
        // Generic content containers
        '#content',
        '.content',
        '.article',
        '.post',
        '.page-content',
        '.markdown-body',
        '.documentation',
        '.blog-post',
        
        // Last resort containers
        'div.container',
        'div.wrapper',
        'div.page'
      ];

      // Helper function to check if element has meaningful content
      const hasContent = (element) => {
        if (!element) return false;
        
        // Remove script and style elements for text length check
        const clone = element.cloneNode(true);
        clone.querySelectorAll('script, style, noscript').forEach(el => el.remove());
        
        const text = clone.textContent.trim();
        
        // Check for meaningful content
        const hasMeaningfulText = text.length > 50;
        const hasHeadings = clone.querySelectorAll('h1, h2, h3, h4, h5, h6').length > 0;
        const hasParagraphs = clone.querySelectorAll('p').length > 0;
        const hasLists = clone.querySelectorAll('ul, ol').length > 0;
        
        return hasMeaningfulText && (hasHeadings || hasParagraphs || hasLists);
      };

      // Find all text nodes recursively
      const getAllTextNodes = (element) => {
        const nodes = [];
        const walk = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
          null,
          false
        );
        let node;
        while (node = walk.nextNode()) {
          nodes.push(node);
        }
        return nodes;
      };

      // Try to find all content sections first
      const contentSections = [];
      console.log('Searching for content sections...');
      
      // Try each selector for multiple matches
      for (const selector of selectors) {
        try {
          const elements = document.querySelectorAll(selector);
          elements.forEach(element => {
            if (hasContent(element)) {
              console.log(`Found content section using selector: ${selector}`);
              console.log('Section preview:', element.textContent.substring(0, 100));
              contentSections.push({
                element: element,
                content: element.outerHTML,
                textLength: element.textContent.trim().length
              });
            }
          });
        } catch (err) {
          console.error(`Error checking selector ${selector}:`, err);
        }
      }

      // If we found multiple content sections, combine them
      if (contentSections.length > 0) {
        console.log(`Found ${contentSections.length} content sections`);
        // Sort by text length to identify main content
        contentSections.sort((a, b) => b.textLength - a.textLength);
        
        // Create a container for all content
        const combinedContent = contentSections.map(section => section.content).join('\n');
        return {
          content: `<div class="combined-content">${combinedContent}</div>`,
          selector: 'multiple-sections'
        };
      }

      // If no content sections found, try finding content blocks
      console.log('No content sections found, searching for content blocks...');
      const allBlocks = document.querySelectorAll('div, section, article, main');
      const contentBlocks = [];

      // Process each block
      allBlocks.forEach(block => {
        try {
          // Skip if this is a container for something we already found
          if (contentSections.some(section => section.element.contains(block) || 
              block.contains(section.element))) {
            return;
          }

          const textNodes = getAllTextNodes(block);
          const textContent = textNodes
            .map(node => node.textContent.trim())
            .filter(text => text.length > 0)
            .join('\n');
          
          if (textContent.length > 100 && hasContent(block)) {
            contentBlocks.push({
              content: block.outerHTML,
              textLength: textContent.length
            });
          }
        } catch (err) {
          console.error('Error processing block:', err);
        }
      });

      if (contentBlocks.length > 0) {
        console.log(`Found ${contentBlocks.length} content blocks`);
        // Sort by text length and combine the top ones
        contentBlocks.sort((a, b) => b.textLength - a.textLength);
        const topBlocks = contentBlocks.slice(0, 5); // Take top 5 largest blocks
        
        return {
          content: `<div class="content-blocks">${topBlocks.map(b => b.content).join('\n')}</div>`,
          selector: 'content-blocks'
        };
      }

      // If still no content found, get all meaningful text
      const allTextNodes = getAllTextNodes(document.body);
      const meaningfulText = allTextNodes
        .map(node => node.textContent.trim())
        .filter(text => text.length > 0)
        .join('\n');

      if (meaningfulText.length > 0) {
        console.log('Using extracted text content as fallback');
        return {
          content: `<div class="extracted-content">${meaningfulText}</div>`,
          selector: 'text-extraction'
        };
      }

      // Ultimate fallback
      console.log('Using document body as final fallback');
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
      // Get initial state
      const initialRawHtml = await page.content();
      console.log(`Initial raw HTML length: ${initialRawHtml.length}`);
      
      // Get cleaned state
      const cleanedRawHtml = await page.content();
      console.log(`Cleaned raw HTML length: ${cleanedRawHtml.length}`);
      
      let content = '';
      let score = 0;
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

      // Get content using simplified selector approach
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
        
        return Array.from(document.querySelectorAll('img'))
          .filter(img => {
            try {
              const src = img.src;
              if (!src) return false;
              const url = new URL(src, baseUrl);
              const ext = url.pathname.split('.').pop().toLowerCase();
              return imageExtensions.includes(`.${ext}`);
            } catch (e) {
              return false;
            }
          })
          .map(img => ({
            src: new URL(img.src, baseUrl).href,
            alt: img.alt || '',
            title: img.title || img.alt || ''
          }));
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

      // Ensure title is always present
      if (!metadata.title) {
        try {
          metadata.title = new URL(url).hostname;
        } catch (e) {
          metadata.title = 'Untitled Page';
        }
      }

      console.log('Extracted metadata:', metadata);
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
   * Generate a filename from a URL
   * @param {string} url - URL to generate filename from
   * @returns {string} Generated filename
   */
  generateNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      
      // If pathname is empty or just '/', use the hostname
      if (!pathname || pathname === '/') {
        return urlObj.hostname.replace(/\./g, '-');
      }
      
      // Get the last part of the pathname
      const parts = pathname.split('/').filter(Boolean);
      let filename = parts.pop() || urlObj.hostname.replace(/\./g, '-');
      
      // Remove file extension if present
      filename = filename.replace(/\.[^.]+$/, '');
      
      // Remove query parameters
      filename = filename.split('?')[0];
      
      // Clean up the filename
      filename = filename
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      
      // If filename is empty, use the hostname
      if (!filename) {
        filename = urlObj.hostname.replace(/\./g, '-');
      }
      
      return filename;
    } catch (error) {
      console.error('Error generating name from URL:', error);
      return 'untitled-page';
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
      
      // First check if it's an SPA and monitor content changes
      const result = await page.evaluate(async () => {
        // Check for common SPA frameworks
        const isSpa = !!(
          window.angular ||
          window.React ||
          window.Vue ||
          document.querySelector('[ng-app]') ||
          document.querySelector('[data-reactroot]') ||
          document.querySelector('#app') ||
          document.querySelector('#root') ||
          document.querySelector('#___gatsby') ||
          document.querySelector('#__next')
        );
        
        if (isSpa) {
          console.log('SPA detected, monitoring content changes...');
          
          // Function to get content state
          const getContentState = () => {
            const mainContent = document.querySelector('main, article, [role="main"], #root, #app');
            return {
              length: document.body.textContent.length,
              elements: document.body.getElementsByTagName('*').length,
              mainContent: mainContent ? mainContent.textContent.length : 0
            };
          };

          // Monitor content changes
          const initialState = getContentState();
          await new Promise(resolve => setTimeout(resolve, 3000)); // Initial wait
          
          let lastState = getContentState();
          let stable = false;
          let attempts = 0;
          
          while (!stable && attempts < 5) {
            await new Promise(resolve => setTimeout(resolve, 1000));
            const currentState = getContentState();
            
            stable = (
              Math.abs(currentState.length - lastState.length) < 50 &&
              Math.abs(currentState.elements - lastState.elements) < 5 &&
              Math.abs(currentState.mainContent - lastState.mainContent) < 50
            );
            
            lastState = currentState;
            attempts++;
          }
          
          return {
            isSpa: true,
            contentChanged: Math.abs(lastState.length - initialState.length) > 50,
            finalLength: lastState.length
          };
        }
        
        return { isSpa: false };
      });
      
      if (result.isSpa) {
        console.log(`SPA content stabilized (Length: ${result.finalLength})`);
        if (result.contentChanged) {
          // Additional wait after content changes
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error waiting for dynamic content:', error);
      return false;
    }
  }
}

// Export utility functions for backward compatibility
export const generateNameFromUrl = (url) => {
  const extractor = new ContentExtractor();
  return extractor.generateNameFromUrl(url);
};

export const extractTitleFromUrl = (url) => {
  const extractor = new ContentExtractor();
  return extractor.extractTitleFromUrl(url);
};
